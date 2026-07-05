/* ============================================================================
   GameCube Homebrew — interactive layer
   Everything on this page is simulated in your browser: the "GameCube screen"
   is a canvas drawing, the build pipeline is an animation, the DOL file is a
   synthetic one generated below, and the frame-budget game runs on
   requestAnimationFrame standing in for VIDEO_WaitVSync(). No Nintendo code,
   tools or assets are involved anywhere on this page.
   ============================================================================ */
'use strict';

/* ------------------------------------------------------------- helpers */

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* devicePixelRatio-aware canvas sizing (CSS height fixed in the stylesheet) */
function labCanvas(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let onResize = null;
  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (onResize) onResize();
  }
  resize();
  window.addEventListener('resize', resize);
  return {
    c, dpr,
    get W() { return canvas.width; },
    get H() { return canvas.height; },
    set onresize(fn) { onResize = fn; },
  };
}

/* pause off-screen animations */
function watchVisibility(el) {
  const state = { visible: true };
  if ('IntersectionObserver' in window) {
    state.visible = false;
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { state.visible = e.isIntersecting; }),
      { rootMargin: '120px' }
    );
    io.observe(el);
  }
  return state;
}

/* palette (mirrors the CSS custom properties) */
const PAL = {
  cyan: '#45e4d1', violet: '#a884ff', magenta: '#ff5f9e', amber: '#ffb14e',
  good: '#5fd18b', bad: '#ff6a6a', ink: '#ece8f6', ink2: '#b7afce',
  muted: '#877f9e', line: '#2c2542', line2: '#392f57',
  panel: '#16121f', panel2: '#1d1830', ground: '#0c0a13',
};

function grid(c, W, H, cols, rows) {
  c.strokeStyle = 'rgba(90,78,130,0.16)';
  c.lineWidth = 1;
  for (let i = 1; i < cols; i++) { const x = W * i / cols; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let i = 1; i < rows; i++) { const y = H * i / rows; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
}

/* ==========================================================================
   Hero ambient — toolchain tokens drifting like a build log at 2 a.m.
   ========================================================================== */
function heroAmbient(canvas) {
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(canvas);
  const TOKENS = [
    'powerpc-eabi-gcc', 'make', 'elf2dol', '.dol', '.elf', 'libogc',
    '-mogc -mcpu=750', 'VIDEO_WaitVSync()', '0x80003100', 'main.c',
    'PAD_ScanPads()', 'GX_Init()', 'console_init()', 'dkp-pacman -S gamecube-dev',
  ];
  const parts = TOKENS.map((t, i) => ({
    t,
    x: Math.random(), y: Math.random(),
    v: 0.006 + Math.random() * 0.012,
    s: 10 + (i % 3) * 2,
    a: 0.10 + Math.random() * 0.16,
  }));
  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    parts.forEach(p => {
      if (!REDUCE_MOTION) { p.y -= p.v * dt; if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); } }
      c.font = `600 ${p.s * dpr}px ui-monospace, Menlo, monospace`;
      c.fillStyle = `rgba(95,209,139,${p.a})`;
      c.fillText(p.t, p.x * W, p.y * H);
    });
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 05 — "your first frame": a mock GameCube console screen.
   Replays the hello-world boot sequence: VIDEO_Init (black), console_init
   (the text console appears in the XFB), printf, then the WaitVSync loop
   counting frames until START "exits to the loader".
   ========================================================================== */
function XfbLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const input = root.querySelector('[data-xfb-text]');
  const runBtn = root.querySelector('[data-xfb-run]');
  const startBtn = root.querySelector('[data-xfb-start]');
  const frameRO = root.querySelector('[data-xfb-frames]');
  const stateRO = root.querySelector('[data-xfb-state]');

  // phases: off → video-init → console → print → loop → exited
  let phase = 'off';
  let t = 0;            // seconds within phase
  let frames = 0;       // vsyncs since the loop began
  let printed = 0;      // characters printed so far

  function msg() { return (input.value || 'Hello, world!').slice(0, 38); }

  function setPhase(p) { phase = p; t = 0; if (p === 'loop') frames = 0; }

  runBtn.addEventListener('click', () => { printed = 0; setPhase('video-init'); });
  startBtn.addEventListener('click', () => { if (phase === 'loop') setPhase('exited'); });
  input.addEventListener('input', () => { if (phase === 'loop' || phase === 'print') { printed = 0; setPhase('print'); } });

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    t += dt;

    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);

    // the "TV": a 4:3 screen centred in the canvas
    const sh = H * 0.92, sw = Math.min(W * 0.94, sh * 4 / 3);
    const sx = (W - sw) / 2, sy = (H - sh) / 2;
    c.fillStyle = '#05040a';
    c.strokeStyle = PAL.line2; c.lineWidth = 2 * dpr;
    roundRect(c, sx, sy, sw, sh, 10 * dpr); c.fill(); c.stroke();

    const pad = 18 * dpr;
    const fs = Math.max(10, sw / 42);
    c.font = `500 ${fs}px ui-monospace, Menlo, monospace`;
    const line = (s, row, col, color) => {
      c.fillStyle = color || '#cfeadf';
      c.fillText(s, sx + pad + (col || 0) * fs * 0.62, sy + pad + fs * 1.5 * (row + 1));
    };

    if (phase === 'off') {
      c.fillStyle = PAL.muted;
      c.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
      c.textAlign = 'center';
      c.fillText('◦ press “power on & run” to boot the program ◦', W / 2, H / 2);
      c.textAlign = 'left';
    } else if (phase === 'video-init') {
      // VIDEO_Init + VIDEO_Configure: black frame(s), nothing visible yet
      line('', 0, 0);
      if (t > 0.9) setPhase('console');
    } else if (phase === 'console') {
      // console_init: the text console now owns the XFB — cursor appears
      if (Math.floor(t * 2.5) % 2 === 0) line('_', 1, 0, PAL.good);
      if (t > 1.1) setPhase('print');
    } else if (phase === 'print' || phase === 'loop' || phase === 'exited') {
      // printf("\x1b[2;0H"); printf(message) — one character per frame-ish
      const m = msg();
      if (phase === 'print') {
        printed = Math.min(m.length, printed + dt * 30);
        if (printed >= m.length) setPhase('loop');
      }
      line(m.slice(0, Math.floor(phase === 'print' ? printed : m.length)), 1, 0, '#e8fff2');
      if (phase === 'loop') {
        frames += dt * 60;
        line('frames since boot: ' + Math.floor(frames), 3, 0, PAL.muted);
        line('press START to exit', 5, 0, PAL.muted);
        if (Math.floor(t * 2.5) % 2 === 0) line('_', 6, 0, PAL.good);
      }
      if (phase === 'exited') {
        line('exit(0) — returning to loader...', 3, 0, PAL.amber);
      }
    }

    // faint interlace scanlines over the "screen"
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = sy; y < sy + sh; y += 3 * dpr) c.fillRect(sx, y, sw, dpr);

    if (frameRO) frameRO.textContent = phase === 'loop' ? String(Math.floor(frames)) : (phase === 'exited' ? 'stopped' : '—');
    if (stateRO) stateRO.textContent = {
      off: 'powered off', 'video-init': 'VIDEO_Init()…', console: 'console_init()…',
      print: 'printf()…', loop: 'while(1) WaitVSync', exited: 'exit(0)',
    }[phase];
  }
  raf = requestAnimationFrame(frame);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ==========================================================================
   Lab 06a — the build pipeline: main.c → .o → .elf → .dol, animated.
   ========================================================================== */
function BuildLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const STAGES = [
    { file: 'main.c',    size: '1.2 KB',  tool: 'gcc -c',       desc: 'your C source — compiled to PowerPC machine code by powerpc-eabi-gcc, one object file per source file' },
    { file: 'main.o',    size: '3.5 KB',  tool: 'ld + libogc',  desc: 'relocatable object code — linked with crt0 startup code and libogc into one program' },
    { file: 'hello.elf', size: '412 KB',  tool: 'elf2dol',      desc: 'a full ELF executable with symbols & debug info — Dolphin loads this directly; elf2dol strips it for the console' },
    { file: 'hello.dol', size: '86 KB',   tool: null,           desc: 'the finished DOL: a 256-byte header plus raw sections — the same format every retail game’s main executable uses' },
  ];
  let stage = 0;         // which artefact currently exists (0..3)
  let anim = 0;          // 0..1 progress of the token flying to the next box
  let running = false;

  const stepBtn = root.querySelector('[data-build-step]');
  const runBtn = root.querySelector('[data-build-run]');
  const resetBtn = root.querySelector('[data-build-reset]');
  const stageRO = root.querySelector('[data-build-stage]');
  const sizeRO = root.querySelector('[data-build-size]');

  function advance() { if (stage < STAGES.length - 1 && anim === 0) anim = 0.0001; }
  stepBtn.addEventListener('click', () => { running = false; advance(); });
  runBtn.addEventListener('click', () => { running = true; advance(); });
  resetBtn.addEventListener('click', () => { running = false; stage = 0; anim = 0; });

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;

    if (anim > 0) {
      anim += dt * (REDUCE_MOTION ? 6 : 1.1);
      if (anim >= 1) {
        anim = 0; stage++;
        if (running && stage < STAGES.length - 1) anim = 0.0001;
      }
    }

    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 8, 3);

    const n = STAGES.length;
    const bw = Math.min(150 * dpr, (W - 40 * dpr) / n - 26 * dpr);
    const gap = (W - n * bw) / (n + 1);
    const by = H * 0.30, bh = H * 0.34;

    STAGES.forEach((s, i) => {
      const x = gap + i * (bw + gap);
      const built = i <= stage;
      c.fillStyle = built ? PAL.panel2 : PAL.panel;
      c.strokeStyle = built ? PAL.good : PAL.line2;
      c.lineWidth = (built ? 1.8 : 1.2) * dpr;
      roundRect(c, x, by, bw, bh, 9 * dpr); c.fill(); c.stroke();
      c.textAlign = 'center';
      c.font = `700 ${12.5 * dpr}px ui-monospace, Menlo, monospace`;
      c.fillStyle = built ? PAL.ink : PAL.muted;
      c.fillText(s.file, x + bw / 2, by + bh * 0.42);
      c.font = `600 ${10 * dpr}px ui-monospace, Menlo, monospace`;
      c.fillStyle = built ? PAL.good : '#4a4360';
      c.fillText(built ? s.size : '· · ·', x + bw / 2, by + bh * 0.72);
      // arrow + tool label between boxes
      if (i < n - 1) {
        const ax0 = x + bw + 6 * dpr, ax1 = x + bw + gap - 6 * dpr, ay = by + bh / 2;
        c.strokeStyle = i < stage ? PAL.good : PAL.line2;
        c.lineWidth = 1.6 * dpr;
        c.beginPath(); c.moveTo(ax0, ay); c.lineTo(ax1 - 6 * dpr, ay); c.stroke();
        c.beginPath(); c.moveTo(ax1, ay); c.lineTo(ax1 - 7 * dpr, ay - 4.5 * dpr); c.lineTo(ax1 - 7 * dpr, ay + 4.5 * dpr); c.closePath();
        c.fillStyle = i < stage ? PAL.good : PAL.line2; c.fill();
        c.font = `600 ${9.5 * dpr}px ui-monospace, Menlo, monospace`;
        c.fillStyle = i === stage && anim > 0 ? PAL.cyan : PAL.muted;
        // label sits in the clear band above the boxes so it never collides
        c.fillText(STAGES[i].tool, (ax0 + ax1) / 2, by - 14 * dpr);
        // the flying token
        if (i === stage && anim > 0) {
          const tx = ax0 + (ax1 - ax0) * anim;
          c.fillStyle = PAL.cyan;
          c.beginPath(); c.arc(tx, ay, 4.5 * dpr, 0, Math.PI * 2); c.fill();
        }
      }
      c.textAlign = 'left';
    });

    // caption under the row
    c.font = `500 ${11 * dpr}px ui-monospace, Menlo, monospace`;
    c.fillStyle = PAL.ink2;
    c.textAlign = 'center';
    wrapText(c, STAGES[stage].desc, W / 2, by + bh + 26 * dpr, W - 60 * dpr, 15 * dpr);
    c.textAlign = 'left';

    if (stageRO) stageRO.textContent = STAGES[stage].file;
    if (sizeRO) sizeRO.textContent = STAGES[stage].size;
  }
  raf = requestAnimationFrame(frame);
}

