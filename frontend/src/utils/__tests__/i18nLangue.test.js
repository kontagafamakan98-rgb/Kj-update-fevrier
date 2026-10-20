import { describe, it, expect } from 'vitest';

import fr from '../../i18n/fr.json';
import en from '../../i18n/en.json';
import wo from '../../i18n/wo.json';
import bm from '../../i18n/bm.json';
import mos from '../../i18n/mos.json';

/**
 * Aucune valeur de `wo`/`bm`/`mos` n'est laissée en FRANÇAIS — ni en ANGLAIS.
 *
 * POURQUOI CE FICHIER
 *
 * `i18nParity` tient les CLÉS (les cinq dictionnaires portent exactement les
 * mêmes) et `i18nCoverage` les APPELS (`t('…')` résout partout). Aucun des deux
 * ne regarde la LANGUE de ce qui est écrit : une valeur copiée du français passe
 * les deux au vert, et l'utilisateur wolof lit du français. Ce garde ferme ce
 * trou sur TOUT le dictionnaire — il a commencé sur les treize clés `jobAlert*`
 * (le seul corpus où le défaut avait mordu), et cette portée étroite laissait
 * les 919 autres clés sans juge.
 *
 * CE QUI EST REFUSÉ, ET POURQUOI CHACUN
 *
 *   1. une valeur VIDE ou égale à sa clé (le texte brut partirait à l'écran) ;
 *   2. une valeur IDENTIQUE au français (casse, espaces et normalisation
 *      Unicode mises de côté) : c'est la copie, le cas mesuré ;
 *   3. une valeur IDENTIQUE à l'anglais alors que l'anglais DIFFÈRE du français :
 *      laisser l'anglais est le même défaut avec une autre source, et il est
 *      plus difficile à voir à l'œil ;
 *   4. un MOT français resté dans une phrase d'alerte emploi (une copie
 *      retouchée que l'égalité stricte ne verrait pas). Cette règle reste
 *      bornée à son corpus : « profil », « email », « mot de passe », « client »,
 *      « compte », « paiement » sont des emprunts que ces trois langues
 *      emploient dans des valeurs PARFAITEMENT traduites (mesuré : 21 valeurs
 *      traduites de `wo` contiennent « profil »). Une liste de marqueurs
 *      appliquée au dictionnaire entier refuserait donc des traductions saines.
 *
 * CE QUI N'EST PAS UNE TRADUCTION MANQUANTE
 *
 *   • une valeur SANS LETTRE (emoji, chiffre, symbole, gabarit `{…}`) : il n'y a
 *     rien à traduire, et l'exiger produirait du bruit sur trente pictogrammes ;
 *   • un NOM PROPRE, une MARQUE, un SIGLE, un LITTÉRAL TECHNIQUE ou un EMPRUNT
 *     international : déclaré dans `EXCEPTIONS`, par VALEUR (ces libellés
 *     s'écrivent pareil dans les trois langues), avec sa famille dont le motif
 *     fait ≥ 40 caractères. Une famille inconnue, et une exception que plus
 *     aucune valeur n'emploie, sont REFUSÉES : c'est ce qui empêche la liste de
 *     devenir le fourre-tout où glisserait une phrase non traduite.
 *
 * CE QUI EST DÉCLARÉ AUJOURD'HUI COMME DETTE : PLUS RIEN
 *
 * `EN_ATTENTE` nommait les clés qui portaient ENCORE le texte français (ou
 * l'anglais, quand il diffère), langue par langue — 31 en `wo`, 27 en `bm`, 26 en
 * `mos` le 20/10/2026. Elles ont été traduites le 20/10/2026 et les trois listes
 * sont VIDES (`PLAFOND_EN_ATTENTE` vaut 0 partout). La mécanique reste en place
 * pour la suite : le plafond ne MONTE jamais (une valeur française ajoutée hors
 * liste rougit par la règle 2, une clé ajoutée à la liste rougit par le
 * plafond), et une entrée dont la valeur n'est plus le français rougit (« dette
 * périmée ») — donc la liste ne peut que se vider, en même temps que le plafond
 * se baisse dans le même changement.
 *
 * Traduire ne vaut pas relecture : ces valeurs sont des PROPOSITIONS, et la
 * relecture par un locuteur natif n'est **pas faite au 20/10/2026**. Les doutes
 * (chaque terme inventé ou emprunté est nommé) vivent dans
 * `src/i18n/alertes-emploi-revue-native.md`.
 *
 * Ce que ce fichier ne peut PAS juger : la QUALITÉ de la traduction. Un texte
 * grammaticalement faux mais ni français ni anglais passe ici — le garde empêche
 * la RÉGRESSION, il ne remplace pas la relecture.
 */

