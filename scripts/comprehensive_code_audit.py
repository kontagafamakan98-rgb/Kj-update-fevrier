#!/usr/bin/env python3

"""
AUDIT COMPLET ET AMÉLIORATION GÉNÉRALE DU CODE KOJO
Script ultra-avancé pour identifier et corriger toutes les erreurs
"""

import os
import re
import json
import subprocess
import glob
from pathlib import Path
import ast
import sys

class ComprehensiveCodeAuditor:
    def __init__(self):
        self.issues = []
        self.fixes_applied = []
        self.warnings = []
        self.root_path = Path("/app")
        self.stats = {
            'files_scanned': 0,
            'errors_found': 0,
            'errors_fixed': 0,
            'warnings_found': 0,
            'performance_issues': 0,
            'code_quality_issues': 0
        }
    
    def log_issue(self, level, category, file_path, line_number, message, fix_applied=None):
        """Enregistrer un problème détecté"""
        issue = {
            'level': level,  # 'error', 'warning', 'info', 'performance', 'quality'
            'category': category,
            'file': str(file_path),
            'line': line_number,
            'message': message,
            'fix_applied': fix_applied
        }
        
        if level == 'error':
            self.issues.append(issue)
            self.stats['errors_found'] += 1
        elif level == 'warning':
            self.warnings.append(issue)
            self.stats['warnings_found'] += 1
        elif level == 'performance':
            self.stats['performance_issues'] += 1
        elif level == 'quality':
            self.stats['code_quality_issues'] += 1
        
        print(f"[{level.upper()}] {category} - {file_path}:{line_number} - {message}")
        if fix_applied:
            print(f"  → FIX: {fix_applied}")
            self.fixes_applied.append(fix_applied)
            if level == 'error':
                self.stats['errors_fixed'] += 1

    def audit_python_files(self):
        """Audit complet des fichiers Python"""
        print("\n🐍 AUDIT FICHIERS PYTHON...")
        
        python_files = list(self.root_path.rglob("*.py"))
        
        for py_file in python_files:
            if "node_modules" in str(py_file) or ".git" in str(py_file):
                continue
                
            self.stats['files_scanned'] += 1
            print(f"  📄 Analyse: {py_file}")
            
            try:
                with open(py_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Vérification syntaxe Python
                try:
                    ast.parse(content)
                except SyntaxError as e:
                    self.log_issue('error', 'Python Syntax', py_file, e.lineno, 
                                 f"Erreur syntaxe: {e.msg}")
                
                # Détection imports dupliqués
                imports = re.findall(r'^(from .+ import .+|import .+)$', content, re.MULTILINE)
                import_counts = {}
                for i, imp in enumerate(imports, 1):
                    if imp in import_counts:
                        self.log_issue('warning', 'Code Quality', py_file, i,
                                     f"Import dupliqué: {imp}")
                    import_counts[imp] = import_counts.get(imp, 0) + 1
                
                # Détection print() statements dans le code
                print_matches = re.finditer(r'\bprint\s*\(', content)
                for match in print_matches:
                    line_num = content[:match.start()].count('\n') + 1
                    self.log_issue('quality', 'Logging', py_file, line_num,
                                 "Utilise print() au lieu de logging")
                
                # Détection hardcoded URLs/IPs
                url_matches = re.finditer(r'https?://[^\s\'"]+', content)
                for match in url_matches:
                    line_num = content[:match.start()].count('\n') + 1
                    url = match.group()
                    if not any(allowed in url for allowed in ['localhost', '127.0.0.1', 'example.com']):
                        self.log_issue('warning', 'Configuration', py_file, line_num,
                                     f"URL hardcodée: {url}")
                
                # Détection TODO/FIXME/HACK
                todo_matches = re.finditer(r'#.*(TODO|FIXME|HACK|XXX)', content, re.IGNORECASE)
                for match in todo_matches:
                    line_num = content[:match.start()].count('\n') + 1
                    self.log_issue('info', 'Development', py_file, line_num,
                                 f"Commentaire de développement: {match.group()}")
                
                # Détection fonctions trop longues
                functions = re.finditer(r'^def\s+(\w+)', content, re.MULTILINE)
                for func_match in functions:
                    func_name = func_match.group(1)
                    func_start = content[:func_match.start()].count('\n') + 1
                    
                    # Compter les lignes de la fonction (approximatif)
                    func_content = content[func_match.start():]
                    next_def = re.search(r'\n^(def|class)', func_content, re.MULTILINE)
                    if next_def:
                        func_lines = func_content[:next_def.start()].count('\n')
                    else:
                        func_lines = func_content.count('\n')
                    
                    if func_lines > 50:
                        self.log_issue('quality', 'Code Structure', py_file, func_start,
                                     f"Fonction '{func_name}' trop longue ({func_lines} lignes)")
                
            except Exception as e:
                self.log_issue('error', 'File Reading', py_file, 0, f"Erreur lecture fichier: {e}")

    def audit_javascript_files(self):
        """Audit complet des fichiers JavaScript/JSX"""
        print("\n📜 AUDIT FICHIERS JAVASCRIPT/JSX...")
        
        js_patterns = ["*.js", "*.jsx", "*.ts", "*.tsx"]
        js_files = []
        
        for pattern in js_patterns:
            js_files.extend(self.root_path.rglob(pattern))
        
        for js_file in js_files:
            if "node_modules" in str(js_file) or ".git" in str(js_file):
                continue
                
            self.stats['files_scanned'] += 1
            print(f"  📄 Analyse: {js_file}")
            
            try:
                with open(js_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Détection console.log inappropriés
                console_matches = re.finditer(r'\bconsole\.(log|error|warn|info|debug)\s*\(', content)
                for match in console_matches:
                    line_num = content[:match.start()].count('\n') + 1
                    self.log_issue('quality', 'Logging', js_file, line_num,
                                 f"Console.{match.group(1)}() trouvé - utiliser logging approprié")
                
                # Détection imports dupliqués
                import_matches = re.findall(r'^import .+$', content, re.MULTILINE)
                import_counts = {}
                for i, imp in enumerate(import_matches, 1):
                    if imp in import_counts:
                        self.log_issue('warning', 'Code Quality', js_file, i,
                                     f"Import dupliqué: {imp}")
                    import_counts[imp] = import_counts.get(imp, 0) + 1
                
                # Détection var au lieu de let/const
                var_matches = re.finditer(r'\bvar\s+\w+', content)
                for match in var_matches:
                    line_num = content[:match.start()].count('\n') + 1
                    self.log_issue('quality', 'Modern JS', js_file, line_num,
                                 "Utilise 'var' au lieu de 'let'/'const'")
                
                # Détection hardcoded URLs
                url_matches = re.finditer(r'["\']https?://[^"\']+["\']', content)
                for match in url_matches:
                    line_num = content[:match.start()].count('\n') + 1
                    url = match.group()
                    if not any(allowed in url for allowed in ['localhost', '127.0.0.1', 'example.com']):
                        self.log_issue('warning', 'Configuration', js_file, line_num,
                                     f"URL hardcodée: {url}")
                
                # Détection fonctions fléchées trop complexes
                arrow_functions = re.finditer(r'=>\s*{[^}]{100,}', content)
                for match in arrow_functions:
                    line_num = content[:match.start()].count('\n') + 1
                    self.log_issue('quality', 'Code Structure', js_file, line_num,
                                 "Fonction fléchée complexe - considérer refactoring")
                
                # Détection useEffect sans dépendances
                useeffect_matches = re.finditer(r'useEffect\s*\([^,]+,\s*\[\s*\]\s*\)', content)
                for match in useeffect_matches:
                    line_num = content[:match.start()].count('\n') + 1
                    self.log_issue('performance', 'React Hooks', js_file, line_num,
                                 "useEffect avec tableau de dépendances vide - vérifier si nécessaire")
                
                # Détection inline styles au lieu de CSS classes
                inline_style_matches = re.finditer(r'style\s*=\s*\{\{[^}]+\}\}', content)
                for match in inline_style_matches:
                    line_num = content[:match.start()].count('\n') + 1
                    self.log_issue('performance', 'Styling', js_file, line_num,
                                 "Style inline - considérer CSS classes pour performance")
                
            except Exception as e:
                self.log_issue('error', 'File Reading', js_file, 0, f"Erreur lecture fichier: {e}")

    def audit_json_files(self):
        """Audit des fichiers JSON"""
        print("\n🔧 AUDIT FICHIERS JSON...")
        
        json_files = list(self.root_path.rglob("*.json"))
        
        for json_file in json_files:
            if "node_modules" in str(json_file) or ".git" in str(json_file):
                continue
                
            self.stats['files_scanned'] += 1
            print(f"  📄 Analyse: {json_file}")
            
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                try:
                    json_data = json.loads(content)
                    
                    # Vérifications spécifiques pour package.json
                    if json_file.name == "package.json":
                        if "dependencies" in json_data:
                            deps = json_data["dependencies"]
                            
                            # Vérifier versions outdated
                            outdated_packages = {
                                "react": "^17",
                                "axios": "^0.2",  # Très ancien
                                "lodash": "^4.17.20"  # Versions avec vulnérabilités
                            }
                            
                            for pkg, old_version in outdated_packages.items():
                                if pkg in deps and deps[pkg].startswith(old_version):
                                    self.log_issue('warning', 'Dependencies', json_file, 0,
                                                 f"Package {pkg} potentiellement obsolète: {deps[pkg]}")
                    
                    # Vérifications générales JSON
                    json_str = json.dumps(json_data, indent=2)
                    if len(json_str) != len(content.strip()):
                        self.log_issue('quality', 'Formatting', json_file, 0,
                                     "Formatage JSON non standard")
                
                except json.JSONDecodeError as e:
                    self.log_issue('error', 'JSON Syntax', json_file, e.lineno,
                                 f"JSON invalide: {e.msg}")
                
            except Exception as e:
                self.log_issue('error', 'File Reading', json_file, 0, f"Erreur lecture fichier: {e}")

    def audit_env_files(self):
        """Audit des fichiers d'environnement"""
        print("\n🌍 AUDIT FICHIERS ENVIRONNEMENT...")
        
        env_files = list(self.root_path.rglob(".env*"))
        
        for env_file in env_files:
            self.stats['files_scanned'] += 1
            print(f"  📄 Analyse: {env_file}")
            
            try:
                with open(env_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Vérifier les variables critiques
                critical_vars = {
                    'frontend/.env': ['REACT_APP_BACKEND_URL'],
                    'backend/.env': ['MONGO_URL']
                }
                
                relative_path = str(env_file.relative_to(self.root_path))
                if relative_path in critical_vars:
                    for var in critical_vars[relative_path]:
                        if var not in content:
                            self.log_issue('warning', 'Configuration', env_file, 0,
                                         f"Variable critique manquante: {var}")
                
                # Détecter valeurs hardcodées sensibles
                sensitive_patterns = [
                    (r'password\s*=\s*["\']?[\w]+', "Mot de passe potentiel en clair"),
                    (r'secret\s*=\s*["\']?[\w]+', "Secret potentiel en clair"),
                    (r'api_key\s*=\s*["\']?[\w]+', "Clé API potentielle en clair")
                ]
                
                for pattern, message in sensitive_patterns:
                    matches = re.finditer(pattern, content, re.IGNORECASE)
                    for match in matches:
                        line_num = content[:match.start()].count('\n') + 1
                        self.log_issue('warning', 'Security', env_file, line_num, message)
                
            except Exception as e:
                self.log_issue('error', 'File Reading', env_file, 0, f"Erreur lecture fichier: {e}")

    def audit_dependencies(self):
        """Audit des dépendances et versions"""
        print("\n📦 AUDIT DÉPENDANCES...")
        
        # Audit requirements.txt
        req_file = self.root_path / "backend/requirements.txt"
        if req_file.exists():
            with open(req_file, 'r') as f:
                requirements = f.read()
            
            # Détecter versions non spécifiées
            unversioned = re.findall(r'^([a-zA-Z0-9\-_]+)(?!=|<|>|~)', requirements, re.MULTILINE)
            for pkg in unversioned:
                self.log_issue('warning', 'Dependencies', req_file, 0,
                             f"Version non spécifiée pour {pkg}")
        
        # Audit package.json
        pkg_file = self.root_path / "frontend/package.json"
        if pkg_file.exists():
            with open(pkg_file, 'r') as f:
                pkg_data = json.load(f)
            
            # Vérifier dépendances critiques manquantes
            critical_deps = {
                "react": "Frontend framework",
                "react-dom": "React DOM rendering",
                "axios": "HTTP client"
            }
            
            deps = pkg_data.get('dependencies', {})
            for dep, description in critical_deps.items():
                if dep not in deps:
                    self.log_issue('warning', 'Dependencies', pkg_file, 0,
                                 f"Dépendance critique manquante: {dep} ({description})")

    def check_file_permissions(self):
        """Vérifier les permissions des fichiers"""
        print("\n🔒 AUDIT PERMISSIONS FICHIERS...")
        
        # Vérifier que les scripts sont exécutables
        script_files = list(self.root_path.rglob("*.sh")) + list(self.root_path.rglob("scripts/*.py"))
        
        for script in script_files:
            if script.exists():
                stat = script.stat()
                if not (stat.st_mode & 0o111):  # Pas de permission d'exécution
                    self.log_issue('warning', 'Permissions', script, 0,
                                 "Script sans permission d'exécution")

    def analyze_performance_issues(self):
        """Analyser les problèmes de performance potentiels"""
        print("\n⚡ ANALYSE PERFORMANCE...")
        
        # Chercher les patterns de performance problématiques
        js_files = list(self.root_path.rglob("*.js")) + list(self.root_path.rglob("*.jsx"))
        
        for js_file in js_files:
            if "node_modules" in str(js_file):
                continue
                
            try:
                with open(js_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Détection de re-renders inutiles
                render_issues = [
                    (r'\.map\([^)]+\)\s*\.map\(', "Double .map() - optimiser en single pass"),
                    (r'useState\([^)]*\{\}[^)]*\)', "useState avec objet vide - causes re-renders"),
                    (r'new Date\(\)', "new Date() dans render - utiliser useMemo"),
                    (r'Math\.random\(\)', "Math.random() dans render - déplacer en useEffect")
                ]
                
                for pattern, message in render_issues:
                    matches = re.finditer(pattern, content)
                    for match in matches:
                        line_num = content[:match.start()].count('\n') + 1
                        self.log_issue('performance', 'React Performance', js_file, line_num, message)
                
            except Exception as e:
                continue

    def generate_fixes(self):
        """Générer et appliquer des corrections automatiques"""
        print("\n🔧 APPLICATION DES CORRECTIONS AUTOMATIQUES...")
        
        # Fix 1: Remplacer console.log par devLog dans certains cas
        js_files = list(self.root_path.rglob("*.js")) + list(self.root_path.rglob("*.jsx"))
        
        for js_file in js_files:
            if "node_modules" in str(js_file) or "preciseGeolocationService" in str(js_file):
                continue
                
            try:
                with open(js_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Remplacer console.log par devLog si devLog est importé
                if "devLog" in content:
                    content = re.sub(r'\bconsole\.log\(', 'devLog.info(', content)
                    content = re.sub(r'\bconsole\.error\(', 'safeLog.error(', content)
                    content = re.sub(r'\bconsole\.warn\(', 'safeLog.warn(', content)
                
                if content != original_content:
                    with open(js_file, 'w', encoding='utf-8') as f:
                        f.write(content)
                    self.log_issue('info', 'Auto-fix', js_file, 0, 
                                 "Console.log remplacé par devLog/safeLog", "APPLIQUÉ")
                
            except Exception as e:
                continue

    def run_comprehensive_audit(self):
        """Exécuter l'audit complet"""
        print("🚀 DÉMARRAGE AUDIT COMPLET ET AMÉLIORATION GÉNÉRALE")
        print("=" * 80)
        
        self.audit_python_files()
        self.audit_javascript_files()
        self.audit_json_files()
        self.audit_env_files()
        self.audit_dependencies()
        self.check_file_permissions()
        self.analyze_performance_issues()
        self.generate_fixes()
        
        return self.generate_report()

    def generate_report(self):
        """Générer le rapport final"""
        print("\n" + "=" * 80)
        print("📊 RAPPORT COMPLET D'AUDIT ET AMÉLIORATION")
        print("=" * 80)
        
        print(f"\n📈 STATISTIQUES GLOBALES:")
        print(f"  • Fichiers scannés: {self.stats['files_scanned']}")
        print(f"  • Erreurs trouvées: {self.stats['errors_found']}")
        print(f"  • Erreurs corrigées: {self.stats['errors_fixed']}")
        print(f"  • Avertissements: {self.stats['warnings_found']}")
        print(f"  • Problèmes performance: {self.stats['performance_issues']}")
        print(f"  • Problèmes qualité code: {self.stats['code_quality_issues']}")
        
        print(f"\n✅ CORRECTIONS APPLIQUÉES: {len(self.fixes_applied)}")
        for fix in self.fixes_applied[:10]:  # Afficher les 10 premières
            print(f"  • {fix}")
        if len(self.fixes_applied) > 10:
            print(f"  ... et {len(self.fixes_applied) - 10} autres corrections")
        
        print(f"\n❌ ERREURS CRITIQUES: {len(self.issues)}")
        for issue in self.issues[:5]:  # Afficher les 5 premières
            print(f"  • {issue['file']}:{issue['line']} - {issue['message']}")
        if len(self.issues) > 5:
            print(f"  ... et {len(self.issues) - 5} autres erreurs")
        
        print(f"\n⚠️  AVERTISSEMENTS: {len(self.warnings)}")
        warning_categories = {}
        for warning in self.warnings:
            cat = warning['category']
            warning_categories[cat] = warning_categories.get(cat, 0) + 1
        
        for category, count in sorted(warning_categories.items(), key=lambda x: x[1], reverse=True):
            print(f"  • {category}: {count}")
        
        # Score de qualité
        total_issues = len(self.issues) + len(self.warnings)
        if total_issues == 0:
            quality_score = "A+"
            quality_emoji = "🏆"
        elif total_issues <= 5:
            quality_score = "A"
            quality_emoji = "✨"
        elif total_issues <= 15:
            quality_score = "B"
            quality_emoji = "👍"
        elif total_issues <= 35:
            quality_score = "C"
            quality_emoji = "⚠️"
        else:
            quality_score = "D"
            quality_emoji = "🚨"
        
        print(f"\n{quality_emoji} SCORE QUALITÉ GLOBAL: {quality_score}")
        
        improvement_percentage = (self.stats['errors_fixed'] / max(self.stats['errors_found'], 1)) * 100
        print(f"📈 AMÉLIORATION: {improvement_percentage:.1f}% des erreurs corrigées")
        
        print("=" * 80)
        
        return quality_score

if __name__ == "__main__":
    auditor = ComprehensiveCodeAuditor()
    quality_score = auditor.run_comprehensive_audit()
    
    # Exit code basé sur le score
    exit_codes = {"A+": 0, "A": 0, "B": 1, "C": 1, "D": 2}
    sys.exit(exit_codes.get(quality_score, 2))