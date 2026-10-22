#!/usr/bin/env node
/**
 * Le flux SSE TRAVERSE-T-IL le proxy réellement servi, sans être tamponné ?
 *
 * ─── Le trou que cette sonde ferme ─────────────────────────────────────────
 * Le temps réel du produit est porté par DEUX flux (AGENTS.md, « Temps réel ») :
 * `GET /api/notifications/stream` et `GET /api/messages/stream`. Côté serveur,
 * tout est mesuré : `test_live_stream.py`, `test_live_bus_deux_workers.py` (deux
 * `uvicorn` réels, un Redis réel) et le banc `scripts/charge/mesure_push.py`
 * exigent le même identifiant des deux côtés du bus. Côté CLIENT, le repli est
 * gardé par `liveStream.test.js`.
 *
 * Entre les deux, il y a un intermédiaire que rien ne juge : le proxy. En
 * production, la page est servie par Vercel et `/api/:path*` est réécrit vers
 * Fly (`frontend/vercel.json`) — et un proxy qui TAMPONNE la réponse ne casse
 * aucun test du dépôt : le 200 arrive, les octets arrivent, seulement ils
 * arrivent tous à la fin. Le client de production, lui, juge un flux MUET après
 * `SILENCE_TIMEOUT_MS` sans un octet (`liveStream.js`, 45 s : deux battements
 * du serveur plus une marge) : il basculerait alors sur le repli à 60 s, et le
 * produit aurait perdu le temps réel sans qu'un seul rouge ne soit tombé.
 *
 * ─── Ce qu'elle mesure, et à quel endroit ──────────────────────────────────
 * Elle fait ce qu'un client fait : `POST /api/auth/login` pour obtenir un jeton
 * (le flux accepte `Authorization: Bearer`, donc AUCUN cookie n'est nécessaire),
 * puis `GET {base}/api/notifications/stream` en lisant le corps EN FLUX, octet
 * par octet, à travers l'ORIGINE JUGÉE (`--base`, par défaut le site servi) —
 * c'est-à-dire à travers le proxy Vercel, jamais contre Fly directement.
 *
 * Le serveur émet un premier événement `ready` DÈS l'ouverture puis un
 * commentaire `: keepalive` toutes les `KOJO_SSE_HEARTBEAT_SECONDS` (20 s par
 * défaut, `kojo_live.py`). Deux faits sont donc lisibles dans le temps
 * d'ARRIVÉE des octets :
 *
 *   (A) LE PREMIER ÉVÉNEMENT ARRIVE À TEMPS. `ready` est écrit avant toute
 *       I/O d'attente côté serveur : son arrivée tardive ne peut venir que de
 *       l'intermédiaire (proxy, CDN, compression). Le budget n'est pas un
 *       littéral choisi à la main : il est DÉRIVÉ du contrôle mesuré dans le
 *       même passage — l'aller-retour de `/api/auth/login` par le MÊME proxy
 *       (`budgetDuPremierEvenement`) — et reste sous la fenêtre de silence du
 *       client (`SILENCE_TIMEOUT_MS`), sinon la sonde serait plus tolérante que
 *       le produit.
 *
 *   (B) LE FLUX N'EST PAS TAMPONNÉ. Si le proxy retient la réponse, `ready` et
 *       le premier `: keepalive` sont livrés dans le MÊME vidage : l'écart entre
 *       leurs arrivées s'effondre, alors que le serveur les a écrits à
 *       `battement` d'intervalle. Un écart trop court ne prouve donc pas la
 *       fluidité — il prouve le tampon. Un flux qui n'émet AUCUN battement dans
 *       la fenêtre d'attente est un flux retenu ou mort, jamais un vert.
 *
 *   (C) LE CONTRAT DE LA RÉPONSE. 200, `text/event-stream`, pas de
 *       `content-encoding` : un intermédiaire qui recompresse le flux pour le
 *       lire est exactement le tampon que (B) cherche à voir.
 *
 * ─── Ce qu'elle ne juge PAS (et pourquoi c'est écrit) ──────────────────────
 * Ce que le CLIENT fait de ces octets (réassemblage des trames, repli à 60 s,
 * chien de garde à `SILENCE_TIMEOUT_MS`) est `frontend/src/services/liveStream.js`
 * et ses tests :
 * la sonde mesure la TRAVERSÉE, pas la lecture. La reconnexion, le plafond du
 * compte (503 + `Retry-After`) et le fan-out entre workers sont prouvés côté
 * backend. Et si la session manque, la sonde ne juge rien : elle refuse de
 * conclure (`prémisse (aucun verdict rendu ici)`) — un flux qui répond 401 ne
 * dit rien du tampon d'un proxy.
 *
 * Aucune valeur de jeton n'est publiée : ni dans les journaux, ni dans les
 * annotations, ni dans `--json`.
 *
 * ─── Préproduction, où Vercel est fermée par défaut ─────────────────────────
 * Une preview Vercel du projet est DERRIÈRE l'authentification Vercel : sans
 * jeton de contournement, sa réponse est la page de connexion Vercel, pas un
 * flux. Le secret « Protection Bypass for Automation » (Vercel → Settings →
 * Deployment Protection) se lit dans `VERCEL_AUTOMATION_BYPASS_SECRET` et part
 * sur CHAQUE requête ; il vient de l'environnement, JAMAIS d'une entrée de
 * workflow (une entrée de dispatch est publiée dans les journaux du run).
 *
 * Usage :
 *   cd frontend && node scripts/check-sse-proxy-production.js
 * Options :
 *   --base https://<preview>.vercel.app  origine TRAVERSÉE (défaut : SITE_ORIGIN)
 *   --chemin /api/notifications/stream   flux jugé (défaut)
 *   --direct https://api.kojoforafrica.cc.cd   même flux SANS proxy (comparaison)
 *   --battement 20000                    intervalle du serveur (KOJO_SSE_HEARTBEAT_SECONDS)
 *   --attente 65000                      plafond d'attente (battement + fenêtre client)
 *   --budget 4000                        force le budget (défaut : DÉRIVÉ du contrôle)
 *   --tentatives 2                       une mesure ratée seule ne conclut pas
 * Codes de sortie : 0 vert, 1 rouge, 2 prémisse (aucun verdict rendu).
 */
