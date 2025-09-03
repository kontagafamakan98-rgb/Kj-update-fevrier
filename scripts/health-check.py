#!/usr/bin/env python3

"""
Script de vérification complète de la santé de Kojo
Effectue une analyse exhaustive de tous les composants
"""

import os
import json
import subprocess
import glob
import re
from pathlib import Path

class KojoHealthChecker:
    def __init__(self):
        self.issues = []
        self.warnings = []
        self.fixes_applied = []
        self.root_path = Path("/app")
        
    def log_issue(self, level, component, message, fix=None):
        issue = {
            'level': level,  # 'error', 'warning', 'info'
            'component': component,
            'message': message,
            'fix': fix
        }
        
        if level == 'error':
            self.issues.append(issue)
        elif level == 'warning':
            self.warnings.append(issue)
            
        print(f"[{level.upper()}] {component}: {message}")
        if fix:
            print(f"  → Fix: {fix}")
    
    def check_backend_syntax(self):
        """Vérifier la syntaxe Python du backend"""
        print("\n🔍 Vérification syntaxe backend...")
        
        backend_files = glob.glob("/app/backend/**/*.py", recursive=True)
        for file_path in backend_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                compile(content, file_path, 'exec')
                
                # Vérifier les imports dupliqués
                imports = re.findall(r'^from .+ import .+|^import .+', content, re.MULTILINE)
                import_counts = {}
                for imp in imports:
                    if imp in import_counts:
                        self.log_issue('warning', 'Backend Syntax', 
                                     f"Import dupliqué dans {file_path}: {imp}")
                    import_counts[imp] = import_counts.get(imp, 0) + 1
                        
            except SyntaxError as e:
                self.log_issue('error', 'Backend Syntax', 
                             f"Erreur syntaxe dans {file_path}: {e}")
            except Exception as e:
                self.log_issue('warning', 'Backend Syntax', 
                             f"Problème dans {file_path}: {e}")
    
    def check_frontend_dependencies(self):
        """Vérifier les dépendances frontend"""
        print("\n🔍 Vérification dépendances frontend...")
        
        package_json = "/app/frontend/package.json"
        if os.path.exists(package_json):
            with open(package_json, 'r') as f:
                data = json.load(f)
                
            # Vérifier les dépendances critiques
            critical_deps = [
                'react', 'react-dom', 'axios', '@craco/craco'
            ]
            
            missing_deps = []
            for dep in critical_deps:
                if dep not in data.get('dependencies', {}):
                    missing_deps.append(dep)
            
            if missing_deps:
                self.log_issue('error', 'Frontend Dependencies', 
                             f"Dépendances manquantes: {', '.join(missing_deps)}")
        else:
            self.log_issue('error', 'Frontend Dependencies', 
                         "package.json introuvable")
    
    def check_mobile_config(self):
        """Vérifier la configuration mobile"""
        print("\n🔍 Vérification configuration mobile...")
        
        app_json = "/app/KojoMobile_FINAL/app.json"
        if os.path.exists(app_json):
            with open(app_json, 'r') as f:
                data = json.load(f)
            
            expo_config = data.get('expo', {})
            
            # Vérifications critiques
            if not expo_config.get('name'):
                self.log_issue('error', 'Mobile Config', "Nom d'app manquant")
            
            if not expo_config.get('slug'):
                self.log_issue('error', 'Mobile Config', "Slug manquant")
                
            # Vérifier les permissions Android
            android_perms = expo_config.get('android', {}).get('permissions', [])
            required_perms = [
                'android.permission.INTERNET',
                'android.permission.CAMERA',
                'android.permission.ACCESS_FINE_LOCATION'
            ]
            
            for perm in required_perms:
                if perm not in android_perms:
                    self.log_issue('warning', 'Mobile Config', 
                                 f"Permission manquante: {perm}")
        else:
            self.log_issue('error', 'Mobile Config', "app.json introuvable")
    
    def check_env_files(self):
        """Vérifier les fichiers d'environnement"""
        print("\n🔍 Vérification fichiers .env...")
        
        env_files = [
            "/app/frontend/.env",
            "/app/backend/.env"
        ]
        
        for env_file in env_files:
            if os.path.exists(env_file):
                with open(env_file, 'r') as f:
                    content = f.read()
                
                # Vérifier les variables critiques
                if 'frontend' in env_file:
                    if 'REACT_APP_BACKEND_URL' not in content:
                        self.log_issue('error', 'Environment', 
                                     f"REACT_APP_BACKEND_URL manquant dans {env_file}")
                elif 'backend' in env_file:
                    if 'MONGO_URL' not in content:
                        self.log_issue('warning', 'Environment', 
                                     f"MONGO_URL pourrait être manquant dans {env_file}")
            else:
                self.log_issue('warning', 'Environment', 
                             f"Fichier .env manquant: {env_file}")
    
    def check_api_consistency(self):
        """Vérifier la cohérence entre frontend et backend APIs"""
        print("\n🔍 Vérification cohérence APIs...")
        
        # Lire les endpoints backend
        backend_file = "/app/backend/server.py"
        if os.path.exists(backend_file):
            with open(backend_file, 'r') as f:
                backend_content = f.read()
            
            # Extraire les endpoints
            backend_endpoints = re.findall(r'@app\.(get|post|put|delete)\("([^"]+)"', backend_content)
            backend_routes = [route[1] for route in backend_endpoints]
            
            # Lire les appels API frontend
            frontend_api = "/app/frontend/src/services/api.js"
            if os.path.exists(frontend_api):
                with open(frontend_api, 'r') as f:
                    frontend_content = f.read()
                
                # Extraire les appels API
                frontend_calls = re.findall(r'["`\'](/api/[^"`\']+)["`\']', frontend_content)
                
                # Vérifier la cohérence
                for call in set(frontend_calls):
                    if call not in backend_routes:
                        self.log_issue('warning', 'API Consistency', 
                                     f"Endpoint frontend non trouvé dans backend: {call}")
        
    def check_logging_consistency(self):
        """Vérifier que le logging est cohérent partout"""
        print("\n🔍 Vérification cohérence logging...")
        
        # Vérifier qu'il n'y a plus de console.log inappropriés
        frontend_files = glob.glob("/app/frontend/src/**/*.js", recursive=True)
        for file_path in frontend_files:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Compter les console.log restants
            console_logs = re.findall(r'console\.log\(', content)
            if console_logs:
                self.log_issue('info', 'Logging', 
                             f"{len(console_logs)} console.log restants dans {file_path}")
    
    def fix_critical_issues(self):
        """Appliquer des corrections automatiques pour les problèmes critiques"""
        print("\n🔧 Application des corrections automatiques...")
        
        # Correction 1: S'assurer que tous les dossiers existent
        critical_dirs = [
            "/app/uploads",
            "/app/uploads/profile_photos",
            "/app/frontend/src/utils",
            "/app/backend/logs"
        ]
        
        for dir_path in critical_dirs:
            if not os.path.exists(dir_path):
                os.makedirs(dir_path, exist_ok=True)
                self.fixes_applied.append(f"Créé dossier: {dir_path}")
    
    def generate_report(self):
        """Générer un rapport complet"""
        print("\n" + "="*50)
        print("📊 RAPPORT DE SANTÉ KOJO")
        print("="*50)
        
        print(f"\n✅ Corrections appliquées: {len(self.fixes_applied)}")
        for fix in self.fixes_applied:
            print(f"  • {fix}")
        
        print(f"\n❌ Erreurs critiques: {len(self.issues)}")
        for issue in self.issues:
            print(f"  • {issue['component']}: {issue['message']}")
            if issue['fix']:
                print(f"    → {issue['fix']}")
        
        print(f"\n⚠️  Avertissements: {len(self.warnings)}")
        for warning in self.warnings:
            print(f"  • {warning['component']}: {warning['message']}")
            if warning['fix']:
                print(f"    → {warning['fix']}")
        
        # Score de santé
        total_issues = len(self.issues) + len(self.warnings)
        if total_issues == 0:
            health_score = "A+"
            health_emoji = "🏆"
        elif total_issues <= 3:
            health_score = "A"
            health_emoji = "✨"
        elif total_issues <= 7:
            health_score = "B"
            health_emoji = "👍"
        elif total_issues <= 15:
            health_score = "C"
            health_emoji = "⚠️"
        else:
            health_score = "D"
            health_emoji = "🚨"
        
        print(f"\n{health_emoji} SCORE DE SANTÉ GLOBAL: {health_score}")
        print("="*50)
        
        return health_score
    
    def run_full_check(self):
        """Exécuter toutes les vérifications"""
        print("🚀 AUDIT COMPLET DE SANTÉ KOJO")
        print("="*50)
        
        self.fix_critical_issues()
        self.check_backend_syntax()
        self.check_frontend_dependencies()
        self.check_mobile_config()
        self.check_env_files()
        self.check_api_consistency()
        self.check_logging_consistency()
        
        return self.generate_report()

if __name__ == "__main__":
    checker = KojoHealthChecker()
    score = checker.run_full_check()
    
    # Exit code basé sur le score
    exit_codes = {"A+": 0, "A": 0, "B": 1, "C": 1, "D": 2}
    exit(exit_codes.get(score, 2))