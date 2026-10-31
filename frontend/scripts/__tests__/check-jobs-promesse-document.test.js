/**
 * LA PROMESSE D'ALERTE DE /jobs DOIT ÊTRE DANS LE DOCUMENT SERVI — dans ses
 * DEUX langues, et une seule fois.
 *
 * Ce que ce fichier mesure, et pourquoi il existe. Le 30/10/2026, le HTML
 * pré-rendu de /jobs (109 568 o) portait son titre, sa bande de date, son
 * introduction, sa bascule liste/carte — et AUCUNE occurrence de la promesse
 * d'alerte emploi. Elle naissait après le chargement des données (le titre de
 * l'état vide, « Soyez prévenu avant les autres ») ou pour un travailleur
 * connecté (la carte `AlerteEmploi`) : autrement dit, jamais pour un crawler,
 * et jamais dans la première image. Honnête, et invisible — alors que la veille
 * est le seul chemin de RETOUR du produit.
 *
 * Trois choses sont vérifiées ici :
 *
 *   1. LA COQUILLE LA PUBLIE, dans les deux langues INDEXÉES (`fr`, `en`) :
 *      le titre et le texte viennent du dictionnaire, résolus par le scope de
 *      la page — la même source que la page React. Un document anglais qui
 *      publierait la phrase française serait une promesse dans la mauvaise
 *      langue, donc une page à moitié traduite servie au moteur.
 *   2. LE MÉCANISME EST DIT : la promesse nomme l'email. « Soyez prévenu »
 *      sans dire par où est exactement l'invention que les pages ville et
 *      métier évitent depuis le 27/10/2026.
 *   3. UN SEUL PROPRIÉTAIRE : les clés et les classes de ce bloc sont lues
 *      dans le plan de la route (`src/config/page-sections.js`) par la
 *      coquille ET par la page. Le cas lit `src/pages/Jobs.js` pour refuser un
 *      littéral recopié (`t('jobAlertIntro')` en dur), qui divergerait de la
 *      coquille en silence — c'est la classe de défaut que le plan supprime.
 *
 * Le fichier ne remplace pas `check-prerender-shells.js` (qui lit l'artefact
 * écrit dans `build/`) : il juge la SOURCE du document, donc il tourne sans
 * build, sur les deux langues, à chaque revue.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRouteShells } from '../../vite-plugins/prerender/shells-routes.js';
import { PAGE_SECTIONS } from '../../src/config/page-sections.js';
import { CONTACT } from '../../src/config/contact.js';
import { makeScopedTranslator as makeRegisterTranslator } from '../../src/utils/pack2PageI18n/register.js';
import { makeScopedTranslator as makeJobsTranslator } from '../../src/utils/pack2PageI18n/jobs.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Le MÊME échappement que le propriétaire des coquilles
// (vite-plugins/prerender-route-meta.js) : sans lui, la comparaison porterait
// sur un texte que le build n'écrit jamais tel quel (une apostrophe typographique
// ou un « & » suffirait à faire diverger la mesure du document).
const esc = (valeur) =>
  String(valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const dictionnaire = (langue) =>
  JSON.parse(readFileSync(path.join(FRONTEND_DIR, 'src', 'i18n', `${langue}.json`), 'utf8'));

/** La coquille de /jobs, composée par le module que le build appelle. */
const coquilleJobs = (langue) => {
  const textes = dictionnaire(langue);
  const T = (cle) => textes[cle];
  const coquilles = buildRouteShells({
    esc,
    T,
    registerT: makeRegisterTranslator(langue, T),
    jobsT: makeJobsTranslator(langue, T),
    contact: CONTACT,
    pageSections: PAGE_SECTIONS,
  });
  return coquilles.jobs;
};

const PLAN = PAGE_SECTIONS['/jobs'];
const SOURCE_DE_LA_PAGE = readFileSync(
  path.join(FRONTEND_DIR, 'src', 'pages', 'Jobs.js'),
  'utf8'
);

