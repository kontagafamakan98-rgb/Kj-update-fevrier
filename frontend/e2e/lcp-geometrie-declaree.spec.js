import { test, expect } from '@playwright/test';
import { TAILLES, MARQUEUR_DE_MONTAGE, attendreLaPolice, attendreLaStabilite } from './helpers/geometrie.js';
// Le plan est LE propriétaire de la géométrie du plus grand texte (voir le
// fichier et `scripts/__tests__/check-lcp-geometrie.test.js`) : cette sonde le
// lit au lieu de recopier les classes attendues, sinon elle vérifierait sa
// propre copie — le défaut exact qu'elle existe pour fermer.
import { PAGE_SECTIONS } from '../src/config/page-sections.js';

/**
 * Le LCP de ces quatre routes reste la PEINTURE DE LA COQUILLE, et c'est
 * l'élément que le plan DÉCLARE.
 *
 * ── Ce que cette sonde ajoute à celle de /contact, et à la sonde générale ───
 * `e2e/contact-lcp.spec.js` mesure le FAIT sur /contact (une seule candidate, à
 * l'instant du premier paint) ; `e2e/lcp-geometrie.spec.js` mesure TOUTES les
 * routes (React ne peint pas plus grand que la coquille). Ni l'une ni l'autre
 * ne dit QUELLE classe le navigateur a élue : deux éléments de même aire
 * passeraient, et le jour où ils divergeraient, la cause — une géométrie
 * recopiée dans un canal au lieu d'être lue — ne serait plus nommée nulle part.
 *
 * Ici, l'assertion est l'IDENTITÉ : l'élément élu porte exactement l'ensemble de
 * classes que `src/config/page-sections.js` déclare pour cette route, et il est
 * horodaté au premier paint. C'est la signature de « la coquille a gagné »,
 * doublée de la preuve que le propriétaire unique couvre bien l'élément réel.
 *
 * ── Le mécanisme, mesuré (Chrome 152, pile de la CI, 25/09/2026) ────────────
 * Deux navigations, 412×823 et 1350×940, bundle d'entrée BLOQUÉ pour la
 * coquille et navigation réelle pour React :
 *
 *   /jobs           <p> l'introduction          35 640 (mobile) / 36 002 px²
 *   /about          <p> l'introduction          74 466 / 80 262 px²  ← PÉRIMÉ
 *   /privacy        <p> le CORPS d'une section  84 360 / 86 676 px²
 *   /how-it-works   <p> le sous-titre du héros   30 320 / 32 656 px²
 *
 * ── RELEVÉ DU 20/10/2026 : LE PLAN PAR ROUTE, TITRAGE ANIMÉ ────────────────
 * Même sonde, une seule candidate horodatée au premier paint, les DEUX tailles
 * (412×823 / 1350×940). La valeur citée est la TAILLE LCP (celle que le plancher
 * borne), l'élément élu est celui que `lcpChamp`/`lcpColonne` désigne :
 *
 *   route              élu                                   mobile / desktop
 *   /jobs              <p> intro (`introClass`)                37 240 / 34 960
 *   /about             <div> LA COLONNE DU CHROME (lcpColonne) 191 786 / 196 500
 *   /privacy           <p> corps de section                     91 140 / 103 896
 *   /how-it-works      <p> sous-titre du héros                  33 642 / 36 480
 *   /login             <p> ligne légale                        13 489 / 15 087
 *   /register          <p> notice d'étape                      12 972 / 10 624
 *   /forgot-password   <p> sous-titre                          13 690 / 16 021
 *   /support           <p> sous-titre / <span> titre d'entrée  16 632 /  9 648
 *   /payment           <p> corps « mission requise »            31 350 / 34 506
 *
 * Les relevés plus bas restent comme HISTOIRE : ils ont appris que l'encre d'un
 * texte suit les polices de l'hôte (d'où les planchers), et leurs dates disent
 * de quel dessin ils parlaient.
 *
 * ── Et le 26/09/2026, les quatre routes restantes ───────────────────────────
 * Même sonde, navigation RÉELLE : l'élément élu y est un paragraphe SECONDAIRE
 * (ligne légale, notice d'étape, sous-titres), mesuré sur 412×823 et 1350×940 :
 * /login (10 848 / 12 448 px²), /register (10 048 / 12 544), /forgot-password
 * (14 001 / 16 458) et /support (16 468 / 9 324).
 * (La notice d'étape de /register est passée de 10 560 à 10 048 px² mobile le
 * 26/09/2026 : son ⚠️ emoji est devenu un SVG, et la ligne se replie un cran
 * plus bas — même élément élu, aire légèrement plus petite.)
 *
 * ── LE LCP DE /about EST UN CONTENEUR, ET C'EST MAINTENANT VOULU (20/10/2026) ─
 * Re-mesuré ici, 412×823 et 1350×940 : le navigateur élit la COLONNE DU CHROME
 * (`min-h-screen fond-sable relative flex flex-col`, `COLONNE_CLASS` de
 * `src/config/classes-chrome.js` — 191 786 / 196 500 px²) au premier paint, et
 * non le paragraphe d'introduction. Ce n'est PAS l'effet cinétique du titrage : sous
 * `prefers-reduced-motion: reduce` — la feuille éteint alors le reflet, donc un
 * titre redevient un texte peint — la colonne est élue à l'identique (mesure
 * A/B de la même journée, même pile). Un conteneur de 191 786 px² est la plus
 * grande peinture de la page, titre animé ou non.
 *
 * La décision (20/10/2026) est donc d'ACCEPTER l'élection et de la DÉCLARER, au
 * lieu de la combattre : chaque plan de route publique nomme désormais l'élément
 * élu — par le nom d'un de ses champs (`lcpChamp`), ou en citant la colonne du
 * chrome à son domicile (`lcpColonne: COLONNE_CLASS`) — et cette sonde LIT cette
 * déclaration, elle n'en garde plus de copie. Le tableau ci-dessous ne porte donc
 * plus que la route et son plancher.
 *
 * Ce que la garantie devient sur /about, dit franchement : « React ne peint pas
 * plus grand que la coquille » porte sur la COLONNE entière (191 786 px² des
 * deux côtés, puisqu'elle vient de la même `COLONNE_CLASS`), plus sur le paragraphe —
 * un texte du corps pourrait donc grandir sans ré-élire d'élément. Le COÛT de
 * la chaîne JavaScript reste jugé séparément, par les budgets LCP par route
 * (`scripts/lcp-app-budgets.cjs`) et `e2e/lcp-app.spec.js`.
 *
 * ── DEUX VISITES, ET POURQUOI (20/10/2026, mesuré) ──────────────────────────
 * `font-display: swap` PEINT DEUX FOIS : sur un cache de police VIDE, la
 * coquille peint le texte avec le repli, le fichier arrive, et le MÊME élément
 * est repeint. Mesuré sur /jobs mobile (412×823), navigateur neuf :
 *
 *   t=336 ms  taille=36 750 px²  aire=39 520 px²  <P>  (repli)  ← premier paint
 *   t=552 ms  taille=37 240 px²  aire=39 520 px²  <P>  (Inter)  ← +1,3 % d'encre
 *
 * Même élément, mêmes classes, même BOÎTE : c'est le fichier de police, pas
 * React. Une sonde qui exige « une seule candidate » sur cette visite-là rougit
 * donc au hasard du moment où le fichier arrive — et elle mesure un fait qui
 * n'est pas son sujet (le coût du fichier est jugé par le CLS de police et par
 * Lighthouse).
 *
 * Ce parcours fait donc DEUX visites, et les juge toutes les deux :
 *   1. FROIDE — la première, cache vide. Elle prouve que la COQUILLE a gagné
 *      (première candidate au premier paint) et que la seconde peinture, quand
 *      elle existe, est la MÊME peinture repeinte par la police : mêmes
 *      classes, même boîte, et le fichier de police terminé ENTRE les deux.
 *      Une seconde peinture de même boîte sans fichier de police entre les
 *      deux est un REPEINT de React et rougit.
 *   2. CHAUDE — la seconde, police en cache : le verdict STRICT d'avant, une
 *      seule candidate au premier paint, c'est-à-dire ce que mesure un
 *      visiteur qui revient — et ce que la bascule coquille → React doit
 *      produire.
 *
 * ── LES PLANCHERS, ET CE QUE LA POLICE SERVIE LEUR A FAIT (26/09/2026) ──────
 * Première leçon, mesurée : l'aire de l'ENCRE d'un texte n'est pas portable, elle
 * suit les polices de l'hôte. Le MÊME document, mêmes classes, même élément élu,
 * mesuré sur le runner Linux de la CI (run 36254013043, Chrome 152) : /jobs
 * 35 055 / 30 874, /about 73 340 / 78 208, /privacy 83 058 / 83 400,
 * /how-it-works 27 056 / 30 240, /login 10 290 / 12 120, /register 9 796 /
 * 12 183, /forgot-password 13 104 / 15 336 et /support 15 120 / 7 616 — jusqu'à
 * −18 % de ce poste-ci, alors que la BOÎTE de l'élément ne bouge pas (16 380 px²
 * pour le sous-titre de /support des deux côtés : c'est l'encre qui change, pas
 * le cadre). Des planchers calés à 1 ou 3 % sous le relevé d'UN SEUL hôte
 * (/forgot-password mobile : 13 000 pour 13 104 mesurés ici ; /support desktop :
 * 9 000 pour 7 616 là-bas) ne bornaient pas la page, ils bornaient la MACHINE.
 *
 * Deuxième leçon, et c'est le remède : depuis que `src/index.css` sert Inter et
 * que toutes les pages la préchargent, LES DEUX HÔTES RENDENT LA MÊME POLICE.
 * Les valeurs ci-dessus décrivent l'artefact d'AVANT (police du système) et sont
 * gardées comme histoire ; les planchers sont re-calés sur les DEUX tailles
 * re-mesurées avec la police servie, chaque route en commentaire de sa ligne.
 * Relevé du 26/09/2026 (une seule candidate au premier paint, élément élu et
 * classes inchangés sur les 8 routes) : /jobs 36 750 / 35 144, /about 82 940 /
 * 79 540, /privacy 91 630 / 100 788, /how-it-works 26 334 / 32 928, /login
 * 15 040 / 12 834, /register 9 548 / 12 338, /forgot-password 13 690 / 16 095 et
 * /support 16 720 / 9 480 — la police servie est un peu plus large que celle de
 * ce poste-ci, donc l'encre monte (sauf /how-it-works, /register et
 * /forgot-password, qui perdent quelques centaines de px² au re-pli).
 *
 * Chaque plancher vaut ≈ 70 % de la PLUS PETITE DES DEUX tailles servies : une
 * seule police pour tous les hôtes, donc plus de marge à prendre pour couvrir un
 * écart de police — c'est exactement ce que l'auto-hébergement a acheté.
 *
 * CE QUE CE PLANCHER EST, ET CE QU'IL N'EST PAS (mesuré le 26/09/2026) : une
 * borne de SANITY, pas le discriminateur de l'identité. Sonde d'atelier
 * (`_sonde-plancher.spec.js` : feuille injectée dans le <head> servi, avant le
 * premier paint) — quand l'élément DÉCLARÉ est rendu minuscule, le plus grand
 * texte qui reste vaut encore 12 285 px² (/support mobile), 9 025 (/support
 * desktop) et 11 480 (/forgot-password) : aucun plancher ne peut donc trancher
 * « le bloc déclaré est là » de « un autre texte a pris sa place ». Ce qui
 * tranche, c'est l'IDENTITÉ ci-dessous — l'élément élu doit porter l'ensemble de
 * classes du plan — et `e2e/lcp-geometrie.spec.js` (une seule candidate, de la
 * géométrie de la coquille). Le plancher, lui, refuse un premier paint vidé de
 * sa matière : c'est pour ça qu'il peut être bas sans être un faux vert.
 *
 * UNE SEULE candidate dans les deux canaux, au premier paint, d'aire IDENTIQUE :
 * la peinture de la coquille reste celle que Chrome retient, et rien du
 * JavaScript n'entre dans le graphe LCP simulé de Lantern. Un remplacement PLUS
 * GRAND, lui, ré-élit un élément (mesuré sur /jobs avant correctif :
 * `elementRenderDelay` de 1156 à 2345 ms, score desktop 92 au lieu de 100).
 */
