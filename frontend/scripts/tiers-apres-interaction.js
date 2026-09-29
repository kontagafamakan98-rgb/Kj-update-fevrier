/**
 * TIERS CONTACTÉS APRÈS INTERACTION — la règle, possédée une fois.
 *
 * ── Le COMPLÉMENT de « aucun tiers avant interaction », et son inverse ─────
 * `tiers-avant-interaction.js` répond à une question FERMÉE : avant toute
 * interaction, aucun tiers, jamais — le refus y est absolu, et une seule
 * requête tierce rougit. Cette règle-ci répond à la question d'APRÈS, et elle a
 * une autre forme : un geste (l'appui sur la façade de carte, une recherche sur
 * /jobs) a le DROIT de contacter quelque chose — mais SEULEMENT ce qui est
 * déclaré pour ce geste, nommément, et RIEN d'autre.
 *
 * C'est une différence de fond, pas une nuance : « rien ne part » est vrai de
 * n'importe quelle page cassée, alors que « ce qui part est exactement ce qui
 * est autorisé » ne l'est que d'une page qui fonctionne. Les deux règles
 * partagent donc tout ce qui peut l'être — `estTiers` (qui est nôtre, qui est
 * tiers) et `nommerInitiateur` (comment un refus se nomme) viennent de
 * `tiers-avant-interaction.js` et ne sont PAS redéclarés ici.
 *
 * ── Pourquoi l'autorisation est une ADRESSE, et non un hôte ────────────────
 * « Google est autorisé » serait une autorisation par FAMILLE : elle laisserait
 * passer `maps.googleapis.com`, `www.gstatic.com`, `fonts.googleapis.com` — et
 * surtout, elle ne dirait pas CE QUI a été autorisé, donc elle ne pourrait pas
 * expliquer pourquoi. Ce qui est autorisé ici est l'URL DÉCLARÉE par le site
 * (`CONTACT.mapsEmbedUrl`, lue dans src/config/contact.json — la MÊME valeur que
 * le composant monte dans son iframe). Une adresse voisine du même hôte est donc
 * REFUSÉE : c'est le test qui distingue une autorisation d'une indulgence, et il
 * est rejoué (`e2e/tiers-apres-interaction.spec.js`, deuxième preuve d'échec).
 *
 * ── Ce que la sonde juge, et ce qu'elle ne juge pas ────────────────────────
 * Elle remplace le tiers (`page.route`) et sert une réponse minimale à sa place :
 * ce qui est prouvé est que NOUS demandons la bonne adresse, au bon moment, et
 * rien d'autre — jamais que le tiers réponde, ni ce qu'il demande ensuite. La
 * liste des angles morts est PUBLIÉE plus bas (`CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR`),
 * comme celle du garde statique avant elle.
 */
import { CONTACT } from '../src/config/contact.js';
import { estTiers, nommerInitiateur, ORIGINES_AUTORISEES } from './tiers-avant-interaction.js';

/**
 * Le PROPRIÉTAIRE déclaré de la requête de carte. Nommé dans l'autorisation
 * elle-même : un refus doit pouvoir dire non seulement ce qui est autorisé, mais
 * PAR QUI — c'est ce qui rend l'autorisation révisable (le composant change, on
 * lit où).
 */
export const PROPRIETAIRE_DE_LA_CARTE = 'src/components/MapEmbed.js';

/**
 * LES GESTES DÉCLARÉS, et ce que chacun a le droit de contacter.
 *
 * Un geste non déclaré fait LEVER la règle (`autorisationsDe`) : on ne juge pas
 * un geste dont personne n'a écrit ce qu'il a le droit de faire — c'est la même
 * règle que les emplacements de la marque et les noms d'icônes de `page-icons.js`.
 */
export const INTERACTIONS = {
  'ouvrir-la-carte': {
    geste: 'l’appui sur le contrôle de la façade de carte',
    // L'iframe que `MapEmbed` monte À L'APPUI. La valeur vient de contact.json :
    // elle n'est pas recopiée ici, sinon elle pourrait autoriser une adresse que
    // la page ne monte plus (une autorisation qui survit à son usage).
    autorisations: [
      {
        url: CONTACT.mapsEmbedUrl,
        proprietaire: PROPRIETAIRE_DE_LA_CARTE,
        raison:
          'l’iframe `output=embed` de la fiche Google, montée par `MapEmbed` À L’APPUI ' +
          'seulement (aucune requête avant : c’est la règle d’avant-interaction).',
      },
    ],
  },
  'chercher-une-mission': {
    geste: 'une recherche écrite dans le filtre de /jobs',
    // AUCUNE autorisation, et c'est une affirmation : ce geste appelle NOTRE API,
    // qui n'est pas un tiers. Toute origine tierce vue après lui est donc un
    // refus — pas un oubli de déclaration.
    autorisations: [],
  },
};

/** Les gestes connus — publiés pour que les sondes ne recopient pas la liste. */
export const NOMS_DES_INTERACTIONS = Object.keys(INTERACTIONS);

/**
 * Les autorisations d'un geste, ou une erreur bruyante s'il n'est pas déclaré.
 *
 * @param {string} interaction Nom du geste (une clé de `INTERACTIONS`).
 * @returns {{ geste: string, autorisations: Array<Object> }}
 */
export function autorisationsDe(interaction) {
  const declaration = INTERACTIONS[interaction];
  if (!declaration) {
    throw new Error(
      `tiers-apres-interaction : le geste « ${interaction} » n’est pas déclaré — on ne ` +
        'juge pas ce qu’un geste a le droit de contacter sans l’avoir écrit ' +
        `(déclarés : ${NOMS_DES_INTERACTIONS.join(', ')}).`
    );
  }
  return declaration;
}

