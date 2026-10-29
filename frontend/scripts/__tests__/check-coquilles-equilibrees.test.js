/**
 * L'ÉQUILIBRE DES BALISES des coquilles pré-rendues — la règle, le refus, et
 * les DOUZE pages.
 *
 * Ce que ce fichier mesure, et pourquoi il existe. Le 27/09/2026, la section des
 * étapes du shell d'accueil ne refermait pas son conteneur `max-w-7xl` : 68
 * `<div>` ouverts pour 67 refermés. AUCUNE sonde de navigateur ne pouvait le
 * voir — le parseur HTML répare (un `</section>` dont la section est en portée
 * referme d'abord les `div` encore ouverts), donc la parité de hauteur, celle du
 * texte et le CLS restaient verts (113/113) pendant que le document publié était
 * bancal. C'est `scripts/check-home-shell.js` qui avait mordu, et lui seul — sur
 * l'ACCUEIL. Le build, lui, ne refusait rien : il écrivait la coquille telle
 * quelle.
 *
 * Trois choses sont vérifiées ici, et la troisième est celle qui manquait :
 *
 *   1. LA RÈGLE — ce qu'elle refuse (un élément jamais refermé, un élément
 *      refermé en portée par une balise d'un autre nom, une fermante orpheline,
 *      une ouvrante non terminée) et ce qu'elle NE refuse PAS (balises vides,
 *      auto-fermées, contenu de `<script>`/`<style>`, commentaires, `>` dans un
 *      attribut entre guillemets). Un contrôle qui refuse du HTML valide se fait
 *      retirer au lieu d'être corrigé : ces cas-là sont donc mesurés aussi.
 *   2. LE REFUS — la fabrique que le build appelle (`makeEquilibreGuard`) lève,
 *      en NOMMANT la coquille et la balise. Un refus jamais vu lever est une
 *      intention, pas une preuve.
 *   3. LES DOUZE PAGES — les coquilles RÉELLES, composées par les modules du
 *      build (`shells-home.js`, `shells-routes.js`) sur la table des routes
 *      (`src/config/page-meta.js`), sont équilibrées : le corps, ET le corps
 *      enveloppé du chrome. Le compte des routes n'est pas écrit ici : il est
 *      DÉRIVÉ de la table, donc une page ajoutée demain est mesurée sans qu'on
 *      touche à ce fichier — et une page qui n'aurait pas de coquille fait
 *      rougir le cas d'énumération.
 *
 * Ce fichier ne remplace pas `scripts/check-prerender-shells.js` : celui-ci lit
 * les fichiers ÉCRITS dans `build/` (l'artefact livré), celui-là lit ce que les
 * fabriques PRODUISENT (la source du défaut). Les deux lisent la même règle.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decrireDesequilibre,
  desequilibresDesBalises,
  makeEquilibreGuard,
} from '../../vite-plugins/prerender/balises.js';
import { chromeDePage, piedDePage } from '../../vite-plugins/prerender/app-chrome.js';
import { buildHomeShell } from '../../vite-plugins/prerender/shells-home.js';
import { buildRouteShells } from '../../vite-plugins/prerender/shells-routes.js';
import {
  buildAppTemplate,
  NOM_DU_GABARIT_APP,
} from '../../vite-plugins/prerender/app-template.js';
import { buildNotFoundPage, NOM_DE_LA_PAGE_404 } from '../../vite-plugins/prerender/not-found.js';
import { setMeta } from '../../vite-plugins/prerender/route-meta.js';
import { PAGE_META } from '../../src/config/page-meta.js';
import { PAGE_SECTIONS } from '../../src/config/page-sections.js';
import { CONTACT } from '../../src/config/contact.js';
import { makeScopedTranslator as makeRegisterTranslator } from '../../src/utils/pack2PageI18n/register.js';
import { makeScopedTranslator as makeJobsTranslator } from '../../src/utils/pack2PageI18n/jobs.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fr = JSON.parse(readFileSync(path.join(FRONTEND_DIR, 'src', 'i18n', 'fr.json'), 'utf8'));

// Les MÊMES entrées que le propriétaire des coquilles
// (vite-plugins/prerender-route-meta.js) : les corps sont donc ceux que le build
// écrit, jamais une recopie qui pourrait dériver de lui.
const esc = (valeur) =>
  String(valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const T = (cle) => fr[cle];

const COQUILLES_DE_ROUTE = buildRouteShells({
  esc,
  T,
  registerT: makeRegisterTranslator('fr', T),
  jobsT: makeJobsTranslator('fr', T),
  contact: CONTACT,
  pageSections: PAGE_SECTIONS,
  googleAuth: Boolean(String(process.env.VITE_GOOGLE_CLIENT_ID || '').trim()),
});
const COQUILLE_ACCUEIL = buildHomeShell({
  esc,
  T,
  contact: CONTACT,
  socialLinks: [],
  pageSections: PAGE_SECTIONS,
});
const PIED_DE_PAGE = piedDePage({ esc, T, socialLinks: [] });

/** Les corps par ROUTE (« /jobs » → corps), comme le plugin les assemble. */
const CORPS_PAR_ROUTE = {
  '/': COQUILLE_ACCUEIL,
  ...Object.fromEntries(
    Object.entries(COQUILLES_DE_ROUTE).map(([route, corps]) => [`/${route}`, corps])
  ),
};

