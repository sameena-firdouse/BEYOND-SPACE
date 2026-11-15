import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type {
  FitsHeaderCard,
  FitsImageStats,
  FitsViewerPayload,
  FitsWcsInfo,
} from '../shared/astronomy.ts';

const FITS_CACHE_DIR = '/tmp/beyond-space-fits';
const MAX_CACHE_BYTES = 180 * 1024 * 1024; // 180 MB cap on temp cutouts

if (!fs.existsSync(FITS_CACHE_DIR)) {
  fs.mkdirSync(FITS_CACHE_DIR, { recursive: true });
}

export type StretchMode = 'asinh' | 'linear' | 'log' | 'sqrt';
export type ColormapMode = 'grayscale' | 'cyan_thermal' | 'inferno' | 'viridis' | 'coolwarm';

export interface ParsedHdu {
  index: number;
  extname: string;
  xtension: string;
  bitpix: number;
  naxis: number;
  axes: number[];
  cards: FitsHeaderCard[];
  cardMap: Record<string, string>;
  rawData: Buffer;
}

function parseHeaderCards(headerBuffer: Buffer): {
  cards: FitsHeaderCard[];
  cardMap: Record<string, string>;
  hasEnd: boolean;
} {
  const cards: FitsHeaderCard[] = [];
  const cardMap: Record<string, string> = {};
  let hasEnd = false;

  for (let i = 0; i < headerBuffer.length; i += 80) {
    const line = headerBuffer.subarray(i, i + 80).toString('ascii');
    const keyword = line.slice(0, 8).trim();
    if (keyword === 'END') {
      hasEnd = true;
      break;
    }
    if (!keyword || keyword === 'COMMENT' || keyword === 'HISTORY') continue;

    if (line.startsWith('HIERARCH ')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(9, eqIdx).trim();
        const rest = line.slice(eqIdx + 1);
        const slashIdx = rest.indexOf('/');
        const val = (slashIdx !== -1 ? rest.slice(0, slashIdx) : rest)
          .trim()
          .replace(/^'(.*)'$/, '$1')
          .trim();
        const comment = slashIdx !== -1 ? rest.slice(slashIdx + 1).trim() : '';
        cards.push({ key, value: val, comment });
        cardMap[key] = val;
      }
      continue;
    }

    if (line[8] === '=') {
      const rest = line.slice(9);
      let val = '';
      let comment = '';

      const trimmedRest = rest.trimStart();
      if (trimmedRest.startsWith("'")) {
        // String card: find closing quote
        const endQuote = trimmedRest.indexOf("'", 1);
        if (endQuote !== -1) {
          val = trimmedRest.slice(1, endQuote).trim();
          const after = trimmedRest.slice(endQuote + 1);
          const slashIdx = after.indexOf('/');
          comment = slashIdx !== -1 ? after.slice(slashIdx + 1).trim() : '';
        } else {
          val = trimmedRest.slice(1).trim();
        }
      } else {
        const slashIdx = rest.indexOf('/');
        val = (slashIdx !== -1 ? rest.slice(0, slashIdx) : rest).trim();
        comment = slashIdx !== -1 ? rest.slice(slashIdx + 1).trim() : '';
      }

      cards.push({ key: keyword, value: val, comment });
      cardMap[keyword] = val;
    }
  }

  return { cards, cardMap, hasEnd };
}

