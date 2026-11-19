// Shared logic: geo math, formatting, Google REST APIs, traffic disruption detection.

/* ------------------------------------------------------------------ geo */
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distance(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
export function destination(p, brg, dist) {
  const d = dist / R, b = rad(brg), lat1 = rad(p.lat), lon1 = rad(p.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: deg(lon2) };
}
export function pathLength(pts, from = 0, to = pts.length - 1) {
  let s = 0;
  for (let i = from; i < to && i < pts.length - 1; i++) s += distance(pts[i], pts[i + 1]);
  return s;
}
export function pointAlong(pts, m) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = distance(pts[i], pts[i + 1]);
    if (acc + seg >= m && seg > 0) {
      const t = (m - acc) / seg;
      return { lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, lng: pts[i].lng + (pts[i + 1].lng - pts[i].lng) * t };
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}
export function snapToPath(p, pts) {
  let best = { index: 0, point: pts[0], offset: Infinity, along: 0 };
  let acc = 0;
  const cosLat = Math.cos(rad(p.lat));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], seg = distance(a, b);
    const ax = (a.lng - p.lng) * cosLat, ay = a.lat - p.lat, bx = (b.lng - p.lng) * cosLat, by = b.lat - p.lat;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    const off = distance(p, point);
    if (off < best.offset) best = { index: i, point, offset: off, along: acc + seg * t };
    acc += seg;
  }
  return best;
}
export function decodePolyline(enc = '') {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < enc.length) {
    let b, sh = 0, r = 0;
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lat += r & 1 ? ~(r >> 1) : r >> 1;
    sh = 0; r = 0;
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

/* ------------------------------------------------------------- format */
export function fmtDist(m) {
  if (m < 50) return `${Math.max(0, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 1000)} km`;
}
export function fmtDur(sec) {
  const min = Math.round(sec / 60);
  if (min < 1) return '< 1 Min.';
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} Std. ${r} Min.` : `${h} Std.`;
}
export const fmtClock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const secs = (d) => (d ? parseFloat(String(d).replace('s', '')) || 0 : 0);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* --------------------------------------------------------- Google REST */
let KEY = '';
export const setKey = (k) => (KEY = k);
export class ApiError extends Error {}

async function req(url, { body, fieldMask, method = body ? 'POST' : 'GET' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY };
  if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json?.error?.message || `HTTP ${res.status}`);
  return json;
}
const gl = (p) => ({ latitude: p.lat, longitude: p.lng });

export async function autocomplete(input, near, sessionToken) {
  const body = { input, languageCode: 'de', regionCode: 'DE', sessionToken, includeQueryPredictions: true };
  if (near) { body.locationBias = { circle: { center: gl(near), radius: 30000 } }; body.origin = gl(near); }
  const r = await req('https://places.googleapis.com/v1/places:autocomplete', { body });
  return (r.suggestions || []).map((s) => {
    if (s.placePrediction) {
      const p = s.placePrediction;
      return { placeId: p.placeId, title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '', subtitle: p.structuredFormat?.secondaryText?.text ?? '', dist: p.distanceMeters };
    }
    return { query: s.queryPrediction.text?.text, title: s.queryPrediction.text?.text ?? '', subtitle: 'In der Nähe suchen' };
  });
}

const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'primaryTypeDisplayName', 'rating', 'userRatingCount', 'nationalPhoneNumber', 'websiteUri', 'currentOpeningHours.openNow', 'regularOpeningHours.weekdayDescriptions', 'photos', 'priceLevel'];
const mapPlace = (p) => ({
  id: p.id, name: p.displayName?.text ?? 'Ort', address: p.formattedAddress ?? '',
  loc: { lat: p.location?.latitude, lng: p.location?.longitude },
  category: p.primaryTypeDisplayName?.text, rating: p.rating, ratingCount: p.userRatingCount,
  phone: p.nationalPhoneNumber, website: p.websiteUri, openNow: p.currentOpeningHours?.openNow,
  hours: p.regularOpeningHours?.weekdayDescriptions, priceLevel: p.priceLevel,
  photo: p.photos?.[0]?.name ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=800&key=${KEY}` : null,
});
export async function placeDetails(id, sessionToken) {
  const qs = new URLSearchParams({ languageCode: 'de', regionCode: 'DE' });
  if (sessionToken) qs.set('sessionToken', sessionToken);
  return mapPlace(await req(`https://places.googleapis.com/v1/places/${id}?${qs}`, { fieldMask: PLACE_FIELDS.join(',') }));
}
export async function searchText(q, near) {
  const body = { textQuery: q, languageCode: 'de', regionCode: 'DE', maxResultCount: 20 };
  if (near) body.locationBias = { circle: { center: gl(near), radius: 15000 } };
  const r = await req('https://places.googleapis.com/v1/places:searchText', { body, fieldMask: PLACE_FIELDS.map((f) => 'places.' + f).join(',') });
  return (r.places || []).map(mapPlace);
}

