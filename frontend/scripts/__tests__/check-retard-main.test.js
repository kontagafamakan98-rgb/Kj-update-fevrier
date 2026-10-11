/**
 * @vitest-environment node
 *
 * PREUVE D'ÉCHEC REJOUÉE — le retard de la base sur la branche de travail, et
 * l'ancienneté du dernier déploiement de production
 * (`scripts/check-retard-main.js` + sa règle `scripts/retard-main.js`).
 *
 * ── Le défaut que ce couple ferme ───────────────────────────────────────────
 * MESURÉ le 07/10/2026 : dix commits ont attendu d'être livrés et aucun run ne
 * l'a rappelé — « la base est en retard de combien, et depuis quand la
 * production n'a pas été reconstruite » n'était écrit nulle part. Les deux
 * nombres sont donc publiés à chaque passe, et trois choses décident de leur
 * valeur. Chacune est prouvée ici, sur la règle ET sur le bras de la CI :
 *
 *  1. LA CORRECTION DU SQUASH, qui n'est pas un confort mais la mesure du
 *     08/10/2026 sur ce dépôt : `git rev-list --count origin/main..HEAD` valait
 *     **14** et l'attente réelle **0** (l'arbre de la tête était celui de la
 *     base). Un compte brut annoncerait un retard inexistant — le rouge qu'on
 *     apprend à ignorer. Le cas PARTIEL (squash livré, puis du travail) est
 *     vérifié en plus du tout-ou-rien, parce que c'est le cas courant.
 *  2. L'ÂGE DU DÉPLOIEMENT LU DANS LA PEINTURE, pas dans le commit : l'en-tête
 *     `Last-Modified` de la production (mesuré : 05:05:03 pour un commit de
 *     05:04:12). L'âge du COMMIT servi aurait menti dans les deux sens — artefact
 *     reconstruit tard pour un commit ancien, artefact ancien pour un commit
 *     récent. Et quand l'en-tête manque, le refus le NOMME au lieu de rendre un
 *     âge inventé.
 *  3. LE VERDICT BORNÉ PAR L'APPELANT SEULEMENT : sans borne déclarée, une
 *     branche de travail et un dépôt calme ne sont pas des défauts. Une borne
 *     annoncée sur une valeur INCONNUE est un refus, jamais un vert.
 *
 * Les cas de CLI tournent sur des dépôts FIXTURE (git réel, aucun réseau) et sur
 * le dépôt RÉEL — ce dernier est le contrôle positif : sans lui, un garde rouge
 * au départ ferait passer toutes les mutations pour des succès.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SITE_ORIGIN } from '../site-meta.js';
import {
  ageDeploiement,
  attenteDeLivraison,
  dateEntete,
  duree,
  phraseDeRetard,
  phraseDeploiement,
  verdictDeRetard,
} from '../retard-main.js';
import { BASES_CANDIDATES, lireOptions, main, mesurer, resoudreBase } from '../check-retard-main.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..', '..');
const GARDE = path.join(ICI, '..', 'check-retard-main.js');

// Identité et réglages posés sur CHAQUE commande git des fixtures : la
// configuration du poste (gpg, identité, branche par défaut) ne doit pas décider
// du résultat de la preuve.
const IDENTITE = [
  '-c', 'user.name=Kojo Test',
  '-c', 'user.email=test@kojo.test',
  '-c', 'commit.gpgsign=false',
  '-c', 'init.defaultBranch=travail',
];

const git = (cwd, ...args) =>
  execFileSync('git', [...IDENTITE, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Les 14 commits que `origin/main..HEAD` contenait le 08/10/2026 sur ce dépôt,
 * dans l'ordre de `git log --reverse` (sha, arbre, date de commit). Le DERNIER
 * porte l'arbre de la base : c'est ce que la correction du squash doit voir.
 */
