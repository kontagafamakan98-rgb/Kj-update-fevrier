import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Les traducteurs RÉELS de chaque scope : la valeur jugée est celle que la page
// affiche, héritage `withBase` compris — pas une valeur relue par une regex qui
// se tromperait sur les guillemets doubles ou sur une chaîne à la ligne.
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

/**
 * LA LANGUE DES DICTIONNAIRES DE PAGE — wo/bm/mos (02/11/2026).
 *
 * `i18nLangue.test.js` juge la LANGUE du dictionnaire GLOBAL (`src/i18n/*.json`,
 * 932 clés) et refuse une valeur laissée en français. Les 14 dictionnaires de
 * page (473 clés × 3 langues) n'avaient AUCUN juge de langue : `i18nCoverage`
 * tient la PRÉSENCE des clés, `i18nScopeHygiene` refuse un override identique
 * au français — mais une phrase wolof qui garde « bouton » au milieu, ou
 * « fichier », passait les trois. C'est ainsi que onze valeurs en français ont
 * survécu jusqu'au 02/11/2026 (adresse, tableau de bord, propriétaire,
 * automatique, inscription, bouton, fichier), et elles ont été trouvées à la
 * main, pas par la CI.
 *
 * Ce que ce fichier REFUSE : un mot français CERTAIN dans une valeur de page
 * affichée en wo, bm ou mos. La liste est courte et volontairement stricte —
 * seul ce que ces trois langues n'emploient jamais :
 *
 *   - les EMPRUNTS sont exclus (`profil`, `email`, `client`, `compte`,
 *     `paiement`, `commission`, `code`, `wallet`…) : mesuré le 20/10/2026, 21
 *     valeurs wolof parfaitement traduites contiennent « profil » ;
 *   - les PIÈGES sont exclus : « du » est la négation du wolof, « bi »/« ci »
 *     des déterminants — les compter comme du français refuserait des phrases
 *     justes ;
 *   - une valeur SANS LETTRE (emoji, gabarit `{…}`, `{min} - {max} XOF`) n'est
 *     pas jugée : il n'y a rien à traduire.
 *
 * Ce qu'il ne refuse PAS, et qui est déjà tenu ailleurs : une valeur IDENTIQUE
 * au français (`i18nScopeHygiene`), une clé ABSENTE de `dict.<langue>` donc
 * publiée en français (`i18nCoverage`), et la QUALITÉ grammaticale — c'est le
 * travail d'un locuteur natif, préparé par `outils/relecture-i18n/`.
 *
 * La dette est DÉCLARÉE, comme `EN_ATTENTE` dans `i18nLangue.test.js` : les
 * quatre cas restants vivent tous dans les deux pages de DIAGNOSTIC
 * (`photoTest`, `mobileTest`), hors navigation, et le terme à employer n'est
 * pas connu — l'inventer serait pire que le constater. Le plafond ne peut que
 * baisser, et une entrée devenue inutile fait ROUGIR : la liste ne peut pas
 * devenir le fourre-tout où l'on glisserait une phrase non traduite.
 */

