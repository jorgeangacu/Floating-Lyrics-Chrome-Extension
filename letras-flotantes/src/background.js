// Service worker: elige la fuente que está sonando, busca la letra (LRCLIB)
// y envía el estado a la superposición de la pestaña activa.
const API = 'https://lrclib.net/api/search';
const CLIENT = 'LetrasFlotantes/1.0 (Chrome extension)';

let S = { source: null, track: null, media: null, lyrics: null };
let enabled = false;
let pipTabId = null; // pestaña que tiene abierta la ventana flotante (si hay)
const cache = new Map();

const ready = (async () => {
  try {
    const [sess, loc] = await Promise.all([
      chrome.storage.session.get('lf'),
      chrome.storage.local.get(['enabled', 'pip']),
    ]);
    if (sess.lf) S = { ...S, ...sess.lf };
    enabled = !!loc.enabled;
    pipTabId = loc.pip ? loc.pip.tabId : null;
  } catch (_) {}
  updateBadge();
})();

let persistTimer = 0;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => chrome.storage.session.set({ lf: S }).catch(() => {}), 300);
}

// ---------- Utilidades de texto ----------
function norm(s = '') {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const NOISE = /official|oficial|video|vídeo|audio|lyric|letra|visuali[sz]er|music|\bmv\b|m\/v|\bhd\b|\bhq\b|4k|remaster|explicit|videoclip|\bclip\b|en vivo|\blive\b|topic|color coded|feat|\bft\b/i;

function cleanTitle(s = '') {
  return s
    .replace(/[\(\[【「][^\)\]】」]*[\)\]】」]/g, (m) => (NOISE.test(m) ? '' : m))
    .replace(/\s+(?:\||\/\/|•)\s+.*$/, '')
    .replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.*$/i, '')
    .replace(/["“”]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanArtist(s = '') {
  return s
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s+(official|oficial)$/i, '')
    .split(/\s*(?:,|\bfeat\.?|\bft\.?|\s+x\s+|\s+&\s+|\s+y\s+)\s*/i)[0]
    .trim();
}

function trackKey(title, artist) {
  return norm(title) + '|' + norm(artist);
}

