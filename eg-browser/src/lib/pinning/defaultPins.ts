import { ITrackModel } from "wuepgg3-track";

/**
 * Tracks pinned by default (see eg-tracks' pinnedTracks for how pinning
 * works): the ruler, the gene-name track and RepeatMasker, so position, genes
 * and repeats stay in view while scrolling through data tracks.
 *
 * The defaults apply only to a session in which no track has been pinned or
 * unpinned yet (no `options.pinned` anywhere); once the user pins or unpins
 * anything, their choice is left alone.
 */

const RULER_TYPES = ["ruler"];
const GENE_TYPES = ["geneannotation", "refbed"];
const REPEAT_TYPES = ["repeatmasker", "rmskv2"];

type Track = ITrackModel & {
  label?: string;
  options?: { pinned?: boolean } & Record<string, unknown>;
};

const typeOf = (t: Track) => String(t.type ?? t.filetype ?? "").toLowerCase();

/** Whether the defaults haven't been applied or overridden in these tracks. */
export function needsDefaultPins(tracks: Track[]): boolean {
  return (
    tracks.length > 0 &&
    !tracks.some((t) => t.options && "pinned" in t.options)
  );
}

/**
 * The tracks to pin by default: the first ruler, the gene-name track (refGene
 * if there is one, else the first gene annotation track) and the first
 * RepeatMasker track.
 */
export function defaultPinnedTracks(tracks: Track[]): Track[] {
  const ruler = tracks.find((t) => RULER_TYPES.includes(typeOf(t)));
  const genes = tracks.filter((t) => GENE_TYPES.includes(typeOf(t)));
  const gene =
    genes.find((t) => /refgene/i.test(`${t.name} ${t.label ?? ""}`)) ?? genes[0];
  const repeats = tracks.find((t) => REPEAT_TYPES.includes(typeOf(t)));
  return [ruler, gene, repeats].filter((t): t is Track => !!t);
}

/**
 * Marks the default tracks pinned (and every other track `pinned: false`, so
 * the defaults are applied once) and moves the pinned ones to the top in
 * their current order. Returns null when nothing should change.
 */
export function applyDefaultPins(tracks: Track[]): Track[] | null {
  if (!needsDefaultPins(tracks)) return null;
  const toPin = new Set(defaultPinnedTracks(tracks));
  if (toPin.size === 0) return null;
  const marked = tracks.map((t) => ({
    ...t,
    options: { ...(t.options ?? {}), pinned: toPin.has(t) },
  }));
  return [
    ...marked.filter((t) => t.options.pinned),
    ...marked.filter((t) => !t.options.pinned),
  ];
}
