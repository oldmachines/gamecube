/* ============================================================================
   GameCube Disc Drive — interactive layer
   Everything you see is simulated in your browser with the Canvas API.
   No game data ships with this page; the labs recreate the drive's
   *behaviour* (laser readout, CLV/CAV spinning, interleaved error correction,
   seeking, stream buffering, image compression, read timing) so you can watch
   the concepts, not the games.
   ============================================================================ */
'use strict';

/* ------------------------------------------------------------- helpers */

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* devicePixelRatio-aware canvas sizing. The CSS height is fixed in the
   stylesheet (see the .scope comment there); we only sync the bitmap. */
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

/* Pause off-screen animations: each lab's rAF loop checks vis.visible and
   skips its drawing work while the lab is scrolled out of view. */
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

/* pointer position in canvas (device-pixel) coordinates */
function canvasPos(canvas, e, dpr) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * dpr,
    y: (e.clientY - r.top) * dpr,
  };
}

/* tiny deterministic pseudo-random generator (the same trick the disc
   mastering tools used for junk — see Module 10) */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
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
   Lab 01 — laser readout: pits & lands scroll under a fixed beam
   ========================================================================== */
function LaserLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  // Build a looping run-length-coded track: runs of 3..11 clock cells, the
  // EFM-family constraint from Module 01. cells[i] = true means "pit".
  const rng = makeRng(20010914);
  const cells = [];
  let level = false;
  while (cells.length < 220) {
    const run = 3 + Math.floor(rng() * 9);
    for (let k = 0; k < run; k++) cells.push(level);
    level = !level;
  }
  const N = cells.length;

  // dust patch: a fixed span of the pattern is contaminated
  const DUST_START = 60, DUST_LEN = 26;
  const dusty = i => { const m = ((i % N) + N) % N; return m >= DUST_START && m < DUST_START + DUST_LEN; };
  const cellAt = i => cells[((i % N) + N) % N];

  let offset = 0;             // scroll position, in cells
  let speed = 1.0;            // cells per frame multiplier
  let dustOn = false;
  let t = 0;

  const speedR = root.querySelector('[data-laser-speed]');
  const speedV = root.querySelector('[data-laser-speed-val]');
  speedR.addEventListener('input', () => {
    speed = parseFloat(speedR.value) / 100;
    speedV.textContent = '×' + speed.toFixed(1);
  });
  root.querySelectorAll('[data-laser-dust]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-laser-dust]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    dustOn = b.dataset.laserDust === 'on';
  }));

  // deterministic per-cell "noise" for the dust mush
  const noise = (i, tt) => Math.sin(i * 12.9898 + tt * 3.1) * 0.5 + Math.sin(i * 78.233 - tt * 5.7) * 0.5;

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    if (!REDUCE_MOTION) { offset += speed * dt * 9; t += dt; }

    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 4);

    const cellW = 17 * dpr;
    const firstCell = Math.floor(offset);
    const frac = offset - firstCell;
    const laserX = W / 2;

    // ---- band 1: the magnified track -------------------------------------
    const trackY = H * 0.06, trackH = H * 0.26;
    // land background (reflective)
    c.fillStyle = 'rgba(69,228,209,0.13)';
    c.fillRect(0, trackY, W, trackH);
    // pits are contiguous runs of pit cells — draw each run as ONE long pit,
    // so their varying lengths (the run-length code at work) are visible
    for (let x = -2; x * cellW < W + cellW; x++) {
      const i = firstCell + x;
      const px = (x - frac) * cellW;
      if (cellAt(i) && !cellAt(i - 1)) {            // a pit run starts here
        let run = 1;
        while (cellAt(i + run)) run++;
        c.fillStyle = '#0a0812';
        c.strokeStyle = 'rgba(69,228,209,0.5)';
        c.lineWidth = 1 * dpr;
        c.beginPath();
        c.roundRect(px + 1, trackY + trackH * 0.22, run * cellW - 2, trackH * 0.56, 7 * dpr);
        c.fill(); c.stroke();
      }
      if (dustOn && dusty(i)) {                     // dust overlay
        c.fillStyle = 'rgba(255,177,78,0.22)';
        c.fillRect(px, trackY - 3 * dpr, cellW, trackH + 6 * dpr);
      }
    }
    // the fixed laser beam + spot
    c.strokeStyle = PAL.magenta;
    c.lineWidth = 2 * dpr;
    c.shadowColor = PAL.magenta; c.shadowBlur = 10 * dpr;
    c.beginPath(); c.moveTo(laserX, trackY - 4 * dpr); c.lineTo(laserX, H * 0.66); c.stroke();
    c.beginPath(); c.arc(laserX, trackY + trackH / 2, 6 * dpr, 0, 7); c.fillStyle = PAL.magenta; c.fill();
    c.shadowBlur = 0;
    c.fillStyle = PAL.muted;
    c.font = `600 ${10 * dpr}px ui-monospace, monospace`;
    c.fillText('track (magnified)', 8 * dpr, trackY - 5 * dpr < 10 ? trackY + 12 * dpr : trackY - 5 * dpr);

    // ---- band 2: reflected intensity, aligned under the track ------------
    const trY = H * 0.42, trH = H * 0.22;
    c.fillText('reflected intensity', 8 * dpr, trY - 4 * dpr);
    c.strokeStyle = PAL.cyan;
    c.lineWidth = 2 * dpr;
    c.shadowColor = PAL.cyan; c.shadowBlur = 6 * dpr;
    c.beginPath();
    const step = 2 * dpr;
    for (let px = 0; px <= W; px += step) {
      const cellIdx = Math.floor(offset + px / cellW);   // cell under this pixel column
      let v = cellAt(cellIdx) ? 0.85 : 0.12;             // pit = dim, land = bright (drawn inverted below)
      if (dustOn && dusty(cellIdx)) v = 0.5 + 0.3 * noise(cellIdx * 7 + Math.floor(px / (3 * dpr)), t);
      const y = trY + trH * Math.min(1, Math.max(0, v));
      px === 0 ? c.moveTo(px, y) : c.lineTo(px, y);
    }
    c.stroke();
    c.shadowBlur = 0;

    // ---- band 3: the recovered bitstream ----------------------------------
    const bitY = H * 0.86;
    c.fillStyle = PAL.muted;
    c.fillText('recovered bits (1 = transition)', 8 * dpr, H * 0.74);
    c.font = `700 ${12 * dpr}px ui-monospace, monospace`;
    for (let x = 0; x * cellW < W + cellW; x++) {
      const i = firstCell + x;
      const px = (x - frac) * cellW + cellW / 2;
      const garbled = dustOn && (dusty(i) || dusty(i - 1));
      let ch, col;
      if (garbled) {
        ch = noise(i * 13, Math.floor(t * 6)) > 0 ? '1' : '0';
        col = PAL.bad;
      } else {
        ch = cellAt(i) !== cellAt(i - 1) ? '1' : '0';
        col = ch === '1' ? PAL.cyan : PAL.muted;
      }
      c.fillStyle = col;
      c.fillText(ch, px - 4 * dpr, bitY);
    }
    c.font = `600 ${10 * dpr}px ui-monospace, monospace`;
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 02 — spin lab: CLV vs CAV with a draggable head
   ========================================================================== */
function SpinLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  // physical model (illustrative, roughly GameCube-scaled)
  const R_IN = 2.0, R_OUT = 4.0;        // cm — usable data band on an 8 cm disc
  const CAV_RPM = 1400;
  const CLV_RATE = 2.5;                 // MB/s, held flat
  let mode = 'cav';
  let rFrac = 0.35;                     // head position across the data band
  let angle = 0;

  const rpmEl = root.querySelector('[data-spin-rpm]');
  const rateEl = root.querySelector('[data-spin-rate]');
  const radEl = root.querySelector('[data-spin-radius]');

  root.querySelectorAll('[data-spin-mode]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-spin-mode]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    mode = b.dataset.spinMode;
  }));

  function model() {
    const rCm = R_IN + (R_OUT - R_IN) * rFrac;
    let rpm, rate;
    if (mode === 'cav') {
      rpm = CAV_RPM;
      rate = 2.0 + 1.1 * rFrac;                       // ~2.0 → 3.1 MB/s
    } else {
      rate = CLV_RATE;
      // constant linear velocity: rpm ∝ 1/r, pinned to CAV_RPM at mid-band
      const rMid = (R_IN + R_OUT) / 2;
      rpm = CAV_RPM * rMid / rCm;
    }
    return { rCm, rpm, rate };
  }

  // geometry helpers (recomputed per frame so resize just works)
  function geom() {
    const W = canvas.width, H = canvas.height;
    const R = Math.min(H * 0.42, W * 0.28);
    return { W, H, cx: W * 0.34, cy: H / 2, R, rHub: R * 0.18, rIn: R * 0.34, rOut: R * 0.95 };
  }

  // dragging the head along its (horizontal, rightward) rail
  let dragging = false;
  function setFromPointer(e) {
    const g = geom();
    const p = canvasPos(canvas, e, dpr);
    const d = Math.hypot(p.x - g.cx, p.y - g.cy);
    rFrac = Math.min(1, Math.max(0, (d - g.rIn) / (g.rOut - g.rIn)));
  }
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); dragging = true; setFromPointer(e); });
  canvas.addEventListener('pointermove', e => { if (dragging) setFromPointer(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'ew-resize';

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;

    const { rCm, rpm, rate } = model();
    // visual spin, slowed ~40× so the eye can track it
    if (!REDUCE_MOTION) angle += (rpm / 60) * 2 * Math.PI * dt / 40;

    const g = geom();
    const { W, H, cx, cy } = g;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 4);

    // ---- the disc ---------------------------------------------------------
    c.save();
    c.translate(cx, cy);
    // platter
    c.beginPath(); c.arc(0, 0, g.rOut + 6 * dpr, 0, 7);
    c.fillStyle = 'rgba(168,132,255,0.07)'; c.fill();
    c.strokeStyle = PAL.line2; c.lineWidth = 1.5 * dpr; c.stroke();
    // data band rings
    c.strokeStyle = 'rgba(69,228,209,0.20)';
    c.lineWidth = 1 * dpr;
    for (let k = 0; k <= 6; k++) {
      const rr = g.rIn + (g.rOut - g.rIn) * k / 6;
      c.beginPath(); c.arc(0, 0, rr, 0, 7); c.stroke();
    }
    // rotating spokes (so speed is visible)
    c.save();
    c.rotate(angle);
    c.strokeStyle = 'rgba(236,232,246,0.28)';
    c.lineWidth = 1.4 * dpr;
    for (let s = 0; s < 6; s++) {
      c.rotate(Math.PI / 3);
      c.beginPath(); c.moveTo(g.rHub, 0); c.lineTo(g.rOut, 0); c.stroke();
    }
    // one bright marker dot on the rim
    c.fillStyle = PAL.amber;
    c.beginPath(); c.arc(g.rOut - 4 * dpr, 0, 3.5 * dpr, 0, 7); c.fill();
    c.restore();
    // hub
    c.beginPath(); c.arc(0, 0, g.rHub, 0, 7);
    c.fillStyle = PAL.ground; c.fill();
    c.strokeStyle = PAL.line2; c.stroke();
    c.restore();

    // ---- the head on its rail --------------------------------------------
    const hx = cx + g.rIn + (g.rOut - g.rIn) * rFrac;
    c.strokeStyle = PAL.line2;
    c.lineWidth = 3 * dpr;
    c.beginPath(); c.moveTo(cx + g.rIn, cy); c.lineTo(cx + g.rOut, cy); c.stroke();
    c.strokeStyle = PAL.magenta;
    c.shadowColor = PAL.magenta; c.shadowBlur = 10 * dpr;
    c.fillStyle = PAL.magenta;
    c.beginPath(); c.arc(hx, cy, 7 * dpr, 0, 7); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = PAL.muted;
    c.font = `600 ${10 * dpr}px ui-monospace, monospace`;
    c.fillText('drag the head ⟷', cx + g.rIn, cy + 22 * dpr);

    // ---- meters ------------------------------------------------------------
    const mx = W * 0.68, mw = W * 0.26, mh = 14 * dpr;
    const meter = (y, label, frac, col, txt) => {
      c.fillStyle = PAL.muted;
      c.fillText(label, mx, y - 6 * dpr);
      c.fillStyle = PAL.panel2;
      c.strokeStyle = PAL.line2; c.lineWidth = 1 * dpr;
      c.beginPath(); c.roundRect(mx, y, mw, mh, 5 * dpr); c.fill(); c.stroke();
      c.fillStyle = col;
      c.beginPath(); c.roundRect(mx, y, mw * Math.min(1, frac), mh, 5 * dpr); c.fill();
      c.fillStyle = PAL.ink;
      c.font = `700 ${11 * dpr}px ui-monospace, monospace`;
      c.fillText(txt, mx, y + mh + 14 * dpr);
      c.font = `600 ${10 * dpr}px ui-monospace, monospace`;
    };
    meter(H * 0.18, 'RPM (0–2200)', rpm / 2200, PAL.violet, Math.round(rpm) + ' rpm');
    meter(H * 0.48, 'DATA RATE (0–3.5 MB/s)', rate / 3.5, PAL.cyan, rate.toFixed(2) + ' MB/s');
    c.fillStyle = PAL.muted;
    c.fillText(mode === 'cav' ? 'CAV: rpm pinned, rate rides the radius' : 'CLV: rate pinned, motor re-speeds',
      mx, H * 0.78);
    c.fillText('(spin slowed ~40× for visibility)', mx, H * 0.78 + 16 * dpr);

    // readout chips
    rpmEl.textContent = Math.round(rpm) + ' rpm';
    rateEl.textContent = rate.toFixed(2) + ' MB/s';
    radEl.textContent = rCm.toFixed(1) + ' cm';
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 03 — scratch lab: interleaved codewords vs a dragged gouge
   ========================================================================== */
function ScratchLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const COLS = 16, ROWS = 8, NCW = 8, BUDGET = 3;
  const CW_COLORS = ['#45e4d1', '#a884ff', '#ffb14e', '#ff5f9e', '#5fd18b', '#58b7f0', '#f0a4ff', '#d6e45a'];
  let interleaved = true;
  const damaged = new Set();          // physical cell indexes (disc order)
  const okEl = root.querySelector('[data-scratch-ok]');
  const okChip = okEl.closest('.readout');

  const cwOf = i => interleaved ? (i % NCW) : Math.floor(i / COLS);

  function evaluate() {
    const counts = new Array(NCW).fill(0);
    damaged.forEach(i => counts[cwOf(i)]++);
    const ok = counts.map(n => n <= BUDGET);
    const nOk = ok.filter(Boolean).length;
    okEl.textContent = nOk + ' / ' + NCW;
    okChip.classList.toggle('bad', nOk < NCW);
    okChip.classList.toggle('good', nOk === NCW && damaged.size > 0);
    return { counts, ok };
  }

  root.querySelectorAll('[data-il]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-il]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    interleaved = b.dataset.il === 'on';
  }));
  root.querySelector('[data-scratch-reset]').addEventListener('click', () => damaged.clear());

  function cellGeom() {
    const W = canvas.width, H = canvas.height;
    const pad = 14 * dpr, legend = 26 * dpr;
    const cw = (W - pad * 2) / COLS;
    const ch = (H - pad * 2 - legend) / ROWS;
    return { W, H, pad, legend, cw, ch };
  }

  let scratching = false;
  function scratchAt(e) {
    const g = cellGeom();
    const p = canvasPos(canvas, e, dpr);
    const col = Math.floor((p.x - g.pad) / g.cw);
    const row = Math.floor((p.y - g.pad - g.legend) / g.ch);
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) damaged.add(row * COLS + col);
  }
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); scratching = true; scratchAt(e); });
  canvas.addEventListener('pointermove', e => { if (scratching) scratchAt(e); });
  canvas.addEventListener('pointerup', () => { scratching = false; });
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'crosshair';

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    const g = cellGeom();
    const { ok, counts } = evaluate();
    c.clearRect(0, 0, g.W, g.H);

    c.font = `600 ${10 * dpr}px ui-monospace, monospace`;
    c.fillStyle = PAL.muted;
    c.fillText('disc order → (each row continues the track; colour = codeword)', 14 * dpr, 16 * dpr);

    for (let i = 0; i < COLS * ROWS; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = g.pad + col * g.cw, y = g.pad + g.legend + row * g.ch;
      const cw = cwOf(i);
      const dam = damaged.has(i);
      const cwOk = ok[cw];
      // base tint by codeword; damaged/failed states override
      if (dam) c.fillStyle = cwOk ? 'rgba(95,209,139,0.75)' : 'rgba(255,106,106,0.8)';
      else if (!cwOk) c.fillStyle = 'rgba(255,106,106,0.22)';
      else { c.fillStyle = CW_COLORS[cw] + '33'; }
      c.beginPath(); c.roundRect(x + 1.5 * dpr, y + 1.5 * dpr, g.cw - 3 * dpr, g.ch - 3 * dpr, 4 * dpr);
      c.fill();
      c.strokeStyle = dam ? (cwOk ? PAL.good : PAL.bad) : CW_COLORS[cw] + '88';
      c.lineWidth = 1.2 * dpr;
      c.stroke();
      if (dam) {
        c.strokeStyle = 'rgba(12,10,19,0.8)';
        c.lineWidth = 1.6 * dpr;
        c.beginPath();
        c.moveTo(x + g.cw * 0.28, y + g.ch * 0.3); c.lineTo(x + g.cw * 0.72, y + g.ch * 0.7);
        c.moveTo(x + g.cw * 0.72, y + g.ch * 0.3); c.lineTo(x + g.cw * 0.28, y + g.ch * 0.7);
        c.stroke();
      }
    }

    // per-codeword damage tallies along the bottom
    const by = g.H - 8 * dpr;
    for (let k = 0; k < NCW; k++) {
      const x = g.pad + k * (g.W - g.pad * 2) / NCW;
      c.fillStyle = CW_COLORS[k];
      c.fillText('cw' + k, x, by - 12 * dpr);
      c.fillStyle = counts[k] > BUDGET ? PAL.bad : (counts[k] ? PAL.good : PAL.muted);
      c.fillText(counts[k] + '/' + BUDGET + (counts[k] > BUDGET ? ' ✕' : ' ✓'), x, by);
    }
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Labs 05/06 — disc-map lab: a fictional game disc, with real seeks
   ========================================================================== */
function DiscMapLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  // the fictional disc, as fractions of the full spiral (inside → out)
  const REGIONS = [
    { id: 'boot',  name: 'boot header',      frac: 0.012, col: PAL.cyan },
    { id: 'appl',  name: 'apploader',        frac: 0.018, col: PAL.violet },
    { id: 'dol',   name: 'main.dol',         frac: 0.05,  col: PAL.magenta },
    { id: 'fst',   name: 'FST',              frac: 0.015, col: PAL.amber },
    { id: 'intro', name: 'movies/intro.thp', frac: 0.21,  col: '#58b7f0' },
    { id: 'junk1', name: 'junk',             frac: 0.03,  col: 'rgba(135,127,158,0.35)', junk: true },
    { id: 'theme', name: 'audio/theme.adp',  frac: 0.12,  col: '#5fd18b' },
    { id: 'junk2', name: 'junk',             frac: 0.025, col: 'rgba(135,127,158,0.35)', junk: true },
    { id: 'level', name: 'maps/level7.arc',  frac: 0.24,  col: '#f0a4ff' },
    { id: 'junk3', name: 'junk (unused)',    frac: 0.28,  col: 'rgba(135,127,158,0.25)', junk: true },
  ];
  // cumulative start fractions
  let acc = 0;
  REGIONS.forEach(r => { r.start = acc; acc += r.frac; r.end = acc; });
  const byId = Object.fromEntries(REGIONS.map(r => [r.id, r]));

  const TURNS = 13;
  const SLOWMO = 8;                 // 1 real ms of animation = 1/SLOWMO sim ms
  const RPM = 1400;
  const REV_MS = 60000 / RPM;       // ≈ 43 ms per revolution (sim time)

  let rotation = 0;                 // current platter rotation (radians)
  let headF = 0.0;                  // head position as spiral fraction (radius only)
  // seek state machine
  let job = null;                   // {target, phase, simMs:{sled,settle,rot}, readT}
  const timeEl = root.querySelector('[data-seek-time]');
  const rateEl = root.querySelector('[data-seek-rate]');

  const rateAt = f => 2.0 + 1.1 * f; // CAV MB/s across the band (Module 05)

  root.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-target]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const r = byId[b.dataset.target];
    if (!r) return;
    job = {
      target: r, phase: 'sled',
      from: headF,
      sled: 0, settle: 0, rot: 0, readT: 0,
      settleLeft: 8,               // sim ms
    };
    timeEl.textContent = 'seeking…';
    rateEl.textContent = '—';
  }));

  function geom() {
    const W = canvas.width, H = canvas.height;
    const R = Math.min(H, W) * 0.44;
    return { W, H, cx: W * 0.40, cy: H * 0.52, R, rIn: R * 0.30, rOut: R * 0.97 };
  }
  const radiusOf = (g, f) => g.rIn + (g.rOut - g.rIn) * f;
  const angleOf = f => f * TURNS * 2 * Math.PI;

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dtMs = Math.min(50, (ts - last) || 16);
    last = ts;
    // sim time runs SLOWMO× slower than real time; the platter always spins
    const simStep = dtMs / SLOWMO;
    rotation = (rotation + (simStep / REV_MS) * 2 * Math.PI) % (2 * Math.PI);

    // ---- advance the seek state machine (in sim ms) -----------------------
    if (job) {
      const t = job.target;
      if (job.phase === 'sled') {
        // sled speed: full band in 70 sim ms
        const speed = 1 / 70;                       // frac per sim ms
        const dir = Math.sign(t.start - headF) || 1;
        const stepF = speed * simStep;
        if (Math.abs(t.start - headF) <= stepF) {
          headF = t.start;
          job.phase = 'settle';
        } else {
          headF += dir * stepF;
        }
        job.sled += simStep;
      } else if (job.phase === 'settle') {
        job.settleLeft -= simStep;
        job.settle += simStep;
        if (job.settleLeft <= 0) job.phase = 'rot';
      } else if (job.phase === 'rot') {
        // wait until the target's angular position passes the head azimuth (0)
        const targetAngle = (angleOf(t.start) + rotation) % (2 * Math.PI);
        job.rot += simStep;
        // has it swept past zero this step?
        const prev = (targetAngle - (simStep / REV_MS) * 2 * Math.PI + 4 * Math.PI) % (2 * Math.PI);
        if (targetAngle < prev) {                   // wrapped through 0
          job.phase = 'read';
          job.readT = 0;
          const total = Math.round(job.sled + job.settle + job.rot);
          timeEl.textContent =
            `sled ${Math.round(job.sled)} + settle ${Math.round(job.settle)} + rot ${Math.round(job.rot)} = ${total} ms`;
          const rr = rateAt(t.start);
          rateEl.textContent = rr.toFixed(2) + ' MB/s ' + (t.start > 0.5 ? '(outer — fast)' : '(inner — slower)');
        }
      } else if (job.phase === 'read') {
        job.readT += dtMs / 1400;                   // sweep the file in ~1.4 s real
        headF = t.start + (t.end - t.start) * Math.min(1, job.readT);
        if (job.readT >= 1) { job.phase = 'done'; }
      }
    }

    // ---- draw --------------------------------------------------------------
    const g = geom();
    c.clearRect(0, 0, g.W, g.H);
    grid(c, g.W, g.H, 12, 4);

    c.save();
    c.translate(g.cx, g.cy);
    // platter
    c.beginPath(); c.arc(0, 0, g.rOut + 8 * dpr, 0, 7);
    c.fillStyle = 'rgba(168,132,255,0.06)'; c.fill();
    c.strokeStyle = PAL.line2; c.lineWidth = 1.5 * dpr; c.stroke();
    // the spiral, coloured by region, rotating with the platter
    c.save();
    c.rotate(rotation);
    const bandW = (g.rOut - g.rIn) / TURNS * 0.72;
    c.lineWidth = Math.max(2 * dpr, bandW);
    c.lineCap = 'butt';
    const STEPS = 900;
    let region = 0;
    let px = radiusOf(g, 0) * Math.cos(0), py = radiusOf(g, 0) * Math.sin(0);
    for (let s = 1; s <= STEPS; s++) {
      const f = s / STEPS;
      while (region < REGIONS.length - 1 && f > REGIONS[region].end) region++;
      const a = angleOf(f), r = radiusOf(g, f);
      const x = r * Math.cos(a), y = r * Math.sin(a);
      const reg = REGIONS[region];
      const isTargetRead = job && job.target === reg && (job.phase === 'read' || job.phase === 'done');
      const readUpTo = isTargetRead ? reg.start + (reg.end - reg.start) * Math.min(1, job.readT) : -1;
      c.strokeStyle = reg.col;
      c.globalAlpha = reg.junk ? 0.5 : 0.9;
      if (isTargetRead && f <= readUpTo) { c.strokeStyle = '#ffffff'; c.globalAlpha = 1; }
      c.beginPath(); c.moveTo(px, py); c.lineTo(x, y); c.stroke();
      px = x; py = y;
    }
    c.globalAlpha = 1;
    c.restore();
    // hub
    c.beginPath(); c.arc(0, 0, g.rIn * 0.62, 0, 7);
    c.fillStyle = PAL.ground; c.fill();
    c.strokeStyle = PAL.line2; c.stroke();
    c.restore();

    // head rail + head (fixed azimuth: pointing right from centre)
    const hr = radiusOf(g, headF);
    c.strokeStyle = PAL.line2; c.lineWidth = 3 * dpr;
    c.beginPath(); c.moveTo(g.cx + g.rIn * 0.7, g.cy); c.lineTo(g.cx + g.rOut + 14 * dpr, g.cy); c.stroke();
    c.fillStyle = PAL.magenta;
    c.shadowColor = PAL.magenta; c.shadowBlur = 10 * dpr;
    c.beginPath(); c.arc(g.cx + hr, g.cy, 6.5 * dpr, 0, 7); c.fill();
    c.shadowBlur = 0;

    // phase caption + legend
    c.font = `600 ${10.5 * dpr}px ui-monospace, monospace`;
    c.fillStyle = PAL.muted;
    const phase = !job ? 'idle — pick a file to read'
      : job.phase === 'sled' ? 'sled moving to radius…'
      : job.phase === 'settle' ? 'servo settling…'
      : job.phase === 'rot' ? 'waiting for the platter to bring the data around…'
      : job.phase === 'read' ? ('reading ' + job.target.name + '…')
      : ('done — ' + job.target.name + ' read');
    c.fillText(phase, 12 * dpr, 18 * dpr);

    // legend (right column)
    const lx = g.W * 0.72;
    let ly = g.H * 0.16;
    REGIONS.filter(r => !r.junk || r.id === 'junk3').forEach(r => {
      c.fillStyle = r.col;
      c.fillRect(lx, ly - 8 * dpr, 10 * dpr, 10 * dpr);
      c.fillStyle = (job && job.target === r) ? PAL.ink : PAL.muted;
      c.fillText(r.name, lx + 16 * dpr, ly);
      ly += 18 * dpr;
    });
    c.fillStyle = PAL.muted;
    c.fillText('spiral runs inside → out', lx, ly + 8 * dpr);
    c.fillText('head reads at 3 o’clock', lx, ly + 24 * dpr);
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 09 — streaming lab: keep the buffer alive
   ========================================================================== */
function StreamLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const CAP = 4;                      // MB buffer capacity
  let level = 2.4;                    // MB
  let readRate = 2.5, consumeRate = 1.8;   // MB/s
  let seekLeft = 0;                   // s of drive stall remaining
  let stalled = false;                // game showing "loading…"
  let stallCount = 0, gameT = 0;
  const hist = [];

  const rr = root.querySelector('[data-read-rate]'), rv = root.querySelector('[data-read-rate-val]');
  const cr = root.querySelector('[data-consume-rate]'), cv = root.querySelector('[data-consume-rate-val]');
  rr.addEventListener('input', () => { readRate = parseFloat(rr.value) / 10; rv.textContent = readRate.toFixed(1) + ' MB/s'; });
  cr.addEventListener('input', () => { consumeRate = parseFloat(cr.value) / 10; cv.textContent = consumeRate.toFixed(1) + ' MB/s'; });
  root.querySelector('[data-do-seek]').addEventListener('click', () => { seekLeft = Math.max(seekLeft, 1.0); });

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = REDUCE_MOTION ? 0 : Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;

    // ---- simulate ----------------------------------------------------------
    const seeking = seekLeft > 0;
    if (seeking) seekLeft -= dt;
    else if (level < CAP) level = Math.min(CAP, level + readRate * dt);
    if (!stalled) {
      level -= consumeRate * dt;
      gameT += dt;
      if (level <= 0) { level = 0; stalled = true; stallCount++; }
    } else if (level >= CAP * 0.25) {
      stalled = false;
    }
    hist.push(level / CAP);
    if (hist.length > 400) hist.shift();

    // ---- draw ---------------------------------------------------------------
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 4);
    c.font = `600 ${10.5 * dpr}px ui-monospace, monospace`;

    const boxY = H * 0.14, boxH = H * 0.42;
    // drive box
    const dx = W * 0.05, dw = W * 0.2;
    c.fillStyle = PAL.panel2; c.strokeStyle = seeking ? PAL.amber : PAL.cyan; c.lineWidth = 1.5 * dpr;
    c.beginPath(); c.roundRect(dx, boxY, dw, boxH, 8 * dpr); c.fill(); c.stroke();
    c.fillStyle = PAL.ink;
    c.fillText('DRIVE', dx + 12 * dpr, boxY + 20 * dpr);
    c.fillStyle = seeking ? PAL.amber : PAL.cyan;
    c.fillText(seeking ? 'seeking…' : 'reading', dx + 12 * dpr, boxY + 38 * dpr);
    c.fillStyle = PAL.muted;
    c.fillText(seeking ? '(no data!)' : readRate.toFixed(1) + ' MB/s', dx + 12 * dpr, boxY + 56 * dpr);

    // buffer tank
    const bx = W * 0.38, bw = W * 0.14;
    c.fillStyle = PAL.panel; c.strokeStyle = PAL.line2;
    c.beginPath(); c.roundRect(bx, boxY, bw, boxH, 8 * dpr); c.fill(); c.stroke();
    const fillH = boxH * (level / CAP);
    const low = level < CAP * 0.2;
    c.fillStyle = stalled ? PAL.bad : (low ? PAL.amber : PAL.cyan);
    c.beginPath(); c.roundRect(bx + 2 * dpr, boxY + boxH - fillH + (fillH > 4 * dpr ? 0 : 0), bw - 4 * dpr, Math.max(0, fillH - 2 * dpr), 6 * dpr); c.fill();
    c.fillStyle = PAL.muted;
    c.fillText('BUFFER', bx, boxY - 8 * dpr);
    c.fillStyle = PAL.ink;
    c.fillText(level.toFixed(2) + ' / ' + CAP + ' MB', bx, boxY + boxH + 18 * dpr);

    // game box
    const gx = W * 0.66, gw = W * 0.28;
    c.fillStyle = PAL.panel2; c.strokeStyle = stalled ? PAL.bad : PAL.violet;
    c.beginPath(); c.roundRect(gx, boxY, gw, boxH, 8 * dpr); c.fill(); c.stroke();
    c.fillStyle = PAL.ink;
    c.fillText('GAME', gx + 12 * dpr, boxY + 20 * dpr);
    if (stalled) {
      const blink = Math.floor(performance.now() / 400) % 2 === 0;
      c.fillStyle = PAL.bad;
      c.font = `700 ${14 * dpr}px ui-monospace, monospace`;
      if (blink) c.fillText('LOADING…', gx + 12 * dpr, boxY + boxH / 2 + 6 * dpr);
      c.font = `600 ${10.5 * dpr}px ui-monospace, monospace`;
    } else {
      // "gameplay": a bouncing dot, driven by consumed data
      const t = gameT * 2;
      const bxp = gx + gw * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t)));
      const byp = boxY + boxH * (0.45 + 0.28 * Math.abs(Math.sin(t * 1.7)));
      c.fillStyle = PAL.cyan;
      c.beginPath(); c.arc(bxp, byp, 5 * dpr, 0, 7); c.fill();
      c.fillStyle = PAL.muted;
      c.fillText('playing · draining ' + consumeRate.toFixed(1) + ' MB/s', gx + 12 * dpr, boxY + 38 * dpr);
    }
    c.fillStyle = PAL.muted;
    c.fillText('stalls so far: ' + stallCount, gx + 12 * dpr, boxY + boxH + 18 * dpr);

    // flow arrows
    const ay = boxY + boxH / 2;
    const dash = (performance.now() / 40) % 16;
    c.setLineDash([8 * dpr, 8 * dpr]);
    c.lineDashOffset = -dash * dpr;
    c.strokeStyle = seeking ? 'rgba(255,177,78,0.25)' : PAL.cyan;
    c.lineWidth = 2.5 * dpr;
    c.beginPath(); c.moveTo(dx + dw + 6 * dpr, ay); c.lineTo(bx - 6 * dpr, ay); c.stroke();
    c.strokeStyle = stalled ? 'rgba(255,106,106,0.3)' : PAL.violet;
    c.beginPath(); c.moveTo(bx + bw + 6 * dpr, ay); c.lineTo(gx - 6 * dpr, ay); c.stroke();
    c.setLineDash([]);

    // buffer-level history sparkline
    const hy = H * 0.8, hh = H * 0.14;
    c.strokeStyle = PAL.line2; c.lineWidth = 1 * dpr;
    c.strokeRect(W * 0.05, hy, W * 0.89, hh);
    c.strokeStyle = PAL.cyan; c.lineWidth = 1.6 * dpr;
    c.beginPath();
    hist.forEach((v, i) => {
      const x = W * 0.05 + (W * 0.89) * i / 399;
      const y = hy + hh * (1 - v);
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    });
    c.stroke();
    c.fillStyle = PAL.muted;
    c.fillText('buffer level over time', W * 0.05, hy - 6 * dpr);
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 10 — image-compression lab: raw ISO vs naive zip vs RVZ-style
   ========================================================================== */
function ImageLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  // a fictional disc's blocks: runs of data / zeros / junk
  const rng = makeRng(0x47414c45);      // "GALE"
  const blocks = [];
  const runs = [['data', 9], ['junk', 2], ['data', 7], ['zero', 4], ['data', 6], ['junk', 5],
                ['data', 8], ['zero', 3], ['junk', 5]];
  runs.forEach(([type, n]) => { for (let i = 0; i < n; i++) blocks.push(type); });
  const NB = blocks.length;             // 49 blocks

  const FACTORS = {
    iso: { data: 1, zero: 1, junk: 1 },
    zip: { data: 0.55, zero: 0.03, junk: 0.98 },
    rvz: { data: 0.50, zero: 0.002, junk: 0.01 },
  };
  const COLORS = { data: PAL.cyan, zero: '#4a4460', junk: PAL.magenta };

  let fmt = 'iso';
  let anim = 1;                          // 0..1 packing progress
  const sizeEl = root.querySelector('[data-image-size]');
  const ratioEl = root.querySelector('[data-image-ratio]');

  root.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-fmt]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    fmt = b.dataset.fmt;
    anim = REDUCE_MOTION ? 1 : 0;
  }));

  function totals() {
    const f = FACTORS[fmt];
    let out = 0;
    blocks.forEach(t => { out += f[t]; });
    return out / NB;                     // fraction of original
  }

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    if (anim < 1) anim = Math.min(1, anim + dt / 1.6);

    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 4);
    c.font = `600 ${10.5 * dpr}px ui-monospace, monospace`;

    const pad = W * 0.05, span = W * 0.9;
    const bw = span / NB;
    const f = FACTORS[fmt];

    // ---- source strip -------------------------------------------------------
    const sy = H * 0.16, sh = H * 0.2;
    c.fillStyle = PAL.muted;
    c.fillText('the dumped disc — 1.46 GB of blocks', pad, sy - 8 * dpr);
    const packedCount = Math.floor(anim * NB);
    blocks.forEach((t, i) => {
      const x = pad + i * bw;
      c.fillStyle = COLORS[t];
      c.globalAlpha = i < packedCount ? 0.28 : (t === 'zero' ? 0.8 : 0.85);
      c.beginPath(); c.roundRect(x + 1 * dpr, sy, bw - 2 * dpr, sh, 3 * dpr); c.fill();
      c.globalAlpha = 1;
      if (t === 'junk' && i >= packedCount) {     // speckle the junk so it reads as noise
        c.fillStyle = 'rgba(12,10,19,0.55)';
        for (let k = 0; k < 5; k++) {
          c.fillRect(x + 2 * dpr + ((i * 7 + k * 13) % Math.max(1, bw - 5 * dpr)), sy + ((i * 11 + k * 29) % (sh - 3 * dpr)), 2 * dpr, 2 * dpr);
        }
      }
    });
    // the packer cursor
    if (anim < 1) {
      const cx = pad + packedCount * bw;
      c.strokeStyle = PAL.ink; c.lineWidth = 2 * dpr;
      c.beginPath(); c.moveTo(cx, sy - 6 * dpr); c.lineTo(cx, sy + sh + 6 * dpr); c.stroke();
    }

    // ---- output bar ----------------------------------------------------------
    const oy = H * 0.58, oh = H * 0.2;
    const label = fmt === 'iso' ? 'raw ISO — stored as-is'
      : fmt === 'zip' ? 'naive zip — junk refuses to shrink'
      : 'RVZ-style — junk becomes generator parameters';
    c.fillStyle = PAL.muted;
    c.fillText(label, pad, oy - 8 * dpr);
    let xo = pad;
    blocks.forEach((t, i) => {
      if (i >= packedCount) return;
      const wOut = bw * f[t];
      c.fillStyle = COLORS[t];
      c.globalAlpha = t === 'zero' ? 0.8 : 0.9;
      if (wOut > 0.6 * dpr) {
        c.beginPath(); c.roundRect(xo, oy, Math.max(1 * dpr, wOut - (wOut > 3 * dpr ? 1.5 * dpr : 0)), oh, 2 * dpr); c.fill();
      }
      c.globalAlpha = 1;
      xo += wOut;
    });
    // outline of the full original size for comparison
    c.strokeStyle = PAL.line2; c.lineWidth = 1 * dpr;
    c.setLineDash([4 * dpr, 4 * dpr]);
    c.strokeRect(pad, oy, span, oh);
    c.setLineDash([]);

    // ---- readouts -------------------------------------------------------------
    const frac = totals();
    const shownFrac = anim >= 1 ? frac : (xo - pad) / span;
    const gb = 1.46 * frac;
    sizeEl.textContent = anim >= 1 ? Math.round(frac * 100) + '% · ~' + gb.toFixed(2) + ' GB' : 'packing…';
    ratioEl.textContent = anim >= 1 ? (1 / frac).toFixed(2) + ' : 1' : '—';
    c.fillStyle = PAL.ink;
    c.font = `700 ${12 * dpr}px ui-monospace, monospace`;
    c.fillText((shownFrac * 100).toFixed(0) + '%', pad + span + 4 * dpr - 34 * dpr, oy + oh + 20 * dpr);
    c.font = `600 ${10.5 * dpr}px ui-monospace, monospace`;

    // legend
    const ly = H * 0.94;
    const leg = [['game data', 'data'], ['zero padding', 'zero'], ['pseudo-random junk', 'junk']];
    let lx = pad;
    leg.forEach(([name, key]) => {
      c.fillStyle = COLORS[key];
      c.fillRect(lx, ly - 9 * dpr, 10 * dpr, 10 * dpr);
      c.fillStyle = PAL.muted;
      c.fillText(name, lx + 15 * dpr, ly);
      lx += (name.length * 6.6 + 42) * dpr;
    });
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 11 — timing lab: instant vs realistic reads (a dramatisation)
   ========================================================================== */
function TimingLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  // scripted load, in simulated ms: the game issues a read, then runs a
  // setup task it *assumes* will finish before the data lands.
  const SCRIPT = { cmdAt: 0, setupEnd: 60, driveDelivers: 90, instantDelivers: 4, total: 150 };
  const DUR_REAL = 3800;             // real ms for the full sweep
  let t = -1;                         // -1 = idle, else 0..1 progress
  const instEl = root.querySelector('[data-timing-instant]');
  const realEl = root.querySelector('[data-timing-real]');
  const instChip = instEl.closest('.readout');
  const realChip = realEl.closest('.readout');

  root.querySelector('[data-timing-run]').addEventListener('click', () => {
    t = 0;
    instEl.textContent = 'running…'; realEl.textContent = 'running…';
    instChip.classList.remove('bad'); realChip.classList.remove('good');
  });

  function lane(y, laneH, simNow, mode) {
    const W = canvas.width;
    const pad = W * 0.05, span = W * 0.9;
    const X = ms => pad + span * ms / SCRIPT.total;
    const deliver = mode === 'instant' ? SCRIPT.instantDelivers : SCRIPT.driveDelivers;
    const glitch = mode === 'instant';                     // delivery lands inside setup

    // baseline
    c.strokeStyle = PAL.line2; c.lineWidth = 1 * dpr;
    c.beginPath(); c.moveTo(pad, y + laneH); c.lineTo(pad + span, y + laneH); c.stroke();

    const box = (a, b, col, label, filled, labelX) => {
      const x0 = X(a), x1 = X(Math.min(b, simNow));
      if (simNow <= a) return;
      c.fillStyle = col + (filled ? 'cc' : '33');
      c.strokeStyle = col;
      c.lineWidth = 1.2 * dpr;
      c.beginPath(); c.roundRect(x0, y, Math.max(2 * dpr, x1 - x0), laneH - 6 * dpr, 4 * dpr);
      c.fill(); c.stroke();
      c.fillStyle = PAL.ink2;
      c.fillText(label, (labelX !== undefined ? labelX : x0 + 4 * dpr), y - 5 * dpr);
    };

    // read command pulse (label below the lane so it can't collide with boxes)
    if (simNow >= 0) {
      c.fillStyle = PAL.cyan;
      c.fillRect(X(0), y, 3 * dpr, laneH - 6 * dpr);
      c.fillStyle = PAL.muted;
      c.fillText('read cmd', X(0), y + laneH + 8 * dpr);
    }
    // setup block
    box(2, SCRIPT.setupEnd, '#a884ff', 'setup', false);
    // drive activity (realistic lane only) — label sits over the post-setup span
    if (mode === 'real') box(2, deliver, '#ffb14e', 'drive: seek + read', false, X(SCRIPT.setupEnd) + 6 * dpr);

    // delivery interrupt marker
    if (simNow >= deliver) {
      const x = X(deliver);
      c.fillStyle = glitch ? PAL.bad : PAL.good;
      c.beginPath();
      c.moveTo(x, y - 2 * dpr); c.lineTo(x + 6 * dpr, y + 10 * dpr); c.lineTo(x - 6 * dpr, y + 10 * dpr);
      c.closePath(); c.fill();
      c.fillText('interrupt', x + 8 * dpr, y + 12 * dpr);
    }

    // outcome
    if (glitch && simNow >= deliver) {
      // glitch jitter over the setup block after the bad interrupt
      const gx = X(deliver + 6);
      c.fillStyle = PAL.bad;
      c.font = `700 ${12 * dpr}px ui-monospace, monospace`;
      const jx = REDUCE_MOTION ? 0 : Math.sin(performance.now() / 60) * 2 * dpr;
      c.fillText('⚠ callback fired mid-setup — desync', gx + 40 * dpr + jx, y + laneH * 0.55);
      c.font = `600 ${10.5 * dpr}px ui-monospace, monospace`;
    }
    if (!glitch && simNow >= deliver + 4) {
      box(deliver + 2, SCRIPT.total - 6, '#5fd18b', 'level starts', false);
      if (simNow >= SCRIPT.total - 6) {
        c.fillStyle = PAL.good;
        c.fillText('✓ smooth', X(SCRIPT.total - 4), y + laneH * 0.55);
      }
    }
  }

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(50, (ts - last) || 16);
    last = ts;
    if (t >= 0 && t < 1) {
      t = Math.min(1, t + (REDUCE_MOTION ? 1 : dt / DUR_REAL));
      if (t >= 1) {
        instEl.textContent = 'glitched at 4 ms';
        instChip.classList.add('bad');
        realEl.textContent = 'loaded cleanly';
        realChip.classList.add('good');
      }
    }

    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 4);
    c.font = `600 ${10.5 * dpr}px ui-monospace, monospace`;

    const simNow = t < 0 ? -1 : t * SCRIPT.total;
    c.fillStyle = PAL.bad;
    c.fillText('INSTANT READS (inaccurate)', W * 0.05, H * 0.12);
    c.fillStyle = PAL.good;
    c.fillText('REALISTIC TIMING (accurate)', W * 0.05, H * 0.56);
    if (t < 0) {
      c.fillStyle = PAL.muted;
      c.fillText('press “Run the load sequence”', W * 0.36, H * 0.36);
    } else {
      lane(H * 0.2, H * 0.22, simNow, 'instant');
      lane(H * 0.64, H * 0.22, simNow, 'real');
      // shared playhead
      const px = W * 0.05 + W * 0.9 * t;
      c.strokeStyle = 'rgba(236,232,246,0.4)';
      c.lineWidth = 1 * dpr;
      c.beginPath(); c.moveTo(px, H * 0.14); c.lineTo(px, H * 0.94); c.stroke();
      c.fillStyle = PAL.muted;
      c.fillText(Math.round(simNow) + ' ms (sim)', Math.min(px + 6 * dpr, W - 90 * dpr), H * 0.97);
    }
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Hero ambient — a faint spinning disc with an unwinding spiral glint
   ========================================================================== */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let t = 0, raf;
  function size() { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
  size(); window.addEventListener('resize', size);

  function draw() {
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const cx = W * 0.78, cy = H * 0.52;
    const R = Math.min(H * 0.85, W * 0.3);

    // platter rings
    c.strokeStyle = 'rgba(69,228,209,0.10)';
    c.lineWidth = 1 * dpr;
    for (let k = 3; k <= 10; k++) {
      c.beginPath(); c.arc(cx, cy, R * k / 10, 0, 7); c.stroke();
    }
    // hub
    c.strokeStyle = 'rgba(168,132,255,0.18)';
    c.beginPath(); c.arc(cx, cy, R * 0.16, 0, 7); c.stroke();

    // slowly-unwinding spiral glint
    c.strokeStyle = 'rgba(69,228,209,0.28)';
    c.lineWidth = 1.4 * dpr;
    c.shadowColor = 'rgba(69,228,209,0.8)';
    c.shadowBlur = 6 * dpr;
    c.beginPath();
    const turns = 5.5, steps = 260;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const a = f * turns * 2 * Math.PI - t * 0.25;
      const r = R * (0.2 + 0.75 * f);
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();

    // two rotating light glints across the platter
    for (let g = 0; g < 2; g++) {
      const a = t * 0.18 + g * Math.PI;
      const grad = c.createLinearGradient(
        cx + R * 0.2 * Math.cos(a), cy + R * 0.2 * Math.sin(a),
        cx + R * Math.cos(a), cy + R * Math.sin(a));
      grad.addColorStop(0, 'rgba(168,132,255,0)');
      grad.addColorStop(0.6, 'rgba(168,132,255,0.16)');
      grad.addColorStop(1, 'rgba(168,132,255,0)');
      c.strokeStyle = grad;
      c.lineWidth = 26 * dpr;
      c.beginPath();
      c.moveTo(cx + R * 0.18 * Math.cos(a), cy + R * 0.18 * Math.sin(a));
      c.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      c.stroke();
    }
    c.shadowBlur = 0;

    t += REDUCE_MOTION ? 0 : 0.016;
    raf = requestAnimationFrame(draw);
    if (REDUCE_MOTION) cancelAnimationFrame(raf);
  }
  draw();
}

