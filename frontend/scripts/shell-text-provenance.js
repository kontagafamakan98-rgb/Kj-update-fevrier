#!/usr/bin/env node
/**
 * La PROVENANCE du texte publié par une coquille : chaque fragment visible d'un
 * HTML pré-rendu doit venir d'un texte que la PAGE possède.
 *
 * ── Le trou que ce module ferme ────────────────────────────────────────────
 * Les passes précédentes ont donné un propriétaire unique aux textes que le
 * plan NOMME (`legalNoticeTitle`, `contactWhatsapp`, `step1NumberKey`…) : le
 * garde des coquilles compare chacun de ces textes déclarés. Mais la liste des
 * textes comparés est une liste DÉCLARÉE : un fragment que personne n'a déclaré
 * — un mot ajouté à la main dans une coquille, une phrase restée dans le plugin
 * après que la page a changé — ne comparaît rien et passait en silence. C'est
 * exactement la classe de défaut que ces passes ont corrigée trois fois à la
 * main.
 *
 * ── La règle, et pourquoi elle est STRICTE ─────────────────────────────────
 * Un fragment publié par une coquille est légitime si, et seulement si :
 *
 *   1. il est EXACTEMENT un texte que la page peut publier — un littéral de
 *      `src/` (JS, JSX, JSON), ou un nœud de texte du gabarit
 *      `frontend/index.html` (qui porte le message `noscript`) ; ou
 *   2. il est une COMPOSITION de tels textes entiers, joints par un séparateur
 *      visible (` `, `·`, `:`, `—`, `/`, `,`…) ; ou
 *   3. c'est une VALEUR DÉRIVÉE DÉCLARÉE — un nombre (aucune lettre), la date du
 *      jour rendue par les mêmes options `Intl` que le code, ou une valeur
 *      rendue par les configs que la page lit (`phoneNumberExample`,
 *      `COUNTRY_PLACEHOLDER`, `photoFormatsLine`, les champs de `CONTACT`).
 *
 * Le point 2 est ce qui rend la règle stricte SANS être inutilisable : un
 * fragment ne peut pas être « contenu dans » un texte plus long (sinon un mot
 * au hasard serait toujours couvert par une phrase qui le contient), il doit
 * être un texte entier, ou un assemblage de textes entiers. Vérifié sur l'arbre
 * réel : les 13 coquilles publient 336 fragments et aucun n'a besoin d'autre
 * chose que ces trois cas.
 *
 * Ce que la règle NE couvre pas, et qu'il faut savoir : le corpus est ce que la
 * page PEUT publier, pas ce qu'elle publie sur la route correspondante. Un
 * fragment légitime sur /login mais publié par la coquille de /jobs passerait
 * ici (les deux sont des textes de la maison) — le rapprochement route par
 * route est le travail du garde des coquilles, qui compare les textes déclarés.
 *
 * Un texte COMMENTÉ ne publie rien : le lecteur de littéraux ignore les
 * commentaires et les expressions régulières, sinon une apostrophe dans un
 * commentaire ferait dériver tout ce qui suit (mesuré : sans cette précaution,
 * `'24/7'` et `'📝'` disparaissaient du corpus).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONTACT } from '../src/config/contact.js';
import { COUNTRY_PLACEHOLDER } from '../src/config/country-placeholder.js';
import {
  PHONE_NUMBER_MASK,
  PHONE_PREFIX_FALLBACK,
  phoneNumberExample,
} from '../src/config/phone-format.js';
import {
  PHOTO_FORMATS,
  PHOTO_MAX_SIZE,
  photoFormatsLine,
} from '../src/config/photo-formats.js';

/** Les langues dont les dictionnaires alimentent les valeurs dérivées. */
const LANGUES = ['fr', 'en', 'wo', 'bm', 'mos'];

/** Ce qui sépare deux textes entiers dans un fragment composé. */
export const SEPARATEURS = [' ', ' · ', '·', ' | ', '|', ': ', ' : ', ':', ' — ', '—', ' – ', '–', ' - ', '-', ' / ', '/', ', ', ',', '. ', '.', '(', ')'];

const DOSSIERS_HORS_CORPUS = new Set(['__tests__', 'node_modules']);

const ESPACES = /\s+/g;

/** Un fragment publié : entités HTML résolues, espaces normalisés. */
export const normaliser = (texte) => {
  const entites = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
  return String(texte)
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m) => entites[m])
    .replace(ESPACES, ' ')
    .trim();
};

/**
 * Un `/` ouvre-t-il une expression régulière (et non une division) ? On regarde
 * le dernier caractère SIGNIFICATIF avant lui — un espace ne change rien à la
 * question, et `= /["']/g` doit être reconnu comme une régulière, sinon la quote
 * qu'elle contient désynchronise la lecture de tout ce qui suit (mesuré : le
 * littéral suivant disparaissait du corpus).
 */
