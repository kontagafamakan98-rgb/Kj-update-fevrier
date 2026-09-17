import '@testing-library/jest-dom';

// Mock global fetch pour les tests qui n'ont pas besoin d'un vrai réseau
if (!global.fetch) {
  global.fetch = () => Promise.reject(new Error('fetch not mocked in this test'));
}

// matchMedia n'existe pas dans jsdom par défaut — plusieurs composants
// (thème, responsive) y font appel.
//
// Le garde `typeof window` permet aux fichiers de test qui déclarent
// `@vitest-environment node` (celui qui pilote le vrai vite.config.js — jsdom
// casse esbuild) de réutiliser ce setup sans DOM : sans ce garde, ils
// échoueraient au chargement sur `window is not defined`.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
