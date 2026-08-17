import { useEffect } from 'react';

// Titre de page par route (SEO + UX) : met à jour document.title quand le
// composant monte et restaure le titre précédent au démontage.
export const usePageTitle = (title) => {
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
};

export const buildPageTitle = (suffix) => (suffix ? `${suffix} — Kojo` : 'Kojo — Services et travailleurs en Afrique de l\'Ouest');
