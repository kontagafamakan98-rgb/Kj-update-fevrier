#!/usr/bin/env node
/**
 * Les ACTIFS (JS, CSS, polices) et les CONTENUS (images, cartes OG) servis
 * sont-ils ceux de l'artefact en ligne ?
 *
 * ── L'angle mort que cette sonde ferme ──────────────────────────────────────
 * Le garde de révision prouve que le HTML servi vient de `main`
 * (`kojo-build-revision`, `kojo-build-tree`). Il ne dit RIEN des fichiers que ce
 * HTML charge : le JS de l'entrée, ses chunks, la feuille de style, les polices,
 * ni les images et cartes de partage qu'il affiche.
 * Vercel déploie un artefact de façon atomique, et CI-COVERAGE.md le disait
 * sans le vérifier : « les actifs un par un (leur déploiement est atomique côté
 * Vercel, mais rien ne le re-vérifie) ». Un HTML neuf servi avec des actifs
 * restés en arrière (propagation d'un déploiement mixte, cache d'un bord, fichier
 * réécrit après le build) passerait donc pour une production conforme — et
 * l'utilisateur, lui, recevrait un bundle qui ne correspond pas à sa page.
 *
 * ── La chaîne de preuve, et pourquoi elle est ANCRÉE ───────────────────────
 * Le build écrit `asset-manifest.json` : une empreinte SHA-256 par actif de code,
 * l'empreinte de l'ÉCHANTILLON de chaque contenu, et l'empreinte de CE fichier
 * est publiée dans chaque page (`kojo-build-assets`).
 * La sonde suit la chaîne dans cet ordre :
 *   1. HTML servi → l'empreinte du manifeste qu'il ANNONCE ;
 *   2. manifeste servi → son empreinte doit être celle annoncée (sinon il vient
 *      d'un autre build, et il ne peut rien garantir) ;
 *   3. chaque actif listé → son empreinte doit être celle du manifeste ;
 *   4. chaque contenu échantillonné → sa tête, sa queue et sa taille doivent
 *      être celles du manifeste (dans les limites du budget d'octets).
 * Sans l'étape 2, un manifeste périmé servirait de caution à des actifs périmés :
 * les deux seraient d'accord, et faux ensemble.
 *
 * ── Ce qu'elle refuse, et pourquoi elle le NOMME ────────────────────────────
 *  1. le HTML n'annonce AUCUNE ancre : artefact antérieur au mécanisme, ou build
 *     qui n'a pas écrit son manifeste. Correction : redéployer.
 *  2. le manifeste est illisible, non JSON, ou porte un chemin hors du site
 *     (`../`, `//hôte`, schéma) : il n'est pas une source d'empreintes.
 *  3. son empreinte n'est pas celle annoncée : déploiement mixte.
 *  4. il liste moins de `MIN_ACTIFS` actifs (instrument aveugle) ou plus de
 *     `MAX_ACTIFS` (ce n'est plus l'empreinte d'un build).
 *  5. un actif répond autre chose que 200, ou ses octets diffèrent : c'est le
 *     cœur du verdict, et le refus nomme le chemin et les deux empreintes.
 *  6. un CONTENU (image, carte OG, icône) a une tête, un MILIEU, une queue ou
 *     une taille qui ne sont pas celles du build : le manifeste publie
 *     l'échantillon, pas le fichier entier — une image de héros pèse des
 *     centaines de kio, et les télécharger toutes ferait payer des mégaoctets à
 *     la sonde. L'échantillon est LISIBLE en plages HTTP (`Range`), et il est borné par un budget
 *     d'octets global : au-delà, les contenus restants sont DÉCLARÉS non
 *     échantillonnés (jamais comptés comme vérifiés), et zéro contenu échantillonné
 *     est un refus, pas un vert.
 * PRÉCONDITION DÉCLARÉE : le CDN sert les plages (`Range` → `206`). C'est le
 * comportement de Vercel pour un fichier statique ; un intermédiaire qui
 * renverrait `200` est REFUSÉ en le nommant, parce qu'accepter sa réponse
 * ferait lire le fichier entier — ce que le budget existe pour éviter.
 *
 * Un site injoignable ne prouve rien : il est refusé en le disant.
 *
 * Ce que la sonde ne prouve PAS : que les octets sont ceux du COMMIT (c'est le
 * rôle de `kojo-build-tree` pour le HTML), ni les octets d'une image ENTRE les
 * blocs échantillonnés (tête, milieu et queue : une modification qui laisserait
 * ces trois blocs intacts passerait — depuis le 22/10/2026 le milieu n'est plus
 * la brèche), ni les fichiers qu'aucun manifeste ne liste (textes, données).
 * Écrire le contraire serait le faux vert qu'elle existe pour empêcher.
 *
 * ── Ce qu'elle PUBLIE, et pourquoi ──────────────────────────────────────────
 * Le coût de la mesure — actifs jugés, contenus échantillonnés, octets RÉELLEMENT
 * téléchargés, nombre de requêtes, durée, part du budget consommée — part dans le
 * résumé du run (`$GITHUB_STEP_SUMMARY`) et sur la sortie standard, VERDICT VERT
 * COMPRIS. Un budget qui ne s'affiche que le jour où il déborde n'a servi à aucun
 * arbitrage : le manifeste grossit à chaque image ajoutée, et une sonde qui
 * télécharge de plus en plus sans le dire dérive en silence jusqu'au refus.
 *
 * Codes de sortie : 0 vert, 1 refus (production), 2 invocation impossible.
 *
 * Usage :
 *   cd frontend && node scripts/check-deployed-assets.js
 * Optionnel :
 *   --base https://kojoforafrica.cc.cd   (défaut : SITE_ORIGIN, scripts/site-meta.js)
 */
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  BUILD_ASSETS_META,
  ECHANTILLON_CONTENU,
  MANIFESTE_ACTIFS,
  SITE_ORIGIN,
  metaContent,
  plagesContenu,
} from './site-meta.js';
import { baseAutorisée } from './check-deployed-revision.js';
import {
  BYPASS_ENV,
  BYPASS_HEADER,
  MARQUE_PREMISSE,
  PROJET_DEFAUT,
  resoudrePreview,
} from './preview-vercel.js';

