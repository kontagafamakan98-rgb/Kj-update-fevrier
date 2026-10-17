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
 * ── LE MONTAGE N'EST PAS UN CRAN, ET IL PEUT TOMBER TARD (11/10/2026) ────
 * React repose la source COURANTE sur le nœud de la coquille au montage : un
 * enregistrement qui n'apprend rien figure donc au journal. La sonde comptait sur
 * lui pour être DÉJÀ là quand le départ se lit — vrai sur un poste, faux sur un
 * hôte chargé, où il arrive APRÈS (mesuré ici en bridant le CPU ×6 : `src` et
 * journal VIDES à la lecture du départ, l'enregistrement de montage 300 ms plus
 * tard). Le journal lu valait alors [montage, cran 1, cran 2] : la suite publiée
 * était [1re photo, 2e, 3e] au lieu de [2e, 3e, 4e], sur trois enregistrements
 * et DEUX intervalles (30,2 s) — c'est le rouge de la CI du 11/10/2026, et il se
 * lisait comme un « départ décalé ». `REGLE_DES_CRANS` remplace l'index de départ
 * en dur : un enregistrement qui repose la même source n'est pas un cran, il DATE
 * l'apparition de la photo (c'est l'ancre du premier intervalle, le minuteur
 * s'armant au montage), et la suite attendue se dérive CYCLIQUEMENT de cette
 * photo de référence — au lieu de supposer un départ sur la première.
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

/**
 * LA RÈGLE DES CRANS, POSÉE DANS LA PAGE ET LUE PAR LES DEUX LECTEURS.
 *
 * Un cran n'est pas un ENREGISTREMENT du journal : c'est un CHANGEMENT de
 * source. La distinction a coûté un rouge en CI (voir l'en-tête) : le montage
 * repose la source courante, il peut tomber après la lecture du départ, et le
 * compter comme un cran décale la suite d'un rang tout en faisant croire à deux
 * intervalles au lieu de trois.
 *
 * Elle est posée dans la page comme `__kojoRotationLire` : l'attente bornée et la
 * lecture finale passent par la MÊME fonction, sans quoi deux copies de cette
 * règle finiraient par ne plus dire la même chose.
 *
 * L'ANCRE est l'instant du dernier enregistrement écarté — celui du montage, qui
 * date l'apparition de la photo et l'armement du minuteur. C'est lui qui mesure le
 * PREMIER intervalle ; quand il n'y en a pas (rien à écarter), l'ancre est la
 * lecture du départ, prise au plus près du montage.
 */
