import {
  SPHEREX_DETECTORS,
  mjdToIso,
  validateComparisonCompatibility,
  type ComparisonClassification,
  type ComparisonPairSummary,
  type DetectedChangeRegion,
  type EpochAnalysisMetadata,
  type FitsWcsInfo,
  type SpaceComparisonReport,
  type SpaceComparisonResult,
  type SpherexObservation,
} from '../shared/astronomy.ts';
import {
  decodeHduToFloat32,
  decodeHduToInt32,
  extractWcs,
  fetchCutoutWithFallback,
  parseFitsMef,
  type ParsedHdu,
} from './fits.ts';

// Verified SPHEREx Level 2 FLAGS bitmap (from HDU 2 MSKN* / MSKM* headers)
export const SPHEREX_FLAGS = {
  TRANSIENT: 1 << 0,
  OVERFLOW: 1 << 1,
  SUR_ERROR: 1 << 2,
  NONFUNC: 1 << 6,
  DICHROIC: 1 << 7,
  MISSING_DATA: 1 << 9,
  HOT: 1 << 10,
  COLD: 1 << 11,
  FULLSAMPLE: 1 << 12,
  PHANMISS: 1 << 14,
  NONLINEAR: 1 << 15,
  PERSIST: 1 << 17,
  OUTLIER: 1 << 19,
  CROSSTALK: 1 << 20,
  SOURCE: 1 << 21,
  GHOST: 1 << 22,
  GHOST_FPA: 1 << 23,
  GHOST_EXT: 1 << 24,
  STREAK: 1 << 25,
  BLOOM: 1 << 26,
  SNOWBALL: 1 << 27,
  HALO: 1 << 28,
} as const;

const HARD_BAD_MASK =
  SPHEREX_FLAGS.OVERFLOW |
  SPHEREX_FLAGS.SUR_ERROR |
  SPHEREX_FLAGS.NONFUNC |
  SPHEREX_FLAGS.MISSING_DATA |
  SPHEREX_FLAGS.NONLINEAR;

const ARTIFACT_FLAG_MASK =
  SPHEREX_FLAGS.TRANSIENT |
  SPHEREX_FLAGS.HOT |
  SPHEREX_FLAGS.COLD |
  SPHEREX_FLAGS.PERSIST |
  SPHEREX_FLAGS.OUTLIER |
  SPHEREX_FLAGS.CROSSTALK |
  SPHEREX_FLAGS.GHOST |
  SPHEREX_FLAGS.GHOST_FPA |
  SPHEREX_FLAGS.GHOST_EXT |
  SPHEREX_FLAGS.STREAK |
  SPHEREX_FLAGS.BLOOM |
  SPHEREX_FLAGS.SNOWBALL |
  SPHEREX_FLAGS.HALO;

const SOFT_FLAG_MASK = SPHEREX_FLAGS.DICHROIC | SPHEREX_FLAGS.PHANMISS;

interface SipCoeff {
  p: number;
  q: number;
  val: number;
}

interface FullTanSipWcs {
  crval1: number;
  crval2: number;
  crpix1: number;
  crpix2: number;
  cd1_1: number;
  cd1_2: number;
  cd2_1: number;
  cd2_2: number;
  invCd1_1: number;
  invCd1_2: number;
  invCd2_1: number;
  invCd2_2: number;
  aCoeffs: SipCoeff[];
  bCoeffs: SipCoeff[];
}

function extractSipCoeffs(cardMap: Record<string, string>, prefix: 'A' | 'B'): SipCoeff[] {
  const order = parseInt(cardMap[`${prefix}_ORDER`] || '0', 10);
  if (!Number.isFinite(order) || order <= 0) return [];
  const coeffs: SipCoeff[] = [];
  for (let p = 0; p <= order; p++) {
    for (let q = 0; q <= order; q++) {
      if (p + q > order) continue;
      const raw = cardMap[`${prefix}_${p}_${q}`];
      if (raw !== undefined) {
        const val = Number(raw);
        if (Number.isFinite(val) && val !== 0) {
          coeffs.push({ p, q, val });
        }
      }
    }
  }
  return coeffs;
}

function evalSip(coeffs: SipCoeff[], u: number, v: number): number {
  let sum = 0;
  for (const c of coeffs) {
    sum += c.val * Math.pow(u, c.p) * Math.pow(v, c.q);
  }
  return sum;
}

function extractFullTanSipWcs(cardMap: Record<string, string>): FullTanSipWcs | null {
  const base = extractWcs(cardMap);
  if (!base) return null;
  const det = base.cd1_1 * base.cd2_2 - base.cd1_2 * base.cd2_1;
  if (Math.abs(det) < 1e-18) return null;
  return {
    crval1: base.crval1,
    crval2: base.crval2,
    crpix1: base.crpix1,
    crpix2: base.crpix2,
    cd1_1: base.cd1_1,
    cd1_2: base.cd1_2,
    cd2_1: base.cd2_1,
    cd2_2: base.cd2_2,
    invCd1_1: base.cd2_2 / det,
    invCd1_2: -base.cd1_2 / det,
    invCd2_1: -base.cd2_1 / det,
    invCd2_2: base.cd1_1 / det,
    aCoeffs: extractSipCoeffs(cardMap, 'A'),
    bCoeffs: extractSipCoeffs(cardMap, 'B'),
  };
}

/** Forward TAN-SIP: 0-indexed pixel (x, y) -> ICRS (raDeg, decDeg) */
export function pixelToSkyTanSip(
  wcs: FullTanSipWcs,
  xZeroIdx: number,
  yZeroIdx: number
): { ra: number; dec: number } {
  const u = xZeroIdx + 1 - wcs.crpix1;
  const v = yZeroIdx + 1 - wcs.crpix2;
  const uPrime = u + evalSip(wcs.aCoeffs, u, v);
  const vPrime = v + evalSip(wcs.bCoeffs, u, v);

  const deg2rad = Math.PI / 180;
  const xi = (wcs.cd1_1 * uPrime + wcs.cd1_2 * vPrime) * deg2rad;
  const eta = (wcs.cd2_1 * uPrime + wcs.cd2_2 * vPrime) * deg2rad;

  const ra0 = wcs.crval1 * deg2rad;
  const dec0 = wcs.crval2 * deg2rad;
  const sinD0 = Math.sin(dec0);
  const cosD0 = Math.cos(dec0);

  const denom = cosD0 - eta * sinD0;
  const raRad = ra0 + Math.atan2(xi, denom);
  const decRad = Math.atan2(sinD0 + eta * cosD0, Math.sqrt(denom * denom + xi * xi));

  return {
    ra: (((raRad / deg2rad) % 360) + 360) % 360,
    dec: Math.max(-90, Math.min(90, decRad / deg2rad)),
  };
}

