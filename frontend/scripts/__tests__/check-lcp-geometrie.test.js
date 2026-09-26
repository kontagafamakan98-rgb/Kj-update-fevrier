import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// LE LCP DE CES QUATRE ROUTES EST PEINT PAR LA COQUILLE PRÉ-RENDUE, et la
// géométrie qui le tient a UN propriétaire : la déclaration du corps de page
// (`src/config/page-sections.js`).
//
// ── Pourquoi une garantie PAR ROUTE, et pas seulement la sonde générale ─────
// `e2e/lcp-geometrie.spec.js` mesure TOUTES les routes pré-rendues, mais une
// divergence de géométrie peut y rester invisible tant qu'elle ne change pas
// l'aire : ce qui casse, c'est une peinture de React PLUS GRANDE que celle de
// la coquille, et deux classes différentes peuvent produire la même aire
// aujourd'hui puis diverger demain. Le FAIT est mesuré dans le navigateur
// (`e2e/lcp-geometrie-declaree.spec.js`, qui exige que l'élément ÉLU porte les
// classes déclarées) ; ici on refuse la CAUSE, à la source : une chaîne de
// classes recopiée dans un canal au lieu d'être lue dans le plan.
//
// ── Ce que la mesure a établi (25/09/2026) ─────────────────────────────────
// Chrome 152, sonde des candidates `largest-contentful-paint`, bundle d'entrée
// BLOQUÉ pour le canal coquille et navigation réelle pour l'autre, 412×823 et
// 1350×940 :
//
//   route            élément LCP (élu)                        coquille / React
//   /jobs            <p> l'introduction                        35 640 / 36 002 px²
//   /about           <p> l'introduction                        74 466 / 80 262 px²
//   /privacy         <p> le CORPS d'une section                84 360 / 86 676 px²
//   /how-it-works    <p> le sous-titre du héros                30 320 / 32 656 px²
//
// UNE SEULE candidate dans les deux canaux, horodatée au premier paint, d'aire
// IDENTIQUE de part et d'autre : c'est cette ÉGALITÉ qui fait que la peinture de
// la coquille reste celle que le navigateur retient (createRoot efface #root,
// React reconstruit le même texte, et un remplacement de MÊME TAILLE n'enregistre
// aucun nouvel élément LCP). Sur /privacy, l'élément élu est un CORPS DE SECTION
// et non l'introduction : la géométrie à déclarer est donc celle de la section.
//
// Les chaînes qui décident de ces aires étaient recopiées face à face dans
// `src/pages/*.js` et `vite-plugins/prerender/shells-routes.js` — le commentaire
// de la coquille de /jobs l'écrivait lui-même : « ses classes sont celles de
// src/pages/Jobs.js, à l'identique ». Retoucher un seul côté faisait diverger les
// deux peintures EN SILENCE, et c'est exactement ce que le LCP ne pardonne pas
// (mesuré sur /jobs avant correctif : `elementRenderDelay` de 1156 à 2345 ms,
// score desktop 92 au lieu de 100).
//
// Chaque refus est éprouvé sur une source MUTÉE : un garde qui ne sait plus
// mordre ne doit pas passer pour un garde vert. L'invariant d'amorçage dont
// dépend toute la garantie (React ne monte qu'après le premier paint) est tenu
// par UN SEUL garde, `check-home-hero-lcp.test.js` : il n'est pas recopié ici.

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (relative) => readFileSync(path.join(frontendDir, relative), 'utf8');

const PLAN = 'src/config/page-sections.js';
const COQUILLE = 'vite-plugins/prerender/shells-routes.js';

/**
 * Les quatre routes, leur élément LCP, et ce que chaque canal doit peindre.
 *
 * `classes` porte les chaînes MESURÉES : elles doivent exister dans le plan
 * (valeur des champs déclarés) et nulle part ailleurs — ni dans la page, ni dans
 * le corps de la coquille de la route.
 */
