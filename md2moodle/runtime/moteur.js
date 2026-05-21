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
      btn('moteur-mode-btn',   '▶', 'switchMode',       'Slides / Document') +
      btn('moteur-print-btn',    '⬇', 'printDoc',       'Exporter PDF') +
      btn('moteur-pdfall-btn',   '📑', 'printAllPdf',   'Exporter PDF complet (toutes pages)', true) +
      btn('moteur-pdf-btn',      '🖨', 'printSlidesPdf', 'Imprimer slides', true) +
      btn('moteur-fs-btn',     '⛶', 'toggleFullscreen', 'Plein écran') +
      btn('moteur-info-btn',   'ⓘ', 'toggleInfo',       'Informations');
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

    var spinner = el('div', { id: 'moteur-pdf-spinner' });
    spinner.style.display = 'none';
    spinner.innerHTML =
      '<div class="moteur-spinner-inner">' +
        '<div class="moteur-spinner-icon"></div>' +
        '<span class="moteur-spinner-label">Génération du PDF…</span>' +
      '</div>';
    document.body.appendChild(spinner);

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

    // Ne charger katex.min.css et highlight-github.min.css que s'ils ne sont
    // pas déjà inlinés dans la page (mode serve/html les inline dans <style>
    // pour contrôler l'ordre et éviter la contamination dark-mode de KaTeX).
    var katexAlreadyInlined = !!(document.querySelector('style') &&
      document.querySelector('style').textContent.includes('KaTeX_Main'));
    if (!katexAlreadyInlined) {
      loadStyle(LIBS + 'highlight-github.min.css');
      loadStyle(LIBS + 'katex.min.css');
    }
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

    if (typeof marked !== 'undefined') {
      // Autoriser le HTML brut dans le Markdown (nécessaire pour <img>, <div class="callout">…)
      try {
        marked.use({
          renderer: buildRenderer(),
          gfm: true,
          breaks: false,
          pedantic: false,
        });
        // marked v12+ : il faut aussi passer mangle:false et headerIds:false
        // pour éviter les warnings, et surtout ne PAS sanitize le HTML
        if (marked.defaults && marked.defaults.sanitize !== undefined) {
          marked.setOptions({ sanitize: false });
        }
      } catch(e) {
        marked.setOptions({ renderer: buildRenderer(), sanitize: false });
      }
    }

    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
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
  // Préprocesseur Markdown (avant marked.parse)
  // ══════════════════════════════════════════════════════════════════════════

  // Transformations appliquées sur le texte brut avant le parsing marked :
  //   1. Callouts Obsidian  : > [!info] Titre → <blockquote class="callout callout-info">
  //   2. Wikilinks          : [[Fichier|Texte]] → [Texte](Fichier)
  //   3. Images wikilinks   : ![[image.png]]   → ![image.png](image.png)

  function preprocessMarkdown(md) {
    // ── Protéger les délimiteurs LaTeX \(...\) \[...\] contre l'escape Markdown ─
    // CommonMark considère \( comme un escape valide → marked supprime le \.
    // En doublant : \\( → marked produit \( dans le HTML → KaTeX le reconnaît.
    var _fenceOpen = false;
    md = md.split('\n').map(function(line) {
      if (/^[ \t]*(`{3,}|~{3,})/.test(line)) { _fenceOpen = !_fenceOpen; return line; }
      if (_fenceOpen) return line;
      var out = '', inBt = false;
      for (var _j = 0; _j < line.length; _j++) {
        var _c = line[_j];
        if (_c === '`') { inBt = !inBt; out += _c; continue; }
        if (!inBt && _c === '\\' && _j + 1 < line.length) {
          var _n = line[_j + 1];
          if (_n === '(' || _n === ')' || _n === '[' || _n === ']') {
            out += '\\\\' + _n; _j++; continue;
          }
        }
        out += _c;
      }
      return out;
    }).join('\n');

    // ── Images wikilinks : ![[file.png]] → ![file.png](file.png) ──────────
    md = md.replace(/!\[\[([^\]]+)\]\]/g, function(_, src) {
      var alt = src.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
      return '![' + alt + '](' + src + ')';
    });

    // ── Wikilinks : [[Page|Texte]] ou [[Page]] → lien Markdown ───────────
    md = md.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '[$2]($1)');
    md = md.replace(/\[\[([^\]]+)\]\]/g, '[$1]($1)');

    // ── Callouts Obsidian : > [!type] Titre ───────────────────────────────
    // On cherche un bloc de lignes commençant par > dont la première
    // contient [!type]. On remplace le TOUT (pas juste une partie).
    md = md.replace(
      /^(> ?\[!([\w]+)\][^\n]*\n(?:> ?[^\n]*\n?)*)/gm,
      function(block) {
        // Découper ligne par ligne
        var lines = block.split('\n').filter(function(l) { return l.trim() !== ''; });

        // Première ligne : > [!type] Titre optionnel
        var firstLine = lines[0];
        var headerMatch = firstLine.match(/^> ?\[!([\w]+)\][ \t]*(.*)/i);
        if (!headerMatch) return block;

        var type     = headerMatch[1].toLowerCase();
        var titleTxt = headerMatch[2].trim();

        // Lignes suivantes : contenu (supprimer le ">" de début)
        var contentLines = lines.slice(1).map(function(l) {
          return l.replace(/^> ?/, '');
        });
        var content = contentLines.join('\n').trim();

        var cssType = {
          info:'info', note:'info', tip:'success', important:'info',
          warning:'warning', caution:'warning', attention:'warning',
          danger:'danger', error:'danger', failure:'danger', bug:'danger',
          success:'success', check:'success', done:'success',
          question:'info', faq:'info', help:'info', hint:'success',
          quote:'info', example:'info', abstract:'info', summary:'info', todo:'warning',
        }[type] || 'info';

        var icons = { info:'ℹ️', warning:'⚠️', danger:'🚫', success:'✅' };
        var icon  = icons[cssType] || 'ℹ️';

        var titleHtml = titleTxt
          ? '<div class="callout-title">' + icon + '&nbsp;' + escapeHtml(titleTxt) + '</div>'
          : '<div class="callout-title">' + icon + '&nbsp;' + escapeHtml(type.charAt(0).toUpperCase() + type.slice(1)) + '</div>';

        return '<div class="callout callout-' + cssType + '">\n' +
               titleHtml + '\n\n' + content + '\n\n</div>\n';
      }
    );

    return md;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Renderer marked
  // ══════════════════════════════════════════════════════════════════════════

  function buildRenderer() {
    var renderer = new marked.Renderer();

    // ── Code inline : `{python}print("Hello")` ───────────────────────────
    renderer.codespan = function(token) {
      var text = typeof token === 'object' ? (token.text || '') : String(token || '');
      // marked v12 pré-escape token.text — décoder ' et " pour l'affichage
      var decoded = text.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      var m = decoded.match(/^\{([a-zA-Z0-9_+\-]+)\}([\s\S]*)$/);
      if (m && typeof hljs !== 'undefined') {
        var lang = m[1], code = m[2];
        try {
          var highlighted = hljs.getLanguage(lang)
            ? hljs.highlight(code, { language: lang }).value
            : hljs.highlightAuto(code).value;
          return '<code class="hljs hljs-inline language-' + escapeHtml(lang) + '">' + highlighted + '</code>';
        } catch(e) {}
      }
      var safe = decoded.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return '<code>' + safe + '</code>';
    };

    // ── Code ──────────────────────────────────────────────────────────────
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

  // Lancer mermaid uniquement sur la slide actuellement visible
  // (Reveal.js ne rend que la slide courante dans le DOM)
  function renderMermaidInCurrentSlide() {
    if (typeof mermaid === 'undefined') return;
    var currentSection = document.querySelector('.reveal .slides section.present');
    if (!currentSection) {
      // Fallback : toutes les sections
      currentSection = document.querySelector('.reveal .slides');
    }
    if (currentSection) resolveMermaidPlaceholders(currentSection);
  }

  function renderDoc() {
    var container = document.getElementById('moteur-doc');
    if (!container) return;

    container.innerHTML = marked.parse(preprocessMarkdown(state.md));
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

    highlightInlineCode(container);
    resolveMermaidPlaceholders(container);
    hideBanner();
  }

  function highlightInlineCode(container) {
    if (typeof hljs === 'undefined') return;
    // Lire le langage depuis le frontmatter (data-lang sur #cours-md)
    var div  = document.getElementById('cours-md');
    var lang = div ? (div.getAttribute('data-inline-lang') || '') : '';
    if (!lang || !hljs.getLanguage(lang)) return;
    container.querySelectorAll('code').forEach(function(el) {
      if (el.closest('pre')) return;
      try {
        el.innerHTML = hljs.highlight(el.textContent, { language: lang }).value;
        el.classList.add('hljs-inline');
      } catch(e) {}
    });
  }

  // Découpe le Markdown en slides sur ---, en ignorant les --- dans les blocs de code
  function splitSlides(md) {
    var slides  = [];
    var current = '';
    var inCode  = false;
    // Normaliser les fins de ligne (CRLF → LF) pour les fichiers créés sous Windows
    var lines   = md.replace(/\r/g, '').split('\n');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^[ \t]*(`{3,}|~{3,})/.test(line)) inCode = !inCode;
      if (!inCode && /^[ \t]*---[ \t]*$/.test(line)) {
        slides.push(current.trim());
        current = '';
        continue;
      }
      current += line + '\n';
    }
    if (current.trim()) slides.push(current.trim());
    return slides.filter(Boolean);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Rendu Slides
  // ══════════════════════════════════════════════════════════════════════════

  function renderSlides() {
    var revealEl = document.querySelector('.reveal');
    var slides   = revealEl ? revealEl.querySelector('.slides') : null;
    if (!revealEl || !slides) return;

    loadReveal(function () {
      // Découper en slides sur ---, en ignorant les blocs de code
      var sections = splitSlides(state.md);
      slides.innerHTML = sections.map(function (s) {
        return '<section>' + marked.parse(preprocessMarkdown(s.trim())) + '</section>';
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
          progress: true, center: false,
          slideNumber: 'c/t',
          transition: 'slide', plugins: [], backgroundTransition: 'none',
        });
        state.revealInstance.initialize().then(function () {
          // Annuler le fond noir injecté par Reveal
          var vp = document.querySelector('.reveal-viewport');
          if (vp) vp.style.removeProperty('background');
          document.body.style.removeProperty('background');

          // Mermaid : délai pour que Reveal finalise le layout avant le rendu
          setTimeout(renderMermaidInCurrentSlide, 150);
          // slidetransitionend = slide entièrement visible (vs slidechanged = début transition)
          state.revealInstance.on('slidetransitionend', function() {
            renderMermaidInCurrentSlide();
          });
        });
      } else if (state.revealInstance) {
        state.revealInstance.sync();
        state.revealInstance.slide(0, 0);
        setTimeout(renderMermaidInCurrentSlide, 150);
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

  function showSpinner(label) {
    var el = document.getElementById('moteur-pdf-spinner');
    if (!el) return;
    el.querySelector('.moteur-spinner-label').textContent = label || 'Génération du PDF…';
    el.style.display = '';
  }

  function hideSpinner() {
    var el = document.getElementById('moteur-pdf-spinner');
    if (el) el.style.display = 'none';
  }

  function downloadPdf(url, label) {
    showSpinner(label);
    fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('Erreur serveur : ' + res.status);
        var cd = res.headers.get('content-disposition') || '';
        var m  = cd.match(/filename="([^"]+)"/);
        var filename = m ? m[1] : 'cours.pdf';
        return res.blob().then(function(blob) { return { blob: blob, filename: filename }; });
      })
      .then(function(data) {
        hideSpinner();
        var objUrl = URL.createObjectURL(data.blob);
        var a = document.createElement('a');
        a.href = objUrl; a.download = data.filename; a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { URL.revokeObjectURL(objUrl); document.body.removeChild(a); }, 2000);
      })
      .catch(function(e) {
        hideSpinner();
        alert('Erreur génération PDF : ' + e.message);
      });
  }

  function printDoc() {
    var isPuppeteerAvailable = window.location.hostname === 'localhost' ||
                               window.location.hostname === '127.0.0.1';
    if (!state.slideMode && isPuppeteerAvailable) {
      var _pathname = window.location.pathname;
      try { _pathname = decodeURIComponent(_pathname); } catch(e) {}
      downloadPdf('/__pdf?page=' + encodeURIComponent(_pathname), 'Génération du PDF…');
      return;
    }
    if (state.slideMode) switchMode();
    setTimeout(function () { window.print(); }, 300);
  }

  function printAllPdf() {
    var isPuppeteerAvailable = window.location.hostname === 'localhost' ||
                               window.location.hostname === '127.0.0.1';
    if (!isPuppeteerAvailable) { alert('Export PDF complet disponible uniquement en mode serve (localhost).'); return; }
    downloadPdf('/__pdf-all', 'Génération du PDF complet…');
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
    var pdfAllBtn = document.getElementById('moteur-pdfall-btn');
    if (pdfAllBtn) pdfAllBtn.style.display = '';
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
    var b64 = div.getAttribute('data-b64');
    var md  = b64 ? (b64decode(b64) || null) : ((div.textContent || div.innerText || '').trim() || null);
    // Normaliser CRLF → LF (fichiers créés sous Windows)
    return md ? md.replace(/\r/g, '') : null;
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
    printDoc, printAllPdf, printSlidesPdf, copyCode, start,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
