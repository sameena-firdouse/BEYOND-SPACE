import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Compass,
  Film,
  Layers,
  Search,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DETECTOR_IDS,
  SPHEREX_DETECTORS,
  VERIFIED_SKY_PRESETS,
  chronologicalSortObservations,
  formatDecDms,
  formatRaHms,
  parseDeclination,
  parseRightAscension,
  validateComparisonCompatibility,
  validateSearchRadius,
  type DetectorId,
  type SearchResponse,
  type SpherexObservation,
  type TimelapseCustomSettings,
  type TimelapseExportResult,
  type TimelapsePreparationResult,
} from '../../shared/astronomy';
import { TimelapseStudio } from './TimelapseStudio';

interface CosmicTimelapseProps {
  latestExplorerResult: SearchResponse | null;
}

const DEFAULT_SETTINGS: TimelapseCustomSettings = {
  title: 'SPHEREx D3 Cosmic Time-Lapse',
  visualizationMode: 'smooth_crossfade',
  aspectRatio: '16:9',
  fps: 12,
  frameDurationSec: 1.2,
  transitionDurationSec: 0.6,
  playbackSpeed: 1.0,
  showDates: true,
  showCoordinates: true,
  showDetectorInfo: true,
  showAnnotations: true,
  includeAmbientAudio: false,
};

