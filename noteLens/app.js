/* NoteLens · app
   Pagina demo: collega i componenti (ocr, viewer, player, exporter) ai controlli HTML.
   Tutta la logica di riconoscimento sta in ocr.js, il disegno in viewer.js,
   l'export in exporter.js: qui c'è solo la colla con l'interfaccia. */
(function () {
  'use strict';
  const { music, ocr, sample, exporter, createViewer, createPlayer } = NoteLens;
  const $ = id => document.getElementById(id);
  const el = {
    file: $('file'), btnPick: $('btnPick'), btnSample: $('btnSample'), srcInfo: $('srcInfo'),
    clef: $('clef'), staffClefs: $('staffClefs'), key: $('key'), meter: $('meter'), bpm: $('bpm'), bpmOut: $('bpmOut'),
    skip: $('skip'), skipOut: $('skipOut'), thr: $('thr'), thrOut: $('thrOut'), deskew: $('deskew'),
    zoom: $('zoom'), zoomOut: $('zoomOut'), fit: $('fit'), stage: $('stage'), cv: $('cv'), drop: $('drop'),
    status: $('status'), summary: $('summary'), restore: $('restore'), list: $('list'),
    editor: $('editor'), edName: $('edName'), edMeta: $('edMeta'), edType: $('edType'), edDot: $('edDot'),
    edUp: $('edUp'), edDown: $('edDown'), edDel: $('edDel'), edAcc: $('edAcc'),
    play: $('play'), playInfo: $('playInfo'),
    dlMidi: $('dlMidi'), midiInfo: $('midiInfo'),
    tabXml: $('tabXml'), tabNames: $('tabNames'), out: $('out'), copy: $('copy')
  };
  const TYPES = [['whole', 'Semibreve (1)'], ['half', 'Minima (1/2)'], ['quarter', 'Semiminima (1/4)'],
    ['eighth', 'Croma (1/8)'], ['sixteenth', 'Semicroma (1/16)'], ['thirtysecond', 'Biscroma (1/32)']];
  const FRAC = { whole: '1', half: '1/2', quarter: '1/4', eighth: '1/8', sixteenth: '1/16', thirtysecond: '1/32' };
  const KEYS = [
    [-7, '7♭ · Do♭ magg.'], [-6, '6♭ · Sol♭ magg.'], [-5, '5♭ · Re♭ magg.'], [-4, '4♭ · La♭ magg.'],
    [-3, '3♭ · Mi♭ magg.'], [-2, '2♭ · Si♭ magg.'], [-1, '1♭ · Fa magg.'], [0, 'Nessuna · Do magg. / La min.'],
    [1, '1♯ · Sol magg.'], [2, '2♯ · Re magg.'], [3, '3♯ · La magg.'], [4, '4♯ · Mi magg.'],
    [5, '5♯ · Si magg.'], [6, '6♯ · Fa♯ magg.'], [7, '7♯ · Do♯ magg.']
  ];

  const state = {
    src: null,            // { gray, w, h }
    title: '',
    isSample: false,
    skipTouched: false,
    res: null,
    sel: null,
    tab: 'xml',
    playIds: new Set(),
    clefs: [],
    runToken: 0
  };

  /* ---------- componenti ---------- */
  const viewer = createViewer({
    canvas: el.cv, stage: el.stage,
    getSettings: () => S(),
    onSelect: id => { state.sel = id; updateChipStates(); renderEditor(S()); if (id != null) scrollChip(id); },
    onZoom: z => { el.zoom.value = Math.round(z * 100); syncOutputs(); }
  });
  const player = createPlayer({
    onStep: (ids, idx, total) => {
      viewer.setPlaying(ids); state.playIds = new Set(ids); updateChipStates();
      if (ids.length) viewer.scrollToNote(state.res.notes[ids[0]]);
      el.playInfo.textContent = ids.length ? 'Nota ' + (idx + 1) + ' di ' + total : '';
    },
    onEnd: () => { stopPlay(); el.playInfo.textContent = 'Riproduzione terminata.'; }
  });

  /* ---------- impostazioni ---------- */
  KEYS.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === 0) o.selected = true; el.key.appendChild(o); });
  TYPES.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; el.edType.appendChild(o); });

  function S() {
    const m = el.meter.value.split('/');
    return { clef: el.clef.value, clefs: state.clefs, key: +el.key.value, bpm: +el.bpm.value, skipLeft: +el.skip.value,
      beatsNum: +m[0], beatsDen: +m[1], title: state.title || 'Spartito riconosciuto' };
  }
  const fmt1 = v => String(Math.round(v * 100) / 100).replace('.', ',');

  function syncOutputs() {
    el.bpmOut.textContent = el.bpm.value + ' bpm';
    el.skipOut.textContent = fmt1(+el.skip.value) + ' spazi';
    el.thrOut.textContent = fmt1(+el.thr.value);
    el.zoomOut.textContent = Math.round(+el.zoom.value) + '%';
  }

  function autoSkip() {
    if (state.skipTouched || state.isSample) return;
    el.skip.value = Math.min(14, 6.2 + 1.3 * Math.abs(+el.key.value));
    syncOutputs();
  }

  /* ---------- immagine ---------- */
  function setStatus(msg, kind) {
    el.status.textContent = msg;
    el.status.dataset.kind = kind || '';
  }

  function setSource(gray, w, h, name, isSample) {
    stopPlay();
    state.src = { gray, w, h };
    state.title = name;
    state.isSample = !!isSample;
    state.sel = null;
    state.clefs = [];
    if (isSample) { el.skip.value = 1; state.skipTouched = false; }
    else if (!state.skipTouched) autoSkip();
    el.srcInfo.textContent = name + ' · ' + w + ' × ' + h + ' px';
    viewer.showImage(gray, w, h);   // mostra subito l'immagine mentre l'analisi è in corso
    run();
  }

  function loadSample() {
    const s = sample.makeSample();
    el.clef.value = 'treble'; el.key.value = 0;
    setSource(s.gray, s.width, s.height, 'Spartito di esempio', true);
  }

  async function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) { setStatus('Questo file non è un\'immagine. Usa JPG, PNG, WebP o simili.', 'warn'); return; }
    setStatus('Caricamento dell\'immagine…');
    try {
      const img = await ocr.imageToGray(file);
      setSource(img.gray, img.w, img.h, file.name || 'Immagine caricata', false);
    } catch (e) {
      setStatus('Non riesco ad aprire questa immagine. Prova con un altro formato (JPG o PNG).', 'warn');
    }
  }

  /* ---------- riconoscimento ---------- */
  function run() {
    if (!state.src) return;
    const token = ++state.runToken;
    setStatus('Analisi in corso…', 'busy');
    setTimeout(() => {
      if (token !== state.runToken) return;
      try {
        const t0 = performance.now();
        state.res = ocr.recognize(state.src.gray, state.src.w, state.src.h, {
          threshold: +el.thr.value, deskew: el.deskew.checked
        });
        state.res.ms = Math.round(performance.now() - t0);
        state.sel = null;
        el.staffClefs.dataset.n = '';
        viewer.setResult(state.res);
        refresh();
      } catch (e) {
        console.error(e);
        setStatus('L\'analisi non è riuscita su questa immagine.', 'warn');
      }
    }, 30);
  }

  /* ---------- lista, editor, export ---------- */
  function refresh() {
    const res = state.res;
    if (!res) return;
    const s = S();
    viewer.select(state.sel);   // ridisegna con la selezione corrente
    if (!el.staffClefs.dataset.n || +el.staffClefs.dataset.n !== res.staves.length) { renderStaffClefs(); el.staffClefs.dataset.n = res.staves.length; }
    renderList(s);
    renderEditor(s);
    renderExport(s);
    const vis = music.visibleNotes(res, s);
    const meas = music.measuresOf(res, s);
    const deleted = res.notes.filter(n => n.deleted).length;
    el.restore.hidden = !deleted;
    el.restore.textContent = 'Ripristina ' + deleted + (deleted === 1 ? ' nota eliminata' : ' note eliminate');
    if (!res.staves.length) {
      setStatus(res.warnings[0] || 'Nessun rigo trovato.', 'warn');
      el.summary.textContent = '';
      return;
    }
    const tilt = Math.abs(res.angle * 180 / Math.PI);
    const low = vis.filter(n => n.conf < 1).length;
    el.summary.textContent = res.staves.length + (res.staves.length === 1 ? ' rigo' : ' righi') + ' · ' + vis.length + (vis.length === 1 ? ' nota' : ' note') + ' · ' + meas.length + (meas.length === 1 ? ' battuta' : ' battute');
    let msg = 'Analisi completata in ' + res.ms + ' ms.';
    if (tilt >= 0.1) msg += ' Immagine raddrizzata di ' + fmt1(tilt) + '°.';
    if (low) msg += ' ' + low + (low === 1 ? ' nota incerta (riquadro tratteggiato)' : ' note incerte (riquadri tratteggiati)') + ': controllale.';
    setStatus(msg, low ? 'warn' : 'ok');
  }
  const CLEF_OPTS = [['', 'Come sopra'], ['treble', 'Sol'], ['bass', 'Fa'], ['alto', 'Do contralto'], ['tenor', 'Do tenore']];
  function renderStaffClefs() {
    const n = state.res ? state.res.staves.length : 0;
    if (state.clefs.length !== n) state.clefs = new Array(n).fill('');
    el.staffClefs.textContent = '';
    el.staffClefs.hidden = n < 2;
    if (n < 2) return;
    state.res.staves.forEach((st, i) => {
      const box = document.createElement('div'); box.className = 'field';
      const lab = document.createElement('label'); lab.className = 'lab'; lab.htmlFor = 'sc' + i; lab.textContent = 'Chiave del rigo ' + (i + 1);
      const sel = document.createElement('select'); sel.id = 'sc' + i;
      CLEF_OPTS.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
      sel.value = state.clefs[i] || '';
      sel.addEventListener('change', () => { state.clefs[i] = sel.value; refresh(); });
      box.append(lab, sel); el.staffClefs.appendChild(box);
    });
  }

  function renderList(s) {
    const res = state.res;
    el.list.textContent = '';
    const meas = music.measuresOf(res, s);
    if (!meas.length) {
      const p = document.createElement('p'); p.className = 'empty';
      p.textContent = 'Nessuna nota riconosciuta. Prova a ridurre «Salta a sinistra» o a cambiare la sensibilità.';
      el.list.appendChild(p); return;
    }
    meas.forEach((m, i) => {
      const box = document.createElement('div'); box.className = 'measure';
      const no = document.createElement('span'); no.className = 'mno'; no.textContent = i + 1; no.title = 'Battuta ' + (i + 1) + ', rigo ' + (m.staff + 1);
      box.appendChild(no);
      m.groups.forEach(g => g.notes.forEach(n => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (n.conf < 1 ? ' low' : '');
        b.dataset.id = n.id;
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = music.pitchInfo(n, s).name;
        const du = document.createElement('span'); du.className = 'du'; du.textContent = FRAC[n.type] + (n.dots ? '.' : '');
        b.append(nm, du);
        b.addEventListener('click', () => select(n.id, true));
        box.appendChild(b);
      }));
      el.list.appendChild(box);
    });
    updateChipStates();
  }

  function updateChipStates() {
    el.list.querySelectorAll('.chip').forEach(b => {
      const id = +b.dataset.id;
      b.setAttribute('aria-pressed', state.sel === id ? 'true' : 'false');
      b.classList.toggle('playing', state.playIds.has(id));
    });
  }

  function select(id, scroll) {
    state.sel = (state.sel === id) ? null : id;
    viewer.select(state.sel); updateChipStates(); renderEditor(S());
    if (scroll && state.sel != null) viewer.scrollToNote(state.res.notes[id]);
  }

  function scrollChip(id) {
    const chip = el.list.querySelector('.chip[data-id="' + id + '"]');
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderEditor(s) {
    const n = state.sel == null ? null : state.res.notes[state.sel];
    if (!n || n.deleted) { el.editor.hidden = true; return; }
    el.editor.hidden = false;
    const p = music.pitchInfo(n, s);
    el.edName.textContent = p.name;
    const m = music.measuresOf(state.res, s);
    let mi = 0;
    m.forEach((mm, i) => { if (mm.groups.some(g => g.gid === n.gid)) mi = i + 1; });
    el.edMeta.textContent = 'rigo ' + (n.staff + 1) + ' · battuta ' + mi + ' · ' + FRAC[n.type] + (n.dots ? ' puntata' : '');
    el.edType.value = n.type;
    el.edDot.checked = !!n.dots;
    el.edAcc.querySelectorAll('button').forEach(b => {
      const v = b.dataset.acc === 'auto' ? null : b.dataset.acc;
      b.setAttribute('aria-pressed', (n.acc === v) ? 'true' : 'false');
    });
  }

  function renderExport(s) {
    const res = state.res;
    el.tabXml.setAttribute('aria-selected', state.tab === 'xml' ? 'true' : 'false');
    el.tabNames.setAttribute('aria-selected', state.tab === 'names' ? 'true' : 'false');
    el.out.value = state.tab === 'xml' ? exporter.buildMusicXML(res, s) : exporter.noteText(res, s);
  }

  const selNote = () => state.sel == null ? null : state.res.notes[state.sel];
  function groupOf(n) { return state.res.notes.filter(m => m.gid === n.gid); }

  el.edType.addEventListener('change', () => { const n = selNote(); if (!n) return; groupOf(n).forEach(m => { m.type = el.edType.value; }); refresh(); });
  el.edDot.addEventListener('change', () => { const n = selNote(); if (!n) return; groupOf(n).forEach(m => { m.dots = el.edDot.checked ? 1 : 0; }); refresh(); });
  el.edUp.addEventListener('click', () => { const n = selNote(); if (n) { n.pos += 1; refresh(); } });
  el.edDown.addEventListener('click', () => { const n = selNote(); if (n) { n.pos -= 1; refresh(); } });
  el.edDel.addEventListener('click', () => { const n = selNote(); if (n) { n.deleted = true; state.sel = null; refresh(); } });
  el.edAcc.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const n = selNote(); if (!n) return;
    n.acc = b.dataset.acc === 'auto' ? null : b.dataset.acc;
    refresh();
  });
  el.restore.addEventListener('click', () => { state.res.notes.forEach(n => { n.deleted = false; }); refresh(); });

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const n = selNote(); if (!n || !state.res) return;
    if (e.key === 'ArrowUp') { n.pos += 1; refresh(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { n.pos -= 1; refresh(); e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { n.deleted = true; state.sel = null; refresh(); e.preventDefault(); }
  });


  /* ---------- riproduzione ---------- */
  function stopPlay() {
    const was = player.playing;
    player.stop();
    state.playIds = new Set();
    el.play.textContent = 'Ascolta';
    el.play.setAttribute('aria-pressed', 'false');
    if (was && state.res) { viewer.setPlaying([]); updateChipStates(); }
  }
  function startPlay() {
    if (!state.res) return;
    const r = player.start(state.res, S());
    if (!r.ok) { el.playInfo.textContent = r.message; return; }
    el.play.textContent = 'Ferma';
    el.play.setAttribute('aria-pressed', 'true');
  }
  el.play.addEventListener('click', () => { if (player.playing) { stopPlay(); el.playInfo.textContent = ''; } else startPlay(); });

  /* ---------- export ---------- */
  el.tabXml.addEventListener('click', () => { state.tab = 'xml'; if (state.res) renderExport(S()); });
  el.tabNames.addEventListener('click', () => { state.tab = 'names'; if (state.res) renderExport(S()); });
  el.copy.addEventListener('click', async () => {
    const ok = await exporter.copyText(el.out.value, el.out);
    el.copy.textContent = ok ? 'Copiato' : 'Seleziona e copia a mano';
    setTimeout(() => { el.copy.textContent = 'Copia il testo'; }, 1800);
  });
  el.dlMidi.addEventListener('click', async () => {
    if (!state.res) return;
    const r = await exporter.downloadMidi(state.res, S());
    el.midiInfo.textContent = r.message;
  });

  /* ---------- eventi dei controlli ---------- */
  el.btnPick.addEventListener('click', () => el.file.click());
  el.btnSample.addEventListener('click', loadSample);
  el.file.addEventListener('change', () => { if (el.file.files[0]) loadFile(el.file.files[0]); el.file.value = ''; });

  ['dragenter', 'dragover'].forEach(ev => el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.remove('over'); }));
  el.drop.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });

  const soft = () => { if (state.res) { syncOutputs(); refresh(); } else syncOutputs(); };
  el.clef.addEventListener('change', soft);
  el.key.addEventListener('change', () => { autoSkip(); soft(); });
  el.meter.addEventListener('change', soft);
  el.bpm.addEventListener('input', syncOutputs);
  el.skip.addEventListener('input', () => { state.skipTouched = true; soft(); });
  el.thr.addEventListener('input', syncOutputs);
  el.thr.addEventListener('change', run);
  el.deskew.addEventListener('change', run);
  el.zoom.addEventListener('input', () => viewer.setZoom(+el.zoom.value / 100));
  el.fit.addEventListener('click', () => viewer.fit(false));

  syncOutputs();
  loadSample();
})();
