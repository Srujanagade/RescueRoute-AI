import React from "react";
import { MapPin, Loader2 } from "lucide-react";
import useAppStore from "../store/useAppStore";
import Controls from "./Controls";
import RouteComparisonPanel from "./RouteComparisonPanel";
import DisasterPanel from "./DisasterPanel";
import Legend from "./Legend";
import SearchBox from "./SearchBox";
import WarningBanner from "./WarningBanner";

const Sidebar = () => {
  const { mapCenter, userLocation, loadingMsg, showWarningBanner } = useAppStore();

  return (
    <div className="absolute top-6 left-6 w-[360px] max-h-[calc(100vh-48px)] flex flex-col bg-panel backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-6 z-10 overflow-y-auto">
      {showWarningBanner && (
        <div className="sticky top-0 z-20 -mx-2 mb-4">
          <WarningBanner />
        </div>
      )}

      <div className="flex flex-col mb-5">
        <h1 className="text-2xl font-bold bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent mb-1">
          Disaster AI
        </h1>
        <p className="text-xs text-zinc-400 font-medium">
          Road Damage Assessment &amp; Safe Routing
        </p>
      </div>

      <div className="bg-white/5 border-l-4 border-blue-500 p-3 rounded-lg flex flex-col gap-1">
        <div className="flex items-center gap-2 text-zinc-200">
          <MapPin size={16} className="text-blue-400" />
          <span className="text-sm font-semibold">Live Location</span>
        </div>
        <div className="text-xs text-zinc-400 font-mono tracking-tight">
          {userLocation
            ? `${userLocation.lng.toFixed(4)} deg, ${userLocation.lat.toFixed(4)} deg`
            : "Browser geolocation unavailable or not granted yet"}
        </div>
        <div className="text-[11px] text-zinc-500 font-mono tracking-tight">
          Viewport: {mapCenter.lng} deg, {mapCenter.lat} deg | Zoom: {mapCenter.zoom}
        </div>
      </div>

      <SearchBox />
      <DisasterPanel />
      <Controls />
      <RouteComparisonPanel />
      <Legend />

      {loadingMsg && (
        <div className="mt-4 py-2 border-t border-border flex items-center justify-center gap-2 text-blue-400">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm font-medium animate-pulse">{loadingMsg}</span>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
