// Moteur audio : planification Web Audio avec anticipation, pour un tempo stable
// même si l'affichage ralentit. L'interface lit les coups joués via drain().
(function (K) {
  'use strict';

  // niveau → [fréquence Hz, volume, durée s]. 3 = temps 1 (grave), 2 = fort, 1 = moyen.
  // Son de bloc de bois : sinus filtré, attaque de 3 ms, légère chute de hauteur.
  const TONES = {
    3: [740, 0.75, 0.12],
    2: [1180, 0.45, 0.07],
    1: [1180, 0.18, 0.05],
  };
  const LOOKAHEAD = 0.12;

  let ctx = null;
  let timer = null;
  let nextTime = 0;
  let step = 0;
  let queue = [];
  let read = null;

  function blip(time, lvl) {
    const [freq, vol, len] = TONES[lvl];
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 1.25, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.012);
    filter.type = 'lowpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(vol, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + len);
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + len + 0.01);
  }

  function tick() {
    const s = read();
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      const i = step % s.steps;
      const lvl = i === 0 ? 3 : s.levels[i];
      if (lvl && !s.muted) blip(nextTime, lvl);
      queue.push({ time: nextTime, step: i, lvl });
      nextTime += 60 / s.tempo / s.stepsPerBeat;
      step = i + 1;
    }
  }

  K.engine = {
    async start(readState) {
      read = readState;
      if (!ctx) ctx = new (self.AudioContext || self.webkitAudioContext)();
      if (ctx.state !== 'running') await ctx.resume();
      step = 0;
      queue = [];
      nextTime = ctx.currentTime + 0.06;
      tick();
      timer = setInterval(tick, 25);
    },
    stop() {
      clearInterval(timer);
      timer = null;
      queue = [];
    },
    // Repart du temps 1 au prochain coup planifié (changement de morceau ou de signature).
    resetBar() { step = 0; },
    drain() {
      const out = [];
      if (!ctx) return out;
      const now = ctx.currentTime;
      while (queue.length && queue[0].time <= now) out.push(queue.shift());
      return out;
    },
  };
})(self.Klik = self.Klik || {});
