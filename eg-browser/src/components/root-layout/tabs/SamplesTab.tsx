import { useEffect, useMemo, useState } from "react";
import { generateUUID } from "wuepgg3-track";

import useExpandedNavigationTab from "@/lib/hooks/useExpandedNavigationTab";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { selectCurrentSession, updateSession } from "@/lib/redux/slices/browserSlice";
import { setNavigationTab } from "@/lib/redux/slices/navigationSlice";
import {
  AGGREGATE,
  applySampleView,
  AssaySettings,
  columns,
  initialState,
  parseTrack,
  SampleViewState,
  scaleReady,
  updateCatalog,
} from "@/lib/sample-view/sampleView";
import { bigWigRange } from "@/lib/sample-view/autoScale";

/**
 * Samples menu: tick samples, conditions, biological replicates and assays to
 * show their tracks; give an assay one shared y-scale. Changes are a draft
 * until Apply, which updates the tracks and closes the panel. Selections are
 * saved with the session.
 */
export default function SamplesTab() {
  useExpandedNavigationTab();
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCurrentSession);

  // The applied state, with any newly recognised tracks (e.g. from a watched
  // hub) added to the catalog and their column values shown.
  const applied: SampleViewState | null = useMemo(() => {
    if (!session) return null;
    const saved = session.sampleView;
    const catalog = updateCatalog(saved?.catalog ?? [], session.tracks);
    const fresh = initialState(catalog, session.tracks);
    if (!saved) return fresh;
    return {
      catalog,
      samples: { ...fresh.samples, ...saved.samples },
      conditions: { ...fresh.conditions, ...saved.conditions },
      replicates: { ...fresh.replicates, ...saved.replicates },
      assays: { ...fresh.assays, ...saved.assays },
      replicateColors: { ...(saved.replicateColors ?? {}) },
    };
  }, [session]);

  // What the panel shows and edits; only Apply puts it into the session.
  const [draft, setDraft] = useState<SampleViewState | null>(applied);
  const [touched, setTouched] = useState(false);
  // Follow the session (e.g. new hub tracks) while nothing is being edited.
  useEffect(() => {
    if (!touched) setDraft(applied);
  }, [applied, touched]);

  const state = draft ?? applied;
  if (!session || !state || !applied) return null;
  const cols = columns(state.catalog);

  if (state.catalog.length === 0) {
    return (
      <div className="p-4 text-sm text-primary/70 dark:text-dark-primary/70">
        No sample tracks were recognised in this session. Track names should
        look like <code>B49_DMSO_R1.RNA-seq.plus.CPM</code> (sample_condition_
        replicate.assay[.strand]), or tracks should have <code>sample</code>,{" "}
        <code>condition</code>, <code>replicate</code> and <code>assay</code>{" "}
        metadata.
      </div>
    );
  }

  const commit = (next: SampleViewState) => {
    setDraft(next);
    setTouched(true);
  };
  const selections = (s: SampleViewState) =>
    JSON.stringify([s.samples, s.conditions, s.replicates, s.assays, s.replicateColors ?? {}]);
  const pending = selections(state) !== selections(applied);
  const apply = () => {
    const next = { ...state, catalog: applied.catalog };
    dispatch(
      updateSession({
        id: session.id,
        changes: {
          sampleView: next,
          tracks: applySampleView(session.tracks, next, generateUUID),
        },
      }),
    );
    setTouched(false);
    dispatch(setNavigationTab(null)); // close the panel
  };
  const reset = () => {
    setDraft(applied);
    setTouched(false);
  };
  const toggle = (
    column: "samples" | "conditions" | "replicates",
    value: string,
    on: boolean,
  ) => commit({ ...state, [column]: { ...state[column], [value]: on } });
  const setAll = (column: "samples" | "conditions", on: boolean) =>
    commit({
      ...state,
      [column]: Object.fromEntries(Object.keys(state[column]).map((k) => [k, on])),
    });
  const setAssay = (assay: string, changes: Partial<AssaySettings>) =>
    commit({
      ...state,
      assays: { ...state.assays, [assay]: { ...state.assays[assay], ...changes } },
    });

  const visibleData = session.tracks.filter((t) => parseTrack(t)).length;
  const overlays = session.tracks.filter((t) => t.type === "matplot").length;

  return (
    <div className="p-3 flex flex-col gap-3 text-sm text-primary dark:text-dark-primary">
      <p className="text-primary/70 dark:text-dark-primary/70">
        Colors: an assay's color applies to all its tracks; a replicate's
        color colors that replicate's line in Aggregated overlays, and its
        tracks of assays without a color.
      </p>
      <p className="text-primary/70 dark:text-dark-primary/70">
        Showing {visibleData} of {state.catalog.length} sample tracks
        {overlays > 0 && `, plus ${overlays} aggregated overlay${overlays === 1 ? "" : "s"}`}.
        Other tracks (ruler, genes, annotations) aren't affected.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={!pending}
          className="rounded-lg bg-blue-600 text-white px-3 py-1.5 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!pending}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-default"
        >
          Reset
        </button>
        <span
          className={`text-xs ${pending ? "text-amber-600" : "text-primary/50 dark:text-dark-primary/50"}`}
          data-testid="samples-status"
        >
          {pending
            ? "Changes not applied yet. Apply updates the tracks and closes this panel."
            : "No changes"}
        </span>
      </div>

      <div className="@container grid gap-4 grid-cols-3 [@media(min-width:1400px)]:grid-cols-[auto_auto_auto_1fr]">
        <Column
          title="Sample"
          values={cols.samples}
          checked={state.samples}
          onToggle={(v, on) => toggle("samples", v, on)}
          onAll={(on) => setAll("samples", on)}
        />
        <Column
          title="Condition"
          values={cols.conditions}
          checked={state.conditions}
          onToggle={(v, on) => toggle("conditions", v, on)}
          onAll={(on) => setAll("conditions", on)}
        />
        <Column
          title="Biological replicate"
          values={[...cols.replicates, AGGREGATE]}
          label={(v) => (v === AGGREGATE ? "Aggregated" : `BR${v}`)}
          hint={(v) =>
            v === AGGREGATE
              ? "One track per sample, condition and assay, with its replicates overlaid (bigWig assays only)"
              : undefined
          }
          checked={state.replicates}
          onToggle={(v, on) => toggle("replicates", v, on)}
          color={(v) =>
            v === AGGREGATE ? null : (
              <ColorSwatch
                label={`BR${v}`}
                value={state.replicateColors?.[v] ?? null}
                fallback={REPLICATE_FALLBACK[(Number(v) - 1) % REPLICATE_FALLBACK.length]}
                onChange={(c) =>
                  commit({ ...state, replicateColors: { ...(state.replicateColors ?? {}), [v]: c } })
                }
              />
            )
          }
        />
        <AssayTable
          assays={cols.assays}
          settings={state.assays}
          onChange={setAssay}
          visibleUrls={(assay) =>
            state.catalog
              .filter(
                (e) =>
                  e.facets.assay === assay &&
                  state.samples[e.facets.sample] &&
                  state.conditions[e.facets.condition] &&
                  (state.replicates[e.facets.replicate] || state.replicates[AGGREGATE]) &&
                  String(e.track.type).toLowerCase() === "bigwig",
              )
              .map((e) => String(e.track.url))
          }
          region={String(session.userViewRegion ?? session.viewRegion ?? "")}
          originalColor={(assay) =>
            String(
              (state.catalog.find((e) => e.facets.assay === assay)?.track.options as
                | { color?: string }
                | undefined)?.color ?? "#000000",
            )
          }
        />
      </div>
    </div>
  );
}

