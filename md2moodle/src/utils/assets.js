/**
 * src/utils/assets.js
 *
 * Détection et résolution des assets locaux (images, fichiers)
 * référencés dans un contenu Markdown/HTML.
 */

import fs from 'fs';
import path from 'path';
import { URL } from 'url';

const LOCAL_PATTERNS = [
  /(?:src|href)=["']([^"']+)["']/g,
  /url\(["']?([^"')]+)["']?\)/g,
  /!\[.*?\]\(([^)]+)\)/g,  // markdown images
];

/**
 * Retourne true si le chemin est local (pas http/https/data/…).
 */
export function isLocal(p) {
  if (!p || p.startsWith('#') || p.startsWith('?')) return false;
  try {
    new URL(p);
    return false; // URL absolue = externe
  } catch {
    return true;   // pas une URL = local
  }
}

/**
 * Extraire tous les chemins locaux référencés dans un contenu texte.
 */
export function findLocalAssets(content) {
  const found = new Set();
  for (const pattern of LOCAL_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      if (isLocal(m[1])) found.add(m[1]);
    }
  }
  return [...found];
}

/**
 * Résoudre les assets par rapport à un fichier source.
 * Retourne [{ original, absPath, exists }]
 */
export function resolveAssets(content, sourceFile, skipPrefixes = ['libs/', 'moteur', 'style']) {
  const base = path.dirname(sourceFile);
  const assets = [];

  for (const orig of findLocalAssets(content)) {
    if (skipPrefixes.some(p => orig.startsWith(p))) continue;
    const abs = path.resolve(base, orig);
    assets.push({ original: orig, absPath: abs, exists: fs.existsSync(abs) });
  }

  return assets;
}

/**
 * Copier les assets dans un dossier cible et retourner le mapping
 * { original → nouveau chemin relatif }.
 */
export function copyAssets(assets, targetDir, subdir = 'assets') {
  const mapping = {};
  const existing = assets.filter(a => a.exists);
  if (existing.length === 0) return mapping;

  const dest = path.join(targetDir, subdir);
  fs.mkdirSync(dest, { recursive: true });

  for (const asset of existing) {
    const name = path.basename(asset.absPath);
    fs.copyFileSync(asset.absPath, path.join(dest, name));
    mapping[asset.original] = `${subdir}/${name}`;
  }

  return mapping;
}

/**
 * Appliquer un mapping de chemins dans un contenu texte.
 */
export function rewritePaths(content, mapping) {
  for (const [from, to] of Object.entries(mapping)) {
    // Échapper les caractères regex
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(new RegExp(escaped, 'g'), to);
  }
  return content;
}
