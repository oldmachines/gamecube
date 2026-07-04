/* ============================================================================
   GameCube CPU — interactive layer
   Every lab on this page is a from-scratch teaching simulation: a toy CPU, an
   IEEE-754 bit board, a five-stage pipeline, a direct-mapped cache, a paired-
   singles point cloud, a GQR quantiser, a locked-cache/DMA timeline, and a
   JIT-vs-interpreter race. No game code runs here; the demos recreate the
   *behaviour* of the hardware and of Dolphin's CPU cores so you can watch the
   concepts, not the games.
   ============================================================================ */
'use strict';

/* -------------------------------------------------------------- utilities */
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Resize a canvas's bitmap to its CSS box × devicePixelRatio (capped at 2 —
   beyond that the glow blurs cost more than they show). Returns the 2d ctx. */
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  return { ctx: canvas.getContext('2d'), W: canvas.width, H: canvas.height, dpr };
}

/* Run `onShow`/`onHide` as an element enters/leaves the viewport, so offscreen
   labs stop burning frames. Falls back to always-on if IO is unavailable. */
function whenVisible(el, onShow, onHide) {
  if (!('IntersectionObserver' in window)) { onShow(); return; }
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { e.isIntersecting ? onShow() : onHide(); });
  }, { rootMargin: '80px 0px' });
  obs.observe(el);
}

const hex2 = v => '0x' + (v & 0xff).toString(16).toUpperCase().padStart(2, '0');

/* ==========================================================================
   Module 01 — toy CPU
   A 16-cell memory, registers PC/A/IR, and a 4-opcode ISA:
     1n LOAD A,[n] · 2n ADD A,[n] · 3n STORE A,[n] · 4n JUMP n
   Each Step runs ONE phase (fetch → decode → execute) with highlights and a
   plain-words narration, so the loop from the prose is literally watchable.
   ========================================================================== */
function ToyCpuLab(root) {
  const PROGRAM = [0x1e, 0x2d, 0x2c, 0x3e, 0x40];   // load,add,add,store,jump
  const memEl = root.querySelector('[data-tc-mem]');
  const regEl = root.querySelector('[data-tc-regs]');
  const narEl = root.querySelector('[data-tc-narrate]');
  const phases = [...root.querySelectorAll('[data-tc-phase] span')];
  const runBtn = root.querySelector('[data-tc-run]');

  let mem, pc, a, ir, phase, timer = null, visible = false;

  const OPS = { 1: 'LOAD', 2: 'ADD', 3: 'STORE', 4: 'JUMP' };
  function disasm(b) {
    const op = OPS[b >> 4];
    if (!op) return '';
    const n = b & 15;
    return op === 'JUMP' ? 'JUMP ' + n : op + ' A,[' + n + ']';
  }

  /* build DOM: 16 memory cells + 3 registers */
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const c = document.createElement('div');
    c.className = 'tc-cell';
    c.innerHTML = '<span class="addr">cell ' + i + '</span><span class="val"></span><span class="dis"></span>';
    memEl.appendChild(c);
    cells.push(c);
  }
  const regs = {};
  [['pc', 'PC'], ['a', 'A'], ['ir', 'IR']].forEach(([k, label]) => {
    const r = document.createElement('div');
    r.className = 'tc-reg';
    r.innerHTML = '<div class="k">' + label + '</div><div class="v"></div>';
    regEl.appendChild(r);
    regs[k] = r;
  });

  function reset() {
    mem = new Array(16).fill(0);
    PROGRAM.forEach((b, i) => { mem[i] = b; });
    mem[12] = 1; mem[13] = 2; mem[14] = 0;
    pc = 0; a = 0; ir = 0; phase = 0;
    narrate('Press <b>Step</b> to run one phase of the loop, or <b>Run</b> to let it fly.');
    render();
  }

  function narrate(html) { narEl.innerHTML = html; }

  function render(marks = {}) {
    cells.forEach((c, i) => {
      c.querySelector('.val').textContent = hex2(mem[i]) + '  (' + mem[i] + ')';
      c.querySelector('.dis').textContent = i < PROGRAM.length ? disasm(mem[i]) : (i >= 12 ? 'data' : '');
      c.classList.toggle('is-data', i >= 12);
      c.classList.toggle('is-pc', i === pc);
      c.classList.toggle('is-read', marks.read === i);
      c.classList.toggle('is-write', marks.write === i);
    });
    regs.pc.querySelector('.v').textContent = pc;
    regs.a.querySelector('.v').textContent = a;
    regs.ir.querySelector('.v').textContent = hex2(ir);
    ['pc', 'a', 'ir'].forEach(k => regs[k].classList.toggle('hot', marks.reg === k));
    phases.forEach((p, i) => p.classList.toggle('on', i === marks.lit));
  }

  function step() {
    if (phase === 0) {                                   // FETCH
      ir = mem[pc];
      narrate('<b>Fetch.</b> The PC says <b>' + pc + '</b>, so read cell ' + pc +
        '. It holds <b>' + hex2(ir) + '</b> — into the instruction register it goes.');
      phase = 1;
      render({ read: pc, reg: 'ir', lit: 0 });
    } else if (phase === 1) {                            // DECODE
      const op = ir >> 4, n = ir & 15;
      const words = {
        1: 'opcode 1 = <b>LOAD</b>: copy cell ' + n + ' into register A.',
        2: 'opcode 2 = <b>ADD</b>: add cell ' + n + ' to register A.',
        3: 'opcode 3 = <b>STORE</b>: write register A into cell ' + n + '.',
        4: 'opcode 4 = <b>JUMP</b>: set the PC to ' + n + '.',
      };
      narrate('<b>Decode.</b> ' + hex2(ir) + ' splits into opcode <b>' + op +
        '</b> and operand <b>' + n + '</b> — ' + (words[op] || 'not a known opcode; a real CPU would fault.'));
      phase = 2;
      render({ reg: 'ir', lit: 1 });
    } else {                                             // EXECUTE
      const op = ir >> 4, n = ir & 15;
      let marks = {};
      if (op === 1) {
        a = mem[n]; pc = (pc + 1) & 15;
        narrate('<b>Execute.</b> A ← cell ' + n + ' — so A is now <b>' + a + '</b>. PC steps to ' + pc + '.');
        marks = { read: n, reg: 'a' };
      } else if (op === 2) {
        a = (a + mem[n]) & 0xff; pc = (pc + 1) & 15;
        narrate('<b>Execute.</b> A + cell ' + n + ' → A is now <b>' + a + '</b>. PC steps to ' + pc + '.');
        marks = { read: n, reg: 'a' };
      } else if (op === 3) {
        mem[n] = a; pc = (pc + 1) & 15;
        narrate('<b>Execute.</b> Cell ' + n + ' ← A — memory now remembers <b>' + a + '</b>. PC steps to ' + pc + '.');
        marks = { write: n, reg: 'a' };
      } else if (op === 4) {
        pc = n & 15;
        narrate('<b>Execute.</b> A branch! The PC is overwritten with <b>' + n +
          '</b>, so the loop starts over. Cell 14 keeps counting up by 3 — watch it.');
        marks = { reg: 'pc' };
      } else {
        pc = (pc + 1) & 15;
        narrate('<b>Execute.</b> Unknown opcode — skipped. (Position and convention are everything.)');
      }
      phase = 0;
      marks.lit = 2;
      render(marks);
    }
  }

  function setRunning(on) {
    if (on && !timer) {
      timer = setInterval(step, REDUCED ? 1100 : 650);
      runBtn.textContent = 'Pause';
    } else if (!on && timer) {
      clearInterval(timer); timer = null;
      runBtn.textContent = 'Run';
    }
  }

  root.querySelector('[data-tc-step]').addEventListener('click', () => { setRunning(false); step(); });
  runBtn.addEventListener('click', () => setRunning(!timer));
  root.querySelector('[data-tc-reset]').addEventListener('click', () => { setRunning(false); reset(); });
  whenVisible(root, () => { visible = true; }, () => { visible = false; setRunning(false); });

  reset();
}