describe('équilibre des balises — ce que la règle refuse', () => {
  it('accepte un fragment équilibré', () => {
    expect(desequilibresDesBalises('<div><p>a</p><section><span>b</span></section></div>')).toEqual(
      []
    );
  });

  it('refuse un élément refermé EN PORTÉE, et dit par quoi (le défaut mesuré)', () => {
    // Le `</section>` referme le `div` resté ouvert : c'est LITTÉRALEMENT la
    // façon dont le défaut du 27/09/2026 se cachait dans le document.
    const problemes = desequilibresDesBalises('<section><div>x</section>');
    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toMatchObject({ type: 'fermee-en-portee', balise: 'div', fermeePar: 'section' });
    expect(decrireDesequilibre(problemes[0])).toContain('PORTÉE');
  });

  it('refuse un élément jamais refermé, et un `</div>` de trop', () => {
    const jamaisFerme = desequilibresDesBalises('<div><p>a</p>');
    expect(jamaisFerme).toHaveLength(1);
    expect(jamaisFerme[0]).toMatchObject({ type: 'non-fermee', balise: 'div' });
    expect(decrireDesequilibre(jamaisFerme[0])).toContain('JAMAIS refermé');

    const orpheline = desequilibresDesBalises('<p>a</p></div>');
    expect(orpheline).toHaveLength(1);
    expect(orpheline[0]).toMatchObject({ type: 'fermee-sans-ouverture', balise: 'div' });
  });

  it('refuse une ouvrante non terminée', () => {
    const problemes = desequilibresDesBalises('<div class="x"');
    expect(problemes).toHaveLength(1);
    expect(problemes[0].type).toBe('non-terminee');
  });

  it('ne refuse PAS ce que le parseur accepte tel quel (sinon le contrôle se ferait retirer)', () => {
    // Balises VIDES : elles n'ont pas de fermeture à exiger.
    expect(desequilibresDesBalises('<p><img src="/a.png"><br><input type="text"><meta charset="utf-8"></p>')).toEqual([]);
    // Auto-fermées : les icônes SVG du site s'écrivent ainsi.
    expect(desequilibresDesBalises('<svg><path d="M0 0" /><circle cx="1" cy="1" r="2" /></svg>')).toEqual([]);
    // Contenu d'un élément à texte brut : ce `</div>` est une CHAÎNE, pas une balise.
    expect(desequilibresDesBalises('<script>const a = "</div>"; if (x < 3) y();</script>')).toEqual([]);
    expect(desequilibresDesBalises('<style>.a::after { content: "</div>" }</style>')).toEqual([]);
    // Commentaire : rien de ce qu'il contient n'est publié.
    expect(desequilibresDesBalises('<!-- <div> --><p>a</p>')).toEqual([]);
    // Un `>` dans un attribut entre guillemets ne termine pas la balise.
    expect(desequilibresDesBalises('<a title="a > b">x</a>')).toEqual([]);
    // Et une comparaison dans du texte n'ouvre rien.
    expect(desequilibresDesBalises('<p>2 < 3 et 5 > 4</p>')).toEqual([]);
  });

  it('refuse un `<script>` non refermé (le contenu brut n’est pas une excuse)', () => {
    const problemes = desequilibresDesBalises('<div><script>const a = 1;</div>');
    expect(problemes.map((p) => p.balise)).toEqual(expect.arrayContaining(['script', 'div']));
  });
});

