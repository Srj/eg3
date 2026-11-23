import { RefObject, useEffect, useMemo } from "react";

/**
 * Pinned tracks: tracks with `options.pinned` are kept together at the top of
 * the track list and stay in view while the page scrolls down past them.
 *
 * CSS `position: sticky` can't do this here: the track list sits inside
 * containers with `overflow` set (the horizontal scroll root and the track
 * area), and sticky only sticks within the nearest such container. Instead the
 * pinned rows are shifted down with a transform as the page scrolls, which
 * keeps them inside the same container, so panning and dragging still work.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WithOptions = { id?: unknown; options?: any };

export function isPinned(track: WithOptions): boolean {
  return !!track?.options?.pinned;
}

/** Pinned tracks first, each group keeping its order. */
export function pinnedFirst<T extends WithOptions>(tracks: T[]): T[] {
  const pinned = tracks.filter(isPinned);
  if (pinned.length === 0) return tracks;
  return [...pinned, ...tracks.filter((t) => !isPinned(t))];
}

/** Ids of the pinned tracks, as strings. */
export function usePinnedTrackIds(tracks: WithOptions[] | undefined): Set<string> {
  const key = (tracks ?? [])
    .filter(isPinned)
    .map((t) => String(t.id))
    .join("|");
  return useMemo(() => new Set(key ? key.split("|") : []), [key]);
}

export const PINNED_ATTR = "data-pinned-track";

const SHADOW = "0 6px 6px -4px rgba(0, 0, 0, 0.35)";

/** Gap (px) between the top of the visible area and the pinned tracks. */
export const PINNED_TOP_GAP = 10;

/** Frame drawn around the pinned group so it's easy to tell apart. */
const FRAME_COLOR = "#2563eb";
const FRAME_WIDTH = 2;

/**
 * Keeps the rows marked with PINNED_ATTR inside `wrapperRef` at the top of the
 * visible area while their scrolling ancestor scrolls. `rerunKey` should
 * change whenever rows are added, removed or reordered.
 */
export function usePinnedTrackScroll(
  wrapperRef: RefObject<HTMLElement | null>,
  pinnedIds: Set<string>,
  rerunKey: unknown,
) {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || pinnedIds.size === 0) return;

    // Everything that can scroll the track list vertically, and everything
    // that clips or scrolls it sideways (for the frame's width).
    const scrollers: HTMLElement[] = [];
    const sideways: HTMLElement[] = [];
    for (let el = wrapper.parentElement; el; el = el.parentElement) {
      const { overflowY, overflowX } = getComputedStyle(el);
      if (overflowY === "auto" || overflowY === "scroll") scrollers.push(el);
      if (overflowX !== "visible") sideways.push(el);
    }

    // The frame: an overlay above the pinned rows (a border on the rows
    // themselves would be painted over by the track drawings).
    const frameEl = document.createElement("div");
    frameEl.setAttribute("data-pinned-frame", "");
    Object.assign(frameEl.style, {
      position: "absolute",
      pointerEvents: "none",
      zIndex: "5",
      boxSizing: "border-box",
      border: `${FRAME_WIDTH}px solid ${FRAME_COLOR}`,
      borderRadius: "4px",
    });
    const restorePosition = wrapper.style.position;
    if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";
    wrapper.appendChild(frameEl);
    const background = opaqueBackground(wrapper);
    const styled = new Set<HTMLElement>();

    let frame = 0;
    const update = () => {
      frame = 0;
      const rows = Array.from(wrapper.querySelectorAll<HTMLElement>(`[${PINNED_ATTR}]`));
      if (rows.length === 0) return;
      // Top of the visible area: the lowest top edge among the scrollers
      // that are actually scrolled or scrollable (0 is the window's).
      let viewTop = 0;
      for (const el of scrollers) {
        if (el.scrollHeight > el.clientHeight) {
          viewTop = Math.max(viewTop, el.getBoundingClientRect().top);
        }
      }
      const list = wrapper.getBoundingClientRect();
      const pinnedHeight = rows.reduce((sum, row) => sum + row.offsetHeight, 0);
      const offset = Math.max(
        0,
        Math.min(viewTop + PINNED_TOP_GAP - list.top, list.height - pinnedHeight),
      );
      rows.forEach((row, i) => {
        styled.add(row);
        row.style.transform = offset > 0 ? `translateY(${offset}px)` : "";
        row.style.backgroundColor = background;
        row.style.boxShadow = offset > 0 && i === rows.length - 1 ? SHADOW : "";
      });

      // Frame the pinned group across the part of the list that's visible
      // sideways (the list can be much wider than the view when panning).
      let left = list.left;
      let right = list.right;
      for (const el of sideways) {
        const r = el.getBoundingClientRect();
        left = Math.max(left, r.left);
        right = Math.min(right, r.right);
      }
      const firstTop = rows[0].offsetTop;
      Object.assign(frameEl.style, {
        display: right > left ? "block" : "none",
        top: `${firstTop + offset}px`,
        left: `${left - list.left}px`,
        width: `${Math.max(0, right - left)}px`,
        height: `${pinnedHeight}px`,
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    for (const el of new Set([...scrollers, ...sideways])) {
      el.addEventListener("scroll", schedule, { passive: true });
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(wrapper);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      for (const el of new Set([...scrollers, ...sideways])) {
        el.removeEventListener("scroll", schedule);
      }
      frameEl.remove();
      wrapper.style.position = restorePosition;
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      // Rows that are unpinned keep their DOM node, so clear what was set.
      for (const row of styled) {
        row.style.transform = "";
        row.style.backgroundColor = "";
        row.style.boxShadow = "";
      }
    };
  }, [wrapperRef, pinnedIds, rerunKey]);
}

/** The first non-transparent background behind `el`, so pinned rows cover what scrolls under them. */
function opaqueBackground(el: HTMLElement): string {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return "white";
}
