

# Création d'un cours Markdown :

- Utilisation de v2
  - Création d'un fichier XXX.html dans 'course', avec son dossier 'assets_XXX' si besoin
  - Voir : 'index.html' pour voir un exemple (changer les liens relatifs en bas avec "../")
  - Visualisation directe en ouvrir votre HTML


# Création d'une archive du cours 

- `python moodle-packaging.py course/XXX.html`


# Déploiement 

- aller sur la page moodle de votre cours
- "Nouvelle activité"
- "Fichier"
- Saisir "Nom"
- Drag and drop XXX.zip dans le cadre
- Cliquer sur l'archive puis "Décompresser"
- Cliquer sur index.html puis "Indiquer comme fichier principal"
- Apparence > Affichage > Ouvrir
- Enregistrer et afficher 

## Module 'moodle-deployer'

- dans firefox : `about:debugging#/runtime/this-firefox`
- Charger un module complémentaire temporaire et rechercher le manifest.json
- Une fois activité, il automatisera le déploiement de fichier, vous n'aurez plus qu'à cliquer sur 
  - "Nouvelle activité"
  - "Fichier"
  - drag and drop l'archive XXX.zip

/!\ Extension à réinstaller à chaque ouverture de Firefox ?

Ajouter le Firefox Developer Edition ?

Ou > Non, il y a une autre option : signer l'extension gratuitement via Mozilla, sans la publier publiquement.
Procédure :

Créer un compte sur addons.mozilla.org
Aller dans "Soumettre un module" → choisir "Sur ce site" mais avec visibilité "Unlisted" (non listée — accessible uniquement par lien direct, pas dans le catalogue public)
Uploader le moodle-deployer.zip
Mozilla signe automatiquement le zip en quelques minutes (pas de révision humaine pour les extensions unlisted)
Télécharger le .xpi signé retourné par Mozilla
Dans Firefox standard → about:addons → glisser-déposer le .xpi → installation permanente

-> Lien de l'xpi:

http://addons.mozilla.org/firefox/downloads/file/4722149/9a42ed6465dc4cf8a0fa-1.2.0.xpi

