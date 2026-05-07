'use strict';

if (window.__moodleDeployerLoaded) {
  console.log('[Deployer] Déjà chargé');
} else {
  window.__moodleDeployerLoaded = true;
  initDeployer();
}

function initDeployer() {

  function log(msg)  { console.log('[Deployer]', msg); }
  function wait(ms)  { return new Promise(r => setTimeout(r, ms)); }

  function progress(step, state) {
    browser.runtime.sendMessage({ type: 'deploy-progress', step, state }).catch(()=>{});
  }
  function status(level, text) {
    browser.runtime.sendMessage({ type: 'deploy-status', level, text }).catch(()=>{});
  }

  function waitFor(selector, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + selector)); }, timeout);
    });
  }

  function realClick(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
  }

  // ── Détecte si on est sur le formulaire d'ajout de ressource Fichier ───────
  function isOnFileForm() {
    return !!(
      document.querySelector('#id_name') &&
      document.querySelector('input[name="files"]#id_files') &&
      document.querySelector('.filemanager')
    );
  }

  // ── Surveille l'apparition d'un .zip dans le file manager ─────────────────
  function watchForZipUpload() {
    if (!isOnFileForm()) return;

    log('Sur le formulaire Fichier — surveillance du file manager activée');
    status('info', '📂 En attente de votre upload… Glissez votre .zip dans le gestionnaire de fichiers.');
    progress(2, 'active');

    // Mémoriser les fichiers déjà présents au démarrage — ne pas les traiter
    const existingFiles = new Set(
      [...document.querySelectorAll('.fp-file')].map(el =>
        el.getAttribute('data-filename') || el.title ||
        el.querySelector('.fp-filename')?.textContent || ''
      )
    );
    log('Fichiers déjà présents : ' + [...existingFiles].join(', '));

    let alreadyTriggered = false;

    const obs = new MutationObserver(async () => {
      if (alreadyTriggered) return;

      const zipEntry = [...document.querySelectorAll('.fp-file')].find(el => {
        const name = el.getAttribute('data-filename') || el.title ||
                     el.querySelector('.fp-filename')?.textContent || '';
        // Ignorer les fichiers déjà présents avant le démarrage de la surveillance
        if (existingFiles.has(name)) return false;
        return name.toLowerCase().endsWith('.zip');
      });

      if (!zipEntry) return;
      alreadyTriggered = true;
      obs.disconnect();

      // Extraire le nom du zip pour pré-remplir le champ Nom
      const zipName = (
        zipEntry.getAttribute('data-filename') ||
        zipEntry.title ||
        zipEntry.querySelector('.fp-filename')?.textContent || ''
      ).replace(/\.zip$/i, '').trim();

      log('Zip détecté : ' + zipName);
      progress(2, 'done');
      await finishForm(zipName);
    });

    obs.observe(document.querySelector('.filemanager'), { childList: true, subtree: true });
  }

  // ── Finit le formulaire automatiquement ───────────────────────────────────
  async function finishForm(zipName) {
    try {

      // ── Étape 3 : Décompresser ─────────────────────────────────────────────
      progress(3, 'active');
      status('running', '⏳ Décompression du zip…');
      await wait(500);

      const zipEntry = [...document.querySelectorAll('.fp-file')].find(el => {
        const name = el.getAttribute('data-filename') || el.title ||
                     el.querySelector('.fp-filename')?.textContent || '';
        return name.toLowerCase().endsWith('.zip');
      });
      if (!zipEntry) throw new Error('Zip introuvable dans le gestionnaire');

      // Cliquer sur le bouton ▶ menu contextuel (.fp-contextmenu)
      const ctxBtnZip = zipEntry.querySelector('.fp-contextmenu');
      if (!ctxBtnZip) throw new Error('Bouton ▶ introuvable sur le zip');
      realClick(ctxBtnZip);
      log('Clic ▶ contextmenu zip');

      const unzipBtn = await waitFor('.fp-file-unzip', 6000);
      realClick(unzipBtn);
      log('Clic Décompacter');

      // Attendre l'apparition d'index.html
      let indexFound = false;
      for (let i = 0; i < 25; i++) {
        indexFound = [...document.querySelectorAll('.fp-file')].some(el => {
          const name = el.getAttribute('data-filename') || el.title ||
                       el.querySelector('.fp-filename')?.textContent || '';
          return name.includes('index.html');
        });
        if (indexFound) break;
        await wait(600);
      }
      if (!indexFound) throw new Error('index.html introuvable après décompression');
      progress(3, 'done');
      log('index.html trouvé');

      // ── Étape 4 : Définir index.html comme fichier principal ──────────────
      progress(4, 'active');
      status('running', '⏳ Définition du fichier principal…');
      await wait(400);

      const indexEntry = [...document.querySelectorAll('.fp-file')].find(el => {
        const name = el.getAttribute('data-filename') || el.title ||
                     el.querySelector('.fp-filename')?.textContent || '';
        return name.includes('index.html');
      });
      if (!indexEntry) throw new Error('index.html introuvable');

      // Cliquer sur le bouton ▶ menu contextuel de index.html
      const ctxBtnIdx = indexEntry.querySelector('.fp-contextmenu');
      if (!ctxBtnIdx) throw new Error('Bouton ▶ introuvable sur index.html');
      realClick(ctxBtnIdx);
      log('Clic ▶ contextmenu index.html');

      const setMainBtn = await waitFor('.fp-file-setmain', 5000);
      realClick(setMainBtn);
      log('Clic Spécifier comme fichier principal');
      await wait(500);
      progress(4, 'done');

      // ── Étape 5 : Remplir le nom du cours ─────────────────────────────────
      progress(5, 'active');
      status('running', '⏳ Remplissage du nom…');

      const nameInput = document.querySelector('#id_name');
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = zipName;
        nameInput.dispatchEvent(new Event('input',  { bubbles: true }));
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
        log('Nom rempli : ' + zipName);
      }

      // ── Étape 6 : Affichage "Dans une fenêtre surgissante" ─────────────────
      const displaySelect = document.querySelector('select[name="display"]#id_display');
      if (displaySelect) {
        displaySelect.value = '5'; // "Ouvrir"
        displaySelect.dispatchEvent(new Event('change', { bubbles: true }));
        log('Display → 5 (Ouvrir)');
      }
      progress(5, 'done');

      // ── Étape 6 : Enregistrer ─────────────────────────────────────────────
      progress(6, 'active');
      status('running', '⏳ Enregistrement…');

      const saveBtn = document.querySelector('#id_submitbutton2, [name="submitbutton2"]');
      if (!saveBtn) throw new Error('Bouton "Enregistrer et revenir au cours" introuvable');

      realClick(saveBtn);
      log('Clic Enregistrer');

      await waitFor('.course-content, #page-course-view-topics', 15000);
      progress(6, 'done');
      status('success', '✅ Cours déployé avec succès !');
      log('DONE');

    } catch(e) {
      console.error('[Deployer]', e);
      status('error', '❌ ' + e.message + '<br><small>Console F12 pour détails</small>');
    }
  }

  // ── Point d'entrée : démarrer la surveillance dès que la page est prête ───
  if (isOnFileForm()) {
    watchForZipUpload();
  } else {
    // Surveiller une éventuelle navigation vers le formulaire (SPA Moodle)
    const pageObs = new MutationObserver(() => {
      if (isOnFileForm()) {
        pageObs.disconnect();
        watchForZipUpload();
      }
    });
    pageObs.observe(document.body, { childList: true, subtree: true });
  }

  // ── Listener pour message depuis popup (optionnel, pour reset) ────────────
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ping') {
      browser.runtime.sendMessage({ type: 'deploy-status', level: 'info',
        text: isOnFileForm()
          ? '📂 Formulaire détecté — glissez votre .zip'
          : '⚠ Naviguez vers Ajouter Fichier dans Moodle' }).catch(()=>{});
    }
  });

}
