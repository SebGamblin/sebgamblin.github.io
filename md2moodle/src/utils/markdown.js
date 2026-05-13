/**
 * src/utils/markdown.js
 *
 * Parsing Markdown avec gray-matter (frontmatter YAML) et extraction
 * de métadonnées (titre, slides, sections).
 *
 * Le rendu réel se fait côté navigateur (marked.js + plugins).
 * Côté Node, on se contente d'extraire la structure.
 */

import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';

/**
 * Lire et parser un fichier Markdown.
 * Retourne { data (frontmatter), content (body), title, slides }.
 *
 * Frontmatter supporté :
 *   title: "Mon cours"
 *   subtitle: "ISEN CBIO1"
 *   author: "Prénom NOM"
 *   date: "2024-09-01"
 *   theme: "dark"
 *   logo: "logo.png"
 *   type: cours | td | examen
 */
export function parseMarkdown(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  const title = data.title || extractFirstH1(content) || path.basename(filePath, '.md');

  return {
    filePath,
    frontmatter: data,
    content,
    title,
    raw,          // contenu brut (frontmatter inclus)
    bodyOnly: content,  // sans frontmatter
  };
}

/**
 * Parser un fichier sommaire Markdown.
 * Format attendu :
 *
 *   # Titre du cours
 *
 *   ## Module 1
 *   - [Introduction](intro.md)
 *   - [Variables](variables.md)
 *
 *   ## Module 2
 *   - [Fonctions](fonctions.md)
 *
 * Retourne un tableau de chapitres : [{ title, children: [{ title, href }] }]
 */
export function parseSummary(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  const chapters = [];
  let currentChapter = null;

  for (const line of lines) {
    const chapterMatch = line.match(/^##\s+(.+)/);
    const linkMatch    = line.match(/^\s*[-*]\s+\[(.+?)\]\((.+?)\)/);
    const h1Match      = line.match(/^#\s+(.+)/);

    if (h1Match) {
      // Titre principal du sommaire — ignoré ici, récupéré via frontmatter
      continue;
    }
    if (chapterMatch) {
      currentChapter = { title: chapterMatch[1].trim(), children: [] };
      chapters.push(currentChapter);
    } else if (linkMatch) {
      const entry = { title: linkMatch[1].trim(), href: linkMatch[2].trim() };
      if (currentChapter) {
        currentChapter.children.push(entry);
      } else {
        // Lien sans chapitre → chapitre implicite
        chapters.push({ title: entry.title, href: entry.href, children: [] });
      }
    }
  }

  return chapters;
}

/**
 * Extraire le premier titre H1 d'un contenu Markdown.
 */
function extractFirstH1(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Résoudre tous les fichiers Markdown référencés dans un sommaire.
 * Retourne les chemins absolus vérifiés.
 */
export function resolvePages(summaryPath, chapters) {
  const base = path.dirname(summaryPath);
  const pages = [];

  for (const chapter of chapters) {
    if (chapter.href) {
      pages.push({ ...chapter, absPath: path.resolve(base, chapter.href) });
    }
    for (const child of chapter.children || []) {
      pages.push({ ...child, absPath: path.resolve(base, child.href) });
    }
  }

  return pages;
}
