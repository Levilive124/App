export type LatLng = { latitude: number; longitude: number };

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distance(a: LatLng, b: LatLng): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x =
    Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) -
    Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point at `dist` metres from `p` in direction `brg` degrees. */
export function destination(p: LatLng, brg: number, dist: number): LatLng {
  const d = dist / R;
  const b = rad(brg);
  const lat1 = rad(p.latitude);
  const lon1 = rad(p.longitude);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: deg(lat2), longitude: deg(lon2) };
}

export function pathLength(points: LatLng[], from = 0, to = points.length - 1): number {
  let sum = 0;
  for (let i = from; i < to && i < points.length - 1; i++) sum += distance(points[i], points[i + 1]);
  return sum;
}

/** Point at the given distance along a path. */
export function pointAlong(points: LatLng[], meters: number): LatLng {
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const seg = distance(points[i], points[i + 1]);
    if (acc + seg >= meters && seg > 0) {
      const t = (meters - acc) / seg;
      return {
        latitude: points[i].latitude + (points[i + 1].latitude - points[i].latitude) * t,
        longitude: points[i].longitude + (points[i + 1].longitude - points[i].longitude) * t,
      };
    }
    acc += seg;
  }
  return points[points.length - 1];
}

/**
 * Snap a position onto a path. Returns the segment index, the snapped point,
 * the perpendicular distance and the travelled distance along the path.
 */
export function snapToPath(p: LatLng, points: LatLng[], searchFrom = 0) {
  let best = { index: 0, point: points[0], offset: Infinity, along: 0 };
  let acc = 0;
  const cosLat = Math.cos(rad(p.latitude));
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = distance(a, b);
    if (i >= searchFrom) {
      // equirectangular projection around p is precise enough for snapping
      const ax = (a.longitude - p.longitude) * cosLat, ay = a.latitude - p.latitude;
      const bx = (b.longitude - p.longitude) * cosLat, by = b.latitude - p.latitude;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const point = { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
      const off = distance(p, point);
      if (off < best.offset) best = { index: i, point, offset: off, along: acc + seg * t };
    }
    acc += seg;
  }
  return best;
}

export function regionFor(points: LatLng[]) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude); maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude); maxLon = Math.max(maxLon, p.longitude);
  }
  return { minLat, maxLat, minLon, maxLon };
}
