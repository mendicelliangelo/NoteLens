/* NoteLens · music
   Funziona nel browser (window.NoteLens.music) e in Node (module.exports). */
(function (root) {
  'use strict';
  const NL = root.NoteLens = root.NoteLens || {};

  /* ------------------------------------------------------------------ */
  /* Costanti musicali                                                   */
  /* ------------------------------------------------------------------ */
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const SOLFEGE = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
  const SEMI = [0, 2, 4, 5, 7, 9, 11];
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
  const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
  const BEATS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25, thirtysecond: 0.125 };

  // diapason (indice diatonico) della linea più bassa del rigo
  const BASE_DIATONIC = { treble: 4 * 7 + 2, bass: 2 * 7 + 4, alto: 3 * 7 + 3, tenor: 3 * 7 + 1 }; // linea più bassa: E4, G2, F3, D3
  const clefOf = (s, staff) => (s.clefs && s.clefs[staff]) || s.clef || 'treble';

  function keyAlter(letterIdx, key) {
    if (key > 0) return SHARP_ORDER.slice(0, key).includes(letterIdx) ? 1 : 0;
    if (key < 0) return FLAT_ORDER.slice(0, -key).includes(letterIdx) ? -1 : 0;
    return 0;
  }

  function pitchInfo(note, s) {
    const d = BASE_DIATONIC[clefOf(s, note.staff)] + note.pos;
    const li = ((d % 7) + 7) % 7;
    const octave = Math.floor(d / 7);
    let alter = keyAlter(li, s.key || 0);
    if (note.acc === '#') alter = 1; else if (note.acc === 'b') alter = -1; else if (note.acc === 'n') alter = 0;
    const midi = 12 * (octave + 1) + SEMI[li] + alter;
    const sign = alter > 0 ? '♯' : alter < 0 ? '♭' : '';
    return { step: LETTERS[li], alter, octave, midi, name: SOLFEGE[li] + sign + octave, nameEn: LETTERS[li] + (alter > 0 ? '#' : alter < 0 ? 'b' : '') + octave };
  }

  function beatsOf(note) { return BEATS[note.type] * (note.dots ? 1.5 : 1); }

  function visibleNotes(res, s) {
    return res.notes.filter(n => {
      if (n.deleted) return false;
      const st = res.staves[n.staff];
      return n.dx >= (s.skipLeft || 0) * st.spD;
    });
  }

  function groupsOf(res, s) {
    const map = new Map();
    for (const n of visibleNotes(res, s)) {
      if (!map.has(n.gid)) map.set(n.gid, { gid: n.gid, staff: n.staff, x: n.dx, notes: [] });
      const g = map.get(n.gid);
      g.notes.push(n);
      if (n.dx < g.x) g.x = n.dx;
    }
    const arr = [...map.values()];
    for (const g of arr) {
      g.notes.sort((a, b) => b.pos - a.pos); // dal più basso (cy maggiore) al più acuto
      g.notes.reverse();
      g.type = g.notes[0].type; g.dots = g.notes[0].dots; g.beats = beatsOf(g.notes[0]);
    }
    arr.sort((a, b) => a.staff - b.staff || a.x - b.x);
    return arr;
  }

  function measuresOf(res, s) {
    const groups = groupsOf(res, s);
    const out = [];
    res.staves.forEach((st, si) => {
      const bars = (st.bars || []).slice().sort((a, b) => a - b);
      const map = new Map();
      for (const g of groups) {
        if (g.staff !== si) continue;
        let idx = 0;
        for (const b of bars) if (b < g.x) idx++;
        if (!map.has(idx)) map.set(idx, []);
        map.get(idx).push(g);
      }
      [...map.keys()].sort((a, b) => a - b).forEach(k => out.push({ staff: si, groups: map.get(k) }));
    });
    return out;
  }

  function buildSchedule(res, s) {
    let t = 0;
    return groupsOf(res, s).map(g => {
      const ev = { gid: g.gid, t, dur: g.beats, midis: g.notes.map(n => pitchInfo(n, s).midi), ids: g.notes.map(n => n.id) };
      t += g.beats;
      return ev;
    });
  }

  NL.music = { LETTERS, SOLFEGE, BEATS, BASE_DIATONIC, clefOf, keyAlter, pitchInfo, beatsOf, visibleNotes, groupsOf, measuresOf, buildSchedule };
  if (typeof module === 'object' && module.exports) module.exports = NL.music;
})(typeof self !== 'undefined' ? self : this);
