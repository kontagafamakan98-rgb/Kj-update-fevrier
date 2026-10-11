import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le HÉROS de l'accueil porte l'élément LCP de « / » : son TITRE jusqu'au
// 27/09/2026, son ILLUSTRATION depuis la refonte éditoriale de ce jour-là
// (re-mesuré le 29/09/2026 sur la PHOTO 3/4 publiée à la place du dessin, les
// deux canaux : 69 920 px² en mobile et 306 870 en desktop pour l'image, contre
// 37 400 et 110 500 pour le titre à sa dernière mesure du 28/09/2026 — une seule
// candidate, au
// premier paint). Les deux invariants ci-dessous gardent donc leur raison
// d'être : c'est la GÉOMÉTRIE de la boîte reconstruite par React qui décide si
// Chrome ré-élit une seconde peinture plus tardive, et elle vaut pour le titre
// comme pour l'image.
//
// Deux invariants le protègent, et un défaut mesuré justifie chacun d'eux :
//
//  1. UN PROPRIÉTAIRE POUR LES DEUX PEINTURES (du titre ; l'illustration, elle,
//     n'a qu'un propriétaire par construction — un fichier de `public/assets/`). La coquille pré-rendue peint le
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
// L'`<img>` du héros (le composant React), le plugin qui écrit le `<head>`
// d'index.html, et index.html lui-même — le préchargement de la photo de tête
// vit dans le second et doit lire son chemin dans son domicile, jamais dans le
// troisième (voir le 5e refus).
const COMPOSANT = 'src/components/PhotoDuHeros.js';
const PLUGIN_HEAD = 'vite-plugins/prerender-route-meta.js';
const INDEX_HTML = 'index.html';

// Les DEUX chaînes de classes de géométrie du héros : elles ne doivent exister
// QUE dans la déclaration (le plan), jamais recopiées dans un canal.
//
// Mises à jour le 28/09/2026 avec la refonte éditoriale : ce sont les VALEURS
// MESURÉES d'aujourd'hui. Les laisser sur les anciennes chaînes rendait le
// second verdict VIDE — il refuse de retrouver ces chaînes dans un canal, et
// elles n'existaient plus nulle part, donc il ne pouvait plus rien refuser.
// Un garde qu'on ne peut plus faire mordre est un garde qu'on croit vert.
const CLASSES_DU_HEROS = [
  'titre-heros mb-5 md:mb-7 max-w-4xl mx-auto',
  'text-lg md:text-xl lg:text-2xl mb-8 text-white/90 max-w-3xl mx-auto',
];

/**
 * Refus opposés à un jeu de sources. Vide = la classe de défaut est fermée.
 *
 * @param {{plan: string, page: string, coquille: string, amorcage: string,
 *   composant: string, pluginHead: string, indexHtml: string}} sources
 * @returns {string[]}
 */