function wrapText(c, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let lineTxt = '';
  for (const w of words) {
    const test = lineTxt ? lineTxt + ' ' + w : w;
    if (c.measureText(test).width > maxW && lineTxt) { c.fillText(lineTxt, x, y); lineTxt = w; y += lh; }
    else lineTxt = test;
  }
  if (lineTxt) c.fillText(lineTxt, x, y);
}

/* ==========================================================================
   Lab 06b — DOL header inspector. We synthesise a plausible hello.dol
   header (one text section, two data sections, bss, entry point) and let
   you click each field group to see which bytes it owns and what they say.
   ========================================================================== */
function DolLab(root) {
  const hexEl = root.querySelector('[data-dol-hex]');
  const fieldsEl = root.querySelector('[data-dol-fields]');
  const decodeEl = root.querySelector('[data-dol-decode]');

  // --- synthesise the 256-byte header -----------------------------------
  const bytes = new Uint8Array(0x100);
  const putU32 = (off, v) => {
    bytes[off] = (v >>> 24) & 0xff; bytes[off + 1] = (v >>> 16) & 0xff;
    bytes[off + 2] = (v >>> 8) & 0xff; bytes[off + 3] = v & 0xff;
  };
  // section table: [fileOffset, loadAddress, size]
  const text = [[0x00000100, 0x80003100, 0x00012f80]];               // .init+.text
  const data = [[0x00013080, 0x80016080, 0x00001a40],                // .rodata
                [0x00014ac0, 0x80017ac0, 0x00000c20]];               // .data+.sdata
  text.forEach((s, i) => { putU32(0x00 + i * 4, s[0]); putU32(0x48 + i * 4, s[1]); putU32(0x90 + i * 4, s[2]); });
  data.forEach((s, i) => { putU32(0x1c + i * 4, s[0]); putU32(0x64 + i * 4, s[1]); putU32(0xac + i * 4, s[2]); });
  putU32(0xd8, 0x800186e0);   // bss address
  putU32(0xdc, 0x0000f4a0);   // bss size
  putU32(0xe0, 0x80003100);   // entry point (_start, first byte of .init)

  const hx = (v, w) => '0x' + v.toString(16).toUpperCase().padStart(w || 8, '0');
  const rd = off => ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;

  const FIELDS = [
    { a: 0x00, b: 0x1c, name: 'Text offsets ×7',
      d: () => `Where each <b>code</b> section starts <b>inside the file</b>. Slot 0 = <code>${hx(rd(0))}</code> — the code begins right after this 256-byte header. Unused slots stay zero: this program has 1 of its 7 text slots filled.` },
    { a: 0x1c, b: 0x48, name: 'Data offsets ×11',
      d: () => `File offsets of the <b>data</b> sections. Slot 0 (read-only data) = <code>${hx(rd(0x1c))}</code>, slot 1 (initialised variables) = <code>${hx(rd(0x20))}</code>; the other 9 slots are unused zeros.` },
    { a: 0x48, b: 0x64, name: 'Text addresses ×7',
      d: () => `Where each code section must be <b>copied to in RAM</b>. Slot 0 = <code>${hx(rd(0x48))}</code> — just past the reserved low pages of MEM1, the classic load address for GameCube executables.` },
    { a: 0x64, b: 0x90, name: 'Data addresses ×11',
      d: () => `RAM destinations for the data sections: <code>${hx(rd(0x64))}</code> and <code>${hx(rd(0x68))}</code>, laid out directly after the code.` },
    { a: 0x90, b: 0xac, name: 'Text sizes ×7',
      d: () => `Byte counts to copy. Code section 0 is <code>${hx(rd(0x90))}</code> = ${(rd(0x90) / 1024).toFixed(1)} KB of PowerPC machine code (most of it is libogc, not your 20 lines!).` },
    { a: 0xac, b: 0xd8, name: 'Data sizes ×11',
      d: () => `Sizes of the data sections: ${(rd(0xac) / 1024).toFixed(1)} KB of constants and ${(rd(0xb0) / 1024).toFixed(1)} KB of initialised variables.` },
    { a: 0xd8, b: 0xdc, name: 'BSS address',
      d: () => `<b>BSS</b> = zero-initialised variables. They occupy no file space at all — the loader just zeroes <code>${hx(rd(0xdc))}</code> bytes of RAM starting at <code>${hx(rd(0xd8))}</code>. That’s why the DOL is smaller than the memory image it creates.` },
    { a: 0xdc, b: 0xe0, name: 'BSS size',
      d: () => `${(rd(0xdc) / 1024).toFixed(1)} KB of RAM to clear — your global arrays, libogc’s heaps and buffers.` },
    { a: 0xe0, b: 0xe4, name: 'Entry point',
      d: () => `The address the loader <b>jumps to</b> once every section is in place: <code>${hx(rd(0xe0))}</code> — the first instruction of crt0’s <code>_start</code>, which sets up the stack and calls your <code>main()</code>.` },
    { a: 0xe4, b: 0x100, name: 'Padding',
      d: () => `28 unused bytes, defined to be zero. The header is exactly 0x100 = 256 bytes; the first section’s file offset points to the byte right after it.` },
  ];

  // --- render the hex grid ----------------------------------------------
  const cells = [];
  for (let row = 0; row < 16; row++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    const off = document.createElement('span');
    off.className = 'off';
    off.textContent = '0x' + (row * 16).toString(16).toUpperCase().padStart(2, '0');
    rowEl.appendChild(off);
    for (let colIdx = 0; colIdx < 16; colIdx++) {
      const i = row * 16 + colIdx;
      const b = document.createElement('span');
      b.className = 'b' + (bytes[i] === 0 ? ' dim' : '');
      b.textContent = bytes[i].toString(16).toUpperCase().padStart(2, '0');
      rowEl.appendChild(b);
      cells.push(b);
    }
    hexEl.appendChild(rowEl);
  }

  // --- field buttons ------------------------------------------------------
  let onBtn = null;
  FIELDS.forEach(f => {
    const btn = document.createElement('button');
    btn.innerHTML = `<span class="rng">${hx(f.a, 2)}–${hx(f.b - 1, 2)}</span><span>${f.name}</span>`;
    btn.addEventListener('click', () => {
      if (onBtn) onBtn.classList.remove('on');
      onBtn = btn; btn.classList.add('on');
      cells.forEach((cel, i) => cel.classList.toggle('hi', i >= f.a && i < f.b));
      decodeEl.innerHTML = f.d();
    });
    fieldsEl.appendChild(btn);
  });
  // start with the entry point selected — the most story-rich field
  fieldsEl.children[8].click();
}

