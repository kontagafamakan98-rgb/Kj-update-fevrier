/**
 * Tests de la provenance du texte des coquilles.
 *
 * Deux niveaux, comme les autres gardes du dépôt :
 *
 *   1. la RÈGLE (`scripts/shell-text-provenance.js`) exercée sur des corpus et
 *      des coquilles FIXTURE — un texte entier, une composition, une valeur
 *      dérivée passent ; un mot inventé, un texte qui n'existe que dans un
 *      commentaire, une date écrite autrement échouent en se nommant ;
 *   2. le GARDE (`scripts/check-shell-text-provenance.js`) exécuté en
 *      sous-processus sur une arborescence `build/` fixture : il lit le VRAI
 *      corpus de la page (son propre dossier) et le build de la fixture, donc le
 *      refus prouvé porte sur le garde réellement exécuté par la CI.
 *
 * Le cas 1.c de la règle est une RÉGRESSION mesurée : un premier lecteur de
 * littéraux se désynchronisait sur une apostrophe de commentaire et perdait les
 * littéraux suivants (`'24/7'`, `'📝'`), ce qui faisait passer du texte légitime
 * pour orphelin. Ce test tient la ligne.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clesDeGlypheDuPlan,
  clesDuDictionnaire,
  copieEnDurDansLesShells,
  coquillesPubliees,
  divergencesDeMarqueur,
  divergencesDeProvenance,
  fragmentsVisibles,
  iconesDuPlan,
  litterauxJs,
  marqueursDuPlan,
  modulesDesCoquilles,
  normaliser,
  textesJsx,
  valeursDerivees,
} from '../shell-text-provenance.js';
// Le registre des icônes dessinées : le plan doit nommer des icônes qui existent.
import { NOMS_D_ICONES } from '../../src/config/page-icons.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-shell-text-provenance.js');

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-provenance-'));
  tempDirs.push(dir);
  return dir;
};

/**
 * Les modules réels qui écrivent les coquilles, installés dans la fixture : le
 * garde les lit DANS LE DOSSIER DU BUILD contrôlé, donc une coquille fixture
 * sans eux serait un « vert sans lecture » (et n'éprouverait pas la vraie
 * règle de copie en dur, qui les parcourt tous).
 */
const installerModules = (dir) => {
  fs.cpSync(path.join(FRONTEND_DIR, 'vite-plugins'), path.join(dir, 'vite-plugins'), { recursive: true });
};

const coquille = (dir, nom, html) => {
  const build = path.join(dir, 'build');
  fs.mkdirSync(build, { recursive: true });
  installerModules(dir);
  const fichier = path.join(build, nom);
  fs.writeFileSync(fichier, html);
  return fichier;
};

/**
 * Exécute le VRAI garde, avec `cwd` sur la fixture, SANS bloquer la boucle
 * d'événements du worker : `spawnSync` enchaîne les lancements dans un seul tour
 * de boucle (les `await` de vitest ne cèdent que des micro-tâches). Le fichier
 * voisin `check-prerender-shells.test.js` en a été mesuré à 62 000 ms de famine —
 * au-delà du délai RPC de vitest (60 s), qui sort alors la suite en 1 sur un
 * timeout étranger au code.
 */
const runGuard = (cwd) =>
  new Promise((resolve) => {
    const enfant = spawn(process.execPath, [SCRIPT], { cwd });
    let out = '';
    enfant.stdout.setEncoding('utf8');
    enfant.stderr.setEncoding('utf8');
    enfant.stdout.on('data', (bloc) => (out += bloc));
    enfant.stderr.on('data', (bloc) => (out += bloc));
    enfant.on('close', (status) => resolve({ status, out }));
  });

