import { createClient } from '@supabase/supabase-js';
import './style.css';

// Set these in Vercel → Project → Settings → Environment Variables (or a local .env file).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://euaekvydqxnvjpolszvk.supabase.co';
// Publishable ("anon") key: meant to be public – every browser client needs it. The data is protected by
// the row-level security rules in supabase/schema.sql, not by keeping this key secret.
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_G7441Hv11YHHCbaa5N54tg_BytyRo42';

const VERSION = '1.0';
/* =============================================================== utils */
const $ = (id) => document.getElementById(id);
const ms = (n, cls = '') => `<span class="ms ${cls}">${n}</span>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('lumo.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lumo.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('lumo.' + k); } catch {} },
};
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
let toastT;
function toast(html, kind = '') { const t = $('toast'); t.className = kind; t.innerHTML = html; t.hidden = false; t.classList.remove('in'); void t.offsetWidth; t.classList.add('in'); clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }
const fail = (e) => { console.error(e); toast(`${ms('error')} ${esc(germanError(e))}`, 'err'); };
function germanError(e) {
  const m = (e?.message || e?.error_description || String(e || 'Fehler')).toString();
  const map = [
    [/Invalid login credentials/i, 'E-Mail oder Passwort ist falsch.'],
    [/Email not confirmed/i, 'Bitte bestätige zuerst deine E-Mail (Link im Postfach).'],
    [/User already registered/i, 'Für diese E-Mail gibt es schon ein Konto.'],
    [/Password should be at least/i, 'Das Passwort muss mindestens 6 Zeichen haben.'],
    [/rate limit/i, 'Zu viele Versuche – bitte kurz warten.'],
    [/duplicate key.*username/i, 'Dieser Benutzername ist schon vergeben.'],
    [/username_check|check constraint "profiles_username/i, 'Benutzername: 2–32 Zeichen, nur a–z, 0–9, Punkt und Unterstrich.'],
    [/Failed to fetch|NetworkError|Load failed/i, 'Keine Verbindung zum Server.'],
    [/JWT expired/i, 'Sitzung abgelaufen – bitte neu anmelden.'],
    [/Payload too large|exceeded the maximum/i, 'Datei ist zu groß.'],
  ];
  for (const [re, t] of map) if (re.test(m)) return t;
  return m;
}
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function when(ts) {
  const d = new Date(ts), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Heute um ${timeFmt.format(d)}`;
  if (d.toDateString() === y.toDateString()) return `Gestern um ${timeFmt.format(d)}`;
  return `${d.toLocaleDateString('de-DE')} ${timeFmt.format(d)}`;
}
function dayLabel(ts) { const d = new Date(ts), n = new Date(); if (d.toDateString() === n.toDateString()) return 'Heute'; const y = new Date(n); y.setDate(n.getDate() - 1); return d.toDateString() === y.toDateString() ? 'Gestern' : dayFmt.format(d); }
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const initials = (n) => (n || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
function hueOf(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

/* ======================================================= configuration */
// The server connection is fixed at build time and cannot be changed or viewed from inside the app.
const CFG = { u: SUPABASE_URL, k: SUPABASE_ANON_KEY, fixed: true };
try { localStorage.removeItem('lumo.cfg'); } catch {}
const appUrl = () => location.origin + location.pathname;
let sb = null;

/* =============================================================== state */
const st = {
  session: null, me: null,
  profiles: new Map(), servers: [], members: new Map(), channels: new Map(),
  convs: [], friends: [], online: new Map(),
  view: { space: 'home', target: { kind: 'friends' } }, friendsTab: 'online',
  messages: new Map(), hasMore: new Map(), reactions: new Map(), votes: new Map(),
  lastAt: new Map(), readAt: new Map(), mentions: new Map(),
  replyTo: null, editing: null, pane: 'nav', showMembers: LS.get('showMembers', true),
  typing: new Map(), pendingFiles: [], search: '',
  settings: { theme: 'auto', compact: false, sound: true, fontSize: 15, ...LS.get('settings', {}) },
  voice: null, voicePresence: new Map(),
};
const targetKey = (t) => (t.kind === 'channel' ? t.id : t.kind === 'conv' ? t.id : t.kind);
const curTarget = () => st.view.target;
const curServer = () => st.servers.find((s) => s.id === st.view.space) || null;
const myRole = (sid) => (st.members.get(sid) || []).find((m) => m.user_id === st.me?.id)?.role || null;
const isAdmin = (sid) => ['owner', 'admin'].includes(myRole(sid));
const prof = (id) => st.profiles.get(id) || { id, username: '…', display_name: 'Unbekannt', status: 'invisible' };
const nameOf = (id) => { const p = prof(id); return p.display_name || p.username; };
function statusOf(id) {
  if (id === st.me?.id) return st.me.status === 'invisible' ? 'offline' : st.me.status;
  const o = st.online.get(id); return o ? o.status || 'online' : 'offline';
}
const STATUS = { online: ['Online', '#23d18b'], idle: ['Abwesend', '#f5b82e'], dnd: ['Bitte nicht stören', '#f04c5e'], invisible: ['Unsichtbar', '#8a8fa3'], offline: ['Offline', '#8a8fa3'] };

function avatar(id, size = 40, withStatus = false) {
  const p = prof(id), s = statusOf(id);
  const inner = p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy">` : `<span style="--h:${hueOf(id)}">${esc(initials(p.display_name || p.username))}</span>`;
  return `<span class="av" style="--s:${size}px">${inner}${withStatus ? `<i class="dot ${s}" title="${STATUS[s][0]}"></i>` : ''}</span>`;
}
async function ensureProfiles(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !st.profiles.has(id));
  if (!missing.length) return;
  const { data, error } = await sb.from('profiles').select('*').in('id', missing);
  if (error) return console.warn(error);
  data.forEach((p) => st.profiles.set(p.id, p));
}

/* ============================================================== sounds */
let actx;
function unlockAudio() { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch {} }
function beep(kind) {
  if (!st.settings.sound || !actx) return;
  const notes = { msg: [[880, 0, .09], [1320, .09, .14]], join: [[523, 0, .1], [784, .1, .16]], leave: [[784, 0, .1], [523, .1, .16]] }[kind] || [];
  for (const [f, t, d] of notes) {
    const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, actx.currentTime + t); g.gain.linearRampToValueAtTime(.12, actx.currentTime + t + .015); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + t + d);
    o.connect(g).connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + d + .05);
  }
}

