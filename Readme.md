# Site personnel de Sébastien Gamblin

Site statique de présentation (recherche, enseignements, CV, projets), publié avec GitHub Pages :
**https://sebgamblin.github.io/**

Enseignant-chercheur en informatique à l'[ISEN Yncréa Ouest](https://www.isen.fr/) (Caen), spécialisé en planification
multi-agent, flottes de drones et logique épistémique.

## Contenu du dépôt

| Fichier ou dossier | Rôle |
|---|---|
| `index.html` | La page unique du site (à propos, recherche, publications, enseignements, CV, projets) |
| `assets/css/main.css` | Feuille de style du template iPortfolio, réduite aux sections utilisées |
| `assets/css/extra.css` | Compléments : tuiles de liens et de cours, frise du parcours, publications, accessibilité |
| `assets/js/main.js` | Menu latéral, défilement, animations d'apparition, texte dactylographié |
| `assets/vendor/` | Bootstrap, Bootstrap Icons, AOS et Typed.js (uniquement les fichiers utilisés) |
| `assets/img/`, `assets/pdf/` | Images, logos et PDF des articles |
| `robots.txt`, `sitemap.xml` | Référencement |
| `_config.yml` | Configuration GitHub Pages |

Aucune étape de build : les fichiers sont servis tels quels.

## Voir le site en local

```bash
python -m http.server
```

puis http://localhost:8000.

## Projets présentés

Les applications web statiques ont leur propre dépôt et leur propre site, servis sous la même adresse :

- **Garden**, carnet de projet de jardin : [dépôt](https://github.com/SebGamblin/garden) · [application](https://sebgamblin.github.io/garden/)
- **Scrabble Frame**, cartes de prénoms à imprimer : [dépôt](https://github.com/SebGamblin/frame) · [application](https://sebgamblin.github.io/frame/)

## Mettre à jour le contenu

- **Cours** : copier un bloc `course-tile` dans la section « Enseignements » ; un modèle est en commentaire dans `index.html`.
  La pastille de niveau est facultative : `<span class="course-level" data-level="M1">M1</span>`.
- **Frise du parcours** : les barres de la section « Curriculum Vitae » se positionnent avec `--from`, `--to` (colonnes
  d'années) et `--row` (ligne).
- **Publications** : une entrée `pub-item` par article, avec liens vers la conférence, le PDF et DBLP.

## Crédits

Template [iPortfolio](https://bootstrapmade.com/iportfolio-bootstrap-portfolio-websites-template/) de
[BootstrapMade](https://bootstrapmade.com/), sous [licence BootstrapMade](https://bootstrapmade.com/license/)
(mention de l'auteur à conserver). Bibliothèques : Bootstrap, Bootstrap Icons, AOS, Typed.js.