const LANGUES = { wo, bm, mos };

// Plancher de lecture : si le corpus change d'ordre de grandeur (renommage,
// fichier tronqué), le test ne doit pas conclure « rien à juger ». 932 clés
// lues le 20/10/2026.
const PLANCHER_CLES = 900;

// Le corpus d'alertes emploi garde sa règle de MOTS français : 13 clés le
// 20/10/2026.
const PREFIXE_ALERTES = 'jobAlert';
const PLANCHER_ALERTES = 10;

// Familles admises, avec LEUR motif (≥ 40 caractères, sans quoi la déclaration
// ne dit rien). Une famille inconnue est refusée : c'est ce qui empêche la
// liste de devenir un fourre-tout où glisserait une phrase non traduite.
const FAMILLES = {
  'nom propre':
    "Nom propre (pays, langue, lieu) : il s'écrit ainsi dans les trois langues, et le traduire inventerait un toponyme que personne n'emploie.",
  marque:
    'Marque ou produit : un nom de marque ne se traduit pas, sous peine de rendre le libellé faux ou ambigu pour le paiement.',
  sigle:
    'Sigle : sa forme développée varie, sa forme abrégée est la même partout et la traduire la rendrait méconnaissable.',
  'littéral technique':
    'Littéral technique (protocole, identifiant, intitulé de champ) : la forme est internationale et un utilisateur la reconnaît telle quelle.',
  emprunt:
    'Mot emprunté au français, employé tel quel dans la langue (parfois déjà dans ses phrases traduites) : le traduire créerait un terme que le produit n’emploie nulle part ailleurs.',
};

// Valeurs admises telles quelles, avec leur famille. Déclarées par VALEUR : ces
// libellés s'écrivent pareil dans les trois langues, donc une entrée par
// (langue, clé) ne dirait rien de plus. Une PHRASE n'y entre jamais.
const EXCEPTIONS = [
  ['Mali', 'nom propre'],
  ['Burkina Faso', 'nom propre'],
  ['Côte d’Ivoire', 'nom propre'],
  ['Wolof', 'nom propre'],
  ['Bambara', 'nom propre'],
  ['Mooré', 'nom propre'],
  ['Kojo', 'marque'],
  ['K', 'marque'],
  ['Wave', 'marque'],
  ['Orange Money', 'marque'],
  ['Mobile Money Orange', 'marque'],
  ['Orange Mobile Money', 'marque'],
  ['Visa, Mastercard', 'marque'],
  ['WhatsApp', 'marque'],
  ['ID', 'sigle'],
  ['Code USSD', 'littéral technique'],
  ['USSD code', 'littéral technique'],
  ['Transaction ID', 'littéral technique'],
  ['E-mail', 'littéral technique'],
  ['Email', 'littéral technique'],
  ['Code', 'littéral technique'],
  ['Expert', 'emprunt'],
  // Emprunts délibérés, mesurés le 20/10/2026 : en wolof, le dictionnaire
  // lui-même emploie « profil » (21 valeurs traduites), « bank » (« Tànn bank »,
  // « Tur bank ») et « rayon » (la phrase traduite d'à côté, `radiusActivateHint`,
  // dit « rayon bi »). Les remplacer par des mots forgés ferait deux vocabulaires
  // pour un seul objet — c'est une relecture native qui tranchera.
  ['Profil', 'emprunt'],
  ['Bank', 'emprunt'],
  ['Rayon (km)', 'emprunt'],
];

// Clés qui portent encore le texte français (ou anglais) dans cette langue.
// Les trois listes sont VIDES depuis le 20/10/2026 : les 84 valeurs mesurées ce
// jour-là sont traduites. Une entrée qui apparaîtrait ici est une régression, et
// le plafond ne peut que valoir zéro tant que les listes sont vides.
const EN_ATTENTE = {
  wo: [],
  bm: [],
  mos: [],
};

// Plafond MESURÉ : 0 clé en attente, langue par langue (20/10/2026).
const PLAFOND_EN_ATTENTE = { wo: 0, bm: 0, mos: 0 };

