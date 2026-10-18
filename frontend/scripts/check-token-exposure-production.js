#!/usr/bin/env node
/**
 * SONDE D'EXPOSITION DU JETON — un jeton apparaît-il sur le DOMAINE WEB SERVI ?
 *
 * ── Le fait jugé ────────────────────────────────────────────────────────────
 * Sur le web, la session est un cookie httpOnly : illisible par un script, donc
 * inviolable par une injection. Tout le reste est une régression, et chacune a
 * sa forme observable dans un vrai navigateur :
 *
 *   1. un réservoir (localStorage / sessionStorage) porte une CLÉ de
 *      justificatif (`token`, `jwt`, `auth`…) — le motif sous lequel une
 *      ancienne version rangeait le jeton de session ;
 *   2. une VALEUR rangée n'importe où — et un cookie lisible, et l'URL de la
 *      page — a la FORME d'un JWT : c'est un jeton, quel que soit son nom ;
 *   3. une requête émise par la page porte un en-tête `Authorization` — le
 *      canal du shell natif, jamais celui du web.
 *
 * Une seule de ces trois formes suffit à voler une session : le premier script
 * tiers exécuté sur la page (régie, extension, XSS) lit le stockage, lit
 * `document.cookie` et lit l'URL. La sonde ÉCHOUE donc, au lieu de publier un
 * relevé — c'est un invariant, pas une métrique.
 *
 * ── Ce qu'elle ne publie jamais ─────────────────────────────────────────────
 * Ni valeur de jeton, ni en-tête, ni query string. Le relevé est calculé DANS la
 * page (les valeurs ne sortent jamais du navigateur) et ne remonte que des
 * couples (réservoir, clé, forme). Un journal de CI qui cite un jeton est un
 * jeton publié — la sonde de session applique déjà cette règle à son cookie.
 *
 * ── Ce qui la fait refuser (sortie 1), en plus d'une exposition ─────────────
 *   • un COMPTE CI absent : sans identifiant, aucune session ne s'ouvre, donc il
 *     n'y a rien à exposer — un vert sans session ne mesurerait rien ;
 *   • une session qui ne s'ouvre pas (le compte, le réseau, le contournement) ;
 *   • un RÉSERVOIR ILLISIBLE (navigation privée stricte, politique du
 *     navigateur) : la surface devient aveugle sans que personne l'ait déclarée.
 *     Une sonde qui conclurait « aucun jeton » sur un stockage qu'elle n'a pas pu
 *     lire serait exactement le silence qu'un corpus vide a déjà coûté ;
 *   • les refus propres au shell natif (voir ci-dessous) : jeton non écrit à la
 *     connexion, redémarrage qui porte des cookies, application muette au
 *     redémarrage, session restaurée SANS le jeton, jeton disparu, 401.
 *
 * ── Ce refus n'est PAS celui du RECHARGEMENT ────────────────────────────────
 * Deux sondes de production ouvrent le même formulaire servi et rechargent la
 * même page ; elles ne rougissent pas pour la même chose, et ce n'est pas une
 * nuance de rédaction : confondre les deux envoie corriger le mauvais fichier
 * (les attributs du cookie ou la garde d'amorçage pour un jeton exposé).
 *   • ICI, le fait jugé est ce que la page PORTE et ce qu'elle ENVOIE. Le
 *     rechargement n'y est qu'un INSTANT de mesure — celui où une application
 *     qui relirait un jeton le réécrirait. Une session qui ne revient pas après
 *     le rechargement (aucun appel d'amorçage, 401, retour à `LOGIN_PATH`) ne
 *     fait donc PAS rougir cette sonde : elle la publie comme un fait relevé,
 *     et le refus appartient à `check-session-reload-production.js`
 *     (`::error title=Session production::`), qui juge le cookie et la garde
 *     d'amorçage. Prouvé par le cas « un rechargement non restauré ne rougit
 *     PAS ici » ;
 *   • les refus de PRÉMISSE (compte CI absent, contexte non vierge, connexion
 *     impossible, session non ouverte) sont marqués `MARQUE_PREMISSE` et portent
 *     `RENVOI_RECHARGEMENT` : sans session établie il n'y a rien à exposer ici,
 *     ce qui n'est pas un verdict sur le rechargement ;
 *   • chaque refus porte donc sa FAMILLE dans le message lui-même (`FAMILLE`),
 *     pas seulement dans le titre de l'annotation : un journal de CI se relit
 *     seul, sans savoir de quel workflow il vient. Garde :
 *     `frontend/scripts/__tests__/check-sondes-production-distinctes.test.js`.
 *
 * ── Comment elle juge, et sur quelle surface ────────────────────────────────
 * Par le CHEMIN DE L'UTILISATEUR, dans Chromium : la page servie, le formulaire
 * servi, puis un RECHARGEMENT — le moment où une application qui relit un jeton
 * en stockage le réécrit. La surface par défaut est la production (`SITE_ORIGIN`,
 * `scripts/site-meta.js`) ; `--base` en juge une autre (une preview Vercel, avec
 * le secret de contournement `VERCEL_AUTOMATION_BYPASS_SECRET`, jamais une entrée
 * de dispatch).
 *
 * ── Deux instants, pas un ───────────────────────────────────────────────────
 * Le relevé est pris DEUX fois : au PREMIER instant du document (un script posé
 * avant tout script de la page) et après l'amorçage de l'application. Le premier
 * n'est pas un luxe : l'application purge elle-même au démarrage les clés de
 * jeton laissées par une version précédente (`purgeWebSessionTokens`,
 * `frontend/src/contexts/AuthContext.js`), donc un jeton hérité est LISIBLE
 * pendant tout le chargement puis absent du relevé final — mesurer seulement
 * après l'amorçage rendrait vert le seul cas que cette sonde existe pour
 * attraper (constaté sur l'origine servie le 16/10/2026 : clé `token` posée,
 * disparue au relevé final, jamais vue par la sonde). Le premier instant est
 * aussi celui où un script tiers s'exécute : c'est ce qu'il pouvait lire.
 *
 * ── Le shell natif, jugé À L'ENVERS, dans le même passage ───────────────────
 * Le même bundle est ensuite jugé sous les marqueurs du shell natif Capacitor
 * (`isNativeShell()`, `window.Capacitor.isNativePlatform()`) : là, le jeton DOIT
 * être écrit — la WebView n'a pas de cookie de session fiable, donc le jeton est
 * le seul canal qui survit à un redémarrage. La sonde vérifie donc que le jeton
 * SURVIT : elle ouvre une seconde fois le contexte avec le SEUL stockage du
 * premier (aucun cookie, aucun sessionStorage) et exige que l'application
 * retrouve sa session — `GET /auth/me` → 200, porté par un en-tête `Authorization`.
 *
 * Les deux moitiés se répondent, et c'est pour ça qu'elles vivent dans le même
 * passage : un web qui garde le jeton et un natif qui le perd sont la même
 * erreur vue de deux côtés, et un seul marqueur (`isNativeShell`) décide des deux.
 * Le web ne doit RIEN garder ; le natif ne doit RIEN perdre. Une fois les
 * prémisses communes établies (contexte vierge, connexion qui aboutit), les deux
 * verdicts sont collectés ensemble, aucun n'étant court-circuité par l'autre :
 * un rouge de l'une des moitiés ne peut pas cacher l'autre.
 *
 * Ce que le shell natif ne peut pas être ici, dit plutôt que tu : une vraie
 * application installée. La sonde pose le marqueur que `isNativeShell()` lit et
 * rejoue un redémarrage (contexte neuf, même stockage) — c'est le CONTRAT du
 * bundle servi qu'elle juge, pas l'APK. Le contrat CASSE se voit d'ici (marqueur
 * ignoré, purge appliquée au natif, canal Bearer perdu) ; ce qui dépend du
 * WebView (persistance réelle du stockage sur l'appareil) ne se voit pas.
 *
 * Usage :
 *   node scripts/check-token-exposure-production.js
 *   node scripts/check-token-exposure-production.js --base https://<preview>.vercel.app
 *   node scripts/check-token-exposure-production.js --tentatives 3 --delai 15
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE_ORIGIN } from './site-meta.js';
import {
  ATTEMPTS,
  AUTH_ME_PATH,
  BYPASS_ENV,
  EMAIL_SELECTOR,
  LOGIN_PATH,
  LOGIN_TIMEOUT_MS,
  PASSWORD_SELECTOR,
  RESTORE_TIMEOUT_MS,
  RETRY_DELAY_MS,
  SESSION_COOKIE_NAME,
  SUBMIT_SELECTOR,
  contextOptions,
  origineDuCookie,
} from './check-session-reload-production.js';

/**
 * Clés de stockage qui, par leur NOM, désignent un justificatif. Motif IDENTIQUE
 * à celui que la sonde de session publie en relevé (`jetonEnStockage`) : deux
 * sondes qui jugeraient la même chose sur deux listes différentes finiraient par
 * se contredire.
 */
