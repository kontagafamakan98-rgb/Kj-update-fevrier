#!/usr/bin/env node
/**
 * PROVENANCE du texte publié par les coquilles pré-rendues.
 *
 * Le garde des coquilles (`check-prerender-shells.js`) compare les textes que le
 * plan DÉCLARE ; celui-ci compare TOUT ce que les coquilles publient — chaque
 * fragment visible des HTML du build — aux textes que la page peut publier. Un
 * mot ajouté à la main dans une coquille, ou une phrase restée dans le plugin
 * après que la page a changé, n'était ni déclaré ni comparé : c'est le fragment
 * qui n'appartient à personne, et c'est ce que ce garde refuse, en nommant la
 * coquille, le fragment et les deux textes de la page qui en sont les plus
 * proches.
 *
 * La règle, ses trois cas légitimes (texte entier, composition de textes
 * entiers, valeur dérivée déclarée) et les surfaces lues appartiennent au module
 * `scripts/shell-text-provenance.js` : ce garde l'exécute, il ne redéclare rien.
 *
 * Il exécute aussi la seconde règle du même module : les MARQUEURS (logo, numéros
 * d'étape, emojis, ponctuation). Chacun a UN propriétaire — soit une clé du
 * dictionnaire que les deux canaux résolvent (porteur partagé), soit une
 * exemption documentée avec son motif. Un littéral du plan qui recopie la valeur
 * d'une clé, ou un marqueur publié que personne ne détient, échoue ici.
 *
 * Et la troisième : la COPIE EN DUR. Un texte affiché écrit en littéral dans un
 * module qui fabrique une coquille (`<h1>Connexion</h1>` au lieu de
 * `T('login')`) est refusé en nommant le module, la ligne et le texte — c'est la
 * porte par laquelle la classe de défaut que ce garde ferme revient, un mot à la
 * fois. Les modules sont lus dans le dossier `vite-plugins` du build contrôlé
 * (le même que celui des coquilles), pour que le refus soit rejouable sur une
 * fixture.
 *
 * Pourquoi la règle est STRICTE : accepter un fragment « contenu dans » un texte
 * plus long rendrait le contrôle décoratif — n'importe quel mot est contenu dans
 * une phrase. Mesuré sur l'arbre réel : les coquilles publient 336 fragments et
 * la règle stricte les couvre tous. Un garde qui accepterait tout ne prouverait
 * rien ; un garde qui refuserait du texte légitime serait ignoré.
 *
 * Échoue (exit 1) : un fragment publié dont aucun texte de la page ne rend
 * compte, ou un corpus vide (un vert sans lecture est un faux vert). Exécuté
 * dans le job CI `frontend-build`, après le build, à côté des autres gardes de
 * coquille.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atomesDeLaPage,
  clesDuDictionnaire,
  copieEnDurDansLesShells,
  coquillesPubliees,
  divergencesDeMarqueur,
  divergencesDeProvenance,
  fragmentsVisibles,
  marqueursPublies,
  modulesDesCoquilles,
  valeursDerivees,
  valeursMarqueur,
} from './shell-text-provenance.js';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(process.cwd(), 'build');
// Les modules qui écrivent les coquilles sont lus DANS LE DOSSIER DU BUILD
// contrôlé : celui de la CI au travail, celui d'une fixture dans les tests.
const modulesDir = path.join(process.cwd(), 'vite-plugins');

const atomes = atomesDeLaPage(frontendDir);
const derivees = valeursDerivees(frontendDir);

let coquilles = [];
try {
  coquilles = coquillesPubliees(buildDir);
} catch (err) {
  console.error('❌ Provenance du texte des coquilles — build illisible :', err.message);
  process.exit(1);
}

// Corpus vide → tout paraîtrait « sans source » (rouge absurde) ; build vide →
// vert sans lecture. Les deux sont des échecs, jamais des verdicts.
if (!coquilles.length) {
  console.error('❌ Provenance du texte des coquilles — aucune coquille dans build/ (le build a-t-il tourné ?)');
  process.exit(1);
}
if (atomes.size < 100) {
  console.error(
    `❌ Provenance du texte des coquilles — corpus suspicieusement petit (${atomes.size} textes) : ` +
      'le contrôle ne comparerait rien'
  );
  process.exit(1);
}

const fragments = coquilles.reduce(
  (total, coquille) => total + new Set(fragmentsVisibles(readFileSync(coquille, 'utf8'))).size,
  0
);

const divergences = divergencesDeProvenance({ coquilles, atomes, derivees });

if (divergences.length) {
  console.error(
    `❌ Provenance du texte des coquilles — ${divergences.length} fragment(s) publié(s) sans source côté page :`
  );
  for (const { coquille, fragment, proches } of divergences) {
    console.error(`  ${coquille} publie « ${fragment} » — aucun texte de la page ne le porte.`);
    if (proches.length) {
      console.error(`      textes de la page les plus proches : ${proches.map((t) => `« ${t} »`).join(' ; ')}`);
    }
  }
  console.error(
    '  Corriger : la coquille doit publier un texte déclaré par le plan et lu par la page (clé i18n), ' +
      'ou une valeur dérivée déclarée dans scripts/shell-text-provenance.js.'
  );
  process.exit(1);
}

// Les MARQUEURS : la même question (qui détient ce qui est publié ?), pour les
// glyphes. Un porteur partagé est une clé du dictionnaire que le plan ou un
// module nomme ; une exemption est déclarée avec son motif dans le module.
const divergencesMarqueur = divergencesDeMarqueur({ frontendDir, coquilles });

if (divergencesMarqueur.length) {
  console.error(
    `❌ Marqueurs des coquilles — ${divergencesMarqueur.length} marqueur(s) sans porteur partagé ou exemption :`
  );
  for (const divergence of divergencesMarqueur) {
    if (divergence.sorte === 'plan-recopie') {
      console.error(
        `  ${divergence.fichier}:${divergence.ligne} recopie « ${divergence.valeur} », que ` +
          `${divergence.cles.map((cle) => `\`${cle}\``).join(' et ')} détient déjà en clé — ` +
          'lire la clé (`iconKey`) ou déclarer l\'exemption avec son motif dans MARQUEURS_EN_EXEMPTION'
      );
      continue;
    }
    if (divergence.sorte === 'cle-inconnue') {
      console.error(
        `  ${divergence.fichier}:${divergence.ligne} déclare la clé de glyphe « ${divergence.cle} », ` +
          'que le dictionnaire ne connaît pas — la coquille publierait le NOM de la clé '
      );
      continue;
    }
    if (divergence.sorte === 'marqueur-sans-porteur') {
      console.error(
        `  ${divergence.coquille} publie le marqueur « ${divergence.valeur} » : aucune clé du ` +
          'dictionnaire ne le détient, aucune config de page ne le porte, et il n\'est pas ' +
          'déclaré en exemption dans scripts/shell-text-provenance.js'
      );
      continue;
    }
    console.error(
      `  exemption PÉRIMÉE pour « ${divergence.valeur} » : plus rien ne la justifie ` +
        `(motif déclaré : ${divergence.motif}) — la retirer de MARQUEURS_EN_EXEMPTION`
    );
  }
  process.exit(1);
}

// La COPIE EN DUR : un texte affiché écrit dans un module qui fabrique une
// coquille. Là encore, pas de vert sans lecture : aucun module lu → échec.
const modules = modulesDesCoquilles(modulesDir);
if (!modules.length) {
  console.error(
    `❌ Copie en dur des coquilles — aucun module dans ${path.relative(process.cwd(), modulesDir) || 'vite-plugins'}/ ` +
      '(le dossier qui écrit les coquilles est introuvable : ce contrôle ne comparerait rien)'
  );
  process.exit(1);
}

const copiesEnDur = copieEnDurDansLesShells({
  modulesDir,
  coquilles,
  cles: clesDuDictionnaire(frontendDir),
});

if (copiesEnDur.length) {
  console.error(
    `❌ Copie en dur dans les coquilles — ${copiesEnDur.length} texte(s) affiché(s) écrit(s) en littéral par un module :`
  );
  for (const { module, ligne, texte } of copiesEnDur) {
    console.error(
      `  vite-plugins/${module}:${ligne} écrit « ${texte} » en littéral, et une coquille le publie — ` +
        'la coquille doit résoudre ce texte par sa clé (le plan la nomme, `T(...)` la lit) : ' +
        'un littéral recopié ne bougera pas quand la page changera de mot'
    );
  }
  process.exit(1);
}

const marqueurs = marqueursPublies(coquilles, valeursMarqueur(frontendDir)).length;

console.log(
  `✅ Provenance du texte des coquilles intacte : ${fragments} fragments publiés par ` +
    `${coquilles.length} coquilles, tous adossés à un texte de la page ` +
    `(${atomes.size} textes de page, ${derivees.size} valeurs dérivées déclarées) ; ` +
    `${marqueurs} marqueurs publiés, chacun à porteur partagé ou en exemption déclarée ; ` +
    `${modules.length} module(s) de pré-rendu sans copie en dur.`
);