export const ROUTES_LCP = [
  {
    route: '/jobs',
    page: 'src/pages/Jobs.js',
    plan: 'jobsPlan',
    // Bornes du corps de la coquille DANS shells-routes.js : dix pages partagent
    // ce fichier, donc chercher un « recopiage » doit se limiter à ce corps.
    bornes: ['jobs: `', 'login: `'],
    identite: ["titleKey: 'availableJobs'", "introKey: 'intro'"],
    champs: [
      { champ: 'frameClass', page: 'className={pagePlan.frameClass}', coquille: 'class="${jobsPlan.frameClass}"' },
      { champ: 'titleClass', page: 'className={pagePlan.titleClass}', coquille: 'class="${jobsPlan.titleClass}"' },
      { champ: 'introClass', page: 'className={pagePlan.introClass}', coquille: 'class="${jobsPlan.introClass}"' },
    ],
    classes: [
      'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8',
      'text-3xl font-bold text-gray-900',
      'mb-6 max-w-3xl text-base leading-relaxed text-gray-600 min-h-[104px] md:min-h-[52px]',
    ],
  },
  {
    route: '/about',
    page: 'src/pages/About.js',
    plan: 'aboutPlan',
    bornes: ['about: `', 'contact: `'],
    identite: ["titleKey: 'aboutTitle'", "introKey: 'aboutIntro'"],
    champs: [
      { champ: 'frameClass', page: 'className={frameClass}', coquille: 'class="${aboutPlan.frameClass}"' },
      { champ: 'titleClass', page: 'className={titleClass}', coquille: 'class="${aboutPlan.titleClass}"' },
      { champ: 'introClass', page: 'className={introClass}', coquille: 'class="${aboutPlan.introClass}"' },
    ],
    classes: [
      'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12',
      'text-3xl font-bold text-gray-900 mb-4',
      'text-gray-600 mb-8',
    ],
  },
  {
    route: '/privacy',
    page: 'src/pages/Privacy.js',
    plan: 'privacyPlan',
    bornes: ['privacy: `', '\n  }\n  return SHELLS'],
    identite: ["titleKey: 'privacyTitle'", "introKey: 'privacyIntro'"],
    champs: [
      { champ: 'frameClass', page: 'className={frameClass}', coquille: 'class="${privacyPlan.frameClass}"' },
      { champ: 'titleClass', page: 'className={titleClass}', coquille: 'class="${privacyPlan.titleClass}"' },
      { champ: 'introClass', page: 'className={introClass}', coquille: 'class="${privacyPlan.introClass}"' },
      { champ: 'sectionTitleClass', page: 'className={sectionTitleClass}', coquille: 'class="${privacyPlan.sectionTitleClass}"' },
      { champ: 'sectionBodyClass', page: 'className={sectionBodyClass}', coquille: 'class="${privacyPlan.sectionBodyClass}"' },
    ],
    classes: [
      'max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12',
      'text-3xl font-bold text-gray-900 mb-4',
      'text-gray-600 mb-8',
      'text-xl font-semibold text-gray-900 mb-2',
      'text-gray-600',
    ],
  },
  {
    route: '/how-it-works',
    page: 'src/pages/HowItWorks.js',
    plan: 'howItWorksPlan',
    bornes: ["'how-it-works': `", 'support: `'],
    identite: ["titleKey: 'howItWorksTitle'", "heroKey: 'howItWorksHero'"],
    champs: [
      { champ: 'heroFrameClass', page: 'className={plan.heroFrameClass}', coquille: 'class="${howItWorksPlan.heroFrameClass}"' },
      { champ: 'heroTitleClass', page: 'className={plan.heroTitleClass}', coquille: 'class="${howItWorksPlan.heroTitleClass}"' },
      { champ: 'heroSubtitleClass', page: 'className={plan.heroSubtitleClass}', coquille: 'class="${howItWorksPlan.heroSubtitleClass}"' },
    ],
    classes: [
      'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 text-center',
      'text-3xl md:text-4xl font-bold mb-4',
      'text-lg opacity-90 max-w-2xl mx-auto',
    ],
  },
];

