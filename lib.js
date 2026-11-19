// Karten – shared logic. Only free, key-less open services:
//   Map:      OpenFreeMap (OpenStreetMap vector tiles) + Esri World Imagery (satellite)
//   Search:   Photon (komoot) + Overpass (categories) + Nominatim (details)
//   Routing:  OSRM (routing.openstreetmap.de)
//   Traffic:  Autobahn GmbH des Bundes – verkehr.autobahn.de (Staus, Sperrungen, Baustellen)

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
export function pathLength(pts, from = 0, to = pts.length - 1) {
  let s = 0;
  for (let i = from; i < to && i < pts.length - 1; i++) s += distance(pts[i], pts[i + 1]);
  return s;
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
export function decodePolyline(enc = '', precision = 5) {
  const f = 10 ** precision, pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < enc.length) {
    let b, sh = 0, r = 0;
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lat += r & 1 ? ~(r >> 1) : r >> 1;
    sh = 0; r = 0;
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    pts.push({ lat: lat / f, lng: lng / f });
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
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function getJSON(url, opts = {}, timeout = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`Dienst nicht erreichbar (HTTP ${res.status})`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung – bitte erneut versuchen.');
    if (e instanceof TypeError) throw new Error('Keine Verbindung zum Dienst. Internet prüfen.');
    throw e;
  } finally { clearTimeout(t); }
}

/* ------------------------------------------------------------- search */
function photonPlace(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const town = [p.postcode, p.city || p.town || p.village || p.county].filter(Boolean).join(' ');
  const name = p.name || street || town || 'Ort';
  const address = [street !== name ? street : null, town !== name ? town : null, p.country !== 'Deutschland' ? p.country : null].filter(Boolean).join(', ');
  return {
    id: `${(p.osm_type || 'X')[0]}${p.osm_id ?? `${lat},${lng}`}`, osmType: p.osm_type, osmId: p.osm_id,
    name, address, loc: { lat, lng }, category: CATEGORY_LABEL[p.osm_value] || CATEGORY_LABEL[p.osm_key] || null,
  };
}
const CATEGORY_LABEL = {
  fuel: 'Tankstelle', charging_station: 'Ladestation', restaurant: 'Restaurant', fast_food: 'Schnellrestaurant', cafe: 'Café',
  parking: 'Parkplatz', supermarket: 'Supermarkt', pharmacy: 'Apotheke', hotel: 'Hotel', hospital: 'Krankenhaus',
  school: 'Schule', bakery: 'Bäckerei', bar: 'Bar', pub: 'Kneipe', bank: 'Bank', atm: 'Geldautomat', station: 'Bahnhof',
  bus_stop: 'Bushaltestelle', city: 'Stadt', town: 'Stadt', village: 'Dorf', suburb: 'Stadtteil', residential: 'Straße',
  primary: 'Straße', secondary: 'Straße', tertiary: 'Straße', house: 'Adresse', museum: 'Museum', park: 'Park',
  doctors: 'Arztpraxis', dentist: 'Zahnarzt', police: 'Polizei', post_office: 'Post', cinema: 'Kino', theatre: 'Theater',
};

export async function autocomplete(q, near) {
  const qs = new URLSearchParams({ q, lang: 'de', limit: '8' });
  if (near) { qs.set('lat', near.lat); qs.set('lon', near.lng); }
  const r = await getJSON(`https://photon.komoot.io/api/?${qs}`);
  return (r.features || []).map(photonPlace);
}
export async function reverse(loc) {
  try {
    const r = await getJSON(`https://photon.komoot.io/reverse?lat=${loc.lat}&lon=${loc.lng}&lang=de&limit=1`);
    return r.features?.[0] ? photonPlace(r.features[0]) : null;
  } catch { return null; }
}
/** Extra details (opening hours, phone, website) from Nominatim. */
export async function placeExtras(place) {
  if (!place.osmType || !place.osmId) return {};
  const t = { node: 'N', way: 'W', relation: 'R' }[place.osmType] || String(place.osmType)[0].toUpperCase();
  try {
    const r = await getJSON(`https://nominatim.openstreetmap.org/lookup?osm_ids=${t}${place.osmId}&format=jsonv2&extratags=1&addressdetails=1&accept-language=de`);
    const x = r?.[0]?.extratags || {};
    return {
      phone: x.phone || x['contact:phone'], website: x.website || x['contact:website'] || x.url,
      hours: x.opening_hours, cuisine: x.cuisine, wheelchair: x.wheelchair, operator: x.operator || x.brand,
    };
  } catch { return {}; }
}

/** Nearby places of a category via Overpass. */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
function overpassPlace(e) {
  const tg = e.tags || {};
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  const street = [tg['addr:street'], tg['addr:housenumber']].filter(Boolean).join(' ');
  return {
    id: `${e.type[0].toUpperCase()}${e.id}`, osmType: e.type, osmId: e.id,
    name: tg.name || tg.brand || tg.operator || CATEGORY_LABEL[tg.amenity || tg.shop || tg.tourism] || 'Ort',
    address: [street, tg['addr:city']].filter(Boolean).join(', '), loc: { lat, lng },
    category: CATEGORY_LABEL[tg.amenity || tg.shop || tg.tourism] || null,
    phone: tg.phone || tg['contact:phone'], website: tg.website || tg['contact:website'], hours: tg.opening_hours,
  };
}

/**
 * Nearby places of a category. Tries several Overpass servers (they are often busy),
 * then falls back to Photon with an OSM tag filter.
 * @param filter   Overpass tag filter, e.g. "[amenity=fuel]"
 * @param word     German search word for the Photon fallback, e.g. "Tankstelle"
 */
export async function nearby(filter, center, radius = 4000, word = '') {
  const q = `[out:json][timeout:12];nwr${filter}(around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)});out center 40;`;
  for (const url of OVERPASS) {
    try {
      const r = await getJSON(`${url}?data=${encodeURIComponent(q)}`, {}, 13000);
      if (!Array.isArray(r.elements)) continue;
      return sortByDistance(r.elements.map(overpassPlace).filter((p) => p.loc.lat != null), center);
    } catch { /* try next server */ }
  }
  // Fallback: Photon, restricted to the OSM tag and a box around the centre
  const tag = /\[(\w+)=([\w:]+)\]/.exec(filter);
  const d = radius / 111000, dl = d / Math.cos((center.lat * Math.PI) / 180);
  const qs = new URLSearchParams({ q: word || (tag ? tag[2] : 'Ort'), lang: 'de', limit: '30', lat: center.lat, lon: center.lng,
    bbox: [center.lng - dl, center.lat - d, center.lng + dl, center.lat + d].map((x) => x.toFixed(5)).join(',') });
  if (tag) qs.set('osm_tag', `${tag[1]}:${tag[2]}`);
  const r = await getJSON(`https://photon.komoot.io/api/?${qs}`);
  return sortByDistance((r.features || []).map(photonPlace), center);
}
const sortByDistance = (list, c) => list.sort((a, b) => distance(c, a.loc) - distance(c, b.loc));

/* ------------------------------------------------------------ routing */
const PROFILE = { DRIVE: 'routed-car', BICYCLE: 'routed-bike', WALK: 'routed-foot' };
const SPEED_FACTOR = { DRIVE: 1, BICYCLE: 1, WALK: 1 };

const DIR = { left: 'links', right: 'rechts', 'slight left': 'leicht links', 'slight right': 'leicht rechts', 'sharp left': 'scharf links', 'sharp right': 'scharf rechts', straight: 'geradeaus', uturn: 'wenden' };
const ORD = ['', 'erste', 'zweite', 'dritte', 'vierte', 'fünfte', 'sechste', 'siebte', 'achte'];

function roadName(s) {
  const n = s.name || '', ref = s.ref || '';
  if (n && ref) return `${n} (${ref})`;
  return n || ref;
}
function instruction(s, mode) {
  const m = s.maneuver, d = DIR[m.modifier] || '', name = roadName(s);
  const onto = name ? ` auf ${name}` : '';
  switch (m.type) {
    case 'depart': return `Starten${name ? ` auf ${name}` : ''}${m.bearing_after != null ? ` Richtung ${compass(m.bearing_after)}` : ''}`;
    case 'arrive': return m.modifier === 'left' ? 'Ziel erreicht – es liegt links' : m.modifier === 'right' ? 'Ziel erreicht – es liegt rechts' : 'Ziel erreicht';
    case 'turn': case 'end of road':
      if (m.modifier === 'uturn') return `Wenden${onto}`;
      if (m.modifier === 'straight') return `Geradeaus weiter${onto}`;
      return `${cap(d)} abbiegen${onto}`;
    case 'new name': case 'continue': return m.modifier && m.modifier !== 'straight' && m.modifier !== 'uturn' ? `${cap(d)} halten${onto}` : `Weiter${onto}`;
    case 'merge': return `Einfädeln${onto}`;
    case 'on ramp': return `${d ? cap(d) + ' ' : ''}auf die Auffahrt${name ? ` Richtung ${s.destinations || name}` : ''}`.replace(/^auf/, 'Auf');
    case 'off ramp': return `${d ? cap(d) + ' ' : ''}die Ausfahrt nehmen${s.exits ? ` ${s.exits}` : ''}${s.destinations ? ` Richtung ${s.destinations}` : onto}`.replace(/^die/, 'Die');
    case 'fork': return `An der Gabelung ${d || 'weiter'} halten${onto}`;
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return `Im Kreisverkehr die ${ORD[m.exit] || m.exit + '.'} Ausfahrt nehmen${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Kreisverkehr verlassen${onto}`;
    case 'notification': return `Weiter${onto}`;
    default: return d ? `${cap(d)}${onto}` : `Weiter${onto}`;
  }
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function compass(b) { return ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'][Math.round(b / 45) % 8]; }
function maneuverKey(m) {
  if (m.type === 'depart') return 'DEPART';
  if (m.type === 'arrive') return 'ARRIVE';
  if (m.type.includes('roundabout') || m.type === 'rotary') return /left/.test(m.modifier || '') ? 'ROUNDABOUT_LEFT' : 'ROUNDABOUT_RIGHT';
  if (m.type === 'merge') return 'MERGE';
  if (m.type === 'fork') return /left/.test(m.modifier) ? 'FORK_LEFT' : 'FORK_RIGHT';
  if (m.type === 'on ramp' || m.type === 'off ramp') return /left/.test(m.modifier) ? 'RAMP_LEFT' : 'RAMP_RIGHT';
  return { left: 'TURN_LEFT', right: 'TURN_RIGHT', 'slight left': 'TURN_SLIGHT_LEFT', 'slight right': 'TURN_SLIGHT_RIGHT', 'sharp left': 'TURN_SHARP_LEFT', 'sharp right': 'TURN_SHARP_RIGHT', uturn: 'UTURN_LEFT' }[m.modifier] || 'STRAIGHT';
}

export async function computeRoutes(origin, dest, mode, { alternatives = true, avoidHighways = false } = {}) {
  const prof = PROFILE[mode] || PROFILE.DRIVE;
  const qs = new URLSearchParams({ overview: 'full', geometries: 'polyline6', steps: 'true', alternatives: alternatives ? '3' : 'false' });
  if (avoidHighways && mode === 'DRIVE') qs.set('exclude', 'motorway');
  let r;
  try {
    r = await getJSON(`https://routing.openstreetmap.de/${prof}/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?${qs}`, {}, 20000);
  } catch (e) {
    if (!qs.has('exclude')) throw e;
    qs.delete('exclude');
    r = await getJSON(`https://routing.openstreetmap.de/${prof}/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?${qs}`, {}, 20000);
  }
  if (r.code !== 'Ok') throw new Error(r.code === 'NoRoute' ? 'Keine Route gefunden.' : `Routing-Fehler: ${r.message || r.code}`);
  return (r.routes || []).map((rt, i) => {
    const steps = rt.legs.flatMap((l) => l.steps).map((s) => ({
      instruction: instruction(s, mode), maneuver: maneuverKey(s.maneuver), distance: s.distance, duration: s.duration,
      loc: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] },
    }));
    // OSRM: step[i] starts with its manoeuvre, so while driving step i the next manoeuvre is step[i + 1].
    const names = [...new Set(rt.legs.flatMap((l) => l.steps).map((s) => s.ref || s.name).filter(Boolean))].slice(0, 2);
    return {
      id: `${i}-${Math.round(rt.distance)}-${Date.now()}`, mode,
      points: decodePolyline(rt.geometry, 6), distance: rt.distance, duration: rt.duration * SPEED_FACTOR[mode],
      description: names.join(', '), steps,
    };
  });
}

/* ------------------------------------------------- traffic (Autobahn) */
const AB = 'https://verkehr.autobahn.de/o/autobahn';
let roadsCache = null, trafficCache = null;

async function roads() {
  if (!roadsCache) roadsCache = getJSON(`${AB}/`).then((r) => (r.roads || []).map((x) => x.trim()).filter((x) => /^A\d+$/.test(x))).catch((e) => { roadsCache = null; throw e; });
  return roadsCache;
}
function parseDelay(w) {
  if (w.delayTimeValue != null && !isNaN(+w.delayTimeValue)) return +w.delayTimeValue * 60;
  const txt = (w.description || []).join(' ');
  const m = /(\d+)\s*Min/i.exec(txt);
  return m ? +m[1] * 60 : null;
}
function lengthFrom(w) {
  const txt = (w.description || []).join(' ');
  const m = /(\d+(?:[.,]\d+)?)\s*km/i.exec(txt);
  return m ? parseFloat(m[1].replace(',', '.')) * 1000 : null;
}
function toIncident(w, road, kind) {
  const lat = parseFloat(w.coordinate?.lat), lng = parseFloat(w.coordinate?.long);
  if (isNaN(lat) || isNaN(lng)) return null;
  let points = [];
  const g = w.geometry;
  if (g?.type === 'LineString') points = g.coordinates.map(([x, y]) => ({ lat: y, lng: x }));
  else if (g?.type === 'MultiLineString') points = g.coordinates.flat().map(([x, y]) => ({ lat: y, lng: x }));
  const t = (w.abnormalTrafficType || '').toUpperCase();
  const blocked = String(w.isBlocked) === 'true';
  let k = kind;
  if (kind === 'WARNING') k = blocked ? 'CLOSURE' : t === 'STATIONARY_TRAFFIC' || t === 'QUEUING_TRAFFIC' || /stau/i.test(w.title + (w.description || []).join(' ')) ? 'JAM' : t === 'SLOW_TRAFFIC' ? 'SLOW' : 'WARNING';
  const desc = (w.description || []).filter((x) => x && x.trim());
  return {
    id: w.identifier || `${road}-${lat},${lng}`, road, kind: k,
    title: (w.title || road).replace(/\s*\|\s*/g, ' · '), subtitle: w.subtitle || '',
    description: desc, pos: { lat, lng }, points,
    length: points.length > 1 ? pathLength(points) : lengthFrom(w), delay: parseDelay(w),
    speed: w.averageSpeed && !isNaN(+w.averageSpeed) ? +w.averageSpeed : null,
    since: w.startTimestamp || null,
  };
}
async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}
/**
 * All current disruptions on German Autobahns (warnings incl. traffic jams, closures; roadworks optional).
 * Cached for 4 minutes.
 */
