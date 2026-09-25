/**
 * RESSOURCES DISTANTES d'une coquille pré-rendue — la règle, possédée une fois.
 *
 * Une coquille est ce que reçoit un visiteur AVANT qu'un seul script tourne : le
 * premier écran, peint par le HTML seul. Tout ce qu'elle déclare comme
 * ressource est donc demandé au premier affichage, par le préchargeur du
 * navigateur, sans que React soit monté — et une ressource TIERCE y est un
 * transfert d'adresse IP vers un domaine qu'on n'exploite pas, une connexion
 * (DNS, TCP, TLS) que personne n'a décidée page par page, et un point de panne
 * hors de notre contrôle sur la route critique du premier rendu.
 *
 * La classe a un précédent mesuré dans ce dépôt : la carte Google de l'accueil
 * et de `/contact` était rendue d'emblée, donc la coquille tirait ~300 Ko
 * d'embed avant le premier appui. Le remède (façade + iframe montée au clic) est
 * tenu par un parcours e2e — mais ce parcours prouve le COMPORTEMENT, à l'appui,
 * dans un navigateur. Il ne dit rien de la coquille telle qu'elle est PUBLIÉE :
 * un `<script src="https://…">` ajouté au plugin de pré-rendu, un `<img>` distant
 * dans une section, un `@font-face` sur un CDN, un `preconnect` vers une régie
 * passeraient tous sans qu'un test de comportement bronche. C'est cette surface
 * statique que ce module classe.
 *
 * Ce que le module déclare, et rien d'autre :
 *
 *   * BALISES_A_RESSOURCE — les balises et attributs qui font TÉLÉCHARGER (ou
 *     CONTACTER : `preconnect`, `dns-prefetch`) quelque chose ;
 *   * RELS_RESSOURCE / RELS_SANS_TELECHARGEMENT — le sort des `rel` d'un
 *     `<link>` ; un `rel` qui n'est NI dans l'un NI dans l'autre n'est pas
 *     ignoré : il est REFUSÉ, parce qu'un `rel` inconnu est exactement la forme
 *     qu'aurait le contournement ;
 *   * `url()`, `@import` et les chaînes d'`image-set()` du CSS publié par la
 *     coquille (bloc en ligne ET feuilles liées mêmes-origine) — le cas du
 *     `@font-face` sur un CDN, qui ne passe par aucune balise.
 *
 * Ce qu'il ne regarde PAS, et pourquoi c'est écrit ici : la NAVIGATION. Un
 * `a[href]` vers `wa.me` ou vers la fiche Google est un lien, pas une ressource :
 * il ne part qu'à l'appui, et c'est précisément le contrat de la carte différée
 * (le lien reste un lien, sans JavaScript compris). De même un `link
 * rel="canonical"` est une déclaration d'identité lue par les moteurs, pas un
 * téléchargement. Refuser ces deux-là rendrait le garde faux, donc ignoré.
 *
 * Et les URL absolues d'un `<script type="application/ld+json">` (JSON-LD) ne
 * sont pas des ressources : ce bloc est une DONNÉE pour les moteurs, le
 * navigateur ne le demande pas. Il n'est donc pas lu ici — le confondre avec une
 * déclaration de ressource serait le premier faux positif du garde.
 */

/** Origines déclarées par l'appelant (jamais recopiées ici : voir site-meta.js). */
export const normaliserOrigine = (origine) => origine.trim().toLowerCase().replace(/\/+$/, '');

/**
 * Les balises qui déclarent un téléchargement, et par quel attribut.
 *
 * `link` y est, mais filtré par son `rel` (voir RELS_*) : c'est le même
 * attribut `href` pour une icône et pour un canonical.
 */
export const BALISES_A_RESSOURCE = {
  audio: ['src'],
  embed: ['src'],
  iframe: ['src'],
  img: ['src', 'srcset'],
  input: ['src'],
  link: ['href'],
  object: ['data'],
  script: ['src'],
  source: ['src', 'srcset'],
  track: ['src'],
  video: ['src', 'poster'],
};

/** Un `rel` qui télécharge (ou contacte) quelque chose au premier affichage. */
export const RELS_RESSOURCE = new Set([
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'apple-touch-startup-image',
  'dns-prefetch',
  'icon',
  'manifest',
  'mask-icon',
  'modulepreload',
  'preconnect',
  'prefetch',
  'preload',
  'prerender',
  'stylesheet',
]);