/**
 * Le corps d'une coquille, isolé du reste de `shells-routes.js`.
 *
 * Les dix pages partagent ce fichier, et deux d'entre elles peuvent porter une
 * chaîne de classes identique sans que ce soit un défaut : la recherche du
 * « recopiage » doit donc se limiter au corps de la route. Si une borne
 * disparaît, on ne peut plus RIEN vérifier — c'est un refus, pas un silence.
 *
 * @param {string} coquille Source de vite-plugins/prerender/shells-routes.js.
 * @param {[string, string]} bornes Marqueur de début, marqueur de fin.
 * @returns {{corps: string, erreur: string|null}}
 */
export function corpsDeLaCoquille(coquille, [debutMarqueur, finMarqueur]) {
  const debut = coquille.indexOf(debutMarqueur);
  const fin = coquille.indexOf(finMarqueur, debut + 1);
  if (debut === -1 || fin === -1 || fin < debut) {
    return {
      corps: '',
      erreur:
        `le corps de la coquille ${debutMarqueur.trim()} n'est plus délimité dans ${COQUILLE} ` +
        `(marqueurs « ${debutMarqueur} » et « ${finMarqueur.trim()} ») : plus rien ne peut être vérifié ` +
        'sur sa géométrie',
    };
  }
  return { corps: coquille.slice(debut, fin), erreur: null };
}

/**
 * La déclaration d'UNE route, isolée dans le plan.
 *
 * Le plan déclare dix pages, et deux d'entre elles peuvent porter le même nom
 * de champ — `introClass` sur /jobs ET sur /privacy — ou la même valeur
 * (`text-gray-600 mb-8` sur /about ET sur /privacy). Chercher dans tout le
 * fichier laisserait donc passer la disparition du champ de CETTE page,
 * masquée par celle d'une autre : c'est le premier refus que ce garde a manqué,
 * et il est écrit ici comme la raison de cette fonction.
 *
 * @param {string} plan Source de src/config/page-sections.js.
 * @param {string} route Route visée (« /jobs »).
 * @returns {{bloc: string, erreur: string|null}}
 */
export function blocDuPlan(plan, route) {
  const debut = plan.indexOf(`'${route}': {`);
  if (debut === -1) {
    return {
      bloc: '',
      erreur: `le plan (${PLAN}) ne déclare plus la route ${route} : plus rien ne peut être vérifié`,
    };
  }
  // Les entrées de premier niveau sont indentées de deux espaces ; les objets
  // imbriqués (`highlight`, `cards`) le sont davantage, donc la recherche du
  // bloc suivant ne tombe jamais sur un sous-objet.
  const suivante = plan.slice(debut + 1).search(/\n  '[^']*': \{/);
  const fin = suivante === -1 ? plan.length : debut + 1 + suivante;
  return { bloc: plan.slice(debut, fin), erreur: null };
}

/**
 * Refus opposés à un jeu de sources. Vide = la garantie est en place.
 *
 * @param {{plan: string, pages: Record<string, string>, coquille: string, routes?: typeof ROUTES_LCP}} sources
 * @returns {string[]}
 */
