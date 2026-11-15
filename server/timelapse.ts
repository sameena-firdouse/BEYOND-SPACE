import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  SPHEREX_DETECTORS,
  chronologicalSortObservations,
  formatDecDms,
  formatElapsedDuration,
  formatRaHms,
  validateComparisonCompatibility,
  type ComparisonPairSummary,
  type DetectedChangeRegion,
  type FitsWcsInfo,
  type SpherexObservation,
  type TimelapseCustomSettings,
  type TimelapseExportResult,
  type TimelapsePairAnalysis,
  type TimelapsePreparationResult,
  type TimelapsePreparedFrame,
  type TimelapseSkippedObservation,
} from '../shared/astronomy.ts';
import {
  alignEpochToReference,
  analyzeAlignedPair,
  buildEpochQualityMask,
  detectChangeRegionsBetweenAligned,
  loadEpochForComparison,
  type AlignedEpochView,
  type LoadedEpoch,
} from './compare.ts';

const execFileAsync = promisify(execFile);

const TIMELAPSE_VIDEO_DIR = '/tmp/beyond-space-timelapse';
const MAX_VIDEO_CACHE_BYTES = 80 * 1024 * 1024; // 80 MB LRU cap
const MAX_PREPARED_JOBS = 8;
const MAX_FRAMES_PER_TIMELAPSE = 36;

if (!fs.existsSync(TIMELAPSE_VIDEO_DIR)) {
  fs.mkdirSync(TIMELAPSE_VIDEO_DIR, { recursive: true });
}

interface StoredFrameData {
  frameIndex: number;
  observation: SpherexObservation;
  flux: Float32Array;
  qualityMask: Uint8Array;
  dateIso: string | null;
  mjdObs: number | null;
}

interface StoredPairData {
  fromFrameIndex: number;
  toFrameIndex: number;
  diff: Float32Array;
  snr: Float32Array;
  changes: DetectedChangeRegion[];
  summary: ComparisonPairSummary;
}

interface PreparedTimelapseJob {
  timelapseId: string;
  createdAt: string;
  ra: number;
  dec: number;
  radiusDeg: number;
  cutoutSizeDeg: number;
  width: number;
  height: number;
  detectorId: string;
  bandpassSummary: string;
  vmin: number;
  vmax: number;
  diffScaleMax: number;
  frames: StoredFrameData[];
  pairs: StoredPairData[];
}

const preparedJobs = new Map<string, PreparedTimelapseJob>();
const exportedVideoFiles = new Map<string, { path: string; exportResult: TimelapseExportResult }>();

function storePreparedJob(job: PreparedTimelapseJob): void {
  if (preparedJobs.size >= MAX_PREPARED_JOBS) {
    const oldestKey = preparedJobs.keys().next().value;
    if (oldestKey) preparedJobs.delete(oldestKey);
  }
  preparedJobs.set(job.timelapseId, job);
}

