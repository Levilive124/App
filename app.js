import {
  KIND, autocomplete, computeRoutes, distance, esc, fmtClock, fmtDist, fmtDur, incidentsOnRoute,
  nearby, pathLength, placeExtras, reverse, snapToPath, trafficGermany,
} from './lib.js?v=5';

const APP_VERSION = '5';

/* =================================================================== state */
const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d) { try { const v = localStorage.getItem('karten.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('karten.' + k, JSON.stringify(v)); } catch {} },
};
const DEFAULTS = { mapType: 'liberty', incidents: true, roadworks: false, threeD: true, voice: true, avoidHighways: false };

const S = {
  settings: { ...DEFAULTS, ...LS.get('settings', {}) },
  favorites: LS.get('favorites', []),
  recents: LS.get('recents', []),
  view: { kind: 'home' }, sheet: 1,
  query: '', focused: false, searching: false, suggestions: [],
  pendingKind: null, pin: false,
  mode: 'DRIVE', routes: [], sel: 0, routeLoading: false, routeError: null, routeIncidents: [], showSteps: false,
  navigating: false, rerouting: false, nav: null, navTarget: null,
  fix: null, following: true, traffic: [], trafficLoading: false, trafficProgress: 0, trafficError: null, denied: false,
};
const route = () => S.routes[S.sel] || null;
const saveSettings = () => LS.set('settings', S.settings);
const center = () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; };
const near = () => S.fix || (map ? center() : null);

/* ================================================================= helpers */
const ms = (name, cls = '') => `<span class="ms ${cls}">${name}</span>`;
const MODE_ICON = { DRIVE: 'directions_car', BICYCLE: 'directions_bike', WALK: 'directions_walk' };
const MANEUVER = {
  DEPART: 'navigation', ARRIVE: 'sports_score', STRAIGHT: 'straight', TURN_LEFT: 'turn_left', TURN_RIGHT: 'turn_right',
  TURN_SLIGHT_LEFT: 'turn_slight_left', TURN_SLIGHT_RIGHT: 'turn_slight_right', TURN_SHARP_LEFT: 'turn_sharp_left',
  TURN_SHARP_RIGHT: 'turn_sharp_right', UTURN_LEFT: 'u_turn_left', RAMP_LEFT: 'ramp_left', RAMP_RIGHT: 'ramp_right',
  FORK_LEFT: 'fork_left', FORK_RIGHT: 'fork_right', MERGE: 'merge', ROUNDABOUT_LEFT: 'roundabout_left', ROUNDABOUT_RIGHT: 'roundabout_right',
};
const mIcon = (m) => MANEUVER[m] || 'straight';
// [label, Overpass filter, icon, colour, search word for the fallback]
const CATEGORIES = [
  ['Tankstellen', '[amenity=fuel]', 'local_gas_station', '#0A84FF', 'Tankstelle'], ['Laden', '[amenity=charging_station]', 'ev_station', '#30B0C7', 'Ladestation'],
  ['Restaurants', '[amenity=restaurant]', 'restaurant', '#FF9500', 'Restaurant'], ['Parken', '[amenity=parking][access!=private]', 'local_parking', '#5856D6', 'Parkplatz'],
  ['Supermarkt', '[shop=supermarket]', 'shopping_cart', '#34C759', 'Supermarkt'], ['Café', '[amenity=cafe]', 'local_cafe', '#A2845E', 'Café'],
  ['Apotheke', '[amenity=pharmacy]', 'local_pharmacy', '#FF3B30', 'Apotheke'], ['Hotels', '[tourism=hotel]', 'hotel', '#AF52DE', 'Hotel'],
];
const KIND_HEX = { JAM: '#E0262B', SLOW: '#FF9500', CLOSURE: '#B0001A', WARNING: '#E6A100', ROADWORKS: '#D97A00' };
const incTitle = (i) => `${KIND[i.kind].label} · ${i.road}`;
const incSub = (i) => [i.subtitle, i.length ? fmtDist(i.length) : null, i.delay ? `+${fmtDur(i.delay)}` : null].filter(Boolean).join(' · ');

function row({ icon, bg, t, s, action, data = {} }) {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<button class="row" data-action="${action || ''}" ${attrs}>
    <span class="ricon" style="background:${bg}">${ms(icon)}</span>
    <span class="txt"><div class="t">${esc(t)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</span></button>`;
}
function toggle(id, label, sub, on) {
  return `<label class="opt"><span><div>${esc(label)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</span>
    <span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span></label>`;
}
let toastTimer;
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2600);
}
function haptic() { try { navigator.vibrate?.(10); } catch {} }

/* ================================================================== map */
const STYLES = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/bright',
  positron: 'https://tiles.openfreemap.org/styles/positron',
  satellite: {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { sat: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Bilder © Esri, Maxar, Earthstar Geographics',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  },
};
let map, meMarker = null, placeMarkers = [];

function initMap() {
  const last = LS.get('lastView', { lat: 51.16, lng: 10.45, zoom: 5.5 });
  map = new maplibregl.Map({
    container: 'map', style: STYLES[S.settings.mapType] || STYLES.liberty,
    center: [last.lng, last.lat], zoom: last.zoom, pitch: 0, attributionControl: false, maxPitch: 70,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');
  map.on('style.load', () => { setupLayers(); drawMap(); });
  map.on('dragstart', () => { cancelLongPress(); if (S.following) { S.following = false; updateControls(); if (S.navigating) renderNav(); } });
  map.on('moveend', () => { const c = center(); LS.set('lastView', { ...c, zoom: map.getZoom() }); if (S.view.kind === 'home' && !S.focused) renderBody(); });
  map.on('click', onMapClick);
  // long press → drop pin
  const el = map.getCanvasContainer();
  el.addEventListener('touchstart', (e) => {
    cancelLongPress();
    if (e.touches.length !== 1) return;
    const t = e.touches[0], r = el.getBoundingClientRect();
    lp = { x: t.clientX, y: t.clientY, timer: setTimeout(() => dropPin(map.unproject([t.clientX - r.left, t.clientY - r.top])), 600) };
  }, { passive: true });
  el.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (lp && t && Math.hypot(t.clientX - lp.x, t.clientY - lp.y) > 10) cancelLongPress(); }, { passive: true });
  el.addEventListener('touchend', cancelLongPress, { passive: true });
  map.on('contextmenu', (e) => dropPin(e.lngLat));
}
let lp = null, lastPin = 0;
function cancelLongPress() { if (lp) clearTimeout(lp.timer); lp = null; }

function setupLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['routes', 'inc-lines', 'inc-points']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty });
  const add = (l) => !map.getLayer(l.id) && map.addLayer(l);
  add({ id: 'route-alt', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'alt'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9DB2CC', 'line-width': 7 } });
  add({ id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'sel'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0B4FA8', 'line-width': 11 } });
  add({ id: 'route-line', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'sel'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0A84FF', 'line-width': 7 } });
  add({ id: 'inc-line', type: 'line', source: 'inc-lines', minzoom: 7, layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'sel'], 10, 5], 'line-opacity': 0.9 } });
  add({ id: 'inc-dot', type: 'circle', source: 'inc-points', paint: {
    'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['get', 'major'], 6, 4], 10, ['case', ['get', 'major'], 11, 8], 14, 13] } });
  if (map.getStyle().glyphs) add({ id: 'inc-label', type: 'symbol', source: 'inc-points', minzoom: 8, filter: ['has', 'label'], layout: {
    'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-allow-overlap': false },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
  ['inc-dot', 'route-alt'].forEach((id) => {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
  });
  if (S.settings.threeD) addBuildings3D();
}
function addBuildings3D() {
  // liberty already ships 3D buildings; other OpenFreeMap styles get them added here
  if (map.getLayer('building-3d') || !map.getSource('openmaptiles')) return;
  try {
    map.addLayer({ id: 'building-3d-k', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
      paint: { 'fill-extrusion-color': '#d9d3cc', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.8 } });
  } catch {}
}

function onMapClick(e) {
  cancelLongPress();
  const hits = map.queryRenderedFeatures(e.point, { layers: ['inc-dot', 'route-alt'].filter((l) => map.getLayer(l)) });
  const inc = hits.find((f) => f.layer.id === 'inc-dot');
  if (inc) { const x = currentIncidents().find((i) => i.id === inc.properties.id); if (x) return openIncident(x); }
  const alt = hits.find((f) => f.layer.id === 'route-alt');
  if (alt && !S.navigating) return selectRoute(alt.properties.idx);
  if (S.navigating) return;
  // tap on a POI label of the base map
  const poi = map.queryRenderedFeatures(e.point).find((f) => f.sourceLayer === 'poi' && f.properties?.name);
  if (poi) {
    const [lng, lat] = poi.geometry.coordinates;
    openPlace({ id: `poi-${poi.id ?? `${lat},${lng}`}`, name: poi.properties.name, address: '', loc: { lat, lng }, category: poi.properties.class ? cap(poi.properties.class.replace(/_/g, ' ')) : null, osmId: null });
    reverse({ lat, lng }).then((r) => { if (r && S.view.kind === 'place' && S.view.place.name === poi.properties.name) { Object.assign(S.view.place, { address: r.address || r.name, osmType: r.name === poi.properties.name ? r.osmType : null, osmId: r.name === poi.properties.name ? r.osmId : null }); renderSheet(); loadExtras(S.view.place); } });
  }
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function setData(id, features) { map.getSource(id)?.setData({ type: 'FeatureCollection', features }); }
const lineFeature = (pts, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat]) } });

function currentIncidents() {
  if (!S.settings.incidents) return [];
  const showRoutes = S.view.kind === 'route' || S.navigating || (S.view.kind === 'incident' && S.view.from.kind === 'route');
  return showRoutes && S.mode === 'DRIVE' ? S.routeIncidents : S.traffic;
}

function drawMap() {
  if (!map || !map.isStyleLoaded() || !map.getSource('routes')) return;
  const v = S.view, r = route();
  const showRoutes = v.kind === 'route' || S.navigating || (v.kind === 'incident' && v.from.kind === 'route');
  const feats = [];
  if (showRoutes && r) {
    if (!S.navigating) S.routes.forEach((alt, i) => i !== S.sel && feats.push(lineFeature(alt.points, { kind: 'alt', idx: i })));
    feats.push(lineFeature(r.points, { kind: 'sel' }));
  }
  setData('routes', feats);
  const shown = currentIncidents();
  const selId = v.kind === 'incident' ? v.incident.id : null;
  setData('inc-lines', shown.filter((i) => i.points.length > 1).map((i) => lineFeature(i.points, { color: KIND_HEX[i.kind], sel: i.id === selId })));
  setData('inc-points', shown.map((i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i.pos.lng, i.pos.lat] },
    properties: { id: i.id, color: KIND_HEX[i.kind], major: i.kind === 'JAM' || i.kind === 'CLOSURE', ...(i.delay >= 120 ? { label: `+${Math.round(i.delay / 60)} Min.` } : i.kind === 'CLOSURE' ? { label: 'Gesperrt' } : {}) } })));
  ['inc-line', 'inc-dot', 'inc-label'].forEach((id) => map.getLayer(id) && map.moveLayer(id));
  drawPlaceMarkers();
}
function drawPlaceMarkers() {
  placeMarkers.forEach((m) => m.remove()); placeMarkers = [];
  const add = (loc, html, onClick) => {
    const el = document.createElement('div'); el.innerHTML = html; const node = el.firstElementChild;
    if (onClick) node.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    placeMarkers.push(new maplibregl.Marker({ element: node, anchor: 'bottom' }).setLngLat([loc.lng, loc.lat]).addTo(map));
  };
  const v = S.view, r = route();
  if (v.kind === 'results') v.places.forEach((p) => add(p.loc, `<div class="mk-pin">${ms('location_on')}</div>`, () => openPlace(p, v)));
  if (v.kind === 'place') add(v.place.loc, `<div class="mk-pin ${S.pin ? 'purple' : ''}">${ms('location_on')}</div>`);
  if ((v.kind === 'route' || S.navigating) && r) add(r.points[r.points.length - 1], `<div class="mk-round" style="background:var(--red)">${ms('sports_score')}</div>`);
  else if (v.kind === 'route') add(v.place.loc, `<div class="mk-pin">${ms('location_on')}</div>`);
  if (v.kind === 'home' && !S.navigating) S.favorites.forEach((f) => {
    const [ic, col] = f.kind === 'home' ? ['home', '#0A84FF'] : f.kind === 'work' ? ['work', '#A2845E'] : ['star', '#FFCC00'];
    add(f.loc, `<div class="mk-round" style="background:${col}">${ms(ic)}</div>`, () => onSaved(f));
  });
}

function drawMe() {
  if (!map || !S.fix) return;
  const nav = S.navigating;
  const pos = nav && S.nav?.snapped ? S.nav.snapped : S.fix;
  const h = S.fix.heading;
  const html = nav
    ? `<div class="mk-me nav"><div class="d"></div><div class="arrow">${ms('navigation')}</div></div>`
    : `<div class="mk-me">${h != null ? `<div class="cone" style="transform:rotate(${h}deg)"></div>` : ''}<div class="d"></div></div>`;
  const el = document.createElement('div'); el.innerHTML = html;
  meMarker?.remove();
  meMarker = new maplibregl.Marker({ element: el.firstElementChild, rotationAlignment: nav ? 'map' : 'viewport', rotation: nav ? (h ?? 0) : 0 })
    .setLngLat([pos.lng, pos.lat]).addTo(map);
}

/* ------------------------------------------------------------- camera */
function sheetVisibleHeight() { return S.navigating ? 110 : snaps()[Math.min(S.sheet, 1)]; }
function padding() { return { top: 40, bottom: sheetVisibleHeight(), left: 0, right: 0 }; }
function flyTo(p, zoom = 15) {
  S.following = false; updateControls();
  map.easeTo({ center: [p.lng, p.lat], zoom, padding: padding(), duration: 700 });
}
function fitPoints(pts) {
  if (!pts.length) return;
  const b = new maplibregl.LngLatBounds();
  pts.forEach((p) => b.extend([p.lng, p.lat]));
  map.fitBounds(b, { padding: { top: 70, right: 60, bottom: sheetVisibleHeight() + 20, left: 30 }, maxZoom: 16, duration: 700 });
}
function followCamera(first = false) {
  if (!map || !S.fix || !S.following) return;
  if (S.navigating) {
    const fast = (S.fix.speed ?? 0) > 22;
    const c = S.nav?.snapped ?? S.fix;
    map.easeTo({ center: [c.lng, c.lat], zoom: fast ? 16 : 17.3, bearing: S.fix.heading ?? map.getBearing(), pitch: S.settings.threeD ? 60 : 0,
      padding: { top: ($('navTop').offsetHeight || 150) + 40, bottom: 130, left: 0, right: 0 }, duration: 900 });
  } else if (S.view.kind === 'home') map.easeTo({ center: [S.fix.lng, S.fix.lat], zoom: first ? 15 : map.getZoom(), padding: padding(), duration: first ? 0 : 600 });
}

/* ============================================================== location */
function startLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition((p) => {
    const first = !S.fix, c = p.coords;
    S.fix = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed != null && c.speed >= 0 ? c.speed : null,
      heading: c.heading != null && !isNaN(c.heading) && c.heading >= 0 && (c.speed ?? 0) > 0.8 ? c.heading : (S.fix?.heading ?? null) };
    S.denied = false;
    if (S.navigating) navTick();
    drawMe();
    if (first) { S.following = true; followCamera(true); if (S.view.kind === 'home') renderBody(); }
    else followCamera();
  }, (err) => { if (err.code === 1) { S.denied = true; toast('Standortzugriff verweigert – in den iPhone-Einstellungen erlauben.'); } },
  { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}

/* ============================================================== traffic */
async function loadTraffic(force = false) {
  if (!S.settings.incidents) return;
  S.trafficLoading = true; S.trafficError = null; S.trafficProgress = 0;
  if (S.view.kind === 'home') renderBody();
  let last = 0;
  try {
    S.traffic = await trafficGermany({ force, roadworks: S.settings.roadworks, onProgress: (p) => {
      S.trafficProgress = p;
      if (S.view.kind === 'home' && p - last > 0.1) { last = p; const el = $('trafficProgress'); if (el) el.textContent = `${Math.round(p * 100)} %`; }
    } });
    if (!S.traffic.length) S.trafficError = 'Keine Daten von der Autobahn-Verkehrszentrale erhalten.';
  } catch (e) { S.trafficError = e.message; }
  S.trafficLoading = false;
  if (route()) S.routeIncidents = incidentsOnRoute(route(), S.traffic);
  if (S.view.kind === 'home') renderBody();
  if (S.view.kind === 'route') renderBody();
  drawMap();
}
setInterval(() => { if (document.visibilityState === 'visible') loadTraffic(); }, 5 * 60 * 1000);

/* ================================================================ routing */
async function loadRoutes({ quiet = false, fit = false } = {}) {
  const target = S.navigating ? S.navTarget : S.view.kind === 'route' ? S.view.place : null;
  if (!target) return;
  if (!S.fix) { S.routeError = S.denied ? 'Standortzugriff verweigert – Route kann nicht berechnet werden.' : 'Warte auf GPS-Standort …'; renderBody(); return; }
  if (!quiet) { S.routeLoading = true; S.routeError = null; renderBody(); }
  try {
    const res = await computeRoutes(S.fix, target.loc, S.mode, { alternatives: !S.navigating, avoidHighways: S.settings.avoidHighways });
    if (!res.length) throw new Error('Keine Route gefunden.');
    S.routes = res; S.sel = 0;
    S.routeIncidents = incidentsOnRoute(res[0], S.traffic);
    if (fit) fitPoints(res[0].points);
  } catch (e) { if (!quiet) { S.routes = []; S.routeError = e.message || 'Route konnte nicht berechnet werden.'; } }
  S.routeLoading = false; S.rerouting = false;
  if (S.navigating) navTick(); else renderBody();
  drawMap(); updatePill();
}
function selectRoute(i) { S.sel = +i; haptic(); S.routeIncidents = incidentsOnRoute(route(), S.traffic); renderBody(); drawMap(); updatePill(); }
function routeDelay(r) { return incidentsOnRoute(r, S.traffic).reduce((s, i) => s + (i.delay || 0), 0); }
function updatePill() {
  const el = $('pill'), r = route();
  const d = r && S.mode === 'DRIVE' ? S.routeIncidents.reduce((s, i) => s + (i.delay || 0), 0) : 0;
  const closed = S.routeIncidents.some((i) => i.kind === 'CLOSURE');
  if (!S.navigating && S.view.kind === 'route' && r && (d > 60 || closed) && S.sheet < 2) {
    el.innerHTML = `<span class="dot" style="background:${closed || d > 600 ? 'var(--red)' : 'var(--orange)'}"></span>${closed ? 'Sperrung auf der Route' : `+${fmtDur(d)} Stau`}`;
    el.hidden = false;
  } else el.hidden = true;
}

/* ============================================================= navigation */
let announced = new Set(), offCount = 0, lastReroute = 0, navTimer, wakeLock;
function speak(text) {
  if (!S.settings.voice || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.rate = 1;
  speechSynthesis.speak(u);
}
const say = (key, text) => { if (!announced.has(key)) { announced.add(key); speak(text); } };
const spokenDist = (m) => (m >= 1000 ? `${(Math.round(m / 100) / 10).toString().replace('.', ',')} Kilometern` : `${Math.round(m / 50) * 50 || 50} Metern`);

async function startNav() {
  const r = route(); if (!r) return;
  haptic();
  try { speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(' '), { volume: 0 })); } catch {}
  S.navTarget = S.view.place;
  S.routes = [r]; S.sel = 0;
  S.navigating = true; S.following = true; announced = new Set(); offCount = 0; lastReroute = Date.now();
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  navTimer = setInterval(() => { if (Date.now() - lastReroute > 120000) { lastReroute = Date.now(); loadTraffic(); } }, 15000);
  $('sheet').hidden = true; $('controls').hidden = true; $('pill').hidden = true;
  if (r.steps[0]) say('start', r.steps[1] ? `${r.steps[0].instruction}. Dann ${r.steps[1].instruction}.` : r.steps[0].instruction);
  navTick(); drawMap(); drawMe(); followCamera();
}
function endNav() {
  S.navigating = false; S.nav = null; clearInterval(navTimer);
  try { speechSynthesis.cancel(); } catch {}
  try { wakeLock?.release(); } catch {}
  ['navTop', 'navBottom', 'navAlert', 'recenter'].forEach((id) => ($(id).hidden = true));
  $('sheet').hidden = false; $('controls').hidden = false;
  S.view = { kind: 'home' }; S.routes = []; S.routeIncidents = []; S.sheet = 1; S.following = true;
  if (S.fix) map.easeTo({ center: [S.fix.lng, S.fix.lat], zoom: 15, bearing: 0, pitch: S.settings.threeD ? 45 : 0, padding: padding() });
  renderSheet(); drawMap(); drawMe();
}
document.addEventListener('visibilitychange', async () => {
  if (S.navigating && document.visibilityState === 'visible') { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
});

function navTick() {
  const r = route(), f = S.fix;
  if (!S.navigating || !r || !f || r.points.length < 2) return renderNav();
  const total = r.distance || 1;
  const snap = snapToPath(f, r.points);
  const geom = r._geom || (r._geom = pathLength(r.points) || 1);
  const along = (snap.along / geom) * total;
  const remaining = Math.max(0, total - along);
  let acc = 0; const ends = r.steps.map((s) => (acc += s.distance));
  let si = ends.findIndex((e) => e > along); if (si < 0) si = Math.max(0, ends.length - 1);
  const toMan = Math.max(0, (ends[si] ?? total) - along);

  const tol = Math.max(45, (f.accuracy ?? 20) * 1.5);
  offCount = snap.offset > tol ? offCount + 1 : 0;
  if (offCount >= 3 && Date.now() - lastReroute > 12000) {
    lastReroute = Date.now(); offCount = 0; S.rerouting = true;
    speak('Route wird neu berechnet.');
    loadRoutes({ quiet: true });
  }
  const next = r.steps[si + 1];
  const arrived = remaining < 25;
  if (arrived) say('arrived', 'Sie haben Ihr Ziel erreicht.');
  else if (next) {
    const th = r.mode === 'WALK' ? [60, 15] : (f.speed ?? 0) > 22 ? [2000, 800, 120] : [500, 150, 30];
    for (const t of th) if (toMan <= t && toMan > t * 0.4) { say(`${r.id}-${si}-${t}`, t <= 30 ? next.instruction : `In ${spokenDist(toMan)}: ${next.instruction}`); break; }
  }
  const ahead = S.routeIncidents.filter((i) => i.at + (i.length || 0) > along).sort((a, b) => a.at - b.at)[0];
  const nextInc = ahead ? { inc: ahead, dist: Math.max(0, ahead.at - along) } : null;
  if (nextInc && nextInc.dist < 5000 && nextInc.dist > 100) {
    say('inc-' + nextInc.inc.id, `Achtung, ${KIND[nextInc.inc.kind].label} in ${spokenDist(nextInc.dist)} auf der ${nextInc.inc.road}.`);
  }
  const elapsedShare = remaining / total;
  S.nav = { si, toMan, remaining, remainingSec: r.duration * elapsedShare + (nextInc?.inc.delay || 0), arrived, nextInc, snapped: snap.offset < tol ? snap.point : null };
  renderNav();
}

function renderNav() {
  if (!S.navigating) return;
  const r = route(); if (!r) return;
  const n = S.nav, si = n?.si ?? 0;
  const next = r.steps[si + 1] || r.steps[si], after = r.steps[si + 2];
  const top = $('navTop'); top.hidden = false;
  top.innerHTML = n?.arrived
    ? `<div class="main">${ms('sports_score', 'big')}<div class="dist">Ziel erreicht</div></div>`
    : `<div class="main">${ms(mIcon(next?.maneuver), 'big')}<div style="flex:1;min-width:0">
        <div class="dist">${fmtDist(n?.toMan ?? r.steps[0]?.distance ?? 0)}</div>
        <div class="ins">${esc(S.rerouting ? 'Route wird neu berechnet …' : next?.instruction || 'Der Route folgen')}</div></div></div>
       ${after ? `<div class="then">Dann ${ms(mIcon(after.maneuver))}</div>` : ''}`;
  const al = $('navAlert');
  if (n?.nextInc && n.nextInc.dist < 20000) {
    const k = KIND[n.nextInc.inc.kind];
    al.hidden = false; al.style.background = `color-mix(in srgb, ${k.color} 80%, transparent)`; al.style.top = top.offsetHeight + 10 + 'px';
    al.innerHTML = `${ms(k.icon)}<span>${k.label} in ${fmtDist(n.nextInc.dist)}${n.nextInc.inc.delay ? ` · +${fmtDur(n.nextInc.inc.delay)}` : ''}</span>`;
  } else al.hidden = true;
  const rem = n?.remainingSec ?? r.duration;
  const b = $('navBottom'); b.hidden = false;
  b.innerHTML = `<button class="round" data-action="toggle-voice">${ms(S.settings.voice ? 'volume_up' : 'volume_off')}</button>
    <button class="mid" data-action="overview">
      <span class="nv"><b>${fmtClock(new Date(Date.now() + rem * 1000))}</b><small>Ankunft</small></span>
      <span class="nv"><b style="color:${n?.nextInc?.inc.delay > 300 ? 'var(--orange)' : 'var(--green)'}">${fmtDur(rem)}</b><small>Fahrzeit</small></span>
      <span class="nv"><b>${fmtDist(n?.remaining ?? r.distance)}</b><small>Distanz</small></span></button>
    <button class="end" data-action="end-nav">Beenden</button>`;
  $('recenter').hidden = S.following;
}

/* ============================================================ interaction */
function addRecent(p) {
  if (String(p.id).startsWith('pin-')) return;
  S.recents = [{ id: p.id, name: p.name, address: p.address, loc: p.loc, osmType: p.osmType, osmId: p.osmId }, ...S.recents.filter((r) => r.id !== p.id)].slice(0, 15);
  LS.set('recents', S.recents);
}
function saveFav(p, kind = 'favorite') {
  S.favorites = S.favorites.filter((f) => f.id !== p.id && (kind === 'favorite' || f.kind !== kind));
  S.favorites.push({ id: p.id, name: kind === 'home' ? 'Zuhause' : kind === 'work' ? 'Arbeit' : p.name, address: p.address, loc: p.loc, kind, osmType: p.osmType, osmId: p.osmId });
  LS.set('favorites', S.favorites); haptic();
  toast(kind === 'home' ? 'Als Zuhause gesichert' : kind === 'work' ? 'Als Arbeit gesichert' : 'Zu Favoriten hinzugefügt');
}
function removeFav(id) { S.favorites = S.favorites.filter((f) => f.id !== id); LS.set('favorites', S.favorites); }
const isFav = (id) => S.favorites.some((f) => f.id === id);

function setView(v, sheet = 1) {
  S.view = v; S.sheet = sheet; S.focused = false;
  if (v.kind !== 'route' && !(v.kind === 'incident' && v.from.kind === 'route')) { S.routes = []; S.routeIncidents = []; }
  renderSheet(); drawMap(); updatePill();
}
async function loadExtras(p) {
  if (p._extras || !p.osmId) return;
  p._extras = true;
  const x = await placeExtras(p);
  Object.keys(x).forEach((k) => x[k] && (p[k] = p[k] || x[k]));
  if (S.view.kind === 'place' && S.view.place === p) renderBody();
}
function openPlace(place, from) {
  S.pin = String(place.id).startsWith('pin-');
  addRecent(place);
  if (S.pendingKind) { saveFav(place, S.pendingKind); S.pendingKind = null; }
  setView({ kind: 'place', place, from });
  flyTo(place.loc, Math.max(map.getZoom(), 16));
  loadExtras(place);
}
function openRoute(place, from) {
  S.showSteps = false;
  setView({ kind: 'route', place, from });
  loadRoutes({ fit: true });
}
function onSaved(f) {
  const place = { ...f };
  if (f.kind === 'home' || f.kind === 'work') openRoute(place); else openPlace(place);
}
function openIncident(inc) {
  const from = S.view.kind === 'incident' ? S.view.from : S.view;
  S.view = { kind: 'incident', incident: inc, from }; S.sheet = 1;
  renderSheet(); drawMap();
  if (!S.navigating) flyTo(inc.pos, Math.max(map.getZoom(), 12));
}
async function dropPin(lngLat) {
  cancelLongPress();
  if (!lngLat || S.navigating || Date.now() - lastPin < 1000) return;
  lastPin = Date.now(); haptic();
  const loc = { lat: lngLat.lat, lng: lngLat.lng };
  const place = { id: `pin-${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`, name: 'Markierter Ort', address: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`, loc };
  S.pin = true;
  setView({ kind: 'place', place });
  const r = await reverse(loc);
  if (r && S.view.kind === 'place' && S.view.place.id === place.id) { place.address = [r.name !== r.address ? r.name : null, r.address].filter(Boolean).join(', '); renderSheet(); }
}
function goBack() {
  if (!$('layers').hidden) return ($('layers').hidden = true);
  if (S.navigating) return;
  const v = S.view;
  if (S.focused) { S.focused = false; S.query = ''; S.pendingKind = null; S.sheet = 1; return renderSheet(); }
  if (v.kind === 'incident') { S.view = v.from; S.sheet = 1; renderSheet(); drawMap(); updatePill(); return; }
  if (v.kind === 'place' || v.kind === 'route') return setView(v.from || { kind: 'home' });
  if (v.kind === 'results') return setView({ kind: 'home' });
}

async function runCategory(i) {
  const [label, filter, , , word] = CATEGORIES[i];
  document.activeElement?.blur?.();
  S.searching = true; renderHeaderLoading();
  try {
    const c = near();
    let places = (await nearby(filter, c, map.getZoom() < 12 ? 10000 : 4000, word)).slice(0, 30);
    if (!places.length) places = (await nearby(filter, c, 15000, word)).slice(0, 30); // widen the search
    if (!places.length) toast(`Keine ${label} in der Nähe gefunden`);
    S.query = '';
    setView({ kind: 'results', query: label, places });
    if (places.length) fitPoints(places.slice(0, 15).map((p) => p.loc));
  } catch (e) { toast(`${label} konnten nicht geladen werden – bitte gleich nochmal versuchen.`); }
  S.searching = false; renderHeaderLoading();
}
async function runSearch(q) {
  document.activeElement?.blur?.();
  S.searching = true; renderHeaderLoading();
  try {
    const places = await autocomplete(q, near());
    S.query = '';
    if (places.length === 1) openPlace(places[0]);
    else { setView({ kind: 'results', query: q, places }); if (places.length) fitPoints(places.map((p) => p.loc)); }
  } catch (e) { toast(e.message); }
  S.searching = false; renderHeaderLoading();
}
let acTimer, acSeq = 0;
function onQuery(q) {
  S.query = q;
  clearTimeout(acTimer);
  if (q.trim().length < 2) { S.suggestions = []; renderBody(); return; }
  const id = ++acSeq;
  acTimer = setTimeout(async () => {
    S.searching = true; renderHeaderLoading();
    try { const s = await autocomplete(q.trim(), near()); if (id === acSeq) S.suggestions = s; }
    catch (e) { if (id === acSeq) { S.suggestions = []; toast(e.message); } }
    if (id === acSeq) { S.searching = false; renderHeaderLoading(); renderBody(); }
  }, 250);
  renderBody();
}

/* ============================================================== rendering */
function renderSheet() { renderHeader(); renderBody(); placeSheet(); }

function renderHeader() {
  const v = S.view, h = $('sheetHeader');
  if (v.kind === 'home') {
    h.innerHTML = `<div class="search"><div class="field">${ms('search')}
      <input id="q" type="search" enterkeyhint="search" placeholder="Suche nach Orten und Adressen" autocomplete="off" autocorrect="off" value="${esc(S.query)}">
      <span id="qState"></span></div>
      ${S.focused ? '<button class="cancel" data-action="cancel-search">Abbrechen</button>' : ''}</div>`;
    const q = $('q');
    q.addEventListener('focus', () => { if (!S.focused) { S.focused = true; S.sheet = 2; placeSheet(); renderHeaderCancel(); } });
    q.addEventListener('input', (e) => onQuery(e.target.value));
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && q.value.trim()) runSearch(q.value.trim()); });
    renderHeaderLoading();
  } else if (v.kind === 'results') {
    h.innerHTML = `<div class="hrow"><div class="grow"><h2 class="title">${esc(v.query)}</h2><div class="meta">${v.places.length} Ergebnisse</div></div>
      <button class="close" data-action="back">${ms('close')}</button></div>`;
  } else if (v.kind === 'place') {
    const p = v.place;
    const meta = [p.category, S.fix ? fmtDist(distance(S.fix, p.loc)) : null].filter(Boolean).join(' · ');
    h.innerHTML = `<div class="hrow"><div class="grow"><h2 class="title">${esc(p.name)}</h2>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</div>
      <button class="close" data-action="back">${ms('close')}</button></div>`;
  } else if (v.kind === 'route') {
    h.innerHTML = `<div class="hrow" style="padding-bottom:0"><div class="grow"><h2 class="title s">Route nach ${esc(v.place.name)}</h2><div class="meta">Von: Mein Standort</div></div>
      <button class="close" data-action="back">${ms('close')}</button></div>
      <div class="segment" style="--n:${Object.keys(MODE_ICON).length};--i:${Object.keys(MODE_ICON).indexOf(S.mode)}"><span class="thumb"></span>${Object.keys(MODE_ICON).map((m) => `<button class="${m === S.mode ? 'on' : ''}" data-action="mode" data-mode="${m}">${ms(MODE_ICON[m])}</button>`).join('')}</div>
      <div style="height:10px"></div>`;
  } else if (v.kind === 'incident') {
    const i = v.incident, k = KIND[i.kind];
    h.innerHTML = `<div class="hrow" style="align-items:center"><span class="ricon" style="width:44px;height:44px;background:${k.color}">${ms(k.icon)}</span>
      <div class="grow"><h2 class="title s">${esc(k.label)} · ${esc(i.road)}</h2><div class="meta">${esc(i.subtitle || i.title)}</div></div>
      <button class="close" data-action="back">${ms('close')}</button></div>`;
  }
}
function renderHeaderCancel() {
  const s = document.querySelector('.search');
  if (s && !s.querySelector('.cancel')) s.insertAdjacentHTML('beforeend', '<button class="cancel" data-action="cancel-search">Abbrechen</button>');
}
function renderHeaderLoading() {
  const el = $('qState'); if (!el) return;
  el.innerHTML = S.searching ? '<span class="spin"></span>' : S.query ? `<button data-action="clear-q" style="color:var(--sub)">${ms('cancel')}</button>` : '';
}

