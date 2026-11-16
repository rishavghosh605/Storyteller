// Storage. Everything the app knows is a "file" with a path.
// Working copy: IndexedDB in this browser (fast, works offline).
// Optional mirror: a branch of a GitHub repo, or a folder on this computer.
// Paths under "local/" never leave this device (the book text itself lives there).

const DB_NAME = 'grandma-storyteller';
const SETTINGS_KEY = 'grandma.settings';
let dbp = null;
const listeners = new Set();

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('files', { keyPath: 'path' });
        r.result.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const DEFAULTS = {
  backend: 'browser',          // 'browser' | 'github' | 'folder'
  ghOwner: '', ghRepo: '', ghBranch: 'library', ghToken: '',
  ghTokenExpires: '',          // ISO date, read from GitHub when possible or typed in Settings
  voiceEn: '', voiceDe: '',
  rateEn: 0.9, rateDe: 0.8, pitchEn: 0.9, pitchDe: 1.0,
  slowDe: false,
  cloud: true, meanings: false, mic: false, micLang: 'en-US',
  waitForMe: true, glue: true, localAI: false,
  drift: true, sounds: true, soundLevel: 0.5,   // the picture moves a little; quiet room sounds and how loud (0 = off)
  swapSides: false,
  current: '',                 // current journey id
};