function Column({
  title,
  values,
  checked,
  onToggle,
  onAll,
  label = (v) => v,
  hint,
  color,
}: {
  title: string;
  values: string[];
  checked: Record<string, boolean>;
  onToggle: (value: string, on: boolean) => void;
  onAll?: (on: boolean) => void;
  label?: (value: string) => string;
  hint?: (value: string) => string | undefined;
  color?: (value: string) => React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-1 min-w-28" data-testid={`col-${title}`}>
      <legend className="text-xs font-semibold uppercase tracking-wider text-primary/60 dark:text-dark-primary/60 mb-1">
        {title}
      </legend>
      {values.map((v) => (
        <div key={v} className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer" title={hint?.(v)}>
            <input
              type="checkbox"
              checked={!!checked[v]}
              onChange={(e) => onToggle(v, e.target.checked)}
            />
            {label(v)}
          </label>
          {color?.(v)}
        </div>
      ))}
      {onAll && (
        <div className="flex gap-2 mt-1 text-xs">
          <button type="button" className="text-blue-600 hover:underline" onClick={() => onAll(true)}>
            All
          </button>
          <button type="button" className="text-blue-600 hover:underline" onClick={() => onAll(false)}>
            None
          </button>
        </div>
      )}
    </fieldset>
  );
}

