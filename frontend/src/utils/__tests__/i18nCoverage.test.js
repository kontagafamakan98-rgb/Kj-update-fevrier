import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import fr from '../../i18n/fr.json';
import en from '../../i18n/en.json';
import wo from '../../i18n/wo.json';
import bm from '../../i18n/bm.json';
import mos from '../../i18n/mos.json';
// Depuis le découpage par scope (pack2PageI18n/), chaque page importe le
// module de SON scope : on importe statiquement tous les modules pour
// résoudre les clés pageT() comme le fait le code réel.
import { makeScopedTranslator as administrationT } from '../pack2PageI18n/administration';
import { makeScopedTranslator as commissionDashboardT } from '../pack2PageI18n/commissionDashboard';
import { makeScopedTranslator as dashboardT } from '../pack2PageI18n/dashboard';
import { makeScopedTranslator as emailVerificationT } from '../pack2PageI18n/emailVerification';
import { makeScopedTranslator as jobDetailsT } from '../pack2PageI18n/jobDetails';
import { makeScopedTranslator as jobReviewsT } from '../pack2PageI18n/jobReviews';
import { makeScopedTranslator as jobsT } from '../pack2PageI18n/jobs';
import { makeScopedTranslator as messagesT } from '../pack2PageI18n/messages';
import { makeScopedTranslator as mobileTestT } from '../pack2PageI18n/mobileTest';
import { makeScopedTranslator as paymentVerificationT } from '../pack2PageI18n/paymentVerification';
import { makeScopedTranslator as photoTestT } from '../pack2PageI18n/photoTest';
import { makeScopedTranslator as portefeuillesT } from '../pack2PageI18n/portefeuilles';
import { makeScopedTranslator as profileT } from '../pack2PageI18n/profile';
import { makeScopedTranslator as registerT } from '../pack2PageI18n/register';

// Map scope → makeScopedTranslator du module correspondant.
const SCOPE_MODULES = {
  administration: administrationT,
  commissionDashboard: commissionDashboardT,
  dashboard: dashboardT,
  emailVerification: emailVerificationT,
  jobDetails: jobDetailsT,
  jobReviews: jobReviewsT,
  jobs: jobsT,
  messages: messagesT,
  mobileTest: mobileTestT,
  paymentVerification: paymentVerificationT,
  photoTest: photoTestT,
  portefeuilles: portefeuillesT,
  profile: profileT,
  register: registerT,
};

// Ce test complète i18nParity.test.js : ce dernier vérifie que les 5 langues
// contiennent les MÊMES clés, mais pas que chaque appel t()/pageT() du code
// résout une clé existante. Or t()/pageT() renvoient la clé BRUTE quand elle
// est absente (chaîne truthy) → le fallback `|| '...'` ne s'applique jamais et
// l'utilisateur voit littéralement « deleteAccountTitle », « loadOlderExists »,
// etc. C'est exactement le bug corrigé en 2026 ; ce test empêche la régression.

const LANGUAGES = { fr, en, wo, bm, mos };
const LANGS = Object.keys(LANGUAGES);

// Reproduit le comportement de LanguageContext.t() : clé absente → clé brute.
const globalT = (lang) => (key) => (LANGUAGES[lang][key] !== undefined ? LANGUAGES[lang][key] : key);

// Racine de src/ (le test vit dans src/utils/__tests__/).
// __dirname est fourni par vitest ; import.meta.url n'est pas une URL file:.
const SRC_ROOT = path.resolve(__dirname, '../..');

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

function sourceFiles() {
  return [
    ...walk(path.join(SRC_ROOT, 'pages')),
    ...walk(path.join(SRC_ROOT, 'components')),
    ...walk(path.join(SRC_ROOT, 'contexts')),
    path.join(SRC_ROOT, 'App.js'),
  ].filter((file) => fs.existsSync(file));
}