function pruneVideoDirIfNeeded(): void {
  try {
    const files = fs
      .readdirSync(TIMELAPSE_VIDEO_DIR)
      .filter((n) => n.endsWith('.mp4'))
      .map((name) => {
        const full = path.join(TIMELAPSE_VIDEO_DIR, name);
        const st = fs.statSync(full);
        return { full, name, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);

    let total = files.reduce((s, f) => s + f.size, 0);
    for (const f of files) {
      if (total <= MAX_VIDEO_CACHE_BYTES) break;
      fs.unlinkSync(f.full);
      total -= f.size;
    }
  } catch {
    // Ignore cleanup errors
  }
}

export function getExportedVideoPath(exportId: string): { path: string; filename: string } | null {
  const safeId = exportId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return null;
  const cached = exportedVideoFiles.get(safeId);
  if (cached && fs.existsSync(cached.path)) {
    return {
      path: cached.path,
      filename: `beyond-space-timelapse-${safeId}.mp4`,
    };
  }
  const diskPath = path.join(TIMELAPSE_VIDEO_DIR, `${safeId}.mp4`);
  if (fs.existsSync(diskPath) && fs.statSync(diskPath).size > 0) {
    return {
      path: diskPath,
      filename: `beyond-space-timelapse-${safeId}.mp4`,
    };
  }
  return null;
}

export function hasPreparedTimelapseJob(timelapseId: string): boolean {
  return preparedJobs.has(timelapseId);
}

/** Compute shared robust [p1, p995] percentile window across all WCS-aligned frames (zero per-frame auto-gain). */
function computeSharedIntensityRange(frames: Float32Array[]): { vmin: number; vmax: number } {
  const samples: number[] = [];
  for (const buf of frames) {
    const step = buf.length > 8000 ? Math.ceil(buf.length / 4000) : 1;
    for (let i = 0; i < buf.length; i += step) {
      const v = buf[i];
      if (Number.isFinite(v)) {
        samples.push(v);
      }
    }
  }

  if (samples.length === 0) {
    return { vmin: -0.05, vmax: 1.0 };
  }

  samples.sort((a, b) => a - b);
  const q = (p: number) =>
    samples[Math.min(samples.length - 1, Math.max(0, Math.floor((samples.length - 1) * p)))];

  const vmin = q(0.01);
  let vmax = q(0.996);
  if (!Number.isFinite(vmax) || vmax <= vmin + 1e-6) {
    vmax = vmin + 0.5;
  }
  return { vmin, vmax };
}

export async function prepareCosmicTimelapse(options: {
  observations: SpherexObservation[];
  ra: number;
  dec: number;
  radiusDeg: number;
  sizeDeg?: number;
  subtractZodi?: boolean;
  totalMatchingArchiveRecords?: number;
  allowUnresolvedTimestamps?: boolean;
}): Promise<TimelapsePreparationResult> {
  const {
    observations,
    ra,
    dec,
    radiusDeg,
    totalMatchingArchiveRecords = observations.length,
    allowUnresolvedTimestamps = false,
  } = options;
  const sizeDeg = Math.min(Math.max(options.sizeDeg ?? 0.14, 0.08), 0.35);
  const subtractZodi = options.subtractZodi ?? true;

  // 1. Enforce strict single-detector, bandpass & spatial region compatibility
  const compatibility = validateComparisonCompatibility(observations, ra, dec);
  if (!compatibility.compatible || !compatibility.detector) {
    throw new Error(compatibility.reasons.join(' ') || 'Incompatible SPHEREx observations selected.');
  }

  const detectorSpec = SPHEREX_DETECTORS[compatibility.detector];
  const skippedCorrupted: TimelapseSkippedObservation[] = [];
  const dataQualityWarnings: string[] = [...compatibility.warnings];

  // 2. Enforce chronological ordering by actual archive timestamp (t_min MJD -> UTC ISO)
  let orderedObs: SpherexObservation[];
  if (!allowUnresolvedTimestamps) {
    const chrono = chronologicalSortObservations(observations);
    for (const missing of chrono.missingTimestamps) {
      skippedCorrupted.push({
        observationId: missing.id,
        obsId: missing.obsId,
        reason:
          'Missing archive observation timestamp (t_min MJD); excluded from automatic chronological playback unless explicitly ordered.',
      });
    }
    orderedObs = chrono.sorted;
  } else {
    orderedObs = [...observations];
  }

  if (orderedObs.length < 2) {
    throw new Error(
      'At least 2 observations with valid observation timestamps are required to generate a chronological time-lapse.'
    );
  }

  if (orderedObs.length > MAX_FRAMES_PER_TIMELAPSE) {
    dataQualityWarnings.push(
      `Selected ${orderedObs.length} observations; evenly sampled ${MAX_FRAMES_PER_TIMELAPSE} chronological exposures for responsive FITS alignment and MP4 rendering.`
    );
    const sampled: SpherexObservation[] = [];
    for (let i = 0; i < MAX_FRAMES_PER_TIMELAPSE; i++) {
      const idx = Math.min(
        orderedObs.length - 1,
        Math.round((i / (MAX_FRAMES_PER_TIMELAPSE - 1)) * (orderedObs.length - 1))
      );
      if (sampled.length === 0 || sampled[sampled.length - 1].id !== orderedObs[idx].id) {
        sampled.push(orderedObs[idx]);
      }
    }
    orderedObs = sampled;
  }

  // 3. Load & validate FITS cutouts cleanly (concurrency 2), handling corrupt/unreadable FITS gracefully
  const loadedValid: LoadedEpoch[] = [];
  for (let i = 0; i < orderedObs.length; i += 2) {
    const batch = orderedObs.slice(i, i + 2);
    const settled = await Promise.allSettled(
      batch.map((obs) => loadEpochForComparison(obs, ra, dec, sizeDeg, subtractZodi))
    );
    settled.forEach((res, idx) => {
      const obs = batch[idx];
      if (res.status === 'fulfilled') {
        const ep = res.value;
        if (ep.meta.validPixelFraction < 0.08) {
          skippedCorrupted.push({
            observationId: obs.id,
            obsId: obs.obsId,
            reason: `FITS cutout contains <8% valid unmasked detector pixels (${(ep.meta.validPixelFraction * 100).toFixed(1)}%).`,
          });
        } else {
          loadedValid.push(ep);
        }
      } else {
        skippedCorrupted.push({
          observationId: obs.id,
          obsId: obs.obsId,
          reason:
            res.reason instanceof Error
              ? res.reason.message
              : 'Failed to download or parse SPHEREx MEF FITS cutout.',
        });
      }
    });
  }

  if (loadedValid.length < 2) {
    const firstReason = skippedCorrupted[0]?.reason ? ` First error: ${skippedCorrupted[0].reason}` : '';
    throw new Error(
      `Only ${loadedValid.length} readable SPHEREx FITS frame(s) remained after validation (need >= 2).${firstReason}`
    );
  }

  // 4. Align all epochs onto Reference Frame 0 (oldest observation) TAN-SIP WCS grid
  const refEpoch = loadedValid[0];
  const width = refEpoch.width;
  const height = refEpoch.height;
  const wcs: FitsWcsInfo | null = refEpoch.wcsInfo;

  const alignedViews: AlignedEpochView[] = [
    {
      obs: refEpoch.obs,
      meta: refEpoch.meta,
      flux: refEpoch.cleanImage,
      variance: refEpoch.variance,
      flags: refEpoch.flags,
    },
  ];

  for (let i = 1; i < loadedValid.length; i++) {
    const ep = loadedValid[i];
    const aligned = alignEpochToReference(refEpoch, ep);
    const overlapFrac = width * height > 0 ? aligned.overlapCount / (width * height) : 0;
    if (overlapFrac < 0.05) {
      skippedCorrupted.push({
        observationId: ep.obs.id,
        obsId: ep.obs.obsId,
        reason: `Insufficient sky footprint overlap (${(overlapFrac * 100).toFixed(1)}%) with reference frame ${refEpoch.obs.obsId}.`,
      });
      continue;
    }
    alignedViews.push({
      obs: ep.obs,
      meta: ep.meta,
      flux: aligned.alignedFlux,
      variance: aligned.alignedVariance,
      flags: aligned.alignedFlags,
    });
  }

  if (alignedViews.length < 2) {
    throw new Error(
      'Fewer than 2 observations share overlapping sky coverage on the WCS reference grid.'
    );
  }

  // Quality warnings
  const missingWcsCount = loadedValid.filter((e) => !e.wcs).length;
  if (missingWcsCount > 0) {
    dataQualityWarnings.push(
      `WCS TAN-SIP headers missing on ${missingWcsCount} frame(s); pixel-grid fallback alignment used.`
    );
  }
  const missingVarCount = alignedViews.filter((v) => !v.meta.hasVariance).length;
  if (missingVarCount > 0) {
    dataQualityWarnings.push(
      `VARIANCE extension absent on ${missingVarCount} frame(s); sky MAD noise floor substituted for significance propagation.`
    );
  }

  // 5. Compute ONE shared global dynamic range across all prepared frames (no independent auto-stretch!)
  const { vmin, vmax } = computeSharedIntensityRange(alignedViews.map((v) => v.flux));

  // 6. Run Space Comparison consecutive-pair analysis across (frame[i-1] -> frame[i])
  const baselineMjd = alignedViews[0].meta.mjdObs;
  const pairAnalyses: TimelapsePairAnalysis[] = [];
  const storedPairs: StoredPairData[] = [];
  const allDiffMagnitudes: number[] = [];

  for (let i = 1; i < alignedViews.length; i++) {
    const prev = alignedViews[i - 1];
    const curr = alignedViews[i];
    const pair = analyzeAlignedPair(prev, curr, width, height);
    const changes = detectChangeRegionsBetweenAligned({
      baseline: prev,
      target: curr,
      pair,
      width,
      height,
      wcs: refEpoch.wcs,
      maxRegions: 24,
    });

    for (let k = 0; k < pair.diff.length; k += 4) {
      const dv = Math.abs(pair.diff[k]);
      if (Number.isFinite(dv)) allDiffMagnitudes.push(dv);
    }

    storedPairs.push({
      fromFrameIndex: i - 1,
      toFrameIndex: i,
      diff: pair.diff,
      snr: pair.snr,
      changes,
      summary: pair.summary,
    });

    pairAnalyses.push({
      fromFrameIndex: i - 1,
      toFrameIndex: i,
      fromObsId: prev.obs.obsId,
      toObsId: curr.obs.obsId,
      fromDateIso: prev.meta.obsDateIso,
      toDateIso: curr.meta.obsDateIso,
      summary: pair.summary,
      changes,
      diffFloat32Base64: Buffer.from(
        pair.diff.buffer,
        pair.diff.byteOffset,
        pair.diff.byteLength
      ).toString('base64'),
      snrFloat32Base64: Buffer.from(
        pair.snr.buffer,
        pair.snr.byteOffset,
        pair.snr.byteLength
      ).toString('base64'),
      qualityMaskBase64: Buffer.from(
        pair.qualityMask.buffer,
        pair.qualityMask.byteOffset,
        pair.qualityMask.byteLength
      ).toString('base64'),
    });
  }

  allDiffMagnitudes.sort((a, b) => a - b);
  const diffScaleMax =
    allDiffMagnitudes.length > 0
      ? Math.max(
          allDiffMagnitudes[Math.min(allDiffMagnitudes.length - 1, Math.floor(allDiffMagnitudes.length * 0.992))],
          0.02
        )
      : 0.1;

  // 7. Serialize aligned frames for UI canvas playback & store raw arrays for FFmpeg MP4 export
  const preparedFrames: TimelapsePreparedFrame[] = [];
  const storedFrames: StoredFrameData[] = [];

  for (let i = 0; i < alignedViews.length; i++) {
    const view = alignedViews[i];
    const qMask = buildEpochQualityMask(view.flux, view.flags);
    const mjdCurr = view.meta.mjdObs;
    const deltaHrs =
      baselineMjd !== null && mjdCurr !== null
        ? Number(((mjdCurr - baselineMjd) * 24).toFixed(2))
        : null;

    storedFrames.push({
      frameIndex: i,
      observation: view.obs,
      flux: view.flux,
      qualityMask: qMask,
      dateIso: view.meta.obsDateIso,
      mjdObs: view.meta.mjdObs,
    });

    preparedFrames.push({
      frameIndex: i,
      observation: view.obs,
      epochMeta: view.meta,
      alignedFluxFloat32Base64: Buffer.from(
        view.flux.buffer,
        view.flux.byteOffset,
        view.flux.byteLength
      ).toString('base64'),
      qualityMaskBase64: Buffer.from(
        qMask.buffer,
        qMask.byteOffset,
        qMask.byteLength
      ).toString('base64'),
      timeDeltaFromStartHours: deltaHrs,
    });
  }

  // 8. Summarize detected changes & scientific provenance
  let totalEvents = 0;
  let brighteningEvents = 0;
  let dimmingEvents = 0;
  let newSources = 0;
  let disappearedSources = 0;
  let structuralShifts = 0;
  let probableArtifacts = 0;
  let genuineCandidates = 0;
  let uncertainEvents = 0;

  for (const p of pairAnalyses) {
    for (const chg of p.changes) {
      totalEvents++;
      if (chg.polarity === 'brightening') brighteningEvents++;
      else if (chg.polarity === 'dimming') dimmingEvents++;
      else if (chg.polarity === 'new_source') newSources++;
      else if (chg.polarity === 'disappeared_source') disappearedSources++;
      else if (chg.polarity === 'structural_shift') structuralShifts++;

      if (chg.classification === 'Genuine Astronomical Change Candidate') {
        genuineCandidates++;
      } else if (
        chg.classification === 'Cosmic-Ray Contamination or Image Artifact' ||
        chg.classification === 'Bad Pixels or Detector Defect' ||
        chg.classification === 'Image Misalignment Residual' ||
        chg.classification === 'Processing or Data-Quality Error'
      ) {
        probableArtifacts++;
      } else {
        uncertainEvents++;
      }
    }
  }

  const firstMjd = alignedViews[0].meta.mjdObs;
  const lastMjd = alignedViews[alignedViews.length - 1].meta.mjdObs;
  const totalTimeSpanDays =
    firstMjd !== null && lastMjd !== null ? Number(Math.max(0, lastMjd - firstMjd).toFixed(4)) : null;

  const spectralBands = Array.from(new Set(alignedViews.map((v) => v.obs.bandpassName)));
  const timelapseId = `tl_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const createdAt = new Date().toISOString();

  storePreparedJob({
    timelapseId,
    createdAt,
    ra,
    dec,
    radiusDeg,
    cutoutSizeDeg: sizeDeg,
    width,
    height,
    detectorId: detectorSpec.id,
    bandpassSummary: `${detectorSpec.bandpassName} (${detectorSpec.wavelengthRangeLabel})`,
    vmin,
    vmax,
    diffScaleMax,
    frames: storedFrames,
    pairs: storedPairs,
  });

  const headline =
    totalEvents === 0
      ? `Stable sky field across ${alignedViews.length} ${detectorSpec.id} epochs with zero >= 3.8σ transient excursions.`
      : `Detected ${totalEvents} localized >= 3.8σ difference event(s) across ${pairAnalyses.length} consecutive epoch transition(s): ${genuineCandidates} genuine astronomical candidate(s), ${probableArtifacts} probable artifact/cosmic-ray/alignment event(s), and ${uncertainEvents} uncertain variation(s).`;

  return {
    timelapseId,
    createdAt,
    width,
    height,
    wcs,
    compatibility,
    frames: preparedFrames,
    pairs: pairAnalyses,
    skippedCorrupted,
    dataQualityWarnings,
    summary: {
      region: { ra, dec, radiusDeg, cutoutSizeDeg: sizeDeg },
      detector: detectorSpec,
      totalMatchingArchiveRecords,
      selectedCount: observations.length,
      preparedFrameCount: preparedFrames.length,
      firstObservationDate: alignedViews[0].meta.obsDateIso,
      lastObservationDate: alignedViews[alignedViews.length - 1].meta.obsDateIso,
      totalTimeSpanDays,
      totalTimeSpanLabel: formatElapsedDuration(totalTimeSpanDays),
      spectralBands,
      observationIds: alignedViews.map((v) => v.obs.obsId),
      sharedNormalization: {
        vmin: Number(vmin.toFixed(5)),
        vmax: Number(vmax.toFixed(5)),
        stretch: 'asinh',
        bunit: refEpoch.meta.bunit,
        method:
          'Single pooled 1st–99.6th percentile asinh stretch across all WCS-aligned frames (zero per-frame auto-gain).',
      },
      changeSummary: {
        totalDetectedEvents: totalEvents,
        brighteningEvents,
        dimmingEvents,
        newSources,
        disappearedSources,
        structuralShifts,
        probableArtifacts,
        genuineCandidates,
        uncertainEvents,
        headline,
      },
      qualityAndLimitations: [
        'Images are WCS TAN-SIP reprojected onto Frame 1 (oldest observation) using bilinear resampling at 6.15 arcsec/px SPHEREx native scale.',
        subtractZodi
          ? 'Zodiacal foreground emission (HDU ZODI) and 3σ-clipped sky background median were subtracted consistently prior to shared normalization.'
          : '3σ-clipped sky background median was subtracted while retaining zodiacal foreground intensity per user setting.',
        'Cosmetic hot/cold pixels and transient flags from HDU FLAGS are tracked per pixel; undersampled PSFs (6.15"/px) can produce mild residual dipoles on bright stars.',
        ...dataQualityWarnings,
      ],
      interpolationDisclaimer:
        'SCIENTIFIC NOTICE: Only labeled ACTUAL OBS frames correspond directly to real NASA SPHEREx satellite exposures at their listed UTC timestamps. Any crossfade, wipe, or intermediate transition frames rendered during animated playback are purely visual interpolations for temporal continuity and are NOT new satellite observations.',
    },
  };
}

// ============================================================================
// PURE-TS RGBA SCIENTIFIC FRAME RENDERER + CRISP 5x7 BITMAP HUD + FFMPEG MP4
// ============================================================================

const BITMAP_FONT_5X7: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '|': ['00100', '00100', '00100', '00100', '00100', '00100', '00100'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '00000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawBitmapText(
  rgba: Uint8Array,
  bufW: number,
  bufH: number,
  text: string,
  startX: number,
  startY: number,
  scale: number,
  color: [number, number, number]
): void {
  const upper = text.toUpperCase();
  let cursorX = Math.round(startX);
  const baseY = Math.round(startY);
  const advance = 6 * scale;

  for (let idx = 0; idx < upper.length; idx++) {
    const ch = upper[idx];
    const glyph = BITMAP_FONT_5X7[ch] ?? BITMAP_FONT_5X7[' '];
    for (let gy = 0; gy < 7; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < 5; gx++) {
        if (row[gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          const py = baseY + gy * scale + sy;
          if (py < 0 || py >= bufH) continue;
          for (let sx = 0; sx < scale; sx++) {
            const px = cursorX + gx * scale + sx;
            if (px < 0 || px >= bufW) continue;
            const o = (py * bufW + px) * 4;
            rgba[o] = color[0];
            rgba[o + 1] = color[1];
            rgba[o + 2] = color[2];
            rgba[o + 3] = 255;
          }
        }
      }
    }
    cursorX += advance;
    if (cursorX >= bufW - advance) break;
  }
}

function fillRect(
  rgba: Uint8Array,
  bufW: number,
  bufH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
  alpha = 1
): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(bufW, Math.ceil(x + w));
  const y1 = Math.min(bufH, Math.ceil(y + h));
  const invA = 1 - alpha;

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const o = (py * bufW + px) * 4;
      if (alpha >= 0.999) {
        rgba[o] = color[0];
        rgba[o + 1] = color[1];
        rgba[o + 2] = color[2];
        rgba[o + 3] = 255;
      } else {
        rgba[o] = Math.round(rgba[o] * invA + color[0] * alpha);
        rgba[o + 1] = Math.round(rgba[o + 1] * invA + color[1] * alpha);
        rgba[o + 2] = Math.round(rgba[o + 2] * invA + color[2] * alpha);
        rgba[o + 3] = 255;
      }
    }
  }
}

function strokeRect(
  rgba: Uint8Array,
  bufW: number,
  bufH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  thickness: number,
  color: [number, number, number]
): void {
  fillRect(rgba, bufW, bufH, x, y, w, thickness, color);
  fillRect(rgba, bufW, bufH, x, y + h - thickness, w, thickness, color);
  fillRect(rgba, bufW, bufH, x, y, thickness, h, color);
  fillRect(rgba, bufW, bufH, x + w - thickness, y, thickness, h, color);
}

function cyanThermalColor(val: number, vmin: number, vmax: number): [number, number, number] {
  if (!Number.isFinite(val)) return [7, 9, 14];
  const x = Math.min(1, Math.max(0, (val - vmin) / Math.max(vmax - vmin, 1e-9)));
  const a = 0.08;
  const c = Math.asinh(x / a) / Math.asinh(1 / a);
  if (c < 0.35) {
    const k = c / 0.35;
    return [Math.round(7 + k * 8), Math.round(9 + k * 45), Math.round(14 + k * 78)];
  }
  if (c < 0.72) {
    const k = (c - 0.35) / 0.37;
    return [Math.round(15 + k * 20), Math.round(54 + k * 158), Math.round(92 + k * 146)];
  }
  const k = (c - 0.72) / 0.28;
  return [Math.round(35 + k * 218), Math.round(212 + k * 42), Math.round(238 + k * 17)];
}

function bipolarDiffColor(diffVal: number, scaleMax: number): [number, number, number] {
  if (!Number.isFinite(diffVal)) return [7, 9, 14];
  const norm = Math.max(-1, Math.min(1, diffVal / Math.max(scaleMax, 1e-6)));
  const mag = Math.pow(Math.abs(norm), 0.72);
  if (norm >= 0) {
    // Black-slate -> Warm Amber -> Bright Rose/Gold (+delta brightness)
    return [
      Math.round(12 + mag * 238),
      Math.round(16 + mag * 155),
      Math.round(24 + mag * 40),
    ];
  }
  // Black-slate -> Deep Sapphire -> Electric Cyan (-delta dimming)
  return [
    Math.round(12 + mag * 24),
    Math.round(16 + mag * 135),
    Math.round(24 + mag * 225),
  ];
}

function renderVideoFrameRgba(
  job: PreparedTimelapseJob,
  settings: TimelapseCustomSettings,
  outW: number,
  outH: number,
  frameIdxA: number,
  frameIdxB: number,
  blendAlpha: number,
  isInterpolated: boolean
): Uint8Array {
  const rgba = new Uint8Array(outW * outH * 4);
  // Dark obsidian background (#07090E)
  for (let i = 0; i < outW * outH; i++) {
    const o = i * 4;
    rgba[o] = 7;
    rgba[o + 1] = 9;
    rgba[o + 2] = 14;
    rgba[o + 3] = 255;
  }

  const topHudH = 52;
  const bottomHudH = 56;
  const availW = outW - 24;
  const availH = outH - topHudH - bottomHudH - 16;

  const frameA = job.frames[frameIdxA];
  const frameB = job.frames[frameIdxB];
  const activePair =
    frameIdxA > 0 ? job.pairs[Math.min(job.pairs.length - 1, frameIdxA - 1)] : job.pairs[0];

  const drawScienceBox = (
    boxX: number,
    boxY: number,
    boxSize: number,
    pixelSampler: (fx: number, fy: number) => [number, number, number]
  ) => {
    strokeRect(rgba, outW, outH, boxX - 1, boxY - 1, boxSize + 2, boxSize + 2, 1, [30, 41, 59]);
    for (let py = 0; py < boxSize; py++) {
      // Standard astronomical FITS display: FITS y=0 at bottom, screen y=0 at top
      const fy = Math.min(job.height - 1, Math.floor(((boxSize - 1 - py) / boxSize) * job.height));
      for (let px = 0; px < boxSize; px++) {
        const fx = Math.min(job.width - 1, Math.floor((px / boxSize) * job.width));
        const [r, g, b] = pixelSampler(fx, fy);
        const o = ((boxY + py) * outW + (boxX + px)) * 4;
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = 255;
      }
    }
  };

  if (settings.visualizationMode === 'side_by_side_comparison') {
    const isPortrait = outH > outW;
    const gap = 14;
    const panelSize = isPortrait
      ? Math.floor(Math.min(availW, (availH - gap) / 2))
      : Math.floor(Math.min((availW - gap) / 2, availH));
    const startX = Math.floor((outW - (isPortrait ? panelSize : panelSize * 2 + gap)) / 2);
    const startY = topHudH + Math.floor((availH - (isPortrait ? panelSize * 2 + gap : panelSize)) / 2);

    const baseline = job.frames[0];
    drawScienceBox(startX, startY, panelSize, (fx, fy) =>
      cyanThermalColor(baseline.flux[fy * job.width + fx], job.vmin, job.vmax)
    );
    drawBitmapText(rgba, outW, outH, 'BASELINE OBS #1', startX + 8, startY + 8, 2, [34, 211, 238]);

    const secondX = isPortrait ? startX : startX + panelSize + gap;
    const secondY = isPortrait ? startY + panelSize + gap : startY;
    drawScienceBox(secondX, secondY, panelSize, (fx, fy) => {
      const idx = fy * job.width + fx;
      const v = isInterpolated
        ? (1 - blendAlpha) * frameA.flux[idx] + blendAlpha * frameB.flux[idx]
        : frameA.flux[idx];
      return cyanThermalColor(v, job.vmin, job.vmax);
    });
    drawBitmapText(
      rgba,
      outW,
      outH,
      `EPOCH #${frameA.frameIndex + 1}`,
      secondX + 8,
      secondY + 8,
      2,
      [52, 211, 153]
    );
  } else {
    const boxSize = Math.floor(Math.min(availW, availH));
    const boxX = Math.floor((outW - boxSize) / 2);
    const boxY = topHudH + Math.floor((availH - boxSize) / 2);
    const baseline = job.frames[0];
    const wipePx = Math.round(boxSize * (0.15 + 0.7 * (isInterpolated ? blendAlpha : 0.5)));

    drawScienceBox(boxX, boxY, boxSize, (fx, fy) => {
      const idx = fy * job.width + fx;
      const valA = frameA.flux[idx];
      const valB = frameB.flux[idx];

      switch (settings.visualizationMode) {
        case 'original_sequence':
        case 'source_appear_disappear': {
          return cyanThermalColor(valA, job.vmin, job.vmax);
        }
        case 'smooth_crossfade': {
          const blended = isInterpolated ? (1 - blendAlpha) * valA + blendAlpha * valB : valA;
          return cyanThermalColor(blended, job.vmin, job.vmax);
        }
        case 'before_after_transitions': {
          const sx = Math.floor((fx / job.width) * boxSize);
          return sx < wipePx
            ? cyanThermalColor(baseline.flux[idx], job.vmin, job.vmax)
            : cyanThermalColor(valA, job.vmin, job.vmax);
        }
        case 'animated_difference_map': {
          if (frameIdxA === 0 && !isInterpolated) {
            return cyanThermalColor(valA, job.vmin, job.vmax);
          }
          const dVal = activePair ? activePair.diff[idx] : 0;
          return bipolarDiffColor(dVal, job.diffScaleMax);
        }
        case 'brightness_change': {
          const baseCol = cyanThermalColor(valA, job.vmin, job.vmax);
          const muted: [number, number, number] = [
            Math.round(baseCol[0] * 0.45),
            Math.round(baseCol[1] * 0.45),
            Math.round(baseCol[2] * 0.45),
          ];
          if (!activePair) return muted;
          const z = activePair.snr[idx];
          if (Number.isFinite(z) && z >= 3.0) {
            const k = Math.min(1, (z - 3.0) / 4.0);
            return [Math.round(30 + k * 20), Math.round(210 + k * 45), Math.round(140 + k * 80)];
          }
          if (Number.isFinite(z) && z <= -3.0) {
            const k = Math.min(1, (-z - 3.0) / 4.0);
            return [Math.round(220 + k * 35), Math.round(90 + k * 40), Math.round(45 + k * 25)];
          }
          return muted;
        }
        default: {
          return cyanThermalColor(valA, job.vmin, job.vmax);
        }
      }
    });

    if (settings.visualizationMode === 'before_after_transitions') {
      fillRect(rgba, outW, outH, boxX + wipePx, boxY, 2, boxSize, [34, 211, 238]);
      drawBitmapText(rgba, outW, outH, 'OBS #1', boxX + 8, boxY + 8, 2, [34, 211, 238]);
      drawBitmapText(
        rgba,
        outW,
        outH,
        `OBS #${frameA.frameIndex + 1}`,
        boxX + boxSize - 76,
        boxY + 8,
        2,
        [52, 211, 153]
      );
    }

    // Draw scientific change overlays when annotations enabled (or source mode active)
    if ((settings.showAnnotations || settings.visualizationMode === 'source_appear_disappear') && activePair) {
      const topChanges = activePair.changes.slice(0, 8);
      for (const chg of topChanges) {
        const rx = boxX + Math.round((chg.bbox.xMin / job.width) * boxSize) - 4;
        const rw = Math.max(12, Math.round(((chg.bbox.xMax - chg.bbox.xMin + 1) / job.width) * boxSize) + 8);
        // Flip Y for screen space
        const ryTopFits = job.height - 1 - chg.bbox.yMax;
        const ry = boxY + Math.round((ryTopFits / job.height) * boxSize) - 4;
        const rh = Math.max(12, Math.round(((chg.bbox.yMax - chg.bbox.yMin + 1) / job.height) * boxSize) + 8);

        const isArtifact =
          chg.classification.includes('Artifact') ||
          chg.classification.includes('Defect') ||
          chg.classification.includes('Misalignment');
        const col: [number, number, number] = isArtifact
          ? [244, 63, 94]
          : chg.integratedSnr >= 0
            ? [52, 211, 153]
            : [251, 191, 36];

        strokeRect(rgba, outW, outH, rx, ry, rw, rh, 2, col);
        if (settings.showAnnotations) {
          drawBitmapText(rgba, outW, outH, chg.id, rx, Math.max(boxY + 2, ry - 10), 1, col);
        }
      }
    }
  }

  // TOP HUD BAR
  fillRect(rgba, outW, outH, 0, 0, outW, topHudH, [11, 14, 23]);
  fillRect(rgba, outW, outH, 0, topHudH - 1, outW, 1, [30, 41, 59]);

  const titleText = (settings.title || 'BEYOND SPACE COSMIC TIME-LAPSE').slice(0, 42);
  drawBitmapText(rgba, outW, outH, titleText, 12, 10, 2, [241, 245, 249]);

  const subParts: string[] = [];
  if (settings.showDetectorInfo) subParts.push(job.bandpassSummary);
  if (settings.showCoordinates) subParts.push(`RA ${job.ra.toFixed(3)} DEC ${job.dec.toFixed(3)}`);
  if (subParts.length > 0) {
    drawBitmapText(rgba, outW, outH, subParts.join(' | '), 12, 30, 1, [56, 189, 248]);
  }

  // Frame authenticity tag (right aligned on top bar)
  if (isInterpolated) {
    drawBitmapText(rgba, outW, outH, 'VISUAL INTERPOLATION', outW - 150, 12, 1, [251, 191, 36]);
    drawBitmapText(rgba, outW, outH, 'NOT SATELLITE DATA', outW - 150, 24, 1, [251, 191, 36]);
  } else {
    drawBitmapText(
      rgba,
      outW,
      outH,
      `ACTUAL OBS ${frameA.frameIndex + 1}/${job.frames.length}`,
      outW - 150,
      16,
      1,
      [34, 211, 238]
    );
  }

  // BOTTOM TELEMETRY BAR
  fillRect(rgba, outW, outH, 0, outH - bottomHudH, outW, bottomHudH, [11, 14, 23]);
  fillRect(rgba, outW, outH, 0, outH - bottomHudH, outW, 1, [30, 41, 59]);

  if (settings.showDates) {
    const tsLabel = frameA.dateIso
      ? `UTC: ${frameA.dateIso.replace('T', ' ').slice(0, 19)}Z`
      : 'UTC TIMESTAMP UNAVAILABLE';
    drawBitmapText(rgba, outW, outH, tsLabel, 12, outH - bottomHudH + 10, 2, [34, 211, 238]);
  }
  drawBitmapText(
    rgba,
    outW,
    outH,
    `OBS ID: ${frameA.observation.obsId}`,
    12,
    outH - bottomHudH + 34,
    1,
    [148, 163, 184]
  );

  // Timeline progress track
  const trackX = 12;
  const trackY = outH - 8;
  const trackW = outW - 24;
  fillRect(rgba, outW, outH, trackX, trackY, trackW, 3, [30, 41, 59]);
  const progressFrac =
    job.frames.length > 1
      ? Math.min(1, Math.max(0, (frameIdxA + (isInterpolated ? blendAlpha : 0)) / (job.frames.length - 1)))
      : 1;
  fillRect(
    rgba,
    outW,
    outH,
    trackX,
    trackY,
    Math.max(4, Math.round(trackW * progressFrac)),
    3,
    isInterpolated ? [251, 191, 36] : [6, 182, 212]
  );

  return rgba;
}

