// Server-side data access. Components on the server call the backend directly; the browser goes through
// the /api rewrite in next.config.mjs.

const API_URL = process.env.API_URL;

export async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Same as apiGet, but a down backend renders an empty page instead of an error page. */
export async function apiGetOr(path, fallback) {
  try {
    return (await apiGet(path)) ?? fallback;
  } catch {
    return fallback;
  }
}
