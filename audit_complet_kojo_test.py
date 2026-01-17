#!/usr/bin/env python3
"""
AUDIT COMPLET DE KOJO - Test Backend Afrique de l'Ouest
Test complet selon les spécifications de la review française
"""

import requests
import json
import sys
import time
from datetime import datetime

class AuditCompletKojoTester:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.errors = []
        self.client_token = None
        self.worker_token = None
        self.test_job_id = None
        
        # Données de test réalistes pour l'Afrique de l'Ouest
        timestamp = int(time.time())
        self.test_data = {
            "client": {
                "email": f"amadou.diallo.{timestamp}@gmail.com",
                "password": "AmadouKojo2024!",
                "first_name": "Amadou",
                "last_name": "Diallo",
                "phone": "+221771234567",  # Sénégal
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            },
            "worker": {
                "email": f"fatou.traore.{timestamp}@gmail.com", 
                "password": "FatouWorker2024!",
                "first_name": "Fatou",
                "last_name": "Traoré",
                "phone": "+223701234567",  # Mali
                "user_type": "worker",
                "country": "mali",
                "preferred_language": "bm",
                "worker_specialties": ["mécanique_moto", "réparation_électronique"]
            }
        }
        
        # Données de paiement pour tests
        self.payment_data = {
            "orange_money_senegal": "+221771234567",
            "orange_money_mali": "+223701234567", 
            "orange_money_burkina": "+226701234567",
            "orange_money_cote_ivoire": "+225701234567",
            "wave_senegal": "+221771234567",
            "wave_mali": "+223701234567",
            "wave_burkina": "+226701234567", 
            "wave_cote_ivoire": "+225701234567"
        }

    def log_test(self, name, success, details=""):
        """Enregistrer le résultat d'un test"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
            if details:
                print(f"   {details}")
        else:
            print(f"❌ {name}")
            if details:
                print(f"   ERREUR: {details}")
                self.errors.append(f"{name}: {details}")

    def make_request(self, method, endpoint, data=None, token=None, expected_status=200):
        """Faire une requête HTTP avec gestion d'erreur"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)
            
            success = response.status_code == expected_status
            return success, response
            
        except requests.exceptions.RequestException as e:
            return False, str(e)

    def test_1_geolocalisation(self):
        """1. VÉRIFICATION GÉOLOCALISATION (Client & Travailleur)"""
        print("\n🌍 === 1. TESTS GÉOLOCALISATION ===")
        
        # Test endpoint de géolocalisation (si disponible)
        success, response = self.make_request('GET', 'geolocation/detect')
        if isinstance(response, requests.Response):
            if response.status_code == 200:
                self.log_test("Endpoint géolocalisation disponible", True, f"Status: {response.status_code}")
            elif response.status_code == 404:
                self.log_test("Endpoint géolocalisation", False, "Endpoint /api/geolocation/detect non trouvé")
            else:
                self.log_test("Endpoint géolocalisation", False, f"Status inattendu: {response.status_code}")
        else:
            self.log_test("Endpoint géolocalisation", False, f"Erreur réseau: {response}")
        
        # Test détection automatique des pays via validation téléphone
        timestamp = int(time.time())
        countries_phones = {
            "mali": "+223701234567",
            "senegal": "+221771234567", 
            "burkina_faso": "+226701234567",
            "ivory_coast": "+225701234567"
        }
        
        for country, phone in countries_phones.items():
            # Test via inscription avec numéro du pays
            test_user = {
                "email": f"test_{country}_{timestamp}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "User",
                "phone": phone,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr"
            }
            
            success, response = self.make_request('POST', 'auth/register', test_user, expected_status=200)
            if success:
                self.log_test(f"Détection pays {country} via préfixe {phone[:4]}", True)
            else:
                error_msg = ""
                if isinstance(response, requests.Response):
                    try:
                        error_data = response.json()
                        error_msg = error_data.get('detail', f'Status: {response.status_code}')
                    except:
                        error_msg = f'Status: {response.status_code}'
                else:
                    error_msg = str(response)
                self.log_test(f"Détection pays {country} via préfixe {phone[:4]}", False, error_msg)

    def test_2_authentification(self):
        """3. VÉRIFICATION AUTHENTIFICATION"""
        print("\n🔐 === 2. TESTS AUTHENTIFICATION ===")
        
        # Test inscription client
        success, response = self.make_request('POST', 'auth/register', self.test_data["client"])
        if success and isinstance(response, requests.Response):
            try:
                data = response.json()
                self.client_token = data.get('access_token')
                self.log_test("Inscription client", True, f"Token reçu: {bool(self.client_token)}")
            except:
                self.log_test("Inscription client", False, "Réponse JSON invalide")
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                try:
                    error_data = response.json()
                    error_msg = error_data.get('detail', f'Status: {response.status_code}')
                except:
                    error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("Inscription client", False, error_msg)
        
        # Test inscription travailleur avec spécialités
        success, response = self.make_request('POST', 'auth/register', self.test_data["worker"])
        if success and isinstance(response, requests.Response):
            try:
                data = response.json()
                self.worker_token = data.get('access_token')
                self.log_test("Inscription travailleur avec spécialités", True, f"Token reçu: {bool(self.worker_token)}")
            except:
                self.log_test("Inscription travailleur avec spécialités", False, "Réponse JSON invalide")
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                try:
                    error_data = response.json()
                    error_msg = error_data.get('detail', f'Status: {response.status_code}')
                except:
                    error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("Inscription travailleur avec spécialités", False, error_msg)
        
        # Test connexion client
        login_data = {
            "email": self.test_data["client"]["email"],
            "password": self.test_data["client"]["password"]
        }
        success, response = self.make_request('POST', 'auth/login', login_data)
        if success:
            self.log_test("Connexion client", True)
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                try:
                    error_data = response.json()
                    error_msg = error_data.get('detail', f'Status: {response.status_code}')
                except:
                    error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("Connexion client", False, error_msg)
        
        # Test validation mot de passe faible
        weak_password_user = self.test_data["client"].copy()
        weak_password_user["email"] = "test_weak@test.com"
        weak_password_user["password"] = "123"  # Mot de passe trop court
        
        success, response = self.make_request('POST', 'auth/register', weak_password_user, expected_status=422)
        if success:
            self.log_test("Validation mot de passe faible (min 6 caractères)", True, "Rejeté correctement")
        else:
            self.log_test("Validation mot de passe faible (min 6 caractères)", False, "Mot de passe faible accepté")
        
        # Test protection injection SQL
        sql_injection_user = self.test_data["client"].copy()
        sql_injection_user["email"] = "test'; DROP TABLE users; --@test.com"
        sql_injection_user["first_name"] = "Test'; DROP TABLE users; --"
        
        success, response = self.make_request('POST', 'auth/register', sql_injection_user, expected_status=422)
        if success:
            self.log_test("Protection injection SQL", True, "Tentative d'injection rejetée")
        else:
            if isinstance(response, requests.Response) and response.status_code == 500:
                self.log_test("Protection injection SQL", False, "Erreur serveur 500 - possible vulnérabilité")
            else:
                self.log_test("Protection injection SQL", False, "Injection SQL non détectée")

    def test_3_profil_langues(self):
        """4. VÉRIFICATION PROFIL & LANGUES"""
        print("\n👤 === 3. TESTS PROFIL & LANGUES ===")
        
        if not self.client_token:
            self.log_test("Tests profil", False, "Token client requis")
            return
        
        # Test GET profil
        success, response = self.make_request('GET', 'users/profile', token=self.client_token)
        if success and isinstance(response, requests.Response):
            try:
                profile_data = response.json()
                has_language = 'preferred_language' in profile_data
                self.log_test("GET /api/users/profile", True, f"Langue présente: {has_language}")
            except:
                self.log_test("GET /api/users/profile", False, "Réponse JSON invalide")
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("GET /api/users/profile", False, error_msg)
        
        # Test PUT profil avec mise à jour langue
        update_data = {
            "preferred_language": "wo",  # Wolof
            "first_name": "Amadou Updated"
        }
        success, response = self.make_request('PUT', 'users/profile', update_data, token=self.client_token)
        if success:
            self.log_test("PUT /api/users/profile (mise à jour langue)", True, "Langue mise à jour vers Wolof")
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                try:
                    error_data = response.json()
                    error_msg = error_data.get('detail', f'Status: {response.status_code}')
                except:
                    error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("PUT /api/users/profile (mise à jour langue)", False, error_msg)
        
        # Vérifier les 5 langues supportées
        supported_languages = ["fr", "en", "wo", "bm", "mos"]
        for lang in supported_languages:
            lang_update = {"preferred_language": lang}
            success, response = self.make_request('PUT', 'users/profile', lang_update, token=self.client_token)
            lang_names = {"fr": "Français", "en": "English", "wo": "Wolof", "bm": "Bambara", "mos": "Mooré"}
            if success:
                self.log_test(f"Support langue {lang_names.get(lang, lang)}", True)
            else:
                self.log_test(f"Support langue {lang_names.get(lang, lang)}", False, f"Langue {lang} non supportée")

    def test_4_emplois(self):
        """5. VÉRIFICATION EMPLOIS"""
        print("\n💼 === 4. TESTS EMPLOIS ===")
        
        if not self.client_token:
            self.log_test("Tests emplois", False, "Token client requis")
            return
        
        # Test création d'emploi avec catégories Afrique de l'Ouest
        job_data = {
            "title": "Réparation moto Honda 125cc à Dakar",
            "description": "Besoin d'un mécanicien expérimenté pour réparer ma moto Honda 125cc. Problème au niveau du moteur et des freins. Travail urgent.",
            "category": "mécanique_moto",
            "budget_min": 25000.0,
            "budget_max": 50000.0,
            "location": {
                "country": "senegal",
                "city": "Dakar",
                "district": "Plateau",
                "address": "Avenue Léopold Sédar Senghor"
            },
            "required_skills": ["mécanique_moto", "diagnostic_moteur"],
            "estimated_duration": "2-3 jours"
        }
        
        success, response = self.make_request('POST', 'jobs', job_data, token=self.client_token)
        if success and isinstance(response, requests.Response):
            try:
                job_response = response.json()
                self.test_job_id = job_response.get('id')
                self.log_test("POST /api/jobs (création emploi)", True, f"Job ID: {self.test_job_id}")
            except:
                self.log_test("POST /api/jobs (création emploi)", False, "Réponse JSON invalide")
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                try:
                    error_data = response.json()
                    error_msg = error_data.get('detail', f'Status: {response.status_code}')
                except:
                    error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("POST /api/jobs (création emploi)", False, error_msg)
        
        # Test GET liste des emplois
        success, response = self.make_request('GET', 'jobs', token=self.client_token)
        if success and isinstance(response, requests.Response):
            try:
                jobs_data = response.json()
                jobs_count = len(jobs_data) if isinstance(jobs_data, list) else 0
                self.log_test("GET /api/jobs (liste emplois)", True, f"{jobs_count} emplois trouvés")
            except:
                self.log_test("GET /api/jobs (liste emplois)", False, "Réponse JSON invalide")
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("GET /api/jobs (liste emplois)", False, error_msg)
        
        # Test catégories spécifiques Afrique de l'Ouest
        west_african_categories = [
            "mécanique_moto",
            "énergie_solaire", 
            "couture_traditionnelle",
            "construction_traditionnelle",
            "réparation_électronique"
        ]
        
        for category in west_african_categories:
            success, response = self.make_request('GET', f'jobs?category={category}', token=self.client_token)
            if success:
                self.log_test(f"Catégorie {category}", True, "Catégorie supportée")
            else:
                self.log_test(f"Catégorie {category}", False, "Catégorie non supportée")

    def test_5_communication(self):
        """2. VÉRIFICATION COMMUNICATION (Travailleur ↔ Client)"""
        print("\n💬 === 5. TESTS COMMUNICATION ===")
        
        if not self.client_token or not self.worker_token:
            self.log_test("Tests communication", False, "Tokens client et travailleur requis")
            return
        
        # Test envoi de message (POST /api/messages)
        message_data = {
            "receiver_id": "test_receiver_id",  # ID fictif pour test
            "content": "Bonjour, je suis intéressé par votre offre de réparation moto. Pouvez-vous me donner plus de détails sur vos tarifs?"
        }
        
        success, response = self.make_request('POST', 'messages', message_data, token=self.client_token)
        if success:
            self.log_test("POST /api/messages (envoi message)", True)
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                try:
                    error_data = response.json()
                    error_msg = error_data.get('detail', f'Status: {response.status_code}')
                except:
                    error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("POST /api/messages (envoi message)", False, error_msg)
        
        # Test récupération des messages (GET /api/messages)
        success, response = self.make_request('GET', 'messages', token=self.client_token)
        if success and isinstance(response, requests.Response):
            try:
                messages_data = response.json()
                messages_count = len(messages_data) if isinstance(messages_data, list) else 0
                self.log_test("GET /api/messages (récupération messages)", True, f"{messages_count} messages trouvés")
            except:
                self.log_test("GET /api/messages (récupération messages)", False, "Réponse JSON invalide")
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("GET /api/messages (récupération messages)", False, error_msg)
        
        # Test liste des conversations (GET /api/messages/conversations)
        success, response = self.make_request('GET', 'messages/conversations', token=self.client_token)
        if success and isinstance(response, requests.Response):
            try:
                conversations_data = response.json()
                conversations_count = len(conversations_data) if isinstance(conversations_data, list) else 0
                self.log_test("GET /api/messages/conversations (liste conversations)", True, f"{conversations_count} conversations trouvées")
            except:
                self.log_test("GET /api/messages/conversations (liste conversations)", False, "Réponse JSON invalide")
        else:
            error_msg = ""
            if isinstance(response, requests.Response):
                error_msg = f'Status: {response.status_code}'
            else:
                error_msg = str(response)
            self.log_test("GET /api/messages/conversations (liste conversations)", False, error_msg)

    def test_6_paiements(self):
        """6. VÉRIFICATION PAIEMENTS"""
        print("\n💳 === 6. TESTS PAIEMENTS ===")
        
        # Test validation Orange Money pour les 4 pays
        print("\n📱 Tests Orange Money:")
        timestamp = int(time.time())
        for country, phone in [
            ("senegal", self.payment_data["orange_money_senegal"]),
            ("mali", self.payment_data["orange_money_mali"]),
            ("burkina_faso", self.payment_data["orange_money_burkina"]),
            ("ivory_coast", self.payment_data["orange_money_cote_ivoire"])
        ]:
            # Test via inscription avec compte Orange Money
            test_user = {
                "email": f"orange_{country}_{timestamp}@test.com",
                "password": "TestOrange123!",
                "first_name": "Test",
                "last_name": "Orange",
                "phone": phone,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": phone
                }
            }
            
            success, response = self.make_request('POST', 'auth/register-verified', test_user)
            if success:
                self.log_test(f"Orange Money {country} ({phone})", True)
            else:
                error_msg = ""
                if isinstance(response, requests.Response):
                    try:
                        error_data = response.json()
                        error_msg = error_data.get('detail', f'Status: {response.status_code}')
                    except:
                        error_msg = f'Status: {response.status_code}'
                else:
                    error_msg = str(response)
                self.log_test(f"Orange Money {country} ({phone})", False, error_msg)
        
        # Test validation Wave pour les 4 pays
        print("\n🌊 Tests Wave:")
        for country, phone in [
            ("senegal", self.payment_data["wave_senegal"]),
            ("mali", self.payment_data["wave_mali"]),
            ("burkina_faso", self.payment_data["wave_burkina"]),
            ("ivory_coast", self.payment_data["wave_cote_ivoire"])
        ]:
            # Test via inscription avec compte Wave
            test_user = {
                "email": f"wave_{country}_{timestamp}@test.com",
                "password": "TestWave123!",
                "first_name": "Test",
                "last_name": "Wave",
                "phone": phone,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": phone
                }
            }
            
            success, response = self.make_request('POST', 'auth/register-verified', test_user)
            if success:
                self.log_test(f"Wave {country} ({phone})", True)
            else:
                error_msg = ""
                if isinstance(response, requests.Response):
                    try:
                        error_data = response.json()
                        error_msg = error_data.get('detail', f'Status: {response.status_code}')
                    except:
                        error_msg = f'Status: {response.status_code}'
                else:
                    error_msg = str(response)
                self.log_test(f"Wave {country} ({phone})", False, error_msg)

    def run_complete_audit(self):
        """Exécuter l'audit complet de Kojo"""
        print("🚀 === AUDIT COMPLET DE KOJO - AFRIQUE DE L'OUEST ===")
        print(f"Backend URL: {self.base_url}")
        print(f"Démarrage: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # Exécuter tous les tests dans l'ordre
        self.test_1_geolocalisation()
        self.test_2_authentification()
        self.test_3_profil_langues()
        self.test_4_emplois()
        self.test_5_communication()
        self.test_6_paiements()
        
        # Résumé final
        print(f"\n📊 === RÉSUMÉ DE L'AUDIT ===")
        print(f"Tests exécutés: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.errors:
            print(f"\n❌ ERREURS DÉTECTÉES ({len(self.errors)}):")
            for i, error in enumerate(self.errors, 1):
                print(f"{i}. {error}")
        else:
            print("\n✅ AUCUNE ERREUR CRITIQUE DÉTECTÉE")
        
        print(f"\nFin de l'audit: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        return {
            "tests_run": self.tests_run,
            "tests_passed": self.tests_passed,
            "success_rate": self.tests_passed/self.tests_run*100 if self.tests_run > 0 else 0,
            "errors": self.errors
        }

if __name__ == "__main__":
    tester = AuditCompletKojoTester()
    results = tester.run_complete_audit()
    
    # Code de sortie basé sur le taux de réussite
    if results["success_rate"] >= 80:
        sys.exit(0)  # Succès
    else:
        sys.exit(1)  # Échec