# Vidéo de présentation

`klik-presentation.mp4` (vertical 1080×1920 pour smartphone, ~1 min 25, avec le son du métronome)
montre Klik en quatre temps : le tempo de référence (play tout de suite sur le 4/4 de base),
les accents (Dancing Queen dessiné en direct), une setlist qu'on fait jouer morceau par morceau
(Johnny B. Goode 168 → Dancing Queen 104 → Osez Joséphine 118), puis le partage avec le batteur.

Elle est filmée sur la vraie app : `stage.html` (dessinée en 720×1280, agrandie ×1,5) affiche deux téléphones (deux iframes de l'app,
sur deux origines pour avoir deux stockages séparés) avec les titres et l'indicateur de toucher ;
`record.mjs` pilote l'app avec Playwright, capture les images et note l'instant de chaque clic ;
`build.py` resynthétise les clics (mêmes réglages que `js/engine.js`) et assemble le MP4.

## Régénérer

```sh
python3 -m http.server 8765          # à la racine du dépôt
node video/record.mjs                # ~2 min, écrit video/out/
python3 video/build.py               # numpy + ffmpeg, écrit video/klik-presentation.mp4
```

Les textes à l'écran sont dans `record.mjs` (appels `caption`) et `stage.html` (intro, fin, légende).
