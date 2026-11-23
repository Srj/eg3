import JSON5 from "json5";
import {
  DataHubParser,
  GenomeCoordinate,
  GenomeSerializer,
  generateUUID,
  getGenomeConfig,
  ITrackModel,
  mapUrl,
} from "wuepgg3-track";

import type { RootState } from "../redux/createStore";
import type { useAppDispatch } from "../redux/hooks";
import {
  createSession,
  selectSessionById,
  setCurrentSession,
  updateSession,
} from "../redux/slices/browserSlice";
import { addCustomTracksPool } from "../redux/slices/hubSlice";
import { addSessionsFromBundleId, importOneSession } from "../redux/thunk/session";
import { hubTagFor, watchHubUrl } from "../hub-watch/hubWatch";
import { syncHubTracks, tagged } from "../hub-watch/syncHubTracks";
import { genomeOfHub, SessionRoute } from "../session-route";

interface Ctx {
  // Same dispatch type the rest of the app uses (it accepts thunks).
  dispatch: ReturnType<typeof useAppDispatch>;
  getState: () => RootState;
  notify: (message: string, level?: "info" | "error") => void;
}

/** Handles /session/<id> and /session/create/<url>. */
export async function runSessionRoute(route: SessionRoute, ctx: Ctx) {
  if (route.kind === "new") {
    ctx.dispatch(setCurrentSession(null)); // show the genome picker
    return;
  }
  if (route.kind === "open") return openSession(route.id, ctx);
  return createFromUrl(route.url, ctx);
}

async function openSession(id: string, { dispatch, getState, notify }: Ctx) {
  if (selectSessionById(getState(), id)) {
    dispatch(setCurrentSession(id));
    return;
  }
  // Sessions are saved in this browser only. A link from elsewhere may be a
  // shared session bundle id instead, so try that before giving up.
  try {
    await dispatch(addSessionsFromBundleId(id)).unwrap();
  } catch {
    notify(
      `No session with id "${id}" is saved in this browser, and it is not a shared session bundle id. Showing the genome picker instead.`,
    );
    dispatch(setCurrentSession(null));
  }
}

async function createFromUrl(url: string, { dispatch, notify }: Ctx) {
  const params = new URLSearchParams(window.location.search);
  let content: unknown;
  try {
    const response = await fetch(mapUrl(url)!, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    content = JSON5.parse(await response.text());
  } catch (e) {
    notify(`Cannot load ${url} (${(e as Error).message}). Showing the genome picker instead.`);
    dispatch(setCurrentSession(null));
    return;
  }

  // A session file (an object with tracks, genome, region, ...).
  if (!Array.isArray(content)) {
    try {
      await dispatch(
        importOneSession({ session: content, navigatingToSession: true }),
      ).unwrap();
    } catch {
      notify(
        `${url} is neither a datahub (a list of tracks) nor a session file. Showing the genome picker instead.`,
      );
      dispatch(setCurrentSession(null));
    }
    return;
  }

  // A datahub.
  try {
    createSessionFromHub(dispatch, content, url, {
      genome: params.get("genome") || undefined,
      position: params.get("position") || undefined,
      noDefaultTracks: params.has("noDefaultTracks"),
      watch: params.get("watch") !== "false",
    });
  } catch (e) {
    notify((e as Error).message);
    dispatch(setCurrentSession(null));
  }
}

export class HubSessionError extends Error {}

export interface HubSessionOptions {
  /** Genome name; otherwise the genome the hub's tracks name. */
  genome?: string;
  position?: string;
  noDefaultTracks?: boolean;
  /** Keep the session in sync with `url` (see hub-watch). */
  watch?: boolean;
  title?: string;
}

/**
 * Makes a session (and makes it current) from a parsed datahub. `url` is where
 * the hub lives: relative track URLs resolve against it, and it's what gets
 * watched. Throws HubSessionError with a message for the user.
 */
export function createSessionFromHub(
  dispatch: Ctx["dispatch"],
  content: unknown[],
  url: string,
  options: HubSessionOptions = {},
): string {
  const genomeName = options.genome || genomeOfHub(content);
  const genomeConfig = genomeName ? getGenomeConfig(genomeName) : null;
  if (!genomeConfig?.genome) {
    throw new HubSessionError(
      genomeName
        ? `Unknown genome "${genomeName}" for the datahub ${url}.`
        : `Cannot tell which genome the datahub ${url} is for. Name the genome, e.g. mm10.`,
    );
  }
  const genome = GenomeSerializer.serialize(genomeConfig);
  const hubTag = hubTagFor(url);
  const hubBase = url.substring(0, url.lastIndexOf("/"));
  const hubTracks = new DataHubParser()
    .getTracksInHub(content, hubTag, "", false, 0, hubBase)
    .map((t) => ({ ...t, id: undefined }) as unknown as ITrackModel);

  // The genome's default tracks stay unless the hub brings its own ruler
  // (datahubs downloaded from a session include the whole track list), or
  // noDefaultTracks is asked for.
  const ownRuler = hubTracks.some((t) => t.type === "ruler");
  const base: ITrackModel[] =
    ownRuler || options.noDefaultTracks
      ? []
      : (genome.defaultTracks ?? []).map((t: ITrackModel) =>
          JSON.parse(JSON.stringify(t)),
        );
  // Same rules as a watched hub, so the watcher picks up from here unchanged.
  const { tracks } = syncHubTracks(base, hubTracks, hubTag, null, generateUUID);

  dispatch(addCustomTracksPool(hubTracks.map((t) => tagged(t, hubTag))));
  const sessionId = generateUUID();
  dispatch(
    createSession({
      id: sessionId,
      genome,
      viewRegion: (options.position as GenomeCoordinate) || undefined,
      additionalTracks: tracks,
    }),
  );
  if (options.title) {
    dispatch(updateSession({ id: sessionId, changes: { title: options.title } }));
  }
  if (options.watch !== false) watchHubUrl(sessionId, url);
  return sessionId;
}
