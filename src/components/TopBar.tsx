import { Menu, X } from 'lucide-react';
import { useState } from 'react';

export type AppView = 'landing' | 'explorer' | 'comparison' | 'timelapse';

interface TopBarProps {
  activeView: AppView;
  onNavigate: (view: AppView, sectionId?: string) => void;
  compareCount?: number;
}

export function TopBar({ activeView, onNavigate, compareCount = 0 }: TopBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (view: AppView, sectionId?: string) => {
    setMobileOpen(false);
    onNavigate(view, sectionId);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#07090E]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line brand wordmark (returns to landing home) */}
        <button
          type="button"
          onClick={() => handleNav('landing', 'top')}
          className="font-display text-lg font-bold tracking-wider text-slate-100 whitespace-nowrap shrink-0 hover:text-cyan-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-400 cursor-pointer"
        >
          BEYOND SPACE
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-5 lg:gap-6 text-sm font-medium text-slate-300">
          <button
            type="button"
            onClick={() => handleNav('explorer')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activeView === 'explorer'
                ? 'border-cyan-400 text-slate-100'
                : 'border-transparent hover:border-slate-600 hover:text-slate-100'
            }`}
          >
            Sky Explorer
          </button>
          <button
            type="button"
            onClick={() => handleNav('comparison')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activeView === 'comparison'
                ? 'border-cyan-400 text-slate-100'
                : 'border-transparent hover:border-slate-600 hover:text-slate-100'
            }`}
          >
            Space Comparison{compareCount > 0 ? ` (${compareCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => handleNav('timelapse')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activeView === 'timelapse'
                ? 'border-cyan-400 text-slate-100'
                : 'border-transparent hover:border-slate-600 hover:text-slate-100'
            }`}
          >
            Cosmic Time-Lapse
          </button>
          <button
            type="button"
            onClick={() => handleNav('landing', 'about-spherex')}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:border-slate-600 hover:text-slate-100 transition-colors cursor-pointer"
          >
            About
          </button>
          <button
            type="button"
            onClick={() => handleNav('landing', 'mission-data')}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:border-slate-600 hover:text-slate-100 transition-colors cursor-pointer"
          >
            Mission Data
          </button>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleNav('explorer')}
            className="hidden sm:inline-flex items-center justify-center rounded-md bg-cyan-500 px-4 py-2 text-xs font-semibold tracking-wide text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 cursor-pointer"
          >
            Sky Explorer
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className="inline-flex md:hidden items-center justify-center rounded-md border border-slate-800 p-2 text-slate-300 hover:bg-slate-900 hover:text-slate-100"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-800 bg-[#0B0E17] px-4 py-3 space-y-1">
          <button
            type="button"
            onClick={() => handleNav('landing', 'top')}
            className="block w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800/60"
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => handleNav('explorer')}
            className="block w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-cyan-300 hover:bg-slate-800/60"
          >
            Sky Explorer
          </button>
          <button
            type="button"
            onClick={() => handleNav('comparison')}
            className="block w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-cyan-300 hover:bg-slate-800/60"
          >
            Space Comparison{compareCount > 0 ? ` (${compareCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => handleNav('timelapse')}
            className="block w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-cyan-300 hover:bg-slate-800/60"
          >
            Cosmic Time-Lapse
          </button>
          <button
            type="button"
            onClick={() => handleNav('landing', 'about-spherex')}
            className="block w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800/60"
          >
            About
          </button>
          <button
            type="button"
            onClick={() => handleNav('landing', 'mission-data')}
            className="block w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800/60"
          >
            Mission Data
          </button>
        </div>
      )}
    </header>
  );
}
