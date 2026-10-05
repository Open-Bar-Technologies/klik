// Captures d'écran du guide (guide.html), en français et en anglais, sur la vraie app.
// Usage : depuis la racine du dépôt, `python3 -m http.server 8765` puis `node video/guide-shots.mjs`.
// Produit guide/fr-NN.webp et guide/en-NN.webp (ffmpeg avec libwebp).
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = ROOT + 'guide/';
const TMP = ROOT + 'video/out/shots/';
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const APP = 'http://localhost:8765/';
const SEED = JSON.stringify({
  schema: 3, muted: false, concerts: [],
  current: { tempo: 120, signature: '4/4', pattern: 'X...X...X...X...', concertId: null, songId: null, dirty: false },
});
const TEXT = {
  fr: { concert: 'Anniversaire Sam', newConcert: 'Nouveau concert', paste: 'Coller', share: 'Partager', edit: 'Modifier le nom et le tempo' },
  en: { concert: 'Sam’s birthday', newConcert: 'New gig', paste: 'Paste', share: 'Share', edit: 'Edit name and tempo' },
};
const RECEIVED = APP + '#k=z' + deflateRawSync(Buffer.from(JSON.stringify(
  { klik: 2, type: 'song', name: 'Osez Joséphine', tempo: 118, signature: '4/4', pattern: 'X.X..X..X..X..X.' },
))).toString('base64url');

const browser = await pw.chromium.launch();

async function phone(locale) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale, colorScheme: 'dark',
    serviceWorkers: 'block', hasTouch: false,
  });
  // Polices Google téléchargées par curl (qui sait passer par le proxy réseau éventuel).
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => {
    const url = route.request().url();
    const body = execFileSync('curl', ['-sSL', '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', url], { maxBuffer: 1 << 26 });
    route.fulfill({ status: 200, body, contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
  });
  // Pas de données préparées : l'app démarre comme au premier lancement, avec ses deux concerts d'exemple.
  await ctx.addInitScript(([seed, received]) => {
    navigator.share = async () => {};
    Element.prototype.requestFullscreen = undefined;
    if (navigator.clipboard) Object.defineProperty(navigator.clipboard, 'readText', { value: async () => received });
  }, [SEED, RECEIVED]);
  const page = await ctx.newPage();
  await page.goto(APP);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  return page;
}

let shot = 0;
async function snap(page, lang) {
  const n = String(++shot).padStart(2, '0');
  const png = `${TMP}${lang}-${n}.png`;
  await page.screenshot({ path: png });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', 'scale=585:-1', '-c:v', 'libwebp', '-quality', '78', `${OUT}${lang}-${n}.webp`]);
}

// Fige le flash en cours : on attend un coup du niveau voulu puis on met les animations en pause.
async function freezeFlash(page, downbeat) {
  await page.evaluate(downbeat => new Promise(resolve => {
    const disc = document.querySelector('#disc');
    const check = () => {
      const a = disc.getAnimations();
      const isDown = a.some(x => x.effect.getKeyframes()[0].background);
      if (a.length && isDown === downbeat) {
        document.getAnimations().forEach(x => { x.pause(); x.currentTime = 30; });
        resolve();
      } else requestAnimationFrame(check);
    };
    check();
  }), downbeat);
  await page.waitForTimeout(80);
}
const resume = page => page.evaluate(() => document.getAnimations().forEach(x => x.play()));

// Lien de partage d'un concert, calculé comme le fait le bouton Partager.
const shareLink = (page, name) => page.evaluate(async name => {
  const c = Klik.store.load().concerts.find(x => x.name === name);
  return location.href.split('#')[0] + '#k=' + await Klik.store.encodeShare(Klik.store.exportConcert(c));
}, name);

async function typeTempo(page, v) {
  await page.dblclick('#bpm');
  await page.waitForTimeout(150);
  await page.keyboard.type(String(v));
  await page.keyboard.press('Enter');
}