export async function exportTimelapseMp4(
  timelapseId: string,
  rawSettings: Partial<TimelapseCustomSettings>
): Promise<TimelapseExportResult> {
  const job = preparedJobs.get(timelapseId);
  if (!job) {
    throw new Error(
      `Prepared time-lapse session '${timelapseId}' was not found or expired. Click Generate Video again.`
    );
  }

  const settings: TimelapseCustomSettings = {
    title: rawSettings.title || `SPHEREx ${job.detectorId} Time-Lapse`,
    visualizationMode: rawSettings.visualizationMode || 'smooth_crossfade',
    aspectRatio: rawSettings.aspectRatio || '16:9',
    fps: Math.min(24, Math.max(1, Math.round(Number(rawSettings.fps) || 12))),
    frameDurationSec: Math.min(5, Math.max(0.4, Number(rawSettings.frameDurationSec) || 1.2)),
    transitionDurationSec: Math.min(
      2.5,
      Math.max(0, Number(rawSettings.transitionDurationSec ?? 0.6))
    ),
    playbackSpeed: Math.min(4, Math.max(0.25, Number(rawSettings.playbackSpeed) || 1.0)),
    showDates: rawSettings.showDates !== false,
    showCoordinates: rawSettings.showCoordinates !== false,
    showDetectorInfo: rawSettings.showDetectorInfo !== false,
    showAnnotations: rawSettings.showAnnotations !== false,
    includeAmbientAudio: rawSettings.includeAmbientAudio === true,
  };

  const dims =
    settings.aspectRatio === '9:16'
      ? { width: 540, height: 960 }
      : settings.aspectRatio === '1:1'
        ? { width: 640, height: 640 }
        : { width: 960, height: 540 };

  const fps = settings.fps;
  const effHoldSec = settings.frameDurationSec / settings.playbackSpeed;
  const effTransSec =
    settings.visualizationMode === 'original_sequence'
      ? 0
      : settings.transitionDurationSec / settings.playbackSpeed;

  const holdFrames = Math.max(2, Math.round(effHoldSec * fps));
  const transFrames = effTransSec > 0.05 ? Math.max(2, Math.round(effTransSec * fps)) : 0;

  const timelineSteps: Array<{
    idxA: number;
    idxB: number;
    alpha: number;
    isInterpolated: boolean;
  }> = [];

  for (let i = 0; i < job.frames.length; i++) {
    for (let h = 0; h < holdFrames; h++) {
      timelineSteps.push({ idxA: i, idxB: i, alpha: 0, isInterpolated: false });
    }
    if (i < job.frames.length - 1 && transFrames > 0) {
      for (let t = 1; t <= transFrames; t++) {
        timelineSteps.push({
          idxA: i,
          idxB: i + 1,
          alpha: t / (transFrames + 1),
          isInterpolated: true,
        });
      }
    }
  }

  const exportId = `mp4_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const mp4Path = path.join(TIMELAPSE_VIDEO_DIR, `${exportId}.mp4`);

  const ffmpegArgs: string[] = [
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${dims.width}x${dims.height}`,
    '-r',
    String(fps),
    '-i',
    'pipe:0',
  ];

  if (settings.includeAmbientAudio) {
    ffmpegArgs.push(
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=110:sample_rate=44100',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=164.81:sample_rate=44100',
      '-filter_complex',
      '[1:a][2:a]amix=inputs=2:duration=shortest,volume=0.04,afade=t=in:st=0:d=0.5',
      '-c:a',
      'aac',
      '-b:a',
      '96k'
    );
  }

  ffmpegArgs.push(
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-movflags',
    '+faststart',
    '-shortest',
    mp4Path
  );

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('/usr/bin/ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      reject(new Error(`Failed to execute local FFmpeg binary: ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-400)}`));
      }
    });

    (async () => {
      try {
        for (const step of timelineSteps) {
          const buf = renderVideoFrameRgba(
            job,
            settings,
            dims.width,
            dims.height,
            step.idxA,
            step.idxB,
            step.alpha,
            step.isInterpolated
          );
          if (!proc.stdin.write(buf)) {
            await new Promise<void>((r) => proc.stdin.once('drain', r));
          }
        }
        proc.stdin.end();
      } catch (err) {
        proc.kill('SIGTERM');
        reject(err);
      }
    })();
  });

  if (!fs.existsSync(mp4Path)) {
    throw new Error('FFmpeg completed but output MP4 file was not created on disk.');
  }

  const stat = fs.statSync(mp4Path);
  if (stat.size < 1024) {
    throw new Error(`Generated MP4 file on disk is empty or corrupted (${stat.size} bytes).`);
  }

  // Double-check container integrity using ffprobe
  let actualDurationSec = Number((timelineSteps.length / fps).toFixed(2));
  try {
    const { stdout } = await execFileAsync('/usr/bin/ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      mp4Path,
    ]);
    const parsedDur = Number(stdout.trim());
    if (Number.isFinite(parsedDur) && parsedDur > 0) {
      actualDurationSec = Number(parsedDur.toFixed(2));
    }
  } catch {
    throw new Error('ffprobe failed to verify generated MP4 video stream integrity.');
  }

  pruneVideoDirIfNeeded();

  const exportResult: TimelapseExportResult = {
    exportId,
    timelapseId,
    videoUrl: `/api/timelapse/video/${exportId}`,
    downloadUrl: `/api/timelapse/video/${exportId}?download=1`,
    fileSizeBytes: stat.size,
    durationSec: actualDurationSec,
    fps,
    width: dims.width,
    height: dims.height,
    codec: 'H.264 / yuv420p (MP4)',
    hasAudio: settings.includeAmbientAudio,
    frameCountRendered: timelineSteps.length,
    verifiedOnDisk: true,
    createdAt: new Date().toISOString(),
  };

  exportedVideoFiles.set(exportId, { path: mp4Path, exportResult });
  return exportResult;
}

export function formatTimelapseCoordSummary(ra: number, dec: number): string {
  return `${formatRaHms(ra)} · ${formatDecDms(dec)}`;
}
