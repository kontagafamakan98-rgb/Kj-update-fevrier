#!/usr/bin/env python3
"""
AUDIT BACKEND COMPLET - OPTIMISATION AFRIQUE DE L'OUEST
Comprehensive backend audit for West Africa optimization as requested in French review.

Tests cover:
1. Performance API endpoints under load
2. Authentication system with JWT optimization
3. Payment APIs (Orange Money, Wave) for West African countries
4. Geographical data management for 4 priority countries
5. Network optimization (gzip, cache headers, rate limiting)
6. Jobs/Employment system with local categories
7. West Africa security (phone validation, injection protection)
"""

import requests
import time
import json
import sys
import threading
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
import base64
import io

class WestAfricaAuditTester:
    def __init__(self, base_url="https://local-connect-43.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.performance_results = []
        self.security_results = []
        self.payment_results = []
        self.geographical_results = []
        
        # Test tokens and users
        self.client_token = None
        self.worker_token = None
        self.owner_token = None
        self.test_users = []
        
        print("🌍 AUDIT BACKEND COMPLET - OPTIMISATION AFRIQUE DE L'OUEST")
        print("=" * 80)
        print("OBJECTIF: Backend prêt pour 84M+ utilisateurs ouest-africains")
        print("PAYS PRIORITAIRES: Sénégal, Mali, Côte d'Ivoire, Burkina Faso")
        print("=" * 80)

    def log_result(self, category, test_name, success, details=""):
        """Log test results by category"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        
        if category == "performance":
            self.performance_results.append(result)
        elif category == "security":
            self.security_results.append(result)
        elif category == "payment":
            self.payment_results.append(result)
        elif category == "geographical":
            self.geographical_results.append(result)

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None, timeout=10):
        """Run a single API test with performance measurement"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        start_time = time.time()
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=timeout)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=timeout)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=timeout)

            response_time = (time.time() - start_time) * 1000  # Convert to milliseconds
            success = response.status_code == expected_status
            
            if success:
                self.tests_passed += 1
                print(f"✅ {name} - {response.status_code} ({response_time:.0f}ms)")
                try:
                    response_data = response.json()
                    return True, response_data, response_time
                except:
                    return True, {}, response_time
            else:
                print(f"❌ {name} - Expected {expected_status}, got {response.status_code} ({response_time:.0f}ms)")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                    return False, error_data, response_time
                except:
                    print(f"   Error: {response.text}")
                    return False, {}, response_time

        except requests.exceptions.Timeout:
            response_time = timeout * 1000
            print(f"❌ {name} - TIMEOUT after {timeout}s")
            return False, {"error": "timeout"}, response_time
        except Exception as e:
            response_time = (time.time() - start_time) * 1000
            print(f"❌ {name} - Error: {str(e)}")
            return False, {"error": str(e)}, response_time

    def test_1_performance_api_endpoints(self):
        """1. PERFORMANCE API ENDPOINTS - Test under load for 2G/3G optimization"""
        print("\n" + "="*60)
        print("1. 🚀 PERFORMANCE API ENDPOINTS - OPTIMISATION 2G/3G")
        print("="*60)
        print("OBJECTIF: Temps de réponse <500ms pour réseaux lents")
        
        # Test basic endpoints performance
        endpoints_to_test = [
            ("health", "GET", "health"),
            ("root", "GET", ""),
            ("stats", "GET", "stats")
        ]
        
        performance_results = []
        
        for name, method, endpoint in endpoints_to_test:
            print(f"\n🔍 Testing {name} endpoint performance...")
            
            # Run multiple requests to measure average performance
            times = []
            for i in range(5):
                success, data, response_time = self.run_test(
                    f"{name} performance test {i+1}",
                    method,
                    endpoint,
                    200,
                    timeout=2  # 2 second timeout for performance test
                )
                if success:
                    times.append(response_time)
            
            if times:
                avg_time = sum(times) / len(times)
                max_time = max(times)
                min_time = min(times)
                
                performance_results.append({
                    "endpoint": endpoint,
                    "avg_time": avg_time,
                    "max_time": max_time,
                    "min_time": min_time,
                    "under_500ms": avg_time < 500
                })
                
                print(f"   📊 Performance: Avg={avg_time:.0f}ms, Max={max_time:.0f}ms, Min={min_time:.0f}ms")
                
                if avg_time < 500:
                    print(f"   ✅ EXCELLENT: Sous 500ms pour réseaux 2G/3G")
                    self.log_result("performance", f"{name}_performance", True, f"Average: {avg_time:.0f}ms")
                else:
                    print(f"   ⚠️  ATTENTION: Dépasse 500ms - optimisation nécessaire")
                    self.log_result("performance", f"{name}_performance", False, f"Average: {avg_time:.0f}ms > 500ms")
        
        # Test concurrent load
        print(f"\n🔍 Testing concurrent load (10 simultaneous requests)...")
        
        def make_request():
            return self.run_test("concurrent_health", "GET", "health", 200, timeout=5)
        
        start_time = time.time()
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(make_request) for _ in range(10)]
            results = [future.result() for future in as_completed(futures)]
        
        total_time = (time.time() - start_time) * 1000
        successful_requests = sum(1 for success, _, _ in results if success)
        
        print(f"   📊 Concurrent Load: {successful_requests}/10 successful in {total_time:.0f}ms")
        
        if successful_requests >= 8 and total_time < 3000:  # 8/10 success in under 3s
            print(f"   ✅ EXCELLENT: Gestion charge concurrente réussie")
            self.log_result("performance", "concurrent_load", True, f"{successful_requests}/10 in {total_time:.0f}ms")
        else:
            print(f"   ⚠️  ATTENTION: Performance charge concurrente à améliorer")
            self.log_result("performance", "concurrent_load", False, f"{successful_requests}/10 in {total_time:.0f}ms")

    def test_2_authentication_system(self):
        """2. SYSTÈME AUTHENTIFICATION - JWT optimisé pour sessions longues"""
        print("\n" + "="*60)
        print("2. 🔐 SYSTÈME AUTHENTIFICATION - JWT OPTIMISÉ")
        print("="*60)
        print("OBJECTIF: JWT avec expiration optimisée, sécurité endpoints protégés")
        
        # Test user registration and login for authentication tests
        print(f"\n🔍 Setting up test users for authentication tests...")
        
        # Register test client
        client_data = {
            "email": f"auth_client_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Aminata",
            "last_name": "Diallo",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response, _ = self.run_test(
            "Client Registration for Auth Tests",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            print(f"   ✅ Client token obtained for authentication tests")
            self.log_result("security", "client_registration", True, "Token obtained")
        else:
            print(f"   ❌ Failed to obtain client token")
            self.log_result("security", "client_registration", False, "Token not obtained")
        
        # Test JWT token structure and expiration
        if self.client_token:
            print(f"\n🔍 Testing JWT token structure and expiration...")
            
            try:
                import jwt
                # Decode without verification to check structure
                decoded = jwt.decode(self.client_token, options={"verify_signature": False})
                
                # Check required fields
                required_fields = ['sub', 'email', 'exp']
                has_all_fields = all(field in decoded for field in required_fields)
                
                if has_all_fields:
                    print(f"   ✅ JWT contient tous les champs requis: {required_fields}")
                    self.log_result("security", "jwt_structure", True, "All required fields present")
                    
                    # Check expiration time (should be reasonable for West Africa usage)
                    exp_timestamp = decoded['exp']
                    exp_datetime = datetime.fromtimestamp(exp_timestamp)
                    now = datetime.now()
                    time_until_exp = exp_datetime - now
                    
                    print(f"   📊 Token expires in: {time_until_exp}")
                    
                    # Should expire in reasonable time (not too short, not too long)
                    if timedelta(hours=1) <= time_until_exp <= timedelta(days=7):
                        print(f"   ✅ Expiration optimisée pour usage Afrique de l'Ouest")
                        self.log_result("security", "jwt_expiration", True, f"Expires in {time_until_exp}")
                    else:
                        print(f"   ⚠️  Expiration pourrait être optimisée")
                        self.log_result("security", "jwt_expiration", False, f"Expires in {time_until_exp}")
                else:
                    print(f"   ❌ JWT manque des champs requis")
                    self.log_result("security", "jwt_structure", False, "Missing required fields")
                    
            except Exception as e:
                print(f"   ❌ Erreur analyse JWT: {e}")
                self.log_result("security", "jwt_analysis", False, str(e))
        
        # Test protected endpoints security
        print(f"\n🔍 Testing protected endpoints security...")
        
        protected_endpoints = [
            ("users/profile", "GET"),
            ("jobs", "GET"),
            ("messages/conversations", "GET")
        ]
        
        for endpoint, method in protected_endpoints:
            # Test without token (should fail)
            success, _, _ = self.run_test(
                f"Protected {endpoint} without token",
                method,
                endpoint,
                403  # Should return 403 Forbidden
            )
            
            if success:
                print(f"   ✅ {endpoint} correctement protégé (403 sans token)")
                self.log_result("security", f"{endpoint}_protection", True, "403 without token")
            else:
                print(f"   ❌ {endpoint} pas correctement protégé")
                self.log_result("security", f"{endpoint}_protection", False, "Not properly protected")
            
            # Test with valid token (should succeed)
            if self.client_token:
                success, _, _ = self.run_test(
                    f"Protected {endpoint} with valid token",
                    method,
                    endpoint,
                    200,
                    token=self.client_token
                )
                
                if success:
                    print(f"   ✅ {endpoint} accessible avec token valide")
                    self.log_result("security", f"{endpoint}_access", True, "200 with valid token")
                else:
                    print(f"   ❌ {endpoint} pas accessible avec token valide")
                    self.log_result("security", f"{endpoint}_access", False, "Failed with valid token")

    def test_3_payment_apis_west_africa(self):
        """3. APIS PAIEMENT - Orange Money, Wave pour pays ouest-africains"""
        print("\n" + "="*60)
        print("3. 💰 APIS PAIEMENT ACTUELLES - AFRIQUE DE L'OUEST")
        print("="*60)
        print("OBJECTIF: Validation Orange Money/Wave pour +221,+223,+225,+226")
        
        # Test Orange Money validation for West African countries
        print(f"\n🔍 Testing Orange Money validation for West African countries...")
        
        orange_money_tests = [
            {"country": "Sénégal", "prefix": "+221", "number": "+221701234567"},
            {"country": "Mali", "prefix": "+223", "number": "+223701234567"},
            {"country": "Côte d'Ivoire", "prefix": "+225", "number": "+225701234567"},
            {"country": "Burkina Faso", "prefix": "+226", "number": "+226701234567"}
        ]
        
        orange_success_count = 0
        for test_data in orange_money_tests:
            user_data = {
                "email": f"orange_{test_data['prefix'].replace('+', '')}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Orange",
                "phone": test_data['number'],
                "user_type": "client",
                "country": "senegal",  # Use valid enum value
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test_data['number']
                }
            }
            
            success, response, _ = self.run_test(
                f"Orange Money {test_data['country']} ({test_data['number']})",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success:
                orange_success_count += 1
                print(f"   ✅ Orange Money {test_data['country']} validé")
                self.log_result("payment", f"orange_money_{test_data['country']}", True, test_data['number'])
            else:
                print(f"   ❌ Orange Money {test_data['country']} échoué")
                self.log_result("payment", f"orange_money_{test_data['country']}", False, test_data['number'])
        
        print(f"   📊 Orange Money: {orange_success_count}/4 pays validés")
        
        # Test Wave validation for West African countries
        print(f"\n🔍 Testing Wave validation for West African countries...")
        
        wave_tests = [
            {"country": "Sénégal", "prefix": "+221", "number": "+221701234567"},
            {"country": "Mali", "prefix": "+223", "number": "+223701234567"},
            {"country": "Côte d'Ivoire", "prefix": "+225", "number": "+225701234567"},
            {"country": "Burkina Faso", "prefix": "+226", "number": "+226701234567"}
        ]
        
        wave_success_count = 0
        for test_data in wave_tests:
            user_data = {
                "email": f"wave_{test_data['prefix'].replace('+', '')}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Wave",
                "phone": test_data['number'],
                "user_type": "client",
                "country": "senegal",  # Use valid enum value
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": test_data['number']
                }
            }
            
            success, response, _ = self.run_test(
                f"Wave {test_data['country']} ({test_data['number']})",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success:
                wave_success_count += 1
                print(f"   ✅ Wave {test_data['country']} validé")
                self.log_result("payment", f"wave_{test_data['country']}", True, test_data['number'])
            else:
                print(f"   ❌ Wave {test_data['country']} échoué")
                self.log_result("payment", f"wave_{test_data['country']}", False, test_data['number'])
        
        print(f"   📊 Wave: {wave_success_count}/4 pays validés")
        
        # Test bank account validation for West Africa
        print(f"\n🔍 Testing bank account validation for West Africa...")
        
        bank_account_data = {
            "email": f"bank_wa_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Amadou",
            "last_name": "Traore",
            "phone": "+223701234567",
            "user_type": "client",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "12345678901234",
                    "bank_name": "Banque Atlantique Mali",
                    "account_holder": "Amadou Traore",
                    "bank_code": "BA001",
                    "branch": "Bamako Plateau"
                }
            }
        }
        
        success, response, _ = self.run_test(
            "Bank Account West Africa",
            "POST",
            "auth/register-verified",
            200,
            data=bank_account_data
        )
        
        if success:
            print(f"   ✅ Comptes bancaires ouest-africains validés")
            self.log_result("payment", "bank_account_west_africa", True, "Bank account validation working")
        else:
            print(f"   ❌ Comptes bancaires ouest-africains échoués")
            self.log_result("payment", "bank_account_west_africa", False, "Bank account validation failed")
        
        # Test phone prefix validation (70-99 range)
        print(f"\n🔍 Testing phone prefix validation (70-99 range)...")
        
        prefix_tests = [
            "+221701234567",  # 70 prefix
            "+221751234567",  # 75 prefix
            "+221801234567",  # 80 prefix
            "+221901234567",  # 90 prefix
            "+221991234567"   # 99 prefix
        ]
        
        prefix_success_count = 0
        for phone_number in prefix_tests:
            user_data = {
                "email": f"prefix_{phone_number.replace('+', '').replace('1234567', '')}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Prefix",
                "phone": phone_number,
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": phone_number
                }
            }
            
            success, response, _ = self.run_test(
                f"Phone prefix {phone_number}",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success:
                prefix_success_count += 1
                print(f"   ✅ Préfixe {phone_number} validé")
                self.log_result("payment", f"prefix_{phone_number}", True, "Prefix validation working")
            else:
                print(f"   ❌ Préfixe {phone_number} échoué")
                self.log_result("payment", f"prefix_{phone_number}", False, "Prefix validation failed")
        
        print(f"   📊 Préfixes téléphone: {prefix_success_count}/5 validés")

    def test_4_geographical_data_management(self):
        """4. GESTION DONNÉES GÉOGRAPHIQUES - 4 pays prioritaires"""
        print("\n" + "="*60)
        print("4. 🌍 GESTION DONNÉES GÉOGRAPHIQUES - 4 PAYS")
        print("="*60)
        print("OBJECTIF: Détection pays, données villes/régions, géolocalisation")
        
        # Test country detection through user registration
        print(f"\n🔍 Testing country detection and validation...")
        
        priority_countries = [
            {"country": "senegal", "name": "Sénégal", "phone": "+221701234567"},
            {"country": "mali", "name": "Mali", "phone": "+223701234567"},
            {"country": "ivory_coast", "name": "Côte d'Ivoire", "phone": "+225701234567"},
            {"country": "burkina_faso", "name": "Burkina Faso", "phone": "+226701234567"}
        ]
        
        country_success_count = 0
        for country_data in priority_countries:
            user_data = {
                "email": f"geo_{country_data['country']}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Geo",
                "phone": country_data['phone'],
                "user_type": "client",
                "country": country_data['country'],
                "preferred_language": "fr"
            }
            
            success, response, _ = self.run_test(
                f"Country {country_data['name']} registration",
                "POST",
                "auth/register",
                200,
                data=user_data
            )
            
            if success and response.get('user', {}).get('country') == country_data['country']:
                country_success_count += 1
                print(f"   ✅ {country_data['name']} détecté et validé")
                self.log_result("geographical", f"country_{country_data['country']}", True, "Country detection working")
            else:
                print(f"   ❌ {country_data['name']} détection échouée")
                self.log_result("geographical", f"country_{country_data['country']}", False, "Country detection failed")
        
        print(f"   📊 Pays détectés: {country_success_count}/4")
        
        # Test location data in job creation
        print(f"\n🔍 Testing location data management in jobs...")
        
        if self.client_token:
            # Test job creation with West African locations
            west_african_locations = [
                {
                    "name": "Dakar, Sénégal",
                    "location": {
                        "address": "Plateau, Dakar, Sénégal",
                        "city": "Dakar",
                        "region": "Dakar",
                        "country": "Sénégal",
                        "latitude": 14.6937,
                        "longitude": -17.4441
                    }
                },
                {
                    "name": "Bamako, Mali",
                    "location": {
                        "address": "Commune III, Bamako, Mali",
                        "city": "Bamako",
                        "region": "Bamako",
                        "country": "Mali",
                        "latitude": 12.6392,
                        "longitude": -8.0029
                    }
                },
                {
                    "name": "Abidjan, Côte d'Ivoire",
                    "location": {
                        "address": "Plateau, Abidjan, Côte d'Ivoire",
                        "city": "Abidjan",
                        "region": "Lagunes",
                        "country": "Côte d'Ivoire",
                        "latitude": 5.3600,
                        "longitude": -4.0083
                    }
                },
                {
                    "name": "Ouagadougou, Burkina Faso",
                    "location": {
                        "address": "Secteur 1, Ouagadougou, Burkina Faso",
                        "city": "Ouagadougou",
                        "region": "Centre",
                        "country": "Burkina Faso",
                        "latitude": 12.3714,
                        "longitude": -1.5197
                    }
                }
            ]
            
            location_success_count = 0
            for i, location_data in enumerate(west_african_locations):
                job_data = {
                    "title": f"Réparation plomberie {location_data['name']}",
                    "description": f"Réparation urgente de plomberie à {location_data['name']}",
                    "category": "plomberie",
                    "budget_min": 50000.0,
                    "budget_max": 100000.0,
                    "location": location_data['location'],
                    "required_skills": ["plomberie"],
                    "estimated_duration": "2-3 heures"
                }
                
                success, response, _ = self.run_test(
                    f"Job creation {location_data['name']}",
                    "POST",
                    "jobs",
                    200,
                    data=job_data,
                    token=self.client_token
                )
                
                if success and 'location' in response:
                    location_success_count += 1
                    print(f"   ✅ Localisation {location_data['name']} enregistrée")
                    self.log_result("geographical", f"location_{i}", True, location_data['name'])
                else:
                    print(f"   ❌ Localisation {location_data['name']} échouée")
                    self.log_result("geographical", f"location_{i}", False, location_data['name'])
            
            print(f"   📊 Localisations: {location_success_count}/4 enregistrées")
        else:
            print(f"   ⚠️  Pas de token client - skip test localisation")

    def test_5_network_optimization(self):
        """5. OPTIMISATION RÉSEAU - Compression, cache, rate limiting"""
        print("\n" + "="*60)
        print("5. 🌐 OPTIMISATION RÉSEAU - RÉSEAUX LENTS")
        print("="*60)
        print("OBJECTIF: Compression gzip, cache headers, rate limiting")
        
        # Test gzip compression
        print(f"\n🔍 Testing gzip compression support...")
        
        headers = {
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json'
        }
        
        try:
            response = requests.get(f"{self.base_url}/health", headers=headers, timeout=5)
            
            # Check if response is compressed
            content_encoding = response.headers.get('Content-Encoding', '')
            content_length = len(response.content)
            
            if 'gzip' in content_encoding:
                print(f"   ✅ Compression gzip activée")
                print(f"   📊 Taille réponse compressée: {content_length} bytes")
                self.log_result("performance", "gzip_compression", True, f"Content-Encoding: {content_encoding}")
            else:
                print(f"   ⚠️  Compression gzip non détectée")
                print(f"   📊 Taille réponse: {content_length} bytes")
                self.log_result("performance", "gzip_compression", False, "No gzip compression detected")
                
        except Exception as e:
            print(f"   ❌ Erreur test compression: {e}")
            self.log_result("performance", "gzip_compression", False, str(e))
        
        # Test cache headers
        print(f"\n🔍 Testing cache headers for optimization...")
        
        cache_test_endpoints = [
            ("health", "health"),
            ("stats", "stats"),
            ("root", "")
        ]
        
        cache_success_count = 0
        for name, endpoint in cache_test_endpoints:
            try:
                response = requests.get(f"{self.base_url}/{endpoint}", timeout=5)
                
                cache_control = response.headers.get('Cache-Control', '')
                x_kojo_region = response.headers.get('X-Kojo-Region', '')
                x_kojo_version = response.headers.get('X-Kojo-Version', '')
                
                has_cache_headers = bool(cache_control)
                has_kojo_headers = bool(x_kojo_region and x_kojo_version)
                
                if has_cache_headers and has_kojo_headers:
                    cache_success_count += 1
                    print(f"   ✅ {name}: Cache-Control={cache_control}, Region={x_kojo_region}")
                    self.log_result("performance", f"cache_headers_{name}", True, f"Cache-Control: {cache_control}")
                else:
                    print(f"   ⚠️  {name}: Headers cache manquants")
                    self.log_result("performance", f"cache_headers_{name}", False, "Missing cache headers")
                    
            except Exception as e:
                print(f"   ❌ Erreur test cache {name}: {e}")
                self.log_result("performance", f"cache_headers_{name}", False, str(e))
        
        print(f"   📊 Cache headers: {cache_success_count}/3 endpoints optimisés")
        
        # Test rate limiting (basic test)
        print(f"\n🔍 Testing rate limiting behavior...")
        
        # Make rapid requests to test rate limiting
        rapid_requests = []
        start_time = time.time()
        
        for i in range(20):  # 20 rapid requests
            try:
                response = requests.get(f"{self.base_url}/health", timeout=1)
                rapid_requests.append({
                    "status": response.status_code,
                    "time": time.time() - start_time
                })
            except:
                rapid_requests.append({
                    "status": "timeout",
                    "time": time.time() - start_time
                })
        
        total_time = time.time() - start_time
        successful_requests = sum(1 for req in rapid_requests if req["status"] == 200)
        rate_limited_requests = sum(1 for req in rapid_requests if req["status"] == 429)
        
        print(f"   📊 Requêtes rapides: {successful_requests}/20 réussies en {total_time:.1f}s")
        
        if rate_limited_requests > 0:
            print(f"   ✅ Rate limiting détecté: {rate_limited_requests} requêtes limitées")
            self.log_result("performance", "rate_limiting", True, f"{rate_limited_requests} requests rate limited")
        else:
            print(f"   ⚠️  Rate limiting non détecté")
            self.log_result("performance", "rate_limiting", False, "No rate limiting detected")

    def test_6_jobs_employment_system(self):
        """6. SYSTÈME EMPLOIS/JOBS - CRUD complet, catégories locales"""
        print("\n" + "="*60)
        print("6. 💼 SYSTÈME EMPLOIS/JOBS - MÉTIERS LOCAUX")
        print("="*60)
        print("OBJECTIF: CRUD emplois, catégories métiers ouest-africains")
        
        if not self.client_token:
            print("   ⚠️  Pas de token client - création token pour tests emplois")
            # Create a client for job tests
            client_data = {
                "email": f"job_client_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Client",
                "last_name": "Jobs",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            success, response, _ = self.run_test(
                "Client creation for job tests",
                "POST",
                "auth/register",
                200,
                data=client_data
            )
            
            if success and 'access_token' in response:
                self.client_token = response['access_token']
        
        if not self.client_token:
            print("   ❌ Impossible de créer token client - skip tests emplois")
            return
        
        # Test job creation with West African job categories
        print(f"\n🔍 Testing job creation with West African categories...")
        
        west_african_jobs = [
            {
                "title": "Réparation moto Jakarta",
                "description": "Réparation moteur moto Jakarta 125cc à Dakar",
                "category": "mécanique_moto",
                "budget_min": 25000.0,
                "budget_max": 50000.0,
                "skills": ["mécanique", "moto", "jakarta"],
                "location": "Dakar, Sénégal"
            },
            {
                "title": "Installation pompe solaire",
                "description": "Installation système pompage solaire pour puits village",
                "category": "énergie_solaire",
                "budget_min": 500000.0,
                "budget_max": 1000000.0,
                "skills": ["solaire", "pompage", "électricité"],
                "location": "Bamako, Mali"
            },
            {
                "title": "Couture boubou traditionnel",
                "description": "Confection boubou traditionnel pour cérémonie",
                "category": "couture_traditionnelle",
                "budget_min": 15000.0,
                "budget_max": 30000.0,
                "skills": ["couture", "traditionnel", "boubou"],
                "location": "Abidjan, Côte d'Ivoire"
            },
            {
                "title": "Construction case en banco",
                "description": "Construction case traditionnelle en banco avec toit de chaume",
                "category": "construction_traditionnelle",
                "budget_min": 200000.0,
                "budget_max": 400000.0,
                "skills": ["construction", "banco", "traditionnel"],
                "location": "Ouagadougou, Burkina Faso"
            },
            {
                "title": "Réparation téléphone portable",
                "description": "Réparation écran et batterie smartphone",
                "category": "réparation_électronique",
                "budget_min": 10000.0,
                "budget_max": 25000.0,
                "skills": ["électronique", "téléphone", "réparation"],
                "location": "Dakar, Sénégal"
            }
        ]
        
        created_jobs = []
        job_creation_success = 0
        
        for i, job_info in enumerate(west_african_jobs):
            job_data = {
                "title": job_info["title"],
                "description": job_info["description"],
                "category": job_info["category"],
                "budget_min": job_info["budget_min"],
                "budget_max": job_info["budget_max"],
                "location": {
                    "address": job_info["location"],
                    "latitude": 14.6937,  # Default to Dakar coordinates
                    "longitude": -17.4441
                },
                "required_skills": job_info["skills"],
                "estimated_duration": "1-3 jours"
            }
            
            success, response, _ = self.run_test(
                f"Create job: {job_info['title']}",
                "POST",
                "jobs",
                200,
                data=job_data,
                token=self.client_token
            )
            
            if success and 'id' in response:
                job_creation_success += 1
                created_jobs.append(response['id'])
                print(f"   ✅ Emploi créé: {job_info['category']}")
                self.log_result("geographical", f"job_creation_{i}", True, job_info['category'])
            else:
                print(f"   ❌ Échec création: {job_info['category']}")
                self.log_result("geographical", f"job_creation_{i}", False, job_info['category'])
        
        print(f"   📊 Emplois créés: {job_creation_success}/5")
        
        # Test job retrieval and filtering
        print(f"\n🔍 Testing job retrieval and filtering...")
        
        # Get all jobs
        success, response, _ = self.run_test(
            "Get all jobs",
            "GET",
            "jobs",
            200,
            token=self.client_token
        )
        
        if success and isinstance(response, list):
            total_jobs = len(response)
            print(f"   ✅ Récupération emplois: {total_jobs} emplois trouvés")
            self.log_result("geographical", "job_retrieval", True, f"{total_jobs} jobs found")
        else:
            print(f"   ❌ Échec récupération emplois")
            self.log_result("geographical", "job_retrieval", False, "Failed to retrieve jobs")
        
        # Test job filtering by category
        test_categories = ["mécanique_moto", "énergie_solaire", "couture_traditionnelle"]
        
        for category in test_categories:
            success, response, _ = self.run_test(
                f"Filter jobs by category: {category}",
                "GET",
                f"jobs?category={category}",
                200,
                token=self.client_token
            )
            
            if success:
                filtered_count = len(response) if isinstance(response, list) else 0
                print(f"   ✅ Filtrage {category}: {filtered_count} emplois")
                self.log_result("geographical", f"job_filter_{category}", True, f"{filtered_count} jobs")
            else:
                print(f"   ❌ Échec filtrage {category}")
                self.log_result("geographical", f"job_filter_{category}", False, "Filter failed")
        
        # Test individual job retrieval
        if created_jobs:
            job_id = created_jobs[0]
            success, response, _ = self.run_test(
                f"Get specific job: {job_id}",
                "GET",
                f"jobs/{job_id}",
                200,
                token=self.client_token
            )
            
            if success and response.get('id') == job_id:
                print(f"   ✅ Récupération emploi spécifique réussie")
                self.log_result("geographical", "specific_job_retrieval", True, job_id)
            else:
                print(f"   ❌ Échec récupération emploi spécifique")
                self.log_result("geographical", "specific_job_retrieval", False, job_id)

    def test_7_west_africa_security(self):
        """7. SÉCURITÉ WEST AFRICA - Validation téléphone, protection injection"""
        print("\n" + "="*60)
        print("7. 🔒 SÉCURITÉ WEST AFRICA - PROTECTION AVANCÉE")
        print("="*60)
        print("OBJECTIF: Validation téléphone local, protection injection SQL/NoSQL")
        
        # Test West African phone number validation
        print(f"\n🔍 Testing West African phone number validation...")
        
        valid_phone_tests = [
            {"phone": "+221701234567", "country": "Sénégal"},
            {"phone": "+223701234567", "country": "Mali"},
            {"phone": "+225701234567", "country": "Côte d'Ivoire"},
            {"phone": "+226701234567", "country": "Burkina Faso"},
            {"phone": "+221 70 123 45 67", "country": "Sénégal (avec espaces)"},
            {"phone": "+223-70-123-45-67", "country": "Mali (avec tirets)"}
        ]
        
        phone_validation_success = 0
        for test_data in valid_phone_tests:
            user_data = {
                "email": f"phone_test_{datetime.now().strftime('%H%M%S%f')[:-3]}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Phone",
                "phone": test_data["phone"],
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            success, response, _ = self.run_test(
                f"Valid phone {test_data['country']}: {test_data['phone']}",
                "POST",
                "auth/register",
                200,
                data=user_data
            )
            
            if success:
                phone_validation_success += 1
                print(f"   ✅ Téléphone {test_data['country']} validé")
                self.log_result("security", f"phone_validation_{test_data['country']}", True, test_data['phone'])
            else:
                print(f"   ❌ Téléphone {test_data['country']} échoué")
                self.log_result("security", f"phone_validation_{test_data['country']}", False, test_data['phone'])
        
        print(f"   📊 Validation téléphone: {phone_validation_success}/6 réussies")
        
        # Test invalid phone numbers (should be rejected)
        print(f"\n🔍 Testing invalid phone number rejection...")
        
        invalid_phone_tests = [
            {"phone": "+1234567890", "reason": "Non-West African prefix"},
            {"phone": "+33123456789", "reason": "European prefix"},
            {"phone": "221701234567", "reason": "Missing + sign"},
            {"phone": "+22170123456", "reason": "Too short"},
            {"phone": "+2217012345678", "reason": "Too long"},
            {"phone": "+221601234567", "reason": "Invalid operator prefix (60)"}
        ]
        
        invalid_phone_rejection_success = 0
        for test_data in invalid_phone_tests:
            user_data = {
                "email": f"invalid_phone_{datetime.now().strftime('%H%M%S%f')[:-3]}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "InvalidPhone",
                "phone": test_data["phone"],
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            success, response, _ = self.run_test(
                f"Invalid phone ({test_data['reason']}): {test_data['phone']}",
                "POST",
                "auth/register",
                422,  # Should return validation error
                data=user_data
            )
            
            if success:  # Success means it was properly rejected
                invalid_phone_rejection_success += 1
                print(f"   ✅ Téléphone invalide correctement rejeté: {test_data['reason']}")
                self.log_result("security", f"invalid_phone_rejection_{test_data['reason']}", True, test_data['phone'])
            else:
                print(f"   ❌ Téléphone invalide accepté: {test_data['reason']}")
                self.log_result("security", f"invalid_phone_rejection_{test_data['reason']}", False, test_data['phone'])
        
        print(f"   📊 Rejet téléphones invalides: {invalid_phone_rejection_success}/6 réussies")
        
        # Test SQL/NoSQL injection protection
        print(f"\n🔍 Testing SQL/NoSQL injection protection...")
        
        injection_tests = [
            {
                "email": "admin'/**/OR/**/1=1#@test.com",
                "reason": "SQL injection in email"
            },
            {
                "email": "test@test.com'; DROP TABLE users; --",
                "reason": "SQL DROP command injection"
            },
            {
                "first_name": "'; DELETE FROM users WHERE '1'='1",
                "reason": "SQL injection in first_name"
            },
            {
                "last_name": "$where: '1==1'",
                "reason": "NoSQL injection in last_name"
            }
        ]
        
        injection_protection_success = 0
        for i, test_data in enumerate(injection_tests):
            user_data = {
                "email": test_data.get("email", f"injection_test_{i}@test.com"),
                "password": "TestPass123!",
                "first_name": test_data.get("first_name", "Test"),
                "last_name": test_data.get("last_name", "Injection"),
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            success, response, _ = self.run_test(
                f"Injection test: {test_data['reason']}",
                "POST",
                "auth/register",
                400,  # Should return error (not 200)
                data=user_data
            )
            
            if success:  # Success means injection was blocked
                injection_protection_success += 1
                print(f"   ✅ Injection bloquée: {test_data['reason']}")
                self.log_result("security", f"injection_protection_{i}", True, test_data['reason'])
            else:
                print(f"   ❌ Injection non bloquée: {test_data['reason']}")
                self.log_result("security", f"injection_protection_{i}", False, test_data['reason'])
        
        print(f"   📊 Protection injection: {injection_protection_success}/4 réussies")
        
        # Test file upload limits and validation
        print(f"\n🔍 Testing file upload limits and validation...")
        
        if not self.client_token:
            # Create a client for file upload tests
            client_data = {
                "email": f"upload_client_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Upload",
                "last_name": "Test",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            success, response, _ = self.run_test(
                "Client creation for upload tests",
                "POST",
                "auth/register",
                200,
                data=client_data
            )
            
            if success and 'access_token' in response:
                self.client_token = response['access_token']
        
        if self.client_token:
            # Test oversized file upload (should be rejected)
            print(f"   🔍 Testing oversized file upload rejection...")
            
            # Create a large file (6MB - exceeds 5MB limit)
            large_file_data = b'x' * (6 * 1024 * 1024)
            files = {'file': ('large_photo.jpg', io.BytesIO(large_file_data), 'image/jpeg')}
            
            try:
                response = requests.post(
                    f"{self.base_url}/users/profile-photo",
                    headers={'Authorization': f'Bearer {self.client_token}'},
                    files=files,
                    timeout=10
                )
                
                if response.status_code == 400:
                    print(f"   ✅ Fichier trop volumineux correctement rejeté")
                    self.log_result("security", "file_size_limit", True, "6MB file rejected")
                else:
                    print(f"   ❌ Fichier trop volumineux accepté")
                    self.log_result("security", "file_size_limit", False, f"6MB file got {response.status_code}")
                    
            except Exception as e:
                print(f"   ❌ Erreur test fichier volumineux: {e}")
                self.log_result("security", "file_size_limit", False, str(e))
            
            # Test non-image file upload (should be rejected)
            print(f"   🔍 Testing non-image file upload rejection...")
            
            text_file_data = b'This is not an image file'
            files = {'file': ('document.txt', io.BytesIO(text_file_data), 'text/plain')}
            
            try:
                response = requests.post(
                    f"{self.base_url}/users/profile-photo",
                    headers={'Authorization': f'Bearer {self.client_token}'},
                    files=files,
                    timeout=5
                )
                
                if response.status_code == 400:
                    print(f"   ✅ Fichier non-image correctement rejeté")
                    self.log_result("security", "file_type_validation", True, "Text file rejected")
                else:
                    print(f"   ❌ Fichier non-image accepté")
                    self.log_result("security", "file_type_validation", False, f"Text file got {response.status_code}")
                    
            except Exception as e:
                print(f"   ❌ Erreur test fichier non-image: {e}")
                self.log_result("security", "file_type_validation", False, str(e))
        else:
            print(f"   ⚠️  Pas de token client - skip tests upload")

    def generate_audit_report(self):
        """Generate comprehensive audit report"""
        print("\n" + "="*80)
        print("📊 RAPPORT D'AUDIT COMPLET - OPTIMISATION AFRIQUE DE L'OUEST")
        print("="*80)
        
        total_tests = self.tests_run
        passed_tests = self.tests_passed
        success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
        
        print(f"\n🎯 RÉSULTATS GLOBAUX:")
        print(f"   Tests exécutés: {total_tests}")
        print(f"   Tests réussis: {passed_tests}")
        print(f"   Taux de réussite: {success_rate:.1f}%")
        
        # Performance results
        if self.performance_results:
            print(f"\n🚀 PERFORMANCE (Optimisation 2G/3G):")
            performance_success = sum(1 for r in self.performance_results if r['success'])
            performance_total = len(self.performance_results)
            print(f"   Performance: {performance_success}/{performance_total} tests réussis")
            
            for result in self.performance_results:
                status = "✅" if result['success'] else "❌"
                print(f"   {status} {result['test']}: {result['details']}")
        
        # Security results
        if self.security_results:
            print(f"\n🔒 SÉCURITÉ (West Africa):")
            security_success = sum(1 for r in self.security_results if r['success'])
            security_total = len(self.security_results)
            print(f"   Sécurité: {security_success}/{security_total} tests réussis")
            
            for result in self.security_results:
                status = "✅" if result['success'] else "❌"
                print(f"   {status} {result['test']}: {result['details']}")
        
        # Payment results
        if self.payment_results:
            print(f"\n💰 PAIEMENTS (Orange Money/Wave):")
            payment_success = sum(1 for r in self.payment_results if r['success'])
            payment_total = len(self.payment_results)
            print(f"   Paiements: {payment_success}/{payment_total} tests réussis")
            
            for result in self.payment_results:
                status = "✅" if result['success'] else "❌"
                print(f"   {status} {result['test']}: {result['details']}")
        
        # Geographical results
        if self.geographical_results:
            print(f"\n🌍 GÉOGRAPHIE (4 pays prioritaires):")
            geo_success = sum(1 for r in self.geographical_results if r['success'])
            geo_total = len(self.geographical_results)
            print(f"   Géographie: {geo_success}/{geo_total} tests réussis")
            
            for result in self.geographical_results:
                status = "✅" if result['success'] else "❌"
                print(f"   {status} {result['test']}: {result['details']}")
        
        # Overall assessment
        print(f"\n🎯 ÉVALUATION GLOBALE:")
        if success_rate >= 90:
            print(f"   🏆 EXCELLENT - Backend prêt pour lancement Afrique de l'Ouest")
        elif success_rate >= 75:
            print(f"   ✅ BON - Quelques optimisations mineures nécessaires")
        elif success_rate >= 60:
            print(f"   ⚠️  MOYEN - Optimisations importantes requises")
        else:
            print(f"   ❌ CRITIQUE - Corrections majeures nécessaires avant lancement")
        
        print(f"\n🌍 RECOMMANDATIONS POUR 84M+ UTILISATEURS OUEST-AFRICAINS:")
        print(f"   • Performance: Optimiser pour réseaux 2G/3G")
        print(f"   • Paiements: Support complet Orange Money/Wave 4 pays")
        print(f"   • Sécurité: Protection injection et validation téléphone")
        print(f"   • Géographie: Données précises Sénégal/Mali/Côte d'Ivoire/Burkina Faso")
        
        return {
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "success_rate": success_rate,
            "performance_results": self.performance_results,
            "security_results": self.security_results,
            "payment_results": self.payment_results,
            "geographical_results": self.geographical_results
        }

    def run_complete_audit(self):
        """Run the complete West Africa optimization audit"""
        print("🚀 Démarrage audit complet backend Kojo - Optimisation Afrique de l'Ouest")
        
        try:
            # Run all audit tests
            self.test_1_performance_api_endpoints()
            self.test_2_authentication_system()
            self.test_3_payment_apis_west_africa()
            self.test_4_geographical_data_management()
            self.test_5_network_optimization()
            self.test_6_jobs_employment_system()
            self.test_7_west_africa_security()
            
            # Generate final report
            report = self.generate_audit_report()
            
            return report
            
        except Exception as e:
            print(f"\n❌ ERREUR CRITIQUE DURANT L'AUDIT: {e}")
            return {
                "error": str(e),
                "total_tests": self.tests_run,
                "passed_tests": self.tests_passed,
                "success_rate": 0
            }

def main():
    """Main function to run the West Africa audit"""
    print("🌍 AUDIT BACKEND KOJO - OPTIMISATION AFRIQUE DE L'OUEST")
    print("Préparation pour 84M+ utilisateurs ouest-africains")
    print("Pays prioritaires: Sénégal 🇸🇳, Mali 🇲🇱, Côte d'Ivoire 🇨🇮, Burkina Faso 🇧🇫")
    
    tester = WestAfricaAuditTester()
    report = tester.run_complete_audit()
    
    print(f"\n🏁 AUDIT TERMINÉ")
    print(f"Rapport complet généré avec {report.get('total_tests', 0)} tests")
    
    return report

if __name__ == "__main__":
    main()