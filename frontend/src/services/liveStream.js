/**
 * Flux temps réel (Server-Sent Events) — le remplaçant du sondage.
 *
 * ── Pourquoi `fetch` et pas `EventSource` ──────────────────────────────────
 * `EventSource` n'envoie AUCUN en-tête d'authentification. Sur le web la
 * session est un cookie httpOnly, qui part tout seul ; mais dans le shell natif
 * (Capacitor) il n'y a pas de cookie fiable et le jeton vit en stockage
 * local — l'API l'attend dans `Authorization`. Le mettre dans l'URL du flux
 * (`?token=…`) l'exposerait aux journaux et aux historiques, ce que la sonde
 * `check-token-exposure-production.js` refuse justement (valeur en forme de
 * JWT dans un paramètre d'URL). `fetch` + `ReadableStream` lit le MÊME protocole
 * (`text/event-stream`) avec les en-têtes de l'application : un seul chemin
 * d'authentification, aucun jeton dans une URL.
 *
 * ── Ce que ce module garantit ─────────────────────────────────────────────
 *   • une trame coupée entre deux paquets réseau est RECOLLÉE (le tampon est
 *     lu jusqu'au double saut de ligne), sinon un événement sur deux serait
 *     perdu selon la segmentation TCP ;
 *   • un flux qui tombe est ROUVERT, avec un recul exponentiel plafonné et un
 *     peu d'aléa (sans aléa, tous les onglets d'un incident reviennent à la
 *     même milliseconde) ;
 *   • un REFUS DE CAPACITÉ (503) est espacé PLUS largement qu'une panne
 *     ordinaire, même quand la consigne du serveur n'est pas lisible : c'est
 *     ce qui empêche un onglet de saturer son propre plafond (`CAPACITY_FLOOR_MS`,
 *     qui suit le bail des places refusées) ;
 *   • l'état est PUBLIÉ (`connecting` / `open` / `down` / `closed`) : c'est ce
 *     qui permet à l'appelant de retomber sur un sondage dégradé au lieu de
 *     rester muet. Un flux qu'on croit vivant est le pire des deux mondes ;
 *   • un 401/403 ARRÊTE les tentatives : insister toutes les 30 s sur une
 *     session morte produirait du bruit sans jamais réussir (la reconnexion
 *     d'une session est le travail de `AuthContext`, pas du flux).
 */

import { buildApiUrl } from '../utils/backendUrl';
import { SILENCE_TIMEOUT_MS } from '../config/flux-temps-reel';
import { getAuthToken } from './api';

export const STREAM_STATUS = {
  CONNECTING: 'connecting',
  OPEN: 'open',
  DOWN: 'down',
  CLOSED: 'closed',
};

/** Le navigateur sait-il lire un corps de réponse en flux ? */
export const isLiveStreamSupported = () =>
  typeof fetch === 'function'
  && typeof ReadableStream !== 'undefined'
  && typeof TextDecoder !== 'undefined';

const defaultSchedule = (run, delay) => setTimeout(run, delay);

/** Borne d'une consigne `Retry-After` : un serveur qui demanderait une heure
 *  laisserait le compte sans temps réel une heure. */
export const MAX_RETRY_AFTER_MS = 120000;

/**
 * Plancher de retour après un REFUS DE CAPACITÉ (503), quand le serveur ne dit
 * rien d'exploitable (`Retry-After` absent, masqué par un intermédiaire, ou
 * illisible).
 *
 * ── Le défaut, mesuré le 25/10/2026 ─────────────────────────────────────────
 * Le serveur refuse au plafond du compte (503 + `Retry-After: 60`) et rend la
 * place d'un flux abandonné à l'expiration du BAIL, 60 s plus tard
 * (`PARTAGE_LEASE_SECONDS`, calculé depuis le battement dans `kojo_live.py`).
 * Le client, lui, ne POSAIT aucun plancher : sans consigne lisible il revenait
 * à 1 s, 2 s, 4 s, 8 s, 16 s, 30 s — six tentatives dans la première minute,
 * toutes refusées, chacune pouvant laisser une place comptée en attendant son
 * bail. Un onglet pouvait donc saturer son propre plafond et s'y maintenir :
 * plus il retentait, moins il avait de chances de repasser.
 *
 * ── Pourquoi la valeur est écrite ICI ──────
 * Le client ne peut pas lire les constantes Python. 60 s est donc le miroir de
 * `kojo_live.STREAM_REFUSED_RETRY_AFTER_SECONDS`, et la relation est JUGÉE, pas
 * supposée : `frontend/scripts/__tests__/battement-coeur-aligne.test.js` lit la
 * constante Python et refuse un plancher client qui serait plus court qu'elle.
 *
 * ── Ce que ce plancher n'est pas ───────────────────────────────────────────
 * Il ne remplace pas la consigne du serveur : `Retry-After` reste un plancher
 * aussi, et le plus GRAND des deux gagne (`Math.max(recul, consigne, plancher)`).
 * Il ne s'excuse pas non plus d'être long : pendant l'attente, l'appelant a son
 * repli (`FALLBACK_POLL_MS`, 60 s), donc l'utilisateur n'est jamais muet.
 */