export async function trafficGermany({ force = false, roadworks = false, onProgress } = {}) {
  const key = roadworks ? 'rw' : 'std';
  if (!force && trafficCache?.key === key && Date.now() - trafficCache.at < 240000) return trafficCache.list;
  const list = (await roads());
  const out = [];
  const services = [['warning', 'WARNING'], ['closure', 'CLOSURE'], ...(roadworks ? [['roadworks', 'ROADWORKS']] : [])];
  const jobs = list.flatMap((r) => services.map(([s, k]) => [r, s, k]));
  let done = 0;
  await pool(jobs, 8, async ([road, svc, kind]) => {
    try {
      const r = await getJSON(`${AB}/${road}/services/${svc}`, {}, 15000);
      const arr = r[svc] || r.warning || r.closure || r.roadworks || [];
      for (const w of arr) { const inc = toIncident(w, road, kind); if (inc) out.push(inc); }
    } catch {}
    onProgress?.(++done / jobs.length);
  });
  const seen = new Set();
  const uniq = out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  const rank = { CLOSURE: 0, JAM: 1, SLOW: 2, WARNING: 3, ROADWORKS: 4 };
  uniq.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.delay ?? 0) - (a.delay ?? 0));
  trafficCache = { key, at: Date.now(), list: uniq };
  return uniq;
}

