import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SearchResponse, SpherexObservation } from '../shared/astronomy.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'beyond_space.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS search_cache (
    cache_key TEXT PRIMARY KEY,
    ra REAL NOT NULL,
    dec REAL NOT NULL,
    radius REAL NOT NULL,
    collections_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    source_url TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observation_index (
    id TEXT PRIMARY KEY,
    obs_id TEXT NOT NULL,
    detector TEXT NOT NULL,
    collection TEXT NOT NULL,
    ra REAL NOT NULL,
    dec REAL NOT NULL,
    obs_date_iso TEXT,
    obs_date_utc TEXT,
    access_url TEXT NOT NULL,
    record_json TEXT NOT NULL,
    retrieved_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_obs_detector ON observation_index(detector);
  CREATE INDEX IF NOT EXISTS idx_obs_date ON observation_index(obs_date_utc);
`);

const SEARCH_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

export function makeSearchCacheKey(ra: number, dec: number, radius: number, collections: string[]): string {
  const sortedCols = [...collections].sort().join(',');
  return `${ra.toFixed(5)}|${dec.toFixed(5)}|${radius.toFixed(4)}|${sortedCols}`;
}

export function getCachedSearch(
  ra: number,
  dec: number,
  radius: number,
  collections: string[]
): SearchResponse | null {
  const key = makeSearchCacheKey(ra, dec, radius, collections);
  const now = Date.now();
  const stmt = db.prepare(
    'SELECT response_json, retrieved_at, expires_at FROM search_cache WHERE cache_key = ?'
  );
  const row = stmt.get(key) as
    | { response_json: string; retrieved_at: string; expires_at: number }
    | undefined;

  if (!row) return null;
  if (row.expires_at < now) {
    db.prepare('DELETE FROM search_cache WHERE cache_key = ?').run(key);
    return null;
  }

  try {
    const parsed = JSON.parse(row.response_json) as SearchResponse;
    return {
      ...parsed,
      fromCache: true,
      retrievedAt: row.retrieved_at,
    };
  } catch {
    return null;
  }
}

export function saveSearchCache(
  ra: number,
  dec: number,
  radius: number,
  collections: string[],
  response: SearchResponse
): void {
  const key = makeSearchCacheKey(ra, dec, radius, collections);
  const expiresAt = Date.now() + SEARCH_CACHE_TTL_MS;

  const insertCache = db.prepare(`
    INSERT INTO search_cache (cache_key, ra, dec, radius, collections_json, response_json, source_url, retrieved_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      response_json = excluded.response_json,
      source_url = excluded.source_url,
      retrieved_at = excluded.retrieved_at,
      expires_at = excluded.expires_at
  `);

  insertCache.run(
    key,
    ra,
    dec,
    radius,
    JSON.stringify(collections),
    JSON.stringify(response),
    response.archiveSource,
    response.retrievedAt,
    expiresAt
  );

  // Also index individual observations so FITS viewer/preview can resolve by observation ID cleanly
  const upsertObs = db.prepare(`
    INSERT INTO observation_index (id, obs_id, detector, collection, ra, dec, obs_date_iso, obs_date_utc, access_url, record_json, retrieved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      record_json = excluded.record_json,
      retrieved_at = excluded.retrieved_at
  `);

  const allObs: SpherexObservation[] = [
    ...response.byDetector.D1,
    ...response.byDetector.D2,
    ...response.byDetector.D3,
    ...response.byDetector.D4,
    ...response.byDetector.D5,
    ...response.byDetector.D6,
  ];

  db.exec('BEGIN TRANSACTION');
  try {
    for (const obs of allObs) {
      upsertObs.run(
        obs.id,
        obs.obsId,
        obs.detector,
        obs.collection,
        obs.ra,
        obs.dec,
        obs.obsDateIso,
        obs.obsDateUtc,
        obs.accessUrl,
        JSON.stringify(obs),
        response.retrievedAt
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getObservationById(id: string): SpherexObservation | null {
  const row = db
    .prepare('SELECT record_json FROM observation_index WHERE id = ?')
    .get(id) as { record_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.record_json) as SpherexObservation;
  } catch {
    return null;
  }
}

export function getCacheStats(): { cachedSearches: number; indexedObservations: number; dbPath: string } {
  const s = db.prepare('SELECT COUNT(*) as cnt FROM search_cache').get() as { cnt: number };
  const o = db.prepare('SELECT COUNT(*) as cnt FROM observation_index').get() as { cnt: number };
  return {
    cachedSearches: s.cnt,
    indexedObservations: o.cnt,
    dbPath: DB_PATH,
  };
}
