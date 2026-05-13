# runtime/libs/

Ce répertoire contient les librairies JavaScript et CSS embarquées.
Elles sont copiées telles quelles dans les archives générées.

## Librairies nécessaires

- `marked.min.js` — Rendu Markdown
- `highlight.min.js` + `highlight-github.min.css` — Coloration syntaxique
- `katex.min.js` + `katex.min.css` + `katex-auto-render.min.js` — Formules LaTeX
- `mermaid.min.js` — Diagrammes
- `reveal.min.js` + `reveal.min.css` — Présentations slides
- `fonts/` — Polices DM Sans, DM Mono, DM Serif Display + KaTeX

## Installation des librairies

Exécuter depuis le répertoire racine du projet :

```bash
node scripts/fetch-libs.js
```

Ou copier manuellement les librairies depuis votre projet existant :

```bash
cp -r /chemin/vers/ancien-projet/libs/* runtime/libs/
```