function renderBody() {
  const v = S.view, b = $('sheetBody');
  let html = '';
  if (v.kind === 'home') html = homeBody();
  else if (v.kind === 'results') html = v.places.length ? v.places.map((p, i) => row({
    icon: 'location_on', bg: 'var(--red)', t: p.name, action: 'result', data: { i },
    s: [p.category, S.fix ? fmtDist(distance(S.fix, p.loc)) : null, p.address].filter(Boolean).join(' · '),
  })).join('') : '<p class="empty">Keine Ergebnisse gefunden.</p>';
  else if (v.kind === 'place') html = placeBody(v.place);
  else if (v.kind === 'route') html = routeBody();
  else if (v.kind === 'incident') html = incidentBody(v.incident);
  b.innerHTML = html;
}

function nearbyTraffic() {
  if (!map) return [];
  const c = S.fix && S.following ? S.fix : center();
  const radius = Math.max(30000, Math.min(250000, 40000000 / 2 ** map.getZoom() * 6));
  return S.traffic.filter((i) => i.kind !== 'ROADWORKS' && distance(c, i.pos) < radius)
    .map((i) => ({ i, d: distance(c, i.pos) }))
    .sort((a, b) => ({ CLOSURE: 0, JAM: 0, SLOW: 1, WARNING: 2 }[a.i.kind] - { CLOSURE: 0, JAM: 0, SLOW: 1, WARNING: 2 }[b.i.kind]) || a.d - b.d)
    .slice(0, 10);
}

