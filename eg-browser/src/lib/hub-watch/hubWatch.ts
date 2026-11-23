/**
 * Watched datahub files.
 *
 * A watched hub is a local JSON datahub picked with the File System Access API
 * (Chrome and Edge). The picker hands back a file handle that can be re-read
 * at any time, so the file is checked for changes on a timer and the session
 * is synced whenever it changes (see `HubFileWatcher` and `syncHubTracks`).
 *
 * Handles aren't serializable, so they live here rather than in Redux. They are
 * also saved to IndexedDB so watching can resume after a page reload; the
 * browser then asks for read permission again, which needs a click.
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
  fileName: string;
  /** Value of `datahub` on every track from this file. */
  hubTag: string;
  sessionId: string;
  handle: WatchableFileHandle;
  status: "watching" | "needs-permission" | "error";
  error?: string;
  lastModified: number | null;
  size: number | null;
  /** Track keys from the last version of the file that was applied. */
  previousKeys: string[] | null;
  lastSync?: SyncSummary;
}

export function isHubWatchSupported(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

export function hubTagFor(fileName: string): string {
  return `Watched: ${fileName}`;
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
  if (watch && ("previousKeys" in changes || "sessionId" in changes)) {
    void persist(watch);
  }
}

// MARK: - actions

/** Opens the file picker and starts watching the chosen file. */
export async function pickAndWatchHub(sessionId: string): Promise<HubWatch | null> {
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
  const hubTag = hubTagFor(handle.name);
  const existing = watches.find(
    (w) => w.hubTag === hubTag && w.sessionId === sessionId,
  );
  if (existing) {
    // Same file name in the same session: swap in the new handle and re-read.
    updateHubWatch(existing.id, {
      handle,
      status: "watching",
      error: undefined,
      lastModified: null,
      size: null,
    });
    void persist({ ...existing, handle });
    return existing;
  }
  const watch: HubWatch = {
    id: crypto.randomUUID(),
    fileName: handle.name,
    hubTag,
    sessionId,
    handle,
    status: "watching",
    lastModified: null,
    size: null,
    previousKeys: null,
  };
  watches = [...watches, watch];
  emit();
  void persist(watch);
  return watch;
}

export function stopWatchingHub(id: string) {
  watches = watches.filter((w) => w.id !== id);
  emit();
  void unpersist(id);
}

/** Re-asks for read permission after a reload (must run from a click). */
export async function resumeHubWatch(id: string) {
  const watch = watches.find((w) => w.id === id);
  if (!watch) return;
  const state = (await watch.handle.requestPermission?.({ mode: "read" })) ?? "granted";
  updateHubWatch(id, {
    status: state === "granted" ? "watching" : "needs-permission",
    error: state === "granted" ? undefined : "Permission to read the file was not given.",
    lastModified: null,
    size: null,
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

function persist(w: HubWatch) {
  return withStore("readwrite", (s) =>
    s.put({
      id: w.id,
      fileName: w.fileName,
      hubTag: w.hubTag,
      sessionId: w.sessionId,
      handle: w.handle,
      previousKeys: w.previousKeys,
    }),
  );
}

function unpersist(id: string) {
  return withStore("readwrite", (s) => s.delete(id));
}

type SavedWatch = Pick<
  HubWatch,
  "id" | "fileName" | "hubTag" | "sessionId" | "handle" | "previousKeys"
>;

let restored = false;

/** Loads watches saved before the last page reload. Safe to call repeatedly. */
export async function restoreHubWatches() {
  if (restored || !isHubWatchSupported()) return;
  restored = true;
  const saved = (await withStore<SavedWatch[]>("readonly", (s) => s.getAll())) ?? [];
  const known = new Set(watches.map((w) => w.id));
  const loaded: HubWatch[] = [];
  for (const item of saved) {
    if (known.has(item.id) || !item.handle) continue;
    const state = (await item.handle.queryPermission?.({ mode: "read" })) ?? "prompt";
    loaded.push({
      ...item,
      status: state === "granted" ? "watching" : "needs-permission",
      lastModified: null,
      size: null,
    });
  }
  if (loaded.length > 0) {
    watches = [...watches, ...loaded];
    emit();
  }
}
