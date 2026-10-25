/**
 * GARDE : LE BATTEMENT DU SERVEUR ET LA FENÊTRE DE SILENCE DU CLIENT NE PEUVENT
 * PAS DIVERGER — la divergence coûtait une reconnexion par flux inactif.
 *
 * ── Le fait mesuré, et pourquoi il faut un garde ────────────────────────────
 * Le 18/10/2026, `backend/kojo_live.py` écrivait un `: keepalive` toutes les
 * 20 s et `frontend/src/services/liveStream.js` jugeait le flux tombé après
 * 15 s sans un octet. Les deux valeurs vivaient dans deux langages : rien ne les
 * rapprochait, et 15 < 20. Un flux VIVANT mais inactif (aucune notification,
 * aucun message) était donc condamné 5 s avant le premier battement, puis rouvert
 * — toutes les 15 s, indéfiniment, avec le repli à 60 s armé au passage.
 *
 * Le remède a deux moitiés, et ce fichier tient la seconde :
 *   • un propriétaire unique côté client (`src/config/flux-temps-reel.js`), que
 *     `liveStream.js` ET la sonde de production lisent au lieu de recopier ;
 *   • ce garde, qui REFUSE une divergence entre le défaut Python, la surcharge
 *     éventuelle de `fly.toml` et le miroir JavaScript.
 *
 * ── Ce qu'il exige, en clair ────────────────────────────────────────────────
 *   1. `BATTEMENT_SERVEUR_MS` vaut le défaut de `kojo_live.HEARTBEAT_SECONDS`
 *      (et la surcharge de `fly.toml`, si elle existe, vaut la même chose) : le
 *      client règle sa montre sur le serveur qu'il interroge ;
 *   2. `SILENCE_TIMEOUT_MS >= 2 × battement` : un battement retardé ne condamne
 *      pas un flux sain (un battement PERDU est toléré) ;
 *   3. `SILENCE_TIMEOUT_MS <= SILENCE_TIMEOUT_MAX_MS` : la fenêtre reste le
 *      filet contre un proxy qui tamponne, pas une attente sans fin ;
 *   4. les deux consommateurs (`liveStream.js` par défaut, sonde de production)
 *      LISENT ce propriétaire — une recopie numérique serait la divergence de
 *      demain, et elle est refusée ici avant d'être mesurée en production.
 *
 * ── Ce que ce garde ne peut pas voir ────────────────────────────────────────
 * Une surcharge de `KOJO_SSE_HEARTBEAT_SECONDS` posée sur la machine DÉPLOYÉE
 * (`fly secrets`) : elle n'est pas dans le dépôt. La sonde de production relève,
 * elle, l'écart réellement observé entre `ready` et le premier `: keepalive` —
 * ce garde-ci juge les fichiers, pas le runtime.
 *
 * Il REFUSE DE CONCLURE sous ses planchers de lecture : un motif qui ne trouve
 * plus sa ligne (renommage, réécriture) ne doit pas passer pour « aligné ».
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BATTEMENTS_TOLERES,
  BATTEMENT_SERVEUR_MS,
  MARGE_GIGUE_MS,
  SILENCE_TIMEOUT_MAX_MS,
  SILENCE_TIMEOUT_MS,
} from '../../src/config/flux-temps-reel.js';
import { CAPACITY_FLOOR_MS, MAX_RETRY_AFTER_MS } from '../../src/services/liveStream.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
// Les chemins sont écrits depuis la RACINE DU DÉPÔT : ils se lisent comme des
// emplacements, pas comme des voisins du fichier de test.
const RACINE = path.resolve(ICI, '..', '..', '..');

// Planchers de LECTURE. Un fichier tronqué (ou déplacé) ne doit pas rendre un
// vert : sans ces contrôles, une regex qui ne trouve rien passerait pour un
// alignement constaté.
const MIN_OCTETS = 500;
const MIN_ONGLETS_FLY = 5;

const lire = (relatif) => {
  const complet = path.join(RACINE, relatif);
  const texte = fs.readFileSync(complet, 'utf8');
  if (texte.length < MIN_OCTETS) {
    throw new Error(
      `${relatif} fait ${texte.length} octet(s) (< ${MIN_OCTETS}) : le fichier lu ` +
        `n'est pas son sujet — refus de conclure.`
    );
  }
  return texte;
};

/** Le défaut de `kojo_live.HEARTBEAT_SECONDS`, en secondes. Lu, jamais supposé. */
export function battementServeurPython(texte) {
  const motif = /HEARTBEAT_SECONDS\s*=\s*float\(\s*os\.environ\.get\(\s*"KOJO_SSE_HEARTBEAT_SECONDS"\s*,\s*"([\d.]+)"\s*\)/;
  const trouve = texte.match(motif);
  if (!trouve) {
    throw new Error(
      "le défaut de `HEARTBEAT_SECONDS` n'a pas été trouvé dans backend/kojo_live.py : " +
        'le motif a bougé, donc ce garde ne lit plus son sujet — corriger le motif, ' +
        'pas le verdict.'
    );
  }
  return Number(trouve[1]);
}

/**
 * La consigne de retour d'un flux REFUSÉ, en secondes, lue dans `kojo_live.py`.
 *
 * Un seul propriétaire côté serveur : les deux routes de flux la lisent, et le
 * client s'y range. Le jour où quelqu'un allonge la consigne sans toucher au
 * plancher du client, ce garde doit rougir — sinon le client revient plus tôt
 * que le serveur ne l'autorise, ce qui est la rafale de 503 mesurée le
 * 25/10/2026.
 */
export function consigneRefusPython(texte) {
  const motif = /STREAM_REFUSED_RETRY_AFTER_SECONDS\s*=\s*(\d+(?:\.\d+)?)/;
  const trouve = texte.match(motif);
  if (!trouve) {
    throw new Error(
      "la consigne `STREAM_REFUSED_RETRY_AFTER_SECONDS` n'a pas été trouvée dans " +
        'backend/kojo_live.py : le motif a bougé, donc ce garde ne lit plus son ' +
        'sujet — corriger le motif, pas le verdict.'
    );
  }
  return Number(trouve[1]);
}

/** La surcharge de `KOJO_SSE_HEARTBEAT_SECONDS` dans `[env]` de fly.toml, ou null. */
export function battementFlyToml(texte) {
  const motif = /^\s*KOJO_SSE_HEARTBEAT_SECONDS\s*=\s*"?([\d.]+)"?\s*$/m;
  const trouve = texte.match(motif);
  return trouve ? Number(trouve[1]) : null;
}

describe('battement du serveur et fenêtre de silence du client — la MÊME horloge', () => {
  const kojoLive = lire('backend/kojo_live.py');
  const fly = lire('backend/fly.toml');
  const sonde = lire('frontend/scripts/check-sse-proxy-production.js');
  const lecteur = lire('frontend/src/services/liveStream.js');

  it('le miroir JavaScript vaut le défaut Python (le client règle sa montre sur le serveur)', () => {
    const secondes = battementServeurPython(kojoLive);
    expect(secondes).toBeGreaterThan(0);
    expect(BATTEMENT_SERVEUR_MS).toBe(secondes * 1000);
  });

  it('une surcharge dans fly.toml, si elle existe, ne décale pas la fenêtre', () => {
    // Le déploiement peut choisir un autre battement ; ce garde ne l'interdit
    // pas, il exige que le client le SUIVE. Un `[env]` divergent rendrait la
    // fenêtre trop courte sur la machine déployée, et le défaut reviendrait
    // sans qu'aucun test ne rougisse.
    const onglets = fly.split('\n').length;
    expect(onglets).toBeGreaterThan(MIN_ONGLETS_FLY);
    const secondes = battementFlyToml(fly);
    if (secondes !== null) {
      expect(secondes * 1000).toBe(BATTEMENT_SERVEUR_MS);
    }
  });

  it('la fenêtre TOLÈRE un battement perdu (au moins deux intervalles)', () => {
    expect(BATTEMENTS_TOLERES).toBeGreaterThanOrEqual(1);
    expect(MARGE_GIGUE_MS).toBeGreaterThan(0);
    // C'est l'inégalité qui manquait : 15 000 < 20 000 déclarait tombé un flux
    // vivant à chaque battement, et la marge la rend impossible à réintroduire
    // sans faire rougir ce cas.
    expect(SILENCE_TIMEOUT_MS).toBeGreaterThanOrEqual(BATTEMENT_SERVEUR_MS * 2);
    expect(SILENCE_TIMEOUT_MS).toBe(
      BATTEMENT_SERVEUR_MS * (BATTEMENTS_TOLERES + 1) + MARGE_GIGUE_MS
    );
  });

  it('la fenêtre reste bornée : un flux tamponné est encore vu comme tombé', () => {
    // Sans borne haute, « aligner » le client reviendrait à lui faire attendre
    // indéfiniment — et un proxy qui retient la réponse ne serait plus jamais
    // soupçonné, ce qui est l'autre moitié du défaut.
    expect(SILENCE_TIMEOUT_MS).toBeLessThanOrEqual(SILENCE_TIMEOUT_MAX_MS);
    expect(SILENCE_TIMEOUT_MAX_MS).toBeLessThanOrEqual(90_000);
  });

  it('le client LIT le propriétaire (aucun 15 000 recopié dans liveStream.js)', () => {
    expect(lecteur).toMatch(/silenceTimeoutMs\s*=\s*SILENCE_TIMEOUT_MS\b/);
    expect(lecteur).toMatch(/from '\.\.\/config\/flux-temps-reel'/);
    expect(lecteur).not.toMatch(/silenceTimeoutMs\s*=\s*\d/);
  });

  it('la sonde de production LIT le propriétaire au lieu de recopier les deux délais', () => {
    // La sonde juge « à temps » ce que le client n'aurait pas encore condamné :
    // deux copies auraient laissé la sonde verte sur un flux déjà jugé muet.
    expect(sonde).toMatch(/FENETRE_CLIENT_MS\s*=\s*SILENCE_TIMEOUT_MS\b/);
    expect(sonde).toMatch(/BATTEMENT_DEFAUT_MS\s*=\s*BATTEMENT_SERVEUR_MS\b/);
    expect(sonde).toMatch(/from '\.\.\/src\/config\/flux-temps-reel\.js'/);
    expect(sonde).not.toMatch(/FENETRE_CLIENT_MS\s*=\s*\d/);
    expect(sonde).not.toMatch(/BATTEMENT_DEFAUT_MS\s*=\s*\d/);
  });
});

/**
 * GARDE : LE PLANCHER DU CLIENT APRÈS UN 503 NE PEUT PAS ÊTRE PLUS COURT QUE LA
 * CONSIGNE DU SERVEUR — et cette consigne n'a qu'un propriétaire.
 *
 * ── Le fait mesuré, et pourquoi deux moitiés ────────────────────────────────
 * Au plafond du compte, le flux répond 503 + `Retry-After`. Mais le client ne
 * lit cette consigne que si l'en-tête lui est visible : en origine croisée (le
 * shell natif Capacitor, le mode direct `VITE_USE_SAME_ORIGIN_API=false`), il
 * n'arrive que si `server.py` l'EXPOSE. Sans exposition, `headers.get` rend
 * `null`, et le client revenait à 1 s, 2 s, 4 s… six fois dans la minute —
 * contre un plafond qui ne rend ses places qu'au bout du bail (60 s). Un onglet
 * saturait ainsi son propre plafond et s'y maintenait.
 *
 * D'où les quatre exigences ci-dessous : une consigne serveur écrite UNE fois,
 * lue par les DEUX routes ; un en-tête EXPOSÉ (sinon il n'existe pas pour le
 * JavaScript) ; un plancher client qui ne descend jamais sous cette consigne ;
 * et un plancher réellement CONSOMMÉ par le calcul du délai, pas seulement
 * déclaré.
 */
describe('refus de capacité — le plancher du client suit la consigne du serveur', () => {
  const kojoLive = lire('backend/kojo_live.py');
  const server = lire('backend/server.py');
  const notifications = lire('backend/kojo_routers_notifications.py');
  const messages = lire('backend/kojo_routers_messages.py');
  const lecteur = lire('frontend/src/services/liveStream.js');

  it('la consigne du serveur est écrite UNE seule fois, et les deux routes la lisent', () => {
    const secondes = consigneRefusPython(kojoLive);
    expect(secondes).toBeGreaterThan(0);

    // Les deux routes de flux refusent le même plafond : deux littéraux
    // finiraient par diverger, et le client suivrait celui qu'il a reçu.
    for (const texte of [notifications, messages]) {
      expect(texte).toMatch(/kojo_live\.STREAM_REFUSED_RETRY_AFTER_SECONDS/);
      expect(texte).not.toMatch(/"Retry-After"\s*:\s*"\d+"/);
    }
  });

  it("l'en-tête est EXPOSÉ (un Retry-After non exposé est illisible en origine croisée)", () => {
    const ligne = server.match(/expose_headers\s*=\s*\[([^\]]*)\]/);
    expect(ligne).not.toBeNull();
    expect(ligne[1]).toMatch(/"Retry-After"/);
  });

  it('le plancher du client ne descend pas sous la consigne du serveur', () => {
    const secondes = consigneRefusPython(kojoLive);
    expect(CAPACITY_FLOOR_MS).toBeGreaterThanOrEqual(secondes * 1000);
  });

  it('le plancher reste BORNÉ (un flux ne reste pas muet une heure)', () => {
    expect(CAPACITY_FLOOR_MS).toBeGreaterThan(0);
    expect(CAPACITY_FLOOR_MS).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS);
    expect(MAX_RETRY_AFTER_MS).toBeLessThanOrEqual(120_000);
  });

  it('le plancher est CONSOMMÉ par le calcul du délai, pas seulement déclaré', () => {
    // Une constante exportée mais jamais utilisée passerait tous les cas
    // ci-dessus en ne changeant RIEN au comportement.
    expect(lecteur).toMatch(/const delai = Math\.max\(recul\(\), consigne, delaiAvantRefus\)/);
    expect(lecteur).toMatch(/CAPACITY_FLOOR_MS/);
    expect(lecteur).toMatch(/if \(statutHttp === 503\) refusCapacite \+= 1/);
  });
});
