/**
 * LE CORPUS « MISSIONS VIVANTES », ET LES SURFACES AVEUGLES QUI S'Y ADOSSENT.
 *
 * ── Le fait mesuré, et pourquoi il fallait un registre ──────────────────────
 * Le 12/10/2026, la production ne servait AUCUNE mission vivante : le sitemap
 * annonçait 8 URL dont zéro fiche, `GET /api/jobs?status=open` rendait `[]`, et
 * `/api/public/stats` disait `open_jobs: 0, completed_jobs: 0, reviews: 0`. Trois
 * sondes de production, elles, continuaient de se déclarer vertes en le disant à
 * voix basse (`::notice`) :
 *
 *   • `check-og-images.js` — « aucune mission en base … la branche 200 n'a PAS
 *     été exercée » ;
 *   • `check-og-job-200.js` — « cycle IGNORÉ » (le déploiement réel n'est pas
 *     une adresse que ce job contrôle, et la CI n'écrit pas chez le client) ;
 *   • `check-seo-production.js` — « 0 fiche jugée », en `--strict` compris.
 *
 * Les trois disaient donc, chacune dans sa phrase, la MÊME chose : « je n'ai rien
 * pu mesurer ». Et les trois sortaient en 0. C'est la forme de silence que F9 a
 * coûtée (quatre intégrations absentes de la production, aucun run rouge nulle
 * part) : une vérification qui n'a pas pu s'exécuter se lit comme un vert.
 *
 * ── Le 16/10/2026 : rendre la FORME mesurable au lieu de la déclarer ───────
 * Déclarer une surface aveugle rend l'état public, mais ne la mesure pas. Or une
 * des trois (`seo-production:fiches`, et avec elle la forme du document servi :
 * `<title>`, description, `robots`, `canonical`, `og:url`, `<h1>` statique) ne
 * dépend pas des DONNÉES : elle dépend de la présence d'une mission à juger.
 * `check-job-form-canari.js` la fabrique donc — il CRÉE sa mission de contrôle,
 * juge la forme de la fiche SERVIE, puis la supprime. Deux conséquences pour ce
 * registre, et il faut les deux : la surface du canari y est DÉCLARÉE (il ÉCRIT,
 * donc il ne tourne pas partout : hors loopback, il exige le mandat délibéré
 * `KOJO_CANARI_ALLOW_WRITE=1`, et sans mandat il est AVEUGLE — bruyamment), et
 * les surfaces qui lisent les missions du CLIENT restent déclarées aveugles
 * quand il n'y en a pas : le canari juge la forme d'une fiche, pas les textes
 * réels du client. Un corpus vide cesse d'être un silence ; il ne devient pas
 * une couverture.
 *
 * ── Ce que ce module décide ────────────────────────────────────────────────
 * Le corpus est DÉCLARÉ (une entrée : son plancher, ses statuts, sa lecture), et
 * chaque surface qui ne peut plus être mesurée quand il est vide est DÉCLARÉE
 * avec quatre choses : le CHEMIN qu'elle couvre, son MOTIF (pourquoi elle est
 * aveugle), son REMÈDE (ce qu'il faudrait), sa DATE. Une sonde qui atteint cet
 * état DEMANDE son verdict ici (`verdictDeSurfaceVide`) et publie alors un
 * `::warning` — bruyant, jamais bloquant pour un état de données.
 *
 * NON DÉCLARÉE, en revanche, la même surface est un DÉFAUT DE CODE : la sonde
 * refuse (elle sort en 1) en nommant la clé absente. Un vert qui aurait pu
 * mesurer quelque chose et n'a rien mesuré ne doit pas pouvoir s'écrire en
 * silence ; c'est exactement la faute du 12/10/2026, généralisée.
 *
 * ── Ce que le garde mesure, et ce qu'il ne mesure pas ──────────────────────
 * `frontend/scripts/check-corpus-missions.js` (garde, audité par la CI) lit les
 * sources réelles et refuse : une sonde qui lit le corpus SANS être déclarée,
 * une surface déclarée que sa sonde ne demande jamais (déclaration PÉRIMÉE), une
 * sonde déclarée qui ne consulte pas ce module ou qui ne publie pas de
 * `::warning` (déclaration MUETTE), un motif, un remède ou une date trop courts
 * pour dire quelque chose, un corpus sans plancher, une exemption sans sujet, et
 * il refuse de juger sous ses planchers de lecture. Preuve : ce module et le
 * garde sont prouvés par `frontend/scripts/__tests__/check-corpus-missions.test.js`
 * et par des mutations du registre (`guard-proofs.json`).
 *
 * Ce qu'il ne juge pas : si le corpus DEVRAIT être vide (c'est une décision
 * d'exploitation, publiée en `::warning` à chaque run) et si une surface
 * déclarée est mesurable AILLEURS (chaque motif et chaque remède disent où).
 */

