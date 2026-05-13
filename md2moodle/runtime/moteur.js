/**
 * moteur.js — Moteur de cours md2moodle v2.2
 */
(function () {
  'use strict';

  var VERSION = '2.2.0';

  // ── Compatibilité Moodle ──────────────────────────────────────────────────
  var _savedDefine  = window.define;
  var _savedRequire = window.require;
  if (typeof window.define === 'function' && window.define.amd) {
    window.define = window.require = undefined;
  }

  // ── Chemin de base ────────────────────────────────────────────────────────
  var BASE = (function () {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('moteur.js') !== -1) return src.replace(/moteur\.js.*$/, '');
    }
    return './';
  })();
  var LIBS = BASE + 'libs/';

  // ── État ──────────────────────────────────────────────────────────────────
  var state = { md: null, slideMode: false, revealInstance: null, libsLoaded: false };
  var els   = {};

  // ══════════════════════════════════════════════════════════════════════════
  // DOM
  // ══════════════════════════════════════════════════════════════════════════

  function injectDOM() {
    var sidebar = el('nav', { id: 'moteur-sidebar' });
    sidebar.style.display = 'none';
    document.body.insertBefore(sidebar, document.body.firstChild);

    var toolbar = el('div', { id: 'moteur-toolbar' });
    var logoHtml = '<img id="moteur-logo" src="' + BASE + 'logo.png" alt="" ' +
      'onerror="this.style.display=\'none\'" ' +
      'style="height:26px;margin-right:6px;vertical-align:middle;border-radius:3px">';
    toolbar.innerHTML =
      logoHtml +
      '<button class="moteur-btn" id="moteur-sidebar-toggle" title="Menu" style="display:none" onclick="window._moteur.toggleSidebar()">' + svgHamburger() + '</button>' +
      btn('moteur-mode-btn',  '▶', 'switchMode',       'Slides / Document') +
      btn('moteur-print-btn', '⬇', 'printDoc',         'Exporter PDF') +
      btn('moteur-pdf-btn',   '🖨', 'printSlidesPdf',   'Imprimer slides', true) +
      btn('moteur-fs-btn',    '⛶', 'toggleFullscreen', 'Plein écran') +
      btn('moteur-info-btn',  'ⓘ', 'toggleInfo',       'Informations');
    document.body.appendChild(toolbar);

    var banner = el('div', { id: 'moteur-banner' });
    banner.innerHTML = '<span>⏳ Chargement…</span>';
    document.body.appendChild(banner);

    var doc = el('div', { id: 'moteur-doc' });
    doc.style.display = 'none';
    document.body.appendChild(doc);

    var reveal = el('div', { className: 'reveal' });
    reveal.style.display = 'none';
    var slides = el('div', { className: 'slides' });
    reveal.appendChild(slides);
    document.body.appendChild(reveal);

    var info = el('div', { id: 'moteur-info-popup' });
    info.style.display = 'none';
    info.innerHTML = infoHtml();
    document.body.appendChild(info);

    els = {
      sidebar,
      toggle:   toolbar.querySelector('#moteur-sidebar-toggle'),
      toolbar,  banner,  doc,  reveal,  slides,
      modeBtn:  toolbar.querySelector('#moteur-mode-btn'),
      printBtn: toolbar.querySelector('#moteur-print-btn'),
      pdfBtn:   toolbar.querySelector('#moteur-pdf-btn'),
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }

  function el(tag, props) { var e = document.createElement(tag); Object.assign(e, props); return e; }

  function btn(id, icon, fn, title, hidden) {
    return '<button class="moteur-btn" id="' + id + '" onclick="window._moteur.' + fn + '()" title="' + title + '"' +
      (hidden ? ' style="display:none"' : '') + '>' + icon + '</button>';
  }

  function svgHamburger() {
    return '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none">' +
      '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  }

  function infoHtml() {
    return '<div class="moteur-info-inner"><p><strong>md2moodle</strong> v' + VERSION + '</p>' +
      '<p>Raccourcis :<br>&nbsp;<kbd>S</kbd> slides · <kbd>F</kbd> plein écran · <kbd>P</kbd> print</p>' +
      '<button onclick="window._moteur.toggleInfo()">Fermer</button></div>';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Chargement libs
  // ══════════════════════════════════════════════════════════════════════════

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    var d = window.define, r = window.require;
    if (typeof d === 'function' && d.amd) { window.define = window.require = undefined; }
    s.onload  = function () { if (typeof d === 'function') { window.define = d; window.require = r; } cb(); };
    s.onerror = function () { console.warn('Impossible de charger:', src); cb(); };
    document.head.appendChild(s);
  }

  function loadStyle(href) {
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }

  function loadFonts() {
    var families = [
      ["'DM Sans'",400,'normal','DM-Sans-Regular'],["'DM Sans'",500,'normal','DM-Sans-Medium'],
      ["'DM Sans'",600,'normal','DM-Sans-SemiBold'],["'DM Mono'",400,'normal','DM-Mono-Regular'],
      ["'DM Mono'",500,'normal','DM-Mono-Medium'],["'DM Serif Display'",400,'normal','DM-Serif-Display-Regular'],
      ["'DM Serif Display'",400,'italic','DM-Serif-Display-Italic'],
    ];
    var css = families.map(function(f){
      return "@font-face{font-family:"+f[0]+";font-weight:"+f[1]+";font-style:"+f[2]+
        ";src:url('"+LIBS+"fonts/"+f[3]+".woff2')format('woff2')}";
    }).join('\n');
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  function loadAllLibs(cb) {
    if (state.libsLoaded) { cb(); return; }
    // highlight-github = thème CLAIR — ne pas charger highlight.min.css (dark)
    loadStyle(LIBS + 'highlight-github.min.css');
    loadStyle(LIBS + 'katex.min.css');
    loadFonts();
    // reveal chargé à la demande dans loadReveal() pour éviter fond noir
    var chain = [
      LIBS + 'marked.min.js',
      LIBS + 'highlight.min.js',
      LIBS + 'katex.min.js',
      LIBS + 'katex-auto-render.min.js',
      LIBS + 'mermaid.min.js',
    ];
    function next(i) {
      if (i >= chain.length) { onLibsReady(); cb(); return; }
      loadScript(chain[i], function () { next(i + 1); });
    }
    next(0);
  }

  function loadReveal(cb) {
    if (typeof Reveal !== 'undefined') { cb(); return; }
    loadStyle(LIBS + 'reveal.min.css');
    loadScript(LIBS + 'reveal.min.js', cb);
  }

  function onLibsReady() {
    state.libsLoaded = true;
    if (_savedDefine) { window.define = _savedDefine; window.require = _savedRequire; }

    // marked : configurer le renderer (compatible v12 et antérieures)
    if (typeof marked !== 'undefined') {
      try {
        // marked v2+ : marked.use()
        marked.use({ renderer: buildRenderer(), gfm: true, breaks: false });
      } catch(e) {
        // fallback très anciennes versions
        marked.setOptions({ renderer: buildRenderer() });
      }
    }

    // mermaid
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',   // nécessaire pour certains diagrammes
        theme: 'base',
        themeVariables: {
          primaryColor:       '#e8f4fd',
          primaryBorderColor: '#2980b9',
          primaryTextColor:   '#1a1a2e',
          lineColor:          '#2980b9',
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Renderer marked
  // ══════════════════════════════════════════════════════════════════════════

  function buildRenderer() {
    var renderer = new marked.Renderer();

    // Signature marked v12 : token = { text, lang, escaped }
    // Signature marked <v9 : (code, lang)
    renderer.code = function (tokenOrCode, langArg) {
      var code, lang;
      if (tokenOrCode && typeof tokenOrCode === 'object' && 'text' in tokenOrCode) {
        code = tokenOrCode.text;
        lang = tokenOrCode.lang || '';
      } else {
        code = String(tokenOrCode || '');
        lang = langArg || '';
      }

      if (lang === 'mermaid') {
        // Stocker le code brut en base64 pour éviter tout problème d'entités
        return '<div class="mermaid-pending" data-b64="' + b64encode(code) + '"></div>';
      }

      var highlighted = escapeHtml(code);
      if (typeof hljs !== 'undefined') {
        try {
          highlighted = (lang && hljs.getLanguage(lang))
            ? hljs.highlight(code, { language: lang }).value
            : hljs.highlightAuto(code).value;
        } catch(e) { highlighted = escapeHtml(code); }
      }
      highlighted = highlighted.replace(/([^\n]*)\[hl\]/g, '<mark class="code-hl">$1</mark>');

      var langLabel = lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '';
      var copyBtn   = '<button class="code-copy-btn" onclick="window._moteur.copyCode(this)" title="Copier">⎘</button>';
      var cls       = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
      return '<div class="code-block">' + langLabel + copyBtn +
        '<pre><code' + cls + '>' + highlighted + '</code></pre></div>';
    };

    return renderer;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Mermaid
  // ══════════════════════════════════════════════════════════════════════════

  function resolveMermaidPlaceholders(container) {
    if (typeof mermaid === 'undefined') return;

    var pending = container.querySelectorAll('.mermaid-pending');
    if (!pending.length) return;

    // Créer les vrais divs .mermaid avec textContent (pas innerHTML)
    var nodes = [];
    pending.forEach(function (node) {
      var b64  = node.getAttribute('data-b64') || '';
      var code = b64 ? b64decode(b64) : decodeURIComponent(node.getAttribute('data-src') || '');
      if (!code.trim()) { node.remove(); return; }

      var div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = code;        // textContent évite tout encodage HTML
      node.parentNode.replaceChild(div, node);
      nodes.push(div);
    });

    if (!nodes.length) return;

    // mermaid.run() est asynchrone — on attend la promesse si disponible
    try {
      var result = mermaid.run({ nodes: nodes });
      if (result && typeof result.catch === 'function') {
        result.catch(function(e) { console.warn('mermaid.run error:', e); });
      }
    } catch(e) {
      console.warn('mermaid error:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Rendu Document
  // ══════════════════════════════════════════════════════════════════════════

  function renderDoc() {
    var container = document.getElementById('moteur-doc');
    if (!container) return;

    container.innerHTML = marked.parse(state.md,  {
      headerIds: false,
      mangle: false
    });
    container.style.display = '';

    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true  },
          { left: '$',  right: '$',  display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true  },
        ],
        throwOnError: false,
      });
    }

    resolveMermaidPlaceholders(container);
    hideBanner();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Rendu Slides
  // ══════════════════════════════════════════════════════════════════════════

  function renderSlides() {
    var revealEl = document.querySelector('.reveal');
    var slides   = revealEl ? revealEl.querySelector('.slides') : null;
    if (!revealEl || !slides) return;

    loadReveal(function () {
      var sections = state.md.split(/\n---\n/);
      slides.innerHTML = sections.map(function (s) {
        return '<section>' + marked.parse(s.trim(), {
          headerIds: false,
          mangle: false
        }) + '</section>';
      }).join('');

      var doc = document.getElementById('moteur-doc');
      if (doc) doc.style.display = 'none';
      revealEl.style.display = '';

      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(slides, {
          delimiters: [
            { left: '$$', right: '$$', display: true  },
            { left: '$',  right: '$',  display: false },
          ],
          throwOnError: false,
        });
      }

      if (!state.revealInstance && typeof Reveal !== 'undefined') {
        state.revealInstance = new Reveal(revealEl, {
          hash: false, history: false, controls: true,
          progress: true, center: true, slideNumber: 'c/t',
          transition: 'slide', plugins: [], backgroundTransition: 'none',
        });
        state.revealInstance.initialize().then(function () {
          // Annuler le fond noir injecté par Reveal
          var vp = document.querySelector('.reveal-viewport');
          if (vp) vp.style.removeProperty('background');
          document.body.style.removeProperty('background');
          resolveMermaidPlaceholders(slides);
        });
      } else if (state.revealInstance) {
        state.revealInstance.sync();
        state.revealInstance.slide(0, 0);
        resolveMermaidPlaceholders(slides);
      }

      hideBanner();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Modes
  // ══════════════════════════════════════════════════════════════════════════

  function switchMode() {
    state.slideMode = !state.slideMode;
    if (state.slideMode) {
      if (els.modeBtn)  { els.modeBtn.textContent = '📄'; els.modeBtn.classList.add('active'); }
      if (els.printBtn) els.printBtn.style.display = 'none';
      if (els.pdfBtn)   els.pdfBtn.style.display   = '';
      renderSlides();
    } else {
      if (els.modeBtn)  { els.modeBtn.textContent = '▶'; els.modeBtn.classList.remove('active'); }
      if (els.printBtn) els.printBtn.style.display = '';
      if (els.pdfBtn)   els.pdfBtn.style.display   = 'none';
      var revealEl = document.querySelector('.reveal');
      if (revealEl) revealEl.style.display = 'none';
      var doc = document.getElementById('moteur-doc');
      if (doc) doc.style.display = '';
      else renderDoc();
    }
  }

  function printDoc() {
    if (state.slideMode) switchMode();
    setTimeout(function () { window.print(); }, 300);
  }

  function printSlidesPdf() {
    if (!state.slideMode) {
      state.slideMode = true;
      if (els.printBtn) els.printBtn.style.display = 'none';
      if (els.pdfBtn)   els.pdfBtn.style.display   = '';
      renderSlides();
    }
    setTimeout(function () { window.print(); }, 1500);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Copier code
  // ══════════════════════════════════════════════════════════════════════════

  function copyCode(btn) {
    var block = btn.closest('.code-block');
    var code  = block ? block.querySelector('code') : null;
    if (!code) return;
    var text = code.innerText || code.textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = '✓'; setTimeout(function(){ btn.textContent = '⎘'; }, 1500);
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = '✓'; setTimeout(function(){ btn.textContent = '⎘'; }, 1500);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Sidebar
  // ══════════════════════════════════════════════════════════════════════════

  function loadNav() {
    var navEl = document.getElementById('moteur-nav');
    if (!navEl) return;
    try {
      var nav = JSON.parse(navEl.textContent);
      if (!nav.chapters || !nav.chapters.length) return;
      buildSidebar(nav);
    } catch(e) { console.warn('moteur-nav JSON invalide'); }
  }

  function buildSidebar(nav) {
    var sidebar = document.getElementById('moteur-sidebar');
    var toggle  = document.getElementById('moteur-sidebar-toggle');
    if (!sidebar) return;
    var html = '<div class="moteur-sidebar-inner"><div class="moteur-sidebar-title">' +
      escapeHtml(nav.title || 'Sommaire') + '</div>';
    for (var i = 0; i < nav.chapters.length; i++) {
      var ch = nav.chapters[i];
      html += '<div class="moteur-chapter">';
      if (ch.title) html += '<div class="moteur-chapter-title">' + escapeHtml(ch.title) + '</div>';
      if (ch.href)  html += navLink(ch.href, ch.title);
      for (var j = 0; j < (ch.children || []).length; j++) {
        html += navLink(ch.children[j].href, ch.children[j].title);
      }
      html += '</div>';
    }
    html += '</div>';
    sidebar.innerHTML = html;
    sidebar.style.display = '';
    if (toggle) toggle.style.display = '';
    document.body.classList.add('with-sidebar');
    applyWithSidebarStyles();
  }

  function navLink(href, title) {
    var cur = window.location.pathname.endsWith(href) ||
      (href === 'index.html' && /\/$|\/index\.html$/.test(window.location.pathname));
    return '<a href="' + escapeHtml(href) + '" class="moteur-nav-link' + (cur ? ' active' : '') + '">' +
      escapeHtml(title) + '</a>';
  }

  function toggleSidebar() {
    var sidebar = document.getElementById('moteur-sidebar');
    if (sidebar) sidebar.classList.toggle('hidden');
  }

  function applyWithSidebarStyles() {
    if (els.toolbar) els.toolbar.style.left = '252px';
    var doc = document.getElementById('moteur-doc');
    if (doc) doc.style.paddingLeft = '260px';
  }

  function onFullscreenChange() {
    var hasSidebar = document.body.classList.contains('with-sidebar');
    var sidebar = document.getElementById('moteur-sidebar');
    var toolbar = document.getElementById('moteur-toolbar');
    var doc     = document.getElementById('moteur-doc');
    if (document.fullscreenElement) {
      if (sidebar) sidebar.classList.add('hidden');
      if (hasSidebar && toolbar) toolbar.style.left = '0';
      if (hasSidebar && doc)     doc.style.paddingLeft = '20px';
    } else {
      if (sidebar) sidebar.classList.remove('hidden');
      if (hasSidebar) applyWithSidebarStyles();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Fullscreen / Info / Keyboard
  // ══════════════════════════════════════════════════════════════════════════

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }

  function toggleInfo() {
    var p = document.getElementById('moteur-info-popup');
    if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
  }

  function showBanner(html) { var b = document.getElementById('moteur-banner'); if (b) { b.style.display = ''; b.innerHTML = html; } }
  function hideBanner()     { var b = document.getElementById('moteur-banner'); if (b) b.style.display = 'none'; }

  function setupKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 's' || e.key === 'S') switchMode();
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'p' || e.key === 'P') printDoc();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════════

  function escapeHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function b64encode(str) {
    try {
      // UTF-8 safe
      var bytes = new TextEncoder().encode(str);
      var binary = '';
      bytes.forEach(function(b){ binary += String.fromCharCode(b); });
      return btoa(binary);
    } catch(e) {
      // Fallback si TextEncoder absent (vieux navigateurs)
      try { return btoa(unescape(encodeURIComponent(str))); } catch(e2) { return btoa(str); }
    }
  }

  function b64decode(b64) {
    try {
      var binary = atob(b64);
      var bytes  = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch(e) {
      try { return decodeURIComponent(escape(atob(b64))); } catch(e2) { return atob(b64); }
    }
  }

  function readMarkdown() {
    var div = document.getElementById('cours-md');
    if (!div) return null;
    return (div.textContent || div.innerText || '').trim() || null;
  }

  function start(md) {
    state.md = md;
    hideBanner();
    loadAllLibs(function () {
      if (window.location.search.includes('print-pdf')) {
        var toolbar = document.getElementById('moteur-toolbar');
        if (toolbar) toolbar.style.display = 'none';
        renderSlides();
      } else {
        renderDoc();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════════════════

  function init() {
    injectDOM();
    loadNav();
    setupKeyboard();
    window.addEventListener('message', function(e) {
      if (!e.data || e.data.type !== 'cours-md') return;
      start((e.data.content || '').trim());
    });
    var md = readMarkdown();
    if (md) start(md);
    else showBanner('<span>⏳ En attente du contenu…</span>');
  }

  window._moteur = {
    version: VERSION,
    switchMode, toggleFullscreen, toggleInfo, toggleSidebar,
    printDoc, printSlidesPdf, copyCode, start,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