/* ==========================================================================
   Module 03 — float anatomy
   32 toggle buttons wired to a real Float32: flip bits, read the decoded
   fields and the exact stored value. Presets show the classic citizens.
   ========================================================================== */
function FloatLab(root) {
  const bitsEl = root.querySelector('[data-float-bits]');
  const outSign = root.querySelector('[data-f-sign]');
  const outExp = root.querySelector('[data-f-exp]');
  const outMan = root.querySelector('[data-f-man]');
  const outVal = root.querySelector('[data-f-val]');
  const outNote = root.querySelector('[data-f-note]');
  const dv = new DataView(new ArrayBuffer(4));

  let u32 = 0x3f800000;                                  // 1.0
  let noteOverride = null;

  /* build the 32 toggles, MSB first, with gaps after sign and exponent */
  const btns = [];
  for (let i = 31; i >= 0; i--) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bit ' + (i === 31 ? 'sign' : i >= 23 ? 'exp' : 'man');
    b.setAttribute('aria-label', 'bit ' + i);
    b.addEventListener('click', () => { u32 ^= (1 << i) >>> 0; u32 >>>= 0; noteOverride = null; clearPresets(); render(); });
    bitsEl.appendChild(b);
    btns.push({ i, b });
    if (i === 31 || i === 23) {
      const gap = document.createElement('span');
      gap.className = 'bit-gap';
      bitsEl.appendChild(gap);
    }
  }

  function f32() { dv.setUint32(0, u32); return dv.getFloat32(0); }
  function fromFloat(x) { dv.setFloat32(0, x); return dv.getUint32(0); }

  /* exact-ish decimal of the stored single: a double holds any float32
     exactly, and 21 significant digits shows the whole truth of e.g. 0.1 */
  function exact(x) {
    if (Number.isNaN(x)) return 'NaN';
    if (!Number.isFinite(x)) return (x > 0 ? '+' : '−') + 'Infinity';
    if (x === 0) return (1 / x < 0 ? '−0' : '0') + '.0';
    let s = x.toPrecision(21);
    if (s.includes('e')) return s;
    s = s.replace(/0+$/, '');
    if (s.endsWith('.')) s += '0';
    return s;
  }

  function render() {
    btns.forEach(({ i, b }) => {
      const on = (u32 >>> i) & 1;
      b.textContent = on;
      b.classList.toggle('on', !!on);
    });
    const sign = (u32 >>> 31) & 1;
    const expRaw = (u32 >>> 23) & 0xff;
    const man = u32 & 0x7fffff;
    const v = f32();

    outSign.textContent = sign ? '1 → negative' : '0 → positive';
    if (expRaw === 0) {
      outExp.textContent = '00000000 (all zeros) → denormal zone: exponent fixed at −126, no implied 1';
    } else if (expRaw === 255) {
      outExp.textContent = '11111111 (all ones) → special zone: Infinity (mantissa 0) or NaN (mantissa ≠ 0)';
    } else {
      outExp.textContent = expRaw.toString(2).padStart(8, '0') + ' = ' + expRaw + ' → 2^(' + expRaw + ' − 127) = 2^' + (expRaw - 127);
    }
    const manBin = man.toString(2).padStart(23, '0');
    if (expRaw > 0 && expRaw < 255) {
      outMan.textContent = (expRaw ? '1.' : '0.') + manBin + '₂ = ' + (1 + man / 0x800000);
    } else if (expRaw === 0) {
      outMan.textContent = '0.' + manBin + '₂ = ' + (man / 0x800000) + ' (no implied leading 1)';
    } else {
      outMan.textContent = manBin + (man ? ' → NaN payload' : ' → Infinity');
    }
    outVal.textContent = exact(v) + '   (raw 0x' + u32.toString(16).toUpperCase().padStart(8, '0') + ')';

    let note;
    if (noteOverride) note = noteOverride;
    else if (Number.isNaN(v)) note = 'Not-a-Number. NaN ≠ NaN by definition — and its exact payload bits are one of Module 14’s emulation headaches.';
    else if (!Number.isFinite(v)) note = 'Infinity — the exponent field is saturated. One step beyond the biggest finite single.';
    else if (v === 0) note = (sign ? 'Negative zero: equal to +0 in every comparison, yet a different bit pattern — 1/−0 = −Infinity.' : 'Positive zero — all 32 bits clear.');
    else if (expRaw === 0) note = 'A denormal: smaller than any normalised single. These keep underflow gradual — and are another spot where hosts and guests can disagree (Module 14).';
    else {
      const ulp = Math.pow(2, (expRaw - 127) - 23);
      note = 'A normal number. Near this value the representable ticks are ' + ulp.toExponential(3) + ' apart — anything between two ticks rounds to the nearer one.';
    }
    outNote.innerHTML = note;
  }

  function clearPresets() { root.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('on')); }

  const PRESETS = {
    one:    { u: 0x3f800000, note: '1.0 exactly: exponent field 127 (=2⁰), mantissa empty — the implied leading 1 does all the work.' },
    tenth:  { u: fromFloat(0.1), note: 'You asked for 0.1 — but 1/10 repeats forever in binary, so the format stores the nearest tick. Read the stored value: <em>that</em> is what every &ldquo;0.1&rdquo; in a 32-bit game really is.' },
    pi:     { u: fromFloat(Math.PI), note: 'π to the nearest single — 24 significant bits’ worth. The infinite tail is simply cut and rounded.' },
    max:    { u: 0x7f7fffff, note: 'The biggest finite single: mantissa all ones, exponent one notch below the special zone ≈ 3.4028 × 10³⁸. One bit more and it’s Infinity.' },
    min:    { u: 0x00000001, note: 'The smallest positive value of all: one lone mantissa bit in the denormal zone ≈ 1.4 × 10⁻⁴⁵. The gentlest possible step above zero.' },
    nan:    { u: 0x7fc00000, note: 'A quiet NaN — the result of 0/0 or √−1. Note it’s a whole family of bit patterns, not one value.' },
    negzero:{ u: 0x80000000, note: 'Minus zero: only the sign bit set. It exists because the sign field is independent — a quirk emulators must preserve bit-for-bit.' },
  };
  root.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    clearPresets();
    b.classList.add('on');
    const p = PRESETS[b.dataset.preset];
    u32 = p.u >>> 0;
    noteOverride = p.note;
    render();
  }));

  render();
}

