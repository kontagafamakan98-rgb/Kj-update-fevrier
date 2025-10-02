#!/usr/bin/env python3
"""
Client Verification Test - Verify client requirements (1+ payment method)
"""

import requests
import json
import uuid

class ClientVerificationTester:
    def __init__(self, base_url="https://kojo-profile.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0

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

    def test_client_verification_requirements(self):
        """Test client verification requirements (1+ payment method)"""
        print("\n🔍 CLIENT VERIFICATION TEST: 1+ Payment Method Required")
        
        test_cases = [
            {"accounts": 0, "should_verify": False, "description": "0 payment methods (should NOT verify)"},
            {"accounts": 1, "should_verify": True, "description": "1 payment method (should verify)"},
            {"accounts": 2, "should_verify": True, "description": "2 payment methods (should verify)"}
        ]
        
        all_passed = True
        
        for case in test_cases:
            unique_id = str(uuid.uuid4())[:8]
            
            user_data = {
                "email": f"test_client_{unique_id}@gmail.com",
                "password": "TestPassword123!",
                "first_name": "Fatou",
                "last_name": f"TestClient{unique_id}",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {}
            }
            
            # Add payment accounts based on count
            if case["accounts"] >= 1:
                user_data["payment_accounts"]["orange_money"] = "+221701234567"
            
            if case["accounts"] >= 2:
                user_data["payment_accounts"]["wave"] = "+221771234567"
            
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
                        f"Client verification - {case['description']}",
                        success,
                        f"Expected verified: {case['should_verify']}, Got: {is_verified}"
                    )
                    
                    all_passed = all_passed and success
                    
                elif response.status_code == 400 and not case["should_verify"]:
                    # Expected failure for insufficient payment methods
                    error_message = response.json().get("detail", "")
                    expected_error = "clients doivent lier au moins 1 moyen" in error_message
                    
                    self.log_test(
                        f"Client verification - {case['description']}",
                        expected_error,
                        f"Expected error for insufficient accounts: {error_message}"
                    )
                    
                    all_passed = all_passed and expected_error
                else:
                    self.log_test(
                        f"Client verification - {case['description']}",
                        False,
                        f"Unexpected response: {response.status_code} - {response.text}"
                    )
                    all_passed = False
                    
            except Exception as e:
                self.log_test(
                    f"Client verification - {case['description']}",
                    False,
                    f"Exception: {str(e)}"
                )
                all_passed = False
        
        return all_passed

    def run_test(self):
        """Run client verification test"""
        print("🚀 CLIENT VERIFICATION TEST - 1+ Payment Method Required")
        print("=" * 60)
        
        test_passed = self.test_client_verification_requirements()
        
        print("\n" + "=" * 60)
        print("📊 CLIENT TEST SUMMARY")
        print("=" * 60)
        print(f"Total Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if test_passed:
            print("\n✅ CLIENT VERIFICATION TEST PASSED!")
            print("✅ Clients require exactly 1+ payment method for verification")
        else:
            print("\n❌ CLIENT VERIFICATION TEST FAILED")
        
        return test_passed

if __name__ == "__main__":
    tester = ClientVerificationTester()
    success = tester.run_test()
    exit(0 if success else 1)