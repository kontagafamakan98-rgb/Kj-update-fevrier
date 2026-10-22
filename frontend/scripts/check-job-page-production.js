#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — `/jobs/:id` PORTE-T-IL VRAIMENT L'APPLICATION ?
 *
 * ── Le fait que cette sonde juge, et pourquoi rien d'autre ne le faisait ────
 * `/jobs/:id` n'est pas une route du build : Vercel la réécrit vers le backend
 * (`frontend/vercel.json`, `/jobs/(.*)` → `/api/og/jobs/$1`), qui écrit le
 * document pré-rendu (`backend/kojo_job_og.py`). Le 21/10/2026 ce document a
 * cessé d'être un texte statique : il publie désormais le point d'entrée
 * (`/boot/worker-boot.js`), la feuille de l'application (`/boot/worker-app.css`,
 * une par APPLICATION et non par page) et le bloc de données `kojo-job-data`
 * que `JobDetails` reprend comme état initial.
 *
 * Ce démarrage n'était jugé NULLE PART en production :
 *
 *   • `check-job-og-contract.js` exécute le module Python HORS LIGNE — il ne
 *     dit pas ce que la production sert ;
 *   • `check-seo-production.js` juge le canonical, le titre et la description des
 *     fiches, jamais le point d'entrée ;
 *   • `check-deployed-assets.js` vérifie les octets des actifs, pas le document
 *     qui les charge ;
 *   • `check-spa-routes.js` lit la CONFIGURATION des rewrites, pas ce qui est
 *     servi.
 *
 * Et les deux pannes réelles sont invisibles autrement :
 *
 *   • une RÉÉCRITURE perdue répond 200 avec la COQUE SPA — un document valide,
 *     sans canonical de fiche, sans `<h1>` de mission et sans bloc de données ;
 *   • un document qui a perdu son point d'entrée (ou sa feuille, ou son bloc)
 *     reste une fiche lisible par un crawler, mais un visiteur à froid — le SEUL
 *     arrivant d'un lien partagé — n'a ni châssis, ni navigation, ni fiche
 *     peinte : une page morte qui passe tous les autres verts.
 *
 * ── Deux jugements, et le premier ne dépend d'AUCUNE donnée ────────────────
 * 1. LA RÉÉCRITURE (toujours) : l'identifiant sentinelle
 *    `kojo-sonde-reecriture-fiche`, qui n'existe pas, doit répondre le 404 du
 *    backend — `noindex`, point d'entrée présent, AUCUN script `/assets/`. Une
 *    coque SPA répond 200 + un bundle : ce jugement tombe chaque jour, corpus
 *    ou pas.
 * 2. LA FICHE d'une mission réelle : le premier `/jobs/:id` du sitemap (la
 *    surface par laquelle un crawler la découvre) ou celui passé à `--job`.
 *    La sonde juge alors ce qui fait DÉMARRER la page — point d'entrée unique,
 *    feuille présente et AVANT le module, bloc `kojo-job-data` lisible et
 *    ACCORDÉ (même identifiant, même titre que le `<h1>`, même description que
 *    la balise, aucun champ que l'API publique ne publie) — plus l'en-tête qui
 *    dit de quelle mission il s'agit (canonical, `og:url`, `twitter:url`,
 *    indexabilité).
 *
 * ── Ce que la sonde ne juge PAS, et pourquoi ───────────────────────────────
 *   • la RÉDACTION du titre et de la description (longueur, coupe en points de
 *     code) : c'est le contrat hors ligne (`check-job-og-contract.js`) qui
 *     l'exécute des deux côtés, et deux gardes se contrediraient un jour sur une
 *     phrase ;
 *   • les CARTES OG servies : `check-og-images.js` les juge déjà en HTTP réel
 *     (200, `image/png`, dimensions) — les rejouer ici doublerait le prix et
 *     créerait une seconde vérité ;
 *   • la FRAÎCHEUR des données : le document est mis en cache une heure
 *     (`Cache-Control` de la route), et la sonde n'a pas de second horodatage à
 *     lui opposer. Ce qu'elle juge, c'est que le document et son bloc parlent de
 *     la MÊME mission.
 *
 * ── Trois sorties, jamais deux ─────────────────────────────────────────────
 * 0 = document jugé conforme ; 1 = refus nommé ; 2 = prémisse : aucune fiche au
 * sitemap, donc le démarrage d'une fiche n'a PAS été jugé (la réécriture, elle,
 * a été mesurée sur la sentinelle). Une prémisse n'est jamais un vert.
 *
 * Usage :
 *   node scripts/check-job-page-production.js                     # production
 *   node scripts/check-job-page-production.js --base https://…     # une preview
 *   node scripts/check-job-page-production.js --job <id|url>       # une fiche précise
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  POINT_ENTREE_MISSION,
  SITE_ORIGIN,
  canonicalHref,
  declaresNoIndex,
  metaContent,
  titleOf,
} from './site-meta.js';

