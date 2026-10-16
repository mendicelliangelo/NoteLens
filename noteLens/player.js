/* NoteLens · player
   Riproduzione con Web Audio. Non tocca il DOM: notifica con callback.

   const p = NoteLens.createPlayer({
     onStep: (ids, index, total) => {},   // gruppo di note in riproduzione (ids vuoto = pausa)
     onEnd: () => {}                       // fine naturale della riproduzione
   });
   p.start(res, s) -> { ok, message }      p.stop()      p.playing                          */
(function (root) {
  'use strict';
  const NL = root.NoteLens = root.NoteLens || {};
  const music = NL.music || (typeof require === 'function' ? require('./music.js') : null);

  function createPlayer(opts) {
    const onStep = opts.onStep || (() => {});
    const onEnd = opts.onEnd || (() => {});
    let actx = null, nodes = [], raf = 0, playing = false;

    function stop() {
      nodes.forEach(o => { try { o.stop(); } catch (e) { /* già fermato */ } });
      nodes = [];
      cancelAnimationFrame(raf);
      playing = false;
    }

    function start(res, s) {
      const sched = music.buildSchedule(res, s);
      if (!sched.length) return { ok: false, message: 'Non ci sono note da riprodurre.' };
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return { ok: false, message: 'Questo browser non supporta l\'audio Web.' };
      actx = actx || new AC();
      if (actx.state === 'suspended') actx.resume();
      const spb = 60 / s.bpm, t0 = actx.currentTime + 0.1;
      const total = sched[sched.length - 1].t + sched[sched.length - 1].dur;
      sched.forEach(ev => {
        const st = t0 + ev.t * spb, dur = ev.dur * spb;
        const vol = 0.22 / Math.sqrt(ev.midis.length);
        ev.midis.forEach(mi => {
          const o = actx.createOscillator(), g = actx.createGain();
          o.type = 'triangle';
          o.frequency.value = 440 * Math.pow(2, (mi - 69) / 12);
          g.gain.setValueAtTime(0.0001, st);
          g.gain.linearRampToValueAtTime(vol, st + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0008, st + Math.max(0.06, dur * 0.96));
          o.connect(g); g.connect(actx.destination);
          o.start(st); o.stop(st + dur + 0.05);
          nodes.push(o);
        });
      });
      playing = true;
      let last = -1;
      const tick = () => {
        if (!playing) return;
        const now = (actx.currentTime - t0) / spb;
        if (now >= total) { stop(); onEnd(); return; }
        let idx = -1;
        for (let i = 0; i < sched.length; i++) if (now >= sched[i].t && now < sched[i].t + sched[i].dur) { idx = i; break; }
        if (idx !== last) { last = idx; onStep(idx >= 0 ? sched[idx].ids : [], idx, sched.length); }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return { ok: true };
    }

    return { start, stop, get playing() { return playing; } };
  }

  NL.createPlayer = createPlayer;
  if (typeof module === 'object' && module.exports) module.exports = createPlayer;
})(typeof self !== 'undefined' ? self : this);
