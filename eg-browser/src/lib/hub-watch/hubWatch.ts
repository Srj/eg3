/**
 * Watched datahubs.
 *
 * A watched hub is a JSON datahub the browser re-reads on a timer, syncing the
 * session's tracks whenever it changes (see `HubFileWatcher` and
 * `syncHubTracks`). It is either:
 *
 * - a local file, picked with the File System Access API (Chrome and Edge).
 *   The picker hands back a file handle that can be re-read at any time; or
 * - a URL, fetched with HTTP revalidation, so an unchanged hub costs the server
 *   only a 304. Works in any browser, and relative track URLs resolve against
 *   the hub's location.
 *
 * File handles aren't serializable, so watches live here rather than in Redux.
 * They are saved to IndexedDB so watching resumes after a page reload; a file
 * watch then needs a click to grant read permission again.
 */

// Minimal typings: the File System Access API isn't in TypeScript's DOM lib yet.
type PermissionState = "granted" | "denied" | "prompt";
export interface WatchableFileHandle {
  name: string;
  getFile(): Promise<File>;
  queryPermission?(opts: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(opts: { mode: "read" }): Promise<PermissionState>;
}
type ShowOpenFilePicker = (opts?: {
  types?: { description?: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
}) => Promise<WatchableFileHandle[]>;

export type HubSource =
  | { kind: "file"; handle: WatchableFileHandle }
  | { kind: "url"; url: string };

export interface SyncSummary {
  at: number;
  total: number;
  shown: number;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

export interface HubWatch {
  id: string;
  /** File name, or the hub URL. */
  name: string;
  /** Value of `metadata.watchedHub` on every track from this hub. */
  hubTag: string;
  sessionId: string;
  source: HubSource;
  status: "watching" | "needs-permission" | "error";
  error?: string;
  /** Identifies the version last read; a different value means it changed. */
  fingerprint: string | null;
  /** When the hub was last read (ms), for per-source poll intervals. */
  lastChecked: number;
  /** Track keys from the last version of the hub that was applied. */
  previousKeys: string[] | null;
  lastSync?: SyncSummary;
}

/** How often each kind of hub is re-read. URLs are slower to spare the server. */
export const POLL_INTERVAL_MS = { file: 1500, url: 10000 } as const;

export function isFileWatchSupported(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

function hubTagFor(name: string): string {
  return `Watched: ${name}`;
}

// MARK: - store

let watches: HubWatch[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeHubWatches(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHubWatches(): HubWatch[] {
  return watches;
}

export function updateHubWatch(id: string, changes: Partial<HubWatch>) {
  watches = watches.map((w) => (w.id === id ? { ...w, ...changes } : w));
  emit();
  const watch = watches.find((w) => w.id === id);
  if (watch && ("previousKeys" in changes || "source" in changes)) {
    void persist(watch);
  }
}

// MARK: - actions

function addOrReplace(sessionId: string, name: string, source: HubSource): HubWatch {
  const hubTag = hubTagFor(name);
  const existing = watches.find(
    (w) => w.hubTag === hubTag && w.sessionId === sessionId,
  );
  if (existing) {
    // Already watched in this session: take the new source and re-read now.
    updateHubWatch(existing.id, {
      source,
      status: "watching",
      error: undefined,
      fingerprint: null,
      lastChecked: 0,
    });
    return existing;
  }
  const watch: HubWatch = {
    id: crypto.randomUUID(),
    name,
    hubTag,
    sessionId,
    source,
    status: "watching",
    fingerprint: null,
    lastChecked: 0,
    previousKeys: null,
  };
  watches = [...watches, watch];
  emit();
  void persist(watch);
  return watch;
}

/** Opens the file picker and starts watching the chosen file. */
export async function pickAndWatchHubFile(sessionId: string): Promise<HubWatch | null> {
  const picker = (window as unknown as { showOpenFilePicker: ShowOpenFilePicker })
    .showOpenFilePicker;
  let handle: WatchableFileHandle;
  try {
    [handle] = await picker({
      types: [
        { description: "Datahub JSON", accept: { "application/json": [".json", ".json5"] } },
      ],
      multiple: false,
    });
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return null; // cancelled
    throw e;
  }
  return addOrReplace(sessionId, handle.name, { kind: "file", handle });
}

/** Starts watching a hub at a URL. */
export function watchHubUrl(sessionId: string, url: string): HubWatch {
  return addOrReplace(sessionId, url, { kind: "url", url });
}

/** Re-reads a hub on the next tick instead of waiting for its interval. */
export function checkHubNow(id: string) {
  updateHubWatch(id, { lastChecked: 0 });
}

export function stopWatchingHub(id: string) {
  watches = watches.filter((w) => w.id !== id);
  emit();
  void unpersist(id);
}

/** Re-asks for read permission after a reload (must run from a click). */
export async function resumeHubWatch(id: string) {
  const watch = watches.find((w) => w.id === id);
  if (!watch || watch.source.kind !== "file") return;
  const state =
    (await watch.source.handle.requestPermission?.({ mode: "read" })) ?? "granted";
  updateHubWatch(id, {
    status: state === "granted" ? "watching" : "needs-permission",
    error: state === "granted" ? undefined : "Permission to read the file was not given.",
    fingerprint: null,
    lastChecked: 0,
  });
}

// MARK: - persistence (IndexedDB)

const DB_NAME = "eg-hub-watch";
const STORE = "watches";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    // Private windows and blocked storage: watching still works for this page.
    console.warn("Could not save watched hub", e);
    return undefined;
  }
}

type SavedWatch = Pick<
  HubWatch,
  "id" | "name" | "hubTag" | "sessionId" | "source" | "previousKeys"
>;

function persist(w: HubWatch) {
  const saved: SavedWatch = {
    id: w.id,
    name: w.name,
    hubTag: w.hubTag,
    sessionId: w.sessionId,
    source: w.source,
    previousKeys: w.previousKeys,
  };
  return withStore("readwrite", (s) => s.put(saved));
}

function unpersist(id: string) {
  return withStore("readwrite", (s) => s.delete(id));
}

let restored = false;

/** Loads watches saved before the last page reload. Safe to call repeatedly. */
export async function restoreHubWatches() {
  if (restored || typeof indexedDB === "undefined") return;
  restored = true;
  const saved = (await withStore<SavedWatch[]>("readonly", (s) => s.getAll())) ?? [];
  const known = new Set(watches.map((w) => w.id));
  const loaded: HubWatch[] = [];
  for (const item of saved) {
    if (known.has(item.id) || !item.source) continue; // skip older saved formats
    let status: HubWatch["status"] = "watching";
    if (item.source.kind === "file") {
      const state =
        (await item.source.handle.queryPermission?.({ mode: "read" })) ?? "prompt";
      status = state === "granted" ? "watching" : "needs-permission";
    }
    loaded.push({ ...item, status, fingerprint: null, lastChecked: 0 });
  }
  if (loaded.length > 0) {
    watches = [...watches, ...loaded];
    emit();
  }
}