export const DEFAULT_BASE = SITE_ORIGIN;

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'démarrage de la fiche mission';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'Fiche mission production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * L'identifiant SENTINELLE : improbable par construction, et sans rapport avec
 * une mission. Il ne sert pas à juger une fiche — il sert à faire parler la
 * RÉÉCRITURE : un backend répond son 404, une coque SPA répond 200.
 */
export const ID_SENTINELLE = 'kojo-sonde-reecriture-fiche';

/** Chemin public d'une fiche mission. */
export const cheminFiche = (id) => `/jobs/${encodeURIComponent(id)}`;

/** Les deux cartes OG d'une fiche — chemins produits par le backend. */
export const cartesAttendues = (id) => {
  const base = `/api/og/jobs/${encodeURIComponent(id)}`;
  return { wide: `${base}.png`, carree: `${base}-square.png` };
};

/**
 * Les clés qu'un bloc PUBLIC ne peut JAMAIS porter : identités, point geo,
 * coordonnées et jetons internes. Les coordonnées sont cherchées par NOM
 * (`latitude`, `longitude`, `coordinates`, `lat`, `lng`) à toute profondeur,
 * parce que `location` est un objet anonyme dont le backend retire ces clés —
 * une régression de cette règle doit être refusée ici, pas découverte dans un
 * document partagé.
 */
export const CLES_JAMAIS_PUBLIQUES = [
  'geo',
  'client_id',
  'assigned_worker_id',
  'accepted_proposal_id',
  'disburse_token',
  'deleted',
  '_id',
];

const COORDONNEES = /^(latitude|longitude|coordinates|lat|lng)$/i;

const TIMEOUT_MS = 20000;

/**
 * Les balises `<script>` d'un document, avec ce qu'elles CHARGENT.
 *
 * @param {string} html Document complet.
 * @returns {{src: string, type: string, id: string, inline: string}[]}
 */
