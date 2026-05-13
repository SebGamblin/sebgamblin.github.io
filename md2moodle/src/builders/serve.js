/**
 * src/builders/serve.js — Serveur de développement avec live-reload
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { EventEmitter } from 'events';
import { exec } from 'child_process';

import { parseMarkdown, parseSummary, resolvePages } from '../utils/markdown.js';
import { getRuntimeDir, getThemePath } from '../utils/runtime.js';
import { renderNavBlock } from '../utils/template.js';
import { log } from '../utils/log.js';

const sse = new EventEmitter();
sse.setMaxListeners(50);

export async function serve(ctx) {
  const { input, summary, theme } = ctx;
  const port   = ctx.port   || 3737;
  const vscode = ctx.vscode || false;
  const noOpen = ctx.noOpen || false;

  log.step(`🌐  Serveur de développement`);
  log.info(`Fichier : ${path.basename(input)}`);
  if (summary) log.info(`Sommaire : ${path.basename(summary)}`);
  log.info(`Port    : ${port}`);

  const runtimeDir = getRuntimeDir();

  // Préparer le nav block depuis le summary
  let navBlock = '';
  let extraPages = []; // [{ href, absPath }]

  if (summary && fs.existsSync(summary)) {
    const chapters = parseSummary(summary);
    extraPages = resolvePages(summary, chapters);
    navBlock = renderNavBlock(
      chapters.map(ch => ({
        ...ch,
        children: (ch.children || []).map(c => ({
          title: c.title,
          href: path.resolve(path.dirname(summary), c.href) === path.resolve(input)
            ? 'index.html' : c.href,
        })),
      }))
    );
    log.info(`${extraPages.length} page(s) dans le sommaire`);
  }

  // ── Serveur HTTP ────────────────────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    const url      = new URL(req.url, `http://localhost:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    // SSE live-reload
    if (pathname === '/__livereload') {
      res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      const send = (r) => res.write(`data: ${r || 'reload'}\n\n`);
      sse.on('change', send);
      req.on('close', () => sse.off('change', send));
      return;
    }

    // Status
    if (pathname === '/__status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, file: input, theme, port }));
      return;
    }

    // Logo
    if (pathname === '/logo.png' || pathname === '/logo.svg') {
      const logoPath = ctx.logo || path.join(path.dirname(input), 'logo.png');
      const runtimeLogo = path.join(runtimeDir, 'logo.png');
      for (const p of [logoPath, runtimeLogo]) {
        if (fs.existsSync(p)) {
          res.writeHead(200, { 'Content-Type': guessMime(p) });
          res.end(fs.readFileSync(p));
          return;
        }
      }
    }

    // Page principale
    if (pathname === '/' || pathname === '/index.html') {
      return servePage(res, input, input, runtimeDir, theme, navBlock);
    }

    // Pages secondaires du sommaire
    const matchedPage = extraPages.find(p =>
      '/' + p.href === pathname || pathname === '/' + p.href
    );
    if (matchedPage) {
      if (!fs.existsSync(matchedPage.absPath)) {
        res.writeHead(404); res.end(`Page introuvable : ${matchedPage.href}`);
        return;
      }
      return servePage(res, matchedPage.absPath, input, runtimeDir, theme, navBlock);
    }

    // Fichiers statiques
    const candidates = [
      path.join(path.dirname(input), pathname.slice(1)),
      path.join(runtimeDir, pathname.slice(1)),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) {
          res.writeHead(200, { 'Content-Type': guessMime(candidate), 'Cache-Control': 'public,max-age=3600' });
          res.end(fs.readFileSync(candidate));
          return;
        }
      } catch {}
    }

    res.writeHead(404);
    res.end(`404 — ${pathname}`);
  });

  await new Promise(resolve => server.listen(port, resolve));

  const url = `http://localhost:${port}`;
  log.done(`Serveur démarré : ${url}`);

  // Watcher
  const { default: chokidar } = await import('chokidar');
  const watchTargets = [
    input,
    path.dirname(input),
    summary,
    getThemePath(theme),
  ].filter(Boolean);

  let debounce = null;
  chokidar.watch(watchTargets, {
    ignoreInitial: true,
    ignored: ['**/node_modules/**', '**/.git/**', '**/*.zip'],
  }).on('all', (event, file) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      log.info(`Modifié : ${path.relative(process.cwd(), file)}  [${event}]`);
      sse.emit('change', path.basename(file));
    }, 80);
  });

  log.info(`Surveillé : ${path.relative(process.cwd(), input)}`);
  log.dim('Ctrl+C pour arrêter — S (slides) · F (plein écran) · P (print)');

  if (!noOpen) setTimeout(() => openBrowser(url, vscode), 400);
}

