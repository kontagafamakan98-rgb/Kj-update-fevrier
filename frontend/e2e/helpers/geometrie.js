/**
 * Le HARNAIS des gardes de géométrie pré-rendue : mesurer une coquille SEULE,
 * puis la même route telle que React la peint, et comparer.
 *
 * Il vit ici plutôt que dans chaque parcours parce que les deux gardes qui
 * l'utilisent mesurent des choses DIFFÉRENTES avec le même protocole :
 *   • `lcp-geometrie.spec.js` — la CHRONOLOGIE du LCP (une seule candidate, au
 *     premier paint) : c'est la garantie « la coquille a gagné » ;
 *   • `geometrie-coquille-react.spec.js` — la GÉOMÉTRIE peinte (rect de chaque
 *     texte, `text-align` hérité, hauteur de navbar) : c'est la garantie « les
 *     deux peintures posent les mêmes textes aux mêmes endroits ».
 * Le protocole, lui, est le même et doit le rester : une copie qui dériverait
 * d'un côté ferait mesurer deux choses différentes en croyant mesurer la même.
 *
 * ── Ce qu'on mesure EXACTEMENT : l'encre des NŒUDS DE TEXTE ─────────────────
 * Pas la boîte de l'élément qui porte le texte : elle dépend d'un détail
 * d'implémentation, pas de ce qui est peint. Mesuré sur /login le 25/09/2026 :
 * React écrit `<button class="relative …"><span>Connexion</span></button>`
 * (la boîte du `span` vaut 68×30, celle de son encre), la coquille écrivait
 * `<div class="relative …">Connexion</div>` (380×38, tout le bloc) — deux
 * boîtes incomparables pour une encre IDENTIQUE au pixel (x=16, y=446 des deux
 * côtés). Un garde qui compare les boîtes d'éléments refuse du vert.
 *
 * On mesure donc, pour chaque nœud de texte VISIBLE, les rectangles rendus par
 * `Range.getClientRects()` — la seule mesure qui corresponde à ce que
 * Lighthouse appelle la boîte d'une peinture. Deux nœuds qui se partagent une
 * ligne sont réunis par `unionParLigne`, pour qu'un découpage du DOM différent
 * (un `<span>` d'un côté, pas de l'autre) ne fasse pas deux mesures d'une même
 * encre.
 *
 * ── Le protocole ────────────────────────────────────────────────────────────
 * Deux navigations de la même route, sur des pages NEUVES (aucun état partagé) :
 *   1. « coquille » : le bundle d'entrée de l'application est BLOQUÉ
 *      (`page.route`), donc le HTML pré-rendu se peint et React ne monte
 *      jamais — c'est la peinture que le navigateur garde si React reste sage ;
 *   2. « réelle » : navigation normale, React monte et reconstruit la page.
 *
 * La liste des routes vient de `src/config/page-meta.js` (la table unique des
 * pages pré-rendues) : une page ajoutée là est mesurée sans qu'on touche ici.
 */
import { PAGE_META } from '../../src/config/page-meta.js';

/** Les routes PRÉ-RENDUES, dérivées de la table unique (jamais recopiées). */
export const ROUTES = Object.keys(PAGE_META).sort();

/**
 * Les deux tailles mesurées : elles ne divergent pas de la même façon (les
 * variantes `sm:`/`md:` ne s'appliquent pas à 412 px) et 1350×940 est la
 * largeur des relevés de /jobs et de /contact.
 */
export const TAILLES = [
  { nom: 'mobile', viewport: { width: 412, height: 823 } },
  { nom: 'desktop', viewport: { width: 1350, height: 940 } },
];

/**
 * Le bundle d'entrée porte le nom haché du build (`index-<hash>.js`) : on bloque
 * tout « index-*.js » du dossier /assets, jamais les chunks de page ni les
 * vendors, qu'aucun code ne chargerait de toute façon sans lui.
 */
export const ENTREE_APPLICATION = /\/assets\/index-[^/]*\.js$/;

/**
 * Le marqueur du MONTAGE de React : la navbar de l'application. Le chrome des
 * coquilles publie une navbar VIDE (le placeholder qui réserve les 65 px), donc
 * un lien dans `nav` ne peut exister QUE si React a monté — attendre « un h1 »
 * ne prouverait rien, la coquille en publie un du même texte.
 */
