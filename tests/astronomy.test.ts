import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DETECTOR_IDS,
  mjdToIso,
  mjdToUtcDate,
  parseDeclination,
  parseDetectorFromRecord,
  parseRightAscension,
  validateComparisonCompatibility,
  validateSearchRadius,
  type SpherexObservation,
} from '../shared/astronomy.ts';
import { computeImageStats, parseFitsMef } from '../server/fits.ts';
import { searchSpherexArchive } from '../server/irsa.ts';
import { parseVotableXml } from '../server/irsa.ts';
import {
  pixelToSkyTanSip,
  runSpaceComparison,
  skyToPixelTanSip,
} from '../server/compare.ts';

test('RA validation accepts 0..360 decimal and HMS, rejects out of range', () => {
  assert.equal(parseRightAscension('156.093').value, 156.093);
  assert.equal(parseRightAscension('0').value, 0);
  assert.equal(parseRightAscension('360').value, 0);
  assert.equal(parseRightAscension('-1').valid, false);
  assert.equal(parseRightAscension('360.5').valid, false);
  assert.equal(parseRightAscension('').valid, false);

  const hms = parseRightAscension('10:24:22.32');
  assert.equal(hms.valid, true);
  assert.ok(Math.abs((hms.value ?? 0) - 156.093) < 0.001);
});

test('DEC validation accepts -90..+90 decimal and DMS, rejects out of range', () => {
  assert.equal(parseDeclination('-41.644').value, -41.644);
  assert.equal(parseDeclination('90').value, 90);
  assert.equal(parseDeclination('-90').value, -90);
  assert.equal(parseDeclination('90.1').valid, false);
  assert.equal(parseDeclination('-95').valid, false);

  const dms = parseDeclination('-41:38:38.4');
  assert.equal(dms.valid, true);
  assert.ok(Math.abs((dms.value ?? 0) + 41.644) < 0.001);
});

test('Search radius validation enforces 0.005..2.0 degrees', () => {
  assert.equal(validateSearchRadius('0.1').valid, true);
  assert.equal(validateSearchRadius('0.001').valid, false);
  assert.equal(validateSearchRadius('5.0').valid, false);
  assert.equal(validateSearchRadius('abc').valid, false);
});

test('MJD converts accurately to UTC observation date without using release date', () => {
  const mjd = 61177.275636; // 2026-05-17T06:36:54.950Z
  assert.equal(mjdToUtcDate(mjd), '2026-05-17');
  assert.ok(mjdToIso(mjd)?.startsWith('2026-05-17T06:36:'));
});

test('Detector assignment strictly distinguishes D1..D6 without guessing', () => {
  for (const det of DETECTOR_IDS) {
    assert.equal(parseDetectorFromRecord(`SPHEREx-${det}`, null, null), det);
    assert.equal(parseDetectorFromRecord(null, `ivo://irsa.ipac/spherex_qr3?obs/${det}`, null), det);
  }
  assert.equal(parseDetectorFromRecord('UNKNOWN', null, null), null);
});