// ---------- LRCLIB ----------
function parseLRC(lrc) {
  const out = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function search(params) {
  const u = new URL(API);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { 'Lrclib-Client': CLIENT } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

// Versiones en vivo / acústicas: su duración no se parece a la de estudio.
const LIVE = /\b(live|en vivo|ao vivo|concert|concierto|unplugged|ac[uú]stic[oa]|acoustic|sessions?)\b/i;

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
  return String(n);
}

// "30 Seconds to Mars" = "Thirty Seconds To Mars", "Simon & Garfunkel" = "Simon and Garfunkel",
// "The Killers" = "Killers".
function normArtist(s = '') {
  return norm(s)
    .replace(/\b\d{1,3}\b/g, (d) => numWords(+d))
    .replace(/\band\b|\by\b/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 2 = mismo artista, 1 = coincidencia parcial (p. ej. uno de varios artistas), 0 = distinto.
function artistMatch(itemArtist, wantArtists) {
  const na = normArtist(itemArtist), nac = na.replace(/ /g, '');
  if (!nac) return 0;
  let best = 0;
  for (const w of wantArtists) {
    const wa = normArtist(w), wac = wa.replace(/ /g, '');
    if (wac.length < 2) continue;
    if (na === wa || nac === wac) return 2;
    if (wac.length >= 3 && (nac.includes(wac) || wac.includes(nac))) best = 1;
  }
  return best;
}

function score(item, want) {
  let s = 0;
  if (item.syncedLyrics) s += 4;
  else if (item.plainLyrics) s += 1;
  else if (!item.instrumental) return { s: -99 };

  const dd = want.duration > 0 && item.duration ? Math.abs(item.duration - want.duration) : null;
  if (dd != null && !want.live) s += dd <= 2 ? 4 : dd <= 5 ? 2 : dd <= 12 ? 0 : -4;
  if (want.live && LIVE.test(item.trackName || '')) s += 1;

  // Se compara sin los añadidos tipo "(Live)", "(Remastered)"…
  const nt = norm(cleanTitle(item.trackName || '')), wt = norm(want.title);
  let titleExact = false;
  if (nt && wt) {
    if (nt === wt) { s += 4; titleExact = true; }
    else if (nt.includes(wt) || wt.includes(nt)) s += 2;
    else s -= 3;
  }
  let am = 0;
  if (want.artists.length) {
    am = artistMatch(item.artistName || '', want.artists);
    s += am === 2 ? 3 : am === 1 ? 2 : -2;
  }
  return { s, artistOk: am > 0, titleExact, dd };
}

function makeWant(track, v, vs) {
  return {
    title: v.title,
    artists: [...new Set(vs.map((x) => x.artist).filter(Boolean))],
    duration: track.duration,
    live: LIVE.test(track.title || ''),
    // El artista es fiable si viene del título ("Artista - Canción") o de un reproductor
    // de música (canales "- Topic", YouTube Music, Spotify…), no del nombre de cualquier canal.
    strictArtist: vs.some((x) => x.fromTitle) || /\s-\s*topic$/i.test(track.artist || '') || !!track.album,
  };
}

// Elige entre los candidatos: si alguno es del artista buscado, solo entre esos.
// Uno de otro artista solo vale si el título y la duración coinciden casi exactamente
// (evita, p. ej., tomar "The Kill" de otro artista para "30 Seconds to Mars - The Kill").
function rank(scored, want) {
  const ok = scored.filter((c) => c.r.s >= 4);
  let pool = ok;
  if (want.artists.length) {
    pool = ok.filter((c) => c.r.artistOk);
    if (!pool.length) {
      pool = ok.filter((c) => c.r.titleExact && (want.strictArtist ? c.r.dd != null && c.r.dd <= 3 : true));
    }
  }
  return pool.sort((a, b) => b.r.s - a.r.s);
}

function variants(track) {
  const out = [];
  const t = cleanTitle(track.title);
  const a = cleanArtist(track.artist);
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/); // "Artista - Canción" (típico de YouTube)
  if (m) out.push({ artist: cleanArtist(m[1]), title: cleanTitle(m[2]), fromTitle: true });
  if (t) out.push({ artist: a, title: t });
  const seen = new Set();
  return out.filter((v) => {
    const k = trackKey(v.title, v.artist);
    if (!v.title || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function findLrclib(track) {
  const vs = variants(track);
  if (!vs.length) return { status: 'none' };
  const want0 = makeWant(track, vs[0], vs);
  const scored = [];
  const consider = (items, v) => {
    const want = makeWant(track, v, vs);
    for (const it of items) scored.push({ item: it, r: score(it, want) });
  };

  for (const v of vs) {
    consider(await search(v.artist ? { track_name: v.title, artist_name: v.artist } : { q: v.title }), v);
    const top = rank(scored, want0)[0];
    if (top && top.item.syncedLyrics && top.r.s >= 8) break;
  }
  if (!rank(scored, want0).length) {
    const v = vs[0];
    consider(await search({ q: `${v.artist} ${v.title}`.trim() }), v);
  }
  const top = rank(scored, want0)[0];
  if (!top) return { status: 'none' };
  const best = top.item;
  if (best.instrumental && !best.syncedLyrics && !best.plainLyrics) return { status: 'instrumental' };

  const meta = { title: best.trackName, artist: best.artistName, duration: best.duration || 0 };
  if (best.syncedLyrics) {
    const lines = parseLRC(best.syncedLyrics);
    if (lines.length) return { status: 'synced', lines, meta };
  }
  if (best.plainLyrics) return { status: 'plain', text: best.plainLyrics, meta };
  return { status: 'none' };
}

// ---------- Respaldo: NetEase Cloud Music ----------
const NE = 'https://music.163.com/api';
const CREDIT = /^(作词|作曲|编曲|制作人|制作|混音|母带|和声|吉他|贝斯|鼓|录音|监制|出品|发行|词|曲|op|sp|lyricist|composer|producer|arranger|written by)\s*[:：]/i;

async function neJson(url) {
  const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j && j.code && j.code !== 200) throw new Error('código ' + j.code);
  return j;
}

async function neteaseLyrics(track) {
  const vs = variants(track);
  if (!vs.length) return { status: 'none' };
  const queries = [];
  for (const v of vs) queries.push({ q: `${v.title} ${v.artist}`.trim(), v });
  queries.push({ q: vs[0].title, v: vs[0] }); // solo título, por si el artista no coincide
  const want0 = makeWant(track, vs[0], vs);
  const seenQ = new Set(), seenId = new Set();
  const cands = [];
  for (const { q, v } of queries) {
    if (seenQ.has(q)) continue;
    seenQ.add(q);
    const j = await neJson(`${NE}/search/get?type=1&limit=15&s=${encodeURIComponent(q)}`);
    for (const s of (j.result && j.result.songs) || []) {
      if (seenId.has(s.id)) continue;
      seenId.add(s.id);
      const item = {
        id: s.id,
        trackName: s.name,
        artistName: (s.artists || []).map((a) => a.name).join(', '),
        duration: (s.duration || 0) / 1000,
        syncedLyrics: true, // se asume; se comprueba al descargar
      };
      cands.push({ item, r: score(item, makeWant(track, v, vs)) });
    }
    if (rank(cands, want0).some((c) => c.r.s >= 8)) break;
  }
  let plainRes = null, tried = 0, failed = 0, lastErr = null;
  for (const { item } of rank(cands, want0).slice(0, 5)) {
    let j;
    tried++;
    try { j = await neJson(`${NE}/song/lyric?id=${item.id}&lv=1&tv=-1`); } catch (e) { failed++; lastErr = e; continue; }
    const lrc = (j.lrc && j.lrc.lyric) || '';
    if (!lrc.trim()) continue;
    const meta = { title: item.trackName, artist: item.artistName, duration: item.duration || 0 };
    const lines = parseLRC(lrc).filter((l) => !CREDIT.test(l.text));
    if (lines.some((l) => l.text)) return { status: 'synced', lines, meta };
    const plain = lrc.split(/\r?\n/).filter((l) => l.trim() && !CREDIT.test(l.trim())).join('\n');
    if (plain && !plainRes) plainRes = { status: 'plain', text: plain, meta };
  }
  // Si NetEase rechazó todas las descargas (p. ej. límite de consultas), es un error, no "sin letra".
  if (!plainRes && tried > 0 && failed === tried) throw lastErr;
  return plainRes || { status: 'none', candidates: cands.length };
}

// Prueba LRCLIB y, si no responde (p. ej. bloqueado por un firewall) o no tiene letra, NetEase.
// Devuelve también un registro corto de lo que respondió cada servicio, para diagnóstico.
let lrclibDownUntil = 0;
const errText = (e) => String((e && e.message) || e).replace(/^TypeError:\s*/, '');

async function findLyrics(track) {
  const log = [];
  let first = null;
  if (Date.now() > lrclibDownUntil) {
    try {
      first = await findLrclib(track);
      log.push('LRCLIB: ' + (first.status === 'none' ? 'sin resultados' : first.status));
      if (first.status === 'synced') return { ...first, log };
    } catch (e) {
      log.push('LRCLIB: ' + errText(e));
      lrclibDownUntil = Date.now() + 10 * 60 * 1000; // no reintentar durante 10 min
    }
  } else {
    log.push('LRCLIB: omitido (no respondió hace poco)');
  }
  let second = null, err2 = null;
  try {
    second = await neteaseLyrics(track);
    log.push('NetEase: ' + (second.status === 'none' ? `sin letra (${second.candidates || 0} candidatos)` : second.status));
  } catch (e) {
    err2 = e;
    log.push('NetEase: ' + errText(e));
  }
  if (second && second.status === 'synced') return { ...second, log };
  if (first && first.status !== 'none') return { ...first, log };
  if (second && second.status !== 'none') return { ...second, log };
  if (!first && err2) return { status: 'error', log };
  return { status: 'none', log };
}

let lyricTimer = 0;
function requestLyrics() {
  clearTimeout(lyricTimer);
  lyricTimer = setTimeout(() => S.track && loadLyrics(S.track), 350);
}

async function loadLyrics(track) {
  if (!track.key || !track.title) {
    S.lyrics = { status: 'none' };
    persist();
    pushFull();
    return;
  }
  let res = cache.get(track.key);
  if (!res) {
    try {
      res = await findLyrics(track);
      if (res.status !== 'none' && res.status !== 'error') { // los fallos no se guardan: se reintenta luego
        cache.set(track.key, res);
        if (cache.size > 60) cache.delete(cache.keys().next().value);
      }
    } catch (e) {
      res = { status: 'error', message: String((e && e.message) || e) };
    }
  }
  if (!S.track || S.track.key !== track.key) return;
  S.lyrics = res;
  persist();
  pushFull();
}

// ---------- Estado de reproducción ----------
function fullState() {
  return { track: S.track, lyrics: S.lyrics, media: S.media, hasSource: !!S.source };
}

async function toActiveTabs(msg) {
  if (!enabled) return;
  let tabs = [];
  try { tabs = await chrome.tabs.query({ active: true }); } catch (_) {}
  const ids = new Set(tabs.map((t) => t.id));
  if (pipTabId != null) ids.add(pipTabId); // la ventana flotante necesita la letra aunque su pestaña no esté activa
  for (const id of ids) chrome.tabs.sendMessage(id, msg, { frameId: 0 }).catch(() => {});
}
const pushFull = () => toActiveTabs({ type: 'LF_STATE', state: fullState() });
const pushMedia = () => toActiveTabs({ type: 'LF_MEDIA', trackKey: S.track && S.track.key, media: S.media });

function currentPos() {
  const m = S.media;
  if (!m) return 0;
  return m.position + (m.playing ? Math.min((Date.now() - m.at) / 1000, 30) * (m.rate || 1) : 0);
}

function onMedia(d, sender) {
  if (!sender.tab || !d) return;
  const src = { tabId: sender.tab.id, frameId: sender.frameId || 0 };
  const isCurrent = !!S.source && S.source.tabId === src.tabId && S.source.frameId === src.frameId;

  if (d.kind === 'gone') {
    if (isCurrent && S.media) {
      S.media = { ...S.media, position: currentPos(), at: Date.now(), playing: false };
      persist();
      pushMedia();
    }
    return;
  }
  // Solo cambia de fuente si la nueva está sonando (o si no había ninguna).
  if (!isCurrent) {
    if (!d.playing && S.source) return;
    S.source = src;
  }

  S.media = { position: d.position, playing: d.playing, rate: d.rate || 1, duration: d.duration, at: d.at || Date.now() };
  const key = trackKey(d.title, d.artist);
  if (!S.track || S.track.key !== key) {
    S.track = { key, title: d.title, artist: d.artist, album: d.album, artwork: d.artwork, duration: d.duration };
    S.lyrics = { status: enabled ? 'loading' : 'pending' };
    persist();
    pushFull();
    if (enabled) requestLyrics();
    // Justo al cambiar de canción, algunos reproductores todavía informan el tiempo de la anterior:
    // se vuelve a pedir la posición un poco después para corregirla.
    const k = key;
    for (const ms of [1500, 4000]) {
      setTimeout(() => { if (S.track && S.track.key === k) forward({ action: 'ping' }); }, ms);
    }
  } else {
    let changed = false;
    if (d.artwork && d.artwork !== S.track.artwork) { S.track.artwork = d.artwork; changed = true; }
    if (d.duration && Math.abs((S.track.duration || 0) - d.duration) > 1) { S.track.duration = d.duration; changed = true; }
    persist();
    if (changed) pushFull(); else pushMedia();
  }
}

function forward(command) {
  if (!S.source) return;
  chrome.tabs.sendMessage(S.source.tabId, { type: 'MEDIA_COMMAND', command }, { frameId: S.source.frameId }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ready;
    switch (msg && msg.type) {
      case 'MEDIA_UPDATE': onMedia(msg.data, sender); sendResponse({}); break;
      case 'GET_STATE': sendResponse(fullState()); break;
      case 'SEEK':
        forward({ action: 'seek', time: msg.time });
        if (S.media) { S.media = { ...S.media, position: msg.time, at: Date.now() }; persist(); }
        sendResponse({});
        break;
      case 'COMMAND': forward(msg.command); sendResponse({}); break;
      case 'PIP':
        if (msg.open && sender.tab) setPip(sender.tab.id);
        else if (sender.tab && pipTabId === sender.tab.id) setPip(null);
        sendResponse({});
        break;
      case 'GET_ZOOM': {
        let zoom = 1, mode = 'unknown';
        try {
          if (sender.tab) {
            zoom = await chrome.tabs.getZoom(sender.tab.id);
            mode = (await chrome.tabs.getZoomSettings(sender.tab.id)).mode || 'unknown';
          }
        } catch (_) {}
        sendResponse({ zoom, mode });
        break;
      }
      case 'RETRY':
        if (S.track) {
          cache.delete(S.track.key);
          lrclibDownUntil = 0;
          S.lyrics = { status: 'loading' };
          pushFull();
          loadLyrics(S.track);
        }
        sendResponse({});
        break;
      default: sendResponse(null);
    }
  })();
  return true;
});

// ---------- Ventana flotante ----------
function setPip(tabId) {
  pipTabId = tabId;
  if (tabId == null) chrome.storage.local.remove('pip').catch(() => {});
  else chrome.storage.local.set({ pip: { tabId } }).catch(() => {});
}
// Si la pestaña dueña de la ventana flotante se recarga o navega a otro sitio, la ventana se cierra.
// Pero Chrome avisa "loading" también al pasar al siguiente video de YouTube (sin recargar),
// así que antes de darla por cerrada se le pregunta a la pestaña.
let pipCheckTimer = 0;
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  await ready;
  if (tabId !== pipTabId || info.status !== 'loading') return;
  clearTimeout(pipCheckTimer);
  pipCheckTimer = setTimeout(async () => {
    if (pipTabId !== tabId) return;
    let open = false;
    try { open = !!(await chrome.tabs.sendMessage(tabId, { type: 'PIP_PING' }, { frameId: 0 }) || {}).open; } catch (_) {}
    if (!open) setPip(null);
  }, 1500);
});
chrome.runtime.onStartup.addListener(() => setPip(null));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  if (tabId === pipTabId) setPip(null);
  if (S.source && S.source.tabId === tabId) {
    S = { source: null, track: null, media: null, lyrics: null };
    persist();
    pushFull();
  }
});

