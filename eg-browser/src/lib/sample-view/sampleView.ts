import { ITrackModel } from "wuepgg3-track";

/**
 * The Samples menu: show or hide data tracks by sample, condition, biological
 * replicate and assay, and put each assay on one shared y-scale.
 *
 * Tracks are recognised from metadata (sample, condition, replicate, assay)
 * or, failing that, from names like
 *   B49_DMSO_R1.RNA-seq.plus.CPM  ->  B49 / DMSO / BR1 / "RNA-seq +"
 * Every recognised track is kept in a catalog saved with the session, so a
 * hidden track can be shown again. Tracks that aren't recognised (ruler,
 * genes, annotations...) are never touched.
 */

export const AGGREGATE = "AGG";

export interface TrackFacets {
  sample: string;
  condition: string;
  /** "1", "2", ... */
  replicate: string;
  /** Display name, e.g. "RNA-seq +", "ATAC-seq". */
  assay: string;
}

export interface CatalogEntry {
  /** Track definition as first seen (no id, not selected). */
  track: ITrackModel;
  facets: TrackFacets;
}

export interface AssaySettings {
  shown: boolean;
  sameScale: boolean;
  yMin: number | null;
  yMax: number | null;
  /** One color for every track of the assay (null: the tracks' own). */
  color?: string | null;
}

export interface SampleViewState {
  catalog: CatalogEntry[];
  samples: Record<string, boolean>;
  conditions: Record<string, boolean>;
  /** "1", "2", ... and AGGREGATE. */
  replicates: Record<string, boolean>;
  assays: Record<string, AssaySettings>;
  /**
   * Color per replicate ("1", "2", ...): the lines in Aggregated overlays,
   * and individual tracks of assays without their own color.
   */
  replicateColors?: Record<string, string | null>;
}

type AnyTrack = ITrackModel & {
  label?: string;
  datahub?: string;
  options?: Record<string, unknown> & { pinned?: boolean };
  metadata?: Record<string, unknown>;
  tracks?: ITrackModel[];
};

/** Track types a matplot (the overlay used for Aggregated) can draw. */
const NUMERICAL = ["bigwig", "bedgraph"];
const AGG_MARK = "sampleViewAggregate";
/** Colors for the 2nd, 3rd... replicate in an Aggregated overlay. */
const REPLICATE_COLORS = ["#d62728", "#2ca02c", "#9467bd", "#ff7f0e"];

const NAME_PATTERN =
  /^([A-Za-z]+\d+[A-Za-z]*)_([^_.]+)_(?:R|BR|rep)(\d+)\.([^.]+)(?:\.(plus|minus|pos|neg|fwd|rev|\+|-))?(?:\.|$)/i;

const STRAND: Record<string, string> = {
  plus: "+", pos: "+", fwd: "+", forward: "+", "+": "+",
  minus: "−", neg: "−", rev: "−", reverse: "−", "-": "−", "−": "−",
};

const typeOf = (t: AnyTrack) => String(t.type ?? t.filetype ?? "").toLowerCase();

/**
 * Metadata keys read from a datahub track (case and spacing don't matter),
 * e.g. "metadata": {"sample": "B49", "condition": "DMSO", "replicate": 1,
 * "assay": "RNA-seq", "strand": "+"}.
 */
export const METADATA_KEYS = {
  sample: ["sample", "samplename", "sampleid", "cellline", "cell", "line", "patient", "donor"],
  condition: ["condition", "treatment", "group", "state"],
  replicate: ["replicate", "rep", "br", "biologicalreplicate", "bioreplicate", "biorep"],
  assay: ["assay", "assaytype", "experiment", "datatype"],
  strand: ["strand"],
} as const;

const normKey = (k: string) => k.toLowerCase().replace(/[\s_.-]/g, "");

function metaValue(meta: Record<string, unknown>, field: keyof typeof METADATA_KEYS): string {
  for (const [k, v] of Object.entries(meta)) {
    if ((METADATA_KEYS[field] as readonly string[]).includes(normKey(k))) {
      // the browser stores some metadata as arrays (e.g. ["B49"])
      const value = Array.isArray(v) ? v[v.length - 1] : v;
      if (typeof value === "string" || typeof value === "number") return String(value).trim();
    }
  }
  return "";
}