const HISTORIQUE_MESURE = [
  ['65dbfdd93feb7299780820aef8b7e9cb30d942b7', '701d0350edd4fcff67cdcce8abd650a0e1342b82', 1790636651],
  ['a9149c9c5293907e7a8c7f373ec317416e580452', '6ae24a225ea02eba756f28609eb6f8068f7d6e22', 1790636788],
  ['e6a23f6bc8838520da88c83aa9ddec1d70f561d6', 'c5b994b123e06ce6ae6e830eea9309077b342dab', 1790644428],
  ['ca8611e96e86069dbc7db1bb3c658baef8da51dc', '39203fea7a062fe07e0944f152e43f47a02be2d9', 1791364713],
  ['4950ad9cb05a225f1ff3631d15e1173a0470d193', '96feda70772a385006af0402dc9ff28da194a77e', 1791368919],
  ['c19bdf5b325c3fdcd45df8fb3e3927db25f6594c', '7ae8463a48dc386b462e4e051aaae71eec640490', 1791374705],
  ['f695e6007d1584154a3b693312ea9b77102576ce', '61d4ac3b5cf2bddaa978a13fda027134d7903792', 1791379703],
  ['524892c7e459efc562300a158be6b705a3a05f95', '17fb328861fd586753ba1f707d1f98a7b6f3e396', 1791391743],
  ['f669c9b110d9628aee00e1dfd2e41009ce39b259', '2919ac6e2dedce11fef7096b5c77899f8b4fb256', 1791391774],
  ['140c6e68f30e5be07f9b3218c617899236354d81', '53b3877a97d4aec102c71d9a419aceccbceb4a50', 1791391779],
  ['2f3240e66e71c9f701cf1cd4e24432b5520afc45', 'e55707ffced6c75c6b6678b9985686787ba082af', 1791413730],
  ['756c8d4b5846a0246007ab3571a0c7bd4584e870', 'dbddabdffe8d0e7e1cce44e01c78cdd3999e38ce', 1791413745],
  ['6015b20410203297c384d7f4102391cd3baa177c', '8bef94238fe0788c78110698f1d24a01951b36d8', 1791413746],
  ['7618677874fa9aac82354098eae21da014c047c2', '778aee71c5fe700c3ee7bd21284cad2b85e2f510', 1791434357],
].map(([sha, arbre, quand]) => ({ sha, arbre, quandMs: quand * 1000 }));

const ARBRE_BASE_MESURE = '778aee71c5fe700c3ee7bd21284cad2b85e2f510';

/** Une réponse de production fabriquée : aucune requête réelle n'est émise. */
const réponse = ({ corps = '', entetes = {}, status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (nom) => entetes[nom.toLowerCase()] ?? null },
  text: async () => corps,
});

const PAGE = `<!doctype html><html><head><meta name="kojo-build-revision" content="d510f669a3b413b1d43ab9f5d0a48ab93e217d9e"></head><body></body></html>`;

describe('retard-main — la durée, telle qu’elle se lit', () => {
  it('dit les trois échelles, et n’invente pas de chiffre sur une entrée illisible', () => {
    expect(duree(30 * 1000)).toBe('moins d’une minute');
    expect(duree(4 * 60 * 1000 + 30 * 1000)).toBe('4 min');
    expect(duree(3 * 3600 * 1000 + 7 * 60 * 1000)).toBe('3 h 07');
    expect(duree(2 * 86400 * 1000 + 4 * 3600 * 1000)).toBe('2 j 4 h');
    // Une durée négative (horloge en avance sur la mesure) ne doit pas produire
    // « -1 j » : elle est ramenée à zéro, pas affichée telle quelle.
    expect(duree(-5000)).toBe('moins d’une minute');
    expect(duree(Number.NaN)).toBe('inconnue');
  });
});

