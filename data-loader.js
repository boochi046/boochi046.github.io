/* Stagger fallback requests and cancel losers, including response-body reads. */
const DashboardData = (() => {
  async function download(url, routes, validate, timeoutMs = 12000, delayMs = 300) {
    const controllers = routes.map(() => new AbortController());
    const timers = [];
    try {
      return await Promise.any(routes.map((route, i) => new Promise((resolve, reject) => {
        const start = async () => {
          const controller = controllers[i];
          if (controller.signal.aborted) return reject(Error('Cancelled'));
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          timers.push(timer);
          try {
            const response = await fetch(route(url), {signal: controller.signal, cache: 'no-store'});
            if (!response.ok) throw Error('HTTP ' + response.status);
            const text = await response.text();
            if (!validate(text)) throw Error('Unexpected response');
            resolve(text);
          } catch (error) { reject(error); }
          finally { clearTimeout(timer); }
        };
        if (i === 0) start();
        else timers.push(setTimeout(start, i * delayMs));
      })));
    } catch (error) { throw Error('Data download failed through direct and fallback connections.'); }
    finally { timers.forEach(clearTimeout); controllers.forEach(c => c.abort()); }
  }
  function safeURL(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; }
    catch (error) { return null; }
  }
  return {download, safeURL};
})();
