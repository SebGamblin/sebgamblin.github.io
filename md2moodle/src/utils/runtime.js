/**
 * src/utils/runtime.js
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getRuntimeDir() {
  const candidates = [
    path.resolve(__dirname, '../../runtime'),
    path.resolve(__dirname, '../../../runtime'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Répertoire runtime introuvable. Réinstallez le package.');
}

export function getThemesDir() {
  return path.join(getRuntimeDir(), 'themes');
}

export function getThemePath(name = 'default') {
  const dir = getThemesDir();
  const file = path.join(dir, `${name}.css`);
  if (!fs.existsSync(file)) {
    const available = fs.readdirSync(dir)
      .filter(f => f.endsWith('.css'))
      .map(f => f.replace('.css', ''));
    throw new Error(`Thème "${name}" introuvable. Disponibles : ${available.join(', ')}`);
  }
  return file;
}

/**
 * Retourne le CSS final = base.css + variables du thème.
 * C'est le contenu complet à écrire dans style.css.
 */
export function getThemeCss(name = 'default') {
  const runtimeDir = getRuntimeDir();
  const base  = fs.readFileSync(path.join(runtimeDir, 'base.css'), 'utf-8');
  const theme = fs.readFileSync(getThemePath(name), 'utf-8');
  // Le thème est placé EN PREMIER pour que ses variables soient définies
  // avant que base.css les utilise (ordre de lecture CSS = de haut en bas)
  return `/* theme: ${name} */\n${theme}\n\n/* base styles */\n${base}`;
}
