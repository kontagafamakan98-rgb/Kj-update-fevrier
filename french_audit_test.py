#!/usr/bin/env python3
"""
AUDIT COMPLET KOJO - Test Backend selon demande française
Détection et correction de bugs pour l'Afrique de l'Ouest

Test des 5 domaines critiques:
1. GÉOLOCALISATION (Client & Travailleur)
2. COMMUNICATION TRAVAILLEUR ↔ CLIENT  
3. INSCRIPTION & CONNEXION
4. VALIDATION LANGUES (5 langues)
5. EMPLOIS & PAIEMENTS
"""

import requests
import json
import sys
from datetime import datetime, timedelta
import time

class KojoFrenchAuditTester:
    def __init__(self, base_url="https://kojo-work.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.bugs_found = []
        
        # Tokens et utilisateurs de test
        self.client_token = None
        self.worker_token = None
        self.client_user = None
        self.worker_user = None
        
        print("🇫🇷 AUDIT COMPLET KOJO - BACKEND AFRIQUE DE L'OUEST")
        print("=" * 60)
        print(f"Backend URL: {self.base_url}")
        print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 60)

    def log_bug(self, endpoint, error_code, error_message, solution=""):
        """Documenter un bug trouvé"""
        bug = {
            "endpoint": endpoint,
            "code_erreur": error_code,
            "message_erreur": error_message,
            "solution_proposee": solution,
            "timestamp": datetime.now().isoformat()
        }
        self.bugs_found.append(bug)
        print(f"🐛 BUG DÉTECTÉ: {endpoint} - {error_code} - {error_message}")

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None, params=None):
        """Exécuter un test API"""
        url = f"{self.base_url}/{endpoint}"
        if params:
            url += "?" + "&".join([f"{k}={v}" for k, v in params.items()])
            
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: {name}")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ RÉUSSI - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 300:
                        print(f"   Réponse: {response_data}")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ ÉCHEC - Attendu {expected_status}, reçu {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Erreur: {error_data}")
                    self.log_bug(endpoint, response.status_code, str(error_data))
                except:
                    print(f"   Erreur: {response.text}")
                    self.log_bug(endpoint, response.status_code, response.text)
                return False, {}

        except Exception as e:
            print(f"❌ ERREUR - Exception: {str(e)}")
            self.log_bug(endpoint, "EXCEPTION", str(e))
            return False, {}

    def test_1_geolocalisation(self):
        """1. GÉOLOCALISATION (Client & Travailleur)"""
        print("\n" + "="*60)
        print("1. TEST GÉOLOCALISATION - AFRIQUE DE L'OUEST")
        print("="*60)
        
        # Test GET /api/geolocation/detect (sans paramètre)
        self.run_test(
            "Détection géolocalisation automatique",
            "GET", 
            "geolocation/detect",
            200
        )
        
        # Test avec numéros de téléphone des 4 pays
        pays_tests = [
            ("+221771234567", "Sénégal"),
            ("+223701234567", "Mali"), 
            ("+226701234567", "Burkina Faso"),
            ("+225071234567", "Côte d'Ivoire")
        ]
        
        for phone, pays in pays_tests:
            self.run_test(
                f"Détection géolocalisation {pays}",
                "GET",
                "geolocation/detect",
                200,
                params={"phone": phone}
            )
        
        # Test GET /api/geolocation/countries
        self.run_test(
            "Liste des pays supportés",
            "GET",
            "geolocation/countries", 
            200
        )
        
        # Test POST /api/geolocation/validate-phone
        for phone, pays in pays_tests:
            self.run_test(
                f"Validation téléphone {pays}",
                "POST",
                "geolocation/validate-phone",
                200,
                data={"phone": phone, "country": pays.lower()}
            )

    def test_2_inscription_connexion(self):
        """3. INSCRIPTION & CONNEXION"""
        print("\n" + "="*60)
        print("2. TEST INSCRIPTION & CONNEXION")
        print("="*60)
        
        # Créer un client
        timestamp = datetime.now().strftime('%H%M%S')
        client_data = {
            "email": f"client_audit_{timestamp}@test.com",
            "password": "MotDePasse123!",
            "first_name": "Aminata",
            "last_name": "Diallo", 
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Inscription client avec tous les champs",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            self.client_user = response['user']
            print(f"   Client créé: {self.client_user['id']}")
        
        # Créer un travailleur avec spécialités
        worker_data = {
            "email": f"worker_audit_{timestamp}@test.com", 
            "password": "MotDePasse123!",
            "first_name": "Mamadou",
            "last_name": "Traoré",
            "phone": "+223701234567",
            "user_type": "worker", 
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Inscription travailleur avec spécialités",
            "POST",
            "auth/register", 
            200,
            data=worker_data
        )
        
        if success and 'access_token' in response:
            self.worker_token = response['access_token']
            self.worker_user = response['user']
            print(f"   Travailleur créé: {self.worker_user['id']}")
        
        # Test validation mot de passe < 6 caractères (doit échouer)
        invalid_password_data = client_data.copy()
        invalid_password_data["email"] = f"invalid_pwd_{timestamp}@test.com"
        invalid_password_data["password"] = "123"
        
        self.run_test(
            "Validation mot de passe < 6 caractères (doit échouer)",
            "POST",
            "auth/register",
            422,  # Erreur de validation
            data=invalid_password_data
        )
        
        # Test validation email invalide (doit échouer)
        invalid_email_data = client_data.copy()
        invalid_email_data["email"] = "email_invalide"
        invalid_email_data["password"] = "MotDePasse123!"
        
        self.run_test(
            "Validation email invalide (doit échouer)",
            "POST", 
            "auth/register",
            422,  # Erreur de validation
            data=invalid_email_data
        )
        
        # Test connexion avec identifiants valides
        if self.client_user:
            login_data = {
                "email": self.client_user['email'],
                "password": "MotDePasse123!"
            }
            
            self.run_test(
                "Connexion identifiants valides",
                "POST",
                "auth/login",
                200,
                data=login_data
            )
        
        # Test connexion avec identifiants invalides
        if self.client_user:
            invalid_login_data = {
                "email": self.client_user['email'],
                "password": "mauvais_mot_de_passe"
            }
            
            self.run_test(
                "Connexion identifiants invalides (doit échouer)",
                "POST",
                "auth/login", 
                401,
                data=invalid_login_data
            )
        
        # Test GET /api/users/profile avec token valide
        if self.client_token:
            self.run_test(
                "Profil utilisateur avec token valide",
                "GET",
                "users/profile",
                200,
                token=self.client_token
            )
        
        # Test GET /api/users/profile sans token (doit retourner 401/403)
        self.run_test(
            "Profil utilisateur sans token (doit échouer)",
            "GET", 
            "users/profile",
            403  # FastAPI retourne 403 pour auth manquante
        )

    def test_3_validation_langues(self):
        """4. VALIDATION LANGUES (5 langues)"""
        print("\n" + "="*60)
        print("3. TEST VALIDATION LANGUES (5 LANGUES)")
        print("="*60)
        
        # Vérifier que les 5 langues sont acceptées
        langues_supportees = ["fr", "en", "wo", "bm", "mos"]
        
        for langue in langues_supportees:
            if self.client_token:
                update_data = {"preferred_language": langue}
                
                self.run_test(
                    f"Mise à jour langue préférée: {langue}",
                    "PUT",
                    "users/profile",
                    200,
                    data=update_data,
                    token=self.client_token
                )
        
        # Test spécifique pour le Mooré (langue du Burkina Faso)
        if self.client_token:
            update_data = {"preferred_language": "mos"}
            
            self.run_test(
                "Validation langue Mooré (Burkina Faso)",
                "PUT",
                "users/profile", 
                200,
                data=update_data,
                token=self.client_token
            )

    def test_4_emplois_paiements(self):
        """5. EMPLOIS & PAIEMENTS"""
        print("\n" + "="*60)
        print("4. TEST EMPLOIS & PAIEMENTS")
        print("="*60)
        
        # Test création emploi
        if self.client_token:
            job_data = {
                "title": "Réparation moto - Dakar",
                "description": "Besoin d'un mécanicien pour réparer ma moto Honda. Problème de démarrage et freins à vérifier.",
                "category": "mécanique_moto",
                "budget_min": 25000.0,
                "budget_max": 50000.0,
                "location": {
                    "address": "Plateau, Dakar, Sénégal",
                    "latitude": 14.6937,
                    "longitude": -17.4441,
                    "city": "Dakar",
                    "district": "Plateau"
                },
                "required_skills": ["mécanique", "moto", "diagnostic"],
                "estimated_duration": "2-3 heures"
            }
            
            success, response = self.run_test(
                "Création emploi mécanique moto",
                "POST",
                "jobs",
                200,
                data=job_data,
                token=self.client_token
            )
            
            if success and 'id' in response:
                job_id = response['id']
                print(f"   Emploi créé: {job_id}")
        
        # Test liste emplois
        if self.client_token:
            self.run_test(
                "Liste des emplois",
                "GET",
                "jobs",
                200,
                token=self.client_token
            )
        
        # Test validation Orange Money pour les 4 pays
        orange_money_tests = [
            ("+221771234567", "Sénégal"),
            ("+223701234567", "Mali"),
            ("+226701234567", "Burkina Faso"), 
            ("+225071234567", "Côte d'Ivoire")
        ]
        
        for phone, pays in orange_money_tests:
            # Simuler validation Orange Money
            validation_data = {
                "payment_method": "orange_money",
                "phone_number": phone,
                "country": pays.lower()
            }
            
            self.run_test(
                f"Validation Orange Money {pays}",
                "POST",
                "payments/validate-orange-money",
                200,
                data=validation_data
            )
        
        # Test validation Wave pour les 4 pays
        wave_tests = [
            ("+221771234567", "Sénégal"),
            ("+223701234567", "Mali"),
            ("+226701234567", "Burkina Faso"),
            ("+225071234567", "Côte d'Ivoire")
        ]
        
        for phone, pays in wave_tests:
            # Simuler validation Wave
            validation_data = {
                "payment_method": "wave", 
                "phone_number": phone,
                "country": pays.lower()
            }
            
            self.run_test(
                f"Validation Wave {pays}",
                "POST",
                "payments/validate-wave",
                200,
                data=validation_data
            )

    def test_5_communication_travailleur_client(self):
        """2. COMMUNICATION TRAVAILLEUR ↔ CLIENT"""
        print("\n" + "="*60)
        print("5. TEST COMMUNICATION TRAVAILLEUR ↔ CLIENT")
        print("="*60)
        
        if not self.client_token or not self.worker_token or not self.worker_user:
            print("❌ Impossible de tester la communication - tokens manquants")
            return
        
        # 1. Envoyer un message du client au travailleur
        message_data = {
            "receiver_id": self.worker_user['id'],
            "content": "Bonjour, j'ai vu votre profil et j'aimerais vous proposer un travail de mécanique moto à Dakar. Êtes-vous disponible cette semaine ?"
        }
        
        self.run_test(
            "Envoi message client → travailleur",
            "POST",
            "messages",
            200,
            data=message_data,
            token=self.client_token
        )
        
        # 2. Vérifier les messages reçus (côté travailleur)
        self.run_test(
            "Récupération messages (travailleur)",
            "GET", 
            "messages",
            200,
            token=self.worker_token
        )
        
        # 3. Vérifier les conversations (côté client)
        self.run_test(
            "Liste conversations (client)",
            "GET",
            "messages/conversations",
            200,
            token=self.client_token
        )
        
        # 4. Répondre au message (travailleur → client)
        if self.client_user:
            response_message_data = {
                "receiver_id": self.client_user['id'],
                "content": "Bonjour ! Oui, je suis disponible cette semaine. J'ai 5 ans d'expérience en mécanique moto. Pouvez-vous me donner plus de détails sur le problème ?"
            }
            
            self.run_test(
                "Réponse message travailleur → client",
                "POST",
                "messages", 
                200,
                data=response_message_data,
                token=self.worker_token
            )
        
        # 5. Vérifier les conversations (côté travailleur)
        self.run_test(
            "Liste conversations (travailleur)",
            "GET",
            "messages/conversations",
            200,
            token=self.worker_token
        )

    def test_additional_backend_endpoints(self):
        """Tests supplémentaires des endpoints backend"""
        print("\n" + "="*60)
        print("6. TESTS SUPPLÉMENTAIRES BACKEND")
        print("="*60)
        
        # Test health check
        self.run_test(
            "Health check backend",
            "GET",
            "health",
            200
        )
        
        # Test endpoint racine
        self.run_test(
            "Endpoint racine",
            "GET",
            "",
            200
        )
        
        # Test endpoints avec authentification requise
        protected_endpoints = [
            ("users/profile", "GET"),
            ("jobs", "GET"),
            ("messages", "GET"),
            ("messages/conversations", "GET")
        ]
        
        for endpoint, method in protected_endpoints:
            self.run_test(
                f"Endpoint protégé sans auth: {endpoint}",
                method,
                endpoint,
                403  # Doit retourner 403 sans token
            )

    def generate_bug_report(self):
        """Générer le rapport de bugs"""
        print("\n" + "="*60)
        print("📋 RAPPORT DE BUGS DÉTECTÉ")
        print("="*60)
        
        if not self.bugs_found:
            print("✅ AUCUN BUG CRITIQUE DÉTECTÉ!")
            return
        
        print(f"🐛 {len(self.bugs_found)} BUGS DÉTECTÉS:")
        print()
        
        for i, bug in enumerate(self.bugs_found, 1):
            print(f"{i}. ENDPOINT: {bug['endpoint']}")
            print(f"   CODE ERREUR: {bug['code_erreur']}")
            print(f"   MESSAGE: {bug['message_erreur']}")
            if bug['solution_proposee']:
                print(f"   SOLUTION: {bug['solution_proposee']}")
            print(f"   TIMESTAMP: {bug['timestamp']}")
            print()

    def run_complete_audit(self):
        """Exécuter l'audit complet"""
        start_time = time.time()
        
        print("🚀 DÉMARRAGE AUDIT COMPLET KOJO BACKEND")
        print()
        
        # Exécuter tous les tests dans l'ordre
        self.test_1_geolocalisation()
        self.test_2_inscription_connexion()
        self.test_3_validation_langues()
        self.test_4_emplois_paiements()
        self.test_5_communication_travailleur_client()
        self.test_additional_backend_endpoints()
        
        # Générer le rapport final
        end_time = time.time()
        duration = end_time - start_time
        
        print("\n" + "="*60)
        print("📊 RÉSULTATS AUDIT COMPLET KOJO")
        print("="*60)
        print(f"Tests exécutés: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Tests échoués: {self.tests_run - self.tests_passed}")
        print(f"Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        print(f"Durée: {duration:.2f} secondes")
        print(f"Bugs détectés: {len(self.bugs_found)}")
        
        # Générer le rapport de bugs
        self.generate_bug_report()
        
        # Recommandations finales
        print("\n" + "="*60)
        print("🎯 RECOMMANDATIONS FINALES")
        print("="*60)
        
        if self.tests_passed / self.tests_run >= 0.9:
            print("✅ EXCELLENT: Backend Kojo prêt pour production")
            print("   - Taux de réussite > 90%")
            print("   - Fonctionnalités critiques opérationnelles")
        elif self.tests_passed / self.tests_run >= 0.8:
            print("⚠️  BON: Backend Kojo nécessite corrections mineures")
            print("   - Taux de réussite > 80%")
            print("   - Quelques ajustements nécessaires")
        else:
            print("❌ CRITIQUE: Backend Kojo nécessite corrections majeures")
            print("   - Taux de réussite < 80%")
            print("   - Corrections importantes requises")
        
        print("\n🇫🇷 AUDIT COMPLET KOJO TERMINÉ")
        return self.tests_passed / self.tests_run >= 0.8

if __name__ == "__main__":
    tester = KojoFrenchAuditTester()
    success = tester.run_complete_audit()
    sys.exit(0 if success else 1)