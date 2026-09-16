import contact from './contact.json';
import socialNetworks from './social-networks.json';

// Source de vérité UNIQUE du contact (N.A.P.) : ce fichier est importé par
// l'application (footer, page Support) et LU DIRECTEMENT au build par le
// plugin `inject-seo-extras` / le shell statique de la page d'accueil
// (vite.config.js). Une seule adresse, un seul numéro : impossible de
// publier deux N.A.P. différents selon le canal, ce qui est exactement ce que
// les moteurs (et un audit SEO local) sanctionnent.
export const CONTACT = contact;

// Liens cliquables (User Experience) : `tel:` et `mailto:` — indispensables
// sur mobile (un appui = appel ou e-mail), et exigés par les audits SEO.
export const telHref = `tel:${contact.phone.replace(/[^+\d]/g, '')}`;
export const mailtoHref = `mailto:${contact.email}?subject=${encodeURIComponent('Contact KOJO')}`;

// Réseaux sociaux : AUCUN profil n'est inventé. Chaque réseau s'active par sa
// variable d'environnement (Vercel) — la liste et les noms de variables vivent
// dans social-networks.json, que le build lit aussi (vite.config.js) : le lien
// affiché par le footer, celui du HTML statique et le `sameAs` du
// LocalBusiness ne peuvent donc pas diverger. Sans valeur, le lien n'est pas
// rendu : un lien social bidon nuirait au site plus qu'il ne l'aiderait.
const envValue = (name) => {
  try {
    return String(import.meta.env?.[name] || '').trim();
  } catch (_error) {
    return '';
  }
};

export const SOCIAL_LINKS = socialNetworks
  .map(({ key, label, env }) => ({ key, label, url: envValue(env) }))
  .filter((social) => /^https:\/\//.test(social.url));