describe('shell-text-provenance — lire les littéraux d’un fichier source', () => {
  it('ignore les commentaires, sans perdre les littéraux qui suivent', () => {
    const source = [
      '// la copie de son côté : « 24/7 » d’un bloc',
      '/* et d’un autre, sur deux lignes',
      '   avec une apostrophe ’ */',
      "export const stats = { support: '24/7', guide: '📝 Guide' };",
    ].join('\n');
    const literaux = litterauxJs(source);
    expect(literaux).toContain('24/7');
    expect(literaux).toContain('📝 Guide');
    expect(literaux.some((l) => l.includes('24/7 »'))).toBe(false);
  });

  it('ignore les expressions régulières qui contiennent des quotes', () => {
    const literaux = litterauxJs("const motif = /[\"']/g;\nconst texte = 'Connexion';\n");
    expect(literaux).toContain('Connexion');
  });

  // Une apostrophe de TEXTE JSX ne peut pas ouvrir un littéral (un identifiant
  // suivi d'une quote est une erreur de syntaxe) : sans cette précision, elle
  // masquait tout ce qui suit jusqu'à la quote suivante — RÉGRESSION mesurée,
  // où le littéral d'après disparaissait du corpus.
  it('ne perd pas le littéral qui suit une apostrophe de texte JSX', () => {
    const source = [
      'export const Carte = () => (',
      '  <p>Le guide de l’utilisateur</p>',
      ');',
      "export const suivant = 'Connexion';\n",
    ].join('\n');
    expect(litterauxJs(source)).toContain('Connexion');
  });

  it('lit le TEXTE JSX, avec sa ligne, ses bornes et ses entités résolues', () => {
    const source = [
      'export const Carte = () => (',
      '  <p className="text-sm">',
      '    Une adresse introuvable',
      '  </p>',
      ');\n',
    ].join('\n');
    const textes = textesJsx(source);
    expect(textes).toHaveLength(1);
    expect(textes[0].valeur).toBe('Une adresse introuvable');
    expect(textes[0].ligne).toBe(3);
    expect(source.slice(textes[0].debut, textes[0].fin)).toBe('Une adresse introuvable');
  });

  // Le texte est lu là où il S'ÉCRIT : une expression (`{t('x')}`), un attribut
  // et une zone de code ne sont pas des nœuds de texte.
  it('ignore les expressions, les attributs et le code', () => {
    const textes = textesJsx(
      "const titre = 'Connexion';\nexport const C = () => <input title={t('titre')} placeholder=\"exemple\" />;\n"
    );
    expect(textes.map((t) => t.valeur)).toEqual([]);
  });
});

describe('shell-text-provenance — lire les fragments publiés', () => {
  it('écarte script, style et commentaires, et résout les entités', () => {
    const html =
      '<div id="root"><h1>Connexion</h1><script>const a = "x";</script>' +
      '<!-- un commentaire --><p>Conditions d&#x27;utilisation</p></div>';
    const fragments = fragmentsVisibles(html);
    expect(fragments).toContain('Connexion');
    expect(fragments).toContain("Conditions d'utilisation");
    expect(fragments.some((f) => f.includes('const a'))).toBe(false);
    expect(fragments.some((f) => f.includes('commentaire'))).toBe(false);
  });

  it('normalise les espaces sans toucher au texte', () => {
    expect(normaliser('  Deux   mots\n')).toBe('Deux mots');
  });
});

describe('shell-text-provenance — la règle de provenance', () => {
  const atomes = new Set([
    'Connexion',
    'Mot de passe oublié',
    'Emplois disponibles',
    'Créer un compte',
  ]);
  const derivees = new Set(['-- Mali --', '--- XX XXX XX XX']);

  const divergences = (html, options = {}) =>
    divergencesDeProvenance({
      coquilles: [coquille(tmp(), 'page.html', html)],
      atomes,
      derivees,
      ...options,
    });

  it('accepte un texte ENTIER de la page', () => {
    expect(divergences('<div id="root"><h1>Connexion</h1></div>')).toEqual([]);
  });

  it('accepte une COMPOSITION de textes entiers et de séparateurs', () => {
    expect(divergences('<div>Mot de passe oublié · Créer un compte</div>')).toEqual([]);
  });

  it('accepte une valeur dérivée DÉCLARÉE et un nombre', () => {
    expect(divergences('<p>-- Mali --</p><p>1 000+</p><span>--- XX XXX XX XX</span>')).toEqual([]);
  });

  it('refuse un mot que la page ne porte pas, et nomme le texte le plus proche', () => {
    const trouvees = divergences('<div id="root"><h1>Connexion sécurisée maintenant</h1></div>');
    expect(trouvees).toHaveLength(1);
    expect(trouvees[0].fragment).toBe('Connexion sécurisée maintenant');
    expect(trouvees[0].coquille).toBe('page.html');
    expect(trouvees[0].proches).toContain('Connexion');
  });

  it("refuse un texte qui n'existe que dans un COMMENTAIRE de la page", () => {
    // Un commentaire ne publie rien : le lecteur doit le sauter, sinon un mot
    // commenté dans `src/` légitimerait n'importe quelle coquille.
    const source = [
      '// Annonce réservée aux membres',
      "export const titre = 'Connexion';",
    ].join('\n');
    const commentes = litterauxJs(source);
    expect(commentes).not.toContain('Annonce réservée aux membres');
    const trouvees = divergences('<div>Annonce réservée aux membres</div>', { atomes: new Set(commentes) });
    expect(trouvees).toHaveLength(1);
    expect(trouvees[0].fragment).toBe('Annonce réservée aux membres');
  });

  it('accepte les dates que la page DÉCLARE, refuse la même précédée d’un texte non déclaré', () => {
    // La date publiée n'est pas un texte de la page : c'est le JOUR, que
    // `prerender-route-meta.js` et `Jobs.js` formatent chacun de leur côté. Un
    // littéral tapé ici (« 23 septembre 2026 ») ne rendait ce cas vrai qu'un
    // seul jour — le 24 au matin, il rougissait sans qu'aucune ligne ait bougé.
    // Le test demande donc la date à la même source que la page : l'horloge.
    const derivees = valeursDerivees(FRONTEND_DIR);
    for (const jour of ['numeric', '2-digit']) {
      for (const mois of ['long', 'short']) {
        const date = new Intl.DateTimeFormat('fr-FR', { day: jour, month: mois, year: 'numeric' }).format(
          new Date()
        );
        expect(derivees.has(normaliser(date))).toBe(true);
        expect(divergences(`<p>${date}</p>`, { derivees })).toEqual([]);
        const trouvees = divergences(`<p>Le ${date}</p>`, { derivees });
        expect(trouvees).toHaveLength(1);
        expect(trouvees[0].fragment).toBe(`Le ${date}`);
      }
    }
  });
});

