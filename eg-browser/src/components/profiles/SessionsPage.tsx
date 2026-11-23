import { useMemo, useState } from "react";

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

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...sessions]
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
  }, [sessions, query]);

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
          <a
            href={NEW_SESSION_PATH}
            className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-700"
          >
            New session
          </a>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-600">
            <p>No sessions yet.</p>
            <p className="text-sm mt-1">
              Start one with <span className="font-medium">New session</span>, or
              open a hub link like{" "}
              <code className="text-xs bg-gray-100 px-1 rounded">
                /browser/session/create/&lt;hub url&gt;
              </code>
              .
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-gray-600">No sessions match “{query}”.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="session-list">
            {rows.map(({ session, hubs }) => (
              <SessionRow key={session.id} session={session} hubs={hubs} />
            ))}
          </ul>
        )}
      </main>
    </div>
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