export const MARQUEUR_DE_MONTAGE = 'nav a'

/**
 * Fige l'état ASYNCHRONE du PREMIER RENDU.
 *
 * La garantie mesurée est « la coquille peint ce que le PREMIER rendu de React
 * peint ». La géolocalisation est le seul état asynchrone qui change la
 * géométrie du haut de page : sur /register, la coquille publie l'état
 * « Détection de votre position… » (celui de `geoLoading`), et React le
 * remplace dès la réponse du navigateur par « 📍 Position non détectée »,
 * 14 px plus haut — mesuré : les trois pastilles d'étape passaient de y=338
 * (coquille) à y=352 (React), et tout le formulaire suivait. Ce décalage est
 * un changement d'ÉTAT, pas une divergence de peinture : sans ce gel, le garde
 * comparerait la coquille du premier paint à un état ULTÉRIEUR.
 *
 * Le stub ne rappelle jamais : `geoLoading` reste vrai, comme dans la coquille.
 */
export async function gelerLePremierRendu(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: () => {},
          watchPosition: () => 0,
          clearWatch: () => {},
        },
      })
    } catch (_error) {
      /* navigateur sans geolocation : rien à geler */
    }
  })
}

/**
 * Le RELEVÉ d'une peinture : pour chaque nœud de texte visible, l'encre peinte
 * (un rectangle par ligne) et l'alignement hérité de son porteur, plus la
 * hauteur de la navbar et la géométrie des conteneurs du chrome.
 */
export const RELEVE_GEOMETRIE = () => {
  const arrondi = (valeur) => +valeur.toFixed(2)
  const fragments = []
  for (const element of document.querySelectorAll('body *')) {
    if (element.closest('style,script,noscript,head,title,svg,textarea,select')) continue
    const alignement = getComputedStyle(element).textAlign
    const dansMain = Boolean(element.closest('main'))

    // Un TEXTE PEINT est une suite de nœuds de texte CONSÉCUTIFS du même
    // parent, pas un nœud : JSX découpe `💡 {t('tipsGoodPhoto')}` en deux
    // nœuds (`"💡 "` puis le libellé) là où le HTML de la coquille en écrit
    // un seul — mêmes octets peints, mesures incomparables. Les réunir rend
    // la mesure indifférente au découpage du DOM.
    let run = []
    const viderRun = () => {
      if (!run.length) return
      const brut = run.map((noeud) => noeud.textContent).join('')
      const debut = brut.length - brut.trimStart().length
      const fin = brut.trimEnd().length
      const texte = brut.slice(debut, fin).replace(/\s+/g, ' ')
      if (texte) {
        // La plage est BORNÉE aux caractères visibles : l'espace de fin d'un
        // `{' '}` de JSX n'a pas de largeur de son côté (il est hors ligne) et
        // l'avait du nôtre — 3,84 px d'écart pour la même encre.
        const position = (index) => {
          let reste = index
          for (const noeud of run) {
            if (reste <= noeud.textContent.length) return [noeud, reste]
            reste -= noeud.textContent.length
          }
          const dernier = run[run.length - 1]
          return [dernier, dernier.textContent.length]
        }
        const [noeudDebut, offsetDebut] = position(debut)
        const [noeudFin, offsetFin] = position(fin)
        const range = document.createRange()
        try {
          range.setStart(noeudDebut, offsetDebut)
          range.setEnd(noeudFin, offsetFin)
        } catch (_error) {
          run = []
          return
        }
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0) continue
          fragments.push({
            texte,
            x: rect.x,
            y: rect.y,
            l: rect.width,
            h: rect.height,
            alignement,
            dansMain,
          })
        }
      }
      run = []
    }
    for (const noeud of element.childNodes) {
      if (noeud.nodeType === 3) {
        run.push(noeud)
        continue
      }
      viderRun()
    }
    viderRun()
  }

  // Un nœud de texte peut couvrir plusieurs lignes (un paragraphe) : on réunit
  // ses fragments LIGNE PAR LIGNE, en gardant leur ordre de lecture. Deux
  // fragments sont sur la même ligne quand leurs bandes verticales se
  // recouvrent largement — comparer les `y` ne marcherait pas dès que deux
  // tailles de police cohabitent.
  const memeLigne = (a, b) => {
    const haut = Math.max(a.y, b.y)
    const bas = Math.min(a.y + a.h, b.y + b.h)
    return bas - haut > 0.5 * Math.min(a.h, b.h)
  }
  const parTexte = new Map()
  for (const fragment of fragments) {
    const liste = parTexte.get(fragment.texte) || []
    let ligne = liste.find((candidate) => candidate.fragments.some((f) => memeLigne(f, fragment)))
    if (!ligne) {
      ligne = { fragments: [], alignements: new Set(), dansMain: false }
      liste.push(ligne)
    }
    ligne.fragments.push(fragment)
    ligne.alignements.add(fragment.alignement)
    ligne.dansMain = ligne.dansMain || fragment.dansMain
    parTexte.set(fragment.texte, liste)
  }

  const textes = {}
  for (const [texte, lignes] of parTexte) {
    textes[texte] = lignes
      .map(({ fragments: liste, alignements, dansMain }) => {
        const gauche = Math.min(...liste.map((f) => f.x))
        const droite = Math.max(...liste.map((f) => f.x + f.l))
        const haut = Math.min(...liste.map((f) => f.y))
        const bas = Math.max(...liste.map((f) => f.y + f.h))
        return {
          boite: [arrondi(gauche), arrondi(haut), arrondi(droite - gauche), arrondi(bas - haut)],
          alignement: [...alignements].sort().join('+'),
          dansMain,
        }
      })
      .sort((a, b) => a.boite[1] - b.boite[1] || a.boite[0] - b.boite[0])
  }

  const rect = (selecteur) => {
    const element = document.querySelector(selecteur)
    if (!element) return null
    const r = element.getBoundingClientRect()
    return { y: arrondi(r.y), h: arrondi(r.height) }
  }

  return {
    url: location.pathname,
    hauteurDocument: document.documentElement.scrollHeight,
    hauteurNavbar: rect('nav') ? rect('nav').h : null,
    main: rect('main'),
    footer: rect('footer'),
    alignementApp: document.querySelector('.App') ? getComputedStyle(document.querySelector('.App')).textAlign : null,
    textes,
  }
}

