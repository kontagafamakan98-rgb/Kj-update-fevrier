// L'ÉQUILIBRE DES BALISES d'un document pré-rendu — la règle, et le refus.
//
// POURQUOI CETTE RÈGLE EXISTE, et pourquoi elle ne peut pas vivre dans une
// sonde de NAVIGATEUR. Mesuré le 27/09/2026 : la section des étapes du shell
// d'accueil ne refermait pas son conteneur `max-w-7xl` (68 `<div>` ouverts pour
// 67 refermés). TOUTES les sondes de navigateur restaient vertes — parité de
// hauteur, de texte et de CLS comprises, 113/113 — parce que le parseur HTML
// RÉPARE : un `</section>` dont la section est en portée referme d'abord les
// `div` encore ouverts, donc l'arbre obtenu était exactement celui qui était
// voulu. Le défaut n'existait que pour qui LIT le document (un crawler sans
// JavaScript, un lecteur d'accessibilité, un outil qui extrait le `#root`) —
// c'est-à-dire là où le shell est publié, pas là où il est peint.
//
// Ce que cette règle refuse, et ce qu'elle ne refuse PAS :
//
//   • un élément ouvert et JAMAIS refermé (`<div>` sans `</div>`) ;
//   • un élément REFERMÉ EN PORTÉE par une balise d'un autre nom — le cas
//     mesuré : `</section>` referme un `<div>` resté ouvert. Le refus le NOMME
//     (`fermeePar`), parce que c'est la seule trace du défaut dans le texte ;
//   • une balise fermante SANS ouverture (un `</div>` de trop, que le parseur
//     ignore en silence) ;
//   • une balise ouvrante non terminée (attribut sans `>`).
//
// Elle ne juge ni l'imbrication sémantique (un `<span>` dans un `<div>` est
// toujours valide ici), ni la conformité HTML complète : elle répond à UNE
// question, celle que le build et les gardes doivent trancher ensemble — le
// document est-il lisible tel qu'il est ÉCRIT ?
//
// Deux lectures sont volontairement tolérantes, parce qu'un refus à leur sujet
// serait un FAUX ROUGE sur du HTML que le parseur accepte tel quel :
//
//   • les balises VIDES (`<img>`, `<br>`, `<meta>`, `<input>`…, liste
//     BALISES_VIDES) ne s'ouvrent pas : elles n'ont pas de fermeture à exiger ;
//   • une balise AUTO-FERMÉE (`<path />`, `<rect />`, les icônes SVG du site)
//     est refermée par sa propre écriture.
// Et le CONTENU des éléments à texte brut (`<script>`, `<style>`, `<textarea>`,
// `<title>`) n'est jamais pris pour du balisage : un `'</div>'` dans une chaîne
// de script en ligne n'ouvre ni ne ferme rien. Sans cette lecture, la règle
// accuserait le JavaScript publié dans index.html — un refus qui ferait retirer
// la règle au lieu de corriger le document.

/**
 * Éléments HTML qui n'ont pas de balise fermante (jamais empilés).
 *
 * Écrit en UNE chaîne, et c'est délibéré : ces quatorze noms sont le
 * VOCABULAIRE HTML, pas de la copie publiée. Le garde de provenance
 * (`scripts/check-shell-text-provenance.js`) lit chaque littéral d'un module de
 * coquille comme un TEXTE CANDIDAT et le refuse dès qu'un de ses MOTS apparaît
 * dans une page publiée — et « base » y apparaît (un texte parle de « base
 * légale »). Quatorze littéraux d'un mot se liraient donc comme quatorze mots
 * publiés en dur ; une seule donnée, qui n'est jamais un mot d'une page, se lit
 * pour ce qu'elle est. Ne pas les séparer « pour la lisibilité » : le garde
 * rougirait à raison (il ne peut pas distinguer un nom de balise d'un mot).
 */
const BALISES_VIDES = new Set(
  ('area base br col embed hr img input link meta param source track wbr').split(' ')
)

/** Éléments dont le contenu est du TEXTE, jamais du balisage. */
const BALISES_A_TEXTE_BRUT = new Set(['script', 'style', 'textarea', 'title'])

/** Tête d'une balise : `</div`, `<div`, `<svg:path`… */
const TETE_DE_BALISE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:._-]*)/