test('VOTable XML parser extracts fields and rows cleanly', () => {
  const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
  <VOTABLE version="1.3">
    <RESOURCE type="results">
      <INFO name="QUERY_STATUS" value="OK"/>
      <TABLE>
        <FIELD name="s_ra" datatype="double"/>
        <FIELD name="energy_bandpassname" datatype="char"/>
        <DATA><TABLEDATA>
          <TR><TD>156.259</TD><TD>SPHEREx-D3</TD></TR>
          <TR><TD>156.248</TD><TD>SPHEREx-D6</TD></TR>
        </TABLEDATA></TABLE>
      </TABLE>
    </RESOURCE>
  </VOTABLE>`;

  const parsed = parseVotableXml(sampleXml);
  assert.equal(parsed.queryStatus, 'OK');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].energy_bandpassname, 'SPHEREx-D3');
  assert.equal(parsed.rows[1].energy_bandpassname, 'SPHEREx-D6');
});

test('FITS MEF binary parser decodes PRIMARY + Float32 IMAGE HDU accurately', () => {
  const padCard = (s: string) => s.padEnd(80, ' ');
  const makeHeaderBlock = (cards: string[]) => {
    const buf = Buffer.alloc(2880, 0x20);
    cards.forEach((c, i) => buf.write(padCard(c), i * 80, 'ascii'));
    return buf;
  };

  const primaryHeader = makeHeaderBlock([
    'SIMPLE  =                    T',
    'BITPIX  =                    8',
    'NAXIS   =                    0',
    'EXTEND  =                    T',
    'END',
  ]);

  const imgHeader = makeHeaderBlock([
    "XTENSION= 'IMAGE   '",
    'BITPIX  =                  -32',
    'NAXIS   =                    2',
    'NAXIS1  =                    2',
    'NAXIS2  =                    2',
    'PCOUNT  =                    0',
    'GCOUNT  =                    1',
    "EXTNAME = 'IMAGE   '",
    "BUNIT   = 'MJy / sr'",
    'END',
  ]);

  const dataBlock = Buffer.alloc(2880, 0);
  dataBlock.writeFloatBE(1.5, 0);
  dataBlock.writeFloatBE(2.5, 4);
  dataBlock.writeFloatBE(3.5, 8);
  dataBlock.writeFloatBE(4.5, 12);

  const mef = Buffer.concat([primaryHeader, imgHeader, dataBlock]);
  const hdus = parseFitsMef(mef);
  assert.equal(hdus.length, 2);
  assert.equal(hdus[1].extname, 'IMAGE');
  assert.deepEqual(hdus[1].axes, [2, 2]);
  assert.equal(hdus[1].rawData.readFloatBE(12), 4.5);

  const stats = computeImageStats(new Float32Array([1.5, 2.5, 3.5, 4.5]), 2, 2, false, 'MJy / sr');
  assert.equal(stats.min, 1.5);
  assert.equal(stats.max, 4.5);
  assert.equal(stats.validPixels, 4);
});

test('Space Comparison compatibility rejects mixed detectors, distant regions, and duplicates', () => {
  const makeObs = (overrides: Partial<SpherexObservation>): SpherexObservation => ({
    id: 'obs-1',
    obsId: '2026-100_0001_0001_D3',
    obsPublisherDid: 'ivo://irsa.ipac/spherex_qr3?obs/2026-100_0001_0001_D3',
    collection: 'spherex_qr3',
    dataRelease: 'QR3',
    processingVersion: 'v1',
    detector: 'D3',
    bandpassName: 'SPHEREx-D3',
    ra: 156.093,
    dec: -41.644,
    tMinMjd: 61100.5,
    tMaxMjd: 61100.502,
    obsDateUtc: '2026-03-01',
    obsDateIso: '2026-03-01T12:00:00.000Z',
    obsReleaseDate: '2026-05-01',
    resolvingPower: 41,
    targetName: null,
    exptimeSec: 112.5,
    wavelengthMinUm: 1.63,
    wavelengthMaxUm: 2.42,
    pixelScaleArcsec: 6.15,
    fovDeg: 3.485,
    accessUrl: 'https://irsa.ipac.caltech.edu/ibe/data/spherex/sample.fits',
    fitsFilename: 'sample.fits',
    estSizeKb: 42000,
    archiveSourceUrl: 'https://irsa.ipac.caltech.edu/SIA',
    ...overrides,
  });

  const a = makeObs({ id: 'a', obsId: 'A', tMinMjd: 61100.5, obsDateUtc: '2026-03-01' });
  const bSameDet = makeObs({ id: 'b', obsId: 'B', tMinMjd: 61140.5, obsDateUtc: '2026-04-10' });
  const cDiffDet = makeObs({
    id: 'c',
    obsId: 'C',
    detector: 'D5',
    bandpassName: 'SPHEREx-D5',
    wavelengthMinUm: 3.82,
    wavelengthMaxUm: 4.42,
  });
  const dFar = makeObs({ id: 'd', obsId: 'D', ra: 200.0, dec: 15.0 });

  assert.equal(validateComparisonCompatibility([a]).compatible, false);
  assert.equal(validateComparisonCompatibility([a, a]).compatible, false);
  assert.equal(validateComparisonCompatibility([a, cDiffDet]).compatible, false);
  assert.equal(validateComparisonCompatibility([a, dFar], 156.093, -41.644).compatible, false);

  const ok = validateComparisonCompatibility([a, bSameDet], 156.093, -41.644);
  assert.equal(ok.compatible, true);
  assert.equal(ok.detector, 'D3');
});

test('TAN-SIP WCS forward and inverse transformations invert to sub-millipixel accuracy', () => {
  const wcs = {
    crval1: 156.093,
    crval2: -41.644,
    crpix1: 48.5,
    crpix2: 48.5,
    cd1_1: -0.001708,
    cd1_2: 0.00012,
    cd2_1: 0.00012,
    cd2_2: 0.001708,
    invCd1_1: 0,
    invCd1_2: 0,
    invCd2_1: 0,
    invCd2_2: 0,
    aCoeffs: [
      { p: 2, q: 0, val: 1.5e-5 },
      { p: 1, q: 1, val: -2.0e-5 },
    ],
    bCoeffs: [
      { p: 0, q: 2, val: 1.8e-5 },
      { p: 2, q: 1, val: 3.0e-7 },
    ],
  };
  const det = wcs.cd1_1 * wcs.cd2_2 - wcs.cd1_2 * wcs.cd2_1;
  wcs.invCd1_1 = wcs.cd2_2 / det;
  wcs.invCd1_2 = -wcs.cd1_2 / det;
  wcs.invCd2_1 = -wcs.cd2_1 / det;
  wcs.invCd2_2 = wcs.cd1_1 / det;

  const sky = pixelToSkyTanSip(wcs, 72.35, 19.8);
  const back = skyToPixelTanSip(wcs, sky.ra, sky.dec);
  assert.ok(back !== null);
  assert.ok(Math.abs(back.x - 72.35) < 1e-3);
  assert.ok(Math.abs(back.y - 19.8) < 1e-3);
});

test('Live IRSA SIA2 query + Space Comparison pipeline analyzes two real SPHEREx D3 epochs', async () => {
  const res = await searchSpherexArchive(156.093, -41.644, 0.05, [
    'spherex_dr1',
    'spherex_qr3',
  ]);

  assert.ok(res.totalAcrossAllDetectors > 0, 'Expected real SPHEREx observations at (156.093, -41.644)');

  for (const det of DETECTOR_IDS) {
    const list = res.byDetector[det];
    for (const obs of list) {
      assert.equal(obs.detector, det, `Detector mismatch in ${det} array`);
      assert.equal(obs.bandpassName, `SPHEREx-${det}`);
    }
    for (let i = 1; i < list.length; i++) {
      assert.ok(
        (list[i - 1].tMinMjd ?? 0) >= (list[i].tMinMjd ?? 0),
        `${det} is not sorted newest-first`
      );
    }
  }

  // Verify specific date filtering never mixes dates
  const sampleDate = res.availableDatesUtc[0];
  assert.ok(sampleDate, 'Expected at least one actual UTC observation date');
  const d3OnDate = res.byDetector.D3.filter((o) => o.obsDateUtc === sampleDate);
  for (const obs of d3OnDate) {
    assert.equal(obs.obsDateUtc, sampleDate);
    assert.equal(obs.detector, 'D3');
  }

  // Pick 2 real observations from the best-populated detector across distinct timestamps
  const detWithMultiple = DETECTOR_IDS.find((d) => res.byDetector[d].length >= 2);
  assert.ok(detWithMultiple, 'Expected at least one detector with >=2 real observations');
  const candidates = res.byDetector[detWithMultiple];
  const refObs = candidates[candidates.length - 1];
  const tgtObs = candidates[0];

  const comparison = await runSpaceComparison({
    observations: [refObs, tgtObs],
    ra: 156.093,
    dec: -41.644,
    sizeDeg: 0.12,
    subtractZodi: true,
  });

  assert.equal(comparison.epochs.length, 2);
  assert.ok(comparison.width >= 10 && comparison.height >= 10);
  assert.ok(comparison.primaryPair.overlapPixelCount > 0, 'Expected overlapping WCS sky pixels');
  assert.equal(comparison.report.numberOfImagesCompared, 2);
  assert.ok(comparison.report.technicalMethodology.length >= 4);

  // Verify independent confidences are valid numbers and not blindly forced to 100
  for (const chg of comparison.detectedChanges) {
    if (chg.genuineConfidencePct !== null) {
      assert.ok(Number.isFinite(chg.genuineConfidencePct));
      assert.ok(chg.genuineConfidencePct < 100);
    }
    assert.ok(chg.supportingEvidence.length > 0);
  }
});