export function refusDuHerosLcp({ plan, page, coquille, amorcage, composant, pluginHead, indexHtml }) {
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

  // 5. LA PHOTO DE TÊTE EST PRÉCHARGÉE DEPUIS SON DOMICILE, ET LES DEUX CANAUX
  //    LA DÉCODENT SYNCHRONEMENT (07/10/2026, préchargement retypé le
  //    08/10/2026).
  //    L'image est l'élément LCP de « / » (69 920 px²), mais elle se DÉCODE plus
  //    tard que le texte : en `decoding="async"`, mesuré sur Chromium (412×823,
  //    CPU limité par CDP), la navigation réelle sortait DEUX candidates — le
  //    `<h1>` du héros, puis l'`<img>` ~100 à 400 ms plus tard — c'est-à-dire un
  //    élément LCP ré-élu par le repaint, toute la chaîne JavaScript facturée
  //    dans le graphe LCP simulé de Lantern. Le préchargement démarre la
  //    requête pendant l'analyse du `<head>`, donc bien avant que le corps ne
  //    soit atteint, et le décodage synchrone fait tomber les deux peintures
  //    dans la MÊME trame : mesuré, UNE seule candidate dès ×1.
  //    Les deux refus ci-dessous gardent les deux moitiés du remède : un
  //    préchargement qui ne LIT plus son chemin dans src/config/photos-heros.js
  //    (un littéral recopié ici ne suivrait pas un changement de photo), et un
  //    canal qui redescend en décodage asynchrone alors que l'autre non.
  //
  //    ── CE QUI A CHANGÉ LE 08/10/2026, ET POURQUOI LA RÈGLE A SUIVI ──────
  //    La photo est publiée dans un `<picture>` (AVIF, WebP, puis JPEG), donc
  //    le préchargement n'est plus un `href` vers le JPEG : il porte le MÊME
  //    `srcset` que les `<source>` du corps et son `sizes`, lus du même module
  //    (`srcsetHeros`, `PHOTO_HEROS_SIZES`). Garder l'ancienne exigence
  //    (`PHOTOS_HEROS[0]`) aurait refusé un préchargement CORRECT — et l'aurait
  //    fait au nom du LCP, alors que précharger le JPEG pendant que le corps
  //    choisit l'AVIF télécharge DEUX fichiers pour une seule photo, ce qui est
  //    exactement le défaut que ce préchargement existe pour éviter. La règle
  //    demande donc toujours que le préchargement soit DÉRIVÉ du domicile (et
  //    non recopié), sans nommer la forme du lien.
  if (
    !/as="image"/.test(pluginHead) ||
    !/srcsetHeros\(/.test(pluginHead) ||
    !/PHOTO_HEROS_SIZES/.test(pluginHead)
  ) {
    refus.push(
      `${PLUGIN_HEAD} n'émet plus le préchargement de la photo de tête depuis ` +
        'src/config/photos-heros.js (`srcsetHeros`, `PHOTO_HEROS_SIZES`, `as="image"`) : la ' +
        'requête de l’image LCP repartirait à l’analyse du corps, donc après le texte, et le ' +
        'repaint deviendrait l’élément LCP'
    )
  }
  if (/kojo-hero/.test(indexHtml)) {
    refus.push(
      `${INDEX_HTML} cite un chemin de photo du héros en littéral — le préchargement est écrit ` +
        'par le plugin, depuis src/config/photos-heros.js : deux propriétaires du même fait ' +
        'divergent au premier changement de photo, en silence'
    )
  }
  for (const [nom, source] of [
    ['le composant React', composant],
    ['la coquille', coquille],
  ]) {
    if (!/decoding="sync"/.test(source)) {
      refus.push(          `${nom} ne décode plus la photo du héros en synchrone (decoding="async") : elle se ` +
          'peindrait une trame après le texte, et Chrome ré-élirait un second élément LCP'
      )
    }
  }

  return refus;
}

describe('le titre du héros de l’accueil (élément LCP de « / »)', () => {
  const sources = {
    plan: lire(PLAN),
    page: lire(PAGE),
    coquille: lire(COQUILLE),
    amorcage: lire(AMORCAGE),
    composant: lire(COMPOSANT),
    pluginHead: lire(PLUGIN_HEAD),
    indexHtml: lire(INDEX_HTML),
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

  it('refuse un préchargement de la photo écrit en littéral dans le plugin', () => {
    const muté = {
      ...sources,
      pluginHead: sources.pluginHead.replace(/srcsetHeros\(0, 'avif'\)/g, "'/assets/kojo-hero-480.avif 480w'"),
    };
    expect(refusDuHerosLcp(muté).join('\n')).toContain('n\'émet plus le préchargement de la photo de tête');
  });

  it('refuse un préchargement qui a perdu son `srcset` (donc le candidat du corps)', () => {
    // Le défaut que la retype du 08/10/2026 ferme : un préchargement d'IMAGE
    // sans `imagesrcset` demande le fichier du `href` pendant que le `<picture>`
    // en choisit un autre — deux téléchargements pour une seule photo.
    const muté = {
      ...sources,
      pluginHead: sources.pluginHead.replace(/imagesrcset="[^"]*"/g, 'href="/assets/kojo-hero.jpg"'),
    };
    expect(refusDuHerosLcp(muté).join('\n')).toContain('n\'émet plus le préchargement de la photo de tête');
  });

  it('refuse un index.html qui cite la photo du héros en littéral', () => {
    const muté = {
      ...sources,
      indexHtml: sources.indexHtml.replace(
        '<head>',
        '<head>\n    <link rel="preload" as="image" href="/assets/kojo-hero.jpg">'
      ),
    };
    const refus = refusDuHerosLcp(muté);
    expect(refus.join('\n')).toContain('cite un chemin de photo du héros en littéral');
  });

  it('refuse un canal qui redescend en décodage asynchrone', () => {
    const muté = {
      ...sources,
      composant: sources.composant.replaceAll('decoding="sync"', 'decoding="async"'),
    };
    const refus = refusDuHerosLcp(muté);
    expect(refus.join('\n')).toContain('le composant React ne décode plus la photo du héros en synchrone');
  });
});
