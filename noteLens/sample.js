/* NoteLens · sample
   Funziona nel browser (window.NoteLens.sample) e in Node (module.exports). */
(function (root) {
  'use strict';
  const NL = root.NoteLens = root.NoteLens || {};
  const music = NL.music || (typeof require === 'function' ? require('./music.js') : null);
  const { LETTERS, BEATS, BASE_DIATONIC } = music;
  function makeSample() {
    const sp = 16, W = 1200, H = 440;
    const g = new Uint8Array(W * H).fill(255);
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = v; };
    const rect = (x0, y0, x1, y1, v) => { for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) set(x, y, v); };
    const ell = (cx, cy, rx, ry, a, v) => {
      const ca = Math.cos(a), sa = Math.sin(a), R = Math.ceil(Math.max(rx, ry)) + 1;
      for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const u = dx * ca + dy * sa, w = -dx * sa + dy * ca;
        if ((u * u) / (rx * rx) + (w * w) / (ry * ry) <= 1) set(x, y, v);
      }
    };
    const seg = (x1, y1, x2, y2, r, v) => {
      const minx = Math.floor(Math.min(x1, x2) - r - 1), maxx = Math.ceil(Math.max(x1, x2) + r + 1);
      const miny = Math.floor(Math.min(y1, y2) - r - 1), maxy = Math.ceil(Math.max(y1, y2) + r + 1);
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        let t = L2 ? ((x + 0.5 - x1) * dx + (y + 0.5 - y1) * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = x1 + t * dx - (x + 0.5), py = y1 + t * dy - (y + 0.5);
        if (px * px + py * py <= r * r) set(x, y, v);
      }
    };
    const P = name => { const m = /^([A-G])(\d)$/.exec(name); return (parseInt(m[2], 10) * 7 + LETTERS.indexOf(m[1])) - BASE_DIATONIC.treble; };
    const N = (names, type, dot) => ({ ps: [].concat(names).map(P), type, dot: !!dot });
    const beats = it => BEATS[it.type] * (it.dot ? 1.5 : 1);
    const stemH = 56, rx = 10, ry = 7.2;

    function drawStaff(top, measures, final) {
      const x0 = 30, yb = top + 4 * sp;
      // layout
      let cur = x0 + 44;
      const barsX = [];
      const placed = [];
      for (const m of measures) {
        cur += 14;
        for (const u of m) {
          const items = u.beam ? u.beam : [u];
          for (const it of items) { it.cx = cur + 16; cur += 30 + 22 * beats(it); }
        }
        barsX.push(cur + 8);
        cur += 22;
        placed.push(m);
      }
      const x1 = barsX[barsX.length - 1] + (final ? 12 : 2);
      for (let k = 0; k < 5; k++) rect(x0, top + k * sp - 1, x1 + 1, top + k * sp + 1, 0);
      rect(x0, top - 1, x0 + 2, yb + 1, 0);
      barsX.forEach((bx, i) => {
        rect(bx, top - 1, bx + 2, yb + 1, 0);
        if (final && i === barsX.length - 1) rect(bx + 6, top - 1, bx + 11, yb + 1, 0);
      });
      const cyOf = p => yb - p * sp / 2;
      const drawHeads = it => {
        for (const p of it.ps) {
          const cy = cyOf(p), cx = it.cx;
          if (p <= -2) for (let q = -2; q >= p; q -= 2) rect(cx - 17, cyOf(q) - 1, cx + 17, cyOf(q) + 1, 0);
          if (p >= 10) for (let q = 10; q <= p; q += 2) rect(cx - 17, cyOf(q) - 1, cx + 17, cyOf(q) + 1, 0);
          if (it.type === 'whole') { ell(cx, cy, 11.5, 7.6, 0, 0); ell(cx, cy, 6.0, 3.3, -1.0, 255); }
          else if (it.type === 'half') { ell(cx, cy, rx + 0.5, ry + 0.2, -0.35, 0); ell(cx, cy, 6.2, 3.1, -0.9, 255); }
          else ell(cx, cy, rx, ry, -0.35, 0);
          if (it.dot) ell(cx + 19, cy + (p % 2 === 0 ? -8 : 0), 2.5, 2.5, 0, 0);
        }
      };
      const dirOf = ps => { const mx = Math.max(...ps), mn = Math.min(...ps); return (mx - 4) > (4 - mn) ? 'down' : 'up'; };
      for (const m of measures) {
        for (const u of m) {
          if (u.beam) {
            const items = u.beam, all = items.flatMap(i => i.ps);
            const dir = (all.reduce((a, b) => a + b, 0) / all.length) >= 4 ? 'down' : 'up';
            const cys = all.map(cyOf);
            const tip = dir === 'up' ? Math.min(...cys) - stemH : Math.max(...cys) + stemH;
            const sxs = items.map(it => dir === 'up' ? it.cx + rx - 1 : it.cx - rx + 1);
            items.forEach((it, i) => { drawHeads(it); const hy = cyOf(it.ps[0]); rect(sxs[i], Math.min(hy, tip), sxs[i] + 2, Math.max(hy, tip), 0); });
            const nb = items[0].type === 'sixteenth' ? 2 : 1;
            for (let b = 0; b < nb; b++) {
              if (dir === 'up') rect(sxs[0], tip + b * 12, sxs[sxs.length - 1] + 2, tip + b * 12 + 8, 0);
              else rect(sxs[0], tip - b * 12 - 8, sxs[sxs.length - 1] + 2, tip - b * 12, 0);
            }
          } else {
            drawHeads(u);
            if (u.type !== 'whole') {
              const dir = dirOf(u.ps), cys = u.ps.map(cyOf);
              const sx = dir === 'up' ? u.cx + rx - 1 : u.cx - rx + 1;
              const tip = dir === 'up' ? Math.min(...cys) - stemH : Math.max(...cys) + stemH;
              const from = dir === 'up' ? Math.max(...cys) : Math.min(...cys);
              rect(sx, Math.min(from, tip), sx + 2, Math.max(from, tip), 0);
              if (u.type === 'eighth' || u.type === 'sixteenth') {
                if (dir === 'up') seg(sx + 1, tip + 2, sx + 14, tip + 24, 2.5, 0);
                else seg(sx + 1, tip - 2, sx + 14, tip - 24, 2.5, 0);
              }
            }
          }
        }
      }
    }

    drawStaff(95, [
      [N('C4', 'quarter'), N('D4', 'quarter'), N('E4', 'quarter'), N('F4', 'quarter')],
      [N('G4', 'half'), N('A4', 'half')],
      [{ beam: [N('E5', 'eighth'), N('D5', 'eighth')] }, { beam: [N('C5', 'eighth'), N('B4', 'eighth')] }, N('A4', 'quarter'), N('G4', 'quarter')],
      [N('A4', 'quarter', true), N('G4', 'eighth'), N('E4', 'half')],
      [N('C5', 'whole')]
    ], false);
    drawStaff(270, [
      [N(['C4', 'E4', 'G4'], 'quarter'), N('F5', 'quarter'), { beam: [N('E5', 'sixteenth'), N('D5', 'sixteenth'), N('C5', 'sixteenth'), N('B4', 'sixteenth')] }, N('G4', 'quarter')],
      [N('A5', 'quarter'), N('G4', 'eighth'), N('F4', 'eighth'), N('E4', 'half')],
      [N('D4', 'whole')]
    ], true);

    // leggero antialiasing 3x3
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += g[yy * W + xx]; n++; }
      }
      out[y * W + x] = Math.round(s / n);
    }
    return { gray: out, width: W, height: H };
  }

  NL.sample = { makeSample };
  if (typeof module === 'object' && module.exports) module.exports = NL.sample;
})(typeof self !== 'undefined' ? self : this);