export const CAPACITY_FLOOR_MS = 60000;

/**
 * Le délai que le serveur DEMANDE avant de revenir (`Retry-After`, en secondes).
 *
 * Mesuré le 25/10/2026, console de production : quand le plafond de flux d'un
 * compte est atteint, les deux flux répondent 503 avec `Retry-After: 60`, et le
 * client revenait à 1 s, 2 s, 4 s… — plus tôt que ce que le serveur autorisait,
 * donc une rafale de 503 dans la console pour un plafond qui, lui, ne changeait
 * pas. La consigne du serveur est un PLANCHER, jamais un plafond.
 *
 * @param {Response} response Réponse non-ok.
 * @returns {number} Délai en millisecondes (0 si absent ou illisible).
 */
const delaiConsigne = (response) => {
  const entetes = response && response.headers;
  if (!entetes || typeof entetes.get !== 'function') return 0;
  const secondes = Number(entetes.get('retry-after'));
  if (!Number.isFinite(secondes) || secondes <= 0) return 0;
  return Math.min(secondes * 1000, MAX_RETRY_AFTER_MS);
};

/** `event:` + une ou plusieurs lignes `data:` (jointes par un saut de ligne). */
const parseBlock = (block) => {
  let event = 'message';
  const data = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue; // commentaire / keepalive
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  const payload = data.join('\n');
  try {
    return { event, data: JSON.parse(payload) };
  } catch (_error) {
    return { event, data: payload };
  }
};

const readFrames = async (body, emit, signal, onActivity = () => {}) => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // `close()` doit rendre la main même si l'implémentation de `fetch` ignore
  // le signal (cas des doubles de test, et de certains polyfills) : annuler le
  // lecteur fait résoudre la lecture en cours, donc la boucle s'arrête au lieu
  // de rester suspendue sur un flux que plus personne ne lit.
  const annuler = () => {
    try {
      reader.cancel();
    } catch (_error) {
      // Flux déjà fermé.
    }
  };
  if (signal) signal.addEventListener('abort', annuler, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      // Un OCTET reçu compte comme une preuve de vie, même un commentaire de
      // battement : c'est ce qui distingue un flux vide d'un flux tamponné par
      // un proxy (qui ne rendrait rien du tout).
      onActivity();
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const parsed = parseBlock(block);
        if (parsed) emit(parsed.event, parsed.data);
        cut = buffer.indexOf('\n\n');
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', annuler);
    try {
      reader.releaseLock();
    } catch (_error) {
      // Flux déjà libéré (annulation) : rien à faire.
    }
  }
};

/**
 * Ouvre un flux SSE et le maintient ouvert jusqu'à `close()`.
 *
 * @param {string} path Chemin d'API (`/notifications/stream`).
 * @param {object} options
 * @param {(event: string, data: any) => void} options.onEvent Événement reçu.
 * @param {(status: string) => void} options.onStatus Changement d'état.
 * @param {Function} [options.fetchImpl] `fetch` (injecté par les tests).
 * @param {Function} [options.schedule] Planificateur (injecté par les tests).
 * @param {number} [options.initialDelayMs] Premier recul de reconnexion.
 * @param {number} [options.maxDelayMs] Recul maximal.
 * @param {number} [options.silenceTimeoutMs] Silence toléré avant de juger le
 *   flux TOMBÉ (0 désactive). Un proxy qui tamponne la réponse rend un 200 puis
 *   plus rien : sans ce chien de garde, le client croirait le flux vivant et
 *   n'armerait jamais son repli — le pire des deux mondes (aucun événement, et
 *   aucun sondage non plus). La valeur par défaut vient de
 *   `config/flux-temps-reel.js`, SEUL propriétaire du battement du serveur et
 *   de cette fenêtre : une fenêtre plus courte que le battement déclarait
 *   tombé un flux vivant mais inactif, donc une reconnexion à chaque battement
 *   manqué — le défaut mesuré le 18/10/2026 (15 s contre 20 s).
 * @returns {() => void} Ferme le flux (et annule une reconnexion en attente).
 */
