import {
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  RotateCcw,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SPHEREX_DETECTORS,
  formatDecDms,
  formatRaHms,
  type FitsViewerPayload,
  type SpherexObservation,
} from '../../shared/astronomy';

type StretchMode = 'asinh' | 'linear' | 'log' | 'sqrt';
type ColormapMode = 'cyan_thermal' | 'grayscale' | 'inferno' | 'viridis' | 'coolwarm';

interface FitsViewerModalProps {
  observation: SpherexObservation;
  searchRa: number;
  searchDec: number;
  onClose: () => void;
}

function decodeBase64Float32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

function sampleColormap(t: number, cmap: ColormapMode): [number, number, number] {
  const c = Math.min(1, Math.max(0, t));
  if (cmap === 'grayscale') {
    const v = Math.round(c * 255);
    return [v, v, v];
  }
  if (cmap === 'cyan_thermal') {
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
  if (cmap === 'inferno') {
    if (c < 0.33) {
      const k = c / 0.33;
      return [Math.round(6 + k * 82), Math.round(4 + k * 14), Math.round(20 + k * 88)];
    }
    if (c < 0.68) {
      const k = (c - 0.33) / 0.35;
      return [Math.round(88 + k * 145), Math.round(18 + k * 75), Math.round(108 - k * 65)];
    }
    const k = (c - 0.68) / 0.32;
    return [Math.round(233 + k * 22), Math.round(93 + k * 158), Math.round(43 + k * 155)];
  }
  if (cmap === 'viridis') {
    if (c < 0.5) {
      const k = c / 0.5;
      return [Math.round(68 - k * 35), Math.round(1 + k * 142), Math.round(84 + k * 56)];
    }
    const k = (c - 0.5) / 0.5;
    return [Math.round(33 + k * 220), Math.round(143 + k * 88), Math.round(140 - k * 103)];
  }
  // coolwarm
  if (c < 0.5) {
    const k = c / 0.5;
    return [Math.round(30 + k * 195), Math.round(70 + k * 155), Math.round(190 + k * 45)];
  }
  const k = (c - 0.5) / 0.5;
  return [Math.round(225 - k * 10), Math.round(225 - k * 175), Math.round(235 - k * 190)];
}

function applyStretch(norm: number, mode: StretchMode): number {
  const x = Math.min(1, Math.max(0, norm));
  switch (mode) {
    case 'linear':
      return x;
    case 'sqrt':
      return Math.sqrt(x);
    case 'log':
      return Math.log10(1 + 999 * x) / 3;
    case 'asinh': {
      const a = 0.08;
      return Math.asinh(x / a) / Math.asinh(1 / a);
    }
  }
}

export function FitsViewerModal({
  observation,
  searchRa,
  searchDec,
  onClose,
}: FitsViewerModalProps) {
  const detectorSpec = SPHEREX_DETECTORS[observation.detector];
  const modalRootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cutoutSizeDeg, setCutoutSizeDeg] = useState<number>(0.18);
  const [payload, setPayload] = useState<FitsViewerPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Visualization state (non-destructive)
  const [stretch, setStretch] = useState<StretchMode>('asinh');
  const [colormap, setColormap] = useState<ColormapMode>('cyan_thermal');
  const [blackPercentile, setBlackPercentile] = useState<number>(1);
  const [whitePercentile, setWhitePercentile] = useState<number>(99.5);
  const [zodiSubtract, setZodiSubtract] = useState<boolean>(false);
  const [showHeaders, setShowHeaders] = useState<boolean>(false);

  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Live probe readout under cursor
  const [probe, setProbe] = useState<{
    fitsX: number;
    fitsY: number;
    flux: number;
    zodi: number | null;
    ra: number | null;
    dec: number | null;
  } | null>(null);

  // Escape key closes modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Load real FITS data from backend
  const fetchFitsData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        id: observation.id,
        ra: String(searchRa),
        dec: String(searchDec),
        size: String(cutoutSizeDeg),
      });
      const resp = await fetch(`/api/fits/data?${params.toString()}`);
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json.error || `Failed to load FITS image (HTTP ${resp.status})`);
      }
      setPayload(json as FitsViewerPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to retrieve FITS data');
    } finally {
      setLoading(false);
    }
  }, [observation.id, searchRa, searchDec, cutoutSizeDeg]);

  useEffect(() => {
    fetchFitsData();
  }, [fetchFitsData]);

  // Decode Float32 buffers once per payload load
  const decodedArrays = useMemo(() => {
    if (!payload) return null;
    const image = decodeBase64Float32(payload.imageFloat32Base64);
    const zodi = payload.zodiFloat32Base64 ? decodeBase64Float32(payload.zodiFloat32Base64) : null;
    return { image, zodi };
  }, [payload]);

  // Active working pixels (either raw IMAGE or IMAGE - ZODI) + sorted valid values for fast percentile slicing
  const workingField = useMemo(() => {
    if (!payload || !decodedArrays) return null;
    const { width, height } = payload.stats;
    const len = width * height;
    const pixels = new Float32Array(len);
    const valid: number[] = [];

    for (let i = 0; i < len; i++) {
      let v = decodedArrays.image[i];
      if (zodiSubtract && decodedArrays.zodi) {
        const z = decodedArrays.zodi[i];
        v = Number.isFinite(v) && Number.isFinite(z) ? v - z : Number.NaN;
      }
      pixels[i] = v;
      if (Number.isFinite(v)) {
        valid.push(v);
      }
    }
    valid.sort((a, b) => a - b);
    return { pixels, valid, width, height };
  }, [payload, decodedArrays, zodiSubtract]);

  // Render stretched scientific ImageData onto an offscreen canvas whenever stretch/cmap/clip changes
  useEffect(() => {
    if (!workingField) return;
    const { pixels, valid, width, height } = workingField;
    if (width === 0 || height === 0) return;

    let offscreen = offscreenCanvasRef.current;
    if (!offscreen) {
      offscreen = document.createElement('canvas');
      offscreenCanvasRef.current = offscreen;
    }
    offscreen.width = width;
    offscreen.height = height;

    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(width, height);
    const q = (pct: number) => {
      if (valid.length === 0) return 0;
      const idx = Math.min(
        valid.length - 1,
        Math.max(0, Math.floor(((valid.length - 1) * pct) / 100))
      );
      return valid[idx];
    };

    const vmin = q(Math.min(blackPercentile, whitePercentile - 0.1));
    const vmax = q(Math.max(whitePercentile, blackPercentile + 0.1));
    const range = vmax - vmin > 1e-12 ? vmax - vmin : 1;

    for (let fy = 0; fy < height; fy++) {
      const cy = height - 1 - fy; // Standard FITS Y-flip (North up)
      for (let fx = 0; fx < width; fx++) {
        const val = pixels[fy * width + fx];
        let r = 7;
        let g = 9;
        let b = 14;
        if (Number.isFinite(val)) {
          const norm = (val - vmin) / range;
          const stretched = applyStretch(norm, stretch);
          [r, g, b] = sampleColormap(stretched, colormap);
        }
        const idx = (cy * width + fx) * 4;
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [workingField, stretch, colormap, blackPercentile, whitePercentile]);

  // Compute Fit-to-Screen zoom when payload changes
  const fitToScreen = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !payload) return;
    const rect = vp.getBoundingClientRect();
    const { width, height } = payload.stats;
    if (width === 0 || height === 0) return;
    const pad = 40;
    const scaleX = (rect.width - pad) / width;
    const scaleY = (rect.height - pad) / height;
    setZoom(Math.max(0.5, Math.min(scaleX, scaleY)));
    setPan({ x: 0, y: 0 });
  }, [payload]);

  useEffect(() => {
    if (payload) {
      fitToScreen();
    }
  }, [payload, fitToScreen]);

  // Redraw display canvas whenever zoom, pan, or offscreen pixels update
  const drawViewport = useCallback(() => {
    const canvas = displayCanvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !offscreen || !vp) return;

    const rect = vp.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070B';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Crisp pixel edges when zooming in so scientific pixels never look blurry
    ctx.imageSmoothingEnabled = zoom < 1.2;

    const drawW = offscreen.width * zoom;
    const drawH = offscreen.height * zoom;
    const dx = rect.width / 2 - drawW / 2 + pan.x;
    const dy = rect.height / 2 - drawH / 2 + pan.y;

    ctx.drawImage(offscreen, dx, dy, drawW, drawH);

    // Subtle 1px frame around active FITS region
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx - 0.5, dy - 0.5, drawW + 1, drawH + 1);
  }, [zoom, pan]);

  useEffect(() => {
    drawViewport();
  }, [drawViewport, workingField, stretch, colormap, blackPercentile, whitePercentile]);

  useEffect(() => {
    const onResize = () => drawViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawViewport]);

  // Mouse pan & pixel coordinate WCS probe
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
      return;
    }

    if (!workingField || !payload || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const { width, height } = workingField;
    const drawW = width * zoom;
    const drawH = height * zoom;
    const originX = rect.width / 2 - drawW / 2 + pan.x;
    const originY = rect.height / 2 - drawH / 2 + pan.y;

    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const fx = Math.floor((cx - originX) / zoom);
    const canvasY = Math.floor((cy - originY) / zoom);
    const fy = height - 1 - canvasY;

    if (fx < 0 || fx >= width || fy < 0 || fy >= height) {
      setProbe(null);
      return;
    }

    const idx = fy * width + fx;
    const flux = workingField.pixels[idx];
    const zodi = decodedArrays?.zodi ? decodedArrays.zodi[idx] : null;

    let ra: number | null = null;
    let dec: number | null = null;
    if (payload.wcs) {
      const { crval1, crval2, crpix1, crpix2, cd1_1, cd1_2, cd2_1, cd2_2 } = payload.wcs;
      const u = fx + 1 - crpix1;
      const v = fy + 1 - crpix2;
      const dRa = cd1_1 * u + cd1_2 * v;
      const dDec = cd2_1 * u + cd2_2 * v;
      const cosDec = Math.cos((crval2 * Math.PI) / 180) || 1;
      ra = (((crval1 + dRa / cosDec) % 360) + 360) % 360;
      dec = Math.max(-90, Math.min(90, crval2 + dDec));
    }

    setProbe({
      fitsX: fx + 1,
      fitsY: fy + 1,
      flux,
      zodi,
      ra,
      dec,
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    setZoom((z) => Math.max(0.25, Math.min(40, z * factor)));
  };

  const handleDownloadPng = () => {
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;
    const url = offscreen.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${observation.obsId}_${observation.detector}_${stretch}_${colormap}.png`;
    a.click();
  };

  const toggleFullscreen = async () => {
    if (!modalRootRef.current) return;
    if (!document.fullscreenElement) {
      await modalRootRef.current.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  };

  return (
    <div
      ref={modalRootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`SPHEREx FITS Image Viewer for ${observation.obsId}`}
      className="fixed inset-0 z-50 flex flex-col bg-[#05070B]/95 backdrop-blur-sm"
    >
      {/* Top Viewer Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-[#090D16] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-mono font-semibold text-cyan-400">{detectorSpec.label}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{observation.dataRelease}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{observation.obsDateIso || 'Timestamp unavailable'}</span>
          </div>
          <h2 className="truncate font-display text-base font-semibold text-white sm:text-lg">
            {observation.obsId}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(40, z * 1.35))}
            title="Zoom In"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white cursor-pointer"
          >
            <ZoomIn className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Zoom In</span>
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, z / 1.35))}
            title="Zoom Out"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white cursor-pointer"
          >
            <ZoomOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Zoom Out</span>
          </button>
          <button
            type="button"
            onClick={fitToScreen}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white cursor-pointer"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white cursor-pointer"
          >
            1:1
          </button>
          <button
            type="button"
            onClick={fitToScreen}
            title="Reset Zoom & Pan"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Image Viewer"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 cursor-pointer"
          >
            <X className="h-4 w-4" />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* Main Split Console: Left/Center Scientific Canvas + Right Inspector */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Canvas Viewport */}
        <div
          ref={viewportRef}
          className="relative min-h-[340px] flex-1 overflow-hidden bg-[#05070B]"
        >
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#05070B]/90">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
              <div className="text-sm font-medium text-slate-200">
                Retrieving SPHEREx FITS cutout from NASA/IPAC IRSA...
              </div>
              <div className="font-mono text-xs text-slate-400">
                Center ({searchRa.toFixed(4)}°, {searchDec.toFixed(4)}°) · Size {cutoutSizeDeg}°
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="max-w-md rounded-lg border border-rose-500/40 bg-rose-950/30 p-5">
                <div className="text-sm font-semibold text-rose-300">
                  Unable to Process FITS Image
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">{error}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={fetchFitsData}
                    className="rounded bg-cyan-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 cursor-pointer"
                  >
                    Retry Cutout
                  </button>
                  <a
                    href={`/api/fits/download?id=${encodeURIComponent(observation.id)}&mode=full`}
                    className="rounded border border-slate-700 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500"
                  >
                    Download Original FITS
                  </a>
                </div>
              </div>
            </div>
          )}

          <canvas
            ref={displayCanvasRef}
            onMouseDown={(e) => {
              setIsDragging(true);
              dragStartRef.current = {
                x: e.clientX,
                y: e.clientY,
                panX: pan.x,
                panY: pan.y,
              };
            }}
            onMouseUp={() => {
              setIsDragging(false);
              dragStartRef.current = null;
            }}
            onMouseLeave={() => {
              setIsDragging(false);
              dragStartRef.current = null;
              setProbe(null);
            }}
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
            className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
          />

          {/* Live HUD Readout */}
          {payload && (
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-[#07090E]/90 px-3 py-2 font-mono text-[11px] text-slate-300 tabular-nums">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Zoom <strong className="text-cyan-400">{(zoom * 100).toFixed(0)}%</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Cutout {payload.stats.width}×{payload.stats.height} px
                </span>
                <span aria-hidden="true">·</span>
                <span>Drag to pan · Scroll to zoom</span>
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
                    Flux:{' '}
                    {Number.isFinite(probe.flux)
                      ? `${probe.flux.toExponential(3)} ${payload.stats.bunit}`
                      : 'Masked/NaN'}
                  </span>
                  {probe.zodi !== null && Number.isFinite(probe.zodi) && (
                    <span className="text-slate-400">Zodi: {probe.zodi.toFixed(4)}</span>
                  )}
                </div>
              ) : (
                <div className="text-slate-400">
                  Median {payload.stats.median.toFixed(4)} {payload.stats.bunit}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Scientific Controls & Metadata Panel */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-slate-800 bg-[#0B0E17] p-5 lg:w-[390px] lg:border-t-0 lg:border-l">
          {/* Visualization Stretch Controls */}
          <div className="border-b border-slate-800 pb-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-300 uppercase">
                <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
                Scientific Display Stretch
              </h3>
              <button
                type="button"
                onClick={() => {
                  setStretch('asinh');
                  setColormap('cyan_thermal');
                  setBlackPercentile(1);
                  setWhitePercentile(99.5);
                  setZodiSubtract(false);
                }}
                className="text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                Auto Scale
              </button>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1 rounded bg-[#07090E] p-1 border border-slate-800">
              {(['asinh', 'linear', 'log', 'sqrt'] as StretchMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setStretch(m)}
                  className={`rounded py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                    stretch === m
                      ? 'bg-cyan-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Colormap
              </label>
              <div className="mt-1.5 grid grid-cols-5 gap-1">
                {(
                  [
                    ['cyan_thermal', 'Cyan'],
                    ['grayscale', 'Gray'],
                    ['inferno', 'Inferno'],
                    ['viridis', 'Viridis'],
                    ['coolwarm', 'Coolwarm'],
                  ] as [ColormapMode, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setColormap(id)}
                    className={`rounded border py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      colormap === id
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300'
                        : 'border-slate-800 bg-[#07090E] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Black Clip Percentile</span>
                  <span className="font-mono text-slate-200 tabular-nums">{blackPercentile}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={0.5}
                  value={blackPercentile}
                  onChange={(e) => setBlackPercentile(Number(e.target.value))}
                  className="mt-1 w-full accent-cyan-400"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">White Clip Percentile</span>
                  <span className="font-mono text-slate-200 tabular-nums">{whitePercentile}%</span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={100}
                  step={0.1}
                  value={whitePercentile}
                  onChange={(e) => setWhitePercentile(Number(e.target.value))}
                  className="mt-1 w-full accent-cyan-400"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={zodiSubtract}
                  disabled={!payload?.stats.hasZodi}
                  onChange={(e) => setZodiSubtract(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 accent-cyan-400"
                />
                <span>Subtract ZODI Model (HDU 4)</span>
              </label>

              <div className="flex items-center gap-1">
                {[0.1, 0.18, 0.3].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setCutoutSizeDeg(sz)}
                    className={`rounded border px-2 py-0.5 font-mono text-[11px] cursor-pointer ${
                      cutoutSizeDeg === sz
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300'
                        : 'border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sz}°
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Downloads */}
          <div className="border-b border-slate-800 py-4 space-y-2">
            <div className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Data Export
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <a
                href={`/api/fits/download?id=${encodeURIComponent(observation.id)}&mode=full`}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download Original FITS ({observation.estSizeKb ? `${(observation.estSizeKb / 1024).toFixed(1)} MB` : 'MEF'})
              </a>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`/api/fits/download?id=${encodeURIComponent(observation.id)}&mode=cutout&ra=${searchRa}&dec=${searchDec}&size=${cutoutSizeDeg}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  Cutout FITS
                </a>
                <button
                  type="button"
                  onClick={handleDownloadPng}
                  disabled={!payload}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white disabled:opacity-40 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Preview PNG
                </button>
              </div>
            </div>
          </div>

          {/* Scientific Metadata Table */}
          <div className="py-4">
            <div className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Observation Metadata
            </div>
            <dl className="mt-3 divide-y divide-slate-800/70 text-xs">
              {[
                ['Detector Name', `${detectorSpec.label} (${observation.bandpassName})`],
                ['Focal Plane', detectorSpec.focalPlane],
                ['Observation Date (UTC)', observation.obsDateIso || 'Not available'],
                [
                  'Observation MJD',
                  observation.tMinMjd !== null ? observation.tMinMjd.toFixed(6) : 'Not available',
                ],
                [
                  'Exposure Center RA',
                  `${observation.ra.toFixed(6)}° (${formatRaHms(observation.ra)})`,
                ],
                [
                  'Exposure Center DEC',
                  `${observation.dec.toFixed(6)}° (${formatDecDms(observation.dec)})`,
                ],
                [
                  'Wavelength Band',
                  observation.wavelengthMinUm !== null && observation.wavelengthMaxUm !== null
                    ? `${observation.wavelengthMinUm.toFixed(3)} – ${observation.wavelengthMaxUm.toFixed(3)} µm`
                    : detectorSpec.wavelengthRangeLabel,
                ],
                ['Observation ID', observation.obsId],
                ['Data Release', `${observation.dataRelease} (${observation.collection})`],
                ['Processing Version', observation.processingVersion],
                ['Archive Release Date', observation.obsReleaseDate || 'Not available'],
                [
                  'Integration Time',
                  observation.exptimeSec !== null
                    ? `${observation.exptimeSec.toFixed(2)} s`
                    : 'Not available',
                ],
                ['Original Filename', observation.fitsFilename],
                ['Source Archive', 'NASA/IPAC IRSA (SIA2 & IBE)'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 py-2">
                  <dt className="text-slate-400 shrink-0">{k}</dt>
                  <dd className="text-right font-mono text-slate-100 break-all tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <a
                href={observation.accessUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                Direct IRSA FITS URL
                <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={observation.archiveSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
              >
                IRSA SIA2 Query Record
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {payload && (
              <div className="mt-5 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setShowHeaders((s) => !s)}
                  className="text-xs font-medium text-cyan-400 hover:text-cyan-300 cursor-pointer"
                >
                  {showHeaders
                    ? 'Hide Raw FITS Header Cards'
                    : `Inspect Raw FITS Headers (${payload.headers.image.length} IMAGE cards)`}
                </button>
                {showHeaders && (
                  <div className="mt-3 max-h-64 overflow-y-auto rounded border border-slate-800 bg-[#07090E] p-2.5 font-mono text-[11px] leading-relaxed">
                    {payload.headers.image.slice(0, 80).map((card, i) => (
                      <div key={`${card.key}-${i}`} className="truncate text-slate-300">
                        <span className="text-cyan-400">{card.key.padEnd(10, ' ')}</span> ={' '}
                        <span className="text-slate-100">{card.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
