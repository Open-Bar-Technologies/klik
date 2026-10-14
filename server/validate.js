// Validation des concerts reçus par le serveur : on charge js/i18n.js et js/store.js, les mêmes
// fichiers que l'app, dans un bac à sable Node. Le serveur accepte donc exactement ce que l'app
// accepte, et range le concert sous la même forme que « Copier le JSON ».
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadStore(appDir) {
  const noop = () => {};
  const sandbox = {
    navigator: { languages: ['fr'] },        // messages d'erreur en français, comme l'app par défaut
    document: { addEventListener: noop },
    addEventListener: noop,
    localStorage: { getItem: () => null, setItem: noop },
    crypto: globalThis.crypto,
    console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const file of ['js/i18n.js', 'js/store.js']) {
    const full = path.join(appDir, file);
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: full });
  }
  return sandbox.Klik.store;
}

// Renvoie le concert normalisé (format d'échange) ou lève une erreur au message lisible.
function makeValidator(appDir) {
  const S = loadStore(appDir);
  return function validateConcert(raw) {
    const r = S.parse(JSON.stringify(raw));
    if (r.type !== 'concert') throw new Error('Seuls les concerts peuvent être publiés.');
    return { concert: S.exportConcert(r.concert), fingerprint: S.fingerprint(r.concert) };
  };
}

module.exports = { makeValidator };
