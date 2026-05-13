#!/usr/bin/env node
/**
 * scripts/fetch-libs.js
 *
 * Télécharge toutes les librairies JS/CSS dans runtime/libs/.
 * À exécuter une seule fois : node scripts/fetch-libs.js
 *
 * Toutes les URLs utilisent jsdelivr.net (CDN fiable, pas de 404).
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIBS_DIR  = path.resolve(__dirname, '../runtime/libs');
const FONTS_DIR = path.join(LIBS_DIR, 'fonts');

fs.mkdirSync(LIBS_DIR,  { recursive: true });
fs.mkdirSync(FONTS_DIR, { recursive: true });

const NPM = 'https://cdn.jsdelivr.net/npm';

const FILES = [
  // ── marked ──────────────────────────────────────────────────────────────
  { url: `${NPM}/marked@12.0.0/marked.min.js`,                out: 'marked.min.js' },

  // ── highlight.js ────────────────────────────────────────────────────────
  { url: `${NPM}/highlight.js@11.9.0/build/highlight.min.js`, out: 'highlight.min.js' },
  { url: `${NPM}/highlight.js@11.9.0/styles/github.min.css`,  out: 'highlight-github.min.css' },

  // ── KaTeX (tout depuis jsdelivr/npm) ────────────────────────────────────
  { url: `${NPM}/katex@0.16.11/dist/katex.min.js`,            out: 'katex.min.js' },
  { url: `${NPM}/katex@0.16.11/dist/katex.min.css`,           out: 'katex.min.css' },
  { url: `${NPM}/katex@0.16.11/dist/contrib/auto-render.min.js`, out: 'katex-auto-render.min.js' },

  // ── Mermaid ──────────────────────────────────────────────────────────────
  { url: `${NPM}/mermaid@10.9.1/dist/mermaid.min.js`,         out: 'mermaid.min.js' },

  // ── Reveal.js ────────────────────────────────────────────────────────────
  { url: `${NPM}/reveal.js@5.1.0/dist/reveal.js`,             out: 'reveal.min.js' },
  { url: `${NPM}/reveal.js@5.1.0/dist/reveal.css`,            out: 'reveal.min.css' },

  // ── Polices KaTeX ────────────────────────────────────────────────────────
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_AMS-Regular.woff2`,         out: 'fonts/KaTeX_AMS-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Main-Regular.woff2`,        out: 'fonts/KaTeX_Main-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Main-Bold.woff2`,           out: 'fonts/KaTeX_Main-Bold.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Math-Italic.woff2`,         out: 'fonts/KaTeX_Math-Italic.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_SansSerif-Regular.woff2`,   out: 'fonts/KaTeX_SansSerif-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Typewriter-Regular.woff2`,  out: 'fonts/KaTeX_Typewriter-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Size1-Regular.woff2`,       out: 'fonts/KaTeX_Size1-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Size2-Regular.woff2`,       out: 'fonts/KaTeX_Size2-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Caligraphic-Regular.woff2`, out: 'fonts/KaTeX_Caligraphic-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Fraktur-Regular.woff2`,     out: 'fonts/KaTeX_Fraktur-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Script-Regular.woff2`,      out: 'fonts/KaTeX_Script-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Size3-Regular.woff2`,       out: 'fonts/KaTeX_Size3-Regular.woff2' },
  { url: `${NPM}/katex@0.16.11/dist/fonts/KaTeX_Size4-Regular.woff2`,       out: 'fonts/KaTeX_Size4-Regular.woff2' },

  // ── Polices DM (Google Fonts hébergées sur jsdelivr) ─────────────────────
  { url: `${NPM}/@fontsource/dm-sans@5.0.18/files/dm-sans-latin-400-normal.woff2`,            out: 'fonts/DM-Sans-Regular.woff2' },
  { url: `${NPM}/@fontsource/dm-sans@5.0.18/files/dm-sans-latin-500-normal.woff2`,            out: 'fonts/DM-Sans-Medium.woff2' },
  { url: `${NPM}/@fontsource/dm-sans@5.0.18/files/dm-sans-latin-600-normal.woff2`,            out: 'fonts/DM-Sans-SemiBold.woff2' },
  { url: `${NPM}/@fontsource/dm-mono@5.0.19/files/dm-mono-latin-400-normal.woff2`,            out: 'fonts/DM-Mono-Regular.woff2' },
  { url: `${NPM}/@fontsource/dm-mono@5.0.19/files/dm-mono-latin-500-normal.woff2`,            out: 'fonts/DM-Mono-Medium.woff2' },
  { url: `${NPM}/@fontsource/dm-serif-display@5.0.19/files/dm-serif-display-latin-400-normal.woff2`, out: 'fonts/DM-Serif-Display-Regular.woff2' },
  { url: `${NPM}/@fontsource/dm-serif-display@5.0.19/files/dm-serif-display-latin-400-italic.woff2`, out: 'fonts/DM-Serif-Display-Italic.woff2' },
];

// ── Téléchargement avec redirects ─────────────────────────────────────────

function download(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) { reject(new Error('Trop de redirections')); return; }

    const fullDest = path.join(LIBS_DIR, dest);
    fs.mkdirSync(path.dirname(fullDest), { recursive: true });
    const file = fs.createWriteStream(fullDest);

    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        file.close();
        fs.unlink(fullDest, () => {});
        return download(res.headers.location, dest, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(fullDest, () => {});
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    });

    req.on('error', (e) => { fs.unlink(fullDest, () => {}); reject(e); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const C = { g: '\x1b[92m', r: '\x1b[91m', y: '\x1b[93m', d: '\x1b[2m', b: '\x1b[1m', z: '\x1b[0m' };

  console.log(`\n${C.b}📦 Téléchargement des librairies…${C.z}`);
  console.log(`   Destination : ${LIBS_DIR}\n`);

  let ok = 0, skip = 0, fail = 0;
  const errors = [];

  for (const { url, out } of FILES) {
    const dest = path.join(LIBS_DIR, out);

    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`  ${C.d}⏭  Déjà présent : ${out}${C.z}`);
      skip++; ok++;
      continue;
    }

    process.stdout.write(`  ↓  ${out.padEnd(48)} `);
    try {
      await download(url, out);
      console.log(`${C.g}✓${C.z}`);
      ok++;
    } catch (e) {
      console.log(`${C.r}✗  ${e.message}${C.z}`);
      errors.push({ out, url, msg: e.message });
      fail++;
    }
  }

  const total = FILES.length;
  console.log(`\n  ${C.g}${ok} / ${total} fichiers OK${C.z}${fail > 0 ? `, ${C.r}${fail} erreur(s)${C.z}` : ''}`);

  if (errors.length > 0) {
    console.log(`\n${C.y}  Fichiers manquants :${C.z}`);
    for (const e of errors) {
      console.log(`    ${C.r}✗${C.z} ${e.out}`);
      console.log(`       ${C.d}${e.url}${C.z}`);
    }
    console.log(`\n  Relancez la commande pour réessayer, ou copiez ces fichiers manuellement.`);
    console.log(`  (Les librairies existantes ne seront pas re-téléchargées)\n`);
    process.exit(1);
  } else {
    console.log(`\n${C.b}${C.g}✅ Toutes les librairies sont prêtes !${C.z}\n`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
