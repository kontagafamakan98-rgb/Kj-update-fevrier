#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — le document SERVI de `/workers/:id` est-il celui du
 * backend, ou la coque SPA ?
 *
 * ── Le fait que cette sonde juge, et pourquoi rien d'autre ne le faisait ────
 * `/workers/:id` n'est pas une route du build : Vercel la réécrit vers le
 * backend (`vercel.json`, `/workers/(.*)` → `/api/og/workers/$1`), qui écrit le
 * document pré-rendu. Si cette réécriture disparaît (entrée retirée, ordre des
 * rewrites changé, déploiement d'un `vercel.json` d'avant), le site ne tombe pas :
 * il répond **200 avec la coque SPA** — un document valide, indexable, sans
 * canonical de profil, sans cartes OG de travailleur, sans `<h1>`, et dont le
 * `<title>` est celui de l'application. Aucun test du dépôt ne le voit : les
 * gardes hors ligne (`check-worker-og-contract.js`) exécutent le backend, pas la
 * table de rewrites, et `check-spa-routes.js` lit la CONFIGURATION, pas ce qui
 * est servi. C'est exactement la forme du 12/10/2026, appliquée à une page : un
 * vert qui n'a rien mesuré.
 *
 * ── Deux jugements, et le premier ne dépend d'AUCUNE donnée ────────────────
 * 1. LA RÉÉCRITURE (toujours, sans corpus) : la sonde demande l'identifiant
 *    sentinelle `kojo-sonde-reecriture`, qui n'existe pas. Un backend qui le
 *    reçoit répond son document 404 (`noindex`, point d'entrée, aucun script de
 *    bundle) ; une coque SPA répond 200 + `/assets/*.js`, sans `noindex`. La
 *    sentinelle est choisie pour ne jamais désigner un compte réel, donc ce
 *    jugement ne dépend ni du corpus, ni d'une écriture : il tombe chaque jour.
 * 2. LA FICHE (dès qu'un profil est publié) : l'identifiant est celui du
 *    sitemap — la surface par laquelle un crawler la découvre — ou celui qu'on
 *    passe à `--worker`. La sonde juge alors le document de CE profil :
 *    `canonical`, `og:url`, les DEUX cartes (wide 1200×630 + carrée 1200×1200),
 *    `twitter:*`, `<h1>`, description accordée, point d'entrée, et le bloc de
 *    données déjà rendu.
 *
 * ── « Zéro `<script>` » : la propriété a changé le 21/10/2026, et elle est
 *    jugée PLUS strictement ────────────────────────────────────────────────
 * Ce document ne chargeait aucun script ; il charge désormais UN SEUL module,
 * le point d'entrée stable (`/boot/worker-boot.js`, déclaré dans
 * `src/config/apercu-travailleur.js` → `scripts/site-meta.js`) qui fait démarrer
 * l'application pour un visiteur à froid. La sonde refuse donc : tout script
 * dont la `src` n'est pas CE chemin, plus d'un script, un script en ligne, et
 * surtout tout `/assets/…js` — la signature de la coque. C'est ce qui distingue
 * les deux documents, et c'est plus précis que « aucun script » : un document
 * qui aurait perdu son point d'entrée est refusé aussi (il ne démarre plus).
 *
 * ── Ce que la sonde ne juge pas ────────────────────────────────────────────
 * Le TEXTE du titre et de la description (sa longueur, la coupe en points de
 * code) : c'est le contrat hors ligne (`check-worker-og-contract.js`) qui le
 * juge, en exécutant les deux implémentations. Ici on juge la FORME SERVIE et sa
 * cohérence interne (canonical = og:url = l'adresse demandée, description =
 * og:description), pas la rédaction — sinon deux gardes se contrediraient un
 * jour sur une phrase.
 *
 * Usage :
 *   node scripts/check-worker-page-production.js                       # production
 *   node scripts/check-worker-page-production.js --base https://…      # une preview
 *   node scripts/check-worker-page-production.js --worker <id|url>     # un profil précis
 *
 * Sorties : 0 = document jugé conforme ; 1 = refus (le défaut est nommé) ;
 * 2 = prémisse (aucun profil publié : aucune fiche à juger, jamais un vert).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  POINT_ENTREE_TRAVAILLEUR,
  SITE_ORIGIN,
  canonicalHref,
  declaresNoIndex,
  metaContent,
  metaContents,
  titleOf,
} from './site-meta.js';