function homeBody() {
  if (S.query.trim().length >= 2) {
    return S.suggestions.map((s, i) => row({
      icon: 'location_on', bg: 'var(--red)', t: s.name, action: 'suggestion', data: { i },
      s: [S.fix ? fmtDist(distance(S.fix, s.loc)) : null, s.category, s.address].filter(Boolean).join(' · '),
    })).join('') + row({ icon: 'search', bg: '#8E8E93', t: `„${S.query.trim()}“ suchen`, action: 'search-text' });
  }
  const home = S.favorites.find((f) => f.kind === 'home'), work = S.favorites.find((f) => f.kind === 'work');
  const others = S.favorites.filter((f) => f.kind === 'favorite');
  const fav = (icon, col, l, sl, action, data = {}) => `<button class="fav" data-action="${action}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>
    <div class="bubble" style="color:${col}">${ms(icon)}</div><div class="l">${esc(l)}</div><div class="sl">${esc(sl)}</div></button>`;
  let h = '';
  if (S.pendingKind) h += `<p class="empty" style="color:var(--accent)">Suche die Adresse für „${S.pendingKind === 'home' ? 'Zuhause' : 'Arbeit'}“</p>`;
  h += `<div class="section"><h3>Favoriten</h3></div><div class="hscroll">
    ${home ? fav('home', '#0A84FF', 'Zuhause', 'Route', 'saved', { id: home.id }) : fav('home', '#0A84FF', 'Zuhause', 'Hinzufügen', 'set-kind', { kind: 'home' })}
    ${work ? fav('work', '#A2845E', 'Arbeit', 'Route', 'saved', { id: work.id }) : fav('work', '#A2845E', 'Arbeit', 'Hinzufügen', 'set-kind', { kind: 'work' })}
    ${others.map((f) => fav('star', '#FFCC00', f.name, S.fix ? fmtDist(distance(S.fix, f.loc)) : '', 'saved', { id: f.id })).join('')}
  </div>
  <div class="hscroll chips">${CATEGORIES.map(([l, , ic, c], i) => `<button class="chip" data-action="category" data-i="${i}"><span class="ms" style="color:${c}">${ic}</span>${l}</button>`).join('')}</div>
  <div class="section"><h3>Verkehrslage</h3>${S.trafficLoading ? `<span style="display:flex;gap:6px;align-items:center;color:var(--sub);font-size:13px"><span id="trafficProgress">${Math.round(S.trafficProgress * 100)} %</span><span class="spin"></span></span>` : `<button data-action="refresh-incidents" aria-label="Aktualisieren">${ms('refresh')}</button>`}</div>`;
  if (!S.settings.incidents) h += '<p class="empty">Verkehrsmeldungen sind ausgeschaltet.</p>';
  else if (S.trafficError) h += `<p class="empty" style="color:var(--red)">${esc(S.trafficError)}</p>`;
  else if (!S.trafficLoading || S.traffic.length) {
    const list = nearbyTraffic();
    h += list.length ? list.map(({ i, d }) => row({
      icon: KIND[i.kind].icon, bg: KIND[i.kind].color, t: incTitle(i), action: 'incident', data: { id: i.id },
      s: [incSub(i), `${fmtDist(d)} entfernt`].filter(Boolean).join(' · '),
    })).join('') : '<p class="empty">Keine Staus oder Sperrungen auf Autobahnen in der Nähe.</p>';
    if (S.traffic.length) {
      const jams = S.traffic.filter((i) => i.kind === 'JAM').length, cl = S.traffic.filter((i) => i.kind === 'CLOSURE').length;
      h += `<p class="empty" style="font-size:12px">Deutschlandweit: ${jams} Staus · ${cl} Sperrungen · Quelle: Autobahn GmbH des Bundes</p>`;
    }
  }
  if (S.recents.length) h += '<div class="section"><h3>Zuletzt gesucht</h3></div>' + S.recents.map((r, i) => row({ icon: 'schedule', bg: '#8E8E93', t: r.name, s: r.address, action: 'recent', data: { i } })).join('');
  h += `<p class="empty" style="font-size:12px;margin-top:20px">Karten: © OpenStreetMap-Mitwirkende, OpenFreeMap · Suche: Photon · Routen: OSRM · Verkehr: Autobahn GmbH<br>Version ${APP_VERSION}</p>`;
  return h;
}

