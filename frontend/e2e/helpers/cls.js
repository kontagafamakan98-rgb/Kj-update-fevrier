/**
 * LE CLS MESURÉ EN NAVIGATEUR, avec la source de chaque décalage.
 *
 * ── Pourquoi cette mesure, alors que la CI a déjà un budget CLS ─────────────
 * `scripts/lhci-cls-budgets.cjs` porte un plafond PAR ROUTE, mais Lighthouse CI
 * ne rend qu'un CHIFFRE par route (médiane de 3 runs) : quand il rougit, il ne
 * dit pas quel élément a bougé, ni si le décalage vient du montage de React ou
 * de la coquille elle-même. Cette sonde mesure la même grandeur — le CLS, avec
 * le même algorithme de fenêtre de session que Chrome (voir ci-dessous) — sur
 * DEUX navigations de la même route, à 412×823 et 1350×940, et elle publie les
 * sources : nœud, rectangle avant, rectangle après. C'est la moitié qui rend un
 * rouge réparable.
 *
 * ── Le CLS n'est pas la somme des décalages ────────────────────────────────
 * Depuis Chrome 77, Lighthouse n'additionne plus les `layout-shift` d'une page :
 * il découpe le chargement en FENÊTRES DE SESSION (des décalages à moins d'une
 * seconde l'un de l'autre, sur au plus 5 s) et retient la PLUS GRANDE fenêtre.
 * Une page qui bouge une fois à 0,05 puis une fois, 3 s plus tard, à 0,06 vaut
 * 0,06, pas 0,11. Additionner ferait rougir un artefact sain — et une sonde qui
 * rougit à tort finit ignorée. L'algorithme est donc réécrit ici, avec sa règle
 * (1 000 ms entre deux décalages, 5 000 ms de fenêtre) : les deux constantes sont
 * celles de Chrome, pas des réglages.
 *
 * ── Ce que l'observateur enregistre, et le tri qu'il fait ──────────────────
 * Un `layout-shift` porte `value` (la fraction de viewport déplacée, pondérée par
 * la distance) et `sources` (les nœuds déplacés). Deux tris sont faits DANS la
 * page :
 *   • `hadRecentInput` est ÉCARTÉ : le CLS mesure la stabilité d'un chargement,
 *     pas la réaction à un clic, et ces navigations n'ont aucune interaction ;
 *   • les décalages sans source identifiable (nœud détaché) sont CONSERVÉS : ils
 *     comptent dans le CLS, il faut donc pouvoir les nommer tels quels plutôt que
 *     de les perdre.
 *
 * ── Pourquoi le premier rendu n'est PAS gelé ici ───────────────────────────
 * `gelerLePremierRendu` (harnais de géométrie) empêche React de changer d'état,
 * pour comparer deux PEINTURES. Ici ce serait une faute : le budget CLS de la CI
 * est mesuré AVEC les changements d'état du visiteur réel — sur /register, la
 * détection de géolocalisation qui échoue remplace « Détection de votre
 * position… » par « Position non détectée » et déplace le formulaire, et c'est
 * exactement ce décalage que le budget de 0,015 couvre. Geler l'état mesurerait
 * une page plus sage que celle qu'on sert.
 */

/** Une fenêtre de session se ferme après 1 000 ms sans décalage (règle Chrome). */
export const FENETRE_ENTRE_DECALAGES_MS = 1000;

/** Une fenêtre de session dure au plus 5 000 ms (règle Chrome). */
export const FENETRE_SESSION_MAX_MS = 5000;

/** Combien de sources on nomme dans un message d'échec (le reste est compté). */
export const SOURCES_NOMMEES = 3;

/**
 * L'observateur, installé AVANT la navigation (`addInitScript`) et avec
 * `buffered: true` : sans cela, les décalages du premier paint — ceux du
 * montage de React — seraient enregistrés avant que l'observateur ne les écoute,
 * et la mesure ne verrait que la traîne.
 */
