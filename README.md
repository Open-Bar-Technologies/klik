# Klik

Tempo de référence pour le groupe avant chaque morceau, avec une setlist par concert.
Klik est une PWA : elle s'installe sur l'écran d'accueil et fonctionne sans réseau.
L'interface est en français ou en anglais selon la langue du navigateur.
Guide illustré, imprimable, en français et en anglais : [guide.html](guide.html), avec la vidéo de présentation (4 min). Dans l'app, le lien « Comment ça marche ? » est en bas de la liste des concerts.

## Utilisation

- **Cercle central** : toucher le tempo ou ▶ lance et arrête. Toucher deux fois le tempo permet de le saisir au clavier. L'icône haut-parleur au-dessus du tempo coupe le son, mais le flash visuel continue.
- **Points autour du cercle** : une mesure complète. Toucher un point le fait passer de rien à moyen, puis à fort, puis de nouveau à rien. Le losange du haut est le temps 1 : il fait flasher tout le cercle.
- **Signatures** : 2/4, 3/4, 4/4, 6/8. Choisir une signature remet le motif à ses seuls temps (2, 3, 4, ou 6 croches en 6/8). Une clave (motif sur 2 mesures) s'écrit en 4/4 avec le tempo divisé par 2.
- **Barre de tempo** :
  - toucher TAP au moins 4 fois avec un rythme régulier pour fixer le tempo ;
  - maintenir TAP et glisser pour changer le tempo, plus vite quand on pousse plus loin ;
  - en paysage, la barre est verticale : on monte pour accélérer.
