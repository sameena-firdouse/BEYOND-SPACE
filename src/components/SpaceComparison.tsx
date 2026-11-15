import {
  AlertCircle,
  Check,
  CheckCircle2,
  Compass,
  GitCompare,
  Layers,
  Plus,
  Search,
  Trash2,
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
  validateComparisonCompatibility,
  validateSearchRadius,
  type DetectorId,
  type SearchResponse,
  type SpaceComparisonResult,
  type SpherexObservation,
} from '../../shared/astronomy';
import { ComparisonDashboard } from './ComparisonDashboard';

interface SpaceComparisonProps {
  sharedQueue: SpherexObservation[];
  onAddToQueue: (obs: SpherexObservation) => void;
  onRemoveFromQueue: (obsId: string) => void;
  onClearQueue: () => void;
  latestExplorerResult: SearchResponse | null;
}

export function SpaceComparison({
  sharedQueue,
  onAddToQueue,
  onRemoveFromQueue,
  onClearQueue,
  latestExplorerResult,
}: SpaceComparisonProps) {
  const [raInput, setRaInput] = useState<string>(
    latestExplorerResult ? String(latestExplorerResult.query.ra) : '156.093'
  );
  const [decInput, setDecInput] = useState<string>(
    latestExplorerResult ? String(latestExplorerResult.query.dec) : '-41.644'
  );
  const [radiusInput, setRadiusInput] = useState<string>(
    latestExplorerResult ? String(latestExplorerResult.query.radius) : '0.1'
  );
  const [selectedDetector, setSelectedDetector] = useState<DetectorId>(
    sharedQueue[0]?.detector ?? 'D3'
  );

  const [cutoutSizeDeg, setCutoutSizeDeg] = useState<number>(0.16);
  const [subtractZodi, setSubtractZodi] = useState<boolean>(true);
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [visibleLimit, setVisibleLimit] = useState<number>(24);

  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [archiveResults, setArchiveResults] = useState<SearchResponse | null>(
    latestExplorerResult
  );

  const [comparing, setComparing] = useState<boolean>(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [comparisonResult, setComparisonResult] = useState<SpaceComparisonResult | null>(null);

  const raValidation = useMemo(() => parseRightAscension(raInput), [raInput]);
  const decValidation = useMemo(() => parseDeclination(decInput), [decInput]);
  const radiusValidation = useMemo(() => validateSearchRadius(radiusInput), [radiusInput]);

  const queuedIds = useMemo(() => new Set(sharedQueue.map((o) => o.id)), [sharedQueue]);

  // Live compatibility check across queued observations
  const compatibility = useMemo(() => {
    return validateComparisonCompatibility(
      sharedQueue,
      raValidation.value ?? undefined,
      decValidation.value ?? undefined
    );
  }, [sharedQueue, raValidation.value, decValidation.value]);

  const runArchiveSearch = useCallback(
    async (overrideRa?: number, overrideDec?: number, overrideRadius?: number) => {
      const raVal = overrideRa ?? raValidation.value;
      const decVal = overrideDec ?? decValidation.value;
      const radVal = overrideRadius ?? radiusValidation.value;
      if (raVal === null || decVal === null || radVal === null) return;

      setSearching(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({
          ra: String(raVal),
          dec: String(decVal),
          radius: String(radVal),
        });
        const resp = await fetch(`/api/search?${params.toString()}`);
        const json = await resp.json();
        if (!resp.ok) {
          throw new Error(json.error || `Archive query failed (HTTP ${resp.status})`);
        }
        setArchiveResults(json as SearchResponse);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Failed to search archive');
      } finally {
        setSearching(false);
      }
    },
    [raValidation.value, decValidation.value, radiusValidation.value]
  );

  // Auto-load initial verified region if user opens Space Comparison directly without visiting Sky Explorer
  useEffect(() => {
    if (!archiveResults) {
      runArchiveSearch(156.093, -41.644, 0.1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImportFromExplorer = () => {
    if (!latestExplorerResult) return;
    setArchiveResults(latestExplorerResult);
    setRaInput(String(latestExplorerResult.query.ra));
    setDecInput(String(latestExplorerResult.query.dec));
    setRadiusInput(String(latestExplorerResult.query.radius));
  };

  const handleCompareImages = async () => {
    if (!compatibility.compatible || raValidation.value === null || decValidation.value === null) {
      return;
    }

    setComparing(true);
    setCompareError(null);
    try {
      const resp = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observationIds: sharedQueue.map((o) => o.id),
          ra: raValidation.value,
          dec: decValidation.value,
          sizeDeg: cutoutSizeDeg,
          subtractZodi,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json.error || `Comparison failed (HTTP ${resp.status})`);
      }
      setComparisonResult(json as SpaceComparisonResult);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setComparing(false);
    }
  };

  const detectorObservations = useMemo(() => {
    if (!archiveResults) return [];
    const list = archiveResults.byDetector[selectedDetector] || [];
    if (dateFilter === 'ALL') return list;
    return list.filter((o) => o.obsDateUtc === dateFilter);
  }, [archiveResults, selectedDetector, dateFilter]);

  const availableDatesForDetector = useMemo(() => {
    if (!archiveResults) return [];
    const set = new Set<string>();
    for (const o of archiveResults.byDetector[selectedDetector] || []) {
      if (o.obsDateUtc) set.add(o.obsDateUtc);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [archiveResults, selectedDetector]);

  useEffect(() => {
    setVisibleLimit(24);
  }, [selectedDetector, dateFilter, archiveResults]);

  const activeRa = archiveResults?.query.ra ?? raValidation.value ?? 156.093;
  const activeDec = archiveResults?.query.dec ?? decValidation.value ?? -41.644;

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100">
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="flex flex-col gap-3 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
              Space Comparison · Multi-Epoch FITS Subtraction &amp; Artifact Rejection
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-white">
              COSMIC CHANGE DETECTOR
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Select two or more SPHEREx observations of the same sky region and detector to
              perform WCS TAN-SIP reprojection, zodiacal &amp; sky background normalization,
              uncertainty-propagated difference mapping, and statistical signal-vs-artifact
              attribution.
            </p>
          </div>

          {latestExplorerResult && (
            <button
              type="button"
              onClick={handleImportFromExplorer}
              className="inline-flex items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Layers className="h-3.5 w-3.5" />
              Import Latest Sky Explorer Results ({latestExplorerResult.totalAcrossAllDetectors})
            </button>
          )}
        </div>

        {/* STEP 1 & 2: REGION + DETECTOR SELECTION */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runArchiveSearch();
          }}
          className="mt-6 rounded-lg border border-slate-800 bg-[#0B0E17] p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-4">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mr-1">
              <Compass className="h-3.5 w-3.5 text-cyan-400" />
              Verified Sky Fields:
            </span>
            {VERIFIED_SKY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setRaInput(String(preset.ra));
                  setDecInput(String(preset.dec));
                  setRadiusInput(String(preset.radius));
                  runArchiveSearch(preset.ra, preset.dec, preset.radius);
                }}
                className="rounded border border-slate-700/90 bg-[#07090E] px-2.5 py-1 text-xs text-slate-300 hover:border-cyan-500/60 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                {preset.name}{' '}
                <span className="font-mono text-[11px] text-slate-500">
                  ({preset.ra}°, {preset.dec}°)
                </span>
              </button>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
              <label htmlFor="cmp-ra" className="block text-xs font-semibold text-slate-200">
                Right Ascension (RA)
              </label>
              <input
                id="cmp-ra"
                type="text"
                value={raInput}
                onChange={(e) => setRaInput(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#07090E] px-3 py-2 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
              {raValidation.valid && raValidation.value !== null ? (
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  {formatRaHms(raValidation.value)}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-rose-400">{raValidation.error}</p>
              )}
            </div>

            <div className="md:col-span-3">
              <label htmlFor="cmp-dec" className="block text-xs font-semibold text-slate-200">
                Declination (DEC)
              </label>
              <input
                id="cmp-dec"
                type="text"
                value={decInput}
                onChange={(e) => setDecInput(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#07090E] px-3 py-2 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
              {decValidation.valid && decValidation.value !== null ? (
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  {formatDecDms(decValidation.value)}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-rose-400">{decValidation.error}</p>
              )}
            </div>

            <div className="md:col-span-2">
              <label htmlFor="cmp-rad" className="block text-xs font-semibold text-slate-200">
                Search Radius (deg)
              </label>
              <input
                id="cmp-rad"
                type="number"
                step="0.01"
                min="0.005"
                max="2.0"
                value={radiusInput}
                onChange={(e) => setRadiusInput(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#07090E] px-3 py-2 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
              {!radiusValidation.valid && (
                <p className="mt-1 text-[11px] text-rose-400">{radiusValidation.error}</p>
              )}
            </div>

            <div className="md:col-span-4 flex flex-col justify-start">
              <span className="hidden md:block text-xs font-semibold text-transparent select-none">
                Search
              </span>
              <button
                type="submit"
                disabled={
                  searching ||
                  !raValidation.valid ||
                  !decValidation.valid ||
                  !radiusValidation.valid
                }
                className="mt-1.5 inline-flex items-center justify-center gap-2 rounded-md border border-cyan-500/50 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50 cursor-pointer"
              >
                <Search className="h-4 w-4" />
                <span>{searching ? 'Querying IRSA Archive...' : 'Find Region Observations'}</span>
              </button>
            </div>
          </div>

          {/* Detector Selector D1-D6 */}
          <div className="mt-5 border-t border-slate-800/80 pt-4">
            <div className="text-xs font-semibold text-slate-200">
              Select Detector Array (One Detector Per Comparison)
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DETECTOR_IDS.map((detId) => {
                const spec = SPHEREX_DETECTORS[detId];
                const cnt = archiveResults ? archiveResults.byDetector[detId].length : null;
                const active = selectedDetector === detId;
                return (
                  <button
                    key={detId}
                    type="button"
                    onClick={() => setSelectedDetector(detId)}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 font-semibold'
                        : 'border-slate-800 bg-[#07090E] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span>{spec.shortLabel}</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {spec.wavelengthMinUm.toFixed(2)}–{spec.wavelengthMaxUm.toFixed(2)}µm
                    </span>
                    {cnt !== null && (
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        ({cnt})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </form>

        {searchError && (
          <div className="mt-4 flex items-center gap-2 rounded border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{searchError}</span>
          </div>
        )}

        {/* SELECTED COMPARISON QUEUE + COMPATIBILITY CHECK */}
        <div className="mt-6 rounded-lg border border-slate-800 bg-[#0B0E17] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
                <GitCompare className="h-4 w-4 text-cyan-400" />
                Selected Observations for Comparison ({sharedQueue.length} / 6 max)
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Select 2 to 6 observations from the same sky region and detector below (or add them
                directly from Sky Explorer).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={subtractZodi}
                  onChange={(e) => setSubtractZodi(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 accent-cyan-400"
                />
                <span>Subtract ZODI Foreground</span>
              </label>

              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>Cutout:</span>
                {[0.12, 0.16, 0.24].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setCutoutSizeDeg(sz)}
                    className={`rounded border px-2 py-1 font-mono text-[11px] cursor-pointer ${
                      cutoutSizeDeg === sz
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300'
                        : 'border-slate-800 text-slate-400'
                    }`}
                  >
                    {sz}°
                  </button>
                ))}
              </div>

              {sharedQueue.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onClearQueue();
                    setComparisonResult(null);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}

              <button
                type="button"
                disabled={comparing || !compatibility.compatible}
                onClick={handleCompareImages}
                className="inline-flex items-center gap-2 rounded-md bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-45 transition-colors cursor-pointer"
              >
                <GitCompare className="h-4 w-4" />
                <span>{comparing ? 'Analyzing FITS Images...' : 'Compare Images'}</span>
              </button>
            </div>
          </div>

          {/* Queued Items */}
          {sharedQueue.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              No observations queued yet. Click <strong className="text-slate-200">+ Select</strong>{' '}
              on at least 2 observations in the gallery below to check compatibility and compare.
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sharedQueue.map((obs, idx) => (
                <div
                  key={obs.id}
                  className="flex items-start justify-between gap-3 rounded border border-slate-800 bg-[#07090E] p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="font-semibold text-cyan-400">#{idx + 1}</span>
                      <span className="truncate font-semibold text-white">{obs.obsId}</span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-300">
                      {obs.bandpassName} ·{' '}
                      {obs.obsDateIso
                        ? obs.obsDateIso.replace('T', ' ').replace('.000Z', ' UTC')
                        : 'Timestamp N/A'}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {obs.dataRelease} · Center {obs.ra.toFixed(3)}°, {obs.dec.toFixed(3)}°
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveFromQueue(obs.id)}
                    aria-label={`Remove ${obs.obsId}`}
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Compatibility Validation Banner */}
          {sharedQueue.length >= 1 && (
            <div className="mt-4">
              {!compatibility.compatible ? (
                <div className="rounded border border-rose-500/40 bg-rose-950/25 p-3 text-xs text-rose-200">
                  <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                    <AlertCircle className="h-4 w-4" />
                    Incompatible Comparison Selection
                  </div>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {compatibility.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded border border-emerald-500/35 bg-emerald-950/20 p-3 text-xs text-emerald-200">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    Compatible {compatibility.detector} Observations Ready for WCS Alignment &amp;
                    Difference Analysis
                  </div>
                  {compatibility.warnings.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 space-y-0.5 text-amber-200">
                      {compatibility.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {compareError && (
            <div className="mt-4 flex items-start gap-2 rounded border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{compareError}</span>
            </div>
          )}
        </div>

        {/* COMPARISON DASHBOARD OUTPUT */}
        {comparing && (
          <div className="mt-6 rounded-lg border border-slate-800 bg-[#0B0E17] p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
            <div className="mt-4 text-sm font-semibold text-white">
              Running Cosmic Change Detector Pipeline...
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Fetching SPHEREx MEF FITS cutouts (IMAGE, FLAGS, VARIANCE, ZODI), reprojecting TAN-SIP
              WCS grids, and computing uncertainty-weighted significance maps.
            </p>
          </div>
        )}

        {comparisonResult && !comparing && (
          <div className="mt-6">
            <ComparisonDashboard
              result={comparisonResult}
              onNewComparison={() => setComparisonResult(null)}
            />
          </div>
        )}

        {/* HISTORICAL OBSERVATION PICKER GALLERY FOR SELECTED DETECTOR */}
        <div className="mt-8 rounded-lg border border-slate-800 bg-[#090D16]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">
                Available {SPHEREX_DETECTORS[selectedDetector].label} Observations (
                {detectorObservations.length})
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Inspect observation dates and metadata, then select 2 or more exposures to compare.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {availableDatesForDetector.length > 0 && (
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  aria-label="Filter comparison candidates by UTC observation date"
                  className="rounded border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="ALL">
                    All UTC Dates ({archiveResults?.byDetector[selectedDetector]?.length ?? 0})
                  </option>
                  {availableDatesForDetector.map((d) => (
                    <option key={d} value={d}>
                      {d} (UTC)
                    </option>
                  ))}
                </select>
              )}
              <span className="font-mono text-xs text-cyan-400">
                {SPHEREX_DETECTORS[selectedDetector].wavelengthRangeLabel}
              </span>
            </div>
          </div>

          <div className="p-5">
            {detectorObservations.length === 0 ? (
              <div className="rounded border border-slate-800 bg-[#07090E] p-8 text-center text-xs text-slate-400">
                No {selectedDetector} observations found at ({activeRa.toFixed(3)}°,{' '}
                {activeDec.toFixed(3)}°){dateFilter !== 'ALL' ? ` on ${dateFilter}` : ''}. Try
                another detector tab, date, or verified sky field preset.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {detectorObservations.slice(0, visibleLimit).map((obs) => {
                  const isQueued = queuedIds.has(obs.id);
                  return (
                    <div
                      key={obs.id}
                      className={`flex flex-col justify-between overflow-hidden rounded-lg border transition-colors ${
                        isQueued
                          ? 'border-cyan-400 bg-[#0B1320]'
                          : 'border-slate-800 bg-[#0B0E17] hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="relative aspect-square w-full bg-[#05070B] border-b border-slate-800">
                          <img
                            src={`/api/fits/preview?id=${encodeURIComponent(obs.id)}&ra=${activeRa}&dec=${activeDec}&size=0.12&stretch=asinh&cmap=cyan_thermal`}
                            alt={`SPHEREx ${obs.detector} ${obs.obsId}`}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-[#05070B]/90 to-transparent px-3 py-2 font-mono text-[11px] text-slate-200">
                            <span>{obs.bandpassName}</span>
                            <span>{obs.collection.replace('spherex_', '').toUpperCase()}</span>
                          </div>
                        </div>

                        <div className="p-3.5 text-xs space-y-1">
                          <div className="truncate font-mono font-semibold text-white">
                            {obs.obsId}
                          </div>
                          <div className="font-mono text-cyan-300 tabular-nums">
                            {obs.obsDateIso
                              ? obs.obsDateIso.replace('T', ' ').replace('.000Z', ' UTC')
                              : 'Timestamp unavailable'}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                            Center {obs.ra.toFixed(4)}°, {obs.dec.toFixed(4)}° ·{' '}
                            {obs.exptimeSec ? `${obs.exptimeSec.toFixed(0)}s` : 'Exp N/A'}
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-800/80 bg-[#090D16] px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            isQueued ? onRemoveFromQueue(obs.id) : onAddToQueue(obs)
                          }
                          className={`inline-flex w-full items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                            isQueued
                              ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                              : 'border border-slate-700 bg-[#07090E] text-slate-200 hover:border-cyan-500/60 hover:text-cyan-300'
                          }`}
                        >
                          {isQueued ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              Selected for Comparison
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" />
                              Select for Comparison
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
                </div>
                {detectorObservations.length > visibleLimit && (
                  <div className="mt-5 flex items-center justify-between border-t border-slate-800/80 pt-4 text-xs text-slate-400">
                    <span className="font-mono tabular-nums">
                      Showing {Math.min(visibleLimit, detectorObservations.length)} of{' '}
                      {detectorObservations.length} {selectedDetector} exposures
                    </span>
                    <button
                      type="button"
                      onClick={() => setVisibleLimit((v) => v + 24)}
                      className="rounded border border-slate-700 bg-[#07090E] px-4 py-1.5 font-medium text-cyan-300 hover:border-cyan-500/60 cursor-pointer"
                    >
                      Load 24 More Observations
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
