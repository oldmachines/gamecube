/* ============================================================================
   GameCube Audio — interactive layer
   Everything you hear is synthesised in your browser with the Web Audio API.
   No copyrighted game audio ships with this page; the demos recreate the DSP's
   *behaviour* (ADPCM quantisation, sample-rate conversion, voice mixing,
   Pro Logic II matrix steering) so you can hear the concepts, not the games.
   ============================================================================ */
'use strict';

/* -------------------------------------------------------- audio foundation */
const Engine = (() => {
  let ctx = null;
  let master = null, analyser = null;
  let current = null;          // active source node group we can stop
  let currentName = '—';
  let onState = () => {};

  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.7;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      master.connect(analyser);
      analyser.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function stop() {
    if (current) {
      try { current.stop(); } catch (e) {}
      current = null;
    }
    onState({ playing: false, name: currentName });
  }

  /* play a group: {nodes:[...], stop:fn} produced by a builder */
  function play(name, builder) {
    ac();
    stop();
    currentName = name;
    const group = builder(ctx, master);
    current = {
      stop() { group.stop && group.stop(); }
    };
    // auto-clear when the group signals end
    if (group.duration) {
      const end = ctx.currentTime + group.duration;
      const t = setTimeout(() => {
        if (current) { current = null; onState({ playing: false, name: currentName }); }
      }, group.duration * 1000 + 60);
      const prevStop = current.stop;
      current.stop = () => { clearTimeout(t); prevStop(); };
    }
    onState({ playing: true, name });
    return group;
  }

  return {
    ctx: ac,
    play, stop,
    get analyser() { return analyser; },
    get master() { return master; },
    setVolume(v) { if (master) master.gain.value = v; },
    subscribe(fn) { onState = fn; },
    get name() { return currentName; },
  };
})();

/* -------------------------------------------------------- helper: envelope */
function adsr(ctx, gain, t0, dur, a = 0.008, r = 0.05, peak = 0.9) {
  const g = gain.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + a);
  g.setValueAtTime(peak, t0 + Math.max(a, dur - r));
  g.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

/* -------------------------------------------------------- signature chime  */
/* An homage to the boot startup swell — a spread of detuned voices rising into
   a soft major chord. Not a sample; pure synthesis. */
function buildChime(ctx, dest) {
  const dur = 3.4;
  const t0 = ctx.currentTime + 0.02;
  const bus = ctx.createGain();
  bus.gain.value = 0.0001;
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(0.5, t0 + 1.4);
  bus.gain.setValueAtTime(0.5, t0 + 2.2);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  bus.connect(dest);

  // gentle lowpass sweep opening up
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(240, t0);
  lp.frequency.exponentialRampToValueAtTime(5200, t0 + 1.8);
  lp.Q.value = 0.6;
  lp.connect(bus);

  // a shimmering cluster resolving to a wide major add9
  const freqs = [130.81, 196.0, 261.63, 329.63, 392.0, 523.25, 587.33];
  const oscs = [];
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = i % 2 ? 'triangle' : 'sine';
    o.frequency.value = f;
    o.detune.value = (i - 3) * 6;
    const g = ctx.createGain();
    g.gain.value = (0.14 / (1 + i * 0.18));
    // slow attack per partial, staggered
    g.gain.setValueAtTime(0.0001, t0 + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.14 / (1 + i * 0.18), t0 + 1.0 + i * 0.12);
    o.connect(g); g.connect(lp);
    o.start(t0 + i * 0.12);
    o.stop(t0 + dur + 0.1);
    oscs.push(o);
  });
  return { duration: dur + 0.15, stop() { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); } };
}