const COMMENCE_UNE_REGULIERE = '=(,:[!&|?{};\n';
const MOTS_CLES_REGULIERE = ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await', 'delete', 'void', 'instanceof', 'new'];
const commenceUneReguliere = (source, position) => {
  let i = position - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return true;
  if (COMMENCE_UNE_REGULIERE.includes(source[i])) return true;
  const avant = source.slice(0, i + 1).match(/[A-Za-z_$]+$/);
  return Boolean(avant && MOTS_CLES_REGULIERE.includes(avant[0]));
};

/**
 * Une apostrophe PRÉCÉDÉE D'UNE LETTRE ne peut pas ouvrir un littéral en
 * JavaScript : un identifiant suivi d'une quote est une erreur de syntaxe. Ce
 * `'` est donc de la copie — le texte JSX publie `l'emploi`.
 *
 * Sans cette précision, la quote ouvrait un FAUX littéral qui masquait tout ce
 * qui suit jusqu'à la quote suivante (mesuré : le nœud de texte
 * « … disponible sur l'application mobile native » s'arrêtait sur son
 * apostrophe, et la copie JSX devenait invisible — y compris pour `textesJsx`,
 * qui lit ce que le masque laisse).
 */
const estUneApostropheDeTexte = (source, position) => /\p{L}/u.test(source[position - 1] ?? '');

/**
 * Les littéraux de chaîne d'un fichier JS/JSX, commentaires et expressions
 * régulières écartés, échappements interprétés comme le fait le moteur. Chaque
 * littéral retient son INDEX de début, ce qui permet d'en donner la ligne
 * (`litterauxLocalises`) sans relire le fichier une seconde fois.
 */
const scannerLiteraux = (source) => {
  const echappements = { n: ' ', t: ' ', r: ' ', '"': '"', "'": "'", '`': '`', '\\': '\\' };
  const literaux = [];
  // Les zones qui ne PUBLIENT rien : commentaires, expressions régulières,
  // littéraux. Le texte JSX se lit dans ce que ces zones laissent (voir
  // `textesJsx`) — un seul lecteur sait ce qu'est du code.
  const codes = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const fin = source.indexOf('\n', i);
      codes.push([i, (fin < 0 ? source.length : fin) - 1]);
      i = fin < 0 ? source.length : fin;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const fin = source.indexOf('*/', i + 2);
      codes.push([i, (fin < 0 ? source.length : fin + 2) - 1]);
      i = fin < 0 ? source.length : fin + 2;
      continue;
    }
    if (c === '/' && commenceUneReguliere(source, i)) {
      let j = i + 1;
      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === '/') break;
        j += 1;
      }
      codes.push([i, j]);
      i = j + 1;
      continue;
    }
    if (c === '"' || c === '`' || (c === "'" && !estUneApostropheDeTexte(source, i))) {
      let j = i + 1;
      let valeur = '';
      while (j < source.length) {
        if (source[j] === '\\' && j + 1 < source.length) {
          const suivante = source[j + 1];
          valeur += suivante in echappements ? echappements[suivante] : suivante;
          j += 2;
          continue;
        }
        if (source[j] === c) break;
        valeur += source[j];
        j += 1;
      }
      literaux.push({ valeur, debut: i, fin: j, quote: c });
      codes.push([i, j]);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return { literaux, codes };
};

/** Les littéraux d'un fichier, avec leur ligne (1-indexée). */
export const litterauxLocalises = (source) => {
  const lignes = source.split('\n');
  return scannerLiteraux(source).literaux.map(({ valeur, debut }) => {
    let ligne = 1;
    let compte = 0;
    while (ligne <= lignes.length && compte + lignes[ligne - 1].length < debut) {
      compte += lignes[ligne - 1].length + 1;
      ligne += 1;
    }
    return { valeur, ligne };
  });
};

export const litterauxJs = (source) => scannerLiteraux(source).literaux.map(({ valeur }) => valeur);

/**
 * Les nœuds de texte JSX d'un fichier — la copie écrite ENTRE DEUX BALISES —
 * avec leur ligne et leurs bornes.
 *
 * Un texte JSX n'est pas un littéral dans les sources, mais il en DEVIENT un
 * dans le bundle compilé (`<p>l'appareil</p>` → `children: "l'appareil"`) : il
 * est donc publié, et une lecture de littéraux ne le voit que dans le build — où
 * le fichier fautif porte un nom de CHUNK, qui change à chaque build et n'est
 * pas éditable. Ce lecteur lit la même copie là où elle s'écrit.
 *
 * Un nœud de texte commence après une FERMETURE de balise (`>`) et finit aux
 * bornes du balisage (`<`, `{`, `}`, `>`) ou à la zone de code suivante
 * (commentaire, régulière, littéral : masqués par le même scanner). Ce qu'il ne
 * prend donc pas : une expression (`{t('x')}`) et un attribut (`title=…`, qui
 * publie aussi — il est couvert, côté sources, par la lecture des littéraux).
 *
 * Il peut rendre des fragments de CODE qui suivent un `>` de comparaison
 * (`a > b`) : le contrôle qui le consomme ne cherche que l'apostrophe de copie
 * — celle qui joint deux lettres — et celle-là ne peut pas vivre dans du code.
 */
