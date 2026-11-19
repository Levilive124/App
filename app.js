import {
  autocomplete, computeRoutes, distance, esc, fmtClock, fmtDist, fmtDur, incidentsFromRoute,
  pathLength, placeDetails, scanArea, searchText, setKey, snapToPath,
} from './lib.js';

/* =================================================================== state */
const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d) { try { const v = localStorage.getItem('karten.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('karten.' + k, JSON.stringify(v)); } catch {} },
};
const DEFAULTS = { mapType: 'roadmap', traffic: true, incidents: true, threeD: true, voice: true, avoidTolls: false, avoidHighways: false, avoidFerries: false };

const S = {
  key: LS.get('key', ''),
  settings: { ...DEFAULTS, ...LS.get('settings', {}) },
  favorites: LS.get('favorites', []),
  recents: LS.get('recents', []),
  view: { kind: 'home' },
  sheet: 1,
  query: '', focused: false, searching: false, suggestions: [],
  pendingKind: null, pin: false,
  mode: 'DRIVE', routes: [], sel: 0, routeLoading: false, routeError: null, routeIncidents: [],
  showSteps: false, showOptions: false,
  navigating: false, rerouting: false, nav: null,
  fix: null, following: true, area: [], areaLoading: false, error: null, denied: false,
};
const route = () => S.routes[S.sel] || null;
const saveSettings = () => LS.set('settings', S.settings);
const near = () => S.fix || (map ? { lat: map.getCenter().lat(), lng: map.getCenter().lng() } : null);

let map, trafficLayer, geocoder, AdvancedMarker, gm;
let sessionToken = newToken();
function newToken() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

/* ================================================================= helpers */
const ms = (name, cls = '') => `<span class="ms ${cls}">${name}</span>`;
const COLORS = { NORMAL: '#0A84FF', SLOW: '#FF9500', TRAFFIC_JAM: '#E0262B' };
const MODE_ICON = { DRIVE: 'directions_car', TRANSIT: 'directions_transit', WALK: 'directions_walk', BICYCLE: 'directions_bike', TWO_WHEELER: 'two_wheeler' };
const MANEUVER = {
  DEPART: 'navigation', STRAIGHT: 'straight', NAME_CHANGE: 'straight', TURN_LEFT: 'turn_left', TURN_RIGHT: 'turn_right',
  TURN_SLIGHT_LEFT: 'turn_slight_left', TURN_SLIGHT_RIGHT: 'turn_slight_right', TURN_SHARP_LEFT: 'turn_sharp_left',
  TURN_SHARP_RIGHT: 'turn_sharp_right', UTURN_LEFT: 'u_turn_left', UTURN_RIGHT: 'u_turn_right', RAMP_LEFT: 'ramp_left',
  RAMP_RIGHT: 'ramp_right', FORK_LEFT: 'fork_left', FORK_RIGHT: 'fork_right', MERGE: 'merge',
  ROUNDABOUT_LEFT: 'roundabout_left', ROUNDABOUT_RIGHT: 'roundabout_right', FERRY: 'directions_boat', FERRY_TRAIN: 'train',
};
const mIcon = (m) => MANEUVER[m] || 'straight';
const CATEGORIES = [
  ['Tankstellen', 'Tankstelle', 'local_gas_station', '#0A84FF'], ['Laden', 'Ladestation Elektroauto', 'ev_station', '#30B0C7'],
  ['Restaurants', 'Restaurant', 'restaurant', '#FF9500'], ['Parken', 'Parkplatz', 'local_parking', '#5856D6'],
  ['Supermarkt', 'Supermarkt', 'shopping_cart', '#34C759'], ['Café', 'Café', 'local_cafe', '#A2845E'],
  ['Apotheke', 'Apotheke', 'local_pharmacy', '#FF3B30'], ['Hotels', 'Hotel', 'hotel', '#AF52DE'],
];
const incTitle = (i) => (i.kind === 'JAM' ? 'Stau' : 'Stockender Verkehr') + (i.road ? ` · ${i.road}` : '');
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

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

/* =========================================================== key / setup */
const ORIGIN = location.origin + location.pathname.replace(/[^/]*$/, '');
function showSetup(err) {
  const el = $('setup');
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  el.innerHTML = `
    <img class="logo" src="apple-touch-icon.png" alt="">
    <h1>Karten einrichten</h1>
    <p>Die App nutzt Google Maps mit Live-Verkehr. Dafür brauchst du einen eigenen, kostenlosen Google-Schlüssel (Google schenkt monatlich Guthaben; für private Nutzung zahlst du normalerweise nichts).</p>
    ${err ? `<p class="err">${esc(err)}</p>` : ''}
    <ol>
      <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google-Cloud-Projekt anlegen</a> und mit deinem Google-Konto anmelden. <small>Google fragt nach einer Zahlungsmethode – nötig für die Maps-APIs.</small></li>
      <li>Diese vier Dienste nacheinander öffnen und jeweils <b>Aktivieren</b> tippen:<br>
        <a href="https://console.cloud.google.com/apis/library/maps-backend.googleapis.com" target="_blank" rel="noopener">Maps JavaScript API</a> ·
        <a href="https://console.cloud.google.com/apis/library/places.googleapis.com" target="_blank" rel="noopener">Places API (New)</a> ·
        <a href="https://console.cloud.google.com/apis/library/routes.googleapis.com" target="_blank" rel="noopener">Routes API</a> ·
        <a href="https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com" target="_blank" rel="noopener">Geocoding API</a></li>
      <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Anmeldedaten</a> → <b>Anmeldedaten erstellen</b> → <b>API-Schlüssel</b>. Schlüssel kopieren.
        <small>Empfohlen: Schlüssel bearbeiten → Websites einschränken auf <code>${esc(ORIGIN)}*</code></small></li>
      <li>Schlüssel hier einfügen:</li>
    </ol>
    <input class="keyfield" id="keyInput" placeholder="AIza…" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(S.key)}">
    <button class="btn" data-action="save-key">Speichern & Karte öffnen</button>
    ${S.key ? '<button class="btn sec" data-action="close-setup">Abbrechen</button>' : ''}
    ${standalone ? '' : `<p style="margin-top:22px"><b>Als App installieren:</b> In Safari unten auf ${ms('ios_share')} <b>Teilen</b> tippen → <b>Zum Home-Bildschirm</b>. Danach startet Karten wie eine normale App im Vollbild.</p>`}
    <p style="margin-top:14px;font-size:12px">Der Schlüssel wird nur auf diesem Gerät gespeichert.</p>`;
  el.hidden = false;
}

window.gm_authFailure = () => {
  showSetup('Google hat den Schlüssel abgelehnt. Prüfe, ob er richtig kopiert ist und die Maps JavaScript API aktiviert ist.');
};

function loadGoogle(key) {
  return new Promise((resolve, reject) => {
    window.__gmReady = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=de&region=DE&loading=async&callback=__gmReady`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps konnte nicht geladen werden. Internetverbindung prüfen.'));
    document.head.appendChild(s);
  });
}

/* ================================================================== map */
async function initMap() {
  await loadGoogle(S.key);
  gm = google.maps;
  const { Map, TrafficLayer } = await gm.importLibrary('maps');
  ({ AdvancedMarkerElement: AdvancedMarker } = await gm.importLibrary('marker'));
  const { Geocoder } = await gm.importLibrary('geocoding');
  geocoder = new Geocoder();
  const last = LS.get('lastView', { lat: 52.52, lng: 13.405, zoom: 12 });
  map = new Map($('map'), {
    center: { lat: last.lat, lng: last.lng }, zoom: last.zoom,
    mapId: 'DEMO_MAP_ID', disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: true,
    mapTypeId: S.settings.mapType, colorScheme: gm.ColorScheme?.FOLLOW_SYSTEM, renderingType: gm.RenderingType?.VECTOR,
    isFractionalZoomEnabled: true,
  });
  trafficLayer = new TrafficLayer({ autoRefresh: true });
  applySettings();

  map.addListener('dragstart', () => { cancelLongPress(); if (S.following) { S.following = false; updateControls(); } });
  map.addListener('idle', onIdle);
  // long press → drop pin
  map.addListener('contextmenu', (e) => dropPin(e.latLng));
  map.addListener('mousedown', (e) => { cancelLongPress(); lpTimer = setTimeout(() => dropPin(e.latLng), 650); });
  ['mouseup', 'drag', 'zoom_changed'].forEach((ev) => map.addListener(ev, cancelLongPress));
  map.addListener('click', (e) => {
    cancelLongPress();
    if (e.placeId && !S.navigating) { e.stop(); openPlaceById(e.placeId); }
  });
}
let lpTimer = null, lastPin = 0;
function cancelLongPress() { clearTimeout(lpTimer); lpTimer = null; }

function applySettings() {
  const st = S.settings;
  map.setMapTypeId(st.mapType);
  trafficLayer.setMap(st.traffic ? map : null);
  if (!S.navigating) map.setTilt(st.threeD ? 45 : 0);
  updateControls();
}
function updateControls() {
  $('btnTraffic').classList.toggle('on', S.settings.traffic);
  $('btnIncidents').classList.toggle('on', S.settings.incidents);
  $('btn3d').classList.toggle('on', S.settings.threeD);
  $('locateIcon').textContent = S.following ? 'near_me' : 'near_me';
  $('locateIcon').classList.toggle('o', !S.following);
  $('controls').querySelector('[data-action=locate]').classList.add('accent');
}

/* ------------------------------------------------------------- overlays */
let overlays = [];
let meMarker = null;
function clearOverlays() { overlays.forEach((o) => (o.setMap ? o.setMap(null) : (o.map = null))); overlays = []; }
function marker(pos, html, { z = 1, onClick, title } = {}) {
  const el = document.createElement('div');
  el.innerHTML = html;
  const m = new AdvancedMarker({ map, position: pos, content: el.firstElementChild || el, zIndex: z, title });
  if (onClick) m.addListener('click', onClick);
  overlays.push(m);
  return m;
}
function line(path, color, width, z, opts = {}) {
  const p = new gm.Polyline({ map, path, strokeColor: color, strokeWeight: width, strokeOpacity: opts.opacity ?? 1, zIndex: z, clickable: !!opts.onClick, icons: opts.icons });
  if (opts.onClick) p.addListener('click', opts.onClick);
  overlays.push(p);
  return p;
}

function drawMap() {
  if (!map) return;
  clearOverlays();
  const v = S.view;
  const showRoutes = v.kind === 'route' || S.navigating || (v.kind === 'incident' && v.from.kind === 'route');
  const r = route();
  if (showRoutes && r) {
    if (!S.navigating) S.routes.forEach((alt, i) => i !== S.sel && line(alt.points, '#9DB2CC', 7, 1, { onClick: () => selectRoute(i) }));
    line(r.points, '#0B4FA8', 11, 2);
    if (r.speed.length) r.speed.forEach((iv) => { const seg = r.points.slice(iv.start, iv.end + 1); if (seg.length > 1) line(seg, COLORS[iv.speed], 7, 3); });
    else line(r.points, COLORS.NORMAL, 7, 3);
    marker(r.points[r.points.length - 1], `<div class="mk-round" style="background:var(--red)">${ms('sports_score')}</div>`, { z: 20 });
  }
  // disruptions
  const incs = !S.settings.incidents ? [] : showRoutes ? S.routeIncidents : S.area;
  incs.forEach((inc) => marker(inc.pos,
    `<div class="mk-inc" style="background:${inc.kind === 'JAM' ? 'var(--red)' : 'var(--orange)'}">${ms('car_crash')}${inc.delay >= 120 ? '+' + Math.round(inc.delay / 60) : ''}</div>`,
    { z: 30, onClick: () => openIncident(inc), title: incTitle(inc) }));
  if (v.kind === 'incident') line(v.incident.points, v.incident.kind === 'JAM' ? '#B0001A' : '#D47500', 10, 5);
  // places
  if (v.kind === 'results') v.places.forEach((p) => marker(p.loc, `<div class="mk-pin">${ms('location_on')}</div>`, { z: 10, onClick: () => openPlace(p, v), title: p.name }));
  if (v.kind === 'place') marker(v.place.loc, `<div class="mk-pin ${S.pin ? 'purple' : ''}">${ms('location_on')}</div>`, { z: 15 });
  if (v.kind === 'route' && !r) marker(v.place.loc, `<div class="mk-pin">${ms('location_on')}</div>`, { z: 15 });
  if (v.kind === 'home' && !S.navigating) S.favorites.forEach((f) => {
    const [ic, col] = f.kind === 'home' ? ['home', '#0A84FF'] : f.kind === 'work' ? ['work', '#A2845E'] : ['star', '#FFCC00'];
    marker(f.loc, `<div class="mk-round" style="background:${col}">${ms(ic)}</div>`, { z: 8, onClick: () => onSaved(f), title: f.name });
  });
}

function drawMe() {
  if (!map || !S.fix) return;
  const nav = S.navigating;
  const pos = nav && S.nav?.snapped ? S.nav.snapped : S.fix;
  const heading = S.fix.heading;
  const html = nav
    ? `<div class="mk-me nav"><div class="d"></div><div class="arrow">${ms('navigation')}</div></div>`
    : `<div class="mk-me">${heading != null ? `<div class="cone" style="transform:rotate(${heading}deg)"></div>` : ''}<div class="d"></div></div>`;
  const el = document.createElement('div'); el.innerHTML = html;
  if (!meMarker) meMarker = new AdvancedMarker({ map, position: pos, content: el.firstElementChild, zIndex: 100 });
  else { meMarker.position = pos; meMarker.content = el.firstElementChild; }
}

/* ------------------------------------------------------------- camera */
function sheetVisibleHeight() { return S.navigating ? 110 : snaps()[Math.min(S.sheet, 1)]; }
function flyTo(p, zoom = 15) {
  S.following = false; updateControls();
  map.moveCamera({ center: p, zoom: Math.max(zoom, 3) });
  map.panBy(0, sheetVisibleHeight() / 2 - 40);
}
function fitPoints(pts) {
  if (!pts.length) return;
  const b = new gm.LatLngBounds();
  pts.forEach((p) => b.extend(p));
  map.fitBounds(b, { top: 70, right: 60, bottom: sheetVisibleHeight() + 20, left: 30 });
}
function followCamera() {
  if (!map || !S.fix || !S.following) return;
  if (S.navigating) {
    const fast = (S.fix.speed ?? 0) > 22;
    map.moveCamera({ center: S.nav?.snapped ?? S.fix, zoom: fast ? 16 : 17.5, heading: S.fix.heading ?? map.getHeading() ?? 0, tilt: S.settings.threeD ? 60 : 0 });
  } else if (S.view.kind === 'home') map.panTo(S.fix);
}

/* ============================================================== location */
function startLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition((p) => {
    const first = !S.fix;
    const c = p.coords;
    S.fix = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed != null && c.speed >= 0 ? c.speed : null,
      heading: c.heading != null && !isNaN(c.heading) && c.heading >= 0 && (c.speed ?? 0) > 0.8 ? c.heading : (S.fix?.heading ?? null) };
    S.denied = false;
    if (first && map) { map.moveCamera({ center: S.fix, zoom: 15 }); }
    if (S.navigating) navTick();
    drawMe(); followCamera();
  }, (err) => {
    if (err.code === 1) { S.denied = true; toast('Standortzugriff verweigert – in den Einstellungen erlauben.'); }
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}

/* ============================================================ area traffic */
let scanTimer;
function onIdle() {
  const c = map.getCenter();
  LS.set('lastView', { lat: c.lat(), lng: c.lng(), zoom: map.getZoom() });
  if (!S.settings.incidents || S.navigating) return;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => runScan(false), 1200);
}
async function runScan(force) {
  if (!map || S.navigating) return;
  const b = map.getBounds(); if (!b) return;
  const span = b.toSpan().lat();
  if (span > 1.2) return;
  S.areaLoading = true; if (S.view.kind === 'home') renderBody();
  try {
    const c = map.getCenter();
    S.area = await scanArea({ lat: c.lat(), lng: c.lng() }, (span * 111000) / 2, force);
    S.error = null;
    nameIncidents(S.area).then(() => { if (S.view.kind === 'home') renderBody(); });
  } catch (e) { S.error = e.message; }
  S.areaLoading = false;
  if (S.view.kind === 'home') renderBody();
  if (S.view.kind === 'home' || S.view.kind === 'results') drawMap();
}
const roadCache = new Map();
async function nameIncidents(list, max = 12) {
  await Promise.all(list.slice(0, max).map(async (inc) => {
    if (inc.road) return;
    const k = `${inc.pos.lat.toFixed(3)},${inc.pos.lng.toFixed(3)}`;
    if (!roadCache.has(k)) {
      roadCache.set(k, geocoder.geocode({ location: inc.pos }).then(({ results }) =>
        results.flatMap((r) => r.address_components).find((c) => c.types.includes('route'))?.short_name ?? null).catch(() => null));
    }
    inc.road = (await roadCache.get(k)) ?? undefined;
  }));
}

/* ================================================================ routing */
async function loadRoutes({ quiet = false, fit = false } = {}) {
  const v = S.view;
  const target = v.kind === 'route' ? v.place : S.navTarget;
  if (!target) return;
  if (!S.fix) { S.routeError = S.denied ? 'Standortzugriff verweigert – Route kann nicht berechnet werden.' : 'Warte auf GPS-Standort …'; renderBody(); return; }
  if (!quiet) { S.routeLoading = true; S.routeError = null; renderBody(); }
  try {
    const st = S.settings;
    const res = await computeRoutes(S.fix, target.loc, S.mode, { alternatives: !S.navigating, avoidTolls: st.avoidTolls, avoidHighways: st.avoidHighways, avoidFerries: st.avoidFerries });
    if (!res.length) throw new Error('Keine Route gefunden.');
    S.routes = res; S.sel = 0;
    setRouteIncidents();
    if (fit) fitPoints(res[0].points);
  } catch (e) {
    if (!quiet) { S.routes = []; S.routeError = e.message || 'Route konnte nicht berechnet werden.'; }
  }
  S.routeLoading = false; S.rerouting = false;
  if (S.navigating) navTick(); else renderBody();
  drawMap(); updatePill();
}
function setRouteIncidents() {
  const r = route();
  S.routeIncidents = r ? incidentsFromRoute(r) : [];
  const list = S.routeIncidents;
  nameIncidents(list).then(() => { if (list === S.routeIncidents) { if (!S.navigating) renderBody(); } });
}
function selectRoute(i) { S.sel = i; haptic(); setRouteIncidents(); renderBody(); drawMap(); updatePill(); }
function updatePill() {
  const r = route(), el = $('pill');
  const d = r ? r.duration - r.staticDuration : 0;
  if (!S.navigating && S.view.kind === 'route' && r && d > 60 && S.sheet < 2) {
    el.innerHTML = `<span class="dot" style="background:${d > 600 ? 'var(--red)' : 'var(--orange)'}"></span>+${fmtDur(d)} Verkehr`;
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
  // unlock speech on iOS (must happen inside the tap)
  try { speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(' '), { volume: 0 })); } catch {}
  S.navTarget = S.view.place;
  S.routes = [r]; S.sel = 0;
  S.navigating = true; S.following = true; announced = new Set(); offCount = 0; lastReroute = Date.now();
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  navTimer = setInterval(() => { if (Date.now() - lastReroute > 120000) { lastReroute = Date.now(); loadRoutes({ quiet: true }); } }, 15000);
  $('sheet').hidden = true; $('controls').hidden = true; $('pill').hidden = true;
  if (S.fix && r.steps[0]) say('start', r.steps[0].instruction || 'Route wird gestartet.');
  navTick(); drawMap(); drawMe(); followCamera();
}
function endNav() {
  S.navigating = false; S.nav = null; clearInterval(navTimer);
  try { speechSynthesis.cancel(); } catch {}
  try { wakeLock?.release(); } catch {}
  ['navTop', 'navBottom', 'navAlert', 'recenter'].forEach((id) => ($(id).hidden = true));
  $('sheet').hidden = false; $('controls').hidden = false;
  S.view = { kind: 'home' }; S.routes = []; S.routeIncidents = []; S.sheet = 1; S.following = true;
  if (S.fix) map.moveCamera({ center: S.fix, zoom: 15, heading: 0, tilt: S.settings.threeD ? 45 : 0 });
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
  const ahead = S.routeIncidents.filter((i) => i.at != null && i.at + i.length > along).sort((a, b) => a.at - b.at)[0];
  const nextInc = ahead ? { inc: ahead, dist: Math.max(0, ahead.at - along) } : null;
  if (nextInc && nextInc.dist < 3000 && nextInc.dist > 100) {
    say('inc-' + nextInc.inc.id, `Achtung, ${nextInc.inc.kind === 'JAM' ? 'Stau' : 'stockender Verkehr'} in ${spokenDist(nextInc.dist)}${nextInc.inc.road ? ' auf ' + nextInc.inc.road : ''}.`);
  }
  S.nav = { si, toMan, remaining, remainingSec: r.duration * (remaining / total), arrived, nextInc, snapped: snap.offset < tol ? snap.point : null };
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
  if (n?.nextInc && n.nextInc.dist < 15000) {
    al.hidden = false;
    al.style.background = n.nextInc.inc.kind === 'JAM' ? 'var(--red)' : 'var(--orange)';
    al.style.top = top.offsetHeight + 10 + 'px';
    al.innerHTML = `${ms('car_crash')}<span>${n.nextInc.inc.kind === 'JAM' ? 'Stau' : 'Stockender Verkehr'} in ${fmtDist(n.nextInc.dist)} · ca. +${fmtDur(n.nextInc.inc.delay)}</span>`;
  } else al.hidden = true;
  const rem = n?.remainingSec ?? r.duration, delay = r.duration - r.staticDuration;
  const b = $('navBottom'); b.hidden = false;
  b.innerHTML = `<button class="round" data-action="toggle-voice">${ms(S.settings.voice ? 'volume_up' : 'volume_off')}</button>
    <button class="mid" data-action="overview">
      <span class="nv"><b>${fmtClock(new Date(Date.now() + rem * 1000))}</b><small>Ankunft</small></span>
      <span class="nv"><b style="color:${delay > 300 ? 'var(--orange)' : 'var(--green)'}">${fmtDur(rem)}</b><small>Fahrzeit</small></span>
      <span class="nv"><b>${fmtDist(n?.remaining ?? r.distance)}</b><small>Distanz</small></span></button>
    <button class="end" data-action="end-nav">Beenden</button>`;
  $('recenter').hidden = S.following;
}

/* ============================================================ interaction */
function addRecent(p) {
  if (String(p.id).startsWith('pin-')) return;
  S.recents = [{ id: p.id, name: p.name, address: p.address, loc: p.loc }, ...S.recents.filter((r) => r.id !== p.id)].slice(0, 15);
  LS.set('recents', S.recents);
}
function saveFav(p, kind = 'favorite') {
  S.favorites = S.favorites.filter((f) => f.id !== p.id && (kind === 'favorite' || f.kind !== kind));
  S.favorites.push({ id: p.id, name: kind === 'home' ? 'Zuhause' : kind === 'work' ? 'Arbeit' : p.name, address: p.address, loc: p.loc, kind });
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
function openPlace(place, from) {
  S.pin = String(place.id).startsWith('pin-');
  addRecent(place);
  if (S.pendingKind) { saveFav(place, S.pendingKind); S.pendingKind = null; }
  setView({ kind: 'place', place, from });
  flyTo(place.loc, 16);
}
async function openPlaceById(id) {
  S.searching = true; renderHeaderLoading();
  try { const p = await placeDetails(id, sessionToken); sessionToken = newToken(); S.query = ''; openPlace(p); }
  catch (e) { toast(e.message); }
  S.searching = false; renderHeaderLoading();
}
function openRoute(place, from) {
  S.showSteps = false; S.showOptions = false;
  setView({ kind: 'route', place, from });
  loadRoutes({ fit: true });
}
function onSaved(f) {
  const place = { id: f.id, name: f.name, address: f.address, loc: f.loc };
  if (f.kind === 'home' || f.kind === 'work') openRoute(place); else openPlace(place);
}
function openIncident(inc) {
  const from = S.view.kind === 'incident' ? S.view.from : S.view;
  S.view = { kind: 'incident', incident: inc, from }; S.sheet = 1;
  renderSheet(); drawMap();
  if (!S.navigating) flyTo(inc.pos, 14);
  else { S.following = false; map.panTo(inc.pos); renderNav(); }
}
async function dropPin(latLng) {
  cancelLongPress();
  if (!latLng || S.navigating || Date.now() - lastPin < 1000) return;
  lastPin = Date.now(); haptic();
  const loc = { lat: latLng.lat(), lng: latLng.lng() };
  const place = { id: `pin-${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`, name: 'Markierter Ort', address: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`, loc };
  S.pin = true;
  setView({ kind: 'place', place });
  try {
    const { results } = await geocoder.geocode({ location: loc });
    if (results[0] && S.view.kind === 'place' && S.view.place.id === place.id) { place.address = results[0].formatted_address; renderSheet(); }
  } catch {}
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

async function runSearch(q) {
  document.activeElement?.blur?.();
  S.searching = true; renderHeaderLoading();
  try {
    const places = await searchText(q, near());
    S.query = '';
    setView({ kind: 'results', query: q, places });
    if (places.length) fitPoints(places.map((p) => p.loc));
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
    try { const s = await autocomplete(q.trim(), near(), sessionToken); if (id === acSeq) S.suggestions = s; }
    catch (e) { if (id === acSeq) { S.suggestions = []; S.error = e.message; } }
    if (id === acSeq) { S.searching = false; renderHeaderLoading(); renderBody(); }
  }, 220);
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
      <div class="segment">${Object.keys(MODE_ICON).map((m) => `<button class="${m === S.mode ? 'on' : ''}" data-action="mode" data-mode="${m}">${ms(MODE_ICON[m])}</button>`).join('')}</div>
      <div style="height:10px"></div>`;
  } else if (v.kind === 'incident') {
    const i = v.incident;
    h.innerHTML = `<div class="hrow" style="align-items:center"><span class="ricon" style="width:44px;height:44px;background:${i.kind === 'JAM' ? 'var(--red)' : 'var(--orange)'}">${ms('car_crash')}</span>
      <div class="grow"><h2 class="title s">${esc(incTitle(i))}</h2><div class="meta">Live-Verkehrsdaten · Google</div></div>
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
    s: [p.category, S.fix ? fmtDist(distance(S.fix, p.loc)) : null, p.rating != null ? `★ ${p.rating.toFixed(1)}` : null, p.openNow == null ? null : p.openNow ? 'Geöffnet' : 'Geschlossen'].filter(Boolean).join(' · '),
  })).join('') : '<p class="empty">Keine Ergebnisse gefunden.</p>';
  else if (v.kind === 'place') html = placeBody(v.place);
  else if (v.kind === 'route') html = routeBody();
  else if (v.kind === 'incident') html = incidentBody(v.incident);
  b.innerHTML = html;
}

function homeBody() {
  if (S.query.trim().length >= 2) {
    return S.suggestions.map((s, i) => row({
      icon: s.placeId ? 'location_on' : 'search', bg: s.placeId ? 'var(--red)' : '#8E8E93', t: s.title,
      s: [s.dist != null ? fmtDist(s.dist) : null, s.subtitle].filter(Boolean).join(' · '), action: 'suggestion', data: { i },
    })).join('') + row({ icon: 'search', bg: '#8E8E93', t: `„${S.query.trim()}“ suchen`, action: 'search-text' });
  }
  const home = S.favorites.find((f) => f.kind === 'home'), work = S.favorites.find((f) => f.kind === 'work');
  const others = S.favorites.filter((f) => f.kind === 'favorite');
  const fav = (icon, col, l, sl, action, data = {}) => `<button class="fav" data-action="${action}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>
    <div class="bubble" style="color:${col}">${ms(icon)}</div><div class="l">${esc(l)}</div><div class="sl">${esc(sl)}</div></button>`;
  let h = '';
  if (S.pendingKind) h += `<p class="empty" style="color:var(--accent)">Suche die Adresse für „${S.pendingKind === 'home' ? 'Zuhause' : 'Arbeit'}“</p>`;
  if (S.error) h += `<div class="card" style="display:flex;gap:8px;align-items:center;margin-bottom:0">${ms('warning')}<span style="flex:1">${esc(S.error)}</span></div>`;
  h += `<div class="section"><h3>Favoriten</h3></div><div class="hscroll">
    ${home ? fav('home', '#0A84FF', 'Zuhause', 'Route', 'saved', { id: home.id }) : fav('home', '#0A84FF', 'Zuhause', 'Hinzufügen', 'set-kind', { kind: 'home' })}
    ${work ? fav('work', '#A2845E', 'Arbeit', 'Route', 'saved', { id: work.id }) : fav('work', '#A2845E', 'Arbeit', 'Hinzufügen', 'set-kind', { kind: 'work' })}
    ${others.map((f) => fav('star', '#FFCC00', f.name, S.fix ? fmtDist(distance(S.fix, f.loc)) : '', 'saved', { id: f.id })).join('')}
  </div>
  <div class="hscroll chips">${CATEGORIES.map(([l, q, ic, c], i) => `<button class="chip" data-action="category" data-i="${i}"><span class="ms" style="color:${c}">${ic}</span>${l}</button>`).join('')}</div>
  <div class="section"><h3>Verkehrslage</h3>${S.areaLoading ? '<span class="spin"></span>' : `<button data-action="refresh-incidents" aria-label="Aktualisieren">${ms('refresh')}</button>`}</div>`;
  if (!S.settings.incidents) h += '<p class="empty">Verkehrsstörungen sind ausgeschaltet.</p>';
  else if (!S.area.length && !S.areaLoading) h += '<p class="empty">Keine Störungen im sichtbaren Bereich erkannt.</p>';
  else h += S.area.slice(0, 8).map((inc, i) => row({
    icon: 'car_crash', bg: inc.kind === 'JAM' ? 'var(--red)' : 'var(--orange)', t: incTitle(inc), action: 'area-incident', data: { i },
    s: `${fmtDist(inc.length)} · ca. +${fmtDur(inc.delay)}${S.fix ? ` · ${fmtDist(distance(S.fix, inc.pos))} entfernt` : ''}`,
  })).join('');
  if (S.recents.length) h += '<div class="section"><h3>Zuletzt gesucht</h3></div>' + S.recents.map((r, i) => row({ icon: 'schedule', bg: '#8E8E93', t: r.name, s: r.address, action: 'recent', data: { i } })).join('');
  h += `<div class="section"><h3>Einstellungen</h3></div>${row({ icon: 'key', bg: '#8E8E93', t: 'Google-Schlüssel ändern', action: 'open-setup' })}`;
  return h;
}

function placeBody(p) {
  const fav = isFav(p.id);
  const stars = p.rating != null ? '★'.repeat(Math.round(p.rating)) + '☆'.repeat(5 - Math.round(p.rating)) : '';
  const price = { PRICE_LEVEL_FREE: 'Kostenlos', PRICE_LEVEL_INEXPENSIVE: '€', PRICE_LEVEL_MODERATE: '€€', PRICE_LEVEL_EXPENSIVE: '€€€', PRICE_LEVEL_VERY_EXPENSIVE: '€€€€' }[p.priceLevel];
  const tel = p.phone?.replace(/\s/g, '');
  let h = `<div class="actions">
    <button class="act primary" data-action="route-to">${ms('directions_car')}<span>Route</span></button>
    ${p.phone ? `<a class="act" href="tel:${esc(tel)}">${ms('call')}<span>Anrufen</span></a>` : ''}
    ${p.website ? `<a class="act" href="${esc(p.website)}" target="_blank" rel="noopener">${ms('language')}<span>Website</span></a>` : ''}
    <button class="act" data-action="toggle-fav">${ms('star', fav ? '' : 'o')}<span>${fav ? 'Gesichert' : 'Sichern'}</span></button>
    <button class="act" data-action="share">${ms('ios_share')}<span>Teilen</span></button></div>`;
  const stats = [];
  if (p.openNow != null) stats.push(`<div class="stat"><div class="k">Öffnungszeiten</div><div class="v" style="color:${p.openNow ? 'var(--green)' : 'var(--red)'}">${p.openNow ? 'Geöffnet' : 'Geschlossen'}</div></div>`);
  if (p.rating != null) stats.push(`<div class="stat"><div class="k">${p.ratingCount ?? 0} Bewertungen</div><div class="v" style="color:var(--orange)">${p.rating.toFixed(1)} ${stars}</div></div>`);
  if (price) stats.push(`<div class="stat"><div class="k">Preis</div><div class="v">${price}</div></div>`);
  if (stats.length) h += `<div class="stats">${stats.join('')}</div>`;
  if (p.photo) h += `<img class="photo" src="${esc(p.photo)}" alt="" loading="lazy">`;
  h += `<div class="card"><h4>Details</h4>
    ${p.address ? `<div class="kv"><div class="k">Adresse</div><div class="v">${esc(p.address)}</div></div>` : ''}
    ${p.phone ? `<div class="kv"><div class="k">Telefon</div><div class="v"><a href="tel:${esc(tel)}">${esc(p.phone)}</a></div></div>` : ''}
    ${p.website ? `<div class="kv"><div class="k">Website</div><div class="v"><a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></div></div>` : ''}
    <div class="kv"><div class="k">Koordinaten</div><div class="v">${p.loc.lat.toFixed(5)}° N, ${p.loc.lng.toFixed(5)}° E</div></div>
    ${(p.hours || []).map((x) => `<div class="hours">${esc(x)}</div>`).join('')}</div>`;
  h += `<a class="row" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.loc.lat},${p.loc.lng}" target="_blank" rel="noopener">
      <span class="ricon" style="background:var(--orange)">${ms('streetview')}</span><span class="txt"><div class="t">Umgebung ansehen (Street View)</div></span></a>`;
  return h;
}

function routeBody() {
  if (S.routeLoading && !S.routes.length) return '<div style="text-align:center;padding:30px"><span class="spin"></span></div>';
  if (S.routeError) return `<p class="empty" style="color:var(--red)">${esc(S.routeError)}</p>`;
  const r = route(); if (!r) return '<p class="empty">Keine Route gefunden.</p>';
  const traffic = S.mode === 'DRIVE' || S.mode === 'TWO_WHEELER';
  let h = S.routes.map((rt, i) => {
    const d = rt.duration - rt.staticDuration;
    const col = d > 600 ? 'var(--red)' : d > 120 ? 'var(--orange)' : 'var(--green)';
    const extra = [rt.description && `über ${rt.description}`, rt.labels.includes('FUEL_EFFICIENT') && 'Kraftstoffsparend', rt.tolls && 'Maut'].filter(Boolean).join(' · ');
    return `<div class="route ${i === S.sel ? 'on' : ''}" data-action="select-route" data-i="${i}" role="button">
      <div class="info"><div class="eta">${fmtDur(rt.duration)}</div>
      <div class="sm">${fmtDist(rt.distance)} · Ankunft ${fmtClock(new Date(Date.now() + rt.duration * 1000))}</div>
      ${traffic ? `<div class="delay" style="color:${col}">${d > 60 ? `+${fmtDur(d)} durch Verkehr` : 'Normaler Verkehr'}</div>` : ''}
      ${extra ? `<div class="sm">${esc(extra)}</div>` : ''}</div>
      ${i === S.sel ? '<button class="go" data-action="start-nav">Los</button>' : ''}</div>`;
  }).join('');
  if (traffic) {
    h += '<div class="section"><h3>Verkehrsstörungen auf der Route</h3></div>';
    h += S.routeIncidents.length ? S.routeIncidents.map((inc, i) => row({
      icon: 'car_crash', bg: inc.kind === 'JAM' ? 'var(--red)' : 'var(--orange)', t: incTitle(inc), action: 'route-incident', data: { i },
      s: `in ${fmtDist(inc.at ?? 0)} · ${fmtDist(inc.length)} lang · ca. +${fmtDur(inc.delay)}`,
    })).join('') : `<div class="ok"><span class="ms" style="color:var(--green)">check_circle</span>Keine Störungen gemeldet</div>`;
  }
  h += r.warnings.map((w) => `<div class="ok"><span class="ms" style="color:var(--orange)">warning</span><span>${esc(w)}</span></div>`).join('');
  if (S.mode === 'TRANSIT') {
    const steps = [];
    for (const s of r.steps) { const l = steps[steps.length - 1]; if (!s.transit && l && !l.transit) { l.distance += s.distance; l.duration += s.duration; } else steps.push({ ...s }); }
    h += `<div class="card">${steps.map((s) => s.transit
      ? `<div class="transit"><span class="badge" style="${s.transit.color ? `background:${esc(s.transit.color)};` : ''}${s.transit.textColor ? `color:${esc(s.transit.textColor)}` : ''}">${esc(s.transit.line)}</span>
         <div style="min-width:0"><div style="font-weight:600">${esc(s.transit.vehicle || 'Linie')} Richtung ${esc(s.transit.headsign)}</div>
         <div class="meta" style="font-size:13px">${esc(s.transit.dep)} ${esc(s.transit.from)} → ${esc(s.transit.arr)} ${esc(s.transit.to)}${s.transit.stops ? ` · ${s.transit.stops} Halte` : ''}</div></div></div>`
      : `<div class="transit"><span class="ms" style="color:var(--sub)">directions_walk</span><span class="meta">${fmtDist(s.distance)} gehen · ${fmtDur(s.duration)}</span></div>`).join('')}</div>`;
  }
  if (traffic) {
    h += `<button class="section" style="width:100%" data-action="toggle-options"><h3>Optionen</h3>${ms(S.showOptions ? 'expand_less' : 'expand_more')}</button>`;
    if (S.showOptions) h += `<div class="card" style="margin-top:0;padding-block:2px">
      ${toggle('opt-avoidTolls', 'Maut vermeiden', '', S.settings.avoidTolls)}
      ${toggle('opt-avoidHighways', 'Autobahnen vermeiden', '', S.settings.avoidHighways)}
      ${toggle('opt-avoidFerries', 'Fähren vermeiden', '', S.settings.avoidFerries)}</div>`;
  }
  if (S.mode !== 'TRANSIT') {
    h += `<button class="section" style="width:100%" data-action="toggle-steps"><h3>Wegbeschreibung (${r.steps.length})</h3>${ms(S.showSteps ? 'expand_less' : 'expand_more')}</button>`;
    if (S.showSteps) h += r.steps.map((s) => row({ icon: mIcon(s.maneuver), bg: '#8E8E93', t: s.instruction || 'Weiter', s: fmtDist(s.distance) })).join('');
  }
  return h;
}

function incidentBody(i) {
  const dirs = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
  const kmh = (i.length / (i.length / 13.9 + i.delay)) * 3.6;
  const item = (ic, k, v) => `<div class="opt">${ms(ic)}<span style="flex:1;color:var(--sub)">${k}</span><b>${v}</b></div>`;
  return `<div class="card" style="margin-top:0">
    ${item('straighten', 'Länge', fmtDist(i.length))}
    ${item('schedule', 'Geschätzte Verzögerung', `ca. +${fmtDur(i.delay)}`)}
    ${item('speed', 'Ø Geschwindigkeit', `ca. ${Math.round(kmh)} km/h`)}
    ${item('explore', 'Fahrtrichtung', 'Richtung ' + dirs[Math.round(i.heading / 45) % 8])}
    ${i.at != null ? item('route', 'Auf deiner Route in', fmtDist(i.at)) : ''}</div>
    <p class="empty" style="font-size:12px">Erkannt aus den Echtzeit-Geschwindigkeitsdaten der Google Routes API. Die Verzögerung ist eine Schätzung.</p>`;
}

function renderLayers() {
  const st = S.settings;
  const types = [['roadmap', 'Standard', 'map'], ['hybrid', 'Hybrid', 'satellite_alt'], ['satellite', 'Satellit', 'public'], ['terrain', 'Gelände', 'terrain']];
  $('layersCard').innerHTML = `<div class="hrow" style="padding:0;align-items:center"><h2 class="title s grow">Karten auswählen</h2><button class="close" data-action="close-layers">${ms('close')}</button></div>
    <div class="types">${types.map(([k, l, ic]) => `<button class="type ${st.mapType === k ? 'on' : ''}" data-action="map-type" data-type="${k}">${ms(ic)}${l}</button>`).join('')}</div>
    <div class="card" style="margin:14px 0 0;padding-block:2px">
      ${toggle('set-traffic', 'Live-Verkehr', 'Verkehrsfluss als Kartenebene', st.traffic)}
      ${toggle('set-incidents', 'Verkehrsstörungen', 'Staus & stockender Verkehr (Google Routes)', st.incidents)}
      ${toggle('set-threeD', '3D-Ansicht', 'Geneigte Karte & Gebäude', st.threeD)}
      ${toggle('set-voice', 'Sprachansagen', '', st.voice)}</div>
    <div class="foot">Kartendaten & Verkehr: Google</div>`;
}

/* ============================================================ bottom sheet */
function snaps() {
  const H = window.innerHeight, st = parseFloat(css('--st')) || 0, sb = parseFloat(getComputedStyle($('sheet')).paddingBottom) || 0;
  const sbi = safeBottom();
  return [sbi + 96, Math.round(H * 0.42), H - st - 10];
}
let _sb = null;
function safeBottom() {
  if (_sb == null) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px)'; document.body.appendChild(d); _sb = d.offsetHeight; d.remove(); }
  return _sb;
}
function placeSheet() {
  const el = $('sheet'), full = el.offsetHeight || window.innerHeight;
  el.style.transform = `translateY(${full - snaps()[S.sheet]}px)`;
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
    const full = el.offsetHeight, proj = curT() + vel * 180;
    const sp = snaps(); let best = 0;
    sp.forEach((s, i) => { if (Math.abs(full - s - proj) < Math.abs(full - sp[best] - proj)) best = i; });
    if (Math.abs(lastY - startY) < 4) best = S.sheet === 0 ? 1 : S.sheet; // tap on handle
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
  suggestion: ({ i }) => {
    const s = S.suggestions[i]; if (!s) return;
    document.activeElement?.blur?.();
    if (s.placeId) openPlaceById(s.placeId); else runSearch(s.query || s.title);
  },
  'search-text': () => runSearch(S.query.trim()),
  category: ({ i }) => { S.query = ''; runSearch(CATEGORIES[i][1]); },
  result: ({ i }) => openPlace(S.view.places[i], S.view),
  recent: ({ i }) => openPlace(S.recents[i]),
  saved: ({ id }) => { const f = S.favorites.find((x) => x.id === id); if (f) onSaved(f); },
  'set-kind': ({ kind }) => { S.pendingKind = kind; S.focused = true; S.sheet = 2; renderSheet(); setTimeout(() => $('q')?.focus(), 50); },
  'area-incident': ({ i }) => openIncident(S.area[i]),
  'route-incident': ({ i }) => openIncident(S.routeIncidents[i]),
  'refresh-incidents': () => runScan(true),
  'route-to': () => openRoute(S.view.place, S.view),
  'toggle-fav': () => { const p = S.view.place; isFav(p.id) ? removeFav(p.id) : saveFav(p); renderBody(); },
  share: async () => {
    const p = S.view.place;
    const url = `https://www.google.com/maps/search/?api=1&query=${p.loc.lat},${p.loc.lng}${String(p.id).startsWith('pin-') ? '' : `&query_place_id=${p.id}`}`;
    try { if (navigator.share) await navigator.share({ title: p.name, text: `${p.name}\n${p.address}`, url }); else { await navigator.clipboard.writeText(url); toast('Link kopiert'); } } catch {}
  },
  mode: ({ mode }) => { if (S.mode === mode) return; S.mode = mode; S.routes = []; renderHeader(); loadRoutes({ fit: true }); },
  'select-route': ({ i }) => { if (+i !== S.sel) selectRoute(+i); },
  'start-nav': startNav,
  'end-nav': endNav,
  'toggle-voice': () => { S.settings.voice = !S.settings.voice; saveSettings(); if (!S.settings.voice) speechSynthesis.cancel(); renderNav(); },
  overview: () => { S.following = false; map.moveCamera({ tilt: 0, heading: 0 }); fitPoints(route().points); renderNav(); },
  recenter: () => { S.following = true; followCamera(); renderNav(); },
  'toggle-steps': () => { S.showSteps = !S.showSteps; renderBody(); },
  'toggle-options': () => { S.showOptions = !S.showOptions; renderBody(); },
  layers: () => { renderLayers(); $('layers').hidden = false; },
  'close-layers': () => ($('layers').hidden = true),
  'map-type': ({ type }) => { S.settings.mapType = type; saveSettings(); applySettings(); renderLayers(); },
  locate: () => {
    if (!S.fix) { toast(S.denied ? 'Standortzugriff verweigert' : 'Suche GPS-Standort …'); return; }
    haptic(); S.following = true; updateControls();
    map.moveCamera({ center: S.fix, zoom: Math.max(map.getZoom(), 15) });
    map.panBy(0, sheetVisibleHeight() / 2 - 40);
  },
  'toggle-traffic': () => { S.settings.traffic = !S.settings.traffic; saveSettings(); applySettings(); toast(S.settings.traffic ? 'Live-Verkehr an' : 'Live-Verkehr aus'); },
  'toggle-incidents': () => { S.settings.incidents = !S.settings.incidents; saveSettings(); updateControls(); toast(S.settings.incidents ? 'Verkehrsstörungen an' : 'Verkehrsstörungen aus'); if (S.settings.incidents) runScan(false); drawMap(); renderBody(); },
  'toggle-3d': () => { S.settings.threeD = !S.settings.threeD; saveSettings(); applySettings(); toast(S.settings.threeD ? '3D an' : '3D aus'); },
  'open-setup': () => showSetup(),
  'close-setup': () => ($('setup').hidden = true),
  'save-key': () => {
    const k = $('keyInput').value.trim();
    if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(k)) { showSetup('Das sieht nicht wie ein Google-Schlüssel aus (beginnt mit „AIza“).'); return; }
    const changed = k !== S.key;
    S.key = k; LS.set('key', k);
    if (changed && map) location.reload(); else boot();
  },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !el.dataset.action) return;
  const fn = A[el.dataset.action];
  if (fn) { e.preventDefault(); e.stopPropagation(); fn({ ...el.dataset }); }
});
document.addEventListener('change', (e) => {
  const id = e.target.id || '';
  if (id.startsWith('set-')) {
    const k = id.slice(4); S.settings[k] = e.target.checked; saveSettings(); applySettings();
    if (k === 'incidents') { if (e.target.checked) runScan(false); drawMap(); renderBody(); }
  } else if (id.startsWith('opt-')) {
    S.settings[id.slice(4)] = e.target.checked; saveSettings(); loadRoutes({});
  }
});
window.addEventListener('popstate', () => { goBack(); history.pushState(null, ''); });

/* =================================================================== boot */
let booted = false;
async function boot() {
  if (!S.key) { showSetup(); return; }
  if (booted) { $('setup').hidden = true; return; }
  booted = true;
  setKey(S.key);
  $('setup').hidden = true;
  renderSheet();
  try {
    await initMap();
    startLocation();
    drawMap();
    history.pushState(null, '');
  } catch (e) {
    booted = false;
    showSetup(e.message);
  }
}
boot();
