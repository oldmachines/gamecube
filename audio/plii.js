/* ============================================================================
   plii.js — Dolby Pro Logic II-style ACTIVE STEERING decoder (AudioWorklet)

   Input : the page's stereo mix (Lt / Rt — a matrix-encoded pair).
   Output: five mono channels [L, R, C, Ls, Rs] that app.js places on virtual
           speakers with HRTF panners for headphone playback.

   How it works (the same idea as a hardware PLII decoder):

   1. PASSIVE MATRIX — fixed decode equations, always running:
        C  = 0.7071 (Lt + Rt)                      (in-phase content)
        Ls = 0.4899·Rt − 0.8718·Lt                 (PLII surround coefficients)
        Rs = 0.8718·Rt − 0.4899·Lt
      Passive alone gives poor separation (adjacent channels ~3 dB apart).

   2. DOMINANCE DETECTION — envelope followers (fast attack, slow release)
      track |Lt|, |Rt|, |Lt+Rt| and |Lt−Rt|. Two steering axes come out as
      log-ratios, exactly Dolby's two servo axes:
        x = level(Rt)   vs level(Lt)      → left ↔ right
        y = level(sum)  vs level(diff)    → centre/front ↔ surround/rear
      The vector (x, y) points at the dominant sound direction; its length is
      the steering confidence (diffuse sound → short vector → little steering).

   3. ADAPTIVE MATRIX — outputs aligned with the dominant direction are kept
      (and slightly boosted); outputs away from it are attenuated by up to
      18 dB, scaled by confidence. Gains are smoothed per-sample so steering
      is inaudible as such — you only hear the image sharpen.

   Simplifications vs a real Dolby implementation (documented in the course):
   the 90° phase quadrature is approximated by polarity, and steering uses an
   analytic gating law rather than Dolby's proprietary coefficient tables.
   ============================================================================ */
'use strict';

class PLIIActiveProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // envelope followers for the four steering detectors
    this.eL = this.eR = this.eC = this.eS = 1e-4;
    // smoothed per-output attenuation [L, R, C, Ls, Rs]
    this.att = [1, 1, 1, 1, 1];
    const sr = sampleRate;
    this.kAtt = 1 - Math.exp(-1 / (0.003 * sr));   // detector attack   ~3 ms
    this.kRel = 1 - Math.exp(-1 / (0.080 * sr));   // detector release  ~80 ms
    this.sFast = 1 - Math.exp(-1 / (0.008 * sr));  // gain duck         ~8 ms
    this.sSlow = 1 - Math.exp(-1 / (0.150 * sr));  // gain recover      ~150 ms
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const Lt = inp[0];
    const Rt = inp.length > 1 ? inp[1] : inp[0];
    const o0 = outputs[0][0], o1 = outputs[1][0], o2 = outputs[2][0];
    const o3 = outputs[3][0], o4 = outputs[4][0];
    if (!o0 || !o1 || !o2 || !o3 || !o4) return true;

    const A = 0.8718, B = 0.4899, EPS = 1e-6;
    // virtual speaker unit vectors (x: + = right, y: + = front)
    const SPK = [
      [-0.7071,  0.7071],   // L
      [ 0.7071,  0.7071],   // R
      [ 0,       1],        // C
      [-0.7071, -0.7071],   // Ls
      [ 0.7071, -0.7071],   // Rs
    ];

    const n = Lt.length;
    for (let i = 0; i < n; i++) {
      const l = Lt[i], r = Rt[i];
      const c0 = 0.7071 * (l + r);
      const s0 = 0.7071 * (l - r);

      // --- dominance detection (the two servo axes) ---
      let a = Math.abs(l);  this.eL += (a > this.eL ? this.kAtt : this.kRel) * (a - this.eL);
      a = Math.abs(r);      this.eR += (a > this.eR ? this.kAtt : this.kRel) * (a - this.eR);
      a = Math.abs(c0);     this.eC += (a > this.eC ? this.kAtt : this.kRel) * (a - this.eC);
      a = Math.abs(s0);     this.eS += (a > this.eS ? this.kAtt : this.kRel) * (a - this.eS);
      // log-ratio steering axes, ±12 dB full scale  (1.6667 = 20/12)
      let x = 1.6667 * Math.log10((this.eR + EPS) / (this.eL + EPS));
      let y = 1.6667 * Math.log10((this.eC + EPS) / (this.eS + EPS));
      x = x < -1 ? -1 : x > 1 ? 1 : x;
      y = y < -1 ? -1 : y > 1 ? 1 : y;
      const m = Math.sqrt(x * x + y * y);
      const g = m > 1 ? 1 : m;                       // steering confidence
      const ux = m > EPS ? x / m : 0;
      const uy = m > EPS ? y / m : 0;

      // --- passive matrix ---
      const pL = l;
      const pR = r;
      const pC = c0;
      const pLs = B * r - A * l;                     // PLII surround decode
      const pRs = A * r - B * l;

      // --- adaptive matrix: gate away from the dominant direction ---
      for (let k = 0; k < 5; k++) {
        const align = Math.max(0, ux * SPK[k][0] + uy * SPK[k][1]);
        // up to −24 dB cancellation off-axis, gentle boost on-axis
        const t = (1 - 0.937 * g * (1 - align)) * (1 + 0.5 * g * align);
        const cur = this.att[k];
        this.att[k] = cur + (t < cur ? this.sFast : this.sSlow) * (t - cur);
      }

      o0[i] = pL * this.att[0];
      o1[i] = pR * this.att[1];
      o2[i] = pC * this.att[2];
      o3[i] = 0.8 * pLs * this.att[3];
      o4[i] = 0.8 * pRs * this.att[4];
    }
    return true;
  }
}

registerProcessor('plii-active', PLIIActiveProcessor);
