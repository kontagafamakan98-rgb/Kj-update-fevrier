import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  BUDGETS,
  ECHANTILLONS_PAR_DEFAUT,
  PLANCHER_ROUTES,
  ROUTES,
  juger,
  mediane,
  verifier,
} from '../check-cdn-lente-production.js';
import { PAGE_META } from '../../src/config/page-meta.js';

// Tests de la SONDE CDN (TTFB + LCP de production, scripts/check-cdn-lente-production.js).
//
// Ce que ces cas peuvent prouver hors ligne, et ce qu'ils ne peuvent pas :
//   • le VERDICT et ses refus (statut, LCP absent, dépassement) — ici ;
//   • la CHAUFFE JETÉE et la MÉDIANE, qui sont la décision la plus coûteuse de
//     cette sonde (mesuré le 31/10/2026 : « / » rend 9 668 ms de TTFB au premier
//     chargement et 388 ms au second) — ici, en injectant un mesureur ;
//   • l'INSTRUMENT lui-même (le PerformanceObserver, la navigation réelle) — pas
//     ici : c'est ce que la sonde exerce chaque matin en production, et le
//     protocole LCP est celui des sondes e2e (`lcp-geometrie.spec.js`) qu'un
//     navigateur seul peut éprouver.
//
// Les valeurs des fixtures sont des MILLISECONDES, jamais des scores : la sonde
// publie des durées, et un score glissé ici serait un chiffre qui ne veut rien
// dire.