export const DEFAULT_BASE = SITE_ORIGIN;

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'document de profil travailleur';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'Profil travailleur production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * L'identifiant SENTINELLE : improbable par construction, et sans rapport avec
 * un compte. Il ne sert pas à juger un profil — il sert à faire parler la
 * RÉÉCRITURE : un backend répond son 404, une coque SPA répond 200.
 */
export const ID_SENTINELLE = 'kojo-sonde-reecriture';

/** Chemin public d'un profil. */
export const cheminProfil = (id) => `/workers/${encodeURIComponent(id)}`;

/** Les deux cartes OG d'un profil — chemins produits par le backend. */
export const cartesAttendues = (id) => {
  const base = `/api/og/workers/${encodeURIComponent(id)}`;
  return { wide: `${base}.png`, carree: `${base}-square.png` };
};

const TIMEOUT_MS = 20000;

/**
 * Les balises `<script>` d'un document, avec ce qu'elles CHARGENT.
 *
 * Lit l'attribut `src` (citations simples ou doubles) et le contenu en ligne :
 * les deux formes comptent, parce que c'est l'absence de script de BUNDLE qui
 * distingue le document pré-rendu de la coque — et un script en ligne serait un
 * script qu'aucune déclaration ne couvre.
 *
 * @param {string} html Document complet.
 * @returns {{src: string, type: string, id: string, inline: string}[]}
 */
