"""Quick test script for all 3 API endpoints."""
import requests
import json

BASE = "http://localhost:8000/api"

# 1. Test /roads
print("=" * 50)
print("TEST 1: GET /api/roads")
print("=" * 50)
r = requests.get(f"{BASE}/roads", params={"lat": 17.3753, "lon": 78.4744})
print(f"Status: {r.status_code}")
roads_data = r.json()
num_features = len(roads_data.get("features", []))
print(f"Road features returned: {num_features}")
if num_features > 0:
    print(f"Sample feature: {json.dumps(roads_data['features'][0], indent=2)[:300]}")

# 2. Test /analyze (AI satellite analysis)
print("\n" + "=" * 50)
print("TEST 2: POST /api/analyze")
print("=" * 50)
r2 = requests.post(f"{BASE}/analyze", json={"roads": roads_data})
print(f"Status: {r2.status_code}")
analyzed = r2.json()
if "features" in analyzed:
    blocked = sum(1 for f in analyzed["features"] if f["properties"].get("status") == "blocked")
    accessible = sum(1 for f in analyzed["features"] if f["properties"].get("status") == "accessible")
    print(f"Blocked roads: {blocked}")
    print(f"Accessible roads: {accessible}")
    # Show a sample with AI results
    for f in analyzed["features"][:3]:
        p = f["properties"]
        print(f"  - {p.get('name')}: {p.get('status')} (confidence: {p.get('confidence')}, damage: {p.get('damage_type')})")
else:
    print(f"Error: {analyzed}")

# 3. Test /route
print("\n" + "=" * 50)
print("TEST 3: GET /api/route")
print("=" * 50)
r3 = requests.get(f"{BASE}/route", params={
    "start_lat": 17.3753, "start_lon": 78.4744,
    "end_lat": 17.3850, "end_lon": 78.4860
})
print(f"Status: {r3.status_code}")
route_data = r3.json()
if "geometry" in route_data:
    coords = route_data["geometry"].get("coordinates", [])
    print(f"Route points: {len(coords)}")
    print(f"Distance: {route_data['properties'].get('distance')}m")
    print(f"Duration: {route_data['properties'].get('duration')}s")
else:
    print(f"Response: {json.dumps(route_data, indent=2)[:300]}")

print("\n" + "=" * 50)
print("ALL TESTS COMPLETE")
print("=" * 50)
