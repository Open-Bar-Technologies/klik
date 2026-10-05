// Enregistre la vidéo de présentation de Klik : pilote la vraie app dans deux iframes
// (stage.html), capture l'écran image par image et note l'instant de chaque clic du métronome.
// Usage : depuis la racine du dépôt, `python3 -m http.server 8765` puis `node video/record.mjs`.
// Produit video/out/frames/*.jpg, video/out/frames.txt et video/out/hits.json (voir build.py).
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
  current: { tempo: 120, signature: '4/4', pattern: 'X...X...X...X...', concertId: null, songId: null, dirty: false },
});

const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({
  viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1,   // vertical 9:16
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

// Lien reçu d'un ami (morceau « Osez Joséphine »), lu par le bouton Coller.
const RECEIVED = 'https://klik.lonoize.com/#k=zTY6xDoJADIZfhXQmGAgm5DYdXWRkbbCBBri7XMuAxvfR5-DFvDMOJl2-fn_T_wHTzBOYKgfdPIEBcXaAHCwuia5C9-ziZH_7kS1FobR4B6YsmxyEB4u6hpSsD3W0HlUp2Mhd0RX_E-VtDajskq3MsYkbDMqikU8zss3OKOP6fS_U_5JtoIX3V6DMp3Sq0I9o01GL0uMMzw8';
const hits = [];
let sharedUrl = null;
await ctx.exposeBinding('__klikClipboard', () => RECEIVED);
await ctx.exposeBinding('__klikHit', (_, h) => hits.push(h));
await ctx.exposeBinding('__klikShare', (_, url) => { sharedUrl = url; });
await ctx.addInitScript(seed => {
  if (location.port !== '8765' || location.pathname !== '/') return;
  if (!localStorage.getItem('klik.data')) localStorage.setItem('klik.data', seed);
  // Feuille de partage du téléphone simulée : on récupère le lien.
  navigator.share = async d => { await window.__klikShare(d.url); };
  if (navigator.clipboard) Object.defineProperty(navigator.clipboard, 'readText', { value: () => window.__klikClipboard() });
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
async function point(x, y, glide = 320) {
  await st('touchMove', x, y);
  await page.mouse.move(x, y);
  await wait(glide);
}
async function tap(loc, { glide = 320, after = 300 } = {}) {
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
const caption = (t, b, ms = 0, legend = false) => st('caption', t, b, legend).then(() => wait(ms));
async function press(x, y, hold = 50) {
  await st('touchDown'); await page.mouse.down(); await wait(hold);
  await page.mouse.up(); await st('touchUp');
}

/* ---------- scénario ---------- */
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
const t0 = Date.now();
const pt = i => f1.locator(`.pt[data-i="${i}"]`);

// 1. Le tempo de référence : on lance tout de suite le 4/4 de base.
await st('chapter', 1);
await caption('Le bon tempo,<br>tout de suite', 'Avant chaque morceau, Klik donne <strong>la référence</strong> : un coup d’œil, et on compte 1, 2, 3, 4.');
await tap(f1.locator('#play'), { glide: 250, after: 3600 });
await caption('Tape<br>le tempo', 'Quatre fois sur <span class="k">TAP</span>, en rythme. Ou maintiens et glisse pour l’ajuster.', 300);
const [kx, ky] = await center(f1.locator('#tap'));
await point(kx, ky);
// Frappes calées sur une horloge absolue : l'indicateur de toucher suit sans retarder la frappe.
const tapStart = Date.now();
for (let i = 0; i < 5; i++) {
  while (Date.now() < tapStart + i * 577) await new Promise(res => setTimeout(res, 2));   // 104 BPM
  await page.mouse.down();
  st('touchDown');
  await new Promise(res => setTimeout(res, 50));
  await page.mouse.up();
  st('touchUp');
}
await wait(100);
await st('touchHide');
await wait(2600);

// 2. Accents : on dessine Dancing Queen pendant que ça joue.
await st('chapter', 2);
await caption('Dessine le rythme', 'Touche un point : <strong>rien → moyen → fort</strong>. Ici, Dancing Queen.', 400, true);
await tap(pt(4), { after: 250 });
await tap(pt(8), { after: 500 });
for (const i of [3, 6, 9]) {
  await tap(pt(i), { after: 120 });
  await tap(pt(i), { glide: 80, after: 700 });
}
await st('touchHide');
await wait(4000);
await caption('Muet ?<br>Ça flashe', '<span class="k">🔊</span> coupe le son, le flash continue : le tempo en silence, pour un départ discret.', 200);
await tap(f1.locator('#mute'), { after: 2900 });
await tap(f1.locator('#mute'), { after: 200 });
await tap(f1.locator('#play'), { after: 200 });

// 3. Setlist.
await st('chapter', 3);
await caption('Une setlist<br>par concert', '<span class="k">☰</span> → nouveau concert, puis on enregistre le réglage.', 0);
await tap(f1.locator('#openLibrary'), { after: 500 });
await tap(f1.locator('.btn', { hasText: 'Nouveau concert' }), { after: 250 });
await type('Bal du samedi', 55);
await tap(f1.locator('.sheet .btn.primary'), { after: 500 });
async function saveCurrent(name) {
  await tap(f1.locator('.save-current'), { after: 250 });
  await type(name, 55);
  await wait(150);
  await tap(f1.locator('.sheet .btn.primary'), { after: 800 });
}
await saveCurrent('Dancing Queen');
await tap(f1.locator('#libClose'), { after: 200 });

async function tempoEntry(v) {
  const [x, y] = await center(f1.locator('#bpm'));
  await point(x, y);
  await press(x, y); await wait(80); await press(x, y);
  await wait(300);
  await type(String(v), 100);
  await page.keyboard.press('Enter');
  await wait(400);
}
await caption('Un rock<br>tout simple', '<span class="k">4/4</span>, deux touchers sur le chiffre pour taper <span class="k">168</span>, et on l’enregistre.', 0);
await tap(f1.locator('.chip', { hasText: '4/4' }), { after: 300 });
await tempoEntry(168);
await openLib(f1, 300);
await saveCurrent('Johnny B. Goode');

await caption('Un morceau<br>reçu ?', 'Copie le lien reçu, touche <span class="k">Coller</span> : il rejoint la liste.', 200);
await tap(f1.locator('.lib-foot .btn', { hasText: 'Coller' }), { after: 1300 });
// Le rock en premier : glisser ≡.
const handle = f1.locator('#songRows li').nth(1).locator('.handle');
const [hx, hy] = await center(handle);
const [, ty] = await center(f1.locator('#songRows li').nth(0));
await point(hx, hy);
await st('touchDown'); await page.mouse.down();
for (let s = 1; s <= 16; s++) { const y = hy + (ty - 20 - hy) * s / 16; await page.mouse.move(hx, y); await st('touchMove', hx, y); await wait(25); }
await wait(150);
await page.mouse.up(); await st('touchUp');
await wait(600);

await caption('Sur scène :<br>‹ › et ça joue', 'Morceau suivant : le tempo et le rythme changent d’un toucher.', 0);
await tap(f1.locator('#songRows li').nth(0).locator('.row-main'), { after: 400 });
await tap(f1.locator('#play'), { after: 200 });
await st('touchHide');
await wait(3200);                                  // Johnny B. Goode, 168
await tap(f1.locator('#next'), { after: 200 });
await st('touchHide');
await wait(4700);                                  // Dancing Queen, 104
await tap(f1.locator('#next'), { after: 200 });
await st('touchHide');
await wait(4300);                                  // Osez Joséphine, 118
await tap(f1.locator('#play'), { after: 200 });

// 4. Partage.
await st('chapter', 4);
await st('mode', 'duo');
await st('labels', true);
await caption('Toute la setlist<br>dans un lien', 'Partager → Envoyer, par WhatsApp, SMS ou mail. Sans compte, sans serveur.', 1000);
await openLib(f1, 400);
await tap(f1.locator('.lib-foot .btn', { hasText: 'Partager' }), { after: 600 });
sharedUrl = null;
await tap(f1.locator('.sheet .btn.primary'), { after: 100 });
await st('touchHide');
await st('bubble');
await wait(1300);
async function receive() {
  for (let i = 0; i < 50 && !sharedUrl; i++) await wait(50);
  const hash = new URL(sharedUrl).hash;
  await frame2().evaluate(h => { location.hash = h; }, hash);
}
await receive();
await wait(700);
await caption('Le batteur<br>est prêt', 'Il touche le lien : le concert est importé, même hors-ligne.', 200);
await tap(f2.locator('.sheet .btn.primary'), { after: 1000 });
await tap(f2.locator('#songRows li').nth(1).locator('.row-main'), { after: 300 });
await tap(f2.locator('#play'), { after: 200 });
await st('touchHide');
await wait(2600);
await tap(f2.locator('#play'), { after: 200 });

await caption('Une modif ?<br>On renvoie', 'Klik reconnaît le concert et propose la mise à jour.', 0);
await openLib(f1, 300);
await tap(f1.locator('#songRows li').nth(0).locator('.row-more'), { after: 300 });
await tap(f1.locator('.sheet .btn', { hasText: 'Modifier le nom et le tempo' }), { after: 300 });
await tap(f1.locator('#songTempo'), { after: 100 });
await page.keyboard.press('Control+A');
await type('176', 100);
await tap(f1.locator('.sheet .btn.primary'), { after: 500 });
sharedUrl = null;
await tap(f1.locator('.lib-foot .btn', { hasText: 'Partager' }), { after: 500 });
await tap(f1.locator('.sheet .btn.primary'), { after: 100 });
await st('touchHide');
await st('bubble');
await wait(1300);
await receive();
await wait(900);
await tap(f2.locator('.sheet .btn.primary'), { after: 1800 });
await st('touchHide');

// Fin
await st('card', 'outro', true);
await wait(3200);

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