const ROUTES_DECLAREES = [
  // Plancher ≈ 0,7 × la plus petite des deux tailles ; mesures en commentaire, en
  // px², MOBILE / DESKTOP, police servie par le site (26/09/2026).
  { route: '/jobs', plancher: 24000 }, // 37 240 / 34 960 (20/10/2026)
  // /about : la COLONNE DU CHROME est l'élément élu depuis le 20/10/2026 (voir
  // en tête) — 191 786 / 196 500 px². Le plancher vaut ≈ 60 % de la plus petite
  // des deux tailles, la règle du fichier ; il attrape une colonne vidée de son
  // corps sans devenir un test de police (l'aire d'un bloc ne suit pas les
  // polices de l'hôte).
  { route: '/about', plancher: 115000 }, // 191 786 / 196 500, `lcpColonne`
  // Sur cette page, le plus grand texte peint est un CORPS de section : c'est
  // `sectionBodyClass` qui porte l'élément élu, pas l'introduction.
  { route: '/privacy', plancher: 64000 }, // 91 140 / 103 896 (20/10/2026)
  // Re-mesuré le 28/09/2026 au port du vocabulaire éditorial : 29 260 / 32 830
  // px² (la veille : 26 334 / 32 928 — le mobile gagne de l'encre parce que le
  // paragraphe remonte entièrement au-dessus de la ligne de flottaison, voir le
  // commentaire du plan). Re-mesuré le 07/10/2026 : **33 642 / 36 480 px²**,
  // après `text-lg` → `text-xl leading-relaxed` (décision mesurée, voir le plan
  // de /how-it-works) : à 29 260 px² la marge sur la plus grande note d'étape
  // n'était que de 1,5 % à 397 px de mise en page, et un runner Linux — barre de
  // défilement classique, 15 px de moins — faisait élire la note au lieu du
  // sous-titre, deux fois de suite. Le plancher reste à 18 000 : il vaut ≈ 53 %
  // du plus petit des deux relevés, donc il attrape une page vidée de son texte
  // sans devenir un test de police.
  { route: '/how-it-works', plancher: 18000 }, // 33 642 / 36 480 (inchangé le 20/10/2026)
  // Le plus grand texte peint de ces quatre pages est un paragraphe secondaire,
  // pas le titre : ligne légale de /login, notice d'étape de /register,
  // sous-titres de /forgot-password et de /support (voir la mesure en tête).
  { route: '/login', plancher: 8900 }, // 13 489 / 15 087 (20/10/2026)
  { route: '/register', plancher: 6600 }, // 12 972 / 10 624 (20/10/2026)
  { route: '/forgot-password', plancher: 9500 }, // 13 690 / 16 021 (20/10/2026)
  // /support a DEUX élus selon la taille depuis le 28/09/2026 : en mobile le
  // sous-titre du héros, en desktop le TITRE d'entrée de la première carte, qui
  // passe devant depuis que les titres d'entrée ont pris l'échelle serif
  // (1,25 rem contre 1 rem : le plus grand texte peint a changé de camp). Le
  // plan déclare LES DEUX — le sujet et le titre d'entrée — et c'est LUI qui
  // nomme l'élu de chaque taille (`lcpChamp: { mobile, desktop }`) ; la sonde
  // le lit et ne garde aucune copie, sans quoi elle accuserait le canal
  // d'avoir recopié une classe alors que c'est le plan qui en a deux.
  // Les deux planchers valent ≈ 62 % de LEUR relevé, chacun à sa taille (la
  // règle du fichier) : 10 000 pour 16 632 px² en mobile, 5 900 pour 9 648 px²
  // en desktop. Un plancher unique aurait dû descendre à celui du desktop, donc
  // n'aurait plus attrapé une page mobile vidée de son texte.
  {
    route: '/support',
    plancher: { mobile: 10000, desktop: 5900 },
  },
  // /payment, re-mesuré le 17/10/2026 au port du vocabulaire d'écran : le plus
  // grand texte peint est le CORPS de la carte « mission requise » — l'état par
  // défaut, celui que la coquille publie — et non le titre ni le sous-titre de
  // la bande. Taille LCP re-mesurée le 20/10/2026 (412×823 et 1350×940) :
  // 31 350 px² en mobile, 34 506 px² en desktop.
  // Le plancher vaut ≈ 60 % du plus petit des deux, comme les autres pages
  // pré-rendues : il attrape une page vidée de son texte sans devenir un test
  // de police. Le repli de `<Suspense>` ne la mesure pas — il ne publie aucun
  // `<h1>` ni ce corps (voir `PaymentSkeleton`) — donc la candidate reste
  // unique, horodatée au premier paint.
  { route: '/payment', plancher: 20000 },
];