export const TOKEN_KEY_PATTERN = /token|jwt|auth/i;

/** Forme d'un JWT : trois segments base64url d'au moins 8 caractères. */
export const JWT_VALUE_PATTERN = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

/**
 * La FAMILLE de cette sonde — ce qu'un rouge prononcé ici veut dire. Elle est
 * écrite DANS chaque refus, en plus du titre de l'annotation : deux sondes de
 * production se connectent au même formulaire et rechargent la même page, donc
 * un refus sans famille se lirait comme un refus de l'autre (même titre générique
 * de session, même vocabulaire d'amorçage).
 */
export const FAMILLE = 'exposition du jeton';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * Renvoi de famille : le refus qui suit n'est PAS celui de la sonde de session au
 * rechargement. Les deux sondes partagent des prémisses (le même compte CI, le
 * même formulaire servi, le même rechargement) ; le fait jugé, lui, ne se
 * confond pas — il est nommé ici pour qu'une panne de connexion ne se lise pas
 * comme une session perdue au rechargement.
 */
export const RENVOI_RECHARGEMENT =
  "ce n'est pas le refus de la sonde de session au rechargement " +
  "(check-session-reload-production.js, ::error title=Session production::) : ici le rechargement n'est " +
  "qu'un INSTANT de mesure, et une session non restaurée ne rougit pas cette sonde.";

/** Libellé du run : la famille de ce refus, puis la surface jugée. */
export const libelleSonde = (base) => `${FAMILLE} sur ${base}`;

/** Compose un refus de prémisse : la marque, le fait, puis le renvoi de famille. */
export const premisse = (fait) => `${MARQUE_PREMISSE} · ${fait} ${RENVOI_RECHARGEMENT}`;

/**
 * Relevé pris DANS la page — et seule la page peut le prendre : `document.cookie`,
 * les deux réservoirs et l'URL ne sont lisibles que là où le script attaquant
 * s'exécuterait. Les VALEURS ne quittent pas cette fonction : ce qui remonte est
 * un couple (réservoir, clé, forme), jamais un jeton.
 *
 * Une évaluation = un instant. Le relevé est pris après le rechargement, quand
 * l'application a fini de s'amorcer : c'est là qu'un jeton relu serait réécrit.
 *
 * @returns {{trouvailles: Array<{ou: string, cle: string, forme: string}>,
 *   lisibles: Record<string, boolean>, cookiesLisibles: boolean, url: string}}
 */
