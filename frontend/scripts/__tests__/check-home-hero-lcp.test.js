import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le TITRE DU HÉROS de l'accueil est l'élément LCP de « / ».
//
// Deux invariants le protègent, et un défaut mesuré justifie chacun d'eux :
//
//  1. UN PROPRIÉTAIRE POUR LES DEUX PEINTURES. La coquille pré-rendue peint le
//     titre avant le JavaScript, puis React reconstruit le même. Les chaînes de
//     classes étaient recopiées face à face (src/pages/Home.js et
//     vite-plugins/prerender/shells-home.js) : retoucher l'une faisait diverger
//     la GÉOMÉTRIE des deux peintures sans que rien ne rougisse. Or c'est cette
//     géométrie qui décide : mesuré (Chrome 152, sonde LCP + trace), un
//     remplacement de MÊME TAILLE n'ajoute aucun élément LCP — la peinture de
//     la coquille reste celle que le navigateur retient — tandis qu'un
//     remplacement plus grand en enregistre un second, plus tardif. Sur 9 runs
//     Lighthouse (12.6.1, pile de la CI), les 3 runs dont le nœud LCP venait de
//     l'arbre React ont payé la chaîne JavaScript (LCP simulé 1481 à 3199 ms,
//     scores 93 à 95) ; les 6 autres, où le nœud LCP venait de la coquille,
//     avaient LCP = FCP et 99-100.
//
//  2. LE MONTAGE ATTEND LE PREMIER PAINT. createRoot() EFFACE #root au montage :
//     si React monte avant que le navigateur n'ait peint, le titre de la
//     coquille n'est jamais peint et l'élément LCP devient celui que React
//     reconstruit — une peinture déclenchée PAR le JavaScript. La course est
//     perdue dès que le script d'entrée s'exécute avant le premier paint du
//     document : mesuré, deux requestAnimationFrame ne suffisent pas (le paint
//     arrive après elles), le signal qui marche est l'entry
//     `first-contentful-paint`.
//
// Ce test lit les SOURCES réelles et refuse une régression sur les deux
// invariants ; il éprouve aussi chaque refus sur une source mutée, pour qu'un
// garde qui ne sait plus mordre ne passe pas pour un garde vert.

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (relative) => readFileSync(path.join(frontendDir, relative), 'utf8');

const PLAN = 'src/config/page-sections.js';
const PAGE = 'src/pages/Home.js';
const COQUILLE = 'vite-plugins/prerender/shells-home.js';
const AMORCAGE = 'src/index.js';

// Les DEUX chaînes de classes de géométrie du héros : elles ne doivent exister
// QUE dans la déclaration (le plan), jamais recopiées dans un canal.
const CLASSES_DU_HEROS = [
  'text-3xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 leading-tight max-w-4xl mx-auto',
  'text-lg md:text-xl lg:text-2xl mb-8 opacity-90 max-w-3xl mx-auto',
];

/**
 * Refus opposés à un jeu de sources. Vide = la classe de défaut est fermée.
 *
 * @param {{plan: string, page: string, coquille: string, amorcage: string}} sources
 * @returns {string[]}
 */
