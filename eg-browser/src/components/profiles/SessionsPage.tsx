import { FormEvent, useEffect, useMemo, useState } from "react";

import AppProvider from "@/lib/redux/AppProvider";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  BrowserSession,
  selectSessions,
  updateSession,
} from "@/lib/redux/slices/browserSlice";
import { ActiveProfile, signOut } from "@/lib/profiles/profiles";
import { NEW_SESSION_PATH, sessionPath } from "@/lib/session-route";
import { hubTagOf } from "@/lib/hub-watch/syncHubTracks";
import {
  deleteProjectHub,
  fetchDatahub,
  HubFetchError,
  listProjectHubs,
  ProjectHub,
  projectHubTracks,
  saveProjectHub,
} from "@/lib/profiles/projectHubs";
import { createSessionFromHub, HubSessionError } from "@/lib/hooks/sessionRouteActions";

/**
 * The signed-in profile's sessions. Each row links to /session/<id>, which
 * opens the browser straight on that session (and works in a new tab).
 */
export default function SessionsPage({ profile }: { profile: ActiveProfile }) {
  return (
    // Same store id as the browser, so this is the profile's own saved state.
    <AppProvider storeConfig={{ storeId: profile.storeId }}>
      <SessionList profile={profile} />
    </AppProvider>
  );
}

