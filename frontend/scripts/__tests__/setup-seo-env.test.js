/**
 * Tests de scripts/setup-seo-env.js — les parties qui DÉCIDENT, sans réseau.
 *
 * L'unité d'écriture est la VARIABLE (décision du 20/09/2026) : une valeur non
 * fournie laisse les autres passer et se nomme, alors qu'une valeur fournie mais
 * inutilisable fait échouer la commande. Ce qui est vérifié ici, et rien de
 * plus : ce partage, le fait qu'une valeur absente n'est jamais écrite (une
 * chaîne vide remplacerait la configuration en place), le verdict de
 * vérification qui ÉCHOUE quand le HTML ne porte pas une balise FOURNIE (sinon
 * la commande dirait « déployé, donc c'est bon »), et une erreur de l'API qui
 * remonte au lieu d'être avalée.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blockingInputs,
  envPayload,
  planWrites,
  vercelApi,
  verifyIntegrations,
} from '../setup-seo-env.js';

const GA = 'G-ABC1234567';
const GSC = 'jeton-gsc-abc123';
const ready = { VERCEL_TOKEN: 'vcp_test', KOJO_GA_MEASUREMENT_ID: GA, KOJO_GSC_VERIFICATION: GSC };

describe('ce qui rend la commande impossible (et rien d’autre)', () => {
  it('ne manque rien quand les trois valeurs sont là', () => {
    expect(blockingInputs(ready)).toEqual([]);
  });

  it('nomme le jeton absent, et le fait qu’aucune valeur n’est fournie', () => {
    const problems = blockingInputs({});
    expect(problems.join('\n')).toContain('VERCEL_TOKEN');
    expect(problems.join('\n')).toContain('aucune valeur à poser');
  });

  it('une SEULE valeur suffit à lancer : l’absente est nommée, pas bloquante', () => {
    // Le point de la décision du 20/09/2026 : la valeur de Search Console était
    // fournie depuis le 18/09 et n'a jamais atteint la production, faute de
    // GA4. Une intégration ne bloque plus sa voisine.
    expect(blockingInputs({ VERCEL_TOKEN: 'vcp_test', KOJO_GSC_VERIFICATION: GSC })).toEqual([]);
    expect(blockingInputs({ VERCEL_TOKEN: 'vcp_test', KOJO_GA_MEASUREMENT_ID: GA })).toEqual([]);
  });

  it('en --dry-run, seul le jeton est exigé (lectures seules)', () => {
    expect(blockingInputs({ VERCEL_TOKEN: 'vcp_test' }, { dryRun: true })).toEqual([]);
    expect(blockingInputs({}, { dryRun: true }).join()).toContain('VERCEL_TOKEN');
  });
});

describe('le plan, par variable', () => {
  it('écrit les deux valeurs quand les deux sont fournies', () => {
    const { writes, absent, invalid } = planWrites(ready);
    expect(writes.map((write) => write.key)).toEqual(['VITE_GA_MEASUREMENT_ID', 'VITE_GSC_VERIFICATION']);
    expect(absent).toEqual([]);
    expect(invalid).toEqual([]);
  });

  it('écrit la moitié disponible et NOMME l’autre', () => {
    const { writes, absent, invalid } = planWrites({ KOJO_GSC_VERIFICATION: GSC });
    expect(writes.map((write) => write.key)).toEqual(['VITE_GSC_VERIFICATION']);
    expect(absent.join('\n')).toContain('Google Analytics 4');
    expect(absent.join('\n')).toContain('KOJO_GA_MEASUREMENT_ID');
    expect(invalid).toEqual([]);
  });

  it('n’écrit JAMAIS une valeur absente', () => {
    // Une chaîne vide remplacerait la configuration en place par du vide : la
    // raison d'être de l'ancien tout-ou-rien, tenue ici variable par variable.
    const { writes } = planWrites({ KOJO_GA_MEASUREMENT_ID: '   ' });
    expect(writes).toEqual([]);
  });

  it('refuse un identifiant qui n’a pas la forme d’un flux GA4, sans bloquer la voisine', () => {
    // Un ID de propriété UA ou une chaîne quelconque produit une balise morte :
    // la sonde dirait « PRÉSENT », l'analytics ne remonterait rien.
    const { writes, invalid } = planWrites({ ...ready, KOJO_GA_MEASUREMENT_ID: 'UA-1234-5' });
    expect(writes.map((write) => write.key)).toEqual(['VITE_GSC_VERIFICATION']);
    expect(invalid).toHaveLength(1);
    // Ce qui doit s'y lire : le coupable nommé (la variable ET la valeur), et la
    // conséquence (une balise morte annoncée « PRÉSENT ») — pas une formulation.
    expect(invalid[0]).toContain('KOJO_GA_MEASUREMENT_ID');
    expect(invalid[0]).toContain('UA-1234-5');
    expect(invalid[0]).toContain('balise morte');
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

  it('ne vérifie QUE ce qui a été écrit (une intégration non fournie n’est pas un échec)', () => {
    // Sinon la commande reprocherait l'absence de GA4 alors qu'elle n'a jamais
    // eu sa valeur à poser : c'est la sonde stricte qui porte ce rouge-là.
    expect(verifyIntegrations(notices('ABSENT — poser VITE_GA_MEASUREMENT_ID', 'PRÉSENT — jeton jeton-gsc…'), ['Search Console (balise meta)'])).toEqual([]);
    // Non-vacuité : la même lecture rougit bien quand la balise ÉCRITE manque.
    expect(verifyIntegrations(notices('ABSENT — poser VITE_GA_MEASUREMENT_ID', 'PRÉSENT — jeton jeton-gsc…'), ['Google Analytics 4'])).toHaveLength(1);
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
