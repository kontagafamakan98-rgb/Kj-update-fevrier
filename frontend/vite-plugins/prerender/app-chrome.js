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
import { CONTACT, mailtoHref, telHref } from '../../src/config/contact.js'

// Le document légal du pied de page : même valeur que src/App.js (qui la tient
// en littéral local), donc aucune divergence possible entre les deux canaux.
const DOCUMENT_LEGAL = '/legal/kojo_politique_confidentialite_et_cgu_fusionnees.docx'

export const NAV_PLACEHOLDER =
  '<nav class="sticky top-0 z-50 border-b bg-white/95 shadow-sm backdrop-blur">' +
  '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16"></div>' +
  '</nav>'

// Ouverture et fermeture du chrome, séparées pour que les GARDES puissent
// exiger la même enveloppe dans les coquilles construites (elles lisent ces
// constantes au lieu de recopier une chaîne — même propriétaire, donc pas de
// dérive silencieuse possible entre la fabrique et son contrôle).
export const CHROME_OUVERTURE =
  '<div class="App">' +
  '<div class="min-h-screen bg-gray-50 relative flex flex-col">' +
  NAV_PLACEHOLDER +
  '<main class="flex-1 pb-24 md:pb-0">'

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
export function piedDePage({ esc, T, socialLinks = [] }) {
  const cles = ['contactWhatsapp', 'footerItinerary', 'footerAbout', 'contactTitle', 'footerPrivacy', 'footerTerms']
  for (const cle of cles) {
    if (!T(cle)) {
      throw new Error(
        `prerender-app-chrome : la clé « ${cle} » du pied de page est introuvable — ` +
          'la coquille publierait le NOM de la clé là où React publie le libellé.'
      )
    }
  }
  return (
    `<footer class="border-t border-orange-100 bg-white/95 backdrop-blur-sm">` +
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">` +
    `<address class="not-italic flex flex-wrap items-center justify-center md:justify-end gap-x-4 gap-y-2 text-xs text-gray-600">` +
    `<span>${esc(CONTACT.address)}</span>` +
    `<a href="${esc(telHref)}" class="hover:text-orange-700 underline underline-offset-2">${esc(CONTACT.phoneDisplay)}</a>` +
    `<a href="${esc(mailtoHref)}" class="hover:text-orange-700 underline underline-offset-2 break-all">${esc(CONTACT.email)}</a>` +
    `<a href="${esc(CONTACT.whatsappUrl)}" target="_blank" rel="noreferrer" class="hover:text-orange-700 underline underline-offset-2">${esc(T('contactWhatsapp'))}</a>` +
    `<a href="${esc(CONTACT.mapsUrl)}" target="_blank" rel="noreferrer" aria-label="Google Maps" title="Google Maps" class="hover:text-orange-700 underline underline-offset-2">${esc(T('footerItinerary'))}</a>` +
    `</address>` +
    `<div class="flex flex-wrap items-center justify-center md:justify-end gap-4 text-sm text-orange-700">` +
    `<a href="/about" class="hover:text-orange-800 underline underline-offset-2">${esc(T('footerAbout'))}</a>` +
    `<a href="/contact" class="hover:text-orange-800 underline underline-offset-2">${esc(T('contactTitle'))}</a>` +
    `<a href="/privacy" class="hover:text-orange-800 underline underline-offset-2">${esc(T('footerPrivacy'))}</a>` +
    `<a href="${DOCUMENT_LEGAL}" target="_blank" rel="noreferrer" class="hover:text-orange-800 underline underline-offset-2">${esc(T('footerTerms'))}</a>` +
    socialLinks
      .map(
        (social) =>
          `<a href="${esc(social.url)}" target="_blank" rel="me noreferrer" class="hover:text-orange-800 underline underline-offset-2">${esc(social.label)}</a>`
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
