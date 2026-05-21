#!/usr/bin/env node
/**
 * md2moodle — CLI entry point
 *
 * Usage :
 *   md2moodle --init html                              → cours seul
 *   md2moodle --init html --summary                    → cours multi-pages
 *   md2moodle --init exam                              → examen
 *   md2moodle --type html  cours.md [--summary ...]   → .zip Moodle
 *   md2moodle --type pdf   cours.md                   → cours.pdf
 *   md2moodle --type examen examen.md                 → examen.pdf
 *   md2moodle --type serve cours.md                   → serveur live-reload
 */

import { program } from 'commander';
import path from 'path';
import fs from 'fs';

program
  .name('md2moodle')
  .description('Convertit des fichiers Markdown en cours HTML/PDF pour Moodle')
  .version('2.0.0')
  .addHelpText('after', `
Commandes courantes :

  md2moodle init html                          Initialiser un cours
  md2moodle init html --multi                  Initialiser un cours multi-pages
  md2moodle init exam                          Initialiser un examen

  md2moodle --type serve cours.md              Prévisualiser en live (live-reload)
  md2moodle --type html  cours.md                      Exporter pour Moodle (.zip)
  md2moodle --type html  cours.md --standalone          Fichier HTML unique tout-en-un
  md2moodle --type pdf   cours.md              Exporter en PDF

  md2moodle --type examen       examen.md               Copie étudiant
  md2moodle --type examen       examen.md --with-answers Corrigé enseignant
  md2moodle --type corriger copies/ --ref examen.md      Corriger des copies
`);

// ── Commande --init ───────────────────────────────────────────────────────
program
  .command('init <type>')
  .description('Initialiser un projet : html | exam')
  .option('--multi',              'Créer une structure multi-pages avec sommaire (html uniquement)')
  .option('-o, --output <path>',  'Dossier de sortie (défaut : dossier courant)')
  .action(async (type, opts) => {
    const { init } = await import('../builders/init.js');
    await init({
      initType:    type,
      withSummary: opts.multi || false,
      output:      opts.output || null,
      cwd:         process.cwd(),
    });
  });

// ── Commande principale ───────────────────────────────────────────────────
program
  .argument('[input]', 'Fichier Markdown principal')
  .option('-t, --type <type>',    'Sortie : html | pdf | examen | serve | corriger', 'html')
  .option('-i, --index <file>',   'Page principale (alias de l\'argument positionnel)')
  .option('-s, --summary <file>', 'Fichier sommaire Markdown (multi-pages)')
  .option('-o, --output <path>',  'Répertoire ou fichier de sortie')
  .option('--standalone',         'Export HTML unique tout-en-un (--type html)')
  .option('--ref <file>',         'Examen de référence avec corrigé (--type corriger)')
  .option('--with-answers',       'Générer le corrigé enseignant (--type examen)')
  .option('--theme <name>',       'Thème CSS : default | dark | minimal | red', 'default')
  .option('--title <string>',     'Titre forcé du cours')
  .option('--logo <file>',        'Logo personnalisé (PNG/SVG)')
  .option('--port <number>',      'Port du serveur dev (défaut : 3737)', '3737')
  .option('--open',               'Ouvrir le navigateur après génération')
  .option('--vscode',             'Ouvrir dans le Simple Browser VSCode (--type serve)')
  .action(async (inputArg, opts) => {

    const inputFile = opts.index || inputArg;
    if (!inputFile) {
      console.error('\n❌  Aucun fichier d\'entrée spécifié.');
      console.error('   Exemples :');
      console.error('     md2moodle init html              → initialiser un cours');
      console.error('     md2moodle init html --multi      → cours multi-pages');
      console.error('     md2moodle init exam              → initialiser un examen');
      console.error('     md2moodle --type html  cours.md');
      console.error('     md2moodle --type serve cours.md\n');
      process.exit(1);
    }

    const absInput = path.resolve(process.cwd(), inputFile);
    if (!fs.existsSync(absInput)) {
      console.error(`\n❌  Fichier ou dossier introuvable : ${absInput}\n`);
      process.exit(1);
    }

    const context = {
      input:       absInput,
      summary:     opts.summary ? path.resolve(process.cwd(), opts.summary) : null,
      type:        opts.type,
      theme:       opts.theme,
      title:       opts.title       || null,
      logo:        opts.logo        ? path.resolve(process.cwd(), opts.logo) : null,
      output:      opts.output      ? path.resolve(process.cwd(), opts.output) : null,
      corrige:     opts.ref         || null,
      withAnswers: opts.withAnswers || false,
      port:        parseInt(opts.port, 10) || 3737,
      vscode:      opts.vscode      || false,
      open:        opts.open        || false,
      cwd:         process.cwd(),
    };

    try {
      switch (context.type) {
        case 'html': {
          if (opts.standalone) {
            const { buildStandalone } = await import('../builders/standalone.js');
            await buildStandalone(context);
          } else {
            const { buildHtml } = await import('../builders/html.js');
            await buildHtml(context);
          }
          break;
        }
        case 'pdf': {
          const { buildPdf } = await import('../builders/pdf.js');
          await buildPdf(context);
          break;
        }
        case 'examen': {
          const { buildExamen } = await import('../builders/examen.js');
          await buildExamen(context);
          break;
        }
        case 'serve': {
          const { serve } = await import('../builders/serve.js');
          await serve(context);
          break;
        }
        case 'corriger': {
          const { corriger } = await import('../builders/corriger.js');
          await corriger(context);
          break;
        }
        default:
          console.error(`\n❌  Type inconnu : "${context.type}"`);
          console.error('   Types disponibles : html | pdf | examen | serve | corriger\n');
          process.exit(1);
      }
    } catch (e) {
      console.error(`\n❌  Erreur : ${e.message}`);
      if (process.env.DEBUG) console.error(e.stack);
      process.exit(1);
    }
  });

program.parse();
