#!/usr/bin/env python3
"""
moodle-packaging.py — Empaqueteur de cours ISEN pour Moodle

Usage :
    python moodle-packaging.py course/matplotlib.html

Produit :
    matplotlib.zip  — archive prête à uploader dans Moodle comme ressource "Fichier"

Structure du zip :
    matplotlib/
    ├── index.html       ← page d'entrée (lit le cours-md et charge moteur.js)
    ├── moteur.js
    ├── style.css
    ├── libs/            ← toutes les dépendances locales
    │   ├── fonts/
    │   └── *.js / *.css
    └── assets/          ← images et ressources référencées dans le cours
        └── *.png / *.jpg / ...

Le script :
  1. Lit le fichier cours HTML source
  2. Copie moteur.js, style.css, libs/ depuis le répertoire parent
  3. Détecte et copie les assets locaux référencés (src="...", href="...")
  4. Réécrit les chemins des assets dans le HTML final
  5. Génère un index.html autonome avec le contenu du cours intégré
  6. Crée le zip
"""

import sys
import os
import re
import shutil
import zipfile
import tempfile
from pathlib import Path
from urllib.parse import urlparse
import json

# ── Couleurs terminal ──────────────────────────────────────────────────────
GREEN  = '\033[92m'
YELLOW = '\033[93m'
RED    = '\033[91m'
BOLD   = '\033[1m'
RESET  = '\033[0m'

def ok(msg):    print(f"  {GREEN}✓{RESET} {msg}")
def warn(msg):  print(f"  {YELLOW}⚠{RESET} {msg}")
def err(msg):   print(f"  {RED}✗{RESET} {msg}")
def info(msg):  print(f"  {BOLD}→{RESET} {msg}")

# ── Helpers ────────────────────────────────────────────────────────────────
def is_local(path: str) -> bool:
    """Retourne True si le chemin est local (pas http/https/data)."""
    if not path:
        return False
    parsed = urlparse(path)
    return parsed.scheme not in ('http', 'https', 'data', 'ftp', 'mailto')

def find_local_assets(html: str) -> list[str]:
    """Extrait tous les chemins locaux référencés dans le HTML."""
    patterns = [
        r'src=["\']([^"\']+)["\']',
        r'href=["\']([^"\']+)["\']',
        r'url\(["\']?([^"\')\s]+)["\']?\)',
    ]
    assets = []
    for pattern in patterns:
        for match in re.finditer(pattern, html):
            path = match.group(1)
            if is_local(path) and not path.startswith('#') and not path.startswith('?'):
                assets.append(path)
    return list(set(assets))

def rewrite_asset_path(html: str, old_path: str, new_path: str) -> str:
    """Remplace toutes les occurrences d'un chemin dans le HTML."""
    # Échapper les caractères spéciaux regex dans le chemin
    escaped = re.escape(old_path)
    return re.sub(escaped, new_path, html)

# ── Lecture du cours source ────────────────────────────────────────────────

def extract_nav_json(html: str) -> dict | None:
    """Extrait le JSON du <script id='moteur-nav'>."""
    match = re.search(
        r'<script[^>]+id=["\']moteur-nav["\'][^>]*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE
    )
    if not match:
        return None
    try:
        return json.loads(match.group(1).strip())
    except Exception:
        warn("moteur-nav : JSON invalide")
        return None

def collect_nav_pages(nav: dict) -> list[str]:
    """Retourne tous les href déclarés dans le nav."""
    pages = []
    for item in nav.get('chapters', []):
        if 'href' in item:
            pages.append(item['href'])
        for child in item.get('children', []):
            if 'href' in child:
                pages.append(child['href'])
    return pages


def detect_html_mode(html: str) -> str:
    """
    Détecte si le cours utilise du HTML encodé (&lt;div&gt;)
    ou du HTML réel (<div>)
    """
    if '<div id="cours-md"' in html or "<div id='cours-md'" in html:
        return "html"
    if '&lt;div id="cours-md"&gt;' in html or "&lt;div id='cours-md'&gt;" in html:
        return "escaped"
    return "unknown"


