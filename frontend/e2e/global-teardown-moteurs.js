import { publierLesEcarts, MOTEURS, lireLesReleves, FICHIER_DES_MESURES } from './helpers/moteurs.js';

/**
 * LE TABLEAU DES ÉCARTS, PUBLIÉ UNE FOIS, APRÈS TOUS LES PROJETS.
 *
 * C'est ici et nulle part ailleurs que les trois moteurs se rencontrent : chaque
 * projet Playwright s'exécute dans son propre processus de travail, donc un
 * `afterAll` de fichier ne voit qu'un seul moteur et ne peut rien comparer. Le
 * teardown global, lui, tourne une fois la suite finie, relit les relevés écrits
 * par tous les processus, et publie — au journal et dans
 * `test-results/ecarts-moteurs.md` — ce que chaque moteur a mesuré des mêmes
 * gestes.
 *
 * Il n'échoue JAMAIS : un écart est une MESURE à lire, pas une régression à
 * refuser. Ce qui doit rougir (un geste qui ne produit pas l'effet attendu) est
 * déjà jugé par le cas lui-même ; un teardown qui refuserait un écart rendrait
 * rouge une suite verte sur le seul fait que Firefox et WebKit ne se
 * ressemblent pas.
 */
export default function globalTeardown() {
  const releves = lireLesReleves(FICHIER_DES_MESURES);
  const moteursVus = new Set(releves.map(({ moteur }) => moteur));
  for (const moteur of MOTEURS) {
    if (!moteursVus.has(moteur)) {
      console.log(
        `⚠️  aucun relevé pour le moteur \`${moteur}\` : ses parcours n'ont pas tourné, ou n'ont rien publié — ` +
          'le tableau ci-dessous ne peut pas le comparer.'
      );
    }
  }
  publierLesEcarts();
}
