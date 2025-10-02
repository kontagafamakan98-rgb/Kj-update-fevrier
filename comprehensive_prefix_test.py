#!/usr/bin/env python3
"""
Test complémentaire pour vérifier tous les préfixes spécifiques demandés
Teste les préfixes exacts mentionnés dans la review request: 71, 72, 80, 85, 95, 99
"""

import requests
import sys
import json
from datetime import datetime

class ComprehensivePrefixTester:
    def __init__(self, base_url="https://kojo-profile.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        
        # Pays prioritaires avec codes téléphoniques
        self.priority_countries = {
            'senegal': '+221',
            'mali': '+223', 
            'ivory_coast': '+225',
            'burkina_faso': '+226'
        }
        
        # Préfixes EXACTS demandés dans la review request
        self.requested_prefixes = ['71', '72', '80', '85', '95', '99']
        
        print(f"🎯 Test complémentaire des préfixes EXACTS demandés")
        print(f"📍 URL de base: {self.base_url}")
        print(f"🔢 Préfixes exacts à tester: {self.requested_prefixes}")

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None):
        """Exécute un test API unique"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: {name}")
        
        try:
            if method == 'POST':
                response = requests.post(url, json=data, headers=headers)

            success = response.status_code == expected_status
            
            if success:
                self.tests_passed += 1
                print(f"✅ SUCCÈS - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if 'user' in response_data and 'phone' in response_data['user']:
                        print(f"   📱 Téléphone validé: {response_data['user']['phone']}")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ ÉCHEC - Attendu {expected_status}, reçu {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   ⚠️ Erreur: {error_data.get('detail', 'Erreur inconnue')}")
                except:
                    print(f"   ⚠️ Erreur: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ EXCEPTION - Erreur: {str(e)}")
            return False, {}

    def test_all_requested_prefixes(self):
        """Test tous les préfixes exacts demandés dans la review request"""
        print("\n" + "="*70)
        print("🎯 TESTING TOUS LES PRÉFIXES EXACTS DEMANDÉS")
        print("="*70)
        
        results = {}
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            results[country] = {'orange_money': {}, 'wave': {}}
            
            for prefix in self.requested_prefixes:
                # Test Orange Money
                orange_number = f"{country_code}{prefix}123456"
                
                orange_data = {
                    "email": f"test.orange.{country}.{prefix}.{datetime.now().strftime('%H%M%S')}@test.com",
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
                
                success, response = self.run_test(
                    f"Orange Money {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=orange_data
                )
                
                results[country]['orange_money'][prefix] = success
                
                # Test Wave
                wave_number = f"{country_code}{prefix}654321"
                
                wave_data = {
                    "email": f"test.wave.{country}.{prefix}.{datetime.now().strftime('%H%M%S')}@test.com",
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
                
                success, response = self.run_test(
                    f"Wave {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=wave_data
                )
                
                results[country]['wave'][prefix] = success
        
        return results

    def print_detailed_results(self, results):
        """Affiche les résultats détaillés par pays et préfixe"""
        print("\n" + "📊"*35)
        print("📊 RÉSULTATS DÉTAILLÉS PAR PAYS ET PRÉFIXE")
        print("📊"*35)
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 {country.upper()} ({country_code}):")
            
            # Orange Money
            print(f"   🍊 Orange Money:")
            for prefix in self.requested_prefixes:
                status = "✅" if results[country]['orange_money'][prefix] else "❌"
                print(f"      Préfixe {prefix}: {status}")
            
            # Wave
            print(f"   🌊 Wave:")
            for prefix in self.requested_prefixes:
                status = "✅" if results[country]['wave'][prefix] else "❌"
                print(f"      Préfixe {prefix}: {status}")

    def run_comprehensive_test(self):
        """Exécute le test compréhensif"""
        print("\n" + "🚀"*35)
        print("🚀 DÉMARRAGE TEST COMPRÉHENSIF PRÉFIXES EXACTS")
        print("🚀"*35)
        
        results = self.test_all_requested_prefixes()
        
        # Calculer les statistiques
        total_tests = len(self.priority_countries) * len(self.requested_prefixes) * 2  # 2 = Orange Money + Wave
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        # Afficher les résultats détaillés
        self.print_detailed_results(results)
        
        # Résumé final
        print("\n" + "🎯"*35)
        print("🎯 RÉSUMÉ FINAL COMPRÉHENSIF")
        print("🎯"*35)
        
        print(f"\n📊 STATISTIQUES GLOBALES:")
        print(f"   Tests exécutés: {self.tests_run}")
        print(f"   Tests réussis: {self.tests_passed}")
        print(f"   Tests échoués: {self.tests_run - self.tests_passed}")
        print(f"   Taux de réussite: {success_rate:.1f}%")
        
        print(f"\n🔢 PRÉFIXES TESTÉS:")
        print(f"   Préfixes exacts demandés: {self.requested_prefixes}")
        print(f"   Pays testés: {list(self.priority_countries.keys())}")
        
        # Vérification spécifique de la review request
        print(f"\n✅ VALIDATION REVIEW REQUEST:")
        all_working = True
        for country in self.priority_countries.keys():
            for prefix in self.requested_prefixes:
                orange_ok = results[country]['orange_money'][prefix]
                wave_ok = results[country]['wave'][prefix]
                if not (orange_ok and wave_ok):
                    all_working = False
                    print(f"   ❌ {country} - Préfixe {prefix}: Orange Money={orange_ok}, Wave={wave_ok}")
        
        if all_working:
            print(f"   🎉 TOUS LES PRÉFIXES DEMANDÉS FONCTIONNENT PARFAITEMENT!")
            print(f"   ✅ Orange Money: Préfixes 71, 72, 80, 85, 95, 99 validés pour tous les pays")
            print(f"   ✅ Wave: Préfixes 71, 72, 80, 85, 95, 99 validés pour tous les pays")
            print(f"   ✅ Inscription utilisateurs: Fonctionnelle avec nouveaux préfixes")
            print(f"   ✅ Validation comptes de paiement: Accepte les nouveaux préfixes")
        else:
            print(f"   ⚠️ Certains préfixes nécessitent une attention")
        
        print(f"\n🏁 Test compréhensif terminé!")

if __name__ == "__main__":
    tester = ComprehensivePrefixTester()
    tester.run_comprehensive_test()