/**
 * Deux URL désignent-elles la MÊME adresse ? Comparaison sur l'URL RÉSOLUE
 * (`new URL().href`), jamais sur la chaîne : une casse d'hôte différente, un
 * `/` final qui manque ou un encodage qui change la forme de la requête ne
 * doivent pas faire passer une adresse autorisée pour une autre — ni
 * l'inverse. Une URL illisible n'est jamais « la même ».
 */
export const memeAdresse = (a, b) => {
  try {
    return new URL(String(a)).href === new URL(String(b)).href;
  } catch (_erreur) {
    return false;
  }
};

/**
 * Une requête vers NOTRE API — par son CHEMIN (`/api/`), pas par son origine :
 * la même application parle à l'API de production ou à la fixture selon le build
 * (`VITE_API_URL`), et cette différence ne doit pas changer le verdict.
 *
 * Elle sert de PLANCHER DE LECTURE au cas d'appel d'API : sans elle, un journal
 * vide passerait pour un vert (« aucun tiers » serait vrai parce que rien n'a
 * été observé, pas parce que l'appel est resté chez nous).
 */
export const estRequeteDAPI = (url) => /\/api\//.test(String(url || ''));

/**
 * La forme publiée d'une requête : son URL, sa sorte, et QUI l'a lancée.
 *
 * Le document demandeur vient de l'écoute (`requete.cadre`,
 * `e2e/helpers/requetes.js`) ; à défaut, c'est l'origine de la page, qui est
 * bien le document qui exécute le geste. Le nom ne recule donc pas quand
 * Chromium ne remplit pas `initiator` — ce qui est le cas de toute iframe montée
 * par un script (mesuré : `{"type":"other"}`).
 */
const nommerLaRequete = (requete, origineDeLaPage) => ({
  url: String(requete?.url || ''),
  sorte: String(requete?.sorte || 'requête'),
  initiateur: nommerInitiateur(requete?.initiateur, {
    cadre: requete?.cadre || origineDeLaPage || '',
  }),
});

/**
 * Le VERDICT d'un geste : ce qui est sorti, ce qui était autorisé, ce qui ne
 * l'était pas.
 *
 * `autorisees` et `refusees` sont DISJOINTES et, ensemble, forment exactement
 * les requêtes TIERCES : une requête tierce qui n'est pas autorisée est un refus,
 * et toute tierce est dans l'une des deux listes. Les requêtes de nos origines ne
 * sont ni l'une ni l'autre — elles sont rendues dans `notres`, parce que le cas
 * d'appel d'API a besoin de les NOMMER (« la requête qui part est bien la
 * nôtre »), et qu'un verdict qui ne rend que ses refus ne peut pas le prouver.
 *
 * @param {Array<{ url: string, sorte?: string, initiateur?: object }>} requetes
 *   Requêtes observées APRÈS le geste (l'appelant découpe son journal de façon à
 *   ne juger que ce que le geste a produit).
 * @param {{ interaction: string, origineDeLaPage?: string|null, origines?: string[] }} options
 * @returns {{
 *   geste: string,
 *   notres: Array<Object>,
 *   autorisees: Array<Object>,
 *   refusees: Array<Object>,
 * }}
 */
export function jugerApresInteraction(requetes, { interaction, origineDeLaPage = null, origines = ORIGINES_AUTORISEES }) {
  const { geste, autorisations } = autorisationsDe(interaction);
  const tierces = [];
  const notres = [];

  for (const requete of requetes || []) {
    const entree = nommerLaRequete(requete, origineDeLaPage);
    if (estTiers(entree.url, { origineDeLaPage, origines })) tierces.push(entree);
    else notres.push(entree);
  }

  const autorisees = [];
  const refusees = [];
  for (const entree of tierces) {
    const autorisation = autorisations.find((regle) => memeAdresse(regle.url, entree.url));
    if (autorisation) {
      autorisees.push({ ...entree, proprietaire: autorisation.proprietaire });
    } else {
      refusees.push(entree);
    }
  }

  return { geste, notres, autorisees, refusees };
}

/**
 * Ce que cette sonde NE PEUT PAS voir, publié pour être lu et comparé — jamais
 * pour être cru. Même rôle que `CE_QUE_LE_GARDE_STATIQUE_VOIT` dans la règle
 * d'avant : une limite nommée vaut mieux qu'une confiance implicite.
 */
export const CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR = {
  peutVoir: [
    'l’adresse exacte demandée après le geste, sa sorte de ressource, et l’initiateur qui l’a lancée',
    'une requête tierce déclenchée par le geste que personne n’a autorisée, même du même hôte qu’une adresse autorisée',
    'une requête qui part à l’appui et que le HTML publié ne contient pas (elle n’existe dans aucun document)',
  ],
  nePeutPasVoir: [
    'ce que le TIERS demande ensuite (ses tuiles, ses polices) : la sonde le remplace, elle ne juge que ce que NOUS demandons — une fois la page du tiers chargée, sa propre activité ne la regarde pas',
    'une requête émise APRÈS la fenêtre d’écoute : le journal est lu jusqu’au silence, pas jusqu’à la fermeture de l’onglet',
    'un tiers contacté par un AUTRE geste que celui déclaré : chaque cas nomme le sien, un geste non déclaré fait LEVER la règle',
    'l’auteur d’une requête dont l’initiateur manque (`initiateur inconnu`) : elle est refusée, mais la sonde ne peut pas dire qui l’a lancée',
  ],
};
