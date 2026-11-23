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

import type { AppDispatch, RootState } from "../redux/createStore";
import {
  createSession,
  selectSessionById,
  setCurrentSession,
} from "../redux/slices/browserSlice";
import { addCustomTracksPool } from "../redux/slices/hubSlice";
import { addSessionsFromBundleId, importOneSession } from "../redux/thunk/session";
import { hubTagFor, watchHubUrl } from "../hub-watch/hubWatch";
import { syncHubTracks, tagged } from "../hub-watch/syncHubTracks";
import { genomeOfHub, SessionRoute } from "../session-route";

interface Ctx {
  dispatch: AppDispatch;
  getState: () => RootState;
  notify: (message: string, level?: "info" | "error") => void;
}

/** Handles /session/<id> and /session/create/<url>. */
export async function runSessionRoute(route: SessionRoute, ctx: Ctx) {
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
  const genomeName = params.get("genome") || genomeOfHub(content);
  const genomeConfig = genomeName ? getGenomeConfig(genomeName) : null;
  if (!genomeConfig?.genome) {
    notify(
      genomeName
        ? `Unknown genome "${genomeName}" for the datahub ${url}.`
        : `Cannot tell which genome the datahub ${url} is for. Add ?genome=<name> to the link, e.g. ?genome=mm10.`,
    );
    dispatch(setCurrentSession(null));
    return;
  }
  const genome = GenomeSerializer.serialize(genomeConfig);
  const hubTag = hubTagFor(url);
  const hubBase = url.substring(0, url.lastIndexOf("/"));
  const hubTracks = new DataHubParser()
    .getTracksInHub(content, hubTag, "", false, 0, hubBase)
    .map((t) => ({ ...t, id: undefined }) as unknown as ITrackModel);

  // The genome's default tracks stay unless the hub brings its own ruler
  // (datahubs downloaded from a session include the whole track list), or
  // the link says noDefaultTracks.
  const ownRuler = hubTracks.some((t) => t.type === "ruler");
  const base: ITrackModel[] =
    ownRuler || params.has("noDefaultTracks")
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
      viewRegion: (params.get("position") as GenomeCoordinate) || undefined,
      additionalTracks: tracks,
    }),
  );
  if (params.get("watch") !== "false") watchHubUrl(sessionId, url);
}