describe('retard-main — la correction du squash, mesurée sur ce dépôt', () => {
  it('annule l’attente quand l’arbre de la tête est celui de la base (14 commits comptés, 0 à livrer)', () => {
    // LE cas mesuré du 08/10/2026. Le compte brut dit 14 ; la correction doit
    // dire 0, et le dire AVEC sa raison (sinon le chiffre ne s'explique pas).
    const attente = attenteDeLivraison({
      commits: HISTORIQUE_MESURE,
      arbreBase: ARBRE_BASE_MESURE,
      arbreTete: ARBRE_BASE_MESURE,
      maintenant: 1791440000 * 1000,
    });
    expect(attente.enAttente).toBe(0);
    expect(attente.depuisMs).toBeNull();
    expect(attente.indexDepuis).toBe(-1);
    // La phrase est CELLE de la comparaison d'arbres, pas celle du point de
    // livraison : les deux rendent 0 sur ce cas, donc seule la raison dit
    // laquelle a conclu — et c'est la raison que le lecteur arbitre.
    expect(attente.motif).toMatch(/l’arbre de la tête est celui de la base/);
  });

  it('ne compte rien quand la tête REVIENT au contenu de la base (aller-retour)', () => {
    // Le cas que le point de livraison seul rate : l'arbre de la base est celui
    // du PREMIER commit, et la tête y revient après un aller-retour (une
    // fonctionnalité ajoutée puis retirée). Il n'y a rien à livrer, alors que
    // « l'attente commence après le plus ancien commit portant l'arbre de la
    // base » en compterait deux — le seul cas où les deux règles divergent.
    const commits = [
      { sha: 'a'.repeat(40), arbre: 'ARBRE-BASE', quandMs: 1000 },
      { sha: 'b'.repeat(40), arbre: 'ARBRE-B', quandMs: 2000 },
      { sha: 'c'.repeat(40), arbre: 'ARBRE-BASE', quandMs: 3000 },
    ];
    const attente = attenteDeLivraison({
      commits,
      arbreBase: 'ARBRE-BASE',
      arbreTete: 'ARBRE-BASE',
      maintenant: 9000,
    });
    expect(attente.enAttente).toBe(0);
    expect(attente.depuisMs).toBeNull();
    expect(attente.motif).toMatch(/l’arbre de la tête est celui de la base/);
  });

  it('compte le cas PARTIEL — squash déjà livré, puis du travail — au-delà du point de livraison', () => {
    // Le cas courant d'une branche continuée après une fusion : le contenu du
    // premier commit est déjà dans la base, les deux suivants attendent. Sans la
    // correction, ce serait « 3 » ; un « il suffit de comparer les arbres »
    // dirait « 0 » — les deux sont faux.
    const commits = [
      { sha: 'a'.repeat(40), arbre: 'ARBRE-BASE', quandMs: 1000 },
      { sha: 'b'.repeat(40), arbre: 'ARBRE-B', quandMs: 2000 },
      { sha: 'c'.repeat(40), arbre: 'ARBRE-C', quandMs: 3000 },
    ];
    const attente = attenteDeLivraison({
      commits,
      arbreBase: 'ARBRE-BASE',
      arbreTete: 'ARBRE-C',
      maintenant: 93_000,
    });
    expect(attente.enAttente).toBe(2);
    expect(attente.indexDepuis).toBe(1);
    // L'ancienneté part du PLUS ANCIEN commit en attente (b, à 2 000 ms), pas de
    // la tête : un commit qui attend depuis trois jours pèse plus qu'un commit
    // d'aujourd'hui, et c'est le plus ancien qui décrit le retard.
    expect(attente.depuisMs).toBe(91_000);
    // La raison nomme le commit où le contenu de la base est ENTRÉ dans la
    // branche (le point de livraison) : c'est lui qui explique le compte, pas le
    // premier commit en attente.
    expect(attente.motif).toContain('a'.repeat(12));
  });

  it('compte TOUT quand aucun commit ne porte l’arbre de la base', () => {
    const commits = [
      { sha: 'a'.repeat(40), arbre: 'X', quandMs: 1000 },
      { sha: 'b'.repeat(40), arbre: 'Y', quandMs: 2000 },
    ];
    const attente = attenteDeLivraison({ commits, arbreBase: 'Z', arbreTete: 'Y', maintenant: 5000 });
    expect(attente.enAttente).toBe(2);
    expect(attente.indexDepuis).toBe(0);
    expect(attente.depuisMs).toBe(4000);
    expect(attente.motif).toMatch(/tout ce qui est absent est du contenu à livrer/);
  });

  it('ne compte rien sur une branche qui ne porte aucun commit absent de la base', () => {
    const attente = attenteDeLivraison({ commits: [], arbreBase: 'Z', arbreTete: 'Y', maintenant: 5000 });
    expect(attente).toEqual({
      enAttente: 0,
      motif: 'aucun commit de la branche n’est absent de la base',
      indexDepuis: -1,
      depuisMs: null,
    });
  });
});

