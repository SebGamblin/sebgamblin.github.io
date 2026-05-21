/**
 * src/builders/init.js — Initialisation de projets md2moodle
 *
 * md2moodle --init html                   → cours seul
 * md2moodle --init html --summary         → cours multi-pages avec sommaire
 * md2moodle --init exam                   → examen seul
 */

import fs   from 'fs';
import path from 'path';
import { log } from '../utils/log.js';

// ── Templates ──────────────────────────────────────────────────────────────

const TEMPLATES = {

  // ── Cours simple ──────────────────────────────────────────────────────────
  'cours.md': `---
title: "Titre du cours"
subtitle: "Sous-titre ou promotion"
author: "Prénom Nom"
---

# Titre du cours

Bienvenue dans ce cours. Modifiez ce fichier pour commencer.

---

## 1. Introduction

Paragraphe d'introduction. Le texte courant supporte le **gras**, l'*italique*,
le \`code inline\`, et les [liens](https://example.com).

> Citation ou remarque importante.

---

## 2. Concepts clés

### 2.1 Premier concept

Explication du premier concept.

\`\`\`python
def exemple():
    """Docstring."""
    return "Hello, monde !"

print(exemple())
\`\`\`

### 2.2 Formules mathématiques

Formule inline : $E = mc^2$

Formule en bloc :

$$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$$

---

## 3. Tableau récapitulatif

| Concept | Description | Exemple |
|---------|-------------|---------|
| Ligne 1 | Description | \`code\` |
| Ligne 2 | Description | \`code\` |

---

## 4. Callout

> [!info] Information
> Ceci est un callout de type info.

> [!warning] Attention
> Ceci est un callout d'avertissement.

---

## 5. Diagramme Mermaid

\`\`\`mermaid
flowchart TD
    A[Début] --> B{Condition}
    B -->|Oui| C[Résultat]
    B -->|Non| D[Autre]
    C --> E[Fin]
    D --> E
\`\`\`
`,

  // ── Sommaire ──────────────────────────────────────────────────────────────
  'summary.md': `# Titre du cours complet

## Introduction
- [Accueil](index.html)

## Partie 1
- [Chapitre 1](chapitre-1.md)
- [Chapitre 2](chapitre-2.md)

## Partie 2
- [Chapitre 3](chapitre-3.md)
`,

  // ── Page secondaire ───────────────────────────────────────────────────────
  'chapitre-1.md': `---
title: "Chapitre 1"
---

# Chapitre 1

Contenu du chapitre 1.
`,

  'chapitre-2.md': `---
title: "Chapitre 2"
---

# Chapitre 2

Contenu du chapitre 2.
`,

  'chapitre-3.md': `---
title: "Chapitre 3"
---

# Chapitre 3

Contenu du chapitre 3.
`,

  // ── Examen ────────────────────────────────────────────────────────────────
  'examen.md': `---
title: "Intitulé de l'examen"
subtitle: "Promotion — Semestre X — Année"
date: "JJ mois AAAA"
duree: "1h30"
documents: "Aucun document autorisé"
etablissement: "Établissement"
---

## Partie 1 — QCM *(4 points)*

### Question 1.1 *(1 pt)*

Texte de la question ?

- [ ] Réponse A
- [x] Réponse B  ← bonne réponse
- [ ] Réponse C
- [ ] Réponse D
{.horizontal}

### Question 1.2 *(1 pt)*

Autre question ?

- [ ] Réponse A
- [ ] Réponse B
- [x] Réponse C  ← bonne réponse
- [ ] Réponse D
{.horizontal}

### Question 1.3 *(2 pts)*

Question avec formule : quelle est la valeur de $x$ si $2x + 3 = 7$ ?

- [ ] $x = 1$
- [x] $x = 2$  ← bonne réponse
- [ ] $x = 3$
- [ ] $x = 4$
{.horizontal}

---

## Partie 2 — Questions courtes *(6 points)*

### Question 2.1 *(2 pts)*

Expliquer brièvement le concept de récursivité.

::: reponse 5
Une fonction récursive est une fonction qui s'appelle elle-même.
Elle doit avoir un cas de base pour s'arrêter.
Exemple : fibonacci, factorielle.
:::

### Question 2.2 *(4 pts)*

Écrire une fonction qui calcule la somme des éléments d'une liste.

::: reponse 12
def somme(lst):
    if not lst:
        return 0
    return lst[0] + somme(lst[1:])

# Ou de manière itérative :
def somme(lst):
    return sum(lst)
:::

---

## Partie 3 — Question ouverte *(5 points)*

### Question 3.1 *(5 pts)*

Question longue nécessitant une réponse développée.

::: reponse 20
Réponse attendue détaillée.
Critères de notation :
- Point 1 : 2 pts
- Point 2 : 2 pts
- Clarté : 1 pt
:::
`,
};