export function scriptsDe(html) {
  const scripts = [];
  for (const tag of String(html).match(/<script\b[^>]*>/gi) || []) {
    const lire = (nom) => {
      const trouve = new RegExp(`\\b${nom}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
      return trouve ? (trouve[2] !== undefined ? trouve[2] : trouve[3]) : '';
    };
    scripts.push({
      src: lire('src').trim(),
      type: lire('type').trim().toLowerCase(),
      id: lire('id').trim(),
      inline: '',
    });
  }
  const corps = [...String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  corps.forEach((trouve, index) => {
    if (scripts[index]) scripts[index].inline = String(trouve[1] || '').trim();
  });
  return scripts;
}

/**
 * Les scripts que le navigateur EXÉCUTE — le bloc de données JSON n'en est pas
 * un, et le compter comme « script en ligne » refuserait tout document conforme.
 *
 * @param {string} html Document complet.
 * @param {string} [seedId] Nom du bloc de données à écarter.
 * @returns {{src: string, type: string, id: string, inline: string}[]}
 */
export function scriptsExecutables(html, seedId = POINT_ENTREE_MISSION.seedId) {
  return scriptsDe(html).filter(
    (script) =>
      script.id !== seedId &&
      !['application/json', 'application/ld+json'].includes(script.type)
  );
}

/**
 * Les `href` des feuilles de style déclarées, quel que soit l'ordre des
 * attributs (`rel` avant ou après `href`, citation simple ou double).
 *
 * @param {string} html Document complet.
 * @returns {string[]}
 */
export function feuillesDe(html) {
  const feuilles = [];
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const attributs = {};
    for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attributs[match[1].toLowerCase()] = match[3] !== undefined ? match[3] : match[4];
    }
    if (String(attributs.rel || '').toLowerCase() === 'stylesheet') {
      feuilles.push(String(attributs.href || '').trim());
    }
  }
  return feuilles;
}

/**
 * Le premier `<h1>` du document, espaces normalisés et entités décodées.
 *
 * @param {string} html Document complet.
 * @returns {string}
 */
/**
 * Les entités que le backend écrit (`kojo_job_og.escape_xml`), décodées.
 *
 * Indispensable à l'ACCORD : le document porte la description ÉCHAPPÉE
 * (`d&apos;une pompe &amp; un joint`) tandis que le bloc porte le texte BRUT.
 * Comparer les deux sans décoder refuserait presque toute mission française —
 * une apostrophe suffirait.
 *
 * `&amp;` est décodé EN DERNIER : sinon `&amp;lt;` deviendrait `<` au lieu de
 * `&lt;`.
 *
 * @param {string} texte Texte échappé.
 * @returns {string}
 */
export function decoderEntites(texte) {
  return String(texte || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function h1De(html) {
  const trouve = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(String(html));
  if (!trouve) return '';
  return decoderEntites(String(trouve[1]).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le nombre de `<h1>` du document — un seul est un titre, deux sont un défaut. */
export const nombreDeH1 = (html) => (String(html).match(/<h1\b/gi) || []).length;

/**
 * Le bloc de données de la vue publique, s'il est lisible et destiné à CETTE
 * mission.
 *
 * @param {string} html Document complet.
 * @param {string} seedId Nom déclaré du bloc (`POINT_ENTREE_MISSION.seedId`).
 * @param {string} id Identifiant attendu (celui de la route).
 * @returns {{present: boolean, donnees: object|null, erreur: string}}
 */
export function blocDeDonnees(html, seedId, id) {
  const recherche = new RegExp(
    `<script\\b[^>]*\\bid=["']${seedId}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    'i'
  );
  const trouve = recherche.exec(String(html));
  if (!trouve) return { present: false, donnees: null, erreur: 'absent' };
  let donnees = null;
  try {
    donnees = JSON.parse(trouve[1] || 'null');
  } catch (_erreur) {
    return { present: true, donnees: null, erreur: 'JSON illisible' };
  }
  if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) {
    return { present: true, donnees: null, erreur: 'pas un objet JSON' };
  }
  if (String(donnees.id ?? '') !== String(id)) {
    return {
      present: true,
      donnees,
      erreur: `bloc d'une AUTRE mission (id ${JSON.stringify(donnees.id ?? null)})`,
    };
  }
  return { present: true, donnees, erreur: '' };
}

/**
 * Les champs d'un bloc qui ne devraient jamais sortir — chemin complet dans
 * l'objet (`location.latitude`, `geo`), pour que le refus dise OÙ lire.
 *
 * @param {object} donnees Bloc de données analysé.
 * @returns {string[]} Chemins trouvés, vides si le bloc est publiable.
 */
export function champsInterdits(donnees) {
  const trouves = [];
  const parcourir = (valeur, prefixe) => {
    if (Array.isArray(valeur)) {
      valeur.forEach((element, index) => parcourir(element, `${prefixe}[${index}]`));
      return;
    }
    if (!valeur || typeof valeur !== 'object') return;
    for (const [cle, contenu] of Object.entries(valeur)) {
      const ici = prefixe ? `${prefixe}.${cle}` : cle;
      if (CLES_JAMAIS_PUBLIQUES.includes(cle) || COORDONNEES.test(cle)) trouves.push(ici);
      parcourir(contenu, ici);
    }
  };
  parcourir(donnees, '');
  return trouves;
}

/**
 * La balise `description` est-elle celle du bloc (la coupe du backend, sans la
 * recopier) ?
 *
 * Le backend coupe à `DESCRIPTION_LIMIT` points de code et ajoute « … » quand il
 * a coupé. La sonde n'a donc pas besoin de la longueur : une description qui
 * finit par « … » doit être un PRÉFIXE de celle du bloc, et une description qui
 * ne finit pas par « … » doit être identique. Recopier 150 ici créerait une
 * seconde constante à faire diverger.
 *
 * @param {string} meta Contenu de `<meta name="description">`.
 * @param {unknown} description Description du bloc.
 * @returns {boolean}
 */
export function descriptionAccordee(meta, description) {
  const balise = String(meta || '');
  const texte = String(description ?? '');
  if (!balise.trim() || !texte) return true;
  if (balise.endsWith('…')) return texte.startsWith(balise.slice(0, -1));
  return texte === balise;
}

/**
 * La signature de la COQUE SPA : un script de bundle sous `/assets/`.
 *
 * @param {string} html Document complet.
 * @returns {boolean}
 */
export const ressembleACoqueSpa = (html) =>
  scriptsDe(html).some((script) => /^\/assets\/[^?]*\.js$/i.test(script.src));

/**
 * Juge ce qui fait DÉMARRER la page : point d'entrée, feuille, ordre, et le
 * bloc de données ACCORDÉ au document.
 *
 * @param {object} options
 * @param {string} options.html Document complet.
 * @param {string} options.id Identifiant de la route.
 * @returns {{erreurs: string[], bloc: {present: boolean, donnees: object|null, erreur: string}}}
 */
export function jugerDemarrage({ html, id }) {
  const erreurs = [];
  const seedId = POINT_ENTREE_MISSION.seedId;
  const scripts = scriptsExecutables(html);
  const pied = scripts.filter((script) => script.src === POINT_ENTREE_MISSION.script);
  const bundle = scripts.filter((script) => /^\/assets\//i.test(script.src));
  const autres = scripts.filter(
    (script) => script.src !== POINT_ENTREE_MISSION.script && !/^\/assets\//i.test(script.src)
  );
  const enLigne = scripts.filter((script) => script.inline);

  if (!pied.length) {
    erreurs.push(
      `le document ne charge pas ${POINT_ENTREE_MISSION.script} : un visiteur à froid reçoit une ` +
        `fiche statique, sans châssis, sans navigation et sans bouton — le point d'entrée est ce ` +
        `qui fait démarrer l'application`
    );
  }
  if (pied.length > 1) {
    erreurs.push(
      `${pied.length} chargements du point d'entrée ${POINT_ENTREE_MISSION.script} (attendu 1) : ` +
        `l'application démarrerait deux fois`
    );
  }
  if (bundle.length) {
    erreurs.push(
      `script(s) de bundle dans le document (${bundle.map((s) => s.src).join(', ')}) : c'est la ` +
        `COQUE SPA, ou l'application chargée en plus du point d'entrée`
    );
  }
  if (autres.length || enLigne.length) {
    erreurs.push(
      `script(s) hors point d'entrée déclaré : ${[
        ...autres.map((s) => s.src || '(sans src)'),
        ...enLigne.map((s) => `(en ligne, ${s.inline.length} octet(s))`),
      ].join(', ')} — ce document n'en autorise AUCUN autre, et c'est ce qui le distingue de la coque`
    );
  }

  const feuilles = feuillesDe(html);
  const aLaFeuille = feuilles.includes(POINT_ENTREE_MISSION.style);
  if (!aLaFeuille) {
    erreurs.push(
      `feuille de l'application ${POINT_ENTREE_MISSION.style} ABSENTE (servi : ` +
        `${feuilles.join(', ') || 'aucune'}) : Vite extrait le CSS du JS, donc l'application ` +
        `démarrerait sans style — une page nue se lit comme une page cassée`
    );
  }
  if (aLaFeuille && pied.length) {
    const positionFeuille = String(html).indexOf(POINT_ENTREE_MISSION.style);
    const positionPied = String(html).indexOf(POINT_ENTREE_MISSION.script);
    if (positionFeuille > positionPied) {
      erreurs.push(
        `la feuille ${POINT_ENTREE_MISSION.style} est déclarée APRÈS ${POINT_ENTREE_MISSION.script} : ` +
          `un module est différé, donc la fiche serait peinte sans style puis « habillée » — la ` +
          `feuille doit bloquer le premier rendu (ordre « <link> » puis « <script type="module"> »)`
      );
    }
  }

  const bloc = blocDeDonnees(html, seedId, id);
  if (!bloc.present) {
    erreurs.push(
      `bloc de données #${seedId} absent : la fiche démarrerait par un chargement et afficherait ` +
        `un squelette sur un document que le serveur vient de rendre. Le routeur ne pose ce bloc ` +
        `que si la mission valide l'allowlist JobPublic — vérifier l'avertissement de ` +
        `/api/og/jobs/:id au journal, puis corriger la DONNÉE (pas le code)`
    );
  } else if (bloc.erreur) {
    erreurs.push(`bloc de données #${seedId} : ${bloc.erreur}`);
  } else {
    const interdits = champsInterdits(bloc.donnees);
    if (interdits.length) {
      erreurs.push(
        `bloc de données #${seedId} publie des champs JAMAIS publics (${interdits.join(', ')}) : ` +
          `le document est public et mis en cache — coordonnées, identités et jetons n'y entrent pas`
      );
    }
    const titre = String(bloc.donnees.title ?? '').trim();
    if (titre) {
      const h1 = h1De(html);
      const attendu = `${titre} — Kojo`;
      if (h1 !== attendu) {
        erreurs.push(
          `<h1> « ${h1 || 'absent'} » ne correspond pas au bloc (« ${attendu} ») : le document et ` +
            `ses données ne parlent pas de la même mission`
        );
      }
    }
    if (
      !descriptionAccordee(
        decoderEntites(metaContent(html, 'description')),
        bloc.donnees.description
      )
    ) {
      erreurs.push(
        `meta description « ${metaContent(html, 'description')} » n'est pas la description du bloc ` +
          `(« ${String(bloc.donnees.description ?? '').slice(0, 80)}… ») : l'onglet et la fiche ` +
          `annonceraient deux missions`
      );
    }
  }

  return { erreurs, bloc };
}

/**
 * Juge le document 404 de la SENTINELLE — le verdict sur la RÉÉCRITURE.
 *
 * @param {{status: number, html: string, robots?: string}} reponse
 * @returns {string[]} Défauts, vides si le document est celui du backend.
 */
export function jugerDocument404({ status, html, robots = '' }) {
  const erreurs = [];
  const scripts = scriptsDe(html);
  const bundle = scripts.filter((script) => /^\/assets\//i.test(script.src));

  if (status !== 404) {
    erreurs.push(
      `l'identifiant sentinelle « ${ID_SENTINELLE} » répond HTTP ${status} au lieu de 404 : la ` +
        `RÉÉCRITURE Vercel (/jobs/(.*) → /api/og/jobs/$1) ne sert plus le backend — un visiteur ` +
        `reçoit la coque SPA (ou une autre page), pas le document pré-rendu de la mission`
    );
  }
  if (!declaresNoIndex(html, robots)) {
    erreurs.push(
      `le document de la sentinelle ne porte AUCUN noindex (ni x-robots-tag, ni <meta name="robots">) : ` +
        `un identifiant mort devient indexable, donc « la coque » est servie ou le backend a perdu ` +
        `son noindex de 404`
    );
  }
  if (bundle.length) {
    erreurs.push(
      `le document de la sentinelle charge ${bundle.length} script(s) de bundle ` +
        `(${bundle.map((s) => s.src).join(', ')}) : c'est la COQUE SPA, pas le document du backend ` +
        `— la réécriture de /jobs/(.*) est perdue`
    );
  }
  const pied = scripts.filter((script) => script.src === POINT_ENTREE_MISSION.script);
  if (!pied.length) {
    erreurs.push(
      `le document de la sentinelle ne porte pas le point d'entrée ${POINT_ENTREE_MISSION.script} : ` +
        `un lien partagé devenu mort n'ouvrirait aucune application (ni châssis, ni navigation, ` +
        `ni 404 de l'app)`
    );
  }
  return erreurs;
}

/**
 * Juge le document d'une MISSION RÉELLE.
 *
 * @param {object} options
 * @param {number} options.status Statut HTTP.
 * @param {string} options.contentType En-tête `content-type`.
 * @param {string} options.html Corps de la réponse.
 * @param {string} [options.robots] En-tête `x-robots-tag`.
 * @param {string} options.base Origine jugée (sans slash final).
 * @param {string} options.id Identifiant de la mission demandée.
 * @returns {string[]} Défauts, vides si le document est conforme.
 */
export function jugerDocumentFiche({ status, contentType = '', html, robots = '', base, id }) {
  const erreurs = [];
  const origin = String(base).replace(/\/+$/, '');
  const url = `${origin}${cheminFiche(id)}`;

  if (status !== 200) {
    erreurs.push(
      `le document de la fiche répond HTTP ${status} (attendu 200) : la réécriture Vercel ne sert ` +
        `pas le backend, ou la mission n'est plus publiée`
    );
  }
  if (!/text\/html/i.test(String(contentType))) {
    erreurs.push(`content-type « ${contentType || 'absent'} » : ce n'est pas un document HTML servi`);
  }
  if (ressembleACoqueSpa(html)) {
    erreurs.push(
      `le document charge un script de bundle (/assets/…js) : c'est la COQUE SPA — la réécriture ` +
        `/jobs/(.*) → /api/og/jobs/$1 est perdue, donc aucun canonical de fiche, aucun <h1> de ` +
        `mission et aucun bloc de données ne sont servis`
    );
  }

  // 1. L'en-tête qui dit de QUELLE mission il s'agit.
  const canonical = canonicalHref(html);
  if (canonical !== url) {
    erreurs.push(
      `canonical « ${canonical || 'absent'} » au lieu de « ${url} » — un crawler suit ce que le ` +
        `document annonce, pas l'adresse par laquelle il est arrivé`
    );
  }
  for (const cle of ['og:url', 'twitter:url']) {
    const valeur = metaContent(html, cle);
    if (valeur !== url) {
      erreurs.push(`${cle} « ${valeur || 'absent'} » au lieu de « ${url} »`);
    }
  }
  if (declaresNoIndex(html, robots)) {
    erreurs.push(
      `la fiche est servie en noindex (x-robots-tag ou meta robots) : une mission vivante doit ` +
        `s'indexer — seul le 404 de la sentinelle porte noindex`
    );
  }
  if (!titleOf(html)) {
    erreurs.push('document sans <title> — un onglet et un résultat de recherche seraient vides');
  }
  const description = metaContent(html, 'description');
  if (!description.trim()) {
    erreurs.push(
      'meta description absente : la carte de partage et le résultat de recherche seraient sans texte'
    );
  }
  for (const cle of ['og:description', 'twitter:description']) {
    const valeur = metaContent(html, cle);
    if (valeur !== description) {
      erreurs.push(
        `${cle} « ${valeur || 'absent'} » diffère de la meta description : deux descriptions pour ` +
          `une page, donc deux vérités selon le canal`
      );
    }
  }

  // 2. Le `<h1>` : un seul, et il annonce la mission.
  const h1Nombre = nombreDeH1(html);
  const h1 = h1De(html);
  if (h1Nombre !== 1) {
    erreurs.push(`${h1Nombre} <h1> dans le document (attendu 1) : le titre de la page n'est pas un titre`);
  } else if (!h1) {
    erreurs.push('<h1> vide : la fiche n\'annonce pas le titre de la mission');
  }

  // 3. Ce qui fait démarrer l'application, et le bloc accordé.
  const { erreurs: demarrage } = jugerDemarrage({ html, id });
  erreurs.push(...demarrage);

  return erreurs;
}

/** Lit une réponse en texte, sans laisser une erreur de lecture masquer le statut. */
const texte = async (res) => {
  try {
    return await res.text();
  } catch (_erreur) {
    return '';
  }
};

/**
 * L'identifiant de la première fiche au sitemap, ou celui qu'on a fourni.
 *
 * @param {object} options
 * @param {string} options.base Origine à interroger.
 * @param {string} [options.job] Identifiant ou URL explicite (`--job`).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{id: string, source: string, erreur: string}>}
 */
export async function resoudreJob({ base, job = '', fetchImpl = fetch }) {
  const explicite = String(job || '')
    .trim()
    .replace(/\/+$/, '');
  if (explicite) {
    // Une URL complète est acceptée : on ne garde que son dernier segment, mais
    // on refuse une URL qui ne serait pas une fiche (un copier-coller de
    // /workers/… jugerait une autre page avec les règles de celle-ci).
    if (/^https?:\/\//i.test(explicite)) {
      let chemin = '';
      try {
        chemin = new URL(explicite).pathname;
      } catch (_erreur) {
        return { id: '', source: 'argument', erreur: `--job « ${job} » n'est pas une URL lisible` };
      }
      const trouve = /^\/jobs\/([^/]+)\/?$/.exec(chemin);
      if (!trouve) {
        return {
          id: '',
          source: 'argument',
          erreur: `--job « ${job} » n'est pas une fiche (/jobs/:id attendu, chemin lu : ${chemin})`,
        };
      }
      return { id: decodeURIComponent(trouve[1]), source: 'argument', erreur: '' };
    }
    return { id: decodeURIComponent(explicite), source: 'argument', erreur: '' };
  }

  const url = `${String(base).replace(/\/+$/, '')}/sitemap.xml`;
  let xml = '';
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'kojo-job-page-probe/1.0', accept: 'application/xml,text/xml,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) {
      return {
        id: '',
        source: 'sitemap',
        erreur: `sitemap ${url} HTTP ${res.status} — la réécriture /sitemap.xml → backend est peut-être perdue aussi`,
      };
    }
    xml = await res.text();
  } catch (err) {
    return { id: '', source: 'sitemap', erreur: `sitemap ${url} injoignable (${err.message})` };
  }

  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
  for (const loc of locs) {
    let chemin = '';
    try {
      chemin = new URL(loc).pathname;
    } catch (_erreur) {
      continue;
    }
    const trouve = /^\/jobs\/([^/]+)\/?$/.exec(chemin);
    if (trouve) return { id: decodeURIComponent(trouve[1]), source: 'sitemap', erreur: '' };
  }
  return { id: '', source: 'sitemap', erreur: '' };
}

/**
 * La sonde complète.
 *
 * @param {object} [options]
 * @param {string} [options.base] Origine frontend servie (défaut : production).
 * @param {string} [options.job] Identifiant ou URL de fiche (défaut : sitemap).
 * @param {boolean} [options.quiet] Tait la progression (tests).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{ok: boolean, premise: boolean, errors: string[], checked: string[],
 *   notices: string[], jobId: string, source: string}>}
 */
export async function runJobPageProbe({
  base = process.env.KOJO_JOB_BASE_URL || DEFAULT_BASE,
  job = process.env.KOJO_JOB_ID || '',
  quiet = false,
  fetchImpl = fetch,
} = {}) {
  const BASE = String(base).trim().replace(/\/+$/, '');
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];
  const checked = [];
  const notices = [];
  const result = {
    ok: false,
    premise: false,
    errors,
    checked,
    notices,
    jobId: '',
    source: '',
  };

  // ── 1. La RÉÉCRITURE, jugée sans corpus (sentinelle).
  const sentinelleUrl = `${BASE}${cheminFiche(ID_SENTINELLE)}`;
  let sentinelle = { status: 0, html: '', robots: '' };
  try {
    const res = await fetchImpl(sentinelleUrl, {
      redirect: 'follow',
      headers: { 'user-agent': 'kojo-job-page-probe/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    sentinelle = {
      status: res.status,
      html: await texte(res),
      robots: res.headers.get('x-robots-tag') || '',
    };
  } catch (err) {
    errors.push(
      `la sentinelle ${sentinelleUrl} est injoignable (${err.message}) : production indisponible, ` +
        `ou la réécriture renvoie une erreur réseau`
    );
  }

  if (sentinelle.status) {
    const defauts = jugerDocument404(sentinelle);
    if (defauts.length) errors.push(...defauts);
    else
      checked.push(
        `  ✓ réécriture vivante : ${sentinelleUrl} → 404 du backend (noindex, point d'entrée, aucun script de bundle)`
      );
  }

  // ── 2. La FICHE d'une mission réelle, s'il y en a une à juger.
  const resolution = await resoudreJob({ base: BASE, job, fetchImpl });
  result.jobId = resolution.id;
  result.source = resolution.source;

  if (resolution.erreur) {
    errors.push(resolution.erreur);
  }

  if (!resolution.id && !resolution.erreur) {
    // Aucune mission publiée : la RÉÉCRITURE a été jugée (preuve ci-dessus), le
    // démarrage d'une fiche ne PEUT PAS l'être. Ce n'est pas un vert — une
    // prémisse, nommée.
    result.premise = true;
    const message =
      `${MARQUE_PREMISSE} : aucune fiche /jobs/:id au sitemap de ${BASE} — le démarrage d'une ` +
      `fiche (point d'entrée, feuille, bloc de données accordé) n'a donc PAS été jugé. La ` +
      `réécriture, elle, a été mesurée sur la sentinelle ${ID_SENTINELLE}. Publier une mission, ` +
      `ou passer --job <id|url> pour juger une fiche précise.`;
    notices.push(message);
    log(`⚠️ ${message}`);
    // Une prémisse n'est JAMAIS un vert : `ok` reste faux même sans défaut, sinon
    // un appelant qui ne lit que `ok` publierait une conformité que personne n'a
    // mesurée.
    result.ok = false;
    return result;
  }

  if (resolution.id) {
    const url = `${BASE}${cheminFiche(resolution.id)}`;
    let reponse = { status: 0, contentType: '', html: '', robots: '' };
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'kojo-job-page-probe/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      reponse = {
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        html: await texte(res),
        robots: res.headers.get('x-robots-tag') || '',
      };
    } catch (err) {
      errors.push(`le document de la fiche ${url} est injoignable (${err.message})`);
    }

    if (reponse.status) {
      const defauts = jugerDocumentFiche({
        status: reponse.status,
        contentType: reponse.contentType,
        html: reponse.html,
        robots: reponse.robots,
        base: BASE,
        id: resolution.id,
      });
      if (defauts.length) {
        errors.push(...defauts.map((defaut) => `[${url}] ${defaut}`));
      } else {
        checked.push(
          `  ✓ ${url} (fiche ${resolution.id}, via ${resolution.source}) : canonical et og:url, ` +
            `point d'entrée unique, feuille avant le module, bloc #${POINT_ENTREE_MISSION.seedId} ` +
            `accordé au <h1> et à la description, aucun champ privé`
        );
      }
    }
  }

  result.ok = errors.length === 0;
  return result;
}

/** Les options de ligne de commande (`--base`, `--job`, `--quiet`). */
export function parseArguments(argv = process.argv.slice(2)) {
  const options = { base: '', job: '', quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[(index += 1)] || '';
    else if (argument === '--job') options.job = argv[(index += 1)] || '';
    else if (argument === '--quiet') options.quiet = true;
  }
  return options;
}

export const libelleSonde = (base) =>
  `${FAMILLE} — le document SERVI de ${String(base).replace(/\/+$/, '')}/jobs/:id`;

const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  const options = parseArguments();
  const resultat = await runJobPageProbe({
    base: options.base || undefined,
    job: options.job || undefined,
    quiet: options.quiet,
  });
  console.log(`\n${libelleSonde(options.base || DEFAULT_BASE)}`);
  for (const ligne of resultat.checked) console.log(ligne);

  if (resultat.errors.length) {
    console.error(`\n❌ ${resultat.errors.length} défaut(s) — ${TITRE_ERREUR} :`);
    for (const erreur of resultat.errors) console.error(`  • ${erreur}`);
    console.error(
      `\n   → le document est écrit par le BACKEND (backend/kojo_job_og.py), servi par la ` +
        `réécriture de frontend/vercel.json, et son en-tête est jugé hors ligne par ` +
        `scripts/check-job-og-contract.js. Corriger le côté FAUTIF : un bloc ou un démarrage ` +
        `divergent se répare dans le premier (ou dans la DONNÉE quand le bloc manque), une ` +
        `réécriture perdue dans le second.`
    );
    console.error(
      `::error title=${TITRE_ERREUR}::${resultat.errors.length} défaut(s) sur le document servi de /jobs/:id`
    );
    process.exit(1);
  }

  if (resultat.premise) {
    console.error(`::error title=${TITRE_ERREUR}::${resultat.notices.join(' ') || MARQUE_PREMISSE}`);
    process.exit(2);
  }

  console.log(
    `\n✅ Document servi de /jobs/:id conforme : réécriture vers le backend mesurée sur la ` +
      `sentinelle, et fiche ${resultat.jobId} jugée (point d'entrée, feuille, bloc ` +
      `#${POINT_ENTREE_MISSION.seedId} accordé, canonical et og:url).`
  );
}
