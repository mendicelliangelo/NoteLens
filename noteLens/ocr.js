/* NoteLens · ocr
   Funziona nel browser (window.NoteLens.ocr) e in Node (module.exports). */
(function (root) {
  'use strict';
  const NL = root.NoteLens = root.NoteLens || {};

  const TYPE_BY_FLAGS = ['quarter', 'eighth', 'sixteenth', 'thirtysecond'];

  /* ------------------------------------------------------------------ */
  /* Elaborazione di immagine                                            */
  /* ------------------------------------------------------------------ */
  function otsu(g) {
    const h = new Float64Array(256);
    for (let i = 0; i < g.length; i++) h[g[i]]++;
    const tot = g.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * h[i];
    let wB = 0, sB = 0, best = -1, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += h[t];
      if (!wB) continue;
      const wF = tot - wB;
      if (!wF) break;
      sB += t * h[t];
      const mB = sB / wB, mF = (sum - sB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr + 1;
  }

  function downscale(g, w, h, s) {
    const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const sy0 = Math.floor(y / s), sy1 = Math.min(h, Math.max(sy0 + 1, Math.floor((y + 1) / s)));
      for (let x = 0; x < W; x++) {
        const sx0 = Math.floor(x / s), sx1 = Math.min(w, Math.max(sx0 + 1, Math.floor((x + 1) / s)));
        let sum = 0, n = 0;
        for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { sum += g[yy * w + xx]; n++; }
        out[y * W + x] = n ? Math.round(sum / n) : 255;
      }
    }
    return { gray: out, W, H };
  }

  // nero = 1. Soglia globale combinata con media locale (regge ombre e sfondi irregolari).
  function binarize(g, W, H, thr) {
    const R = Math.max(10, Math.min(60, Math.round(Math.min(W, H) / 14)));
    const S = W + 1;
    const I = new Uint32Array(S * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += g[y * W + x];
        I[(y + 1) * S + x + 1] = I[y * S + x + 1] + row;
      }
    }
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      for (let x = 0; x < W; x++) {
        const v = g[y * W + x];
        if (v >= thr) continue;
        const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
        const area = (x1 - x0) * (y1 - y0);
        const sum = I[y1 * S + x1] - I[y0 * S + x1] - I[y1 * S + x0] + I[y0 * S + x0];
        if (v < sum / area - 10) out[y * W + x] = 1;
      }
    }
    return out;
  }

  function estimateSkew(bin, W, H) {
    let count = 0;
    for (let i = 0; i < bin.length; i++) count += bin[i];
    if (count < 200) return 0;
    const stride = Math.max(1, Math.floor(count / 120000));
    const xs = [], ys = [];
    let k = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (bin[y * W + x]) { if (k++ % stride === 0) { xs.push(x); ys.push(y); } }
      }
    }
    const n = xs.length;
    const off = Math.ceil(W * 0.1) + 2;
    const hist = new Int32Array(H + 2 * off + 8);
    function score(deg) {
      const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      hist.fill(0);
      for (let i = 0; i < n; i++) {
        const yy = Math.round(ys[i] * c - xs[i] * s) + off;
        if (yy >= 0 && yy < hist.length) hist[yy]++;
      }
      let sc = 0;
      for (let i = 0; i < hist.length; i++) sc += hist[i] * hist[i];
      return sc;
    }
    let bestA = 0, bestS = -1;
    for (let d = -4; d <= 4.001; d += 0.25) { const sc = score(d); if (sc > bestS) { bestS = sc; bestA = d; } }
    const c0 = bestA;
    for (let d = c0 - 0.25; d <= c0 + 0.2501; d += 0.05) { const sc = score(d); if (sc > bestS) { bestS = sc; bestA = d; } }
    return bestA * Math.PI / 180;
  }

  function rotateGray(g, W, H, th) {
    const c = Math.cos(th), s = Math.sin(th), cx = W / 2, cy = H / 2;
    const out = new Uint8Array(W * H).fill(255);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx, dy = y - cy;
        const xs = cx + dx * c - dy * s, ys = cy + dx * s + dy * c;
        const x0 = Math.floor(xs), y0 = Math.floor(ys);
        if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
        const fx = xs - x0, fy = ys - y0;
        const i = y0 * W + x0;
        const v = g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + W] * (1 - fx) * fy + g[i + W + 1] * fx * fy;
        out[y * W + x] = v;
      }
    }
    return out;
  }

  function label(bin, w, h, val, conn8) {
    const N = w * h;
    const lab = new Int32Array(N);
    const comps = [null];
    const stack = new Int32Array(N);
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (bin[i] !== val || lab[i]) continue;
      n++;
      let sp = 0;
      stack[sp++] = i; lab[i] = n;
      let area = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, border = false;
      while (sp) {
        const p = stack[--sp];
        const y = (p / w) | 0, x = p - y * w;
        area++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        const l = x > 0, r = x < w - 1, u = y > 0, d = y < h - 1;
        let q;
        if (l && bin[q = p - 1] === val && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        if (r && bin[q = p + 1] === val && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        if (u && bin[q = p - w] === val && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        if (d && bin[q = p + w] === val && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        if (conn8) {
          if (l && u && bin[q = p - w - 1] === val && !lab[q]) { lab[q] = n; stack[sp++] = q; }
          if (r && u && bin[q = p - w + 1] === val && !lab[q]) { lab[q] = n; stack[sp++] = q; }
          if (l && d && bin[q = p + w - 1] === val && !lab[q]) { lab[q] = n; stack[sp++] = q; }
          if (r && d && bin[q = p + w + 1] === val && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        }
      }
      comps.push({ id: n, area, x0, y0, x1, y1, border });
    }
    return { lab, comps };
  }

  // Erosione / dilatazione con elemento strutturante rettangolare sx x sy (separabili, O(N)).
  function boxOp(src, w, h, sx, sy, isErode) {
    const loX = isErode ? (sx >> 1) : (sx - 1 - (sx >> 1)), hiX = sx - 1 - loX;
    const loY = isErode ? (sy >> 1) : (sy - 1 - (sy >> 1)), hiY = sy - 1 - loY;
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    const pre = new Int32Array(Math.max(w, h) + 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + src[y * w + x];
      for (let x = 0; x < w; x++) {
        const a = x - loX, b = x + hiX;
        const a0 = Math.max(0, a), b0 = Math.min(w - 1, b);
        const cnt = pre[b0 + 1] - pre[a0];
        tmp[y * w + x] = isErode ? ((a >= 0 && b < w && cnt === sx) ? 1 : 0) : (cnt > 0 ? 1 : 0);
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        const a = y - loY, b = y + hiY;
        const a0 = Math.max(0, a), b0 = Math.min(h - 1, b);
        const cnt = pre[b0 + 1] - pre[a0];
        out[y * w + x] = isErode ? ((a >= 0 && b < h && cnt === sy) ? 1 : 0) : (cnt > 0 ? 1 : 0);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Scala, righi curvi e raddrizzamento                                 */
  /* ------------------------------------------------------------------ */
  const SP_REF = 16; // distanza canonica tra le linee, in pixel, per l'analisi

  function resizeGray(g, w, h, f) {
    if (f < 1) { const r = downscale(g, w, h, f); return { gray: r.gray, W: r.W, H: r.H }; }
    const W = Math.max(1, Math.round(w * f)), H = Math.max(1, Math.round(h * f));
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const ys = Math.max(0, Math.min(h - 1.001, (y + 0.5) * h / H - 0.5)), y0 = Math.floor(ys), fy = ys - y0;
      for (let x = 0; x < W; x++) {
        const xs = Math.max(0, Math.min(w - 1.001, (x + 0.5) * w / W - 0.5)), x0 = Math.floor(xs), fx = xs - x0;
        const i = y0 * w + x0;
        out[y * W + x] = g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy;
      }
    }
    return { gray: out, W, H };
  }

  // distanza tra le linee e spessore: moda delle coppie (nero + bianco successivo) lungo le colonne
  function estimateSpacing(bin, W, H) {
    const hist = new Float64Array(121), pairs = [];
    for (let x = 0; x < W; x += 2) {
      let y = 0;
      while (y < H) {
        while (y < H && !bin[y * W + x]) y++;
        const bs = y;
        while (y < H && bin[y * W + x]) y++;
        const b = y - bs;
        if (b === 0) break;
        const ws = y;
        while (y < H && !bin[y * W + x]) y++;
        const wh = y - ws;
        if (y >= H && wh === 0) break;
        if (b <= 8 && b + wh <= 120) { hist[b + wh]++; pairs.push(b, b + wh); }
      }
    }
    let best = 0, sp = 0;
    for (let i = 4; i <= 120; i++) {
      const v = hist[i - 1] + 2 * hist[i] + hist[i + 1 > 120 ? 120 : i + 1];
      if (v > best) { best = v; sp = i; }
    }
    if (!sp || best < 40) return null;
    const bh = new Float64Array(9);
    for (let i = 0; i < pairs.length; i += 2) if (Math.abs(pairs[i + 1] - sp) <= 1) bh[pairs[i]]++;
    let th = 1, bb = 0;
    for (let i = 1; i <= 8; i++) if (bh[i] > bb) { bb = bh[i]; th = i; }
    return { sp, th };
  }

  // cresta: pixel più scuro dei vicini sopra e sotto (linee sottili e orizzontali; esclude travi, gambi e teste)
  function ridgeMap(g, W, H, th) {
    const d = Math.max(2, th + 2), R = new Uint8Array(W * H);
    for (let y = d; y < H - d; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, a = g[i - d * W], b = g[i + d * W], m = a < b ? a : b;
        const v = m - g[i];
        if (v > 0) R[i] = v > 255 ? 255 : v;
      }
    }
    return R;
  }

  function medianFilter(a, r) {
    const n = a.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      const w = a.slice(Math.max(0, i - r), Math.min(n, i + r + 1)).sort((p, q) => p - q);
      out[i] = w[w.length >> 1];
    }
    return out;
  }
  function smoothMA(a, r) {
    const n = a.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) { s += a[k]; c++; }
      out[i] = s / c;
    }
    return out;
  }

  // Trova i righi, anche inclinati o curvi: strisce verticali -> gruppi di 5 linee -> catene.
  function findStavesStrips(gray, W, H, sp, th) {
    const R = ridgeMap(gray, W, H, th);
    const ws = Math.max(24, Math.round(2.6 * sp)), step = Math.max(8, ws >> 1);
    const strips = [];
    for (let x0 = 0; x0 + ws <= W; x0 += step) {
      const P = new Float64Array(H);
      for (let y = 0; y < H; y++) { let c = 0; const o = y * W + x0; for (let x = 0; x < ws; x++) c += R[o + x]; P[y] = c; }
      const Q = new Float64Array(H);
      for (let y = 1; y < H - 1; y++) Q[y] = (P[y - 1] + 2 * P[y] + P[y + 1]) / 4;
      let pmax = 0;
      for (let y = 0; y < H; y++) if (Q[y] > pmax) pmax = Q[y];
      const floor = Math.max(7 * ws, 0.14 * pmax);
      let peaks = [];
      for (let y = 2; y < H - 2; y++) {
        if (Q[y] < floor || Q[y] < Q[y - 1] || Q[y] <= Q[y + 1]) continue;
        let a = 0, b = 0;
        for (let k = -2; k <= 2; k++) { a += P[y + k] * (y + k); b += P[y + k]; }
        const cy = a / b;
        if (peaks.length && cy - peaks[peaks.length - 1].y < 0.45 * sp) { if (Q[y] > peaks[peaks.length - 1].v) peaks[peaks.length - 1] = { y: cy, v: Q[y] }; continue; }
        peaks.push({ y: cy, v: Q[y] });
      }
      // cinque picchi ugualmente distanziati, anche con picchi spuri in mezzo
      const cands = [];
      for (let i = 0; i < peaks.length; i++) {
        for (let d = 0.72 * sp; d <= 1.35 * sp; d += 0.5) {
          const pick = [peaks[i]];
          const tol = Math.max(1.6, 0.14 * d);
          for (let k = 1; k <= 4; k++) {
            let best = null;
            for (const p of peaks) if (Math.abs(p.y - (peaks[i].y + k * d)) <= tol && (!best || Math.abs(p.y - (peaks[i].y + k * d)) < Math.abs(best.y - (peaks[i].y + k * d)))) best = p;
            if (!best) break;
            pick.push(best);
          }
          if (pick.length < 5) continue;
          const mean = (pick[4].y - pick[0].y) / 4;
          let ok = mean >= 0.6 * sp && mean <= 1.5 * sp;
          for (let k = 1; k < 4 && ok; k++) if (Math.abs(pick[k].y - (pick[0].y + k * mean)) > Math.max(1.8, 0.16 * mean)) ok = false;
          if (ok) {
            const vs = pick.map(p => p.v).sort((p, q) => p - q);
            if (vs[0] < 0.4 * vs[2]) ok = false;
          }
          if (ok) cands.push({ y: pick.map(p => p.y), score: pick.reduce((q, p) => q + p.v, 0) });
        }
      }
      cands.sort((a, b) => b.score - a.score);
      const groups = [];
      for (const c of cands) {
        if (groups.some(g => c.y[0] < g.y[4] + 0.5 * sp && c.y[4] > g.y[0] - 0.5 * sp)) continue;
        groups.push({ xc: x0 + ws / 2, y: c.y });
      }
      groups.sort((a, b) => a.y[0] - b.y[0]);
      strips.push(groups);
    }
    // catene
    const chains = [];
    const mean = g => (g.y[0] + g.y[4]) / 2;
    strips.forEach((groups, si) => {
      const used = new Set();
      for (const g of groups) {
        let best = null, bd = 1e9;
        for (const c of chains) {
          if (used.has(c) || si - c.last > 4) continue;
          const d = Math.abs(mean(c.pts[c.pts.length - 1]) - mean(g));
          if (d < bd && d <= 0.4 * sp * (1 + 0.6 * (si - c.last - 1))) { bd = d; best = c; }
        }
        if (best) { best.pts.push(g); best.last = si; used.add(best); }
        else { const c = { pts: [g], last: si }; chains.push(c); used.add(c); }
      }
    });
    // unione di catene spezzate da una zona sporca (testo, etichette, ombre)
    let merged = true;
    while (merged) {
      merged = false;
      chains.sort((a, b) => a.pts[0].xc - b.pts[0].xc);
      outer: for (let i = 0; i < chains.length; i++) for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const A = chains[i], B = chains[j];
        const ea = A.pts[A.pts.length - 1], sb = B.pts[0];
        const gap = sb.xc - ea.xc;
        const med3 = arr => { const v = arr.map(mean).sort((p, q) => p - q); return v[v.length >> 1]; };
        const yA = med3(A.pts.slice(-3)), yB = med3(B.pts.slice(0, 3));
        if (gap > 0 && gap <= 20 * step && Math.abs(yA - yB) <= 0.45 * sp + 0.12 * gap) {
          A.pts = A.pts.concat(B.pts); chains.splice(j, 1); merged = true; break outer;
        }
      }
    }
    // scarta le catene contenute in un'altra (stesso rigo trovato due volte)
    chains.sort((a, b) => b.pts.length - a.pts.length);
    const keepCh = [];
    for (const c of chains) {
      let covered = 0;
      for (const p of c.pts) {
        for (const k of keepCh) {
          const q = k.pts.find(z => Math.abs(z.xc - p.xc) < 1);
          if (q && Math.abs(mean(q) - mean(p)) < 2.2 * sp) { covered++; break; }
        }
      }
      if (covered < 0.5 * c.pts.length) keepCh.push(c);
    }
    chains.length = 0; chains.push(...keepCh);
    const staves = [];
    for (const c of chains) {
      const xs = c.pts.map(p => p.xc);
      if (c.pts.length < 5 || xs[xs.length - 1] - xs[0] < 8 * sp) continue;
      // serie per linea: mediana + media mobile contro i valori anomali
      c.pts.sort((p, q) => p.xc - q.xc);
      const xs0 = c.pts.map(p => p.xc);
      const mser = c.pts.map(p => (p.y[0] + p.y[4]) / 2), mmed = medianFilter(mser, 4);
      const goodIdx = [];
      c.pts.forEach((p, i) => { if (Math.abs(mser[i] - mmed[i]) <= 0.3 * sp) goodIdx.push(i); });
      if (goodIdx.length < 5) continue;
      c.pts = goodIdx.map(i => c.pts[i]);
      xs.length = 0; c.pts.forEach(p => xs.push(p.xc));
      const Y = [0, 1, 2, 3, 4].map(k => smoothMA(medianFilter(c.pts.map(p => p.y[k]), 3), 1));
      const x0 = Math.max(0, Math.round(xs[0] - ws / 2)), x1 = Math.min(W - 1, Math.round(xs[xs.length - 1] + ws / 2));
      const len = x1 - x0 + 1;
      const lines = [0, 1, 2, 3, 4].map(() => new Float32Array(len));
      for (let k = 0; k < 5; k++) {
        let j = 0;
        for (let i = 0; i < len; i++) {
          const x = x0 + i;
          while (j < xs.length - 2 && xs[j + 1] < x) j++;
          const a = xs[j], b = xs[Math.min(j + 1, xs.length - 1)];
          const t = b > a ? (x - a) / (b - a) : 0;
          lines[k][i] = Y[k][j] + (Y[k][Math.min(j + 1, xs.length - 1)] - Y[k][j]) * t;
        }
      }
      const spL = new Float32Array(len), mid = new Float32Array(len), top = new Float32Array(len), theta = new Float32Array(len);
      for (let i = 0; i < len; i++) { top[i] = lines[0][i]; spL[i] = (lines[4][i] - lines[0][i]) / 4; mid[i] = lines[2][i]; }
      for (let i = 0; i < len; i++) { const a = Math.max(0, i - 10), b = Math.min(len - 1, i + 10); theta[i] = (mid[b] - mid[a]) / Math.max(1, b - a); }
      let spm = 0; for (let i = 0; i < len; i++) spm += spL[i];
      staves.push({ x0, x1, lines, sp: spm / len, spL, mid, top, theta, thick: th });
    }
    staves.sort((a, b) => a.top[0] - b.top[0]);
    return staves;
  }

  // Corregge gli ultimi pixel: sposta in verticale ogni colonna della banda perche' le 5 linee cadano sulle righe canoniche.
  function refineBand(band, th) {
    const { W, H, M } = band;
    const wnd = 48, stride = 8;
    if (W < wnd + 8) return;
    const Rg = ridgeMap(band.gray, W, H, th);
    const cs = [], ds = [], sc = [];
    for (let xc = wnd >> 1; xc <= W - (wnd >> 1); xc += stride) {
      let best = -1, bd = 0, tot = 0;
      for (let d = -6; d <= 6; d++) {
        let v = 0;
        for (let k = 0; k < 5; k++) {
          const yl = M + k * SP_REF + d;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = yl + dy;
            if (yy < 0 || yy >= H) continue;
            const o = yy * W + xc - (wnd >> 1);
            for (let x = 0; x < wnd; x++) v += Rg[o + x];
          }
        }
        tot += v;
        if (v > best) { best = v; bd = d; }
      }
      cs.push(xc); ds.push(bd); sc.push(best / (tot / 13 + 1));
    }
    // dove il picco non spicca si tiene lo spostamento dei vicini
    const good = ds.map((d, i) => sc[i] > 1.12);
    const filled = ds.slice();
    for (let i = 0; i < ds.length; i++) {
      if (good[i]) continue;
      let l = i - 1, r = i + 1;
      while (l >= 0 && !good[l]) l--;
      while (r < ds.length && !good[r]) r++;
      filled[i] = l >= 0 && r < ds.length ? (filled[l] + ds[r]) / 2 : l >= 0 ? ds[l] : r < ds.length ? ds[r] : 0;
    }
    const sm = smoothMA(medianFilter(filled, 3), 1);
    const delta = new Float32Array(W);
    for (let x = 0, j = 0; x < W; x++) {
      while (j < cs.length - 2 && cs[j + 1] < x) j++;
      const a = cs[j], b = cs[Math.min(j + 1, cs.length - 1)];
      const t = b > a ? Math.max(0, Math.min(1, (x - a) / (b - a))) : 0;
      delta[x] = sm[j] + (sm[Math.min(j + 1, sm.length - 1)] - sm[j]) * t;
    }
    const out = new Uint8Array(W * H).fill(255);
    for (let x = 0; x < W; x++) {
      const d = delta[x];
      for (let y = 0; y < H; y++) {
        const ys = y + d;
        if (ys < 0 || ys >= H - 1) continue;
        const y0 = Math.floor(ys), f = ys - y0;
        out[y * W + x] = band.gray[y0 * W + x] * (1 - f) + band.gray[(y0 + 1) * W + x] * f;
      }
    }
    band.gray = out;
    const mb = band.mapBack;
    band.mapBack = (xd, yd) => mb(xd, yd + delta[Math.max(0, Math.min(W - 1, Math.round(xd)))]);
  }

  // Appiattisce un rigo in una striscia con linee orizzontali e distanza SP_REF.
  function buildBand(gray, W, H, st, prev, next) {
    const Wb = st.x1 - st.x0 + 1, M = Math.round(5.2 * SP_REF), Hb = 2 * M + 4 * SP_REF;
    const out = new Uint8Array(Wb * Hb).fill(255);
    for (let xd = 0; xd < Wb; xd++) {
      const x = st.x0 + xd;
      let up = -1e9, dn = 1e9;
      if (prev && x >= prev.x0 && x <= prev.x1) up = (prev.lines[4][x - prev.x0] + st.lines[0][xd]) / 2;
      if (next && x >= next.x0 && x <= next.x1) dn = (st.lines[4][xd] + next.lines[0][x - next.x0]) / 2;
      const top = st.top[xd], spx = st.spL[xd], mid = st.mid[xd], th = st.theta[xd];
      for (let yd = 0; yd < Hb; yd++) {
        const ys = top + (yd - M) / SP_REF * spx;
        if (ys < up || ys > dn || ys < 0 || ys >= H - 1) continue;
        const xs = x - (ys - mid) * th;
        if (xs < 0 || xs >= W - 1) continue;
        const x0 = Math.floor(xs), y0 = Math.floor(ys), fx = xs - x0, fy = ys - y0, i = y0 * W + x0;
        out[yd * Wb + xd] = gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy) + gray[i + W] * (1 - fx) * fy + gray[i + W + 1] * fx * fy;
      }
    }
    const mapBack = (xd, yd) => {
      const i = Math.max(0, Math.min(Wb - 1, Math.round(xd)));
      const ys = st.top[i] + (yd - M) / SP_REF * st.spL[i];
      return [st.x0 + xd - (ys - st.mid[i]) * st.theta[i], ys];
    };
    return { gray: out, W: Wb, H: Hb, M, mapBack };
  }

  /* ------------------------------------------------------------------ */
  /* Analisi di un rigo                                                  */
  /* ------------------------------------------------------------------ */
  function runAt(B, bw, bh, x, y) {
    let a = y, b = y;
    for (;;) { if (a > 0 && B[(a - 1) * bw + x]) a--; else if (a > 1 && B[(a - 2) * bw + x]) a -= 2; else if (a > 2 && B[(a - 3) * bw + x]) a -= 3; else break; }
    for (;;) { if (b < bh - 1 && B[(b + 1) * bw + x]) b++; else if (b < bh - 2 && B[(b + 2) * bw + x]) b += 2; else if (b < bh - 3 && B[(b + 3) * bw + x]) b += 3; else break; }
    return [a, b];
  }

  function tightBox(lab, bw, comp, xa, xb) {
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = comp.y0; y <= comp.y1; y++) {
      for (let x = xa; x <= xb; x++) {
        if (lab[y * bw + x] === comp.id) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x0, x1, y0, y1 };
  }

  function findStem(Bc, bw, bh, hd, sp) {
    const m0 = Math.max(0, Math.round(hd.y0 - 0.6 * sp)), m1 = Math.min(bh - 1, Math.round(hd.y1 + 0.6 * sp));
    let best = null;
    for (const side of [1, -1]) {
      const xa = side > 0 ? Math.round(hd.x1 - 0.6 * sp) : Math.round(hd.x0 - 0.45 * sp);
      const xb = side > 0 ? Math.round(hd.x1 + 0.45 * sp) : Math.round(hd.x0 + 0.6 * sp);
      for (let x = xa; x <= xb; x++) {
        if (x < 0 || x >= bw) continue;
        for (let y = m0; y <= m1; y++) {
          if (!Bc[y * bw + x]) continue;
          const r = runAt(Bc, bw, bh, x, y);
          const len = r[1] - r[0] + 1;
          if (!best || len > best.len) best = { x, a: r[0], b: r[1], len };
          y = r[1];
        }
      }
    }
    if (!best || best.len < 2.2 * sp) return null;
    const up = (hd.y0 - best.a) >= (best.b - hd.y1);
    return { x: best.x, up, tip: up ? best.a : best.b, len: best.len, a: best.a, b: best.b };
  }

  function flagCount(Bc, bw, bh, stem, sp, ly, th) {
    const win = Math.round(2.1 * sp), minTh = Math.max(2, Math.round(0.2 * sp));
    const yA = Math.max(0, stem.up ? stem.tip : stem.tip - win);
    const yB = Math.min(bh - 1, stem.up ? stem.tip + win : stem.tip);
    const inLine = (ya, yb) => ly.some(yl => ya >= yl - th / 2 - 1.5 && yb <= yl + th / 2 + 1.5);
    let best = 0;
    for (const d of [0.45, 0.7, 0.95]) {
      for (const sg of [-1, 1]) {
        const xx = Math.round(stem.x + sg * d * sp);
        if (xx < 0 || xx >= bw) continue;
        let cnt = 0, start = -1;
        for (let y = yA; y <= yB + 1; y++) {
          const on = y <= yB && Bc[y * bw + xx];
          if (on && start < 0) start = y;
          if (!on && start >= 0) {
            const end = y - 1;
            if (end - start + 1 >= minTh && !inLine(start, end)) cnt++;
            start = -1;
          }
        }
        if (cnt > best) best = cnt;
      }
    }
    return Math.min(best, 3);
  }

  function hasDot(Bc, bw, bh, hd, sp, th) {
    const xa = Math.round(hd.x1 + 0.25 * sp), xb = Math.round(hd.x1 + 1.25 * sp);
    const ya = Math.round(hd.cy - 0.75 * sp), yb = Math.round(hd.cy + 0.35 * sp);
    let n = 0, mx0 = 1e9, mx1 = -1, my0 = 1e9, my1 = -1;
    for (let y = Math.max(0, ya); y <= Math.min(bh - 1, yb); y++) {
      for (let x = Math.max(0, xa); x <= Math.min(bw - 1, xb); x++) {
        if (Bc[y * bw + x]) {
          n++;
          if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y;
        }
      }
    }
    if (!n) return false;
    const w = mx1 - mx0 + 1, h = my1 - my0 + 1;
    const minD = Math.max(0.18 * sp, th * 0.9);
    if (!(n >= 0.04 * sp * sp && w >= minD && h >= minD && w <= 0.7 * sp && h <= 0.7 * sp && n >= 0.4 * w * h)) return false;
    // se continua verso la testa è una linea addizionale, non un punto
    let left = 0;
    for (let y = my0; y <= my1; y++) if (mx0 - 1 >= 0 && Bc[y * bw + mx0 - 1]) left++;
    return left < 0.5 * h;
  }

  function analyzeStaff(bin, W, H, st, y0, y1, debug) {
    const sp = st.sp, th = st.thick;
    const cx0 = Math.max(0, Math.floor(st.x0 - sp)), cx1 = Math.min(W - 1, Math.ceil(st.x1 + sp));
    const bw = cx1 - cx0 + 1, bh = y1 - y0 + 1;
    const B0 = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) B0[y * bw + x] = bin[(y + y0) * W + x + cx0];
    const Bc = B0.slice();

    // 1) buchi piccoli (teste vuote), calcolati sull'immagine originale
    const wl = label(B0, bw, bh, 0, false);
    const okComp = new Uint8Array(wl.comps.length);
    for (const c of wl.comps) {
      if (!c) continue;
      const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
      if (!c.border && c.area >= 3 && c.area <= 0.55 * sp * sp && cw <= 1.3 * sp && ch <= 0.72 * sp && cw <= 3.2 * ch && c.area / (cw * ch) >= 0.58 && c.area / (cw * ch) <= 0.88) okComp[c.id] = 1;
    }
    const hole = new Uint8Array(bw * bh);
    for (let i = 0; i < hole.length; i++) if (wl.lab[i] && okComp[wl.lab[i]]) hole[i] = 1;

    // 2) rimozione delle linee del rigo: si cancellano solo le sequenze verticali sottili
    //    che non toccano un buco (gli archi di una testa vuota sono spessi quanto una linea)
    for (const yc of st.lines) {
      const yl = Math.round(yc) - y0;
      for (let x = 0; x < bw; x++) {
        let yi = -1;
        for (const d of [0, -1, 1]) {
          const yy = yl + d;
          if (yy >= 0 && yy < bh && B0[yy * bw + x]) { yi = yy; break; }
        }
        if (yi < 0) continue;
        let a = yi, b = yi;
        while (a > 0 && B0[(a - 1) * bw + x]) a--;
        while (b < bh - 1 && B0[(b + 1) * bw + x]) b++;
        if (b - a + 1 > th + 2) continue;
        let touch = false;
        for (let k = 1; k <= 2 && !touch; k++) {
          if (a - k >= 0 && hole[(a - k) * bw + x]) touch = true;
          if (b + k < bh && hole[(b + k) * bw + x]) touch = true;
        }
        if (touch) continue;
        for (let y = a; y <= b; y++) Bc[y * bw + x] = 0;
      }
    }
    const F = new Uint8Array(bw * bh);
    for (let i = 0; i < F.length; i++) F[i] = (Bc[i] || hole[i]) ? 1 : 0;

    // 3) apertura morfologica: via gambi, travi, bandierine e punti; restano le teste
    const ew = Math.max(3, Math.round(0.4 * sp)), eh = Math.max(4, Math.round(0.62 * sp));
    const O = boxOp(boxOp(F, bw, bh, ew, eh, true), bw, bh, ew, eh, false);
    const ol = label(O, bw, bh, 1, true);

    const rej = [];
    const R_ = (why, c) => { if (debug) rej.push({ why, x0: c.x0 + cx0, x1: c.x1 + cx0, y0: c.y0 + y0, y1: c.y1 + y0 }); };
    if (debug) st.dbg = { B0, Bc, hole, F, O, bw, bh, cx0, y0, rej };
    const topLine = st.lines[0] - y0, botLine = st.lines[4] - y0;
    const heads = [];
    for (const c of ol.comps) {
      if (!c) continue;
      const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
      if (c.area < 0.35 * sp * sp) { R_('area', c); continue; }
      if (c.area / (w * h) < 0.45) { R_('fill', c); continue; }
      if (w > 2.4 * sp || h < 0.6 * sp || h > 5 * sp) { R_('size', c); continue; }
      if (w < 0.7 * sp) { R_('narrow', c); continue; }
      if (h > 2.8 * sp && h / w > 4.2) { R_('bar', c); continue; } // stanghette spesse / doppie
      { // una trave continua a sinistra e a destra non è una testa
        const reach = Math.round(1.6 * sp), need = Math.round(0.7 * sp);
        let beam = false;
        for (const f of [0.3, 0.5, 0.7]) {
          const y = Math.round(c.y0 + f * (c.y1 - c.y0));
          let L = 0, R = 0;
          for (let x = c.x0 - 1; x >= Math.max(0, c.x0 - reach) && Bc[y * bw + x]; x--) L++;
          for (let x = c.x1 + 1; x <= Math.min(bw - 1, c.x1 + reach) && Bc[y * bw + x]; x++) R++;
          if (L >= need && R >= need) { beam = true; break; }
        }
        if (beam) { R_('beam', c); continue; }
      }
      let parts = [{ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 }];
      if (w > 1.7 * sp) {
        const mid = Math.floor((c.x0 + c.x1) / 2);
        parts = [tightBox(ol.lab, bw, c, c.x0, mid), tightBox(ol.lab, bw, c, mid + 1, c.x1)].filter(Boolean);
      }
      for (const p of parts) {
        const ph = p.y1 - p.y0 + 1;
        const n = ph > 1.55 * sp ? Math.max(2, Math.round((ph - 0.9 * sp) / sp) + 1) : 1;
        if (n === 1) heads.push(p);
        else for (let i = 0; i < n; i++) {
          const cy = p.y0 + 0.45 * sp + i * (ph - 0.9 * sp) / (n - 1);
          heads.push({ x0: p.x0, x1: p.x1, y0: Math.round(cy - 0.45 * sp), y1: Math.round(cy + 0.45 * sp) });
        }
      }
    }

    const lyLocal = st.lines.map(v => v - y0);
    const notes = [];
    for (const hd of heads) {
      hd.cx = (hd.x0 + hd.x1) / 2; hd.cy = (hd.y0 + hd.y1) / 2;
      if (hd.cy < topLine - 4.3 * sp || hd.cy > botLine + 4.3 * sp) continue;
      { // fuori dal rigo serve una linea addizionale: scarta lettere, dinamiche e macchie
        const below = hd.cy > botLine, edge = below ? botLine : topLine;
        const d = Math.abs(hd.cy - edge) / sp;
        if ((below ? hd.cy > botLine : hd.cy < topLine) && d > 0.8) {
          const yl = Math.round(edge + (below ? 1 : -1) * sp); // la prima linea addizionale deve esistere
          const ext = Math.max(2, Math.round(0.45 * sp)), gap = Math.max(1, Math.round(0.05 * sp)), tolY = Math.round(0.35 * sp);
          const cover = (xa, xb) => {
            let bestC = 0;
            for (let yy = yl - tolY; yy <= yl + tolY; yy++) {
              let hit = 0, tot = 0;
              for (let x = xa; x <= xb; x++) {
                if (x < 0 || x >= bw) continue;
                tot++;
                for (let y = yy - 1; y <= yy + 1; y++) {
                  if (y < 0 || y >= bh || !B0[y * bw + x]) continue;
                  let a = y, b = y; // una linea addizionale e' sottile, una trave no
                  while (a > 0 && B0[(a - 1) * bw + x]) a--;
                  while (b < bh - 1 && B0[(b + 1) * bw + x]) b++;
                  if (b - a + 1 <= th + 3) { hit++; break; }
                }
              }
              if (tot && hit / tot > bestC) bestC = hit / tot;
            }
            return bestC;
          };
          const L = cover(hd.x0 - ext, hd.x0 - gap), Rr = cover(hd.x1 + gap, hd.x1 + ext);
          if (L < 0.45 && Rr < 0.45) continue;
        }
      }
      let holeN = 0;
      for (let y = hd.y0; y <= hd.y1; y++) for (let x = hd.x0; x <= hd.x1; x++) if (hole[y * bw + x]) holeN++;
      const hollow = holeN / ((hd.x1 - hd.x0 + 1) * (hd.y1 - hd.y0 + 1)) >= 0.10;
      const stem = findStem(Bc, bw, bh, hd, sp);
      let type, conf = 1, flags = 0;
      if (stem) {
        flags = hollow ? 0 : flagCount(Bc, bw, bh, stem, sp, lyLocal, th);
        type = hollow ? 'half' : TYPE_BY_FLAGS[flags];
      } else if (hollow) type = 'whole';
      else { type = 'quarter'; conf = 0.35; }
      const dot = hasDot(Bc, bw, bh, hd, sp, th);
      const cyG = hd.cy + y0;
      notes.push({
        cx: hd.cx + cx0, cy: cyG,
        x0: hd.x0 + cx0, x1: hd.x1 + cx0, y0: hd.y0 + y0, y1: hd.y1 + y0,
        pos: Math.round((st.lines[4] - cyG) / (sp / 2)),
        hollow, type, dots: dot ? 1 : 0, conf, acc: null, deleted: false,
        stem: stem ? { x: stem.x + cx0, up: stem.up, tip: stem.tip + y0, a: stem.a + y0, b: stem.b + y0 } : null
      });
    }

    // 4) stanghette: colonne nere che coprono tutto il rigo e non appartengono a una testa
    const bars = [];
    const tp = Math.round(topLine), bt = Math.round(botLine);
    const cols = [];
    for (let x = 0; x < bw; x++) {
      let miss = 0, ok = true;
      for (let y = tp; y <= bt; y++) if (!Bc[y * bw + x]) { if (++miss > 2) { ok = false; break; } }
      if (ok) cols.push(x);
    }
    let k = 0;
    while (k < cols.length) {
      let e = k;
      while (e + 1 < cols.length && cols[e + 1] - cols[e] <= 1) e++;
      const cen = (cols[k] + cols[e]) / 2 + cx0;
      const nearHead = notes.some(n => cen >= n.x0 - 0.6 * sp && cen <= n.x1 + 0.6 * sp);
      if (!nearHead && (cols[e] - cols[k] + 1) <= 0.8 * sp) bars.push(cen);
      k = e + 1;
    }
    return { notes, bars };
  }

  /* ------------------------------------------------------------------ */
  /* Pipeline completa                                                   */
  /* ------------------------------------------------------------------ */
  function recognize(src, w, h, opts) {
    opts = Object.assign({ threshold: 1, deskew: true, maxDim: 3000 }, opts || {});
    let gray = src, W = w, H = h;
    const m = Math.max(w, h);
    if (m > opts.maxDim) {
      const r = downscale(src, w, h, opts.maxDim / m);
      gray = r.gray; W = r.W; H = r.H;
    }
    let T = otsu(gray);
    let bin = binarize(gray, W, H, T * opts.threshold);
    const warnings = [];
    // 1) normalizza la scala: le linee del rigo a circa SP_REF pixel l'una dall'altra
    const est0 = estimateSpacing(bin, W, H);
    if (est0) {
      let scale = Math.max(0.3, Math.min(3, SP_REF / est0.sp));
      if (Math.abs(scale - 1) < 0.12) scale = 1;
      const big = Math.max(W, H) * scale;
      if (big > 4200) scale *= 4200 / big;
      if (scale !== 1) {
        const r = resizeGray(gray, W, H, scale);
        gray = r.gray; W = r.W; H = r.H;
        T = otsu(gray);
        bin = binarize(gray, W, H, T * opts.threshold);
      }
    }
    // 2) raddrizza l'inclinazione generale
    let angle = 0;
    if (opts.deskew) {
      angle = estimateSkew(bin, W, H);
      if (Math.abs(angle) > 0.05 * Math.PI / 180) {
        gray = rotateGray(gray, W, H, angle);
        bin = binarize(gray, W, H, T * opts.threshold);
      } else angle = 0;
    }
    // 3) righi, anche curvi
    const est = estimateSpacing(bin, W, H);
    const staves = est ? findStavesStrips(gray, W, H, est.sp, est.th) : [];
    if (!staves.length) warnings.push('Nessun rigo trovato. Prova a cambiare la sensibilità o usa un\'immagine più nitida e frontale.');
    const notes = [];
    let gidCounter = 0;
    staves.forEach((st, i) => {
      const band = buildBand(gray, W, H, st, staves[i - 1], staves[i + 1]);
      refineBand(band, est.th);
      const bb = binarize(band.gray, band.W, band.H, T * opts.threshold);
      // allinea le linee canoniche al massimo della proiezione orizzontale
      const rows = new Float64Array(band.H);
      for (let y = 0; y < band.H; y++) { let c = 0; for (let x = 0; x < band.W; x++) c += bb[y * band.W + x]; rows[y] = c; }
      let bestD = 0, bestS = -1;
      for (let d = -4; d <= 4; d++) {
        let sc = 0;
        for (let k = 0; k < 5; k++) for (let dy = -1; dy <= 1; dy++) { const yy = band.M + d + k * SP_REF + dy; if (yy >= 0 && yy < band.H) sc += rows[yy]; }
        if (sc > bestS) { bestS = sc; bestD = d; }
      }
      const lines = [0, 1, 2, 3, 4].map(k => band.M + bestD + k * SP_REF);
      const sb = { lines, sp: SP_REF, thick: Math.max(1, Math.min(4, est.th)), x0: 0, x1: band.W - 1 };
      const r = analyzeStaff(bb, band.W, band.H, sb, 0, band.H - 1, opts.debug);
      st.spD = SP_REF;
      st.bars = r.bars;
      st.barSegs = r.bars.map(bx => {
        const p = band.mapBack(bx, lines[0] - 0.7 * SP_REF), q = band.mapBack(bx, lines[4] + 0.7 * SP_REF);
        return [p[0], p[1], q[0], q[1]];
      });
      st.mapBack = band.mapBack; st.bandM = lines[0]; st.bandH = band.H;
      if (opts.debug) st.dbg = { band, bb, r, a: sb.dbg };
      // raggruppamento in accordi: stesso gambo (o stessa x per le teste senza gambo)
      const ns = r.notes.sort((a, b) => a.cx - b.cx);
      const tol = 0.4 * SP_REF;
      const gstem = [];
      for (const n of ns) {
        let found = null;
        for (const g of gstem) {
          if (n.stem && g.stem && Math.abs(n.stem.x - g.stem.x) <= tol) { found = g; break; }
          if (!n.stem && !g.stem && Math.abs(n.cx - g.cx) <= 0.6 * SP_REF) { found = g; break; }
        }
        if (!found) { found = { id: ++gidCounter, stem: n.stem, cx: n.cx }; gstem.push(found); }
        n.gid = found.id;
      }
      // una bandierina che incrocia una linea del rigo forma un piccolo spazio chiuso e sembra una testa:
      // se un gambo ha una testa a ciascuna estremità, si tiene quella più grande
      const byG0 = {};
      for (const n of ns) (byG0[n.gid] = byG0[n.gid] || []).push(n);
      const drop = new Set();
      for (const gid in byG0) {
        const arr = byG0[gid];
        if (arr.length < 2 || !arr[0].stem) continue;
        const lo = Math.min(...arr.map(n => n.stem.a)), hi = Math.max(...arr.map(n => n.stem.b));
        if (hi - lo < 2.8 * SP_REF) continue;
        const topH = arr.filter(n => n.cy - lo < 1.5 * SP_REF), botH = arr.filter(n => hi - n.cy < 1.5 * SP_REF);
        if (!topH.length || !botH.length) continue;
        const wid = l => Math.max(...l.map(n => n.x1 - n.x0 + 1));
        const area = l => l.reduce((a, n) => a + (n.x1 - n.x0 + 1) * (n.y1 - n.y0 + 1), 0);
        const holl = l => l.some(n => n.hollow);
        const keepTop = holl(topH) !== holl(botH) ? !holl(topH) : (wid(topH) !== wid(botH) ? wid(topH) > wid(botH) : area(topH) >= area(botH));
        (keepTop ? botH : topH).forEach(n => drop.add(n));
      }
      if (drop.size) ns.splice(0, ns.length, ...ns.filter(n => !drop.has(n)));
      // la durata del gruppo è quella della prima testa con gambo
      const byG = {};
      for (const n of ns) (byG[n.gid] = byG[n.gid] || []).push(n);
      for (const gid in byG) {
        const lead = byG[gid].find(n => n.stem) || byG[gid][0];
        for (const n of byG[gid]) { n.type = lead.type; n.dots = lead.dots; if (lead.conf < n.conf) n.conf = lead.conf; }
      }
      // coordinate: dal rigo appiattito all'immagine
      for (const n of ns) {
        n.staff = i; n.dx = n.cx;
        const c = band.mapBack(n.cx, n.cy);
        const sc = st.spL[Math.max(0, Math.min(st.spL.length - 1, Math.round(n.cx)))] / SP_REF;
        const hw = (n.x1 - n.x0 + 1) / 2, hh = (n.y1 - n.y0 + 1) / 2 * sc;
        n.cx = c[0]; n.cy = c[1]; n.x0 = c[0] - hw; n.x1 = c[0] + hw; n.y0 = c[1] - hh; n.y1 = c[1] + hh;
        if (opts.debug) n.stemD = n.stem;
        n.stem = null;
      }
      notes.push(...ns);
    });
    notes.forEach((n, i) => { n.id = i; });
    return { W, H, gray, angle, staves, notes, warnings };
  }

  /* ---- da File/Blob immagine a livelli di grigio ---- */
  async function imageToGray(file, maxDim) {
    maxDim = maxDim || 3000;
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    }
    const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, maxDim / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = Math.round(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]);
    return { gray, w, h };
  }

  NL.ocr = { recognize, rotateGray, imageToGray };
  if (typeof module === 'object' && module.exports) module.exports = NL.ocr;
})(typeof self !== 'undefined' ? self : this);