const REGLE_DES_CRANS = () => {
  window.__kojoCransDuJournal = (changements, index, srcDepart) => {
    const crans = [];
    let precedent = srcDepart;
    let ancre = null;
    for (const changement of changements.slice(index)) {
      if (changement.src === precedent) {
        ancre = changement.t;
        continue;
      }
      crans.push(changement);
      precedent = changement.src;
    }
    return { crans, ancre };
  };
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
        await page.addInitScript(REGLE_DES_CRANS);
        await page.goto('/');
        await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });

        // ── Le départ, lu AU PLUS PRÈS du montage : c'est ce qui permet de
        // mesurer le PREMIER intervalle (l'écart au montage), et pas seulement
        // ceux qui séparent deux remplacements. L'index courant du journal est
        // noté, pour que la suite d'observations soit celle d'APRÈS ce point —
        // l'enregistrement du montage est écarté par la RÈGLE (il repose la
        // source courante), pas par cet index : sur un hôte chargé il arrive
        // APRÈS cette lecture, et l'écarter par l'index le comptait comme un cran.
        const depart = await page.evaluate(() => ({
          lecture: window.__kojoRotationLire(),
          index: window.__kojoRotation.changements.length,
        }));
        await attendreLaStabilite(page);
        const departStable = await page.evaluate(() => window.__kojoRotationLire());

        // ── La photo de RÉFÉRENCE : celle qui est peinte à la lecture du départ.
        // Elle peut MANQUER — mesuré (CPU ×6) : `.cadre-image` est absent au
        // moment du départ, React ayant vidé la racine sans avoir encore peint le
        // héros. Le repli n'est pas une supposition : la coquille publie la
        // PREMIÈRE photo déclarée et l'alternance part de l'index 0
        // (`useState(0)` dans `PhotoDuHeros.js`), donc la source courante d'un
        // héros pas encore peint est cette première photo — lue dans son domicile,
        // jamais recopiée ici.
        const reference = depart.lecture.src || PHOTOS_HEROS[0];

        // ── On attend ${CRANS} CRANS — c'est-à-dire ${CRANS} CHANGEMENTS de
        // source, la règle écartant les enregistrements qui reposent la même : une
        // CONDITION bornée, jamais une attente fixe (`frontend/e2e/` est déclaré
        // sur `attenteFixe` avec une déclaration vide : aucune durée ne décide
        // ici). Le plafond laisse ${CRANS} intervalles pleins plus le retard
        // maximal toléré.
        const observe = await page
          .waitForFunction(
            (cible) =>
              window.__kojoCransDuJournal(window.__kojoRotation.changements, cible.index, cible.src)
                .crans.length >= cible.crans,
            { index: depart.index, src: reference, crans: CRANS },
            { timeout: CRANS * (PHOTO_HEROS_DELAI_MS + RETARD_MAX_MS) }
          )
          .then(() => true)
          .catch(() => false);

        const releve = await page.evaluate(() => ({
          rotation: window.__kojoRotation,
          cls: window.__kojoCls,
        }));
        // LA MÊME RÈGLE que celle de l'attente, dans la même page : le journal est
        // relu ici en entier (l'attente s'arrête au ${CRANS}e cran, la lecture ne
        // peut pas en manquer).
        const { crans, ancre } = await page.evaluate(
          ({ index, src }) => window.__kojoCransDuJournal(window.__kojoRotation.changements, index, src),
          { index: depart.index, src: reference }
        );

        // ── 1. La rotation a bien tourné le nombre de crans attendu ─────────
        // Un rouge d'attente ne dit pas quel défaut existe : c'est CETTE
        // assertion qui nomme ce qui a été vu (et le journal, pas un délai).
        expect(
          observe,
          `« / » (${taille}) : ${crans.length} cran(s) de rotation observé(s) en ` +
            `${CRANS * (PHOTO_HEROS_DELAI_MS + RETARD_MAX_MS)} ms — ${CRANS} attendus ` +
            `(sources vues : ${JSON.stringify(crans.map((c) => c.src))})`
        ).toBe(true);
        expect(
          crans.length,
          `« / » (${taille}) : ${crans.length} cran(s) observé(s) au lieu de ${CRANS} — ` +
            'un cran de plus signalerait un SECOND minuteur (ou une avance de deux crans) ; les ' +
            'enregistrements qui reposent la MÊME source (le montage) ne sont pas comptés.'
        ).toBe(CRANS);

        // ── 2. La suite est EXACTEMENT la liste déclarée, cran par cran ─────
        // C'est la mesure de « un seul cran » : une implémentation qui sauterait
        // une photo afficherait bien une nouvelle source à chaque intervalle,
        // mais pas celle-là. La suite attendue se dérive CYCLIQUEMENT de la photo
        // de référence lue dans la page, donc la sonde ne suppose plus que
        // l'observation commence sur la première photo : c'est vrai sur un poste,
        // et faux sur un hôte où la lecture du départ a manqué le montage.
        const indexDepart = PHOTOS_HEROS.indexOf(reference);
        expect(
          indexDepart,
          `« / » (${taille}) : la photo de référence « ${reference} » n'appartient pas à la liste ` +
            `déclarée (${PHOTOS_HEROS.join(', ')}) — la suite ne peut pas être jugée cran par cran.`
        ).not.toBe(-1);
        const suiteAttendue = Array.from(
          { length: CRANS },
          (_, i) => PHOTOS_HEROS[(indexDepart + 1 + i) % PHOTOS_HEROS.length]
        );
        expect(
          crans.map((c) => c.src),
          `« / » (${taille}) : la suite observée n'est pas la liste déclarée, cran par cran ` +
            `(référence lue « ${reference} », suite attendue ${JSON.stringify(suiteAttendue)}). ` +
            'Un saut (index avancé deux fois), une répétition (index revenu en arrière) ou un ' +
            'départ décalé se lisent ici.'
        ).toEqual(suiteAttendue);

        // ── 3. Un cran PAR INTERVALLE déclaré ──────────────────────────────
        // Le premier écart se mesure depuis l'ANCRE (le montage, qui date
        // l'apparition de la photo et l'armement du minuteur) quand il y en a une,
        // et depuis la lecture du départ sinon ; les suivants séparent deux
        // remplacements observés. Ancrer sur la lecture du départ d'un hôte où le
        // montage tombe plus tard compterait le retard de React comme du retard de
        // la rotation — un rouge d'hôte.
        const instants = [ancre === null ? depart.lecture.t : ancre, ...crans.map((c) => c.t)];
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
