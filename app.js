'use strict';
/*
 * Bookmarks AI — link inbox + reader.
 * Google Drive layout (created by Claude, not by this app):
 *   Bookmarks AI/
 *     bookmarks-queue.json   link queue: [{id, url, addedAt}]  ← the app appends and cleans up
 *     Cards/                 "<date> <title> [id].pdf" + ".json" per document;
 *                            "ERROR [id].json" when the page could not be read
 *     Digests/               digest-YYYY-MM-DD-HHMM.json per run
 * The app needs the "drive" scope because it does not create these files itself.
 */

/* ---------- Utilities ---------- */
const $ = (s) => document.querySelector(s);
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const QUEUE_NAMES = ['bookmarks-queue.json', 'bookmarks-ia-cola.json'], CARDS = ['Cards', 'Fichas'], DIGESTS = ['Digests', 'Resúmenes'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SCOPES = 'https://www.googleapis.com/auth/drive';
const V = 'v3:'; // storage key prefix; changing it forces reconnect + relocate

let settings = Object.assign({ clientId: '' }, LS.get('settings', {}));
let docs = LS.get(V + 'docs', {});        // fileId -> card
let digest = LS.get(V + 'digest', null);
let pending = LS.get(V + 'pending', []);  // [{id,url,addedAt,error?,errorFileId?}]
let activeTag = null;
let busyFlag = false;

function setStatus(msg, isError = false) {
  const el = $('#status');
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
}
function setBusy(b) { busyFlag = b; $('#addBtn').disabled = b; $('#syncBtn').disabled = b; }
function normalizeUrl(s) {
  s = (s || '').trim();
  if (!s) return null;
  for (const c of [s, 'https://' + s]) {
    try { const u = new URL(c); if (/^https?:$/.test(u.protocol) && u.hostname.includes('.')) return u.href; } catch {}
  }
  return null;
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
function fmtDate(s) { const d = new Date(s); return isNaN(d) ? (s || '') : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function shortId() { const a = new Uint8Array(6); crypto.getRandomValues(a); return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8); }
const idInName = (name) => { const m = /\[([a-z0-9]{4,16})\]/i.exec(name || ''); return m ? m[1] : null; };

/* ---------- Google: auth ---------- */
let tokenClient = null;
function initGoogle() {
  if (!settings.clientId || !window.google || !google.accounts || !google.accounts.oauth2) return false;
  if (tokenClient && tokenClient._cid === settings.clientId) return true;
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: settings.clientId, scope: SCOPES, callback: () => {} });
  tokenClient._cid = settings.clientId;
  return true;
}
function cachedToken() { const t = LS.get(V + 'gtoken'); return t && t.exp > Date.now() + 60000 ? t.value : null; }
// Call synchronously inside a user tap: it may open Google's sign-in window.
function getToken() {
  const t = cachedToken();
  if (t) return Promise.resolve(t);
  if (!settings.clientId) return Promise.reject(new Error('Set your Google OAuth Client ID in Settings (⚙).'));
  if (!initGoogle()) return Promise.reject(new Error('Google sign-in has not loaded yet. Please try again.'));
  return new Promise((resolve, reject) => {
    tokenClient.callback = (r) => {
      if (r.error) return reject(new Error('Google: ' + r.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPES)) return reject(new Error('You need to grant the Google Drive permission.'));
      LS.set(V + 'gtoken', { value: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 });
      LS.set(V + 'gconsented', true);
      resolve(r.access_token);
    };
    tokenClient.error_callback = (e) => reject(new Error('Google: ' + ((e && e.type) || 'sign-in failed')));
    tokenClient.requestAccessToken({ prompt: LS.get(V + 'gconsented') ? '' : 'consent' });
  });
}

