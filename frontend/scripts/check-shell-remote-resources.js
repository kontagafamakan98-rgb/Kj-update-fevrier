#!/usr/bin/env node
/**
 * RESSOURCES TIERCES des coquilles pré-rendues.
 *
 * Une coquille est le premier écran d'un visiteur sans JavaScript : ce qu'elle
 * déclare est téléchargé (ou contacté, pour un `preconnect`) par le préchargeur,
 * avant React. Ce garde refuse qu'une coquille déclare une ressource TIERCE —
 * `<iframe>`, `<script>`, `<img>`, `<link rel=…>` de ressource, `url()` ou
 * `@import` du CSS publié — sur une origine que le site n'exploite pas.
 *
 * Pourquoi un garde STATIQUE, alors que la carte différée est déjà tenue par un
 * parcours e2e : le parcours prouve le comportement À L'APPUI dans un
 * navigateur ; il ne lit pas la coquille publiée. Un `<script src="https://…">`
 * ajouté au plugin de pré-rendu, un `@font-face` sur un CDN ou un `preconnect`
 * vers une régie ne font rougir aucun test de comportement, et ne se voient
 * qu'en regardant ce que le build publie. C'est le même partage des rôles que
 * partout dans ce dépôt : Chromium pour le fait observable, ce garde pour la
 * déclaration.
 *
 * Les origines qu'on s'autorise viennent de `scripts/site-meta.js` et ne sont
 * jamais recopiées ici : une migration de domaine doit éditer un fichier, pas
 * six (c'est la leçon qui a créé ce module).
 *
 * La règle, ses deux listes de `rel` et la lecture du CSS appartiennent au
 * module `scripts/shell-remote-resources.js` : ce garde l'exécute et prononce le
 * verdict, il ne redéclare rien.
 *
 * Échoue (exit 1) : une ressource distante déclarée (en nommant la coquille, la
 * balise et l'URL), un `rel` non classé (un `rel` inconnu est la forme qu'aurait
 * le contournement), une feuille de style liée et illisible, un build sans
 * coquille, ou un nombre de ressources lues sous le plancher — un vert sans
 * lecture est un faux vert, pas un verdict.
 *
 * Exécuté dans le job CI `frontend-build`, après le build, à côté des autres
 * gardes de coquilles.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { coquillesPubliees } from './shell-text-provenance.js';
import { API_ORIGIN, SITE_ORIGIN } from './site-meta.js';
import { divergencesDeRessources, nombreDeRessourcesLues } from './shell-remote-resources.js';

const buildDir = path.join(process.cwd(), 'build');

/**
 * Plancher de lecture : les coquilles de l'arbre réel déclarent 235 ressources
 * (223 `<link>` + 12 `<script type=module>`, mesuré le 25/09/2026). Un lecteur
 * qui se casse — une expression régulière corrigée à côté — rendrait 0 et
 * passerait pour un vert : il doit échouer, pas se taire.
 */
const PLANCHER_DE_RESSOURCES = 100;

const origines = [SITE_ORIGIN, API_ORIGIN];

const lire = (fichier) => {
  try {
    return readFileSync(fichier, 'utf8');
  } catch {
    return null;
  }
};

let coquilles = [];
try {
  coquilles = coquillesPubliees(buildDir);
} catch (err) {
  console.error('❌ Ressources des coquilles — build illisible :', err.message);
  process.exit(1);
}

if (!coquilles.length) {
  console.error('❌ Ressources des coquilles — aucune coquille dans build/ (le build a-t-il tourné ?)');
  process.exit(1);
}

const lues = coquilles.reduce((total, coquille) => {
  const html = lire(coquille);
  return total + (html ? nombreDeRessourcesLues(html) : 0);
}, 0);

if (lues < PLANCHER_DE_RESSOURCES) {
  console.error(
    `❌ Ressources des coquilles — ${lues} ressource(s) lue(s) dans ${coquilles.length} coquille(s), ` +
      `sous le plancher de ${PLANCHER_DE_RESSOURCES} : le lecteur ne lit plus ce qu'il prétend contrôler ` +
      '(un vert sans lecture est un faux vert)'
  );
  process.exit(1);
}

const divergences = divergencesDeRessources({ coquilles, origines, buildDir, lire });

if (divergences.length) {
  console.error(
    `❌ Ressources des coquilles — ${divergences.length} déclaration(s) refusée(s) dans le premier écran :`
  );
  for (const divergence of divergences) {
    const nom = path.relative(buildDir, divergence.coquille).split(path.sep).join('/');
    if (divergence.sorte === 'ressource-distante') {
      console.error(
        `  ${nom} déclare <${divergence.balise} ${divergence.attribut}> sur une origine tierce : ` +
          `${divergence.url}`
      );
      continue;
    }
    if (divergence.sorte === 'css-distante') {
      console.error(
        `  ${nom} publie du CSS qui télécharge une ressource tierce (${divergence.attribut}) : ` +
          `${divergence.url}${divergence.balise === 'style' ? '' : ` — dans ${divergence.balise}`}`
      );
      continue;
    }
    if (divergence.sorte === 'rel-non-classe') {
      console.error(
        `  ${nom} porte <link rel="${divergence.rel || '(absent)'}">, que personne n'a classé : ` +
          'déclarer ce rel dans RELS_RESSOURCE ou RELS_SANS_TELECHARGEMENT ' +
          '(scripts/shell-remote-resources.js) avant de le publier'
      );
      continue;
    }
    if (divergence.sorte === 'css-illisible') {
      console.error(
        `  ${nom} lie ${divergence.url}, que le build ne contient pas : le garde ne peut pas lire ` +
          'la feuille qu\'il prétend contrôler'
      );
      continue;
    }
    console.error(`  ${nom} est illisible : le garde ne peut pas contrôler une coquille qu'il n'ouvre pas`);
  }
  console.error(
    '  Corriger : servir la ressource depuis le build (chemin relatif, `assets/`), la monter APRÈS ' +
      'un appui (voir la façade de carte, `MapEmbed.js`), ou passer par notre propre origine ' +
      `(${SITE_ORIGIN} / ${API_ORIGIN}).`
  );
  process.exit(1);
}

console.log(
  `✅ Ressources des coquilles : ${coquilles.length} coquilles, ${lues} ressource(s) déclarée(s) ` +
    `et lue(s), toutes mêmes-origine (${SITE_ORIGIN}, ${API_ORIGIN}), aucun rel non classé, ` +
    'aucun url() ni @import tiers dans le CSS publié.'
);

