/**
 * src/utils/runtime.js
 *
 * Résolution du répertoire runtime (libs JS/CSS embarquées).
 * Cherche d'abord dans le projet local, puis dans le package installé globalement.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Retourne le chemin absolu vers le dossier runtime/ du package.
 */
export function getRuntimeDir() {
  const candidates = [
    path.resolve(__dirname, '../../runtime'),         // dev local
    path.resolve(__dirname, '../../../runtime'),       // installé globalement
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Répertoire runtime introuvable. Réinstallez le package.');
}

/**
 * Retourne le chemin absolu vers le répertoire des thèmes.
 */
export function getThemesDir() {
  return path.join(getRuntimeDir(), 'themes');
}

/**
 * Retourne le chemin vers un fichier thème CSS.
 */
export function getThemePath(name = 'default') {
  const dir = getThemesDir();
  const file = path.join(dir, `${name}.css`);
  if (!fs.existsSync(file)) {
    const available = fs.readdirSync(dir).filter(f => f.endsWith('.css')).map(f => f.replace('.css', ''));
    throw new Error(`Thème "${name}" introuvable. Disponibles : ${available.join(', ')}`);
  }
  return file;
}
