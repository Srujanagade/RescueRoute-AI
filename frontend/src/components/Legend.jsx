import React from "react";
import useAppStore from "../store/useAppStore";
import {
  DISASTER_COLORS,
  DISASTER_CONFIDENCE_OPTIONS,
  DISASTER_TYPE_OPTIONS,
  formatConfidenceLabel,
  getConfidenceStyle,
} from "../utils/disasters";

const Legend = () => {
  const { roadsData, routeData, comparisonRoutes, disasters, resetAll, loadingMsg } =
    useAppStore();

  if (!roadsData && !routeData && !comparisonRoutes && !disasters.length) return null;

  return (
    <div className="flex flex-col gap-4 mt-2 border-t border-border pt-4">
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
        Legend
      </span>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-sm text-zinc-300">
          <div className="w-4 h-4 rounded-[4px] bg-emerald-500"></div>
          <span>Safe Road</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-300">
          <div className="w-4 h-4 rounded-[4px] bg-yellow-400"></div>
          <span>Risky Road</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-300">
          <div className="w-4 h-4 rounded-[4px] bg-red-500"></div>
          <span>Blocked Road</span>
        </div>
        {comparisonRoutes?.fastest && (
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <div className="w-4 h-4 rounded-[4px] bg-red-500"></div>
            <span>Fastest Route</span>
          </div>
        )}
        {comparisonRoutes?.safest && (
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <div className="flex w-4 items-center justify-center">
              <div className="h-1 w-4 rounded-full border border-dashed border-emerald-400" />
            </div>
            <span>Safest Route</span>
          </div>
        )}
        {!comparisonRoutes?.fastest && routeData && (
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <div className="w-4 h-4 rounded-[4px] bg-yellow-400"></div>
            <span>Safe Evacuation Route</span>
          </div>
        )}
        {disasters.length > 0 && (
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white">
              12
            </div>
            <span>Clustered Disaster Events</span>
          </div>
        )}
        {DISASTER_TYPE_OPTIONS.map((option) => (
          <div key={option.value} className="flex items-center gap-3 text-sm text-zinc-300">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: DISASTER_COLORS[option.value] }}
            ></div>
            <span>{option.label} Incident</span>
          </div>
        ))}
        {DISASTER_CONFIDENCE_OPTIONS.map((option) => {
          const style = getConfidenceStyle(option.value);

          return (
            <div key={option.value} className="flex items-center gap-3 text-sm text-zinc-300">
              <div
                className="h-4 w-4 rounded-full"
                style={{
                  backgroundColor: style.strokeColor,
                  opacity: style.opacity,
                  border: style.border,
                }}
              />
              <span>{formatConfidenceLabel(option.value)} Confidence</span>
            </div>
          );
        })}
        {disasters.length > 0 && (
          <div className="rounded-xl border border-border bg-white/5 px-3 py-2 text-xs text-zinc-400">
            Larger disaster dots indicate higher severity, and brighter outlines indicate higher confidence.
          </div>
        )}
      </div>

      <button
        className="w-full py-2.5 px-4 mt-2 bg-zinc-800 hover:bg-zinc-700 border border-border text-zinc-300 text-sm font-medium rounded-xl transition-all"
        onClick={resetAll}
        disabled={!!loadingMsg}
      >
        Reset Roads & Route
      </button>
    </div>
  );
};

export default Legend;
