/**
 * moteur.js — Moteur de cours ISEN
 * Hébergé sur GitHub Pages.
 * Reçoit le markdown depuis la page Moodle parente via postMessage.
 */
(function () {
  'use strict';

  var BASE = (function () {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src');
      if (src && src.indexOf('moteur.js') !== -1) return src.replace(/moteur\.js.*$/, '');
    }
    return './';
  })();
  var LIBS = BASE + 'libs/';

  var md = null;
  var slideMode = false;
  var revealInitialized = false;
  var libsLoaded = false;

  // ── DOM ───────────────────────────────────────────────────────────────────
  function injectDOM() {
    var toolbar = document.createElement('div');
    toolbar.id = 'moteur-toolbar';
    toolbar.innerHTML =
      '<button class="moteur-btn" id="moteur-mode-btn" onclick="window._moteur.switchMode()">&#9654; Slides</button>' +
      '<button class="moteur-btn" onclick="window._moteur.printDoc()">&#11015; Imprimer</button>' +
      '<button class="moteur-btn" onclick="window._moteur.toggleFullscreen()">&#9974; Plein écran</button>';

    var banner = document.createElement('div');
    banner.id = 'moteur-banner';
    banner.innerHTML = '<span style="opacity:.5">⏳ En attente du contenu…</span>';

    var doc = document.createElement('div');
    doc.id = 'moteur-doc';
    doc.style.display = 'none';

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
  }

  // ── Chargement libs (GitHub Pages = même origine, pas de pb CORS/AMD) ────
  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = function () { console.warn('Impossible de charger:', src); cb(); };
    document.head.appendChild(s);
  }

  function loadStyle(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }

  function loadFonts() {
    var style = document.createElement('style');
    style.textContent = [
      "@font-face{font-family:'DM Sans';font-weight:400;src:url('" + LIBS + "fonts/DM-Sans-Regular.woff2') format('woff2')}",
      "@font-face{font-family:'DM Sans';font-weight:500;src:url('" + LIBS + "fonts/DM-Sans-Medium.woff2') format('woff2')}",
      "@font-face{font-family:'DM Mono';font-weight:400;src:url('" + LIBS + "fonts/DM-Mono-Regular.woff2') format('woff2')}",
      "@font-face{font-family:'DM Mono';font-weight:500;src:url('" + LIBS + "fonts/DM-Mono-Medium.woff2') format('woff2')}",
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
    loadScript(LIBS + 'marked.min.js', function () {
      loadScript(LIBS + 'highlight.min.js', function () {
        loadScript(LIBS + 'katex.min.js', function () {
          loadScript(LIBS + 'katex-auto-render.min.js', function () {
            loadScript(LIBS + 'mermaid.min.js', function () {
              loadScript(LIBS + 'reveal.min.js', function () {
                libsLoaded = true;
                if (typeof marked !== 'undefined') {
                  marked.setOptions({
                    highlight: function (code, lang) {
                      return typeof hljs !== 'undefined'
                        ? hljs.highlightAuto(code, lang ? [lang] : undefined).value
                        : code;
                    }
                  });
                }
                if (typeof mermaid !== 'undefined') {
                  mermaid.initialize({ startOnLoad: false, theme: 'base',
                    themeVariables: { primaryColor: '#fadbd8', primaryBorderColor: '#c0392b', primaryTextColor: '#1a1a2e' }
                  });
                }
                cb();
              });
            });
          });
        });
      });
    });
  }

  // ── Transformations ───────────────────────────────────────────────────────
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
          setTimeout(function () { btn.innerHTML = ICON_COPY + '<span>Copier</span>'; btn.classList.remove('copied'); }, 2000);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(done);
        else done();
      });
      pre.appendChild(btn);
    });
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
      el.innerHTML = el.innerHTML.split('\n').map(function (line) {
        if (!line.includes('[hl]')) return line;
        var clean = line.replace(/\s*#\s*\[hl\]/g,'').replace(/\s*\/\/\s*\[hl\]/g,'').replace(/\s*--\s*\[hl\]/g,'');
        return '<span class="moteur-hl-line">' + clean + '</span>';
      }).join('\n').replace(/\n(<\/span>)/g, '$1');
    });
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  function renderDoc() {
    if (revealInitialized) { try { Reveal.destroy(); } catch(e){} revealInitialized = false; }
    document.documentElement.style.overflow = '';
    document.documentElement.style.height = '';
    document.body.style.overflow = '';
    document.body.style.height = '';
    document.body.style.width = '';

    var docEl = document.getElementById('moteur-doc');
    var revealEl = document.querySelector('.reveal');
    docEl.style.display = 'block';
    if (revealEl) { revealEl.style.display = 'none'; revealEl.querySelector('.slides').innerHTML = ''; }

    docEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(md || '') : '<p>Erreur : marked.js non chargé.</p>';
    if (typeof hljs !== 'undefined') hljs.highlightAll();
    addLangBadges(docEl); highlightLines(docEl); transformMermaid(docEl); renderMath(docEl); addCopyButtons(docEl);
    sendHeight();
  }

  function renderSlides() {
    var docEl = document.getElementById('moteur-doc');
    var revealEl = document.querySelector('.reveal');
    docEl.style.display = 'none';
    revealEl.style.display = 'block';

    var container = revealEl.querySelector('.slides');
    container.innerHTML = '';
    (md || '').split(/^---$/m).forEach(function (s) {
      var section = document.createElement('section');
      section.innerHTML = typeof marked !== 'undefined' ? marked.parse(s) : s;
      container.appendChild(section);
    });
    if (typeof hljs !== 'undefined') hljs.highlightAll();
    highlightLines(container); transformMermaid(container); renderMath(container); addCopyButtons(container);

    if (!revealInitialized) {
      Reveal.initialize({ hash: false, slideNumber: true, transition: 'slide', width: 1100, height: 700 });
      revealInitialized = true;
    } else { Reveal.sync(); Reveal.slide(0); }
    setTimeout(sendHeight, 400);
  }

  // ── Communication avec Moodle (postMessage) ───────────────────────────────
  var _lastSentHeight = 0;
  var _sendHeightTimer = null;

  function sendHeight() {
    // Débounce : on attend 100ms que le layout se stabilise
    clearTimeout(_sendHeightTimer);
    _sendHeightTimer = setTimeout(function () {
      var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      // N'envoie que si la hauteur a vraiment changé (évite la boucle infinie)
      if (h === _lastSentHeight) return;
      _lastSentHeight = h;
      window.parent.postMessage({ type: 'resize-iframe', height: h }, '*');
    }, 100);
  }

  // ── Commandes publiques ───────────────────────────────────────────────────
  function switchMode() {
    slideMode = !slideMode;
    var btn = document.getElementById('moteur-mode-btn');
    // Toujours passer par loadAllLibs — Reveal peut ne pas encore être chargé
    loadAllLibs(function () {
      if (slideMode) { renderSlides(); btn.textContent = '📄 Document'; btn.classList.add('active'); }
      else           { renderDoc();    btn.textContent = '▶ Slides';    btn.classList.remove('active'); }
    });
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }
  function printDoc() {
    if (slideMode) switchMode();
    setTimeout(function () { window.print(); }, 300);
  }

  function start(content) {
    md = content;
    document.getElementById('moteur-banner').style.display = 'none';
    loadAllLibs(function () { renderDoc(); });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectDOM();

    // Écoute le postMessage envoyé par la page Moodle parente
    window.addEventListener('message', function (event) {
      if (!event.data || event.data.type !== 'cours-md') return;
      start((event.data.content || '').trim());
    });

    // Redimensionnement auto
    if (window.ResizeObserver) {
      // on observe document.documentElement plutôt que body
      // pour ne pas déclencher sur les changements causés par l'iframe elle-même
      new ResizeObserver(function (entries) {
        if (slideMode) return;
        // Ignorer les changements de largeur (resize horizontal = pas de reboucle)
        var entry = entries[0];
        if (entry && entry.contentRect.height > 0) sendHeight();
      }).observe(document.documentElement);
    }

    // Mode autonome (ouverture directe de l'URL GitHub Pages, hors Moodle)
    var el = document.getElementById('cours-md');
    if (el) {
      var txt = document.createElement('textarea');
      txt.innerHTML = el.innerHTML;
      start(txt.value.trim());
    }
  }

  window._moteur = { switchMode: switchMode, toggleFullscreen: toggleFullscreen, printDoc: printDoc, start: start };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();