export function parseFitsMef(buffer: Buffer): ParsedHdu[] {
  const hdus: ParsedHdu[] = [];
  let offset = 0;
  let index = 0;

  while (offset + 2880 <= buffer.length) {
    const headerStart = offset;
    let foundEnd = false;
    while (offset + 2880 <= buffer.length && !foundEnd) {
      const block = buffer.subarray(offset, offset + 2880);
      offset += 2880;
      for (let i = 0; i < 2880; i += 80) {
        if (block.subarray(i, i + 4).toString('ascii') === 'END ') {
          foundEnd = true;
          break;
        }
      }
    }

    if (!foundEnd) break;

    const headerBuf = buffer.subarray(headerStart, offset);
    const { cards, cardMap } = parseHeaderCards(headerBuf);

    const bitpix = parseInt(cardMap['BITPIX'] || '0', 10);
    const naxis = parseInt(cardMap['NAXIS'] || '0', 10);
    const axes: number[] = [];
    for (let a = 1; a <= naxis; a++) {
      axes.push(parseInt(cardMap[`NAXIS${a}`] || '0', 10));
    }

    let dataBytes = 0;
    if (naxis > 0) {
      const elemCount = axes.reduce((acc, v) => acc * v, 1);
      const pcount = parseInt(cardMap['PCOUNT'] || '0', 10);
      const gcount = parseInt(cardMap['GCOUNT'] || '1', 10);
      dataBytes = (Math.abs(bitpix) / 8) * gcount * (pcount + elemCount);
    }

    const paddedBytes = Math.ceil(dataBytes / 2880) * 2880;
    const rawData =
      dataBytes > 0 && offset + dataBytes <= buffer.length
        ? buffer.subarray(offset, offset + dataBytes)
        : Buffer.alloc(0);

    hdus.push({
      index,
      extname: (cardMap['EXTNAME'] || (index === 0 ? 'PRIMARY' : `HDU_${index}`)).toUpperCase(),
      xtension: (cardMap['XTENSION'] || (index === 0 ? 'PRIMARY' : '')).toUpperCase(),
      bitpix,
      naxis,
      axes,
      cards,
      cardMap,
      rawData,
    });

    offset += paddedBytes;
    index++;
  }

  return hdus;
}

export function decodeHduToFloat32(hdu: ParsedHdu): Float32Array {
  const width = hdu.axes[0] || 0;
  const height = hdu.axes[1] || 0;
  const count = width * height;
  const out = new Float32Array(count);

  const bzero = hdu.cardMap['BZERO'] ? Number(hdu.cardMap['BZERO']) : 0;
  const bscale = hdu.cardMap['BSCALE'] ? Number(hdu.cardMap['BSCALE']) : 1;

  if (hdu.bitpix === -32) {
    for (let i = 0; i < count; i++) {
      const byteOff = i * 4;
      if (byteOff + 4 <= hdu.rawData.length) {
        const val = hdu.rawData.readFloatBE(byteOff);
        out[i] = Number.isFinite(val) ? val * bscale + bzero : Number.NaN;
      } else {
        out[i] = Number.NaN;
      }
    }
  } else if (hdu.bitpix === -64) {
    for (let i = 0; i < count; i++) {
      const byteOff = i * 8;
      if (byteOff + 8 <= hdu.rawData.length) {
        const val = hdu.rawData.readDoubleBE(byteOff);
        out[i] = Number.isFinite(val) ? val * bscale + bzero : Number.NaN;
      } else {
        out[i] = Number.NaN;
      }
    }
  } else if (hdu.bitpix === 16) {
    const blank = hdu.cardMap['BLANK'] !== undefined ? Number(hdu.cardMap['BLANK']) : null;
    for (let i = 0; i < count; i++) {
      const byteOff = i * 2;
      if (byteOff + 2 <= hdu.rawData.length) {
        const raw = hdu.rawData.readInt16BE(byteOff);
        out[i] = blank !== null && raw === blank ? Number.NaN : raw * bscale + bzero;
      }
    }
  } else if (hdu.bitpix === 32) {
    const blank = hdu.cardMap['BLANK'] !== undefined ? Number(hdu.cardMap['BLANK']) : null;
    for (let i = 0; i < count; i++) {
      const byteOff = i * 4;
      if (byteOff + 4 <= hdu.rawData.length) {
        const raw = hdu.rawData.readInt32BE(byteOff);
        out[i] = blank !== null && raw === blank ? Number.NaN : raw * bscale + bzero;
      }
    }
  } else if (hdu.bitpix === 8) {
    for (let i = 0; i < count; i++) {
      out[i] = (hdu.rawData[i] ?? 0) * bscale + bzero;
    }
  }

  return out;
}

export function decodeHduToInt32(hdu: ParsedHdu): Int32Array {
  const width = hdu.axes[0] || 0;
  const height = hdu.axes[1] || 0;
  const count = width * height;
  const out = new Int32Array(count);
  if (hdu.bitpix === 32) {
    for (let i = 0; i < count; i++) {
      const byteOff = i * 4;
      if (byteOff + 4 <= hdu.rawData.length) {
        out[i] = hdu.rawData.readInt32BE(byteOff);
      }
    }
  } else if (hdu.bitpix === 16) {
    for (let i = 0; i < count; i++) {
      const byteOff = i * 2;
      if (byteOff + 2 <= hdu.rawData.length) {
        out[i] = hdu.rawData.readInt16BE(byteOff);
      }
    }
  }
  return out;
}