export const textesJsx = (source) => {
  const { codes } = scannerLiteraux(source);
  const masque = new Uint8Array(source.length);
  for (const [codeDebut, codeFin] of codes) {
    for (let i = codeDebut; i <= codeFin && i < source.length; i += 1) masque[i] = 1;
  }
  const bornes = new Set(['<', '{', '}', '>']);
  const textes = [];
  let debut = null;
  let ligne = 1;
  let ligneDebut = 1;
  let apresFermeture = false;
  const vider = (fin) => {
    if (debut === null) return;
    const brut = source.slice(debut, fin);
    const depart = debut;
    debut = null;
    const droite = brut.length - brut.trimEnd().length;
    const arrivee = fin - droite;
    if (arrivee <= depart) return;
    const propre = normaliser(source.slice(depart, arrivee));
    // Un texte publié : des lettres, et rien qui trahisse du code.
    if (!/\p{L}/u.test(propre) || /[{}()=;]/.test(propre)) return;
    textes.push({ valeur: propre, ligne: ligneDebut, debut: depart, fin: arrivee });
  };
  for (let i = 0; i <= source.length; i += 1) {
    const c = source[i];
    if (c === '\n') ligne += 1;
    if (i >= source.length || masque[i] || bornes.has(c)) {
      vider(i);
      apresFermeture = Boolean(masque[i] || i >= source.length) ? false : c === '>';
      continue;
    }
    if (debut !== null) continue;
    if (!apresFermeture || /\s/.test(c)) continue;
    debut = i;
    ligneDebut = ligne;
  }
  return textes;
};

/** Les fragments de texte VISIBLES d'un HTML (ni balise, ni script, ni commentaire). */
export const fragmentsVisibles = (html) =>
  String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map(normaliser)
    .filter(Boolean);

const chainesDeJson = (texte) => {
  let valeur;
  try {
    valeur = JSON.parse(texte);
  } catch {
    return [];
  }
  const sortie = [];
  const pile = [valeur];
  while (pile.length) {
    const v = pile.pop();
    if (v && typeof v === 'object') pile.push(...Object.values(v), ...(Array.isArray(v) ? v : []));
    else if (typeof v === 'string') sortie.push(v);
  }
  return sortie;
};

/** Tous les textes que la PAGE peut publier : les atomes du corpus. */
export const atomesDeLaPage = (frontendDir) => {
  const atomes = new Set();
  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (!DOSSIERS_HORS_CORPUS.has(entree.name)) parcourir(chemin);
        continue;
      }
      const extension = path.extname(entree.name);
      if (!['.js', '.jsx', '.json'].includes(extension)) continue;
      const texte = readFileSync(chemin, 'utf8');
      const valeurs = extension === '.json'
        ? chainesDeJson(texte)
        : litterauxJs(texte).filter((l) => l.length < 400);
      for (const v of valeurs) {
        const propre = normaliser(v);
        if (propre) atomes.add(propre);
      }
    }
  };
  parcourir(path.join(frontendDir, 'src'));
  // Le gabarit porte le message `noscript` : c'est de la copie de la page.
  for (const fragment of fragmentsVisibles(readFileSync(path.join(frontendDir, 'index.html'), 'utf8'))) {
    atomes.add(fragment);
  }
  return atomes;
};