describe('shell-text-provenance — la copie en dur dans un module de coquille', () => {
  /** Un dossier `vite-plugins` fixture, avec ses modules. */
  const modulesFixture = (modules) => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'prerender'), { recursive: true });
    for (const [nom, source] of Object.entries(modules)) {
      fs.writeFileSync(path.join(dir, 'prerender', nom), source);
    }
    return dir;
  };

  const moduleAvec = (nom, source) => modulesFixture({ [nom]: source });

  it('refuse un texte AFFICHÉ écrit en littéral, en nommant le module, la ligne et le texte', () => {
    const modulesDir = moduleAvec(
      'shells-routes.js',
      [
        'export const shell = (T) =>',
        '  `<div>` +',
        "  `<h1>Connexion</h1>` +",
        '  `</div>`;',
      ].join('\n')
    );
    const fichier = coquille(tmp(), 'login.html', '<div id="root"><h1>Connexion</h1></div>');
    const divergences = copieEnDurDansLesShells({ modulesDir, coquilles: [fichier] });
    expect(divergences).toEqual([{ module: 'prerender/shells-routes.js', ligne: 3, texte: 'Connexion' }]);
  });

  it('accepte le NOM dune clé : un module écrit `login`, la coquille publie « Connexion »', () => {
    const modulesDir = moduleAvec(
      'shells-routes.js',
      "export const shell = (T) => `<h1>${T('login')}</h1>`;\n"
    );
    const fichier = coquille(tmp(), 'login.html', '<div id="root"><h1>Connexion</h1></div>');
    expect(copieEnDurDansLesShells({ modulesDir, coquilles: [fichier] })).toEqual([]);
    // …et la clé reste reconnue comme un NOM quand le dictionnaire la déclare.
    const frontendDir = tmp();
    fs.mkdirSync(path.join(frontendDir, 'src', 'i18n'), { recursive: true });
    fs.writeFileSync(path.join(frontendDir, 'src', 'i18n', 'fr.json'), JSON.stringify({ login: 'Connexion' }));
    const cles = clesDuDictionnaire(frontendDir);
    const fichierAvecCle = coquille(tmp(), 'login.html', '<div id="root"><h1>login</h1></div>');
    expect(copieEnDurDansLesShells({ modulesDir, coquilles: [fichierAvecCle], cles })).toEqual([]);
  });

  it('refuse un littéral qui PORTE DES BALISES autour du texte publié', () => {
    // Régression mesurée : sans écarter les balises, `<h1>Connexion</h1>` n'était
    // comparé à aucun fragment et la copie passait.
    const modulesDir = moduleAvec(
      'shells-routes.js',
      "export const shell = (T) => `<p>Une phrase Connexion ici</p>`;\n"
    );
    const fichier = coquille(tmp(), 'login.html', '<div id="root"><p>Une phrase Connexion ici</p></div>');
    const divergences = copieEnDurDansLesShells({ modulesDir, coquilles: [fichier] });
    expect(divergences.map((d) => d.texte)).toEqual(['Une phrase Connexion ici']);
  });

  it('refuse un mot écrit en dur même quand le fragment publié est plus long', () => {
    const modulesDir = moduleAvec('shells-routes.js', "export const t = 'Connexion';\n");
    const fichier = coquille(tmp(), 'login.html', '<div id="root"><h1>Connexion sécurisée</h1></div>');
    const divergences = copieEnDurDansLesShells({ modulesDir, coquilles: [fichier] });
    expect(divergences.map((d) => d.texte)).toEqual(['Connexion']);
  });

  it('accepte un littéral qui n apparaît PAS comme un mot publié (classe, sélecteur)', () => {
    const modulesDir = moduleAvec(
      'shells-routes.js',
      'export const shell = (T) => `<div class="rounded-2xl">${T(\'login\')}</div>`;\n'
    );
    const fichier = coquille(tmp(), 'login.html', '<div id="root"><h1>Connexion</h1></div>');
    expect(copieEnDurDansLesShells({ modulesDir, coquilles: [fichier] })).toEqual([]);
  });

  it('lit les modules là où ils sont : la façade et larbre `prerender/`', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'prerender'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'prerender-route-meta.js'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(dir, 'prerender', 'shells.js'), 'export const y = 1;\n');
    expect(modulesDesCoquilles(dir).map((m) => path.relative(dir, m).split(path.sep).join('/'))).toEqual([
      'prerender-route-meta.js',
      'prerender/shells.js',
    ]);
  });

  it('l arbre RÉEL est vert : aucun module n écrit de texte affiché en littéral', () => {
    // Mesuré sur les 13 coquilles construites et les 7 modules réels : aucun
    // littéral portant une lettre n'apparaît comme un mot dans un fragment publié.
    expect(modulesDesCoquilles(path.join(FRONTEND_DIR, 'vite-plugins')).length).toBeGreaterThanOrEqual(7);
    let coquilles = [];
    try {
      coquilles = coquillesPubliees(path.join(FRONTEND_DIR, 'build'));
    } catch {
      coquilles = [];
    }
    expect(
      copieEnDurDansLesShells({
        modulesDir: path.join(FRONTEND_DIR, 'vite-plugins'),
        coquilles,
        cles: clesDuDictionnaire(FRONTEND_DIR),
      })
    ).toEqual([]);
  });
});