/* ---------- Google Drive ---------- */
async function drive(path, { method = 'GET', body, headers = {}, upload = false, raw = false } = {}) {
  const token = await getToken();
  const base = upload ? 'https://www.googleapis.com/upload/drive/v3/' : 'https://www.googleapis.com/drive/v3/';
  const res = await fetch(base + path, { method, body, headers: { Authorization: 'Bearer ' + token, ...headers } });
  if (res.status === 401) { LS.del(V + 'gtoken'); throw new Error('Your Google session expired. Tap ⟳ to reconnect.'); }
  if (res.status === 404) { LS.del(V + 'loc'); }
  if (!res.ok) throw new Error('Drive ' + res.status + ': ' + (await res.text()).slice(0, 200));
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}
async function listFiles(query, fields = 'id,name,mimeType,modifiedTime,webViewLink') {
  let out = [], pageToken = '';
  do {
    const r = await drive(`files?spaces=drive&pageSize=1000&fields=nextPageToken,files(${fields})&q=${encodeURIComponent(query)}` +
      (pageToken ? '&pageToken=' + pageToken : ''));
    out = out.concat(r.files || []);
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}
// Find the queue and folders (created by Claude).
async function locate() {
  let loc = LS.get(V + 'loc');
  if (loc && loc.queue) return loc;
  const qs = await listFiles(`(${QUEUE_NAMES.map((n) => `name='${n}'`).join(' or ')}) and trashed=false`, 'id,name,parents,createdTime');
  if (!qs.length) throw new Error('Cannot find "Bookmarks AI" in your Drive. Ask Claude to create the folder structure.');
  qs.sort((a, b) => QUEUE_NAMES.indexOf(a.name) - QUEUE_NAMES.indexOf(b.name));
  const root = qs[0].parents && qs[0].parents[0];
  const sub = await listFiles(`'${root}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, 'id,name');
  const byName = Object.fromEntries(sub.map((f) => [f.name.normalize('NFC'), f.id]));
  const pick = (names) => names.map((n) => byName[n.normalize('NFC')]).find(Boolean) || null;
  loc = { queue: qs[0].id, root, cards: pick(CARDS), digests: pick(DIGESTS) };
  LS.set(V + 'loc', loc);
  return loc;
}
async function readJson(fileId) {
  const res = await drive(`files/${fileId}?alt=media`, { raw: true });
  const txt = await res.text();
  return txt.trim() ? JSON.parse(txt) : null;
}
async function readQueue() { const l = await locate(); const d = await readJson(l.queue); return Array.isArray(d) ? d : []; }
async function writeQueue(list) {
  const l = await locate();
  await drive(`files/${l.queue}?uploadType=media`, {
    method: 'PATCH', upload: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list, null, 1),
  });
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

/* ---------- Actions ---------- */
async function addLink(rawUrl) {
  if (busyFlag) return;
  const url = normalizeUrl(rawUrl);
  if (!url) return setStatus('That does not look like a valid URL.', true);
  if (!settings.clientId) { openSettings(); return setStatus('Set up Google Drive first.', true); }
  const known = Object.values(docs).some((d) => d.url === url) || pending.some((p) => p.url === url);
  if (known && !confirm('You already saved this link. Save it again?')) return;
  const tokenP = getToken();
  setBusy(true);
  try {
    await tokenP;
    const item = { id: shortId(), url, addedAt: new Date().toISOString() };
    const queue = await readQueue();
    queue.push(item);
    await writeQueue(queue);
    pending = [item, ...pending.filter((p) => p.id !== item.id)];
    LS.set(V + 'pending', pending);
    $('#url').value = '';
    render();
    setStatus('Saved ✓ It will be processed tonight.');
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
  }
}

async function removePending(p) {
  const tp = getToken();
  setBusy(true);
  try {
    await tp;
    const queue = await readQueue();
    await writeQueue(queue.filter((x) => x.id !== p.id));
    if (p.errorFileId) {
      await drive(`files/${p.errorFileId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }).catch(() => {});
    }
    pending = pending.filter((x) => x.id !== p.id);
    LS.set(V + 'pending', pending);
    render();
  } catch (e) { setStatus(e.message, true); } finally { setBusy(false); }
}

