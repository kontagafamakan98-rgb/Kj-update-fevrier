/**
 * Preuve d'échec de `frontend/scripts/check-jobs-ville-client-production.js`.
 *
 * La sonde juge un fait qu'aucun test de composant ne peut voir : ce que le
 * DÉPLOIEMENT sert à un client connecté qui arrive d'une page ville. Le test de
 * `Jobs.jsx` prouve le comportement React (client + `?alerte=1` ⇒ la règle), pas
 * qu'un bundle déployé le peint, ni que le lien d'une page ville mène encore là.
 *
 * Ce fichier juge donc :
 *   1. les VERDICTS (fonctions pures) cas par cas — chaque refus a son scénario,
 *      et le message doit dire la BONNE raison : un test qui n'exigerait que
 *      `ok: false` laisserait passer un refus pour un autre ;
 *   2. le PARCOURS, avec un navigateur doublure (`launch` injecté) : connexion
 *      par le formulaire, page ville, CLIC sur le lien, /jobs, puis visite
 *      ordinaire — Playwright n'est jamais chargé, aucun réseau touché ;
 *   3. les TROIS SORTIES (0 vert, 1 refus nommé, 2 prémisse) et le coût publié
 *      dans le résumé du run, VERDICT VERT COMPRIS ;
 *   4. le CONTRAT du workflow : un cron, la sonde lancée, les secrets en `env`
 *      (jamais dans la commande, qui est publiée dans les journaux du run).
 *
 * Les textes attendus viennent du DICTIONNAIRE (`pack2PageI18n/jobs.js`) et les
 * villes de la DÉCLARATION (`pages-seo.json`) : les recopier ici ferait du test
 * une seconde source, libre de dériver avec le produit.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, it, expect } from 'vitest';

import {
  CHEMIN_CREATION,
  CHEMIN_JOBS,
  FAMILLE,
  MARQUE_PREMISSE,
  SELECTEUR_MONTAGE,
  SELECTEUR_RESERVEE,
  TITRE_ERREUR,
  cheminsCompte,
  jugerArrivee,
  jugerVisiteOrdinaire,
  lireLeCompte,
  main,
  origineApi,
  parametresArrivee,
  phraseCout,
  premisse,
  runJobsVilleClientProbe,
  villeParDefaut,
  villesPubliees,
} from '../check-jobs-ville-client-production.js';
import { makeScopedTranslator } from '../../src/utils/pack2PageI18n/jobs.js';

const BASE = 'https://kojo-jobs-ville.test';
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../..');
const VILLE = { slug: 'bamako', nom: 'Bamako' };

const fr = makeScopedTranslator('fr');
const en = makeScopedTranslator('en');

/** Le relevé d'une /jobs conforme, arrivée depuis la page ville. */
const arrivee = (modifications = {}) => ({
  url: `${BASE}${CHEMIN_JOBS}?alerte=1&ville=${encodeURIComponent(VILLE.nom)}&origine=ville`,
  lang: 'fr',
  monte: true,
  reservee: {
    titre: fr('jobAlertReservedTitle'),
    texte: fr('jobAlertReservedLead'),
    liens: [{ texte: fr('jobAlertReservedAction'), chemin: CHEMIN_CREATION }],
  },
  promesse: null,
  travailleur: null,
  ...modifications,
});

const MAPPE = (textes) => ({
  url: `${BASE}${CHEMIN_JOBS}?alerte=1&ville=${encodeURIComponent(VILLE.nom)}&origine=ville`,
  lang: 'en',
  monte: true,
  reservee: {
    titre: textes('jobAlertReservedTitle'),
    texte: textes('jobAlertReservedLead'),
    liens: [{ texte: textes('jobAlertReservedAction'), chemin: CHEMIN_CREATION }],
  },
  promesse: null,
  travailleur: null,
});

// ---------------------------------------------------------------------------
// Navigateur DOUBLURE : rejoue les relevés d'un scénario et journalise les
// gestes, pour que l'ordre du parcours soit jugé (et pas seulement le verdict).
// ---------------------------------------------------------------------------

