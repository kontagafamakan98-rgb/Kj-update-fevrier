import { describe, it, expect } from 'vitest';

import fr from '../../i18n/fr.json';
import en from '../../i18n/en.json';
import wo from '../../i18n/wo.json';
import bm from '../../i18n/bm.json';
import mos from '../../i18n/mos.json';

/**
 * LE BADGE DIT CE QUE LE DRAPEAU MESURE — pas ce qu'on aimerait qu'il dise.
 *
 * POURQUOI CE FICHIER
 *
 * `is_verified` est posé par l'ajout des comptes de paiement
 * (`backend/kojo_validation.py`), jamais par un contrôle d'identité : l'email a
 * son propre champ (`email_verified`). Le badge s'appelait pourtant « Vérifié »,
 * avec l'infobulle « Identité vérifiée (email) », et se peignait sur le tableau
 * de bord, le profil, la fiche publique d'un travailleur et les cartes de
 * mission. Un badge qui ment coûte plus cher que pas de badge (audit du
 * 20/10/2026, proposition 6) : il a été renommé « moyens de paiement
 * renseignés ».
 *
 * CE QUI EST REFUSÉ
 *
 *   1. les clés qui portaient l'affirmation (`verified`, `verifiedBadge`,
 *      `verifiedBadgeTitle`) : leur simple présence rouvre la porte au libellé
 *      mensonger, même sans appelant ;
 *   2. un libellé qui ne nomme PAS le paiement — c'est la règle qui rougirait si
 *      quelqu'un remettait « Vérifié », « Verified », « Saytu nañu ko »,
 *      « Lakɔlɔsila » ou « Gesg-m-meng » : aucun de ces cinq ne partage un mot
 *      avec le vocabulaire de paiement de SA langue ;
 *   3. une infobulle qui parle d'EMAIL (le drapeau ne dit rien de l'email) ou qui
 *      ne nomme pas le paiement (elle doit pouvoir se lire seule) ;
 *   4. un état « aucun moyen renseigné » identique à l'état positif — le profil
 *      afficherait la même phrase dans les deux cas.
 *
 * POURQUOI LA RÈGLE EST LEXICALE ET NON UNE LISTE DE PHRASES INTERDITES
 *
 * Une liste de phrases (les cinq anciennes valeurs) n'attraperait que le retour
 * à l'identique ; une paraphrase (« Profil certifié ») passerait. Exiger que le
 * libellé partage un mot avec `payment` / `paymentMethods` / `paymentAccounts`
 * de la MÊME langue ne dit rien de la qualité de la traduction, mais interdit
 * de cesser de parler de paiement — c'est exactement l'invariant.
 *
 * CE QUE CE FICHIER NE JUGE PAS : la qualité grammaticale des cinq valeurs, ni
 * qu'une vérification d'identité n'existe pas un jour (si elle est ajoutée, ce
 * sont les clés et les phrases que le produit devra reprendre, pas ce garde).
 */

const LANGUES = { fr, en, wo, bm, mos };
const NOMS = Object.keys(LANGUES);

// Plancher de lecture : un dictionnaire tronqué ne doit pas produire un vert.
// 932 clés lues le 21/10/2026 — le MÊME compte qu'avant le renommage : trois
// clés parties (`verified`, `verifiedBadge`, `verifiedBadgeTitle`), trois
// arrivées (`paymentMethodsOnFile`, `paymentMethodsNone`, `paymentMethodsBadgeTitle`).
const PLANCHER_CLES = 900;

const ANCIENNES_CLES = ['verified', 'verifiedBadge', 'verifiedBadgeTitle'];