/** Le fichier qui porte les déclarations — exempté du balayage, comme registre. */
export const REGISTRE = 'frontend/scripts/corpus-missions.js';

/**
 * Les corpus de production lus par les sondes du dépôt, avec leur plancher.
 *
 * `plancher` est le nombre d'éléments lus SOUS LEQUEL la sonde n'a rien mesuré :
 * un plancher de 1 se lit « au moins une mission vivante », et 0 serait un
 * plancher décoratif (il ne refuse jamais rien).
 */
export const CORPUS = Object.freeze({
  'missions-vivantes': Object.freeze({
    label: 'missions vivantes servies par l’API publique',
    statuts: Object.freeze(['open', 'in_progress']),
    lecture:
      'GET /api/jobs?status=open puis ?status=in_progress (API publique, sur la même origine que le site)',
    plancher: 1,
  }),
});

/**
 * Les SONDES qui lisent ce corpus, et les surfaces qu'elles déclarent.
 *
 * Déclarer une sonde ici est ce qui autorise son fichier à porter le chemin du
 * corpus : le garde refuse tout autre fichier de `scripts/` qui le lit, et refuse
 * une sonde déclarée qui ne consulte pas ce module ou qui ne publie pas de
 * `::warning`.
 */
export const SONDES = Object.freeze({
  'frontend/scripts/check-og-images.js': Object.freeze({
    lecture: 'GET /api/jobs?limit=1 — prendre une mission réelle pour la branche 200',
    surfaces: Object.freeze(['og-images:fiche-200']),
  }),
  'frontend/scripts/check-og-job-200.js': Object.freeze({
    lecture: 'POST /api/jobs puis DELETE /api/jobs/:id — le cycle crée son propre corpus',
    surfaces: Object.freeze(['og-job-200:cycle']),
  }),
  'frontend/scripts/check-seo-production.js': Object.freeze({
    lecture: 'GET /api/jobs?status=… — seconde source des fiches du sitemap',
    surfaces: Object.freeze(['seo-production:fiches']),
  }),
  'frontend/scripts/check-job-form-canari.js': Object.freeze({
    lecture:
      'POST /api/jobs puis DELETE /api/jobs/:id — le canari crée SA mission de contrôle, juge la forme de sa fiche, puis la supprime',
    surfaces: Object.freeze(['job-form-canari:forme']),
  }),
});

// Les clés des surfaces, NOMMÉES : une sonde ne recopie pas une chaîne, et le
// garde retrouve la clé dans le fichier de sa sonde (une chaîne recopiée serait
// une seconde source, celle qui dérive en silence).
export const SURFACE_OG_IMAGES_FICHE_200 = 'og-images:fiche-200';
export const SURFACE_OG_JOB_200_CYCLE = 'og-job-200:cycle';
export const SURFACE_SEO_PRODUCTION_FICHES = 'seo-production:fiches';
export const SURFACE_JOB_FORM_CANARI_FORME = 'job-form-canari:forme';

