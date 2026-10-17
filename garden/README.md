
# Garden Manager

Application Web en HTML/CSS/JS utilisant un stockage Json afin de créer une carte 
afin de gérer un jardin via des zones, avec descriptions et moodboard.

## Le projet d'éco-lieu

`mon-jardin.json` contient le plan chargé à l'ouverture : un éco-lieu en agroforesterie
(potager collectif, verger–forêt-jardin, clairière des ateliers, hameau de 4 tiny houses,
talus boisé, chemins d'eau depuis un filtre à roseaux). Chaque zone a une fiche qui
explique **pourquoi elle est placée là** (soleil, vent, pente, sol), un moodboard de
photos libres (Wikimedia Commons) et des étiquettes de phasage (`phase-1`, `phase-2`…).

## Utilisation

- **Lire le projet** : bouton **🧭 Visite** (carte + panneau en lecture seule, clic sur une
  zone = sa fiche) ou **▶ Visite guidée** (parcours commenté en 16 étapes, ← → pour avancer).
  Liens directs : `index.html#visite` et `index.html#visite-guidee`.
- **Filtrer** : catégories, étiquettes et recherche dans le panneau ; cocher
  « Appliquer à la carte » pour n'afficher que la sélection sur la carte.
- **Double-clic sur une tuile** du panneau : ouvre la fiche de la zone.
- **Dessiner / modifier** : outils Polygone, Cercle, Ligne, Courbe ; clic droit sur une zone
  pour le menu. `❓ Aide` liste les raccourcis.
- **Rapport PDF** : couverture avec plan aérien numéroté, légende, parcours de visite
  illustré et fiches complètes avec photos. Il reprend les zones affichées sur la carte.
- **Sauvegarder** : télécharge un `.json` ; **Importer** recharge un fichier.

La page doit être servie par un serveur web (elle charge `mon-jardin.json`),
par exemple : `python -m http.server` dans ce dossier, puis http://localhost:8000.