/* ==========================================================================
   Wire-up
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  /* hero ambient disc */
  const heroCanvas = document.getElementById('hero-disc');
  if (heroCanvas) heroAmbient(heroCanvas);

  /* labs */
  const lz = document.getElementById('lab-laser'); if (lz) LaserLab(lz);
  const sp = document.getElementById('lab-spin'); if (sp) SpinLab(sp);
  const sc = document.getElementById('lab-scratch'); if (sc) ScratchLab(sc);
  const dm = document.getElementById('lab-discmap'); if (dm) DiscMapLab(dm);
  const st = document.getElementById('lab-stream'); if (st) StreamLab(st);
  const im = document.getElementById('lab-image'); if (im) ImageLab(im);
  const tm = document.getElementById('lab-timing'); if (tm) TimingLab(tm);

  /* glossary tooltips */
  initTooltips();

  /* scroll-spy nav + reading progress */
  scrollSpy();
  readingProgress();

  /* mobile menu */
  const mb = document.getElementById('menu-btn');
  const sb = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const closeMenu = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
  mb.addEventListener('click', () => { sb.classList.toggle('open'); scrim.classList.toggle('show'); });
  scrim.addEventListener('click', closeMenu);
  sb.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
});

/* ------------------------------------------------------- glossary tooltips */
/* Every jargon word is wrapped in <span class="term" data-tip="…">. We show
   the definition in a single shared floating bubble on hover, keyboard focus,
   or tap — positioned above the word and clamped so it never leaves the
   viewport. One bubble (rather than a CSS ::after per term) keeps it from
   being clipped by scroll containers and works on touch screens.            */
function initTooltips() {
  const terms = [...document.querySelectorAll('.term[data-tip]')];
  if (!terms.length) return;
  const tip = document.createElement('div');
  tip.className = 'tip-bubble';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let current = null;

  function place(el) {
    current = el;
    const label = el.textContent.trim().replace(/\s+/g, ' ');
    tip.innerHTML = '<span class="tt">' + label.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + '</span> — ' +
      el.getAttribute('data-tip').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight, pad = 10;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
    let top = r.top - th - 10, below = false;
    if (top < 8) { top = r.bottom + 10; below = true; }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.toggle('below', below);
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
    // mark a module "done" once its top has scrolled above 40% of viewport
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
