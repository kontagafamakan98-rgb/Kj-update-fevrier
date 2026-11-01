#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — les documents `/en` servent-ils `lang`, `canonical` et
 * des `hreflang` RÉCIPROQUES, et le sitemap les énumère-t-il ?
 *
 * ── Le fait que cette sonde mesure ─────────────────────────────────────────
 * Depuis le 30/10/2026, le frontend publie un document par langue indexée
 * (`/jobs` en français, `/en/jobs` en anglais) et chaque document porte ses
 * `<link rel="alternate" hreflang>`. Trois gardes hors ligne le tiennent :
 * `frontend/scripts/check-prerender-shells.js` (section 10, sur l'ARTEFACT du
 * build), `backend/tests/test_hreflang_sitemap.py` (le sitemap annonce les
 * mêmes URL) et le test du module de déclaration. Aucun des trois ne peut dire
 * ce que le DÉPLOIEMENT sert :
 *
 *   • un rewrite Vercel perdu (`/en/jobs` → `/en/jobs.html`, cf.
 *     `frontend/vercel.json`) ne casse pas le build : il rend la 404, ou pire
 *     la coquille de l'application — un document VALIDE, à la mauvaise langue ;
 *   • un `lang="fr"` resté dans une coquille anglaise, un `canonical` qui pointe
 *     la version française ou une liste `hreflang` écrite d'un seul côté
 *     (« une page B qui pointe A sans que A pointe B est ignorée ») ne se voient
 *     ni dans git ni dans un test : ils se lisent sur l'origine servie ;
 *   • un sitemap qui n'énumère que le français dit au moteur que l'anglais
 *     n'existe pas, quelle que soit la qualité des documents.
 *
 * C'est exactement ce triangle que cette sonde mesure, une fois par jour.
 *
 * ── Ce qu'elle lit, et ce qu'elle ne RECOPIE pas ───────────────────────────
 *   • les ROUTES : `src/config/page-meta.js` (la table unique des pages
 *     pré-rendues) — une page ajoutée là est jugée le lendemain ;
 *   • les LANGUES et les URL : `src/config/langues-indexees.js`
 *     (`cheminDansLaLangue`, `alternatesHreflang`) — les mêmes fonctions que le
 *     build, donc la sonde juge la DÉCLARATION, pas une seconde copie ;
 *   • les pages MONOLINGUES : `src/config/liens-seo.js` (villes, métiers,
 *     guides) — elles ne doivent déclarer AUCUNE alternative ;
 *   • l'origine publiée : `SITE_ORIGIN` (`scripts/site-meta.js`), parce que les
 *     `canonical` et `hreflang` sont ABSOLUS dans les documents pré-rendus. Un
 *     `--base` de preview change où l'on DEMANDE les pages, jamais ce qu'elles
 *     doivent déclarer ;
 *   • le bloc `langues` de `/health` (`API_ORIGIN`, 01/11/2026) — voir plus bas
 *     ce qu'il sert à confronter.
 *
 * ── Trois sorties, jamais deux ─────────────────────────────────────────────
 * 0 = chaque page déclarée sert, dans chaque langue, son `lang`, son
 *     `canonical`, la MÊME liste `hreflang` (réciproque, `x-default` compris),
 *     et le sitemap énumère les deux versions de chaque page qu'il publie ;
 * 1 = refus nommé (statut inattendu, coquille SPA servie à la place du
 *     document, `lang` faux, `canonical` croisé, alternative manquante ou en
 *     trop, sitemap à moitié bilingue, alternative déclarée sur une page
 *     monolingue, **ou bloc `langues` de `/health` qui contredit ce qui est
 *     servi** — autres langues indexées, autre langue par défaut, volume par
 *     langue ou nombre d'alternatives qui ne suit pas le sitemap) ;
 * 2 = prémisse : corpus vide (la déclaration n'a pas été lue), aucune page
 *     lisible, SITEMAP ILLISIBLE, ou `/health` illisible (transport, statut
 *     non-200, corps qui n'est pas du JSON) — la sonde n'a alors pas jugé la
 *     partie concernée, et un vert dirait qu'elle l'a fait. Une prémisse
 *     rougit le run.
 *
 * ── POURQUOI ELLE LIT `langues` DE `/health` (01/11/2026) ──────────────
 * Le bloc publie le VOLUME des langues (combien de documents chacune) depuis le
 * 01/11/2026, et la sonde de santé du backend le juge pour lui-même. Ce que
 * celle-ci ajoute tient en une phrase : le confronter à ce qu'elle VIENT DE
 * MESURER. Un bloc parfaitement bien formé peut décrire un autre site que celui
 * qui est servi — c'est ce qui arrive quand le backend déployé est en retard sur
 * le frontend, et rien d'autre ne le dit : il annonce deux langues, un volume
 * d'avant, et chaque moitié est « vraie ». Sont confrontés : la liste des
 * langues, la langue par défaut, les documents par langue, les URL par langue
 * PRÉFIXÉE, les pages multilingues et les alternatives par page.
 *
 * Ce qui n'est PAS confronté, et pourquoi : les TOTAUX (`pages.total`,
 * `pages.monolingues`, `urls_par_langue` de la langue par défaut). Le sitemap
 * servi porte aussi des fiches de mission (`/jobs/:id`) et des profils
 * travailleurs (`/workers/:id`), écrits en français, sans alternative, et que le
 * bloc ne décrit pas : les compter ferait rougir la sonde sur du contenu qu'il
 * n'a jamais prétendu décrire.
 *
 * ── Ce qu'elle ne dit pas, écrit plutôt que tu ─────────────────────────────
 *   • elle lit ce qui est SERVI, pas ce que le moteur en fait : un `hreflang`
 *     correct n'est pas une indexation, et Google peut ignorer une alternative
 *     pour d'autres raisons (qualité, duplication) qu'aucune sonde HTTP ne voit ;
 *   • le CONTENU des traductions n'est pas comparé : deux documents qui
 *     déclarent la même famille peuvent publier deux textes différents, et
 *     c'est `i18nParity.test.js` + le refus de corps déclaré du build qui le
 *     tiennent, hors ligne ;
 *   • les pages ville, métier et guides sont jugées sur le sitemap seulement
 *     (aucune alternative), pas page par page : leurs documents sont mesurés
 *     par `check-typo-pages-production.js`.
 *
 * Usage :
 *   node scripts/check-hreflang-production.js                    # production
 *   node scripts/check-hreflang-production.js --base https://…   # une preview
 *   node scripts/check-hreflang-production.js --route /jobs      # une page
 *
 * `KOJO_HEALTH_BASE_URL` déplace la lecture de `/health` (défaut :
 * `API_ORIGIN`, qui est l'origine du backend — le site ne proxifie que
 * `/api/**` et `/sitemap.xml`, donc `${SITE_ORIGIN}/health` répondrait 404).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  LANGUES_INDEXEES,
  LANGUE_DE_SECOURS,
  LANGUE_PAR_DEFAUT,
  alternatesHreflang,
  cheminDansLaLangue,
  cheminSansPrefixe,
  langueDuChemin,
  prefixeDeLaLangue,
} from '../src/config/langues-indexees.js';
import { PAGE_META } from '../src/config/page-meta.js';
import { GROUPES_LIENS_SEO } from '../src/config/liens-seo.js';
import { API_ORIGIN, SITE_ORIGIN } from './site-meta.js';

/** L'origine interrogée par défaut (production). */
export const DEFAULT_BASE = SITE_ORIGIN;

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'hreflang des documents par langue';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'Hreflang production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * Le PLANCHER de couverture du sitemap.
 *
 * Le sitemap est ici juge et référence : sa liste de pages françaises dit ce
 * qu'il a choisi d'indexer, et la règle « une page publiée dans une langue l'est
 * dans toutes » se vérifie dessus. Il faut donc deux pages qu'aucune lecture ne
 * peut retirer sans que le site cesse d'être décrit : la racine et la place de
 * marché. Sans ce plancher, un sitemap réduit à des pages monolingues passerait
 * la règle de symétrie en ne publiant aucune page bilingue.
 */
export const PAGES_OBLIGATOIRES = ['/', '/jobs'];

/** Le sitemap servi par l'origine du site (rewrite Vercel → `/api/sitemap.xml`). */
export const CHEMIN_SITEMAP = '/sitemap.xml';

/**
 * Le bloc de santé qui publie la DÉCLARATION des langues (`langues`).
 *
 * Il vit sur l'origine du BACKEND, pas sur celle du site : `vercel.json` ne
 * proxifie que `/api/**` et `/sitemap.xml`, donc `${SITE_ORIGIN}/health`
 * répondrait 404. Depuis le 01/11/2026 ce bloc publie `indexees`, `defaut`,
 * `documents_par_langue`, `urls_par_langue`, `pages`, `alternatives_par_page` et
 * `portee` (`backend/kojo_sitemap_declaration.bloc_langues`), et la sonde de
 * santé du backend le juge DÉJÀ pour lui-même. Ce que cette sonde-ci en fait est
 * différent, et c'est la raison de la lecture : le confronter à ce qu'elle
 * VIENT DE MESURER. Un bloc peut être parfaitement bien formé et décrire un
 * AUTRE site que celui qui est servi — c'est exactement ce qui arrive quand le
 * backend déployé est en retard sur le frontend : il annonce deux langues et un
 * volume d'avant, et rien dans le bloc ne le dit.
 */
export const CHEMIN_HEALTH = '/health';

/** L'origine du backend qui sert `/health` (jamais celle du site : voir plus haut). */
export const HEALTH_ORIGIN = API_ORIGIN;

/**
 * La marque d'une page PRÉ-RENDUE, par opposition à la coquille de
 * l'application (`app.html`, dont le point de montage est VIDE).
 *
 * Un rewrite perdu ne rend pas forcément un 404 : servi par le repli SPA, le
 * document est valide, il a un `lang`, souvent le bon — il n'a simplement pas
 * la page dedans. Sans cette marque, la sonde serait verte sur le mauvais objet.
 */
export const MARQUEUR_DE_PAGE = '<div id="root"><div class="App">';

const TIMEOUT_MS = 20000;

const strip = (valeur) => String(valeur ?? '').trim().replace(/\/+$/, '');

/** Les routes PRÉ-RENDUES, lues dans la table unique (jamais recopiées). */
export function routesAJuger() {
  return Object.keys(PAGE_META).sort();
}

/** Le libellé qui préfixe chaque refus : la famille, et l'origine jugée. */
export const libelleSonde = (base) =>
  `${FAMILLE} — ${strip(base)} sert-il chaque langue de sa famille avec ses alternatives réciproques`;

/** Les attributs d'une balise ouvrante (`<link … />`, `<html …>`). */
export function attributsDeBalise(balise) {
  const attributs = {};
  for (const trouve of String(balise).matchAll(/([a-zA-Z:_-]+)\s*=\s*"([^"]*)"/g)) {
    attributs[trouve[1].toLowerCase()] = trouve[2];
  }
  return attributs;
}