const normaliser = (valeur) =>
  String(valeur ?? '')
    .normalize('NFC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Les mots d'une valeur, accents et casse mis de côté, de 4 lettres et plus. */
const mots = (valeur) => normaliser(valeur).split(/[^\p{L}]+/u).filter((mot) => mot.length >= 4);

/** Le vocabulaire de paiement DÉJÀ traduit, dans cette langue. */
const vocabulairePaiement = (dictionnaire) =>
  mots([dictionnaire.payment, dictionnaire.paymentMethods, dictionnaire.paymentAccounts].join(' '));

/** Deux vocabulaires se rencontrent-ils ? (`sara` et `saraku` se rencontrent.) */
const seRencontrent = (gauche, droite) =>
  gauche.some((mot) => droite.some((autre) => mot === autre || autre.startsWith(mot) || mot.startsWith(autre)));

const nommeLePaiement = (valeur, dictionnaire) =>
  seRencontrent(mots(valeur), vocabulairePaiement(dictionnaire));

describe('badge « moyens de paiement renseignés »', () => {
  it('le dictionnaire est LU avant d’être jugé', () => {
    for (const nom of NOMS) {
      expect(
        Object.keys(LANGUES[nom]).length,
        `${nom}.json est vide ou tronqué : le badge serait jugé sur un corpus partiel`
      ).toBeGreaterThanOrEqual(PLANCHER_CLES);
    }
  });

  it('aucun dictionnaire ne porte plus les clés qui affirmaient une vérification', () => {
    const revenantes = [];
    for (const nom of NOMS) {
      for (const cle of ANCIENNES_CLES) {
        if (Object.prototype.hasOwnProperty.call(LANGUES[nom], cle)) revenantes.push(`${nom}.json: ${cle}`);
      }
    }
    expect(
      revenantes,
      `ces clés disaient « identité vérifiée » alors que le drapeau ne dit que « comptes de paiement renseignés » :\n${revenantes.join('\n')}`
    ).toEqual([]);
  });

  it('le libellé nomme les moyens de paiement, dans les cinq langues', () => {
    const fautifs = [];
    for (const nom of NOMS) {
      const dictionnaire = LANGUES[nom];
      const libelle = dictionnaire.paymentMethodsOnFile;
      if (typeof libelle !== 'string' || !libelle.trim()) {
        fautifs.push(`${nom}: paymentMethodsOnFile vide`);
      } else if (!nommeLePaiement(libelle, dictionnaire)) {
        fautifs.push(`${nom}: « ${libelle} » ne nomme aucun mot du vocabulaire de paiement`);
      }
    }
    expect(
      fautifs,
      `le badge doit dire ce qui est mesuré (des moyens de paiement renseignés) :\n${fautifs.join('\n')}`
    ).toEqual([]);
  });

  it('l’état « aucun moyen renseigné » est sa propre phrase', () => {
    const fautifs = [];
    for (const nom of NOMS) {
      const dictionnaire = LANGUES[nom];
      const vide = dictionnaire.paymentMethodsNone;
      if (typeof vide !== 'string' || !vide.trim()) {
        fautifs.push(`${nom}: paymentMethodsNone vide`);
      } else if (normaliser(vide) === normaliser(dictionnaire.paymentMethodsOnFile)) {
        fautifs.push(`${nom}: l'absence est écrite comme la présence`);
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });

  it('l’infobulle ne parle pas d’email, et nomme elle aussi le paiement', () => {
    const fautifs = [];
    for (const nom of NOMS) {
      const dictionnaire = LANGUES[nom];
      const titre = dictionnaire.paymentMethodsBadgeTitle;
      if (typeof titre !== 'string' || !titre.trim()) {
        fautifs.push(`${nom}: paymentMethodsBadgeTitle vide`);
        continue;
      }
      // Le drapeau ne dit RIEN de l'email : l'ancienne infobulle l'attribuait à
      // une vérification d'email, qui est un autre champ (`email_verified`).
      if (normaliser(titre).includes('email')) fautifs.push(`${nom}: l'infobulle attribue le badge à l'email`);
      if (!nommeLePaiement(titre, dictionnaire)) fautifs.push(`${nom}: l'infobulle ne nomme pas le paiement`);
    }
    expect(fautifs, `infobulle du badge :\n${fautifs.join('\n')}`).toEqual([]);
  });
});