// Mots français qu'aucune des trois langues n'emploie dans ce vocabulaire.
const MARQUEURS_FRANCAIS = [
  'alerte',
  'emploi',
  'vous',
  'votre',
  'impossible',
  'momentanément',
  'disponible',
  'enregistrer',
  'mission',
  'recherche',
  'coupée',
  'activée',
];

const normaliser = (valeur) =>
  String(valeur ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const cles = Object.keys(fr);
const clesAlertes = cles.filter((cle) => cle.startsWith(PREFIXE_ALERTES));

const EXCEPTIONS_PAR_VALEUR = new Map(
  EXCEPTIONS.map(([valeur, famille]) => [normaliser(valeur), { valeur, famille }])
);

const exceptionDe = (valeur) => EXCEPTIONS_PAR_VALEUR.get(normaliser(valeur)) || null;

/** Vrai si la valeur ne porte AUCUNE lettre : rien à traduire. */
const sansLettre = (valeur) =>
  !/[\p{L}]/u.test(String(valeur ?? '').replace(/\{[^}]*\}/g, ' '));

const enAttente = (langue, cle) => EN_ATTENTE[langue].includes(cle);

const estNeutre = (langue, cle, valeur) =>
  sansLettre(valeur) || Boolean(exceptionDe(valeur)) || enAttente(langue, cle);