export function extractWcs(cardMap: Record<string, string>): FitsWcsInfo | null {
  const crval1 = Number(cardMap['CRVAL1']);
  const crval2 = Number(cardMap['CRVAL2']);
  const crpix1 = Number(cardMap['CRPIX1']);
  const crpix2 = Number(cardMap['CRPIX2']);
  if (![crval1, crval2, crpix1, crpix2].every(Number.isFinite)) return null;

  const cdelt1 = Number(cardMap['CDELT1'] ?? 1);
  const cdelt2 = Number(cardMap['CDELT2'] ?? 1);

  let cd1_1 = Number(cardMap['CD1_1']);
  let cd1_2 = Number(cardMap['CD1_2']);
  let cd2_1 = Number(cardMap['CD2_1']);
  let cd2_2 = Number(cardMap['CD2_2']);

  if (![cd1_1, cd1_2, cd2_1, cd2_2].every(Number.isFinite)) {
    const pc1_1 = Number(cardMap['PC1_1']);
    const pc1_2 = Number(cardMap['PC1_2'] ?? 0);
    const pc2_1 = Number(cardMap['PC2_1'] ?? 0);
    const pc2_2 = Number(cardMap['PC2_2']);
    if (Number.isFinite(pc1_1) && Number.isFinite(pc2_2)) {
      cd1_1 = pc1_1 * cdelt1;
      cd1_2 = pc1_2 * cdelt1;
      cd2_1 = pc2_1 * cdelt2;
      cd2_2 = pc2_2 * cdelt2;
    } else {
      // Fallback: 6.15 arcsec/px = 0.00170833 deg/px
      cd1_1 = Number.isFinite(cdelt1) && cdelt1 !== 1 ? cdelt1 : -6.15 / 3600;
      cd1_2 = 0;
      cd2_1 = 0;
      cd2_2 = Number.isFinite(cdelt2) && cdelt2 !== 1 ? cdelt2 : 6.15 / 3600;
    }
  }

  return {
    crval1,
    crval2,
    crpix1,
    crpix2,
    cd1_1,
    cd1_2,
    cd2_1,
    cd2_2,
    ctype1: cardMap['CTYPE1'] || 'RA---TAN',
    ctype2: cardMap['CTYPE2'] || 'DEC--TAN',
  };
}