function AssayTable({
  assays,
  settings,
  onChange,
  visibleUrls,
  region,
  originalColor,
}: {
  assays: string[];
  settings: Record<string, AssaySettings>;
  onChange: (assay: string, changes: Partial<AssaySettings>) => void;
  visibleUrls: (assay: string) => string[];
  region: string;
  originalColor: (assay: string) => string;
}) {
  return (
    <fieldset
      className="min-w-0 col-span-3 [@media(min-width:1400px)]:col-span-1 overflow-x-auto"
      data-testid="col-Assay"
    >
      <legend className="text-xs font-semibold uppercase tracking-wider text-primary/60 dark:text-dark-primary/60 mb-1">
        Assay
      </legend>
      <table className="text-sm border-separate border-spacing-x-2 border-spacing-y-1 -mx-2">
        <thead>
          <tr className="text-xs text-primary/60 dark:text-dark-primary/60 text-left">
            <th className="font-normal">Show</th>
            <th className="font-normal" title="All tracks of this assay share one y-axis range">
              Same scale
            </th>
            <th className="font-normal">ymin</th>
            <th className="font-normal">ymax</th>
            <th />
            <th className="font-normal">Color</th>
          </tr>
        </thead>
        <tbody>
          {assays.map((a) => (
            <AssayRow
              key={a}
              assay={a}
              s={settings[a]}
              onChange={(c) => onChange(a, c)}
              urls={() => visibleUrls(a)}
              region={region}
              originalColor={originalColor(a)}
            />
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

function AssayRow({
  assay,
  s,
  onChange,
  urls,
  region,
  originalColor,
}: {
  assay: string;
  s: AssaySettings;
  onChange: (changes: Partial<AssaySettings>) => void;
  urls: () => string[];
  region: string;
  originalColor: string;
}) {
  const [yMin, setYMin] = useState(s.yMin?.toString() ?? "");
  const [yMax, setYMax] = useState(s.yMax?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const num = (text: string) => (text.trim() === "" || isNaN(Number(text)) ? null : Number(text));
  // Follow outside changes (Auto, Reset) without fighting what's being typed:
  // "-" or "0." parse to the same value as the saved one, so they're kept.
  useEffect(() => {
    if (num(yMin) !== s.yMin) setYMin(s.yMin?.toString() ?? "");
    if (num(yMax) !== s.yMax) setYMax(s.yMax?.toString() ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.yMin, s.yMax]);
  const saveRange = (minText: string, maxText: string) => {
    const lo = num(minText);
    const hi = num(maxText);
    if (lo !== s.yMin || hi !== s.yMax) onChange({ yMin: lo, yMax: hi });
  };
  const auto = async () => {
    setNote("");
    setBusy(true);
    try {
      const range = await bigWigRange(urls(), region);
      if (range) onChange({ ...range, sameScale: true });
      else setNote("No bigWig data in view");
    } catch {
      setNote("Couldn't read the data");
    } finally {
      setBusy(false);
    }
  };
  const invalid = s.sameScale && !scaleReady(s);
  const input =
    "w-20 border rounded px-1.5 py-0.5 bg-white dark:bg-dark-surface " +
    (invalid ? "border-amber-500" : "border-gray-300 dark:border-gray-600");

  return (
    <tr data-testid={`assay-${assay}`}>
      <td>
        <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={s.shown}
            onChange={(e) => onChange({ shown: e.target.checked })}
          />
          {assay}
        </label>
      </td>
      <td className="text-center">
        <input
          type="checkbox"
          aria-label={`Same scale for ${assay}`}
          checked={s.sameScale}
          onChange={(e) => onChange({ sameScale: e.target.checked })}
        />
      </td>
      <td>
        <input
          className={input}
          aria-label={`ymin for ${assay}`}
          inputMode="decimal"
          value={yMin}
          placeholder="ymin"
          onChange={(e) => {
            setYMin(e.target.value);
            saveRange(e.target.value, yMax);
          }}
        />
      </td>
      <td>
        <input
          className={input}
          aria-label={`ymax for ${assay}`}
          inputMode="decimal"
          value={yMax}
          placeholder="ymax"
          onChange={(e) => {
            setYMax(e.target.value);
            saveRange(yMin, e.target.value);
          }}
        />
      </td>
      <td className="whitespace-nowrap">
        <button
          type="button"
          disabled={busy}
          onClick={auto}
          title="Fill ymin/ymax from the data of this assay's shown tracks in the current region"
          className="text-xs rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
        >
          {busy ? "…" : "Auto"}
        </button>
        {note && <span className="ml-2 text-xs text-amber-600">{note}</span>}
        {invalid && !note && (
          <span className="ml-2 text-xs text-amber-600">Set ymin &lt; ymax</span>
        )}
      </td>
      <td>
        <ColorSwatch
          label={assay}
          value={s.color ?? null}
          fallback={originalColor}
          onChange={(c) => onChange({ color: c })}
        />
      </td>
    </tr>
  );
}

/** Default swatch colors for replicates without a picked color (BR1, BR2...). */
const REPLICATE_FALLBACK = ["#6b7280", "#d62728", "#2ca02c", "#9467bd"];

/**
 * A color picker that can be unset: unset shows the fallback faded, and ×
 * clears a picked color.
 */
function ColorSwatch({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (color: string | null) => void;
}) {
  const hex = /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : /^#[0-9a-f]{6}$/i.test(fallback) ? fallback : "#000000";
  return (
    <span className="inline-flex items-center gap-1" data-testid={`color-${label}`}>
      <input
        type="color"
        aria-label={`Color for ${label}`}
        title={value ? `Color for ${label}: ${value}` : `Pick one color for ${label} (now: the tracks' own colors)`}
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className={`w-6 h-5 p-0 border border-gray-300 dark:border-gray-600 rounded cursor-pointer bg-transparent ${value ? "" : "opacity-40"}`}
      />
      {value && (
        <button
          type="button"
          aria-label={`Clear color for ${label}`}
          title="Use the tracks' own colors"
          onClick={() => onChange(null)}
          className="text-xs text-primary/50 dark:text-dark-primary/50 hover:text-red-600 leading-none"
        >
          ×
        </button>
      )}
    </span>
  );
}
