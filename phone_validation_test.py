#!/usr/bin/env python3
"""
TESTS PRIORITAIRES POUR LA VALIDATION DES NUMÉROS DE TÉLÉPHONE
Test spécifique pour la correction urgente appliquée au système de validation téléphone

PROBLÈME RÉSOLU:
- L'inscription échouait avec "Unexpected token 'I', Internal S..." 
- Numéros avec espaces "+223 70123456" rejetés
- Pattern regex trop strict
- Erreur 500 mal gérée côté frontend

CORRECTIONS TESTÉES:
1. ✅ Validator téléphone amélioré - nettoie espaces, tirets, parenthèses
2. ✅ Pattern flexible - accepte "+223 70123456", "+223-70-123-456", "+223(70)123456"
3. ✅ Préfixes 70-99 - tous les nouveaux préfixes fonctionnent
"""

import requests
import json
import sys
from datetime import datetime

class PhoneValidationTester:
    def __init__(self, base_url="https://kojo-native.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, test_name, success, details=""):
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
        
        print(result)
        self.test_results.append({
            "name": test_name,
            "success": success,
            "details": details
        })
        return success

    def test_phone_registration(self, phone_number, country, expected_success=True, test_description=""):
        """Test registration with specific phone number format"""
        
        # Generate unique email for each test
        timestamp = int(datetime.now().timestamp())
        email = f"test_phone_{timestamp}@gmail.com"
        
        registration_data = {
            "email": email,
            "password": "TestPassword123!",
            "first_name": "Test",
            "last_name": "User",
            "phone": phone_number,
            "user_type": "client",
            "country": country,
            "preferred_language": "fr"
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/auth/register",
                json=registration_data,
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            success = (response.status_code == 200) == expected_success
            
            if expected_success and response.status_code == 200:
                # Registration should succeed
                response_data = response.json()
                details = f"Phone {phone_number} accepted successfully"
                return self.log_test(test_description, True, details)
            elif not expected_success and response.status_code != 200:
                # Registration should fail
                details = f"Phone {phone_number} correctly rejected (Status: {response.status_code})"
                return self.log_test(test_description, True, details)
            else:
                # Unexpected result
                details = f"Phone {phone_number} - Expected success: {expected_success}, Got status: {response.status_code}"
                if response.status_code != 200:
                    try:
                        error_data = response.json()
                        details += f" | Error: {error_data.get('detail', 'Unknown error')}"
                    except:
                        details += f" | Raw response: {response.text[:200]}"
                return self.log_test(test_description, False, details)
                
        except requests.exceptions.RequestException as e:
            details = f"Network error testing {phone_number}: {str(e)}"
            return self.log_test(test_description, False, details)
        except Exception as e:
            details = f"Unexpected error testing {phone_number}: {str(e)}"
            return self.log_test(test_description, False, details)

    def run_comprehensive_phone_tests(self):
        """Run all phone validation tests as specified in the review request"""
        
        print("🎯 TESTS PRIORITAIRES - VALIDATION NUMÉROS DE TÉLÉPHONE")
        print("=" * 70)
        print("Testing phone number validation corrections...")
        print()

        # Test 1: Numéros avec espaces (PRIORITÉ HAUTE)
        print("📱 TEST 1: NUMÉROS AVEC ESPACES")
        test_cases_spaces = [
            ("+223 70123456", "mali", "Mali préfixe 70 avec espace"),
            ("+221 77 123 4567", "senegal", "Sénégal préfixe 77 avec espaces multiples"),
            ("+225 85 123 456", "ivory_coast", "Côte d'Ivoire préfixe 85 avec espaces"),
            ("+226 99 123456", "burkina_faso", "Burkina Faso préfixe 99 avec espace"),
            ("+221 90 123 4567", "senegal", "Sénégal préfixe 90 avec espaces"),
        ]
        
        for phone, country, description in test_cases_spaces:
            self.test_phone_registration(phone, country, True, description)

        print("\n📱 TEST 2: NUMÉROS AVEC TIRETS")
        test_cases_dashes = [
            ("+223-70-123-456", "mali", "Mali préfixe 70 avec tirets"),
            ("+221-77-123-4567", "senegal", "Sénégal préfixe 77 avec tirets"),
            ("+225-85-123-456", "ivory_coast", "Côte d'Ivoire préfixe 85 avec tirets"),
            ("+226-99-123-456", "burkina_faso", "Burkina Faso préfixe 99 avec tirets"),
        ]
        
        for phone, country, description in test_cases_dashes:
            self.test_phone_registration(phone, country, True, description)

        print("\n📱 TEST 3: NUMÉROS AVEC PARENTHÈSES")
        test_cases_parentheses = [
            ("+223(70)123456", "mali", "Mali préfixe 70 avec parenthèses"),
            ("+221(77)123456", "senegal", "Sénégal préfixe 77 avec parenthèses"),
            ("+225(85)123456", "ivory_coast", "Côte d'Ivoire préfixe 85 avec parenthèses"),
            ("+226(99)123456", "burkina_faso", "Burkina Faso préfixe 99 avec parenthèses"),
        ]
        
        for phone, country, description in test_cases_parentheses:
            self.test_phone_registration(phone, country, True, description)

        print("\n📱 TEST 4: NUMÉROS SANS FORMATAGE")
        test_cases_clean = [
            ("+22370123456", "mali", "Mali préfixe 70 sans formatage"),
            ("+22177123456", "senegal", "Sénégal préfixe 77 sans formatage"),
            ("+22585123456", "ivory_coast", "Côte d'Ivoire préfixe 85 sans formatage"),
            ("+22699123456", "burkina_faso", "Burkina Faso préfixe 99 sans formatage"),
        ]
        
        for phone, country, description in test_cases_clean:
            self.test_phone_registration(phone, country, True, description)

        print("\n📱 TEST 5: NOUVEAUX PRÉFIXES 70-99")
        new_prefixes_tests = [
            ("+223 75123456", "mali", "Mali nouveau préfixe 75"),
            ("+221 80 123456", "senegal", "Sénégal nouveau préfixe 80"),
            ("+225 90 123456", "ivory_coast", "Côte d'Ivoire nouveau préfixe 90"),
            ("+226 95 123456", "burkina_faso", "Burkina Faso nouveau préfixe 95"),
            ("+223-72-123-456", "mali", "Mali préfixe 72 avec tirets"),
            ("+221(88)123456", "senegal", "Sénégal préfixe 88 avec parenthèses"),
        ]
        
        for phone, country, description in new_prefixes_tests:
            self.test_phone_registration(phone, country, True, description)

        print("\n📱 TEST 6: FORMATS MIXTES COMPLEXES")
        complex_formats = [
            ("+223 (70) 123-456", "mali", "Mali format mixte espaces-parenthèses-tirets"),
            ("+221-77 123 456", "senegal", "Sénégal format mixte tirets-espaces"),
            ("+225 85-123(456)", "ivory_coast", "Côte d'Ivoire format très mixte"),
        ]
        
        for phone, country, description in complex_formats:
            self.test_phone_registration(phone, country, True, description)

        print("\n📱 TEST 7: CAS D'ERREUR (doivent échouer)")
        error_cases = [
            ("+223 60123456", "mali", False, "Mali préfixe 60 invalide (hors 70-99)"),
            ("+221 65 123456", "senegal", False, "Sénégal préfixe 65 invalide"),
            ("+223 70", "mali", False, "Numéro trop court"),
            ("223 70123456", "mali", False, "Pas de + international"),
            ("+223 70123456789012", "mali", False, "Numéro trop long"),
        ]
        
        for phone, country, expected_success, description in error_cases:
            self.test_phone_registration(phone, country, expected_success, description)

    def test_health_check(self):
        """Test basic API health"""
        try:
            response = requests.get(f"{self.base_url}/health", timeout=5)
            if response.status_code == 200:
                return self.log_test("API Health Check", True, "API is responding")
            else:
                return self.log_test("API Health Check", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("API Health Check", False, f"Error: {str(e)}")

    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 70)
        print("📊 RÉSUMÉ DES TESTS - VALIDATION TÉLÉPHONE")
        print("=" * 70)
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print(f"Total tests: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Tests échoués: {self.tests_run - self.tests_passed}")
        print(f"Taux de réussite: {success_rate:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("\n🎉 TOUS LES TESTS SONT PASSÉS!")
            print("✅ La correction du validator téléphone fonctionne parfaitement")
            print("✅ Tous les formats de numéros sont maintenant acceptés")
            print("✅ Les préfixes 70-99 fonctionnent correctement")
        else:
            print(f"\n⚠️  {self.tests_run - self.tests_passed} test(s) ont échoué")
            print("❌ Des problèmes persistent dans la validation téléphone")
            
            # Show failed tests
            failed_tests = [t for t in self.test_results if not t['success']]
            if failed_tests:
                print("\nTests échoués:")
                for test in failed_tests:
                    print(f"  ❌ {test['name']}: {test['details']}")

def main():
    """Main test execution"""
    print("🚀 DÉMARRAGE DES TESTS DE VALIDATION TÉLÉPHONE")
    print("Correction urgente: Validator téléphone amélioré")
    print()
    
    tester = PhoneValidationTester()
    
    # Test API health first
    if not tester.test_health_check():
        print("❌ API non disponible - Arrêt des tests")
        return False
    
    # Run comprehensive phone validation tests
    tester.run_comprehensive_phone_tests()
    
    # Print summary
    tester.print_summary()
    
    # Return success status
    return tester.tests_passed == tester.tests_run

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)