const ROUTE_OK = (route, ttfb = 240, lcp = 700) => ({
  route,
  statut: 200,
  ttfb,
  lcp,
  candidats: 3,
  echantillons: [lcp, lcp, lcp],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('check-cdn-lente-production — médiane et corpus', () => {
  it('calcule la médiane et ignore ce qui n’est pas un nombre', () => {
    expect(mediane([1, 2, 3])).toBe(2);
    expect(mediane([4, 1, 3, 2])).toBe(3); // (2+3)/2 arrondi
    expect(mediane([9000, 200, 210])).toBe(210);
    expect(mediane([null, 5, undefined, 7, NaN])).toBe(6);
    expect(mediane([])).toBeNull();
    expect(mediane(['120'])).toBeNull();
  });

  it('juge les routes DÉRIVÉES de page-meta.js, et assez pour que le corpus décrive le site', () => {
    expect(ROUTES).toEqual(Object.keys(PAGE_META));
    expect(ROUTES.length).toBeGreaterThanOrEqual(PLANCHER_ROUTES);
    expect(ROUTES).toContain('/jobs');
  });

  it('garde des plafonds plausibles (une alerte, pas une tolérance infinie)', () => {
    expect(BUDGETS.ttfbMs).toBeGreaterThan(0);
    expect(BUDGETS.ttfbMs).toBeLessThanOrEqual(3000);
    expect(BUDGETS.lcpMs).toBeGreaterThan(0);
    expect(BUDGETS.lcpMs).toBeLessThanOrEqual(8000);
    // Le LCP suit le TTFB : un plafond de LCP plus BAS que celui du TTFB
    // déclarerait une page lente avant même qu'elle ait reçu son premier octet.
    expect(BUDGETS.lcpMs).toBeGreaterThan(BUDGETS.ttfbMs);
  });
});

describe('check-cdn-lente-production — le verdict', () => {
  it('accepte des routes sous les plafonds et publie leurs chiffres', () => {
    const releves = ['/', '/jobs', '/login', '/how-it-works', '/support'].map((r) => ROUTE_OK(r));

    const verdict = juger(releves);

    expect(verdict.ok).toBe(true);
    expect(verdict.erreurs).toEqual([]);
  });

  it('refuse un TTFB au-dessus du plafond, en nommant la route ET la valeur', () => {
    const releves = [ROUTE_OK('/'), ROUTE_OK('/jobs', BUDGETS.ttfbMs + 500)];

    const verdict = juger(releves);

    expect(verdict.ok).toBe(false);
    const message = verdict.erreurs.join('\n');
    expect(message).toContain('/jobs');
    expect(message).toMatch(/TTFB .+ > plafond .+/);
    expect(message).toContain(`${BUDGETS.ttfbMs} ms`);
  });

  it('refuse un LCP au-dessus du plafond', () => {
    const verdict = juger([ROUTE_OK('/', 200, BUDGETS.lcpMs + 1500)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.erreurs.join('\n')).toMatch(/LCP .+ > plafond .+ — le plus grand élément/);
  });

  it('refuse un LCP ABSENT au lieu de le lire comme un zéro rapide', () => {
    // Une page dont l'observateur n'a rien vu ne prouve pas qu'elle est rapide :
    // l'instrument est muet, et un zéro publié serait un faux vert.
    const releve = { ...ROUTE_OK('/'), lcp: null, echantillons: [] };

    const verdict = juger([releve]);

    expect(verdict.ok).toBe(false);
    const message = verdict.erreurs.join('\n');
    expect(message).toMatch(/aucune candidate LCP/);
    expect(message).toContain("l'instrument n'a rien vu");
  });

  it('refuse un statut qui n’est pas 200', () => {
    const verdict = juger([{ ...ROUTE_OK('/'), statut: 503 }]);

    expect(verdict.ok).toBe(false);
    expect(verdict.erreurs.join('\n')).toContain('HTTP 503');
  });

  it('refuse une route illisible en la nommant', () => {
    const verdict = juger([
      ROUTE_OK('/'),
      { route: '/jobs', statut: null, ttfb: null, lcp: null, candidats: 0, echantillons: [], erreur: 'net::ERR_TIMED_OUT' },
    ]);

    expect(verdict.ok).toBe(false);
    expect(verdict.erreurs.join('\n')).toMatch(/\/jobs : illisible \(net::ERR_TIMED_OUT\)/);
  });

  it('nomme CHAQUE route fautive, pas seulement la première', () => {
    const verdict = juger([
      ROUTE_OK('/', BUDGETS.ttfbMs + 10),
      ROUTE_OK('/jobs', BUDGETS.ttfbMs + 20),
    ]);

    expect(verdict.ok).toBe(false);
    expect(verdict.erreurs).toHaveLength(2);
  });
});

describe('check-cdn-lente-production — la passe (chauffe jetée, prémisse honnête)', () => {
  it('JETTE le premier chargement de chaque route : un bord froid ne fait pas un rouge', async () => {
    // C'est la mesure du 31/10/2026, rejouée : 9 668 ms de TTFB au premier
    // chargement de « / », 388 ms ensuite. Sans chauffe, la médiane de trois
    // mesures vaudrait ~4,9 s et la sonde rougirait tous les matins.
    const appels = {};
    const mesurer = (route) => {
      appels[route] = (appels[route] || 0) + 1;
      const premier = appels[route] === 1;
      return Promise.resolve({
        statut: 200,
        ttfb: premier ? 9668 : 220,
        lcp: premier ? 12712 : 700,
        candidates: 1,
        erreur: null,
      });
    };

    const resultat = await verifier({
      routes: ['/', '/jobs', '/login', '/support', '/about'],
      mesurer,
      cout: () => {},
    });

    expect(resultat.code).toBe(0);
    expect(resultat.releves.find((r) => r.route === '/').ttfb).toBe(220);
    // Chaque route a bien été chargée une fois de plus que les mesures gardées.
    for (const route of ['/', '/jobs']) {
      expect(appels[route]).toBe(ECHANTILLONS_PAR_DEFAUT + 1);
    }
  });

  it('rend une PRÉMISSE sur un corpus vide (la déclaration n’a pas été lue)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const resultat = await verifier({ routes: [], mesurer: () => Promise.resolve({}) });

    expect(resultat.code).toBe(2);
    expect(log.mock.calls.flat().join('\n')).toMatch(/\[PREMISSE\].*plancher/);
  });

  it('rend une PRÉMISSE quand AUCUNE route n’est lisible, et un refus quand une seule l’est', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const injoignable = await verifier({
      routes: ['/', '/jobs', '/login', '/support', '/about'],
      mesurer: () => {
        throw new Error('net::ERR_NAME_NOT_RESOLVED');
      },
      cout: () => {},
    });
    expect(injoignable.code).toBe(2);

    const partiel = await verifier({
      routes: ['/', '/jobs', '/login', '/support', '/about'],
      mesurer: (route) => {
        if (route === '/jobs') throw new Error('net::ERR_TIMED_OUT');
        return Promise.resolve({ statut: 200, ttfb: 200, lcp: 600, candidates: 2, erreur: null });
      },
      cout: () => {},
    });
    expect(partiel.code).toBe(1);
    expect(partiel.erreurs.join('\n')).toContain('/jobs');
  });

  it('publie le coût de la passe (navigations, durée)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const couts = [];

    await verifier({
      routes: ['/', '/jobs', '/login', '/support', '/about'],
      mesurer: () => Promise.resolve({ statut: 200, ttfb: 200, lcp: 600, candidates: 1, erreur: null }),
      cout: (cout) => couts.push(cout),
    });

    expect(couts).toHaveLength(1);
    expect(couts[0].navigations).toBe(5 * (ECHANTILLONS_PAR_DEFAUT + 1));
    expect(typeof couts[0].duree).toBe('number');
    expect(log.mock.calls.flat().join('\n')).toMatch(/\[COUT\] 5 route\(s\) jugée\(s\)/);
  });
});
