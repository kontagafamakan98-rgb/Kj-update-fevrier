import { test, expect } from '@playwright/test';
// Le protocole du dépôt (page neuve, marqueur de montage, deux tailles, stabilité
// de mise en page) vient du harnais partagé — `src/config/page-meta.js` en est la
// source pour les routes, et les tailles ne sont jamais recopiées.
import {
  TAILLES,
  TOLERANCE_PX,
  MARQUEUR_DE_MONTAGE,
  attendreLaStabilite,
  ouvrirLaPage,
} from './helpers/geometrie.js';
// L'observateur de décalages est CELUI des autres sondes (`__kojoCls`) : le CLS
// n'est pas réobservé ici, et c'est LUI qui attrape un mouvement que les
// échantillons d'une sonde ne verraient pas (un décalage transitoire entre deux
// lectures).
import { ESPION_CLS, clsDesDecalages, decrireDecalage } from './helpers/cls.js';
// LE DÉLAI EST CELUI DU COMPOSANT, LU DANS SON DOMICILE : la sonde attend
// l'intervalle que la page applique, elle ne recopie pas 15 000 ms.
import { PHOTOS_HEROS, PHOTO_HEROS_DELAI_MS } from '../src/config/photos-heros.js';

/**
 * LA ROTATION DU HÉROS, PROUVÉE SUR PLUSIEURS CRANS (08/10/2026).
 *
 * ── Ce qui est en jeu ──────────────────────────────────────────────────────
 * `src/components/PhotoDuHeros.js` fait tourner six photos, une toutes les
 * `PHOTO_HEROS_DELAI_MS`. Deux propriétés portent tout le reste, et aucune des
 * deux n'était mesurée sur PLUSIEURS crans :
 *
 *   1. LA LISTE AVANCE D'UN SEUL CRAN PAR INTERVALLE. « Un cran » n'est pas « la
 *      photo a changé » : une implémentation qui passerait de la 1 à la 3 (index
 *      incrémenté deux fois dans le même tour, deux minuteurs armés, un `index`
 *      dérivé d'une horloge) changerait bien de photo à chaque intervalle — et
 *      elle sauterait une photo par cycle. C'est la SUITE OBSERVÉE qui le dit :
 *      les sources relevées doivent être EXACTEMENT la liste déclarée, cran par
 *      cran. « Par intervalle déclaré » se mesure de la même façon : l'écart
 *      entre deux remplacements successifs est l'intervalle du composant, jamais
 *      plus court (un second minuteur, ou un `setTimeout` d'un cran plus court).
 *      Les valeurs sont celles MESURÉES sur ce poste, et elles sont publiées au
 *      lecteur : un vert sans chiffre ne prouve rien (règle du dépôt).
 *
 *   2. LA BOÎTE DU HÉROS NE BOUGE NI EN TAILLE NI EN POSITION. C'est l'élément
 *      LCP de « / » (voir `lcp-geometrie.spec.js`), et les six photos sont au
 *      même rapport (720 × 960) précisément pour ça : `width`/`height` réservent
 *      la place AVANT que l'image n'arrive, donc un remplacement ne doit RIEN
 *      déplacer. La sonde le mesure de deux façons indépendantes : les boîtes
 *      (celles de la photo ET du cadre qui la porte) relevées à chaque
 *      remplacement doivent être identiques — même `x`, même `y`, même largeur,
 *      même hauteur —, et le CLS du dépôt, qui observe TOUS les nœuds, doit
 *      rester à ZÉRO décalage pendant toute la rotation. Un placement qui se
 *      décale d'un pixel ne passerait pas inaperçu : il apparaîtrait dans le
 *      second instrument.
 *
 * ── Pourquoi le premier intervalle est mesuré depuis le MONTAGE ────────────
 * L'intervalle s'arme dans l'effet du composant, au montage. Lire le départ
 * juste après le marqueur de montage (et non après l'attente de stabilité, qui
 * ajoute des centaines de millisecondes) laisse donc trois intervalles mesurés
 * au lieu de deux : c'est la seule mesure qui dise « dès le premier tour ». Le
 * relevé de géométrie, lui, est pris APRÈS l'attente de stabilité : comparer une
 * boîte de la rotation à une boîte relevée en plein montage mesurerait le
 * montage, pas la rotation.
 *
 * ── Ce que cette sonde ne fait pas ─────────────────────────────────────────
 * Elle ne juge ni le FORMAT téléchargé (`heros-format.spec.js`), ni le contrôle
 * de pause (`heros-pause.spec.js`), ni le LCP de l'accueil — seulement que la
 * rotation est celle qui est déclarée, et qu'elle ne déplace rien.
 */

/** Combien de crans la sonde observe. Trois : deux intervalles INTERNES, donc
 *  une cadence mesurée deux fois, et une suite qui montrerait un saut. */
