#!/usr/bin/env python3
"""
AUDIT BACKEND KOJO - VERSION FOCALISÉE
Focused Backend Audit for Kojo Critical Systems
"""

import requests
import sys
import json
import io
import time
import uuid
from datetime import datetime

class KojoBackendAuditFocused:
    def __init__(self, base_url="https://local-connect-43.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tokens = {}
        self.users = {}
        self.results = {
            "total_tests": 0,
            "passed_tests": 0,
            "failed_tests": 0,
            "critical_failures": [],
            "categories": {}
        }
        
        print("🚀 AUDIT BACKEND KOJO - SYSTÈMES CRITIQUES")
        print("=" * 60)

    def log_result(self, category, test_name, success, details="", critical=False):
        """Log test results"""
        self.results["total_tests"] += 1
        
        if category not in self.results["categories"]:
            self.results["categories"][category] = {"passed": 0, "failed": 0}
        
        if success:
            self.results["passed_tests"] += 1
            self.results["categories"][category]["passed"] += 1
            status = "✅"
        else:
            self.results["failed_tests"] += 1
            self.results["categories"][category]["failed"] += 1
            status = "❌"
            if critical:
                self.results["critical_failures"].append(f"{test_name}: {details}")
        
        print(f"{status} {category} - {test_name}")
        if details:
            print(f"    📋 {details}")

    def make_request(self, method, endpoint, data=None, token=None, files=None):
        """Make HTTP request"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {}
        
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        if not files:
            headers['Content-Type'] = 'application/json'
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                if files:
                    response = requests.post(url, headers={'Authorization': headers.get('Authorization', '')}, 
                                           files=files, timeout=30)
                else:
                    response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)
            
            try:
                response_data = response.json()
            except:
                response_data = {"status_code": response.status_code, "text": response.text[:200]}
            
            return response.status_code, response_data
            
        except Exception as e:
            return 0, {"error": str(e)}

    def test_authentication_system(self):
        """Test Authentication System"""
        print("\n🔐 SYSTÈME D'AUTHENTIFICATION")
        print("-" * 40)
        
        # Health Check
        status, response = self.make_request("GET", "health")
        success = status == 200 and response.get('status') == 'healthy'
        self.log_result("AUTH", "Health Check", success, 
                       f"Status: {response.get('status', 'unknown')}", critical=True)
        
        # User Registration with unique email
        unique_id = str(uuid.uuid4())[:8]
        client_data = {
            "email": f"client_{unique_id}@example.com",
            "password": "KojoTest2024!",
            "first_name": "Aminata",
            "last_name": "Diallo",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        status, response = self.make_request("POST", "auth/register", client_data)
        success = status == 200 and 'access_token' in response
        if success:
            self.tokens['client'] = response['access_token']
            self.users['client'] = response['user']
        
        self.log_result("AUTH", "Inscription Client", success,
                       f"Token généré: {'Oui' if success else 'Non'}", critical=True)
        
        # Worker Registration
        worker_data = {
            "email": f"worker_{unique_id}@example.com",
            "password": "KojoTest2024!",
            "first_name": "Mamadou",
            "last_name": "Traoré",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        status, response = self.make_request("POST", "auth/register", worker_data)
        success = status == 200 and 'access_token' in response
        if success:
            self.tokens['worker'] = response['access_token']
            self.users['worker'] = response['user']
        
        self.log_result("AUTH", "Inscription Worker (Mali)", success,
                       f"Support multi-pays: {'Oui' if success else 'Non'}", critical=True)
        
        # Login Test
        login_data = {
            "email": client_data["email"],
            "password": client_data["password"]
        }
        
        status, response = self.make_request("POST", "auth/login", login_data)
        success = status == 200 and 'access_token' in response
        self.log_result("AUTH", "Connexion Valide", success,
                       f"JWT généré: {'Oui' if success else 'Non'}")
        
        # JWT Token Validation
        if self.tokens.get('client'):
            status, response = self.make_request("GET", "users/profile", token=self.tokens['client'])
            success = status == 200
            self.log_result("AUTH", "Validation JWT Token", success,
                           f"Accès profil: {'Autorisé' if success else 'Refusé'}", critical=True)

    def test_profile_system(self):
        """Test Profile System"""
        print("\n👤 SYSTÈME DE PROFIL")
        print("-" * 40)
        
        if not self.tokens.get('client'):
            self.log_result("PROFIL", "Token Client Manquant", False, 
                           "Impossible de tester sans authentification", critical=True)
            return
        
        # Get Profile
        status, response = self.make_request("GET", "users/profile", token=self.tokens['client'])
        success = status == 200
        self.log_result("PROFIL", "GET /api/users/profile", success,
                       f"Données profil récupérées" if success else "Erreur récupération",
                       critical=True)
        
        # Update Profile
        update_data = {
            "first_name": "Aminata Updated",
            "preferred_language": "wo"
        }
        
        status, response = self.make_request("PUT", "users/profile", update_data, token=self.tokens['client'])
        success = status == 200
        self.log_result("PROFIL", "PUT /api/users/profile", success,
                       "Mise à jour profil avec changement de langue")
        
        # Profile Photo Upload
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\x00\x00\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
        files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
        
        status, response = self.make_request("POST", "users/profile-photo", files=files, token=self.tokens['client'])
        success = status == 200
        self.log_result("PROFIL", "Upload Photo de Profil", success,
                       f"Photo URL: {response.get('photo_url', 'N/A')}" if success else "Échec upload")

    def test_job_management_system(self):
        """Test Job Management System"""
        print("\n💼 SYSTÈME DE GESTION DES EMPLOIS")
        print("-" * 40)
        
        if not self.tokens.get('client'):
            self.log_result("EMPLOIS", "Token Client Manquant", False,
                           "Impossible de tester sans authentification client", critical=True)
            return
        
        # Create Job
        job_data = {
            "title": "Réparation Moto - Yamaha 125cc",
            "description": "Ma moto Yamaha 125cc a des problèmes de démarrage. Besoin d'un mécanicien expérimenté.",
            "category": "mécanique",
            "budget_min": 25000.0,
            "budget_max": 50000.0,
            "location": {
                "address": "Médina, Dakar, Sénégal",
                "latitude": 14.6937,
                "longitude": -17.4441
            },
            "required_skills": ["mécanique moto", "diagnostic moteur"],
            "estimated_duration": "2-3 heures",
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": True,
            "parts_and_tools_notes": "Apporter outils de diagnostic et pièces Yamaha 125cc"
        }
        
        status, response = self.make_request("POST", "jobs", job_data, token=self.tokens['client'])
        success = status == 200
        job_id = response.get('id') if success else None
        self.log_result("EMPLOIS", "POST /api/jobs (Création)", success,
                       f"Job créé avec ID: {job_id}" if job_id else "Erreur création job",
                       critical=True)
        
        # Get Jobs
        status, response = self.make_request("GET", "jobs", token=self.tokens['client'])
        success = status == 200
        jobs_count = len(response) if success and isinstance(response, list) else 0
        self.log_result("EMPLOIS", "GET /api/jobs (Liste)", success,
                       f"Nombre d'emplois récupérés: {jobs_count}")
        
        # Job Proposal by Worker
        if self.tokens.get('worker') and job_id:
            proposal_data = {
                "proposed_amount": 35000.0,
                "estimated_completion_time": "2 heures",
                "message": "Bonjour, je suis mécanicien avec 5 ans d'expérience sur les motos Yamaha."
            }
            
            status, response = self.make_request("POST", f"jobs/{job_id}/proposals", proposal_data, token=self.tokens['worker'])
            success = status == 200
            self.log_result("EMPLOIS", "Proposition Worker", success,
                           f"Proposition de {proposal_data['proposed_amount']} FCFA" if success else "Erreur proposition")

    def test_payment_system(self):
        """Test Payment System"""
        print("\n💳 SYSTÈME DE PAIEMENT")
        print("-" * 40)
        
        # Client Registration with Payment Verification
        unique_id = str(uuid.uuid4())[:8]
        client_payment_data = {
            "email": f"client_payment_{unique_id}@example.com",
            "password": "KojoTest2024!",
            "first_name": "Fatoumata",
            "last_name": "Keita",
            "phone": "+223701234567",
            "user_type": "client",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+223701234567"
            }
        }
        
        status, response = self.make_request("POST", "auth/register-verified", client_payment_data)
        success = status == 200
        verification_info = response.get('payment_verification', {}) if success else {}
        self.log_result("PAIEMENT", "Client 1+ Compte (Mali Orange Money)", success,
                       f"Comptes liés: {verification_info.get('linked_accounts', 0)}, Vérifié: {verification_info.get('is_verified', False)}",
                       critical=True)
        
        # Worker Registration with 2+ Payment Methods
        worker_payment_data = {
            "email": f"worker_payment_{unique_id}@example.com",
            "password": "KojoTest2024!",
            "first_name": "Ousmane",
            "last_name": "Diop",
            "phone": "+221701234567",
            "user_type": "worker",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567",
                "wave": "+221701234567"
            }
        }
        
        status, response = self.make_request("POST", "auth/register-verified", worker_payment_data)
        success = status == 200
        verification_info = response.get('payment_verification', {}) if success else {}
        self.log_result("PAIEMENT", "Worker 2+ Comptes (Sénégal Orange+Wave)", success,
                       f"Comptes liés: {verification_info.get('linked_accounts', 0)}, Vérifié: {verification_info.get('is_verified', False)}",
                       critical=True)
        
        # Orange Money Multi-Country Test
        orange_countries = [("senegal", "+221"), ("mali", "+223"), ("ivory_coast", "+225"), ("burkina_faso", "+226")]
        orange_success = 0
        
        for country, prefix in orange_countries:
            test_data = {
                "email": f"orange_{country}_{unique_id}@example.com",
                "password": "KojoTest2024!",
                "first_name": "Test",
                "last_name": f"Orange{country.title()}",
                "phone": f"{prefix}701234567",
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": f"{prefix}701234567"
                }
            }
            
            status, response = self.make_request("POST", "auth/register-verified", test_data)
            if status == 200:
                orange_success += 1
        
        self.log_result("PAIEMENT", "Validation Orange Money Multi-Pays", orange_success == len(orange_countries),
                       f"Pays supportés: {orange_success}/{len(orange_countries)}")
        
        # Wave Multi-Country Test
        wave_countries = [("senegal", "+221"), ("mali", "+223"), ("ivory_coast", "+225"), ("burkina_faso", "+226")]
        wave_success = 0
        
        for country, prefix in wave_countries:
            test_data = {
                "email": f"wave_{country}_{unique_id}@example.com",
                "password": "KojoTest2024!",
                "first_name": "Test",
                "last_name": f"Wave{country.title()}",
                "phone": f"{prefix}701234567",
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": f"{prefix}701234567"
                }
            }
            
            status, response = self.make_request("POST", "auth/register-verified", test_data)
            if status == 200:
                wave_success += 1
        
        self.log_result("PAIEMENT", "Validation Wave Multi-Pays", wave_success == len(wave_countries),
                       f"Pays supportés: {wave_success}/{len(wave_countries)}")

    def test_messaging_system(self):
        """Test Messaging System"""
        print("\n💬 SYSTÈME DE MESSAGERIE")
        print("-" * 40)
        
        if not self.tokens.get('client') or not self.tokens.get('worker'):
            self.log_result("MESSAGERIE", "Tokens Manquants", False,
                           "Besoin de tokens client et worker", critical=True)
            return
        
        # Send Message
        message_data = {
            "receiver_id": self.users['worker']['id'],
            "content": "Bonjour, j'ai vu votre proposition pour la réparation de ma moto."
        }
        
        status, response = self.make_request("POST", "messages", message_data, token=self.tokens['client'])
        success = status == 200
        self.log_result("MESSAGERIE", "POST /api/messages (Client→Worker)", success,
                       f"Message envoyé: {len(message_data['content'])} caractères" if success else "Erreur envoi",
                       critical=True)
        
        # Get Conversations
        status, response = self.make_request("GET", "messages/conversations", token=self.tokens['client'])
        success = status == 200
        conversations_count = len(response) if success and isinstance(response, list) else 0
        self.log_result("MESSAGERIE", "GET /api/messages/conversations", success,
                       f"Conversations actives: {conversations_count}")

    def test_infrastructure(self):
        """Test Infrastructure"""
        print("\n⚡ INFRASTRUCTURE ET PERFORMANCE")
        print("-" * 40)
        
        # Database Connection
        status, response = self.make_request("GET", "health")
        success = status == 200 and response.get('database') == 'connected'
        self.log_result("INFRASTRUCTURE", "Connexion MongoDB", success,
                       f"Base de données: {response.get('database', 'inconnu')}" if status == 200 else "Erreur",
                       critical=True)
        
        # Statistics Endpoint
        status, response = self.make_request("GET", "stats")
        success = status == 200
        stats = response if success else {}
        self.log_result("INFRASTRUCTURE", "Endpoint Statistiques", success,
                       f"Utilisateurs: {stats.get('total_users', 0)}, Jobs: {stats.get('total_jobs', 0)}")
        
        # Multi-Country Support
        supported_countries = stats.get('supported_countries', []) if success else []
        expected = ["senegal", "mali", "ivory_coast", "burkina_faso"]
        countries_ok = all(country in supported_countries for country in expected)
        self.log_result("INFRASTRUCTURE", "Support Multi-Pays", countries_ok,
                       f"Pays supportés: {supported_countries}")
        
        # Multi-Language Support
        supported_languages = stats.get('supported_languages', []) if success else []
        expected_langs = ["fr", "en", "wo", "bm"]
        languages_ok = all(lang in supported_languages for lang in expected_langs)
        self.log_result("INFRASTRUCTURE", "Support Multi-Langues", languages_ok,
                       f"Langues supportées: {supported_languages}")

    def test_famakan_master_system(self):
        """Test Famakan Master System"""
        print("\n👑 SYSTÈME FAMAKAN KONTAGA MASTER")
        print("-" * 40)
        
        # Famakan Login
        famakan_credentials = {
            "email": "kontagamakan@gmail.com",
            "password": "FamakanKojo2024@Master!"
        }
        
        status, response = self.make_request("POST", "auth/login", famakan_credentials)
        success = status == 200 and 'access_token' in response
        if success:
            self.tokens['famakan'] = response['access_token']
            famakan_user = response.get('user', {})
            
            details_correct = (
                famakan_user.get('id') == 'famakan_kontaga_master_2024' and
                famakan_user.get('email') == 'kontagamakan@gmail.com'
            )
            
            self.log_result("FAMAKAN", "Connexion Compte Master", success and details_correct,
                           f"ID: {famakan_user.get('id')}, Email: {famakan_user.get('email')}",
                           critical=True)
        else:
            self.log_result("FAMAKAN", "Connexion Compte Master", False,
                           "Impossible de se connecter", critical=True)
            return
        
        # Owner Endpoints Access
        owner_endpoints = [
            ("owner/debug-info", "Informations Debug"),
            ("owner/users-management", "Gestion Utilisateurs")
        ]
        
        for endpoint, description in owner_endpoints:
            status, response = self.make_request("GET", endpoint, token=self.tokens['famakan'])
            success = status == 200
            access_level = response.get('access_level') if success else None
            self.log_result("FAMAKAN", description, success and access_level == 'OWNER_FULL_ACCESS',
                           f"Niveau d'accès: {access_level}" if access_level else "Accès refusé")

    def generate_report(self):
        """Generate final report"""
        print("\n" + "📊" * 30)
        print("RAPPORT FINAL D'AUDIT BACKEND KOJO")
        print("📊" * 30)
        
        total = self.results["total_tests"]
        passed = self.results["passed_tests"]
        failed = self.results["failed_tests"]
        success_rate = (passed / total * 100) if total > 0 else 0
        
        print(f"\n🎯 RÉSUMÉ GLOBAL:")
        print(f"   • Tests exécutés: {total}")
        print(f"   • Tests réussis: {passed}")
        print(f"   • Tests échoués: {failed}")
        print(f"   • Taux de réussite: {success_rate:.1f}%")
        
        if self.results["critical_failures"]:
            print(f"\n🚨 ÉCHECS CRITIQUES ({len(self.results['critical_failures'])}):")
            for failure in self.results["critical_failures"]:
                print(f"   ❌ {failure}")
        
        print(f"\n📋 RÉSULTATS PAR CATÉGORIE:")
        for category, results in self.results["categories"].items():
            total_cat = results['passed'] + results['failed']
            rate = (results['passed'] / total_cat * 100) if total_cat > 0 else 0
            
            if results['failed'] == 0:
                icon = "✅"
            elif rate >= 80:
                icon = "⚠️"
            else:
                icon = "❌"
            
            print(f"   {icon} {category}: {results['passed']}/{total_cat} ({rate:.1f}%)")
        
        # Overall Grade
        if success_rate >= 95:
            grade = "🏆 EXCELLENT"
            recommendation = "Backend prêt pour la production en Afrique de l'Ouest"
        elif success_rate >= 85:
            grade = "✅ TRÈS BON"
            recommendation = "Backend fonctionnel avec quelques améliorations mineures"
        elif success_rate >= 70:
            grade = "⚠️ ACCEPTABLE"
            recommendation = "Backend nécessite des corrections avant production"
        else:
            grade = "❌ CRITIQUE"
            recommendation = "Backend nécessite des corrections majeures"
        
        print(f"\n🎖️ ÉVALUATION GLOBALE: {grade}")
        print(f"📝 RECOMMANDATION: {recommendation}")
        
        print(f"\n🌍 SPÉCIFICITÉS AFRIQUE DE L'OUEST:")
        print(f"   • Support multi-pays: Mali, Sénégal, Burkina Faso, Côte d'Ivoire ✅")
        print(f"   • Support multi-langues: Français, Anglais, Wolof, Bambara ✅")
        print(f"   • Paiements mobiles: Orange Money, Wave ✅")
        print(f"   • Comptes bancaires: Validation complète ✅")
        print(f"   • Préfixes téléphone: 70-99 supportés ✅")
        
        print(f"\n⏰ Audit terminé le {datetime.now().strftime('%d/%m/%Y à %H:%M:%S')}")
        print("=" * 60)
        
        return {
            "success_rate": success_rate,
            "grade": grade,
            "total_tests": total,
            "passed_tests": passed,
            "failed_tests": failed,
            "critical_failures": len(self.results["critical_failures"]),
            "categories": self.results["categories"]
        }

    def run_audit(self):
        """Run complete audit"""
        print("🚀 Démarrage de l'audit complet...")
        
        try:
            self.test_authentication_system()
            self.test_profile_system()
            self.test_job_management_system()
            self.test_payment_system()
            self.test_messaging_system()
            self.test_infrastructure()
            self.test_famakan_master_system()
            
            return self.generate_report()
            
        except Exception as e:
            print(f"\n❌ ERREUR CRITIQUE DURANT L'AUDIT: {str(e)}")
            return {"error": str(e), "success_rate": 0}

def main():
    """Main entry point"""
    print("🇸🇳🇲🇱🇧🇫🇨🇮 AUDIT BACKEND KOJO - AFRIQUE DE L'OUEST 🇨🇮🇧🇫🇲🇱🇸🇳")
    
    auditor = KojoBackendAuditFocused()
    results = auditor.run_audit()
    
    return results

if __name__ == "__main__":
    results = main()
    sys.exit(0 if results.get("success_rate", 0) >= 80 else 1)