describe('retard-main — l’âge du déploiement, lu dans la peinture', () => {
  it('mesure l’écart des deux en-têtes de la MÊME réponse (mesure du 08/10/2026)', () => {
    // `Date` 06:26:27 − `Last-Modified` 05:05:03 = 1 h 21 min 24 s. Les deux
    // valeurs viennent de l'horloge de l'edge : aucune horloge locale n'entre
    // dans ce calcul, donc aucune dérive locale ne peut fabriquer un âge.
    const age = ageDeploiement({
      'last-modified': 'Thu, 08 Oct 2026 05:05:03 GMT',
      date: 'Thu, 08 Oct 2026 06:26:27 GMT',
    });
    expect(age.erreur).toBeNull();
    expect(age.ms).toBe(((6 * 60 + 26) * 60 + 27) * 1000 - (((5 * 60 + 5) * 60 + 3) * 1000));
    expect(age.source).toContain('date');
    expect(age.construit.toISOString()).toBe('2026-10-08T05:05:03.000Z');
  });

  it('retombe sur l’horloge locale quand l’edge n’annonce pas de « Date », et le DIT', () => {
    const age = ageDeploiement(
      { 'last-modified': 'Thu, 08 Oct 2026 05:05:03 GMT' },
      { maintenant: Date.parse('Thu, 08 Oct 2026 06:00:00 GMT') }
    );
    expect(age.ms).toBe(54 * 60 * 1000 + 57 * 1000);
    expect(age.source).toMatch(/horloge locale/);
  });

  it('refuse de conclure sans « Last-Modified », en le nommant — jamais un âge de 0', () => {
    const age = ageDeploiement({ date: 'Thu, 08 Oct 2026 06:26:27 GMT' });
    expect(age.ms).toBeNull();
    expect(age.erreur).toContain('Last-Modified');
    expect(age.erreur).toMatch(/invérifiable/);
  });

  it('traite une valeur illisible comme une absence, et ramène une datation future à zéro', () => {
    expect(dateEntete('pas une date')).toBeNull();
    expect(dateEntete('')).toBeNull();
    expect(dateEntete(null)).toBeNull();
    expect(ageDeploiement({ 'last-modified': 'hier' }).ms).toBeNull();
    // `Last-Modified` dans le futur (horloge d'edge fausse) : un âge négatif se
    // lirait « moins d'une minute », mais 0 est la valeur honnête.
    const futur = ageDeploiement({ 'last-modified': 'Thu, 08 Oct 2026 09:00:00 GMT' }, { maintenant: Date.parse('Thu, 08 Oct 2026 06:00:00 GMT') });
    expect(futur.ms).toBe(0);
  });
});

describe('retard-main — le verdict, et ses bornes', () => {
  it('ne prononce AUCUN refus sans borne déclarée : un travail en cours n’est pas un défaut', () => {
    const verdict = verdictDeRetard({ enAttente: 9, ageMs: 72 * 3600 * 1000 });
    expect(verdict.ok).toBe(true);
    expect(verdict.raisons).toEqual([]);
  });

  it('nomme chaque borne dépassée, une phrase par borne', () => {
    const verdict = verdictDeRetard({ enAttente: 6, ageMs: 50 * 3600 * 1000, maxCommits: 5, maxHeures: 48 });
    expect(verdict.ok).toBe(false);
    expect(verdict.raisons).toHaveLength(2);
    expect(verdict.raisons[0]).toMatch(/6 commit\(s\)/);
    expect(verdict.raisons[1]).toMatch(/2 j 2 h/);
  });

  it('laisse passer une borne tenue, à la limite près', () => {
    expect(verdictDeRetard({ enAttente: 5, maxCommits: 5 }).ok).toBe(true);
    expect(verdictDeRetard({ enAttente: 6, maxCommits: 5 }).ok).toBe(false);
    expect(verdictDeRetard({ ageMs: 48 * 3600 * 1000, maxHeures: 48 }).ok).toBe(true);
    expect(verdictDeRetard({ ageMs: 48 * 3600 * 1000 + 1, maxHeures: 48 }).ok).toBe(false);
  });

  it('refuse une borne déclarée sur une ancienneté INCONNUE — une borne ne se vérifie pas sur une inconnue', () => {
    const verdict = verdictDeRetard({ enAttente: 0, ageMs: null, maxHeures: 48 });
    expect(verdict.ok).toBe(false);
    expect(verdict.raisons[0]).toMatch(/pas pu être établie/);
  });
});

