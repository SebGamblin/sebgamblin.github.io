// Fonction pour charger une section avec un CSS spécifique dans le Shadow DOM
async function loadSection(pageUrl, cssUrl, id) {
	// Charger le contenu de la page
	fetch(pageUrl)
		.then(response => response.text())
		.then(data => {
			// Créer un conteneur pour la section
			const sectionContainer = document.createElement('div');
			
			// Créer un Shadow DOM pour l'encapsulation du style
			const shadowRoot = sectionContainer.attachShadow({mode: 'open'});

			// Créer un élément <style> pour ajouter le CSS
			const style = document.createElement('style');
			
			// Charger dynamiquement le CSS
			fetch(cssUrl)
				.then(cssResponse => cssResponse.text())
				.then(cssText => {
					// Ajouter le CSS dans le Shadow DOM
					style.textContent = cssText;
					shadowRoot.appendChild(style);

					// Ajouter le contenu de la page dans le Shadow DOM
					const section = document.createElement('section');
					section.innerHTML = data;
					shadowRoot.appendChild(section);

					// Ajouter la section au conteneur global
					document.getElementById(id).appendChild(sectionContainer);
				})
				.catch(err => console.error('Erreur de chargement du CSS:', err));
		})
		.catch(err => console.error('Erreur de chargement de la page:', err));
}

async function loadSectionSansCSS(pageUrl, id) {
    fetch(pageUrl)
        .then(response => response.text())
        .then(data => {
            // Ajouter directement le contenu dans le DOM
            document.getElementById(id).innerHTML = data;
        })
        .catch(err => console.error('Erreur de chargement de la page:', err));
}

async function loadFileIntoSection(id, fileUrl) {
	try {
		// Charger le contenu du fichier via fetch
		const response = await fetch(fileUrl);

		// Vérifier si la réponse est correcte
		if (!response.ok) {
			throw new Error(`Erreur de chargement : ${response.statusText}`);
		}

		// Lire le contenu du fichier comme texte
		const fileContent = await response.text();

		// Créer un élément <section> avec l'ID spécifié
		const section = document.getElementById(id);

		// Ajouter le contenu du fichier à la section
		section.textContent = fileContent;

		// Ajouter la section à l'élément body ou à un autre conteneur spécifique
		//document.body.appendChild(section);  // Vous pouvez remplacer body par un autre conteneur
	} catch (error) {
		console.error('Erreur de chargement du fichier :', error);
	}
}

// Charger les sections dans des emplacements spécifiques
//async function loadAllSections() {
	
//    await loadSection('page1.html', 'css2.css', 'section2-container');
//    await loadSection('page1.html', 'css3.css', 'section3-container');
//}

// Appeler la fonction pour charger toutes les sections
//loadAllSections();
