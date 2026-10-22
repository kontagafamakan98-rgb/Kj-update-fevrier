/**
 * Preuve d'échec de `frontend/scripts/check-csp-contract.js`.
 *
 * Le contrat a trois maillons, et chacun est éprouvé par ses propres scénarios :
 * les deux calculs de la politique (JS ↔ Python), les quatre documents
 * pré-rendus qui la publient, et le plugin du build qui ne peut pas la
 * contourner. Les exécuteurs Python sont INJECTÉS : aucun sous-processus n'est
 * lancé ici, et le contrat réel (vrai interpréteur, vrai module) tourne à
 * l'étape de CI.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  CAS_DOCUMENTS,
  CAS_REFERENCE,
  ENV_DOCUMENTS,
  TITRE_ERREUR,
  comparerDocuments,
  comparerPlugin,
  comparerPolitiques,
  main,
  runCspContractCheck,
} from '../check-csp-contract.js';
import { construireCsp } from '../../src/config/csp.js';

const POLITIQUE = construireCsp({
  apiOrigin: CAS_DOCUMENTS.api_origin,
  plausibleDomain: CAS_DOCUMENTS.plausible_domain,
  gaMeasurementId: CAS_DOCUMENTS.ga_measurement_id,
});

const document = (csp) =>
  '<!DOCTYPE html><html><head>' +
  (csp
    ? `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}" />`
    : '') +
  '<title>t</title></head><body></body></html>';

const DOCUMENTS_CONFORMES = [
  { nom: '/jobs/:id', html: document(POLITIQUE) },
  { nom: '/jobs/:id (404)', html: document(POLITIQUE) },
  { nom: '/workers/:id', html: document(POLITIQUE) },
  { nom: '/workers/:id (404)', html: document(POLITIQUE) },
];

const POLITIQUES_JS = CAS_REFERENCE.map((entree) =>
  construireCsp({
    apiOrigin: entree.api_origin,
    plausibleDomain: entree.plausible_domain,
    gaMeasurementId: entree.ga_measurement_id,
  })
);

describe('contrat CSP — les deux copies de la politique', () => {
  it('accepte deux copies identiques', () => {
    expect(comparerPolitiques({ politiquesJs: POLITIQUES_JS, politiquesPy: POLITIQUES_JS })).toEqual([]);
  });

  it('refuse une copie Python qui diverge, en nommant le cas', () => {
    const politiquesPy = [...POLITIQUES_JS];
    politiquesPy[4] = politiquesPy[4].replace(' https://plausible.io', '');
    const erreurs = comparerPolitiques({ politiquesJs: POLITIQUES_JS, politiquesPy });

    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain(CAS_REFERENCE[4].label);
    expect(erreurs[0]).toContain('DIVERGENT');
    expect(erreurs[0]).toContain('plausible.io');
  });

  it('refuse une copie qui n’a pas exécuté les mêmes entrées', () => {
    const erreurs = comparerPolitiques({
      politiquesJs: POLITIQUES_JS,
      politiquesPy: POLITIQUES_JS.slice(0, 3),
    });

    expect(erreurs[0]).toContain('3');
    expect(erreurs[0]).toContain(String(CAS_REFERENCE.length));
    expect(erreurs[0]).toContain('mêmes entrées');
  });

  it('refuse `frame-ancestors` publiée dans une meta, des deux côtés', () => {
    const politiquesPy = POLITIQUES_JS.map((p) => `${p}; frame-ancestors 'none'`);
    const erreurs = comparerPolitiques({ politiquesJs: POLITIQUES_JS, politiquesPy });

    expect(erreurs.some((e) => e.includes('frame-ancestors'))).toBe(true);
    expect(erreurs.join('\n')).toContain('frontend/vercel.json');
  });

  it('refuse une politique JS vide', () => {
    const politiquesJs = [...POLITIQUES_JS];
    politiquesJs[0] = '';
    const erreurs = comparerPolitiques({ politiquesJs, politiquesPy: politiquesJs });

    expect(erreurs[0]).toContain('politique VIDE');
  });
});

describe('contrat CSP — les documents pré-rendus', () => {
  it('accepte les quatre documents quand ils publient la politique attendue', () => {
    expect(comparerDocuments({ documents: DOCUMENTS_CONFORMES, attendu: POLITIQUE })).toEqual([]);
  });

  it('refuse un document MUET, en le nommant', () => {
    const documents = DOCUMENTS_CONFORMES.map((doc) =>
      doc.nom === '/workers/:id (404)' ? { nom: doc.nom, html: document('') } : doc
    );
    const erreurs = comparerDocuments({ documents, attendu: POLITIQUE });

    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain('/workers/:id (404)');
    expect(erreurs[0]).toContain('AUCUNE meta CSP');
    expect(erreurs[0]).toContain('lien partagé');
  });

  it('refuse un document qui publie une politique DIFFÉRENTE', () => {
    const plusPermissif = POLITIQUE.replace("script-src 'self'", "script-src 'self' https://x.test");
    const documents = DOCUMENTS_CONFORMES.map((doc) =>
      doc.nom === '/jobs/:id' ? { nom: doc.nom, html: document(plusPermissif) } : doc
    );
    const erreurs = comparerDocuments({ documents, attendu: POLITIQUE });

    expect(erreurs[0]).toContain('/jobs/:id');
    expect(erreurs[0]).toContain('DIFFÉRENTE');
    expect(erreurs[0]).toContain('https://x.test');
  });

  it('refuse de conclure sans document rendu, ou sans politique attendue', () => {
    expect(comparerDocuments({ documents: [], attendu: POLITIQUE })[0]).toContain(
      'aucun document pré-rendu n’a été rendu'
    );
    expect(comparerDocuments({ documents: DOCUMENTS_CONFORMES, attendu: '' })[0]).toContain(
      'politique attendue est VIDE'
    );
  });
});

describe('contrat CSP — le plugin du build', () => {
  // Le faux plugin reçoit la configuration de `comparerPlugin` pour que le cas
  // positif dise quelque chose : une politique figée ne correspondrait qu'à UNE
  // des deux configurations comparées.
  const politiqueAttendue = ({ env = {}, apiOrigin = '' }) =>
    construireCsp({
      apiOrigin,
      plausibleDomain: env.VITE_PLAUSIBLE_DOMAIN,
      gaMeasurementId: env.VITE_GA_MEASUREMENT_ID,
    });
  const pluginFactice = ({ cspPour = politiqueAttendue, dev = '<html></html>' } = {}) => ({
    env,
    mode,
    apiOrigin,
  }) =>
    mode === 'production'
      ? {
          transformIndexHtml: (html) => {
            const csp = cspPour({ env, apiOrigin });
            return {
              html,
              tags: csp
                ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp } }]
                : [],
            };
          },
        }
      : { transformIndexHtml: () => dev };

  it('accepte le plugin de production, et son absence d’injection en développement', () => {
    expect(comparerPlugin({ plugin: pluginFactice() })).toEqual([]);
  });

  it('refuse un plugin qui n’injecte AUCUNE meta', () => {
    const erreurs = comparerPlugin({ plugin: pluginFactice({ cspPour: () => '' }) });

    expect(erreurs.length).toBeGreaterThan(0);
    expect(erreurs[0]).toContain("n'injecte AUCUNE meta CSP");
    expect(erreurs[0]).toContain('src/config/csp.js');
  });

  it('refuse un plugin qui publie une AUTRE politique que la déclaration', () => {
    const erreurs = comparerPlugin({
      plugin: pluginFactice({ cspPour: () => "default-src 'none'" }),
    });

    expect(erreurs[0]).toContain('PAS celle de');
    expect(erreurs[0]).toContain("default-src 'none'");
  });

  it('refuse un plugin qui injecte une CSP en DÉVELOPPEMENT (le HMR casserait)', () => {
    const erreurs = comparerPlugin({
      plugin: pluginFactice({ dev: '<meta http-equiv="Content-Security-Policy" content="x" />' }),
    });

    expect(erreurs[0]).toContain('hors production');
    expect(erreurs[0]).toContain('HMR');
  });
});

describe('contrat CSP — le verdict', () => {
  const depsOk = (overrides = {}) => ({
    python: 'python-de-test',
    executerPolitiques: () => ({ politiques: POLITIQUES_JS, error: '' }),
    executerDocuments: () => ({ documents: DOCUMENTS_CONFORMES, error: '' }),
    ...overrides,
  });

  it('rend un contrat tenu quand les trois maillons passent', () => {
    const resultat = runCspContractCheck({ quiet: true, ...depsOk() });

    expect(resultat.ok).toBe(true);
    expect(resultat.errors).toEqual([]);
    const publie = resultat.checked.join('\n');
    expect(publie).toContain(`${CAS_REFERENCE.length} cas`);
    expect(publie).toContain('/jobs/:id, /jobs/:id (404), /workers/:id, /workers/:id (404)');
    expect(publie).toContain('le plugin du build');
  });

  it('échoue quand la copie Python diverge', () => {
    const politiquesPy = [...POLITIQUES_JS];
    politiquesPy[5] = `${politiquesPy[5]} x`;
    const resultat = runCspContractCheck({
      quiet: true,
      ...depsOk({ executerPolitiques: () => ({ politiques: politiquesPy, error: '' }) }),
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toContain('DIVERGENT');
  });

  it('échoue quand les documents ne publient rien', () => {
    const resultat = runCspContractCheck({
      quiet: true,
      ...depsOk({
        executerDocuments: () => ({
          documents: DOCUMENTS_CONFORMES.map((doc) => ({ nom: doc.nom, html: document('') })),
          error: '',
        }),
      }),
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toContain('AUCUNE meta CSP');
  });

  it('échoue quand l’interpréteur ne peut pas exécuter la copie', () => {
    const resultat = runCspContractCheck({
      quiet: true,
      ...depsOk({
        executerPolitiques: () => ({ politiques: [], error: 'python a échoué (code 1)' }),
      }),
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors[0]).toContain('politiques n’ont pas pu être lues');
  });

  it('rend l’absence d’interpréteur BLOQUANTE en CI, simple avis ailleurs', () => {
    const avant = process.env.CI;
    try {
      process.env.CI = 'true';
      const enCi = runCspContractCheck({ quiet: true, python: '', executerPolitiques: vi.fn() });
      expect(enCi.python).toBe('');
      expect(enCi.ok).toBe(false);
      expect(enCi.errors[0]).toContain('aucun interpréteur Python');

      delete process.env.CI;
      const horsCi = runCspContractCheck({ quiet: true, python: '' });
      expect(horsCi.ok).toBe(true);
      expect(horsCi.notices[0]).toContain('aucun interpréteur Python');
    } finally {
      if (avant === undefined) delete process.env.CI;
      else process.env.CI = avant;
    }
  });

  it('rend 1 et annote le titre quand le contrat n’est pas tenu', () => {
    const erreurs = [];
    const lignes = [];
    const resultat = main([], {
      run: () => ({ ok: false, errors: ['la copie diverge'], notices: [], checked: [], python: 'x' }),
      log: (ligne) => lignes.push(ligne),
      error: (ligne) => erreurs.push(ligne),
    });

    expect(resultat).toBe(1);
    expect(erreurs.join('\n')).toContain(`::error title=${TITRE_ERREUR}::`);
    expect(lignes).toEqual([]);
  });

  it('rend 0 quand le contrat est tenu', () => {
    const erreurs = [];
    expect(
      main([], {
        run: () => ({ ok: true, errors: [], notices: [], checked: [], python: 'x' }),
        log: () => {},
        error: (ligne) => erreurs.push(ligne),
      })
    ).toBe(0);
    expect(erreurs).toEqual([]);
  });

  it('nomme les réglages que la comparaison de production devra rapprocher', () => {
    // Les noms sont ceux des DEUX déploiements : le contrat les cite pour que
    // le lecteur sache quoi comparer quand la sonde de production rougit.
    expect(ENV_DOCUMENTS).toEqual({
      BACKEND_PUBLIC_URL: 'https://api.kojo.test',
      PLAUSIBLE_DOMAIN: 'site.kojo.test',
      GA_MEASUREMENT_ID: 'G-ABC123',
    });
    expect(POLITIQUE).toContain(ENV_DOCUMENTS.BACKEND_PUBLIC_URL);
  });
});