describe('équilibre des balises — le refus du build', () => {
  const exiger = makeEquilibreGuard({ origine: 'prerender-route-meta' });

  it('lève en NOMMANT la coquille et la balise fautive', () => {
    const casse = COQUILLES_DE_ROUTE.jobs.replace(/<\/div>$/, '');
    // Le contrôle qui donne son sens au rouge : le corps INTACT, lui, passe.
    expect(() => exiger('la coquille /jobs', COQUILLES_DE_ROUTE.jobs)).not.toThrow();

    let erreur;
    try {
      exiger('la coquille /jobs', casse);
    } catch (e) {
      erreur = e;
    }
    expect(erreur?.message).toContain('DÉSÉQUILIBRÉ');
    expect(erreur?.message).toContain('la coquille /jobs');
    expect(erreur?.message).toContain('`<div>`');
    expect(erreur?.message).toContain('JAMAIS refermé');
    // Le refus dit POURQUOI il est ici et pas dans un navigateur : c'est la
    // leçon du 27/09/2026, et c'est ce qui empêche de le retirer pour faire
    // taire un rouge.
    expect(erreur?.message).toContain('RÉPARE');
  });

  it('dit combien de balises ne se referment pas, et n’en énumère pas plus de trois', () => {
    // Quatre `div` ouverts, aucun refermé : le message compte (4) et s'arrête à
    // trois exemples — un refus de build se lit debout, il ne déverse pas un
    // document entier dans la console.
    let erreur;
    try {
      exiger('le corps de test', '<div><div><div><div><p>a</p>');
    } catch (e) {
      erreur = e;
    }
    expect(erreur?.message).toContain('4 balise(s)');
    expect(erreur?.message).toContain('(et 1 autre(s))');
    expect(erreur?.message.match(/JAMAIS refermé/g)).toHaveLength(3);
  });
});

describe('équilibre des balises — LES DOUZE PAGES pré-rendues', () => {
  const routes = Object.keys(PAGE_META);

  it('couvre EXACTEMENT la table des routes (aucune page n’échappe à la mesure)', () => {
    expect(routes).toHaveLength(12);
    // Une route déclarée sans corps signifierait un SHELLS[route] vide : le
    // contrôle passerait alors sur une chaîne vide, donc ne mesurerait rien.
    const sansCorps = routes.filter((route) => !CORPS_PAR_ROUTE[route]);
    expect(sansCorps).toEqual([]);
  });

  for (const route of Object.keys(PAGE_META)) {
    it(`${route} : le corps, et le corps enveloppé du chrome, s’équilibrent`, () => {
      const corps = CORPS_PAR_ROUTE[route];
      const problemes = desequilibresDesBalises(corps).map(decrireDesequilibre);
      expect(problemes).toEqual([]);

      // Le chrome (navbar + `.App` + `main.flex-1` + pied de page) est une
      // PARTIE du document écrit : un corps équilibré dans une enveloppe
      // déséquilibrée donnerait le même document bancal.
      const document = chromeDePage(corps, PIED_DE_PAGE);
      expect(desequilibresDesBalises(document).map(decrireDesequilibre)).toEqual([]);
    });
  }
});

