/**
 * PREUVE D'ÉCHEC de `check-worker-page-production.js` — la sonde qui juge le
 * document SERVI de `/workers/:id`.
 *
 * Ce que ces cas protègent, dans l'ordre du défaut réel : une réécriture Vercel
 * perdue ne casse rien de visible (200, document valide, aucun test rouge), donc
 * la sonde doit nommer CETTE forme-là avant toute autre chose ; puis chaque fait
 * de l'en-tête (canonical, og:url, deux cartes, `<h1>`, point d'entrée) est
 * éprouvé séparément, sur un document de référence qui passe.
 *
 * Les documents sont écrits ici à la main, avec la FORME que le backend produit
 * (`backend/kojo_worker_og.py`) — jamais en exécutant Python : un test de sonde
 * de production doit tourner dans la boucle locale de n'importe quel poste.
 */
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  FAMILLE,
  ID_SENTINELLE,
  MARQUE_PREMISSE,
  cartesAttendues,
  h1De,
  jugerCartes,
  jugerDocument404,
  jugerDocumentProfil,
  nombreDeH1,
  parseArguments,
  resoudreProfil,
  ressembleACoqueSpa,
  runWorkerPageProbe,
  scriptsDe,
  scriptsExecutables,
} from '../check-worker-page-production.js';
import { POINT_ENTREE_TRAVAILLEUR } from '../site-meta.js';

const BASE = 'https://kojo-sonde.test';
const ID = '11111111-1111-4111-8111-111111111111';
const URL_PROFIL = `${BASE}/workers/${ID}`;
const CARTES = cartesAttendues(ID);
const DESCRIPTION = 'Plombière à Dakar, dix ans de métier, interventions rapides et devis clair.';

const meta = (cle, contenu, attribut = 'property') =>
  `<meta ${attribut}="${cle}" content="${contenu}" />`;

/**
 * Le document d'un profil tel que le backend l'écrit — et qui DOIT passer.
 * `remplacements` permet de casser un fait sans réécrire le document.
 */
