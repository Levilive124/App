import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '../utils/geo';

export type Fix = LatLng & { heading: number | null; speed: number | null; accuracy: number | null };

/** Continuously tracks the user's position. `highAccuracy` is used while navigating. */
export function useLocation(highAccuracy: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);
  const sub = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return;
      }
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last && !cancelled) setFix(toFix(last));
      sub.current?.remove();
      sub.current = await Location.watchPositionAsync(
        highAccuracy
          ? { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 1000 }
          : { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 5000 },
        (loc) => !cancelled && setFix(toFix(loc)),
      );
    })();
    return () => {
      cancelled = true;
      sub.current?.remove();
      sub.current = null;
    };
  }, [highAccuracy]);

  return { fix, denied };
}

function toFix(l: Location.LocationObject): Fix {
  return {
    latitude: l.coords.latitude,
    longitude: l.coords.longitude,
    heading: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null,
    speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    accuracy: l.coords.accuracy,
  };
}
