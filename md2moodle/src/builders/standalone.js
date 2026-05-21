/**
 * src/builders/standalone.js
 *
 * Génère un fichier HTML unique et autonome — tout est inliné :
 * CSS, JS (marked, hljs, KaTeX, mermaid), fonts (base64), contenu Markdown.
 *
 * Usage : md2moodle --type html cours.md --standalone
 *
 * Le fichier produit (~1-2 Mo) est directement uploadable sur Moodle
 * sans dézippage. Le Markdown source est dans data-b64, modifiable
 * en ouvrant le fichier dans un éditeur et cherchant "cours-md".
 */

import fs   from 'fs';
import path from 'path';

import { parseMarkdown }      from '../utils/markdown.js';
import { getRuntimeDir, getThemeCss } from '../utils/runtime.js';
import { log }                from '../utils/log.js';

export async function buildStandalone(ctx) {
  const { input, theme = 'default', title: forceTitle, output } = ctx;

  log.step(`📄  Export HTML standalone : ${path.basename(input)}`);

  const parsed     = parseMarkdown(input);
  const title      = forceTitle || parsed.title;
  const runtimeDir = getRuntimeDir();
  const libsDir    = path.join(runtimeDir, 'libs');

  log.info(`Titre : ${title}`);

  // ── Lire et inliner tous les assets ──────────────────────────────────────

  function readLib(file) {
    const p = path.join(libsDir, file);
    if (!fs.existsSync(p)) { log.warn(`Lib manquante : ${file}`); return ''; }
    return fs.readFileSync(p, 'utf-8');
  }

  function readLibB64(file) {
    const p = path.join(libsDir, file);
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p).toString('base64');
  }

  // CSS : katex + hljs + thème — réécrit les url(fonts/...) en base64
  const katexCssRaw = readLib('katex.min.css');
  const hljsCss     = readLib('highlight-github.min.css');
  const themeCss    = getThemeCss(theme);
  const moteurJs    = fs.readFileSync(path.join(runtimeDir, 'moteur.js'), 'utf-8');

  // Réécrire les fonts KaTeX en data URIs
  const katexCss = katexCssRaw.replace(
    /url\(["']?(fonts\/[^"')]+\.woff2)["']?\)/g,
    (match, fontPath) => {
      const b64 = readLibB64(fontPath);
      return b64 ? `url("data:font/woff2;base64,${b64}")` : match;
    }
  );

  // Fonts DM (utilisées par le thème)
  const dmFonts = [
    ['DM Sans', 400, 'normal',  'DM-Sans-Regular'],
    ['DM Sans', 500, 'normal',  'DM-Sans-Medium'],
    ['DM Sans', 600, 'normal',  'DM-Sans-SemiBold'],
    ['DM Mono', 400, 'normal',  'DM-Mono-Regular'],
    ['DM Mono', 500, 'normal',  'DM-Mono-Medium'],
    ['DM Serif Display', 400, 'normal', 'DM-Serif-Display-Regular'],
    ['DM Serif Display', 400, 'italic', 'DM-Serif-Display-Italic'],
  ].map(([family, weight, style, file]) => {
    const b64 = readLibB64(`fonts/${file}.woff2`);
    if (!b64) return '';
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};` +
      `src:url("data:font/woff2;base64,${b64}")format('woff2')}`;
  }).join('\n');

  // JS libs
  const markedJs  = readLib('marked.min.js');
  const hljsJs    = readLib('highlight.min.js');
  const katexJs   = readLib('katex.min.js');
  const autoRender= readLib('katex-auto-render.min.js');
  const mermaidJs = readLib('mermaid.min.js');

  // Contenu Markdown
  const b64 = Buffer.from(parsed.bodyOnly.replace(/\r/g, ''), 'utf-8').toString('base64');

  // Logo optionnel
  let logoB64 = '';
  const logoPath = ctx.logo || path.join(path.dirname(input), 'logo.png');
  if (fs.existsSync(logoPath)) {
    const ext = path.extname(logoPath).slice(1).replace('jpg', 'jpeg');
    logoB64 = `data:image/${ext};base64,${fs.readFileSync(logoPath).toString('base64')}`;
  } else {
    const runtimeLogo = path.join(runtimeDir, 'logo.png');
    if (fs.existsSync(runtimeLogo)) {
      logoB64 = `data:image/png;base64,${fs.readFileSync(runtimeLogo).toString('base64')}`;
    }
  }

  // ── Assembler le HTML ─────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
${dmFonts}
${katexCss}
${hljsCss}
${themeCss}
</style>
</head>
<body>

<div id="cours-md" style="display:none" data-b64="${b64}"></div>

<script>${markedJs}</script>
<script>${hljsJs}</script>
<script>${katexJs}</script>
<script>${autoRender}</script>
<script>${mermaidJs}</script>
<script>
// Logo inliné pour le mode serve/open
window.__md2moodle_logo = ${JSON.stringify(logoB64)};
</script>
<script>${moteurJs}</script>

</body>
</html>`;

  // ── Écrire le fichier ─────────────────────────────────────────────────────
  const htmlName = `${path.basename(input, '.md')}.html`;
  const htmlPath = output
    ? (output.endsWith('.html') ? output : path.join(output, htmlName))
    : path.join(ctx.cwd, htmlName);

  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, 'utf-8');

  const sizeKb = Math.round(fs.statSync(htmlPath).size / 1024);
  log.done(`Fichier standalone : ${path.basename(htmlPath)}  (${sizeKb} Ko)`);
  log.dim(`Moodle : Activité → Fichier → déposer ${htmlName} → Affichage : Nouvelle fenêtre`);

  if (ctx.open) {
    const { exec } = await import('child_process');
    const isWSL = process.platform === 'linux' &&
      (process.env.WSL_DISTRO_NAME || fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop'));
    const cmd = isWSL ? `cmd.exe /c start "" "${htmlPath.replace(/\//g, '\\')}"`
      : process.platform === 'darwin' ? `open "${htmlPath}"`
      : `xdg-open "${htmlPath}"`;
    exec(cmd, () => {});
  }
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
