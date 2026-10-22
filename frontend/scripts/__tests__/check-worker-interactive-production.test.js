/**
 * Preuve d'échec de `frontend/scripts/check-worker-interactive-production.js`.
 *
 * La sonde juge un fait qu'aucune autre ne peut voir : le DOCUMENT servi de
 * `/workers/:id` peut être parfait (réécriture, point d'entrée, feuille, bloc,
 * cartes OG) et l'application ne jamais monter, ou monter sans qu'un geste
 * réponde. C'était la limite déclarée de la page ; ce fichier prouve la sonde
 * qui la ferme, sur des SCÉNARIOS — un relevé de page, un geste, une navigation
 * — en remplaçant `launch` : Playwright n'est jamais chargé, aucun réseau de
 * production n'est touché.
 *
 * Chaque refus de la sonde a son scénario, donc son rouge, et le test dit la
 * PHRASE attendue : un test qui n'exigerait qu'un `ok: false` laisserait passer
 * un refus pour la mauvaise raison. Un serveur HTTP local réel couvre la
 * résolution du sitemap, parce que c'est la seule partie qui lit le réseau.
 */
import http from 'node:http';

import { describe, it, expect, vi } from 'vitest';

import {
  ANCRE_MISSIONS,
  CHEMIN_MISSIONS,
  FAMILLE,
  MARQUE_PREMISSE,
  SELECTEUR_ACTION,
  TITRE_ERREUR,
  libelleSonde,
  main,
  parseArguments,
  runWorkerInteractiveProbe,
} from '../check-worker-interactive-production.js';
// Le geste, son marqueur, sa borne de montage et son en-tête de preview ont UN
// propriétaire (la sonde de la fiche mission) : ils se jugent ici sur la même
// règle, pas sur une copie.
import {
  MONTAGE_TIMEOUT_MS,
  SELECTEUR_MONTAGE,
  contextOptions,
} from '../check-job-interactive-production.js';
import { POINT_ENTREE_TRAVAILLEUR } from '../site-meta.js';
import { TITRE_ERREUR as TITRE_DOCUMENT } from '../check-worker-page-production.js';

const BASE = 'https://kojo-sonde-profil.test';
const ID = 'travailleur-sonde';

/** Le relevé que `etatDuProfil` rend dans une page montée et conforme. */
const releve = (modifications = {}) => ({
  monte: true,
  racineVide: false,
  nom: 'Awa Diop',
  blocLisible: true,
  idBloc: ID,
  nomBloc: 'Awa Diop',
  ancreMissions: true,
  ...modifications,
});

/**
 * Navigateur doublure : il rejoue, dans l'ordre, les relevés qu'un scénario lui
 * donne, et journalise ce que la sonde a demandé à la page.
 *
 * @param {object} [scenario]
 * @param {Array} [scenario.etats] Valeurs rendues par les `evaluate` successifs.
 * @param {string} [scenario.montage] `timeout` : le châssis n'apparaît pas.
 * @param {string} [scenario.action] `timeout` : aucune action peinte.
 * @param {string} [scenario.clic] `timeout` : le clic lui-même échoue.
 * @param {string} [scenario.navigation] `timeout` : l'adresse attendue n'arrive pas.
 * @param {string} [scenario.url] Adresse de la page (après navigation).
 * @param {Error} [scenario.gotoError] Le profil ne s'ouvre pas.
 * @param {Error} [scenario.launchError] Le navigateur ne se lance pas.
 * @returns {{launch: Function, journal: object}}
 */
