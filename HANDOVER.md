# Handover

## À faire

- **Guide** (`guide.html`) : ajouter une étape « Setlists partagées » (publier, récupérer, versions) dans la partie
  « Partager », avec une capture, quand on refait les captures. Le texte « pas de serveur » reste vrai pour le lien.
- **Setlists partagées, idées** : lien de partage court vers une setlist du serveur (au lieu de tout le JSON dans
  `#k=…`) ; code de groupe si l'accès libre pose un jour problème.

- **Vidéo de présentation** (`video/klik-presentation.mp4`) : pas refaite depuis le passage du haut-parleur
  en icône SVG (v0.14.1). On y voit encore l'emoji 🔊/🔇, et la légende « Muet ? » de `video/record.mjs`
  (ligne `caption('Muet ?', …)`) cite l'emoji. À régénérer (voir `video/README.md`) quand on refait la vidéo.
- **Captures du guide** (`guide/fr-NN.webp`, `guide/en-NN.webp`) : à refaire avec `node video/guide-shots.mjs`
  pour montrer la nouvelle icône du haut-parleur et le champ « Tonalité » des formulaires de morceau.
  Le texte de `guide.html` et du `README.md` est déjà à jour (icône SVG).

## Fait récemment

- v0.16.0 : serveur Node (`server/`) en container pour Coolify, volume `/data`. Setlists partagées : publier
  (menu ⋯ du concert), liste « Setlists partagées » (en haut des concerts, seulement si `api/health` répond),
  versions conservées, conflit signalé si quelqu'un a publié entre-temps (`c.remote` = version de base, stocké
  localement, jamais exporté), « Retirer de la liste » sans effacement. Le service worker ne touche pas à `api/`.
- v0.16.1 : pseudo (`data.pseudo`, demandé à la 1re ouverture de la liste quand le serveur répond, et avant de
  publier) ; champ `updatedBy` des concerts (format d'échange), mis à jour par `persist()` avec `updatedAt`.
  Route `GET /api/concerts/:id/version` ; bandeau « Nouvelle version sur le serveur » dans un concert récupéré
  (vérifié au plus une fois par minute) et message au lancement pour le concert en cours. `publishedBy` côté serveur.

- v0.14.0 : champ `key` (tonalité) sur les morceaux ; setlist imprimable / téléchargeable en HTML (menu ⋯ du concert).
- v0.14.1 : haut-parleur en SVG (`.mute-icon`, classe `is-muted`).
- v0.15.0 : setlist optimisée : une ligne par morceau (titre à gauche, tonalité et BPM calés à droite),
  intertitres de sections en bandeau noir, lignes avant le premier et après le dernier morceau,
  taille adaptée au nombre de lignes pour tenir sur une page A4. Artiste et durée ne sont plus imprimés.
- v0.15.1 : setlist pour la scène (lue au sol, de loin) : plus de traits (bandes grises alternées), padding minimal,
  une partie par bloc, titres au maximum de taille. Un script dans la page teste trois mises en page
  (A4 paysage 2 colonnes, portrait 1 colonne, paysage 1 colonne) et garde celle qui donne le plus gros texte ;
  il règle aussi `@page size` en conséquence. Si ça déborde, vérifier la réserve de marge dans `fit()` (`js/app.js`).
