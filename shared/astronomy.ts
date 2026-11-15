export type DetectorId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';

export type CollectionId =
  | 'spherex_dr1'
  | 'spherex_dr1_deep'
  | 'spherex_qr3'
  | 'spherex_qr3_deep';

export type DetectorFilterMode = DetectorId | 'ALL_DETECTORS';
export type DateFilterMode = 'ALL' | 'SPECIFIC';

export interface DetectorSpec {
  id: DetectorId;
  bandpassName: string;
  label: string;
  shortLabel: string;
  focalPlane: 'SWIR (Short-Wave IR)' | 'MWIR (Mid-Wave IR)';
  wavelengthMinUm: number;
  wavelengthMaxUm: number;
  wavelengthRangeLabel: string;
  spectralResolvingPower: string;
  pixelScaleArcsec: number;
  arrayDimensions: string;
  scienceFocus: string;
}

export const SPHEREX_DETECTORS: Record<DetectorId, DetectorSpec> = {
  D1: {
    id: 'D1',
    bandpassName: 'SPHEREx-D1',
    label: 'Detector 1 (D1)',
    shortLabel: 'D1',
    focalPlane: 'SWIR (Short-Wave IR)',
    wavelengthMinUm: 0.744,
    wavelengthMaxUm: 1.116,
    wavelengthRangeLabel: '0.74 – 1.12 µm',
    spectralResolvingPower: 'R ≈ 41',
    pixelScaleArcsec: 6.15,
    arrayDimensions: '2040 × 2040 px',
    scienceFocus: 'Optical-to-NIR continuum, stellar photospheres, Lyman-alpha / z~6–9 galaxies',
  },
  D2: {
    id: 'D2',
    bandpassName: 'SPHEREx-D2',
    label: 'Detector 2 (D2)',
    shortLabel: 'D2',
    focalPlane: 'SWIR (Short-Wave IR)',
    wavelengthMinUm: 1.099,
    wavelengthMaxUm: 1.651,
    wavelengthRangeLabel: '1.10 – 1.65 µm',
    spectralResolvingPower: 'R ≈ 41',
    pixelScaleArcsec: 6.15,
    arrayDimensions: '2040 × 2040 px',
    scienceFocus: 'Redshifted H-alpha emission, extragalactic background light, galaxy redshifts',
  },
  D3: {
    id: 'D3',
    bandpassName: 'SPHEREx-D3',
    label: 'Detector 3 (D3)',
    shortLabel: 'D3',
    focalPlane: 'SWIR (Short-Wave IR)',
    wavelengthMinUm: 1.636,
    wavelengthMaxUm: 2.421,
    wavelengthRangeLabel: '1.64 – 2.42 µm',
    spectralResolvingPower: 'R ≈ 41',
    pixelScaleArcsec: 6.15,
    arrayDimensions: '2040 × 2040 px',
    scienceFocus: 'K-band stellar populations, cosmic reionization tracers, dust attenuation',
  },
  D4: {
    id: 'D4',
    bandpassName: 'SPHEREx-D4',
    label: 'Detector 4 (D4)',
    shortLabel: 'D4',
    focalPlane: 'MWIR (Mid-Wave IR)',
    wavelengthMinUm: 2.423,
    wavelengthMaxUm: 3.822,
    wavelengthRangeLabel: '2.42 – 3.82 µm',
    spectralResolvingPower: 'R ≈ 35',
    pixelScaleArcsec: 6.15,
    arrayDimensions: '2040 × 2040 px',
    scienceFocus: 'H2O water ice (3.05 µm), PAH emission (3.3 µm), protoplanetary & molecular clouds',
  },
  D5: {
    id: 'D5',
    bandpassName: 'SPHEREx-D5',
    label: 'Detector 5 (D5)',
    shortLabel: 'D5',
    focalPlane: 'MWIR (Mid-Wave IR)',
    wavelengthMinUm: 3.809,
    wavelengthMaxUm: 4.42,
    wavelengthRangeLabel: '3.81 – 4.42 µm',
    spectralResolvingPower: 'R ≈ 110',
    pixelScaleArcsec: 6.15,
    arrayDimensions: '2040 × 2040 px',
    scienceFocus: 'CO2 ice absorption (4.27 µm), biogenic & interstellar ice spectroscopy',
  },
  D6: {
    id: 'D6',
    bandpassName: 'SPHEREx-D6',
    label: 'Detector 6 (D6)',
    shortLabel: 'D6',
    focalPlane: 'MWIR (Mid-Wave IR)',
    wavelengthMinUm: 4.412,
    wavelengthMaxUm: 5.002,
    wavelengthRangeLabel: '4.41 – 5.00 µm',
    spectralResolvingPower: 'R ≈ 130',
    pixelScaleArcsec: 6.15,
    arrayDimensions: '2040 × 2040 px',
    scienceFocus: 'CO ice (4.67 µm), XCN (4.62 µm), OCS & warm dust thermal emission',
  },
};

