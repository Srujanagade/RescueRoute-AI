import React from "react";
import {
  AlertTriangle,
  Loader2,
  MapPinned,
  Ruler,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import useAppStore from "../store/useAppStore";

const formatDuration = (seconds) => {
  const mins = Math.max(1, Math.round((Number(seconds) || 0) / 60));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
};

const formatDistance = (meters) => `${((Number(meters) || 0) / 1000).toFixed(1)} km`;

const getSafetyTone = (level) => {
  switch (String(level || "").toLowerCase()) {
    case "high":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
    case "moderate":
      return "border-sky-400/30 bg-sky-500/10 text-sky-200";
    case "guarded":
      return "border-amber-400/30 bg-amber-500/10 text-amber-200";
    default:
      return "border-rose-400/30 bg-rose-500/10 text-rose-200";
  }
};

const pluralize = (count, singular) => `${count} ${singular}${count === 1 ? "" : "s"}`;

const RouteComparisonPanel = () => {
  const {
    comparisonRoutes,
    routeComparisonStatus,
    routeComparisonError,
    selectedRouteType,
    routePoints,
    routingMode,
    source,
    destination,
    setSelectedRouteType,
  } = useAppStore(
    useShallow((state) => ({
      comparisonRoutes: state.comparisonRoutes,
      routeComparisonStatus: state.routeComparisonStatus,
      routeComparisonError: state.routeComparisonError,
      selectedRouteType: state.selectedRouteType,
      routePoints: state.routePoints,
      routingMode: state.routingMode,
      source: state.source,
      destination: state.destination,
      setSelectedRouteType: state.setSelectedRouteType,
    })),
  );

  const renderIdleState = () => {
    let message = "Pick a source and destination on the map or use route search to compare routes.";

    if (routingMode && routePoints.length === 0) {
      message = "First click sets the source point for the route comparison.";
    } else if (routingMode && routePoints.length === 1) {
      message = "Second click sets the destination and starts route comparison.";
    } else if (source && !destination) {
      message = "Source saved. Add a destination from search or the map to start route comparison.";
    } else if (!source && destination) {
      message = "Destination saved. Add a source from search or the map to start route comparison.";
    }

    return (
      <div className="rounded-2xl border border-border bg-white/5 px-4 py-3 text-sm text-zinc-400">
        {message}
      </div>
    );
  };

  const renderLoadingState = () => (
    <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
      <div className="flex items-center gap-2 font-medium">
        <Loader2 size={16} className="animate-spin" />
        Comparing OSRM alternatives against the active disaster timeline...
      </div>
    </div>
  );

  const renderErrorState = () => (
    <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">Route comparison failed</div>
          <div className="mt-1 text-rose-100/80">
            {routeComparisonError || "Try another destination or timeline window."}
          </div>
        </div>
      </div>
    </div>
  );

  if (routeComparisonStatus === "loading") {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Route Comparison
        </h3>
        {renderLoadingState()}
      </div>
    );
  }

  if (routeComparisonStatus === "error" && !comparisonRoutes) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Route Comparison
        </h3>
        {renderErrorState()}
      </div>
    );
  }

  if (!comparisonRoutes?.fastest || !comparisonRoutes?.safest) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Route Comparison
        </h3>
        {renderIdleState()}
      </div>
    );
  }

  const { fastest, safest, identical, message, status } = comparisonRoutes;
  const durationGapMinutes = Math.max(0, Math.round((safest.duration - fastest.duration) / 60));
  const hazardGap = Math.max(0, (fastest.hazard_hits || 0) - (safest.hazard_hits || 0));

  const fastestExplanation = identical
    ? status === "fallback"
      ? "OSRM exposed only one meaningful route here."
      : "Also the lowest hazard exposure in this timeline."
    : durationGapMinutes > 0
      ? `${durationGapMinutes} min faster than the safest option.`
      : "Shortest available driving time.";

  const safestExplanation = identical
    ? "Also the quickest available route."
    : hazardGap > 0
      ? `${pluralize(hazardGap, "fewer nearby hazard")} than the fastest route.`
      : "Lower hazard exposure across the selected timeline.";

  const cards = [
    {
      key: "fastest",
      title: "Fastest",
      route: fastest,
      accent: "red",
      explanation: fastestExplanation,
    },
    {
      key: "safest",
      title: "Safest",
      route: safest,
      accent: "green",
      explanation: safestExplanation,
    },
  ];

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Route Comparison
        </h3>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
          {comparisonRoutes.meaningful_route_count} option
          {comparisonRoutes.meaningful_route_count === 1 ? "" : "s"}
        </span>
      </div>

      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${
          status === "fallback"
            ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
            : identical
              ? "border-blue-400/25 bg-blue-500/10 text-blue-100"
              : "border-border bg-white/5 text-zinc-300"
        }`}
      >
        <div className="flex items-start gap-2">
          <MapPinned size={16} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      </div>

      {routeComparisonStatus === "error" && renderErrorState()}

      <div className="grid grid-cols-2 gap-3">
        {cards.map(({ key, title, route, accent, explanation }) => {
          const isSelected = selectedRouteType === key;
          const accentClass =
            accent === "red"
              ? isSelected
                ? "border-red-500/60 bg-red-500/15 ring-1 ring-red-500/40"
                : "border-slate-700/50 bg-slate-800/40 hover:bg-slate-800/60"
              : isSelected
                ? "border-green-500/60 bg-green-500/15 ring-1 ring-green-500/40"
                : "border-slate-700/50 bg-slate-800/40 hover:bg-slate-800/60";

          const iconClass = accent === "red" ? "text-red-400" : "text-green-400";
          const icon =
            key === "fastest" ? (
              <Timer size={14} className={iconClass} />
            ) : (
              <ShieldCheck size={14} className={iconClass} />
            );

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedRouteType(key)}
              className={`flex flex-col gap-3 rounded-xl border p-3 text-left transition-all ${accentClass}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-bold uppercase ${iconClass}`}>{title}</span>
                {icon}
              </div>

              <div className="space-y-1">
                <div className="text-lg font-bold text-slate-100">
                  {formatDuration(route.duration)}
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <Ruler size={10} />
                  {formatDistance(route.distance)}
                </div>
              </div>

              <span
                className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${getSafetyTone(
                  route.safety_level,
                )}`}
              >
                {route.safety_level} safety
              </span>

              <div className="text-xs text-slate-300">{explanation}</div>

              <div className="border-t border-slate-700/50 pt-2 text-[11px] text-slate-400">
                {route.hazard_hits > 0
                  ? `${pluralize(route.hazard_hits, "nearby hazard")} in view`
                  : "No nearby hazards in the selected timeline"}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-center text-[10px] italic text-slate-500">
        Select a card to emphasize that route on the map.
      </p>
    </div>
  );
};

export default RouteComparisonPanel;