export function refusDuHerosLcp({ plan, page, coquille, amorcage }) {
  const refus = [];

  // 1. La déclaration porte le titre, le sous-titre et leur géométrie —
  //    NOMMÉMENT : le plan déclare d'autres `titleKey` (les promesses), donc
  //    chercher le seul nom du champ laisserait passer la perte du héros.
  for (const declaration of [
    "titleKey: 'heroTitle'",
    "subtitleKey: 'heroSubtitle'",
    /heroTitleClass\s*[,:]/,
    /heroSubtitleClass\s*[,:]/,
  ]) {
    const present =
      typeof declaration === 'string' ? plan.includes(declaration) : declaration.test(plan);
    if (!present) {
      refus.push(
        `le plan (${PLAN}) ne déclare plus ${String(declaration)} : le héros n'a plus de propriétaire, ` +
          'et sa disparition de la coquille ne serait plus refusée par le build'
      );
    }
  }

  // 2. Aucun canal ne recopie la géométrie : une retouche d'un côté ferait
  //    diverger la taille des deux peintures, en silence.
  for (const [nom, source] of [['la page', page], ['la coquille', coquille]]) {
    for (const classes of CLASSES_DU_HEROS) {
      if (source.includes(classes)) {
        refus.push(
          `${nom} recopie la géométrie du héros (« ${classes.slice(0, 32)}… ») au lieu de lire ` +
            '`heroTitleClass` / `heroSubtitleClass` : les deux peintures peuvent diverger, et une ' +
            'seconde peinture PLUS GRANDE devient un nouvel élément LCP'
        );
      }
    }
  }

  // 3. Les deux canaux lisent cette déclaration (clé i18n comprise).
  if (!/PAGE_SECTIONS\['\/'\]/.test(page) || !/heroTitleClass/.test(page)) {
    refus.push(`${PAGE} ne lit plus la géométrie du héros dans ${PLAN}`);
  }
  if (!/pageSections\['\/'\]/.test(coquille) || !/heroTitleClass/.test(coquille)) {
    refus.push(`${COQUILLE} ne lit plus la géométrie du héros dans ${PLAN}`);
  }

  // 4. Le montage de React attend le premier paint.
  if (!/first-contentful-paint/.test(amorcage)) {
    refus.push(
      `${AMORCAGE} ne monte plus React après le premier paint : la coquille peut être effacée ` +
        'avant d’avoir été peinte, et l’élément LCP redevient la peinture de React'
    );
  }
  const montages = [...amorcage.matchAll(/root\.render\(/g)].length;
  if (montages !== 1) {
    refus.push(
      `${AMORCAGE} monte React depuis ${montages} endroit(s) : le montage doit passer par le seul ` +
        'chemin qui attend le premier paint'
    );
  }
  if (!/setTimeout\(monterApresLePremierPaint/.test(amorcage)) {
    refus.push(
      `${AMORCAGE} n’a plus de filet borné dans le temps : un onglet en arrière-plan ne peint pas ` +
        'et l’application ne se monterait jamais'
    );
  }

  return refus;
}

describe('le titre du héros de l’accueil (élément LCP de « / »)', () => {
  const sources = {
    plan: lire(PLAN),
    page: lire(PAGE),
    coquille: lire(COQUILLE),
    amorcage: lire(AMORCAGE),
  };

  it('a un seul propriétaire — la déclaration du corps de page — et les deux canaux la lisent', () => {
    expect(refusDuHerosLcp(sources)).toEqual([]);
  });

  it('refuse une page qui recopie la géométrie du héros', () => {
    const muté = { ...sources, page: `${sources.page}\n// ${CLASSES_DU_HEROS[0]}\n` };
    const refus = refusDuHerosLcp(muté);
    expect(refus.join('\n')).toContain('la page recopie la géométrie du héros');
  });

  it('refuse une coquille qui recopie la géométrie du héros', () => {
    const muté = { ...sources, coquille: `${sources.coquille}\n// ${CLASSES_DU_HEROS[1]}\n` };
    const refus = refusDuHerosLcp(muté);
    expect(refus.join('\n')).toContain('la coquille recopie la géométrie du héros');
  });

  it('refuse une déclaration qui perd le titre du héros', () => {
    const muté = { ...sources, plan: sources.plan.replace(/^\s*titleKey: 'heroTitle',\r?$/m, '') };
    const refus = refusDuHerosLcp(muté);
    expect(refus.join('\n')).toContain("titleKey: 'heroTitle'");
  });

  it('refuse un montage qui devance le premier paint', () => {
    const muté = { ...sources, amorcage: sources.amorcage.replace(/first-contentful-paint/g, 'x') };
    const refus = refusDuHerosLcp(muté);
    expect(refus.join('\n')).toContain('ne monte plus React après le premier paint');
  });
});