/* ==========================================================================
   Module 04 — pipeline
   Five stage boxes; an instruction stream where every 5th instruction is a
   taken branch. Prediction off: the branch resolving in EX turns the two
   younger stages into bubbles. Prediction on: fetch already followed the
   target, so nothing is lost. Live CPI = cycles / completed.
   ========================================================================== */
function PipelineLab(root) {
  const stagesEl = root.querySelector('[data-pl-stages]');
  const outCycles = root.querySelector('[data-pl-cycles]');
  const outDone = root.querySelector('[data-pl-done]');
  const outCpi = root.querySelector('[data-pl-cpi]');
  const outFlush = root.querySelector('[data-pl-flushes]');
  const runBtn = root.querySelector('[data-pl-run]');

  const STAGE_NAMES = ['IF · fetch', 'ID · decode', 'EX · execute', 'MEM', 'WB · write back'];
  const slots = STAGE_NAMES.map(nm => {
    const d = document.createElement('div');
    d.className = 'pl-cell';
    d.innerHTML = '<div class="lbl">' + nm + '</div><div><span class="pl-ins empty">—</span></div>';
    stagesEl.appendChild(d);
    return d.querySelector('.pl-ins');
  });

  const KINDS = ['add', 'lwz', 'mul', 'stw'];
  let pipe, n, cycles, done, flushes, predict = false, timer = null;

  function nextInstr() {
    n++;
    if (n % 5 === 0) return { label: 'beq →', branch: true };
    return { label: KINDS[n % KINDS.length] + ' r' + (n % 7 + 2) };
  }

  function reset() {
    pipe = [null, null, null, null, null];
    n = 0; cycles = 0; done = 0; flushes = 0;
    render();
  }

  function clock() {
    cycles++;
    const retiring = pipe[4];
    if (retiring && !retiring.bubble) done++;
    // advance and fetch
    pipe = [nextInstrOrRefill(), pipe[0], pipe[1], pipe[2], pipe[3]];
    // a branch reaching EX with prediction off flushes the two younger stages
    const ex = pipe[2];
    if (ex && ex.branch && !ex.handled) {
      ex.handled = true;
      if (!predict) {
        [0, 1].forEach(i => {
          if (pipe[i] && !pipe[i].bubble) { pipe[i] = { label: 'bubble', bubble: true }; flushes++; }
        });
      }
    }
    render();
  }
  function nextInstrOrRefill() { return nextInstr(); }

  function render() {
    pipe.forEach((ins, i) => {
      const el = slots[i];
      if (!ins) { el.textContent = '—'; el.className = 'pl-ins empty'; return; }
      el.textContent = ins.label;
      el.className = 'pl-ins' + (ins.branch ? ' branch' : '') + (ins.bubble ? ' bubble' : '');
    });
    outCycles.textContent = cycles;
    outDone.textContent = done;
    outCpi.textContent = done ? (cycles / done).toFixed(2) : '—';
    outFlush.textContent = flushes;
  }

  function setRunning(on) {
    if (on && !timer) { timer = setInterval(clock, REDUCED ? 900 : 480); runBtn.textContent = 'Pause'; }
    else if (!on && timer) { clearInterval(timer); timer = null; runBtn.textContent = 'Run'; }
  }

  root.querySelector('[data-pl-step]').addEventListener('click', () => { setRunning(false); clock(); });
  runBtn.addEventListener('click', () => setRunning(!timer));
  root.querySelector('[data-pl-reset]').addEventListener('click', () => { setRunning(false); reset(); });
  root.querySelectorAll('[data-pred]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-pred]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    predict = b.dataset.pred === 'on';
  }));
  whenVisible(root, () => {}, () => setRunning(false));

  reset();
}

