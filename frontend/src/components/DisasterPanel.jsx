import React from "react";
import { AlertTriangle, Radio, RefreshCw } from "lucide-react";
import useAppStore from "../store/useAppStore";
import TimelineSlider from "./TimelineSlider";
import {
  DISASTER_COLORS,
  DISASTER_CONFIDENCE_OPTIONS,
  DISASTER_TYPE_OPTIONS,
  filterDisasters,
  formatConfidenceLabel,
  getConfidenceStyle,
} from "../utils/disasters";
import { formatTimelineLabel } from "../utils/timeline";

const DisasterPanel = () => {
  const {
    disasters,
    disasterLoading,
    disasterError,
    disasterLastUpdated,
    filters,
    confidenceFilter,
    timeline,
    toggleFilterType,
    toggleConfidence,
  } = useAppStore();

  const visibleDisasters = filterDisasters(disasters, filters, confidenceFilter);

  const lastUpdatedLabel = disasterLastUpdated
    ? new Date(disasterLastUpdated).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Waiting for first sync";

  return (
    <div className="mt-5 border-t border-border pt-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Live Disaster Feed
          </span>
          <p className="mt-1 text-sm text-zinc-300">
            Real-time incidents are refreshed every 3 minutes for the active
            viewport and timeline.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
          <Radio size={12} />
          Live
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-white/5 p-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Visible Events
          </div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {visibleDisasters.length}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-white/5 p-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Last Sync
          </div>
          <div className="mt-2 text-sm font-semibold text-white">
            {lastUpdatedLabel}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white/5 p-3 text-sm">
        <div className="flex items-center gap-2 text-zinc-200">
          <RefreshCw
            size={16}
            className={disasterLoading ? "animate-spin text-blue-400" : "text-zinc-400"}
          />
          <span className="font-medium">
            {disasterLoading
              ? "Syncing ReliefWeb, FIRMS, and weather feeds..."
              : "Feed synced for the current viewport and timeline."}
          </span>
        </div>
        {disasterError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{disasterError}</span>
          </div>
        )}
      </div>

      <TimelineSlider />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Disaster Types
          </span>
          <span className="text-[11px] font-medium text-zinc-500">
            {filters.types.length}/{DISASTER_TYPE_OPTIONS.length} active
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DISASTER_TYPE_OPTIONS.map((option) => {
            const isActive = filters.types.includes(option.value);

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleFilterType(option.value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-all ${
                  isActive
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-border bg-zinc-900/70 text-zinc-500"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: DISASTER_COLORS[option.value] }}
                />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Confidence
          </span>
          <span className="text-[11px] font-medium text-zinc-500">
            {confidenceFilter.length}/{DISASTER_CONFIDENCE_OPTIONS.length} active
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DISASTER_CONFIDENCE_OPTIONS.map((option) => {
            const isActive = confidenceFilter.includes(option.value);
            const style = getConfidenceStyle(option.value);

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleConfidence(option.value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-all ${
                  isActive
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-border bg-zinc-900/70 text-zinc-500"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: style.strokeColor,
                    opacity: style.opacity,
                    border: style.border,
                  }}
                />
                {formatConfidenceLabel(option.value)}
              </button>
            );
          })}
        </div>
      </div>

      {!disasterLoading && visibleDisasters.length === 0 && (
        <div className="rounded-2xl border border-border bg-zinc-950/60 px-4 py-3 text-sm text-zinc-400">
          No disasters found for {formatTimelineLabel(timeline).toLowerCase()} in the
          current map view.
        </div>
      )}
    </div>
  );
};

export default DisasterPanel;