function placeBody(p) {
  const fav = isFav(p.id);
  const tel = p.phone?.replace(/[^\d+]/g, '');
  const web = p.website && !/^https?:/.test(p.website) ? 'https://' + p.website : p.website;
  let h = `<div class="actions">
    <button class="act primary" data-action="route-to">${ms('directions_car')}<span>Route</span></button>
    ${p.phone ? `<a class="act" href="tel:${esc(tel)}">${ms('call')}<span>Anrufen</span></a>` : ''}
    ${web ? `<a class="act" href="${esc(web)}" target="_blank" rel="noopener">${ms('language')}<span>Website</span></a>` : ''}
    <button class="act" data-action="toggle-fav">${ms('star', fav ? '' : 'o')}<span>${fav ? 'Gesichert' : 'Sichern'}</span></button>
    <button class="act" data-action="share">${ms('ios_share')}<span>Teilen</span></button></div>`;
  h += `<div class="card"><h4>Details</h4>
    ${p.address ? `<div class="kv"><div class="k">Adresse</div><div class="v">${esc(p.address)}</div></div>` : ''}
    ${p.hours ? `<div class="kv"><div class="k">Öffnungszeiten</div><div class="v">${esc(p.hours).replace(/;\s*/g, '<br>')}</div></div>` : ''}
    ${p.phone ? `<div class="kv"><div class="k">Telefon</div><div class="v"><a href="tel:${esc(tel)}">${esc(p.phone)}</a></div></div>` : ''}
    ${web ? `<div class="kv"><div class="k">Website</div><div class="v"><a href="${esc(web)}" target="_blank" rel="noopener">${esc(web.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></div></div>` : ''}
    ${p.operator ? `<div class="kv"><div class="k">Betreiber</div><div class="v">${esc(p.operator)}</div></div>` : ''}
    ${p.cuisine ? `<div class="kv"><div class="k">Küche</div><div class="v">${esc(p.cuisine.replace(/;/g, ', '))}</div></div>` : ''}
    ${p.wheelchair ? `<div class="kv"><div class="k">Rollstuhlgerecht</div><div class="v">${{ yes: 'Ja', no: 'Nein', limited: 'Eingeschränkt' }[p.wheelchair] || esc(p.wheelchair)}</div></div>` : ''}
    <div class="kv"><div class="k">Koordinaten</div><div class="v">${p.loc.lat.toFixed(5)}° N, ${p.loc.lng.toFixed(5)}° E</div></div></div>`;
  h += `<a class="row" href="https://maps.apple.com/?ll=${p.loc.lat},${p.loc.lng}&q=${encodeURIComponent(p.name)}" target="_blank" rel="noopener">
      <span class="ricon" style="background:#8E8E93">${ms('open_in_new')}</span><span class="txt"><div class="t">In Apple Karten öffnen</div></span></a>`;
  return h;
}

function routeBody() {
  if (S.routeLoading && !S.routes.length) return '<div style="text-align:center;padding:30px"><span class="spin"></span></div>';
  if (S.routeError) return `<p class="empty" style="color:var(--red)">${esc(S.routeError)}</p>`;
  const r = route(); if (!r) return '<p class="empty">Keine Route gefunden.</p>';
  const drive = S.mode === 'DRIVE';
  let h = S.routes.map((rt, i) => {
    const d = drive ? routeDelay(rt) : 0;
    const inc = drive ? incidentsOnRoute(rt, S.traffic) : [];
    const closed = inc.some((x) => x.kind === 'CLOSURE');
    const col = closed || d > 600 ? 'var(--red)' : d > 60 || inc.length ? 'var(--orange)' : 'var(--green)';
    const status = closed ? 'Sperrung auf der Strecke' : d > 60 ? `+${fmtDur(d)} durch Staus` : inc.length ? `${inc.length} Verkehrsmeldung${inc.length > 1 ? 'en' : ''}` : 'Keine Meldungen';
    return `<div class="route ${i === S.sel ? 'on' : ''}" data-action="select-route" data-i="${i}" role="button">
      <div class="info"><div class="eta">${fmtDur(rt.duration + d)}</div>
      <div class="sm">${fmtDist(rt.distance)} · Ankunft ${fmtClock(new Date(Date.now() + (rt.duration + d) * 1000))}</div>
      ${drive ? `<div class="delay" style="color:${col}">${status}</div>` : ''}
      ${rt.description ? `<div class="sm">über ${esc(rt.description)}</div>` : ''}</div>
      ${i === S.sel ? '<button class="go" data-action="start-nav">Los</button>' : ''}</div>`;
  }).join('');
  if (drive) {
    h += '<div class="section"><h3>Meldungen auf der Route</h3></div>';
    h += S.routeIncidents.length ? S.routeIncidents.map((inc) => row({
      icon: KIND[inc.kind].icon, bg: KIND[inc.kind].color, t: incTitle(inc), action: 'incident', data: { id: inc.id },
      s: [`in ${fmtDist(inc.at)}`, incSub(inc)].filter(Boolean).join(' · '),
    })).join('') : `<div class="ok"><span class="ms" style="color:var(--green)">check_circle</span>Keine Staus oder Sperrungen gemeldet</div>`;
    h += '<p class="empty" style="font-size:12px">Verkehrsmeldungen gibt es für Autobahnen. Auf anderen Straßen wird ohne Verkehr gerechnet.</p>';
    h += `<div class="card" style="padding-block:2px">${toggle('opt-avoidHighways', 'Autobahnen vermeiden', '', S.settings.avoidHighways)}</div>`;
  }
  h += `<button class="section" style="width:100%" data-action="toggle-steps"><h3>Wegbeschreibung (${r.steps.length})</h3>${ms(S.showSteps ? 'expand_less' : 'expand_more')}</button>`;
  if (S.showSteps) h += r.steps.map((s) => row({ icon: mIcon(s.maneuver), bg: '#8E8E93', t: s.instruction, s: s.distance ? fmtDist(s.distance) : '' })).join('');
  return h;
}

function incidentBody(i) {
  const item = (ic, k, v) => `<div class="opt">${ms(ic)}<span style="flex:1;color:var(--sub)">${k}</span><b style="text-align:right">${v}</b></div>`;
  const since = i.since ? new Date(i.since) : null;
  return `<div class="card" style="margin-top:0">
    ${i.length ? item('straighten', 'Länge', fmtDist(i.length)) : ''}
    ${i.delay ? item('schedule', 'Verzögerung', `+${fmtDur(i.delay)}`) : ''}
    ${i.speed ? item('speed', 'Ø Geschwindigkeit', `${i.speed} km/h`) : ''}
    ${since && !isNaN(since) ? item('history', 'Seit', `${since.toLocaleDateString('de-DE')} ${fmtClock(since)}`) : ''}
    ${i.at != null ? item('route', 'Auf deiner Route in', fmtDist(i.at)) : ''}</div>
    ${i.description.length ? `<div class="card">${i.description.map((d) => `<div style="margin:3px 0">${esc(d)}</div>`).join('')}</div>` : ''}
    <p class="empty" style="font-size:12px">Quelle: Autobahn GmbH des Bundes (verkehr.autobahn.de)</p>`;
}

function renderLayers() {
  const st = S.settings;
  const types = [['liberty', 'Standard', 'map'], ['bright', 'Bunt', 'palette'], ['positron', 'Hell', 'light_mode'], ['satellite', 'Satellit', 'satellite_alt']];
  $('layersCard').innerHTML = `<div class="hrow" style="padding:0;align-items:center"><h2 class="title s grow">Karten auswählen</h2><button class="close" data-action="close-layers">${ms('close')}</button></div>
    <div class="types">${types.map(([k, l, ic]) => `<button class="type ${st.mapType === k ? 'on' : ''}" data-action="map-type" data-type="${k}">${ms(ic)}${l}</button>`).join('')}</div>
    <div class="card" style="margin:14px 0 0;padding-block:2px">
      ${toggle('set-incidents', 'Verkehrsmeldungen', 'Staus & Sperrungen auf Autobahnen', st.incidents)}
      ${toggle('set-roadworks', 'Baustellen anzeigen', 'Autobahn-Baustellen (viele Einträge)', st.roadworks)}
      ${toggle('set-threeD', '3D-Ansicht', 'Geneigte Karte & Gebäude', st.threeD)}
      ${toggle('set-voice', 'Sprachansagen', '', st.voice)}</div>
    <div class="foot">© OpenStreetMap-Mitwirkende · OpenFreeMap · Esri · Autobahn GmbH</div>`;
}
function updateControls() {
  $('btnIncidents').classList.toggle('on', S.settings.incidents);
  $('btn3d').classList.toggle('on', S.settings.threeD);
  $('locateIcon').classList.toggle('o', !S.following);
}

/* ============================================================ bottom sheet */
let _sb = null;
function safeBottom() {
  if (_sb == null) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px)'; document.body.appendChild(d); _sb = d.offsetHeight; d.remove(); }
  return _sb;
}
function snaps() {
  const H = window.innerHeight, full = $('sheet').offsetHeight || H;
  return [safeBottom() + 84, Math.round(H * 0.44), full];
}
function placeSheet() {
  const el = $('sheet'), full = el.offsetHeight || window.innerHeight;
  el.style.transform = `translateY(${full - snaps()[S.sheet]}px)`;
  el.dataset.snap = S.sheet;
  document.body.dataset.sheet = S.sheet;
  updatePill();
}
(function setupDrag() {
  const el = $('sheet'), handle = $('sheetDrag');
  let startY = 0, startT = 0, lastY = 0, lastTime = 0, vel = 0, dragging = false, pid = null;
  const curT = () => { const m = /translateY\(([-\d.]+)px\)/.exec(el.style.transform); return m ? parseFloat(m[1]) : 0; };
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input,button,a')) return;
    pid = e.pointerId; startY = lastY = e.clientY; startT = curT(); lastTime = performance.now(); vel = 0; dragging = true;
    el.classList.add('dragging'); handle.setPointerCapture(pid);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pid) return;
    const now = performance.now();
    vel = (e.clientY - lastY) / Math.max(1, now - lastTime); lastY = e.clientY; lastTime = now;
    const full = el.offsetHeight, max = full - snaps()[0];
    el.style.transform = `translateY(${Math.max(-20, Math.min(max + 30, startT + e.clientY - startY))}px)`;
  });
  const end = (e) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false; el.classList.remove('dragging');
    const full = el.offsetHeight, proj = curT() + vel * 180, sp = snaps();
    let best = 0;
    sp.forEach((s, i) => { if (Math.abs(full - s - proj) < Math.abs(full - sp[best] - proj)) best = i; });
    if (Math.abs(lastY - startY) < 4) best = S.sheet === 0 ? 1 : S.sheet;
    S.sheet = best;
    if (best < 2 && S.focused) { S.focused = false; document.activeElement?.blur?.(); }
    placeSheet();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { _sb = null; placeSheet(); });
})();

