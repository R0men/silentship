/**
 * The subscriber this browser remembers: the settings token and the email, in localStorage (no cookie). It is
 * saved when the settings open from an email link, after confirming, or after a sign-in code, and removed by
 * "Forget this browser" or when the API no longer accepts the token. Browser only.
 */
const KEY = "silentship.alerts";

export function remembered() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY));
    return v && typeof v.token === "string" ? v : null;
  } catch {
    return null;
  }
}

export function remember(token, email) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ token, email }));
  } catch {
    // Private mode or storage disabled: the email link still works.
  }
}

export function forget() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