/**
 * Observateur installé AVANT la navigation : chaque candidate
 * `largest-contentful-paint` est enregistrée avec son horodatage, la taille qui
 * a servi à l'élire, les classes de son élément et son aire — de quoi NOMMER la
 * peinture fautive dans un message d'échec — plus le premier paint, auquel le
 * LCP de la coquille doit être horodaté.
 */
const ESPION_LCP = () => {
  window.__kojoLcp = { candidates: [], fcp: null, polices: [] };
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      const el = entree.element;
      const rect = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      window.__kojoLcp.candidates.push({
        debut: +entree.startTime.toFixed(1),
        taille: entree.size,
        balise: el ? el.tagName : '?',
        classes: el && typeof el.className === 'string' ? el.className : '(sans classe)',
        aire: rect ? +(rect.width * rect.height).toFixed(1) : null,
        texte: el ? String(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) : '',
      });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      if (entree.name === 'first-contentful-paint') window.__kojoLcp.fcp = +entree.startTime.toFixed(1);
    }
  }).observe({ type: 'paint', buffered: true });
  // Les fichiers de POLICE, horodatés : c'est ce qui permet de dire si une
  // seconde peinture de la même boîte est le `swap` (le fichier est arrivé
  // entre les deux) ou un repeint de React (il n'est pas arrivé).
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      if (!/\/fonts\//.test(entree.name)) continue;
      window.__kojoLcp.polices.push({
        fichier: entree.name.split('/').pop(),
        debut: +entree.startTime.toFixed(1),
        fin: +entree.responseEnd.toFixed(1),
        // 0 = servi depuis le cache : ce fichier-là n'explique PAS une peinture
        // de cette visite (il était déjà là avant elle).
        octets: entree.transferSize || 0,
      });
    }
  }).observe({ type: 'resource', buffered: true });
};