/* ============================================================ markdown */
function md(src) {
  const blocks = [];
  let s = esc(src);
  s = s.replace(/```(?:[a-z0-9]+\n)?([\s\S]*?)```/gi, (_, code) => { blocks.push(`<pre><code>${code.replace(/^\n/, '')}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { blocks.push(`<code>${c}</code>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/(^|\n)&gt; ?([^\n]*)/g, '$1<blockquote>$2</blockquote>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>').replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" data-action="spoiler">$1</span>');
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/(^|[\s(])@([a-z0-9_.]{2,32})\b/g, (m, pre, u) => {
    const p = [...st.profiles.values()].find((x) => x.username === u);
    if (!p) return m;
    return `${pre}<span class="mention ${p.id === st.me?.id ? 'me' : ''}" data-action="profile" data-id="${p.id}">@${esc(p.display_name || u)}</span>`;
  });
  s = s.replace(/(^|\s)@(everyone|here)\b/g, '$1<span class="mention me">@$2</span>');
  s = s.replace(/\n/g, '<br>').replace(/<\/blockquote><br>/g, '</blockquote>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  return s;
}
const mentionsMe = (txt) => !!st.me && (new RegExp(`(^|\\s)@${st.me.username}\\b`).test(txt) || /(^|\s)@(everyone|here)\b/.test(txt));
const onlyEmoji = (t) => /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s){1,12}$/u.test(t) && /\p{Extended_Pictographic}/u.test(t);

const EMOJI = '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 🤔 🤫 🤭 🙄 😬 😴 🤤 🤢 🤮 🤧 😷 🤠 🤡 💀 👻 👽 🤖 💩 😺 👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 👐 🤝 🙏 💪 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💯 🔥 ✨ ⭐ 🌟 💥 🎉 🎊 🎁 🏆 🥇 ⚽ 🏀 🎮 🎧 🎵 🍕 🍔 🍟 🍿 🍩 🍪 🎂 🍺 ☕ 🚀 💡 💰 ✅ ❌ ⚠️ ❓ ❗ 👋'.split(' ');
const QUICK = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

/* ================================================================= boot */
async function boot() {
  applySettings();
  document.addEventListener('pointerdown', unlockAudio, { capture: true, once: false });
  sb = createClient(CFG.u, CFG.k, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data: { session } } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((evt, s) => {
    if (evt === 'PASSWORD_RECOVERY') { st.session = s; return renderRecovery(); }
    if (evt === 'SIGNED_OUT') { teardown(); st.session = null; st.me = null; renderAuth('login'); }
    if (evt === 'SIGNED_IN' && !st.me && s) { st.session = s; startApp(); }
  });
  if (session) { st.session = session; startApp(); } else renderAuth(LS.get('seenLogin', false) ? 'login' : 'register');
}
function renderFatal(msg) { $('root').innerHTML = `<div class="center"><div class="auth glass"><h1>Lumo</h1><p>${esc(msg)}</p></div></div>`; }

/* ---------------------------------------------------------------- setup */
/* ----------------------------------------------------------------- auth */
// Sign-up with username, e-mail and password; the e-mail gets a confirmation link.
// Log-in works with the username or the e-mail address.
function renderAuth(mode, note) {
  const reg = mode === 'register', forgot = mode === 'forgot';
  const title = reg ? 'Konto erstellen' : forgot ? 'Passwort vergessen' : 'Willkommen zurück!';
  const sub = reg ? 'Server, Freunde, Sprach- und Videochat – alles gratis.' : forgot ? 'Wir schicken dir einen Link zum Zurücksetzen.' : 'Schön, dich wiederzusehen.';
  $('root').innerHTML = `<div class="center scroll"><form class="auth glass" id="authForm" data-mode="${mode}" novalidate>
    <div class="brand"><img src="/icon-192.png" alt=""><div><h1>${title}</h1><p class="sub">${sub}</p></div></div>
    ${note ? `<p class="note">${note}</p>` : ''}
    ${reg ? `<label class="field"><span>E-Mail</span><input name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>Anzeigename</span><input name="display" autocomplete="nickname" maxlength="40" placeholder="So sehen dich andere"></label>
      <label class="field"><span>Benutzername</span><input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="32" placeholder="klein, ohne Leerzeichen" required></label>` : ''}
    ${mode === 'login' ? `<label class="field"><span>Benutzername oder E-Mail</span><input name="ident" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" required></label>` : ''}
    ${forgot ? `<label class="field"><span>E-Mail</span><input name="email" type="email" autocomplete="email" autocapitalize="off" required></label>` : ''}
    ${forgot ? '' : `<label class="field"><span>Passwort</span><input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="6" required></label>`}
    ${reg ? `<label class="field"><span>Passwort wiederholen</span><input name="password2" type="password" autocomplete="new-password" minlength="6" required></label>
    <label class="check-row"><input type="checkbox" name="terms" required><span>Ich bin mindestens 13 Jahre alt und verhalte mich respektvoll.</span></label>` : ''}
    <button class="btn primary" type="submit">${reg ? 'Registrieren' : forgot ? 'Link senden' : 'Anmelden'}</button>
    <div class="auth-links">
      ${mode !== 'login' ? '<a data-action="auth-mode" data-mode="login">Schon ein Konto? Anmelden</a>' : '<a data-action="auth-mode" data-mode="register">Neu hier? Konto erstellen</a>'}
      ${mode === 'login' ? '<a data-action="auth-mode" data-mode="forgot">Passwort vergessen?</a>' : ''}
    </div>
  </form></div>`;
  const f = $('authForm');
  f.addEventListener('submit', (e) => { e.preventDefault(); submitAuth(f); });
  f.username?.addEventListener('input', () => { f.username.value = f.username.value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, ''); });
}
function renderCheckMail(email) {
  $('root').innerHTML = `<div class="center"><div class="auth glass" style="text-align:center;align-items:center">
    <span class="mail-ico">${ms('mark_email_unread', 'huge')}</span>
    <h1>Bestätige deine E-Mail</h1>
    <p class="sub">Wir haben einen Link an <b>${esc(email)}</b> geschickt. Tippe darauf, dann bist du direkt angemeldet.</p>
    <p class="hint">Nichts angekommen? Schau auch im Spam-Ordner nach.</p>
    <button class="btn sec" data-action="resend-mail" data-email="${esc(email)}">${ms('send')} E-Mail erneut senden</button>
    <a data-action="auth-mode" data-mode="login">Zur Anmeldung</a></div></div>`;
}
async function submitAuth(f) {
  const mode = f.dataset.mode, btn = f.querySelector('button[type=submit]');
  const label = btn.textContent;
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  try {
    if (mode === 'register') {
      const email = f.email.value.trim().toLowerCase(), username = f.username.value.trim(), password = f.password.value;
      if (!emailOk(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
      if (!/^[a-z0-9_.]{2,32}$/.test(username)) throw new Error('Benutzername: 2–32 Zeichen, nur a–z, 0–9, Punkt und Unterstrich.');
      if (password.length < 6) throw new Error('Das Passwort muss mindestens 6 Zeichen haben.');
      if (password !== f.password2.value) throw new Error('Die Passwörter stimmen nicht überein.');
      if (!f.terms.checked) throw new Error('Bitte bestätige die Hinweise.');
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      const { data: free, error: uErr } = await sb.rpc('username_available', { u: username });
      if (!uErr && free === false) throw new Error('Dieser Benutzername ist schon vergeben.');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, display_name: f.display.value.trim() || username }, emailRedirectTo: appUrl() } });
      if (error) throw error;
      LS.set('seenLogin', true);
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('Für diese E-Mail gibt es schon ein Konto.');
      if (!data.session) return renderCheckMail(email);
    } else if (mode === 'login') {
      const ident = f.ident.value.trim().replace(/^@/, ''), password = f.password.value;
      if (!ident || !password) throw new Error('Bitte Benutzername/E-Mail und Passwort eingeben.');
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      let email = ident.toLowerCase();
      if (!ident.includes('@')) {
        const { data, error } = await sb.rpc('login_email', { u: email, pw: password });
        if (error) throw error;
        if (!data) throw new Error('Benutzername oder Passwort ist falsch.');
        email = data;
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed/i.test(error.message)) return renderCheckMail(email.endsWith('@lumoapp.vercel.app') ? 'deine Adresse' : email);
        throw /Invalid login/i.test(error.message) ? new Error('Benutzername/E-Mail oder Passwort ist falsch.') : error;
      }
      LS.set('seenLogin', true);
    } else {
      const email = f.email.value.trim().toLowerCase();
      if (!emailOk(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
      if (error) throw error;
      return renderAuth('login', `${ms('mark_email_read')} Falls es ein Konto mit <b>${esc(email)}</b> gibt, ist jetzt ein Link zum Zurücksetzen unterwegs.`);
    }
  } catch (e) { fail(e); btn.disabled = false; btn.textContent = label; }
}
function renderRecovery() {
  $('root').innerHTML = `<div class="center"><form class="auth glass" id="recForm"><div class="brand"><img src="/icon-192.png" alt=""><div><h1>Neues Passwort</h1><p class="sub">Wähle ein neues Passwort für dein Konto.</p></div></div>
    <label class="field"><span>Neues Passwort</span><input name="pw" type="password" minlength="6" autocomplete="new-password" required></label>
    <button class="btn primary">Speichern</button></form></div>`;
  $('recForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: e.target.pw.value });
    if (error) return fail(error);
    toast(`${ms('check_circle')} Passwort geändert`); startApp();
  });
}

/* ============================================================ data load */
let rt = null, presence = null;
async function startApp() {
  if (st.starting) return; st.starting = true;
  $('root').innerHTML = '<div class="center"><div class="loader"><img src="/icon-192.png" alt=""><span class="spin big"></span></div></div>';
  try {
    const uid = st.session.user.id;
    let me = null;
    for (let i = 0; i < 4 && !me; i++) { ({ data: me } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle()); if (!me) await new Promise((r) => setTimeout(r, 600)); }
    if (!me) throw new Error('Dein Profil wurde nicht gefunden. Wurde das Datenbank-Schema im SQL-Editor ausgeführt?');
    st.me = me; st.profiles.set(me.id, me);
    await Promise.all([loadServers(), loadConvs(), loadFriends(), loadReadStates()]);
    subscribe();
    const inv = /[#&]invite=([a-z0-9]+)/i.exec(location.hash)?.[1];
    renderShell();
    const last = LS.get('lastView', null);
    if (last && (last.space === 'home' || st.servers.some((s) => s.id === last.space))) await openTarget(last.space, last.target, { restore: true });
    else await openTarget('home', { kind: 'friends' });
    if (inv) { history.replaceState(null, '', location.pathname); showInvite(inv); }
  } catch (e) {
    fail(e);
    $('root').innerHTML = `<div class="center"><div class="auth glass"><h1>Verbindung fehlgeschlagen</h1><p class="sub">${esc(germanError(e))}</p>
      <button class="btn primary" data-action="reload">Erneut versuchen</button><button class="btn sec" data-action="logout">Abmelden</button></div></div>`;
  } finally { st.starting = false; }
}
async function loadServers() {
  const { data: mem, error } = await sb.from('server_members').select('server_id, role, servers(*)').eq('user_id', st.me.id);
  if (error) throw error;
  st.servers = mem.map((m) => m.servers).filter(Boolean).sort((a, b) => (LS.get('order', []).indexOf(a.id) + 1 || 999) - (LS.get('order', []).indexOf(b.id) + 1 || 999) || a.created_at.localeCompare(b.created_at));
  const ids = st.servers.map((s) => s.id);
  if (!ids.length) return;
  const [{ data: chans }, { data: members }] = await Promise.all([
    sb.from('channels').select('*').in('server_id', ids).order('position'),
    sb.from('server_members').select('server_id, user_id, role, joined_at').in('server_id', ids),
  ]);
  st.channels = new Map(ids.map((id) => [id, (chans || []).filter((c) => c.server_id === id)]));
  st.members = new Map(ids.map((id) => [id, (members || []).filter((m) => m.server_id === id)]));
  await ensureProfiles((members || []).map((m) => m.user_id));
  // latest activity per channel for unread markers
  const chanIds = (chans || []).filter((c) => c.kind === 'text').map((c) => c.id);
  if (chanIds.length) {
    const { data: recent } = await sb.from('messages').select('channel_id, created_at, author_id, content').in('channel_id', chanIds).order('created_at', { ascending: false }).limit(300);
    for (const m of recent || []) if (!st.lastAt.has(m.channel_id)) { st.lastAt.set(m.channel_id, m.created_at); }
  }
}
async function loadConvs() {
  const { data: cm, error } = await sb.from('conversation_members').select('conversation_id, user_id');
  if (error) throw error;
  const by = new Map();
  for (const r of cm) { if (!by.has(r.conversation_id)) by.set(r.conversation_id, []); by.get(r.conversation_id).push(r.user_id); }
  st.convs = [...by.entries()].filter(([, us]) => us.includes(st.me.id)).map(([id, members]) => ({ id, members }));
  await ensureProfiles(cm.map((r) => r.user_id));
  if (st.convs.length) {
    const { data: recent } = await sb.from('messages').select('conversation_id, created_at').in('conversation_id', st.convs.map((c) => c.id)).order('created_at', { ascending: false }).limit(300);
    for (const m of recent || []) if (!st.lastAt.has(m.conversation_id)) st.lastAt.set(m.conversation_id, m.created_at);
  }
}
async function loadFriends() {
  const { data, error } = await sb.from('friendships').select('*');
  if (error) throw error;
  st.friends = data; await ensureProfiles(data.flatMap((f) => [f.requester, f.addressee]));
}
async function loadReadStates() {
  const { data } = await sb.from('read_states').select('*');
  for (const r of data || []) st.readAt.set(r.target_id, r.last_read_at);
}
const isUnread = (id) => { const l = st.lastAt.get(id), r = st.readAt.get(id); return !!l && (!r || l > r); };
let readTimers = {};
function markRead(id) {
  const now = new Date().toISOString();
  const latest = st.lastAt.get(id);
  st.readAt.set(id, latest && latest > now ? latest : now); st.mentions.delete(id);
  clearTimeout(readTimers[id]);
  readTimers[id] = setTimeout(() => sb.from('read_states').upsert({ user_id: st.me.id, target_id: id, last_read_at: st.readAt.get(id) }).then(() => {}), 800);
  updateBadge();
}
function updateBadge() {
  const n = [...st.mentions.values()].reduce((a, b) => a + b, 0) + st.convs.filter((c) => isUnread(c.id)).length;
  document.title = n ? `(${n}) Lumo` : 'Lumo';
  try { navigator.setAppBadge?.(n || undefined); if (!n) navigator.clearAppBadge?.(); } catch {}
}

/* ============================================================= realtime */
function subscribe() {
  rt = sb.channel('lumo-db')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onMessageChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, onReactionChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, onVoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, onChannelChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'servers' }, onServerChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'server_members' }, onMemberChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onFriendChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => { st.profiles.set(p.new.id, p.new); if (p.new.id === st.me.id) st.me = p.new; softRender(); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_members' }, async (p) => { if (!st.convs.some((c) => c.id === p.new.conversation_id)) { await loadConvs(); renderSidebar(); } })
    .subscribe();
  presence = sb.channel('lumo-presence', { config: { presence: { key: st.me.id } } });
  presence.on('presence', { event: 'sync' }, () => {
    const s = presence.presenceState(); st.online = new Map();
    for (const [id, metas] of Object.entries(s)) { const m = metas[metas.length - 1]; if (m.status !== 'invisible') st.online.set(id, m); }
    softRender();
  }).subscribe((status) => { if (status === 'SUBSCRIBED') trackPresence(); });
  document.addEventListener('visibilitychange', onVisible);
}
function trackPresence() { if (!presence) return; if (st.me.status === 'invisible') presence.untrack(); else presence.track({ status: st.me.status, at: Date.now() }); }
function onVisible() { if (document.visibilityState === 'visible' && st.me) { const t = curTarget(); if (t.kind !== 'friends') markRead(t.id); softRender(); } }
function teardown() {
  leaveVoice(true);
  try { rt && sb.removeChannel(rt); presence && sb.removeChannel(presence); typingCh && sb.removeChannel(typingCh); } catch {}
  for (const ch of voiceWatch.values()) try { sb.removeChannel(ch); } catch {}
  voiceWatch.clear(); rt = presence = typingCh = null;
  document.removeEventListener('visibilitychange', onVisible);
  Object.assign(st, { me: null, servers: [], convs: [], friends: [], messages: new Map(), profiles: new Map(), members: new Map(), channels: new Map() });
}

async function onMessageChange(p) {
  if (p.eventType === 'DELETE') {
    for (const [k, list] of st.messages) { const i = list.findIndex((m) => m.id === p.old.id); if (i >= 0) { list.splice(i, 1); if (k === targetKey(curTarget())) renderMessages(); } }
    return;
  }
  const m = p.new, key = m.channel_id || m.conversation_id;
  await ensureProfiles([m.author_id]);
  const list = st.messages.get(key);
  if (p.eventType === 'INSERT') {
    if (m.conversation_id && !st.convs.some((c) => c.id === m.conversation_id)) await loadConvs();
    st.lastAt.set(key, m.created_at);
    if (list && !list.some((x) => x.id === m.id)) {
      const tmp = list.findIndex((x) => x._tmp && x.author_id === m.author_id && x.content === m.content);
      if (tmp >= 0) list.splice(tmp, 1, m); else list.push(m);
    }
    const viewing = key === targetKey(curTarget()) && document.visibilityState === 'visible' && (!isMobile() || st.pane === 'chat');
    if (m.author_id !== st.me.id) {
      if (viewing) markRead(key);
      else {
        const mention = mentionsMe(m.content) || !!m.conversation_id;
        if (mention) { st.mentions.set(key, (st.mentions.get(key) || 0) + 1); beep('msg'); notify(m); }
      }
      clearTyping(key, m.author_id);
    } else markRead(key);
    if (key === targetKey(curTarget())) renderMessages({ stick: m.author_id === st.me.id });
    renderRail(); renderSidebar(); updateBadge();
  } else if (p.eventType === 'UPDATE' && list) {
    const i = list.findIndex((x) => x.id === m.id); if (i >= 0) { list[i] = m; if (key === targetKey(curTarget())) renderMessages(); }
  }
}
function notify(m) {
  if (document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(nameOf(m.author_id), { body: m.content.slice(0, 140) || 'Anhang', icon: '/icon-192.png', tag: m.id }); } catch {}
}
function onReactionChange(p) {
  const r = p.eventType === 'DELETE' ? p.old : p.new; if (!r.message_id) return;
  const list = st.reactions.get(r.message_id) || [];
  if (p.eventType === 'INSERT') { if (!list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) list.push(r); }
  else if (p.eventType === 'DELETE') { const i = list.findIndex((x) => x.user_id === r.user_id && x.emoji === r.emoji); if (i >= 0) list.splice(i, 1); }
  st.reactions.set(r.message_id, list); refreshMsg(r.message_id);
}
function onVoteChange(p) {
  const v = p.eventType === 'DELETE' ? p.old : p.new; if (!v.message_id) return;
  const list = (st.votes.get(v.message_id) || []).filter((x) => x.user_id !== v.user_id);
  if (p.eventType !== 'DELETE') list.push(v);
  st.votes.set(v.message_id, list); refreshMsg(v.message_id);
}
function onChannelChange(p) {
  const c = p.eventType === 'DELETE' ? p.old : p.new;
  for (const [sid, list] of st.channels) {
    const i = list.findIndex((x) => x.id === c.id);
    if (p.eventType === 'DELETE') { if (i >= 0) list.splice(i, 1); }
    else if (sid === c.server_id) { if (i >= 0) list[i] = c; else list.push(c); list.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)); }
  }
  if (p.eventType === 'DELETE' && curTarget().id === c.id) openTarget(st.view.space, null);
  renderSidebar();
}
async function onServerChange(p) {
  if (p.eventType === 'DELETE') { removeServerLocal(p.old.id); return; }
  const i = st.servers.findIndex((s) => s.id === p.new.id);
  if (i >= 0) { st.servers[i] = p.new; renderRail(); renderSidebar(); }
}
function removeServerLocal(id) {
  if (!st.servers.some((s) => s.id === id)) return;
  st.servers = st.servers.filter((s) => s.id !== id); st.channels.delete(id); st.members.delete(id);
  if (st.view.space === id) openTarget('home', { kind: 'friends' }); else renderRail();
}
async function onMemberChange(p) {
  const m = p.eventType === 'DELETE' ? p.old : p.new;
  if (p.eventType === 'DELETE') {
    if (m.user_id === st.me.id || (!m.user_id && !st.servers.some((s) => s.id === m.server_id))) { if (m.server_id) { removeServerLocal(m.server_id); toast(`${ms('logout')} Du bist nicht mehr Mitglied dieses Servers.`); } return; }
    for (const [sid, list] of st.members) { const i = list.findIndex((x) => x.user_id === m.user_id && (x.server_id === m.server_id || !m.server_id)); if (i >= 0 && (!m.server_id || sid === m.server_id)) list.splice(i, 1); }
  } else {
    if (m.user_id === st.me.id && !st.servers.some((s) => s.id === m.server_id)) { await loadServers(); renderRail(); return; }
    const list = st.members.get(m.server_id); if (!list) return;
    await ensureProfiles([m.user_id]);
    const i = list.findIndex((x) => x.user_id === m.user_id); if (i >= 0) list[i] = m; else list.push(m);
  }
  renderMembers(); renderSidebar();
}
async function onFriendChange(p) {
  const f = p.eventType === 'DELETE' ? p.old : p.new;
  st.friends = st.friends.filter((x) => !(x.requester === f.requester && x.addressee === f.addressee));
  if (p.eventType !== 'DELETE') { st.friends.push(f); await ensureProfiles([f.requester, f.addressee]); if (p.eventType === 'INSERT' && f.addressee === st.me.id) { toast(`${ms('person_add')} Freundschaftsanfrage von <b>${esc(nameOf(f.requester))}</b>`); beep('msg'); } }
  renderSidebar(); if (curTarget().kind === 'friends') renderMain();
}

/* --------------------------------------------------------------- typing */
let typingCh = null, typingSent = 0;
function watchTyping(key) {
  if (typingCh) { sb.removeChannel(typingCh); typingCh = null; }
  if (!key || key === 'friends') return;
  typingCh = sb.channel(`typing:${key}`).on('broadcast', { event: 'typing' }, ({ payload }) => {
    if (payload.user === st.me.id) return;
    const map = st.typing.get(key) || new Map(); map.set(payload.user, Date.now() + 4500); st.typing.set(key, map); renderTyping();
  }).subscribe();
}
function sendTyping() { const now = Date.now(); if (typingCh && now - typingSent > 2500) { typingSent = now; typingCh.send({ type: 'broadcast', event: 'typing', payload: { user: st.me.id } }); } }
function clearTyping(key, user) { st.typing.get(key)?.delete(user); renderTyping(); }
setInterval(renderTyping, 1500);
function renderTyping() {
  const el = $('typing'); if (!el) return;
  const map = st.typing.get(targetKey(curTarget())); const now = Date.now();
  const who = map ? [...map.entries()].filter(([, t]) => t > now).map(([u]) => nameOf(u)) : [];
  el.innerHTML = who.length ? `<span class="dots"><i></i><i></i><i></i></span><b>${esc(who.slice(0, 3).join(', '))}</b> ${who.length > 1 ? 'schreiben' : 'schreibt'} …` : '';
}

/* ============================================================ navigation */
async function openTarget(space, target, { restore = false } = {}) {
  if (space !== 'home' && !target) {
    const chans = (st.channels.get(space) || []).filter((c) => c.kind === 'text');
    const remembered = LS.get('lastChan', {})[space];
    const c = chans.find((x) => x.id === remembered) || chans[0];
    target = c ? { kind: 'channel', id: c.id } : { kind: 'none' };
  }
  if (target.kind === 'conv' && !st.convs.some((c) => c.id === target.id)) target = { kind: 'friends' };
  if ((target.kind === 'channel' || target.kind === 'voice') && !(st.channels.get(space) || []).some((c) => c.id === target.id)) return openTarget(space, null);
  st.view = { space, target }; st.replyTo = null; st.editing = null; st.search = '';
  LS.set('lastView', st.view);
  if (target.kind === 'channel') { const lc = LS.get('lastChan', {}); lc[space] = target.id; LS.set('lastChan', lc); }
  if (target.kind === 'voice') LS.set('lastView', { space, target: LS.get('lastChan', {})[space] ? { kind: 'channel', id: LS.get('lastChan', {})[space] } : null });
  if (!restore && isMobile() && target.kind !== 'none') st.pane = 'chat';
  if (restore && isMobile()) st.pane = target.kind === 'friends' ? 'nav' : 'nav';
  watchTyping(target.kind === 'voice' ? null : target.id);
  if (space !== 'home') watchVoiceChannels(space);
  renderShell();
  if (target.kind === 'channel' || target.kind === 'conv') { await loadMessages(target.id, target.kind); markRead(target.id); renderSidebar(); renderRail(); }
}
async function loadMessages(id, kind, older = false) {
  const col = kind === 'channel' ? 'channel_id' : 'conversation_id';
  const list = st.messages.get(id);
  if (list && !older) { renderMessages({ stick: true }); return; }
  let q = sb.from('messages').select('*').eq(col, id).order('created_at', { ascending: false }).limit(50);
  if (older && list?.length) q = q.lt('created_at', list[0].created_at);
  const { data, error } = await q;
  if (error) return fail(error);
  const msgs = data.reverse();
  await ensureProfiles(msgs.map((m) => m.author_id));
  await loadExtras(msgs.map((m) => m.id));
  st.messages.set(id, older ? [...msgs, ...(list || [])] : msgs);
  st.hasMore.set(id, data.length === 50);
  if (targetKey(curTarget()) === id) {
    if (older) { const box = $('msgs'), h = box.scrollHeight; renderMessages(); box.scrollTop = box.scrollHeight - h; }
    else renderMessages({ stick: true });
  }
}
async function loadExtras(ids) {
  if (!ids.length) return;
  const [{ data: rs }, { data: vs }] = await Promise.all([sb.from('reactions').select('*').in('message_id', ids), sb.from('poll_votes').select('*').in('message_id', ids)]);
  for (const id of ids) { st.reactions.set(id, (rs || []).filter((r) => r.message_id === id)); st.votes.set(id, (vs || []).filter((v) => v.message_id === id)); }
}

/* ============================================================ rendering */
function applySettings() {
  const s = st.settings, root = document.documentElement;
  root.dataset.theme = s.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s.theme;
  root.style.setProperty('--fs', s.fontSize + 'px');
  document.body.classList.toggle('compact', !!s.compact);
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applySettings);

function renderShell() {
  $('root').innerHTML = `<div class="app" data-pane="${st.pane}">
    <nav id="rail" class="rail"></nav>
    <aside id="side" class="side glass"></aside>
    <main id="main" class="main glass"></main>
    <aside id="members" class="members glass"></aside>
  </div>`;
  renderRail(); renderSidebar(); renderMain(); renderMembers();
}
let softT;
function softRender() { clearTimeout(softT); softT = setTimeout(() => { if (!st.me || !$('rail')) return; renderRail(); renderSidebar(); renderMembers(); renderHeader(); }, 60); }
function setPane(p) { st.pane = p; document.querySelector('.app')?.setAttribute('data-pane', p); if (p === 'chat') { const t = curTarget(); if (t.id) markRead(t.id); } }

function renderRail() {
  const el = $('rail'); if (!el) return;
  const dmUnread = st.convs.filter((c) => isUnread(c.id)).length + st.friends.filter((f) => f.status === 'pending' && f.addressee === st.me.id).length;
  el.innerHTML = `
    <button class="rail-btn home ${st.view.space === 'home' ? 'on' : ''}" data-action="go-home" title="Direktnachrichten">${ms('forum')}${dmUnread ? `<b class="badge">${dmUnread}</b>` : ''}<i class="pill"></i></button>
    <span class="rail-sep"></span>
    ${st.servers.map((s) => {
      const chans = (st.channels.get(s.id) || []).filter((c) => c.kind === 'text');
      const unread = chans.some((c) => isUnread(c.id)), mentions = chans.reduce((a, c) => a + (st.mentions.get(c.id) || 0), 0);
      return `<button class="rail-btn ${st.view.space === s.id ? 'on' : ''} ${unread ? 'unread' : ''}" data-action="go-server" data-id="${s.id}" title="${esc(s.name)}" style="--c:${esc(s.color)}">
        ${s.icon_url ? `<img src="${esc(s.icon_url)}" alt="">` : `<span>${esc(initials(s.name))}</span>`}${mentions ? `<b class="badge">${mentions}</b>` : ''}<i class="pill"></i></button>`;
    }).join('')}
    <button class="rail-btn add" data-action="add-server" title="Server hinzufügen">${ms('add')}</button>
    <button class="rail-btn add" data-action="explore" title="Einladung einlösen">${ms('explore')}</button>`;
}

function renderSidebar() {
  const el = $('side'); if (!el) return;
  const top = st.view.space === 'home' ? homeSide() : serverSide(curServer());
  el.innerHTML = `${top}<div class="userbar">${voiceBar()}
    <button class="me" data-action="my-status">${avatar(st.me.id, 36, true)}<span><b>${esc(st.me.display_name || st.me.username)}</b><small>${esc(st.me.custom_status || STATUS[statusOf(st.me.id)][0])}</small></span></button>
    <button class="icon-btn" data-action="settings" title="Einstellungen">${ms('settings')}</button></div>`;
}
function homeSide() {
  const t = curTarget();
  const pending = st.friends.filter((f) => f.status === 'pending' && f.addressee === st.me.id).length;
  const convs = [...st.convs].sort((a, b) => (st.lastAt.get(b.id) || '').localeCompare(st.lastAt.get(a.id) || ''));
  return `<header class="side-head"><button class="search-btn" data-action="quick-switch">${ms('search')} Gespräch suchen oder starten</button></header>
  <div class="side-scroll">
    <button class="nav-item ${t.kind === 'friends' ? 'on' : ''}" data-action="friends">${ms('group')}<span>Freunde</span>${pending ? `<b class="badge">${pending}</b>` : ''}</button>
    <div class="side-label"><span>Direktnachrichten</span><button class="icon-btn sm" data-action="new-dm" title="Neue Nachricht">${ms('add')}</button></div>
    ${convs.map((c) => {
      const other = c.members.find((u) => u !== st.me.id) || st.me.id;
      return `<button class="nav-item dm ${t.id === c.id ? 'on' : ''} ${isUnread(c.id) ? 'unread' : ''}" data-action="open-conv" data-id="${c.id}">${avatar(other, 32, true)}
        <span class="grow"><b>${esc(nameOf(other))}</b><small>${esc(prof(other).custom_status || '')}</small></span>${st.mentions.get(c.id) ? `<b class="badge">${st.mentions.get(c.id)}</b>` : ''}</button>`;
    }).join('') || '<p class="empty">Noch keine Unterhaltungen. Füge Freunde hinzu oder starte eine Nachricht.</p>'}
  </div>`;
}
function serverSide(s) {
  if (!s) return '';
  const chans = st.channels.get(s.id) || [], admin = isAdmin(s.id), t = curTarget();
  const text = chans.filter((c) => c.kind === 'text'), voice = chans.filter((c) => c.kind === 'voice');
  const chanBtn = (c) => {
    const unread = isUnread(c.id), mentions = st.mentions.get(c.id);
    return `<div class="chan-row"><button class="nav-item chan ${t.id === c.id ? 'on' : ''} ${unread ? 'unread' : ''}" data-action="open-chan" data-id="${c.id}">${ms('tag')}<span class="grow">${esc(c.name)}</span>${mentions ? `<b class="badge">${mentions}</b>` : ''}</button>
      ${admin ? `<button class="icon-btn sm ghost" data-action="edit-chan" data-id="${c.id}" title="Kanal bearbeiten">${ms('settings')}</button>` : ''}</div>`;
  };
  const voiceBtn = (c) => {
    const people = [...(st.voicePresence.get(c.id) || new Map()).keys()];
    const inIt = st.voice?.channelId === c.id;
    return `<div class="chan-row"><button class="nav-item chan voice ${inIt || t.id === c.id ? 'on' : ''}" data-action="join-voice" data-id="${c.id}">${ms('volume_up')}<span class="grow">${esc(c.name)}</span>${people.length ? `<small>${people.length}</small>` : ''}</button>
      ${admin ? `<button class="icon-btn sm ghost" data-action="edit-chan" data-id="${c.id}" title="Kanal bearbeiten">${ms('settings')}</button>` : ''}</div>
      ${people.map((u) => { const meta = st.voicePresence.get(c.id).get(u) || {}; return `<button class="voice-user ${st.voice?.speaking?.has(u) ? 'speaking' : ''}" data-action="open-voice" data-id="${c.id}">${avatar(u, 22)}<span>${esc(nameOf(u))}</span>${meta.video === 'screen' ? '<b class="live">LIVE</b>' : meta.video ? ms('videocam', 'muted') : ''}${meta.muted ? ms('mic_off', 'muted') : ''}</button>`; }).join('')}`;
  };
  return `<header class="side-head server" data-action="server-menu" role="button">
      ${s.icon_url ? `<img class="srv-banner" src="${esc(s.icon_url)}" alt="">` : `<span class="srv-banner" style="--c:${esc(s.color)}"></span>`}
      <b>${esc(s.name)}</b>${ms('expand_more')}</header>
    <div class="side-scroll">
      <button class="invite-cta" data-action="invite">${ms('person_add')} Freunde einladen</button>
      <div class="side-label"><span>Textkanäle</span>${admin ? `<button class="icon-btn sm" data-action="new-chan" data-kind="text" title="Kanal erstellen">${ms('add')}</button>` : ''}</div>
      ${text.map(chanBtn).join('')}
      <div class="side-label"><span>Sprachkanäle</span>${admin ? `<button class="icon-btn sm" data-action="new-chan" data-kind="voice" title="Sprachkanal erstellen">${ms('add')}</button>` : ''}</div>
      ${voice.map(voiceBtn).join('')}
    </div>`;
}
function voiceBar() {
  if (!st.voice) return '';
  const c = [...st.channels.values()].flat().find((x) => x.id === st.voice.channelId);
  return `<div class="voicebar"><button class="vb-info" data-action="open-voice" data-id="${st.voice.channelId}"><b class="${st.voice.state === 'connected' ? 'ok' : ''}">${ms('graphic_eq')} ${st.voice.state === 'connected' ? 'Sprachverbindung' : 'Verbinde …'}</b><small>${esc(c?.name || '')}</small></button>
    <button class="icon-btn ${st.voice.video === 'camera' ? 'on' : ''}" data-action="voice-cam" title="Kamera">${ms(st.voice.video === 'camera' ? 'videocam' : 'videocam_off')}</button>
    <button class="icon-btn ${st.voice.muted ? 'danger' : ''}" data-action="voice-mute" title="Mikrofon">${ms(st.voice.muted ? 'mic_off' : 'mic')}</button>
    <button class="icon-btn ${st.voice.deaf ? 'danger' : ''}" data-action="voice-deaf" title="Ton">${ms(st.voice.deaf ? 'headset_off' : 'headphones')}</button>
    <button class="icon-btn danger" data-action="voice-leave" title="Trennen">${ms('call_end')}</button></div>`;
}

function headerHtml() {
  const t = curTarget();
  const back = `<button class="icon-btn mobile-only" data-action="back" title="Zurück">${ms('arrow_back')}</button>`;
  if (t.kind === 'friends') return `${back}${ms('group', 'hicon')}<b class="htitle">Freunde</b>
    <div class="tabs">${[['online', 'Online'], ['all', 'Alle'], ['pending', 'Ausstehend'], ['add', 'Hinzufügen']].map(([k, l]) => `<button class="${st.friendsTab === k ? 'on' : ''} ${k === 'add' ? 'accent' : ''}" data-action="friends-tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  if (t.kind === 'none') return `${back}<b class="htitle">${esc(curServer()?.name || '')}</b>`;
  if (t.kind === 'conv') {
    const c = st.convs.find((x) => x.id === t.id); const other = c?.members.find((u) => u !== st.me.id) || st.me.id;
    return `${back}<button class="hperson" data-action="profile" data-id="${other}">${avatar(other, 28, true)}<b class="htitle">${esc(nameOf(other))}</b></button><span class="grow"></span>
      <button class="icon-btn" data-action="pins" title="Angeheftet">${ms('push_pin')}</button><button class="icon-btn" data-action="search" title="Suchen">${ms('search')}</button>`;
  }
  const c = (st.channels.get(st.view.space) || []).find((x) => x.id === t.id);
  return `${back}${ms('tag', 'hicon')}<b class="htitle">${esc(c?.name || '')}</b>${c?.topic ? `<span class="topic">${esc(c.topic)}</span>` : '<span class="grow"></span>'}
    <button class="icon-btn" data-action="pins" title="Angeheftet">${ms('push_pin')}</button>
    <button class="icon-btn" data-action="search" title="Suchen">${ms('search')}</button>
    <button class="icon-btn ${st.showMembers ? 'on' : ''}" data-action="toggle-members" title="Mitglieder">${ms('group')}</button>`;
}
function renderHeader() { const h = $('mainHead'); if (h) h.innerHTML = headerHtml(); }
function renderMain() {
  const el = $('main'); if (!el) return;
  const t = curTarget();
  document.querySelector('.app')?.classList.toggle('with-members', st.view.space !== 'home' && st.showMembers && t.kind === 'channel');
  if (t.kind === 'friends') {
    el.innerHTML = `<header id="mainHead" class="main-head">${headerHtml()}</header><div class="main-scroll" id="friendsBody">${friendsBody()}</div>`;
    $('addFriend')?.addEventListener('submit', (e) => { e.preventDefault(); addFriend(e.target.u.value); e.target.reset(); });
    return;
  }
  if (t.kind === 'voice') { el.innerHTML = stageHtml(t.id); renderStage(); return; }
  if (t.kind === 'none') { el.innerHTML = `<header id="mainHead" class="main-head">${headerHtml()}</header><div class="empty-state">${ms('forum', 'huge')}<h3>Keine Textkanäle</h3><p>${isAdmin(st.view.space) ? 'Erstelle links einen Kanal.' : 'Hier gibt es noch keine Kanäle.'}</p></div>`; return; }
  el.innerHTML = `<header id="mainHead" class="main-head">${headerHtml()}</header>
    <div id="msgs" class="msgs"></div>
    <div class="composer-wrap">
      <div id="typing" class="typing"></div>
      <div id="compExtra"></div>
      <form id="composer" class="composer glass" autocomplete="off">
        <button type="button" class="icon-btn" data-action="attach-menu" title="Anhängen">${ms('add_circle')}</button>
        <textarea id="input" rows="1" placeholder="${esc(placeholder())}" maxlength="4000" enterkeyhint="send"></textarea>
        <button type="button" class="icon-btn" data-action="emoji" title="Emoji">${ms('mood')}</button>
        <button type="submit" class="send" title="Senden">${ms('send')}</button>
      </form>
      <div id="mentionBox" class="mention-box glass" hidden></div>
    </div>`;
  const inp = $('input'), draft = LS.get('drafts', {})[t.id];
  if (draft) inp.value = draft;
  autosize(inp);
  inp.addEventListener('input', () => { autosize(inp); sendTyping(); saveDraft(); mentionSuggest(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile()) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { st.replyTo = null; st.editing = null; renderCompExtra(); }
    if (e.key === 'ArrowUp' && !inp.value) { const mine = (st.messages.get(t.id) || []).filter((m) => m.author_id === st.me.id).pop(); if (mine) startEdit(mine.id); }
  });
  inp.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  const box = $('msgs');
  box.addEventListener('scroll', () => { if (box.scrollTop < 80 && st.hasMore.get(t.id) && !box._loading) { box._loading = true; loadMessages(t.id, t.kind, true).finally(() => (box._loading = false)); } }, { passive: true });
  box.addEventListener('dragover', (e) => e.preventDefault());
  box.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
  renderCompExtra(); renderMessages({ stick: true }); renderTyping();
  if (!isMobile()) setTimeout(() => inp.focus(), 50);
}
function placeholder() {
  const t = curTarget();
  if (t.kind === 'conv') { const c = st.convs.find((x) => x.id === t.id); return `Nachricht an @${nameOf(c?.members.find((u) => u !== st.me.id) || st.me.id)}`; }
  const c = (st.channels.get(st.view.space) || []).find((x) => x.id === t.id); return `Nachricht an #${c?.name || ''}`;
}
function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px'; }
let draftT; function saveDraft() { clearTimeout(draftT); draftT = setTimeout(() => { const d = LS.get('drafts', {}); const v = $('input')?.value || ''; const id = curTarget().id; if (v) d[id] = v; else delete d[id]; LS.set('drafts', d); }, 300); }

function renderMessages({ stick = false } = {}) {
  const box = $('msgs'); if (!box) return;
  const t = curTarget(), list = st.messages.get(t.id);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!list) { box.innerHTML = '<div class="msgs-loading"><span class="spin"></span></div>'; return; }
  let html = '';
  if (!st.hasMore.get(t.id)) html += welcomeHtml();
  let prev = null;
  const readAt = st.readAt.get(t.id);
  let newShown = false;
  const q = st.search.toLowerCase();
  for (const m of list) {
    if (q && !m.content.toLowerCase().includes(q)) continue;
    if (!prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()) html += `<div class="day"><span>${dayLabel(m.created_at)}</span></div>`;
    if (!newShown && readAt && m.created_at > readAt && m.author_id !== st.me.id && box.dataset.target !== t.id) { html += '<div class="new-line"><span>Neu</span></div>'; newShown = true; }
    const grouped = prev && !q && prev.author_id === m.author_id && !m.reply_to && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000 && new Date(prev.created_at).toDateString() === new Date(m.created_at).toDateString();
    html += msgHtml(m, grouped);
    prev = m;
  }
  if (q && !html.includes('class="msg')) html += `<p class="empty">Keine Nachrichten mit „${esc(st.search)}“.</p>`;
  box.innerHTML = html;
  box.dataset.target = t.id;
  if (stick || atBottom) requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
}
function welcomeHtml() {
  const t = curTarget();
  if (t.kind === 'conv') {
    const c = st.convs.find((x) => x.id === t.id), o = c?.members.find((u) => u !== st.me.id) || st.me.id;
    return `<div class="welcome">${avatar(o, 80)}<h2>${esc(nameOf(o))}</h2><p>Das ist der Anfang deiner Unterhaltung mit <b>@${esc(prof(o).username)}</b>.</p></div>`;
  }
  const c = (st.channels.get(st.view.space) || []).find((x) => x.id === t.id);
  return `<div class="welcome"><span class="welcome-icon">${ms('tag')}</span><h2>Willkommen in #${esc(c?.name || '')}!</h2><p>Das ist der Anfang dieses Kanals.${c?.topic ? ` ${esc(c.topic)}` : ''}</p></div>`;
}
function msgHtml(m, grouped) {
  const mine = m.author_id === st.me.id, p = prof(m.author_id);
  const reply = m.reply_to ? (st.messages.get(m.channel_id || m.conversation_id) || []).find((x) => x.id === m.reply_to) : null;
  const canDelete = mine || (m.channel_id && isAdmin(st.view.space));
  const pinable = m.conversation_id || isAdmin(st.view.space);
  const cls = ['msg', grouped ? 'grouped' : '', mentionsMe(m.content) && !mine ? 'mentioned' : '', m._tmp ? 'pending' : '', st.editing === m.id ? 'editing' : ''].join(' ');
  return `<article class="${cls}" id="m-${m.id}" data-id="${m.id}">
    ${grouped ? `<time class="side-time">${timeFmt.format(new Date(m.created_at))}</time>` : `<button class="msg-av" data-action="profile" data-id="${m.author_id}">${avatar(m.author_id, 40)}</button>`}
    <div class="msg-body">
      ${m.reply_to ? `<button class="reply-ref" data-action="jump" data-id="${m.reply_to}">${ms('reply', 'flip')}${reply ? `${avatar(reply.author_id, 16)}<b>${esc(nameOf(reply.author_id))}</b><span>${esc(reply.content.slice(0, 90) || 'Anhang')}</span>` : '<span class="dim">Ursprüngliche Nachricht nicht geladen</span>'}</button>` : ''}
      ${grouped ? '' : `<div class="msg-head"><button class="author" data-action="profile" data-id="${m.author_id}" style="color:${esc(p.accent || '')}">${esc(nameOf(m.author_id))}</button>${roleBadge(m.author_id)}<time>${when(m.created_at)}</time>${m.pinned ? ms('push_pin', 'pin') : ''}</div>`}
      ${m.content ? `<div class="msg-text ${onlyEmoji(m.content) ? 'jumbo' : ''}">${md(m.content)}${m.edited_at ? '<small class="edited">(bearbeitet)</small>' : ''}</div>` : ''}
      ${(m.attachments || []).map(attHtml).join('')}
      ${m.poll ? pollHtml(m) : ''}
      ${reactionsHtml(m)}
    </div>
    ${m._tmp ? '' : `<div class="msg-tools glass">
      ${QUICK.slice(0, 3).map((e) => `<button data-action="react" data-id="${m.id}" data-emoji="${e}">${e}</button>`).join('')}
      <button data-action="react-pick" data-id="${m.id}" title="Reaktion">${ms('add_reaction')}</button>
      <button data-action="reply" data-id="${m.id}" title="Antworten">${ms('reply')}</button>
      ${mine ? `<button data-action="edit" data-id="${m.id}" title="Bearbeiten">${ms('edit')}</button>` : ''}
      <button data-action="msg-menu" data-id="${m.id}" title="Mehr">${ms('more_horiz')}</button></div>`}
  </article>`;
  function roleBadge(uid) {
    if (!m.channel_id) return '';
    const r = (st.members.get(st.view.space) || []).find((x) => x.user_id === uid)?.role;
    return r === 'owner' ? `<span class="role owner" title="Server-Besitzer">${ms('crown')}</span>` : r === 'admin' ? '<span class="role">Admin</span>' : '';
  }
  void canDelete; void pinable;
}
function attHtml(a) {
  if (/^image\//.test(a.type)) return `<button class="att-img" data-action="lightbox" data-src="${esc(a.url)}"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></button>`;
  if (/^video\//.test(a.type)) return `<video class="att-video" src="${esc(a.url)}" controls playsinline preload="metadata"></video>`;
  if (/^audio\//.test(a.type)) return `<audio class="att-audio" src="${esc(a.url)}" controls preload="metadata"></audio>`;
  return `<a class="att-file glass" href="${esc(a.url)}" target="_blank" rel="noopener" download>${ms('description')}<span><b>${esc(a.name)}</b><small>${fmtSize(a.size || 0)}</small></span>${ms('download')}</a>`;
}
function pollHtml(m) {
  const votes = st.votes.get(m.id) || [], total = votes.length, mine = votes.find((v) => v.user_id === st.me.id)?.option;
  return `<div class="poll glass"><b class="poll-q">${ms('ballot')} ${esc(m.poll.question)}</b>
    ${m.poll.options.map((o, i) => { const n = votes.filter((v) => v.option === i).length, pct = total ? Math.round((n / total) * 100) : 0;
      return `<button class="poll-opt ${mine === i ? 'mine' : ''}" data-action="vote" data-id="${m.id}" data-opt="${i}"><i style="width:${pct}%"></i><span>${esc(o)}</span><small>${pct}% · ${n}</small></button>`; }).join('')}
    <small class="dim">${total} Stimme${total === 1 ? '' : 'n'} · tippen zum Abstimmen</small></div>`;
}
function reactionsHtml(m) {
  const rs = st.reactions.get(m.id) || []; if (!rs.length) return '';
  const groups = new Map(); for (const r of rs) { if (!groups.has(r.emoji)) groups.set(r.emoji, []); groups.get(r.emoji).push(r.user_id); }
  return `<div class="reactions">${[...groups.entries()].map(([e, us]) => `<button class="rx ${us.includes(st.me.id) ? 'mine' : ''}" data-action="react" data-id="${m.id}" data-emoji="${esc(e)}" title="${esc(us.map(nameOf).join(', '))}">${esc(e)}<b>${us.length}</b></button>`).join('')}
    <button class="rx add" data-action="react-pick" data-id="${m.id}">${ms('add_reaction')}</button></div>`;
}
function refreshMsg(id) {
  const el = document.getElementById('m-' + id); if (!el) return;
  const list = st.messages.get(targetKey(curTarget())) || [], i = list.findIndex((m) => m.id === id); if (i < 0) return;
  const m = list[i], prev = list[i - 1];
  const grouped = prev && prev.author_id === m.author_id && !m.reply_to && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000;
  const box = $('msgs'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  el.outerHTML = msgHtml(m, grouped);
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function renderCompExtra() {
  const el = $('compExtra'); if (!el) return;
  let h = '';
  if (st.replyTo) { const m = findMsg(st.replyTo); h += `<div class="comp-bar">${ms('reply')}<span>Antwort an <b>${esc(nameOf(m?.author_id))}</b></span><button class="icon-btn sm" data-action="cancel-reply">${ms('close')}</button></div>`; }
  if (st.editing) h += `<div class="comp-bar edit">${ms('edit')}<span>Nachricht bearbeiten · Esc zum Abbrechen</span><button class="icon-btn sm" data-action="cancel-edit">${ms('close')}</button></div>`;
  if (st.pendingFiles.length) h += `<div class="pending-files">${st.pendingFiles.map((f, i) => `<div class="pf glass">${f.preview ? `<img src="${f.preview}" alt="">` : ms('description')}<small>${esc(f.file.name)}</small><button data-action="rm-file" data-i="${i}">${ms('close')}</button></div>`).join('')}</div>`;
  el.innerHTML = h;
}
const findMsg = (id) => { for (const l of st.messages.values()) { const m = l.find((x) => x.id === id); if (m) return m; } return null; };

function renderMembers() {
  const el = $('members'); if (!el) return;
  if (st.view.space === 'home' || curTarget().kind !== 'channel') { el.innerHTML = ''; return; }
  const list = st.members.get(st.view.space) || [];
  const groups = { owner: [], admin: [], online: [], offline: [] };
  for (const m of list) { const on = statusOf(m.user_id) !== 'offline'; if (!on) groups.offline.push(m); else if (m.role === 'owner') groups.owner.push(m); else if (m.role === 'admin') groups.admin.push(m); else groups.online.push(m); }
  const sect = (label, arr) => arr.length ? `<div class="side-label"><span>${label} — ${arr.length}</span></div>${arr.sort((a, b) => nameOf(a.user_id).localeCompare(nameOf(b.user_id))).map((m) => `<button class="member ${statusOf(m.user_id) === 'offline' ? 'off' : ''}" data-action="profile" data-id="${m.user_id}">${avatar(m.user_id, 34, true)}<span class="grow"><b style="color:${esc(prof(m.user_id).accent)}">${esc(nameOf(m.user_id))}</b>${m.role === 'owner' ? ms('crown', 'crown') : ''}<small>${esc(prof(m.user_id).custom_status || '')}</small></span></button>`).join('')}` : '';
  el.innerHTML = `<header class="side-head"><b>Mitglieder</b><button class="icon-btn mobile-only" data-action="toggle-members">${ms('close')}</button></header><div class="side-scroll">${sect('Besitzer', groups.owner)}${sect('Admins', groups.admin)}${sect('Online', groups.online)}${sect('Offline', groups.offline)}</div>`;
}

/* --------------------------------------------------------------- friends */
function friendsBody() {
  const tab = st.friendsTab, me = st.me.id;
  if (tab === 'add') return `<div class="pad"><h3>Freund hinzufügen</h3><p class="dim">Gib den Benutzernamen ein. Dein eigener: <b class="copy" data-action="copy" data-text="${esc(st.me.username)}">@${esc(st.me.username)}</b></p>
    <form id="addFriend" class="inline-form glass"><span class="at">@</span><input name="u" placeholder="benutzername" autocapitalize="off" autocomplete="off"><button class="btn primary sm">Anfrage senden</button></form>
    <div id="userResults"></div></div>`;
  const other = (f) => (f.requester === me ? f.addressee : f.requester);
  let list = st.friends;
  if (tab === 'pending') list = list.filter((f) => f.status === 'pending');
  else list = list.filter((f) => f.status === 'accepted' && (tab === 'all' || statusOf(other(f)) !== 'offline'));
  if (!list.length) return `<div class="empty-state">${ms(tab === 'pending' ? 'hourglass_empty' : 'diversity_3', 'huge')}<h3>${tab === 'pending' ? 'Keine offenen Anfragen' : tab === 'online' ? 'Niemand online' : 'Noch keine Freunde'}</h3><p>Füge Freunde über ihren Benutzernamen hinzu.</p><button class="btn primary" data-action="friends-tab" data-tab="add">${ms('person_add')} Freund hinzufügen</button></div>`;
  return `<div class="side-label pad-x"><span>${{ online: 'Online', all: 'Alle Freunde', pending: 'Ausstehend' }[tab]} — ${list.length}</span></div>` + list.map((f) => {
    const u = other(f), incoming = f.status === 'pending' && f.addressee === me;
    return `<div class="friend">${avatar(u, 40, true)}<span class="grow"><b>${esc(nameOf(u))}</b><small>${f.status === 'pending' ? (incoming ? 'Eingehende Anfrage' : 'Ausgehende Anfrage') : esc(prof(u).custom_status || STATUS[statusOf(u)][0])}</small></span>
      ${incoming ? `<button class="icon-btn ok" data-action="accept-friend" data-id="${u}" title="Annehmen">${ms('check')}</button>` : ''}
      ${f.status === 'accepted' ? `<button class="icon-btn" data-action="dm" data-id="${u}" title="Nachricht">${ms('chat')}</button>` : ''}
      <button class="icon-btn danger" data-action="remove-friend" data-id="${u}" title="${f.status === 'pending' ? 'Ablehnen' : 'Entfernen'}">${ms('close')}</button></div>`;
  }).join('');
}
async function addFriend(username) {
  username = username.replace(/^@/, '').trim().toLowerCase(); if (!username) return;
  const { data: p } = await sb.from('profiles').select('*').eq('username', username).maybeSingle();
  if (!p) return toast(`${ms('person_off')} Benutzer @${esc(username)} nicht gefunden.`, 'err');
  if (p.id === st.me.id) return toast('Das bist du selbst 🙂');
  st.profiles.set(p.id, p);
  const existing = st.friends.find((f) => (f.requester === p.id && f.addressee === st.me.id) || (f.addressee === p.id && f.requester === st.me.id));
  if (existing?.status === 'accepted') return toast(`Ihr seid schon befreundet.`);
  if (existing && existing.requester === p.id) return acceptFriend(p.id);
  if (existing) return toast('Anfrage wurde schon gesendet.');
  const { error } = await sb.from('friendships').insert({ requester: st.me.id, addressee: p.id });
  if (error) return fail(error);
  toast(`${ms('send')} Anfrage an <b>${esc(p.display_name || p.username)}</b> gesendet`);
}
async function acceptFriend(uid) { const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('requester', uid).eq('addressee', st.me.id); if (error) fail(error); else toast(`${ms('celebration')} Ihr seid jetzt Freunde!`); }
async function removeFriend(uid) { const { error } = await sb.from('friendships').delete().or(`and(requester.eq.${uid},addressee.eq.${st.me.id}),and(requester.eq.${st.me.id},addressee.eq.${uid})`); if (error) fail(error); else { st.friends = st.friends.filter((f) => !(f.requester === uid || f.addressee === uid)); renderMain(); renderSidebar(); } }
async function openDm(uid) {
  const { data, error } = await sb.rpc('open_dm', { other: uid }); if (error) return fail(error);
  if (!st.convs.some((c) => c.id === data)) { await loadConvs(); }
  closeModal(); closeSheet(); openTarget('home', { kind: 'conv', id: data });
}

/* ============================================================== sending */
async function send() {
  const inp = $('input'); if (!inp) return;
  const text = inp.value.trim(), t = curTarget();
  if (st.editing) {
    const id = st.editing; st.editing = null;
    if (!text) return deleteMsg(id);
    const { error } = await sb.from('messages').update({ content: text, edited_at: new Date().toISOString() }).eq('id', id);
    if (error) return fail(error);
    inp.value = ''; autosize(inp); renderCompExtra(); saveDraft(); return;
  }
  if (!text && !st.pendingFiles.length) return;
  if (text === '/poll' || text.startsWith('/umfrage')) { inp.value = ''; return openPoll(); }
  const files = st.pendingFiles; st.pendingFiles = [];
  const replyTo = st.replyTo; st.replyTo = null;
  inp.value = ''; autosize(inp); renderCompExtra(); saveDraft();
  const row = { author_id: st.me.id, content: text, reply_to: replyTo, [t.kind === 'channel' ? 'channel_id' : 'conversation_id']: t.id };
  const temp = { ...row, id: 'tmp-' + Math.random(), created_at: new Date().toISOString(), attachments: [], _tmp: true };
  if (!files.length) { st.messages.get(t.id)?.push(temp); renderMessages({ stick: true }); }
  try {
    if (files.length) { toast(`${ms('upload')} Lade ${files.length} Datei${files.length > 1 ? 'en' : ''} hoch …`); row.attachments = await Promise.all(files.map((f) => upload(f.file))); }
    const { error } = await sb.from('messages').insert(row);
    if (error) throw error;
  } catch (e) {
    fail(e); const l = st.messages.get(t.id); const i = l?.indexOf(temp); if (i >= 0) { l.splice(i, 1); renderMessages(); }
    inp.value = text; autosize(inp);
  }
}
async function upload(file, folder = 'files') {
  if (file.size > 50 * 1048576) throw new Error(`„${file.name}“ ist größer als 50 MB.`);
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${st.me.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
  const { error } = await sb.storage.from('uploads').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw error;
  return { url: sb.storage.from('uploads').getPublicUrl(path).data.publicUrl, name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
}
function addFiles(files) {
  for (const f of files.slice(0, 10 - st.pendingFiles.length)) st.pendingFiles.push({ file: f, preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : null });
  renderCompExtra(); $('input')?.focus();
}
async function deleteMsg(id) { const { error } = await sb.from('messages').delete().eq('id', id); if (error) fail(error); else { for (const l of st.messages.values()) { const i = l.findIndex((m) => m.id === id); if (i >= 0) l.splice(i, 1); } renderMessages(); } }
function startEdit(id) { const m = findMsg(id); if (!m || m.author_id !== st.me.id) return; st.editing = id; st.replyTo = null; const inp = $('input'); inp.value = m.content; autosize(inp); inp.focus(); renderCompExtra(); renderMessages(); }
async function react(id, emoji) {
  const rs = st.reactions.get(id) || [], mine = rs.find((r) => r.user_id === st.me.id && r.emoji === emoji);
  if (mine) { st.reactions.set(id, rs.filter((r) => r !== mine)); refreshMsg(id); const { error } = await sb.from('reactions').delete().match({ message_id: id, user_id: st.me.id, emoji }); if (error) fail(error); }
  else { rs.push({ message_id: id, user_id: st.me.id, emoji }); st.reactions.set(id, rs); refreshMsg(id); const { error } = await sb.from('reactions').insert({ message_id: id, user_id: st.me.id, emoji }); if (error && !/duplicate/.test(error.message)) fail(error); }
}
async function vote(id, opt) {
  const vs = st.votes.get(id) || [], mine = vs.find((v) => v.user_id === st.me.id);
  const others = vs.filter((v) => v.user_id !== st.me.id);
  if (mine?.option === opt) { st.votes.set(id, others); refreshMsg(id); await sb.from('poll_votes').delete().match({ message_id: id, user_id: st.me.id }); }
  else { st.votes.set(id, [...others, { message_id: id, user_id: st.me.id, option: opt }]); refreshMsg(id); const { error } = await sb.from('poll_votes').upsert({ message_id: id, user_id: st.me.id, option: opt }); if (error) fail(error); }
}

/* ----------------------------------------------------------- @mentions */
function mentionSuggest() {
  const inp = $('input'), box = $('mentionBox'); if (!inp || !box) return;
  const m = /(^|\s)@([a-z0-9_.]*)$/i.exec(inp.value.slice(0, inp.selectionStart));
  if (!m) { box.hidden = true; return; }
  const q = m[2].toLowerCase();
  const pool = curTarget().kind === 'channel' ? (st.members.get(st.view.space) || []).map((x) => x.user_id) : (st.convs.find((c) => c.id === curTarget().id)?.members || []);
  const hits = pool.map(prof).filter((p) => p.username?.includes(q) || (p.display_name || '').toLowerCase().includes(q)).slice(0, 6);
  const extra = curTarget().kind === 'channel' && 'everyone'.startsWith(q) ? [{ id: '_everyone', username: 'everyone', display_name: 'Alle benachrichtigen' }] : [];
  const all = [...hits, ...extra];
  if (!all.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = all.map((p) => `<button data-action="pick-mention" data-u="${esc(p.username)}">${p.id === '_everyone' ? ms('campaign') : avatar(p.id, 24)}<b>${esc(p.display_name || p.username)}</b><small>@${esc(p.username)}</small></button>`).join('');
}
function pickMention(u) {
  const inp = $('input'), pos = inp.selectionStart, before = inp.value.slice(0, pos).replace(/@([a-z0-9_.]*)$/i, `@${u} `);
  inp.value = before + inp.value.slice(pos); inp.focus(); inp.selectionStart = inp.selectionEnd = before.length; $('mentionBox').hidden = true;
}

/* ================================================================ voice */
const voiceWatch = new Map();
function watchVoiceChannels(sid) {
  for (const [cid, ch] of voiceWatch) if (!(st.channels.get(sid) || []).some((c) => c.id === cid) && st.voice?.channelId !== cid) { sb.removeChannel(ch); voiceWatch.delete(cid); }
  for (const c of (st.channels.get(sid) || []).filter((x) => x.kind === 'voice')) {
    if (voiceWatch.has(c.id)) continue;
    const ch = sb.channel(`voice:${c.id}`, { config: { presence: { key: '' } } });
    ch.on('presence', { event: 'sync' }, () => { const s = ch.presenceState(); const map = new Map(); for (const metas of Object.values(s)) for (const m of metas) if (m.user) map.set(m.user, m); st.voicePresence.set(c.id, map); renderSidebar(); renderStage(); })
      .on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(c.id, payload))
      .subscribe();
    voiceWatch.set(c.id, ch);
  }
}
const ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const voiceMeta = () => ({ user: st.me.id, peer: st.voice.peerId, muted: st.voice.muted, deaf: st.voice.deaf, video: st.voice.video || null });
async function joinVoice(cid, { open = true } = {}) {
  if (st.voice?.channelId === cid) { if (open) openTarget(st.view.space, { kind: 'voice', id: cid }); return; }
  if (st.voice) await leaveVoice();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { return toast(`${ms('mic_off')} Kein Mikrofonzugriff – bitte im Browser erlauben.`, 'err'); }
  const ch = voiceWatch.get(cid); if (!ch) return;
  st.voice = { channelId: cid, serverId: st.view.space, stream, peerId: Math.random().toString(36).slice(2), peers: new Map(), remote: new Map(),
    muted: false, deaf: false, video: null, videoTrack: null, state: 'connecting', speaking: new Set(), analysers: new Map() };
  addAnalyser(st.me.id, stream);
  await ch.track(voiceMeta());
  st.voice.state = 'connected'; beep('join');
  for (const [u, meta] of st.voicePresence.get(cid) || new Map()) if (u !== st.me.id && meta.peer) peerFor(cid, meta.peer, u);
  st.voice.timer = setInterval(() => {
    const v = st.voice; if (!v) return;
    const present = [...(st.voicePresence.get(cid) || new Map()).values()];
    for (const [pid, p] of v.peers) if (!present.some((m) => m.peer === pid)) dropPeer(pid, p.uid);
    for (const m of present) if (m.user !== st.me.id && m.peer && !v.peers.has(m.peer)) peerFor(cid, m.peer, m.user);
    detectSpeaking();
  }, 300);
  if (open) openTarget(st.view.space, { kind: 'voice', id: cid }); else renderSidebar();
}
function addAnalyser(uid, stream) {
  try { unlockAudio(); if (!stream.getAudioTracks().length) return; const src = actx.createMediaStreamSource(stream), an = actx.createAnalyser(); an.fftSize = 512; src.connect(an); st.voice.analysers.set(uid, an); } catch {}
}
function detectSpeaking() {
  const v = st.voice; if (!v) return; const buf = new Uint8Array(256); const before = [...v.speaking].sort().join();
  v.speaking = new Set();
  for (const [u, an] of v.analysers) { an.getByteFrequencyData(buf); const lvl = buf.reduce((a, b) => a + b, 0) / buf.length; if (lvl > 16 && !(u === st.me.id && v.muted)) v.speaking.add(u); }
  if ([...v.speaking].sort().join() !== before) { renderSidebar(); document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('speaking', v.speaking.has(t.dataset.uid))); }
}
/** One RTCPeerConnection per remote peer, using the "perfect negotiation" pattern so either side may (re)negotiate. */
function peerFor(cid, pid, uid) {
  const v = st.voice; if (!v) return null;
  if (v.peers.has(pid)) return v.peers.get(pid);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const p = { pc, uid, polite: v.peerId > pid, makingOffer: false, ignoreOffer: false, videoSender: null };
  v.peers.set(pid, p);
  v.stream.getAudioTracks().forEach((t) => pc.addTrack(t, v.stream));
  if (v.videoTrack) p.videoSender = pc.addTrack(v.videoTrack, v.stream);
  const signal = (data) => voiceWatch.get(cid)?.send({ type: 'broadcast', event: 'signal', payload: { from: v.peerId, to: pid, user: st.me.id, data } });
  p.signal = signal;
  pc.onicecandidate = (e) => e.candidate && signal({ ice: e.candidate });
  pc.onnegotiationneeded = async () => {
    try { p.makingOffer = true; await pc.setLocalDescription(); signal({ sdp: pc.localDescription }); } catch (e) { console.warn(e); } finally { p.makingOffer = false; }
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    v.remote.set(uid, stream);
    if (e.track.kind === 'audio') {
      let a = document.getElementById(`a-${pid}`);
      if (!a) { a = document.createElement('audio'); a.id = `a-${pid}`; a.autoplay = true; a.playsInline = true; $('audio').appendChild(a); }
      a.srcObject = stream; a.muted = v.deaf; a.play?.().catch(() => {});
      addAnalyser(uid, stream);
    }
    e.track.onunmute = () => renderStage(); e.track.onended = () => renderStage();
    renderStage();
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce?.(); if (pc.connectionState === 'closed') dropPeer(pid, uid); };
  return p;
}
function dropPeer(pid, uid) {
  const v = st.voice; const p = v?.peers.get(pid); if (!p) return;
  try { p.pc.close(); } catch {}
  v.peers.delete(pid); v.remote.delete(uid); v.analysers.delete(uid); document.getElementById(`a-${pid}`)?.remove(); renderStage();
}
async function onSignal(cid, msg) {
  const v = st.voice; if (!v || v.channelId !== cid || msg.to !== v.peerId) return;
  const p = peerFor(cid, msg.from, msg.user); if (!p) return;
  const { pc } = p;
  try {
    if (msg.data.sdp) {
      const sdp = msg.data.sdp, collision = sdp.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(sdp);
      if (sdp.type === 'offer') { await pc.setLocalDescription(); p.signal({ sdp: pc.localDescription }); }
    } else if (msg.data.ice) {
      try { await pc.addIceCandidate(msg.data.ice); } catch (e) { if (!p.ignoreOffer) console.warn(e); }
    }
  } catch (e) { console.warn('signal', e); }
}
/** Camera or screen share. Both are free and unlimited in quality (1080p / 60 fps where the device allows). */
async function setVideo(kind) {
  const v = st.voice; if (!v) return;
  if (v.video === kind) kind = null;
  let track = null;
  try {
    if (kind === 'camera') track = (await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } })).getVideoTracks()[0];
    if (kind === 'screen') {
      if (!navigator.mediaDevices.getDisplayMedia) return toast(`${ms('desktop_access_disabled')} Bildschirm teilen geht auf diesem Gerät nicht (z. B. iPhone).`, 'err');
      track = (await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 }, width: { ideal: 1920 } }, audio: false })).getVideoTracks()[0];
      track.onended = () => { if (st.voice?.video === 'screen') setVideo('screen'); };
    }
  } catch { return toast(`${ms('videocam_off')} Kein Zugriff auf ${kind === 'screen' ? 'den Bildschirm' : 'die Kamera'}.`, 'err'); }
  v.videoTrack?.stop();
  v.videoTrack = track; v.video = track ? kind : null;
  for (const p of v.peers.values()) {
    if (p.videoSender) await p.videoSender.replaceTrack(track);
    else if (track) p.videoSender = p.pc.addTrack(track, v.stream);
  }
  voiceWatch.get(v.channelId)?.track(voiceMeta());
  renderStage(); renderSidebar();
}
async function leaveVoice(silent) {
  const v = st.voice; if (!v) return;
  clearInterval(v.timer); v.stream.getTracks().forEach((t) => t.stop()); v.videoTrack?.stop();
  for (const p of v.peers.values()) try { p.pc.close(); } catch {}
  $('audio').innerHTML = '';
  try { await voiceWatch.get(v.channelId)?.untrack(); } catch {}
  st.voice = null;
  if (!silent) { beep('leave'); if (curTarget().kind === 'voice') openTarget(st.view.space, null); else renderSidebar(); }
}
function voiceMute() { const v = st.voice; if (!v) return; v.muted = !v.muted; v.stream.getAudioTracks().forEach((t) => (t.enabled = !v.muted)); voiceWatch.get(v.channelId)?.track(voiceMeta()); renderSidebar(); renderStageControls(); }
function voiceDeaf() { const v = st.voice; if (!v) return; v.deaf = !v.deaf; document.querySelectorAll('#audio audio').forEach((a) => (a.muted = v.deaf)); if (v.deaf && !v.muted) voiceMute(); else { voiceWatch.get(v.channelId)?.track(voiceMeta()); renderSidebar(); renderStageControls(); } }

/* stage: the voice/video room in the main pane. Tiles are kept and patched (never rebuilt) so videos keep playing. */
function stageHtml(cid) {
  const c = [...st.channels.values()].flat().find((x) => x.id === cid);
  const inIt = st.voice?.channelId === cid;
  return `<header id="mainHead" class="main-head"><button class="icon-btn mobile-only" data-action="back" title="Zurück">${ms('arrow_back')}</button>${ms('volume_up', 'hicon')}<b class="htitle">${esc(c?.name || 'Sprachkanal')}</b><span class="grow"></span></header>
    <div class="stage" id="stage">${inIt ? '' : `<div class="empty-state">${ms('headset_mic', 'huge')}<h3>${esc(c?.name || '')}</h3><p>Sprich, zeig dich per Kamera oder teile deinen Bildschirm – in voller Qualität, kostenlos.</p><button class="btn primary" data-action="join-voice" data-id="${cid}">${ms('call')} Beitreten</button></div>`}</div>
    ${inIt ? '<div class="stage-controls glass" id="stageCtl"></div>' : ''}`;
}
function renderStageControls() {
  const el = $('stageCtl'), v = st.voice; if (!el || !v) return;
  const canScreen = !!navigator.mediaDevices?.getDisplayMedia;
  el.innerHTML = `<button class="ctl ${v.muted ? 'off' : ''}" data-action="voice-mute" title="Mikrofon">${ms(v.muted ? 'mic_off' : 'mic')}</button>
    <button class="ctl ${v.deaf ? 'off' : ''}" data-action="voice-deaf" title="Ton">${ms(v.deaf ? 'headset_off' : 'headphones')}</button>
    <button class="ctl ${v.video === 'camera' ? 'on' : ''}" data-action="voice-cam" title="Kamera">${ms(v.video === 'camera' ? 'videocam' : 'videocam_off')}</button>
    ${canScreen ? `<button class="ctl ${v.video === 'screen' ? 'on' : ''}" data-action="voice-screen" title="Bildschirm teilen">${ms(v.video === 'screen' ? 'stop_screen_share' : 'screen_share')}</button>` : ''}
    <button class="ctl end" data-action="voice-leave" title="Auflegen">${ms('call_end')}</button>`;
}
function renderStage() {
  const box = $('stage'), v = st.voice;
  if (!box || !v || curTarget().kind !== 'voice' || curTarget().id !== v.channelId) return;
  box.querySelector('.empty-state')?.remove();
  const people = [st.me.id, ...[...(st.voicePresence.get(v.channelId) || new Map()).keys()].filter((u) => u !== st.me.id)];
  const want = new Set(people);
  box.querySelectorAll('.tile').forEach((t) => { if (!want.has(t.dataset.uid)) t.remove(); });
  for (const uid of people) {
    let tile = box.querySelector(`.tile[data-uid="${uid}"]`);
    if (!tile) {
      tile = document.createElement('div'); tile.className = 'tile glass'; tile.dataset.uid = uid;
      tile.innerHTML = `<video autoplay playsinline muted></video><div class="tile-av">${avatar(uid, 84)}</div><div class="tile-name"></div>`;
      tile.addEventListener('dblclick', () => tile.classList.toggle('big'));
      box.appendChild(tile);
    }
    const meta = uid === st.me.id ? voiceMeta() : (st.voicePresence.get(v.channelId)?.get(uid) || {});
    const stream = uid === st.me.id ? (v.videoTrack ? new MediaStream([v.videoTrack]) : null) : v.remote.get(uid);
    const hasVideo = !!(meta.video && stream?.getVideoTracks().some((t) => t.readyState === 'live'));
    const vid = tile.querySelector('video');
    if (hasVideo) { const key = stream.getVideoTracks()[0].id; if (vid.dataset.key !== key) { vid.srcObject = uid === st.me.id ? stream : new MediaStream(stream.getVideoTracks()); vid.dataset.key = key; vid.play?.().catch(() => {}); } }
    else if (vid.srcObject) { vid.srcObject = null; vid.dataset.key = ''; }
    tile.classList.toggle('has-video', hasVideo); tile.classList.toggle('screen', meta.video === 'screen'); tile.classList.toggle('mirror', uid === st.me.id && meta.video === 'camera');
    tile.classList.toggle('speaking', v.speaking.has(uid));
    tile.querySelector('.tile-name').innerHTML = `${meta.muted ? ms('mic_off', 'tiny') : ''}${meta.video === 'screen' ? ms('screen_share', 'tiny') : ''}<span>${esc(uid === st.me.id ? 'Du' : nameOf(uid))}</span>`;
  }
  box.dataset.count = Math.min(people.length, 9);
  renderStageControls();
}

/* =============================================================== modals */
function openModal(html, cls = '') { const c = $('modalCard'); c.className = `modal-card glass ${cls}`; c.innerHTML = html; $('modal').hidden = false; setTimeout(() => c.querySelector('input:not([type=checkbox]):not([type=color]),textarea')?.focus(), 60); }
function closeModal() { $('modal').hidden = true; $('modalCard').innerHTML = ''; }
function openSheet(html) { $('sheetCard').innerHTML = html; $('sheet').hidden = false; }
function closeSheet() { $('sheet').hidden = true; }
const mhead = (title, sub = '') => `<header class="mhead"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div><button class="icon-btn" data-action="close-modal">${ms('close')}</button></header>`;

function addServerModal() {
  openModal(`${mhead('Server hinzufügen', 'Erstelle deinen eigenen oder tritt einem bei.')}
    <form id="newServer" class="mform"><div class="icon-pick"><button type="button" class="srv-preview" data-action="pick-server-icon" style="--c:#7c5cff">${ms('add_a_photo')}</button>
      <label class="field grow"><span>Servername</span><input name="name" maxlength="60" value="Server von ${esc(st.me.display_name || st.me.username)}" required></label></div>
      <div class="swatches">${['#7c5cff', '#00b8ff', '#23d18b', '#ff5c8a', '#ff9f1c', '#f04c5e', '#3a86ff', '#8338ec'].map((c, i) => `<label><input type="radio" name="color" value="${c}" ${i ? '' : 'checked'}><i style="background:${c}"></i></label>`).join('')}</div>
      <button class="btn primary">${ms('add')} Server erstellen</button></form>
    <div class="or"><span>oder</span></div>
    <form id="joinServer" class="inline-form glass"><input name="code" placeholder="Einladungslink oder Code" autocapitalize="off" autocomplete="off"><button class="btn sec sm">Beitreten</button></form>`);
  let iconFile = null;
  $('modalCard').querySelector('[data-action=pick-server-icon]').onclick = () => pickImage((f) => { iconFile = f; const b = $('modalCard').querySelector('.srv-preview'); b.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; });
  $('newServer').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, btn = f.querySelector('button.btn'); btn.disabled = true;
    try {
      const icon = iconFile ? (await upload(iconFile, 'icons')).url : null;
      const { data: sid, error } = await sb.rpc('create_server', { p_name: f.name.value.trim(), p_color: f.color.value, p_icon: icon });
      if (error) throw error;
      await loadServers(); closeModal(); openTarget(sid, null); toast(`${ms('celebration')} Server erstellt – lade jetzt Freunde ein!`);
    } catch (err) { fail(err); btn.disabled = false; }
  });
  $('joinServer').addEventListener('submit', (e) => { e.preventDefault(); const code = parseInvite(e.target.code.value); if (code) showInvite(code); else toast('Ungültiger Einladungslink.', 'err'); });
}
const parseInvite = (v) => (/invite=([a-z0-9]+)/i.exec(v)?.[1] || (/^[a-z0-9]{6,12}$/i.test(v.trim()) ? v.trim() : null));
async function showInvite(code) {
  const { data, error } = await sb.rpc('invite_info', { code });
  if (error || !data?.length) return toast(`${ms('link_off')} Diese Einladung ist ungültig oder abgelaufen.`, 'err');
  const s = data[0];
  if (st.servers.some((x) => x.id === s.id)) { closeModal(); return openTarget(s.id, null); }
  openModal(`<div class="invite-card"><span class="srv-big" style="--c:${esc(s.color)}">${s.icon_url ? `<img src="${esc(s.icon_url)}" alt="">` : esc(initials(s.name))}</span>
    <p class="sub">Du wurdest eingeladen zu</p><h2>${esc(s.name)}</h2><p class="dim">${ms('group', 'tiny')} ${s.members} Mitglied${s.members == 1 ? '' : 'er'}</p>
    <button class="btn primary" data-action="accept-invite" data-code="${esc(code)}">Einladung annehmen</button><button class="btn sec" data-action="close-modal">Nicht jetzt</button></div>`);
}
async function acceptInvite(code) {
  const { data: sid, error } = await sb.rpc('join_server', { code }); if (error) return fail(error);
  await loadServers(); closeModal(); openTarget(sid, null); toast(`${ms('waving_hand')} Willkommen auf dem Server!`);
}
function inviteLink(s) { return `${appUrl()}#invite=${s.invite_code}`; }
function inviteModal() {
  const s = curServer(); if (!s) return;
  const link = inviteLink(s);
  openModal(`${mhead(`Freunde zu ${esc(s.name)} einladen`, 'Schick ihnen diesen Link – sie können sich damit registrieren und direkt beitreten.')}
    <div class="inline-form glass"><input value="${esc(link)}" readonly id="invLink"><button class="btn primary sm" data-action="copy" data-text="${esc(link)}">Kopieren</button></div>
    ${navigator.share ? `<button class="btn sec" data-action="share-invite" data-text="${esc(link)}">${ms('ios_share')} Teilen</button>` : ''}
    <p class="hint">Code: <b>${esc(s.invite_code)}</b>${isAdmin(s.id) ? ' · <a data-action="reset-invite">Neuen Link erzeugen</a>' : ''}</p>`);
}
function serverMenu() {
  const s = curServer(); if (!s) return;
  const admin = isAdmin(s.id), owner = myRole(s.id) === 'owner';
  openSheet(`<div class="sheet-head"><b>${esc(s.name)}</b></div>
    <button class="sheet-item" data-action="invite">${ms('person_add')} Leute einladen</button>
    ${admin ? `<button class="sheet-item" data-action="server-settings">${ms('settings')} Servereinstellungen</button>
    <button class="sheet-item" data-action="new-chan" data-kind="text">${ms('add_comment')} Textkanal erstellen</button>
    <button class="sheet-item" data-action="new-chan" data-kind="voice">${ms('add_call')} Sprachkanal erstellen</button>` : ''}
    <button class="sheet-item" data-action="mark-server-read">${ms('done_all')} Als gelesen markieren</button>
    <button class="sheet-item" data-action="copy" data-text="${esc(s.id)}">${ms('fingerprint')} Server-ID kopieren</button>
    ${owner ? '' : `<button class="sheet-item danger" data-action="leave-server">${ms('logout')} Server verlassen</button>`}`);
}
function serverSettings() {
  const s = curServer(); if (!s) return; closeSheet();
  const owner = myRole(s.id) === 'owner';
  const members = (st.members.get(s.id) || []).slice().sort((a, b) => ({ owner: 0, admin: 1, member: 2 }[a.role] - { owner: 0, admin: 1, member: 2 }[b.role]));
  openModal(`${mhead('Servereinstellungen', esc(s.name))}
    <form id="srvForm" class="mform"><div class="icon-pick"><button type="button" class="srv-preview" data-action="pick-server-icon" style="--c:${esc(s.color)}">${s.icon_url ? `<img src="${esc(s.icon_url)}" alt="">` : ms('add_a_photo')}</button>
      <label class="field grow"><span>Servername</span><input name="name" maxlength="60" value="${esc(s.name)}"></label></div>
      <label class="field"><span>Farbe</span><input type="color" name="color" value="${esc(s.color)}"></label>
      <button class="btn primary">Speichern</button></form>
    <h3 class="msub">Mitglieder (${members.length})</h3>
    <div class="mlist">${members.map((m) => `<div class="friend">${avatar(m.user_id, 34, true)}<span class="grow"><b>${esc(nameOf(m.user_id))}</b><small>@${esc(prof(m.user_id).username)} · ${{ owner: 'Besitzer', admin: 'Admin', member: 'Mitglied' }[m.role]}</small></span>
      ${owner && m.role !== 'owner' ? `<button class="icon-btn" data-action="toggle-admin" data-id="${m.user_id}" title="${m.role === 'admin' ? 'Admin entfernen' : 'Zum Admin machen'}">${ms(m.role === 'admin' ? 'remove_moderator' : 'add_moderator')}</button>` : ''}
      ${m.role !== 'owner' && m.user_id !== st.me.id && (owner || m.role === 'member') ? `<button class="icon-btn danger" data-action="kick" data-id="${m.user_id}" title="Entfernen">${ms('person_remove')}</button>` : ''}</div>`).join('')}</div>
    ${owner ? `<h3 class="msub danger-t">Gefahrenzone</h3><button class="btn danger" data-action="delete-server">${ms('delete_forever')} Server löschen</button>` : ''}`, 'wide');
  let iconFile = null;
  $('modalCard').querySelector('[data-action=pick-server-icon]').onclick = () => pickImage((f) => { iconFile = f; $('modalCard').querySelector('.srv-preview').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; });
  $('srvForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      const patch = { name: f.name.value.trim() || s.name, color: f.color.value };
      if (iconFile) patch.icon_url = (await upload(iconFile, 'icons')).url;
      const { error } = await sb.from('servers').update(patch).eq('id', s.id); if (error) throw error;
      Object.assign(s, patch); renderRail(); renderSidebar(); toast(`${ms('check_circle')} Gespeichert`); closeModal();
    } catch (err) { fail(err); }
  });
}
function channelModal(kind, chan) {
  const sid = st.view.space; closeSheet();
  openModal(`${mhead(chan ? 'Kanal bearbeiten' : kind === 'voice' ? 'Sprachkanal erstellen' : 'Textkanal erstellen')}
    <form id="chanForm" class="mform"><label class="field"><span>Name</span><div class="prefixed">${ms(kind === 'voice' ? 'volume_up' : 'tag')}<input name="name" maxlength="40" value="${esc(chan?.name || '')}" placeholder="${kind === 'voice' ? 'Lounge' : 'neuer-kanal'}" required></div></label>
      ${kind === 'text' ? `<label class="field"><span>Thema (optional)</span><input name="topic" maxlength="200" value="${esc(chan?.topic || '')}" placeholder="Worum geht es hier?"></label>` : ''}
      <button class="btn primary">${chan ? 'Speichern' : 'Kanal erstellen'}</button>
      ${chan ? `<button type="button" class="btn danger" data-action="delete-chan" data-id="${chan.id}">${ms('delete')} Kanal löschen</button>` : ''}</form>`);
  $('chanForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    let name = f.name.value.trim(); if (kind === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
    const row = { name, topic: f.topic?.value.trim() || '' };
    const req = chan ? sb.from('channels').update(row).eq('id', chan.id) : sb.from('channels').insert({ ...row, server_id: sid, kind, position: (st.channels.get(sid) || []).length });
    const { error } = await req; if (error) return fail(error);
    closeModal(); toast(`${ms('check_circle')} ${chan ? 'Gespeichert' : 'Kanal erstellt'}`);
  });
}
function pickImage(cb) { const i = $('imgPick'); i.value = ''; i.onchange = () => i.files[0] && cb(i.files[0]); i.click(); }