describe('shell-text-provenance — la règle des marqueurs', () => {
  /**
   * Un frontend FIXTURE : le dictionnaire, le plan, les modules de pré-rendu. La
   * règle des marqueurs lit ces trois surfaces, donc elle se prouve sur des
   * fixtures — sans toucher aux fichiers réels du dépôt.
   */
  const frontendFixture = ({ dictionnaire, plan, modules = {} }) => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'src', 'i18n'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'config'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'vite-plugins', 'prerender'), { recursive: true });
    // Les cinq langues existent : la règle lit les dictionnaires pour les
    // valeurs dérivées, et « la clé manque » n'est pas le sujet de ces cas.
    for (const langue of ['fr', 'en', 'wo', 'bm', 'mos']) {
      fs.writeFileSync(
        path.join(dir, 'src', 'i18n', `${langue}.json`),
        JSON.stringify(langue === 'fr' ? dictionnaire : {})
      );
    }
    fs.writeFileSync(path.join(dir, 'src', 'config', 'page-sections.js'), plan);
    for (const [nom, source] of Object.entries(modules)) {
      fs.writeFileSync(path.join(dir, 'vite-plugins', 'prerender', nom), source);
    }
    return dir;
  };

  const PLAN_SIMPLE = "export const PAGE_SECTIONS = { '/': { steps: [] } };\n";
  // Les exemptions de la liste réelle décrivent l'arbre réel : sur un frontend
  // fixture, on passe la liste que le cas veut éprouver (vide par défaut).
  const SANS_EXEMPTION = { exemptions: [] };

  it('refuse un littéral du plan qui RECOPIE la valeur dune clé, en nommant la clé', () => {
    const frontendDir = frontendFixture({
      dictionnaire: { iconWorker: '🔧' },
      plan: [
        'export const PAGE_SECTIONS = {',
        "  '/register': { workerIconKey: 'iconWorker' },",
        "  '/': { categories: [{ labelKey: 'plumbing', icon: '🔧' }] },",
        '};',
      ].join('\n'),
    });
    const divergences = divergencesDeMarqueur({ frontendDir, ...SANS_EXEMPTION });
    expect(divergences).toHaveLength(1);
    expect(divergences[0].sorte).toBe('plan-recopie');
    expect(divergences[0].valeur).toBe('🔧');
    expect(divergences[0].cles).toEqual(['iconWorker']);
    expect(divergences[0].ligne).toBe(3);
  });

  it('accepte la MÊME recopie quand l exemption est déclarée avec son motif', () => {
    const frontendDir = frontendFixture({
      dictionnaire: { iconWorker: '🔧' },
      plan: "export const PAGE_SECTIONS = { '/': { categories: [{ icon: '🔧' }] } };\n",
    });
    expect(divergencesDeMarqueur({ frontendDir, ...SANS_EXEMPTION })).toHaveLength(1);
    expect(
      divergencesDeMarqueur({
        frontendDir,
        exemptions: [{ valeur: '🔧', sorte: 'plan', motif: 'rôle différent (cas de test)' }],
      })
    ).toEqual([]);
  });

  it('refuse un marqueur PUBLIÉ que personne ne détient', () => {
    const frontendDir = frontendFixture({ dictionnaire: { iconWorker: '🔧' }, plan: PLAN_SIMPLE });
    const fichier = coquille(tmp(), 'page.html', '<div id="root"><span>★</span></div>');
    const divergences = divergencesDeMarqueur({ frontendDir, coquilles: [fichier], ...SANS_EXEMPTION });
    expect(divergences).toHaveLength(1);
    expect(divergences[0]).toMatchObject({ sorte: 'marqueur-sans-porteur', valeur: '★', coquille: 'page.html' });
  });

  it('accepte le marqueur publié quand SA CLÉ est nommée par un canal', () => {
    const frontendDir = frontendFixture({
      dictionnaire: { brandMark: 'K' },
      plan: PLAN_SIMPLE,
      modules: { 'shells.js': "export const logo = (T) => `<span>${T('brandMark')}</span>`;\n" },
    });
    const fichier = coquille(tmp(), 'page.html', '<div id="root"><span>K</span></div>');
    expect(divergencesDeMarqueur({ frontendDir, coquilles: [fichier], ...SANS_EXEMPTION })).toEqual([]);
  });

  it('refuse une clé de glyphe que le dictionnaire ne connaît pas', () => {
    const frontendDir = frontendFixture({
      dictionnaire: { iconWorker: '🔧' },
      plan: "export const PAGE_SECTIONS = { '/': { categories: [{ iconKey: 'iconPlomberie' }] } };\n",
    });
    expect(divergencesDeMarqueur({ frontendDir, ...SANS_EXEMPTION })).toEqual([
      {
        sorte: 'cle-inconnue',
        fichier: 'src/config/page-sections.js',
        ligne: 1,
        cle: 'iconPlomberie',
      },
    ]);
  });

  it('refuse une exemption PÉRIMÉE — une décision oubliée n protège plus rien', () => {
    const frontendDir = frontendFixture({ dictionnaire: { iconWorker: '🔧' }, plan: PLAN_SIMPLE });
    const divergences = divergencesDeMarqueur({
      frontendDir,
      exemptions: [{ valeur: '🔧', sorte: 'plan', motif: 'exemption devenue inutile' }],
    });
    expect(divergences).toHaveLength(1);
    expect(divergences[0]).toMatchObject({ sorte: 'exemption-perimee', valeur: '🔧' });
  });

  it('l arbre RÉEL est vert : chaque coïncidence du plan est corrigée ou exemptée', () => {
    // Le contrôle qui compte : le plan réel ne recopie plus le bouclier du
    // séquestre (il lit `iconEscrow`), et les quatre coïncidences restantes —
    // mêmes octets, rôle différent — sont déclarées dans la liste, avec leur motif.
    expect(divergencesDeMarqueur({ frontendDir: FRONTEND_DIR })).toEqual([]);
  });

  it('le plan ne porte plus un seul GLYPHE en littéral, et ses icônes existent', () => {
    // L'état atteint le 26/09/2026 : les glyphes des pages pré-rendues sont
    // TOUS DESSINÉS, déclarés par un NOM d'icône (`icone` dans une liste,
    // `*Icon` au niveau route, src/config/page-icons.js) — catégories, promesses,
    // étapes et séquestre de l'accueil, puis cartes d'À propos, étapes de
    // « Comment ça marche », modes et lignes de contact de /support, lignes et
    // repère de carte de /contact, puis la DERNIÈRE vague : cartes de type de
    // compte, notice légale et d'étape, emplacements photo, sélecteur de pays de
    // /register, notice de /login, pastille de /forgot-password et carte de
    // /payment. Il ne reste AUCUN glyphe déclaré par sa clé i18n : zéro champ
    // `iconKey`/`shellIconKey`, et plus aucun `*IconKey` (la forme route est
    // `*Icon`). Il ne reste en littéral que les deux suffixes « + », qui font
    // partie d'un NOMBRE (`1 000+`) et non d'un glyphe.
    expect(marqueursDuPlan(FRONTEND_DIR).map((champ) => champ.valeur)).toEqual(['+', '+']);
    expect(clesDeGlypheDuPlan(FRONTEND_DIR)).toEqual([]);

    // Les icônes DESSINÉES : le plan en déclare au moins les 17 de l'accueil (10
    // catégories, 3 promesses, 3 étapes, 1 séquestre) plus les 30 des sept autres
    // pages (À propos, Comment ça marche, Support, Contact et les quatre écrans de
    // compte), et CHACUNE existe dans le registre — un nom inconnu ferait lever
    // `IconePage` au build.
    const icones = iconesDuPlan(FRONTEND_DIR);
    expect(icones.length).toBeGreaterThanOrEqual(45);
    expect(icones.filter(({ nom }) => !NOMS_D_ICONES.includes(nom))).toEqual([]);
  });
});

