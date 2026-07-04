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
  let dry = null, decoder = null, out = null, mediaEl = null, mediaActive = false;
  let decodeOn = (() => { try { return localStorage.getItem('gc_decode') === '1'; } catch (e) { return false; } })();

  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.7;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      master.connect(analyser);
      // analyser -> dry (straight stereo) -> out. A parallel "wet" path (the
      // steering decoder) is built on demand and cross-faded against dry by
      // applyRoute() once it has finished attaching. `out` is the single sink
      // that reaches the device — see routeOutput().
      dry = ctx.createGain();
      dry.gain.value = 1;
      analyser.connect(dry);
      out = ctx.createGain();
      dry.connect(out);
      routeOutput();
      if (decodeOn) buildDecoder();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* Route the final mix through a hidden <audio> element via a MediaStream
     instead of straight to the device. Browsers treat media-element playback
     as a real "media session" — on iOS that is what makes Control Center
     attach its per-stream audio features to the page (AirPlay, lock-screen
     controls, and on supported devices the "Convert to Spatial Audio"
     toggle), none of which apply to raw Web Audio output. It also lets iOS
     play the page with the ringer switch on silent, like any media app.
     If element playback is refused, fall back to the direct connection. */
  function routeOutput() {
    let direct = false;
    const fallback = () => {
      if (!direct && !mediaActive) { direct = true; out.connect(ctx.destination); }
    };
    try {
      const msDest = ctx.createMediaStreamDestination();
      out.connect(msDest);
      mediaEl = document.createElement('audio');
      mediaEl.srcObject = msDest.stream;
      mediaEl.setAttribute('playsinline', '');
      mediaEl.style.display = 'none';
      document.body.appendChild(mediaEl);
      const t = setTimeout(fallback, 300);   // don't leave the page silent
      mediaEl.play().then(() => {
        clearTimeout(t);
        if (direct) { try { out.disconnect(ctx.destination); } catch (e) {} direct = false; }
        mediaActive = true;
      }).catch(() => { clearTimeout(t); fallback(); });
    } catch (e) {
      fallback();
    }
  }

  /* ------ optional Dolby Pro Logic II decode -> headphone surround -----------
     For listeners without a DPL2-capable receiver. The real decode runs in an
     AudioWorklet (plii.js): a PLII-style ACTIVE-STEERING decoder — envelope
     followers on the two steering axes (left/right and centre/surround) find
     the dominant direction moment-to-moment and adapt the matrix to cancel
     crosstalk, relaxing to the passive matrix for diffuse sound. Its five
     outputs (L, R, C, Ls, Rs) land on virtual speakers via HRTF panners so
     they externalise on plain headphones. No front/rear delay — a Haas delay
     would let the precedence effect pull everything to the front.
     If AudioWorklet is unavailable, a passive mid/side decode is the fallback. */
  let workletLoad = null;

  function makePanner(x, y, z) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else p.setPosition(x, y, z);
    return p;
  }

  function buildDecoder() {
    if (decoder || !ctx) return;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    // Safety limiter on the binaural decode path: five steered virtual
    // speakers can momentarily sum hot (e.g. a loud centred source), and
    // clipped speech sounds garbled. Bypassed by the discrete-5.1 branch,
    // since DynamicsCompressor would fold 6 channels down to stereo.
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 4; lim.ratio.value = 12;
    lim.attack.value = 0.002; lim.release.value = 0.15;
    wet.connect(lim);
    lim.connect(out);
    decoder = { wet, ready: false };

    const attachSteered = () => {
      const node = new AudioWorkletNode(ctx, 'plii-active', {
        numberOfInputs: 1,
        numberOfOutputs: 5,
        outputChannelCount: [1, 1, 1, 1, 1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      analyser.connect(node);

      // --- discrete 5.1 output -------------------------------------------
      // If the output device reports 6+ channels (a PC with real 5.1
      // speakers), skip binauralisation entirely: map the five steered
      // channels straight onto the 5.1 layout (L R C LFE SL SR — LFE left
      // silent, no bass management) and drive the destination discretely.
      // This path bypasses the media element, which is stereo-only.
      let multi = false;
      if (ctx.destination.maxChannelCount >= 6) {
        try {
          ctx.destination.channelCount = 6;
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelInterpretation = 'discrete';
          const m6 = ctx.createChannelMerger(6);
          // worklet outputs 0..4 = L R C Ls Rs → 5.1 channels 0 1 2 4 5
          [[0, 0], [1, 1], [2, 2], [3, 4], [4, 5]]
            .forEach(([o, c]) => node.connect(m6, o, c));
          try { wet.disconnect(lim); } catch (e) {}
          m6.connect(wet);
          wet.connect(ctx.destination);
          decoder.multi = true;
          multi = true;
        } catch (e) { /* device refused 6ch — fall through to binaural */ }
      }

      if (!multi) {
        // Virtual speaker layout: front L/R/C, rear Ls/Rs. Each HRTF panner
        // is followed by a StereoPanner bias: browser HRTF datasets cap the
        // interaural level difference around 1.4x, which dilutes even a well-
        // steered rear pair to near-mono at the ears. The bias restores a
        // clear left/right level cue while the HRTF keeps the front/back
        // (spectral + timing) cues.
        const SPEAKERS = [
          { pos: [-1.0, 0, -0.6], bias: -0.4 },   // L
          { pos: [ 1.0, 0, -0.6], bias:  0.4 },   // R
          { pos: [ 0,   0, -0.9], bias:  0   },   // C
          { pos: [-1.2, 0,  0.5], bias: -0.5 },   // Ls
          { pos: [ 1.2, 0,  0.5], bias:  0.5 },   // Rs
        ];
        SPEAKERS.forEach((spk, k) => {
          const p = makePanner(...spk.pos);
          node.connect(p, k);
          if (spk.bias && ctx.createStereoPanner) {
            const sp = ctx.createStereoPanner();
            sp.pan.value = spk.bias;
            p.connect(sp); sp.connect(wet);
          } else {
            p.connect(wet);
          }
        });
      }
      decoder.node = node;
      decoder.ready = true;
      applyRoute();
    };

    const attachPassive = () => {
      // fallback: passive mid/side (front = 0.5(L+R), rear = 0.5(L-R) boosted)
      const split = ctx.createChannelSplitter(2);
      analyser.connect(split);
      const mid = ctx.createGain();
      const mL = ctx.createGain(); mL.gain.value = 0.5; split.connect(mL, 0); mL.connect(mid);
      const mR = ctx.createGain(); mR.gain.value = 0.5; split.connect(mR, 1); mR.connect(mid);
      const fC = makePanner(0, 0, -0.9);
      const fCg = ctx.createGain(); fCg.gain.value = 1.2; mid.connect(fCg); fCg.connect(fC);
      const side = ctx.createGain();
      const sL = ctx.createGain(); sL.gain.value = 0.5; split.connect(sL, 0); sL.connect(side);
      const sR = ctx.createGain(); sR.gain.value = -0.5; split.connect(sR, 1); sR.connect(side);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8000;
      const boost = ctx.createGain(); boost.gain.value = 1.7;
      side.connect(lp); lp.connect(boost);
      const rL = makePanner(-0.5, 0, 1.0), rR = makePanner(0.5, 0, 1.0);
      boost.connect(rL); boost.connect(rR);
      [fC, rL, rR].forEach(p => p.connect(wet));
      decoder.ready = true;
      applyRoute();
    };

    if (ctx.audioWorklet && window.AudioWorkletNode) {
      (workletLoad || (workletLoad = ctx.audioWorklet.addModule('plii.js')))
        .then(attachSteered)
        .catch(attachPassive);
    } else {
      attachPassive();
    }
  }

  // Cross-fade dry (raw stereo) against wet (decoded). The wet path only takes
  // over once the decoder is actually attached, so toggling never drops audio.
  function applyRoute() {
    if (!ctx) return;
    const on = decodeOn && decoder && decoder.ready;
    const t = ctx.currentTime;
    if (dry) dry.gain.setTargetAtTime(on ? 0 : 1, t, 0.02);
    if (decoder) decoder.wet.gain.setTargetAtTime(on ? 1 : 0, t, 0.02);
  }

  function setDecode(on) {
    decodeOn = !!on;
    try { localStorage.setItem('gc_decode', decodeOn ? '1' : '0'); } catch (e) {}
    if (!ctx) return;                 // applied when the context is first built
    if (decodeOn) buildDecoder();
    applyRoute();
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
    // lock-screen / Control Center metadata for the media session
    if (navigator.mediaSession && window.MediaMetadata) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: name,
          artist: 'Inside the GameCube — audio course',
        });
      } catch (e) {}
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
    setDecode,
    get decode() { return decodeOn; },
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
  let px = 0.5, py = 0.35, playing = false, node = null, gains = null, pctx = null;

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
    // Drive the five virtual-channel gains from the puck. The rear is split
    // equal-power into Ls/Rs by the puck's x — PLII's encoder carries a STEREO
    // surround pair, which is what lets the decoder pan across the rears.
    const t = pctx ? pctx.currentTime : 0;
    const set = (g, v) => g.gain.setTargetAtTime(v, t, 0.02);
    const th = (s.x + 1) * Math.PI / 4;              // -1 → all Ls, +1 → all Rs
    set(gains.gL, 0.5 * s.L);
    set(gains.gR, 0.5 * s.R);
    set(gains.gC, 0.354 * s.C);                      // 0.5 · 0.7071 centre law
    set(gains.gLs, 0.6 * s.S * Math.cos(th));
    set(gains.gRs, 0.6 * s.S * Math.sin(th));
  }

  pad.addEventListener('pointerdown', e => { pad.setPointerCapture(e.pointerId); setFromEvent(e); pad.__drag = true; });
  pad.addEventListener('pointermove', e => { if (pad.__drag) setFromEvent(e); });
  pad.addEventListener('pointerup', () => { pad.__drag = false; });
  updatePuck(); compute();

  /* source selector: a synth tone, or a short synthesised voice clip
     ("Can you hear me?") — speech is what human hearing localises best, so
     it makes the steering much easier to judge than a steady tone.        */
  let srcMode = 'tone';
  let voiceBuf = null, voiceLoading = null;
  function loadVoice(ctx) {
    if (voiceBuf) return Promise.resolve(voiceBuf);
    if (!voiceLoading) {
      voiceLoading = fetch('canyouhearme.wav')
        .then(r => r.arrayBuffer())
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => {
          // pad with 0.8 s of silence so the looped phrase has a natural gap
          const pad = Math.floor(buf.sampleRate * 0.8);
          const out = ctx.createBuffer(1, buf.length + pad, buf.sampleRate);
          out.getChannelData(0).set(buf.getChannelData(0));
          voiceBuf = out;
          return out;
        });
    }
    return voiceLoading;
  }
  root.querySelectorAll('[data-pan-src]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-pan-src]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    srcMode = b.dataset.panSrc;
    if (playing) startPanner();               // switch source live
  }));

  function startPanner() {
    const mode = srcMode;
    const go = (makeSource) => Engine.play(
      mode === 'voice' ? 'Pro Logic II · “can you hear me?”' : 'Pro Logic II · matrix steering',
      (ctx, dest) => {
        pctx = ctx;
        const { node: src, out: srcOut } = makeSource(ctx);

        // --- a real Pro Logic II ENCODE: five virtual channels -> Lt/Rt ------
        //   Lt = L + 0.7071·C − (0.8718·Ls + 0.4899·Rs)
        //   Rt = R + 0.7071·C + (0.4899·Ls + 0.8718·Rs)
        // The ASYMMETRIC surround coefficients (0.87 vs 0.49) are what encode
        // rear-left vs rear-right into just two channels; the decoder's active
        // steering separates them again. (True PLII applies a 90° phase shift
        // to the surrounds; we approximate it with polarity, as the course
        // notes.)
        const merger = ctx.createChannelMerger(2);
        // The surround branch is delayed ~9 ms as a stand-in for PLII's 90°
        // quadrature: it decorrelates surround from front content so the two
        // can't coherently cancel in one channel and add in the other (which
        // would skew the decoder's level detectors toward one side).
        const sdel = ctx.createDelay(); sdel.delayTime.value = 0.009; srcOut.connect(sdel);
        const mk = (from) => { const gn = ctx.createGain(); gn.gain.value = 0; from.connect(gn); return gn; };
        const gL = mk(srcOut), gR = mk(srcOut), gC = mk(srcOut), gLs = mk(sdel), gRs = mk(sdel);
        gL.connect(merger, 0, 0);
        gR.connect(merger, 0, 1);
        gC.connect(merger, 0, 0); gC.connect(merger, 0, 1);    // centre equally into both
        const tap = (from, k, chan) => {
          const w = ctx.createGain(); w.gain.value = k;
          from.connect(w); w.connect(merger, 0, chan);
        };
        tap(gLs, -0.8718, 0); tap(gLs, 0.4899, 1);             // Ls
        tap(gRs, -0.4899, 0); tap(gRs, 0.8718, 1);             // Rs
        merger.connect(dest);

        src.start();
        gains = { gL, gR, gC, gLs, gRs };
        applyPan(compute());
        playing = true;
        return { stop() { try { src.stop(); } catch (e) {} playing = false; gains = null; } };
      });

    if (mode === 'voice') {
      // ensure the context exists so decodeAudioData has one to decode with
      const ctx0 = Engine.ctx();
      loadVoice(ctx0).then(() => go(ctx => {
        const node = ctx.createBufferSource();
        node.buffer = voiceBuf; node.loop = true;
        const out = ctx.createGain(); out.gain.value = 1.6;    // speech sits quieter than the saw
        node.connect(out);
        return { node, out };
      })).catch(() => { /* fetch failed (offline?) — fall back to the tone */
        srcMode = 'tone'; go(toneSource);
      });
    } else {
      go(toneSource);
    }

    function toneSource(ctx) {
      const node = ctx.createOscillator(); node.type = 'sawtooth'; node.frequency.value = 174.6;
      const out = ctx.createBiquadFilter(); out.type = 'lowpass'; out.frequency.value = 2400;
      node.connect(out);
      return { node, out };
    }
  }

  root.querySelector('[data-pan-play]').addEventListener('click', startPanner);
}