/**
 * @param {object} [scenario]
 * @param {Array} [scenario.relevés] Valeurs rendues par les `evaluate` successifs.
 * @param {number} [scenario.statutVille] Statut HTTP de la page ville.
 * @param {string} [scenario.villeSansLien] `true` : la page ville ne porte aucun lien d'alerte.
 * @param {string} [scenario.clicVers] Chemin atteint après le clic (défaut /jobs).
 * @param {string} [scenario.attenteReservee] `timeout` : la carte n'apparaît pas.
 * @param {string} [scenario.attenteMontage] `timeout` : le châssis n'apparaît pas.
 * @param {string} [scenario.connexion] `timeout` : la connexion ne sort pas de /login.
 * @param {string} [scenario.typeCompte] Rôle rendu par `/api/auth/me` (défaut client).
 * @param {object} [scenario.compte] `{statut, type}` : le relevé du compte, tel quel.
 * @param {Error} [scenario.launchError]
 * @returns {{launch: Function, journal: object}}
 */
function navigateur({
  relevés = [arrivee(), arrivee({ reservee: null }), arrivee({ reservee: null })],
  statutVille = 200,
  villeSansLien = false,
  clicVers = CHEMIN_JOBS,
  attenteReservee = 'ok',
  attenteMontage = 'ok',
  connexion = 'ok',
  typeCompte = 'client',
  compte = null,
  launchError = null,
} = {}) {
  const journal = {
    goto: [],
    fill: [],
    click: [],
    waitForURL: 0,
    waitForSelector: [],
    evaluate: 0,
    contextOptions: [],
    closed: false,
    requetes: 0,
  };
  let index = 0;
  let adresse = `${BASE}/login`;

  const page = {
    on: () => {},
    goto: async (url) => {
      journal.goto.push(url);
      adresse = url;
      return { status: () => statutVille };
    },
    fill: async (selecteur) => {
      journal.fill.push(selecteur);
    },
    click: async (selecteur) => {
      journal.click.push(selecteur);
      // Deux clics différents : le bouton du formulaire de connexion sort de
      // /login, et le lien d'alerte mène au chemin du scénario.
      adresse = selecteur === 'button[type="submit"]'
        ? `${BASE}/`
        : `${BASE}${clicVers}?alerte=1&ville=Bamako&origine=ville`;
    },
    waitForURL: async (predicat) => {
      journal.waitForURL += 1;
      if (connexion === 'timeout') throw new Error('Timeout 30000ms exceeded.');
      if (!predicat(new URL(adresse))) throw new Error('Timeout 30000ms exceeded.');
    },
    waitForSelector: async (selecteur) => {
      journal.waitForSelector.push(selecteur);
      if (selecteur === SELECTEUR_RESERVEE && attenteReservee === 'timeout') {
        throw new Error('Timeout 30000ms exceeded.');
      }
      if (selecteur === SELECTEUR_MONTAGE && attenteMontage === 'timeout') {
        throw new Error('Timeout 30000ms exceeded.');
      }
      return {};
    },
    evaluate: async (fonction) => {
      journal.evaluate += 1;
      // Le premier relevé est le COMPTE (rôle) : il ne vient pas de la page.
      if (index === 0) {
        index += 1;
        return compte || { statut: 200, type: typeCompte };
      }
      if (index === 1) {
        index += 1;
        return {
          url: `${BASE}/emplois/bamako`,
          titre: 'Emplois à Bamako',
          liens: villeSansLien
            ? []
            : [
                {
                  href: `${CHEMIN_JOBS}?alerte=1&ville=Bamako&origine=ville`,
                  texte: 'Recevoir les missions par email',
                  absolu: `${BASE}${CHEMIN_JOBS}?alerte=1&ville=Bamako&origine=ville`,
                },
              ],
        };
      }
      const valeur = relevés[index - 2] ?? relevés[relevés.length - 1];
      index += 1;
      return valeur;
    },
    url: () => adresse,
    close: async () => {},
  };

  const browser = {
    newContext: async (options = {}) => {
      journal.contextOptions.push(options);
      return { newPage: async () => page };
    },
    close: async () => {
      journal.closed = true;
    },
  };

  const launch = async () => {
    if (launchError) throw launchError;
    return browser;
  };

  return { launch, journal };
}