/** Tous les `<link>` du document, attributs lus un par un (ordre indifférent). */
export function liensDuDocument(html) {
  return [...String(html).matchAll(/<link\b[^>]*>/gi)].map((trouve) =>
    attributsDeBalise(trouve[0])
  );
}

/** Le `lang` de `<html>`, ou `''` s'il n'y en a pas. */
export function langDuDocument(html) {
  const ouverture = String(html).match(/<html\b[^>]*>/i);
  return ouverture ? (attributsDeBalise(ouverture[0]).lang || '') : '';
}

/** Le `href` du `canonical`, ou `''`. */
export function canonicalDuDocument(html) {
  const canonique = liensDuDocument(html).find(
    (lien) => (lien.rel || '').toLowerCase() === 'canonical'
  );
  return canonique ? (canonique.href || '').trim() : '';
}

/**
 * Les `(hreflang, href)` des `<link rel="alternate">`, dans l'ordre publié.
 *
 * L'ORDRE compte : c'est celui de la déclaration, et deux documents de la même
 * famille qui publieraient les mêmes couples dans un ordre différent
 * divergeraient à la première relecture — le comparer est gratuit.
 */
export function alternativesDuDocument(html) {
  return liensDuDocument(html)
    .filter((lien) => (lien.rel || '').toLowerCase() === 'alternate' && lien.hreflang)
    .map((lien) => [lien.hreflang, (lien.href || '').trim()]);
}

