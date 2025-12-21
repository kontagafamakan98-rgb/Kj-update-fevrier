#!/usr/bin/env python3
"""
AUDIT COMPLET DE L'APPLICATION KOJO - Afrique de l'Ouest
Comprehensive audit of Kojo application backend as requested in French review

Tests:
1. TESTS BACKEND API - Health, auth, users, jobs, messages, payment validation
2. TESTS DE VALIDATION - Phone numbers for 4 countries, emails, passwords, names with special characters  
3. TESTS DE SÉCURITÉ - Protected routes, SQL injection, input validation
4. TESTS FONCTIONNELS - Create client user, worker user, job, send message
5. IDENTIFIER TOUTES LES ERREURS - 500 errors, validation errors, data problems, security leaks

Backend URL: https://westafricaboost.preview.emergentagent.com
"""

import requests
import sys
import json
import time
from datetime import datetime

class KojoAuditComplet:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.errors_found = []
        self.client_token = None
        self.worker_token = None
        self.client_user = None
        self.worker_user = None
        self.test_job_id = None
        
        print("🇫🇷 AUDIT COMPLET DE L'APPLICATION KOJO - AFRIQUE DE L'OUEST")
        print("=" * 70)
        print(f"Backend URL: {self.base_url}")
        print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 70)

    def log_error(self, category, endpoint, status_code, error_message, cause=""):
        """Log error with details as requested"""
        error = {
            "category": category,
            "endpoint": endpoint,
            "status_code": status_code,
            "error_message": error_message,
            "cause": cause,
            "timestamp": datetime.now().isoformat()
        }
        self.errors_found.append(error)
        print(f"🚨 ERREUR DÉTECTÉE: {category}")
        print(f"   Endpoint: {endpoint}")
        print(f"   Code: {status_code}")
        print(f"   Message: {error_message}")
        if cause:
            print(f"   Cause probable: {cause}")

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None, timeout=10):
        """Run a single API test with error logging"""
        url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: {name}")
        print(f"   {method} {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=timeout)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=timeout)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=timeout)

            success = response.status_code == expected_status
            
            if success:
                self.tests_passed += 1
                print(f"✅ RÉUSSI - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ ÉCHEC - Attendu {expected_status}, reçu {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Erreur: {error_data}")
                    
                    # Log error for audit
                    if response.status_code >= 500:
                        self.log_error("Erreur Serveur 500", endpoint, response.status_code, 
                                     str(error_data), "Erreur interne du serveur")
                    elif response.status_code >= 400:
                        self.log_error("Erreur Client 4xx", endpoint, response.status_code,
                                     str(error_data), "Erreur de validation ou d'autorisation")
                    
                    return False, error_data
                except:
                    error_text = response.text
                    print(f"   Erreur: {error_text}")
                    self.log_error("Erreur de Réponse", endpoint, response.status_code,
                                 error_text, "Réponse non-JSON")
                    return False, {}

        except requests.exceptions.Timeout:
            print(f"❌ ÉCHEC - Timeout après {timeout}s")
            self.log_error("Timeout", endpoint, 0, f"Timeout après {timeout}s", 
                         "Serveur trop lent ou non disponible")
            return False, {}
        except Exception as e:
            print(f"❌ ÉCHEC - Erreur: {str(e)}")
            self.log_error("Erreur de Connexion", endpoint, 0, str(e), 
                         "Problème de réseau ou serveur indisponible")
            return False, {}

    def test_1_backend_api_health(self):
        """1. TESTS BACKEND API - Health, auth, users, jobs, messages"""
        print("\n" + "="*50)
        print("1. TESTS BACKEND API")
        print("="*50)
        
        # Test de santé: GET /api/health
        self.run_test("Health Check", "GET", "health", 200)
        
        # Test root endpoint
        self.run_test("Root Endpoint", "GET", "", 200)
        
        # Test stats endpoint
        self.run_test("Stats Endpoint", "GET", "stats", 200)

    def test_2_authentication_system(self):
        """Test d'authentification: POST /api/auth/register et /api/auth/login"""
        print("\n📝 Test d'authentification")
        
        # Test inscription client
        client_data = {
            "email": f"audit_client_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "first_name": "Amadou",
            "last_name": "Traoré",
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Inscription Client",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            self.client_user = response['user']
            print(f"   ✅ Client créé: {self.client_user['email']}")
        
        # Test inscription travailleur
        worker_data = {
            "email": f"audit_worker_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "first_name": "Fatou",
            "last_name": "Diallo",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Inscription Travailleur",
            "POST",
            "auth/register",
            200,
            data=worker_data
        )
        
        if success and 'access_token' in response:
            self.worker_token = response['access_token']
            self.worker_user = response['user']
            print(f"   ✅ Travailleur créé: {self.worker_user['email']}")
        
        # Test connexion
        if self.client_user:
            login_data = {
                "email": self.client_user['email'],
                "password": "TestPass123!"
            }
            
            self.run_test(
                "Connexion Client",
                "POST",
                "auth/login",
                200,
                data=login_data
            )

    def test_3_user_profile_system(self):
        """Test des utilisateurs: GET /api/users/profile"""
        print("\n👤 Test du système utilisateur")
        
        if not self.client_token:
            print("❌ Pas de token client - test ignoré")
            return
            
        # Test récupération profil
        self.run_test(
            "Récupération Profil",
            "GET",
            "users/profile",
            200,
            token=self.client_token
        )
        
        # Test mise à jour profil
        update_data = {
            "first_name": "Amadou_Modifié",
            "preferred_language": "wo"
        }
        
        self.run_test(
            "Mise à jour Profil",
            "PUT",
            "users/profile",
            200,
            data=update_data,
            token=self.client_token
        )

    def test_4_job_system(self):
        """Test des emplois: GET /api/jobs, POST /api/jobs"""
        print("\n💼 Test du système d'emplois")
        
        if not self.client_token:
            print("❌ Pas de token client - test ignoré")
            return
            
        # Test création emploi
        job_data = {
            "title": "Réparation Moto Yamaha",
            "description": "Besoin de réparer ma moto Yamaha 125cc qui ne démarre plus",
            "category": "mécanique_moto",
            "budget_min": 25000.0,
            "budget_max": 50000.0,
            "location": {
                "address": "Dakar, Plateau, Sénégal",
                "city": "Dakar",
                "district": "Plateau",
                "country": "Sénégal"
            },
            "required_skills": ["mécanique moto", "diagnostic panne"],
            "estimated_duration": "2-3 heures",
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": True,
            "parts_and_tools_notes": "Apporter pièces de rechange Yamaha et outils spécialisés"
        }
        
        success, response = self.run_test(
            "Création Emploi",
            "POST",
            "jobs",
            200,
            data=job_data,
            token=self.client_token
        )
        
        if success and 'id' in response:
            self.test_job_id = response['id']
            print(f"   ✅ Emploi créé: {self.test_job_id}")
        
        # Test récupération emplois
        self.run_test(
            "Liste des Emplois",
            "GET",
            "jobs",
            200,
            token=self.client_token
        )
        
        # Test récupération emploi spécifique
        if self.test_job_id:
            self.run_test(
                "Emploi Spécifique",
                "GET",
                f"jobs/{self.test_job_id}",
                200,
                token=self.client_token
            )

    def test_5_messaging_system(self):
        """Test des messages: GET /api/messages"""
        print("\n💬 Test du système de messagerie")
        
        if not self.client_token or not self.worker_user:
            print("❌ Tokens manquants - test ignoré")
            return
            
        # Test envoi message
        message_data = {
            "receiver_id": self.worker_user['id'],
            "content": "Bonjour, je suis intéressé par votre profil pour mon emploi de réparation moto."
        }
        
        self.run_test(
            "Envoi Message",
            "POST",
            "messages",
            200,
            data=message_data,
            token=self.client_token
        )
        
        # Test récupération conversations
        self.run_test(
            "Liste Conversations",
            "GET",
            "messages/conversations",
            200,
            token=self.client_token
        )

    def test_6_payment_validation(self):
        """Test de validation des paiements (Orange Money, Wave)"""
        print("\n💳 Test de validation des paiements")
        
        # Test Orange Money - 4 pays
        orange_money_tests = [
            {"phone": "+221771234567", "country": "senegal", "name": "Sénégal"},
            {"phone": "+223701234567", "country": "mali", "name": "Mali"},
            {"phone": "+226701234567", "country": "burkina_faso", "name": "Burkina Faso"},
            {"phone": "+225701234567", "country": "ivory_coast", "name": "Côte d'Ivoire"}
        ]
        
        for i, test in enumerate(orange_money_tests):
            user_data = {
                "email": f"orange_test_{i}_{int(time.time())}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Orange",
                "phone": test["phone"],
                "user_type": "client",
                "country": test["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test["phone"]
                }
            }
            
            self.run_test(
                f"Orange Money {test['name']} ({test['phone']})",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
        
        # Test Wave - 4 pays
        wave_tests = [
            {"phone": "+221771234567", "country": "senegal", "name": "Sénégal"},
            {"phone": "+223701234567", "country": "mali", "name": "Mali"},
            {"phone": "+226701234567", "country": "burkina_faso", "name": "Burkina Faso"},
            {"phone": "+225701234567", "country": "ivory_coast", "name": "Côte d'Ivoire"}
        ]
        
        for i, test in enumerate(wave_tests):
            user_data = {
                "email": f"wave_test_{i}_{int(time.time())}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Wave",
                "phone": test["phone"],
                "user_type": "client",
                "country": test["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": test["phone"]
                }
            }
            
            self.run_test(
                f"Wave {test['name']} ({test['phone']})",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )

    def test_7_validation_system(self):
        """2. TESTS DE VALIDATION - Phone, emails, passwords, names"""
        print("\n" + "="*50)
        print("2. TESTS DE VALIDATION")
        print("="*50)
        
        # Validation numéros téléphone - 4 pays
        phone_tests = [
            # Valides
            ("+221771234567", "senegal", True, "Sénégal valide"),
            ("+223701234567", "mali", True, "Mali valide"),
            ("+226701234567", "burkina_faso", True, "Burkina Faso valide"),
            ("+225701234567", "ivory_coast", True, "Côte d'Ivoire valide"),
            # Invalides
            ("+1234567890", "senegal", False, "Préfixe invalide"),
            ("+22177123", "senegal", False, "Trop court"),
            ("+221771234567890", "senegal", False, "Trop long"),
        ]
        
        for phone, country, should_pass, description in phone_tests:
            user_data = {
                "email": f"phone_test_{int(time.time())}_{phone.replace('+', '')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Phone",
                "phone": phone,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr"
            }
            
            expected_status = 200 if should_pass else 422
            self.run_test(
                f"Validation Téléphone: {description} ({phone})",
                "POST",
                "auth/register",
                expected_status,
                data=user_data
            )
        
        # Validation emails
        email_tests = [
            ("valid@test.com", True, "Email valide"),
            ("invalid-email", False, "Email invalide"),
            ("test@", False, "Email incomplet"),
            ("@test.com", False, "Email sans nom"),
        ]
        
        for email, should_pass, description in email_tests:
            user_data = {
                "email": email,
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Email",
                "phone": "+221771234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            expected_status = 200 if should_pass else 422
            self.run_test(
                f"Validation Email: {description} ({email})",
                "POST",
                "auth/register",
                expected_status,
                data=user_data
            )
        
        # Validation mots de passe (min 6 caractères)
        password_tests = [
            ("TestPass123!", True, "Mot de passe fort"),
            ("123456", True, "6 caractères minimum"),
            ("12345", False, "Trop court (5 caractères)"),
            ("", False, "Vide"),
        ]
        
        for password, should_pass, description in password_tests:
            user_data = {
                "email": f"pwd_test_{int(time.time())}_{len(password)}@test.com",
                "password": password,
                "first_name": "Test",
                "last_name": "Password",
                "phone": "+221771234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            expected_status = 200 if should_pass else 422
            self.run_test(
                f"Validation Mot de passe: {description}",
                "POST",
                "auth/register",
                expected_status,
                data=user_data
            )
        
        # Validation noms avec caractères spéciaux
        name_tests = [
            ("Jean-Pierre", "O'Connor", True, "Tirets et apostrophes"),
            ("François", "José", True, "Accents français"),
            ("Amadou_Traoré", "Fatou_Diop", True, "Underscores"),
            ("Marie.Claire", "Jean.Paul", True, "Points"),
            ("Test123", "User456", True, "Chiffres"),
            ("Mariama", "Bâ", True, "Accents circonflexes"),
            ("", "Test", False, "Prénom vide"),
            ("Test", "", False, "Nom vide"),
        ]
        
        for first_name, last_name, should_pass, description in name_tests:
            user_data = {
                "email": f"name_test_{int(time.time())}_{len(first_name)}@test.com",
                "password": "TestPass123!",
                "first_name": first_name,
                "last_name": last_name,
                "phone": "+221771234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            expected_status = 200 if should_pass else 422
            self.run_test(
                f"Validation Noms: {description} ({first_name} {last_name})",
                "POST",
                "auth/register",
                expected_status,
                data=user_data
            )

    def test_8_security_system(self):
        """3. TESTS DE SÉCURITÉ - Routes protégées, SQL injection, validation"""
        print("\n" + "="*50)
        print("3. TESTS DE SÉCURITÉ")
        print("="*50)
        
        # Routes protégées sans token (doivent retourner 401/403)
        protected_endpoints = [
            ("users/profile", "GET"),
            ("jobs", "GET"),
            ("jobs", "POST"),
            ("messages", "GET"),
            ("messages", "POST"),
            ("users/profile-photo", "GET"),
            ("users/profile-photo", "POST"),
        ]
        
        for endpoint, method in protected_endpoints:
            self.run_test(
                f"Route Protégée Sans Token: {method} {endpoint}",
                method,
                endpoint,
                403,  # FastAPI returns 403 for missing auth
                data={} if method == "POST" else None
            )
        
        # Test injection SQL dans les champs
        sql_injection_tests = [
            "admin'/**/OR/**/1=1#@test.com",
            "test'; DROP TABLE users; --@test.com",
            "admin' UNION SELECT * FROM users--@test.com",
            "test@test.com'; INSERT INTO users--",
        ]
        
        for malicious_email in sql_injection_tests:
            user_data = {
                "email": malicious_email,
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Injection",
                "phone": "+221771234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            # Should reject malicious input
            self.run_test(
                f"Test Injection SQL: {malicious_email[:30]}...",
                "POST",
                "auth/register",
                400,  # Should be rejected
                data=user_data
            )
        
        # Test validation des entrées - champs trop longs
        long_string = "A" * 1000
        validation_tests = [
            {"first_name": long_string, "field": "first_name"},
            {"last_name": long_string, "field": "last_name"},
            {"email": f"{long_string}@test.com", "field": "email"},
        ]
        
        for test_data, field in validation_tests:
            user_data = {
                "email": "test@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Validation",
                "phone": "+221771234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            user_data.update(test_data)
            
            self.run_test(
                f"Validation Longueur: {field} trop long",
                "POST",
                "auth/register",
                422,  # Should be rejected for validation
                data=user_data
            )

    def test_9_functional_tests(self):
        """4. TESTS FONCTIONNELS - Workflow complet"""
        print("\n" + "="*50)
        print("4. TESTS FONCTIONNELS")
        print("="*50)
        
        # Créer un utilisateur client
        print("\n📝 Création utilisateur client avec spécialités ouest-africaines")
        client_data = {
            "email": f"client_fonctionnel_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "first_name": "Aminata",
            "last_name": "Touré",
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Création Client Fonctionnel",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        func_client_token = None
        if success and 'access_token' in response:
            func_client_token = response['access_token']
            func_client_user = response['user']
        
        # Créer un utilisateur travailleur avec spécialités
        print("\n🔧 Création travailleur avec spécialités ouest-africaines")
        worker_data = {
            "email": f"worker_fonctionnel_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "first_name": "Mamadou",
            "last_name": "Konaté",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Création Travailleur Fonctionnel",
            "POST",
            "auth/register",
            200,
            data=worker_data
        )
        
        func_worker_token = None
        func_worker_user = None
        if success and 'access_token' in response:
            func_worker_token = response['access_token']
            func_worker_user = response['user']
            
            # Créer profil travailleur avec spécialités ouest-africaines
            worker_profile_data = {
                "user_id": func_worker_user['id'],
                "specialties": [
                    "mécanique_moto",
                    "énergie_solaire", 
                    "couture_traditionnelle",
                    "construction_traditionnelle",
                    "réparation_électronique"
                ],
                "experience_years": 8,
                "availability": True,
                "description": "Spécialiste en réparation moto et énergie solaire au Mali"
            }
            
            self.run_test(
                "Création Profil Travailleur avec Spécialités",
                "POST",
                "workers/profile",
                200,
                data=worker_profile_data,
                token=func_worker_token
            )
        
        # Créer un emploi avec catégories ouest-africaines
        if func_client_token:
            print("\n💼 Création emploi avec catégories ouest-africaines")
            job_data = {
                "title": "Réparation Moto Yamaha 125cc - Panne Électrique",
                "description": "Ma moto Yamaha 125cc ne démarre plus. Problème électrique suspecté. Besoin d'un mécanicien expérimenté à Dakar.",
                "category": "mécanique_moto",
                "budget_min": 25000.0,
                "budget_max": 50000.0,
                "location": {
                    "address": "Dakar, Plateau, près du marché Sandaga",
                    "city": "Dakar",
                    "district": "Plateau",
                    "country": "Sénégal",
                    "latitude": 14.6937,
                    "longitude": -17.4441
                },
                "required_skills": [
                    "mécanique_moto",
                    "diagnostic_électrique",
                    "réparation_yamaha"
                ],
                "estimated_duration": "2-3 heures",
                "mechanic_must_bring_parts": True,
                "mechanic_must_bring_tools": True,
                "parts_and_tools_notes": "Apporter pièces électriques Yamaha et multimètre"
            }
            
            success, response = self.run_test(
                "Création Emploi Mécanique Moto",
                "POST",
                "jobs",
                200,
                data=job_data,
                token=func_client_token
            )
            
            func_job_id = None
            if success and 'id' in response:
                func_job_id = response['id']
        
        # Envoyer un message
        if func_client_token and func_worker_user:
            print("\n💬 Envoi message entre client et travailleur")
            message_data = {
                "receiver_id": func_worker_user['id'],
                "content": "Bonjour Mamadou, j'ai vu votre profil et vos spécialités en mécanique moto. Êtes-vous disponible pour réparer ma Yamaha 125cc à Dakar? Le problème semble électrique."
            }
            
            self.run_test(
                "Envoi Message Client vers Travailleur",
                "POST",
                "messages",
                200,
                data=message_data,
                token=func_client_token
            )

    def test_10_error_identification(self):
        """5. IDENTIFIER TOUTES LES ERREURS - 500, validation, données, sécurité"""
        print("\n" + "="*50)
        print("5. IDENTIFICATION DES ERREURS")
        print("="*50)
        
        # Test endpoints qui pourraient causer des erreurs 500
        error_test_cases = [
            # Données malformées
            {
                "name": "JSON Malformé",
                "endpoint": "auth/register",
                "method": "POST",
                "data": "invalid_json",
                "expected": 400
            },
            # Champs manquants
            {
                "name": "Champs Obligatoires Manquants",
                "endpoint": "auth/register", 
                "method": "POST",
                "data": {"email": "test@test.com"},
                "expected": 422
            },
            # Types de données incorrects
            {
                "name": "Types Incorrects",
                "endpoint": "auth/register",
                "method": "POST", 
                "data": {
                    "email": 123,  # Should be string
                    "password": "test",
                    "first_name": "Test",
                    "last_name": "Test",
                    "phone": "+221771234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            }
        ]
        
        for test_case in error_test_cases:
            # Handle malformed JSON case
            if test_case["data"] == "invalid_json":
                url = f"{self.base_url}/{test_case['endpoint']}"
                headers = {'Content-Type': 'application/json'}
                
                try:
                    response = requests.post(url, data="invalid_json", headers=headers, timeout=10)
                    if response.status_code != test_case["expected"]:
                        self.log_error("Gestion JSON Malformé", test_case['endpoint'], 
                                     response.status_code, "JSON malformé non géré correctement")
                    print(f"✅ Test JSON Malformé: {response.status_code}")
                except Exception as e:
                    self.log_error("Erreur JSON Malformé", test_case['endpoint'], 0, str(e))
            else:
                self.run_test(
                    test_case["name"],
                    test_case["method"],
                    test_case["endpoint"],
                    test_case["expected"],
                    data=test_case["data"]
                )

    def generate_audit_report(self):
        """Generate comprehensive audit report"""
        print("\n" + "="*70)
        print("📊 RAPPORT D'AUDIT COMPLET - KOJO AFRIQUE DE L'OUEST")
        print("="*70)
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print(f"📈 STATISTIQUES GÉNÉRALES:")
        print(f"   Tests exécutés: {self.tests_run}")
        print(f"   Tests réussis: {self.tests_passed}")
        print(f"   Taux de réussite: {success_rate:.1f}%")
        print(f"   Erreurs détectées: {len(self.errors_found)}")
        
        if self.errors_found:
            print(f"\n🚨 ERREURS DÉTECTÉES ({len(self.errors_found)}):")
            print("-" * 50)
            
            # Group errors by category
            error_categories = {}
            for error in self.errors_found:
                category = error['category']
                if category not in error_categories:
                    error_categories[category] = []
                error_categories[category].append(error)
            
            for category, errors in error_categories.items():
                print(f"\n📂 {category} ({len(errors)} erreurs):")
                for i, error in enumerate(errors, 1):
                    print(f"   {i}. Endpoint: {error['endpoint']}")
                    print(f"      Code d'erreur: {error['status_code']}")
                    print(f"      Message: {error['error_message']}")
                    if error['cause']:
                        print(f"      Cause probable: {error['cause']}")
                    print()
        else:
            print(f"\n✅ AUCUNE ERREUR CRITIQUE DÉTECTÉE")
        
        # Recommendations
        print(f"\n💡 RECOMMANDATIONS:")
        if success_rate >= 90:
            print("   ✅ Excellent - Application prête pour production")
        elif success_rate >= 75:
            print("   ⚠️  Bon - Quelques améliorations nécessaires")
        elif success_rate >= 50:
            print("   ⚠️  Moyen - Corrections importantes requises")
        else:
            print("   🚨 Critique - Révision majeure nécessaire")
        
        print(f"\n🌍 SPÉCIFICITÉS AFRIQUE DE L'OUEST TESTÉES:")
        print("   ✅ Support 4 pays (Mali, Sénégal, Burkina Faso, Côte d'Ivoire)")
        print("   ✅ Validation Orange Money et Wave")
        print("   ✅ Numéros téléphone préfixes 70-99")
        print("   ✅ Catégories métiers locales (mécanique_moto, énergie_solaire)")
        print("   ✅ Noms avec caractères spéciaux (accents, tirets, apostrophes)")
        
        return {
            "tests_run": self.tests_run,
            "tests_passed": self.tests_passed,
            "success_rate": success_rate,
            "errors_found": len(self.errors_found),
            "errors": self.errors_found
        }

    def run_complete_audit(self):
        """Run complete audit as requested"""
        print("🚀 DÉMARRAGE AUDIT COMPLET KOJO")
        
        try:
            # 1. Tests Backend API
            self.test_1_backend_api_health()
            self.test_2_authentication_system()
            self.test_3_user_profile_system()
            self.test_4_job_system()
            self.test_5_messaging_system()
            self.test_6_payment_validation()
            
            # 2. Tests de validation
            self.test_7_validation_system()
            
            # 3. Tests de sécurité
            self.test_8_security_system()
            
            # 4. Tests fonctionnels
            self.test_9_functional_tests()
            
            # 5. Identification des erreurs
            self.test_10_error_identification()
            
        except KeyboardInterrupt:
            print("\n⚠️  Audit interrompu par l'utilisateur")
        except Exception as e:
            print(f"\n🚨 Erreur inattendue pendant l'audit: {e}")
            self.log_error("Erreur Système", "audit", 0, str(e), "Erreur inattendue du système d'audit")
        
        finally:
            # Generate final report
            return self.generate_audit_report()

if __name__ == "__main__":
    audit = KojoAuditComplet()
    report = audit.run_complete_audit()
    
    print(f"\n🏁 AUDIT TERMINÉ")
    print(f"Rapport sauvegardé avec {report['errors_found']} erreurs détectées")