#!/usr/bin/env node

/**
 * Script de nettoyage des logs pour Kojo
 * Remplace tous les console.log par devLog appropriés
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Patterns à remplacer
const LOG_REPLACEMENTS = [
  // console.log générique
  {
    pattern: /console\.log\(/g,
    replacement: 'devLog.info('
  },
  // console.error -> safeLog.error
  {
    pattern: /console\.error\(/g,
    replacement: 'safeLog.error('
  },
  // console.warn -> safeLog.warn
  {
    pattern: /console\.warn\(/g,
    replacement: 'safeLog.warn('
  },
  // console.info -> devLog.info
  {
    pattern: /console\.info\(/g,
    replacement: 'devLog.info('
  },
  // console.debug -> devLog.debug
  {
    pattern: /console\.debug\(/g,
    replacement: 'devLog.debug('
  }
];

// Import à ajouter en haut des fichiers modifiés
const IMPORT_TO_ADD = "import { devLog, safeLog } from '../utils/env';\n";

function cleanLogsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;
    let needsImport = false;

    // Vérifier si le fichier contient déjà l'import
    const hasExistingImport = content.includes("from '../utils/env'") || 
                              content.includes("from '../../utils/env'") ||
                              content.includes("from '../../../utils/env'");

    // Appliquer les remplacements
    LOG_REPLACEMENTS.forEach(({ pattern, replacement }) => {
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        hasChanges = true;
        if (!hasExistingImport) {
          needsImport = true;
        }
      }
    });

    // Ajouter l'import si nécessaire
    if (needsImport && hasChanges) {
      // Déterminer le bon chemin d'import
      const relativePath = path.relative(path.dirname(filePath), path.join(__dirname, '../frontend/src/utils/env.js'));
      const normalizedPath = relativePath.replace(/\\/g, '/').replace('.js', '');
      const importStatement = `import { devLog, safeLog } from '${normalizedPath}';\n`;
      
      // Insérer après les autres imports
      const lines = content.split('\n');
      let importInsertIndex = 0;
      
      // Trouver la dernière ligne d'import
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ') || lines[i].trim().startsWith("import ")) {
          importInsertIndex = i + 1;
        } else if (lines[i].trim() === '' && importInsertIndex > 0) {
          // Ligne vide après les imports
          break;
        } else if (importInsertIndex > 0 && !lines[i].trim().startsWith('import')) {
          // Fin des imports
          break;
        }
      }
      
      lines.splice(importInsertIndex, 0, importStatement);
      content = lines.join('\n');
    }

    if (hasChanges) {
      fs.writeFileSync(filePath, content, 'utf8');
      devLog.info(`✅ Nettoyé: ${filePath}`);
      return true;
    }

    return false;
  } catch (error) {
    safeLog.error(`❌ Erreur dans ${filePath}:`, error.message);
    return false;
  }
}

function main() {
  devLog.info('🧹 Démarrage du nettoyage des logs...');
  
  // Chercher tous les fichiers JS dans le frontend
  const frontendSrc = path.join(__dirname, '../frontend/src');
  const jsFiles = glob.sync('**/*.js', { cwd: frontendSrc });
  
  let cleanedCount = 0;
  
  jsFiles.forEach(file => {
    const fullPath = path.join(frontendSrc, file);
    if (cleanLogsInFile(fullPath)) {
      cleanedCount++;
    }
  });
  
  devLog.info(`\n🎉 Nettoyage terminé: ${cleanedCount} fichiers modifiés sur ${jsFiles.length} examinés`);
}

if (require.main === module) {
  main();
}

module.exports = { cleanLogsInFile };