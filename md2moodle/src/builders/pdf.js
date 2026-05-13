/**
 * src/builders/pdf.js
 *
 * Builder PDF cours : génère un PDF propre et professionnel via Puppeteer.
 *
 * Workflow :
 *  1. Parser le Markdown
 *  2. Générer une page HTML autonome (avec libs embarquées en base64 ou CDN)
 *  3. Lancer Puppeteer → waitForNetworkIdle → print PDF
 *
 * Le rendu Markdown est assuré côté navigateur (marked + katex + mermaid + hljs).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import puppeteer from 'puppeteer';

import { parseMarkdown } from '../utils/markdown.js';
import { resolveAssets, rewritePaths } from '../utils/assets.js';
import { getRuntimeDir, getThemePath } from '../utils/runtime.js';
import { log } from '../utils/log.js';

export async function buildPdf(ctx) {
  const { input, theme, title: forceTitle, output } = ctx;

  log.step(`📄  Export PDF : ${path.basename(input)}`);

  const parsed = parseMarkdown(input);
  const title  = forceTitle || parsed.title;
  log.info(`Titre : ${title}`);

  // ── Résoudre assets locaux ────────────────────────────────────────────────
  const assets  = resolveAssets(parsed.bodyOnly, input);
  const mapping = {};
  for (const asset of assets.filter(a => a.exists)) {
    // Encoder en data URI pour éviter les problèmes de chemin Puppeteer
    const data = fs.readFileSync(asset.absPath);
    const mime = guessMime(asset.absPath);
    mapping[asset.original] = `data:${mime};base64,${data.toString('base64')}`;
  }
  assets.filter(a => !a.exists).forEach(a => log.warn(`Asset introuvable : ${a.original}`));

  let content = rewritePaths(parsed.bodyOnly, mapping);

  // ── Générer page HTML pour impression ────────────────────────────────────
  const runtimeDir = getRuntimeDir();
  const themeCss   = fs.readFileSync(getThemePath(theme), 'utf-8');
  const printCss   = fs.readFileSync(path.join(runtimeDir, 'print.css'), 'utf-8');

  const html = buildPdfPage({ title, content, runtimeDir, themeCss, printCss });

  // Écrire dans un fichier temporaire (Puppeteer a besoin d'un file://)
  const tmp     = fs.mkdtempSync(path.join(os.tmpdir(), 'md2moodle-'));
  const tmpHtml = path.join(tmp, 'cours.html');
  const tmpLibs = path.join(tmp, 'libs');
  copyDir(path.join(runtimeDir, 'libs'), tmpLibs);
  fs.writeFileSync(tmpHtml, html, 'utf-8');

  // ── Puppeteer ─────────────────────────────────────────────────────────────
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
    await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Attendre que mermaid et KaTeX aient fini leur rendu
    await page.waitForFunction(
      () => document.querySelector('#moteur-ready') !== null,
      { timeout: 15000 }
    ).catch(() => log.warn('Timeout attente rendu — PDF généré quand même'));

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: buildHeaderTemplate(title),
      footerTemplate: buildFooterTemplate(),
    });

    log.done(`PDF créé : ${path.basename(pdfPath)}`);

  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── HTML pour impression PDF ──────────────────────────────────────────────

function buildPdfPage({ title, content, runtimeDir, themeCss, printCss }) {
  // Inliner les libs JS en base64 data URI pour fiabilité
  function inlineScript(file) {
    const data = fs.readFileSync(path.join(runtimeDir, 'libs', file), 'utf-8');
    // NB : on passe par un blob URL équivalent via texte inline
    return `<script>${data}</script>`;
  }
  function inlineStyle(file) {
    const data = fs.readFileSync(path.join(runtimeDir, 'libs', file), 'utf-8');
    return `<style>${data}</style>`;
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${title}</title>
${inlineStyle('katex.min.css')}
${inlineStyle('highlight-github.min.css')}
<style>
${themeCss}
${printCss}
/* Mode impression PDF : pas de toolbar, pas de sidebar */
#moteur-toolbar, #moteur-sidebar, #moteur-sidebar-toggle,
#moteur-info-popup { display: none !important; }
#moteur-doc { padding: 0 !important; max-width: 100% !important; }
body { background: white !important; }
</style>
</head>
<body>

<div id="cours-md" style="display:none">
${content}
</div>

${inlineScript('marked.min.js')}
${inlineScript('highlight.min.js')}
${inlineScript('katex.min.js')}
${inlineScript('katex-auto-render.min.js')}
${inlineScript('mermaid.min.js')}

<script>
// Rendu direct sans reveal.js (mode document uniquement)
(function() {
  var raw = document.getElementById('cours-md').textContent;

  // Marked
  marked.setOptions({
    highlight: function(code, lang) {
      return lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    }
  });

  // Mermaid
  mermaid.initialize({ startOnLoad: false, theme: 'default' });

  // Injecter le rendu
  var doc = document.createElement('div');
  doc.id = 'moteur-doc';
  doc.innerHTML = marked.parse(raw);
  document.body.appendChild(doc);

  // KaTeX
  renderMathInElement(doc, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\\\(', right: '\\\\)', display: false },
      { left: '\\\\[', right: '\\\\]', display: true },
    ]
  });

  // Mermaid
  mermaid.init(undefined, doc.querySelectorAll('.language-mermaid, .mermaid'));

  // Signal prêt
  var ready = document.createElement('div');
  ready.id = 'moteur-ready';
  ready.style.display = 'none';
  // Délai pour laisser mermaid finir (asynchrone)
  setTimeout(function() { document.body.appendChild(ready); }, 800);
})();
</script>
</body>
</html>`;
}

function buildHeaderTemplate(title) {
  return `<div style="font-size:9px;color:#888;width:100%;padding:0 18mm;
    display:flex;justify-content:space-between;align-items:center;box-sizing:border-box;">
    <span>${escapeHtml(title)}</span>
    <span style="font-size:8px">ISEN Yncrea Ouest</span>
  </div>`;
}

function buildFooterTemplate() {
  return `<div style="font-size:9px;color:#888;width:100%;padding:0 18mm;
    display:flex;justify-content:flex-end;align-items:center;box-sizing:border-box;">
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
           '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