/* ==========================================================================
   Lab 09 — YUY2 pixel-pair encoder: two RGB pixels in, four bytes out.
   ========================================================================== */
function YuyLab(root) {
  const inA = root.querySelector('[data-yuy-a]');
  const inB = root.querySelector('[data-yuy-b]');
  const outEl = root.querySelector('[data-yuy-out]');
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);

  const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const clamp8 = v => Math.max(0, Math.min(255, Math.round(v)));
  // BT.601 "video range" transforms — the flavour the VI hardware speaks
  const toY = ([r, g, b]) => clamp8(0.257 * r + 0.504 * g + 0.098 * b + 16);
  const toU = ([r, g, b]) => clamp8(-0.148 * r - 0.291 * g + 0.439 * b + 128);
  const toV = ([r, g, b]) => clamp8(0.439 * r - 0.368 * g - 0.071 * b + 128);
  const fromYUV = (y, u, v) => {
    const yy = 1.164 * (y - 16), uu = u - 128, vv = v - 128;
    return [clamp8(yy + 1.596 * vv), clamp8(yy - 0.392 * uu - 0.813 * vv), clamp8(yy + 2.017 * uu)];
  };

  function render() {
    const A = hex2rgb(inA.value), B = hex2rgb(inB.value);
    const y0 = toY(A), y1 = toY(B);
    const u = clamp8((toU(A) + toU(B)) / 2);   // chroma is shared by the pair
    const v = clamp8((toV(A) + toV(B)) / 2);
    const hx = n => n.toString(16).toUpperCase().padStart(2, '0');
    outEl.innerHTML =
      `<span class="readout">Y₀ <b>${hx(y0)}</b></span><span class="readout">U <b>${hx(u)}</b></span>` +
      `<span class="readout">Y₁ <b>${hx(y1)}</b></span><span class="readout">V <b>${hx(v)}</b></span>`;

    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const A2 = fromYUV(y0, u, v), B2 = fromYUV(y1, u, v);
    const half = W / 2, ph = H * 0.62, py = H * 0.08;
    const draw = (x, w, rgb) => { c.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; c.fillRect(x, py, w, ph); };
    // left half: the two pixels as you asked for them
    draw(W * 0.04, half * 0.42, A); draw(W * 0.04 + half * 0.42, half * 0.42, B);
    // right half: what the pair looks like after the YUY2 round trip
    draw(half + W * 0.04, half * 0.42, A2); draw(half + W * 0.04 + half * 0.42, half * 0.42, B2);
    c.strokeStyle = PAL.line2; c.lineWidth = dpr;
    c.strokeRect(W * 0.04, py, half * 0.84, ph);
    c.strokeRect(half + W * 0.04, py, half * 0.84, ph);
    c.font = `600 ${10.5 * dpr}px ui-monospace, Menlo, monospace`;
    c.fillStyle = PAL.muted;
    c.fillText('RGB, as you chose them', W * 0.04, H * 0.9);
    c.fillText('after the YUY2 round trip (shared chroma)', half + W * 0.04, H * 0.9);
  }
  inA.addEventListener('input', render);
  inB.addEventListener('input', render);
  render();
}

