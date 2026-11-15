import {
  AlertCircle,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Download,
  ExternalLink,
  Eye,
  GitCompare,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DETECTOR_IDS,
  SPHEREX_DETECTORS,
  VERIFIED_SKY_PRESETS,
  formatDecDms,
  formatRaHms,
  parseDeclination,
  parseRightAscension,
  validateSearchRadius,
  type DateFilterMode,
  type DetectorFilterMode,
  type DetectorId,
  type SearchResponse,
  type SpherexObservation,
} from '../../shared/astronomy';
import { FitsViewerModal } from './FitsViewerModal';

interface SkyExplorerProps {
  initialDetector?: DetectorFilterMode;
  initialRa?: number;
  initialDec?: number;
  initialRadius?: number;
  onSearchComplete?: (res: SearchResponse) => void;
  compareQueueIds?: Set<string>;
  onToggleCompare?: (obs: SpherexObservation) => void;
  onOpenComparison?: () => void;
}

function ObservationCard({
  obs,
  searchRa,
  searchDec,
  onInspect,
  isQueuedForCompare = false,
  onToggleCompare,
}: {
  obs: SpherexObservation;
  searchRa: number;
  searchDec: number;
  onInspect: (obs: SpherexObservation) => void;
  isQueuedForCompare?: boolean;
  onToggleCompare?: (obs: SpherexObservation) => void;
}) {
  const [imgState, setImgState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryNonce, setRetryNonce] = useState(0);

  const previewUrl = `/api/fits/preview?id=${encodeURIComponent(obs.id)}&ra=${searchRa}&dec=${searchDec}&size=0.12&stretch=asinh&cmap=cyan_thermal&r=${retryNonce}`;

  return (
    <article className="flex flex-col justify-between overflow-hidden rounded-lg border border-slate-800 bg-[#0B0E17] hover:border-slate-700 transition-colors">
      <div>
        {/* Real Scientific FITS Preview */}
        <div
          onClick={() => onInspect(obs)}
          className="group relative aspect-square w-full cursor-pointer overflow-hidden bg-[#05070B] border-b border-slate-800"
        >
          {imgState === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#07090E] text-slate-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500/70 border-t-transparent" />
              <span className="font-mono text-[11px]">Rendering FITS cutout...</span>
            </div>
          )}

          {imgState === 'error' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-[#07090E]">
              <span className="text-xs font-medium text-slate-400">
                IRSA cutout temporarily busy
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setImgState('loading');
                  setRetryNonce((n) => n + 1);
                }}
                className="rounded border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-cyan-400 hover:border-cyan-500 cursor-pointer"
              >
                Retry FITS Preview
              </button>
            </div>
          ) : (
            <img
              src={previewUrl}
              alt={`SPHEREx ${obs.detector} observation ${obs.obsId} at RA ${obs.ra.toFixed(3)}, DEC ${obs.dec.toFixed(3)}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={() => setImgState('loaded')}
              onError={() => setImgState('error')}
              className={`h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03] ${
                imgState === 'loaded' ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-[#05070B]/90 via-[#05070B]/40 to-transparent px-3 py-2 text-[11px] font-mono text-slate-200">
            <span>{obs.bandpassName}</span>
            <span>{obs.collection.replace('spherex_', '').toUpperCase()}</span>
          </div>
        </div>

        {/* Unboxed Clean Metadata */}
        <div className="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="truncate font-mono text-sm font-semibold text-white" title={obs.obsId}>
              {obs.obsId}
            </h4>
          </div>

          <div className="mt-2 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Observed</span>
              <span className="font-mono text-cyan-300 tabular-nums">
                {obs.obsDateIso ? obs.obsDateIso.replace('T', ' ').replace('.000Z', ' UTC') : 'Not available'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Center</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {obs.ra.toFixed(4)}°, {obs.dec.toFixed(4)}°
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Bandpass</span>
              <span className="font-mono text-slate-300 tabular-nums">
                {obs.wavelengthMinUm !== null && obs.wavelengthMaxUm !== null
                  ? `${obs.wavelengthMinUm.toFixed(2)}–${obs.wavelengthMaxUm.toFixed(2)} µm`
                  : SPHEREX_DETECTORS[obs.detector].wavelengthRangeLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Release</span>
              <span className="font-mono text-slate-400">{obs.dataRelease}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 bg-[#090D16] px-4 py-2.5">
        <button
          type="button"
          onClick={() => onInspect(obs)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 cursor-pointer"
        >
          <Eye className="h-3.5 w-3.5" />
          Inspect Image
        </button>

        <div className="flex items-center gap-2.5">
          {onToggleCompare && (
            <button
              type="button"
              onClick={() => onToggleCompare(obs)}
              title={isQueuedForCompare ? 'Remove from Space Comparison' : 'Add to Space Comparison'}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                isQueuedForCompare
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                  : 'border border-slate-700 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-300'
              }`}
            >
              {isQueuedForCompare ? (
                <>
                  <Check className="h-3 w-3" />
                  <span>Queued</span>
                </>
              ) : (
                <>
                  <Plus className="h-3 w-3" />
                  <span>Compare</span>
                </>
              )}
            </button>
          )}
          <a
            href={`/api/fits/download?id=${encodeURIComponent(obs.id)}&mode=full`}
            title="Download original FITS file"
            className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" />
            <span>FITS</span>
          </a>
          <a
            href={obs.archiveSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Verify source query in IRSA SIA2"
            className="inline-flex items-center text-slate-400 hover:text-slate-200"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

function DetectorGallerySection({
  detectorId,
  observations,
  totalForDetectorAllDates,
  dateMode,
  specificDate,
  searchRa,
  searchDec,
  onInspect,
  compareQueueIds,
  onToggleCompare,
  collapsible = false,
  defaultExpanded = true,
}: {
  detectorId: DetectorId;
  observations: SpherexObservation[];
  totalForDetectorAllDates: number;
  dateMode: DateFilterMode;
  specificDate: string;
  searchRa: number;
  searchDec: number;
  onInspect: (obs: SpherexObservation) => void;
  compareQueueIds?: Set<string>;
  onToggleCompare?: (obs: SpherexObservation) => void;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}) {
  const spec = SPHEREX_DETECTORS[detectorId];
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);

  useEffect(() => {
    setPage(1);
  }, [observations.length, dateMode, specificDate, detectorId]);

  const totalPages = Math.max(1, Math.ceil(observations.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const sliceStart = (safePage - 1) * pageSize;
  const visibleObs = observations.slice(sliceStart, sliceStart + pageSize);

  return (
    <section className="rounded-lg border border-slate-800 bg-[#090D16] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h3 className="font-display text-lg font-semibold text-white">{spec.label}</h3>
            <span className="font-mono text-xs text-cyan-400">{spec.wavelengthRangeLabel}</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="text-xs text-slate-400">{spec.focalPlane}</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono text-xs text-slate-400">{spec.spectralResolvingPower}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Showing{' '}
            <strong className="font-mono text-slate-200 tabular-nums">{observations.length}</strong>{' '}
            {dateMode === 'SPECIFIC'
              ? `observations on ${specificDate} (UTC) out of ${totalForDetectorAllDates} total for ${spec.shortLabel}`
              : `historical observations across all available dates (newest first)`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {observations.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Per page</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                aria-label={`Observations per page for ${spec.label}`}
                className="rounded border border-slate-700 bg-[#07090E] px-2 py-1 font-mono text-xs text-slate-200"
              >
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
                <option value={100}>100</option>
              </select>
            </div>
          )}

          {collapsible && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#07090E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 cursor-pointer"
            >
              {expanded ? (
                <>
                  <span>Collapse</span>
                  <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  <span>Expand ({observations.length})</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {(!collapsible || expanded) && (
        <div className="p-5">
          {observations.length === 0 ? (
            <div className="rounded-md border border-slate-800/90 bg-[#07090E] p-8 text-center">
              <div className="text-sm font-semibold text-slate-200">
                No Matching Observations in {spec.label}
              </div>
              <p className="mt-2 mx-auto max-w-lg text-xs leading-relaxed text-slate-400">
                {dateMode === 'SPECIFIC'
                  ? `No verified ${spec.bandpassName} exposures were collected on ${specificDate} (UTC) covering this sky coordinate. Switch to "All Available Dates" or choose another observation date.`
                  : `The NASA/IPAC IRSA SIA2 archive returned 0 released ${spec.bandpassName} observations covering (${searchRa.toFixed(4)}°, ${searchDec.toFixed(4)}°) within the search radius.`}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {visibleObs.map((obs) => (
                  <ObservationCard
                    key={obs.id}
                    obs={obs}
                    searchRa={searchRa}
                    searchDec={searchDec}
                    onInspect={onInspect}
                    isQueuedForCompare={compareQueueIds?.has(obs.id) ?? false}
                    onToggleCompare={onToggleCompare}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800/80 pt-4 text-xs text-slate-300">
                  <div className="font-mono tabular-nums text-slate-400">
                    Showing {sliceStart + 1}–{Math.min(sliceStart + pageSize, observations.length)}{' '}
                    of {observations.length} {spec.shortLabel} observations
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#07090E] px-3 py-1.5 font-medium text-slate-200 hover:border-slate-500 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </button>
                    <span className="px-2 font-mono tabular-nums">
                      Page {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#07090E] px-3 py-1.5 font-medium text-slate-200 hover:border-slate-500 disabled:opacity-40 cursor-pointer"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function SkyExplorer({
  initialDetector = 'D1',
  initialRa = 156.093,
  initialDec = -41.644,
  initialRadius = 0.1,
  onSearchComplete,
  compareQueueIds,
  onToggleCompare,
  onOpenComparison,
}: SkyExplorerProps) {
  const [raInput, setRaInput] = useState(String(initialRa));
  const [decInput, setDecInput] = useState(String(initialDec));
  const [radiusInput, setRadiusInput] = useState(String(initialRadius));

  const [detectorMode, setDetectorMode] = useState<DetectorFilterMode>(initialDetector);
  const [dateMode, setDateMode] = useState<DateFilterMode>('ALL');
  const [specificDate, setSpecificDate] = useState<string>('');
  const [forceRefresh, setForceRefresh] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [inspectedObs, setInspectedObs] = useState<SpherexObservation | null>(null);

  // Live coordinate validation
  const raValidation = useMemo(() => parseRightAscension(raInput), [raInput]);
  const decValidation = useMemo(() => parseDeclination(decInput), [decInput]);
  const radiusValidation = useMemo(() => validateSearchRadius(radiusInput), [radiusInput]);

  useEffect(() => {
    setDetectorMode(initialDetector);
  }, [initialDetector]);

  const executeSearch = useCallback(
    async (overrideRa?: number, overrideDec?: number, overrideRadius?: number, bypassCache = false) => {
      const raVal = overrideRa !== undefined ? overrideRa : raValidation.value;
      const decVal = overrideDec !== undefined ? overrideDec : decValidation.value;
      const radVal = overrideRadius !== undefined ? overrideRadius : radiusValidation.value;

      if (raVal === null || decVal === null || radVal === null) {
        return;
      }

      setLoading(true);
      setApiError(null);

      try {
        const params = new URLSearchParams({
          ra: String(raVal),
          dec: String(decVal),
          radius: String(radVal),
        });
        if (bypassCache || forceRefresh) {
          params.set('refresh', '1');
        }

        const resp = await fetch(`/api/search?${params.toString()}`);
        const json = await resp.json();
        if (!resp.ok) {
          throw new Error(json.error || `Archive query failed (HTTP ${resp.status})`);
        }
        const data = json as SearchResponse;
        setSearchResult(data);
        onSearchComplete?.(data);

        // If user is in SPECIFIC date mode and hasn't picked a valid date yet, keep user's chosen date (never auto-swap!)
        // Only prefill empty date input for convenience when switching to SPECIFIC if empty
      } catch (err) {
        setApiError(err instanceof Error ? err.message : 'Archive search request failed');
      } finally {
        setLoading(false);
      }
    },
    [raValidation.value, decValidation.value, radiusValidation.value, forceRefresh, onSearchComplete]
  );

  // Run initial live search on mount with default verified coordinates
  useEffect(() => {
    executeSearch(initialRa, initialDec, initialRadius, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!raValidation.valid || !decValidation.valid || !radiusValidation.valid) return;
    if (dateMode === 'SPECIFIC' && !specificDate) {
      setApiError('Please select a specific observation date (YYYY-MM-DD) or switch to All Available Dates.');
      return;
    }
    executeSearch(undefined, undefined, undefined, forceRefresh);
  };

  const applyPreset = (ra: number, dec: number, radius: number) => {
    setRaInput(String(ra));
    setDecInput(String(dec));
    setRadiusInput(String(radius));
    executeSearch(ra, dec, radius, forceRefresh);
  };

  // Strict Detector + Date Filtering
  const filteredByDetector = useMemo(() => {
    const empty: Record<DetectorId, SpherexObservation[]> = {
      D1: [],
      D2: [],
      D3: [],
      D4: [],
      D5: [],
      D6: [],
    };
    if (!searchResult) return empty;

    for (const det of DETECTOR_IDS) {
      const list = searchResult.byDetector[det] || [];
      if (dateMode === 'ALL') {
        empty[det] = list;
      } else {
        empty[det] = specificDate ? list.filter((o) => o.obsDateUtc === specificDate) : [];
      }
    }
    return empty;
  }, [searchResult, dateMode, specificDate]);

  // Exact counts for the active display header
  const activeCounts = useMemo(() => {
    if (!searchResult) {
      return { totalMatching: 0, retrieved: 0 };
    }
    if (detectorMode === 'ALL_DETECTORS') {
      const totalMatching = DETECTOR_IDS.reduce((s, d) => s + filteredByDetector[d].length, 0);
      return {
        totalMatching,
        retrieved: totalMatching,
      };
    }
    const list = filteredByDetector[detectorMode] || [];
    return {
      totalMatching: list.length,
      retrieved: list.length,
    };
  }, [searchResult, detectorMode, filteredByDetector]);

  // Available dates for the currently selected detector (or all detectors if ALL_DETECTORS)
  const availableDatesForSelection = useMemo(() => {
    if (!searchResult) return [];
    const set = new Set<string>();
    const targetDets = detectorMode === 'ALL_DETECTORS' ? DETECTOR_IDS : [detectorMode];
    for (const det of targetDets) {
      for (const obs of searchResult.byDetector[det] || []) {
        if (obs.obsDateUtc) set.add(obs.obsDateUtc);
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [searchResult, detectorMode]);

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100">
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="flex flex-col gap-3 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
              NASA/IPAC IRSA SIA2 · Live Archive Search
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-white">
              Sky Explorer
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Query real SPHEREx observations by celestial coordinates, isolate individual detectors
              D1–D6, and inspect FITS imagery across observation dates.
            </p>
          </div>
          {searchResult && (
            <div className="font-mono text-xs text-slate-400 text-left sm:text-right">
              <div>
                {searchResult.fromCache ? 'Cached metadata' : 'Live IRSA query'} ·{' '}
                {new Date(searchResult.retrievedAt).toLocaleTimeString()}
              </div>
              <button
                type="button"
                onClick={() => executeSearch(undefined, undefined, undefined, true)}
                disabled={loading}
                className="mt-1 inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                Refresh from IRSA Archive
              </button>
            </div>
          )}
        </div>

        {/* SEARCH CONSOLE */}
        <form
          onSubmit={handleSubmit}
          className="mt-6 rounded-lg border border-slate-800 bg-[#0B0E17] p-5 sm:p-6"
        >
          {/* Verified Presets Row */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-4">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mr-1">
              <Compass className="h-3.5 w-3.5 text-cyan-400" />
              Verified Sky Fields:
            </span>
            {VERIFIED_SKY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.ra, preset.dec, preset.radius)}
                title={preset.notes}
                className="rounded border border-slate-700/90 bg-[#07090E] px-2.5 py-1 text-xs text-slate-300 hover:border-cyan-500/60 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                {preset.name}{' '}
                <span className="font-mono text-[11px] text-slate-500">
                  ({preset.ra}°, {preset.dec}°)
                </span>
              </button>
            ))}
          </div>

          {/* Coordinate & Radius Inputs */}
          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-12">
            {/* Right Ascension */}
            <div className="md:col-span-4">
              <label htmlFor="ra-input" className="block text-xs font-semibold text-slate-200">
                Right Ascension (RA, J2000)
              </label>
              <input
                id="ra-input"
                type="text"
                value={raInput}
                onChange={(e) => setRaInput(e.target.value)}
                placeholder="e.g. 156.093 or 10:24:22.3"
                className={`mt-1.5 w-full rounded-md border bg-[#07090E] px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-slate-600 focus:outline-none ${
                  raValidation.valid
                    ? 'border-slate-700 focus:border-cyan-400'
                    : 'border-rose-500 focus:border-rose-400'
                }`}
              />
              {raValidation.valid && raValidation.value !== null ? (
                <p className="mt-1.5 font-mono text-[11px] text-slate-400 tabular-nums">
                  Parsed: {raValidation.value.toFixed(5)}° · {formatRaHms(raValidation.value)}
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-rose-400">{raValidation.error}</p>
              )}
            </div>

            {/* Declination */}
            <div className="md:col-span-4">
              <label htmlFor="dec-input" className="block text-xs font-semibold text-slate-200">
                Declination (DEC, J2000)
              </label>
              <input
                id="dec-input"
                type="text"
                value={decInput}
                onChange={(e) => setDecInput(e.target.value)}
                placeholder="e.g. -41.644 or -41:38:38.4"
                className={`mt-1.5 w-full rounded-md border bg-[#07090E] px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-slate-600 focus:outline-none ${
                  decValidation.valid
                    ? 'border-slate-700 focus:border-cyan-400'
                    : 'border-rose-500 focus:border-rose-400'
                }`}
              />
              {decValidation.valid && decValidation.value !== null ? (
                <p className="mt-1.5 font-mono text-[11px] text-slate-400 tabular-nums">
                  Parsed: {decValidation.value.toFixed(5)}° · {formatDecDms(decValidation.value)}
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-rose-400">{decValidation.error}</p>
              )}
            </div>

            {/* Search Radius */}
            <div className="md:col-span-2">
              <label htmlFor="radius-input" className="block text-xs font-semibold text-slate-200">
                Search Radius (deg)
              </label>
              <input
                id="radius-input"
                type="number"
                step="0.01"
                min="0.005"
                max="2.0"
                value={radiusInput}
                onChange={(e) => setRadiusInput(e.target.value)}
                className={`mt-1.5 w-full rounded-md border bg-[#07090E] px-3.5 py-2.5 font-mono text-sm text-white focus:outline-none tabular-nums ${
                  radiusValidation.valid
                    ? 'border-slate-700 focus:border-cyan-400'
                    : 'border-rose-500 focus:border-rose-400'
                }`}
              />
              {radiusValidation.valid ? (
                <div className="mt-1.5 flex items-center gap-1.5">
                  {[0.05, 0.1, 0.25, 0.5].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRadiusInput(String(r))}
                      className="font-mono text-[11px] text-slate-400 hover:text-cyan-300 cursor-pointer"
                    >
                      {r}°
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-rose-400">{radiusValidation.error}</p>
              )}
            </div>

            {/* Submit Search */}
            <div className="md:col-span-2 flex flex-col justify-start">
              <span className="hidden md:block text-xs font-semibold text-transparent select-none">
                Action
              </span>
              <button
                type="submit"
                disabled={
                  loading || !raValidation.valid || !decValidation.valid || !radiusValidation.valid
                }
                className="mt-1.5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Search className="h-4 w-4" />
                <span>{loading ? 'Searching...' : 'SEARCH'}</span>
              </button>
              <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceRefresh}
                  onChange={(e) => setForceRefresh(e.target.checked)}
                  className="h-3 w-3 rounded border-slate-700 bg-slate-900 accent-cyan-400"
                />
                <span>Bypass cache</span>
              </label>
            </div>
          </div>

          {/* DETECTOR & DATE FILTER CONTROLS (STRICTLY SEPARATED) */}
          <div className="mt-6 grid grid-cols-1 gap-5 border-t border-slate-800/80 pt-5 lg:grid-cols-12">
            {/* Detector Selector */}
            <div className="lg:col-span-7">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Detector Array Selection (Independent Archives D1–D6)
                </span>
                <span className="text-[11px] text-slate-400">
                  Never mixes detectors
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DETECTOR_IDS.map((detId) => {
                  const spec = SPHEREX_DETECTORS[detId];
                  const count = searchResult ? filteredByDetector[detId].length : null;
                  const active = detectorMode === detId;
                  return (
                    <button
                      key={detId}
                      type="button"
                      onClick={() => setDetectorMode(detId)}
                      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 font-semibold'
                          : 'border-slate-800 bg-[#07090E] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span>{spec.shortLabel}</span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {spec.wavelengthMinUm.toFixed(2)}–{spec.wavelengthMaxUm.toFixed(2)}µm
                      </span>
                      {count !== null && (
                        <span
                          className={`font-mono text-[11px] tabular-nums ${
                            active ? 'text-cyan-300' : 'text-slate-400'
                          }`}
                        >
                          ({count})
                        </span>
                      )}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setDetectorMode('ALL_DETECTORS')}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    detectorMode === 'ALL_DETECTORS'
                      ? 'border-indigo-400 bg-indigo-500/15 text-indigo-200 font-semibold'
                      : 'border-slate-800 bg-[#07090E] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span>ALL DETECTORS (D1–D6)</span>
                  {searchResult && (
                    <span className="font-mono text-[11px] tabular-nums text-slate-400">
                      ({DETECTOR_IDS.reduce((s, d) => s + filteredByDetector[d].length, 0)})
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Date Filter Selector */}
            <div className="lg:col-span-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Calendar className="h-3.5 w-3.5 text-cyan-400" />
                  Observation Date Filter (Actual UTC Exposure Time)
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border border-slate-800 bg-[#07090E] p-1">
                  <button
                    type="button"
                    onClick={() => setDateMode('ALL')}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      dateMode === 'ALL'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    ALL AVAILABLE DATES
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDateMode('SPECIFIC');
                      if (!specificDate && availableDatesForSelection.length > 0) {
                        setSpecificDate(availableDatesForSelection[0]);
                      }
                    }}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      dateMode === 'SPECIFIC'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    PARTICULAR DATE
                  </button>
                </div>

                {dateMode === 'SPECIFIC' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={specificDate}
                      onChange={(e) => setSpecificDate(e.target.value)}
                      aria-label="Specific observation date UTC"
                      className="rounded-md border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono text-xs text-white focus:border-cyan-400 focus:outline-none"
                    />
                    {availableDatesForSelection.length > 0 && (
                      <select
                        value={specificDate}
                        onChange={(e) => setSpecificDate(e.target.value)}
                        aria-label="Observed dates available in this region"
                        className="rounded-md border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                      >
                        <option value="">Select observed date...</option>
                        {availableDatesForSelection.map((d) => (
                          <option key={d} value={d}>
                            {d} (UTC)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              <p className="mt-1.5 text-[11px] text-slate-400">
                {dateMode === 'ALL'
                  ? `Retrieves all historical observations across every available date for ${
                      detectorMode === 'ALL_DETECTORS'
                        ? 'each independent detector'
                        : SPHEREX_DETECTORS[detectorMode].label
                    }.`
                  : 'Filters strictly by actual observation timestamp (t_min). Never substitutes another date.'}
              </p>
            </div>
          </div>
        </form>

        {/* API Error Alert */}
        {apiError && (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
            <div>
              <div className="font-semibold">Archive Query Notice</div>
              <p className="mt-1 text-xs text-rose-200/90">{apiError}</p>
            </div>
          </div>
        )}

        {/* RESULTS SUMMARY HEADER */}
        {searchResult && (
          <div className="mt-6 rounded-lg border border-slate-800 bg-[#0B0E17] p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <div className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">
                  Selected Region
                </div>
                <div className="mt-1 font-mono text-sm font-semibold text-white tabular-nums">
                  {searchResult.query.ra.toFixed(4)}°, {searchResult.query.dec.toFixed(4)}°
                </div>
                <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                  Radius {searchResult.query.radius}°
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">
                  Selected Detector
                </div>
                <div className="mt-1 font-mono text-sm font-semibold text-cyan-300">
                  {detectorMode === 'ALL_DETECTORS'
                    ? 'ALL DETECTORS (D1–D6)'
                    : SPHEREX_DETECTORS[detectorMode].label}
                </div>
                <div className="text-[11px] text-slate-400">
                  {detectorMode === 'ALL_DETECTORS'
                    ? 'Six isolated detector sections'
                    : SPHEREX_DETECTORS[detectorMode].wavelengthRangeLabel}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">
                  Date Filter
                </div>
                <div className="mt-1 font-mono text-sm font-semibold text-white">
                  {dateMode === 'ALL' ? 'ALL AVAILABLE DATES' : specificDate || 'No date chosen'}
                </div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  {availableDatesForSelection.length} distinct observation dates found
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">
                  Total Matching Observations
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                  {activeCounts.totalMatching}
                </div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  Across all 6 detectors: {searchResult.totalAcrossAllDetectors}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">
                  Retrieved Observations
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-cyan-400 tabular-nums">
                  {activeCounts.retrieved}
                </div>
                <div className="text-[11px] text-slate-400">
                  Verified from NASA/IPAC IRSA SIA2
                </div>
              </div>
            </div>

            {/* Per-Collection Provenance Strip */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="font-medium text-slate-300">Archive Collections Queried:</span>
                {searchResult.collectionReports.map((rep) => (
                  <a
                    key={rep.collection}
                    href={rep.queryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-[11px] hover:text-cyan-300"
                  >
                    <span className="text-slate-200">{rep.collection}</span>
                    <span
                      className={
                        rep.status === 'ERROR'
                          ? 'text-rose-400'
                          : rep.status === 'PARTIAL_OVERFLOW'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }
                    >
                      {rep.status === 'ERROR'
                        ? 'Error'
                        : `${rep.totalRetrieved} records (${rep.status})`}
                    </span>
                    <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                  </a>
                ))}
              </div>

              {onOpenComparison && compareQueueIds && compareQueueIds.size > 0 && (
                <button
                  type="button"
                  onClick={onOpenComparison}
                  className="inline-flex items-center gap-1.5 rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/25 cursor-pointer whitespace-nowrap"
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  <span>Open Space Comparison ({compareQueueIds.size})</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* LOADING SKELETON */}
        {loading && !searchResult && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-80 animate-pulse rounded-lg border border-slate-800 bg-[#0B0E17]"
              />
            ))}
          </div>
        )}

        {/* OBSERVATION GALLERIES */}
        {searchResult && (
          <div className={`mt-6 space-y-6 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
            {detectorMode === 'ALL_DETECTORS' ? (
              DETECTOR_IDS.map((detId) => (
                <DetectorGallerySection
                  key={detId}
                  detectorId={detId}
                  observations={filteredByDetector[detId]}
                  totalForDetectorAllDates={searchResult.byDetector[detId].length}
                  dateMode={dateMode}
                  specificDate={specificDate}
                  searchRa={searchResult.query.ra}
                  searchDec={searchResult.query.dec}
                  onInspect={setInspectedObs}
                  compareQueueIds={compareQueueIds}
                  onToggleCompare={onToggleCompare}
                  collapsible={true}
                  defaultExpanded={filteredByDetector[detId].length > 0}
                />
              ))
            ) : (
              <DetectorGallerySection
                detectorId={detectorMode}
                observations={filteredByDetector[detectorMode]}
                totalForDetectorAllDates={searchResult.byDetector[detectorMode].length}
                dateMode={dateMode}
                specificDate={specificDate}
                searchRa={searchResult.query.ra}
                searchDec={searchResult.query.dec}
                onInspect={setInspectedObs}
                compareQueueIds={compareQueueIds}
                onToggleCompare={onToggleCompare}
                collapsible={false}
                defaultExpanded={true}
              />
            )}
          </div>
        )}
      </div>

      {/* Interactive Scientific FITS Image Viewer */}
      {inspectedObs && searchResult && (
        <FitsViewerModal
          observation={inspectedObs}
          searchRa={searchResult.query.ra}
          searchDec={searchResult.query.dec}
          onClose={() => setInspectedObs(null)}
        />
      )}
    </div>
  );
}
