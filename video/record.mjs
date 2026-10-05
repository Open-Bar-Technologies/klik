// Enregistre la vidéo de présentation de Klik : pilote la vraie app dans deux iframes
// (stage.html), capture l'écran image par image et note l'instant de chaque clic du métronome.
// Usage : depuis la racine du dépôt, `python3 -m http.server 8765` puis `node video/record.mjs`.
// Produit video/out/frames/*.jpg, video/out/frames.txt et video/out/hits.json (voir build.sh).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

const OUT = new URL('./out/', import.meta.url).pathname;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT + 'frames', { recursive: true });

const APP1 = 'http://localhost:8765/';
const APP2 = 'http://127.0.0.1:8765/';   // autre origine : stockage séparé (le téléphone du batteur)
const SEED = JSON.stringify({
  schema: 3, muted: false, concerts: [],
  current: { tempo: 90, signature: '4/4', pattern: 'X...X...X...X...', concertId: null, songId: null, dirty: false },
});

const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  locale: 'fr-FR', colorScheme: 'dark', ignoreHTTPSErrors: true, serviceWorkers: 'block',
});

// Polices Google téléchargées par curl (qui sait passer par le proxy réseau éventuel).
const fontCache = new Map();
await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => {
  const url = route.request().url();
  if (!fontCache.has(url)) {
    fontCache.set(url, execFileSync('curl', ['-sSL', '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', url], { maxBuffer: 1 << 26 }));
  }
  const css = url.includes('googleapis');
  route.fulfill({ status: 200, body: fontCache.get(url), contentType: css ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
});

const hits = [];
let sharedUrl = null;
await ctx.exposeBinding('__klikHit', (_, h) => hits.push(h));
await ctx.exposeBinding('__klikShare', (_, url) => { sharedUrl = url; });
await ctx.addInitScript(seed => {
  if (location.port !== '8765' || location.pathname !== '/') return;
  if (!localStorage.getItem('klik.data')) localStorage.setItem('klik.data', seed);
  // Feuille de partage du téléphone simulée : on récupère le lien.
  navigator.share = async d => { await window.__klikShare(d.url); };
  // Pas de plein écran au lancement : l'iframe recouvrirait toute la scène.
  Element.prototype.requestFullscreen = undefined;
  // Horloge audio → heure murale de chaque clic, pour reconstruire la bande son.
  const AC = window.AudioContext;
  let ac = null;
  window.AudioContext = function (...a) { ac = new AC(...a); return ac; };
  const iv = setInterval(() => {
    const E = self.Klik && self.Klik.engine;
    if (!E) return;
    clearInterval(iv);
    const drain = E.drain;
    E.drain = () => {
      const out = drain();
      for (const ev of out) {
        if (!ev.lvl) continue;
        const muted = document.querySelector('#mute').textContent === '🔇';
        const wall = Date.now() - (ac.currentTime - ev.time) * 1000;
        window.__klikHit({ t: wall, lvl: ev.lvl, muted, origin: location.origin });
      }
      return out;
    };
  }, 20);
}, SEED);

const page = await ctx.newPage();
await page.goto('http://localhost:8765/video/stage.html');
await page.evaluate(([a, b]) => { stage.load('f1', a); stage.load('f2', b); }, [APP1, APP2]);
await page.waitForTimeout(2500);
await page.evaluate(() => document.fonts.ready);

const f1 = page.frameLocator('#f1');
const f2 = page.frameLocator('#f2');
const frame2 = () => page.frames().find(f => f.url().startsWith(APP2));

/* ---------- capture ---------- */
const frames = [];
const cdp = await ctx.newCDPSession(page);
let n = 0;
cdp.on('Page.screencastFrame', async f => {
  const file = `frames/${String(n++).padStart(6, '0')}.jpg`;
  writeFileSync(OUT + file, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp * 1000 });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});

/* ---------- outils ---------- */
const wait = ms => page.waitForTimeout(ms);
const st = (fn, ...args) => page.evaluate(([fn, args]) => stage[fn](...args), [fn, args]);
async function center(loc) {
  const b = await loc.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}
async function point(x, y, glide = 380) {
  await st('touchMove', x, y);
  await page.mouse.move(x, y);
  await wait(glide);
}
async function tap(loc, { glide = 380, after = 350 } = {}) {
  const [x, y] = await center(loc);
  await point(x, y, glide);
  await st('touchDown');
  await page.mouse.down();
  await wait(70);
  await page.mouse.up();
  await st('touchUp');
  await wait(after);
}
async function type(text, delay = 75) {
  await page.keyboard.type(text, { delay });
}
async function openLib(f, after = 700) {
  await tap(f.locator('#songTitle'), { after: 300 });
  if (!(await f.locator('#lib').isVisible())) { console.warn('liste non ouverte, nouvel essai'); await f.locator('#songTitle').click(); }
  await wait(after);
}
const caption = (k, t, b, ms = 0) => st('caption', k, t, b).then(() => wait(ms));

