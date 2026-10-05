// Enregistre la vidéo de présentation de Klik : pilote la vraie app dans deux iframes
// (stage.html), capture l'écran image par image et note l'instant de chaque clic du métronome.
// Usage : depuis la racine du dépôt, `python3 -m http.server 8765` puis `node video/record.mjs`.
// Produit video/out/frames/*.jpg, video/out/frames.txt et video/out/hits.json (voir build.py).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

const OUT = new URL('./out/', import.meta.url).pathname;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT + 'frames', { recursive: true });

const APP1 = 'http://localhost:8765/';
const APP2 = 'http://127.0.0.1:8765/';   // autre origine : stockage séparé (le téléphone du batteur)

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

// Lien reçu d'un ami, lu par le bouton Coller : morceau réduit à l'essentiel (nom, tempo, rythme).
const RECEIVED = 'https://klik.lonoize.com/#k=z' + deflateRawSync(Buffer.from(JSON.stringify(
  { klik: 2, type: 'song', name: 'Osez Joséphine', tempo: 118, signature: '4/4', pattern: 'X.X..X..X..X..X.' },
))).toString('base64url');
const hits = [];
let sharedUrl = null;
await ctx.exposeBinding('__klikClipboard', () => RECEIVED);
await ctx.exposeBinding('__klikHit', (_, h) => hits.push(h));
await ctx.exposeBinding('__klikShare', (_, url) => { sharedUrl = url; });
// Pas de données préparées : l'app démarre comme au premier lancement, avec ses concerts d'exemple.
await ctx.addInitScript(() => {
  if (location.port !== '8765' || location.pathname !== '/') return;
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
});

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
async function point(x, y, glide = 550) {
  await st('touchMove', x, y);
  await page.mouse.move(x, y);
  await wait(glide);
}
async function tap(loc, { glide = 550, after = 600 } = {}) {
  const [x, y] = await center(loc);
  await point(x, y, glide);
  await st('touchDown');
  await page.mouse.down();
  await wait(70);
  await page.mouse.up();
  await st('touchUp');
  await wait(after);
}
async function type(text, delay = 110) {
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

const pt = i => f1.locator(`.pt[data-i="${i}"]`);
const bpm = f => f.locator('#bpm').textContent().then(Number);

// Titre de séquence sur fond noir ; `setup` prépare l'écran pendant le noir.
async function sequence(n, title, sub, setup) {
  await st('black', `<div class="num">${n}</div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}`);
  await wait(900);
  await st('clearCaption');
  await st('chapter', n);
  if (setup) await setup();
  await wait(1900);
  await st('unblack');
  await wait(900);
}

// Maintenir TAP et glisser (dir +1 à droite, -1 à gauche) jusqu'au tempo voulu.
async function dragTo(target, dir) {
  const kb = await f1.locator('#tap').boundingBox();
  const tb = await f1.locator('#track').boundingBox();
  const kx = kb.x + kb.width / 2, ky = kb.y + kb.height / 2;
  const reach = ((tb.width - kb.width) / 2) * 0.75 * dir;
  await point(kx, ky);
  await st('touchDrag', true);
  await st('touchDown');
  await page.mouse.down();
  for (let s = 1; s <= 20; s++) { const x = kx + reach * s / 20; await page.mouse.move(x, ky); await st('touchMove', x, ky); await wait(20); }
  for (let i = 0; i < 400; i++) {
    const v = await bpm(f1);
    if (dir > 0 ? v >= target : v <= target) break;
    await wait(15);
  }
  for (let s = 19; s >= 0; s--) { const x = kx + reach * s / 20; await page.mouse.move(x, ky); await st('touchMove', x, ky); await wait(12); }
  await page.mouse.up();
  await st('touchUp');
  await st('touchDrag', false);
  await wait(500);
  await st('touchHide');
}

/* ---------- scénario ---------- */
await st('black', '<div class="num">1</div><h2>Le tempo</h2><p>La référence, avant chaque morceau</p>');
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = Date.now();
await wait(2600);
await st('chapter', 1);
await st('unblack');
await wait(900);

// 1. Le tempo de référence
await caption('Un toucher<br>sur ▶', 'Klik donne <strong>le tempo de référence</strong>. On écoute, on compte, on joue.', 2200);
await tap(f1.locator('#play'), { after: 400 });
await st('touchHide');
await wait(7600);                                   // 4 mesures à 120
await caption('Plus vite ?', 'Maintiens <span class="k">TAP</span> et glisse vers la droite.', 1800);
await dragTo(132, 1);
await wait(3000);
await caption('Moins vite ?', 'Glisse vers la gauche.', 1500);
await dragTo(96, -1);
await wait(3000);
await caption('Ou tape<br>le tempo', 'Quatre fois sur <span class="k">TAP</span>, en rythme.', 1800);
{
  const kb = await f1.locator('#tap').boundingBox();
  const kx = kb.x + kb.width / 2, ky = kb.y + kb.height / 2;
  await st('count', kx, kb.y - 26);
  await point(kx, ky);
  await wait(400);
  // Frappes calées sur une horloge absolue : l'affichage suit sans retarder la frappe.
  const start = Date.now();
  for (let i = 0; i < 4; i++) {
    while (Date.now() < start + i * 577) await new Promise(res => setTimeout(res, 2));   // 104 BPM
    await page.mouse.down();
    st('touchDown'); st('countHit', i);
    await new Promise(res => setTimeout(res, 50));
    await page.mouse.up();
    st('touchUp');
  }
  await wait(1200);
  await st('touchHide');
  await st('countHide');
}
console.log('tempo après TAP :', await bpm(f1));
await wait(4000);
await tap(f1.locator('#play'), { after: 300 });
await st('touchHide');

// 2. Les accents
await sequence(2, 'Les accents', 'Le rythme du morceau, pas seulement les temps');
await caption('Chaque point,<br>un coup', 'Touche un point pour changer son accent :', 1200, true);
await wait(2500);
await caption('Les seuls temps', 'Toucher <span class="k">4/4</span> remet le motif à ses seuls temps.', 1800);
await tap(f1.locator('.chip', { hasText: '4/4' }), { after: 1500 });
await tap(f1.locator('#play'), { after: 300 });
await st('touchHide');
await wait(4000);                                   // 2 mesures du 4/4 de base
await caption('Dancing Queen', 'On dessine son rythme… pendant que ça joue.', 1500);
for (const [i, n] of [[3, 2], [4, 1], [6, 2], [8, 1], [9, 2]]) {
  for (let k = 0; k < n; k++) await tap(pt(i), { glide: k ? 150 : 550, after: k + 1 < n ? 500 : 1300 });
}
await st('touchHide');
await caption('Dancing Queen', 'Prêt à jouer : <span class="k">104 BPM</span>, temps 1, forts et silences.', 9000);
await caption('Muet ?', '<span class="k">🔊</span> coupe le son. <strong>Le flash continue</strong> : on voit le tempo sans l’entendre.', 1800);
await tap(f1.locator('#mute'), { after: 300 });
await st('touchHide');
await wait(5000);
await tap(f1.locator('#mute'), { after: 2000 });
await tap(f1.locator('#play'), { after: 300 });
await st('touchHide');

// 3. La setlist
await sequence(3, 'Ta setlist', 'Les morceaux du concert, dans l’ordre');
await caption('Un concert', '<span class="k">☰</span> ouvre le concert d’exemple en cours, <span class="k">‹</span> montre tous les concerts.', 2200);
await tap(f1.locator('#openLibrary'), { after: 1500 });
await tap(f1.locator('#libBack'), { after: 1500 });
await caption('Un concert', 'Deux concerts d’exemple sont déjà là. On crée le nôtre : « Nouveau concert ».', 2200);
await tap(f1.locator('.btn', { hasText: 'Nouveau concert' }), { after: 500 });
await type('Anniversaire Sam');
await wait(600);
await tap(f1.locator('.sheet .btn.primary'), { after: 1500 });
async function saveCurrent(name) {
  await tap(f1.locator('.save-current'), { after: 600 });
  await type(name);
  await wait(800);
  await tap(f1.locator('.sheet .btn.primary'), { after: 2200 });
}
await caption('On enregistre', 'Le réglage actuel devient un morceau du concert.', 1800);
await saveCurrent('Dancing Queen');
await caption('Un rock<br>tout simple', 'On revient au <span class="k">4/4</span> de base, à <span class="k">168</span>.', 1500);
await tap(f1.locator('#libClose'), { after: 1000 });
await tap(f1.locator('.chip', { hasText: '4/4' }), { after: 1200 });
await caption('Un rock<br>tout simple', 'Deux touchers sur le chiffre pour taper le tempo.', 1200);
{
  const [x, y] = await center(f1.locator('#bpm'));
  await point(x, y);
  await press(x, y); await wait(80); await press(x, y);
  await wait(700);
  await type('168', 250);
  await wait(500);
  await page.keyboard.press('Enter');
  await wait(1200);
}
await openLib(f1, 600);
await saveCurrent('Johnny B. Goode');
await caption('Un morceau<br>reçu ?', 'Un ami t’envoie un lien : touche <span class="k">Coller</span>.', 1800);
await tap(f1.locator('.lib-foot .btn', { hasText: 'Coller' }), { after: 2800 });
await caption('Dans l’ordre', 'Glisse <span class="k">≡</span> : le rock passe en premier.', 1800);
{
  const [hx, hy] = await center(f1.locator('#songRows li').nth(1).locator('.handle'));
  const [, ty] = await center(f1.locator('#songRows li').nth(0));
  await point(hx, hy);
  await st('touchDrag', true);
  await st('touchDown'); await page.mouse.down();
  for (let s = 1; s <= 30; s++) { const y = hy + (ty - 20 - hy) * s / 30; await page.mouse.move(hx, y); await st('touchMove', hx, y); await wait(30); }
  await wait(300);
  await page.mouse.up(); await st('touchUp'); await st('touchDrag', false);
  await wait(2000);
}
await caption('Sur scène', 'On lance le premier, puis <span class="k">›</span> pour le suivant.', 1800);
await tap(f1.locator('#songRows li').nth(0).locator('.row-main'), { after: 1500 });
await tap(f1.locator('#play'), { after: 200 });
await st('touchHide');
await caption('Johnny B. Goode', '<span class="k">168 BPM</span> · le 4/4 tout simple.', 5800);
await tap(f1.locator('#next'), { glide: 450, after: 100 });
await st('touchHide');
await caption('Dancing Queen', '<span class="k">104 BPM</span> · le groove.', 9300);
await tap(f1.locator('#next'), { glide: 450, after: 100 });
await st('touchHide');
await caption('Osez Joséphine', '<span class="k">118 BPM</span> · un rythme inhabituel.', 8300);
await tap(f1.locator('#play'), { after: 300 });
await st('touchHide');

// 4. Le partage
await sequence(4, 'Partager', 'La setlist pour tout le groupe', async () => {
  await st('mode', 'duo');
  await st('labels', true);
  await wait(1000);
});
await caption('Tout le concert<br>dans un lien', 'Partager → « Envoyer le lien… » par WhatsApp, SMS ou mail.', 2000);
await openLib(f1, 1000);
await tap(f1.locator('.lib-foot .btn', { hasText: 'Partager' }), { after: 2000 });
sharedUrl = null;
await tap(f1.locator('.sheet .btn.primary'), { after: 200 });
await st('touchHide');
await st('bubble');
await wait(2400);
async function receive() {
  for (let i = 0; i < 50 && !sharedUrl; i++) await wait(50);
  const hash = new URL(sharedUrl).hash;
  await frame2().evaluate(h => { location.hash = h; }, hash);
}
await receive();
await caption('Le batteur<br>l’ouvre', 'Le concert s’importe. Pas de compte, pas de serveur, même hors-ligne.', 2800);
await tap(f2.locator('.sheet .btn.primary'), { after: 2500 });
await tap(f2.locator('#songRows li').nth(1).locator('.row-main'), { after: 1200 });
await tap(f2.locator('#play'), { after: 200 });
await st('touchHide');
await wait(4800);
await tap(f2.locator('#play'), { after: 800 });
await st('touchHide');

await caption('Une modif ?', 'Tu changes un tempo, puis tu renvoies le lien.', 1500);
await openLib(f1, 800);
await tap(f1.locator('#songRows li').nth(0).locator('.row-more'), { after: 900 });
await tap(f1.locator('.sheet .btn', { hasText: 'Modifier le nom et le tempo' }), { after: 800 });
await tap(f1.locator('#songTempo'), { after: 300 });
await page.keyboard.press('Control+A');
await type('176', 250);
await wait(700);
await tap(f1.locator('.sheet .btn.primary'), { after: 1500 });
sharedUrl = null;
await tap(f1.locator('.lib-foot .btn', { hasText: 'Partager' }), { after: 1200 });
await tap(f1.locator('.sheet .btn.primary'), { after: 200 });
await st('touchHide');
await st('bubble');
await wait(2400);
await receive();
await caption('Le batteur<br>met à jour', 'Klik reconnaît le concert et propose la nouvelle version.', 3500);
await tap(f2.locator('.sheet .btn.primary'), { after: 3000 });
await st('touchHide');

// Fin
await st('black', '<div class="logo">K</div><h2>Klik</h2><p>Gratuit · hors-ligne · s’installe sur l’écran d’accueil</p><div class="url">klik.lonoize.com</div>');
await wait(5000);

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