/** Tolerance : la mise en page est en pixels entiers des deux côtés. */
export const TOLERANCE_PX = 0.5

/**
 * Compare deux relevés : les divergences (vide si tout est superposé), le
 * nombre de textes réellement comparés, et ceux que React ne peint pas
 * (divergence de CONTENU, jugée par `e2e/texte-coquille-react.spec.js` — le
 * garde de provenance lit le HTML du build, donc une chaîne, pas une peinture).
 *
 * L'appariement est POSITIONNEL, jamais par rang : un même texte vit souvent à
 * plusieurs endroits (les liens du pied de page sont aussi dans le corps), donc
 * chaque instance de la coquille cherche son homologue React au MÊME endroit.
 *
 * Ce qui est GÉOMÉTRIE : un texte publié par la coquille ET peint par React
 * doit l'être au même endroit, avec le même alignement hérité. Un texte que
 * React ne peint pas DU TOUT est une divergence de contenu (comptée et
 * publiée, jamais confondue avec un déplacement) : ce n'est PAS jugé ici —
 * `e2e/texte-coquille-react.spec.js` la juge, mot pour mot et par bande, parce
 * qu'une divergence de contenu n'est pas une divergence de géométrie (le garde
 * de provenance, lui, lit le HTML du build : une chaîne, pas une peinture).
 *
 * ── La FRONTIÈRE de contenu (et pourquoi tout ce qui suit n'est pas comparé) ─
 * React peint parfois, DANS `main`, un contenu que la coquille ne peut pas
 * connaître : la liste des missions de /jobs n'existe qu'après la réponse de
 * l'API. Ce bloc ajoute de la hauteur, donc tout ce qui le suit se déplace —
 * mesuré sur /jobs mobile : le pied de page est 325 px plus bas chez React,
 * et ce n'est PAS un défaut de la coquille, c'est une donnée asynchrone.
 * La borne est le premier texte que React peint dans `main` et que la coquille
 * ne peint pas ; au-delà, plus rien n'est comparable (et le journal le dit).
 * Ce qui la précède — le premier écran, l'élément LCP, tous les blocs dont la
 * coquille est la réplique — reste comparé au pixel.
 *
 * Symétriquement, un texte que la SEULE coquille peint ne borne RIEN : React
 * découpe souvent un même libellé en deux (`1 000` + `+`, `💡 ` + le texte),
 * donc un texte « en plus » côté coquille n'annonce pas une hauteur en plus.
 */
