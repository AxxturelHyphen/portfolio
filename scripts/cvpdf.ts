// npm run cvpdf: prints the built Herbario (dist/) to dist/cv.pdf with Playwright page.pdf and fails unless
// the result is exactly one A4 page. Run after `npm run build`. Build-time only, never shipped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const DIST = resolve(import.meta.dirname, '..', 'dist');
const OUT = resolve(DIST, 'cv.pdf');

/** Page objects in the PDF; Chromium writes them uncompressed, one `/Type /Page` per page. */
function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
}

if (!existsSync(resolve(DIST, 'index.html'))) {
  console.error('cvpdf: dist/index.html not found, run `npm run build` first');
  process.exit(1);
}

const server = await preview({ preview: { port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const browser = await chromium.launch();
try {
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) throw new Error('preview server has no local URL');
  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
  await page.goto(`${url}?mode=herbario&lang=en`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true, outline: false });
  writeFileSync(OUT, pdf);
  const pages = pageCount(readFileSync(OUT));
  if (pages !== 1) throw new Error(`cv.pdf has ${pages} pages, expected exactly 1`);
  console.log(`cvpdf: ${OUT} (1 page, ${(pdf.length / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error(`cvpdf: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise<void>((done) => server.httpServer.close(() => done()));
}
