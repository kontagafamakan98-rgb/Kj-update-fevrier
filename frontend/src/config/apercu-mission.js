/**
 * LE CONTRAT entre le document pré-rendu `/jobs/:id` et la page qui le reprend.
 *
 * Le document est écrit par le BACKEND (`backend/kojo_job_og.py`, rewrite Vercel
 * /jobs/(.*) → /api/og/jobs/$1) : il ne connaît ni les noms hachés du build, ni
 * les composants de l'application. Il ne peut donc publier que des faits
 * DÉCLARÉS ici, et c'est ce que le contrat hors ligne
 * (`frontend/scripts/check-job-og-contract.js`) confronte au document rendu — un
 * renommage d'un seul côté rougit au lieu de publier une fiche qui pointe vers un
 * 404 ou une fiche qui n'a plus ses données.
 *
 *   • `BOOT_SCRIPT` / `BOOT_STYLE` — les DEUX chemins STABLES du build. Ils sont
 *     lus dans `APERCU_TRAVAILLEUR` et non recopiés : c'est l'APPLICATION qui a
 *     une entrée et une feuille, pas une page. Un second couple stable
 *     (`/boot/job-boot.js`, `/boot/job-app.css`) doublerait dans l'artefact une
 *     feuille de près d'un mégaoctet pour deux URL au contenu identique, et les
 *     deux copies vieilliraient séparément. Les noms portent encore « worker »
 *     parce que le profil est arrivé le premier — les renommer serait un
 *     changement d'URL servie sans gain, pas une clarification.
 *   • `SEED_ID` — l'identifiant du bloc `<script type="application/json">` qui
 *     porte la VUE PUBLIQUE déjà rendue (celle de `GET /jobs/:id` pour un
 *     visiteur anonyme). La page le lit comme état initial : la fiche s'affiche
 *     sans squelette, puis la relecture de l'API la rafraîchit. Le bloc est HORS
 *     de `#root`, parce que React efface ce conteneur au montage.
 *
 * Ce module est lu par l'application ET par les gardes de build : c'est le seul
 * domicile de ces noms, donc deux copies ne peuvent pas diverger en silence.
 */
// Extension ÉCRITE : ce module est aussi chargé par Node (`scripts/site-meta.js`,
// donc par les gardes de build et le contrat hors ligne), où la résolution sans
// extension n'existe pas.
import { APERCU_TRAVAILLEUR } from './apercu-travailleur.js';

export const APERCU_MISSION = {
  BOOT_SCRIPT: APERCU_TRAVAILLEUR.BOOT_SCRIPT,
  BOOT_STYLE: APERCU_TRAVAILLEUR.BOOT_STYLE,
  SEED_ID: 'kojo-job-data',
};

/**
 * La vue DÉJÀ rendue par le backend, s'il y en a une pour cette route.
 *
 * Le bloc vient du document que le backend a écrit — c'est la vue publique qu'il
 * a lui-même publiée en HTML, donc la relire ne révèle rien de nouveau. Trois
 * refus, tous silencieux, parce que le repli est le comportement d'avant et
 * qu'il est correct :
 *
 *   • pas de bloc (navigation interne, ou `/jobs/:id` servi par l'app) ;
 *   • bloc illisible (JSON tronqué par un proxy, document d'une autre version) ;
 *   • bloc d'une AUTRE mission (le document est en cache pour une fiche, la
 *     route en demande une autre) — s'en servir afficherait la mauvaise mission,
 *     avec son budget et son adresse.
 *
 * Ce qui n'est PAS jugé ici : la forme des champs. Le bloc vient du même backend
 * que l'API et la page tolère déjà l'absence de chacun ; re-valider chaque clé
 * ajouterait un second schéma à maintenir pour un document que nous écrivons
 * nous-mêmes.
 *
 * @param {string} id Identifiant attendu (celui de la route).
 * @param {Document} [racine] Document à lire (injecté par les tests).
 * @returns {object|null} La vue publique, ou null.
 */
export const lireApercuMission = (id, racine = typeof document === 'undefined' ? null : document) => {
  if (!racine || !id) return null;
  const noeud = racine.getElementById(APERCU_MISSION.SEED_ID);
  if (!noeud) return null;
  try {
    const donnees = JSON.parse(noeud.textContent || 'null');
    if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) return null;
    if (String(donnees.id ?? '') !== String(id)) return null;
    return donnees;
  } catch (_erreur) {
    return null;
  }
};