import { pathToFileURL } from 'node:url';
import { SITE_ORIGIN } from './site-meta.js';
import {
  BATTEMENT_SERVEUR_MS,
  SILENCE_TIMEOUT_MS,
} from '../src/config/flux-temps-reel.js';

/** La famille de refus, écrite DANS les messages : le journal de CI se relit seul. */
export const FAMILLE = 'traversée du flux SSE';

/** Le seul titre d'annotation d'erreur que cette sonde publie. */
export const TITRE_ERREUR = 'Flux SSE production';

export const BYPASS_ENV = 'VERCEL_AUTOMATION_BYPASS_SECRET';
export const BYPASS_HEADER = 'x-vercel-protection-bypass';

/** Le flux jugé par défaut : `ready` y porte le compteur non lus, sans état préalable. */
export const CHEMIN_DEFAUT = '/api/notifications/stream';

/**
 * La valeur de `kojo_live.HEARTBEAT_SECONDS` en production (aucune surcharge
 * dans fly.toml). LUE du propriétaire partagé, jamais recopiée : la sonde et le
 * client ne peuvent pas se mettre à jour l'un sans l'autre.
 */
export const BATTEMENT_DEFAUT_MS = BATTEMENT_SERVEUR_MS;

/**
 * La fenêtre de silence du CLIENT (`liveStream.js`, `silenceTimeoutMs`), LUE du
 * propriétaire partagé (`src/config/flux-temps-reel.js`). Le budget du premier
 * événement reste SOUS cette valeur : une sonde plus tolérante que le produit
 * laisserait passer un flux que l'utilisateur, lui, aurait déjà vu tomber.
 */
export const FENETRE_CLIENT_MS = SILENCE_TIMEOUT_MS;

/** Plancher et plafond du budget DÉRIVÉ (voir `budgetDuPremierEvenement`). */
export const PLANCHER_BUDGET_MS = 1500;
export const PLAFOND_BUDGET_MS = 8000;
export const FACTEUR_CONTROLE = 6;

/** Marque de prémisse : la sonde n'a rien pu juger. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/** Le libellé qui préfixe CHAQUE refus et nomme la surface jugée. */
export const libelleSonde = (base) => `[${FAMILLE}] flux SSE à travers ${base}`;

