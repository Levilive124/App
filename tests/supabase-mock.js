// In-memory stand-in for supabase-js used only by the automated UI tests.
const __mock = (function () {
  const uuid = () => crypto.randomUUID();
  const now = () => new Date(Date.now() + (window.__clockSkew = (window.__clockSkew || 0) + 1)).toISOString();
  const T = { profiles: [], servers: [], server_members: [], channels: [], conversations: [], conversation_members: [], messages: [], reactions: [], poll_votes: [], friendships: [], read_states: [] };
  const users = [];
  const subs = []; // {table, cb}
  let session = null;
  const authCbs = [];
  function emit(table, eventType, newRow, oldRow) { for (const s of subs) if (s.table === table && (s.event === '*' || s.event === eventType)) setTimeout(() => s.cb({ eventType, new: newRow || {}, old: oldRow || {} }), 5); }
  const uid = () => session?.user.id;
  function addProfile(id, username, display) { const p = { id, username, display_name: display || username, avatar_url: null, bio: '', status: 'online', custom_status: '', accent: '#6c5ce7', created_at: now() }; T.profiles.push(p); return p; }
  function addUser(email, password, meta) { const id = uuid(); users.push({ id, email, password }); addProfile(id, meta.username, meta.display_name); return id; }
  function insertRow(table, row) {
    const r = { ...row };
    if (table === 'messages') Object.assign(r, { id: r.id || uuid(), created_at: now(), attachments: r.attachments || [], pinned: false, edited_at: null, reply_to: r.reply_to || null, poll: r.poll || null, channel_id: r.channel_id || null, conversation_id: r.conversation_id || null });
    if (table === 'channels') Object.assign(r, { id: r.id || uuid(), created_at: now(), topic: r.topic || '', position: r.position || 0 });
    if (table === 'friendships') Object.assign(r, { status: r.status || 'pending', created_at: now() });
    T[table].push(r); emit(table, 'INSERT', r); return r;
  }
  // seed: another user with a server
  const miaId = addUser('mia@test.de', 'secret1', { username: 'mia', display_name: 'Mia' });
  window.__mock = {
    T, users, miaId,
    asMia(content, target) { return insertRow('messages', { author_id: miaId, content, ...target }); },
    friendRequestFromMia(to) { return insertRow('friendships', { requester: miaId, addressee: to }); },
  };

  function rpc(name, a) {
    const me = uid();
    if (name === 'create_server') {
      const s = { id: uuid(), name: a.p_name, color: a.p_color, icon_url: a.p_icon, owner_id: me, invite_code: Math.random().toString(36).slice(2, 10), created_at: now() };
      T.servers.push(s); insertRow('server_members', { server_id: s.id, user_id: me, role: 'owner', joined_at: now() });
      ['allgemein', 'medien'].forEach((n, i) => insertRow('channels', { server_id: s.id, name: n, kind: 'text', position: i }));
      insertRow('channels', { server_id: s.id, name: 'Lounge', kind: 'voice', position: 2 });
      return s.id;
    }
    if (name === 'invite_info') { const s = T.servers.find((x) => x.invite_code === a.code); return s ? [{ ...s, members: T.server_members.filter((m) => m.server_id === s.id).length }] : []; }
    if (name === 'join_server') { const s = T.servers.find((x) => x.invite_code === a.code); if (!s) throw new Error('Einladung ungültig'); insertRow('server_members', { server_id: s.id, user_id: me, role: 'member', joined_at: now() }); return s.id; }
    if (name === 'open_dm') {
      const mine = T.conversation_members.filter((c) => c.user_id === me).map((c) => c.conversation_id);
      const ex = mine.find((cid) => T.conversation_members.some((c) => c.conversation_id === cid && c.user_id === a.other));
      if (ex) return ex;
      const cid = uuid(); T.conversations.push({ id: cid, created_at: now() });
      insertRow('conversation_members', { conversation_id: cid, user_id: me }); insertRow('conversation_members', { conversation_id: cid, user_id: a.other });
      return cid;
    }
    if (name === 'toggle_pin') { const m = T.messages.find((x) => x.id === a.mid); m.pinned = !m.pinned; emit('messages', 'UPDATE', m); return m.pinned; }
    if (name === 'username_available') return !T.profiles.some((p) => p.username === a.u);
    if (name === 'reset_invite') { const s = T.servers.find((x) => x.id === a.sid); s.invite_code = Math.random().toString(36).slice(2, 10); return s.invite_code; }
    throw new Error('unknown rpc ' + name);
  }

  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.cols = '*'; }
    select(c) { if (this.op === 'select') this.cols = c || '*'; else this.returning = true; return this; }
    eq(c, v) { this.f.push((r) => r[c] === v); return this; }
    neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
    in(c, arr) { this.f.push((r) => arr.includes(r[c])); return this; }
    lt(c, v) { this.f.push((r) => r[c] < v); return this; }
    match(o) { this.f.push((r) => Object.entries(o).every(([k, v]) => r[k] === v)); return this; }
    or(str) {
      if (str.includes('ilike')) { const q = /%([^%]*)%/.exec(str)[1].toLowerCase(); this.f.push((r) => (r.username || '').includes(q) || (r.display_name || '').toLowerCase().includes(q)); }
      else { const ids = [...str.matchAll(/eq\.([0-9a-f-]{36})/g)].map((m) => m[1]); this.f.push((r) => ids.includes(r.requester) && ids.includes(r.addressee)); }
      return this;
    }
    order(c, o = {}) { this.ord = [c, o.ascending !== false]; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.single1 = 'maybe'; return this; }
    single() { this.single1 = 'one'; return this; }
    insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    upsert(row) { this.op = 'upsert'; this.rows = [row]; return this; }
    update(p) { this.op = 'update'; this.patch = p; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return Promise.resolve().then(() => { try { return this.run(); } catch (e) { return { data: null, error: { message: e.message } }; } }).then(res, rej); }
    run() {
      const tab = T[this.t]; if (!tab) return { data: null, error: { message: 'no table ' + this.t } };
      const match = (r) => this.f.every((f) => f(r));
      if (this.op === 'insert') {
        const out = this.rows.map((r) => {
          if (this.t === 'reactions' && tab.some((x) => x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji)) throw new Error('duplicate key');
          return insertRow(this.t, r);
        });
        return { data: this.returning ? out : null, error: null };
      }
      if (this.op === 'upsert') {
        const r = this.rows[0]; const keys = this.t === 'poll_votes' ? ['message_id', 'user_id'] : ['user_id', 'target_id'];
        const ex = tab.find((x) => keys.every((k) => x[k] === r[k]));
        if (ex) { Object.assign(ex, r); emit(this.t, 'UPDATE', ex); } else insertRow(this.t, r);
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        const rows = tab.filter(match); rows.forEach((r) => { Object.assign(r, this.patch); emit(this.t, 'UPDATE', r); });
        const data = this.returning ? (this.single1 ? rows[0] : rows) : null; return { data, error: null };
      }
      if (this.op === 'delete') {
        const rows = tab.filter(match); for (const r of rows) { tab.splice(tab.indexOf(r), 1); emit(this.t, 'DELETE', null, r); }
        if (this.t === 'servers') for (const r of rows) { T.server_members = T.server_members.filter((m) => m.server_id !== r.id); }
        return { data: null, error: null };
      }
      let rows = tab.filter(match);
      if (this.ord) { const [c, asc] = this.ord; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.lim) rows = rows.slice(0, this.lim);
      if (this.cols.includes('servers(*)')) rows = rows.map((r) => ({ ...r, servers: T.servers.find((s) => s.id === r.server_id) }));
      rows = rows.map((r) => ({ ...r }));
      if (this.single1) return { data: rows[0] || null, error: this.single1 === 'one' && !rows[0] ? { message: 'not found' } : null };
      return { data: rows, error: null };
    }
  }

  function channel(name) {
    const ch = {
      name, handlers: [],
      on(type, filter, cb) { if (type === 'postgres_changes') subs.push({ table: filter.table, event: filter.event, cb }); else this.handlers.push({ type, filter, cb }); return this; },
      subscribe(cb) { setTimeout(() => { cb?.('SUBSCRIBED'); this.handlers.filter((h) => h.type === 'presence').forEach((h) => h.cb()); }, 10); return this; },
      tracked: null,
      presenceState() { if (name === 'lumo-presence') return { [uid()]: [{ status: 'online' }], [miaId]: [{ status: 'idle' }] }; return this.tracked ? { [uid()]: [this.tracked] } : {}; },
      _sync() { setTimeout(() => this.handlers.filter((h) => h.type === 'presence').forEach((h) => h.cb()), 5); },
      track(meta) { if (name !== 'lumo-presence') { this.tracked = meta; this._sync(); } return Promise.resolve(); },
      untrack() { this.tracked = null; this._sync(); return Promise.resolve(); }, send() { return Promise.resolve(); },
    };
    return ch;
  }

  window.supabase = {
    createClient() {
      const stored = localStorage.getItem('mock.session'); if (stored) session = JSON.parse(stored);
      const setSession = (s, evt) => { session = s; if (s) localStorage.setItem('mock.session', JSON.stringify(s)); else localStorage.removeItem('mock.session'); authCbs.forEach((cb) => setTimeout(() => cb(evt, s), 0)); };
      return {
        auth: {
          getSession: async () => ({ data: { session } }),
          onAuthStateChange: (cb) => { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          signUp: async ({ email, password, options }) => {
            if (users.some((u) => u.email === email)) return { data: {}, error: { message: 'User already registered' } };
            const id = addUser(email, password, options.data); const s = { user: { id, email } }; setSession(s, 'SIGNED_IN'); return { data: { session: s }, error: null };
          },
          signInWithPassword: async ({ email, password }) => {
            const u = users.find((x) => x.email === email && x.password === password);
            if (!u) return { error: { message: 'Invalid login credentials' } };
            const s = { user: { id: u.id, email } }; setSession(s, 'SIGNED_IN'); return { data: { session: s }, error: null };
          },
          signOut: async () => { setSession(null, 'SIGNED_OUT'); return { error: null }; },
          updateUser: async () => ({ data: {}, error: null }),
          resetPasswordForEmail: async () => ({ error: null }),
        },
        from: (t) => new Q(t),
        rpc: async (n, a) => { try { return { data: rpc(n, a), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
        channel, removeChannel() {},
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#7c5cff"/></svg>') } }) }) },
      };
    },
  };
return window.supabase; })();
export const createClient = (...a) => __mock.createClient(...a);
