/**
 * src/builders/corriger.js
 *
 * Correction semi-automatique de copies scannées.
 *
 * Usage :
 *   md2moodle --type corriger copies/ --corrige examen.md --output rapport/
 *   md2moodle --type corriger copies/ --corrige examen.md --serve
 *
 * Dépendances supplémentaires (npm install dans le projet) :
 *   sharp        — redimensionner/normaliser les images de scan
 *   pdf2pic      — convertir PDF → images
 *
 * Fonctionnement :
 *  1. Parser examen.md → extraire questions, bonnes réponses, barèmes
 *  2. Pour chaque copie (PDF ou image) :
 *     a. Convertir en image(s) haute résolution
 *     b. Détecter les zones de réponse par leur position connue
 *     c. QCM   → analyser taux de pixels noirs → noter automatiquement
 *     d. Rédigé → extraire l'image de la zone → stocker pour validation humaine
 *  3. Lancer un serveur web local pour la validation humaine
 *  4. Exporter CSV + rapport HTML
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import http from 'http';

import { parseMarkdown } from '../utils/markdown.js';
import { log }           from '../utils/log.js';

// ── Point d'entrée ────────────────────────────────────────────────────────

export async function corriger(ctx) {
  const { corrige, output, serve: doServe } = ctx;

  if (!corrige) {
    log.err('--corrige <fichier.md> est requis');
    process.exit(1);
  }
  if (!ctx.input && !ctx.copies) {
    log.err('Spécifiez un dossier ou des fichiers de copies (1er argument)');
    process.exit(1);
  }

  log.step('🔍  Correction de copies');

  // ── 1. Parser le corrigé ──────────────────────────────────────────────────
  const corrigeFile = path.resolve(ctx.cwd, corrige);
  const questions   = parseCorrige(corrigeFile);
  log.info(`${questions.length} question(s) détectée(s) dans le corrigé`);
  questions.forEach(q => log.dim(`  Q${q.id} [${q.type}] — ${q.points} pt(s) — "${q.label}"`));

  // ── 2. Lister les copies ──────────────────────────────────────────────────
  const copiesDir = path.resolve(ctx.cwd, ctx.input);
  const copies    = listCopies(copiesDir);
  if (!copies.length) {
    log.err(`Aucune copie trouvée dans : ${copiesDir}`);
    process.exit(1);
  }
  log.info(`${copies.length} copie(s) trouvée(s)`);

  // ── 3. Répertoire de sortie ───────────────────────────────────────────────
  const outDir = output
    ? path.resolve(ctx.cwd, output)
    : path.join(ctx.cwd, 'rapport-correction');
  fs.mkdirSync(outDir, { recursive: true });
  const imagesDir = path.join(outDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  // ── 4. Traiter chaque copie ───────────────────────────────────────────────
  const resultats = [];

  for (const copyPath of copies) {
    const name = path.basename(copyPath, path.extname(copyPath));
    log.info(`Traitement : ${path.basename(copyPath)}`);

    try {
      const pages = await extractPages(copyPath, imagesDir, name);
      const resultat = await analyserCopie(name, pages, questions, imagesDir);
      resultats.push(resultat);
      log.ok(`  Score auto : ${resultat.scoreAuto}/${resultat.totalAuto} pts (QCM)`);
    } catch (e) {
      log.warn(`  Erreur sur ${name} : ${e.message}`);
      resultats.push({ etudiant: name, erreur: e.message, questions: [] });
    }
  }

  // ── 5. Sauvegarder l'état ─────────────────────────────────────────────────
  const stateFile = path.join(outDir, 'resultats.json');
  const state     = loadState(stateFile);

  // Fusionner avec l'état existant (préserver les notes manuelles)
  for (const r of resultats) {
    const existing = state.resultats.find(e => e.etudiant === r.etudiant);
    if (!existing) {
      state.resultats.push(r);
    } else {
      // Mettre à jour les auto, préserver les manuels
      for (const q of r.questions) {
        const eq = existing.questions.find(eq => eq.id === q.id);
        if (!eq) existing.questions.push(q);
        else if (q.type === 'qcm') eq.scoreAuto = q.scoreAuto; // recalculer auto
      }
    }
  }
  state.questions  = questions;
  state.lastUpdate = new Date().toISOString();
  saveState(stateFile, state);

  // ── 6. Exporter CSV ───────────────────────────────────────────────────────
  exportCsv(state, path.join(outDir, 'notes.csv'));
  log.ok(`CSV exporté : ${path.join(outDir, 'notes.csv')}`);

  // ── 7. Mode serveur ou simple rapport ────────────────────────────────────
  if (doServe || ctx.open) {
    await lancerServeur(state, stateFile, outDir, imagesDir, questions);
  } else {
    log.done(`Rapport : ${outDir}`);
    log.dim('  Lancez avec --serve pour ouvrir l\'interface de validation');
    log.dim(`  CSV : ${path.join(outDir, 'notes.csv')}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PARSING DU CORRIGÉ
// ══════════════════════════════════════════════════════════════════════════

/**
 * Parser le fichier examen.md et extraire toutes les questions avec :
 *  - type     : 'qcm' | 'redige'
 *  - label    : texte de la question
 *  - points   : nombre de points
 *  - reponses : pour QCM, liste { texte, correcte }
 *  - horizontal : true si {.horizontal}
 */
