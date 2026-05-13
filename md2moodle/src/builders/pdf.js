/**
 * src/builders/pdf.js — Export PDF cours via Puppeteer
 *
 * Utilise moteur.js côté navigateur (même rendu que le mode serve/html),
 * garantissant cohérence : callouts, wikilinks, mermaid, hljs identiques.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import puppeteer from 'puppeteer';

import { parseMarkdown } from '../utils/markdown.js';
import { getRuntimeDir, getThemePath, getThemeCss } from '../utils/runtime.js';
import { log } from '../utils/log.js';

export async function buildPdf(ctx) {
  const { input, theme = 'default', title: forceTitle, output } = ctx;

  log.step(`📄  Export PDF : ${path.basename(input)}`);

  const parsed     = parseMarkdown(input);
  const title      = forceTitle || parsed.title;
  const runtimeDir = getRuntimeDir();

  log.info(`Titre : ${title}`);

  // Encoder le contenu en base64 (préserve HTML brut, caractères spéciaux)
  const b64 = Buffer.from(parsed.bodyOnly, 'utf-8').toString('base64');

  // Lire les assets — logo
  const logoPath = ctx.logo || findLogo(path.dirname(input), runtimeDir);
  const logoB64  = logoPath && fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : null;

  // Construire la page HTML autonome (moteur.js + libs inlinés)
  const themeCss  = getThemeCss(theme);
  const printCss  = fs.readFileSync(path.join(runtimeDir, 'print.css'), 'utf-8');
  const moteurJs  = fs.readFileSync(path.join(runtimeDir, 'moteur.js'), 'utf-8');

  function inlineStyle(file) {
    return `<style>${fs.readFileSync(path.join(runtimeDir, 'libs', file), 'utf-8')}</style>`;
  }
  function inlineScript(file) {
    return `<script>${fs.readFileSync(path.join(runtimeDir, 'libs', file), 'utf-8')}</script>`;
  }

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${inlineStyle('katex.min.css')}
${inlineStyle('highlight-github.min.css')}
<style>
${themeCss}
${printCss}
/* PDF : masquer l'UI moteur */
#moteur-toolbar, #moteur-sidebar, #moteur-banner,
#moteur-info-popup, #moteur-sidebar-toggle,
.code-copy-btn { display: none !important; }
#moteur-doc { padding: 0 !important; max-width: 100% !important; margin: 0 !important; }
body { background: white !important; }
</style>
</head>
<body>

<div id="cours-md" style="display:none" data-b64="${b64}"></div>

${inlineScript('marked.min.js')}
${inlineScript('highlight.min.js')}
${inlineScript('katex.min.js')}
${inlineScript('katex-auto-render.min.js')}
${inlineScript('mermaid.min.js')}
<script>${moteurJs}</script>

<script>
// Signal prêt pour Puppeteer : attendre que moteur.js ait fini de rendre
(function waitReady() {
  var doc = document.getElementById('moteur-doc');
  // moteur-doc visible = rendu terminé (renderDoc() le rend visible)
  if (doc && doc.style.display !== 'none' && doc.innerHTML.length > 50) {
    // Attendre mermaid (asynchrone)
    setTimeout(function() {
      var r = document.createElement('div');
      r.id = 'moteur-pdf-ready';
      r.style.display = 'none';
      document.body.appendChild(r);
    }, 800);
  } else {
    setTimeout(waitReady, 50);
  }
})();
</script>

</body>
</html>`;

  // Dossier temp avec les libs (moteur.js les charge via BASE = chemin relatif)
  const tmp     = fs.mkdtempSync(path.join(os.tmpdir(), 'md2moodle-pdf-'));
  const tmpHtml = path.join(tmp, 'cours.html');

  // Copier libs/ pour les fonts (chargées par moteur.js via loadFonts)
  copyDir(path.join(runtimeDir, 'libs'), path.join(tmp, 'libs'));

  // Copier logo si présent
  if (logoPath && fs.existsSync(logoPath)) {
    fs.copyFileSync(logoPath, path.join(tmp, 'logo.png'));
  }

  // Copier les assets images du cours (si référencés en chemin relatif)
  copyLocalAssets(parsed.bodyOnly, path.dirname(input), tmp);

  fs.writeFileSync(tmpHtml, html, 'utf-8');

  const pdfName = `${path.basename(input, '.md')}.pdf`;
  const pdfPath = output
    ? (output.endsWith('.pdf') ? output : path.join(output, pdfName))
    : path.join(ctx.cwd, pdfName);

  log.info('Lancement de Puppeteer…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', e => log.warn(`JS: ${e.message}`));
    page.on('console',   m => { if (m.type() === 'error') log.warn(`Console: ${m.text()}`); });

    await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Attendre que moteur.js ait fini de rendre (signal #moteur-pdf-ready)
    await page.waitForFunction(
      () => document.querySelector('#moteur-pdf-ready') !== null,
      { timeout: 15000 }
    ).catch(() => log.warn('Timeout rendu — PDF généré quand même'));

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: buildPdfHeader(title, logoB64),
      footerTemplate:  buildPdfFooter(),
    });

    const sizeKb = Math.round(fs.statSync(pdfPath).size / 1024);
    log.done(`PDF créé : ${path.basename(pdfPath)}  (${sizeKb} Ko)`);

  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Header / Footer PDF ────────────────────────────────────────────────────

function buildPdfHeader(title, logoB64) {
  const logo = logoB64
    ? `<img src="${logoB64}" style="height:18px;vertical-align:middle;margin-right:6px" alt="">`
    : '';
  return `<div style="font-family:sans-serif;font-size:9px;color:#888;width:100%;
    padding:3mm 18mm 0;box-sizing:border-box;
    display:flex;justify-content:space-between;align-items:center;">
    <span>${logo}<strong>${escapeHtml(title)}</strong></span>
    <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

function buildPdfFooter() {
  return `<div style="font-size:8px;color:#ccc;width:100%;padding:0 18mm;
    box-sizing:border-box;text-align:right;">md2moodle</div>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function copyLocalAssets(content, sourceDir, destDir) {
  const imgPattern = /!\[.*?\]\(([^)]+)\)/g;
  let m;
  while ((m = imgPattern.exec(content)) !== null) {
    const src = m[1].split('?')[0]; // enlever query string
    if (src.startsWith('http') || src.startsWith('data:')) continue;
    const abs = path.resolve(sourceDir, src);
    if (fs.existsSync(abs)) {
      const dest = path.join(destDir, path.basename(abs));
      try { fs.copyFileSync(abs, dest); } catch {}
    }
  }
}

function findLogo(courseDir, runtimeDir) {
  for (const p of [
    path.join(courseDir, 'logo.png'), path.join(courseDir, 'logo.svg'),
    path.join(runtimeDir, 'logo.png'),
  ]) { if (fs.existsSync(p)) return p; }
  return null;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
