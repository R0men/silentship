import { config } from "../config.js";

/**
 * Dead-man's switch (healthchecks.io format): GET HEALTHCHECK_URL after a crawl where every channel finished,
 * `<url>/fail` after one where any failed. When pings stop, the service raises the alarm — this covers a
 * crawler that hangs or a server that is down, which no alert from inside the process can. A failed ping
 * never fails the crawl; it is only logged. No URL configured — nothing happens.
 */
export async function pingHealthcheck(failed, { url = config.healthcheckUrl, timeoutMs = 5000 } = {}) {
  if (!url) return false;
  const target = failed ? `${url}/fail` : url;
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.warn(`healthcheck ping failed: ${String(err)}`);
    return false;
  }
}