export function parseCorrige(filePath) {
  const parsed  = parseMarkdown(filePath);
  let content   = parsed.bodyOnly;

  // Appliquer la même numérotation automatique que preprocessExam
  let partieNum = 0, questionNum = 0;
  content = content.replace(/^(#{2,3})\s+(.+)$/gm, (match, hashes, title) => {
    if (hashes === '##') { partieNum++; questionNum = 0; return match; }
    if (hashes === '###') {
      questionNum++;
      const t = title.trim().replace(/\r/g, '');
      if (/^Question\s+\d+\.\d+/i.test(t)) return match;
      const scoreMatch = t.match(/^(.*?)\s*(\*\s*\(?\s*\d+(?:[.,]\d+)?\s*pts?\s*\)?\s*\*)$/i);
      const label = scoreMatch ? scoreMatch[1].trim() : t;
      const score = scoreMatch ? ' ' + scoreMatch[2] : '';
      const suffix = label ? ` — ${label}${score}` : score;
      return `### Question ${partieNum}.${questionNum}${suffix}`;
    }
    return match;
  });

  const lines   = content.split('\n');

  const questions = [];
  let qId = 0;
  let i   = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Titre de question : ### Question X.Y *(N pts)*
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      const label      = h3Match[1].trim();
      const ptsMatch   = label.match(/\*\s*\(?\s*(\d+(?:[.,]\d+)?)\s*pt[s]?\s*\)?\s*\*/i);
      const points     = ptsMatch ? parseFloat(ptsMatch[1].replace(',', '.')) : 0;

      // Lire les lignes suivantes pour trouver les items de liste
      const items = [];
      let j = i + 1;
      let texteQuestion = '';
      let isHorizontal  = false;

      while (j < lines.length) {
        const l = lines[j];

        // Arrêt sur un nouveau titre
        if (l.match(/^#{1,3}\s/)) break;
        // Séparateur de section
        if (l.match(/^---+\s*$/)) break;
        // Directive ::: reponse
        if (l.match(/^:::\s*reponse/)) break;

        // Item de liste QCM : - [ ] texte  ou - [x] texte
        const itemMatch = l.match(/^[ \t]*-\s+\[([ xX])\]\s+(.*)/);
        // Item vrai/faux : - [v] texte  ou - [f] texte
        const vfMatch   = l.match(/^[ \t]*-\s+\[([vVfF])\]\s+(.*)/);
        if (itemMatch) {
          items.push({
            texte:    itemMatch[2].trim(),
            correcte: itemMatch[1].trim().toLowerCase() === 'x',
          });
        } else if (vfMatch) {
          items.push({
            texte:    vfMatch[2].trim(),
            correcte: vfMatch[1].toLowerCase() === 'v',
            isVF:     true,
          });
        }
        // Directive {.horizontal}
        if (l.trim() === '{.horizontal}') isHorizontal = true;
        // Texte de question (paragraphe)
        if (l.trim() && !itemMatch && !l.startsWith(':::') && !l.startsWith('{')) {
          texteQuestion += (texteQuestion ? ' ' : '') + l.trim();
        }
        j++;
      }

      if (items.length > 0) {
        const isVF = items.some(it => it.isVF);
        qId++;
        questions.push({
          id:         qId,
          type:       isVF ? 'vraifaux' : 'qcm',
          label,
          texte:      texteQuestion,
          points,
          reponses:   items,
          horizontal: isHorizontal,
        });
        i = j;
        continue;
      } else {
        // Question rédigée — chercher ::: reponse N
        let nbLignes = 6;
        for (let k = i + 1; k < Math.min(i + 20, lines.length); k++) {
          const rm = lines[k].match(/^:::\s*reponse\s+(\d+)/);
          if (rm) { nbLignes = parseInt(rm[1]); break; }
        }
        qId++;
        questions.push({
          id:      qId,
          type:    'redige',
          label,
          texte:   texteQuestion,
          points,
          nbLignes,
        });
        i = j;
        continue;
      }
    }

    i++;
  }

  return questions;
}

