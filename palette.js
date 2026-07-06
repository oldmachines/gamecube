/* ============================================================================
   oldmachines — Term Palette
   A self-contained glossary quick-find. Press "/" or ⌘/Ctrl-K (or click the
   launcher) to open a filterable list of every defined term on the page, read
   its explanation, and jump to where it's used. Terms and definitions are
   harvested live from the page's [data-tip] elements — nothing hard-coded, so
   the palette always matches the course it ships with.

   Drop-in: <script src="../palette.js" defer></script> on any course page.
   It injects its own themed styles (via the page's CSS variables), so it looks
   native on every machine's site. No dependencies.
   ============================================================================ */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- harvest terms from [data-tip] nodes ------------------------------- */
  function harvest() {
    var nodes = document.querySelectorAll('[data-tip]');
    var byKey = Object.create(null);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var term = (el.textContent || '').replace(/\s+/g, ' ').trim();
      var def = (el.getAttribute('data-tip') || '').replace(/\s+/g, ' ').trim();
      if (!term || !def) continue;
      var key = term.toLowerCase();
      if (!byKey[key]) {
        byKey[key] = { term: term, def: def, node: el };
      } else if (def.length > byKey[key].def.length) {
        // keep the fullest definition, but the earliest node to jump to
        byKey[key].def = def;
      }
    }
    // Merge an optional curated glossary (window.OMP_TERMS) — used by sites
    // that don't carry [data-tip] markup (e.g. the Apple II lectures).
    var curated = window.OMP_TERMS;
    if (curated && curated.length) {
      for (var c = 0; c < curated.length; c++) {
        var item = curated[c];
        if (!item || !item.term || !item.def) continue;
        var ck = String(item.term).toLowerCase();
        if (!byKey[ck]) byKey[ck] = { term: String(item.term), def: String(item.def), node: null };
      }
    }
    var list = [];
    for (var k in byKey) list.push(byKey[k]);
    list.sort(function (a, b) { return a.term.toLowerCase() < b.term.toLowerCase() ? -1 : 1; });
    return list;
  }

  /* Best-effort locate the first on-page mention of a term (for curated
     glossary entries that have no source node to point at). */
  function findFirst(term) {
    try {
      var lc = term.toLowerCase();
      var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = tw.nextNode())) {
        var p = n.parentNode;
        if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') continue;
        if (p.closest && p.closest('.omp-overlay,.omp-launch')) continue;
        if ((n.nodeValue || '').toLowerCase().indexOf(lc) >= 0) return p;
      }
    } catch (e) { /* no-op */ }
    return null;
  }

  var TERMS = harvest();
  if (!TERMS.length) return; // nothing to show — don't add UI

  /* ---- styles (themed via the host page's CSS custom properties) --------- */
  var ACCENT = 'var(--red, var(--violet, var(--accent, var(--cyan, var(--blue, #8b7bf0)))))';
  var css = [
    '.omp-launch{position:fixed;right:18px;bottom:18px;z-index:9998;display:inline-flex;align-items:center;gap:8px;',
      'padding:9px 13px;border-radius:999px;cursor:pointer;',
      'font:600 11px/1 var(--mono,ui-monospace,Menlo,monospace);letter-spacing:.08em;text-transform:uppercase;',
      'color:var(--ink-2,#b7afce);background:var(--panel,#16121f);border:1px solid var(--line,#2c2542);',
      'box-shadow:0 10px 30px -12px rgba(0,0,0,.7);transition:color .15s,border-color .15s,transform .15s}',
    '.omp-launch:hover{color:var(--ink,#fff);border-color:' + ACCENT + ';transform:translateY(-2px)}',
    '.omp-launch kbd{font:inherit;background:var(--panel-2,#1d1830);border:1px solid var(--line-2,#392f57);',
      'border-radius:5px;padding:2px 6px;color:var(--ink-2,#b7afce)}',
    '@media (max-width:640px){.omp-launch .omp-lk{display:none}}',

    '.omp-overlay{position:fixed;inset:0;z-index:9999;display:none;align-items:flex-start;justify-content:center;',
      'padding:10vh 16px 16px;background:rgba(4,3,8,.62);backdrop-filter:blur(3px)}',
    '.omp-overlay.open{display:flex}',
    '.omp-panel{width:100%;max-width:620px;max-height:78vh;display:flex;flex-direction:column;overflow:hidden;',
      'background:var(--panel,#16121f);border:1px solid var(--line-2,#392f57);border-radius:14px;',
      'box-shadow:0 40px 90px -30px rgba(0,0,0,.85)}',
    REDUCED ? '' : '.omp-overlay.open .omp-panel{animation:omp-in .16s ease}',
    '@keyframes omp-in{from{opacity:0;transform:translateY(-8px) scale(.985)}to{opacity:1;transform:none}}',

    '.omp-search{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#2c2542)}',
    '.omp-search svg{width:16px;height:16px;flex:0 0 auto;color:var(--muted,#877f9e)}',
    '.omp-search input{flex:1;background:none;border:none;outline:none;color:var(--ink,#ece8f6);',
      'font:500 16px/1.3 var(--sans,system-ui,sans-serif)}',
    '.omp-search input::placeholder{color:var(--muted,#877f9e)}',
    '.omp-count{font:600 10.5px/1 var(--mono,monospace);letter-spacing:.06em;color:var(--muted,#877f9e);',
      'background:var(--panel-2,#1d1830);border:1px solid var(--line,#2c2542);border-radius:999px;padding:5px 9px;white-space:nowrap}',

    '.omp-list{list-style:none;margin:0;padding:6px;overflow-y:auto;flex:1}',
    '.omp-item{display:block;padding:9px 12px;border-radius:9px;cursor:pointer;border:1px solid transparent}',
    '.omp-item .t{font:600 14px/1.3 var(--sans,system-ui,sans-serif);color:var(--ink,#ece8f6)}',
    '.omp-item .d{font:400 12.5px/1.45 var(--sans,system-ui,sans-serif);color:var(--muted,#877f9e);margin-top:2px;',
      'display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}',
    '.omp-item.sel{background:var(--panel-2,#1d1830);border-color:var(--line-2,#392f57)}',
    '.omp-item.sel .t{color:' + ACCENT + '}',
    '.omp-item mark{background:none;color:' + ACCENT + ';font-weight:700}',
    '.omp-empty{padding:26px 16px;text-align:center;color:var(--muted,#877f9e);',
      'font:500 14px/1.5 var(--sans,system-ui,sans-serif)}',

    '.omp-detail{border-top:1px solid var(--line,#2c2542);padding:14px 16px;background:var(--ground-2,#100d19)}',
    '.omp-detail .dt{font:700 13px/1.3 var(--sans,system-ui,sans-serif);color:var(--ink,#ece8f6);margin:0 0 5px}',
    '.omp-detail .dd{font:400 13.5px/1.6 var(--sans,system-ui,sans-serif);color:var(--ink-2,#b7afce);margin:0}',
    '.omp-detail .hint{margin-top:10px;font:600 10.5px/1.4 var(--mono,monospace);letter-spacing:.05em;',
      'text-transform:uppercase;color:var(--muted,#877f9e);display:flex;gap:14px;flex-wrap:wrap}',
    '.omp-detail .hint b{color:var(--ink-2,#b7afce);font-weight:700}',

    '.omp-flash{animation:omp-flash 1.6s ease}',
    '@keyframes omp-flash{0%,100%{background:transparent}18%{background:' + ACCENT + '22}}'
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.id = 'omp-style';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---- DOM --------------------------------------------------------------- */
  var launch = document.createElement('button');
  launch.className = 'omp-launch';
  launch.type = 'button';
  launch.setAttribute('aria-label', 'Open the term glossary (press slash)');
  launch.innerHTML = '<span aria-hidden="true">✦</span> Terms <kbd class="omp-lk">/</kbd>';

  var overlay = document.createElement('div');
  overlay.className = 'omp-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Glossary of terms used on this page');
  overlay.innerHTML =
    '<div class="omp-panel">' +
      '<div class="omp-search">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<input type="text" autocomplete="off" spellcheck="false" placeholder="Filter terms on this page…" aria-label="Filter terms">' +
        '<span class="omp-count"></span>' +
      '</div>' +
      '<ul class="omp-list" role="listbox"></ul>' +
      '<div class="omp-detail" hidden>' +
        '<p class="dt"></p><p class="dd"></p>' +
        '<div class="hint"><span><b>↑ ↓</b> browse</span><span><b>↵</b> jump to it</span><span><b>esc</b> close</span></div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(launch);
  document.body.appendChild(overlay);

  /* keep the launcher clear of any bottom-fixed bar (e.g. the audio player) */
  function placeLauncher() {
    var inset = 0, bars = document.querySelectorAll('.player,[data-omp-bottombar]');
    for (var i = 0; i < bars.length; i++) {
      var cs = getComputedStyle(bars[i]);
      if (cs.position !== 'fixed') continue;
      var r = bars[i].getBoundingClientRect();
      if (r.height && r.bottom >= window.innerHeight - 6 && r.width > window.innerWidth * 0.4) {
        inset = Math.max(inset, r.height);
      }
    }
    launch.style.bottom = (inset ? inset + 14 : 18) + 'px';
  }
  placeLauncher();
  window.addEventListener('resize', placeLauncher);

  var input = overlay.querySelector('input');
  var listEl = overlay.querySelector('.omp-list');
  var countEl = overlay.querySelector('.omp-count');
  var detail = overlay.querySelector('.omp-detail');
  var dtEl = overlay.querySelector('.omp-detail .dt');
  var ddEl = overlay.querySelector('.omp-detail .dd');

  var filtered = TERMS.slice();
  var sel = 0;
  var lastFocus = null;

  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function hilite(text, q) {
    if (!q) return esc(text);
    var i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }

  function render() {
    var q = input.value.trim();
    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = '<li class="omp-empty">No terms match “' + esc(q) + '”.</li>';
      countEl.textContent = '0';
      detail.hidden = true;
      return;
    }
    countEl.textContent = filtered.length + (filtered.length === 1 ? ' term' : ' terms');
    for (var i = 0; i < filtered.length; i++) {
      var t = filtered[i];
      var li = document.createElement('li');
      li.className = 'omp-item' + (i === sel ? ' sel' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === sel ? 'true' : 'false');
      li.dataset.i = i;
      li.innerHTML = '<div class="t">' + hilite(t.term, q) + '</div><div class="d">' + esc(t.def) + '</div>';
      listEl.appendChild(li);
    }
    showDetail();
    var selEl = listEl.children[sel];
    if (selEl && selEl.scrollIntoView) selEl.scrollIntoView({ block: 'nearest' });
  }

  function showDetail() {
    var t = filtered[sel];
    if (!t) { detail.hidden = true; return; }
    detail.hidden = false;
    dtEl.textContent = t.term;
    ddEl.textContent = t.def;
  }

  function applyFilter() {
    var q = input.value.trim().toLowerCase();
    filtered = !q ? TERMS.slice() : TERMS.filter(function (t) {
      return t.term.toLowerCase().indexOf(q) >= 0 || t.def.toLowerCase().indexOf(q) >= 0;
    });
    // rank exact/prefix matches on the term first
    if (q) {
      filtered.sort(function (a, b) {
        var ap = a.term.toLowerCase().indexOf(q), bp = b.term.toLowerCase().indexOf(q);
        ap = ap < 0 ? 99 : ap; bp = bp < 0 ? 99 : bp;
        if (ap !== bp) return ap - bp;
        return a.term.length - b.term.length;
      });
    }
    sel = 0;
    render();
  }

  function move(d) {
    if (!filtered.length) return;
    sel = (sel + d + filtered.length) % filtered.length;
    render();
  }

  function jump() {
    var t = filtered[sel];
    if (!t) return;
    close();
    var node = t.node || findFirst(t.term);
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
      node.classList.remove('omp-flash');
      // reflow so the animation restarts if re-triggered
      void node.offsetWidth;
      node.classList.add('omp-flash');
      setTimeout(function () { node.classList.remove('omp-flash'); }, 1700);
    }
  }

  function open() {
    if (overlay.classList.contains('open')) return;
    lastFocus = document.activeElement;
    overlay.classList.add('open');
    input.value = '';
    applyFilter();
    input.focus();
  }
  function close() {
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---- events ------------------------------------------------------------ */
  launch.addEventListener('click', open);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  listEl.addEventListener('mousemove', function (e) {
    var li = e.target.closest ? e.target.closest('.omp-item') : null;
    if (li && +li.dataset.i !== sel) { sel = +li.dataset.i; render(); }
  });
  listEl.addEventListener('click', function (e) {
    var li = e.target.closest ? e.target.closest('.omp-item') : null;
    if (li) { sel = +li.dataset.i; jump(); }
  });

  input.addEventListener('input', applyFilter);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); jump(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  function typingInField(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  document.addEventListener('keydown', function (e) {
    var openKey = (e.key === '/' && !typingInField(document.activeElement)) ||
                  ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'));
    if (openKey) {
      e.preventDefault();
      overlay.classList.contains('open') ? close() : open();
    } else if (e.key === 'Escape' && overlay.classList.contains('open')) {
      e.preventDefault();
      close();
    }
  });
})();