export function scriptsDe(html) {
  const scripts = [];
  for (const tag of String(html).match(/<script\b[^>]*>/gi) || []) {
    const lire = (nom) => {
      const trouve = new RegExp(`\\b${nom}\\s*=\\s*(\"([^\"]*)\"|'([^']*)')`, 'i').exec(tag);
      return trouve ? (trouve[2] !== undefined ? trouve[2] : trouve[3]) : '';
    };
    scripts.push({
      src: lire('src').trim(),
      type: lire('type').trim().toLowerCase(),
      id: lire('id').trim(),
      inline: '',
    });
  }
  // Le contenu EN LIGNE : entre `<script …>` et `</script>`. Un `<script
  // src=…>` a un corps vide, donc la même lecture sert les deux formes.
  const corps = [...String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  corps.forEach((trouve, index) => {
    if (scripts[index]) scripts[index].inline = String(trouve[1] || '').trim();
  });
  return scripts;
}

/**
 * Les scripts que le navigateur EXÉCUTE — donc ceux que la sonde compte.
 *
 * Le bloc de données (`<script type="application/json" id="kojo-worker-data">`)
 * n'est PAS un script exécuté : il ne charge rien, ne s'exécute pas, et le
 * compter comme « script en ligne » ferait refuser tous les documents conformes.
 *
 * @param {string} html Document complet.
 * @param {string} [seedId] Nom du bloc de données à écarter.
 * @returns {{src: string, type: string, id: string, inline: string}[]}
 */
export function scriptsExecutables(html, seedId = POINT_ENTREE_TRAVAILLEUR.seedId) {
  return scriptsDe(html).filter(
    (script) =>
      script.id !== seedId &&
      !['application/json', 'application/ld+json'].includes(script.type)
  );
}

/**
 * Le premier `<h1>` du document, espaces normalisés, ou `''`.
 *
 * @param {string} html Document complet.
 * @returns {string}
 */
export function h1De(html) {
  const trouve = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(String(html));
  if (!trouve) return '';
  return String(trouve[1])
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le nombre de `<h1>` du document — un seul est un titre, deux sont un défaut. */
export const nombreDeH1 = (html) => (String(html).match(/<h1\b/gi) || []).length;

/**
 * Le bloc de données de la vue publique, s'il est lisible et destiné à CET
 * identifiant.
 *
 * @param {string} html Document complet.
 * @param {string} seedId Nom déclaré du bloc (`POINT_ENTREE_TRAVAILLEUR.seedId`).
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
      erreur: `bloc d'un AUTRE profil (id ${JSON.stringify(donnees.id ?? null)})`,
    };
  }
  return { present: true, donnees, erreur: '' };
}

/**
 * La signature de la COQUE SPA : un script de bundle sous `/assets/`.
 *
 * C'est le fait qui rend une réécriture perdue invisible autrement : la coque
 * est un document valide, simplement ce n'est pas la fiche. Exporté pour que le
 * test de la sonde puisse vérifier le détecteur lui-même (un détecteur qui ne
 * reconnaîtrait rien ferait passer toutes les assertions suivantes).
 */
export const ressembleACoqueSpa = (html) =>
  scriptsDe(html).some((script) => /^\/assets\/[^?]*\.js$/i.test(script.src));

/**
 * Juge le document 404 de la SENTINELLE — le verdict sur la RÉÉCRITURE.
 *
 * Ce qui est exigé : un 404 (le backend ne connaît pas cet identifiant), noindex
 * (un lien mort ne s'indexe pas), le point d'entrée (un lien mort garde une
 * issue : l'application s'ouvre sur « introuvable »), AUCUN script de bundle
 * (sinon c'est la coque), et un `<h1>` absent — le document 404 du backend n'en
 * porte pas, c'est la coque qui en aurait un par l'application.
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
      `l'identifiant sentinelle « ${ID_SENTINELLE} » répond HTTP ${status} au lieu de 404 : ` +
        `la RÉÉCRITURE Vercel (/workers/(.*) → /api/og/workers/$1) ne sert plus le backend — ` +
        `un visiteur reçoit la coque SPA (ou une autre page), pas le document pré-rendu`
    );
  }
  if (!declaresNoIndex(html, robots)) {
    erreurs.push(
      `le document de la sentinelle ne porte AUCUN noindex (ni x-robots-tag, ni <meta name="robots">) : ` +
        `un identifiant mort devient indexable, donc « la coque » est servie ou le backend a perdu son ` +
        `noindex de 404`
    );
  }
  if (bundle.length) {
    erreurs.push(
      `le document de la sentinelle charge ${bundle.length} script(s) de bundle ` +
        `(${bundle.map((s) => s.src).join(', ')}) : c'est la COQUE SPA, pas le document du backend ` +
        `— la réécriture de /workers/(.*) est perdue`
    );
  }
  const pointEntree = scripts.filter((script) => script.src === POINT_ENTREE_TRAVAILLEUR.script);
  if (!pointEntree.length) {
    erreurs.push(
      `le document de la sentinelle ne porte pas le point d'entrée ${POINT_ENTREE_TRAVAILLEUR.script} : ` +
        `un lien partagé devenu mort n'ouvrirait aucune application (ni châssis, ni navigation, ni 404 de l'app)`
    );
  }
  return erreurs;
}

/**
 * Juge le document d'un PROFIL RÉEL — quatre groupes de faits, nommés un par un.
 *
 * @param {object} options
 * @param {number} options.status Statut HTTP de la réponse.
 * @param {string} options.contentType En-tête `content-type`.
 * @param {string} options.html Corps de la réponse.
 * @param {string} [options.robots] En-tête `x-robots-tag`.
 * @param {string} options.base Origine jugée (sans slash final).
 * @param {string} options.id Identifiant du profil demandé.
 * @returns {string[]} Défauts, vides si le document est conforme.
 */
export function jugerDocumentProfil({ status, contentType = '', html, robots = '', base, id }) {
  const erreurs = [];
  const url = `${String(base).replace(/\/+$/, '')}${cheminProfil(id)}`;
  const cartes = cartesAttendues(id);
  const origin = String(base).replace(/\/+$/, '');

  if (status !== 200) {
    erreurs.push(
      `le document du profil répond HTTP ${status} (attendu 200) : ` +
        `la réécriture Vercel ne sert pas le backend, ou le profil n'est plus publié`
    );
  }
  if (!/text\/html/i.test(String(contentType))) {
    erreurs.push(`content-type « ${contentType || 'absent'} » : ce n'est pas un document HTML servi`);
  }
  if (ressembleACoqueSpa(html)) {
    erreurs.push(
      `le document charge un script de bundle (/assets/…js) : c'est la COQUE SPA — la réécriture ` +
        `/workers/(.*) → /api/og/workers/$1 est perdue, donc aucun canonical de profil, aucune carte OG ` +
        `de travailleur et aucun <h1> ne sont servis`
    );
  }

  // 1. L'en-tête SEO : canonical ET og:url annoncent l'adresse demandée.
  const canonical = canonicalHref(html);
  if (canonical !== url) {
    erreurs.push(
      `canonical « ${canonical || 'absent'} » au lieu de « ${url} » — un crawler suit ce que le document ` +
        `annonce, pas l'adresse par laquelle il est arrivé`
    );
  }
  const ogUrl = metaContent(html, 'og:url');
  if (ogUrl !== url) {
    erreurs.push(`og:url « ${ogUrl || 'absent'} » au lieu de « ${url} »`);
  }
  if (declaresNoIndex(html, robots)) {
    erreurs.push(
      `le profil est servi en noindex (x-robots-tag ou meta robots) : la page a quitté le noindex ` +
        `le 20/10/2026, un profil publié doit être indexable`
    );
  }
  if (!titleOf(html)) {
    erreurs.push('document sans <title> — un onglet et un résultat de recherche seraient vides');
  }

  // 2. La description, accordée aux deux cartes qui la reprennent.
  const description = metaContent(html, 'description');
  if (!description.trim()) {
    erreurs.push('meta description absente : la carte de partage et le résultat de recherche seraient sans texte');
  }
  for (const cle of ['og:description', 'twitter:description']) {
    const valeur = metaContent(html, cle);
    if (valeur !== description) {
      erreurs.push(
        `${cle} « ${valeur || 'absent'} » diffère de la meta description : deux descriptions pour une page, ` +
          `donc deux vérités selon le canal`
      );
    }
  }

  // 3. Les DEUX cartes OG, et leurs dimensions (wide 1200×630, carrée 1200×1200).
  const images = metaContents(html, 'og:image');
  const attendues = [`${origin}${cartes.wide}`, `${origin}${cartes.carree}`];
  if (images.length !== 2) {
    erreurs.push(
      `${images.length} carte(s) og:image servie(s) (attendu 2 : ${attendues.join(' et ')}) — ` +
        `un partage sans la carte carrée perd son aperçu sur les surfaces qui la préfèrent`
    );
  }
  for (const attendue of attendues) {
    if (!images.includes(attendue)) {
      erreurs.push(`carte og:image « ${attendue} » ABSENTE (servi : ${images.join(', ') || 'aucune'})`);
    }
  }
  const largeurs = metaContents(html, 'og:image:width');
  const hauteurs = metaContents(html, 'og:image:height');
  if (largeurs.length !== 2 || largeurs.some((v) => v.trim() !== '1200')) {
    erreurs.push(`og:image:width « ${largeurs.join(', ') || 'absent'} » (attendu 1200 et 1200)`);
  }
  if (hauteurs.length !== 2 || [...hauteurs].sort().join(',') !== '1200,630') {
    erreurs.push(
      `og:image:height « ${hauteurs.join(', ') || 'absent'} » (attendu 630 pour la wide et 1200 pour la carrée)`
    );
  }
  if (metaContent(html, 'twitter:card') !== 'summary_large_image') {
    erreurs.push(
      `twitter:card « ${metaContent(html, 'twitter:card') || 'absent'} » (attendu summary_large_image)`
    );
  }

  // 4. Le `<h1>` et le point d'entrée — ce qu'un visiteur voit, et ce qui le fait démarrer.
  const h1 = h1De(html);
  const h1Nombre = nombreDeH1(html);
  if (h1Nombre !== 1) {
    erreurs.push(`${h1Nombre} <h1> dans le document (attendu 1) : le titre de la page n'est pas un titre`);
  } else if (!h1) {
    erreurs.push('<h1> vide : le profil n\'annonce pas le nom du travailleur');
  } else if (h1 === 'Travailleur introuvable') {
    erreurs.push(
      '<h1> « Travailleur introuvable » : le profil demandé est vivant au sitemap mais le backend répond ' +
        'son document 404 — la fiche a été dépubliée entre les deux lectures, ou la route a changé'
    );
  }

  const scripts = scriptsExecutables(html);
  const bundle = scripts.filter((script) => /^\/assets\//i.test(script.src));
  const pied = scripts.filter((script) => script.src === POINT_ENTREE_TRAVAILLEUR.script);
  const autres = scripts.filter(
    (script) => script.src !== POINT_ENTREE_TRAVAILLEUR.script && !/^\/assets\//i.test(script.src)
  );
  if (!pied.length) {
    erreurs.push(
      `le document ne charge pas ${POINT_ENTREE_TRAVAILLEUR.script} : un visiteur à froid reçoit un texte ` +
        `statique, sans châssis ni navigation (le point d'entrée est le seul script autorisé)`
    );
  }
  if (pied.length > 1) {
    erreurs.push(`${pied.length} chargements du point d'entrée ${POINT_ENTREE_TRAVAILLEUR.script} (attendu 1)`);
  }
  if (bundle.length) {
    // Déjà nommé plus haut pour la coque ; ici c'est le cas « les deux à la fois »
    // (document de profil ET script de bundle), qui double le chargement de l'app.
    erreurs.push(
      `script(s) de bundle dans le document de profil (${bundle.map((s) => s.src).join(', ')}) : ` +
        `l'application serait chargée deux fois`
    );
  }
  if (autres.length || scripts.some((script) => script.inline)) {
    erreurs.push(
      `script(s) hors point d'entrée déclaré : ${[
        ...autres.map((s) => s.src || '(sans src)'),
        ...scripts.filter((s) => s.inline).map((s) => `(en ligne, ${s.inline.length} octet(s))`),
      ].join(', ')} — ce document n'en autorise AUCUN autre, et c'est ce qui le distingue de la coque`
    );
  }

  const feuille = [...String(html).matchAll(/<link\b[^>]*>/gi)]
    .map((tag) => /rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(tag[0]) || /href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["']/i.exec(tag[0]))
    .filter(Boolean)
    .map((trouve) => trouve[1]);
  if (!feuille.includes(POINT_ENTREE_TRAVAILLEUR.style)) {
    erreurs.push(
      `feuille de l'application ${POINT_ENTREE_TRAVAILLEUR.style} ABSENTE (servi : ${feuille.join(', ') || 'aucune'}) : ` +
        `Vite extrait le CSS du JS, donc l'application démarrerait sans style`
    );
  }

  // 5. Le bloc de données : la vue publique déjà rendue, pour CET identifiant.
  const bloc = blocDeDonnees(html, POINT_ENTREE_TRAVAILLEUR.seedId, id);
  if (!bloc.present) {
    erreurs.push(
      `bloc de données #${POINT_ENTREE_TRAVAILLEUR.seedId} absent : l'application redemanderait le profil ` +
        `et afficherait un squelette sur une page que le serveur vient de rendre`
    );
  } else if (bloc.erreur) {
    erreurs.push(`bloc de données #${POINT_ENTREE_TRAVAILLEUR.seedId} : ${bloc.erreur}`);
  } else {
    const nom = [bloc.donnees.first_name, bloc.donnees.last_name]
      .filter((partie) => String(partie || '').trim())
      .join(' ')
      .trim();
    if (nom && h1 !== nom) {
      erreurs.push(
        `<h1> « ${h1} » ne correspond pas au profil du bloc (« ${nom} ») : le document et ses données ne ` +
          `parlent pas de la même personne`
      );
    }
  }
  return erreurs;
}

/**
 * L'identifiant du premier profil publié au sitemap, ou celui qu'on a fourni.
 *
 * @param {object} options
 * @param {string} options.base Origine à interroger.
 * @param {string} [options.worker] Identifiant ou URL explicite (`--worker`).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{id: string, source: string, erreur: string}>}
 */
export async function resoudreProfil({ base, worker = '', fetchImpl = fetch }) {
  const explicite = String(worker || '')
    .trim()
    .replace(/\/+$/, '');
  if (explicite) {
    // Une URL complète est acceptée : on ne garde que son dernier segment, mais
    // on refuse une URL qui ne serait pas un profil (un copier-coller de /jobs/…
    // jugerait une autre page avec les règles de celle-ci).
    if (/^https?:\/\//i.test(explicite)) {
      let chemin = '';
      try {
        chemin = new URL(explicite).pathname;
      } catch (_erreur) {
        return { id: '', source: 'argument', erreur: `--worker « ${worker} » n'est pas une URL lisible` };
      }
      const trouve = /^\/workers\/([^/]+)\/?$/.exec(chemin);
      if (!trouve) {
        return {
          id: '',
          source: 'argument',
          erreur: `--worker « ${worker} » n'est pas un profil (/workers/:id attendu, chemin lu : ${chemin})`,
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
      headers: { 'user-agent': 'kojo-worker-page-probe/1.0', accept: 'application/xml,text/xml,*/*' },
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
    const trouve = /^\/workers\/([^/]+)\/?$/.exec(chemin);
    if (trouve) return { id: decodeURIComponent(trouve[1]), source: 'sitemap', erreur: '' };
  }
  return {
    id: '',
    source: 'sitemap',
    erreur: '',
    profils: 0,
  };
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
 * Juge les deux cartes OG en HTTP : 200, `image/png`, et la signature PNG.
 *
 * Le document peut annoncer des cartes qui répondent 404 (route Pillow cassée,
 * identifiant d'un autre profil) : un partage afficherait alors une vignette
 * vide, ce que la seule lecture du HTML ne dit pas.
 *
 * @returns {Promise<string[]>} Défauts.
 */
export async function jugerCartes({ base, id, fetchImpl = fetch }) {
  const erreurs = [];
  const cartes = cartesAttendues(id);
  for (const [nom, chemin] of [
    ['wide', cartes.wide],
    ['carrée', cartes.carree],
  ]) {
    const url = `${String(base).replace(/\/+$/, '')}${chemin}`;
    try {
      const res = await fetchImpl(url, {
        headers: { 'user-agent': 'kojo-worker-page-probe/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) {
        erreurs.push(`carte OG ${nom} ${url} → HTTP ${res.status} (attendu 200)`);
        continue;
      }
      const type = res.headers.get('content-type') || '';
      if (!/image\/png/i.test(type)) {
        erreurs.push(`carte OG ${nom} ${url} → content-type « ${type || 'absent'} » (attendu image/png)`);
      }
      const octets = new Uint8Array(await res.arrayBuffer()).subarray(0, 8);
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (octets.length < 8 || signature.some((valeur, index) => octets[index] !== valeur)) {
        erreurs.push(`carte OG ${nom} ${url} : les octets servis ne sont pas un PNG`);
      }
    } catch (err) {
      erreurs.push(`carte OG ${nom} ${url} injoignable (${err.message})`);
    }
  }
  return erreurs;
}

/**
 * La sonde complète.
 *
 * @param {object} [options]
 * @param {string} [options.base] Origine frontend servie (défaut : production).
 * @param {string} [options.worker] Identifiant ou URL de profil (défaut : sitemap).
 * @param {boolean} [options.quiet] Tait la progression (tests).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{ok: boolean, premise: boolean, errors: string[], checked: string[],
 *   notices: string[], workerId: string, source: string}>}
 */
export async function runWorkerPageProbe({
  base = process.env.KOJO_WORKER_BASE_URL || DEFAULT_BASE,
  worker = process.env.KOJO_WORKER_ID || '',
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
    workerId: '',
    source: '',
  };

  // ── 1. La RÉÉCRITURE, jugée sans corpus (sentinelle).
  const sentinelleUrl = `${BASE}${cheminProfil(ID_SENTINELLE)}`;
  let sentinelle = { status: 0, html: '', robots: '' };
  try {
    const res = await fetchImpl(sentinelleUrl, {
      redirect: 'follow',
      headers: { 'user-agent': 'kojo-worker-page-probe/1.0' },
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

  // ── 2. La FICHE d'un profil réel, s'il y en a un à juger.
  const resolution = await resoudreProfil({ base: BASE, worker, fetchImpl });
  result.workerId = resolution.id;
  result.source = resolution.source;

  if (resolution.erreur) {
    errors.push(resolution.erreur);
  }

  if (!resolution.id && !resolution.erreur) {
    // Aucun profil publié : la RÉÉCRITURE a été jugée (preuve ci-dessus), la forme
    // d'une fiche ne PEUT PAS l'être. Ce n'est pas un vert — une prémisse, nommée.
    result.premise = true;
    const message =
      `${MARQUE_PREMISSE} : aucun profil /workers/:id au sitemap de ${BASE} — la forme du document ` +
      `d'un profil (canonical, og:url, deux cartes OG, <h1>, point d'entrée) n'a donc PAS été jugée. ` +
      `La réécriture, elle, a été mesurée sur la sentinelle ${ID_SENTINELLE}. Publier un profil, ou ` +
      `passer --worker <id|url> pour juger un profil précis.`;
    notices.push(message);
    log(`⚠️ ${message}`);
    // Une prémisse n'est JAMAIS un vert : `ok` reste faux même sans défaut, sinon
    // un appelant qui ne lit que `ok` publierait une conformité que personne n'a
    // mesurée.
    result.ok = false;
    return result;
  }

  if (resolution.id) {
    const url = `${BASE}${cheminProfil(resolution.id)}`;
    let reponse = { status: 0, contentType: '', html: '', robots: '' };
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'kojo-worker-page-probe/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      reponse = {
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        html: await texte(res),
        robots: res.headers.get('x-robots-tag') || '',
      };
    } catch (err) {
      errors.push(`le document du profil ${url} est injoignable (${err.message})`);
    }

    if (reponse.status) {
      const defauts = jugerDocumentProfil({
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
          `  ✓ ${url} (profil ${resolution.id}, via ${resolution.source}) : titre, description accordée, ` +
            `canonical et og:url, cartes wide + carrée, twitter:card, <h1>, point d'entrée, feuille, données`
        );
      }

      // Les cartes, en HTTP réel : le HTML peut annoncer des images qui n'existent pas.
      const defautsCartes = await jugerCartes({ base: BASE, id: resolution.id, fetchImpl });
      if (defautsCartes.length) errors.push(...defautsCartes.map((defaut) => `[${url}] ${defaut}`));
      else checked.push(`  ✓ cartes OG du profil servies : 1200×630 (wide) et 1200×1200 (carrée), PNG`);
    }
  }

  result.ok = errors.length === 0;
  return result;
}

/** Les options de ligne de commande (`--base`, `--worker`, `--quiet`). */
export function parseArguments(argv = process.argv.slice(2)) {
  const options = { base: '', worker: '', quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[(index += 1)] || '';
    else if (argument === '--worker') options.worker = argv[(index += 1)] || '';
    else if (argument === '--quiet') options.quiet = true;
  }
  return options;
}

export const libelleSonde = (base) =>
  `${FAMILLE} — le document SERVI de ${String(base).replace(/\/+$/, '')}/workers/:id`;

const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  const options = parseArguments();
  const resultat = await runWorkerPageProbe({
    base: options.base || undefined,
    worker: options.worker || undefined,
    quiet: options.quiet,
  });
  console.log(`\n${libelleSonde(options.base || DEFAULT_BASE)}`);
  for (const ligne of resultat.checked) console.log(ligne);

  if (resultat.errors.length) {
    console.error(`\n❌ ${resultat.errors.length} défaut(s) — ${TITRE_ERREUR} :`);
    for (const erreur of resultat.errors) console.error(`  • ${erreur}`);
    console.error(
      `\n   → le document est écrit par le BACKEND (backend/kojo_worker_og.py), servi par la ` +
        `réécriture de frontend/vercel.json, et son en-tête est jugé hors ligne par ` +
        `scripts/check-worker-og-contract.js. Corriger le côté FAUTIF : une carte ou un canonical ` +
        `divergent se répare dans le premier, une réécriture perdue dans le second.`
    );
    console.error(`::error title=${TITRE_ERREUR}::${resultat.errors.length} défaut(s) sur le document servi de /workers/:id`);
    process.exit(1);
  }

  if (resultat.premise) {
    // Une prémisse n'est PAS un vert : elle est publiée en erreur, comme les
    // autres sondes du dépôt, pour qu'un run rouge dise quoi poser.
    console.error(`::error title=${TITRE_ERREUR}::${resultat.notices.join(' ') || MARQUE_PREMISSE}`);
    process.exit(2);
  }

  console.log(
    `\n✅ Document servi de /workers/:id conforme : réécriture vers le backend mesurée sur la sentinelle, ` +
      `et profil ${resultat.workerId || '(aucun profil publié)'} jugé (canonical, og:url, deux cartes, ` +
      `twitter:*, <h1>, point d'entrée, feuille, données déjà rendues).`
  );
}