/** Les valeurs CALCULÉES que la page peut publier — déclarées, jamais recopiées. */
export const valeursDerivees = (frontendDir) => {
  const derivees = new Set();
  const mots = new Set();
  for (const langue of LANGUES) {
    const dictionnaire = JSON.parse(
      readFileSync(path.join(frontendDir, 'src', 'i18n', `${langue}.json`), 'utf8')
    );
    for (const valeur of Object.values(dictionnaire)) {
      if (typeof valeur === 'string') mots.add(valeur);
    }
  }
  for (const prefixe of ['', PHONE_PREFIX_FALLBACK, PHONE_NUMBER_MASK]) {
    mots.add(prefixe);
    derivees.add(normaliser(phoneNumberExample(prefixe)));
  }
  for (const mot of mots) {
    derivees.add(normaliser(COUNTRY_PLACEHOLDER(mot)));
    derivees.add(normaliser(photoFormatsLine(mot)));
    derivees.add(normaliser(phoneNumberExample(mot)));
  }
  // La date du jour : les DEUX options que le dépôt utilise réellement
  // (`prerender-route-meta.js` et `Jobs.js` formatent « aujourd'hui » chacun de
  // leur côté — le garde accepte la valeur publiée, il ne juge pas la double
  // dérivation, qui est un défaut de propriétaire, pas de provenance).
  for (const jour of ['2-digit', 'numeric']) {
    derivees.add(
      normaliser(
        new Intl.DateTimeFormat('fr-FR', { day: jour, month: 'long', year: 'numeric' }).format(new Date())
      )
    );
    derivees.add(
      normaliser(
        new Intl.DateTimeFormat('fr-FR', { day: jour, month: 'short', year: 'numeric' }).format(new Date())
      )
    );
  }
  for (const valeur of Object.values(CONTACT)) {
    if (typeof valeur === 'string') derivees.add(normaliser(valeur));
    if (valeur && typeof valeur === 'object') {
      for (const sous of Object.values(valeur)) {
        if (typeof sous === 'string') derivees.add(normaliser(sous));
      }
    }
  }
  return derivees;
};

/** Un fragment sans aucune lettre est une valeur calculée (un nombre, un signe). */
const sansLettre = (fragment) => !/[A-Za-z\u00C0-\u00FF]/.test(fragment);

/**
 * Les fragments publiés par une coquille qui ne viennent d'AUCUN texte de la
 * page — chacun avec les deux textes les plus proches, pour qu'un humain sache
 * quoi corriger.
 *
 * @param coquilles chemins ABSOLUS des HTML pré-rendus.
 * @param atomes textes de la page (voir atomesDeLaPage).
 * @param derivees valeurs calculées déclarées (voir valeursDerivees).
 */