export const DETECTOR_IDS: DetectorId[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];

export interface CollectionSpec {
  id: CollectionId;
  name: string;
  surveyType: 'Wide Survey' | 'Deep Survey';
  releaseLabel: string;
  description: string;
}

export const SPHEREX_COLLECTIONS: CollectionSpec[] = [
  {
    id: 'spherex_dr1',
    name: 'SPHEREx DR1 (Wide)',
    surveyType: 'Wide Survey',
    releaseLabel: 'Data Release 1',
    description: 'Uniformly calibrated Level 2 spectral images from the primary all-sky wide survey.',
  },
  {
    id: 'spherex_dr1_deep',
    name: 'SPHEREx DR1 (Deep)',
    surveyType: 'Deep Survey',
    releaseLabel: 'Data Release 1',
    description: 'High-cadence Level 2 spectral images targeting the North & South Ecliptic Pole deep fields.',
  },
  {
    id: 'spherex_qr3',
    name: 'SPHEREx QR3 (Wide)',
    surveyType: 'Wide Survey',
    releaseLabel: 'Quick Release 3',
    description: 'Recent wide-survey Level 2 exposures with updated PSF and photometric calibration.',
  },
  {
    id: 'spherex_qr3_deep',
    name: 'SPHEREx QR3 (Deep)',
    surveyType: 'Deep Survey',
    releaseLabel: 'Quick Release 3',
    description: 'Recent deep-field Level 2 exposures around the ecliptic poles.',
  },
];

export interface SkyPreset {
  id: string;
  name: string;
  regionLabel: string;
  ra: number;
  dec: number;
  radius: number;
  notes: string;
}

export const VERIFIED_SKY_PRESETS: SkyPreset[] = [
  {
    id: 'puppis-wide',
    name: 'Puppis Wide Field',
    regionLabel: 'SPHEREx Wide Survey',
    ra: 156.093,
    dec: -41.644,
    radius: 0.1,
    notes: 'Dense DR1 & QR3 multi-epoch coverage across all 6 detectors.',
  },
  {
    id: 'nep-deep',
    name: 'North Ecliptic Pole',
    regionLabel: 'SPHEREx Deep Field',
    ra: 270.0,
    dec: 66.5,
    radius: 0.1,
    notes: 'Ultra-deep ecliptic pole cadence in DR1 Deep & QR3 Deep.',
  },
  {
    id: 'sep-deep',
    name: 'South Ecliptic Pole',
    regionLabel: 'SPHEREx Deep Field',
    ra: 90.0,
    dec: -66.5,
    radius: 0.1,
    notes: 'Southern deep-field survey with repeated multi-month visits.',
  },
  {
    id: 'cosmos-field',
    name: 'COSMOS Extragalactic Field',
    regionLabel: 'Extragalactic Survey',
    ra: 150.119,
    dec: 2.206,
    radius: 0.15,
    notes: 'Classic 2 sq-deg extragalactic benchmark field near the celestial equator.',
  },
];

export interface SpherexObservation {
  id: string; // Unique key: collection + obs_publisher_did
  obsId: string;
  obsPublisherDid: string;
  detector: DetectorId;
  bandpassName: string;
  collection: CollectionId;
  dataRelease: string;
  processingVersion: string;
  ra: number;
  dec: number;
  tMinMjd: number | null;
  tMaxMjd: number | null;
  obsDateIso: string | null; // Actual observation UTC ISO timestamp derived from t_min
  obsDateUtc: string | null; // YYYY-MM-DD derived from actual observation timestamp
  obsReleaseDate: string | null; // Archive release timestamp (distinct from observation date!)
  wavelengthMinUm: number | null;
  wavelengthMaxUm: number | null;
  resolvingPower: number | null;
  exptimeSec: number | null;
  pixelScaleArcsec: number | null;
  fovDeg: number | null;
  targetName: string | null;
  accessUrl: string;
  fitsFilename: string;
  estSizeKb: number | null;
  archiveSourceUrl: string;
}