// ── LES DEUX ARTEFACTS QUI NE SONT PAS DES ROUTES ──────────────────────────
//
// Le gabarit des routes privées et la 404 statique sortent du MÊME plugin que
// les douze pages, atterrissent dans le MÊME `build/`, et n'étaient lus par
// aucun contrôle d'équilibre jusqu'au 28/09/2026 — c'est l'angle que le refus
// du build et le garde d'après-build ferment. Ce cas mesure la SOURCE du défaut
// (ce que les fabriques produisent), l'autre lit l'artefact écrit ; les deux
// lisent la même règle, comme pour les pages.
//
// L'entrée d'`app.html` est le `index.html` DU DÉPÔT, et non celui du build :
// un test neuf ne doit pas dépendre d'un `build/` qui a tourné (le document
// émis en diffère par le CSS inliné et la CSP, jamais par sa structure).
describe('équilibre des balises — les DEUX artefacts hors routes', () => {
  const sourceIndex = readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
  const ARTEFACTS = {
    [NOM_DU_GABARIT_APP]: buildAppTemplate({ html: sourceIndex, T, setMeta }),
    [NOM_DE_LA_PAGE_404]: buildNotFoundPage({ T, contact: CONTACT }),
  };

  it('les deux artefacts sont déclarés par les modules qui les écrivent', () => {
    // Les noms viennent des fabriques, jamais d'une liste tenue ici : renommer
    // l'un d'eux doit le faire sortir de CETTE boucle, et c'est précisément ce
    // que le garde d'après-build refuse (« introuvable »).
    expect(Object.keys(ARTEFACTS)).toEqual(['app.html', '404.html']);
  });

  for (const fichier of ['app.html', '404.html']) {
    it(`${fichier} : le document produit s'équilibre`, () => {
      const document = ARTEFACTS[fichier];
      // Le plancher prouve que la fabrique a rendu un document, pas une chaîne
      // vide — un contrôle qui lit le vide passerait pour équilibré.
      expect(document.length).toBeGreaterThan(200);
      expect(desequilibresDesBalises(document).map(decrireDesequilibre)).toEqual([]);
    });
  }
});

/**
 * LA TYPOGRAPHIE DE LA 404 (29/10/2026).
 *
 * Elle était la SEULE page du site à peindre `system-ui` : les douze coquilles
 * de route et l'application portent Inter au corps et Cormorant Garamond aux
 * titres depuis `src/index.css`, et les quarante-cinq pages écrites par le
 * backend reçoivent désormais les mêmes (`backend/kojo_pages_metier.py`).
 *
 * Ce qui est jugé, et pourquoi ce n'est pas décoratif :
 *   • les deux familles sont déclarées, et ce sont CELLES du site ;
 *   • chaque fichier cité existe dans `public/fonts` — un nom recopié de
 *     travers répondrait 404, `font-display: swap` ne dirait rien, et la page
 *     retomberait en silence sur la police de l'hôte ;
 *   • les deux fichiers sont PRÉCHARGÉS, une fois chacun, `crossorigin`
 *     compris (sans cet attribut le préchargement est ignoré en silence).
 */
describe('typographie — la 404 sert les polices du site', () => {
  const document = buildNotFoundPage({ T, contact: CONTACT });
  const tete = document.split('</head>', 1)[0];

  it('déclare les deux familles du site, et plus la police de l’hôte', () => {
    expect(document).toContain("font-family:'Inter'");
    expect(document).toContain("font-family:'Cormorant Garamond'");
    expect(tete).not.toMatch(/font-family:\s*system-ui/);
    // Le corps et le titre ne prennent pas la même : c'est la hiérarchie du site.
    expect(document).toContain("font-family:'Inter',-apple-system");
    expect(document).toMatch(/h1\{[^}]*font-family:'Cormorant Garamond'/);
  });

  it('ne cite que des fichiers que le build sert vraiment', () => {
    const fichiers = [...document.matchAll(/\/fonts\/([a-z0-9.-]+\.woff2)/g)];
    expect(fichiers.length).toBeGreaterThanOrEqual(2);
    for (const [, nom] of fichiers) {
      expect(
        existsSync(path.join(FRONTEND_DIR, 'public', 'fonts', nom)),
        `la 404 cite /fonts/${nom}, absent de public/fonts`
      ).toBe(true);
    }
  });

  it('précharge les deux fichiers, une fois chacun, en mode CORS', () => {
    const preloads = tete.match(/<link rel="preload"[^>]*>/g) || [];
    expect(preloads).toHaveLength(2);
    for (const famille of ['inter', 'cormorant-garamond']) {
      const lien = preloads.filter((l) => l.includes(`/fonts/${famille}-variable-latin.woff2`));
      expect(lien, famille).toHaveLength(1);
      expect(lien[0]).toContain('as="font"');
      expect(lien[0]).toContain('crossorigin');
    }
  });
});