describe('langue des traductions (wolof, bambara, mooré)', () => {
  it('le dictionnaire est LU avant d’être jugé', () => {
    expect(cles.length, 'fr.json est vide ou tronqué').toBeGreaterThanOrEqual(
      PLANCHER_CLES
    );
    expect(
      clesAlertes.length,
      `aucune clé « ${PREFIXE_ALERTES}* » : le corpus d'alertes a disparu`
    ).toBeGreaterThanOrEqual(PLANCHER_ALERTES);
    // Une langue qui n'aurait pas les mêmes clés serait jugée sur un corpus
    // partiel — `i18nParity` le refuse aussi, mais conclure ici sur un
    // dictionnaire incomplet produirait un vert qui n'a rien mesuré.
    for (const [langue, dictionnaire] of Object.entries(LANGUES)) {
      expect(
        Object.keys(dictionnaire).length,
        `${langue} n'a pas les ${cles.length} clés de fr.json`
      ).toBe(cles.length);
    }
  });

  it('aucune valeur vide ni clé brute affichée', () => {
    const fautes = [];
    for (const [langue, dictionnaire] of Object.entries(LANGUES)) {
      for (const cle of cles) {
        const valeur = dictionnaire[cle];
        if (typeof valeur !== 'string' || !valeur.trim()) {
          fautes.push(`${langue}.${cle} : texte absent`);
        } else if (valeur.trim() === cle) {
          fautes.push(`${langue}.${cle} : la clé brute est publiée à l'écran`);
        }
      }
    }
    expect(fautes, `traduction(s) vide(s) :\n${fautes.join('\n')}`).toEqual([]);
  });

  it('aucune valeur recopiée du FRANÇAIS', () => {
    const fautes = [];
    for (const [langue, dictionnaire] of Object.entries(LANGUES)) {
      for (const cle of cles) {
        const valeur = dictionnaire[cle];
        if (estNeutre(langue, cle, valeur)) continue;
        if (normaliser(valeur) === normaliser(fr[cle])) {
          fautes.push(`${langue}.${cle} : « ${valeur} » (copie du français)`);
        }
      }
    }
    expect(
      fautes,
      `valeur(s) laissée(s) en français — l'utilisateur lit la langue de la référence :\n` +
        `${fautes.join('\n')}\n` +
        `Déclarer un nom propre ou une marque dans EXCEPTIONS, ou constater la dette dans EN_ATTENTE.`
    ).toEqual([]);
  });

  it('aucune valeur recopiée de l’ANGLAIS', () => {
    const fautes = [];
    for (const [langue, dictionnaire] of Object.entries(LANGUES)) {
      for (const cle of cles) {
        // Quand l'anglais dit la même chose que le français, c'est la règle
        // précédente qui juge : un second refus ne mesurerait rien de plus.
        if (normaliser(en[cle]) === normaliser(fr[cle])) continue;
        const valeur = dictionnaire[cle];
        if (estNeutre(langue, cle, valeur)) continue;
        if (normaliser(valeur) === normaliser(en[cle])) {
          fautes.push(`${langue}.${cle} : « ${valeur} » (copie de l'anglais)`);
        }
      }
    }
    expect(fautes, `valeur(s) laissée(s) en anglais :\n${fautes.join('\n')}`).toEqual(
      []
    );
  });

  it('aucun MOT français ne subsiste dans les alertes emploi', () => {
    const fautes = [];
    for (const [langue, dictionnaire] of Object.entries(LANGUES)) {
      for (const cle of clesAlertes) {
        if (estNeutre(langue, cle, dictionnaire[cle])) continue;
        const valeur = String(dictionnaire[cle] ?? '');
        for (const mot of MARQUEURS_FRANCAIS) {
          // Frontières de mot : « alerta » (wolof) n'est pas « alerte ».
          if (new RegExp(`\\b${mot}\\b`, 'i').test(valeur)) {
            fautes.push(`${langue}.${cle} : « ${mot} » dans « ${valeur} »`);
          }
        }
      }
    }
    expect(
      fautes,
      `mot(s) français resté(s) dans une phrase traduite :\n${fautes.join('\n')}`
    ).toEqual([]);
  });

  it('les exceptions déclarées sont encore UTILES et motivées', () => {
    const fautes = [];
    for (const [valeur, famille] of EXCEPTIONS) {
      const motif = FAMILLES[famille];
      if (!motif) {
        fautes.push(`« ${valeur} » : famille inconnue « ${famille} »`);
      } else if (String(motif).trim().length < 40) {
        fautes.push(`« ${valeur} » : motif absent ou trop court`);
      }
      // Employée par au moins une valeur du corpus, comparée au français OU à
      // l'anglais : une exception que plus personne n'utilise autoriserait un
      // libellé qui n'existe plus.
      const attendue = normaliser(valeur);
      const utilisee = Object.entries(LANGUES).some(([, dictionnaire]) =>
        cles.some(
          (cle) =>
            normaliser(dictionnaire[cle]) === attendue &&
            (normaliser(fr[cle]) === attendue || normaliser(en[cle]) === attendue)
        )
      );
      if (!utilisee) {
        fautes.push(`« ${valeur} » : plus aucune valeur ne l'emploie — retirer l'exception`);
      }
    }
    expect(fautes, `exception(s) périmée(s) :\n${fautes.join('\n')}`).toEqual([]);
  });

  it('la dette de traduction est DÉCLARÉE, datée, et ne peut pas grossir', () => {
    const fautes = [];
    for (const [langue, dictionnaire] of Object.entries(LANGUES)) {
      const liste = EN_ATTENTE[langue];
      if (!Array.isArray(liste)) {
        fautes.push(`${langue} : liste absente`);
        continue;
      }
      // Le plafond est le total MESURÉ. Il ne monte jamais : une valeur
      // française ajoutée hors liste est refusée par la règle 2, et une clé
      // ajoutée à la liste est refusée ici tant que le plafond ne baisse pas.
      if (liste.length !== PLAFOND_EN_ATTENTE[langue]) {
        fautes.push(
          `${langue} : ${liste.length} clé(s) en attente pour un plafond de ${PLAFOND_EN_ATTENTE[langue]} — ` +
            `le plafond ne monte pas, il se baisse en traduisant`
        );
      }
      for (const cle of liste) {
        if (!(cle in fr)) {
          fautes.push(`${langue}.${cle} : clé inexistante`);
          continue;
        }
        const valeur = dictionnaire[cle];
        // La dette couvre les deux copies possibles : le français, et l'anglais
        // quand il diffère du français (une valeur anglaise est le même défaut
        // avec une autre source).
        const encoreCopiee =
          normaliser(valeur) === normaliser(fr[cle]) ||
          (normaliser(en[cle]) !== normaliser(fr[cle]) &&
            normaliser(valeur) === normaliser(en[cle]));
        if (!encoreCopiee) {
          fautes.push(
            `${langue}.${cle} : la valeur n'est plus une copie — retirer la dette`
          );
        }
        if (sansLettre(valeur) || exceptionDe(valeur)) {
          fautes.push(
            `${langue}.${cle} : rien à traduire (valeur neutre ou exception) — son entrée est inutile`
          );
        }
      }
    }
    expect(fautes, `dette de traduction incohérente :\n${fautes.join('\n')}`).toEqual(
      []
    );
  });
});