def extract_cours_md(html: str) -> str | None:
    """Extrait le contenu du <div id='cours-md'> en gérant les div imbriqués."""
    # Trouver le début du div
    print("<div id='cours-md'>" in html)
    
    start_match = re.search(
        r'<div[^>]+id=["\'\u2018\u2019\u201c\u201d]cours-md["\'\u2018\u2019\u201c\u201d][^>]*>',
        html, re.IGNORECASE
    )
    if not start_match:
        return None

    start = start_match.end()
    depth = 1
    i = start

    # Parcourir le HTML en comptant les div ouvrants/fermants
    while i < len(html) and depth > 0:
        open_match  = re.search(r'<div[^>]*>', html[i:], re.IGNORECASE)
        close_match = re.search(r'</div>',     html[i:], re.IGNORECASE)

        if not close_match:
            break  # malformé

        open_pos  = (i + open_match.start())  if open_match  else len(html)
        close_pos = (i + close_match.start()) if close_match else len(html)

        if open_pos < close_pos:
            depth += 1
            i = open_pos + len(open_match.group(0))
        else:
            depth -= 1
            if depth == 0:
                return html[start:close_pos].strip()
            i = close_pos + len('</div>')

    return None

def extract_cours_md(html: str, mode: str) -> str | None:
    
    if mode == "html":
        open_div = r'<div[^>]+id=["\']cours-md["\'][^>]*>'
        close_div = r'</div>'
    elif mode == "escaped":
        open_div = r'&lt;div[^&gt;]+id=["\']cours-md["\'][^&gt;]*&gt;'
        close_div = r'&lt;/div&gt;'
    else:
        return None

    start_match = re.search(open_div, html, re.IGNORECASE)
    if not start_match:
        return None

    start = start_match.end()
    depth = 1
    i = start

    while i < len(html) and depth > 0:
        open_match  = re.search(open_div.replace('id=[^>]+', ''), html[i:], re.IGNORECASE)
        close_match = re.search(close_div, html[i:], re.IGNORECASE)

        if not close_match:
            break

        open_pos  = i + open_match.start()  if open_match else float('inf')
        close_pos = i + close_match.start()

        if open_pos < close_pos:
            depth += 1
            i = open_pos + len(open_match.group(0))
        else:
            depth -= 1
            if depth == 0:
                return html[start:close_pos].strip()
            i = close_pos + len(close_match)

    return None


from html.parser import HTMLParser

class DivExtractor(HTMLParser):
    def __init__(self, target_id):
        super().__init__()
        self.target_id = target_id
        self.depth = 0
        self.capturing = False
        self.result = []

    def handle_starttag(self, tag, attrs):
        if tag == 'div':
            attrs_dict = dict(attrs)
            if not self.capturing and attrs_dict.get('id') == self.target_id:
                self.capturing = True
                self.depth = 1
            elif self.capturing:
                self.depth += 1
                self.result.append(self.get_starttag_text())
                return
        if self.capturing and tag != 'div':
            self.result.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if self.capturing:
            if tag == 'div':
                self.depth -= 1
                if self.depth == 0:
                    self.capturing = False
                    return
            self.result.append(f'</{tag}>')

    def handle_data(self, data):
        if self.capturing:
            self.result.append(data)

    def get_content(self):
        return ''.join(self.result).strip()


def extract_cours_md(html: str) -> str | None:
    extractor = DivExtractor('cours-md')
    extractor.feed(html)
    content = extractor.get_content()
    return content if content else None

def extract_title(cours_md: str) -> str:
    """Extrait le premier # titre du markdown."""
    match = re.search(r'^#\s+(.+)$', cours_md, re.MULTILINE)
    return match.group(1).strip() if match else 'Cours ISEN'

# ── Génération du index.html packagé ──────────────────────────────────────
INDEX_TEMPLATE = '''\
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>

<div id="cours-md" style="display:none">
{cours_md}
</div>

{nav_block}

<script src="moteur.js"></script>
</body>
</html>
'''

