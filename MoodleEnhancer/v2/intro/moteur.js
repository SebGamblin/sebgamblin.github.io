/**
 * moteur.js — Moteur de cours ISEN
 * Rendu Markdown → Document ou Slides, entièrement autonome.
 *
 * Compatibilité Moodle : neutralise RequireJS (AMD) pendant l'init
 * pour éviter "Mismatched anonymous define()".
 */

// Sauvegarde de define/require de Moodle avant tout
var __moteurSavedDefine  = window.define;
var __moteurSavedRequire = window.require;
if (typeof window.define === 'function' && window.define.amd) {
  window.define  = undefined;
  window.require = undefined;
}

(function () {
  'use strict';

  var VERSION = '1.2.2';

  // ── Config chemins libs (relatif à moteur.js) ─────────────────────────────
  var BASE = (function () {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src');
      if (src && src.indexOf('moteur.js') !== -1) {
        return src.replace(/moteur\.js.*$/, '');
      }
    }
    return './';
  })();

  var LIBS = BASE + 'libs/';

  // ── État global ───────────────────────────────────────────────────────────
  var md = null;
  var slideMode = false;
  var revealInitialized = false;
  var libsLoaded = false;

  // ── Injection du DOM moteur ───────────────────────────────────────────────
  function injectDOM() {

    var sidebar = document.createElement('nav');
    sidebar.id = 'moteur-sidebar';
    sidebar.style.display = 'none';
    document.body.insertBefore(sidebar, document.body.firstChild);

    var sidebarToggle = document.createElement('button');
    sidebarToggle.id = 'moteur-sidebar-toggle';
    sidebarToggle.title = 'Afficher / masquer le menu';
    sidebarToggle.innerHTML = '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    sidebarToggle.style.display = 'none'; // caché par défaut
    sidebarToggle.onclick = function() { window._moteur.toggleSidebar(); };
    document.body.appendChild(sidebarToggle);

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.id = 'moteur-toolbar';
    toolbar.innerHTML =
      '<button class="moteur-btn" id="moteur-mode-btn" onclick="window._moteur.switchMode()">&#9654;</button>' +
      '<button class="moteur-btn" id="moteur-print-btn" onclick="window._moteur.printDoc()">&#11015;</button>' +
      '<button class="moteur-btn" onclick="window._moteur.toggleFullscreen()">&#9974;</button>' + 
      '<button class="moteur-btn moteur-info-btn" id="moteur-info-btn" onclick="window._moteur.toggleInfo()" title="Informations">ⓘ</button>';;

    // Bandeau d'erreur / attente
    var banner = document.createElement('div');
    banner.id = 'moteur-banner';
    banner.innerHTML = '<span style="opacity:.5">⏳ Chargement…</span>';

    // Conteneur document
    var doc = document.createElement('div');
    doc.id = 'moteur-doc';
    doc.style.display = 'none';

    // Conteneur Reveal
    var reveal = document.createElement('div');
    reveal.className = 'reveal';
    reveal.style.display = 'none';
    var slides = document.createElement('div');
    slides.className = 'slides';
    reveal.appendChild(slides);

    document.body.appendChild(toolbar);
    document.body.appendChild(banner);
    document.body.appendChild(doc);
    document.body.appendChild(reveal);

    // Popup info
    var infoPopup = document.createElement('div');
    infoPopup.id = 'moteur-info-popup';
    infoPopup.style.display = 'none';
    infoPopup.innerHTML =
      '<div class="moteur-info-inner">' +
      '<img src="' + BASE + 'isen.png" alt="ISEN" style="height:48px;margin-bottom:12px"/>' +
      '<p><strong>Créateur :</strong> ISEN Yncréa Ouest</p>' +
      '<p><strong>Version MoodleEnhancer :</strong> ' + VERSION + '</p>' +
      '<p id="moteur-info-date"><strong>Créé le :</strong> <em>chargement…</em></p>' +
      '<button onclick="window._moteur.toggleInfo()">Fermer</button>' +
      '</div>';
    document.body.appendChild(infoPopup);
  }

  // ── Chargement dynamique des libs ─────────────────────────────────────────
  // noAMD=true : masque window.define pendant le chargement pour éviter
  // le conflit "Mismatched anonymous define()" avec RequireJS de Moodle.
  function loadScript(src, cb, noAMD) {
    var savedDefine, savedRequire;
    if (noAMD && typeof window.define === 'function' && window.define.amd) {
      savedDefine  = window.define;
      savedRequire = window.require;
      window.define  = undefined;
      window.require = undefined;
    }
    function restore() {
      if (noAMD && savedDefine) {
        window.define  = savedDefine;
        window.require = savedRequire;
      }
    }
    var s = document.createElement('script');
    s.src = src;
    s.onload  = function () { restore(); cb(); };
    s.onerror = function () { restore(); console.warn('Impossible de charger:', src); cb(); };
    document.head.appendChild(s);
  }

  function loadStyle(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  function loadFonts() {
    // CSS @font-face inline pour les polices locales
    var style = document.createElement('style');
    style.textContent = [
      "@font-face{font-family:'DM Sans';font-weight:400;font-style:normal;src:url('" + LIBS + "fonts/DM-Sans-Regular.woff2') format('woff2')}",
      "@font-face{font-family:'DM Sans';font-weight:500;font-style:normal;src:url('" + LIBS + "fonts/DM-Sans-Medium.woff2') format('woff2')}",
      "@font-face{font-family:'DM Sans';font-weight:600;font-style:normal;src:url('" + LIBS + "fonts/DM-Sans-SemiBold.woff2') format('woff2')}",
      "@font-face{font-family:'DM Mono';font-weight:400;font-style:normal;src:url('" + LIBS + "fonts/DM-Mono-Regular.woff2') format('woff2')}",
      "@font-face{font-family:'DM Mono';font-weight:500;font-style:normal;src:url('" + LIBS + "fonts/DM-Mono-Medium.woff2') format('woff2')}",
      "@font-face{font-family:'DM Serif Display';font-weight:400;font-style:normal;src:url('" + LIBS + "fonts/DM-Serif-Display-Regular.woff2') format('woff2')}",
      "@font-face{font-family:'DM Serif Display';font-weight:400;font-style:italic;src:url('" + LIBS + "fonts/DM-Serif-Display-Italic.woff2') format('woff2')}"
    ].join('\n');
    document.head.appendChild(style);
  }

  function loadAllLibs(cb) {
    if (libsLoaded) { cb(); return; }
    loadStyle(LIBS + 'highlight-github.min.css');
    loadStyle(LIBS + 'reveal.min.css');
    loadStyle(LIBS + 'katex.min.css');
    loadFonts();

    // Chargement séquentiel — noAMD=true sur chaque lib pour éviter
    // le conflit "Mismatched anonymous define()" avec RequireJS de Moodle.
    loadScript(LIBS + 'marked.min.js', function () {
      loadScript(LIBS + 'highlight.min.js', function () {
        loadScript(LIBS + 'katex.min.js', function () {
          loadScript(LIBS + 'katex-auto-render.min.js', function () {
            loadScript(LIBS + 'mermaid.min.js', function () {
              // Reveal en dernier — le plus sensible au conflit AMD
              loadScript(LIBS + 'reveal.min.js', function () {
                libsLoaded = true;
                // Restaurer define/require de Moodle maintenant que tout est chargé
                if (typeof __moteurSavedDefine !== 'undefined') {
                  window.define  = __moteurSavedDefine;
                  window.require = __moteurSavedRequire;
                }
                // Config marked
                if (typeof marked !== 'undefined') {
                  marked.setOptions({
                    highlight: function (code, lang) {
                      if (typeof hljs === 'undefined') return code;
                      return hljs.highlightAuto(code, lang ? [lang] : undefined).value;
                    }
                  });
                }
                // Config mermaid
                if (typeof mermaid !== 'undefined') {
                  mermaid.initialize({
                    startOnLoad: false,
                    theme: 'base',
                    themeVariables: {
                      primaryColor: '#fadbd8',
                      primaryBorderColor: '#c0392b',
                      primaryTextColor: '#1a1a2e'
                    }
                  });
                }
                cb();
              }, true);  // noAMD
            }, true);
          }, true);
        }, true);
      }, true);
    }, true);
  }

  // ── Lecture du markdown depuis la page ────────────────────────────────────
  function readMarkdownFromPage() {
    // 1. Chercher dans la page courante
    var el = document.getElementById('cours-md');
    if (el) {
      var txt = document.createElement('textarea');
      txt.innerHTML = el.innerHTML;
      return txt.value.trim();
    }
    // 2. Chercher dans la page parente (si iframe)
    try {
      el = window.parent.document.getElementById('cours-md');
      if (el) {
        txt = document.createElement('textarea');
        txt.innerHTML = el.innerHTML;
        return txt.value.trim();
      }
    } catch (e) { /* cross-origin, pas d'accès */ }
    return null;
  }

  // ── Transformations DOM ───────────────────────────────────────────────────
  var ICON_COPY = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var ICON_OK   = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';

  function addCopyButtons(root) {
    root.querySelectorAll('pre').forEach(function (pre) {
      if (pre.querySelector('.moteur-copy-btn')) return;
      var btn = document.createElement('button');
      btn.className = 'moteur-copy-btn';
      btn.innerHTML = ICON_COPY + '<span>Copier</span>';
      btn.addEventListener('click', function () {
        var text = (pre.querySelector('code') || pre).innerText;
        var done = function () {
          btn.innerHTML = ICON_OK + '<span>Copié !</span>';
          btn.classList.add('copied');
          setTimeout(function () {
            btn.innerHTML = ICON_COPY + '<span>Copier</span>';
            btn.classList.remove('copied');
          }, 2000);
        };
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else { done(); }
      });
      pre.appendChild(btn);
    });
  }

  function addLogoToDoc(root) {
    if (root.querySelector('.moteur-logo')) return;
    var logo = document.createElement('img');
    logo.src = BASE + 'isen.png';
    logo.className = 'moteur-logo';
    logo.alt = 'ISEN';
    root.insertBefore(logo, root.firstChild);
  }

  function transformMermaid(root) {
    if (typeof mermaid === 'undefined') return;
    root.querySelectorAll('pre code.language-mermaid').forEach(function (el) {
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = el.textContent;
      el.closest('pre').replaceWith(div);
    });
    mermaid.run({ nodes: root.querySelectorAll('.mermaid') });
  }

  function addLangBadges(root) {
    root.querySelectorAll('pre code[class*="language-"]').forEach(function (el) {
      var lang = Array.from(el.classList).find(function (c) { return c.startsWith('language-'); });
      if (lang) lang = lang.replace('language-', '');
      if (lang && lang !== 'mermaid') el.closest('pre').setAttribute('data-lang', lang);
    });
  }

  function renderMath(root) {
    if (typeof renderMathInElement === 'undefined') return;
    renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$',  right: '$',  display: false },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false }
      ],
      throwOnError: false
    });
  }

  function highlightLines(root) {
    root.querySelectorAll('pre code').forEach(function (el) {
      if (!el.innerHTML.includes('[hl]')) return;
      var lines = el.innerHTML.split('\n');
      el.innerHTML = lines.map(function (line) {
        if (line.includes('[hl]')) {
          var clean = line
            .replace(/\s*#\s*\[hl\]/g, '')
            .replace(/\s*\/\/\s*\[hl\]/g, '')
            .replace(/\s*--\s*\[hl\]/g, '');
          return '<span class="moteur-hl-line">' + clean + '</span>';
        }
        return line;
      }).join('\n').replace(/\n(<\/span>)/g, '$1');
    });
  }

  // ── Rendu document ────────────────────────────────────────────────────────
  function renderDoc() {
    if (revealInitialized) {
      try { Reveal.destroy(); } catch (e) {}
      revealInitialized = false;
    }
    document.documentElement.style.overflow = '';
    document.documentElement.style.height = '';
    document.body.style.overflow = '';
    document.body.style.height = '';
    document.body.style.width = '';

    var docEl = document.getElementById('moteur-doc');
    var revealEl = document.querySelector('.reveal');
    docEl.style.display = 'block';
    if (revealEl) revealEl.style.display = 'none';
    if (revealEl) revealEl.querySelector('.slides').innerHTML = '';

    docEl.innerHTML = (typeof marked !== 'undefined')
      ? marked.parse(md || '*Aucun contenu.*')
      : '<p>Erreur : marked.js non chargé.</p>';

    if (typeof hljs !== 'undefined') hljs.highlightAll();
    addLangBadges(docEl);
    highlightLines(docEl);
    transformMermaid(docEl);
    renderMath(docEl);
    addCopyButtons(docEl);
    addLogoToDoc(docEl);

    sendHeight();
  }

  // ── Rendu slides ──────────────────────────────────────────────────────────
  function renderSlides() {
    var docEl = document.getElementById('moteur-doc');
    var revealEl = document.querySelector('.reveal');
    docEl.style.display = 'none';
    revealEl.style.display = 'block';

    var container = revealEl.querySelector('.slides');
    container.innerHTML = '';

    (md || '').split(/^---$/m).forEach(function (s) {
      var section = document.createElement('section');
      section.innerHTML = (typeof marked !== 'undefined') ? marked.parse(s) : s;
      container.appendChild(section);
    });

    var firstSection = container.querySelector('section');
    if (firstSection && !firstSection.querySelector('.moteur-logo')) {
      var slideLogo = document.createElement('img');
      slideLogo.src = BASE + 'isen.png';
      slideLogo.className = 'moteur-logo moteur-logo-slide';
      slideLogo.alt = 'ISEN';
      firstSection.insertBefore(slideLogo, firstSection.firstChild);
    }

    if (typeof hljs !== 'undefined') hljs.highlightAll();
    highlightLines(container);
    transformMermaid(container);
    renderMath(container);
    addCopyButtons(container);

    if (!revealInitialized) {
      Reveal.initialize({
        hash: false,
        slideNumber: true,
        transition: 'slide',
        width: 1100,
        height: 700
      });
      revealInitialized = true;
    } else {
      Reveal.sync();
      Reveal.slide(0);
      toggleFullscreen();
    }
    setTimeout(sendHeight, 400);

    setTimeout(checkSlidesOverflow, 300);
  }

  function checkSlidesOverflow() {
    var slideHeight = 700; // hauteur Reveal configurée
    document.querySelectorAll('.reveal .slides section').forEach(function(section) {
      // Retirer un éventuel badge précédent
      var old = section.querySelector('.moteur-overflow-badge');
      if (old) old.remove();

      if (section.scrollHeight > slideHeight) {
        var badge = document.createElement('div');
        badge.className = 'moteur-overflow-badge';
        badge.title = 'Contenu trop long — ' + section.scrollHeight + 'px pour ' + slideHeight + 'px disponibles';
        badge.textContent = '⚠ overflow';
        section.appendChild(badge);
      }
    });
  }

  function toggleInfo() {
    var popup = document.getElementById('moteur-info-popup');
    if (!popup) return;
    var visible = popup.style.display !== 'none';
    popup.style.display = visible ? 'none' : 'flex';

    // Récupère la date de création via Performance API (première ressource moteur.js)
    if (!visible) {
      try {
        var entries = performance.getEntriesByType('resource');
        var moteurEntry = entries.find(function(e) { return e.name.indexOf('moteur.js') !== -1; });
        var dateEl = document.getElementById('moteur-info-date');
        if (moteurEntry && dateEl) {
          var d = new Date(moteurEntry.fetchStart + performance.timeOrigin);
          // Date de page courante comme proxy
        }
        // Utilise document.lastModified comme date de création
        if (dateEl) {
          var lastMod = document.lastModified;
          dateEl.innerHTML = '<strong>Dernière modification :</strong> ' + lastMod;
        }
      } catch(e) {}
    }
  }

  // ── Hauteur iframe ────────────────────────────────────────────────────────
  function sendHeight() {
    var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    window.parent.postMessage({ type: 'resize-iframe', height: h }, '*');
  }

  // ── Mode switch ───────────────────────────────────────────────────────────
  function switchMode() {
    slideMode = !slideMode;
    var btn = document.getElementById('moteur-mode-btn');
    var printBtn = document.getElementById('moteur-print-btn');
    var infoBtn  = document.getElementById('moteur-info-btn');

    if (slideMode) {
      renderSlides();
      btn.textContent = '📄';
      btn.classList.add('active');
      if (printBtn) printBtn.style.display = 'none';
      if (infoBtn)  infoBtn.style.display  = 'none';
    } else {
      renderDoc();
      btn.textContent = '▶';
      btn.classList.remove('active');
      if (printBtn) printBtn.style.display = '';
      if (infoBtn)  infoBtn.style.display  = '';
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }

  function printDoc() {
    if (slideMode) { switchMode(); }
    setTimeout(function () { window.print(); }, 300);
  }

  function loadNav() {
    var el = document.getElementById('moteur-nav');
    if (!el) return;
    try {
      var nav = JSON.parse(el.textContent);
      if (!nav.chapters || nav.chapters.length === 0) return; // nav vide
      buildNav(nav);
    } catch(e) {
      warn('moteur-nav : JSON invalide');
    }
  }

  function toggleSidebar() {
      var sidebar = document.getElementById('moteur-sidebar');
      var toggle  = document.getElementById('moteur-sidebar-toggle');
      var toolbar = document.getElementById('moteur-toolbar');
      var doc     = document.getElementById('moteur-doc');

      var isHidden = sidebar.classList.toggle('hidden');

      if (isHidden) {
        toggle.style.left = '12px';
        if (toolbar.classList.contains('with-sidebar')) toolbar.style.left = '12px';
        if (doc.classList.contains('with-sidebar'))     doc.style.paddingLeft = '20px';
      } else {
        toggle.style.left = '252px';
        if (toolbar.classList.contains('with-sidebar')) toolbar.style.left = '252px';
        if (doc.classList.contains('with-sidebar'))     doc.style.paddingLeft = '260px';
      }
    }

  function buildNav(nav) {
    var sidebar = document.getElementById('moteur-sidebar');
    if (!sidebar) return;

    var current = window.location.pathname.split('/').pop();

    var html = '<div class="moteur-nav-title">' + (nav.title || '') + '</div><ul>';

    (nav.chapters || []).forEach(function(item) {
      if (item.children) {
        html += '<li class="moteur-nav-group">';
        html += '<span class="moteur-nav-group-label">' + item.label + '</span><ul>';
        item.children.forEach(function(child) {
          var active = child.href === current ? ' class="active"' : '';
          html += '<li><a href="' + child.href + '"' + active + '>' + child.label + '</a></li>';
        });
        html += '</ul></li>';
      } else {
        var active = item.href === current ? ' class="active"' : '';
        html += '<li><a href="' + item.href + '"' + active + '>' + item.label + '</a></li>';
      }
    });

    html += '</ul>';
    sidebar.innerHTML = html;
    sidebar.style.display = 'block';

    // Décaler le contenu principal
    document.getElementById('moteur-doc').classList.add('with-sidebar');
    document.getElementById('moteur-toolbar').classList.add('with-sidebar');

    // À la fin de buildNav()
    var toggle = document.getElementById('moteur-sidebar-toggle');
    if (toggle){
      toggle.style.left = '252px';
      toggle.style.display = 'flex';
    }
  }

  // ── Démarrage ─────────────────────────────────────────────────────────────
  function start(content) {
    md = content;
    hideBanner();
    loadAllLibs(function () {
      if (window.location.search.includes('print-pdf')) {
        document.getElementById('moteur-toolbar').style.display = 'none';
        renderSlides();
      } else {
        renderDoc();
      }
    });
  }

  function showBanner(html) {
    var b = document.getElementById('moteur-banner');
    if (b) { b.style.display = 'block'; b.innerHTML = html; }
  }

  function hideBanner() {
    var b = document.getElementById('moteur-banner');
    if (b) b.style.display = 'none';
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    

    injectDOM();

    loadNav(); 

    // Écoute postMessage (mode iframe legacy ou Moodle sécurisé)
    window.addEventListener('message', function (event) {
      if (!event.data || event.data.type !== 'cours-md') return;
      start((event.data.content || '').trim());
    });

    // Redimensionnement automatique
    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (!slideMode) sendHeight(); }).observe(document.body);
    }

    // Détection directe dans la page (mode autonome, sans iframe)
    var content = readMarkdownFromPage();
    if (content) {
      start(content);
    } else {
      showBanner('<span style="opacity:.5">⏳ En attente du contenu (postMessage)…</span>');
    }
  }

  // ── API publique ──────────────────────────────────────────────────────────
  window._moteur = {
    switchMode: switchMode,
    toggleFullscreen: toggleFullscreen,
    printDoc: printDoc,
    start: start,
    toggleInfo: toggleInfo ,
    toggleSidebar:   toggleSidebar
  };

  // Lancer après chargement du DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();