/* -------------------------------------------------------- mailbox lab      */
/* Replays the CPU<->DSP boot handshake from module 14, one mail at a time —
   the real 32-bit values, with a translation beside each. Pure DOM, no audio. */
function MailLab(root) {
  const log = root.querySelector('[data-mail-log]');
  const note = root.querySelector('[data-mail-note]');
  const stepBtn = root.querySelector('[data-mail-step]');
  const STEPS = [
    { side: 'cpu', mail: '0x8071FEED', text: 'the magic init mail — “incoming ucode!”' },
    { side: 'cpu', mail: '0x8123A000', text: 'where the ucode sits in main RAM' },
    { side: 'cpu', mail: '0x00001D20', text: 'how many bytes to copy' },
    { side: 'cpu', mail: '0x00000000', text: 'where to put it in IRAM — also the entry point' },
    { side: 'dsp', mail: 'DMA', text: 'boot ROM ucode copies 0x1D20 bytes MRAM → IRAM' },
    { side: 'dsp', mail: 'JMP 0x0000', text: '…and jumps in: the game’s ucode is now running' },
    { side: 'hle', mail: 'CRC 0x3AD3B7AC', text: '(HLE only) Dolphin fingerprints IRAM → matches AXUCode' },
    { side: 'dsp', mail: '0xDCD10000', text: 'DSP_INIT — “ready”; from here on it’s a command list every frame' },
  ];
  const WHO = { cpu: 'CPU → DSP', dsp: 'DSP → CPU', hle: 'Dolphin' };
  let at = 0;
  function reset() {
    at = 0;
    log.innerHTML = '<div class="mail-empty">— mailboxes idle · the DSP is running its boot ROM ucode —</div>';
    note.textContent = 'Press Step to send the first mail.';
    stepBtn.disabled = false;
  }
  stepBtn.addEventListener('click', () => {
    if (at === 0) log.innerHTML = '';
    const s = STEPS[at++];
    const row = document.createElement('div');
    row.className = 'mrow ' + s.side;
    row.innerHTML = '<span class="who">' + WHO[s.side] + '</span><code>' + s.mail + '</code><span class="what">' + s.text + '</span>';
    log.appendChild(row);
    if (at >= STEPS.length) {
      note.textContent = 'Handshake complete — the ucode is live. Reset to replay.';
      stepBtn.disabled = true;
    } else {
      note.textContent = 'Step ' + at + ' of ' + STEPS.length;
    }
  });
  root.querySelector('[data-mail-reset]').addEventListener('click', reset);
}

