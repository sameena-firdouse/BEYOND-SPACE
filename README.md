# Beyond Space — SPHEREx Sky Explorer
🌌 BEYOND SPACE
Explore the Universe. Discover What Lies Beyond.
BEYOND SPACE is an interactive space-observation exploration
platform built around publicly available data from NASA's SPHEREx
(Spectro-Photometer for the History of the Universe, Epoch of
Reionization and Ices Explorer) mission, accessed through
Caltech/IPAC's Infrared Processing and Analysis Center (IRSA)
archive.

The project aims to make large collections of historical infrared sky
observations easier to discover, inspect, compare, and view over time.
Instead of requiring users to manually locate and open many separate
astronomical images, BEYOND SPACE brings observations for a selected sky
region into one workflow:

Discover observations → Compare images → Visualize change through
time
Project principle: Turn a large archive of individual space
observations into an accessible visual investigation tool.

✨ Why this project matters
Space observatories collect enormous amounts of scientific data. A
single image is a snapshot of a region of the sky at a particular
observation time and wavelength. When many observations of the same
region are available, manually opening them one by one can make it
difficult to:
- Find every available observation covering a selected region.
- Keep track of detector, wavelength, observation time, and image
  metadata.
- Compare two observations consistently.
- Notice subtle brightness or positional differences.
- Follow a possible change across a sequence of observation dates.
BEYOND SPACE addresses this usability and analysis challenge with three
connected features: Sky Explorer, Space Comparison, and Cosmic
Time-Lapse.
🛰️ Understanding the SPHEREx data
SPHEREx is a NASA infrared space observatory designed to survey the
entire sky and collect spectra across the near-infrared wavelength
range.
Mission and data facts
  SPHEREx fact                        Value / explanation
  Wavelength coverage                 Approximately 0.75--5.0
micrometres (µm)

  Detector arrays                     6

  Nominal spectral channels           102

  Channels per detector               17

  Full-sky survey cadence             Approximately once every 6
months

  Planned primary mission             Approximately 2 years, with
four all-sky surveys

  Typical daily observing rate        Approximately 600 exposures per
day

  Detector images per exposure        6 --- one from each detector
Approximate detector images per day 3,600 (600 exposures × 6
detector images)
These are mission-level figures and operating descriptions, not a live
counter of images currently accessible through the app. Actual archive
availability depends on the data release, processing status, and the
selected region.
How do six detectors produce 102 spectral channels?
SPHEREx uses six detector arrays, each paired with a linear
variable filter (LVF). Each LVF has a wavelength response that changes
gradually across its surface.
- Each detector contributes 17 nominal spectral channels.
- Six detectors × 17 channels = 102 nominal spectral channels.
- The combined wavelength coverage is approximately 0.75--5.0 µm.
- The filters allow the observatory to measure infrared light in
  different wavelength ranges, rather than recording only one broad
  visible-light image.
The six detectors observe the sky simultaneously through their
respective optical/filter paths. As the observatory scans and revisits
the sky, overlapping observations build up the spectral coverage. The
102 channels should not be interpreted as 102 separate detector cameras
taking 102 pictures in every single exposure.
How often is the whole sky observed?
SPHEREx scans the sky in overlapping strips. As the Earth moves around
the Sun and the observatory's viewing geometry changes, the scan
coverage progresses. The mission is designed to survey the entire sky
approximately every six months, producing four all-sky surveys during
its planned two-year primary mission.
How much data is already in the archive?
As of 12 November 2026, the SPHEREx Data Release 1 (DR1) became
available through IRSA. The DR1 all-sky spectral cube products were
constructed using more than 1.2 million individual input images from
the DR1 dataset. The documentation notes that roughly 2,000 images with
significant artifacts were excluded from those cube inputs and scheduled
for re-observation.

The DR1 all-sky cube product also divides the sky into:
- 12,288 sky tiles.
- Each tile contains a 512 × 512 × 102 data cube.
- The 102 spectral channels are formed from channels 1--17 of each of
  the six detectors.
