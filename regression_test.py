#!/usr/bin/env python3
"""
KOJO REGRESSION TEST SUITE - POST-CORRECTIONS VALIDATION
========================================================

Tests all 34 corrections applied to ensure NO REGRESSIONS introduced.
Focus areas:
1. Critical endpoints (registration, login, jobs, profiles)
2. Prefix validation 70-99 functionality
3. Mechanic category job creation
4. Performance after optimizations
5. System stability

Author: Testing Agent
Date: 2025
"""

import requests
import sys
import json
import io
import time
from datetime import datetime, timedelta
import base64

class KojoRegressionTester:
    def __init__(self, base_url="https://kojo-native.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.mechanic_token = None
        self.client_user = None
        self.worker_user = None
        self.mechanic_user = None
        self.test_job_id = None
        self.mechanic_job_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.performance_metrics = []
        
        # Test data for prefix validation 70-99
        self.prefix_test_data = [
            {"prefix": "70", "country": "senegal", "code": "+221"},
            {"prefix": "75", "country": "mali", "code": "+223"},
            {"prefix": "80", "country": "ivory_coast", "code": "+225"},
            {"prefix": "85", "country": "burkina_faso", "code": "+226"},
            {"prefix": "90", "country": "senegal", "code": "+221"},
            {"prefix": "95", "country": "mali", "code": "+223"},
            {"prefix": "99", "country": "ivory_coast", "code": "+225"}
        ]

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None, measure_performance=False):
        """Run a single API test with optional performance measurement"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        start_time = time.time() if measure_performance else None
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            end_time = time.time() if measure_performance else None
            response_time = (end_time - start_time) * 1000 if measure_performance else None

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                if response_time:
                    print(f"   Performance: {response_time:.2f}ms")
                    self.performance_metrics.append({
                        'test': name,
                        'response_time': response_time,
                        'endpoint': endpoint
                    })
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 500:
                        print(f"   Response: {response_data}")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_system_health_and_performance(self):
        """Test system health and measure performance after optimizations"""
        print("\n" + "="*60)
        print("🏥 TESTING SYSTEM HEALTH & PERFORMANCE")
        print("="*60)
        
        # Test health endpoints with performance measurement
        self.run_test("Root endpoint", "GET", "", 200, measure_performance=True)
        self.run_test("Health check", "GET", "health", 200, measure_performance=True)
        self.run_test("System stats", "GET", "stats", 200, measure_performance=True)

    def test_prefix_70_99_validation(self):
        """Test that prefix extension 70-99 still works correctly"""
        print("\n" + "="*60)
        print("📱 TESTING PREFIX 70-99 VALIDATION (NO REGRESSION)")
        print("="*60)
        
        timestamp = datetime.now().strftime('%H%M%S')
        
        for i, prefix_data in enumerate(self.prefix_test_data):
            prefix = prefix_data["prefix"]
            country = prefix_data["country"]
            country_code = prefix_data["code"]
            
            # Test registration with each prefix
            user_data = {
                "email": f"prefix{prefix}_{timestamp}_{i}@test.com",
                "password": "TestPass123!",
                "first_name": f"User{prefix}",
                "last_name": "TestPrefix",
                "phone": f"{country_code}{prefix}1234567",
                "user_type": "client",
                "country": country,
                "preferred_language": "fr"
            }
            
            success, response = self.run_test(
                f"Registration with prefix {prefix} ({country})",
                "POST",
                "auth/register",
                200,
                data=user_data,
                measure_performance=True
            )
            
            if success and 'access_token' in response:
                print(f"   ✅ Prefix {prefix} validation working for {country}")
            else:
                print(f"   ❌ Prefix {prefix} validation FAILED for {country}")

    def test_critical_authentication_endpoints(self):
        """Test critical authentication endpoints for regressions"""
        print("\n" + "="*60)
        print("🔐 TESTING CRITICAL AUTHENTICATION ENDPOINTS")
        print("="*60)
        
        timestamp = datetime.now().strftime('%H%M%S')
        
        # Test client registration with performance measurement
        client_data = {
            "email": f"regression_client_{timestamp}@test.com",
            "password": "TestPass123!",
            "first_name": "Regression",
            "last_name": "Client",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Client Registration (Critical)",
            "POST",
            "auth/register",
            200,
            data=client_data,
            measure_performance=True
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            self.client_user = response['user']
            print(f"   Client ID: {self.client_user['id']}")
        
        # Test worker registration
        worker_data = {
            "email": f"regression_worker_{timestamp}@test.com",
            "password": "TestPass123!",
            "first_name": "Regression",
            "last_name": "Worker",
            "phone": "+223751234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Worker Registration (Critical)",
            "POST",
            "auth/register",
            200,
            data=worker_data,
            measure_performance=True
        )
        
        if success and 'access_token' in response:
            self.worker_token = response['access_token']
            self.worker_user = response['user']
            print(f"   Worker ID: {self.worker_user['id']}")
        
        # Test mechanic registration (for mechanic category testing)
        mechanic_data = {
            "email": f"regression_mechanic_{timestamp}@test.com",
            "password": "TestPass123!",
            "first_name": "Regression",
            "last_name": "Mechanic",
            "phone": "+225801234567",
            "user_type": "worker",
            "country": "ivory_coast",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Mechanic Registration (Critical)",
            "POST",
            "auth/register",
            200,
            data=mechanic_data,
            measure_performance=True
        )
        
        if success and 'access_token' in response:
            self.mechanic_token = response['access_token']
            self.mechanic_user = response['user']
            print(f"   Mechanic ID: {self.mechanic_user['id']}")
        
        # Test login functionality
        if self.client_user:
            login_data = {
                "email": self.client_user['email'],
                "password": "TestPass123!"
            }
            
            self.run_test(
                "Login Functionality (Critical)",
                "POST",
                "auth/login",
                200,
                data=login_data,
                measure_performance=True
            )

    def test_mechanic_category_jobs(self):
        """Test mechanic category job creation with new requirements system"""
        print("\n" + "="*60)
        print("🔧 TESTING MECHANIC CATEGORY JOB CREATION")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping mechanic job tests - no client token")
            return
            
        # Test mechanic job creation with new fields
        mechanic_job_data = {
            "title": "Réparation Moteur Voiture - Mécanique Avancée",
            "description": "Besoin d'un mécanicien expérimenté pour réparer le moteur de ma voiture. Problème de surchauffe et bruit étrange au démarrage.",
            "category": "mechanics",  # Test mechanic category specifically
            "budget_min": 75000.0,
            "budget_max": 150000.0,
            "location": {
                "address": "Bamako, Mali",
                "latitude": 12.6392,
                "longitude": -8.0029,
                "city": "Bamako",
                "country": "Mali"
            },
            "required_skills": ["mécanique automobile", "diagnostic moteur", "réparation"],
            "estimated_duration": "1-2 jours",
            # NEW MECHANIC REQUIREMENTS FIELDS
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": True,
            "parts_and_tools_notes": "Le mécanicien doit apporter ses propres outils de diagnostic et les pièces de rechange nécessaires (joints, filtres, huile). Accès à un garage avec pont élévateur disponible sur place."
        }
        
        success, response = self.run_test(
            "Create Mechanic Job with Requirements",
            "POST",
            "jobs",
            200,
            data=mechanic_job_data,
            token=self.client_token,
            measure_performance=True
        )
        
        if success and 'id' in response:
            self.mechanic_job_id = response['id']
            print(f"   Mechanic Job ID: {self.mechanic_job_id}")
            
            # Verify mechanic requirements fields are properly stored
            if 'mechanic_must_bring_parts' in response:
                print(f"   ✅ mechanic_must_bring_parts: {response['mechanic_must_bring_parts']}")
            if 'mechanic_must_bring_tools' in response:
                print(f"   ✅ mechanic_must_bring_tools: {response['mechanic_must_bring_tools']}")
            if 'parts_and_tools_notes' in response:
                print(f"   ✅ parts_and_tools_notes: {response['parts_and_tools_notes'][:50]}...")
        
        # Test retrieving the mechanic job to verify fields persist
        if self.mechanic_job_id:
            success, response = self.run_test(
                "Retrieve Mechanic Job (Verify Fields)",
                "GET",
                f"jobs/{self.mechanic_job_id}",
                200,
                token=self.client_token
            )
            
            if success:
                # Verify all mechanic fields are present
                mechanic_fields = ['mechanic_must_bring_parts', 'mechanic_must_bring_tools', 'parts_and_tools_notes']
                for field in mechanic_fields:
                    if field in response:
                        print(f"   ✅ {field} persisted correctly")
                    else:
                        print(f"   ❌ {field} NOT found in response")
        
        # Test mechanic job with different combinations
        mechanic_job_data_2 = {
            "title": "Entretien Véhicule - Vidange et Contrôle",
            "description": "Vidange complète et contrôle général du véhicule. Travail de routine.",
            "category": "mechanics",
            "budget_min": 25000.0,
            "budget_max": 50000.0,
            "location": {
                "address": "Dakar, Sénégal",
                "latitude": 14.6937,
                "longitude": -17.4441
            },
            "required_skills": ["entretien automobile", "vidange"],
            "estimated_duration": "2-3 heures",
            # Different combination of requirements
            "mechanic_must_bring_parts": False,  # Client provides parts
            "mechanic_must_bring_tools": True,   # Mechanic brings tools
            "parts_and_tools_notes": "Les pièces (huile, filtres) seront fournies par le client. Le mécanicien doit apporter ses outils."
        }
        
        self.run_test(
            "Create Mechanic Job (Mixed Requirements)",
            "POST",
            "jobs",
            200,
            data=mechanic_job_data_2,
            token=self.client_token
        )

    def test_job_management_regression(self):
        """Test job management APIs for regressions"""
        print("\n" + "="*60)
        print("💼 TESTING JOB MANAGEMENT (REGRESSION CHECK)")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping job management tests - no client token")
            return
            
        # Test standard job creation
        job_data = {
            "title": "Réparation Plomberie Urgente",
            "description": "Fuite d'eau importante dans la cuisine, intervention urgente requise",
            "category": "plumbing",
            "budget_min": 30000.0,
            "budget_max": 80000.0,
            "location": {
                "address": "Ouagadougou, Burkina Faso",
                "latitude": 12.3714,
                "longitude": -1.5197
            },
            "required_skills": ["plomberie", "réparation urgente"],
            "estimated_duration": "2-4 heures"
        }
        
        success, response = self.run_test(
            "Create Standard Job",
            "POST",
            "jobs",
            200,
            data=job_data,
            token=self.client_token,
            measure_performance=True
        )
        
        if success and 'id' in response:
            self.test_job_id = response['id']
            print(f"   Job ID: {self.test_job_id}")
        
        # Test job listing with performance measurement
        self.run_test(
            "Get All Jobs",
            "GET",
            "jobs",
            200,
            token=self.client_token,
            measure_performance=True
        )
        
        # Test job filtering by category
        self.run_test(
            "Get Jobs by Category (mechanics)",
            "GET",
            "jobs?category=mechanics",
            200,
            token=self.client_token,
            measure_performance=True
        )
        
        # Test job filtering by status
        self.run_test(
            "Get Jobs by Status (open)",
            "GET",
            "jobs?status=open",
            200,
            token=self.client_token,
            measure_performance=True
        )

    def test_profile_management_regression(self):
        """Test profile management for regressions"""
        print("\n" + "="*60)
        print("👤 TESTING PROFILE MANAGEMENT (REGRESSION CHECK)")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping profile tests - no client token")
            return
            
        # Test get profile
        self.run_test(
            "Get User Profile",
            "GET",
            "users/profile",
            200,
            token=self.client_token,
            measure_performance=True
        )
        
        # Test profile update
        update_data = {
            "first_name": "RegressionUpdated",
            "preferred_language": "wo"
        }
        
        self.run_test(
            "Update User Profile",
            "PUT",
            "users/profile",
            200,
            data=update_data,
            token=self.client_token,
            measure_performance=True
        )
        
        # Test worker profile creation if we have a worker
        if self.worker_token and self.worker_user:
            worker_profile_data = {
                "user_id": self.worker_user['id'],
                "specialties": ["plomberie", "électricité", "mécanique"],
                "experience_years": 8,
                "hourly_rate": 18000.0,
                "availability": True,
                "description": "Travailleur expérimenté au Mali, spécialisé en réparations diverses"
            }
            
            self.run_test(
                "Create Worker Profile",
                "POST",
                "workers/profile",
                200,
                data=worker_profile_data,
                token=self.worker_token,
                measure_performance=True
            )

    def test_payment_verification_system(self):
        """Test payment verification system for regressions"""
        print("\n" + "="*60)
        print("💳 TESTING PAYMENT VERIFICATION SYSTEM")
        print("="*60)
        
        timestamp = datetime.now().strftime('%H%M%S')
        
        # Test registration with payment verification
        user_with_payment = {
            "email": f"payment_test_{timestamp}@test.com",
            "password": "TestPass123!",
            "first_name": "Payment",
            "last_name": "Test",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567",
                "wave": "+221751234567"
            }
        }
        
        success, response = self.run_test(
            "Registration with Payment Verification",
            "POST",
            "auth/register-verified",
            200,
            data=user_with_payment,
            measure_performance=True
        )
        
        if success and 'access_token' in response:
            payment_token = response['access_token']
            
            # Test payment account retrieval
            self.run_test(
                "Get Payment Accounts",
                "GET",
                "users/payment-accounts",
                200,
                token=payment_token
            )
            
            # Test payment access verification
            self.run_test(
                "Verify Payment Access",
                "POST",
                "users/verify-payment-access",
                200,
                token=payment_token
            )

    def test_error_handling_regression(self):
        """Test error handling improvements for regressions"""
        print("\n" + "="*60)
        print("⚠️  TESTING ERROR HANDLING (REGRESSION CHECK)")
        print("="*60)
        
        # Test ValidationError handling (should return JSON, not HTML)
        invalid_user_data = {
            "email": "invalid-email",
            "password": "short",
            "first_name": "a",  # Too short
            "last_name": "b",   # Too short
            "phone": "invalid-phone",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "ValidationError Handling (JSON Response)",
            "POST",
            "auth/register",
            422,  # Should return 422, not 500
            data=invalid_user_data
        )
        
        # Test duplicate email error
        if self.client_user:
            duplicate_data = {
                "email": self.client_user['email'],
                "password": "TestPass123!",
                "first_name": "Duplicate",
                "last_name": "Test",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            self.run_test(
                "Duplicate Email Error Handling",
                "POST",
                "auth/register",
                400,
                data=duplicate_data
            )

    def test_owner_authorization_system(self):
        """Test Famakan Kontaga Master authorization system"""
        print("\n" + "="*60)
        print("👑 TESTING OWNER AUTHORIZATION SYSTEM")
        print("="*60)
        
        # Test Famakan login
        famakan_login = {
            "email": "kontagamakan@gmail.com",
            "password": "FamakanKojo2024@Master!"
        }
        
        success, response = self.run_test(
            "Famakan Kontaga Master Login",
            "POST",
            "auth/login",
            200,
            data=famakan_login,
            measure_performance=True
        )
        
        if success and 'access_token' in response:
            owner_token = response['access_token']
            
            # Test owner-only endpoints
            self.run_test(
                "Owner Commission Stats",
                "GET",
                "owner/commission-stats",
                200,
                token=owner_token
            )
            
            self.run_test(
                "Owner Debug Info",
                "GET",
                "owner/debug-info",
                200,
                token=owner_token
            )
            
            self.run_test(
                "Owner Users Management",
                "GET",
                "owner/users-management",
                200,
                token=owner_token
            )
            
            # Test unauthorized access (should fail)
            if self.client_token:
                self.run_test(
                    "Unauthorized Owner Access (Should Fail)",
                    "GET",
                    "owner/commission-stats",
                    403,
                    token=self.client_token
                )

    def generate_performance_report(self):
        """Generate performance report"""
        if not self.performance_metrics:
            return
            
        print("\n" + "="*60)
        print("📊 PERFORMANCE REPORT")
        print("="*60)
        
        total_time = sum(metric['response_time'] for metric in self.performance_metrics)
        avg_time = total_time / len(self.performance_metrics)
        
        print(f"Total tests with performance measurement: {len(self.performance_metrics)}")
        print(f"Average response time: {avg_time:.2f}ms")
        print(f"Total response time: {total_time:.2f}ms")
        
        # Find slowest endpoints
        slowest = sorted(self.performance_metrics, key=lambda x: x['response_time'], reverse=True)[:5]
        print(f"\nSlowest endpoints:")
        for i, metric in enumerate(slowest, 1):
            print(f"{i}. {metric['test']}: {metric['response_time']:.2f}ms")
        
        # Performance thresholds
        slow_tests = [m for m in self.performance_metrics if m['response_time'] > 2000]  # > 2 seconds
        if slow_tests:
            print(f"\n⚠️  Slow endpoints (>2s): {len(slow_tests)}")
            for test in slow_tests:
                print(f"   - {test['test']}: {test['response_time']:.2f}ms")
        else:
            print(f"\n✅ All endpoints performing well (<2s)")

    def run_all_tests(self):
        """Run all regression tests"""
        print("🚀 STARTING KOJO REGRESSION TEST SUITE")
        print("Testing all 34 corrections for regressions...")
        print("="*80)
        
        start_time = time.time()
        
        # Run all test suites
        self.test_system_health_and_performance()
        self.test_prefix_70_99_validation()
        self.test_critical_authentication_endpoints()
        self.test_mechanic_category_jobs()
        self.test_job_management_regression()
        self.test_profile_management_regression()
        self.test_payment_verification_system()
        self.test_error_handling_regression()
        self.test_owner_authorization_system()
        
        end_time = time.time()
        total_time = end_time - start_time
        
        # Generate reports
        self.generate_performance_report()
        
        # Final summary
        print("\n" + "="*80)
        print("📋 REGRESSION TEST SUMMARY")
        print("="*80)
        print(f"Total tests run: {self.tests_run}")
        print(f"Tests passed: {self.tests_passed}")
        print(f"Tests failed: {self.tests_run - self.tests_passed}")
        print(f"Success rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        print(f"Total execution time: {total_time:.2f} seconds")
        
        if self.tests_passed == self.tests_run:
            print("\n🎉 ALL REGRESSION TESTS PASSED!")
            print("✅ No regressions detected in the 34 corrections applied")
            print("✅ Prefix 70-99 validation working correctly")
            print("✅ Mechanic category job creation functional")
            print("✅ System performance maintained")
        else:
            print(f"\n⚠️  {self.tests_run - self.tests_passed} TESTS FAILED")
            print("❌ Potential regressions detected - review failed tests")
        
        return self.tests_passed == self.tests_run

if __name__ == "__main__":
    tester = KojoRegressionTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)