const documentProfil = ({ remplacements = {} } = {}) => {
  const parties = {
    canonical: `<link rel="canonical" href="${URL_PROFIL}" />`,
    ogUrl: meta('og:url', URL_PROFIL),
    description: meta('description', DESCRIPTION, 'name'),
    ogDescription: meta('og:description', DESCRIPTION),
    twitterDescription: meta('twitter:description', DESCRIPTION, 'name'),
    robots: meta('robots', 'index, follow', 'name'),
    carteWide: [
      meta('og:image', `${BASE}${CARTES.wide}`),
      meta('og:image:width', '1200'),
      meta('og:image:height', '630'),
      meta('og:image:type', 'image/png'),
    ].join(''),
    carteCarree: [
      meta('og:image', `${BASE}${CARTES.carree}`),
      meta('og:image:width', '1200'),
      meta('og:image:height', '1200'),
      meta('og:image:type', 'image/png'),
    ].join(''),
    twitterCard: meta('twitter:card', 'summary_large_image', 'name'),
    twitterImage: meta('twitter:image', `${BASE}${CARTES.wide}`, 'name'),
    feuille: `<link rel="stylesheet" href="${POINT_ENTREE_TRAVAILLEUR.style}" />`,
    pointEntree: `<script type="module" src="${POINT_ENTREE_TRAVAILLEUR.script}"></script>`,
    h1: '<h1 class="titre-page">Awa Diallo</h1>',
    bloc: `<script type="application/json" id="${POINT_ENTREE_TRAVAILLEUR.seedId}">${JSON.stringify({
      id: ID,
      first_name: 'Awa',
      last_name: 'Diallo',
    })}</script>`,
  };
  Object.assign(parties, remplacements);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Awa Diallo — plomberie — Kojo</title>
${parties.description}
${parties.robots}
${parties.canonical}
<meta property="og:type" content="profile" />
${parties.ogUrl}
${meta('og:title', "Awa Diallo — plomberie — Kojo")}
${parties.ogDescription}
${parties.carteWide}
${parties.carteCarree}
${parties.twitterCard}
${meta('twitter:url', URL_PROFIL, 'name')}
${meta('twitter:title', "Awa Diallo — plomberie — Kojo", 'name')}
${parties.twitterDescription}
${parties.twitterImage}
${parties.feuille}
${parties.pointEntree}
</head>
<body>
<div id="root">
${parties.h1}
<p class="text-lg text-gray-700">Travailleur · Dakar</p>
</div>
${parties.bloc}
</body>
</html>
`;
};

/** La coque SPA : le document que Vercel sert quand la réécriture est perdue. */
const coqueSpa = () => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Kojo — missions et travailleurs en Afrique de l'Ouest</title>
<meta name="description" content="Trouvez un travailleur de confiance." />
<script type="module" crossorigin src="/assets/index-rLr2P3b4.js"></script>
<link rel="stylesheet" href="/assets/index-A1b2C3d4.css" />
</head>
<body><div id="root"></div></body>
</html>
`;

/** Le document 404 du backend pour un identifiant inconnu. */
const document404 = ({ remplacements = {} } = {}) => {
  const parties = {
    robots: meta('robots', 'noindex, nofollow', 'name'),
    pointEntree: `<script type="module" src="${POINT_ENTREE_TRAVAILLEUR.script}"></script>`,
    feuille: `<link rel="stylesheet" href="${POINT_ENTREE_TRAVAILLEUR.style}" />`,
  };
  Object.assign(parties, remplacements);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Travailleur introuvable — Kojo</title>
${parties.robots}
${parties.feuille}
${parties.pointEntree}
</head>
<body><div id="root"></div></body>
</html>
`;
};

const profilConforme = (options) => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  html: documentProfil(options),
  robots: '',
  base: BASE,
  id: ID,
});

const defauts = (options) => jugerDocumentProfil(options);

describe('check-worker-page-production — lecture des scripts', () => {
  it('sépare le point d’entrée, le bloc de données et un script en ligne', () => {
    const html = documentProfil();
    const scripts = scriptsDe(html);
    expect(scripts.map((s) => s.src)).toContain(POINT_ENTREE_TRAVAILLEUR.script);
    // Le bloc de données est bien LU (il porte un id et du JSON)…
    const bloc = scripts.find((s) => s.id === POINT_ENTREE_TRAVAILLEUR.seedId);
    expect(bloc).toBeTruthy();
    expect(bloc.type).toBe('application/json');
    expect(JSON.parse(bloc.inline).id).toBe(ID);
    // …mais il n'est pas un script EXÉCUTÉ : sinon tout document conforme serait
    // refusé pour « script en ligne ».
    expect(scriptsExecutables(html).map((s) => s.src)).toEqual([
      POINT_ENTREE_TRAVAILLEUR.script,
    ]);
  });

  it('reconnaît la coque SPA par son script de bundle, et pas le point d’entrée', () => {
    // Le détecteur d'abord : un détecteur qui ne reconnaîtrait rien ferait passer
    // les assertions suivantes pour des preuves.
    expect(ressembleACoqueSpa(coqueSpa())).toBe(true);
    expect(ressembleACoqueSpa(documentProfil())).toBe(false);
    expect(ressembleACoqueSpa(document404())).toBe(false);
  });

  it('lit le <h1>, son texte décodé, et les compter séparément', () => {
    expect(h1De('<h1 class="x">Awa &amp; Sow</h1>')).toBe('Awa & Sow');
    expect(nombreDeH1('<h1>a</h1><h1>b</h1>')).toBe(2);
    expect(nombreDeH1('<div id="root"></div>')).toBe(0);
  });
});

describe('check-worker-page-production — le document d’un profil', () => {
  it('un document conforme ne produit AUCUN défaut', () => {
    expect(defauts(profilConforme())).toEqual([]);
  });

  it('refuse la coque SPA en NOMMANT la réécriture perdue', () => {
    const messages = defauts({
      ...profilConforme(),
      html: coqueSpa(),
    }).join('\n');
    expect(messages).toMatch(/COQUE SPA/);
    expect(messages).toMatch(/réécriture/);
    expect(messages).toMatch(/canonical/);
    expect(messages).toMatch(/og:url/);
    expect(messages).toMatch(/<h1>/);
  });

  it('refuse un canonical et un og:url d’une autre adresse', () => {
    const autre = `${BASE}/workers/autre-profil`;
    for (const [cle, remplacements] of [
      ['canonical', { canonical: `<link rel="canonical" href="${autre}" />` }],
      ['og:url', { ogUrl: meta('og:url', autre) }],
    ]) {
      const messages = defauts({
        ...profilConforme(),
        html: documentProfil({ remplacements }),
      }).join('\n');
      expect(messages, cle).toMatch(new RegExp(cle.replace(':', ':')));
      expect(messages, cle).toContain(URL_PROFIL);
    }
  });

  it('refuse un profil servi en noindex', () => {
    const messages = defauts({
      ...profilConforme(),
      html: documentProfil({ remplacements: { robots: meta('robots', 'noindex', 'name') } }),
    }).join('\n');
    expect(messages).toMatch(/noindex/);
  });

  it('refuse une seule carte OG, et nomme celle qui manque', () => {
    const messages = defauts({
      ...profilConforme(),
      html: documentProfil({ remplacements: { carteCarree: '' } }),
    }).join('\n');
    expect(messages).toMatch(/1 carte\(s\) og:image/);
    expect(messages).toContain(CARTES.carree);
    // La large est présente : elle ne doit pas être accusée.
    expect(messages).toMatch(/CARTE|cartes/i);
  });

  it('refuse deux cartes de même format (dimensions recopiées)', () => {
    const messages = defauts({
      ...profilConforme(),
      html: documentProfil({
        remplacements: {
          carteWide: [
            meta('og:image', `${BASE}${CARTES.wide}`),
            meta('og:image:width', '1200'),
            meta('og:image:height', '1200'),
            meta('og:image:type', 'image/png'),
          ].join(''),
        },
      }),
    }).join('\n');
    expect(messages).toMatch(/og:image:height/);
    expect(messages).toContain('630');
  });

  it('refuse une description qui diverge de la carte de partage', () => {
    const messages = defauts({
      ...profilConforme(),
      html: documentProfil({
        remplacements: { ogDescription: meta('og:description', 'autre texte') },
      }),
    }).join('\n');
    expect(messages).toMatch(/og:description/);
    expect(messages).toMatch(/deux descriptions/);
  });

  it('refuse un <h1> absent, dupliqué, ou qui ne parle pas du même profil', () => {
    for (const [label, h1] of [
      ['absent', ''],
      ['dupliqué', '<h1>Awa Diallo</h1><h1>Awa Diallo</h1>'],
      ['étranger', '<h1>Moussa Traoré</h1>'],
    ]) {
      const messages = defauts({
        ...profilConforme(),
        html: documentProfil({ remplacements: { h1 } }),
      }).join('\n');
      expect(messages, label).toMatch(/<h1>/);
    }
  });

  it('refuse un document qui ne charge pas le point d’entrée (plus d’application)', () => {
    const messages = defauts({
      ...profilConforme(),
      html: documentProfil({ remplacements: { pointEntree: '' } }),
    }).join('\n');
    expect(messages).toContain(POINT_ENTREE_TRAVAILLEUR.script);
    expect(messages).toMatch(/sans châssis ni navigation/);
  });

  it('refuse la feuille absente (l’application démarrerait sans style)', () => {
    const messages = defauts({
      ...profilConforme(),
      html: documentProfil({ remplacements: { feuille: '' } }),
    }).join('\n');
    expect(messages).toContain(POINT_ENTREE_TRAVAILLEUR.style);
    expect(messages).toMatch(/sans style/);
  });

  it('refuse tout script hors du point d’entrée déclaré — y compris en ligne', () => {
    const enLigne = defauts({
      ...profilConforme(),
      html: documentProfil({ remplacements: { pointEntree: `<script>window.x=1</script>` } }),
    }).join('\n');
    expect(enLigne).toMatch(/hors point d'entrée déclaré/);
    expect(enLigne).toMatch(/en ligne/);

    const tiers = defauts({
      ...profilConforme(),
      html: documentProfil({
        remplacements: {
          pointEntree: `${'<script type="module" src="/boot/worker-boot.js"></script>'}<script src="https://cdn.example/x.js"></script>`,
        },
      }),
    }).join('\n');
    expect(tiers).toContain('https://cdn.example/x.js');
  });

  it('refuse un bloc de données absent, illisible, ou d’un AUTRE profil', () => {
    const absent = defauts({
      ...profilConforme(),
      html: documentProfil({ remplacements: { bloc: '' } }),
    }).join('\n');
    expect(absent).toContain(POINT_ENTREE_TRAVAILLEUR.seedId);
    expect(absent).toMatch(/squelette/);

    const illisible = defauts({
      ...profilConforme(),
      html: documentProfil({
        remplacements: {
          bloc: `<script type="application/json" id="${POINT_ENTREE_TRAVAILLEUR.seedId}">{tronqué</script>`,
        },
      }),
    }).join('\n');
    expect(illisible).toMatch(/JSON illisible/);

    const etranger = defauts({
      ...profilConforme(),
      html: documentProfil({
        remplacements: {
          bloc: `<script type="application/json" id="${POINT_ENTREE_TRAVAILLEUR.seedId}">${JSON.stringify({
            id: 'un-autre',
            first_name: 'Awa',
            last_name: 'Diallo',
          })}</script>`,
        },
      }),
    }).join('\n');
    expect(etranger).toMatch(/AUTRE profil/);
  });

  it('refuse un statut qui n’est pas 200', () => {
    const messages = defauts({ ...profilConforme(), status: 404 }).join('\n');
    expect(messages).toMatch(/HTTP 404/);
  });
});

describe('check-worker-page-production — la sentinelle juge la réécriture', () => {
  it('un 404 du backend passe', () => {
    expect(jugerDocument404({ status: 404, html: document404() })).toEqual([]);
  });

  it('une coque SPA en 200 est refusée en nommant la réécriture', () => {
    const messages = jugerDocument404({ status: 200, html: coqueSpa() }).join('\n');
    expect(messages).toMatch(/réécriture Vercel/i);
    expect(messages).toMatch(/COQUE SPA/);
    expect(messages).toMatch(/noindex/);
    expect(messages).toMatch(/point d'entrée/);
  });

  it('un 404 sans noindex, ou sans point d’entrée, est refusé', () => {
    const sansNoindex = jugerDocument404({
      status: 404,
      html: document404({ remplacements: { robots: '' } }),
    }).join('\n');
    expect(sansNoindex).toMatch(/AUCUN noindex/);

    const sansEntree = jugerDocument404({
      status: 404,
      html: document404({ remplacements: { pointEntree: '' } }),
    }).join('\n');
    expect(sansEntree).toMatch(/point d'entrée/);
    expect(sansEntree).toMatch(/aucune application/);
  });
});

describe('check-worker-page-production — la résolution du profil', () => {
  const sitemap = (locs) =>
    `<?xml version="1.0" encoding="UTF-8"?><urlset>${locs
      .map((loc) => `<url><loc>${loc}</loc></url>`)
      .join('')}</urlset>`;
  const reponse = (body, { status = 200 } = {}) => ({
    status,
    text: async () => body,
    headers: { get: () => 'application/xml' },
  });

  it('prend le premier /workers/:id du sitemap, jamais une fiche mission', async () => {
    const fetchImpl = async () =>
      reponse(
        sitemap([
          `${BASE}/jobs/22222222-2222-4222-8222-222222222222`,
          `${BASE}/workers/${ID}`,
          `${BASE}/workers/autre`,
        ])
      );
    const resolution = await resoudreProfil({ base: BASE, fetchImpl });
    expect(resolution).toEqual({ id: ID, source: 'sitemap', erreur: '' });
  });

  it('accepte un identifiant ou une URL de profil passés à la main', async () => {
    const parId = await resoudreProfil({ base: BASE, worker: ID, fetchImpl: async () => reponse('') });
    expect(parId).toMatchObject({ id: ID, source: 'argument', erreur: '' });

    const parUrl = await resoudreProfil({
      base: BASE,
      worker: `${BASE}/workers/${ID}/`,
      fetchImpl: async () => reponse(''),
    });
    expect(parUrl).toMatchObject({ id: ID, source: 'argument', erreur: '' });
  });

  it('REFUSE une URL qui n’est pas un profil (une fiche mission, par exemple)', async () => {
    const resolution = await resoudreProfil({
      base: BASE,
      worker: `${BASE}/jobs/abc`,
      fetchImpl: async () => reponse(''),
    });
    expect(resolution.id).toBe('');
    expect(resolution.erreur).toMatch(/n'est pas un profil/);
  });

  it('sitemap sans profil : aucun identifiant, et AUCUNE erreur (c’est une prémisse)', async () => {
    const resolution = await resoudreProfil({
      base: BASE,
      fetchImpl: async () => reponse(sitemap([`${BASE}/`, `${BASE}/jobs`])),
    });
    expect(resolution.id).toBe('');
    expect(resolution.erreur).toBe('');
  });

  it('sitemap en panne : une erreur nommée, jamais un silence', async () => {
    const resolution = await resoudreProfil({
      base: BASE,
      fetchImpl: async () => reponse('', { status: 503 }),
    });
    expect(resolution.erreur).toMatch(/HTTP 503/);
  });
});

describe('check-worker-page-production — les cartes OG en HTTP', () => {
  const png = () => {
    const octets = new Uint8Array(70);
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((valeur, index) => {
      octets[index] = valeur;
    });
    return octets;
  };
  const carte = ({ status = 200, type = 'image/png', corps = png() } = {}) => ({
    status,
    headers: { get: (cle) => (cle.toLowerCase() === 'content-type' ? type : '') },
    arrayBuffer: async () => corps.buffer,
  });

  it('deux cartes servies en PNG ne produisent aucun défaut', async () => {
    expect(await jugerCartes({ base: BASE, id: ID, fetchImpl: async () => carte() })).toEqual([]);
  });

  it('une carte 404 ou un corps qui n’est pas un PNG est refusé', async () => {
    const manquante = await jugerCartes({
      base: BASE,
      id: ID,
      fetchImpl: async () => carte({ status: 404 }),
    });
    expect(manquante.join('\n')).toMatch(/HTTP 404/);

    const pasPng = await jugerCartes({
      base: BASE,
      id: ID,
      fetchImpl: async () => carte({ corps: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }),
    });
    expect(pasPng.join('\n')).toMatch(/ne sont pas un PNG/);
  });
});

describe('check-worker-page-production — la sonde entière (fetch injecté)', () => {
  const sitemapAvec = (...ids) =>
    `<?xml version="1.0"?><urlset>${ids
      .map((id) => `<url><loc>${BASE}/workers/${id}</loc></url>`)
      .join('')}</urlset>`;

  const fetchQuiSert = ({ sentinelle, profil, sitemap = sitemapAvec(ID), cartes = 200 } = {}) =>
    async (url) => {
      const texte = (body, status = 200, type = 'text/html') => ({
        status,
        headers: { get: (cle) => (cle.toLowerCase() === 'content-type' ? type : '') },
        text: async () => body,
        arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer,
      });
      if (url.endsWith('/sitemap.xml')) return texte(sitemap, 200, 'application/xml');
      if (url.includes(ID_SENTINELLE)) return texte(sentinelle ?? document404(), 404);
      if (url.includes('/api/og/workers/')) {
        return cartes === 200 ? texte('', 200, 'image/png') : texte('', 404);
      }
      if (url.includes(`/workers/${ID}`)) return texte(profil ?? documentProfil());
      return texte('', 404);
    };

  it('une production conforme rend un vert, et dit ce qu’elle a mesuré', async () => {
    const resultat = await runWorkerPageProbe({ base: BASE, quiet: true, fetchImpl: fetchQuiSert() });
    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.premise).toBe(false);
    expect(resultat.workerId).toBe(ID);
    expect(resultat.checked.join('\n')).toMatch(/réécriture vivante/);
    expect(resultat.checked.join('\n')).toContain(URL_PROFIL);
    expect(resultat.checked.join('\n')).toMatch(/1200×630/);
  });

  it('une réécriture perdue est refusée AVANT tout corpus (sentinelle en 200)', async () => {
    const resultat = await runWorkerPageProbe({
      base: BASE,
      quiet: true,
      fetchImpl: fetchQuiSert({ sentinelle: coqueSpa(), profil: coqueSpa() }),
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/réécriture/i);
    expect(resultat.errors.join('\n')).toMatch(/COQUE SPA/);
  });

  it('aucun profil publié : une PRÉMISSE, jamais un vert', async () => {
    const resultat = await runWorkerPageProbe({
      base: BASE,
      quiet: true,
      fetchImpl: fetchQuiSert({ sitemap: sitemapAvec() }),
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.premise).toBe(true);
    expect(resultat.errors).toEqual([]);
    expect(resultat.notices.join('\n')).toContain(MARQUE_PREMISSE);
    expect(resultat.notices.join('\n')).toMatch(/n'a donc PAS été jugée/);
  });

  it('une carte manquante rougit la fiche, pas la réécriture', async () => {
    const resultat = await runWorkerPageProbe({
      base: BASE,
      quiet: true,
      fetchImpl: fetchQuiSert({ cartes: 404 }),
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/carte OG/);
    expect(resultat.errors.join('\n')).not.toMatch(/réécriture/);
  });
});

describe('check-worker-page-production — le CLI (serveur local réel)', () => {
  /** L'état que le serveur sert : chaque cas le pose AVANT de lancer le CLI. */
  let etat;
  let serveur;
  let origine = '';

  beforeAll(async () => {
    serveur = http.createServer((requete, reponse) => {
      const url = new URL(requete.url, 'http://x');
      const html = (corps, status = 200) => {
        reponse.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
        reponse.end(corps);
      };
      if (url.pathname === '/sitemap.xml') {
        reponse.writeHead(200, { 'content-type': 'application/xml' });
        const locs = etat.publieProfil ? `<url><loc>${origine}/workers/${ID}</loc></url>` : '';
        reponse.end(`<?xml version="1.0"?><urlset>${locs}</urlset>`);
        return;
      }
      if (url.pathname === `/workers/${ID_SENTINELLE}`) {
        if (etat.coque) {
          html(coqueSpa());
          return;
        }
        html(document404().replace(/https:\/\/kojo-sonde\.test/g, origine), 404);
        return;
      }
      if (url.pathname.startsWith('/api/og/workers/')) {
        const octets = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        reponse.writeHead(200, { 'content-type': 'image/png' });
        reponse.end(octets);
        return;
      }
      if (url.pathname === `/workers/${ID}`) {
        html(documentProfil().replace(/https:\/\/kojo-sonde\.test/g, origine));
        return;
      }
      html('', 404);
    });
    await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
    origine = `http://127.0.0.1:${serveur.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => serveur.close(resolve));
  });

  // ASYNCHRONE, et c'est le point : `spawnSync` bloque la boucle d'événements du
  // processus de test, donc le serveur qu'il héberge ne répondrait JAMAIS au
  // sous-processus — le CLI paraîtrait pendu (mesuré : 30 s de délai dépassé,
  // aucune sortie) alors que la sonde fonctionne.
  const lancer = async (...arguments_) => {
    const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const executer = promisify(execFile);
    try {
      const { stdout, stderr } = await executer(
        process.execPath,
        ['scripts/check-worker-page-production.js', ...arguments_],
        { cwd: racine, encoding: 'utf8', timeout: 30000 }
      );
      return { status: 0, stdout, stderr };
    } catch (erreur) {
      // `execFile` jette sur un code non nul : le code ET les sorties sont ce que
      // la CI lit, donc on les rend tels quels plutôt que de perdre le verdict.
      return { status: erreur.code, stdout: erreur.stdout || '', stderr: erreur.stderr || '' };
    }
  };

  it('sort en 0 sur un document conforme, et publie ce qu’il a mesuré', async () => {
    etat = { coque: false, publieProfil: true };
    const execution = await lancer('--base', origine);
    expect(execution.status, execution.stderr).toBe(0);
    expect(execution.stdout).toContain(FAMILLE);
    expect(execution.stdout).toMatch(/réécriture vivante/);
    expect(execution.stdout).toContain(URL_PROFIL.replace('https://kojo-sonde.test', origine));
    expect(execution.stdout).toMatch(/1200×630/);
  });

  it('sort en 1 en nommant le défaut quand la réécriture est perdue', async () => {
    etat = { coque: true, publieProfil: true };
    const execution = await lancer('--base', origine);
    expect(execution.status).toBe(1);
    expect(execution.stderr).toMatch(/::error title=Profil travailleur production::/);
    expect(execution.stderr).toMatch(/réécriture/i);
    expect(execution.stderr).toMatch(/COQUE SPA/);
  });

  it('sort en 2 (prémisse) quand aucun profil n’est publié — jamais en 0', async () => {
    etat = { coque: false, publieProfil: false };
    const execution = await lancer('--base', origine);
    expect(execution.status).toBe(2);
    expect(execution.stderr).toContain(MARQUE_PREMISSE);
    // La réécriture, elle, a bien été mesurée : la prémisse ne porte que sur la fiche.
    expect(execution.stdout).toMatch(/réécriture vivante/);
  });

  it('les arguments se lisent comme la CI les passe', () => {
    expect(parseArguments(['--base', BASE, '--worker', ID, '--quiet'])).toEqual({
      base: BASE,
      worker: ID,
      quiet: true,
    });
  });
});
