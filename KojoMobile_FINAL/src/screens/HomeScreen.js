import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

import { useLanguage } from '../contexts/LanguageContext';
import { colors } from '../theme/theme';
import { COUNTRIES, getCountriesList } from '../constants/countries';
import { JOB_CATEGORIES } from '../constants/categories';

const { width } = Dimensions.get('window');

export default function HomeScreen({ navigation }) {
  const { t } = useLanguage();
  
  const countries = getCountriesList();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Section - Exact copy from web */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          style={styles.heroSection}
        >
          <View style={styles.heroDecorationTop} />
          <View style={styles.heroDecorationBottom} />
          
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>
              Connecter les travailleurs et clients en Afrique de l'Ouest
            </Text>
            <Text style={styles.heroSubtitle}>
              Trouvez des services de qualité ou offrez vos compétences au Mali, Sénégal, Burkina Faso et Côte d'Ivoire
            </Text>
            
            <View style={styles.heroButtons}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => navigation.navigate('Register')}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Commencer maintenant</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('Login')}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryButtonText}>Se connecter</Text>
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>

        {/* Countries Section - Exact copy */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Disponible dans 4 pays</Text>
            <Text style={styles.sectionSubtitle}>
              Kojo connecte les travailleurs et clients à travers l'Afrique de l'Ouest
            </Text>
          </View>

          <View style={styles.countriesGrid}>
            {countries.map((country, index) => (
              <TouchableOpacity
                key={country.code}
                style={[styles.countryCard, { backgroundColor: country.color + '20' }]}
                activeOpacity={0.8}
              >
                <Text style={styles.countryFlag}>{country.flag}</Text>
                <Text style={styles.countryName}>{country.nameFrench}</Text>
                <Text style={styles.countrySubtext}>Services disponibles</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Categories Section - Exact copy */}
        <View style={[styles.section, styles.categoriesSection]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Services populaires</Text>
            <Text style={styles.sectionSubtitle}>
              Trouvez le service dont vous avez besoin
            </Text>
          </View>

          <View style={styles.categoriesGrid}>
            {JOB_CATEGORIES.slice(0, 6).map((category) => (
              <TouchableOpacity
                key={category.key}
                style={styles.categoryCard}
                activeOpacity={0.8}
              >
                <Text style={styles.categoryIcon}>{category.icon}</Text>
                <Text style={styles.categoryName}>{category.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Features Section - Exact copy */}
        <View style={styles.section}>
          <View style={styles.featuresGrid}>
            <View style={styles.featureCard}>
              <View style={styles.featureIconContainer}>
                <Text style={styles.featureIcon}>💼</Text>
              </View>
              <Text style={styles.featureTitle}>Trouvez du travail</Text>
              <Text style={styles.featureDescription}>
                Découvrez des opportunités dans votre région et développez votre activité
              </Text>
            </View>

            <View style={styles.featureCard}>
              <View style={styles.featureIconContainer}>
                <Text style={styles.featureIcon}>🤝</Text>
              </View>
              <Text style={styles.featureTitle}>Connectez-vous</Text>
              <Text style={styles.featureDescription}>
                Échangez directement avec clients et travailleurs via notre messagerie
              </Text>
            </View>

            <View style={styles.featureCard}>
              <View style={styles.featureIconContainer}>
                <Text style={styles.featureIcon}>💰</Text>
              </View>
              <Text style={styles.featureTitle}>Paiements sécurisés</Text>
              <Text style={styles.featureDescription}>
                Orange Money, Wave et autres méthodes de paiement intégrées
              </Text>
            </View>
          </View>
        </View>

        {/* CTA Section - Exact copy */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          style={styles.ctaSection}
        >
          <Text style={styles.ctaTitle}>Rejoignez des milliers d'utilisateurs</Text>
          <Text style={styles.ctaSubtitle}>
            Commencez dès aujourd'hui à connecter avec des clients ou travailleurs qualifiés
          </Text>
          
          <View style={styles.ctaButtons}>
            <TouchableOpacity
              style={styles.ctaPrimaryButton}
              onPress={() => navigation.navigate('Register', { userType: 'client' })}
            >
              <Text style={styles.ctaPrimaryButtonText}>Je cherche des services</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.ctaSecondaryButton}
              onPress={() => navigation.navigate('Register', { userType: 'worker' })}
            >
              <Text style={styles.ctaSecondaryButtonText}>Je propose mes services</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Stats Section - Exact copy */}
        <View style={styles.statsSection}>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>1000+</Text>
              <Text style={styles.statLabel}>Travailleurs actifs</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>500+</Text>
              <Text style={styles.statLabel}>Projets complétés</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>4</Text>
              <Text style={styles.statLabel}>Pays couverts</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>24/7</Text>
              <Text style={styles.statLabel}>Support client</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  
  // Hero Section
  heroSection: {
    paddingHorizontal: 20,
    paddingVertical: 48,
    position: 'relative',
    overflow: 'hidden',
  },
  heroDecorationTop: {
    position: 'absolute',
    top: -128,
    left: -128,
    width: 256,
    height: 256,
    borderRadius: 128,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  heroDecorationBottom: {
    position: 'absolute',
    bottom: -192,
    right: -192,
    width: 384,
    height: 384,
    borderRadius: 192,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  heroContent: {
    alignItems: 'center',
    zIndex: 1,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.background,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 36,
  },
  heroSubtitle: {
    fontSize: 16,
    color: colors.background,
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
    paddingHorizontal: 10,
  },
  heroButtons: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: colors.background,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  primaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 2,
    borderColor: colors.background,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
  },

  // Sections
  section: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    backgroundColor: colors.background,
  },
  categoriesSection: {
    backgroundColor: colors.surface,
  },
  sectionHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  sectionSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  // Countries
  countriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  countryCard: {
    width: (width - 52) / 2,
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  countryFlag: {
    fontSize: 48,
    marginBottom: 8,
  },
  countryName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  countrySubtext: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  // Categories
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  categoryCard: {
    width: (width - 64) / 3,
    backgroundColor: colors.background,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  categoryIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  categoryName: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
  },

  // Features
  featuresGrid: {
    gap: 24,
  },
  featureCard: {
    alignItems: 'center',
  },
  featureIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.secondary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  featureIcon: {
    fontSize: 24,
  },
  featureTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  featureDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // CTA Section
  ctaSection: {
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  ctaTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.background,
    textAlign: 'center',
    marginBottom: 12,
  },
  ctaSubtitle: {
    fontSize: 16,
    color: colors.background,
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  ctaButtons: {
    gap: 12,
  },
  ctaPrimaryButton: {
    backgroundColor: colors.background,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaPrimaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  ctaSecondaryButton: {
    borderWidth: 2,
    borderColor: colors.background,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaSecondaryButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
  },

  // Stats
  statsSection: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  statCard: {
    width: (width - 56) / 2,
    alignItems: 'center',
    paddingVertical: 16,
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});