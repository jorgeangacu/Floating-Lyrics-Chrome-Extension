// Búsqueda de letras: el mismo código que la extensión de Chrome (src/background.js),
// con las peticiones hechas a través de la app (hostFetch) en lugar de fetch.
const API = 'https://lrclib.net/api/search';
const CLIENT = 'LetrasFlotantes/1.0 (Windows app)';
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
  const r = await hostFetch(u.toString(), { headers: { 'Lrclib-Client': CLIENT } });
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
  const r = await hostFetch(url);
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
