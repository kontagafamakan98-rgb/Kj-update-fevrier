/**
 * PREUVE de `check-sse-proxy-production.js` — la sonde qui juge la TRAVERSÉE du
 * flux SSE par le proxy servi (Vercel), pas sa lecture par le client.
 *
 * Trois étages, chacun pour une raison différente :
 *
 *   1. l'ANALYSE (`analyserFlux`) : une trame coupée entre deux chunks est le
 *      cas RÉEL d'un proxy qui découpe où il veut — un analyseur qui lit chunk
 *      par chunk fabriquerait des trames fantômes, donc un faux vert ;
 *   2. les RÈGLES (`budgetDuPremierEvenement`, `jugeDuTransfert`) : pures, donc
 *      éprouvables sans réseau et muables — c'est la ligne du verdict « premier
 *      événement tardif » que le harnais neutralise, et cette preuve doit
 *      rougir quand il le fait ;
 *   3. la MESURE (`runSseProxyProbe`) contre DEUX proxies locaux réels : un qui
 *      relaie au fil de l'eau, un qui TAMPONNE. Sans la seconde moitié, la
 *      sonde pourrait être verte sur un tampon et personne ne le saurait — or
 *      c'est exactement le défaut qu'elle existe pour voir.
 *
 * Aucun réseau externe, aucun compte : l'authentification est un POST local qui
 * rend un jeton bidon, et le flux est écrit par un serveur `node:http` du test.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BATTEMENT_DEFAUT_MS,
  FAMILLE,
  FENETRE_CLIENT_MS,
  MARQUE_PREMISSE,
  TITRE_ERREUR,
  analyserFlux,
  budgetDuPremierEvenement,
  jugeDuTransfert,
  main,
  runSseProxyProbe,
} from '../check-sse-proxy-production.js';
import {
  BATTEMENT_SERVEUR_MS,
  SILENCE_TIMEOUT_MS,
} from '../../src/config/flux-temps-reel.js';

/* ─────────────────────── 1. l'analyse des trames ────────────────────────── */

describe('analyserFlux — ce que le client aurait réellement reçu', () => {
  it('relève une trame dont les octets sont coupés entre deux chunks', () => {
    const analyse = analyserFlux({
      consigne: [
        { aMs: 10, texte: 'event: ready\nda' },
        { aMs: 14, texte: 'ta: {"unread_count":0}\n\n' },
      ],
    });
    // L'instant est celui de la trame COMPLÈTE (14) : le client n'émet rien
    // tant que le bloc n'est pas entier, donc dater le premier octet serait
    // croire reçu ce que l'utilisateur n'a pas encore.
    expect(analyse.evenements).toEqual([
      { type: 'ready', data: '{"unread_count":0}', aMs: 14 },
    ]);
    expect(analyse.battements).toEqual([]);
  });

  it('relève les commentaires comme battements, jamais comme événements', () => {
    const analyse = analyserFlux({
      consigne: [
        { aMs: 0, texte: 'event: ready\ndata: {}\n\n' },
        { aMs: 20000, texte: ': keepalive\n\n' },
      ],
    });
    expect(analyse.evenements).toHaveLength(1);
    expect(analyse.battements).toEqual([{ aMs: 20000 }]);
  });

  it('n’invente pas d’événement à partir d’un tampon non terminé', () => {
    const analyse = analyserFlux({
      consigne: [{ aMs: 5, texte: 'event: ready\ndata: {"unread_count":0}' }],
    });
    expect(analyse.evenements).toEqual([]);
    expect(analyse.trames).toBe(0);
  });

  it('accepte les fins de ligne CRLF et les data multilignes', () => {
    const analyse = analyserFlux({
      consigne: [{ aMs: 7, texte: 'event: notification\r\ndata: a\r\ndata: b\r\n\r\n' }],
    });
    expect(analyse.evenements).toEqual([{ type: 'notification', data: 'a\nb', aMs: 7 }]);
  });
});

/* ───────────────────── 2. le budget DÉRIVÉ du contrôle ──────────────────── */