/** Index du `>` qui termine une balise, les guillemets d'attribut respectés. */
function finDeBalise(html, debut) {
  let guillemet = null
  for (let i = debut + 1; i < html.length; i += 1) {
    const caractere = html[i]
    if (guillemet) {
      if (caractere === guillemet) guillemet = null
      continue
    }
    if (caractere === '"' || caractere === "'") {
      guillemet = caractere
      continue
    }
    if (caractere === '>') return i
  }
  return -1
}

/**
 * Les BALISES du document qui ne s'équilibrent pas, dans l'ordre de lecture.
 *
 * Chaque problème porte de quoi écrire un refus utile sans relire le document :
 *
 *   `type`     — 'non-fermee' (ouverte, jamais refermée), 'fermee-en-portee'
 *                (refermée par une balise d'un autre nom), 'fermee-sans-ouverture'
 *                (fermante orpheline), 'non-terminee' (ouvrante sans `>`).
 *   `balise`   — le nom, en minuscules.
 *   `ligne`    — la ligne du document où le défaut se voit (1-indexée).
 *   `ligneFin` — pour les deux premiers : la ligne de la balise qui l'a refermé
 *                (`fermee-en-portee`) ou `null` quand le document se termine
 *                avant sa fermeture.
 *   `fermeePar`— le nom de la balise qui l'a refermé en portée, ou `null`.
 *   `extrait`  — le début de la balise fautive. La LIGNE ne suffisait pas : un
 *                corps de coquille est composé en une seule chaîne (donc
 *                toujours « ligne 1 »), et un refus qui ne dit que « ligne 1 »
 *                envoie relire tout le fichier. L'extrait nomme l'élément.
 *
 * @param {string} html Document ou fragment à lire.
 * @returns {Array<{type: string, balise: string, ligne: number, ligneFin: number|null, fermeePar: string|null, extrait: string}>}
 */
export function desequilibresDesBalises(html) {
  const texte = String(html)
  const problemes = []
  const pile = []
  // Un extrait se lit debout : au-delà, il noie le refus au lieu de le préciser.
  const extraitDe = (brut) => (brut.length > 120 ? brut.slice(0, 120) + '…' : brut)
  let index = 0
  // La ligne est avancée de façon MONOTONE : les index lus ne reculent jamais,
  // donc une seule passe suffit (index.html pèse ~120 Ko ; recompter depuis le
  // début à chaque balise coûterait des dizaines de millions d'octets lus).
  let ligne = 1
  let curseur = 0
  const ligneJusqua = (position) => {
    for (let i = curseur; i < position; i += 1) {
      if (texte[i] === '\n') ligne += 1
    }
    curseur = position
    return ligne
  }

  while (index < texte.length) {
    const ouvrante = texte.indexOf('<', index)
    if (ouvrante === -1) break
    if (texte.startsWith('<!--', ouvrante)) {
      const fin = texte.indexOf('-->', ouvrante + 4)
      index = fin === -1 ? texte.length : fin + 3
      continue
    }
    if (texte.startsWith('<!', ouvrante) || texte.startsWith('<?', ouvrante)) {
      const fin = texte.indexOf('>', ouvrante)
      index = fin === -1 ? texte.length : fin + 1
      continue
    }
    const tete = TETE_DE_BALISE.exec(texte.slice(ouvrante, ouvrante + 80))
    if (!tete) {
      // Un `<` qui n'ouvre rien (comparaison, texte échappé à moitié) : ce
      // n'est pas une balise, la lecture continue APRÈS lui.
      index = ouvrante + 1
      continue
    }
    const fin = finDeBalise(texte, ouvrante)
    if (fin === -1) {
      problemes.push({
        type: 'non-terminee',
        balise: tete[2].toLowerCase(),
        ligne: ligneJusqua(ouvrante),
        ligneFin: null,
        fermeePar: null,
        extrait: extraitDe(texte.slice(ouvrante, ouvrante + 120)),
      })
      break
    }
    const brut = texte.slice(ouvrante, fin + 1)
    const fermante = tete[1] === '/'
    const nom = tete[2].toLowerCase()
    const autoFermee = /\/\s*>$/.test(brut)
    const ligneBalise = ligneJusqua(ouvrante)
    index = fin + 1

    if (fermante) {
      const haut = pile[pile.length - 1]
      if (haut && haut.balise === nom) {
        pile.pop()
        continue
      }
      let rang = -1
      for (let i = pile.length - 1; i >= 0; i -= 1) {
        if (pile[i].balise === nom) {
          rang = i
          break
        }
      }
      if (rang === -1) {
        problemes.push({
          type: 'fermee-sans-ouverture',
          balise: nom,
          ligne: ligneBalise,
          ligneFin: null,
          fermeePar: null,
          extrait: extraitDe(brut),
        })
        continue
      }
      // Le parseur referme les éléments restés ouverts : c'est LA façon dont ce
      // défaut se cache (« un `</section>` dont la section est en portée »).
      for (let i = pile.length - 1; i > rang; i -= 1) {
        problemes.push({
          type: 'fermee-en-portee',
          balise: pile[i].balise,
          ligne: pile[i].ligne,
          ligneFin: ligneBalise,
          fermeePar: nom,
          extrait: extraitDe(pile[i].extrait),
        })
      }
      pile.length = rang
      continue
    }

    if (BALISES_VIDES.has(nom) || autoFermee) continue
    pile.push({ balise: nom, ligne: ligneBalise, extrait: extraitDe(brut) })
    if (BALISES_A_TEXTE_BRUT.has(nom)) {
      // Le contenu est du texte : on saute jusqu'à la fermeture, sans lire un
      // seul `<` de ce qu'il contient.
      const reste = texte.slice(index).toLowerCase()
      const fermeture = reste.indexOf('</' + nom)
      if (fermeture === -1) {
        index = texte.length
        continue
      }
      index += fermeture
    }
  }

  for (const ouverte of pile) {
    problemes.push({
      type: 'non-fermee',
      balise: ouverte.balise,
      ligne: ouverte.ligne,
      ligneFin: null,
      fermeePar: null,
      extrait: ouverte.extrait,
    })
  }
  return problemes
}