export interface CollectionQueryReport {
  collection: CollectionId;
  status: 'OK' | 'OVERFLOW_SUBDIVIDED' | 'PARTIAL_OVERFLOW' | 'ERROR';
  totalRetrieved: number;
  subqueriesExecuted: number;
  durationMs: number;
  queryUrl: string;
  errorMessage?: string;
}

export interface SearchResponse {
  query: {
    ra: number;
    dec: number;
    radius: number;
    collections: CollectionId[];
  };
  retrievedAt: string;
  fromCache: boolean;
  totalAcrossAllDetectors: number;
  availableDatesUtc: string[]; // Sorted newest first
  byDetector: Record<DetectorId, SpherexObservation[]>;
  detectorCounts: Record<DetectorId, number>;
  collectionReports: CollectionQueryReport[];
  archiveSource: string;
}

export interface FitsHeaderCard {
  key: string;
  value: string;
  comment: string;
}

export interface FitsImageStats {
  width: number;
  height: number;
  min: number;
  max: number;
  median: number;
  mean: number;
  stdDev: number;
  p01: number;
  p05: number;
  p1: number;
  p50: number;
  p95: number;
  p99: number;
  p995: number;
  p999: number;
  validPixels: number;
  totalPixels: number;
  hasZodi: boolean;
  bunit: string;
}

export interface FitsWcsInfo {
  crval1: number;
  crval2: number;
  crpix1: number;
  crpix2: number;
  cd1_1: number;
  cd1_2: number;
  cd2_1: number;
  cd2_2: number;
  ctype1: string;
  ctype2: string;
}

export interface FitsViewerPayload {
  observationId: string;
  cutoutCenterRa: number;
  cutoutCenterDec: number;
  cutoutSizeDeg: number;
  stats: FitsImageStats;
  wcs: FitsWcsInfo | null;
  headers: {
    primary: FitsHeaderCard[];
    image: FitsHeaderCard[];
  };
  /** Base64 encoded Float32Array (little-endian) for IMAGE extension */
  imageFloat32Base64: string;
  /** Optional Base64 encoded Float32Array for ZODI extension */
  zodiFloat32Base64: string | null;
  sourceFitsUrl: string;
  cutoutUrlUsed: string;
  retrievedAt: string;
}

export interface CoordinateParseResult {
  valid: boolean;
  value: number | null;
  error: string | null;
  inputFormat: 'decimal' | 'sexagesimal' | 'empty' | 'invalid';
}

/**
 * Parse Right Ascension from decimal degrees (0..360) or HMS (e.g. "10:24:22.3", "10h 24m 22.3s", "10 24 22.3").
 */
export function parseRightAscension(raw: string): CoordinateParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, value: null, error: 'Right Ascension is required (0° to 360° or HH:MM:SS).', inputFormat: 'empty' };
  }

  // Plain decimal degrees
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed);
    if (!Number.isFinite(val)) {
      return { valid: false, value: null, error: 'Invalid numeric RA value.', inputFormat: 'invalid' };
    }
    if (val < 0 || val > 360) {
      return {
        valid: false,
        value: null,
        error: `RA decimal degrees must be between 0 and 360 (received ${val}°).`,
        inputFormat: 'invalid',
      };
    }
    return { valid: true, value: val === 360 ? 0 : val, error: null, inputFormat: 'decimal' };
  }

  // HMS format: "10h 24m 22.32s" or "10:24:22.32" or "10 24 22.32"
  const hmsMatch = trimmed.match(
    /^(\d{1,2})\s*(?:h|:|\s)\s*(\d{1,2})\s*(?:m|:|\s)\s*(\d{1,2}(?:\.\d+)?)\s*s?$/i
  );
  if (hmsMatch) {
    const hours = parseInt(hmsMatch[1], 10);
    const mins = parseInt(hmsMatch[2], 10);
    const secs = parseFloat(hmsMatch[3]);
    if (hours < 0 || hours >= 24 || mins < 0 || mins >= 60 || secs < 0 || secs >= 60) {
      return {
        valid: false,
        value: null,
        error: 'RA HMS must have hours 0–23, minutes 0–59, seconds < 60.',
        inputFormat: 'invalid',
      };
    }
    const deg = (hours + mins / 60 + secs / 3600) * 15;
    return { valid: true, value: Number(deg.toFixed(7)), error: null, inputFormat: 'sexagesimal' };
  }

  return {
    valid: false,
    value: null,
    error: 'Enter RA in decimal degrees (e.g. 156.093) or HMS (e.g. 10:24:22.3).',
    inputFormat: 'invalid',
  };
}

