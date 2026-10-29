// ── Le CHROME de l'application, publié UNE fois ────────────────────────────
//
// L'habillage que React monte AUTOUR du corps d'une page : le conteneur
// `.App`, la colonne `.min-h-screen` qui ancre le pied de page, la navbar et
// le `main.flex-1` qui reçoit la page. Les coquilles pré-rendues le
// recopiaient chacune de leur côté (douze fois la même fausse navbar) ; il
// vit désormais ici, lu par les deux injections de prerender-route-meta.js.
//
// Pourquoi ce n'est pas un détail cosmétique (mesuré, Chrome 152, 1350×940) :
//
//   Les coquilles posaient leur corps directement dans #root, sans ces
//   conteneurs — donc sans leur hauteur ni leur structure. Les deux vues ne
//   publiaient pas le même texte au même endroit :
//
//     • la 2e ligne du paragraphe d'intro de /jobs commençait à x=67.000 dans
//       la coquille et à x=218.578 chez React (centrée) ;
//     • l'aire LCP du MÊME paragraphe passait de 36 002 à 36 049 px²
//       (+0,13 %) — les bornes d'encre suivent le décalage sub-pixel de la
//       ligne. Or Chrome n'émet un candidat LCP que pour une aire
//       STRICTEMENT plus grande : ce +47 px² suffisait à ré-élire la peinture
//       de React (à 2,5 s, après la réponse de l'API), et Lantern facturait
//       alors toute la chaîne JavaScript au LCP — 3 runs sur 3 en desktop,
//       score 92 au lieu de 99.
//
//   Avec le chrome publié, la coquille peint le paragraphe à la MÊME
//   géométrie et React ne ré-élit plus rien : mesuré sur le build patché,
//   un seul candidat LCP, celui de la coquille (36049 px², `react: false`).
//
//   L'alignement hérité de `.App` (qui était alors la cause du décalage) a été
//   RETIRÉ le 25/09/2026 : le site est aligné à gauche par défaut, chaque bloc
//   centré le DÉCLARE, et ce sont les gardes navigateur qui comparent les deux
//   canaux (`e2e/geometrie-coquille-react.spec.js` pour l'encre ET le
//   `text-align` calculé, `e2e/lcp-geometrie.spec.js` pour les candidates LCP).
//   Le chrome reste publié pour ce qu'il porte STRUCTURELLEMENT : la hauteur de
//   la navbar (65 px) et `main.flex-1`, qui décident où tombe le contenu. Sa
//   classe `.App` est publiée par les DEUX canaux, pour qu'aucune règle future
//   sur cette enveloppe ne puisse les faire diverger en silence.
//
//   La navbar réelle mesure 65 px aux DEUX profils (412 et 1350 px) : un
//   `border-b` de 1 px autour d'un `h-16` de 64 px. Le placeholder unique
//   `h-16 … border-b` en faisait 64 (border-box), soit 1 px de moins que la
//   vraie — de quoi décaler tout le contenu au montage de React.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CONTACT, mailtoHref, telHref } from '../../src/config/contact.js'
// Les CLASSES du chrome n'ont qu'un propriétaire (src/config/classes-chrome.js),
// lu par React (src/App.js, src/components/Navbar.js) ET par ici : les recopier
// faisait diverger les deux peintures en silence (18 listes, dont 16 jumelles
// exactes de src/App.js, relevé du 09/10/2026). Le garde
// `scripts/check-classes-coquilles.js` refuse qu'un champ de ce domicile soit
// RECOPIÉ ici.
import {
  APP_CLASS,
  COLONNE_CLASS,
  CONTENEUR_CLASS,
  LIEN_EVITEMENT_CLASS,
  MAIN_CLASS,
  MAIN_ID,
  NAV_RANGEE_CLASS,
  NAV_CLASS,
  PIED_ADRESSE_CLASS,
  PIED_CLASS,
  PIED_INTERIEUR_CLASS,
  PIED_LIEN_CLASS,
  PIED_LIEN_LONG_CLASS,
  PIED_NAV_CLASS,
  PIED_NAV_LIEN_CLASS,
} from '../../src/config/classes-chrome.js'
// Le maillage vers les pages ville, métier et guides : la MÊME déclaration que
// src/App.js (pied de page React) et que src/pages/Home.js. Les libellés
// viennent de `pages-seo.json`, que le backend relit dans un garde — la
// coquille ne tient aucune seconde liste de villes ou de métiers.
import {
  GROUPES_LIENS_SEO,
  LIENS_SEO_CLASS,
  LIENS_SEO_GROUPE_CLASS,
  LIENS_SEO_SOMMAIRE_CLASS,
  LIENS_SEO_LIEN_CLASS,
} from '../../src/config/liens-seo.js'

