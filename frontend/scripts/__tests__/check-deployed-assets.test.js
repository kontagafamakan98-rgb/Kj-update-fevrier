/**
 * @vitest-environment node
 *
 * Garde-fou des ACTIFS et CONTENUS servis (scripts/check-deployed-assets.js).
 *
 * ── Le faux-vert que ce test empêche ────────────────────────────────────────
 * Le garde de révision prouve que le HTML servi vient de `main` ; il ne dit rien
 * du JS, du CSS ni des polices que ce HTML charge. Un déploiement mixte — HTML
 * neuf, actifs restés en arrière — servirait donc une page qui ne correspond pas
 * à son bundle, et `main` resterait vert. Cette sonde suit la chaîne
 * HTML → manifeste → actifs : elle ne vaut que si chaque maillon REFUSE quand il
 * ne correspond pas, et si elle refuse aussi de conclure sur du vide.
 *
 * Ce test pilote le VRAI script (importé, pas recopié) avec un `fetch` fabriqué —
 * aucun réseau — plus UN aller-retour sur un serveur HTTP local, pour prouver que
 * les URL et les octets réels suivent le même chemin que dans le verdict.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUILD_ASSETS_META,
  ECHANTILLON_CONTENU,
  MANIFESTE_ACTIFS,
  SITE_ORIGIN,
  plagesContenu,
} from '../site-meta.js';
import { BYPASS_ENV, BYPASS_HEADER, MARQUE_PREMISSE } from '../preview-vercel.js';
import {
  BUDGET_CONTENUS,
  MAX_ACTIFS,
  MIN_ACTIFS,
  cheminValide,
  ecrireResume,
  empreinte,
  lignesCout,
  lireManifeste,
  lireOptions,
  main,
  manifesteAnnonce,
  murDeProtection,
  verifier,
} from '../check-deployed-assets.js';

/** Six actifs : au-dessus du plancher, comme un vrai build. */
const ACTIFS = {
  '/assets/index-abc123.js': 'console.log("entrée")',
  '/assets/index-abc123.css': 'body{color:#111}',
  '/assets/vendor-def456.js': 'export const v = 1',
  '/assets/chunk-ghi789.js': 'export const c = 1',
  '/fonts/inter-variable-latin.woff2': 'faux woff2 inter',
  '/fonts/cormorant-garamond-variable-latin.woff2': 'faux woff2 cormorant',
};

/**
 * Trois CONTENUS, dont les trois formes qui comptent : une carte plus petite que
 * l'échantillon (tête = queue = fichier), une grande image dont le milieu diffère
 * des bords, et une image de héros banale. C'est ce que le manifeste décrit par
 * ÉCHANTILLON au lieu de hacher des mégaoctets.
 */
const CONTENUS = {
  '/og-jobs.png': 'carte og des missions',
  '/icons/icon-512x512.png':
    'A'.repeat(ECHANTILLON_CONTENU) + 'milieu' + 'Z'.repeat(ECHANTILLON_CONTENU),
  '/assets/kojo-hero.jpg': 'H'.repeat(ECHANTILLON_CONTENU * 4),
};

const octets = (valeur) => (typeof valeur === 'string' ? new TextEncoder().encode(valeur) : valeur);

function réponse({ statut = 200, corps = '', entetes = {} } = {}) {
  const tampon = octets(corps);
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    headers: { get: (nom) => entetes[String(nom).toLowerCase()] ?? null },
    body: { cancel: async () => {} },
    arrayBuffer: async () => tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + tampon.byteLength),
    text: async () => new TextDecoder().decode(tampon),
  };
}

/** L'entrée de manifeste d'un contenu : la même règle que le plugin du build. */
function entreeDe(valeur) {
  const tampon = octets(valeur);
  const echantillon = Math.min(ECHANTILLON_CONTENU, tampon.length);
  const entree = { taille: tampon.length, echantillon };
  // Les plages viennent de la MÊME fonction que le build et la sonde : un test
  // qui recopierait la règle du milieu divergerait avec elle en silence.
  for (const { champ, debut, fin } of plagesContenu(tampon.length, echantillon)) {
    entree[champ] = empreinte(tampon.subarray(debut, fin + 1));
  }
  return entree;
}

/**
 * Un site fabriqué : le HTML, son manifeste, et les octets de chaque fichier.
 * `remplacements` sert à servir AUTRE CHOSE que ce que le manifeste déclare.
 *
 * Les CONTENUS répondent aux plages (`Range` → 206 + `Content-Range`), comme un
 * CDN : c'est la seule lecture qui permet à la sonde de rester sous son budget.
 * `ignorerPlages` simule l'autre serveur — celui qui renvoie le fichier entier.
 */