/* ────────────────────────────── analyse du flux ─────────────────────────── */

/**
 * Lit une consigne de chunks horodatés et en tire les TRAMES SSE observées.
 *
 * La consigne est la seule entrée : `[{ aMs, texte }]` — `aMs` est l'instant
 * d'ARRIVÉE du chunk, pas son instant d'écriture côté serveur, et c'est tout
 * l'objet de la mesure. Une trame peut être coupée entre deux chunks (le cas
 * réel : un proxy a le droit de découper où il veut, un analyseur qui l'oublie
 * lit des trames fantômes), donc le tampon est conservé d'un chunk à l'autre.
 *
 * Les lignes de COMMENTAIRE (`: keepalive`) ne sont pas des événements : elles
 * sont relevées à part, car c'est leur INSTANT qui prouve que le flux n'a pas
 * été retenu.
 *
 * L'instant retenu est celui où la trame est COMPLÈTE, pas celui de son premier
 * octet : le client n'émet un événement qu'une fois le bloc entier lu, donc un
 * proxy qui livre le début d'une trame puis retient le reste serait « à l'heure »
 * mesuré à l'autre façon. C'est ce que l'utilisateur subit qui est daté.
 *
 * @param {{consigne: Array<{aMs: number, texte: string}>}} entree
 * @returns {{evenements: Array<{type: string, data: string, aMs: number}>,
 *            battements: Array<{aMs: number}>, trames: number}}
 */
export function analyserFlux({ consigne }) {
  const evenements = [];
  const battements = [];
  let tampon = '';
  let trames = 0;

  /**
   * La fin d'une trame : une ligne VIDE, donc `\n\n` — ou `\r\n\r\n` quand un
   * intermédiaire a réécrit les fins de ligne en CRLF (le serveur, lui, écrit
   * `\n`). Les deux sont cherchées, et la PLUS TÔT gagne : ne connaître que
   * `\n\n` rendait un flux CRLF entièrement invisible, donc vert.
   */
  const finDeTrame = (texte) => {
    const lf = texte.indexOf('\n\n');
    const crlf = texte.indexOf('\r\n\r\n');
    if (crlf === -1) return lf === -1 ? null : { debut: lf, longueur: 2 };
    if (lf === -1 || crlf < lf) return { debut: crlf, longueur: 4 };
    return { debut: lf, longueur: 2 };
  };

  const vider = (aMs) => {
    let fin = finDeTrame(tampon);
    while (fin) {
      const bloc = tampon.slice(0, fin.debut);
      tampon = tampon.slice(fin.debut + fin.longueur);
      trames += 1;
      const lignes = bloc.split('\n');
      let type = 'message';
      const donnees = [];
      let commentaire = false;
      let vide = true;
      for (const brute of lignes) {
        const ligne = brute.replace(/\r$/, '');
        if (ligne === '') continue;
        vide = false;
        if (ligne.startsWith(':')) {
          commentaire = true;
          continue;
        }
        const separateur = ligne.indexOf(':');
        const champ = separateur === -1 ? ligne : ligne.slice(0, separateur);
        const valeur = separateur === -1 ? '' : ligne.slice(separateur + 1).replace(/^ /, '');
        if (champ === 'event') type = valeur;
        else if (champ === 'data') donnees.push(valeur);
      }
      if (vide) {
        // Un bloc vide (`\n\n\n\n`) n'apprend rien : il ne compte pas comme trame.
      } else if (commentaire && donnees.length === 0) {
        battements.push({ aMs });
      } else {
        evenements.push({ type, data: donnees.join('\n'), aMs });
      }
      fin = finDeTrame(tampon);
    }
  };

  for (const { aMs, texte } of consigne || []) {
    tampon += String(texte ?? '');
    vider(Number(aMs) || 0);
  }
  // Un tampon NON terminé n'est pas une trame : le publier compterait un
  // événement que le client n'a jamais reçu.
  return { evenements, battements, trames };
}

/* ─────────────────────────────── les verdicts ───────────────────────────── */