/* ==========================================================================
   Lab 08 — controller tester. Keyboard (or a connected gamepad via the
   Gamepad API) drives a drawn GameCube pad, and we show exactly what
   PAD_ButtonsHeld(0) would return: the live 16-bit mask.
   ========================================================================== */
function PadLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const maskRO = root.querySelector('[data-pad-mask]');
  const binRO = root.querySelector('[data-pad-bin]');
  const namesRO = root.querySelector('[data-pad-names]');
  const stickRO = root.querySelector('[data-pad-stick]');

  // the real libogc bit assignments (gccore.h / pad.h)
  const BITS = {
    LEFT: 0x0001, RIGHT: 0x0002, DOWN: 0x0004, UP: 0x0008,
    Z: 0x0010, R: 0x0020, L: 0x0040,
    A: 0x0100, B: 0x0200, X: 0x0400, Y: 0x0800, START: 0x1000,
  };
  const KEYMAP = {
    KeyX: 'A', KeyZ: 'B', KeyS: 'X', KeyD: 'Y', Enter: 'START',
    KeyQ: 'L', KeyW: 'R', KeyE: 'Z',
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  };

  const held = new Set();
  let stickX = 0, stickY = 0;          // -100..100, keyboard-driven analog

  window.addEventListener('keydown', e => {
    const b = KEYMAP[e.code];
    if (!b) return;
    // only capture keys while the lab is on screen, so the page stays usable
    if (!vis.visible) return;
    e.preventDefault();
    held.add(b);
  });
  window.addEventListener('keyup', e => {
    const b = KEYMAP[e.code];
    if (b) held.delete(b);
  });

  function pollGamepad() {
    if (!navigator.getGamepads) return;
    const gp = [...navigator.getGamepads()].find(g => g && g.connected);
    if (!gp) return;
    // approximate standard-mapping → GC translation
    const map = [['A', 0], ['B', 1], ['X', 2], ['Y', 3], ['L', 4], ['R', 5], ['Z', 7], ['START', 9], ['UP', 12], ['DOWN', 13], ['LEFT', 14], ['RIGHT', 15]];
    map.forEach(([name, idx]) => {
      const btn = gp.buttons[idx];
      if (btn && btn.pressed) { held.add(name); gpHeld.add(name); }
      else if (gpHeld.has(name)) { held.delete(name); gpHeld.delete(name); }
    });
    if (gp.axes.length >= 2 && (Math.abs(gp.axes[0]) > 0.12 || Math.abs(gp.axes[1]) > 0.12)) {
      stickX = Math.round(gp.axes[0] * 100);
      stickY = Math.round(-gp.axes[1] * 100);
    }
  }
  const gpHeld = new Set();   // buttons currently held via a gamepad

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;

    pollGamepad();
    // keyboard "analog": arrows also nudge the main stick toward its rails
    const tx = (held.has('RIGHT') ? 100 : 0) + (held.has('LEFT') ? -100 : 0);
    const ty = (held.has('UP') ? 100 : 0) + (held.has('DOWN') ? -100 : 0);
    stickX += (tx - stickX) * Math.min(1, dt * 14);
    stickY += (ty - stickY) * Math.min(1, dt * 14);

    let mask = 0;
    held.forEach(b => { mask |= BITS[b]; });

    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);

    // --- controller body ---------------------------------------------------
    const cx = W / 2, cy = H * 0.56;
    const u = Math.min(W, H * 1.6) / 560; // unit scale
    c.save();
    c.translate(cx, cy);

    // body silhouette (three lobes)
    c.fillStyle = PAL.panel2;
    c.strokeStyle = PAL.line2; c.lineWidth = 2 * dpr;
    c.beginPath();
    c.ellipse(-170 * u, 0, 78 * u, 96 * u, 0, 0, Math.PI * 2);
    c.ellipse(170 * u, 0, 78 * u, 96 * u, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath(); c.rect(-180 * u, -70 * u, 360 * u, 130 * u); c.fill();
    c.beginPath();
    c.ellipse(-170 * u, 0, 78 * u, 96 * u, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath();
    c.ellipse(170 * u, 0, 78 * u, 96 * u, 0, 0, Math.PI * 2); c.stroke();

    const btn = (x, y, r, on, color, label, lw) => {
      c.beginPath(); c.arc(x * u, y * u, r * u, 0, Math.PI * 2);
      c.fillStyle = on ? color : PAL.panel;
      c.fill();
      c.strokeStyle = on ? color : PAL.line2; c.lineWidth = (lw || 1.6) * dpr; c.stroke();
      if (label) {
        c.fillStyle = on ? '#10240f' : PAL.muted;
        c.font = `700 ${Math.max(9, r * 0.9 * u / dpr) * dpr}px ui-monospace, Menlo, monospace`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(label, x * u, y * u + u);
        c.textBaseline = 'alphabetic'; c.textAlign = 'left';
      }
    };

    // main stick (left lobe) — moves with the analog value
    c.beginPath(); c.arc(-170 * u, -28 * u, 34 * u, 0, Math.PI * 2);
    c.fillStyle = PAL.ground; c.fill(); c.strokeStyle = PAL.line2; c.stroke();
    const sxp = -170 + stickX * 0.14, syp = -28 - stickY * 0.14;
    btn(sxp, syp, 20, Math.abs(stickX) > 8 || Math.abs(stickY) > 8, PAL.cyan, '');

    // d-pad (left lobe, lower)
    const dp = 58;
    btn(-170, dp - 16, 9, held.has('UP'), PAL.good, '▲');
    btn(-170, dp + 16, 9, held.has('DOWN'), PAL.good, '▼');
    btn(-186, dp, 9, held.has('LEFT'), PAL.good, '◀');
    btn(-154, dp, 9, held.has('RIGHT'), PAL.good, '▶');

    // A/B/X/Y cluster (right lobe)
    btn(170, -20, 26, held.has('A'), PAL.good, 'A');
    btn(126, 16, 14, held.has('B'), PAL.bad, 'B');
    btn(216, -44, 13, held.has('X'), PAL.ink2, 'X');
    btn(140, -62, 13, held.has('Y'), PAL.ink2, 'Y');

    // c-stick (right lobe, lower) — static, just for looks
    btn(170, 62, 15, false, PAL.amber, 'C');

    // START (centre)
    btn(0, -16, 12, held.has('START'), PAL.ink2, 'S');

    // triggers along the top
    const trig = (x, on, label) => {
      c.fillStyle = on ? PAL.violet : PAL.panel;
      c.strokeStyle = on ? PAL.violet : PAL.line2; c.lineWidth = 1.6 * dpr;
      roundRect(c, (x - 34) * u, -108 * u, 68 * u, 20 * u, 8 * dpr); c.fill(); c.stroke();
      c.fillStyle = on ? '#171030' : PAL.muted;
      c.font = `700 ${10 * dpr}px ui-monospace, Menlo, monospace`;
      c.textAlign = 'center';
      c.fillText(label, x * u, -94 * u);
      c.textAlign = 'left';
    };
    trig(-150, held.has('L'), 'L');
    trig(150, held.has('R'), 'R');
    // Z sits above R
    c.fillStyle = held.has('Z') ? PAL.violet : PAL.panel;
    c.strokeStyle = held.has('Z') ? PAL.violet : PAL.line2;
    roundRect(c, 108 * u, -132 * u, 84 * u, 16 * u, 7 * dpr); c.fill(); c.stroke();
    c.fillStyle = held.has('Z') ? '#171030' : PAL.muted;
    c.textAlign = 'center';
    c.fillText('Z', 150 * u, -120 * u);
    c.textAlign = 'left';

    c.restore();

    // --- readouts -----------------------------------------------------------
    if (maskRO) maskRO.textContent = '0x' + mask.toString(16).toUpperCase().padStart(4, '0');
    if (binRO) binRO.textContent = mask.toString(2).padStart(13, '0');
    if (namesRO) namesRO.textContent = held.size
      ? [...held].map(b => 'PAD_' + (BITS[b] < 0x100 && 'ZRL'.includes(b) ? 'TRIGGER_' : 'BUTTON_') + (b === 'START' ? 'START' : b)).join(' | ')
      : '0 (nothing held)';
    if (stickRO) stickRO.textContent = `${Math.round(stickX)}, ${Math.round(stickY)}`;
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 11 — the frame budget. A tiny playable game whose loop is the
   canonical  scan → update → draw → WaitVSync  shape. A slider adds
   pretend "work" per frame; blow past 16.7 ms and the loop starts missing
   vsyncs — the game visibly drops to 30 Hz, exactly like real hardware.
   ========================================================================== */
function LoopLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const workR = root.querySelector('[data-loop-work]');
  const workV = root.querySelector('[data-loop-work-val]');
  const fpsRO = root.querySelector('[data-loop-fps]');
  const missRO = root.querySelector('[data-loop-missed]');
  const scoreRO = root.querySelector('[data-loop-score]');

  let workMs = 6;
  workR.addEventListener('input', () => { workMs = parseFloat(workR.value); workV.textContent = workMs.toFixed(0) + ' ms'; });

  // game state (all in 0..1 space)
  const G = {
    px: 0.5,                    // paddle centre
    bx: 0.5, by: 0.35, vx: 0.31, vy: 0.42,
    score: 0, missed: 0, presented: 0, vsyncs: 0,
  };
  let leftHeld = false, rightHeld = false;
  window.addEventListener('keydown', e => {
    if (!vis.visible) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { leftHeld = true; e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { rightHeld = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') leftHeld = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') rightHeld = false;
  });
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    G.px = Math.max(0.08, Math.min(0.92, (e.clientX - r.left) / r.width));
  });

  // one "game update" — the work the console does between two vsyncs
  function update(dt) {
    if (leftHeld) G.px = Math.max(0.08, G.px - dt * 0.9);
    if (rightHeld) G.px = Math.min(0.92, G.px + dt * 0.9);
    G.bx += G.vx * dt; G.by += G.vy * dt;
    if (G.bx < 0.02 || G.bx > 0.98) G.vx *= -1;
    if (G.by < 0.04) G.vy *= -1;
    if (G.by > 0.88 && G.vy > 0 && Math.abs(G.bx - G.px) < 0.09) { G.vy *= -1; G.vx += (G.bx - G.px) * 1.6; G.score++; }
    if (G.by > 1.05) { G.by = 0.2; G.bx = 0.2 + Math.random() * 0.6; G.vy = Math.abs(G.vy); G.score = Math.max(0, G.score - 2); }
  }

  const VSYNC = 1000 / 60;      // 16.67 ms — the NTSC frame budget
  let sinceTick = 0, framesToSkip = 0, fpsWindow = [], raf, last = 0;

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dtms = Math.min(50, ts - last || 16.7);
    last = ts;
    sinceTick += dtms;

    // each elapsed 16.7ms is one vsync; the "game" only presents a frame
    // when its (simulated) work fits in the vsyncs that have passed
    while (sinceTick >= VSYNC) {
      sinceTick -= VSYNC;
      G.vsyncs++;
      if (framesToSkip > 0) { framesToSkip--; G.missed++; continue; }
      const need = Math.max(1, Math.ceil(workMs / VSYNC));   // vsyncs this frame costs
      framesToSkip = need - 1;
      update(need * VSYNC / 1000);                            // catch the sim up
      G.presented++;
      fpsWindow.push(performance.now());
    }
    fpsWindow = fpsWindow.filter(t2 => performance.now() - t2 < 1000);

    // ---- draw ----
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);

    // playfield
    c.strokeStyle = PAL.line2; c.lineWidth = dpr;
    c.strokeRect(1, 1, W - 2, H * 0.94 - 2);
    c.fillStyle = PAL.cyan;
    c.beginPath(); c.arc(G.bx * W, G.by * H * 0.94, 7 * dpr, 0, Math.PI * 2); c.fill();
    c.fillStyle = PAL.good;
    roundRect(c, (G.px - 0.08) * W, H * 0.88, 0.16 * W, 8 * dpr, 4 * dpr); c.fill();

    // frame-time meter along the bottom: work vs the 16.7 ms budget
    const my = H * 0.955, mh = H * 0.035;
    const budgetW = W * 0.55;
    c.fillStyle = PAL.panel2;
    c.fillRect(0, my, W, mh);
    const frac = Math.min(2.2, workMs / VSYNC);
    c.fillStyle = workMs <= VSYNC ? PAL.good : PAL.bad;
    c.fillRect(0, my, budgetW * frac / 1, mh);
    c.strokeStyle = PAL.ink; c.lineWidth = dpr * 1.4;
    c.beginPath(); c.moveTo(budgetW, my - 2 * dpr); c.lineTo(budgetW, my + mh + 2 * dpr); c.stroke();
    c.font = `600 ${9.5 * dpr}px ui-monospace, Menlo, monospace`;
    c.fillStyle = PAL.muted;
    c.fillText('work per frame', 6 * dpr, my + mh - 4 * dpr);
    c.fillStyle = PAL.ink2;
    c.fillText('16.7 ms budget', budgetW + 8 * dpr, my + mh - 4 * dpr);

    if (fpsRO) {
      const fps = fpsWindow.length;
      fpsRO.textContent = fps + ' fps';
      fpsRO.parentElement.classList.toggle('bad', fps < 45);
      fpsRO.parentElement.classList.toggle('good', fps >= 55);
    }
    if (missRO) missRO.textContent = String(G.missed);
    if (scoreRO) scoreRO.textContent = String(G.score);
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Widgets: OS tabs, copy buttons, checklists
   ========================================================================== */