function siteFabriqué({
  actifs = ACTIFS,
  contenus = CONTENUS,
  manifeste,
  annonce,
  remplacements = {},
  // Un octet changé au MILIEU servi, taille inchangée : la tête et la queue
  // restent celles du build — exactement ce que deux blocs laissaient passer.
  milieuModifie = {},
  statuts = {},
  ignorerPlages = false,
} = {}) {
  const octetsActifs = {};
  const fichiers = {};
  for (const [chemin, contenu] of Object.entries(actifs)) {
    octetsActifs[chemin] = octets(contenu);
    fichiers[chemin] = empreinte(octetsActifs[chemin]);
  }
  const octetsContenus = {};
  const contenuManifeste = {};
  for (const [chemin, contenu] of Object.entries(contenus)) {
    octetsContenus[chemin] = octets(contenu);
    contenuManifeste[chemin] = entreeDe(contenu);
  }
  const corpsManifeste = manifeste
    ?? JSON.stringify({ fichiers, contenus: contenuManifeste }, null, 2) + '\n';
  const empreinteAnnoncée = annonce ?? empreinte(corpsManifeste);
  const html = `<!doctype html><html><head><title>Kojo</title>` +
    `<meta name="${BUILD_ASSETS_META}" content="${empreinteAnnoncée}"></head><body></body></html>`;

  const fetchImpl = vi.fn(async (url, options = {}) => {
    const chemin = new URL(url).pathname;
    if (statuts[chemin]) return réponse({ statut: statuts[chemin] });
    if (chemin === '/') return réponse({ corps: html });
    if (chemin === MANIFESTE_ACTIFS) return réponse({ corps: corpsManifeste });

    if (chemin in octetsContenus) {
      let servi = chemin in remplacements ? octets(remplacements[chemin]) : octetsContenus[chemin];
      if (chemin in milieuModifie) {
        servi = Uint8Array.from(servi);
        const index = milieuModifie[chemin];
        servi[index] = servi[index] ^ 1;
      }
      const plage = /bytes=(\d+)-(\d+)/.exec(String(options.headers?.range ?? ''));
      if (!plage || ignorerPlages) return réponse({ corps: servi });
      const debut = Number(plage[1]);
      const fin = Number(plage[2]);
      return réponse({
        statut: 206,
        corps: servi.subarray(debut, fin + 1),
        entetes: { 'content-range': `bytes ${debut}-${fin}/${servi.length}` },
      });
    }

    if (chemin in remplacements) return réponse({ corps: remplacements[chemin] });
    if (octetsActifs[chemin]) return réponse({ corps: octetsActifs[chemin] });
    return réponse({ statut: 404 });
  });

  return { fetchImpl, fichiers, contenuManifeste, corpsManifeste, empreinteAnnoncée };
}

describe('check-deployed-assets — lire ce qui est publié', () => {
  it('lit l’empreinte du manifeste annoncée par le HTML, et la refuse si elle est mal formée', () => {
    const { empreinteAnnoncée } = siteFabriqué();
    const html = `<html><head><meta name="${BUILD_ASSETS_META}" content="${empreinteAnnoncée}"></head></html>`;
    expect(manifesteAnnonce(html)).toBe(empreinteAnnoncée);
    // Un préfixe n'est pas une empreinte : il accepterait le manifeste d'un autre build.
    expect(manifesteAnnonce(`<meta name="${BUILD_ASSETS_META}" content="${empreinteAnnoncée.slice(0, 12)}">`)).toBe('');
    expect(manifesteAnnonce('<html></html>')).toBe('');
  });

  it('valide chaque entrée du manifeste : octets, chemin sur CE site, aucune évasion', () => {
    const hachés = Object.fromEntries(Object.entries(ACTIFS).map(([c, v]) => [c, empreinte(v)]));
    const contenus = Object.fromEntries(Object.entries(CONTENUS).map(([c, v]) => [c, entreeDe(v)]));
    const lu = lireManifeste(JSON.stringify({ fichiers: hachés, contenus }));
    expect(lu.erreur).toBeNull();
    expect(lu.fichiers.map((f) => f.chemin)).toEqual(Object.keys(ACTIFS).sort());
    expect(lu.contenus.map((c) => c.chemin)).toEqual(Object.keys(CONTENUS).sort());

    expect(cheminValide('/assets/a.js')).toBe(true);
    for (const mauvais of ['../secret.js', 'https://ailleurs.test/a.js', '//ailleurs.test/a.js', '/assets/a.js?x=1', 'assets/a.js', '\\assets\\a.js', MANIFESTE_ACTIFS]) {
      expect(cheminValide(mauvais), mauvais).toBe(false);
    }
  });

  it('refuse un manifeste SANS section « contenus » : muet sur les images n’est pas muet pour autant', () => {
    // Un artefact sans section contenus ferait passer les images pour vérifiées
    // alors que rien ne l'est : c'est exactement le faux vert à éviter.
    const hachés = Object.fromEntries(Object.entries(ACTIFS).map(([c, v]) => [c, empreinte(v)]));
    const lu = lireManifeste(JSON.stringify({ fichiers: hachés }));
    expect(lu.erreur).toContain('sans objet « contenus »');
    expect(lu.contenus).toEqual([]);
  });

  it('refuse un échantillon plus GRAND que ce que la sonde s’autorise à lire', () => {
    // Le manifeste est une donnée SERVIE : il ne décide pas du budget.
    const grand = CONTENUS['/assets/kojo-hero.jpg'];
    const entree = { ...entreeDe(grand), echantillon: ECHANTILLON_CONTENU * 2 };
    const hachés = Object.fromEntries(Object.entries(ACTIFS).map(([c, v]) => [c, empreinte(v)]));
    const lu = lireManifeste(
      JSON.stringify({ fichiers: hachés, contenus: { '/assets/kojo-hero.jpg': entree } })
    );
    expect(lu.erreur).toContain('au-delà du plafond');
  });

  it('refuse une entrée MUETTE sur le MILIEU d’une image assez grande', async () => {
    // Un manifeste qui ne publierait que les deux bords laisserait le centre du
    // fichier hors de tout verdict : c'est le faux vert que le milieu ferme.
    const entree = entreeDe(CONTENUS['/assets/kojo-hero.jpg']);
    expect(entree.milieu).toBeDefined();
    delete entree.milieu;
    const hachés = Object.fromEntries(Object.entries(ACTIFS).map(([c, v]) => [c, empreinte(v)]));
    const lu = lireManifeste(
      JSON.stringify({ fichiers: hachés, contenus: { '/assets/kojo-hero.jpg': entree } })
    );
    expect(lu.contenus).toEqual([]);
    expect(lu.erreur).toContain('milieu');
  });

  it('n’exige pas de MILIEU quand tête et queue couvrent déjà tout le fichier', async () => {
    // La carte OG est plus petite qu'un bloc : sa tête est tout le fichier, et
    // une troisième lecture serait payée pour un fait déjà connu.
    const entree = entreeDe(CONTENUS['/og-jobs.png']);
    expect(entree.milieu).toBeUndefined();
    const hachés = Object.fromEntries(Object.entries(ACTIFS).map(([c, v]) => [c, empreinte(v)]));
    const lu = lireManifeste(
      JSON.stringify({ fichiers: hachés, contenus: { '/og-jobs.png': entree } })
    );
    expect(lu.erreur).toBeNull();
    expect(lu.contenus).toHaveLength(1);
    // Une seule lecture : tête et queue sont le même bloc.
    expect(lu.contenus[0].lectures).toHaveLength(1);
  });
});