/**
 * LE REGISTRE des surfaces aveugles déclarées : ce qu'une sonde ne peut plus
 * mesurer quand le corpus est vide, pourquoi, et ce qu'il faudrait pour le
 * mesurer.
 *
 * Une entrée dit quatre choses, et le garde refuse une entrée qui n'en dirait
 * pas assez : le CHEMIN couvert (la surface, nommée comme un lecteur la lit),
 * le MOTIF (≥ 40 caractères : pourquoi la sonde est aveugle ICI), le REMÈDE
 * (≥ 20 caractères : ce qu'il faudrait pour la mesurer, ou où elle l'est déjà),
 * et la DATE de la déclaration (ISO).
 *
 * Retirer une entrée n'est pas une façon de faire taire le garde : la sonde
 * refuserait alors en nommant la clé absente. Une entrée PÉRIMÉE (que sa sonde
 * ne demande plus) est refusée aussi — une exemption que plus rien ne justifie
 * finira par justifier autre chose.
 */
export const SURFACES = Object.freeze([
  Object.freeze({
    cle: SURFACE_OG_IMAGES_FICHE_200,
    sonde: 'frontend/scripts/check-og-images.js',
    corpus: 'missions-vivantes',
    chemin:
      'branche 200 de /jobs/:id — méta OG d’une mission réelle (og:title, og:image wide + variante carrée, PNG Pillow 1200×630 et 1200×1200)',
    motif:
      'la branche 200 ne s’exerce qu’avec une mission EXISTANTE dans le backend audité : sans elle, la sonde ne juge que le chemin 404, et la carte OG d’une fiche vivante n’est vérifiée nulle part sur cette base',
    remede:
      'publier une mission vivante sur la base auditée — ou lire cette surface là où le corpus est déterministe : la pile locale de la CI, où check-og-job-200.js crée sa propre mission avant de la supprimer',
    depuis: '2026-10-12',
  }),
  Object.freeze({
    cle: SURFACE_OG_JOB_200_CYCLE,
    sonde: 'frontend/scripts/check-og-job-200.js',
    corpus: 'missions-vivantes',
    chemin:
      'cycle complet de /jobs/:id — création d’une mission de test, fiche pré-rendue en 200, cartes Pillow, suppression, puis verrou 404 + noindex + sitemap',
    motif:
      'le cycle ÉCRIT (POST puis DELETE) : il ne tourne donc que dans un backend contrôlé par le job (loopback), et un déploiement réel — dont le corpus est vide aujourd’hui — n’est jamais exercé par lui (la CI n’écrit pas chez le client)',
    remede:
      'lire cette surface sur la pile locale du job (KOJO_BACKEND_URL = 127.0.0.1, où le cycle tourne pour de vrai) et en processus par backend/tests/test_job_og_cycle.py ; ce script reste celui qui prouve le déploiement réel, et il le dit quand il ne le fait pas',
    depuis: '2026-10-12',
  }),
  Object.freeze({
    cle: SURFACE_SEO_PRODUCTION_FICHES,
    sonde: 'frontend/scripts/check-seo-production.js',
    corpus: 'missions-vivantes',
    chemin:
      'fiches /jobs/:id de la sonde SEO — canonical, title et description sur des fiches réelles (les deux sources : sitemap ET API publique)',
    motif:
      'les deux sources concordent sur un corpus VIDE (sitemap sans fiche + API qui répond `[]`) : la sonde publie honnêtement « aucune jugée », mais elle ne juge alors la forme d’AUCUNE fiche réelle',
    remede:
      'publier une mission vivante en production : la sonde la lira par l’API (même absente de tout sitemap) et la jugera ; un sitemap muet accompagné d’une API ILLISIBLE, lui, est déjà REFUSÉ (deux sources muettes ne valent pas « aucune mission »)',
    depuis: '2026-10-12',
  }),
  Object.freeze({
    cle: SURFACE_JOB_FORM_CANARI_FORME,
    sonde: 'frontend/scripts/check-job-form-canari.js',
    corpus: 'missions-vivantes',
    chemin:
      'forme de /jobs/:id jugée sur une mission de CONTRÔLE — création (POST /api/jobs), lecture du document servi (<title>, description, meta robots, canonical, og:url, twitter:url, og:title accordé au <title>, <h1> statique), cartes OG en HTTP réel, suppression, puis verrou 404 + noindex + carte 404 + sitemap',
    motif:
      'le canari ÉCRIT : hors d’un backend que le job contrôle (loopback), il n’a le droit de créer sa mission que sous mandat explicite (KOJO_CANARI_ALLOW_WRITE=1), et sans ce mandat la forme d’une fiche n’est jugée sur aucune base réelle — le corpus du client étant vide, personne d’autre ne la juge non plus',
    remede:
      'poser le mandat dans un run délibéré (KOJO_CANARI_ALLOW_WRITE=1 avec KOJO_LHCI_BASE_URL et KOJO_BACKEND_URL pointant sur le déploiement réel) — jamais sur une PR, où la CI écrit chez le client ; ou lire cette surface sur la pile locale (KOJO_BACKEND_URL=127.0.0.1), où elle tourne sans mandat à chaque run',
    depuis: '2026-10-16',
  }),
]);

