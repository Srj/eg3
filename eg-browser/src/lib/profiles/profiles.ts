/**
 * Local profiles: a user id and password that keep several people's sessions
 * apart in one browser. Only the standalone web app uses them (see
 * `ProfileGate`); each profile gets its own Redux store id, so its sessions,
 * settings and history are saved under their own key (`persist:<storeId>`).
 *
 * Passwords are never stored, only a salted PBKDF2 hash. This is separation,
 * not security: saved state isn't encrypted, so anyone with access to this
 * browser profile can read it with the developer tools. Nothing leaves the
 * browser, and there is no password recovery.
 */

export interface Profile {
  id: string;
  /** What the user signs in with; unique, compared case-insensitively. */
  userId: string;
  /** Redux store id; its state is saved under `persist:<storeId>`. */
  storeId: string;
  salt: string;
  hash: string;
  iterations: number;
  createdAt: number;
}

export interface ActiveProfile {
  id: string;
  userId: string;
  storeId: string;
}

const PROFILES_KEY = "eg3:profiles";
const ACTIVE_KEY = "eg3:activeProfile";
const ITERATIONS = 210_000; // OWASP 2023 guidance for PBKDF2-SHA256
const DEFAULT_STORE_ID = "root";

export const USER_ID_MAX = 64;
export const PASSWORD_MIN = 6;

// MARK: - storage helpers

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    return JSON.parse(storage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function listProfiles(): Profile[] {
  return readJson<Profile[]>(localStorage, PROFILES_KEY) ?? [];
}

function saveProfiles(profiles: Profile[]) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function findProfile(userId: string): Profile | undefined {
  const wanted = userId.trim().toLowerCase();
  return listProfiles().find((p) => p.userId.toLowerCase() === wanted);
}

// MARK: - hashing

const toB64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function hashPassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return toB64(bits);
}

/** Compares without stopping at the first difference. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// MARK: - actions

export class ProfileError extends Error {}

export function validateUserId(userId: string): string | null {
  const id = userId.trim();
  if (!id) return "Enter a user id.";
  if (id.length > USER_ID_MAX) return `User id must be at most ${USER_ID_MAX} characters.`;
  if (/\s/.test(id)) return "User id can't contain spaces.";
  return null;
}

/** Creates a profile and signs it in. */
export async function createProfile(
  userId: string,
  password: string,
  remember: boolean,
): Promise<ActiveProfile> {
  const idError = validateUserId(userId);
  if (idError) throw new ProfileError(idError);
  if (password.length < PASSWORD_MIN) {
    throw new ProfileError(`Password must be at least ${PASSWORD_MIN} characters.`);
  }
  if (findProfile(userId)) throw new ProfileError("That user id is already taken.");

  const profiles = listProfiles();
  const id = crypto.randomUUID();
  // The first profile takes over the sessions saved before profiles existed.
  const takesDefault = !profiles.some((p) => p.storeId === DEFAULT_STORE_ID);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const profile: Profile = {
    id,
    userId: userId.trim(),
    storeId: takesDefault ? DEFAULT_STORE_ID : `profile-${id}`,
    salt: toB64(salt),
    hash: await hashPassword(password, salt, ITERATIONS),
    iterations: ITERATIONS,
    createdAt: Date.now(),
  };
  saveProfiles([...profiles, profile]);
  return setActive(profile, remember);
}

/** Checks the password and signs the profile in. */
export async function signIn(
  userId: string,
  password: string,
  remember: boolean,
): Promise<ActiveProfile> {
  const profile = findProfile(userId);
  // Same message either way, so the form doesn't reveal which ids exist.
  const wrong = new ProfileError("Wrong user id or password.");
  if (!profile) {
    await hashPassword(password, new Uint8Array(16), ITERATIONS); // same delay
    throw wrong;
  }
  const hash = await hashPassword(password, fromB64(profile.salt), profile.iterations);
  if (!sameString(hash, profile.hash)) throw wrong;
  return setActive(profile, remember);
}

function setActive(profile: Profile, remember: boolean): ActiveProfile {
  const active: ActiveProfile = {
    id: profile.id,
    userId: profile.userId,
    storeId: profile.storeId,
  };
  // "Keep me signed in" survives closing the browser; otherwise only this tab
  // stays signed in, across reloads.
  clearActive();
  (remember ? localStorage : sessionStorage).setItem(ACTIVE_KEY, JSON.stringify(active));
  return active;
}

function clearActive() {
  try {
    localStorage.removeItem(ACTIVE_KEY);
    sessionStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage unavailable
  }
}

/** The signed-in profile, if it still exists. */
export function getActiveProfile(): ActiveProfile | null {
  const active =
    readJson<ActiveProfile>(sessionStorage, ACTIVE_KEY) ??
    readJson<ActiveProfile>(localStorage, ACTIVE_KEY);
  if (!active) return null;
  return listProfiles().some((p) => p.id === active.id) ? active : null;
}

/** Signs out and returns to the start page, dropping this profile's state from memory. */
export function signOut() {
  clearActive();
  window.location.assign(import.meta.env.BASE_URL || "/");
}

// MARK: - React access (web app only; null when embedded)

let current: ActiveProfile | null = null;
const listeners = new Set<() => void>();

export function setCurrentProfile(profile: ActiveProfile | null) {
  current = profile;
  for (const l of listeners) l();
}

export function subscribeCurrentProfile(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCurrentProfile() {
  return current;
}
