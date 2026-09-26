/**
 * LE CONTRÔLE DE CONTENU des coquilles pré-rendues : ce qu'une coquille publie
 * SANS JavaScript se retrouve-t-il MOT POUR MOT dans ce que React affiche, au
 * même endroit ?
 *
 * ── Pourquoi ce contrôle existe (et ce qu'il ajoute aux voisins) ─────────────
 * `scripts/check-shell-text-provenance.js` lit le HTML du build : il prouve que
 * chaque fragment publié a une SOURCE dans la page. `e2e/geometrie-coquille-react.spec.js`
 * compare la géométrie, mais il ne JUGE PAS les divergences de contenu — un
 * texte que la coquille peint et que React ne peint pas y est compté `absent`,
 * publié dans le journal, et c'est tout : la phrase « divergence de CONTENU,
 * couverte par le garde de provenance » délègue à un garde qui lit une CHAÎNE,
 * pas une page. Entre les deux il y avait un trou, et une coquille peut le
 * traverser sans que rien ne rougisse : elle publie « 1. Email » là où React
 * peint « 1. » puis « Email », ou « 💬 » là où React peint une icône lucide.
 * C'est ce trou que ce module ferme, en mesurant la PAGE des deux côtés.
 *
 * ── Ce qui est comparé, exactement ──────────────────────────────────────────
 * Le harnais de géométrie (`./geometrie.js`) ouvre deux pages NEUVES de la même
 * route — la première avec le bundle d'entrée BLOQUÉ (React ne monte jamais :
 * c'est ce que lit un visiteur sans JavaScript, et c'est aussi la peinture que
 * le navigateur garde quand React reconstruit à l'identique) — la seconde
 * normale. Ici on ne mesure pas des rectangles de texte : on mesure ce qui est
 * ÉCRIT, et réciproquement on n'accepte pas que ce soit écrit ailleurs.
 *
 *   1. LES MOTS, DANS LA BANDE. Pour chaque texte VERBAL peint par la coquille
 *      (un texte qui contient au moins une lettre ou un chiffre), React doit
 *      peindre, à la même hauteur ET DANS LA MÊME ZONE (le corps `main` ou le
 *      chrome), une bande de texte qui CONTIENT ces mots, dans l'ordre. La bande
 *      est la même relation que celle du harnais de géométrie (recouvrement de
 *      plus de la moitié de la plus petite des deux hauteurs) : deux textes sont
 *      à la même hauteur, et leur ordre de lecture est l'ordre des `x`.
 *      La comparaison porte sur la phrase ENTIÈRE, jamais sur un mot isolé :
 *      accepter « un mot contenu quelque part » rendrait le contrôle décoratif
 *      (tout mot est contenu dans une phrase) — la même règle que le garde de
 *      provenance applique côté HTML. C'est ce qui rend la sonde indifférente
 *      au DÉCOUPAGE du DOM : « 1. Email » d'un côté et « 1. » puis « Email » de
 *      l'autre sont la MÊME phrase dans la même bande, et sont acceptés ;
 *      « 1. Courriel » ne l'est pas.
 *
 *   2. LES DEUX ZONES SONT COMPARÉES SÉPARÉMENT, et ce n'est pas un détail de
 *      plomberie : la coquille publie AUSSI le chrome partagé (le pied de page
 *      d'`app-chrome.js` : adresse, téléphone, liens légaux), qui vit HORS de
 *      `main` chez les deux canaux. Comparer les deux zones ensemble laisserait
 *      un texte du chrome retrouver son homologue dans le corps (ou l'inverse) :
 *      la bonne phrase, au mauvais endroit, passerait. Chaque zone est donc
 *      appariée à sa propre zone, et chacune a son plancher anti-faux-vert.
 *
 *      LE CHROME EST COMPARÉ DANS L'ORDRE, PAS DANS LA BANDE, et c'est une
 *      décision, pas un relâchement : la position verticale du pied de page est
 *      une fonction de la HAUTEUR DU CORPS, que React change avec du contenu
 *      asynchrone. Mesuré sur /jobs (25/09/2026) : la liste des missions insère
 *      la page React sous les textes de la coquille, le pied de page passe de
 *      y≈699 (coquille) à plus de 1 800 px, et la bande de la coquille est
 *      occupée par la barre de navigation MOBILE (qui, elle, n'existe pas dans
 *      la coquille). Exiger la bande y ferait rougir les 9 textes du pied de
 *      page de /jobs sans qu'aucun mot manque. Ce qui reste prouvé dans le
 *      chrome : les mêmes phrases, dans le même ordre, présentes chez React —
 *      et la zone est gardée séparée, donc un texte du corps ne peut pas y
 *      répondre à la place d'un texte du chrome.
 *
 *      La coquille ne publie AUCUN glyphe dans le chrome (mesuré : 0 sur les 11
 *      routes pré-rendues, le pied de page est fait de texte). La sonde le
 *      vérifie plutôt que de le supposer : le jour où un glyphe y apparaîtra, il
 *      faudra décider sa règle, pas la laisser passer.
 *
 *   3. LES GLYPHES, DANS LA BANDE. Un texte non verbal (emoji, puce, flèche)
 *      est un GLYPHE, et les deux canaux n'ont pas le même vocabulaire : la
 *      coquille est du HTML statique (elle publie « 🇲🇱 » ou « 💬 »), React peint
 *      souvent un SVG ou une image. La règle est donc :
 *        • la coquille ne publie un glyphe que si React peint un glyphe DANS LA
 *          MÊME BANDE — texte non verbal, `<svg>` ou `<img>` (`svg` et `img` sont
 *          comptés sans texte, leur contenu n'est pas lisible) ;
 *        • si React peint un glyphe TEXTUEL dans cette bande, il doit être le
 *          MÊME glyphe. C'est la moitié qui a du mordant : publier « 📮 » là où
 *          React peint « 📞 » est refusé, alors que remplacer l'emoji par une
 *          icône SVG ne l'est pas.
 *      Ce que la règle ne juge PAS, et qu'il ne faut pas lui demander : la
 *      SÉMANTIQUE d'un dessin. Depuis le 26/09/2026 les pages pré-rendues ne
 *      publient plus d'emoji : leurs glyphes sont DESSINÉS, déclarés par un nom
 *      d'icône (`icone`, src/config/page-icons.js) que les deux canaux rendent
 *      par le même registre — la coquille et React peignent donc le même `<svg>`
 *      par construction. Le contrôle se contente d'exiger, dans la même bande,
 *      un pendant NON verbal (SVG ou image), sans juger lequel.
 *
 * ── La borne, dite une fois ─────────────────────────────────────────────────
 * La bande comparée est celle de la COQUILLE. Un bloc ASYNCHRONE que React
 * insère AVANT un texte de la coquille déplace ce texte hors de sa bande, et la
 * sonde rougira sans qu'il y ait de faute : c'est assumé, et mesuré — sur /jobs
 * la liste des missions s'insère APRÈS le titre et l'introduction, donc les
 * textes de la coquille restent dans leur bande (relevé du 25/09/2026 : 0
 * manquant sur les 10 routes comparables, sauf les deux chiffres de /, cf.
 * ci-dessous). Le jour où une bannière asynchrone s'insérera au-dessus, le rouge
 * sera LÉGITIME : la coquille aura cessé d'être l'endroit où ce texte est peint,
 * et c'est un fait à traiter (une frontière à déclarer), pas à contourner.
 *
 * ── Les écarts DÉCLARÉS (et pourquoi il n'y en a que deux) ──────────────────
 * Un seul endroit du site publie des mots que React ne peut pas publier : les
 * quatre chiffres de l'accueil. La page les lit de `/public/stats` et les
 * formate par `toLocaleString()`, la coquille publie le repli statique déclaré
 * dans `src/config/page-sections.js` (`stats[].shellText`) — « 1 000+ » contre
 * « 1+ » avec la fixture mesurée le 25/09/2026. Aucune géométrie ne peut
 * rapprocher une valeur de donnée d'un repli : cet écart est DÉCLARÉ, avec sa
 * raison, et sa contrepartie est VÉRIFIÉE (React doit peindre, dans la bande,
 * un nombre suivi du suffixe — la preuve que le bloc est toujours vivant et que
 * l'écart est bien « une donnée contre un repli », pas « un texte disparu »).
 * Un écart déclaré qui n'est PLUS utilisé, ou dont la contrepartie n'est plus
 * peinte, est PÉRIMÉ et fait rougir : sans cette règle, la table des écarts
 * deviendrait le cimetière des exceptions qu'on n'ose plus retirer (la règle
 * que `scripts/shell-text-provenance.js` applique déjà à ses marqueurs).
 */