/** Sample, condition, replicate and assay of a track, or null if it isn't one. */
export function parseTrack(track: AnyTrack): TrackFacets | null {
  if (track.metadata?.[AGG_MARK]) return null;
  const m = track.metadata ?? {};
  const metaSample = metaValue(m, "sample");
  const metaAssay = metaValue(m, "assay");
  if (metaSample && metaAssay) {
    const metaStrand = STRAND[metaValue(m, "strand").toLowerCase()];
    return {
      sample: metaSample,
      condition: metaValue(m, "condition") || "—",
      replicate: metaValue(m, "replicate").replace(/^(BR|R|rep)/i, "") || "1",
      assay: metaStrand ? `${metaAssay} ${metaStrand}` : metaAssay,
    };
  }
  const match = NAME_PATTERN.exec(String(track.name ?? ""));
  if (!match) return null;
  const [, sample, condition, replicate, assayName, strand] = match;
  const assay = assayName === "WGBS" || typeOf(track) === "methylc"
    ? assayName
    : strand
      ? `${assayName} ${STRAND[strand.toLowerCase()]}`
      : assayName;
  return { sample, condition, replicate, assay };
}

const trackKey = (t: AnyTrack) => String(t.url ?? t.name);

const clean = (t: AnyTrack): ITrackModel => {
  const { id: _id, isSelected: _sel, ...rest } = t as AnyTrack & { isSelected?: boolean };
  void _id;
  void _sel;
  return JSON.parse(JSON.stringify(rest));
};

/**
 * Adds the recognised tracks of `tracks` that the catalog doesn't have yet,
 * keeping catalog order (new ones at the end). Returns the same array when
 * nothing is new.
 */
export function updateCatalog(catalog: CatalogEntry[], tracks: AnyTrack[]): CatalogEntry[] {
  const known = new Set(catalog.map((e) => trackKey(e.track as AnyTrack)));
  const added: CatalogEntry[] = [];
  for (const t of tracks) {
    const facets = parseTrack(t);
    if (!facets || known.has(trackKey(t))) continue;
    known.add(trackKey(t));
    added.push({ track: clean(t), facets });
  }
  return added.length ? [...catalog, ...added] : catalog;
}

/** All values of each column, in catalog order. */
export function columns(catalog: CatalogEntry[]) {
  const uniq = (f: (e: CatalogEntry) => string) => [...new Set(catalog.map(f))];
  return {
    samples: uniq((e) => e.facets.sample),
    conditions: uniq((e) => e.facets.condition),
    replicates: uniq((e) => e.facets.replicate).sort(),
    assays: uniq((e) => e.facets.assay),
  };
}

/** Starting selections: everything that's in the session now is ticked. */
export function initialState(catalog: CatalogEntry[], sessionTracks: AnyTrack[]): SampleViewState {
  const inSession = new Set(sessionTracks.map(trackKey));
  const shown = catalog.filter((e) => inSession.has(trackKey(e.track as AnyTrack)));
  const pick = (all: string[], f: (e: CatalogEntry) => string) =>
    Object.fromEntries(all.map((v) => [v, shown.some((e) => f(e) === v)]));
  const cols = columns(catalog);
  return {
    catalog,
    samples: pick(cols.samples, (e) => e.facets.sample),
    conditions: pick(cols.conditions, (e) => e.facets.condition),
    replicates: { ...pick(cols.replicates, (e) => e.facets.replicate), [AGGREGATE]: false },
    assays: Object.fromEntries(
      cols.assays.map((a) => [
        a,
        { shown: shown.some((e) => e.facets.assay === a), sameScale: false, yMin: null, yMax: null },
      ]),
    ),
  };
}

/** Whether every value an assay needs for a shared scale is set. */
export function scaleReady(s: AssaySettings | undefined): s is AssaySettings & { yMin: number; yMax: number } {
  return !!s?.sameScale && s.yMin !== null && s.yMax !== null && s.yMin < s.yMax;
}

function withScale(options: Record<string, unknown> | undefined, s: AssaySettings | undefined) {
  if (!scaleReady(s)) return options;
  return { ...(options ?? {}), yScale: "fixed", yMin: s.yMin, yMax: s.yMax };
}

