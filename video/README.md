# Vidéo de présentation

`klik-presentation.mp4` (1920×1080, ~2 min, avec le son du métronome) montre Klik en quatre temps :
créer un pattern, les accents, construire une setlist, partager un concert avec le groupe.

Elle est filmée sur la vraie app : `stage.html` affiche deux téléphones (deux iframes de l'app,
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