function navigateur({
  etats = [releve(), undefined, { marqueur: true, chassis: true }],
  montage = 'ok',
  action = 'ok',
  clic = 'ok',
  navigation = 'ok',
  // LITÉRAL, jamais `${BASE}${CHEMIN_MISSIONS}` : une doublure qui lit la
  // constante de la sonde resterait verte si la sonde changeait d'adresse
  // attendue — la mutation « chemin d'arrivée » l'a mesuré.
  url = `${BASE}/jobs`,
  gotoError = null,
  launchError = null,
} = {}) {
  const journal = {
    goto: [],
    waitForSelector: [],
    attentes: [],
    click: [],
    waitForURL: 0,
    evaluate: 0,
    closed: false,
    contextOptions: [],
  };
  let index = 0;

  const page = {
    goto: async (adresse) => {
      journal.goto.push(adresse);
      if (gotoError) throw gotoError;
    },
    waitForSelector: async (selecteur, options) => {
      journal.waitForSelector.push(selecteur);
      journal.attentes.push(options || {});
      if (selecteur === SELECTEUR_MONTAGE && montage === 'timeout') {
        throw new Error('Timeout 30000ms exceeded.');
      }
      if (selecteur !== SELECTEUR_MONTAGE && action === 'timeout') {
        throw new Error('Timeout 15000ms exceeded.');
      }
      return {};
    },
    evaluate: async () => {
      journal.evaluate += 1;
      const valeur = etats[index];
      index += 1;
      return valeur;
    },
    click: async (selecteur) => {
      journal.click.push(selecteur);
      if (clic === 'timeout') throw new Error('Element is not visible');
    },
    waitForURL: async () => {
      journal.waitForURL += 1;
      if (navigation === 'timeout') throw new Error('Timeout 15000ms exceeded.');
    },
    url: () => url,
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

  const launch = vi.fn(async () => {
    if (launchError) throw launchError;
    return browser;
  });

  return { launch, journal };
}

/** La sonde d'un scénario, sur le profil `--worker` (aucun sitemap à lire). */
const sonder = (scenario = {}, extra = {}) => {
  const { launch, journal } = navigateur(scenario);
  const promesse = runWorkerInteractiveProbe({
    base: BASE,
    worker: ID,
    launch,
    quiet: true,
    ...extra,
  });
  return { promesse, launch, journal };
};

describe('check-worker-interactive-production — montage réel', () => {
  it('juge un profil monté, peint depuis son bloc, et un geste SPA', async () => {
    const { promesse, journal } = sonder();

    const result = await promesse;

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.workerId).toBe(ID);
    expect(journal.goto).toEqual([`${BASE}/workers/${ID}`]);
    // Le montage est attendu ATTACHÉ : un châssis masqué par une media query
    // reste un châssis monté.
    expect(journal.attentes[0]).toEqual({ state: 'attached', timeout: MONTAGE_TIMEOUT_MS });
    expect(journal.waitForSelector[0]).toBe(SELECTEUR_MONTAGE);
    expect(journal.waitForSelector[1]).toBe(SELECTEUR_ACTION);
    expect(journal.click).toEqual([ANCRE_MISSIONS]);
    expect(journal.waitForURL).toBe(1);
    expect(journal.closed).toBe(true);
    // Les faits mesurés sont PUBLIÉS, pas seulement le verdict.
    const publie = result.checked.join('\n');
    expect(publie).toContain('montage réel');
    expect(publie).toContain('#root');
    expect(publie).toContain('sans rechargement');
  });

  it('ne rejuge pas un bloc absent : l’absence est celle de la sonde du document', async () => {
    // Le bloc manque (navigation interne, ou bloc illisible), la page a relu
    // l'API et peint le profil : cette sonde juge l'EXÉCUTION, pas le document
    // — elle ne doit pas prononcer ici le refus que
    // `check-worker-page-production.js` porte déjà.
    const { promesse } = sonder({
      etats: [releve({ blocLisible: false, nomBloc: '' }), undefined, { marqueur: true, chassis: true }],
    });

    const result = await promesse;

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checked.join('\n')).toContain('sans rechargement');
  });
});

