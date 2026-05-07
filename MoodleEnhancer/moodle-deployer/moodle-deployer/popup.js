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
  statusEl.innerHTML = html;
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
