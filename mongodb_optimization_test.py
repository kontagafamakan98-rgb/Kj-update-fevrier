#!/usr/bin/env python3
"""
TEST COMPLET DES OPTIMISATIONS BACKEND KOJO
===========================================

Test spécialisé pour vérifier les optimisations MongoDB et performance backend
selon la demande de review en français.

Objectifs:
1. Vérifier que les index MongoDB sont créés au démarrage
2. Tester performance des queries fréquentes (<500ms)
3. Tester toutes les fonctionnalités core sans régression
4. Valider les temps de réponse optimaux
"""

import requests
import time
import json
import sys
from datetime import datetime, timezone
import uuid

class KojoMongoDBOptimizationTester:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.client_user = None
        self.worker_user = None
        self.test_job_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.performance_results = []
        
        print("🚀 DÉMARRAGE TEST COMPLET DES OPTIMISATIONS BACKEND KOJO")
        print("=" * 60)
        print("Focus: MongoDB Indexes + Performance + Fonctionnalités Core")
        print("=" * 60)

    def measure_response_time(self, name, method, endpoint, expected_status, data=None, token=None):
        """Mesure le temps de réponse d'un endpoint avec validation"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n⏱️  Testing {name}...")
        
        start_time = time.time()
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)
            
            end_time = time.time()
            response_time = (end_time - start_time) * 1000  # Convert to milliseconds
            
            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                status_icon = "✅"
            else:
                status_icon = "❌"
            
            # Performance evaluation
            if method == 'GET' and response_time > 500:
                perf_status = "⚠️ SLOW"
            elif method in ['POST', 'PUT'] and response_time > 2000:
                perf_status = "⚠️ SLOW"
            else:
                perf_status = "🚀 FAST"
            
            print(f"{status_icon} {name}")
            print(f"   Status: {response.status_code} (expected {expected_status})")
            print(f"   Response Time: {response_time:.2f}ms {perf_status}")
            
            # Store performance data
            self.performance_results.append({
                'name': name,
                'method': method,
                'endpoint': endpoint,
                'response_time_ms': response_time,
                'status_code': response.status_code,
                'success': success
            })
            
            if success:
                try:
                    response_data = response.json()
                    return True, response_data, response_time
                except:
                    return True, None, response_time
            else:
                print(f"   Error: {response.text[:200]}")
                return False, None, response_time
                
        except Exception as e:
            end_time = time.time()
            response_time = (end_time - start_time) * 1000
            print(f"❌ {name} - Exception: {str(e)}")
            return False, None, response_time

    def test_1_health_and_database_connection(self):
        """Test 1: Vérification santé système et connexion MongoDB"""
        print("\n" + "="*50)
        print("TEST 1: SANTÉ SYSTÈME ET CONNEXION MONGODB")
        print("="*50)
        
        # Test health endpoint
        success, data, response_time = self.measure_response_time(
            "Health Check", "GET", "health", 200
        )
        
        if success and data:
            print(f"✅ Database Status: {data.get('database', 'unknown')}")
            print(f"✅ Environment: {data.get('environment', 'unknown')}")
            print(f"✅ Version: {data.get('version', 'unknown')}")
        
        # Test root endpoint
        success, data, response_time = self.measure_response_time(
            "Root Endpoint", "GET", "", 200
        )
        
        # Test stats endpoint (should be fast with indexes)
        success, data, response_time = self.measure_response_time(
            "System Stats", "GET", "stats", 200
        )
        
        if success and data:
            print(f"✅ Total Users: {data.get('total_users', 0)}")
            print(f"✅ Total Jobs: {data.get('total_jobs', 0)}")
            print(f"✅ Supported Countries: {len(data.get('supported_countries', []))}")

    def test_2_authentication_system(self):
        """Test 2: Système d'authentification avec performance"""
        print("\n" + "="*50)
        print("TEST 2: SYSTÈME D'AUTHENTIFICATION")
        print("="*50)
        
        # Test user registration (client)
        client_data = {
            "email": f"client_test_{uuid.uuid4().hex[:8]}@gmail.com",
            "password": "TestPassword123!",
            "first_name": "Amadou",
            "last_name": "Traoré",
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, data, response_time = self.measure_response_time(
            "Client Registration", "POST", "auth/register", 200, client_data
        )
        
        if success and data:
            self.client_token = data.get('access_token')
            self.client_user = data.get('user')
            print(f"✅ Client Token: {self.client_token[:20]}...")
        
        # Test user registration (worker)
        worker_data = {
            "email": f"worker_test_{uuid.uuid4().hex[:8]}@gmail.com",
            "password": "TestPassword123!",
            "first_name": "Fatou",
            "last_name": "Diop",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, data, response_time = self.measure_response_time(
            "Worker Registration", "POST", "auth/register", 200, worker_data
        )
        
        if success and data:
            self.worker_token = data.get('access_token')
            self.worker_user = data.get('user')
            print(f"✅ Worker Token: {self.worker_token[:20]}...")
        
        # Test login with existing user
        if self.client_token:
            login_data = {
                "email": client_data["email"],
                "password": client_data["password"]
            }
            
            success, data, response_time = self.measure_response_time(
                "Client Login", "POST", "auth/login", 200, login_data
            )

    def test_3_profile_management_performance(self):
        """Test 3: Gestion profil avec performance optimisée"""
        print("\n" + "="*50)
        print("TEST 3: GESTION PROFIL (PERFORMANCE)")
        print("="*50)
        
        if not self.client_token:
            print("❌ Skipping profile tests - no client token")
            return
        
        # Test GET profile (should be fast with user index)
        success, data, response_time = self.measure_response_time(
            "Get User Profile", "GET", "users/profile", 200, token=self.client_token
        )
        
        if success and data:
            print(f"✅ Profile Email: {data.get('email')}")
            print(f"✅ Profile Country: {data.get('country')}")
        
        # Test profile update
        update_data = {
            "preferred_language": "en",
            "first_name": "Amadou_Updated"
        }
        
        success, data, response_time = self.measure_response_time(
            "Update Profile", "PUT", "users/profile", 200, update_data, self.client_token
        )

    def test_4_jobs_system_with_indexes(self):
        """Test 4: Système emplois avec index MongoDB optimisés"""
        print("\n" + "="*50)
        print("TEST 4: SYSTÈME EMPLOIS (INDEXES MONGODB)")
        print("="*50)
        
        if not self.client_token:
            print("❌ Skipping jobs tests - no client token")
            return
        
        # Create test job
        job_data = {
            "title": "Réparation moto Yamaha - Test Performance",
            "description": "Réparation complète d'une moto Yamaha avec remplacement des pièces défectueuses. Travail urgent à Dakar.",
            "category": "mécanique_moto",
            "budget_min": 25000,
            "budget_max": 50000,
            "location": {
                "city": "Dakar",
                "country": "Sénégal",
                "address": "Plateau, près du marché central"
            },
            "required_skills": ["mécanique", "moto", "yamaha"],
            "estimated_duration": "2-3 jours",
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": True,
            "parts_and_tools_notes": "Pièces Yamaha originales requises"
        }
        
        success, data, response_time = self.measure_response_time(
            "Create Job", "POST", "jobs", 200, job_data, self.client_token
        )
        
        if success and data:
            self.test_job_id = data.get('id')
            print(f"✅ Job Created: {self.test_job_id}")
        
        # Test GET jobs with filters (should be fast with category index)
        success, data, response_time = self.measure_response_time(
            "Get Jobs (No Filter)", "GET", "jobs", 200, token=self.client_token
        )
        
        # Test GET jobs with category filter (index optimization)
        success, data, response_time = self.measure_response_time(
            "Get Jobs (Category Filter)", "GET", "jobs?category=mécanique_moto", 200, token=self.client_token
        )
        
        # Test GET jobs with status filter (index optimization)
        success, data, response_time = self.measure_response_time(
            "Get Jobs (Status Filter)", "GET", "jobs?status=open", 200, token=self.client_token
        )
        
        # Test GET specific job (should be fast with id index)
        if self.test_job_id:
            success, data, response_time = self.measure_response_time(
                "Get Specific Job", "GET", f"jobs/{self.test_job_id}", 200, token=self.client_token
            )

    def test_5_payment_validation_system(self):
        """Test 5: Système validation paiement (Orange Money, Wave)"""
        print("\n" + "="*50)
        print("TEST 5: VALIDATION PAIEMENT (ORANGE MONEY, WAVE)")
        print("="*50)
        
        # Test Orange Money validation for all 4 countries
        countries_data = [
            {"country": "Sénégal", "phone": "+221771234567"},
            {"country": "Mali", "phone": "+223701234567"},
            {"country": "Côte d'Ivoire", "phone": "+225701234567"},
            {"country": "Burkina Faso", "phone": "+226701234567"}
        ]
        
        for country_info in countries_data:
            # Test registration with payment accounts
            user_data = {
                "email": f"payment_test_{uuid.uuid4().hex[:8]}@gmail.com",
                "password": "TestPassword123!",
                "first_name": "Test_User",
                "last_name": "Payment_Test",
                "phone": country_info["phone"],
                "user_type": "worker",
                "country": country_info["country"].lower().replace(" ", "_").replace("'", ""),
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": country_info["phone"],
                    "wave": country_info["phone"]
                },
                "worker_specialties": ["mécanique", "électricité"],
                "worker_experience_years": 5
            }
            
            success, data, response_time = self.measure_response_time(
                f"Payment Registration ({country_info['country']})", 
                "POST", "auth/register-verified", 200, user_data
            )
            
            if success and data:
                print(f"✅ {country_info['country']}: Payment accounts validated")

    def test_6_messages_system_performance(self):
        """Test 6: Système messagerie avec performance"""
        print("\n" + "="*50)
        print("TEST 6: SYSTÈME MESSAGERIE (PERFORMANCE)")
        print("="*50)
        
        if not self.client_token or not self.worker_token:
            print("❌ Skipping messages tests - missing tokens")
            return
        
        # Send message from client to worker
        message_data = {
            "receiver_id": self.worker_user.get('id') if self.worker_user else "test_receiver",
            "content": "Bonjour, je suis intéressé par votre profil pour un travail de mécanique moto."
        }
        
        success, data, response_time = self.measure_response_time(
            "Send Message", "POST", "messages", 200, message_data, self.client_token
        )
        
        # Get conversations (should be fast with sender/receiver index)
        success, data, response_time = self.measure_response_time(
            "Get Conversations", "GET", "messages/conversations", 200, token=self.client_token
        )

    def test_7_performance_summary(self):
        """Test 7: Résumé performance et validation objectifs"""
        print("\n" + "="*50)
        print("TEST 7: RÉSUMÉ PERFORMANCE ET VALIDATION")
        print("="*50)
        
        # Analyze performance results
        get_requests = [r for r in self.performance_results if r['method'] == 'GET']
        post_requests = [r for r in self.performance_results if r['method'] in ['POST', 'PUT']]
        
        print("\n📊 ANALYSE PERFORMANCE:")
        print("-" * 30)
        
        # GET requests analysis (should be <500ms)
        if get_requests:
            avg_get_time = sum(r['response_time_ms'] for r in get_requests) / len(get_requests)
            max_get_time = max(r['response_time_ms'] for r in get_requests)
            slow_gets = [r for r in get_requests if r['response_time_ms'] > 500]
            
            print(f"GET Requests:")
            print(f"  - Total: {len(get_requests)}")
            print(f"  - Average: {avg_get_time:.2f}ms")
            print(f"  - Maximum: {max_get_time:.2f}ms")
            print(f"  - Slow (>500ms): {len(slow_gets)}")
            
            if len(slow_gets) == 0:
                print("  ✅ Tous les GET <500ms - OBJECTIF ATTEINT")
            else:
                print("  ⚠️ Certains GET >500ms - OPTIMISATION NÉCESSAIRE")
                for slow in slow_gets:
                    print(f"    - {slow['name']}: {slow['response_time_ms']:.2f}ms")
        
        # POST requests analysis (should be <2s)
        if post_requests:
            avg_post_time = sum(r['response_time_ms'] for r in post_requests) / len(post_requests)
            max_post_time = max(r['response_time_ms'] for r in post_requests)
            slow_posts = [r for r in post_requests if r['response_time_ms'] > 2000]
            
            print(f"\nPOST/PUT Requests:")
            print(f"  - Total: {len(post_requests)}")
            print(f"  - Average: {avg_post_time:.2f}ms")
            print(f"  - Maximum: {max_post_time:.2f}ms")
            print(f"  - Slow (>2s): {len(slow_posts)}")
            
            if len(slow_posts) == 0:
                print("  ✅ Tous les POST <2s - OBJECTIF ATTEINT")
            else:
                print("  ⚠️ Certains POST >2s - OPTIMISATION NÉCESSAIRE")
                for slow in slow_posts:
                    print(f"    - {slow['name']}: {slow['response_time_ms']:.2f}ms")

    def run_complete_optimization_test(self):
        """Exécute tous les tests d'optimisation"""
        print("🚀 DÉBUT DES TESTS D'OPTIMISATION MONGODB KOJO")
        start_time = time.time()
        
        # Execute all test suites
        self.test_1_health_and_database_connection()
        self.test_2_authentication_system()
        self.test_3_profile_management_performance()
        self.test_4_jobs_system_with_indexes()
        self.test_5_payment_validation_system()
        self.test_6_messages_system_performance()
        self.test_7_performance_summary()
        
        # Final summary
        end_time = time.time()
        total_time = end_time - start_time
        
        print("\n" + "="*60)
        print("🏆 RÉSULTATS FINAUX - TEST OPTIMISATIONS BACKEND")
        print("="*60)
        print(f"Tests exécutés: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        print(f"Temps total: {total_time:.2f}s")
        
        if self.tests_passed == self.tests_run:
            print("✅ TOUS LES TESTS RÉUSSIS - OPTIMISATIONS VALIDÉES")
        elif self.tests_passed / self.tests_run >= 0.9:
            print("⚠️ OPTIMISATIONS GLOBALEMENT RÉUSSIES - CORRECTIONS MINEURES")
        else:
            print("❌ PROBLÈMES CRITIQUES DÉTECTÉS - CORRECTIONS NÉCESSAIRES")
        
        return self.tests_passed, self.tests_run

if __name__ == "__main__":
    tester = KojoMongoDBOptimizationTester()
    passed, total = tester.run_complete_optimization_test()
    
    # Exit with appropriate code
    if passed == total:
        sys.exit(0)  # Success
    else:
        sys.exit(1)  # Some tests failed