#!/usr/bin/env python3
"""
FOCUSED ULTRA TESTING - Additional verification of specific review request items
"""

import requests
import sys
import json
import jwt
from datetime import datetime, timezone

class FocusedUltraTest:
    def __init__(self, base_url="https://kojo-mobile-pro.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url.replace('/api', '')
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
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

    def test_jwt_secret_robustness(self):
        """Test JWT secret robustness and timezone-aware expiration"""
        print("\n" + "="*60)
        print("TESTING JWT SECRET ROBUSTNESS & TIMEZONE-AWARE EXPIRATION")
        print("="*60)
        
        # Register user to get JWT
        user_data = {
            "email": f"jwt_robust_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "RobustJWT2025!",
            "first_name": "JWT",
            "last_name": "Robust",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "JWT Token Generation for Robustness Test",
            "POST",
            "auth/register",
            200,
            data=user_data
        )
        
        if success and 'access_token' in response:
            token = response['access_token']
            
            # Decode JWT to check structure
            try:
                decoded = jwt.decode(token, options={"verify_signature": False})
                
                print(f"\n🔍 JWT Token Analysis:")
                print(f"   Algorithm: {jwt.get_unverified_header(token).get('alg', 'Unknown')}")
                print(f"   Subject (sub): {decoded.get('sub', 'Missing')}")
                print(f"   Email: {decoded.get('email', 'Missing')}")
                
                # Check expiration timezone awareness
                if 'exp' in decoded:
                    exp_timestamp = decoded['exp']
                    exp_datetime = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
                    current_time = datetime.now(timezone.utc)
                    time_until_exp = exp_datetime - current_time
                    
                    print(f"   Expiration: {exp_datetime} UTC")
                    print(f"   Time until expiration: {time_until_exp}")
                    
                    # Should be approximately 24 hours
                    hours_until_exp = time_until_exp.total_seconds() / 3600
                    if 23.5 <= hours_until_exp <= 24.5:
                        print(f"   ✅ JWT expiration correctly set to ~24 hours ({hours_until_exp:.1f}h)")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ JWT expiration not 24 hours ({hours_until_exp:.1f}h)")
                    self.tests_run += 1
                
                # Check token length (robust secrets should produce longer tokens)
                if len(token) > 100:
                    print(f"   ✅ JWT token length indicates robust secret ({len(token)} chars)")
                    self.tests_passed += 1
                else:
                    print(f"   ⚠️  JWT token seems short ({len(token)} chars)")
                self.tests_run += 1
                
            except Exception as e:
                print(f"   ❌ Failed to analyze JWT: {e}")
                self.tests_run += 1

    def test_country_enum_restriction(self):
        """Test that Country enum is restricted to exactly 4 countries"""
        print("\n" + "="*60)
        print("TESTING COUNTRY ENUM - EXACTLY 4 PRIORITY COUNTRIES")
        print("="*60)
        
        # Test all 4 priority countries work
        priority_countries = ['senegal', 'mali', 'ivory_coast', 'burkina_faso']
        
        for country in priority_countries:
            user_data = {
                "email": f"country_{country}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "CountryTest2025!",
                "first_name": "Country",
                "last_name": country.title(),
                "phone": "+221701234567",
                "user_type": "client",
                "country": country,
                "preferred_language": "fr"
            }
            
            success, response = self.run_test(
                f"Priority Country: {country.title()}",
                "POST",
                "auth/register",
                200,
                data=user_data
            )
        
        # Test non-priority countries are rejected
        non_priority = ['guinea', 'niger', 'togo', 'benin', 'nigeria', 'ghana']
        
        for country in non_priority:
            user_data = {
                "email": f"invalid_{country}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "InvalidCountry2025!",
                "first_name": "Invalid",
                "last_name": country.title(),
                "phone": "+221701234567",
                "user_type": "client",
                "country": country,
                "preferred_language": "fr"
            }
            
            success, response = self.run_test(
                f"Non-Priority Country: {country.title()} (Should Fail)",
                "POST",
                "auth/register",
                422,
                data=user_data
            )

    def test_operator_prefix_precision(self):
        """Test ultra-precise operator prefix validation"""
        print("\n" + "="*60)
        print("TESTING ULTRA-PRECISE OPERATOR PREFIX VALIDATION")
        print("="*60)
        
        # Test specific operator prefixes for each country
        test_cases = [
            # Senegal Orange Money
            {"country": "senegal", "code": "+221", "prefix": "77", "type": "orange_money", "should_pass": True},
            {"country": "senegal", "code": "+221", "prefix": "78", "type": "orange_money", "should_pass": True},
            {"country": "senegal", "code": "+221", "prefix": "70", "type": "orange_money", "should_pass": True},
            {"country": "senegal", "code": "+221", "prefix": "76", "type": "orange_money", "should_pass": False},  # This is Wave, not Orange
            
            # Mali Wave
            {"country": "mali", "code": "+223", "prefix": "65", "type": "wave", "should_pass": True},
            {"country": "mali", "code": "+223", "prefix": "66", "type": "wave", "should_pass": True},
            {"country": "mali", "code": "+223", "prefix": "77", "type": "wave", "should_pass": True},
            {"country": "mali", "code": "+223", "prefix": "99", "type": "wave", "should_pass": False},  # Invalid prefix
            
            # Ivory Coast specific prefixes
            {"country": "ivory_coast", "code": "+225", "prefix": "58", "type": "wave", "should_pass": True},
            {"country": "ivory_coast", "code": "+225", "prefix": "59", "type": "wave", "should_pass": True},
            {"country": "ivory_coast", "code": "+225", "prefix": "77", "type": "orange_money", "should_pass": True},
            
            # Burkina Faso specific prefixes
            {"country": "burkina_faso", "code": "+226", "prefix": "70", "type": "wave", "should_pass": True},
            {"country": "burkina_faso", "code": "+226", "prefix": "71", "type": "wave", "should_pass": True},
            {"country": "burkina_faso", "code": "+226", "prefix": "77", "type": "orange_money", "should_pass": True},
        ]
        
        for i, test_case in enumerate(test_cases):
            number = f"{test_case['code']}{test_case['prefix']}1234567"
            
            user_data = {
                "email": f"prefix_test_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "PrefixTest2025!",
                "first_name": "Prefix",
                "last_name": "Test",
                "phone": number,
                "user_type": "client",
                "country": test_case['country'],
                "preferred_language": "fr",
                "payment_accounts": {
                    test_case['type']: number
                }
            }
            
            expected_status = 200 if test_case['should_pass'] else 400
            result_text = "Should Pass" if test_case['should_pass'] else "Should Fail"
            
            success, response = self.run_test(
                f"{test_case['country'].title()} {test_case['type'].replace('_', ' ').title()} {test_case['prefix']} ({result_text})",
                "POST",
                "auth/register-verified",
                expected_status,
                data=user_data
            )

    def test_security_middleware_coverage(self):
        """Test security middleware coverage across different endpoints"""
        print("\n" + "="*60)
        print("TESTING SECURITY MIDDLEWARE COVERAGE")
        print("="*60)
        
        # Test various API endpoints for security headers
        endpoints = [
            ("health", "Health Check"),
            ("auth/login", "Authentication"),
            ("jobs", "Jobs API"),
            ("users/profile", "User Profile")
        ]
        
        for endpoint, description in endpoints:
            try:
                url = f"{self.base_url}/{endpoint}"
                response = requests.get(url)
                
                print(f"\n🔍 Testing {description} ({endpoint})...")
                
                # Check for West Africa specific headers
                west_africa_headers = ['X-Kojo-Region', 'X-Kojo-Version']
                security_headers = ['X-Content-Type-Options', 'X-Frame-Options', 'X-XSS-Protection']
                
                headers_found = 0
                total_headers = len(west_africa_headers) + len(security_headers)
                
                for header in west_africa_headers + security_headers:
                    if header in response.headers:
                        print(f"   ✅ {header}: {response.headers[header]}")
                        headers_found += 1
                    else:
                        print(f"   ❌ Missing: {header}")
                
                if headers_found == total_headers:
                    print(f"   ✅ All security headers present ({headers_found}/{total_headers})")
                    self.tests_passed += 1
                else:
                    print(f"   ⚠️  Security headers: {headers_found}/{total_headers}")
                
                self.tests_run += 1
                
            except Exception as e:
                print(f"   ❌ Failed to test {description}: {e}")
                self.tests_run += 1

    def run_focused_tests(self):
        """Run all focused ultra tests"""
        print("🎯 FOCUSED ULTRA TESTING - SPECIFIC REVIEW REQUEST VERIFICATION")
        print("=" * 70)
        
        self.test_jwt_secret_robustness()
        self.test_country_enum_restriction()
        self.test_operator_prefix_precision()
        self.test_security_middleware_coverage()
        
        # Print results
        print("\n" + "="*70)
        print("🎯 FOCUSED ULTRA TESTING RESULTS")
        print("="*70)
        print(f"Total Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "0%")
        
        return self.tests_passed, self.tests_run

if __name__ == "__main__":
    tester = FocusedUltraTest()
    passed, total = tester.run_focused_tests()
    sys.exit(0 if passed == total else 1)