import { useState, useSyncExternalStore } from "react";
import { generateUUID } from "wuepgg3-track";

import Button from "@/components/ui/button/Button";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { selectCurrentSession, updateSession } from "@/lib/redux/slices/browserSlice";
import {
  checkHubNow,
  getHubWatches,
  HubWatch,
  isFileWatchSupported,
  pickAndWatchHubFile,
  POLL_INTERVAL_MS,
  resumeHubWatch,
  stopWatchingHub,
  subscribeHubWatches,
} from "@/lib/hub-watch/hubWatch";
import { reloadHubTrackData } from "@/lib/hub-watch/syncHubTracks";

/**
 * "Watch Hub File" section of Add Data Hubs: pick a local datahub JSON and keep
 * this session in sync with it whenever the file is saved.
 */
export default function WatchHubFile() {
  const session = useAppSelector(selectCurrentSession);
  const [error, setError] = useState("");

  const onWatch = async () => {
    if (!session) return;
    setError("");
    try {
      await pickAndWatchHubFile(session.id);
    } catch (e) {
      setError(`Could not open the file: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-primary dark:text-dark-primary uppercase tracking-wider">
        Watch Hub File
      </p>
      <p className="text-sm text-primary/60 dark:text-dark-primary/60">
        Pick a datahub .json on your computer. Whenever you save it, tracks in
        this session are added, updated or removed to match (tracks with
        "showOnHubLoad": false are left out). Track URLs must start with
        http(s).
      </p>
      {isFileWatchSupported() ? (
        <Button
          disabled={!session}
          onClick={onWatch}
          style={{ width: "fit-content", padding: "4px 6px" }}
        >
          Choose file to watch
        </Button>
      ) : (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Watching a file needs Chrome or Edge. In this browser, put the hub on
          a web server and use Remote Hub URL with "Watch for changes".
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

/** Every hub watched in the current session, local files and URLs alike. */
export function WatchedHubList() {
  const session = useAppSelector(selectCurrentSession);
  const watches = useSyncExternalStore(subscribeHubWatches, getHubWatches);
  const mine = watches.filter((w) => w.sessionId === session?.id);
  if (mine.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-primary dark:text-dark-primary uppercase tracking-wider">
        Watched Hubs
      </p>
      {mine.map((watch) => (
        <WatchRow key={watch.id} watch={watch} />
      ))}
    </div>
  );
}

function WatchRow({ watch }: { watch: HubWatch }) {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCurrentSession);
  const s = watch.lastSync;
  const isUrl = watch.source.kind === "url";

  const onReloadData = () => {
    if (!session) return;
    dispatch(
      updateSession({
        id: session.id,
        changes: {
          tracks: reloadHubTrackData(session.tracks, watch.hubTag, generateUUID),
        },
      }),
    );
  };

  const dot =
    watch.status === "watching" && !watch.error
      ? "bg-green-500"
      : watch.status === "needs-permission"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div
      className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm flex flex-col gap-1"
      data-testid="hub-watch-row"
    >
      <div className="flex items-start gap-2">
        <span className={`inline-block w-2 h-2 mt-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="font-mono font-semibold break-all">{watch.name}</span>
      </div>
      <p className="text-primary/50 dark:text-dark-primary/50">
        {isUrl ? "URL" : "Local file"}, checked every{" "}
        {POLL_INTERVAL_MS[watch.source.kind] / 1000} s
      </p>
      {watch.status === "watching" && s && (
        <p className="text-primary/70 dark:text-dark-primary/70">
          Synced {new Date(s.at).toLocaleTimeString()}: {s.shown} shown of{" "}
          {s.total} in hub
          {s.added + s.updated + s.removed > 0 &&
            ` (${[
              s.added && `${s.added} added`,
              s.updated && `${s.updated} updated`,
              s.removed && `${s.removed} removed`,
            ]
              .filter(Boolean)
              .join(", ")})`}
          {s.skipped > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              · {s.skipped} skipped{isUrl ? "" : " (relative URL)"}
            </span>
          )}
        </p>
      )}
      {watch.status === "watching" && !s && !watch.error && (
        <p className="text-primary/70 dark:text-dark-primary/70">Reading…</p>
      )}
      {watch.status === "needs-permission" && (
        <p className="text-amber-600 dark:text-amber-400">
          Paused after reload. Click Resume to allow reading the file again.
        </p>
      )}
      {watch.error && <p className="text-red-500">{watch.error}</p>}
      <div className="flex flex-wrap gap-2 mt-1">
        {watch.status === "needs-permission" ? (
          <Button onClick={() => resumeHubWatch(watch.id)} style={{ padding: "2px 6px" }}>
            Resume
          </Button>
        ) : (
          <>
            {isUrl && (
              <Button onClick={() => checkHubNow(watch.id)} style={{ padding: "2px 6px" }}>
                Check now
              </Button>
            )}
            <Button
              disabled={watch.status !== "watching"}
              onClick={onReloadData}
              style={{ padding: "2px 6px" }}
            >
              Reload data
            </Button>
          </>
        )}
        <Button onClick={() => stopWatchingHub(watch.id)} style={{ padding: "2px 6px" }}>
          Stop watching
        </Button>
      </div>
    </div>
  );
}
