# Plugins md2moodle

Le système de plugins permet d'étendre le pipeline de rendu sans modifier le cœur.

## API d'un plugin

Un plugin est un module ES qui exporte un objet :

```js
// plugins/mon-plugin.js
export default {
  name: 'mon-plugin',

  /**
   * Appelé avant la génération HTML.
   * @param {string} markdown  — contenu Markdown brut
   * @param {object} context   — contexte CLI (input, theme, …)
   * @returns {string}          — Markdown transformé
   */
  transformMarkdown(markdown, context) {
    return markdown;
  },

  /**
   * Appelé sur le HTML généré (côté Node, pas navigateur).
   * @param {string} html
   * @param {object} context
   * @returns {string}
   */
  transformHtml(html, context) {
    return html;
  },
};
```

## Enregistrement

Dans votre `md2moodle.config.js` (à la racine du projet cours) :

```js
// md2moodle.config.js
import monPlugin from './plugins/mon-plugin.js';

export default {
  theme: 'default',
  plugins: [monPlugin],
};
```

## Exemples d'usage

- Injecter des métadonnées (date de mise à jour, auteur) dans chaque page
- Transformer des shortcodes custom (`{{exercice}}` → HTML structuré)
- Générer automatiquement un glossaire depuis les termes en gras
- Ajouter des watermarks aux PDFs