describe('check-deployed-assets — le verdict, et ce qu’il nomme', () => {
  it('accepte quand chaque actif porte l’empreinte publiée et chaque contenu son échantillon', async () => {
    const { fetchImpl } = siteFabriqué();
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl });
    expect(verdict.ok).toBe(true);
    expect(verdict.nombre).toBe(Object.keys(ACTIFS).length);
    expect(verdict.contenus.total).toBe(Object.keys(CONTENUS).length);
    expect(verdict.contenus.échantillonnés).toBe(Object.keys(CONTENUS).length);
    expect(verdict.contenus.partiel).toBe(false);
    // Le budget n'est consommé que par les échantillons (au plus trois blocs
    // par contenu), jamais par le fichier.
    expect(verdict.contenus.octets).toBeLessThan(ECHANTILLON_CONTENU * 3 * 3 + 64);
    expect(verdict.message).toContain("manifeste est bien celui qu'annonce l'artefact");
    expect(verdict.message).toContain('3 contenu(s) sur 3');
  });

  it('refuse un actif dont les octets diffèrent, en nommant le chemin et les deux empreintes', async () => {
    // Le déploiement mixte : le manifeste est celui du build, le fichier servi non.
    const site = siteFabriqué({ remplacements: { '/assets/index-abc123.js': 'console.log("ancien")' } });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.écarts).toHaveLength(1);
    expect(verdict.message).toContain('/assets/index-abc123.js');
    expect(verdict.message).toContain(site.fichiers['/assets/index-abc123.js'].slice(0, 12));
    expect(verdict.message).toContain(empreinte('console.log("ancien")').slice(0, 12));
    expect(verdict.message).toMatch(/1 actif\(s\) sur 6/);
  });

  it('refuse un manifeste qui n’est PAS celui de l’artefact (deux builds mélangés)', async () => {
    const site = siteFabriqué({ annonce: 'a'.repeat(64) });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("n'est PAS celui qu'annonce l'artefact");
    expect(verdict.message).toContain('annoncé=aaaaaaaaaaaa');
  });

  it('refuse un artefact antérieur qui n’annonce aucune empreinte, sans même lire le manifeste', async () => {
    const fetchImpl = vi.fn(async () => réponse({ corps: '<html><head></head><body></body></html>' }));
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('AUCUNE empreinte');
    expect(verdict.message).toContain(BUILD_ASSETS_META);
    expect(verdict.message).toMatch(/Redéployer/);
    // Une seule requête : l'ancre manque, rien d'autre ne peut être jugé.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuse un manifeste sous le plancher au lieu de rendre un vert sur du vide', async () => {
    const réduits = Object.fromEntries(Object.entries(ACTIFS).slice(0, MIN_ACTIFS - 1));
    const site = siteFabriqué({ actifs: réduits });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(`sous le plancher de ${MIN_ACTIFS}`);
  });

  it('refuse un manifeste au-delà du plafond', async () => {
    const énormes = {};
    for (let i = 0; i < MAX_ACTIFS + 1; i += 1) énormes[`/assets/x${i}.js`] = `x${i}`;
    const site = siteFabriqué({ actifs: énormes });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(`au-delà du plafond de ${MAX_ACTIFS}`);
  });

  it('refuse un actif absent (404), en nommant son chemin et son statut', async () => {
    const site = siteFabriqué({ statuts: { '/assets/chunk-ghi789.js': 404 } });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('/assets/chunk-ghi789.js');
    expect(verdict.message).toContain('HTTP 404');
  });

  it('refuse un manifeste illisible ou porteur d’un chemin hors du site', async () => {
    const cassé = siteFabriqué({ manifeste: '{"fichiers":' });
    const verdictCassé = await verifier({ base: 'https://exemple.test', fetchImpl: cassé.fetchImpl });
    expect(verdictCassé.ok).toBe(false);
    expect(verdictCassé.message).toContain('non JSON');

    const mauvais = JSON.stringify({ fichiers: { ...Object.fromEntries(Object.entries(ACTIFS).map(([c, v]) => [c, empreinte(v)])), '../secret.js': 'a'.repeat(64) } });
    const site = siteFabriqué({ manifeste: mauvais });
    const verdictMauvais = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdictMauvais.ok).toBe(false);
    expect(verdictMauvais.message).toContain("chemin d'actif refusé");
    expect(verdictMauvais.message).toContain('../secret.js');
  });

  it('refuse une production injoignable au lieu de conclure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'TypeError' });
    });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('aucune réponse exploitable');
    expect(verdict.message).toContain('TypeError');
  });

  it('sort en code 2 (invocation impossible) sur une base locale, pas en vert', async () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['--base', 'http://localhost:4173'])).toBe(2);
    expect(erreur.mock.calls.flat().join(' ')).toContain('invocation impossible');
    erreur.mockRestore();
  });
});