function initOsTabs() {
  document.querySelectorAll('.os-tabs').forEach(tabs => {
    const btns = [...tabs.querySelectorAll('.tab-row button')];
    const panels = [...tabs.querySelectorAll('.tab-panel')];
    btns.forEach((b, i) => b.addEventListener('click', () => {
      btns.forEach(x => x.classList.remove('on'));
      panels.forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      panels[i].classList.add('on');
    }));
    // preselect the visitor's own OS when we can guess it
    const plat = (navigator.platform || '') + ' ' + navigator.userAgent;
    let idx = 0; // windows first by default
    if (/Mac/i.test(plat)) idx = 1;
    else if (/Linux|X11/i.test(plat) && !/Android/i.test(plat)) idx = 2;
    if (btns[idx]) btns[idx].click();
  });
}

function initCopyButtons() {
  document.querySelectorAll('.code').forEach(block => {
    const btn = block.querySelector('.copy');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const pre = block.querySelector('pre');
      // copy the visible text, minus any "$ " prompt decorations
      const text = pre.innerText.split('\n').map(l => l.replace(/^\$ /, '')).join('\n').trim();
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'copied ✓'; btn.classList.add('ok');
        setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('ok'); }, 1600);
      } catch { btn.textContent = 'select & copy manually'; }
    });
  });
}