export function refusDuLcpDesRoutes({ plan, pages, coquille, routes = ROUTES_LCP }) {
  const refus = [];

  for (const { route, page, bornes, identite, champs, classes } of routes) {
    const source = pages[page] ?? '';

    const { bloc, erreur: erreurBloc } = blocDuPlan(plan, route);
    if (erreurBloc) {
      refus.push(erreurBloc);
      continue;
    }

    // 1. La déclaration porte l'identité de la page ET la géométrie de son plus
    //    grand texte — NOMMÉMENT : le plan déclare d'autres `titleKey`, donc
    //    chercher le seul nom du champ laisserait passer la perte du titre.
    for (const declaration of identite) {
      if (!bloc.includes(declaration)) {
        refus.push(
          `le plan (${PLAN}) ne déclare plus « ${declaration} » (${route}) : l'élément LCP de la page ` +
            "n'a plus de propriétaire, et sa disparition de la coquille ne serait plus refusée par le build"
        );
      }
    }
    for (const { champ } of champs) {
      // Ancrage en début de ligne : `heroTitleClass` contient « TitleClass » et
      // ferait passer cette recherche pour un autre champ.
      if (!new RegExp(`^\\s*${champ}:`, 'm').test(bloc)) {
        refus.push(
          `le plan (${PLAN}) ne déclare plus \`${champ}\` (${route}) : la géométrie des deux peintures ` +
            "n'a plus de propriétaire, donc une divergence silencieuse redevient possible"
        );
      }
    }
    // Les valeurs elles-mêmes : la chaîne mesurée doit être CELLE que le plan
    // déclare (un champ renommé avec une autre valeur passerait pour un champ
    // présent).
    for (const classe of classes) {
      if (!bloc.includes(classe)) {
        refus.push(
          `le plan (${PLAN}) ne porte plus la géométrie « ${classe.slice(0, 40)}… » de ${route} : ` +
            'la valeur mesurée a changé, ou elle a été déplacée dans un canal'
        );
      }
    }

    // 2. Aucun canal ne recopie la géométrie : une retouche d'un côté ferait
    //    diverger la taille des deux peintures, et une seconde peinture PLUS
    //    GRANDE devient un nouvel élément LCP.
    for (const classe of classes) {
      if (source.includes(classe)) {
        refus.push(
          `${page} recopie la géométrie du LCP de ${route} (« ${classe.slice(0, 40)}… ») au lieu de la ` +
            'lire dans le plan : les deux peintures peuvent diverger, et une seconde peinture PLUS GRANDE ' +
            'devient un nouvel élément LCP'
        );
      }
    }
    const { corps, erreur } = corpsDeLaCoquille(coquille, bornes);
    if (erreur) {
      refus.push(erreur);
    } else {
      for (const classe of classes) {
        if (corps.includes(classe)) {
          refus.push(
            `la coquille de ${route} (${COQUILLE}) recopie la géométrie « ${classe.slice(0, 40)}… » au ` +
              'lieu de lire le plan : la peinture du premier écran ne peut plus être celle de React'
          );
        }
      }
    }

    // 3. Les deux canaux LISENT cette déclaration, et la peignent.
    for (const { champ, page: attenduPage } of champs) {
      if (!source.includes(attenduPage)) {
        refus.push(
          `${page} ne peint plus la géométrie déclarée de ${route} (\`${attenduPage}\` attendu dans le ` +
            'JSX) : sa peinture pourrait cesser de correspondre à celle de la coquille'
        );
      }
    }
    if (!corps) {
      // Déjà refusé plus haut : ne pas empiler un second refus sur une extraction vide.
      continue;
    }
    for (const { champ, coquille: attenduCoquille } of champs) {
      if (!corps.includes(attenduCoquille)) {
        refus.push(
          `la coquille de ${route} ne peint plus la géométrie déclarée (\`${attenduCoquille}\` attendu) : ` +
            'le premier paint publierait une AUTRE géométrie que celle de React'
        );
      }
    }
  }

  return refus;
}

