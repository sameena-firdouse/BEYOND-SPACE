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

- **Stage 12 (Additive Update) — Cosmic Time-Lapse Video Creator**:
  - Added `Cosmic Time-Lapse` into sticky top navigation (`Sky Explorer | Space Comparison | Cosmic Time-Lapse | About | Mission Data`) while keeping all existing Landing, Sky Explorer, and Space Comparison features intact.
  - Built `CosmicTimelapse.tsx` supporting sky region (`RA`, `DEC`, `Radius`, verified target presets, `"Import Latest Sky Explorer Region"`), strict single-detector array selector (`D1`–`D6`), UTC date filtering, `"ALL AVAILABLE OBSERVATIONS"` full-collection toggle, multi-select checkboxes + `Select All Matching` / `Deselect All`, and automatic `t_min` MJD chronological sorting (`chronologicalSortObservations`).
  - Explicitly flags missing-timestamp exposures and excludes them from automatic chronological playback unless the user enables manual order resolution; renders an editable pre-generation chronological frame list (`Frame # | UTC Date | Obs ID | Move Up/Down | Remove`).
  - Built scientific time-lapse preparation + FFmpeg video engine (`server/timelapse.ts` + `POST /api/timelapse/prepare`, `POST /api/timelapse/export`, `GET /api/timelapse/video/:exportId`):
    - Fetches real SPHEREx MEF FITS cutouts (`IMAGE`, `FLAGS`, `VARIANCE`, `ZODI`), gracefully skips corrupted/unreadable FITS files (`skippedCorrupted`) unless fewer than 2 valid frames remain, WCS `TAN-SIP` reprojects all frames onto Reference Frame 1, and computes a single pooled `[p1, p996]` `asinh` intensity range across all aligned frames (preventing fake brightness shifts from independent auto-gain).
    - Runs Space Comparison consecutive-pair detection (`analyzeAlignedPair` + `detectChangeRegionsBetweenAligned`) across every epoch step to detect brightening, dimming, new/missing sources, shifts, cosmic-rays, and instrumental artifacts.
    - Pipes pure-TypeScript RGBA scientific frames + built-in crisp 5×7 bitmap HUD telemetry into `/usr/bin/ffmpeg` (`libx264`, `yuv420p`, optional synthesized subtle harmonic `aac` audio track) and verifies MP4 existence, size (>1 KB), and stream duration via `/usr/bin/ffprobe` prior to serving over HTTP `206 Range`.
  - Built `TimelapseStudio.tsx` providing an interactive HTML5 Canvas Video Editor across all 7 visualization modes (`Original Sequence`, `Smooth Crossfade`, `Before-and-After Transitions`, `Animated Difference Map`, `Brightness Change Visualization`, `Highlighted Source Appearance & Disappearance`, `Side-by-Side Comparison`), Play/Pause/Stop/Replay/Step controls, timeline scrubber with actual-observation markers, zoom/pan/fullscreen, FITS modal inspection on any frame, in-browser HTML5 `<video>` MP4 preview before download, MP4 / FITS / Difference Map PNG / Markdown Report downloads, and full scientific telemetry + visual-interpolation disclaimer.

## Features in Progress
- None (all Sky Explorer, Space Comparison, and Cosmic Time-Lapse Video Creator requirements implemented and verified against live NASA/IPAC IRSA SPHEREx data).

## Remaining Features
- Optional future enhancement: Deep-Zoom tiled pyramid viewer for full-frame 2040×2040 FITS files without cutout size limits (currently supports interactive cutouts up to `0.35°` for comparison/time-lapse and full 2040×2040 FITS file downloads).

## Files Created and Modified
- `metadata.json`, `index.html`, `package.json`, `src/index.css`
- `shared/astronomy.ts` — Shared types, SPHEREx D1–D6 specs, coordinate/MJD helpers, Space Comparison contracts, Cosmic Time-Lapse contracts, `chronologicalSortObservations`, `validateComparisonCompatibility`
- `server/db.ts` — Built-in `node:sqlite` search cache and observation index
- `server/irsa.ts` — Live IRSA SIA2 VOTable client with sub-cone tiling (`r >= 0.10°`), `OVERFLOW` MJD pagination, and strict detector isolation
- `server/fits.ts` — Real IRSA cutout fetcher, MEF FITS parser (`IMAGE`, `FLAGS`, `VARIANCE`, `ZODI`), WCS extractor, and PNG renderer
- `server/compare.ts` — Cosmic Change Detector backend (`TAN-SIP` WCS reprojection, background/Zodi normalization, Z-score maps, 8-category classification, 14-point report) + exported reusable pair/epoch helpers
- `server/timelapse.ts` — Cosmic Time-Lapse preparation, shared flux scaling, consecutive change tracking, bitmap HUD renderer, and local FFmpeg/ffprobe H.264 MP4 exporter
- `server.ts` — Express API server (`/api/health`, `/api/search`, `/api/fits/*`, `POST /api/compare`, `POST /api/timelapse/prepare`, `POST /api/timelapse/export`, `GET /api/timelapse/video/:exportId`) + Vite middleware on port 3000
- `src/components/TopBar.tsx` — 3-zone responsive navigation header (`Sky Explorer | Space Comparison | Cosmic Time-Lapse | About | Mission Data`)
- `src/components/LandingPage.tsx` — Cosmic landing page with Mission & Detector sections
- `src/components/SkyExplorer.tsx` — Main Sky Explorer search, D1–D6 galleries, date filter, pagination, and `+ Compare` queue integration
- `src/components/FitsViewerModal.tsx` — Interactive scientific FITS canvas viewer & metadata/export panel
- `src/components/SpaceComparison.tsx` — Space Comparison interface, compatibility validator, and observation picker
- `src/components/ComparisonDashboard.tsx` — Synchronized 5-mode FITS comparison dashboard, inspector, and 14-point downloadable report
- `src/components/CosmicTimelapse.tsx` — Cosmic Time-Lapse Studio observation selector, chronological sequence editor, customization controls
- `src/components/TimelapseStudio.tsx` — Interactive 7-mode time-lapse canvas player, HTML5 `<video>` MP4 preview, exports & scientific telemetry panel
- `src/App.tsx` — Root view coordinator with Sky Explorer, Space Comparison, and Cosmic Time-Lapse state
- `tests/astronomy.test.ts` — Unit + live IRSA SIA2 + Space Comparison + Cosmic Time-Lapse & FFmpeg MP4 creation tests
- `README.md`, `AGENTS.md`, `PROJECT_STATUS.md`

