import { ArrowRight, Compass, Database, ExternalLink, Layers, Telescope } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  DETECTOR_IDS,
  SPHEREX_COLLECTIONS,
  SPHEREX_DETECTORS,
  type DetectorId,
} from '../../shared/astronomy';

interface LandingPageProps {
  onOpenExplorer: (options?: { detector?: DetectorId; ra?: number; dec?: number; radius?: number }) => void;
}

export function LandingPage({ onOpenExplorer }: LandingPageProps) {
  const starCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [craftImgFailed, setCraftImgFailed] = useState(false);

  // Subtle starfield drift respecting prefers-reduced-motion
  useEffect(() => {
    const canvas = starCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rafId = 0;
    let width = 0;
    let height = 0;

    interface Star {
      x: number;
      y: number;
      r: number;
      alpha: number;
      speed: number;
    }

    let stars: Star[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      stars = Array.from({ length: 95 }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.3 + 0.3,
        alpha: Math.random() * 0.55 + 0.2,
        speed: Math.random() * 0.08 + 0.02,
      }));
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const s of stars) {
        if (!prefersReducedMotion) {
          s.y -= s.speed;
          if (s.y < -2) {
            s.y = height + 2;
            s.x = Math.random() * width;
          }
        }
        ctx.fillStyle = `rgba(226, 232, 240, ${s.alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!prefersReducedMotion) {
        rafId = requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      window.removeEventListener('resize', resize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div id="top" className="bg-[#07090E] text-slate-100">
      {/* HERO SECTION */}
      <section className="relative overflow-hidden border-b border-slate-800/80">
        {/* Background Imagery & Starfield */}
        <div className="absolute inset-0">
          {!heroImgFailed ? (
            <img
              src="/src/assets/images/hero_deep_cosmos_1794702659439.jpg"
              alt="Deep-field astronomical infrared cosmos with distant galaxies and starfields"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="h-full w-full object-cover object-center opacity-60"
            />
          ) : (
            <div className="h-full w-full bg-[radial-gradient(ellipse_at_top_right,#0e2947_0%,#07090e_70%)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-[#07090E]/75 via-[#07090E]/65 to-[#07090E]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#07090E]/95 via-[#07090E]/70 to-transparent" />
          <canvas
            ref={starCanvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          />
        </div>

        <div className="relative mx-auto max-w-[1440px] px-4 py-20 sm:px-6 sm:py-28 lg:px-8 lg:py-32">
          <div className="max-w-3xl">
            <p className="font-mono text-xs tracking-widest text-cyan-400 uppercase">
              NASA/IPAC IRSA Archive · SPHEREx Level 2 Spectral Survey
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-[4.25rem] leading-[1.06] [text-wrap:balance]">
              BEYOND SPACE
            </h1>
            <p className="mt-4 text-xl font-medium text-cyan-100/95 sm:text-2xl [text-wrap:balance]">
              Explore the Universe. Discover What Lies Beyond.
            </p>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Explore real astronomical observations captured by NASA&apos;s SPHEREx space telescope.
              Navigate the sky using celestial coordinates, investigate six individual detectors,
              and explore observations collected across different dates.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onOpenExplorer()}
                className="inline-flex items-center gap-2.5 rounded-md bg-cyan-500 px-6 py-3.5 text-sm font-semibold tracking-wide text-slate-950 hover:bg-cyan-400 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 cursor-pointer"
              >
                <span>SKY EXPLORER</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href="#detectors-overview"
                className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/70 px-5 py-3.5 text-sm font-medium text-slate-200 hover:border-slate-500 hover:text-white transition-colors"
              >
                Explore the Detectors
              </a>
            </div>
          </div>

          {/* 4-Column Verified Mission Telemetry Strip */}
          <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-800/90 bg-slate-800/80 lg:grid-cols-4">
            <div className="bg-[#0B0E17]/95 p-5 sm:p-6">
              <div className="text-xs font-medium tracking-wider text-slate-400 uppercase">
                Spectral Coverage
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold text-white tabular-nums">
                0.75 – 5.00 <span className="text-xs font-normal text-cyan-400">µm</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">Continuous NIR / MWIR</div>
            </div>
            <div className="bg-[#0B0E17]/95 p-5 sm:p-6">
              <div className="text-xs font-medium tracking-wider text-slate-400 uppercase">
                Detector Arrays
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold text-white tabular-nums">
                6 <span className="text-xs font-normal text-cyan-400">D1 – D6</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">2040 × 2040 px · 6.15&quot;/px</div>
            </div>
            <div className="bg-[#0B0E17]/95 p-5 sm:p-6">
              <div className="text-xs font-medium tracking-wider text-slate-400 uppercase">
                IRSA Collections
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold text-white tabular-nums">
                4 <span className="text-xs font-normal text-cyan-400">Live SIA2</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">DR1 &amp; QR3 Wide + Deep</div>
            </div>
            <div className="bg-[#0B0E17]/95 p-5 sm:p-6">
              <div className="text-xs font-medium tracking-wider text-slate-400 uppercase">
                Data Format
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold text-white tabular-nums">
                MEF <span className="text-xs font-normal text-cyan-400">FITS</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">Calibrated MJy/sr + Zodi</div>
            </div>
          </div>
        </div>
      </section>

      {/* ABOUT SPHEREx */}
      <section id="about-spherex" className="border-b border-slate-800/80 bg-[#090D16]">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5 flex flex-col">
              <div className="relative h-full min-h-[280px] overflow-hidden rounded-lg border border-slate-800 bg-[#0B0E17]">
                {!craftImgFailed ? (
                  <img
                    src="/src/assets/images/spherex_spacecraft_render_1794702661196.jpg"
                    alt="NASA SPHEREx space telescope featuring triple nested conical photon sunshields"
                    referrerPolicy="no-referrer"
                    onError={() => setCraftImgFailed(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-8 text-slate-500">
                    <Telescope className="h-14 w-14 text-cyan-500/70" />
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-7 flex flex-col justify-center">
              <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
                About SPHEREx
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
                All-Sky Near-Infrared Spectrophotometry from 0.75 to 5.0 Microns
              </h2>
              <p className="mt-5 text-base leading-relaxed text-slate-300">
                SPHEREx (Spectro-Photometer for the History of the Universe, Epoch of Reionization
                and Ices Explorer) is a NASA Medium-Class Explorer space observatory designed to
                measure the near-infrared spectra of hundreds of millions of galaxies and stars
                across the entire celestial sphere.
              </p>
              <p className="mt-4 text-base leading-relaxed text-slate-300">
                Using a 20-centimeter wide-field aluminum telescope, a dichroic beam splitter, and
                Linear Variable Filters (LVFs) mounted directly over six 2K × 2K H2RG focal-plane
                detector arrays, SPHEREx captures continuous spectral imaging without moving filter
                wheels—probing cosmic inflation, the extragalactic background light of the Epoch of
                Reionization, and biogenic ices (H₂O, CO₂, CO) inside molecular clouds.
              </p>

              <div className="mt-8 grid grid-cols-1 gap-6 border-t border-slate-800 pt-6 sm:grid-cols-3">
                <div>
                  <div className="text-sm font-semibold text-white">Cosmic Inflation</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    3D large-scale galaxy clustering across hundreds of millions of redshifts.
                  </p>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Galaxy Evolution</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    Deep ecliptic pole surveys tracing star formation to the first galaxies.
                  </p>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Interstellar Ices</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    MWIR bands D4–D6 resolve H₂O, CO₂, and CO ice absorption in star-forming cores.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-b border-slate-800/80 bg-[#07090E]">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
              How It Works
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
              Direct Astronomical Archive Pipeline
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Every query in Beyond Space connects directly to NASA/IPAC IRSA services—never
              simulated results or synthetic artwork.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-800 bg-slate-800 md:grid-cols-2 lg:grid-cols-4">
            <div className="bg-[#0B0E17] p-6">
              <div className="flex items-center justify-between text-cyan-400">
                <span className="font-mono text-xs font-semibold">01</span>
                <Compass className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Celestial Coordinates</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Enter J2000/ICRS Right Ascension (0°–360° or HMS) and Declination (-90° to +90° or
                DMS) with an adjustable cone search radius.
              </p>
            </div>

            <div className="bg-[#0B0E17] p-6">
              <div className="flex items-center justify-between text-cyan-400">
                <span className="font-mono text-xs font-semibold">02</span>
                <Database className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Live IRSA SIA2 Query</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Queries all four current SPHEREx spectral-image collections via IVOA Simple Image
                Access v2 with full MJD time-window pagination.
              </p>
            </div>

            <div className="bg-[#0B0E17] p-6">
              <div className="flex items-center justify-between text-cyan-400">
                <span className="font-mono text-xs font-semibold">03</span>
                <Layers className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Detector &amp; Date Isolation</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Observations are segregated strictly into D1–D6 using verified bandpass metadata and
                filtered by actual exposure timestamps (<span className="font-mono">t_min</span>).
              </p>
            </div>

            <div className="bg-[#0B0E17] p-6">
              <div className="flex items-center justify-between text-cyan-400">
                <span className="font-mono text-xs font-semibold">04</span>
                <Telescope className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">FITS Cutout &amp; Inspection</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Retrieves real Multi-Extension FITS cutouts from IRSA IBE, decodes calibrated
                Float32 <span className="font-mono">MJy/sr</span> pixels, and renders interactive
                stretch &amp; WCS overlays.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* EXPLORE THE DETECTORS */}
      <section id="detectors-overview" className="border-b border-slate-800/80 bg-[#090D16]">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
                Explore the Detectors
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
                Six Independent Focal-Plane Detector Arrays
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Select any detector below to launch Sky Explorer pre-filtered to that specific array.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenExplorer()}
              className="inline-flex items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Launch Sky Explorer
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {DETECTOR_IDS.map((detId) => {
              const det = SPHEREX_DETECTORS[detId];
              return (
                <div
                  key={det.id}
                  className="flex flex-col justify-between rounded-lg border border-slate-800 bg-[#0B0E17] p-6 hover:border-slate-700 transition-colors"
                >
                  <div>
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="font-display text-lg font-semibold text-white">{det.label}</h3>
                      <span className="font-mono text-sm font-medium text-cyan-400 tabular-nums">
                        {det.wavelengthRangeLabel}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>{det.focalPlane}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{det.spectralResolvingPower}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{det.arrayDimensions}</span>
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-slate-300">{det.scienceFocus}</p>
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-slate-800/80 pt-4">
                    <span className="font-mono text-xs text-slate-500">{det.bandpassName}</span>
                    <button
                      type="button"
                      onClick={() => onOpenExplorer({ detector: det.id })}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                    >
                      Inspect {det.id} Observations
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* MISSION INFORMATION & DATA SOURCES */}
      <section id="mission-data" className="bg-[#07090E]">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <p className="font-mono text-xs tracking-wider text-cyan-400 uppercase">
                Mission Information &amp; Data Sources
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
                Public NASA/IPAC IRSA Collections &amp; Protocols
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-300">
                Beyond Space accesses only free, publicly released NASA SPHEREx spectral-image
                products via the official Caltech/IPAC IRSA Simple Image Access v2 (SIA2) endpoint
                and IRSA Image Back End (IBE) cutout service. No proprietary data, paid APIs, or
                synthetic observations are used.
              </p>

              <div className="mt-6 divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-[#0B0E17]">
                {SPHEREX_COLLECTIONS.map((col) => (
                  <div key={col.id} className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-white">{col.id}</span>
                      <span className="text-xs text-slate-400">
                        {col.releaseLabel} · {col.surveyType}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{col.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-6">
              <p className="font-mono text-xs tracking-wider text-slate-400 uppercase">
                Official Reference Documentation
              </p>
              <div className="mt-4 divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-[#0B0E17]">
                {[
                  {
                    title: 'NASA/IPAC IRSA SPHEREx Mission Archive',
                    url: 'https://irsa.ipac.caltech.edu/Missions/spherex.html',
                    desc: 'Official mission portal, survey overview, and data release announcements.',
                  },
                  {
                    title: 'SPHEREx Archive Documentation',
                    url: 'https://irsa.ipac.caltech.edu/spherex-archive-documentation/',
                    desc: 'Level 2 Multi-Extension FITS structure (IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE).',
                  },
                  {
                    title: 'SPHEREx Data Access & SIA2 Guide',
                    url: 'https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-access/',
                    desc: 'Programmatic SIA2 and TAP access patterns for spherex_dr1 and spherex_qr3.',
                  },
                  {
                    title: 'SPHEREx Cutout Tool Documentation',
                    url: 'https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html',
                    desc: 'IRSA IBE spatial cutout parameters (?center=RA,DEC&size=SIZE).',
                  },
                  {
                    title: 'Official IRSA SIA2 Service Endpoint',
                    url: 'https://irsa.ipac.caltech.edu/SIA?',
                    desc: 'Live IVOA Simple Image Access Version 2 query endpoint queried by Sky Explorer.',
                  },
                ].map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start justify-between gap-4 p-4 hover:bg-slate-900/60 transition-colors"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{link.title}</div>
                      <div className="mt-1 text-xs text-slate-400">{link.desc}</div>
                      <div className="mt-1 font-mono text-[11px] text-cyan-400/90 break-all">
                        {link.url}
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-slate-400 mt-1" />
                  </a>
                ))}
              </div>
            </div>
          </div>

          <footer className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-slate-800/80 pt-8 text-xs text-slate-500 sm:flex-row sm:items-center">
            <div>
              Beyond Space — Sky Explorer · Powered by public NASA/IPAC IRSA SPHEREx Archive data
            </div>
            <button
              type="button"
              onClick={() => onOpenExplorer()}
              className="font-medium text-cyan-400 hover:text-cyan-300 cursor-pointer"
            >
              Open Sky Explorer →
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
