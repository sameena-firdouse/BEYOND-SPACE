import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Layers,
  RotateCcw,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ComparisonClassification,
  DetectedChangeRegion,
  SpaceComparisonResult,
} from '../../shared/astronomy';

type CompareViewMode = 'side_by_side' | 'overlay' | 'difference' | 'snr' | 'quality';
type StretchMode = 'asinh' | 'linear' | 'log';

interface ComparisonDashboardProps {
  result: SpaceComparisonResult;
  onNewComparison?: () => void;
}

function decodeFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function decodeUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function computeRobustRange(arr: Float32Array): { min: number; max: number } {
  const valid: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) valid.push(arr[i]);
  }
  if (valid.length === 0) return { min: 0, max: 1 };
  valid.sort((a, b) => a - b);
  const lo = valid[Math.floor((valid.length - 1) * 0.01)];
  const hi = valid[Math.floor((valid.length - 1) * 0.992)];
  return { min: lo, max: hi > lo ? hi : lo + 1 };
}

function stretchVal(norm: number, mode: StretchMode): number {
  const x = Math.min(1, Math.max(0, norm));
  if (mode === 'linear') return x;
  if (mode === 'log') return Math.log10(1 + 99 * x) / 2;
  const a = 0.08;
  return Math.asinh(x / a) / Math.asinh(1 / a);
}

function cyanThermalRgb(t: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, t));
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

/** Diverging colormap: Amber (dimming < 0) -> Obsidian (0) -> Cyan (brightening > 0) */
function divergingRgb(signedNorm: number): [number, number, number] {
  const s = Math.max(-1, Math.min(1, signedNorm));
  const mag = Math.pow(Math.abs(s), 0.75);
  if (s >= 0) {
    return [
      Math.round(10 + mag * 24),
      Math.round(14 + mag * 210),
      Math.round(24 + mag * 226),
    ];
  }
  return [
    Math.round(10 + mag * 238),
    Math.round(14 + mag * 144),
    Math.round(24 + mag * 10),
  ];
}

function classificationTone(cls: ComparisonClassification): string {
  if (cls === 'Genuine Astronomical Change Candidate') return 'text-emerald-300';
  if (
    cls === 'Cosmic-Ray Contamination or Image Artifact' ||
    cls === 'Bad Pixels or Detector Defect' ||
    cls === 'Processing or Data-Quality Error'
  ) {
    return 'text-rose-300';
  }
  if (cls === 'Image Misalignment Residual' || cls === 'Background or Calibration Difference') {
    return 'text-amber-300';
  }
  return 'text-violet-300';
}

function classificationStroke(cls: ComparisonClassification): string {
  if (cls === 'Genuine Astronomical Change Candidate') return '#34D399';
  if (
    cls === 'Cosmic-Ray Contamination or Image Artifact' ||
    cls === 'Bad Pixels or Detector Defect' ||
    cls === 'Processing or Data-Quality Error'
  ) {
    return '#FB7185';
  }
  if (cls === 'Image Misalignment Residual' || cls === 'Background or Calibration Difference') {
    return '#FBBF24';
  }
  return '#A78BFA';
}

function buildMarkdownReport(result: SpaceComparisonResult): string {
  const r = result.report;
  const lines: string[] = [
    '# BEYOND SPACE — COSMIC CHANGE DETECTOR COMPARISON REPORT',
    `Generated: ${r.generatedAt}`,
    '',
    '## 1. Region Analyzed',
    `- Sky Coordinates (ICRS/J2000): RA ${r.regionAnalyzed.ra.toFixed(6)}°, DEC ${r.regionAnalyzed.dec.toFixed(6)}°`,
    `- Cutout Field Size: ${r.regionAnalyzed.cutoutSizeDeg}° × ${r.regionAnalyzed.cutoutSizeDeg}° (${result.width} × ${result.height} px)`,
    '',
    '## 2. Detector Used',
    `- ${r.detectorUsed.label} (${r.detectorUsed.bandpassName})`,
    `- Spectral Range: ${r.detectorUsed.wavelengthRangeLabel} (${r.detectorUsed.focalPlane}, ${r.detectorUsed.spectralResolvingPower})`,
    '',
    '## 3. Number of Images Compared',
    `- ${r.numberOfImagesCompared} SPHEREx exposures`,
    '',
    '## 4. Observation Dates (Actual UTC Exposure Timestamps)',
    ...result.epochs.map(
      (e, i) => `- Epoch ${i + 1}: ${e.obsId} | ${e.obsDateIso || 'N/A'} | Release: ${e.dataRelease} | Pipeline: ${e.pipelineVersionHeader}`
    ),
    '',
    '## 5. Time Elapsed Between Observations',
    `- ${r.timeElapsedSummary}`,
    '',
    '## 6. Total Number of Detected Differences',
    `- ${r.totalDetectedDifferences} candidate change region(s) detected above |Z| >= 3.8σ`,
    '',
    '## 7. Brightness Changes',
    `- ${r.brightnessChangesSummary}`,
    '',
    '## 8. Newly Detected or Missing Sources',
    `- ${r.newOrMissingSourcesSummary}`,
    '',
    '## 9. Possible Positional & Structural Changes',
    `- ${r.positionalChangesSummary}`,
    '',
    '## 10. Genuine Astronomical Signal Assessment',
    `- ${r.genuineSignalAssessment}`,
    '',
    '## 11. Potential Satellite / Instrument Error Assessment',
    `- ${r.satelliteErrorAssessment}`,
    '',
    '## 12. Confidence and Uncertainty',
    `- ${r.confidenceAndUncertaintySummary}`,
    '',
    '### Detected Regions Detail',
    ...result.detectedChanges.map(
      (c) =>
        `- **${c.id}** (${c.classification}) | RA ${c.centroidRa ?? 'N/A'}, DEC ${c.centroidDec ?? 'N/A'} | ΔFlux ${c.deltaFluxIntegrated.toFixed(4)} ± ${c.uncertaintyIntegrated.toFixed(4)} MJy/sr (${c.percentChange !== null ? `${c.percentChange}%` : 'N/A'}) | Peak Z=${c.maxZScore}σ | Genuine Conf: ${c.genuineConfidencePct ?? 'Insufficient'}% | Artifact Conf: ${c.artifactConfidencePct ?? 'Insufficient'}% | Flags: ${c.activeFlags.join(', ') || 'None'}`
    ),
    '',
    '## 13. Technical Methodology Used',
    ...r.technicalMethodology.map((m) => `- ${m}`),
    '',
    '## 14. Limitations and Recommendations for Verification',
    ...r.limitationsAndRecommendations.map((l) => `- ${l}`),
  ];
  return lines.join('\n');
}

