/**
 * PREUVE D'ÉCHEC de `check-job-page-production.js` — la sonde qui juge le
 * document SERVI de `/jobs/:id`.
 *
 * Ce que ces cas protègent, dans l'ordre du défaut réel : une réécriture Vercel
 * perdue répond 200 avec la coque SPA (document valide, aucun test rouge), donc
 * la sonde doit nommer CETTE forme-là avant toute autre ; puis le DÉMARRAGE —
 * point d'entrée unique, feuille avant le module, bloc de données `kojo-job-data`
 * accordé au `<h1>` et à la description, sans champ que l'API publique ne
 * publie — est éprouvé fait par fait sur un document de référence qui passe.
 *
 * Les documents sont écrits ici à la main, avec la FORME que le backend produit
 * (`backend/kojo_job_og.py`) — jamais en exécutant Python : un test de sonde de
 * production doit tourner dans la boucle locale de n'importe quel poste.
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
  blocDeDonnees,
  cartesAttendues,
  champsInterdits,
  decoderEntites,
  descriptionAccordee,
  feuillesDe,
  h1De,
  jugerDemarrage,
  jugerDocument404,
  jugerDocumentFiche,
  nombreDeH1,
  parseArguments,
  resoudreJob,
  ressembleACoqueSpa,
  runJobPageProbe,
  scriptsDe,
  scriptsExecutables,
} from '../check-job-page-production.js';
import { POINT_ENTREE_MISSION } from '../site-meta.js';

const BASE = 'https://kojo-sonde.test';
const ID = '22222222-2222-4222-8222-222222222222';
const URL_FICHE = `${BASE}/jobs/${ID}`;
const CARTES = cartesAttendues(ID);
const TITRE = 'Réparation de la pompe du quartier';
const DESCRIPTION =
  'La pompe du quartier ne démarre plus depuis deux jours. Il faut remplacer le joint et vérifier le moteur.';

const meta = (cle, contenu, attribut = 'property') =>
  `<meta ${attribut}="${cle}" content="${contenu}" />`;

/** Le bloc de données de la vue publique, tel que le backend l'écrit. */
const vuePublique = (remplacements = {}) => ({
  id: ID,
  title: TITRE,
  description: DESCRIPTION,
  category: 'general',
  status: 'open',
  budget_min: 5000,
  budget_max: 12000,
  location: { city: 'Dakar' },
  ...remplacements,
});

/**
 * Le document d'une fiche tel que le backend l'écrit — et qui DOIT passer.
 * `remplacements` casse un fait sans réécrire le document.
 */
const documentFiche = ({ remplacements = {}, donnees = vuePublique() } = {}) => {
  const parties = {
    canonical: `<link rel="canonical" href="${URL_FICHE}" />`,
    ogUrl: meta('og:url', URL_FICHE),
    twitterUrl: meta('twitter:url', URL_FICHE, 'name'),
    description: meta('description', DESCRIPTION, 'name'),
    ogDescription: meta('og:description', DESCRIPTION),
    twitterDescription: meta('twitter:description', DESCRIPTION, 'name'),
    robots: meta('robots', 'index, follow', 'name'),
    carteWide: [
      meta('og:image', `${BASE}${CARTES.wide}`),
      meta('og:image:width', '1200'),
      meta('og:image:height', '630'),
    ].join(''),
    carteCarree: [
      meta('og:image', `${BASE}${CARTES.carree}`),
      meta('og:image:width', '1200'),
      meta('og:image:height', '1200'),
    ].join(''),
    feuille: `<link rel="stylesheet" href="${POINT_ENTREE_MISSION.style}" />`,
    pointEntree: `<script type="module" src="${POINT_ENTREE_MISSION.script}"></script>`,
    h1: `<h1 class="text-3xl font-bold text-gray-900 mb-2">${TITRE} — Kojo</h1>`,
    bloc: `<script type="application/json" id="${POINT_ENTREE_MISSION.seedId}">${JSON.stringify(
      donnees
    )}</script>`,
  };
  Object.assign(parties, remplacements);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${TITRE} — Kojo</title>
${parties.description}
${parties.robots}
${parties.canonical}
<meta property="og:type" content="article" />
${parties.ogUrl}
${meta('og:title', `${TITRE} — Kojo`)}
${parties.ogDescription}
${parties.carteWide}
${parties.carteCarree}
<meta name="twitter:card" content="summary_large_image" />
${parties.twitterUrl}
${parties.twitterDescription}
${parties.feuille}
${parties.pointEntree}
</head>
<body>
<div id="root">
${parties.h1}
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
    pointEntree: `<script type="module" src="${POINT_ENTREE_MISSION.script}"></script>`,
    feuille: `<link rel="stylesheet" href="${POINT_ENTREE_MISSION.style}" />`,
  };
  Object.assign(parties, remplacements);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Mission introuvable — Kojo</title>