/* -------------------------------------------------------- resampler lab    */
/* The Mixer's job, audible: a bright sweep "stored at 32 kHz" is converted
   to the device rate with three interpolators of increasing quality.        */
function buildResampled(kind) {
  return (ctx, dest) => {
    const srSrc = 32000, dur = 1.7;
    const nSrc = Math.floor(srSrc * dur);
    const src = new Float32Array(nSrc);
    for (let i = 0; i < nSrc; i++) {
      const t = i / srSrc;
      const f0 = 500, f1 = 14000;                       // sweep into the top octave
      const ph = 2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * dur));
      src[i] = Math.sin(ph);
    }
    const sr = ctx.sampleRate;
    const nOut = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, nOut, sr);
    const d = buf.getChannelData(0);
    const step = srSrc / sr;
    const at = i => (i < 0 || i >= nSrc) ? 0 : src[i];
    for (let n = 0; n < nOut; n++) {
      const p = n * step, i0 = Math.floor(p), fr = p - i0;
      let v;
      if (kind === 'nearest') {
        v = at(Math.round(p));
      } else if (kind === 'linear') {
        v = at(i0) * (1 - fr) + at(i0 + 1) * fr;
      } else {                                          // 4-point Hermite
        const ym1 = at(i0 - 1), y0 = at(i0), y1 = at(i0 + 1), y2 = at(i0 + 2);
        const c1 = 0.5 * (y1 - ym1);
        const c2 = ym1 - 2.5 * y0 + 2 * y1 - 0.5 * y2;
        const c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
        v = ((c3 * fr + c2) * fr + c1) * fr + y0;
      }
      d[n] = 0.6 * v;
    }
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain(); g.connect(dest);
    adsr(ctx, g, t0, dur, 0.01, 0.1, 0.8);
    const node = ctx.createBufferSource(); node.buffer = buf; node.connect(g);
    node.start(t0);
    return { duration: dur + 0.05, stop() { try { node.stop(); } catch (e) {} } };
  };
}