/** Disruptions lying on a route (within ~120 m of its line), with distance from the start. */
export function incidentsOnRoute(route, all) {
  if (!route || route.mode !== 'DRIVE') return [];
  const pts = route.points;
  // quick bbox filter
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const p of pts) { minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng); }
  const pad = 0.01;
  const res = [];
  for (const inc of all) {
    const p = inc.pos;
    if (p.lat < minLat - pad || p.lat > maxLat + pad || p.lng < minLng - pad || p.lng > maxLng + pad) continue;
    const s = snapToPath(p, pts);
    if (s.offset > 120) continue;
    // direction check: incident line must run the same way as the route
    if (inc.points.length > 1) {
      const a = snapToPath(inc.points[0], pts), b = snapToPath(inc.points[inc.points.length - 1], pts);
      if (a.offset < 150 && b.offset < 150 && b.along < a.along - 50) continue;
    }
    res.push({ ...inc, at: s.along });
  }
  return res.sort((a, b) => a.at - b.at);
}

export const KIND = {
  JAM: { label: 'Stau', icon: 'car_crash', color: 'var(--red)' },
  SLOW: { label: 'Stockender Verkehr', icon: 'traffic', color: 'var(--orange)' },
  CLOSURE: { label: 'Sperrung', icon: 'block', color: '#c00020' },
  WARNING: { label: 'Verkehrsmeldung', icon: 'warning', color: '#e6a100' },
  ROADWORKS: { label: 'Baustelle', icon: 'construction', color: '#d97a00' },
};