describe('check-deployed-assets — les CONTENUS, échantillonnés sous budget', () => {
  it('refuse une image dont la TÊTE diffère, en la nommant', async () => {
    const original = CONTENUS['/icons/icon-512x512.png'];
    const site = siteFabriqué({
      // Même taille, même queue : seul le PREMIER octet change.
      remplacements: { '/icons/icon-512x512.png': 'B' + original.slice(1) },
    });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('/icons/icon-512x512.png');
    expect(verdict.message).toContain('tête');
    expect(verdict.message).toMatch(/contenu\(s\) sur 3/);
  });

  it('refuse une image dont seule la QUEUE diffère (déploiement mixte discret)', async () => {
    const original = CONTENUS['/icons/icon-512x512.png'];
    // Même taille, mêmes premiers octets : seule la fin change — exactement ce
    // qu'un échantillon de TÊTE seule raterait.
    const remplacé = original.slice(0, -1) + 'Y';
    const site = siteFabriqué({ remplacements: { '/icons/icon-512x512.png': remplacé } });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('queue');
  });

  it('refuse une image dont seul le MILIEU diffère (tête et queue intactes)', async () => {
    // Le faux vert que le milieu ferme : une retouche au centre du fichier
    // laissait les deux bords identiques, donc deux blocs rendaient un vert.
    const hero = CONTENUS['/assets/kojo-hero.jpg'];
    const site = siteFabriqué({
      milieuModifie: { '/assets/kojo-hero.jpg': ECHANTILLON_CONTENU * 2 },
    });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });

    expect(hero.length).toBeGreaterThan(ECHANTILLON_CONTENU * 3);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('/assets/kojo-hero.jpg');
    // L'écart nomme l'ENDROIT : c'est le milieu qui a bougé, pas un bord.
    expect(verdict.message).toContain('milieu');
    expect(verdict.message).not.toContain('(tête)');
    expect(verdict.message).not.toContain('(queue)');
  });

  it('refuse une image dont la TAILLE servie n’est pas celle du build', async () => {
    const site = siteFabriqué({
      remplacements: { '/icons/icon-512x512.png': CONTENUS['/icons/icon-512x512.png'] + 'extra' },
    });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/taille servie \d+ ≠ \d+ octets du build/);
  });

  it('refuse un serveur qui ignore les plages : l’échantillon coûterait le fichier entier', async () => {
    const site = siteFabriqué({ ignorerPlages: true });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('ignore les plages');
    expect(verdict.message).toContain('PAS vérifiées');
  });

  it('refuse de conclure quand le budget ne couvre AUCUN contenu', async () => {
    const site = siteFabriqué();
    const verdict = await verifier({
      base: 'https://exemple.test',
      fetchImpl: site.fetchImpl,
      budgetContenus: 0,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('aucun des 3 contenu(s)');
    expect(verdict.message).toContain('PAS vérifiées');
  });

  it('déclare les contenus NON échantillonnés quand le budget s’épuise (jamais un vert muet)', async () => {
    const site = siteFabriqué();
    // Premier contenu trié : le héros (tête, milieu, queue — 12 Kio) ; les deux
    // suivants ne tiennent plus, et ne doivent donc pas être comptés vérifiés.
    const verdict = await verifier({
      base: 'https://exemple.test',
      fetchImpl: site.fetchImpl,
      budgetContenus: ECHANTILLON_CONTENU * 3,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.contenus.échantillonnés).toBe(1);
    expect(verdict.contenus.partiel).toBe(true);
    expect(verdict.message).toContain('1 contenu(s) sur 3');
    expect(verdict.message).toContain('2 contenu(s) NON échantillonné(s)');
  });

  it('publie un ::warning quand l’échantillon est borné, puis rend un vert explicite', async () => {
    // Une production dont les images dépassent le budget : les actifs de code
    // restent vérifiés en entier, et la troncature est PUBLIÉE (le lecteur du
    // run doit pouvoir distinguer « tout vérifié » de « échantillon borné »).
    const beaucoup = {};
    // Images plus grandes que deux blocs : chacune coûte trois plages (12 Kio),
    // donc 70 images dépassent le budget de 768 Kio.
    for (let i = 0; i < 70; i += 1) {
      beaucoup[`/img/${String(i).padStart(3, '0')}.png`] = 'I'.repeat(ECHANTILLON_CONTENU * 2 + 1);
    }
    const site = siteFabriqué({ contenus: beaucoup });
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', site.fetchImpl);
    try {
      expect(await main(['--base', 'https://exemple.test'])).toBe(0);
      const lignes = journal.mock.calls.flat().join('\n');
      expect(lignes).toContain('::warning title=Contenus servis — échantillon borné');
      // 768 Kio / 12 Kio par image = 64 images échantillonnées, 6 non lues.
      expect(lignes).toMatch(/64 contenu\(s\) sur 70/);
      expect(lignes).toContain('::notice title=Actifs servis');
    } finally {
      journal.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('check-deployed-assets — un vrai serveur, les vrais octets', () => {
  let serveur = null;

  afterEach(async () => {
    if (serveur) await new Promise((r) => serveur.close(r));
    serveur = null;
  });

  /**
   * Sert le site fabriqué sur un port libre ; `remplacements` s'applique au vol.
   *
   * Les CONTENUS répondent aux plages comme un CDN (`206` + `Content-Range`) :
   * c'est le SEUL chemin que la sonde emprunte pour une image, et un serveur de
   * test qui renverrait toujours `200` ne prouverait rien de ce chemin.
   */
  async function servir(remplacements = {}) {
    const actifs = Object.fromEntries(Object.entries(ACTIFS).map(([c, v]) => [c, Buffer.from(v, 'utf8')]));
    const fichiers = Object.fromEntries(Object.entries(actifs).map(([c, v]) => [c, empreinte(v)]));
    const contenus = Object.fromEntries(Object.entries(CONTENUS).map(([c, v]) => [c, Buffer.from(v, 'utf8')]));
    const contenuManifeste = Object.fromEntries(Object.entries(CONTENUS).map(([c, v]) => [c, entreeDe(v)]));
    const corpsManifeste = JSON.stringify({ fichiers, contenus: contenuManifeste }, null, 2) + '\n';
    const html = `<!doctype html><html><head><meta name="${BUILD_ASSETS_META}" content="${empreinte(corpsManifeste)}"></head><body></body></html>`;
    serveur = createServer((req, res) => {
      const chemin = new URL(req.url, 'http://x').pathname;
      if (chemin === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
      if (chemin === MANIFESTE_ACTIFS) { res.end(corpsManifeste); return; }
      const remplacé = remplacements[chemin];
      const contenu = remplacé !== undefined ? Buffer.from(remplacé) : contenus[chemin];
      if (contenu && chemin in contenus) {
        const plage = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range ?? ''));
        if (plage) {
          const debut = Number(plage[1]);
          const fin = Math.min(Number(plage[2]), contenu.length - 1);
          res.writeHead(206, {
            'content-type': 'application/octet-stream',
            'content-range': `bytes ${debut}-${fin}/${contenu.length}`,
          });
          res.end(contenu.subarray(debut, fin + 1));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(contenu);
        return;
      }
      const corps = remplacé ?? actifs[chemin];
      if (!corps) { res.writeHead(404); res.end('absent'); return; }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.from(corps));
    });
    await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
    const { port } = serveur.address();
    return `http://127.0.0.1:${port}`;
  }

  it('accepte les octets réels servis, puis refuse le même site avec un fichier réécrit', async () => {
    const base = await servir();
    const vert = await verifier({ base });
    expect(vert.ok, vert.message).toBe(true);
    expect(vert.nombre).toBe(6);
    // Les trois contenus ont été échantillonnés sur un vrai serveur, en plages.
    expect(vert.contenus.échantillonnés).toBe(Object.keys(CONTENUS).length);
    expect(vert.contenus.partiel).toBe(false);

    await new Promise((r) => serveur.close(r));
    serveur = null;
    const baseMixte = await servir({ '/assets/vendor-def456.js': 'export const v = 2' });
    const rouge = await verifier({ base: baseMixte });
    expect(rouge.ok).toBe(false);
    expect(rouge.message).toContain('/assets/vendor-def456.js');
  });
});

describe('check-deployed-assets — le coût de la sonde est PUBLIÉ', () => {
  /**
   * Le faux-vert que cette section empêche : une sonde qui grossit en silence.
   *
   * Le budget des contenus est aujourd'hui tenu, mais le manifeste gagne une
   * image à chaque ajout et les actifs de code sont lus en entier : sans chiffre
   * publié, la dépense réelle ne se voit que le jour où le budget refuse — et le
   * refus tombe alors sur la livraison qui n'a rien changé.
   */
  it('compte les octets RÉELLEMENT téléchargés, pas le budget réservé', async () => {
    const site = siteFabriqué();
    const attendu = { requêtes: 0, octets: 0 };
    const fetchCompté = vi.fn(async (url, options = {}) => {
      const réponse = await site.fetchImpl(url, options);
      // Les octets sont comptés UNE fois, puis servis depuis ce même tampon :
      // compter sur une lecture et en servir une autre mesurerait un corps que
      // la sonde n'a pas réellement lu.
      const tampon = await réponse.arrayBuffer();
      attendu.requêtes += 1;
      attendu.octets += tampon.byteLength;
      return { ...réponse, arrayBuffer: async () => tampon };
    });
    const verdict = await verifier({ base: 'https://exemple.test', fetchImpl: fetchCompté });
    expect(verdict.ok).toBe(true);
    // Chaque octet compté correspond à un corps effectivement reçu : une sonde
    // qui publierait le budget THÉORIQUE au lieu du téléchargement réel
    // annoncerait un coût que personne ne peut rapprocher du réseau.
    expect(verdict.coût.octets).toBe(attendu.octets);
    expect(verdict.coût.requêtes).toBe(attendu.requêtes);
    expect(verdict.coût.duréeMs).toBeGreaterThanOrEqual(0);
    // Les actifs de code sont lus en entier : le coût dépasse donc de loin le
    // seul échantillon des contenus.
    expect(verdict.coût.octets).toBeGreaterThan(verdict.contenus.octets);
  });

  it('publie le coût mesuré (fichiers, octets, durée, budget) dans le résumé du run', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'actifs-resume-'));
    const resume = join(dossier, 'summary.md');
    const site = siteFabriqué();
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', site.fetchImpl);
    try {
      const mesure = await verifier({ base: 'https://exemple.test', fetchImpl: site.fetchImpl });
      expect(await main(['--base', 'https://exemple.test'], { resumePath: resume })).toBe(0);

      const contenu = readFileSync(resume, 'utf8');
      expect(contenu).toContain('Sonde des actifs servis — conforme');
      expect(contenu).toContain(`- ${Object.keys(ACTIFS).length} actif(s) de code jugé(s) en entier`);
      expect(contenu).toContain(`- ${Object.keys(CONTENUS).length} contenu(s) sur ${Object.keys(CONTENUS).length} échantillonné(s)`);
      // Le chiffre publiable est l'octet brut : c'est celui qu'on peut rapprocher
      // des journaux du CDN et de la facture de bande passante.
      expect(contenu).toContain(`${mesure.coût.octets} o`);
      expect(contenu).toMatch(/téléchargés en \d+ requête\(s\)/);
      expect(contenu).toMatch(/durée \d+,\d s/);
      expect(contenu).toContain(`budget des contenus : ${mesure.contenus.octets} o (`);
      expect(contenu).toContain(`sur ${BUDGET_CONTENUS} o (`);
      expect(contenu).toContain('échantillon complet');

      // La même phrase part sur la sortie standard : `npm run livrer` n'a pas de
      // résumé de run, et la mesure doit tomber dans le terminal de l'auteur.
      expect(journal.mock.calls.flat().join('\n')).toContain('::notice title=Coût de la sonde::');
    } finally {
      journal.mockRestore();
      vi.unstubAllGlobals();
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('publie le coût même quand la sonde REFUSE (la dépense ne dépend pas du verdict)', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'actifs-resume-refus-'));
    const resume = join(dossier, 'summary.md');
    const site = siteFabriqué({ remplacements: { '/assets/index-abc123.js': 'console.log("ancien")' } });
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', site.fetchImpl);
    try {
      expect(await main(['--base', 'https://exemple.test'], { resumePath: resume })).toBe(1);
      const contenu = readFileSync(resume, 'utf8');
      expect(contenu).toContain('Sonde des actifs servis — refus');
      expect(contenu).toContain('Motif :');
      // Des octets ont été téléchargés avant le refus : les taire ferait lire
      // « sonde gratuite » là où la mesure a coûté des requêtes.
      expect(contenu).toMatch(/\d+ o \([^)]*\) téléchargés en [1-9]\d* requête\(s\)/);
      expect(journal.mock.calls.flat().join('\n')).toContain('::error title=Actifs servis');
    } finally {
      journal.mockRestore();
      vi.unstubAllGlobals();
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('déclare dans le résumé un échantillon borné, avec le budget et le reste non lu', async () => {
    const site = siteFabriqué();
    const verdict = await verifier({
      base: 'https://exemple.test',
      fetchImpl: site.fetchImpl,
      budgetContenus: ECHANTILLON_CONTENU * 3,
    });
    expect(verdict.ok).toBe(true);
    const phrase = lignesCout(verdict).join(' ; ');
    expect(phrase).toContain(`budget des contenus : ${ECHANTILLON_CONTENU * 3} o (`);
    expect(phrase).toContain(`sur ${ECHANTILLON_CONTENU * 3} o (`);
    expect(phrase).toContain('épuisé, 2 contenu(s) NON échantillonné(s)');

    // Et la même vérité traverse l'écriture du résumé, jamais un « conforme » nu.
    const dossier = mkdtempSync(join(tmpdir(), 'actifs-resume-borne-'));
    const resume = join(dossier, 'summary.md');
    try {
      ecrireResume(verdict, resume);
      const contenu = readFileSync(resume, 'utf8');
      expect(contenu).toContain('conforme');
      expect(contenu).toContain('épuisé, 2 contenu(s) NON échantillonné(s)');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('n’écrit rien hors de GitHub (variable absente) : la mesure reste sur la sortie standard', () => {
    const verdict = { ok: true, nombre: 6, contenus: null, coût: { octets: 1, requêtes: 1, duréeMs: 1 } };
    expect(() => ecrireResume(verdict, '')).not.toThrow();
  });
});

describe('check-deployed-assets — la même chaîne sur la PREVIEW d’une PR', () => {
  /**
   * Le faux-vert que cette section empêche : un artefact de PR déclaré conforme
   * sans avoir été lu. La sonde ne jugeait que `main` ; ici elle juge le
   * déploiement de LA RÉVISION poussée, et elle refuse de confondre les trois
   * autres cas (prémisse de résolution, build en échec, origine de production)
   * avec un verdict sur l'artefact.
   */
  const SHA = 'd'.repeat(40);
  const PREVIEW = 'https://kj-pr-42.vercel.app';
  const résolution = (extra = {}) => ({
    ok: true,
    premisse: false,
    url: PREVIEW,
    revision: SHA,
    id: 'dpl_1',
    tentatives: 1,
    motif: `déploiement dpl_1 READY pour ${SHA.slice(0, 12)} (tentative 1/1)`,
    ...extra,
  });

  it('juge la chaîne sur l’URL rendue, et nomme la révision dans le résumé du run', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'actifs-preview-'));
    const resume = join(dossier, 'summary.md');
    const site = siteFabriqué();
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', site.fetchImpl);
    try {
      const code = await main(['--preview', '--sha', SHA, '--tentatives', '1'], {
        resumePath: resume,
        env: {},
        resoudre: async () => résolution(),
      });
      expect(code).toBe(0);
      const lignes = journal.mock.calls.flat().join('\n');
      expect(lignes).toContain(`Preview Vercel : ${PREVIEW}`);
      const contenu = readFileSync(resume, 'utf8');
      expect(contenu).toContain('conforme');
      expect(contenu).toContain(`preview de ${SHA.slice(0, 12)} : ${PREVIEW}`);
      expect(contenu).toContain('actif(s) de code jugé(s) en entier');
    } finally {
      journal.mockRestore();
      vi.unstubAllGlobals();
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('pose le jeton de contournement sur CHAQUE lecture : une preview protégée n’est pas lue à moitié', async () => {
    const site = siteFabriqué();
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', site.fetchImpl);
    try {
      const code = await main(['--preview', '--sha', SHA, '--tentatives', '1'], {
        resumePath: '',
        env: { [BYPASS_ENV]: 'jeton-de-contournement' },
        resoudre: async () => résolution(),
      });
      expect(code).toBe(0);
      const envoyés = site.fetchImpl.mock.calls.map(([, options]) => options.headers[BYPASS_HEADER]);
      // Toutes les lectures (page, manifeste, actifs, plages) le portent : une
      // seule sans lui suffirait à lire le mur de connexion à sa place.
      expect(envoyés.length).toBeGreaterThan(10);
      expect(envoyés.every((valeur) => valeur === 'jeton-de-contournement')).toBe(true);
      // Et le jeton n'est jamais imprimé.
      expect(journal.mock.calls.flat().join('\n')).not.toContain('jeton-de-contournement');
    } finally {
      journal.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('rend une PRÉMISSE (code 2) quand la preview n’a pas pu être résolue, en la nommant', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'actifs-premisse-'));
    const resume = join(dossier, 'summary.md');
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await main(['--preview', '--sha', SHA, '--tentatives', '1'], {
        resumePath: resume,
        env: {},
        resoudre: async () => ({ ok: false, premisse: true, url: '', motif: 'jeton Vercel absent (VERCEL_TOKEN) : rien ne peut être résolu.' }),
      });
      expect(code).toBe(2);
      const lignes = journal.mock.calls.flat().join('\n');
      expect(lignes).toContain(`::warning title=Preview Vercel — ${MARQUE_PREMISSE}`);
      expect(lignes).toContain('VERCEL_TOKEN');
      const contenu = readFileSync(resume, 'utf8');
      expect(contenu).toContain(MARQUE_PREMISSE);
      expect(contenu).toContain('Motif :');
    } finally {
      journal.mockRestore();
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('rend un REFUS (code 1) quand le build de la PR est en échec — ce n’est pas une prémisse', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'actifs-echec-'));
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await main(['--preview', '--sha', SHA, '--tentatives', '1'], {
        resumePath: join(dossier, 'summary.md'),
        env: {},
        resoudre: async () => ({
          ok: false,
          premisse: false,
          url: '',
          motif: `le déploiement de ${SHA.slice(0, 12)} est en ERROR : l'artefact de cette PR n'existe pas.`,
        }),
      });
      expect(code).toBe(1);
      expect(journal.mock.calls.flat().join('\n')).toContain('artefact de la PR absent');
    } finally {
      journal.mockRestore();
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('refuse d’appeler « preview » une origine de PRODUCTION', async () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await main(['--preview', '--sha', SHA], {
        resumePath: '',
        env: {},
        resoudre: async () => résolution({ url: SITE_ORIGIN }),
      });
      expect(code).toBe(2);
      expect(erreur.mock.calls.flat().join(' ')).toContain('la PRODUCTION');
      // Et AUCUNE lecture de l'artefact de production n'a eu lieu.
      expect(journal.mock.calls.flat().join('\n')).not.toContain('Actifs servis');
    } finally {
      journal.mockRestore();
      erreur.mockRestore();
    }
  });

  it('refuse --base avec --preview : deux sources pour une même adresse', async () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await main(['--preview', '--base', 'https://exemple.test'], { resumePath: '', env: {} })).toBe(2);
      expect(erreur.mock.calls.flat().join(' ')).toContain('--base et --preview ensemble');
    } finally {
      erreur.mockRestore();
    }
  });

  it('nomme un MUR DE PROTECTION au lieu d’accuser l’artefact, et rend une prémisse', async () => {
    const html = '<!doctype html><html><head><title>Authentication Required</title></head><body>protected-deployment</body></html>';
    const tampon = new TextEncoder().encode(html);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://vercel.com/login?next=%2F',
      headers: { get: () => null },
      body: { cancel: async () => {} },
      text: async () => html,
      arrayBuffer: async () => tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + tampon.byteLength),
    }));
    const dossier = mkdtempSync(join(tmpdir(), 'actifs-mur-'));
    const resume = join(dossier, 'summary.md');
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const code = await main(['--preview', '--sha', SHA, '--tentatives', '1'], {
        resumePath: resume,
        env: {},
        resoudre: async () => résolution(),
      });
      expect(code).toBe(2);
      const lignes = journal.mock.calls.flat().join('\n');
      expect(lignes).toContain('MUR DE PROTECTION');
      expect(lignes).toContain(BYPASS_ENV);
      expect(readFileSync(resume, 'utf8')).toContain(MARQUE_PREMISSE);
    } finally {
      journal.mockRestore();
      vi.unstubAllGlobals();
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('lit les options de preview sans base implicite, et garde la production par défaut', () => {
    const lues = lireOptions(['--preview', '--sha', SHA]);
    expect(lues.preview).toBe(true);
    expect(lues.base).toBe('');
    expect(lues.sha).toBe(SHA);
    expect(lues.tentatives).toBe(12);
    expect(lues.delaiMs).toBe(15000);
    expect(lireOptions([]).base).toBe(SITE_ORIGIN);
    expect(lireOptions([]).preview).toBe(false);
  });

  it('reconnaît le mur de protection dans l’URL finale ou dans le corps', () => {
    expect(murDeProtection('https://vercel.com/login?next=%2F', '<html></html>')).toContain('vercel.com/login');
    expect(murDeProtection('https://kj-pr.vercel.app/', '<html>Vercel Security Checkpoint</html>')).toContain('protection');
    expect(murDeProtection('https://kj-pr.vercel.app/', '<html><body>kojo</body></html>')).toBe('');
  });
});