Important distinction: 1.2 million refers to individual input images
used to construct the DR1 all-sky cubes. It is not a claim that SPHEREx
has collected only 1.2 million images over its entire mission, nor is it
a count of images returned by every BEYOND SPACE search. The number of
matching images depends on the user's region, detector, selected archive
collections, and the current archive release.
🔭 The BEYOND SPACE solution
             NASA SPHEREx observations
                        │
                        ▼ 
              IRSA archive / SIA2 API
                        │
                        ▼
             ┌──────────────────────┐
             │     SKY EXPLORER    │
             │ Find past images    │
             │ for a selected sky  │
             │ region and detector │
             └──────────────────────┘
                        │
              Select observations
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
   ┌──────────────────┐  ┌──────────────────┐
   │ SPACE COMPARISON │  │ COSMIC TIME-LAPSE│
   │ Compare two      │  │ Arrange selected│
   │ observations     │  │ images by time  │
   └──────────────────┘  └──────────────────┘
             │                     │
             ▼                     ▼
     Difference map          Chronological
     and measurements        video sequence
1. 🌍 Sky Explorer --- discover observations for a region
Sky Explorer helps users search the SPHEREx archive without manually
browsing archive directories.
User inputs
The user selects or enters:
- Right Ascension (RA) --- the sky coordinate corresponding to
  celestial longitude.
- Declination (DEC) --- the sky coordinate corresponding to
  celestial latitude.
- Region dimensions / search radius --- the size of the sky area
  to search.
- Detector --- one of D1, D2, D3, D4, D5, or D6.
- Date filter --- a date range or all available dates.
What happens in the backend?
1. The frontend sends the selected coordinates, region size, detector,
   and date constraints to the backend.
2. The backend constructs a query to IRSA's Simple Image Access
   Version 2 (SIA2) service.
3. SIA2 searches the selected SPHEREx data collections for images
   matching the sky-position and other supported constraints.
4. IRSA returns image records and metadata, including image access
   URLs.
5. The backend applies the selected detector and date filters using the
   returned metadata, retrieves the matching image products or cutouts
   as required, and sends the results to the frontend.
6. Sky Explorer displays the matching historical observations as a
   browsable gallery.
What the user sees
- Image thumbnails or previews.
- Observation date/time.
- Observation identifier.
- Detector information.
- Available wavelength/channel metadata.
- Image access or download option, where supported.
All available dates means all matching observations returned by the
searched archive collections for the selected region and detector. It
does not mean all six detectors are automatically included.
Data flow
RA + DEC + Region size + Detector + Date filter
                       │
                       ▼
                 Frontend request
                       │
                       ▼
                  Backend API
                       │
                       ▼
              IRSA SIA2 query
                       │
                       ▼
           Matching image metadata/URLs
                       │
                       ▼
         Retrieve images or image cutouts
                       │
                       ▼
             Sky Explorer image gallery
2. 🌓 Space Comparison --- understand what changed
Space Comparison allows users to choose two observations of the same sky
region and inspect their differences.
User workflow
1. Open Sky Explorer and search for a region and detector.
2. Select an earlier observation (Image A).
3. Select a later observation (Image B).
4. Send both selected images to the comparison workflow.
5. View the aligned images, comparison output, and difference
   visualization.
How image comparison works
Astronomical images should not be compared by blindly subtracting their
raw pixel values. Before interpreting a difference, the processing
workflow should account for:
- WCS (World Coordinate System): maps image pixels to positions on
  the sky and supports spatial alignment.
- Pixel scale and image dimensions: ensures the images are
  compared on a compatible grid.
- Calibration and background: helps avoid mistaking instrumental
  or background offsets for real changes.
- Exposure, noise, masks, and bad pixels: identifies conditions
  that can affect pixel measurements.