/**
 * Le nom de la constante qui NOMME une clé de surface (`og-images:fiche-200` →
 * `SURFACE_OG_IMAGES_FICHE_200`).
 *
 * Une sonde ne recopie pas sa clé en clair : elle passe la CONSTANTE. Le garde a
 * donc besoin de la dériver, et il vérifie en plus que le registre l'exporte avec
 * exactement cette valeur — une constante renommée ou une clé retouchée côté
 * registre rendrait sinon une déclaration qui ne désigne plus rien, en silence.
 */
export const nomDeLaConstante = (cle) =>
  `SURFACE_${String(cle).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

/** Une surface déclarée, par sa clé, ou `null`. */
export const surfaceParCle = (cle) => SURFACES.find((surface) => surface.cle === cle) || null;

/** Les surfaces déclarées par une sonde donnée. */
export const surfacesDe = (fichier) =>
  SURFACES.filter((surface) => surface.sonde === fichier);

/**
 * Le verdict qu'une sonde demande AVANT de publier un corpus vide.
 *
 * Déclarée : un `avertissement` (publié en `::warning` par l'appelant) qui dit
 * la clé, le corpus, le chemin non mesuré, le détail mesuré du run, le motif et
 * le remède — assez pour qu'un lecteur du résumé sache quoi faire sans ouvrir ce
 * fichier.
 *
 * NON déclarée : une `erreur`, et l'appelant REFUSE. C'est la seule branche qui
 * peut rougir, et elle ne porte pas sur l'état des données mais sur le CODE : une
 * sonde qui ne peut rien mesurer doit le déclarer, sinon son silence est le
 * défaut qu'on refuse.
 *
 * @param {{cle: string, detail?: string}} options
 * @returns {{declare: boolean, avertissement: string, erreur: string}}
 */
export function verdictDeSurfaceVide({ cle, detail = '' } = {}) {
  const surface = surfaceParCle(cle);
  const suffixe = detail ? ` Mesuré ce run : ${detail}.` : '';
  if (!surface) {
    return {
      declare: false,
      avertissement: '',
      erreur:
        `SURFACE AVEUGLE NON DÉCLARÉE « ${cle} » : cette sonde ne peut plus rien mesurer ` +
        `(corpus vide) et cette surface n'est pas au registre (${REGISTRE}).${suffixe} Déclarer ` +
        `la clé avec son chemin, son motif (pourquoi elle est aveugle), son remède (ce qu'il ` +
        `faudrait pour la mesurer) et sa date — un vert qui n'a rien mesuré est le silence ` +
        `que F9 a coûté (CI-COVERAGE.md).`,
    };
  }
  const { label } = CORPUS[surface.corpus] || { label: surface.corpus };
  return {
    declare: true,
    erreur: '',
    avertissement:
      `Surface aveugle DÉCLARÉE « ${surface.cle} » — ${surface.chemin} n'a PAS été mesurée : ` +
      `le corpus « ${label} » est vide.${suffixe} Motif : ${surface.motif}. ` +
      `Remède : ${surface.remede}. (Déclaré le ${surface.depuis}.)`,
  };
}

/** Longueurs minimales d'un motif et d'un remède — en dessous, ils ne disent rien. */
export const LONGUEURS = Object.freeze({ motif: 40, remede: 20 });

/** Une date de déclaration : ISO, jour seul. */
export const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Planchers de lecture du garde : en dessous, il refuse de conclure (un
 * balayage cassé rendrait tous ses refus muets en rendant son périmètre vide).
 */
