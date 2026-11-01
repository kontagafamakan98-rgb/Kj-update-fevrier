// LA LANGUE D'UN DOCUMENT PRÉ-RENDU, ÉCRITE DANS SON `<head>` — une fois, pour
// CHAQUE langue de `LANGUES_INDEXEES` (deux au 30/10/2026, cinq depuis le
// 01/11/2026 ; le code ci-dessous ne connaît aucun nombre).
//
// Ce module ne décide RIEN : la liste des langues, leurs préfixes et la liste
// `hreflang` d'une page viennent de src/config/langues-indexees.js, et les
// textes (titre, description, og:*) sont déjà écrits par `writeRouteText` dans
// la langue du document. Ici on ne fait que PUBLIER ces faits dans le document :
// `lang`, `og:locale` (+ l'alternative), `og:url`/`twitter:url`, le canonical, et
// les `<link rel="alternate" hreflang>`.
//
// Pourquoi le canonical est écrit ICI et pas seulement par `applyOgCard` : la
// page d'accueil anglaise ne passe pas par `applyOgCard` (elle n'a pas de carte
// propre, elle hérite de celle de « / »), donc son canonical n'aurait eu aucun
// auteur. Une seule fonction écrit donc l'URL de chaque document, pour les deux
// langues, et une page ne peut pas publier le canonical d'une autre.
//
// Ce que le garde vérifie (scripts/check-prerender-shells.js) : que chaque
// document porte EXACTEMENT les alternatives de sa famille (elles ne sont pas
// filtrées à l'écriture, elles sont comparées), que la réciproque existe comme
// fichier, et que le `x-default` désigne la langue par défaut.
import {
  LANGUES_INDEXEES,
  alternatesHreflang,
  cheminDansLaLangue,
  langueIndexee,
} from '../../src/config/langues-indexees.js';
import { setMeta } from './route-meta.js';

const echapperAttribut = (valeur) =>
  String(valeur)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Les `<link rel="alternate" hreflang>` d'un chemin, dans l'ordre déclaré. */
export function balisesAlternates(chemin, origine) {
  return alternatesHreflang(chemin, origine)
    .map(
      ({ hreflang, href }) =>
        `<link rel="alternate" hreflang="${echapperAttribut(hreflang)}" href="${echapperAttribut(href)}" />`
    )
    .join('\n    ');
}

/**
 * Écrit la langue, l'URL et les alternatives d'un document pré-rendu.
 *
 * Les alternatives déjà présentes sont RETIRÉES avant d'être réécrites : le
 * document de base est index.html, qui n'en porte aucune aujourd'hui, mais une
 * seconde passe (ou une main qui en ajoute une) produirait deux listes — et un
 * `hreflang` en double est une déclaration contradictoire.
 *
 * @param {string} htmlIn Document pré-rendu.
 * @param {{chemin: string, code: string, origine: string}} options `chemin` est
 *   le chemin SANS LANGUE de la page (`/jobs`, `/`) et `code` la langue du
 *   document : le chemin PUBLIÉ (`/en/jobs`) se DÉRIVE des deux, il n'est pas
 *   passé — c'est ce qui empêche un document de s'annoncer deux fois préfixé.
 * @returns {string} Le document avec sa langue et ses alternatives.
 * @throws {Error} Si `code` n'est pas une langue indexée : un document sans
 *   déclaration ne peut pas choisir sa langue en silence.
 */
export function appliquerLaLangue(htmlIn, { chemin, code, origine }) {
  const langue = langueIndexee(code);
  if (!langue) {
    throw new Error(
      `prerender hreflang : « ${code} » n'est pas une langue indexée ` +
        '(src/config/langues-indexees.js) — aucun document ne peut être écrit sans sa déclaration.'
    );
  }
  const url = `${origine}${cheminDansLaLangue(chemin, code)}`;
  let out = String(htmlIn).replace(/<html lang="[^"]*"/, `<html lang="${langue.htmlLang}"`);
  out = out.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
  out = setMeta(out, 'og:url', url);
  out = setMeta(out, 'twitter:url', url);
  out = setMeta(out, 'og:locale', langue.ogLocale);
  // L'ALTERNATIVE d'og:locale : l'autre langue indexée. index.html porte déjà la
  // balise (`en_GB`, valeur que personne ne calculait) ; sa valeur est réécrite
  // depuis la déclaration, sinon elle annoncerait une variante régionale que le
  // site ne publie pas.
  const autre = LANGUES_INDEXEES.find((candidate) => candidate.code !== langue.code);
  if (autre) out = setMeta(out, 'og:locale:alternate', autre.ogLocale);
  // Les alternatives : exactement celles de la déclaration, jamais une de plus.
  out = out.replace(/[ \t]*<link rel="alternate" hreflang="[^"]*"[^>]*>\n?/g, '');
  out = out.replace(
    /(<link rel="canonical"[^>]*>)/,
    `$1\n    ${balisesAlternates(chemin, origine)}`
  );
  return out;
}