function SessionList({ profile }: { profile: ActiveProfile }) {
  const sessions = useAppSelector(selectSessions);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ text: string; sessionId: string } | null>(null);
  const [hubsVersion, setHubsVersion] = useState(0); // bump to reload project hubs

  const archivedCount = sessions.filter((s) => s.archived).length;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...sessions]
      .filter((s) => (view === "archived" ? !!s.archived : !s.archived))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map((s) => ({ session: s, hubs: watchedHubs(s) }))
      .filter(
        ({ session, hubs }) =>
          !q ||
          [displayTitle(session), session.genomeId, region(session), ...hubs]
            .join(" ")
            .toLowerCase()
            .includes(q),
      );
  }, [sessions, query, view]);

  const onCreated = (sessionId: string, text: string) => {
    setNotice({ text, sessionId });
    setView("active");
    setHubsVersion((v) => v + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <h1 className="text-lg mr-auto">
            <span className="font-semibold">WashU</span> Epigenome Browser
          </h1>
          <span className="text-sm text-gray-600" data-testid="profile-name">
            Signed in as <span className="font-medium">{profile.userId}</span>
          </span>
          <button
            type="button"
            onClick={signOut}
            className="text-sm rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold mr-auto">Sessions</h2>
          <input
            type="search"
            placeholder="Filter by name, genome, region or hub"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:w-72 border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            className="rounded-lg border border-blue-600 text-blue-700 bg-white px-3 py-1.5 text-sm font-medium hover:bg-blue-50"
          >
            Add session
          </button>
          <a
            href={NEW_SESSION_PATH}
            className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-700"
          >
            New session
          </a>
        </div>

        {adding && (
          <AddSessionForm
            owner={profile.storeId}
            onDone={(id, text) => {
              setAdding(false);
              onCreated(id, text);
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {notice && (
          <div
            className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 flex flex-wrap items-center gap-2"
            role="status"
          >
            <span>{notice.text}</span>
            <a href={sessionPath(notice.sessionId)} className="font-medium underline">
              Open it
            </a>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="ml-auto text-green-800 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex gap-1 border-b border-gray-200 text-sm" role="tablist">
          {(["active", "archived"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`px-3 py-2 -mb-px border-b-2 ${
                view === v
                  ? "border-blue-600 text-blue-700 font-medium"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {v === "active"
                ? `Active (${sessions.length - archivedCount})`
                : `Archived (${archivedCount})`}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-600">
            {query ? (
              <p>No sessions match “{query}”.</p>
            ) : view === "archived" ? (
              <p>No archived sessions.</p>
            ) : (
              <>
                <p>No sessions yet.</p>
                <p className="text-sm mt-1">
                  Use <span className="font-medium">Add session</span> with a
                  datahub URL, or <span className="font-medium">New session</span>{" "}
                  to pick a genome.
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="session-list">
            {rows.map(({ session, hubs }) => (
              <SessionRow key={session.id} session={session} hubs={hubs} />
            ))}
          </ul>
        )}

        <ProjectHubs owner={profile.storeId} version={hubsVersion} onCreated={onCreated} />
      </main>
    </div>
  );
}

// MARK: - Add session

function AddSessionForm({
  owner,
  onDone,
  onCancel,
}: {
  owner: string;
  onDone: (sessionId: string, message: string) => void;
  onCancel: () => void;
}) {
  const dispatch = useAppDispatch();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [genome, setGenome] = useState("");
  const [watch, setWatch] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const hubUrl = url.trim();
      const { text, tracks } = await fetchDatahub(hubUrl);
      // Create first, so a hub with an unknown genome isn't saved.
      const sessionId = createSessionFromHub(dispatch, tracks, hubUrl, {
        genome: genome.trim() || undefined,
        watch,
        title: name.trim() || undefined,
      });
      const hub = await saveProjectHub(owner, hubUrl, text, tracks, name);
      onDone(
        sessionId,
        `Added a session from ${hub.name} (${tracks.length} tracks) and saved a copy of the hub to your project hubs.`,
      );
    } catch (err) {
      setError(
        err instanceof HubFetchError || err instanceof HubSessionError
          ? err.message
          : `Something went wrong: ${(err as Error).message}`,
      );
      setBusy(false);
    }
  };

  const input =
    "w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
  return (
    <form
      onSubmit={submit}
      aria-label="Add session"
      className="rounded-xl border border-blue-200 bg-white p-4 flex flex-col gap-3"
    >
      <p className="text-sm text-gray-600">
        Paste the public URL of a datahub (.json). A copy is saved to your
        profile under Project hubs, so you can start more sessions from it
        without uploading it again.
      </p>
      <label className="flex flex-col gap-1 text-sm text-gray-700">
        Datahub URL
        <input
          className={input}
          name="hubUrl"
          type="url"
          required
          autoFocus
          placeholder="https://wangcluster.wustl.edu/~you/hubs/project.json"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <div className="flex flex-col sm:flex-row gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-700 flex-1">
          Session name (optional)
          <input
            className={input}
            name="sessionName"
            maxLength={TITLE_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700 sm:w-40">
          Genome (optional)
          <input
            className={input}
            name="genome"
            placeholder="from the hub"
            value={genome}
            onChange={(e) => setGenome(e.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer w-fit">
        <input type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} />
        Keep the session in sync with the URL
      </label>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add session"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// MARK: - Project hubs

function ProjectHubs({
  owner,
  version,
  onCreated,
}: {
  owner: string;
  version: number;
  onCreated: (sessionId: string, message: string) => void;
}) {
  const dispatch = useAppDispatch();
  const [hubs, setHubs] = useState<ProjectHub[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    listProjectHubs(owner)
      .then((h) => live && setHubs(h))
      .catch(() => live && setHubs([]));
    return () => {
      live = false;
    };
  }, [owner, version, reload]);

  if (!hubs || hubs.length === 0) return null;

  const act = async (hub: ProjectHub, fn: () => Promise<void>) => {
    setError("");
    setBusyId(hub.id);
    try {
      await fn();
    } catch (err) {
      setError(`${hub.name}: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
      setReload((r) => r + 1);
    }
  };

  return (
    <section className="flex flex-col gap-2 mt-4" aria-label="Project hubs">
      <h3 className="text-lg font-semibold">Project hubs</h3>
      <p className="text-sm text-gray-600 -mt-1">
        Saved copies of the hubs you added. New sessions start from the saved
        copy, so they work even if the URL is unreachable.
      </p>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2" data-testid="project-hubs">
        {hubs.map((hub) => (
          <li
            key={hub.id}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm"
            data-testid="project-hub"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium break-all">{hub.name}</span>
              {hub.genome && (
                <span className="text-xs rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
                  {hub.genome}
                </span>
              )}
              <span className="text-gray-600">{hub.trackCount} tracks</span>
              <span className="ml-auto text-xs text-gray-500">
                Copy saved {formatTime(hub.savedAt)}
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-1 font-mono break-all">{hub.url}</div>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                disabled={busyId === hub.id}
                onClick={() =>
                  act(hub, async () => {
                    const id = createSessionFromHub(dispatch, projectHubTracks(hub), hub.url, {
                      genome: hub.genome ?? undefined,
                      watch: true,
                      title: hub.name,
                    });
                    onCreated(id, `Started a new session from the saved copy of ${hub.name}.`);
                  })
                }
                className="rounded-lg bg-blue-600 text-white px-2.5 py-1 hover:bg-blue-700 disabled:opacity-60"
              >
                New session
              </button>
              <button
                type="button"
                disabled={busyId === hub.id}
                onClick={() =>
                  act(hub, async () => {
                    const { text, tracks } = await fetchDatahub(hub.url);
                    await saveProjectHub(owner, hub.url, text, tracks, hub.name);
                  })
                }
                className="rounded-lg border border-gray-300 px-2.5 py-1 hover:bg-gray-100 disabled:opacity-60"
              >
                {busyId === hub.id ? "Working…" : "Refresh copy"}
              </button>
              <button
                type="button"
                disabled={busyId === hub.id}
                onClick={() => {
                  if (window.confirm(`Remove the saved copy of ${hub.name}? Sessions made from it are kept.`)) {
                    void act(hub, () => deleteProjectHub(hub.id).then(() => undefined));
                  }
                }}
                className="rounded-lg border border-gray-300 px-2.5 py-1 text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TITLE_MAX = 120;

function SessionRow({ session, hubs }: { session: BrowserSession; hubs: string[] }) {
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const href = sessionPath(session.id);

  const startRename = () => {
    setDraft(session.title || "");
    setEditing(true);
  };
  const save = () => {
    const title = draft.trim().slice(0, TITLE_MAX);
    if (title !== (session.title || "")) {
      // An empty name goes back to the automatic one.
      dispatch(updateSession({ id: session.id, changes: { title } }));
    }
    setEditing(false);
  };

  return (
    <li
      className="rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-blue-400 hover:shadow-sm"
      data-testid="session-row"
      data-session-id={session.id}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {editing ? (
          <form
            className="flex flex-1 min-w-0 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              aria-label="Session name"
              maxLength={TITLE_MAX}
              value={draft}
              placeholder={displayTitle({ ...session, title: "" })}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="text-sm rounded-lg bg-blue-600 text-white px-2.5 py-1 hover:bg-blue-700"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-sm rounded-lg border border-gray-300 px-2.5 py-1 hover:bg-gray-100"
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <a href={href} className="font-medium break-all hover:underline">
              {displayTitle(session)}
            </a>
            <span className="text-xs rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
              {session.genomeId}
            </span>
            <button
              type="button"
              onClick={startRename}
              className="text-xs text-blue-700 hover:underline"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() =>
                dispatch(
                  updateSession({
                    id: session.id,
                    changes: { archived: !session.archived },
                  }),
                )
              }
              className="text-xs text-gray-600 hover:underline"
            >
              {session.archived ? "Unarchive" : "Archive"}
            </button>
          </>
        )}
        <span className="ml-auto text-xs text-gray-500">
          Updated {formatTime(session.updatedAt)}
        </span>
      </div>
      <a href={href} className="block">
        <div className="text-sm text-gray-600 mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {region(session) && <span>{region(session)}</span>}
          <span>
            {session.tracks.length} track{session.tracks.length === 1 ? "" : "s"}
          </span>
          {hubs.map((hub) => (
            <span key={hub} className="text-green-700 break-all">
              Watching {hub}
            </span>
          ))}
        </div>
        <div className="text-xs text-gray-400 mt-1 font-mono break-all">{href}</div>
      </a>
    </li>
  );
}

function watchedHubs(session: BrowserSession): string[] {
  const tags = new Set<string>();
  for (const t of session.tracks) {
    const tag = hubTagOf(t);
    if (tag) tags.add(tag.replace(/^Watched: /, ""));
  }
  return [...tags];
}

function region(session: BrowserSession): string {
  const r = session.userViewRegion ?? session.viewRegion;
  return typeof r === "string" ? r : "";
}

function displayTitle(session: BrowserSession): string {
  if (session.title) return session.title;
  const hubs = watchedHubs(session);
  if (hubs.length > 0) {
    const name = hubs[0].split("/").pop() || hubs[0];
    return `${session.genomeId} · ${name}`;
  }
  return `${session.genomeId} session`;
}

function formatTime(ms: number | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
