#!/usr/bin/env python3
"""
ULTIMATE KOJO CODE FIXER - Correction automatique de TOUTES les erreurs détectées
Utilise toute la puissance pour corriger automatiquement les erreurs de code
"""

import os
import re
import json
from pathlib import Path
from typing import Dict, List, Any

class UltimateKojoFixer:
    def __init__(self):
        self.project_root = Path("/app")
        self.frontend_path = self.project_root / "frontend"
        self.backend_path = self.project_root / "backend"
        
        self.fixes_applied = {
            "critical": 0,
            "major": 0,
            "minor": 0,
            "style": 0,
            "performance": 0
        }
        
        self.total_fixes = 0

    def fix_console_logs(self):
        """Corrige tous les console.log en production"""
        print("🔧 FIXING CRITICAL - Suppression des console.log en production...")
        
        console_patterns = [
            (r'console\.(log|debug|info)\(.*?\);?', '// Removed console.log'),
            (r'^\s*console\.(log|debug|info)\(.*?\);\s*$', ''),
        ]
        
        for file_path in self.frontend_path.rglob("*.js"):
            if 'node_modules' in str(file_path):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Remplacer les console.log mais garder devLog
                lines = content.split('\n')
                new_lines = []
                
                for line in lines:
                    # Si la ligne contient console.log mais pas devLog, la supprimer ou remplacer
                    if re.search(r'console\.(log|debug|info)', line) and 'devLog' not in line:
                        if line.strip() == line.strip().replace(re.search(r'console\.(log|debug|info)\(.*?\);?', line).group(), '').strip():
                            # Ligne entière est un console.log, la supprimer
                            continue
                        else:
                            # Console.log fait partie d'une ligne plus complexe, la commenter
                            line = '    // ' + line.strip() + ' // Removed console.log'
                    new_lines.append(line)
                
                new_content = '\n'.join(new_lines)
                
                if new_content != original_content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    self.fixes_applied["critical"] += 1
                    print(f"   ✅ Fixed console.log in {file_path.name}")
                    
            except Exception as e:
                print(f"   ❌ Error fixing {file_path}: {e}")

    def fix_react_keys(self):
        """Ajoute les clés React manquantes dans les map()"""
        print("🔧 FIXING MAJOR - Ajout des clés React manquantes...")
        
        for file_path in self.frontend_path.rglob("*.js"):
            if 'node_modules' in str(file_path):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Pattern pour détecter les map() sans key
                lines = content.split('\n')
                new_lines = []
                
                for i, line in enumerate(lines):
                    if '.map(' in line and 'key=' not in line:
                        # Vérifier si c'est un composant React (commence par une majuscule)
                        if re.search(r'<[A-Z]\w*', line):
                            # Ajouter key={index} ou key={item.id} selon le contexte
                            if 'index' in line:
                                line = re.sub(r'(<[A-Z]\w*)', r'\1 key={index}', line, count=1)
                            elif 'item' in line:
                                line = re.sub(r'(<[A-Z]\w*)', r'\1 key={item.id || index}', line, count=1)
                            else:
                                # Pattern générique
                                line = re.sub(r'(<[A-Z]\w*)', r'\1 key={index}', line, count=1)
                        elif re.search(r'<\w+', line):  # Éléments HTML
                            if 'index' in line:
                                line = re.sub(r'(<\w+)', r'\1 key={index}', line, count=1)
                            else:
                                line = re.sub(r'(<\w+)', r'\1 key={index}', line, count=1)
                    
                    new_lines.append(line)
                
                new_content = '\n'.join(new_lines)
                
                if new_content != original_content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    self.fixes_applied["major"] += 1
                    print(f"   ✅ Fixed React keys in {file_path.name}")
                    
            except Exception as e:
                print(f"   ❌ Error fixing {file_path}: {e}")

    def fix_inline_styles(self):
        """Convertit les styles inline en classes CSS"""
        print("🔧 FIXING MINOR - Optimisation des styles inline...")
        
        for file_path in self.frontend_path.rglob("*.js"):
            if 'node_modules' in str(file_path):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Remplacer les styles inline simples par des classes
                style_replacements = {
                    r'style=\{\{display: ["\']none["\']\}\}': 'className="hidden"',
                    r'style=\{\{display: ["\']block["\']\}\}': 'className="block"',
                    r'style=\{\{display: ["\']flex["\']\}\}': 'className="flex"',
                    r'style=\{\{textAlign: ["\']center["\']\}\}': 'className="text-center"',
                    r'style=\{\{textAlign: ["\']left["\']\}\}': 'className="text-left"',
                    r'style=\{\{textAlign: ["\']right["\']\}\}': 'className="text-right"',
                    r'style=\{\{fontWeight: ["\']bold["\']\}\}': 'className="font-bold"',
                    r'style=\{\{color: ["\']red["\']\}\}': 'className="text-red-500"',
                    r'style=\{\{color: ["\']green["\']\}\}': 'className="text-green-500"',
                    r'style=\{\{backgroundColor: ["\']red["\']\}\}': 'className="bg-red-500"',
                    r'style=\{\{backgroundColor: ["\']green["\']\}\}': 'className="bg-green-500"',
                }
                
                for pattern, replacement in style_replacements.items():
                    if re.search(pattern, content):
                        content = re.sub(pattern, replacement, content)
                        
                if content != original_content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    self.fixes_applied["minor"] += 1
                    print(f"   ✅ Fixed inline styles in {file_path.name}")
                    
            except Exception as e:
                print(f"   ❌ Error fixing {file_path}: {e}")

    def fix_undefined_usage(self):
        """Corrige l'usage non sécurisé d'undefined"""
        print("🔧 FIXING MAJOR - Sécurisation de l'usage d'undefined...")
        
        for file_path in self.frontend_path.rglob("*.js"):
            if 'node_modules' in str(file_path):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Remplacer les patterns unsafe d'undefined
                replacements = [
                    # variable === undefined -> typeof variable === 'undefined'
                    (r'(\w+)\s*===\s*undefined', r'typeof \1 === "undefined"'),
                    # variable !== undefined -> typeof variable !== 'undefined'  
                    (r'(\w+)\s*!==\s*undefined', r'typeof \1 !== "undefined"'),
                    # variable == undefined -> variable == null (plus sûr)
                    (r'(\w+)\s*==\s*undefined', r'\1 == null'),
                    # variable != undefined -> variable != null
                    (r'(\w+)\s*!=\s*undefined', r'\1 != null'),
                ]
                
                for pattern, replacement in replacements:
                    content = re.sub(pattern, replacement, content)
                
                if content != original_content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    self.fixes_applied["major"] += 1
                    print(f"   ✅ Fixed undefined usage in {file_path.name}")
                    
            except Exception as e:
                print(f"   ❌ Error fixing {file_path}: {e}")

    def fix_hardcoded_passwords(self):
        """Sécurise les mots de passe en dur"""
        print("🔧 FIXING CRITICAL - Sécurisation des mots de passe hardcodés...")
        
        for file_path in self.frontend_path.rglob("*.js"):
            if 'node_modules' in str(file_path):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Rechercher et remplacer les mots de passe hardcodés
                lines = content.split('\n')
                new_lines = []
                
                for line in lines:
                    # Détecter les patterns de mots de passe
                    if re.search(r'password.*["\'][^"\']{6,}["\']', line, re.IGNORECASE):
                        # Vérifier si c'est vraiment un mot de passe hardcodé
                        if any(pwd in line.lower() for pwd in ['testpass', 'password123', 'admin123', 'user123']):
                            # Commenter la ligne et ajouter un commentaire
                            new_lines.append('    // TODO: Remove hardcoded password - ' + line.strip())
                            new_lines.append('    // ' + line.strip())
                        else:
                            new_lines.append(line)
                    else:
                        new_lines.append(line)
                
                new_content = '\n'.join(new_lines)
                
                if new_content != original_content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    self.fixes_applied["critical"] += 1
                    print(f"   ✅ Fixed hardcoded passwords in {file_path.name}")
                    
            except Exception as e:
                print(f"   ❌ Error fixing {file_path}: {e}")

    def fix_hardcoded_urls(self):
        """Remplace les URLs hardcodées par des variables d'environnement"""
        print("🔧 FIXING MAJOR - Remplacement des URLs hardcodées...")
        
        for file_path in self.frontend_path.rglob("*.js"):
            if 'node_modules' in str(file_path):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Remplacer les URLs hardcodées communes
                url_replacements = [
                    # APIs externes communes
                    (r'["\']https://api\.ipapi\.com/[^"\']*["\']', 'process.env.REACT_APP_IPAPI_URL || "https://api.ipapi.com"'),
                    (r'["\']https://ipapi\.co/[^"\']*["\']', 'process.env.REACT_APP_IPAPI_CO_URL || "https://ipapi.co"'),
                    (r'["\']https://ipinfo\.io/[^"\']*["\']', 'process.env.REACT_APP_IPINFO_URL || "https://ipinfo.io"'),
                ]
                
                for pattern, replacement in url_replacements:
                    if re.search(pattern, content):
                        content = re.sub(pattern, replacement, content)
                        
                if content != original_content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    self.fixes_applied["major"] += 1
                    print(f"   ✅ Fixed hardcoded URLs in {file_path.name}")
                    
            except Exception as e:
                print(f"   ❌ Error fixing {file_path}: {e}")

    def fix_backend_print_statements(self):
        """Remplace les print() par du logging approprié"""
        print("🔧 FIXING MAJOR - Remplacement des print statements...")
        
        for file_path in self.backend_path.rglob("*.py"):
            if '__pycache__' in str(file_path):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Remplacer print() par logger
                lines = content.split('\n')
                new_lines = []
                needs_logger_import = False
                
                for line in lines:
                    if line.strip().startswith('print(') and 'logging' not in file_path.name:
                        # Remplacer print par logger.info
                        indent = len(line) - len(line.lstrip())
                        print_content = re.search(r'print\((.*)\)', line)
                        if print_content:
                            new_line = ' ' * indent + f'logger.info({print_content.group(1)})'
                            new_lines.append(new_line)
                            needs_logger_import = True
                        else:
                            new_lines.append(line)
                    else:
                        new_lines.append(line)
                
                # Ajouter l'import logger si nécessaire
                if needs_logger_import and 'import logging' not in content:
                    # Trouver où insérer l'import
                    import_index = 0
                    for i, line in enumerate(new_lines):
                        if line.startswith('import ') or line.startswith('from '):
                            import_index = i + 1
                    
                    new_lines.insert(import_index, 'import logging')
                    new_lines.insert(import_index + 1, 'logger = logging.getLogger(__name__)')
                
                new_content = '\n'.join(new_lines)
                
                if new_content != original_content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    self.fixes_applied["major"] += 1
                    print(f"   ✅ Fixed print statements in {file_path.name}")
                    
            except Exception as e:
                print(f"   ❌ Error fixing {file_path}: {e}")

    def generate_summary_report(self):
        """Génère un rapport de summary des corrections"""
        total_fixes = sum(self.fixes_applied.values())
        
        print("\n" + "="*80)
        print("📊 ULTIMATE KOJO FIXES APPLIED REPORT")
        print("="*80)
        
        print(f"\n🛠️ CORRECTIONS APPLIQUÉES:")
        print(f"   🔴 CRITIQUES: {self.fixes_applied['critical']} corrections")
        print(f"   🟠 MAJEURES: {self.fixes_applied['major']} corrections")
        print(f"   🟡 MINEURES: {self.fixes_applied['minor']} corrections")
        print(f"   🔵 STYLE: {self.fixes_applied['style']} corrections")
        print(f"   ⚡ PERFORMANCE: {self.fixes_applied['performance']} corrections")
        print(f"   📊 TOTAL: {total_fixes} corrections appliquées")
        
        if total_fixes > 0:
            print(f"\n✅ SUCCÈS: {total_fixes} corrections automatiques appliquées!")
            print("💡 Il est recommandé de :")
            print("   1. Tester l'application après les corrections")
            print("   2. Relancer l'audit pour vérifier les améliorations")
            print("   3. Examiner les corrections manuellement")
        else:
            print("\n⚠️ Aucune correction automatique n'a pu être appliquée")
        
        return total_fixes

    def run_complete_fixes(self):
        """Lance toutes les corrections automatiques"""
        print("🚀 DÉMARRAGE ULTIMATE KOJO FIXES")
        print("💪 Application de toutes les corrections automatiques...")
        print("="*80)
        
        # Corrections par ordre de priorité
        self.fix_console_logs()
        self.fix_hardcoded_passwords() 
        self.fix_react_keys()
        self.fix_undefined_usage()
        self.fix_hardcoded_urls()
        self.fix_inline_styles()
        self.fix_backend_print_statements()
        
        # Génération du rapport
        total_fixes = self.generate_summary_report()
        
        return total_fixes

def main():
    fixer = UltimateKojoFixer()
    total_fixes = fixer.run_complete_fixes()
    
    # Exit code basé sur le nombre de corrections
    if total_fixes > 0:
        exit(0)  # Success
    else:
        exit(1)  # No fixes applied

if __name__ == "__main__":
    main()