export function openLiveStream(
  path,
  {
    onEvent = () => {},
    onStatus = () => {},
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    schedule = defaultSchedule,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    silenceTimeoutMs = SILENCE_TIMEOUT_MS,
    random = Math.random,
  } = {},
) {
  let closed = false;
  let controller = null;
  let cancelRetry = null;
  let chienDeGarde = null;
  let attempt = 0;
  // Refus de capacité consécutifs DEPUIS le dernier flux réellement ouvert.
  // Il ne retombe pas sur une panne réseau : une erreur de transport au milieu
  // d'une série de 503 ne dit rien du plafond, et repartir à 1 s parce que le
  // réseau a hoqueté rendrait le plancher décoratif.
  let refusCapacite = 0;
  let dernierStatut = null;

  const annoncer = (statut) => {
    if (statut === dernierStatut) return;
    dernierStatut = statut;
    onStatus(statut);
  };

  const recul = () => {
    const base = Math.min(maxDelayMs, initialDelayMs * 2 ** attempt);
    // ±20 % : sans aléa, tous les onglets reviennent au même instant après une
    // coupure serveur, et la reconnexion devient une rafale.
    return Math.round(base * (0.8 + random() * 0.4));
  };

  /**
   * Recul après un refus de capacité : un plancher qui GRANDIT, et une gigue
   * POSITIVE seulement.
   *
   * La gigue est positive parce qu'un plancher ne se franchit pas vers le bas :
   * le serveur a dit « pas avant », et revenir plus tôt est exactement la
   * rafale qu'on supprime. Elle existe quand même — sans elle, tous les onglets
   * réveillés par le même incident reviennent à la même seconde et reforment la
   * rafale qu'ils viennent d'éviter.
   */
  const delaiApresRefus = () => {
    const plancher = Math.min(
      MAX_RETRY_AFTER_MS,
      CAPACITY_FLOOR_MS * 2 ** Math.min(Math.max(refusCapacite - 1, 0), 1),
    );
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(plancher * (1 + random() * 0.2)));
  };

  const attendre = (delay) => new Promise((resolve) => {
    const minuteur = schedule(resolve, delay);
    cancelRetry = () => {
      if (typeof clearTimeout === 'function') clearTimeout(minuteur);
      resolve();
    };
  });

  const desarmerChienDeGarde = () => {
    if (chienDeGarde !== null) {
      clearTimeout(chienDeGarde);
      chienDeGarde = null;
    }
  };

  const armerChienDeGarde = () => {
    if (!silenceTimeoutMs) return;
    desarmerChienDeGarde();
    chienDeGarde = setTimeout(() => {
      chienDeGarde = null;
      // Silencieux trop longtemps : on coupe, la boucle enregistre une panne et
      // retombe sur le repli de l'appelant.
      if (!closed && controller) controller.abort();
    }, silenceTimeoutMs);
  };

  const boucle = async () => {
    if (!fetchImpl) {
      annoncer(STREAM_STATUS.DOWN);
      return;
    }

    while (!closed) {
      annoncer(STREAM_STATUS.CONNECTING);
      controller = new AbortController();
      let statutHttp = 0;
      let consigne = 0;
      armerChienDeGarde();

      try {
        const token = getAuthToken();
        const response = await fetchImpl(buildApiUrl(path), {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        statutHttp = response.status;

        if (!response.ok || !response.body) {
          consigne = delaiConsigne(response);
          throw new Error(`Flux indisponible (HTTP ${response.status})`);
        }

        attempt = 0;
        refusCapacite = 0;
        annoncer(STREAM_STATUS.OPEN);
        await readFrames(response.body, (event, data) => {
          if (!closed) onEvent(event, data);
        }, controller.signal, armerChienDeGarde);
      } catch (error) {
        // Fermé par APPELANT : plus rien à faire. Une annulation par le chien
        // de garde, elle, est une PANNE et suit le chemin du repli.
        if (closed) break;
        // 401/403 : la session est refusée. Rejouer la même requête toutes les
        // 30 s ne la rétablira pas — c'est le travail de la sonde de session.
        if (statutHttp === 401 || statutHttp === 403) {
          annoncer(STREAM_STATUS.DOWN);
          break;
        }
        // 503 : le produit se protège (plafond du compte ou du process), ce
        // n'est pas une panne réseau — d'où un compteur à part.
        if (statutHttp === 503) refusCapacite += 1;
      } finally {
        desarmerChienDeGarde();
      }

      if (closed) break;
      annoncer(STREAM_STATUS.DOWN);
      // Le recul se calcule sur l'essai EN COURS (le premier vaut
      // `initialDelayMs`), puis grandit : 1 s, 2 s, 4 s…
      //
      // Un refus de capacité impose EN PLUS son propre plancher, qui ne dépend
      // pas de ce que le serveur a pu faire passer : c'est lui qui empêche un
      // onglet de revenir six fois dans la minute contre un plafond qui ne
      // libère ses places qu'au bout du bail.
      const delaiAvantRefus = refusCapacite > 0 ? delaiApresRefus() : 0;
      const delai = Math.max(recul(), consigne, delaiAvantRefus);
      attempt += 1;
      await attendre(delai);
      cancelRetry = null;
    }

    if (!closed) annoncer(STREAM_STATUS.CLOSED);
  };

  boucle();

  return () => {
    if (closed) return;
    closed = true;
    annoncer(STREAM_STATUS.CLOSED);
    desarmerChienDeGarde();
    if (cancelRetry) cancelRetry();
    cancelRetry = null;
    if (controller) controller.abort();
  };
}

export default openLiveStream;
