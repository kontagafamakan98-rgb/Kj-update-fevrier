#!/usr/bin/env python3
"""
Focused Backend Test for Recent Corrections
Test rapide et ciblé pour vérifier les corrections récentes:
1. Endpoint de registre avec photo
2. Validation des comptes bancaires (au lieu de cartes bancaires)
3. Endpoints existants (pas de régressions)
"""

import requests
import sys
import json
import io
import base64
from datetime import datetime

class FocusedKojoAPITester:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_result(self, test_name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            status = "✅ PASS"
        else:
            status = "❌ FAIL"
        
        result = f"{status} - {test_name}"
        if details:
            result += f" | {details}"
        
        self.test_results.append(result)
        print(result)

    def run_api_test(self, name, method, endpoint, expected_status, data=None, token=None, files=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {}
        
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        if not files:  # Only set Content-Type for JSON requests
            headers['Content-Type'] = 'application/json'

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

            success = response.status_code == expected_status
            
            try:
                response_data = response.json()
            except:
                response_data = {}

            if success:
                self.log_result(name, True, f"Status: {response.status_code}")
                return True, response_data
            else:
                error_detail = response_data.get('detail', response.text[:100]) if response_data else response.text[:100]
                self.log_result(name, False, f"Expected {expected_status}, got {response.status_code} | {error_detail}")
                return False, response_data

        except Exception as e:
            self.log_result(name, False, f"Exception: {str(e)}")
            return False, {}

    def test_1_register_with_photo_endpoint(self):
        """Test 1: Endpoint de registre avec photo - /api/auth/register-verified"""
        print("\n" + "="*60)
        print("TEST 1: ENDPOINT DE REGISTRE AVEC PHOTO")
        print("="*60)
        
        # Create a small test image in base64 format
        # 1x1 pixel PNG image
        test_image_base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77zgAAAABJRU5ErkJggg=="
        
        # Test registration with profile photo
        registration_data = {
            "email": f"photo_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Jean",
            "last_name": "Dupont",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567"
            },
            "profile_photo_base64": test_image_base64
        }
        
        success, response = self.run_api_test(
            "Registration with Profile Photo",
            "POST",
            "auth/register-verified",
            200,
            data=registration_data
        )
        
        if success:
            # Verify response contains user data and photo info
            user_data = response.get('user', {})
            profile_photo = user_data.get('profile_photo')
            
            if profile_photo and profile_photo.startswith('/uploads/profile_photos/'):
                self.log_result("Profile Photo Path in Response", True, f"Photo path: {profile_photo}")
            else:
                self.log_result("Profile Photo Path in Response", False, f"Expected photo path, got: {profile_photo}")
            
            # Store token for further tests
            self.test_token = response.get('access_token')
            self.test_user = user_data
            
            return True
        else:
            self.log_result("Registration with Photo Failed", False, "Cannot continue photo tests")
            return False

    def test_2_bank_account_validation(self):
        """Test 2: Validation des comptes bancaires (au lieu de cartes bancaires)"""
        print("\n" + "="*60)
        print("TEST 2: VALIDATION DES COMPTES BANCAIRES")
        print("="*60)
        
        # Test 2.1: Valid bank account registration
        valid_bank_data = {
            "email": f"bank_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Aminata",
            "last_name": "Traore",
            "phone": "+223701234567",
            "user_type": "client",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "12345678901234",
                    "bank_name": "Banque Atlantique Mali",
                    "account_holder": "Aminata Traore",
                    "bank_code": "BA001",
                    "branch": "Bamako Centre"
                }
            }
        }
        
        success, response = self.run_api_test(
            "Valid Bank Account Registration",
            "POST",
            "auth/register-verified",
            200,
            data=valid_bank_data
        )
        
        if success:
            # Verify bank account is properly processed
            payment_verification = response.get('payment_verification', {})
            linked_accounts = payment_verification.get('linked_accounts', 0)
            
            if linked_accounts >= 1:
                self.log_result("Bank Account Counted as Payment Method", True, f"Linked accounts: {linked_accounts}")
            else:
                self.log_result("Bank Account Counted as Payment Method", False, f"Expected >=1, got: {linked_accounts}")
        
        # Test 2.2: Invalid bank account (missing required fields)
        invalid_bank_data = {
            "email": f"bank_invalid_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Invalid",
            "phone": "+223701234568",
            "user_type": "client",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "123",  # Too short
                    "bank_name": "Test Bank"
                    # Missing account_holder
                }
            }
        }
        
        self.run_api_test(
            "Invalid Bank Account (Missing Fields)",
            "POST",
            "auth/register-verified",
            400,
            data=invalid_bank_data
        )
        
        # Test 2.3: Bank account masking
        if hasattr(self, 'test_token'):
            # Update payment accounts to test masking
            bank_update_data = {
                "bank_account": {
                    "account_number": "98765432101234",
                    "bank_name": "Ecobank Mali",
                    "account_holder": "Test User"
                }
            }
            
            success, response = self.run_api_test(
                "Update Bank Account",
                "PUT",
                "users/payment-accounts",
                200,
                data=bank_update_data,
                token=self.test_token
            )
            
            if success:
                # Get payment accounts to verify masking
                success, response = self.run_api_test(
                    "Get Payment Accounts (Check Masking)",
                    "GET",
                    "users/payment-accounts",
                    200,
                    token=self.test_token
                )
                
                if success:
                    payment_accounts = response.get('payment_accounts', {})
                    bank_account = payment_accounts.get('bank_account', {})
                    account_number = bank_account.get('account_number', '')
                    
                    if account_number.startswith('****') and len(account_number) > 4:
                        self.log_result("Bank Account Number Masking", True, f"Masked: {account_number}")
                    else:
                        self.log_result("Bank Account Number Masking", False, f"Not properly masked: {account_number}")

    def test_3_existing_endpoints_regression(self):
        """Test 3: Vérifier que les endpoints existants fonctionnent toujours"""
        print("\n" + "="*60)
        print("TEST 3: ENDPOINTS EXISTANTS (REGRESSION)")
        print("="*60)
        
        # Test 3.1: Health check
        self.run_api_test(
            "Health Check Endpoint",
            "GET",
            "health",
            200
        )
        
        # Test 3.2: Basic registration (without payment verification)
        basic_registration_data = {
            "email": f"basic_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "User",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_api_test(
            "Basic Registration Endpoint",
            "POST",
            "auth/register",
            200,
            data=basic_registration_data
        )
        
        basic_token = None
        if success:
            basic_token = response.get('access_token')
        
        # Test 3.3: Login functionality
        login_data = {
            "email": basic_registration_data["email"],
            "password": "TestPass123!"
        }
        
        self.run_api_test(
            "Login Endpoint",
            "POST",
            "auth/login",
            200,
            data=login_data
        )
        
        # Test 3.4: Profile access
        if basic_token:
            self.run_api_test(
                "User Profile Access",
                "GET",
                "users/profile",
                200,
                token=basic_token
            )
        
        # Test 3.5: Jobs endpoint
        if basic_token:
            self.run_api_test(
                "Jobs Listing Endpoint",
                "GET",
                "jobs",
                200,
                token=basic_token
            )
        
        # Test 3.6: Profile photo endpoints (existing functionality)
        if basic_token:
            # Test get profile photo when none exists
            self.run_api_test(
                "Get Profile Photo (None Exists)",
                "GET",
                "users/profile-photo",
                404,
                token=basic_token
            )
            
            # Test upload profile photo
            test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
            files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
            
            success, response = self.run_api_test(
                "Upload Profile Photo",
                "POST",
                "users/profile-photo",
                200,
                files=files,
                token=basic_token
            )
            
            if success:
                # Test get profile photo after upload
                self.run_api_test(
                    "Get Profile Photo (After Upload)",
                    "GET",
                    "users/profile-photo",
                    200,
                    token=basic_token
                )

    def run_focused_tests(self):
        """Run all focused tests"""
        print("🎯 FOCUSED BACKEND TEST - CORRECTIONS RÉCENTES")
        print("=" * 80)
        print("Test rapide et ciblé pour vérifier les corrections récentes")
        print("=" * 80)
        
        # Initialize test token
        self.test_token = None
        self.test_user = None
        
        # Run tests
        try:
            self.test_1_register_with_photo_endpoint()
            self.test_2_bank_account_validation()
            self.test_3_existing_endpoints_regression()
        except Exception as e:
            print(f"\n❌ ERREUR CRITIQUE: {str(e)}")
        
        # Print summary
        self.print_summary()

    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*80)
        print("📊 RÉSUMÉ DES TESTS")
        print("="*80)
        
        print(f"Tests exécutés: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Tests échoués: {self.tests_run - self.tests_passed}")
        print(f"Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "0%")
        
        print("\n📋 DÉTAILS DES RÉSULTATS:")
        for result in self.test_results:
            print(f"  {result}")
        
        print("\n" + "="*80)
        if self.tests_passed == self.tests_run:
            print("🎉 TOUS LES TESTS SONT PASSÉS - CORRECTIONS VALIDÉES!")
        elif self.tests_passed >= self.tests_run * 0.8:  # 80% success rate
            print("⚠️  LA PLUPART DES TESTS SONT PASSÉS - QUELQUES PROBLÈMES MINEURS")
        else:
            print("❌ PLUSIEURS TESTS ONT ÉCHOUÉ - CORRECTIONS NÉCESSAIRES")
        print("="*80)

if __name__ == "__main__":
    tester = FocusedKojoAPITester()
    tester.run_focused_tests()