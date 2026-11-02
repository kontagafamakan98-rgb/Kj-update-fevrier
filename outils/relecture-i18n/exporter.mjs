// Extraction des dictionnaires de page (wo, bm, mos) pour l'équipe de relecture.
//
// Pourquoi instrumenter au lieu de lire le texte : les modules n'exportent que
// `makeScopedTranslator`, le dictionnaire est une constante PRIVÉE. Une regex
// sur le source attraperait les valeurs mais se tromperait au premier
// apostrophe typographique échappée, au premier commentaire contenant `:`, et
// ne verrait aucune interpolation. On évalue donc le VRAI module.
//
// Comment, et pourquoi pas `import()` : les dictionnaires importent
// `./core.js`, un chemin relatif qui n'a pas de base depuis une URL `data:`.
// La première version réécrivait cet import en URL absolue et importait un
// module `data:` — MESURÉ le 02/11/2026 : **100 s** pour 14 fichiers, environ
// 7 s par import `data:` sur ce poste, ce qui faisait expirer la commande
// appelante. On retire donc la ligne d'import (elle ne sert qu'à fabriquer le
// traducteur, pas à construire le dictionnaire), on retire les `export` et on
// évalue le corps avec `new Function` : même donnée, **< 1 s**, aucun fichier
// temporaire écrit, et une erreur qui nomme le fichier fautif.
//
// Sortie : un JSON sur stdout. Les INDICES (mot français resté, placeholder
// perdu, chiffres divergents) ne sont pas calculés ici : ils vivent côté
// Python, avec le modèle de relecture, et ne sont jamais des verdicts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..');
const DICTIONNAIRES = path.join(RACINE, 'frontend', 'src', 'utils', 'pack2PageI18n');
const LANGUES = ['wo', 'bm', 'mos'];
const SOURCE = 'fr';

/** Le dictionnaire d'un module, sans écrire sur le disque ni rien importer. */
function dictionnaireDe(fichier) {
  const source = fs.readFileSync(fichier, 'utf8');

  const sansImport = source.replace(
    /^import\s*\{[^}]*\}\s*from\s*['"]\.\/core\.js['"];?/m,
    'const createScopedTranslator = (dict) => dict;'
  );
  if (sansImport === source) {
    throw new Error(
      `${path.basename(fichier)} : import de './core.js' introuvable, ` +
        `l'instrumentation ne peut pas viser le dictionnaire`
    );
  }

  const corps = `${sansImport.replace(/^export\s+/gm, '')}\nreturn dict;\n`;
  try {
    const dict = new Function(corps)();
    if (!dict || typeof dict !== 'object') {
      throw new Error('aucun dictionnaire rendu');
    }
    return dict;
  } catch (erreur) {
    throw new Error(`${path.basename(fichier)} : ${erreur.message}`);
  }
}

const fichiers = fs
  .readdirSync(DICTIONNAIRES)
  .filter((nom) => nom.endsWith('.js') && nom !== 'core.js')
  .sort();

const valeurs = [];
const parFichier = {};
let cles = 0;

for (const nom of fichiers) {
  const dict = dictionnaireDe(path.join(DICTIONNAIRES, nom));
  const scope = path.basename(nom, '.js');
  const clesFr = Object.keys(dict[SOURCE] || {});
  cles += clesFr.length;
  parFichier[scope] = { cles: clesFr.length };

  for (const cle of clesFr) {
    const fr = dict[SOURCE][cle];
    const en = dict.en && dict.en[cle] !== undefined ? dict.en[cle] : null;
    for (const langue of LANGUES) {
      const valeur = dict[langue] ? dict[langue][cle] : undefined;
      // Une valeur absente n'est pas notre sujet : `i18nLangue.test.js` la
      // refuse déjà, et l'équipe ne doit pas réécrire une absence en devinant.
      if (typeof valeur !== 'string' || !valeur.trim()) continue;
      if (typeof fr !== 'string') continue;
      valeurs.push({
        fichier: scope,
        cle,
        langue,
        fr,
        en: typeof en === 'string' ? en : null,
        valeur,
      });
    }
  }
}

const compte = {
  fichiers: fichiers.length,
  cles,
  valeurs: valeurs.length,
  par_langue: Object.fromEntries(
    LANGUES.map((langue) => [langue, valeurs.filter((v) => v.langue === langue).length])
  ),
};

process.stdout.write(
  JSON.stringify(
    {
      genere_le: new Date().toISOString(),
      // Le chemin relatif du dépôt, jamais le chemin de la machine : ce JSON
      // peut être joint à une revue.
      source: 'frontend/src/utils/pack2PageI18n',
      langues: LANGUES,
      langue_source: SOURCE,
      compte,
      par_fichier: parFichier,
      valeurs,
    },
    null,
    2
  )
);
