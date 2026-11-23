import { FormEvent, useState } from "react";

import App from "@/App";
import SessionsPage from "./SessionsPage";
import { isSessionListPath } from "@/lib/session-route";
import {
  ActiveProfile,
  createProfile,
  getActiveProfile,
  listProfiles,
  PASSWORD_MIN,
  ProfileError,
  setCurrentProfile,
  signIn,
  USER_ID_MAX,
} from "@/lib/profiles/profiles";

/**
 * Web app entry: asks for a local profile, then shows the browser with that
 * profile's own saved state. The address (e.g. a /session/<id> link) is kept,
 * so it opens once the profile is signed in.
 */
export default function ProfileGate() {
  const [active, setActive] = useState<ActiveProfile | null>(() => {
    const p = getActiveProfile();
    setCurrentProfile(p);
    return p;
  });

  if (active) {
    // /browser/ and /browser/sessions list the profile's sessions; any other
    // address (a /session/<id> link, ?genome=..., /new) opens the browser.
    if (isSessionListPath(window.location)) {
      return <SessionsPage key={active.id} profile={active} />;
    }
    // Keyed by profile, so switching profiles never reuses another's store.
    return <App key={active.id} storeConfig={{ storeId: active.storeId }} />;
  }
  return (
    <SignIn
      onSignedIn={(p) => {
        setCurrentProfile(p);
        setActive(p);
      }}
    />
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (p: ActiveProfile) => void }) {
  const hasProfiles = listProfiles().length > 0;
  const [mode, setMode] = useState<"signin" | "create">(hasProfiles ? "signin" : "create");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "create" && password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const profile =
        mode === "create"
          ? await createProfile(userId, password, remember)
          : await signIn(userId, password, remember);
      onSignedIn(profile);
    } catch (err) {
      setError(
        err instanceof ProfileError
          ? err.message
          : `Something went wrong: ${(err as Error).message}`,
      );
      setBusy(false);
    }
  };

  const switchMode = (next: "signin" | "create") => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const input =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-base bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-xl shadow-md border border-gray-200 p-6 flex flex-col gap-4"
        aria-label={mode === "create" ? "Create profile" : "Sign in"}
      >
        <div>
          <h1 className="text-xl text-gray-900">
            <span className="font-semibold">WashU</span> Epigenome Browser
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === "create"
              ? "Create a profile to keep your sessions apart from others using this browser."
              : "Sign in to your profile."}
          </p>
        </div>

        <div className="flex rounded-lg bg-gray-100 p-1 text-sm" role="tablist">
          {(["signin", "create"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`flex-1 rounded-md py-1.5 ${
                mode === m ? "bg-white shadow text-gray-900 font-medium" : "text-gray-500"
              }`}
            >
              {m === "signin" ? "Sign in" : "Create profile"}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          User id
          <input
            className={input}
            name="userId"
            autoComplete="username"
            autoFocus
            maxLength={USER_ID_MAX}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Password
          <input
            className={input}
            name="password"
            type="password"
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            minLength={mode === "create" ? PASSWORD_MIN : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {mode === "create" && (
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Confirm password
            <input
              className={input}
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Keep me signed in
        </label>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-600 text-white py-2 font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Please wait…" : mode === "create" ? "Create profile" : "Sign in"}
        </button>

        <p className="text-xs text-gray-500 leading-relaxed">
          Profiles are stored only in this browser. They keep sessions apart
          but don't protect them: anyone using this browser profile can read
          saved data. A forgotten password can't be recovered.
          {mode === "create" && !hasProfiles &&
            " Your first profile keeps the sessions already saved in this browser."}
        </p>
      </form>
    </div>
  );
}