/** Un `rel` qui ne déclenche AUCUN transfert : identité, navigation, méta. */
export const RELS_SANS_TELECHARGEMENT = new Set([
  'alternate',
  'archives',
  'author',
  'bookmark',
  'canonical',
  'contents',
  'external',
  'first',
  'help',
  'index',
  'last',
  'license',
  'me',
  'next',
  'nofollow',
  'payment',
  'prev',
  'privacy-policy',
  'search',
  'sitemap',
  'tag',
  'terms-of-service',
  'up',
]);

/** Schémas qui ne sortent pas du document (donc jamais « distants »). */
const SCHEMAS_LOCAUX = /^(data|blob|about|javascript|mailto|tel|sms):/i;

const MOTIF_BALISE = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const MOTIF_ATTRIBUT = /([a-zA-Z_:@][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
const MOTIF_STYLE_EN_LIGNE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const MOTIF_ATTRIBUT_STYLE = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const MOTIF_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi;
const MOTIF_IMPORT = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|"([^"]*)"|'([^']*)')/gi;
const MOTIF_IMAGE_SET = /image-set\(([^)]*)\)/gi;
const MOTIF_CHAINE = /"([^"]*)"|'([^']*)'/g;

const ENTITES = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };

/**
 * Résout les références de caractères d'une valeur d'attribut.
 *
 * Le navigateur le fait : `src="&quot;https://cdn.test/a&quot;"` lui donne une
 * URL dont les guillemets font partie, et surtout `url(&#39;/a.png&#39;)` est un
 * `url()` valide. Sans cette résolution, une déclaration distante écrite en
 * références serait lue comme un chemin relatif — donc acceptée. C'est mesuré :
 * le lecteur rendait `&quot;/fond.png&quot;` là où le HTML publie `"/fond.png"`.
 */
export const resoudreEntites = (valeur) =>
  (valeur ?? '').replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (entier, decimal, hexadecimal, nom) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hexadecimal) return String.fromCodePoint(parseInt(hexadecimal, 16));
    return ENTITES[nom.toLowerCase()] ?? entier;
  });