function profileModal(uid) {
  const p = prof(uid), me = uid === st.me.id;
  const fr = st.friends.find((f) => f.requester === uid || f.addressee === uid);
  const mutual = st.servers.filter((s) => (st.members.get(s.id) || []).some((m) => m.user_id === uid));
  openModal(`<div class="profile-card"><div class="banner" style="--c:${esc(p.accent)}${p.banner_url ? `;background-image:url('${esc(p.banner_url)}')` : ''}"></div>
    <div class="pc-av">${avatar(uid, 92, true)}</div>
    <button class="icon-btn pc-close" data-action="close-modal">${ms('close')}</button>
    <div class="pc-body"><h2>${esc(p.display_name || p.username)}</h2><p class="sub">@${esc(p.username)}</p>
    ${p.custom_status ? `<p class="pc-status">${esc(p.custom_status)}</p>` : ''}
    ${p.bio ? `<div class="pc-sec"><small>ÜBER MICH</small><p>${md(p.bio)}</p></div>` : ''}
    <div class="pc-sec"><small>MITGLIED SEIT</small><p>${new Date(p.created_at || Date.now()).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
    ${!me && mutual.length ? `<div class="pc-sec"><small>GEMEINSAME SERVER — ${mutual.length}</small><p>${mutual.map((s) => esc(s.name)).join(', ')}</p></div>` : ''}
    <div class="pc-actions">${me ? `<button class="btn primary" data-action="settings">${ms('edit')} Profil bearbeiten</button>` : `
      <button class="btn primary" data-action="dm" data-id="${uid}">${ms('chat')} Nachricht</button>
      ${!fr ? `<button class="btn sec" data-action="add-friend-id" data-u="${esc(p.username)}">${ms('person_add')} Freund hinzufügen</button>` : fr.status === 'pending' && fr.addressee === st.me.id ? `<button class="btn sec" data-action="accept-friend" data-id="${uid}">${ms('check')} Anfrage annehmen</button>` : ''}`}</div></div></div>`, 'profile');
}
function statusSheet() {
  openSheet(`<div class="sheet-head"><b>Status</b></div>
    ${['online', 'idle', 'dnd', 'invisible'].map((s) => `<button class="sheet-item ${st.me.status === s ? 'on' : ''}" data-action="set-status" data-s="${s}"><i class="dot ${s}"></i>${STATUS[s][0]}</button>`).join('')}
    <form id="customStatus" class="inline-form glass"><input name="t" maxlength="80" placeholder="Eigener Status, z. B. „Zocke gerade 🎮“" value="${esc(st.me.custom_status)}"><button class="btn primary sm">OK</button></form>
    <button class="sheet-item" data-action="profile" data-id="${st.me.id}">${ms('badge')} Mein Profil</button>`);
  $('customStatus').addEventListener('submit', async (e) => { e.preventDefault(); await updateMe({ custom_status: e.target.t.value.trim() }); closeSheet(); });
}
async function updateMe(patch) {
  const { data, error } = await sb.from('profiles').update(patch).eq('id', st.me.id).select().single();
  if (error) { fail(error); return false; }
  st.me = data; st.profiles.set(data.id, data); if ('status' in patch) trackPresence(); softRender(); return true;
}
function settingsModal(tab = 'profile') {
  closeSheet();
  const tabs = [['profile', 'Profil', 'person'], ['account', 'Konto', 'shield_person'], ['look', 'Darstellung', 'palette'], ['notify', 'Benachrichtigungen', 'notifications'], ['about', 'Über Lumo', 'info']];
  const me = st.me, s = st.settings;
  const body = {
    profile: `<form id="profForm" class="mform"><div class="prof-preview"><button type="button" class="banner" data-action="pick-banner" title="Banner ändern" style="--c:${esc(me.accent)}${me.banner_url ? `;background-image:url('${esc(me.banner_url)}')` : ''}"><span class="banner-edit">${ms('wallpaper')} Banner</span></button><button type="button" class="pc-av" data-action="pick-avatar">${avatar(me.id, 84)}<span class="av-edit">${ms('photo_camera')}</span></button></div>
      <p class="hint">Profilbild und Banner dürfen auch animierte GIFs sein – kostenlos.</p>
      <label class="field"><span>Anzeigename</span><input name="display_name" maxlength="40" value="${esc(me.display_name)}"></label>
      <label class="field"><span>Benutzername</span><div class="prefixed"><b>@</b><input name="username" maxlength="32" value="${esc(me.username)}" autocapitalize="off"></div></label>
      <label class="field"><span>Über mich</span><textarea name="bio" maxlength="300" rows="3" placeholder="Erzähl etwas über dich (Markdown möglich)">${esc(me.bio)}</textarea></label>
      <label class="field"><span>Profilfarbe</span><input type="color" name="accent" value="${esc(me.accent)}"></label>
      <button class="btn primary">Speichern</button></form>`,
    account: `<div class="mform"><div class="kv"><small>Angemeldet als</small><b>@${esc(st.me.username)}</b></div>
      <form id="mailForm" class="mform"><label class="field"><span>E-Mail-Adresse</span><input name="email" type="email" autocapitalize="off" value="${esc(/@lumoapp\.vercel\.app$/.test(st.session.user.email || '') ? '' : st.session.user.email || '')}" placeholder="name@beispiel.de"></label><button class="btn sec">${ms('mail')} E-Mail ändern</button></form>
      <form id="pwForm" class="mform"><label class="field"><span>Neues Passwort</span><input name="pw" type="password" minlength="6" autocomplete="new-password"></label><button class="btn sec">Passwort ändern</button></form>
      <button class="btn sec" data-action="logout">${ms('logout')} Abmelden</button>
      <p class="dim small">Anmelden geht mit Benutzername oder E-Mail.</p></div>`,
    look: `<div class="mform"><div class="seg3">${[['auto', 'Automatisch'], ['dark', 'Dunkel'], ['light', 'Hell']].map(([k, l]) => `<button class="${s.theme === k ? 'on' : ''}" data-action="set-theme" data-v="${k}">${l}</button>`).join('')}</div>
      <label class="opt"><span>Kompakte Nachrichten</span><span class="switch"><input type="checkbox" data-set="compact" ${s.compact ? 'checked' : ''}><span></span></span></label>
      <label class="field"><span>Schriftgröße: <b id="fsVal">${s.fontSize}px</b></span><input type="range" min="13" max="19" value="${s.fontSize}" data-set="fontSize"></label></div>`,
    notify: `<div class="mform"><label class="opt"><span>Töne bei Erwähnungen & DMs</span><span class="switch"><input type="checkbox" data-set="sound" ${s.sound ? 'checked' : ''}><span></span></span></label>
      ${'Notification' in window ? `<button class="btn sec" data-action="ask-notify">${ms('notifications_active')} Systembenachrichtigungen ${Notification.permission === 'granted' ? 'sind an' : 'erlauben'}</button>` : '<p class="dim small">Systembenachrichtigungen: App über „Zum Home-Bildschirm“ installieren (iOS 16.4+).</p>'}</div>`,
    about: `<div class="mform"><p><b>Lumo ${VERSION}</b> – Server, Kanäle, DMs, Freunde, Sprach- und Videochat, Bildschirm teilen, Umfragen, Reaktionen, Antworten, Anheften, Suche, Dateien und Markdown.</p>
      <p><b>Alles kostenlos:</b> Dateien bis 50 MB, Nachrichten bis 4.000 Zeichen, animierte Profilbilder, Profil-Banner, Video und Bildschirm teilen in voller Qualität.</p>
      <p class="dim small">Formatierung: **fett**, *kursiv*, __unterstrichen__, ~~durchgestrichen~~, \`Code\`, \`\`\`Block\`\`\`, &gt; Zitat, ||Spoiler||, @erwähnen. Befehl: /umfrage</p></div>`,
  }[tab];
  openModal(`${mhead('Einstellungen')}<div class="settings"><nav class="stabs">${tabs.map(([k, l, i]) => `<button class="${k === tab ? 'on' : ''}" data-action="settings-tab" data-tab="${k}">${ms(i)}<span>${l}</span></button>`).join('')}</nav><div class="spane">${body}</div></div>`, 'wide');
  $('profForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const u = f.username.value.trim().toLowerCase();
    if (!/^[a-z0-9_.]{2,32}$/.test(u)) return toast('Benutzername: 2–32 Zeichen, nur a–z, 0–9, Punkt und Unterstrich.', 'err');
    if (await updateMe({ display_name: f.display_name.value.trim(), username: u, bio: f.bio.value.trim(), accent: f.accent.value })) toast(`${ms('check_circle')} Profil gespeichert`);
  });
  $('mailForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const email = e.target.email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Bitte eine gültige E-Mail-Adresse eingeben.', 'err');
    const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: appUrl() });
    if (error) return fail(error);
    toast(`${ms('mark_email_read')} Bestätigungslink an ${esc(email)} gesendet`);
  });
  $('pwForm')?.addEventListener('submit', async (e) => { e.preventDefault(); const pw = e.target.pw.value; if (pw.length < 6) return toast('Mindestens 6 Zeichen.', 'err'); const { error } = await sb.auth.updateUser({ password: pw }); if (error) fail(error); else { toast(`${ms('check_circle')} Passwort geändert`); e.target.reset(); } });
}
function msgMenu(id) {
  const m = findMsg(id); if (!m) return;
  const mine = m.author_id === st.me.id, admin = m.channel_id && isAdmin(st.view.space);
  openSheet(`<div class="sheet-react">${QUICK.map((e) => `<button data-action="react" data-id="${id}" data-emoji="${e}">${e}</button>`).join('')}<button data-action="react-pick" data-id="${id}">${ms('add_reaction')}</button></div>
    <button class="sheet-item" data-action="reply" data-id="${id}">${ms('reply')} Antworten</button>
    ${mine ? `<button class="sheet-item" data-action="edit" data-id="${id}">${ms('edit')} Bearbeiten</button>` : ''}
    ${m.content ? `<button class="sheet-item" data-action="copy" data-text="${esc(m.content)}">${ms('content_copy')} Text kopieren</button>` : ''}
    ${m.conversation_id || admin ? `<button class="sheet-item" data-action="pin" data-id="${id}">${ms('push_pin')} ${m.pinned ? 'Lösen' : 'Anheften'}</button>` : ''}
    ${!mine && m.conversation_id == null ? `<button class="sheet-item" data-action="dm" data-id="${m.author_id}">${ms('chat')} Privat schreiben</button>` : ''}
    ${mine || admin ? `<button class="sheet-item danger" data-action="delete-msg" data-id="${id}">${ms('delete')} Nachricht löschen</button>` : ''}`);
}
function emojiPicker(onPick) {
  const recent = LS.get('recentEmoji', []);
  openSheet(`<div class="sheet-head"><b>Emoji</b></div>${recent.length ? `<small class="dim pad-x">Zuletzt</small><div class="emoji-grid">${recent.map((e) => `<button data-action="emoji-pick" data-e="${e}">${e}</button>`).join('')}</div>` : ''}
    <div class="emoji-grid">${EMOJI.map((e) => `<button data-action="emoji-pick" data-e="${e}">${e}</button>`).join('')}</div>`);
  emojiCb = (e) => { LS.set('recentEmoji', [e, ...recent.filter((x) => x !== e)].slice(0, 16)); onPick(e); };
}
let emojiCb = null;
function openPoll() {
  openModal(`${mhead('Umfrage erstellen')}<form id="pollForm" class="mform"><label class="field"><span>Frage</span><input name="q" maxlength="200" required placeholder="Was zocken wir heute?"></label>
    <div id="pollOpts">${[1, 2].map((i) => `<label class="field"><span>Antwort ${i}</span><input name="o" maxlength="80" required></label>`).join('')}</div>
    <button type="button" class="btn sec sm" data-action="poll-add">${ms('add')} Antwort hinzufügen</button><button class="btn primary">Umfrage senden</button></form>`);
  $('pollForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, opts = [...f.querySelectorAll('[name=o]')].map((x) => x.value.trim()).filter(Boolean);
    if (opts.length < 2) return toast('Mindestens zwei Antworten.', 'err');
    const t = curTarget();
    const { error } = await sb.from('messages').insert({ author_id: st.me.id, content: '', poll: { question: f.q.value.trim(), options: opts }, [t.kind === 'channel' ? 'channel_id' : 'conversation_id']: t.id });
    if (error) return fail(error); closeModal();
  });
}
function pinsSheet() {
  const t = curTarget(), list = (st.messages.get(t.id) || []).filter((m) => m.pinned);
  sb.from('messages').select('*').eq(t.kind === 'channel' ? 'channel_id' : 'conversation_id', t.id).eq('pinned', true).order('created_at', { ascending: false }).limit(50).then(async ({ data }) => {
    await ensureProfiles((data || []).map((m) => m.author_id));
    openSheet(`<div class="sheet-head"><b>${ms('push_pin')} Angeheftete Nachrichten</b></div>${(data || list).map((m) => `<button class="pin-item glass" data-action="jump" data-id="${m.id}">${avatar(m.author_id, 28)}<span><b>${esc(nameOf(m.author_id))}</b><small>${esc(m.content.slice(0, 160) || 'Anhang / Umfrage')}</small></span></button>`).join('') || '<p class="empty">Noch nichts angeheftet. Admins können Nachrichten über „…“ anheften.</p>'}`);
  });
}
function quickSwitch() {
  openModal(`${mhead('Wohin möchtest du?')}<input class="qs-input" id="qs" placeholder="Server, Kanal, Freund oder @benutzername" autocapitalize="off"><div id="qsRes" class="qs-res"></div>`);
  const run = async () => {
    const q = $('qs').value.trim().toLowerCase();
    const items = [];
    for (const s of st.servers) {
      if (!q || s.name.toLowerCase().includes(q)) items.push(`<button data-action="go-server" data-id="${s.id}">${ms('dns')}<b>${esc(s.name)}</b><small>Server</small></button>`);
      for (const c of st.channels.get(s.id) || []) if (c.kind === 'text' && q && c.name.includes(q)) items.push(`<button data-action="open-chan" data-id="${c.id}" data-server="${s.id}">${ms('tag')}<b>${esc(c.name)}</b><small>${esc(s.name)}</small></button>`);
    }
    for (const c of st.convs) { const o = c.members.find((u) => u !== st.me.id) || st.me.id; if (!q || nameOf(o).toLowerCase().includes(q) || prof(o).username.includes(q)) items.push(`<button data-action="open-conv" data-id="${c.id}">${avatar(o, 24)}<b>${esc(nameOf(o))}</b><small>Direktnachricht</small></button>`); }
    if (q.length >= 2) {
      const { data } = await sb.from('profiles').select('*').or(`username.ilike.%${q.replace(/[%,()]/g, '')}%,display_name.ilike.%${q.replace(/[%,()]/g, '')}%`).limit(8);
      for (const p of data || []) { st.profiles.set(p.id, p); if (p.id !== st.me.id) items.push(`<button data-action="profile" data-id="${p.id}">${avatar(p.id, 24)}<b>${esc(p.display_name || p.username)}</b><small>@${esc(p.username)}</small></button>`); }
    }
    if ($('qsRes')) $('qsRes').innerHTML = items.slice(0, 30).join('') || '<p class="empty">Nichts gefunden.</p>';
  };
  let tmr; $('qs').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(run, 200); }); run();
}

