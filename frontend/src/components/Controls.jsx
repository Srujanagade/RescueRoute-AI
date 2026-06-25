import React from "react";
import { AlertTriangle, Layers, Navigation } from "lucide-react";
import useAppStore from "../store/useAppStore";
import { fetchLocalRoads, fetchRoadStatus } from "../services/api";
import { filterDisasters } from "../utils/disasters";

const Controls = () => {
  const {
    roadsData,
    disasters,
    filters,
    confidenceFilter,
    setRoadsData,
    loadingMsg,
    setLoadingMsg,
    routingMode,
    routePoints,
    routeComparisonStatus,
    startRouteSelection,
    clearRouteSelection,
    mapCenter,
  } = useAppStore();

  const handleFetchRoads = async () => {
    try {
      setLoadingMsg("Fetching local roads via OSM...");
      const data = await fetchLocalRoads(mapCenter.lat, mapCenter.lng);
      setRoadsData(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingMsg("");
    }
  };

  const handleComputeStatus = async () => {
    if (!roadsData) return;

    try {
      const visibleDisasters = filterDisasters(disasters, filters, confidenceFilter);
      setLoadingMsg("Computing road status from live disasters...");
      const analyzedData = await fetchRoadStatus({
        roads: roadsData,
        disasters: visibleDisasters.map((disaster) => ({
          type: disaster.type,
          latitude: disaster.latitude,
          longitude: disaster.longitude,
          severity: disaster.severity,
          confidence: disaster.confidence,
        })),
      });
      setRoadsData(analyzedData);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingMsg("");
    }
  };

  const hasBlocked = roadsData?.features?.some(
    (feature) => feature.properties.status === "blocked",
  );
  const hasRisky = roadsData?.features?.some(
    (feature) => feature.properties.status === "risky",
  );
  const isRouteLoading = routeComparisonStatus === "loading";

  const routeButtonLabel = routingMode
    ? routePoints.length === 1
      ? "Click Map for Destination..."
      : "Click Map for Source..."
    : "Find Safe Evacuation Route";

  return (
    <div className="flex flex-col gap-5 pt-4 border-t border-border mt-2">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          1. Data Acquisition
        </span>
        <button
          className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-zinc-800/80 hover:bg-zinc-700 text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-border"
          onClick={handleFetchRoads}
          disabled={!!loadingMsg || !!roadsData}
        >
          <Layers size={18} />
          {loadingMsg.includes("OSM") ? "Fetching..." : "Load Nearby Roads"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          2. Disaster Engine
        </span>
        <button
          className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] hover:shadow-[0_0_25px_rgba(37,99,235,0.6)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          onClick={handleComputeStatus}
          disabled={!roadsData || !!loadingMsg}
        >
          <AlertTriangle size={18} />
          {loadingMsg.includes("road status") ? "Updating..." : "Generate Road Overlay"}
        </button>
        {roadsData?.features?.length > 0 && (
          <div
            className={`rounded-xl border px-3 py-2 text-xs ${
              hasBlocked
                ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            {hasBlocked
              ? "Live disaster analysis marked nearby roads as blocked."
              : hasRisky
                ? "Live disaster analysis found risky roads but no fully blocked segments."
                : "Live disaster analysis found no blocked or risky roads in the current sampled network."}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          3. Action Plan
        </span>
        <button
          className={`flex items-center justify-center gap-2 w-full py-3 px-4 text-sm font-medium rounded-xl transition-all border ${
            routingMode
              ? "bg-blue-500/10 border-blue-500 text-blue-400"
              : "bg-zinc-800/80 border-border hover:bg-zinc-700 text-zinc-100"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          onClick={() => {
            if (routingMode) {
              clearRouteSelection();
              return;
            }

            startRouteSelection();
          }}
          disabled={!roadsData || !!loadingMsg || isRouteLoading}
        >
          <Navigation size={18} />
          {routeButtonLabel}
        </button>
      </div>
    </div>
  );
};

export default Controls;
