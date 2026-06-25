import { useEffect, useRef } from "react";

export default function useGeolocation(setUserLocation) {
  const hasRequestedRef = useRef(false);

  useEffect(() => {
    if (hasRequestedRef.current || !navigator.geolocation) {
      return;
    }

    hasRequestedRef.current = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation({ lat: latitude, lng: longitude });
      },
      (err) => {
        console.error("Geolocation error:", err);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  }, [setUserLocation]);
}