describe('retard-main — les phrases publiées', () => {
  it('dit les DEUX directions du retard, et l’ancienneté depuis le plus ancien commit en attente', () => {
    const phrase = phraseDeRetard({
      branche: 'feat/x',
      base: 'origin/main',
      enAttente: 3,
      absents: 11,
      retardBranche: 2,
      motif: 'fusion par squash reconnue au commit abcd',
      depuisMs: 3 * 86400 * 1000,
    });
    expect(phrase).toMatch(/origin\/main est en retard de 3 commit\(s\) sur « feat\/x »/);
    expect(phrase).toMatch(/plus ancien attend depuis 3 j 0 h/);
    expect(phrase).toMatch(/« feat\/x » est en retard de 2 commit\(s\) sur origin\/main/);
  });

  it('dit « aucun contenu en attente » sans taire le compte brut ni sa raison', () => {
    const phrase = phraseDeRetard({
      branche: 'feat/x',
      base: 'origin/main',
      enAttente: 0,
      absents: 14,
      retardBranche: 0,
      motif: 'l’arbre de la tête est celui de la base',
    });
    expect(phrase).toMatch(/aucun contenu en attente de livraison \(14 commit\(s\)/);
    expect(phrase).toMatch(/ne manque aucun commit/);
  });

  it('nomme la révision servie et l’instant du déploiement, ou déclare l’ancienneté INCONNUE', () => {
    const connu = phraseDeploiement({
      revision: 'd510f669a3b413b1d43ab9f5d0a48ab93e217d9e',
      ageMs: 90 * 60 * 1000,
      construit: new Date('2026-10-08T05:05:03Z'),
      source: 'en-tête « date » de l’edge',
    });
    expect(connu).toContain('d510f669a3b4');
    expect(connu).toMatch(/il y a 1 h 30/);
    expect(connu).toContain('2026-10-08T05:05:03.000Z');
    const inconnu = phraseDeploiement({ revision: '', erreur: 'HTTP 503' });
    expect(inconnu).toMatch(/AUCUNE révision/);
    expect(inconnu).toMatch(/INCONNUE/);
    expect(inconnu).toContain('HTTP 503');
  });
});

describe('retard-main — les options, et ce qu’une invocation doit refuser', () => {
  it('lit les deux bornes, le mode hors ligne, la base et le résumé', () => {
    const options = lireOptions([
      '--base', 'origin/main',
      '--max-commits', '5',
      '--max-heures', '48',
      '--sans-production',
      '--base-url', 'https://exemple.test',
      '--summary', '/tmp/resume.md',
    ]);
    expect(options).toEqual({
      base: 'origin/main',
      maxCommits: 5,
      maxHeures: 48,
      sansProduction: true,
      baseUrl: 'https://exemple.test',
      resume: '/tmp/resume.md',
      tete: '',
      markdown: '',
    });
  });

  it('lit la révision mesurée (--tete) et le fichier Markdown à écrire (--markdown)', () => {
    const options = lireOptions(['--tete', 'abc1234', '--markdown', '/tmp/livraison.md']);
    expect(options.tete).toBe('abc1234');
    expect(options.markdown).toBe('/tmp/livraison.md');
  });

  it('n’invente aucune borne quand rien n’est demandé, et vise la production par défaut', () => {
    const options = lireOptions([]);
    expect(options.maxCommits).toBeNull();
    expect(options.maxHeures).toBeNull();
    expect(options.sansProduction).toBe(false);
    // L'origine du site a UN propriétaire (`site-meta.js`) : elle n'est pas
    // recopiée ici, sinon une migration de domaine laisserait ce garde
    // interroger l'ancienne adresse en silence.
    expect(options.baseUrl).toBe(SITE_ORIGIN);
  });

  it('échoue sur une borne illisible au lieu de la tenir en silence', () => {
    expect(() => lireOptions(['--max-commits', 'beaucoup'])).toThrow(/borne\(s\) illisible\(s\)/);
    expect(() => lireOptions(['--max-heures', '-2'])).toThrow(/nombre ≥ 0/);
  });

  it('résout la base comme le garde d’hygiène git : origin/HEAD d’abord, puis les candidats', () => {
    // Aucun `origin/HEAD`, et `origin/main` seul présent : la résolution doit
    // tomber sur le premier CANDIDAT, pas rendre une base vide.
    const lire = (args) => ({
      ok: String(args[args.length - 1]).startsWith('origin/main'),
      lignes: [],
      erreur: '',
    });
    expect(resoudreBase('.', 'origin/develop', lire)).toBe('origin/develop');
    expect(resoudreBase('.', '', lire)).toBe('origin/main');
    expect(resoudreBase('.', '', () => ({ ok: false, lignes: [], erreur: '' }))).toBeNull();
    expect(BASES_CANDIDATES[0]).toBe('origin/main');
  });
});

describe('retard-main — le CLI sur un dépôt FIXTURE (git réel, aucun réseau)', () => {
  const racines = [];
  const gitDans = (cwd, ...args) => git(cwd, ...args);

  /** Dépôt fixture : branche `travail`, deux commits, base pointant sur le premier. */
  const depotAvecAttente = () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-retard-'));
    racines.push(racine);
    gitDans(racine, 'init', '-q');
    fs.writeFileSync(path.join(racine, 'f.txt'), 'un\n');
    gitDans(racine, 'add', 'f.txt');
    gitDans(racine, 'commit', '-q', '-m', 'livré');
    const premier = gitDans(racine, 'rev-parse', 'HEAD').trim();
    gitDans(racine, 'update-ref', 'refs/remotes/origin/main', premier);
    fs.writeFileSync(path.join(racine, 'f.txt'), 'deux\n');
    gitDans(racine, 'commit', '-q', '-am', 'en attente');
    return {
      racine,
      premier,
      lancer: (args) =>
        (() => {
          try {
            return {
              code: 0,
              stdout: execFileSync(process.execPath, [GARDE, ...args], {
                cwd: racine,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                // Le résumé de run est neutralisé : la preuve n'écrit pas dans un
                // fichier que GitHub agrège, même si la variable est posée.
                env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
              }),
              stderr: '',
            };
          } catch (erreur) {
            return { code: erreur.status, stdout: erreur.stdout || '', stderr: erreur.stderr || '' };
          }
        })(),
    };
  };

  afterAll(() => {
    for (const racine of racines.splice(0)) fs.rmSync(racine, { recursive: true, force: true });
  });

  it('publie les deux mesures et sort 0 SANS borne (le signal n’est pas un verdict)', () => {
    const { lancer } = depotAvecAttente();
    const { code, stdout } = lancer(['--sans-production']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/origin\/main est en retard de 1 commit\(s\)/);
    expect(stdout).toMatch(/production non interrogée/);
    expect(stdout).not.toContain('::error');
  });

  it('écrit les deux phrases en liste Markdown (--markdown), sans verdict', () => {
    const { racine, lancer } = depotAvecAttente();
    const fichier = path.join(racine, 'sortie', 'livraison.md');
    const { code } = lancer(['--sans-production', '--markdown', fichier]);
    expect(code).toBe(0);
    const contenu = fs.readFileSync(fichier, 'utf8');
    expect(contenu).toMatch(/^- base « origin\/main » ↔ branche/m);
    expect(contenu).toMatch(/^- production \(frontend\) : /m);
  });

  it('mesure la révision donnée (--tete), pas le HEAD de la tête de dépôt', () => {
    const { premier, lancer } = depotAvecAttente();
    // Le HEAD est en avance d'un commit sur la base ; la révision donnée est la
    // base elle-même : rien n'attend, et le libellé nomme la révision mesurée.
    const { code, stdout } = lancer(['--sans-production', '--tete', premier]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/révision /);
    expect(stdout).toMatch(/aucun contenu en attente de livraison/);
  });

  it('refuse un retard borné, en nommant le compte et la borne', () => {
    const { lancer } = depotAvecAttente();
    const { code, stdout, stderr } = lancer(['--sans-production', '--max-commits', '0']);
    expect(code).toBe(1);
    expect(stderr).toContain('::error title=Retard de livraison::');
    expect(stderr).toMatch(/1 commit\(s\) de la branche en attente > borne de 0/);
    // La mesure reste publiée sur le flux de succès, même quand le verdict tombe :
    // c'est elle qu'on vient lire.
    expect(stdout).toMatch(/retard de 1 commit\(s\)/);
  });

  it('corrige le squash dans le CLI : un commit compté absent, zéro contenu à livrer', () => {
    const { racine, premier, lancer } = depotAvecAttente();
    // Le squash : un commit NEUF dont l'arbre est celui de la tête de la branche,
    // posé comme base. C'est exactement ce que fait la fusion par squash.
    const arbre = gitDans(racine, 'rev-parse', 'HEAD^{tree}').trim();
    const squash = gitDans(racine, 'commit-tree', arbre, '-p', premier, '-m', 'squash').trim();
    gitDans(racine, 'update-ref', 'refs/remotes/origin/main', squash);
    const { code, stdout } = lancer(['--sans-production', '--max-commits', '0']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/aucun contenu en attente de livraison/);
    expect(stdout).toMatch(/fusion par squash/);
    expect(stdout).toMatch(/est en retard de 1 commit\(s\) sur origin\/main/);
  });

  it('sort 2 (invocation impossible) sur une borne illisible, et 1 sans aucune base', () => {
    const { racine, lancer } = depotAvecAttente();
    const borne = lancer(['--sans-production', '--max-heures', 'hier']);
    expect(borne.code).toBe(2);
    expect(borne.stderr).toContain('invocation impossible');
    // Une base qui n'existe pas : « pas de base » n'est pas un zéro.
    const sansBase = lancer(['--sans-production', '--base', 'origin/inexistante']);
    expect(sansBase.code).toBe(1);
    expect(sansBase.stderr).toMatch(/lecture impossible/);
    expect(sansBase.stderr).toContain('origin/inexistante');
    // Ni origin/* ni main/master : nommer l'état, jamais le confondre avec 0.
    const orphelin = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-retard-seul-'));
    racines.push(orphelin);
    gitDans(orphelin, 'init', '-q');
    fs.writeFileSync(path.join(orphelin, 'f.txt'), 'seul\n');
    gitDans(orphelin, 'add', 'f.txt');
    gitDans(orphelin, 'commit', '-q', '-m', 'seul');
    const sansAucune = (() => {
      try {
        return { code: 0, stderr: '', stdout: execFileSync(process.execPath, [GARDE, '--sans-production'], { cwd: orphelin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GITHUB_STEP_SUMMARY: '' } }) };
      } catch (erreur) {
        return { code: erreur.status, stdout: erreur.stdout || '', stderr: erreur.stderr || '' };
      }
    })();
    expect(sansAucune.code).toBe(1);
    expect(sansAucune.stderr).toMatch(/aucune base à comparer/);
  });

  it('refuse une base locale (code 2) : un site de poste ne dit rien de la production', () => {
    const { lancer } = depotAvecAttente();
    const { code, stderr } = lancer(['--base-url', 'http://127.0.0.1:4173']);
    expect(code).toBe(2);
    expect(stderr).toMatch(/base locale/);
    expect(stderr).toMatch(/--sans-production/);
  });
});

