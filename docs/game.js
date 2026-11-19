import { BUILDINGS, CAT, MISSIONS, STATUS, VEHICLES, xpForLevel } from './data.js?v=g3';

const VERSION = '1.2';
const SIM = 3;                 // game seconds per real second at speed 1×
const SIREN = 0.72;            // driving time factor with blue lights
const SAVE_KEY = 'ez.save.v1';

/* ================================================================ helpers */
const $ = (id) => document.getElementById(id);
const ms = (n, cls = '') => `<span class="ms ${cls}">${n}</span>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtMoney = (n) => Math.round(n).toLocaleString('de-DE');
function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m ? `${m}:${String(s).padStart(2, '0')} Min.` : `${s} s`; }
const R = 6371000, rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function offset(p, bearingDeg, meters) {
  const d = meters / R, b = rad(bearingDeg), lat1 = rad(p.lat), lon1 = rad(p.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lon2 * 180) / Math.PI };
}
function decode(enc = '') {
  const pts = []; let i = 0, lat = 0, lng = 0;
  while (i < enc.length) {
    let b, sh = 0, r = 0;
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lat += r & 1 ? ~(r >> 1) : r >> 1; sh = 0; r = 0;
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}
async function getJSON(url, timeout = 12000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
let toastTimer;
function toast(html, ms_ = 2800) { const el = $('toast'); el.innerHTML = html; el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms_); }
function haptic() { try { navigator.vibrate?.(12); } catch {} }

/* ============================================================== services */
async function route(from, to) {
  try {
    const r = await getJSON(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=polyline`);
    if (r.code !== 'Ok' || !r.routes?.[0]) throw new Error('no route');
    const pts = decode(r.routes[0].geometry);
    return { pts: pts.length > 1 ? pts : [from, to], dur: r.routes[0].duration };
  } catch {
    const d = dist(from, to) * 1.35;
    return { pts: [from, to], dur: d / 12 };
  }
}
async function snapToRoad(p) {
  try {
    const r = await getJSON(`https://routing.openstreetmap.de/routed-car/nearest/v1/driving/${p.lng},${p.lat}?number=1`, 8000);
    const w = r.waypoints?.[0];
    if (w && w.distance < 400) return { lat: w.location[1], lng: w.location[0], street: w.name };
  } catch {}
  return { ...p, street: '' };
}
async function reverse(p) {
  try {
    const r = await getJSON(`https://photon.komoot.io/reverse?lat=${p.lat}&lon=${p.lng}&lang=de&limit=1`, 8000);
    const f = r.features?.[0]?.properties; if (!f) return null;
    const street = [f.street || (f.osm_key === 'highway' ? f.name : ''), f.housenumber].filter(Boolean).join(' ');
    return { street, city: f.city || f.town || f.village || f.district || f.county || '', district: f.district || f.locality || f.suburb || '' };
  } catch { return null; }
}
async function searchPlace(q) {
  const r = await getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=de&limit=6`);
  return (r.features || []).map((f) => ({ name: f.properties.name || f.properties.city, sub: [f.properties.city, f.properties.state].filter((x) => x && x !== f.properties.name).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
}

/* ================================================================ state */
const NEW_GAME = () => ({
  v: 1, credits: 25000, xp: 0, level: 1, speed: 1, paused: false, gt: 0, home: null,
  buildings: [], vehicles: [], missions: [], nextSpawn: 20, stats: { done: 0, earned: 0 }, sound: true, tutorial: 0, hintKH: false,
});
let S = load() || NEW_GAME();
function load() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.v === 1 ? s : null; } catch { return null; } }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch {} }
setInterval(save, 4000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

const UI = { view: { kind: 'list' }, stack: [], tab: 'missions', sheet: 1, sel: new Set(), build: null, resetArm: false, confirm: null };
const bById = (id) => S.buildings.find((b) => b.id === id);
const vById = (id) => S.vehicles.find((v) => v.id === id);
const mById = (id) => S.missions.find((m) => m.id === id);
const mType = (m) => MISSIONS.find((x) => x.id === m.type);
const ownedTypes = () => new Set(S.vehicles.map((v) => v.type));
const hospitals = () => S.buildings.filter((b) => b.type === 'KH');

/* ============================================================ vehicles */
function vehPos(v) {
  const r = v.route;
  if (!r || !r.ready) return { lat: v.lat, lng: v.lng };
  const f = Math.min(1, Math.max(0, (S.gt - r.t0) / r.dur));
  const target = f * r.total;
  let i = 1; while (i < r.cum.length - 1 && r.cum[i] < target) i++;
  const a = r.pts[i - 1], b = r.pts[i], seg = r.cum[i] - r.cum[i - 1] || 1, t = (target - r.cum[i - 1]) / seg;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}
function remaining(v) { const r = v.route; if (!r) return 0; if (!r.ready) return Infinity; return Math.max(0, r.t0 + r.dur - S.gt); }

function drive(v, to, kind, siren) {
  const from = vehPos(v); v.lat = from.lat; v.lng = from.lng;
  const token = uid();
  v.route = { ready: false, kind, token, to: { lat: to.lat, lng: to.lng } };
  route(from, to).then(({ pts, dur }) => {
    if (!v.route || v.route.token !== token) return;
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    v.route = { ready: true, kind, token, to: v.route.to, pts, cum, total: cum[cum.length - 1] || 1, t0: S.gt, dur: Math.max(8, dur * (siren ? SIREN : 1)) };
  });
}
function sendHome(v) {
  const b = bById(v.building); v.mission = null; v.status = 1;
  if (!b) return; drive(v, b, 'home', false);
}
function estimateEta(v, target) {
  const p = vehPos(v); return (dist(p, target) * 1.35) / 12 * SIREN;
}
function onArrive(v) {
  const r = v.route; v.lat = r.to.lat; v.lng = r.to.lng; v.route = null;
  if (r.kind === 'mission') {
    const m = mById(v.mission);
    if (!m) return sendHome(v);
    v.status = 4;
  } else if (r.kind === 'home') { v.status = 2; }
  else if (r.kind === 'hospital') {
    v.status = 8; v.busyUntil = S.gt + 45;
    const bonus = 260; S.credits += bonus; S.stats.earned += bonus;
    floatText(`+${bonus}`, v);
  }
}

/* ============================================================ missions */
/** Greedy assignment of vehicles to requirement slots. */
function coverage(req, vehicles) {
  const need = { ...req }, used = new Set();
  const sorted = [...vehicles].sort((a, b) => VEHICLES[a.type].fills.length - VEHICLES[b.type].fills.length);
  for (const v of sorted) {
    const f = VEHICLES[v.type].fills.find((t) => need[t] > 0);
    if (f) { need[f]--; used.add(v.id); }
  }
  const missing = Object.fromEntries(Object.entries(need).filter(([, n]) => n > 0));
  return { missing, ok: Object.keys(missing).length === 0, used };
}
const onScene = (m) => S.vehicles.filter((v) => v.mission === m.id && v.status === 4);
const enRoute = (m) => S.vehicles.filter((v) => v.mission === m.id && v.status === 3);

function missionTick(m) {
  const t = mType(m);
  if (m.state === 'working') {
    if (S.gt >= m.workStart + t.work) complete(m);
    return;
  }
  const cov = coverage(t.req, onScene(m));
  if (cov.ok) { m.state = 'working'; m.workStart = S.gt; drawMissions(); return; }
  const st = enRoute(m).length || onScene(m).length ? 'enroute' : 'new';
  if (st !== m.state) { m.state = st; drawMissions(); }
}

function complete(m) {
  const t = mType(m);
  const reward = Math.round(t.reward * (1 + (S.level - 1) * 0.04));
  S.credits += reward; S.stats.earned += reward; S.stats.done++;
  gainXp(Math.round(t.reward / 9));
  const units = onScene(m);
  const kh = hospitals();
  let patients = m.patients || 0;
  for (const v of units) {
    if (patients > 0 && (v.type === 'RTW' || v.type === 'KTW')) {
      patients--;
      if (kh.length) {
        const h = kh.reduce((a, b) => (dist(v, a) < dist(v, b) ? a : b));
        v.status = 7; v.mission = null; v.target = h.id; drive(v, h, 'hospital', false); continue;
      }
    }
    sendHome(v);
  }
  enRoute(m).forEach(sendHome);
  if ((m.patients || 0) > 0 && !kh.length && !S.hintKH && S.level >= 2) { S.hintKH = true; toast(`${ms('local_hospital')} Tipp: Baue ein Krankenhaus – Patiententransporte bringen extra Credits.`, 5000); }
  S.missions = S.missions.filter((x) => x !== m);
  floatText(`+${fmtMoney(reward)}`, m);
  toast(`${ms('check_circle')} <b>${esc(t.name)}</b> abgeschlossen · +${fmtMoney(reward)} Credits`);
  if (UI.view.kind === 'mission' && UI.view.id === m.id) A.back();
  drawMissions(); renderSheet(); playSound('done');
}
function gainXp(n) {
  S.xp += n;
  while (S.xp >= xpForLevel(S.level + 1)) {
    S.level++;
    toast(`${ms('military_tech')} <b>Level ${S.level}</b> erreicht! Neue Einsätze und Fahrzeuge freigeschaltet.`, 4500);
    playSound('level');
  }
}

let spawning = false;
async function spawnMission() {
  const bases = S.buildings.filter((b) => b.type !== 'KH');
  if (!bases.length || spawning) return;
  const owned = ownedTypes();
  const fillable = new Set([...owned].flatMap((t) => VEHICLES[t].fills));
  const pool = MISSIONS.filter((x) => x.lvl <= S.level && Object.keys(x.req).every((r) => fillable.has(r)));
  if (!pool.length) return;
  const weighted = pool.flatMap((x) => Array(Math.max(1, 5 - Math.floor((S.level - x.lvl) / 2)) + (x.lvl >= S.level - 1 ? 2 : 0)).fill(x));
  const t = pick(weighted);
  const base = pick(bases);
  const radius = Math.min(6000, 1800 + S.level * 300);
  spawning = true;
  try {
    const raw = offset(base, rnd(0, 360), rnd(300, radius));
    const p = await snapToRoad(raw);
    const addr = await reverse(p);
    const street = addr?.street || p.street || 'Unbekannte Straße';
    const m = {
      id: uid(), type: t.id, lat: p.lat, lng: p.lng, created: S.gt, state: 'new',
      address: [street, addr?.district && addr.district !== addr?.city ? addr.district : null, addr?.city].filter(Boolean).join(', '),
      patients: t.pat ? rint(t.pat[0], t.pat[1]) : 0,
    };
    S.missions.push(m);
    drawMissions(); renderSheet();
    toast(`${ms(CAT[t.cat].icon)} Neuer Einsatz: <b>${esc(t.name)}</b>`);
    playSound('alarm'); haptic();
  } finally { spawning = false; }
}
function spawnInterval() {
  const n = S.buildings.filter((b) => b.type !== 'KH').length;
  return Math.max(18, rnd(55, 110) / (1 + 0.18 * (n - 1)) / (1 + 0.04 * (S.level - 1)));
}
const maxMissions = () => Math.min(16, 3 + S.buildings.filter((b) => b.type !== 'KH').length * 2 + Math.floor(S.level / 2));

/* ================================================================ tick */
let last = performance.now(), lastRender = 0;
function tick(now) {
  const dtReal = Math.min(1, (now - last) / 1000); last = now;
  if (!S.paused && S.home) {
    S.gt += dtReal * SIM * S.speed;
    for (const v of S.vehicles) {
      if (v.route?.ready && S.gt >= v.route.t0 + v.route.dur) onArrive(v);
      if (v.status === 8 && S.gt >= (v.busyUntil || 0)) { v.target = null; sendHome(v); }
    }
    for (const m of [...S.missions]) missionTick(m);
    if (S.gt >= S.nextSpawn) {
      S.nextSpawn = S.gt + spawnInterval();
      if (S.missions.length < maxMissions()) spawnMission();
    }
  }
  drawVehicles();
  if (now - lastRender > 1000) { lastRender = now; renderLive(); renderHud(); }
  requestAnimationFrame(tick);
}

/* ================================================================== map */
let map;
const markers = { b: new Map(), m: new Map(), v: new Map() };
function initMap() {
  const c = S.home || { lat: 51.16, lng: 10.45 };
  map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: [c.lng, c.lat], zoom: S.home ? 13 : 5.3, attributionControl: false });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  map.on('load', () => { drawBuildings(); drawMissions(); });
  map.on('move', () => { if (UI.build) updateBuildHint(); });
}
function el(html, onClick) {
  const root = document.createElement('div'); root.className = 'mk'; root.innerHTML = html.trim();
  if (onClick) root.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return root;
}
const inner = (mk) => mk.getElement().firstElementChild;
function drawBuildings() {
  for (const [id, mk] of markers.b) if (!bById(id)) { mk.remove(); markers.b.delete(id); }
  for (const b of S.buildings) {
    if (markers.b.has(b.id)) continue;
    const t = BUILDINGS[b.type];
    markers.b.set(b.id, new maplibregl.Marker({ element: el(`<div class="mk-b" style="--c:${t.color}">${ms(t.icon)}</div>`, () => setView({ kind: 'building', id: b.id })) }).setLngLat([b.lng, b.lat]).addTo(map));
  }
}
function drawMissions() {
  if (!map) return;
  for (const [id, mk] of markers.m) if (!mById(id)) { mk.remove(); markers.m.delete(id); }
  for (const m of S.missions) {
    const t = mType(m), c = CAT[t.cat];
    let mk = markers.m.get(m.id);
    if (!mk) {
      mk = new maplibregl.Marker({ element: el(`<div class="mk-m" style="--c:${c.color}">${ms(c.icon)}<i></i></div>`, () => openMission(m.id)) }).setLngLat([m.lng, m.lat]).addTo(map);
      markers.m.set(m.id, mk);
    }
    inner(mk).dataset.state = m.state;
  }
}
function drawVehicles() {
  if (!map) return;
  const visible = new Set();
  for (const v of S.vehicles) {
    if (v.status === 2) continue;
    visible.add(v.id);
    const p = vehPos(v);
    let mk = markers.v.get(v.id);
    if (!mk) {
      mk = new maplibregl.Marker({ element: el(`<div class="mk-v"><b></b></div>`, () => setView({ kind: 'vehicle', id: v.id })) }).setLngLat([p.lng, p.lat]).addTo(map);
      markers.v.set(v.id, mk);
    } else mk.setLngLat([p.lng, p.lat]);
    const e = inner(mk);
    if (e.dataset.s !== String(v.status)) {
      e.dataset.s = v.status; e.style.setProperty('--c', STATUS[v.status].color);
      e.querySelector('b').textContent = `${VEHICLES[v.type].short} · ${v.status}`;
      e.classList.toggle('siren', v.status === 3);
    }
  }
  for (const [id, mk] of markers.v) if (!visible.has(id)) { mk.remove(); markers.v.delete(id); }
}
function floatText(text, p) {
  if (!map) return;
  const mk = new maplibregl.Marker({ element: el(`<div class="float">${esc(text)}</div>`) }).setLngLat([p.lng, p.lat]).addTo(map);
  setTimeout(() => mk.remove(), 1600);
}
function flyTo(p, zoom) { map.easeTo({ center: [p.lng, p.lat], zoom: zoom ?? Math.max(map.getZoom(), 14), padding: { bottom: sheetH(), top: 60, left: 0, right: 0 }, duration: 700 }); }

/* ================================================================ sound */
let actx;
function unlockAudio() { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch {} }
function tone(freq, t0, dur, type = 'sine', vol = 0.18) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(0, actx.currentTime + t0);
  g.gain.linearRampToValueAtTime(vol, actx.currentTime + t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + t0 + dur);
  o.connect(g).connect(actx.destination); o.start(actx.currentTime + t0); o.stop(actx.currentTime + t0 + dur + 0.05);
}
function playSound(kind) {
  if (!S.sound || !actx || document.visibilityState !== 'visible') return;
  try {
    if (kind === 'alarm') { tone(880, 0, 0.35); tone(660, 0.38, 0.45); }
    else if (kind === 'done') { tone(660, 0, 0.15, 'triangle', 0.12); tone(990, 0.12, 0.25, 'triangle', 0.12); }
    else if (kind === 'level') { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.14)); }
    else if (kind === 'go') { tone(740, 0, 0.12, 'square', 0.06); tone(988, 0.13, 0.12, 'square', 0.06); }
  } catch {}
}

/* =============================================================== render */
function renderHud() {
  const need = xpForLevel(S.level + 1), have = xpForLevel(S.level);
  const pct = Math.min(100, ((S.xp - have) / (need - have)) * 100);
  setHTML($('hud'), `
    <div class="glass hud-pill">${ms('payments')}<b>${fmtMoney(S.credits)}</b></div>
    <div class="glass hud-pill lvl">${ms('military_tech')}<b>Lvl ${S.level}</b><span class="bar"><i style="width:${pct}%"></i></span></div>
    <div class="spacer"></div>
    <button class="glass hud-btn" data-action="speed" aria-label="Geschwindigkeit"><b>${S.speed}×</b></button>
    <button class="glass hud-btn" data-action="pause" aria-label="Pause">${ms(S.paused ? 'play_arrow' : 'pause')}</button>
    <button class="glass hud-btn" data-action="settings" aria-label="Einstellungen">${ms('settings')}</button>`);
}

function setView(v, { push = true } = {}) {
  if (push && v.kind !== 'list' && UI.view.kind !== 'build' && UI.view.kind !== 'start' && !(UI.view.kind === v.kind && UI.view.id === v.id)) UI.stack.push(UI.view);
  if (v.kind === 'list') UI.stack = [];
  UI.view = v; UI.confirm = null; if (v.kind !== 'mission') UI.sel.clear();
  if (UI.sheet === 0) UI.sheet = 1;
  renderSheet(); placeSheet();
  if (v.kind === 'building') { const b = bById(v.id); b && flyTo(b); }
  if (v.kind === 'vehicle') { const x = vById(v.id); x && flyTo(vehPos(x)); }
}
function openMission(id) {
  const m = mById(id); if (!m) return;
  if (UI.view.kind === 'mission' && UI.view.id === id) return;
  UI.sel.clear(); suggest(m, true);
  setView({ kind: 'mission', id }); flyTo(m, Math.max(map.getZoom(), 14));
}

function renderSheet() { renderHeader(); renderBody(); }
let lastTouch = 0;
document.addEventListener('pointerdown', () => (lastTouch = performance.now()), true);
document.addEventListener('scroll', () => (lastTouch = performance.now()), true);
function setHTML(el_, html) { if (el_._html !== html) { el_._html = html; el_.innerHTML = html; } }
function renderLive() {
  // refresh dynamic content once per second; pause while the player is tapping/scrolling
  if (UI.view.kind === 'build' || UI.view.kind === 'start') return;
  if (performance.now() - lastTouch < 1500) return;
  renderHeader(); renderBody();
}

function renderHeader() {
  const h = { set innerHTML(x) { setHTML($('sheetHeader'), x); } }, v = UI.view;
  if (v.kind === 'list') {
    const tabs = [['missions', 'Einsätze', S.missions.length], ['vehicles', 'Fahrzeuge', S.vehicles.length], ['buildings', 'Wachen', S.buildings.length]];
    const i = tabs.findIndex((t) => t[0] === UI.tab);
    h.innerHTML = `<div class="segment" style="--n:3;--i:${i}"><span class="thumb"></span>${tabs.map(([k, l, n]) => `<button class="${k === UI.tab ? 'on' : ''}" data-action="tab" data-tab="${k}">${l}<small>${n}</small></button>`).join('')}</div>`;
  } else if (v.kind === 'mission') {
    const m = mById(v.id); if (!m) return;
    const t = mType(m), c = CAT[t.cat];
    h.innerHTML = `<div class="hrow"><span class="ricon big" style="background:${c.color}">${ms(c.icon)}</span><div class="grow"><h2 class="title">${esc(t.name)}</h2><div class="meta">${ms('location_on', 'tiny')} ${esc(m.address)}</div></div><button class="close" data-action="back">${ms('close')}</button></div>`;
  } else if (v.kind === 'building') {
    const b = bById(v.id); if (!b) return;
    const t = BUILDINGS[b.type];
    h.innerHTML = `<div class="hrow"><span class="ricon big" style="background:${t.color}">${ms(t.icon)}</span><div class="grow"><h2 class="title">${esc(b.name)}</h2><div class="meta">${t.name}${t.slots ? ` · ${S.vehicles.filter((x) => x.building === b.id).length}/${t.slots} Stellplätze` : ''}</div></div><button class="close" data-action="back">${ms('close')}</button></div>`;
  } else if (v.kind === 'vehicle') {
    const x = vById(v.id); if (!x) return;
    h.innerHTML = `<div class="hrow"><span class="ricon big" style="background:${VEHICLES[x.type].color}">${ms(vIcon(x.type))}</span><div class="grow"><h2 class="title">${esc(x.name)}</h2><div class="meta">${VEHICLES[x.type].name}</div></div><button class="close" data-action="back">${ms('close')}</button></div>`;
  } else if (v.kind === 'build') {
    h.innerHTML = `<div class="hrow"><div class="grow"><h2 class="title">Neues Gebäude</h2><div class="meta">Karte verschieben, Typ wählen, bauen</div></div><button class="close" data-action="cancel-build">${ms('close')}</button></div>`;
  } else if (v.kind === 'start') {
    h.innerHTML = `<div class="hrow"><div class="grow"><h2 class="title">Willkommen in der Einsatzzentrale</h2><div class="meta">Wo soll deine Leitstelle stehen?</div></div></div>`;
  }
}
const vIcon = (type) => ({ fire: 'fire_truck', ems: 'ambulance', police: 'local_police' }[VEHICLES[type].org]);
function statusChip(v) { const s = STATUS[v.status]; return `<span class="chip-s" style="--c:${s.color}">${v.status}</span>`; }
function vehicleRow(v, { action = 'vehicle', extra = '', check = null } = {}) {
  const b = bById(v.building);
  return `<button class="row" data-action="${action}" data-id="${v.id}">
    ${check === null ? statusChip(v) : `<span class="check ${check ? 'on' : ''}">${ms('check')}</span>`}
    <span class="txt"><div class="t">${esc(v.name)} <span class="tag" style="--c:${VEHICLES[v.type].color}">${VEHICLES[v.type].short}</span></div>
    <div class="s">${extra || `${STATUS[v.status].label}${b ? ` · ${esc(b.name)}` : ''}`}</div></span></button>`;
}

function renderBody() {
  const b = $('sheetBody'), v = UI.view;
  let h = '';
  if (v.kind === 'start') h = startBody();
  else if (v.kind === 'list') h = UI.tab === 'missions' ? missionsList() : UI.tab === 'vehicles' ? vehiclesList() : buildingsList();
  else if (v.kind === 'mission') h = missionBody(mById(v.id));
  else if (v.kind === 'building') h = buildingBody(bById(v.id));
  else if (v.kind === 'vehicle') h = vehicleBody(vById(v.id));
  else if (v.kind === 'build') h = buildBody();
  setHTML(b, h);
  renderActionBar();
}
function renderActionBar() {
  const bar = $('actionBar'), v = UI.view;
  if (v.kind === 'mission' && mById(v.id)) {
    bar.hidden = false;
    setHTML(bar, `<button class="btn alarm" data-action="alarm" ${UI.sel.size ? '' : 'disabled'}>${ms('campaign')} Alarmieren${UI.sel.size ? ` (${UI.sel.size})` : ''}</button>`);
  } else if (v.kind === 'build') {
    const sel = UI.build?.type;
    bar.hidden = false;
    setHTML(bar, `<button class="btn primary" data-action="place" ${sel ? '' : 'disabled'}>${ms('add_location_alt')} Hier bauen${sel ? ` – ${BUILDINGS[sel].name}` : ''}</button>`);
  } else bar.hidden = true;
  document.body.classList.toggle('has-bar', !bar.hidden);
}

function startBody() {
  return `<div class="pad">
    <p class="lead">Baue Wachen auf einer echten Karte, kaufe Fahrzeuge und alarmiere die richtigen Einheiten, wenn Notrufe eingehen.</p>
    <button class="btn primary" data-action="start-here">${ms('my_location')} Mein Standort</button>
    <div class="search glass-inset">${ms('search')}<input id="cityQ" placeholder="Oder Stadt suchen, z. B. Hamburg" autocomplete="off" enterkeyhint="search"></div>
    <div id="cityRes"></div></div>`;
}

function missionsList() {
  if (!S.buildings.length) return `<div class="empty-state">${ms('add_location_alt', 'huge')}<h3>Noch keine Wache</h3><p>Baue deine erste Feuerwache – danach gehen die ersten Notrufe ein.</p><button class="btn primary" data-action="build">${ms('add')} Erste Wache bauen</button></div>`;
  if (!S.missions.length) return `<div class="empty-state">${ms('headset_mic', 'huge')}<h3>Alles ruhig</h3><p>Warte auf den nächsten Notruf …</p></div>`;
  const order = { new: 0, enroute: 1, working: 2 };
  return [...S.missions].sort((a, b) => order[a.state] - order[b.state] || a.created - b.created).map((m) => {
    const t = mType(m), c = CAT[t.cat];
    const prog = m.state === 'working' ? Math.min(100, ((S.gt - m.workStart) / t.work) * 100) : 0;
    const label = { new: 'Neu – Fahrzeuge alarmieren', enroute: `${enRoute(m).length} unterwegs · ${onScene(m).length} vor Ort`, working: `Wird abgearbeitet · noch ${fmtTime(m.workStart + t.work - S.gt)}` }[m.state];
    return `<button class="row mission ${m.state}" data-action="mission" data-id="${m.id}">
      <span class="ricon" style="background:${c.color}">${ms(c.icon)}</span>
      <span class="txt"><div class="t">${esc(t.name)}</div><div class="s">${esc(m.address)}</div><div class="s st">${label}</div>
      ${m.state === 'working' ? `<span class="prog"><i style="width:${prog}%"></i></span>` : ''}</span>
      <span class="reward">${fmtMoney(t.reward)}</span></button>`;
  }).join('');
}
function vehiclesList() {
  if (!S.vehicles.length) return '<p class="empty">Noch keine Fahrzeuge. Baue eine Wache – jede Wache bringt ein erstes Fahrzeug mit.</p>';
  const groups = [[3, 4, 7, 8], [1], [2]];
  const names = ['Im Einsatz', 'Frei über Funk', 'Auf Wache'];
  return groups.map((g, i) => {
    const list = S.vehicles.filter((v) => g.includes(v.status));
    return list.length ? `<div class="section"><h3>${names[i]}</h3><span class="count">${list.length}</span></div>${list.map((v) => vehicleRow(v)).join('')}` : '';
  }).join('') + statusLegend();
}
function statusLegend() {
  return `<div class="legend">${Object.entries(STATUS).map(([k, s]) => `<span><span class="chip-s" style="--c:${s.color}">${k}</span>${s.label}</span>`).join('')}</div>`;
}
function buildingsList() {
  return `<div class="pad"><button class="btn primary" data-action="build">${ms('add')} Neues Gebäude bauen</button></div>` +
    S.buildings.map((b) => {
      const t = BUILDINGS[b.type], vs = S.vehicles.filter((v) => v.building === b.id);
      const free = vs.filter((v) => v.status === 2).length;
      return `<button class="row" data-action="building" data-id="${b.id}"><span class="ricon" style="background:${t.color}">${ms(t.icon)}</span>
        <span class="txt"><div class="t">${esc(b.name)}</div><div class="s">${t.name}${t.slots ? ` · ${vs.length} Fahrzeuge, ${free} auf Wache` : ''}</div></span>${ms('chevron_right', 'dim')}</button>`;
    }).join('');
}

function reqChips(m) {
  const t = mType(m);
  const scene = coverage(t.req, onScene(m));
  const way = coverage(t.req, onScene(m).concat(enRoute(m)));
  const selV = [...UI.sel].map(vById).filter(Boolean);
  const plan = coverage(t.req, onScene(m).concat(enRoute(m), selV));
  return Object.entries(t.req).map(([type, n]) => {
    const atScene = n - (scene.missing[type] || 0), coming = n - (way.missing[type] || 0) - atScene, planned = n - (plan.missing[type] || 0) - atScene - coming;
    const state = atScene >= n ? 'ok' : atScene + coming >= n ? 'way' : atScene + coming + planned >= n ? 'plan' : 'miss';
    return `<span class="req ${state}"><b>${n}×</b> ${VEHICLES[type].short}<small>${atScene}${coming ? ` +${coming}` : ''}${planned ? ` +${planned}` : ''}/${n}</small></span>`;
  }).join('');
}
function available(m) {
  return S.vehicles.filter((v) => (v.status === 1 || v.status === 2) && !v.mission)
    .map((v) => ({ v, eta: estimateEta(v, m) })).sort((a, b) => a.eta - b.eta);
}
/** Selects the closest vehicles covering what's still missing (alarm proposal). */
function suggest(m, quiet) {
  const t = mType(m);
  UI.sel.clear();
  const missing = { ...coverage(t.req, onScene(m).concat(enRoute(m))).missing };
  for (const { v } of available(m)) {
    const f = VEHICLES[v.type].fills.find((x) => missing[x] > 0);
    if (f) { missing[f]--; UI.sel.add(v.id); }
  }
  if (!quiet && Object.values(missing).some((n) => n > 0)) toast(`${ms('warning')} Nicht genug freie Fahrzeuge für alle Anforderungen.`);
}
function missionBody(m) {
  if (!m) return '<p class="empty">Einsatz beendet.</p>';
  const t = mType(m);
  const prog = m.state === 'working' ? Math.min(100, ((S.gt - m.workStart) / t.work) * 100) : 0;
  let h = `<div class="card"><p class="call">„${esc(t.text)}“</p>
    <div class="facts"><span>${ms('payments')} ${fmtMoney(t.reward)} Credits</span>${m.patients ? `<span>${ms('personal_injury')} ${m.patients} Patient${m.patients > 1 ? 'en' : ''}</span>` : ''}<span>${ms('timer')} ${fmtTime(t.work)} vor Ort</span></div></div>
    <div class="section"><h3>Benötigt</h3></div><div class="reqs">${reqChips(m)}</div>`;
  if (m.state === 'working') h += `<div class="card"><div class="workrow">${ms('construction')}<b>Einsatz läuft</b><span>noch ${fmtTime(m.workStart + t.work - S.gt)}</span></div><span class="prog big"><i style="width:${prog}%"></i></span></div>`;
  const assigned = S.vehicles.filter((v) => v.mission === m.id);
  if (assigned.length) h += `<div class="section"><h3>Alarmiert</h3><span class="count">${assigned.length}</span></div>` + assigned.map((v) => vehicleRow(v, {
    action: 'vehicle', extra: v.status === 3 ? `Anfahrt · ${isFinite(remaining(v)) ? `noch ${fmtTime(remaining(v) / (SIM * S.speed))}` : 'Route wird berechnet …'}` : STATUS[v.status].label,
  })).join('');
  const av = available(m);
  h += `<div class="section"><h3>Freie Fahrzeuge</h3><button class="link" data-action="suggest">${ms('auto_awesome')} Vorschlag</button></div>`;
  h += av.length ? av.slice(0, 40).map(({ v, eta }) => vehicleRow(v, { action: 'toggle-veh', check: UI.sel.has(v.id), extra: `${STATUS[v.status].label} · ca. ${fmtTime(eta / (SIM * S.speed))} entfernt` })).join('') : '<p class="empty">Keine freien Fahrzeuge.</p>';
  return h;
}

function buildingBody(b) {
  if (!b) return '';
  const t = BUILDINGS[b.type], vs = S.vehicles.filter((v) => v.building === b.id);
  let h = '';
  if (b.type === 'KH') h += `<div class="card"><p>Rettungswagen bringen Patienten nach abgeschlossenen Einsätzen hierher. Jeder Transport bringt <b>+260 Credits</b>.</p><p class="dim">Fahrzeuge am Krankenhaus: ${S.vehicles.filter((v) => v.status === 8 && v.target === b.id).length}</p></div>`;
  if (t.slots) {
    h += `<div class="section"><h3>Fahrzeuge</h3><span class="count">${vs.length}/${t.slots}</span></div>` + (vs.map((v) => `<div class="rowwrap">${vehicleRow(v)}<button class="trash ${UI.confirm === `veh:${v.id}` ? 'armed' : ''}" data-action="sell-veh" data-id="${v.id}" aria-label="Fahrzeug verkaufen">${ms(UI.confirm === `veh:${v.id}` ? 'check' : 'delete')}</button></div>`).join('') || '<p class="empty">Keine Fahrzeuge.</p>');
    h += `<div class="section"><h3>Fahrzeug kaufen</h3></div><div class="shop">` + t.vehicles.map((type) => {
      const vt = VEHICLES[type], locked = S.level < vt.level, full = vs.length >= t.slots, poor = S.credits < vt.cost;
      return `<button class="shop-item ${locked ? 'locked' : ''}" data-action="buy-veh" data-type="${type}" ${locked || full || poor ? 'disabled' : ''}>
        <span class="ricon" style="background:${vt.color}">${ms(locked ? 'lock' : vIcon(type))}</span>
        <span class="txt"><div class="t">${vt.short}</div><div class="s">${vt.name}</div><div class="price">${locked ? `ab Level ${vt.level}` : `${fmtMoney(vt.cost)} Credits`}</div></span></button>`;
    }).join('') + '</div>';
  }
  const refund = Math.round(BUILDINGS[b.type].cost * 0.5 + vs.reduce((s_, v) => s_ + refundVeh(v), 0));
  h += `<div class="section"><h3>Verwaltung</h3></div><div class="pad">${sellButton('bld', b.id, `${t.name} abreißen (+${fmtMoney(refund)} Credits)`)}
    <p class="dim small">Fahrzeuge der Wache werden mit verkauft. Fahrzeuge im Einsatz werden vorher abgezogen.</p></div>`;
  return h;
}
function vehicleBody(v) {
  if (!v) return '';
  const m = v.mission ? mById(v.mission) : null, b = bById(v.building);
  let h = `<div class="card"><div class="workrow">${statusChip(v)}<b>${STATUS[v.status].label}</b>${v.route ? `<span>${isFinite(remaining(v)) ? `noch ${fmtTime(remaining(v) / (SIM * S.speed))}` : '…'}</span>` : ''}</div>
    ${m ? `<p>Einsatz: <a data-action="mission" data-id="${m.id}">${esc(mType(m).name)}</a></p>` : ''}
    ${b ? `<p class="dim">Wache: ${esc(b.name)}</p>` : ''}</div>`;
  if (v.status === 3 || v.status === 4) h += `<div class="pad"><button class="btn" data-action="recall" data-id="${v.id}">${ms('undo')} Zurück zur Wache</button></div>`;
  h += `<div class="pad">${sellButton('veh', v.id, `Fahrzeug verkaufen (+${fmtMoney(refundVeh(v))} Credits)`)}</div>`;
  return h;
}
const refundVeh = (v) => Math.round(VEHICLES[v.type].cost * 0.5);
function sellButton(kind, id, label) {
  const armed = UI.confirm === `${kind}:${id}`;
  return `<button class="btn danger ${armed ? 'armed' : ''}" data-action="sell-${kind}" data-id="${id}">${ms(armed ? 'warning' : 'delete')} ${armed ? 'Wirklich? Zum Bestätigen nochmal tippen' : label}</button>`;
}
function removeVehicle(v) {
  S.vehicles = S.vehicles.filter((x) => x !== v);
  const mk = markers.v.get(v.id); if (mk) { mk.remove(); markers.v.delete(v.id); }
}

function buildBody() {
  const sel = UI.build?.type;
  return `<div class="shop">` + Object.entries(BUILDINGS).map(([k, t]) => {
    const locked = S.level < t.level, cost = buildCost(k);
    return `<button class="shop-item ${sel === k ? 'sel' : ''} ${locked ? 'locked' : ''}" data-action="pick-build" data-type="${k}" ${locked ? 'disabled' : ''}>
      <span class="ricon" style="background:${t.color}">${ms(locked ? 'lock' : t.icon)}</span>
      <span class="txt"><div class="t">${t.name}</div><div class="s">${t.starter ? `inkl. 1 ${VEHICLES[t.starter].short}` : 'Für Patiententransporte'}</div><div class="price">${locked ? `ab Level ${t.level}` : cost === 0 ? 'Gratis' : `${fmtMoney(cost)} Credits`}</div></span></button>`;
  }).join('') + `</div><div class="pad"><p class="dim" id="buildHint">Verschiebe die Karte, bis das Fadenkreuz auf dem gewünschten Platz liegt.</p></div>`;
}
function buildCost(type) {
  const n = S.buildings.filter((b) => b.type === type).length;
  if (type === 'FW' && S.buildings.length === 0) return 0; // first fire station is free
  return Math.round(BUILDINGS[type].cost * (1 + n * 0.25));
}
function crosshairLngLat() {
  const r = $('crosshair').getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
  const ll = map.unproject([r.left - m.left, r.top - m.top]); return { lat: ll.lat, lng: ll.lng };
}
function updateBuildHint() {
  const el_ = $('buildHint'); if (!el_) return;
  const p = crosshairLngLat();
  const near = S.buildings.map((b) => dist(b, p)).sort((a, b) => a - b)[0];
  el_.textContent = near != null && near < 250 ? 'Zu nah an einem anderen Gebäude.' : 'Verschiebe die Karte, bis das Fadenkreuz auf dem gewünschten Platz liegt.';
}

/* ============================================================== actions */
const A = {
  tab: ({ tab }) => { UI.tab = tab; const seg = document.querySelector('.segment'); if (seg) seg.style.setProperty('--i', ['missions', 'vehicles', 'buildings'].indexOf(tab)); setTimeout(renderSheet, 160); },
  back: () => {
    let prev = UI.stack.pop();
    while (prev && ((prev.kind === 'mission' && !mById(prev.id)) || (prev.kind === 'vehicle' && !vById(prev.id)) || (prev.kind === 'building' && !bById(prev.id)))) prev = UI.stack.pop();
    setView(prev || { kind: 'list' }, { push: false });
  },
  mission: ({ id }) => openMission(id),
  building: ({ id }) => setView({ kind: 'building', id }),
  vehicle: ({ id }) => setView({ kind: 'vehicle', id }),
  'toggle-veh': ({ id }) => { UI.sel.has(id) ? UI.sel.delete(id) : UI.sel.add(id); haptic(); renderBody(); },
  suggest: () => { const m = mById(UI.view.id); if (m) { suggest(m); renderBody(); } },
  alarm: () => {
    const m = mById(UI.view.id); if (!m || !UI.sel.size) return;
    for (const id of UI.sel) { const v = vById(id); if (!v || v.mission) continue; v.mission = m.id; v.status = 3; drive(v, m, 'mission', true); }
    toast(`${ms('campaign')} ${UI.sel.size} Fahrzeug${UI.sel.size > 1 ? 'e' : ''} alarmiert`);
    UI.sel.clear(); m.state = m.state === 'new' ? 'enroute' : m.state; playSound('go'); haptic();
    drawMissions(); drawVehicles(); A.back();
  },
  recall: ({ id }) => { const v = vById(id); if (v) { sendHome(v); renderSheet(); } },
  'sell-veh': ({ id }) => {
    const v = vById(id); if (!v) return;
    if (UI.confirm !== `veh:${id}`) { UI.confirm = `veh:${id}`; haptic(); renderBody(); setTimeout(() => { if (UI.confirm === `veh:${id}`) { UI.confirm = null; renderBody(); } }, 4000); return; }
    UI.confirm = null;
    const refund = refundVeh(v); S.credits += refund; removeVehicle(v);
    toast(`${ms('delete')} ${esc(v.name)} verkauft · +${fmtMoney(refund)} Credits`);
    if (UI.view.kind === 'vehicle' && UI.view.id === id) A.back(); else renderSheet();
    renderHud(); save();
  },
  'sell-bld': ({ id }) => {
    const b = bById(id); if (!b) return;
    if (UI.confirm !== `bld:${id}`) { UI.confirm = `bld:${id}`; haptic(); renderBody(); setTimeout(() => { if (UI.confirm === `bld:${id}`) { UI.confirm = null; renderBody(); } }, 4000); return; }
    UI.confirm = null;
    const vs = S.vehicles.filter((v) => v.building === id);
    let refund = Math.round(BUILDINGS[b.type].cost * 0.5);
    for (const v of vs) { refund += refundVeh(v); removeVehicle(v); }
    // patients heading to a demolished hospital go home instead
    for (const v of S.vehicles) if (v.target === id) { v.target = null; sendHome(v); }
    S.buildings = S.buildings.filter((x) => x !== b); S.credits += refund;
    drawBuildings(); toast(`${ms('delete')} ${esc(b.name)} abgerissen · +${fmtMoney(refund)} Credits`);
    setView({ kind: 'list' }); renderHud(); save();
  },
  'buy-veh': ({ type }) => {
    const b = bById(UI.view.id), vt = VEHICLES[type]; if (!b || S.credits < vt.cost) return;
    S.credits -= vt.cost; addVehicle(b, type); haptic(); toast(`${ms('check_circle')} ${vt.name} gekauft`); renderSheet(); renderHud(); save();
  },
  build: () => {
    UI.build = { type: S.buildings.length ? null : 'FW' }; document.body.classList.add('building'); UI.view = { kind: 'build' }; UI.sheet = 1; renderSheet(); placeSheet();
    map.easeTo({ padding: { top: 60, bottom: sheetH(), left: 0, right: 0 }, duration: 300 });
  },
  'cancel-build': () => { UI.build = null; document.body.classList.remove('building'); setView({ kind: 'list' }); },
  'pick-build': ({ type }) => { UI.build = { type }; renderBody(); },
  place: async () => {
    const type = UI.build?.type; if (!type) return;
    const cost = buildCost(type);
    if (S.credits < cost) return toast(`${ms('error')} Nicht genug Credits`);
    const p = crosshairLngLat();
    if (S.buildings.some((b) => dist(b, p) < 250)) return toast(`${ms('error')} Zu nah an einem anderen Gebäude`);
    S.credits -= cost;
    const t = BUILDINGS[type];
    const b = { id: uid(), type, lat: p.lat, lng: p.lng, name: `${t.name} ${S.buildings.filter((x) => x.type === type).length + 1}` };
    S.buildings.push(b);
    if (t.starter) addVehicle(b, t.starter);
    UI.build = null; document.body.classList.remove('building');
    drawBuildings(); haptic(); playSound('done');
    toast(`${ms(t.icon)} ${t.name} gebaut`);
    if (S.nextSpawn > S.gt + 15) S.nextSpawn = S.gt + 12; // first call comes quickly
    setView({ kind: 'building', id: b.id }); save();
    reverse(p).then((a) => { const place = a?.district || a?.city; if (place) { b.name = `${t.name} ${place}`; S.vehicles.filter((v) => v.building === b.id).forEach((v, i) => (v.name = vehName(b, v.type, i))); renderSheet(); } });
  },
  speed: () => { S.speed = { 1: 2, 2: 5, 5: 1 }[S.speed] || 1; renderHud(); toast(`${ms('speed')} Spielgeschwindigkeit ${S.speed}×`, 1400); },
  pause: () => { S.paused = !S.paused; renderHud(); toast(S.paused ? `${ms('pause')} Pausiert` : `${ms('play_arrow')} Weiter`, 1200); },
  settings: () => { $('settings').hidden = false; renderSettings(); },
  'close-settings': () => { $('settings').hidden = true; UI.resetArm = false; },
  'toggle-sound': () => { S.sound = !S.sound; renderSettings(); },
  reset: () => {
    if (!UI.resetArm) { UI.resetArm = true; renderSettings(); return; }
    localStorage.removeItem(SAVE_KEY); location.reload();
  },
  'start-here': () => {
    if (!navigator.geolocation) return toast('Standort nicht verfügbar – bitte Stadt suchen.');
    toast(`${ms('my_location')} Standort wird ermittelt …`);
    navigator.geolocation.getCurrentPosition((p) => startAt({ lat: p.coords.latitude, lng: p.coords.longitude }), () => toast('Standort nicht erlaubt – bitte Stadt suchen.'), { enableHighAccuracy: false, timeout: 15000 });
  },
  city: ({ lat, lng }) => startAt({ lat: +lat, lng: +lng }),
  'center-home': () => S.home && flyTo(S.home, 13),
};
function vehName(b, type, i) { return `${VEHICLES[type].short} ${b.name.replace(/^\S+\s/, '')}${i ? ` ${i + 1}` : ''}`.trim(); }
function addVehicle(b, type) {
  const i = S.vehicles.filter((v) => v.building === b.id && v.type === type).length;
  S.vehicles.push({ id: uid(), type, building: b.id, name: vehName(b, type, i), status: 2, lat: b.lat, lng: b.lng, mission: null, route: null });
}
function startAt(p) {
  S.home = p; save();
  map.flyTo({ center: [p.lng, p.lat], zoom: 13.5, duration: 1600 });
  toast(`${ms('flag')} Leitstelle eingerichtet. Baue jetzt deine erste Feuerwache!`, 4000);
  A.build();
}
function renderSettings() {
  $('settingsCard').innerHTML = `<div class="hrow"><div class="grow"><h2 class="title">Einstellungen</h2><div class="meta">Einsatzzentrale ${VERSION}</div></div><button class="close" data-action="close-settings">${ms('close')}</button></div>
    <div class="card stats">
      <div><b>${S.stats.done}</b><small>Einsätze</small></div><div><b>${fmtMoney(S.stats.earned)}</b><small>Credits verdient</small></div><div><b>${S.vehicles.length}</b><small>Fahrzeuge</small></div></div>
    <div class="card"><label class="opt"><span>Töne bei neuen Einsätzen</span><span class="switch"><input type="checkbox" ${S.sound ? 'checked' : ''} data-change="toggle-sound"><span></span></span></label></div>
    <div class="pad"><button class="btn danger" data-action="reset">${ms('restart_alt')} ${UI.resetArm ? 'Wirklich alles löschen? Nochmal tippen' : 'Spielstand zurücksetzen'}</button>
    <p class="dim small">Karte © OpenStreetMap-Mitwirkende, OpenFreeMap · Routen: OSRM · Adressen: Photon</p></div>`;
}

document.addEventListener('click', (e) => {
  unlockAudio();
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const fn = A[t.dataset.action];
  if (fn) { e.preventDefault(); fn({ ...t.dataset }); }
});
document.addEventListener('change', (e) => { const a = e.target.dataset.change; if (a && A[a]) A[a](); });
let cityTimer;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'cityQ') return;
  clearTimeout(cityTimer);
  const q = e.target.value.trim();
  cityTimer = setTimeout(async () => {
    if (q.length < 2) { $('cityRes').innerHTML = ''; return; }
    try {
      const res = await searchPlace(q);
      $('cityRes').innerHTML = res.map((r) => `<button class="row" data-action="city" data-lat="${r.lat}" data-lng="${r.lng}"><span class="ricon" style="background:#5e6ad2">${ms('location_city')}</span><span class="txt"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.sub)}</div></span></button>`).join('') || '<p class="empty">Nichts gefunden.</p>';
    } catch { $('cityRes').innerHTML = '<p class="empty">Suche gerade nicht erreichbar.</p>'; }
  }, 300);
});

/* ========================================================= bottom sheet */
let _sb = null;
function safeBottom() { if (_sb == null) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px)'; document.body.appendChild(d); _sb = d.offsetHeight; d.remove(); } return _sb; }
function snaps() { const H = window.innerHeight, full = $('sheet').offsetHeight || H; return [safeBottom() + 92, Math.round(H * 0.48), full]; }
const sheetH = () => snaps()[Math.min(UI.sheet, 1)];
function placeSheet() {
  const el_ = $('sheet'), full = el_.offsetHeight || window.innerHeight;
  el_.style.transform = `translateY(${full - snaps()[UI.sheet]}px)`; el_.dataset.snap = UI.sheet; document.body.dataset.sheet = UI.sheet;
  document.documentElement.style.setProperty('--sheet-h', sheetH() + 'px');
  // the part of the sheet below the screen edge must not swallow list content
  document.documentElement.style.setProperty('--hidden-h', Math.max(0, full - snaps()[UI.sheet]) + 'px');
  if (UI.build) updateBuildHint();
}
(function drag() {
  const el_ = $('sheet'), h = $('sheetDrag');
  let y0 = 0, t0 = 0, ly = 0, lt = 0, vel = 0, on = false, pid;
  const cur = () => +(/translateY\(([-\d.]+)px\)/.exec(el_.style.transform)?.[1] || 0);
  h.addEventListener('pointerdown', (e) => { if (e.target.closest('button,input')) return; pid = e.pointerId; y0 = ly = e.clientY; t0 = cur(); lt = performance.now(); vel = 0; on = true; el_.classList.add('dragging'); h.setPointerCapture(pid); });
  h.addEventListener('pointermove', (e) => { if (!on || e.pointerId !== pid) return; const n = performance.now(); vel = (e.clientY - ly) / Math.max(1, n - lt); ly = e.clientY; lt = n; el_.style.transform = `translateY(${Math.max(-20, Math.min(el_.offsetHeight - snaps()[0] + 30, t0 + e.clientY - y0))}px)`; });
  const end = (e) => {
    if (!on || e.pointerId !== pid) return; on = false; el_.classList.remove('dragging');
    const full = el_.offsetHeight, proj = cur() + vel * 180, sp = snaps(); let best = 0;
    sp.forEach((s, i) => { if (Math.abs(full - s - proj) < Math.abs(full - sp[best] - proj)) best = i; });
    if (Math.abs(ly - y0) < 4) best = UI.sheet === 0 ? 1 : UI.sheet;
    UI.sheet = best; placeSheet();
  };
  h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { _sb = null; placeSheet(); });
})();

/* ================================================================= boot */
// read-only handle for automated UI tests
Object.defineProperty(window, '__ez', { value: { get map() { return map; }, get state() { return S; }, markers } });
function boot() {
  if (!window.maplibregl) { $('sheetBody').innerHTML = '<p class="empty">Die Karte konnte nicht geladen werden. Bitte Internet prüfen und neu laden.</p>'; return; }
  initMap();
  // reconcile vehicles whose route was still being calculated when the game was closed
  for (const v of S.vehicles) if (v.route && !v.route.ready) { const r = v.route; v.route = null; drive(v, r.to, r.kind, r.kind === 'mission'); }
  UI.view = S.home ? { kind: 'list' } : { kind: 'start' };
  if (!S.home) UI.sheet = 1;
  renderHud(); renderSheet(); placeSheet();
  requestAnimationFrame(tick);
}
boot();