/* -------------------------------------------------------- waveform lab     */
function buildTone(shape, freq, dur = 1.4) {
  return (ctx, dest) => {
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain();
    g.connect(dest);
    adsr(ctx, g, t0, dur, 0.01, 0.12, 0.75);
    let node;
    if (shape === 'noise') {
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const d = buf.getChannelData(0);
      // seeded-ish LCG so the trace looks stable-ish but is clearly noise
      let s = 22695477;
      for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
      node = ctx.createBufferSource(); node.buffer = buf;
    } else {
      node = ctx.createOscillator();
      node.type = shape;
      node.frequency.value = freq;
    }
    node.connect(g);
    node.start(t0); node.stop(t0 + dur + 0.02);
    return { duration: dur + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* -------------------------------------------------------- ADPCM demo       */
/* Illustrative: we take a smooth source tone and requantise it to N bits per
   sample the way DSPADPCM squeezes audio to 4-bit nibbles + a per-block
   predictor/scale. Fewer bits => audible quantisation "crunch". */
function buildAdpcm(bits, freq, dur = 1.6) {
  return (ctx, dest) => {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const levels = Math.pow(2, bits);
    // simple 1st-order predictor like ADPCM (encode residual, quantise, decode)
    let yn1 = 0, pred = 0;
    const step = 2 / (levels - 1);
    for (let i = 0; i < len; i++) {
      const x = 0.7 * Math.sin(2 * Math.PI * freq * i / sr)
              + 0.18 * Math.sin(2 * Math.PI * freq * 2 * i / sr);
      const residual = x - pred;                       // what predictor missed
      let q = Math.round(residual / step);             // quantise to `bits`
      const half = levels / 2;
      q = Math.max(-half, Math.min(half - 1, q));      // clamp to nibble range
      const decoded = q * step;                        // reconstruct
      const y = pred + decoded;
      pred = 0.94 * y;                                 // leaky predictor
      yn1 = y;
      d[i] = Math.max(-1, Math.min(1, y)) * 0.8;
    }
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.connect(dest);
    adsr(ctx, g, t0, dur, 0.01, 0.1, 0.85);
    const node = ctx.createBufferSource(); node.buffer = buf; node.connect(g);
    node.start(t0);
    return { duration: dur + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* -------------------------------------------------------- sample-rate demo */
/* Resample a bright source down to `rate` Hz (naive, no anti-alias filter)
   so you can hear the aliasing the DSP's SRC is designed to avoid. */
function buildSRC(rate, dur = 1.6) {
  return (ctx, dest) => {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    // a rising sweep, rich in highs, is the cruel test for a low sample rate
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const f = 300 + 4200 * (tt / dur);
      const phase = 2 * Math.PI * (300 * tt + 2100 * tt * tt / dur);
      // sample-and-hold at `rate` to emulate a lower-rate voice
      const held = Math.floor(i * rate / sr);
      const ti = held / rate;
      const p2 = 2 * Math.PI * (300 * ti + 2100 * ti * ti / dur);
      d[i] = 0.6 * (Math.sin(p2) + 0.4 * Math.sign(Math.sin(p2 * 1.5)));
    }
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.connect(dest);
    adsr(ctx, g, t0, dur, 0.01, 0.1, 0.7);
    const node = ctx.createBufferSource(); node.buffer = buf; node.connect(g);
    node.start(t0);
    return { duration: dur + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* -------------------------------------------------------- oscilloscope     */
function Scope(canvas, opts = {}) {
  const ctx2d = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let raf = null;
  const buf = new Uint8Array(2048);
  const freqBuf = new Uint8Array(1024);

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  }
  resize();
  window.addEventListener('resize', resize);

  function frame() {
    const a = Engine.analyser;
    const W = canvas.width, H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);

    // grid
    ctx2d.strokeStyle = 'rgba(90,78,130,0.16)';
    ctx2d.lineWidth = 1;
    const cols = 12, rows = 4;
    for (let i = 1; i < cols; i++) { const x = W * i / cols; ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, H); ctx2d.stroke(); }
    for (let i = 1; i < rows; i++) { const y = H * i / rows; ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(W, y); ctx2d.stroke(); }

    if (a) {
      if (opts.mode === 'bars') {
        a.getByteFrequencyData(freqBuf);
        const n = 64;
        const bw = W / n;
        for (let i = 0; i < n; i++) {
          const v = freqBuf[Math.floor(i * 2)] / 255;
          const bh = v * H * 0.92;
          const hue = 250 - v * 90;
          ctx2d.fillStyle = `hsl(${hue} 80% ${45 + v * 20}%)`;
          ctx2d.fillRect(i * bw + 1, H - bh, bw - 2, bh);
        }
      } else {
        a.getByteTimeDomainData(buf);
        // glow trace
        ctx2d.lineWidth = 2 * dpr;
        ctx2d.strokeStyle = opts.color || '#45e4d1';
        ctx2d.shadowColor = opts.color || '#45e4d1';
        ctx2d.shadowBlur = 8 * dpr;
        ctx2d.beginPath();
        const slice = W / buf.length;
        for (let i = 0; i < buf.length; i++) {
          const y = (buf[i] / 255) * H;
          const x = i * slice;
          i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
        ctx2d.shadowBlur = 0;
      }
    }
    raf = requestAnimationFrame(frame);
  }
  frame();
  return { stop() { cancelAnimationFrame(raf); } };
}

/* -------------------------------------------------------- Pro Logic II lab */
/* Encode a mono source panned in a 2-D field into an L/R matrix the DPLII way:
     Lt = L + (-j*0.707)*C_from_S ...  (simplified steering)
   then compute the four recovered channel energies so the meters + puck show
   how a stereo pair carries a phantom centre and a phase-inverted surround. */
function PanLab(root) {
  const pad = root.querySelector('.panner-pad');
  const puck = root.querySelector('.puck');
  const fills = root.querySelectorAll('.chan-meters .fill');
  let px = 0.5, py = 0.35, playing = false, node = null, gains = null;

  function compute() {
    // x: -1 (L) .. +1 (R); y: 0 (front) .. 1 (rear)
    const x = px * 2 - 1;
    const front = 1 - py;
    const rear = py;
    const L = Math.max(0, (1 - x)) * front;
    const R = Math.max(0, (1 + x)) * front;
    const C = (1 - Math.abs(x)) * front;      // phantom centre strongest when centred+front
    const S = rear;                           // surround grows toward the rear
    const norm = Math.max(1e-3, L + R + C + S);
    const vals = [L, R, C, S].map(v => v);
    fills.forEach((f, i) => { f.style.height = Math.min(100, vals[i] * 90) + '%'; });
    return { L, R, C, S, x, front, rear };
  }

  function updatePuck() {
    puck.style.left = (px * 100) + '%';
    puck.style.top = (py * 100) + '%';
  }

  function setFromEvent(e) {
    const r = pad.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    px = Math.max(0, Math.min(1, cx / r.width));
    py = Math.max(0, Math.min(1, cy / r.height));
    updatePuck();
    const s = compute();
    if (playing && gains) applyPan(s);
  }

  function applyPan(s) {
    // map to actual stereo + a surround "phase" bleed to sell the effect
    const front = s.front;
    gains.l.gain.value = 0.5 * s.L + 0.25 * s.C;
    gains.r.gain.value = 0.5 * s.R + 0.25 * s.C;
    // surround: send phase-inverted, delayed signal to both -> the DPLII cue
    gains.surr.gain.value = 0.6 * s.rear;
  }

  pad.addEventListener('pointerdown', e => { pad.setPointerCapture(e.pointerId); setFromEvent(e); pad.__drag = true; });
  pad.addEventListener('pointermove', e => { if (pad.__drag) setFromEvent(e); });
  pad.addEventListener('pointerup', () => { pad.__drag = false; });
  updatePuck(); compute();

  root.querySelector('[data-pan-play]').addEventListener('click', () => {
    const g = Engine.play('Pro Logic II · matrix steering', (ctx, dest) => {
      const merger = ctx.createChannelMerger(2);
      const l = ctx.createGain(), r = ctx.createGain(), surr = ctx.createGain();
      const delay = ctx.createDelay(); delay.delayTime.value = 0.012;
      const inv = ctx.createGain(); inv.gain.value = -1;   // phase inversion = surround cue
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 174.6;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      osc.connect(lp);
      lp.connect(l); lp.connect(r);
      lp.connect(delay); delay.connect(inv);
      inv.connect(surr);
      // surround -> both channels out of phase (Lt = ..+S, Rt = ..-S)
      const surrR = ctx.createGain(); surrR.gain.value = -1;
      surr.connect(l); surr.connect(surrR); surrR.connect(r);
      l.connect(merger, 0, 0); r.connect(merger, 0, 1);
      merger.connect(dest);
      osc.start();
      gains = { l, r, surr };
      applyPan(compute());
      playing = true;
      return { stop() { try { osc.stop(); } catch (e) {} playing = false; gains = null; } };
    });
  });
}

/* -------------------------------------------------------- AX mixer lab     */
function MixerLab(root) {
  const strips = [...root.querySelectorAll('.strip')];
  let audioCtx = null, voices = null, playing = false;

  // read a strip's controls -> target gains (matches the DSP's per-frame mix)
  const gainOf = s => {
    const vol = parseFloat(s.querySelector('.fader').value) / 100;
    const muted = s.querySelector('.mute').classList.contains('on');
    return muted ? 0.0001 : Math.max(0.0001, vol * 0.3);
  };
  const panOf = s => {
    const pan = parseFloat(s.querySelector('.pan').value) / 100;   // -1..1
    return { l: Math.cos((pan + 1) * Math.PI / 4), r: Math.sin((pan + 1) * Math.PI / 4) };
  };
  // apply a strip's current controls to its live nodes — ramp to avoid clicks
  const applyStrip = v => {
    const t = audioCtx.currentTime, p = panOf(v.strip);
    v.g.gain.setTargetAtTime(gainOf(v.strip), t, 0.02);
    v.lg.gain.setTargetAtTime(p.l, t, 0.02);
    v.rg.gain.setTargetAtTime(p.r, t, 0.02);
  };

  root.querySelector('[data-mix-play]').addEventListener('click', () => {
    Engine.play('AX · 4-voice mix', (ctx, dest) => {
      audioCtx = ctx;
      const t0 = ctx.currentTime + 0.02;
      const merger = ctx.createChannelMerger(2);
      merger.connect(dest);
      voices = strips.map(s => {
        const o = ctx.createOscillator(); o.type = s.dataset.type; o.frequency.value = parseFloat(s.dataset.freq);
        const g = ctx.createGain();
        const p = panOf(s);
        // volume ramp — the DSP ramps gains per frame to avoid clicks
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gainOf(s), t0 + 0.25);
        const lg = ctx.createGain(), rg = ctx.createGain();
        lg.gain.value = p.l;
        rg.gain.value = p.r;
        o.connect(g); g.connect(lg); g.connect(rg);
        lg.connect(merger, 0, 0); rg.connect(merger, 0, 1);
        o.start(t0);
        return { osc: o, g, lg, rg, strip: s };
      });
      playing = true;
      return { stop() { voices.forEach(v => { try { v.osc.stop(); } catch (e) {} }); playing = false; voices = null; } };
    });
  });

  // live controls — reflect fader / pan / mute changes immediately while playing
  strips.forEach((s, i) => {
    const update = () => { if (playing && voices) applyStrip(voices[i]); };
    s.querySelector('.fader').addEventListener('input', update);
    s.querySelector('.pan').addEventListener('input', update);
    s.querySelector('.mute').addEventListener('click', e => { e.currentTarget.classList.toggle('on'); update(); });
  });
}

/* ==========================================================================
   Wire-up
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  /* hero ambient scope */
  const heroCanvas = document.getElementById('hero-scope');
  if (heroCanvas) heroAmbient(heroCanvas);

  /* player bar */
  const ppBtn = document.getElementById('pp');
  const playerViz = document.getElementById('player-viz');
  const nowTrack = document.getElementById('now-track');
  const vol = document.getElementById('vol');
  const statVoices = document.getElementById('stat-voices');
  Scope(playerViz, { mode: 'bars' });

  let _playing = false;
  Engine.subscribe(({ playing, name }) => {
    _playing = playing;
    nowTrack.textContent = playing ? name : 'Nothing playing';
    ppBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
    ppBtn.innerHTML = playing ? ICON_STOP : ICON_PLAY;
  });
  ppBtn.addEventListener('click', () => {
    if (_playing) Engine.stop();
    else Engine.play('Startup chime', buildChime);
  });
  vol.addEventListener('input', () => Engine.setVolume(parseFloat(vol.value) / 100));

  /* hero buttons */
  document.getElementById('play-chime').addEventListener('click', () => Engine.play('Startup chime', buildChime));

  /* waveform lab */
  const wl = document.getElementById('lab-wave');
  if (wl) {
    const scope = wl.querySelector('.scope');
    Scope(scope, { color: '#45e4d1' });
    const freqR = wl.querySelector('[data-wave-freq]');
    const freqV = wl.querySelector('[data-wave-freq-val]');
    let shape = 'sine';
    wl.querySelectorAll('.seg-btns button').forEach(b => b.addEventListener('click', () => {
      wl.querySelectorAll('.seg-btns button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); shape = b.dataset.shape;
    }));
    freqR.addEventListener('input', () => freqV.textContent = freqR.value + ' Hz');
    wl.querySelector('[data-wave-play]').addEventListener('click', () =>
      Engine.play(`Waveform · ${shape} @ ${freqR.value} Hz`, (c, d) => buildTone(shape, parseFloat(freqR.value))(c, d)));
  }

  /* ADPCM lab */
  const al = document.getElementById('lab-adpcm');
  if (al) {
    Scope(al.querySelector('.scope'), { color: '#ff5f9e' });
    const bitsR = al.querySelector('[data-bits]');
    const bitsV = al.querySelector('[data-bits-val]');
    bitsR.addEventListener('input', () => bitsV.textContent = bitsR.value + '-bit');
    al.querySelector('[data-adpcm-play]').addEventListener('click', () =>
      Engine.play(`ADPCM · ${bitsR.value}-bit quantisation`, buildAdpcm(parseInt(bitsR.value), 220)));
    al.querySelector('[data-pcm-play]').addEventListener('click', () =>
      Engine.play('Source · 16-bit PCM reference', buildAdpcm(16, 220)));
  }

  /* sample-rate lab */
  const sl = document.getElementById('lab-src');
  if (sl) {
    Scope(sl.querySelector('.scope'), { color: '#ffb14e' });
    sl.querySelectorAll('[data-rate]').forEach(b => b.addEventListener('click', () => {
      const r = parseInt(b.dataset.rate);
      Engine.play(`Sample rate · ${(r/1000)} kHz`, buildSRC(r));
    }));
  }

  /* mixer + panner labs */
  const ml = document.getElementById('lab-mixer'); if (ml) MixerLab(ml);
  const pl = document.getElementById('lab-panner'); if (pl) PanLab(pl);

  /* LLE/HLE toggle mini-demo */
  const toggle = document.getElementById('lle-hle-toggle');
  if (toggle) {
    toggle.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      toggle.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      document.getElementById('lle-hle-note').textContent = b.dataset.note;
    }));
  }

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

/* ------------------------------------------------------- hero ambient scope */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let t = 0, raf;
  function size() { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
  size(); window.addEventListener('resize', size);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function draw() {
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const traces = [
      { col: 'rgba(69,228,209,0.9)', a: 0.34, f: 2.0, ph: 0 },
      { col: 'rgba(168,132,255,0.85)', a: 0.22, f: 3.3, ph: 1.1 },
      { col: 'rgba(255,95,158,0.7)', a: 0.16, f: 5.1, ph: 2.2 },
    ];
    traces.forEach(tr => {
      c.beginPath(); c.lineWidth = 1.6 * dpr; c.strokeStyle = tr.col; c.shadowColor = tr.col; c.shadowBlur = 10 * dpr;
      for (let x = 0; x <= W; x += 4 * dpr) {
        const p = x / W;
        const env = Math.sin(p * Math.PI);
        const y = H / 2 + Math.sin(p * Math.PI * 2 * tr.f + t + tr.ph) * H * tr.a * env
                        + Math.sin(p * Math.PI * 2 * tr.f * 2.7 + t * 1.3) * H * tr.a * 0.25 * env;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
    });
    c.shadowBlur = 0;
    t += reduce ? 0 : 0.018;
    raf = requestAnimationFrame(draw);
    if (reduce) cancelAnimationFrame(raf);
  }
  draw();
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
