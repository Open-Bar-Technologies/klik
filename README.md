# Klik

Tempo de référence pour le groupe avant chaque morceau, avec une setlist par concert.
Klik est une PWA : elle s'installe sur l'écran d'accueil et fonctionne sans réseau.

## Utilisation

- **Cercle central** : toucher le tempo ou ▶ lance et arrête. Toucher deux fois le tempo permet de le saisir au clavier. 🔊 coupe le son, mais le flash visuel continue.
- **Points autour du cercle** : une mesure complète. Toucher un point le fait passer de rien à moyen, puis à fort, puis de nouveau à rien. Le losange du haut est le temps 1 : il fait flasher tout le cercle.
- **Signatures** : 2/4, 3/4, 4/4, 6/8. Choisir une signature remet le motif à « temps forts + croches ».
- **Barre de tempo** :
  - toucher TAP au moins 4 fois avec un rythme régulier pour fixer le tempo ;
  - maintenir TAP et glisser pour changer le tempo, plus vite quand on pousse plus loin ;
  - en paysage, la barre est verticale : on monte pour accélérer.
- **Titre du morceau** : ‹ et › passent au morceau précédent ou suivant du concert. Toucher le titre ouvre la liste.
- **Liste ☰** : concerts et morceaux. On peut enregistrer le réglage actuel, réordonner les morceaux en glissant ≡, et copier ou coller du JSON (voir [FORMAT.md](FORMAT.md)).

## Fichiers

| Fichier                | Rôle |
| ---------------------- | ---- |
| `index.html`           | Structure de l'écran |
| `css/app.css`          | Styles et variables du design system (`--surface-0`, `--text-primary`, `--border-strong`…) |
| `js/store.js`          | Format JSON, validation, stockage local, migrations |
| `js/engine.js`         | Planification audio (Web Audio) |
| `js/app.js`            | Interface |
| `sw.js`                | Service worker (hors-ligne, mises à jour) |
| `version.js`           | **Numéro de version unique** |

## Versions et mises à jour

1. **Toute modification publiée doit incrémenter `version.js`.** Le nom du cache du service worker en dépend. Sans changement de version, les téléphones gardent l'ancienne app en cache.
2. Au lancement suivant, la nouvelle version s'installe en arrière-plan, puis un bandeau « Nouvelle version disponible · Mettre à jour » apparaît. L'app ne se recharge jamais d'elle-même en plein concert.
3. Les données locales ont leur propre numéro de schéma (`SCHEMA` dans `js/store.js`). Si leur structure change, il faut incrémenter `SCHEMA` et ajouter une entrée dans `migrations`. Une version plus ancienne de l'app ne réécrit jamais des données plus récentes : elle les met de côté.
4. Le format d'échange JSON a son propre numéro (`klik` dans le JSON, `FORMAT` dans `js/store.js`).

## Déploiement sur GitHub Pages

Dans **Settings → Pages**, choisir **Deploy from a branch**, branche `main`, dossier `/ (root)`.
L'app sera servie sur `https://<compte>.github.io/klik/`. Tous les chemins sont relatifs, donc elle marche dans ce sous-dossier.

## Développement local

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```
