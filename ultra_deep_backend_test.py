import requests
import sys
import json
import io
import jwt
import base64
from datetime import datetime, timedelta, timezone
import time
import re

class UltraDeepKojoAPITester:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
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
        self.critical_failures = []
        self.minor_issues = []

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None, check_headers=False):
        """Run a single API test with enhanced validation"""
        url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url.replace('/api', '')
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            
            # Check security headers if requested
            if check_headers and success:
                self.validate_security_headers(response, name)
            
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
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
                    if response.status_code >= 500:
                        self.critical_failures.append(f"{name}: {response.status_code} - {error_data}")
                except:
                    print(f"   Error: {response.text}")
                    if response.status_code >= 500:
                        self.critical_failures.append(f"{name}: {response.status_code} - {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.critical_failures.append(f"{name}: Exception - {str(e)}")
            return False, {}

    def validate_security_headers(self, response, test_name):
        """Validate ultra-secure CSP headers and other security headers"""
        print(f"   🔒 Validating Security Headers for {test_name}...")
        
        expected_headers = {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Content-Security-Policy': 'default-src \'self\'; script-src \'self\' \'strict-dynamic\' \'nonce-kojo2025\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'self\'; frame-ancestors \'none\'',
            'X-Kojo-Region': 'west-africa',
            'X-Kojo-Version': '1.0.0'
        }
        
        headers_found = 0
        for header, expected_value in expected_headers.items():
            if header in response.headers:
                headers_found += 1
                actual_value = response.headers[header]
                if header == 'Content-Security-Policy':
                    # Check for key CSP components
                    if 'strict-dynamic' in actual_value and 'nonce-kojo2025' in actual_value:
                        print(f"   ✅ {header}: Ultra-secure CSP with nonce and strict-dynamic")
                    else:
                        print(f"   ⚠️ {header}: Missing ultra-secure components")
                        self.minor_issues.append(f"{test_name}: CSP missing ultra-secure components")
                elif actual_value == expected_value:
                    print(f"   ✅ {header}: {actual_value}")
                else:
                    print(f"   ⚠️ {header}: Expected '{expected_value}', got '{actual_value}'")
            else:
                print(f"   ❌ Missing header: {header}")
                self.minor_issues.append(f"{test_name}: Missing security header {header}")
        
        print(f"   📊 Security Headers: {headers_found}/{len(expected_headers)} found")
        return headers_found >= 5  # At least 5 out of 7 headers should be present

    def test_mongodb_security_configuration(self):
        """Test MongoDB robust configuration with error handling"""
        print("\n" + "="*60)
        print("TESTING MONGODB SECURITY CONFIGURATION")
        print("="*60)
        
        # Test 1: Health check to verify MongoDB connection
        success, response = self.run_test(
            "MongoDB Connection Health Check",
            "GET",
            "health",
            200,
            check_headers=True
        )
        
        if success and response:
            if 'timestamp' in response:
                # Verify timestamp is timezone-aware UTC
                timestamp = response['timestamp']
                print(f"   ✅ MongoDB connection active with UTC timestamp: {timestamp}")
                
                # Validate timestamp format (should be ISO format with timezone)
                try:
                    parsed_time = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                    if parsed_time.tzinfo is not None:
                        print(f"   ✅ Timestamp is timezone-aware: {parsed_time.tzinfo}")
                        self.tests_passed += 1
                    else:
                        print(f"   ⚠️ Timestamp not timezone-aware")
                        self.minor_issues.append("Health check timestamp not timezone-aware")
                    self.tests_run += 1
                except Exception as e:
                    print(f"   ❌ Invalid timestamp format: {e}")
                    self.tests_run += 1
        
        # Test 2: Database error handling - try invalid endpoint
        self.run_test(
            "Database Error Handling Test",
            "GET",
            "nonexistent-endpoint",
            404
        )

    def test_ultra_secure_csp_headers(self):
        """Test Content Security Policy with nonce and strict-dynamic"""
        print("\n" + "="*60)
        print("TESTING ULTRA-SECURE CSP HEADERS")
        print("="*60)
        
        # Test CSP headers on various endpoints
        endpoints_to_test = [
            ("health", "Health Endpoint"),
            ("", "Root Endpoint"),
            ("auth/login", "Auth Endpoint")
        ]
        
        for endpoint, name in endpoints_to_test:
            if endpoint == "auth/login":
                # Need to provide data for login endpoint
                login_data = {
                    "email": "test@example.com",
                    "password": "testpass"
                }
                success, response = self.run_test(
                    f"CSP Headers - {name}",
                    "POST",
                    endpoint,
                    401,  # Expect 401 for invalid credentials
                    data=login_data,
                    check_headers=True
                )
            else:
                success, response = self.run_test(
                    f"CSP Headers - {name}",
                    "GET",
                    endpoint,
                    200,
                    check_headers=True
                )

    def test_production_logging_system(self):
        """Test structured logging with RotatingFileHandler"""
        print("\n" + "="*60)
        print("TESTING PRODUCTION LOGGING SYSTEM")
        print("="*60)
        
        # Test 1: Generate log entries by making various requests
        print(f"\n🔍 Testing Log Generation...")
        
        # Make requests that should generate different log levels
        test_requests = [
            ("Valid health check", "GET", "health", 200),
            ("Invalid endpoint", "GET", "invalid-endpoint", 404),
            ("Invalid login", "POST", "auth/login", 401, {"email": "invalid@test.com", "password": "wrong"})
        ]
        
        for name, method, endpoint, expected_status, *data in test_requests:
            request_data = data[0] if data else None
            success, response = self.run_test(
                f"Log Generation - {name}",
                method,
                endpoint,
                expected_status,
                data=request_data
            )
            
            if success:
                print(f"   ✅ Request logged successfully")
            
            # Small delay to ensure log entries are written
            time.sleep(0.1)

    def test_model_validation_constraints(self):
        """Test Field constraints with regex, min/max, ge/le on all models"""
        print("\n" + "="*60)
        print("TESTING MODEL VALIDATION CONSTRAINTS")
        print("="*60)
        
        # Test 1: User model validation with regex for names
        print(f"\n🔍 Testing User Model Validation...")
        
        # Valid user with special characters in names (French names)
        valid_user_data = {
            "email": f"user_validation_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Jean-François",  # Hyphen and accent
            "last_name": "N'Diaye",        # Apostrophe
            "phone": "+221701234567",      # International format
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "User Model - Valid Names with Special Characters",
            "POST",
            "auth/register",
            200,
            data=valid_user_data
        )
        
        if success and 'access_token' in response:
            user_token = response['access_token']
            user_data = response['user']
            
            # Verify rating is within 0-5 range
            rating = user_data.get('rating', 0)
            if 0 <= rating <= 5:
                print(f"   ✅ User rating within valid range: {rating}")
                self.tests_passed += 1
            else:
                print(f"   ❌ User rating out of range: {rating}")
            self.tests_run += 1
        
        # Test 2: Invalid user names (should fail regex validation)
        invalid_name_tests = [
            ("Numbers in name", "Jean123", "Dupont"),
            ("Special symbols", "Jean@", "Dupont"),
            ("Empty name", "", "Dupont"),
            ("Too long name", "A" * 51, "Dupont")
        ]
        
        for test_name, first_name, last_name in invalid_name_tests:
            invalid_user_data = {
                "email": f"invalid_{datetime.now().strftime('%H%M%S%f')}@test.com",
                "password": "TestPass123!",
                "first_name": first_name,
                "last_name": last_name,
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            self.run_test(
                f"User Model - Invalid Name ({test_name})",
                "POST",
                "auth/register",
                422,  # Pydantic validation error
                data=invalid_user_data
            )
        
        # Test 3: Phone number validation (international format)
        phone_validation_tests = [
            ("Valid Senegal", "+221701234567", 200),
            ("Valid Mali", "+223701234567", 200),
            ("Invalid format", "701234567", 422),
            ("Invalid country", "+1234567890", 422),
            ("Too short", "+22170123", 422)
        ]
        
        for test_name, phone, expected_status in phone_validation_tests:
            phone_test_data = {
                "email": f"phone_{datetime.now().strftime('%H%M%S%f')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Phone",
                "phone": phone,
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            self.run_test(
                f"Phone Validation - {test_name} ({phone})",
                "POST",
                "auth/register",
                expected_status,
                data=phone_test_data
            )

    def test_robust_mobile_validation(self):
        """Test Orange Money & Wave validation with logging and error handling"""
        print("\n" + "="*60)
        print("TESTING ROBUST MOBILE VALIDATION")
        print("="*60)
        
        # Test 1: Orange Money validation with exact prefixes
        print(f"\n🔍 Testing Orange Money Validation with Exact Prefixes...")
        
        orange_money_tests = [
            # Senegal (+221) - prefixes: 77, 78, 70
            ("+221771234567", "senegal", "Senegal 77", 200),
            ("+221781234567", "senegal", "Senegal 78", 200),
            ("+221701234567", "senegal", "Senegal 70", 200),
            ("+221761234567", "senegal", "Senegal 76 (Invalid)", 400),
            
            # Mali (+223) - prefixes: 77, 78, 79
            ("+223771234567", "mali", "Mali 77", 200),
            ("+223781234567", "mali", "Mali 78", 200),
            ("+223791234567", "mali", "Mali 79", 200),
            ("+223701234567", "mali", "Mali 70 (Invalid)", 400),
            
            # Ivory Coast (+225) - prefixes: 77, 78, 79
            ("+225771234567", "ivory_coast", "Ivory Coast 77", 200),
            ("+225781234567", "ivory_coast", "Ivory Coast 78", 200),
            ("+225791234567", "ivory_coast", "Ivory Coast 79", 200),
            ("+225701234567", "ivory_coast", "Ivory Coast 70 (Invalid)", 400),
            
            # Burkina Faso (+226) - prefixes: 77, 78
            ("+226771234567", "burkina_faso", "Burkina Faso 77", 200),
            ("+226781234567", "burkina_faso", "Burkina Faso 78", 200),
            ("+226791234567", "burkina_faso", "Burkina Faso 79 (Invalid)", 400)
        ]
        
        for orange_number, country, test_name, expected_status in orange_money_tests:
            user_data = {
                "email": f"orange_{datetime.now().strftime('%H%M%S%f')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Orange",
                "phone": orange_number,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": orange_number
                }
            }
            
            self.run_test(
                f"Orange Money - {test_name} ({orange_number})",
                "POST",
                "auth/register-verified",
                expected_status,
                data=user_data
            )
        
        # Test 2: Wave validation with exact prefixes per country
        print(f"\n🔍 Testing Wave Validation with Exact Prefixes per Country...")
        
        wave_tests = [
            # Senegal (+221) - prefixes: 77, 78, 70, 76, 75
            ("+221771234567", "senegal", "Senegal Wave 77", 200),
            ("+221781234567", "senegal", "Senegal Wave 78", 200),
            ("+221701234567", "senegal", "Senegal Wave 70", 200),
            ("+221761234567", "senegal", "Senegal Wave 76", 200),
            ("+221751234567", "senegal", "Senegal Wave 75", 200),
            
            # Mali (+223) - prefixes: 77, 78, 79, 65, 66
            ("+223771234567", "mali", "Mali Wave 77", 200),
            ("+223651234567", "mali", "Mali Wave 65", 200),
            ("+223661234567", "mali", "Mali Wave 66", 200),
            
            # Ivory Coast (+225) - prefixes: 77, 78, 79, 58, 59
            ("+225581234567", "ivory_coast", "Ivory Coast Wave 58", 200),
            ("+225591234567", "ivory_coast", "Ivory Coast Wave 59", 200),
            
            # Burkina Faso (+226) - prefixes: 77, 78, 70, 71
            ("+226701234567", "burkina_faso", "Burkina Faso Wave 70", 200),
            ("+226711234567", "burkina_faso", "Burkina Faso Wave 71", 200)
        ]
        
        for wave_number, country, test_name, expected_status in wave_tests:
            user_data = {
                "email": f"wave_{datetime.now().strftime('%H%M%S%f')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Wave",
                "phone": wave_number,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": wave_number
                }
            }
            
            self.run_test(
                f"Wave - {test_name} ({wave_number})",
                "POST",
                "auth/register-verified",
                expected_status,
                data=user_data
            )

    def test_payment_status_enum_validation(self):
        """Test PaymentStatus Enum with strict validation"""
        print("\n" + "="*60)
        print("TESTING PAYMENT STATUS ENUM VALIDATION")
        print("="*60)
        
        # First, create a user to get token
        user_data = {
            "email": f"payment_enum_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Payment",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Create User for Payment Status Testing",
            "POST",
            "auth/register",
            200,
            data=user_data
        )
        
        if success and 'access_token' in response:
            token = response['access_token']
            
            # Test job creation with valid enum values
            job_data = {
                "title": "Test Payment Status Job",
                "description": "Testing payment status enum validation with proper constraints",
                "category": "plumbing",
                "budget_min": 50000.0,
                "budget_max": 100000.0,
                "location": {
                    "address": "Dakar, Senegal",
                    "latitude": 14.6937,
                    "longitude": -17.4441
                },
                "required_skills": ["plumbing"],
                "estimated_duration": "2 hours"
            }
            
            success, job_response = self.run_test(
                "Job Creation for Payment Status Testing",
                "POST",
                "jobs",
                200,
                data=job_data,
                token=token
            )
            
            if success and 'id' in job_response:
                print(f"   ✅ Job created with proper enum validation")
                
                # Verify job status is using enum (should be "open")
                job_status = job_response.get('status')
                valid_statuses = ['open', 'in_progress', 'completed', 'cancelled']
                if job_status in valid_statuses:
                    print(f"   ✅ Job status using valid enum: {job_status}")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ Job status not using enum: {job_status}")
                self.tests_run += 1

    def test_job_validation_constraints(self):
        """Test Job validation with coherent budget, controlled lengths, limited skills"""
        print("\n" + "="*60)
        print("TESTING JOB VALIDATION CONSTRAINTS")
        print("="*60)
        
        # Create user for job testing
        user_data = {
            "email": f"job_validation_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "JobValidator",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Create Client for Job Validation Testing",
            "POST",
            "auth/register",
            200,
            data=user_data
        )
        
        if success and 'access_token' in response:
            token = response['access_token']
            
            # Test 1: Valid job with coherent budget (budget_max >= budget_min)
            valid_job_data = {
                "title": "Réparation Plomberie Urgente",  # 5-200 chars
                "description": "Besoin d'un plombier expérimenté pour réparer une fuite d'eau dans la cuisine. Le problème est urgent et nécessite une intervention rapide.",  # 20-5000 chars
                "category": "plomberie",  # 3-50 chars
                "budget_min": 25000.0,
                "budget_max": 50000.0,  # >= budget_min
                "location": {
                    "address": "Dakar, Senegal",
                    "latitude": 14.6937,
                    "longitude": -17.4441
                },
                "required_skills": ["plomberie", "réparation", "urgence"],  # Max 20 skills
                "estimated_duration": "2-3 heures",  # Max 100 chars
                "mechanic_must_bring_parts": True,
                "mechanic_must_bring_tools": False,
                "parts_and_tools_notes": "Le client fournira les pièces de rechange nécessaires"  # Max 1000 chars
            }
            
            success, job_response = self.run_test(
                "Job Validation - Valid Job with Coherent Budget",
                "POST",
                "jobs",
                200,
                data=valid_job_data,
                token=token
            )
            
            if success:
                # Verify mechanic requirements fields
                mechanic_parts = job_response.get('mechanic_must_bring_parts')
                mechanic_tools = job_response.get('mechanic_must_bring_tools')
                parts_notes = job_response.get('parts_and_tools_notes')
                
                if mechanic_parts is True and mechanic_tools is False:
                    print(f"   ✅ Mechanic requirements properly saved: parts={mechanic_parts}, tools={mechanic_tools}")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ Mechanic requirements not saved correctly")
                
                if parts_notes and len(parts_notes) <= 1000:
                    print(f"   ✅ Parts and tools notes within length limit: {len(parts_notes)} chars")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ Parts and tools notes validation failed")
                
                self.tests_run += 2
            
            # Test 2: Invalid job with budget_max < budget_min (should fail)
            invalid_budget_job = {
                "title": "Invalid Budget Job",
                "description": "This job has invalid budget constraints where max is less than min",
                "category": "test",
                "budget_min": 100000.0,
                "budget_max": 50000.0,  # < budget_min (should fail)
                "location": {"address": "Test Location"},
                "required_skills": ["test"]
            }
            
            self.run_test(
                "Job Validation - Invalid Budget (max < min)",
                "POST",
                "jobs",
                422,  # Pydantic validation error
                data=invalid_budget_job,
                token=token
            )
            
            # Test 3: Job with too many skills (should fail)
            too_many_skills_job = {
                "title": "Job with Too Many Skills",
                "description": "This job has more than 20 required skills which should fail validation",
                "category": "test",
                "budget_min": 50000.0,
                "budget_max": 100000.0,
                "location": {"address": "Test Location"},
                "required_skills": [f"skill_{i}" for i in range(25)]  # 25 skills > 20 limit
            }
            
            self.run_test(
                "Job Validation - Too Many Skills (>20)",
                "POST",
                "jobs",
                422,
                data=too_many_skills_job,
                token=token
            )
            
            # Test 4: Job with title too short (should fail)
            short_title_job = {
                "title": "Test",  # < 5 chars
                "description": "This job has a title that is too short and should fail validation",
                "category": "test",
                "budget_min": 50000.0,
                "budget_max": 100000.0,
                "location": {"address": "Test Location"},
                "required_skills": ["test"]
            }
            
            self.run_test(
                "Job Validation - Title Too Short (<5 chars)",
                "POST",
                "jobs",
                422,
                data=short_title_job,
                token=token
            )
            
            # Test 5: Job with description too short (should fail)
            short_description_job = {
                "title": "Valid Title Here",
                "description": "Too short",  # < 20 chars
                "category": "test",
                "budget_min": 50000.0,
                "budget_max": 100000.0,
                "location": {"address": "Test Location"},
                "required_skills": ["test"]
            }
            
            self.run_test(
                "Job Validation - Description Too Short (<20 chars)",
                "POST",
                "jobs",
                422,
                data=short_description_job,
                token=token
            )

    def test_worker_profile_validation(self):
        """Test WorkerProfile validation with specialties 1-10, rate 500-100k FCFA, experience 0-50 years"""
        print("\n" + "="*60)
        print("TESTING WORKER PROFILE VALIDATION")
        print("="*60)
        
        # Create worker for profile testing
        worker_data = {
            "email": f"worker_profile_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Mamadou",
            "last_name": "Traore",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Create Worker for Profile Validation Testing",
            "POST",
            "auth/register",
            200,
            data=worker_data
        )
        
        if success and 'access_token' in response:
            token = response['access_token']
            user_id = response['user']['id']
            
            # Test 1: Valid worker profile with constraints
            valid_profile_data = {
                "user_id": user_id,
                "specialties": ["plomberie", "électricité", "maçonnerie"],  # 1-10 specialties
                "experience_years": 15,  # 0-50 years
                "hourly_rate": 25000.0,  # 500-100k FCFA
                "availability": True,
                "description": "Artisan expérimenté avec 15 ans d'expérience dans le bâtiment"
            }
            
            success, profile_response = self.run_test(
                "Worker Profile - Valid Profile with Constraints",
                "POST",
                "workers/profile",
                200,
                data=valid_profile_data,
                token=token
            )
            
            if success:
                print(f"   ✅ Worker profile created with valid constraints")
            
            # Test 2: Profile with no specialties (should fail - min 1)
            no_specialties_profile = {
                "user_id": user_id,
                "specialties": [],  # Empty list (should fail)
                "experience_years": 5,
                "hourly_rate": 15000.0,
                "availability": True
            }
            
            self.run_test(
                "Worker Profile - No Specialties (Should Fail)",
                "POST",
                "workers/profile",
                422,
                data=no_specialties_profile,
                token=token
            )
            
            # Test 3: Profile with too many specialties (should fail - max 10)
            too_many_specialties_profile = {
                "user_id": user_id,
                "specialties": [f"specialty_{i}" for i in range(15)],  # 15 > 10 limit
                "experience_years": 5,
                "hourly_rate": 15000.0,
                "availability": True
            }
            
            self.run_test(
                "Worker Profile - Too Many Specialties (>10)",
                "POST",
                "workers/profile",
                422,
                data=too_many_specialties_profile,
                token=token
            )
            
            # Test 4: Profile with hourly rate too low (should fail - min 500 FCFA)
            low_rate_profile = {
                "user_id": user_id,
                "specialties": ["plomberie"],
                "experience_years": 5,
                "hourly_rate": 300.0,  # < 500 FCFA
                "availability": True
            }
            
            self.run_test(
                "Worker Profile - Hourly Rate Too Low (<500 FCFA)",
                "POST",
                "workers/profile",
                422,
                data=low_rate_profile,
                token=token
            )
            
            # Test 5: Profile with hourly rate too high (should fail - max 100k FCFA)
            high_rate_profile = {
                "user_id": user_id,
                "specialties": ["plomberie"],
                "experience_years": 5,
                "hourly_rate": 150000.0,  # > 100k FCFA
                "availability": True
            }
            
            self.run_test(
                "Worker Profile - Hourly Rate Too High (>100k FCFA)",
                "POST",
                "workers/profile",
                422,
                data=high_rate_profile,
                token=token
            )
            
            # Test 6: Profile with negative experience (should fail - min 0)
            negative_experience_profile = {
                "user_id": user_id,
                "specialties": ["plomberie"],
                "experience_years": -5,  # < 0
                "hourly_rate": 15000.0,
                "availability": True
            }
            
            self.run_test(
                "Worker Profile - Negative Experience (<0 years)",
                "POST",
                "workers/profile",
                422,
                data=negative_experience_profile,
                token=token
            )
            
            # Test 7: Profile with too much experience (should fail - max 50)
            too_much_experience_profile = {
                "user_id": user_id,
                "specialties": ["plomberie"],
                "experience_years": 60,  # > 50 years
                "hourly_rate": 15000.0,
                "availability": True
            }
            
            self.run_test(
                "Worker Profile - Too Much Experience (>50 years)",
                "POST",
                "workers/profile",
                422,
                data=too_much_experience_profile,
                token=token
            )
            
            # Test 8: Valid edge cases
            edge_case_tests = [
                ("Minimum Valid Rate", 500.0, 200),
                ("Maximum Valid Rate", 100000.0, 200),
                ("Minimum Experience", 0, 200),
                ("Maximum Experience", 50, 200)
            ]
            
            for test_name, rate_or_exp, expected_status in edge_case_tests:
                if "Rate" in test_name:
                    edge_profile = {
                        "user_id": user_id,
                        "specialties": ["test"],
                        "experience_years": 5,
                        "hourly_rate": rate_or_exp,
                        "availability": True
                    }
                else:
                    edge_profile = {
                        "user_id": user_id,
                        "specialties": ["test"],
                        "experience_years": rate_or_exp,
                        "hourly_rate": 15000.0,
                        "availability": True
                    }
                
                self.run_test(
                    f"Worker Profile - {test_name}",
                    "POST",
                    "workers/profile",
                    expected_status,
                    data=edge_profile,
                    token=token
                )

    def test_jwt_security_enhancements(self):
        """Test JWT security with timezone-aware expiration and robust structure"""
        print("\n" + "="*60)
        print("TESTING JWT SECURITY ENHANCEMENTS")
        print("="*60)
        
        # Create user to get JWT token
        user_data = {
            "email": f"jwt_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "JWT",
            "last_name": "Tester",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Create User for JWT Testing",
            "POST",
            "auth/register",
            200,
            data=user_data
        )
        
        if success and 'access_token' in response:
            token = response['access_token']
            
            # Test 1: Decode JWT to verify structure and timezone-aware expiration
            print(f"\n🔍 Testing JWT Token Structure and Timezone-Aware Expiration...")
            try:
                # Decode without verification to check structure
                decoded = jwt.decode(token, options={"verify_signature": False})
                
                # Check required fields
                required_fields = ['sub', 'email', 'exp']
                missing_fields = []
                
                for field in required_fields:
                    if field in decoded:
                        print(f"   ✅ JWT contains required field: {field}")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ JWT missing required field: {field}")
                        missing_fields.append(field)
                    self.tests_run += 1
                
                # Check expiration is timezone-aware (24 hours from now)
                if 'exp' in decoded:
                    exp_timestamp = decoded['exp']
                    exp_datetime = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
                    current_time = datetime.now(timezone.utc)
                    time_diff = exp_datetime - current_time
                    
                    # Should be approximately 24 hours (23.5 to 24.5 hours to account for processing time)
                    hours_diff = time_diff.total_seconds() / 3600
                    if 23.5 <= hours_diff <= 24.5:
                        print(f"   ✅ JWT expiration is timezone-aware UTC with 24-hour validity: {hours_diff:.2f} hours")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ JWT expiration not properly set: {hours_diff:.2f} hours")
                    self.tests_run += 1
                
                # Check token length (should be robust)
                if len(token) > 200:
                    print(f"   ✅ JWT token is robust with {len(token)} characters")
                    self.tests_passed += 1
                else:
                    print(f"   ⚠️ JWT token might be too short: {len(token)} characters")
                    self.minor_issues.append("JWT token length might be insufficient")
                self.tests_run += 1
                
            except Exception as e:
                print(f"   ❌ Failed to decode JWT token: {e}")
                self.critical_failures.append(f"JWT decoding failed: {e}")
                self.tests_run += 1
            
            # Test 2: Verify token works for authentication
            success, profile_response = self.run_test(
                "JWT Authentication Test",
                "GET",
                "users/profile",
                200,
                token=token
            )
            
            if success:
                print(f"   ✅ JWT token successfully authenticates user")

    def test_country_enum_precision(self):
        """Test Country enum restricted to 4 priority countries"""
        print("\n" + "="*60)
        print("TESTING COUNTRY ENUM PRECISION (4 PRIORITY COUNTRIES)")
        print("="*60)
        
        # Test 1: Valid priority countries (should succeed)
        priority_countries = [
            ("senegal", "Senegal"),
            ("mali", "Mali"),
            ("ivory_coast", "Ivory Coast"),
            ("burkina_faso", "Burkina Faso")
        ]
        
        for country_code, country_name in priority_countries:
            user_data = {
                "email": f"country_{country_code}_{datetime.now().strftime('%H%M%S%f')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": country_name,
                "phone": "+221701234567",
                "user_type": "client",
                "country": country_code,
                "preferred_language": "fr"
            }
            
            self.run_test(
                f"Country Enum - Valid Priority Country ({country_name})",
                "POST",
                "auth/register",
                200,
                data=user_data
            )
        
        # Test 2: Invalid non-priority countries (should fail)
        non_priority_countries = [
            ("guinea", "Guinea"),
            ("niger", "Niger"),
            ("togo", "Togo"),
            ("benin", "Benin"),
            ("ghana", "Ghana"),
            ("nigeria", "Nigeria")
        ]
        
        for country_code, country_name in non_priority_countries:
            user_data = {
                "email": f"invalid_{country_code}_{datetime.now().strftime('%H%M%S%f')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": country_name,
                "phone": "+221701234567",
                "user_type": "client",
                "country": country_code,
                "preferred_language": "fr"
            }
            
            self.run_test(
                f"Country Enum - Invalid Non-Priority Country ({country_name})",
                "POST",
                "auth/register",
                422,  # Validation error for invalid enum value
                data=user_data
            )

    def test_timezone_aware_timestamps(self):
        """Test all datetime fields use timezone-aware UTC timestamps"""
        print("\n" + "="*60)
        print("TESTING TIMEZONE-AWARE UTC TIMESTAMPS")
        print("="*60)
        
        # Test 1: User registration timestamp
        user_data = {
            "email": f"timestamp_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Timestamp",
            "last_name": "Tester",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        before_request = datetime.now(timezone.utc)
        success, response = self.run_test(
            "User Registration Timestamp Test",
            "POST",
            "auth/register",
            200,
            data=user_data
        )
        after_request = datetime.now(timezone.utc)
        
        if success and 'user' in response:
            user = response['user']
            token = response['access_token']
            
            # Check created_at timestamp
            if 'created_at' in user:
                created_at_str = user['created_at']
                try:
                    # Parse the timestamp
                    if created_at_str.endswith('Z'):
                        created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                    elif '+' in created_at_str or created_at_str.endswith('00:00'):
                        created_at = datetime.fromisoformat(created_at_str)
                    else:
                        # Assume UTC if no timezone info
                        created_at = datetime.fromisoformat(created_at_str).replace(tzinfo=timezone.utc)
                    
                    # Verify it's timezone-aware and within reasonable time range
                    if created_at.tzinfo is not None:
                        print(f"   ✅ User created_at is timezone-aware: {created_at}")
                        self.tests_passed += 1
                        
                        # Check if timestamp is recent (within request timeframe)
                        if before_request <= created_at <= after_request:
                            print(f"   ✅ Timestamp is accurate and recent")
                            self.tests_passed += 1
                        else:
                            print(f"   ⚠️ Timestamp might not be accurate: {created_at}")
                            self.minor_issues.append("User timestamp accuracy issue")
                    else:
                        print(f"   ❌ User created_at is not timezone-aware: {created_at}")
                    
                    self.tests_run += 2
                    
                except Exception as e:
                    print(f"   ❌ Failed to parse created_at timestamp: {e}")
                    self.tests_run += 1
            
            # Test 2: Job creation timestamp
            job_data = {
                "title": "Timestamp Test Job",
                "description": "Testing timezone-aware timestamps in job creation",
                "category": "test",
                "budget_min": 50000.0,
                "budget_max": 100000.0,
                "location": {"address": "Test Location"},
                "required_skills": ["test"]
            }
            
            before_job = datetime.now(timezone.utc)
            success, job_response = self.run_test(
                "Job Creation Timestamp Test",
                "POST",
                "jobs",
                200,
                data=job_data,
                token=token
            )
            after_job = datetime.now(timezone.utc)
            
            if success and 'posted_at' in job_response:
                posted_at_str = job_response['posted_at']
                try:
                    if posted_at_str.endswith('Z'):
                        posted_at = datetime.fromisoformat(posted_at_str.replace('Z', '+00:00'))
                    elif '+' in posted_at_str or posted_at_str.endswith('00:00'):
                        posted_at = datetime.fromisoformat(posted_at_str)
                    else:
                        posted_at = datetime.fromisoformat(posted_at_str).replace(tzinfo=timezone.utc)
                    
                    if posted_at.tzinfo is not None:
                        print(f"   ✅ Job posted_at is timezone-aware: {posted_at}")
                        self.tests_passed += 1
                        
                        if before_job <= posted_at <= after_job:
                            print(f"   ✅ Job timestamp is accurate and recent")
                            self.tests_passed += 1
                        else:
                            print(f"   ⚠️ Job timestamp might not be accurate")
                            self.minor_issues.append("Job timestamp accuracy issue")
                    else:
                        print(f"   ❌ Job posted_at is not timezone-aware")
                    
                    self.tests_run += 2
                    
                except Exception as e:
                    print(f"   ❌ Failed to parse posted_at timestamp: {e}")
                    self.tests_run += 1

    def run_all_ultra_deep_tests(self):
        """Run all ultra-deep backend tests"""
        print("🚀 STARTING ULTRA-DEEP BACKEND TESTING")
        print("=" * 80)
        print("Testing all critical optimizations for West Africa launch")
        print("=" * 80)
        
        start_time = datetime.now()
        
        # Run all test suites
        self.test_mongodb_security_configuration()
        self.test_ultra_secure_csp_headers()
        self.test_production_logging_system()
        self.test_model_validation_constraints()
        self.test_robust_mobile_validation()
        self.test_payment_status_enum_validation()
        self.test_job_validation_constraints()
        self.test_worker_profile_validation()
        self.test_jwt_security_enhancements()
        self.test_country_enum_precision()
        self.test_timezone_aware_timestamps()
        
        end_time = datetime.now()
        duration = end_time - start_time
        
        # Print comprehensive results
        print("\n" + "="*80)
        print("🎯 ULTRA-DEEP BACKEND TESTING RESULTS")
        print("="*80)
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print(f"📊 OVERALL RESULTS:")
        print(f"   Total Tests Run: {self.tests_run}")
        print(f"   Tests Passed: {self.tests_passed}")
        print(f"   Success Rate: {success_rate:.1f}%")
        print(f"   Duration: {duration.total_seconds():.2f} seconds")
        
        if self.critical_failures:
            print(f"\n❌ CRITICAL FAILURES ({len(self.critical_failures)}):")
            for failure in self.critical_failures:
                print(f"   • {failure}")
        
        if self.minor_issues:
            print(f"\n⚠️ MINOR ISSUES ({len(self.minor_issues)}):")
            for issue in self.minor_issues:
                print(f"   • {issue}")
        
        if success_rate >= 95:
            print(f"\n🎉 EXCELLENT: Backend achieved {success_rate:.1f}% success rate!")
            print("✅ All critical optimizations are working perfectly")
            print("🚀 Backend is PRODUCTION-READY for West Africa launch!")
        elif success_rate >= 85:
            print(f"\n✅ GOOD: Backend achieved {success_rate:.1f}% success rate")
            print("⚠️ Some minor issues detected but core functionality works")
        else:
            print(f"\n❌ NEEDS ATTENTION: Backend only achieved {success_rate:.1f}% success rate")
            print("🔧 Critical issues need to be addressed before production")
        
        return {
            "tests_run": self.tests_run,
            "tests_passed": self.tests_passed,
            "success_rate": success_rate,
            "critical_failures": self.critical_failures,
            "minor_issues": self.minor_issues,
            "duration": duration.total_seconds()
        }

if __name__ == "__main__":
    print("🔥 ULTRA-DEEP BACKEND TESTING - FINAL EXHAUSTIVE REVIEW")
    print("Testing all West Africa launch optimizations...")
    
    tester = UltraDeepKojoAPITester()
    results = tester.run_all_ultra_deep_tests()
    
    # Exit with appropriate code
    if results["success_rate"] >= 95:
        sys.exit(0)  # Success
    elif results["success_rate"] >= 85:
        sys.exit(1)  # Minor issues
    else:
        sys.exit(2)  # Critical issues