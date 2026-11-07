# partage

Pages HTML à faire lire à d'autres personnes, servies par GitHub Pages : https://bonben.github.io/partage/

- `./publier page.html nom [--secret]` copie la page dans `site/<nom>/index.html` (en-tête ajouté si la page est
  au format artefact, `noindex` toujours), puis `git add site && git commit && git push` la met en ligne en une
  minute environ (workflow `pages`).
- Tout ce qui est dans `site/` est **public** : lisible par quiconque a l'adresse. `noindex` et `robots.txt`
  écartent les moteurs de recherche, `--secret` rend l'adresse indevinable, mais rien de tout ça n'est une
  protection. Une page n'y entre qu'avec l'accord de Mathieu.
- Retirer une page : supprimer son dossier, commit, push.