function initChecklists() {
  document.querySelectorAll('.checklist input[type=checkbox]').forEach(cb => {
    const key = 'gchb-' + cb.id;
    try { if (localStorage.getItem(key) === '1') { cb.checked = true; cb.closest('label').classList.add('done'); } } catch {}
    cb.addEventListener('change', () => {
      cb.closest('label').classList.toggle('done', cb.checked);
      try { localStorage.setItem(key, cb.checked ? '1' : '0'); } catch {}
    });
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const heroCanvas = document.getElementById('hero-tokens');
  if (heroCanvas) heroAmbient(heroCanvas);

  const xf = document.getElementById('lab-xfb'); if (xf) XfbLab(xf);
  const bl = document.getElementById('lab-build'); if (bl) BuildLab(bl);
  const dl = document.getElementById('lab-dol'); if (dl) DolLab(dl);
  const yl = document.getElementById('lab-yuy'); if (yl) YuyLab(yl);
  const pl = document.getElementById('lab-pad'); if (pl) PadLab(pl);
  const ll = document.getElementById('lab-loop'); if (ll) LoopLab(ll);

  initOsTabs();
  initCopyButtons();
  initChecklists();
  initTooltips();
  scrollSpy();
  readingProgress();

  const mb = document.getElementById('menu-btn');
  const sb = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const closeMenu = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
  mb.addEventListener('click', () => { sb.classList.toggle('open'); scrim.classList.toggle('show'); });
  scrim.addEventListener('click', closeMenu);
  sb.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
});

/* ------------------------------------------------------- glossary tooltips */
/* Same shared-bubble approach as the sibling courses: every .term with a
   data-tip gets one floating definition bubble on hover/focus/tap.         */
function initTooltips() {
  const terms = [...document.querySelectorAll('.term[data-tip]')];
  if (!terms.length) return;
  const tip = document.createElement('div');
  tip.className = 'tip-bubble';
  document.body.appendChild(tip);
  let current = null;

  function place(el) {
    current = el;
    tip.innerHTML = `<span class="tt">${el.textContent}</span> — ${el.dataset.tip}`;
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const tw = Math.min(340, window.innerWidth - 24);
    tip.style.maxWidth = tw + 'px';
    const tr = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tr.width - 12));
    let top = r.top - tr.height - 10;
    tip.classList.toggle('below', top < 8);
    if (top < 8) top = r.bottom + 10;
    tip.style.left = left + 'px';
    tip.style.top = (top + window.scrollY) + 'px';
    tip.style.setProperty('--arrow-x', (r.left + r.width / 2 - left) + 'px');
  }
  function hide(el) { if (!el || current === el) { tip.classList.remove('show'); current = null; } }

  terms.forEach(el => {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.addEventListener('mouseenter', () => place(el));
    el.addEventListener('mouseleave', () => hide(el));
    el.addEventListener('focus', () => place(el));
    el.addEventListener('blur', () => hide(el));
    el.addEventListener('click', e => { e.stopPropagation(); current === el ? hide(el) : place(el); });
  });
  window.addEventListener('scroll', () => hide(current), true);
  window.addEventListener('resize', () => hide(current));
  document.addEventListener('click', () => hide(current));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(current); });
}