export const divergencesDeProvenance = ({ coquilles, atomes, derivees = new Set() }) => {
  const legitimés = new Set([...atomes, ...derivees]);
  const parLongueur = [...legitimés].filter((t) => t && t !== ' ').sort((a, b) => b.length - a.length);
  const memo = new Map();

  const compose = (fragment, profondeur = 0) => {
    if (!fragment) return true;
    if (legitimés.has(fragment) || sansLettre(fragment)) return true;
    if (profondeur > 10) return false;
    if (memo.has(fragment)) return memo.get(fragment);
    memo.set(fragment, false);
    for (const texte of parLongueur) {
      if (!fragment.startsWith(texte)) continue;
      const reste = fragment.slice(texte.length);
      if (!reste) return true;
      for (const separateur of SEPARATEURS) {
        if (!separateur || !reste.startsWith(separateur)) continue;
        if (compose(reste.slice(separateur.length).trim(), profondeur + 1)) {
          memo.set(fragment, true);
          return true;
        }
      }
    }
    return false;
  };

  // Les textes de la page les plus proches du fragment, pour rendre le refus
  // actionnable (« la page dit plutôt … »). Deux signaux seulement, parce qu'un
  // simple mot commun ne prouve rien : il rapprochait un fragment inventé d'un
  // long paragraphe qui contenait « page » (mesuré sur la mutation réelle).
  //   * une SUITE de deux mots consécutifs partagés — un vrai début de phrase ;
  //   * ou un mot DISTINCTIF (6 lettres et plus) partagé avec un texte COURT,
  //     ce qui nomme « Connexion » pour « Connexion sécurisée maintenant ».
  const prochesDe = (fragment) => {
    const motsFragment = fragment.toLowerCase().split(/\W+/).filter((m) => m.length > 3);
    if (!motsFragment.length) return [];
    return parLongueur
      .map((texte) => {
        const motsTexte = texte.toLowerCase().split(/\W+/);
        const ensemble = new Set(motsTexte);
        const partages = motsFragment.filter((m) => ensemble.has(m));
        let suite = 0;
        for (let i = 0; i < motsFragment.length; i += 1) {
          for (let j = 0; j < motsTexte.length; j += 1) {
            let longueur = 0;
            while (motsFragment[i + longueur] && motsFragment[i + longueur] === motsTexte[j + longueur]) longueur += 1;
            suite = Math.max(suite, longueur);
          }
        }
        const distinctif = partages.some((m) => m.length >= 6) && texte.length <= 40;
        return { texte, score: (suite >= 2 ? 2 : 0) + (distinctif ? 1 : 0), partages: partages.length };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.partages - a.partages)
      .slice(0, 2)
      .map(({ texte }) => (texte.length > 90 ? `${texte.slice(0, 87)}…` : texte));
  };

  const divergences = [];
  for (const coquille of coquilles) {
    const nom = path.basename(coquille);
    const vus = new Set();
    for (const fragment of fragmentsVisibles(readFileSync(coquille, 'utf8'))) {
      if (fragment.length < 2 || vus.has(fragment)) continue;
      vus.add(fragment);
      if (compose(fragment)) continue;
      divergences.push({ coquille: nom, fragment, proches: prochesDe(fragment) });
    }
  }
  return divergences;
};

/**
 * ── Les MARQUEURS : qui détient un glyphe publié ───────────────────────────
 *
 * Un marqueur (logo, numéro d'étape, emoji, repère, ponctuation) n'est PAS du
 * texte : il n'a pas de clé « de phrase ». Deux réponses possibles, et UNE
 * SEULE à la fois :
 *
 *   * PORTEUR PARTAGÉ — une clé du dictionnaire le détient et les deux canaux la
 *     résolvent : le plan la nomme (`step1NumberKey`…), la page l'affiche par
 *     `t()`, la coquille par `T()`. C'est le cas du logo (`brandMark`), des
 *     numéros d'étape (`stepNumber1..3`) et du repère de la FAQ (`faqMarker`).
 *     Les glyphes `icon*` du dictionnaire (📜 ⚠️ 👤…), eux, ne sont PLUS publiés
 *     par aucune coquille depuis le 26/09/2026 : ils sont DESSINÉS (icônes SVG,
 *     voir plus bas). Ils restent au dictionnaire comme valeurs INTERDITES en
 *     littéral (`GLYPHES_INTERDITS`, check-prerender-shells).
 *   * EXEMPTION DOCUMENTÉE — la valeur n'est pas un glyphe du produit : le
 *     SUFFIXE d'un chiffre (`1 000+`, partie du nombre), ou la ponctuation de
 *     mise en page (` · `), qui n'a pas de clé parce qu'elle n'est pas du texte.
 *     Chaque exemption est déclarée ici, avec son motif, et la liste est EXACTE :
 *     une exemption devenue inutile rougit.
 *
 * Tous les AUTRES glyphes que le plan détenait en littéral (catégories, promesses,
 * étapes, cartes d'À propos, modes et lignes du support, cartes de type de
 * compte, notices, sélecteur de pays…) sont désormais DESSINÉS — `icone` dans une
 * liste, `*Icon` au niveau route — et résolus par le même registre
 * (src/config/page-icons.js) : le plan ne porte plus un seul octet de glyphe. La
 * règle 1 ci-dessous reste la garde de ce mouvement — elle refuse la
 * RÉINTRODUCTION d'un littéral — et la règle 4 vérifie que chaque exemption
 * déclarée est encore utile.
 *
 * Les deux défauts refusés : un littéral du plan qui RECOPIE la valeur d'une clé
 * (changer la clé laisserait la copie derrière, en silence — c'était le cas du
 * bouclier du séquestre, déclaré en clé pour le bloc de séquestre et recopié en
 * littéral pour l'étape 2 de la même page), et un marqueur PUBLIÉ par une
 * coquille que personne ne détient — le trou que la règle de provenance
 * laissait ouvert, puisqu'un fragment sans aucune lettre y était accepté tel
 * quel.
 */

/** Les clés du dictionnaire qui détiennent un MARQUEUR (et non une phrase). */
export const CLE_MARQUEUR = /^(icon[A-Z]\w*|brandMark|faqMarker|stepNumber\d)$/;

/** Le plan du corps des pages : le seul fichier qui déclare les listes. */
const PLAN_DES_SECTIONS = 'src/config/page-sections.js';

/** Le dictionnaire d'une langue : un seul lecteur pour tout ce module. */
const dictionnaire = (frontendDir, langue = 'fr') =>
  JSON.parse(readFileSync(path.join(frontendDir, 'src', 'i18n', `${langue}.json`), 'utf8'));

/**
 * Les CLÉS du dictionnaire. Un littéral qui EST une clé n'est pas de la copie :
 * c'est le NOM de la clé, c'est-à-dire la façon dont une coquille résout son
 * texte (`T('login')`, `plan.step1NumberKey`). Un texte affiché, lui, n'est
 * jamais un nom de clé.
 */
export const clesDuDictionnaire = (frontendDir, langue = 'fr') =>
  new Set(Object.keys(dictionnaire(frontendDir, langue)));

/** Les valeurs de marqueur du dictionnaire : valeur -> clés qui la détiennent. */
export const valeursMarqueur = (frontendDir, langue = 'fr') => {
  const parValeur = new Map();
  for (const [cle, valeur] of Object.entries(dictionnaire(frontendDir, langue))) {
    if (typeof valeur !== 'string' || !CLE_MARQUEUR.test(cle)) continue;
    if (!parValeur.has(valeur)) parValeur.set(valeur, []);
    parValeur.get(valeur).push(cle);
  }
  return parValeur;
};

/** Le champ d'une entrée du plan qui porte un marqueur en littéral. */
const CHAMP_MARQUEUR = /(?:icon|shellIcon|suffix): '([^']*)'/;

