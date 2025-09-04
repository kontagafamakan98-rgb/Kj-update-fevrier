#!/usr/bin/env python3
"""
ULTIMATE KOJO CODE AUDIT - Utilise toute la puissance pour détecter TOUTES les erreurs
Audit complet et exhaustif de l'application Kojo (Frontend React + Backend FastAPI)
"""

import os
import re
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Any

class UltimateKojoAuditor:
    def __init__(self):
        self.project_root = Path("/app")
        self.frontend_path = self.project_root / "frontend"
        self.backend_path = self.project_root / "backend"
        self.mobile_path = self.project_root / "KojoMobile_FINAL"
        
        self.issues = {
            "critical": [],
            "major": [],
            "minor": [],
            "style": [],
            "performance": []
        }
        
        self.stats = {
            "files_scanned": 0,
            "lines_scanned": 0,
            "errors_found": 0,
            "fixes_suggested": 0
        }

    def log_issue(self, severity: str, category: str, file_path: str, line_no: int, description: str, fix_suggestion: str = ""):
        """Log une issue trouvée"""
        issue = {
            "category": category,
            "file": file_path,
            "line": line_no,
            "description": description,
            "fix": fix_suggestion
        }
        
        self.issues[severity].append(issue)
        self.stats["errors_found"] += 1
        if fix_suggestion:
            self.stats["fixes_suggested"] += 1

    def scan_frontend_issues(self):
        """Scan exhaustif du frontend React"""
        print("🔍 SCANNING FRONTEND - Analyse exhaustive React/JS/CSS...")
        
        frontend_files = []
        for ext in ['*.js', '*.jsx', '*.ts', '*.tsx', '*.css', '*.json']:
            frontend_files.extend(self.frontend_path.rglob(ext))
        
        for file_path in frontend_files:
            if 'node_modules' in str(file_path) or '.git' in str(file_path):
                continue
                
            self.stats["files_scanned"] += 1
            self._analyze_frontend_file(file_path)

    def _analyze_frontend_file(self, file_path: Path):
        """Analyse détaillée d'un fichier frontend"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = content.split('\n')
                self.stats["lines_scanned"] += len(lines)
                
                for line_no, line in enumerate(lines, 1):
                    self._check_frontend_line_issues(file_path, line_no, line, content)
                    
                # Analyse globale du fichier
                self._check_frontend_file_structure(file_path, content)
                
        except Exception as e:
            self.log_issue("major", "file_read_error", str(file_path), 0, 
                         f"Erreur lecture fichier: {str(e)}")

    def _check_frontend_line_issues(self, file_path: Path, line_no: int, line: str, content: str):
        """Vérifications ligne par ligne pour le frontend"""
        
        # 1. Console.log oubliés (critique en production)
        if re.search(r'console\.(log|debug|info)', line) and 'devLog' not in line:
            self.log_issue("critical", "debug_code", str(file_path), line_no,
                         "Console.log en production détecté",
                         "Remplacer par devLog.info() ou supprimer")
        
        # 2. Erreurs de syntaxe courantes
        if 'undefined' in line and 'typeof' not in line:
            self.log_issue("major", "undefined_usage", str(file_path), line_no,
                         "Usage potentiel d'undefined non contrôlé",
                         "Vérifier avec typeof ou utiliser ?? operator")
        
        # 3. Importations incorrectes
        if line.strip().startswith('import') and '../' in line:
            if line.count('../') > 3:
                self.log_issue("minor", "deep_import", str(file_path), line_no,
                             "Import trop profond (maintainability)",
                             "Restructurer les dossiers ou utiliser alias")
        
        # 4. URLs hardcodées
        if re.search(r'https?://(?!.*process\.env)', line):
            self.log_issue("major", "hardcoded_url", str(file_path), line_no,
                         "URL hardcodée détectée",
                         "Utiliser variable d'environnement")
        
        # 5. Clés manquantes dans les listes React
        if 'map(' in line and 'key=' not in line and not line.strip().endswith('{'):
            self.log_issue("major", "missing_react_key", str(file_path), line_no,
                         "Clé React manquante dans map()",
                         "Ajouter key={item.id} ou key={index}")
        
        # 6. Inline styles (performance)
        if 'style={{' in line:
            self.log_issue("minor", "inline_style", str(file_path), line_no,
                         "Style inline détecté (impact performance)",
                         "Utiliser classes CSS ou styled-components")
        
        # 7. Passwords en plain text
        if re.search(r'password.*["\'][^"\']{6,}["\']', line, re.IGNORECASE):
            self.log_issue("critical", "plain_password", str(file_path), line_no,
                         "Mot de passe potentiel en plain text",
                         "Utiliser variables d'environnement sécurisées")

    def _check_frontend_file_structure(self, file_path: Path, content: str):
        """Vérifications globales de structure frontend"""
        
        # React component sans PropTypes ou TypeScript
        if file_path.suffix in ['.js', '.jsx'] and 'function' in content and 'export' in content:
            if 'PropTypes' not in content and 'typescript' not in content:
                self.log_issue("minor", "no_proptypes", str(file_path), 0,
                             "Composant React sans PropTypes/TypeScript",
                             "Ajouter PropTypes ou migrer vers TypeScript")
        
        # Fichiers CSS trop longs
        if file_path.suffix == '.css' and len(content.split('\n')) > 500:
            self.log_issue("minor", "large_css", str(file_path), 0,
                         "Fichier CSS très long (maintainability)",
                         "Diviser en modules plus petits")

    def scan_backend_issues(self):
        """Scan exhaustif du backend FastAPI/Python"""
        print("🔍 SCANNING BACKEND - Analyse exhaustive FastAPI/Python...")
        
        backend_files = list(self.backend_path.rglob("*.py"))
        
        for file_path in backend_files:
            if '__pycache__' in str(file_path):
                continue
                
            self.stats["files_scanned"] += 1
            self._analyze_backend_file(file_path)

    def _analyze_backend_file(self, file_path: Path):
        """Analyse détaillée d'un fichier backend"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = content.split('\n')
                self.stats["lines_scanned"] += len(lines)
                
                for line_no, line in enumerate(lines, 1):
                    self._check_backend_line_issues(file_path, line_no, line, content)
                    
                # Analyse globale du fichier
                self._check_backend_file_structure(file_path, content)
                
        except Exception as e:
            self.log_issue("major", "file_read_error", str(file_path), 0,
                         f"Erreur lecture fichier: {str(e)}")

    def _check_backend_line_issues(self, file_path: Path, line_no: int, line: str, content: str):
        """Vérifications ligne par ligne pour le backend"""
        
        # 1. Print statements oubliés
        if line.strip().startswith('print(') and 'logging' not in file_path.name:
            self.log_issue("major", "print_statement", str(file_path), line_no,
                         "Print statement au lieu de logging",
                         "Remplacer par logger.info()")
        
        # 2. Imports manquants ou incorrects
        if 'from typing import' in line and 'Optional' in line:
            if 'Union' not in content and 'List' not in content:
                self.log_issue("minor", "incomplete_typing", str(file_path), line_no,
                             "Imports typing incomplets potentiels")
        
        # 3. Secrets hardcodés
        if re.search(r'(password|secret|key|token).*=.*["\'][^"\']{8,}["\']', line, re.IGNORECASE):
            self.log_issue("critical", "hardcoded_secret", str(file_path), line_no,
                         "Secret potentiel hardcodé",
                         "Utiliser os.environ.get()")
        
        # 4. SQL Injection potentiel
        if 'query' in line.lower() and '+' in line and 'f"' in line:
            self.log_issue("critical", "sql_injection_risk", str(file_path), line_no,
                         "Risque d'injection SQL avec concaténation",
                         "Utiliser paramètres de requête")
        
        # 5. Gestion d'erreur manquante
        if line.strip().startswith('await ') and 'try:' not in content[:content.find(line)] if line in content else False:
            # Check if within a try block
            if line in content:
                lines_before = content[:content.find(line)].split('\n')
                in_try_block = False
                for prev_line in reversed(lines_before[-20:]):  # Check last 20 lines
                    if 'try:' in prev_line:
                        in_try_block = True
                        break
                    elif prev_line.strip() and not prev_line.startswith(' ') and not prev_line.startswith('\t'):
                        break
                
                if not in_try_block:
                    self.log_issue("major", "unhandled_async", str(file_path), line_no,
                                 "Appel async sans gestion d'erreur",
                                 "Entourer dans try/except")

    def _check_backend_file_structure(self, file_path: Path, content: str):
        """Vérifications globales de structure backend"""
        
        # Fonction trop longue
        functions = re.findall(r'^def \w+.*?(?=^def|\Z)', content, re.MULTILINE | re.DOTALL)
        for func in functions:
            if len(func.split('\n')) > 50:
                self.log_issue("minor", "long_function", str(file_path), 0,
                             "Fonction très longue détectée (>50 lignes)",
                             "Diviser en fonctions plus petites")
        
        # Classe sans docstring
        if 'class ' in content and '"""' not in content:
            self.log_issue("minor", "no_docstring", str(file_path), 0,
                         "Classe sans docstring",
                         "Ajouter documentation")

    def generate_report(self):
        """Génère le rapport d'audit complet"""
        print("\n" + "="*80)
        print("📊 ULTIMATE KOJO AUDIT REPORT")
        print("="*80)
        
        print(f"\n📈 STATISTIQUES GÉNÉRALES:")
        print(f"   Fichiers scannés: {self.stats['files_scanned']}")
        print(f"   Lignes analysées: {self.stats['lines_scanned']:,}")
        print(f"   Erreurs trouvées: {self.stats['errors_found']}")
        print(f"   Corrections suggérées: {self.stats['fixes_suggested']}")
        
        # Résumé par sévérité
        total_issues = sum(len(issues) for issues in self.issues.values())
        print(f"\n🎯 RÉSUMÉ PAR SÉVÉRITÉ:")
        print(f"   🔴 CRITIQUE: {len(self.issues['critical'])} issues")
        print(f"   🟠 MAJEUR: {len(self.issues['major'])} issues") 
        print(f"   🟡 MINEUR: {len(self.issues['minor'])} issues")
        print(f"   🔵 STYLE: {len(self.issues['style'])} issues")
        print(f"   ⚡ PERFORMANCE: {len(self.issues['performance'])} issues")
        print(f"   📊 TOTAL: {total_issues} issues")
        
        # Top 10 des issues les plus fréquentes
        issue_counts = {}
        for severity, issues in self.issues.items():
            for issue in issues:
                category = issue['category']
                issue_counts[category] = issue_counts.get(category, 0) + 1
        
        if issue_counts:
            print(f"\n🔟 TOP 10 PROBLÈMES FRÉQUENTS:")
            sorted_issues = sorted(issue_counts.items(), key=lambda x: x[1], reverse=True)[:10]
            for i, (category, count) in enumerate(sorted_issues, 1):
                print(f"   {i:2d}. {category}: {count} occurrences")
        
        # Détails par sévérité
        for severity in ['critical', 'major', 'minor']:
            if self.issues[severity]:
                print(f"\n{'🔴' if severity == 'critical' else '🟠' if severity == 'major' else '🟡'} {severity.upper()} ISSUES:")
                for i, issue in enumerate(self.issues[severity][:10], 1):  # Limite à 10 pour lisibilité
                    print(f"   {i}. {issue['file']}:{issue['line']} - {issue['description']}")
                    if issue['fix']:
                        print(f"      💡 Solution: {issue['fix']}")
                
                if len(self.issues[severity]) > 10:
                    print(f"      ... et {len(self.issues[severity]) - 10} autres issues {severity}")
        
        # Score de qualité
        score = max(0, 100 - (len(self.issues['critical']) * 10 + 
                             len(self.issues['major']) * 5 + 
                             len(self.issues['minor']) * 2 +
                             len(self.issues['style']) * 1))
        
        grade = "A+" if score >= 95 else "A" if score >= 90 else "B+" if score >= 85 else "B" if score >= 80 else "C+" if score >= 75 else "C" if score >= 70 else "D"
        
        print(f"\n🏆 SCORE DE QUALITÉ: {score}/100 (Grade: {grade})")
        
        if score >= 90:
            print("✅ Excellente qualité de code!")
        elif score >= 75:
            print("✅ Bonne qualité de code avec quelques améliorations possibles")
        elif score >= 60:
            print("⚠️ Qualité correcte mais nécessite des améliorations")
        else:
            print("❌ Qualité nécessitant des corrections importantes")
        
        return {
            "score": score,
            "grade": grade,
            "total_issues": total_issues,
            "stats": self.stats,
            "issues": self.issues
        }

    def run_complete_audit(self):
        """Lance l'audit complet avec toute la puissance"""
        print("🚀 DÉMARRAGE ULTIMATE KOJO AUDIT")
        print("💪 Utilisation de toute la puissance d'analyse...")
        print("="*80)
        
        # Phases d'audit
        self.scan_frontend_issues()
        self.scan_backend_issues() 
        
        # Génération du rapport
        report = self.generate_report()
        
        print(f"\n💾 Audit terminé avec score: {report['score']}/100")
        
        return report

def main():
    auditor = UltimateKojoAuditor()
    report = auditor.run_complete_audit()
    
    # Exit code basé sur la qualité
    if report["score"] >= 80:
        sys.exit(0)  # Success
    elif report["score"] >= 60:
        sys.exit(1)  # Warning
    else:
        sys.exit(2)  # Critical issues

if __name__ == "__main__":
    main()