// Plancher : sous ce nombre d'actifs, le manifeste ne décrit plus un build — il
// décrit un fichier tronqué, et un vert dessus serait un vert sur du vide.
export const MIN_ACTIFS = 5;

// Plafond : au-delà, ce n'est plus l'empreinte d'un build mais un inventaire, et
// la sonde téléchargerait des mégaoctets pour un fait qui n'en a pas besoin.
export const MAX_ACTIFS = 400;

// Une empreinte d'actif est un SHA-256 hexadécimal, et rien d'autre.
export const EMPREINTE = /^[0-9a-f]{64}$/;

// Plancher et plafond de CONTENUS (images, cartes OG, icônes) : un manifeste qui
// n'en liste aucun ne décrit pas ce que ce site sert (il a des icônes par
// construction), et un inventaire démesuré n'est plus la déclaration d'un build.
export const MIN_CONTENUS = 1;
export const MAX_CONTENUS = 2000;

// BUDGET d'octets que la sonde accepte de lire pour échantillonner les contenus.
// Sous le mégaoctet par choix : le manifeste décrit une trentaine d'images, et
// une sonde de production ne doit pas télécharger les héros pour un verdict.
// Relevé du 22/10/2026 : 53 contenus coûtaient 433 046 o pour DEUX blocs.
// L'échantillonnage du milieu en ajoute un troisième aux images plus grandes que
// deux blocs ; garder 512 Kio aurait donc RETIRÉ des images de la vérification
// pour en mieux lire d'autres. Le budget passe à 768 Kio : même couverture
// qu'avant, et toujours sous le mégaoctet. Une fois épuisé, les contenus
// restants sont DÉCLARÉS non échantillonnés — la sonde ne prétend jamais les
// avoir vérifiés.
export const BUDGET_CONTENUS = 768 * 1024;

// Nombre de chemins nommés dans un refus : au-delà, la liste se lit mal, et le
// COMPTE total dit déjà l'ampleur.
export const MAX_NOMS = 5;

// Le nom lisible d'une plage : `debut`/`fin` sont les clés du manifeste, l'écart
// doit nommer l'ENDROIT du fichier — « tête », « milieu », « queue ».
const LIBELLES_PLAGE = { debut: 'tête', milieu: 'milieu', fin: 'queue' };

// Requêtes simultanées : 67 actifs en séquence feraient durer la sonde une
// minute pour un déploiement qui vient d'être confirmé.
const PARALLÉLISME = 6;

const PROBE_HEADERS = { 'user-agent': 'kojo-deployed-assets/1.0' };

/** Annule le corps d'une réponse qu'on ne lira pas (budget : jamais un fichier entier). */
async function annuler(réponse) {
  try {
    await réponse?.body?.cancel?.();
  } catch (_error) {
    // Un corps déjà lu (ou absent) n'a rien à annuler.
  }
}

/**
 * La taille TOTALE annoncée par un en-tête `Content-Range`, ou `null`.
 *
 * C'est une seconde mesure gratuite : la plage dit la taille réelle du fichier
 * servi, donc une image remplacée par une autre de même début mais de taille
 * différente est refusée sans lire un octet de plus.
 *
 * @param {string|null|undefined} entete Valeur de `content-range`.
 * @returns {number|null} Taille en octets, ou null si illisible.
 */
export function totalDePlage(entete) {
  const trouve = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(String(entete ?? '').trim());
  return trouve ? Number(trouve[3]) : null;
}

/**
 * Empreinte SHA-256 d'octets, en hexadécimal — la même que celle du build.
 *
 * @param {Uint8Array|Buffer|string} octets Octets (ou texte, encodé en UTF-8).
 * @returns {string} 64 caractères hexadécimaux.
 */
export function empreinte(octets) {
  const données = typeof octets === 'string' ? Buffer.from(octets, 'utf8') : Buffer.from(octets);
  return createHash('sha256').update(données).digest('hex');
}

/**
 * L'empreinte du manifeste ANNONCÉE par le HTML servi, ou '' si la page se tait.
 *
 * Une valeur d'une autre forme est traitée comme absente : comparer sur une
 * empreinte abrégée accepterait un manifeste d'un autre build.
 *
 * @param {string} html Corps de la page d'accueil servie.
 * @returns {string} L'empreinte annoncée, en minuscules, ou ''.
 */
export function manifesteAnnonce(html) {
  const valeur = String(metaContent(String(html ?? ''), BUILD_ASSETS_META) ?? '').trim();
  return EMPREINTE.test(valeur) ? valeur.toLowerCase() : '';
}

/**
 * Un chemin d'actif acceptable dans un manifeste : celui d'un fichier DE CE SITE.
 *
 * Un manifeste est une donnée servie : `https://ailleurs/…`, `//hôte/…`, `../`
 * ou un chemin avec une requête n'adressent pas ce que le build a écrit. Les
 * refuser ici évite qu'une sonde de production aille chercher (et juge) un
 * fichier d'un autre domaine.
 *
 * @param {unknown} chemin Chemin candidat.
 * @returns {boolean} Vrai si le chemin est absolu sur ce site, sans évasion.
 */
