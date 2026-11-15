import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Film,
  Layers,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SPHEREX_DETECTORS,
  formatDecDms,
  formatRaHms,
  type DetectedChangeRegion,
  type SpherexObservation,
  type TimelapseCustomSettings,
  type TimelapseExportResult,
  type TimelapsePreparationResult,
} from '../../shared/astronomy';
import { FitsViewerModal } from './FitsViewerModal';

interface TimelapseStudioProps {
  prepared: TimelapsePreparationResult;
  exportedVideo: TimelapseExportResult | null;
  exportingMp4: boolean;
  exportError: string | null;
  settings: TimelapseCustomSettings;
  onUpdateSettings: (patch: Partial<TimelapseCustomSettings>) => void;
  onRenderMp4: () => Promise<TimelapseExportResult | null>;
}

interface DecodedFrame {
  flux: Float32Array;
  mask: Uint8Array;
}

interface DecodedPair {
  diff: Float32Array;
  snr: Float32Array;
}

function decodeBase64Float32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function decodeBase64Uint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function cyanThermalRgb(val: number, vmin: number, vmax: number): [number, number, number] {
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

function bipolarDiffRgb(diffVal: number, scaleMax: number): [number, number, number] {
  if (!Number.isFinite(diffVal)) return [7, 9, 14];
  const norm = Math.max(-1, Math.min(1, diffVal / Math.max(scaleMax, 1e-6)));
  const mag = Math.pow(Math.abs(norm), 0.72);
  if (norm >= 0) {
    return [Math.round(12 + mag * 238), Math.round(16 + mag * 155), Math.round(24 + mag * 40)];
  }
  return [Math.round(12 + mag * 24), Math.round(16 + mag * 135), Math.round(24 + mag * 225)];
}

export function TimelapseStudio({
  prepared,
  exportedVideo,
  exportingMp4,
  exportError,
  settings,
  onUpdateSettings,
  onRenderMp4,
}: TimelapseStudioProps) {
  const [stageTab, setStageTab] = useState<'interactive' | 'mp4'>('interactive');
  const [playing, setPlaying] = useState<boolean>(true);
  // Continuous timeline position in frame index space [0 .. frames.length - 1]
  const [playhead, setPlayhead] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<boolean>(false);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [inspectedObs, setInspectedObs] = useState<SpherexObservation | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const decodedFrames = useMemo<DecodedFrame[]>(() => {
    return prepared.frames.map((f) => ({
      flux: decodeBase64Float32(f.alignedFluxFloat32Base64),
      mask: decodeBase64Uint8(f.qualityMaskBase64),
    }));
  }, [prepared.frames]);

  const decodedPairs = useMemo<DecodedPair[]>(() => {
    return prepared.pairs.map((p) => ({
      diff: decodeBase64Float32(p.diffFloat32Base64),
      snr: decodeBase64Float32(p.snrFloat32Base64),
    }));
  }, [prepared.pairs]);

  const diffScaleMax = useMemo(() => {
    let maxVal = 0.05;
    for (const p of decodedPairs) {
      for (let i = 0; i < p.diff.length; i += 4) {
        const av = Math.abs(p.diff[i]);
        if (Number.isFinite(av) && av > maxVal) maxVal = av;
      }
    }
    return Math.min(maxVal, 1.5);
  }, [decodedPairs]);

  // Reset playhead when new timelapse finishes preparing
  useEffect(() => {
    setPlayhead(0);
    setPlaying(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [prepared.timelapseId]);

  // Playback animation loop
  useEffect(() => {
    if (!playing || prepared.frames.length < 2 || stageTab !== 'interactive') return;

    let rafId = 0;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dtSec = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      const effPeriodPerFrame = Math.max(0.25, settings.frameDurationSec / settings.playbackSpeed);
      setPlayhead((prev) => {
        const next = prev + dtSec / effPeriodPerFrame;
        const maxIdx = prepared.frames.length - 1;
        return next > maxIdx ? 0 : next;
      });
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [
    playing,
    prepared.frames.length,
    settings.frameDurationSec,
    settings.playbackSpeed,
    stageTab,
  ]);

  // Current discrete observation & interpolation fraction
  const frameCount = prepared.frames.length;
  const idxA = Math.min(frameCount - 1, Math.max(0, Math.floor(playhead)));
  const frac = playhead - idxA;
  const isInterpolated =
    settings.visualizationMode !== 'original_sequence' &&
    idxA < frameCount - 1 &&
    frac > 0.06 &&
    frac < 0.94;
  const idxB = Math.min(frameCount - 1, idxA + 1);
  const activeFrame = prepared.frames[idxA];
  const activePairMeta =
    idxA > 0 ? prepared.pairs[Math.min(prepared.pairs.length - 1, idxA - 1)] : prepared.pairs[0];

  // Draw current frame onto Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || decodedFrames.length === 0) return;

    const outW =
      settings.aspectRatio === '9:16' ? 450 : settings.aspectRatio === '1:1' ? 560 : 760;
    const outH =
      settings.aspectRatio === '9:16' ? 760 : settings.aspectRatio === '1:1' ? 560 : 460;

    if (canvas.width !== outW || canvas.height !== outH) {
      canvas.width = outW;
      canvas.height = outH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#07090E';
    ctx.fillRect(0, 0, outW, outH);

    const w = prepared.width;
    const h = prepared.height;
    const vmin = prepared.summary.sharedNormalization.vmin;
    const vmax = prepared.summary.sharedNormalization.vmax;

    const topPad = 48;
    const botPad = 48;
    const availW = outW - 24;
    const availH = outH - topPad - botPad - 12;

    const frameA = decodedFrames[idxA];
    const frameB = decodedFrames[idxB];
    const baseline = decodedFrames[0];
    const pairIdx = idxA > 0 ? Math.min(decodedPairs.length - 1, idxA - 1) : 0;
    const pairBuf = decodedPairs[pairIdx];

    const renderRasterToOffscreen = (
      pixelFn: (fx: number, fy: number) => [number, number, number]
    ): HTMLCanvasElement => {
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d')!;
      const imgData = octx.createImageData(w, h);
      const data = imgData.data;
      for (let fy = 0; fy < h; fy++) {
        const sy = h - 1 - fy; // FITS bottom-up -> canvas top-down
        for (let fx = 0; fx < w; fx++) {
          const [r, g, b] = pixelFn(fx, fy);
          const di = (sy * w + fx) * 4;
          data[di] = r;
          data[di + 1] = g;
          data[di + 2] = b;
          data[di + 3] = 255;
        }
      }
      octx.putImageData(imgData, 0, 0);
      return off;
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(12, topPad, availW, availH);
    ctx.clip();

    if (settings.visualizationMode === 'side_by_side_comparison') {
      const portrait = outH > outW;
      const gap = 14;
      const panelSize = portrait
        ? Math.floor(Math.min(availW, (availH - gap) / 2))
        : Math.floor(Math.min((availW - gap) / 2, availH));
      const x1 = Math.floor((outW - (portrait ? panelSize : panelSize * 2 + gap)) / 2) + pan.x;
      const y1 =
        topPad + Math.floor((availH - (portrait ? panelSize * 2 + gap : panelSize)) / 2) + pan.y;

      const x2 = portrait ? x1 : x1 + panelSize + gap;
      const y2 = portrait ? y1 + panelSize + gap : y1;

      const offBase = renderRasterToOffscreen((fx, fy) =>
        cyanThermalRgb(baseline.flux[fy * w + fx], vmin, vmax)
      );
      const offCurr = renderRasterToOffscreen((fx, fy) => {
        const i = fy * w + fx;
        const v = isInterpolated ? (1 - frac) * frameA.flux[i] + frac * frameB.flux[i] : frameA.flux[i];
        return cyanThermalRgb(v, vmin, vmax);
      });

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offBase, x1, y1, panelSize * zoom, panelSize * zoom);
      ctx.drawImage(offCurr, x2, y2, panelSize * zoom, panelSize * zoom);

      ctx.strokeStyle = '#1E293B';
      ctx.strokeRect(x1, y1, panelSize * zoom, panelSize * zoom);
      ctx.strokeRect(x2, y2, panelSize * zoom, panelSize * zoom);

      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#22D3EE';
      ctx.fillText('BASELINE #1', x1 + 8, y1 + 18);
      ctx.fillStyle = '#34D399';
      ctx.fillText(`OBS #${idxA + 1}`, x2 + 8, y2 + 18);
    } else {
      const boxSize = Math.floor(Math.min(availW, availH) * zoom);
      const boxX = Math.floor((outW - boxSize) / 2) + pan.x;
      const boxY = topPad + Math.floor((availH - boxSize) / 2) + pan.y;
      const wipeX = Math.round(w * (0.2 + 0.6 * frac));

      const off = renderRasterToOffscreen((fx, fy) => {
        const i = fy * w + fx;
        const valA = frameA.flux[i];
        const valB = frameB.flux[i];

        switch (settings.visualizationMode) {
          case 'original_sequence':
          case 'source_appear_disappear':
            return cyanThermalRgb(valA, vmin, vmax);
          case 'smooth_crossfade': {
            const v = isInterpolated ? (1 - frac) * valA + frac * valB : valA;
            return cyanThermalRgb(v, vmin, vmax);
          }
          case 'before_after_transitions':
            return fx < wipeX
              ? cyanThermalRgb(baseline.flux[i], vmin, vmax)
              : cyanThermalRgb(valA, vmin, vmax);
          case 'animated_difference_map':
            if (idxA === 0 && !isInterpolated) return cyanThermalRgb(valA, vmin, vmax);
            return bipolarDiffRgb(pairBuf ? pairBuf.diff[i] : 0, diffScaleMax);
          case 'brightness_change': {
            const base = cyanThermalRgb(valA, vmin, vmax);
            const muted: [number, number, number] = [
              Math.round(base[0] * 0.45),
              Math.round(base[1] * 0.45),
              Math.round(base[2] * 0.45),
            ];
            if (!pairBuf) return muted;
            const z = pairBuf.snr[i];
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
          default:
            return cyanThermalRgb(valA, vmin, vmax);
        }
      });

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, boxX, boxY, boxSize, boxSize);
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, boxSize, boxSize);

      if (settings.visualizationMode === 'before_after_transitions') {
        const dividerScreenX = boxX + (wipeX / w) * boxSize;
        ctx.strokeStyle = '#22D3EE';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(dividerScreenX, boxY);
        ctx.lineTo(dividerScreenX, boxY + boxSize);
        ctx.stroke();

        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#22D3EE';
        ctx.fillText('OBS #1', boxX + 8, boxY + 18);
        ctx.fillStyle = '#34D399';
        ctx.fillText(`OBS #${idxA + 1}`, boxX + boxSize - 64, boxY + 18);
      }

      if (
        (settings.showAnnotations || settings.visualizationMode === 'source_appear_disappear') &&
        activePairMeta
      ) {
        for (const chg of activePairMeta.changes.slice(0, 8)) {
          const rx = boxX + (chg.bbox.xMin / w) * boxSize - 4;
          const rw = Math.max(14, ((chg.bbox.xMax - chg.bbox.xMin + 1) / w) * boxSize + 8);
          const ryTopFits = h - 1 - chg.bbox.yMax;
          const ry = boxY + (ryTopFits / h) * boxSize - 4;
          const rh = Math.max(14, ((chg.bbox.yMax - chg.bbox.yMin + 1) / h) * boxSize + 8);

          const isArt =
            chg.classification.includes('Artifact') ||
            chg.classification.includes('Defect') ||
            chg.classification.includes('Misalignment');
          const strokeCol = isArt ? '#F43F5E' : chg.integratedSnr >= 0 ? '#34D399' : '#FBBF24';

          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = 1.6;
          if (isArt) ctx.setLineDash([4, 3]);
          else ctx.setLineDash([]);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.setLineDash([]);

          if (settings.showAnnotations) {
            ctx.font = '600 10px "JetBrains Mono", monospace';
            ctx.fillStyle = strokeCol;
            ctx.fillText(
              `${chg.id} (${chg.maxZScore >= 0 ? '+' : ''}${chg.maxZScore}σ)`,
              rx,
              Math.max(boxY + 12, ry - 4)
            );
          }
        }
      }
    }
    ctx.restore();

    // TOP TELEMETRY BAR
    ctx.fillStyle = '#0B0E17';
    ctx.fillRect(0, 0, outW, topPad);
    ctx.strokeStyle = '#1E293B';
    ctx.beginPath();
    ctx.moveTo(0, topPad);
    ctx.lineTo(outW, topPad);
    ctx.stroke();

    ctx.font = '700 13px "Chakra Petch", sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(settings.title || `SPHEREx ${prepared.summary.detector.id} Time-Lapse`, 14, 20);

    const subInfo: string[] = [];
    if (settings.showDetectorInfo) {
      subInfo.push(
        `${prepared.summary.detector.bandpassName} (${prepared.summary.detector.wavelengthRangeLabel})`
      );
    }
    if (settings.showCoordinates) {
      subInfo.push(
        `RA ${prepared.summary.region.ra.toFixed(4)}° · DEC ${prepared.summary.region.dec.toFixed(4)}°`
      );
    }
    if (subInfo.length > 0) {
      ctx.font = '400 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#38BDF8';
      ctx.fillText(subInfo.join('  |  '), 14, 38);
    }

    // Authenticity badge
    ctx.textAlign = 'right';
    ctx.font = '600 11px "JetBrains Mono", monospace';
    if (isInterpolated) {
      ctx.fillStyle = '#FBBF24';
      ctx.fillText('VISUAL INTERPOLATION · NOT SATELLITE DATA', outW - 14, 26);
    } else {
      ctx.fillStyle = '#22D3EE';
      ctx.fillText(`ACTUAL SATELLITE OBS #${idxA + 1} / ${frameCount}`, outW - 14, 26);
    }
    ctx.textAlign = 'left';

    // BOTTOM BAR
    ctx.fillStyle = '#0B0E17';
    ctx.fillRect(0, outH - botPad, outW, botPad);
    ctx.strokeStyle = '#1E293B';
    ctx.beginPath();
    ctx.moveTo(0, outH - botPad);
    ctx.lineTo(outW, outH - botPad);
    ctx.stroke();

    if (settings.showDates) {
      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillStyle = '#22D3EE';
      const tsStr = activeFrame.epochMeta.obsDateIso
        ? `UTC ${activeFrame.epochMeta.obsDateIso.replace('T', ' ').slice(0, 19)}Z`
        : 'UTC Timestamp Unavailable';
      ctx.fillText(tsStr, 14, outH - 27);
    }

    ctx.font = '400 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(
      `OBS ID: ${activeFrame.observation.obsId} · ${activeFrame.observation.dataRelease}`,
      14,
      outH - 11
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(
      activeFrame.timeDeltaFromStartHours !== null
        ? `T + ${activeFrame.timeDeltaFromStartHours.toFixed(1)} hrs`
        : 'Baseline',
      outW - 14,
      outH - 18
    );
    ctx.textAlign = 'left';
  }, [
    decodedFrames,
    decodedPairs,
    diffScaleMax,
    idxA,
    idxB,
    frac,
    isInterpolated,
    frameCount,
    activeFrame,
    activePairMeta,
    pan,
    zoom,
    prepared.width,
    prepared.height,
    prepared.summary,
    settings,
  ]);

  const handleToggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleDownloadDifferenceMapPng = () => {
    if (!activePairMeta || decodedPairs.length === 0) return;
    const pIdx = idxA > 0 ? Math.min(decodedPairs.length - 1, idxA - 1) : 0;
    const pairData = decodedPairs[pIdx];
    const scale = 3;
    const off = document.createElement('canvas');
    off.width = prepared.width * scale;
    off.height = prepared.height * scale;
    const ctx = off.getContext('2d')!;
    for (let fy = 0; fy < prepared.height; fy++) {
      const sy = prepared.height - 1 - fy;
      for (let fx = 0; fx < prepared.width; fx++) {
        const [r, g, b] = bipolarDiffRgb(pairData.diff[fy * prepared.width + fx], diffScaleMax);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(fx * scale, sy * scale, scale, scale);
      }
    }
    const url = off.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `difference-map-${activePairMeta.fromObsId}-to-${activePairMeta.toObsId}.png`;
    a.click();
  };

  const handleDownloadReport = () => {
    const s = prepared.summary;
    const lines: string[] = [
      `# BEYOND SPACE — COSMIC TIME-LAPSE SCIENTIFIC REPORT`,
      `Generated At: ${prepared.createdAt}`,
      `Region: RA ${s.region.ra.toFixed(5)}° (${formatRaHms(s.region.ra)}), DEC ${s.region.dec.toFixed(5)}° (${formatDecDms(s.region.dec)}), Radius ${s.region.radiusDeg}°, Cutout ${s.region.cutoutSizeDeg}°`,
      `Detector: ${s.detector.label} (${s.detector.bandpassName}, ${s.detector.wavelengthRangeLabel}, ${s.detector.spectralResolvingPower})`,
      `Frames Prepared: ${s.preparedFrameCount} / ${s.selectedCount} selected (${s.totalMatchingArchiveRecords} matching records in archive search)`,
      `First Observation (UTC): ${s.firstObservationDate ?? 'N/A'}`,
      `Last Observation (UTC): ${s.lastObservationDate ?? 'N/A'}`,
      `Total Time Period Covered: ${s.totalTimeSpanLabel}`,
      `Shared Flux Normalization: ${s.sharedNormalization.method} [vmin=${s.sharedNormalization.vmin}, vmax=${s.sharedNormalization.vmax} ${s.sharedNormalization.bunit}]`,
      ``,
      `## Chronological Observation Sequence`,
      ...prepared.frames.map(
        (f) =>
          `- Frame #${f.frameIndex + 1}: ${f.epochMeta.obsDateIso ?? 'Timestamp N/A'} | ${f.observation.obsId} | ${f.observation.bandpassName} | ${f.observation.dataRelease}`
      ),
      ``,
      `## Detected Changes & Artifacts Summary`,
      s.changeSummary.headline,
      `- Total Events: ${s.changeSummary.totalDetectedEvents}`,
      `- Brightening: ${s.changeSummary.brighteningEvents}, Dimming: ${s.changeSummary.dimmingEvents}`,
      `- New Sources: ${s.changeSummary.newSources}, Disappeared Sources: ${s.changeSummary.disappearedSources}, Structural Shifts: ${s.changeSummary.structuralShifts}`,
      `- Genuine Astronomical Candidates: ${s.changeSummary.genuineCandidates}, Probable Artifacts/Cosmic-Rays/Alignment: ${s.changeSummary.probableArtifacts}, Uncertain: ${s.changeSummary.uncertainEvents}`,
      ``,
      `## Consecutive Pair Summary`,
      ...prepared.pairs.map(
        (p) =>
          `- ${p.fromObsId} -> ${p.toObsId} (Δt=${p.summary.timeDeltaHours ?? 'N/A'}h): ${p.summary.significantIncreasePixels} pix +3σ, ${p.summary.significantDecreasePixels} pix -3σ, mean |Δ|=${p.summary.meanAbsChangeMjySr} MJy/sr, WCS offset=${p.summary.wcsResidualShiftArcsec}"`
      ),
      ``,
      `## Scientific Disclaimers & Data Limitations`,
      s.interpolationDisclaimer,
      ...s.qualityAndLimitations.map((q) => `- ${q}`),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cosmic-timelapse-report-${s.detector.id}-${prepared.timelapseId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadMp4 = async () => {
    let target = exportedVideo;
    if (!target) {
      target = await onRenderMp4();
    }
    if (target) {
      const a = document.createElement('a');
      a.href = target.downloadUrl;
      a.download = `beyond-space-timelapse-${prepared.summary.detector.id}-${target.exportId}.mp4`;
      a.click();
    }
  };

  const allChangesWithPair = useMemo(() => {
    const out: Array<{ transitionLabel: string; change: DetectedChangeRegion }> = [];
    for (const p of prepared.pairs) {
      const lbl = `#${p.fromFrameIndex + 1} → #${p.toFrameIndex + 1}`;
      for (const chg of p.changes) {
        out.push({ transitionLabel: lbl, change: chg });
      }
    }
    return out;
  }, [prepared.pairs]);

  const s = prepared.summary;

  return (
    <div className="space-y-6">
      {/* MAIN STUDIO CARD */}
      <div
        ref={stageRef}
        className="rounded-lg border border-slate-800 bg-[#0B0E17] overflow-hidden"
      >
        {/* Top Studio Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5 bg-[#090D16]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStageTab('interactive')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                stageTab === 'interactive'
                  ? 'bg-cyan-500 text-slate-950'
                  : 'border border-slate-700 text-slate-300 hover:border-cyan-500/50'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Interactive Frame Studio
            </button>
            <button
              type="button"
              onClick={() => {
                setStageTab('mp4');
                if (!exportedVideo && !exportingMp4) {
                  onRenderMp4();
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                stageTab === 'mp4'
                  ? 'bg-cyan-500 text-slate-950'
                  : 'border border-slate-700 text-slate-300 hover:border-cyan-500/50'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              Preview Exported MP4
              {exportedVideo?.verifiedOnDisk ? ' (Ready)' : ''}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportingMp4}
              onClick={onRenderMp4}
              className="inline-flex items-center gap-1.5 rounded border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 cursor-pointer"
            >
              <Film className="h-3.5 w-3.5" />
              {exportingMp4 ? 'Encoding MP4 via FFmpeg...' : 'Re-Render MP4 with Current Settings'}
            </button>
            <button
              type="button"
              disabled={exportingMp4}
              onClick={handleDownloadMp4}
              className="inline-flex items-center gap-1.5 rounded bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Download MP4 Video
            </button>
          </div>
        </div>

        {/* STAGE VIEWPORT */}
        {stageTab === 'interactive' ? (
          <div className="p-5">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left 8 cols: Interactive Canvas Player + Scrubber */}
              <div className="lg:col-span-8 space-y-3">
                <div
                  className="relative flex items-center justify-center rounded-lg border border-slate-800 bg-[#05070B] overflow-hidden select-none"
                  onMouseDown={(e) => {
                    if (zoom <= 1) return;
                    setDragging(true);
                    setDragOrigin({ x: e.clientX - pan.x, y: e.clientY - pan.y });
                  }}
                  onMouseMove={(e) => {
                    if (!dragging) return;
                    setPan({ x: e.clientX - dragOrigin.x, y: e.clientY - dragOrigin.y });
                  }}
                  onMouseUp={() => setDragging(false)}
                  onMouseLeave={() => setDragging(false)}
                >
                  <canvas
                    ref={canvasRef}
                    className={`max-h-[540px] w-auto max-w-full ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  />
                </div>

                {/* Transport & Zoom/Pan Controls */}
                <div className="rounded border border-slate-800 bg-[#07090E] p-3.5 space-y-3">
                  {/* Timeline Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                      <span>
                        Frame {idxA + 1} / {frameCount} ·{' '}
                        <strong className={isInterpolated ? 'text-amber-300' : 'text-cyan-300'}>
                          {isInterpolated
                            ? 'INTERPOLATED TRANSITION FRAME'
                            : 'ACTUAL SPHEREX EXPOSURE'}
                        </strong>
                      </span>
                      <span>
                        {activeFrame.epochMeta.obsDateIso
                          ? activeFrame.epochMeta.obsDateIso.replace('T', ' ').slice(0, 19) + ' UTC'
                          : 'N/A'}
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label="Time-lapse timeline scrubber"
                      min={0}
                      max={Math.max(0, frameCount - 1)}
                      step={0.05}
                      value={playhead}
                      onChange={(e) => {
                        setPlaying(false);
                        setPlayhead(Number(e.target.value));
                      }}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                    {/* Actual Frame Tick Buttons */}
                    <div className="flex items-center gap-1 overflow-x-auto pb-1">
                      {prepared.frames.map((f) => {
                        const isCurrent = Math.round(playhead) === f.frameIndex;
                        return (
                          <button
                            key={f.observation.id}
                            type="button"
                            onClick={() => {
                              setPlaying(false);
                              setPlayhead(f.frameIndex);
                            }}
                            title={`Jump to Frame #${f.frameIndex + 1}: ${f.epochMeta.obsDateIso ?? f.observation.obsId}`}
                            className={`rounded border px-2 py-0.5 font-mono text-[10px] whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                              isCurrent
                                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200 font-semibold'
                                : 'border-slate-800 bg-[#0B0E17] text-slate-400 hover:border-slate-600'
                            }`}
                          >
                            #{f.frameIndex + 1} · {f.epochMeta.obsDateIso?.slice(0, 10) ?? 'No Date'}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Playback Transport Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPlaying((p) => !p)}
                        className="inline-flex items-center gap-1.5 rounded bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 cursor-pointer"
                      >
                        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {playing ? 'Pause' : 'Play'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlaying(false);
                          setPlayhead(0);
                        }}
                        aria-label="Stop"
                        className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
                      >
                        <Square className="h-3.5 w-3.5" />
                        Stop
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlayhead(0);
                          setPlaying(true);
                        }}
                        aria-label="Replay"
                        className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Replay
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlaying(false);
                          setPlayhead((p) => Math.max(0, Math.round(p) - 1));
                        }}
                        aria-label="Step Backward"
                        className="rounded border border-slate-700 p-1.5 text-slate-300 hover:text-white cursor-pointer"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlaying(false);
                          setPlayhead((p) => Math.min(frameCount - 1, Math.round(p) + 1));
                        }}
                        aria-label="Step Forward"
                        className="rounded border border-slate-700 p-1.5 text-slate-300 hover:text-white cursor-pointer"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Speed, Zoom, Pan Reset, Fullscreen */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <div className="flex items-center gap-1 font-mono text-[11px] text-slate-400">
                        <span>Speed:</span>
                        {[0.5, 1, 2].map((spd) => (
                          <button
                            key={spd}
                            type="button"
                            onClick={() => onUpdateSettings({ playbackSpeed: spd })}
                            className={`rounded border px-2 py-0.5 cursor-pointer ${
                              settings.playbackSpeed === spd
                                ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                                : 'border-slate-800 text-slate-400'
                            }`}
                          >
                            {spd}x
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))))}
                          aria-label="Zoom out"
                          className="rounded border border-slate-700 p-1.5 text-slate-300 hover:text-white cursor-pointer"
                        >
                          <ZoomOut className="h-3.5 w-3.5" />
                        </button>
                        <span className="font-mono text-[11px] text-slate-300 w-10 text-center tabular-nums">
                          {zoom.toFixed(1)}x
                        </span>
                        <button
                          type="button"
                          onClick={() => setZoom((z) => Math.min(4, Number((z + 0.5).toFixed(1))))}
                          aria-label="Zoom in"
                          className="rounded border border-slate-700 p-1.5 text-slate-300 hover:text-white cursor-pointer"
                        >
                          <ZoomIn className="h-3.5 w-3.5" />
                        </button>
                        {zoom > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setZoom(1);
                              setPan({ x: 0, y: 0 });
                            }}
                            className="rounded border border-slate-700 px-2 py-1 font-mono text-[10px] text-slate-300 hover:text-white cursor-pointer"
                          >
                            Reset Pan
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleToggleFullscreen}
                        aria-label="Toggle Fullscreen"
                        className="rounded border border-slate-700 p-1.5 text-slate-300 hover:text-white cursor-pointer"
                      >
                        {isFullscreen ? (
                          <Minimize2 className="h-3.5 w-3.5" />
                        ) : (
                          <Maximize2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right 4 cols: Live Telemetry + Interactive Visualization Switcher + Frame Inspector */}
              <div className="lg:col-span-4 space-y-4">
                <div className="rounded-lg border border-slate-800 bg-[#07090E] p-4 space-y-3">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-cyan-400">
                    Active Observation Telemetry
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Frame Sequence</span>
                      <span className="font-mono font-semibold text-white tabular-nums">
                        #{activeFrame.frameIndex + 1} of {frameCount}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Observation ID</span>
                      <span className="font-mono text-slate-200 truncate">
                        {activeFrame.observation.obsId}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">UTC Date</span>
                      <span className="font-mono text-cyan-300 tabular-nums">
                        {activeFrame.epochMeta.obsDateIso
                          ? activeFrame.epochMeta.obsDateIso.replace('T', ' ').slice(0, 19) + 'Z'
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">MJD / Exposure</span>
                      <span className="font-mono text-slate-300 tabular-nums">
                        {activeFrame.epochMeta.mjdObs?.toFixed(4) ?? 'N/A'} ·{' '}
                        {activeFrame.epochMeta.exptimeSec?.toFixed(1) ?? 'N/A'}s
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Sky Noise / ZODI</span>
                      <span className="font-mono text-slate-300 tabular-nums">
                        σ={activeFrame.epochMeta.skyNoiseSigma.toFixed(4)} ·{' '}
                        {activeFrame.epochMeta.zodiMedian !== null
                          ? `${activeFrame.epochMeta.zodiMedian.toFixed(2)} MJy/sr`
                          : 'No ZODI'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setInspectedObs(activeFrame.observation)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Inspect Original FITS
                    </button>
                    <a
                      href={`/api/fits/download?id=${encodeURIComponent(activeFrame.observation.id)}&mode=full`}
                      download={activeFrame.observation.fitsFilename}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-500/60"
                    >
                      <Download className="h-3.5 w-3.5" />
                      FITS
                    </a>
                  </div>
                </div>

                {/* Live Playback Mode & Overlay Switcher */}
                <div className="rounded-lg border border-slate-800 bg-[#07090E] p-4 space-y-3">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-cyan-400">
                    Visualization &amp; Timing Controls
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Animation Mode
                      </label>
                      <select
                        value={settings.visualizationMode}
                        onChange={(e) =>
                          onUpdateSettings({
                            visualizationMode: e.target
                              .value as TimelapseCustomSettings['visualizationMode'],
                          })
                        }
                        className="w-full rounded border border-slate-700 bg-[#0B0E17] px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                      >
                        <option value="original_sequence">Original Sequence (Direct Frames)</option>
                        <option value="smooth_crossfade">Smooth Crossfade Transitions</option>
                        <option value="before_after_transitions">Before-and-After Wipe Transition</option>
                        <option value="animated_difference_map">Animated Difference Map (ΔFlux)</option>
                        <option value="brightness_change">Brightness Change Significance Mask (±3σ)</option>
                        <option value="source_appear_disappear">Highlighted Source Appearance &amp; Disappearance</option>
                        <option value="side_by_side_comparison">Side-by-Side (Baseline vs Current)</option>
                      </select>
                    </div>

                    <div>
                      <label className="flex justify-between text-[11px] text-slate-400 mb-1">
                        <span>Frame Hold Duration</span>
                        <span className="font-mono text-cyan-300 tabular-nums">
                          {settings.frameDurationSec.toFixed(1)}s
                        </span>
                      </label>
                      <input
                        type="range"
                        min={0.5}
                        max={4.0}
                        step={0.1}
                        value={settings.frameDurationSec}
                        onChange={(e) =>
                          onUpdateSettings({ frameDurationSec: Number(e.target.value) })
                        }
                        className="w-full accent-cyan-400"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-300">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.showDates}
                          onChange={(e) => onUpdateSettings({ showDates: e.target.checked })}
                          className="accent-cyan-400"
                        />
                        Observation Dates
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.showCoordinates}
                          onChange={(e) => onUpdateSettings({ showCoordinates: e.target.checked })}
                          className="accent-cyan-400"
                        />
                        RA / DEC Coords
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.showDetectorInfo}
                          onChange={(e) =>
                            onUpdateSettings({ showDetectorInfo: e.target.checked })
                          }
                          className="accent-cyan-400"
                        />
                        Detector &amp; Band
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.showAnnotations}
                          onChange={(e) => onUpdateSettings({ showAnnotations: e.target.checked })}
                          className="accent-cyan-400"
                        />
                        Change Brackets
                      </label>
                    </div>
                  </div>
                </div>

                {/* Secondary Downloads */}
                <div className="rounded-lg border border-slate-800 bg-[#07090E] p-4 space-y-2">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
                    Scientific Exports
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadDifferenceMapPng}
                      disabled={decodedPairs.length === 0}
                      className="inline-flex items-center justify-center gap-1.5 rounded border border-slate-700 bg-[#0B0E17] px-2.5 py-2 text-xs text-slate-200 hover:border-cyan-500/60 disabled:opacity-45 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-cyan-400" />
                      Diff Map PNG
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadReport}
                      className="inline-flex items-center justify-center gap-1.5 rounded border border-slate-700 bg-[#0B0E17] px-2.5 py-2 text-xs text-slate-200 hover:border-cyan-500/60 cursor-pointer"
                    >
                      <FileText className="h-3.5 w-3.5 text-cyan-400" />
                      Report (.md)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* EXPORTED MP4 VIDEO PREVIEW TAB */
          <div className="p-6">
            {exportingMp4 ? (
              <div className="py-16 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                <p className="mt-4 text-sm font-semibold text-white">
                  Encoding H.264 MP4 Video Stream via FFmpeg...
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Rendering calibrated FITS frames, HUD telemetry overlays, and timeline progression.
                </p>
              </div>
            ) : exportError ? (
              <div className="rounded border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200">
                <strong className="text-rose-300">MP4 Render Error: </strong>
                {exportError}
              </div>
            ) : exportedVideo && exportedVideo.verifiedOnDisk ? (
              <div className="space-y-4">
                <div className="flex justify-center rounded-lg border border-slate-800 bg-[#05070B] p-3">
                  <video
                    key={exportedVideo.exportId}
                    src={exportedVideo.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[540px] w-auto max-w-full rounded"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 rounded border border-slate-800 bg-[#07090E] px-4 py-3 text-xs font-mono text-slate-300 tabular-nums">
                  <div>
                    MP4 Verified on Disk · {exportedVideo.width}×{exportedVideo.height} ·{' '}
                    {exportedVideo.fps} fps · {exportedVideo.durationSec}s ·{' '}
                    {(exportedVideo.fileSizeBytes / 1024).toFixed(1)} KB · {exportedVideo.codec}
                    {exportedVideo.hasAudio ? ' · Audio Track Included' : ' · Silent'}
                  </div>
                  <a
                    href={exportedVideo.downloadUrl}
                    download={`beyond-space-timelapse-${s.detector.id}-${exportedVideo.exportId}.mp4`}
                    className="inline-flex items-center gap-1.5 rounded bg-emerald-500 px-3.5 py-1.5 font-sans text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download MP4 ({(exportedVideo.fileSizeBytes / 1024).toFixed(0)} KB)
                  </a>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                Click <strong>Re-Render MP4 with Current Settings</strong> above to encode and preview the MP4 video before downloading.
              </div>
            )}
          </div>
        )}
      </div>

      {/* SCIENTIFIC INTERPOLATION & SKIPPED FILES NOTICE */}
      <div className="rounded-lg border border-amber-500/35 bg-amber-950/20 p-4 text-xs text-amber-200 space-y-2">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">{s.interpolationDisclaimer}</p>
        </div>
        {prepared.skippedCorrupted.length > 0 && (
          <div className="border-t border-amber-500/25 pt-2 text-[11px] text-amber-100/90">
            <strong>Skipped Observations ({prepared.skippedCorrupted.length}): </strong>
            {prepared.skippedCorrupted
              .map((sk) => `${sk.obsId} (${sk.reason})`)
              .join(' · ')}
          </div>
        )}
      </div>

      {/* VIDEO INFORMATION & SCIENTIFIC REPORT PANEL */}
      <div className="rounded-lg border border-slate-800 bg-[#0B0E17] p-6 space-y-6">
        <div className="border-b border-slate-800 pb-4">
          <div className="font-mono text-xs uppercase tracking-wider text-cyan-400">
            Scientific Provenance &amp; Multi-Epoch Report
          </div>
          <h3 className="mt-1 font-display text-xl font-bold text-white">
            Video Telemetry &amp; Consecutive Change Analysis
          </h3>
          <p className="mt-1 text-sm text-slate-300">{s.changeSummary.headline}</p>
        </div>

        {/* Summary Metrics Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded border border-slate-800 bg-[#07090E] p-3.5 space-y-1">
            <div className="text-slate-400">Sky Region &amp; Detector</div>
            <div className="font-mono font-semibold text-white tabular-nums">
              RA {s.region.ra.toFixed(4)}°, DEC {s.region.dec.toFixed(4)}°
            </div>
            <div className="font-mono text-[11px] text-cyan-300">
              {SPHEREX_DETECTORS[s.detector.id].label} · {s.detector.wavelengthRangeLabel}
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-[#07090E] p-3.5 space-y-1">
            <div className="text-slate-400">Observations &amp; Coverage</div>
            <div className="font-mono font-semibold text-white tabular-nums">
              {s.preparedFrameCount} Frames Prepared ({s.selectedCount} selected)
            </div>
            <div className="font-mono text-[11px] text-slate-400 tabular-nums">
              {s.totalMatchingArchiveRecords} matching archive records · Cutout {s.region.cutoutSizeDeg}°
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-[#07090E] p-3.5 space-y-1">
            <div className="text-slate-400">Chronological Span</div>
            <div className="font-mono font-semibold text-cyan-300 tabular-nums">
              {s.totalTimeSpanLabel}
            </div>
            <div className="font-mono text-[11px] text-slate-400 tabular-nums">
              {s.firstObservationDate?.slice(0, 10) ?? 'N/A'} →{' '}
              {s.lastObservationDate?.slice(0, 10) ?? 'N/A'} (UTC)
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-[#07090E] p-3.5 space-y-1">
            <div className="text-slate-400">Shared Flux Scaling</div>
            <div className="font-mono font-semibold text-white tabular-nums">
              [{s.sharedNormalization.vmin}, {s.sharedNormalization.vmax}] {s.sharedNormalization.bunit}
            </div>
            <div className="text-[11px] text-slate-400">
              Global fixed asinh stretch (zero per-frame gain)
            </div>
          </div>
        </div>

        {/* Detected Change Breakdown */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
          <div className="rounded border border-slate-800 bg-[#07090E] p-3">
            <div className="text-slate-400">Brightening</div>
            <div className="mt-1 font-mono text-lg font-bold text-emerald-300 tabular-nums">
              {s.changeSummary.brighteningEvents}
            </div>
          </div>
          <div className="rounded border border-slate-800 bg-[#07090E] p-3">
            <div className="text-slate-400">Dimming</div>
            <div className="mt-1 font-mono text-lg font-bold text-amber-300 tabular-nums">
              {s.changeSummary.dimmingEvents}
            </div>
          </div>
          <div className="rounded border border-slate-800 bg-[#07090E] p-3">
            <div className="text-slate-400">New / Missing Sources</div>
            <div className="mt-1 font-mono text-lg font-bold text-cyan-300 tabular-nums">
              +{s.changeSummary.newSources} / -{s.changeSummary.disappearedSources}
            </div>
          </div>
          <div className="rounded border border-slate-800 bg-[#07090E] p-3">
            <div className="text-slate-400">Genuine Candidates</div>
            <div className="mt-1 font-mono text-lg font-bold text-emerald-300 tabular-nums">
              {s.changeSummary.genuineCandidates}
            </div>
          </div>
          <div className="rounded border border-slate-800 bg-[#07090E] p-3">
            <div className="text-slate-400">Probable Artifacts</div>
            <div className="mt-1 font-mono text-lg font-bold text-rose-300 tabular-nums">
              {s.changeSummary.probableArtifacts}
            </div>
          </div>
          <div className="rounded border border-slate-800 bg-[#07090E] p-3">
            <div className="text-slate-400">Uncertain / Noise</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-200 tabular-nums">
              {s.changeSummary.uncertainEvents}
            </div>
          </div>
        </div>

        {/* Clickable Chronological Frames & FITS Downloads */}
        <div>
          <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
            Included Chronological Frames (Click to Inspect Original FITS Observation)
          </h4>
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#07090E] font-mono text-[11px] text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2">Frame</th>
                  <th className="px-3 py-2">UTC Observation Time</th>
                  <th className="px-3 py-2">Observation ID</th>
                  <th className="px-3 py-2">Band / Release</th>
                  <th className="px-3 py-2">Valid Pixels</th>
                  <th className="px-3 py-2 text-right">Original FITS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 bg-[#0B0E17]">
                {prepared.frames.map((f) => (
                  <tr key={f.observation.id} className="hover:bg-[#0F1422]">
                    <td className="px-3 py-2 font-mono font-semibold text-cyan-300 tabular-nums">
                      #{f.frameIndex + 1}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-200 tabular-nums">
                      {f.epochMeta.obsDateIso?.replace('T', ' ').replace('.000Z', ' UTC') ?? 'N/A'}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300">{f.observation.obsId}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">
                      {f.observation.bandpassName} · {f.observation.dataRelease}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300 tabular-nums">
                      {(f.epochMeta.validPixelFraction * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setInspectedObs(f.observation)}
                        className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
                      >
                        Inspect FITS
                      </button>
                      <a
                        href={`/api/fits/download?id=${encodeURIComponent(f.observation.id)}&mode=full`}
                        download={f.observation.fitsFilename}
                        className="inline-block rounded border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-cyan-500/50"
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Consecutive Detected Change Events */}
        {allChangesWithPair.length > 0 && (
          <div>
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Consecutive Transition Change Detections ({allChangesWithPair.length})
            </h4>
            <div className="overflow-x-auto rounded border border-slate-800 max-h-72">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#07090E] font-mono text-[11px] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2">Transition</th>
                    <th className="px-3 py-2">Polarity</th>
                    <th className="px-3 py-2">Scientific Classification</th>
                    <th className="px-3 py-2">Coordinates</th>
                    <th className="px-3 py-2">SNR</th>
                    <th className="px-3 py-2">Uncertainty / Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-[#0B0E17]">
                  {allChangesWithPair.slice(0, 30).map((item, i) => (
                    <tr key={`${item.transitionLabel}-${item.change.id}-${i}`}>
                      <td className="px-3 py-2 font-mono text-cyan-300 tabular-nums">
                        {item.transitionLabel} · {item.change.id}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-200">
                        {item.change.polarity.replace('_', ' ')}
                      </td>
                      <td className="px-3 py-2 text-slate-200">{item.change.classification}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-400 tabular-nums">
                        {item.change.centroidRa !== null && item.change.centroidDec !== null
                          ? `${item.change.centroidRa.toFixed(4)}°, ${item.change.centroidDec.toFixed(4)}°`
                          : `px (${item.change.pixelX}, ${item.change.pixelY})`}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-200 tabular-nums">
                        {item.change.integratedSnr >= 0 ? '+' : ''}
                        {item.change.integratedSnr}σ
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                        {item.change.confidenceLabel} ·{' '}
                        {item.change.activeFlags.length > 0
                          ? item.change.activeFlags.join(', ')
                          : 'Clean flags'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Limitations */}
        <div className="rounded border border-slate-800 bg-[#07090E] p-4 text-xs text-slate-300 space-y-1.5">
          <div className="font-semibold text-white">
            Methodology, Data Quality &amp; Scientific Limitations
          </div>
          <ul className="list-disc pl-5 space-y-1 text-slate-400">
            {s.qualityAndLimitations.map((lim, i) => (
              <li key={i}>{lim}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Original Observation FITS Inspector Modal */}
      {inspectedObs && (
        <FitsViewerModal
          observation={inspectedObs}
          searchRa={s.region.ra}
          searchDec={s.region.dec}
          onClose={() => setInspectedObs(null)}
        />
      )}
    </div>
  );
}
