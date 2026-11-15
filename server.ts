import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  SPHEREX_COLLECTIONS,
  parseDeclination,
  parseRightAscension,
  validateComparisonCompatibility,
  validateSearchRadius,
  type CollectionId,
  type SpherexObservation,
} from './shared/astronomy.ts';
import {
  getCacheStats,
  getCachedSearch,
  getObservationById,
  saveSearchCache,
} from './server/db.ts';
import {
  loadFitsViewerPayload,
  renderFitsPreviewPng,
  type ColormapMode,
  type StretchMode,
} from './server/fits.ts';
import { searchSpherexArchive } from './server/irsa.ts';
import { runSpaceComparison } from './server/compare.ts';
import {
  exportTimelapseMp4,
  getExportedVideoPath,
  prepareCosmicTimelapse,
} from './server/timelapse.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const VALID_COLLECTION_IDS = new Set<CollectionId>(SPHEREX_COLLECTIONS.map((c) => c.id));

// In-flight deduplication for identical simultaneous cutout PNG preview requests
const inflightPreviews = new Map<string, Promise<Buffer>>();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'Beyond Space — Sky Explorer API',
      archiveEndpoint: 'https://irsa.ipac.caltech.edu/SIA',
      cache: getCacheStats(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/search', async (req, res) => {
    try {
      const raRaw = String(req.query.ra ?? '');
      const decRaw = String(req.query.dec ?? '');
      const radiusRaw = String(req.query.radius ?? '0.1');
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

      const raParsed = parseRightAscension(raRaw);
      if (!raParsed.valid || raParsed.value === null) {
        return res.status(400).json({ error: raParsed.error || 'Invalid Right Ascension' });
      }

      const decParsed = parseDeclination(decRaw);
      if (!decParsed.valid || decParsed.value === null) {
        return res.status(400).json({ error: decParsed.error || 'Invalid Declination' });
      }

      const radiusParsed = validateSearchRadius(radiusRaw);
      if (!radiusParsed.valid || radiusParsed.value === null) {
        return res.status(400).json({ error: radiusParsed.error || 'Invalid search radius' });
      }

      const colsParam = String(req.query.collections ?? '').trim();
      let collections: CollectionId[] = SPHEREX_COLLECTIONS.map((c) => c.id);
      if (colsParam) {
        const requested = colsParam
          .split(',')
          .map((s) => s.trim() as CollectionId)
          .filter((c) => VALID_COLLECTION_IDS.has(c));
        if (requested.length > 0) {
          collections = requested;
        }
      }

      if (!forceRefresh) {
        const cached = getCachedSearch(
          raParsed.value,
          decParsed.value,
          radiusParsed.value,
          collections
        );
        if (cached) {
          return res.json(cached);
        }
      }

      const archiveResult = await searchSpherexArchive(
        raParsed.value,
        decParsed.value,
        radiusParsed.value,
        collections
      );

      // Only cache full search response if all requested collections succeeded without timeout/error
      const allSucceeded = archiveResult.collectionReports.every((r) => r.status !== 'ERROR');
      if (allSucceeded) {
        saveSearchCache(
          raParsed.value,
          decParsed.value,
          radiusParsed.value,
          collections,
          archiveResult
        );
      }

      return res.json(archiveResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected IRSA archive error';
      return res.status(502).json({ error: message });
    }
  });

  app.get('/api/fits/preview', async (req, res) => {
    try {
      const id = String(req.query.id ?? '');
      if (!id) {
        return res.status(400).json({ error: 'Missing observation id' });
      }

      const obs = getObservationById(id);
      if (!obs) {
        return res.status(404).json({ error: 'Observation not found in session index. Run search again.' });
      }

      const ra = Number.isFinite(Number(req.query.ra)) ? Number(req.query.ra) : obs.ra;
      const dec = Number.isFinite(Number(req.query.dec)) ? Number(req.query.dec) : obs.dec;
      const size = Number.isFinite(Number(req.query.size)) ? Number(req.query.size) : 0.12;
      const stretch = (String(req.query.stretch || 'asinh') as StretchMode);
      const colormap = (String(req.query.cmap || 'cyan_thermal') as ColormapMode);
      const zodiSubtract = req.query.zodi === '1';

      const key = `${id}|${ra.toFixed(4)}|${dec.toFixed(4)}|${size}|${stretch}|${colormap}|${zodiSubtract}`;
      let promise = inflightPreviews.get(key);
      if (!promise) {
        promise = renderFitsPreviewPng(obs.accessUrl, ra, dec, {
          sizeDeg: size,
          stretch,
          colormap,
          zodiSubtract,
          fallbackRa: obs.ra,
          fallbackDec: obs.dec,
        }).finally(() => {
          inflightPreviews.delete(key);
        });
        inflightPreviews.set(key, promise);
      }

      const pngBuffer = await promise;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(pngBuffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to render SPHEREx FITS preview';
      return res.status(502).json({ error: message });
    }
  });

  app.get('/api/fits/data', async (req, res) => {
    try {
      const id = String(req.query.id ?? '');
      if (!id) {
        return res.status(400).json({ error: 'Missing observation id' });
      }
      const obs = getObservationById(id);
      if (!obs) {
        return res.status(404).json({ error: 'Observation not found in session index. Run search again.' });
      }

      const ra = Number.isFinite(Number(req.query.ra)) ? Number(req.query.ra) : obs.ra;
      const dec = Number.isFinite(Number(req.query.dec)) ? Number(req.query.dec) : obs.dec;
      const size = Number.isFinite(Number(req.query.size)) ? Number(req.query.size) : 0.15;

      const payload = await loadFitsViewerPayload(
        obs.id,
        obs.accessUrl,
        ra,
        dec,
        size,
        obs.ra,
        obs.dec
      );
      return res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load SPHEREx FITS data';
      return res.status(502).json({ error: message });
    }
  });

  app.get('/api/fits/download', async (req, res) => {
    try {
      const id = String(req.query.id ?? '');
      const mode = String(req.query.mode ?? 'full'); // 'full' or 'cutout'
      if (!id) {
        return res.status(400).json({ error: 'Missing observation id' });
      }

      const obs = getObservationById(id);
      if (!obs) {
        return res.status(404).json({ error: 'Observation not found in session index.' });
      }

      let targetUrl = obs.accessUrl;
      let filename = obs.fitsFilename;
      if (mode === 'cutout') {
        const ra = Number.isFinite(Number(req.query.ra)) ? Number(req.query.ra) : obs.ra;
        const dec = Number.isFinite(Number(req.query.dec)) ? Number(req.query.dec) : obs.dec;
        const size = Number.isFinite(Number(req.query.size)) ? Number(req.query.size) : 0.15;
        targetUrl = `${obs.accessUrl}?center=${ra.toFixed(6)},${dec.toFixed(6)}&size=${size.toFixed(3)}`;
        filename = `cutout_${obs.fitsFilename}`;
      }

      const upstream = await fetch(targetUrl, {
        headers: { 'User-Agent': 'BeyondSpace-SkyExplorer/1.0' },
        signal: AbortSignal.timeout(60000),
      });

      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({ error: `IRSA archive download returned HTTP ${upstream.status}` });
      }

      res.setHeader('Content-Type', 'application/fits');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const contentLen = upstream.headers.get('content-length');
      if (contentLen) res.setHeader('Content-Length', contentLen);

      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'FITS download failed';
      return res.status(502).json({ error: message });
    }
  });

  app.post('/api/compare', async (req, res) => {
    try {
      const body = req.body as {
        observationIds?: unknown;
        ra?: unknown;
        dec?: unknown;
        sizeDeg?: unknown;
        subtractZodi?: unknown;
      };

      const ids = Array.isArray(body?.observationIds)
        ? body.observationIds.map((v) => String(v)).filter(Boolean)
        : [];

      if (ids.length < 2) {
        return res.status(400).json({
          error: 'Select at least 2 observations to run Space Comparison.',
        });
      }

      if (ids.length > 6) {
        return res.status(400).json({
          error: 'Compare up to 6 exposures per analysis run to ensure reliable memory and archive timing.',
        });
      }

      const raParsed = parseRightAscension(String(body?.ra ?? ''));
      const decParsed = parseDeclination(String(body?.dec ?? ''));
      if (!raParsed.valid || raParsed.value === null || !decParsed.valid || decParsed.value === null) {
        return res.status(400).json({
          error: raParsed.error || decParsed.error || 'Valid RA and DEC coordinates are required.',
        });
      }

      const observations: SpherexObservation[] = [];
      for (const id of ids) {
        const obs = getObservationById(id);
        if (!obs) {
          return res.status(404).json({
            error: `Observation ${id} was not found in session index. Please re-run the region search first.`,
          });
        }
        observations.push(obs);
      }

      const compat = validateComparisonCompatibility(
        observations,
        raParsed.value,
        decParsed.value
      );
      if (!compat.compatible) {
        return res.status(400).json({
          error: compat.reasons.join(' '),
          compatibility: compat,
        });
      }

      const sizeDeg = Number.isFinite(Number(body?.sizeDeg))
        ? Number(body.sizeDeg)
        : 0.16;
      const subtractZodi = body?.subtractZodi !== false;

      const result = await runSpaceComparison({
        observations,
        ra: raParsed.value,
        dec: decParsed.value,
        sizeDeg,
        subtractZodi,
      });

      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Space Comparison analysis failed';
      return res.status(502).json({ error: message });
    }
  });

  app.post('/api/timelapse/prepare', async (req, res) => {
    try {
      const body = req.body as {
        observationIds?: unknown;
        ra?: unknown;
        dec?: unknown;
        radius?: unknown;
        sizeDeg?: unknown;
        subtractZodi?: unknown;
        totalMatchingArchiveRecords?: unknown;
        allowUnresolvedTimestamps?: unknown;
      };

      const ids = Array.isArray(body?.observationIds)
        ? body.observationIds.map((v) => String(v)).filter(Boolean)
        : [];

      if (ids.length < 2) {
        return res.status(400).json({
          error: 'Select at least 2 SPHEREx observations to create a chronological time-lapse.',
        });
      }

      const raParsed = parseRightAscension(String(body?.ra ?? ''));
      const decParsed = parseDeclination(String(body?.dec ?? ''));
      if (!raParsed.valid || raParsed.value === null || !decParsed.valid || decParsed.value === null) {
        return res.status(400).json({
          error: raParsed.error || decParsed.error || 'Valid RA and DEC coordinates are required.',
        });
      }

      const radiusParsed = validateSearchRadius(String(body?.radius ?? '0.1'));
      const radiusDeg = radiusParsed.valid && radiusParsed.value !== null ? radiusParsed.value : 0.1;

      const observations: SpherexObservation[] = [];
      for (const id of ids) {
        const obs = getObservationById(id);
        if (!obs) {
          return res.status(404).json({
            error: `Observation ${id} was not found in session index. Please run an archive search first.`,
          });
        }
        observations.push(obs);
      }

      const compat = validateComparisonCompatibility(observations, raParsed.value, decParsed.value);
      if (!compat.compatible) {
        return res.status(400).json({
          error: compat.reasons.join(' '),
          compatibility: compat,
        });
      }

      const sizeDeg = Number.isFinite(Number(body?.sizeDeg)) ? Number(body.sizeDeg) : 0.14;
      const subtractZodi = body?.subtractZodi !== false;
      const totalMatching = Number.isFinite(Number(body?.totalMatchingArchiveRecords))
        ? Number(body.totalMatchingArchiveRecords)
        : observations.length;

      const result = await prepareCosmicTimelapse({
        observations,
        ra: raParsed.value,
        dec: decParsed.value,
        radiusDeg,
        sizeDeg,
        subtractZodi,
        totalMatchingArchiveRecords: totalMatching,
        allowUnresolvedTimestamps: body?.allowUnresolvedTimestamps === true,
      });

      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cosmic Time-Lapse preparation failed';
      return res.status(422).json({ error: message });
    }
  });

  app.post('/api/timelapse/export', async (req, res) => {
    try {
      const body = req.body as {
        timelapseId?: unknown;
        settings?: Record<string, unknown>;
      };
      const timelapseId = String(body?.timelapseId ?? '').trim();
      if (!timelapseId) {
        return res.status(400).json({ error: 'Missing timelapseId for MP4 video export.' });
      }
      const result = await exportTimelapseMp4(timelapseId, body?.settings ?? {});
      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'MP4 video export failed';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/timelapse/video/:exportId', (req, res) => {
    const found = getExportedVideoPath(req.params.exportId);
    if (!found) {
      return res.status(404).json({ error: 'Rendered MP4 video not found on disk.' });
    }

    const stat = fs.statSync(found.path);
    const fileSize = stat.size;
    const isDownload = req.query.download === '1' || req.query.download === 'true';

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${found.filename}"`);
    }

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (Number.isNaN(start) || start < 0 || start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(chunkSize));
      return fs.createReadStream(found.path, { start, end }).pipe(res);
    }

    res.setHeader('Content-Length', String(fileSize));
    return fs.createReadStream(found.path).pipe(res);
  });

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Beyond Space — Sky Explorer server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
