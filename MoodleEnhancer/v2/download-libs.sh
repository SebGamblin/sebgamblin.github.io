#!/bin/bash
# Télécharge toutes les dépendances du moteur de cours en local
# Usage : bash download-libs.sh
# Crée un dossier ./libs/ avec tout le nécessaire

set -e
LIBS="./libs"
mkdir -p "$LIBS"

echo "📦 Téléchargement des bibliothèques..."

# ── marked (markdown → HTML) ──────────────────────────────────────────────────
curl -sL "https://cdn.jsdelivr.net/npm/marked/marked.min.js" -o "$LIBS/marked.min.js"
echo "  ✓ marked"

# ── highlight.js (coloration syntaxique) ─────────────────────────────────────
curl -sL "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/highlight.min.js" -o "$LIBS/highlight.min.js"
curl -sL "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/github.min.css" -o "$LIBS/highlight-github.min.css"
echo "  ✓ highlight.js"

# ── Reveal.js ────────────────────────────────────────────────────────────────
curl -sL "https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.js" -o "$LIBS/reveal.min.js"
curl -sL "https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.css" -o "$LIBS/reveal.min.css"
echo "  ✓ reveal.js"

# ── KaTeX (rendu LaTeX) ───────────────────────────────────────────────────────
KATEX="0.16.9"
curl -sL "https://cdn.jsdelivr.net/npm/katex@$KATEX/dist/katex.min.js" -o "$LIBS/katex.min.js"
curl -sL "https://cdn.jsdelivr.net/npm/katex@$KATEX/dist/contrib/auto-render.min.js" -o "$LIBS/katex-auto-render.min.js"
curl -sL "https://cdn.jsdelivr.net/npm/katex@$KATEX/dist/katex.min.css" -o "$LIBS/katex.min.css"
# Fonts KaTeX (nécessaires pour le rendu)
mkdir -p "$LIBS/fonts"
for font in KaTeX_AMS-Regular KaTeX_Main-Regular KaTeX_Main-Bold KaTeX_Math-Italic KaTeX_Size1-Regular KaTeX_Size2-Regular KaTeX_Size3-Regular KaTeX_Size4-Regular KaTeX_Caligraphic-Regular KaTeX_Fraktur-Regular KaTeX_SansSerif-Regular KaTeX_Script-Regular KaTeX_Typewriter-Regular; do
  curl -sL "https://cdn.jsdelivr.net/npm/katex@$KATEX/dist/fonts/${font}.woff2" -o "$LIBS/fonts/${font}.woff2"
done
echo "  ✓ katex + fonts"

# ── Mermaid (diagrammes) ──────────────────────────────────────────────────────
curl -sL "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" -o "$LIBS/mermaid.min.js"
echo "  ✓ mermaid"

# ── Google Fonts (DM Sans, DM Mono, DM Serif Display) ────────────────────────
# On génère un CSS qui pointe vers les fichiers woff2 locaux
mkdir -p "$LIBS/fonts"
# DM Sans
curl -sL "https://fonts.gstatic.com/s/dmsans/v15/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2" -o "$LIBS/fonts/DM-Sans-Regular.woff2"
curl -sL "https://fonts.gstatic.com/s/dmsans/v15/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu6-K4.woff2" -o "$LIBS/fonts/DM-Sans-Medium.woff2"
curl -sL "https://fonts.gstatic.com/s/dmsans/v15/rP2Yp2ywxg089UriI5-g4vlH9VoD8CmcqbvY-K4.woff2" -o "$LIBS/fonts/DM-Sans-SemiBold.woff2"
# DM Mono
curl -sL "https://fonts.gstatic.com/s/dmmono/v14/aFTU7PB1QTsUX8KYvrumxLnvnZo.woff2" -o "$LIBS/fonts/DM-Mono-Regular.woff2"
curl -sL "https://fonts.gstatic.com/s/dmmono/v14/aFTR7PB1QTsUX8KYth-orYataIf4VllXuA.woff2" -o "$LIBS/fonts/DM-Mono-Medium.woff2"
# DM Serif Display
curl -sL "https://fonts.gstatic.com/s/dmserifdisplay/v15/-nFnOHM81r4j6k0gjALR8uVvIzP_8vD7.woff2" -o "$LIBS/fonts/DM-Serif-Display-Regular.woff2"
curl -sL "https://fonts.gstatic.com/s/dmserifdisplay/v15/-nFiOHM81r4j6k0gjALR8uVvIzPGDiGD9Q.woff2" -o "$LIBS/fonts/DM-Serif-Display-Italic.woff2"
echo "  ✓ polices DM"

echo ""
echo "✅ Toutes les libs sont dans $LIBS/"
echo "   Structure attendue par index.html :"
echo "   cours/"
echo "   ├── index.html"
echo "   ├── moteur.js"
echo "   ├── style.css"
echo "   └── libs/"
echo "       ├── marked.min.js"
echo "       ├── highlight.min.js, highlight-github.min.css"
echo "       ├── reveal.min.js, reveal.min.css"
echo "       ├── katex.min.js, katex-auto-render.min.js, katex.min.css"
echo "       ├── mermaid.min.js"
echo "       └── fonts/ (woff2)"
