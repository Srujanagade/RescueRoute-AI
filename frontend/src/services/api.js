import axios from "axios";

const BACKEND_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const API_BASE = `${BACKEND_BASE}/api`;

export const fetchLocalRoads = async (lat, lon, radius = 800) => {
  const res = await axios.get(`${API_BASE}/roads`, {
    params: { lat, lon, radius },
  });
  return res.data;
};

export const analyzeDisaster = async (roadsData) => {
  const res = await axios.post(`${API_BASE}/analyze`, { roads: roadsData });
  return res.data;
};

export const fetchRoadStatus = async (payload) => {
  const res = await axios.post(`${API_BASE}/roads/status`, payload);
  return res.data;
};

export const fetchOptimalRoute = async (startLngLat, endLngLat) => {
  const res = await axios.get(`${API_BASE}/route`, {
    params: {
      start_lat: startLngLat[1],
      start_lon: startLngLat[0],
      end_lat: endLngLat[1],
      end_lon: endLngLat[0],
    },
  });
  return res.data;
};

export const fetchRouteComparison = async (startLngLat, endLngLat, timeline) => {
  const res = await axios.post(`${API_BASE}/route/compare`, {
    source: { lat: startLngLat[1], lng: startLngLat[0] },
    destination: { lat: endLngLat[1], lng: endLngLat[0] },
    from: timeline?.from,
    to: timeline?.to,
  });
  return res.data;
};

export const fetchDisasterSummary = async (disaster) => {
  const res = await axios.post(`${API_BASE}/disaster-summary`, {
    disaster,
  });
  return res.data;
};

export const fetchDisasters = async (bounds, timeline) => {
  const res = await axios.get(`${BACKEND_BASE}/disasters`, {
    params: {
      ...(bounds || {}),
      ...(timeline?.from && timeline?.to
        ? {
            from: timeline.from,
            to: timeline.to,
          }
        : {}),
    },
  });
  return res.data;
};
