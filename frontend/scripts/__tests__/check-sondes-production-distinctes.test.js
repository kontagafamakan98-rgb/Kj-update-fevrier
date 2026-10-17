/**
 * GARDE DE DISTINCTION — DEUX refus de production qui ne doivent JAMAIS se
 * confondre.
 *
 * Deux sondes ouvrent le MÊME formulaire servi et rechargent la MÊME page :
 *
 *   • `check-token-exposure-production.js` — un JETON est lisible ou envoyé sur
 *     le domaine web servi (`::error title=Exposition jeton production::`) ;
 *   • `check-session-reload-production.js` — la SESSION ne survit pas au
 *     rechargement, ou l'application ne la restaure pas
 *     (`::error title=Session production::`).
 *
 * Leurs corrections n'ont rien à voir — le stockage et sa purge d'un côté, les
 * attributs du cookie ou la garde d'amorçage de l'autre — donc un rouge ambigu
 * envoie corriger le mauvais fichier. C'est ce que cette garde refuse, en lisant
 * les DEUX sondes ET leurs DEUX workflows :
 *
 *   1. deux FAMILLES distinctes, écrites dans les messages eux-mêmes (pas
 *      seulement dans le titre de l'annotation) : le journal de CI se relit seul ;
 *   2. deux titres d'annotation distincts, chacun publié par sa seule sonde, et
 *      chacun NOMMÉ par l'autre (le renvoi de famille, écrit des deux côtés) ;
 *   3. deux workflows distincts (nom de workflow et nom de job) qui lancent
 *      chacun SA sonde : un rouge de l'une ne peut pas se cacher derrière l'autre ;
 *   4. la prémisse PARTAGÉE (le compte CI manque) reste lisible : chaque sonde la
 *      prononce avec sa famille et le titre de l'autre.
 *
 * Ce qui vit dans les fichiers des sondes — le verdict lui-même : « un
 * rechargement non restauré ne rougit PAS la sonde d'exposition » et « un jeton
 * rangé côté web ne rougit PAS la sonde de rechargement » — est prouvé là où le
 * parcours est jouable (`check-token-exposure-production.test.js`,
 * `check-session-reload-production.test.js`) ; cette garde-ci juge ce qui se lit
 * dans les fichiers et dans la CI.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
  FAMILLE as FAMILLE_EXPOSITION,
  libelleSonde as libelleExposition,
  runTokenExposureProbe,
} from '../check-token-exposure-production.js';
import {
  FAMILLE as FAMILLE_SESSION,
  libelleSonde as libelleSession,
  runSessionReloadProbe,
} from '../check-session-reload-production.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SONDES = {
  exposition: 'frontend/scripts/check-token-exposure-production.js',
  session: 'frontend/scripts/check-session-reload-production.js',
};
const WORKFLOWS = {
  exposition: '.github/workflows/token-exposure-production-probe.yml',
  session: '.github/workflows/session-reload-production-probe.yml',
};
// Planchers de LECTURE : des tailles en dessous desquelles le fichier lu n'est
// pas celui que cette garde croit juger (fichier vidé, chemin déplacé, lecture
// qui rend autre chose). Mesurées le 16/10/2026 : 45 327 et 29 330 caractères.
const PLANCHERS = {
  [SONDES.exposition]: 20000,
  [SONDES.session]: 15000,
  [WORKFLOWS.exposition]: 2000,
  [WORKFLOWS.session]: 2000,
};

const BASE = 'https://kojo-distinction.test';
const API = 'https://api.kojo-distinction.test';

/** Lit un fichier du dépôt, en brut : aucun encodage implicite, aucun repli muet. */
const lire = (chemin) => readFileSync(path.join(RACINE, chemin), 'utf8');

const SOURCE_EXPOSITION = lire(SONDES.exposition);
const SOURCE_SESSION = lire(SONDES.session);
const WF_EXPOSITION = lire(WORKFLOWS.exposition);
const WF_SESSION = lire(WORKFLOWS.session);

/**
 * Le titre de la SEULE annotation d'erreur qu'une sonde publie. Exiger qu'il n'y
 * en ait qu'un est le point de la garde : deux titres dans une sonde, et le
 * lecteur ne sait plus quel refus il lit.
 */
const titreDerreur = (source) => {
  const trouves = [...source.matchAll(/console\.error\(`::error title=([^`]+)::/g)].map(
    (trouve) => trouve[1]
  );
  expect(trouves, 'chaque sonde publie UN SEUL titre d’erreur').toHaveLength(1);
  return trouves[0];
};

/** Le nom de workflow publié par le fichier (`name:` de premier niveau). */
const nomWorkflow = (workflow) => {
  const trouve = workflow.match(/^name: (.+)$/m);
  expect(trouve, 'le workflow publie un nom').not.toBeNull();
  return trouve[1].trim();
};

/** Le nom de JOB affiché (indentation de 4 espaces : les étapes sont plus bas). */
const nomJob = (workflow) => {
  const trouve = workflow.match(/^ {4}name: (.+)$/m);
  expect(trouve, 'le workflow publie un nom de job').not.toBeNull();
  return trouve[1].trim();
};

