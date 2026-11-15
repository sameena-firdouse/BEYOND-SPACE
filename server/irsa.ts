import { XMLParser } from 'fast-xml-parser';
import {
  DETECTOR_IDS,
  mjdToIso,
  mjdToUtcDate,
  parseDetectorFromRecord,
  type CollectionId,
  type CollectionQueryReport,
  type DetectorId,
  type SearchResponse,
  type SpherexObservation,
} from '../shared/astronomy.ts';

const IRSA_SIA_BASE = 'https://irsa.ipac.caltech.edu/SIA';
const DEFAULT_MAXREC = 5000;
const REQUEST_TIMEOUT_MS = 25000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
});

interface RawVotableParseResult {
  queryStatus: string;
  statusMessage?: string;
  fields: string[];
  rows: Record<string, string>[];
}

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function extractTdText(td: unknown): string {
  if (td === null || td === undefined) return '';
  if (typeof td === 'string' || typeof td === 'number' || typeof td === 'boolean') {
    return String(td);
  }
  if (typeof td === 'object' && '#text' in (td as Record<string, unknown>)) {
    return String((td as Record<string, unknown>)['#text'] ?? '');
  }
  return '';
}

export function parseVotableXml(xmlText: string): RawVotableParseResult {
  const parsed = xmlParser.parse(xmlText);
  const votable = parsed?.VOTABLE;
  if (!votable) {
    throw new Error('Invalid VOTable XML returned from IRSA SIA2 service.');
  }

  const resources = asArray(votable.RESOURCE);
  const resultsResource =
    resources.find((r: Record<string, unknown>) => r?.['@_type'] === 'results') ?? resources[0];

  if (!resultsResource) {
    return { queryStatus: 'OK', fields: [], rows: [] };
  }

  const infos = asArray(resultsResource.INFO);
  const statusInfo = infos.find(
    (info: Record<string, unknown>) => info?.['@_name'] === 'QUERY_STATUS'
  ) as Record<string, unknown> | undefined;

  const queryStatus = String(statusInfo?.['@_value'] ?? 'OK').toUpperCase();
  const statusMessage = statusInfo?.['#text'] ? String(statusInfo['#text']) : undefined;

  const table = resultsResource.TABLE;
  if (!table) {
    return { queryStatus, statusMessage, fields: [], rows: [] };
  }

  const fieldObjs = asArray(table.FIELD) as Record<string, unknown>[];
  const fields = fieldObjs.map((f) => String(f?.['@_name'] ?? ''));

  const trList = asArray(table?.DATA?.TABLEDATA?.TR) as Record<string, unknown>[];
  const rows: Record<string, string>[] = [];

  for (const tr of trList) {
    const tds = asArray(tr?.TD);
    const rowObj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i++) {
      const colName = fields[i];
      if (colName) {
        rowObj[colName] = extractTdText(tds[i]);
      }
    }
    rows.push(rowObj);
  }

  return { queryStatus, statusMessage, fields, rows };
}

function parseNumber(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function extractProcessingVersion(accessUrl: string): string {
  // Example: .../level2/2026W20_2A/l2b-v27-2026-267/3/level2_2026W20_2A_0436_3D3_spx_l2b-v27-2026-267.fits
  const match = accessUrl.match(/(l2[ab]-v\d+-\d{4}-\d+)/i);
  if (match) return match[1];
  return 'Not available';
}

function formatDataRelease(collection: CollectionId): string {
  switch (collection) {
    case 'spherex_dr1':
      return 'DR1 (Wide Survey)';
    case 'spherex_dr1_deep':
      return 'DR1 (Deep Survey)';
    case 'spherex_qr3':
      return 'QR3 (Wide Survey)';
    case 'spherex_qr3_deep':
      return 'QR3 (Deep Survey)';
  }
}

function mapRawRowToObservation(
  row: Record<string, string>,
  collection: CollectionId,
  queryUrl: string
): SpherexObservation | null {
  const accessUrl = row.access_url?.trim();
  if (!accessUrl) return null;

  const detector = parseDetectorFromRecord(
    row.energy_bandpassname,
    row.obs_publisher_did,
    accessUrl
  );
  // Strictly discard or never guess if detector cannot be verified from archive metadata
  if (!detector) return null;

  const ra = parseNumber(row.s_ra);
  const dec = parseNumber(row.s_dec);
  if (ra === null || dec === null) return null;

  const tMinMjd = parseNumber(row.t_min);
  const tMaxMjd = parseNumber(row.t_max);
  const obsDateIso = mjdToIso(tMinMjd);
  const obsDateUtc = mjdToUtcDate(tMinMjd);

  const emMinMeters = parseNumber(row.em_min);
  const emMaxMeters = parseNumber(row.em_max);
  const wavelengthMinUm = emMinMeters !== null ? Number((emMinMeters * 1e6).toFixed(4)) : null;
  const wavelengthMaxUm = emMaxMeters !== null ? Number((emMaxMeters * 1e6).toFixed(4)) : null;

  const pubDid = row.obs_publisher_did?.trim() || `${collection}:${row.obs_id}:${detector}`;
  const filename = accessUrl.split('/').pop()?.split('?')[0] || 'spherex_observation.fits';

  return {
    id: `${collection}::${pubDid}`,
    obsId: row.obs_id?.trim() || 'Not available',
    obsPublisherDid: pubDid,
    detector,
    bandpassName: row.energy_bandpassname?.trim() || `SPHEREx-${detector}`,
    collection,
    dataRelease: formatDataRelease(collection),
    processingVersion: extractProcessingVersion(accessUrl),
    ra,
    dec,
    tMinMjd,
    tMaxMjd,
    obsDateIso,
    obsDateUtc,
    obsReleaseDate: row.obs_release_date?.trim() || null,
    wavelengthMinUm,
    wavelengthMaxUm,
    resolvingPower: parseNumber(row.em_res_power),
    exptimeSec: parseNumber(row.t_exptime),
    pixelScaleArcsec: parseNumber(row.s_pixel_scale),
    fovDeg: parseNumber(row.s_fov),
    targetName: row.target_name?.trim() || null,
    accessUrl,
    fitsFilename: filename,
    estSizeKb: parseNumber(row.access_estsize),
    archiveSourceUrl: queryUrl,
  };
}

async function fetchSiaWithRetry(url: string, retries = 2): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          Accept: 'application/x-votable+xml, application/xml, text/xml',
          'User-Agent': 'BeyondSpace-SkyExplorer/1.0',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (resp.status === 503 || resp.status === 429) {
        const retryAfter = Number(resp.headers.get('retry-after') || '2');
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 6) * 1000));
        continue;
      }

      if (!resp.ok) {
        throw new Error(`IRSA SIA2 returned HTTP ${resp.status}`);
      }

      return await resp.text();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error('Failed to query IRSA SIA2');
}

