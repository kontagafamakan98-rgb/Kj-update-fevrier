import { useEffect } from 'react';
// Le planificateur de vue vit dans `vue-de-page.js` et non dans
// `analytics.js` : ce module est appelé à CHAQUE navigation, y compris par un
// visiteur qui n'a jamais accepté la mesure, et il ne doit donc pas entraîner
// le code d'injection des fournisseurs dans le JS initial (mesuré : 1,5 Ko gzip,
// 30/10/2026).
import { notifierTitreDePage } from './vue-de-page';
import { ogCardFor } from '../config/og-cards';
import { pageMetaKeys } from '../config/page-meta';
import { cheminSansPrefixe } from '../config/langues-indexees';
import { useLanguage } from '../contexts/LanguageContext';

// Le chemin de la route SANS son préfixe de langue : les tables de textes et de
// cartes sont indexées par la route (`/jobs`), pas par la langue. Depuis le
// 30/10/2026 un document anglais vit à `/en/jobs` (`basename` du routeur) : sans
// ce retrait, la page anglaise n'aurait trouvé ni ses textes ni sa carte et se
// serait annoncée avec le titre et le visuel génériques — un document pré-rendu
// juste, écrasé au montage par du générique.
const cheminSansLangue = () =>
  typeof window === 'undefined' ? undefined : cheminSansPrefixe(window.location.pathname);

// SEO par route (SPA) : met à jour document.title, la meta description ET le
// <link rel="canonical"> au rendu — et le suit quand la route change de DONNÉE
// sans changer de chemin (/jobs/:A → /jobs/:B).
//
// IMPORTANT : le canonical statique d'index.html pointe vers "/" pour TOUTES
// les routes — Google consoliderait sinon chaque page vers la home. Ce hook
// le remplace par l'URL réelle de la route courante (origin + pathname), ce
// qui corrige l'indexation des pages publiques comme /how-it-works.
// Limite connue : un crawler sans JavaScript voit le canonical "/" sur les routes
// qui ne sont pas pré-rendues ; les coquilles statiques et la fiche mission
// (/jobs/:id) sont servies pré-rendues, avec leur propre canonical.

// URL ABSOLUE d'un chemin servi par le site (origine + chemin). Sans argument :
// la route COURANTE. Les crawlers de partage (LinkedIn, Facebook, Twitter,
// WhatsApp) refusent une URL relative dans og:image — une URL relative serait
// ignorée ou résolue de façon incohérente — et le canonical de la route
// courante s'écrit de la même façon.
export const absoluteUrl = (path = '') => {
  if (typeof window === 'undefined' || !window.location.origin) return path;
  return `${window.location.origin}${path || window.location.pathname}`;
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

export const usePageTitle = (title, { description, canonicalPath } = {}) => {
  // Titre
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    document.title = title;
    // La page vue GA de la route part ICI, et pas à la navigation : c'est le
    // premier instant où le titre de la page d'ARRIVÉE existe. Publiée sur
    // `pushState`, elle portait le titre de la page qu'on venait de quitter
    // (mesuré le 25/10/2026 : `/messages` titrée « Emplois disponibles »).
    notifierTitreDePage();
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

  // Canonical par route : corrige le canonical statique "/" d'index.html.
  //
  // `canonicalPath` : une route DYNAMIQUE (/jobs/:id) change d'identifiant sans
  // remonter le composant, donc la route courante lue au montage devient fausse
  // — le canonical restait figé sur la fiche PRÉCÉDENTE, et Google consolidait
  // la nouvelle vers l'ancienne. Le chemin vient donc du rendu courant, et
  // l'effet le suit. Sans paramètre (routes statiques), l'URL de la route
  // courante suffit : le montage y coïncide avec la navigation.
  useEffect(() => {
    const url = absoluteUrl(canonicalPath);
    if (!url) return undefined;
    ensureCanonical().setAttribute('href', url);
    return undefined;
  }, [canonicalPath]);
};

// Carte OG d'une route, lue dans la table UNIQUE (src/config/og-cards.js) — la
// même que celle des coquilles pré-rendues. Sans argument, elle suit la route
// COURANTE : une page ne peut donc pas annoncer la carte d'une autre route, et
// changer une carte se fait à un seul endroit (le shell et le runtime suivent).
const ogCardUrl = (route) => absoluteUrl(ogCardFor(route ?? cheminSansLangue()).image);

const DEFAULT_OG_IMAGE = absoluteUrl('/icons/icon-512x512.png');

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
      'og:url': url || absoluteUrl(),
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

/**
 * Titre, description, canonical et méta Open Graph/Twitter de la ROUTE COURANTE.
 *
 * C'est le point d'entrée des pages : les textes viennent de la table UNIQUE
 * (src/config/page-meta.js pour les textes, src/config/og-cards.js pour la
 * carte), donc ce que la page publie après montage est, par construction, ce que
 * la coquille pré-rendue publie dans le HTML servi — et un titre renommé d'un
 * côté ne peut pas survivre dans l'autre (scripts/check-page-meta.js échoue).
 *
 * Sans argument, elle suit la route COURANTE : une page ne peut donc pas
 * annoncer le texte d'une autre route — l'erreur que produisait /register, qui
 * n'annonçait RIEN et gardait le titre de la page précédente après une
 * navigation interne.
 *
 * @param {object} [overrides] Textes propres à une DONNÉE et non à une route
 *   (une fiche mission n'a de titre qu'une fois la mission chargée).
 * @param {string} [overrides.title]       Titre propre.
 * @param {string} [overrides.description] Description propre.
 * @param {string} [overrides.image]       Carte propre (ex. carte dynamique).
 */
export const usePageMeta = ({ title: titleOverride, description: descriptionOverride, image } = {}) => {
  const { t } = useLanguage();
  const keys = pageMetaKeys(cheminSansLangue());
  // Résolu AVANT les hooks : les effets comparent des CHAÎNES (stables d'un
  // rendu à l'autre), pas la fonction t — recréée à chaque rendu du fournisseur.
  const title = titleOverride || (keys ? t(keys.title) : '');
  const description = descriptionOverride || (keys?.description ? t(keys.description) : '');
  // La description va aux DEUX endroits : <meta name="description"> (ce que lit
  // un moteur) et og:description (ce que lit un réseau social). Le hook de titre
  // reçoit donc aussi la description — sans elle, le runtime laissait en place
  // celle de la page précédente pendant que la coquille en publiait une autre.
  usePageTitle(title, { description });
  usePageOpenGraph({ title, description, image: image || ogCardUrl() });
};

