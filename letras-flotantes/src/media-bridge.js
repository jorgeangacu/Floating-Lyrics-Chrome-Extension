// Puente (mundo aislado): reenvía lo que detecta media-main.js al service worker
// y entrega a la página los comandos que llegan de la extensión.
(() => {
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  if (window.__lfBridgeAlive && window.__lfBridgeAlive()) return;
  window.__lfBridgeAlive = alive;

  const onOut = (e) => {
    if (!alive()) { document.removeEventListener('__lf:out', onOut); return; }
    let data;
    try { data = JSON.parse(e.detail); } catch (_) { return; }
    try { chrome.runtime.sendMessage({ type: 'MEDIA_UPDATE', data }).catch(() => {}); } catch (_) {}
  };
  document.addEventListener('__lf:out', onOut);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'MEDIA_COMMAND') {
      document.dispatchEvent(new CustomEvent('__lf:in', { detail: JSON.stringify(msg.command) }));
    }
  });

  // Pide un estado inicial (útil si se inyecta en una pestaña ya abierta).
  document.dispatchEvent(new CustomEvent('__lf:in', { detail: JSON.stringify({ action: 'ping' }) }));
})();
