/**
 * Preuve de la règle « aucun tiers avant interaction » — le module que la sonde
 * Chromium (`e2e/aucun-tiers-avant-interaction.spec.js`) exécute.
 *
 * Ce fichier ne prétend pas remplacer le parcours : il fixe le CONTRAT que le
 * parcours applique (qui est nôtre, qui est tiers, comment un refus se nomme)
 * et il COMPARE la règle dynamique au garde statique
 * (`check-shell-remote-resources.js`) sur des corpus choisis — ce que chacun voit,
 * et le trou que l'autre ferme.
 */
import { describe, expect, it } from 'vitest';
import { API_ORIGIN, SITE_ORIGIN } from '../site-meta.js';
import {
  CE_QUE_LE_GARDE_STATIQUE_VOIT,
  ceQueLeGardeStatiqueVoit,
  divergencesDeTiers,
  estTiers,
  nommerInitiateur,
  ORIGINES_AUTORISEES,
} from '../tiers-avant-interaction.js';

const PAGE = 'http://127.0.0.1:4173';

describe('tiers — qui est nôtre, qui est tiers', () => {
  it('accepte nos origines et le loopback, refuse tout le reste', () => {
    const notres = [
      '/assets/index-abc.js', // relative : servie par l'origine de la page
      'data:image/png;base64,AAAA',
      'mailto:contact@kojo.test',
      'tel:+22900000000',
      `${PAGE}/icons/icon-192x192.png`, // l'origine de la page elle-même
      'http://127.0.0.1:8123/api/health', // l'API de test, même machine, autre port
      'http://localhost:8123/api/health',
      'http://[::1]:8000/api/health', // IPv6 entre crochets : la même machine
      SITE_ORIGIN,
      API_ORIGIN,
    ];
    for (const url of notres) {
      expect(estTiers(url, { origineDeLaPage: PAGE }), `« ${url} » ne doit PAS être tiers`).toBe(false);
    }

    const tiers = [
      'https://cdn.test/lib.js',
      'https://fonts.googleapis.com/css2?family=Inter',
      'https://analytics.example/collect',
      '//tiers.test/pixel.gif', // relatif au protocole : hors de nos hôtes
      'https://127.0.0.1.evil.test/x', // un hôte qui IMITE un hôte local
    ];
    for (const url of tiers) {
      expect(estTiers(url, { origineDeLaPage: PAGE }), `« ${url} » DOIT être tiers`).toBe(true);
    }

    // …et un relatif-au-protocole vers NOUS reste nôtre.
    expect(estTiers('//127.0.0.1:9000/x', { origineDeLaPage: PAGE })).toBe(false);
  });

  it('lit la liste d’origines là où elle est possédée (site-meta), jamais recopiée', () => {
    expect(ORIGINES_AUTORISEES).toEqual([SITE_ORIGIN, API_ORIGIN]);
  });
});

describe('tiers — nommer un refus', () => {
  it('nomme l’initiateur : sa sorte, son URL et sa ligne', () => {
    expect(nommerInitiateur({ type: 'script', url: 'https://kojo.test/assets/index-abc.js', lineNumber: 120 })).toBe(
      'un script https://kojo.test/assets/index-abc.js:120'
    );
    expect(nommerInitiateur({ type: 'parser' })).toBe('l’analyseur HTML');
    expect(nommerInitiateur({ type: 'other' })).toBe('une source non nommée');
  });

  it('ne rend jamais un nom vide, même sans initiateur', () => {
    expect(nommerInitiateur(undefined)).toBe('initiateur inconnu');
    expect(nommerInitiateur({ type: 'inconnue' })).toBe('initiateur « inconnue »');
  });

  it('le refus porte la requête ET son initiateur', () => {
    const requetes = [
      { url: `${PAGE}/assets/index-abc.js`, sorte: 'script', initiateur: { type: 'parser' } },
      { url: 'https://cdn.test/lib.js', sorte: 'script', initiateur: { type: 'script', url: `${PAGE}/assets/index-abc.js`, lineNumber: 7 } },
    ];
    const divergences = divergencesDeTiers(requetes, { origineDeLaPage: PAGE });
    expect(divergences).toEqual([
      {
        url: 'https://cdn.test/lib.js',
        initiateur: `un script ${PAGE}/assets/index-abc.js:7`,
        sorte: 'script',
      },
    ]);
  });

  it('ne rend AUCUNE divergence quand tout est nôtre — le vert n’est pas un refus de principe', () => {
    const requetes = [
      { url: `${PAGE}/`, sorte: 'document', initiateur: { type: 'other' } },
      { url: 'http://127.0.0.1:8123/api/jobs', sorte: 'fetch', initiateur: { type: 'script', url: `${PAGE}/assets/index-abc.js`, lineNumber: 3 } },
    ];
    expect(divergencesDeTiers(requetes, { origineDeLaPage: PAGE })).toEqual([]);
  });
});

describe('tiers — la comparaison avec le garde statique', () => {
  it('le garde statique voit une ressource DISTANTE DÉCLARÉE', () => {
    const html = '<script src="https://cdn.test/lib.js"></script>';
    const declarees = ceQueLeGardeStatiqueVoit(html);
    expect(declarees.map((d) => d.url)).toContain('https://cdn.test/lib.js');
    // …et la règle dynamique la refuse aussi : les deux vues s’accordent.
    expect(estTiers(declarees[0].url, { origineDeLaPage: PAGE })).toBe(true);
  });

  it('il ne peut PAS voir une URL qui n’est pas dans le HTML — et il NOMME le garde qui la voit', () => {
    // Aucune déclaration dans le document : le garde statique est vert.
    expect(ceQueLeGardeStatiqueVoit('<div id="root"></div>')).toEqual([]);
    // Le code, lui, construit l’URL à l’exécution : la sonde la refuserait.
    const assemblee = `https://analytics.example/${['co', 'llect'].join('')}`;
    expect(estTiers(assemblee, { origineDeLaPage: PAGE })).toBe(true);
    // La liste des angles morts est PUBLIÉE, pas implicite, ET elle nomme le
    // garde qui la couvre — une URL écrite en clair vit dans les fichiers
    // livrés, que `check-origines-bundles.js` lit.
    const anglesMorts = CE_QUE_LE_GARDE_STATIQUE_VOIT.nePeutPasVoir.join(' ');
    expect(anglesMorts).toMatch(/origines-bundles\.js/);
    expect(anglesMorts).toMatch(/HTML publié/);
    expect(CE_QUE_LE_GARDE_STATIQUE_VOIT.voit.length).toBeGreaterThanOrEqual(3);
  });

  it('le garde statique LIT vraiment : une ressource déclarée ne se confond pas avec zéro lecture', () => {
    const html =
      '<link rel="stylesheet" href="/assets/index-abc.css">' +
      '<script type="module" src="/assets/index-abc.js"></script>';
    expect(ceQueLeGardeStatiqueVoit(html).length).toBe(2);
  });
});