// La page des CGU du pied de page : même valeur que src/App.js (son `<Link
// to="/terms">`), donc aucune divergence possible entre les deux canaux. Le
// pied de page renvoyait autrefois vers un .docx fusionné (confidentialité +
// CGU) : un crawler n'en lisait rien, et le lien n'était pas un lien interne.
const ROUTE_CGU = '/terms'

/** Le libellé du lien d'évitement est une DONNÉE : il s'échappe comme toute donnée. */
const escapeHtml = (texte) =>
  String(texte).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[caractere]))

export const NAV_PLACEHOLDER =
  `<nav class="${NAV_CLASS}">` +
  // La MÊME structure que src/components/Navbar.js : conteneur, puis rangée de
  // même hauteur. La rangée est vide ici (une barre sans contenu n'a rien à
  // répartir), mais elle porte la classe qui fixe la hauteur chez React.
  `<div class="${CONTENEUR_CLASS}"><div class="${NAV_RANGEE_CLASS}"></div></div>` +
  '</nav>'

// Ouverture et fermeture du chrome, séparées pour que les GARDES puissent
// exiger la même enveloppe dans les coquilles construites (elles lisent ces
// constantes au lieu de recopier une chaîne — même propriétaire, donc pas de
// dérive silencieuse possible entre la fabrique et son contrôle).
// ── LE LIEN D'ÉVITEMENT, PUBLIÉ PAR LA COQUILLE AUSSI ─────────────────────
// Il est le PREMIER arrêt de la touche Tab sur le document servi, avant tout
// JavaScript : sans lui, le lien n'existerait qu'après le montage de React, et
// un lecteur d'écran ou un utilisateur clavier qui arrive sur la page — le cas
// exact que le lien sert — ne l'aurait jamais trouvé. Son libellé se LIT dans
// le dictionnaire français (celui que la coquille publie partout ailleurs),
// jamais recopié : une clé renommée casse le build au lieu de publier un lien
// sans texte.
// Le libellé est LU dans le dictionnaire français (la coquille publie du
// français, comme pour le pied de page) : une copie écrite à la main était
// refusée par `scripts/check-shell-text-provenance.js` — un texte affiché en
// littéral dans un module de pré-rendu ne bouge pas quand la page change de
// mot. Ici la copie n'existe plus : renommer ou retoucher la clé se propage au
// document servi, et le contrat de `check-app-chrome.test.js` continue
// d'exiger l'égalité avec le dictionnaire.
// Le chemin se résout depuis le RÉPERTOIRE DE TRAVAIL (frontend/), comme
// `vite-plugins/prerender-route-meta.js` le fait pour le même fichier : `new
// URL('…', import.meta.url)` est RÉÉCRIT par Vite au passage du module dans le
// pipeline de vitest, qui refuse alors une URL qui n'est pas `file:` — la lecture
// échouait donc dans les tests du garde (`check-app-chrome.test.js`), pas au
// build. Une seule façon de nommer le dictionnaire, celle qui marche aux deux.
const DICTIONNAIRE_FR = JSON.parse(
  readFileSync(path.join(process.cwd(), 'src', 'i18n', 'fr.json'), 'utf8')
)

export const LIBELLE_EVITEMENT = DICTIONNAIRE_FR.skipToContent

if (!LIBELLE_EVITEMENT) {
  throw new Error(
    'prerender-app-chrome : la clé « skipToContent » est absente du dictionnaire français — ' +
      'le document servi publierait un lien d’évitement sans nom accessible'
  )
}

