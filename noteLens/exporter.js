/* NoteLens · exporter
   Esporta il risultato dell'OCR: MusicXML, MIDI, elenco dei nomi delle note.
   Non tocca il DOM, tranne download() e copyText(). */
(function (root) {
  'use strict';
  const NL = root.NoteLens = root.NoteLens || {};
  const music = NL.music || (typeof require === 'function' ? require('./music.js') : null);
  const { clefOf, pitchInfo, measuresOf, buildSchedule } = music;

  const XMLTYPE = { whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', sixteenth: '16th', thirtysecond: '32nd' };
  const CLEF_XML = { treble: '<sign>G</sign><line>2</line>', bass: '<sign>F</sign><line>4</line>', alto: '<sign>C</sign><line>3</line>', tenor: '<sign>C</sign><line>4</line>' };

  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function buildMusicXML(res, s) {
    const DIV = 8; // divisioni per semiminima
    const meas = measuresOf(res, s);
    let prevClef = null;
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!' + 'DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
      '<score-partwise version="3.1">\n' +
      '  <work><work-title>' + esc(s.title || 'Spartito riconosciuto') + '</work-title></work>\n' +
      '  <part-list><score-part id="P1"><part-name>Melodia</part-name></score-part></part-list>\n' +
      '  <part id="P1">\n';
    meas.forEach((m, i) => {
      xml += '    <measure number="' + (i + 1) + '">\n';
      const cl = clefOf(s, m.staff);
      if (i > 0 && cl !== prevClef) xml += '      <attributes><clef>' + CLEF_XML[cl] + '</clef></attributes>\n';
      prevClef = cl;
      if (i === 0) {
        xml += '      <attributes><divisions>' + DIV + '</divisions><key><fifths>' + (s.key || 0) + '</fifths></key>' +
          '<time><beats>' + (s.beatsNum || 4) + '</beats><beat-type>' + (s.beatsDen || 4) + '</beat-type></time>' +
          '<clef>' + CLEF_XML[cl] + '</clef></attributes>\n';
        xml += '      <direction placement="above"><direction-type><words>♩ = ' + (s.bpm || 90) + '</words></direction-type><sound tempo="' + (s.bpm || 90) + '"/></direction>\n';
      }
      for (const g of m.groups) {
        const dur = Math.round(g.beats * DIV);
        g.notes.forEach((n, k) => {
          const p = pitchInfo(n, s);
          xml += '      <note>' + (k ? '<chord/>' : '') + '<pitch><step>' + p.step + '</step>' +
            (p.alter ? '<alter>' + p.alter + '</alter>' : '') + '<octave>' + p.octave + '</octave></pitch>' +
            '<duration>' + dur + '</duration><type>' + XMLTYPE[g.type] + '</type>' + (g.dots ? '<dot/>' : '') + '</note>\n';
        });
      }
      xml += '    </measure>\n';
    });
    xml += '  </part>\n</score-partwise>\n';
    return xml;
  }

  // File MIDI standard (formato 0, una traccia): tempo, tempo in chiave, armatura e tutte le note.
  function buildMidi(res, s) {
    const PPQ = 480, sched = buildSchedule(res, s), ev = [];
    for (const e of sched) {
      const on = Math.round(e.t * PPQ);
      const off = Math.max(on + 1, Math.round((e.t + e.dur) * PPQ) - Math.round(PPQ * 0.03));
      for (const m of e.midis) {
        const n = Math.max(0, Math.min(127, m));
        ev.push({ t: on, o: 1, b: [0x90, n, 80] });
        ev.push({ t: off, o: 0, b: [0x80, n, 0] });
      }
    }
    ev.sort((a, b) => a.t - b.t || a.o - b.o);
    const vlq = v => { const out = [v & 0x7f]; while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80); return out; };
    const tr = [];
    const meta = (type, data) => tr.push(0, 0xff, type, ...vlq(data.length), ...data);
    const name = Array.from(new TextEncoder().encode(s.title || 'Spartito'));
    meta(0x03, name);
    const uspq = Math.round(60000000 / Math.max(20, Math.min(300, s.bpm || 90)));
    meta(0x51, [(uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255]);
    const den = s.beatsDen || 4;
    meta(0x58, [s.beatsNum || 4, Math.round(Math.log2(den)), 24, 8]);
    meta(0x59, [(s.key || 0) & 255, 0]);
    tr.push(0, 0xc0, 0); // strumento 1 (pianoforte)
    let last = 0;
    for (const e of ev) { tr.push(...vlq(e.t - last), ...e.b); last = e.t; }
    meta(0x2f, []);
    const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
    const len = tr.length;
    return new Uint8Array([...hdr, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...tr]);
  }

  function noteText(res, s) {
    const meas = measuresOf(res, s);
    const sym = { whole: '1', half: '1/2', quarter: '1/4', eighth: '1/8', sixteenth: '1/16', thirtysecond: '1/32' };
    return meas.map((m, i) => {
      const parts = m.groups.map(g => {
        const names = g.notes.map(n => pitchInfo(n, s).name).join('+');
        return names + ' ' + sym[g.type] + (g.dots ? '.' : '');
      });
      return 'Battuta ' + (i + 1) + ' (rigo ' + (m.staff + 1) + '):  ' + parts.join('   ');
    }).join('\n');
  }

  function crc32(u8) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < u8.length; n++) {
      c = (crc ^ u8[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  // ZIP senza compressione con un solo file (la pagina pubblicata non puo' salvare direttamente un .mid)
  function zipStore(name, data) {
    const nb = new TextEncoder().encode(name), crc = crc32(data), size = data.length;
    const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
    const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(nb.length), ...u16(0), ...nb];
    const central = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...nb];
    const cdOff = local.length + size;
    const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(central.length), ...u32(cdOff), ...u16(0)];
    const out = new Uint8Array(local.length + size + central.length + end.length);
    out.set(local, 0); out.set(data, local.length); out.set(central, local.length + size); out.set(end, local.length + size + central.length);
    return out;
  }

  /* ---- salvataggio ---- */
  function safeName(title) {
    return String(title || 'spartito').replace(/\.[^.]+$/, '').replace(/[^\w\- àèéìòù]+/gi, '').trim() || 'spartito';
  }

  // Scarica un file. Dentro l'host Claude usa il servizio 'downloads' (con ZIP),
  // altrimenti un normale download del browser. Ritorna { ok, message }.
  async function download(filename, bytes, mime) {
    let dl = null;
    try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) {
      try {
        await dl.save({ filename: filename + '.zip', data: zipStore(filename, bytes) });
        return { ok: true, message: 'Salvato. Apri lo ZIP: dentro c\'è il file ' + filename + '.' };
      } catch (e) {
        return { ok: false, message: e && e.code === 'declined' ? 'Salvataggio annullato.' : 'Qui non riesco a salvare il file. Apri la pagina come file locale per scaricarlo.' };
      }
    }
    try {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { ok: true, message: 'Scaricato ' + filename + ' (' + bytes.length + ' byte).' };
    } catch (e) { return { ok: false, message: 'Il browser ha bloccato il download.' }; }
  }

  // Scarica il MIDI della partitura. res = risultato di OCR, s = impostazioni (chiave, bpm, ...)
  function downloadMidi(res, s) {
    if (!music.visibleNotes(res, s).length) return Promise.resolve({ ok: false, message: 'Non ci sono note da esportare.' });
    return download(safeName(s.title) + '.mid', buildMidi(res, s), 'audio/midi');
  }
  function downloadMusicXML(res, s) {
    if (!music.visibleNotes(res, s).length) return Promise.resolve({ ok: false, message: 'Non ci sono note da esportare.' });
    return download(safeName(s.title) + '.musicxml', new TextEncoder().encode(buildMusicXML(res, s)), 'application/vnd.recordare.musicxml+xml');
  }

  async function copyText(txt, fallbackEl) {
    try { await navigator.clipboard.writeText(txt); return true; } catch (e) { /* ripiego sotto */ }
    if (!fallbackEl) return false;
    fallbackEl.focus(); fallbackEl.select();
    try { return document.execCommand('copy'); } catch (e) { return false; }
  }

  NL.exporter = { buildMusicXML, buildMidi, noteText, zipStore, download, downloadMidi, downloadMusicXML, copyText, safeName };
  if (typeof module === 'object' && module.exports) module.exports = NL.exporter;
})(typeof self !== 'undefined' ? self : this);
