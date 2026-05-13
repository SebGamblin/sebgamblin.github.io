#!/usr/bin/env node
/**
 * md2moodle — CLI entry point
 *
 * Usage :
 *   md2moodle --type html  cours.md [--summary summary.md]  → .zip Moodle
 *   md2moodle --type pdf   cours.md                         → cours.pdf
 *   md2moodle --type examen examen.md                       → examen.pdf
 *   md2moodle --type serve cours.md                         → serveur live-reload
 *   md2moodle --type serve cours.md --vscode                → panneau VSCode
 */

import { program } from 'commander';
import path from 'path';
import fs from 'fs';

program
  .name('md2moodle')
  .description('Convertit des fichiers Markdown en cours HTML/PDF pour Moodle')
  .version('2.0.0');

program
  .argument('[input]', 'Fichier Markdown principal')
  .option('-t, --type <type>',    'Sortie : html | pdf | examen | serve', 'html')
  .option('-i, --index <file>',   'Page principale (alias de l\'argument positionnel)')
  .option('-s, --summary <file>', 'Fichier sommaire Markdown (multi-pages)')
  .option('-o, --output <path>',  'Répertoire ou fichier de sortie')
  .option('--theme <name>',       'Thème CSS : default | dark | minimal', 'default')
  .option('--title <string>',     'Titre forcé du cours')
  .option('--logo <file>',        'Logo personnalisé (PNG/SVG)')
  .option('--port <number>',      'Port du serveur dev (défaut : 3737)', '3737')
  .option('--vscode',             'Ouvrir dans le Simple Browser VSCode (--type serve)')
  .option('--no-open',            'Ne pas ouvrir le navigateur automatiquement')
  .action(async (inputArg, opts) => {

    // Résoudre le fichier principal
    const inputFile = opts.index || inputArg;
    if (!inputFile) {
      console.error('\n❌  Aucun fichier d\'entrée spécifié.');
      console.error('   Exemples :');
      console.error('     md2moodle --type html  cours.md');
      console.error('     md2moodle --type pdf   cours.md');
      console.error('     md2moodle --type serve cours.md\n');
      process.exit(1);
    }

    const absInput = path.resolve(process.cwd(), inputFile);
    if (!fs.existsSync(absInput)) {
      console.error(`\n❌  Fichier introuvable : ${absInput}\n`);
      process.exit(1);
    }

    const context = {
      input:   absInput,
      summary: opts.summary ? path.resolve(process.cwd(), opts.summary) : null,
      type:    opts.type,
      theme:   opts.theme,
      title:   opts.title   || null,
      logo:    opts.logo    ? path.resolve(process.cwd(), opts.logo) : null,
      output:  opts.output  ? path.resolve(process.cwd(), opts.output) : null,
      port:    parseInt(opts.port, 10) || 3737,
      vscode:  opts.vscode  || false,
      noOpen:  !opts.open,          // commander retourne opts.open=false quand --no-open
      cwd:     process.cwd(),
    };

    try {
      switch (context.type) {
        case 'html': {
          const { buildHtml } = await import('../builders/html.js');
          await buildHtml(context);
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
        default:
          console.error(`\n❌  Type inconnu : "${context.type}"`);
          console.error('   Types disponibles : html | pdf | examen | serve\n');
          process.exit(1);
      }
    } catch (e) {
      console.error(`\n❌  Erreur : ${e.message}`);
      if (process.env.DEBUG) console.error(e.stack);
      process.exit(1);
    }
  });

program.parse();
