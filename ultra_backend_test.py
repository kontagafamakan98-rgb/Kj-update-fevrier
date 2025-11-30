#!/usr/bin/env python3
"""
ULTRA-DEEP BACKEND TESTING FOR KOJO PLATFORM
Testing all ultra-advanced optimizations for West Africa launch

Focus Areas:
1. Enhanced JWT security with robust secrets and timezone-aware expiration
2. Validation for 4 priority countries (Senegal, Mali, Côte d'Ivoire, Burkina Faso)
3. Ultra-precise mobile validation for Orange Money and Wave with exact operator prefixes
4. Performance middlewares (GZip, TrustedHost, West Africa security)
5. Security headers (CSP, XSS Protection, Frame Options)
6. Optimized CORS with specific origins, controlled headers, preflight cache
7. Updated Country enum with only the 4 launch countries
"""

import requests
import sys
import json
import io
import jwt
import base64
import time
from datetime import datetime, timedelta, timezone

class UltraKojoAPITester:
    def __init__(self, base_url="https://geoloc-boost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.owner_token = None
        self.client_user = None
        self.worker_user = None
        self.owner_user = None
        self.tests_run = 0
        self.tests_passed = 0
        
        # West Africa specific test data
        self.west_africa_countries = {
            'senegal': {'code': '+221', 'orange_prefixes': ['77', '78', '70'], 'wave_prefixes': ['77', '78', '70', '76', '75']},
            'mali': {'code': '+223', 'orange_prefixes': ['77', '78', '79'], 'wave_prefixes': ['77', '78', '79', '65', '66']},
            'ivory_coast': {'code': '+225', 'orange_prefixes': ['77', '78', '79'], 'wave_prefixes': ['77', '78', '79', '58', '59']},
            'burkina_faso': {'code': '+226', 'orange_prefixes': ['77', '78'], 'wave_prefixes': ['77', '78', '70', '71']}
        }

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None, files=None, check_headers=False):
        """Run a single API test with enhanced header checking"""
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
                if files:
                    # Remove Content-Type for file uploads
                    headers.pop('Content-Type', None)
                    response = requests.post(url, headers=headers, files=files)
                else:
                    response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)
            elif method == 'OPTIONS':
                response = requests.options(url, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                
                # Check security headers if requested
                if check_headers:
                    self.check_security_headers(response, name)
                
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

    def check_security_headers(self, response, test_name):
        """Check for West Africa security headers"""
        expected_headers = {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY", 
            "X-XSS-Protection": "1; mode=block",
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
            "X-Kojo-Region": "west-africa",
            "X-Kojo-Version": "1.0.0"
        }
        
        print(f"   🛡️  Checking security headers for {test_name}...")
        headers_passed = 0
        for header, expected_value in expected_headers.items():
            if header in response.headers:
                if response.headers[header] == expected_value:
                    print(f"      ✅ {header}: {response.headers[header]}")
                    headers_passed += 1
                else:
                    print(f"      ⚠️  {header}: Expected '{expected_value}', got '{response.headers[header]}'")
            else:
                print(f"      ❌ Missing header: {header}")
        
        print(f"   Security headers: {headers_passed}/{len(expected_headers)} passed")
        return headers_passed == len(expected_headers)

    def test_enhanced_jwt_security(self):
        """Test enhanced JWT security with robust secrets and timezone-aware expiration"""
        print("\n" + "="*70)
        print("TESTING ENHANCED JWT SECURITY - TIMEZONE-AWARE & ROBUST SECRETS")
        print("="*70)
        
        # Test 1: Register user and get JWT token
        client_data = {
            "email": f"jwt_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "SecurePass2025!",
            "first_name": "JWT",
            "last_name": "TestUser",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "JWT Token Generation",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            token = response['access_token']
            self.client_token = token
            self.client_user = response['user']
            
            # Test 2: Decode JWT token to check structure and expiration
            print(f"\n🔍 Testing JWT Token Structure and Timezone-Aware Expiration...")
            try:
                # Decode without verification to check content
                decoded = jwt.decode(token, options={"verify_signature": False})
                
                # Check required fields
                required_fields = ['sub', 'email', 'exp', 'iat']
                for field in required_fields:
                    if field in decoded:
                        print(f"   ✅ JWT contains required field: {field}")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ JWT missing required field: {field}")
                    self.tests_run += 1
                
                # Check expiration is timezone-aware (24 hours from now)
                if 'exp' in decoded and 'iat' in decoded:
                    exp_time = datetime.fromtimestamp(decoded['exp'], tz=timezone.utc)
                    iat_time = datetime.fromtimestamp(decoded['iat'], tz=timezone.utc)
                    current_time = datetime.now(timezone.utc)
                    
                    # Check if expiration is approximately 24 hours from issued time
                    expected_exp = iat_time + timedelta(hours=24)
                    time_diff = abs((exp_time - expected_exp).total_seconds())
                    
                    if time_diff < 60:  # Allow 1 minute tolerance
                        print(f"   ✅ JWT expiration correctly set to 24 hours (UTC timezone-aware)")
                        print(f"      Issued: {iat_time}")
                        print(f"      Expires: {exp_time}")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ JWT expiration not correctly set to 24 hours")
                        print(f"      Expected: {expected_exp}")
                        print(f"      Actual: {exp_time}")
                    self.tests_run += 1
                
                # Check user ID and email are correct
                if decoded.get('sub') == self.client_user['id']:
                    print(f"   ✅ JWT sub field matches user ID")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ JWT sub field doesn't match user ID")
                self.tests_run += 1
                
                if decoded.get('email') == self.client_user['email']:
                    print(f"   ✅ JWT email field matches user email")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ JWT email field doesn't match user email")
                self.tests_run += 1
                
            except Exception as e:
                print(f"   ❌ Failed to decode JWT token: {e}")
                self.tests_run += 1
        
        # Test 3: Test JWT token validation with API calls
        if self.client_token:
            print(f"\n🔍 Testing JWT Token Validation with API Calls...")
            
            # Valid token should work
            success, response = self.run_test(
                "Valid JWT Token Authentication",
                "GET",
                "users/profile",
                200,
                token=self.client_token
            )
            
            # Invalid token should fail
            invalid_token = "invalid.jwt.token"
            success, response = self.run_test(
                "Invalid JWT Token Authentication",
                "GET",
                "users/profile",
                401,
                token=invalid_token
            )
            
            # No token should fail
            success, response = self.run_test(
                "No JWT Token Authentication",
                "GET",
                "users/profile",
                403
            )

    def test_4_countries_validation(self):
        """Test validation for 4 priority countries only"""
        print("\n" + "="*70)
        print("TESTING 4 PRIORITY COUNTRIES VALIDATION - SENEGAL, MALI, CÔTE D'IVOIRE, BURKINA FASO")
        print("="*70)
        
        # Test 1: Valid registrations for all 4 priority countries
        priority_countries = ['senegal', 'mali', 'ivory_coast', 'burkina_faso']
        
        for i, country in enumerate(priority_countries):
            country_code = self.west_africa_countries[country]['code']
            test_data = {
                "email": f"{country}_test_{datetime.now().strftime('%H%M%S')}_{i}@test.com",
                "password": "TestPass2025!",
                "first_name": "Test",
                "last_name": country.title(),
                "phone": f"{country_code}701234567",
                "user_type": "client",
                "country": country,
                "preferred_language": "fr"
            }
            
            success, response = self.run_test(
                f"Registration for Priority Country: {country.title()} ({country_code})",
                "POST",
                "auth/register",
                200,
                data=test_data
            )
            
            if success and response:
                user = response.get('user', {})
                if user.get('country') == country:
                    print(f"   ✅ Country correctly set to {country}")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ Country not correctly set. Expected: {country}, Got: {user.get('country')}")
                self.tests_run += 1
        
        # Test 2: Try to register with non-priority countries (should fail if enum is restricted)
        non_priority_countries = ['nigeria', 'ghana', 'cameroon', 'togo', 'benin']
        
        print(f"\n🔍 Testing Non-Priority Countries (Should be restricted)...")
        for i, country in enumerate(non_priority_countries):
            test_data = {
                "email": f"invalid_{country}_{datetime.now().strftime('%H%M%S')}_{i}@test.com",
                "password": "TestPass2025!",
                "first_name": "Test",
                "last_name": "Invalid",
                "phone": "+234701234567",  # Nigeria code
                "user_type": "client",
                "country": country,
                "preferred_language": "fr"
            }
            
            # This should fail with 422 (validation error) if enum is properly restricted
            success, response = self.run_test(
                f"Registration for Non-Priority Country: {country.title()} (Should Fail)",
                "POST",
                "auth/register",
                422,  # Validation error expected
                data=test_data
            )

    def test_ultra_precise_mobile_validation(self):
        """Test ultra-precise mobile validation for Orange Money and Wave with exact operator prefixes"""
        print("\n" + "="*70)
        print("TESTING ULTRA-PRECISE MOBILE VALIDATION - ORANGE MONEY & WAVE OPERATOR PREFIXES")
        print("="*70)
        
        # Test Orange Money validation for all 4 priority countries
        print(f"\n🔍 Testing Orange Money Validation with Exact Operator Prefixes...")
        
        for country, data in self.west_africa_countries.items():
            country_code = data['code']
            orange_prefixes = data['orange_prefixes']
            
            print(f"\n   Testing {country.title()} ({country_code}) - Orange prefixes: {orange_prefixes}")
            
            # Test valid Orange Money prefixes
            for prefix in orange_prefixes:
                orange_number = f"{country_code}{prefix}1234567"
                
                test_user_data = {
                    "email": f"orange_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass2025!",
                    "first_name": "Orange",
                    "last_name": f"{country.title()}{prefix}",
                    "phone": orange_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": orange_number
                    }
                }
                
                success, response = self.run_test(
                    f"Orange Money {country.title()} - Prefix {prefix} ({orange_number})",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=test_user_data
                )
            
            # Test invalid Orange Money prefixes for this country
            invalid_prefixes = ['99', '88', '55']  # These should not be valid for Orange
            for prefix in invalid_prefixes:
                invalid_number = f"{country_code}{prefix}1234567"
                
                test_user_data = {
                    "email": f"orange_invalid_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass2025!",
                    "first_name": "Invalid",
                    "last_name": "Orange",
                    "phone": invalid_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": invalid_number
                    }
                }
                
                success, response = self.run_test(
                    f"Invalid Orange Money {country.title()} - Prefix {prefix} (Should Fail)",
                    "POST",
                    "auth/register-verified",
                    400,
                    data=test_user_data
                )
        
        # Test Wave validation for all 4 priority countries
        print(f"\n🔍 Testing Wave Validation with Exact Operator Prefixes...")
        
        for country, data in self.west_africa_countries.items():
            country_code = data['code']
            wave_prefixes = data['wave_prefixes']
            
            print(f"\n   Testing {country.title()} ({country_code}) - Wave prefixes: {wave_prefixes}")
            
            # Test valid Wave prefixes
            for prefix in wave_prefixes:
                wave_number = f"{country_code}{prefix}1234567"
                
                test_user_data = {
                    "email": f"wave_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass2025!",
                    "first_name": "Wave",
                    "last_name": f"{country.title()}{prefix}",
                    "phone": wave_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "wave": wave_number
                    }
                }
                
                success, response = self.run_test(
                    f"Wave {country.title()} - Prefix {prefix} ({wave_number})",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=test_user_data
                )

    def test_performance_middlewares(self):
        """Test performance middlewares - GZip, TrustedHost, and West Africa security"""
        print("\n" + "="*70)
        print("TESTING PERFORMANCE MIDDLEWARES - GZIP, TRUSTEDHOST, WEST AFRICA SECURITY")
        print("="*70)
        
        # Test 1: Check GZip compression middleware
        print(f"\n🔍 Testing GZip Compression Middleware...")
        
        # Make request with Accept-Encoding: gzip
        headers = {
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json'
        }
        
        try:
            response = requests.get(f"{self.base_url}/health", headers=headers)
            
            if 'content-encoding' in response.headers:
                if 'gzip' in response.headers['content-encoding']:
                    print(f"   ✅ GZip compression active: {response.headers['content-encoding']}")
                    self.tests_passed += 1
                else:
                    print(f"   ⚠️  Compression active but not gzip: {response.headers['content-encoding']}")
            else:
                print(f"   ⚠️  No compression detected (may be due to small response size)")
            
            self.tests_run += 1
            
        except Exception as e:
            print(f"   ❌ Failed to test GZip compression: {e}")
            self.tests_run += 1
        
        # Test 2: Check West Africa Security Middleware headers
        print(f"\n🔍 Testing West Africa Security Middleware...")
        
        success, response_data = self.run_test(
            "West Africa Security Headers",
            "GET",
            "health",
            200,
            check_headers=True
        )
        
        # Test 3: Check performance headers for API endpoints
        print(f"\n🔍 Testing Performance Headers for API Endpoints...")
        
        try:
            response = requests.get(f"{self.base_url}/health")
            
            # Check for cache control headers on API endpoints
            if 'cache-control' in response.headers:
                cache_control = response.headers['cache-control']
                if 'max-age=300' in cache_control:
                    print(f"   ✅ API cache control properly set: {cache_control}")
                    self.tests_passed += 1
                else:
                    print(f"   ⚠️  API cache control present but different: {cache_control}")
            else:
                print(f"   ⚠️  No cache control header found")
            
            self.tests_run += 1
            
        except Exception as e:
            print(f"   ❌ Failed to test performance headers: {e}")
            self.tests_run += 1

    def test_security_headers(self):
        """Test security headers - CSP, XSS Protection, Frame Options"""
        print("\n" + "="*70)
        print("TESTING SECURITY HEADERS - CSP, XSS PROTECTION, FRAME OPTIONS")
        print("="*70)
        
        # Test security headers on various endpoints
        endpoints_to_test = [
            ("health", "Health Endpoint"),
            ("", "Root Endpoint"),
            ("auth/login", "Auth Endpoint")
        ]
        
        for endpoint, description in endpoints_to_test:
            print(f"\n🔍 Testing Security Headers on {description}...")
            
            try:
                url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url.replace('/api', '')
                response = requests.get(url)
                
                security_headers_found = 0
                expected_security_headers = {
                    "X-Content-Type-Options": "nosniff",
                    "X-Frame-Options": "DENY",
                    "X-XSS-Protection": "1; mode=block",
                    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
                    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
                }
                
                for header, expected_value in expected_security_headers.items():
                    if header in response.headers:
                        if response.headers[header] == expected_value:
                            print(f"   ✅ {header}: Correct")
                            security_headers_found += 1
                        else:
                            print(f"   ⚠️  {header}: Expected '{expected_value}', got '{response.headers[header]}'")
                    else:
                        print(f"   ❌ {header}: Missing")
                
                # Check West Africa specific headers
                west_africa_headers = {
                    "X-Kojo-Region": "west-africa",
                    "X-Kojo-Version": "1.0.0"
                }
                
                for header, expected_value in west_africa_headers.items():
                    if header in response.headers:
                        if response.headers[header] == expected_value:
                            print(f"   ✅ {header}: {response.headers[header]}")
                            security_headers_found += 1
                        else:
                            print(f"   ⚠️  {header}: Expected '{expected_value}', got '{response.headers[header]}'")
                    else:
                        print(f"   ❌ {header}: Missing")
                
                total_expected = len(expected_security_headers) + len(west_africa_headers)
                if security_headers_found == total_expected:
                    print(f"   ✅ All security headers present and correct ({security_headers_found}/{total_expected})")
                    self.tests_passed += 1
                else:
                    print(f"   ⚠️  Security headers: {security_headers_found}/{total_expected} correct")
                
                self.tests_run += 1
                
            except Exception as e:
                print(f"   ❌ Failed to test security headers on {description}: {e}")
                self.tests_run += 1

    def test_optimized_cors(self):
        """Test optimized CORS with specific origins, controlled headers, preflight cache"""
        print("\n" + "="*70)
        print("TESTING OPTIMIZED CORS - SPECIFIC ORIGINS, CONTROLLED HEADERS, PREFLIGHT CACHE")
        print("="*70)
        
        # Test 1: CORS preflight request
        print(f"\n🔍 Testing CORS Preflight Request...")
        
        try:
            headers = {
                'Origin': 'https://geoloc-boost.preview.emergentagent.com',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Content-Type, Authorization'
            }
            
            response = requests.options(f"{self.base_url}/auth/login", headers=headers)
            
            print(f"   Status: {response.status_code}")
            
            # Check CORS headers
            cors_headers = {
                'Access-Control-Allow-Origin': 'https://geoloc-boost.preview.emergentagent.com',
                'Access-Control-Allow-Methods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
                'Access-Control-Allow-Headers': ['Accept', 'Accept-Language', 'Content-Language', 'Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRFToken', 'Cache-Control'],
                'Access-Control-Max-Age': '86400'  # 24 hours cache
            }
            
            cors_checks_passed = 0
            
            if 'access-control-allow-origin' in response.headers:
                origin = response.headers['access-control-allow-origin']
                print(f"   ✅ Access-Control-Allow-Origin: {origin}")
                cors_checks_passed += 1
            else:
                print(f"   ❌ Missing Access-Control-Allow-Origin header")
            
            if 'access-control-allow-methods' in response.headers:
                methods = response.headers['access-control-allow-methods']
                print(f"   ✅ Access-Control-Allow-Methods: {methods}")
                cors_checks_passed += 1
            else:
                print(f"   ❌ Missing Access-Control-Allow-Methods header")
            
            if 'access-control-allow-headers' in response.headers:
                headers_allowed = response.headers['access-control-allow-headers']
                print(f"   ✅ Access-Control-Allow-Headers: {headers_allowed}")
                cors_checks_passed += 1
            else:
                print(f"   ❌ Missing Access-Control-Allow-Headers header")
            
            if 'access-control-max-age' in response.headers:
                max_age = response.headers['access-control-max-age']
                if max_age == '86400':
                    print(f"   ✅ Access-Control-Max-Age: {max_age} (24 hours cache)")
                    cors_checks_passed += 1
                else:
                    print(f"   ⚠️  Access-Control-Max-Age: {max_age} (expected 86400)")
            else:
                print(f"   ❌ Missing Access-Control-Max-Age header")
            
            if cors_checks_passed >= 3:
                print(f"   ✅ CORS preflight configuration looks good ({cors_checks_passed}/4)")
                self.tests_passed += 1
            else:
                print(f"   ⚠️  CORS preflight needs attention ({cors_checks_passed}/4)")
            
            self.tests_run += 1
            
        except Exception as e:
            print(f"   ❌ Failed to test CORS preflight: {e}")
            self.tests_run += 1
        
        # Test 2: Actual CORS request
        print(f"\n🔍 Testing Actual CORS Request...")
        
        try:
            headers = {
                'Origin': 'https://geoloc-boost.preview.emergentagent.com',
                'Content-Type': 'application/json'
            }
            
            response = requests.get(f"{self.base_url}/health", headers=headers)
            
            if 'access-control-allow-origin' in response.headers:
                print(f"   ✅ CORS origin allowed in actual request")
                self.tests_passed += 1
            else:
                print(f"   ❌ CORS origin not allowed in actual request")
            
            self.tests_run += 1
            
        except Exception as e:
            print(f"   ❌ Failed to test actual CORS request: {e}")
            self.tests_run += 1

    def test_timezone_aware_timestamps(self):
        """Test timezone-aware timestamps in all datetime fields"""
        print("\n" + "="*70)
        print("TESTING TIMEZONE-AWARE TIMESTAMPS - UTC DATETIME FIELDS")
        print("="*70)
        
        # Test 1: User registration with timezone-aware timestamps
        print(f"\n🔍 Testing User Registration Timezone-Aware Timestamps...")
        
        before_registration = datetime.now(timezone.utc)
        
        user_data = {
            "email": f"timezone_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TimezoneTest2025!",
            "first_name": "Timezone",
            "last_name": "TestUser",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "User Registration with Timezone-Aware Timestamps",
            "POST",
            "auth/register",
            200,
            data=user_data
        )
        
        after_registration = datetime.now(timezone.utc)
        
        if success and response:
            user = response.get('user', {})
            
            # Check created_at timestamp
            if 'created_at' in user:
                try:
                    # Parse the timestamp
                    if isinstance(user['created_at'], str):
                        if user['created_at'].endswith('Z'):
                            created_at = datetime.fromisoformat(user['created_at'].replace('Z', '+00:00'))
                        elif '+' in user['created_at'] or user['created_at'].endswith('00:00'):
                            created_at = datetime.fromisoformat(user['created_at'])
                        else:
                            created_at = datetime.fromisoformat(user['created_at']).replace(tzinfo=timezone.utc)
                    else:
                        created_at = user['created_at']
                    
                    # Check if timestamp is within reasonable range
                    if before_registration <= created_at <= after_registration:
                        print(f"   ✅ created_at timestamp is timezone-aware and recent: {created_at}")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ created_at timestamp out of range: {created_at}")
                        print(f"      Expected between {before_registration} and {after_registration}")
                    
                    # Check if timezone info is present
                    if created_at.tzinfo is not None:
                        print(f"   ✅ created_at has timezone info: {created_at.tzinfo}")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ created_at missing timezone info")
                    
                    self.tests_run += 2
                    
                except Exception as e:
                    print(f"   ❌ Failed to parse created_at timestamp: {e}")
                    print(f"      Raw value: {user['created_at']}")
                    self.tests_run += 1
            
            # Check updated_at timestamp
            if 'updated_at' in user:
                try:
                    if isinstance(user['updated_at'], str):
                        if user['updated_at'].endswith('Z'):
                            updated_at = datetime.fromisoformat(user['updated_at'].replace('Z', '+00:00'))
                        elif '+' in user['updated_at'] or user['updated_at'].endswith('00:00'):
                            updated_at = datetime.fromisoformat(user['updated_at'])
                        else:
                            updated_at = datetime.fromisoformat(user['updated_at']).replace(tzinfo=timezone.utc)
                    else:
                        updated_at = user['updated_at']
                    
                    if before_registration <= updated_at <= after_registration:
                        print(f"   ✅ updated_at timestamp is timezone-aware and recent: {updated_at}")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ updated_at timestamp out of range: {updated_at}")
                    
                    self.tests_run += 1
                    
                except Exception as e:
                    print(f"   ❌ Failed to parse updated_at timestamp: {e}")
                    self.tests_run += 1
            
            # Store token for further tests
            if 'access_token' in response:
                self.client_token = response['access_token']
        
        # Test 2: Job creation with timezone-aware timestamps
        if self.client_token:
            print(f"\n🔍 Testing Job Creation Timezone-Aware Timestamps...")
            
            before_job_creation = datetime.now(timezone.utc)
            
            job_data = {
                "title": "Test Timezone Job",
                "description": "Testing timezone-aware job timestamps",
                "category": "testing",
                "budget_min": 50000.0,
                "budget_max": 100000.0,
                "location": {
                    "address": "Dakar, Senegal",
                    "latitude": 14.6937,
                    "longitude": -17.4441
                },
                "required_skills": ["testing"],
                "estimated_duration": "1 hour"
            }
            
            success, response = self.run_test(
                "Job Creation with Timezone-Aware Timestamps",
                "POST",
                "jobs",
                200,
                data=job_data,
                token=self.client_token
            )
            
            after_job_creation = datetime.now(timezone.utc)
            
            if success and response:
                # Check posted_at timestamp
                if 'posted_at' in response:
                    try:
                        if isinstance(response['posted_at'], str):
                            if response['posted_at'].endswith('Z'):
                                posted_at = datetime.fromisoformat(response['posted_at'].replace('Z', '+00:00'))
                            elif '+' in response['posted_at'] or response['posted_at'].endswith('00:00'):
                                posted_at = datetime.fromisoformat(response['posted_at'])
                            else:
                                posted_at = datetime.fromisoformat(response['posted_at']).replace(tzinfo=timezone.utc)
                        else:
                            posted_at = response['posted_at']
                        
                        if before_job_creation <= posted_at <= after_job_creation:
                            print(f"   ✅ posted_at timestamp is timezone-aware and recent: {posted_at}")
                            self.tests_passed += 1
                        else:
                            print(f"   ❌ posted_at timestamp out of range: {posted_at}")
                        
                        if posted_at.tzinfo is not None:
                            print(f"   ✅ posted_at has timezone info: {posted_at.tzinfo}")
                            self.tests_passed += 1
                        else:
                            print(f"   ❌ posted_at missing timezone info")
                        
                        self.tests_run += 2
                        
                    except Exception as e:
                        print(f"   ❌ Failed to parse posted_at timestamp: {e}")
                        self.tests_run += 1

    def test_profile_photo_with_compression(self):
        """Test profile photo upload with compression and secure paths"""
        print("\n" + "="*70)
        print("TESTING PROFILE PHOTO UPLOAD - COMPRESSION & SECURE PATHS")
        print("="*70)
        
        if not self.client_token:
            print("❌ Skipping profile photo tests - no client token")
            return
        
        # Test 1: Upload profile photo via register-verified endpoint with base64
        print(f"\n🔍 Testing Profile Photo Upload via Register-Verified (Base64)...")
        
        # Create a small test image in base64 format
        test_image_base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        
        photo_user_data = {
            "email": f"photo_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "PhotoTest2025!",
            "first_name": "Photo",
            "last_name": "TestUser",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567"
            },
            "profile_photo_base64": test_image_base64
        }
        
        success, response = self.run_test(
            "Register with Profile Photo (Base64)",
            "POST",
            "auth/register-verified",
            200,
            data=photo_user_data
        )
        
        photo_token = None
        if success and response:
            photo_token = response.get('access_token')
            user = response.get('user', {})
            
            # Check if profile photo path is secure and properly formatted
            if 'profile_photo' in user and user['profile_photo']:
                photo_path = user['profile_photo']
                print(f"   ✅ Profile photo path created: {photo_path}")
                
                # Check path format
                if photo_path.startswith('/uploads/profile_photos/'):
                    print(f"   ✅ Profile photo path has secure format")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ Profile photo path format incorrect: {photo_path}")
                
                # Check filename contains user ID and timestamp
                filename = photo_path.split('/')[-1]
                if user['id'] in filename and '_' in filename:
                    print(f"   ✅ Filename contains user ID and timestamp: {filename}")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ Filename format incorrect: {filename}")
                
                self.tests_run += 2
            else:
                print(f"   ❌ Profile photo not set in user profile")
                self.tests_run += 1
        
        # Test 2: Upload profile photo via file upload endpoint
        print(f"\n🔍 Testing Profile Photo Upload via File Upload Endpoint...")
        
        if self.client_token:
            # Create a small test image file
            test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
            
            files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
            
            success, response = self.run_test(
                "Upload Profile Photo (File Upload)",
                "POST",
                "users/profile-photo",
                200,
                token=self.client_token,
                files=files
            )
            
            if success and response:
                if 'photo_url' in response:
                    photo_url = response['photo_url']
                    print(f"   ✅ Photo URL returned: {photo_url}")
                    
                    # Check URL format
                    if photo_url.startswith('/uploads/profile_photos/'):
                        print(f"   ✅ Photo URL has secure format")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ Photo URL format incorrect: {photo_url}")
                    
                    self.tests_run += 1
                
                if 'filename' in response:
                    filename = response['filename']
                    print(f"   ✅ Filename returned: {filename}")
                    
                    # Check filename format (should contain user ID and timestamp)
                    if '_' in filename and '.' in filename:
                        print(f"   ✅ Filename has proper format with timestamp")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ Filename format incorrect: {filename}")
                    
                    self.tests_run += 1

    def run_all_ultra_tests(self):
        """Run all ultra-deep backend tests"""
        print("🚀 STARTING ULTRA-DEEP BACKEND TESTING FOR KOJO PLATFORM")
        print("=" * 80)
        print("Testing all ultra-advanced optimizations for West Africa launch")
        print("=" * 80)
        
        start_time = time.time()
        
        # Run all test suites
        self.test_enhanced_jwt_security()
        self.test_4_countries_validation()
        self.test_ultra_precise_mobile_validation()
        self.test_performance_middlewares()
        self.test_security_headers()
        self.test_optimized_cors()
        self.test_timezone_aware_timestamps()
        self.test_profile_photo_with_compression()
        
        end_time = time.time()
        duration = end_time - start_time
        
        # Print final results
        print("\n" + "="*80)
        print("🎯 ULTRA-DEEP BACKEND TESTING RESULTS")
        print("="*80)
        print(f"Total Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "0%")
        print(f"Duration: {duration:.2f} seconds")
        
        if self.tests_passed == self.tests_run:
            print("🎉 ALL ULTRA-DEEP TESTS PASSED! Backend is ready for West Africa launch!")
        elif self.tests_passed / self.tests_run >= 0.9:
            print("✅ EXCELLENT! Most ultra-advanced features working perfectly!")
        elif self.tests_passed / self.tests_run >= 0.8:
            print("👍 GOOD! Most features working, minor issues to address")
        else:
            print("⚠️  NEEDS ATTENTION! Several ultra-advanced features need fixes")
        
        print("="*80)
        
        return self.tests_passed, self.tests_run

if __name__ == "__main__":
    print("🌍 KOJO ULTRA-DEEP BACKEND TESTING - WEST AFRICA OPTIMIZATIONS")
    print("Testing enhanced JWT, 4-country validation, mobile precision, performance & security")
    
    tester = UltraKojoAPITester()
    passed, total = tester.run_all_ultra_tests()
    
    # Exit with appropriate code
    if passed == total:
        sys.exit(0)  # All tests passed
    else:
        sys.exit(1)  # Some tests failed