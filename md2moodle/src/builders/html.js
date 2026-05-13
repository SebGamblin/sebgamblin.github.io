/**
 * src/builders/html.js
 *
 * Builder HTML : génère une archive .zip déposable sur Moodle.
 *
 * Workflow :
 *  1. Parser le Markdown principal (+ pages du sommaire si --summary)
 *  2. Résoudre les assets locaux
 *  3. Copier runtime (moteur.js, style.css, libs/, fonts/)
 *  4. Générer les pages HTML
 *  5. Créer le .zip
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';

import { parseMarkdown, parseSummary, resolvePages } from '../utils/markdown.js';
import { resolveAssets, copyAssets, rewritePaths } from '../utils/assets.js';
import { renderPage, renderNavBlock } from '../utils/template.js';
import { getRuntimeDir, getThemePath } from '../utils/runtime.js';
import { log } from '../utils/log.js';

export async function buildHtml(ctx) {
  const { input, summary, theme, title: forceTitle, output, open } = ctx;

  log.step(`📦  Packaging HTML : ${path.basename(input)}`);

  // ── 1. Parsing ─────────────────────────────────────────────────────────
  const main = parseMarkdown(input);
  const pageTitle = forceTitle || main.title;
  log.info(`Titre : ${pageTitle}`);

  let chapters = [];
  let extraPages = [];

  if (summary) {
    log.info(`Sommaire : ${path.basename(summary)}`);
    chapters  = parseSummary(summary);
    extraPages = resolvePages(summary, chapters);
    log.info(`${extraPages.length} page(s) détectée(s) dans le sommaire`);
  }

  // ── 2. Préparation dossier temporaire ───────────────────────────────────
  const tmp    = fs.mkdtempSync(path.join(os.tmpdir(), 'md2moodle-'));
  const pkg    = path.join(tmp, path.basename(input, '.md'));
  fs.mkdirSync(pkg, { recursive: true });

  try {
    // ── 3. Copier le runtime ──────────────────────────────────────────────
    const runtimeDir = getRuntimeDir();
    copyDir(path.join(runtimeDir, 'libs'),  path.join(pkg, 'libs'));
    log.ok('Copié : libs/');

    // moteur.js
    fs.copyFileSync(path.join(runtimeDir, 'moteur.js'), path.join(pkg, 'moteur.js'));
    log.ok('Copié : moteur.js');

    // Thème CSS → style.css
    const themePath = getThemePath(theme);
    fs.copyFileSync(themePath, path.join(pkg, 'style.css'));
    log.ok(`Thème : ${theme} → style.css`);

    // Logo optionnel
    if (ctx.logo && fs.existsSync(ctx.logo)) {
      fs.copyFileSync(ctx.logo, path.join(pkg, path.basename(ctx.logo)));
      log.ok(`Logo : ${path.basename(ctx.logo)}`);
    } else {
      const defaultLogo = path.join(runtimeDir, 'logo.png');
      if (fs.existsSync(defaultLogo)) {
        fs.copyFileSync(defaultLogo, path.join(pkg, 'logo.png'));
      }
    }

    // ── 4. Page principale ────────────────────────────────────────────────
    const mainAssets = resolveAssets(main.bodyOnly, input);
    const mainMapping = copyAssets(mainAssets.filter(a => a.exists), pkg);
    let mainContent = rewritePaths(main.bodyOnly, mainMapping);
    mainAssets.filter(a => !a.exists).forEach(a => log.warn(`Asset introuvable : ${a.original}`));

    const navBlock = renderNavBlock(
      chapters.map(ch => ({
        ...ch,
        // La page principale correspond au premier lien si c'est l'index
        children: ch.children.map(c => ({
          title: c.title,
          href:  c.href === path.basename(input) ? 'index.html' : c.href,
        })),
      }))
    );

    const indexHtml = renderPage({ title: pageTitle, content: mainContent, navBlock });
    fs.writeFileSync(path.join(pkg, 'index.html'), indexHtml);
    log.ok('Généré : index.html');

    // ── 5. Pages secondaires ──────────────────────────────────────────────
    for (const page of extraPages) {
      if (!fs.existsSync(page.absPath)) {
        log.warn(`Page introuvable : ${page.href}`);
        continue;
      }
      if (path.resolve(page.absPath) === path.resolve(input)) {
        log.dim(`Ignorée (page principale) : ${page.href}`);
        continue;
      }

      const parsed = parseMarkdown(page.absPath);
      const pageAssets = resolveAssets(parsed.bodyOnly, page.absPath);
      const pageMapping = copyAssets(pageAssets.filter(a => a.exists), pkg);
      let pageContent = rewritePaths(parsed.bodyOnly, pageMapping);

      const pageHtml = renderPage({ title: parsed.title, content: pageContent, navBlock });
      const destPath = path.join(pkg, page.href);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, pageHtml);
      log.ok(`Généré : ${page.href}  (${parsed.title})`);
    }

    // ── 6. Créer le zip ───────────────────────────────────────────────────
    const zipName = `${path.basename(input, '.md')}.zip`;
    const zipPath = output
      ? (output.endsWith('.zip') ? output : path.join(output, zipName))
      : path.join(ctx.cwd, zipName);

    await zipDir(pkg, zipPath);
    const sizeKb = Math.round(fs.statSync(zipPath).size / 1024);
    log.done(`Archive créée : ${path.basename(zipPath)}  (${sizeKb} Ko)`);

    printMoodleInstructions(zipPath);

    if (open) openInBrowser(path.join(pkg, 'index.html'));

  } finally {
    // Nettoyage du tmp
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function zipDir(srcDir, destZip) {
  fs.mkdirSync(path.dirname(destZip), { recursive: true });

  return new Promise((resolve, reject) => {
    const output  = createWriteStream(destZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

function printMoodleInstructions(zipPath) {
  console.log(`
\x1b[1mProcédure Moodle :\x1b[0m

  1. Dans votre cours Moodle → \x1b[1mActiver le mode édition\x1b[0m
  2. \x1b[1mAjouter une activité/ressource\x1b[0m → choisir \x1b[1mFichier\x1b[0m
  3. Glisser-déposer \x1b[1m${path.basename(zipPath)}\x1b[0m dans la zone de dépôt
  4. Moodle détecte le zip → cliquer → \x1b[1mDécompresser\x1b[0m
  5. Cliquer sur \x1b[1mindex.html\x1b[0m → \x1b[1mDéfinir comme fichier principal\x1b[0m
  6. Apparence → Affichage : \x1b[1mNouvelle fenêtre\x1b[0m
  7. \x1b[1mEnregistrer\x1b[0m
`);
}

async function openInBrowser(filePath) {
  const { execSync } = await import('child_process');
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start'
            : 'xdg-open';
  try { execSync(`${cmd} "${filePath}"`); } catch {}
}
