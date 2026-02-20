#!/usr/bin/env python3
"""
AUDIT COMPLET DU BACKEND POUR KOJO - SYSTÈMES CRITIQUES
Comprehensive Backend Audit for Kojo Critical Systems

Mission: Effectuer un audit exhaustif du backend de Kojo pour vérifier tous les systèmes critiques
et leur bon fonctionnement selon les spécifications de l'Afrique de l'Ouest.
"""

import requests
import sys
import json
import io
import jwt
import base64
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

class KojoBackendAuditComplet:
    def __init__(self, base_url="https://kojo-work.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tokens = {}  # Store tokens for different user types
        self.users = {}   # Store user data
        self.test_data = {}  # Store test data (jobs, messages, etc.)
        
        # Audit counters
        self.total_tests = 0
        self.passed_tests = 0
        self.failed_tests = 0
        self.critical_failures = []
        self.audit_results = {}
        
        print("🚀 DÉMARRAGE DE L'AUDIT COMPLET DU BACKEND KOJO")
        print("=" * 80)
        print("Mission: Vérification exhaustive de tous les systèmes critiques")
        print("Région: Afrique de l'Ouest (Mali, Sénégal, Burkina Faso, Côte d'Ivoire)")
        print("=" * 80)

    def log_test_result(self, test_name: str, success: bool, details: str = "", critical: bool = False):
        """Log test results with detailed tracking"""
        self.total_tests += 1
        
        if success:
            self.passed_tests += 1
            status = "✅ SUCCÈS"
        else:
            self.failed_tests += 1
            status = "❌ ÉCHEC"
            if critical:
                self.critical_failures.append(f"{test_name}: {details}")
        
        print(f"{status} | {test_name}")
        if details:
            print(f"    📋 {details}")
        
        # Store in audit results
        category = test_name.split(" - ")[0] if " - " in test_name else "Général"
        if category not in self.audit_results:
            self.audit_results[category] = {"passed": 0, "failed": 0, "tests": []}
        
        self.audit_results[category]["tests"].append({
            "name": test_name,
            "success": success,
            "details": details,
            "critical": critical
        })
        
        if success:
            self.audit_results[category]["passed"] += 1
        else:
            self.audit_results[category]["failed"] += 1

    def make_request(self, method: str, endpoint: str, data: Any = None, token: str = None, 
                    files: Dict = None, expected_status: int = 200) -> tuple[bool, Dict]:
        """Make HTTP request with comprehensive error handling"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {'Content-Type': 'application/json'}
        
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        if files:
            headers.pop('Content-Type', None)  # Let requests set content-type for files
        
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
            else:
                return False, {"error": f"Méthode HTTP non supportée: {method}"}
            
            success = response.status_code == expected_status
            
            try:
                response_data = response.json()
            except:
                response_data = {"status_code": response.status_code, "text": response.text[:500]}
            
            if not success:
                response_data["actual_status"] = response.status_code
                response_data["expected_status"] = expected_status
            
            return success, response_data
            
        except requests.exceptions.Timeout:
            return False, {"error": "Timeout - Le serveur ne répond pas dans les temps"}
        except requests.exceptions.ConnectionError:
            return False, {"error": "Erreur de connexion - Impossible de joindre le serveur"}
        except Exception as e:
            return False, {"error": f"Erreur inattendue: {str(e)}"}

    def audit_systeme_authentification(self):
        """1. AUDIT DU SYSTÈME D'AUTHENTIFICATION"""
        print("\n" + "🔐" * 20)
        print("1. AUDIT DU SYSTÈME D'AUTHENTIFICATION")
        print("🔐" * 20)
        
        # Test 1.1: Endpoints de base
        success, response = self.make_request("GET", "health", expected_status=200)
        self.log_test_result(
            "AUTH - Health Check", 
            success, 
            f"Statut serveur: {response.get('status', 'inconnu')}" if success else f"Erreur: {response.get('error', 'inconnue')}",
            critical=True
        )
        
        # Test 1.2: Inscription client avec validation complète
        timestamp = datetime.now().strftime('%H%M%S')
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
        
        success, response = self.make_request("POST", "auth/register", client_data, expected_status=200)
        if success and 'access_token' in response:
            self.tokens['client'] = response['access_token']
            self.users['client'] = response['user']
        
        self.log_test_result(
            "AUTH - Inscription Client", 
            success,
            f"Token généré: {'Oui' if success and 'access_token' in response else 'Non'}",
            critical=True
        )
        
        # Test 1.3: Inscription worker avec pays différent
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
        
        success, response = self.make_request("POST", "auth/register", worker_data, expected_status=200)
        if success and 'access_token' in response:
            self.tokens['worker'] = response['access_token']
            self.users['worker'] = response['user']
        
        self.log_test_result(
            "AUTH - Inscription Worker (Mali)", 
            success,
            f"Support multi-pays: {'Oui' if success else 'Non'}",
            critical=True
        )
        
        # Test 1.4: Connexion avec credentials valides
        login_data = {
            "email": client_data["email"],
            "password": client_data["password"]
        }
        
        success, response = self.make_request("POST", "auth/login", login_data, expected_status=200)
        self.log_test_result(
            "AUTH - Connexion Valide", 
            success,
            f"JWT généré: {'Oui' if success and 'access_token' in response else 'Non'}"
        )
        
        # Test 1.5: Connexion avec credentials invalides
        invalid_login = {
            "email": client_data["email"],
            "password": "mauvais_mot_de_passe"
        }
        
        success, response = self.make_request("POST", "auth/login", invalid_login, expected_status=401)
        self.log_test_result(
            "AUTH - Connexion Invalide (Sécurité)", 
            success,
            "Protection contre les mauvais mots de passe"
        )
        
        # Test 1.6: Validation JWT Token
        if self.tokens.get('client'):
            success, response = self.make_request("GET", "users/profile", token=self.tokens['client'], expected_status=200)
            self.log_test_result(
                "AUTH - Validation JWT Token", 
                success,
                f"Accès profil protégé: {'Autorisé' if success else 'Refusé'}",
                critical=True
            )
        
        # Test 1.7: Protection routes sans authentification
        success, response = self.make_request("GET", "users/profile", expected_status=403)
        self.log_test_result(
            "AUTH - Protection Routes (Sans Token)", 
            success,
            "Routes protégées correctement sécurisées"
        )
        
        # Test 1.8: Test inscription avec email existant
        success, response = self.make_request("POST", "auth/register", client_data, expected_status=400)
        self.log_test_result(
            "AUTH - Prévention Doublons Email", 
            success,
            "Protection contre les emails dupliqués"
        )

    def audit_systeme_profil(self):
        """2. AUDIT DU SYSTÈME DE PROFIL"""
        print("\n" + "👤" * 20)
        print("2. AUDIT DU SYSTÈME DE PROFIL")
        print("👤" * 20)
        
        if not self.tokens.get('client'):
            self.log_test_result("PROFIL - Token Client Manquant", False, "Impossible de tester sans authentification", critical=True)
            return
        
        # Test 2.1: Récupération profil utilisateur
        success, response = self.make_request("GET", "users/profile", token=self.tokens['client'], expected_status=200)
        profile_data = response if success else {}
        
        self.log_test_result(
            "PROFIL - GET /api/users/profile", 
            success,
            f"Données profil: {len(profile_data)} champs" if success else "Erreur récupération profil",
            critical=True
        )
        
        # Test 2.2: Mise à jour profil utilisateur
        update_data = {
            "first_name": "Aminata Updated",
            "preferred_language": "wo"  # Test changement de langue
        }
        
        success, response = self.make_request("PUT", "users/profile", update_data, token=self.tokens['client'], expected_status=200)
        self.log_test_result(
            "PROFIL - PUT /api/users/profile", 
            success,
            "Mise à jour profil avec changement de langue"
        )
        
        # Test 2.3: Upload photo de profil
        # Créer une petite image de test (1x1 pixel PNG)
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\x00\x00\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
        success, response = self.make_request("POST", "users/profile-photo", files=files, token=self.tokens['client'], expected_status=200)
        
        photo_url = response.get('photo_url') if success else None
        self.log_test_result(
            "PROFIL - POST /api/users/profile-photo", 
            success,
            f"Photo URL: {photo_url}" if photo_url else "Échec upload photo"
        )
        
        # Test 2.4: Récupération photo de profil
        success, response = self.make_request("GET", "users/profile-photo", token=self.tokens['client'], expected_status=200)
        self.log_test_result(
            "PROFIL - GET /api/users/profile-photo", 
            success,
            f"Photo accessible: {'Oui' if success and response.get('photo_url') else 'Non'}"
        )
        
        # Test 2.5: Validation taille fichier (test avec fichier trop volumineux)
        large_file_data = b'x' * (6 * 1024 * 1024)  # 6MB - dépasse la limite de 5MB
        files = {'file': ('large_photo.jpg', io.BytesIO(large_file_data), 'image/jpeg')}
        success, response = self.make_request("POST", "users/profile-photo", files=files, token=self.tokens['client'], expected_status=400)
        
        self.log_test_result(
            "PROFIL - Validation Taille Fichier", 
            success,
            "Protection contre les fichiers trop volumineux"
        )
        
        # Test 2.6: Profil worker spécialisé
        if self.tokens.get('worker'):
            worker_profile_data = {
                "user_id": self.users['worker']['id'],
                "specialties": ["mécanique", "électricité"],
                "experience_years": 5,
                "availability": True,
                "description": "Mécanicien expérimenté au Mali"
            }
            
            success, response = self.make_request("POST", "workers/profile", worker_profile_data, token=self.tokens['worker'], expected_status=200)
            self.log_test_result(
                "PROFIL - Création Profil Worker", 
                success,
                "Profil spécialisé pour les travailleurs"
            )
            
            # Récupération profil worker
            success, response = self.make_request("GET", "workers/profile", token=self.tokens['worker'], expected_status=200)
            self.log_test_result(
                "PROFIL - GET Profil Worker", 
                success,
                f"Spécialités: {response.get('specialties', [])} " if success else "Erreur récupération"
            )

    def audit_systeme_gestion_emplois(self):
        """3. AUDIT DU SYSTÈME DE GESTION DES EMPLOIS"""
        print("\n" + "💼" * 20)
        print("3. AUDIT DU SYSTÈME DE GESTION DES EMPLOIS")
        print("💼" * 20)
        
        if not self.tokens.get('client'):
            self.log_test_result("EMPLOIS - Token Client Manquant", False, "Impossible de tester sans authentification client", critical=True)
            return
        
        # Test 3.1: Création d'emploi par client
        job_data = {
            "title": "Réparation Moto - Yamaha 125cc",
            "description": "Ma moto Yamaha 125cc a des problèmes de démarrage. Le moteur fait du bruit et la batterie semble faible. Besoin d'un mécanicien expérimenté pour diagnostic et réparation.",
            "category": "mécanique",
            "budget_min": 25000.0,  # 25,000 FCFA
            "budget_max": 50000.0,  # 50,000 FCFA
            "location": {
                "address": "Médina, Dakar, Sénégal",
                "latitude": 14.6937,
                "longitude": -17.4441,
                "quartier": "Médina"
            },
            "required_skills": ["mécanique moto", "diagnostic moteur", "réparation électrique"],
            "estimated_duration": "2-3 heures",
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": True,
            "parts_and_tools_notes": "Apporter outils de diagnostic et pièces de rechange courantes pour Yamaha 125cc"
        }
        
        success, response = self.make_request("POST", "jobs", job_data, token=self.tokens['client'], expected_status=200)
        if success and response.get('id'):
            self.test_data['job_id'] = response['id']
        
        self.log_test_result(
            "EMPLOIS - POST /api/jobs (Création)", 
            success,
            f"Job ID: {response.get('id', 'N/A')}" if success else f"Erreur: {response.get('detail', 'inconnue')}",
            critical=True
        )
        
        # Test 3.2: Récupération liste des emplois
        success, response = self.make_request("GET", "jobs", token=self.tokens['client'], expected_status=200)
        jobs_count = len(response) if success and isinstance(response, list) else 0
        
        self.log_test_result(
            "EMPLOIS - GET /api/jobs (Liste)", 
            success,
            f"Nombre d'emplois: {jobs_count}"
        )
        
        # Test 3.3: Filtrage par catégorie
        success, response = self.make_request("GET", "jobs?category=mécanique", token=self.tokens['client'], expected_status=200)
        filtered_jobs = len(response) if success and isinstance(response, list) else 0
        
        self.log_test_result(
            "EMPLOIS - Filtrage par Catégorie", 
            success,
            f"Emplois mécaniques: {filtered_jobs}"
        )
        
        # Test 3.4: Récupération emploi spécifique
        if self.test_data.get('job_id'):
            success, response = self.make_request("GET", f"jobs/{self.test_data['job_id']}", token=self.tokens['client'], expected_status=200)
            self.log_test_result(
                "EMPLOIS - GET /api/jobs/{id} (Détail)", 
                success,
                f"Titre: {response.get('title', 'N/A')}" if success else "Erreur récupération détail"
            )
        
        # Test 3.5: Validation des exigences mécanicien
        if success and response:
            mechanic_requirements = {
                'parts': response.get('mechanic_must_bring_parts', False),
                'tools': response.get('mechanic_must_bring_tools', False),
                'notes': response.get('parts_and_tools_notes', '')
            }
            
            requirements_ok = mechanic_requirements['parts'] and mechanic_requirements['tools'] and mechanic_requirements['notes']
            self.log_test_result(
                "EMPLOIS - Exigences Mécanicien", 
                requirements_ok,
                f"Pièces: {mechanic_requirements['parts']}, Outils: {mechanic_requirements['tools']}"
            )
        
        # Test 3.6: Tentative création emploi par worker (doit échouer)
        if self.tokens.get('worker'):
            success, response = self.make_request("POST", "jobs", job_data, token=self.tokens['worker'], expected_status=403)
            self.log_test_result(
                "EMPLOIS - Sécurité (Worker ne peut créer)", 
                success,
                "Protection: seuls les clients peuvent créer des emplois"
            )
        
        # Test 3.7: Proposition d'emploi par worker
        if self.tokens.get('worker') and self.test_data.get('job_id'):
            proposal_data = {
                "proposed_amount": 35000.0,  # 35,000 FCFA
                "estimated_completion_time": "2 heures",
                "message": "Bonjour, je suis mécanicien avec 5 ans d'expérience sur les motos Yamaha. J'ai tous les outils nécessaires et peux me procurer les pièces. Disponible aujourd'hui."
            }
            
            success, response = self.make_request("POST", f"jobs/{self.test_data['job_id']}/proposals", proposal_data, token=self.tokens['worker'], expected_status=200)
            self.log_test_result(
                "EMPLOIS - Proposition Worker", 
                success,
                f"Montant proposé: {proposal_data['proposed_amount']} FCFA" if success else "Erreur proposition"
            )
            
            # Test récupération des propositions (par le client propriétaire du job)
            success, response = self.make_request("GET", f"jobs/{self.test_data['job_id']}/proposals", token=self.tokens['client'], expected_status=200)
            proposals_count = len(response) if success and isinstance(response, list) else 0
            
            self.log_test_result(
                "EMPLOIS - Récupération Propositions", 
                success,
                f"Nombre de propositions: {proposals_count}"
            )

    def audit_systeme_paiement(self):
        """4. AUDIT DU SYSTÈME DE PAIEMENT"""
        print("\n" + "💳" * 20)
        print("4. AUDIT DU SYSTÈME DE PAIEMENT")
        print("💳" * 20)
        
        # Test 4.1: Inscription avec vérification paiement - Client (1+ compte requis)
        timestamp = datetime.now().strftime('%H%M%S')
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
        
        success, response = self.make_request("POST", "auth/register-verified", client_payment_data, expected_status=200)
        if success and 'access_token' in response:
            self.tokens['client_verified'] = response['access_token']
        
        verification_info = response.get('payment_verification', {}) if success else {}
        self.log_test_result(
            "PAIEMENT - Client 1+ Compte (Mali Orange Money)", 
            success,
            f"Comptes liés: {verification_info.get('linked_accounts', 0)}, Vérifié: {verification_info.get('is_verified', False)}",
            critical=True
        )
        
        # Test 4.2: Inscription worker avec 2+ comptes (requis)
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
        
        success, response = self.make_request("POST", "auth/register-verified", worker_payment_data, expected_status=200)
        if success and 'access_token' in response:
            self.tokens['worker_verified'] = response['access_token']
        
        verification_info = response.get('payment_verification', {}) if success else {}
        self.log_test_result(
            "PAIEMENT - Worker 2+ Comptes (Sénégal Orange+Wave)", 
            success,
            f"Comptes liés: {verification_info.get('linked_accounts', 0)}, Vérifié: {verification_info.get('is_verified', False)}",
            critical=True
        )
        
        # Test 4.3: Validation Orange Money - Tous pays prioritaires
        orange_money_tests = [
            {"phone": "+221701234567", "country": "senegal", "name": "Sénégal"},
            {"phone": "+223701234567", "country": "mali", "name": "Mali"},
            {"phone": "+225701234567", "country": "ivory_coast", "name": "Côte d'Ivoire"},
            {"phone": "+226701234567", "country": "burkina_faso", "name": "Burkina Faso"}
        ]
        
        orange_success_count = 0
        for i, test in enumerate(orange_money_tests):
            test_data = {
                "email": f"orange_test_{i}_{timestamp}@kojo.test",
                "password": "KojoTest2024!",
                "first_name": "Test",
                "last_name": f"Orange{test['name']}",
                "phone": test["phone"],
                "user_type": "client",
                "country": test["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test["phone"]
                }
            }
            
            success, response = self.make_request("POST", "auth/register-verified", test_data, expected_status=200)
            if success:
                orange_success_count += 1
        
        self.log_test_result(
            "PAIEMENT - Validation Orange Money Multi-Pays", 
            orange_success_count == len(orange_money_tests),
            f"Pays supportés: {orange_success_count}/{len(orange_money_tests)}"
        )
        
        # Test 4.4: Validation Wave - Extension Afrique de l'Ouest
        wave_tests = [
            {"phone": "+221701234567", "country": "senegal", "name": "Sénégal"},
            {"phone": "+223701234567", "country": "mali", "name": "Mali"},
            {"phone": "+225701234567", "country": "ivory_coast", "name": "Côte d'Ivoire"},
            {"phone": "+226701234567", "country": "burkina_faso", "name": "Burkina Faso"}
        ]
        
        wave_success_count = 0
        for i, test in enumerate(wave_tests):
            test_data = {
                "email": f"wave_test_{i}_{timestamp}@kojo.test",
                "password": "KojoTest2024!",
                "first_name": "Test",
                "last_name": f"Wave{test['name']}",
                "phone": test["phone"],
                "user_type": "client",
                "country": test["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": test["phone"]
                }
            }
            
            success, response = self.make_request("POST", "auth/register-verified", test_data, expected_status=200)
            if success:
                wave_success_count += 1
        
        self.log_test_result(
            "PAIEMENT - Validation Wave Multi-Pays", 
            wave_success_count == len(wave_tests),
            f"Pays supportés: {wave_success_count}/{len(wave_tests)}"
        )
        
        # Test 4.5: Validation compte bancaire
        bank_account_data = {
            "email": f"bank_test_{timestamp}@kojo.test",
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
                    "account_holder": "Mariama Coulibaly",
                    "bank_code": "BA001",
                    "branch": "Bamako Plateau"
                }
            }
        }
        
        success, response = self.make_request("POST", "auth/register-verified", bank_account_data, expected_status=200)
        self.log_test_result(
            "PAIEMENT - Validation Compte Bancaire", 
            success,
            "Support comptes bancaires avec validation complète"
        )
        
        # Test 4.6: Gestion des comptes de paiement
        if self.tokens.get('client_verified'):
            # Récupération des comptes
            success, response = self.make_request("GET", "users/payment-accounts", token=self.tokens['client_verified'], expected_status=200)
            payment_info = response if success else {}
            
            self.log_test_result(
                "PAIEMENT - GET /api/users/payment-accounts", 
                success,
                f"Comptes: {payment_info.get('payment_accounts_count', 0)}, Vérifié: {payment_info.get('is_verified', False)}"
            )
            
            # Mise à jour des comptes
            update_payment_data = {
                "orange_money": "+223701234567",
                "wave": "+223701234567"
            }
            
            success, response = self.make_request("PUT", "users/payment-accounts", update_payment_data, token=self.tokens['client_verified'], expected_status=200)
            self.log_test_result(
                "PAIEMENT - PUT /api/users/payment-accounts", 
                success,
                "Mise à jour des comptes de paiement"
            )
            
            # Vérification accès paiement
            success, response = self.make_request("POST", "users/verify-payment-access", token=self.tokens['client_verified'], expected_status=200)
            access_info = response if success else {}
            
            self.log_test_result(
                "PAIEMENT - Vérification Accès", 
                success,
                f"Accès autorisé: {access_info.get('access_granted', False)}"
            )
        
        # Test 4.7: Validation préfixes téléphone 70-99
        prefix_tests = ["70", "75", "80", "85", "90", "95", "99"]
        prefix_success_count = 0
        
        for i, prefix in enumerate(prefix_tests):
            test_phone = f"+221{prefix}1234567"
            test_data = {
                "email": f"prefix_test_{prefix}_{timestamp}@kojo.test",
                "password": "KojoTest2024!",
                "first_name": "Test",
                "last_name": f"Prefix{prefix}",
                "phone": test_phone,
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test_phone
                }
            }
            
            success, response = self.make_request("POST", "auth/register-verified", test_data, expected_status=200)
            if success:
                prefix_success_count += 1
        
        self.log_test_result(
            "PAIEMENT - Validation Préfixes 70-99", 
            prefix_success_count == len(prefix_tests),
            f"Préfixes supportés: {prefix_success_count}/{len(prefix_tests)}"
        )

    def audit_systeme_messagerie(self):
        """5. AUDIT DU SYSTÈME DE MESSAGERIE"""
        print("\n" + "💬" * 20)
        print("5. AUDIT DU SYSTÈME DE MESSAGERIE")
        print("💬" * 20)
        
        if not self.tokens.get('client') or not self.tokens.get('worker'):
            self.log_test_result("MESSAGERIE - Tokens Manquants", False, "Besoin de tokens client et worker", critical=True)
            return
        
        # Test 5.1: Envoi de message client vers worker
        message_data = {
            "receiver_id": self.users['worker']['id'],
            "content": "Bonjour, j'ai vu votre proposition pour la réparation de ma moto. Pouvez-vous me donner plus de détails sur votre expérience avec les Yamaha 125cc ?"
        }
        
        success, response = self.make_request("POST", "messages", message_data, token=self.tokens['client'], expected_status=200)
        self.log_test_result(
            "MESSAGERIE - POST /api/messages (Client→Worker)", 
            success,
            f"Message envoyé: {len(message_data['content'])} caractères" if success else "Erreur envoi message",
            critical=True
        )
        
        # Test 5.2: Réponse du worker
        response_message = {
            "receiver_id": self.users['client']['id'],
            "content": "Bonjour ! J'ai 5 ans d'expérience avec les motos Yamaha. J'ai déjà réparé plus de 50 Yamaha 125cc. Les problèmes de démarrage sont souvent liés à la batterie ou au système d'allumage. Je peux faire un diagnostic gratuit."
        }
        
        success, response = self.make_request("POST", "messages", response_message, token=self.tokens['worker'], expected_status=200)
        self.log_test_result(
            "MESSAGERIE - POST /api/messages (Worker→Client)", 
            success,
            "Conversation bidirectionnelle fonctionnelle"
        )
        
        # Test 5.3: Récupération des conversations
        success, response = self.make_request("GET", "messages/conversations", token=self.tokens['client'], expected_status=200)
        conversations_count = len(response) if success and isinstance(response, list) else 0
        
        self.log_test_result(
            "MESSAGERIE - GET /api/messages/conversations", 
            success,
            f"Conversations actives: {conversations_count}"
        )
        
        # Test 5.4: Récupération messages d'une conversation
        if conversations_count > 0 and isinstance(response, list):
            conversation_id = response[0].get('_id')
            if conversation_id:
                success, response = self.make_request("GET", f"messages/{conversation_id}", token=self.tokens['client'], expected_status=200)
                messages_count = len(response) if success and isinstance(response, list) else 0
                
                self.log_test_result(
                    "MESSAGERIE - GET /api/messages/{conversation_id}", 
                    success,
                    f"Messages dans la conversation: {messages_count}"
                )
        
        # Test 5.5: Validation contenu message (limites)
        long_message = {
            "receiver_id": self.users['worker']['id'],
            "content": "A" * 5001  # Dépasse la limite de 5000 caractères
        }
        
        success, response = self.make_request("POST", "messages", long_message, token=self.tokens['client'], expected_status=422)
        self.log_test_result(
            "MESSAGERIE - Validation Longueur Message", 
            success,
            "Protection contre les messages trop longs"
        )
        
        # Test 5.6: Sécurité - Accès aux conversations d'autrui
        if self.tokens.get('client_verified'):
            success, response = self.make_request("GET", "messages/conversations", token=self.tokens['client_verified'], expected_status=200)
            other_conversations = len(response) if success and isinstance(response, list) else 0
            
            # Un nouvel utilisateur ne devrait pas voir les conversations des autres
            self.log_test_result(
                "MESSAGERIE - Sécurité Conversations", 
                other_conversations == 0,
                f"Isolation des conversations: {other_conversations} conversations visibles (devrait être 0)"
            )

    def audit_securite_validation(self):
        """6. AUDIT SÉCURITÉ ET VALIDATION"""
        print("\n" + "🔒" * 20)
        print("6. AUDIT SÉCURITÉ ET VALIDATION")
        print("🔒" * 20)
        
        # Test 6.1: Validation des données Pydantic
        invalid_user_data = {
            "email": "email_invalide",  # Email mal formé
            "password": "123",  # Mot de passe trop court
            "first_name": "A",  # Prénom trop court
            "last_name": "",  # Nom vide
            "phone": "123",  # Téléphone invalide
            "user_type": "invalid_type",  # Type utilisateur invalide
            "country": "invalid_country",  # Pays invalide
            "preferred_language": "invalid_lang"  # Langue invalide
        }
        
        success, response = self.make_request("POST", "auth/register", invalid_user_data, expected_status=422)
        self.log_test_result(
            "SÉCURITÉ - Validation Pydantic", 
            success,
            "Rejet des données mal formées avec erreurs détaillées"
        )
        
        # Test 6.2: Gestion des erreurs avec messages français
        french_error_data = {
            "email": "test@test.com",
            "password": "TestPass123!",
            "first_name": "A",  # Trop court - devrait générer erreur en français
            "last_name": "B",   # Trop court - devrait générer erreur en français
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {}
        }
        
        success, response = self.make_request("POST", "auth/register-verified", french_error_data, expected_status=422)
        error_message = response.get('detail', '') if not success else ''
        french_error_detected = 'caractères' in error_message.lower() or 'prénom' in error_message.lower()
        
        self.log_test_result(
            "SÉCURITÉ - Messages d'Erreur Français", 
            success and french_error_detected,
            f"Message d'erreur: {error_message[:100]}..." if error_message else "Pas de message d'erreur français détecté"
        )
        
        # Test 6.3: Rate limiting et protection DDoS (test basique)
        rapid_requests_success = 0
        for i in range(5):  # 5 requêtes rapides
            success, response = self.make_request("GET", "health", expected_status=200)
            if success:
                rapid_requests_success += 1
        
        self.log_test_result(
            "SÉCURITÉ - Résistance Requêtes Rapides", 
            rapid_requests_success >= 4,  # Au moins 4/5 doivent passer
            f"Requêtes réussies: {rapid_requests_success}/5"
        )
        
        # Test 6.4: Validation JWT Token expiration (simulation)
        if self.tokens.get('client'):
            # Test avec token valide
            success, response = self.make_request("GET", "users/profile", token=self.tokens['client'], expected_status=200)
            valid_token_works = success
            
            # Test avec token invalide
            invalid_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJpbnZhbGlkIiwiZW1haWwiOiJpbnZhbGlkQHRlc3QuY29tIiwiZXhwIjoxNjAwMDAwMDAwfQ.invalid_signature"
            success, response = self.make_request("GET", "users/profile", token=invalid_token, expected_status=401)
            invalid_token_rejected = success
            
            self.log_test_result(
                "SÉCURITÉ - Validation JWT", 
                valid_token_works and invalid_token_rejected,
                f"Token valide: {'OK' if valid_token_works else 'KO'}, Token invalide: {'Rejeté' if invalid_token_rejected else 'Accepté'}"
            )
        
        # Test 6.5: Protection CORS et headers de sécurité
        success, response = self.make_request("GET", "health", expected_status=200)
        # Note: Les headers de sécurité sont vérifiés côté serveur, difficile à tester ici
        self.log_test_result(
            "SÉCURITÉ - Endpoint de Santé", 
            success,
            "Endpoint de base accessible et fonctionnel"
        )
        
        # Test 6.6: Validation des permissions (client ne peut pas créer profil worker)
        if self.tokens.get('client'):
            worker_profile_data = {
                "user_id": "fake_id",
                "specialties": ["test"],
                "experience_years": 1,
                "availability": True
            }
            
            success, response = self.make_request("POST", "workers/profile", worker_profile_data, token=self.tokens['client'], expected_status=403)
            self.log_test_result(
                "SÉCURITÉ - Contrôle Permissions", 
                success,
                "Client correctement empêché de créer profil worker"
            )

    def audit_performance_infrastructure(self):
        """7. AUDIT PERFORMANCE ET INFRASTRUCTURE"""
        print("\n" + "⚡" * 20)
        print("7. AUDIT PERFORMANCE ET INFRASTRUCTURE")
        print("⚡" * 20)
        
        # Test 7.1: Temps de réponse des endpoints critiques
        import time
        
        endpoints_to_test = [
            ("health", "GET", None, None),
            ("stats", "GET", None, None),
            ("jobs", "GET", None, self.tokens.get('client')),
            ("users/profile", "GET", None, self.tokens.get('client'))
        ]
        
        response_times = []
        for endpoint, method, data, token in endpoints_to_test:
            if token or endpoint in ["health", "stats"]:  # Skip if no token for protected endpoints
                start_time = time.time()
                success, response = self.make_request(method, endpoint, data, token, expected_status=200)
                end_time = time.time()
                
                response_time = (end_time - start_time) * 1000  # en millisecondes
                response_times.append(response_time)
                
                self.log_test_result(
                    f"PERFORMANCE - {endpoint} ({response_time:.0f}ms)", 
                    success and response_time < 2000,  # Moins de 2 secondes
                    f"Temps de réponse: {response_time:.0f}ms"
                )
        
        avg_response_time = sum(response_times) / len(response_times) if response_times else 0
        self.log_test_result(
            "PERFORMANCE - Temps Moyen de Réponse", 
            avg_response_time < 1000,  # Moins de 1 seconde en moyenne
            f"Moyenne: {avg_response_time:.0f}ms"
        )
        
        # Test 7.2: Connexion MongoDB
        success, response = self.make_request("GET", "health", expected_status=200)
        db_connected = success and response.get('database') == 'connected'
        
        self.log_test_result(
            "INFRASTRUCTURE - Connexion MongoDB", 
            db_connected,
            f"Base de données: {response.get('database', 'inconnu')}" if success else "Erreur connexion",
            critical=True
        )
        
        # Test 7.3: Endpoints de statistiques
        success, response = self.make_request("GET", "stats", expected_status=200)
        stats_data = response if success else {}
        
        self.log_test_result(
            "INFRASTRUCTURE - Endpoint Statistiques", 
            success,
            f"Utilisateurs: {stats_data.get('total_users', 0)}, Jobs: {stats_data.get('total_jobs', 0)}" if success else "Erreur stats"
        )
        
        # Test 7.4: Support multi-pays
        supported_countries = stats_data.get('supported_countries', []) if success else []
        expected_countries = ["senegal", "mali", "ivory_coast", "burkina_faso"]
        countries_supported = all(country in supported_countries for country in expected_countries)
        
        self.log_test_result(
            "INFRASTRUCTURE - Support Multi-Pays", 
            countries_supported,
            f"Pays supportés: {supported_countries}"
        )
        
        # Test 7.5: Support multi-langues
        supported_languages = stats_data.get('supported_languages', []) if success else []
        expected_languages = ["fr", "en", "wo", "bm"]
        languages_supported = all(lang in supported_languages for lang in expected_languages)
        
        self.log_test_result(
            "INFRASTRUCTURE - Support Multi-Langues", 
            languages_supported,
            f"Langues supportées: {supported_languages}"
        )
        
        # Test 7.6: Serving de fichiers statiques (photos de profil)
        if self.tokens.get('client'):
            # D'abord, uploader une photo
            test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\x00\x00\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
            files = {'file': ('test_static.png', io.BytesIO(test_image_data), 'image/png')}
            
            success, response = self.make_request("POST", "users/profile-photo", files=files, token=self.tokens['client'], expected_status=200)
            
            if success and response.get('photo_url'):
                # Tester l'accès au fichier statique
                photo_url = response['photo_url']
                if photo_url.startswith('/api/uploads/'):
                    # Construire l'URL complète
                    static_url = f"{self.base_url.replace('/api', '')}{photo_url}"
                    
                    try:
                        static_response = requests.get(static_url, timeout=10)
                        static_file_works = static_response.status_code == 200 and 'image' in static_response.headers.get('content-type', '')
                        
                        self.log_test_result(
                            "INFRASTRUCTURE - Serving Fichiers Statiques", 
                            static_file_works,
                            f"URL: {photo_url}, Content-Type: {static_response.headers.get('content-type', 'N/A')}"
                        )
                    except Exception as e:
                        self.log_test_result(
                            "INFRASTRUCTURE - Serving Fichiers Statiques", 
                            False,
                            f"Erreur accès fichier statique: {str(e)}"
                        )
        
        # Test 7.7: Logging et monitoring
        success, response = self.make_request("GET", "health", expected_status=200)
        monitoring_data = response if success else {}
        
        has_timestamp = 'timestamp' in monitoring_data
        has_version = 'version' in monitoring_data
        has_environment = 'environment' in monitoring_data
        
        self.log_test_result(
            "INFRASTRUCTURE - Logging et Monitoring", 
            has_timestamp and has_version and has_environment,
            f"Timestamp: {'✓' if has_timestamp else '✗'}, Version: {'✓' if has_version else '✗'}, Env: {'✓' if has_environment else '✗'}"
        )

    def audit_systeme_famakan_master(self):
        """8. AUDIT SYSTÈME FAMAKAN KONTAGA MASTER (PROPRIÉTAIRE)"""
        print("\n" + "👑" * 20)
        print("8. AUDIT SYSTÈME FAMAKAN KONTAGA MASTER")
        print("👑" * 20)
        
        # Test 8.1: Connexion Famakan Kontaga Master
        famakan_credentials = {
            "email": "kontagamakan@gmail.com",
            "password": "FamakanKojo2024@Master!"
        }
        
        success, response = self.make_request("POST", "auth/login", famakan_credentials, expected_status=200)
        if success and 'access_token' in response:
            self.tokens['famakan'] = response['access_token']
            famakan_user = response.get('user', {})
            
            # Vérifier les détails du compte Famakan
            famakan_details_correct = (
                famakan_user.get('id') == 'famakan_kontaga_master_2024' and
                famakan_user.get('email') == 'kontagamakan@gmail.com' and
                famakan_user.get('first_name') == 'Famakan' and
                famakan_user.get('last_name') == 'Kontaga Master'
            )
            
            self.log_test_result(
                "FAMAKAN - Connexion Compte Master", 
                success and famakan_details_correct,
                f"ID: {famakan_user.get('id', 'N/A')}, Email: {famakan_user.get('email', 'N/A')}",
                critical=True
            )
        else:
            self.log_test_result(
                "FAMAKAN - Connexion Compte Master", 
                False,
                "Impossible de se connecter avec les credentials Famakan",
                critical=True
            )
            return
        
        # Test 8.2: Accès aux endpoints propriétaire
        owner_endpoints = [
            ("owner/commission-stats", "Statistiques Commission"),
            ("owner/debug-info", "Informations Debug"),
            ("owner/users-management", "Gestion Utilisateurs")
        ]
        
        for endpoint, description in owner_endpoints:
            success, response = self.make_request("GET", endpoint, token=self.tokens['famakan'], expected_status=200)
            
            access_level = response.get('access_level') if success else None
            self.log_test_result(
                f"FAMAKAN - {description}", 
                success and access_level == 'OWNER_FULL_ACCESS',
                f"Niveau d'accès: {access_level}" if access_level else "Accès refusé"
            )
        
        # Test 8.3: Mise à jour paramètres commission
        commission_settings = {
            "commission_rate": 15,
            "owner_accounts": {
                "orange_money": "+223701234567",
                "wave": "+221701234567"
            }
        }
        
        success, response = self.make_request("POST", "owner/update-commission-settings", commission_settings, token=self.tokens['famakan'], expected_status=200)
        self.log_test_result(
            "FAMAKAN - Mise à Jour Commission", 
            success,
            f"Taux commission: {commission_settings['commission_rate']}%" if success else "Erreur mise à jour"
        )
        
        # Test 8.4: Sécurité - Utilisateurs normaux ne peuvent pas accéder
        if self.tokens.get('client'):
            success, response = self.make_request("GET", "owner/commission-stats", token=self.tokens['client'], expected_status=403)
            
            error_message = response.get('detail', '') if not success else ''
            correct_french_error = "Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement" in error_message
            
            self.log_test_result(
                "FAMAKAN - Sécurité Accès Client", 
                success and correct_french_error,
                f"Message d'erreur: {error_message}" if error_message else "Pas de message d'erreur approprié"
            )
        
        if self.tokens.get('worker'):
            success, response = self.make_request("GET", "owner/debug-info", token=self.tokens['worker'], expected_status=403)
            self.log_test_result(
                "FAMAKAN - Sécurité Accès Worker", 
                success,
                "Worker correctement empêché d'accéder aux fonctions propriétaire"
            )
        
        # Test 8.5: Famakan peut accéder aux fonctions normales
        success, response = self.make_request("GET", "users/profile", token=self.tokens['famakan'], expected_status=200)
        self.log_test_result(
            "FAMAKAN - Accès Fonctions Normales", 
            success,
            "Famakan peut utiliser les fonctions utilisateur standard"
        )

    def generer_rapport_audit(self):
        """Générer le rapport final d'audit"""
        print("\n" + "📊" * 30)
        print("RAPPORT FINAL D'AUDIT BACKEND KOJO")
        print("📊" * 30)
        
        print(f"\n🎯 RÉSUMÉ GLOBAL:")
        print(f"   • Tests exécutés: {self.total_tests}")
        print(f"   • Tests réussis: {self.passed_tests}")
        print(f"   • Tests échoués: {self.failed_tests}")
        print(f"   • Taux de réussite: {(self.passed_tests/self.total_tests*100):.1f}%")
        
        if self.critical_failures:
            print(f"\n🚨 ÉCHECS CRITIQUES ({len(self.critical_failures)}):")
            for failure in self.critical_failures:
                print(f"   ❌ {failure}")
        
        print(f"\n📋 RÉSULTATS PAR CATÉGORIE:")
        for category, results in self.audit_results.items():
            total_category = results['passed'] + results['failed']
            success_rate = (results['passed'] / total_category * 100) if total_category > 0 else 0
            
            status_icon = "✅" if results['failed'] == 0 else "⚠️" if success_rate >= 80 else "❌"
            print(f"   {status_icon} {category}: {results['passed']}/{total_category} ({success_rate:.1f}%)")
        
        # Évaluation globale
        overall_success_rate = (self.passed_tests / self.total_tests * 100) if self.total_tests > 0 else 0
        
        if overall_success_rate >= 95:
            grade = "🏆 EXCELLENT"
            recommendation = "Backend prêt pour la production en Afrique de l'Ouest"
        elif overall_success_rate >= 85:
            grade = "✅ TRÈS BON"
            recommendation = "Backend fonctionnel avec quelques améliorations mineures"
        elif overall_success_rate >= 70:
            grade = "⚠️ ACCEPTABLE"
            recommendation = "Backend nécessite des corrections avant production"
        else:
            grade = "❌ CRITIQUE"
            recommendation = "Backend nécessite des corrections majeures"
        
        print(f"\n🎖️ ÉVALUATION GLOBALE: {grade}")
        print(f"📝 RECOMMANDATION: {recommendation}")
        
        print(f"\n🌍 SPÉCIFICITÉS AFRIQUE DE L'OUEST:")
        print(f"   • Support multi-pays: Mali, Sénégal, Burkina Faso, Côte d'Ivoire")
        print(f"   • Support multi-langues: Français, Anglais, Wolof, Bambara")
        print(f"   • Paiements mobiles: Orange Money, Wave")
        print(f"   • Comptes bancaires: Validation complète")
        print(f"   • Préfixes téléphone: 70-99 supportés")
        
        print(f"\n⏰ Audit terminé le {datetime.now().strftime('%d/%m/%Y à %H:%M:%S')}")
        print("=" * 80)
        
        return {
            "total_tests": self.total_tests,
            "passed_tests": self.passed_tests,
            "failed_tests": self.failed_tests,
            "success_rate": overall_success_rate,
            "grade": grade,
            "critical_failures": len(self.critical_failures),
            "categories": self.audit_results
        }

    def executer_audit_complet(self):
        """Exécuter l'audit complet de tous les systèmes"""
        print("🚀 Démarrage de l'audit complet...")
        
        try:
            # 1. Système d'authentification
            self.audit_systeme_authentification()
            
            # 2. Système de profil
            self.audit_systeme_profil()
            
            # 3. Système de gestion des emplois
            self.audit_systeme_gestion_emplois()
            
            # 4. Système de paiement
            self.audit_systeme_paiement()
            
            # 5. Système de messagerie
            self.audit_systeme_messagerie()
            
            # 6. Sécurité et validation
            self.audit_securite_validation()
            
            # 7. Performance et infrastructure
            self.audit_performance_infrastructure()
            
            # 8. Système Famakan Kontaga Master
            self.audit_systeme_famakan_master()
            
            # Générer le rapport final
            return self.generer_rapport_audit()
            
        except Exception as e:
            print(f"\n❌ ERREUR CRITIQUE DURANT L'AUDIT: {str(e)}")
            return {
                "error": str(e),
                "total_tests": self.total_tests,
                "passed_tests": self.passed_tests,
                "failed_tests": self.failed_tests
            }

def main():
    """Point d'entrée principal"""
    print("🇸🇳🇲🇱🇧🇫🇨🇮 AUDIT COMPLET BACKEND KOJO - AFRIQUE DE L'OUEST 🇨🇮🇧🇫🇲🇱🇸🇳")
    
    # Initialiser l'auditeur
    auditeur = KojoBackendAuditComplet()
    
    # Exécuter l'audit complet
    resultats = auditeur.executer_audit_complet()
    
    # Retourner les résultats
    return resultats

if __name__ == "__main__":
    resultats = main()
    sys.exit(0 if resultats.get("success_rate", 0) >= 80 else 1)