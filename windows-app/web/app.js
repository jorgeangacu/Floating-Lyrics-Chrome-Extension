// Tarjeta de letras de la app de Windows. Usa las mismas animaciones que la extensión de Chrome;
// la información de lo que suena llega desde Windows a través de la app (MainForm.cs).
(() => {
  const SIZES = [{ fs: 20, w: 320 }, { fs: 26, w: 390 }, { fs: 32, w: 480 }];
  const ANCHOR = 10;   // espacio sobre la línea actual (deja asomar la anterior, difuminada)
  const BOTTOM = 10;
  const PAD = 14;      // margen alrededor de la tarjeta (para su sombra), igual que el padding del body

  const $ = (id) => document.getElementById(id);
  const E = {
    card: $('card'), bg: $('bg'), head: $('head'), art: $('art'), title: $('title'), artist: $('artist'),
    ctrls: $('ctrls'), off: $('off'), ghostBtn: $('ghostBtn'), viewport: $('viewport'), lines: $('lines'),
    status: $('status'), fail: $('fail'), detail: $('detail'), retry: $('retry'), progress: $('progress'), bar: $('bar'),
  };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const h = (tag, cls, ...kids) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };

  // ---------- Ajustes (guardados en esta app) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lf.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('lf.' + k, JSON.stringify(v)); } catch (_) {} },
  };
  const settings = { size: store.get('size', 1), ghost: store.get('ghost', false), offsets: store.get('offsets', {}) };

  let state = { track: null, lyrics: null, media: null };
  let lines = [], activeIdx = -99, builtKey = '';
  let lastArt = { key: '', data: '' };

  // ---------- Comunicación con la app ----------
  const webview = window.chrome && window.chrome.webview;
  const post = (m) => { try { webview.postMessage(m); } catch (_) {} };
  window.addEventListener('error', (e) => post({ type: 'log', text: 'error: ' + e.message + ' @' + e.lineno }));
  window.addEventListener('unhandledrejection', (e) => post({ type: 'log', text: 'promesa: ' + (e.reason && e.reason.message || e.reason) }));
  let fetchId = 0;
  const pending = new Map();

  // Usado por lyrics.js: las peticiones de letras pasan por la app.
  window.hostFetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const id = ++fetchId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Tiempo de espera agotado')); }, 20000);
    pending.set(id, { resolve, reject, timer });
    post({ type: 'fetch', id, url: String(url), headers: opts.headers || {} });
  });

  webview && webview.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.type) return;
    if (m.type === 'media') onMedia(m.state);
    else if (m.type === 'art') onArt(m);
    else if (m.type === 'toggleGhost') toggleGhost();
    else if (m.type === 'fetchResult') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (!m.ok && m.status === 0) p.reject(new Error(m.error || 'Failed to fetch'));
      else p.resolve({ ok: m.ok, status: m.status, json: async () => JSON.parse(m.body) });
    }
  });

  // ---------- Lo que suena (desde Windows) ----------
  function onMedia(m) {
    if (!m || !m.title) {
      state = { track: null, lyrics: null, media: null };
      renderAll();
      return;
    }
    const key = trackKey(m.title, m.artist);
    state.media = { position: m.position, playing: m.playing, rate: m.rate || 1, duration: m.duration, at: m.at };
    if (!state.track || state.track.key !== key) {
      state.track = {
        key, title: m.title, artist: m.artist, album: m.album, duration: m.duration,
        artwork: lastArt.key === key ? lastArt.data : '',
      };
      state.lyrics = { status: 'loading' };
      renderAll();
      requestLyrics();
    } else {
      if (m.duration > 0) state.track.duration = m.duration;
      renderPlay();
    }
  }

  function onArt(m) {
    lastArt = { key: trackKey(m.title, m.artist), data: m.data };
    if (state.track && state.track.key === lastArt.key) {
      state.track.artwork = m.data;
      renderHeader();
    }
  }

  // ---------- Letras (misma búsqueda que la extensión, en lyrics.js) ----------
  const cache = new Map();
  let lyricTimer = 0;
  function requestLyrics() {
    clearTimeout(lyricTimer);
    lyricTimer = setTimeout(() => state.track && loadLyrics(state.track), 350);
  }

  async function loadLyrics(track, force = false) {
    if (!track.key || !track.title) { state.lyrics = { status: 'none' }; renderAll(); return; }
    let res = force ? null : cache.get(track.key);
    if (!res) {
      try {
        res = await findLyrics(track);
        post({ type: 'log', text: `letra de «${track.title}» / «${track.artist}» / ${Math.round(track.duration || 0)} s → ${res.status} (${(res.log || []).join(' · ')})` });
        if (res.status !== 'none' && res.status !== 'error') {
          cache.set(track.key, res);
          if (cache.size > 80) cache.delete(cache.keys().next().value);
        }
      } catch (e) {
        res = { status: 'error', log: [String((e && e.message) || e)] };
      }
    }
    if (!state.track || state.track.key !== track.key) return; // ya cambió la canción
    state.lyrics = res;
    renderAll();
    // Justo al cambiar de canción, NetEase a veces devuelve resultados incompletos: si no se
    // encontró la letra, se vuelve a buscar una vez unos segundos después.
    if (res.status === 'none' && !track.researched) {
      track.researched = true;
      setTimeout(() => {
        if (state.track && state.track.key === track.key && state.lyrics && state.lyrics.status === 'none') loadLyrics(track, true);
      }, 5000);
    }
    // Si el servicio de letras falló (no es que no tenga la letra), se reintenta solo hasta 3 veces.
    if (res.status === 'error') {
      track.retries = (track.retries || 0) + 1;
      if (track.retries <= 3) setTimeout(() => {
        if (state.track && state.track.key === track.key && state.lyrics && state.lyrics.status === 'error') loadLyrics(track, true);
      }, 30000);
    }
  }

  // ---------- Render ----------
  function renderAll() {
    renderHeader();
    buildLines();
    renderStatus();
    renderPlay();
  }

  function renderHeader() {
    const t = state.track;
    E.title.textContent = t ? t.title : 'Letras Flotantes';
    E.artist.textContent = t ? (t.artist || ' ') : 'Esperando reproducción…';
    const url = t && t.artwork ? `url("${t.artwork.replace(/["\\\n]/g, encodeURIComponent)}")` : '';
    E.art.style.backgroundImage = url;
    E.bg.style.backgroundImage = url;
    E.bg.classList.toggle('on', !!url);
    renderOffset();
  }

  function renderStatus() {
    const L = state.lyrics;
    let msg = '';
    if (!state.track) msg = 'Reproduce una canción en cualquier aplicación.';
    else if (!L || L.status === 'loading') msg = 'Buscando letra…';
    else if (L.status === 'none') msg = 'No se encontró la letra de esta canción.';
    else if (L.status === 'instrumental') msg = '♪  Instrumental';
    else if (L.status === 'error') msg = 'No se pudo conectar con el servicio de letras.';
    E.status.textContent = msg;
    E.status.classList.toggle('loading', msg === 'Buscando letra…');
    const failed = !!state.track && !!L && (L.status === 'none' || L.status === 'error');
    E.fail.classList.toggle('on', failed);
    E.detail.textContent = failed && L.log ? L.log.join(' · ') : '';
    const show = lines.length > 0 || (L && L.status === 'plain');
    E.viewport.style.display = show ? '' : 'none';
  }

  function renderPlay() {
    const m = state.media;
    E.card.classList.toggle('paused', !!m && !m.playing);
    E.progress.classList.toggle('hidden', !(m && mediaDuration() > 0));
  }

  function renderOffset() {
    const v = offset();
    E.off.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + ' s';
  }

  function applyGhost() {
    E.card.classList.toggle('ghost', !!settings.ghost);
    E.ghostBtn.classList.toggle('on', !!settings.ghost);
    E.ghostBtn.title = settings.ghost ? 'Quitar modo transparente' : 'Modo transparente';
    post({ type: 'ghost', on: !!settings.ghost });
  }

  function toggleGhost() {
    settings.ghost = !settings.ghost;
    store.set('ghost', settings.ghost);
    applyGhost();
  }

  function applySize() {
    const s = SIZES[settings.size] || SIZES[1];
    E.card.style.setProperty('--fs', s.fs + 'px');
    E.card.style.setProperty('--w', s.w + 'px');
    activeIdx = -99; // recalcula la posición de las líneas
  }

  function buildLines() {
    const L = state.lyrics;
    const key = (state.track ? state.track.key : '') + '|' + (L ? L.status : '') + '|' + (L && L.lines ? L.lines.length : 0);
    if (key === builtKey) return;
    builtKey = key;
    E.lines.replaceChildren();
    E.lines.classList.remove('plain');
    E.viewport.classList.remove('plain');
    E.viewport.style.height = '';
    E.lines.style.setProperty('--y', '0px');
    lines = [];
    activeIdx = -99;

    if (L && L.status === 'synced' && L.lines && L.lines.length) {
      const dur = mediaDuration();
      const arr = [];
      if (L.lines[0].t > 5) arr.push({ t: 0, text: '' }); // intro instrumental
      for (const l of L.lines) {
        const text = (l.text || '').trim();
        const prev = arr[arr.length - 1];
        if (!text && prev && !prev.text) continue;
        arr.push({ t: l.t, text });
      }
      const kept = [];
      for (let i = 0; i < arr.length; i++) {
        const l = arr[i];
        const next = i + 1 < arr.length ? arr[i + 1].t : (dur > l.t ? dur : l.t + 8);
        if (!l.text && (next - l.t < 4 || i === arr.length - 1)) continue; // pausas cortas: sin puntos
        kept.push({ ...l, next });
      }
      for (let i = 0; i < kept.length - 1; i++) kept[i].next = kept[i + 1].t;

      kept.forEach((l, i) => {
        const el = h('div', 'line');
        el.dataset.i = i;
        l.el = el;
        if (!l.text) {
          l.gap = true;
          el.classList.add('gap');
          const dots = h('div', 'dots');
          l.dots = [0, 1, 2].map(() => { const d = h('span', 'dot'); dots.append(d); return d; });
          el.append(dots);
        } else {
          // Reparte el tiempo de la línea entre sus palabras (efecto "karaoke" suave).
          const sing = Math.min(l.next - l.t, Math.max(1.2, l.text.length * 0.085));
          const end = l.t + sing * 0.92;
          const parts = l.text.split(/(\s+)/);
          const total = parts.reduce((a, p) => a + (p.trim() ? p.length + 1 : 0), 0) || 1;
          let acc = 0;
          l.words = [];
          for (const p of parts) {
            if (!p.trim()) { if (p) el.append(document.createTextNode(p)); continue; }
            const s = l.t + (end - l.t) * acc / total;
            acc += p.length + 1;
            const e = l.t + (end - l.t) * acc / total;
            const w = h('span', 'w', p);
            el.append(w);
            l.words.push({ el: w, s, e, p: -1 });
          }
        }
        E.lines.append(el);
        lines.push(l);
      });
    } else if (L && L.status === 'plain' && L.text) {
      E.lines.classList.add('plain');
      E.viewport.classList.add('plain');
      E.lines.append(h('div', 'note', 'Letra sin sincronizar'));
      for (const ln of L.text.split(/\r?\n/)) E.lines.append(h('div', 'line', ln || ' '));
    }
  }

  function layout() {
    if (!lines.length) return;
    const ai = activeIdx < 0 ? 0 : activeIdx;
    lines.forEach((l, i) => {
      const d = i - activeIdx;
      const cl = l.el.classList;
      cl.toggle('active', d === 0);
      cl.toggle('next', activeIdx < 0 ? i === 0 : d === 1);
      cl.toggle('past', d < 0);
      const dist = activeIdx < 0 ? i + 1 : Math.abs(d);
      l.el.style.setProperty('--blur', d === 0 ? '0px' : (dist === 1 ? 0.6 : Math.min(dist, 5) * 0.9) + 'px');
      const rel = i - ai;
      l.el.style.setProperty('--delay', rel <= 0 ? '0ms' : Math.min(rel, 8) * 45 + 'ms');
    });
    const target = lines[ai];
    const next = lines[ai + 1];
    E.lines.style.setProperty('--y', (target.el.offsetTop - ANCHOR) + 'px');
    E.viewport.style.height = (ANCHOR + target.el.offsetHeight + (next ? next.el.offsetHeight : 0) + BOTTOM) + 'px';
  }

  // ---------- Tiempo ----------
  function offset() {
    return (state.track && settings.offsets[state.track.key]) || 0;
  }
  function mediaDuration() {
    const m = state.media;
    if (m && m.duration > 0) return m.duration;
    if (state.track && state.track.duration > 0) return state.track.duration;
    const ld = state.lyrics && state.lyrics.meta && state.lyrics.meta.duration;
    return ld > 0 ? ld : 0;
  }
  // Windows informa la posición y cuándo la midió; mientras suena, se calcula el avance desde entonces.
  function rawTime() {
    const m = state.media;
    if (!m) return 0;
    let t = m.position + (m.playing ? Math.max(0, Date.now() - m.at) / 1000 * (m.rate || 1) : 0);
    const dur = mediaDuration();
    if (dur > 0) t = Math.min(t, dur);
    return t;
  }

  function frame() {
    requestAnimationFrame(frame);
    tick();
  }

  function tick() {
    const raw = rawTime();
    const dur = mediaDuration();
    E.bar.style.setProperty('--p', dur > 0 ? clamp(raw / dur).toFixed(4) : '0');
    if (!lines.length) return;

    const t = raw + offset();
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].t <= t) idx = i; else break; }
    if (idx !== activeIdx) { activeIdx = idx; layout(); }

    const a = lines[idx];
    if (!a) return;
    if (a.gap) {
      const p = clamp((t - a.t) / Math.max(0.1, a.next - a.t - 0.5));
      a.dots.forEach((d, i) => d.style.setProperty('--d', clamp(p * 3 - i).toFixed(3)));
      a.el.classList.toggle('ending', a.next - t < 0.5);
    } else {
      for (const w of a.words) {
        const q = Math.round(clamp((t - w.s) / Math.max(0.05, w.e - w.s)) * 100) / 100;
        if (q !== w.p) { w.p = q; w.el.style.setProperty('--wp', q); }
      }
    }
  }

  // ---------- Interacción ----------
  E.ctrls.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    const act = b.dataset.act;
    if (act === 'minus' || act === 'plus') setOffset(offset() + (act === 'plus' ? 0.5 : -0.5));
    else if (act === 'size') { settings.size = (settings.size + 1) % SIZES.length; store.set('size', settings.size); applySize(); }
    else if (act === 'ghost') toggleGhost();
  });

  function setOffset(v) {
    const k = state.track && state.track.key;
    if (!k) return;
    v = Math.round(v * 10) / 10;
    const o = { ...settings.offsets };
    if (v) o[k] = v; else delete o[k];
    const keys = Object.keys(o);
    if (keys.length > 300) delete o[keys[0]];
    settings.offsets = o;
    store.set('offsets', o);
    renderOffset();
  }

  // Clic en una línea: salta a ese momento (si la aplicación que suena lo permite).
  E.lines.addEventListener('click', (e) => {
    const el = e.target.closest('.line');
    if (!el || el.dataset.i == null) return;
    const l = lines[+el.dataset.i];
    if (!l) return;
    const time = Math.max(0, l.t - offset() + 0.05);
    post({ type: 'seek', time });
    if (state.media) state.media = { ...state.media, position: time, at: Date.now() };
  });

  E.retry.addEventListener('click', () => {
    if (!state.track) return;
    cache.delete(state.track.key);
    lrclibDownUntil = 0;
    state.lyrics = { status: 'loading' };
    renderStatus();
    loadLyrics(state.track, true);
  });

  // Arrastrar la ventana desde la cabecera.
  E.head.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    post({ type: 'drag' });
  });

  // La ventana toma el tamaño de la tarjeta.
  new ResizeObserver(() => {
    post({ type: 'size', w: E.card.offsetWidth + PAD * 2, h: E.card.offsetHeight + PAD * 2 });
  }).observe(E.card);

  // ---------- Inicio ----------
  applySize();
  applyGhost();
  renderAll();
  requestAnimationFrame(frame);
  setInterval(() => { if (document.hidden) tick(); }, 500); // respaldo si no se dibujan cuadros
  post({ type: 'ready' });
  post({ type: 'log', text: 'tarjeta lista ' + E.card.offsetWidth + 'x' + E.card.offsetHeight });
})();
