# Beyond Space — SPHEREx Sky Explorer

Beyond Space is a full-stack astronomical exploration platform connected directly to NASA/IPAC Infrared Science Archive (IRSA) public **SPHEREx** Level 2 spectral image collections.

## Features
- **Landing Experience**: Cosmic deep-field overview, SPHEREx mission science background, 6-detector spectral breakdown (D1–D6), and official IRSA documentation references.
- **Sky Explorer Coordinate Search**: Decimal (`0–360°` RA, `-90°..+90°` DEC) and sexagesimal (`HMS` / `DMS`) inputs with strict validation, adjustable cone radius (default `0.1°`), and verified SPHEREx target presets.
- **Live NASA/IPAC IRSA SIA2 Integration**: Queries `spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, and `spherex_qr3_deep` with automatic time-window subdivision on `OVERFLOW`.
- **Six Isolated Detector Galleries (D1–D6) + All Detectors Mode**: Strictly segregates observations by `SPHEREx-D1` through `SPHEREx-D6` with independent pagination and chronological sorting (newest first).
- **Date Filtering**: Switch between **ALL AVAILABLE DATES** (all historical observations for the selected detector) and **PARTICULAR DATE** (filtered strictly by actual UTC exposure timestamp `t_min`).
- **Real FITS Processing & Interactive Viewer**: Retrieves real SPHEREx Multi-Extension FITS cutouts from IRSA IBE, decodes calibrated Float32 `IMAGE` (`MJy/sr`) and `ZODI` extensions, computes WCS sky coordinates, and provides interactive pan/zoom, `Asinh`/`Linear`/`Log`/`Sqrt` stretches, colormaps, percentile clipping, zodi subtraction, raw FITS header inspection, and Original FITS / Cutout FITS / PNG downloads.
- **Space Comparison (Cosmic Change Detector)**: Compare 2–6 compatible observations of the same sky region and detector (D1–D6) with strict compatibility validation, WCS `TAN-SIP` projection & bilinear resampling, `ZODI` + 3σ-clipped background subtraction, per-pixel variance propagation, 8-category scientific signal-vs-artifact classification via SPHEREx HDU 2 `FLAGS` bitmasks, synchronized multi-mode difference viewers, and downloadable PNG/Markdown/JSON scientific comparison reports.

## Free Data Access & Zero Billing Guarantee
- Uses only public, unauthenticated NASA/IPAC IRSA SIA2 and IBE endpoints.
- Uses open-source Node.js/TypeScript dependencies (`express`, `fast-xml-parser`, `pngjs`, built-in `node:sqlite`) with zero paid APIs or cloud billing services.

## Local Development
```bash
npm install
npm run dev      # Starts Express + Vite full-stack server on http://localhost:3000
npm test         # Runs unit & live IRSA SIA2 + Space Comparison FITS tests
npm run lint     # TypeScript check
npm run build    # Builds Vite frontend bundle
```
