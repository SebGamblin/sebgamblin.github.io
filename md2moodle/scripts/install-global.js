#!/usr/bin/env node
/**
 * scripts/install-global.js
 *
 * Script d'installation globale interactif.
 * Exécuté automatiquement après `npm install -g`.
 *
 * Usage manuel : node scripts/install-global.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

console.log(`
\x1b[1m\x1b[96m╔═══════════════════════════════════╗
║        md2moodle installer        ║
╚═══════════════════════════════════╝\x1b[0m
`);

// Vérifier Node.js >= 18
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`\x1b[91m✗  Node.js 18+ requis (actuel : ${process.version})\x1b[0m`);
  process.exit(1);
}
console.log(`  \x1b[92m✓\x1b[0m  Node.js ${process.version}`);

// Vérifier que les dépendances sont installées
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const missing = Object.keys(pkg.dependencies || {}).filter(dep => {
  try {
    return !fs.existsSync(path.join(ROOT, 'node_modules', dep));
  } catch { return true; }
});

if (missing.length > 0) {
  console.log(`\n  → Installation des dépendances npm…`);
  execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
}

// Télécharger les librairies runtime
const libsDir = path.join(ROOT, 'runtime', 'libs');
const hasLibs  = fs.existsSync(libsDir) &&
  fs.readdirSync(libsDir).filter(f => f.endsWith('.js')).length >= 4;

if (!hasLibs) {
  console.log(`\n  → Téléchargement des librairies runtime…`);
  execSync(`node ${path.join(ROOT, 'scripts', 'fetch-libs.js')}`, { stdio: 'inherit' });
} else {
  console.log(`  \x1b[92m✓\x1b[0m  Librairies runtime déjà présentes`);
}

console.log(`
\x1b[1m\x1b[92m✅ md2moodle est prêt !\x1b[0m

  Commandes disponibles :

    md2moodle --type html  cours.md                 → archive Moodle (.zip)
    md2moodle --type pdf   cours.md                 → PDF cours
    md2moodle --type examen examen.md               → PDF examen
    md2moodle --type serve cours.md                 → serveur live-reload

  Options utiles :

    --theme dark|minimal|default
    --summary summary.md            (multi-pages)
    --output dossier/              (répertoire de sortie)
    --title "Mon titre forcé"
    --open                          (ouvrir après génération)

  Documentation : https://github.com/votre-repo/md2moodle
`);