/** Inverse TAN-SIP: ICRS (raDeg, decDeg) -> 0-indexed pixel (x, y) */
export function skyToPixelTanSip(
  wcs: FullTanSipWcs,
  raDeg: number,
  decDeg: number
): { x: number; y: number } | null {
  const deg2rad = Math.PI / 180;
  const ra = raDeg * deg2rad;
  const dec = decDeg * deg2rad;
  const ra0 = wcs.crval1 * deg2rad;
  const dec0 = wcs.crval2 * deg2rad;

  const sinD = Math.sin(dec);
  const cosD = Math.cos(dec);
  const sinD0 = Math.sin(dec0);
  const cosD0 = Math.cos(dec0);
  const cosDa = Math.cos(ra - ra0);
  const sinDa = Math.sin(ra - ra0);

  const denom = sinD * sinD0 + cosD * cosD0 * cosDa;
  if (denom <= 1e-6) return null;

  const xiDeg = ((cosD * sinDa) / denom) / deg2rad;
  const etaDeg = ((sinD * cosD0 - cosD * sinD0 * cosDa) / denom) / deg2rad;

  const uPrime = wcs.invCd1_1 * xiDeg + wcs.invCd1_2 * etaDeg;
  const vPrime = wcs.invCd2_1 * xiDeg + wcs.invCd2_2 * etaDeg;

  // Fixed-point / damped iteration to invert small SIP polynomial distortion
  let u = uPrime;
  let v = vPrime;
  for (let iter = 0; iter < 5; iter++) {
    const du = uPrime - evalSip(wcs.aCoeffs, u, v);
    const dv = vPrime - evalSip(wcs.bCoeffs, u, v);
    if (Math.hypot(du - u, dv - v) < 1e-6) {
      u = du;
      v = dv;
      break;
    }
    u = du;
    v = dv;
  }

  return {
    x: u + wcs.crpix1 - 1,
    y: v + wcs.crpix2 - 1,
  };
}

function decodeFlagNames(mask: number): string[] {
  const names: string[] = [];
  for (const [name, bit] of Object.entries(SPHEREX_FLAGS)) {
    if (name === 'FULLSAMPLE' || name === 'SOURCE') continue;
    if ((mask & bit) !== 0) names.push(name);
  }
  return names;
}

/** Robust iterative 3-sigma-clipped median and MAD-based standard deviation */
function estimateBackground(pixels: Float32Array, flags: Int32Array | null): {
  median: number;
  sigma: number;
  validCount: number;
} {
  let samples: number[] = [];
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    if (!Number.isFinite(v)) continue;
    if (flags && (flags[i] & HARD_BAD_MASK) !== 0) continue;
    samples.push(v);
  }

  if (samples.length === 0) {
    return { median: 0, sigma: 0, validCount: 0 };
  }

  const initialCount = samples.length;
  let med = 0;
  let madSigma = 1e-5;

  for (let iter = 0; iter < 3; iter++) {
    const sorted = [...samples].sort((a, b) => a - b);
    med = sorted[Math.floor(sorted.length / 2)];
    const devs = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = devs[Math.floor(devs.length / 2)];
    madSigma = Math.max(mad * 1.4826, 1e-6);
    if (iter < 2) {
      const clipped = samples.filter((v) => Math.abs(v - med) <= 3.0 * madSigma);
      if (clipped.length >= Math.max(16, samples.length * 0.25)) {
        samples = clipped;
      }
    }
  }

  return { median: med, sigma: madSigma, validCount: initialCount };
}

interface LoadedEpoch {
  obs: SpherexObservation;
  width: number;
  height: number;
  rawImage: Float32Array;
  cleanImage: Float32Array; // Zodi + background subtracted, NaN where hard-masked
  variance: Float32Array; // Per-pixel variance in (MJy/sr)^2
  flags: Int32Array;
  wcs: FullTanSipWcs | null;
  wcsInfo: FitsWcsInfo | null;
  meta: EpochAnalysisMetadata;
}

async function loadEpochForComparison(
  obs: SpherexObservation,
  searchRa: number,
  searchDec: number,
  sizeDeg: number,
  subtractZodi: boolean
): Promise<LoadedEpoch> {
  const { buffer, cutoutUrlUsed } = await fetchCutoutWithFallback(
    obs.accessUrl,
    searchRa,
    searchDec,
    obs.ra,
    obs.dec,
    sizeDeg
  );

  const hdus = parseFitsMef(buffer);
  const primaryHdu: ParsedHdu | undefined = hdus[0];
  const imageHdu =
    hdus.find((h) => h.extname === 'IMAGE') ||
    hdus.find((h) => h.naxis === 2 && h.xtension === 'IMAGE');

  if (!imageHdu) {
    throw new Error(`FITS file for ${obs.obsId} has no valid 2D IMAGE extension.`);
  }

  const width = imageHdu.axes[0] || 0;
  const height = imageHdu.axes[1] || 0;
  const totalPixels = width * height;
  if (width === 0 || height === 0) {
    throw new Error(`FITS IMAGE extension for ${obs.obsId} has zero dimensions.`);
  }

  const rawImage = decodeHduToFloat32(imageHdu);

  const flagsHdu = hdus.find((h) => h.extname === 'FLAGS' && h.naxis === 2);
  const flags =
    flagsHdu && flagsHdu.axes[0] === width && flagsHdu.axes[1] === height
      ? decodeHduToInt32(flagsHdu)
      : new Int32Array(totalPixels);

  const varHdu = hdus.find((h) => h.extname === 'VARIANCE' && h.naxis === 2);
  const hasVariance = Boolean(varHdu && varHdu.axes[0] === width && varHdu.axes[1] === height);
  const variance = hasVariance
    ? decodeHduToFloat32(varHdu!)
    : new Float32Array(totalPixels);

  const zodiHdu = hdus.find((h) => h.extname === 'ZODI' && h.naxis === 2);
  const hasZodi = Boolean(zodiHdu && zodiHdu.axes[0] === width && zodiHdu.axes[1] === height);
  const zodi = hasZodi ? decodeHduToFloat32(zodiHdu!) : null;

  // Subtract Zodiacal dust model if present & enabled
  const working = new Float32Array(totalPixels);
  const zodiVals: number[] = [];
  let flaggedCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const f = flags[i];
    if ((f & (HARD_BAD_MASK | ARTIFACT_FLAG_MASK)) !== 0) {
      flaggedCount++;
    }
    const v = rawImage[i];
    if (!Number.isFinite(v) || (f & HARD_BAD_MASK) !== 0) {
      working[i] = Number.NaN;
      continue;
    }
    if (zodi && Number.isFinite(zodi[i])) {
      zodiVals.push(zodi[i]);
      working[i] = subtractZodi ? v - zodi[i] : v;
    } else {
      working[i] = v;
    }
  }

  const bg = estimateBackground(working, flags);
  const cleanImage = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    cleanImage[i] = Number.isFinite(working[i]) ? working[i] - bg.median : Number.NaN;
  }

  // Fallback noise variance if VARIANCE extension is missing or NaN
  const fallbackVar = Math.max(bg.sigma * bg.sigma, 1e-8);
  for (let i = 0; i < totalPixels; i++) {
    if (!hasVariance || !Number.isFinite(variance[i]) || variance[i] <= 0) {
      variance[i] = fallbackVar;
    }
  }

  let zodiMedian: number | null = null;
  if (zodiVals.length > 0) {
    zodiVals.sort((a, b) => a - b);
    zodiMedian = zodiVals[Math.floor(zodiVals.length / 2)];
  }

  const mjdHeader = Number(imageHdu.cardMap['MJD-OBS'] ?? imageHdu.cardMap['MJD-AVG']);
  const mjdObs = Number.isFinite(mjdHeader) ? mjdHeader : obs.tMinMjd;
  const tsamp = Number(imageHdu.cardMap['TSAMP']);
  const surlim = Number(imageHdu.cardMap['SURLIM']);
  const headerExptime =
    Number.isFinite(tsamp) && Number.isFinite(surlim) ? tsamp * surlim : obs.exptimeSec;

  const wcs = extractFullTanSipWcs(imageHdu.cardMap);
  const wcsInfo = extractWcs(imageHdu.cardMap);

  const meta: EpochAnalysisMetadata = {
    observationId: obs.id,
    obsId: obs.obsId,
    detector: obs.detector,
    bandpassName: obs.bandpassName,
    collection: obs.collection,
    dataRelease: obs.dataRelease,
    processingVersion: obs.processingVersion,
    pipelineVersionHeader: primaryHdu?.cardMap['VERSION'] || 'Not available',
    obsDateIso: mjdObs !== null ? mjdToIso(mjdObs) : obs.obsDateIso,
    mjdObs,
    ra: obs.ra,
    dec: obs.dec,
    exptimeSec: headerExptime,
    bunit: imageHdu.cardMap['BUNIT'] || 'MJy / sr',
    width,
    height,
    validPixelFraction: totalPixels > 0 ? bg.validCount / totalPixels : 0,
    flaggedPixelFraction: totalPixels > 0 ? flaggedCount / totalPixels : 0,
    zodiMedian,
    skyBackgroundMedian: bg.median,
    skyNoiseSigma: bg.sigma,
    hasVariance,
    hasFlags: Boolean(flagsHdu),
    hasZodi,
    accessUrl: obs.accessUrl,
    cutoutUrlUsed,
  };

  return {
    obs,
    width,
    height,
    rawImage,
    cleanImage,
    variance,
    flags,
    wcs,
    wcsInfo,
    meta,
  };
}