const FULL = ['routes.duration', 'routes.staticDuration', 'routes.distanceMeters', 'routes.polyline.encodedPolyline', 'routes.description', 'routes.warnings', 'routes.routeLabels', 'routes.travelAdvisory.speedReadingIntervals', 'routes.travelAdvisory.tollInfo', 'routes.legs.steps.distanceMeters', 'routes.legs.steps.staticDuration', 'routes.legs.steps.polyline.encodedPolyline', 'routes.legs.steps.navigationInstruction', 'routes.legs.steps.travelMode', 'routes.legs.steps.transitDetails'].join(',');
const LITE = ['routes.duration', 'routes.staticDuration', 'routes.distanceMeters', 'routes.polyline.encodedPolyline', 'routes.travelAdvisory.speedReadingIntervals'].join(',');

export async function computeRoutes(origin, dest, mode, o = {}) {
  const traffic = mode === 'DRIVE' || mode === 'TWO_WHEELER';
  const body = {
    origin: { location: { latLng: gl(origin) } }, destination: { location: { latLng: gl(dest) } },
    travelMode: mode, languageCode: 'de', regionCode: 'DE', units: 'METRIC',
    computeAlternativeRoutes: !!o.alternatives && mode !== 'TRANSIT',
  };
  if (traffic) {
    body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
    body.extraComputations = ['TRAFFIC_ON_POLYLINE', ...(o.lite ? [] : ['TOLLS'])];
    body.routeModifiers = { avoidTolls: !!o.avoidTolls, avoidHighways: !!o.avoidHighways, avoidFerries: !!o.avoidFerries };
  }
  if (mode === 'TRANSIT') body.departureTime = new Date().toISOString();
  const r = await req('https://routes.googleapis.com/directions/v2:computeRoutes', { body, fieldMask: o.lite ? LITE : FULL });
  return (r.routes || []).map((rt, i) => ({
    id: `${i}-${rt.distanceMeters}-${rt.duration}-${Date.now()}`,
    mode,
    points: decodePolyline(rt.polyline?.encodedPolyline),
    distance: rt.distanceMeters ?? 0,
    duration: secs(rt.duration),
    staticDuration: secs(rt.staticDuration ?? rt.duration),
    description: rt.description, labels: rt.routeLabels || [], warnings: rt.warnings || [],
    tolls: !!rt.travelAdvisory?.tollInfo,
    speed: (rt.travelAdvisory?.speedReadingIntervals || []).map((s) => ({ start: s.startPolylinePointIndex ?? 0, end: s.endPolylinePointIndex ?? 0, speed: s.speed ?? 'NORMAL' })),
    steps: (rt.legs || []).flatMap((leg) => (leg.steps || []).map((s) => {
      const t = s.transitDetails;
      return {
        instruction: s.navigationInstruction?.instructions ?? '', maneuver: s.navigationInstruction?.maneuver,
        distance: s.distanceMeters ?? 0, duration: secs(s.staticDuration), travelMode: s.travelMode,
        transit: t ? {
          line: t.transitLine?.nameShort ?? t.transitLine?.name ?? '', color: t.transitLine?.color, textColor: t.transitLine?.textColor,
          vehicle: t.transitLine?.vehicle?.name?.text, headsign: t.headsign,
          from: t.stopDetails?.departureStop?.name, to: t.stopDetails?.arrivalStop?.name,
          dep: t.localizedValues?.departureTime?.time?.text, arr: t.localizedValues?.arrivalTime?.time?.text, stops: t.stopCount,
        } : null,
      };
    })),
  }));
}

