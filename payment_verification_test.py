#!/usr/bin/env python3
"""
Payment Account Verification System Test
Tests the new verification requirements for client and worker users
"""

import requests
import json
from datetime import datetime

class PaymentVerificationTester:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.client_user = None
        self.worker_user = None
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
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
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 1000:
                        print(f"   Response: {json.dumps(response_data, indent=2)}")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {json.dumps(error_data, indent=2)}")
                except:
                    print(f"   Error: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def setup_test_users(self):
        """Create test users for payment verification testing"""
        print("\n" + "="*60)
        print("SETTING UP TEST USERS FOR PAYMENT VERIFICATION")
        print("="*60)
        
        # Create client user
        client_data = {
            "email": f"payment_client_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Payment",
            "last_name": "Client",
            "phone": "+221701234567",  # Senegal
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Create Client User",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            self.client_user = response['user']
            print(f"   Client ID: {self.client_user['id']}")
        else:
            print("❌ Failed to create client user - cannot continue tests")
            return False
        
        # Create worker user
        worker_data = {
            "email": f"payment_worker_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Payment",
            "last_name": "Worker",
            "phone": "+223751234567",  # Mali
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Create Worker User",
            "POST",
            "auth/register",
            200,
            data=worker_data
        )
        
        if success and 'access_token' in response:
            self.worker_token = response['access_token']
            self.worker_user = response['user']
            print(f"   Worker ID: {self.worker_user['id']}")
            return True
        else:
            print("❌ Failed to create worker user - cannot continue tests")
            return False

    def test_get_payment_accounts(self):
        """Test GET /api/users/payment-accounts endpoint"""
        print("\n" + "="*60)
        print("TESTING GET PAYMENT ACCOUNTS ENDPOINT")
        print("="*60)
        
        # Test client user payment accounts retrieval
        success, response = self.run_test(
            "Get Client Payment Accounts",
            "GET",
            "users/payment-accounts",
            200,
            token=self.client_token
        )
        
        if success:
            # Verify response structure
            expected_fields = ['user_id', 'user_type', 'payment_accounts', 'payment_accounts_count', 'is_verified', 'minimum_required']
            for field in expected_fields:
                if field not in response:
                    print(f"❌ Missing field in response: {field}")
                else:
                    print(f"✅ Field present: {field} = {response[field]}")
            
            # Verify client minimum requirement is 1
            if response.get('minimum_required') == 1:
                print("✅ Client minimum requirement correctly set to 1")
            else:
                print(f"❌ Client minimum requirement should be 1, got {response.get('minimum_required')}")
        
        # Test worker user payment accounts retrieval
        success, response = self.run_test(
            "Get Worker Payment Accounts",
            "GET",
            "users/payment-accounts",
            200,
            token=self.worker_token
        )
        
        if success:
            # Verify worker minimum requirement is 2
            if response.get('minimum_required') == 2:
                print("✅ Worker minimum requirement correctly set to 2")
            else:
                print(f"❌ Worker minimum requirement should be 2, got {response.get('minimum_required')}")

    def test_client_payment_scenarios(self):
        """Test client payment account scenarios (needs minimum 1)"""
        print("\n" + "="*60)
        print("TESTING CLIENT PAYMENT SCENARIOS (MINIMUM 1 REQUIRED)")
        print("="*60)
        
        # Test 1: Client with 0 accounts (should fail)
        empty_payment_data = {
            "orange_money": None,
            "wave": None,
            "bank_account": None
        }
        
        success, response = self.run_test(
            "Client with 0 payment accounts (should fail)",
            "PUT",
            "users/payment-accounts",
            400,  # Should fail
            data=empty_payment_data,
            token=self.client_token
        )
        
        if success:
            print("✅ Correctly rejected client with 0 payment accounts")
        
        # Test 2: Client with 1 Orange Money account (should succeed)
        orange_money_data = {
            "orange_money": "+221701234567",  # Valid Senegal Orange Money
            "wave": None,
            "bank_account": None
        }
        
        success, response = self.run_test(
            "Client with 1 Orange Money account (should succeed)",
            "PUT",
            "users/payment-accounts",
            200,
            data=orange_money_data,
            token=self.client_token
        )
        
        if success and response.get('payment_verification', {}).get('is_verified'):
            print("✅ Client successfully verified with 1 Orange Money account")
        
        # Test 3: Client with 1 Wave account (should succeed)
        wave_data = {
            "orange_money": None,
            "wave": "+221771234567",  # Valid Senegal Wave
            "bank_account": None
        }
        
        success, response = self.run_test(
            "Client with 1 Wave account (should succeed)",
            "PUT",
            "users/payment-accounts",
            200,
            data=wave_data,
            token=self.client_token
        )
        
        if success and response.get('payment_verification', {}).get('is_verified'):
            print("✅ Client successfully verified with 1 Wave account")
        
        # Test 4: Client with 1 Bank account (should succeed)
        bank_account_data = {
            "orange_money": None,
            "wave": None,
            "bank_account": {
                "account_number": "1234567890",
                "bank_name": "Banque Atlantique",
                "account_holder": "Payment Client"
            }
        }
        
        success, response = self.run_test(
            "Client with 1 Bank account (should succeed)",
            "PUT",
            "users/payment-accounts",
            200,
            data=bank_account_data,
            token=self.client_token
        )
        
        if success and response.get('payment_verification', {}).get('is_verified'):
            print("✅ Client successfully verified with 1 Bank account")

    def test_worker_payment_scenarios(self):
        """Test worker payment account scenarios (needs minimum 2)"""
        print("\n" + "="*60)
        print("TESTING WORKER PAYMENT SCENARIOS (MINIMUM 2 REQUIRED)")
        print("="*60)
        
        # Test 1: Worker with 1 account (should fail)
        single_account_data = {
            "orange_money": "+223751234567",  # Valid Mali Orange Money
            "wave": None,
            "bank_account": None
        }
        
        success, response = self.run_test(
            "Worker with 1 payment account (should fail)",
            "PUT",
            "users/payment-accounts",
            400,  # Should fail
            data=single_account_data,
            token=self.worker_token
        )
        
        if success:
            print("✅ Correctly rejected worker with only 1 payment account")
        
        # Test 2: Worker with 2 accounts - Orange Money + Wave (should succeed)
        two_accounts_data = {
            "orange_money": "+223751234567",  # Valid Mali Orange Money
            "wave": "+223771234567",  # Valid Mali Wave
            "bank_account": None
        }
        
        success, response = self.run_test(
            "Worker with 2 accounts - Orange Money + Wave (should succeed)",
            "PUT",
            "users/payment-accounts",
            200,
            data=two_accounts_data,
            token=self.worker_token
        )
        
        if success and response.get('payment_verification', {}).get('is_verified'):
            print("✅ Worker successfully verified with Orange Money + Wave")
        
        # Test 3: Worker with 2 accounts - Orange Money + Bank (should succeed)
        orange_bank_data = {
            "orange_money": "+223751234567",  # Valid Mali Orange Money
            "wave": None,
            "bank_account": {
                "account_number": "9876543210",
                "bank_name": "Bank of Africa Mali",
                "account_holder": "Payment Worker"
            }
        }
        
        success, response = self.run_test(
            "Worker with 2 accounts - Orange Money + Bank (should succeed)",
            "PUT",
            "users/payment-accounts",
            200,
            data=orange_bank_data,
            token=self.worker_token
        )
        
        if success and response.get('payment_verification', {}).get('is_verified'):
            print("✅ Worker successfully verified with Orange Money + Bank")
        
        # Test 4: Worker with 3 accounts - All methods (should succeed)
        all_accounts_data = {
            "orange_money": "+223751234567",  # Valid Mali Orange Money
            "wave": "+223771234567",  # Valid Mali Wave
            "bank_account": {
                "account_number": "1122334455",
                "bank_name": "Ecobank Mali",
                "account_holder": "Payment Worker"
            }
        }
        
        success, response = self.run_test(
            "Worker with 3 accounts - All methods (should succeed)",
            "PUT",
            "users/payment-accounts",
            200,
            data=all_accounts_data,
            token=self.worker_token
        )
        
        if success and response.get('payment_verification', {}).get('is_verified'):
            print("✅ Worker successfully verified with all 3 payment methods")

    def test_payment_validation(self):
        """Test payment method validation"""
        print("\n" + "="*60)
        print("TESTING PAYMENT METHOD VALIDATION")
        print("="*60)
        
        # Test invalid Orange Money numbers
        invalid_orange_data = {
            "orange_money": "+221601234567",  # Invalid prefix (60 not in 70-99 range)
            "wave": None,
            "bank_account": None
        }
        
        success, response = self.run_test(
            "Invalid Orange Money number (should fail)",
            "PUT",
            "users/payment-accounts",
            400,
            data=invalid_orange_data,
            token=self.client_token
        )
        
        if success:
            print("✅ Correctly rejected invalid Orange Money number")
        
        # Test invalid Wave numbers
        invalid_wave_data = {
            "orange_money": None,
            "wave": "+221601234567",  # Invalid prefix
            "bank_account": None
        }
        
        success, response = self.run_test(
            "Invalid Wave number (should fail)",
            "PUT",
            "users/payment-accounts",
            400,
            data=invalid_wave_data,
            token=self.client_token
        )
        
        if success:
            print("✅ Correctly rejected invalid Wave number")
        
        # Test invalid bank account (missing required fields)
        invalid_bank_data = {
            "orange_money": None,
            "wave": None,
            "bank_account": {
                "account_number": "123",  # Too short
                "bank_name": "",  # Empty
                "account_holder": ""  # Empty
            }
        }
        
        success, response = self.run_test(
            "Invalid bank account (should fail)",
            "PUT",
            "users/payment-accounts",
            400,
            data=invalid_bank_data,
            token=self.client_token
        )
        
        if success:
            print("✅ Correctly rejected invalid bank account")

    def test_valid_payment_numbers(self):
        """Test valid payment numbers from different countries"""
        print("\n" + "="*60)
        print("TESTING VALID PAYMENT NUMBERS FROM DIFFERENT COUNTRIES")
        print("="*60)
        
        # Test valid Orange Money numbers from different countries
        valid_orange_numbers = [
            "+221701234567",  # Senegal
            "+223751234567",  # Mali
            "+225801234567",  # Ivory Coast
            "+226901234567",  # Burkina Faso
        ]
        
        for number in valid_orange_numbers:
            country = {
                "+221": "Senegal",
                "+223": "Mali", 
                "+225": "Ivory Coast",
                "+226": "Burkina Faso"
            }[number[:4]]
            
            orange_data = {
                "orange_money": number,
                "wave": None,
                "bank_account": None
            }
            
            success, response = self.run_test(
                f"Valid Orange Money - {country} ({number})",
                "PUT",
                "users/payment-accounts",
                200,
                data=orange_data,
                token=self.client_token
            )
            
            if success:
                print(f"✅ Valid Orange Money number accepted for {country}")
        
        # Test valid Wave numbers from different countries
        valid_wave_numbers = [
            "+221771234567",  # Senegal
            "+223781234567",  # Mali
            "+225781234567",  # Ivory Coast
            "+226851234567",  # Burkina Faso
        ]
        
        for number in valid_wave_numbers:
            country = {
                "+221": "Senegal",
                "+223": "Mali",
                "+225": "Ivory Coast", 
                "+226": "Burkina Faso"
            }[number[:4]]
            
            wave_data = {
                "orange_money": None,
                "wave": number,
                "bank_account": None
            }
            
            success, response = self.run_test(
                f"Valid Wave - {country} ({number})",
                "PUT",
                "users/payment-accounts",
                200,
                data=wave_data,
                token=self.client_token
            )
            
            if success:
                print(f"✅ Valid Wave number accepted for {country}")

    def test_verify_payment_access(self):
        """Test POST /api/users/verify-payment-access endpoint"""
        print("\n" + "="*60)
        print("TESTING PAYMENT ACCESS VERIFICATION ENDPOINT")
        print("="*60)
        
        # First, set up client with 1 account (should grant access)
        client_payment_data = {
            "orange_money": "+221701234567",
            "wave": None,
            "bank_account": None
        }
        
        self.run_test(
            "Setup client with 1 payment account",
            "PUT",
            "users/payment-accounts",
            200,
            data=client_payment_data,
            token=self.client_token
        )
        
        # Test client access verification
        success, response = self.run_test(
            "Verify client payment access (should grant)",
            "POST",
            "users/verify-payment-access",
            200,
            token=self.client_token
        )
        
        if success and response.get('access_granted'):
            print("✅ Client correctly granted payment access with 1 account")
        
        # Set up worker with 2 accounts (should grant access)
        worker_payment_data = {
            "orange_money": "+223751234567",
            "wave": "+223771234567",
            "bank_account": None
        }
        
        self.run_test(
            "Setup worker with 2 payment accounts",
            "PUT",
            "users/payment-accounts",
            200,
            data=worker_payment_data,
            token=self.worker_token
        )
        
        # Test worker access verification
        success, response = self.run_test(
            "Verify worker payment access (should grant)",
            "POST",
            "users/verify-payment-access",
            200,
            token=self.worker_token
        )
        
        if success and response.get('access_granted'):
            print("✅ Worker correctly granted payment access with 2 accounts")

    def run_all_tests(self):
        """Run all payment verification tests"""
        print("\n" + "🚀" * 20)
        print("STARTING PAYMENT ACCOUNT VERIFICATION SYSTEM TESTS")
        print("🚀" * 20)
        
        # Setup test users
        if not self.setup_test_users():
            print("❌ Failed to setup test users - aborting tests")
            return
        
        # Run all test suites
        self.test_get_payment_accounts()
        self.test_client_payment_scenarios()
        self.test_worker_payment_scenarios()
        self.test_payment_validation()
        self.test_valid_payment_numbers()
        self.test_verify_payment_access()
        
        # Print final results
        print("\n" + "="*60)
        print("PAYMENT VERIFICATION SYSTEM TEST RESULTS")
        print("="*60)
        print(f"Total Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed / self.tests_run * 100):.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("\n🎉 ALL PAYMENT VERIFICATION TESTS PASSED!")
            print("✅ Client verification (minimum 1 payment method) working correctly")
            print("✅ Worker verification (minimum 2 payment methods) working correctly")
            print("✅ Payment method validation working correctly")
            print("✅ All endpoints responding as expected")
        else:
            print(f"\n⚠️  {self.tests_run - self.tests_passed} tests failed - review above for details")

if __name__ == "__main__":
    tester = PaymentVerificationTester()
    tester.run_all_tests()