for (const lang of ['fr', 'en']) {
  shot = 0;
  const T = TEXT[lang];
  const p = await phone(lang === 'fr' ? 'fr-FR' : 'en-US');

  // 1. Tempo
  await p.click('#play');
  await p.waitForTimeout(700);
  await freezeFlash(p, true);
  await snap(p, lang);                                   // 01 : lecture, temps 1
  await resume(p);
  await p.click('#play');

  const kb = await p.locator('#tap').boundingBox();
  const kx = kb.x + kb.width / 2, ky = kb.y + kb.height / 2;
  await p.mouse.move(kx, ky);
  await p.mouse.down();
  for (let s = 1; s <= 10; s++) { await p.mouse.move(kx + s * 9, ky); await p.waitForTimeout(16); }
  await p.waitForFunction(() => Number(document.querySelector('#bpm').textContent) >= 132);
  await snap(p, lang);                                   // 02 : glisser vers la droite
  await p.mouse.move(kx, ky);
  await p.mouse.up();
  await p.waitForTimeout(2300);                          // remise à zéro des points du TAP

  const start = Date.now();
  for (let i = 0; i < 4; i++) {
    while (Date.now() < start + i * 577) await new Promise(r => setTimeout(r, 2));
    await p.mouse.down(); await p.mouse.up();
  }
  await p.waitForTimeout(150);
  await snap(p, lang);                                   // 03 : 4 frappes → 104
  await typeTempo(p, 104);                               // au cas où le TAP aurait dévié d'un BPM

  // 2. Accents : on repart des seuls temps (4/4), puis Dancing Queen
  await p.click('.chip:has-text("4/4")');
  for (const [i, n] of [[3, 2], [4, 1], [6, 2], [8, 1], [9, 2]]) {
    for (let k = 0; k < n; k++) await p.click(`.pt[data-i="${i}"]`);
  }
  await p.waitForTimeout(300);
  await snap(p, lang);                                   // 04 : le motif
  await p.click('#mute');
  await p.click('#play');
  await p.waitForTimeout(700);
  await freezeFlash(p, false);
  await snap(p, lang);                                   // 05 : muet, le flash continue
  await resume(p);
  await p.click('#play');
  await p.click('#mute');

  // 3. Setlist
  await p.click('#openLibrary');                         // s'ouvre sur le concert d'exemple en cours
  await p.click('#libBack');
  await p.waitForTimeout(300);
  await snap(p, lang);                                   // 06 : les concerts d'exemple, lien vers le guide
  await p.click(`.btn:has-text("${T.newConcert}")`);
  await p.waitForTimeout(200);   // le champ prend le focus après 50 ms
  await p.keyboard.type(T.concert);
  await p.click('.sheet .btn.primary');
  await p.click('.save-current');
  await p.waitForTimeout(200);   // le champ prend le focus après 50 ms
  await p.keyboard.type('Dancing Queen');
  await p.waitForTimeout(200);
  await snap(p, lang);                                   // 07 : enregistrer le réglage
  await p.click('.sheet .btn.primary');
  await p.waitForTimeout(2600);                          // fin du message
  await p.click('#libClose');
  await p.click('.chip:has-text("4/4")');
  await typeTempo(p, 168);
  await p.click('#songTitle');
  await p.click('.save-current');
  await p.waitForTimeout(200);   // le champ prend le focus après 50 ms
  await p.keyboard.type('Johnny B. Goode');
  await p.click('.sheet .btn.primary');
  await p.click(`.lib-foot .btn:has-text("${T.paste}")`);
  await p.waitForTimeout(200);
  // Le rock en premier (glisser ≡).
  const hb = await p.locator('#songRows li').nth(1).locator('.handle').boundingBox();
  const rb = await p.locator('#songRows li').nth(0).boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await p.mouse.down();
  for (let s = 1; s <= 10; s++) { await p.mouse.move(hb.x + hb.width / 2, hb.y + (rb.y + 10 - hb.y) * s / 10); await p.waitForTimeout(20); }
  await p.mouse.up();
  await p.waitForTimeout(2800);                          // fin du message
  await snap(p, lang);                                   // 08 : la setlist
  await p.click('#songRows li:nth-child(1) .row-main');
  await p.click('#next');
  await p.waitForTimeout(300);
  await snap(p, lang);                                   // 09 : sur scène, ‹ ›

  // 4. Partage
  await p.click('#songTitle');
  await p.click(`.lib-foot .btn:has-text("${T.share}")`);
  await p.waitForTimeout(400);
  await snap(p, lang);                                   // 10 : feuille de partage
  await p.click('.sheet .btn:last-child');               // Annuler
  const link1 = await shareLink(p, T.concert);

  const q = await phone(lang === 'fr' ? 'fr-FR' : 'en-US');
  await q.evaluate(h => { location.hash = h; }, new URL(link1).hash);
  await q.waitForSelector('.sheet .btn.primary');
  await q.waitForTimeout(300);
  await snap(q, lang);                                   // 11 : le batteur reçoit le lien
  await q.click('.sheet .btn.primary');
  await q.waitForTimeout(2800);                          // fin du message « importé »

  await p.click('#songRows li:nth-child(1) .row-more');
  await p.click(`.sheet .btn:has-text("${T.edit}")`);
  await p.fill('#songTempo', '176');
  await p.click('.sheet .btn.primary');
  await p.waitForTimeout(400);
  const link2 = await shareLink(p, T.concert);
  await q.evaluate(h => { location.hash = h; }, new URL(link2).hash);
  await q.waitForSelector('.sheet .btn.primary');
  await q.waitForTimeout(300);
  await snap(q, lang);                                   // 12 : mise à jour proposée

  await p.context().close();
  await q.context().close();
  console.log(`${lang} : ${shot} captures`);
}
await browser.close();