const SCOPES = {
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

const PACK_DIR = path.resolve(__dirname, '../pack2PageI18n');
const LANGUES = ['wo', 'bm', 'mos'];

// Mots dont le français est CERTAIN dans ces trois langues. Comparaison sans
// accent (« proprietaire ») : une valeur peut porter l'accent ou non.
const MARQUEURS_FRANCAIS = [
  'adresse',
  'automatique',
  'bord',
  'bouton',
  'fichier',
  'inscription',
  'proprietaire',
  'tableau',
];

// La dette mesurée le 02/11/2026 : 10 valeurs (4 clés × langues), toutes dans
// les pages de diagnostic. Motif ≥ 40 caractères, sinon la déclaration ne dit
// rien et le test la refuse.
const DETTE = [
  {
    fichier: 'mobileTest.js',
    cle: 'screen1',
    motif:
      'Page de diagnostic (liste des écrans de test), hors navigation : « bouton kamera » ' +
      'reste en français tant qu’aucun locuteur n’a donné le terme, et la relecture assistée ' +
      'le compte parmi ses doutes',
  },
  {
    fichier: 'photoTest.js',
    cle: 'directFileTest',
    motif:
      'Page de diagnostic de téléversement : « fichier » est français mais le mot wolof, ' +
      'bambara ou mooré n’est attesté nulle part dans le dépôt — l’inventer créerait un ' +
      'second vocabulaire pour un seul objet',
  },
  {
    fichier: 'photoTest.js',
    cle: 'noFileSelected',
    motif:
      'Même page de diagnostic, même mot : l’entrée existe pour que le plafond de dette ' +
      'compte la clé réelle et qu’un correctif futur la retire nommément',
  },
  {
    fichier: 'photoTest.js',
    cle: 'fileInputTesting',
    motif:
      'Même page de diagnostic, même mot, dans une phrase de journal de test : hors parcours ' +
      'visiteur, et la traduction attend un terme validé par un locuteur',
  },
];

// Plafond MESURÉ : 4 entrées, 10 valeurs. Il ne monte jamais.
const PLAFOND_DETTE = 4;

// Planchers de lecture : un balayage cassé ne doit pas rendre un vert muet.
const PLANCHER_SCOPES = 14;
const PLANCHER_CLES = 460;
const PLANCHER_VALEURS = 1400;

const normaliser = (texte) =>
  String(texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Les clés du bloc `fr` d'un module de scope, dans l'ordre du fichier. */
const clesDuFrancais = (source) => {
  const debut = source.indexOf('fr: {');
  if (debut === -1) return [];
  const fin = source.indexOf('en: {');
  // On saute `fr: {` lui-même : sans cela « fr » serait compté comme une clé,
  // et le corpus gagnerait une entrée fantôme par fichier (mesuré : 487 au
  // lieu de 473).
  const bloc = source.slice(debut + 'fr: {'.length, fin === -1 ? source.length : fin);
  return [...bloc.matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
};

const fichiersDuDisque = fs
  .readdirSync(PACK_DIR)
  .filter((nom) => nom.endsWith('.js') && nom !== 'core.js')
  .sort();

/** Toutes les valeurs de page, résolues par le traducteur de leur scope. */
const corpus = () => {
  const valeurs = [];
  for (const fichier of fichiersDuDisque) {
    const scope = path.basename(fichier, '.js');
    const source = fs.readFileSync(path.join(PACK_DIR, fichier), 'utf8');
    const makeT = SCOPES[scope];
    if (!makeT) throw new Error(`scope inconnu dans i18nLanguePages.test.js : ${scope}`);
    for (const cle of clesDuFrancais(source)) {
      for (const langue of LANGUES) {
        const t = makeT(langue, (brute) => brute);
        valeurs.push({ fichier, scope, cle, langue, valeur: t(cle) });
      }
    }
  }
  return valeurs;
};

const VALEURS = corpus();

/** Vrai si la valeur ne porte aucune lettre hors placeholder : rien à traduire. */
const sansLettre = (valeur) => !/[\p{L}]/u.test(String(valeur ?? '').replace(/\{[^}]*\}/g, ' '));

const estEnDette = (valeur) =>
  DETTE.some((entree) => entree.fichier === valeur.fichier && entree.cle === valeur.cle);

const motsFrancais = (valeur) => {
  const texte = normaliser(valeur);
  return MARQUEURS_FRANCAIS.filter((mot) => new RegExp(`\\b${mot}\\b`).test(texte));
};

describe('la langue des dictionnaires de PAGE (wo, bm, mos)', () => {
  it('le corpus est LU avant d’être jugé', () => {
    expect(fichiersDuDisque.length, 'les dictionnaires de page ne sont plus lus').toBe(
      PLANCHER_SCOPES
    );
    expect(
      Object.keys(SCOPES).sort(),
      'un module de scope existe sur le disque sans entrée dans ce test'
    ).toEqual(fichiersDuDisque.map((nom) => nom.replace(/\.js$/, '')));

    const cles = new Set(VALEURS.map((v) => `${v.scope}.${v.cle}`));
    expect(cles.size, 'les clés de page ne sont plus lues').toBeGreaterThan(PLANCHER_CLES);
    expect(VALEURS.length, 'les valeurs de page ne sont plus résolues').toBeGreaterThan(
      PLANCHER_VALEURS
    );
    // Un traducteur cassé rendrait la clé brute : ce n'est pas une valeur.
    const brutes = VALEURS.filter((v) => v.valeur === v.cle);
    expect(brutes.map((v) => `${v.scope}.${v.cle}`), 'clé brute publiée à l’écran').toEqual([]);
  });

  it('aucun mot français ne subsiste dans une valeur de page', () => {
    const fautes = [];
    for (const { scope, cle, langue, valeur, fichier } of VALEURS) {
      if (sansLettre(valeur)) continue;
      if (estEnDette({ fichier, cle })) continue;
      const mots = motsFrancais(valeur);
      if (mots.length) {
        fautes.push(`${scope}.${cle} [${langue}] « ${mots.join(', ')} » : « ${valeur} »`);
      }
    }
    expect(
      fautes,
      `mot(s) français resté(s) dans une valeur de PAGE — un lecteur wo/bm/mos lit la langue ` +
        `de la référence :\n${fautes.join('\n')}\n` +
        `Traduire la phrase, ou déclarer la clé dans DETTE avec son motif et son plafond.`
    ).toEqual([]);
  });

  it('la dette déclarée est encore VRAIE, motivée, et sous son plafond', () => {
    expect(DETTE.length, 'le plafond de dette ne monte jamais').toBeLessThanOrEqual(
      PLAFOND_DETTE
    );

    for (const entree of DETTE) {
      expect(
        String(entree.motif).trim().length,
        `${entree.fichier}.${entree.cle} : motif absent ou trop court (40 caractères minimum)`
      ).toBeGreaterThanOrEqual(40);
      const valeurs = VALEURS.filter(
        (v) => v.fichier === entree.fichier && v.cle === entree.cle
      );
      expect(
        valeurs.length,
        `${entree.fichier}.${entree.cle} : la clé n'existe plus, retirer la dette`
      ).toBeGreaterThan(0);
      const encoreFautive = valeurs.some(
        (v) => !sansLettre(v.valeur) && motsFrancais(v.valeur).length > 0
      );
      expect(
        encoreFautive,
        `${entree.fichier}.${entree.cle} : plus aucun mot français, retirer la dette (elle ne peut que baisser)`
      ).toBe(true);
    }
  });
});
