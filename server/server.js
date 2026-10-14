// Serveur de Klik : sert l'app (fichiers statiques) et l'API des setlists partagées.
// Aucune dépendance : Node 20 ou plus suffit.
//
//   GET  /api/health                     → { ok: true }
//   GET  /api/concerts                   → setlists partagées (résumés, la plus récente en premier)
//   GET  /api/concerts/:id[?version=v]   → { version, publishedAt, concert }
//   GET  /api/concerts/:id/versions      → toutes les versions publiées (résumés)
//   PUT  /api/concerts/:id               ← { concert, base, force } : publie une nouvelle version
//   POST /api/concerts/:id/hide          → retire le concert de la liste (rien n'est effacé)
//
// Variables d'environnement : PORT (3000), DATA_DIR (/data), APP_DIR (dossier de l'app),
// MAX_BODY (taille max d'une setlist, en octets).
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { openStorage, Conflict, ID } = require('./storage');
const { makeValidator } = require('./validate');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};
const COMPRESS = /^(text\/|application\/(json|manifest)|image\/svg)/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // Jamais en cache (Cloudflare, navigateur, service worker) : la liste doit toujours être à jour.
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (tooBig) return;   // on laisse finir l'envoi (sans le garder) pour que le client lise la réponse
      if (size > max) { tooBig = true; chunks.length = 0; reject(new HttpError(413, 'Setlist trop volumineuse.')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

async function createServer({ appDir, dataDir, maxBody = 256 * 1024 }) {
  const storage = await openStorage(dataDir);
  const validate = makeValidator(appDir);
  const notFoundPage = path.join(appDir, '404.html');

  /* ---------- API ---------- */

  async function api(req, res, url) {
    const parts = url.pathname.split('/').slice(2);   // ['concerts', id, …]
    const method = req.method;

    if (parts[0] === 'health' && parts.length === 1 && method === 'GET') return sendJson(res, 200, { ok: true });
    if (parts[0] !== 'concerts') throw new HttpError(404, 'Introuvable.');

    if (parts.length === 1) {
      if (method !== 'GET') throw new HttpError(405, 'Méthode non autorisée.');
      return sendJson(res, 200, { concerts: storage.list() });
    }

    const id = parts[1];
    if (!ID.test(id)) throw new HttpError(400, 'Identifiant de concert invalide.');

    if (parts.length === 2 && method === 'GET') {
      const rec = await storage.get(id, url.searchParams.get('version'));
      if (!rec) throw new HttpError(404, 'Concert introuvable.');
      return sendJson(res, 200, { version: rec.version, publishedAt: rec.publishedAt, concert: rec.concert });
    }
    if (parts.length === 2 && method === 'PUT') {
      const body = await readBody(req, maxBody);
      if (!body || typeof body !== 'object' || !body.concert) throw new HttpError(400, 'Il manque le concert.');
      let v;
      try { v = validate(body.concert); } catch (e) { throw new HttpError(400, e.message); }
      if (v.concert.id !== id) throw new HttpError(400, 'L’identifiant du concert ne correspond pas à l’adresse.');
      try {
        const r = await storage.publish(v.concert, v.fingerprint, typeof body.base === 'string' ? body.base : null, body.force === true);
        return sendJson(res, r.unchanged ? 200 : 201, r);
      } catch (e) {
        if (e instanceof Conflict) return sendJson(res, 409, { error: 'Une autre version a été publiée entre-temps.', latest: e.latest });
        throw e;
      }
    }
    if (parts.length === 3 && parts[2] === 'versions' && method === 'GET') {
      const list = await storage.versions(id);
      if (!list) throw new HttpError(404, 'Concert introuvable.');
      return sendJson(res, 200, { versions: list });
    }
    if (parts.length === 3 && parts[2] === 'hide' && method === 'POST') {
      if (!await storage.hide(id)) throw new HttpError(404, 'Concert introuvable.');
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(parts.length <= 3 ? 405 : 404, parts.length <= 3 ? 'Méthode non autorisée.' : 'Introuvable.');
  }

  /* ---------- fichiers de l'app ---------- */

  function resolveStatic(pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return null; }
    if (rel.endsWith('/')) rel += 'index.html';
    const segs = rel.split('/').filter(Boolean);
    // Pas de fichiers cachés (.git…) ni du code du serveur.
    if (segs.some(s => s.startsWith('.')) || ['server', 'node_modules'].includes(segs[0])) return null;
    const file = path.join(appDir, ...segs);
    if (!file.startsWith(appDir + path.sep)) return null;
    return file;
  }

  function serveFile(req, res, file, status = 200) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        if (status === 404) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
        serveFile(req, res, notFoundPage, 404);
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type = TYPES[ext] || 'application/octet-stream';
      const headers = {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Last-Modified': st.mtime.toUTCString(),
        // sw.js et les pages : toujours revérifiés, sinon les téléphones ne voient pas les nouvelles
        // versions (voir README, « Cache devant le site »). Le reste est demandé avec ?v=VERSION.
        'Cache-Control': ext === '.html' || ext === '.webmanifest' || path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=3600',
        'Accept-Ranges': 'bytes',
        Vary: 'Accept-Encoding',
      };
      if (status === 200 && req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(st.mtime.toUTCString())) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      // Morceaux de fichier (vidéo du guide : Safari les exige).
      const range = status === 200 && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
        let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
        start = Math.max(0, start);
        end = Math.min(end, st.size - 1);
        if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      const gzip = COMPRESS.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      if (gzip) headers['Content-Encoding'] = 'gzip'; else headers['Content-Length'] = st.size;
      res.writeHead(status, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(file);
      (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
    });
  }

  /* ---------- aiguillage ---------- */

  return http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try { await api(req, res, url); } catch (e) {
        if (!(e instanceof HttpError)) console.error(e);
        if (!res.headersSent) sendJson(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Erreur du serveur.' });
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const file = resolveStatic(url.pathname);
    if (!file) { serveFile(req, res, notFoundPage, 404); return; }
    serveFile(req, res, file);
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const appDir = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
  const dataDir = path.resolve(process.env.DATA_DIR || '/data');
  const maxBody = Number(process.env.MAX_BODY) || undefined;
  createServer({ appDir, dataDir, maxBody }).then(server => {
    server.listen(port, () => console.log(`Klik sur le port ${port} · app ${appDir} · données ${dataDir}`));
    const stop = () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }).catch(e => {
    console.error(`Démarrage impossible (le dossier de données ${dataDir} est-il accessible en écriture ?) :`, e);
    process.exit(1);
  });
}