export const ESPION_CLS = () => {
  window.__kojoCls = { decalages: [], fcp: null, url: null };
  const rect = (r) =>
    r
      ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), l: +r.width.toFixed(1), h: +r.height.toFixed(1) }
      : null;
  const nommer = (noeud) => {
    if (!noeud) return null;
    const classes =
      noeud.className && typeof noeud.className === 'string' ? `.${noeud.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
    const texte = noeud.textContent ? String(noeud.textContent).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    return { balise: noeud.nodeName ? noeud.nodeName.toLowerCase() : '?', classes, texte };
  };
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      // Le CLS mesure la stabilité du CHARGEMENT : un décalage provoqué par une
      // interaction n'en fait pas partie (et ces navigations n'interagissent pas).
      if (entree.hadRecentInput) continue;
      window.__kojoCls.decalages.push({
        debut: +entree.startTime.toFixed(1),
        valeur: entree.value,
        sources: (entree.sources || []).map((source) => ({
          noeud: nommer(source.node),
          avant: rect(source.previousRect),
          apres: rect(source.currentRect),
        })),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      if (entree.name === 'first-contentful-paint') window.__kojoCls.fcp = +entree.startTime.toFixed(1);
    }
  }).observe({ type: 'paint', buffered: true });
};

/**
 * Le CLS d'un relevé : la plus GRANDE fenêtre de session, comme Chrome.
 *
 * @param {Array<{debut: number, valeur: number, sources: Array<object>}>} decalages
 *   Les décalages relevés, dans l'ordre d'arrivée.
 * @returns {{cls: number, fenetres: Array<{debut: number, dernier: number, valeur: number, nombre: number}>, total: number, plusGrand: object|null}}
 *   Le CLS, les fenêtres (pour dire si la valeur vient d'une rafale ou de
 *   plusieurs), la somme brute (jamais comparée à un budget : elle sert à
 *   montrer, quand le CLS est sous le budget, que la page a bien bougé) et le
 *   plus grand décalage unitaire (celui qu'on nomme dans un message d'échec).
 */
export function clsDesDecalages(decalages = []) {
  const tries = [...decalages].sort((a, b) => a.debut - b.debut);
  const fenetres = [];
  let courante = null;
  for (const decalage of tries) {
    if (
      !courante ||
      decalage.debut - courante.dernier > FENETRE_ENTRE_DECALAGES_MS ||
      decalage.debut - courante.debut > FENETRE_SESSION_MAX_MS
    ) {
      courante = { debut: decalage.debut, dernier: decalage.debut, valeur: 0, nombre: 0 };
      fenetres.push(courante);
    }
    courante.valeur += decalage.valeur;
    courante.dernier = decalage.debut;
    courante.nombre += 1;
  }
  const total = tries.reduce((somme, decalage) => somme + decalage.valeur, 0);
  const plusGrand = tries.reduce((max, decalage) => (!max || decalage.valeur > max.valeur ? decalage : max), null);
  const cls = fenetres.reduce((max, fenetre) => Math.max(max, fenetre.valeur), 0);
  return { cls, fenetres, total, plusGrand };
}

/** Le rectangle d'une source, en une ligne lisible. */
const BOITE = (r) => (r ? `${r.l}×${r.h} px à (${r.x}, ${r.y})` : 'rectangle inconnu');

/** Un décalage, en une ligne : valeur, temps, et ce qui a bougé. */
export function decrireDecalage(decalage) {
  const sources = decalage.sources.slice(0, SOURCES_NOMMEES).map((source) => {
    if (!source.noeud) return '<nœud détaché>';
    const texte = source.noeud.texte ? `« ${source.noeud.texte} »` : '(sans texte)';
    return `<${source.noeud.balise}${source.noeud.classes}> ${texte} : ${BOITE(source.avant)} → ${BOITE(source.apres)}`;
  });
  const reste = decalage.sources.length - sources.length;
  return (
    `${decalage.valeur.toFixed(4)} à t=${decalage.debut} ms — ` +
    (sources.length ? sources.join(' | ') : 'aucune source nommée') +
    (reste > 0 ? ` (+${reste} autre(s) source(s))` : '')
  );
}

/**
 * Le relevé complet, en texte : le CLS, sa fenêtre, la somme brute et les plus
 * grands décalages. Un vert sans chiffre ne prouve rien (règle du dépôt), et un
 * rouge sans source n'est pas réparable.
 *
 * @param {number} cls La valeur à comparer au budget.
 * @param {ReturnType<clsDesDecalages>} releve Le relevé du même passage.
 * @param {number} [max] Nombre de décalages décrits.
 */
export function decrireCls(cls, releve, max = 3) {
  const fenetre = releve.fenetres.reduce((pire, candidate) => (candidate.valeur > pire.valeur ? candidate : pire), {
    valeur: 0,
    debut: 0,
    fin: 0,
    nombre: 0,
  });
  const decalages = releve.plusGrand ? [releve.plusGrand] : [];
  return (
    `CLS ${cls.toFixed(4)} — plus grande fenêtre de session ${fenetre.valeur.toFixed(4)} ` +
    `(${fenetre.nombre} décalage(s) de t=${fenetre.debut} à ${fenetre.dernier ?? fenetre.debut} ms), ` +
    `somme brute ${releve.total.toFixed(4)} sur ${releve.fenetres.reduce((n, f) => n + f.nombre, 0)} décalage(s)` +
    (decalages.length ? ` ; plus grand décalage : ${decrireDecalage(releve.plusGrand)}` : '')
  );
}