/* ================================================================ actions */
const A = {
  back: goBack,
  'cancel-search': () => { S.focused = false; S.query = ''; S.suggestions = []; S.pendingKind = null; S.sheet = 1; document.activeElement?.blur?.(); renderSheet(); },
  'clear-q': () => { S.query = ''; S.suggestions = []; $('q').value = ''; $('q').focus(); renderHeaderLoading(); renderBody(); },
  suggestion: ({ i }) => { const s = S.suggestions[i]; if (!s) return; document.activeElement?.blur?.(); S.query = ''; S.suggestions = []; openPlace(s); },
  'search-text': () => runSearch(S.query.trim()),
  category: ({ i }) => { S.query = ''; runCategory(+i); },
  result: ({ i }) => openPlace(S.view.places[i], S.view),
  recent: ({ i }) => openPlace({ ...S.recents[i] }),
  saved: ({ id }) => { const f = S.favorites.find((x) => x.id === id); if (f) onSaved(f); },
  'set-kind': ({ kind }) => { S.pendingKind = kind; S.focused = true; S.sheet = 2; renderSheet(); setTimeout(() => $('q')?.focus(), 50); },
  incident: ({ id }) => { const x = S.traffic.find((i) => i.id === id) || S.routeIncidents.find((i) => i.id === id); if (x) openIncident(S.routeIncidents.find((i) => i.id === id) || x); },
  'refresh-incidents': () => loadTraffic(true),
  'route-to': () => openRoute(S.view.place, S.view),
  'toggle-fav': () => { const p = S.view.place; isFav(p.id) ? removeFav(p.id) : saveFav(p); renderBody(); },
  share: async () => {
    const p = S.view.place;
    const url = `https://www.openstreetmap.org/?mlat=${p.loc.lat}&mlon=${p.loc.lng}#map=17/${p.loc.lat}/${p.loc.lng}`;
    try { if (navigator.share) await navigator.share({ title: p.name, text: `${p.name}\n${p.address}`, url }); else { await navigator.clipboard.writeText(url); toast('Link kopiert'); } } catch {}
  },
  mode: ({ mode }) => {
    if (S.mode === mode) return;
    const seg = document.querySelector('.segment'); if (seg) seg.style.setProperty('--i', Object.keys(MODE_ICON).indexOf(mode));
    seg?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    S.mode = mode; S.routes = []; S.routeIncidents = []; loadRoutes({ fit: true }); },
  'select-route': ({ i }) => { if (+i !== S.sel) selectRoute(+i); },
  'start-nav': startNav,
  'end-nav': endNav,
  'toggle-voice': () => { S.settings.voice = !S.settings.voice; saveSettings(); if (!S.settings.voice) speechSynthesis.cancel(); renderNav(); },
  overview: () => { S.following = false; map.easeTo({ pitch: 0, bearing: 0, duration: 300 }); fitPoints(route().points); renderNav(); },
  recenter: () => { S.following = true; followCamera(); renderNav(); },
  'toggle-steps': () => { S.showSteps = !S.showSteps; renderBody(); },
  layers: () => { renderLayers(); $('layers').hidden = false; },
  'close-layers': () => ($('layers').hidden = true),
  'map-type': ({ type }) => { if (S.settings.mapType === type) return; S.settings.mapType = type; saveSettings(); map.setStyle(STYLES[type]); renderLayers(); },
  locate: () => {
    if (!S.fix) { toast(S.denied ? 'Standortzugriff verweigert' : 'Suche GPS-Standort …'); return; }
    haptic(); S.following = true; updateControls();
    map.easeTo({ center: [S.fix.lng, S.fix.lat], zoom: Math.max(map.getZoom(), 15), padding: padding(), duration: 600 });
  },
  'toggle-incidents': () => { setSetting('incidents', !S.settings.incidents); toast(S.settings.incidents ? 'Verkehrsmeldungen an' : 'Verkehrsmeldungen aus'); },
  'toggle-3d': () => { setSetting('threeD', !S.settings.threeD); toast(S.settings.threeD ? '3D an' : '3D aus'); },
};
function setSetting(k, v) {
  S.settings[k] = v; saveSettings(); updateControls();
  if (k === 'incidents') { if (v) loadTraffic(); drawMap(); renderBody(); }
  if (k === 'roadworks') loadTraffic(true);
  if (k === 'threeD') { if (!S.navigating) map.easeTo({ pitch: v ? 45 : 0, duration: 500 }); if (v) addBuildings3D(); }
  if (k === 'avoidHighways') loadRoutes({});
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !el.dataset.action) return;
  const fn = A[el.dataset.action];
  if (fn) { e.preventDefault(); e.stopPropagation(); fn({ ...el.dataset }); }
});
document.addEventListener('change', (e) => {
  const id = e.target.id || '';
  if (id.startsWith('set-') || id.startsWith('opt-')) setSetting(id.slice(4), e.target.checked);
});

/* =================================================================== boot */
function boot() {
  if (!window.maplibregl) { $('sheetBody').innerHTML = '<p class="empty" style="color:var(--red)">Die Karte konnte nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.</p>'; return; }
  renderSheet();
  initMap();
  updateControls();
  startLocation();
  loadTraffic();
  if (S.settings.threeD) map.once('load', () => map.easeTo({ pitch: 45, duration: 0 }));
}
boot();