describe('sondes de production — deux refus qui ne se confondent pas', () => {
  it('a bien lu les quatre fichiers qu’elle croit juger', () => {
    // Sans ce plancher, une lecture qui rend un fichier vide (ou un autre
    // fichier) ferait passer toutes les assertions qui suivent pour des preuves.
    for (const [chemin, contenu] of Object.entries({
      [SONDES.exposition]: SOURCE_EXPOSITION,
      [SONDES.session]: SOURCE_SESSION,
      [WORKFLOWS.exposition]: WF_EXPOSITION,
      [WORKFLOWS.session]: WF_SESSION,
    })) {
      expect(contenu.length, `${chemin} : sous son plancher de lecture`).toBeGreaterThan(
        PLANCHERS[chemin]
      );
    }
    // Et chaque sonde déclare bien la famille que la garde lui attribue.
    expect(SOURCE_EXPOSITION).toContain('export const FAMILLE');
    expect(SOURCE_SESSION).toContain('export const FAMILLE');
  });

  it('deux familles distinctes, chacune portée par ses propres messages', () => {
    expect(FAMILLE_EXPOSITION).not.toBe(FAMILLE_SESSION);
    expect(FAMILLE_EXPOSITION).toBe('exposition du jeton');
    expect(FAMILLE_SESSION).toBe('session au rechargement');
    // Le libellé qui préfixe chaque refus nomme SA famille, et pas celle de l'autre :
    // c'est ce qui rend un rouge lisible hors de son workflow.
    expect(libelleExposition(BASE)).toContain(FAMILLE_EXPOSITION);
    expect(libelleExposition(BASE)).not.toContain(FAMILLE_SESSION);
    expect(libelleSession(BASE, API)).toContain(FAMILLE_SESSION);
    expect(libelleSession(BASE, API)).not.toContain(FAMILLE_EXPOSITION);
    // Le libellé de la sonde d'exposition ne porte pas l'API jugée : elle ne juge
    // qu'une surface, la page servie. Celui de la sonde de session la nomme : son
    // verdict dépend de l'origine interrogée.
    expect(libelleExposition(BASE)).not.toContain(API);
    expect(libelleSession(BASE, API)).toContain(API);
  });

  it('deux titres d’annotation distincts, et le renvoi écrit des DEUX côtés', () => {
    const titreExposition = titreDerreur(SOURCE_EXPOSITION);
    const titreSession = titreDerreur(SOURCE_SESSION);

    expect(titreExposition).not.toBe(titreSession);
    expect(titreExposition).toMatch(/exposition/i);
    expect(titreSession).toMatch(/session/i);
    // Chaque sonde NOMME le titre de l'autre : qui lit un rouge sait à quelle
    // famille appartient le fait qu'il ne juge pas.
    expect(SOURCE_EXPOSITION).toContain(`::error title=${titreSession}::`);
    expect(SOURCE_SESSION).toContain(`::error title=${titreExposition}::`);
  });

  it('deux workflows distincts, chacun SA sonde — aucun rouge caché derrière l’autre', () => {
    expect(nomWorkflow(WF_EXPOSITION)).not.toBe(nomWorkflow(WF_SESSION));
    expect(nomJob(WF_EXPOSITION)).not.toBe(nomJob(WF_SESSION));
    // Chaque workflow lance sa sonde…
    expect(WF_EXPOSITION).toContain('scripts/check-token-exposure-production.js');
    expect(WF_SESSION).toContain('scripts/check-session-reload-production.js');
    // …et AUCUN ne lance celle de l'autre : deux jobs, deux faits jugés, deux
    // corrections possibles.
    expect(WF_EXPOSITION).not.toContain('check-session-reload-production.js');
    expect(WF_SESSION).not.toContain('check-token-exposure-production.js');
  });

  it('la prémisse PARTAGÉE reste lisible : même scénario, deux refus différents', async () => {
    // Le cas le plus confondable des deux sondes : le compte CI manque. Aucun
    // navigateur n'est lancé (le refus précède le lancement) — et les deux
    // messages produits doivent dire QUI refuse et à QUI appartient l'autre fait.
    const [exposition, session] = await Promise.all([
      runTokenExposureProbe({ base: BASE, email: '', password: '', attempts: 1, quiet: true }),
      runSessionReloadProbe({ base: BASE, api: API, email: '', password: '', attempts: 1, quiet: true }),
    ]);

    expect(exposition.ok).toBe(false);
    expect(session.ok).toBe(false);
    expect(exposition.attempts).toBe(0);
    expect(session.attempts).toBe(0);
    expect(exposition.errors[0]).not.toBe(session.errors[0]);
    // Chaque refus porte : sa famille, la marque de prémisse, et le titre de
    // l'autre sonde.
    expect(exposition.errors[0]).toContain(libelleExposition(BASE));
    expect(exposition.errors[0]).toContain(`::error title=${titreDerreur(SOURCE_SESSION)}::`);
    expect(session.errors[0]).toContain(libelleSession(BASE, API));
    expect(session.errors[0]).toContain(`::error title=${titreDerreur(SOURCE_EXPOSITION)}::`);
  });
});