describe('retard-main — la production, sans réseau (fetch fabriqué)', () => {
  /**
   * Un dépôt fixture minimal : un commit, et `origin/main` posé dessus — sans
   * base, le CLI refuserait de conclure (« aucune base » n'est pas un zéro), donc
   * la borne d'ancienneté ne serait jamais atteinte et ce cas ne prouverait rien.
   */
  const depot = () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-retard-prod-'));
    git(racine, 'init', '-q');
    fs.writeFileSync(path.join(racine, 'f.txt'), 'x\n');
    git(racine, 'add', 'f.txt');
    git(racine, 'commit', '-q', '-m', 'x');
    git(racine, 'update-ref', 'refs/remotes/origin/main', git(racine, 'rev-parse', 'HEAD').trim());
    return racine;
  };
  const racines = [];
  afterAll(() => {
    for (const racine of racines.splice(0)) fs.rmSync(racine, { recursive: true, force: true });
  });

  it('tient une borne d’ancienneté sur l’en-tête servi, et refuse un déploiement trop vieux', async () => {
    const maintenant = Date.parse('Thu, 08 Oct 2026 06:00:00 GMT');
    const fetchTroisHeures = async () =>
      réponse({
        corps: PAGE,
        entetes: { 'last-modified': 'Thu, 08 Oct 2026 03:00:00 GMT', date: 'Thu, 08 Oct 2026 06:00:00 GMT' },
      });
    const racine = depot();
    racines.push(racine);
    const ancien = await main(['--max-heures', '1', '--base-url', 'https://production.test'], {
      cwd: racine,
      fetchImpl: fetchTroisHeures,
      maintenant: () => maintenant,
      resumePath: null,
    });
    expect(ancien).toBe(1);
    const tenu = await main(['--max-heures', '6', '--base-url', 'https://production.test'], {
      cwd: racine,
      fetchImpl: fetchTroisHeures,
      maintenant: () => maintenant,
      resumePath: null,
    });
    expect(tenu).toBe(0);
  });

  it('refuse la borne quand la production ne date pas sa réponse, plutôt que d’inventer un âge', async () => {
    const racine = depot();
    racines.push(racine);
    const code = await main(['--max-heures', '48', '--base-url', 'https://production.test'], {
      cwd: racine,
      fetchImpl: async () => réponse({ corps: PAGE, entetes: { date: 'Thu, 08 Oct 2026 06:00:00 GMT' } }),
      maintenant: () => Date.parse('Thu, 08 Oct 2026 06:00:00 GMT'),
      resumePath: null,
    });
    expect(code).toBe(1);
  });
});

