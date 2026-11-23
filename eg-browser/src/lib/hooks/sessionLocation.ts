import { GenomeCoordinate, getGenomeConfig } from "wuepgg3-track";

import type { useAppDispatch } from "../redux/hooks";
import { updateCurrentSession } from "../redux/slices/browserSlice";
import type { SessionLocation } from "../session-route";

/** The gene API the search box uses (eg-tracks GeneSearchBoxBase). */
const GENE_API = "https://lambda.epigenomegateway.org/v3";

interface GeneRecord {
  chrom: string;
  txStart: number;
  txEnd: number;
  name?: string;
  name2?: string;
}

/**
 * Turns a /region/ or /gene/ location into a region of `genome`, checked
 * against the genome when it's a built-in one. Resolve it before showing the
 * session: moving the view while the track view is still loading its first
 * region can leave it offset.
 */
export async function resolveSessionLocation(
  location: SessionLocation,
  genome: string,
): Promise<{ region: string } | { error: string }> {
  const navContext = getGenomeConfig(genome)?.navContext;
  let region: string;
  if (location.kind === "region") {
    region = location.region;
  } else {
    try {
      const found = await findGene(genome, location.gene, navContext);
      if (!found) return { error: `No gene named "${location.gene}" was found in ${genome}.` };
      region = found;
    } catch {
      return { error: `Couldn't look up the gene "${location.gene}" (gene search is unavailable).` };
    }
  }
  if (navContext) {
    try {
      navContext.parse(region);
    } catch {
      return { error: `"${region}" isn't a valid region in ${genome}.` };
    }
  }
  return { region };
}

/** Moves the current session to `region`. */
export function showRegion(dispatch: ReturnType<typeof useAppDispatch>, region: string) {
  dispatch(
    updateCurrentSession({
      viewRegion: region as GenomeCoordinate,
      userViewRegion: region as GenomeCoordinate,
    }),
  );
}

/**
 * The region covering every isoform of a gene, e.g. "chr7:27162437-27175180",
 * or null if the genome has no gene by that name.
 */
async function findGene(
  genome: string,
  name: string,
  navContext?: { _featuresForChr?: Record<string, unknown> },
): Promise<string | null> {
  const url = new URL(`${GENE_API}/${genome}/genes/queryName`);
  url.searchParams.append("q", name);
  url.searchParams.append("isExact", "true");
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let records = (await response.json()) as GeneRecord[];

  // Skip contigs the genome's chromosome list doesn't have.
  const chroms = navContext?._featuresForChr;
  if (chroms) records = records.filter((r) => r.chrom in chroms);
  // Prefer records named exactly so (the API can return related entries).
  const wanted = name.toLowerCase();
  const exact = records.filter(
    (r) => r.name?.toLowerCase() === wanted || r.name2?.toLowerCase() === wanted,
  );
  if (exact.length > 0) records = exact;
  if (records.length === 0) return null;

  const chrom = records[0].chrom;
  const onChrom = records.filter((r) => r.chrom === chrom);
  const start = Math.min(...onChrom.map((r) => r.txStart));
  const end = Math.max(...onChrom.map((r) => r.txEnd));
  return `${chrom}:${start}-${end}`;
}
