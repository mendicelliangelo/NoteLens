/* NoteLens · viewer
   Componente di visualizzazione: disegna l'immagine e, sopra, righi, stanghette,
   note riconosciute e nota selezionata. Gestisce zoom e clic sulle note.
   Non conosce l'OCR né l'export: riceve un risultato (res) e le impostazioni (s).

   const v = NoteLens.createViewer({
     canvas, stage,                 // <canvas> e il contenitore scorrevole
     getSettings: () => s,          // impostazioni correnti (chiave, skipLeft, ...)
     onSelect: id => {},            // id della nota cliccata, o null
     onZoom: z => {}                // zoom cambiato (0.2 - 2.5)
   });
   v.showImage(gray, w, h)   mostra l'immagine mentre l'analisi è in corso
   v.setResult(res)          mostra il risultato di NoteLens.ocr.recognize
   v.redraw()                ridisegna (dopo una modifica alle note o alle impostazioni)
   v.select(id) / v.setPlaying(ids) / v.scrollToNote(note)
   v.setZoom(z) / v.fit(initial) / v.destroy()                                         */
(function (root) {
  'use strict';
  const NL = root.NoteLens = root.NoteLens || {};
  const music = NL.music || (typeof require === 'function' ? require('./music.js') : null);

  const COL_ACCENT = '#1D5FD1', COL_MARK = '#D9480F', COL_BAR = '#1B7F4B';

  function createViewer(opts) {
    const cv = opts.canvas, stage = opts.stage;
    const getSettings = opts.getSettings || (() => ({}));
    const onSelect = opts.onSelect || (() => {});
    const onZoom = opts.onZoom || (() => {});
    let res = null, base = null, zoom = 1, zoomTouched = false, sel = null, playIds = new Set();
    let imgW = 1;

    function paintBase(gray, W, H) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      const id = ctx.createImageData(W, H);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) { const v = gray[i]; id.data[j] = v; id.data[j + 1] = v; id.data[j + 2] = v; id.data[j + 3] = 255; }
      ctx.putImageData(id, 0, 0);
      base = c;
    }

    function showImage(gray, w, h) {
      res = null; sel = null; playIds = new Set(); zoomTouched = false;
      paintBase(gray, w, h);
      imgW = w;
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(base, 0, 0);
      fit(true);
    }

    function setResult(r) {
      res = r; sel = null; playIds = new Set();
      paintBase(r.gray, r.W, r.H);
      imgW = r.W;
      cv.width = r.W; cv.height = r.H;
      fit(true);
    }

    /* ---------- zoom ---------- */
    function fit(initial) {
      const avail = Math.max(200, stage.clientWidth - 2);
      const f = Math.min(1, avail / imgW);
      let z = f;
      if (initial && !zoomTouched && avail < 600) z = Math.max(f, 0.5);
      if (!initial) { zoomTouched = false; z = f; }
      setZoom(z, false);
    }
    function setZoom(z, touched) {
      z = Math.max(0.2, Math.min(2.5, z));
      zoom = z;
      if (touched) zoomTouched = true;
      cv.style.width = Math.round(cv.width * z) + 'px';
      cv.style.height = Math.round(cv.height * z) + 'px';
      onZoom(z);
      redraw();
    }

    /* ---------- disegno ---------- */
    function redraw() {
      if (!base) return;
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      if (!res) return;
      const z = zoom, s = getSettings();
      const lw = Math.max(1.4, 1.5 / z);
      const fs = Math.max(11, 12.5 / z);

      res.staves.forEach((st, i) => {
        // righi tracciati (seguono la curvatura della pagina)
        ctx.save();
        ctx.strokeStyle = 'rgba(29,95,209,0.35)'; ctx.lineWidth = Math.max(1, 1 / z);
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          for (let x = 0; x < st.lines[k].length; x += 6) { const X = st.x0 + x, Y = st.lines[k][x]; if (x === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
          ctx.stroke();
        }
        ctx.restore();
        // zona saltata (chiave, armatura, tempo)
        const sk = Math.max(0, (s.skipLeft || 0) * st.spD);
        if (sk > 0) {
          const ya = st.bandM - 3 * st.spD, yb = st.bandM + 7 * st.spD;
          const p = [st.mapBack(0, ya), st.mapBack(sk, ya), st.mapBack(sk, yb), st.mapBack(0, yb)];
          ctx.fillStyle = 'rgba(88,100,115,0.16)';
          ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let q = 1; q < 4; q++) ctx.lineTo(p[q][0], p[q][1]); ctx.closePath(); ctx.fill();
        }
        // stanghette
        ctx.save();
        ctx.setLineDash([4 / z + 2, 3 / z + 2]);
        ctx.strokeStyle = COL_BAR; ctx.lineWidth = lw; ctx.globalAlpha = 0.85;
        (st.barSegs || []).forEach(b => { ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[2], b[3]); ctx.stroke(); });
        ctx.restore();
        ctx.fillStyle = '#586473';
        ctx.font = '500 ' + fs + 'px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textBaseline = 'bottom';
        ctx.fillText('RIGO ' + (i + 1), st.x0 + 2, st.lines[0][0] - 1.1 * st.sp);
      });

      const vis = music.visibleNotes(res, s);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      for (const n of vis) {
        const st = res.staves[n.staff];
        const playing = playIds.has(n.id), isSel = sel === n.id;
        const pad = 0.12 * st.sp;
        const x = n.x0 - pad, y = n.y0 - pad, w = n.x1 - n.x0 + 1 + 2 * pad, h = n.y1 - n.y0 + 1 + 2 * pad;
        if (playing) { ctx.fillStyle = 'rgba(217,72,15,0.5)'; ctx.fillRect(x, y, w, h); }
        else if (isSel) { ctx.fillStyle = 'rgba(217,72,15,0.16)'; ctx.fillRect(x, y, w, h); }
        ctx.save();
        if (n.conf < 1) ctx.setLineDash([3 / z + 1.5, 2 / z + 1.5]);
        ctx.strokeStyle = (isSel || playing) ? COL_MARK : COL_ACCENT;
        ctx.lineWidth = isSel ? lw * 1.9 : lw;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
        const p = music.pitchInfo(n, s);
        ctx.font = '500 ' + fs + 'px "IBM Plex Mono", ui-monospace, monospace';
        const ty = y - 3 / z - 1;
        ctx.lineWidth = 3.2 / z + 1; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineJoin = 'round';
        ctx.strokeText(p.name, n.cx, ty);
        ctx.fillStyle = (isSel || playing) ? COL_MARK : COL_ACCENT;
        ctx.fillText(p.name, n.cx, ty);
      }
      ctx.textAlign = 'start';
    }

    /* ---------- selezione e scorrimento ---------- */
    function select(id) { sel = id; redraw(); }
    function setPlaying(ids) { playIds = new Set(ids || []); redraw(); }

    function scrollToNote(n) {
      if (!n) return;
      const x = n.cx * zoom, y = n.cy * zoom;
      if (x < stage.scrollLeft + 24 || x > stage.scrollLeft + stage.clientWidth - 24) stage.scrollLeft = Math.max(0, x - stage.clientWidth / 3);
      if (y < stage.scrollTop + 24 || y > stage.scrollTop + stage.clientHeight - 24) stage.scrollTop = Math.max(0, y - stage.clientHeight / 2);
    }

    function onClick(e) {
      if (!res) return;
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
      let best = null, bd = 1e9;
      for (const n of music.visibleNotes(res, getSettings())) {
        const sp = res.staves[n.staff].sp, m = 0.45 * sp;
        if (x < n.x0 - m || x > n.x1 + m || y < n.y0 - m || y > n.y1 + m) continue;
        const d = Math.hypot(x - n.cx, y - n.cy);
        if (d < bd) { bd = d; best = n; }
      }
      sel = best ? best.id : null;
      redraw();
      onSelect(sel);
    }
    cv.addEventListener('click', onClick);

    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (!zoomTouched) fit(true); }, 150); };
    window.addEventListener('resize', onResize);

    function destroy() {
      cv.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      clearTimeout(rt);
    }

    return {
      showImage, setResult, redraw, select, setPlaying, scrollToNote, destroy,
      setZoom: z => setZoom(z, true), fit,
      get zoom() { return zoom; }
    };
  }

  NL.createViewer = createViewer;
  if (typeof module === 'object' && module.exports) module.exports = createViewer;
})(typeof self !== 'undefined' ? self : this);
