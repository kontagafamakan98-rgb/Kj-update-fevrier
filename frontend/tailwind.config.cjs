/** @type {import('tailwindcss').Config} */
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
