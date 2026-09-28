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
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [],
}
