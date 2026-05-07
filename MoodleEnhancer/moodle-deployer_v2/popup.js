'use strict';

let moodleTabId = null;

const btnWindow  = document.getElementById('btn-open-window');
const statusEl   = document.getElementById('status');
const stepsEl    = document.getElementById('steps');

// ── Fenêtre séparée ───────────────────────────────────────────────────────
btnWindow.addEventListener('click', () => {
  browser.windows.create({
    url: browser.runtime.getURL('popup.html'),
    type: 'popup', width: 340, height: 480
  });
  window.close();
});
browser.windows.getCurrent().then(win => {
  if (win.type === 'popup') btnWindow.style.display = 'none';
});

// ── Détection onglet Moodle ───────────────────────────────────────────────
async function findMoodleTab() {
  const allTabs = await browser.tabs.query({});
  const moodle = allTabs.find(t =>
    t.url && t.url.includes('isen-ouest.fr/moodle') &&
    !t.url.includes(browser.runtime.getURL(''))
  );
  if (moodle) { moodleTabId = moodle.id; updateIndicator(moodle.title); }
  else updateIndicator(null);
}

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await browser.tabs.get(tabId);
    if (tab.url && tab.url.includes('isen-ouest.fr/moodle')) {
      moodleTabId = tabId;
      updateIndicator(tab.title);
    }
  } catch(e) {}
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('isen-ouest.fr/moodle')) {
    moodleTabId = tabId;
    updateIndicator(tab.title);
    // Réinjecter le content script à chaque navigation Moodle
    try { await browser.tabs.executeScript(tabId, { file: 'content.js' }); } catch(e) {}
  }
});

function updateIndicator(title) {
  const el = document.getElementById('moodle-tab-indicator');
  if (!el) return;
  if (title) { el.textContent = '✓ Onglet Moodle détecté'; el.style.color = '#27ae60'; }
  else        { el.textContent = '⚠ Aucun onglet Moodle trouvé'; el.style.color = '#f39c12'; }
}

findMoodleTab();

// ── Toggle on/off ─────────────────────────────────────────────────────────
const toggleEl  = document.getElementById('toggle-enabled');
const toggleSub = document.getElementById('toggle-sub');

// Lire l'état depuis storage
browser.storage.local.get('deployer_enabled').then(res => {
  const enabled = res.deployer_enabled !== false; // true par défaut
  toggleEl.checked = enabled;
  updateToggleSub(enabled);
});

toggleEl.addEventListener('change', () => {
  const enabled = toggleEl.checked;
  browser.storage.local.set({ deployer_enabled: enabled });
  updateToggleSub(enabled);
  // Notifier le content script de l'onglet Moodle
  if (moodleTabId) {
    browser.tabs.sendMessage(moodleTabId, { type: 'set-enabled', enabled }).catch(()=>{});
  }
});

function updateToggleSub(enabled) {
  toggleSub.textContent = enabled ? 'Actif — surveille le formulaire' : 'Inactif — aucune action';
  toggleSub.style.color = enabled ? '#27ae60' : '#e57373';
}

// ── Réception des mises à jour de progression ─────────────────────────────
browser.runtime.onMessage.addListener(msg => {
  if (msg.type === 'deploy-progress') {
    stepsEl.classList.add('visible');
    updateStep(msg.step, msg.state);
  }
  if (msg.type === 'deploy-status') {
    setStatus(msg.level, msg.text);
  }
});

function setStatus(level, html) {
  statusEl.className = 'status ' + level;
  // Utiliser DOMParser pour éviter l'injection directe via innerHTML
  const doc = new DOMParser().parseFromString(html, 'text/html');
  statusEl.replaceChildren(...doc.body.childNodes);
}

function updateStep(stepNum, state) {
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById('s' + i);
    if (!el) continue;
    if (i < stepNum)        el.className = 'step done';
    else if (i === stepNum) el.className = 'step ' + state;
    else                    el.className = 'step';
  }
}
