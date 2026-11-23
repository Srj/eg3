import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { UserCircleIcon } from "@heroicons/react/24/outline";

import {
  getCurrentProfile,
  signOut,
  subscribeCurrentProfile,
} from "@/lib/profiles/profiles";
import { SESSION_LIST_PATH } from "@/lib/session-route";

/** Signed-in user id with My sessions / Sign out. Nothing when embedded. */
export default function ProfileMenu({ className = "" }: { className?: string }) {
  const profile = useSyncExternalStore(subscribeCurrentProfile, getCurrentProfile);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!profile) return null;

  return (
    <div ref={ref} className={`relative flex-shrink-0 ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-gray-700 dark:text-dark-primary hover:bg-gray-100 dark:hover:bg-gray-700"
        title={`Signed in as ${profile.userId}`}
      >
        <UserCircleIcon className="size-5" />
        <span className="max-w-32 truncate">{profile.userId}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 min-w-40 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-dark-surface shadow-lg py-1 text-sm"
        >
          <a
            role="menuitem"
            href={SESSION_LIST_PATH}
            className="block px-3 py-1.5 text-gray-800 dark:text-dark-primary hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            My sessions
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="block w-full text-left px-3 py-1.5 text-gray-800 dark:text-dark-primary hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