describe('budgetDuPremierEvenement — un budget dérivé, jamais choisi au hasard', () => {
  it('dérive le budget du contrôle mesuré dans le même passage', () => {
    const budget = budgetDuPremierEvenement({ controleMs: 300 });
    expect(budget).toEqual({ budgetMs: 1800, derive: true, controleMs: 300 });
  });

  it('plancher : un contrôle très rapide ne rend pas le budget plus court que le réseau', () => {
    expect(budgetDuPremierEvenement({ controleMs: 10 }).budgetMs).toBe(1500);
  });

  it('plafond : un contrôle lent ne rend pas la sonde plus tolérante que le client', () => {
    const budget = budgetDuPremierEvenement({ controleMs: 5000 });
    expect(budget.budgetMs).toBe(8000);
    expect(budget.budgetMs).toBeLessThan(SILENCE_TIMEOUT_MS);
  });

  it('la sonde lit la fenêtre du CLIENT et le battement du SERVEUR, sans les recopier', () => {
    // Deux copies d'un même délai divergent au premier correctif : la sonde
    // aurait alors jugé « à temps » ce que le client avait déjà déclaré muet.
    expect(FENETRE_CLIENT_MS).toBe(SILENCE_TIMEOUT_MS);
    expect(BATTEMENT_DEFAUT_MS).toBe(BATTEMENT_SERVEUR_MS);
    expect(FENETRE_CLIENT_MS).toBeGreaterThan(BATTEMENT_DEFAUT_MS);
  });

  it('sans contrôle, le plafond décide et la dérivation est DITE', () => {
    const budget = budgetDuPremierEvenement({ controleMs: null });
    expect(budget.derive).toBe(false);
    expect(budget.budgetMs).toBe(8000);
  });
});

/* ───────────────────────────── 3. les verdicts ──────────────────────────── */

const analyse = (evenements, battements) => ({ evenements, battements, trames: 0 });

describe('jugeDuTransfert — le flux traverse, ou il est retenu', () => {
  const entetesFlux = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' };

  it('vert : le premier événement à temps, le battement APRÈS lui', () => {
    const verdict = jugeDuTransfert({
      analyse: analyse([{ type: 'ready', data: '{}', aMs: 80 }], [{ aMs: 20080 }]),
      budgetMs: 1800,
      battementMs: 20000,
      statut: 200,
      entetes: entetesFlux,
      dureeMs: 20100,
    });
    expect(verdict.refuse).toEqual([]);
    expect(verdict.verdicts.every((v) => v.ok)).toBe(true);
  });

  it('rougit quand le premier événement dépasse le budget, en nommant le budget', () => {
    const verdict = jugeDuTransfert({
      analyse: analyse([{ type: 'ready', data: '{}', aMs: 9000 }], [{ aMs: 29000 }]),
      budgetMs: 4000,
      battementMs: 20000,
      statut: 200,
      entetes: entetesFlux,
      dureeMs: 29000,
    });
    expect(verdict.refuse.join(' ')).toContain('au-delà du budget de 4000 ms');
  });

  it('rougit sur un tampon : les deux trames livrées dans le même vidage', () => {
    const verdict = jugeDuTransfert({
      analyse: analyse([{ type: 'ready', data: '{}', aMs: 200 }], [{ aMs: 210 }]),
      budgetMs: 4000,
      battementMs: 20000,
      statut: 200,
      entetes: entetesFlux,
      dureeMs: 220,
    });
    expect(verdict.refuse.join(' ')).toContain('même vidage');
  });

  it('ne rougit PAS quand la machine déployée bat plus vite que le battement supposé', () => {
    // Le seuil du « même vidage » vaut une seconde au plus, pas la moitié du
    // battement SUPPOSÉ : une production qui bat toutes les 2,5 s (surcharge
    // d'environnement) est un flux sain, et la confondre avec un tampon ferait
    // rougir une sonde juste — le défaut qu'on corrige ailleurs dans le dépôt.
    const verdict = jugeDuTransfert({
      analyse: analyse([{ type: 'ready', data: '{}', aMs: 40 }], [{ aMs: 2540 }]),
      budgetMs: 4000,
      battementMs: 20000,
      statut: 200,
      entetes: entetesFlux,
      dureeMs: 2600,
    });
    expect(verdict.refuse).toEqual([]);
  });

  it('rougit quand aucun battement n’arrive : silence = tampon ou flux mort', () => {
    const verdict = jugeDuTransfert({
      analyse: analyse([{ type: 'ready', data: '{}', aMs: 40 }], []),
      budgetMs: 4000,
      battementMs: 20000,
      statut: 200,
      entetes: entetesFlux,
      dureeMs: 35000,
    });
    expect(verdict.refuse.join(' ')).toContain('aucun battement de cœur');
  });

  it('rougit sur une réponse qui n’est pas un flux', () => {
    const verdict = jugeDuTransfert({
      analyse: analyse([], []),
      budgetMs: 4000,
      statut: 503,
      entetes: { 'content-type': 'application/json' },
      dureeMs: 20,
    });
    expect(verdict.refuse.join(' ')).toContain('HTTP 503');
  });

  it('rougit sur une compression : un intermédiaire qui recompresse lit tout', () => {
    const verdict = jugeDuTransfert({
      analyse: analyse([{ type: 'ready', data: '{}', aMs: 30 }], [{ aMs: 20030 }]),
      budgetMs: 4000,
      battementMs: 20000,
      statut: 200,
      entetes: { ...entetesFlux, 'content-encoding': 'gzip' },
      dureeMs: 20100,
    });
    expect(verdict.refuse.join(' ')).toContain('content-encoding « gzip »');
  });

  it('rougit sur un flux qui n’a rien rendu', () => {
    const verdict = jugeDuTransfert({
      analyse: analyse([], []),
      budgetMs: 4000,
      statut: 200,
      entetes: entetesFlux,
      dureeMs: 8000,
      termine: true,
    });
    expect(verdict.refuse.join(' ')).toContain('s’est fermé');
  });
});