// ══════════════════════════════════════════════════════════════════════════
// EXTRACTION DES PAGES
// ══════════════════════════════════════════════════════════════════════════

async function extractPages(copyPath, imagesDir, name) {
  const ext = path.extname(copyPath).toLowerCase();
  const pages = [];

  if (ext === '.pdf') {
    try {
      const puppeteer = (await import('puppeteer')).default;
      const browser   = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',      // permet d'ouvrir file://
        ],
      });

      // Puppeteer tourne dans le contexte Linux (WSL), pas Windows.
      // Le chemin /mnt/c/... est directement accessible via file:///mnt/c/...
      const fileUrl = `file://${copyPath.replace(/\\/g, '/')}`;

      const page = await browser.newPage();

      // A4 à 150dpi = 1240 × 1754 px
      const W = 1240, H = 1754;
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000)); // laisser le viewer PDF se stabiliser

      // Détecter le nombre de pages via la hauteur du document PDF rendu
      const docHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => H);
      const pageCount = Math.max(1, Math.round(docHeight / H));
      log.info(`  PDF : ~${pageCount} page(s) détectée(s)`);

      for (let p = 0; p < pageCount; p++) {
        const outFile = path.join(imagesDir, `${name}_p${p + 1}.png`);
        await page.screenshot({
          path: outFile,
          clip: { x: 0, y: p * H, width: W, height: H },
        });
        pages.push(outFile);
        log.ok(`  Page ${p + 1} → ${path.basename(outFile)}`);
      }

      await browser.close();

    } catch (e) {
      log.warn(`  Conversion PDF→image échouée : ${e.message}`);
      log.warn('  Les images ne seront pas disponibles dans l\'interface');
    }

  } else if (['.png', '.jpg', '.jpeg', '.tiff', '.tif'].includes(ext)) {
    const dest = path.join(imagesDir, `${name}_p1${ext}`);
    fs.copyFileSync(copyPath, dest);
    pages.push(dest);
  }

  return pages;
}

// ══════════════════════════════════════════════════════════════════════════
// ANALYSE D'UNE COPIE
// ══════════════════════════════════════════════════════════════════════════