export function settings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* fresh start */ }
  return { ...DEFAULTS, ...s };
}
export function saveSettings(patch) {
  const s = { ...settings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  return s;
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

// ---------- files ----------
// A small index of all paths is kept in memory, so that looking for a file never
// has to load every picture and the whole book from the database again.
let indexP = null;
function index() {
  if (!indexP) indexP = tx('files', 'readonly', s => s.getAll()).then(all => new Map(all.map(r => [r.path, { tag: r.tag, dirty: r.dirty, deleted: r.deleted, mtime: r.mtime }])));
  return indexP;
}
async function writeRec(rec) {
  await tx('files', 'readwrite', s => s.put(rec));
  (await index()).set(rec.path, { tag: rec.tag, dirty: rec.dirty, deleted: rec.deleted, mtime: rec.mtime });
}
async function dropRec(path) {
  await tx('files', 'readwrite', s => s.delete(path));
  (await index()).delete(path);
}
// Forget every journey on this device (texts, pictures, places), so another library can take their place.
// Book files that were read on this device stay, and so do the settings.
export async function forgetJourneys() {
  const idx = await index();
  for (const path of [...idx.keys()]) if (!path.startsWith('local/')) await dropRec(path);
  emit({ type: 'del', path: 'journeys/' });
}
// How many journeys are on this device, and how many of their files have never reached a library.
export async function onDevice() {
  const idx = await index();
  let journeys = 0, unsaved = 0;
  for (const [path, m] of idx) {
    if (path.startsWith('local/') || m.deleted) continue;
    if (/^journeys\/[^/]+\/journey\.json$/.test(path)) journeys++;
    if (m.dirty || !m.tag) unsaved++;
  }
  return { journeys, unsaved };
}
export async function getRec(path) { return tx('files', 'readonly', s => s.get(path)); }
export async function get(path) {
  const r = await getRec(path);
  return r && !r.deleted ? r.body : undefined;
}
export async function getJSON(path) {
  const b = await get(path);
  if (b == null) return undefined;
  try { return JSON.parse(typeof b === 'string' ? b : await b.text()); } catch { return undefined; }
}
// lazy: for small frequent saves (my place). They reach GitHub a little later, in one go.
export async function put(path, body, { lazy = false } = {}) {
  const old = (await index()).get(path);
  await writeRec({ path, body, tag: old?.tag || '', dirty: true, deleted: false, mtime: Date.now() });
  emit({ type: 'put', path });
  scheduleSync(lazy ? 90000 : 5000, lazy);
}
export const putJSON = (path, obj, opts) => put(path, JSON.stringify(obj, null, 1), opts);
export async function del(path) {
  const old = (await index()).get(path);
  if (!old) return;
  if (old.tag) await writeRec({ path, body: '', tag: old.tag, dirty: true, deleted: true, mtime: Date.now() });
  else await dropRec(path);
  emit({ type: 'del', path });
  scheduleSync();
}
export async function allRecs() { return tx('files', 'readonly', s => s.getAll()); }
export async function list(prefix = '') {
  const out = [];
  for (const [path, m] of await index()) if (!m.deleted && path.startsWith(prefix)) out.push(path);
  return out.sort();
}
export async function kvGet(k) { return tx('kv', 'readonly', s => s.get(k)); }
export async function kvSet(k, v) { return tx('kv', 'readwrite', s => s.put(v, k)); }

// ---------- backends ----------
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
const isText = p => /\.(json|md|txt)$/i.test(p);

function githubBackend(s) {
  const base = `https://api.github.com/repos/${encodeURIComponent(s.ghOwner)}/${encodeURIComponent(s.ghRepo)}`;
  const headers = { Authorization: `Bearer ${s.ghToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function api(path, opt = {}) {
    const r = await fetch(base + path, { ...opt, headers: { ...headers, ...(opt.headers || {}) }, cache: 'no-store' });
    noteTokenExpiry(r);
    if (!r.ok && !(opt.ok || []).includes(r.status)) {
      let msg = '';
      try { msg = (await r.json()).message; } catch { /* no body */ }
      throw new Error(`GitHub ${r.status}: ${msg || r.statusText}`);
    }
    return r;
  }
  let head = null; // { commit, tree } of the branch, or null if the branch does not exist yet
  return {
    name: 'GitHub',
    async list() {
      const ref = await api(`/git/ref/heads/${s.ghBranch}`, { ok: [404, 409] });
      if (!ref.ok) { head = null; return new Map(); }
      const commit = (await ref.json()).object.sha;
      const c = await (await api(`/git/commits/${commit}`)).json();
      head = { commit, tree: c.tree.sha };
      const t = await (await api(`/git/trees/${c.tree.sha}?recursive=1`)).json();
      return new Map(t.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
    },
    async read(path, tag) {
      const r = await api(`/git/blobs/${tag}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      return isText(path) ? r.text() : r.blob();
    },
    // One commit for the whole change set.
    async commit(writes, deletes, message) {
      const tree = [];
      const tags = new Map();
      for (const w of writes) {
        const blob = typeof w.body === 'string' ? new Blob([w.body]) : w.body;
        const b = await (await api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: await blobToBase64(blob), encoding: 'base64' }) })).json();
        tree.push({ path: w.path, mode: '100644', type: 'blob', sha: b.sha });
        tags.set(w.path, b.sha);
      }
      for (const p of deletes) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
      if (!tree.length) return tags;
      if (!head && !writes.length) return tags;
      const body = head ? { base_tree: head.tree, tree } : { tree: tree.filter(e => e.sha) };
      const t = await (await api('/git/trees', { method: 'POST', body: JSON.stringify(body) })).json();
      const c = await (await api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: head ? [head.commit] : [] }) })).json();
      if (head) await api(`/git/refs/heads/${s.ghBranch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
      else await api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${s.ghBranch}`, sha: c.sha }) });
      head = { commit: c.sha, tree: t.sha };
      return tags;
    },
  };
}

// GitHub says in a response header when a token expires. A web page may not always be allowed to read it.
function noteTokenExpiry(r) {
  try {
    const raw = r.headers.get('github-authentication-token-expiration');
    if (!raw) return;
    const d = new Date(raw.replace(' UTC', 'Z').replace(' ', 'T'));
    if (!isNaN(d) && settings().ghTokenExpires !== d.toISOString()) saveSettings({ ghTokenExpires: d.toISOString() });
  } catch { /* header not readable */ }
}
export function tokenDaysLeft() {
  const s = settings();
  if (s.backend !== 'github' || !s.ghTokenExpires) return null;
  const d = new Date(s.ghTokenExpires);
  return isNaN(d) ? null : Math.ceil((d.getTime() - Date.now()) / 86400000);
}