/* -------------------------------------------------------- AUX reverb lab   */
/* A voice's AUX send, made audible: a plucked arpeggio goes dry to the
   output AND, scaled by the send knob, into a convolution reverb whose
   impulse response is synthesised (exponentially decaying noise) — the
   round-trip a real game does through main RAM and the CPU.              */
function AuxLab(root) {
  const slider = root.querySelector('[data-aux-send]');
  const valEl = root.querySelector('[data-aux-send-val]');
  let sendGain = null, actx = null;
  const sendVal = () => parseFloat(slider.value) / 100;
  slider.addEventListener('input', () => {
    valEl.textContent = slider.value + ' %';
    if (sendGain && actx) sendGain.gain.setTargetAtTime(sendVal(), actx.currentTime, 0.02);
  });

  function makeIR(ctx, seconds = 1.9) {
    const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    let s = 1234567;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        d[i] = ((s / 0x3fffffff) - 1) * Math.pow(1 - i / n, 2.6);
      }
    }
    return buf;
  }

  root.querySelector('[data-aux-play]').addEventListener('click', () => {
    Engine.play('AX · AUX reverb send', (ctx, dest) => {
      actx = ctx;
      // dry path + AUX send -> "cave" -> return, both into the mix
      const dry = ctx.createGain(); dry.gain.value = 0.9; dry.connect(dest);
      sendGain = ctx.createGain(); sendGain.gain.value = sendVal();
      const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx);
      const ret = ctx.createGain(); ret.gain.value = 1.5;
      sendGain.connect(conv); conv.connect(ret); ret.connect(dest);
      const bus = ctx.createGain(); bus.connect(dry); bus.connect(sendGain);
      // a plucked arpeggio, pre-scheduled
      const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63];
      const oscs = [];
      let t = ctx.currentTime + 0.05;
      for (let k = 0; k < 24; k++) {
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.value = notes[k % notes.length];
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        o.connect(g); g.connect(bus);
        o.start(t); o.stop(t + 0.4);
        oscs.push(o);
        t += 0.4;
      }
      return { duration: 24 * 0.4 + 2.2, stop() { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); } };
    });
  });
}