/**
 * Parse Declination from decimal degrees (-90..+90) or DMS (e.g. "-41:38:38.4", "-41d 38m 38.4s", "+66 30 00").
 */
export function parseDeclination(raw: string): CoordinateParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, value: null, error: 'Declination is required (-90° to +90° or DD:MM:SS).', inputFormat: 'empty' };
  }

  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed);
    if (!Number.isFinite(val)) {
      return { valid: false, value: null, error: 'Invalid numeric DEC value.', inputFormat: 'invalid' };
    }
    if (val < -90 || val > 90) {
      return {
        valid: false,
        value: null,
        error: `Declination must be between -90° and +90° (received ${val}°).`,
        inputFormat: 'invalid',
      };
    }
    return { valid: true, value: val, error: null, inputFormat: 'decimal' };
  }

  const dmsMatch = trimmed.match(
    /^([+-])?\s*(\d{1,2})\s*(?:d|°|:|\s)\s*(\d{1,2})\s*(?:m|'|′|:|\s)\s*(\d{1,2}(?:\.\d+)?)\s*(?:s|"|″)?$/i
  );
  if (dmsMatch) {
    const sign = dmsMatch[1] === '-' ? -1 : 1;
    const degPart = parseInt(dmsMatch[2], 10);
    const arcmin = parseInt(dmsMatch[3], 10);
    const arcsec = parseFloat(dmsMatch[4]);
    if (degPart > 90 || arcmin >= 60 || arcsec >= 60) {
      return {
        valid: false,
        value: null,
        error: 'DEC DMS must have degrees 0–90, arcmin 0–59, arcsec < 60.',
        inputFormat: 'invalid',
      };
    }
    const val = sign * (degPart + arcmin / 60 + arcsec / 3600);
    if (val < -90 || val > 90) {
      return {
        valid: false,
        value: null,
        error: 'Declination must be between -90° and +90°.',
        inputFormat: 'invalid',
      };
    }
    return { valid: true, value: Number(val.toFixed(7)), error: null, inputFormat: 'sexagesimal' };
  }

  return {
    valid: false,
    value: null,
    error: 'Enter DEC in decimal degrees (e.g. -41.644) or DMS (e.g. -41:38:38.4).',
    inputFormat: 'invalid',
  };
}

export function validateSearchRadius(raw: string | number): { valid: boolean; value: number | null; error: string | null } {
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || num <= 0) {
    return { valid: false, value: null, error: 'Radius must be a positive number in degrees (e.g. 0.1).' };
  }
  if (num < 0.005 || num > 2.0) {
    return { valid: false, value: null, error: 'Search radius must be between 0.005° and 2.0°.' };
  }
  return { valid: true, value: num, error: null };
}

export function formatRaHms(raDeg: number): string {
  const norm = ((raDeg % 360) + 360) % 360;
  const totalHours = norm / 15;
  const h = Math.floor(totalHours);
  const remMin = (totalHours - h) * 60;
  const m = Math.floor(remMin);
  const s = (remMin - m) * 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.toFixed(2).padStart(5, '0')}s`;
}

export function formatDecDms(decDeg: number): string {
  const sign = decDeg < 0 ? '-' : '+';
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const remMin = (abs - d) * 60;
  const m = Math.floor(remMin);
  const s = (remMin - m) * 60;
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}' ${s.toFixed(1).padStart(4, '0')}"`;
}

/**
 * Convert Modified Julian Date (MJD) to UTC ISO-8601 string.
 * Unix Epoch 1970-01-01T00:00:00Z = MJD 40587.0.
 */
