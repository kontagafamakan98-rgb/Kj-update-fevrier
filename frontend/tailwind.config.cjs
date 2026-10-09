/** @type {import('tailwindcss').Config} */
// La gamme de couleurs de Tailwind, telle QUE le paquet la publie : elle sert à
// rediriger `gray` vers `stone` ci-dessous. Le `require` est le chemin documenté
// (`tailwindcss/colors`) ; la forme « fonction de thème » (`({ theme }) =>
// theme('colors.stone')`) a été essayée d'abord et NE RÉSOUT PAS ici — mesuré le
// 28/09/2026 sur le build : aucune règle `.text-gray-*` n'était plus émise, donc
// les ~700 jetons de la gamme froide portaient un nom SANS DESSIN et le texte
// héritait de la couleur du parent, sans qu'aucun garde ne rougisse.
const couleurs = require('tailwindcss/colors');

module.exports = {
  // ── `darkMode: ['class']` RESTE, ET C'EST UNE DÉCISION MESURÉE (08/10/2026) ──
  // Le site n'a PAS de thème sombre : zéro variant `dark:` dans `src/`, zéro
  // porteur de la classe `.dark` (le bloc `.dark` de `:root` a été retiré le
  // 28/09/2026) et zéro règle `.dark` dans la feuille livrée. La valeur choisie
  // décide de ce qui se passerait si un `dark:` était écrit un jour : avec
  // `'class'`, il ne s'applique QUE si quelqu'un pose la classe — donc jamais,
  // et la règle reste inerte ; avec le défaut de Tailwind (`'media'`), il
  // s'activerait tout seul sur un poste réglé en sombre, alors que le site force
  // `color-scheme: light` (`src/index.css`) et n'a aucune palette pour ce cas.
  // Inerte est le bon côté de cette alternative : un thème sombre doit être une
  // décision, pas un effet de bord de la préférence du visiteur.
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
    // ── Les sources qu'un build de PRODUCTION n'émet PAS ────────────────────
    // `src/pages/MobileTest.js` — et le composant `src/components/MobilePhotoTest.js`
    // qu'il est seul à importer — n'existent qu'en DÉV : `src/App.js` garde leur
    // import derrière `import.meta.env.DEV`, donc Rollup retire le chunk du
    // livré. Tailwind, lui, scanne des FICHIERS et pas un graphe de modules : il
    // continuait de produire leurs classes dans la feuille SERVIE, où plus rien
    // ne les portait. Mesuré le 27/09/2026 : 39 règles sans porteur dans
    // `build/` (`w-fit`, `bg-purple-50`, `text-purple-800`, sur les quatorze
    // pages servies), ce que `scripts/check-css-selecteurs-morts.js` refuse —
    // et il a raison : une page éliminée du build ne doit pas peser sur le CSS
    // que le visiteur télécharge. L'exclusion vit ici, avec sa raison, plutôt
    // que dans une liste d'exceptions tenue ailleurs.
    '!./src/pages/MobileTest.js',
    '!./src/components/MobilePhotoTest.js',
  ],
  // ── LES NOMS QUE LE SITE A DÉCIDÉ DE NE PLUS GÉNÉRER (07/10/2026) ──────────
  //
  // Tailwind ne lit pas des classes, il lit des JETONS : tout mot d'un fichier
  // scanné qui ressemble à un utilitaire fait GÉNÉRER cet utilitaire, même quand
  // ce mot est une variable, une méthode ou de la prose. Les neuf noms ci-dessous
  // sont donc de VRAIS utilitaires — `container`, `visible`, `static`, `table`,
  // `resize`, `blur`, `filter`, `transition`, `ease-out` — que PERSONNE n'écrit
  // comme classe : mesuré le 07/10/2026 sur l'arbre livré, ils produisaient
  // **195 règles servies** (14 pages : `.container` six fois par page, les huit
  // autres une fois), toutes sans porteur, c'est-à-dire du CSS que le visiteur
  // télécharge et que rien ne peint. Chaque source a été vérifiée une par une :
  //   • `container` ← `const pulseCount = (container) => …` ;
  //   • `visible`   ← la prose « un trou visible » ;
  //   • `static`    ← `static getDerivedStateFromError(error)` (ErrorBoundary) ;
  //   • `table`     ← la prose « la table d'emoji qui vivait … » ;
  //   • `resize`    ← `addEventListener('resize', …)` ;
  //   • `blur`      ← `backdropFilter: 'blur(10px)'` ;
  //   • `filter`    ← `[…].filter(Boolean)` ;
  //   • `transition` ← la prose « la transition de vue native » ;
  //   • `ease-out`  ← `animation: 'slideInRight 0.3s ease-out'`.
  //
  // Les nommer ici est la moitié « CESSER DE LES GÉNÉRER » de la dette fermée ce
  // jour-là (l'autre moitié — donner un porteur à ceux qui SONT des classes — vit
  // dans le code, cf. `scripts/css-selecteurs-morts.js`). Le chemin inverse est
  // vérifié : `scripts/check-css-selecteurs-morts.js` REFUSE qu'un nom de cette
  // liste soit posé quelque part — un nom bloqué mais posé serait une classe dont
  // la règle n'existe plus, le même mensonge à l'envers. Le jour où une page
  // écrira vraiment `transition` ou `blur` comme classe, le garde le dira.
  blocklist: [
    'container',
    'visible',
    'static',
    'table',
    'resize',
    'blur',
    'filter',
    'transition',
    'ease-out',
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        // ── LA GAMME FROIDE DE TAILWIND EST REDIRIGÉE VERS CELLE DU SITE ────
        // `gray` est la gamme FROIDE (bleu-gris) de Tailwind ; le site peint
        // chaud partout ailleurs (l'encre, le sable, le filet et le papier de
        // src/index.css, `--kojo-*`). Mesuré le 28/09/2026 : les pages
        // d'application, le chrome et les coquilles pré-rendues portaient
        // encore ~700 jetons de cette gamme — c'est ce qui donnait aux
        // tableaux de bord l'air d'un autre produit que l'accueil.
        //
        // La redirection se fait ICI, dans la palette — pas ligne par ligne
        // dans les pages, pour trois raisons qui sont des mesures ou des faits :
        //   • une gamme redirigée couvre AUSSI les variantes (`hover:`,
        //     `focus:`, `divide-`, `placeholder-`, `ring-`) ; un renommage à la
        //     main en laisse toujours, et le trou ne se voit qu'à l'œil ;
        //   • les deux canaux doivent changer ENSEMBLE : React et les coquilles
        //     pré-rendues peignent les mêmes classes (`gray-200`, `gray-700`…),
        //     et un gris froid d'un côté pour un gris chaud de l'autre est une
        //     couture visible au montage ;
        //   • `stone` a la MÊME échelle que `gray` (mêmes noms de palier, mêmes
        //     luminosités à 1 % près), donc AUCUNE conséquence de mise en page :
        //     ni une taille de police, ni une bordure, ni un rayon ne bouge.
        //     Seule la TEINTE change, et c'est la seule chose qu'on voulait
        //     changer.
        gray: couleurs.stone,

        // ── LES DOUZE ENTRÉES DE COULEUR shadcn SONT RETIRÉES (08/10/2026) ──
        // `background`, `foreground`, `card`, `popover`, `primary`,
        // `secondary`, `muted`, `accent`, `destructive`, `border`, `input`,
        // `ring` et `chart.1..5` renvoyaient toutes vers un jeton de `:root`.
        // MESURÉ sur la feuille livrée : elles ne génèrent AUCUN utilitaire
        // (zéro règle `.bg-card`, `.text-primary` ou `.border-border` servie),
        // et aucun composant ne les nomme (`grep` sur `src/` : une seule
        // occurrence, le `@apply` de `src/index.css`, retiré lui aussi). Les
        // seules qui peignaient étaient battues par une règle plus tardive du
        // site (`App.css` pour le fond, le préflight pour la bordure, cf.
        // `src/index.css`) ; la couleur de texte, la seule qui restait, est
        // passée à la palette du site. Les garder aurait laissé une palette
        // FROIDE (le gris shadcn) à portée d'un `bg-muted` — c'est-à-dire un
        // nom qui existe sans qu'aucun pixel du site ne lui corresponde.
        // `scripts/check-reliquats-css.js` refuse leur retour.
      }
      // ── LES ANIMATIONS `accordion-*` SONT RETIRÉES (08/10/2026) ────────────
      // Leurs `@keyframes` animaient une hauteur lue dans
      // `var(--radix-accordion-content-height)`, un jeton du paquet
      // `@radix-ui/react-accordion` — qui n'est PAS une dépendance du projet
      // (aucune entrée `radix` dans `package.json`), et qu'aucun composant
      // n'importe. MESURÉ : les deux utilitaires ne sont posés nulle part et la
      // feuille livrée ne contient pas une occurrence d'`accordion` — Tailwind
      // n'émet un `@keyframes` que si son utilitaire `animate-*` est utilisé,
      // donc ces trois blocs ne servaient rien. Un thème qui cite un paquet
      // absent est un reliquat du gabarit shadcn, pas une intention.
    }
  },
  plugins: [],
}
