/**
 * Tests du CHROME des coquilles (vite-plugins/prerender/app-chrome.js).
 *
 * Pourquoi ce fichier existe : la coquille pré-rendue peignait le corps de la
 * page SANS l'habillage de l'app (`.App`, `.min-h-screen`, la navbar,
 * `main.flex-1`) — chacun des douze shells recopiait sa propre fausse navbar.
 * Or ces conteneurs ne sont pas décoratifs : la navbar fait 65 px et
 * `main.flex-1` se partage la hauteur restante, donc une coquille qui les omet
 * peint une autre géométrie que la page qu'elle pré-rend. La mesure qui a
 * révélé le défaut (Chrome 152, 1350×940, /jobs) : la 2e ligne du paragraphe
 * d'intro passait de x=67.000 à x=218.578 et l'aire LCP du MÊME texte de
 * 36 002 à 36 049 px² (+0,13 %). Chrome n'élit un candidat LCP que pour une
 * aire STRICTEMENT plus grande : ce +47 px² suffisait à ré-élire la peinture
 * de React à 2,5 s (3 runs sur 3 en desktop, score 92 au lieu de 99) — et le
 * même écart expliquait le résidu mesuré sur /contact. L'écart venait alors de
 * l'alignement HÉRITÉ de `.App`, retiré le 25/09/2026 (cf. le bloc « l'alignement
 * est EXPLICITE » plus bas) ; ce qui reste vrai ici est la STRUCTURE — 65 px de
 * navbar et `main.flex-1`.
 *
 * Les tests ci-dessous verrouillent les deux propriétés du correctif :
 *   1. le chrome est la COPIE de celui de src/App.js (mêmes classes), donc il
 *      suit l'app si elle change — au lieu de dériver en silence ;
 *   2. il est publié à UN SEUL endroit : aucune coquille ne le recopie.
 * Plus le fait que les deux injections (accueil et routes) passent par lui.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CHROME_OUVERTURE,
  CHROME_FERMETURE,
  FERMETURE_DE_L_APPLICATION,
  NAV_PLACEHOLDER,
  chromeDePage,
  piedDePage,
} from '../../vite-plugins/prerender/app-chrome.js';

// Un `T` et un `esc` minimaux : le pied de page est testé sur SA FORME (les
// clés qu'il résout, l'ordre de ses liens, le refus d'une clé absente), pas
// sur les libellés d'un dictionnaire — ce que lisent les deux canaux.
const esc = (v) => String(v);
const T = (cle) => (cle === 'inconnue' ? undefined : `[${cle}]`);

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
const APP = lire('src/App.js');
const APP_CSS = lire('src/App.css');
const INDEX_CSS = lire('src/index.css');
const NOT_FOUND = lire('vite-plugins/prerender/not-found.js');
const CHROME = lire('vite-plugins/prerender/app-chrome.js');
const ROUTE_META = lire('vite-plugins/prerender-route-meta.js');

// Le CSS de la décision, débarrassé de ses commentaires : la justification du
// RETRAIT de `.App { text-align: center }` est écrite en commentaire dans
// src/App.css (et cite la règle elle-même), donc chercher dans le texte brut
// lirait la prose — le garde cherche une règle, pas une phrase.
const APP_CSS_SANS_COMMENTAIRES = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('app-chrome — le chrome est la copie de celui de l’app', () => {
  it('les conteneurs et leurs classes sortent de src/App.js, à l’identique', () => {
    // `.App` (l'enveloppe des DEUX canaux — coquille et React), la colonne
    // min-h-screen/flex-col et le main flex-1 : les trois existent mot pour mot
    // dans App.js. Si l'app change son habillage, ce test rougit — et la
    // coquille ne peut plus peindre une autre géométrie que la page.
    for (const classes of [
      'className="App"',
      'className="min-h-screen bg-gray-50 relative flex flex-col"',
      'className="flex-1 pb-24 md:pb-0"',
    ]) {
      expect(APP, `src/App.js ne contient plus ${classes}`).toContain(classes);
    }
    // Et le chrome les publie en HTML (class=, pas className=).
    expect(CHROME_OUVERTURE).toContain('<div class="App">');
    expect(CHROME_OUVERTURE).toContain(
      '<div class="min-h-screen bg-gray-50 relative flex flex-col">'
    );
    expect(CHROME_OUVERTURE).toContain('<main class="flex-1 pb-24 md:pb-0">');
    expect(CHROME_FERMETURE).toBe('</main>');
    expect(FERMETURE_DE_L_APPLICATION).toBe('</div></div>');
  });

  it('le corps passe DANS main, entre l’ouverture et la fermeture', () => {
    const html = chromeDePage('<p class="intro">Texte</p>', '');
    expect(html.startsWith(CHROME_OUVERTURE)).toBe(true);
    expect(html.endsWith(FERMETURE_DE_L_APPLICATION)).toBe(true);
    // Le corps est un frère de la navbar, pas dedans : c'est la structure
    // d'App.js, et c'est elle qui donne à `main` la même hauteur que celle
    // dont React hérite.
    expect(html.indexOf('</nav>')).toBeLessThan(html.indexOf('<p class="intro">'));
    expect(html.indexOf('<main', html.indexOf('<p class="intro">'))).toBe(-1);
  });

  it('la navbar réserve la hauteur RÉELLE : 65 px, soit border-b autour de h-16', () => {
    // Mesuré à 412 et 1350 px : la vraie nav vaut 65 px (border-b de 1 px +
    // un h-16 de 64 px). Un placeholder `h-16 … border-b` seul en fait 64
    // (border-box) : 1 px de moins, tout le contenu démarre décalé au montage
    // de React. La forme imbriquée est la seule qui donne 65.
    expect(NAV_PLACEHOLDER).toContain('<nav');
    expect(NAV_PLACEHOLDER).toContain('border-b');
    expect(NAV_PLACEHOLDER).toMatch(/border-b[^>]*>\s*<div[^>]*\bh-16\b/);
    expect(NAV_PLACEHOLDER).not.toMatch(/class="h-16[^"]*border-b/);
  });
});

describe('app-chrome — publié à UN seul endroit', () => {
  const SHELLS = [
    'vite-plugins/prerender/shells-home.js',
    'vite-plugins/prerender/shells-routes.js',
  ];

  it('aucune coquille ne recopie la navbar ni les conteneurs de l’app', () => {
    for (const rel of SHELLS) {
      const source = lire(rel);
      // La fausse navbar historique, telle qu'elle était recopiée partout.
      expect(source, `${rel} recopie encore la navbar placeholder`).not.toContain(
        'h-16 bg-white border-b border-gray-200'
      );
      expect(source, `${rel} recopie encore la navbar du chrome`).not.toContain(NAV_PLACEHOLDER);
      // Et aucune ne repose elle-même `.App` : l'enveloppe est unique.
      expect(source, `${rel} repose le conteneur .App`).not.toContain(
        '<div class="App">'
      );
    }
  });

  it('les DEUX injections passent par chromeDePage (accueil et routes)', () => {
    // Une seule des deux qui l'oublierait suffirait à remettre une page
    // pré-rendue dans l'ancienne géométrie — l'accueil et /jobs sont les deux
    // routes dont l'élément LCP est un texte du corps.
    expect(ROUTE_META).toMatch(/chromeDePage\(shell, pied\)/);
    expect(ROUTE_META).toMatch(/chromeDePage\(homeShell, pied\)/);
    expect(ROUTE_META).not.toMatch(/'<div id="root">\$\{shell\}<\/div>'/);
    expect(ROUTE_META).not.toMatch(/'<div id="root">\$\{homeShell\}<\/div>'/);
    // UN SEUL pied de page construit, pour les DEUX injections.
    expect(ROUTE_META.match(/piedDePage\(/g)).toHaveLength(1);
  });
});

describe('app-chrome — le PIED DE PAGE appartient au chrome', () => {
  // Mesuré le 25/09/2026 par la sonde de géométrie : React rend `<LegalFooter />`
  // après `</main>` sur TOUTES les routes. Les coquilles ne le publiaient que
  // sur l'accueil, et À L'INTÉRIEUR de `main` — sur /about desktop, le pied de
  // page remontait de 146 px au montage ; sur /login desktop, `main` valait
  // 875 px contre 794 chez React.
  it('le publie APRÈS `</main>` et avant la fermeture des conteneurs', () => {
    const html = chromeDePage('<p>corps</p>', '<footer class="pied"></footer>');
    const ordre = ['<main', '<p>corps</p>', '</main>', '<footer class="pied">', FERMETURE_DE_L_APPLICATION];
    let precedent = -1;
    for (const marque of ordre) {
      const position = html.indexOf(marque);
      expect(position, `${marque} absent ou dans le désordre`).toBeGreaterThan(precedent);
      precedent = position;
    }
  });

  it('résout les MÊMES clés que le pied de page de src/App.js', () => {
    // Les deux canaux lisent les mêmes clés : une clé renommée d'un côté ferait
    // publier à la coquille un autre libellé que la page.
    const pied = piedDePage({ esc, T, socialLinks: [{ url: 'https://exemple', label: 'Exemple' }] });
    for (const cle of ['contactWhatsapp', 'footerItinerary', 'footerAbout', 'footerPrivacy', 'footerTerms']) {
      expect(pied, `le pied de page ne publie plus « ${cle} »`).toContain(`[${cle}]`);
    }
    expect(APP, 'src/App.js ne résout plus les mêmes clés dans LegalFooter').toContain("t('footerAbout')");
    expect(APP).toContain("t('footerPrivacy')");
    expect(APP).toContain("t('footerItinerary')");
    expect(APP).toContain("t('footerTerms')");
    // Les trois liens de confiance, dans l'ordre de la page.
    expect(pied).toMatch(/href="\/about"[\s\S]*href="\/contact"[\s\S]*href="\/privacy"/);
    expect(pied).toContain('Exemple');
  });

  it('REFUSE une clé de libellé absente du dictionnaire', () => {
    // Sans ce refus, la coquille publierait le NOM de la clé là où React publie
    // le libellé — et le build ne le dirait pas.
    expect(() => piedDePage({ esc, T: () => undefined, socialLinks: [] })).toThrow(/contactWhatsapp/);
  });

  it('aucune coquille ne publie de `<footer>` de son côté', () => {
    for (const rel of ['vite-plugins/prerender/shells-home.js', 'vite-plugins/prerender/shells-routes.js']) {
      expect(lire(rel), `${rel} publie encore un pied de page`).not.toMatch(/<footer/);
    }
  });
});

describe('app-chrome — l’alignement est EXPLICITE, plus hérité (refonte du 25/09/2026)', () => {
  // Ce bloc a DÉFENDU l'inverse pendant des mois : `.App { text-align: center }`
  // était une décision assumée, et ces tests exigeaient sa présence. Elle a été
  // RETIRÉE le 25/09/2026, après la mesure qui avait justement servi à la
  // défendre — 22 relevés (11 routes × 2 tailles), 231 déplacements d'encre,
  // jusqu'à 543,89 px, élément LCP compris (`node scripts/mesure-alignement-app.mjs`).
  // Le site est désormais aligné à GAUCHE par défaut, et chaque bloc centré le
  // DÉCLARE. C'est la même mesure qui a tranché les deux sens : elle a d'abord
  // dit « refonte de toutes les pages », puis elle a servi de matière à la faire
  // — d'où les deux moitiés ci-dessous.
  //
  // La preuve que les deux canaux restent d'accord n'est PAS ici (aucun garde
  // statique ne peut comparer les classes de deux canaux) : elle est dans le
  // navigateur, où la coquille et React sont peints tour à tour —
  // `e2e/geometrie-coquille-react.spec.js` (encre + `text-align` calculé, 22
  // relevés) et `e2e/lcp-geometrie.spec.js` (une seule candidate LCP par route).
  it('src/App.css ne recentre PLUS par héritage', () => {
    expect(
      APP_CSS_SANS_COMMENTAIRES,
      'src/App.css re-déclare un alignement sur `.App` — la refonte du 25/09/2026 est défaite, et elle recentrerait en silence tout ce qui ne déclare rien'
    ).not.toMatch(/\.App\s*\{[^}]*text-align/);
  });

  it('la moitié CENTRÉE du dessin est déclarée là où elle vit : l’accueil', () => {
    // Relevé du 25/09/2026 : Home.js portait `text-center` 13 fois, et 6 de ses
    // 7 blocs d'en-tête de section sont centrés par un conteneur
    // `text-center mb-12`. C'est le dessin écrit — il reste centré sans la règle
    // héritée, et c'est ce que ce minimum vérifie.
    const home = lire('src/pages/Home.js');
    expect(home.match(/text-center/g) || []).toHaveLength(13);
  });

  it('la moitié GAUCHE est celle qui ne déclare rien : les pages de contenu', () => {
    // About.js, Privacy.js et Contact.js ne portaient AUCUNE centure (0
    // `text-center` mesuré) : leur centure ne venait que de la règle retirée.
    // Titres, prose, cartes, listes et labels y sont maintenant à gauche, ce qui
    // est le dessin qu'elles décrivaient — et le contraire (de la prose centrée
    // sur huit lignes) est ce que la refonte est venue retirer.
    for (const page of ['About', 'Privacy', 'Contact']) {
      expect(
        lire(`src/pages/${page}.js`),
        `src/pages/${page}.js déclare une centure : c'est une DÉCISION de dessin, pas un alignement hérité — la question doit être reposée`
      ).not.toContain('text-center');
    }
  });

  it('la page et les coquilles publient la même enveloppe', () => {
    // Trois surfaces, une seule décision : le CSS la déclare, React publie la
    // classe (`className`), les coquilles la publient (`class`). Deux qui
    // s'accordent et une qui dérive = deux peintures différentes, donc un
    // élément LCP ré-élu par React (le défaut que ces gardes ferment).
    expect(APP).toContain('className="App"');
    expect(CHROME_OUVERTURE).toContain('<div class="App">');
  });

  it('les deux pages SANS `.App` s’en passent légitimement', () => {
    // 404.html : servie sans aucun script ni feuille du site, elle porte sa
    // PROPRE règle d'alignement — l'héritage de `.App` ne peut pas la
    // concerner. app.html, lui, publie un `#root` VIDE (l'enveloppe y vient de
    // React au montage) : rien à aligner. Ces deux exceptions sont écrites dans
    // le commentaire d'App.css, et elles sont les seules.
    expect(NOT_FOUND).toMatch(/main\{[^}]*text-align:center/);
    expect(NOT_FOUND).not.toContain('App.css');
  });
});

describe('les autres reliquats du gabarit dans src/App.css, TRANCHÉS eux aussi', () => {
  // Le gabarit apportait trois règles ensemble (`.App`, `.App-header`,
  // `.App-link`) plus les quatre déclarations de typographie du `body`. Le
  // verdict de `.App` est ci-dessus (gardée, mesurée). Les autres ont été
  // pesées une par une, et ce sont des RETRAITS — ces trois tests refusent
  // qu'un retrait revienne sans que la question soit reposée.
  it('`.App-header` et `.App-link` ne reviennent pas : 0 pose dans le corpus livré', () => {
    // Mesuré le 25/09/2026 avec le découpage du critère d'élagage lui-même
    // (`nomUtilise`) sur le corpus de l'artefact livré — 74 fichiers, 37 820
    // jetons : `App-header` 0 pose (192 o de source), `App-link` 0 pose
    // (2 règles, 93 o). Elles n'étaient donc pas servies : l'élagage les
    // retirait à chaque build, et le dépôt déclarait un en-tête et une classe
    // de lien que rien ne publiait. Les remettre, c'est redéclarer un site qui
    // n'existe pas.
    expect(
      APP_CSS_SANS_COMMENTAIRES,
      'src/App.css redéclare `.App-header` — 0 pose dans le livré, la question doit être reposée'
    ).not.toMatch(/\.App-header\b/);
    expect(
      APP_CSS_SANS_COMMENTAIRES,
      'src/App.css redéclare `.App-link` — 0 pose dans le livré, la question doit être reposée'
    ).not.toMatch(/\.App-link\b/);
  });

  it('la typographie de base a UN propriétaire : index.css, pas App.css', () => {
    // Mesuré dans la feuille livrée d'une page : `body` était déclaré neuf fois
    // et `font-family` DEUX fois — règle #53 (index.css) et règle #96
    // (App.css), valeurs identiques. C'est la plus TARDIVE qui s'appliquait,
    // donc éditer `index.css`, le fichier de base, n'aurait rien changé, sans
    // que rien ne le dise. Une duplication ne coûte pas que des octets : elle
    // déplace le propriétaire en silence.
    expect(
      INDEX_CSS,
      'src/index.css ne porte plus la pile de polices du site'
    ).toMatch(/font-family:\s*-apple-system/);
    const bloc = APP_CSS_SANS_COMMENTAIRES.match(/\bbody\s*\{([^}]*)\}/);
    expect(bloc, 'src/App.css ne déclare plus de bloc `body`').not.toBeNull();
    expect(
      bloc[1],
      'src/App.css re-déclare la typographie de base — le propriétaire est index.css'
    ).not.toMatch(/font-family|margin\s*:/);
  });

  it('et ce qu’App.css apporte VRAIMENT à `body` y est resté', () => {
    // Le pendant du test précédent : retirer la duplication ne doit pas
    // emporter ce qu'aucune autre feuille ne fournit. `overscroll-behavior`,
    // `position` et `min-height` n'ont pas d'autre porteur, et le fond
    // `#f9fafb` passe devant le `hsl(var(--background))` du thème (règle #52,
    // antérieure) : c'est lui le fond des pages.
    const bloc = APP_CSS_SANS_COMMENTAIRES.match(/\bbody\s*\{([^}]*)\}/)[1];
    for (const declaration of [
      'overscroll-behavior',
      'position',
      'min-height',
      'background-color: #f9fafb',
    ]) {
      expect(bloc, `le bloc body d'App.css ne porte plus « ${declaration} »`).toContain(
        declaration
      );
    }
  });

  it('aucune autre règle du gabarit Vite n’est déclarée dans le dépôt', () => {
    // `#root { max-width: 1280px; padding: 2rem }`, `.logo`, `.card`,
    // `@keyframes logo-spin`, `.read-the-docs` : le gabarit Vite signe par ces
    // règles-là. Vérifié le 25/09/2026 — 0 règle `#root` dans src/, index.html
    // et public/, et 0 pose de `.card`/`.logo`/`.read-the-docs` dans le corpus
    // livré. Il n'y a donc rien à trancher de ce côté, et ce test le dit plutôt
    // que de le laisser supposer.
    expect(APP_CSS_SANS_COMMENTAIRES).not.toMatch(/#root\s*\{/);
    expect(APP_CSS_SANS_COMMENTAIRES).not.toMatch(/@keyframes\s+logo-spin/);
    expect(APP_CSS_SANS_COMMENTAIRES).not.toMatch(/\.read-the-docs\b/);
    expect(lire('index.html')).not.toMatch(/#root\s*\{/);
  });
});