export function mjdToIso(mjd: number | null | undefined): string | null {
  if (mjd === null || mjd === undefined || !Number.isFinite(mjd)) return null;
  const unixMs = (mjd - 40587.0) * 86400000;
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function mjdToUtcDate(mjd: number | null | undefined): string | null {
  const iso = mjdToIso(mjd);
  return iso ? iso.slice(0, 10) : null;
}

export function parseDetectorFromRecord(
  bandpassName?: string | null,
  publisherDid?: string | null,
  accessUrl?: string | null
): DetectorId | null {
  const bp = (bandpassName || '').trim().toUpperCase();
  const matchBp = bp.match(/^SPHEREX-D([1-6])$/);
  if (matchBp) return `D${matchBp[1]}` as DetectorId;

  const did = (publisherDid || '').trim().toUpperCase();
  const matchDid = did.match(/\/D([1-6])$/);
  if (matchDid) return `D${matchDid[1]}` as DetectorId;

  const url = (accessUrl || '').trim();
  const matchUrl = url.match(/_[1-6]D([1-6])_spx_/);
  if (matchUrl) return `D${matchUrl[1]}` as DetectorId;

  return null;
}

// ============================================================================
// SPACE COMPARISON (COSMIC CHANGE DETECTOR) TYPES & COMPATIBILITY VALIDATION
// ============================================================================

export type ComparisonClassification =
  | 'Genuine Astronomical Change Candidate'
  | 'Instrument or Detector Noise'
  | 'Cosmic-Ray Contamination or Image Artifact'
  | 'Bad Pixels or Detector Defect'
  | 'Image Misalignment Residual'
  | 'Background or Calibration Difference'
  | 'Processing or Data-Quality Error'
  | 'Uncertain Difference Requiring Further Observation';

export type ChangePolarity = 'brightening' | 'dimming' | 'new_source' | 'disappeared_source' | 'structural_shift' | 'mixed';

export interface ComparisonCompatibilityResult {
  compatible: boolean;
  reasons: string[];
  warnings: string[];
  detector: DetectorId | null;
  maxCenterSeparationDeg: number;
  wavelengthSpanUm: [number, number] | null;
}

export interface EpochAnalysisMetadata {
  observationId: string;
  obsId: string;
  detector: DetectorId;
  bandpassName: string;
  collection: CollectionId;
  dataRelease: string;
  processingVersion: string;
  pipelineVersionHeader: string;
  obsDateIso: string | null;
  mjdObs: number | null;
  ra: number;
  dec: number;
  exptimeSec: number | null;
  bunit: string;
  width: number;
  height: number;
  validPixelFraction: number;
  flaggedPixelFraction: number;
  zodiMedian: number | null;
  skyBackgroundMedian: number;
  skyNoiseSigma: number;
  hasVariance: boolean;
  hasFlags: boolean;
  hasZodi: boolean;
  accessUrl: string;
  cutoutUrlUsed: string;
}

export interface DetectedChangeRegion {
  id: string;
  label: string;
  polarity: ChangePolarity;
  classification: ComparisonClassification;
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
  pixelX: number;
  pixelY: number;
  centroidRa: number | null;
  centroidDec: number | null;
  areaPixels: number;
  refFluxMean: number;
  targetFluxMean: number;
  deltaFluxPeak: number;
  deltaFluxIntegrated: number;
  uncertaintyIntegrated: number;
  percentChange: number | null;
  maxZScore: number;
  integratedSnr: number;
  fwhmRefPx: number | null;
  fwhmTargetPx: number | null;
  positionalShiftArcsec: number | null;
  dipoleBalanceRatio: number;
  activeFlags: string[];
  /** Independent confidence metrics — NOT forced to add up to 100% */
  genuineConfidencePct: number | null;
  artifactConfidencePct: number | null;
  uncertainConfidencePct: number | null;
  confidenceLabel: 'High' | 'Moderate' | 'Low' | 'Insufficient evidence';
  dataQualityStatus: 'Good' | 'Degraded' | 'Flagged' | 'Insufficient';
  supportingEvidence: string[];
  multiEpochSummary?: string;
}

export interface ComparisonPairSummary {
  refObsId: string;
  targetObsId: string;
  refDateIso: string | null;
  targetDateIso: string | null;
  timeDeltaHours: number | null;
  timeDeltaDays: number | null;
  overlapPixelCount: number;
  overlapFraction: number;
  wcsResidualShiftPx: { dx: number; dy: number; magnitude: number };
  wcsResidualShiftArcsec: number;
  backgroundShiftMjySr: number;
  increasedPixelCount: number;
  decreasedPixelCount: number;
  significantIncreasePixels: number;
  significantDecreasePixels: number;
  meanAbsChangeMjySr: number;
  maxIncreaseMjySr: number;
  maxDecreaseMjySr: number;
  calibrationWarnings: string[];
}

export interface SpaceComparisonReport {
  generatedAt: string;
  regionAnalyzed: {
    ra: number;
    dec: number;
    cutoutSizeDeg: number;
  };
  detectorUsed: DetectorSpec;
  numberOfImagesCompared: number;
  observationDates: string[];
  timeElapsedSummary: string;
  totalDetectedDifferences: number;
  brightnessChangesSummary: string;
  newOrMissingSourcesSummary: string;
  positionalChangesSummary: string;
  genuineSignalAssessment: string;
  satelliteErrorAssessment: string;
  confidenceAndUncertaintySummary: string;
  technicalMethodology: string[];
  limitationsAndRecommendations: string[];
}

export interface SpaceComparisonResult {
  compatibility: ComparisonCompatibilityResult;
  epochs: EpochAnalysisMetadata[];
  primaryPair: ComparisonPairSummary;
  allPairSummaries: ComparisonPairSummary[];
  width: number;
  height: number;
  wcs: FitsWcsInfo | null;
  /** Reference epoch pixels (Zodi + sky-subtracted MJy/sr, Float32 base64) */
  refFloat32Base64: string;
  /** Primary comparison target epoch reprojected onto reference WCS grid (Float32 base64) */
  targetAlignedFloat32Base64: string;
  /** Aligned difference map (Target - Ref in MJy/sr, Float32 base64) */
  diffFloat32Base64: string;
  /** Propagated Z-score significance map (sigma units, Float32 base64) */
  snrFloat32Base64: string;
  /** Artifact / hard-bad-pixel mask (Uint8 base64: 0=clean, 1=soft flag, 2=artifact flag, 3=hard-masked/invalid) */
  qualityMaskBase64: string;
  detectedChanges: DetectedChangeRegion[];
  dataQualityWarnings: string[];
  report: SpaceComparisonReport;
}

export function angularSeparationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const toRad = Math.PI / 180;
  const a1 = ra1 * toRad;
  const d1 = dec1 * toRad;
  const a2 = ra2 * toRad;
  const d2 = dec2 * toRad;
  const sinHalfD = Math.sin((d2 - d1) / 2);
  const sinHalfA = Math.sin((a2 - a1) / 2);
  const h = sinHalfD * sinHalfD + Math.cos(d1) * Math.cos(d2) * sinHalfA * sinHalfA;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return c / toRad;
}