async function analyserCopie(name, pages, questions, imagesDir) {
  const resultat = {
    etudiant:  name,
    pages:     pages.map(p => path.basename(p)),
    questions: [],
    scoreAuto:   0,
    totalAuto:   0,
    scoreManuel: 0,
    totalManuel: 0,
    scoreTotal:  0,
    validated:   false,
  };

  // Tentative d'analyse pixel si sharp est disponible
  let sharpAvailable = false;
  try {
    await import('sharp');
    sharpAvailable = true;
  } catch {}

  for (const q of questions) {
    const qResult = {
      id:          q.id,
      type:        q.type,
      label:       q.label,
      points:      q.points,
      scoreAuto:   null,
      scoreManuel: null,  // rempli par l'interface
      commentaire: '',
      validated:   false,
      imageFile:   null,  // chemin relatif vers l'extrait de zone
    };

    if (q.type === 'qcm' && sharpAvailable && pages.length > 0) {
      // Analyser la zone QCM dans l'image
      // Note : sans calibration de mise en page, on retourne null → validation manuelle
      // Un vrai déploiement nécessiterait une calibration via des marqueurs de page
      qResult.scoreAuto = null; // sera rempli après calibration
      qResult.imageFile = pages[0] ? path.basename(pages[0]) : null;
    }

    if (q.type === 'redige' || q.scoreAuto === null) {
      // Toujours en attente de validation humaine
      qResult.imageFile = pages[0] ? path.basename(pages[0]) : null;
    }

    if (q.type === 'qcm') {
      resultat.totalAuto += q.points;
      if (qResult.scoreAuto !== null) resultat.scoreAuto += qResult.scoreAuto;
    } else {
      resultat.totalManuel += q.points;
    }

    resultat.questions.push(qResult);
  }

  return resultat;
}

// ══════════════════════════════════════════════════════════════════════════
// ÉTAT ET CSV
// ══════════════════════════════════════════════════════════════════════════

function loadState(file) {
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
  }
  return { resultats: [], questions: [], lastUpdate: null };
}