function buildSiaUrl(
  ra: number,
  dec: number,
  radius: number,
  collection: CollectionId,
  maxrec: number,
  timeInterval?: [number, number]
): string {
  const params = new URLSearchParams();
  params.set('POS', `CIRCLE ${ra} ${dec} ${radius}`);
  params.set('COLLECTION', collection);
  params.set('MAXREC', String(maxrec));
  if (timeInterval) {
    params.set('TIME', `${timeInterval[0]} ${timeInterval[1]}`);
  }
  return `${IRSA_SIA_BASE}?${params.toString()}`;
}

/**
 * NASA/IPAC IRSA SIA2 SPHEREx collections exhibit a severe spatial-index cliff at radius >= 0.10 deg
 * (>75s timeout), whereas radius <= 0.099 deg completes in ~1-3s.
 * When radius >= 0.10 deg, cover the requested sky circle with overlapping sub-cones (r <= 0.095 deg)
 * and deduplicate by unique observation ID.
 */
function generateConeCover(
  ra: number,
  dec: number,
  radius: number
): Array<{ ra: number; dec: number; r: number }> {
  if (radius < 0.1) {
    return [{ ra, dec, r: Number(radius.toFixed(4)) }];
  }

  const cosDec = Math.max(0.15, Math.cos((dec * Math.PI) / 180));
  const points: Array<{ ra: number; dec: number; r: number }> = [
    { ra, dec, r: 0.095 },
  ];

  // For default 0.1° .. 0.2°, add 4 cardinal edge sub-cones covering the full outer annulus
  const ringOffset = Math.min(radius * 0.55, 0.14);
  const subR = Math.min(0.095, Math.max(0.055, radius - ringOffset + 0.015));
  const dDec = ringOffset;
  const dRa = ringOffset / cosDec;

  const wrapRa = (v: number) => ((v % 360) + 360) % 360;
  const clampDec = (v: number) => Math.max(-89.95, Math.min(89.95, v));

  points.push({ ra, dec: clampDec(dec + dDec), r: Number(subR.toFixed(4)) });
  points.push({ ra, dec: clampDec(dec - dDec), r: Number(subR.toFixed(4)) });
  points.push({ ra: wrapRa(ra + dRa), dec, r: Number(subR.toFixed(4)) });
  points.push({ ra: wrapRa(ra - dRa), dec, r: Number(subR.toFixed(4)) });

  return points;
}

/**
 * Queries a single SPHEREx collection with complete pagination.
 * If SIA2 returns QUERY_STATUS=OVERFLOW, recursively subdivides the MJD time window
 * so we do not silently truncate at 10, 50, 100, or MAXREC rows.
 */
