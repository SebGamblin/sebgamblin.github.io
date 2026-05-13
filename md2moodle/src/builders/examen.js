/**
 * src/builders/examen.js — Export PDF examen via Puppeteer
 *
 * Stratégie header :
 *   - Le header complet (logo, titre, nom/prénom) est dans le BODY HTML page 1
 *   - Le headerTemplate Puppeteer est un bandeau minimal (titre + numéro de page)
 *     qui s'affiche sur les pages 2, 3, etc.
 *   - Cela évite les noms/prénoms répétés sur toutes les pages.
 *
 * Directives Markdown examen :
 *   ::: reponse 6 :::   → 6 lignes d'espace réponse
 *   ::: newpage :::     → saut de page forcé
 *   - [ ] / - [x]       → cases QCM
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import puppeteer from 'puppeteer';

import { parseMarkdown } from '../utils/markdown.js';
import { getRuntimeDir, getThemeCss } from '../utils/runtime.js';
import { log } from '../utils/log.js';

export async function buildExamen(ctx) {
  const { input, output } = ctx;
  log.step(`📝  Export Examen PDF : ${path.basename(input)}`);

  const parsed = parseMarkdown(input);
  const fm     = parsed.frontmatter;
  const title  = ctx.title || fm.title || parsed.title;

  log.info(`Titre : ${title}`);
  log.info(`Date  : ${fm.date  || '—'}`);
  log.info(`Durée : ${fm.duree || '—'}`);

  const runtimeDir = getRuntimeDir();

  const logoPath = ctx.logo
    || (fm.logo ? path.resolve(path.dirname(input), fm.logo) : null)
    || findLogo(path.dirname(input), runtimeDir);
  const logoB64 = logoPath && fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : null;

  const examCss  = fs.readFileSync(path.join(runtimeDir, 'exam.css'), 'utf-8');
  const katexCss = fs.readFileSync(path.join(runtimeDir, 'libs', 'katex.min.css'), 'utf-8');
  const hljsCss  = fs.readFileSync(path.join(runtimeDir, 'libs', 'highlight-github.min.css'), 'utf-8');

  const html = buildExamPage({ parsed, fm, title, examCss, katexCss, hljsCss, logoB64, runtimeDir });

  const pdfName = `${path.basename(input, '.md')}-examen.pdf`;
  const pdfPath = output
    ? (output.endsWith('.pdf') ? output : path.join(output, pdfName))
    : path.join(ctx.cwd, pdfName);

  const tmp     = fs.mkdtempSync(path.join(os.tmpdir(), 'md2moodle-exam-'));
  const tmpHtml = path.join(tmp, 'examen.html');

  // Réécrire les chemins de polices KaTeX en data URIs (Puppeteer ouvre en file://)
  const htmlFixed = rewriteFontUrls(html, path.join(runtimeDir, 'libs'));
  fs.writeFileSync(tmpHtml, htmlFixed, 'utf-8');

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
    await page.waitForFunction(
      () => document.querySelector('#exam-ready') !== null,
      { timeout: 12000 }
    ).catch(() => log.warn('Timeout rendu'));

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      // margin.top doit être assez grand pour le headerTemplate pages 2+
      // mais pas trop (le header page 1 est dans le body)
      margin: { top: '14mm', bottom: '20mm', left: '20mm', right: '20mm' },
      displayHeaderFooter: true,
      headerTemplate: buildPageHeader(fm, title, logoB64),
      footerTemplate:  buildPageFooter(fm),
    });

    log.done(`PDF examen créé : ${path.basename(pdfPath)}`);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Page HTML ──────────────────────────────────────────────────────────────

function buildExamPage({ parsed, fm, title, examCss, katexCss, hljsCss, logoB64, runtimeDir }) {
  function inlineScript(file) {
    return `<script>\n${fs.readFileSync(path.join(runtimeDir, 'libs', file), 'utf-8')}\n</script>`;
  }

  const processedBody = preprocessExam(parsed.bodyOnly);

  // Header page 1 intégré dans le body
  const logoHtml = logoB64
    ? `<img src="${logoB64}" style="height:36px;display:block;margin-bottom:5px" alt="">`
    : '';

  const firstHeader = buildFirstPageHeader(fm, title, logoHtml);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${katexCss}
${hljsCss}
${examCss}

/* Coloration syntaxique */
.hljs { background: #f6f8fa; color: #24292e; padding: 0; }
.code-block-exam { position: relative; margin: 6pt 0 10pt; break-inside: avoid; }
.code-lang-exam {
  display: inline-block; padding: 1pt 6pt;
  font-family: 'Courier New', monospace; font-size: 7pt; font-weight: 700;
  text-transform: uppercase; letter-spacing: .04em;
  color: #fff; background: #444; border-radius: 2pt 2pt 0 0;
}
.code-block-exam pre {
  background: #f6f8fa; border: 1px solid #e1e4e8;
  border-radius: 0 3pt 3pt 3pt;
  padding: 6pt 8pt; margin: 0;
  font-size: 9pt; font-family: 'Courier New', monospace;
  white-space: pre-wrap; overflow-wrap: break-word;
}
.code-block-exam pre code { background: none; border: none; padding: 0; font-size: inherit; }

/* Header page 1 dans le body */
.exam-first-header {
  font-family: sans-serif; font-size: 11px;
  padding: 10px 0px; margin-bottom: 16pt;
  break-inside: avoid; break-after: avoid;
}

/* Saut de page forcé */
.page-break { break-before: page; height: 0; }
</style>
</head>
<body>

${firstHeader}

<div id="exam-content" style="display:none" data-b64="${btoa_safe(processedBody)}"></div>

${inlineScript('marked.min.js')}
${inlineScript('highlight.min.js')}
${inlineScript('katex.min.js')}
${inlineScript('katex-auto-render.min.js')}

<script>
(function() {
  'use strict';

  function b64decode(b64) {
    try {
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch(e) { return atob(b64); }
  }

  var raw = b64decode(document.getElementById('exam-content').getAttribute('data-b64') || '');
  if (!raw || raw.length < 3) {
    document.body.innerHTML += '<p style="color:red">Erreur: contenu vide</p>';
    signalReady(); return;
  }

  function makeRenderer() {
    var r = new marked.Renderer();
    r.code = function(tokenOrCode, langArg) {
      var code, lang;
      if (tokenOrCode && typeof tokenOrCode === 'object' && 'text' in tokenOrCode) {
        code = tokenOrCode.text; lang = tokenOrCode.lang || '';
      } else {
        code = String(tokenOrCode || ''); lang = langArg || '';
      }
      var highlighted = escHtml(code);
      try {
        highlighted = (lang && hljs.getLanguage(lang))
          ? hljs.highlight(code, { language: lang }).value
          : hljs.highlightAuto(code).value;
      } catch(e) {}
      var label = lang ? '<span class="code-lang-exam">' + escHtml(lang) + '</span>' : '';
      return '<div class="code-block-exam">' + label +
        '<pre><code class="hljs">' + highlighted + '</code></pre></div>';
    };
    return r;
  }

  try { marked.use({ renderer: makeRenderer(), gfm: true, breaks: false }); }
  catch(e) { try { marked.setOptions({ renderer: makeRenderer() }); } catch(e2) {} }

  var container = document.createElement('div');
  container.id = 'exam-body';
  try { container.innerHTML = marked.parse(raw); }
  catch(e) { container.innerHTML = '<pre style="color:red">' + escHtml(e.message) + '</pre>'; }
  document.body.appendChild(container);

  try {
    renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$',  right: '$',  display: false },
      ],
      throwOnError: false,
    });
  } catch(e) {}

  transformCheckboxes(container);
  signalReady();

  function signalReady() {
    setTimeout(function() {
      var d = document.createElement('div');
      d.id = 'exam-ready'; d.style.display = 'none';
      document.body.appendChild(d);
    }, 600);
  }

  function transformCheckboxes(root) {
    root.querySelectorAll('li').forEach(function(li) {
      var input = li.querySelector('input[type="checkbox"]');
      if (!input) return;
      li.classList.add('qcm-item');
      var box = document.createElement('span');
      box.className = input.checked ? 'qcm-box qcm-box--checked' : 'qcm-box';
      box.textContent = input.checked ? '✓' : '';
      input.replaceWith(box);
      var ul = li.closest('ul'); if (ul) ul.classList.add('qcm-list');
    });
  }

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
})();
</script>
</body>
</html>`;
}

// ── Header page 1 (dans le body) ──────────────────────────────────────────

function buildFirstPageHeader(fm, title, logoHtml) {
  const etab     = escapeHtml(fm.etablissement || '');
  const subtitle = escapeHtml(fm.subtitle || '');
  const date_    = escapeHtml(fm.date || '');
  const duree    = fm.duree ? escapeHtml(`Durée : ${fm.duree}`) : '';
  const docs     = fm.documents ? escapeHtml(fm.documents) : '';

  return `<div class="exam-first-header">