${parties.robots}
${parties.feuille}
${parties.pointEntree}
</head>
<body><div id="root"></div></body>
</html>
`;
};

const ficheConforme = (options) => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  html: documentFiche(options),
  robots: '',
  base: BASE,
  id: ID,
});

const defauts = (options) => jugerDocumentFiche(options);

describe('check-job-page-production — lecture du document', () => {
  it('sépare le point d’entrée, le bloc de données et un script en ligne', () => {
    const html = documentFiche();
    const scripts = scriptsDe(html);
    expect(scripts.map((s) => s.src)).toContain(POINT_ENTREE_MISSION.script);
    // Le bloc de données est bien LU (il porte un id et du JSON)…
    const bloc = scripts.find((s) => s.id === POINT_ENTREE_MISSION.seedId);
    expect(bloc.type).toBe('application/json');
    expect(JSON.parse(bloc.inline).id).toBe(ID);
    // …mais il n'est pas un script EXÉCUTÉ : sinon tout document conforme serait
    // refusé pour « script en ligne ».
    expect(scriptsExecutables(html).map((s) => s.src)).toEqual([POINT_ENTREE_MISSION.script]);
  });

  it('reconnaît la coque SPA par son script de bundle, et pas le point d’entrée', () => {
    expect(ressembleACoqueSpa(coqueSpa())).toBe(true);
    expect(ressembleACoqueSpa(documentFiche())).toBe(false);
    expect(ressembleACoqueSpa(document404())).toBe(false);
  });

  it('lit le <h1> décodé, et compte les titres séparément', () => {
    expect(h1De('<h1 class="x">Pompe &amp; joint</h1>')).toBe('Pompe & joint');
    expect(nombreDeH1('<h1>a</h1><h1>b</h1>')).toBe(2);
    expect(nombreDeH1('<div id="root"></div>')).toBe(0);
  });

  it('lit les feuilles quel que soit l’ordre des attributs', () => {
    expect(feuillesDe('<link rel="stylesheet" href="/a.css" />')).toEqual(['/a.css']);
    expect(feuillesDe('<link href="/b.css" rel="stylesheet" />')).toEqual(['/b.css']);
    expect(feuillesDe('<link rel="preload" href="/c.css" />')).toEqual([]);
  });

  it('trouve les champs jamais publics, à toute profondeur', () => {
    // Le détecteur d'abord : un détecteur qui ne reconnaîtrait rien ferait
    // passer les refus suivants pour des preuves.
    expect(champsInterdits(vuePublique())).toEqual([]);
    expect(champsInterdits(vuePublique({ client_id: 'client-1' }))).toEqual(['client_id']);
    expect(
      champsInterdits(vuePublique({ location: { city: 'Dakar', latitude: 14.7 } }))
    ).toEqual(['location.latitude']);
    expect(champsInterdits({ a: [{ geo: { type: 'Point' } }] })).toEqual(['a[0].geo']);
  });

  it('décode les entités du document, `&amp;` en dernier', () => {
    expect(decoderEntites('Réparation d&apos;une pompe &amp; un joint &lt;neuf&gt;')).toBe(
      "Réparation d'une pompe & un joint <neuf>"
    );
    // Décodé dans le mauvais ordre, `&amp;lt;` deviendrait `<` au lieu de `&lt;`.
    expect(decoderEntites('&amp;lt;')).toBe('&lt;');
  });

  it('accorde la description avec la coupe du backend, sans recopier la limite', () => {
    expect(descriptionAccordee(DESCRIPTION, DESCRIPTION)).toBe(true);
    // Une coupe est un PRÉFIXE, terminé par « … » — la limite vit côté backend.
    expect(descriptionAccordee('La pompe du quartier…', DESCRIPTION)).toBe(true);
    expect(descriptionAccordee('Une autre mission', DESCRIPTION)).toBe(false);
    // Une balise non coupée doit être EXACTEMENT la description du bloc.
    expect(descriptionAccordee('La pompe du quartier', DESCRIPTION)).toBe(false);
  });
});

describe('check-job-page-production — le document d’une fiche', () => {
  it('un document conforme ne produit AUCUN défaut', () => {
    expect(defauts(ficheConforme())).toEqual([]);
  });

  it('refuse la coque SPA en NOMMANT la réécriture perdue', () => {
    const messages = defauts({ ...ficheConforme(), html: coqueSpa() }).join('\n');
    expect(messages).toMatch(/COQUE SPA/);
    expect(messages).toMatch(/réécriture/);
    expect(messages).toMatch(/canonical/);
    expect(messages).toMatch(/<h1>/);
    expect(messages).toContain(POINT_ENTREE_MISSION.seedId);
  });

  it('refuse un canonical, un og:url ou un twitter:url d’une autre adresse', () => {
    const autre = `${BASE}/jobs/autre-mission`;
    for (const [cle, remplacements] of [
      ['canonical', { canonical: `<link rel="canonical" href="${autre}" />` }],
      ['og:url', { ogUrl: meta('og:url', autre) }],
      ['twitter:url', { twitterUrl: meta('twitter:url', autre, 'name') }],
    ]) {
      const html = documentFiche({ remplacements });
      const messages = defauts({ ...ficheConforme(), html }).join('\n');
      expect(messages, cle).toContain(cle);
      expect(messages, cle).toContain(URL_FICHE);
    }
  });

  it('refuse une fiche servie en noindex', () => {
    const messages = defauts({
      ...ficheConforme(),
      html: documentFiche({ remplacements: { robots: meta('robots', 'noindex', 'name') } }),
    }).join('\n');
    expect(messages).toMatch(/noindex/);
  });

  it('refuse un document sans <title>, ou sans description', () => {
    const sansTitre = defauts({
      ...ficheConforme(),
      html: documentFiche().replace(/<title>[\s\S]*?<\/title>/, ''),
    }).join('\n');
    expect(sansTitre).toMatch(/sans <title>/);

    const sansDescription = defauts({
      ...ficheConforme(),
      html: documentFiche({ remplacements: { description: '' } }),
    }).join('\n');
    expect(sansDescription).toMatch(/meta description absente/);
  });

  it('refuse une description qui diverge de la carte de partage', () => {
    const messages = defauts({
      ...ficheConforme(),
      html: documentFiche({
        remplacements: { ogDescription: meta('og:description', 'autre texte') },
      }),
    }).join('\n');
    expect(messages).toMatch(/og:description/);
    expect(messages).toMatch(/deux descriptions/);
  });

  it('refuse un <h1> absent, dupliqué, ou qui ne parle pas de la même mission', () => {
    for (const [label, h1] of [
      ['absent', ''],
      ['dupliqué', '<h1>Réparation de la pompe du quartier — Kojo</h1><h1>Deux</h1>'],
      ['étranger', '<h1>Une autre mission — Kojo</h1>'],
    ]) {
      const messages = defauts({
        ...ficheConforme(),
        html: documentFiche({ remplacements: { h1 } }),
      }).join('\n');
      expect(messages, label).toMatch(/<h1>/);
    }
  });

  it('refuse un document qui ne charge pas le point d’entrée (plus d’application)', () => {
    const messages = defauts({
      ...ficheConforme(),
      html: documentFiche({ remplacements: { pointEntree: '' } }),
    }).join('\n');
    expect(messages).toContain(POINT_ENTREE_MISSION.script);
    expect(messages).toMatch(/sans châssis, sans navigation/);
  });

  it('refuse un point d’entrée chargé deux fois', () => {
    const messages = defauts({
      ...ficheConforme(),
      html: documentFiche({
        remplacements: {
          pointEntree: `<script type="module" src="${POINT_ENTREE_MISSION.script}"></script><script type="module" src="${POINT_ENTREE_MISSION.script}"></script>`,
        },
      }),
    }).join('\n');
    expect(messages).toMatch(/2 chargements du point d'entrée/);
    expect(messages).toMatch(/deux fois/);
  });

  it('refuse tout script hors du point d’entrée déclaré — y compris en ligne', () => {
    const enLigne = defauts({
      ...ficheConforme(),
      html: documentFiche({ remplacements: { pointEntree: '<script>window.x=1</script>' } }),
    }).join('\n');
    expect(enLigne).toMatch(/hors point d'entrée déclaré/);
    expect(enLigne).toMatch(/en ligne/);

    const tiers = defauts({
      ...ficheConforme(),
      html: documentFiche({
        remplacements: {
          pointEntree: `<script type="module" src="${POINT_ENTREE_MISSION.script}"></script><script src="https://cdn.example/x.js"></script>`,
        },
      }),
    }).join('\n');
    expect(tiers).toContain('https://cdn.example/x.js');
    expect(tiers).toMatch(/distingu|coque/i);
  });

  it('refuse un bundle /assets/ même quand le point d’entrée est là', () => {
    const messages = defauts({
      ...ficheConforme(),
      html: documentFiche({
        remplacements: {
          pointEntree: `<script type="module" src="${POINT_ENTREE_MISSION.script}"></script><script type="module" src="/assets/index-abc.js"></script>`,
        },
      }),
    }).join('\n');
    expect(messages).toMatch(/script\(s\) de bundle/);
    expect(messages).toContain('/assets/index-abc.js');
  });

  it('refuse la feuille absente (l’application démarrerait sans style)', () => {
    const messages = defauts({
      ...ficheConforme(),
      html: documentFiche({ remplacements: { feuille: '' } }),
    }).join('\n');
    expect(messages).toContain(POINT_ENTREE_MISSION.style);
    expect(messages).toMatch(/sans style/);
  });

  it('refuse une feuille déclarée APRÈS le module (fiche peinte nue)', () => {
    const html = documentFiche({
      remplacements: { feuille: '', pointEntree: '' },
    }).replace(
      '</head>',
      `<script type="module" src="${POINT_ENTREE_MISSION.script}"></script><link rel="stylesheet" href="${POINT_ENTREE_MISSION.style}" /></head>`
    );
    const messages = defauts({ ...ficheConforme(), html }).join('\n');
    expect(messages).toMatch(/APRÈS/);
    expect(messages).toMatch(/premier rendu/);
  });

  it('refuse un bloc de données absent, illisible, ou d’une AUTRE mission', () => {
    const absent = defauts({
      ...ficheConforme(),
      html: documentFiche({ remplacements: { bloc: '' } }),
    }).join('\n');
    expect(absent).toContain(POINT_ENTREE_MISSION.seedId);
    expect(absent).toMatch(/squelette/);
    // Le remède est nommé : la donnée, pas le code.
    expect(absent).toMatch(/JobPublic/);
    expect(absent).toMatch(/corriger la DONNÉE/);

    const illisible = defauts({
      ...ficheConforme(),
      html: documentFiche({
        remplacements: {
          bloc: `<script type="application/json" id="${POINT_ENTREE_MISSION.seedId}">{tronqué</script>`,
        },
      }),
    }).join('\n');
    expect(illisible).toMatch(/JSON illisible/);

    const etrangere = defauts({
      ...ficheConforme(),
      html: documentFiche({ donnees: vuePublique({ id: 'une-autre' }) }),
    }).join('\n');
    expect(etrangere).toMatch(/AUTRE mission/);
  });

  it('refuse un bloc qui publie une coordonnée, une identité ou un jeton', () => {
    for (const [label, donnees] of [
      ['coordonnée', vuePublique({ location: { city: 'Dakar', latitude: 14.7 } })],
      ['identité', vuePublique({ client_id: 'client-1' })],
      ['jeton', vuePublique({ disburse_token: 'tok' })],
      ['point geo', vuePublique({ geo: { type: 'Point' } })],
    ]) {
      const messages = defauts({ ...ficheConforme(), html: documentFiche({ donnees }) }).join('\n');
      expect(messages, label).toMatch(/JAMAIS publics/);
      expect(messages, label).toMatch(/coordonnées, identités et jetons|coordonnée|identité|jeton/);
    }
  });

  it('accorde une description ÉCHAPPÉE dans la balise (apostrophe, &, <)', () => {
    // Le backend écrit `&apos;`/`&amp;`/`&lt;` dans la balise et le texte BRUT dans le bloc :
    // sans décodage, une seule apostrophe refuserait presque toute mission française.
    const speciale = "Réparation d'une pompe & le joint <neuf> à Dakar.";
    const echappee = speciale
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&apos;');
    const html = documentFiche({
      donnees: vuePublique({ description: speciale }),
      remplacements: {
        description: meta('description', echappee, 'name'),
        ogDescription: meta('og:description', echappee),
        twitterDescription: meta('twitter:description', echappee, 'name'),
      },
    });
    expect(defauts({ ...ficheConforme(), html })).toEqual([]);
  });

  it('refuse une description du bloc qui n’est pas celle de la balise', () => {
    const messages = defauts({
      ...ficheConforme(),
      html: documentFiche({
        donnees: vuePublique({ description: 'Une description qui ne correspond pas du tout.' }),
      }),
    }).join('\n');
    expect(messages).toMatch(/meta description/);
    expect(messages).toMatch(/deux missions/);
  });

  it('accepte une meta description COUPÉE quand elle est le préfixe du bloc', () => {
    const coupee = `${DESCRIPTION.slice(0, 40)}…`;
    const html = documentFiche({
      donnees: vuePublique({ description: `${DESCRIPTION.slice(0, 40)} et la suite.` }),
      remplacements: {
        description: meta('description', coupee, 'name'),
        ogDescription: meta('og:description', coupee),
        twitterDescription: meta('twitter:description', coupee, 'name'),
      },
    });
    expect(defauts({ ...ficheConforme(), html })).toEqual([]);
  });

  it('refuse un statut qui n’est pas 200, ou un corps qui n’est pas du HTML', () => {
    const statut = defauts({ ...ficheConforme(), status: 404 }).join('\n');
    expect(statut).toMatch(/HTTP 404/);

    const type = defauts({ ...ficheConforme(), contentType: 'application/json' }).join('\n');
    expect(type).toMatch(/content-type/);
  });

  it('juge le démarrage seul, sans passer par l’en-tête', () => {
    const { erreurs, bloc } = jugerDemarrage({ html: documentFiche(), id: ID });
    expect(erreurs).toEqual([]);
    expect(bloc.donnees.title).toBe(TITRE);

    const sansBloc = jugerDemarrage({
      html: documentFiche({ remplacements: { bloc: '' } }),
      id: ID,
    });
    expect(sansBloc.erreurs.join('\n')).toContain(POINT_ENTREE_MISSION.seedId);
    expect(blocDeDonnees(documentFiche(), POINT_ENTREE_MISSION.seedId, 'autre').erreur).toMatch(
      /AUTRE mission/
    );
  });
});

describe('check-job-page-production — la sentinelle juge la réécriture', () => {
  it('un 404 du backend passe', () => {
    expect(jugerDocument404({ status: 404, html: document404() })).toEqual([]);
  });

  it('une coque SPA en 200 est refusée en nommant la réécriture', () => {
    const messages = jugerDocument404({ status: 200, html: coqueSpa() }).join('\n');
    expect(messages).toMatch(/RÉÉCRITURE/);
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

describe('check-job-page-production — la résolution de la fiche', () => {
  const sitemap = (locs) =>
    `<?xml version="1.0" encoding="UTF-8"?><urlset>${locs
      .map((loc) => `<url><loc>${loc}</loc></url>`)
      .join('')}</urlset>`;
  const reponse = (body, { status = 200 } = {}) => ({
    status,
    text: async () => body,
    headers: { get: () => 'application/xml' },
  });

  it('prend la première fiche /jobs/:id du sitemap, jamais la liste ni un profil', async () => {
    const fetchImpl = async () =>
      reponse(
        sitemap([
          `${BASE}/jobs`,
          `${BASE}/workers/33333333-3333-4333-8333-333333333333`,
          `${BASE}/jobs/${ID}`,
          `${BASE}/jobs/autre`,
        ])
      );
    const resolution = await resoudreJob({ base: BASE, fetchImpl });
    expect(resolution).toEqual({ id: ID, source: 'sitemap', erreur: '' });
  });

  it('accepte un identifiant ou une URL de fiche passés à la main', async () => {
    const parId = await resoudreJob({ base: BASE, job: ID, fetchImpl: async () => reponse('') });
    expect(parId).toMatchObject({ id: ID, source: 'argument', erreur: '' });

    const parUrl = await resoudreJob({
      base: BASE,
      job: `${BASE}/jobs/${ID}/`,
      fetchImpl: async () => reponse(''),
    });
    expect(parUrl).toMatchObject({ id: ID, source: 'argument', erreur: '' });
  });

  it('REFUSE une URL qui n’est pas une fiche (un profil, par exemple)', async () => {
    const resolution = await resoudreJob({
      base: BASE,
      job: `${BASE}/workers/abc`,
      fetchImpl: async () => reponse(''),
    });
    expect(resolution.id).toBe('');
    expect(resolution.erreur).toMatch(/n'est pas une fiche/);
  });

  it('sitemap sans fiche : aucun identifiant, et AUCUNE erreur (c’est une prémisse)', async () => {
    const resolution = await resoudreJob({
      base: BASE,
      fetchImpl: async () => reponse(sitemap([`${BASE}/`, `${BASE}/jobs`])),
    });
    expect(resolution.id).toBe('');
    expect(resolution.erreur).toBe('');
  });

  it('sitemap en panne : une erreur nommée, jamais un silence', async () => {
    const resolution = await resoudreJob({
      base: BASE,
      fetchImpl: async () => reponse('', { status: 503 }),
    });
    expect(resolution.erreur).toMatch(/HTTP 503/);
  });
});

describe('check-job-page-production — la sonde entière (fetch injecté)', () => {
  const sitemapAvec = (...ids) =>
    `<?xml version="1.0"?><urlset>${ids
      .map((id) => `<url><loc>${BASE}/jobs/${id}</loc></url>`)
      .join('')}</urlset>`;

  const fetchQuiSert = ({ sentinelle, fiche, sitemap = sitemapAvec(ID) } = {}) =>
    async (url) => {
      const texte = (body, status = 200, type = 'text/html') => ({
        status,
        headers: { get: (cle) => (cle.toLowerCase() === 'content-type' ? type : '') },
        text: async () => body,
      });
      if (url.endsWith('/sitemap.xml')) return texte(sitemap, 200, 'application/xml');
      // Une sentinelle fournie par le cas est la COQUE servie en 200 ; le défaut
      // est le 404 du backend.
      if (url.includes(ID_SENTINELLE)) return texte(sentinelle ?? document404(), sentinelle ? 200 : 404);
      if (url.includes(`/jobs/${ID}`)) return texte(fiche ?? documentFiche());
      return texte('', 404);
    };

  it('une production conforme rend un vert, et dit ce qu’elle a mesuré', async () => {
    const resultat = await runJobPageProbe({ base: BASE, quiet: true, fetchImpl: fetchQuiSert() });
    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.premise).toBe(false);
    expect(resultat.jobId).toBe(ID);
    expect(resultat.checked.join('\n')).toMatch(/réécriture vivante/);
    expect(resultat.checked.join('\n')).toContain(URL_FICHE);
    expect(resultat.checked.join('\n')).toMatch(/bloc #kojo-job-data/);
    expect(resultat.checked.join('\n')).toMatch(/feuille avant le module/);
  });

  it('une réécriture perdue est refusée AVANT tout corpus (sentinelle en 200)', async () => {
    const resultat = await runJobPageProbe({
      base: BASE,
      quiet: true,
      fetchImpl: fetchQuiSert({ sentinelle: coqueSpa(), fiche: coqueSpa() }),
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/RÉÉCRITURE/);
    expect(resultat.errors.join('\n')).toMatch(/COQUE SPA/);
  });

  it('aucune fiche publiée : une PRÉMISSE, jamais un vert', async () => {
    const resultat = await runJobPageProbe({
      base: BASE,
      quiet: true,
      fetchImpl: fetchQuiSert({ sitemap: sitemapAvec() }),
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.premise).toBe(true);
    expect(resultat.errors).toEqual([]);
    expect(resultat.notices.join('\n')).toContain(MARQUE_PREMISSE);
    expect(resultat.notices.join('\n')).toMatch(/n'a donc PAS été jugé/);
    // La réécriture, elle, a été mesurée : la prémisse ne porte que sur la fiche.
    expect(resultat.checked.join('\n')).toMatch(/réécriture vivante/);
  });

  it('un démarrage cassé rougit la fiche, pas la réécriture', async () => {
    const resultat = await runJobPageProbe({
      base: BASE,
      quiet: true,
      fetchImpl: fetchQuiSert({
        fiche: documentFiche({ remplacements: { pointEntree: '' } }),
      }),
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toContain(POINT_ENTREE_MISSION.script);
    expect(resultat.errors.join('\n')).not.toMatch(/RÉÉCRITURE/);
  });

  it('une sentinelle injoignable est une erreur nommée', async () => {
    const resultat = await runJobPageProbe({
      base: BASE,
      quiet: true,
      fetchImpl: async (url) => {
        if (url.includes(ID_SENTINELLE)) throw new Error('ECONNREFUSED');
        return fetchQuiSert()(url);
      },
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/injoignable \(ECONNREFUSED\)/);
  });
});

describe('check-job-page-production — le CLI (serveur local réel)', () => {
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
        const locs = etat.publieFiche ? `<url><loc>${origine}/jobs/${ID}</loc></url>` : '';
        reponse.end(`<?xml version="1.0"?><urlset>${locs}</urlset>`);
        return;
      }
      if (url.pathname === `/jobs/${ID_SENTINELLE}`) {
        if (etat.coque) {
          html(coqueSpa());
          return;
        }
        html(document404().replace(/https:\/\/kojo-sonde\.test/g, origine), 404);
        return;
      }
      if (url.pathname === `/jobs/${ID}`) {
        html(documentFiche().replace(/https:\/\/kojo-sonde\.test/g, origine));
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
  // sous-processus — le CLI paraîtrait pendu alors que la sonde fonctionne.
  const lancer = async (...arguments_) => {
    const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const executer = promisify(execFile);
    try {
      const { stdout, stderr } = await executer(
        process.execPath,
        ['scripts/check-job-page-production.js', ...arguments_],
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
    etat = { coque: false, publieFiche: true };
    const execution = await lancer('--base', origine);
    expect(execution.status, execution.stderr).toBe(0);
    expect(execution.stdout).toContain(FAMILLE);
    expect(execution.stdout).toMatch(/réécriture vivante/);
    expect(execution.stdout).toContain(URL_FICHE.replace('https://kojo-sonde.test', origine));
    expect(execution.stdout).toContain(POINT_ENTREE_MISSION.seedId);
  });

  it('sort en 1 en nommant le défaut quand la réécriture est perdue', async () => {
    etat = { coque: true, publieFiche: true };
    const execution = await lancer('--base', origine);
    expect(execution.status).toBe(1);
    expect(execution.stderr).toMatch(/::error title=Fiche mission production::/);
    expect(execution.stderr).toMatch(/RÉÉCRITURE/);
    expect(execution.stderr).toMatch(/COQUE SPA/);
  });

  it('sort en 2 (prémisse) quand aucune fiche n’est publiée — jamais en 0', async () => {
    etat = { coque: false, publieFiche: false };
    const execution = await lancer('--base', origine);
    expect(execution.status).toBe(2);
    expect(execution.stderr).toContain(MARQUE_PREMISSE);
    // La réécriture, elle, a bien été mesurée : la prémisse ne porte que sur la fiche.
    expect(execution.stdout).toMatch(/réécriture vivante/);
  });

  it('accepte une fiche passée à la main (--job) même sans sitemap', async () => {
    etat = { coque: false, publieFiche: false };
    const execution = await lancer('--base', origine, '--job', ID);
    expect(execution.status, execution.stderr).toBe(0);
    expect(execution.stdout).toContain(POINT_ENTREE_MISSION.seedId);
  });

  it('les arguments se lisent comme la CI les passe', () => {
    expect(parseArguments(['--base', BASE, '--job', ID, '--quiet'])).toEqual({
      base: BASE,
      job: ID,
      quiet: true,
    });
  });
});
