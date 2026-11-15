import { useCallback, useMemo, useState } from 'react';
import type {
  DetectorFilterMode,
  DetectorId,
  SearchResponse,
  SpherexObservation,
} from '../shared/astronomy';
import { LandingPage } from './components/LandingPage';
import { SkyExplorer } from './components/SkyExplorer';
import { SpaceComparison } from './components/SpaceComparison';
import { TopBar, type AppView } from './components/TopBar';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('landing');
  const [explorerConfig, setExplorerConfig] = useState<{
    detector: DetectorFilterMode;
    ra: number;
    dec: number;
    radius: number;
  }>({
    detector: 'D1',
    ra: 156.093,
    dec: -41.644,
    radius: 0.1,
  });

  const [latestExplorerResult, setLatestExplorerResult] = useState<SearchResponse | null>(null);
  const [compareQueue, setCompareQueue] = useState<SpherexObservation[]>([]);

  const compareQueueIds = useMemo(
    () => new Set(compareQueue.map((o) => o.id)),
    [compareQueue]
  );

  const handleAddToQueue = useCallback((obs: SpherexObservation) => {
    setCompareQueue((prev) => {
      if (prev.some((item) => item.id === obs.id)) return prev;
      if (prev.length >= 6) return prev;
      return [...prev, obs];
    });
  }, []);

  const handleRemoveFromQueue = useCallback((obsId: string) => {
    setCompareQueue((prev) => prev.filter((item) => item.id !== obsId));
  }, []);

  const handleToggleCompare = useCallback((obs: SpherexObservation) => {
    setCompareQueue((prev) => {
      if (prev.some((item) => item.id === obs.id)) {
        return prev.filter((item) => item.id !== obs.id);
      }
      if (prev.length >= 6) return prev;
      return [...prev, obs];
    });
  }, []);

  const handleClearQueue = useCallback(() => {
    setCompareQueue([]);
  }, []);

  const handleNavigate = (view: AppView, sectionId?: string) => {
    setActiveView(view);
    if (view === 'landing' && sectionId) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = document.getElementById(sectionId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth' });
          } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }, 40);
      });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleOpenExplorer = (options?: {
    detector?: DetectorId;
    ra?: number;
    dec?: number;
    radius?: number;
  }) => {
    if (options) {
      setExplorerConfig((prev) => ({
        detector: options.detector ?? prev.detector,
        ra: options.ra ?? prev.ra,
        dec: options.dec ?? prev.dec,
        radius: options.radius ?? prev.radius,
      }));
    }
    setActiveView('explorer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100">
      <TopBar
        activeView={activeView}
        onNavigate={handleNavigate}
        compareCount={compareQueue.length}
      />
      <main>
        {activeView === 'landing' ? (
          <LandingPage onOpenExplorer={handleOpenExplorer} />
        ) : activeView === 'comparison' ? (
          <SpaceComparison
            sharedQueue={compareQueue}
            onAddToQueue={handleAddToQueue}
            onRemoveFromQueue={handleRemoveFromQueue}
            onClearQueue={handleClearQueue}
            latestExplorerResult={latestExplorerResult}
          />
        ) : (
          <SkyExplorer
            initialDetector={explorerConfig.detector}
            initialRa={explorerConfig.ra}
            initialDec={explorerConfig.dec}
            initialRadius={explorerConfig.radius}
            onSearchComplete={setLatestExplorerResult}
            compareQueueIds={compareQueueIds}
            onToggleCompare={handleToggleCompare}
            onOpenComparison={() => handleNavigate('comparison')}
          />
        )}
      </main>
    </div>
  );
}
