# Beyond Space — Project Status

Last updated: 2026-11-14

## Completed Features
- **Stage 1 — Landing Page & Top Navigation**:
  - Built 3-zone sticky top navigation (`Beyond Space` wordmark, `Home`, `Sky Explorer`, `About SPHEREx`, `Mission Data`, primary `Sky Explorer` action).
  - Built astronomy-themed landing page (`BEYOND SPACE` hero with generated deep cosmos backdrop & subtle starfield canvas, About SPHEREx with spacecraft visual, How It Works pipeline, Explore the Detectors D1–D6 launcher cards, and Mission Information & Data Sources).
- **Stage 2 — Sky Explorer Search Interface**:
  - Built RA (decimal `0–360` + HMS `HH:MM:SS`) and DEC (decimal `-90..+90` + DMS `DD:MM:SS`) inputs with real-time validation and parsed coordinate readouts.
  - Added adjustable search radius (default `0.1°`, range `0.005°–2.0°`) and verified SPHEREx target presets (`Puppis Wide Field`, `North Ecliptic Pole`, `South Ecliptic Pole`, `COSMOS Extragalactic Field`).
- **Stage 3 & 4 — Live NASA/IPAC IRSA SIA2 API Integration**:
  - Connected `https://irsa.ipac.caltech.edu/SIA` across all four collections (`spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, `spherex_qr3_deep`).
  - Implemented VOTable XML parsing (`fast-xml-parser`) and recursive `TIME` window subdivision when SIA2 returns `OVERFLOW` so complete record sets are retrieved without arbitrary 10/50/100 cutoffs.
  - Added SQLite metadata cache (`node:sqlite` in `./data/beyond_space.db`) with explicit cache provenance, retrieval timestamp, and manual `"Refresh from IRSA Archive"` bypass.
- **Stage 5 & 9 & 10 — Six Independent Detector Galleries + All Detectors**:
  - Enforced strict D1–D6 isolation using verified `energy_bandpassname` / `obs_publisher_did` metadata.
  - Built independent paginated historical galleries for `D1`, `D2`, `D3`, `D4`, `D5`, `D6`, plus a distinct `ALL DETECTORS (D1–D6)` mode displaying six collapsible independent sections.
- **Stage 6 — Observation Date Filtering**:
  - Implemented Option A (`ALL AVAILABLE DATES` — retrieves every historical observation for the selected detector sorted newest first) and Option B (`PARTICULAR DATE` — filters strictly by actual UTC exposure timestamp `t_min`, never `obs_release_date` and never substituting another date).
- **Stage 7 & 8 — Real FITS Cutout Retrieval, Processing & Interactive Viewer**:
  - Implemented IRSA IBE FITS cutout retrieval (`?center=RA,DEC&size=SIZE`) with `503 Retry-After` handling, coordinate fallback to exposure center if near footprint edge, and LRU temporary disk cache (`/tmp/beyond-space-fits`, capped at 180 MB).
  - Implemented pure TypeScript FITS MEF parser (`PRIMARY`, `IMAGE` Float32/64/Int16/32, `FLAGS` Int32, `VARIANCE`, `ZODI`), WCS coordinate extractor, and lossless PNG preview generator (`pngjs`).
  - Built interactive HTML5 Canvas FITS Viewer (`FitsViewerModal.tsx`) supporting zoom, pan, fit-to-screen, 1:1 pixel inspection, fullscreen, live `(X, Y) + (RA, DEC) + MJy/sr + Zodi` cursor probe, non-destructive `Asinh/Linear/Log/Sqrt` stretches, 5 colormaps, percentile clipping, `ZODI` subtraction, raw FITS header inspection, and Original FITS / Cutout FITS / Processed PNG downloads.
- **Stage 11 (Additive Update) — Space Comparison (Cosmic Change Detector)**:
  - Integrated `Space Comparison` into sticky top navigation (`Home`, `Sky Explorer`, `Space Comparison`, `About`, `Mission Data`) and added non-intrusive `+ Compare` / `Queued` toggles + `Open Space Comparison (N)` bar inside Sky Explorer galleries while preserving 100% of existing Sky Explorer functionality.
  - Built `SpaceComparison.tsx` supporting coordinate/radius selection, D1–D6 single-detector selection, UTC date filtering, pagination, `"Import Latest Sky Explorer Results"`, live queue management (2–6 exposures), and strict compatibility validation (`validateComparisonCompatibility`).
  - Built scientific multi-epoch FITS comparison backend (`server/compare.ts` + `POST /api/compare`):
    - Reads real `IMAGE`, `FLAGS`, `VARIANCE`, and `ZODI` MEF FITS extensions and `TAN-SIP` WCS distortion headers (`CRVAL*`, `CRPIX*`, `PC*`, `CDELT*`, `A_p_q`, `B_p_q`).
    - Performs hard bad-pixel masking (`NONFUNC`, `MISSING_DATA`, `SUR_ERROR`, `OVERFLOW`, `NONLINEAR`), optional Zodi subtraction, iterative 3σ-clipped MAD sky background normalization, forward/inverse SIP WCS reprojection, and propagated variance mapping.
    - Measures global WCS registration offsets (`px` & `arcsec`), local source centroids/FWHM, dipole balance ratios, and connected `|Z| >= 3.8σ` change regions classified across 8 categories (Genuine Astronomical Change Candidate vs Cosmic-Ray/Artifact, Bad Pixels/Defect, Misalignment Residual, Background/Calibration Difference, Instrument Noise, Processing Error, Uncertain Difference) with independent non-100%-forced confidence scores.
  - Built `ComparisonDashboard.tsx` with synchronized pan/zoom & live crosshair telemetry across 5 modes (`Side-by-Side (Synced)`, `Image Overlay` with opacity slider, `Difference Map (Δ)`, `Significance Heatmap (σ)`, `Artifact & Quality Mask`), bounding-box overlays, candidate inspector, calibration warnings, 14-point report, and `.png` / `.md` / `.json` downloads.
- **IRSA SIA2 Radius >= 0.1° Resilience Fix**:
  - Diagnosed IRSA SIA2 spatial-index stall for `radius >= 0.10°` (`>75s` timeout vs `~1.1s` for `r <= 0.099°`); implemented `generateConeCover` in `server/irsa.ts` to cover `radius >= 0.10°` using overlapping `< 0.095°` sub-cones and deduplicate by `id`, plus guarded `saveSearchCache` so partial collection errors are never cached.

## Features in Progress
- None (all core Sky Explorer and Space Comparison / Cosmic Change Detector requirements implemented and verified against live NASA/IPAC IRSA SPHEREx data).

## Remaining Features
- Optional future enhancement: Deep-Zoom tiled pyramid viewer for full-frame 2040×2040 FITS files without cutout size limits (currently supports interactive cutouts up to `0.35°` for comparison and full 2040×2040 FITS file downloads).

## Files Created and Modified
- `metadata.json`, `index.html`, `package.json`, `src/index.css`
- `shared/astronomy.ts` — Shared types, SPHEREx D1–D6 specs, coordinate/MJD helpers, Space Comparison contracts, `validateComparisonCompatibility`
- `server/db.ts` — Built-in `node:sqlite` search cache and observation index
- `server/irsa.ts` — Live IRSA SIA2 VOTable client with sub-cone tiling (`r >= 0.10°`), `OVERFLOW` MJD pagination, and strict detector isolation
- `server/fits.ts` — Real IRSA cutout fetcher, MEF FITS parser (`IMAGE`, `FLAGS`, `VARIANCE`, `ZODI`), WCS extractor, and PNG renderer
- `server/compare.ts` — Cosmic Change Detector backend (`TAN-SIP` WCS reprojection, background/Zodi normalization, Z-score maps, 8-category classification, 14-point report)
- `server.ts` — Express API server (`/api/health`, `/api/search`, `/api/fits/*`, `POST /api/compare`) + Vite middleware on port 3000
- `src/components/TopBar.tsx` — 3-zone responsive navigation header with `Space Comparison` view & queue count
- `src/components/LandingPage.tsx` — Cosmic landing page with Mission & Detector sections
- `src/components/SkyExplorer.tsx` — Main Sky Explorer search, D1–D6 galleries, date filter, pagination, and `+ Compare` queue integration
- `src/components/FitsViewerModal.tsx` — Interactive scientific FITS canvas viewer & metadata/export panel
- `src/components/SpaceComparison.tsx` — Space Comparison interface, compatibility validator, and observation picker
- `src/components/ComparisonDashboard.tsx` — Synchronized 5-mode FITS comparison dashboard, inspector, and 14-point downloadable report
- `src/App.tsx` — Root view coordinator with shared comparison queue state
- `tests/astronomy.test.ts` — Unit + live IRSA SIA2 + Space Comparison tests
- `README.md`, `AGENTS.md`, `PROJECT_STATUS.md`

## API Integration Status
- `https://irsa.ipac.caltech.edu/SIA`: Live-verified across all 4 collections (`spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, `spherex_qr3_deep`). Query at `(156.093, -41.644)` with `radius=0.1°` returned `503` real observations (`D1: 101, D2: 67, D3: 86, D4: 100, D5: 66, D6: 83`) in `10.78s` with zero timeouts.
- IRSA IBE FITS Cutout Service (`?center=RA,DEC&size=SIZE`): Live-verified for MEF `IMAGE`, `FLAGS`, `VARIANCE`, and `ZODI` extensions (`503 Retry-After` backoff -> `HTTP 200`).

## Tests Passed and Failed
- `npm test` (`tests/astronomy.test.ts`): **10 / 10 passed, 0 failed**:
  - RA validation (decimal + HMS + bounds)
  - DEC validation (decimal + DMS + bounds)
  - Search radius validation
  - MJD -> UTC observation date conversion
  - Detector assignment strict isolation (`D1`–`D6`)
  - VOTable XML parsing
  - FITS MEF binary parsing (`PRIMARY` + Float32 `IMAGE` HDU)
  - Space Comparison compatibility validation (rejects `< 2`, duplicates, mixed detectors, distant regions, scale mismatch)
  - `TAN-SIP` WCS forward & inverse round-trip accuracy (`< 1e-3 px` error)
  - Live IRSA SIA2 query + Space Comparison pipeline on two real SPHEREx multi-epoch exposures
- Live Express API E2E check on `http://127.0.0.1:3000`:
  - `GET /api/health` -> HTTP 200
  - `GET /api/search?ra=156.093&dec=-41.644&radius=0.1` -> HTTP 200 (`503` observations)
  - `POST /api/compare` (real D3 pair spanning `403.25` days) -> HTTP 200 (`94×94`, `8,340` overlapping pixels, 40 classified change regions including real `HALO` flag attribution, 14-point report)
  - `POST /api/compare` (mixed `D1 + D3` detectors) -> HTTP 400 compatibility rejection
  - `GET /api/fits/preview` & `GET /api/fits/data` -> HTTP 200
- Headless Chromium browser verification (`playwright-cli`): Verified Landing -> Sky Explorer -> Space Comparison -> selecting 2 exposures -> running `Compare Images` -> rendering `14-Point Space Comparison Report` & viewer modes with 0 console errors.
- `tsc --noEmit` (`lint_applet`): **Passed**.
- `vite build` (`compile_applet`): **Passed**.

## Known Issues
- Python `astropy`, `numpy`, `scipy`, `photutils`, and `pip` are not installed in this container runtime; therefore FITS MEF parsing, `TAN-SIP` WCS reprojection, variance propagation, and difference analysis are implemented natively in TypeScript (`server/fits.ts`, `server/compare.ts`, `pngjs`).
- IRSA SIA2 queries with `radius >= 0.10°` exhibit server-side timeouts (>75s), mitigated cleanly via `generateConeCover` overlapping `< 0.095°` sub-cones in `server/irsa.ts`.
- IRSA cutout endpoint occasionally returns `HTTP 503` (`Retry-After: 5`) under load; handled automatically with retry/backoff in `server/fits.ts`.

## Exact Next Development Steps
- None; all verification checks passed cleanly.
