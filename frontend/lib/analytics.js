/**
 * Umami custom events (`docs/architecture/analytics.md`). The script loads `afterInteractive` and only in
 * production, so an event can fire before it exists: wait a little, then drop it. Blocked or absent script —
 * nothing happens and nothing breaks.
 */
export function track(name, data) {
  let tries = 0;
  const send = () => {
    if (window.umami) window.umami.track(name, data);
    else if (++tries < 20) setTimeout(send, 500);
  };
  send();
}

/** `track`, at most once per visit (browser tab session); storage can be unavailable, then once per call site. */
export function trackOnce(name, data) {
  const key = `umami:${name}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // Private mode or blocked storage: the caller's own guard still keeps it to once per page.
  }
  track(name, data);
}