export function computeImageStats(
  pixels: Float32Array,
  width: number,
  height: number,
  hasZodi: boolean,
  bunit: string
): FitsImageStats {
  const valid: number[] = [];
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    if (Number.isFinite(v)) {
      valid.push(v);
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  if (valid.length === 0) {
    return {
      width,
      height,
      min: 0,
      max: 0,
      median: 0,
      mean: 0,
      stdDev: 0,
      p01: 0,
      p05: 0,
      p1: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      p995: 0,
      p999: 0,
      validPixels: 0,
      totalPixels: pixels.length,
      hasZodi,
      bunit,
    };
  }

  valid.sort((a, b) => a - b);
  const q = (p: number) => valid[Math.min(valid.length - 1, Math.max(0, Math.floor((valid.length - 1) * p)))];
  const mean = sum / valid.length;
  let sqDiff = 0;
  for (let i = 0; i < valid.length; i++) {
    const d = valid[i] - mean;
    sqDiff += d * d;
  }

  return {
    width,
    height,
    min,
    max,
    median: q(0.5),
    mean,
    stdDev: Math.sqrt(sqDiff / valid.length),
    p01: q(0.001),
    p05: q(0.005),
    p1: q(0.01),
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    p995: q(0.995),
    p999: q(0.999),
    validPixels: valid.length,
    totalPixels: pixels.length,
    hasZodi,
    bunit,
  };
}

function pruneTempCacheIfNeeded(): void {
  try {
    const files = fs
      .readdirSync(FITS_CACHE_DIR)
      .map((name) => {
        const full = path.join(FITS_CACHE_DIR, name);
        const st = fs.statSync(full);
        return { full, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);

    let total = files.reduce((s, f) => s + f.size, 0);
    for (const f of files) {
      if (total <= MAX_CACHE_BYTES) break;
      fs.unlinkSync(f.full);
      total -= f.size;
    }
  } catch {
    // Ignore cleanup errors
  }
}

export async function fetchCutoutFitsBuffer(
  accessUrl: string,
  ra: number,
  dec: number,
  sizeDeg: number
): Promise<{ buffer: Buffer; cutoutUrlUsed: string }> {
  const safeSize = Math.min(Math.max(sizeDeg, 0.05), 0.6);
  const cutoutUrl = `${accessUrl}?center=${ra.toFixed(6)},${dec.toFixed(6)}&size=${safeSize.toFixed(3)}`;
  const hash = crypto.createHash('sha1').update(cutoutUrl).digest('hex');
  const cachePath = path.join(FITS_CACHE_DIR, `${hash}.fits`);

  if (fs.existsSync(cachePath)) {
    const buf = fs.readFileSync(cachePath);
    if (buf.length > 2880) {
      return { buffer: buf, cutoutUrlUsed: cutoutUrl };
    }
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(cutoutUrl, {
        headers: { 'User-Agent': 'BeyondSpace-SkyExplorer/1.0' },
        signal: AbortSignal.timeout(30000),
      });

      if (resp.status === 503 || resp.status === 429) {
        const retryAfter = Number(resp.headers.get('retry-after') || '4');
        await new Promise((r) => setTimeout(r, Math.min(Math.max(retryAfter, 2), 7) * 1000));
        continue;
      }

      if (!resp.ok) {
        throw new Error(`IRSA cutout service returned HTTP ${resp.status}`);
      }

      const arr = await resp.arrayBuffer();
      const buf = Buffer.from(arr);
      if (buf.length < 2880 || !buf.subarray(0, 6).toString('ascii').startsWith('SIMPLE')) {
        throw new Error('IRSA cutout response was not a valid FITS file.');
      }

      pruneTempCacheIfNeeded();
      fs.writeFileSync(cachePath, buf);
      return { buffer: buf, cutoutUrlUsed: cutoutUrl };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  throw lastErr || new Error('Failed to retrieve SPHEREx FITS cutout from IRSA.');
}

export async function fetchCutoutWithFallback(
  accessUrl: string,
  requestedRa: number,
  requestedDec: number,
  fallbackRa: number,
  fallbackDec: number,
  sizeDeg: number
): Promise<{ buffer: Buffer; cutoutUrlUsed: string; centerRa: number; centerDec: number }> {
  try {
    const res = await fetchCutoutFitsBuffer(accessUrl, requestedRa, requestedDec, sizeDeg);
    return { ...res, centerRa: requestedRa, centerDec: requestedDec };
  } catch (err) {
    const dist = Math.hypot(requestedRa - fallbackRa, requestedDec - fallbackDec);
    if (dist > 0.01) {
      const res = await fetchCutoutFitsBuffer(accessUrl, fallbackRa, fallbackDec, sizeDeg);
      return { ...res, centerRa: fallbackRa, centerDec: fallbackDec };
    }
    throw err;
  }
}

export async function loadFitsViewerPayload(
  observationId: string,
  accessUrl: string,
  ra: number,
  dec: number,
  sizeDeg = 0.15,
  fallbackRa = ra,
  fallbackDec = dec
): Promise<FitsViewerPayload> {
  const { buffer, cutoutUrlUsed, centerRa, centerDec } = await fetchCutoutWithFallback(
    accessUrl,
    ra,
    dec,
    fallbackRa,
    fallbackDec,
    sizeDeg
  );
  const hdus = parseFitsMef(buffer);

  const primaryHdu = hdus[0];
  const imageHdu =
    hdus.find((h) => h.extname === 'IMAGE') ||
    hdus.find((h) => h.naxis === 2 && h.xtension === 'IMAGE');

  if (!imageHdu) {
    throw new Error('FITS file does not contain a valid 2D IMAGE extension.');
  }

  const width = imageHdu.axes[0] || 0;
  const height = imageHdu.axes[1] || 0;
  const imagePixels = decodeHduToFloat32(imageHdu);

  const zodiHdu = hdus.find((h) => h.extname === 'ZODI' && h.naxis === 2);
  const zodiPixels =
    zodiHdu && zodiHdu.axes[0] === width && zodiHdu.axes[1] === height
      ? decodeHduToFloat32(zodiHdu)
      : null;

  const bunit = imageHdu.cardMap['BUNIT'] || 'MJy / sr';
  const stats = computeImageStats(imagePixels, width, height, zodiPixels !== null, bunit);
  const wcs = extractWcs(imageHdu.cardMap);

  const imageFloat32Base64 = Buffer.from(
    imagePixels.buffer,
    imagePixels.byteOffset,
    imagePixels.byteLength
  ).toString('base64');

  const zodiFloat32Base64 = zodiPixels
    ? Buffer.from(zodiPixels.buffer, zodiPixels.byteOffset, zodiPixels.byteLength).toString('base64')
    : null;

  return {
    observationId,
    cutoutCenterRa: centerRa,
    cutoutCenterDec: centerDec,
    cutoutSizeDeg: sizeDeg,
    stats,
    wcs,
    headers: {
      primary: primaryHdu ? primaryHdu.cards : [],
      image: imageHdu.cards,
    },
    imageFloat32Base64,
    zodiFloat32Base64,
    sourceFitsUrl: accessUrl,
    cutoutUrlUsed,
    retrievedAt: new Date().toISOString(),
  };
}

function sampleColormap(t: number, cmap: ColormapMode): [number, number, number] {
  const c = Math.min(1, Math.max(0, t));
  if (cmap === 'grayscale') {
    const v = Math.round(c * 255);
    return [v, v, v];
  }
  if (cmap === 'cyan_thermal') {
    // Deep obsidian -> midnight teal -> calibrated cyan -> crisp ice white
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

export async function renderFitsPreviewPng(
  accessUrl: string,
  ra: number,
  dec: number,
  options: {
    sizeDeg?: number;
    stretch?: StretchMode;
    colormap?: ColormapMode;
    zodiSubtract?: boolean;
    fallbackRa?: number;
    fallbackDec?: number;
  } = {}
): Promise<Buffer> {
  const sizeDeg = options.sizeDeg ?? 0.12;
  const stretch = options.stretch ?? 'asinh';
  const colormap = options.colormap ?? 'cyan_thermal';

  const { buffer } = await fetchCutoutWithFallback(
    accessUrl,
    ra,
    dec,
    options.fallbackRa ?? ra,
    options.fallbackDec ?? dec,
    sizeDeg
  );
  const hdus = parseFitsMef(buffer);
  const imageHdu =
    hdus.find((h) => h.extname === 'IMAGE') ||
    hdus.find((h) => h.naxis === 2 && h.xtension === 'IMAGE');

  if (!imageHdu) {
    throw new Error('FITS cutout missing IMAGE extension.');
  }

  const width = imageHdu.axes[0] || 0;
  const height = imageHdu.axes[1] || 0;
  const pixels = decodeHduToFloat32(imageHdu);

  if (options.zodiSubtract) {
    const zodiHdu = hdus.find((h) => h.extname === 'ZODI' && h.naxis === 2);
    if (zodiHdu && zodiHdu.axes[0] === width && zodiHdu.axes[1] === height) {
      const zodi = decodeHduToFloat32(zodiHdu);
      for (let i = 0; i < pixels.length; i++) {
        if (Number.isFinite(pixels[i]) && Number.isFinite(zodi[i])) {
          pixels[i] -= zodi[i];
        }
      }
    }
  }

  const stats = computeImageStats(pixels, width, height, false, 'MJy/sr');
  const vmin = stats.p1;
  const vmax = stats.p995 > vmin ? stats.p995 : stats.max;
  const range = vmax - vmin > 1e-12 ? vmax - vmin : 1;

  // Upscale small cutouts cleanly with nearest-neighbor (no blurry interpolation!) to min 240px for crisp thumbnails
  const scale = width > 0 && width < 220 ? Math.ceil(220 / width) : 1;
  const outW = width * scale;
  const outH = height * scale;

  const png = new PNG({ width: outW, height: outH });

  for (let fy = 0; fy < height; fy++) {
    // Standard FITS orientation: y=0 is bottom, PNG y=0 is top
    const pngBaseY = (height - 1 - fy) * scale;
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

      for (let sy = 0; sy < scale; sy++) {
        const py = pngBaseY + sy;
        for (let sx = 0; sx < scale; sx++) {
          const px = fx * scale + sx;
          const idx = (py * outW + px) * 4;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = 255;
        }
      }
    }
  }

  return PNG.sync.write(png);
}
