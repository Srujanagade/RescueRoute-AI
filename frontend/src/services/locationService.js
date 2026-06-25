import axios from "axios";

export const searchPlaces = async (query, signal) => {
  const res = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: {
      q: query,
      format: "json",
      addressdetails: 1,
      limit: 5,
    },
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  return res.data.map((place) => ({
    name: place.display_name,
    lat: Number.parseFloat(place.lat),
    lng: Number.parseFloat(place.lon),
  }));
};