async function folderBackend() {
  const root = await kvGet('folder');
  if (!root) throw new Error('No folder chosen yet.');
  if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Folder access was not allowed.');
  }
  const tagOf = f => `${f.lastModified}:${f.size}`;
  async function dirFor(path, create) {
    const parts = path.split('/'); const name = parts.pop();
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return [d, name];
  }
  async function walk(dir, prefix, out) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') await walk(h, prefix + name + '/', out);
      else out.set(prefix + name, tagOf(await h.getFile()));
    }
  }
  return {
    name: 'Folder',
    async list() { const out = new Map(); await walk(root, '', out); return out; },
    async read(path) {
      const [d, name] = await dirFor(path, false);
      const f = await (await d.getFileHandle(name)).getFile();
      return isText(path) ? f.text() : f;
    },
    async commit(writes, deletes) {
      const tags = new Map();
      for (const w of writes) {
        const [d, name] = await dirFor(w.path, true);
        const h = await d.getFileHandle(name, { create: true });
        const ws = await h.createWritable(); await ws.write(w.body); await ws.close();
        tags.set(w.path, tagOf(await h.getFile()));
      }
      for (const p of deletes) {
        try { const [d, name] = await dirFor(p, false); await d.removeEntry(name); } catch { /* already gone */ }
      }
      return tags;
    },
  };
}

export async function chooseFolder() {
  if (!window.showDirectoryPicker) throw new Error('This browser cannot open folders. Use Chrome or Edge on a computer, or choose GitHub.');
  const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'grandma-library' });
  await kvSet('folder', h);
  return h.name;
}

async function backend() {
  const s = settings();
  if (s.backend === 'github') {
    if (!s.ghOwner || !s.ghRepo || !s.ghToken) throw new Error('GitHub is not set up yet (owner, repository and token are needed).');
    return githubBackend(s);
  }
  if (s.backend === 'folder') return folderBackend();
  return null;
}

// ---------- sync ----------
export const syncState = { busy: false, last: 0, error: '', pending: 0 };
let syncTimer = null;
let syncAgain = false;

let syncDue = 0;
export function scheduleSync(ms = 5000, lazy = false) {
  if (settings().backend === 'browser') return;
  const due = Date.now() + ms;
  if (lazy && syncTimer && syncDue <= due) return; // a sync is already on its way
  clearTimeout(syncTimer);
  syncDue = due;
  syncTimer = setTimeout(() => { syncTimer = null; sync().catch(() => {}); }, ms);
}

async function newerProgress(localBody, remoteBody) {
  try {
    const a = JSON.parse(localBody), b = JSON.parse(remoteBody);
    return (b.updatedAt || 0) > (a.updatedAt || 0) ? 'remote' : 'local';
  } catch { return 'local'; }
}

export async function sync() {
  if (syncState.busy) { syncAgain = true; return; }
  let be;
  try { be = await backend(); } catch (e) { syncState.error = e.message; emit({ type: 'sync' }); throw e; }
  if (!be) return;
  syncState.busy = true; syncState.error = ''; emit({ type: 'sync' });
  let pulled = 0;
  try {
    const remote = await be.list();
    const idx = await index();
    const mine = () => [...idx].filter(([path]) => !path.startsWith('local/'));

    // Pull: files that changed on the other side.
    for (const [path, tag] of remote) {
      const m = idx.get(path);
      if (m && m.tag === tag) continue;
      if (m && m.dirty) {
        if (!path.endsWith('progress.json') || m.deleted) continue; // my change wins
        const body = await be.read(path, tag);
        const local = await getRec(path);
        if (await newerProgress(local.body, body) === 'local') continue;
        await writeRec({ path, body, tag, dirty: false, deleted: false, mtime: Date.now() });
        pulled++; continue;
      }
      const body = await be.read(path, tag);
      await writeRec({ path, body, tag, dirty: false, deleted: false, mtime: Date.now() });
      pulled++;
    }
    // Files removed on the other side.
    for (const [path, m] of mine()) {
      if (!remote.has(path) && m.tag && !m.dirty) { await dropRec(path); pulled++; }
    }
    // Push: my changes, as one commit.
    const dirty = mine().filter(([, m]) => m.dirty);
    const writes = [];
    for (const [path, m] of dirty) if (!m.deleted) { const r = await getRec(path); if (r) writes.push({ path, body: r.body, mtime: r.mtime }); }
    const gone = dirty.filter(([, m]) => m.deleted).map(([path]) => path);
    const deletes = gone.filter(path => remote.has(path));
    if (writes.length || deletes.length) {
      const names = writes.map(w => w.path.split('/').slice(-2).join('/'));
      const msg = names.length === 1 ? `Grandma: ${names[0]}` : `Grandma: ${writes.length} files saved${deletes.length ? `, ${deletes.length} removed` : ''}`;
      const tags = await be.commit(writes, deletes, msg);
      for (const w of writes) {
        const cur = await getRec(w.path);
        if (!cur) continue;
        const unchanged = cur.mtime === w.mtime && !cur.deleted;
        await writeRec({ ...cur, tag: tags.get(w.path) || cur.tag, dirty: !unchanged });
      }
    }
    for (const path of gone) { const m = idx.get(path); if (m && m.deleted) await dropRec(path); }
    syncState.last = Date.now();
  } catch (e) {
    syncState.error = e.message || String(e);
    throw e;
  } finally {
    syncState.busy = false;
    emit({ type: 'sync', pulled });
    if (syncAgain) { syncAgain = false; scheduleSync(1500); }
  }
  return pulled;
}