describe('la promesse d’alerte de /jobs est dans le document servi', () => {
  it('la coquille publie le titre ET le texte de la promesse, dans les deux langues indexées', () => {
    ['fr', 'en'].forEach((langue) => {
      const document = coquilleJobs(langue);
      const textes = dictionnaire(langue);
      const titre = textes[PLAN.alerteTitreKey];
      const promesse = textes[PLAN.alerteTexteKey];

      expect(titre, `${langue} : la clé ${PLAN.alerteTitreKey} est absente`).toBeTruthy();
      expect(promesse, `${langue} : la clé ${PLAN.alerteTexteKey} est absente`).toBeTruthy();
      expect(document).toContain(esc(titre));
      expect(document).toContain(esc(promesse));
    });
  });

  it('la promesse dit par où elle prévient : l’email, dans les deux langues', () => {
    // « Soyez prévenu » sans le mécanisme est une promesse que le visiteur ne
    // peut pas vérifier. C'est la règle écrite pour les pages ville et métier,
    // et elle vaut ici : le seul canal de la veille est l'email du compte.
    ['fr', 'en'].forEach((langue) => {
      const promesse = dictionnaire(langue)[PLAN.alerteTexteKey];
      expect(promesse.toLowerCase(), `${langue} : aucun canal nommé`).toContain('email');
    });
  });

  it('la promesse n’est publiée qu’UNE fois dans le document', () => {
    // Deux copies dans le même document, c'est le défaut mesuré sur le
    // maillage le 29/10/2026 : le titre apparaîtrait deux fois pour un lecteur
    // d'écran, et le second exemplaire ne serait vérifié par personne.
    const document = coquilleJobs('fr');
    const occurrences = document.split(esc(dictionnaire('fr')[PLAN.alerteTexteKey])).length - 1;
    expect(occurrences).toBe(1);
  });

  it('la page lit le PLAN, et ne recopie ni les clés ni les classes', () => {
    // Les quatre clés et les six classes du bloc : c'est le seul propriétaire
    // possible. Un littéral dans la page peindrait un bloc que la coquille ne
    // peut pas suivre (et le build refuserait la sienne, ou publierait l'ancienne).
    ['alerteTitreKey', 'alerteTexteKey', 'alerteInscriptionKey', 'alerteConnexionKey'].forEach(
      (champ) => {
        expect(PLAN[champ], `le plan de /jobs ne déclare plus ${champ}`).toBeTruthy();
        expect(
          SOURCE_DE_LA_PAGE,
          `src/pages/Jobs.js ne lit plus pagePlan.${champ} : la promesse aurait deux propriétaires`
        ).toContain(`pagePlan.${champ}`);
      }
    );
    [
      'alerteCarteClass',
      'alerteTitreClass',
      'alerteTexteClass',
      'alerteActionsClass',
      'alerteBoutonClass',
      'alerteBoutonClairClass',
    ].forEach((champ) => {
      expect(PLAN[champ], `le plan de /jobs ne déclare plus ${champ}`).toBeTruthy();
      expect(SOURCE_DE_LA_PAGE).toContain(`pagePlan.${champ}`);
    });
    // Et aucune clé en dur : la page ne peut pas publier un texte que la
    // coquille résout autrement.
    ['jobAlertTitle', 'jobAlertIntro'].forEach((cle) => {
      expect(SOURCE_DE_LA_PAGE).not.toContain(`t('${cle}')`);
    });
  });

  it('les quatre clés sont traduites dans les CINQ dictionnaires', () => {
    // La coquille refuse de se construire sur une clé manquante (T() casse le
    // build) : ce cas dit la même chose plus tôt, et pour les cinq langues que
    // le sélecteur propose — pas seulement les deux indexées.
    const cles = [
      PLAN.alerteTitreKey,
      PLAN.alerteTexteKey,
      PLAN.alerteInscriptionKey,
      PLAN.alerteConnexionKey,
    ];
    ['fr', 'en', 'wo', 'bm', 'mos'].forEach((langue) => {
      const textes = dictionnaire(langue);
      cles.forEach((cle) => {
        expect(textes[cle], `${langue} : ${cle} manquante`).toBeTruthy();
        expect(String(textes[cle]).trim().length, `${langue} : ${cle} vide`).toBeGreaterThan(0);
      });
    });
  });
});
