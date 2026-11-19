/**
 * Traffic disruptions ("Verkehrsstörungen") based on Google's live traffic data.
 *
 * The Google Routes API returns, for every route, `speedReadingIntervals` that mark
 * the stretches of the polyline where traffic is NORMAL, SLOW or a TRAFFIC_JAM.
 * We turn those stretches into incident objects (position, length, estimated delay,
 * road name) – for the active route, and for the surroundings by scanning a ring of
 * radial routes around the map centre.
 */
import { computeRoutes, reverseGeocode, type Route, type Speed } from '../api/google';
import { bearing, destination, distance, pathLength, pointAlong, type LatLng } from '../utils/geo';

export type IncidentKind = 'JAM' | 'SLOW';

export type Incident = {
  id: string;
  kind: IncidentKind;
  points: LatLng[];
  position: LatLng;
  start: LatLng;
  end: LatLng;
  lengthMeters: number;
  delaySec: number;
  heading: number;
  /** distance from route start (only for route incidents) */
  atMeters?: number;
  road?: string;
  source: 'route' | 'area';
};

const MIN_LENGTH = 120;

export function incidentsFromRoute(route: Route, source: Incident['source'] = 'route'): Incident[] {
  const { points, speedIntervals } = route;
  if (!points.length || !speedIntervals.length) return [];

  // merge adjacent non-normal intervals
  const merged: { start: number; end: number; speed: Speed }[] = [];
  for (const iv of speedIntervals) {
    if (iv.speed === 'NORMAL') continue;
    const last = merged[merged.length - 1];
    if (last && iv.start - last.end <= 1) {
      last.end = iv.end;
      if (iv.speed === 'TRAFFIC_JAM') last.speed = 'TRAFFIC_JAM';
    } else merged.push({ ...iv });
  }

  const totalDelay = Math.max(0, route.durationSec - route.staticDurationSec);
  const raw = merged
    .map((m) => {
      const seg = points.slice(m.start, m.end + 1);
      const len = pathLength(seg);
      return { m, seg, len };
    })
    .filter((x) => x.seg.length >= 2 && x.len >= MIN_LENGTH);

  // distribute the route's total traffic delay across its disruptions, weighting jams higher
  const weight = (x: (typeof raw)[number]) => x.len * (x.m.speed === 'TRAFFIC_JAM' ? 3 : 1);
  const totalWeight = raw.reduce((s, x) => s + weight(x), 0) || 1;

  return raw.map(({ m, seg, len }, i) => {
    const kind: IncidentKind = m.speed === 'TRAFFIC_JAM' ? 'JAM' : 'SLOW';
    // fall back to a speed based estimate if the route reports no delay
    const fallback = kind === 'JAM' ? len / 3 - len / 13 : len / 8 - len / 13; // ~11 vs 29 vs 47 km/h
    const delay = totalDelay > 0 ? (totalDelay * weight(raw[i])) / totalWeight : fallback;
    return {
      id: `${source}-${seg[0].latitude.toFixed(4)},${seg[0].longitude.toFixed(4)}-${kind}`,
      kind,
      points: seg,
      position: pointAlong(seg, len / 2),
      start: seg[0],
      end: seg[seg.length - 1],
      lengthMeters: len,
      delaySec: Math.max(30, delay),
      heading: bearing(seg[0], seg[seg.length - 1]),
      atMeters: source === 'route' ? pathLength(points, 0, m.start) : undefined,
      source,
    };
  });
}

/* ---------------------------------------------------------------- area scan */

type ScanCache = { key: string; at: number; incidents: Incident[] };
let cache: ScanCache | null = null;
const CACHE_MS = 3 * 60 * 1000;

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        out.push(await fn(item));
      }
    }),
  );
  return out;
}

function sameIncident(a: Incident, b: Incident) {
  const headingDiff = Math.abs(((a.heading - b.heading + 540) % 360) - 180);
  return distance(a.position, b.position) < 400 && headingDiff < 60;
}

export function dedupe(list: Incident[]): Incident[] {
  const out: Incident[] = [];
  for (const inc of [...list].sort((a, b) => b.lengthMeters - a.lengthMeters)) {
    if (!out.some((o) => sameIncident(o, inc))) out.push(inc);
  }
  return out;
}

/**
 * Samples live traffic around `center` by requesting traffic-aware routes along
 * 8 compass directions (outbound and inbound, because jams are directional).
 */
export async function scanArea(center: LatLng, radiusMeters: number, force = false): Promise<Incident[]> {
  const radius = Math.min(40000, Math.max(3000, radiusMeters));
  // coarse grid (half the radius) so small pans re-use the last scan
  const grid = radius / 111000 / 2;
  const key = `${Math.round(center.latitude / grid)},${Math.round(center.longitude / grid)},${Math.round(radius / 2000)}`;
  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.incidents;

  const jobs: { from: LatLng; to: LatLng }[] = [];
  for (let b = 0; b < 360; b += 45) {
    const far = destination(center, b, radius);
    const near = destination(center, b + 180, radius * 0.25);
    jobs.push({ from: near, to: far }, { from: far, to: near });
  }

  const results = await pool(jobs, 4, async (j) => {
    try {
      const routes = await computeRoutes(j.from, j.to, 'DRIVE', { lite: true });
      return routes.flatMap((r) => incidentsFromRoute(r, 'area'));
    } catch {
      return [];
    }
  });

  const incidents = dedupe(results.flat())
    .sort((a, b) => (a.kind === b.kind ? b.delaySec - a.delaySec : a.kind === 'JAM' ? -1 : 1))
    .slice(0, 40);
  cache = { key, at: Date.now(), incidents };
  return incidents;
}

/* ------------------------------------------------------------ road names */

const roadCache = new Map<string, string | null>();

export async function resolveRoad(inc: Incident): Promise<string | undefined> {
  const k = `${inc.position.latitude.toFixed(3)},${inc.position.longitude.toFixed(3)}`;
  if (roadCache.has(k)) return roadCache.get(k) ?? undefined;
  try {
    const r = await reverseGeocode(inc.position);
    roadCache.set(k, r.road ?? null);
    return r.road;
  } catch {
    return undefined;
  }
}

export async function withRoadNames(list: Incident[], max = 12): Promise<Incident[]> {
  const named = await Promise.all(
    list.map(async (inc, i) => (i < max && !inc.road ? { ...inc, road: await resolveRoad(inc) } : inc)),
  );
  return named;
}

export function incidentTitle(inc: Incident) {
  const what = inc.kind === 'JAM' ? 'Stau' : 'Stockender Verkehr';
  return inc.road ? `${what} · ${inc.road}` : what;
}
