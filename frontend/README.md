# Kojo — Frontend

Application React 18 + Vite 7 + Tailwind CSS 3 + React Router 7 (SPA, PWA + Capacitor pour Android/iOS).

## Prérequis

- Node.js **>= 20.19** (CI : Node 24) — voir `engines` dans `package.json`.
- npm **>= 10**.

## Installation

```bash
cp .env.example .env.local   # Adapter VITE_API_URL si besoin
npm install
```

## Scripts

| Commande | Description |
|---|---|
| `npm start` | Serveur de dev Vite sur http://localhost:3000 |
| `npm run build` | Build de production dans `build/` (minifié + chunks vendor) |
| `npm test` | Tests Vitest (jsdom) — exécution unique |
| `npm run test:watch` | Tests en mode watch |
| `npm run preview` | Prévisualise le build (`vite preview`) |

## Structure

```
src/
├── App.js               # Routage + providers
├── pages/               # Pages (Home, Jobs, JobDetails, Messages, Payment…)
├── components/          # Composants métier
├── contexts/            # Auth, Language, Payment, Toast, Country, Notification
├── i18n/                # Traductions JSON par langue (fr, en, wo, bm, mos)
├── services/            # Appels API (api.js, paymentAccountService…)
├── utils/               # Helpers (cache, géolocalisation, push, validation…)
└── styles/              # CSS (Tailwind + feuilles kojo-*)
```

## Backend

L'API FastAPI attendue se configure via `VITE_API_URL` (défaut : l'URL Render
codée en dur dans `src/services/api.js` comme dernier recours). Voir le
`README.md` racine pour lancer le backend localement.

## PWA / Service workers

- `public/push-sw.js` : service worker **push notifications** (VAPID), seul SW
  réellement enregistré (via `src/utils/pushRegistration.js`).
- `public/service-worker.js` : SW « kill switch » qui nettoie les caches des
  anciennes versions puis se désinscrit — le cache applicatif (offline) est
  volontairement **désactivé** (`src/index.js` appelle
  `serviceWorkerRegistration.unregister()` + purge des caches) suite à des
  plantages en prod liés au cache.