/* ------------------------------------------------ traffic disruptions */
// Built from the Routes API's speedReadingIntervals (SLOW / TRAFFIC_JAM stretches).
export function incidentsFromRoute(route, source = 'route') {
  const { points, speed } = route;
  if (!points.length || !speed.length) return [];
  const merged = [];
  for (const iv of speed) {
    if (iv.speed === 'NORMAL') continue;
    const last = merged[merged.length - 1];
    if (last && iv.start - last.end <= 1) { last.end = iv.end; if (iv.speed === 'TRAFFIC_JAM') last.speed = 'TRAFFIC_JAM'; }
    else merged.push({ ...iv });
  }
  const totalDelay = Math.max(0, route.duration - route.staticDuration);
  const raw = merged.map((m) => { const seg = points.slice(m.start, m.end + 1); return { m, seg, len: pathLength(seg) }; })
    .filter((x) => x.seg.length >= 2 && x.len >= 120);
  const w = (x) => x.len * (x.m.speed === 'TRAFFIC_JAM' ? 3 : 1);
  const tw = raw.reduce((s, x) => s + w(x), 0) || 1;
  return raw.map((x) => {
    const kind = x.m.speed === 'TRAFFIC_JAM' ? 'JAM' : 'SLOW';
    const fallback = kind === 'JAM' ? x.len / 3 - x.len / 13 : x.len / 8 - x.len / 13;
    const delay = totalDelay > 0 ? (totalDelay * w(x)) / tw : fallback;
    return {
      id: `${source}-${x.seg[0].lat.toFixed(4)},${x.seg[0].lng.toFixed(4)}-${kind}`,
      kind, points: x.seg, pos: pointAlong(x.seg, x.len / 2), length: x.len,
      delay: Math.max(30, delay), heading: bearing(x.seg[0], x.seg[x.seg.length - 1]),
      at: source === 'route' ? pathLength(points, 0, x.m.start) : null, source,
    };
  });
}

export function dedupe(list) {
  const out = [];
  for (const inc of [...list].sort((a, b) => b.length - a.length)) {
    if (!out.some((o) => distance(o.pos, inc.pos) < 400 && Math.abs(((o.heading - inc.heading + 540) % 360) - 180) < 60)) out.push(inc);
  }
  return out;
}

let scanCache = null;
/** Samples live traffic around `center` with 16 radial routes (8 directions, in- and outbound). */
export async function scanArea(center, radius, force = false) {
  radius = Math.min(40000, Math.max(3000, radius));
  const g = radius / 111000 / 2;
  const key = `${Math.round(center.lat / g)},${Math.round(center.lng / g)},${Math.round(radius / 2000)}`;
  if (!force && scanCache && scanCache.key === key && Date.now() - scanCache.at < 180000) return scanCache.list;
  const jobs = [];
  for (let b = 0; b < 360; b += 45) {
    const far = destination(center, b, radius), near = destination(center, b + 180, radius * 0.25);
    jobs.push([near, far], [far, near]);
  }
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < jobs.length) {
      const [a, b] = jobs[i++];
      try { for (const r of await computeRoutes(a, b, 'DRIVE', { lite: true })) results.push(...incidentsFromRoute(r, 'area')); } catch {}
    }
  }));
  const list = dedupe(results).sort((a, b) => (a.kind === b.kind ? b.delay - a.delay : a.kind === 'JAM' ? -1 : 1)).slice(0, 40);
  scanCache = { key, at: Date.now(), list };
  return list;
}