/* ==========================================================================
   Module 06 — cache
   256 bytes of memory drawn as 64 four-byte blocks; an 8-line direct-mapped
   cache. Word accesses follow a pattern; line = ⌊addr / lineSize⌋, set =
   line mod 8. Hits flash green, misses red; violet outline = currently
   cached. The line-size slider is the spatial-locality experiment.
   ========================================================================== */
function CacheLab(root) {
  const memEl = root.querySelector('[data-cache-mem]');
  const rowsEl = root.querySelector('[data-cache-rows]');
  const outH = root.querySelector('[data-c-hits]');
  const outM = root.querySelector('[data-c-miss]');
  const outR = root.querySelector('[data-c-rate]');
  const lineR = root.querySelector('[data-line]');
  const lineV = root.querySelector('[data-line-val]');
  const runBtn = root.querySelector('[data-c-run]');

  const MEM_BYTES = 256, SETS = 8;
  const memCells = [], slotCells = [];
  for (let i = 0; i < 64; i++) {
    const c = document.createElement('div');
    c.className = 'cm-cell';
    memEl.appendChild(c);
    memCells.push(c);
  }
  for (let i = 0; i < SETS; i++) {
    const c = document.createElement('div');
    c.className = 'cr-cell';
    c.innerHTML = '<span class="idx">set ' + i + '</span><span class="tag">—</span>';
    rowsEl.appendChild(c);
    slotCells.push(c);
  }

  let cache, addr, hits, misses, pattern = 'seq', timer = null;
  const lineBytes = () => 4 << parseInt(lineR.value, 10);   // 4/8/16/32

  function reset() {
    cache = new Array(SETS).fill(-1);
    addr = 0; hits = 0; misses = 0;
    memCells.forEach(c => { c.className = 'cm-cell'; });
    slotCells.forEach(c => { c.className = 'cr-cell'; c.querySelector('.tag').textContent = '—'; });
    stats();
  }

  function stats() {
    outH.textContent = hits;
    outM.textContent = misses;
    const t = hits + misses;
    outR.textContent = t ? Math.round(100 * hits / t) + '%' : '—';
  }

  function paintCached() {
    const L = lineBytes();
    memCells.forEach((c, i) => {
      const line = Math.floor(i * 4 / L);
      c.classList.toggle('cached', cache[line % SETS] === line);
    });
  }

  function access() {
    // advance the pattern
    if (pattern === 'seq') addr = (addr + 4) % MEM_BYTES;
    else if (pattern === 'stride') addr = (addr + 64) % MEM_BYTES;
    else addr = 4 * Math.floor(Math.random() * 64);

    const L = lineBytes();
    const line = Math.floor(addr / L);
    const set = line % SETS;
    const hit = cache[set] === line;
    if (hit) hits++; else { misses++; cache[set] = line; }

    // flashes
    const mc = memCells[addr >> 2];
    mc.classList.remove('hit', 'miss');
    void mc.offsetWidth;                                   // restart the transition
    mc.classList.add(hit ? 'hit' : 'miss');
    setTimeout(() => mc.classList.remove('hit', 'miss'), 260);
    const sc = slotCells[set];
    sc.querySelector('.tag').textContent = 'line ' + cache[set];
    sc.classList.remove('flash-hit', 'flash-miss');
    void sc.offsetWidth;
    sc.classList.add(hit ? 'flash-hit' : 'flash-miss');
    setTimeout(() => sc.classList.remove('flash-hit', 'flash-miss'), 260);

    paintCached();
    stats();
  }

  function setRunning(on) {
    if (on && !timer) { timer = setInterval(access, REDUCED ? 550 : 180); runBtn.textContent = 'Pause'; }
    else if (!on && timer) { clearInterval(timer); timer = null; runBtn.textContent = 'Run'; }
  }

  lineR.addEventListener('input', () => {
    lineV.textContent = lineBytes() + ' bytes';
    reset();                                               // new geometry, fresh cache
  });
  root.querySelectorAll('[data-pattern]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-pattern]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    pattern = b.dataset.pattern;
  }));
  runBtn.addEventListener('click', () => setRunning(!timer));
  root.querySelector('[data-c-reset]').addEventListener('click', () => { setRunning(false); reset(); });
  whenVisible(root, () => {}, () => setRunning(false));

  lineV.textContent = lineBytes() + ' bytes';
  reset();
}

