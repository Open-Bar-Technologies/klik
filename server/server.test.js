// Tests du serveur : node --test server/
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server');

const appDir = path.resolve(__dirname, '..');

async function start(dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klik-'))) {
  const server = await createServer({ appDir, dataDir, maxBody: 64 * 1024 });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { server, base, call, dataDir, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}

const concert = (over = {}) => ({
  klik: 2, type: 'concert', id: 'abcdefgh-1234', name: 'Fête de la musique', updatedAt: '2026-06-21T10:00:00.000Z',
  songs: [{ name: 'Rock droit', tempo: 120, signature: '4/4', pattern: 'X.x.X.x.X.x.X.x.' }],
  ...over,
});

test('publier, lister, relire, versions', async () => {
  const s = await start();
  try {
    assert.deepEqual((await s.call('GET', '/api/health')).body, { ok: true });
    assert.deepEqual((await s.call('GET', '/api/concerts')).body, { concerts: [] });

    const p1 = await s.call('PUT', '/api/concerts/abcdefgh-1234', { concert: concert(), base: null });
    assert.equal(p1.status, 201);
    assert.equal(p1.body.songs, 1);
    assert.equal(p1.headers.get('cache-control'), 'no-store');

    // Même contenu : pas de nouvelle version.
    const same = await s.call('PUT', '/api/concerts/abcdefgh-1234', { concert: concert(), base: p1.body.version });
    assert.equal(same.status, 200);
    assert.equal(same.body.unchanged, true);
    assert.equal(same.body.version, p1.body.version);

    // Même contenu sans connaître la version (reçu par lien, par exemple) : pas de conflit.
    assert.equal((await s.call('PUT', '/api/concerts/abcdefgh-1234', { concert: concert(), base: null })).body.unchanged, true);

    // Sans connaître la dernière version : conflit.
    const two = concert({ songs: [...concert().songs, { name: 'Valse', tempo: 168, signature: '3/4' }] });
    const conflict = await s.call('PUT', '/api/concerts/abcdefgh-1234', { concert: two, base: null });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.latest.version, p1.body.version);

    const p2 = await s.call('PUT', '/api/concerts/abcdefgh-1234', { concert: two, base: p1.body.version });
    assert.equal(p2.status, 201);
    assert.notEqual(p2.body.version, p1.body.version);

    const list = (await s.call('GET', '/api/concerts')).body.concerts;
    assert.equal(list.length, 1);
    assert.equal(list[0].songs, 2);

    const got = (await s.call('GET', '/api/concerts/abcdefgh-1234')).body;
    assert.equal(got.version, p2.body.version);
    assert.equal(got.concert.songs[1].pattern, 'X...X...X...');   // motif par défaut, normalisé comme dans l'app

    const versions = (await s.call('GET', '/api/concerts/abcdefgh-1234/versions')).body.versions;
    assert.deepEqual(versions.map(v => v.songs), [2, 1]);
    const old = (await s.call('GET', `/api/concerts/abcdefgh-1234?version=${p1.body.version}`)).body;
    assert.equal(old.concert.songs.length, 1);

    // force : publie par-dessus une autre version (l'ancienne reste dans l'historique).
    const forced = await s.call('PUT', '/api/concerts/abcdefgh-1234', { concert: concert({ name: 'Autre' }), base: null, force: true });
    assert.equal(forced.status, 201);
    assert.equal((await s.call('GET', '/api/concerts/abcdefgh-1234/versions')).body.versions.length, 3);
  } finally { await s.close(); }
});

test('retirer de la liste, republier, redémarrer', async () => {
  const s = await start();
  let v;
  try {
    v = (await s.call('PUT', '/api/concerts/abcdefgh-1234', { concert: concert() })).body.version;
    assert.equal((await s.call('POST', '/api/concerts/abcdefgh-1234/hide')).status, 200);
    assert.equal((await s.call('GET', '/api/concerts')).body.concerts.length, 0);
    assert.equal((await s.call('GET', '/api/concerts/abcdefgh-1234')).status, 200);   // toujours lisible
  } finally { await s.close(); }

  // Redémarrage sur le même dossier : l'index est reconstruit, le concert reste masqué.
  const s2 = await start(s.dataDir);
  try {
    assert.equal((await s2.call('GET', '/api/concerts')).body.concerts.length, 0);
    const r = await s2.call('PUT', '/api/concerts/abcdefgh-1234', { concert: concert({ name: 'Retour' }), base: v });
    assert.equal(r.status, 201);
    const list = (await s2.call('GET', '/api/concerts')).body.concerts;
    assert.deepEqual(list.map(c => c.name), ['Retour']);
  } finally { await s2.close(); }
});

test('refus des données invalides', async () => {
  const s = await start();
  try {
    const bad = async (body, status, p = '/api/concerts/abcdefgh-1234') => {
      const r = await s.call('PUT', p, body);
      assert.equal(r.status, status, JSON.stringify(r.body));
      assert.ok(r.body.error);
    };
    await bad({}, 400);
    await bad({ concert: { klik: 2, type: 'song', tempo: 100 } }, 400);
    await bad({ concert: concert({ songs: [{ tempo: 100, pattern: 'X..' }] }) }, 400);
    await bad({ concert: concert() }, 400, '/api/concerts/autre-id-123');
    await bad({ concert: concert({ id: 'court' }) }, 400, '/api/concerts/court');
    await bad({ concert: concert({ notes: 'x'.repeat(70 * 1024) }) }, 413);
    const raw = await fetch(s.base + '/api/concerts/abcdefgh-1234', { method: 'PUT', body: '{pas du json' });
    assert.equal(raw.status, 400);
    assert.equal((await s.call('GET', '/api/concerts/inconnu-123')).status, 404);
    assert.equal((await s.call('DELETE', '/api/concerts/abcdefgh-1234')).status, 405);
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'concerts')).length, 0);
  } finally { await s.close(); }
});

test('fichiers de l’app', async () => {
  const s = await start();
  try {
    const home = await s.call('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /<title>Klik<\/title>/);
    assert.equal(home.headers.get('cache-control'), 'no-cache');

    const sw = await s.call('GET', '/sw.js?v=1');
    assert.equal(sw.headers.get('cache-control'), 'no-cache');
    assert.match(sw.headers.get('content-type'), /javascript/);

    assert.equal((await s.call('GET', '/css/app.css')).headers.get('cache-control'), 'public, max-age=3600');
    assert.equal((await s.call('GET', '/server/server.js')).status, 404);
    assert.equal((await s.call('GET', '/.git/config')).status, 404);
    assert.equal((await s.call('GET', '/%2e%2e/etc/passwd')).status, 404);
    assert.equal((await s.call('GET', '/nope')).status, 404);

    const part = await fetch(s.base + '/icons/icon.svg', { headers: { Range: 'bytes=0-9' } });
    assert.equal(part.status, 206);
    assert.equal((await part.arrayBuffer()).byteLength, 10);
  } finally { await s.close(); }
});
