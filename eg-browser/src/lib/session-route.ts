/**
 * Path routes for sessions (the browser otherwise only reads query params):
 *
 *   <base>session/<id>             open the saved session with that id
 *   <base>session/create/<url>     make a session from a datahub or session
 *                                  file at <url> (encoded or not)
 *
 * <base> is Vite's `base` ("/browser/"). The web server must serve index.html
 * for these paths; Vite's dev server already does.
 */

export type SessionRoute =
  | { kind: "open"; id: string }
  | { kind: "create"; url: string };

const BASE = import.meta.env.BASE_URL || "/";

// Only the standalone web app (main.tsx) turns these on: an embedded browser
// (the npm package) must not read or rewrite its host page's address.
let routesEnabled = false;
export function enableSessionRoutes() {
  routesEnabled = true;
}
export function sessionRoutesEnabled() {
  return routesEnabled;
}

export function parseSessionRoute(location: Location): SessionRoute | null {
  if (!location.pathname.startsWith(`${BASE}session/`)) return null;
  const rest = location.pathname.slice(`${BASE}session/`.length);

  if (rest.startsWith("create/")) {
    let url = rest.slice("create/".length);
    try {
      url = decodeURIComponent(url);
    } catch {
      // not encoded; use as is
    }
    // Some servers and proxies collapse "//" in paths: "https:/host" -> "https://host"
    url = url.replace(/^(https?):\/(?!\/)/, "$1://");
    if (!/^https?:\/\//.test(url)) return null;
    // A query string in an unencoded hub URL lands in location.search; the
    // browser's own options (genome, position, ...) are taken out of it.
    const hubParams = new URLSearchParams(location.search);
    for (const own of OWN_PARAMS) hubParams.delete(own);
    const hubQuery = hubParams.toString();
    return { kind: "create", url: hubQuery ? `${url}?${hubQuery}` : url };
  }

  const id = decodeURIComponent(rest.replace(/\/+$/, ""));
  return id && !id.includes("/") ? { kind: "open", id } : null;
}

/** Query params the create route reads for itself. */
export const OWN_PARAMS = ["genome", "position", "noDefaultTracks", "watch"];

export function sessionPath(id: string | null): string {
  return id ? `${BASE}session/${encodeURIComponent(id)}` : BASE;
}

/** Points the address bar at `id` (or the start page) without a new history entry. */
export function showSessionInAddressBar(id: string | null) {
  // Keep a create link that didn't produce a session, so a reload retries it.
  if (!id && window.location.pathname.startsWith(`${BASE}session/create/`)) return;
  const path = sessionPath(id);
  if (window.location.pathname === path && !window.location.search) return;
  window.history.replaceState(window.history.state, "", path + window.location.hash);
}

/**
 * Picks the genome of a datahub: the `genome` (or `metadata.genome`) most of
 * its tracks name. Datahubs downloaded from a session name it on every track.
 */
export function genomeOfHub(tracks: unknown[]): string | null {
  const counts = new Map<string, number>();
  for (const t of tracks as { genome?: unknown; metadata?: { genome?: unknown } }[]) {
    const g = t?.genome ?? t?.metadata?.genome;
    if (typeof g === "string" && g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [g, n] of counts) if (!best || n > counts.get(best)!) best = g;
  return best;
}