export function ComparisonDashboard({ result, onNewComparison }: ComparisonDashboardProps) {
  const [viewMode, setViewMode] = useState<CompareViewMode>('side_by_side');
  const [stretch, setStretch] = useState<StretchMode>('asinh');
  const [overlayBlend, setOverlayBlend] = useState<number>(50);
  const [showDetections, setShowDetections] = useState<boolean>(true);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(
    result.detectedChanges[0]?.id ?? null
  );

  // Synchronized pan & zoom
  const [zoom, setZoom] = useState<number>(3);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [probe, setProbe] = useState<{
    fitsX: number;
    fitsY: number;
    fluxA: number;
    fluxB: number;
    diff: number;
    snr: number;
    mask: number;
    ra: number | null;
    dec: number | null;
  } | null>(null);

  const viewportSingleRef = useRef<HTMLDivElement | null>(null);
  const canvasSingleRef = useRef<HTMLCanvasElement | null>(null);
  const viewportLeftRef = useRef<HTMLDivElement | null>(null);
  const canvasLeftRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRightRef = useRef<HTMLCanvasElement | null>(null);

  // Decoded Float32 buffers
  const arrays = useMemo(() => {
    const ref = decodeFloat32(result.refFloat32Base64);
    const tgt = decodeFloat32(result.targetAlignedFloat32Base64);
    const diff = decodeFloat32(result.diffFloat32Base64);
    const snr = decodeFloat32(result.snrFloat32Base64);
    const mask = decodeUint8(result.qualityMaskBase64);

    const refRange = computeRobustRange(ref);
    const tgtRange = computeRobustRange(tgt);
    const sharedMin = Math.min(refRange.min, tgtRange.min);
    const sharedMax = Math.max(refRange.max, tgtRange.max);

    let maxAbsDiff = 0.01;
    for (let i = 0; i < diff.length; i++) {
      if (Number.isFinite(diff[i]) && Math.abs(diff[i]) > maxAbsDiff) {
        maxAbsDiff = Math.abs(diff[i]);
      }
    }
    const diffClip = Math.min(maxAbsDiff, Math.max(0.02, (sharedMax - sharedMin) * 0.6));

    return { ref, tgt, diff, snr, mask, sharedMin, sharedMax, diffClip };
  }, [result]);

  // Build offscreen canvases for Ref, Target, Overlay, Difference, SNR, Quality Mask
  const offscreens = useMemo(() => {
    const { width, height } = result;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      return c;
    };

    const cRef = mk();
    const cTgt = mk();
    const cOverlay = mk();
    const cDiff = mk();
    const cSnr = mk();
    const cMask = mk();

    const ctxRef = cRef.getContext('2d')!;
    const ctxTgt = cTgt.getContext('2d')!;
    const ctxOv = cOverlay.getContext('2d')!;
    const ctxDiff = cDiff.getContext('2d')!;
    const ctxSnr = cSnr.getContext('2d')!;
    const ctxMask = cMask.getContext('2d')!;

    const imRef = ctxRef.createImageData(width, height);
    const imTgt = ctxTgt.createImageData(width, height);
    const imOv = ctxOv.createImageData(width, height);
    const imDiff = ctxDiff.createImageData(width, height);
    const imSnr = ctxSnr.createImageData(width, height);
    const imMask = ctxMask.createImageData(width, height);

    const range = arrays.sharedMax - arrays.sharedMin || 1;
    const blend = overlayBlend / 100;

    for (let fy = 0; fy < height; fy++) {
      const cy = height - 1 - fy;
      for (let fx = 0; fx < width; fx++) {
        const i = fy * width + fx;
        const pIdx = (cy * width + fx) * 4;

        const vA = arrays.ref[i];
        const vB = arrays.tgt[i];
        const vD = arrays.diff[i];
        const vZ = arrays.snr[i];
        const qm = arrays.mask[i];

        // Ref & Target
        const [rA, gA, bA] = Number.isFinite(vA)
          ? cyanThermalRgb(stretchVal((vA - arrays.sharedMin) / range, stretch))
          : [7, 9, 14];
        const [rB, gB, bB] = Number.isFinite(vB)
          ? cyanThermalRgb(stretchVal((vB - arrays.sharedMin) / range, stretch))
          : [7, 9, 14];

        imRef.data[pIdx] = rA;
        imRef.data[pIdx + 1] = gA;
        imRef.data[pIdx + 2] = bA;
        imRef.data[pIdx + 3] = 255;

        imTgt.data[pIdx] = rB;
        imTgt.data[pIdx + 1] = gB;
        imTgt.data[pIdx + 2] = bB;
        imTgt.data[pIdx + 3] = 255;

        // Overlay (Ref in Amber/Blue, Target blended by slider)
        imOv.data[pIdx] = Math.round(rA * (1 - blend) + rB * blend);
        imOv.data[pIdx + 1] = Math.round(gA * (1 - blend) + gB * blend);
        imOv.data[pIdx + 2] = Math.round(bA * (1 - blend) + bB * blend);
        imOv.data[pIdx + 3] = 255;

        // Difference map
        const [rD, gD, bD] = Number.isFinite(vD)
          ? divergingRgb(vD / arrays.diffClip)
          : [18, 22, 32];
        imDiff.data[pIdx] = rD;
        imDiff.data[pIdx + 1] = gD;
        imDiff.data[pIdx + 2] = bD;
        imDiff.data[pIdx + 3] = 255;

        // Z-score significance map (-8 to +8 sigma)
        const [rZ, gZ, bZ] = Number.isFinite(vZ) ? divergingRgb(vZ / 8.0) : [18, 22, 32];
        imSnr.data[pIdx] = rZ;
        imSnr.data[pIdx + 1] = gZ;
        imSnr.data[pIdx + 2] = bZ;
        imSnr.data[pIdx + 3] = 255;

        // Quality Mask
        let mr = 15;
        let mg = 23;
        let mb = 42;
        if (qm === 0) {
          mr = 16;
          mg = 64;
          mb = 52; // Clean green-slate
        } else if (qm === 1) {
          mr = 217;
          mg = 119;
          mb = 6; // Soft flag amber
        } else if (qm === 2) {
          mr = 225;
          mg = 29;
          mb = 72; // Artifact flag rose
        } else {
          mr = 51;
          mg = 65;
          mb = 85; // Hard-masked / missing
        }
        imMask.data[pIdx] = mr;
        imMask.data[pIdx + 1] = mg;
        imMask.data[pIdx + 2] = mb;
        imMask.data[pIdx + 3] = 255;
      }
    }

    ctxRef.putImageData(imRef, 0, 0);
    ctxTgt.putImageData(imTgt, 0, 0);
    ctxOv.putImageData(imOv, 0, 0);
    ctxDiff.putImageData(imDiff, 0, 0);
    ctxSnr.putImageData(imSnr, 0, 0);
    ctxMask.putImageData(imMask, 0, 0);

    return { cRef, cTgt, cOverlay, cDiff, cSnr, cMask };
  }, [result, arrays, stretch, overlayBlend]);

  const fitView = useCallback(() => {
    const container =
      viewMode === 'side_by_side' ? viewportLeftRef.current : viewportSingleRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pad = 32;
    const sx = (rect.width - pad) / result.width;
    const sy = (rect.height - pad) / result.height;
    setZoom(Math.max(1, Math.min(sx, sy)));
    setPan({ x: 0, y: 0 });
  }, [viewMode, result.width, result.height]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  const paintCanvas = useCallback(
    (
      canvas: HTMLCanvasElement | null,
      source: HTMLCanvasElement,
      drawProbeCrosshair: boolean
    ) => {
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (
        canvas.width !== Math.round(rect.width * dpr) ||
        canvas.height !== Math.round(rect.height * dpr)
      ) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05070B';
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.imageSmoothingEnabled = zoom < 1.25;

      const drawW = result.width * zoom;
      const drawH = result.height * zoom;
      const dx = rect.width / 2 - drawW / 2 + pan.x;
      const dy = rect.height / 2 - drawH / 2 + pan.y;

      ctx.drawImage(source, dx, dy, drawW, drawH);

      if (showDetections) {
        for (const chg of result.detectedChanges) {
          const isSelected = chg.id === selectedChangeId;
          const x1 = dx + chg.bbox.xMin * zoom;
          const x2 = dx + (chg.bbox.xMax + 1) * zoom;
          const y1 = dy + (result.height - 1 - chg.bbox.yMax) * zoom;
          const y2 = dy + (result.height - chg.bbox.yMin) * zoom;

          ctx.strokeStyle = classificationStroke(chg.classification);
          ctx.lineWidth = isSelected ? 2 : 1.2;
          ctx.strokeRect(x1 - 2, y1 - 2, x2 - x1 + 4, y2 - y1 + 4);

          if (isSelected) {
            ctx.fillStyle = classificationStroke(chg.classification);
            ctx.font = '600 10px "JetBrains Mono", monospace';
            ctx.fillText(chg.id, x1 - 2, Math.max(12, y1 - 5));
          }
        }
      }

      if (drawProbeCrosshair && probe) {
        const px = dx + (probe.fitsX - 0.5) * zoom;
        const py = dy + (result.height - probe.fitsY + 0.5) * zoom;
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px - 10, py);
        ctx.lineTo(px + 10, py);
        ctx.moveTo(px, py - 10);
        ctx.lineTo(px, py + 10);
        ctx.stroke();
      }
    },
    [zoom, pan, result, showDetections, selectedChangeId, probe]
  );

  useEffect(() => {
    if (viewMode === 'side_by_side') {
      paintCanvas(canvasLeftRef.current, offscreens.cRef, true);
      paintCanvas(canvasRightRef.current, offscreens.cTgt, true);
    } else {
      const map =
        viewMode === 'overlay'
          ? offscreens.cOverlay
          : viewMode === 'difference'
            ? offscreens.cDiff
            : viewMode === 'snr'
              ? offscreens.cSnr
              : offscreens.cMask;
      paintCanvas(canvasSingleRef.current, map, true);
    }
  }, [viewMode, offscreens, paintCanvas]);

  const handleMouseMoveOnCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && dragRef.current) {
      setPan({
        x: dragRef.current.px + (e.clientX - dragRef.current.x),
        y: dragRef.current.py + (e.clientY - dragRef.current.y),
      });
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const drawW = result.width * zoom;
    const drawH = result.height * zoom;
    const ox = rect.width / 2 - drawW / 2 + pan.x;
    const oy = rect.height / 2 - drawH / 2 + pan.y;

    const fx = Math.floor((e.clientX - rect.left - ox) / zoom);
    const cy = Math.floor((e.clientY - rect.top - oy) / zoom);
    const fy = result.height - 1 - cy;

    if (fx < 0 || fx >= result.width || fy < 0 || fy >= result.height) {
      setProbe(null);
      return;
    }

    const idx = fy * result.width + fx;
    let ra: number | null = null;
    let dec: number | null = null;
    if (result.wcs) {
      const { crval1, crval2, crpix1, crpix2, cd1_1, cd1_2, cd2_1, cd2_2 } = result.wcs;
      const u = fx + 1 - crpix1;
      const v = fy + 1 - crpix2;
      const cosDec = Math.cos((crval2 * Math.PI) / 180) || 1;
      ra = (((crval1 + (cd1_1 * u + cd1_2 * v) / cosDec) % 360) + 360) % 360;
      dec = Math.max(-90, Math.min(90, crval2 + (cd2_1 * u + cd2_2 * v)));
    }

    setProbe({
      fitsX: fx + 1,
      fitsY: fy + 1,
      fluxA: arrays.ref[idx],
      fluxB: arrays.tgt[idx],
      diff: arrays.diff[idx],
      snr: arrays.snr[idx],
      mask: arrays.mask[idx],
      ra,
      dec,
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    setZoom((z) => Math.max(0.5, Math.min(24, z * factor)));
  };

  const downloadCanvasPng = (canvas: HTMLCanvasElement, filename: string) => {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const downloadTextFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedChange: DetectedChangeRegion | null =
    result.detectedChanges.find((c) => c.id === selectedChangeId) || null;

  const refEpoch = result.epochs[0];
  const latestEpoch = result.epochs[result.epochs.length - 1];

  return (
    <div className="space-y-6">
      {/* KPI SUMMARY STRIP */}
      <div className="rounded-lg border border-slate-800 bg-[#0B0E17] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
              Cosmic Change Detector · Comparison Results Dashboard
            </p>
            <h2 className="mt-1 font-display text-xl font-bold text-white">
              {result.report.detectorUsed.label} ({result.report.detectorUsed.wavelengthRangeLabel})
              at RA {result.report.regionAnalyzed.ra.toFixed(4)}°, DEC{' '}
              {result.report.regionAnalyzed.dec.toFixed(4)}°
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                downloadCanvasPng(
                  offscreens.cDiff,
                  `spherex_diff_${result.report.detectorUsed.id}_${result.primaryPair.refObsId}_vs_${result.primaryPair.targetObsId}.png`
                )
              }
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#07090E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/60 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
              Difference Map PNG
            </button>
            <button
              type="button"
              onClick={() =>
                downloadCanvasPng(
                  offscreens.cSnr,
                  `spherex_snr_heatmap_${result.report.detectorUsed.id}.png`
                )
              }
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#07090E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/60 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
              Heatmap PNG
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  buildMarkdownReport(result),
                  `spherex_comparison_report_${result.report.detectorUsed.id}.md`,
                  'text/markdown'
                )
              }
              className="inline-flex items-center gap-1.5 rounded bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              Download Report (.md)
            </button>
            {onNewComparison && (
              <button
                type="button"
                onClick={onNewComparison}
                className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                Adjust Selection
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Images Compared
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
              {result.epochs.length}
            </div>
            <div className="text-[11px] text-slate-400">
              {result.width}×{result.height} px aligned
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Time Elapsed
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
              {result.primaryPair.timeDeltaDays !== null
                ? `${result.primaryPair.timeDeltaDays.toFixed(1)} d`
                : 'N/A'}
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums">
              {result.primaryPair.timeDeltaHours !== null
                ? `${result.primaryPair.timeDeltaHours.toFixed(1)} hrs`
                : 'Interval unknown'}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Detected Regions
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-cyan-400 tabular-nums">
              {result.detectedChanges.length}
            </div>
            <div className="text-[11px] text-slate-400">Threshold |Z| ≥ 3.8σ</div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Peak Brightening / Dimming
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-emerald-300 tabular-nums">
              +{result.primaryPair.maxIncreaseMjySr.toFixed(3)} MJy/sr
            </div>
            <div className="font-mono text-xs text-amber-300 tabular-nums">
              {result.primaryPair.maxDecreaseMjySr.toFixed(3)} MJy/sr
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              WCS Alignment Offset
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
              {result.primaryPair.wcsResidualShiftArcsec}&quot;
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums">
              {result.primaryPair.wcsResidualShiftPx.magnitude} px residual
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Valid Overlap
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
              {(result.primaryPair.overlapFraction * 100).toFixed(0)}%
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums">
              {result.primaryPair.overlapPixelCount} pixels
            </div>
          </div>
        </div>

        {result.dataQualityWarnings.length > 0 && (
          <div className="mt-4 rounded border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
            <div className="flex items-center gap-1.5 font-semibold text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              Data-Quality &amp; Calibration Notices
            </div>
            <ul className="mt-1.5 list-disc pl-5 space-y-1">
              {result.dataQualityWarnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* SYNCHRONIZED MULTI-MODE VIEWER */}
      <div className="rounded-lg border border-slate-800 bg-[#0B0E17] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#090D16] px-4 py-3">
          {/* View Mode Segmented Tabs */}
          <div className="flex flex-wrap items-center gap-1 rounded bg-[#07090E] p-1 border border-slate-800">
            {(
              [
                ['side_by_side', 'Side-by-Side (Synced)'],
                ['overlay', 'Image Overlay'],
                ['difference', 'Difference Map (Δ)'],
                ['snr', 'Significance Heatmap (σ)'],
                ['quality', 'Artifact & Quality Mask'],
              ] as [CompareViewMode, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === id
                    ? 'bg-cyan-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Synchronized Zoom, Stretch & Overlay Controls */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {viewMode === 'overlay' && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Epoch Blend</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={overlayBlend}
                  onChange={(e) => setOverlayBlend(Number(e.target.value))}
                  className="w-24 accent-cyan-400"
                />
                <span className="font-mono text-slate-200 tabular-nums w-8">
                  {overlayBlend}%
                </span>
              </div>
            )}

            <div className="flex items-center gap-1 rounded border border-slate-800 bg-[#07090E] p-0.5">
              {(['asinh', 'linear', 'log'] as StretchMode[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStretch(s)}
                  className={`rounded px-2 py-1 text-[11px] capitalize cursor-pointer ${
                    stretch === s ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showDetections}
                onChange={(e) => setShowDetections(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 accent-cyan-400"
              />
              <span>Highlight Detections</span>
            </label>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(24, z * 1.3))}
                className="rounded border border-slate-700 bg-[#07090E] p-1.5 text-slate-200 hover:border-slate-500 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, z / 1.3))}
                className="rounded border border-slate-700 bg-[#07090E] p-1.5 text-slate-200 hover:border-slate-500 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={fitView}
                className="rounded border border-slate-700 bg-[#07090E] p-1.5 text-slate-200 hover:border-slate-500 cursor-pointer"
                title="Reset Sync View"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Viewport Canvas Stage */}
        {viewMode === 'side_by_side' ? (
          <div className="grid grid-cols-1 gap-px bg-slate-800 md:grid-cols-2">
            <div ref={viewportLeftRef} className="relative h-[420px] bg-[#05070B]">
              <div className="pointer-events-none absolute top-3 left-3 z-10 rounded border border-slate-800 bg-[#07090E]/90 px-2.5 py-1 font-mono text-[11px] text-slate-200">
                Reference Epoch 1 · {refEpoch.obsId} ·{' '}
                <span className="text-cyan-300">
                  {refEpoch.obsDateIso?.slice(0, 16).replace('T', ' ')} UTC
                </span>
              </div>
              <canvas
                ref={canvasLeftRef}
                onMouseDown={(e) => {
                  setIsDragging(true);
                  dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
                }}
                onMouseUp={() => {
                  setIsDragging(false);
                  dragRef.current = null;
                }}
                onMouseLeave={() => {
                  setIsDragging(false);
                  dragRef.current = null;
                  setProbe(null);
                }}
                onMouseMove={handleMouseMoveOnCanvas}
                onWheel={handleWheel}
                className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
              />
            </div>

            <div className="relative h-[420px] bg-[#05070B]">
              <div className="pointer-events-none absolute top-3 left-3 z-10 rounded border border-slate-800 bg-[#07090E]/90 px-2.5 py-1 font-mono text-[11px] text-slate-200">
                Aligned Epoch {result.epochs.length} · {latestEpoch.obsId} ·{' '}
                <span className="text-cyan-300">
                  {latestEpoch.obsDateIso?.slice(0, 16).replace('T', ' ')} UTC
                </span>
              </div>
              <canvas
                ref={canvasRightRef}
                onMouseDown={(e) => {
                  setIsDragging(true);
                  dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
                }}
                onMouseUp={() => {
                  setIsDragging(false);
                  dragRef.current = null;
                }}
                onMouseLeave={() => {
                  setIsDragging(false);
                  dragRef.current = null;
                  setProbe(null);
                }}
                onMouseMove={handleMouseMoveOnCanvas}
                onWheel={handleWheel}
                className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
              />
            </div>
          </div>
        ) : (
          <div ref={viewportSingleRef} className="relative h-[440px] bg-[#05070B]">
            <div className="pointer-events-none absolute top-3 left-3 z-10 rounded border border-slate-800 bg-[#07090E]/90 px-3 py-1.5 font-mono text-[11px] text-slate-200">
              {viewMode === 'overlay' &&
                `WCS-Aligned Overlay (${100 - overlayBlend}% ${refEpoch.obsId} / ${overlayBlend}% ${latestEpoch.obsId})`}
              {viewMode === 'difference' &&
                `Difference Map (${latestEpoch.obsId} − ${refEpoch.obsId}) · Cyan = Brightened, Amber = Dimmed`}
              {viewMode === 'snr' &&
                `Statistical Significance Heatmap (Z = ΔFlux / √(σ₁² + σ₂²)) · ±8σ scale`}
              {viewMode === 'quality' &&
                `SPHEREx FLAGS Quality Mask · Dark Teal = Clean, Amber = Soft Flag, Rose = Cosmic-Ray/Artifact Flag, Slate = Hard Masked`}
            </div>
            <canvas
              ref={canvasSingleRef}
              onMouseDown={(e) => {
                setIsDragging(true);
                dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
              }}
              onMouseUp={() => {
                setIsDragging(false);
                dragRef.current = null;
              }}
              onMouseLeave={() => {
                setIsDragging(false);
                dragRef.current = null;
                setProbe(null);
              }}
              onMouseMove={handleMouseMoveOnCanvas}
              onWheel={handleWheel}
              className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
            />
          </div>
        )}

        {/* Color Legend & Live Synchronized Crosshair Probe */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-[#07090E] px-4 py-2.5 font-mono text-[11px] text-slate-300 tabular-nums">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-emerald-300">■ Genuine Candidate</span>
            <span className="text-amber-300">■ Dimming / Alignment</span>
            <span className="text-rose-300">■ Cosmic-Ray / Defect Flag</span>
            <span className="text-violet-300">■ Uncertain</span>
          </div>

          {probe ? (
            <div className="flex flex-wrap items-center gap-3 text-cyan-300">
              <span>
                ({probe.fitsX}, {probe.fitsY})
              </span>
              {probe.ra !== null && probe.dec !== null && (
                <span>
                  RA {probe.ra.toFixed(5)}° · DEC {probe.dec.toFixed(5)}°
                </span>
              )}
              <span>
                A:{' '}
                {Number.isFinite(probe.fluxA) ? `${probe.fluxA.toFixed(4)}` : 'Masked'} · B:{' '}
                {Number.isFinite(probe.fluxB) ? `${probe.fluxB.toFixed(4)}` : 'Masked'}
              </span>
              <span>
                Δ:{' '}
                {Number.isFinite(probe.diff)
                  ? `${probe.diff >= 0 ? '+' : ''}${probe.diff.toFixed(4)} MJy/sr`
                  : 'N/A'}
              </span>
              <span>
                Z: {Number.isFinite(probe.snr) ? `${probe.snr >= 0 ? '+' : ''}${probe.snr.toFixed(2)}σ` : 'N/A'}
              </span>
            </div>
          ) : (
            <div className="text-slate-400">
              Hover canvas to inspect pixel flux, Δ MJy/sr, and Z-score · Drag to pan · Scroll to zoom
            </div>
          )}
        </div>
      </div>

      {/* DETECTED CHANGES & CONFIDENCE ANALYSIS */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left List of Detected Regions */}
        <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-[#0B0E17] overflow-hidden">
          <div className="border-b border-slate-800 px-5 py-4">
            <h3 className="font-display text-base font-semibold text-white">
              Detected Changes &amp; Artifact Attribution ({result.detectedChanges.length})
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Click a detected region to inspect its statistical confidence breakdown and FITS FLAGS
              evidence.
            </p>
          </div>

          {result.detectedChanges.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-400" />
              <div className="mt-3 text-sm font-semibold text-white">
                No Statistically Significant Changes Detected
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                No connected regions exceeded the |Z| ≥ 3.8σ uncertainty-normalized detection
                threshold across the aligned overlap. This indicates photometric stability within
                measurement noise between the selected epochs.
              </p>
            </div>
          ) : (
            <div className="max-h-[480px] divide-y divide-slate-800/80 overflow-y-auto">
              {result.detectedChanges.map((chg) => {
                const active = chg.id === selectedChange?.id;
                return (
                  <button
                    key={chg.id}
                    type="button"
                    onClick={() => setSelectedChangeId(chg.id)}
                    className={`block w-full text-left px-5 py-3.5 transition-colors cursor-pointer ${
                      active ? 'bg-slate-800/70' : 'hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-white">{chg.id}</span>
                        <span className={`text-xs font-semibold ${classificationTone(chg.classification)}`}>
                          {chg.classification}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-slate-300 tabular-nums">
                        Z = {chg.maxZScore >= 0 ? '+' : ''}
                        {chg.maxZScore}σ
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-400 tabular-nums">
                      <span>
                        Δ {chg.deltaFluxIntegrated >= 0 ? '+' : ''}
                        {chg.deltaFluxIntegrated.toFixed(4)} MJy/sr
                      </span>
                      {chg.percentChange !== null && (
                        <span>
                          ({chg.percentChange >= 0 ? '+' : ''}
                          {chg.percentChange}%)
                        </span>
                      )}
                      <span>{chg.areaPixels} px</span>
                      <span>
                        Genuine: {chg.genuineConfidencePct !== null ? `${chg.genuineConfidencePct}%` : 'Insufficient'}
                      </span>
                      <span>
                        Artifact: {chg.artifactConfidencePct !== null ? `${chg.artifactConfidencePct}%` : 'Insufficient'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Detailed Confidence & Evidence Card */}
        <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-[#0B0E17] p-5">
          {selectedChange ? (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                    <span>{selectedChange.id}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Pixel ({selectedChange.pixelX + 1}, {selectedChange.pixelY + 1})
                    </span>
                    {selectedChange.centroidRa !== null && selectedChange.centroidDec !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          RA {selectedChange.centroidRa.toFixed(5)}°, DEC{' '}
                          {selectedChange.centroidDec.toFixed(5)}°
                        </span>
                      </>
                    )}
                  </div>
                  <h3
                    className={`mt-1.5 text-lg font-bold ${classificationTone(
                      selectedChange.classification
                    )}`}
                  >
                    {selectedChange.classification}
                  </h3>
                </div>
                <div className="text-right font-mono text-xs">
                  <div className="text-slate-400">Data Quality</div>
                  <div className="font-semibold text-white">{selectedChange.dataQualityStatus}</div>
                </div>
              </div>

              {/* Probability / Confidence Metrics (NOT forced to 100%) */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">
                    Statistical Confidence Assessment
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Independent metrics (not forced to 100%)
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded border border-slate-800 bg-[#07090E] p-3">
                    <div className="text-[11px] text-slate-400">Genuine Astronomical Signal</div>
                    <div className="mt-1 font-mono text-xl font-bold text-emerald-300 tabular-nums">
                      {selectedChange.genuineConfidencePct !== null
                        ? `${selectedChange.genuineConfidencePct}%`
                        : 'Insufficient'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {selectedChange.confidenceLabel}
                    </div>
                  </div>

                  <div className="rounded border border-slate-800 bg-[#07090E] p-3">
                    <div className="text-[11px] text-slate-400">Instrumental / Artifact</div>
                    <div className="mt-1 font-mono text-xl font-bold text-rose-300 tabular-nums">
                      {selectedChange.artifactConfidencePct !== null
                        ? `${selectedChange.artifactConfidencePct}%`
                        : 'Insufficient'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Flags: {selectedChange.activeFlags.length || '0'}
                    </div>
                  </div>

                  <div className="rounded border border-slate-800 bg-[#07090E] p-3">
                    <div className="text-[11px] text-slate-400">Uncertain / Other</div>
                    <div className="mt-1 font-mono text-xl font-bold text-violet-300 tabular-nums">
                      {selectedChange.uncertainConfidencePct !== null
                        ? `${selectedChange.uncertainConfidencePct}%`
                        : 'Insufficient'}
                    </div>
                    <div className="text-[11px] text-slate-400">PSF / dither ambiguity</div>
                  </div>
                </div>
              </div>

              {/* Measurements Table */}
              <dl className="mt-4 divide-y divide-slate-800/70 text-xs">
                {[
                  [
                    'Integrated Brightness Change',
                    `${selectedChange.deltaFluxIntegrated >= 0 ? '+' : ''}${selectedChange.deltaFluxIntegrated.toFixed(5)} ± ${selectedChange.uncertaintyIntegrated.toFixed(5)} MJy/sr`,
                  ],
                  [
                    'Relative Percentage Change',
                    selectedChange.percentChange !== null
                      ? `${selectedChange.percentChange >= 0 ? '+' : ''}${selectedChange.percentChange}%`
                      : 'Baseline below 3σ sky noise (percentage undefined)',
                  ],
                  [
                    'Integrated SNR / Peak Z',
                    `${selectedChange.integratedSnr.toFixed(2)}σ integrated · ${selectedChange.maxZScore.toFixed(2)}σ peak`,
                  ],
                  [
                    'Source Shape (FWHM)',
                    `Ref: ${selectedChange.fwhmRefPx !== null ? `${selectedChange.fwhmRefPx} px` : 'No peak'} · Target: ${
                      selectedChange.fwhmTargetPx !== null ? `${selectedChange.fwhmTargetPx} px` : 'No peak'
                    }`,
                  ],
                  [
                    'Positional Shift / Dipole Balance',
                    `${
                      selectedChange.positionalShiftArcsec !== null
                        ? `${selectedChange.positionalShiftArcsec}"`
                        : 'N/A'
                    } · Dipole ratio ${selectedChange.dipoleBalanceRatio}`,
                  ],
                  [
                    'SPHEREx HDU 2 FLAGS',
                    selectedChange.activeFlags.length > 0
                      ? selectedChange.activeFlags.join(', ')
                      : 'No artifact bits flagged',
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 py-2">
                    <dt className="text-slate-400">{k}</dt>
                    <dd className="text-right font-mono text-slate-100 tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>

              {/* Supporting Evidence */}
              <div className="mt-4 border-t border-slate-800 pt-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <ShieldAlert className="h-3.5 w-3.5 text-cyan-400" />
                  Supporting Evidence
                </div>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-slate-300">
                  {selectedChange.supportingEvidence.map((ev, i) => (
                    <li key={i}>{ev}</li>
                  ))}
                  {selectedChange.multiEpochSummary && <li>{selectedChange.multiEpochSummary}</li>}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-xs text-slate-400">
              Select a detected change region from the list to view detailed uncertainty and
              artifact analysis.
            </div>
          )}
        </div>
      </div>

      {/* EPOCH METADATA & ORIGINAL FITS LINKS */}
      <div className="rounded-lg border border-slate-800 bg-[#0B0E17] p-5">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-white">
          <Layers className="h-4 w-4 text-cyan-400" />
          Compared SPHEREx Exposures &amp; Original FITS Provenance
        </h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="py-2 pr-4">Epoch / Observation ID</th>
                <th className="py-2 pr-4">Observed (UTC)</th>
                <th className="py-2 pr-4">Release &amp; Pipeline</th>
                <th className="py-2 pr-4">Sky Noise σ</th>
                <th className="py-2 pr-4">Zodi Median</th>
                <th className="py-2 pr-4">Valid / Flagged</th>
                <th className="py-2 text-right">FITS Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {result.epochs.map((ep, i) => (
                <tr key={ep.observationId}>
                  <td className="py-2.5 pr-4 text-white">
                    #{i + 1} · {ep.obsId}
                  </td>
                  <td className="py-2.5 pr-4 text-cyan-300">
                    {ep.obsDateIso ? ep.obsDateIso.replace('T', ' ').replace('.000Z', 'Z') : 'N/A'}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-300">
                    {ep.dataRelease} · v{ep.pipelineVersionHeader}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-300">
                    {ep.skyNoiseSigma.toFixed(5)} {ep.bunit}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-300">
                    {ep.zodiMedian !== null ? `${ep.zodiMedian.toFixed(4)} MJy/sr` : 'N/A'}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-300">
                    {(ep.validPixelFraction * 100).toFixed(1)}% /{' '}
                    {(ep.flaggedPixelFraction * 100).toFixed(1)}%
                  </td>
                  <td className="py-2.5 text-right">
                    <a
                      href={ep.accessUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                    >
                      Original FITS
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DETAILED 14-POINT DIFFERENCE REPORT */}
      <div className="rounded-lg border border-slate-800 bg-[#0B0E17] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
              Automated Scientific Difference Report
            </p>
            <h3 className="mt-1 font-display text-xl font-bold text-white">
              14-Point Space Comparison Report
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  buildMarkdownReport(result),
                  `spherex_comparison_report_${result.report.detectorUsed.id}.md`,
                  'text/markdown'
                )
              }
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#07090E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/60 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
              Export Markdown (.md)
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  JSON.stringify(result.report, null, 2),
                  `spherex_comparison_report_${result.report.detectorUsed.id}.json`,
                  'application/json'
                )
              }
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#07090E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/60 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
              Export JSON (.json)
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 text-xs leading-relaxed text-slate-300">
          {[
            [
              '01. Region Analyzed',
              `RA ${result.report.regionAnalyzed.ra.toFixed(6)}°, DEC ${result.report.regionAnalyzed.dec.toFixed(6)}° · Cutout ${result.report.regionAnalyzed.cutoutSizeDeg}° (${result.width}×${result.height} px)`,
            ],
            [
              '02. Detector Used',
              `${result.report.detectorUsed.label} (${result.report.detectorUsed.bandpassName}) · ${result.report.detectorUsed.wavelengthRangeLabel} · ${result.report.detectorUsed.focalPlane}`,
            ],
            [
              '03. Number of Images Compared',
              `${result.report.numberOfImagesCompared} aligned SPHEREx Level 2 exposures`,
            ],
            [
              '04. Observation Dates',
              result.report.observationDates.join(' | '),
            ],
            ['05. Time Elapsed Between Observations', result.report.timeElapsedSummary],
            [
              '06. Total Number of Detected Differences',
              `${result.report.totalDetectedDifferences} connected regions above |Z| >= 3.8σ`,
            ],
            ['07. Brightness Changes', result.report.brightnessChangesSummary],
            ['08. Newly Detected or Missing Sources', result.report.newOrMissingSourcesSummary],
            ['09. Possible Positional Changes', result.report.positionalChangesSummary],
            ['10. Genuine Astronomical Signal Assessment', result.report.genuineSignalAssessment],
            ['11. Potential Satellite / Instrument Error Assessment', result.report.satelliteErrorAssessment],
            ['12. Confidence and Uncertainty', result.report.confidenceAndUncertaintySummary],
          ].map(([title, body]) => (
            <div key={title} className="rounded border border-slate-800/80 bg-[#07090E] p-4">
              <div className="font-semibold text-white">{title}</div>
              <p className="mt-1.5 text-slate-300">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 text-xs leading-relaxed text-slate-300">
          <div className="rounded border border-slate-800/80 bg-[#07090E] p-4">
            <div className="flex items-center gap-1.5 font-semibold text-white">
              <Eye className="h-3.5 w-3.5 text-cyan-400" />
              13. Technical Methodology Used
            </div>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {result.report.technicalMethodology.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-slate-800/80 bg-[#07090E] p-4">
            <div className="flex items-center gap-1.5 font-semibold text-white">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              14. Limitations &amp; Recommendations for Verification
            </div>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {result.report.limitationsAndRecommendations.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