/** Le champ d'une entrée du plan qui porte un marqueur par sa CLÉ i18n. */
const CHAMP_CLE_MARQUEUR = /(?:iconKey|shellIconKey): '([^']*)'/;

/** Les littéraux de marqueur du plan, avec leur ligne. */
export const marqueursDuPlan = (frontendDir) => {
  const sortie = [];
  readFileSync(path.join(frontendDir, PLAN_DES_SECTIONS), 'utf8')
    .split('\n')
    .forEach((ligne, index) => {
      const trouve = ligne.match(CHAMP_MARQUEUR);
      if (trouve) sortie.push({ valeur: trouve[1], ligne: index + 1 });
    });
  return sortie;
};

/**
 * Les marqueurs qu'une coquille publie : un fragment SANS LETTRE (un nombre, un
 * signe, un drapeau, de la ponctuation) ou un fragment qui est EXACTEMENT la
 * valeur d'un marqueur du dictionnaire (le logo `K`, par exemple).
 */
export const marqueursPublies = (coquilles, parValeur = new Map()) => {
  const sortie = [];
  for (const coquille of coquilles) {
    const nom = path.basename(coquille);
    for (const fragment of new Set(fragmentsVisibles(readFileSync(coquille, 'utf8')))) {
      const candidat = sansLettre(fragment) || parValeur.has(fragment);
      if (candidat) sortie.push({ coquille: nom, valeur: fragment });
    }
  }
  return sortie;
};

/** Les littéraux que la page peut lire : tout `src/config` (dont le plan). */
const literauxDeConfig = (frontendDir) => {
  const valeurs = new Set();
  const dossier = path.join(frontendDir, 'src', 'config');
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (!entree.isFile()) continue;
    const extension = path.extname(entree.name);
    if (!['.js', '.jsx', '.json'].includes(extension)) continue;
    const texte = readFileSync(path.join(dossier, entree.name), 'utf8');
    const brutes = extension === '.json' ? chainesDeJson(texte) : litterauxJs(texte);
    for (const brute of brutes) {
      const propre = normaliser(brute);
      if (propre) valeurs.add(propre);
    }
  }
  return valeurs;
};

/**
 * Les LITTÉRAUX des deux canaux : le plan et les modules de pré-rendu. Les
 * commentaires sont écartés (`litterauxJs`) — sinon une clé citée dans un
 * commentaire suffirait à prouver qu'un marqueur est détenu, et le contrôle
 * serait décoratif (c'est exactement le piège mesuré sur la provenance du texte,
 * où une apostrophe de commentaire faisait disparaître les littéraux suivants).
 */
const sourcesDesCanaux = (frontendDir) => {
  const sources = [];
  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (!DOSSIERS_HORS_CORPUS.has(entree.name)) parcourir(chemin);
        continue;
      }
      if (chemin.endsWith('.js')) sources.push(readFileSync(chemin, 'utf8'));
    }
  };
  parcourir(path.join(frontendDir, 'vite-plugins'));
  sources.push(readFileSync(path.join(frontendDir, PLAN_DES_SECTIONS), 'utf8'));
  const literaux = new Set();
  for (const source of sources) {
    for (const valeur of litterauxJs(source)) literaux.add(normaliser(valeur));
  }
  return literaux;
};

export const MARQUEURS_EN_EXEMPTION = [
  {
    valeur: '+',
    sorte: 'plan',
    motif:
      "suffixe d'un chiffre, dans la composition d'un chiffre affiché (`1 000+`, `500+`) : " +
      "ce n'est pas un glyphe mais une partie du NOMBRE, donc il reste au plan — le repère " +
      'du dépliant de la FAQ, lui, est la clé `faqMarker`',
  },
  {
    valeur: '·',
    sorte: 'publie',
    motif:
      "ponctuation de mise en page entre deux liens, écrite en littéral par les coquilles " +
      "(4 sites) comme par les pages (`{' · '}` dans Home, About, Contact, Privacy, " +
      'HowItWorks, Support) : ce n\'est pas du texte, donc elle n\'a pas de clé ; lui donner ' +
      'UN propriétaire demanderait une constante que les deux canaux importent, hors du ' +
      'périmètre de cette passe',
  },
];

/**
 * Le champ d'une entrée du plan qui nomme une icône DESSINÉE — l'autre façon,
 * depuis le 26/09/2026, de donner un domicile à un glyphe : on ne le publie plus
 * comme un caractère (emoji), on le DESSINE. Deux formes : `icone: 'nom'` dans
 * une LISTE d'entrées (catégories, étapes, lignes de contact…) et un champ de
 * niveau ROUTE terminé par `Icon` (`legalNoticeIcon`, `clientIcon`…) — la
 * dernière vague, /login, /register, /forgot-password et /payment. Le nom doit
 * exister dans le registre, sinon `IconePage` lève au build.
 */