/* ---------- scénario ---------- */
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = Date.now();
await wait(400);

// Intro
await st('card', 'intro', true);
await wait(3600);
await st('card', 'intro', false);
await wait(500);
await st('mode', '');
await caption('Klik', 'Un métronome<br>pour le groupe', 'Le bon tempo avant chaque morceau, avec <strong>la setlist de chaque concert</strong> dans la poche.', 3800);

// 1. Pattern
await st('chapter', 1);
await caption('1 · Les bases', 'Choisis<br>ta mesure', 'En haut : <span class="k">2/4 · 3/4 · 4/4 · 6/8</span>. Chaque point autour du cercle est une double-croche de la mesure.', 900);
await tap(f1.locator('.chip', { hasText: '3/4' }), { after: 700 });
await tap(f1.locator('.chip', { hasText: '6/8' }), { after: 700 });
await tap(f1.locator('.chip', { hasText: '4/4' }), { after: 1600 });

await caption('1 · Les bases', 'Dessine<br>ton pattern', 'Touche un point : <strong>rien → moyen → fort</strong>. Le losange en haut, c’est le temps 1.', 800);
const pt = i => f1.locator(`.pt[data-i="${i}"]`);
for (const i of [2, 6, 10, 14]) await tap(pt(i), { glide: 300, after: 260 });
await wait(400);
await tap(pt(15), { glide: 300, after: 300 });
await tap(pt(15), { glide: 120, after: 900 });

await caption('1 · Les bases', 'Tape<br>le tempo', 'Touche <span class="k">TAP</span> quatre fois en rythme… ou maintiens et glisse pour l’ajuster.', 800);
const knob = f1.locator('#tap');
const [kx, ky] = await center(knob);
await point(kx, ky);
for (let i = 0; i < 5; i++) {
  await st('touchDown'); await page.mouse.down(); await wait(60);
  await page.mouse.up(); await st('touchUp');
  if (i < 4) await wait(600 - 60);   // 100 BPM
}
await wait(900);
await st('touchDown');
await page.mouse.down();
for (let s = 1; s <= 12; s++) { await page.mouse.move(kx + s * 6, ky); await st('touchMove', kx + s * 6, ky); await wait(16); }
await wait(1150);
await page.mouse.move(kx, ky); await st('touchMove', kx, ky);
await page.mouse.up(); await st('touchUp');
await wait(700);

await caption('1 · Les bases', 'Et c’est<br>parti', 'Touche <span class="k">▶</span> (ou le chiffre). On l’entend… et on le voit.', 500);
await tap(f1.locator('#play'), { after: 500 });
await st('touchHide');
await wait(3500);

// 2. Accents
await st('chapter', 2);
await caption('2 · Le point fort', 'Plusieurs<br>accents', '', 600);
await st('legend');
await wait(6200);
await caption('2 · Le point fort', 'Change en<br>direct', 'Le pattern se modifie pendant que ça joue : tu entends tout de suite la différence.', 700);
await tap(pt(7), { after: 1600 });
await tap(pt(7), { glide: 120, after: 1800 });
await tap(pt(12), { after: 2400 });
await caption('2 · Le point fort', 'Muet ?<br>Ça flashe', '<span class="k">🔊</span> coupe le son, le flash continue : idéal pour donner le tempo en silence juste avant de lancer le morceau.', 600);
await tap(f1.locator('#mute'), { after: 3800 });
await tap(f1.locator('#mute'), { after: 600 });
await tap(f1.locator('#play'), { after: 700 });
await st('touchHide');

// 3. Setlist
await st('chapter', 3);
await caption('3 · Ta setlist', 'Un concert,<br>des morceaux', 'Le menu <span class="k">☰</span> range tes réglages par concert.', 400);
await tap(f1.locator('#openLibrary'), { after: 900 });
await tap(f1.locator('.btn', { hasText: 'Nouveau concert' }), { after: 400 });
await type('Fête de la musique');
await wait(400);
await tap(f1.locator('.sheet .btn.primary'), { after: 900 });

await caption('3 · Ta setlist', 'Enregistre<br>le réglage', 'Tempo, mesure et pattern : tout est gardé. Il suffit de donner un nom.', 400);
async function saveCurrent(name) {
  await tap(f1.locator('.save-current'), { after: 400 });
  await type(name);
  await wait(300);
  await tap(f1.locator('.sheet .btn.primary'), { after: 1100 });
}
await saveCurrent('Intro funk');
await tap(f1.locator('#libClose'), { after: 600 });

async function tempoEntry(v) {
  const [x, y] = await center(f1.locator('#bpm'));
  await point(x, y);
  for (let i = 0; i < 2; i++) { await st('touchDown'); await page.mouse.down(); await wait(50); await page.mouse.up(); await st('touchUp'); await wait(90); }
  await wait(350);
  await type(String(v), 110);
  await page.keyboard.press('Enter');
  await wait(500);
}
await caption('3 · Ta setlist', 'Morceau<br>suivant', 'Deux touchers sur le chiffre pour taper le tempo au clavier, puis on enregistre.', 300);
await tap(f1.locator('.chip', { hasText: '3/4' }), { after: 400 });
await tempoEntry(168);
await openLib(f1);
await saveCurrent('Valse des copains');
await tap(f1.locator('#libClose'), { after: 400 });
await tap(f1.locator('.chip', { hasText: '6/8' }), { after: 400 });
await tempoEntry(58);
await openLib(f1, 600);
await saveCurrent('Ballade');

