import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le PARAGRAPHE D'INTRODUCTION de /contact est l'élément LCP de la page, et
// c'est la COQUILLE PRÉ-RENDUE qui le peint.
//
// ── Ce que la mesure a établi ───────────────────────────────────────────────
// Sonde des candidates `largest-contentful-paint` (Chrome 152, pile de la CI,
// serveur de rewrites de vercel.json, build local) : UNE SEULE candidate, à
// l'instant du FCP (t = 92 ms à 412×823, 108 ms à 1350×940), sur le
// `<p class="text-gray-600 mb-3">` de l'introduction, et de même aire que celui
// que React reconstruit (57 213,8 px² mobile / 65 520 px² desktop mesurés dans
// les deux canaux — JavaScript coupé pour la coquille, activé pour React).
//
// ── Ce qui la ferait tomber ─────────────────────────────────────────────────
// createRoot() EFFACE #root : React reconstruit le paragraphe. Un remplacement
// de MÊME TAILLE n'enregistre aucun nouvel élément LCP (la peinture de la
// coquille reste celle que le navigateur retient), mais un remplacement PLUS
// GRAND en enregistre un second, plus tardif — et toute la chaîne JavaScript
// entre alors dans le graphe LCP simulé de Lantern. Mesuré sur /jobs, où la
// géométrie avait divergé : `elementRenderDelay` de 1156 à 2345 ms, score
// desktop 92 au lieu de 100.
//
// Les quatre chaînes de classes qui décident de cette aire étaient recopiées
// face à face dans src/pages/Contact.js et dans
// vite-plugins/prerender/shells-routes.js : retoucher l'une faisait diverger
// les deux peintures EN SILENCE. Elles ont maintenant UN propriétaire — la
// déclaration du corps de page — et ce test refuse qu'un canal les recopie ou
// cesse de les lire. L'invariant d'amorçage dont dépend la garantie (React ne
// monte qu'après le premier paint) est tenu par UN SEUL garde,
// scripts/__tests__/check-home-hero-lcp.test.js : il n'est pas recopié ici.
//
// Chaque refus est éprouvé sur une source MUTÉE : un garde qui ne sait plus
// mordre ne doit pas passer pour un garde vert.

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (relative) => readFileSync(path.join(frontendDir, relative), 'utf8');

const PLAN = 'src/config/page-sections.js';
const PAGE = 'src/pages/Contact.js';
const COQUILLE = 'vite-plugins/prerender/shells-routes.js';

/** Les quatre chaînes de géométrie : elles ne doivent exister QUE dans le plan. */
const CLASSES_DU_LCP = [
  'max-w-2xl mx-auto px-4 py-8',
  'text-3xl font-bold text-gray-900 mb-2',
  'text-gray-600 mb-3',
  'text-sm text-gray-500 mb-6',
];

/** Les champs du plan, et comment chaque canal doit les peindre. */
const CHAMPS = [
  { champ: 'frameClass', page: 'className={frameClass}', coquille: 'class="${contactPlan.frameClass}"' },
  { champ: 'titleClass', page: 'className={titleClass}', coquille: 'class="${contactPlan.titleClass}"' },
  { champ: 'introClass', page: 'className={introClass}', coquille: 'class="${contactPlan.introClass}"' },
  { champ: 'noteClass', page: 'className={noteClass}', coquille: 'class="${contactPlan.noteClass}"' },
];

/**
 * Le corps de la coquille /contact, isolé du reste de `shells-routes.js`.
 *
 * Les six pages de confiance partagent ce fichier, et deux d'entre elles
 * peuvent porter une chaîne de classes identique sans que ce soit un défaut :
 * la recherche du « recopiage » doit donc se limiter au corps de /contact.
 * L'extraction est bornée par les deux marqueurs du fichier ; si l'un disparaît,
 * on ne peut plus RIEN vérifier et c'est un refus, pas un silence.
 *
 * @param {string} coquille Source de vite-plugins/prerender/shells-routes.js.
 * @returns {{corps: string, erreur: string|null}}
 */
export function corpsContact(coquille) {
  const debut = coquille.indexOf('contact: `');
  const fin = coquille.indexOf('privacy: `', debut + 1);
  if (debut === -1 || fin === -1 || fin < debut) {
    return {
      corps: '',
      erreur:
        `le corps de la coquille /contact n'est plus délimité dans ${COQUILLE} ` +
        '(marqueurs `contact: \`` et `privacy: \``) : plus rien ne peut être vérifié sur sa géométrie',
    };
  }
  return { corps: coquille.slice(debut, fin), erreur: null };
}