<table style="width:100%;border-collapse:collapse;margin-bottom:8px;border: none;">

    <tr>
      <td style="width:60%;vertical-align:top;border: none;">
        ${logoHtml}
        <div style="font-size:14px;font-weight:bold;margin-bottom:2px;">${escapeHtml(title)}</div>
        <div style="color:#555;">${subtitle}</div>
      </td>
      <td style="text-align:right;vertical-align:top;border: none;">
        <div style="font-weight:bold;">${etab}</div>
        ${date_    ? `<div style="margin-top:2px;">${date_}</div>`                               : ''}
        ${duree    ? `<div style="margin-top:2px;">${duree}</div>`                               : ''}
        ${docs     ? `<div style="margin-top:2px;color:#c00;font-weight:bold;">${docs}</div>`    : ''}
      </td>
    </tr>
  </table>
  <div style="display:flex;gap:32px;padding-top:7px;border-top:1px solid #ccc;">
    <div style="flex:1;"><strong>Nom :</strong>&ensp;<span style="display:inline-block;min-width:140px;border-bottom:1px solid #555;">&nbsp;</span></div>
    <div style="flex:1;"><strong>Prénom :</strong>&ensp;<span style="display:inline-block;min-width:140px;border-bottom:1px solid #555;">&nbsp;</span></div>
    <div style="width:180px;"><strong>Groupe :</strong>&ensp;<span style="display:inline-block;min-width:70px;border-bottom:1px solid #555;">&nbsp;</span></div>
  </div>
