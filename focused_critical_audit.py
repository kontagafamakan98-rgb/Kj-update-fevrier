#!/usr/bin/env python3
"""
AUDIT CRITIQUE FOCALISÉ - IDENTIFICATION DES ERREURS CRITIQUES
Focused Critical Audit for Critical Issues Only
"""

import requests
import sys
import json
from datetime import datetime

class FocusedCriticalAuditor:
    def __init__(self, base_url="https://geoloc-boost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.critical_errors = []
        self.tests_run = 0
        self.tests_passed = 0
        
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
    
    def test_validation_error_handling(self):
        """Test critical validation error handling issues"""
        print("\n" + "="*80)
        print("AUDIT CRITIQUE: GESTION DES ERREURS DE VALIDATION")
        print("="*80)
        
        # Test cases that should return 422 but might return 500
        validation_tests = [
            {
                "name": "Empty first_name (should be 422, not 500)",
                "data": {
                    "email": "test@test.com",
                    "password": "TestPass123!",
                    "first_name": "",
                    "last_name": "Test",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                }
            },
            {
                "name": "First name too short (should be 422, not 500)",
                "data": {
                    "email": "test2@test.com",
                    "password": "TestPass123!",
                    "first_name": "a",
                    "last_name": "Test",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                }
            },
            {
                "name": "Invalid phone format (should be 422, not 500)",
                "data": {
                    "email": "test3@test.com",
                    "password": "TestPass123!",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "invalid-phone",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                }
            },
            {
                "name": "Very long first name (should be 422, not 500)",
                "data": {
                    "email": "test4@test.com",
                    "password": "TestPass123!",
                    "first_name": "a" * 1000,  # Way too long
                    "last_name": "Test",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                }
            }
        ]
        
        for test in validation_tests:
            self.tests_run += 1
            print(f"\n🔍 Testing {test['name']}...")
            
            try:
                url = f"{self.base_url}/auth/register"
                headers = {'Content-Type': 'application/json'}
                response = requests.post(url, json=test["data"], headers=headers, timeout=10)
                
                if response.status_code == 422:
                    print(f"✅ Correct - Status: 422 (Validation Error)")
                    self.tests_passed += 1
                elif response.status_code == 500:
                    self.log_critical_error(
                        "VALIDATION_ERROR_HANDLING",
                        f"Validation error returns 500 instead of 422: {test['name']}",
                        f"Expected 422, got 500"
                    )
                    print(f"❌ CRITICAL - Status: 500 (Should be 422)")
                else:
                    print(f"⚠️  Unexpected - Status: {response.status_code}")
                    
            except Exception as e:
                self.log_critical_error(
                    "VALIDATION_EXCEPTION",
                    f"Exception during validation test: {test['name']}",
                    str(e)
                )
                print(f"❌ Exception: {str(e)}")

    def test_security_critical_issues(self):
        """Test critical security issues"""
        print("\n" + "="*80)
        print("AUDIT CRITIQUE: PROBLÈMES DE SÉCURITÉ CRITIQUES")
        print("="*80)
        
        # Test SQL injection in email field (even though using MongoDB)
        print("\n🔍 Testing SQL Injection Protection...")
        
        injection_payloads = [
            "test'; DROP TABLE users; --@test.com",
            "test' OR '1'='1@test.com",
            "admin'/**/OR/**/1=1#@test.com"
        ]
        
        for payload in injection_payloads:
            self.tests_run += 1
            test_data = {
                "email": payload,
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "User",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            try:
                url = f"{self.base_url}/auth/register"
                headers = {'Content-Type': 'application/json'}
                response = requests.post(url, json=test_data, headers=headers, timeout=10)
                
                if response.status_code in [400, 422]:
                    print(f"✅ Injection payload properly rejected: {payload[:30]}...")
                    self.tests_passed += 1
                elif response.status_code == 200:
                    self.log_critical_error(
                        "INJECTION_VULNERABILITY",
                        f"SQL injection payload accepted: {payload}",
                        "Payload was processed successfully"
                    )
                    print(f"🚨 CRITICAL - Injection payload accepted!")
                else:
                    print(f"⚠️  Unexpected response: {response.status_code}")
                    
            except Exception as e:
                print(f"❌ Exception: {str(e)}")

    def test_authentication_bypass(self):
        """Test for authentication bypass vulnerabilities"""
        print("\n" + "="*80)
        print("AUDIT CRITIQUE: CONTOURNEMENT D'AUTHENTIFICATION")
        print("="*80)
        
        # Test accessing protected endpoints without authentication
        protected_endpoints = [
            ("users/profile", "GET"),
            ("jobs", "GET"),
            ("users/profile-photo", "GET"),
            ("messages/conversations", "GET")
        ]
        
        for endpoint, method in protected_endpoints:
            self.tests_run += 1
            print(f"\n🔍 Testing {method} {endpoint} without auth...")
            
            try:
                url = f"{self.base_url}/{endpoint}"
                
                if method == "GET":
                    response = requests.get(url, timeout=10)
                elif method == "POST":
                    response = requests.post(url, json={}, timeout=10)
                
                if response.status_code in [401, 403]:
                    print(f"✅ Properly protected - Status: {response.status_code}")
                    self.tests_passed += 1
                elif response.status_code == 200:
                    self.log_critical_error(
                        "AUTHENTICATION_BYPASS",
                        f"Protected endpoint accessible without auth: {endpoint}",
                        f"Endpoint returned 200 OK without authentication"
                    )
                    print(f"🚨 CRITICAL - Endpoint accessible without auth!")
                else:
                    print(f"⚠️  Unexpected response: {response.status_code}")
                    
            except Exception as e:
                print(f"❌ Exception: {str(e)}")

    def test_data_exposure(self):
        """Test for sensitive data exposure"""
        print("\n" + "="*80)
        print("AUDIT CRITIQUE: EXPOSITION DE DONNÉES SENSIBLES")
        print("="*80)
        
        # Create a test user to check data exposure
        timestamp = datetime.now().strftime('%H%M%S%f')
        test_user_data = {
            "email": f"data_exposure_test_{timestamp}@test.com",
            "password": "TestPass123!",
            "first_name": "DataExposure",
            "last_name": "Test",
            "phone": f"+22170{timestamp[-7:]}",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        self.tests_run += 1
        print(f"\n🔍 Testing user registration response for sensitive data exposure...")
        
        try:
            url = f"{self.base_url}/auth/register"
            headers = {'Content-Type': 'application/json'}
            response = requests.post(url, json=test_user_data, headers=headers, timeout=10)
            
            if response.status_code == 200:
                response_data = response.json()
                
                # Check if password hash is exposed
                if 'user' in response_data:
                    user_data = response_data['user']
                    if 'password_hash' in user_data or 'password' in user_data:
                        self.log_critical_error(
                            "SENSITIVE_DATA_EXPOSURE",
                            "Password hash exposed in registration response",
                            f"Response contains: {list(user_data.keys())}"
                        )
                        print(f"🚨 CRITICAL - Password hash exposed!")
                    else:
                        print(f"✅ Password hash properly excluded from response")
                        self.tests_passed += 1
                else:
                    print(f"⚠️  Unexpected response structure")
            else:
                print(f"⚠️  Registration failed: {response.status_code}")
                
        except Exception as e:
            print(f"❌ Exception: {str(e)}")

    def test_business_logic_errors(self):
        """Test critical business logic errors"""
        print("\n" + "="*80)
        print("AUDIT CRITIQUE: ERREURS DE LOGIQUE MÉTIER")
        print("="*80)
        
        # Test payment validation logic
        print(f"\n🔍 Testing payment validation logic...")
        
        # Test invalid Orange Money number that should be rejected
        self.tests_run += 1
        invalid_orange_data = {
            "email": f"invalid_orange_{datetime.now().strftime('%H%M%S%f')}@test.com",
            "password": "TestPass123!",
            "first_name": "Invalid",
            "last_name": "Orange",
            "phone": "+1234567890",  # Invalid country code
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+1234567890"  # Should be rejected
            }
        }
        
        try:
            url = f"{self.base_url}/auth/register-verified"
            headers = {'Content-Type': 'application/json'}
            response = requests.post(url, json=invalid_orange_data, headers=headers, timeout=10)
            
            if response.status_code == 400:
                print(f"✅ Invalid Orange Money properly rejected")
                self.tests_passed += 1
            elif response.status_code == 200:
                self.log_critical_error(
                    "BUSINESS_LOGIC_ERROR",
                    "Invalid Orange Money number accepted",
                    f"Number +1234567890 should be rejected but was accepted"
                )
                print(f"🚨 CRITICAL - Invalid Orange Money accepted!")
            else:
                print(f"⚠️  Unexpected response: {response.status_code}")
                
        except Exception as e:
            print(f"❌ Exception: {str(e)}")

    def generate_critical_report(self):
        """Generate critical issues report"""
        print("\n" + "="*80)
        print("RAPPORT D'AUDIT CRITIQUE - ERREURS CRITIQUES IDENTIFIÉES")
        print("="*80)
        
        print(f"\n📊 STATISTIQUES:")
        print(f"   Tests critiques exécutés: {self.tests_run}")
        print(f"   Tests réussis: {self.tests_passed}")
        print(f"   Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "   Taux de réussite: 0%")
        
        print(f"\n🚨 ERREURS CRITIQUES IDENTIFIÉES ({len(self.critical_errors)}):")
        if self.critical_errors:
            for i, error in enumerate(self.critical_errors, 1):
                print(f"\n   {i}. [{error['category']}] {error['description']}")
                if error['details']:
                    print(f"      Détails: {error['details']}")
                print(f"      Timestamp: {error['timestamp']}")
        else:
            print("   ✅ Aucune erreur critique détectée")
        
        # Priority recommendations
        print(f"\n🎯 RECOMMANDATIONS PRIORITAIRES:")
        
        validation_errors = [e for e in self.critical_errors if e['category'] == 'VALIDATION_ERROR_HANDLING']
        if validation_errors:
            print(f"   1. 🔥 URGENT: Corriger la gestion des erreurs de validation")
            print(f"      - {len(validation_errors)} endpoint(s) retournent 500 au lieu de 422")
            print(f"      - Ajouter try/catch ValidationError dans /auth/register")
            print(f"      - Utiliser le même pattern que /auth/register-verified")
        
        security_errors = [e for e in self.critical_errors if 'SECURITY' in e['category'] or 'INJECTION' in e['category'] or 'AUTHENTICATION' in e['category']]
        if security_errors:
            print(f"   2. 🔒 CRITIQUE: Corriger les vulnérabilités de sécurité")
            print(f"      - {len(security_errors)} problème(s) de sécurité détecté(s)")
            print(f"      - Renforcer la validation des entrées")
            print(f"      - Vérifier l'authentification sur tous les endpoints")
        
        business_errors = [e for e in self.critical_errors if e['category'] == 'BUSINESS_LOGIC_ERROR']
        if business_errors:
            print(f"   3. 💼 IMPORTANT: Corriger la logique métier")
            print(f"      - {len(business_errors)} erreur(s) de logique métier")
            print(f"      - Vérifier les validations de paiement")
        
        return {
            "tests_run": self.tests_run,
            "tests_passed": self.tests_passed,
            "critical_errors": len(self.critical_errors),
            "validation_errors": len(validation_errors),
            "security_errors": len(security_errors),
            "business_errors": len(business_errors)
        }

    def run_critical_audit(self):
        """Run focused critical audit"""
        print("🚨 DÉMARRAGE DE L'AUDIT CRITIQUE FOCALISÉ")
        print("=" * 80)
        
        try:
            self.test_validation_error_handling()
            self.test_security_critical_issues()
            self.test_authentication_bypass()
            self.test_data_exposure()
            self.test_business_logic_errors()
            
        except Exception as e:
            self.log_critical_error("AUDIT_EXCEPTION", "Exception during critical audit", str(e))
        
        return self.generate_critical_report()

if __name__ == "__main__":
    auditor = FocusedCriticalAuditor()
    report = auditor.run_critical_audit()
    
    # Exit with error code if critical issues found
    if report["critical_errors"] > 0:
        sys.exit(1)
    else:
        sys.exit(0)