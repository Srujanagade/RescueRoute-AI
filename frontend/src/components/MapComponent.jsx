import React, { useEffect, useEffectEvent, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { useShallow } from "zustand/react/shallow";
import useAppStore from "../store/useAppStore";
import useGeolocation from "../hooks/useGeolocation";
import { fetchDisasterSummary, fetchRouteComparison } from "../services/api";
import {
  buildDisasterPopupHtml,
  buildLocalDisasterInsight,
  DISASTER_COLOR_EXPRESSION,
  DISASTER_CONFIDENCE_OPACITY_EXPRESSION,
  DISASTER_CONFIDENCE_STROKE_COLOR_EXPRESSION,
  DISASTER_CONFIDENCE_STROKE_WIDTH_EXPRESSION,
  DISASTER_RADIUS_EXPRESSION,
  filterDisasters,
  getDisasterInsightCacheKey,
  toGeoJSON,
} from "../utils/disasters";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const EMPTY_GEOJSON = { type: "FeatureCollection", features: [] };
const ROAD_BASE_SOURCE_ID = "roads-base";
const ROAD_BASE_LAYER_ID = "roads-base-layer";
const ROAD_OVERLAY_SOURCE_ID = "roads-overlay";
const ROAD_OVERLAY_LAYER_ID = "roads-overlay-layer";
const ROUTE_SOURCE_ID = "route";
const ROUTE_LAYER_ID = "route-layer";
const FASTEST_ROUTE_SOURCE_ID = "fastest-route";
const FASTEST_ROUTE_LAYER_ID = "fastest-route-line";
const SAFEST_ROUTE_SOURCE_ID = "safest-route";
const SAFEST_ROUTE_LAYER_ID = "safest-route-line";
const DISASTER_SOURCE_ID = "disasters";
const DISASTER_CLUSTER_LAYER_ID = "disaster-clusters";
const DISASTER_CLUSTER_COUNT_LAYER_ID = "disaster-cluster-count";
const DISASTER_POINT_LAYER_ID = "disaster-points";
const DISASTER_INTERACTIVE_LAYER_IDS = [
  DISASTER_CLUSTER_LAYER_ID,
  DISASTER_POINT_LAYER_ID,
];

const toLngLatPoint = (location) => {
  if (!location) {
    return null;
  }

  const lat = Number(location.lat);
  const lng = Number(location.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return [lng, lat];
};

const createPinnedLocation = (point, fallbackName) => ({
  name: `${fallbackName} (${point[1].toFixed(4)}, ${point[0].toFixed(4)})`,
  lat: point[1],
  lng: point[0],
});

const getRouteComparisonError = (error) => {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    return detail.message;
  }

  return "Route comparison is unavailable for the selected points.";
};

const getViewportBounds = (mapInstance) => {
  const bounds = mapInstance.getBounds();

  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
};

const hasStatusOverlay = (roadsData) =>
  Array.isArray(roadsData?.features) &&
  roadsData.features.some((feature) =>
    ["safe", "risky", "blocked"].includes(feature?.properties?.status),
  );

const toSourceData = (geometry) => geometry || EMPTY_GEOJSON;

const MapComponent = () => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const currentLocationMarkerRef = useRef(null);
  const startMarkerRef = useRef(null);
  const endMarkerRef = useRef(null);
  const hasCenteredOnUserRef = useRef(false);
  const comparisonRequestIdRef = useRef(0);
  const summaryRequestIdRef = useRef(0);

  const {
    roadsData,
    routeData,
    comparisonRoutes,
    selectedRouteType,
    disasters,
    disasterSummaryCache,
    filters,
    confidenceFilter,
    timeline,
    userLocation,
    source,
    destination,
    routePoints,
    setLoadingMsg,
    setMapBounds,
    setMapCenter,
    setSelectedDisaster,
    setDisasterSummary,
    setLoadingSummary,
    setDisasterSummaryError,
    cacheDisasterSummary,
    setRouteData,
    setComparisonRoutes,
    setRouteComparisonError,
    setRouteComparisonStatus,
    setSelectedRouteType,
    setRoutePoints,
    setRoutingMode,
    setUserLocation,
    setSource,
    setDestination,
  } = useAppStore(
    useShallow((state) => ({
      roadsData: state.roadsData,
      routeData: state.routeData,
      comparisonRoutes: state.comparisonRoutes,
      selectedRouteType: state.selectedRouteType,
      disasters: state.disasters,
      disasterSummaryCache: state.disasterSummaryCache,
      filters: state.filters,
      confidenceFilter: state.confidenceFilter,
      timeline: state.timeline,
      userLocation: state.userLocation,
      source: state.source,
      destination: state.destination,
      routePoints: state.routePoints,
      setLoadingMsg: state.setLoadingMsg,
      setMapBounds: state.setMapBounds,
      setMapCenter: state.setMapCenter,
      setSelectedDisaster: state.setSelectedDisaster,
      setDisasterSummary: state.setDisasterSummary,
      setLoadingSummary: state.setLoadingSummary,
      setDisasterSummaryError: state.setDisasterSummaryError,
      cacheDisasterSummary: state.cacheDisasterSummary,
      setRouteData: state.setRouteData,
      setComparisonRoutes: state.setComparisonRoutes,
      setRouteComparisonError: state.setRouteComparisonError,
      setRouteComparisonStatus: state.setRouteComparisonStatus,
      setSelectedRouteType: state.setSelectedRouteType,
      setRoutePoints: state.setRoutePoints,
      setRoutingMode: state.setRoutingMode,
      setUserLocation: state.setUserLocation,
      setSource: state.setSource,
      setDestination: state.setDestination,
    })),
  );

  useGeolocation(setUserLocation);

  const loadDisasterInsight = useEffectEvent(async (disaster) => {
    if (!disaster) {
      return;
    }

    const cacheKey = getDisasterInsightCacheKey(disaster);
    const cachedSummary = disasterSummaryCache[cacheKey];

    setSelectedDisaster(disaster);
    setDisasterSummaryError("");

    if (cachedSummary?.summary) {
      setDisasterSummary(cachedSummary.summary, {
        usedFallback: cachedSummary.used_fallback,
        provider: cachedSummary.provider,
      });
      if (cachedSummary.used_fallback) {
        setDisasterSummaryError("Unable to generate insights. Showing raw data.");
      }
      return;
    }

    const requestId = summaryRequestIdRef.current + 1;
    summaryRequestIdRef.current = requestId;

    setLoadingSummary(true);
    setDisasterSummary("", {
      usedFallback: false,
      provider: "pending",
    });

    try {
      const result = await fetchDisasterSummary(disaster);
      if (summaryRequestIdRef.current !== requestId) {
        return;
      }

      cacheDisasterSummary(cacheKey, result);
      setDisasterSummary(result.summary, {
        usedFallback: result.used_fallback,
        provider: result.provider,
      });
      if (result.used_fallback) {
        setDisasterSummaryError("Unable to generate insights. Showing raw data.");
      }
    } catch (error) {
      if (summaryRequestIdRef.current !== requestId) {
        return;
      }

      console.error(error);
      const fallbackSummary = buildLocalDisasterInsight(disaster);
      const fallbackResult = {
        summary: fallbackSummary,
        used_fallback: true,
        provider: "frontend-fallback",
      };

      cacheDisasterSummary(cacheKey, fallbackResult);
      setDisasterSummary(fallbackSummary, {
        usedFallback: true,
        provider: "frontend-fallback",
      });
      setDisasterSummaryError("Unable to generate insights. Showing raw data.");
    } finally {
      if (summaryRequestIdRef.current === requestId) {
        setLoadingSummary(false);
      }
    }
  });

  useEffect(() => {
    if (mapRef.current) return undefined;

    const { lng, lat, zoom } = useAppStore.getState().mapCenter;
    const nextMap = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [lng, lat],
      zoom,
      pitch: 45,
      bearing: -17.6,
    });

    mapRef.current = nextMap;

    nextMap.on("load", () => {
      nextMap.addSource(ROAD_BASE_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_GEOJSON,
      });
      nextMap.addLayer({
        id: ROAD_BASE_LAYER_ID,
        type: "line",
        source: ROAD_BASE_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#64748b",
          "line-width": 2,
          "line-opacity": 0.35,
        },
      });

      nextMap.addSource(ROAD_OVERLAY_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_GEOJSON,
      });
      nextMap.addLayer({
        id: ROAD_OVERLAY_LAYER_ID,
        type: "line",
        source: ROAD_OVERLAY_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "status"],
            "blocked",
            "#ef4444",
            "risky",
            "#facc15",
            "safe",
            "#22c55e",
            "rgba(0,0,0,0)",
          ],
          "line-width": [
            "match",
            ["get", "status"],
            "blocked",
            5,
            "risky",
            4,
            "safe",
            3,
            0,
          ],
          "line-opacity": [
            "match",
            ["get", "status"],
            "blocked",
            0.92,
            "risky",
            0.88,
            "safe",
            0.82,
            0,
          ],
        },
      });

      nextMap.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_GEOJSON,
      });
      nextMap.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#38bdf8",
          "line-width": 6,
          "line-opacity": 0.9,
          "line-blur": 1,
        },
      });

      nextMap.addSource(FASTEST_ROUTE_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_GEOJSON,
      });
      nextMap.addLayer({
        id: FASTEST_ROUTE_LAYER_ID,
        type: "line",
        source: FASTEST_ROUTE_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#ef4444",
          "line-width": 5,
          "line-opacity": 0.82,
        },
      });

      nextMap.addSource(SAFEST_ROUTE_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_GEOJSON,
      });
      nextMap.addLayer({
        id: SAFEST_ROUTE_LAYER_ID,
        type: "line",
        source: SAFEST_ROUTE_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#22c55e",
          "line-width": 5,
          "line-opacity": 0.82,
          "line-dasharray": [2, 2],
        },
      });

      nextMap.addSource(DISASTER_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_GEOJSON,
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 50,
      });
      nextMap.addLayer({
        id: DISASTER_CLUSTER_LAYER_ID,
        type: "circle",
        source: DISASTER_SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#2563eb",
            10,
            "#1d4ed8",
            30,
            "#1e40af",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            16,
            10,
            22,
            50,
            30,
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(255, 255, 255, 0.22)",
          "circle-opacity": 0.92,
        },
      });
      nextMap.addLayer({
        id: DISASTER_CLUSTER_COUNT_LAYER_ID,
        type: "symbol",
        source: DISASTER_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#f8fafc",
        },
      });
      nextMap.addLayer({
        id: DISASTER_POINT_LAYER_ID,
        type: "circle",
        source: DISASTER_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": DISASTER_COLOR_EXPRESSION,
          "circle-radius": DISASTER_RADIUS_EXPRESSION,
          "circle-opacity": DISASTER_CONFIDENCE_OPACITY_EXPRESSION,
          "circle-stroke-color": DISASTER_CONFIDENCE_STROKE_COLOR_EXPRESSION,
          "circle-stroke-width": DISASTER_CONFIDENCE_STROKE_WIDTH_EXPRESSION,
        },
      });

      nextMap.on("click", DISASTER_CLUSTER_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        const disasterSource = nextMap.getSource(DISASTER_SOURCE_ID);
        const clusterId = Number(feature?.properties?.cluster_id);

        if (
          !feature ||
          feature.geometry?.type !== "Point" ||
          !Number.isFinite(clusterId) ||
          !disasterSource
        ) {
          return;
        }

        disasterSource.getClusterExpansionZoom(clusterId, (error, zoomLevel) => {
          if (error) return;

          nextMap.easeTo({
            center: feature.geometry.coordinates,
            zoom: zoomLevel,
          });
        });
      });

      nextMap.on("click", DISASTER_POINT_LAYER_ID, (event) => {
        const feature = event.features?.[0];

        if (!feature || feature.geometry?.type !== "Point") {
          return;
        }

        popupRef.current?.remove();
        popupRef.current = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 18,
        })
          .setLngLat(feature.geometry.coordinates)
          .setHTML(buildDisasterPopupHtml(feature.properties))
          .addTo(nextMap);

        const disasterId = feature.properties?.id;
        const storeDisaster = useAppStore
          .getState()
          .disasters.find((disaster) => disaster.id === disasterId);
        const selectedDisaster = storeDisaster || {
          id: disasterId || `map-disaster-${Date.now()}`,
          type: feature.properties?.type || "other",
          latitude: feature.geometry.coordinates[1],
          longitude: feature.geometry.coordinates[0],
          severity: Number.isFinite(Number(feature.properties?.severity))
            ? Number(feature.properties.severity)
            : null,
          timestamp: feature.properties?.timestamp || new Date().toISOString(),
          source: feature.properties?.source || "Unknown",
          confidence: feature.properties?.confidence || "low",
          location: feature.properties?.location || null,
          title: feature.properties?.title || null,
          description: feature.properties?.description || null,
        };

        void loadDisasterInsight(selectedDisaster);
      });

      DISASTER_INTERACTIVE_LAYER_IDS.forEach((layerId) => {
        nextMap.on("mouseenter", layerId, () => {
          nextMap.getCanvas().style.cursor = "pointer";
        });
        nextMap.on("mouseleave", layerId, () => {
          nextMap.getCanvas().style.cursor = "";
        });
      });

      const initialState = useAppStore.getState();
      nextMap.getSource(ROAD_BASE_SOURCE_ID)?.setData(initialState.roadsData || EMPTY_GEOJSON);
      nextMap
        .getSource(ROAD_OVERLAY_SOURCE_ID)
        ?.setData(hasStatusOverlay(initialState.roadsData) ? initialState.roadsData : EMPTY_GEOJSON);
      nextMap.getSource(ROUTE_SOURCE_ID)?.setData(initialState.routeData || EMPTY_GEOJSON);
      nextMap
        .getSource(FASTEST_ROUTE_SOURCE_ID)
        ?.setData(toSourceData(initialState.comparisonRoutes?.fastest?.geometry));
      nextMap
        .getSource(SAFEST_ROUTE_SOURCE_ID)
        ?.setData(toSourceData(initialState.comparisonRoutes?.safest?.geometry));
      nextMap.getSource(DISASTER_SOURCE_ID)?.setData(
        toGeoJSON(
          filterDisasters(
            initialState.disasters,
            initialState.filters,
            initialState.confidenceFilter,
          ),
        ),
      );

      setMapBounds(getViewportBounds(nextMap));
    });

    nextMap.on("move", () => {
      const center = nextMap.getCenter();
      setMapCenter({
        lng: Number(center.lng.toFixed(4)),
        lat: Number(center.lat.toFixed(4)),
        zoom: Number(nextMap.getZoom().toFixed(2)),
      });
    });

    nextMap.on("moveend", () => {
      setMapBounds(getViewportBounds(nextMap));
    });

    return () => {
      popupRef.current?.remove();
      currentLocationMarkerRef.current?.remove();
      startMarkerRef.current?.remove();
      endMarkerRef.current?.remove();
      nextMap.remove();
      mapRef.current = null;
    };
  }, [
    cacheDisasterSummary,
    disasterSummaryCache,
    setDisasterSummary,
    setDisasterSummaryError,
    setLoadingSummary,
    setMapBounds,
    setMapCenter,
    setSelectedDisaster,
  ]);

  useEffect(() => {
    const baseSource = mapRef.current?.getSource(ROAD_BASE_SOURCE_ID);
    if (baseSource) {
      baseSource.setData(roadsData || EMPTY_GEOJSON);
    }

    const overlaySource = mapRef.current?.getSource(ROAD_OVERLAY_SOURCE_ID);
    if (overlaySource) {
      overlaySource.setData(hasStatusOverlay(roadsData) ? roadsData : EMPTY_GEOJSON);
    }
  }, [roadsData]);

  useEffect(() => {
    const source = mapRef.current?.getSource(ROUTE_SOURCE_ID);
    if (source) {
      source.setData(routeData || EMPTY_GEOJSON);
    }
  }, [routeData]);

  useEffect(() => {
    const fastestSource = mapRef.current?.getSource(FASTEST_ROUTE_SOURCE_ID);
    if (fastestSource) {
      fastestSource.setData(toSourceData(comparisonRoutes?.fastest?.geometry));
    }

    const safestSource = mapRef.current?.getSource(SAFEST_ROUTE_SOURCE_ID);
    if (safestSource) {
      safestSource.setData(toSourceData(comparisonRoutes?.safest?.geometry));
    }
  }, [comparisonRoutes]);

  useEffect(() => {
    const mapInstance = mapRef.current;
    const currentPoint = toLngLatPoint(userLocation);

    if (!mapInstance || !currentPoint) {
      return;
    }

    if (!currentLocationMarkerRef.current) {
      currentLocationMarkerRef.current = new mapboxgl.Marker({ color: "#3b82f6" })
        .setLngLat(currentPoint)
        .addTo(mapInstance);
    } else {
      currentLocationMarkerRef.current.setLngLat(currentPoint);
    }

    if (!hasCenteredOnUserRef.current) {
      mapInstance.flyTo({
        center: currentPoint,
        zoom: 12,
        essential: true,
      });
      hasCenteredOnUserRef.current = true;
    }
  }, [userLocation]);

  useEffect(() => {
    const mapInstance = mapRef.current;
    if (!mapInstance || !mapInstance.getLayer(FASTEST_ROUTE_LAYER_ID)) return;

    if (selectedRouteType === "fastest") {
      mapInstance.setPaintProperty(FASTEST_ROUTE_LAYER_ID, "line-width", 8);
      mapInstance.setPaintProperty(FASTEST_ROUTE_LAYER_ID, "line-opacity", 1);
      mapInstance.setPaintProperty(SAFEST_ROUTE_LAYER_ID, "line-width", 4);
      mapInstance.setPaintProperty(SAFEST_ROUTE_LAYER_ID, "line-opacity", 0.5);
    } else {
      mapInstance.setPaintProperty(SAFEST_ROUTE_LAYER_ID, "line-width", 8);
      mapInstance.setPaintProperty(SAFEST_ROUTE_LAYER_ID, "line-opacity", 1);
      mapInstance.setPaintProperty(FASTEST_ROUTE_LAYER_ID, "line-width", 4);
      mapInstance.setPaintProperty(FASTEST_ROUTE_LAYER_ID, "line-opacity", 0.5);
    }
  }, [selectedRouteType, comparisonRoutes]);

  useEffect(() => {
    if (routePoints.length !== 2) {
      return undefined;
    }

    let isActive = true;
    const requestId = comparisonRequestIdRef.current + 1;
    comparisonRequestIdRef.current = requestId;

    const compareRoutes = async () => {
      setLoadingMsg("Comparing routes...");
      setRouteComparisonStatus("loading");
      setRouteComparisonError("");

      try {
        const comparison = await fetchRouteComparison(routePoints[0], routePoints[1], timeline);
        if (!isActive || comparisonRequestIdRef.current !== requestId) {
          return;
        }

        setComparisonRoutes(comparison);
        setSelectedRouteType("fastest");
      } catch (error) {
        if (!isActive || comparisonRequestIdRef.current !== requestId) {
          return;
        }

        console.error(error);
        setRouteComparisonError(getRouteComparisonError(error));
        setRouteComparisonStatus("error");
      } finally {
        if (isActive && comparisonRequestIdRef.current === requestId) {
          setLoadingMsg("");
        }
      }
    };

    void compareRoutes();

    return () => {
      isActive = false;
    };
  }, [
    routePoints,
    timeline,
    setComparisonRoutes,
    setLoadingMsg,
    setRouteComparisonError,
    setRouteComparisonStatus,
    setSelectedRouteType,
  ]);

  useEffect(() => {
    const source = mapRef.current?.getSource(DISASTER_SOURCE_ID);
    if (source) {
      source.setData(toGeoJSON(filterDisasters(disasters, filters, confidenceFilter)));
    }
  }, [disasters, filters, confidenceFilter]);

  useEffect(() => {
    const mapInstance = mapRef.current;
    if (!mapInstance) {
      return;
    }

    const sourcePoint = toLngLatPoint(source) || routePoints[0] || null;
    const destinationPoint = toLngLatPoint(destination) || routePoints[1] || null;

    if (sourcePoint) {
      if (!startMarkerRef.current) {
        startMarkerRef.current = new mapboxgl.Marker({ color: "#10b981" })
          .setLngLat(sourcePoint)
          .addTo(mapInstance);
      } else {
        startMarkerRef.current.setLngLat(sourcePoint);
      }
    } else if (startMarkerRef.current) {
      startMarkerRef.current.remove();
      startMarkerRef.current = null;
    }

    if (destinationPoint) {
      if (!endMarkerRef.current) {
        endMarkerRef.current = new mapboxgl.Marker({ color: "#ef4444" })
          .setLngLat(destinationPoint)
          .addTo(mapInstance);
      } else {
        endMarkerRef.current.setLngLat(destinationPoint);
      }
    } else if (endMarkerRef.current) {
      endMarkerRef.current.remove();
      endMarkerRef.current = null;
    }
  }, [destination, routePoints, source]);

  useEffect(() => {
    const mapInstance = mapRef.current;

    if (!mapInstance) {
      return;
    }

    const sourcePoint = toLngLatPoint(source);
    const destinationPoint = toLngLatPoint(destination);

    if (sourcePoint && destinationPoint) {
      const bounds = new mapboxgl.LngLatBounds(sourcePoint, sourcePoint);
      bounds.extend(destinationPoint);
      mapInstance.fitBounds(bounds, {
        padding: 120,
        duration: 900,
        maxZoom: 13,
      });
      return;
    }

    const focusPoint = destinationPoint || sourcePoint;
    if (focusPoint) {
      mapInstance.flyTo({
        center: focusPoint,
        zoom: Math.max(mapInstance.getZoom(), 12),
        duration: 900,
        essential: true,
      });
    }
  }, [destination, source]);

  useEffect(() => {
    const mapInstance = mapRef.current;
    if (!mapInstance) return undefined;

    const clickHandler = (event) => {
      if (!useAppStore.getState().routingMode) {
        return;
      }

      const activeInteractiveLayers = DISASTER_INTERACTIVE_LAYER_IDS.filter((layerId) =>
        mapInstance.getLayer(layerId),
      );

      if (
        activeInteractiveLayers.length > 0 &&
        mapInstance.queryRenderedFeatures(event.point, {
          layers: activeInteractiveLayers,
        }).length > 0
      ) {
        return;
      }

      const point = [event.lngLat.lng, event.lngLat.lat];
      const currentPoints = useAppStore.getState().routePoints;

      if (currentPoints.length === 0) {
        setRouteData(null);
        setComparisonRoutes(null);
        setRouteComparisonStatus("idle");
        setRouteComparisonError("");
        setSelectedRouteType("fastest");
        setSource(createPinnedLocation(point, "Pinned source"));
        setDestination(null);
        setRoutePoints([point]);
        return;
      }

      if (currentPoints.length !== 1) {
        return;
      }

      const nextPoints = [currentPoints[0], point];
      setDestination(createPinnedLocation(point, "Pinned destination"));
      setRoutePoints(nextPoints);
      setRoutingMode(false);
    };

    mapInstance.on("click", clickHandler);
    return () => {
      mapInstance.off("click", clickHandler);
    };
  }, [
    setComparisonRoutes,
    setDestination,
    setRouteComparisonError,
    setRouteComparisonStatus,
    setRouteData,
    setRoutePoints,
    setRoutingMode,
    setSelectedRouteType,
    setSource,
  ]);

  useEffect(() => {
    if (routePoints.length !== 0 || source || destination) {
      return;
    }

    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    endMarkerRef.current?.remove();
    endMarkerRef.current = null;
  }, [destination, routePoints, source]);

  return <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />;
};

export default MapComponent;