- **Titre du morceau** : ‹ et › passent au morceau précédent ou suivant du concert. Toucher le titre ouvre la liste.
- **Liste ☰** : concerts et morceaux. On peut enregistrer le réglage actuel, réordonner les morceaux en glissant ≡, et copier ou coller du JSON (voir [FORMAT.md](FORMAT.md)).
- **Partager** un concert ou un morceau : Klik crée un lien qui contient toute la setlist (compressée dans l'ancre `#k=…`, rien n'est envoyé à un serveur). On l'envoie avec la feuille de partage du téléphone (WhatsApp, SMS, mail…). La personne qui le reçoit l'ouvre, ou le copie et touche « Coller » dans Klik. Sur iPhone, un lien s'ouvre dans Safari et pas dans l'app installée sur l'écran d'accueil, qui a ses propres données : il vaut mieux copier le lien et le coller dans l'app.
- **Setlists partagées** (seulement quand Klik est servi par son serveur, voir plus bas) : « Publier sur le serveur » dans le menu ⋯ d'un concert, et « Setlists partagées » en haut de la liste des concerts pour récupérer ce que le groupe a publié. Chaque publication est gardée : « Versions précédentes » permet de récupérer une version antérieure. Si quelqu'un a publié entre-temps, Klik prévient avant de publier par-dessus. « Retirer de la liste » masque une setlist sans rien effacer.
  Klik demande un **pseudo** (une fois, modifiable en bas des setlists partagées) : il est enregistré dans le concert (`updatedBy`) à chaque modification, et affiché (« publiée le … par Sam »). Quand un concert récupéré sur le serveur a une nouvelle version, un bandeau « Nouvelle version sur le serveur » apparaît en haut du concert (et un message au lancement si c'est le concert en cours).

## Fichiers

| Fichier                | Rôle |
| ---------------------- | ---- |
| `index.html`           | Structure de l'écran |
| `css/app.css`          | Styles et variables du design system (`--surface-0`, `--text-primary`, `--border-strong`…) |
| `js/i18n.js`           | Textes français et anglais (choix selon la langue du navigateur) |
| `js/store.js`          | Format JSON, validation, stockage local, migrations |
| `js/engine.js`         | Planification audio (Web Audio) |
| `js/app.js`            | Interface |
| `sw.js`                | Service worker (hors-ligne, mises à jour) |
| `server/`              | Serveur Node (sans dépendance) : sert l'app et l'API des setlists partagées. Tests : `npm test` |
| `Dockerfile`, `docker-compose.yml` | Container pour Coolify (voir plus bas) |
| `guide.html`, `guide/` | Guide illustré (FR/EN, imprimable), disponible hors-ligne. Captures : `node video/guide-shots.mjs` |
| `sw.js` → `VERSION`    | **Numéro de version unique** |

## Versions et mises à jour

1. **Toute modification publiée doit incrémenter `VERSION` en haut de `sw.js`.** Le nom du cache en dépend, et c'est la modification de ce fichier qui signale une nouvelle version aux téléphones. Sans changement de version, ils gardent l'ancienne app en cache.
2. Au lancement suivant, la nouvelle version s'installe en arrière-plan, puis un bandeau « Nouvelle version disponible · Mettre à jour » apparaît. L'app ne se recharge jamais d'elle-même en plein concert.
3. Les données locales ont leur propre numéro de schéma (`SCHEMA` dans `js/store.js`). Si leur structure change, il faut incrémenter `SCHEMA` et ajouter une entrée dans `migrations`. Une version plus ancienne de l'app ne réécrit jamais des données plus récentes : elle les met de côté.
4. Le format d'échange JSON a son propre numéro (`klik` dans le JSON, `FORMAT` dans `js/store.js`).

## Icône et aperçu des liens

- `icons/icon.svg` est la source de l'icône. Les PNG (`icon-192`, `icon-512`, `apple-touch-icon`, `favicon-32`) en sont tirés.
- `icons/og.png` (1200×630) est l'image d'aperçu affichée quand on colle l'adresse de Klik dans une messagerie.
- Les balises d'aperçu de `index.html` (`og:image`, `og:url`, `canonical`) pointent vers `https://klik.lonoize.com/`. Si le site change d'adresse, il faut les modifier.

## Cache devant le site (Cloudflare, proxy)

Un cache intermédiaire qui garde `sw.js` empêche les téléphones de voir les nouvelles versions :
Cloudflare met en cache les `.js`, `.css` et les images (pas le HTML), pendant 2 h par défaut quand le serveur
n'envoie pas d'en-tête `Cache-Control`. Il faut donc :

- soit une règle de cache Cloudflare « Bypass cache » pour `sw.js` (ou pour tout le site, qui est petit) ;
- soit que le serveur envoie `Cache-Control: no-cache` pour `sw.js` (Cloudflare ne le met alors plus en cache) ;
- à défaut, « Purge Everything » dans Cloudflare après chaque déploiement.

Les autres fichiers sont téléchargés par le service worker avec `?v=VERSION`, donc toujours à jour.

## Serveur et setlists partagées (Coolify)

`server/server.js` sert l'app **et** l'API des setlists partagées, dans un seul container (Node 22, aucune
dépendance npm). La validation des concerts reçus réutilise `js/store.js` : le serveur accepte exactement
ce que l'app accepte. Pas de compte ni de mot de passe : tout le monde peut lire et publier.

### Déployer sur Coolify

1. Nouvelle ressource → ce dépôt GitHub, branche `main`, build pack **Dockerfile**.
2. **Ports Exposes** : `3000`. Domaine : `https://klik.lonoize.com`.
3. **Persistent Storage** → ajouter un volume, chemin de destination **`/data`**. Sans ce volume, les
   setlists sont perdues à chaque redéploiement.
4. Déployer. Le healthcheck interroge `/api/health`.

On peut aussi choisir le build pack **Docker Compose** : `docker-compose.yml` déclare déjà le volume.

Variables d'environnement (facultatives) : `PORT` (3000), `DATA_DIR` (`/data`), `MAX_BODY` (taille max
d'une setlist, 262144 octets).

Le serveur envoie `Cache-Control: no-cache` pour `sw.js` et les pages, `no-store` pour l'API : avec
Cloudflare devant, il n'y a plus besoin de règle de cache ni de purge (voir plus haut).

### Données

Dans le volume, un dossier par concert, un fichier JSON par version publiée :

```
/data/concerts/<id du concert>/<version>.json   { version, publishedAt, publishedBy, fingerprint, concert }
/data/concerts/<id du concert>/hidden            présent si le concert a été retiré de la liste
```

Rien n'est jamais écrasé ni effacé par l'app. Republier un contenu identique ne crée pas de version.
- **Sauvegarde** : copier le dossier du volume (`docker run --rm -v <volume>:/data -v $PWD:/b alpine tar czf /b/klik-data.tgz /data`).
- **Remettre dans la liste** un concert retiré : supprimer son fichier `hidden`.
- **Supprimer** pour de bon : supprimer son dossier, puis redémarrer le container (l'index est relu au démarrage).

### API

| Requête | Réponse |
| ------- | ------- |
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/concerts` | `{ concerts: [résumé] }`, la plus récente en premier. Résumé : `{ id, name, songs, updatedAt, updatedBy, version, publishedAt, publishedBy }` |
| `GET /api/concerts/:id/version` | résumé de la dernière version, plus `hidden`. Léger (rien n'est lu sur le disque) : sert à savoir s'il y a une nouvelle version, en comparant `version` |
| `GET /api/concerts/:id` (`?version=…`) | `{ version, publishedAt, publishedBy, concert }` : la dernière version, ou celle demandée |
| `GET /api/concerts/:id/versions` | `{ versions: [...] }`, la plus récente en premier |
| `PUT /api/concerts/:id` | corps `{ concert, base, force, by }` (`by` = pseudo de qui publie). `base` = dernière version connue par l'auteur. Si le serveur en a une autre : `409` avec `latest`, sauf avec `force: true`. `201` : nouvelle version ; `200` + `unchanged` : contenu identique |
| `POST /api/concerts/:id/hide` | retire le concert de la liste |

Le concert est au format d'échange (voir [FORMAT.md](FORMAT.md)) ; son `id` doit être celui de l'adresse.

### Essai en local

```sh
npm start                      # données dans /data : sinon DATA_DIR=./data npm start
docker compose up --build      # ou dans le container, puis http://localhost:3000
```

## Déploiement sur GitHub Pages

Dans **Settings → Pages**, choisir **Deploy from a branch**, branche `main`, dossier `/ (root)`.
L'app sera servie sur `https://<compte>.github.io/klik/`. Tous les chemins sont relatifs, donc elle marche dans ce sous-dossier.
Sans le serveur, les setlists partagées n'apparaissent pas ; le partage par lien marche toujours.

## Développement local

```sh
DATA_DIR=./data npm start      # app + setlists partagées, http://localhost:3000
python3 -m http.server 8000    # ou l'app seule, http://localhost:8000
```
