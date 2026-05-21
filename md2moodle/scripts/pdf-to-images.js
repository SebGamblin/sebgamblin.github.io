#!/usr/bin/env node
/**
 * scripts/pdf-to-images.js
 *
 * Convertit un PDF en une série d'images PNG haute résolution.
 * Utilise Puppeteer + PDF.js (chargé depuis cdnjs) — aucune dépendance système.
 *
 * Usage :
 *   node scripts/pdf-to-images.js <fichier.pdf> [dossier-sortie] [--dpi=200]
 *
 * Exemple :
 *   node scripts/pdf-to-images.js copies/etudiant1.pdf copies/etudiant1/
 *   node scripts/pdf-to-images.js copies/exam.pdf --dpi=150
 */

import puppeteer from 'puppeteer';
import fs        from 'fs';
import path      from 'path';

// ── Arguments ──────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const pdfArg  = args.find(a => !a.startsWith('--') && a.endsWith('.pdf'));
const dpiArg  = args.find(a => a.startsWith('--dpi='));
const dpi     = dpiArg ? parseInt(dpiArg.split('=')[1]) : 200;
const outArg  = args.find(a => !a.startsWith('--') && !a.endsWith('.pdf'));

if (!pdfArg) {
  console.error('Usage : node scripts/pdf-to-images.js <fichier.pdf> [dossier-sortie] [--dpi=200]');
  process.exit(1);
}

const pdfPath = path.resolve(pdfArg);
if (!fs.existsSync(pdfPath)) {
  console.error(`Fichier introuvable : ${pdfPath}`);
  process.exit(1);
}

const outDir = outArg
  ? path.resolve(outArg)
  : path.join(path.dirname(pdfPath), path.basename(pdfPath, '.pdf'));

fs.mkdirSync(outDir, { recursive: true });

// ── Dimensions A4 selon le DPI ─────────────────────────────────────────────
// A4 = 210 × 297 mm = 8.27 × 11.69 inch
const W = Math.round(8.27  * dpi);
const H = Math.round(11.69 * dpi);

console.log(`PDF       : ${pdfPath}`);
console.log(`Sortie    : ${outDir}`);
console.log(`Résolution: ${dpi} dpi → ${W}×${H}px`);

// ── HTML avec PDF.js ───────────────────────────────────────────────────────
const pdfB64 = fs.readFileSync(pdfPath).toString('base64');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="status">loading</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
(async function() {
  const status = document.getElementById('status');
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const b64   = '${pdfB64}';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const pdf   = await pdfjsLib.getDocument({ data: bytes }).promise;

    window.__pageCount = pdf.numPages;
    window.__pdf = pdf;
    window.__renderPage = async function(n) {
      const p       = await pdf.getPage(n);
      const vp      = p.getViewport({ scale: ${dpi} / 72 });
      const canvas  = document.getElementById('canvas');
      canvas.width  = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext('2d');
      await p.render({ canvasContext: ctx, viewport: vp }).promise;
      status.textContent = 'ready:' + n;
    };

    status.textContent = 'pages:' + pdf.numPages;
  } catch(e) {
    status.textContent = 'error:' + e.message;
  }
})();
</script>
</body>
</html>`;

// ── Puppeteer ──────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: W + 40, height: H + 40 });
await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

// Attendre PDF.js
const statusEl = await page.waitForFunction(
  () => document.getElementById('status').textContent.startsWith('pages:'),
  { timeout: 20000 }
).catch(() => null);

if (!statusEl) {
  const txt = await page.$eval('#status', el => el.textContent).catch(() => 'timeout');
  console.error(`Erreur PDF.js : ${txt}`);
  await browser.close();
  process.exit(1);
}

const pageCount = await page.$eval(
  '#status', el => parseInt(el.textContent.split(':')[1])
);
console.log(`Pages     : ${pageCount}`);

for (let n = 1; n <= pageCount; n++) {
  // Rendre la page n
  await page.evaluate(n => window.__renderPage(n), n);
  await page.waitForFunction(
    n => document.getElementById('status').textContent === 'ready:' + n,
    { timeout: 15000 }, n
  );

  // Screenshot du canvas uniquement
  const canvas   = await page.$('#canvas');
  const outFile  = path.join(outDir, `page_${String(n).padStart(3, '0')}.png`);
  await canvas.screenshot({ path: outFile });

  const size = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`  ✓ page ${n}/${pageCount} → ${path.basename(outFile)}  (${size} Ko)`);
}

await browser.close();
console.log(`\n✅  ${pageCount} image(s) dans : ${outDir}`);