/**
 * Le budget du premier événement, DÉRIVÉ du contrôle mesuré.
 *
 * Le contrôle est l'aller-retour d'une requête ordinaire par le MÊME proxy
 * (login) : il porte la distance, la région, le TLS et la froideur éventuelle de
 * la machine. Un premier événement doit suivre ce prix de près — `facteur`
 * laisse la place à l'ouverture d'un flux (deux en-têtes de plus), pas à un
 * tampon de plusieurs secondes.
 *
 * Le plancher existe parce qu'un contrôle très rapide (proxy chaud, même
 * région) rendrait le budget plus court que la variance du réseau ; le plafond
 * existe parce qu'un budget au-delà de `FENETRE_CLIENT_MS` (15 s) ne jugerait
 * plus ce que l'utilisateur vit. Un contrôle ABSENT n'invente pas un budget :
 * c'est le plafond qui décide, et le rapport le dit.
 *
 * @param {{controleMs?: number|null, facteur?: number, plancherMs?: number, plafondMs?: number}} entree
 */
export function budgetDuPremierEvenement({
  controleMs = null,
  facteur = FACTEUR_CONTROLE,
  plancherMs = PLANCHER_BUDGET_MS,
  plafondMs = PLAFOND_BUDGET_MS,
} = {}) {
  const plafond = Math.min(plafondMs, FENETRE_CLIENT_MS - 1000);
  if (!Number.isFinite(controleMs) || controleMs <= 0) {
    return { budgetMs: plafond, derive: false, controleMs: null };
  }
  const budgetMs = Math.round(Math.min(plafond, Math.max(plancherMs, controleMs * facteur)));
  return { budgetMs, derive: true, controleMs };
}

/**
 * Juge ce que la traversée a produit. Fonction PURE : toute la règle est ici,
 * l'I/O vit dans `ouvrirFlux`, et c'est ce découpage qui rend la sonde
 * éprouvable sans réseau (et la mutation d'une ligne de refus jouable).
 *
 * @param {{analyse: ReturnType<typeof analyserFlux>,
 *          budgetMs: number, battementMs: number,
 *          statut?: number|null, entetes?: Record<string,string>,
 *          dureeMs?: number, termine?: boolean}} entree
 * @returns {{verdicts: Array<{id: string, ok: boolean, detail: string}>, refuse: string[]}}
 */
export function jugeDuTransfert({
  analyse,
  budgetMs,
  battementMs = BATTEMENT_DEFAUT_MS,
  statut = null,
  entetes = {},
  dureeMs = 0,
  termine = false,
}) {
  const verdicts = [];
  const refuser = (id, detail) => {
    verdicts.push({ id, ok: false, detail });
    return detail;
  };

  const entete = (nom) => {
    const trouve = Object.entries(entetes || {}).find(
      ([cle]) => cle.toLowerCase() === nom.toLowerCase()
    );
    return trouve ? String(trouve[1]) : '';
  };

  if (statut !== null && statut !== 200) {
    refuser('statut', `la réponse n'est pas un flux : HTTP ${statut}`);
  } else {
    const type = entete('content-type');
    if (!/text\/event-stream/i.test(type)) {
      refuser('type', `content-type « ${type || '(absent)'} » : ce n'est pas un flux SSE`);
    }
    const encodage = entete('content-encoding');
    if (encodage && !/^identity$/i.test(encodage)) {
      refuser(
        'compression',
        `content-encoding « ${encodage} » : un intermédiaire qui recompresse le flux ` +
          `le lit en entier avant de le rendre — c'est le tampon`
      );
    }
  }

  const premier = (analyse.evenements || [])[0];
  const tardif = !premier || premier.aMs > budgetMs;
  if (tardif) {
    refuser(
      'premier-evenement',
      premier
        ? `le premier événement (${premier.type}) est arrivé à ${premier.aMs} ms, ` +
            `au-delà du budget de ${budgetMs} ms : l'intermédiaire retient le flux`
        : `aucun événement reçu en ${dureeMs} ms (budget ${budgetMs} ms) : ` +
            `le flux n'a rien rendu${termine ? ' et s’est fermé' : ''}`
    );
  }

  const battement = (analyse.battements || [])[0];
  if (!premier) {
    // Sans premier événement, l'écart ne dit rien de plus : un seul refus suffit.
  } else if (!battement) {
    refuser(
      'battement',
      `aucun battement de cœur reçu en ${dureeMs} ms : un flux vivant en écrit un ` +
        `toutes les ${battementMs} ms — silence = tampon ou flux mort`
    );
  } else {
    // L'écart est calculé sur les INSTANTS D'ARRIVÉE : le serveur, lui, a écrit
    // ces deux trames à `battementMs` d'intervalle, et un tampon les livre
    // ensemble.
    //
    // Le seuil n'est PAS la moitié du battement supposé : il vaut une seconde
    // au plus. Un proxy qui retient la réponse livre les deux trames dans le
    // même vidage, donc à quelques millisecondes l'une de l'autre — alors
    // qu'une écriture serveur, elle, est séparée de SECONDES, quelle que soit la
    // valeur exacte de `KOJO_SSE_HEARTBEAT_SECONDS` sur la machine déployée.
    // Comparer à la moitié d'un battement SUPPOSÉ ferait rougir un flux sain
    // quand l'environnement déployé bat plus vite que ce fichier ne le croit.
    const ecart = battement.aMs - premier.aMs;
    const ecartMin = Math.max(100, Math.min(1000, battementMs * 0.5));
    if (ecart < ecartMin) {
      refuser(
        'battement',
        `le premier événement et le premier battement sont arrivés à ${ecart} ms ` +
          `d'intervalle (< ${ecartMin} ms) alors que le serveur les écrit à ` +
          `${battementMs} ms : les deux trames ont été livrées dans le même vidage`
      );
    } else {
      verdicts.push({
        id: 'battement',
        ok: true,
        detail: `battement reçu ${ecart} ms après le premier événement : le flux est rendu au fil de l'eau`,
      });
    }
  }

  if (verdicts.length === 0) {
    verdicts.push({ id: 'transfert', ok: true, detail: 'flux traversé sans tampon mesurable' });
  }

  return { verdicts, refuse: verdicts.filter((v) => !v.ok).map((v) => v.detail) };
}