async function sync(interactive) {
  if (busyFlag) return;
  if (!interactive && !cachedToken()) return;
  const tp = getToken();
  setBusy(true);
  try {
    await tp;
    setStatus('Syncing…');
    let loc = await locate();
    if (!loc.cards || !loc.digests) { LS.del(V + 'loc'); loc = await locate(); }

    // Cards: only new or changed ones are downloaded
    const errors = {};   // entryId -> error marker fileId
    const doneIds = new Set();
    if (loc.cards) {
      const files = await listFiles(`'${loc.cards}' in parents and trashed=false`);
      const pdfByBase = {};
      files.filter((x) => x.mimeType === 'application/pdf').forEach((x) => { pdfByBase[x.name.replace(/\.pdf$/i, '')] = x; });
      const jsons = files.filter((x) => /\.json$/i.test(x.name));
      jsons.forEach((x) => {
        const id = idInName(x.name);
        if (!id) return;
        if (/^ERROR\b/i.test(x.name)) errors[id] = x.id; else doneIds.add(id);
      });
      const cardsJson = jsons.filter((x) => !/^ERROR\b/i.test(x.name));
      const todo = cardsJson.filter((x) => !docs[x.id] || docs[x.id]._mod !== x.modifiedTime);
      if (todo.length) setStatus(`Downloading ${todo.length} document(s)…`);
      const got = await pool(todo, 6, (x) => readJson(x.id));
      const next = {};
      cardsJson.forEach((x) => {
        const fresh = got[todo.indexOf(x)];
        const d = fresh ? { ...fresh, _mod: x.modifiedTime } : docs[x.id];
        if (!d) return;
        const pdf = pdfByBase[x.name.replace(/\.json$/i, '')];
        if (pdf && !d.pdfLink) d.pdfLink = pdf.webViewLink;
        next[x.id] = d;
      });
      docs = next;
      LS.set(V + 'docs', docs);
    }

    // Queue: drop processed entries and flag errors
    const queue = await readQueue();
    const left = queue.filter((x) => !doneIds.has(x.id));
    if (left.length !== queue.length) await writeQueue(left);
    pending = left.slice().reverse().map((x) => ({ ...x, error: !!errors[x.id], errorFileId: errors[x.id] || null }));
    LS.set(V + 'pending', pending);

    // Latest digest
    if (loc.digests) {
      const ds = await listFiles(`'${loc.digests}' in parents and trashed=false`, 'id,name,modifiedTime');
      ds.sort((a, b) => b.name.localeCompare(a.name));
      if (ds[0] && (!digest || digest._id !== ds[0].id || digest._mod !== ds[0].modifiedTime)) {
        digest = { ...(await readJson(ds[0].id)), _id: ds[0].id, _mod: ds[0].modifiedTime };
        LS.set(V + 'digest', digest);
      }
    }
    render();
    setStatus('');
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
  }
}

/* ---------- UI ---------- */
function chip(text, onclick, active) {
  const c = document.createElement(onclick ? 'button' : 'span');
  c.className = 'chip' + (active ? ' active' : '');
  c.textContent = text;
  if (onclick) c.onclick = onclick;
  return c;
}