export const PLANCHERS_LECTURE = Object.freeze({
  fichiers: 30,
  sondes: 3,
  surfaces: 3,
  corpus: 1,
});

/**
 * La source, COMMENTAIRES RETIRÉS — chaînes et gabarits préservés.
 *
 * Nécessaire parce que le corpus est cité en prose à plusieurs endroits du dépôt
 * (`lhci-cls-budgets.cjs`, `mesure-lighthouse-locale.mjs`,
 * `vercel-rewrite-server.js` en parlent dans des commentaires) : compter une
 * phrase pour une lecture ferait crier le garde sur des fichiers qui ne lisent
 * rien. Limite assumée et écrite : les expressions régulières ne sont pas
 * décodées — un littéral `/…/` ne peut pas contenir `//` non échappé en
 * JavaScript, donc ce lecteur ne peut pas confondre un motif et un commentaire.
 */
export function sansCommentaires(source) {
  const texte = String(source);
  let sortie = '';
  let etat = 'code'; // code | ligne | bloc | chaine
  let guillemet = '';
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i];
    const suivant = texte[i + 1];
    if (etat === 'ligne') {
      if (c === '\n') {
        etat = 'code';
        sortie += c;
      }
      continue;
    }
    if (etat === 'bloc') {
      if (c === '*' && suivant === '/') {
        etat = 'code';
        i += 1;
      } else if (c === '\n') {
        sortie += c; // les sauts de ligne restent : les numéros de ligne suivent
      }
      continue;
    }
    if (etat === 'chaine') {
      sortie += c;
      if (c === '\\') {
        sortie += suivant === undefined ? '' : suivant;
        i += 1;
      } else if (c === guillemet) {
        etat = 'code';
      }
      continue;
    }
    if (c === '/' && suivant === '/') {
      etat = 'ligne';
      i += 1;
      continue;
    }
    if (c === '/' && suivant === '*') {
      etat = 'bloc';
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      etat = 'chaine';
      guillemet = c;
      sortie += c;
      continue;
    }
    sortie += c;
  }
  return sortie;
}

/**
 * Ce fichier LIT-IL le corpus des missions ? Mesuré sur le code, jamais sur la
 * prose : un appel `fetch…` dont la fenêtre suivante porte le chemin du corpus,
 * soit écrit en clair, soit par un identifiant qui VAUT ce chemin
 * (`const PUBLIC_JOBS_PATH = '/api/jobs'`).
 *
 * Le balayage est volontairement étroit : c'est la LECTURE qu'on veut attraper
 * (une sonde qui interroge l'API publique), jamais la mention du chemin dans un
 * commentaire ou dans un serveur qui réécrit cette route.
 */