/**
 * Strictly validate whether two or more SPHEREx observations are scientifically compatible for comparison.
 * Checks detector identity (D1..D6), wavelength band compatibility, spatial overlap, and pixel scale.
 */
export function validateComparisonCompatibility(
  observations: SpherexObservation[],
  targetRa?: number,
  targetDec?: number
): ComparisonCompatibilityResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (observations.length < 2) {
    reasons.push('Select at least 2 observations to perform a comparison.');
    return {
      compatible: false,
      reasons,
      warnings,
      detector: observations[0]?.detector ?? null,
      maxCenterSeparationDeg: 0,
      wavelengthSpanUm: null,
    };
  }

  // Check unique observation IDs
  const uniqueIds = new Set(observations.map((o) => o.id));
  if (uniqueIds.size < observations.length) {
    reasons.push('Duplicate observation selected. Choose distinct exposures for comparison.');
  }

  // 1. Strict detector & wavelength band check
  const detectors = Array.from(new Set(observations.map((o) => o.detector)));
  if (detectors.length > 1) {
    reasons.push(
      `Incompatible detectors selected (${detectors.join(', ')}). SPHEREx detectors D1–D6 span distinct near-infrared wavelength bands (0.74–5.00 µm); direct pixel subtraction across different detectors is scientifically invalid.`
    );
  }

  const detector = detectors.length === 1 ? detectors[0] : null;

  // Check bandpass wavelength alignment
  const wMins = observations
    .map((o) => o.wavelengthMinUm)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const wMaxs = observations
    .map((o) => o.wavelengthMaxUm)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  let wavelengthSpanUm: [number, number] | null = null;
  if (wMins.length > 0 && wMaxs.length > 0) {
    const minW = Math.min(...wMins);
    const maxW = Math.max(...wMaxs);
    wavelengthSpanUm = [minW, maxW];
    // Verify bandpass centers don't diverge beyond 0.25 µm
    const centers = observations
      .filter((o) => o.wavelengthMinUm !== null && o.wavelengthMaxUm !== null)
      .map((o) => ((o.wavelengthMinUm as number) + (o.wavelengthMaxUm as number)) / 2);
    if (centers.length >= 2) {
      const spread = Math.max(...centers) - Math.min(...centers);
      if (spread > 0.25) {
        reasons.push(
          `Incompatible spectral bandpasses (band center spread ${spread.toFixed(3)} µm exceeds 0.25 µm tolerance).`
        );
      }
    }
  }

  // 2. Spatial overlap check (SPHEREx detector FOV is 3.485° x 3.485°, half-diagonal ~2.46°)
  let maxSep = 0;
  for (let i = 0; i < observations.length; i++) {
    for (let j = i + 1; j < observations.length; j++) {
      const sep = angularSeparationDeg(
        observations[i].ra,
        observations[i].dec,
        observations[j].ra,
        observations[j].dec
      );
      if (sep > maxSep) maxSep = sep;
    }
    if (targetRa !== undefined && targetDec !== undefined) {
      const sepToTarget = angularSeparationDeg(
        observations[i].ra,
        observations[i].dec,
        targetRa,
        targetDec
      );
      if (sepToTarget > 2.45) {
        reasons.push(
          `Observation ${observations[i].obsId} center is ${sepToTarget.toFixed(2)}° from target (${targetRa.toFixed(3)}°, ${targetDec.toFixed(3)}°), outside the 3.485° SPHEREx detector field of view.`
        );
      }
    }
  }

  if (maxSep > 3.4) {
    reasons.push(
      `Selected observations are separated by ${maxSep.toFixed(2)}° and do not reliably overlap the same sky region.`
    );
  }

  // 3. Spatial pixel scale check
  const scales = observations
    .map((o) => o.pixelScaleArcsec)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (scales.length >= 2) {
    const scaleRatio = Math.max(...scales) / Math.min(...scales);
    if (scaleRatio > 1.25) {
      reasons.push(
        `Incompatible spatial pixel scales (${Math.min(...scales).toFixed(2)}" vs ${Math.max(...scales).toFixed(2)}").`
      );
    }
  }

  // 4. Informative non-blocking calibration / timing warnings
  const releases = Array.from(new Set(observations.map((o) => o.collection)));
  if (releases.length > 1) {
    warnings.push(
      `Mixing archive collections (${releases.join(', ')}): calibration or PSF pipeline versions may differ slightly and are checked in FITS headers.`
    );
  }

  const expTimes = observations
    .map((o) => o.exptimeSec)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (expTimes.length >= 2) {
    const expDiff = Math.max(...expTimes) - Math.min(...expTimes);
    if (expDiff > 5) {
      warnings.push(
        `Integration times differ across exposures (${Math.min(...expTimes).toFixed(1)}s vs ${Math.max(...expTimes).toFixed(1)}s); noise variance and surface-brightness calibration are accounted for during preprocessing.`
      );
    }
  }

  const dates = observations.map((o) => o.obsDateUtc).filter(Boolean);
  if (dates.length >= 2 && new Set(dates).size === 1) {
    warnings.push(
      `Selected exposures share the same UTC date (${dates[0]}); short-timescale variations or instrumental transients may dominate.`
    );
  }

  return {
    compatible: reasons.length === 0,
    reasons,
    warnings,
    detector,
    maxCenterSeparationDeg: Number(maxSep.toFixed(4)),
    wavelengthSpanUm,
  };
}