/**
 * Le lien d'évitement du document pré-rendu — même classe, même cible que
 * src/App.js (`LIEN_EVITEMENT_CLASS`, `MAIN_ID`), pour que la bascule
 * coquille → React ne change ni sa place, ni son texte, ni sa cible.
 */
export const LIEN_EVITEMENT_HTML =
  `<a class="${LIEN_EVITEMENT_CLASS}" href="#${MAIN_ID}">${escapeHtml(LIBELLE_EVITEMENT)}</a>`

export const CHROME_OUVERTURE =
  `<div class="${APP_CLASS}">` +
  `<div class="${COLONNE_CLASS}">` +
  LIEN_EVITEMENT_HTML +
  NAV_PLACEHOLDER +
  // `tabindex="-1"` : même raison que côté React — la cible doit pouvoir
  // recevoir le focus, sinon le lien ne fait que défiler.
  `<main id="${MAIN_ID}" tabindex="-1" class="${MAIN_CLASS}">`

// `main` se ferme ICI ; le pied de page et la fermeture des deux conteneurs
// viennent après (voir chromeDePage). Séparé pour que les gardes puissent
// exiger l'enveloppe complète sans recopier la chaîne.
export const CHROME_FERMETURE = '</main>'
export const FERMETURE_DE_L_APPLICATION = '</div></div>'

/**
 * Le PIED DE PAGE de l'application, publié une fois pour toutes les coquilles.
 *
 * Pourquoi il appartient au chrome (mesuré, 25/09/2026, sonde de géométrie
 * `e2e/geometrie-coquille-react.spec.js`) :
 *
 *   React rend `<LegalFooter />` APRÈS `</main>` sur TOUTES les routes
 *   (src/App.js). Les coquilles, elles, ne le publiaient que sur l'accueil — et
 *   à l'intérieur de `main`. Deux conséquences mesurées :
 *
 *     • sur les dix autres routes, le pied de page manquait : `main` (flex-1
 *       dans une colonne `min-h-screen`) se partageait donc la hauteur sans lui
 *       — mesuré sur /login desktop, `main` valait 875 px dans la coquille
 *       contre 794 px chez React (81 px de pied de page). Les pages dont le
 *       contenu est CENTRÉ verticalement (login, register, forgot-password,
 *       support) voyaient tout leur contenu décalé de 4 à 14 px au montage ;
 *     • sur l'accueil, il était DANS `main`, donc au-dessus du `pb-24` mobile
 *       (96 px) : mesuré, ses liens étaient 97 px trop haut à 412×823, et son
 *       rang de liens se répartissait autrement (les espaces de `flex-wrap` ne
 *       tombent pas au même endroit).
 *
 *   Il lit les mêmes sources que src/App.js : src/config/contact.js
 *   (`CONTACT`, `telHref`, `mailtoHref`) et les profils sociaux du build. Une
 *   clé de libellé disparue du dictionnaire CASSE le build ici plutôt que de
 *   publier une coquille dont le texte ne correspond plus à la page.
 */
/**
 * Le bloc de maillage — villes, métiers, guides — publié par le pied de page
 * ET par le corps de l'accueil (voir `buildHomeShell`).
 *
 * Exporté pour que les deux coquilles publient le MÊME balisage : la bascule
 * coquille → React ne doit déplacer ni un lien ni un libellé, et recopier cette
 * chaîne dans `shells-home.js` aurait été la seconde écriture qu'on vient de
 * supprimer côté pied de page.
 */
export function liensSeoHtml({ esc, T }) {
  // Un DÉPLIANT par famille, comme les deux rendus React : `<details>` est natif
  // donc la coquille n'a rien à simuler, et les liens sont DANS le document
  // publié même fermé — un dépliant masque, il ne retire pas.
  return (
    `<div class="${LIENS_SEO_CLASS}">` +
    GROUPES_LIENS_SEO.map(
      (groupe) =>
        `<details>` +
        `<summary class="${LIENS_SEO_SOMMAIRE_CLASS}">${esc(T(groupe.titreKey))}</summary>` +
        `<p class="${LIENS_SEO_GROUPE_CLASS}">` +
        groupe.liens
          .map(
            (lien) =>
              `<a href="${esc(lien.href)}" class="${LIENS_SEO_LIEN_CLASS}">${esc(lien.nom)}</a>`
          )
          .join('') +
        `</p>` +
        `</details>`
    ).join('') +
    `</div>`
  )
}

