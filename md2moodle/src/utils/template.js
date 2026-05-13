/**
 * src/utils/template.js
 *
 * Génère les pages HTML autonomes (index.html d'un cours packagé).
 * Le rendu markdown est assuré côté client par moteur.js.
 */

/**
 * Génère une page HTML cours autonome.
 *
 * @param {object} opts
 *   title      — titre de la page
 *   content    — contenu Markdown (inséré dans #cours-md)
 *   navBlock   — bloc <script id="moteur-nav">…</script> (optionnel)
 *   theme      — nom du thème (pour la balise link)
 *   logoSrc    — chemin vers le logo (optionnel)
 *   base       — préfixe pour les assets (ex: './' ou '')
 */
export function renderPage({ title, content, navBlock = '', base = './' }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${base}style.css">
</head>
<body>

<div id="cours-md" style="display:none">
${content}
</div>

${navBlock}

<script src="${base}moteur.js"></script>
</body>
</html>`;
}

/**
 * Génère le bloc JSON de navigation (script#moteur-nav).
 *
 * @param {Array} chapters — voir parseSummary()
 */
export function renderNavBlock(chapters) {
  if (!chapters || chapters.length === 0) return '';
  return `<script id="moteur-nav" type="application/json">
${JSON.stringify({ chapters }, null, 2)}
</script>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}