describe('le LCP des routes pré-rendues a un propriétaire unique', () => {
  const sources = {
    plan: lire(PLAN),
    pages: Object.fromEntries(ROUTES_LCP.map(({ page }) => [page, lire(page)])),
    coquille: lire(COQUILLE),
  };

  it('les quatre routes déclarent leur géométrie, et les deux canaux la lisent', () => {
    expect(refusDuLcpDesRoutes(sources)).toEqual([]);
  });

  it('couvre bien les quatre routes visées, avec leur élément LCP', () => {
    // Un vert sans sujet n'est pas un vert : le tableau doit porter les quatre
    // routes, et chacune son champ de corps (sur /privacy, le LCP est un CORPS
    // de section, pas l'introduction).
    expect(ROUTES_LCP.map(({ route }) => route)).toEqual([
      '/jobs',
      '/about',
      '/privacy',
      '/how-it-works',
    ]);
    expect(ROUTES_LCP.find(({ route }) => route === '/privacy').champs.map((c) => c.champ)).toContain(
      'sectionBodyClass'
    );
  });

  it('refuse une PAGE qui recopie la géométrie du plus grand texte', () => {
    const route = ROUTES_LCP[0];
    const muté = {
      ...sources,
      pages: { ...sources.pages, [route.page]: `${sources.pages[route.page]}\n// ${route.classes[2]}\n` },
    };
    const refus = refusDuLcpDesRoutes(muté);
    expect(refus.join('\n')).toContain(`${route.page} recopie la géométrie du LCP de ${route.route}`);
  });

  it('refuse une COQUILLE qui recopie la géométrie du plus grand texte', () => {
    for (const route of ROUTES_LCP) {
      // La coquille peint de nouveau la classe en littéral, comme avant la
      // refonte — sans que la borne du corps disparaisse (sinon le refus
      // obtenu serait celui de l'extraction, pas celui du recopiage).
      const { corps } = corpsDeLaCoquille(sources.coquille, route.bornes);
      const muté = {
        ...sources,
        coquille: sources.coquille.replace(corps, `${corps}\n      // ${route.classes[0]}\n`),
      };
      const refus = refusDuLcpDesRoutes(muté);
      expect(refus.join('\n')).toContain(`la coquille de ${route.route} (${COQUILLE}) recopie la géométrie`);
    }
  });

  it('refuse une déclaration qui perd la géométrie du plus grand texte', () => {
    for (const route of ROUTES_LCP) {
      const champ = route.champs[route.champs.length - 1].champ;
      // La mutation vise le bloc de CETTE route : un remplacement global
      // toucherait le premier `introClass:` du fichier, qui appartient à une
      // autre déclaration — le test doit viser son sujet.
      const debutBloc = sources.plan.indexOf(`'${route.route}': {`);
      expect(debutBloc, `la déclaration de ${route.route} est introuvable dans ${PLAN}`).toBeGreaterThan(
        -1
      );
      const bloc = sources.plan.slice(debutBloc);
      const muté = {
        ...sources,
        plan:
          sources.plan.slice(0, debutBloc) +
          bloc.replace(`${champ}:`, `champRetire:`),
      };
      const refus = refusDuLcpDesRoutes(muté);
      expect(refus.join('\n')).toContain(`le plan (${PLAN}) ne déclare plus \`${champ}\` (${route.route})`);
    }
  });

  it('refuse une déclaration dont la VALEUR n’est plus celle qui a été mesurée', () => {
    const route = ROUTES_LCP[3];
    const muté = {
      ...sources,
      plan: sources.plan.replace(route.classes[2], 'text-xs'),
    };
    const refus = refusDuLcpDesRoutes(muté);
    expect(refus.join('\n')).toContain('ne porte plus la géométrie');
  });

  it('refuse un canal qui cesse de lire la déclaration', () => {
    const route = ROUTES_LCP[2];
    const muté = {
      ...sources,
      pages: {
        ...sources.pages,
        [route.page]: sources.pages[route.page].replace(
          route.champs[4].page,
          'className="text-gray-600"'
        ),
      },
    };
    const refus = refusDuLcpDesRoutes(muté);
    expect(refus.join('\n')).toContain('ne peint plus la géométrie déclarée');
  });

  it('refuse une coquille dont le corps n’est plus délimité (plus rien ne serait vérifié)', () => {
    const muté = { ...sources, coquille: sources.coquille.replace('privacy: `', 'bloc: `') };
    const refus = refusDuLcpDesRoutes(muté);
    expect(refus.join('\n')).toContain("n'est plus délimité");
  });
});
