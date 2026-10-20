/** Normalises a user-pasted website ("example.com", "https://www.example.com/x") or returns null. */
export function normaliseWebsite(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
  if (u.username || u.password) return null;
  return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")}`;
}

export function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