export function piedDePage({ esc, T, socialLinks = [] }) {
  const cles = [
    'contactWhatsapp',
    'footerItinerary',
    'footerAbout',
    'contactTitle',
    'footerPrivacy',
    'footerTerms',
    // Les trois titres du maillage : un dictionnaire amputé publierait le mot
    // « undefined » à la place du groupe (« Villes », « Métiers », « Guides »).
    ...GROUPES_LIENS_SEO.map((groupe) => groupe.titreKey),
  ]
  for (const cle of cles) {
    if (!T(cle)) {
      throw new Error(
        `prerender-app-chrome : la clé « ${cle} » du pied de page est introuvable — ` +
          'la coquille publierait le NOM de la clé là où React publie le libellé.'
      )
    }
  }
  return (
    `<footer class="${PIED_CLASS}">` +
    `<div class="${PIED_INTERIEUR_CLASS}">` +
    `<address class="${PIED_ADRESSE_CLASS}">` +
    `<span>${esc(CONTACT.address)}</span>` +
    `<a href="${esc(telHref)}" class="${PIED_LIEN_CLASS}">${esc(CONTACT.phoneDisplay)}</a>` +
    `<a href="${esc(mailtoHref)}" class="${PIED_LIEN_LONG_CLASS}">${esc(CONTACT.email)}</a>` +
    `<a href="${esc(CONTACT.whatsappUrl)}" target="_blank" rel="noreferrer" class="${PIED_LIEN_CLASS}">${esc(T('contactWhatsapp'))}</a>` +
    // Sans `aria-label` : le nom accessible doit être le texte VISIBLE
    // (« Itinéraire »), comme dans src/App.js — WCAG 2.5.3. `title` garde la
    // désignation cherchée par un audit de référencement local.
    `<a href="${esc(CONTACT.mapsUrl)}" target="_blank" rel="noreferrer" title="Google Maps" class="${PIED_LIEN_CLASS}">${esc(T('footerItinerary'))}</a>` +
    `</address>` +
    liensSeoHtml({ esc, T }) +
    `<div class="${PIED_NAV_CLASS}">` +
    `<a href="/about" class="${PIED_NAV_LIEN_CLASS}">${esc(T('footerAbout'))}</a>` +
    `<a href="/contact" class="${PIED_NAV_LIEN_CLASS}">${esc(T('contactTitle'))}</a>` +
    `<a href="/privacy" class="${PIED_NAV_LIEN_CLASS}">${esc(T('footerPrivacy'))}</a>` +
    `<a href="${ROUTE_CGU}" class="${PIED_NAV_LIEN_CLASS}">${esc(T('footerTerms'))}</a>` +
    socialLinks
      .map(
        (social) =>
          `<a href="${esc(social.url)}" target="_blank" rel="me noreferrer" class="${PIED_NAV_LIEN_CLASS}">${esc(social.label)}</a>`
      )
      .join('') +
    `</div>` +
    `</div>` +
    `</footer>`
  )
}

/**
 * Enveloppe le corps d'une coquille dans le chrome de l'application, puis le
 * chrome par le pied de page — l'ordre exact de src/App.js : navbar, `main`,
 * `</main>`, `<LegalFooter />`, fermeture des deux conteneurs.
 * Les classes sont celles de src/App.js, à l'identique — la bascule
 * coquille → React ne doit déplacer aucun élément (ni texte, ni encre).
 *
 * @param {string} corps Corps de page publié par la coquille.
 * @param {string} piedDePageHtml Sortie de `piedDePage(...)`.
 */
export function chromeDePage(corps, piedDePageHtml) {
  return (
    CHROME_OUVERTURE +
    corps +
    CHROME_FERMETURE +
    (piedDePageHtml || '') +
    FERMETURE_DE_L_APPLICATION
  )
}