# ── Script principal ───────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print(f"\n{BOLD}Usage :{RESET} python moodle-packaging.py <fichier-cours.html>\n")
        print(f"  Exemple : python moodle-packaging.py course/matplotlib.html\n")
        sys.exit(1)

    source_path = Path(sys.argv[1]).resolve()

    if not source_path.exists():
        err(f"Fichier introuvable : {source_path}")
        sys.exit(1)

    course_name = source_path.stem          # ex: "matplotlib"
    source_dir  = source_path.parent        # ex: /path/to/course/
    project_dir = source_path.parent.parent # répertoire racine du projet (contient moteur.js)
    output_zip  = Path.cwd() / f"{course_name}.zip"

    print(f"\n{BOLD}📦 Packaging : {course_name}{RESET}")
    print(f"   Source  : {source_path}")
    print(f"   Sortie  : {output_zip}\n")

    # ── Vérifications préalables ───────────────────────────────────────────
    required = ['moteur.js', 'style.css', 'libs']
    for r in required:
        p = project_dir / r
        if not p.exists():
            err(f"Manquant dans {project_dir} : {r}")
            sys.exit(1)
        ok(f"Trouvé : {r}")

    # ── Lecture du cours source ────────────────────────────────────────────
    html_source = source_path.read_text(encoding='utf-8')
    
    mode = detect_html_mode(html_source)
    info(f"Mode détecté : {mode}")

    
    # Normaliser les guillemets typographiques → droits
    html_source = html_source.replace('\u2018', "'").replace('\u2019', "'")
    html_source = html_source.replace('\u201c', '"').replace('\u201d', '"')
    cours_md = extract_cours_md(html_source)

    if not cours_md:
        err("Impossible de trouver <div id='cours-md'> dans le fichier source.")
        sys.exit(1)

    title = extract_title(cours_md)
    info(f"Titre détecté : {title}")
    
    # ── Détection des pages via moteur-nav ────────────────────────────────
    nav_data  = extract_nav_json(html_source)
    nav_pages = collect_nav_pages(nav_data) if nav_data else []
    
    nav_block_match = re.search(
        r'<script[^>]+id=["\']moteur-nav["\'][^>]*>.*?</script>',
        html_source, re.DOTALL | re.IGNORECASE
    )
    nav_block = nav_block_match.group(0) if nav_block_match else ''

    # Réécrire le href de la page principale → index.html dans le nav   
    nav_block = nav_block.replace(
        f'"{source_path.name}"',
        '"index.html"'
    )
    
    if nav_data:
        info(f"Navigation détectée : {len(nav_pages)} page(s) dans le sommaire")
        for p in nav_pages:
            abs_p = source_dir / p
            if abs_p.exists():
                ok(f"Page trouvée : {p}")
            else:
                warn(f"Page introuvable : {p}")
    else:
        info("Aucune navigation détectée — packaging page unique")

    # ── Détection des assets locaux dans le markdown ───────────────────────
    local_assets = []
    for path in find_local_assets(cours_md):
        # Ignorer libs/ moteur.js style.css (déjà gérés)
        if any(path.startswith(p) for p in ('libs/', 'moteur', 'style')):
            continue
        asset_abs = (source_dir / path).resolve()
        if asset_abs.exists():
            local_assets.append((path, asset_abs))
            ok(f"Asset trouvé : {path}")
        else:
            warn(f"Asset introuvable (ignoré) : {path}")

    # ── Construction dans un dossier temporaire ────────────────────────────
    with tempfile.TemporaryDirectory() as tmp:
        pkg = Path(tmp) / course_name
        pkg.mkdir()

        # Copier moteur.js, style.css et isen.png
        shutil.copy(project_dir / 'moteur.js', pkg / 'moteur.js')
        shutil.copy(project_dir / 'style.css', pkg / 'style.css')
        ok("Copié : moteur.js, style.css")

        isen_logo = project_dir / 'isen.png'
        if isen_logo.exists():
            shutil.copy(isen_logo, pkg / 'isen.png')
            ok("Copié : isen.png")
        else:
            warn("isen.png introuvable dans le répertoire projet (logo absent du package)")

        # Copier libs/
        shutil.copytree(project_dir / 'libs', pkg / 'libs')
        ok("Copié : libs/")

        # Copier les assets et réécrire leurs chemins dans le markdown
        final_md = cours_md
        if local_assets:
            assets_dir = pkg / 'assets'
            assets_dir.mkdir()
            for original_path, abs_path in local_assets:
                dest_name = abs_path.name
                shutil.copy(abs_path, assets_dir / dest_name)
                # Réécrire le chemin dans le markdown : assets/nom_fichier
                new_path = f"assets/{dest_name}"
                final_md = final_md.replace(original_path, new_path)
                ok(f"Asset packagé : {original_path} → {new_path}")

        # Générer index.html
                
        index_html = INDEX_TEMPLATE.format(title=title, cours_md=final_md, nav_block=nav_block)
        (pkg / 'index.html').write_text(index_html, encoding='utf-8')
        ok("Généré : index.html")
        
        # Pages secondaires référencées dans le nav
        for page_href in nav_pages:
            src_page = source_dir / page_href
            dst_page = pkg / page_href

            if not src_page.exists():
                warn(f"Ignorée (introuvable) : {page_href}")
                continue
        
            # Ignorer la page principale, déjà packagée en index.html
            if src_page.resolve() == source_path.resolve():
                ok(f"Ignorée (page principale) : {page_href}")
                continue

            # Lire et traiter comme la page principale
            page_html = src_page.read_text(encoding='utf-8')
            page_md   = extract_cours_md(page_html)

            if not page_md:
                warn(f"Pas de cours-md dans {page_href}, ignorée")
                continue

            page_title = extract_title(page_md)

            # Assets locaux de cette page
            for orig_path in find_local_assets(page_md):
                if any(orig_path.startswith(x) for x in ('libs/', 'moteur', 'style')):
                    continue

                # Résoudre le chemin depuis le dossier de la page secondaire
                abs_asset = (src_page.parent / orig_path).resolve()

                if abs_asset.exists():
                    # Créer assets/ si besoin
                    (pkg / 'assets').mkdir(exist_ok=True)
                    shutil.copy(abs_asset, pkg / 'assets' / abs_asset.name)
                    page_md = page_md.replace(orig_path, f"assets/{abs_asset.name}")
                    ok(f"Asset packagé : {orig_path} → assets/{abs_asset.name}")
                else:
                    warn(f"Asset introuvable : {orig_path}")

            page_html_out = INDEX_TEMPLATE.format(title=page_title, cours_md=page_md, nav_block=nav_block)
            dst_page.write_text(page_html_out, encoding='utf-8')
            ok(f"Généré : {page_href}  ({page_title})")

        # Créer le zip
        with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
            for file in pkg.rglob('*'):
                if file.is_file():
                    # relatif à pkg → fichiers directement à la racine du zip
                    arcname = file.relative_to(pkg)
                    zf.write(file, arcname)

        size_kb = output_zip.stat().st_size // 1024
        ok(f"Archive créée : {output_zip.name} ({size_kb} Ko)")

    # ── Procédure Moodle ───────────────────────────────────────────────────
    print(f"""
{BOLD}✅ Packaging terminé !{RESET}

{BOLD}Procédure Moodle :{RESET}

  1. Dans votre cours Moodle → {BOLD}Activer le mode édition{RESET}
  2. {BOLD}Ajouter une activité/ressource{RESET} → choisir {BOLD}Fichier{RESET}
  3. Glisser-déposer {BOLD}{output_zip.name}{RESET} dans la zone de dépôt
  4. Moodle détecte le zip → cliquer sur le zip dans le gestionnaire
     → choisir {BOLD}Décompresser{RESET}
  5. Cliquer sur {BOLD}index.html{RESET} → {BOLD}Définir comme fichier principal{RESET}
  6. Dans {BOLD}Apparence{RESET} → Affichage : choisir {BOLD}Nouvelle fenêtre{RESET}
     (recommandé pour avoir la toolbar en plein écran)
  7. {BOLD}Enregistrer{RESET}

""")

if __name__ == '__main__':
    main()