- Observation metadata: confirms the region, detector, wavelength
  information, and observation times are compatible.
After suitable preprocessing, NumPy can operate on the image data
arrays to calculate pixel-wise differences and summary statistics.

For example, a basic difference array can be represented as:
difference = image_b - image_a
This simple operation is only meaningful after the images have been
appropriately aligned and prepared. It is not, by itself, a complete
astronomical source-detection or validation algorithm.
Comparison outputs
Depending on the implemented processing pipeline, the interface can
show:
- Side-by-side Image A and Image B.
- An overlay or blink comparison.
- A difference image / heatmap.
- Regions with positive or negative pixel differences.
- Brightness-change measurements or summary statistics.
- Candidate source appearance, disappearance, or positional variation
  for further inspection.
About probability and confidence
A numerical difference score is not automatically the probability that
an astronomical event occurred. NumPy can calculate differences and
statistics, but a scientifically meaningful probability requires a
defined statistical model, uncertainty treatment, and validation against
suitable data.

If the application displays a confidence or probability value, the
README and UI should explain exactly how it is calculated and validated.
Otherwise, label the output as a difference score, candidate
change, or analysis indicator, not a confirmed event probability.

Goal: Help users identify where two observations differ, while
making clear that instrumental effects and processing artifacts must be
ruled out before claiming an astrophysical discovery.
3. 🎞️ Cosmic Time-Lapse --- turn observations into a video
Cosmic Time-Lapse converts a set of selected observations into a
chronological visual sequence.
User workflow
1. Select a sky region and detector.
2. Browse the matching observations in Sky Explorer.
3. Select multiple images from that same region and detector.
4. The application reads the observation timestamps from the image
   metadata.
5. The selected frames are sorted from oldest to newest.
6. The video-generation process combines the frames into a playable
   clip.
7. The user plays the clip or exports it, where the feature is enabled.
What the video shows
The video lets users follow the selected region across observation
dates. By watching the frames in sequence, users may more easily notice:
- Changes in brightness.
- A source that appears or becomes less visible.
- A possible shift in an object's apparent position.
- Changes in the visible structure of a region.
Video controls
The intended viewer can include:
- Play / pause.
- Previous / next frame.
- Timeline and progress indicator.
- Playback speed.
- Observation date for the current frame.
- Export or download as MP4.
The exact export formats and controls depend on the current application
implementation.
Time-lapse processing flow
Selected historical observations
              │
              ▼
     Read observation timestamps
              │
              ▼
       Sort oldest → newest
              │
              ▼
   Prepare consistent image frames
              │
              ▼
      Encode frames into video
              │
              ▼
       Play / export time-lapse
The video should use actual observation images as its scientific frames.
If visual interpolation or transition effects are added between
observations, those frames must be identified as generated transitions
rather than actual SPHEREx exposures. A time-lapse can make changes
easier to notice, but it does not prove that a change is astrophysical.
🧰 Technology stack and purpose
The following table describes the technologies and roles in the project
workflow. Confirm the exact frontend framework, backend framework, and
video library against the current repository before treating every item
as an implemented dependency.
  Technology / service                Role in BEYOND SPACE
  Frontend web application        Provides the coordinate inputs,
detector selection, image gallery,
comparison interface, and video
player.

  Backend API                     Receives user inputs, queries IRSA,
processes image requests, and
returns results to the frontend.

  NASA SPHEREx archive at IRSA    Source of public SPHEREx
spectral-image and all-sky-cube
data products.

  IRSA SIA2 API                   Searches image records using sky
position and other supported
constraints; returns metadata and
image access URLs.

  NumPy                           Performs numerical operations on
image arrays, including pixel-wise
differences and summary statistics.

  FITS-reading library (for         Can be used to read astronomical
example, Astropy)                 FITS files and their headers/WCS
metadata if included in the
implementation.

  WCS tools (for example, Astropy   Can support alignment of images
WCS)                              using their celestial coordinate
information.

  OpenCV or FFmpeg                Can be used to assemble
