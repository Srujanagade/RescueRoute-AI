import React from "react";
import {
  Brain,
  Clock3,
  MapPin,
  TriangleAlert,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import useAppStore from "../store/useAppStore";
import {
  formatConfidenceLabel,
  formatDisasterTimestamp,
  formatDisasterType,
  getSeverityLabel,
} from "../utils/disasters";

const DisasterInsightCard = () => {
  const {
    selectedDisaster,
    disasterSummary,
    disasterSummaryFallback,
    disasterSummaryProvider,
    disasterSummaryError,
    loadingSummary,
    clearSelectedDisaster,
  } = useAppStore(
    useShallow((state) => ({
      selectedDisaster: state.selectedDisaster,
      disasterSummary: state.disasterSummary,
      disasterSummaryFallback: state.disasterSummaryFallback,
      disasterSummaryProvider: state.disasterSummaryProvider,
      disasterSummaryError: state.disasterSummaryError,
      loadingSummary: state.loadingSummary,
      clearSelectedDisaster: state.clearSelectedDisaster,
    })),
  );

  if (!selectedDisaster) {
    return null;
  }

  const severityLabel = getSeverityLabel(selectedDisaster.severity);
  const isFallback = disasterSummaryFallback || Boolean(disasterSummaryError);

  return (
    <aside className="insight-card-enter absolute right-4 top-4 z-20 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-white/12 bg-slate-950/88 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl sm:right-6 sm:top-6">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_60%),linear-gradient(160deg,rgba(15,23,42,0.96),rgba(15,23,42,0.88))] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
              <Brain size={14} />
              AI Disaster Insight
            </div>
            <h2 className="mt-2 text-lg font-semibold text-white">
              {selectedDisaster.title || formatDisasterType(selectedDisaster.type)}
            </h2>
          </div>
          <button
            type="button"
            onClick={clearSelectedDisaster}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close disaster insight panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex max-h-[calc(100vh-120px)] flex-col gap-4 overflow-y-auto px-5 py-4">
        {isFallback && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span>
              {disasterSummaryError || "Unable to generate insights. Showing raw data."}
            </span>
          </div>
        )}

        <section className="rounded-2xl border border-cyan-400/15 bg-cyan-500/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-cyan-100">AI Summary</div>
            <span className="rounded-full border border-cyan-300/20 bg-slate-950/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100/75">
              {isFallback ? "Fallback" : disasterSummaryProvider}
            </span>
          </div>
          <div className="mt-3 text-sm leading-6 text-slate-100">
            {loadingSummary ? (
              <div className="space-y-2">
                <div className="text-cyan-50">Generating insights...</div>
                <div className="h-3 w-full rounded-full bg-white/10" />
                <div className="h-3 w-11/12 rounded-full bg-white/10" />
                <div className="h-3 w-9/12 rounded-full bg-white/10" />
              </div>
            ) : (
              disasterSummary
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 text-sm text-slate-300">
          <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              <MapPin size={14} />
              Location
            </div>
            <div className="mt-2 text-sm text-white">
              {selectedDisaster.location || "Location not available"}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Type
              </div>
              <div className="mt-2 text-sm text-white">
                {formatDisasterType(selectedDisaster.type)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Severity
              </div>
              <div className="mt-2 text-sm text-white">
                {severityLabel}
                {Number.isFinite(Number(selectedDisaster.severity))
                  ? ` (${Number(selectedDisaster.severity).toFixed(1)})`
                  : ""}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Confidence
            </div>
            <div className="mt-2 text-sm text-white">
              {formatConfidenceLabel(selectedDisaster.confidence)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              <Clock3 size={14} />
              Time
            </div>
            <div className="mt-2 text-sm text-white">
              {formatDisasterTimestamp(selectedDisaster.timestamp)}
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
};

export default DisasterInsightCard;
