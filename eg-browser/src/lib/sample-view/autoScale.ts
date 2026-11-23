import { BigWig } from "@gmod/bbi";
import { RemoteFile } from "generic-filehandle2";

/**
 * The lowest and highest values of some bigWig tracks over a region, for the
 * Samples menu's "Auto" scale. Uses zoomed summaries (about 1,000 points per
 * file), so it reads little data even for large regions.
 */
export async function bigWigRange(
  urls: string[],
  region: string,
): Promise<{ yMin: number; yMax: number } | null> {
  const parsed = parseRegion(region);
  if (!parsed || urls.length === 0) return null;
  const { chrom, start, end } = parsed;
  const scale = 1000 / Math.max(1, end - start);

  let lo = Infinity;
  let hi = -Infinity;
  const results = await Promise.allSettled(
    urls.map((url) =>
      new BigWig({ filehandle: new RemoteFile(url) }).getFeatures(chrom, start, end, { scale }),
    ),
  );
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const f of r.value) {
      const min = f.minScore ?? f.score;
      const max = f.maxScore ?? f.score;
      if (typeof min === "number" && Number.isFinite(min)) lo = Math.min(lo, min);
      if (typeof max === "number" && Number.isFinite(max)) hi = Math.max(hi, max);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  // Keep zero on the axis: plus-strand data from 0 up, minus-strand from 0 down.
  return { yMin: niceFloor(Math.min(0, lo)), yMax: niceCeil(Math.max(0, hi)) };
}

/** "chr7:27,100,000-27,250,000" (a region spanning chromosomes uses its first). */
export function parseRegion(region: string): { chrom: string; start: number; end: number } | null {
  const m = /^([^:\s]+):(\d+)-(?:([^:\s]+):)?(\d+)/.exec(region.replace(/,/g, "").trim());
  if (!m) return null;
  const [, chrom, s, endChrom, e] = m;
  const start = Number(s);
  const end = endChrom && endChrom !== chrom ? start + 1_000_000 : Number(e);
  return end > start ? { chrom, start, end } : null;
}

/** Rounds away from zero to two significant figures (e.g. 0.0437 -> 0.044). */
function niceCeil(v: number) {
  if (v === 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.ceil(v / p) * p;
}
function niceFloor(v: number) {
  return -niceCeil(-v);
}