export function litLeCorpus(source) {
  const code = sansCommentaires(source);
  const identifiants = [
    ...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]\/api\/jobs['"]/g),
  ].map((m) => m[1]);
  const cibles = ['/api/jobs', ...identifiants];
  for (const appel of code.matchAll(/fetch[A-Za-z]*\s*\(/g)) {
    const fenetre = code.slice(appel.index, appel.index + 240);
    if (cibles.some((cible) => fenetre.includes(cible))) return true;
  }
  return false;
}

/**
 * L'AUDIT de l'inventaire, PUR (les sources sont injectées : le garde fait
 * l'E/S, ce module porte le jugement, et les deux sont testables séparément).
 *
 * @param {Record<string, string|null>} sources Chemin → source (null = illisible).
 *   Les clés sont les fichiers BALAYÉS (`frontend/scripts/*.js`, sans le
 *   registre lui-même, que l'appelant peut omettre).
 * @param {{corpus?: object, sondes?: object, surfaces?: object[], registre?: string}} [inventaire]
 *   L'inventaire à juger — injectable comme `fetchImpl` l'est dans les sondes :
 *   les cas limites (motif trop court, plancher non atteint, déclaration
 *   périmée) se mesurent alors SANS muter le registre réel, et le registre
 *   livré garde une seule valeur.
 * @returns {{refus: string[], lues: {fichiers: number, sondes: number, surfaces: number, corpus: number}}}
 */
export function auditerInventaire(
  sources = {},
  { corpus: CORPUS_JUGE = CORPUS, sondes: SONDES_JUGES = SONDES, surfaces: SURFACES_JUGEES = SURFACES, registre = REGISTRE } = {}
) {
  const refus = [];
  const corpusCles = Object.keys(CORPUS_JUGE);
  const sondesCles = Object.keys(SONDES_JUGES);
  const parCle = (cle) => SURFACES_JUGEES.find((surface) => surface.cle === cle) || null;

  // ── 1. Le corpus : un plancher qui refuse quelque chose, et une lecture dite.
  for (const [cle, corpus] of Object.entries(CORPUS_JUGE)) {
    if (!Number.isInteger(corpus.plancher) || corpus.plancher < 1) {
      refus.push(
        `corpus « ${cle} » : plancher ${JSON.stringify(corpus.plancher)} — un plancher sous 1 ne ` +
          `refuse rien, donc il ne dit pas à partir de quand la sonde n'a rien mesuré`
      );
    }
    if (!String(corpus.label || '').trim() || !String(corpus.lecture || '').trim()) {
      refus.push(`corpus « ${cle} » : label ou lecture vide — le corpus n'est pas décrit`);
    }
  }

  // ── 2. Le registre : chaque surface dit assez pour être jugée.
  const clesVues = new Set();
  for (const surface of SURFACES_JUGEES) {
    const ou = `surface « ${surface.cle} »`;
    if (!surface.cle || clesVues.has(surface.cle)) {
      refus.push(`${ou} : clé vide ou déclarée deux fois`);
      continue;
    }
    clesVues.add(surface.cle);
    if (!sondesCles.includes(surface.sonde)) {
      refus.push(
        `${ou} : la sonde ${surface.sonde} n'est pas déclarée dans SONDES — une surface déclarée ` +
          `par une sonde inconnue ne sera jamais demandée par personne`
      );
    }
    if (!corpusCles.includes(surface.corpus)) {
      refus.push(`${ou} : corpus « ${surface.corpus} » inconnu de CORPUS`);
    }
    if (!String(surface.chemin || '').trim()) {
      refus.push(`${ou} : chemin vide — la déclaration ne dit pas QUELLE surface est aveugle`);
    }
    if (String(surface.motif || '').length < LONGUEURS.motif) {
      refus.push(
        `${ou} : motif de ${String(surface.motif || '').length} caractère(s) (< ${LONGUEURS.motif}) — ` +
          `« aveugle » sans POURQUOI n'est pas une déclaration`
      );
    }
    if (String(surface.remede || '').length < LONGUEURS.remede) {
      refus.push(
        `${ou} : remède de ${String(surface.remede || '').length} caractère(s) (< ${LONGUEURS.remede}) — ` +
          `une surface aveugle sans remède est une surface qu'on accepte de ne plus mesurer`
      );
    }
    if (!DATE_ISO.test(String(surface.depuis || ''))) {
      refus.push(`${ou} : date de déclaration « ${surface.depuis} » (ISO AAAA-MM-JJ attendue)`);
    }
  }

  // ── 3. Chaque sonde DÉCLARÉE consulte le registre, publie son warning, et
  //    demande VRAIMENT chacune des surfaces qu'elle déclare.
  for (const [fichier, sonde] of Object.entries(SONDES_JUGES)) {
    const source = sources[fichier];
    if (source === undefined) {
      refus.push(`sonde ${fichier} : fichier absent du balayage — le périmètre du garde est cassé`);
      continue;
    }
    if (source === null) {
      refus.push(`sonde ${fichier} : source illisible — le garde ne peut pas juger sa déclaration`);
      continue;
    }
    if (!litLeCorpus(source)) {
      refus.push(
        `sonde ${fichier} : déclarée comme lisant le corpus (${sonde.lecture}), mais son code ne ` +
          `l'interroge plus — déclaration PÉRIMÉE`
      );
    }
    if (!source.includes('verdictDeSurfaceVide')) {
      refus.push(
        `sonde ${fichier} : ne consulte pas verdictDeSurfaceVide (${REGISTRE}) — elle peut donc ` +
          `ne rien mesurer sans le déclarer`
      );
    }
    if (!source.includes('::warning')) {
      refus.push(
        `sonde ${fichier} : ne publie aucun ::warning — une surface aveugle connue mais MUETTE ` +
          `n'est pas une surface aveugle déclarée`
      );
    }
    for (const cle of sonde.surfaces) {
      if (!parCle(cle)) {
        refus.push(
          `sonde ${fichier} : déclare la surface « ${cle} », absente du registre SURFACES — ` +
            `verdictDeSurfaceVide la refuserait à l'exécution`
        );
        continue;
      }
      const nommee =
        source.includes(cle) || source.includes(nomDeLaConstante(cle));
      if (!nommee) {
        refus.push(
          `surface « ${cle} » : déclarée dans SONDES mais INTROUVABLE dans ${fichier} — ` +
            `sa sonde ne la demande jamais (elle doit passer la constante ` +
            `${nomDeLaConstante(cle)}, ou son littéral, à verdictDeSurfaceVide)`
        );
      }
    }
  }

  // ── 4. Le registre NOMME ses clés : chaque surface a une constante exportée
  //    dont la valeur EST la clé, et la déclaration de sa sonde la liste. Sinon
  //    le registre et la sonde désigneraient deux choses différentes, en silence.
  const registreSource = typeof sources[registre] === 'string' ? sources[registre] : '';
  for (const surface of SURFACES_JUGEES) {
    const constante = nomDeLaConstante(surface.cle);
    if (!registreSource.includes(`export const ${constante} = '${surface.cle}'`)) {
      refus.push(
        `surface « ${surface.cle} » : le registre n'exporte pas \`${constante}\` avec la clé pour ` +
          `valeur — les sondes nomment une constante qui ne désigne plus cette surface`
      );
    }
    const declaration = SONDES_JUGES[surface.sonde];
    if (declaration && !declaration.surfaces.includes(surface.cle)) {
      refus.push(
        `surface « ${surface.cle} » : déclarée au registre mais ABSENTE de la liste de sa sonde ` +
          `${surface.sonde} — la déclaration de la sonde ne la reconnaît pas (exemption que rien ` +
          `ne justifie)`
      );
    }
  }

  // ── 5. Le périmètre : tout fichier qui LIT le corpus doit être déclaré, et
  //    l'exemption du registre doit encore avoir un sujet.
  let fichiersLus = 0;
  for (const [fichier, source] of Object.entries(sources)) {
    if (source === null) {
      refus.push(`${fichier} : illisible — le balayage ne peut pas conclure sur ce fichier`);
      continue;
    }
    fichiersLus += 1;
    if (fichier === registre) continue;
    const declare = Object.prototype.hasOwnProperty.call(SONDES_JUGES, fichier);
    const lit = litLeCorpus(source);
    if (lit && !declare) {
      refus.push(
        `${fichier} : lit le corpus (${Object.keys(CORPUS_JUGE).join(', ')}) sans être déclaré dans ` +
          `SONDES — une sonde ajoutée demain peut donc ne plus rien mesurer en silence`
      );
    }
  }
  if (!sources[registre] || !String(sources[registre]).includes('/api/jobs')) {
    refus.push(
      `l'exemption du registre (${registre}) n'a plus de sujet : il ne porte plus le chemin du ` +
        `corpus — retirer l'exemption plutôt que de la laisser justifier autre chose`
    );
  }

  const lues = {
    fichiers: fichiersLus,
    sondes: sondesCles.length,
    surfaces: SURFACES_JUGEES.length,
    corpus: corpusCles.length,
  };

  // ── 6. Planchers de lecture : un périmètre vide rend tous les refus ci-dessus
  //    muets, et c'est précisément ce qui passerait pour un vert.
  for (const [grandeur, plancher] of Object.entries(PLANCHERS_LECTURE)) {
    if (lues[grandeur] < plancher) {
      refus.push(
        `plancher de lecture non atteint : ${lues[grandeur]} ${grandeur} lue(s) < ${plancher} — ` +
          `le garde refuse de conclure (un balayage vide ne prouve rien)`
      );
    }
  }

  return { refus, lues };
}