/**
 * L'inventaire d'une peinture, exécuté DANS LA PAGE : les textes peints (runs
 * de nœuds de texte consécutifs d'un même parent, espaces normalisés), les
 * `<svg>` et les `<img>` peints, chacun avec sa bande verticale et son `x` de
 * lecture. Les textes invisibles (aucun rectangle) ne sont pas inventoriés :
 * un texte que le navigateur ne peint pas n'est pas publié.
 */
export const INVENTAIRE_PEINT = () => {
  // Le motif est DÉCLARÉ ICI, pas au niveau du module : cette fonction est
  // sérialisée vers le navigateur par `page.evaluate`, elle ne voit donc que sa
  // propre portée — une constante de module y serait « is not defined ».
  const estVerbal = /[\p{L}\p{N}]/u;
  const normaliser = (texte) => texte.replace(/\s+/g, ' ').trim();
  const estPeint = (noeud) => {
    const range = document.createRange();
    try {
      range.selectNodeContents(noeud);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) return true;
      }
    } catch (_error) {
      return false;
    }
    return false;
  };
  const bande = (element) => {
    const r = element.getBoundingClientRect();
    return { haut: r.y, bas: r.y + r.height, x: r.x };
  };
  const items = [];
  for (const element of document.querySelectorAll('body *')) {
    // `<select>` et `<textarea>` sont écartés comme dans le harnais de
    // géométrie : leur contenu est l'état d'un contrôle, pas un texte publié.
    if (element.closest('style,script,noscript,template,head,title,select,textarea')) continue;
    if (element.tagName === 'svg' || element.tagName === 'SVG') {
      if (element.getClientRects().length) {
        items.push({
          sorte: 'svg',
          texte: '',
          verbal: false,
          dansMain: Boolean(element.closest('main')),
          ...bande(element),
        });
      }
      continue;
    }
    if (element.tagName === 'IMG' && element.getClientRects().length) {
      items.push({
        sorte: 'img',
        texte: '',
        verbal: false,
        dansMain: Boolean(element.closest('main')),
        ...bande(element),
      });
      continue;
    }
    // L'intérieur d'un SVG est du dessin, pas du texte publié.
    if (element.closest('svg')) continue;

    const courant = { dansMain: Boolean(element.closest('main')), ...bande(element) };
    let brut = '';
    const vider = () => {
      const texte = normaliser(brut);
      brut = '';
      if (!texte) return;
      if (courant.bas - courant.haut <= 0) return;
      items.push({ sorte: 'texte', texte, verbal: estVerbal.test(texte), ...courant });
    };
    for (const noeud of element.childNodes) {
      if (noeud.nodeType === 3) {
        if (estPeint(noeud)) brut += noeud.textContent;
        continue;
      }
      vider();
    }
    vider();
  }
  return { url: location.pathname, items };
};