const CHAMP_ICONE_DESSINEE = /(?:\bicone|\b\w+Icon): '([^']*)'/;

/** Les icônes dessinées déclarées par le plan, avec leur ligne. */
export const iconesDuPlan = (frontendDir) => {
  const sortie = [];
  readFileSync(path.join(frontendDir, PLAN_DES_SECTIONS), 'utf8')
    .split('\n')
    .forEach((ligne, index) => {
      const trouve = ligne.match(CHAMP_ICONE_DESSINEE);
      if (trouve) sortie.push({ nom: trouve[1], ligne: index + 1 });
    });
  return sortie;
};

/** Les clés de glyphe déclarées par le plan, avec leur ligne. */
export const clesDeGlypheDuPlan = (frontendDir) => {
  const sortie = [];
  readFileSync(path.join(frontendDir, PLAN_DES_SECTIONS), 'utf8')
    .split('\n')
    .forEach((ligne, index) => {
      const trouve = ligne.match(CHAMP_CLE_MARQUEUR);
      if (trouve) sortie.push({ cle: trouve[1], ligne: index + 1 });
    });
  return sortie;
};

/**
 * Les marqueurs publiés par une coquille qui n'ont NI porteur partagé, ni
 * exemption : chacun avec la raison du refus.
 *
 * @param frontendDir racine du frontend (dictionnaires, plan, config, plugin).
 * @param coquilles chemins ABSOLUS des HTML pré-rendus.
 * @param exemptions la liste documentée (voir MARQUEURS_EN_EXEMPTION).
 */
export const divergencesDeMarqueur = ({
  frontendDir,
  coquilles = [],
  exemptions = MARQUEURS_EN_EXEMPTION,
}) => {
  const parValeur = valeursMarqueur(frontendDir);
  const exemptionsParValeur = new Map(exemptions.map((e) => [e.valeur, e]));
  const champsDuPlan = marqueursDuPlan(frontendDir);
  const publies = marqueursPublies(coquilles, parValeur);
  const config = literauxDeConfig(frontendDir);
  const derivees = valeursDerivees(frontendDir);
  // Les littéraux des deux canaux : un marqueur est à porteur partagé si la clé
  // qui le détient est NOMMÉE dans un littéral — par le plan
  // (le plan nomme la clé du marqueur) ou par un module qui la résout
  // (`T('brandMark')`, y compris à l'intérieur d'un gabarit). Les commentaires
  // sont écartés, donc une clé citée dans un commentaire ne prouve rien.
  const canaux = [...sourcesDesCanaux(frontendDir)].join('\n');
  const nommeLaCle = (cle) => new RegExp(`\\b${cle}\\b`).test(canaux);
  const divergences = [];

  // 1. Un littéral du plan qui RECOPIE la valeur d'une clé : le glyphe a déjà un
  //    domicile (le dictionnaire), donc la copie dérivera en silence. Corriger
  //    en lisant la clé (`iconKey`) ou en déclarant l'exemption avec son motif.
  for (const { valeur, ligne } of champsDuPlan) {
    const cles = parValeur.get(valeur);
    if (!cles || exemptionsParValeur.has(valeur)) continue;
    divergences.push({
      sorte: 'plan-recopie',
      fichier: PLAN_DES_SECTIONS,
      ligne,
      valeur,
      cles,
    });
  }

  // 2. Un marqueur PUBLIÉ que personne ne détient : aucune clé nommée par le
  //    plan ou par un module, aucune config de page, aucune valeur dérivée
  //    déclarée. C'est le marqueur « de nulle part ».
  for (const { coquille, valeur } of publies) {
    if (exemptionsParValeur.has(valeur)) continue;
    if (config.has(valeur) || derivees.has(valeur)) continue;
    const cles = parValeur.get(valeur);
    if (cles && cles.some(nommeLaCle)) continue;
    divergences.push({ sorte: 'marqueur-sans-porteur', coquille, valeur });
  }

  // 3. Une clé de glyphe que le plan déclare sans que le dictionnaire la
  //    connaisse : la coquille publierait le NOM de la clé (visible), ou rien.
  const clesConnues = new Set(Object.keys(dictionnaire(frontendDir)));
  for (const { cle, ligne } of clesDeGlypheDuPlan(frontendDir)) {
    if (clesConnues.has(cle)) continue;
    divergences.push({ sorte: 'cle-inconnue', fichier: PLAN_DES_SECTIONS, ligne, cle });
  }

  // 4. Une exemption qui ne correspond plus à rien : une exemption périmée est
  //    une décision oubliée, pas une protection. La fraîcheur se juge sur les
  //    SOURCES (le plan pour une exemption de plan, les modules de pré-rendu et
  //    les configs pour une exemption de marqueur publié), jamais sur les
  //    coquilles que l'appelant a passées : le garde reste ainsi vérifiable sur
  //    une fixture sans que la liste dépende du build d'appel.
  const sourcesEcrites = `${canaux}\n${[...config].join('\n')}`;
  for (const { valeur, sorte, motif } of exemptions) {
    const encore = sorte === 'plan'
      ? champsDuPlan.some((champ) => champ.valeur === valeur)
      : sourcesEcrites.includes(valeur);
    if (encore) continue;
    divergences.push({ sorte: 'exemption-perimee', valeur, motif });
  }

  return divergences;
};

