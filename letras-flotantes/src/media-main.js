// Corre en el "MAIN world" de cada página/iframe.
// Detecta qué se está reproduciendo (Media Session + elementos <audio>/<video>)
// y lo comunica al puente (media-bridge.js) mediante eventos del DOM.
(() => {
  if (window.__lfMain) return;
  window.__lfMain = true;

  const OUT = '__lf:out';
  const IN = '__lf:in';
  const known = new Set();
  const hooked = new WeakSet();
  const playingTitle = new WeakMap(); // reproductor -> título de la canción que sonaba en él
  let curTitle = '', titleSince = Date.now();
  // YouTube Music puede reproducir varias canciones seguidas en un mismo reproductor, como una
  // sola pista larga (el tiempo no vuelve a 0). Se anota en qué segundo empezó cada canción.
  let segEl = null, segOffset = 0;
  function markSongStart(newTitle) {
    if (newTitle === curTitle) return;
    curTitle = newTitle;
    titleSince = Date.now();
    const el = pick();
    segEl = el;
    segOffset = el && !el.paused && !el.ended && el.currentTime > 5 ? el.currentTime : 0;
  }
  const handlers = Object.create(null);
  let lastPlayed = null;
  let posState = null;
  let timer = 0;
  let lastSig = '';
  let lastSentAt = 0;
  let hadMedia = false;

  const MEDIA_EVENTS = ['play', 'playing', 'pause', 'seeked', 'ratechange', 'ended', 'durationchange', 'loadedmetadata', 'emptied'];

  function track(el) {
    if (!(el instanceof HTMLMediaElement)) return;
    known.add(el);
    if (hooked.has(el)) return;
    hooked.add(el);
    for (const ev of MEDIA_EVENTS) {
      el.addEventListener(ev, () => {
        if (ev === 'emptied' && el === segEl) segOffset = 0; // nueva fuente: el tiempo vuelve a 0
        if (ev === 'play' || ev === 'playing') {
          lastPlayed = el;
          // Qué canción empezó a sonar en este reproductor.
          try { const md = navigator.mediaSession && navigator.mediaSession.metadata; if (md) playingTitle.set(el, md.title); } catch (_) {}
        }
        schedule();
      }, { passive: true });
    }
    if (known.size > 30) {
      for (const e of known) if (e !== lastPlayed && e.paused && !e.isConnected) known.delete(e);
    }
  }

  // Captura también elementos que nunca se insertan en el DOM (p. ej. Spotify).
  try {
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      try { track(this); lastPlayed = this; } catch (_) {}
      return origPlay.apply(this, arguments);
    };
  } catch (_) {}

  // Algunos reproductores (p. ej. YouTube Music) pasan a la siguiente canción con otro elemento
  // de audio/video que nunca se inserta en la página: se registran todos al crearlos.
  try {
    const origCreate = Document.prototype.createElement;
    Document.prototype.createElement = function () {
      const el = origCreate.apply(this, arguments);
      try { if (el instanceof HTMLMediaElement) track(el); } catch (_) {}
      return el;
    };
  } catch (_) {}
  try {
    const OrigAudio = window.Audio;
    if (OrigAudio) {
      const LfAudio = function () {
        const el = new OrigAudio(...arguments);
        try { track(el); } catch (_) {}
        return el;
      };
      LfAudio.prototype = OrigAudio.prototype;
      window.Audio = LfAudio;
    }
  } catch (_) {}

  // YouTube Music alterna entre dos reproductores al avanzar solo de canción y el segundo puede
  // crearse clonando o con plantillas. Se registra cualquier elemento en cuanto el sitio le asigna
  // una fuente, lo carga o mueve su tiempo.
  try {
    const MP = HTMLMediaElement.prototype;
    for (const prop of ['src', 'srcObject', 'currentTime']) {
      const d = Object.getOwnPropertyDescriptor(MP, prop);
      if (!d || !d.set) continue;
      Object.defineProperty(MP, prop, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set(v) { try { track(this); } catch (_) {} return d.set.call(this, v); },
      });
    }
    const origLoad = MP.load;
    MP.load = function () { try { track(this); } catch (_) {} return origLoad.apply(this, arguments); };
  } catch (_) {}

  document.addEventListener('play', (e) => { track(e.target); if (e.target instanceof HTMLMediaElement) lastPlayed = e.target; schedule(); }, true);
  document.addEventListener('loadedmetadata', (e) => track(e.target), true);

  // Media Session: posición (para reproductores sin elemento accesible) y controles.
  try {
    const P = window.MediaSession && MediaSession.prototype;
    if (P && P.setPositionState) {
      const o = P.setPositionState;
      P.setPositionState = function (s) {
        try {
          const md = navigator.mediaSession && navigator.mediaSession.metadata;
          posState = s && s.duration > 0
            ? { duration: +s.duration, rate: s.playbackRate || 1, position: +s.position || 0, at: Date.now(), title: md ? md.title : '' }
            : null;
          schedule();
        } catch (_) {}
        return o.apply(this, arguments);
      };
    }
    // En cuanto el sitio anuncia otra canción, se marca su inicio (sin esperar al siguiente sondeo).
    const mdDesc = P && Object.getOwnPropertyDescriptor(P, 'metadata');
    if (mdDesc && mdDesc.set) {
      Object.defineProperty(P, 'metadata', {
        configurable: true, enumerable: mdDesc.enumerable, get: mdDesc.get,
        set(v) {
          const r = mdDesc.set.call(this, v);
          try { markSongStart(v && v.title ? v.title : ''); schedule(); } catch (_) {}
          return r;
        },
      });
    }
    if (P && P.setActionHandler) {
      const o = P.setActionHandler;
      P.setActionHandler = function (action, fn) {
        try { handlers[action] = fn; } catch (_) {}
        return o.apply(this, arguments);
      };
    }
  } catch (_) {}

  function candidates() {
    const s = new Set(known);
    for (const e of document.querySelectorAll('video,audio')) s.add(e);
    return s;
  }

  // Puntúa cada elemento para quedarse con el que reproduce la canción de verdad
  // (y no con audios auxiliares que algunos sitios crean, p. ej. silencios en bucle).
  function score(el) {
    const d = Number.isFinite(el.duration) ? el.duration : 0;
    const playing = !el.paused && !el.ended;
    if (!d && !playing) return null;
    let s = 0;
    if (playing) s += 1000;
    if (el.isConnected) s += 150;                 // el reproductor visible de la página
    if (el.readyState >= 3) s += 50;               // tiene datos para sonar
    if (el === lastPlayed) s += 50;
    if (el.ended) s -= 200;                        // la canción anterior, ya terminada
    if (el.loop) s -= 300;                         // sonidos en bucle (no son canciones)
    if (d > 0 && d < 30) s -= 400;                 // efectos o silencios cortos
    if (d) s += Math.min(d, 600) / 6;
    if (el.muted || el.volume === 0) s -= 800;
    if (!(el.currentSrc || el.src || el.srcObject)) s -= 500; // sin fuente: no suena nada
    return s;
  }

  function pick() {
    let best = null, bestScore = -Infinity;
    for (const el of candidates()) {
      const s = score(el);
      if (s != null && s > bestScore) { bestScore = s; best = el; }
    }
    return best;
  }

  // Diagnóstico (para depurar desde la consola de la página): qué elementos hay y cuál se elige.
  window.__lfDebug = () => {
    const chosen = pick();
    return [...candidates()].map((el) => ({
      elegido: el === chosen,
      tipo: el.tagName.toLowerCase(),
      enPagina: el.isConnected,
      tiempo: +(el.currentTime || 0).toFixed(1),
      duracion: Number.isFinite(el.duration) ? Math.round(el.duration) : String(el.duration),
      sonando: !el.paused && !el.ended,
      terminado: el.ended, bucle: el.loop, mudo: el.muted || el.volume === 0,
      datos: el.readyState, fuente: !!(el.currentSrc || el.src || el.srcObject),
      puntos: score(el),
    }));
  };

  function snapshot() {
    const ms = navigator.mediaSession;
    const md = ms && ms.metadata;
    const el = pick();
    if (!el && !md) return null;

    let title = (md && md.title) || '';
    let artist = (md && md.artist) || '';
    const album = (md && md.album) || '';
    let artwork = '';
    if (md && md.artwork && md.artwork.length) {
      let best = null, bw = -1;
      for (const a of md.artwork) {
        const w = parseInt(String(a.sizes || '').split(/x/i)[0], 10) || 0;
        if (w > bw) { bw = w; best = a; }
      }
      if (best && best.src) { try { artwork = new URL(best.src, location.href).href; } catch (_) {} }
    }

    let playing = false, position = 0, duration = 0, rate = 1;
    if (el) {
      playing = !el.paused && !el.ended;
      position = el.currentTime || 0;
      duration = Number.isFinite(el.duration) ? el.duration : 0;
      rate = el.playbackRate || 1;
    }
    // Si el elemento que vemos no está sonando pero el sitio dice que sí (o no hay elemento),
    // se usa la posición que el propio sitio informa a Chrome (la de los controles multimedia),
    // siempre que corresponda a la canción actual.
    const st0 = ms && ms.playbackState;
    const elPlaying = !!el && !el.paused && !el.ended;
    if (title !== curTitle) markSongStart(title); // respaldo si no se detectó al cambiar
    // Pista continua: el tiempo de la canción es el del reproductor menos el segundo en que empezó.
    const continuous = !!el && el === segEl && segOffset > 0;
    if (continuous) {
      if (el.currentTime < segOffset - 1) segOffset = 0;           // el reproductor reinició
      else { position = el.currentTime - segOffset; duration = 0; } // duración real: se toma de otra fuente
    }
    // Si el reproductor acaba de empezar, la canción que suena en él es la actual.
    if (elPlaying && el.currentTime < 5 && title) playingTitle.set(el, title);
    // Reproductor detenido con otra canción mientras el sitio ya reproduce la actual
    // (YouTube Music alterna reproductores): su tiempo no sirve.
    const staleEl = !!el && !elPlaying && st0 === 'playing'
      && (el.ended || (playingTitle.has(el) && playingTitle.get(el) !== title));
    const posFresh = posState && (!posState.title || !title || posState.title === title);
    // Posición informada por el sitio para esta canción (la de los controles de Chrome).
    const posForSong = posFresh && posState.title === title && posState.at >= titleSince - 1000;
    if ((posFresh && (!el || !duration || (!elPlaying && st0 === 'playing'))) || (continuous && segOffset > 0 && posForSong)) {
      const st = ms && ms.playbackState;
      const pl = st && st !== 'none' ? st === 'playing' : playing;
      const p = posState.position + (pl ? (Date.now() - posState.at) / 1000 * posState.rate : 0);
      position = Math.min(p, posState.duration);
      duration = posState.duration;
      rate = posState.rate || 1;
      playing = pl;
    } else if (!el && ms && ms.playbackState === 'playing') {
      playing = true;
    } else if (staleEl) {
      // Solo vemos el reproductor de la canción anterior: el tiempo se cuenta desde que cambió la
      // canción (y se corrige en cuanto aparece el reproductor que suena).
      position = (Date.now() - titleSince) / 1000;
      duration = 0;
      rate = 1;
      playing = true;
    }

    if (!title && el && el.tagName === 'VIDEO' && duration > 0) {
      title = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*[-–|]\s*YouTube.*$/i, '').trim();
    }
    if (!title) return null;
    if (!md && duration > 0 && duration < 30) return null; // ignora clips/efectos cortos

    return { kind: 'state', title, artist, album, artwork, playing, position, duration, rate, at: Date.now() };
  }

  function post(p) {
    try { document.dispatchEvent(new CustomEvent(OUT, { detail: JSON.stringify(p) })); } catch (_) {}
  }

  // Anuncios de YouTube / YouTube Music: no son canciones. Mientras suena uno, la letra se pausa.
  let inAd = false;
  function adPlaying() {
    try { return !!document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting'); }
    catch (_) { return false; }
  }

  function tick(force) {
    timer = 0;
    if (adPlaying()) {
      if (!inAd) { inAd = true; lastSig = ''; post({ kind: 'gone' }); }
      return;
    }
    inAd = false;
    const s = snapshot();
    if (!s) {
      if (hadMedia) { hadMedia = false; lastSig = ''; post({ kind: 'gone' }); }
      return;
    }
    hadMedia = true;
    const sig = [s.title, s.artist, s.playing, Math.round(s.duration), s.artwork, s.rate].join('|');
    const now = Date.now();
    if (force || sig !== lastSig || (s.playing && now - lastSentAt > 2500)) {
      lastSig = sig;
      lastSentAt = now;
      post(s);
    }
  }

  function schedule() {
    if (!timer) timer = setTimeout(() => tick(true), 60);
  }

  setInterval(() => tick(false), 1000);

  // Comandos desde la extensión: saltar a una línea, reproducir/pausar, refrescar.
  document.addEventListener(IN, (e) => {
    let c;
    try { c = JSON.parse(e.detail); } catch (_) { return; }
    const el = pick();
    if (c.action === 'seek') {
      const t = Math.max(0, +c.time || 0);
      if (handlers.seekto) {
        try { handlers.seekto({ action: 'seekto', seekTime: t }); } catch (_) {}
      } else if (el && Number.isFinite(el.duration) && el.duration > 0) {
        el.currentTime = t;
      }
    } else if (c.action === 'toggle') {
      const ms = navigator.mediaSession;
      const playing = el ? !el.paused : (ms && ms.playbackState === 'playing');
      const h = handlers[playing ? 'pause' : 'play'];
      if (h) {
        try { h({ action: playing ? 'pause' : 'play' }); } catch (_) {}
      } else if (el) {
        if (playing) el.pause(); else el.play().catch(() => {});
      }
    }
    schedule();
  });
})();
