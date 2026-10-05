// Interface de Klik : écran principal, barre de tempo, bibliothèque de concerts, PWA.
(function (K) {
  'use strict';

  const S = K.store;
  const t = K.i18n.t;
  const q = text => t('quoted', { text });
  const E = K.engine;
  let version = '';   // fourni par le service worker (source unique : sw.js)

  const data = S.load();
  const cur = data.current;
  let levels = S.levels(cur.pattern);
  let playing = false;
  let wakeLock = null;
  let colors = {};

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const landscape = matchMedia('(orientation: landscape)');
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');

  const $ = s => document.querySelector(s);
  const ui = {
    sigs: $('#sigs'), openLib: $('#openLibrary'),
    song: $('#song'), prev: $('#prev'), next: $('#next'), title: $('#songTitle'),
    center: $('#center'), ring: $('#ring'), disc: $('#disc'), points: $('#points'),
    mute: $('#mute'), bpm: $('#bpm'), bpmInput: $('#bpmInput'), play: $('#play'),
    track: $('#track'), knob: $('#tap'), tapDots: $('#tapDots'),
    lib: $('#lib'), libTitle: $('#libTitle'), libBack: $('#libBack'), libClose: $('#libClose'),
    libBody: $('#libBody'), libFoot: $('#libFoot'),
    sheet: $('#sheet'), toast: $('#toast'), update: $('#update'),
  };

  /* ---------- utilitaires ---------- */

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  // Avant chaque sauvegarde : un concert dont le contenu a changé reçoit une nouvelle date de modification.
  function persist() {
    for (const c of data.concerts) {
      const fp = S.fingerprint(c);
      if (c.fp !== fp) { c.fp = fp; c.updatedAt = new Date().toISOString(); }
    }
    S.save(data);
  }
  const concertById = id => data.concerts.find(c => c.id === id) || null;
  const currentConcert = () => concertById(cur.concertId);
  const currentSong = () => {
    const c = currentConcert();
    return c ? c.songs.find(s => s.id === cur.songId) || null : null;
  };

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['accent', 'accent-ink', 'accent-soft', 'accent-glow', 'text-primary', 'border-strong']) {
      colors[k] = cs.getPropertyValue('--' + k).trim();
    }
  }

  let toastTimer;
  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2200);
  }

  /* ---------- rendu de l'écran principal ---------- */

  function renderSigs() {
    const custom = !S.isPreset(cur.signature);
    const chips = S.PRESETS.map(p => h('button', {
      type: 'button', class: 'chip',
      'aria-pressed': String(!custom && p.label === cur.signature.label),
      onclick: () => setSignature(p),
    }, p.label));
    if (custom) chips.push(h('span', { class: 'chip', 'aria-pressed': 'true', title: t('importedSignature') }, cur.signature.label));
    ui.sigs.replaceChildren(...chips);
  }

  function renderRing() {
    const { steps, stepsPerBeat } = cur.signature;
    ui.points.replaceChildren(...Array.from({ length: steps }, (_, i) => h('button', {
      type: 'button',
      class: 'pt' + (i % stepsPerBeat === 0 ? ' beat' : ''),
      style: `--a:${(i / steps) * 360}deg`,
      'data-i': i,
      'data-lvl': i === 0 ? 'down' : levels[i],
      'aria-label': i === 0 ? t('beatOne') : t('step', { n: i + 1 }),
      disabled: i === 0,
    }, h('span', { class: 'dot' }))));
  }

  function renderTempo() { ui.bpm.textContent = cur.tempo; }

  function renderMute() {
    ui.mute.textContent = data.muted ? '🔇' : '🔊';
    ui.mute.setAttribute('aria-label', data.muted ? t('soundOn') : t('soundOff'));
  }

  function renderPlay() {
    ui.play.classList.toggle('is-playing', playing);
    ui.play.setAttribute('aria-label', playing ? t('stop') : t('start'));
  }

  function renderSong() {
    const c = currentConcert();
    const s = currentSong();
    ui.title.replaceChildren(s
      ? h('span', { class: 'title-text' }, s.name)
      : h('span', { class: 'title-text muted' }, c ? t('freeSetting') : t('noConcert')));
    if (s && cur.dirty) ui.title.append(h('span', { class: 'dirty', title: t('modified') }, '•'));
    fitTitle();
    ui.prev.disabled = !c || !c.songs.length;
    ui.next.disabled = !c || !c.songs.length;
  }

  // Titre à côté du cercle (paysage) : on réduit la police jusqu'à ce que le mot le plus long tienne.
  function fitTitle() {
    const el = ui.title.querySelector('.title-text');
    ui.title.style.fontSize = '';
    if (!el || !ui.center.classList.contains('side-title')) return;
    let size = parseFloat(getComputedStyle(ui.title).fontSize);
    while (el.scrollWidth > el.clientWidth && size > 12) {
      size -= 1;
      ui.title.style.fontSize = size + 'px';
    }
  }

  function renderAll() {
    renderSigs();
    renderRing();
    renderTempo();
    renderMute();
    renderPlay();
    renderSong();
  }

  /* ---------- actions sur le réglage courant ---------- */

  function markDirty() {
    if (cur.songId && !cur.dirty) { cur.dirty = true; renderSong(); }
  }

  function setTempo(v) {
    const t = S.clampTempo(v);
    if (t === cur.tempo) return;
    cur.tempo = t;
    renderTempo();
    markDirty();
    persist();
  }

  function setSignature(p) {
    cur.signature = { ...p };
    cur.pattern = S.defaultPattern(p);
    levels = S.levels(cur.pattern);
    if (playing) E.resetBar();
    renderSigs();
    renderRing();
    markDirty();
    persist();
  }

  function cyclePoint(i) {
    if (i === 0) return;
    const lvl = (levels[i] + 1) % 3;
    levels[i] = lvl;
    cur.pattern = S.setLevel(cur.pattern, i, lvl);
    ui.points.children[i].dataset.lvl = lvl;
    markDirty();
    persist();
  }

  function loadSong(c, s) {
    cur.tempo = s.tempo;
    cur.signature = { ...s.signature };
    cur.pattern = s.pattern;
    cur.concertId = c.id;
    cur.songId = s.id;
    cur.dirty = false;
    levels = S.levels(cur.pattern);
    if (playing) E.resetBar();
    renderAll();
    persist();
  }

  function stepSong(dir) {
    const c = currentConcert();
    if (!c || !c.songs.length) return;
    const i = c.songs.findIndex(s => s.id === cur.songId);
    const j = i < 0 ? (dir > 0 ? 0 : c.songs.length - 1) : Math.max(0, Math.min(c.songs.length - 1, i + dir));
    if (j !== i) loadSong(c, c.songs[j]);
  }

  /* ---------- lecture ---------- */

  const engineState = () => ({
    tempo: cur.tempo,
    steps: cur.signature.steps,
    stepsPerBeat: cur.signature.stepsPerBeat,
    levels,
    muted: data.muted,
  });

  async function start() {
    try { await E.start(engineState); } catch (e) { toast(t('audioFailed')); return; }
    playing = true;
    readColors();
    renderPlay();
    requestAnimationFrame(frame);
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* facultatif */ }
    const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
    if (!standalone && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function stop() {
    E.stop();
    playing = false;
    renderPlay();
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  const toggle = () => (playing ? stop() : start());

  function frame() {
    if (!playing) return;
    for (const ev of E.drain()) hit(ev);
    requestAnimationFrame(frame);
  }

  // Plus petit écart, en points, entre deux coups joués du motif (le temps 1 compte toujours).
  function minGap() {
    const steps = cur.signature.steps;
    const on = [];
    for (let i = 0; i < steps; i++) if (i === 0 || levels[i]) on.push(i);
    let gap = steps;
    for (let k = 0; k < on.length; k++) {
      const d = ((on[(k + 1) % on.length] - on[k]) + steps) % steps || steps;
      if (d < gap) gap = d;
    }
    return gap;
  }

  function hit({ step, lvl }) {
    if (!lvl) return;
    // Le flash dure presque jusqu'au coup suivant le plus proche : un motif aéré (les seuls
    // temps à 60 BPM) garde un flash bien visible, un motif serré ne fait pas se chevaucher les flashs.
    const gapMs = minGap() * 60000 / cur.tempo / cur.signature.stepsPerBeat;
    const dur = Math.max(80, Math.min(600, gapMs * 0.85));
    if (lvl === 3) {
      ui.disc.animate([
        { background: colors.accent, color: colors['accent-ink'], borderColor: colors.accent },
        { background: 'rgba(0,0,0,0)', color: colors['text-primary'], borderColor: colors['border-strong'] },
      ], { duration: Math.min(dur * 1.6, Math.max(dur, 300)), easing: 'cubic-bezier(.2,.7,.3,1)' });
      return;
    }
    const ring = lvl === 2
      ? `0 0 0 12px ${colors.accent}, 0 0 48px 16px ${colors['accent-glow']}`
      : `0 0 0 5px ${colors['accent-soft']}, 0 0 22px 4px ${colors['accent-glow']}`;
    ui.disc.animate([
      { boxShadow: ring, borderColor: colors.accent },
      { boxShadow: '0 0 0 0 rgba(0,0,0,0), 0 0 0 0 rgba(0,0,0,0)', borderColor: colors['border-strong'] },
    ], { duration: dur, easing: 'ease-out' });
    const dot = ui.points.children[step] && ui.points.children[step].firstChild;
    if (dot) {
      dot.animate([
        { transform: reduceMotion.matches ? 'none' : 'scale(1.7)', boxShadow: `0 0 0 4px ${colors['accent-glow']}` },
        { transform: 'none', boxShadow: '0 0 0 0 rgba(0,0,0,0)' },
      ], { duration: dur * 1.3, easing: 'ease-out' });
    }
  }

  /* ---------- barre de tempo : TAP + glisser ---------- */

  let taps = [];
  let tapReset;
  function renderTapDots(n) {
    [...ui.tapDots.children].forEach((d, i) => d.classList.toggle('on', i < n));
  }
  function registerTap(t) {
    if (taps.length && t - taps[taps.length - 1] > 2000) taps = [];
    taps.push(t);
    if (taps.length > 8) taps.shift();
    // On n'accepte qu'à partir de 4 frappes régulières (3 intervalles à ±12 % de leur moyenne).
    if (taps.length >= 4) {
      const iv = [];
      for (let i = taps.length - 3; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
      const mean = (iv[0] + iv[1] + iv[2]) / 3;
      if (iv.every(v => Math.abs(v - mean) / mean < 0.12)) setTempo(60000 / mean);
    }
    renderTapDots(Math.min(taps.length, 4));
    clearTimeout(tapReset);
    tapReset = setTimeout(() => { taps = []; renderTapDots(0); }, 2000);
  }
  function cancelLastTap() {
    taps.pop();
    renderTapDots(Math.min(taps.length, 4));
  }

  const DEADZONE = 0.1;
  let drag = null;

  function dragLoop(t) {
    if (!drag || !drag.active) return;
    const dt = Math.min(0.1, (t - drag.last) / 1000);
    drag.last = t;
    const a = Math.abs(drag.d);
    if (a > DEADZONE) {
      if (!drag.inZone) { drag.inZone = true; drag.acc = 1; }   // premier pas immédiat
      // Courbe : ~3 BPM/s près du centre (pas à pas), jusqu'à ~12 BPM/s en bout de barre.
      const x = (a - DEADZONE) / (1 - DEADZONE);
      drag.acc += (3 + 9 * x * x) * dt;
      while (drag.acc >= 1) { drag.acc -= 1; setTempo(cur.tempo + Math.sign(drag.d)); }
    } else {
      drag.inZone = false;
      drag.acc = 0;
    }
    requestAnimationFrame(dragLoop);
  }

  ui.knob.addEventListener('pointerdown', e => {
    e.preventDefault();
    ui.knob.setPointerCapture(e.pointerId);
    registerTap(performance.now());
    drag = { x: e.clientX, y: e.clientY, active: false, d: 0, acc: 0, inZone: false, last: performance.now() };
  });
  ui.knob.addEventListener('pointermove', e => {
    if (!drag) return;
    const vertical = landscape.matches;
    const delta = vertical ? drag.y - e.clientY : e.clientX - drag.x;
    if (!drag.active && Math.abs(delta) > 12) {
      drag.active = true;
      drag.last = performance.now();
      cancelLastTap();
      ui.knob.classList.add('dragging');
      requestAnimationFrame(dragLoop);
    }
    if (!drag.active) return;
    const tr = ui.track.getBoundingClientRect();
    const kn = ui.knob.getBoundingClientRect();
    const half = vertical ? (tr.height - kn.height) / 2 - 6 : (tr.width - kn.width) / 2 - 6;
    const off = Math.max(-half, Math.min(half, delta));
    drag.d = off / half;
    ui.knob.style.transform = vertical ? `translateY(${-off}px)` : `translateX(${off}px)`;
  });
  function endDrag() {
    if (!drag) return;
    drag = null;
    ui.knob.classList.remove('dragging');
    ui.knob.style.transform = '';
  }
  ui.knob.addEventListener('pointerup', endDrag);
  ui.knob.addEventListener('pointercancel', endDrag);
  ui.knob.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); registerTap(performance.now()); }
  });

  /* ---------- bibliothèque : concerts et morceaux ---------- */

  let libView = { name: 'concerts', concertId: null };

  function openLibrary() {
    const c = currentConcert();
    libView = c ? { name: 'concert', concertId: c.id } : { name: 'concerts', concertId: null };
    ui.lib.hidden = false;
    renderLib();
  }
  function closeLibrary() {
    closeSheet();
    ui.lib.hidden = true;
  }
  function renderLib() {
    const c = libView.name === 'concert' && concertById(libView.concertId);
    if (c) renderConcertView(c); else renderConcertsView();
  }

  function footButton(label, run, kind) {
    return h('button', { type: 'button', class: 'btn ' + (kind || ''), onclick: run }, label);
  }

  function renderConcertsView() {
    libView = { name: 'concerts', concertId: null };
    ui.libBack.hidden = true;
    ui.libTitle.textContent = t('concerts');
    const rows = data.concerts.map(c => h('li', { class: 'row' + (c.id === cur.concertId ? ' is-current' : '') },
      h('button', {
        type: 'button', class: 'row-main',
        onclick: () => { libView = { name: 'concert', concertId: c.id }; renderLib(); },
      }, h('span', { class: 'row-name' }, c.name), h('span', { class: 'row-meta' }, t('songCount', c.songs.length))),
      h('button', { type: 'button', class: 'row-more', 'aria-label': t('actionsFor', { name: c.name }), onclick: () => concertActions(c) }, '⋯'),
    ));
    ui.libBody.replaceChildren(
      rows.length ? h('ul', { class: 'rows' }, rows) : h('p', { class: 'empty' }, t('noConcerts')),
      h('p', { class: 'version' }, version ? `Klik ${version}` : 'Klik'),
    );
    ui.libFoot.replaceChildren(
      footButton(t('newConcert'), newConcert, 'primary'),
      footButton(t('paste'), pasteFlow),
    );
  }

  function renderConcertView(c) {
    ui.libBack.hidden = false;
    ui.libTitle.textContent = c.name;
    const rows = c.songs.map((s, i) => h('li', { class: 'row' + (s.id === cur.songId ? ' is-current' : ''), 'data-id': s.id },
      h('span', { class: 'handle', 'aria-hidden': 'true', onpointerdown: e => startReorder(e, c) }, '≡'),
      h('button', {
        type: 'button', class: 'row-main',
        onclick: () => { loadSong(c, s); closeLibrary(); },
      },
      s.section && s.section !== (c.songs[i - 1] || {}).section ? h('span', { class: 'row-section' }, s.section) : null,
      h('span', { class: 'row-name' }, h('span', { class: 'row-num' }, i + 1), s.name),
      h('span', { class: 'row-meta' }, [`${s.tempo} BPM`, s.signature.label, s.duration, s.artist].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'row-more', 'aria-label': t('actionsFor', { name: s.name }), onclick: () => songActions(c, s) }, '⋯'),
    ));
    ui.libBody.replaceChildren(
      h('button', { type: 'button', class: 'save-current', onclick: () => saveCurrentForm(c) },
        h('strong', {}, t('saveCurrent')),
        h('span', {}, `${cur.tempo} BPM · ${cur.signature.label} · ${cur.pattern}`)),
      rows.length ? h('ul', { class: 'rows', id: 'songRows' }, rows) : h('p', { class: 'empty' }, t('emptyConcert')),
    );
    ui.libFoot.replaceChildren(
      footButton(t('share'), () => shareSheet(S.exportConcert(c), c.name)),
      footButton(t('paste'), pasteFlow),
    );
  }

  /* ----- glisser-déposer pour l'ordre du concert ----- */

  function startReorder(e, c) {
    e.preventDefault();
    const row = e.currentTarget.closest('li');
    const list = row.parentNode;
    const id = e.pointerId;
    // Écoute sur document : déplacer la ligne dans le DOM ferait perdre la capture du pointeur.
    row.classList.add('dragging');
    let lastY = e.clientY;
    const place = () => {
      const others = [...list.children].filter(r => r !== row);
      const after = others.find(r => { const b = r.getBoundingClientRect(); return lastY < b.top + b.height / 2; }) || null;
      if (after !== row.nextSibling) list.insertBefore(row, after);
    };
    const autoscroll = setInterval(() => {
      const b = ui.libBody.getBoundingClientRect();
      const v = lastY < b.top + 56 ? -8 : lastY > b.bottom - 56 ? 8 : 0;
      if (v) { ui.libBody.scrollTop += v; place(); }
    }, 16);
    const move = ev => { if (ev.pointerId !== id) return; ev.preventDefault(); lastY = ev.clientY; place(); };
    const up = ev => {
      if (ev.pointerId !== id) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      clearInterval(autoscroll);
      row.classList.remove('dragging');
      const ids = [...list.children].map(r => r.dataset.id);
      c.songs = ids.map(sid => c.songs.find(s => s.id === sid));
      persist();
      renderLib();
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  /* ----- feuilles (menus, formulaires, confirmations) ----- */

  function openSheet(title, content, actions) {
    const panel = h('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', {}, title),
      content,
      h('div', { class: 'sheet-actions' }, actions.map(a => h('button', {
        type: a.submit ? 'submit' : 'button',
        class: 'btn ' + (a.kind || ''),
        onclick: a.submit ? null : a.run,
      }, a.label))));
    ui.sheet.replaceChildren(panel);
    ui.sheet.hidden = false;
    return panel;
  }
  function closeSheet() {
    ui.sheet.hidden = true;
    ui.sheet.replaceChildren();
  }
  ui.sheet.addEventListener('click', e => { if (e.target === ui.sheet) closeSheet(); });

  function menu(title, items) {
    openSheet(title, null, [...items.filter(Boolean), { label: t('cancel'), run: closeSheet }]);
  }

  function form(title, fields, submitLabel, onSubmit) {
    const f = h('form', { class: 'sheet-form', novalidate: true },
      fields.map(fd => h('label', { class: 'field', for: fd.id },
        h('span', {}, fd.label),
        h('input', {
          id: fd.id, name: fd.id, type: fd.type || 'text', value: fd.value == null ? '' : String(fd.value),
          min: fd.min, max: fd.max, inputmode: fd.inputmode, placeholder: fd.placeholder, autocomplete: 'off',
        }))),
      h('p', { class: 'form-error', role: 'alert' }));
    const panel = openSheet(title, f, [{ label: submitLabel, kind: 'primary', submit: true }, { label: t('cancel'), run: closeSheet }]);
    // Le bouton « valider » est dans les actions : on les déplace dans le formulaire.
    f.append(panel.querySelector('.sheet-actions'));
    f.addEventListener('submit', ev => {
      ev.preventDefault();
      const values = Object.fromEntries(fields.map(fd => [fd.id, f.elements[fd.id].value.trim()]));
      const err = onSubmit(values);
      if (err) f.querySelector('.form-error').textContent = err;
    });
    setTimeout(() => f.elements[fields[0].id].focus(), 50);
  }

  function confirmDelete(what, run) {
    openSheet(t('deleteTitle', { what }), h('p', { class: 'sheet-text' }, t('deleteWarning')), [
      { label: t('delete'), kind: 'danger', run: () => { run(); closeSheet(); } },
      { label: t('cancel'), run: closeSheet },
    ]);
  }

  /* ----- concerts ----- */

  function newConcert() {
    form(t('newConcert'), [{ id: 'concertName', label: t('name'), placeholder: t('concertPlaceholder') }], t('create'), v => {
      if (!v.concertName) return t('concertNameMissing');
      const c = { id: S.uid(), name: v.concertName.slice(0, 80), songs: [] };
      data.concerts.push(c);
      persist();
      closeSheet();
      libView = { name: 'concert', concertId: c.id };
      renderLib();
    });
  }

  function concertActions(c) {
    menu(c.name, [
      { label: t('rename'), run: () => form(t('renameConcert'), [{ id: 'concertName', label: t('name'), value: c.name }], t('rename'), v => {
        if (!v.concertName) return t('nameEmpty');
        c.name = v.concertName.slice(0, 80);
        persist(); closeSheet(); renderLib();
      }) },
      { label: t('share'), run: () => shareSheet(S.exportConcert(c), c.name) },
      { label: t('copyJson'), run: () => { closeSheet(); copyJson(S.exportConcert(c)); } },
      data.previous && data.previous.concert.id === c.id ? { label: t('restorePrevious'), run: () => {
        closeSheet();
        const prev = data.previous.concert;
        replaceConcert(c, prev);
        persist();
        showConcert(prev.id);
        toast(t('restored'));
      } } : null,
      { label: t('delete'), kind: 'danger', run: () => confirmDelete(q(c.name), () => {
        data.concerts = data.concerts.filter(x => x !== c);
        if (cur.concertId === c.id) { cur.concertId = null; cur.songId = null; cur.dirty = false; renderSong(); }
        persist(); renderLib();
      }) },
    ]);
  }

  /* ----- morceaux ----- */

  function tempoError(v) {
    const t = Number(v);
    if (!Number.isFinite(t) || t < S.MIN_TEMPO || t > S.MAX_TEMPO) return t('tempoRange', { min: S.MIN_TEMPO, max: S.MAX_TEMPO });
    return null;
  }

  function saveCurrentForm(c) {
    form(t('saveSetting'), [
      { id: 'songName', label: t('songName'), placeholder: t('songPlaceholder') },
      { id: 'songTempo', label: t('tempoField'), type: 'number', inputmode: 'numeric', value: cur.tempo, min: S.MIN_TEMPO, max: S.MAX_TEMPO },
    ], t('save'), v => {
      if (!v.songName) return t('songNameMissing');
      const err = tempoError(v.songTempo);
      if (err) return err;
      const s = S.normSong({ name: v.songName, tempo: Number(v.songTempo), signature: cur.signature, pattern: cur.pattern });
      c.songs.push(s);
      loadSong(c, s);
      closeSheet();
      renderLib();
      toast(t('songAdded', { song: s.name, concert: c.name }));
    });
  }

  function songActions(c, s) {
    menu(s.name, [
      { label: t('editSongAction'), run: () => form(t('editSong'), [
        { id: 'songName', label: t('songName'), value: s.name },
        { id: 'songTempo', label: t('tempoField'), type: 'number', inputmode: 'numeric', value: s.tempo, min: S.MIN_TEMPO, max: S.MAX_TEMPO },
      ], t('save'), v => {
        if (!v.songName) return t('nameEmpty');
        const err = tempoError(v.songTempo);
        if (err) return err;
        s.name = v.songName.slice(0, 80);
        s.tempo = S.clampTempo(Number(v.songTempo));
        if (cur.songId === s.id) loadSong(c, s);
        persist(); closeSheet(); renderLib();
      }) },
      { label: t('replaceWithCurrent'), run: () => {
        s.tempo = cur.tempo;
        s.signature = { ...cur.signature };
        s.pattern = cur.pattern;
        if (cur.songId === s.id) { cur.dirty = false; renderSong(); }
        persist(); closeSheet(); renderLib();
        toast(t('songUpdated', { song: s.name }));
      } },
      { label: t('copyToConcert'), run: () => copyToConcert(s) },
      { label: t('share'), run: () => shareSheet(S.exportSong(s), s.name) },
      { label: t('copyJson'), run: () => { closeSheet(); copyJson(S.exportSong(s)); } },
      { label: t('delete'), kind: 'danger', run: () => confirmDelete(q(s.name), () => {
        c.songs = c.songs.filter(x => x !== s);
        if (cur.songId === s.id) { cur.songId = null; cur.dirty = false; renderSong(); }
        persist(); renderLib();
      }) },
    ]);
  }

  function copyToConcert(s) {
    menu(t('copyTo'), data.concerts.map(target => ({
      label: target.name,
      run: () => {
        target.songs.push({ ...S.normSong(S.exportSong(s, false)) });
        persist(); closeSheet(); renderLib();
        toast(t('copyAdded', { concert: target.name }));
      },
    })));
  }

  /* ----- JSON : copier / coller ----- */

  async function copyText(text, done, title) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch (e) {
      const ta = h('textarea', { class: 'json', id: 'jsonOut', readonly: true, rows: 10 });
      ta.value = text;
      openSheet(title, ta, [{ label: t('close'), run: closeSheet }]);
      setTimeout(() => { ta.focus({ preventScroll: true }); ta.select(); }, 50);
    }
  }
  const copyJson = obj => copyText(S.stringify(obj), t('jsonCopied'), t('copyJson'));

  // Partage par lien : feuille de partage du téléphone si disponible, sinon copie du lien.
  async function shareSheet(obj, name) {
    closeSheet();
    let url;
    try { url = location.href.split('#')[0] + '#k=' + await S.encodeShare(obj); } catch (e) { toast(e.message); return; }
    const text = t('shareText', { name });
    const actions = [];
    if (navigator.share) {
      actions.push({ label: t('shareSend'), kind: 'primary', run: async () => {
        try { await navigator.share({ title: text, url }); closeSheet(); } catch (e) { /* partage annulé */ }
      } });
    }
    actions.push({ label: t('shareCopyLink'), kind: navigator.share ? '' : 'primary', run: () => { closeSheet(); copyText(url, t('linkCopied'), t('shareCopyLink')); } });
    actions.push({ label: t('copyJson'), run: () => { closeSheet(); copyJson(obj); } });
    actions.push({ label: t('cancel'), run: closeSheet });
    openSheet(t('shareTitle', { name }), h('p', { class: 'sheet-text' }, t('shareHint')), actions);
  }

  // Texte collé : JSON, ou lien de partage Klik (ou message contenant ce lien).
  async function parseImport(text) {
    const token = S.shareToken(text);
    return S.parse(token ? await S.decodeShare(token) : text);
  }

  function showConcert(id) {
    libView = { name: 'concert', concertId: id };
    ui.lib.hidden = false;
    renderLib();
  }

  const formatDate = iso => iso
    ? new Date(iso).toLocaleString(K.i18n.lang, { dateStyle: 'short', timeStyle: 'short' })
    : t('unknownDate');

  // Remplace un concert par une autre version, en gardant l'ancienne pour pouvoir revenir en arrière.
  function replaceConcert(local, incoming) {
    data.previous = { concert: JSON.parse(JSON.stringify(local)) };
    data.concerts[data.concerts.indexOf(local)] = incoming;
    if (cur.concertId === incoming.id) {
      const old = local.songs.find(s => s.id === cur.songId);
      const match = old && incoming.songs.find(s => s.name === old.name);
      cur.songId = match ? match.id : null;
      renderSong();
    }
  }

  function updateSheet(local, incoming) {
    if (S.fingerprint(local) === incoming.fp) {
      toast(t('alreadyUpToDate', { name: local.name }));
      showConcert(local.id);
      return;
    }
    const older = local.updatedAt && incoming.updatedAt && incoming.updatedAt < local.updatedAt;
    openSheet(t('concertExists', { name: local.name }), h('div', { class: 'sheet-text' },
      h('p', {}, t('versionYours', { songs: t('songCount', local.songs.length), date: formatDate(local.updatedAt) })),
      h('p', {}, t('versionReceived', { songs: t('songCount', incoming.songs.length), date: formatDate(incoming.updatedAt) })),
      older ? h('p', { class: 'warn' }, t('receivedOlder')) : null,
    ), [
      { label: t('updateConcert'), kind: older ? 'danger' : 'primary', run: () => {
        closeSheet();
        replaceConcert(local, incoming);
        persist();
        showConcert(incoming.id);
        toast(t('concertUpdated', { name: incoming.name }));
      } },
      { label: t('keepBoth'), run: () => {
        closeSheet();
        incoming.id = S.uid();
        data.concerts.push(incoming);
        persist();
        showConcert(incoming.id);
        toast(t('concertImported', { name: incoming.name }));
      } },
      { label: t('cancel'), run: closeSheet },
    ]);
  }

  function applyImport(r) {
    if (r.type === 'concert') {
      // L'empreinte est posée avant la sauvegarde : la date de modification reçue est conservée.
      r.concert.fp = S.fingerprint(r.concert);
      if (!r.concert.updatedAt) r.concert.updatedAt = new Date().toISOString();
      const existing = data.concerts.find(c => c.id === r.concert.id);
      if (existing) { updateSheet(existing, r.concert); return; }
      data.concerts.push(r.concert);
      libView = { name: 'concert', concertId: r.concert.id };
      toast(t('concertImported', { name: r.concert.name }));
    } else {
      const target = (libView.name === 'concert' && concertById(libView.concertId)) || currentConcert();
      if (!target) throw new S.FormatError(t('openConcertFirst'));
      target.songs.push(r.song);
      libView = { name: 'concert', concertId: target.id };
      toast(t('songAdded', { song: r.song.name, concert: target.name }));
    }
    persist();
    renderLib();
  }

  async function pasteFlow() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { /* lecture refusée : on passe par la zone de texte */ }
    if (text) {
      try { applyImport(await parseImport(text)); return; } catch (e) { openPasteSheet(text, e.message); return; }
    }
    openPasteSheet('', '');
  }

  function openPasteSheet(text, error) {
    const ta = h('textarea', { class: 'json', id: 'jsonIn', rows: 10, placeholder: t('pastePlaceholder'), spellcheck: 'false' });
    ta.value = text;
    const err = h('p', { class: 'form-error', role: 'alert' }, error || '');
    openSheet(t('pasteTitle'), h('div', {}, ta, err), [
      { label: t('import'), kind: 'primary', run: async () => {
        let r;
        try { r = await parseImport(ta.value); } catch (e) { err.textContent = e.message; return; }
        closeSheet();
        try { applyImport(r); } catch (e) { toast(e.message); }
      } },
      { label: t('cancel'), run: closeSheet },
    ]);
    setTimeout(() => ta.focus({ preventScroll: true }), 50);
  }

  // Ouverture d'un lien de partage : on propose l'import, puis on retire le jeton de l'adresse.
  async function importFromLink() {
    const token = S.shareToken(location.hash);
    if (!token) return;
    history.replaceState(null, '', location.pathname + location.search);
    let r;
    try { r = S.parse(await S.decodeShare(token)); } catch (e) { toast(e.message); return; }
    // Concert déjà présent : on passe directement au choix de mise à jour.
    if (r.type === 'concert' && data.concerts.some(c => c.id === r.concert.id)) { applyImport(r); return; }
    const name = r.type === 'concert' ? r.concert.name : r.song.name;
    const detail = r.type === 'concert'
      ? t('songCount', r.concert.songs.length)
      : `${r.song.tempo} BPM · ${r.song.signature.label}`;
    openSheet(t('importTitle', { name }), h('p', { class: 'sheet-text' }, detail), [
      { label: t('import'), kind: 'primary', run: () => {
        closeSheet();
        try { applyImport(r); ui.lib.hidden = false; } catch (e) { toast(e.message); }
      } },
      { label: t('cancel'), run: closeSheet },
    ]);
  }

  /* ---------- liaisons ---------- */

  // Un toucher lance ou arrête, deux touchers rapprochés ouvrent la saisie du tempo.
  let bpmTapTimer = null;
  ui.bpm.addEventListener('click', () => {
    if (bpmTapTimer) {
      clearTimeout(bpmTapTimer);
      bpmTapTimer = null;
      editTempo();
      return;
    }
    bpmTapTimer = setTimeout(() => { bpmTapTimer = null; toggle(); }, 280);
  });

  function editTempo() {
    ui.bpmInput.value = cur.tempo;
    ui.bpm.hidden = true;
    ui.bpmInput.hidden = false;
    ui.bpmInput.focus({ preventScroll: true });
    ui.bpmInput.select();
  }
  function closeTempoEdit(commit) {
    if (ui.bpmInput.hidden) return;
    const v = Number(ui.bpmInput.value);
    ui.bpmInput.hidden = true;
    ui.bpm.hidden = false;
    if (commit && ui.bpmInput.value !== '' && Number.isFinite(v)) setTempo(v);
  }
  ui.bpmInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); closeTempoEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeTempoEdit(false); }
  });
  ui.bpmInput.addEventListener('blur', () => closeTempoEdit(true));
  ui.play.addEventListener('click', toggle);
  ui.mute.addEventListener('click', () => { data.muted = !data.muted; renderMute(); persist(); });
  ui.points.addEventListener('click', e => {
    const pt = e.target.closest('.pt');
    if (pt) cyclePoint(Number(pt.dataset.i));
  });
  ui.prev.addEventListener('click', () => stepSong(-1));
  ui.next.addEventListener('click', () => stepSong(1));
  ui.title.addEventListener('click', openLibrary);
  ui.openLib.addEventListener('click', openLibrary);
  ui.libClose.addEventListener('click', closeLibrary);
  ui.libBack.addEventListener('click', renderConcertsView);

  document.addEventListener('keydown', e => {
    if (!ui.lib.hidden || e.target.closest('input, textarea')) {
      if (e.key === 'Escape') { if (!ui.sheet.hidden) closeSheet(); else closeLibrary(); }
      return;
    }
    if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setTempo(cur.tempo + 1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setTempo(cur.tempo - 1);
  });

  document.addEventListener('visibilitychange', async () => {
    if (playing && document.visibilityState === 'visible' && !wakeLock) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* facultatif */ }
    }
  });
  darkScheme.addEventListener('change', readColors);

  // Taille du cercle : le plus grand carré qui tient sous le titre.
  // Taille du cercle : le plus grand carré possible. En paysage, s'il reste assez de place
  // à côté du cercle, le titre y passe et le cercle prend toute la hauteur.
  new ResizeObserver(() => {
    const r = ui.center.getBoundingClientRect();
    const full = Math.min(r.width, r.height);
    const side = landscape.matches && (r.width - full) / 2 >= 110;
    ui.center.classList.toggle('side-title', side);
    const size = side ? full : Math.min(r.width, r.height - ui.song.offsetHeight - 8);
    ui.center.style.setProperty('--ring', `${Math.floor(Math.max(180, Math.min(size, 720)))}px`);
    fitTitle();
  }).observe(ui.center);

  // Pas de zoom : Safari iOS ignore user-scalable=no, on bloque donc les gestes de pincement.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  }
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // Si le clavier ou le navigateur a fait défiler la page, on la remet en place.
  const resetScroll = () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); };
  window.addEventListener('scroll', resetScroll);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resetScroll);

  K.i18n.applyStatic(document);
  // Exemples intégrés encore intacts : dans la langue de l'utilisateur.
  const remap = S.localizeBuiltins(data.concerts);
  if (remap[cur.concertId] && remap[cur.concertId][cur.songId]) cur.songId = remap[cur.concertId][cur.songId];
  if (Object.keys(remap).length) S.save(data);

  // Concerts créés avant les dates de modification : on les date d'aujourd'hui.
  for (const c of data.concerts) {
    if (!c.fp) c.fp = S.fingerprint(c);
    if (!c.updatedAt) c.updatedAt = new Date().toISOString();
  }

  readColors();
  renderAll();
  importFromLink();
  window.addEventListener('hashchange', importFromLink);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- PWA : service worker et mises à jour ---------- */

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    let reloading = false;
    const reload = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    // updateViaCache: 'none' : le navigateur vérifie toujours sw.js sur le serveur, jamais dans son cache.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      const offer = worker => {
        ui.update.hidden = false;
        ui.update.onclick = () => {
          // On masque le bandeau tout de suite, on active la nouvelle version, puis on recharge
          // dès qu'elle est active (ou au bout de 3 s si le navigateur ne le signale pas).
          ui.update.hidden = true;
          worker.addEventListener('statechange', () => { if (worker.state === 'activated') reload(); });
          worker.postMessage('skipWaiting');
          setTimeout(reload, 3000);
        };
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
    // Premier lancement : le service worker prend la main sans qu'il y ait de mise à jour à charger.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reload(); });
    // Numéro de version affiché dans la liste, demandé au service worker actif.
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.version) version = e.data.version;
    });
    navigator.serviceWorker.ready.then(reg => { if (reg.active) reg.active.postMessage('version'); });
  }
})(self.Klik = self.Klik || {});
