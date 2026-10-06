// Données de Klik : format d'échange JSON, validation, stockage local et migrations.
(function (K) {
  'use strict';

  const t = K.i18n.t;

  const KEY = 'klik.data';
  const SCHEMA = 3;   // version du stockage local (migrations ci-dessous)
  const FORMAT = 2;   // version du JSON d'échange (champ "klik")
  const MIN_TEMPO = 30;
  const MAX_TEMPO = 300;

  // Un point = une subdivision de la mesure. stepsPerBeat = nombre de points par temps (BPM).
  const PRESETS = [
    { label: '2/4', steps: 8, stepsPerBeat: 4 },   // doubles-croches
    { label: '3/4', steps: 12, stepsPerBeat: 4 },  // doubles-croches
    { label: '4/4', steps: 16, stepsPerBeat: 4 },  // doubles-croches
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

  // Motif minimal : les temps de la mesure (2 en 2/4, 3 en 3/4, 4 en 4/4).
  // En mesure composée (6/8), on compte les croches : 6, dont 2 temps forts.
  function defaultPattern(sig) {
    const spb = sig.stepsPerBeat;
    const pulse = spb > 3 && spb % 3 === 0 ? spb / 3 : spb;
    let s = '';
    for (let i = 0; i < sig.steps; i++) {
      s += i % spb === 0 ? 'X' : (i % pulse === 0 ? 'x' : '.');
    }
    return s;
  }
  const levels = pattern => [...pattern].map(c => LEVELS[c] || 0);
  const setLevel = (pattern, i, lvl) => pattern.slice(0, i) + CHARS[lvl] + pattern.slice(i + 1);

  /* ---------- validation du JSON ---------- */

  class FormatError extends Error {}
  function fail(msg) { throw new FormatError(msg); }

  // Signature écrite « N/D » hors des 4 prédéfinies (12/8, 5/4, 7/8…) : le nombre de temps
  // vient de N (en mesure composée, N/3 temps), le nombre de points vient du motif.
  function signatureFromText(label, steps) {
    const m = /^(\d{1,2})\/(2|4|8|16)$/.exec(label);
    if (!m) return null;
    const n = Number(m[1]);
    const d = Number(m[2]);
    const compound = d === 8 && n > 3 && n % 3 === 0;
    const beats = compound ? n / 3 : n;
    if (steps == null) steps = beats * (compound ? 3 : d === 8 ? 2 : d === 16 ? 1 : 4);
    if (steps % beats !== 0) fail(t('errSignatureSteps', { label, beats, length: steps }));
    if (steps < 2 || steps > 32) fail(t('errSteps'));
    return { label, steps, stepsPerBeat: steps / beats };
  }

  function normSignature(raw, pattern) {
    if (typeof raw === 'string') {
      const label = raw.trim();
      const p = presetFor(label);
      if (p) return { ...p };
      const sig = signatureFromText(label, typeof pattern === 'string' && pattern ? pattern.length : null);
      if (!sig) fail(t('errUnknownSignature', { sig: raw }));
      return sig;
    }
    if (!raw || typeof raw !== 'object') fail(t('errSignatureMissing'));
    const steps = Number(raw.steps);
    const spb = Number(raw.stepsPerBeat);
    if (!Number.isInteger(steps) || steps < 2 || steps > 32) fail(t('errSteps'));
    if (!Number.isInteger(spb) || spb < 1 || spb > steps) fail(t('errStepsPerBeat'));
    return { label: String(raw.label || `${steps}`).slice(0, 8), steps, stepsPerBeat: spb };
  }

  function normPattern(raw, sig) {
    if (raw == null) return defaultPattern(sig);
    if (typeof raw !== 'string' || !/^[Xx.]+$/.test(raw)) fail(t('errPatternChars'));
    if (raw.length !== sig.steps) fail(t('errPatternLength', { steps: sig.steps, label: sig.label, length: raw.length }));
    return 'X' + raw.slice(1);
  }

  // Signature absente : on la déduit de la longueur du motif.
  // 8 → 2/4, 16 → 4/4, 12 → 6/8 si le point 7 (milieu) est fort et que les points 5 et 9
  // (temps 2 et 3 du 3/4) ne le sont pas, sinon 3/4. Sans motif : 4/4.
  function guessSignature(pattern) {
    if (typeof pattern !== 'string') return '4/4';
    if (pattern.length === 8) return '2/4';
    if (pattern.length === 16) return '4/4';
    if (pattern.length === 12) return pattern[6] === 'X' && pattern[4] !== 'X' && pattern[8] !== 'X' ? '6/8' : '3/4';
    fail(t('errGuessSignature', { length: pattern.length }));
  }

  function normSong(raw, keepId) {
    if (!raw || typeof raw !== 'object') fail(t('errSong'));
    const tempo = Number(raw.tempo);
    if (!Number.isFinite(tempo)) fail(t('errTempo'));
    const signature = normSignature(raw.signature == null ? guessSignature(raw.pattern) : raw.signature, raw.pattern);
    const song = {
      id: keepId && raw.id ? String(raw.id) : uid(),
      name: String(raw.name == null ? '' : raw.name).trim().slice(0, 80) || t('untitledSong'),
      tempo: clampTempo(tempo),
      signature,
      pattern: normPattern(raw.pattern, signature),
    };
    if (raw.countIn != null) {
      const n = Number(raw.countIn);
      if (!Number.isInteger(n) || n < 0 || n > 8) fail(t('errCountIn'));
      song.countIn = n;
    }
    if (raw.duration != null && raw.duration !== '') song.duration = normDuration(raw.duration);
    if (typeof raw.notes === 'string' && raw.notes.trim()) song.notes = raw.notes.trim().slice(0, 500);
    for (const k of ['artist', 'section', 'key']) {
      if (typeof raw[k] === 'string' && raw[k].trim()) song[k] = raw[k].trim().slice(0, 80);
    }
    // Champs inconnus (ex. « chant ») : conservés tels quels et réexportés, sans être affichés.
    const extra = {};
    const keep = (k, v) => { if (!KNOWN.has(k) && ['string', 'number', 'boolean'].includes(typeof v)) extra[k] = v; };
    if (raw.extra && typeof raw.extra === 'object') Object.entries(raw.extra).forEach(([k, v]) => keep(k, v));
    Object.entries(raw).forEach(([k, v]) => keep(k, v));
    if (Object.keys(extra).length) song.extra = extra;
    return song;
  }

  const KNOWN = new Set(['id', 'klik', 'type', 'name', 'tempo', 'signature', 'pattern', 'countIn', 'duration', 'notes', 'artist', 'section', 'key', 'extra']);

  // Durée « m:ss », « mm:ss » ou « h:mm:ss » → « m:ss » (minutes au-delà de 59 si besoin).
  function normDuration(raw) {
    const m = typeof raw === 'string' && /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(raw.trim());
    if (!m || (m[1] != null && Number(m[2]) > 59)) fail(t('errDuration'));
    return `${Number(m[1] || 0) * 60 + Number(m[2])}:${m[3]}`;
  }

  // L'identifiant d'un concert voyage avec lui : un concert reçu qui porte le même id qu'un
  // concert local est une nouvelle version de celui-ci (mise à jour proposée, pas de doublon).
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
  const validDate = d => typeof d === 'string' && !Number.isNaN(Date.parse(d));

  function normConcert(raw, keepId) {
    if (!raw || typeof raw !== 'object') fail(t('errConcert'));
    if (!Array.isArray(raw.songs)) fail(t('errSongs'));
    const c = {
      id: validId(raw.id) || (keepId && raw.id) ? String(raw.id) : uid(),
      name: String(raw.name == null ? '' : raw.name).trim().slice(0, 80) || t('untitledConcert'),
      songs: raw.songs.map((s, i) => {
        try { return normSong(s, keepId); } catch (e) {
          if (e instanceof FormatError) fail(t('errSongN', { n: i + 1, message: e.message }));
          throw e;
        }
      }),
    };
    if (validDate(raw.updatedAt)) c.updatedAt = new Date(raw.updatedAt).toISOString();
    if (keepId && typeof raw.fp === 'string') c.fp = raw.fp;
    return c;
  }

  // Empreinte du contenu (nom + morceaux) : sert à dater les modifications et à repérer
  // une version reçue identique à la version locale.
  function fingerprint(c) {
    const text = JSON.stringify({ name: c.name, songs: c.songs.map(s => exportSong(s, false)) });
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + text.length.toString(36);
  }

  /* ---------- export / import ---------- */

  // Une signature personnalisée qui se réécrit à l'identique en texte (« 12/8 » sur 12 points) est exportée en texte.
  function sameAsText(sig) {
    try {
      const s = signatureFromText(sig.label, sig.steps);
      return !!s && s.stepsPerBeat === sig.stepsPerBeat;
    } catch (e) { return false; }
  }

  function exportSong(song, header = true) {
    const out = header ? { klik: FORMAT, type: 'song' } : {};
    out.name = song.name;
    out.tempo = song.tempo;
    out.signature = isPreset(song.signature) || sameAsText(song.signature) ? song.signature.label : { ...song.signature };
    out.pattern = song.pattern;
    for (const k of ['countIn', 'duration', 'notes', 'artist', 'section', 'key']) if (song[k] != null) out[k] = song[k];
    if (song.extra) for (const [k, v] of Object.entries(song.extra)) if (!(k in out)) out[k] = v;
    return out;
  }
  const exportConcert = c => {
    const out = { klik: FORMAT, type: 'concert', id: c.id, name: c.name };
    if (c.updatedAt) out.updatedAt = c.updatedAt;
    out.songs = c.songs.map(s => exportSong(s, false));
    return out;
  };
  const stringify = obj => JSON.stringify(obj, null, 2);

  // Format 1 : « 4/4 » valait 8 croches. On double la résolution (1 croche = 2 doubles-croches).
  function upgradeOld44(song) {
    if (!song || typeof song !== 'object') return;
    const sig = song.signature;
    const old = sig === '4/4' || (sig && sig.label === '4/4' && sig.steps === 8 && sig.stepsPerBeat === 2);
    if (!old || typeof song.pattern !== 'string' || song.pattern.length !== 8) return;
    song.signature = sig === '4/4' ? '4/4' : { label: '4/4', steps: 16, stepsPerBeat: 4 };
    song.pattern = [...song.pattern].map(c => c + '.').join('');
  }

  function parse(text) {
    let obj;
    try { obj = JSON.parse(String(text).trim()); } catch (e) { fail(t('errNotJson')); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(t('errNotObject'));
    // Forme courte : sans « klik » ni « type », on reconnaît un morceau à son tempo
    // et un concert à sa liste de morceaux.
    if (obj.type == null) obj.type = Array.isArray(obj.songs) ? 'concert' : obj.tempo != null ? 'song' : null;
    if (obj.type == null) fail(t('errNoKlik'));
    if (obj.klik == null) obj.klik = FORMAT;
    if (Number(obj.klik) > FORMAT) fail(t('errNewer'));
    if (Number(obj.klik) === 1) {
      if (obj.type === 'song') upgradeOld44(obj);
      if (obj.type === 'concert' && Array.isArray(obj.songs)) obj.songs.forEach(upgradeOld44);
    }
    if (obj.type === 'song') return { type: 'song', song: normSong(obj) };
    if (obj.type === 'concert') return { type: 'concert', concert: normConcert(obj) };
    fail(t('errType'));
  }

  /* ---------- stockage local ---------- */

  const tl = (l, key) => K.i18n.tl(l, key);

  function demoConcert(l = K.i18n.lang) {
    return normConcert({
      name: tl(l, 'demoConcert'),
      songs: [
        { name: tl(l, 'demoRock'), tempo: 120, signature: '4/4', pattern: 'X.x.X.x.X.x.X.x.' },
        { name: 'Tresillo', tempo: 100, signature: '4/4', pattern: 'X.....X.....X...' },
        { name: tl(l, 'demoWaltz'), tempo: 168, signature: '3/4', pattern: 'X...X...X...' },
        { name: tl(l, 'demoBallad'), tempo: 52, signature: '6/8', pattern: 'X.x.x.X.x.x.' },
        { name: 'Shuffle boogie', tempo: 112, signature: { label: '12/8', steps: 12, stepsPerBeat: 3 }, pattern: 'X.xX.xX.xX.x' },
      ],
    });
  }

  // Les claves (2 mesures) sont écrites sur une mesure de 4/4 en doubles-croches :
  // même motif, tempo à la blanche de la version « 2 mesures ».
  const LATIN_NAMES = [K.i18n.STRINGS.fr.latinConcert, K.i18n.STRINGS.en.latinConcert];
  function latinConcert(l = K.i18n.lang) {
    return normConcert({
      name: tl(l, 'latinConcert'),
      songs: [
        { name: tl(l, 'latinSalsa'), tempo: 95, signature: '4/4', pattern: 'X..X..X...X.X...' },
        { name: tl(l, 'latinRumba'), tempo: 85, signature: '4/4', pattern: 'X..X...X..X.X...' },
        { name: tl(l, 'latinSamba'), tempo: 100, signature: '2/4', pattern: 'X..xX..x' },
        { name: 'Cha-cha-cha', tempo: 120, signature: '4/4', pattern: 'X...X...X...X.x.' },
        { name: 'Bossa nova', tempo: 65, signature: '4/4', pattern: 'X..X..X...X..X..' },
      ],
    });
  }

  // Exemples intégrés restés intacts mais créés dans une autre langue : on les traduit.
  // Un exemple modifié (nom, tempo, motif, ordre…) ne correspond plus et n'est pas touché.
  // Renvoie, pour chaque concert traduit, la correspondance ancien id de morceau → nouvel id.
  function localizeBuiltins(concerts) {
    const lang = K.i18n.lang;
    const remap = {};
    for (const build of [demoConcert, latinConcert]) {
      const target = build(lang);
      const others = Object.keys(K.i18n.STRINGS).filter(l => l !== lang).map(l => fingerprint(build(l)));
      for (const c of concerts) {
        if (!others.includes(fingerprint(c))) continue;
        const ids = {};
        c.songs.forEach((s, i) => { ids[s.id] = target.songs[i].id; });
        c.name = target.name;
        c.songs = target.songs;
        delete c.fp;
        remap[c.id] = ids;
      }
    }
    return remap;
  }

  function fresh() {
    const c = demoConcert();
    const s = c.songs[0];
    return {
      schema: SCHEMA,
      muted: false,
      current: { tempo: s.tempo, signature: { ...s.signature }, pattern: s.pattern, concertId: c.id, songId: s.id, dirty: false },
      concerts: [c, latinConcert()],
    };
  }

  // Une entrée par version de schéma : migrations[n] transforme le schéma n en n + 1.
  const migrations = {
    // 1 → 2 : le 4/4 passe de 8 croches à 16 doubles-croches ; ajout des rythmes latinos.
    1: d => {
      const up = s => {
        if (!s || !s.signature || s.signature.label !== '4/4' || s.signature.steps !== 8 || s.signature.stepsPerBeat !== 2) return;
        s.signature = { label: '4/4', steps: 16, stepsPerBeat: 4 };
        if (typeof s.pattern === 'string' && s.pattern.length === 8) s.pattern = [...s.pattern].map(c => c + '.').join('');
      };
      d.concerts = Array.isArray(d.concerts) ? d.concerts : [];
      d.concerts.forEach(c => (c.songs || []).forEach(up));
      up(d.current);
      if (!d.concerts.some(c => LATIN_NAMES.includes(c.name))) d.concerts.push(latinConcert());
      d.schema = 2;
      return d;
    },
    // 2 → 3 : les claves passent de la grille « clave » (2 mesures en croches) au 4/4, tempo divisé par 2.
    2: d => {
      const up = s => {
        const g = s && s.signature;
        if (!g || g.label !== 'clave' || g.steps !== 16 || g.stepsPerBeat !== 2) return;
        s.signature = { label: '4/4', steps: 16, stepsPerBeat: 4 };
        s.tempo = clampTempo((Number(s.tempo) || 120) / 2);
      };
      (d.concerts || []).forEach(c => (c.songs || []).forEach(up));
      up(d.current);
      d.schema = 3;
      return d;
    },
  };

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
    const out = { schema: SCHEMA, muted: !!d.muted, current, concerts };
    if (d.previous && d.previous.concert) {
      try { out.previous = { concert: normConcert(d.previous.concert, true) }; } catch (e) { /* ignorée */ }
    }
    return out;
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

  /* ---------- lien de partage ----------
     Le JSON compact est compressé (deflate) puis encodé en base64url dans l'ancre du lien :
     …/klik/#k=<jeton>. Préfixe « z » = compressé, « j » = JSON brut (navigateur sans compression). */

  const toB64u = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64u = str => {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
  };
  const pipe = async (bytes, stream) =>
    new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

  async function encodeShare(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (self.CompressionStream) {
      try { return 'z' + toB64u(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (e) { /* repli ci-dessous */ }
    }
    return 'j' + toB64u(raw);
  }

  async function decodeShare(token) {
    try {
      const bytes = fromB64u(token.slice(1));
      if (token[0] === 'j') return new TextDecoder().decode(bytes);
      if (token[0] === 'z') return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
    } catch (e) { /* jeton abîmé */ }
    fail(t('errShareLink'));
  }

  // Jeton contenu dans un lien Klik (ou dans un message qui contient ce lien).
  const shareToken = text => {
    const m = /[#&]k=([jz][A-Za-z0-9_-]+)/.exec(String(text));
    return m ? m[1] : null;
  };

  K.store = {
    PRESETS, MIN_TEMPO, MAX_TEMPO, FormatError,
    uid, clampTempo, isPreset, defaultPattern, levels, setLevel,
    normSong, exportSong, exportConcert, stringify, parse, fingerprint, localizeBuiltins,
    load, save,
    encodeShare, decodeShare, shareToken,
  };
})(self.Klik = self.Klik || {});
