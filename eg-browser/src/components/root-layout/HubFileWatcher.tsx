import { useEffect } from "react";
import { useStore } from "react-redux";
import JSON5 from "json5";
import { DataHubParser, generateUUID, ITrackModel, mapUrl } from "wuepgg3-track";

import type { AppStore } from "@/lib/redux/createStore";
import { selectSessionById, updateSession } from "@/lib/redux/slices/browserSlice";
import { addCustomTracksPool } from "@/lib/redux/slices/hubSlice";
import {
  getHubWatches,
  HubWatch,
  POLL_INTERVAL_MS,
  restoreHubWatches,
  updateHubWatch,
} from "@/lib/hub-watch/hubWatch";
import { hubTagOf, syncHubTracks, tagged } from "@/lib/hub-watch/syncHubTracks";
import { refreshCatalog } from "@/lib/sample-view/sampleView";

const TICK_MS = 500;

/**
 * Re-reads every watched datahub (local file or URL) on its interval and syncs
 * its session's tracks when it changed. Renders nothing; mounted once in
 * RootLayout so watching carries on while the Tracks menu is closed.
 */
export default function HubFileWatcher() {
  const store = useStore() as AppStore;

  useEffect(() => {
    void restoreHubWatches();
    let busy = false;
    const tick = async (force = false) => {
      if (busy) return;
      busy = true;
      try {
        const now = Date.now();
        for (const watch of getHubWatches()) {
          if (watch.status !== "watching") continue;
          if (!force && now - watch.lastChecked < POLL_INTERVAL_MS[watch.source.kind]) {
            continue;
          }
          updateHubWatch(watch.id, { lastChecked: now });
          await checkWatch(store, watch);
        }
      } finally {
        busy = false;
      }
    };
    const onFocus = () => void tick(true); // catch edits made in another window
    void tick();
    const timer = window.setInterval(tick, TICK_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [store]);

  return null;
}

type HubRead =
  | { ok: true; fingerprint: string; text: () => Promise<string>; hubBase: string }
  | { ok: false; error?: string; status?: HubWatch["status"] };

/** Reads the hub's current version without parsing it. */
async function readHub(watch: HubWatch): Promise<HubRead> {
  if (watch.source.kind === "file") {
    try {
      const file = await watch.source.handle.getFile();
      return {
        ok: true,
        fingerprint: `${file.lastModified}:${file.size}`,
        text: () => file.text(),
        hubBase: "", // relative URLs can't be resolved for a local file
      };
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError") return { ok: false, status: "needs-permission" };
      return {
        ok: false,
        status: "error",
        error:
          name === "NotFoundError"
            ? "The file was moved or deleted."
            : `Cannot read the file (${name ?? e}).`,
      };
    }
  }

  const url = watch.source.url;
  let text: string;
  try {
    // "no-cache" revalidates with the server (ETag / Last-Modified), so an
    // unchanged hub comes back as a cheap 304 served from the browser cache.
    const response = await fetch(mapUrl(url)!, { cache: "no-cache" });
    if (!response.ok) {
      // Keep watching: servers come and go (VPN, restarts).
      return { ok: false, error: `Cannot load the hub (HTTP ${response.status}). Retrying.` };
    }
    text = await response.text();
  } catch {
    return { ok: false, error: "Cannot reach the hub (network or CORS error). Retrying." };
  }
  return {
    ok: true,
    fingerprint: hashText(text),
    text: async () => text,
    hubBase: url.substring(0, url.lastIndexOf("/")),
  };
}

function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}

async function checkWatch(store: AppStore, watch: HubWatch) {
  const read = await readHub(watch);
  if (!read.ok) {
    updateHubWatch(watch.id, {
      error: read.error,
      ...(read.status ? { status: read.status } : {}),
    });
    return;
  }
  if (read.fingerprint === watch.fingerprint) {
    if (watch.error?.includes("Retrying")) updateHubWatch(watch.id, { error: undefined });
    return;
  }

  const session = selectSessionById(store.getState(), watch.sessionId);
  // Embedded pages can have several stores; the session may belong to another.
  if (!session) return;

  let json: unknown;
  try {
    json = JSON5.parse(await read.text());
  } catch (e) {
    // Often a half-written save; the next change will be picked up.
    updateHubWatch(watch.id, {
      fingerprint: read.fingerprint,
      error: `Not valid JSON: ${(e as Error).message}. Keeping the last good version.`,
    });
    return;
  }
  if (!Array.isArray(json)) {
    updateHubWatch(watch.id, {
      fingerprint: read.fingerprint,
      error: "A datahub must be an array of tracks. Keeping the last good version.",
    });
    return;
  }

  const fileTracks = new DataHubParser()
    .getTracksInHub(json, watch.hubTag, "", false, 0, read.hubBase)
    // Hubs exported from a session carry that session's track ids; drop them
    // so they can't collide with tracks already open. New ids are given below.
    .map((t) => ({ ...t, id: undefined }) as unknown as ITrackModel);
  const result = syncHubTracks(
    session.tracks,
    fileTracks,
    watch.hubTag,
    watch.previousKeys,
    generateUUID,
  );
  const tracks = result.tracks.map((t) =>
    t.id ? t : ({ ...t, id: generateUUID() } as ITrackModel),
  );

  // Keep the Samples menu's saved track definitions in step with the hub,
  // so a track it shows again looks like the hub says.
  const sampleView = session.sampleView;
  const catalog = sampleView
    ? refreshCatalog(sampleView.catalog, fileTracks.map((t) => tagged(t, watch.hubTag)))
    : undefined;
  const catalogChanged = !!sampleView && catalog !== sampleView.catalog;

  if (result.added || result.updated || result.removed || catalogChanged) {
    store.dispatch(
      updateSession({
        id: watch.sessionId,
        changes: {
          tracks,
          ...(catalogChanged ? { sampleView: { ...sampleView!, catalog: catalog! } } : {}),
        },
      }),
    );
  }
  // Keep the Available Tracks list (incl. tracks hidden on load) in step.
  const pool = store.getState().hub.customTracksPool;
  store.dispatch(
    addCustomTracksPool([
      ...pool.filter((t) => hubTagOf(t) !== watch.hubTag),
      ...fileTracks.map((t) => tagged(t, watch.hubTag)),
    ]),
  );

  updateHubWatch(watch.id, {
    fingerprint: read.fingerprint,
    previousKeys: result.fileKeys,
    error: undefined,
    lastSync: {
      at: Date.now(),
      total: json.length,
      shown: tracks.filter((t) => hubTagOf(t) === watch.hubTag).length,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      skipped: json.length - fileTracks.length,
    },
  });
}
