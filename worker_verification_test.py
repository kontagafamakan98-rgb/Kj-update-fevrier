#!/usr/bin/env python3
"""
Worker Verification Test - Focus on Payment Account Requirements
Tests worker verification system without hourly rate requirements
"""

import requests
import json
import uuid
from datetime import datetime

class WorkerVerificationTester:
    def __init__(self, base_url="https://kojo-profile.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_users = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
            if details:
                print(f"   {details}")
        else:
            print(f"❌ {name}")
            if details:
                print(f"   {details}")

    def create_test_user_data(self, user_type="worker", payment_accounts_count=0):
        """Create test user data with specified payment accounts"""
        unique_id = str(uuid.uuid4())[:8]
        
        # Base user data without hourly rate
        user_data = {
            "email": f"test_worker_{unique_id}@gmail.com",
            "password": "TestPassword123!",
            "first_name": "Amadou",
            "last_name": f"TestWorker{unique_id}",
            "phone": f"+221701234567",
            "user_type": user_type,
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {}
        }
        
        # Add payment accounts based on count
        if payment_accounts_count >= 1:
            user_data["payment_accounts"]["orange_money"] = f"+22170123456{unique_id[:1]}"
        
        if payment_accounts_count >= 2:
            user_data["payment_accounts"]["wave"] = f"+22177123456{unique_id[:1]}"
            
        if payment_accounts_count >= 3:
            user_data["payment_accounts"]["bank_account"] = {
                "account_number": f"12345678{unique_id[:2]}",
                "bank_name": "Banque Atlantique",
                "account_holder": f"Amadou TestWorker{unique_id}"
            }
        
        return user_data

    def test_worker_registration_without_hourly_rate(self):
        """Test 1: Worker can register without hourly rate"""
        print("\n🔍 TEST 1: Worker Registration Without Hourly Rate")
        
        # Test with 2 payment methods (should succeed)
        user_data = self.create_test_user_data("worker", 2)
        
        try:
            response = requests.post(
                f"{self.base_url}/auth/register-verified",
                json=user_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code == 200:
                response_data = response.json()
                
                # Verify no hourly rate in response
                user_info = response_data.get("user", {})
                has_hourly_rate = "hourly_rate" in user_info
                
                # Verify worker is verified with 2 payment methods
                payment_verification = response_data.get("payment_verification", {})
                is_verified = payment_verification.get("is_verified", False)
                linked_accounts = payment_verification.get("linked_accounts", 0)
                
                success = (not has_hourly_rate and is_verified and linked_accounts == 2)
                
                self.log_test(
                    "Worker registration without hourly rate",
                    success,
                    f"Verified: {is_verified}, Accounts: {linked_accounts}, No hourly rate: {not has_hourly_rate}"
                )
                
                if success:
                    self.test_users.append({
                        "token": response_data.get("access_token"),
                        "user": user_info,
                        "type": "worker_verified"
                    })
                
                return success
            else:
                self.log_test(
                    "Worker registration without hourly rate",
                    False,
                    f"Registration failed: {response.status_code} - {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Worker registration without hourly rate",
                False,
                f"Exception: {str(e)}"
            )
            return False

    def test_worker_verification_payment_only(self):
        """Test 2: Worker verification depends ONLY on payment accounts"""
        print("\n🔍 TEST 2: Worker Verification Based Only on Payment Accounts")
        
        test_cases = [
            {"accounts": 1, "should_verify": False, "description": "1 payment method (should NOT verify)"},
            {"accounts": 2, "should_verify": True, "description": "2 payment methods (should verify)"},
            {"accounts": 3, "should_verify": True, "description": "3 payment methods (should verify)"}
        ]
        
        all_passed = True
        
        for case in test_cases:
            user_data = self.create_test_user_data("worker", case["accounts"])
            
            try:
                response = requests.post(
                    f"{self.base_url}/auth/register-verified",
                    json=user_data,
                    headers={'Content-Type': 'application/json'}
                )
                
                if response.status_code == 200:
                    response_data = response.json()
                    payment_verification = response_data.get("payment_verification", {})
                    is_verified = payment_verification.get("is_verified", False)
                    
                    success = (is_verified == case["should_verify"])
                    
                    self.log_test(
                        f"Worker verification - {case['description']}",
                        success,
                        f"Expected verified: {case['should_verify']}, Got: {is_verified}"
                    )
                    
                    if success and case["should_verify"]:
                        self.test_users.append({
                            "token": response_data.get("access_token"),
                            "user": response_data.get("user", {}),
                            "type": f"worker_{case['accounts']}_accounts"
                        })
                    
                    all_passed = all_passed and success
                    
                elif response.status_code == 400 and not case["should_verify"]:
                    # Expected failure for insufficient payment methods
                    error_message = response.json().get("detail", "")
                    expected_error = "travailleurs doivent lier au minimum 2 moyens" in error_message
                    
                    self.log_test(
                        f"Worker verification - {case['description']}",
                        expected_error,
                        f"Expected error for insufficient accounts: {error_message}"
                    )
                    
                    all_passed = all_passed and expected_error
                else:
                    self.log_test(
                        f"Worker verification - {case['description']}",
                        False,
                        f"Unexpected response: {response.status_code} - {response.text}"
                    )
                    all_passed = False
                    
            except Exception as e:
                self.log_test(
                    f"Worker verification - {case['description']}",
                    False,
                    f"Exception: {str(e)}"
                )
                all_passed = False
        
        return all_passed

    def test_payment_account_endpoints(self):
        """Test 3: Payment account management endpoints"""
        print("\n🔍 TEST 3: Payment Account Management Endpoints")
        
        if not self.test_users:
            self.log_test("Payment endpoints test", False, "No verified users available for testing")
            return False
        
        # Use a verified worker
        test_user = next((u for u in self.test_users if u["type"] == "worker_verified"), None)
        if not test_user:
            test_user = self.test_users[0]  # Use any available user
        
        token = test_user["token"]
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}'
        }
        
        all_passed = True
        
        # Test GET /api/users/payment-accounts
        try:
            response = requests.get(f"{self.base_url}/users/payment-accounts", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["user_type", "payment_accounts", "payment_accounts_count", "is_verified", "minimum_required"]
                has_all_fields = all(field in data for field in required_fields)
                
                self.log_test(
                    "GET /api/users/payment-accounts",
                    has_all_fields,
                    f"Response contains all required fields: {list(data.keys())}"
                )
                all_passed = all_passed and has_all_fields
            else:
                self.log_test(
                    "GET /api/users/payment-accounts",
                    False,
                    f"Failed: {response.status_code} - {response.text}"
                )
                all_passed = False
                
        except Exception as e:
            self.log_test("GET /api/users/payment-accounts", False, f"Exception: {str(e)}")
            all_passed = False
        
        # Test PUT /api/users/payment-accounts
        try:
            update_data = {
                "orange_money": "+221701234999",
                "wave": "+221771234999",
                "bank_account": {
                    "account_number": "123456789",
                    "bank_name": "Banque Atlantique",
                    "account_holder": "Test Worker Update"
                }
            }
            
            response = requests.put(
                f"{self.base_url}/users/payment-accounts",
                json=update_data,
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                has_verification_info = "payment_verification" in data
                
                self.log_test(
                    "PUT /api/users/payment-accounts",
                    has_verification_info,
                    f"Update successful with verification info"
                )
                all_passed = all_passed and has_verification_info
            else:
                self.log_test(
                    "PUT /api/users/payment-accounts",
                    False,
                    f"Failed: {response.status_code} - {response.text}"
                )
                all_passed = False
                
        except Exception as e:
            self.log_test("PUT /api/users/payment-accounts", False, f"Exception: {str(e)}")
            all_passed = False
        
        # Test POST /api/users/verify-payment-access
        try:
            response = requests.post(f"{self.base_url}/users/verify-payment-access", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["access_granted", "message", "user_type"]
                has_required_fields = all(field in data for field in required_fields)
                
                self.log_test(
                    "POST /api/users/verify-payment-access",
                    has_required_fields,
                    f"Access verification response: {data.get('access_granted', False)}"
                )
                all_passed = all_passed and has_required_fields
            else:
                self.log_test(
                    "POST /api/users/verify-payment-access",
                    False,
                    f"Failed: {response.status_code} - {response.text}"
                )
                all_passed = False
                
        except Exception as e:
            self.log_test("POST /api/users/verify-payment-access", False, f"Exception: {str(e)}")
            all_passed = False
        
        return all_passed

    def test_no_hourly_rate_in_api_responses(self):
        """Test 4: Verify no hourly rate fields in API responses"""
        print("\n🔍 TEST 4: Verify No Hourly Rate Fields in API Responses")
        
        if not self.test_users:
            self.log_test("No hourly rate test", False, "No test users available")
            return False
        
        test_user = self.test_users[0]
        token = test_user["token"]
        headers = {'Authorization': f'Bearer {token}'}
        
        all_passed = True
        
        # Test user profile endpoint
        try:
            response = requests.get(f"{self.base_url}/users/profile", headers=headers)
            
            if response.status_code == 200:
                profile_data = response.json()
                has_hourly_rate = "hourly_rate" in profile_data
                
                self.log_test(
                    "User profile has no hourly rate field",
                    not has_hourly_rate,
                    f"Profile fields: {list(profile_data.keys())}"
                )
                all_passed = all_passed and not has_hourly_rate
            else:
                self.log_test(
                    "User profile has no hourly rate field",
                    False,
                    f"Failed to get profile: {response.status_code}"
                )
                all_passed = False
                
        except Exception as e:
            self.log_test("User profile has no hourly rate field", False, f"Exception: {str(e)}")
            all_passed = False
        
        # Test worker profile endpoint if user is worker
        if test_user["user"].get("user_type") == "worker":
            try:
                response = requests.get(f"{self.base_url}/workers/profile", headers=headers)
                
                if response.status_code == 200:
                    worker_profile = response.json()
                    has_hourly_rate = "hourly_rate" in worker_profile
                    
                    self.log_test(
                        "Worker profile has no hourly rate field",
                        not has_hourly_rate,
                        f"Worker profile fields: {list(worker_profile.keys())}"
                    )
                    all_passed = all_passed and not has_hourly_rate
                elif response.status_code == 404:
                    # Worker profile might not exist, which is fine
                    self.log_test(
                        "Worker profile has no hourly rate field",
                        True,
                        "Worker profile not found (acceptable)"
                    )
                else:
                    self.log_test(
                        "Worker profile has no hourly rate field",
                        False,
                        f"Unexpected response: {response.status_code}"
                    )
                    all_passed = False
                    
            except Exception as e:
                self.log_test("Worker profile has no hourly rate field", False, f"Exception: {str(e)}")
                all_passed = False
        
        return all_passed

    def run_all_tests(self):
        """Run all worker verification tests"""
        print("🚀 WORKER VERIFICATION TEST SUITE - NO HOURLY RATE REQUIREMENTS")
        print("=" * 70)
        
        # Test 1: Worker Registration
        test1_passed = self.test_worker_registration_without_hourly_rate()
        
        # Test 2: Payment Account Verification
        test2_passed = self.test_worker_verification_payment_only()
        
        # Test 3: API Endpoints
        test3_passed = self.test_payment_account_endpoints()
        
        # Test 4: No Hourly Rate Fields
        test4_passed = self.test_no_hourly_rate_in_api_responses()
        
        # Summary
        print("\n" + "=" * 70)
        print("📊 TEST SUMMARY")
        print("=" * 70)
        print(f"Total Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        all_tests_passed = test1_passed and test2_passed and test3_passed and test4_passed
        
        if all_tests_passed:
            print("\n✅ ALL WORKER VERIFICATION TESTS PASSED!")
            print("✅ Workers can register without hourly rate")
            print("✅ Worker verification depends ONLY on payment accounts (2+ required)")
            print("✅ All worker endpoints functional without hourly rate requirements")
        else:
            print("\n❌ SOME TESTS FAILED")
            if not test1_passed:
                print("❌ Worker registration issues detected")
            if not test2_passed:
                print("❌ Payment account verification issues detected")
            if not test3_passed:
                print("❌ API endpoint issues detected")
            if not test4_passed:
                print("❌ Hourly rate fields still present")
        
        return all_tests_passed

if __name__ == "__main__":
    tester = WorkerVerificationTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)