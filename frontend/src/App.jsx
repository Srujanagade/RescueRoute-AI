import React, { useEffect, useState } from "react";
import DisasterInsightCard from "./components/DisasterInsightCard";
import MapComponent from "./components/MapComponent";
import Sidebar from "./components/Sidebar";
import useAppStore from "./store/useAppStore";
import { fetchDisasters } from "./services/api";
import { buildTimelineSearch, parseTimelineFromSearch } from "./utils/timeline";

const DISASTER_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const TIMELINE_DEBOUNCE_MS = 300;
const DISASTER_RESPONSE_CACHE = new Map();

const buildBoundsCacheKey = (bounds) => {
  if (!bounds) {
    return "viewport:default";
  }

  return [
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north,
  ]
    .map((value) => Number(value).toFixed(4))
    .join(":");
};

const buildDisasterCacheKey = (bounds, timeline) =>
  `${timeline?.from ?? ""}-${timeline?.to ?? ""}:${buildBoundsCacheKey(bounds)}`;

function App() {
  const {
    mapBounds,
    timeline,
    setTimeline,
    setDisasters,
    setDisasterLoading,
    setDisasterError,
    setDisasterLastUpdated,
  } = useAppStore();
  const [isTimelineHydrated, setIsTimelineHydrated] = useState(false);
  const [debouncedTimeline, setDebouncedTimeline] = useState(timeline);

  useEffect(() => {
    const urlTimeline = parseTimelineFromSearch(window.location.search);
    if (urlTimeline) {
      setTimeline(urlTimeline);
      setDebouncedTimeline(urlTimeline);
    }

    setIsTimelineHydrated(true);
  }, [setTimeline]);

  useEffect(() => {
    if (!isTimelineHydrated) return;

    const timeoutId = window.setTimeout(() => {
      setDebouncedTimeline(timeline);
    }, TIMELINE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isTimelineHydrated, timeline]);

  useEffect(() => {
    if (!isTimelineHydrated) return;

    const nextSearch = buildTimelineSearch(timeline);
    const nextUrl = `${window.location.pathname}?${nextSearch}`;
    if (`?${nextSearch}` !== window.location.search) {
      window.history.replaceState({}, "", nextUrl);
    }
  }, [isTimelineHydrated, timeline]);

  useEffect(() => {
    if (!mapBounds || !isTimelineHydrated) return;

    let isMounted = true;
    let isFetching = false;

    const syncDisasters = async (forceRefresh = false) => {
      if (isFetching) return;

      const cacheKey = buildDisasterCacheKey(mapBounds, debouncedTimeline);
      const cachedEntry = DISASTER_RESPONSE_CACHE.get(cacheKey);
      if (
        !forceRefresh &&
        cachedEntry &&
        Date.now() - cachedEntry.cachedAt < DISASTER_REFRESH_INTERVAL_MS
      ) {
        setDisasters(cachedEntry.data);
        setDisasterError("");
        setDisasterLastUpdated(cachedEntry.fetchedAt);
        setDisasterLoading(false);
        return;
      }

      isFetching = true;
      setDisasterLoading(true);

      try {
        const data = await fetchDisasters(mapBounds, debouncedTimeline);
        if (!isMounted) return;

        const normalizedData = Array.isArray(data) ? data : [];
        const fetchedAt = new Date().toISOString();

        DISASTER_RESPONSE_CACHE.set(cacheKey, {
          cachedAt: Date.now(),
          fetchedAt,
          data: normalizedData,
        });

        setDisasters(normalizedData);
        setDisasterError("");
        setDisasterLastUpdated(fetchedAt);
      } catch (error) {
        console.error(error);
        if (!isMounted) return;

        setDisasterError(
          "Some live feeds could not be refreshed. Showing the latest successful results.",
        );
      } finally {
        isFetching = false;
        if (isMounted) {
          setDisasterLoading(false);
        }
      }
    };

    void syncDisasters();
    const intervalId = window.setInterval(() => {
      void syncDisasters(true);
    }, DISASTER_REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [
    debouncedTimeline,
    isTimelineHydrated,
    mapBounds,
    setDisasters,
    setDisasterError,
    setDisasterLastUpdated,
    setDisasterLoading,
  ]);

  return (
    <>
      <MapComponent />
      <Sidebar />
      <DisasterInsightCard />
    </>
  );
}

export default App;
