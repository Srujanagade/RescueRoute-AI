import { create } from "zustand";
import {
  DEFAULT_CONFIDENCE_FILTERS,
  DEFAULT_DISASTER_FILTERS,
  normalizeConfidence,
  normalizeDisasterType,
} from "../utils/disasters";
import {
  buildTimelineFromPreset,
  DEFAULT_TIMELINE_PRESET,
  normalizeTimeline,
} from "../utils/timeline";

const useAppStore = create((set, get) => ({
  roadsData: null,
  routeData: null,
  comparisonRoutes: null,
  selectedRouteType: "fastest",
  disasters: [],
  selectedDisaster: null,
  disasterSummary: "",
  disasterSummaryFallback: false,
  disasterSummaryProvider: "fallback",
  disasterSummaryCache: {},

  loadingMsg: "",
  routingMode: false,
  routeComparisonStatus: "idle",
  routeComparisonError: "",
  loadingSummary: false,
  disasterSummaryError: "",
  disasterLoading: false,
  disasterError: "",
  disasterLastUpdated: null,
  timeline: buildTimelineFromPreset(DEFAULT_TIMELINE_PRESET),
  filters: DEFAULT_DISASTER_FILTERS,
  confidenceFilter: DEFAULT_CONFIDENCE_FILTERS,
  showWarningBanner: true,

  userLocation: null,
  source: null,
  destination: null,
  routePoints: [],
  mapCenter: { lng: 78.4744, lat: 17.3753, zoom: 13 },
  mapBounds: null,

  setRoadsData: (data) => set({ roadsData: data }),
  setRouteData: (data) => set({ routeData: data }),
  setComparisonRoutes: (routes) =>
    set({
      comparisonRoutes: routes,
      routeComparisonStatus: routes ? "success" : "idle",
      routeComparisonError: "",
    }),
  setSelectedRouteType: (type) => set({ selectedRouteType: type }),
  setDisasters: (data) => set({ disasters: Array.isArray(data) ? data : [] }),
  setSelectedDisaster: (disaster) => set({ selectedDisaster: disaster }),
  clearSelectedDisaster: () =>
    set({
      selectedDisaster: null,
      disasterSummary: "",
      disasterSummaryFallback: false,
      disasterSummaryProvider: "fallback",
      loadingSummary: false,
      disasterSummaryError: "",
    }),
  setDisasterSummary: (summary, options = {}) =>
    set({
      disasterSummary: summary || "",
      disasterSummaryFallback: Boolean(options.usedFallback),
      disasterSummaryProvider: options.provider || "fallback",
      loadingSummary: false,
    }),
  setLoadingSummary: (loading) => set({ loadingSummary: loading }),
  setDisasterSummaryError: (message) => set({ disasterSummaryError: message || "" }),
  cacheDisasterSummary: (key, payload) =>
    set((state) => ({
      disasterSummaryCache: {
        ...state.disasterSummaryCache,
        [key]: payload,
      },
    })),
  setLoadingMsg: (msg) => set({ loadingMsg: msg }),
  setRoutingMode: (mode) => set({ routingMode: mode }),
  setRouteComparisonStatus: (status) => set({ routeComparisonStatus: status }),
  setRouteComparisonError: (message) =>
    set({
      routeComparisonError: message,
      routeComparisonStatus: message ? "error" : get().routeComparisonStatus,
    }),
  setDisasterLoading: (loading) => set({ disasterLoading: loading }),
  setDisasterError: (message) => set({ disasterError: message }),
  setDisasterLastUpdated: (value) => set({ disasterLastUpdated: value }),
  setTimeline: (timeline) =>
    set((state) => ({
      timeline: normalizeTimeline(timeline, state.timeline),
    })),
  setFilters: (filters) =>
    set((state) => ({
      filters: {
        ...state.filters,
        ...filters,
        types: Array.isArray(filters?.types)
          ? [...new Set(filters.types.map((type) => normalizeDisasterType(type)))]
          : state.filters.types,
      },
    })),
  toggleFilterType: (type) =>
    set((state) => {
      const normalizedType = normalizeDisasterType(type);
      const currentTypes = state.filters.types;
      const nextTypes = currentTypes.includes(normalizedType)
        ? currentTypes.filter((value) => value !== normalizedType)
        : [...currentTypes, normalizedType];

      return {
        filters: {
          ...state.filters,
          types: nextTypes,
        },
      };
    }),
  setConfidenceFilter: (levels) =>
    set({
      confidenceFilter: Array.isArray(levels)
        ? [...new Set(levels.map((level) => normalizeConfidence(level)))]
        : DEFAULT_CONFIDENCE_FILTERS,
    }),
  toggleConfidence: (level) =>
    set((state) => {
      const normalizedLevel = normalizeConfidence(level);
      const nextLevels = state.confidenceFilter.includes(normalizedLevel)
        ? state.confidenceFilter.filter((value) => value !== normalizedLevel)
        : [...state.confidenceFilter, normalizedLevel];

      return { confidenceFilter: nextLevels };
    }),
  setShowWarningBanner: (show) => set({ showWarningBanner: Boolean(show) }),
  setUserLocation: (loc) => set({ userLocation: loc }),
  setSource: (src) => set({ source: src }),
  setDestination: (dest) => set({ destination: dest }),
  setRoutePoints: (points) => set({ routePoints: points }),
  setMapCenter: (center) => set({ mapCenter: center }),
  setMapBounds: (bounds) => set({ mapBounds: bounds }),
  startRouteSelection: () =>
    set({
      source: null,
      destination: null,
      routingMode: true,
      routeData: null,
      routePoints: [],
      comparisonRoutes: null,
      selectedRouteType: "fastest",
      routeComparisonStatus: "idle",
      routeComparisonError: "",
      loadingMsg: "",
    }),
  clearRouteSelection: () =>
    set({
      source: null,
      destination: null,
      routingMode: false,
      routeData: null,
      routePoints: [],
      comparisonRoutes: null,
      selectedRouteType: "fastest",
      routeComparisonStatus: "idle",
      routeComparisonError: "",
      loadingMsg: "",
    }),
  clearRoutePoints: () => set({ source: null, destination: null, routePoints: [] }),
  resetAll: () =>
    set({
      roadsData: null,
      routeData: null,
      comparisonRoutes: null,
      selectedRouteType: "fastest",
      selectedDisaster: null,
      disasterSummary: "",
      disasterSummaryFallback: false,
      disasterSummaryProvider: "fallback",
      source: null,
      destination: null,
      routingMode: false,
      routeComparisonStatus: "idle",
      routeComparisonError: "",
      loadingSummary: false,
      disasterSummaryError: "",
      routePoints: [],
      loadingMsg: "",
    }),
}));

export default useAppStore;
