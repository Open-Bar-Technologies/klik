# Handover

## À faire

- **Vidéo de présentation** (`video/klik-presentation.mp4`) : pas refaite depuis le passage du haut-parleur
  en icône SVG (v0.14.1). On y voit encore l'emoji 🔊/🔇, et la légende « Muet ? » de `video/record.mjs`
  (ligne `caption('Muet ?', …)`) cite l'emoji. À régénérer (voir `video/README.md`) quand on refait la vidéo.
- **Captures du guide** (`guide/fr-NN.webp`, `guide/en-NN.webp`) : à refaire avec `node video/guide-shots.mjs`
  pour montrer la nouvelle icône du haut-parleur et le champ « Tonalité » des formulaires de morceau.
  Le texte de `guide.html` et du `README.md` est déjà à jour (icône SVG).

## Fait récemment

- v0.14.0 : champ `key` (tonalité) sur les morceaux ; setlist imprimable / téléchargeable en HTML (menu ⋯ du concert).
- v0.14.1 : haut-parleur en SVG (`.mute-icon`, classe `is-muted`).
- v0.15.0 : setlist optimisée : une ligne par morceau (titre à gauche, tonalité et BPM calés à droite),
  intertitres de sections en bandeau noir, lignes avant le premier et après le dernier morceau,
  taille adaptée au nombre de lignes pour tenir sur une page A4. Artiste et durée ne sont plus imprimés.
