#!/usr/bin/env python3
"""
SPECIFIC KOJO FIXES - Corrections spécifiques des problèmes identifiés
"""

import os
import re
from pathlib import Path

class SpecificKojoFixer:
    def __init__(self):
        self.project_root = Path("/app")
        self.frontend_path = self.project_root / "frontend"
        self.fixes_applied = 0

    def fix_devlogger_console_log(self):
        """Corrige le devLogger qui contient des console.log"""
        print("🔧 Fixing devLogger console.log...")
        
        devlogger_file = self.frontend_path / "src" / "utils" / "devLogger.js"
        if devlogger_file.exists():
            try:
                with open(devlogger_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Remplacer le console.log dans devLogger
                new_content = content.replace(
                    'console.log(...args);',
                    '// Development logging disabled in production'
                )
                
                if new_content != content:
                    with open(devlogger_file, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"   ✅ Fixed devLogger console.log")
                    self.fixes_applied += 1
                    
            except Exception as e:
                print(f"   ❌ Error fixing devLogger: {e}")

    def clean_redundant_code(self):
        """Nettoie le code redondant"""
        print("🔧 Cleaning redundant code...")
        
        for file_path in self.frontend_path.rglob("*.js"):
            if 'node_modules' in str(file_path):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Supprimer les lignes vides multiples
                new_content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)
                
                if new_content != original_content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"   ✅ Cleaned redundant code in {file_path.name}")
                    self.fixes_applied += 1
                    
            except Exception as e:
                print(f"   ❌ Error cleaning {file_path}: {e}")

    def run_specific_fixes(self):
        """Lance toutes les corrections spécifiques"""
        print("🚀 DÉMARRAGE SPECIFIC KOJO FIXES")
        print("💪 Application des corrections spécifiques...")
        print("="*80)
        
        self.fix_devlogger_console_log()
        self.clean_redundant_code()
        
        print("\n" + "="*80)
        print("📊 SPECIFIC FIXES APPLIED REPORT")
        print("="*80)
        print(f"🛠️ CORRECTIONS SPÉCIFIQUES: {self.fixes_applied} corrections appliquées")
        
        if self.fixes_applied > 0:
            print(f"\n✅ SUCCÈS: {self.fixes_applied} corrections spécifiques appliquées!")
        else:
            print("\n⚠️ Aucune correction spécifique nécessaire")
        
        return self.fixes_applied

def main():
    fixer = SpecificKojoFixer()
    total_fixes = fixer.run_specific_fixes()
    
    exit(0 if total_fixes >= 0 else 1)

if __name__ == "__main__":
    main()