/* ==========================================================================
   Module 08 — paired singles
   A cloud of points wants to rotate every frame, but only a fixed budget of
   float ops is available. Rotating one point costs 4 ops in scalar mode and
   2 in paired mode (two floats per op), so paired mode refreshes twice as
   many points per frame — stale points visibly lag the rotation.
   ========================================================================== */
function PsLab(root) {
  const canvas = root.querySelector('.ps-canvas');
  const outOps = root.querySelector('[data-ps-ops]');
  const outPts = root.querySelector('[data-ps-pts]');
  const budR = root.querySelector('[data-ps-budget]');
  const budV = root.querySelector('[data-ps-budget-val]');

  const N = 720;
  const pts = [];
  for (let i = 0; i < N; i++) {
    // three rings plus spokes — enough structure that shearing is obvious
    const ring = i % 3;
    const baseA = (i / N) * Math.PI * 2 * (7 + ring);
    const r = 0.30 + ring * 0.22 + 0.045 * Math.sin(i * 1.7);
    pts.push({ r, baseA, ang: 0, fresh: false });
  }

  let mode = 'paired', theta = 0, cursor = 0, raf = null, running = false;

  function costPerPoint() { return mode === 'paired' ? 2 : 4; }

  function frame() {
    const { ctx, W, H } = fitCanvas(canvas);
    const budget = parseInt(budR.value, 10);
    const k = Math.min(N, Math.floor(budget / costPerPoint()));

    theta += REDUCED ? 0 : 0.02;
    pts.forEach(p => { p.fresh = false; });
    for (let j = 0; j < k; j++) {                          // round-robin update
      const p = pts[cursor];
      p.ang = theta;                                       // "transformed" this frame
      p.fresh = true;
      cursor = (cursor + 1) % N;
    }

    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, S = Math.min(W, H) * 0.46;
    pts.forEach(p => {
      const a = p.baseA + p.ang;
      const x = cx + Math.cos(a) * p.r * S;
      const y = cy + Math.sin(a) * p.r * S * 0.92;
      ctx.fillStyle = p.fresh ? 'rgba(69,228,209,0.95)' : 'rgba(168,132,255,0.38)';
      ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
    });

    outOps.textContent = budget + ' ops';
    outPts.textContent = k + ' / ' + N + (k >= N ? ' — whole cloud, every frame' : '');
    if (running) raf = requestAnimationFrame(frame);
  }

  function start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

  budR.addEventListener('input', () => { budV.textContent = budR.value + ' ops'; if (!running) frame(); });
  root.querySelectorAll('[data-ps-mode]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-ps-mode]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    mode = b.dataset.psMode;
    if (!running) frame();
  }));
  window.addEventListener('resize', () => { if (!running) frame(); });
  whenVisible(root, () => (REDUCED ? frame() : start()), stop);
  budV.textContent = budR.value + ' ops';
}

/* ==========================================================================
   Module 09 — quantisation
   One coordinate through the GQR recipe: stored = round(v · 2^s) clamped to
   the integer width; reconstructed = stored / 2^s. The canvas quantises a
   whole strip of vertices with the same recipe so the error becomes a
   visible wobble.
   ========================================================================== */
function QuantLab(root) {
  const canvas = root.querySelector('.quant-canvas');
  const valR = root.querySelector('[data-q-val]');
  const valL = root.querySelector('[data-q-val-lbl]');
  const scaleR = root.querySelector('[data-q-scale]');
  const scaleL = root.querySelector('[data-q-scale-val]');
  const outBits = root.querySelector('[data-q-bits]');
  const outStored = root.querySelector('[data-q-stored]');
  const outRecon = root.querySelector('[data-q-recon]');
  const outErr = root.querySelector('[data-q-err]');
  const outMem = root.querySelector('[data-q-mem]');
  const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
  const sup = n => String(n).split('').map(c => SUP[+c]).join('');

  let bits = 8;

  function quantise(v, b, s) {
    const scale = Math.pow(2, s);
    const lo = -(1 << (b - 1)), hi = (1 << (b - 1)) - 1;
    const stored = clamp(Math.round(v * scale), lo, hi);
    return { stored, recon: stored / scale, clamped: stored === lo || stored === hi };
  }

  function twoc(stored, b) {
    const m = (stored + (1 << b)) % (1 << b);
    return m.toString(2).padStart(b, '0').replace(/(.{4})(?=.)/g, '$1 ');
  }

  function render() {
    const v = parseInt(valR.value, 10) / 100;
    const s = parseInt(scaleR.value, 10);
    valL.textContent = v.toFixed(3);
    scaleL.textContent = '2' + sup(s) + ' = ' + Math.pow(2, s);

    const q = quantise(v, bits, s);
    outBits.textContent = twoc(q.stored, bits) + (q.clamped ? '  — CLAMPED: value outside this scale’s range!' : '');
    outStored.textContent = q.stored + '  (' + bits + '-bit signed, range ' + (-(1 << (bits - 1))) + ' … ' + ((1 << (bits - 1)) - 1) + ')';
    outRecon.textContent = q.recon + '  =  ' + q.stored + ' ÷ ' + Math.pow(2, s);
    const err = v - q.recon;
    outErr.textContent = (err === 0 ? '0 — landed exactly on a tick' : err.toExponential(3));
    outMem.textContent = 'float 4 B → ' + (bits / 8) + ' B stored · ' + (100 - 100 * (bits / 8) / 4) + '% saved';

    // curve: a strip of 44 vertices, true vs quantised
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, W, H);
    const pad = 12 * dpr;
    const yOf = t => H / 2 - t * (H / 2 - pad);
    const curve = x => 0.55 * Math.sin(x * 6.4) + 0.28 * Math.sin(x * 14.2 + 1.4);

    ctx.strokeStyle = 'rgba(90,78,130,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    ctx.strokeStyle = '#45e4d1'; ctx.lineWidth = 2 * dpr; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      const px = pad + x * (W - 2 * pad), py = yOf(curve(x));
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.strokeStyle = '#ff5f9e'; ctx.fillStyle = '#ff5f9e'; ctx.lineWidth = 1.8 * dpr;
    ctx.beginPath();
    const NV = 44;
    for (let i = 0; i <= NV; i++) {
      const x = i / NV;
      const qy = quantise(curve(x), bits, s).recon;
      const px = pad + x * (W - 2 * pad), py = yOf(qy);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    for (let i = 0; i <= NV; i++) {
      const x = i / NV;
      const qy = quantise(curve(x), bits, s).recon;
      ctx.beginPath();
      ctx.arc(pad + x * (W - 2 * pad), yOf(qy), 2.2 * dpr, 0, 7);
      ctx.fill();
    }
    ctx.font = '600 ' + (11 * dpr) + 'px ui-monospace, monospace';
    ctx.fillStyle = '#45e4d1'; ctx.fillText('true vertices', pad, 16 * dpr);
    ctx.fillStyle = '#ff5f9e'; ctx.fillText('reconstructed from ' + bits + '-bit · scale 2^' + s, pad, 32 * dpr);
  }

  valR.addEventListener('input', render);
  scaleR.addEventListener('input', render);
  root.querySelectorAll('[data-q-fmt]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-q-fmt]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    bits = parseInt(b.dataset.qFmt, 10);
    render();
  }));
  window.addEventListener('resize', render);
  render();
}