// ============================================================================
// COSMIC TIME-LAPSE VIDEO CREATOR TYPES & CHRONOLOGICAL SORTING
// ============================================================================

export type TimelapseVisualizationMode =
  | 'original_sequence'
  | 'smooth_crossfade'
  | 'before_after_transitions'
  | 'animated_difference_map'
  | 'brightness_change'
  | 'source_appear_disappear'
  | 'side_by_side_comparison';

export type TimelapseAspectRatio = '16:9' | '9:16' | '1:1';

export interface TimelapseCustomSettings {
  title: string;
  visualizationMode: TimelapseVisualizationMode;
  aspectRatio: TimelapseAspectRatio;
  fps: number;
  frameDurationSec: number;
  transitionDurationSec: number;
  playbackSpeed: number;
  showDates: boolean;
  showCoordinates: boolean;
  showDetectorInfo: boolean;
  showAnnotations: boolean;
  includeAmbientAudio: boolean;
}

export interface ChronologicalSortResult {
  sorted: SpherexObservation[];
  missingTimestamps: SpherexObservation[];
}

/**
 * Strictly sort SPHEREx observations chronologically (oldest -> newest) using ONLY
 * actual observation timestamps (t_min MJD or derived UTC obsDateIso).
 * NEVER falls back to obsReleaseDate or archive upload dates.
 */
