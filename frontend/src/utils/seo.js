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

// Image OG par page, servie depuis le dossier public/. On renvoie une URL
// ABSOLUE (origine + chemin) : les crawlers de partage (LinkedIn, Facebook,
// Twitter, WhatsApp) exigent une URL complète dans og:image — une URL
// relative serait ignorée ou résolue de façon incohérente.
export const ogImageUrl = (path) => {
  if (typeof window !== 'undefined' && window.location.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
};

const DEFAULT_OG_IMAGE =
  typeof window !== 'undefined' && window.location.origin
    ? `${window.location.origin}/icons/icon-512x512.png`
    : '/icons/icon-512x512.png';

const ensureMeta = (selector, attr, value) => {
  let meta = document.querySelector(selector);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attr, value);
    document.head.appendChild(meta);
  }
  return meta;
};

const ensureOgMeta = (property, contentValue) => {
  const meta = ensureMeta(`meta[property="${property}"]`, 'property', property);
  meta.setAttribute('content', contentValue);
  return meta;
};

// Méta Open Graph / Twitter dynamiques par route (SPA). Les partages
// WhatsApp/Facebook d'un lien /jobs/:id affichent ainsi le titre et la
// description réels de la mission au lieu du texte générique d'index.html.
// Limite connue : un crawler sans JavaScript voit encore les méta statiques
// (le HTML initial n'est pas pré-rendu par route).
export const usePageOpenGraph = ({
  title,
  description,
  image,
  url,
} = {}) => {
  useEffect(() => {
    if (!document?.head || !title) return undefined;
    const prev = {};
    const props = {
      'og:title': title,
      'og:description': description || '',
      'og:image': image || DEFAULT_OG_IMAGE,
      'og:url': url || getCurrentUrl(),
      'twitter:title': title,
      'twitter:description': description || '',
      'twitter:image': image || DEFAULT_OG_IMAGE,
    };
    Object.entries(props).forEach(([prop, value]) => {
      const el = ensureMeta(`meta[property="${prop}"]`, 'property', prop);
      prev[prop] = el.getAttribute('content');
      el.setAttribute('content', value);
    });
    return () => {
      Object.entries(prev).forEach(([prop, value]) => {
        const el = document.querySelector(`meta[property="${prop}"]`);
        if (el) {
          if (value) el.setAttribute('content', value);
          else el.removeAttribute('content');
        }
      });
    };
  }, [title, description, url]);
};