/* ==========================================================================
   Module 11 — locked cache & DMA
   One frame of work, eight batches, two philosophies. Lane A computes through
   the normal cache and eats randomly-placed miss stalls; lane B computes from
   the locked scratchpad while a DMA engine stages batches underneath. A
   playhead sweeps the timeline; red slices are pipeline stalls.
   ========================================================================== */
function DmaLab(root) {
  const canvas = root.querySelector('.dma-canvas');
  const outA = root.querySelector('[data-dma-a]');
  const outB = root.querySelector('[data-dma-b]');
  const outS = root.querySelector('[data-dma-stall]');
  const missR = root.querySelector('[data-dma-miss]');
  const missV = root.querySelector('[data-dma-miss-val]');

  const BATCHES = 8, WORK = 20;                            // 8 × 20 work ticks
  let laneA, laneB, dma, totalA, totalB, stallA, raf = null, play = 0, visible = false, ran = false;

  function build() {
    const p = parseInt(missR.value, 10) / 100;
    laneA = []; stallA = 0;
    for (let b = 0; b < BATCHES; b++) {
      for (let w = 0; w < WORK; w++) {
        laneA.push({ t: 'work' });
        if (Math.random() < p) {
          const len = 3 + Math.floor(Math.random() * 6);   // a miss costs 3–8
          laneA.push({ t: 'stall', len });
          stallA += len;
        }
      }
    }
    totalA = laneA.reduce((s, seg) => s + (seg.len || 1), 0);

    // lane B: one up-front DMA fill, then pure compute; DMA overlaps below
    const FILL = 12, SYNC = 1;
    laneB = [{ t: 'stall', len: FILL, dma: true }];
    for (let b = 0; b < BATCHES; b++) {
      for (let w = 0; w < WORK; w++) laneB.push({ t: 'work' });
      if (b < BATCHES - 1) laneB.push({ t: 'sync', len: SYNC });
    }
    totalB = laneB.reduce((s, seg) => s + (seg.len || 1), 0);
    dma = [];
    let at = 0;
    for (let b = 0; b < BATCHES; b++) { dma.push({ from: at, len: FILL }); at += WORK + SYNC; }

    outA.textContent = totalA + ' cycles';
    outB.textContent = totalB + ' cycles';
    outS.textContent = stallA + ' cycles (' + Math.round(100 * stallA / totalA) + '% of the cached run)';
  }

  function draw(prog) {
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, W, H);
    const padL = 10 * dpr, padR = 10 * dpr;
    const span = Math.max(totalA, totalB);
    const xOf = t => padL + (W - padL - padR) * (t / span);
    const font = px => { ctx.font = '600 ' + (px * dpr) + 'px ui-monospace, monospace'; };

    function lane(segs, y, h, colWork) {
      let t = 0;
      segs.forEach(seg => {
        const len = seg.len || 1;
        const x0 = xOf(t), x1 = xOf(Math.min(t + len, prog));
        if (t < prog) {
          ctx.fillStyle = seg.t === 'work' ? colWork : seg.t === 'sync' ? 'rgba(168,132,255,0.8)' : seg.dma ? 'rgba(168,132,255,0.55)' : 'rgba(255,106,106,0.85)';
          ctx.fillRect(x0, y, Math.max(1, x1 - x0), h);
        }
        t += len;
      });
    }

    font(11);
    ctx.fillStyle = '#877f9e';
    ctx.fillText('A · CPU reads through the cache — misses land where fate says', padL, 22 * dpr);
    lane(laneA, 30 * dpr, 34 * dpr, 'rgba(69,228,209,0.85)');
    ctx.fillText('B · CPU computes from the locked scratchpad', padL, 96 * dpr);
    lane(laneB, 104 * dpr, 34 * dpr, 'rgba(255,177,78,0.9)');
    ctx.fillText('DMA engine — staging the next batch, in the background', padL, 168 * dpr);
    dma.forEach(d => {
      const x0 = xOf(d.from), x1 = xOf(Math.min(d.from + d.len, prog));
      if (d.from < prog) {
        ctx.fillStyle = 'rgba(168,132,255,0.6)';
        ctx.fillRect(x0, 176 * dpr, Math.max(1, x1 - x0), 20 * dpr);
      }
    });
    // finish flags
    [['A', totalA, 30], ['B', totalB, 104]].forEach(([nm, tot, y]) => {
      if (prog >= tot) {
        ctx.strokeStyle = '#ece8f6'; ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath(); ctx.moveTo(xOf(tot), (y - 6) * dpr); ctx.lineTo(xOf(tot), (y + 40) * dpr); ctx.stroke();
        font(10.5); ctx.fillStyle = '#ece8f6';
        ctx.fillText(tot + '', Math.min(xOf(tot) + 4 * dpr, W - 34 * dpr), (y + 4) * dpr);
      }
    });
    // playhead
    if (prog < span) {
      ctx.strokeStyle = 'rgba(236,232,246,0.65)'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(xOf(prog), 26 * dpr); ctx.lineTo(xOf(prog), 200 * dpr); ctx.stroke();
    }
    font(10.5);
    ctx.fillStyle = '#5fd18b'; ctx.fillText('■ compute', padL, H - 10 * dpr);
    ctx.fillStyle = '#ff6a6a'; ctx.fillText('■ stall (miss)', padL + 90 * dpr, H - 10 * dpr);
    ctx.fillStyle = '#a884ff'; ctx.fillText('■ DMA / sync', padL + 200 * dpr, H - 10 * dpr);
  }

  function replay() {
    build();
    if (raf) cancelAnimationFrame(raf);
    if (REDUCED) { draw(Math.max(totalA, totalB)); return; }
    play = 0;
    const span = Math.max(totalA, totalB);
    const tick = () => {
      play += span / 220;                                  // ~3.5 s sweep
      draw(play);
      if (play < span && visible) raf = requestAnimationFrame(tick);
      else draw(span);
    };
    raf = requestAnimationFrame(tick);
  }

  missR.addEventListener('input', () => { missV.textContent = missR.value + '%'; });
  root.querySelector('[data-dma-run]').addEventListener('click', replay);
  window.addEventListener('resize', () => { if (totalA) draw(Math.max(totalA, totalB)); });
  whenVisible(root,
    () => { visible = true; if (!ran) { ran = true; replay(); } },
    () => { visible = false; if (raf) cancelAnimationFrame(raf); });
}