</div>`;
}

// ── Header pages 2+ (Puppeteer headerTemplate) ────────────────────────────
// Affiché sur TOUTES les pages par Puppeteer, mais visuellement minimal.
// On cache la ligne Nom/Prénom — elle n'apparaît qu'en page 1 via le body.

function buildPageHeader(fm, title, logoB64) {
  const etab  = escapeHtml(fm.etablissement || '');
  const short = escapeHtml(title);
  // Logo miniature inline base64
  const miniLogo = logoB64
    ? `<img src="${logoB64}" style="height:18px;vertical-align:middle;margin-right:6px" alt="">`
    : '';

  return `<div style="font-family:sans-serif;font-size:9px;width:100%;
    padding:3mm 20mm 2mm;box-sizing:border-box;border-bottom:1px solid #ccc;
    display:flex;justify-content:space-between;align-items:center;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <span>${miniLogo}<strong>${short}</strong>${etab ? ' — ' + etab : ''}</span>
    <span style="color:#888;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

function buildPageFooter(fm) {
  const etab = escapeHtml(fm.etablissement || '');
  return `<div style="font-family:sans-serif;font-size:9px;color:#aaa;width:100%;
    padding:2mm 20mm;box-sizing:border-box;border-top:1px solid #eee;
    display:flex;justify-content:space-between;">
    <span>${etab}</span>
    <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

// ── Preprocessing côté Node ────────────────────────────────────────────────

function preprocessExam(md) {
  // ::: reponse N ::: → N lignes de réponse
  md = md.replace(
    /:::[ \t]*reponse[ \t]+(\d+)[ \t]*\r?\n[\s\S]*?:::/g,
    (_, n) => generateLines(parseInt(n, 10))
  );
  // ::: reponse ::: sans nombre → 4 lignes
  md = md.replace(
    /:::[ \t]*reponse[ \t]*\r?\n[\s\S]*?:::/g,
    () => generateLines(4)
  );
  // ::: newpage ::: → saut de page
  md = md.replace(
    /:::[ \t]*newpage[ \t]*\r?\n?[\s\S]*?:::/g,
    '\n<div class="page-break"></div>\n'
  );
  // {.horizontal} après une liste → envelopper la liste dans .qcm-horizontal
  // Syntaxe : ligne {.horizontal} immédiatement après le dernier item de la liste
  md = md.replace(
    /((?:^[ \t]*-[ \t].+\r?\n)+)\{\.horizontal\}[ \t]*\r?\n?/gm,
    (_, list) => `<div class="qcm-horizontal">\n\n${list}\n</div>\n`
  );
  return md;
}

function generateLines(n) {
  let lines = '';
  for (let i = 0; i < n; i++) lines += '<div class="answer-line"></div>\n';
  return `\n<div class="answer-block">\n${lines}</div>\n`;
}

function btoa_safe(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findLogo(courseDir, runtimeDir) {
  for (const p of [
    path.join(courseDir, 'logo.png'), path.join(courseDir, 'logo.svg'),
    path.join(runtimeDir, 'logo.png'),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Remplace les url(fonts/KaTeX_*.woff2) dans le CSS par des data URIs base64.
 * Nécessaire pour Puppeteer qui ouvre en file:// depuis un dossier temporaire.
 */
function rewriteFontUrls(html, libsDir) {
  const fontsDir = path.join(libsDir, 'fonts');
  return html.replace(
    /url\(["']?(fonts\/[^"')]+\.woff2)["']?\)/g,
    (match, fontPath) => {
      const abs = path.join(fontsDir, path.basename(fontPath));
      if (!fs.existsSync(abs)) return match;
      const b64 = fs.readFileSync(abs).toString('base64');
      return `url("data:font/woff2;base64,${b64}")`;
    }
  );
}
