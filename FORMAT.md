# Format d'échange JSON de Klik

Klik copie et colle des **morceaux** et des **concerts** en JSON. Le format est stable et
lisible : on peut l'écrire à la main, le stocker dans un fichier ou l'envoyer par message.

Chaque objet commence par deux champs :

| Champ  | Valeur                     |
| ------ | -------------------------- |
| `klik` | version du format, `2`     |
| `type` | `"song"` ou `"concert"`    |

## Morceau

```json
{
  "klik": 2,
  "type": "song",
  "name": "Tresillo",
  "tempo": 100,
  "signature": "4/4",
  "pattern": "X.....X.....X..."
}
```

| Champ       | Obligatoire | Description |
| ----------- | ----------- | ----------- |
| `name`      | non         | Nom du morceau (80 caractères max). |
| `tempo`     | oui         | BPM, entre 30 et 300. |
| `signature` | non         | `"2/4"`, `"3/4"`, `"4/4"`, `"6/8"` ou un objet personnalisé (voir plus bas). `"4/4"` par défaut. |
| `pattern`   | non         | Un caractère par point : `X` fort, `x` moyen, `.` rien. Le 1er caractère est toujours le temps 1. Motif par défaut : seulement les temps (2 en 2/4, 3 en 3/4, 4 en 4/4, 6 croches en 6/8). |
| `countIn`   | non         | Décompte, en mesures (0 à 8). Pas encore utilisé par l'interface. |
| `duration`  | non         | Durée au format `"m:ss"`, par exemple `"3:45"`. |
| `notes`     | non         | Texte libre (500 caractères max). |

### Signatures prédéfinies

| Signature | Points | Un point =       | Le BPM compte    |
| --------- | ------ | ---------------- | ---------------- |
| `2/4`     | 8      | double-croche    | la noire         |
| `3/4`     | 12     | double-croche    | la noire         |
| `4/4`     | 16     | double-croche    | la noire         |
| `6/8`     | 12     | double-croche    | la noire pointée |

### Signature personnalisée

N'importe quelle grille peut être collée sous forme d'objet :

```json
"signature": { "label": "12/8", "steps": 12, "stepsPerBeat": 3 }
```

- `label` : texte affiché (8 caractères max) ;
- `steps` : nombre de points dans la mesure (2 à 32) ;
- `stepsPerBeat` : nombre de points par temps, c'est-à-dire par battement du BPM.

Exemple, une clave sur deux mesures de 4/4 en croches (16 points, BPM à la noire) :

```json
{ "klik": 2, "type": "song", "name": "Salsa · clave de son 3-2", "tempo": 190,
  "signature": { "label": "clave", "steps": 16, "stepsPerBeat": 2 },
  "pattern": "X..X..X...X.X..." }
```

Exemple, un shuffle boogie (4 temps ternaires, 3 points par temps) :

```json
{ "klik": 2, "type": "song", "name": "Shuffle boogie", "tempo": 112,
  "signature": { "label": "12/8", "steps": 12, "stepsPerBeat": 3 },
  "pattern": "X.xX.xX.xX.x" }
```

## Concert

Un concert est une liste ordonnée de morceaux, sans `klik` ni `type` sur chaque morceau :

```json
{
  "klik": 2,
  "type": "concert",
  "name": "Fête de la musique",
  "songs": [
    { "name": "Rock droit", "tempo": 120, "signature": "4/4", "pattern": "XxXxXxXx" },
    { "name": "Valse", "tempo": 168, "signature": "3/4", "pattern": "X...X...X..." }
  ]
}
```

Coller un concert crée un nouveau dossier. Coller un morceau l'ajoute à la fin du concert ouvert.
Les copies sont indépendantes : modifier un morceau dans un concert ne change pas les autres.

## Évolution du format

- **Version 2** : le 4/4 passe de 8 croches à 16 doubles-croches. Un JSON en version 1 avec
  `"signature": "4/4"` et un motif de 8 caractères est converti automatiquement à l'import
  (chaque croche devient une double-croche suivie d'un silence).

Si le format change encore, `klik` passera à `3`. Klik refuse un JSON de version plus récente que
la sienne au lieu de l'importer à moitié.