/* ─────────── 4. la prémisse : aucun compte, donc aucun verdict ──────────── */

describe('runSseProxyProbe — une prémisse ne se confond pas avec un rouge', () => {
  it('refuse de conclure sans compte CI, en nommant sa famille et le titre publié', async () => {
    const resultat = await runSseProxyProbe({
      base: 'https://kojo-sse.test',
      email: '',
      password: '',
      quiet: true,
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.premisse).toBe(true);
    expect(resultat.attempts).toBe(0);
    const message = resultat.errors[0];
    expect(message).toContain(FAMILLE);
    expect(message).toContain(MARQUE_PREMISSE);
    expect(message).toContain('LHCI_CI_EMAIL');
    // Cette sonde ne publie qu'un titre : le refus du flux, jamais celui d'une
    // autre sonde.
    expect(TITRE_ERREUR).toMatch(/flux sse/i);
  });

  // Ce dépôt fournit le compte sous `LHCI_TEST_*` ; un compte CI dédié se
  // déclarerait sous `LHCI_CI_*`. Ne lire que le second nom rendait une prémisse
  // « compte absent » ALORS QUE le compte existait : la sonde aurait été rouge
  // chaque jour sans jamais juger le flux, et personne n'aurait su que la
  // traversée du proxy n'était plus mesurée.
  it('lit le compte fourni sous LHCI_TEST_*, et juge au lieu de refuser l’absence', async () => {
    const avant = {
      ciEmail: process.env.LHCI_CI_EMAIL,
      ciPassword: process.env.LHCI_CI_PASSWORD,
      testEmail: process.env.LHCI_TEST_EMAIL,
      testPassword: process.env.LHCI_TEST_PASSWORD,
    };
    delete process.env.LHCI_CI_EMAIL;
    delete process.env.LHCI_CI_PASSWORD;
    process.env.LHCI_TEST_EMAIL = 'sonde@kojo.test';
    process.env.LHCI_TEST_PASSWORD = 'mot-de-passe-sonde';
    // Un port FERMÉ : la connexion échoue tout de suite, sans réseau ni attente.
    const port = await portFerme();
    try {
      const resultat = await runSseProxyProbe({
        base: `http://127.0.0.1:${port}`,
        tentatives: 1,
        quiet: true,
      });
      const message = resultat.errors.join(' ');
      // Le compte a été LU : le refus porte sur la connexion, pas sur les
      // variables. C'est la distinction qui compte — un refus de prémisse pour
      // un compte présent est un mensonge sur l'état du dépôt.
      expect(message).not.toMatch(/absent\(s\)/);
      expect(message).toContain(MARQUE_PREMISSE);
      expect(message).toContain('connexion impossible');
    } finally {
      for (const [cle, valeur] of [
        ['LHCI_CI_EMAIL', avant.ciEmail],
        ['LHCI_CI_PASSWORD', avant.ciPassword],
        ['LHCI_TEST_EMAIL', avant.testEmail],
        ['LHCI_TEST_PASSWORD', avant.testPassword],
      ]) {
        if (valeur === undefined) delete process.env[cle];
        else process.env[cle] = valeur;
      }
    }
  });

  // Le nom d'un secret est écrit DEUX fois : dans la sonde (qui le lit) et dans
  // le workflow (qui le transmet). Une divergence ne casse rien — l'un des deux
  // vaut `undefined`, la sonde rend une prémisse « absent » —, donc rien ne la
  // verrait sans ce cas.
  it('transmet, dans le workflow, chaque nom de compte que la sonde lit', () => {
    // La racine se résout depuis CE fichier (jamais depuis le cwd, que le
    // lanceur choisit) : sous vitest, `import.meta.url` n'est pas toujours un
    // `file:` — `fileURLToPath` refuse une autre forme au lieu de deviner.
    const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const sonde = readFileSync(
      path.join(racine, 'frontend/scripts/check-sse-proxy-production.js'), 'utf8',
    );
    const workflow = readFileSync(
      path.join(racine, '.github/workflows/sse-proxy-production-probe.yml'), 'utf8',
    );
    const noms = [...new Set(
      [...sonde.matchAll(/process\.env\.(LHCI_[A-Z_]+)/g)].map((trouve) => trouve[1]),
    )].sort();
    // Plancher de lecture : un fichier illisible ou une expression réécrite
    // rendrait la liste vide, et une boucle vide serait verte sans rien juger.
    expect(noms.length).toBeGreaterThanOrEqual(2);
    expect(noms).toEqual(expect.arrayContaining(['LHCI_CI_EMAIL', 'LHCI_TEST_EMAIL']));
    for (const nom of noms) {
      // La forme est assemblée par concaténation : `${{` dans un gabarit serait
      // lu comme une interpolation par le transformeur, pas comme le texte Vercel
      // attendu.
      const attendu = `${nom}: ` + '${{ secrets.' + nom + ' }}';
      expect(workflow, `${nom} est lu par la sonde mais absent du workflow`).toContain(attendu);
    }
  });
});

/** Un port que personne n’écoute : la connexion est refusée sans attente. */
function portFerme() {
  return new Promise((resolve, reject) => {
    const serveur = http.createServer();
    serveur.on('error', reject);
    serveur.listen(0, '127.0.0.1', () => {
      const { port } = serveur.address();
      serveur.close(() => resolve(port));
    });
  });
}

/* ──────── 5. la mesure, contre deux proxies locaux RÉELS ────────────────── */

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const JETON = 'jeton-bidon-de-test-trahit-par-une-fuite';

/** Le serveur qui JOUE le serveur applicatif : `ready` tout de suite, battement après. */
function demarrerOrigine({ delaiBattementMs }) {
  const serveur = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/api/notifications/stream')) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('event: ready\ndata: {"unread_count":0}\n\n');
    await attendre(delaiBattementMs);
    res.write(': keepalive\n\n');
    await attendre(50);
    res.end();
  });
  return new Promise((resolve) => {
    serveur.listen(0, '127.0.0.1', () => resolve({ serveur, port: serveur.address().port }));
  });
}

