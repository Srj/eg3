import { ITrackModel } from "wuepgg3-track";

/**
 * Pure helpers for keeping a session's tracks in step with a watched datahub
 * file. Every track that came from a watched file carries
 * `metadata.watchedHub === hubTag`, which is how its tracks are told apart from
 * the rest of the session on each sync. (It goes in `metadata` because the
 * track view rebuilds session tracks with a fixed set of fields, and
 * `metadata` is one of the few that survive.)
 */

type HubTrack = ITrackModel & { datahub?: string; showOnHubLoad?: boolean };

export const WATCHED_HUB_KEY = "watchedHub";

export function hubTagOf(track: ITrackModel): string | undefined {
  const tag = track.metadata?.[WATCHED_HUB_KEY];
  return typeof tag === "string" ? tag : undefined;
}

export function tagged<T extends ITrackModel>(track: T, hubTag: string): T {
  return {
    ...track,
    datahub: hubTag,
    metadata: { ...track.metadata, [WATCHED_HUB_KEY]: hubTag },
  };
}

// Query parameter added by "Reload data" so the browser's HTTP cache can't
// serve bytes from before the file at that URL was regenerated.
export const RELOAD_PARAM = "eg_reload";

function stripReloadParam(url: string): string {
  return url
    .replace(new RegExp(`([?&])${RELOAD_PARAM}=[^&#]*&?`), "$1")
    .replace(/[?&](#|$)/, "$1");
}

export function withReloadParam(url: string, stamp: number): string {
  const clean = stripReloadParam(url);
  const [base, hash = ""] = clean.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${RELOAD_PARAM}=${stamp}${hash ? `#${hash}` : ""}`;
}

function baseKey(track: HubTrack): string {
  return track.url
    ? `url:${stripReloadParam(track.url)}`
    : `name:${track.type ?? ""}:${track.name}`;
}

/**
 * Identity of each track within one hub: its URL (or type + name for tracks
 * without a URL). A hub that lists the same file twice gets `#2`, `#3`, ... so
 * each entry is still matched one-to-one.
 */
export function keyTracks<T extends HubTrack>(tracks: T[]): [string, T][] {
  const seen: Record<string, number> = {};
  return tracks.map((track) => {
    const key = baseKey(track);
    seen[key] = (seen[key] ?? 0) + 1;
    return [seen[key] > 1 ? `${key}#${seen[key]}` : key, track];
  });
}

export interface SyncResult {
  tracks: ITrackModel[];
  added: number;
  updated: number;
  removed: number;
  /** Keys of every track in the file, to pass back as `previousKeys` next time. */
  fileKeys: string[];
}

/**
 * Brings the watched hub's tracks in `sessionTracks` in line with the file:
 *
 * - a track still in the file keeps its place and takes the file's options,
 *   label and metadata (the file wins over edits made in the browser). If any
 *   of those changed it also gets a new id from `newId`: the track view only
 *   redraws a track's options when its id changes (bytes already fetched still
 *   come from the browser's HTTP cache);
 * - a track no longer in the file is removed;
 * - a track new to the file is added at the end unless it has
 *   `showOnHubLoad: false`. (Unlike a one-off hub load, where tracks are
 *   hidden by default: a watched file mirrors what you want on screen, and the
 *   browser's own "Download as datahub" files don't set `showOnHubLoad`.)
 *   On later syncs only tracks that weren't in the previous version of the file
 *   count as new, so a track you removed by hand stays removed until it is
 *   added to the file again.
 *
 * Tracks from anywhere else in the session are never touched.
 */
export function syncHubTracks(
  sessionTracks: ITrackModel[],
  fileTracks: HubTrack[],
  hubTag: string,
  previousKeys: string[] | null,
  newId: () => string,
): SyncResult {
  const fileKeyed = keyTracks(fileTracks);
  const fileByKey = new Map(fileKeyed);
  const sessionHubKeyed = keyTracks(
    sessionTracks.filter((t) => hubTagOf(t) === hubTag),
  );
  const keyOfSessionTrack = new Map(
    sessionHubKeyed.map(([key, track]) => [track, key]),
  );
  const inSession = new Set(sessionHubKeyed.map(([key]) => key));
  const previous = previousKeys ? new Set(previousKeys) : null;

  let updated = 0;
  let removed = 0;
  const tracks: ITrackModel[] = [];

  for (const track of sessionTracks) {
    const key = keyOfSessionTrack.get(track);
    if (key === undefined) {
      tracks.push(track); // not from this hub
      continue;
    }
    const fromFile = fileByKey.get(key);
    if (!fromFile) {
      removed++;
      continue;
    }
    const next = tagged(
      {
        ...track, // keeps fields the track view added, e.g. `genome`
        ...fromFile,
        // keep the cache-busting URL if "Reload data" was used; the key match
        // already means the file's URL is otherwise the same
        url: track.url ?? fromFile.url,
        id: track.id,
        isSelected: track.isSelected,
        options: withBrowserOptions(fromFile.options, track.options),
      } as ITrackModel,
      hubTag,
    );
    if (sameTrack(track, next)) {
      tracks.push(next);
    } else {
      updated++;
      tracks.push({ ...next, id: newId() });
    }
  }

  let added = 0;
  for (const [key, track] of fileKeyed) {
    if (inSession.has(key) || track.showOnHubLoad === false) continue;
    if (previous && previous.has(key)) continue;
    tracks.push(tagged(track as ITrackModel, hubTag));
    added++;
  }

  return { tracks, added, updated, removed, fileKeys: fileKeyed.map(([k]) => k) };
}

/** Gives every track from the hub a new id and a cache-busting URL. */
export function reloadHubTrackData(
  sessionTracks: ITrackModel[],
  hubTag: string,
  newId: () => string,
  stamp: number = Date.now(),
): ITrackModel[] {
  return sessionTracks.map((track) =>
    hubTagOf(track) === hubTag
      ? ({
          ...track,
          id: newId(),
          url: track.url ? withReloadParam(track.url, stamp) : track.url,
        } as ITrackModel)
      : track,
  );
}

/** Whether the parts of a track a hub file sets are the same. */
/**
 * Options set in the browser that a hub file doesn't own, kept across syncs:
 * pinning a track is a choice about the view, not about the data.
 */
const BROWSER_OPTIONS = ["pinned"] as const;

function withBrowserOptions(
  fileOptions: ITrackModel["options"],
  sessionOptions: ITrackModel["options"],
): ITrackModel["options"] {
  const kept = BROWSER_OPTIONS.filter(
    (key) => (sessionOptions as Record<string, unknown> | undefined)?.[key] !== undefined,
  );
  if (kept.length === 0) return fileOptions; // nothing to keep: the file's as is
  const merged = { ...(fileOptions ?? {}) } as Record<string, unknown>;
  for (const key of kept) merged[key] = (sessionOptions as Record<string, unknown>)[key];
  return merged as ITrackModel["options"];
}

function sameTrack(a: ITrackModel, b: ITrackModel): boolean {
  const pick = (t: ITrackModel) =>
    JSON.stringify([t.name, t.type, t.url, t.options, t.metadata]);
  return pick(a) === pick(b);
}