/* ──────────────────────────────── l'E/S ─────────────────────────────────── */

const libre = () => performance.now();

/** En-têtes communs : contournement Vercel éventuel, jamais publié. */
const entetesDe = (bypass) => {
  const entetes = {};
  if (bypass) entetes[BYPASS_HEADER] = bypass;
  return entetes;
};

/**
 * Ouvre le flux et relève les INSTANTS D'ARRIVÉE des chunks.
 *
 * `fetch` est lu en flux (`response.body.getReader()`), jamais par
 * `response.text()` : le second attend la fermeture de la réponse, donc il ne
 * mesurerait que le tampon — exactement le défaut qu'on cherche.
 *
 * L'arrêt est piloté par une CONDITION (premier événement ET premier battement,
 * ou plafond d'attente atteint), jamais par une attente fixe.
 */
export async function ouvrirFlux({
  url,
  token = '',
  bypass = '',
  battementMs = BATTEMENT_DEFAUT_MS,
  attenteMs = 0,
  fetchImpl = globalThis.fetch,
  maintenant = libre,
}) {
  const attente = attenteMs > 0 ? attenteMs : battementMs + FENETRE_CLIENT_MS;
  const entetes = {
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    ...entetesDe(bypass),
  };
  if (token) entetes.Authorization = `Bearer ${token}`;

  const debut = maintenant();
  const consigne = [];
  let statut = null;
  let entetesReponse = {};
  let termine = false;
  let erreur = null;
  let octets = 0;

  const controleur = new AbortController();
  let minuteur = null;
  const plafond = new Promise((resolve) => {
    minuteur = setTimeout(() => {
      try {
        controleur.abort();
      } catch {
        /* déjà fermé */
      }
      resolve('plafond');
    }, attente);
    if (typeof minuteur?.unref === 'function') minuteur.unref();
  });

  const lecture = (async () => {
    const reponse = await fetchImpl(url, {
      method: 'GET',
      headers: entetes,
      redirect: 'manual',
      signal: controleur.signal,
    });
    statut = reponse.status;
    entetesReponse = Object.fromEntries(reponse.headers.entries());
    if (!reponse.body || typeof reponse.body.getReader !== 'function') {
      return 'sans-corps';
    }
    const lecteur = reponse.body.getReader();
    const decodeur = new TextDecoder('utf-8', { fatal: false });
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) {
        termine = true;
        return 'fini';
      }
      if (value && value.length) octets += value.length;
      consigne.push({ aMs: Math.round(maintenant() - debut), texte: decodeur.decode(value || new Uint8Array(), { stream: true }) });
      const vu = analyserFlux({ consigne });
      if (vu.evenements.length > 0 && vu.battements.length > 0) {
        try {
          await lecteur.cancel();
        } catch {
          /* le proxy a pu fermer avant */
        }
        return 'complet';
      }
    }
  })().catch((err) => {
    if (controleur.signal.aborted) return 'plafond';
    erreur = err?.message || String(err);
    return 'erreur';
  });

  const raison = await Promise.race([lecture, plafond]);
  if (minuteur) clearTimeout(minuteur);
  try {
    controleur.abort();
  } catch {
    /* déjà aborté */
  }

  const dureeMs = Math.round(maintenant() - debut);
  return {
    url,
    statut,
    entetes: entetesReponse,
    consigne,
    octets,
    dureeMs,
    termine,
    raison,
    erreur,
    analyse: analyserFlux({ consigne }),
  };
}