await caption('3 · Ta setlist', 'Dans<br>l’ordre', 'Glisse <span class="k">≡</span> pour réordonner, puis <span class="k">‹ ›</span> pour passer d’un morceau à l’autre sur scène.', 500);
const handle = f1.locator('#songRows li').nth(2).locator('.handle');
const [hx, hy] = await center(handle);
const [, ty] = await center(f1.locator('#songRows li').nth(0));
await point(hx, hy);
await st('touchDown'); await page.mouse.down();
for (let s = 1; s <= 24; s++) { const y = hy + (ty - 20 - hy) * s / 24; await page.mouse.move(hx, y); await st('touchMove', hx, y); await wait(28); }
await wait(250);
await page.mouse.up(); await st('touchUp');
await wait(900);
await tap(f1.locator('#songRows li').nth(0).locator('.row-main'), { after: 900 });
await tap(f1.locator('#next'), { after: 1100 });
await tap(f1.locator('#next'), { after: 1100 });
await tap(f1.locator('#prev'), { after: 900 });
await st('touchHide');

// 4. Partage
await st('chapter', 4);
await st('mode', 'duo');
await st('labels', true);
await caption('4 · Partage', 'Toute la setlist<br>dans un lien', 'Partager → Envoyer : le concert part par WhatsApp, SMS ou mail. Aucun compte, aucun serveur.', 1400);
await openLib(f1);
await tap(f1.locator('.lib-foot .btn', { hasText: 'Partager' }), { after: 1000 });
sharedUrl = null;
await tap(f1.locator('.sheet .btn.primary'), { after: 200 });
await st('bubble');
await wait(1500);
async function receive() {
  for (let i = 0; i < 50 && !sharedUrl; i++) await wait(50);
  const hash = new URL(sharedUrl).hash;
  await frame2().evaluate(h => { location.hash = h; }, hash);
}
await receive();
await wait(1200);
await caption('4 · Partage', 'Le groupe<br>est prêt', 'Le batteur touche le lien : le concert s’importe, même hors-ligne au fond d’une cave.', 300);
await tap(f2.locator('.sheet .btn.primary'), { after: 1600 });
await tap(f2.locator('#songRows li').nth(1).locator('.row-main'), { after: 700 });
await tap(f2.locator('#play'), { after: 400 });
await st('touchHide');
await wait(3600);
await tap(f2.locator('#play'), { after: 500 });

await caption('4 · Partage', 'Une modif ?<br>On renvoie', 'Klik reconnaît le concert et propose de le mettre à jour (avec retour en arrière possible).', 400);
await openLib(f1);
await tap(f1.locator('#songRows li').nth(2).locator('.row-more'), { after: 500 });
await tap(f1.locator('.sheet .btn', { hasText: 'Modifier le nom et le tempo' }), { after: 400 });
const tempoField = f1.locator('#songTempo');
await tap(tempoField, { after: 150 });
await page.keyboard.press('Control+A');
await type('176', 120);
await wait(300);
await tap(f1.locator('.sheet .btn.primary'), { after: 700 });
sharedUrl = null;
await tap(f1.locator('.lib-foot .btn', { hasText: 'Partager' }), { after: 800 });
await tap(f1.locator('.sheet .btn.primary'), { after: 200 });
await st('bubble');
await wait(1500);
await receive();
await wait(1400);
await tap(f2.locator('.sheet .btn.primary'), { after: 2400 });
await st('touchHide');

// Outro
await st('labels', false);
await st('chapter', 0);
await st('caption', '', '', '');
await st('mode', 'outro');
await wait(900);
await st('card', 'outro', true);
await wait(4200);

await cdp.send('Page.stopScreencast');
await wait(300);
const t1 = Date.now();
// Liste ffmpeg (concat) : chaque image dure jusqu'à la suivante.
const lines = [];
const list = frames.filter(f => f.t >= t0);
for (let i = 0; i < list.length; i++) {
  const end = i + 1 < list.length ? list[i + 1].t : t1;
  lines.push(`file '${list[i].file}'`, `duration ${((end - list[i].t) / 1000).toFixed(4)}`);
}
lines.push(`file '${list[list.length - 1].file}'`);
writeFileSync(OUT + 'frames.txt', lines.join('\n') + '\n');
writeFileSync(OUT + 'hits.json', JSON.stringify({ start: list[0].t, end: t1, hits }));
console.log(`${list.length} images, ${hits.length} clics, ${((t1 - t0) / 1000).toFixed(1)} s`);
await browser.close();