/* ==========================================================================
   Module 13 — JIT race
   One hot loop of 12 guest instructions, run R times. The interpreter pays
   8 ticks per instruction, every time. The JIT pays a one-off compile toll
   (60 ticks per instruction, shown striped) and then 1 tick per instruction.
   Both lanes advance on the same clock; amortisation does the rest.
   ========================================================================== */
function JitLab(root) {
  const BLOCK = 12, INT_COST = 8, COMPILE = 60, JIT_COST = 1;
  const fillI = root.querySelector('[data-int-fill]');
  const fillJ = root.querySelector('[data-jit-fill]');
  const ipsI = root.querySelector('[data-int-ips]');
  const ipsJ = root.querySelector('[data-jit-ips]');
  const nI = root.querySelector('[data-int-n]');
  const nJ = root.querySelector('[data-jit-n]');
  const chip = root.querySelector('[data-block-chip]');
  const runsR = root.querySelector('[data-jit-runs]');
  const runsV = root.querySelector('[data-jit-runs-val]');

  let raf = null, state = null, visible = true;

  function reset() {
    if (raf) cancelAnimationFrame(raf);
    state = null;
    fillI.style.width = '0%';
    fillJ.style.width = '0%';
    fillJ.classList.remove('compiling');
    ipsI.textContent = '0 inst/s';
    ipsJ.textContent = '0 inst/s';
    nI.textContent = '0';
    nJ.textContent = '0';
    chip.classList.remove('on');
    chip.textContent = 'block cache · empty';
  }

  function race() {
    reset();
    const R = parseInt(runsR.value, 10);
    const totalInst = R * BLOCK;
    const ticksI = totalInst * INT_COST;
    const ticksJ = BLOCK * COMPILE + totalInst * JIT_COST;
    const span = Math.max(ticksI, ticksJ);
    state = { t: 0, t0: performance.now(), span, R, totalInst, ticksI, ticksJ };
    const perFrame = span / (REDUCED ? 1 : 240);           // ~4 s race

    const tick = () => {
      const s = state;
      if (!s) return;
      s.t = Math.min(s.span, s.t + perFrame);
      const el = (performance.now() - s.t0) / 1000 || 1e-3;

      // interpreter lane
      const instI = Math.min(s.totalInst, Math.floor(s.t / INT_COST));
      fillI.style.width = (100 * instI / s.totalInst) + '%';
      nI.textContent = instI.toLocaleString();
      ipsI.textContent = Math.round(instI / el).toLocaleString() + ' inst/s';

      // JIT lane: compile phase first
      const compileTicks = BLOCK * COMPILE;
      if (s.t < compileTicks) {
        fillJ.classList.add('compiling');
        fillJ.style.width = (100 * (s.t / compileTicks) * (compileTicks / s.ticksJ)) + '%';
        nJ.textContent = '0 — compiling the block…';
        ipsJ.textContent = '0 inst/s';
      } else {
        fillJ.classList.remove('compiling');
        if (!chip.classList.contains('on')) {
          chip.classList.add('on');
          chip.textContent = 'block cache · 0x80003100 ✓';
        }
        const instJ = Math.min(s.totalInst, Math.floor((s.t - compileTicks) / JIT_COST));
        fillJ.style.width = (100 * (compileTicks + instJ * JIT_COST) / s.ticksJ) + '%';
        nJ.textContent = instJ.toLocaleString();
        ipsJ.textContent = Math.round(instJ / el).toLocaleString() + ' inst/s';
      }

      if (s.t < s.span && visible) raf = requestAnimationFrame(tick);
      else if (s.t >= s.span) {
        const verdict = s.ticksJ < s.ticksI
          ? 'JIT wins by ' + (s.ticksI / s.ticksJ).toFixed(1) + '×'
          : 'interpreter wins — too few runs to repay the compile';
        ipsJ.textContent += ' · ' + verdict;
      }
    };
    raf = requestAnimationFrame(tick);
  }

  runsR.addEventListener('input', () => { runsV.textContent = runsR.value; });
  root.querySelector('[data-jit-go]').addEventListener('click', race);
  root.querySelector('[data-jit-reset]').addEventListener('click', reset);
  whenVisible(root, () => { visible = true; }, () => { visible = false; if (raf) cancelAnimationFrame(raf); });
  reset();
}