/**
 * Deux bandes coïncident quand elles se recouvrent de plus de la moitié de la
 * plus petite des deux (comparer les `y` échouerait dès que deux tailles de
 * police cohabitent sur une même ligne) — la relation du harnais de géométrie.
 */
const MEME_BANDE = (a, b) => {
  const haut = Math.max(a.haut, b.haut);
  const bas = Math.min(a.bas, b.bas);
  return bas - haut > 0.5 * Math.min(a.bas - a.haut, b.bas - b.haut);
};

/**
 * Les deux zones comparées séparément. `enBande` dit COMMENT comparer : le corps
 * se compare dans la bande (sa géométrie est stable : c'est ce que l'égalité de
 * peinture garantit), le chrome dans l'ordre des mots (sa hauteur dépend de la
 * hauteur du corps, donc d'un contenu asynchrone — cf. l'en-tête).
 */
const ZONES = [
  { nom: 'corps main', dansMain: true, enBande: true },
  { nom: 'chrome', dansMain: false, enBande: false },
];

/**
 * LES ÉCARTS DÉCLARÉS entre ce que la coquille publie et ce que React affiche.
 *
 * Chaque entrée porte la ROUTE, le TEXTE exact publié par la coquille, la RAISON
 * (mesurée, avec sa date) et une CONTREPARTIE : le motif que React doit peindre
 * dans la même bande pour que l'écart reste ce qu'il prétend être. Un écart
 * déclaré qui n'est plus utilisé, ou dont la contrepartie n'est plus peinte,
 * fait rougir la sonde.
 */
