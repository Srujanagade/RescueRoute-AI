import React from "react";
import { AlertTriangle } from "lucide-react";

export default function WarningBanner() {
  return (
    <div className="rounded-2xl border border-yellow-400/35 bg-yellow-500/15 px-3 py-2 text-yellow-100 shadow-lg backdrop-blur-sm">
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-yellow-300" />
        <span>
          Data may not be fully real-time. Some routes and disasters are estimates, so use
          the confidence labels to gauge reliability.
        </span>
      </div>
    </div>
  );
}
