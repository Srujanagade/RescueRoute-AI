import React from "react";
import { Clock3 } from "lucide-react";
import useAppStore from "../store/useAppStore";
import {
  buildTimelineFromPreset,
  CUSTOM_TIMELINE_PRESET,
  formatTimelineLabel,
  formatTimelineWindow,
  getTimelineSliderIndex,
  TIMELINE_PRESET_OPTIONS,
} from "../utils/timeline";

const TimelineSlider = () => {
  const { timeline, setTimeline } = useAppStore();

  const handleSelectPreset = (preset) => {
    setTimeline(buildTimelineFromPreset(preset));
  };

  const sliderIndex = getTimelineSliderIndex(timeline);

  return (
    <div className="rounded-2xl border border-border bg-white/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Timeline
          </span>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
            <Clock3 size={16} className="text-blue-300" />
            <span>{formatTimelineLabel(timeline)}</span>
          </div>
        </div>
        {timeline.preset === CUSTOM_TIMELINE_PRESET && (
          <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200">
            Custom
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-zinc-400">{formatTimelineWindow(timeline)}</p>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          <span>Now</span>
          <span>Past 5 Years</span>
        </div>
        <input
          type="range"
          min="0"
          max={String(TIMELINE_PRESET_OPTIONS.length - 1)}
          step="1"
          value={sliderIndex}
          onChange={(event) => {
            const nextIndex = Number(event.target.value);
            const nextPreset = TIMELINE_PRESET_OPTIONS[nextIndex]?.value;
            if (nextPreset) {
              handleSelectPreset(nextPreset);
            }
          }}
          className="h-2 w-full cursor-pointer accent-blue-400"
          aria-label="Disaster timeline range"
        />
        <div className="mt-2 grid grid-cols-6 gap-2 text-center text-[11px] font-medium text-zinc-500">
          {TIMELINE_PRESET_OPTIONS.map((option) => (
            <span key={option.value}>{option.shortLabel}</span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {TIMELINE_PRESET_OPTIONS.map((option) => {
          const isActive = timeline.preset === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelectPreset(option.value)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                isActive
                  ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                  : "border-border bg-zinc-900/70 text-zinc-400"
              }`}
            >
              {option.shortLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TimelineSlider;