export const ECARTS_DECLARES = [
  {
    route: '/',
    texte: '1 000+',
    raison:
      "les quatre chiffres de l'accueil sont des DONNÉES : la page les lit de /public/stats et les formate " +
      'par toLocaleString() (séparateur de milliers selon la locale du navigateur), la coquille publie le repli ' +
      'statique déclaré dans src/config/page-sections.js (`stats[].shellText`) — mesuré le 25/09/2026 avec la ' +
      'fixture : React peint « 1+ », la coquille « 1 000+ ». Aucune géométrie ni aucun texte ne peut rapprocher ' +
      'une valeur de donnée d’un repli.',
    contrepartie: /^\p{N}[\p{N}\s\u00a0.,]*\+$/u,
  },
  {
    route: '/',
    texte: '500+',
    raison:
      'même bloc que « 1 000+ » : le deuxième chiffre de la grille est lu de /public/stats et formaté par la page ' +
      '(mesuré : « 0+ » avec la fixture), tandis que la coquille publie le repli « 500+ » déclaré dans ' +
      'src/config/page-sections.js.',
    contrepartie: /^\p{N}[\p{N}\s\u00a0.,]*\+$/u,
  },
];

/**
 * Compare les deux inventaires d'une route et rend les divergences NOMMÉES,
 * zone par zone (le corps `main`, puis le chrome).
 *
 * @param {string} route La route comparée (« /jobs »), pour retrouver ses écarts déclarés.
 * @param {{url: string, items: Array<object>}} coquille Peinture du HTML pré-rendu, bundle bloqué.
 * @param {{url: string, items: Array<object>}} react Peinture du premier rendu de React.
 * @returns {object} Les manquants, les glyphes fautifs, l'état des écarts déclarés et les volumes comparés.
 */
