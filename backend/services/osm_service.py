import osmnx as ox
import logging

def get_roads(lat: float, lon: float, radius: int = 500) -> dict:
    """
    Fetch road network using osmnx and convert it to GeoJSON format.
    """
    try:
        # Fetch the graph from point
        G = ox.graph_from_point((lat, lon), dist=radius, network_type='drive')
        
        # Convert graph edges to custom geojson
        features = []
        for u, v, key, data in G.edges(keys=True, data=True):
            # Handle geometry coordinates depending on whether curve geometry is kept
            if "geometry" in data:
                coords = [[lon, lat] for lon, lat in data["geometry"].coords]
            else:
                # Fallback to node coordinates from graph
                n_u = G.nodes[u]
                n_v = G.nodes[v]
                coords = [[n_u['x'], n_u['y']], [n_v['x'], n_v['y']]]
                
            highway = data.get("highway", "unknown")
            if isinstance(highway, list):
                highway = highway[0]
                
            name = data.get("name", "Unknown Road")
            if isinstance(name, list):
                name = name[0]

            feature = {
                "type": "Feature",
                "properties": {
                    "highway": highway,
                    "name": name,
                    "status": "unknown"
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords
                }
            }
            features.append(feature)
            
        return {
            "type": "FeatureCollection",
            "features": features
        }
    except Exception as e:
        logging.error(f"Error fetching roads: {e}")
        raise
