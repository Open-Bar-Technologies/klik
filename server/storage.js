// Stockage des setlists partagées, dans des fichiers JSON (volume persistant /data) :
//
//   <DATA_DIR>/concerts/<id>/<version>.json   une version publiée : { version, publishedAt, fingerprint, concert }
//   <DATA_DIR>/concerts/<id>/hidden           présent si le concert a été retiré de la liste
//
// Rien n'est jamais écrasé ni effacé : chaque publication ajoute une version. « Retirer de la liste »
// pose seulement le fichier `hidden` ; une nouvelle publication l'enlève. Pour restaurer à la main,
// il suffit de supprimer `hidden`, ou le fichier de la version indésirable.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const VERSION = /^\d{13}-[a-f0-9]{6}$/;

class Conflict extends Error {
  constructor(latest) { super('conflict'); this.latest = latest; }
}

function summary(rec) {
  return {
    id: rec.concert.id,
    name: rec.concert.name,
    songs: rec.concert.songs.length,
    updatedAt: rec.concert.updatedAt || null,
    version: rec.version,
    publishedAt: rec.publishedAt,
  };
}

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function openStorage(dataDir) {
  const root = path.join(dataDir, 'concerts');
  await fs.mkdir(root, { recursive: true });
  // Volume monté en lecture seule ou mauvais propriétaire : on le signale dès le démarrage.
  const probe = path.join(root, '.write-test');
  await fs.writeFile(probe, '');
  await fs.rm(probe);

  // Index en mémoire : id → { latest (résumé de la dernière version), fingerprint, hidden }. Reconstruit au démarrage.
  const index = new Map();
  const dirOf = id => path.join(root, id);

  async function versionsOf(id) {
    let names;
    try { names = await fs.readdir(dirOf(id)); } catch { return []; }
    return names.filter(n => n.endsWith('.json') && VERSION.test(n.slice(0, -5))).map(n => n.slice(0, -5)).sort();
  }
  async function readVersion(id, version) {
    return JSON.parse(await fs.readFile(path.join(dirOf(id), version + '.json'), 'utf8'));
  }

  for (const id of await fs.readdir(root)) {
    if (!ID.test(id)) continue;
    const versions = await versionsOf(id);
    if (!versions.length) continue;
    try {
      const rec = await readVersion(id, versions[versions.length - 1]);
      index.set(id, { latest: summary(rec), fingerprint: rec.fingerprint, hidden: await exists(path.join(dirOf(id), 'hidden')) });
    } catch (e) {
      console.warn(`Concert ${id} illisible, ignoré :`, e.message);
    }
  }

  // Les écritures sur un même concert passent l'une après l'autre.
  const locks = new Map();
  function locked(id, fn) {
    const run = (locks.get(id) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(id, tail);
    tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
    return run;
  }

  return {
    list() {
      return [...index.values()].filter(e => !e.hidden).map(e => e.latest)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    },

    // Dernière version (ou une version précise). null si inconnue.
    async get(id, version) {
      if (!ID.test(id) || !index.has(id)) return null;
      const v = version || index.get(id).latest.version;
      if (!VERSION.test(v)) return null;
      try { return await readVersion(id, v); } catch { return null; }
    },

    async versions(id) {
      if (!ID.test(id) || !index.has(id)) return null;
      const out = [];
      for (const v of (await versionsOf(id)).reverse()) {
        try { out.push(summary(await readVersion(id, v))); } catch { /* version illisible : ignorée */ }
      }
      return out;
    },

    // Publie une nouvelle version. `base` = version sur laquelle l'auteur s'appuie (null s'il n'en
    // connaît aucune). Si le serveur a une autre version, Conflict, sauf avec force.
    publish(concert, fingerprint, base, force) {
      const id = concert.id;
      return locked(id, async () => {
        const entry = index.get(id);
        const latest = entry && entry.latest;
        const dir = dirOf(id);
        const unhide = async () => {
          if (entry && entry.hidden) { await fs.rm(path.join(dir, 'hidden'), { force: true }); entry.hidden = false; }
        };
        // Contenu identique à la dernière version : rien de nouveau à enregistrer (et pas de conflit).
        if (latest && entry.fingerprint === fingerprint) { await unhide(); return { ...latest, unchanged: true }; }
        if (latest && !force && base !== latest.version) throw new Conflict(latest);
        await fs.mkdir(dir, { recursive: true });
        await unhide();
        const now = Date.now();
        const rec = {
          version: `${now}-${crypto.randomBytes(3).toString('hex')}`,
          publishedAt: new Date(now).toISOString(),
          fingerprint,
          concert,
        };
        await writeAtomic(path.join(dir, rec.version + '.json'), JSON.stringify(rec, null, 2));
        index.set(id, { latest: summary(rec), fingerprint, hidden: false });
        return { ...summary(rec), unchanged: false };
      });
    },

    hide(id) {
      if (!ID.test(id) || !index.has(id)) return Promise.resolve(false);
      return locked(id, async () => {
        await fs.writeFile(path.join(dirOf(id), 'hidden'), new Date().toISOString() + '\n');
        index.get(id).hidden = true;
        return true;
      });
    },
  };
}

module.exports = { openStorage, Conflict, ID };