describe('retard-main — le dépôt RÉEL (contrôle positif du garde)', () => {
  const baseRéelle = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], {
        cwd: FRONTEND_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  })();

  it.skipIf(!baseRéelle)('sort 0 sur ce dépôt, sans borne : le garde n’est pas rouge au départ', () => {
    const { code, stdout } = (() => {
      try {
        return {
          code: 0,
          stdout: execFileSync(
            process.execPath,
            [GARDE, '--sans-production', '--base', 'origin/main'],
            { cwd: FRONTEND_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GITHUB_STEP_SUMMARY: '' } }
          ),
        };
      } catch (erreur) {
        return { code: erreur.status, stdout: erreur.stdout || '' };
      }
    })();
    expect(code).toBe(0);
    expect(stdout).toMatch(/base « origin\/main » ↔ branche « /);
  });

  it.skipIf(!baseRéelle)('et lit sur ce dépôt l’arbre de la base, donc ne compte pas de faux retard', () => {
    const faits = mesurer({ cwd: FRONTEND_DIR, base: 'origin/main' });
    expect(faits.base).toBe('origin/main');
    // Le compte brut et la correction sont DEUX valeurs distinctes et
    // vérifiables : c'est la correction qui décide de l'attente.
    expect(faits.absents).toBeGreaterThanOrEqual(faits.attente.enAttente);
    if (faits.arbreTete === faits.arbreBase) expect(faits.attente.enAttente).toBe(0);
  });
});
