# Format d'échange JSON de Klik

Klik copie et colle des **morceaux** et des **concerts** en JSON. Le format est stable et
lisible : on peut l'écrire à la main, le stocker dans un fichier ou l'envoyer par message.

### Forme courte

Pour un morceau, `tempo` et `pattern` suffisent :

```json
{ "tempo": 95, "pattern": "X..X..X...X.X..." }
```

- sans `type`, un objet avec `tempo` est un morceau, un objet avec `songs` est un concert ;
- sans `klik`, le format actuel est supposé ;
- sans `signature`, elle est déduite de la longueur du motif : 8 points → 2/4, 16 → 4/4,
  12 → 6/8 si le 7e point est fort (`X`) et que les 5e et 9e ne le sont pas, sinon 3/4 ;
- sans `name`, le morceau s'appelle « Sans titre » (à renommer dans la liste).

### Forme complète

Les objets copiés par Klik commencent par deux champs :

| Champ  | Valeur                     |
| ------ | -------------------------- |
| `klik` | version du format, `2` (facultatif) |
| `type` | `"song"` ou `"concert"` (facultatif) |

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
| `signature` | non         | `"2/4"`, `"3/4"`, `"4/4"`, `"6/8"` ou un objet personnalisé (voir plus bas). Déduite du motif si absente. |
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

Une clave (motif sur 2 mesures) s'écrit sur une mesure de 4/4 : même motif, tempo divisé par 2.
Par exemple une salsa à 190 à la noire devient :

```json
{ "klik": 2, "type": "song", "name": "Salsa · clave de son 3-2", "tempo": 95,
  "signature": "4/4", "pattern": "X..X..X...X.X..." }
```

### Signature personnalisée

N'importe quelle grille peut être collée sous forme d'objet :

```json
"signature": { "label": "12/8", "steps": 12, "stepsPerBeat": 3 }
```

- `label` : texte affiché (8 caractères max) ;
- `steps` : nombre de points dans la mesure (2 à 32) ;
- `stepsPerBeat` : nombre de points par temps, c'est-à-dire par battement du BPM.

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
    { "name": "Rock droit", "tempo": 120, "signature": "4/4", "pattern": "X.x.X.x.X.x.X.x." },
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