/** The browser's default methylC colors (eg-tracks MethylCTrackComputation). */
export const METHYLC_DEFAULT_CONTEXT_COLORS: Record<string, { color: string; background: string }> = {
  CG: { color: "rgb(100,139,216)", background: "#d9d9d9" },
  CHG: { color: "rgb(255,148,77)", background: "#ffe0cc" },
  CHH: { color: "rgb(255,0,255)", background: "#ffe5ff" },
};

/**
 * Sets a track's color. Numerical tracks: `color` and `color2` (values below
 * zero, e.g. minus-strand signal, are drawn in color2). methylC tracks: the
 * methylated-fraction color of each context, keeping its background.
 */
function withColor(
  options: Record<string, unknown> | undefined,
  color: string | null | undefined,
  type: string,
) {
  if (!color) return options;
  if (type === "methylc") {
    const current = (options?.colorsForContext ?? METHYLC_DEFAULT_CONTEXT_COLORS) as Record<
      string,
      { color: string; background: string }
    >;
    const contexts = Object.fromEntries(
      Object.entries(current).map(([ctx, c]) => [ctx, { ...c, color }]),
    );
    return { ...(options ?? {}), colorsForContext: contexts };
  }
  return { ...(options ?? {}), color, color2: color };
}

/** A track's current main color as #rrggbb (for color swatches). */
export function trackColor(track: AnyTrack): string {
  const o = (track.options ?? {}) as { color?: string; colorsForContext?: Record<string, { color?: string }> };
  const raw =
    typeOf(track) === "methylc"
      ? (o.colorsForContext ?? METHYLC_DEFAULT_CONTEXT_COLORS).CG?.color ?? METHYLC_DEFAULT_CONTEXT_COLORS.CG.color
      : o.color ?? "#000000";
  return toHex(raw);
}

function toHex(color: string): string {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (rgb) return "#" + rgb.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{3}$/i.test(color)) return "#" + color.slice(1).split("").map((c) => c + c).join("");
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}

/** The color picked for a track: its assay's, else its replicate's. */
export function pickedColor(state: SampleViewState, facets: TrackFacets): string | null {
  return state.assays[facets.assay]?.color || state.replicateColors?.[facets.replicate] || null;
}

const sameDef = (a: AnyTrack, b: AnyTrack) =>
  JSON.stringify([a.url, a.type, a.options, (a.tracks ?? []).map((t) => [t.url, t.options])]) ===
  JSON.stringify([b.url, b.type, b.options, (b.tracks ?? []).map((t) => [t.url, t.options])]);

/**
 * The session's tracks with the Samples selections applied. Unrecognised
 * tracks keep their place; the recognised ones (and Aggregated overlays) are
 * rebuilt in catalog order where the first of them was. A track whose
 * definition is unchanged keeps its id (so it isn't reloaded); a changed one
 * gets a new id, since the track view only redraws options on a new id.
 */