/** Décode les cinq entités qu'un sitemap peut porter dans une URL. */
function decoderEntites(texte) {
  return String(texte)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Les `<url>` d'un sitemap : `{loc, alternatives}` dans l'ordre publié. */
export function blocsDuSitemap(xml) {
  return [...String(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)].map((bloc) => {
    const loc = (bloc[1].match(/<loc>([\s\S]*?)<\/loc>/) || [])[1] || '';
    const alternatives = [...bloc[1].matchAll(/<xhtml:link\b[^>]*>/g)]
      .map((balise) => attributsDeBalise(balise[0]))
      .filter((lien) => (lien.rel || '').toLowerCase() === 'alternate' && lien.hreflang)
      .map((lien) => [lien.hreflang, (lien.href || '').trim()]);
    return { loc: decoderEntites(loc).trim(), alternatives };
  });
}

/** Les couples attendus, sous la forme publiée par les documents et le sitemap. */
const attendues = (route) =>
  alternatesHreflang(route, strip(SITE_ORIGIN)).map(({ hreflang, href }) => [hreflang, href]);

/** La différence entre deux listes de couples, dite dans les deux sens. */
function decrireEcart(trouvees, attenduesList) {
  const cle = (couple) => `${couple[0]} ${couple[1]}`;
  const trouveesCles = new Set(trouvees.map(cle));
  const attenduesCles = new Set(attenduesList.map(cle));
  const manquantes = attenduesList.filter((couple) => !trouveesCles.has(cle(couple))).map(cle);
  const enTrop = trouvees.filter((couple) => !attenduesCles.has(cle(couple))).map(cle);
  const morceaux = [];
  if (manquantes.length) morceaux.push(`manque ${manquantes.join(', ')}`);
  if (enTrop.length) morceaux.push(`en trop ${enTrop.join(', ')}`);
  if (!morceaux.length) morceaux.push('même contenu, ORDRE différent');
  return morceaux.join(' ; ');
}

/**
 * Juge UN document : statut, marque de page, `lang`, `canonical`, alternatives.
 *
 * @param {{url: string, route: string, langue: object, statut: number, html: string}} page
 * @returns {string[]} Les refus (vide = conforme).
 */
export function jugerDocument({ url, route, langue, statut, html }) {
  const problemes = [];
  const chemin = cheminDansLaLangue(route, langue.code);

  if (statut !== 200) {
    problemes.push(
      `${url} répond HTTP ${statut} : la page déclarée ${chemin} n'est pas servie — vérifier le ` +
        `rewrite de frontend/vercel.json et le fichier que le build a écrit (build/${chemin}.html).`
    );
    return problemes;
  }

  if (!String(html).includes(MARQUEUR_DE_PAGE)) {
    problemes.push(
      `${url} ne contient pas la page pré-rendue (point de montage React vide) : c'est la coquille ` +
        `de l'application qui est servie — un rewrite perdu rend un document VALIDE, à la mauvaise ` +
        `langue et sans la page dedans.`
    );
  }

  const lang = langDuDocument(html);
  if (lang !== langue.htmlLang) {
    problemes.push(
      `${url} déclare <html lang="${lang || '(absent)'}"> au lieu de « ${langue.htmlLang} » : un moteur ` +
        `lit cette langue avant tout le reste, et une version anglaise annoncée « fr » n'est pas une ` +
        `version anglaise.`
    );
  }

  const canonicalAttendu = `${strip(SITE_ORIGIN)}${chemin}`;
  const canonical = canonicalDuDocument(html);
  if (canonical !== canonicalAttendu) {
    problemes.push(
      `${url} publie un canonical « ${canonical || '(absent)'} » au lieu de « ${canonicalAttendu} » : ` +
        `un canonical croisé fait indexer la page française à la place de l'anglaise (ou l'inverse).`
    );
  }

  const trouvees = alternativesDuDocument(html);
  const attenduesList = attendues(route);
  if (JSON.stringify(trouvees) !== JSON.stringify(attenduesList)) {
    problemes.push(
      `${url} publie ${trouvees.length} alternative(s) hreflang au lieu de ${attenduesList.length} ` +
        `(${decrireEcart(trouvees, attenduesList)}) : la liste doit être la MÊME dans chaque document ` +
        `de la famille, « ${LANGUE_DE_SECOURS} » compris — une déclaration non réciproque est ignorée.`
    );
  }

  return problemes;
}

/**
 * Juge le SITEMAP : symétrie des langues, alternatives, plancher, monolingues.
 *
 * La règle centrale ne recopie aucune liste : pour chaque page PRÉ-RENDUE, si le
 * sitemap en publie une version il doit en publier toutes (le français dit que
 * l'anglais existe, ou n'en dit rien du tout) ; et chaque entrée publiée porte
 * les alternatives de SA famille.
 *
 * @param {{xml: string}} entree
 * @returns {string[]} Les refus (vide = conforme).
 */
export function jugerSitemap({ xml }) {
  const problemes = [];
  const base = strip(SITE_ORIGIN);
  const blocs = blocsDuSitemap(xml);
  /** @type {Map<string, {loc: string, alternatives: string[][]}>} */
  const parChemin = new Map();
  for (const bloc of blocs) {
    if (!bloc.loc.startsWith(base)) continue;
    const chemin = bloc.loc.slice(base.length) || '/';
    parChemin.set(chemin, bloc);
  }

  for (const route of routesAJuger()) {
    const chemins = LANGUES_INDEXEES.map((langue) => cheminDansLaLangue(route, langue.code));
    const publies = chemins.filter((chemin) => parChemin.has(chemin));
    if (!publies.length) continue;
    if (publies.length !== chemins.length) {
      const manquants = chemins.filter((chemin) => !parChemin.has(chemin));
      problemes.push(
        `le sitemap énumère ${publies.join(', ')} sans ${manquants.join(', ')} : un sitemap à moitié ` +
          `bilingue dit au moteur que la moitié absente n'existe pas, quels que soient les documents.`
      );
      continue;
    }
    const attenduesList = attendues(route);
    for (const chemin of chemins) {
      const bloc = parChemin.get(chemin);
      if (JSON.stringify(bloc.alternatives) !== JSON.stringify(attenduesList)) {
        problemes.push(
          `l'entrée ${bloc.loc} du sitemap porte ${bloc.alternatives.length} alternative(s) au lieu de ` +
            `${attenduesList.length} (${decrireEcart(bloc.alternatives, attenduesList)}) : le sitemap et ` +
            `les documents doivent annoncer la MÊME famille, sinon la déclaration n'est servie qu'à moitié.`
        );
      }
    }
  }

  for (const route of PAGES_OBLIGATOIRES) {
    for (const langue of LANGUES_INDEXEES) {
      const chemin = cheminDansLaLangue(route, langue.code);
      if (!parChemin.has(chemin)) {
        problemes.push(
          `plancher de couverture : ${chemin} manque au sitemap — la racine et la place de marché ne ` +
            `peuvent pas être retirées sans que le fichier cesse de décrire le site (une symétrie entre ` +
            `deux langues vides serait vraie à vide).`
        );
      }
    }
  }

  // Une page MONOLINGUE ne déclare aucune alternative : en publier une sur une
  // page qui n'en a pas serait la même faute, dans l'autre sens — un `hreflang`
  // vers une version qui n'existe pas.
  for (const { href } of GROUPES_LIENS_SEO.flatMap((groupe) => groupe.liens)) {
    const bloc = parChemin.get(href);
    if (bloc && bloc.alternatives.length) {
      problemes.push(
        `l'entrée ${bloc.loc} du sitemap déclare ${bloc.alternatives.length} alternative(s) alors que ` +
          `cette page est MONOLINGUE (aucune version traduite n'existe) : un hreflang vers une page qui ` +
          `n'existe pas est une déclaration fausse.`
      );
    }
  }

  return problemes;
}

/**
 * Ce que le SITEMAP SERVI énumère, du point de vue du bloc `langues`.
 *
 * On ne compte pas des URL « en général » : on compte les entrées qui portent
 * des alternatives `hreflang` — c'est la marque d'une page MULTILINGUE. Un
 * sitemap porte aussi des fiches de mission (`/jobs/:id`) et des profils
 * travailleurs (`/workers/:id`), qui sont écrits en français, ne déclarent
 * aucune alternative, et que le bloc ne décrit PAS (`kojo_sitemap_declaration`
 * ne compte que les pages statiques et les pages ville/métier/guide). Les
 * compter dans `urls_par_langue` ferait rougir la sonde sur du contenu que le
 * bloc n'a jamais prétendu décrire — c'est la raison pour laquelle les totaux
 * (`pages.total`, `pages.monolingues`, `urls_par_langue` de la langue par
 * défaut) ne sont pas confrontés, et que ce qui l'est se lit sur les entrées à
 * alternatives.
 *
 * @param {{xml: string, base?: string}} entree
 * @returns {{parLangue: Map<string, {total: number, documents: number}>,
 *   multilingues: number, alternativesParPage: number|null, entrees: number}}
 */
export function mesuresDuBlocLangues({ xml, base = strip(SITE_ORIGIN) } = {}) {
  const parLangue = new Map(LANGUES_INDEXEES.map((langue) => [langue.code, { total: 0, documents: 0 }]));
  /** @type {Map<string, Set<string>>} chemin sans langue → langues qui le publient */
  const groupes = new Map();
  const longueurs = new Set();
  let entrees = 0;

  for (const bloc of blocsDuSitemap(xml)) {
    if (!bloc.loc.startsWith(base)) continue;
    entrees += 1;
    const chemin = bloc.loc.slice(base.length) || '/';
    const code = langueDuChemin(chemin) || LANGUE_PAR_DEFAUT;
    const stats = parLangue.get(code);
    // Une langue que la DÉCLARATION ne porte pas est déjà signalée comme un
    // écart de toutes les autres comparaisons ; la compter ici ajouterait un
    // second refus pour une seule faute.
    if (!stats) continue;
    stats.total += 1;
    if (!bloc.alternatives.length) continue;
    stats.documents += 1;
    longueurs.add(bloc.alternatives.length);
    const sansLangue = cheminSansPrefixe(chemin);
    if (!groupes.has(sansLangue)) groupes.set(sansLangue, new Set());
    groupes.get(sansLangue).add(code);
  }

  const multilingues = [...groupes.values()].filter(
    (codes) => codes.size === LANGUES_INDEXEES.length
  ).length;

  return {
    parLangue,
    multilingues,
    alternativesParPage: longueurs.size ? Math.max(...longueurs) : null,
    entrees,
  };
}

/**
 * Confronte le bloc `langues` de `/health` à ce qui vient d'être MESURÉ.
 *
 * Trois questions, et trois façons de se contredire :
 *
 *   1. la FAMILLE — le bloc annonce-t-il les langues que le site sert ? C'est le
 *      cas de panne le plus probable : le backend Fly déployé en retard annonce
 *      deux langues quand le frontend en sert cinq, et les deux réponses sont
 *      « vraies » prises séparément ;
 *   2. le VOLUME — `documents_par_langue`, `urls_par_langue` (langues préfixées),
 *      `pages.multilingues` et `alternatives_par_page` disent-ils ce que le
 *      sitemap servi énumère ? Un bloc calculé depuis une autre déclaration
 *      publie un nombre faux sans que rien ne rougisse ailleurs ;
 *   3. la LANGUE PAR DÉFAUT — le préfixe vide et le `x-default` en dépendent.
 *
 * Ce qui n'est PAS confronté est écrit plus haut (les totaux, que les fiches de
 * mission et les profils travailleurs gonflent de bonne foi).
 *
 * @param {{bloc: object, mesures: object}} entree
 * @returns {string[]} Les refus (vide = les deux récits sont d'accord).
 */
export function jugerBlocLangues({ bloc, mesures }) {
  const problemes = [];
  const attenduesCodes = LANGUES_INDEXEES.map((langue) => langue.code);

  if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc)) {
    return [
      `${HEALTH_ORIGIN}${CHEMIN_HEALTH} ne publie pas de bloc « langues » : la révision déployée du ` +
        'backend est antérieure au 01/11/2026, ou le proxy rend le /health d’un autre hôte. Le ' +
        'volume des langues n’a donc pas pu être confronté à ce qui est servi — redéployer le backend.',
    ];
  }

  const annoncees = Array.isArray(bloc.indexees) ? bloc.indexees.map(String) : [];
  if (JSON.stringify(annoncees) !== JSON.stringify(attenduesCodes)) {
    problemes.push(
      `/health annonce ${annoncees.length} langue(s) indexée(s) (${annoncees.join(', ') || 'aucune'}) ` +
        `alors que la sonde en juge ${attenduesCodes.length} (${attenduesCodes.join(', ')}) : les deux ` +
        `récits ne décrivent pas le même site — un backend en retard sur le frontend annonce un site ` +
        `plus petit qu’il n’est servi, et c’est exactement le cas que ce bloc existe pour rendre visible.`
    );
  }

  if (String(bloc.defaut || '') !== LANGUE_PAR_DEFAUT) {
    problemes.push(
      `/health déclare « ${bloc.defaut || '(aucune)'} » comme langue par défaut, alors que la ` +
        `déclaration des URL (src/config/langues-indexees.js) met « ${LANGUE_PAR_DEFAUT} » sans préfixe : ` +
        `le préfixe vide et le x-default désignent donc deux langues différentes.`
    );
  }

  const attenduesAlternatives = alternatesHreflang('/', '').length;
  if (mesures.alternativesParPage !== null && Number(bloc.alternatives_par_page) !== attenduesAlternatives) {
    problemes.push(
      `/health annonce ${bloc.alternatives_par_page} alternative(s) par page, alors que le sitemap servi ` +
        `en porte ${mesures.alternativesParPage} et que la déclaration en produit ${attenduesAlternatives} ` +
        `(une par langue indexée, x-default compris) : le compte et les documents ne décrivent pas la ` +
        `même famille.`
    );
  }

  // ── Le volume, langue par langue ────────────────────────────────────────
  const documentsAnnonces = bloc.documents_par_langue || {};
  const urlsAnnoncees = bloc.urls_par_langue || {};
  for (const code of attenduesCodes) {
    const mesure = mesures.parLangue.get(code) || { total: 0, documents: 0 };
    const annonce = Number(documentsAnnonces[code]);
    if (!Number.isFinite(annonce)) {
      problemes.push(
        `/health ne publie pas de nombre de documents pour « ${code} » (documents_par_langue) : ` +
          `un volume muet sur une langue annoncée ne peut pas être confronté au sitemap.`
      );
    } else if (annonce !== mesure.documents) {
      problemes.push(
        `/health annonce ${annonce} document(s) en « ${code} », le sitemap servi en énumère ` +
          `${mesure.documents} : le bloc compte la déclaration, le sitemap énumère ce qui est publié — ` +
          `les deux doivent dire le même nombre, sinon une langue perd ses pages sans que rien ne rougisse.`
      );
    }
    // Pour une langue PRÉFIXÉE, toutes ses entrées de sitemap sont des pages
    // multilingues (les fiches de mission et les profils, écrits en français,
    // n'ont pas de préfixe) : le total est donc comparable. Pour la langue par
    // défaut, non — voir le commentaire de mesuresDuBlocLangues.
    if (prefixeDeLaLangue(code)) {
      const annonceesUrls = Number(urlsAnnoncees[code]);
      if (!Number.isFinite(annonceesUrls)) {
        problemes.push(
          `/health ne publie pas de nombre d’URL pour « ${code} » (urls_par_langue) : le volume par ` +
            `langue ne peut pas être confronté au sitemap servi.`
        );
      } else if (annonceesUrls !== mesure.total) {
        problemes.push(
          `/health annonce ${annonceesUrls} URL en « ${code} », le sitemap servi en énumère ` +
            `${mesure.total} : une langue préfixée ne contient que ses pages multilingues, donc les deux ` +
            `nombres sont le même fait et doivent être égaux.`
        );
      }
    }
  }

  const pages = bloc.pages || {};
  if (mesures.multilingues) {
    const annoncees = Number(pages.multilingues);
    if (!Number.isFinite(annoncees)) {
      problemes.push(
        '/health ne publie pas de nombre de pages multilingues (pages.multilingues) : la moitié ' +
          'du volume n’est pas confrontée au sitemap servi.'
      );
    } else if (annoncees !== mesures.multilingues) {
      problemes.push(
        `/health annonce ${annoncees} page(s) multilingue(s), le sitemap servi en énumère ` +
          `${mesures.multilingues} (une entrée à alternatives dans chaque langue) : un nombre qui ne ` +
          `suit pas les entrées est un chiffre qui mentira au prochain lecteur.`
      );
    }
  }

  return problemes;
}