/** Le contrôle : l'aller-retour d'une requête ordinaire par le MÊME proxy. */
export async function mesurerControle({ base, email, password, bypass, fetchImpl = globalThis.fetch, maintenant = libre }) {
  const debut = maintenant();
  try {
    const reponse = await fetchImpl(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...entetesDe(bypass) },
      body: JSON.stringify({ email, password }),
    });
    const corps = await reponse.json().catch(() => ({}));
    const controleMs = Math.round(maintenant() - debut);
    return {
      statut: reponse.status,
      controleMs,
      token: typeof corps?.access_token === 'string' ? corps.access_token : '',
      message: typeof corps?.detail === 'string' ? corps.detail : '',
    };
  } catch (err) {
    return { statut: 0, controleMs: null, token: '', message: err?.message || String(err) };
  }
}

/* ─────────────────────────────── l'orchestration ────────────────────────── */

const construireUrl = (base, chemin) => `${base.replace(/\/$/, '')}${chemin}`;

/**
 * Une SÉRIE de tentatives, puis UN verdict.
 *
 * Une mesure ratée seule ne conclut pas : un flux peut être refusé par le
 * plafond du compte (503) ou coupé par une reconnexion réseau, et rougir sur un
 * incident isolé ferait corriger un proxy sain. La sonde réessaie donc
 * `tentatives` fois, et ne refuse que si AUCUNE tentative n'a produit un flux
 * conforme — en nommant le dernier refus.
 */
