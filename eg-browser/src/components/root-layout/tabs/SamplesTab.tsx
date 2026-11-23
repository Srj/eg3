import { useEffect, useMemo, useState } from "react";
import { generateUUID } from "wuepgg3-track";

import useExpandedNavigationTab from "@/lib/hooks/useExpandedNavigationTab";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { selectCurrentSession, updateSession } from "@/lib/redux/slices/browserSlice";
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
 * show their tracks; give an assay one shared y-scale. Selections are saved
 * with the session.
 */
export default function SamplesTab() {
  useExpandedNavigationTab();
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCurrentSession);

  // The saved state, with any newly recognised tracks (e.g. from a watched
  // hub) added to the catalog and their column values shown.
  const state: SampleViewState | null = useMemo(() => {
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
    };
  }, [session]);

  if (!session || !state) return null;
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
    dispatch(
      updateSession({
        id: session.id,
        changes: {
          sampleView: next,
          tracks: applySampleView(session.tracks, next, generateUUID),
        },
      }),
    );
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
        Showing {visibleData} of {state.catalog.length} sample tracks
        {overlays > 0 && `, plus ${overlays} aggregated overlay${overlays === 1 ? "" : "s"}`}.
        Other tracks (ruler, genes, annotations) aren't affected.
      </p>

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
}: {
  title: string;
  values: string[];
  checked: Record<string, boolean>;
  onToggle: (value: string, on: boolean) => void;
  onAll?: (on: boolean) => void;
  label?: (value: string) => string;
  hint?: (value: string) => string | undefined;
}) {
  return (
    <fieldset className="flex flex-col gap-1 min-w-28" data-testid={`col-${title}`}>
      <legend className="text-xs font-semibold uppercase tracking-wider text-primary/60 dark:text-dark-primary/60 mb-1">
        {title}
      </legend>
      {values.map((v) => (
        <label key={v} className="flex items-center gap-2 cursor-pointer" title={hint?.(v)}>
          <input
            type="checkbox"
            checked={!!checked[v]}
            onChange={(e) => onToggle(v, e.target.checked)}
          />
          {label(v)}
        </label>
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
}: {
  assays: string[];
  settings: Record<string, AssaySettings>;
  onChange: (assay: string, changes: Partial<AssaySettings>) => void;
  visibleUrls: (assay: string) => string[];
  region: string;
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
}: {
  assay: string;
  s: AssaySettings;
  onChange: (changes: Partial<AssaySettings>) => void;
  urls: () => string[];
  region: string;
}) {
  const [yMin, setYMin] = useState(s.yMin?.toString() ?? "");
  const [yMax, setYMax] = useState(s.yMax?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setYMin(s.yMin?.toString() ?? ""), [s.yMin]);
  useEffect(() => setYMax(s.yMax?.toString() ?? ""), [s.yMax]);

  const num = (text: string) => (text.trim() === "" || isNaN(Number(text)) ? null : Number(text));
  const saveRange = () => {
    const lo = num(yMin);
    const hi = num(yMax);
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
          onChange={(e) => setYMin(e.target.value)}
          onBlur={saveRange}
          onKeyDown={(e) => e.key === "Enter" && saveRange()}
        />
      </td>
      <td>
        <input
          className={input}
          aria-label={`ymax for ${assay}`}
          inputMode="decimal"
          value={yMax}
          placeholder="ymax"
          onChange={(e) => setYMax(e.target.value)}
          onBlur={saveRange}
          onKeyDown={(e) => e.key === "Enter" && saveRange()}
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
    </tr>
  );
}