describe('check-worker-interactive-production — le montage manqué', () => {
  it('refuse une coquille statique qui n’a jamais monté', async () => {
    const { promesse, journal } = sonder({
      montage: 'timeout',
      etats: [releve({ monte: false, ancreMissions: false })],
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("n'a pas monté");
    expect(result.errors[0]).toContain('coquille statique');
    expect(result.errors[0]).toContain(POINT_ENTREE_TRAVAILLEUR.script);
    expect(result.errors[0]).toContain('check-worker-page-production.js');
    expect(journal.closed).toBe(true);
    // Aucun geste n'est tenté sur une page qui n'a pas monté.
    expect(journal.click).toEqual([]);
  });

  it('distingue un #root VIDE d’une coquille encore en place', async () => {
    const { promesse } = sonder({
      montage: 'timeout',
      etats: [releve({ monte: false, racineVide: true })],
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('#root est resté VIDE');
  });

  it('refuse un profil qui a monté sans peindre de nom', async () => {
    const { promesse } = sonder({
      etats: [releve({ nom: '', nomBloc: 'Awa Diop' }), undefined, { marqueur: true, chassis: true }],
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('ne peint AUCUN nom');
    expect(result.errors[0]).toContain('état de repli');
  });

  it('refuse un <h1> qui ne parle pas de la personne du bloc', async () => {
    const { promesse } = sonder({
      etats: [
        releve({ nom: 'Un autre travailleur', nomBloc: 'Awa Diop' }),
        undefined,
        { marqueur: true, chassis: true },
      ],
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Un autre travailleur');
    expect(result.errors[0]).toContain('Awa Diop');
    expect(result.errors[0]).toContain('ne parle pas de la personne');
  });
});

describe('check-worker-interactive-production — l’action de la page', () => {
  it('refuse un profil sans aucune action interactive, sans cliquer', async () => {
    const { promesse, journal } = sonder({
      action: 'timeout',
      etats: [releve({ ancreMissions: false }), undefined, { marqueur: true, chassis: true }],
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('AUCUNE action interactive');
    expect(result.errors[0]).toContain(ANCRE_MISSIONS);
    expect(result.errors[0]).toContain('gestionnaires');
    expect(journal.click).toEqual([]);
  });
});

describe('check-worker-interactive-production — le geste', () => {
  it('refuse un clic qui ne change pas d’adresse', async () => {
    const { promesse, journal } = sonder({
      etats: [releve(), undefined],
      navigation: 'timeout',
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain(`n'a pas conduit à ${CHEMIN_MISSIONS}`);
    expect(result.errors[0]).toContain('pas une application');
    expect(journal.waitForURL).toBe(1);
  });

  it('refuse un clic impossible en le nommant', async () => {
    const { promesse } = sonder({
      etats: [releve(), undefined],
      clic: 'timeout',
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("n'a pas pu être cliqué");
  });

  it('refuse une navigation qui RECHARGE le document', async () => {
    const { promesse } = sonder({
      etats: [releve(), undefined, { marqueur: false, chassis: true }],
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('RECHARGÉ le document');
    expect(result.errors[0]).toContain('marqueur de vie');
    expect(result.errors[0]).toContain('location.href');
  });

  it('refuse une page d’arrivée qui n’a pas monté le châssis', async () => {
    const { promesse } = sonder({
      etats: [releve(), undefined, { marqueur: true, chassis: false }],
    });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('ne porte plus le châssis');
    expect(result.errors[0]).toContain('document mort');
  });

  it('refuse une attente résolue sur une AUTRE adresse que celle annoncée', async () => {
    // `waitForURL` peut résoudre trop large : la sonde relit `page.url()` et
    // compare le CHEMIN. Sans cette relecture, une redirection vers l'accueil
    // passerait pour la liste des missions.
    const { launch } = navigateur({
      etats: [releve(), undefined, { marqueur: true, chassis: true }],
      url: `${BASE}/`,
    });
    const result = await runWorkerInteractiveProbe({
      base: BASE,
      worker: ID,
      launch,
      quiet: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('a conduit à /');
    expect(result.errors[0]).toContain(`au lieu de ${CHEMIN_MISSIONS}`);
  });

  it('referme le navigateur même quand le geste échoue', async () => {
    const { promesse, journal } = sonder({ etats: [releve(), undefined], navigation: 'timeout' });

    await promesse;

    expect(journal.closed).toBe(true);
  });
});

describe('check-worker-interactive-production — prémisse et outillage', () => {
  it('rend une PRÉMISSE sans lancer de navigateur quand le sitemap est vide', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      text: async () => '<?xml version="1.0"?><urlset><url><loc>https://x.test/</loc></url></urlset>',
    }));
    const launch = vi.fn();

    const result = await runWorkerInteractiveProbe({ base: BASE, launch, quiet: true, fetchImpl });

    expect(result.premisse).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.notices.join('\n')).toContain(MARQUE_PREMISSE);
    expect(result.notices.join('\n')).toContain('aucun profil /workers/:id');
    expect(launch).not.toHaveBeenCalled();
  });

  it('refuse un sitemap illisible au lieu de conclure', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 503, text: async () => '' }));
    const launch = vi.fn();

    const result = await runWorkerInteractiveProbe({ base: BASE, launch, quiet: true, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.premisse).toBe(false);
    expect(result.errors[0]).toContain('sitemap');
    expect(result.errors[0]).toContain('503');
    expect(launch).not.toHaveBeenCalled();
  });

  it('refuse un --worker qui n’est pas un profil', async () => {
    const launch = vi.fn();

    const result = await runWorkerInteractiveProbe({
      base: BASE,
      worker: `${BASE}/jobs/mission-1`,
      launch,
      quiet: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("n'est pas un profil");
    expect(launch).not.toHaveBeenCalled();
  });

  it('rend une PRÉMISSE nommée quand Chromium est absent, avec le remède', async () => {
    const launch = vi.fn(async () => {
      throw new Error("Executable doesn't exist at /root/.cache/ms-playwright/chromium");
    });

    const result = await runWorkerInteractiveProbe({ base: BASE, worker: ID, launch, quiet: true });

    expect(result.premisse).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.notices.join('\n')).toContain(MARQUE_PREMISSE);
    expect(result.notices.join('\n')).toContain('npx playwright install --with-deps chromium');
    expect(result.errors).toEqual([]);
  });

  it('refuse un profil injoignable au lieu de le déclarer prémisse', async () => {
    const { promesse } = sonder({ gotoError: new Error('net::ERR_CONNECTION_REFUSED') });

    const result = await promesse;

    expect(result.ok).toBe(false);
    expect(result.premisse).toBe(false);
    expect(result.errors[0]).toContain("n'a pas pu être ouvert");
    expect(result.errors[0]).toContain('ERR_CONNECTION_REFUSED');
  });
});

describe('check-worker-interactive-production — contexte de preview', () => {
  it('n’envoie l’en-tête de contournement que si un jeton est fourni', () => {
    expect(contextOptions({})).toEqual({});
    expect(contextOptions({ bypassToken: '   ' })).toEqual({});
    expect(contextOptions({ bypassToken: 'jeton-preview' })).toEqual({
      extraHTTPHeaders: { 'x-vercel-protection-bypass': 'jeton-preview' },
    });
  });

  it('porte le jeton sur le CONTEXTE, et ne le publie jamais', async () => {
    const { promesse, journal } = sonder({}, { bypassToken: 'JETON-A-NE-PAS-PUBLIER' });

    const result = await promesse;

    expect(journal.contextOptions[0].extraHTTPHeaders).toEqual({
      'x-vercel-protection-bypass': 'JETON-A-NE-PAS-PUBLIER',
    });
    const publie = [result.errors, result.notices, result.checked].flat().join('\n');
    expect(publie).not.toContain('JETON-A-NE-PAS-PUBLIER');
  });
});

describe('check-worker-interactive-production — options et verdict', () => {
  it('parse les options sans imposer de surface', () => {
    expect(parseArguments([])).toEqual({ base: '', worker: '', quiet: false });
    expect(parseArguments(['--base', 'http://127.0.0.1:4173', '--worker', 'awa'])).toEqual({
      base: 'http://127.0.0.1:4173',
      worker: 'awa',
      quiet: false,
    });
    expect(parseArguments(['--quiet'])).toEqual({ base: '', worker: '', quiet: true });
    // Un drapeau sans valeur ne mange pas le suivant : il est ignoré.
    expect(parseArguments(['--base'])).toEqual({ base: '', worker: '', quiet: false });
  });

  it('rend 0, 1 et 2 sur les trois états, et annote le titre de la famille', async () => {
    const lignes = [];
    const erreurs = [];
    const deps = {
      log: (ligne) => lignes.push(ligne),
      error: (ligne) => erreurs.push(ligne),
    };
    const conforme = {
      ok: true,
      premisse: false,
      errors: [],
      notices: [],
      checked: ['  ✓ montage réel'],
      workerId: ID,
    };
    const refuse = { ...conforme, ok: false, errors: ['le profil est mort'] };
    const premisse = {
      ...conforme,
      ok: false,
      premisse: true,
      checked: [],
      notices: [`${MARQUE_PREMISSE} : rien à juger`],
    };

    expect(await main([], { run: async () => conforme, ...deps })).toBe(0);
    expect(await main([], { run: async () => refuse, ...deps })).toBe(1);
    expect(await main([], { run: async () => premisse, ...deps })).toBe(2);
    expect(erreurs.join('\n')).toContain(`::error title=${TITRE_ERREUR}::`);
    expect(lignes.join('\n')).toContain('montage réel');
    expect(lignes.join('\n')).toContain('✅ /workers/:id est interactive');
  });

  it('ne confond ni sa famille ni son titre avec ceux de la sonde du document', () => {
    expect(FAMILLE).toBe('profil travailleur interactif');
    expect(TITRE_ERREUR).not.toBe(TITRE_DOCUMENT);
    expect(TITRE_ERREUR).toContain('interactif');
    expect(libelleSonde(BASE)).toContain(FAMILLE);
    expect(libelleSonde(BASE)).toContain('/workers/:id');
  });
});

describe('check-worker-interactive-production — sitemap réel', () => {
  /**
   * Un serveur HTTP réel : c'est la seule partie de la sonde qui lit le réseau
   * hors navigateur, et un `fetchImpl` simulé ne prouverait pas que l'URL est
   * bien demandée.
   */
  const demarrer = (xml) =>
    new Promise((resolve) => {
      const requetes = [];
      const server = http.createServer((req, res) => {
        requetes.push(req.url);
        if (req.url === '/sitemap.xml') {
          res.writeHead(200, { 'content-type': 'application/xml' });
          res.end(xml);
          return;
        }
        res.writeHead(404);
        res.end('');
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({
          base: `http://127.0.0.1:${server.address().port}`,
          requetes,
          fermer: () => new Promise((done) => server.close(done)),
        });
      });
    });

  it('juge le premier profil du sitemap servi', async () => {
    const xml =
      '<?xml version="1.0"?><urlset>' +
      '<url><loc>https://kojo.test/jobs/mission-locale</loc></url>' +
      '<url><loc>https://kojo.test/workers/awa-diop</loc></url>' +
      '</urlset>';
    const serveur = await demarrer(xml);
    const { launch, journal } = navigateur();

    try {
      const result = await runWorkerInteractiveProbe({
        base: serveur.base,
        launch,
        quiet: true,
      });

      expect(result.ok).toBe(true);
      expect(result.workerId).toBe('awa-diop');
      expect(result.source).toBe('sitemap');
      expect(journal.goto).toEqual([`${serveur.base}/workers/awa-diop`]);
      expect(serveur.requetes).toContain('/sitemap.xml');
    } finally {
      await serveur.fermer();
    }
  });

  it('rend une prémisse sur un sitemap réel qui ne porte aucun profil', async () => {
    const xml = '<?xml version="1.0"?><urlset><url><loc>https://kojo.test/</loc></url></urlset>';
    const serveur = await demarrer(xml);
    const launch = vi.fn();

    try {
      const result = await runWorkerInteractiveProbe({ base: serveur.base, launch, quiet: true });

      expect(result.premisse).toBe(true);
      expect(result.notices.join('\n')).toContain('aucun profil /workers/:id');
      expect(launch).not.toHaveBeenCalled();
      expect(serveur.requetes).toContain('/sitemap.xml');
    } finally {
      await serveur.fermer();
    }
  });
});
