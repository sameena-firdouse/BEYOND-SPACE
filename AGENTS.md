# AGENTS.md — Handover Guide for AI Coding Agents

## Architecture Overview
- **Runtime**: Node.js v22 (`tsx server.ts`) serving Express APIs + Vite React frontend on port `3000`.
- **Shared Logic** (`shared/astronomy.ts`): Coordinate parsers/validators, MJD-to-UTC helpers, verified SPHEREx D1–D6 specs, TypeScript contracts.
- **Database Cache** (`server/db.ts`): Uses Node 22 built-in `node:sqlite` (`DatabaseSync`) storing cached SIA2 queries at `./data/beyond_space.db` with `retrieved_at` provenance. Never treat the cache as authoritative over IRSA; preserve the `refresh=1` bypass.
- **Archive Client** (`server/irsa.ts`): Queries `https://irsa.ipac.caltech.edu/SIA` for `spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, `spherex_qr3_deep`. Always keep D1–D6 arrays strictly isolated using verified `energy_bandpassname` / `obs_publisher_did`.
- **FITS Engine** (`server/fits.ts`): Fetches IRSA IBE cutouts (`?center=RA,DEC&size=SIZE`) with `503 Retry-After` backoff, parses MEF FITS headers and Float32 `IMAGE` / Int32 `FLAGS` / `ZODI` extensions natively in TypeScript, caches temporary cutouts in `/tmp/beyond-space-fits` (180 MB LRU cap), and renders PNG previews with `pngjs`.
- **Space Comparison Engine** (`server/compare.ts`): Handles `POST /api/compare` with strict compatibility checks (`validateComparisonCompatibility`), forward/inverse `TAN-SIP` WCS reprojection, hard-bad pixel masking + `ZODI` / 3σ-clipped background subtraction, propagated `VARIANCE` Z-score significance mapping, and SPHEREx `FLAGS` signal-vs-artifact classification.

## Non-Negotiable Engineering Invariants
1. **Never fabricate observations or images**: Empty detectors or dates must show honest empty states.
2. **Preserve Detector Isolation**: Never merge or guess D1–D6 assignments. Never allow pixel subtraction across incompatible detectors or non-overlapping regions.
3. **ALL Dates vs ALL Detectors**: `ALL AVAILABLE DATES` means all dates for ONE selected detector. `ALL DETECTORS` is a separate mode showing 6 separate collapsible detector sections.
4. **Actual Observation Timestamps**: Date filtering uses `t_min` MJD converted to UTC `YYYY-MM-DD`, never `obs_release_date`.
5. **Calibrated Uncertainty & Confidences**: Never force genuine/artifact/uncertain confidence metrics to sum to 100%, and always surface `Insufficient evidence` or quality warnings when `VARIANCE` / `FLAGS` data are missing.
6. **Maintain `PROJECT_STATUS.md`**: Update test status and completed/remaining items after any modification.