chronological image frames into a
video, if included in the
implementation.

  GitHub                          Source-code version control and
project collaboration.
Google AI Studio                Development environment used to
build and update the application.
Frontend and backend responsibilities
USER
 │
 ▼
FRONTEND
Coordinate inputs • Detector selector • Image gallery
Comparison display • Time-lapse player
 │
 │ HTTP request
 ▼
BACKEND
Validation • Query construction • Image retrieval
Image processing • Comparison • Video generation
 │
 ├──────────────► IRSA SIA2 API
 │                  Search metadata and image URLs
 │
 └──────────────► Image-processing libraries
                    NumPy • FITS/WCS tools • Video tools
 │
 ▼
FRONTEND RESULTS
Images • Difference visualization • Video
📊 What makes BEYOND SPACE useful?
  Traditional manual workflow         BEYOND SPACE workflow
  Search archive records separately   Search by region and detector

  Open images one at a time           Browse matching observations
together

  Switch between images manually      Compare selected observations in
one interface

  Remember visual differences         View a difference visualization

  Manually arrange images by date     Automatically sort selected
observations chronologically
Imagine how a region changed        Watch a time-lapse of the selected
observations
🎯 Project objectives
1. Make public space data easier to explore through a coordinate-
   and detector-based search interface.
2. Reduce manual effort when locating historical observations of
   the same sky region.
3. Support visual investigation by comparing selected observations.
4. Make temporal patterns easier to inspect through chronological
   video generation.
5. Keep the science traceable by retaining observation dates,
   identifiers, detector metadata, and source archive references.
🔬 Scientific limitations and responsible interpretation
BEYOND SPACE is an exploration and visualization aid. It should not
label every image difference as a discovery.
- Images can differ because of noise, calibration, background,
  exposure, masks, or alignment.
- A moving source can be confused with a registration error if WCS
  alignment is inadequate.
- Different wavelength responses can produce different appearances
  even when the sky object has not physically changed.
- The same sky region and compatible detector/channel data should be
  selected for a meaningful comparison.
- Candidate changes require scientific checks before being described
  as confirmed events.
- Any confidence or probability must be backed by a documented and
  validated method.
🚀 Getting started
Prerequisites
- A modern web browser.
- Access to the BEYOND SPACE source code.
- The runtime and dependencies specified by the repository's
  package/configuration files.
- Internet access for querying public IRSA services.
Run locally
Because the exact framework and start command depend on the current
repository version, use the instructions defined in the project files:
1. Clone the repository.
2. Open the project folder.
3. Inspect README-adjacent setup files such as package.json,
   requirements.txt, or the project-specific configuration.
4. Install the dependencies listed by the project.
5. Configure any required environment variables locally. Do not commit
   API keys or secrets.
6. Run the development command defined in the repository.
7. Open the local URL printed by the development server.
Example Git commands:
git clone https://github.com/<YOUR-USERNAME>/<YOUR-REPOSITORY>.git
cd <YOUR-REPOSITORY>
Replace the placeholders with your actual GitHub username and
repository name. Do not copy a framework-specific run command unless
it matches the files in your repository.

🗂️ Suggested project structure
The actual repository structure may differ. A typical organization for
this type of application could look like:
beyond-space/
├── frontend/
│   ├── components/
│   ├── pages/
│   └── assets/
├── backend/
│   ├── routes/
│   ├── services/
│   │   ├── irsa_service
│   │   ├── image_comparison
│   │   └── video_generator
│   └── main
├── README.md
└── configuration files
🌐 NASA / IRSA resources and references
- NASA SPHEREx mission
- NASA SPHEREx mission overview and
  science
- SPHEREx Data
  Products
- SPHEREx Data Release 1
  overview
- SPHEREx Data Releases at
  IRSA
- SPHEREx Data Access and SIA2 API
  documentation
