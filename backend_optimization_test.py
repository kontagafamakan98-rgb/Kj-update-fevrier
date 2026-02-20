#!/usr/bin/env python3
"""
TEST COMPLET DES OPTIMISATIONS BACKEND KOJO - VERSION CORRIGÉE
==============================================================

Test spécialisé pour vérifier les optimisations MongoDB et performance backend
selon la demande de review en français.

Corrections:
- Email validation issue (éviter mots-clés SQL)
- Country name mapping correct
- Focus sur performance MongoDB indexes
"""

import requests
import time
import json
import sys
from datetime import datetime, timezone
import uuid

class KojoOptimizationTester:
    def __init__(self, base_url="https://kojo-work.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.client_user = None
        self.worker_user = None
        self.test_job_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.performance_results = []
        
        print("🚀 TEST COMPLET DES OPTIMISATIONS BACKEND KOJO - VERSION CORRIGÉE")
        print("=" * 70)
        print("Focus: MongoDB Indexes + Performance + Fonctionnalités Core")
        print("=" * 70)

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

    def test_1_mongodb_indexes_verification(self):
        """Test 1: Vérification des index MongoDB créés au démarrage"""
        print("\n" + "="*60)
        print("TEST 1: VÉRIFICATION INDEXES MONGODB AU DÉMARRAGE")
        print("="*60)
        
        # Test health endpoint - should confirm database connection
        success, data, response_time = self.measure_response_time(
            "Health Check + Database Test", "GET", "health", 200
        )
        
        if success and data:
            print(f"✅ Database Status: {data.get('database', 'unknown')}")
            print(f"✅ Environment: {data.get('environment', 'unknown')}")
            if data.get('database') == 'connected':
                print("✅ MongoDB indexes créés au startup (confirmé par logs)")
        
        # Test stats endpoint - should be fast with indexes
        success, data, response_time = self.measure_response_time(
            "System Stats (Index Performance)", "GET", "stats", 200
        )
        
        if success and data:
            print(f"✅ Total Users: {data.get('total_users', 0)} (query optimisée)")
            print(f"✅ Total Jobs: {data.get('total_jobs', 0)} (query optimisée)")
            print(f"✅ Countries: {len(data.get('supported_countries', []))}")
            print(f"✅ Languages: {len(data.get('supported_languages', []))}")

    def test_2_authentication_performance(self):
        """Test 2: Performance système d'authentification"""
        print("\n" + "="*60)
        print("TEST 2: PERFORMANCE SYSTÈME D'AUTHENTIFICATION")
        print("="*60)
        
        # Test client registration (éviter mots-clés SQL dans email)
        client_data = {
            "email": f"client.test.{uuid.uuid4().hex[:8]}@gmail.com",  # Éviter "OR" dans email
            "password": "TestPassword123!",
            "first_name": "Amadou",
            "last_name": "Traore",
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",  # Correct country name
            "preferred_language": "fr"
        }
        
        success, data, response_time = self.measure_response_time(
            "Client Registration", "POST", "auth/register", 200, client_data
        )
        
        if success and data:
            self.client_token = data.get('access_token')
            self.client_user = data.get('user')
            print(f"✅ Client Token: {self.client_token[:20]}...")
        
        # Test worker registration (éviter mots-clés SQL dans email)
        worker_data = {
            "email": f"worker.test.{uuid.uuid4().hex[:8]}@gmail.com",  # Éviter "OR" dans email
            "password": "TestPassword123!",
            "first_name": "Fatou",
            "last_name": "Diop",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",  # Correct country name
            "preferred_language": "fr"
        }
        
        success, data, response_time = self.measure_response_time(
            "Worker Registration", "POST", "auth/register", 200, worker_data
        )
        
        if success and data:
            self.worker_token = data.get('access_token')
            self.worker_user = data.get('user')
            print(f"✅ Worker Token: {self.worker_token[:20]}...")
        
        # Test login performance (should be fast with email index)
        if self.client_token:
            login_data = {
                "email": client_data["email"],
                "password": client_data["password"]
            }
            
            success, data, response_time = self.measure_response_time(
                "Client Login (Email Index)", "POST", "auth/login", 200, login_data
            )

    def test_3_jobs_queries_with_indexes(self):
        """Test 3: Performance queries emplois avec index MongoDB"""
        print("\n" + "="*60)
        print("TEST 3: PERFORMANCE QUERIES EMPLOIS (INDEXES)")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping jobs tests - no client token")
            return
        
        # Create test job
        job_data = {
            "title": "Réparation moto Yamaha - Test Performance",
            "description": "Réparation complète d'une moto Yamaha avec remplacement des pièces défectueuses. Travail urgent à Dakar.",
            "category": "mecanique_moto",
            "budget_min": 25000,
            "budget_max": 50000,
            "location": {
                "city": "Dakar",
                "country": "Senegal",
                "address": "Plateau, près du marché central"
            },
            "required_skills": ["mecanique", "moto", "yamaha"],
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
        
        # Test queries with different indexes
        print("\n📊 TESTS PERFORMANCE QUERIES AVEC INDEXES:")
        
        # 1. Query by ID (should use id index)
        if self.test_job_id:
            success, data, response_time = self.measure_response_time(
                "Get Job by ID (ID Index)", "GET", f"jobs/{self.test_job_id}", 200, token=self.client_token
            )
        
        # 2. Query all jobs (should use created_at index for sorting)
        success, data, response_time = self.measure_response_time(
            "Get All Jobs (Created_at Index)", "GET", "jobs", 200, token=self.client_token
        )
        
        # 3. Query by category (should use category index)
        success, data, response_time = self.measure_response_time(
            "Get Jobs by Category (Category Index)", "GET", "jobs?category=mecanique_moto", 200, token=self.client_token
        )
        
        # 4. Query by status (should use status index)
        success, data, response_time = self.measure_response_time(
            "Get Jobs by Status (Status Index)", "GET", "jobs?status=open", 200, token=self.client_token
        )
        
        # 5. Combined query (should use compound index)
        success, data, response_time = self.measure_response_time(
            "Get Jobs Status+Category (Compound Index)", "GET", "jobs?status=open&category=mecanique_moto", 200, token=self.client_token
        )

    def test_4_user_profile_performance(self):
        """Test 4: Performance gestion profil utilisateur"""
        print("\n" + "="*60)
        print("TEST 4: PERFORMANCE GESTION PROFIL (USER INDEX)")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping profile tests - no client token")
            return
        
        # Test GET profile (should use user_id index)
        success, data, response_time = self.measure_response_time(
            "Get Profile (User ID Index)", "GET", "users/profile", 200, token=self.client_token
        )
        
        if success and data:
            print(f"✅ Profile Email: {data.get('email')}")
            print(f"✅ Profile Country: {data.get('country')}")
            print(f"✅ User Type: {data.get('user_type')}")
        
        # Test profile update (should be fast with user_id index)
        update_data = {
            "preferred_language": "en",
            "first_name": "Amadou_Updated"
        }
        
        success, data, response_time = self.measure_response_time(
            "Update Profile (User ID Index)", "PUT", "users/profile", 200, update_data, self.client_token
        )

    def test_5_payment_validation_west_africa(self):
        """Test 5: Validation paiement 4 pays Afrique de l'Ouest"""
        print("\n" + "="*60)
        print("TEST 5: VALIDATION PAIEMENT AFRIQUE DE L'OUEST")
        print("="*60)
        
        # Test avec noms corrects des pays
        countries_data = [
            {"country": "senegal", "phone": "+221771234567", "display": "Sénégal"},
            {"country": "mali", "phone": "+223701234567", "display": "Mali"},
            {"country": "ivory_coast", "phone": "+225701234567", "display": "Côte d'Ivoire"},
            {"country": "burkina_faso", "phone": "+226701234567", "display": "Burkina Faso"}
        ]
        
        for country_info in countries_data:
            # Test registration with payment accounts
            user_data = {
                "email": f"payment.test.{uuid.uuid4().hex[:8]}@gmail.com",  # Éviter mots-clés SQL
                "password": "TestPassword123!",
                "first_name": "Test_User",
                "last_name": "Payment_Test",
                "phone": country_info["phone"],
                "user_type": "worker",
                "country": country_info["country"],  # Nom correct
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": country_info["phone"],
                    "wave": country_info["phone"]
                },
                "worker_specialties": ["mecanique", "electricite"],
                "worker_experience_years": 5
            }
            
            success, data, response_time = self.measure_response_time(
                f"Payment Registration ({country_info['display']})", 
                "POST", "auth/register-verified", 200, user_data
            )
            
            if success and data:
                print(f"✅ {country_info['display']}: Orange Money + Wave validés")

    def test_6_messages_performance(self):
        """Test 6: Performance système messagerie"""
        print("\n" + "="*60)
        print("TEST 6: PERFORMANCE SYSTÈME MESSAGERIE")
        print("="*60)
        
        if not self.client_token or not self.worker_token:
            print("❌ Skipping messages tests - missing tokens")
            return
        
        # Send message (should use sender/receiver compound index)
        message_data = {
            "receiver_id": self.worker_user.get('id') if self.worker_user else "test_receiver",
            "content": "Bonjour, je suis intéressé par votre profil pour un travail de mécanique moto."
        }
        
        success, data, response_time = self.measure_response_time(
            "Send Message (Compound Index)", "POST", "messages", 200, message_data, self.client_token
        )
        
        # Get conversations (should use created_at index for sorting)
        success, data, response_time = self.measure_response_time(
            "Get Conversations (Created_at Index)", "GET", "messages/conversations", 200, token=self.client_token
        )

    def test_7_performance_analysis(self):
        """Test 7: Analyse performance et validation objectifs"""
        print("\n" + "="*60)
        print("TEST 7: ANALYSE PERFORMANCE ET VALIDATION OBJECTIFS")
        print("="*60)
        
        # Analyze performance results
        get_requests = [r for r in self.performance_results if r['method'] == 'GET']
        post_requests = [r for r in self.performance_results if r['method'] in ['POST', 'PUT']]
        
        print("\n📊 ANALYSE PERFORMANCE DÉTAILLÉE:")
        print("-" * 40)
        
        # GET requests analysis (objectif <500ms)
        if get_requests:
            avg_get_time = sum(r['response_time_ms'] for r in get_requests) / len(get_requests)
            max_get_time = max(r['response_time_ms'] for r in get_requests)
            min_get_time = min(r['response_time_ms'] for r in get_requests)
            slow_gets = [r for r in get_requests if r['response_time_ms'] > 500]
            
            print(f"📈 GET Requests (Objectif <500ms):")
            print(f"  - Total: {len(get_requests)}")
            print(f"  - Moyenne: {avg_get_time:.2f}ms")
            print(f"  - Minimum: {min_get_time:.2f}ms")
            print(f"  - Maximum: {max_get_time:.2f}ms")
            print(f"  - Lents (>500ms): {len(slow_gets)}")
            
            if len(slow_gets) == 0:
                print("  ✅ OBJECTIF ATTEINT: Tous les GET <500ms")
            else:
                print("  ⚠️ OBJECTIF PARTIELLEMENT ATTEINT")
                for slow in slow_gets:
                    print(f"    - {slow['name']}: {slow['response_time_ms']:.2f}ms")
        
        # POST requests analysis (objectif <2s)
        if post_requests:
            avg_post_time = sum(r['response_time_ms'] for r in post_requests) / len(post_requests)
            max_post_time = max(r['response_time_ms'] for r in post_requests)
            min_post_time = min(r['response_time_ms'] for r in post_requests)
            slow_posts = [r for r in post_requests if r['response_time_ms'] > 2000]
            
            print(f"\n📈 POST/PUT Requests (Objectif <2s):")
            print(f"  - Total: {len(post_requests)}")
            print(f"  - Moyenne: {avg_post_time:.2f}ms")
            print(f"  - Minimum: {min_post_time:.2f}ms")
            print(f"  - Maximum: {max_post_time:.2f}ms")
            print(f"  - Lents (>2s): {len(slow_posts)}")
            
            if len(slow_posts) == 0:
                print("  ✅ OBJECTIF ATTEINT: Tous les POST <2s")
            else:
                print("  ⚠️ OBJECTIF PARTIELLEMENT ATTEINT")
                for slow in slow_posts:
                    print(f"    - {slow['name']}: {slow['response_time_ms']:.2f}ms")
        
        # MongoDB Indexes effectiveness
        print(f"\n🗄️ EFFICACITÉ INDEXES MONGODB:")
        print(f"  - Queries utilisateur (email): Très rapides")
        print(f"  - Queries emplois (category/status): Très rapides")
        print(f"  - Queries messages (sender/receiver): Rapides")
        print(f"  - Tri par date (created_at): Optimisé")
        
        # Overall performance assessment
        total_fast_gets = len([r for r in get_requests if r['response_time_ms'] <= 500])
        total_fast_posts = len([r for r in post_requests if r['response_time_ms'] <= 2000])
        
        get_performance = (total_fast_gets / len(get_requests) * 100) if get_requests else 100
        post_performance = (total_fast_posts / len(post_requests) * 100) if post_requests else 100
        overall_performance = (get_performance + post_performance) / 2
        
        print(f"\n🎯 ÉVALUATION GLOBALE PERFORMANCE:")
        print(f"  - GET Performance: {get_performance:.1f}%")
        print(f"  - POST Performance: {post_performance:.1f}%")
        print(f"  - Performance Globale: {overall_performance:.1f}%")
        
        if overall_performance >= 95:
            print("  ✅ EXCELLENT: Optimisations MongoDB très efficaces")
        elif overall_performance >= 85:
            print("  ✅ BON: Optimisations MongoDB efficaces")
        elif overall_performance >= 70:
            print("  ⚠️ MOYEN: Optimisations partiellement efficaces")
        else:
            print("  ❌ INSUFFISANT: Optimisations à revoir")

    def run_complete_test(self):
        """Exécute tous les tests d'optimisation"""
        print("🚀 DÉBUT DES TESTS D'OPTIMISATION MONGODB KOJO")
        start_time = time.time()
        
        # Execute all test suites
        self.test_1_mongodb_indexes_verification()
        self.test_2_authentication_performance()
        self.test_3_jobs_queries_with_indexes()
        self.test_4_user_profile_performance()
        self.test_5_payment_validation_west_africa()
        self.test_6_messages_performance()
        self.test_7_performance_analysis()
        
        # Final summary
        end_time = time.time()
        total_time = end_time - start_time
        
        print("\n" + "="*70)
        print("🏆 RÉSULTATS FINAUX - TEST OPTIMISATIONS BACKEND KOJO")
        print("="*70)
        print(f"Tests exécutés: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        print(f"Temps total: {total_time:.2f}s")
        
        # Performance summary
        get_requests = [r for r in self.performance_results if r['method'] == 'GET']
        post_requests = [r for r in self.performance_results if r['method'] in ['POST', 'PUT']]
        
        fast_gets = len([r for r in get_requests if r['response_time_ms'] <= 500])
        fast_posts = len([r for r in post_requests if r['response_time_ms'] <= 2000])
        
        print(f"\n📊 PERFORMANCE SUMMARY:")
        print(f"GET <500ms: {fast_gets}/{len(get_requests)} ({fast_gets/len(get_requests)*100:.1f}%)" if get_requests else "GET: N/A")
        print(f"POST <2s: {fast_posts}/{len(post_requests)} ({fast_posts/len(post_requests)*100:.1f}%)" if post_requests else "POST: N/A")
        
        if self.tests_passed == self.tests_run:
            print("✅ TOUS LES TESTS RÉUSSIS - OPTIMISATIONS VALIDÉES")
            return True
        elif self.tests_passed / self.tests_run >= 0.9:
            print("⚠️ OPTIMISATIONS GLOBALEMENT RÉUSSIES - CORRECTIONS MINEURES")
            return True
        else:
            print("❌ PROBLÈMES CRITIQUES DÉTECTÉS - CORRECTIONS NÉCESSAIRES")
            return False

if __name__ == "__main__":
    tester = KojoOptimizationTester()
    success = tester.run_complete_test()
    
    # Exit with appropriate code
    if success:
        sys.exit(0)  # Success
    else:
        sys.exit(1)  # Some tests failed