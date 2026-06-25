# Disaster Response AI

A FastAPI + React disaster navigation project that combines live disaster feeds, map-based road risk analysis, and safety-aware route comparison.

## Implemented Features

1. Real disaster data integration from ReliefWeb, NASA FIRMS, and OpenWeather, normalized into a single backend format and exposed through `/disasters` and `/api/disasters`.
2. Timeline filtering from the present back to five years with URL-synced frontend state and backend `from` / `to` filtering.
3. Disaster visualization on the map with clustered markers, type-based colors, confidence styling, and click-to-open disaster details.
4. Rule-based road status engine that marks roads as `blocked`, `risky`, or `safe` from nearby disaster impact radii.
5. Blocked-road overlay rendered directly on the map using GeoJSON styling.
6. Smart routing upgrade that excludes blocked roads and penalizes risky roads when building the safer route.
7. Route comparison mode that shows the fastest route and the safest route together.
8. Disaster detail panel with LLM-generated summaries plus local fallback summaries.
9. Location detection and destination search using browser geolocation and Nominatim autocomplete.
10. Confidence and warning system with confidence labels and a persistent caution banner.

## Tech Stack

- Frontend: React, Vite, Zustand, Mapbox GL
- Backend: FastAPI
- External data and routing: ReliefWeb, NASA FIRMS, OpenWeather, Overpass, OSRM, Nominatim

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

The API runs at `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The UI typically runs at `http://localhost:5173`.

## Required Environment Variables

Backend:

- `RELIEFWEB_APPNAME`
- `NASA_API_KEY`
- `OPENWEATHER_API_KEY`

Frontend:

- `VITE_MAPBOX_TOKEN`
- `VITE_API_BASE` (optional)

## Verification

- Backend syntax check: `python -m compileall .`
- Frontend lint: `npm run lint`
- Frontend production build: `npm run build`