export const CRANS = 3;

/** Marge d'AVANCE : 0,4 s sous l'intervalle déclaré. Un minuteur qui avance plus
 *  vite que ce qu'il annonce est le défaut visé (deux minuteurs, un pas plus
 *  court) ; une marge serrée ne le laisserait pas passer. */
export const MARGE_INTERVALLE_MS = 400;

/** Plafond de RETARD. Être en retard ne contredit pas « un cran par
 *  intervalle » — un onglet occupé décale le réveil du minuteur — et un plafond
 *  serré ferait rougir un artefact sain sur un runner chargé. */
export const RETARD_MAX_MS = 5000;

/**
 * L'observateur, installé AVANT la navigation : il note l'instant de CHAQUE
 * changement de `src`, avec la boîte peinte à ce moment-là.
 *
 * Il observe le document entier (`subtree`) parce que React remplace le nœud au
 * montage. Un remplacement qui déplacerait la page laisserait sa trace ici, et le
 * CLS la verrait même entre deux échantillons.
 *
 * ── LE PIÈGE DE L'`addInitScript`, ET IL A COÛTÉ UNE PASSE (mesuré) ────────
 * Un script d'initialisation s'exécute AVANT que le document ne porte son
 * élément racine : `document.documentElement` y vaut **null**. Observer `null`
 * lève, et comme l'objet d'état est posé AVANT l'observateur, la sonde avait
 * l'air installée — ses lectures répondaient — pendant qu'AUCUN changement n'
 * était jamais noté (« 0 changement(s) de photo observé(s) » sur les deux
 * tailles, alors que la rotation tournait). Le remède est de s'armer sur ce qui
 * existe (`document`), puis de RÉARMER sur la racine dès qu'elle apparaît — en
 * DÉSARMENT l'ancienne cible, sinon chaque changement serait compté deux fois.
 * Les autres observateurs du dépôt (`ESPION_CLS`) n'y étaient pas exposés : ils
 * observent des entrées de performance, jamais un nœud.
 */
const ESPION_ROTATION = () => {
  const lire = () => {
    const boite = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return [+r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)];
    };      const image = document.querySelector('.cadre-image');
    return {
      t: +performance.now().toFixed(1),
      src: image ? image.getAttribute('src') : null,
      image: boite(image),
      cadre: boite(document.querySelector('.cadre-illustration')),
      hauteur: document.documentElement.scrollHeight,
      // Compteur NEUTRE : il prouve qu'aucun second `<img>` n'est empilé
      // pendant l'alternance (un carrousel naïf en publierait deux, dont un
      // caché, et l'élément LCP serait ré-élu).
      images: document.querySelectorAll('.cadre-image').length,
    };
  };
  window.__kojoRotation = { changements: [] };
  // Exposée À PART : un objet qui porte une fonction ne se sérialise pas, et le
  // test doit lire exactement ce que l'observateur note (les deux lectures
  // passent par la même fonction, donc elles sont comparables).
  window.__kojoRotationLire = lire;
  const observateur = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName !== 'src') continue;
      const cible = mutation.target;
      // Le nœud remplacé par React au montage porte AUSSI la classe, et son
      // enregistrement est écarté par l'index de départ du test, pas ici.
      if (!cible.classList || !cible.classList.contains('cadre-image')) continue;
      window.__kojoRotation.changements.push(lire());
    }
  });
  const options = { subtree: true, attributes: true, attributeFilter: ['src'] };
  const armer = (racine) => {
    observateur.disconnect();
    observateur.observe(racine, options);
  };
  // `document` quand la racine n'existe pas encore (le cas d'un script d'init,
  // mesuré), l'élément racine dès qu'il est là — et jamais les deux à la fois.
  armer(document.documentElement || document);
  if (!document.documentElement) {
    const veille = new MutationObserver(() => {
      if (!document.documentElement) return;
      veille.disconnect();
      armer(document.documentElement);
    });
    veille.observe(document, { childList: true });
  }
};

/** Deux boîtes coïncident-elles, à la tolérance de sous-pixel du dépôt ? */
const memeBoite = (a, b) => Boolean(a) && Boolean(b) && a.every((v, i) => Math.abs(v - b[i]) <= TOLERANCE_PX);

/** Une boîte, en une ligne lisible. */
const enLigne = (boite) =>
  boite ? `${boite[2]}×${boite[3]} px à (${boite[0]}, ${boite[1]})` : 'boîte illisible';

