/**
 * PREUVE D'ÉCHEC REJOUÉE — la forme `*Icon` (les icônes DESSINÉES).
 *
 * Un plan de page pré-rendue nomme ses icônes par un champ de niveau ROUTE
 * terminé par `Icon` (`legalNoticeIcon`, `noJobIcon`…, `src/config/page-sections.js`)
 * et non plus par un emoji : la page les dessine par `IconePage` et la coquille
 * par `svgDeLIcone`, toutes deux lisant le MÊME registre
 * (`src/config/page-icons.js`). Ce que ces cas rejouent : on RENOMME l'icône dans
 * le plan SANS toucher la coquille, et le build REFUSE — une icône ne peut pas
 * disparaître en silence.
 *
 * Deux refus, et il faut les DEUX :
 *
 *   • le PREMIER à mordre en vrai — le REGISTRE. La coquille lit le nom DANS le
 *     plan (`svgDeLIcone(plan.noJobIcon, …)`), donc renommer vers une valeur
 *     inconnue fait lever `contenuDeLICone` AVANT même que le corps ne soit bâti.
 *     Relevé le 26/09/2026 : `noJobIcon: 'promiseFindWork'` → `'…Renomme'` fait
 *     sortir `npm run build` en **1** sur « page-icons : l'icône
 *     « promiseFindWorkRenomme » n'est pas déclarée dans le registre — un plan ne
 *     peut pas dessiner une icône qui n'existe pas. » (restauré, empreinte SHA-1
 *     de `page-sections.js` identique).
 *
 *   • le SECOND — `vite-plugins/prerender/declared-body.js`, `exigerCorpsDeclare`
 *     — pour la coquille qui cesse de DESSINER une icône pourtant déclarée (nom
 *     valide au registre, mais AUCUN repère `data-icone` dans le corps) :
 *     « la coquille … ne dessine pas … icône(s) … « X » manque ». C'est lui qui
 *     nomme la COQUILLE, là où le registre nomme le PLAN. Le registre ne peut pas
 *     le remplacer : il ne regarde QUE le nom, jamais ce que la coquille publie.
 */
import { describe, expect, it } from 'vitest';
import { makeDeclaredBodyGuard } from '../../vite-plugins/prerender/declared-body.js';
import { contenuDeLICone, marqueurDIcone, NOMS_D_ICONES } from '../../src/config/page-icons.js';
import { PAGE_SECTIONS, pageSectionParts } from '../../src/config/page-sections.js';

/** Un garde monté sur un plan SYNTHÉTIQUE : seul le champ `*Icon` compte ici. */
const gardeAvec = (plan) =>
  makeDeclaredBodyGuard({
    esc: (texte) => String(texte),
    T: (cle) => cle,
    registerT: (cle) => cle,
    jobsT: (cle) => cle,
    pageSections: { '/payment': plan },
    pageSectionParts,
  });

describe('forme `*Icon` — preuve d’échec rejouée', () => {
  it('renommer un `*Icon` du plan vers un nom inconnu fait lever le REGISTRE', () => {
    // C'est le refus qui mord en premier au build : la coquille lit le nom dans
    // le plan, donc le nom renommé est résolu AVANT que le corps ne soit composé.
    expect(() => contenuDeLICone('promiseFindWorkRenomme')).toThrow(
      /déclarée dans le registre/
    );
    // Le contrôle qui donne son sens au rouge : le nom d'origine, lui, existe.
    expect(() => contenuDeLICone('promiseFindWork')).not.toThrow();
  });

  it('une coquille qui ne dessine plus une icône déclarée est refusée, en la nommant', () => {
    // La mutation EXACTE : l'icône est renommée dans le plan, la coquille N'EST
    // PAS touchée — elle porte encore le repère de l'ANCIEN nom.
    const garde = gardeAvec({ noJobIcon: 'promiseFindWorkRenomme' });
    const corpsInchange = `<div>${marqueurDIcone('promiseFindWork')}</div>`;

    let erreur;
    try {
      garde('/payment', 'payment', corpsInchange);
    } catch (e) {
      erreur = e;
    }
    expect(erreur?.message).toContain('ne dessine pas');
    expect(erreur?.message).toContain('promiseFindWorkRenomme');
    expect(erreur?.message).toContain(marqueurDIcone('promiseFindWorkRenomme'));
    expect(erreur?.message).toContain('la coquille');
  });

  it('la coquille qui dessine l’icône déclarée passe — le refus n’est pas un refus de principe', () => {
    // Contrôle positif : la même coquille, l'icône au bon nom, ne lève pas. Sans
    // lui, le cas négatif ne prouverait pas que le repère `data-icone` est bien
    // ce que le garde exige.
    const garde = gardeAvec({ noJobIcon: 'promiseFindWork' });
    expect(() =>
      garde('/payment', 'payment', `<div>${marqueurDIcone('promiseFindWork')}</div>`)
    ).not.toThrow();
  });

  it('le plan RÉEL ne déclare aucune icône absente du registre', () => {
    // Le contrôle de l'arbre réel : il garantit que le refus ci-dessus décrit une
    // mutation, jamais un état de départ déjà rouge.
    const declarees = new Set();
    for (const plan of Object.values(PAGE_SECTIONS)) {
      for (const nom of pageSectionParts(plan).icones) declarees.add(nom);
    }
    // 31 noms DISTINCTS mesurés le 26/09/2026 (45 occurrences avant dédoublonnage,
    // cf. `check-shell-text-provenance.test.js`) : le plancher prouve que la
    // boucle a lu le vrai plan, sans se figer sur une valeur exacte.
    expect(declarees.size).toBeGreaterThanOrEqual(30);
    expect([...declarees].filter((nom) => !NOMS_D_ICONES.includes(nom))).toEqual([]);
  });
});