// Capture (pageT|t)('key') / (pageT|t)("key"). Les clés dynamiques (variables,
// template literals avec ${...}) sont ignorées : non vérifiables statiquement.
function collectCalls(source) {
  return [...source.matchAll(/\b(pageT|t)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\)/g)].map((m) => ({
    kind: m[1],
    key: m[2],
  }));
}

// Scope du fichier : le module de scope est identifié par son import
// `from '.../pack2PageI18n/<scope>'` (le découpage par scope a retiré le
// 3e argument littéral de l'appel). Un fichier sans cet import n'a pas de
// pageT scopé (t() global uniquement). Le module 'core' (helpers partagés
// getLocaleForLanguage / normalizeCountryCode) n'est pas un scope.
function findScope(source) {
  const m = source.match(/from '[^']*\/pack2PageI18n\/([a-zA-Z_][a-zA-Z0-9_]*)'/);
  const scope = m ? m[1] : null;
  return scope === 'core' ? null : scope;
}

// ── LES DICTIONNAIRES DE PAGE NE RETOMBENT PLUS SUR LE FRANÇAIS ────────────
// Mesuré le 02/11/2026 : 166 des 463 clés de page étaient traduites, donc
// `/jobs` s'affichait à 67–78 % en français pour un lecteur wolof, bambara ou
// mooré. La cause est structurelle : `dict.wo = withBase(dict.fr, {...})`
// ÉTALE le français, donc une clé absente des surcharges n'est pas « en
// anglais », elle est EN FRANÇAIS.
//
// Ce cas juge la PRÉSENCE, pas la valeur : une clé déclarée dans `dict.<langue>`
// est traduite ; une clé absente est publiée en français. Il porte un plancher
// de lecture (fichiers et clés) pour qu'un balayage cassé ne rende pas un vert
// muet, et une liste d'EXCEPTIONS DÉCLARÉES avec leur motif.
const PACK_DIR = path.join(SRC_ROOT, 'utils', 'pack2PageI18n');
const LANGUES_DE_PAGE = ['wo', 'bm', 'mos'];
const SANS_TRADUCTION = [
  {
    fichier: 'register.js',
    cle: 'phonePlaceholder',
    motif:
      'un exemple de FORMAT de numéro (« 77 123 45 67 »), pas une phrase : il ne se traduit pas, ' +
      'et une valeur inventée par langue donnerait un numéro qui n’existe dans aucun pays',
  },
  {
    fichier: 'dashboard.js',
    cle: 'recentBudget',
    motif:
      '« {min} - {max} XOF » : un FORMAT de montant, identique dans les cinq langues par ' +
      'construction. Une surcharge recopiée à l’identique est du poids mort, et ' +
      '`check-pack2-i18n-hygiene.js` la refuse',
  },
  {
    fichier: 'photoTest.js',
    cle: 'userAgent',
    motif:
      '« User Agent » : le NOM d’un en-tête HTTP, pas un mot d’interface — il ne se traduit pas ' +
      '(page de diagnostic, hors parcours visiteur)',
  },
  {
    fichier: 'portefeuilles.js',
    cle: 'wallet',
    motif:
      '« Wallet » : le terme du métier mobile money, celui qu’emploient les opérateurs ; le ' +
      'traduire inventerait un mot que personne n’emploie (page d’administration)',
  },
];

