/**
 * Read models change only when a crawl writes, every 10 minutes, but one page costs dozens of round trips to the
 * database (35 ms each from this server). So a result is reused until the live feed's version changes, which it
 * does within seconds of a crawl starting or finishing.
 *
 * Concurrent requests share one build; a failed build is not kept. `versionOf` returning null (the feed has no
 * snapshot yet) means nothing is known about freshness, so nothing is cached.
 */
export function createRunCache(versionOf, maxEntries = 100) {
  let version = null;
  const entries = new Map();
  return function cached(key, build) {
    const current = versionOf();
    if (current === null) return build();
    if (current !== version) {
      version = current;
      entries.clear();
    }
    let result = entries.get(key);
    if (!result) {
      // A release page is up to ~1 MB, and unknown URLs are cached too: never let them grow without bound.
      if (entries.size >= maxEntries) entries.clear();
      result = build().catch((err) => {
        entries.delete(key);
        throw err;
      });
      entries.set(key, result);
    }
    return result;
  };
}
