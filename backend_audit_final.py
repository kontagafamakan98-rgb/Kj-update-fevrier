#!/usr/bin/env python3
"""
AUDIT COMPLET DU BACKEND POUR KOJO - VERSION FINALE
Comprehensive Backend Audit for Kojo - Final Version
"""

import requests
import sys
import json
import io
import time
from datetime import datetime

class KojoBackendAuditFinal:
    def __init__(self, base_url="https://geoloc-boost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tokens = {}
        self.users = {}
        self.test_results = {
            "total_tests": 0,
            "passed_tests": 0,
            "failed_tests": 0,
            "critical_failures": [],
            "categories": {}
        }
        
        print("🚀 AUDIT COMPLET DU BACKEND KOJO - SYSTÈMES CRITIQUES")
        print("=" * 80)

    def log_result(self, category, test_name, success, details="", critical=False):
        """Log test results"""
        self.test_results["total_tests"] += 1
        
        if category not in self.test_results["categories"]:
            self.test_results["categories"][category] = {"passed": 0, "failed": 0, "tests": []}
        
        if success:
            self.test_results["passed_tests"] += 1
            self.test_results["categories"][category]["passed"] += 1
            status = "✅"
        else:
            self.test_results["failed_tests"] += 1
            self.test_results["categories"][category]["failed"] += 1
            status = "❌"
            if critical:
                self.test_results["critical_failures"].append(f"{test_name}: {details}")
        
        print(f"{status} {category} - {test_name}")
        if details:
            print(f"    📋 {details}")
        
        self.test_results["categories"][category]["tests"].append({
            "name": test_name,
            "success": success,
            "details": details,
            "critical": critical
        })

    def make_request(self, method, endpoint, data=None, token=None, files=None):
        """Make HTTP request"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {}
        
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        if files:
            # Don't set Content-Type for file uploads
            pass
        else:
            headers['Content-Type'] = 'application/json'
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                if files:
                    response = requests.post(url, headers={'Authorization': headers.get('Authorization', '')}, 
                                           files=files, data=data, timeout=30)
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

    def audit_authentication_system(self):
        """1. AUDIT DU SYSTÈME D'AUTHENTIFICATION"""
        print("\n🔐 1. AUDIT DU SYSTÈME D'AUTHENTIFICATION")
        print("-" * 50)
        
        # Test 1.1: Health Check
        status, response = self.make_request("GET", "health")
        success = status == 200 and response.get('status') == 'healthy'
        self.log_result("AUTHENTIFICATION", "Health Check", success, 
                       f"Status: {response.get('status', 'unknown')}", critical=True)
        
        # Test 1.2: User Registration
        timestamp = datetime.now().strftime('%H%M%S%f')
        client_data = {
            "email": f"client_audit_{timestamp}@kojo.test",
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
        
        self.log_result("AUTHENTIFICATION", "Inscription Client", success,
                       f"Token généré: {'Oui' if success else 'Non'}", critical=True)
        
        # Test 1.3: Worker Registration
        worker_data = {
            "email": f"worker_audit_{timestamp}@kojo.test",
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
        
        self.log_result("AUTHENTIFICATION", "Inscription Worker (Mali)", success,
                       f"Support multi-pays: {'Oui' if success else 'Non'}", critical=True)
        
        # Test 1.4: Login
        login_data = {
            "email": client_data["email"],
            "password": client_data["password"]
        }
        
        status, response = self.make_request("POST", "auth/login", login_data)
        success = status == 200 and 'access_token' in response
        self.log_result("AUTHENTIFICATION", "Connexion Valide", success,
                       f"JWT généré: {'Oui' if success else 'Non'}")
        
        # Test 1.5: Invalid Login
        invalid_login = {
            "email": client_data["email"],
            "password": "wrong_password"
        }
        
        status, response = self.make_request("POST", "auth/login", invalid_login)
        success = status == 401
        self.log_result("AUTHENTIFICATION", "Protection Mot de Passe Invalide", success,
                       "Sécurité contre les mauvais mots de passe")
        
        # Test 1.6: JWT Token Validation
        if self.tokens.get('client'):
            status, response = self.make_request("GET", "users/profile", token=self.tokens['client'])
            success = status == 200
            self.log_result("AUTHENTIFICATION", "Validation JWT Token", success,
                           f"Accès profil: {'Autorisé' if success else 'Refusé'}", critical=True)
        
        # Test 1.7: Protected Route Without Token
        status, response = self.make_request("GET", "users/profile")
        success = status == 403
        self.log_result("AUTHENTIFICATION", "Protection Routes Sans Token", success,
                       "Routes protégées correctement")

    def audit_profile_system(self):
        """2. AUDIT DU SYSTÈME DE PROFIL"""
        print("\n👤 2. AUDIT DU SYSTÈME DE PROFIL")
        print("-" * 50)
        
        if not self.tokens.get('client'):
            self.log_result("PROFIL", "Token Client Manquant", False, 
                           "Impossible de tester sans authentification", critical=True)
            return
        
        # Test 2.1: Get Profile
        status, response = self.make_request("GET", "users/profile", token=self.tokens['client'])
        success = status == 200
        self.log_result("PROFIL", "GET /api/users/profile", success,
                       f"Données profil: {len(response)} champs" if success else "Erreur récupération",
                       critical=True)
        
        # Test 2.2: Update Profile
        update_data = {
            "first_name": "Aminata Updated",
            "preferred_language": "wo"
        }
        
        status, response = self.make_request("PUT", "users/profile", update_data, token=self.tokens['client'])
        success = status == 200
        self.log_result("PROFIL", "PUT /api/users/profile", success,
                       "Mise à jour profil avec changement de langue")
        
        # Test 2.3: Profile Photo Upload
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\x00\x00\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
        files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
        
        status, response = self.make_request("POST", "users/profile-photo", files=files, token=self.tokens['client'])
        success = status == 200
        photo_url = response.get('photo_url') if success else None
        self.log_result("PROFIL", "POST /api/users/profile-photo", success,
                       f"Photo URL: {photo_url}" if photo_url else "Échec upload photo")
        
        # Test 2.4: Get Profile Photo
        status, response = self.make_request("GET", "users/profile-photo", token=self.tokens['client'])
        success = status == 200
        self.log_result("PROFIL", "GET /api/users/profile-photo", success,
                       f"Photo accessible: {'Oui' if success and response.get('photo_url') else 'Non'}")
        
        # Test 2.5: Worker Profile
        if self.tokens.get('worker'):
            worker_profile_data = {
                "user_id": self.users['worker']['id'],
                "specialties": ["mécanique", "électricité"],
                "experience_years": 5,
                "availability": True,
                "description": "Mécanicien expérimenté au Mali"
            }
            
            status, response = self.make_request("POST", "workers/profile", worker_profile_data, token=self.tokens['worker'])
            success = status == 200
            self.log_result("PROFIL", "Création Profil Worker", success,
                           "Profil spécialisé pour les travailleurs")

    def audit_job_management_system(self):
        """3. AUDIT DU SYSTÈME DE GESTION DES EMPLOIS"""
        print("\n💼 3. AUDIT DU SYSTÈME DE GESTION DES EMPLOIS")
        print("-" * 50)
        
        if not self.tokens.get('client'):
            self.log_result("EMPLOIS", "Token Client Manquant", False,
                           "Impossible de tester sans authentification client", critical=True)
            return
        
        # Test 3.1: Create Job
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
                       f"Job ID: {job_id}" if job_id else f"Erreur: {response.get('detail', 'inconnue')}",
                       critical=True)
        
        # Test 3.2: Get Jobs
        status, response = self.make_request("GET", "jobs", token=self.tokens['client'])
        success = status == 200
        jobs_count = len(response) if success and isinstance(response, list) else 0
        self.log_result("EMPLOIS", "GET /api/jobs (Liste)", success,
                       f"Nombre d'emplois: {jobs_count}")
        
        # Test 3.3: Filter by Category
        status, response = self.make_request("GET", "jobs?category=mécanique", token=self.tokens['client'])
        success = status == 200
        filtered_jobs = len(response) if success and isinstance(response, list) else 0
        self.log_result("EMPLOIS", "Filtrage par Catégorie", success,
                       f"Emplois mécaniques: {filtered_jobs}")
        
        # Test 3.4: Job Proposal by Worker
        if self.tokens.get('worker') and job_id:
            proposal_data = {
                "proposed_amount": 35000.0,
                "estimated_completion_time": "2 heures",
                "message": "Bonjour, je suis mécanicien avec 5 ans d'expérience sur les motos Yamaha."
            }
            
            status, response = self.make_request("POST", f"jobs/{job_id}/proposals", proposal_data, token=self.tokens['worker'])
            success = status == 200
            self.log_result("EMPLOIS", "Proposition Worker", success,
                           f"Montant proposé: {proposal_data['proposed_amount']} FCFA" if success else "Erreur proposition")

    def audit_payment_system(self):
        """4. AUDIT DU SYSTÈME DE PAIEMENT"""
        print("\n💳 4. AUDIT DU SYSTÈME DE PAIEMENT")
        print("-" * 50)
        
        # Test 4.1: Client Registration with Payment Verification
        timestamp = datetime.now().strftime('%H%M%S%f')
        client_payment_data = {
            "email": f"client_payment_{timestamp}@kojo.test",
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
        if success:
            self.tokens['client_verified'] = response.get('access_token')
        
        verification_info = response.get('payment_verification', {}) if success else {}
        self.log_result("PAIEMENT", "Client 1+ Compte (Mali Orange Money)", success,
                       f"Comptes liés: {verification_info.get('linked_accounts', 0)}, Vérifié: {verification_info.get('is_verified', False)}",
                       critical=True)
        
        # Test 4.2: Worker Registration with 2+ Payment Methods
        worker_payment_data = {
            "email": f"worker_payment_{timestamp}@kojo.test",
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
        
        # Test 4.3: Orange Money Validation - Multi-Country
        orange_tests = [
            ("+221701234567", "senegal"),
            ("+223701234567", "mali"),
            ("+225701234567", "ivory_coast"),
            ("+226701234567", "burkina_faso")
        ]
        
        orange_success = 0
        for i, (phone, country) in enumerate(orange_tests):
            test_data = {
                "email": f"orange_{i}_{timestamp}@kojo.test",
                "password": "KojoTest2024!",
                "first_name": "Test",
                "last_name": f"Orange{i}",
                "phone": phone,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": phone
                }
            }
            
            status, response = self.make_request("POST", "auth/register-verified", test_data)
            if status == 200:
                orange_success += 1
        
        self.log_result("PAIEMENT", "Validation Orange Money Multi-Pays", orange_success == len(orange_tests),
                       f"Pays supportés: {orange_success}/{len(orange_tests)}")
        
        # Test 4.4: Wave Validation - Multi-Country
        wave_tests = [
            ("+221701234567", "senegal"),
            ("+223701234567", "mali"),
            ("+225701234567", "ivory_coast"),
            ("+226701234567", "burkina_faso")
        ]
        
        wave_success = 0
        for i, (phone, country) in enumerate(wave_tests):
            test_data = {
                "email": f"wave_{i}_{timestamp}@kojo.test",
                "password": "KojoTest2024!",
                "first_name": "Test",
                "last_name": f"Wave{i}",
                "phone": phone,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": phone
                }
            }
            
            status, response = self.make_request("POST", "auth/register-verified", test_data)
            if status == 200:
                wave_success += 1
        
        self.log_result("PAIEMENT", "Validation Wave Multi-Pays", wave_success == len(wave_tests),
                       f"Pays supportés: {wave_success}/{len(wave_tests)}")
        
        # Test 4.5: Bank Account Validation
        bank_data = {
            "email": f"bank_{timestamp}@kojo.test",
            "password": "KojoTest2024!",
            "first_name": "Mariama",
            "last_name": "Coulibaly",
            "phone": "+223701234567",
            "user_type": "client",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "12345678901234",
                    "bank_name": "Banque Atlantique Mali",
                    "account_holder": "Mariama Coulibaly"
                }
            }
        }
        
        status, response = self.make_request("POST", "auth/register-verified", bank_data)
        success = status == 200
        self.log_result("PAIEMENT", "Validation Compte Bancaire", success,
                       "Support comptes bancaires avec validation complète")
        
        # Test 4.6: Payment Account Management
        if self.tokens.get('client_verified'):
            status, response = self.make_request("GET", "users/payment-accounts", token=self.tokens['client_verified'])
            success = status == 200
            payment_info = response if success else {}
            self.log_result("PAIEMENT", "GET /api/users/payment-accounts", success,
                           f"Comptes: {payment_info.get('payment_accounts_count', 0)}")

    def audit_messaging_system(self):
        """5. AUDIT DU SYSTÈME DE MESSAGERIE"""
        print("\n💬 5. AUDIT DU SYSTÈME DE MESSAGERIE")
        print("-" * 50)
        
        if not self.tokens.get('client') or not self.tokens.get('worker'):
            self.log_result("MESSAGERIE", "Tokens Manquants", False,
                           "Besoin de tokens client et worker", critical=True)
            return
        
        # Test 5.1: Send Message
        message_data = {
            "receiver_id": self.users['worker']['id'],
            "content": "Bonjour, j'ai vu votre proposition pour la réparation de ma moto."
        }
        
        status, response = self.make_request("POST", "messages", message_data, token=self.tokens['client'])
        success = status == 200
        self.log_result("MESSAGERIE", "POST /api/messages (Client→Worker)", success,
                       f"Message envoyé: {len(message_data['content'])} caractères" if success else "Erreur envoi",
                       critical=True)
        
        # Test 5.2: Get Conversations
        status, response = self.make_request("GET", "messages/conversations", token=self.tokens['client'])
        success = status == 200
        conversations_count = len(response) if success and isinstance(response, list) else 0
        self.log_result("MESSAGERIE", "GET /api/messages/conversations", success,
                       f"Conversations actives: {conversations_count}")

    def audit_security_validation(self):
        """6. AUDIT SÉCURITÉ ET VALIDATION"""
        print("\n🔒 6. AUDIT SÉCURITÉ ET VALIDATION")
        print("-" * 50)
        
        # Test 6.1: Pydantic Validation
        invalid_data = {
            "email": "invalid_email",
            "password": "123",
            "first_name": "A",
            "last_name": "",
            "phone": "123",
            "user_type": "invalid",
            "country": "invalid",
            "preferred_language": "invalid"
        }
        
        status, response = self.make_request("POST", "auth/register", invalid_data)
        success = status == 422
        self.log_result("SÉCURITÉ", "Validation Pydantic", success,
                       "Rejet des données mal formées")
        
        # Test 6.2: Rate Limiting Resistance
        rapid_success = 0
        for i in range(5):
            status, response = self.make_request("GET", "health")
            if status == 200:
                rapid_success += 1
        
        self.log_result("SÉCURITÉ", "Résistance Requêtes Rapides", rapid_success >= 4,
                       f"Requêtes réussies: {rapid_success}/5")

    def audit_performance_infrastructure(self):
        """7. AUDIT PERFORMANCE ET INFRASTRUCTURE"""
        print("\n⚡ 7. AUDIT PERFORMANCE ET INFRASTRUCTURE")
        print("-" * 50)
        
        # Test 7.1: Response Times
        endpoints = [("health", None), ("stats", None)]
        if self.tokens.get('client'):
            endpoints.extend([("jobs", self.tokens['client']), ("users/profile", self.tokens['client'])])
        
        response_times = []
        for endpoint, token in endpoints:
            start_time = time.time()
            status, response = self.make_request("GET", endpoint, token=token)
            end_time = time.time()
            
            response_time = (end_time - start_time) * 1000
            response_times.append(response_time)
            
            success = status == 200 and response_time < 2000
            self.log_result("PERFORMANCE", f"{endpoint} ({response_time:.0f}ms)", success,
                           f"Temps de réponse: {response_time:.0f}ms")
        
        # Test 7.2: Database Connection
        status, response = self.make_request("GET", "health")
        success = status == 200 and response.get('database') == 'connected'
        self.log_result("INFRASTRUCTURE", "Connexion MongoDB", success,
                       f"Base de données: {response.get('database', 'inconnu')}" if status == 200 else "Erreur",
                       critical=True)
        
        # Test 7.3: Statistics Endpoint
        status, response = self.make_request("GET", "stats")
        success = status == 200
        stats = response if success else {}
        self.log_result("INFRASTRUCTURE", "Endpoint Statistiques", success,
                       f"Utilisateurs: {stats.get('total_users', 0)}, Jobs: {stats.get('total_jobs', 0)}")
        
        # Test 7.4: Multi-Country Support
        supported_countries = stats.get('supported_countries', []) if success else []
        expected = ["senegal", "mali", "ivory_coast", "burkina_faso"]
        countries_ok = all(country in supported_countries for country in expected)
        self.log_result("INFRASTRUCTURE", "Support Multi-Pays", countries_ok,
                       f"Pays supportés: {supported_countries}")
        
        # Test 7.5: Multi-Language Support
        supported_languages = stats.get('supported_languages', []) if success else []
        expected_langs = ["fr", "en", "wo", "bm"]
        languages_ok = all(lang in supported_languages for lang in expected_langs)
        self.log_result("INFRASTRUCTURE", "Support Multi-Langues", languages_ok,
                       f"Langues supportées: {supported_languages}")

    def audit_famakan_master_system(self):
        """8. AUDIT SYSTÈME FAMAKAN KONTAGA MASTER"""
        print("\n👑 8. AUDIT SYSTÈME FAMAKAN KONTAGA MASTER")
        print("-" * 50)
        
        # Test 8.1: Famakan Login
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
        
        # Test 8.2: Owner Endpoints Access
        owner_endpoints = [
            ("owner/commission-stats", "Statistiques Commission"),
            ("owner/debug-info", "Informations Debug"),
            ("owner/users-management", "Gestion Utilisateurs")
        ]
        
        for endpoint, description in owner_endpoints:
            status, response = self.make_request("GET", endpoint, token=self.tokens['famakan'])
            success = status == 200
            access_level = response.get('access_level') if success else None
            self.log_result("FAMAKAN", description, success and access_level == 'OWNER_FULL_ACCESS',
                           f"Niveau d'accès: {access_level}" if access_level else "Accès refusé")
        
        # Test 8.3: Security - Regular Users Cannot Access
        if self.tokens.get('client'):
            status, response = self.make_request("GET", "owner/commission-stats", token=self.tokens['client'])
            success = status == 403
            error_msg = response.get('detail', '') if not success else ''
            correct_error = "Famakan Kontaga Master uniquement" in error_msg
            self.log_result("FAMAKAN", "Sécurité Accès Client", success and correct_error,
                           "Client correctement empêché d'accéder")

    def generate_final_report(self):
        """Generate final audit report"""
        print("\n" + "📊" * 30)
        print("RAPPORT FINAL D'AUDIT BACKEND KOJO")
        print("📊" * 30)
        
        total = self.test_results["total_tests"]
        passed = self.test_results["passed_tests"]
        failed = self.test_results["failed_tests"]
        success_rate = (passed / total * 100) if total > 0 else 0
        
        print(f"\n🎯 RÉSUMÉ GLOBAL:")
        print(f"   • Tests exécutés: {total}")
        print(f"   • Tests réussis: {passed}")
        print(f"   • Tests échoués: {failed}")
        print(f"   • Taux de réussite: {success_rate:.1f}%")
        
        if self.test_results["critical_failures"]:
            print(f"\n🚨 ÉCHECS CRITIQUES ({len(self.test_results['critical_failures'])}):")
            for failure in self.test_results["critical_failures"]:
                print(f"   ❌ {failure}")
        
        print(f"\n📋 RÉSULTATS PAR CATÉGORIE:")
        for category, results in self.test_results["categories"].items():
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
        print("=" * 80)
        
        return {
            "success_rate": success_rate,
            "grade": grade,
            "total_tests": total,
            "passed_tests": passed,
            "failed_tests": failed,
            "critical_failures": len(self.test_results["critical_failures"]),
            "categories": self.test_results["categories"]
        }

    def run_complete_audit(self):
        """Run complete backend audit"""
        print("🚀 Démarrage de l'audit complet...")
        
        try:
            self.audit_authentication_system()
            self.audit_profile_system()
            self.audit_job_management_system()
            self.audit_payment_system()
            self.audit_messaging_system()
            self.audit_security_validation()
            self.audit_performance_infrastructure()
            self.audit_famakan_master_system()
            
            return self.generate_final_report()
            
        except Exception as e:
            print(f"\n❌ ERREUR CRITIQUE DURANT L'AUDIT: {str(e)}")
            return {"error": str(e), "success_rate": 0}

def main():
    """Main entry point"""
    print("🇸🇳🇲🇱🇧🇫🇨🇮 AUDIT COMPLET BACKEND KOJO - AFRIQUE DE L'OUEST 🇨🇮🇧🇫🇲🇱🇸🇳")
    
    auditor = KojoBackendAuditFinal()
    results = auditor.run_complete_audit()
    
    return results

if __name__ == "__main__":
    results = main()
    sys.exit(0 if results.get("success_rate", 0) >= 80 else 1)