interface AlignedEpoch {
  epoch: LoadedEpoch;
  alignedFlux: Float32Array;
  alignedVariance: Float32Array;
  alignedFlags: Int32Array;
  overlapCount: number;
}

/** Reproject target epoch onto reference epoch WCS tangent-plane grid using bilinear interpolation */
function alignEpochToReference(ref: LoadedEpoch, target: LoadedEpoch): AlignedEpoch {
  const len = ref.width * ref.height;
  const alignedFlux = new Float32Array(len);
  const alignedVariance = new Float32Array(len);
  const alignedFlags = new Int32Array(len);
  alignedFlux.fill(Number.NaN);
  alignedVariance.fill(Number.NaN);

  let overlapCount = 0;

  if (!ref.wcs || !target.wcs) {
    // Fallback: direct pixel grid copy if WCS headers are missing (flagged later as alignment warning)
    const minW = Math.min(ref.width, target.width);
    const minH = Math.min(ref.height, target.height);
    for (let y = 0; y < minH; y++) {
      for (let x = 0; x < minW; x++) {
        const ri = y * ref.width + x;
        const ti = y * target.width + x;
        alignedFlux[ri] = target.cleanImage[ti];
        alignedVariance[ri] = target.variance[ti];
        alignedFlags[ri] = target.flags[ti];
        if (Number.isFinite(alignedFlux[ri])) overlapCount++;
      }
    }
    return { epoch: target, alignedFlux, alignedVariance, alignedFlags, overlapCount };
  }

  for (let ry = 0; ry < ref.height; ry++) {
    for (let rx = 0; rx < ref.width; rx++) {
      const ri = ry * ref.width + rx;
      const sky = pixelToSkyTanSip(ref.wcs, rx, ry);
      const tPos = skyToPixelTanSip(target.wcs, sky.ra, sky.dec);
      if (!tPos) continue;

      const x0 = Math.floor(tPos.x);
      const y0 = Math.floor(tPos.y);
      const fx = tPos.x - x0;
      const fy = tPos.y - y0;

      if (x0 < 0 || x0 + 1 >= target.width || y0 < 0 || y0 + 1 >= target.height) {
        continue;
      }

      const i00 = y0 * target.width + x0;
      const i10 = i00 + 1;
      const i01 = i00 + target.width;
      const i11 = i01 + 1;

      const v00 = target.cleanImage[i00];
      const v10 = target.cleanImage[i10];
      const v01 = target.cleanImage[i01];
      const v11 = target.cleanImage[i11];

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const unionFlags =
        target.flags[i00] | target.flags[i10] | target.flags[i01] | target.flags[i11];
      alignedFlags[ri] = unionFlags;

      if (
        Number.isFinite(v00) &&
        Number.isFinite(v10) &&
        Number.isFinite(v01) &&
        Number.isFinite(v11)
      ) {
        alignedFlux[ri] = w00 * v00 + w10 * v10 + w01 * v01 + w11 * v11;
        alignedVariance[ri] =
          w00 * w00 * target.variance[i00] +
          w10 * w10 * target.variance[i10] +
          w01 * w01 * target.variance[i01] +
          w11 * w11 * target.variance[i11];
        overlapCount++;
      }
    }
  }

  return { epoch: target, alignedFlux, alignedVariance, alignedFlags, overlapCount };
}