// With only a token: look through the repositories it can reach, most recently used first,
// and return the one that holds a Grandma library (a branch with journeys in it).
export async function findLibrary(token, branch = 'library') {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const r = await fetch('https://api.github.com/user/repos?per_page=100&sort=pushed', { headers, cache: 'no-store' });
  if (r.status === 401) throw new Error('GitHub does not accept this token. Check that you copied all of it, and that it has not expired.');
  if (!r.ok) throw new Error(`GitHub answered ${r.status}.`);
  const repos = await r.json();
  for (const repo of repos.slice(0, 30)) {
    const t = await fetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${branch}?recursive=1`, { headers, cache: 'no-store' });
    if (!t.ok) continue;
    const tree = (await t.json()).tree || [];
    const journeys = tree.filter(e => /^journeys\/[^/]+\/journey\.json$/.test(e.path)).length;
    if (journeys) return { owner: repo.owner.login, repo: repo.name, branch, journeys };
  }
  throw new Error('No library was found with this token. It must be the token of the repository where your journeys are saved.');
}

export async function testGithub() {
  const s = settings();
  const r = await fetch(`https://api.github.com/repos/${s.ghOwner}/${s.ghRepo}`, { headers: { Authorization: `Bearer ${s.ghToken}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(r.status === 404 ? 'Repository not found, or the token cannot see it.' : `GitHub answered ${r.status}.`);
  const j = await r.json();
  if (j.permissions && !j.permissions.push) throw new Error('The token can read this repository but cannot write to it. Give it "Contents: Read and write".');
  return j;
}

// ---------- journeys ----------
export const pad = n => String(n).padStart(4, '0');
export const jpath = (id, rest = '') => `journeys/${id}/${rest}`;

export async function journeys() {
  const paths = (await list('journeys/')).filter(p => p.endsWith('/journey.json'));
  const out = [];
  for (const p of paths) { const j = await getJSON(p); if (j && j.id) out.push(j); }
  return out.sort((a, b) => (a.created || 0) - (b.created || 0));
}
export const journey = id => getJSON(jpath(id, 'journey.json'));
export const saveJourney = j => putJSON(jpath(j.id, 'journey.json'), j);
export async function sequences(id) {
  const paths = (await list(jpath(id, 'seq/'))).filter(p => p.endsWith('.json'));
  const out = [];
  for (const p of paths) { const s = await getJSON(p); if (s && s.n) out.push(s); }
  return out.sort((a, b) => a.n - b.n);
}
export const saveSequence = (id, s) => putJSON(jpath(id, `seq/${pad(s.n)}.json`), s);
export const progress = async id => (await getJSON(jpath(id, 'progress.json'))) || { seq: 0, part: 0, line: 0, updatedAt: 0 };
export const saveProgress = (id, p) => putJSON(jpath(id, 'progress.json'), { ...p, updatedAt: Date.now() }, { lazy: true });
export async function imagePath(id, n) {
  const ps = await list(jpath(id, `img/${pad(n)}.`));
  return ps[0];
}
export async function deleteJourney(id) {
  for (const p of await list(jpath(id))) await del(p);
  for (const p of await list(`local/${id}/`)) await del(p);
}
