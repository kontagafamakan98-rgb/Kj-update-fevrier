/**
 * Tests de scripts/setup-seo-env.js — les parties qui DÉCIDENT, sans réseau.
 *
 * Ce qui est vérifié, et rien de plus : ce qui manque est nommé AVANT toute
 * écriture (poser une variable à moitié, c'est un rouge silencieux côté audit),
 * le verdict de vérification ÉCHOUE quand le HTML ne porte pas la balise (sinon
 * la commande dirait « déployé, donc c'est bon »), et une erreur de l'API
 * remonte au lieu d'être avalée.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  envPayload,
  missingInputs,
  vercelApi,
  verifyIntegrations,
} from '../setup-seo-env.js';

const GA = 'G-ABC1234567';
const GSC = 'jeton-gsc-abc123';
const ready = { VERCEL_TOKEN: 'vcp_test', KOJO_GA_MEASUREMENT_ID: GA, KOJO_GSC_VERIFICATION: GSC };

describe('ce qu’il faut pour lancer, nommé avant toute écriture', () => {
  it('ne manque rien quand les trois valeurs sont là', () => {
    expect(missingInputs(ready)).toEqual([]);
  });

  it('nomme les deux valeurs absentes et le jeton', () => {
    const problems = missingInputs({});
    expect(problems.join('\n')).toContain('VERCEL_TOKEN');
    expect(problems.join('\n')).toContain('KOJO_GA_MEASUREMENT_ID');
    expect(problems.join('\n')).toContain('KOJO_GSC_VERIFICATION');
  });

  it('refuse un identifiant qui n’a pas la forme d’un flux GA4', () => {
    // Un ID de propriété UA ou une chaîne quelconque produit une balise morte :
    // la sonde dirait « PRÉSENT », l'analytics ne remonterait rien.
    const problems = missingInputs({ ...ready, KOJO_GA_MEASUREMENT_ID: 'UA-1234-5' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("n'a pas la forme d'un identifiant GA4");
  });

  it('en --dry-run, seul le jeton est exigé (lectures seules)', () => {
    expect(missingInputs({ VERCEL_TOKEN: 'vcp_test' }, { dryRun: true })).toEqual([]);
    expect(missingInputs({}, { dryRun: true }).join()).toContain('VERCEL_TOKEN');
  });
});

describe('charge utile d’une variable', () => {
  it('vise production ET preview, et reste relisible', () => {
    expect(envPayload('VITE_GA_MEASUREMENT_ID', GA)).toEqual({
      key: 'VITE_GA_MEASUREMENT_ID',
      value: GA,
      type: 'encrypted',
      target: ['production', 'preview'],
      comment: expect.any(String),
    });
  });
});

describe('le verdict de vérification', () => {
  const notices = (ga, gsc) => [
    `Google Analytics 4 : ${ga}`,
    `Search Console (balise meta) : ${gsc}`,
    'Plausible (facultatif) : ABSENT — poser VITE_PLAUSIBLE_DOMAIN dans Vercel → Settings → Environment Variables, puis REDÉPLOYER (les VITE_* sont inlinées au build).',
    '2/4 intégration(s) présente(s) sur https://kojoforafrica.cc.cd — ce rapport ne bloque rien (cf. CI-COVERAGE.md, F9).',
  ];

  it('ne trouve rien à redire quand les deux balises sont dans le HTML servi', () => {
    expect(verifyIntegrations(notices('PRÉSENT — gtag/js?id=G-ABC1234567', 'PRÉSENT — jeton jeton-gsc…'))).toEqual([]);
  });

  it('échoue en citant la ligne exacte quand une balise manque', () => {
    // « Déployé, donc c'est bon » est précisément ce que cette commande ne doit
    // pas faire : un déploiement READY ne prouve pas que la balise est servie.
    const problems = verifyIntegrations(notices('ABSENT — poser VITE_GA_MEASUREMENT_ID', 'PRÉSENT — jeton jeton-gsc…'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Google Analytics 4');
    expect(problems[0]).toContain('poser VITE_GA_MEASUREMENT_ID');
  });

  it('dit aussi qu’aucune conclusion n’a été publiée', () => {
    const problems = verifyIntegrations(['base locale (http://127.0.0.1:4319) : aucune conclusion publiée.']);
    expect(problems.join('\n')).toContain('aucune ligne dans le rapport');
    expect(problems.join('\n')).toContain('aucun décompte');
  });
});

describe('erreur de l’API Vercel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('remonte le message de l’API au lieu de l’avaler', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: { message: 'Not authorized' } }),
    }));
    await expect(vercelApi('/v9/projects/kojo', { token: 'vcp_bad' })).rejects.toThrow(
      /HTTP 403.*Not authorized/
    );
  });

  it('rend le corps brut quand la réponse n’est pas du JSON', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, text: async () => 'Bad gateway' }));
    await expect(vercelApi('/v9/projects/kojo', { token: 'vcp_bad' })).rejects.toThrow(/HTTP 500.*Bad gateway/);
  });
});