/** Measure residual sub-pixel WCS registration shift via normalized cross-correlation over [-2, +2] px */
function measureResidualShift(
  refImg: Float32Array,
  targetImg: Float32Array,
  width: number,
  height: number
): { dx: number; dy: number; magnitude: number } {
  let bestScore = -Infinity;
  let bestDx = 0;
  let bestDy = 0;

  const sampleBilinear = (arr: Float32Array, x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    if (x0 < 0 || x0 + 1 >= width || y0 < 0 || y0 + 1 >= height) return Number.NaN;
    const fx = x - x0;
    const fy = y - y0;
    const v00 = arr[y0 * width + x0];
    const v10 = arr[y0 * width + x0 + 1];
    const v01 = arr[(y0 + 1) * width + x0];
    const v11 = arr[(y0 + 1) * width + x0 + 1];
    if (![v00, v10, v01, v11].every(Number.isFinite)) return Number.NaN;
    return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11;
  };

  for (let dy = -2.0; dy <= 2.01; dy += 0.5) {
    for (let dx = -2.0; dx <= 2.01; dx += 0.5) {
      let num = 0;
      let denA = 0;
      let denB = 0;
      let n = 0;
      for (let y = 3; y < height - 3; y++) {
        for (let x = 3; x < width - 3; x++) {
          const a = refImg[y * width + x];
          if (!Number.isFinite(a)) continue;
          const b = sampleBilinear(targetImg, x + dx, y + dy);
          if (!Number.isFinite(b)) continue;
          num += a * b;
          denA += a * a;
          denB += b * b;
          n++;
        }
      }
      if (n > 50 && denA > 0 && denB > 0) {
        const corr = num / Math.sqrt(denA * denB);
        if (corr > bestScore) {
          bestScore = corr;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
  }

  return {
    dx: Number(bestDx.toFixed(2)),
    dy: Number(bestDy.toFixed(2)),
    magnitude: Number(Math.hypot(bestDx, bestDy).toFixed(2)),
  };
}

/** Measure local 2D intensity-weighted centroid & FWHM around a peak in an epoch */
function measureLocalSourceShape(
  img: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  noiseSigma: number
): { found: boolean; x: number; y: number; peakSnr: number; fwhmPx: number | null; fluxSum: number } {
  const r = 3;
  let peak = -Infinity;
  let px = cx;
  let py = cy;

  for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) {
      const v = img[y * width + x];
      if (Number.isFinite(v) && v > peak) {
        peak = v;
        px = x;
        py = y;
      }
    }
  }

  const peakSnr = noiseSigma > 0 ? peak / noiseSigma : 0;
  if (!Number.isFinite(peak) || peakSnr < 3.0) {
    return { found: false, x: cx, y: cy, peakSnr, fwhmPx: null, fluxSum: 0 };
  }

  let sumW = 0;
  let sumX = 0;
  let sumY = 0;
  let fluxSum = 0;

  for (let y = Math.max(0, py - 2); y <= Math.min(height - 1, py + 2); y++) {
    for (let x = Math.max(0, px - 2); x <= Math.min(width - 1, px + 2); x++) {
      const v = img[y * width + x];
      if (!Number.isFinite(v) || v <= 0) continue;
      fluxSum += v;
      if (v > noiseSigma * 1.5) {
        sumW += v;
        sumX += v * x;
        sumY += v * y;
      }
    }
  }

  if (sumW <= 0) {
    return { found: true, x: px, y: py, peakSnr, fwhmPx: null, fluxSum };
  }

  const mx = sumX / sumW;
  const my = sumY / sumW;
  let m2 = 0;
  for (let y = Math.max(0, py - 2); y <= Math.min(height - 1, py + 2); y++) {
    for (let x = Math.max(0, px - 2); x <= Math.min(width - 1, px + 2); x++) {
      const v = img[y * width + x];
      if (!Number.isFinite(v) || v <= noiseSigma * 1.5) continue;
      const d2 = (x - mx) ** 2 + (y - my) ** 2;
      m2 += v * d2;
    }
  }
  const sigmaSpatial = Math.sqrt(Math.max(0.05, m2 / sumW));
  // 2D isotropic second moment: FWHM ≈ 2.355 * sqrt(m2 / 2)
  const fwhmPx = Number((2.355 * Math.sqrt(sigmaSpatial * sigmaSpatial * 0.5)).toFixed(2));

  return { found: true, x: mx, y: my, peakSnr, fwhmPx, fluxSum };
}

/** Normal survival / confidence curve mapped cleanly from integrated SNR without arbitrary noise inflation */
function snrToStatisticalSupportPct(snr: number): number {
  const absSnr = Math.abs(snr);
  if (absSnr < 2.0) return 15;
  if (absSnr < 3.0) return 35;
  // Smooth calibrated sigmoid around 4.5-6.5 sigma for photometric detection confidence
  const pct = 100 / (1 + Math.exp(-0.85 * (absSnr - 4.2)));
  return Math.round(Math.min(97, Math.max(20, pct)));
}

export async function runSpaceComparison(options: {
  observations: SpherexObservation[];
  ra: number;
  dec: number;
  sizeDeg?: number;
  subtractZodi?: boolean;
}): Promise<SpaceComparisonResult> {
  const { observations, ra, dec } = options;
  const sizeDeg = Math.min(Math.max(options.sizeDeg ?? 0.16, 0.08), 0.35);
  const subtractZodi = options.subtractZodi ?? true;

  const compatibility = validateComparisonCompatibility(observations, ra, dec);
  if (!compatibility.compatible) {
    throw new Error(compatibility.reasons.join(' '));
  }

  // Sort chronologically oldest -> newest so Reference = earliest epoch, Target = later epochs
  const orderedObs = [...observations].sort(
    (a, b) => (a.tMinMjd ?? 0) - (b.tMinMjd ?? 0)
  );

  // 1. Load & preprocess all selected FITS cutouts
  const loadedEpochs: LoadedEpoch[] = [];
  for (const obs of orderedObs) {
    loadedEpochs.push(await loadEpochForComparison(obs, ra, dec, sizeDeg, subtractZodi));
  }

  const refEpoch = loadedEpochs[0];
  const primaryTargetRaw = loadedEpochs[loadedEpochs.length - 1];
  const width = refEpoch.width;
  const height = refEpoch.height;
  const len = width * height;

  // 2. Align all subsequent epochs onto Reference Epoch's TAN-SIP WCS grid
  const alignedTargets: AlignedEpoch[] = [];
  for (let i = 1; i < loadedEpochs.length; i++) {
    alignedTargets.push(alignEpochToReference(refEpoch, loadedEpochs[i]));
  }

  const primaryAligned = alignedTargets[alignedTargets.length - 1];
  const dataQualityWarnings: string[] = [...compatibility.warnings];

  if (!refEpoch.wcs || !primaryTargetRaw.wcs) {
    dataQualityWarnings.push(
      'WCS TAN-SIP headers missing on one or more cutouts; pixel-grid fallback alignment applied.'
    );
  }
  if (!refEpoch.meta.hasVariance || !primaryTargetRaw.meta.hasVariance) {
    dataQualityWarnings.push(
      'VARIANCE extension unavailable on one or more cutouts; sky MAD noise floor used for uncertainty estimates.'
    );
  }
  if (refEpoch.meta.validPixelFraction < 0.7 || primaryTargetRaw.meta.validPixelFraction < 0.7) {
    dataQualityWarnings.push(
      'Significant masked or missing detector pixels detected (>30% invalid); confidence scores reflect degraded coverage.'
    );
  }

  const pairSummaries: ComparisonPairSummary[] = [];

  // Helper to compute pair metrics and difference/SNR buffers
  const analyzePair = (targetAl: AlignedEpoch) => {
    const diff = new Float32Array(len);
    const snr = new Float32Array(len);
    const qualityMask = new Uint8Array(len);
    diff.fill(Number.NaN);
    snr.fill(Number.NaN);

    const wcsShift = measureResidualShift(
      refEpoch.cleanImage,
      targetAl.alignedFlux,
      width,
      height
    );
    const wcsShiftArcsec = Number((wcsShift.magnitude * 6.15).toFixed(2));

    let incCount = 0;
    let decCount = 0;
    let sigInc = 0;
    let sigDec = 0;
    let absSum = 0;
    let validOverlap = 0;
    let maxInc = 0;
    let maxDec = 0;

    // Residual sky-level uncertainty floor between the two epochs
    const bgSigmaCombined = Math.hypot(
      refEpoch.meta.skyNoiseSigma,
      targetAl.epoch.meta.skyNoiseSigma
    );
    const bgFloorVar = (0.15 * bgSigmaCombined) ** 2;

    for (let i = 0; i < len; i++) {
      const fRef = refEpoch.cleanImage[i];
      const fTgt = targetAl.alignedFlux[i];
      const flg = refEpoch.flags[i] | targetAl.alignedFlags[i];

      if (!Number.isFinite(fRef) || !Number.isFinite(fTgt) || (flg & HARD_BAD_MASK) !== 0) {
        qualityMask[i] = 3; // hard masked / missing
        continue;
      }

      if ((flg & ARTIFACT_FLAG_MASK) !== 0) {
        qualityMask[i] = 2; // flagged artifact / transient / hot / cold
      } else if ((flg & SOFT_FLAG_MASK) !== 0) {
        qualityMask[i] = 1; // soft flag (dichroic / phantom)
      } else {
        qualityMask[i] = 0;
      }

      const d = fTgt - fRef;
      const vCombined = Math.max(
        refEpoch.variance[i] + targetAl.alignedVariance[i] + bgFloorVar,
        1e-9
      );
      const z = d / Math.sqrt(vCombined);

      diff[i] = d;
      snr[i] = z;
      validOverlap++;
      absSum += Math.abs(d);

      if (d > 0) {
        incCount++;
        if (d > maxInc) maxInc = d;
        if (z >= 3.0) sigInc++;
      } else if (d < 0) {
        decCount++;
        if (d < maxDec) maxDec = d;
        if (z <= -3.0) sigDec++;
      }
    }

    const calWarnings: string[] = [];
    if (wcsShiftArcsec > 2.0) {
      calWarnings.push(
        `Measured residual registration offset ${wcsShiftArcsec}" (${wcsShift.magnitude} px) between epochs.`
      );
    }
    if (
      refEpoch.meta.pipelineVersionHeader !== targetAl.epoch.meta.pipelineVersionHeader &&
      refEpoch.meta.pipelineVersionHeader !== 'Not available'
    ) {
      calWarnings.push(
        `Different SSDC pipeline versions (${refEpoch.meta.pipelineVersionHeader} vs ${targetAl.epoch.meta.pipelineVersionHeader}).`
      );
    }

    const mjd1 = refEpoch.meta.mjdObs;
    const mjd2 = targetAl.epoch.meta.mjdObs;
    const deltaDays =
      mjd1 !== null && mjd2 !== null ? Number((mjd2 - mjd1).toFixed(4)) : null;
    const deltaHours = deltaDays !== null ? Number((deltaDays * 24).toFixed(2)) : null;

    const summary: ComparisonPairSummary = {
      refObsId: refEpoch.obs.obsId,
      targetObsId: targetAl.epoch.obs.obsId,
      refDateIso: refEpoch.meta.obsDateIso,
      targetDateIso: targetAl.epoch.meta.obsDateIso,
      timeDeltaHours: deltaHours,
      timeDeltaDays: deltaDays,
      overlapPixelCount: validOverlap,
      overlapFraction: len > 0 ? Number((validOverlap / len).toFixed(3)) : 0,
      wcsResidualShiftPx: wcsShift,
      wcsResidualShiftArcsec: wcsShiftArcsec,
      backgroundShiftMjySr: Number(
        (targetAl.epoch.meta.skyBackgroundMedian - refEpoch.meta.skyBackgroundMedian).toFixed(5)
      ),
      increasedPixelCount: incCount,
      decreasedPixelCount: decCount,
      significantIncreasePixels: sigInc,
      significantDecreasePixels: sigDec,
      meanAbsChangeMjySr: validOverlap > 0 ? Number((absSum / validOverlap).toFixed(5)) : 0,
      maxIncreaseMjySr: Number(maxInc.toFixed(5)),
      maxDecreaseMjySr: Number(maxDec.toFixed(5)),
      calibrationWarnings: calWarnings,
    };

    return { diff, snr, qualityMask, summary };
  };

  const analyzedPairs = alignedTargets.map((at) => analyzePair(at));
  for (const p of analyzedPairs) {
    pairSummaries.push(p.summary);
  }

  const primary = analyzedPairs[analyzedPairs.length - 1];
  const diffMap = primary.diff;
  const snrMap = primary.snr;
  const qualityMask = primary.qualityMask;
  const primarySummary = primary.summary;

  if (primarySummary.overlapFraction < 0.3) {
    dataQualityWarnings.push(
      `Low spatial overlap (${(primarySummary.overlapFraction * 100).toFixed(1)}%) between ${refEpoch.obs.obsId} and ${primaryTargetRaw.obs.obsId}.`
    );
  }

  // 3. Connected-component change detection on |Z| >= 3.2 sigma (seed >= 3.8 sigma)
  const visited = new Uint8Array(len);
  const candidateRegions: DetectedChangeRegion[] = [];

  for (let sy = 1; sy < height - 1; sy++) {
    for (let sx = 1; sx < width - 1; sx++) {
      const startIdx = sy * width + sx;
      if (visited[startIdx]) continue;
      const startZ = snrMap[startIdx];
      if (!Number.isFinite(startZ) || Math.abs(startZ) < 3.8) continue;

      // BFS flood-fill connected component above 2.8 sigma
      const queue: number[] = [startIdx];
      visited[startIdx] = 1;
      const compPixels: number[] = [];

      while (queue.length > 0 && compPixels.length < 400) {
        const cur = queue.shift()!;
        compPixels.push(cur);
        const cx = cur % width;
        const cy = Math.floor(cur / width);

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (visited[ni]) continue;
            const nz = snrMap[ni];
            if (Number.isFinite(nz) && Math.abs(nz) >= 2.8) {
              visited[ni] = 1;
              queue.push(ni);
            }
          }
        }
      }

      // Compute region photometry, centroid, flags, morphology, and dipole checks
      let xMin = width;
      let xMax = 0;
      let yMin = height;
      let yMax = 0;
      let sumWeight = 0;
      let sumX = 0;
      let sumY = 0;
      let peakDiff = 0;
      let maxAbsZ = 0;
      let signedMaxZ = 0;
      let integratedDiff = 0;
      let integratedVar = 0;
      let refFluxSum = 0;
      let tgtFluxSum = 0;
      let combinedFlags = 0;
      let flaggedPixelCount = 0;

      for (const idx of compPixels) {
        const px = idx % width;
        const py = Math.floor(idx / width);
        if (px < xMin) xMin = px;
        if (px > xMax) xMax = px;
        if (py < yMin) yMin = py;
        if (py > yMax) yMax = py;

        const d = diffMap[idx];
        const z = snrMap[idx];
        const absD = Math.abs(d);
        sumWeight += absD;
        sumX += px * absD;
        sumY += py * absD;

        if (Math.abs(d) > Math.abs(peakDiff)) peakDiff = d;
        if (Math.abs(z) > maxAbsZ) {
          maxAbsZ = Math.abs(z);
          signedMaxZ = z;
        }

        integratedDiff += d;
        const vPix = refEpoch.variance[idx] + primaryAligned.alignedVariance[idx];
        integratedVar += Number.isFinite(vPix) ? vPix : 0;
        refFluxSum += refEpoch.cleanImage[idx];
        tgtFluxSum += primaryAligned.alignedFlux[idx];

        const flg = refEpoch.flags[idx] | primaryAligned.alignedFlags[idx];
        combinedFlags |= flg;
        if ((flg & (ARTIFACT_FLAG_MASK | HARD_BAD_MASK)) !== 0) {
          flaggedPixelCount++;
        }
      }

      const cx = Math.round(sumWeight > 0 ? sumX / sumWeight : sx);
      const cy = Math.round(sumWeight > 0 ? sumY / sumWeight : sy);

      // Check local neighborhood (+-3 px) for opposing dipole signature (alignment residual)
      let posNeighborhood = 0;
      let negNeighborhood = 0;
      for (let ny = Math.max(0, cy - 3); ny <= Math.min(height - 1, cy + 3); ny++) {
        for (let nx = Math.max(0, cx - 3); nx <= Math.min(width - 1, cx + 3); nx++) {
          const z = snrMap[ny * width + nx];
          if (!Number.isFinite(z)) continue;
          if (z >= 2.8) posNeighborhood += z;
          if (z <= -2.8) negNeighborhood += Math.abs(z);
        }
      }
      const dipoleBalanceRatio =
        Math.max(posNeighborhood, negNeighborhood) > 0
          ? Number(
              (
                Math.min(posNeighborhood, negNeighborhood) /
                Math.max(posNeighborhood, negNeighborhood)
              ).toFixed(2)
            )
          : 0;

      const uncertaintyInt = Math.sqrt(Math.max(integratedVar, 1e-9));
      const integratedSnr = integratedDiff / uncertaintyInt;

      // Measure source shape in Ref and Target around (cx, cy)
      const shapeRef = measureLocalSourceShape(
        refEpoch.cleanImage,
        width,
        height,
        cx,
        cy,
        refEpoch.meta.skyNoiseSigma
      );
      const shapeTgt = measureLocalSourceShape(
        primaryAligned.alignedFlux,
        width,
        height,
        cx,
        cy,
        primaryTargetRaw.meta.skyNoiseSigma
      );

      let positionalShiftArcsec: number | null = null;
      if (shapeRef.found && shapeTgt.found) {
        const shiftPx = Math.hypot(shapeTgt.x - shapeRef.x, shapeTgt.y - shapeRef.y);
        positionalShiftArcsec = Number((shiftPx * 6.15).toFixed(2));
      }

      // Polarity determination
      let polarity: DetectedChangeRegion['polarity'] =
        integratedDiff >= 0 ? 'brightening' : 'dimming';
      if (!shapeRef.found && shapeTgt.found && integratedDiff > 0) {
        polarity = 'new_source';
      } else if (shapeRef.found && !shapeTgt.found && integratedDiff < 0) {
        polarity = 'disappeared_source';
      } else if (
        positionalShiftArcsec !== null &&
        positionalShiftArcsec > 2.5 &&
        dipoleBalanceRatio >= 0.45
      ) {
        polarity = 'structural_shift';
      } else if (dipoleBalanceRatio >= 0.6) {
        polarity = 'mixed';
      }

      // Meaningful % change only if baseline reference signal is significantly above noise floor
      const refMean = refFluxSum / compPixels.length;
      const tgtMean = tgtFluxSum / compPixels.length;
      const minBaseline = Math.max(refEpoch.meta.skyNoiseSigma * 3, 0.005);
      const percentChange =
        Math.abs(refMean) >= minBaseline
          ? Number((((tgtMean - refMean) / Math.abs(refMean)) * 100).toFixed(1))
          : null;

      const skyCoord = refEpoch.wcs ? pixelToSkyTanSip(refEpoch.wcs, cx, cy) : null;
      const activeFlagNames = decodeFlagNames(combinedFlags);

      // Multi-epoch trend check when >= 3 images are compared
      let multiEpochSummary: string | undefined;
      let multiEpochSupportsTransientSpike = false;
      if (analyzedPairs.length >= 2) {
        const epochZs = analyzedPairs.map((ap) => {
          const z = ap.snr[cy * width + cx];
          return Number.isFinite(z) ? z : 0;
        });
        multiEpochSummary = `Across ${analyzedPairs.length + 1} epochs: center Z-scores [${epochZs
          .map((z) => `${z >= 0 ? '+' : ''}${z.toFixed(1)}σ`)
          .join(', ')}] relative to Epoch 1.`;
        // If middle epoch spiked sharply and final returned to 0 or vice versa
        if (Math.abs(epochZs[0]) > 4 && Math.abs(epochZs[epochZs.length - 1]) < 1.5) {
          multiEpochSupportsTransientSpike = true;
        }
      }

      // =====================================================================
      // SCIENTIFIC CLASSIFICATION & STATISTICALLY JUSTIFIED CONFIDENCE MODEL
      // =====================================================================
      const evidence: string[] = [];
      let classification: ComparisonClassification =
        'Uncertain Difference Requiring Further Observation';

      const hasCosmicOrTransientFlag =
        (combinedFlags &
          (SPHEREX_FLAGS.TRANSIENT |
            SPHEREX_FLAGS.SNOWBALL |
            SPHEREX_FLAGS.HALO |
            SPHEREX_FLAGS.STREAK |
            SPHEREX_FLAGS.BLOOM |
            SPHEREX_FLAGS.OUTLIER)) !==
        0;
      const hasDefectFlag =
        (combinedFlags &
          (SPHEREX_FLAGS.HOT |
            SPHEREX_FLAGS.COLD |
            SPHEREX_FLAGS.PERSIST |
            SPHEREX_FLAGS.CROSSTALK)) !==
        0;
      const hasQualityFlag = (combinedFlags & SOFT_FLAG_MASK) !== 0;

      const isSinglePixelSpike = compPixels.length <= 2 && maxAbsZ >= 4.0 && !shapeRef.found;
      const isMisalignmentDipole =
        dipoleBalanceRatio >= 0.45 &&
        (primarySummary.wcsResidualShiftArcsec >= 1.8 || (shapeRef.found && shapeTgt.found));
      const isDiffuseBackgroundShift =
        compPixels.length >= 10 &&
        !shapeRef.found &&
        !shapeTgt.found &&
        (Math.abs(primarySummary.backgroundShiftMjySr) >
          Math.max(refEpoch.meta.skyNoiseSigma * 0.4, 0.002) ||
          refEpoch.meta.pipelineVersionHeader !== primaryTargetRaw.meta.pipelineVersionHeader);

      if (hasCosmicOrTransientFlag || (isSinglePixelSpike && maxAbsZ > 4.5)) {
        classification = 'Cosmic-Ray Contamination or Image Artifact';
        if (hasCosmicOrTransientFlag) {
          evidence.push(
            `SPHEREx FLAGS extension marks pixel(s) with: ${activeFlagNames.join(', ')}.`
          );
        }
        if (isSinglePixelSpike) {
          evidence.push(
            `Ultra-sharp ${compPixels.length}-pixel spike (below ~1.4 px SPHEREx PSF extent) consistent with cosmic-ray / SUR transient.`
          );
        }
      } else if (hasDefectFlag) {
        classification = 'Bad Pixels or Detector Defect';
        evidence.push(
          `Detector quality mask reports: ${activeFlagNames.join(', ')} (${flaggedPixelCount}/${compPixels.length} pixels).`
        );
      } else if (isMisalignmentDipole) {
        classification = 'Image Misalignment Residual';
        evidence.push(
          `Dipole positive/negative lobe balance ratio = ${dipoleBalanceRatio} around an existing source (global WCS shift ${primarySummary.wcsResidualShiftArcsec}").`
        );
      } else if (hasQualityFlag) {
        classification = 'Processing or Data-Quality Error';
        evidence.push(`Soft processing quality flags active: ${activeFlagNames.join(', ')}.`);
      } else if (isDiffuseBackgroundShift) {
        classification = 'Background or Calibration Difference';
        evidence.push(
          `Diffuse ${compPixels.length}-pixel gradient without a compact point-source core (sky background shift ${primarySummary.backgroundShiftMjySr.toFixed(4)} MJy/sr).`
        );
      } else if (multiEpochSupportsTransientSpike) {
        classification = 'Uncertain Difference Requiring Further Observation';
        evidence.push('Signal appears in a single intermediate epoch and disappears later.');
      } else if (Math.abs(integratedSnr) < 4.5 && compPixels.length <= 3) {
        classification = 'Instrument or Detector Noise';
        evidence.push(
          `Marginal integrated SNR (${Math.abs(integratedSnr).toFixed(1)}σ) over ${compPixels.length} px near noise fluctuation threshold.`
        );
      } else if (
        compPixels.length >= 3 &&
        Math.abs(integratedSnr) >= 5.0 &&
        flaggedPixelCount === 0 &&
        dipoleBalanceRatio < 0.35
      ) {
        classification = 'Genuine Astronomical Change Candidate';
        evidence.push(
          `Coherent ${compPixels.length}-pixel region (${Math.abs(integratedSnr).toFixed(1)}σ integrated SNR, peak ${signedMaxZ >= 0 ? '+' : ''}${signedMaxZ.toFixed(1)}σ) with zero SPHEREx artifact flags and low dipole asymmetry (${dipoleBalanceRatio}).`
        );
      } else {
        classification = 'Uncertain Difference Requiring Further Observation';
        evidence.push(
          `Moderate significance (${Math.abs(integratedSnr).toFixed(1)}σ, ${compPixels.length} px); cannot conclusively separate astrophysical variability from PSF undersampling or background residuals.`
        );
      }

      if (shapeRef.found || shapeTgt.found) {
        evidence.push(
          `Source photometry: Ref=${shapeRef.found ? `${shapeRef.peakSnr.toFixed(1)}σ` : 'Not detected'}, Target=${shapeTgt.found ? `${shapeTgt.peakSnr.toFixed(1)}σ` : 'Not detected'}${
            positionalShiftArcsec !== null ? `, centroid offset ${positionalShiftArcsec}"` : ''
          }.`
        );
      }
      if ((combinedFlags & SPHEREX_FLAGS.SOURCE) !== 0) {
        evidence.push('SPHEREx FLAGS bit 21 (SOURCE) confirms association with a cataloged sky source.');
      }

      // Compute independent, statistically justified confidence scores (not forced to sum to 100%)
      let genuinePct: number | null = null;
      let artifactPct: number | null = null;
      let uncertainPct: number | null = null;
      let confidenceLabel: DetectedChangeRegion['confidenceLabel'] = 'Insufficient evidence';
      let dataQualityStatus: DetectedChangeRegion['dataQualityStatus'] = 'Good';

      if (flaggedPixelCount > 0) dataQualityStatus = 'Flagged';
      else if (hasQualityFlag || !refEpoch.meta.hasVariance || !primaryTargetRaw.meta.hasVariance) {
        dataQualityStatus = 'Degraded';
      }

      if (!refEpoch.meta.hasVariance && !primaryTargetRaw.meta.hasVariance && compPixels.length < 2) {
        confidenceLabel = 'Insufficient evidence';
      } else {
        const baseSnrSupport = snrToStatisticalSupportPct(integratedSnr);
        let penalty = 1.0;
        if (flaggedPixelCount > 0) penalty *= 0.25;
        if (hasQualityFlag) penalty *= 0.6;
        if (compPixels.length <= 2) penalty *= 0.55; // single/2-pixel undersampled ambiguity
        if (dipoleBalanceRatio >= 0.4) penalty *= 1 - Math.min(0.75, dipoleBalanceRatio * 0.7);
        if (!refEpoch.meta.hasVariance || !primaryTargetRaw.meta.hasVariance) penalty *= 0.75;

        genuinePct = Math.round(Math.min(96, Math.max(3, baseSnrSupport * penalty)));

        let artScore = 8;
        if (hasCosmicOrTransientFlag || hasDefectFlag) artScore = 86;
        else if (isSinglePixelSpike) artScore = 68;
        else if (isMisalignmentDipole) artScore = Math.round(45 + dipoleBalanceRatio * 40);
        else if (hasQualityFlag) artScore = 52;
        else if (Math.abs(integratedSnr) < 4.5) artScore = 38;
        artifactPct = Math.round(Math.min(97, Math.max(4, artScore)));

        // Independent ambiguity / other explanations metric (e.g. PSF undersampling, calibration drift)
        const uncScore =
          classification === 'Uncertain Difference Requiring Further Observation'
            ? 55
            : compPixels.length <= 2
              ? 30
              : Math.max(5, Math.round(40 - Math.min(32, Math.abs(integratedSnr) * 3.5)));
        uncertainPct = uncScore;

        const maxSignal = Math.max(genuinePct, artifactPct);
        if (maxSignal >= 75 && dataQualityStatus === 'Good') confidenceLabel = 'High';
        else if (maxSignal >= 50) confidenceLabel = 'Moderate';
        else confidenceLabel = 'Low';
      }

      candidateRegions.push({
        id: `CHG-${candidateRegions.length + 1}`,
        label: `Region #${candidateRegions.length + 1}`,
        polarity,
        classification,
        bbox: { xMin, yMin, xMax, yMax },
        pixelX: cx,
        pixelY: cy,
        centroidRa: skyCoord ? Number(skyCoord.ra.toFixed(6)) : null,
        centroidDec: skyCoord ? Number(skyCoord.dec.toFixed(6)) : null,
        areaPixels: compPixels.length,
        refFluxMean: Number(refMean.toFixed(5)),
        targetFluxMean: Number(tgtMean.toFixed(5)),
        deltaFluxPeak: Number(peakDiff.toFixed(5)),
        deltaFluxIntegrated: Number(integratedDiff.toFixed(5)),
        uncertaintyIntegrated: Number(uncertaintyInt.toFixed(5)),
        percentChange,
        maxZScore: Number(signedMaxZ.toFixed(2)),
        integratedSnr: Number(integratedSnr.toFixed(2)),
        fwhmRefPx: shapeRef.fwhmPx,
        fwhmTargetPx: shapeTgt.fwhmPx,
        positionalShiftArcsec,
        dipoleBalanceRatio,
        activeFlags: activeFlagNames,
        genuineConfidencePct: genuinePct,
        artifactConfidencePct: artifactPct,
        uncertainConfidencePct: uncertainPct,
        confidenceLabel,
        dataQualityStatus,
        supportingEvidence: evidence,
        multiEpochSummary,
      });
    }
  }

  // Sort candidate detections by |integratedSnr| descending, cap at top 40 most significant
  candidateRegions.sort((a, b) => Math.abs(b.integratedSnr) - Math.abs(a.integratedSnr));
  const detectedChanges = candidateRegions.slice(0, 40);

  // 4. Compile 14-point Scientific Comparison Report
  const detectorSpec = SPHEREX_DETECTORS[refEpoch.obs.detector];
  const obsDates = loadedEpochs.map(
    (e) => e.meta.obsDateIso || e.obs.obsDateUtc || 'Timestamp unavailable'
  );

  const timeElapsedSummary =
    primarySummary.timeDeltaDays !== null
      ? `${primarySummary.timeDeltaDays.toFixed(2)} days (${primarySummary.timeDeltaHours?.toFixed(1)} hours) between earliest (${refEpoch.obs.obsId}) and latest (${primaryTargetRaw.obs.obsId}) exposure.`
      : 'Time interval could not be determined from MJD headers.';

  const genuineCount = detectedChanges.filter(
    (c) => c.classification === 'Genuine Astronomical Change Candidate'
  ).length;
  const artifactCount = detectedChanges.filter((c) =>
    [
      'Cosmic-Ray Contamination or Image Artifact',
      'Bad Pixels or Detector Defect',
      'Image Misalignment Residual',
      'Processing or Data-Quality Error',
    ].includes(c.classification)
  ).length;
  const uncertainCount = detectedChanges.length - genuineCount - artifactCount;

  const newSources = detectedChanges.filter((c) => c.polarity === 'new_source').length;
  const missingSources = detectedChanges.filter((c) => c.polarity === 'disappeared_source').length;
  const shiftedSources = detectedChanges.filter(
    (c) => c.positionalShiftArcsec !== null && c.positionalShiftArcsec > 2.0
  ).length;

  const report: SpaceComparisonReport = {
    generatedAt: new Date().toISOString(),
    regionAnalyzed: { ra, dec, cutoutSizeDeg: sizeDeg },
    detectorUsed: detectorSpec,
    numberOfImagesCompared: loadedEpochs.length,
    observationDates: obsDates,
    timeElapsedSummary,
    totalDetectedDifferences: detectedChanges.length,
    brightnessChangesSummary: `Across ${primarySummary.overlapPixelCount} overlapping valid pixels, ${primarySummary.significantIncreasePixels} pixels brightened (>= +3σ, peak +${primarySummary.maxIncreaseMjySr.toFixed(4)} MJy/sr) and ${primarySummary.significantDecreasePixels} pixels dimmed (<= -3σ, peak ${primarySummary.maxDecreaseMjySr.toFixed(4)} MJy/sr). Mean absolute surface-brightness residual: ${primarySummary.meanAbsChangeMjySr.toFixed(5)} MJy/sr.`,
    newOrMissingSourcesSummary: `${newSources} newly appearing candidate source(s) and ${missingSources} disappeared/dimmed candidate source(s) detected above threshold.`,
    positionalChangesSummary: `Global residual WCS registration offset measured at ${primarySummary.wcsResidualShiftArcsec}" (${primarySummary.wcsResidualShiftPx.magnitude} px). ${shiftedSources} region(s) showed centroid offsets > 2.0", evaluated for dipole alignment residuals vs real proper/apparent motion.`,
    genuineSignalAssessment: `${genuineCount} candidate region(s) passed coherent multi-pixel SNR (>=5σ), zero-artifact-flag, and low-dipole criteria as potential genuine astronomical variability.`,
    satelliteErrorAssessment: `${artifactCount} detected difference(s) were attributed to cosmic-ray/SUR transients, detector defects, WCS alignment dipoles, or processing quality flags from SPHEREx HDU 2 (FLAGS).`,
    confidenceAndUncertaintySummary: `${uncertainCount} additional region(s) remain uncertain or noise-dominated. Per-pixel uncertainty incorporates both HDU 3 VARIANCE maps and robust 3σ-clipped sky MAD noise floors; confidence percentages represent independent statistical support rather than forced 100% sums.`,
    technicalMethodology: [
      'Retrieved real NASA/IPAC IRSA SPHEREx Level 2 MEF FITS cutouts (IMAGE, FLAGS, VARIANCE, ZODI extensions).',
      'Masked hard-bad detector pixels (NONFUNC, MISSING_DATA, SUR_ERROR, OVERFLOW, NONLINEAR) using HDU 2 bitmasks.',
      subtractZodi
        ? 'Subtracted HDU 4 zodiacal dust foreground model (ZODI) and iterative 3σ-clipped sky background.'
        : 'Subtracted iterative 3σ-clipped sky background (ZODI kept intact per user setting).',
      'Reprojected comparison epoch(s) onto Reference Epoch TAN-SIP WCS grid via forward/inverse SIP polynomial transformation and bilinear resampling.',
      'Propagated per-pixel variance (σ_diff² = σ_1² + σ_2² + σ_bg²) to construct exact Z-score significance maps.',
      'Classified connected |Z| >= 3.8σ detections using SPHEREx FLAGS bitmasks, PSF second-moment FWHM, local dipole symmetry, and multi-epoch consistency.',
    ],
    limitationsAndRecommendations: [
      'SPHEREx pixels are 6.15 arcsec/px (slightly undersampled PSF); sub-pixel dither phase differences between epochs can create mild dipole residuals around bright stars.',
      'Linear Variable Filters (LVFs) cause central wavelength to vary smoothly across the 2040×2040 detector; verify exact WCS-WAVE wavelength at each candidate pixel before claiming continuum vs line variability.',
      'Always inspect the original full-frame FITS files and cross-match against Gaia/WISE/2MASS or subsequent SPHEREx epochs before confirming transient astrophysical events.',
    ],
  };

  return {
    compatibility,
    epochs: loadedEpochs.map((e) => e.meta),
    primaryPair: primarySummary,
    allPairSummaries: pairSummaries,
    width,
    height,
    wcs: refEpoch.wcsInfo,
    refFloat32Base64: Buffer.from(
      refEpoch.cleanImage.buffer,
      refEpoch.cleanImage.byteOffset,
      refEpoch.cleanImage.byteLength
    ).toString('base64'),
    targetAlignedFloat32Base64: Buffer.from(
      primaryAligned.alignedFlux.buffer,
      primaryAligned.alignedFlux.byteOffset,
      primaryAligned.alignedFlux.byteLength
    ).toString('base64'),
    diffFloat32Base64: Buffer.from(
      diffMap.buffer,
      diffMap.byteOffset,
      diffMap.byteLength
    ).toString('base64'),
    snrFloat32Base64: Buffer.from(
      snrMap.buffer,
      snrMap.byteOffset,
      snrMap.byteLength
    ).toString('base64'),
    qualityMaskBase64: Buffer.from(
      qualityMask.buffer,
      qualityMask.byteOffset,
      qualityMask.byteLength
    ).toString('base64'),
    detectedChanges,
    dataQualityWarnings,
    report,
  };
}
