// Données de Klik : format d'échange JSON, validation, stockage local et migrations.
(function (K) {
  'use strict';

  const KEY = 'klik.data';
  const SCHEMA = 1;   // version du stockage local (migrations ci-dessous)
  const FORMAT = 1;   // version du JSON d'échange (champ "klik")
  const MIN_TEMPO = 30;
  const MAX_TEMPO = 300;

  // Un point = une subdivision de la mesure. stepsPerBeat = nombre de points par temps (BPM).
  const PRESETS = [
    { label: '2/4', steps: 8, stepsPerBeat: 4 },   // doubles-croches
    { label: '3/4', steps: 12, stepsPerBeat: 4 },  // doubles-croches
    { label: '4/4', steps: 8, stepsPerBeat: 2 },   // croches
    { label: '6/8', steps: 12, stepsPerBeat: 6 },  // doubles-croches, BPM à la noire pointée
  ];

  // Motif : un caractère par point. 'X' fort, 'x' moyen, '.' rien. Le point 0 est le temps 1.
  const LEVELS = { '.': 0, x: 1, X: 2 };
  const CHARS = ['.', 'x', 'X'];

  const uid = () => (self.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const clampTempo = v => Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, Math.round(v)));

  const presetFor = label => PRESETS.find(p => p.label === label) || null;
  function isPreset(sig) {
    const p = presetFor(sig.label);
    return !!p && p.steps === sig.steps && p.stepsPerBeat === sig.stepsPerBeat;
  }

  // Temps forts + croches, comme demandé à chaque changement de signature.
  function defaultPattern(sig) {
    const eighth = sig.stepsPerBeat >= 4 ? 2 : 1;
    let s = '';
    for (let i = 0; i < sig.steps; i++) {
      s += i % sig.stepsPerBeat === 0 ? 'X' : (i % eighth === 0 ? 'x' : '.');
    }
    return s;
  }
  const levels = pattern => [...pattern].map(c => LEVELS[c] || 0);
  const setLevel = (pattern, i, lvl) => pattern.slice(0, i) + CHARS[lvl] + pattern.slice(i + 1);

  /* ---------- validation du JSON ---------- */

  class FormatError extends Error {}
  function fail(msg) { throw new FormatError(msg); }

  function normSignature(raw) {
    if (typeof raw === 'string') {
      const p = presetFor(raw.trim());
      if (!p) fail(`Signature inconnue « ${raw} ». Utilise 2/4, 3/4, 4/4, 6/8 ou un objet { label, steps, stepsPerBeat }.`);
      return { ...p };
    }
    if (!raw || typeof raw !== 'object') fail('Signature manquante.');
    const steps = Number(raw.steps);
    const spb = Number(raw.stepsPerBeat);
    if (!Number.isInteger(steps) || steps < 2 || steps > 32) fail('« steps » doit être un entier entre 2 et 32.');
    if (!Number.isInteger(spb) || spb < 1 || spb > steps) fail('« stepsPerBeat » doit être un entier entre 1 et « steps ».');
    return { label: String(raw.label || `${steps}`).slice(0, 8), steps, stepsPerBeat: spb };
  }

  function normPattern(raw, sig) {
    if (raw == null) return defaultPattern(sig);
    if (typeof raw !== 'string' || !/^[Xx.]+$/.test(raw)) fail('« pattern » doit être une suite de X, x et . (par exemple "X.x.X.x.").');
    if (raw.length !== sig.steps) fail(`« pattern » doit faire ${sig.steps} caractères en ${sig.label} (il en fait ${raw.length}).`);
    return 'X' + raw.slice(1);
  }

  function normSong(raw, keepId) {
    if (!raw || typeof raw !== 'object') fail('Morceau invalide.');
    const tempo = Number(raw.tempo);
    if (!Number.isFinite(tempo)) fail('« tempo » manquant ou invalide.');
    const signature = normSignature(raw.signature == null ? '4/4' : raw.signature);
    const song = {
      id: keepId && raw.id ? String(raw.id) : uid(),
      name: String(raw.name == null ? '' : raw.name).trim().slice(0, 80) || 'Sans titre',
      tempo: clampTempo(tempo),
      signature,
      pattern: normPattern(raw.pattern, signature),
    };
    if (raw.countIn != null) {
      const n = Number(raw.countIn);
      if (!Number.isInteger(n) || n < 0 || n > 8) fail('« countIn » doit être un nombre de mesures entre 0 et 8.');
      song.countIn = n;
    }
    if (raw.duration != null && raw.duration !== '') {
      if (typeof raw.duration !== 'string' || !/^\d{1,3}:[0-5]\d$/.test(raw.duration)) fail('« duration » doit être au format "m:ss" (par exemple "3:45").');
      song.duration = raw.duration;
    }
    if (typeof raw.notes === 'string' && raw.notes.trim()) song.notes = raw.notes.trim().slice(0, 500);
    return song;
  }

  function normConcert(raw, keepId) {
    if (!raw || typeof raw !== 'object') fail('Concert invalide.');
    if (!Array.isArray(raw.songs)) fail('« songs » doit être une liste de morceaux.');
    return {
      id: keepId && raw.id ? String(raw.id) : uid(),
      name: String(raw.name == null ? '' : raw.name).trim().slice(0, 80) || 'Concert sans nom',
      songs: raw.songs.map((s, i) => {
        try { return normSong(s, keepId); } catch (e) {
          if (e instanceof FormatError) fail(`Morceau n°${i + 1} : ${e.message}`);
          throw e;
        }
      }),
    };
  }

  /* ---------- export / import ---------- */

  function exportSong(song, header = true) {
    const out = header ? { klik: FORMAT, type: 'song' } : {};
    out.name = song.name;
    out.tempo = song.tempo;
    out.signature = isPreset(song.signature) ? song.signature.label : { ...song.signature };
    out.pattern = song.pattern;
    for (const k of ['countIn', 'duration', 'notes']) if (song[k] != null) out[k] = song[k];
    return out;
  }
  const exportConcert = c => ({ klik: FORMAT, type: 'concert', name: c.name, songs: c.songs.map(s => exportSong(s, false)) });
  const stringify = obj => JSON.stringify(obj, null, 2);

  function parse(text) {
    let obj;
    try { obj = JSON.parse(String(text).trim()); } catch (e) { fail('Ce texte n’est pas du JSON valide.'); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('Le JSON doit être un objet Klik.');
    if (obj.klik == null) fail('Il manque le champ « klik » : ce JSON ne vient pas de Klik.');
    if (Number(obj.klik) > FORMAT) fail('Ce JSON vient d’une version plus récente de Klik. Mets l’app à jour.');
    if (obj.type === 'song') return { type: 'song', song: normSong(obj) };
    if (obj.type === 'concert') return { type: 'concert', concert: normConcert(obj) };
    fail('« type » doit valoir "song" ou "concert".');
  }

  /* ---------- stockage local ---------- */

  function demoConcert() {
    return normConcert({
      name: 'Démo · exemples de motifs',
      songs: [
        { name: 'Rock droit', tempo: 120, signature: '4/4', pattern: 'XxXxXxXx' },
        { name: 'Tresillo', tempo: 100, signature: '4/4', pattern: 'X..X..X.' },
        { name: 'Valse', tempo: 168, signature: '3/4', pattern: 'X...X...X...' },
        { name: 'Ballade 6/8', tempo: 52, signature: '6/8', pattern: 'X.x.x.X.x.x.' },
        { name: 'Shuffle boogie', tempo: 112, signature: { label: '12/8', steps: 12, stepsPerBeat: 3 }, pattern: 'X.xX.xX.xX.x' },
      ],
    });
  }

  function fresh() {
    const c = demoConcert();
    const s = c.songs[0];
    return {
      schema: SCHEMA,
      muted: false,
      current: { tempo: s.tempo, signature: { ...s.signature }, pattern: s.pattern, concertId: c.id, songId: s.id, dirty: false },
      concerts: [c],
    };
  }

  // Une entrée par version de schéma : migrations[n] transforme le schéma n en n + 1.
  const migrations = {};

  function migrate(d) {
    while (d.schema < SCHEMA) {
      const m = migrations[d.schema];
      if (!m) throw new Error('Migration manquante pour le schéma ' + d.schema);
      d = m(d);
    }
    return d;
  }

  function sanitize(d) {
    const concerts = [];
    for (const c of Array.isArray(d.concerts) ? d.concerts : []) {
      try { concerts.push(normConcert(c, true)); } catch (e) { console.warn('Concert ignoré', e); }
    }
    let current;
    try {
      const sig = normSignature(d.current.signature);
      current = {
        tempo: clampTempo(Number(d.current.tempo) || 120),
        signature: sig,
        pattern: normPattern(d.current.pattern, sig),
        concertId: d.current.concertId || null,
        songId: d.current.songId || null,
        dirty: !!d.current.dirty,
      };
    } catch (e) {
      const p = presetFor('4/4');
      current = { tempo: 120, signature: { ...p }, pattern: defaultPattern(p), concertId: null, songId: null, dirty: false };
    }
    return { schema: SCHEMA, muted: !!d.muted, current, concerts };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.schema > SCHEMA) {
          // Données écrites par une version plus récente : on les met de côté au lieu de les écraser.
          localStorage.setItem(KEY + '.newer-backup', raw);
          return fresh();
        }
        return sanitize(migrate(d));
      }
    } catch (e) { console.warn('Lecture des données impossible', e); }
    return fresh();
  }

  let saveTimer = null;
  let pending = null;
  function writeNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!pending) return;
    try { localStorage.setItem(KEY, JSON.stringify(pending)); } catch (e) { console.warn('Sauvegarde impossible', e); }
    pending = null;
  }
  function save(d) {
    pending = d;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 200);
  }
  addEventListener('pagehide', writeNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeNow(); });

  K.store = {
    PRESETS, MIN_TEMPO, MAX_TEMPO, FormatError,
    uid, clampTempo, isPreset, defaultPattern, levels, setLevel,
    normSong, exportSong, exportConcert, stringify, parse,
    load, save,
  };
})(self.Klik = self.Klik || {});