// Al cambiar de pestaña, la superposición pide el estado por sí sola (visibilitychange),
// pero lo enviamos también por si la pestaña ya estaba visible.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!enabled) return;
  chrome.tabs.sendMessage(tabId, { type: 'LF_STATE', state: fullState() }, { frameId: 0 }).catch(() => {});
});

// La tarjeta compensa el zoom de cada pestaña para mantener siempre el mismo tamaño.
// En modo "manual" (p. ej. el visor de PDF) es la propia página la que escala su contenido.
chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor, zoomSettings }) => {
  const mode = (zoomSettings && zoomSettings.mode) || 'unknown';
  chrome.tabs.sendMessage(tabId, { type: 'LF_ZOOM', zoom: newZoomFactor, mode }, { frameId: 0 }).catch(() => {});
});

// ---------- Activar / ocultar ----------
function updateBadge() {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#fa2d48' });
  chrome.action.setTitle({ title: enabled ? 'Ocultar letras (Alt+Shift+L)' : 'Mostrar letras (Alt+Shift+L)' });
}

async function toggle() {
  await ready;
  await chrome.storage.local.set({ enabled: !enabled });
}

chrome.action.onClicked.addListener(toggle);
chrome.commands.onCommand.addListener((c) => { if (c === 'toggle-overlay') toggle(); });

chrome.storage.onChanged.addListener(async (ch, area) => {
  if (area !== 'local' || !ch.enabled) return;
  await ready;
  enabled = !!ch.enabled.newValue;
  updateBadge();
  if (enabled) {
    forward({ action: 'ping' });
    if (S.track && (!S.lyrics || S.lyrics.status === 'pending' || S.lyrics.status === 'error')) {
      S.lyrics = { status: 'loading' };
      pushFull();
      requestLyrics();
    }
  }
});

// Inyecta los scripts en las pestañas que ya estaban abiertas al instalar/actualizar.
chrome.runtime.onInstalled.addListener(async () => {
  updateBadge();
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['src/media-main.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['src/media-bridge.js'] });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['src/overlay.js'] });
    } catch (_) { /* páginas protegidas (Chrome Web Store, etc.) */ }
  }
});