export async function runSseProxyProbe({
  base = SITE_ORIGIN,
  chemin = CHEMIN_DEFAUT,
  direct = '',
  // Les DEUX noms, dans le même ordre que les autres sondes de production
  // (`check-session-reload-production.js`, `check-token-exposure-production.js`) :
  // ce dépôt fournit le compte sous `LHCI_TEST_*`, un compte CI dédié se
  // déclarerait sous `LHCI_CI_*`. Ne lire que le second nom rendait une prémisse
  // « aucun compte » ALORS QUE le compte existait — une surface aveugle qui se
  // déclarait aveugle, donc rouge chaque jour sans jamais juger le flux.
  email = process.env.LHCI_CI_EMAIL || process.env.LHCI_TEST_EMAIL || '',
  password = process.env.LHCI_CI_PASSWORD || process.env.LHCI_TEST_PASSWORD || '',
  bypass = process.env[BYPASS_ENV] || '',
  battementMs = Number(process.env.KOJO_SSE_HEARTBEAT_SECONDS || 0) * 1000 || BATTEMENT_DEFAUT_MS,
  attenteMs = 0,
  budgetMs = null,
  tentatives = 2,
  fetchImpl = globalThis.fetch,
  maintenant = libre,
  quiet = false,
  json = false,
} = {}) {
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const erreurs = [];
  const mesures = [];
  const refus = (message) => {
    erreurs.push(message);
  };

  if (!email || !password) {
    const manque = [
      !email ? 'LHCI_CI_EMAIL / LHCI_TEST_EMAIL' : null,
      !password ? 'LHCI_CI_PASSWORD / LHCI_TEST_PASSWORD' : null,
    ].filter(Boolean);
    refus(
      `${libelleSonde(base)} — ${MARQUE_PREMISSE} : ${manque.join(' et ')} absent(s), ` +
        `aucune session ne peut être ouverte. Le fait « un jeton est lisible côté web » ` +
        `appartient à la sonde d'exposition (::error title=Exposition jeton production::), ` +
        `et « la session survit au rechargement » à la sonde de session ` +
        `(::error title=Session production::) : ici la seule question est la traversée du flux.`
    );
    return { ok: false, premisse: true, attempts: 0, errors: erreurs, mesures };
  }

  const url = construireUrl(base, chemin);
  let dernierRefus = [];

  for (let tentative = 1; tentative <= Math.max(1, tentatives); tentative += 1) {
    const controle = await mesurerControle({ base, email, password, bypass, fetchImpl, maintenant });
    if (!controle.token) {
      refus(
        `${libelleSonde(base)} — ${MARQUE_PREMISSE} : connexion impossible ` +
          `(HTTP ${controle.statut}${controle.message ? `, « ${controle.message} »` : ''})` +
          (!bypass
            ? `. Si cette origine est une préproduction Vercel, sa Protection de ` +
              `déploiement répond à la place de l'API : renseigner ${BYPASS_ENV} ` +
              `(jamais une entrée de workflow, qui serait publiée dans les journaux)`
            : '') +
          '. Aucun verdict sur le flux ne peut être rendu sans session.'
      );
      return { ok: false, premisse: true, attempts: tentative, errors: erreurs, mesures };
    }

    const budget = budgetMs
      ? { budgetMs, derive: false, controleMs: controle.controleMs, force: true }
      : budgetDuPremierEvenement({ controleMs: controle.controleMs });

    const flux = await ouvrirFlux({
      url,
      token: controle.token,
      bypass,
      battementMs,
      attenteMs,
      fetchImpl,
      maintenant,
    });
    const verdict = jugeDuTransfert({
      analyse: flux.analyse,
      budgetMs: budget.budgetMs,
      battementMs,
      statut: flux.statut,
      entetes: flux.entetes,
      dureeMs: flux.dureeMs,
      termine: flux.termine,
    });

    const mesure = {
      tentative,
      url,
      statut: flux.statut,
      controleMs: controle.controleMs,
      budgetMs: budget.budgetMs,
      budgetDerive: budget.derive,
      premierEvenementMs: flux.analyse.evenements[0]?.aMs ?? null,
      premierType: flux.analyse.evenements[0]?.type ?? null,
      battementMs: flux.analyse.battements[0]?.aMs ?? null,
      ecartMs:
        flux.analyse.evenements[0] && flux.analyse.battements[0]
          ? flux.analyse.battements[0].aMs - flux.analyse.evenements[0].aMs
          : null,
      octets: flux.octets,
      dureeMs: flux.dureeMs,
      encodage: flux.entetes?.['content-encoding'] || 'identity',
      raison: flux.raison,
      erreur: flux.erreur,
      verdicts: verdict.verdicts,
    };
    mesures.push(mesure);

    if (verdict.refuse.length === 0) {
      if (json) log(JSON.stringify({ ok: true, mesures }, null, 2));
      else {
        log(
          `✅ ${libelleSonde(base)} : premier événement « ${mesure.premierType} » en ` +
            `${mesure.premierEvenementMs} ms (budget ${budget.budgetMs} ms` +
            `${budget.derive ? `, dérivé d'un contrôle à ${budget.controleMs} ms` : ''}), ` +
            `battement à ${mesure.battementMs} ms (écart ${mesure.ecartMs} ms), ` +
            `${mesure.octets} octet(s), encodage « ${mesure.encodage} » — ` +
            `le flux traverse ${base} au fil de l'eau.`
        );
      }
      // La comparaison avec l'accès DIRECT est un RELEVÉ, pas un second verdict :
      // l'écart entre les deux chemins nomme le coût du proxy sans refuser sur
      // une différence qui n'est pas une faute.
      if (direct && !quiet) await releverComparaison({ direct, chemin, token: controle.token, bypass, battementMs, attenteMs, fetchImpl, maintenant, budgetMs: budget.budgetMs });
      return { ok: true, premisse: false, attempts: tentative, errors: erreurs, mesures };
    }

    dernierRefus = verdict.refuse;
    if (json) log(JSON.stringify({ ok: false, tentative, mesure }, null, 2));
    else log(`↻ tentative ${tentative}/${tentatives} : ${dernierRefus.join(' ; ')}`);
  }

  refus(
    `${libelleSonde(base)} — ${dernierRefus.join(' ; ')}. ` +
      `Ce refus appartient à la ${FAMILLE} : la correction est côté proxy (réécriture ` +
      `Vercel, compression, CDN) ou côté serveur (battement), jamais côté client — ` +
      `la lecture des octets a ses propres tests (liveStream.test.js).`
  );
  return { ok: false, premisse: false, attempts: tentatives, errors: erreurs, mesures };
}