/**
 * Refus opposés à un jeu de sources. Vide = la garantie est en place.
 *
 * @param {{plan: string, page: string, coquille: string}} sources
 * @returns {string[]}
 */
/**
 * La déclaration de /contact SEULE, isolée dans le plan.
 *
 * Le plan déclare dix pages, et depuis le 25/09/2026 quatre d'entre elles
 * déclarent un `introClass` (`/jobs`, `/about`, `/privacy`) ou un `frameClass`
 * de mêmes octets. Chercher dans TOUT le fichier laisserait donc passer la
 * disparition du champ de CETTE page, masquée par celle d'une autre — c'est le
 * défaut que ce garde a présenté le jour où les autres routes ont déclaré leur
 * géométrie, et la raison de cette fonction.
 *
 * @param {string} plan Source de src/config/page-sections.js.
 * @returns {{bloc: string, erreur: string|null}}
 */
export function blocDuPlanContact(plan) {
  const debut = plan.indexOf("'/contact': {");
  if (debut === -1) {
    return {
      bloc: '',
      erreur: `le plan (${PLAN}) ne déclare plus /contact : plus rien ne peut être vérifié`,
    };
  }
  const suivante = plan.slice(debut + 1).search(/\n  '[^']*': \{/);
  const fin = suivante === -1 ? plan.length : debut + 1 + suivante;
  return { bloc: plan.slice(debut, fin), erreur: null };
}

/**
 * Refus opposés à un jeu de sources. Vide = la garantie est en place.
 *
 * @param {{plan: string, page: string, coquille: string}} sources
 * @returns {string[]}
 */
export function refusDuLcpDeContact({ plan, page, coquille }) {
  const refus = [];

  // Le bloc de /contact : voir `blocDuPlanContact` — dix pages partagent ce
  // fichier, donc chercher dans tout le plan confondrait cette route avec une
  // autre.
  const { bloc, erreur: erreurBloc } = blocDuPlanContact(plan);
  if (erreurBloc) {
    refus.push(erreurBloc);
    return refus;
  }

  // 1. La déclaration porte l'identité de la page ET la géométrie de ses textes
  //    — NOMMÉMENT : le plan déclare d'autres `titleKey` (des promesses, des
  //    sections), donc chercher le seul nom du champ laisserait passer la perte
  //    du titre de /contact.
  for (const declaration of ["titleKey: 'contactTitle'", "introKey: 'contactIntro'"]) {
    if (!bloc.includes(declaration)) {
      refus.push(
        `le plan (${PLAN}) ne déclare plus ${declaration} : l'introduction — l'élément LCP de la ` +
          'page — n’a plus de propriétaire, et sa disparition de la coquille ne serait plus refusée par le build'
      );
    }
  }
  for (const { champ } of CHAMPS) {
    // Ancrage en début de ligne : `heroTitleClass` contient « TitleClass » et
    // ferait passer cette recherche pour le titre de l'accueil.
    if (!new RegExp(`^\\s*${champ}:`, 'm').test(bloc)) {
      refus.push(
        `le plan (${PLAN}) ne déclare plus \`${champ}\` : la géométrie des deux peintures n'a plus ` +
          'de propriétaire, donc une divergence silencieuse redevient possible'
      );
    }
  }

  // 2. Aucun canal ne recopie la géométrie : une retouche d'un côté ferait
  //    diverger la taille des deux peintures, et une seconde peinture PLUS
  //    GRANDE devient un nouvel élément LCP.
  for (const classes of CLASSES_DU_LCP) {
    if (page.includes(classes)) {
      refus.push(
        `${PAGE} recopie la géométrie de l'introduction (« ${classes.slice(0, 32)}… ») au lieu de ` +
          'lire `introClass` / `frameClass` : les deux peintures peuvent diverger, et une seconde ' +
          'peinture PLUS GRANDE devient un nouvel élément LCP'
      );
    }
  }
  const { corps, erreur } = corpsContact(coquille);
  if (erreur) {
    refus.push(erreur);
  } else {
    for (const classes of CLASSES_DU_LCP) {
      if (corps.includes(classes)) {
        refus.push(
          `la coquille de /contact (${COQUILLE}) recopie la géométrie (« ${classes.slice(0, 32)}… ») ` +
            'au lieu de lire le plan : la peinture du premier écran ne peut plus être celle de React'
        );
      }
    }
  }

  // 3. Les deux canaux LISENT cette déclaration, et la peignent.
  if (!/PAGE_SECTIONS\['\/contact'\]/.test(page)) {
    refus.push(`${PAGE} ne lit plus le plan de /contact dans ${PLAN}`);
  }
  for (const { champ, page: attenduPage } of CHAMPS) {
    if (!page.includes(attenduPage)) {
      refus.push(`${PAGE} ne peint plus la géométrie déclarée (${attenduPage} attendu dans le JSX)`);
    }
  }
  if (!corps) {
    // Déjà refusé plus haut : ne pas empiler un second refus sur une extraction vide.
    return refus;
  }
  if (!/contactPlan/.test(coquille)) {
    refus.push(`${COQUILLE} ne lit plus le plan de /contact`);
  }
  for (const { champ, coquille: attenduCoquille } of CHAMPS) {
    if (!corps.includes(attenduCoquille)) {
      refus.push(
        `la coquille de /contact ne peint plus la géométrie déclarée (${attenduCoquille} attendu) : ` +
          'le premier paint publierait une AUTRE géométrie que celle de React'
      );
    }
  }
  return refus;
}