// ── Point d'entrée ────────────────────────────────────────────────────────

export async function init(ctx) {
  const type    = ctx.initType;           // 'html' | 'exam'
  const withSum = ctx.summary !== false && ctx.summary !== undefined
    ? true
    : ctx.withSummary || false;
  const outDir  = ctx.output ? path.resolve(ctx.cwd, ctx.output) : ctx.cwd;

  if (!['html', 'exam'].includes(type)) {
    log.err(`Type inconnu : "${type}". Utilisez "html" ou "exam"`);
    process.exit(1);
  }

  log.step(`🗂️   Init projet : ${type}${withSum ? ' + summary' : ''}`);

  const created = [];

  if (type === 'exam') {
    write(outDir, 'examen.md', TEMPLATES['examen.md'], created);

  } else if (type === 'html' && !withSum) {
    write(outDir, 'cours.md', TEMPLATES['cours.md'], created);

  } else if (type === 'html' && withSum) {
    // Structure multi-pages
    write(outDir, 'index.md',      TEMPLATES['cours.md'].replace('Titre du cours', 'Accueil'), created);
    write(outDir, 'summary.md',    TEMPLATES['summary.md'], created);
    write(outDir, 'chapitre-1.md', TEMPLATES['chapitre-1.md'], created);
    write(outDir, 'chapitre-2.md', TEMPLATES['chapitre-2.md'], created);
    write(outDir, 'chapitre-3.md', TEMPLATES['chapitre-3.md'], created);
  }

  // Afficher le résumé et les prochaines étapes
  console.log('');
  log.done(`${created.length} fichier(s) créé(s) dans : ${outDir}`);
  created.forEach(f => log.ok(`  ${path.relative(ctx.cwd, f)}`));
  console.log('');
  printNextSteps(type, withSum, outDir, ctx.cwd);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function write(dir, filename, content, created) {
  const dest = path.join(dir, filename);
  if (fs.existsSync(dest)) {
    log.warn(`  Ignoré (existe déjà) : ${filename}`);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dest, content, 'utf-8');
  created.push(dest);
}

function printNextSteps(type, withSum, outDir, cwd) {
  const rel = (f) => path.relative(cwd, path.join(outDir, f));

  if (type === 'exam') {
    console.log('Prochaines étapes :\n');
    console.log(`  1. Éditez  ${rel('examen.md')}`);
    console.log('     • Mettez [x] sur les bonnes réponses QCM');
    console.log('     • Remplissez les ::: reponse ::: avec le corrigé attendu\n');
    console.log('  2. Générez la copie étudiant :');
    console.log(`     md2moodle --type examen ${rel('examen.md')}\n`);
    console.log('  3. Générez le corrigé enseignant :');
    console.log(`     md2moodle --type examen ${rel('examen.md')} --with-answers\n`);
    console.log('  4. Corrigez des copies scannées :');
    console.log(`     md2moodle --type corriger copies/ --corrige ${rel('examen.md')} --output rapport/`);

  } else if (!withSum) {
    console.log('Prochaines étapes :\n');
    console.log(`  1. Éditez  ${rel('cours.md')}\n`);
    console.log('  2. Prévisualisez en live :');
    console.log(`     md2moodle --type serve ${rel('cours.md')}\n`);
    console.log('  3. Exportez pour Moodle :');
    console.log(`     md2moodle --type html ${rel('cours.md')}\n`);
    console.log('  4. Exportez en PDF :');
    console.log(`     md2moodle --type pdf ${rel('cours.md')}`);

  } else {
    console.log('Structure créée :\n');
    console.log(`  summary.md      ← définit la navigation`);
    console.log(`  index.md        ← page d'accueil`);
    console.log(`  chapitre-1.md   ← pages de contenu`);
    console.log(`  chapitre-2.md`);
    console.log(`  chapitre-3.md\n`);
    console.log('Prochaines étapes :\n');
    console.log(`  1. Éditez summary.md pour définir votre plan`);
    console.log(`  2. Éditez/ajoutez les fichiers .md de contenu\n`);
    console.log('  3. Prévisualisez en live :');
    console.log(`     md2moodle --type serve ${rel('index.md')} --summary ${rel('summary.md')}\n`);
    console.log('  4. Exportez pour Moodle :');
    console.log(`     md2moodle --type html ${rel('index.md')} --summary ${rel('summary.md')}`);
  }
  console.log('');
}
