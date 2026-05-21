/**
 * src/builders/pdf.js — Export PDF cours via Puppeteer
 *
 * Utilise moteur.js côté navigateur (même rendu que le mode serve/html),
 * garantissant cohérence : callouts, wikilinks, mermaid, hljs identiques.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import puppeteer from 'puppeteer';

import { parseMarkdown, parseSummary, resolvePages } from '../utils/markdown.js';
import { getRuntimeDir, getThemePath, getThemeCss } from '../utils/runtime.js';
import { log } from '../utils/log.js';

export async function buildPdf(ctx) {
  const { input, theme = 'default', title: forceTitle, output } = ctx;

  log.step(`📄  Export PDF : ${path.basename(input)}`);

  const parsed     = parseMarkdown(input);
  const title      = forceTitle || parsed.title;
  const runtimeDir = getRuntimeDir();

  log.info(`Titre : ${title}`);

  // Inliner les images locales en base64 — élimine toute dépendance aux chemins
  // relatifs sous Puppeteer (file:// URL + paths Windows non fiables)
  const bodyInlined = inlineImagesInMarkdown(parsed.bodyOnly, path.dirname(input));
  const b64 = Buffer.from(bodyInlined.replace(/\r/g, ''), 'utf-8').toString('base64');

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

    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0', timeout: 30000 });

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

// ── Export PDF toutes pages ────────────────────────────────────────────────

export async function buildPdfAll(ctx) {
  const { input, summary, theme = 'default', output } = ctx;

  if (!summary || !fs.existsSync(summary)) {
    log.warn('Pas de fichier sommaire — export PDF page unique.');
    return buildPdf(ctx);
  }

  log.step(`📄  Export PDF complet (toutes pages)`);

  const runtimeDir = getRuntimeDir();
  const themeCss   = getThemeCss(theme);
  const printCss   = fs.readFileSync(path.join(runtimeDir, 'print.css'), 'utf-8');

  const logoPath = ctx.logo || findLogo(path.dirname(input), runtimeDir);
  const logoB64  = logoPath && fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : null;

  // Collecter toutes les pages (principale + sommaire)
  const chapters  = parseSummary(summary);
  const allPages  = resolvePages(summary, chapters);
  const seenPaths = new Set();
  const pages     = [];

  for (const src of [{ absPath: path.resolve(input), title: null }, ...allPages]) {
    const key = src.absPath;
    if (seenPaths.has(key) || !fs.existsSync(key)) continue;
    seenPaths.add(key);
    const parsed  = parseMarkdown(key);
    const bodyB64 = Buffer.from(
      inlineImagesInMarkdown(parsed.bodyOnly, path.dirname(key)).replace(/\r/g, ''),
      'utf-8'
    ).toString('base64');
    pages.push({ title: src.title || parsed.title, b64: bodyB64 });
  }

  log.info(`${pages.length} page(s) à exporter`);

  function inlineStyle(file) {
    return `<style>${fs.readFileSync(path.join(runtimeDir, 'libs', file), 'utf-8')}</style>`;
  }
  function inlineScript(file) {
    return `<script>${fs.readFileSync(path.join(runtimeDir, 'libs', file), 'utf-8')}</script>`;
  }

  const tocItems   = pages.map((p, i) =>
    `<li><a href="#page-${i}">${escapeHtml(p.title)}</a></li>`
  ).join('\n');
  const pagesHtml  = pages.map((p, i) => {
    const last = i === pages.length - 1;
    return `<div class="pdf-page" id="page-${i}"${last ? '' : ' style="page-break-after:always"'} data-md-b64="${p.b64}"></div>`;
  }).join('\n');

  // Script de rendu embarqué — même pipeline que moteur.js
  const renderScript = `(function(){
  // Renderer identique à moteur.js (même signature token v12+)
  var renderer = new marked.Renderer();
  renderer.code = function(tokenOrCode, langArg) {
    var code, lang;
    if (tokenOrCode && typeof tokenOrCode === 'object' && 'text' in tokenOrCode) {
      code = tokenOrCode.text; lang = tokenOrCode.lang || '';
    } else {
      code = String(tokenOrCode || ''); lang = langArg || '';
    }
    if (lang === 'mermaid') {
      var b64 = '';
      try {
        var by = new TextEncoder().encode(code), bi = '';
        by.forEach(function(b) { bi += String.fromCharCode(b); });
        b64 = btoa(bi);
      } catch(e) {
        try { b64 = btoa(unescape(encodeURIComponent(code))); } catch(e2) { b64 = btoa(code); }
      }
      return '<div class="mermaid-pending" data-b64="' + b64 + '"></div>';
    }
    var hi = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (typeof hljs !== 'undefined') {
      try {
        hi = (lang && hljs.getLanguage(lang))
          ? hljs.highlight(code, {language: lang}).value
          : hljs.highlightAuto(code).value;
      } catch(e) {}
    }
    return '<div class="code-block"><pre><code>' + hi + '</code></pre></div>';
  };
  try { marked.use({ renderer: renderer, gfm: true, breaks: false, pedantic: false }); }
  catch(e) { marked.setOptions({ renderer: renderer, sanitize: false }); }

  mermaid.initialize({
    startOnLoad: false, securityLevel: 'loose', theme: 'base',
    themeVariables: { primaryColor:'#e8f4fd', primaryBorderColor:'#2980b9',
                      primaryTextColor:'#1a1a2e', lineColor:'#2980b9' }
  });

  function dec(b64) {
    try {
      var bi = atob(b64), by = new Uint8Array(bi.length);
      for (var i = 0; i < bi.length; i++) by[i] = bi.charCodeAt(i);
      return new TextDecoder('utf-8').decode(by);
    } catch(e) { return atob(b64); }
  }

  // Même logique que preprocessMarkdown dans moteur.js :
  // \( et \) sont des escapes Markdown valides → le backslash disparaît.
  // On le double ici pour que marked produise \( dans le HTML → KaTeX le voit.
  function preprocessMd(md) {
    var inFence = false;
    return md.split('\\n').map(function(line) {
      if (/^[ \\t]*(\`{3,}|~{3,})/.test(line)) { inFence = !inFence; return line; }
      if (inFence) return line;
      var out = '', inBt = false;
      for (var j = 0; j < line.length; j++) {
        var c = line[j];
        if (c === '\`') { inBt = !inBt; out += c; continue; }
        if (!inBt && c === '\\\\' && j + 1 < line.length) {
          var n = line[j + 1];
          if (n === '(' || n === ')' || n === '[' || n === ']') {
            out += '\\\\\\\\' + n; j++; continue;
          }
        }
        out += c;
      }
      return out;
    }).join('\\n');
  }

  function signalReady() {
    var r = document.createElement('div');
    r.id = 'moteur-pdf-ready'; r.style.display = 'none';
    document.body.appendChild(r);
  }

  // Poll la présence réelle de <svg> dans chaque nœud .mermaid
  function waitForSvgs(nodes, maxMs, cb) {
    if (!nodes.length) { setTimeout(cb, 200); return; }
    var elapsed = 0;
    var t = setInterval(function() {
      elapsed += 150;
      var done = nodes.every(function(n) { return !!n.querySelector('svg'); });
      if (done || elapsed >= maxMs) { clearInterval(t); cb(); }
    }, 150);
  }

  var mNodes = [];
  document.querySelectorAll('.pdf-page').forEach(function(page) {
    var b64 = page.getAttribute('data-md-b64');
    if (!b64) return;
    page.innerHTML = marked.parse(preprocessMd(dec(b64)));
    page.removeAttribute('data-md-b64');
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(page, {
        delimiters: [
          {left:'$$',right:'$$',display:true},
          {left:'$',right:'$',display:false},
          {left:'\\\\(',right:'\\\\)',display:false},
          {left:'\\\\[',right:'\\\\]',display:true}
        ],
        throwOnError: false
      });
    }
    page.querySelectorAll('.mermaid-pending').forEach(function(node) {
      var code = dec(node.getAttribute('data-b64') || '');
      if (!code.trim()) { node.remove(); return; }
      var div = document.createElement('div');
      div.className = 'mermaid'; div.textContent = code;
      node.parentNode.replaceChild(div, node);
      mNodes.push(div);
    });
  });

  // Délai 500 ms : laisse le navigateur stabiliser le DOM avant que
  // Mermaid tente de lire les dimensions et rendre les SVG
  setTimeout(function() {
    if (!mNodes.length) { setTimeout(signalReady, 200); return; }
    try {
      var p = mermaid.run({ nodes: mNodes });
      (p && typeof p.then === 'function' ? p.catch(function(e){ console.error('mermaid:', e); }) : Promise.resolve())
        .then(function() { waitForSvgs(mNodes, 12000, function() { setTimeout(signalReady, 400); }); });
    } catch(e) {
      console.error('mermaid.run threw:', e.message);
      waitForSvgs(mNodes, 12000, function() { setTimeout(signalReady, 400); });
    }
  }, 500);
})();`;

  const html = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8"><title>Export complet</title>
${inlineStyle('katex.min.css')}${inlineStyle('highlight-github.min.css')}
<style>
${themeCss}
${printCss}
body{background:white!important;margin:0;padding:0;}
#moteur-toolbar,#moteur-sidebar,#moteur-banner,#moteur-info-popup,.code-copy-btn{display:none!important;}
.pdf-toc{padding:30mm 20mm;}
.pdf-toc h1{font-size:28px;margin-bottom:2rem;border-bottom:2px solid var(--color-accent);padding-bottom:.3em;}
.pdf-toc ol{font-size:15px;line-height:2.4;padding-left:1.5em;}
.pdf-toc a{color:var(--color-text);text-decoration:none;}
.pdf-page{padding:0;}
#moteur-doc{padding:0!important;max-width:100%!important;margin:0!important;}
.mermaid{text-align:center;margin:1.5rem 0;}
.mermaid svg{
  display:block;
  max-width:100%!important;
  width:auto!important;
  height:auto!important;
  max-height:280px!important;
  margin:0 auto;
}
.code-block pre{background:var(--code-bg);border:1px solid var(--code-border);border-radius:6px;padding:1rem;overflow-x:auto;}
img{max-width:100%;height:auto;}
</style>
</head><body>
<div class="pdf-toc" style="page-break-after:always">
  <h1>Sommaire</h1><ol>${tocItems}</ol>
</div>
${pagesHtml}
${inlineScript('marked.min.js')}${inlineScript('highlight.min.js')}
${inlineScript('katex.min.js')}${inlineScript('katex-auto-render.min.js')}
${inlineScript('mermaid.min.js')}
<script>${renderScript}</script>
</body></html>`;

  const tmp     = fs.mkdtempSync(path.join(os.tmpdir(), 'md2moodle-pdfall-'));
  const tmpHtml = path.join(tmp, 'all.html');
  copyDir(path.join(runtimeDir, 'libs'), path.join(tmp, 'libs'));
  fs.writeFileSync(tmpHtml, html, 'utf-8');

  const pdfName = `${path.basename(input, '.md')}-complet.pdf`;
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
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(
      () => document.querySelector('#moteur-pdf-ready') !== null,
      { timeout: 45000 }
    ).catch(() => log.warn('Timeout rendu — PDF généré quand même'));

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: buildPdfHeader('Export complet', logoB64),
      footerTemplate:  buildPdfFooter(),
    });

    const sizeKb = Math.round(fs.statSync(pdfPath).size / 1024);
    log.done(`PDF complet : ${path.basename(pdfPath)}  (${sizeKb} Ko)`);
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
    const src = m[1].split('?')[0];
    if (src.startsWith('http') || src.startsWith('data:')) continue;
    const abs = path.resolve(sourceDir, src);
    if (fs.existsSync(abs)) {
      const rel  = path.relative(sourceDir, abs);
      const dest = path.join(destDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try { fs.copyFileSync(abs, dest); } catch {}
    }
  }
}

function inlineImagesInMarkdown(content, sourceDir) {
  function toDataUri(src) {
    if (src.startsWith('http') || src.startsWith('data:')) return null;
    const abs = path.resolve(sourceDir, src.split('?')[0]);
    if (!fs.existsSync(abs)) return null;
    const ext = path.extname(abs).slice(1).replace('jpg', 'jpeg') || 'png';
    return `data:image/${ext};base64,${fs.readFileSync(abs).toString('base64')}`;
  }
  // Obsidian wikilinks : ![[image.png]] ou ![[dossier/image.png]]
  content = content.replace(/!\[\[([^\]]+)\]\]/g, (match, src) => {
    const uri = toDataUri(src.trim());
    if (!uri) return match;
    const alt = src.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
    return `![${alt}](${uri})`;
  });
  // Markdown standard : ![alt](src)
  content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const uri = toDataUri(src.trim());
    return uri ? `![${alt}](${uri})` : match;
  });
  // HTML <img src="..."> tags embedded in Markdown
  content = content.replace(/<img([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi, (match, before, src, after) => {
    const uri = toDataUri(src.trim());
    return uri ? `<img${before}src="${uri}"${after}>` : match;
  });
  return content;
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