export function comparerTextes({ route, coquille, react }) {
  const court = (texte, longueur = 44) => `« ${texte.length > longueur ? `${texte.slice(0, longueur)}…` : texte} »`;
  const bande = (item) => `y=${Math.round(item.haut)}`;

  const ecarts = ECARTS_DECLARES.filter((ecart) => ecart.route === route);
  const etatEcarts = ecarts.map((ecart) => ({ ...ecart, utilise: false, contrepartieVerifiee: false }));

  const manquants = [];
  const glyphesSansPendant = [];
  const glyphesDivergents = [];
  const mesures = { zones: {}, items: 0, mots: 0, glyphes: 0, itemsReact: 0, motsReact: 0, svgReact: 0, imgReact: 0 };

  for (const zone of ZONES) {
    const itemsCoquille = coquille.items.filter((item) => item.dansMain === zone.dansMain);
    const itemsReact = react.items.filter((item) => item.dansMain === zone.dansMain);
    const motsDe = (items) =>
      items.filter((item) => item.verbal).reduce((total, item) => total + item.texte.split(' ').length, 0);
    // Le contexte de comparaison d'un texte de la coquille, côté React :
    //   • `enBande` : SES textes verbaux à la même hauteur, dans leur ordre de
    //     lecture (les `x`) — c'est la règle du corps ;
    //   • sinon : TOUT le flux de mots de la zone, dans l'ordre de lecture (les
    //     `y` puis les `x`) — c'est la règle du chrome.
    const fluxZone = itemsReact
      .filter((item) => item.verbal)
      .sort((a, b) => a.haut - b.haut || a.x - b.x)
      .flatMap((item) => item.texte.split(' '));
    const bandeTexte = (texte) =>
      itemsReact
        .filter((item) => item.verbal && MEME_BANDE(item, texte))
        .sort((a, b) => a.x - b.x)
        .map((item) => item.texte)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    /** La séquence de mots de `cible` est-elle contiguë dans `flux` ? */
    const contigue = (flux, cible) => {
      const mots = cible.trim().split(' ');
      for (let i = 0; i + mots.length <= flux.length; i += 1) {
        if (mots.every((mot, j) => mot === flux[i + j])) return true;
      }
      return false;
    };

    // ── 1. Les mots, dans la bande (corps) ou dans l'ordre (chrome) ─────────
    for (const texte of itemsCoquille.filter((item) => item.verbal)) {
      const dansLaBande = zone.enBande ? bandeTexte(texte) : '';
      const trouve = zone.enBande ? dansLaBande.includes(texte.texte) : contigue(fluxZone, texte.texte);
      if (trouve) continue;
      const ecart = etatEcarts.find((candidat) => candidat.texte === texte.texte && !candidat.utilise);
      if (ecart) {
        ecart.utilise = true;
        const contrepartie = itemsReact.some(
          (item) => item.verbal && MEME_BANDE(item, texte) && ecart.contrepartie.test(item.texte)
        );
        if (contrepartie) {
          ecart.contrepartieVerifiee = true;
          continue;
        }
        manquants.push(
          `[${zone.nom}] ${court(texte.texte)} (${bande(texte)}) : écart DÉCLARÉ, mais React ne peint AUCUNE ` +
            `contrepartie ${ecart.contrepartie} dans cette bande — l’écart n’est plus « une donnée contre un repli », ` +
            'il est devenu un texte que React ne publie pas. Retirer la déclaration ou corriger la coquille.'
        );
        continue;
      }
      manquants.push(
        `[${zone.nom}] ${court(texte.texte)} (${bande(texte)}) : la coquille la publie, React peint ` +
          (zone.enBande
            ? `dans cette bande ${dansLaBande ? court(dansLaBande, 70) : 'AUTRE CHOSE (aucun texte verbal)'}`
            : `ce texte à AUCUN endroit de la zone (flux de ${fluxZone.length} mot(s) parcouru dans l’ordre)`)
      );
    }

    // ── 2. Les glyphes, dans la bande (le chrome n'en publie aucun : le
    //        harnais compte, la sonde l'exige) ─────────────────────────────
    const glyphes = itemsCoquille.filter((item) => !item.verbal);
    for (const glyphe of glyphes.filter(() => zone.enBande)) {
      const pendants = itemsReact.filter((item) => !item.verbal && MEME_BANDE(item, glyphe));
      if (!pendants.length) {
        glyphesSansPendant.push(
          `[${zone.nom}] ${court(glyphe.texte || glyphe.sorte)} (${bande(glyphe)}) : React n’y peint ni glyphe, ` +
            'ni SVG, ni image'
        );
        continue;
      }
      const textuels = pendants.filter((item) => item.sorte === 'texte');
      if (textuels.length && !textuels.some((item) => item.texte === glyphe.texte)) {
        glyphesDivergents.push(
          `[${zone.nom}] ${court(glyphe.texte)} (${bande(glyphe)}) : React peint du TEXTE dans cette bande, mais ` +
            `${textuels.map((item) => court(item.texte, 16)).join(', ')} — deux glyphes différents au même endroit`
        );
      }
    }

    mesures.zones[zone.nom] = {
      items: itemsCoquille.length,
      mots: motsDe(itemsCoquille),
      glyphes: glyphes.length,
      itemsReact: itemsReact.length,
      motsReact: motsDe(itemsReact),
    };
    mesures.items += itemsCoquille.length;
    mesures.mots += motsDe(itemsCoquille);
    mesures.glyphes += glyphes.length;
    mesures.itemsReact += itemsReact.length;
    mesures.motsReact += motsDe(itemsReact);
    mesures.svgReact += itemsReact.filter((item) => item.sorte === 'svg').length;
    mesures.imgReact += itemsReact.filter((item) => item.sorte === 'img').length;
  }

  return {
    manquants,
    glyphesSansPendant,
    glyphesDivergents,
    etatEcarts,
    ecartsPerimes: etatEcarts.filter((ecart) => !ecart.utilise || !ecart.contrepartieVerifiee),
    mesures,
  };
}