/* ============================================================== actions */
const A = {
  reload: () => location.reload(),
  'close-modal': closeModal, 'close-sheet': closeSheet,
  'auth-mode': ({ mode }) => renderAuth(mode),
  'resend-mail': async ({ email }, el) => {
    el.disabled = true;
    const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: appUrl() } });
    if (error) { el.disabled = false; return fail(error); }
    toast(`${ms('send')} E-Mail erneut gesendet`); setTimeout(() => (el.disabled = false), 30000);
  },
  logout: async () => { closeModal(); await sb.auth.signOut(); },
  'go-home': () => openTarget('home', LS.get('lastHome', { kind: 'friends' })),
  'go-server': ({ id }) => { closeModal(); openTarget(id, null); },
  'open-chan': ({ id, server }) => { closeModal(); openTarget(server || st.view.space, { kind: 'channel', id }); },
  'open-conv': ({ id }) => { closeModal(); LS.set('lastHome', { kind: 'conv', id }); openTarget('home', { kind: 'conv', id }); },
  friends: () => { LS.set('lastHome', { kind: 'friends' }); openTarget('home', { kind: 'friends' }); },
  'friends-tab': ({ tab }) => { st.friendsTab = tab; if (curTarget().kind !== 'friends') { st.view.target = { kind: 'friends' }; } renderMain(); if (isMobile()) setPane('chat'); setTimeout(() => $('addFriend')?.u.focus(), 50); },
  'accept-friend': ({ id }) => acceptFriend(id),
  'remove-friend': ({ id }) => removeFriend(id),
  'add-friend-id': ({ u }) => { addFriend(u); closeModal(); },
  dm: ({ id }) => openDm(id),
  'new-dm': () => quickSwitch(),
  'quick-switch': () => quickSwitch(),
  back: () => setPane('nav'),
  'toggle-members': () => { if (isMobile()) { document.querySelector('.app').classList.toggle('members-open'); return; } st.showMembers = !st.showMembers; LS.set('showMembers', st.showMembers); renderMain(); renderMembers(); },
  'add-server': addServerModal,
  explore: () => { addServerModal(); setTimeout(() => $('joinServer')?.code.focus(), 80); },
  'accept-invite': ({ code }) => acceptInvite(code),
  invite: () => { closeSheet(); inviteModal(); },
  'share-invite': ({ text }) => navigator.share?.({ title: 'Lumo-Einladung', text: 'Komm auf meinen Lumo-Server!', url: text }).catch(() => {}),
  'reset-invite': async () => { const s = curServer(); const { data, error } = await sb.rpc('reset_invite', { sid: s.id }); if (error) return fail(error); s.invite_code = data; inviteModal(); toast('Neuer Einladungslink erzeugt – der alte gilt nicht mehr.'); },
  'server-menu': serverMenu,
  'server-settings': serverSettings,
  'new-chan': ({ kind }) => channelModal(kind),
  'edit-chan': ({ id }) => { const c = (st.channels.get(st.view.space) || []).find((x) => x.id === id); if (c) channelModal(c.kind, c); },
  'delete-chan': async ({ id }) => { if (!confirmTwice('chan' + id, 'Nochmal tippen, um den Kanal endgültig zu löschen')) return; const { error } = await sb.from('channels').delete().eq('id', id); if (error) return fail(error); closeModal(); toast('Kanal gelöscht'); },
  'leave-server': async () => { if (!confirmTwice('leave', 'Nochmal tippen zum Verlassen')) return; const s = curServer(); closeSheet(); const { error } = await sb.from('server_members').delete().match({ server_id: s.id, user_id: st.me.id }); if (error) return fail(error); removeServerLocal(s.id); toast(`Du hast ${esc(s.name)} verlassen.`); },
  'delete-server': async () => { if (!confirmTwice('delsrv', 'Wirklich? Alles wird gelöscht. Nochmal tippen.')) return; const s = curServer(); const { error } = await sb.from('servers').delete().eq('id', s.id); if (error) return fail(error); closeModal(); removeServerLocal(s.id); toast('Server gelöscht'); },
  'toggle-admin': async ({ id }) => { const s = curServer(), m = (st.members.get(s.id) || []).find((x) => x.user_id === id); const role = m.role === 'admin' ? 'member' : 'admin'; const { error } = await sb.from('server_members').update({ role }).match({ server_id: s.id, user_id: id }); if (error) return fail(error); m.role = role; serverSettings(); },
  kick: async ({ id }) => { if (!confirmTwice('kick' + id, 'Nochmal tippen zum Entfernen')) return; const s = curServer(); const { error } = await sb.from('server_members').delete().match({ server_id: s.id, user_id: id }); if (error) return fail(error); st.members.set(s.id, (st.members.get(s.id) || []).filter((m) => m.user_id !== id)); serverSettings(); renderMembers(); },
  'mark-server-read': () => { for (const c of st.channels.get(st.view.space) || []) markRead(c.id); closeSheet(); renderRail(); renderSidebar(); },
  'join-voice': ({ id }) => joinVoice(id),
  'voice-cam': () => setVideo('camera'), 'voice-screen': () => setVideo('screen'),
  'open-voice': ({ id }) => { const sid = [...st.channels.entries()].find(([, l]) => l.some((c) => c.id === id))?.[0] || st.view.space; openTarget(sid, { kind: 'voice', id }); },
  'voice-mute': voiceMute, 'voice-deaf': voiceDeaf, 'voice-leave': () => leaveVoice(),
  'my-status': statusSheet,
  'set-status': async ({ s }) => { await updateMe({ status: s }); closeSheet(); },
  settings: () => { closeModal(); settingsModal(); },
  'settings-tab': ({ tab }) => settingsModal(tab),
  'set-theme': ({ v }) => { st.settings.theme = v; LS.set('settings', st.settings); applySettings(); settingsModal('look'); },
  'ask-notify': async () => { try { await Notification.requestPermission(); } catch {} settingsModal('notify'); },
  'pick-avatar': () => pickImage(async (f) => { try { toast(`${ms('upload')} Lade Bild hoch …`); const a = await upload(f, 'avatars'); await updateMe({ avatar_url: a.url }); settingsModal('profile'); toast(`${ms('check_circle')} Profilbild aktualisiert`); } catch (e) { fail(e); } }),
  profile: ({ id }) => { closeSheet(); profileModal(id); },
  'pick-banner': () => pickImage(async (f) => { try { toast(`${ms('upload')} Lade Banner hoch …`); const a = await upload(f, 'banners'); await updateMe({ banner_url: a.url }); settingsModal('profile'); toast(`${ms('check_circle')} Banner aktualisiert`); } catch (e) { fail(e); } }),
  'attach-menu': () => openSheet(`<div class="sheet-head"><b>Hinzufügen</b></div>
    <button class="sheet-item" data-action="attach-file">${ms('upload_file')} Datei oder Foto hochladen</button>
    <button class="sheet-item" data-action="new-poll">${ms('ballot')} Umfrage erstellen</button>`),
  'attach-file': () => { closeSheet(); const i = $('filePick'); i.value = ''; i.onchange = () => addFiles([...i.files]); i.click(); },
  'new-poll': () => { closeSheet(); openPoll(); },
  'poll-add': () => { const box = $('pollOpts'), n = box.children.length; if (n >= 10) return; box.insertAdjacentHTML('beforeend', `<label class="field"><span>Antwort ${n + 1}</span><input name="o" maxlength="80"></label>`); },
  'rm-file': ({ i }) => { st.pendingFiles.splice(+i, 1); renderCompExtra(); },
  emoji: () => emojiPicker((e) => { const inp = $('input'); const p = inp.selectionStart ?? inp.value.length; inp.value = inp.value.slice(0, p) + e + inp.value.slice(p); closeSheet(); inp.focus(); autosize(inp); }),
  'emoji-pick': ({ e }) => emojiCb?.(e),
  react: ({ id, emoji }) => { closeSheet(); react(id, emoji); },
  'react-pick': ({ id }) => emojiPicker((e) => { closeSheet(); react(id, e); }),
  reply: ({ id }) => { closeSheet(); st.replyTo = id; st.editing = null; renderCompExtra(); $('input')?.focus(); },
  'cancel-reply': () => { st.replyTo = null; renderCompExtra(); },
  edit: ({ id }) => { closeSheet(); startEdit(id); },
  'cancel-edit': () => { st.editing = null; const i = $('input'); i.value = ''; autosize(i); renderCompExtra(); renderMessages(); },
  'msg-menu': ({ id }) => msgMenu(id),
  'delete-msg': ({ id }) => { if (!confirmTwice('del' + id, 'Nochmal tippen zum Löschen')) return; closeSheet(); deleteMsg(id); },
  pin: async ({ id }) => { closeSheet(); const { data, error } = await sb.rpc('toggle_pin', { mid: id }); if (error) return fail(error); toast(`${ms('push_pin')} ${data ? 'Angeheftet' : 'Gelöst'}`); },
  pins: pinsSheet,
  search: () => {
    openSheet(`<div class="sheet-head"><b>${ms('search')} In diesem Chat suchen</b></div><form id="srch" class="inline-form glass"><input name="q" value="${esc(st.search)}" placeholder="Suchbegriff"><button class="btn primary sm">Suchen</button></form>${st.search ? '<button class="sheet-item" data-action="clear-search">Suche zurücksetzen</button>' : ''}`);
    $('srch').addEventListener('submit', async (e) => { e.preventDefault(); st.search = e.target.q.value.trim(); closeSheet(); const t = curTarget(); while (st.search && st.hasMore.get(t.id) && (st.messages.get(t.id) || []).length < 400) await loadMessages(t.id, t.kind, true); renderMessages(); });
  },
  'clear-search': () => { st.search = ''; closeSheet(); renderMessages({ stick: true }); },
  jump: ({ id }) => { closeSheet(); const el = document.getElementById('m-' + id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } else toast('Nachricht liegt weiter oben – scrolle hoch, um sie zu laden.'); },
  vote: ({ id, opt }) => vote(id, +opt),
  lightbox: ({ src }) => openModal(`<button class="icon-btn lb-close" data-action="close-modal">${ms('close')}</button><img class="lightbox" src="${esc(src)}" alt=""><a class="btn sec sm" href="${esc(src)}" target="_blank" rel="noopener">${ms('open_in_new')} Original öffnen</a>`, 'lb'),
  spoiler: (_, el) => el.classList.add('shown'),
  copy: async ({ text }) => { closeSheet(); try { await navigator.clipboard.writeText(text); toast(`${ms('content_copy')} Kopiert`); } catch { toast('Kopieren nicht möglich – bitte manuell markieren.'); } },
  'pick-mention': ({ u }) => pickMention(u),
};
const atobSafe = (s) => { try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } };
let armed = null, armedT;
function confirmTwice(key, msg) { if (armed === key) { armed = null; return true; } armed = key; clearTimeout(armedT); armedT = setTimeout(() => (armed = null), 4000); toast(`${ms('warning')} ${msg}`); return false; }

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
  const fn = A[el.dataset.action]; if (!fn) return;
  if (el.tagName === 'A' && el.getAttribute('href')) return;
  e.preventDefault(); fn({ ...el.dataset }, el);
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset.set; if (!k) return;
  st.settings[k] = e.target.type === 'checkbox' ? e.target.checked : +e.target.value;
  LS.set('settings', st.settings); applySettings(); if (k === 'compact') renderMessages();
});
document.addEventListener('input', (e) => { if (e.target.dataset.set === 'fontSize') { const v = $('fsVal'); if (v) v.textContent = e.target.value + 'px'; document.documentElement.style.setProperty('--fs', e.target.value + 'px'); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!$('sheet').hidden) closeSheet(); else if (!$('modal').hidden) closeModal(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && st.me) { e.preventDefault(); quickSwitch(); }
});
// long-press on a message opens its menu (touch devices)
let lpT = null;
document.addEventListener('touchstart', (e) => { const m = e.target.closest('.msg'); if (!m || e.target.closest('button,a,video,audio')) return; lpT = setTimeout(() => { navigator.vibrate?.(10); msgMenu(m.dataset.id); }, 480); }, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach((ev) => document.addEventListener(ev, () => clearTimeout(lpT), { passive: true }));
// swipe right from the chat goes back to the navigation on phones
let sx = null;
document.addEventListener('touchstart', (e) => { if (isMobile() && st.pane === 'chat' && e.touches[0].clientX < 30) sx = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', (e) => { if (sx != null && e.changedTouches[0].clientX - sx > 80) setPane('nav'); sx = null; }, { passive: true });
window.addEventListener('hashchange', () => { const inv = /[#&]invite=([a-z0-9]+)/i.exec(location.hash)?.[1]; if (inv && st.me) { history.replaceState(null, '', location.pathname); showInvite(inv); } });

boot();