/** Les attributs d'une balise, en minuscules, valeurs résolues. */
export const attributsDe = (texte) => {
  const trouves = {};
  for (const m of texte.matchAll(MOTIF_ATTRIBUT)) {
    trouves[m[1].toLowerCase()] = resoudreEntites(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return trouves;
};

/** Les `rel` d'un `<link>`, séparés (« shortcut icon » en porte deux). */
export const relsDe = (valeur) =>
  (valeur ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/**
 * Le sort d'un `rel` : 'ressource', 'sans-telechargement' ou 'non-classe'.
 * Un `rel` inconnu n'est jamais supposé inoffensif.
 */
export const sorteDeRel = (valeur) => {
  const rels = relsDe(valeur);
  if (!rels.length) return 'non-classe';
  if (rels.some((rel) => RELS_RESSOURCE.has(rel))) return 'ressource';
  if (rels.every((rel) => RELS_SANS_TELECHARGEMENT.has(rel))) return 'sans-telechargement';
  return 'non-classe';
};

/** Chaque candidat d'un `srcset` (« url 1x, url2 400w »). */
export const candidatsDeSrcset = (srcset) =>
  (srcset ?? '')
    .split(',')
    .map((candidat) => candidat.trim().split(/\s+/)[0])
    .filter(Boolean);

/**
 * L'origine d'une URL, ou null si elle est relative au document.
 *
 * `//hote/chemin` (relatif au protocole) n'est PAS relatif : on garde son hôte
 * pour le comparer, sans pouvoir présumer du protocole.
 */
export const origineDe = (url) => {
  const valeur = (url ?? '').trim();
  const absolue = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/.exec(valeur);
  if (absolue) return `${absolue[1].toLowerCase()}://${absolue[2].toLowerCase()}`;
  const sansProtocole = /^\/\/([^/?#]*)/.exec(valeur);
  if (sansProtocole) return `//${sansProtocole[1].toLowerCase()}`;
  return null;
};

/** Les URL des déclarations de ressource d'un HTML. */
export const ressourcesDeclarees = (html) => {
  const declarations = [];
  for (const balise of html.matchAll(MOTIF_BALISE)) {
    const nom = balise[1].toLowerCase();
    const attributs = attributsDe(balise[2]);
    const champs = BALISES_A_RESSOURCE[nom];
    if (champs) {
      if (nom === 'link') {
        const sorte = sorteDeRel(attributs.rel);
        if (sorte === 'non-classe') {
          declarations.push({ balise: nom, attribut: 'href', url: attributs.href ?? '', sorte: 'rel-non-classe', rel: attributs.rel ?? '' });
          continue;
        }
        if (sorte !== 'ressource') continue;
      }
      for (const champ of champs) {
        if (!(champ in attributs)) continue;
        const valeurs = champ === 'srcset' ? candidatsDeSrcset(attributs[champ]) : [attributs[champ]];
        for (const url of valeurs) {
          declarations.push({ balise: nom, attribut: champ, url, sorte: 'ressource' });
        }
      }
    }
    // `style="background: url(…)"` : une ressource sans balise. La valeur est
    // résolue en entités comme celle d'un attribut de ressource.
    for (const style of balise[2].matchAll(MOTIF_ATTRIBUT_STYLE)) {
      for (const declaration of ressourcesCss(resoudreEntites(style[1] ?? style[2] ?? ''))) {
        declarations.push({ balise: nom, attribut: 'style', url: declaration.url, sorte: 'ressource', motif: declaration.motif });
      }
    }
  }
  return declarations;
};

/**
 * Les ressources déclarées par un CSS : `url()`, `@import`, chaînes d'`image-set()`.
 *
 * `@import` compte comme ressource : il télécharge une AUTRE feuille, dont le
 * contenu n'est pas dans la coquille publiée.
 */
export const ressourcesCss = (css) => {
  const source = css ?? '';
  const trouvees = [];

  const imports = [];
  for (const m of source.matchAll(MOTIF_IMPORT)) {
    const url = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
    imports.push({ debut: m.index, fin: m.index + m[0].length, url });
  }
  for (const declaration of imports) {
    if (declaration.url) trouvees.push({ motif: '@import', url: declaration.url });
  }

  // Les `@import` sont neutralisés (remplacés par des espaces, pour que les
  // index des autres déclarations ne bougent pas) AVANT la lecture des `url()` :
  // sinon un `@import url(…)` produirait DEUX entrées pour une seule
  // déclaration, et la seconde — un `url()` orphelin — ne serait pas suivie
  // comme une feuille : un relais vers un CDN passerait par là.
  let reste = source;
  for (const declaration of imports) {
    reste =
      reste.slice(0, declaration.debut) +
      ' '.repeat(declaration.fin - declaration.debut) +
      reste.slice(declaration.fin);
  }

  const declarations = [];
  for (const m of reste.matchAll(MOTIF_URL)) {
    declarations.push({ index: m.index, motif: 'url()', url: (m[1] ?? m[2] ?? m[3] ?? '').trim() });
  }
  for (const m of reste.matchAll(MOTIF_IMAGE_SET)) {
    for (const chaine of m[1].matchAll(MOTIF_CHAINE)) {
      const url = (chaine[1] ?? chaine[2] ?? '').trim();
      if (url) declarations.push({ index: m.index, motif: 'image-set()', url });
    }
  }
  declarations.sort((a, b) => a.index - b.index);
  for (const declaration of declarations) {
    if (declaration.url) trouvees.push({ motif: declaration.motif, url: declaration.url });
  }

  return trouvees;
};

/** Cette URL sort-elle des origines déclarées ? */
export const estDistante = (url, origines) => {
  const valeur = (url ?? '').trim();
  if (!valeur || valeur.startsWith('#')) return false;
  if (SCHEMAS_LOCAUX.test(valeur)) return false;
  const origine = origineDe(valeur);
  if (!origine) return false; // chemin relatif : la coquille a été servie par elle-même
  const notres = origines.map(normaliserOrigine);
  if (origine.startsWith('//')) {
    const hote = origine.slice(2);
    return !notres.some((notre) => notre === `https://${hote}` || notre === `http://${hote}`);
  }
  return !notres.includes(origine);
};

/** Les feuilles liées mêmes-origine d'un HTML, dans l'ordre, résolues en chemin. */
export const feuillesLiees = (html, coquille, buildDir) => {
  const feuilles = [];
  for (const balise of html.matchAll(MOTIF_BALISE)) {
    if (balise[1].toLowerCase() !== 'link') continue;
    const attributs = attributsDe(balise[2]);
    if (sorteDeRel(attributs.rel) !== 'ressource') continue;
    if (!relsDe(attributs.rel).includes('stylesheet')) continue;
    const href = (attributs.href ?? '').split('?')[0].split('#')[0];
    if (!href || origineDe(href)) continue;
    feuilles.push({ href, chemin: buildDir ? `${buildDir}/${href.replace(/^\/+/, '')}` : null, coquille });
  }
  return feuilles;
};

/**
 * Le verdict : toutes les ressources distantes déclarées par ces coquilles.
 *
 * Chaque entrée dit la COQUILLE, la BALISE (ou `style`/`css`), l'URL fautive et
 * le `sorte` qui explique le refus — pour qu'un rouge soit réparable sans
 * relancer le garde.
 */
export const divergencesDeRessources = ({ coquilles, origines, buildDir = null, lire = null }) => {
  const lireFichier = lire ?? ((fichier) => null);
  const divergences = [];

  for (const coquille of coquilles) {
    const html = lireFichier(coquille);
    if (html === null || html === undefined) {
      divergences.push({ sorte: 'coquille-illisible', coquille });
      continue;
    }

    for (const declaration of ressourcesDeclarees(html)) {
      if (declaration.sorte === 'rel-non-classe') {
        divergences.push({
          sorte: 'rel-non-classe',
          coquille,
          balise: declaration.balise,
          rel: declaration.rel,
          url: declaration.url,
        });
        continue;
      }
      if (!estDistante(declaration.url, origines)) continue;
      divergences.push({
        sorte: 'ressource-distante',
        coquille,
        balise: declaration.balise,
        attribut: declaration.attribut,
        url: declaration.url,
        motif: declaration.motif ?? null,
      });
    }

    // Le CSS publié PAR la coquille : blocs en ligne, puis feuilles liées
    // mêmes-origine (suivies jusqu'à `@import`), qui font aussi partie du
    // premier écran.
    const cssEnLigne = [...html.matchAll(MOTIF_STYLE_EN_LIGNE)].map((m) => m[1]);
    for (const css of cssEnLigne) {
      for (const declaration of ressourcesCss(css)) {
        if (!estDistante(declaration.url, origines)) continue;
        divergences.push({
          sorte: 'css-distante',
          coquille,
          balise: 'style',
          attribut: declaration.motif,
          url: declaration.url,
        });
      }
    }

    const vues = new Set();
    const aLire = feuillesLiees(html, coquille, buildDir).map((f) => ({ ...f, profondeur: 0 }));
    while (aLire.length) {
      const feuille = aLire.shift();
      if (!feuille.chemin || vues.has(feuille.chemin)) continue;
      vues.add(feuille.chemin);
      const css = lireFichier(feuille.chemin);
      if (css === null || css === undefined) {
        divergences.push({ sorte: 'css-illisible', coquille, url: feuille.href });
        continue;
      }
      for (const declaration of ressourcesCss(css)) {
        if (estDistante(declaration.url, origines)) {
          divergences.push({
            sorte: 'css-distante',
            coquille,
            balise: feuille.href,
            attribut: declaration.motif,
            url: declaration.url,
          });
          continue;
        }
        // Un `@import` MÊME-ORIGINE n'est pas distant, mais sa feuille
        // n'est pas dans le build : on la suit, sans quoi un CDN pourrait
        // entrer par une feuille relais.
        if (declaration.motif !== '@import' || feuille.profondeur >= 3) continue;
        if (origineDe(declaration.url)) continue;
        aLire.push({
          href: declaration.url,
          chemin: buildDir ? `${buildDir}/${declaration.url.replace(/^\/+/, '').split('?')[0]}` : null,
          coquille,
          profondeur: feuille.profondeur + 1,
        });
      }
    }
  }

  return divergences;
};

/** Combien de ressources ces coquilles déclarent (le plancher de lecture). */
export const nombreDeRessourcesLues = (html) => ressourcesDeclarees(html).length;