export function CosmicTimelapse({ latestExplorerResult }: CosmicTimelapseProps) {
  const [raInput, setRaInput] = useState<string>(
    latestExplorerResult ? String(latestExplorerResult.query.ra) : '156.093'
  );
  const [decInput, setDecInput] = useState<string>(
    latestExplorerResult ? String(latestExplorerResult.query.dec) : '-41.644'
  );
  const [radiusInput, setRadiusInput] = useState<string>(
    latestExplorerResult ? String(latestExplorerResult.query.radius) : '0.1'
  );
  const [selectedDetector, setSelectedDetector] = useState<DetectorId>('D3');

  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [archiveResults, setArchiveResults] = useState<SearchResponse | null>(
    latestExplorerResult
  );

  // Selection state (scoped strictly to selectedDetector)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [showAllMatching, setShowAllMatching] = useState<boolean>(false);
  const [visibleLimit, setVisibleLimit] = useState<number>(24);

  // Chronological timeline & optional user manual sequence override
  const [allowManualMissingOrder, setAllowManualMissingOrder] = useState<boolean>(false);
  const [manualOrderedIds, setManualOrderedIds] = useState<string[] | null>(null);

  // Scientific preparation & video customization
  const [cutoutSizeDeg, setCutoutSizeDeg] = useState<number>(0.14);
  const [subtractZodi, setSubtractZodi] = useState<boolean>(true);
  const [settings, setSettings] = useState<TimelapseCustomSettings>({
    ...DEFAULT_SETTINGS,
    title: 'SPHEREx D3 Cosmic Time-Lapse',
  });

  const [preparing, setPreparing] = useState<boolean>(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<TimelapsePreparationResult | null>(null);

  const [exportingMp4, setExportingMp4] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedVideo, setExportedVideo] = useState<TimelapseExportResult | null>(null);

  const studioAnchorRef = useRef<HTMLDivElement | null>(null);

  const raValidation = useMemo(() => parseRightAscension(raInput), [raInput]);
  const decValidation = useMemo(() => parseDeclination(decInput), [decInput]);
  const radiusValidation = useMemo(() => validateSearchRadius(radiusInput), [radiusInput]);

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
        setSelectedIds(new Set());
        setManualOrderedIds(null);
        setPrepared(null);
        setExportedVideo(null);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Failed to search archive');
      } finally {
        setSearching(false);
      }
    },
    [raValidation.value, decValidation.value, radiusValidation.value]
  );

  // Auto-load initial verified sky region when user navigates directly to Cosmic Time-Lapse
  useEffect(() => {
    if (!archiveResults) {
      runArchiveSearch(156.093, -41.644, 0.1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImportExplorerSearch = () => {
    if (!latestExplorerResult) return;
    setArchiveResults(latestExplorerResult);
    setRaInput(String(latestExplorerResult.query.ra));
    setDecInput(String(latestExplorerResult.query.dec));
    setRadiusInput(String(latestExplorerResult.query.radius));
    setSelectedIds(new Set());
    setManualOrderedIds(null);
    setPrepared(null);
    setExportedVideo(null);
  };

  // All observations strictly belonging to the active detector (D1..D6)
  const detectorAllObservations = useMemo(() => {
    if (!archiveResults) return [];
    return archiveResults.byDetector[selectedDetector] || [];
  }, [archiveResults, selectedDetector]);

  // Date-filtered observations
  const filteredObservations = useMemo(() => {
    if (dateFilter === 'ALL') return detectorAllObservations;
    return detectorAllObservations.filter((o) => o.obsDateUtc === dateFilter);
  }, [detectorAllObservations, dateFilter]);

  const availableDatesForDetector = useMemo(() => {
    const s = new Set<string>();
    for (const o of detectorAllObservations) {
      if (o.obsDateUtc) s.add(o.obsDateUtc);
    }
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [detectorAllObservations]);

  const obsMap = useMemo(() => {
    const m = new Map<string, SpherexObservation>();
    for (const o of detectorAllObservations) m.set(o.id, o);
    return m;
  }, [detectorAllObservations]);

  // Strictly handle detector switch: never mix observations from different detectors
  const handleSelectDetector = (det: DetectorId) => {
    if (det === selectedDetector) return;
    setSelectedDetector(det);
    setSelectedIds(new Set());
    setManualOrderedIds(null);
    setDateFilter('ALL');
    setVisibleLimit(24);
    setShowAllMatching(false);
    setPrepared(null);
    setExportedVideo(null);
    setSettings((prev) => ({
      ...prev,
      title: `SPHEREx ${det} Cosmic Time-Lapse`,
    }));
  };

  // Pre-fill 6 evenly spaced chronological frames on first archive load if user hasn't picked yet
  const toggleObsSelection = (id: string) => {
    setManualOrderedIds(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllMatching = () => {
    setManualOrderedIds(null);
    const list = filteredObservations;
    setSelectedIds(new Set(list.map((o) => o.id)));
  };

  const handleSelectRepresentativeTimeline = () => {
    setManualOrderedIds(null);
    const sortedChron = chronologicalSortObservations(detectorAllObservations).sorted;
    if (sortedChron.length <= 8) {
      setSelectedIds(new Set(sortedChron.map((o) => o.id)));
      return;
    }
    const picks = new Set<string>();
    const targetCount = 8;
    for (let i = 0; i < targetCount; i++) {
      const idx = Math.round((i / (targetCount - 1)) * (sortedChron.length - 1));
      picks.add(sortedChron[idx].id);
    }
    setSelectedIds(picks);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setManualOrderedIds(null);
  };

  const selectedObservations = useMemo(() => {
    return detectorAllObservations.filter((o) => selectedIds.has(o.id));
  }, [detectorAllObservations, selectedIds]);

  // Automatic chronological sort oldest -> newest using actual t_min MJD / UTC
  const chronological = useMemo(
    () => chronologicalSortObservations(selectedObservations),
    [selectedObservations]
  );

  // Final sequence displayed in the pre-generation chronological preview
  const timelineSequence = useMemo<SpherexObservation[]>(() => {
    if (manualOrderedIds && manualOrderedIds.length > 0) {
      const validIds = new Set(selectedObservations.map((o) => o.id));
      const baseList = manualOrderedIds
        .filter((id) => validIds.has(id))
        .map((id) => obsMap.get(id)!)
        .filter(Boolean);
      const missingFilter = allowManualMissingOrder
        ? baseList
        : baseList.filter((o) => o.tMinMjd !== null || o.obsDateIso !== null);
      return missingFilter;
    }
    if (allowManualMissingOrder) {
      return [...chronological.sorted, ...chronological.missingTimestamps];
    }
    return chronological.sorted;
  }, [
    manualOrderedIds,
    selectedObservations,
    obsMap,
    allowManualMissingOrder,
    chronological,
  ]);

  const compatibility = useMemo(() => {
    return validateComparisonCompatibility(
      timelineSequence,
      raValidation.value ?? undefined,
      decValidation.value ?? undefined
    );
  }, [timelineSequence, raValidation.value, decValidation.value]);

  const moveTimelineFrame = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= timelineSequence.length) return;
    const ids = timelineSequence.map((o) => o.id);
    const tmp = ids[idx];
    ids[idx] = ids[targetIdx];
    ids[targetIdx] = tmp;
    setManualOrderedIds(ids);
  };

  const removeTimelineFrame = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (manualOrderedIds) {
      setManualOrderedIds(manualOrderedIds.filter((x) => x !== id));
    }
  };

  const renderMp4FromPrepared = useCallback(
    async (
      targetTimelapseId: string,
      customSettings: TimelapseCustomSettings
    ): Promise<TimelapseExportResult | null> => {
      setExportingMp4(true);
      setExportError(null);
      try {
        const resp = await fetch('/api/timelapse/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timelapseId: targetTimelapseId,
            settings: customSettings,
          }),
        });
        const json = await resp.json();
        if (!resp.ok) {
          throw new Error(json.error || `MP4 export failed (HTTP ${resp.status})`);
        }
        const result = json as TimelapseExportResult;
        setExportedVideo(result);
        return result;
      } catch (err) {
        setExportError(err instanceof Error ? err.message : 'MP4 video export failed');
        return null;
      } finally {
        setExportingMp4(false);
      }
    },
    []
  );

  const handleGenerateVideo = async () => {
    if (!compatibility.compatible || raValidation.value === null || decValidation.value === null) {
      return;
    }

    setPreparing(true);
    setPrepError(null);
    setExportError(null);
    setExportedVideo(null);

    try {
      const resp = await fetch('/api/timelapse/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observationIds: timelineSequence.map((o) => o.id),
          ra: raValidation.value,
          dec: decValidation.value,
          radius: radiusValidation.value ?? 0.1,
          sizeDeg: cutoutSizeDeg,
          subtractZodi,
          totalMatchingArchiveRecords: detectorAllObservations.length,
          allowUnresolvedTimestamps: allowManualMissingOrder || manualOrderedIds !== null,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json.error || `Failed to prepare FITS time-lapse (HTTP ${resp.status})`);
      }

      const prepResult = json as TimelapsePreparationResult;
      setPrepared(prepResult);

      // Immediately encode authentic H.264 MP4 video on server via FFmpeg and verify on disk
      await renderMp4FromPrepared(prepResult.timelapseId, settings);

      requestAnimationFrame(() => {
        studioAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : 'Time-lapse generation failed');
    } finally {
      setPreparing(false);
    }
  };

  const activeRa = archiveResults?.query.ra ?? raValidation.value ?? 156.093;
  const activeDec = archiveResults?.query.dec ?? decValidation.value ?? -41.644;
  const displayedObs = showAllMatching
    ? filteredObservations
    : filteredObservations.slice(0, visibleLimit);

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100">
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="flex flex-col gap-3 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
              Cosmic Time-Lapse · Chronological WCS Alignment &amp; MP4 Synthesis
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-white">
              COSMIC TIME-LAPSE STUDIO
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Select multi-epoch SPHEREx observations of a single sky region and detector, verify
              chronological archive ordering (oldest to newest), align FITS cutouts onto a shared
              flux scale, inspect cosmic variability, and render verifiable H.264 MP4 videos.
            </p>
          </div>

          {latestExplorerResult && (
            <button
              type="button"
              onClick={handleImportExplorerSearch}
              className="inline-flex items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Layers className="h-3.5 w-3.5" />
              Import Latest Sky Explorer Region ({latestExplorerResult.totalAcrossAllDetectors})
            </button>
          )}
        </div>

        {/* STEP 1: SKY REGION & DETECTOR SELECTION */}
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
              Verified Multi-Epoch Sky Fields:
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
              <label htmlFor="tl-ra" className="block text-xs font-semibold text-slate-200">
                Right Ascension (RA)
              </label>
              <input
                id="tl-ra"
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
              <label htmlFor="tl-dec" className="block text-xs font-semibold text-slate-200">
                Declination (DEC)
              </label>
              <input
                id="tl-dec"
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
              <label htmlFor="tl-rad" className="block text-xs font-semibold text-slate-200">
                Search Radius (deg)
              </label>
              <input
                id="tl-rad"
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
                Query
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
                <span>
                  {searching ? 'Retrieving Archive...' : 'Retrieve Historical Observations'}
                </span>
              </button>
            </div>
          </div>

          {/* Single-Detector Isolation Bar (D1..D6) */}
          <div className="mt-5 border-t border-slate-800/80 pt-4">
            <div className="text-xs font-semibold text-slate-200">
              Select Single Detector Array (Detectors Are Strictly Isolated — Never Mixed)
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
                    onClick={() => handleSelectDetector(detId)}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 font-semibold'
                        : 'border-slate-800 bg-[#07090E] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span>{spec.label}</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {spec.wavelengthRangeLabel}
                    </span>
                    {cnt !== null && (
                      <span className="font-mono text-[11px] text-cyan-400 tabular-nums">
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

        {/* STEP 2: CHRONOLOGICAL SEQUENCE PREVIEW & VIDEO CUSTOMIZATION */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Chronological Timeline Builder (7 cols) */}
          <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#0B0E17] p-5 flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
                <div>
                  <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
                    <CalendarClock className="h-4 w-4 text-cyan-400" />
                    Chronological Timeline Order ({timelineSequence.length} Frames)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Sorted oldest to newest by actual NASA archive observation timestamp (
                    <code className="font-mono text-cyan-300">t_min</code> MJD).
                  </p>
                </div>

                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    {manualOrderedIds && (
                      <button
                        type="button"
                        onClick={() => setManualOrderedIds(null)}
                        className="rounded border border-cyan-500/40 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-500/10 cursor-pointer"
                      >
                        Reset Auto Chrono Order
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* Flag Missing Observation Timestamps cleanly */}
              {chronological.missingTimestamps.length > 0 && (
                <div className="mt-3 rounded border border-amber-500/40 bg-amber-950/25 p-3 text-xs text-amber-200 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>
                        {chronological.missingTimestamps.length} observation(s) lack archive
                        observation timestamps
                      </strong>{' '}
                      and are excluded from automatic chronological playback:
                      <span className="ml-1 font-mono text-[11px] text-amber-300">
                        {chronological.missingTimestamps.map((o) => o.obsId).join(', ')}
                      </span>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-amber-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowManualMissingOrder}
                      onChange={(e) => setAllowManualMissingOrder(e.target.checked)}
                      className="accent-amber-400"
                    />
                    Explicitly include missing-timestamp observations using manual sequence order
                  </label>
                </div>
              )}

              {timelineSequence.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400 space-y-3">
                  <p>
                    Check 2 or more {selectedDetector} observations in the gallery below (up to 36
                    frames per render), or auto-pick a multi-epoch span to get started.
                  </p>
                  {detectorAllObservations.length >= 2 && (
                    <button
                      type="button"
                      onClick={handleSelectRepresentativeTimeline}
                      className="inline-flex items-center gap-1.5 rounded border border-cyan-500/50 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Auto-Select Span ({Math.min(8, detectorAllObservations.length)}{' '}
                      {selectedDetector} Epochs Oldest→Newest)
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-3 max-h-72 overflow-y-auto rounded border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[#07090E] font-mono text-[11px] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="px-3 py-2">Frame</th>
                        <th className="px-3 py-2">Actual Observation Date (UTC)</th>
                        <th className="px-3 py-2">Observation ID</th>
                        <th className="px-3 py-2 text-right">Order</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 bg-[#07090E]/50">
                      {timelineSequence.map((obs, idx) => (
                        <tr key={obs.id} className="hover:bg-[#0F1422]">
                          <td className="px-3 py-1.5 font-mono font-semibold text-cyan-300 tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-200 tabular-nums">
                            {obs.obsDateIso
                              ? obs.obsDateIso.replace('T', ' ').replace('.000Z', ' UTC')
                              : 'MISSING TIMESTAMP'}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300 truncate max-w-[180px]">
                            {obs.obsId}
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap space-x-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => moveTimelineFrame(idx, -1)}
                              aria-label={`Move ${obs.obsId} earlier`}
                              className="rounded border border-slate-800 p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === timelineSequence.length - 1}
                              onClick={() => moveTimelineFrame(idx, 1)}
                              aria-label={`Move ${obs.obsId} later`}
                              className="rounded border border-slate-800 p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeTimelineFrame(obs.id)}
                              aria-label={`Remove ${obs.obsId}`}
                              className="rounded border border-slate-800 p-1 text-slate-400 hover:text-rose-300 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Compatibility Status */}
            {timelineSequence.length >= 1 && (
              <div className="mt-4">
                {!compatibility.compatible ? (
                  <div className="rounded border border-rose-500/40 bg-rose-950/25 p-3 text-xs text-rose-200">
                    <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                      <AlertCircle className="h-4 w-4" />
                      Incompatible Selection
                    </div>
                    <ul className="mt-1 list-disc pl-5 space-y-0.5">
                      {compatibility.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="rounded border border-emerald-500/35 bg-emerald-950/20 p-3 text-xs text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>
                      Chronological sequence verified ({timelineSequence.length}{' '}
                      {compatibility.detector} frames ready for TAN-SIP WCS alignment &amp; shared
                      dynamic scaling).
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Video Customization & Generate Action (5 cols) */}
          <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#0B0E17] p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3.5">
              <div className="border-b border-slate-800 pb-3">
                <h2 className="font-display text-lg font-semibold text-white">
                  Video Customization &amp; Synthesis
                </h2>
                <p className="text-xs text-slate-400">
                  Configure HUD overlays, animation mode, frame rate, and MP4 output geometry.
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label htmlFor="tl-title" className="block text-[11px] text-slate-300 mb-1">
                    Video Title
                  </label>
                  <input
                    id="tl-title"
                    type="text"
                    value={settings.title}
                    onChange={(e) => setSettings((s) => ({ ...s, title: e.target.value }))}
                    className="w-full rounded border border-slate-700 bg-[#07090E] px-2.5 py-1.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="tl-mode" className="block text-[11px] text-slate-300 mb-1">
                    Visualization Mode
                  </label>
                  <select
                    id="tl-mode"
                    value={settings.visualizationMode}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        visualizationMode: e.target
                          .value as TimelapseCustomSettings['visualizationMode'],
                      }))
                    }
                    className="w-full rounded border border-slate-700 bg-[#07090E] px-2.5 py-1.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="original_sequence">Original Sequence</option>
                    <option value="smooth_crossfade">Smooth Crossfade</option>
                    <option value="before_after_transitions">Before-and-After Transitions</option>
                    <option value="animated_difference_map">Animated Difference Map</option>
                    <option value="brightness_change">Brightness Change Visualization</option>
                    <option value="source_appear_disappear">
                      Highlighted Source Appearance &amp; Disappearance
                    </option>
                    <option value="side_by_side_comparison">Side-by-Side Comparison</option>
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Aspect Ratio</label>
                    <select
                      value={settings.aspectRatio}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          aspectRatio: e.target.value as TimelapseCustomSettings['aspectRatio'],
                        }))
                      }
                      className="w-full rounded border border-slate-700 bg-[#07090E] px-2 py-1.5 font-mono text-xs text-white"
                    >
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                      <option value="1:1">1:1</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">FPS</label>
                    <select
                      value={settings.fps}
                      onChange={(e) => setSettings((s) => ({ ...s, fps: Number(e.target.value) }))}
                      className="w-full rounded border border-slate-700 bg-[#07090E] px-2 py-1.5 font-mono text-xs text-white"
                    >
                      <option value={6}>6 fps</option>
                      <option value={12}>12 fps</option>
                      <option value={18}>18 fps</option>
                      <option value={24}>24 fps</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Cutout</label>
                    <select
                      value={cutoutSizeDeg}
                      onChange={(e) => setCutoutSizeDeg(Number(e.target.value))}
                      className="w-full rounded border border-slate-700 bg-[#07090E] px-2 py-1.5 font-mono text-xs text-white"
                    >
                      <option value={0.12}>0.12°</option>
                      <option value={0.14}>0.14°</option>
                      <option value={0.2}>0.20°</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Frame Duration</span>
                      <span className="font-mono text-cyan-300 tabular-nums">
                        {settings.frameDurationSec.toFixed(1)}s
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0.5}
                      max={3.5}
                      step={0.1}
                      value={settings.frameDurationSec}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, frameDurationSec: Number(e.target.value) }))
                      }
                      className="w-full accent-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Transition</span>
                      <span className="font-mono text-cyan-300 tabular-nums">
                        {settings.transitionDurationSec.toFixed(1)}s
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.1}
                      value={settings.transitionDurationSec}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          transitionDurationSec: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-cyan-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-300">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showDates}
                      onChange={(e) => setSettings((s) => ({ ...s, showDates: e.target.checked }))}
                      className="accent-cyan-400"
                    />
                    Show UTC Dates
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showCoordinates}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, showCoordinates: e.target.checked }))
                      }
                      className="accent-cyan-400"
                    />
                    Show RA / DEC
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showDetectorInfo}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, showDetectorInfo: e.target.checked }))
                      }
                      className="accent-cyan-400"
                    />
                    Detector Info
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showAnnotations}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, showAnnotations: e.target.checked }))
                      }
                      className="accent-cyan-400"
                    />
                    Change Annotations
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subtractZodi}
                      onChange={(e) => setSubtractZodi(e.target.checked)}
                      className="accent-cyan-400"
                    />
                    Subtract ZODI Dust
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.includeAmbientAudio}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, includeAmbientAudio: e.target.checked }))
                      }
                      className="accent-cyan-400"
                    />
                    Subtle Ambient Audio
                  </label>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 space-y-2">
              {prepError && (
                <div className="rounded border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-200">
                  {prepError}
                </div>
              )}

              <button
                type="button"
                disabled={preparing || !compatibility.compatible}
                onClick={handleGenerateVideo}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500 px-5 py-2.5 text-sm font-bold tracking-wide text-slate-950 hover:bg-cyan-400 disabled:opacity-45 transition-colors cursor-pointer"
              >
                <Film className="h-4 w-4" />
                <span>
                  {preparing
                    ? 'Aligning FITS & Generating MP4...'
                    : `GENERATE VIDEO (${timelineSequence.length} Frames)`}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* GENERATED STUDIO STAGE */}
        <div ref={studioAnchorRef} className="mt-8">
          {preparing && (
            <div className="rounded-lg border border-slate-800 bg-[#0B0E17] p-12 text-center">
              <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
              <h3 className="mt-4 text-base font-semibold text-white">
                Preparing Chronological Cosmic Time-Lapse...
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Reading SPHEREx MEF FITS cutouts, TAN-SIP WCS reprojecting onto Baseline Frame 1,
                calibrating shared flux bounds, running Space Comparison pair detection, and
                encoding H.264 MP4 video via FFmpeg.
              </p>
            </div>
          )}

          {prepared && !preparing && (
            <TimelapseStudio
              prepared={prepared}
              exportedVideo={exportedVideo}
              exportingMp4={exportingMp4}
              exportError={exportError}
              settings={settings}
              onUpdateSettings={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
              onRenderMp4={() => renderMp4FromPrepared(prepared.timelapseId, settings)}
            />
          )}
        </div>

        {/* STEP 3: HISTORICAL OBSERVATIONS PICKER GALLERY */}
        <div className="mt-8 rounded-lg border border-slate-800 bg-[#090D16]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">
                {SPHEREX_DETECTORS[selectedDetector].label} Historical Observations (
                {filteredObservations.length} matching · {selectedIds.size} selected)
              </h3>
              <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                Showing {displayedObs.length} of {filteredObservations.length} retrieved{' '}
                {selectedDetector} records ({archiveResults?.totalAcrossAllDetectors ?? 0} total
                across D1–D6).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {availableDatesForDetector.length > 0 && (
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  aria-label="Filter observations by UTC date"
                  className="rounded border border-slate-700 bg-[#07090E] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="ALL">
                    All Available Dates ({detectorAllObservations.length})
                  </option>
                  {availableDatesForDetector.map((d) => (
                    <option key={d} value={d}>
                      {d} (UTC)
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                disabled={filteredObservations.length === 0}
                onClick={handleSelectAllMatching}
                className="inline-flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-45 cursor-pointer"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Select All Matching ({filteredObservations.length})
              </button>

              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  <Square className="h-3.5 w-3.5" />
                  Deselect All
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowAllMatching((v) => !v)}
                className={`rounded border px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  showAllMatching
                    ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-700 bg-[#07090E] text-slate-300 hover:border-cyan-500/50'
                }`}
              >
                {showAllMatching
                  ? 'Paginated View'
                  : `ALL AVAILABLE OBSERVATIONS (${filteredObservations.length})`}
              </button>
            </div>
          </div>

          <div className="p-5">
            {filteredObservations.length === 0 ? (
              <div className="rounded border border-slate-800 bg-[#07090E] p-8 text-center text-xs text-slate-400">
                No {selectedDetector} observations found at ({activeRa.toFixed(3)}°,{' '}
                {activeDec.toFixed(3)}°){dateFilter !== 'ALL' ? ` on ${dateFilter}` : ''}. Try
                another detector tab or verified sky field.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {displayedObs.map((obs) => {
                    const checked = selectedIds.has(obs.id);
                    return (
                      <label
                        key={obs.id}
                        className={`flex flex-col justify-between overflow-hidden rounded-lg border transition-colors cursor-pointer ${
                          checked
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
                            <div className="flex items-start justify-between gap-2">
                              <span className="truncate font-mono font-semibold text-white">
                                {obs.obsId}
                              </span>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleObsSelection(obs.id)}
                                className="h-4 w-4 rounded accent-cyan-400 shrink-0 cursor-pointer"
                              />
                            </div>
                            <div className="font-mono text-cyan-300 tabular-nums">
                              {obs.obsDateIso
                                ? obs.obsDateIso.replace('T', ' ').replace('.000Z', ' UTC')
                                : 'Missing Observation Timestamp'}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                              {obs.detector} ·{' '}
                              {SPHEREX_DETECTORS[obs.detector].wavelengthRangeLabel} ·{' '}
                              {obs.exptimeSec ? `${obs.exptimeSec.toFixed(0)}s` : 'Exp N/A'}
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {!showAllMatching && filteredObservations.length > visibleLimit && (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4 text-xs text-slate-400">
                    <span className="font-mono tabular-nums">
                      Displaying {displayedObs.length} of {filteredObservations.length}{' '}
                      {selectedDetector} exposures
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setVisibleLimit((v) => v + 24)}
                        className="rounded border border-slate-700 bg-[#07090E] px-4 py-1.5 font-medium text-cyan-300 hover:border-cyan-500/60 cursor-pointer"
                      >
                        Load 24 More
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAllMatching(true)}
                        className="rounded border border-cyan-500/40 bg-cyan-500/10 px-4 py-1.5 font-medium text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
                      >
                        Show All {filteredObservations.length} Matching
                      </button>
                    </div>
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
