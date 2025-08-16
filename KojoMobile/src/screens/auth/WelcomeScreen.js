import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme/theme';
import { COUNTRIES } from '../../constants/countries';

const { width, height } = Dimensions.get('window');

export default function WelcomeScreen({ navigation }) {
  useEffect(() => {
    // Welcome haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('Register');
  };

  const handleLogin = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('Login');
  };

  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientEnd]}
      style={styles.container}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          {/* Logo Section */}
          <View style={styles.logoSection}>
            <Text style={styles.logo}>Kojo</Text>
            <Text style={styles.tagline}>Services d'Afrique de l'Ouest</Text>
          </View>

          {/* Countries Section */}
          <View style={styles.countriesSection}>
            <Text style={styles.countriesTitle}>Disponible dans 4 pays</Text>
            <View style={styles.flagsContainer}>
              {Object.values(COUNTRIES).map((country) => (
                <View key={country.code} style={styles.countryItem}>
                  <Text style={styles.flag}>{country.flag}</Text>
                  <Text style={styles.countryName}>{country.nameFrench}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Features Section */}
          <View style={styles.featuresSection}>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>🔧</Text>
              <Text style={styles.featureText}>Trouvez des services locaux</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>💼</Text>
              <Text style={styles.featureText}>Proposez vos compétences</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>💳</Text>
              <Text style={styles.featureText}>Paiements sécurisés</Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleGetStarted}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Commencer</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleLogin}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Se connecter</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  logoSection: {
    alignItems: 'center',
    marginTop: 60,
  },
  logo: {
    fontSize: 56,
    fontWeight: 'bold',
    color: colors.background,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 18,
    color: colors.background,
    opacity: 0.9,
    textAlign: 'center',
  },
  countriesSection: {
    alignItems: 'center',
    marginVertical: 40,
  },
  countriesTitle: {
    fontSize: 16,
    color: colors.background,
    opacity: 0.9,
    marginBottom: 20,
  },
  flagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
  },
  countryItem: {
    alignItems: 'center',
    minWidth: width / 5,
  },
  flag: {
    fontSize: 32,
    marginBottom: 4,
  },
  countryName: {
    fontSize: 12,
    color: colors.background,
    opacity: 0.9,
    textAlign: 'center',
  },
  featuresSection: {
    marginVertical: 20,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  featureText: {
    fontSize: 16,
    color: colors.background,
    opacity: 0.9,
  },
  buttonsContainer: {
    paddingBottom: 40,
  },
  primaryButton: {
    backgroundColor: colors.background,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  primaryButtonText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  secondaryButtonText: {
    color: colors.background,
    fontSize: 18,
    fontWeight: '600',
  },
});