/**
 * Lit une URL sans masquer un statut par une erreur de lecture.
 *
 * @returns {Promise<{statut: number, corps: string, erreur: string}>}
 */
async function lire({ url, fetchImpl, accept }) {
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'kojo-hreflang-probe/1.0', accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const corps = await res.text().catch(() => '');
    return { statut: res.status, corps, erreur: '' };
  } catch (err) {
    return { statut: 0, corps: '', erreur: err.message };
  }
}

/**
 * La sonde complète.
 *
 * @param {object} [options]
 * @param {string} [options.base] Origine interrogée (défaut : production).
 * @param {string[]} [options.routes] Routes à juger à la place de la table.
 *   `undefined` (le défaut) lit `page-meta.js` ; `[]` ne juge AUCUNE page —
 *   c'est le corpus vide, qui est une prémisse et se teste comme tel.
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {boolean} [options.quiet] Tait la progression.
 * @returns {Promise<{ok: boolean, premisse: boolean, errors: string[], notices: string[],
 *   checked: string[], pages: string[], cout: object}>}
 */
export async function runHreflangProbe({
  base = process.env.KOJO_HREFLANG_BASE_URL || DEFAULT_BASE,
  routes,
  fetchImpl = fetch,
  quiet = false,
  // `/health` vit sur l'origine du BACKEND (voir `HEALTH_ORIGIN`). Le défaut
  // n'est pas `base` : le site ne proxifie que `/api/**` et `/sitemap.xml`, donc
  // `${base}/health` répondrait 404 en production. Une preview pointe le MÊME
  // backend pour son sitemap (le rewrite `/sitemap.xml` est absolu), donc lire
  // le bloc là où il vit ne mélange pas deux objets — et `KOJO_HEALTH_BASE_URL`
  // existe pour une origine mesurée localement.
  healthBase = process.env.KOJO_HEALTH_BASE_URL || HEALTH_ORIGIN,
} = {}) {
  const BASE = strip(base);
  const HEALTH_BASE = strip(healthBase);
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];
  const notices = [];
  const checked = [];
  const pages = [];
  const debut = Date.now();
  let requetes = 0;
  const result = { ok: false, premisse: false, errors, notices, checked, pages, cout: {} };
  const libelle = libelleSonde(BASE);

  const aJuger = Array.isArray(routes) ? [...routes].sort() : routesAJuger();

  // ── Un corpus VIDE ne vaut pas un vert ──────────────────────────────────
  if (!aJuger.length || !LANGUES_INDEXEES.length) {
    result.premisse = true;
    notices.push(
      `${MARQUE_PREMISSE} : aucune page ou aucune langue indexée à juger — la déclaration ` +
        `(src/config/page-meta.js, src/config/langues-indexees.js) n'a rien rendu. Rien n'a été mesuré.`
    );
    log(`⚠️ ${notices[notices.length - 1]}`);
    return result;
  }

  // ── 1. Les documents, une langue après l'autre ──────────────────────────
  /** @type {Map<string, Map<string, string[][]>>} route → langue → alternatives */
  const listesParRoute = new Map();
  for (const route of aJuger) {
    for (const langue of LANGUES_INDEXEES) {
      const chemin = cheminDansLaLangue(route, langue.code);
      const url = `${BASE}${chemin}`;
      requetes += 1;
      const page = await lire({ url, fetchImpl, accept: 'text/html,application/xhtml+xml' });
      if (page.erreur) {
        errors.push(`${url} n'a pas pu être lu (${page.erreur}) : cette langue de ${route} n'est pas jugée.`);
        continue;
      }
      pages.push(url);
      const problemes = jugerDocument({
        url,
        route,
        langue,
        statut: page.statut,
        html: page.corps,
      });
      errors.push(...problemes);
      if (!problemes.length) checked.push(`  ✓ ${langue.code} ${chemin} (${url})`);
      if (page.statut === 200) {
        if (!listesParRoute.has(route)) listesParRoute.set(route, new Map());
        listesParRoute.get(route).set(langue.code, alternativesDuDocument(page.corps));
      }
    }
  }

  // ── Rien de lu = rien de jugé ───────────────────────────────────────────
  if (!pages.length) {
    result.premisse = true;
    notices.push(
      `${MARQUE_PREMISSE} : aucun document de ${BASE} n'a pu être lu (${errors.length} erreur(s) de ` +
        `lecture) — ni les langues ni les alternatives n'ont été mesurées.`
    );
    log(`⚠️ ${notices[notices.length - 1]}`);
    return result;
  }

  // ── 2. La RÉCIPROCITÉ, mesurée entre les documents de la famille ─────────
  // La comparaison à la déclaration (étape 1) garantit déjà la liste ; ce
  // contrôle-ci dit le fait tel qu'il se lit sur l'origine : les deux documents
  // publient la MÊME liste, dans le même ordre. Sans lui, deux documents
  // également faux passeraient pour cohérents.
  for (const [route, parLangue] of listesParRoute) {
    if (parLangue.size < 2) continue;
    const listes = [...parLangue.entries()].map(([code, liste]) => [code, JSON.stringify(liste)]);
    const distinctes = new Set(listes.map(([, liste]) => liste));
    if (distinctes.size > 1) {
      const detail = listes.map(([code, liste]) => `${code} : ${liste}`).join(' | ');
      errors.push(
        `les documents de ${route} ne publient pas la même liste hreflang (${detail}) : une ` +
          `alternative non réciproque est ignorée par le moteur, donc la famille n'est pas déclarée.`
      );
    }
  }

  // ── 3. Le sitemap, qui porte le fait d'énumération ───────────────────────
  requetes += 1;
  const sitemap = await lire({
    url: `${BASE}${CHEMIN_SITEMAP}`,
    fetchImpl,
    accept: 'application/xml,text/xml,*/*',
  });
  if (sitemap.erreur) {
    // Le sitemap est la MOITIÉ du fait mesuré ici. Sans lui, la sonde a jugé les
    // documents et pas l'énumération : un vert dirait qu'elle a tout mesuré.
    result.premisse = true;
    notices.push(
      `${MARQUE_PREMISSE} : le sitemap de ${BASE} n'a pas pu être lu (${sitemap.erreur}) — ` +
        `l'énumération des versions par langue n'a pas été jugée, et les documents seuls ne suffisent pas.`
    );
    log(`⚠️ ${notices[notices.length - 1]}`);
    return result;
  }
  let sitemapJuge = false;
  if (sitemap.statut !== 200) {
    errors.push(
      `${BASE}${CHEMIN_SITEMAP} répond HTTP ${sitemap.statut} : le sitemap n'est pas servi, donc aucune ` +
        `version anglaise n'est annoncée (vérifier le rewrite /sitemap.xml de frontend/vercel.json).`
    );
  } else {
    const blocs = blocsDuSitemap(sitemap.corps);
    if (!blocs.length) {
      errors.push(
        `${BASE}${CHEMIN_SITEMAP} ne contient aucune entrée <url> : un sitemap vide n'énumère rien, et il ` +
          `passerait pour conforme à une règle qui ne juge que ce qu'il publie.`
      );
    } else {
      sitemapJuge = true;
      const problemes = jugerSitemap({ xml: sitemap.corps });
      errors.push(...problemes);
      if (!problemes.length) {
        checked.push(
          `  ✓ sitemap (${blocs.length} entrée(s), ` +
            `${LANGUES_INDEXEES.length} langue(s) par page publiée)`
        );
      }
    }
  }

  // ── 4. Le bloc `langues` de /health, confronté à CE QUI VIENT D'ÊTRE MESURÉ ──
  // Le bloc existe depuis le 01/11/2026 et publie le volume par langue. Il est
  // jugé pour lui-même par la sonde de santé du backend (bloc absent, total qui
  // ne somme pas, langue sans document) ; ce qui manquait, et que seule cette
  // sonde-ci peut dire, c'est si le bloc et le SITE SERVI racontent la même
  // chose. Le cas mesuré qui motive la lecture : un backend déployé en retard
  // annonce deux langues pendant que le frontend en sert cinq.
  const mesures = sitemapJuge ? mesuresDuBlocLangues({ xml: sitemap.corps }) : null;
  if (!mesures) {
    notices.push(
      "le bloc `langues` de /health n'a pas été confronté : le sitemap n'a pas été lu (voir le refus " +
        'ci-dessus), et c’est lui qui porte les volumes à comparer.'
    );
  } else {
    requetes += 1;
    const sante = await lire({
      url: `${HEALTH_BASE}${CHEMIN_HEALTH}`,
      fetchImpl,
      accept: 'application/json',
    });
    if (sante.erreur) {
      // Le bloc est un fait publié par un AUTRE déploiement que les documents :
      // ne pas pouvoir le lire n'accuse pas le site, mais interdit de dire que
      // la confrontation a eu lieu.
      result.premisse = true;
      notices.push(
        `${MARQUE_PREMISSE} : ${HEALTH_BASE}${CHEMIN_HEALTH} n'a pas pu être lu (${sante.erreur}) — le ` +
          `bloc « langues » n'a pas été confronté à ce qui est servi, et les documents seuls ne ` +
          `disent pas si le backend annonce le même site.`
      );
      log(`⚠️ ${notices[notices.length - 1]}`);
    } else if (sante.statut !== 200) {
      result.premisse = true;
      notices.push(
        `${MARQUE_PREMISSE} : ${HEALTH_BASE}${CHEMIN_HEALTH} répond HTTP ${sante.statut} — le bloc ` +
          `« langues » n'a pas été confronté (c'est la sonde de santé du backend qui juge la santé ` +
          `elle-même, pas celle-ci : ici, l'état illisible est une prémisse, jamais un vert).`
      );
      log(`⚠️ ${notices[notices.length - 1]}`);
    } else {
      let charge = null;
      try {
        charge = JSON.parse(sante.corps);
      } catch {
        charge = null;
      }
      if (!charge || typeof charge !== 'object') {
        result.premisse = true;
        notices.push(
          `${MARQUE_PREMISSE} : le corps de ${HEALTH_BASE}${CHEMIN_HEALTH} n'est pas du JSON — le ` +
            `bloc « langues » n'a pas été confronté à ce qui est servi.`
        );
        log(`⚠️ ${notices[notices.length - 1]}`);
      } else {
        const problemes = jugerBlocLangues({ bloc: charge.langues, mesures });
        errors.push(...problemes);
        if (!problemes.length) {
          checked.push(
            `  ✓ bloc langues de /health (${mesures.entrees} entrée(s) de sitemap, ` +
              `${mesures.multilingues} page(s) multilingue(s), ` +
              `${LANGUES_INDEXEES.length} langue(s) annoncée(s))`
          );
        }
      }
    }
  }

  result.cout = {
    langues: LANGUES_INDEXEES.length,
    documents: pages.length,
    routes: aJuger.length,
    requetes,
    dureeMs: Date.now() - debut,
  };

  // Une prémisse n'est pas un vert : elle rougit le run (code 2) tout en disant
  // qu'aucun verdict n'a été rendu sur la partie concernée.
  result.ok = errors.length === 0 && !result.premisse;
  if (result.ok) {
    log(
      `\n${libelle} : conforme (${pages.length} document(s) sur ${aJuger.length} route(s) et ` +
        `${LANGUES_INDEXEES.length} langue(s), ${requetes} requête(s), ${result.cout.dureeMs} ms).`
    );
  }
  return result;
}