/** Le relevé de comparaison : le MÊME flux, SANS le proxy. Aucun verdict. */
async function releverComparaison({ direct, chemin, token, bypass, battementMs, attenteMs, fetchImpl, maintenant, budgetMs }) {
  const flux = await ouvrirFlux({
    url: construireUrl(direct, chemin),
    token,
    bypass,
    battementMs,
    attenteMs,
    fetchImpl,
    maintenant,
  });
  const premierMs = flux.analyse.evenements[0]?.aMs ?? null;
  console.log(
    `   relevé (aucun verdict) : en direct sur ${direct} — premier événement ` +
      `${premierMs === null ? 'absent' : `${premierMs} ms`}, HTTP ${flux.statut}, ` +
      `budget du passage ${budgetMs} ms.`
  );
  return { premierMs, statut: flux.statut };
}

/* ─────────────────────────────── la ligne de commande ───────────────────── */

function lireOptions(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const suivant = argv[i + 1];
    if (flag === '--json') options.json = true;
    else if (flag === '--quiet') options.quiet = true;
    else if (flag === '--base' && suivant) options.base = suivant;
    else if (flag === '--chemin' && suivant) options.chemin = suivant;
    else if (flag === '--direct' && suivant) options.direct = suivant;
    else if (flag === '--battement' && suivant) options.battementMs = Number(suivant);
    else if (flag === '--attente' && suivant) options.attenteMs = Number(suivant);
    else if (flag === '--budget' && suivant) options.budgetMs = Number(suivant);
    else if (flag === '--tentatives' && suivant) options.tentatives = Number(suivant);
    if (['--base', '--chemin', '--direct', '--battement', '--attente', '--budget', '--tentatives'].includes(flag)) {
      i += 1;
    }
  }
  return options;
}

/**
 * La ligne de commande — couture INJECTABLE, pour que le CODE DE SORTIE soit
 * jugé sans réseau, sans compte et sans flux.
 *
 * Les trois issues étaient déjà distinctes ICI (0/1/2), mais aucune preuve ne
 * les nommait : `main` lisait `process.argv` et sortait par `process.exit`, donc
 * le seul moyen de le juger était de lancer un processus. Un code de sortie
 * n'est une promesse que s'il est MESURÉ.
 *
 * @param {string[]} argv Arguments après `node script`.
 * @param {object} deps `run` (la sonde), `error`.
 * @returns {Promise<number>} 0 vert, 1 refus du flux, 2 prémisse (aucun verdict).
 */
export async function main(argv = process.argv.slice(2), { run = runSseProxyProbe, error = console.error } = {}) {
  const options = lireOptions(argv);
  const base = (options.base || SITE_ORIGIN).replace(/\/$/, '');
  const resultat = await run({ ...options, base });

  if (!resultat.ok) {
    // Un seul titre d'annotation, et chaque message porte sa FAMILLE : le
    // refus se lit hors de son workflow.
    error(`::error title=${TITRE_ERREUR}::${resultat.errors.join(' | ')}`);
    for (const message of resultat.errors) error(`❌ ${message}`);
    if (resultat.premisse) {
      error(
        `\nAucun verdict rendu : cette prémisse n'est pas un rouge du flux. ` +
          `Ce qu'elle constate (compte CI absent, Protection Vercel, connexion refusée) ` +
          `ne dit rien du tampon d'un proxy.`
      );
      return 2;
    }
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`::error title=${TITRE_ERREUR}::sonde interrompue : ${err?.message || err}`);
      process.exitCode = 1;
    });
}