export function comparerGeometrie(coquille, react) {
  const divergences = []
  const absent = []
  const horsZone = []
  const nom = (texte) => `« ${texte.length > 44 ? `${texte.slice(0, 44)}…` : texte} »`
  const boite = (b) => `${b[2]}×${b[3]} px à (${b[0]}, ${b[1]})`
  // Une instance EST une ligne peinte (le relevé éclate les paragraphes en
  // une instance par ligne, cf. `unionParLigne`) : deux instances coïncident
  // quand les quatre côtés de leur rectangle coïncident.
  const memeBoite = (a, b) => a.every((valeur, i) => Math.abs(valeur - b[i]) <= TOLERANCE_PX)
  const ecart = (a, b) => Math.max(...a.map((valeur, i) => Math.abs(valeur - b[i])))

  if (coquille.hauteurNavbar !== react.hauteurNavbar) {
    divergences.push(
      `hauteur de navbar : ${coquille.hauteurNavbar} px dans la coquille, ${react.hauteurNavbar} px ` +
        'chez React — le placeholder doit réserver la hauteur RÉELLE (65 px : h-16 + border-b)'
    )
  }
  if (coquille.alignementApp !== react.alignementApp) {
    divergences.push(
      `text-align de .App : « ${coquille.alignementApp} » (coquille) contre « ${react.alignementApp} » (React) — ` +
        'tout le texte de la page en hérite'
    )
  }

  // ── La frontière : un BLOC que React peint et pas la coquille ─────────────
  // Candidat : un texte que React peint dans `main` et que la coquille ne peint
  // NULLE PART. Mais un texte peut différer de valeur au MÊME endroit (les
  // chiffres de l'accueil : la coquille publie « 1 000+ », React
  // `toLocaleString()` rend « 1,000+ ») : ce n'est pas un bloc manquant, donc
  // le candidat ne compte que si la coquille ne peint AUCUN texte dans sa
  // bande verticale — c'est ça, « React peint ici quelque chose que la
  // coquille n'a pas ».
  const bande = ([x, y, l, h]) => [y, y + h]
  const chevauche = (a, b) => a[0] < b[1] && b[0] < a[1]
  const bandesCoquille = Object.values(coquille.textes)
    .flatMap((instances) => instances.map((i) => bande(i.boite)))
  const frontieres = Object.entries(react.textes)
    .filter(([texte]) => !coquille.textes[texte])
    .flatMap(([texte, instances]) => instances.filter((i) => i.dansMain).map((i) => ({ y: i.boite[1], texte, b: bande(i.boite) })))
    .filter(({ b }) => !bandesCoquille.some((bc) => chevauche(bc, b)))
  const frontiere = frontieres.length ? Math.min(...frontieres.map(({ y }) => y)) : Infinity
  const texteFrontiere = (frontieres.find(({ y }) => y === frontiere) || {}).texte

  let compares = 0
  for (const [texte, instances] of Object.entries(coquille.textes)) {
    const autres = react.textes[texte] || []
    if (!autres.length) {
      absent.push(...instances.map(() => texte))
      continue
    }
    const pris = new Array(autres.length).fill(false)
    for (const a of instances) {
      // TOUT ce qui est DANS `main` est comparé : c'est la réplique que la
      // coquille revendique. Seul le CHROME (pied de page) voit sa position
      // dépendre de la hauteur totale de la page — et cette hauteur dépend,
      // sur certaines routes, d'un bloc asynchrone que la coquille ne connaît
      // pas (la liste des missions de /jobs) : au-delà de la frontière, sa
      // position n'est plus comparable, et le journal le dit.
      if (!a.dansMain && a.boite[1] >= frontiere) {
        horsZone.push(texte)
        continue
      }
      let choisi = -1
      for (let j = 0; j < autres.length; j += 1) {
        if (pris[j]) continue
        const b = autres[j]
        if (a.alignement === b.alignement && memeBoite(a.boite, b.boite)) {
          choisi = j
          break
        }
      }
      if (choisi === -1) {
        const proche = autres
          .map((b, j) => ({ b, pris: pris[j] }))
          .filter(({ pris: deja }) => !deja)
          .map(({ b }) => ({ b, d: ecart(a.boite, b.boite) }))
          .sort((u, v) => u.d - v.d)[0]
        const premier = a.boite
        const sien = proche ? proche.b.boite : null
        divergences.push(
          `${nom(texte)} : ${boite(premier)} dans la coquille — React ` +
            (sien
              ? `la peint à ${boite(sien)}, soit Δx=${(premier[0] - sien[0]).toFixed(2)} px et ` +
                `Δy=${(premier[1] - sien[1]).toFixed(2)} px`
              : 'ne peint ce texte à aucun endroit') +
            (a.alignement !== (proche ? proche.b.alignement : a.alignement)
              ? ` ; text-align : « ${a.alignement} » contre « ${proche.b.alignement} »`
              : '')
        )
        continue
      }
      pris[choisi] = true
      compares += 1
    }
  }
  return {
    divergences,
    compares,
    absents: absent.length,
    exemplesAbsents: [...new Set(absent)].slice(0, 5),
    frontiere,
    texteFrontiere,
    horsZone: horsZone.length,
    exemplesHorsZone: [...new Set(horsZone)].slice(0, 5),
  }
}