// ── Servir une page ────────────────────────────────────────────────────────

function servePage(res, mdPath, mainInput, runtimeDir, theme, navBlock) {
  try {
    const parsed   = parseMarkdown(mdPath);
    const themeCss = fs.readFileSync(getThemePath(theme), 'utf-8');
    const moteurJs = fs.readFileSync(path.join(runtimeDir, 'moteur.js'), 'utf-8');
    const page     = buildDevPage(parsed, themeCss, moteurJs, navBlock);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<pre style="font-family:monospace;padding:2rem;color:red">Erreur : ${e.message}\n\n${e.stack}</pre>`);
  }
}

// ── Page HTML dev ──────────────────────────────────────────────────────────

function buildDevPage(parsed, themeCss, moteurJs, navBlock) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(parsed.title)} — dev</title>
<link rel="stylesheet" href="/libs/katex.min.css">
<link rel="stylesheet" href="/libs/highlight-github.min.css">
<!-- reveal.min.css chargé à la demande par moteur.js au passage en mode slides -->
<style>
${themeCss}
#dev-badge {
  position: fixed; bottom: 8px; right: 12px;
  font-family: monospace; font-size: 10px; color: #888;
  background: rgba(0,0,0,.06); border: 1px solid rgba(0,0,0,.1);
  border-radius: 4px; padding: 2px 7px; z-index: 9999; pointer-events: none;
}
#dev-flash {
  position: fixed; top: 0; left: 0; right: 0; height: 3px;
  background: #22c55e; transform: scaleX(0); transform-origin: left;
  transition: transform .3s ease, opacity .5s ease .3s;
  z-index: 9999; pointer-events: none; opacity: 0;
}
#dev-flash.active { transform: scaleX(1); opacity: 1; }
</style>
</head>
<body>

<div id="cours-md" style="display:none">
${parsed.bodyOnly}
</div>

${navBlock}

<script src="/libs/marked.min.js"></script>
<script src="/libs/highlight.min.js"></script>
<script src="/libs/katex.min.js"></script>
<script src="/libs/katex-auto-render.min.js"></script>
<script src="/libs/mermaid.min.js"></script>
<!-- reveal.min.js chargé à la demande par moteur.js -->
<script>${moteurJs}</script>

<div id="dev-badge">⚡ dev</div>
<div id="dev-flash"></div>

<script>
(function () {
  var flash = document.getElementById('dev-flash');
  function connect() {
    var es = new EventSource('/__livereload');
    es.onmessage = function () {
      if (flash) { flash.classList.add('active'); }
      setTimeout(function() { location.reload(); }, 350);
    };
    es.onerror = function () { es.close(); setTimeout(connect, 1500); };
  }
  connect();
})();
</script>
</body>
</html>`;
}

// ── Ouvrir navigateur ──────────────────────────────────────────────────────

function openBrowser(url, vscode) {
  if (vscode) {
    try {
      import('child_process').then(({ execSync }) => {
        execSync(`code --open-url "vscode://vscode.simpleBrowser/show?url=${encodeURIComponent(url)}"`, { stdio: 'ignore' });
        log.ok('Ouvert dans VSCode Simple Browser');
      });
      return;
    } catch { log.warn('VSCode introuvable — ouverture navigateur par défaut'); }
  }

  const isWSL = process.platform === 'linux' &&
    (process.env.WSL_DISTRO_NAME || fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop'));

  const cmd = isWSL                       ? `cmd.exe /c start "" "${url}"`
            : process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32'  ? `start "" "${url}"`
            : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) log.warn(`Ouvrez manuellement : ${url}`);
    else     log.ok(`Navigateur ouvert : ${url}`);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function guessMime(p) {
  const ext = path.extname(p).toLowerCase();
  return { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ttf': 'font/ttf', '.md': 'text/markdown' }[ext] || 'application/octet-stream';
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