export function cheminValide(chemin) {
  if (typeof chemin !== 'string') return false;
  if (!chemin.startsWith('/') || chemin.startsWith('//')) return false;
  if (chemin === MANIFESTE_ACTIFS) return false;
  if (chemin.includes('..') || chemin.includes('\\')) return false;
  if (/[?#\s]/.test(chemin)) return false;
  return true;
}

/**
 * Le manifeste, lu et VALIDÉ, ou la raison de son refus.
 *
 * Chaque entrée compte : une seule empreinte illisible ou un seul chemin hors
 * site rend le manifeste inutilisable. Ignorer l'entrée fautive ferait un
 * manifeste à moitié jugé, c'est-à-dire un actif non vérifié qui ne se voit pas.
 *
 * @param {string} texte Corps du manifeste servi.
 * @returns {{fichiers: Array<object>, contenus: Array<object>, erreur: string|null}}
 */
export function lireManifeste(texte) {
  let charge;
  try {
    charge = JSON.parse(String(texte ?? ''));
  } catch (error) {
    return { fichiers: [], contenus: [], erreur: `manifeste non JSON (${error.message})` };
  }
  const brut = charge?.fichiers;
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return {
      fichiers: [],
      contenus: [],
      erreur: "manifeste sans objet « fichiers » (le build n'a rien publié)",
    };
  }
  const fichiers = [];
  for (const [chemin, valeur] of Object.entries(brut)) {
    if (!cheminValide(chemin)) {
      return {
        fichiers: [],
        contenus: [],
        erreur:
          `chemin d'actif refusé (${JSON.stringify(chemin)}) : un manifeste n'adresse ` +
          'que des fichiers de ce site, sans évasion ni domaine externe',
      };
    }
    const empreinteDeclaree = String(valeur ?? '').trim().toLowerCase();
    if (!EMPREINTE.test(empreinteDeclaree)) {
      return {
        fichiers: [],
        contenus: [],
        erreur: `empreinte invalide pour ${chemin} (${JSON.stringify(valeur)})`,
      };
    }
    fichiers.push({ chemin, empreinte: empreinteDeclaree });
  }

  // La section des CONTENUS : sa présence est exigée, parce qu'un artefact qui
  // ne la porte pas est antérieur à l'échantillonnage — et un manifeste muet sur
  // les images les ferait passer pour vérifiées alors que rien ne l'est.
  const brutContenus = charge?.contenus;
  if (!brutContenus || typeof brutContenus !== 'object' || Array.isArray(brutContenus)) {
    return {
      fichiers: [],
      contenus: [],
      erreur:
        "manifeste sans objet « contenus » (images, cartes OG) : le build est " +
        'antérieur à l’échantillonnage borné, ou son manifeste a été tronqué',
    };
  }
  const contenus = [];
  for (const [chemin, entree] of Object.entries(brutContenus)) {
    if (!cheminValide(chemin)) {
      return {
        fichiers: [],
        contenus: [],
        erreur:
          `chemin de contenu refusé (${JSON.stringify(chemin)}) : un manifeste ` +
          "n'adresse que des fichiers de ce site, sans évasion ni domaine externe",
      };
    }
    const taille = Number(entree?.taille);
    const echantillon = Number(entree?.echantillon);
    if (!Number.isInteger(taille) || taille < 0) {
      return {
        fichiers: [],
        contenus: [],
        erreur: `taille invalide pour ${chemin} (${JSON.stringify(entree?.taille)})`,
      };
    }
    if (!Number.isInteger(echantillon) || echantillon < 0 || echantillon > taille) {
      return {
        fichiers: [],
        contenus: [],
        erreur:
          `échantillon invalide pour ${chemin} (${JSON.stringify(entree?.echantillon)} ` +
          `pour une taille de ${taille})`,
      };
    }
    // Un manifeste est une donnée SERVIE : il ne décide pas du budget. Un
    // échantillon plus grand que la constante déclarée ferait télécharger le
    // fichier presque entier à une sonde qui promet le contraire.
    if (echantillon > ECHANTILLON_CONTENU) {
      return {
        fichiers: [],
        contenus: [],
        erreur:
          `échantillon de ${chemin} au-delà du plafond de ${ECHANTILLON_CONTENU} octets ` +
          '— le manifeste ne fait pas la loi sur ce que la sonde télécharge',
      };
    }
    // Les plages attendues viennent de `plagesContenu` : tête et queue, plus le
    // MILIEU quand les deux bords laissent une brèche. Une entrée qui n'en
    // publie qu'une partie laisserait des octets hors de tout verdict.
    const plages = plagesContenu(taille, echantillon);
    const empreintes = {};
    for (const { champ } of plages) {
      const valeur = String(entree?.[champ] ?? '').trim().toLowerCase();
      if (!EMPREINTE.test(valeur)) {
        return {
          fichiers: [],
          contenus: [],
          erreur:
            `empreinte d'échantillon invalide pour ${chemin} (${champ}) — ` +
            'le manifeste doit publier chaque plage que la sonde relit',
        };
      }
      empreintes[champ] = valeur;
    }

    // Deux champs peuvent décrire la MÊME plage (un fichier plus petit que le
    // bloc : sa tête est sa queue) : la sonde ne la relit qu'une fois, et deux
    // empreintes qui se contrediraient sur les mêmes octets sont un manifeste
    // incohérent, pas un cas à ignorer.
    const lectures = [];
    const vues = new Map();
    for (const plage of plages) {
      const cle = `${plage.debut}-${plage.fin}`;
      if (vues.has(cle)) {
        if (vues.get(cle) !== empreintes[plage.champ]) {
          return {
            fichiers: [],
            contenus: [],
            erreur:
              `empreintes incohérentes pour ${chemin} : ${plage.champ} et un autre ` +
              `champ décrivent la plage ${cle} avec des valeurs différentes`,
          };
        }
        continue;
      }
      vues.set(cle, empreintes[plage.champ]);
      lectures.push({ ...plage, empreinte: empreintes[plage.champ] });
    }
    contenus.push({ chemin, taille, echantillon, lectures });
  }
  return {
    fichiers: fichiers.sort((a, b) => a.chemin.localeCompare(b.chemin)),
    contenus: contenus.sort((a, b) => a.chemin.localeCompare(b.chemin)),
    erreur: null,
  };
}

/**
 * Lit UNE plage d'octets d'une URL, sans jamais lever ni lire le fichier entier.
 *
 * La sonde ne peut pas hacher une image sans la télécharger : elle demande donc
 * la plage exacte que le manifeste décrit (`Range`), et exige un `206`. Un
 * serveur qui répond `200` renvoie le fichier ENTIER — c'est-à-dire des
 * mégaoctets pour un échantillon — donc le corps est annulé et le refus est
 * nommé, plutôt que de payer le prix que le budget existe pour éviter.
 *
 * `entetes` porte le jeton de contournement de la Protection de déploiement
 * Vercel : une preview de PR est fermée, et sans lui la sonde lirait le mur de
 * connexion au lieu de l'artefact — un refus sur le mauvais objet.
 *
 * @param {string} url URL absolue.
 * @param {object} options `debut`, `fin` (dernier octet INCLUS), `fetchImpl`,
 *   `timeout`, `entetes` (en-têtes supplémentaires).
 * @returns {Promise<{octets: Uint8Array|null, total: number|null, erreur: string|null}>}
 */
export async function lirePlage(url, { debut, fin, fetchImpl = fetch, timeout = 15000, entetes = {} } = {}) {
  if (!Number.isInteger(debut) || !Number.isInteger(fin) || debut < 0 || fin < debut) {
    return { octets: null, total: null, erreur: `plage invalide (${debut}-${fin})` };
  }
  const voulu = fin - debut + 1;
  let réponse;
  try {
    réponse = await fetchImpl(url, {
      redirect: 'follow',
      headers: { ...PROBE_HEADERS, ...entetes, range: `bytes=${debut}-${fin}` },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    return {
      octets: null,
      total: null,
      erreur: `${error?.name || 'Error'}: ${error?.message || ''}`.trim(),
    };
  }
  if (!réponse.ok) {
    await annuler(réponse);
    return { octets: null, total: null, erreur: `HTTP ${réponse.status}` };
  }
  if (réponse.status !== 206) {
    await annuler(réponse);
    return {
      octets: null,
      total: null,
      erreur:
        `le serveur ignore les plages (HTTP ${réponse.status} au lieu de 206) : ` +
        "l'échantillon coûterait le fichier entier",
    };
  }
  const total = totalDePlage(réponse.headers?.get?.('content-range'));
  try {
    const octets = new Uint8Array(await réponse.arrayBuffer());
    if (octets.length !== voulu) {
      return {
        octets: null,
        total,
        erreur: `plage servie de ${octets.length} octets au lieu de ${voulu}`,
      };
    }
    return { octets, total, erreur: null };
  } catch (error) {
    return { octets: null, total, erreur: `plage illisible (${error.message})` };
  }
}

/**
 * Lit une URL et rend ses octets, sans jamais lever.
 *
 * Un seul chemin de lecture (octets, puis décodage pour le HTML et le JSON) : le
 * HTML, le manifeste et les actifs sont ainsi hachés par la MÊME fonction, ce
 * qui interdit qu'une empreinte porte sur un texte ré-encodé d'un côté et sur
 * des octets de l'autre.
 *
 * @param {string} url URL absolue.
 * @param {object} options `fetchImpl`, `timeout`, `entetes` (en-têtes supplémentaires,
 *   dont le contournement de la Protection de déploiement Vercel).
 * @returns {Promise<{octets: Uint8Array|null, erreur: string|null, statut: number|null}>}
 */
export async function lire(url, { fetchImpl = fetch, timeout = 15000, entetes = {} } = {}) {
  let réponse;
  try {
    réponse = await fetchImpl(url, {
      redirect: 'follow',
      headers: { ...PROBE_HEADERS, ...entetes },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    return { octets: null, erreur: `${error?.name || 'Error'}: ${error?.message || ''}`.trim(), statut: null };
  }
  if (!réponse.ok) {
    return { octets: null, erreur: `HTTP ${réponse.status}`, statut: réponse.status };
  }
  try {
    return {
      octets: new Uint8Array(await réponse.arrayBuffer()),
      erreur: null,
      statut: réponse.status,
      // L'URL FINALE : une redirection vers le mur de connexion Vercel ne se
      // lit que là, et c'est ce qui distingue une preview protégée d'un
      // artefact cassé.
      url: String(réponse.url || url),
    };
  } catch (error) {
    return { octets: null, erreur: `corps illisible (${error.message})`, statut: réponse.status, url };
  }
}

/**
 * Le texte qui trahit un MUR de protection Vercel, ou '' si la réponse est
 * bien l'artefact demandé.
 *
 * Une preview de PR est fermée par défaut : Vercel répond alors sa page de
 * connexion (ou redirige vers vercel.com) au lieu du site. La confondre avec un
 * artefact cassé enverrait corriger un build qui n'a rien fait, et la prendre
 * pour un vert serait pire encore — c'est donc une PRÉMISSE nommée.
 *
 * @param {string} urlFinale URL réellement servie (après redirections).
 * @param {string} html Corps décodé.
 * @returns {string} Le fait constaté, ou ''.
 */
export function murDeProtection(urlFinale, html) {
  const adresse = String(urlFinale ?? '');
  const corps = String(html ?? '');
  if (/vercel\.com\/(login|sso|accounts|verify)/i.test(adresse)) return `redirection vers ${adresse}`;
  if (/protected-deployment|Authentication Required|Vercel Security Checkpoint/i.test(corps)) {
    return 'corps de la page de protection Vercel';
  }
  return '';
}

/** Exécute `tâche` sur chaque élément, au plus `taille` à la fois, dans l'ordre. */
async function parVagues(éléments, taille, tâche) {
  const résultats = new Array(éléments.length);
  let suivant = 0;
  const ouvriers = Array.from({ length: Math.min(taille, éléments.length) }, async () => {
    for (;;) {
      const index = suivant;
      suivant += 1;
      if (index >= éléments.length) return;
      résultats[index] = await tâche(éléments[index], index);
    }
  });
  await Promise.all(ouvriers);
  return résultats;
}

/** Un refus, avec son message (jamais un booléen nu : la cause se lit). */
function refusSansCoût(message) {
  return { ok: false, nombre: 0, écarts: [], contenus: null, message };
}

/**
 * Les mesures de coût, en phrases : une seule source pour le journal ET pour le
 * résumé du run (deux formats divergeraient au premier ajout de champ).
 *
 * L'octet brut est toujours donné — c'est le chiffre vérifiable —, l'ordre de
 * grandeur seulement pour la lecture.
 *
 * @param {object} verdict Verdict de `verifier`.
 * @returns {string[]} Lignes courtes (sans puce Markdown).
 */
export function lignesCout(verdict) {
  const coût = verdict?.coût ?? {};
  const contenus = verdict?.contenus ?? null;
  const octets = Number(coût.octets) || 0;
  const requêtes = Number(coût.requêtes) || 0;
  const lignes = [
    `${Number(verdict?.nombre) || 0} actif(s) de code jugé(s) en entier`,
    contenus
      ? `${contenus.échantillonnés} contenu(s) sur ${contenus.total} échantillonné(s)`
      : 'contenus non atteints (verdict arrêté avant)',
    `${phraseOctets(octets)} téléchargés en ${requêtes} requête(s)`,
    `durée ${phraseDuree(coût.duréeMs)}`,
  ];
  if (contenus) {
    lignes.push(
      `budget des contenus : ${phraseOctets(contenus.octets)} sur ${phraseOctets(contenus.budget)}` +
        (contenus.partiel
          ? ` — épuisé, ${contenus.total - contenus.échantillonnés} contenu(s) NON échantillonné(s)`
          : ' — échantillon complet')
    );
  }
  return lignes;
}

/** Octets bruts, puis leur ordre de grandeur quand il aide à lire. */
function phraseOctets(octets) {
  const nombre = Number(octets) || 0;
  if (nombre < 1024) return `${nombre} o`;
  if (nombre < 1024 * 1024) return `${nombre} o (${(nombre / 1024).toFixed(1).replace('.', ',')} Kio)`;
  return `${nombre} o (${(nombre / (1024 * 1024)).toFixed(2).replace('.', ',')} Mio)`;
}

/** Durée en secondes, virgule française, sans dépendre de la locale du runner. */
function phraseDuree(ms) {
  return `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Le verdict : la chaîne HTML → manifeste → actifs, chaque maillon vérifié.
 *
 * @param {object} options `base`, `fetchImpl`, `timeout`, `maxActifs`,
 *   `budgetContenus` (octets que la sonde accepte de lire pour l'échantillon),
 *   `entetes` (en-têtes ajoutés à CHAQUE requête — contournement d'une preview
 *   protégée compris : sans lui, la sonde jugerait un mur de connexion).
 * @returns {Promise<{ok: boolean, nombre: number, écarts: Array<object>,
 *   contenus: object|null, coût: object, message: string}>} Jamais d'exception.
 */
export async function verifier({
  base,
  fetchImpl = fetch,
  timeout = 15000,
  maxActifs = MAX_ACTIFS,
  budgetContenus = BUDGET_CONTENUS,
  entetes = {},
} = {}) {
  const origin = String(base ?? '').trim().replace(/\/+$/, '');

  // Le COÛT mesuré de la passe : octets réellement reçus (pas le budget
  // réservé) et requêtes émises. Il est rendu dans le verdict, donc publié même
  // quand tout est conforme.
  const début = Date.now();
  const coût = { octets: 0, requêtes: 0 };
  const mesuré = () => ({ ...coût, duréeMs: Date.now() - début });

  /** Une lecture complète, comptée : c'est ce que la sonde télécharge vraiment. */
  const lireCompté = async (url) => {
    coût.requêtes += 1;
    const réponse = await lire(url, { fetchImpl, timeout, entetes });
    if (réponse.octets) coût.octets += réponse.octets.length;
    return réponse;
  };

  /** Une plage, comptée de même (les octets REÇUS, pas le budget qui les réserve). */
  const plageComptée = async (url, options) => {
    coût.requêtes += 1;
    const réponse = await lirePlage(url, { ...options, fetchImpl, timeout, entetes });
    if (réponse.octets) coût.octets += réponse.octets.length;
    return réponse;
  };

  // Le refus porte le coût déjà engagé : un arrêt en cours de route a dépensé
  // des requêtes, et les taire ferait croire à une passe gratuite.
  const refus = (message) => ({ ...refusSansCoût(message), coût: mesuré() });

  const page = await lireCompté(`${origin}/`);
  if (page.erreur) {
    return refus(
      `aucune réponse exploitable de ${origin}/ : ${page.erreur} — rien ne peut être affirmé ` +
        'sur les actifs servis.'
    );
  }
  const html = new TextDecoder().decode(page.octets);
  const mur = murDeProtection(page.url, html);
  if (mur) {
    return refus(
      `MUR DE PROTECTION Vercel (${mur}) : cette origine est fermée, la sonde lit la page de ` +
        "connexion au lieu de l'artefact. Renseigner le jeton de contournement " +
        `(${BYPASS_ENV}) pour juger une preview protégée, ou viser une origine ouverte.`
    );
  }
  if (!/<html[\s>]/i.test(html)) {
    return refus(
      `la réponse de ${origin}/ n'est pas du HTML : le site ne sert pas sa page d'accueil, ` +
        'donc aucun manifeste ne peut être ancré.'
    );
  }

  const annoncé = manifesteAnnonce(html);
  if (!annoncé) {
    return refus(
      `le frontend servi n'annonce AUCUNE empreinte de manifeste d'actifs (meta ` +
        `« ${BUILD_ASSETS_META} » absente ou mal formée) : l'artefact est antérieur à ce ` +
        "mécanisme, ou son build n'a pas écrit le manifeste. Redéployer le frontend — sans " +
        "cette ancre, un manifeste servi ne prouve pas qu'il appartient à cet artefact.",
    );
  }

  const manifeste = await lireCompté(`${origin}${MANIFESTE_ACTIFS}`);
  if (manifeste.erreur) {
    return refus(
      `le manifeste d'actifs ${MANIFESTE_ACTIFS} n'est pas lisible (${manifeste.erreur}) : ` +
        'un artefact neuf sans son manifeste ne prouve rien des fichiers qu\'il charge.'
    );
  }

  const empreinteManifeste = empreinte(manifeste.octets);
  if (empreinteManifeste !== annoncé) {
    return refus(
      `le manifeste servi n'est PAS celui qu'annonce l'artefact : annoncé=${annoncé.slice(0, 12)} ` +
        `servi=${empreinteManifeste.slice(0, 12)} — le HTML et son manifeste viennent de deux ` +
        'builds différents, donc le manifeste ne peut rien garantir des actifs.',
    );
  }

  const lu = lireManifeste(new TextDecoder().decode(manifeste.octets));
  if (lu.erreur) return refus(`manifeste d'actifs inutilisable : ${lu.erreur}.`);

  if (lu.fichiers.length < MIN_ACTIFS) {
    return refus(
      `le manifeste ne porte que ${lu.fichiers.length} actif(s), sous le plancher de ` +
        `${MIN_ACTIFS} : il ne décrit pas un build, et un vert dessus serait un vert sur du vide.`
    );
  }
  if (lu.fichiers.length > maxActifs) {
    return refus(
      `le manifeste porte ${lu.fichiers.length} actifs, au-delà du plafond de ${maxActifs} : ` +
        "ce n'est plus l'empreinte d'un build (manifeste tronqué ou forgé), et la sonde ne " +
        'téléchargera pas un inventaire.'
    );
  }
  if (lu.contenus.length < MIN_CONTENUS) {
    return refus(
      `le manifeste ne porte que ${lu.contenus.length} contenu(s) (images, cartes OG), sous le ` +
        `plancher de ${MIN_CONTENUS} : ce site sert des icônes et des cartes par construction, ` +
        'donc un manifeste muet sur eux ne décrit pas l’artefact servi.'
    );
  }
  if (lu.contenus.length > MAX_CONTENUS) {
    return refus(
      `le manifeste porte ${lu.contenus.length} contenus, au-delà du plafond de ${MAX_CONTENUS} : ` +
        "ce n'est plus la déclaration d'un build, et la sonde n'échantillonnera pas un inventaire."
    );
  }

  const écarts = (
    await parVagues(lu.fichiers, PARALLÉLISME, async ({ chemin, empreinte: attendue }) => {
      const servi = await lireCompté(`${origin}${chemin}`);
      if (servi.erreur) return { chemin, motif: servi.erreur };
      const obtenue = empreinte(servi.octets);
      return obtenue === attendue ? null : { chemin, attendu: attendue, obtenu: obtenue };
    })
  ).filter(Boolean);

  // ── Les CONTENUS : un ÉCHANTILLON borné par budget ───────────────────
  // Chaque contenu coûte ses plages (`echantillon` octets chacune : tête,
  // milieu quand les bords laissent une brèche, queue). Le budget est décompté
  // AVANT la requête : une plage qui échoue a quand même occupé le budget, et
  // le déclarer autrement ferait dépasser la promesse de la sonde.
  const contenus = {
    total: lu.contenus.length,
    échantillonnés: 0,
    partiel: false,
    octets: 0,
    budget: budgetContenus,
  };
  const écartsContenus = [];
  for (const contenu of lu.contenus) {
    const coût = contenu.echantillon * contenu.lectures.length;
    if (contenus.octets + coût > budgetContenus) {
      // Budget épuisé : le contenu n'est NI jugé NI compté comme vérifié, et
      // le verdict le DIT (jamais un vert sur ce qui n'a pas été lu).
      contenus.partiel = true;
      continue;
    }
    contenus.octets += coût;
    if (contenu.echantillon === 0 || contenu.lectures.length === 0) {
      écartsContenus.push({
        chemin: contenu.chemin,
        motif:
          contenu.taille === 0
            ? 'fichier de 0 octet — rien à échantillonner'
            : `aucune plage relisible (échantillon de ${contenu.echantillon} octet(s))`,
      });
      continue;
    }

    // TÊTE, MILIEU, QUEUE — dans l'ordre des plages, un écart arrête le contenu.
    let écart = null;
    for (const { champ, debut, fin, empreinte: attendue } of contenu.lectures) {
      const plage = await plageComptée(`${origin}${contenu.chemin}`, { debut, fin });
      const nom = LIBELLES_PLAGE[champ] || champ;
      if (plage.erreur) {
        écart = { chemin: contenu.chemin, motif: `${nom} : ${plage.erreur}` };
        break;
      }
      if (plage.total !== null && plage.total !== contenu.taille) {
        écart = {
          chemin: contenu.chemin,
          motif: `taille servie ${plage.total} ≠ ${contenu.taille} octets du build`,
        };
        break;
      }
      const obtenue = empreinte(plage.octets);
      if (obtenue !== attendue) {
        écart = {
          chemin: contenu.chemin,
          champ: nom,
          attendu: attendue,
          obtenu: obtenue,
        };
        break;
      }
    }
    if (écart) {
      écartsContenus.push(écart);
      continue;
    }
    contenus.échantillonnés += 1;
  }

  // Zéro contenu lu n'est pas un vert : le budget ou le manifeste est en cause,
  // et les images ne sont alors PAS vérifiées — le dire est le minimum.
  if (contenus.total > 0 && contenus.échantillonnés === 0) {
    const motifs = écartsContenus
      .slice(0, MAX_NOMS)
      .map((écart) => écart.motif || écart.champ)
      .join(', ');
    return refus(
      `aucun des ${contenus.total} contenu(s) n'a pu être échantillonné ` +
        `(budget de ${budgetContenus} octets${motifs ? ` ; motifs : ${motifs}` : ''}) : ` +
        'les images et cartes OG ne sont donc PAS vérifiées.'
    );
  }

  if (écarts.length || écartsContenus.length) {
    const parties = [];
    if (écarts.length) {
      const nommés = écarts
        .slice(0, MAX_NOMS)
        .map((écart) =>
          écart.motif
            ? `${écart.chemin} (${écart.motif})`
            : `${écart.chemin} : attendu=${écart.attendu.slice(0, 12)} servi=${écart.obtenu.slice(0, 12)}`
        )
        .join(', ');
      parties.push(
        `${écarts.length} actif(s) sur ${lu.fichiers.length} ne sont PAS ceux de l'artefact : ` +
          `${nommés}${écarts.length > MAX_NOMS ? `, … (${écarts.length - MAX_NOMS} autre(s))` : ''}`
      );
    }
    if (écartsContenus.length) {
      const nommés = écartsContenus
        .slice(0, MAX_NOMS)
        .map((écart) =>
          écart.motif
            ? `${écart.chemin} (${écart.motif})`
            : `${écart.chemin} (${écart.champ}) : attendu=${écart.attendu.slice(0, 12)} ` +
              `servi=${écart.obtenu.slice(0, 12)}`
        )
        .join(', ');
      parties.push(
        `${écartsContenus.length} contenu(s) sur ${lu.contenus.length} ne sont PAS ceux du ` +
          `build : ${nommés}${
            écartsContenus.length > MAX_NOMS
              ? `, … (${écartsContenus.length - MAX_NOMS} autre(s))`
              : ''
          }`
      );
    }
    return {
      ok: false,
      nombre: lu.fichiers.length,
      écarts,
      contenus,
      coût: mesuré(),
      message:
        `${parties.join(' ; ')} — déploiement mixte (HTML neuf, actifs restés en arrière) ou ` +
        'fichier réécrit entre le build et le CDN. Redéployer, puis rejouer cette sonde.',
    };
  }

  const reste = contenus.total - contenus.échantillonnés;
  return {
    ok: true,
    nombre: lu.fichiers.length,
    écarts: [],
    contenus,
    coût: mesuré(),
    message:
      `${lu.fichiers.length} actif(s) (JS, CSS, polices) ont l'empreinte publiée par le build, ` +
      `${contenus.échantillonnés} contenu(s) sur ${contenus.total} (images, cartes OG) ont ` +
      `leurs plages d'échantillon conformes (tête, milieu, queue) (${contenus.octets} o lus sur un budget de ` +
      `${budgetContenus} o), et le manifeste est bien celui qu'annonce l'artefact ` +
      `(${annoncé.slice(0, 12)})` +
      (reste
        ? ` — ${reste} contenu(s) NON échantillonné(s) : budget d'octets épuisé.`
        : '.'),
  };
}

/**
 * Le coût de la sonde, publié dans le résumé du run (`$GITHUB_STEP_SUMMARY`).
 *
 * Écrit POUR TOUS LES VERDICTS, y compris un refus : c'est la dépense de la
 * sonde qui est publiée, pas sa satisfaction. Hors GitHub (variable absente), la
 * fonction ne fait rien — la même mesure est alors sur la sortie standard, que
 * `npm run livrer` affiche dans le terminal.
 *
 * Un résumé illisible n'invalide pas la mesure (le verdict est dans les
 * annotations) : il ne doit pas non plus faire échouer la livraison.
 *
 * @param {object} verdict Verdict de `verifier` (ou pseudo-verdict de prémisse).
 * @param {string} [cheminFichier] Fichier de résumé (`$GITHUB_STEP_SUMMARY`).
 * @param {string} [contexte] Quelle origine / révision a été jugée (ligne d'identité).
 */
export function ecrireResume(verdict, cheminFichier = process.env.GITHUB_STEP_SUMMARY, contexte = '') {
  if (!cheminFichier) return;
  const état = verdict?.premisse
    ? MARQUE_PREMISSE
    : verdict?.ok
      ? 'conforme'
      : 'refus';
  const lignes = [`### Sonde des actifs servis — ${état}, et ce qu’elle a coûté`, ''];
  if (contexte) lignes.push(`- ${contexte}`);
  lignes.push(...lignesCout(verdict).map((ligne) => `- ${ligne}`), '');
  if (!verdict?.ok) {
    lignes.push(`Motif : ${String(verdict?.message ?? '').slice(0, 400)}`, '');
  }
  try {
    appendFileSync(cheminFichier, lignes.join('\n'), 'utf8');
  } catch {
    // Voir plus haut : un résumé non écrit ne change pas le verdict.
  }
}

/**
 * Lit les options de la ligne de commande.
 *
 * @param {string[]} argv Arguments (sans `node`/le script).
 * @returns {{base: string, preview: boolean, sha: string, tentatives: number, delaiMs: number}}
 */
export function lireOptions(argv = []) {
  const valeurDe = (nom) => {
    const index = argv.indexOf(nom);
    return index === -1 ? '' : String(argv[index + 1] ?? '').trim();
  };
  const preview = argv.includes('--preview');
  const base = valeurDe('--base');
  const tentatives = Number(valeurDe('--tentatives'));
  const delai = Number(valeurDe('--delai'));
  return {
    preview,
    // En mode preview l'origine vient de la RÉSOLUTION : accepter `--base` en
    // plus donnerait deux sources pour une même adresse, et la mauvaise
    // pourrait gagner — une PR jugée sur la production, par exemple.
    base: base || (preview ? '' : SITE_ORIGIN),
    sha: valeurDe('--sha'),
    tentatives: Number.isInteger(tentatives) && tentatives > 0 ? tentatives : 12,
    delaiMs: Number.isFinite(delai) && delai > 0 ? delai * 1000 : 15000,
  };
}

/**
 * Publie le verdict (coût, résumé, annotation) et rend le code de sortie.
 *
 * Une seule implémentation pour les deux modes (production et preview) : deux
 * sorties divergeraient au premier ajout de champ, et l'une des deux pourrait
 * cesser de publier le coût sans que personne ne le voie.
 *
 * @param {object} verdict Verdict de `verifier`.
 * @param {object} options `resumePath`, `contexte`.
 * @returns {number} 0 vert, 1 refus.
 */
function publierVerdict(verdict, { resumePath, contexte = '' } = {}) {
  // LE COÛT EST PUBLIÉ AVANT LE VERDICT, et quelle que soit son issue. Une
  // mesure qui n'apparaît que le jour où le budget déborde ne permet aucun
  // arbitrage : le manifeste grossit à chaque image ajoutée, et la sonde
  // téléchargerait toujours plus sans que personne ne le voie.
  console.log(`::notice title=Coût de la sonde::${lignesCout(verdict).join(' ; ')}`);
  ecrireResume(verdict, resumePath, contexte);

  if (verdict.ok) {
    // Un échantillon tronqué n'est PAS un vert silencieux : c'est un état de
    // mesure qui se publie (comme les surfaces aveugles des sondes de corpus).
    if (verdict.contenus?.partiel) {
      const reste = verdict.contenus.total - verdict.contenus.échantillonnés;
      console.log(
        `::warning title=Contenus servis — échantillon borné::${reste} contenu(s) sur ` +
          `${verdict.contenus.total} n'ont PAS été échantillonnés (budget de ` +
          `${verdict.contenus.budget} octets épuisé) : les actifs de code sont vérifiés ` +
          'en entier, les images seulement pour ceux que le budget a couverts.'
      );
    }
    console.log(`::notice title=Actifs servis::${verdict.message}`);
    return 0;
  }

  let titre = 'Actifs servis — site injoignable';
  if (verdict.message.includes('MUR DE PROTECTION')) titre = 'Actifs servis — preview protégée';
  else if (verdict.message.includes('AUCUNE empreinte')) titre = 'Actifs servis — aucune empreinte de manifeste';
  else if (verdict.message.includes("n'est PAS celui")) titre = 'Actifs servis — manifeste ≠ artefact';
  else if (verdict.écarts?.length) titre = 'Actifs servis ≠ manifeste';
  else if (verdict.message.includes('contenu(s)')) titre = 'Contenus servis ≠ manifeste';
  else if (verdict.message.includes('manifeste')) titre = 'Actifs servis — manifeste inutilisable';
  console.log(`::error title=${titre}::${verdict.message}`);
  return 1;
}

/**
 * Le mode PREVIEW : la même chaîne, sur le déploiement Vercel de CETTE révision.
 *
 * Trois refus d'invocation avant tout réseau (une base ET un mode preview, une
 * résolution qui rend la production, une origine illisible) : ils disent que la
 * question posée n'était pas la bonne, jamais que l'artefact est mauvais.
 *
 * @param {object} options Options résolues (`sha`, `tentatives`, `delaiMs`).
 * @param {object} deps `resumePath`, `env`, `resoudre`, `verifierActifs`.
 * @returns {Promise<number>} 0 vert, 1 refus, 2 prémisse / invocation impossible.
 */
async function mainPreview(options, { resumePath, env, resoudre, verifierActifs }) {
  if (options.base) {
    console.error(
      '::error title=Preview Vercel — invocation impossible::--base et --preview ensemble : la ' +
        "preview se résout par la révision (--sha), et deux sources pour une même adresse " +
        'laisseraient juger la mauvaise origine.'
    );
    return 2;
  }
  const bypass = String(env[BYPASS_ENV] || '').trim();
  const projet = String(env.VERCEL_PROJECT_NAME || '').trim() || PROJET_DEFAUT;

  console.log(
    `Preview Vercel — résolution du déploiement de ${options.sha || '(révision absente)'} ` +
      `(projet « ${projet} », ${options.tentatives} tentative(s) de ${options.delaiMs / 1000} s)…`
  );
  const résolution = await resoudre({
    sha: options.sha,
    token: env.VERCEL_TOKEN,
    teamId: String(env.VERCEL_TEAM_ID || '').trim(),
    projet,
    tentatives: options.tentatives,
    delaiMs: options.delaiMs,
    onMesure: (mesure) =>
      console.log(
        `   tentative ${mesure.tentative}/${options.tentatives} : ` +
          `${mesure.candidats} déploiement(s) de la révision, état « ${mesure.état} »`
      ),
  });

  if (!résolution.ok) {
    const premisse = Boolean(résolution.premisse);
    const identité = `révision visée : ${String(options.sha || '').slice(0, 12) || '(absente)'}`;
    console.log(
      `::${premisse ? 'warning' : 'error'} title=Preview Vercel — ${
        premisse ? MARQUE_PREMISSE : 'artefact de la PR absent'
      }::${résolution.motif}`
    );
    ecrireResume(
      {
        ok: false,
        premisse,
        nombre: 0,
        contenus: null,
        coût: { octets: 0, requêtes: 0, duréeMs: 0 },
        message: résolution.motif,
      },
      resumePath,
      identité
    );
    return premisse ? 2 : 1;
  }

  // Une résolution qui rendrait la PRODUCTION ferait juger l'artefact de tout
  // le monde en prétendant vérifier la PR : c'est un refus d'invocation, pas un
  // verdict sur l'artefact.
  let origine = '';
  try {
    origine = new URL(résolution.url).origin;
  } catch (_error) {
    origine = '';
  }
  if (!origine) {
    console.error(
      `::error title=Preview Vercel — invocation impossible::la résolution rend une adresse ` +
        `illisible (${JSON.stringify(résolution.url)}) : rien ne peut être jugé.`
    );
    return 2;
  }
  const révisionJugée = String(résolution.revision || options.sha || '').slice(0, 12) || '(illisible)';
  if (origine === new URL(SITE_ORIGIN).origin) {
    console.error(
      `::error title=Preview Vercel — invocation impossible::la résolution rend la PRODUCTION ` +
        `(${origine}) pour la révision ${révisionJugée} : une sonde de PR ne ` +
        "juge pas l'artefact de tous, et un vert ici ne dirait rien de la PR."
    );
    return 2;
  }

  console.log(`Preview Vercel : ${résolution.url} (${résolution.motif})`);
  const verdict = await verifierActifs({
    base: résolution.url,
    // Le jeton de contournement n'est JAMAIS imprimé (ni en argument, ni au
    // journal) : il est lu dans l'environnement et posé en en-tête.
    entetes: bypass ? { [BYPASS_HEADER]: bypass } : {},
  });

  // Un mur de protection n'est PAS un artefact cassé : sans jeton de
  // contournement, la sonde n'a rien pu lire. C'est une prémisse, nommée.
  if (!verdict.ok && verdict.message.includes('MUR DE PROTECTION')) {
    console.log(`::warning title=Preview Vercel — ${MARQUE_PREMISSE}::${verdict.message}`);
    ecrireResume({ ...verdict, premisse: true }, resumePath, `preview de ${révisionJugée} : ${résolution.url}`);
    return 2;
  }

  return publierVerdict(verdict, {
    resumePath,
    contexte: `preview de ${révisionJugée} : ${résolution.url}`,
  });
}

export async function main(
  argv = process.argv.slice(2),
  {
    resumePath = process.env.GITHUB_STEP_SUMMARY,
    env = process.env,
    resoudre = resoudrePreview,
    verifierActifs = verifier,
  } = {}
) {
  const options = lireOptions(argv);
  if (options.preview) return mainPreview(options, { resumePath, env, resoudre, verifierActifs });

  const base = baseAutorisée(options.base);
  if (!base.ok) {
    console.error(`::error title=Actifs servis — invocation impossible::${base.erreur}`);
    return 2;
  }

  console.log(`Vérification des actifs servis par ${options.base}/…`);
  const verdict = await verifierActifs({ base: options.base });
  return publierVerdict(verdict, { resumePath, contexte: `origine jugée : ${options.base}` });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