/* -------------------------------------------------------- frame budget lab */
/* SIMULATES the DSP's 5 ms real-time deadline: each frame costs cycles per
   voice (with a little per-frame jitter, like real workloads); a frame whose
   load exceeds the budget misses the deadline and its audio is muted — the
   authentic crackle of a buffer underrun. The canvas is a rolling timeline:
   one bar per frame, dashed line = the budget, red = dropped.              */
function FrameLab(root) {
  const canvas = root.querySelector('.frame-canvas');
  const c2 = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const slider = root.querySelector('[data-frame-voices]');
  const valEl = root.querySelector('[data-frame-voices-val]');
  const statEl = root.querySelector('[data-frame-stat]');
  const BUDGET = 64, FRAME = 0.005;
  let voices = parseInt(slider.value, 10);
  let playing = false, raf = null;
  const hist = new Array(180).fill(0);
  let histAt = 0, drops = 0, frames = 0;

  slider.addEventListener('input', () => {
    voices = parseInt(slider.value, 10);
    valEl.textContent = voices + ' voices';
  });

  function draw() {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    const W = canvas.width, H = canvas.height;
    c2.clearRect(0, 0, W, H);
    const bw = W / hist.length, scale = H * 0.7;
    for (let i = 0; i < hist.length; i++) {
      const load = hist[(histAt + i) % hist.length];
      if (!load) continue;
      const h = Math.min(1.3, load) * scale;
      c2.fillStyle = load > 1 ? '#ff6a6a' : '#45e4d1';
      c2.fillRect(i * bw + 0.5, H - h, Math.max(1, bw - 1.2), h);
    }
    const by = H - scale;                       // the budget line (load = 1)
    c2.strokeStyle = 'rgba(255,177,78,.9)';
    c2.lineWidth = dpr;
    c2.setLineDash([5 * dpr, 4 * dpr]);
    c2.beginPath(); c2.moveTo(0, by); c2.lineTo(W, by); c2.stroke();
    c2.setLineDash([]);
    if (playing) raf = requestAnimationFrame(draw);
  }
  draw();

  root.querySelector('[data-frame-play]').addEventListener('click', () => {
    Engine.play('AX · frame budget (simulated)', (ctx, dest) => {
      // a sustained 6-voice chord, gated per simulated frame
      const gate = ctx.createGain(); gate.gain.value = 1; gate.connect(dest);
      const master = ctx.createGain(); master.gain.value = 0.12; master.connect(gate);
      const oscs = [130.81, 164.81, 196.0, 261.63, 329.63, 392.0].map((f, i) => {
        const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = f; o.detune.value = (i - 2.5) * 4;
        o.connect(master); o.start();
        return o;
      });
      drops = 0; frames = 0;
      let nextT = ctx.currentTime + 0.05;
      let seed = 97;
      const timer = setInterval(() => {
        // schedule simulated frames ~150 ms ahead
        while (nextT < ctx.currentTime + 0.15) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const jitter = 0.85 + 0.3 * (seed / 0x7fffffff);
          const load = (voices / BUDGET) * jitter;
          const dropped = load > 1;
          gate.gain.setValueAtTime(dropped ? 0 : 1, nextT);
          hist[histAt] = load; histAt = (histAt + 1) % hist.length;
          frames++; if (dropped) drops++;
          nextT += FRAME;
        }
        statEl.textContent = drops
          ? 'missed deadline: ' + (100 * drops / frames).toFixed(1) + '% of frames'
          : 'all frames on time · budget ≈ 64 voices';
      }, 90);
      playing = true;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
      return {
        stop() {
          clearInterval(timer);
          playing = false;
          oscs.forEach(o => { try { o.stop(); } catch (e) {} });
        }
      };
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

/* -------------------------------------------------------- envelope lab     */
/* An ADSR envelope shapes a note's loudness over time: Attack (fade in),
   Decay (drop to a held level), Sustain (that held level), Release (fade out).
   The canvas draws the current shape; playing applies it to a saw voice.      */
function buildEnvNote(a, d, s, r) {
  return (ctx, dest) => {
    const t0 = ctx.currentTime + 0.02, hold = 0.45, dur = a + d + hold + r;
    const peak = 0.85, sus = Math.max(0.0008, peak * s);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.6;
    const g = ctx.createGain(), gg = g.gain;
    gg.setValueAtTime(0.0001, t0);
    gg.linearRampToValueAtTime(peak, t0 + a);                     // attack
    gg.linearRampToValueAtTime(sus, t0 + a + d);                  // decay → sustain
    gg.setValueAtTime(sus, t0 + a + d + hold);                    // sustain hold
    gg.linearRampToValueAtTime(0.0001, t0 + a + d + hold + r);    // release
    osc.connect(lp); lp.connect(g); g.connect(dest);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
    return { duration: dur + 0.05, stop() { try { osc.stop(); } catch (e) {} } };
  };
}

function EnvelopeLab(root) {
  const canvas = root.querySelector('.env-canvas');
  const ctx2d = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const R = k => root.querySelector(`[data-${k}]`);
  const V = k => root.querySelector(`[data-${k}-val]`);
  const rs = { a: R('a'), d: R('d'), s: R('s'), r: R('r') };

  function vals() {
    return {
      a: parseFloat(rs.a.value) / 1000,
      d: parseFloat(rs.d.value) / 1000,
      s: parseFloat(rs.s.value) / 100,
      r: parseFloat(rs.r.value) / 1000,
    };
  }
  function labels() {
    V('a').textContent = rs.a.value + ' ms';
    V('d').textContent = rs.d.value + ' ms';
    V('s').textContent = rs.s.value + ' %';
    V('r').textContent = rs.r.value + ' ms';
  }
  function draw() {
    const b = canvas.getBoundingClientRect();
    canvas.width = b.width * dpr; canvas.height = b.height * dpr;
    const W = canvas.width, H = canvas.height, pad = 10 * dpr;
    ctx2d.clearRect(0, 0, W, H);
    // baseline
    ctx2d.strokeStyle = 'rgba(90,78,130,0.28)'; ctx2d.lineWidth = 1;
    ctx2d.beginPath(); ctx2d.moveTo(pad, H - pad); ctx2d.lineTo(W - pad, H - pad); ctx2d.stroke();
    const v = vals(), hold = 0.45;
    const total = v.a + v.d + hold + v.r || 1;
    const x = t => pad + (W - 2 * pad) * (t / total);
    const y = amp => (H - pad) - (H - 2 * pad) * amp;
    const pts = [[0, 0], [v.a, 1], [v.a + v.d, v.s], [v.a + v.d + hold, v.s], [total, 0]];
    // fill under curve
    ctx2d.beginPath(); ctx2d.moveTo(x(0), y(0));
    pts.forEach(p => ctx2d.lineTo(x(p[0]), y(p[1])));
    ctx2d.lineTo(x(total), y(0)); ctx2d.closePath();
    ctx2d.fillStyle = 'rgba(69,228,209,0.10)'; ctx2d.fill();
    // curve
    ctx2d.beginPath(); ctx2d.moveTo(x(pts[0][0]), y(pts[0][1]));
    pts.slice(1).forEach(p => ctx2d.lineTo(x(p[0]), y(p[1])));
    ctx2d.strokeStyle = '#45e4d1'; ctx2d.lineWidth = 2.4 * dpr;
    ctx2d.lineJoin = 'round'; ctx2d.stroke();
    // stage dots
    ctx2d.fillStyle = '#a884ff';
    pts.forEach(p => { ctx2d.beginPath(); ctx2d.arc(x(p[0]), y(p[1]), 3.4 * dpr, 0, 7); ctx2d.fill(); });
  }
  Object.values(rs).forEach(el => el.addEventListener('input', () => { labels(); draw(); }));
  window.addEventListener('resize', draw);
  labels(); draw();
  root.querySelector('[data-env-play]').addEventListener('click', () => {
    const v = vals();
    Engine.play('Envelope · ADSR voice', buildEnvNote(v.a, v.d, v.s, v.r));
  });
}

/* -------------------------------------------------------- clipping lab      */
/* Push a signal past the ±1 ceiling and a hard limiter flattens its peaks —
   that flat-topping is clipping, heard as harsh distortion. Drive is the
   input gain; headroom is how much room is left before the ceiling.           */
const CLIP_CURVE = (() => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = i / (n - 1) * 2 - 1; return c; })();

function buildClipGroup(drive) {
  return (ctx, dest) => {
    const t0 = ctx.currentTime + 0.02, dur = 1.8;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 110;
    const pre = ctx.createGain(); pre.gain.value = drive;
    const ws = ctx.createWaveShaper(); ws.curve = CLIP_CURVE; ws.oversample = '4x';
    const out = ctx.createGain(); out.connect(dest);
    adsr(ctx, out, t0, dur, 0.01, 0.12, 0.55);
    osc.connect(pre); pre.connect(ws); ws.connect(out);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
    return { pre, duration: dur + 0.05, stop() { try { osc.stop(); } catch (e) {} } };
  };
}

function ClipLab(root) {
  const driveR = root.querySelector('[data-drive]');
  const driveV = root.querySelector('[data-drive-val]');
  Scope(root.querySelector('.scope'), { color: '#ff6a6a' });
  let live = null, actx = null;
  const val = () => parseFloat(driveR.value);
  function label() {
    driveV.textContent = '×' + val().toFixed(1) + (val() <= 1 ? ' · clean' : ' · clipping');
  }
  driveR.addEventListener('input', () => {
    label();
    if (live && actx) live.pre.gain.setTargetAtTime(val(), actx.currentTime, 0.02);
  });
  label();
  root.querySelector('[data-clip-play]').addEventListener('click', () => {
    live = Engine.play('Headroom · drive ' + '×' + val().toFixed(1), (ctx, dest) => {
      actx = ctx; return buildClipGroup(val())(ctx, dest);
    });
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

  /* spectrum lab — same sound shown in time and frequency at once */
  const sp = document.getElementById('lab-spectrum');
  if (sp) {
    Scope(sp.querySelector('.scope'), { color: '#45e4d1' });
    Scope(sp.querySelector('.spectrum'), { mode: 'bars' });
    let shape = 'sine';
    sp.querySelectorAll('.seg-btns button').forEach(b => b.addEventListener('click', () => {
      sp.querySelectorAll('.seg-btns button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); shape = b.dataset.shape;
    }));
    sp.querySelector('[data-spectrum-play]').addEventListener('click', () =>
      Engine.play(`Spectrum · ${shape} @ 220 Hz`, buildTone(shape, 220, 1.9)));
  }

  /* envelope + clipping labs */
  const envL = document.getElementById('lab-env'); if (envL) EnvelopeLab(envL);
  const clipL = document.getElementById('lab-clip'); if (clipL) ClipLab(clipL);

  /* AUX reverb + frame budget labs (Part II) */
  const auxL = document.getElementById('lab-aux'); if (auxL) AuxLab(auxL);
  const frL = document.getElementById('lab-frame'); if (frL) FrameLab(frL);

  /* mailbox + resampler labs (Part III) */
  const mlb = document.getElementById('lab-mail'); if (mlb) MailLab(mlb);
  const rsl = document.getElementById('lab-resample');
  if (rsl) {
    Scope(rsl.querySelector('.scope'), { color: '#a884ff' });
    rsl.querySelectorAll('[data-resample]').forEach(b => b.addEventListener('click', () =>
      Engine.play(`Mixer · ${b.dataset.resample} interpolation`, buildResampled(b.dataset.resample))));
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

  /* headphone surround decode toggle(s) — player bar + Pro Logic II lab */
  const surrBtns = [...document.querySelectorAll('.surr-btn')];
  if (surrBtns.length) {
    const syncSurr = () => surrBtns.forEach(btn => {
      const on = Engine.decode;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const st = btn.querySelector('.state'); if (st) st.textContent = on ? 'on' : 'off';
    });
    surrBtns.forEach(btn => btn.addEventListener('click', () => { Engine.setDecode(!Engine.decode); syncSurr(); }));
    syncSurr();
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