/* ------------------------------------------------------- hero ambient canvas
   Instruction "cells" drifting rightwards along five faint pipeline lanes.
   Every few seconds one lane suffers a branch flush: a ripple sweeps through
   and clears the cells ahead of it. Low-opacity; static under reduced motion. */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let raf = null, running = false;
  function size() { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
  size();
  window.addEventListener('resize', size);

  const LANES = 5;
  const COLS = ['rgba(69,228,209,', 'rgba(168,132,255,', 'rgba(255,95,158,', 'rgba(255,177,78,', 'rgba(183,175,206,'];
  const cells = [];
  let flush = null, lastFlush = 0;

  function spawn(x) {
    const lane = Math.floor(Math.random() * LANES);
    cells.push({
      lane,
      x: x !== undefined ? x : -0.05,
      v: 0.0016 + Math.random() * 0.0022 + lane * 0.0003,
      w: 0.018 + Math.random() * 0.03,
      col: COLS[lane % COLS.length],
      a: 0.16 + Math.random() * 0.2,
    });
  }
  for (let i = 0; i < 42; i++) spawn(Math.random());

  function draw(now) {
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const laneY = i => H * (0.16 + i * 0.17);

    // faint lanes
    c.lineWidth = 1;
    for (let i = 0; i < LANES; i++) {
      c.strokeStyle = 'rgba(90,78,130,0.14)';
      c.beginPath(); c.moveTo(0, laneY(i)); c.lineTo(W, laneY(i)); c.stroke();
    }

    // occasional branch flush
    if (!REDUCED && now - lastFlush > 5200 + Math.random() * 2600) {
      lastFlush = now;
      flush = { lane: Math.floor(Math.random() * LANES), x: 0.9, r: 0 };
      // cells ahead of the flush point on that lane are wrong-path work
      for (let i = cells.length - 1; i >= 0; i--) {
        if (cells[i].lane === flush.lane && cells[i].x < flush.x) cells.splice(i, 1);
      }
    }

    cells.forEach(cell => {
      if (!REDUCED) cell.x += cell.v;
      const y = laneY(cell.lane);
      c.fillStyle = cell.col + cell.a + ')';
      const w = cell.w * W, h = 7 * dpr;
      c.beginPath();
      c.roundRect ? c.roundRect(cell.x * W, y - h / 2, w, h, 3 * dpr) : c.rect(cell.x * W, y - h / 2, w, h);
      c.fill();
    });
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i].x > 1.02) cells.splice(i, 1);
    while (cells.length < 42) spawn();

    if (flush) {
      flush.r += 0.02;
      const y = laneY(flush.lane);
      c.strokeStyle = 'rgba(255,106,106,' + Math.max(0, 0.35 - flush.r * 0.35) + ')';
      c.lineWidth = 2 * dpr;
      c.beginPath();
      c.arc(flush.x * W, y, flush.r * H * 0.9, 0, 7);
      c.stroke();
      if (flush.r > 1) flush = null;
    }

    if (running && !REDUCED) raf = requestAnimationFrame(draw);
  }

  function start() { if (!running) { running = true; REDUCED ? draw(0) : raf = requestAnimationFrame(draw); } }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }
  whenVisible(canvas, start, stop);
}

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
    tip.innerHTML = '<span class="tt">' + label.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</span> — ' +
      el.getAttribute('data-tip').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
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

/* ==========================================================================
   Wire-up
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  /* hero ambient pipeline */
  const heroCanvas = document.getElementById('hero-pipe');
  if (heroCanvas) heroAmbient(heroCanvas);

  /* labs */
  const tc = document.getElementById('lab-toycpu');   if (tc) ToyCpuLab(tc);
  const fl = document.getElementById('lab-float');    if (fl) FloatLab(fl);
  const pl = document.getElementById('lab-pipeline'); if (pl) PipelineLab(pl);
  const cl = document.getElementById('lab-cache');    if (cl) CacheLab(cl);
  const ps = document.getElementById('lab-ps');       if (ps) PsLab(ps);
  const ql = document.getElementById('lab-quant');    if (ql) QuantLab(ql);
  const dl = document.getElementById('lab-dma');      if (dl) DmaLab(dl);
  const jl = document.getElementById('lab-jit');      if (jl) JitLab(jl);

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