export function applySampleView(
  sessionTracks: AnyTrack[],
  state: SampleViewState,
  newId: () => string,
): AnyTrack[] {
  const isManaged = (t: AnyTrack) => !!parseTrack(t) || !!t.metadata?.[AGG_MARK];
  const existing = new Map<string, AnyTrack>();
  for (const t of sessionTracks) {
    if (isManaged(t)) existing.set(t.metadata?.[AGG_MARK] ? `agg:${t.metadata[AGG_MARK]}` : trackKey(t), t);
  }

  const on = (e: CatalogEntry) =>
    !!state.samples[e.facets.sample] &&
    !!state.conditions[e.facets.condition] &&
    !!state.assays[e.facets.assay]?.shown;

  const wanted: AnyTrack[] = [];
  const aggregated = new Set<string>();
  const keep = (def: AnyTrack, key: string) => {
    const old = existing.get(key);
    const pinned = (old?.options as { pinned?: boolean } | undefined)?.pinned;
    const next = { ...def, options: { ...(def.options ?? {}), ...(pinned !== undefined ? { pinned } : {}) } };
    wanted.push(old && sameDef(old, next) ? { ...next, id: old.id } : { ...next, id: newId() });
  };

  for (const e of state.catalog) {
    if (!on(e)) continue;
    const settings = state.assays[e.facets.assay];
    const base = e.track as AnyTrack;
    // Assays that can't be overlaid (methylC, e.g. WGBS) always show every
    // replicate; the replicate boxes and Aggregated apply to the others.
    const allReplicates = !NUMERICAL.includes(typeOf(base));
    if (allReplicates || state.replicates[e.facets.replicate]) {
      keep(
        {
          ...base,
          options: withColor(
            withScale(base.options, settings),
            pickedColor(state, e.facets),
            typeOf(base),
          ),
        } as AnyTrack,
        trackKey(base),
      );
    }
    // One overlay per sample/condition/assay, at its first replicate.
    const group = `${e.facets.sample}|${e.facets.condition}|${e.facets.assay}`;
    if (state.replicates[AGGREGATE] && NUMERICAL.includes(typeOf(base)) && !aggregated.has(group)) {
      aggregated.add(group);
      const members = state.catalog.filter(
        (o) =>
          `${o.facets.sample}|${o.facets.condition}|${o.facets.assay}` === group &&
          NUMERICAL.includes(typeOf(o.track as AnyTrack)),
      );
      if (members.length > 1) {
        const label = `${e.facets.sample}_${e.facets.condition} ${e.facets.assay} (BR${members.map((o) => o.facets.replicate).join("+")})`;
        keep(
          {
            type: "matplot",
            name: label,
            url: "",
            options: withScale({ label }, settings),
            metadata: { [AGG_MARK]: group },
            tracks: members.map((o, i) => ({
              ...clean(o.track as AnyTrack),
              id: `${group}#${i}`,
              options: withColor(
                { ...((o.track as AnyTrack).options ?? {}), label: `BR${o.facets.replicate}` },
                // a replicate's own color; else the first keeps the assay's
                // (picked or original) color and the others contrast
                state.replicateColors?.[o.facets.replicate] ||
                  (i === 0
                    ? settings?.color
                    : REPLICATE_COLORS[(i - 1) % REPLICATE_COLORS.length]),
                typeOf(o.track as AnyTrack),
              ),
            })),
          } as unknown as AnyTrack,
          `agg:${group}`,
        );
      }
    }
  }

  const firstManaged = sessionTracks.findIndex(isManaged);
  const others = sessionTracks.filter((t) => !isManaged(t));
  const at = firstManaged < 0 ? others.length : sessionTracks.slice(0, firstManaged).filter((t) => !isManaged(t)).length;
  return [...others.slice(0, at), ...wanted, ...others.slice(at)];
}

/**
 * Whether the session's sample tracks already match the selections. False
 * also when tracks were added or removed some other way (right-click
 * Remove, a hub change...), so Apply can bring the session back in line.
 */
export function tracksMatchSelections(sessionTracks: AnyTrack[], state: SampleViewState): boolean {
  const managedKeys = (tracks: AnyTrack[]) =>
    tracks
      .filter((t) => parseTrack(t) || t.metadata?.[AGG_MARK])
      .map((t) => (t.metadata?.[AGG_MARK] ? `agg:${t.metadata[AGG_MARK]}` : trackKey(t)))
      .join("\n");
  let n = 0;
  const wanted = applySampleView(sessionTracks, state, () => `tmp${++n}`);
  return managedKeys(wanted) === managedKeys(sessionTracks);
}

/**
 * Whether an assay's replicates can be overlaid (bigWig/bedGraph). Assays that
 * can't (methylC, e.g. WGBS) always show all their replicates.
 */
export function isOverlayable(catalog: CatalogEntry[], assay: string): boolean {
  return catalog.some((e) => e.facets.assay === assay && NUMERICAL.includes(typeOf(e.track as AnyTrack)));
}

/**
 * Replaces catalog entries with the current definition of the same track
 * (matched by URL) from `tracks`, e.g. a watched hub's latest version, so a
 * track shown again from the menu matches the hub. Returns the same array
 * when nothing changed.
 */
export function refreshCatalog(catalog: CatalogEntry[], tracks: AnyTrack[]): CatalogEntry[] {
  const latest = new Map(tracks.map((t) => [trackKey(t), t]));
  let changed = false;
  const next = catalog.map((e) => {
    const t = latest.get(trackKey(e.track as AnyTrack));
    if (!t) return e;
    const track = clean(t);
    const facets = parseTrack(t) ?? e.facets;
    if (JSON.stringify(track) === JSON.stringify(e.track) && JSON.stringify(facets) === JSON.stringify(e.facets)) return e;
    changed = true;
    return { track, facets };
  });
  return changed ? next : catalog;
}
