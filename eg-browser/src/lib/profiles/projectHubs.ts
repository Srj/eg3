import JSON5 from "json5";
import { mapUrl } from "wuepgg3-track";

import { genomeOfHub } from "../session-route";

/**
 * A profile's project hubs: copies of public datahubs the user added, kept in
 * this browser (IndexedDB) so new sessions can be made from them without
 * uploading or even reaching the URL again. Each profile sees only its own
 * (matched by the profile's store id).
 */
export interface ProjectHub {
  id: string;
  /** Store id of the profile that owns it. */
  owner: string;
  name: string;
  url: string;
  genome: string | null;
  trackCount: number;
  /** The hub's JSON text as last fetched. */
  content: string;
  savedAt: number;
}

const DB_NAME = "eg-project-hubs";
const STORE = "hubs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("owner", "owner");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjectHubs(owner: string): Promise<ProjectHub[]> {
  const hubs = await run<ProjectHub[]>("readonly", (s) =>
    s.index("owner").getAll(owner),
  );
  return hubs.sort((a, b) => b.savedAt - a.savedAt);
}

export function deleteProjectHub(id: string) {
  return run("readwrite", (s) => s.delete(id));
}

export class HubFetchError extends Error {}

/** Fetches and checks a datahub; returns its text and parsed track list. */
export async function fetchDatahub(url: string): Promise<{ text: string; tracks: unknown[] }> {
  if (!/^https?:\/\//i.test(url)) {
    throw new HubFetchError("Enter a full URL starting with http:// or https://.");
  }
  let response: Response;
  try {
    response = await fetch(mapUrl(url)!, { cache: "no-cache" });
  } catch {
    throw new HubFetchError(
      "Cannot reach that URL. Check it's public and allows cross-origin requests (CORS).",
    );
  }
  if (!response.ok) throw new HubFetchError(`Cannot load the hub (HTTP ${response.status}).`);
  const text = await response.text();
  if (/^\s*</.test(text)) {
    throw new HubFetchError(
      "That URL returned a web page, not a datahub. Check the link points to the .json file itself.",
    );
  }
  let tracks: unknown;
  try {
    tracks = JSON5.parse(text);
  } catch (e) {
    throw new HubFetchError(`That file isn't valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(tracks)) {
    throw new HubFetchError("That file isn't a datahub: a datahub is a list of tracks.");
  }
  return { text, tracks };
}

/**
 * Saves a copy of a hub to the profile, replacing the copy of the same URL if
 * there is one. Returns the saved record.
 */
export async function saveProjectHub(
  owner: string,
  url: string,
  text: string,
  tracks: unknown[],
  name?: string,
): Promise<ProjectHub> {
  const existing = (await listProjectHubs(owner)).find((h) => h.url === url);
  const hub: ProjectHub = {
    id: existing?.id ?? crypto.randomUUID(),
    owner,
    name: name?.trim() || existing?.name || url.split("/").pop() || url,
    url,
    genome: genomeOfHub(tracks),
    trackCount: tracks.length,
    content: text,
    savedAt: Date.now(),
  };
  await run("readwrite", (s) => s.put(hub));
  return hub;
}

/** The saved copy's track list. */
export function projectHubTracks(hub: ProjectHub): unknown[] {
  return JSON5.parse(hub.content);
}