## API Integration Status
- `https://irsa.ipac.caltech.edu/SIA`: Live-verified across all 4 collections (`spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, `spherex_qr3_deep`). Query at `(156.093, -41.644)` with `radius=0.1°` returned `503` real observations (`D1: 101, D2: 67, D3: 86, D4: 100, D5: 66, D6: 83`) in `10.78s` with zero timeouts.
- IRSA IBE FITS Cutout Service (`?center=RA,DEC&size=SIZE`): Live-verified for MEF `IMAGE`, `FLAGS`, `VARIANCE`, and `ZODI` extensions (`503 Retry-After` backoff -> `HTTP 200`).
- Local Video Transcoding (`/usr/bin/ffmpeg` + `/usr/bin/ffprobe`): Verified encoding real H.264/yuv420p MP4 videos (with optional synthesized AAC ambient audio track) to `/tmp/beyond-space-timelapse` (80 MB LRU cap) and serving over HTTP `206 Partial Content`.

## Tests Passed and Failed
- `npm test` (`tests/astronomy.test.ts`): **12 / 12 passed, 0 failed**:
  - RA & DEC validation + search radius bounds
  - MJD -> UTC observation date conversion & strict D1–D6 detector isolation
  - VOTable XML parsing & FITS MEF binary parsing
  - Space Comparison compatibility validation & `TAN-SIP` WCS round-trip accuracy (`< 1e-3 px`)
  - Live IRSA SIA2 query + Space Comparison pipeline on real SPHEREx exposures
  - `chronologicalSortObservations` oldest -> newest MJD sorting (never using release date) & missing-timestamp isolation
  - Live SPHEREx `prepareCosmicTimelapse` WCS alignment + corrupted FITS resilience (`skippedCorrupted`) + real `/usr/bin/ffmpeg` MP4 creation & on-disk verification
- Live Express API E2E verification on `http://127.0.0.1:3000`:
  - `GET /api/health` -> HTTP 200
  - `GET /api/search?ra=156.093&dec=-41.644&radius=0.1` -> HTTP 200 (`503` observations, `86` in D3)
  - `POST /api/compare` -> HTTP 200 (`EXISTING_COMPARE_OK: true`)
  - `POST /api/timelapse/prepare` (3 D3 epochs) -> HTTP 200; mixed `D1+D3` -> HTTP 400 rejected
  - `POST /api/timelapse/export` -> HTTP 200 (`verifiedOnDisk: true`, `95,206` bytes)
  - `GET /api/timelapse/video/:exportId` with `Range: bytes=0-1023` -> HTTP 206 (`bytes 0-1023/95206`)
- Headless Chromium E2E (`playwright-cli`): Verified `Cosmic Time-Lapse` navigation, selecting 3 D3 exposures, `GENERATE VIDEO`, Interactive Frame Studio rendering, `Preview Exported MP4 (Ready)` `<video>` playback (`readyState=4`, `960x540`, `duration=4.67s`), `Sky Explorer`, and `Space Comparison` with `Errors: 0, Warnings: 0`.
- `tsc --noEmit` (`lint_applet`): **Passed**.
- `vite build` (`compile_applet`): **Passed**.

## Known Issues
- Python `astropy`, `numpy`, `scipy`, `photutils`, `opencv`, and `pip` are not installed in this container runtime; therefore FITS MEF parsing, `TAN-SIP` WCS reprojection, shared normalization, and time-lapse frame generation are implemented natively in TypeScript (`server/fits.ts`, `server/compare.ts`, `server/timelapse.ts`, `pngjs`) paired with local `/usr/bin/ffmpeg` for H.264 MP4 muxing.
- IRSA SIA2 queries with `radius >= 0.10°` exhibit server-side timeouts (>75s), mitigated cleanly via `generateConeCover` overlapping `< 0.095°` sub-cones in `server/irsa.ts`.
- IRSA cutout endpoint occasionally returns `HTTP 503` (`Retry-After: 5`) under load; handled automatically with retry/backoff in `server/fits.ts`.

## Exact Next Development Steps
- None; all verification checks passed cleanly.