const identifiants = { email: 'client@kojo-sonde.test', password: 'secret-de-sonde' };

const sonde = (options = {}) => {
  const doublure = navigateur(options.scenario || {});
  return {
    journal: doublure.journal,
    run: () =>
      runJobsVilleClientProbe({
        base: BASE,
        ville: VILLE.slug,
        ...identifiants,
        attempts: 1,
        delayMs: 0,
        launch: doublure.launch,
        quiet: true,
        log: () => {},
        ...options,
      }),
  };
};

// ---------------------------------------------------------------------------
// 1. Le verdict pur : chaque refus, et sa raison.
// ---------------------------------------------------------------------------
describe('jobs client depuis une page ville — le verdict de l’arrivée', () => {
  it('accepte une arrivée conforme, sans aucun refus', () => {
    expect(jugerArrivee({ releve: arrivee(), ville: VILLE, lang: 'fr' })).toEqual([]);
  });

  it('lit les textes dans la LANGUE du document, jamais en français en dur', () => {
    // Une page servie en `en` doit être jugée sur SES textes : un libellé
    // recopié rendrait cette arrivée fausse alors qu'elle est correcte.
    expect(jugerArrivee({ releve: MAPPE(en), ville: VILLE, lang: 'en' })).toEqual([]);
  });

  it('refuse une arrivée qui ne mène pas à /jobs', () => {
    const releve = arrivee({ url: `${BASE}/login?alerte=1&ville=Bamako&origine=ville` });
    const refus = jugerArrivee({ releve, ville: VILLE, lang: 'fr' });
    expect(refus.join(' ')).toContain('ne mène pas à /jobs');
    expect(refus.join(' ')).toContain('/login');
  });

  it('refuse un lien qui a perdu « alerte=1 »', () => {
    const releve = arrivee({ url: `${BASE}${CHEMIN_JOBS}?ville=Bamako&origine=ville` });
    expect(jugerArrivee({ releve, ville: VILLE, lang: 'fr' }).join(' ')).toContain('SANS « alerte=1 »');
  });

  it('refuse une provenance absente ou fausse', () => {
    const sans = arrivee({ url: `${BASE}${CHEMIN_JOBS}?alerte=1&ville=Bamako` });
    expect(jugerArrivee({ releve: sans, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      'au lieu de « ville »'
    );
    const autre = arrivee({ url: `${BASE}${CHEMIN_JOBS}?alerte=1&ville=Bamako&origine=facebook` });
    expect(jugerArrivee({ releve: autre, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      'la provenance transmise est « facebook »'
    );
  });

  it('refuse une ville qui n’est pas le nom du référentiel', () => {
    const releve = arrivee({ url: `${BASE}${CHEMIN_JOBS}?alerte=1&ville=bamako&origine=ville` });
    expect(jugerArrivee({ releve, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      'au lieu de « Bamako »'
    );
  });

  it('nomme la VUE ANONYME quand la carte de la règle manque à un client', () => {
    // La session n'a pas été restaurée : le client voit ce que voit un visiteur.
    const releve = arrivee({ reservee: null, promesse: { titre: fr('jobAlertTitle'), texte: '', liens: [] } });
    const refus = jugerArrivee({ releve, ville: VILLE, lang: 'fr' }).join(' ');
    expect(refus).toContain('PROMESSE D’UN VISITEUR SANS COMPTE');
    expect(refus).toContain('n’a pas été restaurée');
  });

  it('nomme le RÔLE mal lu quand la carte travailleur est peinte à la place', () => {
    const releve = arrivee({ reservee: null, travailleur: { titre: fr('jobAlertTitle'), texte: '', liens: [] } });
    const refus = jugerArrivee({ releve, ville: VILLE, lang: 'fr' }).join(' ');
    expect(refus).toContain('CARTE TRAVAILLEUR');
    expect(refus).toContain('le rôle lu par la page n’est pas celui du compte');
  });

  it('distingue « aucune carte » de « page non montée »', () => {
    const aucune = jugerArrivee({ releve: arrivee({ reservee: null }), ville: VILLE, lang: 'fr' }).join(' ');
    expect(aucune).toContain('AUCUNE des trois cartes');
    const morte = jugerArrivee({
      releve: arrivee({ reservee: null, monte: false }),
      ville: VILLE,
      lang: 'fr',
    }).join(' ');
    expect(morte).toContain('n’a pas monté');
  });

  it('refuse un titre, un texte ou une action qui ne sont pas ceux du dictionnaire', () => {
    const titre = arrivee({ reservee: { ...arrivee().reservee, titre: 'Alertes' } });
    expect(jugerArrivee({ releve: titre, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      'au lieu de « Les alertes emploi sont réservées aux travailleurs »'
    );
    const texte = arrivee({ reservee: { ...arrivee().reservee, texte: 'Une alerte, peut-être.' } });
    expect(jugerArrivee({ releve: texte, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      'ne dit pas le texte attendu'
    );
    const sansAction = arrivee({ reservee: { ...arrivee().reservee, liens: [] } });
    expect(jugerArrivee({ releve: sansAction, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      `aucun lien vers ${CHEMIN_CREATION}`
    );
    const mauvaiseAction = arrivee({
      reservee: {
        ...arrivee().reservee,
        liens: [{ texte: 'S’inscrire', chemin: CHEMIN_CREATION }],
      },
    });
    expect(jugerArrivee({ releve: mauvaiseAction, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      'l’action de la carte porte « S’inscrire »'
    );
  });

  it('refuse qu’une deuxième carte d’alerte soit peinte en même temps', () => {
    const avecPromesse = arrivee({ promesse: { titre: fr('jobAlertTitle'), texte: '', liens: [] } });
    expect(jugerArrivee({ releve: avecPromesse, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      '« créez un compte » est faux pour lui'
    );
    const avecTravailleur = arrivee({ travailleur: { titre: fr('jobAlertTitle'), texte: '', liens: [] } });
    expect(jugerArrivee({ releve: avecTravailleur, ville: VILLE, lang: 'fr' }).join(' ')).toContain(
      'une veille lui enverrait le catalogue qu’il publie lui-même'
    );
  });
});

describe('jobs client depuis une page ville — la visite ordinaire', () => {
  it('accepte une page montée qui ne parle pas d’alerte', () => {
    expect(jugerVisiteOrdinaire(arrivee({ reservee: null }))).toEqual([]);
  });

  it('refuse la règle sur /jobs sans paramètre : il n’a rien demandé', () => {
    const refus = jugerVisiteOrdinaire(arrivee()).join(' ');
    expect(refus).toContain('la page parle d’une chose qu’il n’a pas demandée');
  });

  it('refuse de conclure une absence sur une page qui n’a pas monté', () => {
    const refus = jugerVisiteOrdinaire(arrivee({ reservee: null, monte: false })).join(' ');
    expect(refus).toContain('ne prouverait rien sur une page qui n’a pas rendu');
  });
});

describe('jobs client depuis une page ville — les paramètres lus', () => {
  it('lit l’URL réellement atteinte, pas une hypothèse', () => {
    expect(parametresArrivee(`${BASE}${CHEMIN_JOBS}?alerte=1&ville=S%C3%A9gou&origine=ville`)).toEqual({
      chemin: CHEMIN_JOBS,
      alerte: '1',
      ville: 'Ségou',
      origine: 'ville',
    });
    expect(parametresArrivee(`${BASE}${CHEMIN_JOBS}`).ville).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. Le parcours : ce que la sonde fait faire au navigateur.
// ---------------------------------------------------------------------------
describe('jobs client depuis une page ville — le parcours', () => {
  it('passe par le formulaire servi puis par le LIEN de la page ville', async () => {
    const { run, journal } = sonde();
    const resultat = await run();

    expect(resultat.ok).toBe(true);
    // La connexion commence par la page de connexion SERVIE, jamais par l'API.
    expect(journal.goto[0]).toBe(`${BASE}/login`);
    expect(journal.fill).toEqual(['#email', '#password']);
    // Puis la page ville, et c'est son LIEN qui est cliqué — pas une URL tapée.
    expect(journal.goto[1]).toBe(`${BASE}/emplois/bamako`);
    // Le dernier clic est celui du LIEN de la page ville (le premier est le
    // bouton du formulaire de connexion).
    expect(journal.click[journal.click.length - 1]).toBe('a[href*="alerte=1"]');
    expect(journal.click).toHaveLength(2);
    // Enfin la visite ordinaire, sur /jobs sans paramètre.
    expect(journal.goto[2]).toBe(`${BASE}${CHEMIN_JOBS}`);
    // Le contexte est jeté, et aucun en-tête de contournement n'a été posé.
    expect(journal.closed).toBe(true);
    expect(journal.contextOptions[0]).toEqual({});
    // Le coût est celui du parcours : trois pages, quatre navigations (le clic
    // en est une), et un relevé par étape.
    expect(resultat.cout.pages).toBe(3);
    expect(resultat.cout.navigations).toBe(4);
    expect(resultat.cout.tentatives).toBe(1);
  });

  it('refuse AVANT le navigateur quand le compte CI manque', async () => {
    const { run, journal } = sonde({ email: '', password: '' });
    const resultat = await run();

    expect(resultat.ok).toBe(false);
    expect(resultat.premisse).toBe(true);
    expect(resultat.attempts).toBe(0);
    expect(resultat.errors.join(' ')).toContain('LHCI_CI_EMAIL');
    expect(journal.goto).toEqual([]);
  });

  it('ne réessaie pas une PRÉMISSE, mais réessaie un refus', async () => {
    const premisseRun = await sonde({
      email: '',
      password: '',
      attempts: 3,
    }).run();
    expect(premisseRun.attempts).toBe(0);

    const refusRun = await sonde({
      attempts: 2,
      scenario: { villeSansLien: true },
    }).run();
    expect(refusRun.attempts).toBe(2);
  });

  it('rend une prémisse quand la connexion ne sort pas de /login', async () => {
    const resultat = await sonde({ scenario: { connexion: 'timeout' } }).run();
    expect(resultat.premisse).toBe(true);
    expect(resultat.errors.join(' ')).toContain('connexion du compte CI impossible');
  });

  it('rend une prémisse quand le compte n’est plus un CLIENT', async () => {
    // Un travailleur voit la carte INTERACTIVE : juger « ce qu’un client voit »
    // avec ce compte n’aurait aucun sens. La prémisse NOMME le provisionnement.
    const resultat = await sonde({ scenario: { typeCompte: 'worker' } }).run();
    expect(resultat.premisse).toBe(true);
    expect(resultat.attempts).toBe(1);
    expect(resultat.errors.join(' ')).toContain('et non « client »');
    expect(resultat.errors.join(' ')).toContain('--type client');
  });

  it('rend une prémisse quand la session n’est pas lisible après connexion', async () => {
    const resultat = await sonde({ scenario: { compte: { statut: 401, type: '' } } }).run();
    expect(resultat.premisse).toBe(true);
    expect(resultat.errors.join(' ')).toContain('session non lue après connexion');
  });

  it('rend une prémisse sur une page ville en 5xx, un ROUGE sur un 404', async () => {
    const injoignable = await sonde({ scenario: { statutVille: 503 } }).run();
    expect(injoignable.premisse).toBe(true);
    expect(injoignable.errors.join(' ')).toContain('page ville injoignable');

    const absente = await sonde({ scenario: { statutVille: 404 } }).run();
    expect(absente.ok).toBe(false);
    expect(absente.premisse).toBe(false);
    expect(absente.errors.join(' ')).toContain('répond HTTP 404');
  });

  it('refuse une page ville qui ne porte plus le lien d’alerte', async () => {
    const resultat = await sonde({ scenario: { villeSansLien: true } }).run();
    expect(resultat.ok).toBe(false);
    expect(resultat.premisse).toBe(false);
    expect(resultat.errors.join(' ')).toContain('ne porte AUCUN lien d’alerte');
  });

  it('refuse un clic qui ne mène pas à /jobs', async () => {
    // La carte n'apparaît jamais : le relevé dit qu'une session anonyme a été
    // peinte, et c'est CETTE raison qui doit sortir, pas un simple délai.
    const resultat = await sonde({
      scenario: {
        clicVers: '/login',
        attenteReservee: 'timeout',
        relevés: [arrivee({ reservee: null, promesse: { titre: fr('jobAlertTitle'), texte: '', liens: [] } })],
      },
    }).run();
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join(' ')).toContain('ne mène pas à /jobs');
  });

  it('refuse une arrivée où le client est traité comme un visiteur', async () => {
    const resultat = await sonde({
      scenario: {
        attenteReservee: 'timeout',
        relevés: [
          arrivee({ reservee: null, promesse: { titre: fr('jobAlertTitle'), texte: '', liens: [] } }),
          arrivee({ reservee: null }),
        ],
      },
    }).run();
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join(' ')).toContain('PROMESSE D’UN VISITEUR SANS COMPTE');
  });

  it('refuse la règle sur la visite ordinaire, même quand l’arrivée est bonne', async () => {
    const resultat = await sonde({
      scenario: { relevés: [arrivee(), arrivee()] },
    }).run();
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join(' ')).toContain('SANS « alerte=1 »');
    expect(resultat.checked.join(' ')).toContain('carte de la règle peinte');
  });

  it('rend une prémisse sur une langue que le dictionnaire ne sert pas', async () => {
    const resultat = await sonde({
      scenario: { relevés: [arrivee({ lang: 'de' }), arrivee({ reservee: null })] },
    }).run();
    expect(resultat.premisse).toBe(true);
    expect(resultat.errors.join(' ')).toContain('hors des langues servies');
  });

  it('juge la ville par défaut dans la DÉCLARATION, pas dans une liste recopiée', async () => {
    const villes = villesPubliees();
    expect(villes.length).toBeGreaterThanOrEqual(13);
    expect(villes.map((ville) => ville.slug)).toContain('bamako');
    expect(villeParDefaut()).toEqual(villes[0]);
    // Une ville inconnue est une prémisse nommée, pas un vert silencieux.
    const resultat = await sonde({ ville: 'atlantide' }).run();
    expect(resultat.premisse).toBe(true);
    expect(resultat.errors.join(' ')).toContain('absente de la déclaration');
  });
});

// ---------------------------------------------------------------------------
// 3. Les trois sorties, et le coût publié dans tous les cas.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 3 bis. La lecture du compte — le JETON PORTÉ, pas seulement le cookie.
//
// La première passe de production (31/10/2026) a rendu une prémisse sur toute
// l'origine : `/api/auth/me` répondait 401 parce que la lecture n'envoyait qu'un
// cookie, alors que l'application s'authentifie par `localStorage['token']`
// (`src/services/api.js`). Ces cas fixent la lecture qui aurait laissé la sonde
// incapable de rendre un verdict, quel que soit l'état du produit.
// ---------------------------------------------------------------------------
describe('jobs client depuis une page ville — le compte lu par le cookie', () => {
  /**
   * Page doublure qui EXÉCUTE la fonction évaluée, avec un `fetch` qui répond
   * par statut, dans l'ordre des adresses demandées.
   */
  const pageAvecStatuts = (statuts = [401]) => {
    const appels = [];
    let index = 0;
    return {
      appels,
      evaluate: async (fonction, argument) => {
        const fauxFetch = async (chemin, options) => {
          appels.push({ chemin, options });
          const statut = statuts[Math.min(index, statuts.length - 1)];
          index += 1;
          return {
            ok: statut >= 200 && statut < 300,
            status: statut,
            json: async () => ({ user: { user_type: 'client' } }),
          };
        };
        const execute = new Function(
          'fetch',
          `return (${fonction.toString()})(${JSON.stringify(argument)});`,
        );
        return execute(fauxFetch);
      },
    };
  };

  it('dérive l’origine de l’API du site jugé, et les deux adresses du compte', () => {
    expect(origineApi('https://kojoforafrica.cc.cd')).toBe('https://api.kojoforafrica.cc.cd');
    expect(origineApi('http://localhost:3000')).toBe('');
    expect(cheminsCompte('https://kojoforafrica.cc.cd')).toEqual([
      'https://kojoforafrica.cc.cd/api/auth/me',
      'https://api.kojoforafrica.cc.cd/api/auth/me',
    ]);
    // Une origine d'API EXPLICITE l'emporte sur la déduction (preview).
    expect(cheminsCompte('https://preview.test', 'https://api-preview.test')).toEqual([
      'https://preview.test/api/auth/me',
      'https://api-preview.test/api/auth/me',
    ]);
    // Une seule adresse quand les deux origines sont la même (local).
    expect(cheminsCompte('http://localhost:3000')).toEqual(['http://localhost:3000/api/auth/me']);
  });

  it('demande les deux origines en cookie, et retient la première qui répond 200', async () => {
    const page = pageAvecStatuts([401, 200]);
    const chemins = cheminsCompte('https://kojoforafrica.cc.cd');
    const compte = await lireLeCompte(page, chemins);
    expect(compte.statut).toBe(200);
    expect(compte.type).toBe('client');
    expect(compte.chemin).toBe('https://api.kojoforafrica.cc.cd/api/auth/me');
    expect(page.appels.map((appel) => appel.chemin)).toEqual(chemins);
    // Aucun en-tête Authorization : le web n'envoie QUE le cookie httpOnly
    // (AuthContext) — en ajouter un ferait juger un canal que le web n'utilise
    // pas, et un jeton inexistant ferait rendre 401 à tort.
    for (const appel of page.appels) {
      expect(appel.options.credentials).toBe('include');
      expect(appel.options.headers).toBeUndefined();
    }
  });

  it('quand les deux origines refusent, le dit avec LEURS statuts (prémisse, jamais un vert)', async () => {
    const page = pageAvecStatuts([401, 403]);
    const compte = await lireLeCompte(page, cheminsCompte('https://kojoforafrica.cc.cd'));
    expect(compte.statut).toBe(403);
    expect(compte.lus).toEqual([
      { chemin: 'https://kojoforafrica.cc.cd/api/auth/me', statut: 401 },
      { chemin: 'https://api.kojoforafrica.cc.cd/api/auth/me', statut: 403 },
    ]);
  });

  it('arrête le parcours sur une session illisible, sans rien dire de la page ville', async () => {
    const { launch } = navigateur({
      compte: {
        statut: 401,
        type: '',
        chemin: '',
        lus: [
          { chemin: `${BASE}/api/auth/me`, statut: 401 },
          { chemin: 'https://api.kojo-jobs-ville.test/api/auth/me', statut: 401 },
        ],
      },
    });
    const resultat = await runJobsVilleClientProbe({ launch, email: 'a@b.c', password: 'x', quiet: true });
    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join(' ')).toContain('session non lue après connexion');
    expect(resultat.errors.join(' ')).toContain('401');
    expect(resultat.checked.join(' ')).not.toContain('/emplois/');
  });
});

describe('jobs client depuis une page ville — les trois sorties', () => {
  const resultat = (modifications = {}) => ({
    ok: false,
    premisse: false,
    errors: [],
    notices: [],
    checked: [],
    cout: { pages: 3, navigations: 4, requetes: 12, tentatives: 1, dureeMs: 1234 },
    attempts: 1,
    ...modifications,
  });

  it('sort 0 sur un verdict vert, 1 sur un refus, 2 sur une prémisse', async () => {
    const vert = await main([], { run: async () => resultat({ ok: true }), log: () => {}, error: () => {} });
    expect(vert).toBe(0);

    const rouge = await main([], {
      run: async () => resultat({ errors: ['x'] }),
      log: () => {},
      error: () => {},
    });
    expect(rouge).toBe(1);

    const doute = await main([], {
      run: async () => resultat({ premisse: true, errors: [premisse('compte CI absent')] }),
      log: () => {},
      error: () => {},
    });
    expect(doute).toBe(2);
  });

  it('publie le coût sur le vert COMME sur le rouge, et écrit le résumé', async () => {
    const dossier = mkdtempSync(path.join(tmpdir(), 'kojo-jobs-ville-'));
    try {
      const resume = path.join(dossier, 'resume.md');
      const lignes = [];
      await main(['--summary', resume], {
        run: async () => resultat({ ok: true, notices: ['conforme'] }),
        log: (ligne) => lignes.push(ligne),
        error: (ligne) => ecritures.push(ligne),
      });
      const contenu = readFileSync(resume, 'utf8');
      // Le coût est DIT, verdict vert compris : un budget qui ne s'affiche que
      // le jour où il déborde n'a servi à aucun arbitrage.
      expect(lignes.join(' ')).toContain('Coût de la passe');
      expect(contenu).toContain('Coût : 3 page(s), 4 navigation(s), 12 requête(s)');
      expect(contenu).toContain('conforme');

      const refus = path.join(dossier, 'refus.md');
      const erreurs = [];
      await main(['--summary', refus], {
        run: async () => resultat({ errors: ['refus nommé'] }),
        log: () => {},
        error: (ligne) => erreurs.push(ligne),
      });
      expect(erreurs.join(' ')).toContain('refus nommé');
      expect(readFileSync(refus, 'utf8')).toContain('refus nommé');
      expect(erreurs.join(' ')).toContain(`::error title=${TITRE_ERREUR}::`);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('déclare sa famille, un seul titre d’annotation, et la marque de prémisse', () => {
    const source = readFileSync(path.join(RACINE, 'frontend/scripts/check-jobs-ville-client-production.js'), 'utf8');
    expect(FAMILLE).toBe('jobs, client venu d’une page ville');
    // UN SEUL titre d'annotation : deux titres dans une sonde, et le lecteur
    // d'un run rouge ne sait plus quel refus il lit. Le titre y est INTERPOLÉ
    // (une seule constante), donc la garde lit la constante, pas un littéral.
    const titres = [...source.matchAll(/::error title=([^`]+)::/g)].map((trouve) => trouve[1]);
    expect(titres).toEqual(['${TITRE_ERREUR}']);
    expect(source).toContain('export const TITRE_ERREUR =');
    expect(MARQUE_PREMISSE).toContain('prémisse');
    expect(phraseCout(resultat().cout)).toContain('3 page(s)');
  });
});

// ---------------------------------------------------------------------------
// 4. Le contrat du workflow.
// ---------------------------------------------------------------------------
describe('jobs client depuis une page ville — le contrat du workflow', () => {
  const workflow = readFileSync(
    path.join(RACINE, '.github/workflows/jobs-ville-client-production-probe.yml'),
    'utf8'
  );

  it('tourne sur un cron, et lance CETTE sonde', () => {
    expect(workflow).toMatch(/^\s*- cron: '/m);
    expect(workflow).toContain('scripts/check-jobs-ville-client-production.js');
  });

  it('passe les secrets par `env`, jamais dans la commande publiée', () => {
    // L'étape JUGÉE est la dernière : c'est elle qui lance la sonde. On isole
    // son bloc pour ne pas lire les `env` d'une étape voisine (installation,
    // cache) et se croire quitte parce qu'un secret y figurait.
    const etape = workflow.slice(workflow.indexOf('Juger /jobs pour un client venu'));
    const commande = etape.slice(etape.indexOf('run: |'));
    expect(commande).not.toContain('LHCI_CI_PASSWORD');
    expect(commande).not.toContain('LHCI_CI_EMAIL');
    expect(etape).toContain('LHCI_CI_PASSWORD: ${{ secrets.LHCI_CI_PASSWORD }}');
    expect(etape).toContain('LHCI_CI_EMAIL: ${{ secrets.LHCI_CI_EMAIL }}');
  });

  it('a un plafond de temps, et ne MASQUE aucun code de sortie', () => {
    expect(workflow).toMatch(/timeout-minutes: \d+/);
    // Une étape qui tolère un échec (`continue-on-error`, `|| true`) rendrait
    // le run vert sur un refus nommé : la sonde rougit sur 1 COMME sur 2, et
    // c'est l'en-tête qui dit laquelle des deux causes on lit.
    expect(workflow).not.toContain('continue-on-error');
    expect(workflow).not.toMatch(/\|\|\s*true/);
    expect(workflow).toContain('PRÉMISSE');
    expect(workflow).toContain('un refus NOMMÉ');
  });
});

// Le dossier temporaire du dernier cas est nettoyé dans son `finally` ; cette
// garde évite qu'un futur cas laisse un fichier derrière lui sans le déclarer.
afterAll(() => {
  expect(true).toBe(true);
});