export function chronologicalSortObservations(
  observations: SpherexObservation[]
): ChronologicalSortResult {
  const withTime: Array<{ obs: SpherexObservation; timeKey: number }> = [];
  const missingTimestamps: SpherexObservation[] = [];

  for (const obs of observations) {
    if (obs.tMinMjd !== null && Number.isFinite(obs.tMinMjd)) {
      withTime.push({ obs, timeKey: obs.tMinMjd });
    } else if (obs.obsDateIso) {
      const ms = Date.parse(obs.obsDateIso);
      if (Number.isFinite(ms)) {
        // Convert Unix ms back to MJD for uniform ordering
        withTime.push({ obs, timeKey: ms / 86400000 + 40587.0 });
      } else {
        missingTimestamps.push(obs);
      }
    } else {
      missingTimestamps.push(obs);
    }
  }

  withTime.sort((a, b) => a.timeKey - b.timeKey);
  return {
    sorted: withTime.map((entry) => entry.obs),
    missingTimestamps,
  };
}

export function formatElapsedDuration(totalDays: number | null): string {
  if (totalDays === null || !Number.isFinite(totalDays) || totalDays < 0) {
    return 'Elapsed span unavailable';
  }
  if (totalDays < 1 / 24) {
    const mins = Math.max(1, Math.round(totalDays * 24 * 60));
    return `${mins} min`;
  }
  if (totalDays < 2) {
    return `${(totalDays * 24).toFixed(1)} hours`;
  }
  if (totalDays < 60) {
    return `${totalDays.toFixed(1)} days`;
  }
  return `${totalDays.toFixed(1)} days (~${(totalDays / 30.4375).toFixed(1)} months)`;
}

export interface TimelapseSkippedObservation {
  observationId: string;
  obsId: string;
  reason: string;
}

export interface TimelapsePreparedFrame {
  frameIndex: number;
  observation: SpherexObservation;
  epochMeta: EpochAnalysisMetadata;
  /** Aligned to Reference Frame 0 WCS grid (Zodi + sky subtracted, MJy/sr, Float32 base64) */
  alignedFluxFloat32Base64: string;
  /** Quality bitmask aligned to Frame 0 (Uint8 base64: 0=clean, 1=soft, 2=artifact, 3=hard bad) */
  qualityMaskBase64: string;
  timeDeltaFromStartHours: number | null;
}

export interface TimelapsePairAnalysis {
  fromFrameIndex: number;
  toFrameIndex: number;
  fromObsId: string;
  toObsId: string;
  fromDateIso: string | null;
  toDateIso: string | null;
  summary: ComparisonPairSummary;
  changes: DetectedChangeRegion[];
  /** Aligned consecutive difference (Frame[i] - Frame[i-1], Float32 base64) */
  diffFloat32Base64: string;
  /** Propagated Z-score significance map (sigma, Float32 base64) */
  snrFloat32Base64: string;
  qualityMaskBase64: string;
}

export interface TimelapseScientificSummary {
  region: {
    ra: number;
    dec: number;
    radiusDeg: number;
    cutoutSizeDeg: number;
  };
  detector: DetectorSpec;
  totalMatchingArchiveRecords: number;
  selectedCount: number;
  preparedFrameCount: number;
  firstObservationDate: string | null;
  lastObservationDate: string | null;
  totalTimeSpanDays: number | null;
  totalTimeSpanLabel: string;
  spectralBands: string[];
  observationIds: string[];
  sharedNormalization: {
    vmin: number;
    vmax: number;
    stretch: 'asinh';
    bunit: string;
    method: string;
  };
  changeSummary: {
    totalDetectedEvents: number;
    brighteningEvents: number;
    dimmingEvents: number;
    newSources: number;
    disappearedSources: number;
    structuralShifts: number;
    probableArtifacts: number;
    genuineCandidates: number;
    uncertainEvents: number;
    headline: string;
  };
  qualityAndLimitations: string[];
  interpolationDisclaimer: string;
}

export interface TimelapsePreparationResult {
  timelapseId: string;
  createdAt: string;
  width: number;
  height: number;
  wcs: FitsWcsInfo | null;
  compatibility: ComparisonCompatibilityResult;
  frames: TimelapsePreparedFrame[];
  pairs: TimelapsePairAnalysis[];
  skippedCorrupted: TimelapseSkippedObservation[];
  dataQualityWarnings: string[];
  summary: TimelapseScientificSummary;
}

export interface TimelapseExportResult {
  exportId: string;
  timelapseId: string;
  videoUrl: string;
  downloadUrl: string;
  fileSizeBytes: number;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  hasAudio: boolean;
  frameCountRendered: number;
  verifiedOnDisk: boolean;
  createdAt: string;
}