function saveState(file, state) {
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

function exportCsv(state, outPath) {
  const { questions, resultats } = state;
  if (!questions.length || !resultats.length) return;

  const header = ['Etudiant',
    ...questions.map(q => `Q${q.id} (/${q.points}pts)`),
    'Score QCM', 'Score rédige', 'Total', 'Validé'
  ];

  const rows = resultats.map(r => {
    const cells = [r.etudiant];
    let sumAuto = 0, sumManuel = 0;
    for (const q of questions) {
      const rq = r.questions?.find(x => x.id === q.id);
      const score = rq
        ? (rq.scoreManuel ?? rq.scoreAuto ?? '')
        : '';
      cells.push(score);
      if (typeof score === 'number') {
        if (q.type === 'qcm')    sumAuto   += score;
        else                      sumManuel += score;
      }
    }
    cells.push(sumAuto, sumManuel, sumAuto + sumManuel, r.validated ? 'oui' : 'non');
    return cells;
  });

  const csv = [header, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  fs.writeFileSync(outPath, '\uFEFF' + csv, 'utf-8'); // BOM pour Excel
}

// ══════════════════════════════════════════════════════════════════════════
// SERVEUR WEB — interface de validation
// ══════════════════════════════════════════════════════════════════════════

async function lancerServeur(state, stateFile, outDir, imagesDir, questions) {
  const port = await findFreePort(5050);

  const server = http.createServer((req, res) => {
    const url      = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    // Headers CORS pour éviter les blocages fetch
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // API : sauvegarder une note manuelle
    if (pathname === '/api/save' && req.method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { etudiant, questionId, score, commentaire } = JSON.parse(body);
          const state2 = loadState(stateFile);
          const r = state2.resultats.find(x => x.etudiant === etudiant);
          if (r) {
            const q = r.questions.find(x => x.id === questionId);
            if (q) {
              q.scoreManuel  = score;
              q.commentaire  = commentaire || '';
              q.validated    = true;
            }
            // Vérifier si tout est validé
            r.validated = r.questions.every(q => q.validated || q.scoreAuto !== null);
          }
          saveState(stateFile, state2);
          exportCsv(state2, path.join(outDir, 'notes.csv'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // API : état courant
    if (pathname === '/api/state') {
      const state2 = loadState(stateFile);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state2));
      return;
    }

    // Images des copies
    if (pathname.startsWith('/images/')) {
      const imgPath = path.join(imagesDir, pathname.slice('/images/'.length));
      if (fs.existsSync(imgPath)) {
        res.writeHead(200, { 'Content-Type': guessMime(imgPath) });
        res.end(fs.readFileSync(imgPath));
        return;
      }
    }

    // CSV téléchargeable
    if (pathname === '/notes.csv') {
      const csvPath = path.join(outDir, 'notes.csv');
      if (fs.existsSync(csvPath)) {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="notes.csv"',
        });
        res.end(fs.readFileSync(csvPath));
        return;
      }
    }

    // Page principale
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildUI(port));
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    log.done(`Interface de validation : ${url}`);
    log.dim('Ctrl+C pour arrêter');
    openBrowser(url);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// INTERFACE HTML
// ══════════════════════════════════════════════════════════════════════════

function buildUI(port) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Correction — md2moodle</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
:root {
  --bg:      #f8f9fa;
  --surface: #ffffff;
  --border:  #e2e8f0;
  --text:    #1a202c;
  --muted:   #718096;
  --accent:  #2563eb;
  --green:   #22c55e;
  --orange:  #f59e0b;
  --red:     #ef4444;
  --radius:  8px;
}
body { margin:0; font-family: system-ui,sans-serif; font-size:15px;
  background:var(--bg); color:var(--text); line-height:1.5; }

/* Layout */
.layout { display:grid; grid-template-columns:280px 1fr; min-height:100vh; }

/* Sidebar */
.sidebar { background:var(--surface); border-right:1px solid var(--border);
  overflow-y:auto; padding:16px 0; }
.sidebar-header { padding:12px 16px; font-weight:600; font-size:13px;
  text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.student-item { padding:10px 16px; cursor:pointer; border-left:3px solid transparent;
  transition:background .1s, border-color .1s; font-size:14px; }
.student-item:hover { background:var(--bg); }
.student-item.active { border-left-color:var(--accent); background:#eff6ff; color:var(--accent); font-weight:600; }
.student-badge { float:right; font-size:11px; padding:2px 6px; border-radius:4px;
  background:var(--border); color:var(--muted); }
.student-badge.done { background:#dcfce7; color:#166534; }
.student-badge.partial { background:#fef9c3; color:#92400e; }

/* Main */
.main { overflow-y:auto; }
.topbar { background:var(--surface); border-bottom:1px solid var(--border);
  padding:14px 24px; display:flex; align-items:center; gap:16px; }
.topbar h1 { margin:0; font-size:17px; flex:1; }
.btn { padding:7px 14px; border-radius:var(--radius); border:1px solid var(--border);
  background:var(--surface); cursor:pointer; font-size:14px; transition:background .15s; }
.btn:hover { background:var(--bg); }
.btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.btn.primary:hover { background:#1d4ed8; }

.content { padding:24px; }
.empty { text-align:center; color:var(--muted); padding:80px 0; font-size:15px; }

/* Question card */
.q-card { background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius); margin-bottom:20px; overflow:hidden; }
.q-header { padding:14px 18px; border-bottom:1px solid var(--border);
  display:flex; align-items:center; gap:12px; }
.q-num { background:var(--accent); color:#fff; border-radius:20px;
  padding:2px 10px; font-size:12px; font-weight:600; flex-shrink:0; }
.q-label { flex:1; font-size:14px; font-weight:500; }
.q-pts { color:var(--muted); font-size:13px; flex-shrink:0; }
.q-type-badge { font-size:11px; padding:2px 7px; border-radius:4px;
  flex-shrink:0; }
.q-type-badge.qcm   { background:#dbeafe; color:#1e40af; }
.q-type-badge.redige { background:#fef9c3; color:#92400e; }

.q-body { display:grid; grid-template-columns:1fr 1fr; }
@media (max-width:900px) { .q-body { grid-template-columns:1fr; } }

.q-scan { border-right:1px solid var(--border); padding:16px; }
.q-scan img { width:100%; border:1px solid var(--border); border-radius:4px;
  cursor:zoom-in; }
.q-scan .no-img { padding:40px 0; text-align:center; color:var(--muted); font-size:13px; }

.q-note { padding:16px; display:flex; flex-direction:column; gap:12px; }

/* QCM auto */
.qcm-results { background:var(--bg); border-radius:6px; padding:12px; }
.qcm-item { display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:14px; }
.qcm-item:last-child { margin-bottom:0; }
.check-icon { width:18px; height:18px; border-radius:3px; border:1.5px solid var(--border);
  flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:12px; }
.check-icon.correct  { background:#dcfce7; border-color:var(--green); color:#166534; }
.check-icon.wrong    { background:#fee2e2; border-color:var(--red);   color:#991b1b; }
.check-icon.expected { background:#dbeafe; border-color:var(--accent); color:#1e40af; }

/* Score auto label */
.score-auto { font-size:13px; color:var(--muted); }
.score-auto strong { color:var(--text); }

/* Champ score manuel */
.score-field { display:flex; align-items:center; gap:8px; }
.score-field label { font-size:13px; color:var(--muted); flex-shrink:0; }
.score-field input[type=number] {
  width:64px; padding:6px 8px; border:1px solid var(--border);
  border-radius:6px; font-size:15px; text-align:center; }
.score-field .max { font-size:13px; color:var(--muted); }

.comment-field textarea { width:100%; padding:8px; border:1px solid var(--border);
  border-radius:6px; font-size:13px; resize:vertical; min-height:60px; font-family:inherit; }
.comment-field label { font-size:12px; color:var(--muted); display:block; margin-bottom:4px; }

.save-btn { width:100%; padding:8px; background:var(--accent); color:#fff;
  border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:500;
  transition:background .15s; }
.save-btn:hover { background:#1d4ed8; }
.save-btn.saved { background:var(--green); }

/* Stats bar en haut -->
.stats-bar { background:var(--surface); border-bottom:1px solid var(--border);
  padding:10px 24px; display:flex; gap:24px; font-size:13px; }
.stat { display:flex; flex-direction:column; }
.stat-val { font-size:18px; font-weight:600; }
.stat-lbl { color:var(--muted); font-size:11px; }

/* Zoom overlay */
.zoom-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.7);
  z-index:1000; cursor:zoom-out; align-items:center; justify-content:center; }
.zoom-overlay.active { display:flex; }
.zoom-overlay img { max-width:90vw; max-height:90vh; border-radius:6px; }
</style>
</head>
<body>
<div class="zoom-overlay" id="zoom-overlay" onclick="closeZoom()">
  <img id="zoom-img" src="" alt="">
</div>

<div class="layout">

  <aside class="sidebar">
    <div class="sidebar-header">Copies</div>
    <div id="student-list">Chargement…</div>
  </aside>

  <div class="main">
    <div class="topbar">
      <h1 id="topbar-title">Interface de correction</h1>
      <a href="/notes.csv" class="btn">⬇ Exporter CSV</a>
    </div>
    <div class="stats-bar" id="stats-bar" style="display:none">
      <div class="stat"><span class="stat-val" id="stat-total">—</span><span class="stat-lbl">Copies</span></div>
      <div class="stat"><span class="stat-val" id="stat-done">—</span><span class="stat-lbl">Validées</span></div>
      <div class="stat"><span class="stat-val" id="stat-avg">—</span><span class="stat-lbl">Moyenne</span></div>
      <div class="stat"><span class="stat-val" id="stat-max">—</span><span class="stat-lbl">Points max</span></div>
    </div>
    <div class="content" id="content">
      <div class="empty">← Sélectionnez une copie</div>
    </div>
  </div>

</div>

<script>
let state = null;
let currentStudent = null;

async function loadState() {
  const r = await fetch('/api/state');
  state = await r.json();
  renderSidebar();
  renderStats();
}

function renderStats() {
  if (!state || !state.resultats || !state.resultats.length) return;
  const bar = document.getElementById('stats-bar');
  bar.style.display = 'flex';

  const total  = state.resultats.length;
  const done   = state.resultats.filter(r => r.validated).length;
  const maxPts = (state.questions||[]).reduce((s,q) => s + (q.points||0), 0);
  const scores = state.resultats
    .map(r => calcTotal(r))
    .filter(s => s > 0);
  const avg = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '—';

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-done').textContent  = done + '/' + total;
  document.getElementById('stat-avg').textContent   = avg;
  document.getElementById('stat-max').textContent   = maxPts + ' pts';
}

function calcTotal(r) {
  if (!r.questions) return 0;
  return r.questions.reduce((s,q) => {
    const sc = q.scoreManuel ?? q.scoreAuto;
    return s + (typeof sc === 'number' ? sc : 0);
  }, 0);
}

function renderSidebar() {
  const list = document.getElementById('student-list');
  if (!state || !state.resultats || !state.resultats.length) {
    list.innerHTML = '<div style="padding:16px;color:#718096;font-size:13px">Aucune copie chargée</div>';
    return;
  }
  const maxPts = (state.questions||[]).reduce((s,q) => s + (q.points||0), 0);
  list.innerHTML = state.resultats.map(r => {
    const active   = r.etudiant === currentStudent ? 'active' : '';
    const doneCnt  = (r.questions||[]).filter(q => q.validated || q.scoreAuto !== null).length;
    const total_q  = (r.questions||[]).length;
    const badgeCls = r.validated ? 'done' : doneCnt > 0 ? 'partial' : '';
    const score    = calcTotal(r);
    const badgeTxt = r.validated
      ? (score + '/' + maxPts)
      : (doneCnt + '/' + total_q);
    return '<div class="student-item ' + active + '" onclick="selectStudent(' + JSON.stringify(r.etudiant) + ')">'
      + escHtml(r.etudiant)
      + '<span class="student-badge ' + badgeCls + '">' + badgeTxt + '</span>'
      + '</div>';
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function selectStudent(name) {
  currentStudent = name;
  renderSidebar();
  renderStudent();
  document.getElementById('topbar-title').textContent = name;
}

function renderStudent() {
  const r = state.resultats.find(x => x.etudiant === currentStudent);
  if (!r) return;
  const qs = state.questions || [];
  const content = document.getElementById('content');

  content.innerHTML = qs.map(q => {
    const rq = r.questions?.find(x => x.id === q.id) || {};
    return renderQuestionCard(q, rq, r.etudiant);
  }).join('');
}

function renderQuestionCard(q, rq, etudiant) {
  const hasImg = rq.imageFile;
  const imgHtml = hasImg
    ? '<img src="/images/' + rq.imageFile + '" alt="scan" onclick="openZoom(this.src)" title="Cliquer pour zoomer">'
    : '<div class="no-img">Pas d\'image disponible</div>';

  let noteHtml = '';

  if (q.type === 'qcm') {
    // Afficher les réponses et permettre correction manuelle
    const items = q.reponses.map((rep, i) => {
      const marked   = rq.markedIndex === i;
      const correct  = rep.correcte;
      let cls = '', symbol = '';
      if (correct && marked)  { cls = 'correct';  symbol = '✓'; }
      if (correct && !marked) { cls = 'expected'; symbol = '✓'; }
      if (!correct && marked) { cls = 'wrong';    symbol = '✗'; }
      return '<div class="qcm-item">'
        + '<span class="check-icon ' + cls + '">' + (marked ? (correct ? '✓' : '✗') : (correct ? '·' : '')) + '</span>'
        + rep.texte
        + '</div>';
    }).join('');

    noteHtml = '<div class="qcm-results">' + items + '</div>'
      + '<div class="score-field" style="margin-top:8px">'
      + '<label>Note :</label>'
      + '<input type="number" id="score-' + q.id + '" min="0" max="' + q.points + '" step="0.5" '
      + 'value="' + (rq.scoreManuel ?? rq.scoreAuto ?? '') + '">'
      + '<span class="max">/ ' + q.points + ' pts</span>'
      + '</div>';
  } else {
    noteHtml = '<div class="comment-field"><label>Commentaire</label>'
      + '<textarea id="comment-' + q.id + '">' + (rq.commentaire || '') + '</textarea></div>'
      + '<div class="score-field">'
      + '<label>Note :</label>'
      + '<input type="number" id="score-' + q.id + '" min="0" max="' + q.points + '" step="0.5" '
      + 'value="' + (rq.scoreManuel ?? '') + '">'
      + '<span class="max">/ ' + q.points + ' pts</span>'
      + '</div>';
  }

  const savedCls = rq.validated ? 'saved' : '';
  noteHtml += '<button class="save-btn ' + savedCls + '" onclick="saveNote(' + JSON.stringify(etudiant) + ',' + q.id + ',' + q.type + ')" id="btn-' + q.id + '">'
    + (rq.validated ? '✓ Enregistré' : 'Enregistrer') + '</button>';

  return '<div class="q-card">'
    + '<div class="q-header">'
    + '<span class="q-num">Q' + q.id + '</span>'
    + '<span class="q-label">' + q.label + '</span>'
    + '<span class="q-type-badge ' + q.type + '">' + (q.type === 'qcm' ? 'QCM' : 'Rédigé') + '</span>'
    + '<span class="q-pts">' + q.points + ' pt' + (q.points > 1 ? 's' : '') + '</span>'
    + '</div>'
    + '<div class="q-body">'
    + '<div class="q-scan">' + imgHtml + '</div>'
    + '<div class="q-note">' + noteHtml + '</div>'
    + '</div></div>';
}

async function saveNote(etudiant, questionId, type) {
  const scoreEl   = document.getElementById('score-'   + questionId);
  const commentEl = document.getElementById('comment-' + questionId);
  const score     = scoreEl ? parseFloat(scoreEl.value) : null;
  const comment   = commentEl ? commentEl.value : '';

  const r = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ etudiant, questionId, score, commentaire: comment }),
  });
  if (r.ok) {
    const btn = document.getElementById('btn-' + questionId);
    if (btn) { btn.textContent = '✓ Enregistré'; btn.classList.add('saved'); }
    await loadState();
    renderStudent();
  }
}

function openZoom(src) {
  document.getElementById('zoom-img').src = src;
  document.getElementById('zoom-overlay').classList.add('active');
}
function closeZoom() {
  document.getElementById('zoom-overlay').classList.remove('active');
}

loadState();
// Rafraîchir toutes les 5s si plusieurs onglets ouverts
setInterval(async () => {
  await loadState();
  if (currentStudent) renderStudent();
}, 5000);
</script>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════

function listCopies(dir) {
  if (!fs.existsSync(dir)) return [];
  const exts = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif']);
  return fs.readdirSync(dir)
    .filter(f => exts.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => path.join(dir, f));
}

function guessMime(p) {
  return { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
    '.pdf':'application/pdf', '.tif':'image/tiff', '.tiff':'image/tiff' }
    [path.extname(p).toLowerCase()] || 'application/octet-stream';
}

import net from 'net';
function findFreePort(start) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(start, () => { s.close(() => resolve(start)); });
    s.on('error', () => findFreePort(start + 1).then(resolve));
  });
}

import { exec } from 'child_process';
function openBrowser(url) {
  const isWSL = process.platform === 'linux' &&
    (process.env.WSL_DISTRO_NAME || fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop'));
  const cmd = isWSL ? `cmd.exe /c start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32'  ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