export const LECTURE_DU_DOMAINE = () => {
  const clesDeJeton = /token|jwt|auth/i;
  const formeDeJwt = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
  const trouvailles = [];
  const lisibles = {};

  for (const nom of ['localStorage', 'sessionStorage']) {
    lisibles[nom] = false;
    try {
      const reservoir = window[nom];
      // Un accès refusé (mode privé strict) lève ici : la surface est déclarée
      // aveugle par son relevé, jamais par un silence.
      if (!reservoir) continue;
      lisibles[nom] = true;
      for (let index = 0; index < reservoir.length; index += 1) {
        const cle = String(reservoir.key(index));
        const valeur = String(reservoir.getItem(cle) ?? '').trim();
        if (clesDeJeton.test(cle)) {
          trouvailles.push({ ou: nom, cle, forme: 'nom de justificatif' });
        } else if (formeDeJwt.test(valeur)) {
          trouvailles.push({ ou: nom, cle, forme: 'valeur en forme de JWT' });
        }
      }
    } catch (_erreur) {
      lisibles[nom] = false;
    }
  }

  let cookies = null;
  try {
    cookies = String(document.cookie || '')
      .split(';')
      .map((morceau) => morceau.trim())
      .filter(Boolean);
  } catch (_erreur) {
    cookies = null;
  }
  for (const cookie of cookies || []) {
    const [nom, ...reste] = cookie.split('=');
    const valeur = decodeURIComponent(reste.join('=') || '').trim();
    if (formeDeJwt.test(valeur)) {
      trouvailles.push({ ou: 'document.cookie', cle: nom, forme: 'valeur en forme de JWT' });
    }
  }

  // Un jeton dans l'URL se juge là où il serait LISIBLE : un paramètre, un
  // fragment ou un segment dont la VALEUR ENTIÈRE a la forme d'un JWT. Jamais
  // une recherche de sous-chaîne : « trois suites de 8 caractères séparées par
  // des points » se rencontre dans du texte libre (une description de profil en
  // cache, par exemple), et un faux rouge ferait perdre la sonde entière.
  let url = '';
  try {
    url = String(window.location.href || '');
    const adresse = new URL(url);
    const surfaces = [
      ['location.search', [...adresse.searchParams.values()]],
      ['location.hash', [...new URLSearchParams(adresse.hash.replace(/^#/, '')).values()]],
      ['location.pathname', adresse.pathname.split('/').filter(Boolean)],
    ];
    for (const [surface, valeurs] of surfaces) {
      const porteUnJeton = valeurs.some((valeur) => formeDeJwt.test(String(valeur).trim()));
      if (porteUnJeton) {
        trouvailles.push({ ou: 'URL de la page', cle: surface, forme: 'valeur en forme de JWT' });
      }
    }
  } catch (_erreur) {
    // URL illisible : aucune trouvaille — l'absence de preuve n'est pas une
    // preuve d'absence, mais l'URL n'est pas une surface qu'on peut rendre
    // aveugle depuis la page (elle est TOUJOURS celle qu'on vient de charger).
  }

  // L'URL est rendue pour le diagnostic, JAMAIS publiée par la sonde : elle
  // peut porter un jeton, et un jeton journalisé est un jeton publié.
  return { trouvailles, lisibles, cookiesLisibles: cookies !== null, url };
};

/**
 * Clé de fenêtre où le script d'avant-amorçage dépose son relevé. Une clé NOMMÉE
 * et lisible par la sonde : le relevé est pris dans la page, jamais publié.
 */
export const CLE_RELEVE_AVANT_BOOT = '__kojoSondeJetonAvantBoot';

/** Phase du relevé : le premier instant du document, avant tout script de l'app. */
export const AVANT_AMORCAGE = "avant l'amorçage de l'application";

/** Phase du relevé : après l'amorçage de l'application (relevé final). */
export const APRES_AMORCAGE = "après l'amorçage de l'application";

/**
 * Script posé AVANT tout script de la page (`page.addInitScript`) : il dépose,
 * au premier instant du document, le relevé du domaine tel qu'il ÉTAIT. Voir
 * « Deux instants, pas un » en tête de fichier : sans lui, un jeton hérité — que
 * l'application purge au démarrage — serait exposé pendant tout le chargement
 * puis invisible à la sonde.
 *
 * Le script est construit à partir de `LECTURE_DU_DOMAINE` (même code, mêmes
 * règles) : deux façons de lire le domaine finiraient par juger deux choses.
 * Playwright pose ce script hors du contrôle de la page, donc une CSP qui
 * interdirait un script en ligne ne l'empêche pas.
 *
 * @returns {string} Source JavaScript à exécuter au premier instant.
 */
export const sourceReleveAvantBoot = () =>
  `try { window[${JSON.stringify(CLE_RELEVE_AVANT_BOOT)}] = (${LECTURE_DU_DOMAINE.toString()})(); } catch (_erreur) {}`;

/**
 * Le verdict, sans navigateur : ce que le relevé et le journal des requêtes
 * signifient. Fonction pure, donc éprouvable sur des cas écrits à la main.
 *
 * @param {object} releve
 * @param {Array<{ou: string, cle: string, forme: string}>} [releve.trouvailles]
 * @param {Record<string, boolean>} [releve.lisibles]
 * @param {boolean} [releve.cookiesLisibles]
 * @param {object} [journal]
 * @param {Array<{methode: string, chemin: string}>} [journal.requetes] Requêtes portant un en-tête Authorization.
 * @param {number} [journal.vues] Nombre de requêtes observées, toutes confondues : le PLANCHER.
 * @param {string} [journal.quand] Phase du relevé (`AVANT_AMORCAGE` ou `APRES_AMORCAGE`) :
 *   elle nomme le refus, et le plancher de lecture ne vaut que pour le relevé final,
 *   le seul qui s'appuie sur l'écoute des requêtes.
 * @returns {string[]} Les refus, dans l'ordre où ils sont prononcés.
 */
export function jugerExposition(
  { trouvailles = [], lisibles = {}, cookiesLisibles = true } = {},
  { requetes = [], vues = 0, quand = APRES_AMORCAGE } = {}
) {
  const errors = [];
  const phase = quand === AVANT_AMORCAGE ? AVANT_AMORCAGE : APRES_AMORCAGE;

  // PLANCHER DE LECTURE : si aucune requête n'a été observée, l'écoute des
  // en-têtes n'a rien prouvé du tout — un zéro peut être un silence, pas une
  // absence. La sonde refuse alors de conclure au lieu de publier un vert sur
  // une surface qu'elle n'a pas su brancher. Ce plancher ne concerne QUE le
  // relevé final : le relevé d'avant amorçage ne s'appuie sur aucune écoute.
  if (phase === APRES_AMORCAGE && vues < 1) {
    errors.push(
      "surface aveugle : aucune requête n'a été observée pendant le parcours, donc l'absence " +
        "d'en-tête Authorization n'a rien mesuré (écoute non branchée, page non servie, ou parcours " +
        'interrompu). Un compteur à zéro ne vaut pas une preuve.'
    );
  }

  for (const [reservoir, lisible] of Object.entries(lisibles)) {
    if (!lisible) {
      errors.push(
        `surface aveugle : ${reservoir} est illisible dans ce navigateur (relevé pris ${phase}). La sonde ne ` +
          "peut PAS prouver l'absence de jeton là où elle n'a rien pu lire — une surface aveugle se déclare " +
          '(chemin, motif, remède, date), sinon le vert ne mesure rien.'
      );
    }
  }
  if (!cookiesLisibles) {
    errors.push(
      `surface aveugle : document.cookie est illisible dans ce navigateur (relevé pris ${phase}) — même refus, ` +
        'même raison.'
    );
  }

  for (const { ou, cle, forme } of trouvailles) {
    errors.push(
      `un justificatif est exposé au JavaScript de la page : ${ou} « ${cle} » (${forme}), relevé pris ` +
        `${phase}. Sur le web, la session doit rester un cookie httpOnly : tout script de la page (régie, ` +
        'extension, XSS) lit ce que cette sonde vient de lire.'
    );
  }

  for (const { methode, chemin } of requetes) {
    errors.push(
      `la page a envoyé un en-tête Authorization (${methode} ${chemin}) : le web ne porte aucun jeton en ` +
        'en-tête (getAuthToken y renvoie toujours vide ; le canal Bearer est réservé au shell natif).'
    );
  }

  return errors;
}

// ─── LE SHELL NATIF : LE MÊME JETON, JUGÉ À L'ENVERS ────────────────────────

/**
 * Marqueur du shell natif, posé AVANT tout script de la page. C'est le contrat
 * que lit `isNativeShell()` (`frontend/src/services/api.js`) :
 * `window.Capacitor.isNativePlatform()`. Le poser fait prendre au bundle servi —
 * exactement celui que la WebView Capacitor charge — le chemin NATIF : le jeton
 * est écrit à la connexion, et la purge réservée au web ne s'applique pas.
 *
 * Il est posé par la sonde et par personne d'autre : le bundle web ne doit pas
 * pouvoir se croire natif — ce serait précisément la fuite que la moitié web de
 * cette sonde refuse.
 *
 * @returns {string} Source JavaScript à exécuter au premier instant.
 */
export const sourceMarqueurNatif = () =>
  "window.Capacitor = { isNativePlatform: () => true, isNative: true, getPlatform: () => 'android' };";

/**
 * Le jeton du shell natif, lu DANS la page : est-il là, dans quel réservoir, et
 * avec quelle expiration. La VALEUR ne sort pas de cette fonction — la sonde ne
 * reçoit que des faits sur sa présence, jamais le jeton (une sonde de fuite qui
 * publierait un jeton serait elle-même la fuite).
 *
 * L'identité du jeton n'est PAS jugée : l'API peut le renouveler au passage
 * (`X-Kojo-Token`, `frontend/src/services/api.js`), donc « un autre jeton » est
 * un état légitime — seule la PRÉSENCE dit que la session a survécu.
 *
 * @returns {{presence: boolean, ou: string, expiration: number}}
 */
export const LECTURE_JETON_NATIF = () => {
  const lire = (nom) => {
    try {
      return String(window[nom]?.getItem('token') || '');
    } catch (_erreur) {
      // Réservoir illisible : ce n'est pas « pas de jeton » — l'appelant le voit
      // par la présence fausse ET par le refus de redémarrage qui suit.
      return '';
    }
  };
  const local = lire('localStorage');
  const session = lire('sessionStorage');
  let expiration = 0;
  try {
    expiration = Number(window.localStorage?.getItem('token_expires_at') || 0) || 0;
  } catch (_erreur) {
    expiration = 0;
  }
  return {
    presence: Boolean(local || session),
    ou: local ? 'localStorage' : (session ? 'sessionStorage' : ''),
    expiration,
  };
};

/**
 * Verdict de la moitié native : le jeton doit EXISTER, et la session doit s'être
 * retrouvée au redémarrage SANS aucun cookie — la WebView native n'en a pas de
 * fiable, donc une session qui ne tient qu'à un cookie est perdue au lancement
 * suivant.
 *
 * Fonction pure, comme `jugerExposition` : ce que les faits signifient se juge
 * sans navigateur, et chaque refus est éprouvable sur un cas écrit à la main.
 *
 * @param {object} faits
 * @param {boolean} [faits.jetonEcrit] Le jeton a-t-il été écrit à la connexion native ?
 * @param {number} [faits.cookiesAvantRedemarrage] Cookies portés par le contexte de redémarrage (0 attendu).
 * @param {number|null} [faits.statutAuthMe] Statut de `GET /auth/me` au redémarrage, `null` si aucun appel observé.
 * @param {boolean} [faits.enteteBearer] L'appel observé portait-il un en-tête Authorization ?
 * @param {object} [faits.jetonApres] Le jeton tel que `LECTURE_JETON_NATIF` le voit après le redémarrage.
 * @returns {string[]} Les refus, dans l'ordre où ils sont prononcés.
 */
export function jugerSessionNative({
  jetonEcrit = false,
  cookiesAvantRedemarrage = 0,
  statutAuthMe = null,
  enteteBearer = false,
  jetonApres = {},
} = {}) {
  const errors = [];
  const prefixe = 'shell natif';

  // SANS ÉCRITURE, IL N'Y A PAS DE SURFACE NATIVE. C'est le point le plus
  // dangereux de cette moitié : si `isNativeShell()` change de contrat (ou si le
  // marqueur n'est plus lu), la sonde jugerait le web en croyant juger le natif —
  // et un web qui n'écrit rien la ferait passer verte sur le chemin natif.
  if (!jetonEcrit) {
    errors.push(
      `${prefixe} : la connexion n'a écrit AUCUN jeton en stockage — la bascule isNativeShell n'a donc pas ` +
        "eu lieu, et le redémarrage jugé ne serait pas celui du shell natif (marqueur refusé, contrat de " +
        'isNativeShell changé, ou écriture native cassée).'
    );
    return errors;
  }

  if (cookiesAvantRedemarrage > 0) {
    errors.push(
      `${prefixe} : le redémarrage simulé porte ${cookiesAvantRedemarrage} cookie(s). Tant qu'un cookie peut ` +
        'porter la session, le redémarrage ne prouve pas que le JETON suffit — or c\'est la seule chose qui ' +
        'survit dans une WebView sans cookie fiable.'
    );
  }

  if (statutAuthMe === null) {
    errors.push(
      `${prefixe} : l'application n'a pas sondé \`GET ${AUTH_ME_PATH}\` au redémarrage (aucun appel observé). ` +
        "Rien ne prouve alors qu'elle a seulement tenté de retrouver la session : une surface aveugle se " +
        'déclare, elle ne conclut pas.'
    );
  } else if (!jetonApres.presence) {
    errors.push(
      `${prefixe} : le jeton n'a PAS survécu au redémarrage — plus rien en stockage alors qu'il y était à la ` +
        "connexion. La purge des jetons est réservée au web (purgeWebSessionTokens sort tôt sur isNativeShell) : " +
        'appliquée au natif, elle déconnecte l\'application à chaque lancement, sans cookie de secours.'
    );
  }

  if (statutAuthMe !== null && !enteteBearer) {
    errors.push(
      `${prefixe} : la session a répondu SANS en-tête Authorization — elle n'était donc pas portée par le ` +
        'jeton. Dans la WebView native, c\'est le seul canal : une session tenue par autre chose se perd ' +
        'dès que ce quelque chose manque.'
    );
  }

  if (statutAuthMe !== null && statutAuthMe !== 200) {
    errors.push(
      `${prefixe} : au redémarrage, GET ${AUTH_ME_PATH} → HTTP ${statutAuthMe} (200 attendu) : la session est ` +
        "PERDUE au lancement alors que le jeton était là. C'est la perte que cette moitié juge — dans " +
        "l'application installée, l'utilisateur se retrouve sur l'écran de connexion."
    );
  }

  return errors;
}

/**
 * Statut de l'endpoint protégé, vu DEPUIS la page (cookies inclus) : c'est le
 * seul moyen de savoir si une session est ouverte sans lire quoi que ce soit.
 *
 * @param {object} page Page Playwright (ou doublure de test).
 * @param {string} cible URL absolue de l'endpoint protégé.
 * @returns {Promise<number>} Statut HTTP, 0 si l'appel lui-même a échoué.
 */
const etatDeSession = (page, cible) =>
  page.evaluate(async (url) => {
    try {
      const response = await fetch(url, { credentials: 'include' });
      return response.status;
    } catch (_erreur) {
      return 0;
    }
  }, cible);

/**
 * L'hôte qui PORTE la session, lu dans le navigateur — jamais supposé.
 *
 * La production servie est CROSS-SITE (`VITE_USE_SAME_ORIGIN_API=false`) : la
 * page est sur un hôte, l'API sur un autre, et le cookie de session est rangé
 * chez l'API. Interroger `/api/auth/me` sur l'origine de la PAGE y répond 401 —
 * mesuré en production le 18/10/2026 : la sonde refusait sur une prémisse
 * fausse (« session non ouverte ») pendant que la session vivait, et la sonde
 * de session, elle, était verte une minute plus tôt sur le même compte. Le
 * proxy même-origine range au contraire le cookie sur l'origine de la page.
 *
 * `context.cookies()` SANS URL rend ce que Chromium garde, domaine compris :
 * c'est la seule lecture qui distingue les deux topologies. La valeur du cookie
 * ne quitte jamais cette fonction — seule l'origine est rendue.
 *
 * @param {object} context Contexte Playwright (ou sa doublure).
 * @param {string} base Origine servie, pour rapprocher une origine complète.
 * @returns {Promise<string>} Origine de l'API portant la session, ou chaîne vide
 *   si le contexte n'en porte aucune (contexte vierge, doublure sans cookie).
 */
export async function origineDeLaSession(context, base) {
  if (typeof context?.cookies !== 'function') return '';
  const cookies = (await context.cookies()).filter(
    (cookie) => cookie?.name === SESSION_COOKIE_NAME
  );
  if (cookies.length !== 1) return '';
  return origineDuCookie(cookies[0], [base]);
}

/**
 * Lance Chromium. Import PARESSEUX : le test companion injecte son propre
 * `launch` et n'a donc jamais à charger Playwright (ni un navigateur) sous jsdom.
 *
 * @returns {Promise<import('@playwright/test').Browser>} Navigateur lancé.
 */
const lancerNavigateur = async () => {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ headless: true });
};

/**
 * UNE tentative : ouverture de la page servie, connexion, rechargement, relevé.
 *
 * @param {object} contexte
 * @param {string} contexte.base
 * @param {string} contexte.email
 * @param {string} contexte.password
 * @param {Function} contexte.launch
 * @param {string} [contexte.bypassToken]
 * @param {number} contexte.loginTimeoutMs
 * @param {number} contexte.restoreTimeoutMs
 * @returns {Promise<{ok: boolean, errors: string[], checked: string[], verdicts: object}>}
 */
async function uneTentative({
  base,
  email,
  password,
  launch,
  bypassToken = '',
  loginTimeoutMs,
  restoreTimeoutMs,
}) {
  const errors = [];
  const checked = [];
  const verdicts = { anonymous: null, afterLogin: null, appObserved: false, seen: 0, requests: 0, findings: 0, preBootFindings: 0, native: null };
  let natif = null;
  // L'URL jugée n'est pas figée sur l'origine de la page : elle est RE-LUE après
  // la connexion, à l'hôte qui porte réellement le cookie de session (voir
  // `origineDeLaSession`). Avant connexion, le contexte est vierge : c'est
  // l'origine de la page qui doit répondre 401.
  let authMeUrl = `${base}${AUTH_ME_PATH}`;

  const browser = await launch();
  try {
    const context = await browser.newContext(contextOptions({ bypassToken }));
    const page = await context.newPage();

    // Le relevé du PREMIER instant est armé AVANT la première navigation : posé
    // après, il manquerait l'état dans lequel la page est arrivée — et c'est
    // exactement l'état qu'un script tiers lit en premier.
    await page.addInitScript(sourceReleveAvantBoot());

    // Journal des requêtes PORTANT un en-tête Authorization : on ne garde que la
    // MÉTHODE et le CHEMIN. Ni la valeur (un jeton journalisé est un jeton
    // publié), ni la query string (elle peut en porter un).
    const requetes = [];
    let vues = 0;
    page.on('request', (requete) => {
      // TOUTES les requêtes sont comptées, pas seulement les fautives : le
      // compteur total est le PLANCHER de lecture de cette écoute. Sans lui, un
      // « aucune requête avec Authorization » indistinguable d'un écouteur
      // débranché passerait pour une preuve.
      vues += 1;
      const entete = requete.headers()?.authorization;
      if (!entete) return;
      let chemin = requete.url();
      try {
        chemin = new URL(requete.url()).pathname;
      } catch (_erreur) {
        chemin = '(URL illisible)';
      }
      requetes.push({ methode: String(requete.method() || 'GET'), chemin });
    });

    // ── 0. LA PAGE EST-IL PARTI VIERGE ? ───────────────────────────────────
    // Une sonde d'exposition qui hériterait d'une session laissée par un run
    // précédent mesurerait l'exposition d'une autre exécution.
    await page.goto(`${base}${LOGIN_PATH}`, { waitUntil: 'domcontentloaded' });
    verdicts.anonymous = await etatDeSession(page, authMeUrl);
    if (verdicts.anonymous !== 401) {
      errors.push(
        premisse(
          `contexte de sonde non vierge : GET ${AUTH_ME_PATH} répond HTTP ${verdicts.anonymous} AVANT toute ` +
            'connexion (401 attendu). Tant que ce contexte porte une session, le relevé ne décrit pas ce ' +
            'que cette sonde a établi.'
        )
      );
      return { ok: false, errors, checked, verdicts };
    }
    checked.push(`départ : GET ${AUTH_ME_PATH} → 401 (aucune session) — la sonde part vierge`);

    // ── 1. CONNEXION PAR LE FORMULAIRE SERVI ───────────────────────────────
    // Sans session ouverte, il n'y a aucun jeton à exposer : ce n'est pas une
    // politesse, c'est la condition pour que le vert veuille dire quelque chose.
    await page.fill(EMAIL_SELECTOR, email);
    await page.fill(PASSWORD_SELECTOR, password);
    await page.click(SUBMIT_SELECTOR);
    try {
      await page.waitForURL((current) => !current.pathname.startsWith(LOGIN_PATH), {
        timeout: loginTimeoutMs,
      });
    } catch (_erreur) {
      errors.push(
        premisse(
          `connexion du compte CI impossible : la page est restée sur ${LOGIN_PATH}. Vérifier ` +
            'LHCI_CI_EMAIL / LHCI_CI_PASSWORD (repli LHCI_TEST_*) — sans session ouverte, une sonde ' +
            "d'exposition ne mesure rien."
        )
      );
      return { ok: false, errors, checked, verdicts };
    }

    // La topologie se LIT, elle ne se suppose pas : le cookie dit où vit la
    // session, donc où `/auth/me` dit la vérité. Sans cette lecture, une
    // production cross-site était jugée sur l'origine de la page (401) et la
    // sonde refusait sur une prémisse fausse.
    const porteur = await origineDeLaSession(context, base);
    if (porteur) {
      const pageAuthMeUrl = authMeUrl;
      authMeUrl = `${porteur}${AUTH_ME_PATH}`;
      if (authMeUrl !== pageAuthMeUrl) {
        checked.push(
          `topologie lue : le cookie ${SESSION_COOKIE_NAME} est rangé sur ${porteur} — ` +
            "`/auth/me` est jugé là, pas sur l'origine de la page"
        );
      }
    }

    verdicts.afterLogin = await etatDeSession(page, authMeUrl);
    if (verdicts.afterLogin !== 200) {
      errors.push(
        premisse(
          `session non ouverte après la connexion : GET ${AUTH_ME_PATH} → HTTP ${verdicts.afterLogin} ` +
            '(200 attendu). Rien ne peut être jugé sur une session absente.'
        )
      );
      return { ok: false, errors, checked, verdicts };
    }
    checked.push(`après connexion : GET ${AUTH_ME_PATH} → 200 (session ouverte, il y a un jeton à exposer)`);

    // ── 2. RECHARGEMENT ────────────────────────────────────────────────────
    // Un INSTANT de mesure, pas un fait jugé : ce qui est jugé ensuite, c'est ce
    // que la page PORTE. Une application qui ne restaure pas la session (aucun
    // appel d'amorçage, 401, retour à /login) ne rougit donc PAS ici — ce refus
    // appartient à la sonde de session au rechargement, avec sa correction
    // (cookie ou garde d'amorçage). Le cas « un rechargement non restauré ne
    // rougit PAS ici » verrouille cette répartition.
    // L'écoute de la réponse est ARMÉE AVANT le rechargement (un écouteur posé
    // après peut manquer une réponse déjà arrivée). Bornée, jamais une pause.
    const appelDeLApplication = page
      .waitForResponse((response) => response.url().startsWith(authMeUrl), {
        timeout: restoreTimeoutMs,
      })
      .catch(() => null);

    await page.reload({ waitUntil: 'domcontentloaded' });
    verdicts.appObserved = Boolean(await appelDeLApplication);
    checked.push(
      verdicts.appObserved
        ? "rechargement : l'application a rappelé /auth/me (relevé pris après son amorçage)"
        : "rechargement : l'application n'a pas rappelé /auth/me dans la borne ; relevé pris quand même " +
            "(le fait jugé est ce que la page PORTE, pas ce qu'elle appelle)"
    );

    // ── 3. RELEVÉ DANS LA PAGE, PUIS VERDICT ───────────────────────────────
    // Deux relevés, du plus tôt au plus tard : l'état du domaine au premier
    // instant du document (ce qu'un script tiers lisait avant que l'application
    // ne s'amorce, et ce qu'une version précédente y avait laissé), puis l'état
    // après amorçage.
    const releveAvantBoot = await page.evaluate(
      (cle) => window[cle] ?? null,
      CLE_RELEVE_AVANT_BOOT
    );
    const releve = await page.evaluate(LECTURE_DU_DOMAINE);
    verdicts.seen = vues;
    verdicts.requests = requetes.length;
    verdicts.findings = (releve?.trouvailles || []).length;
    verdicts.preBootFindings = (releveAvantBoot?.trouvailles || []).length;
    if (releveAvantBoot) {
      checked.push(
        `${AVANT_AMORCAGE} : relevé pris au premier instant du document, avant tout script de ` +
          `l'application (${verdicts.preBootFindings} justificatif(s))`
      );
      errors.push(...jugerExposition(releveAvantBoot, { quand: AVANT_AMORCAGE }));
    } else {
      // Ni un silence ni une déduction : sans ce relevé, la moitié du fait jugé
      // n'existe pas — la sonde refuse au lieu de publier un vert sur un instant
      // qu'elle n'a pas mesuré.
      errors.push(
        "surface aveugle : le relevé du PREMIER instant du document n'a pas été déposé — l'état du " +
          'domaine AVANT que l\'application ne s\'amorce n\'a donc pas été mesuré, et un jeton hérité ' +
          'qu\'elle purge au démarrage passerait inaperçu.'
      );
    }
    for (const reservoir of Object.keys(releve?.lisibles || {})) {
      if (releve.lisibles[reservoir]) {
        checked.push(
          `${reservoir} : lisible, aucune clé de justificatif ni valeur en forme de JWT`
        );
      }
    }
    if (releve?.cookiesLisibles) {
      checked.push('document.cookie : lisible, aucun cookie en forme de JWT (le cookie de session reste httpOnly)');
    }
    checked.push(
      `requêtes observées : ${vues} (${requetes.length} portant un en-tête Authorization)`
    );

    errors.push(...jugerExposition(releve || {}, { requetes, vues }));

    // ── 4. LE SHELL NATIF : le même bundle, jugé à l'envers ────────────────
    // Le web ne doit RIEN garder ; le natif ne doit RIEN perdre. Les deux
    // moitiés sont jugées dans le même passage, chacune dans ses contextes : le
    // refus de l'une n'empêche pas l'autre d'être prononcé (une fois les
    // prémisses communes établies : contexte vierge, connexion qui aboutit).
    natif = {
      // `jetonEcrit` est le fait qui ETABLIT la surface native : sans lui, la
      // sonde jugerait le web en croyant juger le natif.
      jetonEcrit: false,
      statutAuthMe: null,
      bearer: false,
      jetonApres: {},
      cookies: 0,
    };
    verdicts.native = natif;

    const contexteNatif = await browser.newContext(contextOptions({ bypassToken }));
    try {
      const pageNatif = await contexteNatif.newPage();
      await pageNatif.addInitScript(sourceMarqueurNatif());
      await pageNatif.goto(`${base}${LOGIN_PATH}`, { waitUntil: 'domcontentloaded' });
      await pageNatif.fill(EMAIL_SELECTOR, email);
      await pageNatif.fill(PASSWORD_SELECTOR, password);
      await pageNatif.click(SUBMIT_SELECTOR);
      let connexionNative = true;
      try {
        await pageNatif.waitForURL((current) => !current.pathname.startsWith(LOGIN_PATH), {
          timeout: loginTimeoutMs,
        });
      } catch (_erreur) {
        connexionNative = false;
      }

      if (!connexionNative) {
        errors.push(
          "shell natif : connexion impossible par le formulaire servi — sans session native établie, il n'y a " +
            'aucun jeton à faire survivre. Mêmes secrets que la moitié web : LHCI_CI_EMAIL / LHCI_CI_PASSWORD.'
        );
      } else {
        const ecrit = await pageNatif.evaluate(LECTURE_JETON_NATIF);
        natif.jetonEcrit = Boolean(ecrit?.presence);
      }

      if (connexionNative && !natif.jetonEcrit) {
        errors.push(...jugerSessionNative({ jetonEcrit: false }));
      }

      if (connexionNative && natif.jetonEcrit) {
        checked.push(
          'shell natif · connexion : le jeton est écrit en stockage (la bascule isNativeShell a bien eu lieu)'
        );

        // LE REDÉMARRAGE : contexte NEUF, même stockage, AUCUN cookie. C'est la
        // seule façon de juger « le jeton suffit » — si un cookie portait la
        // session, le redémarrage ne prouverait rien de ce que la WebView native
        // est seule à savoir faire (survivre sans cookie fiable).
        const etat = await contexteNatif.storageState();
        const origines = (etat?.origins || []).filter((origine) => (origine.localStorage || []).length > 0);
        const redemarrage = await browser.newContext({
          ...contextOptions({ bypassToken }),
          storageState: { cookies: [], origins: origines },
        });
        try {
          const pageRedemarre = await redemarrage.newPage();
          await pageRedemarre.addInitScript(sourceMarqueurNatif());

          let bearer = false;
          pageRedemarre.on('request', (requete) => {
            let chemin = '';
            try {
              chemin = new URL(requete.url()).pathname;
            } catch (_erreur) {
              chemin = '';
            }
            if (chemin.endsWith(AUTH_ME_PATH) && requete.headers()?.authorization) bearer = true;
          });

          // Les cookies sont comptés AVANT la navigation : ceux qu'une réponse
          // poserait pendant la restauration ne disent rien de la prémisse.
          natif.cookies = (await redemarrage.cookies()).length;

          const appelDeLApplication = pageRedemarre
            .waitForResponse(
              (reponse) =>
                String(reponse.url()).includes(AUTH_ME_PATH) && reponse.request().method() === 'GET',
              { timeout: restoreTimeoutMs }
            )
            .catch(() => null);

          await pageRedemarre.goto(base, { waitUntil: 'domcontentloaded' });
          const vue = await appelDeLApplication;
          natif.statutAuthMe = vue ? vue.status() : null;
          natif.bearer = bearer;
          // Le relevé suit la réponse : le jeton est écrit à la connexion et
          // purgé (s'il l'est) au montage, donc avant la question de session.
          natif.jetonApres = (await pageRedemarre.evaluate(LECTURE_JETON_NATIF)) || {};

          checked.push(
            `shell natif · redémarrage : ${natif.cookies} cookie(s), ` +
              `${
                natif.statutAuthMe === null
                  ? `aucun appel à ${AUTH_ME_PATH} observé`
                  : `GET ${AUTH_ME_PATH} → ${natif.statutAuthMe}`
              }, en-tête Authorization ${natif.bearer ? 'présent' : 'absent'}`
          );
          checked.push(
            `shell natif · jeton après le redémarrage : ${natif.jetonApres.presence ? 'présent' : 'ABSENT'}` +
              (natif.jetonApres.presence ? ` (${natif.jetonApres.ou})` : '')
          );

          errors.push(
            ...jugerSessionNative({
              jetonEcrit: true,
              cookiesAvantRedemarrage: natif.cookies,
              statutAuthMe: natif.statutAuthMe,
              enteteBearer: natif.bearer,
              jetonApres: natif.jetonApres,
            })
          );
        } finally {
          await redemarrage.close().catch(() => {});
        }
      }
    } finally {
      await contexteNatif.close().catch(() => {});
    }

    return { ok: errors.length === 0, errors, checked, verdicts };
  } finally {
    // Le contexte est jeté à chaque tentative : la machine hôte ne garde aucun
    // état de session, et la tentative suivante repart vierge.
    await browser.close().catch(() => {});
  }
}

/**
 * Sonde complète, avec réessais : un démarrage à froid de l'hébergeur ou une
 * bascule en cours répond mal pendant quelques secondes. Trois tentatives
 * espacées absorbent cette fenêtre — elles ne transforment pas une exposition en
 * vert : un fait qui persiste échoue aux trois.
 *
 * @param {object} [options]
 * @param {string} [options.base]    Origine servie (SITE_ORIGIN par défaut).
 * @param {string} [options.email]   Compte CI (LHCI_CI_EMAIL, repli LHCI_TEST_EMAIL).
 * @param {string} [options.password] Mot de passe du compte CI.
 * @param {string} [options.bypassToken] Jeton de contournement Vercel (env BYPASS_ENV).
 * @param {Function} [options.launch] Fabrique de navigateur (tests).
 * @param {Function} [options.sleep]  Attente entre deux tentatives (tests).
 * @param {number} [options.attempts] Nombre de tentatives.
 * @param {number} [options.delayMs]  Délai entre deux tentatives.
 * @param {Function} [options.log]    Journal (tests).
 * @param {boolean} [options.quiet]   Tait la progression.
 * @returns {Promise<{ok: boolean, errors: string[], checked: string[], attempts: number,
 *   verdicts: object|null}>}
 */
export async function runTokenExposureProbe({
  base = SITE_ORIGIN,
  email = process.env.LHCI_CI_EMAIL || process.env.LHCI_TEST_EMAIL || '',
  password = process.env.LHCI_CI_PASSWORD || process.env.LHCI_TEST_PASSWORD || '',
  bypassToken = process.env[BYPASS_ENV] || '',
  launch = lancerNavigateur,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = ATTEMPTS,
  delayMs = RETRY_DELAY_MS,
  loginTimeoutMs = LOGIN_TIMEOUT_MS,
  restoreTimeoutMs = RESTORE_TIMEOUT_MS,
  log = console.log,
  quiet = false,
} = {}) {
  const cleanBase = String(base ?? '').trim().replace(/\/+$/, '');

  // Sans compte CI, aucune session ne s'ouvre : le dire AVANT de lancer un
  // navigateur, et en NOMMANT les secrets — un run rouge doit dire quelle
  // variable poser, pas seulement qu'il a échoué.
  if (!email || !password) {
    // Le libellé est posé ICI AUSSI : ce refus ne passe pas par la boucle, donc
    // pas par le préfixe des tentatives — sans lui, il serait le seul message de
    // la sonde à ne pas nommer sa famille, et il est justement celui que les deux
    // sondes prononcent avec les mêmes mots (le compte CI manque).
    const fait =
      'compte CI absent : LHCI_CI_EMAIL / LHCI_CI_PASSWORD (repli LHCI_TEST_*) ne sont pas définis — ' +
      "sans session ouverte, il n'y a aucun jeton à exposer, donc rien à mesurer.";
    return {
      ok: false,
      errors: [`${libelleSonde(cleanBase)} : ${premisse(fait)}`],
      checked: [],
      attempts: 0,
      verdicts: null,
    };
  }

  let last = { ok: false, errors: [], checked: [], verdicts: null };
  let used = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    used = attempt;
    try {
      last = await uneTentative({
        base: cleanBase,
        email,
        password,
        launch,
        bypassToken,
        loginTimeoutMs,
        restoreTimeoutMs,
      });
    } catch (error) {
      last = { ok: false, errors: [`sonde interrompue (${error.message}).`], checked: [], verdicts: null };
    }
    if (last.ok) break;
    if (attempt < attempts) {
      if (!quiet) {
        log(`  … tentative ${attempt}/${attempts} sans verdict, nouvel essai dans ${Math.round(delayMs / 1000)} s`);
      }
      await sleep(delayMs);
    }
  }

  const label = libelleSonde(cleanBase);
  if (!last.ok) last.errors = last.errors.map((error) => `${label} : ${error}`);

  return { ...last, attempts: used };
}

/**
 * Options de ligne de commande. Une valeur absente laisse le défaut : la sonde
 * ne « choisit » pas une surface, elle accepte qu'on lui en donne une autre.
 *
 * @param {string[]} argv Arguments après `node script`.
 * @returns {{base?: string, attempts?: number, delayMs?: number}}
 */
export function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--base' && next) options.base = next;
    else if (flag === '--tentatives' && next) options.attempts = Number(next);
    else if (flag === '--delai' && next) options.delayMs = Number(next) * 1000;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runTokenExposureProbe(parseArgs(process.argv.slice(2)));
  console.log(
    `Sonde d'exposition du jeton — ${result.ok ? 'aucun jeton exposé' : 'DÉFAUT'} ` +
      `(${result.attempts} tentative(s))`
  );
  for (const ligne of result.checked) console.log(`  ✓ ${ligne}`);
  // Aucun ::notice : cette sonde ne sait pas mesurer à moitié. Sans session
  // ouverte ou avec un stockage illisible, elle ROUGIT au lieu de publier une
  // note — un vert qui n'a rien pu lire est le silence qu'un corpus vide a coûté.
  for (const error of result.errors) console.error(`::error title=Exposition jeton production::${error}`);
  if (!result.ok) process.exit(1);
}