describe('le paragraphe d’introduction de /contact (élément LCP de la page)', () => {
  const sources = {
    plan: lire(PLAN),
    page: lire(PAGE),
    coquille: lire(COQUILLE),
  };

  it('a un seul propriétaire — le plan de la page — et les deux canaux le peignent', () => {
    expect(refusDuLcpDeContact(sources)).toEqual([]);
  });

  it('refuse une page qui recopie la géométrie de l’introduction', () => {
    const muté = { ...sources, page: `${sources.page}\n// ${CLASSES_DU_LCP[2]}\n` };
    const refus = refusDuLcpDeContact(muté);
    expect(refus.join('\n')).toContain(`${PAGE} recopie la géométrie`);
  });

  it('refuse une coquille qui recopie la géométrie du cadre', () => {
    const muté = {
      ...sources,
      coquille: sources.coquille.replace(
        '<div class="${contactPlan.frameClass}">',
        `<div class="${CLASSES_DU_LCP[0]}">`
      ),
    };
    const refus = refusDuLcpDeContact(muté);
    expect(refus.join('\n')).toContain(`la coquille de /contact (${COQUILLE}) recopie la géométrie`);
  });

  it('refuse une déclaration qui perd la géométrie de l’introduction', () => {
    // La mutation vise le bloc de /contact : un `replace` global vise le PREMIER
    // `introClass:` du fichier, qui n'appartient plus à /contact depuis que
    // /jobs, /about et /privacy déclarent le leur (mesuré le 25/09/2026 : ce test
    // rougissait pour une AUTRE route que la sienne).
    const debut = sources.plan.indexOf("'/contact': {");
    const muté = {
      ...sources,
      plan:
        sources.plan.slice(0, debut) +
        sources.plan.slice(debut).replace('introClass:', 'champRetire:'),
    };
    const refus = refusDuLcpDeContact(muté);
    expect(refus.join('\n')).toContain('introClass');
  });

  it('refuse une déclaration qui perd le titre de la page', () => {
    const muté = { ...sources, plan: sources.plan.replace(/^\s*titleKey: 'contactTitle',\r?$/m, '') };
    const refus = refusDuLcpDeContact(muté);
    expect(refus.join('\n')).toContain("titleKey: 'contactTitle'");
  });

  it('refuse une page qui n’emplit plus le cadre déclaré', () => {
    const muté = { ...sources, page: sources.page.replace('className={frameClass}', 'className="x"') };
    const refus = refusDuLcpDeContact(muté);
    expect(refus.join('\n')).toContain('ne peint plus la géométrie déclarée');
  });

  it('refuse une coquille dont le corps n’est plus délimité (plus rien ne serait vérifié)', () => {
    const muté = { ...sources, coquille: sources.coquille.replace('contact: `', 'bloc: `') };
    const refus = refusDuLcpDeContact(muté);
    expect(refus.join('\n')).toContain("n'est plus délimité");
  });
});
