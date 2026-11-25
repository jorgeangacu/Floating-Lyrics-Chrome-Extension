// Superposición flotante con la letra (solo en el frame principal de cada pestaña).
// Se muestra en todas las pestañas mientras esté activada, hasta que el usuario la oculte.
(() => {
  if (window.top !== window) return;
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  if (window.__lfOverlayAlive && window.__lfOverlayAlive()) return;
  window.__lfOverlayAlive = alive;
  document.querySelectorAll('letras-flotantes').forEach((n) => n.remove());

  const SIZES = [{ fs: 20, w: 320 }, { fs: 26, w: 390 }, { fs: 32, w: 480 }];
  const ANCHOR = 10;   // espacio sobre la línea actual (deja asomar la anterior, difuminada)
  const BOTTOM = 10;

  const HOST_CSS = [
    'all:initial', 'position:fixed', 'inset:auto', 'left:0', 'top:0', 'width:0', 'height:0',
    'margin:0', 'padding:0', 'border:0', 'background:transparent', 'overflow:visible',
    'z-index:2147483647', 'display:block', 'pointer-events:none', 'color-scheme:dark',
  ].map((r) => r + ' !important').join(';');

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .card {
    --fs: 26px; --w: 390px;
    position: fixed; left: 0; top: 0;
    width: var(--w); max-width: calc(100vw - 8px);
    pointer-events: auto; color: #fff;
    font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    border-radius: 24px; overflow: hidden; isolation: isolate;
    background: transparent; /* el fondo va en .backdrop, para poder difuminar sus bordes */
    backdrop-filter: blur(34px) saturate(1.7); -webkit-backdrop-filter: blur(34px) saturate(1.7);
    box-shadow: 0 24px 70px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.09);
    user-select: none;
    animation: lf-in .55s cubic-bezier(.2,.9,.25,1);
  }
  .card.dragging { cursor: grabbing; }
  .card { transition: opacity .9s ease, backdrop-filter .9s ease, -webkit-backdrop-filter .9s ease, background-color .9s ease, box-shadow .9s ease; }
  /* Capa de fondo: color oscuro + colores de la carátula + sombreado. */
  .backdrop {
    position: absolute; inset: 0; z-index: -1; overflow: hidden; border-radius: 24px;
    filter: blur(0px);
    transition: inset .9s ease, border-radius .9s ease, filter .9s ease;
  }
  .tint { position: absolute; inset: 0; background: rgb(20, 20, 28); opacity: .58; transition: opacity .9s ease; }
  /* Modo transparente: el fondo queda al 40 % de su opacidad normal, sin desenfoque, y sus bordes
     se difuminan desde totalmente transparente hasta ese 40 %. La letra y la cabecera quedan al 80 %
     para que se sigan leyendo bien. Al pasar el mouse todo vuelve despacio a su aspecto normal. */
  .card .bg { transition: opacity 1.2s ease; }
  .shade, .head, .viewport, .progress, .status, .fail { transition: opacity .9s ease, filter .9s ease, height .6s cubic-bezier(.2,.9,.25,1), margin .25s ease; }
  .card.ghost:not(:hover):not(.dragging) {
    box-shadow: 0 24px 70px rgba(0,0,0,0), 0 2px 8px rgba(0,0,0,0), inset 0 0 0 1px rgba(255,255,255,0);
    backdrop-filter: blur(0px) saturate(1); -webkit-backdrop-filter: blur(0px) saturate(1);
  }
  /* Bordes difuminados y redondeados: la capa de fondo se encoge un poco y se desenfoca, así
     se desvanece hacia el borde de la tarjeta (casi totalmente transparente en el borde). */
  .card.ghost:not(:hover):not(.dragging) .backdrop { inset: 20px; border-radius: 34px; filter: blur(11px); }
  /* La barra de tiempo no se muestra en modo transparente. */
  .card.ghost:not(:hover):not(.dragging) .progress { opacity: 0; }
  .card.ghost:not(:hover):not(.dragging) .tint { opacity: calc(.58 * .4); }
  .card.ghost:not(:hover):not(.dragging) .bg.on { opacity: calc(.95 * .4); }
  .card.ghost:not(:hover):not(.dragging) .shade { opacity: .4; }
  .card.ghost:not(:hover):not(.dragging) :is(.head, .viewport, .status, .fail) {
    opacity: .8;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,.55));
  }
  .card.ghost:not(:hover):not(.dragging) .line.next { opacity: .72; }
  button.on { background: rgba(255,255,255,.22); }
  @keyframes lf-in { from { opacity: 0; transform: translateY(-10px) scale(.96); } }

  .bg {
    position: absolute; inset: -45%;
    background-size: cover; background-position: center;
    filter: blur(48px) saturate(1.9) brightness(.75);
    opacity: 0; transition: opacity 1.2s ease;
    animation: lf-spin 38s linear infinite;
  }
  .bg.on { opacity: .95; }
  .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.12), rgba(0,0,0,.38)); }
  @keyframes lf-spin { to { transform: rotate(360deg) scale(1.1); } }

  .head { display: flex; align-items: center; gap: 10px; padding: 12px 12px 2px 14px; cursor: grab; }
  .art {
    width: 38px; height: 38px; flex: none; border-radius: 8px;
    background: rgba(255,255,255,.12) center / cover no-repeat;
    box-shadow: 0 4px 14px rgba(0,0,0,.35);
  }
  .meta { min-width: 0; flex: 1; }
  .title, .artist { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title { font-size: 13px; font-weight: 650; letter-spacing: -.005em; }
  .artist { font-size: 12px; opacity: .62; margin-top: 1px; }
  /* Los controles flotan sobre la cabecera y solo aparecen al pasar el mouse,
     así el título y el artista usan todo el ancho. */
  .head { position: relative; }
  .ctrls {
    position: absolute; right: 10px; top: 50%; transform: translateY(-40%);
    display: flex; align-items: center; gap: 1px; padding: 2px 4px; border-radius: 999px;
    background: rgba(28, 28, 36, .78); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 4px 14px rgba(0,0,0,.3);
    opacity: 0; pointer-events: none; transition: opacity .25s ease;
  }
  .card:hover .ctrls { opacity: 1; pointer-events: auto; }
  .pipbtn {
    position: absolute; right: 8px; bottom: 5px; z-index: 2;
    background: rgba(28, 28, 36, .78); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 4px 14px rgba(0,0,0,.3);
    opacity: 0; pointer-events: none; transition: opacity .25s ease, background .2s ease;
  }
  .card:hover .pipbtn { opacity: 1; pointer-events: auto; }
  .card.has-pip:hover .progress { margin-right: 44px; }
  button {
    all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 50%;
    display: grid; place-items: center; font: 600 12px/1 system-ui, sans-serif; color: rgba(255,255,255,.88);
    transition: background .2s ease;
  }
  button:hover { background: rgba(255,255,255,.16); }
  .off { font: 600 10.5px/1 system-ui, sans-serif; opacity: .7; min-width: 34px; text-align: center; font-variant-numeric: tabular-nums; }

  .viewport {
    position: relative; overflow: hidden; height: 110px; padding: 0 22px;
    transition: height .6s cubic-bezier(.2,.9,.25,1), opacity .4s ease;
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 ${ANCHOR - 4}px, #000 calc(100% - 12px), transparent 100%);
            mask-image: linear-gradient(to bottom, transparent 0, #000 ${ANCHOR - 4}px, #000 calc(100% - 12px), transparent 100%);
  }
  .card.paused .viewport { opacity: .62; }
  .lines { --y: 0px; position: relative; }
  .line {
    font-size: var(--fs); line-height: 1.2; font-weight: 760; letter-spacing: -.012em;
    padding: 6px 0; overflow-wrap: anywhere; cursor: pointer;
    transform-origin: left center;
    transform: translate3d(0, calc(var(--y) * -1), 0) scale(.955);
    opacity: .22;
    filter: blur(var(--blur, 0px)) drop-shadow(0 0 var(--glow, 0px) rgba(255,255,255,.35));
    transition:
      transform .85s cubic-bezier(.19,.86,.24,1) var(--delay, 0ms),
      opacity .55s ease, filter .55s ease;
    will-change: transform;
  }
  .line.past { opacity: .16; }
  .line.next { opacity: .48; }
  .line.active { opacity: 1; --glow: 10px; transform: translate3d(0, calc(var(--y) * -1), 0) scale(1); }
  .line:not(.active):hover { opacity: .7; --blur: 0px !important; }

  .w { color: #fff; }
  .line.active .w {
    display: inline-block; color: transparent;
    background: linear-gradient(90deg, #fff calc(var(--wp, 0) * 125% - 25%), rgba(255,255,255,.38) calc(var(--wp, 0) * 125%));
    -webkit-background-clip: text; background-clip: text;
    transform: translateY(calc(var(--wp, 0) * -1.5px));
    transition: transform .3s ease;
  }

  .line.gap { padding: 14px 0 12px; }
  .dots { display: flex; gap: 8px; transform-origin: left center; animation: lf-breathe 2.6s ease-in-out infinite; transition: transform .45s ease, opacity .45s ease; }
  .dot { width: calc(var(--fs) * .36); height: calc(var(--fs) * .36); border-radius: 50%; background: #fff; opacity: calc(.28 + .72 * var(--d, 0)); }
  .line.gap.ending .dots { transform: scale(1.25); opacity: 0; animation: none; }
  @keyframes lf-breathe { 50% { transform: scale(1.12); } }

  .lines.plain .line { transform: none; opacity: .85; filter: none; font-size: calc(var(--fs) * .66); font-weight: 650; padding: 3px 0; cursor: default; }
  .viewport.plain { height: 230px !important; overflow-y: auto; scrollbar-width: none; padding-top: 8px; -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent); }
  .viewport.plain::-webkit-scrollbar { display: none; }
  .note { font: 600 11px/1.4 system-ui, sans-serif; opacity: .55; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }

  .status { padding: 10px 22px 14px; font-size: 15px; font-weight: 650; opacity: .78; line-height: 1.35; }
  .status:empty { display: none; }
  .fail { display: none; align-items: center; gap: 10px; padding: 0 22px 14px; margin-top: -6px; }
  .fail.on { display: flex; }
  .detail { flex: 1; min-width: 0; font: 500 11px/1.4 system-ui, sans-serif; opacity: .55; user-select: text; }
  .retry { width: auto; height: auto; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,.16); font: 600 12px/1 system-ui, sans-serif; white-space: nowrap; }
  .retry:hover { background: rgba(255,255,255,.26); }
  .status.loading { animation: lf-pulse 1.4s ease-in-out infinite; }
  @keyframes lf-pulse { 50% { opacity: .4; } }

  .progress { height: 3px; margin: 2px 16px 12px; border-radius: 3px; background: rgba(255,255,255,.16); overflow: hidden; }
  .progress.hidden { visibility: hidden; }
  .bar { height: 100%; transform-origin: left; transform: scaleX(var(--p, 0)); background: rgba(255,255,255,.85); border-radius: 3px; }
  `;

  const settings = { enabled: false, pos: null, size: 1, offsets: {}, ghost: false };
  let state = { track: null, lyrics: null, media: null, hasSource: false };
  let host = null, E = {}, mounted = false, raf = 0, frameN = 0;
  let lines = [], activeIdx = -99, builtKey = '', dragging = false;
  // Ventana flotante (Document Picture-in-Picture): siempre encima, aunque Chrome esté minimizado.
  let shadow = null, pipWin = null, rafWin = window;
  const PIP_OK = 'documentPictureInPicture' in window;

  let pageZoom = 1;
  // Ancho de la ventana (no el de la página), menos un margen fijo para la barra de
  // desplazamiento: así la tarjeta queda en el mismo sitio haya o no barra.
  const SCROLLBAR_GUTTER = 16;
  const viewW = () => innerWidth * pageZoom - SCROLLBAR_GUTTER;
  const viewH = () => innerHeight * pageZoom;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const h = (tag, cls, ...kids) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };
  const send = (msg) => {
    if (!alive()) return Promise.resolve(null);
    try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch (_) { return Promise.resolve(null); }
  };

  // ---------- Ajustes ----------
  chrome.storage.local.get(['enabled', 'pos', 'size', 'offsets', 'ghost', 'pip']).then((s) => {
    settings.ghost = !!s.ghost;
    settings.pipElsewhere = !!s.pip;
    settings.enabled = !!s.enabled;
    settings.pos = s.pos || null;
    settings.size = Number.isInteger(s.size) ? s.size : 1;
    settings.offsets = s.offsets || {};
    apply();
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.size) { settings.size = ch.size.newValue ?? 1; applySize(); }
    if (ch.offsets) { settings.offsets = ch.offsets.newValue || {}; renderOffset(); }
    if (ch.ghost) { settings.ghost = !!ch.ghost.newValue; applyGhost(); }
    if (ch.pip) { settings.pipElsewhere = !!ch.pip.newValue; applyPipHide(); }
    if (ch.pos && !dragging) { settings.pos = ch.pos.newValue || null; placeCard(); }
    if (ch.enabled) { settings.enabled = !!ch.enabled.newValue; apply(); }
  });

  function apply() {
    if (settings.enabled) { mount(); refresh(); } else unmount();
  }

  async function refresh() {
    const s = await send({ type: 'GET_STATE' });
    if (s) setState(s);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'PIP_PING') { sendResponse({ open: !!pipWin }); return; }
    if (!mounted || !msg) return;
    if (msg.type === 'LF_STATE' || msg.type === 'LF_MEDIA') lastMsgAt = Date.now();
    if (msg.type === 'LF_ZOOM') syncZoom(msg);
    else if (msg.type === 'LF_STATE') setState(msg.state);
    else if (msg.type === 'LF_MEDIA') {
      if (state.track && msg.trackKey === state.track.key) { state.media = msg.media; renderPlay(); }
      else refresh();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (mounted && document.visibilityState === 'visible') refresh();
  });
  document.addEventListener('fullscreenchange', () => setTimeout(showTop, 60));
  let lastDpr = window.devicePixelRatio;
  window.addEventListener('resize', () => {
    placeCard();
    // Un cambio de devicePixelRatio indica cambio de zoom: confirma el valor real.
    if (mounted && window.devicePixelRatio !== lastDpr) {
      lastDpr = window.devicePixelRatio;
      syncZoom(null); // respuesta inmediata con la medición real
      send({ type: 'GET_ZOOM' }).then(syncZoom); // y recalibra con lo que dice Chrome
    }
  });

  // ---------- Montaje ----------
  function mount() {
    if (mounted || !alive()) return;
    mounted = true;
    host = document.createElement('letras-flotantes');
    host.style.cssText = HOST_CSS;
    shadow = host.attachShadow({ mode: 'closed' });
    const style = h('style');
    style.textContent = CSS;

    const btn = (act, label, title) => { const b = h('button', null, label); b.dataset.act = act; b.title = title; return b; };
    E.bg = h('div', 'bg');
    E.art = h('div', 'art');
    E.title = h('div', 'title');
    E.artist = h('div', 'artist');
    E.off = h('span', 'off', '0.0 s');
    E.off.title = 'Ajuste de sincronía para esta canción';
    E.ctrls = h('div', 'ctrls',
      btn('minus', '−', 'Retrasar letra 0.5 s'), E.off, btn('plus', '+', 'Adelantar letra 0.5 s'),
      btn('size', 'Aa', 'Tamaño del texto'), (E.ghostBtn = btn('ghost', '◐', 'Modo transparente')));
    // Botón de ventana flotante: abajo a la derecha, aparece al pasar el mouse.
    if (PIP_OK) {
      E.pipBtn = btn('pip', '⧉', 'Ventana flotante (visible aunque minimices Chrome)');
      E.pipBtn.classList.add('pipbtn');
      E.pipBtn.addEventListener('click', (e) => { e.stopPropagation(); if (alive()) togglePip(); });
    }
    E.head = h('div', 'head', E.art, h('div', 'meta', E.title, E.artist), E.ctrls);
    E.lines = h('div', 'lines');
    E.viewport = h('div', 'viewport', E.lines);
    E.status = h('div', 'status');
    E.detail = h('div', 'detail');
    E.retry = h('button', 'retry', 'Reintentar');
    E.retry.addEventListener('click', () => {
      send({ type: 'RETRY' });
      state.lyrics = { status: 'loading' };
      renderStatus();
    });
    E.fail = h('div', 'fail', E.detail, E.retry);
    E.bar = h('div', 'bar');
    E.progress = h('div', 'progress hidden', E.bar);
    E.card = h('div', 'card', h('div', 'backdrop', h('div', 'tint'), E.bg, h('div', 'shade')), E.head, E.viewport, E.status, E.fail, E.progress, E.pipBtn || null);
    if (E.pipBtn) E.card.classList.add('has-pip');
    shadow.append(style, E.card);

    E.ctrls.addEventListener('click', onCtrl);
    E.head.addEventListener('pointerdown', onDragStart);
    E.lines.addEventListener('click', onLineClick);

    attachHost();
    applySize();
    applyGhost();
    applyZoom();
    send({ type: 'GET_ZOOM' }).then(syncZoom);
    renderAll();
    applyPipHide();
    rafWin = window;
    raf = rafWin.requestAnimationFrame(frame);
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    if (pipWin) {
      const w = pipWin;
      pipWin = null;
      try { w.close(); } catch (_) {}
      send({ type: 'PIP', open: false });
    }
    try { rafWin.cancelAnimationFrame(raf); } catch (_) {}
    rafWin = window;
    if (guard) { guard.disconnect(); guard = null; }
    if (host) host.remove();
    host = null; E = {}; lines = []; activeIdx = -99; builtKey = '';
  }

  // Inserta la tarjeta y vigila que la página no la elimine (algunos sitios reescriben el
  // <html> al cargar o al navegar sin recargar); si pasa, la vuelve a poner al instante.
  let guard = null, reattachTimes = [];
  function attachHost() {
    if (!mounted || !host) return;
    const parent = document.documentElement || document.body;
    if (!parent) { document.addEventListener('readystatechange', attachHost, { once: true }); return; }
    if (!host.isConnected) parent.appendChild(host);
    showTop();
    if (guard) guard.disconnect();
    guard = new MutationObserver(() => {
      if (!mounted || !host || host.isConnected) return;
      // Evita pelear sin fin con una página que la quite una y otra vez:
      // si pasa más de 20 veces en 5 s, queda la revisión periódica (cada ~1,5 s).
      const now = Date.now();
      reattachTimes = reattachTimes.filter((t) => now - t < 5000);
      if (reattachTimes.length >= 20) return;
      reattachTimes.push(now);
      attachHost();
    });
    guard.observe(document, { childList: true });
    if (document.documentElement) guard.observe(document.documentElement, { childList: true });
  }

  // Usa la "top layer" (popover) para quedar encima incluso de videos en pantalla completa.
  function showTop() {
    if (!mounted || !host || typeof host.showPopover !== 'function') return;
    try {
      if (!host.hasAttribute('popover')) host.setAttribute('popover', 'manual');
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch (_) {}
  }

  // ---------- Render ----------
  function setState(s) {
    state = { ...state, ...s };
    if (!mounted) return;
    renderAll();
  }

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
    if (!state.track) msg = 'Reproduce una canción o un video en cualquier pestaña.';
    else if (!L || L.status === 'loading' || L.status === 'pending') msg = 'Buscando letra…';
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
    if (!mounted) return;
    const m = state.media;
    E.card.classList.toggle('paused', !!m && !m.playing);
    E.progress.classList.toggle('hidden', !(m && mediaDuration() > 0));
  }

  function renderOffset() {
    if (!mounted) return;
    const v = offset();
    E.off.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + ' s';
  }

  // ---------- Ventana flotante ----------
  const PIP_CSS = `
    html, body { margin: 0; height: 100%; overflow: hidden; background: #15151c; }
    .card.in-pip {
      position: relative; left: 0 !important; top: 0 !important;
      width: 100%; max-width: none; min-height: 100vh;
      border-radius: 0; box-shadow: none; animation: none;
      display: flex; flex-direction: column; justify-content: center;
    }
    .card.in-pip .head { position: absolute; top: 0; left: 0; right: 0; }
    .card.in-pip .viewport { margin-top: 40px; }
    .card.in-pip .head { cursor: default; }
    .card.in-pip [data-act="ghost"] { display: none; }
  `;

  // Pasa la tarjeta a una ventana "siempre encima". Debe llamarse desde un clic (Chrome lo exige).
  async function openPip() {
    if (pipWin || !mounted || !PIP_OK) return;
    const s = SIZES[settings.size] || SIZES[1];
    let w;
    try {
      w = await window.documentPictureInPicture.requestWindow({
        width: s.w,
        height: Math.max(170, Math.round(E.card.offsetHeight)),
      });
    } catch (_) { return; }
    if (!mounted) { try { w.close(); } catch (_) {} return; }
    pipWin = w;
    const d = w.document;
    d.title = 'Letras Flotantes';
    const st = d.createElement('style');
    st.textContent = CSS + PIP_CSS;
    d.head.append(st);
    E.card.classList.add('in-pip');
    d.body.append(E.card);
    applyGhost();
    E.pipBtn.classList.add('on');
    E.pipBtn.title = 'Volver la letra a la página';
    w.addEventListener('pagehide', closePipCleanup, { once: true });
    restartLoop(w); // la animación sigue con la ventana flotante aunque la pestaña esté oculta
    w.setInterval(watchdog, 250); // respaldo si la ventana deja de recibir cuadros de animación
    activeIdx = -99;
    send({ type: 'PIP', open: true });
  }

  // Se llama cuando se cierra la ventana flotante (con su ✕ o con el botón ⧉).
  function closePipCleanup() {
    if (!pipWin) return;
    pipWin = null;
    if (mounted && E.card) {
      E.card.classList.remove('in-pip');
      shadow.append(E.card);
      E.pipBtn.classList.remove('on');
      E.pipBtn.title = 'Ventana flotante (visible aunque minimices Chrome)';
      applyGhost();
      placeCard();
      activeIdx = -99;
      restartLoop(window);
    }
    send({ type: 'PIP', open: false });
  }

  function togglePip() {
    if (pipWin) { try { pipWin.close(); } catch (_) {} closePipCleanup(); }
    else openPip();
  }

  function restartLoop(win) {
    try { rafWin.cancelAnimationFrame(raf); } catch (_) {}
    rafWin = win;
    raf = rafWin.requestAnimationFrame(frame);
  }

  // Mientras la ventana flotante está abierta (en cualquier pestaña), no se repite la tarjeta en las páginas.
  function applyPipHide() {
    if (!mounted || !host) return;
    host.style.setProperty('display', settings.pipElsewhere && !pipWin ? 'none' : 'block', 'important');
  }

  function applyGhost() {
    if (!mounted) return;
    E.card.classList.toggle('ghost', !!settings.ghost && !pipWin);
    E.ghostBtn.classList.toggle('on', !!settings.ghost);
    E.ghostBtn.title = settings.ghost ? 'Quitar modo transparente' : 'Modo transparente';
  }

  function applySize() {
    if (!mounted) return;
    const s = SIZES[settings.size] || SIZES[1];
    E.card.style.setProperty('--fs', s.fs + 'px');
    E.card.style.setProperty('--w', s.w + 'px');
    placeCard();
    activeIdx = -99; // fuerza recalcular la posición de las líneas
  }

  function buildLines() {
    const L = state.lyrics;
    const key = (state.track ? state.track.key : '') + '|' + (L ? L.status : '') + '|' + (L && L.lines ? L.lines.length : 0);
    if (key === builtKey) return;
    builtKey = key;
    E.lines.replaceChildren();
    E.lines.classList.remove('plain');
    E.viewport.classList.remove('plain');
    E.lines.style.setProperty('--y', '0px');
    lines = [];
    activeIdx = -99;

    if (L && L.status === 'synced' && L.lines && L.lines.length) {
      const dur = (state.track && state.track.duration) || (state.media && state.media.duration) || 0;
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
    // Último recurso: la duración que informa el servicio de letras para esta canción.
    const ld = state.lyrics && state.lyrics.meta && state.lyrics.meta.duration;
    return ld > 0 ? ld : 0;
  }
  function rawTime() {
    const m = state.media;
    if (!m) return 0;
    let t = m.position + (m.playing ? Math.min((Date.now() - m.at) / 1000, 30) * (m.rate || 1) : 0);
    const dur = mediaDuration();
    if (dur > 0) t = Math.min(t, dur);
    return t;
  }

  // El bucle de animación va con requestAnimationFrame; si Chrome deja de dibujar
  // (p. ej. ventana flotante con Chrome minimizado), un temporizador de respaldo sigue avanzando la letra.
  let lastFrameAt = 0, lastHouseAt = 0, lastMsgAt = 0;
  function frame() {
    raf = rafWin.requestAnimationFrame(frame);
    lastFrameAt = Date.now();
    tick();
  }
  function watchdog() {
    if (mounted && Date.now() - lastFrameAt > 400) tick();
  }

  function tick() {
    if (Date.now() - lastHouseAt > 1500) {
      lastHouseAt = Date.now();
      if (!alive()) {
        try { rafWin.cancelAnimationFrame(raf); } catch (_) {}
        if (pipWin) { try { pipWin.close(); } catch (_) {} pipWin = null; }
        if (host) host.remove();
        mounted = false;
        return;
      }
      if (host && !host.isConnected) attachHost();
      // Si el aviso de "ventana flotante abierta" se perdió (p. ej. al navegar), se reenvía.
      if (pipWin && !settings.pipElsewhere) send({ type: 'PIP', open: true });
      // Con la ventana flotante, si dejan de llegar actualizaciones mientras suena, se piden.
      if (pipWin && state.media && state.media.playing && Date.now() - lastMsgAt > 6000) {
        lastMsgAt = Date.now();
        refresh();
      }
    }
    const raw = rawTime();
    // Barra de progreso: si el reproductor aún no informa la duración (pasa justo al empezar
    // una canción), se usa la conocida para esa canción; si no hay ninguna, la barra va a cero.
    // Nunca se deja el valor de la canción anterior.
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
  function onCtrl(e) {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    const act = b.dataset.act;
    if (!alive()) { unmount(); return; }
    if (act === 'pip') togglePip();
    else if (act === 'minus' || act === 'plus') setOffset(offset() + (act === 'plus' ? 0.5 : -0.5));
    else if (act === 'size') chrome.storage.local.set({ size: (settings.size + 1) % SIZES.length });
    else if (act === 'ghost') {
      settings.ghost = !settings.ghost;
      applyGhost();
      chrome.storage.local.set({ ghost: settings.ghost });
    }
  }

  function setOffset(v) {
    const k = state.track && state.track.key;
    if (!k) return;
    v = Math.round(v * 10) / 10;
    const o = { ...settings.offsets };
    if (v) o[k] = v; else delete o[k];
    const keys = Object.keys(o);
    if (keys.length > 300) delete o[keys[0]];
    settings.offsets = o;
    chrome.storage.local.set({ offsets: o });
    renderOffset();
  }

  function onLineClick(e) {
    const el = e.target.closest('.line');
    if (!el || el.dataset.i == null) return;
    const l = lines[+el.dataset.i];
    if (!l) return;
    const time = Math.max(0, l.t - offset() + 0.05);
    send({ type: 'SEEK', time });
    if (state.media) state.media = { ...state.media, position: time, at: Date.now() };
  }

  function onDragStart(e) {
    if (pipWin || e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    dragging = true;
    // Todo en "unidades de la tarjeta" (px de página × zoom), para que funcione con cualquier zoom.
    const x0 = parseFloat(E.card.style.left) || 0, y0 = parseFloat(E.card.style.top) || 0;
    const cx = e.clientX, cy = e.clientY;
    E.head.setPointerCapture(e.pointerId);
    E.card.classList.add('dragging');
    const move = (ev) => {
      const w = E.card.offsetWidth;
      E.card.style.left = clamp(x0 + (ev.clientX - cx) * pageZoom, 4, Math.max(4, viewW() - w - 4)) + 'px';
      E.card.style.top = clamp(y0 + (ev.clientY - cy) * pageZoom, 4, Math.max(4, viewH() - 60)) + 'px';
    };
    const up = () => {
      E.head.removeEventListener('pointermove', move);
      E.head.removeEventListener('pointerup', up);
      E.head.removeEventListener('pointercancel', up);
      dragging = false;
      E.card.classList.remove('dragging');
      const w = E.card.offsetWidth;
      const span = viewW() - w - 8;
      const left = parseFloat(E.card.style.left) || 0;
      settings.pos = { xr: span > 0 ? clamp((left - 4) / span) : 1, top: parseFloat(E.card.style.top) || 20 };
      if (alive()) chrome.storage.local.set({ pos: settings.pos });
    };
    E.head.addEventListener('pointermove', move);
    E.head.addEventListener('pointerup', up);
    E.head.addEventListener('pointercancel', up);
  }

  function placeCard() {
    if (!mounted || pipWin) return;
    const w = E.card.offsetWidth || (SIZES[settings.size] || SIZES[1]).w;
    const p = settings.pos || { xr: 1, top: 20 };
    E.card.style.left = (4 + clamp(p.xr) * Math.max(0, viewW() - w - 8)) + 'px';
    E.card.style.top = clamp(p.top, 4, Math.max(4, viewH() - 60)) + 'px';
  }

  // ---------- Zoom de la página ----------
  // La tarjeta compensa el zoom de la pestaña (Ctrl + / Ctrl −) para conservar siempre su tamaño.
  // El zoom que Chrome aplica de verdad a esta página se mide con devicePixelRatio:
  //   devicePixelRatio = escala del monitor × zoom real.
  // La escala del monitor se calibra cuando Chrome confirma que él aplica el zoom (modo
  // "automatic"). En modo "manual" (visor de PDF) la página escala su propio contenido y
  // el zoom real que nos afecta es 1, aunque Chrome reporte otro valor.
  let screenScale = null;
  function syncZoom(info) {
    const dpr = window.devicePixelRatio || 1;
    if (info && info.mode === 'automatic' && info.zoom > 0) screenScale = dpr / info.zoom;
    else if (info && info.mode && info.mode !== 'automatic' && screenScale == null) screenScale = dpr;
    if (screenScale == null) return; // aún sin calibrar: no adivinar
    setPageZoom(Math.round((dpr / screenScale) * 100) / 100);
  }

  function setPageZoom(z) {
    z = +z;
    if (!(z > 0) || Math.abs(z - pageZoom) < 0.001) return;
    pageZoom = z;
    applyZoom();
  }
  function applyZoom() {
    if (!mounted || !host) return;
    host.style.setProperty('zoom', String(1 / pageZoom), 'important');
    placeCard();
    activeIdx = -99; // recalcula posiciones de las líneas
  }
})();