describe('check-shell-text-provenance — le garde exécuté', () => {
  it('sort en 0 sur une coquille fixture qui ne publie que du texte de la page', async () => {
    const dir = tmp();
    coquille(dir, 'login.html', '<div id="root"><h1>Connexion</h1></div>');
    const { status, out } = await runGuard(dir);
    expect(status).toBe(0);
    expect(out).toContain('Provenance du texte des coquilles intacte');
  });

  it('refuse : un fragment publié sans source côté page, en le nommant', async () => {
    const dir = tmp();
    coquille(
      dir,
      'login.html',
      '<div id="root"><h1>Connexion</h1><p>Une phrase que la page ne possède pas</p></div>'
    );
    const { status, out } = await runGuard(dir);
    expect(status).toBe(1);
    expect(out).toContain('login.html publie « Une phrase que la page ne possède pas »');
    expect(out).toContain('sans source côté page');
  });

  it('refuse : un build sans coquille (vert sans lecture)', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
    const { status, out } = await runGuard(dir);
    expect(status).toBe(1);
    expect(out).toContain('aucune coquille dans build/');
  });

  it('refuse : un texte affiché écrit en dur dans un module, en le nommant', async () => {
    const dir = tmp();
    coquille(dir, 'login.html', '<div id="root"><h1>Connexion</h1></div>');
    // La réintroduction exacte que la règle doit attraper : la coquille écrit
    // « Connexion » au lieu de résoudre la clé.
    fs.writeFileSync(
      path.join(dir, 'vite-plugins', 'prerender', 'copie-en-dur.js'),
      "export const titre = '<h1>Connexion</h1>';\n"
    );
    const { status, out } = await runGuard(dir);
    expect(out).toContain('Copie en dur dans les coquilles');
    expect(out).toContain('vite-plugins/prerender/copie-en-dur.js:1 écrit « Connexion »');
    expect(status).toBe(1);
  });

  it('refuse : un dossier de modules absent (vert sans lecture)', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'build', 'login.html'), '<div id="root"><h1>Connexion</h1></div>');
    const { status, out } = await runGuard(dir);
    expect(out).toContain('aucun module dans');
    expect(status).toBe(1);
  });

  it('refuse : un marqueur publié que personne ne détient, en le nommant', async () => {
    // Le garde lit le plan et le dictionnaire RÉELS (son propre dossier) et la
    // coquille de la fixture : le marqueur `★` n'appartient à rien, donc le
    // verdict doit tomber ici, pas seulement dans la règle.
    const dir = tmp();
    coquille(dir, 'index.html', '<div id="root"><h1>Connexion</h1><span>★</span></div>');
    const { status, out } = await runGuard(dir);
    // La première assertion nomme la RÈGLE : c'est elle qui doit apparaître dans
    // la sortie si la ligne du verdict est neutralisée (preuve de mutation).
    expect(out).toContain('Marqueurs des coquilles');
    expect(out).toContain('index.html publie le marqueur « ★ »');
    expect(status).toBe(1);
  });
});
