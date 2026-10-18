// LES DEUX DÉLAIS DU FLUX TEMPS RÉEL, ET LEUR RELATION — un seul propriétaire.
//
// ── Le défaut, mesuré le 18/10/2026 ─────────────────────────────────────────
// Le serveur (`backend/kojo_live.py`, `HEARTBEAT_SECONDS`) écrit un commentaire
// `: keepalive` toutes les 20 s ; le client (`services/liveStream.js`) jugeait
// le flux TOMBÉ après 15 s sans un octet. Les deux nombres vivaient dans deux
// dépôts de langue différente, et 15 < 20 : un flux parfaitement VIVANT mais
// inactif (aucune notification, aucun message) était donc condamné avant même
// le premier battement. Conséquence en chaîne, toutes les 15 s : statut `down`,
// repli à 60 s armé par l'appelant, reconnexion, et un flux rouvert pour rien.
// Le remplacement du sondage produisait ainsi plus d'allers-retours que le
// sondage lui-même — l'inverse de ce pour quoi il existe.
//
// ── La règle, et d'où viennent les valeurs ─────────────────────────────────
// La fenêtre de silence doit TOLÉRER UN BATTEMENT PERDU, sans quoi un seul
// keepalive retardé par un opérateur mobile suffit à déclarer mort un flux
// sain. Elle vaut donc deux intervalles plus une marge de gigue :
//
//     SILENCE_TIMEOUT_MS = BATTEMENT_SERVEUR_MS × (BATTEMENTS_TOLERES + 1) + MARGE_GIGUE_MS
//                        = 20 000 × 2 + 5 000 = 45 000 ms
//
// `MARGE_GIGUE_MS` couvre l'arrivée tardive d'un battement (proxy, TCP, réseau
// mobile) et ne remplace pas un second battement perdu : au-delà de 45 s de
// silence, deux battements ont manqué, et là le doute est légitime.
//
// ── La borne haute, et pourquoi elle existe ────────────────────────────────
// Cette fenêtre est aussi le dernier filet contre un proxy qui TAMPONNE la
// réponse (200, puis plus rien) : allonger sans limite rendrait ce filet
// inutile. 45 s reste sous la minute et sous le bail du registre partagé
// (`PARTAGE_LEASE_SECONDS`, 60 s) : un flux déclaré tombé n'est jamais un flux
// encore compté au plafond du compte.
//
// ── Ce que ce module ne peut pas garantir ──────────────────────────────────
// Le battement est écrit des deux côtés (Python et JavaScript) : ce fichier
// MIROITE `kojo_live.HEARTBEAT_SECONDS`. La relation est donc vérifiée, pas
// supposée — `scripts/__tests__/battement-coeur-aligne.test.js` lit le défaut
// Python, `fly.toml` et ce fichier, et refuse de conclure si l'un des trois a
// bougé sans les autres. Un flux dont l'intervalle est surchargé sur la machine
// déployée (`KOJO_SSE_HEARTBEAT_SECONDS`) reste hors de portée d'un test hors
// ligne ; la sonde de production relève, elle, l'écart réellement observé.

/** Le battement de cœur du serveur (`kojo_live.HEARTBEAT_SECONDS`), en ms. */
export const BATTEMENT_SERVEUR_MS = 20000;

/** Combien de battements CONSÉCUTIFS peuvent manquer sans condamner le flux. */
export const BATTEMENTS_TOLERES = 1;

/** Marge d'arrivée tardive, ajoutée aux intervalles tolérés. */
export const MARGE_GIGUE_MS = 5000;

/**
 * Silence toléré par le client avant de juger le flux tombé (ms).
 *
 * Doit rester SUPÉRIEUR au battement du serveur : c'est l'invariant que le
 * garde vérifie, et celui dont l'oubli coûtait une reconnexion par flux inactif.
 */
export const SILENCE_TIMEOUT_MS =
  BATTEMENT_SERVEUR_MS * (BATTEMENTS_TOLERES + 1) + MARGE_GIGUE_MS;

/** Borne haute : au-delà, le filet contre un proxy qui tamponne ne mord plus. */
export const SILENCE_TIMEOUT_MAX_MS = 90000;