- IRSA image API
  documentation
- SPHEREx Explanatory Supplement
  (PDF)
Example SIA2 endpoint
IRSA's generic SIA2 endpoint is:
https://irsa.ipac.caltech.edu/SIA?
For SPHEREx, the query must specify the appropriate collection. Current
documented examples include spherex_dr1, spherex_qr3, and their
deep-survey counterparts. DR1 and QR3 together are the recommended
current spectral-image collections for new searches; archive
documentation should be checked for changes.
👩‍🚀 About the project
Project: BEYOND SPACE
Team: InnoVerse
Challenge: NASA Space Apps Challenge

Explore the Universe. Discover What Lies Beyond.

From millions of archived observations to a clearer way to explore,
compare, and visualize our changing view of the universe.
Beyond Space is a full-stack astronomical exploration platform connected directly to NASA/IPAC Infrared Science Archive (IRSA) public **SPHEREx** Level 2 spectral image collections.

## Features
- **Landing Experience**: Cosmic deep-field overview, SPHEREx mission science background, 6-detector spectral breakdown (D1–D6), and official IRSA documentation references.
- **Sky Explorer Coordinate Search**: Decimal (`0–360°` RA, `-90°..+90°` DEC) and sexagesimal (`HMS` / `DMS`) inputs with strict validation, adjustable cone radius (default `0.1°`), and verified SPHEREx target presets.
- **Live NASA/IPAC IRSA SIA2 Integration**: Queries `spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, and `spherex_qr3_deep` with automatic time-window subdivision on `OVERFLOW`.
- **Six Isolated Detector Galleries (D1–D6) + All Detectors Mode**: Strictly segregates observations by `SPHEREx-D1` through `SPHEREx-D6` with independent pagination and chronological sorting (newest first).
- **Date Filtering**: Switch between **ALL AVAILABLE DATES** (all historical observations for the selected detector) and **PARTICULAR DATE** (filtered strictly by actual UTC exposure timestamp `t_min`).
- **Real FITS Processing & Interactive Viewer**: Retrieves real SPHEREx Multi-Extension FITS cutouts from IRSA IBE, decodes calibrated Float32 `IMAGE` (`MJy/sr`) and `ZODI` extensions, computes WCS sky coordinates, and provides interactive pan/zoom, `Asinh`/`Linear`/`Log`/`Sqrt` stretches, colormaps, percentile clipping, zodi subtraction, raw FITS header inspection, and Original FITS / Cutout FITS / PNG downloads.
- **Space Comparison (Cosmic Change Detector)**: Compare 2–6 compatible observations of the same sky region and detector (D1–D6) with strict compatibility validation, WCS `TAN-SIP` projection & bilinear resampling, `ZODI` + 3σ-clipped background subtraction, per-pixel variance propagation, 8-category scientific signal-vs-artifact classification via SPHEREx HDU 2 `FLAGS` bitmasks, synchronized multi-mode difference viewers, and downloadable PNG/Markdown/JSON scientific comparison reports.
- **Cosmic Time-Lapse Video Creator**: Select multiple real observations of a single sky region and isolated detector (D1–D6), arrange them chronologically (oldest to newest) using actual archive observation timestamps (`t_min` MJD -> UTC), align frames via `TAN-SIP` WCS onto Baseline Frame 1 under one shared global `asinh` flux range (no per-frame auto-gain), play through 7 interactive visualization modes (including crossfades, animated difference maps, brightness changes, source appearance/disappearance overlays, and side-by-side comparison), inspect original FITS files from any frame, and export verified H.264 `.mp4` videos rendered via local FFmpeg.

## Local Development
```bash
npm install
npm run dev      # Starts Express + Vite full-stack server on http://localhost:3000
npm test         # Runs unit & live IRSA SIA2 + Space Comparison FITS tests
npm run lint     # TypeScript check
npm run build    # Builds Vite frontend bundle
```