/**
 * LA PALETTE DE LA 404 (29/10/2026) — le sable et l'encre du site.
 *
 * La 404 statique peignait `#f9fafb` / `#111827` / `#4b5563`, le gris FROID
 * d'un gabarit générique, et ses liens `#ea580c` — une teinte mesurée à 3,39:1
 * sur surface claire (sous le seuil de 4,5:1, corrigée sur /login le 26/10).
 * C'est la dernière page que voit un visiteur égaré, et c'était la seule du
 * site à ne pas employer sa matière.
 *
 * Ce qui est jugé ici, et pourquoi ce n'est pas une histoire de goût : les
 * littéraux de cette page sont comparés AUX JETONS de `src/index.css`, dans les
 * deux sens. Une retouche du socle qui laisse la 404 en arrière rougit, et une
 * valeur inventée dans la 404 rougit aussi — les deux documents peignent alors
 * deux sites différents, sur la même origine.
 */
describe('palette — la 404 peint le sable et l’encre du site', () => {
  const document = buildNotFoundPage({ T, contact: CONTACT });
  const tete = document.split('</head>', 1)[0];
  const socle = readFileSync(path.join(FRONTEND_DIR, 'src', 'index.css'), 'utf8');
  const jeton = (nom) => {
    const trouve = socle.match(new RegExp(`${nom}\\s*:\\s*(#[0-9a-fA-F]{3,8})`));
    expect(trouve, `le jeton ${nom} a disparu de src/index.css`).not.toBeNull();
    return trouve[1].toLowerCase();
  };

  it('prend SES fonds et SES encres dans les jetons du socle', () => {
    expect(tete).toContain(`background:${jeton('--kojo-sable')}`);
    expect(tete).toContain(`color:${jeton('--kojo-encre')}`);
    expect(tete).toContain(`color:${jeton('--kojo-encre-douce')}`);
    expect(tete).toContain(`color:${jeton('--kojo-orange-fonce')}`);
    expect(tete).toContain(`background:${jeton('--kojo-papier')}`);
    expect(tete).toContain(`border-color:${jeton('--kojo-filet')}`);
  });

  it('ne peint plus le gris froid de l’hôte, ni la teinte de lien qui échouait', () => {
    // Les couleurs d'AVANT, nommées pour qu'un retour en arrière soit refusé :
    // #f9fafb (gray-50), #111827 (gray-900), #4b5563 (gray-600) et #ea580c
    // (orange-600, 3,39:1 sur une surface claire).
    for (const ancienne of ['#f9fafb', '#111827', '#4b5563', '#ea580c']) {
      expect(tete.toLowerCase(), `la 404 repeint ${ancienne}`).not.toContain(ancienne);
    }
  });

  it('emploie les COMPOSANTS du site : la carte et les deux boutons', () => {
    const carte = socle.match(/\.carte-editoriale \{([^}]*)\}/);
    expect(carte, '.carte-editoriale a disparu de src/index.css').not.toBeNull();
    // Le VERRE de la carte : mêmes opacités et mêmes teintes que le socle, ou
    // c'est une seconde carte qui se dessine sur la même origine.
    expect(carte[1]).toContain('rgba(252, 249, 242, 0.94)');
    expect(carte[1]).toContain('rgba(240, 220, 195, 0.9)');
    expect(tete).toContain('background:rgba(252,249,242,.94)');
    expect(tete).toContain('border:1px solid rgba(240,220,195,.9)');

    // Les deux boutons portent le dessin de `.bouton` (52 px de haut, angle
    // 3 px) et les deux teintes de `.bouton-encre` / `.bouton-clair`.
    expect(tete).toContain('min-height:3.25rem');
    expect(tete).toContain('border-radius:3px');
    expect(tete).toContain(`.encre{background:${jeton('--kojo-encre')};color:#fff}`);
    expect(tete).toContain(`.clair{background:${jeton('--kojo-papier')}`);
    expect(document).toContain('<a class="bouton encre" href="/">');
    expect(document).toContain('<a class="bouton clair" href="/jobs">');
  });
});