/**
 * Le proxy qui RELAIE au fil de l'eau, et celui qui TAMPONNE — deux variantes
 * du même intermédiaire, pour que la sonde soit jugée sur la différence.
 */
function demarrerProxy({ portOrigine, tampon }) {
  const serveur = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/auth/login')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: JETON }));
      return;
    }
    if (!req.url.startsWith('/api/notifications/stream')) {
      res.writeHead(404).end();
      return;
    }
    const amont = await fetch(`http://127.0.0.1:${portOrigine}/api/notifications/stream`, {
      headers: { accept: 'text/event-stream' },
    });
    res.writeHead(amont.status, {
      'content-type': amont.headers.get('content-type') || 'text/event-stream',
      'cache-control': 'no-cache',
    });
    const lecteur = amont.body.getReader();
    const morceaux = [];
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      if (tampon) morceaux.push(value);
      else res.write(value);
    }
    if (tampon) {
      // Le défaut mesuré : rien ne sort avant la fin de la réponse amont.
      for (const morceau of morceaux) res.write(morceau);
    }
    res.end();
  });
  return new Promise((resolve) => {
    serveur.listen(0, '127.0.0.1', () => resolve({ serveur, port: serveur.address().port }));
  });
}

describe('runSseProxyProbe — la traversée, mesurée bout en bout', () => {
  let origine;
  let relayant;
  let tamponnant;
  const ACTIFS = [];

  beforeAll(async () => {
    origine = await demarrerOrigine({ delaiBattementMs: 250 });
    ACTIFS.push(origine.serveur);
    relayant = await demarrerProxy({ portOrigine: origine.port, tampon: false });
    ACTIFS.push(relayant.serveur);
    tamponnant = await demarrerProxy({ portOrigine: origine.port, tampon: true });
    ACTIFS.push(tamponnant.serveur);
  });

  afterAll(async () => {
    for (const serveur of ACTIFS) {
      await new Promise((resolve) => serveur.close(resolve));
    }
  });

  it('vert sur un proxy qui relaie : premier événement immédiat, battement APRÈS lui', async () => {
    const resultat = await runSseProxyProbe({
      base: `http://127.0.0.1:${relayant.port}`,
      email: 'ci@example.test',
      password: 'mot-de-passe-de-test',
      battementMs: 200,
      budgetMs: 1000,
      tentatives: 1,
      quiet: true,
    });

    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    const [mesure] = resultat.mesures;
    expect(mesure.statut).toBe(200);
    expect(mesure.premierType).toBe('ready');
    expect(mesure.premierEvenementMs).toBeLessThan(1000);
    // Le battement est écrit 250 ms après `ready` par le serveur : un relais
    // fidèle le rend après lui, pas dans le même vidage.
    expect(mesure.ecartMs).toBeGreaterThanOrEqual(100);
    expect(mesure.encodage).toBe('identity');
    // Aucune valeur de jeton ne sort de la sonde.
    expect(JSON.stringify(resultat.mesures)).not.toContain(JETON);
  });

  it('rougit sur un proxy qui tamponne : le premier événement est trop tard', async () => {
    const resultat = await runSseProxyProbe({
      base: `http://127.0.0.1:${tamponnant.port}`,
      email: 'ci@example.test',
      password: 'mot-de-passe-de-test',
      battementMs: 200,
      budgetMs: 120,
      tentatives: 1,
      quiet: true,
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.premisse).toBe(false);
    expect(resultat.errors.join(' ')).toContain('au-delà du budget de 120 ms');
    // Et le second fait est là aussi : les deux trames sont arrivées ensemble.
    expect(resultat.errors.join(' ')).toContain('même vidage');
  });
});

describe('la ligne de commande — un code par issue, jugé sans réseau', () => {
  /**
   * Le faux-vert que cette section empêche : un code de sortie ANNONCÉ mais
   * jamais mesuré. Les trois issues de cette sonde étaient déjà distinctes
   * (0/1/2), mais `main` sortait par `process.exit` en lisant `process.argv` :
   * la seule preuve possible était de lancer un processus, donc la promesse
   * n'était tenue par aucun cas. Ici, la sonde est INJECTÉE.
   */
  it('sort en 0 quand le flux traverse, en transmettant la base jugée', async () => {
    const vues = [];
    const code = await main(['--base', 'https://exemple.test'], {
      run: async (options) => {
        vues.push(options);
        return { ok: true, premisse: false, attempts: 1, errors: [], mesures: [] };
      },
      error: () => {},
    });
    expect(code).toBe(0);
    expect(vues).toHaveLength(1);
    expect(vues[0].base).toBe('https://exemple.test');
  });

  it('sort en 2 pour une PRÉMISSE, et dit qu’aucun verdict n’est rendu', async () => {
    const erreurs = [];
    const code = await main(['--base', 'https://exemple.test'], {
      run: async () => ({
        ok: false,
        premisse: true,
        attempts: 0,
        errors: [`${MARQUE_PREMISSE} : compte CI absent`],
        mesures: [],
      }),
      error: (message) => erreurs.push(String(message)),
    });
    expect(code).toBe(2);
    const lignes = erreurs.join('\n');
    expect(lignes).toContain(MARQUE_PREMISSE);
    expect(lignes).toContain(TITRE_ERREUR);
    expect(lignes).toContain('Aucun verdict rendu');
  });

  it('sort en 1 pour un refus du FLUX — le code dit que la sonde a jugé', async () => {
    const erreurs = [];
    const code = await main(['--base', 'https://exemple.test'], {
      run: async () => ({
        ok: false,
        premisse: false,
        attempts: 2,
        errors: [`${FAMILLE} : premier événement au-delà du budget`],
        mesures: [],
      }),
      error: (message) => erreurs.push(String(message)),
    });
    expect(code).toBe(1);
    // Un refus ne porte PAS le discours de prémisse : les deux codes ne se
    // confondent ni à la lecture ni dans le verdict du job.
    expect(erreurs.join('\n')).not.toContain('Aucun verdict rendu');
  });
});