/* ------------------------------------------------------- scroll-spy nav    */
function scrollSpy() {
  const links = [...document.querySelectorAll('.toc a')];
  const map = new Map();
  links.forEach(a => { const id = a.getAttribute('href').slice(1); const el = document.getElementById(id); if (el) map.set(el, a); });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        const a = map.get(e.target); if (a) a.classList.add('active');
      }
    });
  }, { rootMargin: '-20% 0px -72% 0px', threshold: 0 });
  map.forEach((_a, el) => obs.observe(el));
}

/* ------------------------------------------------------- reading progress  */
function readingProgress() {
  const fill = document.getElementById('progress-fill');
  const pct = document.getElementById('pct');
  const links = [...document.querySelectorAll('.toc a')];
  const modules = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  let ticking = false;
  function update() {
    ticking = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const p = max > 0 ? Math.min(1, doc.scrollTop / max) : 0;
    if (fill) fill.style.width = (p * 100).toFixed(1) + '%';
    if (pct) pct.textContent = Math.round(p * 100) + '%';
    const mark = doc.clientHeight * 0.4;
    modules.forEach((el, i) => {
      const top = el.getBoundingClientRect().top;
      if (top < mark) links[i].classList.add('done');
      else links[i].classList.remove('done');
    });
  }
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
}
