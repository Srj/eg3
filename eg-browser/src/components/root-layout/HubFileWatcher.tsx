import { useEffect } from "react";
import { useStore } from "react-redux";
import JSON5 from "json5";
import { DataHubParser, generateUUID, ITrackModel } from "wuepgg3-track";

import type { AppStore } from "@/lib/redux/createStore";
import { selectSessionById, updateSession } from "@/lib/redux/slices/browserSlice";
import { addCustomTracksPool } from "@/lib/redux/slices/hubSlice";
import {
  getHubWatches,
  HubWatch,
  restoreHubWatches,
  updateHubWatch,
} from "@/lib/hub-watch/hubWatch";
import { hubTagOf, syncHubTracks, tagged } from "@/lib/hub-watch/syncHubTracks";

const POLL_MS = 1500;

/**
 * Checks every watched datahub file for changes and syncs its session's tracks.
 * Renders nothing; mounted once in RootLayout so watching carries on while the
 * Tracks menu is closed.
 */
export default function HubFileWatcher() {
  const store = useStore() as AppStore;

  useEffect(() => {
    void restoreHubWatches();
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const watch of getHubWatches()) {
          if (watch.status === "watching") await checkWatch(store, watch);
        }
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [store]);

  return null;
}

async function checkWatch(store: AppStore, watch: HubWatch) {
  let file: File;
  try {
    file = await watch.handle.getFile();
  } catch (e) {
    const name = (e as DOMException)?.name;
    updateHubWatch(watch.id, {
      status: name === "NotAllowedError" ? "needs-permission" : "error",
      error:
        name === "NotFoundError"
          ? "The file was moved or deleted."
          : name === "NotAllowedError"
            ? undefined
            : `Cannot read the file (${name ?? e}).`,
    });
    return;
  }
  if (file.lastModified === watch.lastModified && file.size === watch.size) return;

  const session = selectSessionById(store.getState(), watch.sessionId);
  // Embedded pages can have several stores; the session may belong to another.
  if (!session) return;

  let json: unknown;
  try {
    json = JSON5.parse(await file.text());
  } catch (e) {
    // Often a half-written save; the next change will be picked up.
    updateHubWatch(watch.id, {
      lastModified: file.lastModified,
      size: file.size,
      error: `Not valid JSON: ${(e as Error).message}. Keeping the last good version.`,
    });
    return;
  }
  if (!Array.isArray(json)) {
    updateHubWatch(watch.id, {
      lastModified: file.lastModified,
      size: file.size,
      error: "A datahub must be an array of tracks. Keeping the last good version.",
    });
    return;
  }

  // Relative URLs can't be resolved for a local file, so the parser skips them.
  const fileTracks = new DataHubParser().getTracksInHub(json, watch.hubTag);
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

  if (result.added || result.updated || result.removed) {
    store.dispatch(updateSession({ id: watch.sessionId, changes: { tracks } }));
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
    lastModified: file.lastModified,
    size: file.size,
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