async function querySingleCollectionComplete(
  ra: number,
  dec: number,
  radius: number,
  collection: CollectionId
): Promise<{
  observations: SpherexObservation[];
  report: CollectionQueryReport;
}> {
  const tStart = Date.now();
  const baseQueryUrl = buildSiaUrl(ra, dec, radius, collection, DEFAULT_MAXREC);
  const seenIds = new Set<string>();
  const observations: SpherexObservation[] = [];
  let subqueriesExecuted = 0;
  let hadOverflowSubdivision = false;
  let unresolvedOverflow = false;

  async function fetchWindow(
    subRa: number,
    subDec: number,
    subR: number,
    timeInterval?: [number, number],
    depth = 0
  ): Promise<void> {
    subqueriesExecuted++;
    const url = buildSiaUrl(subRa, subDec, subR, collection, DEFAULT_MAXREC, timeInterval);
    const xml = await fetchSiaWithRetry(url);
    const parsed = parseVotableXml(xml);

    if (parsed.queryStatus === 'ERROR') {
      throw new Error(parsed.statusMessage || `SIA2 query error on ${collection}`);
    }

    const mappedBatch: SpherexObservation[] = [];
    for (const raw of parsed.rows) {
      const obs = mapRawRowToObservation(raw, collection, url);
      if (obs) {
        mappedBatch.push(obs);
      }
    }

    if (parsed.queryStatus === 'OVERFLOW' && depth < 4) {
      hadOverflowSubdivision = true;
      // Determine MJD bounds from batch or mission range (SPHEREx launched Mar 2025 -> MJD ~60735 to ~62000)
      const mjds = mappedBatch
        .map((o) => o.tMinMjd)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);

      const lo = timeInterval ? timeInterval[0] : (mjds[0] ?? 60700) - 1;
      const hi = timeInterval ? timeInterval[1] : (mjds[mjds.length - 1] ?? 62000) + 1;
      const mid = (lo + hi) / 2;

      if (hi - lo > 0.01) {
        await fetchWindow(subRa, subDec, subR, [lo, mid], depth + 1);
        await fetchWindow(subRa, subDec, subR, [mid, hi], depth + 1);
        return;
      }
      unresolvedOverflow = true;
    } else if (parsed.queryStatus === 'OVERFLOW') {
      unresolvedOverflow = true;
    }

    for (const obs of mappedBatch) {
      if (!seenIds.has(obs.id)) {
        seenIds.add(obs.id);
        observations.push(obs);
      }
    }
  }

  try {
    const subCones = generateConeCover(ra, dec, radius);
    // Execute sub-cones in chunks of 2 to respect IRSA server concurrency cleanly
    for (let i = 0; i < subCones.length; i += 2) {
      const chunk = subCones.slice(i, i + 2);
      await Promise.all(chunk.map((c) => fetchWindow(c.ra, c.dec, c.r)));
    }
    const status: CollectionQueryReport['status'] = unresolvedOverflow
      ? 'PARTIAL_OVERFLOW'
      : hadOverflowSubdivision
        ? 'OVERFLOW_SUBDIVIDED'
        : 'OK';

    return {
      observations,
      report: {
        collection,
        status,
        totalRetrieved: observations.length,
        subqueriesExecuted,
        durationMs: Date.now() - tStart,
        queryUrl: baseQueryUrl,
      },
    };
  } catch (err) {
    return {
      observations: [],
      report: {
        collection,
        status: 'ERROR',
        totalRetrieved: 0,
        subqueriesExecuted,
        durationMs: Date.now() - tStart,
        queryUrl: baseQueryUrl,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export async function searchSpherexArchive(
  ra: number,
  dec: number,
  radius: number,
  collections: CollectionId[]
): Promise<SearchResponse> {
  const results = await Promise.all(
    collections.map((col) => querySingleCollectionComplete(ra, dec, radius, col))
  );

  const byDetector: Record<DetectorId, SpherexObservation[]> = {
    D1: [],
    D2: [],
    D3: [],
    D4: [],
    D5: [],
    D6: [],
  };

  const dedupedByDetector = new Map<string, SpherexObservation>();
  const dateSet = new Set<string>();
  const collectionReports: CollectionQueryReport[] = [];

  for (const res of results) {
    collectionReports.push(res.report);
    for (const obs of res.observations) {
      if (!dedupedByDetector.has(obs.id)) {
        dedupedByDetector.set(obs.id, obs);
        byDetector[obs.detector].push(obs);
        if (obs.obsDateUtc) {
          dateSet.add(obs.obsDateUtc);
        }
      }
    }
  }

  // Sort each detector independently in chronological order, newest first (by actual t_min MJD)
  const detectorCounts: Record<DetectorId, number> = {
    D1: 0,
    D2: 0,
    D3: 0,
    D4: 0,
    D5: 0,
    D6: 0,
  };

  let totalAcrossAllDetectors = 0;
  for (const det of DETECTOR_IDS) {
    byDetector[det].sort((a, b) => (b.tMinMjd ?? 0) - (a.tMinMjd ?? 0));
    detectorCounts[det] = byDetector[det].length;
    totalAcrossAllDetectors += byDetector[det].length;
  }

  const availableDatesUtc = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

  return {
    query: {
      ra,
      dec,
      radius,
      collections,
    },
    retrievedAt: new Date().toISOString(),
    fromCache: false,
    totalAcrossAllDetectors,
    availableDatesUtc,
    byDetector,
    detectorCounts,
    collectionReports,
    archiveSource: `${IRSA_SIA_BASE}?POS=CIRCLE+${ra}+${dec}+${radius}`,
  };
}
