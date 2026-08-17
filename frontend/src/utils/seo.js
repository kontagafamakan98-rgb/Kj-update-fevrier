import { useEffect } from 'react';

// SEO par route (SPA) : met à jour document.title, la meta description ET le
// <link rel="canonical"> quand le composant monte.
//
// IMPORTANT : le canonical statique d'index.html pointe vers "/" pour TOUTES
// les routes — Google consoliderait sinon chaque page vers la home. Ce hook
// le remplace par l'URL réelle de la route courante (origin + pathname), ce
// qui corrige l'indexation des pages publiques comme /how-it-works.
// Limite connue : un crawler sans JavaScript voit encore le canonical "/"
// (le HTML initial n'est pas pré-rendu par route).

const getCurrentUrl = () => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
};

const ensureCanonical = () => {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  return link;
};

const ensureMetaDescription = () => {
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    document.head.appendChild(meta);
  }
  return meta;
};

export const usePageTitle = (title, { description, canonical } = {}) => {
  // Titre
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  // Meta description (par route)
  useEffect(() => {
    if (!description) return undefined;
    const meta = ensureMetaDescription();
    const previous = meta.getAttribute('content');
    meta.setAttribute('content', description);
    return () => {
      if (previous) meta.setAttribute('content', previous);
    };
  }, [description]);

  // Canonical par route : corrige le canonical statique "/" d'index.html
  useEffect(() => {
    const url = canonical || getCurrentUrl();
    if (!url) return undefined;
    ensureCanonical().setAttribute('href', url);
    return undefined;
  }, [canonical]);
};

export const buildPageTitle = (suffix) => (suffix ? `${suffix} — Kojo` : 'Kojo — Services et travailleurs en Afrique de l\'Ouest');
