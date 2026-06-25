import React, { useEffect, useState } from "react";
import { Crosshair, Loader2, MapPin, Search, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import useAppStore from "../store/useAppStore";
import { searchPlaces } from "../services/locationService";

const SEARCH_DEBOUNCE_MS = 300;

const formatLocationLabel = (place) => {
  if (!place) {
    return "";
  }

  if (typeof place.name === "string" && place.name.trim()) {
    return place.name;
  }

  if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    return `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
  }

  return "";
};

const normalizePlace = (place, fallbackName) => {
  if (!place) {
    return null;
  }

  const lat = Number(place.lat);
  const lng = Number(place.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    name: place.name || fallbackName,
    lat,
    lng,
  };
};

const buildRoutePoints = (source, destination) => {
  if (source && destination) {
    return [
      [source.lng, source.lat],
      [destination.lng, destination.lat],
    ];
  }

  if (source) {
    return [[source.lng, source.lat]];
  }

  return [];
};

const LocationInput = ({
  id,
  label,
  placeholder,
  selectedPlace,
  onSelect,
  onClear,
  userLocation,
  showUseMyLocation = false,
}) => {
  const [query, setQuery] = useState(formatLocationLabel(selectedPlace));
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setQuery(formatLocationLabel(selectedPlace));
  }, [selectedPlace]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    const selectedLabel = formatLocationLabel(selectedPlace).trim();

    if (!trimmedQuery || trimmedQuery === selectedLabel) {
      setResults([]);
      setIsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);

      try {
        const places = await searchPlaces(trimmedQuery, controller.signal);
        setResults(places);
        setIsOpen(true);
      } catch (error) {
        if (error.name !== "CanceledError" && error.name !== "AbortError") {
          console.error("Location search failed:", error);
          setResults([]);
        }
      } finally {
        setIsLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query, selectedPlace]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </label>
      <div className="relative">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-zinc-950/70 px-3 py-2.5">
          <Search size={16} className="shrink-0 text-zinc-500" />
          <input
            id={id}
            type="text"
            value={query}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => {
              if (results.length > 0) {
                setIsOpen(true);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          {isLoading && <Loader2 size={15} className="shrink-0 animate-spin text-blue-400" />}
          {!isLoading && query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                setIsOpen(false);
                onClear();
              }}
              className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
              aria-label={`Clear ${label.toLowerCase()}`}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {isOpen && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-zinc-950/95 shadow-2xl backdrop-blur-xl">
            <ul className="flex max-h-72 flex-col">
              {results.map((place) => (
                <li key={`${place.name}-${place.lat}-${place.lng}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setResults([]);
                      setIsOpen(false);
                      onSelect(place);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                  >
                    <MapPin size={15} className="mt-0.5 shrink-0 text-blue-300" />
                    <span className="text-sm text-zinc-200">{place.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showUseMyLocation && (
        <button
          type="button"
          onClick={() => {
            const nextPlace = normalizePlace(
              {
                ...userLocation,
                name: "Current location",
              },
              "Current location",
            );

            if (!nextPlace) {
              return;
            }

            setResults([]);
            setIsOpen(false);
            onSelect(nextPlace);
          }}
          disabled={!userLocation}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-zinc-500"
        >
          <Crosshair size={14} />
          Use My Location
        </button>
      )}
    </div>
  );
};

const SearchBox = () => {
  const {
    userLocation,
    source,
    destination,
    setSource,
    setDestination,
    setRoutePoints,
    setRouteData,
    setComparisonRoutes,
    setRouteComparisonStatus,
    setRouteComparisonError,
    setSelectedRouteType,
    setRoutingMode,
  } = useAppStore(
    useShallow((state) => ({
      userLocation: state.userLocation,
      source: state.source,
      destination: state.destination,
      setSource: state.setSource,
      setDestination: state.setDestination,
      setRoutePoints: state.setRoutePoints,
      setRouteData: state.setRouteData,
      setComparisonRoutes: state.setComparisonRoutes,
      setRouteComparisonStatus: state.setRouteComparisonStatus,
      setRouteComparisonError: state.setRouteComparisonError,
      setSelectedRouteType: state.setSelectedRouteType,
      setRoutingMode: state.setRoutingMode,
    })),
  );

  const syncRouteSelection = (nextSource, nextDestination) => {
    setSource(nextSource);
    setDestination(nextDestination);
    setRoutingMode(false);
    setRouteData(null);
    setComparisonRoutes(null);
    setRouteComparisonStatus("idle");
    setRouteComparisonError("");
    setSelectedRouteType("fastest");
    setRoutePoints(buildRoutePoints(nextSource, nextDestination));
  };

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Route Search
          </span>
          <p className="mt-1 text-sm text-zinc-300">
            Search or pin a source and destination. Map clicks still work when route selection mode is active.
          </p>
        </div>
      </div>

      <LocationInput
        id="route-source"
        label="Source"
        placeholder="Search starting point"
        selectedPlace={source}
        onSelect={(place) => {
          const nextSource = normalizePlace(place, "Pinned source");
          syncRouteSelection(nextSource, destination);
        }}
        onClear={() => {
          syncRouteSelection(null, destination);
        }}
        userLocation={userLocation}
        showUseMyLocation
      />

      <LocationInput
        id="route-destination"
        label="Destination"
        placeholder="Search destination"
        selectedPlace={destination}
        onSelect={(place) => {
          const nextDestination = normalizePlace(place, "Pinned destination");
          syncRouteSelection(source, nextDestination);
        }}
        onClear={() => {
          syncRouteSelection(source, null);
        }}
      />
    </div>
  );
};

export default SearchBox;
