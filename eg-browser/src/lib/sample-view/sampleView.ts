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

/**
 * Sets a track's color. `color2` too: numerical tracks draw values below
 * zero (e.g. minus-strand signal) in color2.
 */
function withColor(options: Record<string, unknown> | undefined, color: string | null | undefined) {
  if (!color) return options;
  return { ...(options ?? {}), color, color2: color };
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
    if (state.replicates[e.facets.replicate]) {
      keep(
        {
          ...base,
          options: withColor(withScale(base.options, settings), pickedColor(state, e.facets)),
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