/**
 * Ouvre une page prête pour le protocole.
 *
 * @param {import('@playwright/test').Browser} browser Navigateur du test.
 * @param {'coquille'|'reelle'} peinture Quelle peinture on mesure.
 * @param {{width: number, height: number}} viewport Taille de la fenêtre.
 * @returns {Promise<import('@playwright/test').Page>} Page neuve, route bloquée
 *   si l'on mesure la coquille.
 */
export async function ouvrirLaPage(browser, peinture, viewport) {
  const page = await browser.newPage({ viewport });
  if (peinture === 'coquille') {
    await page.route(ENTREE_APPLICATION, (route) => route.abort());
  }
  return page;
}

/**
 * Échantillon léger de la mise en page, pour attendre que React ait fini :
 * hauteur du document, nombre d'éléments dans `main` et position du dernier.
 *
 * Deux échantillons ÉGAUX à 250 ms d'intervalle signifient que le chunk de page
 * a remplacé le squelette et que la mise en page ne bouge plus. Attendre un
 * délai fixe serait à la fois plus lent et moins sûr : trop court, on mesurerait
 * le squelette ; trop long, la suite s'allonge sans preuve supplémentaire.
 */
export const SIGNATURE_DE_STABILITE = () => {
  const main = document.querySelector('main');
  const enfants = main ? [...main.querySelectorAll('*')] : [];
  const dernier = enfants[enfants.length - 1];
  return [
    document.documentElement.scrollHeight,
    enfants.length,
    dernier ? Math.round(dernier.getBoundingClientRect().bottom) : 0,
  ].join('|');
};

/**
 * Attend que la signature de mise en page se répète (ou renonce au bout de
 * `maxMs`, pour que le test échoue sur la COMPARAISON et non sur une attente
 * muette).
 *
 * @param {import('@playwright/test').Page} page Page ouverte sur une route.
 * @param {number} [maxMs] Plafond d'attente en millisecondes.
 */
export async function attendreLaStabilite(page, maxMs = 6000) {
  const debut = Date.now();
  let precedente = null;
  while (Date.now() - debut < maxMs) {
    const courante = await page.evaluate(SIGNATURE_DE_STABILITE);
    if (precedente !== null && courante === precedente) return true;
    precedente = courante;
    await page.waitForTimeout(250);
  }
  return false;
}