/**
 * ── La COPIE EN DUR dans un module qui écrit une coquille ──────────────────
 *
 * La provenance regarde ce que la coquille PUBLIE ; cette règle regarde d'où le
 * module l'écrit. Un texte affiché écrit en littéral dans un module de
 * pré-rendu (`<h1>Connexion</h1>`) est le chemin par lequel la classe de défaut
 * que ce garde ferme revient, un mot à la fois : le jour où la page change son
 * mot, la coquille continue de publier l'ancien, et rien ne le compare.
 *
 * Ce qui est refusé, mesuré et non deviné : un littéral de module qui PORTE UNE
 * LETTRE (la ponctuation est le sujet des marqueurs, pas de la copie) et qui
 * apparaît comme un MOT dans un fragment visible d'une coquille construite — et
 * qui n'est pas le NOM d'une clé du dictionnaire (un module écrit `'login'`, la
 * coquille publie « Connexion »).
 *
 * Ce que la règle ne couvre pas : un module qui écrirait la même copie avec une
 * faute qui n'est publiée par aucune coquille du build (mort), ou une copie
 * assemblée caractère par caractère au point de ne ressembler à aucun mot.
 */

/** Les modules qui écrivent des coquilles : l'arbre de `prerender/` et sa façade. */
export const modulesDesCoquilles = (modulesDir) => {
  const modules = [];
  const dossierPrerender = path.join(modulesDir, 'prerender');
  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (!DOSSIERS_HORS_CORPUS.has(entree.name)) parcourir(chemin);
        continue;
      }
      if (chemin.endsWith('.js')) modules.push(chemin);
    }
  };
  if (existsSync(dossierPrerender)) parcourir(dossierPrerender);
  const facade = path.join(modulesDir, 'prerender-route-meta.js');
  if (existsSync(facade)) modules.push(facade);
  return modules.sort();
};

/** Le fragment publie-t-il ce texte comme un MOT, et non comme un morceau ? */
const contientLeMot = (fragment, texte) => {
  if (fragment === texte) return true;
  const borne = texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${borne}([^\\p{L}\\p{N}]|$)`, 'u').test(fragment);
};

/**
 * Les textes affichés écrits en littéral dans un module qui fabrique une
 * coquille : chacun avec son module, sa ligne et le texte.
 *
 * @param modulesDir le dossier `vite-plugins` (celui qui a produit le build).
 * @param coquilles chemins ABSOLUS des HTML pré-rendus.
 * @param cles les clés du dictionnaire (voir clesDuDictionnaire).
 */
export const copieEnDurDansLesShells = ({ modulesDir, coquilles = [], cles = new Set() }) => {
  const fragments = new Set();
  for (const coquille of coquilles) {
    for (const fragment of fragmentsVisibles(readFileSync(coquille, 'utf8'))) {
      if (fragment) fragments.add(fragment);
    }
  }
  const publies = [...fragments];
  const divergences = [];
  for (const module of modulesDesCoquilles(modulesDir)) {
    for (const { valeur, ligne } of litterauxLocalises(readFileSync(module, 'utf8'))) {
      // Le littéral peut être un morceau de HTML (`<h1>Connexion</h1>`) : c'est
      // son TEXTE qui serait affiché, donc les balises sont écartées comme le
      // fait la lecture des fragments publiés.
      const texte = normaliser(valeur.replace(/<[^>]*>/g, ' '));
      if (!/\p{L}/u.test(texte)) continue;
      if (cles.has(texte)) continue;
      const publie = publies.some((fragment) => fragment.includes(texte) && contientLeMot(fragment, texte));
      if (!publie) continue;
      divergences.push({
        module: path.relative(modulesDir, module).split(path.sep).join('/'),
        ligne,
        texte,
      });
    }
  }
  return divergences;
};

/** L'ensemble des coquilles HTML écrites par le build. */
export const coquillesPubliees = (buildDir) =>
  readdirSync(buildDir)
    .filter((nom) => nom.endsWith('.html'))
    .sort()
    .map((nom) => path.join(buildDir, nom));