test.describe('la rotation du héros, cran par cran', () => {
  for (const { nom: taille, viewport } of TAILLES) {
    test(`« / » — ${taille} : un cran par intervalle de ${PHOTO_HEROS_DELAI_MS} ms, et une boîte immobile`, async ({
      browser,
    }) => {
      // Le cas dure ${CRANS} intervalles RÉELS (le délai est une donnée du
      // produit, on ne truque pas l'horloge d'une page montée) : le plafond du
      // test suit le nombre de crans observés.
      test.setTimeout(CRANS * (PHOTO_HEROS_DELAI_MS + RETARD_MAX_MS) + 40000);

      const page = await ouvrirLaPage(browser, 'reelle', viewport);
      try {
        await page.addInitScript(ESPION_CLS);
        await page.addInitScript(ESPION_ROTATION);
        await page.goto('/');
        await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });

        // ── Le départ, lu AU PLUS PRÈS du montage : c'est ce qui permet de
        // mesurer le PREMIER intervalle (l'écart au montage), et pas seulement
        // ceux qui séparent deux remplacements. On note aussi l'index courant du
        // journal, pour que la suite d'observations soit celle d'APRÈS ce point —
        // sans quoi un enregistrement du montage (React remplace le nœud de la
        // coquille) serait compté comme un cran.
        const depart = await page.evaluate(() => ({
          lecture: window.__kojoRotationLire(),
          index: window.__kojoRotation.changements.length,
        }));
        await attendreLaStabilite(page);
        const departStable = await page.evaluate(() => window.__kojoRotationLire());

        // ── On attend ${CRANS} crans DE PLUS QUE LE POINT DE DÉPART : une
        // CONDITION bornée, jamais une attente fixe (`frontend/e2e/` est déclaré
        // sur `attenteFixe` avec une déclaration vide : aucune durée ne décide
        // ici). Le plafond laisse ${CRANS} intervalles pleins plus le retard
        // maximal toléré. Le compte part de `depart.index` et non de zéro :
        // l'enregistrement du MONTAGE (React remplace le nœud de la coquille) est
        // déjà dans le journal, et l'oublier faisait attendre un cran de moins
        // que demandé (mesuré : « 2 changements observés au lieu de 3 »).
        const observe = await page
          .waitForFunction(
            (cible) => window.__kojoRotation.changements.length >= cible,
            depart.index + CRANS,
            { timeout: CRANS * (PHOTO_HEROS_DELAI_MS + RETARD_MAX_MS) }
          )
          .then(() => true)
          .catch(() => false);

        const releve = await page.evaluate(() => ({
          rotation: window.__kojoRotation,
          cls: window.__kojoCls,
        }));
        const crans = releve.rotation.changements.slice(depart.index);

        // ── 1. La rotation a bien tourné le nombre de crans attendu ─────────
        // Un rouge d'attente ne dit pas quel défaut existe : c'est CETTE
        // assertion qui nomme ce qui a été vu (et le journal, pas un délai).
        expect(
          observe,
          `« / » (${taille}) : ${crans.length} changement(s) de photo observé(s) en ` +
            `${CRANS * (PHOTO_HEROS_DELAI_MS + RETARD_MAX_MS)} ms — ${CRANS} attendus ` +
            `(sources vues : ${JSON.stringify(crans.map((c) => c.src))})`
        ).toBe(true);
        expect(
          crans.length,
          `« / » (${taille}) : ${crans.length} changements observés au lieu de ${CRANS} — ` +
            'un changement de plus signalerait un SECOND minuteur (ou une avance de deux crans ' +
            'comptée deux fois).'
        ).toBe(CRANS);

        // ── 2. La suite est EXACTEMENT la liste déclarée, cran par cran ─────
        // C'est la mesure de « un seul cran » : une implémentation qui sauterait
        // une photo afficherait bien une nouvelle source à chaque intervalle,
        // mais pas celle-là.
        expect(
          crans.map((c) => c.src),
          `« / » (${taille}) : la suite observée n'est pas la liste déclarée, cran par cran. ` +
            'Un saut (index avancé deux fois), une répétition (index revenu en arrière) ou un ' +
            'départ décalé se lisent ici.'
        ).toEqual(PHOTOS_HEROS.slice(1, CRANS + 1));

        // ── 3. Un cran PAR INTERVALLE déclaré ──────────────────────────────
        // Le premier écart se mesure depuis la lecture du départ (prise juste
        // après le montage) ; les suivants séparent deux remplacements observés.
        const instants = [depart.lecture.t, ...crans.map((c) => c.t)];
        const ecarts = instants.slice(1).map((t, i) => +(t - instants[i]).toFixed(1));
        const sousMinimal = ecarts.map((e, i) => ({ e, i })).filter(({ e }) => e < PHOTO_HEROS_DELAI_MS - MARGE_INTERVALLE_MS);
        const auDelaDuRetard = ecarts.map((e, i) => ({ e, i })).filter(({ e }) => e > PHOTO_HEROS_DELAI_MS + RETARD_MAX_MS);
        expect(
          sousMinimal.map(({ e, i }) => `cran ${i + 1} : ${e} ms`),
          `« / » (${taille}) : la rotation a avancé PLUS VITE que l'intervalle déclaré ` +
            `(${PHOTO_HEROS_DELAI_MS} ms, marge ${MARGE_INTERVALLE_MS} ms) — écarts mesurés ` +
            `${JSON.stringify(ecarts)}. Un second minuteur, ou un pas plus court, se voit ici.`
        ).toEqual([]);
        expect(
          auDelaDuRetard.map(({ e, i }) => `cran ${i + 1} : ${e} ms`),
          `« / » (${taille}) : un cran a mis plus de ${PHOTO_HEROS_DELAI_MS + RETARD_MAX_MS} ms à ` +
            `venir — écarts mesurés ${JSON.stringify(ecarts)}. Être en retard ne contredit pas ` +
            '« un cran par intervalle », mais au-delà de ce plafond la rotation n\'est plus celle ' +
            'qui est déclarée.'
        ).toEqual([]);

        // ── 4. La boîte ne bouge NI en taille NI en position ────────────────
        // Deux instruments : les boîtes relevées à chaque remplacement (photo ET
        // cadre), et le CLS plus bas, qui observe tous les nœuds entre deux
        // échantillons. La comparaison porte sur le relevé d'APRÈS l'attente de
        // stabilité : comparer à la boîte du montage mesurerait le montage.
        expect(departStable.image, `« / » (${taille}) : boîte de la photo illisible`).not.toBe(null);
        expect(departStable.image[2], `« / » (${taille}) : la photo est large de ${departStable.image[2]} px`).toBeGreaterThan(0);
        const deplacees = crans.filter(
          (c) => !memeBoite(c.image, departStable.image) || !memeBoite(c.cadre, departStable.cadre)
        );
        expect(
          deplacees.map(
            (c) =>
              `à t=${c.t} ms : photo ${enLigne(c.image)} (départ ${enLigne(departStable.image)}), ` +
              `cadre ${enLigne(c.cadre)} (départ ${enLigne(departStable.cadre)})`
          ),
          `« / » (${taille}) : ${deplacees.length} remplacement(s) ont bougé la boîte du héros — les six ` +
            'photos sont au même rapport (720 × 960) et `width`/`height` réservent la place, donc un ' +
            'remplacement ne doit rien déplacer.'
        ).toEqual([]);
        expect(
          crans.map((c) => c.hauteur),
          `« / » (${taille}) : la hauteur du document a changé pendant la rotation (départ ` +
            `${departStable.hauteur} px) — le remplacement déplace donc la page.`
        ).toEqual(crans.map(() => departStable.hauteur));
        expect(
          crans.map((c) => c.images),
          `« / » (${taille}) : le nombre d'éléments portant la classe de la photo a changé pendant ` +
            "la rotation — l'alternance doit remplacer la source d'UN SEUL `img`, jamais empiler " +
            'deux nœuds.'
        ).toEqual(crans.map(() => departStable.images));

        // ── 5. Aucun décalage CLS PENDANT la rotation ──────────────────────
        // Instrument indépendant, et plus fin que les échantillons : il voit un
        // mouvement de N'IMPORTE QUEL nœud, y compris entre deux relevés. On ne
        // juge que la fenêtre de la rotation (les décalages du montage et du
        // chargement des polices sont ceux du budget CLS de la route, mesurés
        // par `cls-coquille-react.spec.js`).
        const premierCran = crans[0] ? crans[0].t : departStable.t;
        const pendant = (releve.cls.decalages || []).filter((d) => d.debut > premierCran);
        expect(
          pendant.map((d) => decrireDecalage(d)),
          `« / » (${taille}) : ${pendant.length} décalage(s) de mise en page PENDANT la rotation ` +
            '(le CLS de la route est mesuré ailleurs ; ici on juge les remplacements)'
        ).toEqual([]);

        const clsPendant = clsDesDecalages((releve.cls.decalages || []).filter((d) => d.debut <= premierCran));
        console.log(
          `ℹ️  Rotation ${taille} : ${CRANS} crans en ${(instants[CRANS] - instants[0]).toFixed(0)} ms ` +
            `(écarts ${JSON.stringify(ecarts)} ms pour un intervalle déclaré de ${PHOTO_HEROS_DELAI_MS} ms) ; ` +
            `boîte immobile ${enLigne(departStable.image)} (cadre ${enLigne(departStable.cadre)}, ` +
            `document ${departStable.hauteur} px) ; ${pendant.length} décalage(s) pendant la rotation ` +
            `(CLS avant le premier cran ${clsPendant.cls.toFixed(4)}, ${clsPendant.total.toFixed(4)} brut) ; ` +
            `${PHOTOS_HEROS.length} photos au cycle.`
        );
      } finally {
        await page.close();
      }
    });
  }
});