/** Le premier déséquilibre, écrit en clair, ou `null` si le document tient. */
export function decrireDesequilibre(probleme) {
  if (!probleme) return null
  const ligne = `ligne ${probleme.ligne}`
  const extrait = probleme.extrait ? ` — « ${probleme.extrait} »` : ''
  if (probleme.type === 'non-fermee') {
    return `\`<${probleme.balise}>\` ouvert ${ligne} n'est JAMAIS refermé${extrait}`
  }
  if (probleme.type === 'fermee-en-portee') {
    return (
      `\`<${probleme.balise}>\` ouvert ${ligne} est refermé en PORTÉE par ` +
      `\`</${probleme.fermeePar}>\` ligne ${probleme.ligneFin} au lieu de sa propre balise${extrait}`
    )
  }
  if (probleme.type === 'fermee-sans-ouverture') {
    return `\`</${probleme.balise}>\` ${ligne} n'a AUCUNE ouverture${extrait}`
  }
  return `\`<${probleme.balise}>\` ligne ${probleme.ligne} n'est pas terminé (aucun \`>\`)${extrait}`
}

/**
 * Le REFUS : une coquille pré-rendue déséquilibrée arrête le build.
 *
 * Rendu comme une fabrique pour que chaque appelant garde son nom d'origine
 * dans le message (le plugin du build, un garde de scripts/), et pour que le
 * refus soit exerçable à l'unité — un refus qui n'a jamais été vu lever est une
 * intention, pas une preuve.
 *
 * @param {{origine?: string, maximum?: number}} [options]
 * @returns {(objet: string, html: string) => void} `exigerBalisesEquilibrees`
 */
export function makeEquilibreGuard({ origine = 'prerender', maximum = 3 } = {}) {
  return function exigerBalisesEquilibrees(objet, html) {
    const problemes = desequilibresDesBalises(html)
    if (!problemes.length) return
    const details = problemes.slice(0, maximum).map(decrireDesequilibre).join(' ; ')
    const reste = problemes.length > maximum ? ` (et ${problemes.length - maximum} autre(s))` : ''
    throw new Error(
      `${origine} : ${objet} est DÉSÉQUILIBRÉ — ${problemes.length} balise(s) ne se referment pas : ` +
        `${details}${reste}. ` +
        'Un document déséquilibré n’est PAS une erreur visible : le parseur le RÉPARE en silence ' +
        '(la balise de fermeture la plus proche referme l’ancêtre en portée), donc aucune sonde de ' +
        'navigateur ne peut le voir — ni la parité de hauteur, ni celle du texte, ni le CLS. Le ' +
        'défaut n’existe que pour qui LIT le document : un crawler sans JavaScript, un lecteur ' +
        'd’accessibilité, l’extraction du `#root`. Le refus est donc prononcé ICI, avant l’écriture, ' +
        'pour les DOUZE pages pré-rendues ET pour les DEUX artefacts bâtis hors des routes '
          + '(le gabarit des routes privées et la 404 statique).'
    )
  }
}