/** L'ensemble des classes d'une chaîne, pour comparer sans dépendre de l'ordre. */
const ensembleDeClasses = (valeur) =>
  [...new Set(String(valeur || '').split(/\s+/).filter(Boolean))].sort().join(' ');

test.describe('Parcours E2E — le LCP déclaré de chaque route reste la peinture de la coquille', () => {
  test.describe.configure({ mode: 'serial' });

  for (const entree of ROUTES_DECLAREES) {
    const { route } = entree;
    for (const { nom: taille, viewport } of TAILLES) {
      // L'ÉLÉMENT ÉLU est LU dans le plan : soit le nom d'un de ses champs
      // (`lcpChamp`, éventuellement `{ mobile, desktop }` quand le plus grand
      // texte change de camp selon la taille), soit la colonne du chrome, citée
      // à son domicile (`lcpColonne`). La sonde ne garde aucune copie de ce que
      // le navigateur devrait élire, sinon elle vérifierait sa propre copie.
      const plan = PAGE_SECTIONS[route];
      const nomChamp = plan?.lcpChamp;
      const champ = typeof nomChamp === 'string' ? nomChamp : nomChamp?.[taille];
      const declare = champ ? plan?.[champ] : plan?.lcpColonne;
      const etiquette = champ ? `lcpChamp → ${champ}` : 'lcpColonne';
      const plancher = typeof entree.plancher === 'number' ? entree.plancher : entree.plancher[taille];
      test(`${route} — ${taille} : l'élément élu porte la géométrie déclarée (${etiquette})`, async ({ browser }) => {
        expect(
          declare,
          `${route} : le plan ne déclare plus l'élément élu (\`lcpChamp\` ou \`lcpColonne\`) — la ` +
            "géométrie de sa plus grande peinture n'a plus de propriétaire, donc cette sonde ne peut " +
            'plus rien vérifier'
        ).toBeTruthy();

        const page = await browser.newPage({ viewport });
        try {
          await page.addInitScript(ESPION_LCP);

          const decrire = (c) =>
            `t=${c.debut} ms, taille=${c.taille} px², <${c.balise}> aire=${c.aire} px² ` +
            `[${c.classes}] « ${c.texte} »`;

          // ── VISITE 1 — FROIDE : la coquille a gagné, et le `swap` EXPLIQUÉ ─
          // Cache de police vide : c'est ici que le repli peint, puis le fichier
          // arrive et repeint. Cette visite n'exige donc pas UNE candidate —
          // elle vérifie que la seconde, quand elle existe, est la MÊME peinture
          // (mêmes classes, même boîte) et qu'un fichier de POLICE l'explique.
          await page.goto(route);
          await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
          // La police finit d'arriver ICI : on laisse le `swap` se produire, puis
          // on lit — la visite mesurée suivante la trouvera en cache.
          await attendreLaPolice(page);
          await attendreLaStabilite(page);
          const froid = await page.evaluate(() => window.__kojoLcp);

          expect(
            froid.fcp,
            `${route} (${taille}) : aucun premier paint relevé sur la visite froide — le relevé ne peut rien prouver`
          ).not.toBeNull();
          expect(
            froid.candidates.length,
            `${route} (${taille}) : la visite froide n'a peint aucun élément LCP — la coquille n'a rien publié`
          ).toBeGreaterThan(0);

          for (const peinture of froid.candidates) {
            expect(
              ensembleDeClasses(peinture.classes),
              `${route} (${taille}) : la visite froide a élu <${peinture.balise}> « ${peinture.texte} » ` +
                `[${peinture.classes}], qui n'est pas l'élément déclaré (${etiquette} = ${declare}). ` +
                `Relevé : ${froid.candidates.map(decrire)}`
            ).toBe(ensembleDeClasses(declare));
            expect(
              `${peinture.balise}|${peinture.aire}`,
              `${route} (${taille}) : la visite froide a peint DEUX géométries différentes pour l'élément ` +
                `déclaré — une boîte qui bouge n'est pas un remplacement de police, c'est une divergence ` +
                `entre les deux canaux. Relevé : ${froid.candidates.map(decrire)}`
            ).toBe(`${froid.candidates[0].balise}|${froid.candidates[0].aire}`);
          }

          expect(
            froid.candidates[0].debut,
            `${route} (${taille}) : sur la visite froide, le LCP n'est pas le premier paint — la première ` +
              'peinture vient donc du JavaScript, pas de la coquille'
          ).toBe(froid.fcp);

          expect(
            froid.candidates.length,
            `${route} (${taille}) : la visite froide a peint ${froid.candidates.length} fois le même ` +
              `élément — ni la coquille ni le remplacement de police n'en expliquent une troisième. ` +
              `Relevé : ${froid.candidates.map(decrire)}`
          ).toBeLessThanOrEqual(2);

          let swapPar = [];
          if (froid.candidates.length === 2) {
            // Le fichier qui EXPLIQUE la seconde peinture : des OCTETS sont
            // arrivés pendant CETTE visite (`transferSize > 0`), et ils étaient
            // là avant le repaint. Pas de fenêtre plus étroite : mesuré le
            // 20/10/2026 (sonde d'atelier, police retardée de 150 ms, /jobs
            // mobile), Inter finit
            // à t=196 ms, la coquille peint à 248 ms, et le repaint n'arrive
            // qu'à 376 ms — l'application d'une police suit son téléchargement
            // d'un repaint, pas d'une milliseconde. Ce qui reste refusé : deux
            // peintures alors qu'AUCUN octet de police n'est arrivé (React a
            // repeint), et tout désaccord de classes ou de boîte ci-dessus.
            const duSwap = froid.polices.filter(
              (p) => p.octets > 0 && p.fin <= froid.candidates[1].debut
            );
            swapPar = duSwap.map((p) => p.fichier);
            expect(
              duSwap.map((p) => p.fichier),
              `${route} (${taille}) : deux peintures du MÊME élément, mais aucun octet de police n'a ` +
                `été téléchargé avant la seconde (t=${froid.candidates[1].debut} ms) — la seconde n'est ` +
                "donc pas un `swap` : c'est React qui a repeint l'élément élu.\n" +
                `      fichiers : ${froid.polices.map((p) => `${p.fichier} ${p.debut}→${p.fin} (${p.octets} o)`).join(', ') || 'aucun'}`
            ).not.toHaveLength(0);
          }

          const derniereFroide = froid.candidates[froid.candidates.length - 1];
          expect(
            derniereFroide.taille,
            `${route} (${taille}) : même sur la visite froide, l'élément déclaré est trop petit ` +
              `(${derniereFroide.taille} px² pour un plancher de ${plancher}) — la page n'a plus de bloc ` +
              'assez grand au premier paint'
          ).toBeGreaterThan(plancher);

          // ── VISITE 2 — CHAUDE : le verdict STRICT (police en cache) ──────
          await page.goto(route);
          // Laisse le temps à createRoot, à la reconstruction de la page et au
          // repaint : une seconde candidate, si elle existe, apparaîtrait lors du montage.
          await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
          await attendreLaStabilite(page);
          const releve = await page.evaluate(() => window.__kojoLcp);

          expect(
            releve.fcp,
            `${route} (${taille}) : aucun premier paint relevé — le relevé ne peut rien prouver`
          ).not.toBeNull();

          // ── La garantie : UNE candidate, horodatée au premier paint ──────
          expect(
            releve.candidates.map(decrire),
            `${route} (${taille}) : React a peint un élément PLUS GRAND que la coquille — le repaint devient ` +
              "l'élément LCP et toute la chaîne JavaScript se fait facturer. Corriger la GÉOMÉTRIE, pas le " +
              'repaint : les classes de l\'élément LCP doivent rester lues dans src/config/page-sections.js.\n' +
              `      déclaré par le plan (${etiquette}) : ${declare}`
          ).toHaveLength(1);

          const candidate = releve.candidates[0];
          expect(
            candidate.debut,
            `${route} (${taille}) : le LCP n'est plus le premier paint — il est peint après coup, donc par le ` +
              'JavaScript'
          ).toBe(releve.fcp);

          // ── L'IDENTITÉ : l'élément élu EST celui que le plan déclare ─────
          expect(
            ensembleDeClasses(candidate.classes),
            `${route} (${taille}) : le navigateur a élu <${candidate.balise}> « ${candidate.texte} » ` +
              `[${candidate.classes}], qui n'est pas l'élément déclaré par le plan (${etiquette} = ${declare}). ` +
              'Une classe recopiée dans un canal au lieu d\'être lue dans le plan produit exactement ceci : ' +
              'un élément élu que le propriétaire unique ne décrit pas.'
          ).toBe(ensembleDeClasses(declare));

          expect(
            candidate.taille,
            `${route} (${taille}) : l'élément LCP déclaré est trop petit pour être le plus grand texte peint `
              + `(${candidate.taille} px² pour un plancher de ${plancher}) — la page n'a plus de bloc `
              + 'assez grand au premier paint, et le plus grand texte devient celui d\'un état asynchrone'
          ).toBeGreaterThan(plancher);

          // Un vert sans chiffre ne prouve rien (règle du dépôt) : la mesure est
          // publiée, élément, classes, aire et horodatage compris.
          console.log(
            `ℹ️  LCP déclaré ${route} (${taille}) : <${candidate.balise}> « ${candidate.texte} » ` +
              `taille=${candidate.taille} px² aire=${candidate.aire} px², une seule candidate au premier ` +
              `paint (${releve.fcp} ms), classes = celles du plan (${etiquette}) — ` +
              `visite froide : ${froid.candidates.length} peinture(s)` +
              (froid.candidates.length === 2
                ? ` (repli ${froid.candidates[0].taille} → police ${froid.candidates[1].taille} px², boîte ${froid.candidates[0].aire} px², fichier(s) de police arrivé(s) avant le repaint : ${swapPar.join(', ')})`
                : ' (police déjà en cache)')
          );
        } finally {
          await page.close();
        }
      });
    }
  }
});