/** Les options de ligne de commande. */
export function parseArguments(argv = process.argv.slice(2)) {
  const options = { base: '', routes: [], quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[(index += 1)] || '';
    else if (argument === '--route') options.routes.push(argv[(index += 1)] || '');
    else if (argument === '--quiet') options.quiet = true;
  }
  return { ...options, routes: options.routes.filter(Boolean) };
}

/**
 * Le point d'entrée, séparé pour que le VERDICT (0/1/2) se juge sans réseau.
 *
 * @param {string[]} [argv] Arguments après `node script`.
 * @param {object} [deps] `run`, `log`, `error`.
 * @returns {Promise<number>} Code de sortie.
 */
export async function main(
  argv = process.argv.slice(2),
  { run = runHreflangProbe, log = console.log, error = console.error } = {}
) {
  const options = parseArguments(argv);
  const resultat = await run({
    base: options.base || undefined,
    routes: options.routes.length ? options.routes : undefined,
    quiet: options.quiet,
  });

  log(`\n${libelleSonde(options.base || DEFAULT_BASE)}`);
  for (const ligne of resultat.checked) log(ligne);
  const cout = resultat.cout || {};
  if (cout.requetes) {
    log(
      `ℹ️  Coût de la passe : ${cout.documents} document(s), ${cout.routes} route(s), ` +
        `${cout.requetes} requête(s), ${cout.dureeMs} ms.`
    );
  }

  if (resultat.premisse) {
    error(`::error title=${TITRE_ERREUR}::${resultat.notices.join(' ') || MARQUE_PREMISSE}`);
    for (const notice of resultat.notices) error(`  • ${notice}`);
    for (const message of resultat.errors) error(`  • ${message}`);
    return 2;
  }

  if (resultat.errors.length) {
    error(`\n❌ ${resultat.errors.length} défaut(s) — ${TITRE_ERREUR} :`);
    for (const message of resultat.errors) error(`  • ${message}`);
    error(
      `\n   → les langues et les URL sont déclarées UNE fois, dans src/config/langues-indexees.js ` +
        `(lue par le build ET par le sitemap, cf. backend/kojo_langues.py) ; un rewrite perdu se ` +
        `corrige dans frontend/vercel.json, un document muet dans les coquilles pré-rendues ` +
        `(vite-plugins/prerender/hreflang.js), et une entrée absente du sitemap dans les ` +
        `static_paths de backend/kojo_routers_public.py.`
    );
    error(
      `::error title=${TITRE_ERREUR}::${resultat.errors.length} défaut(s) sur les documents par ` +
        `langue ou leur énumération au sitemap`
    );
    return 1;
  }

  log(
    `\n✅ Les ${cout.documents} document(s) de ${cout.langues} langue(s) servent leur lang, leur ` +
      `canonical et la même liste hreflang (réciproque, x-default compris), et le sitemap énumère ` +
      `les deux versions de chaque page qu'il publie — ${cout.requetes} requête(s) en ${cout.dureeMs} ms.`
  );
  log(
    `ℹ️  Ce que cette sonde ne dit pas : un hreflang correct n'est pas une indexation (le moteur peut ` +
      `ignorer une alternative pour des raisons qu'aucune requête HTTP ne voit), et le TEXTE des ` +
      `traductions n'est pas comparé — c'est i18nParity.test.js qui le tient, hors ligne.`
  );
  return 0;
}

export const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  process.exit(await main());
}
