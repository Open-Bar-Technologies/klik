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
  let lastAudioTime = 0;   // surveillance : l'horloge audio avance-t-elle encore ?
  let lastWallTime = 0;
  let waking = false;

  // Safari iOS : le contexte audio peut être interrompu (notification, appel, Siri, verrouillage, autre
  // app, casque Bluetooth…) ou devenir muet sans prévenir ; changer d'onglet le réparait. On crée donc un
  // contexte neuf à chaque lancement et on le reconstruit si l'horloge audio s'arrête pendant la lecture.
  function newContext() {
    // Catégorie « lecture » (Safari 17+) : le son passe même avec le bouton silencieux de l'iPhone,
    // et iOS ne coupe plus le métronome comme un simple son d'interface.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* facultatif */ }
    const c = new (self.AudioContext || self.webkitAudioContext)({ latencyHint: 'interactive' });
    // Interrompu ou suspendu pendant la lecture : on tente de repartir dès que possible.
    c.onstatechange = () => { if (timer && c === ctx && c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {}); };
    return c;
  }

  async function freshContext() {
    if (ctx) ctx.close().catch(() => {});
    ctx = newContext();
    if (ctx.state !== 'running') await ctx.resume();
    // Un son vide joué tout de suite « déverrouille » la sortie audio sur iOS.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start();
    lastAudioTime = ctx.currentTime;
    lastWallTime = performance.now();
  }

  // Vrai si le contexte ne joue plus : état autre que « running », ou horloge figée depuis 400 ms.
  function stalled() {
    if (!ctx || ctx.state !== 'running') return true;
    const now = performance.now();
    if (ctx.currentTime !== lastAudioTime) { lastAudioTime = ctx.currentTime; lastWallTime = now; return false; }
    return now - lastWallTime > 400;
  }

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
    if (stalled()) { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); return; }
    const s = read();
    // Retard accumulé (onglet en arrière-plan, contexte qui repart) : on recale au lieu de jouer
    // d'un coup tous les clics en retard.
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.03;
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
      await freshContext();
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
    // À appeler sur un toucher (geste de l'utilisateur, exigé par iOS) ou au retour sur la page :
    // si le son s'est arrêté pendant la lecture, on reconstruit le contexte sans perdre la mesure.
    async wake(gesture) {
      if (!timer || waking || !stalled()) return;
      if (!gesture) { if (ctx && ctx.state !== 'closed') ctx.resume().catch(() => {}); return; }
      waking = true;
      try {
        await freshContext();
        queue = [];
        nextTime = ctx.currentTime + 0.06;
      } catch (e) { /* on réessaiera au prochain toucher */ } finally { waking = false; }
    },
    // Repart du temps 1 au prochain coup planifié (changement de morceau ou de signature).
    resetBar() { step = 0; },
    drain() {
      const out = [];
      if (!ctx) return out;
      // Le son sort du haut-parleur avec un retard (tampon audio, Bluetooth) :
      // on retarde d'autant le flash pour qu'il tombe en même temps que le clic entendu.
      const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      const now = ctx.currentTime - latency;
      while (queue.length && queue[0].time <= now) out.push(queue.shift());
      return out;
    },
  };
})(self.Klik = self.Klik || {});