describe('les dictionnaires de PAGE sont traduits en entier', () => {
  const fichiers = fs
    .readdirSync(PACK_DIR)
    .filter((nom) => nom.endsWith('.js') && nom !== 'core.js')
    .sort();

  it('aucune clé de page ne retombe sur le français en wo/bm/mos', () => {
    // Les clés d'un bloc de dictionnaire : `cle:` en début de ligne, le seul
    // format que ces fichiers emploient (deux espaces dans `fr`, aucun dans les
    // surcharges — les deux formes sont lues).
    const cles = (bloc) => [...bloc.matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    const manquantes = [];
    let clesLues = 0;

    for (const fichier of fichiers) {
      const source = fs.readFileSync(path.join(PACK_DIR, fichier), 'utf8');
      // Après l'accolade : sans cela le `fr:` de la déclaration serait lu
      // comme une clé (« fr » manquerait alors à toutes les langues).
      const clesFr = cles(
        source.slice(source.indexOf('fr: {') + 'fr: {'.length, source.indexOf('en: {'))
      );
      clesLues += clesFr.length;
      for (const langue of LANGUES_DE_PAGE) {
        const debut = source.indexOf(`dict.${langue}`);
        const bornes = LANGUES_DE_PAGE.map((l) => source.indexOf(`dict.${l}`)).filter(
          (position) => position > debut
        );
        const fin = bornes.length ? Math.min(...bornes) : source.indexOf('export const makeScopedTranslator');
        const presentes = new Set(cles(source.slice(debut, fin)));
        for (const cle of clesFr) {
          if (presentes.has(cle)) continue;
          const excuse = SANS_TRADUCTION.some((e) => e.fichier === fichier && e.cle === cle);
          if (!excuse) manquantes.push(`${fichier} : « ${cle} » manque à dict.${langue}`);
        }
      }
    }

    // Planchers : 14 scopes, 470 clés au moins. Un balayage qui ne lit rien
    // rendrait toutes ses absences muettes et passerait pour un vert.
    expect(fichiers.length, 'les dictionnaires de page ne sont plus lus').toBe(14);
    expect(clesLues, 'les clés de page ne sont plus lues').toBeGreaterThan(460);
    expect(
      manquantes,
      `clés de page affichées en FRANÇAIS à un lecteur wo/bm/mos (dict.<langue> ne les porte pas) :\n${manquantes.join('\n')}`
    ).toEqual([]);
  });
});

describe('i18n coverage des appels t() / pageT()', () => {
  it("chaque clé t('...') existe dans le dictionnaire global des 5 langues", () => {
    const missing = new Set();

    for (const file of sourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const { kind, key } of collectCalls(source)) {
        if (kind !== 't') continue;
        const absentLangs = LANGS.filter((lang) => LANGUAGES[lang][key] === undefined);
        if (absentLangs.length > 0) {
          // La parité (i18nParity.test.js) garantit que les 5 langues ont les
          // mêmes clés globales : une absence = absente partout. On dédoublonne
          // le rapport par fichier/clé.
          missing.add(`${path.relative(SRC_ROOT, file)}: t('${key}')`);
        }
      }
    }

    expect(
      [...missing],
      `clés t() manquantes dans le dictionnaire global (affichées brutes à l'utilisateur) :\n${[...missing].join('\n')}`
    ).toEqual([]);
  });

  it("chaque clé pageT('...') résout via son scope ou le dictionnaire global, dans les 5 langues", () => {
    const missing = new Set();

    for (const file of sourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      const scope = findScope(source);
      if (!scope) continue;
      const makeT = SCOPE_MODULES[scope];
      if (!makeT) {
        // Module de scope inconnu : le test doit être mis à jour.
        throw new Error(`Scope inconnu dans i18nCoverage.test.js : '${scope}' (${path.relative(SRC_ROOT, file)})`);
      }

      for (const { kind, key } of collectCalls(source)) {
        if (kind !== 'pageT') continue;
        for (const lang of LANGS) {
          // Résolution réelle (makeScopedTranslator du module de scope) :
          // clé brute = manquante.
          const resolved = makeT(lang, globalT(lang))(key);
          if (resolved === key) {
            missing.add(`${path.relative(SRC_ROOT, file)}: pageT('${key}') [scope ${scope}, lang ${lang}]`);
          }
        }
      }
    }

    expect(
      [...missing],
      `clés pageT() manquantes (affichées brutes à l'utilisateur) :\n${[...missing].join('\n')}`
    ).toEqual([]);
  });
});