function render() {
  // Latest
  const hasDigest = digest && digest.text;
  $('#digest').hidden = !hasDigest;
  if (hasDigest) {
    $('#digestDate').textContent = fmtDate(digest.date) + (digest.count ? ` · ${digest.count} new` : '');
    $('#digestText').textContent = digest.text;
  }

  // Pending
  $('#pendingBox').hidden = pending.length === 0;
  const errs = pending.filter((p) => p.error).length;
  $('#pendingCount').textContent = `${pending.length} link(s) waiting to be processed` + (errs ? ` · ${errs} failed` : '');
  $('#pendingList').replaceChildren(...pending.map((p) => {
    const li = document.createElement('li');
    if (p.error) li.className = 'err';
    const s = document.createElement('span'); s.textContent = (p.error ? '⚠ ' : '') + p.url;
    const del = document.createElement('button'); del.textContent = 'Remove';
    del.onclick = () => { if (confirm('Remove this link from the queue?')) removePending(p); };
    li.append(s, del);
    return li;
  }));

  // Documents
  const all = Object.values(docs).sort((a, b) => String(b.processed || b.added || '').localeCompare(String(a.processed || a.added || '')));
  const tagCount = new Map();
  all.forEach((d) => (d.tags || []).forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
  if (activeTag && !tagCount.has(activeTag)) activeTag = null;
  $('#tags').replaceChildren(...[...tagCount.entries()].sort((a, b) => b[1] - a[1])
    .map(([t, n]) => chip(`${t} ${n}`, () => { activeTag = activeTag === t ? null : t; render(); }, t === activeTag)));

  const term = $('#search').value.trim().toLowerCase();
  const items = all.filter((d) => {
    if (activeTag && !(d.tags || []).includes(activeTag)) return false;
    return !term || [d.title, d.summary, d.url, ...(d.tags || []), ...(d.key_points || [])].join(' ').toLowerCase().includes(term);
  });
  $('#docCount').textContent = all.length ? `(${items.length}${items.length !== all.length ? ' of ' + all.length : ''})` : '';
  $('#list').replaceChildren(...items.map((d) => {
    const li = document.createElement('li');
    li.className = 'card item';
    const h = document.createElement('h3'); h.textContent = d.title || d.url;
    const host = document.createElement('div'); host.className = 'host';
    host.textContent = hostOf(d.url) + ' · ' + fmtDate(d.processed || d.added);
    const p = document.createElement('p'); p.textContent = d.summary || '';
    const chips = document.createElement('div'); chips.className = 'chips';
    (d.tags || []).forEach((t) => chips.append(chip(t)));
    li.append(h, host, p, chips);
    li.onclick = () => openDetail(d);
    return li;
  }));
  $('#empty').hidden = all.length > 0;
}

function openDetail(d) {
  $('#dTitle').textContent = d.title || d.url;
  $('#dUrl').textContent = d.url; $('#dUrl').href = d.url;
  $('#dDate').textContent = 'Saved ' + fmtDate(d.added) + ' · processed ' + fmtDate(d.processed);
  $('#dTags').replaceChildren(...(d.tags || []).map((t) => chip(t)));
  $('#dSummary').textContent = d.summary || '';
  $('#dPoints').replaceChildren(...(d.key_points || []).map((k) => { const li = document.createElement('li'); li.textContent = k; return li; }));
  $('#dOpen').href = d.url;
  $('#dPdf').hidden = !d.pdfLink;
  if (d.pdfLink) $('#dPdf').href = d.pdfLink;
  $('#detail').showModal();
}

function openSettings() { $('#clientId').value = settings.clientId; $('#settings').showModal(); }
function readSettingsForm() {
  const prev = settings.clientId;
  settings = { clientId: $('#clientId').value.trim() };
  LS.set('settings', settings);
  if (prev !== settings.clientId) ['gtoken', 'gconsented', 'loc'].forEach((k) => LS.del(V + k));
}

function sharedUrl() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return null;
  history.replaceState(null, '', location.pathname);
  const m = [p.get('url'), p.get('text'), p.get('title')].filter(Boolean).join(' ').match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

window.addEventListener('DOMContentLoaded', () => {
  $('#addForm').addEventListener('submit', (e) => { e.preventDefault(); addLink($('#url').value); });
  $('#search').addEventListener('input', render);
  $('#settingsBtn').onclick = openSettings;
  $('#syncBtn').onclick = () => sync(true);
  $('#settingsForm').addEventListener('submit', readSettingsForm);
  $('#connectBtn').onclick = () => { readSettingsForm(); $('#settings').close(); sync(true); };
  $('#dClose').onclick = () => $('#detail').close();

  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  const shared = sharedUrl();
  if (shared) {
    $('#url').value = shared;
    if (cachedToken()) addLink(shared);   // active session: save straight away
    else setStatus('Link received. Tap Save.');
  } else if (settings.clientId && !cachedToken()) {
    setStatus('Tap ⟳ to connect to Google Drive.');
  } else {
    sync(false);
  }
});
