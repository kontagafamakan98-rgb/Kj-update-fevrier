import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useLocation } from '../../contexts/LocationContext';
import { colors } from '../../theme/theme';
import { COUNTRIES } from '../../constants/countries';
import { JOB_CATEGORIES } from '../../constants/jobCategories';
import { jobsAPI } from '../../services/api';

const { width } = Dimensions.get('window');

export default function HomeScreen({ navigation }) {
  const [recentJobs, setRecentJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { user } = useAuth();
  const { t } = useLanguage();
  const { getCurrentLocation, location } = useLocation();

  useEffect(() => {
    loadRecentJobs();
    if (!location) {
      getCurrentLocation();
    }
  }, []);

  const loadRecentJobs = async () => {
    try {
      const response = await jobsAPI.getJobs({ limit: 5 });
      setRecentJobs(response.data || []);
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRecentJobs();
    setRefreshing(false);
  };

  const handleCreateJob = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('CreateJob');
  };

  const handleViewAllJobs = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('Jobs');
  };

  const handleCategoryPress = (category) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('Jobs', { category: category.id });
  };

  const userCountry = COUNTRIES[user?.country?.toUpperCase()] || COUNTRIES.MALI;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          style={styles.header}
        >
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.greeting}>Bonjour,</Text>
              <Text style={styles.userName}>{user?.first_name}!</Text>
              <View style={styles.locationContainer}>
                <MaterialIcons name="location-on" size={16} color={colors.background} />
                <Text style={styles.location}>
                  {userCountry.flag} {userCountry.nameFrench}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.profileButton}
              onPress={() => navigation.navigate('Profile')}
            >
              <MaterialIcons name="person" size={24} color={colors.background} />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          {user?.user_type === 'client' ? (
            <TouchableOpacity
              style={styles.primaryAction}
              onPress={handleCreateJob}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add" size={24} color={colors.background} />
              <Text style={styles.primaryActionText}>Publier un job</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.primaryAction}
              onPress={handleViewAllJobs}
              activeOpacity={0.8}
            >
              <MaterialIcons name="search" size={24} color={colors.background} />
              <Text style={styles.primaryActionText}>Chercher des jobs</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Categories */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Catégories populaires</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriesScroll}>
            <View style={styles.categoriesContainer}>
              {JOB_CATEGORIES.slice(0, 8).map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={[styles.categoryCard, { backgroundColor: category.color + '20' }]}
                  onPress={() => handleCategoryPress(category)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.categoryIcon}>{category.icon}</Text>
                  <Text style={[styles.categoryText, { color: category.color }]}>
                    {category.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Recent Jobs */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Jobs récents</Text>
            <TouchableOpacity onPress={handleViewAllJobs}>
              <Text style={styles.seeAllText}>Voir tout</Text>
            </TouchableOpacity>
          </View>
          
          {recentJobs.length > 0 ? (
            <View style={styles.jobsList}>
              {recentJobs.slice(0, 3).map((job) => (
                <TouchableOpacity
                  key={job.id}
                  style={styles.jobCard}
                  onPress={() => navigation.navigate('JobDetails', { jobId: job.id })}
                  activeOpacity={0.8}
                >
                  <View style={styles.jobHeader}>
                    <Text style={styles.jobTitle} numberOfLines={1}>
                      {job.title}
                    </Text>
                    <Text style={styles.jobBudget}>
                      {job.budget_min}€ - {job.budget_max}€
                    </Text>
                  </View>
                  <Text style={styles.jobDescription} numberOfLines={2}>
                    {job.description}
                  </Text>
                  <View style={styles.jobFooter}>
                    <View style={styles.jobCategory}>
                      <Text style={styles.jobCategoryText}>{job.category}</Text>
                    </View>
                    <Text style={styles.jobTime}>Il y a 2h</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <MaterialIcons name="work-off" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyStateText}>Aucun job récent</Text>
            </View>
          )}
        </View>

        {/* Countries */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nos pays</Text>
          <View style={styles.countriesGrid}>
            {Object.values(COUNTRIES).map((country) => (
              <View key={country.code} style={styles.countryCard}>
                <Text style={styles.countryFlag}>{country.flag}</Text>
                <Text style={styles.countryName}>{country.nameFrench}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Stats */}
        <View style={styles.section}>
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>84M+</Text>
              <Text style={styles.statLabel}>Utilisateurs potentiels</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>4</Text>
              <Text style={styles.statLabel}>Pays couverts</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>10+</Text>
              <Text style={styles.statLabel}>Catégories</Text>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 30,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: 16,
    color: colors.background,
    opacity: 0.9,
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.background,
    marginBottom: 4,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  location: {
    fontSize: 14,
    color: colors.background,
    opacity: 0.9,
    marginLeft: 4,
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActions: {
    paddingHorizontal: 20,
    marginTop: -15,
  },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  primaryActionText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  seeAllText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  categoriesScroll: {
    marginTop: 16,
  },
  categoriesContainer: {
    flexDirection: 'row',
    paddingRight: 20,
  },
  categoryCard: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    height: 80,
    borderRadius: 12,
    marginRight: 12,
  },
  categoryIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  jobsList: {
    marginTop: 16,
  },
  jobCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    marginRight: 8,
  },
  jobBudget: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  jobDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 12,
    lineHeight: 20,
  },
  jobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobCategory: {
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  jobCategoryText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  jobTime: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 8,
  },
  countriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  countryCard: {
    alignItems: 'center',
    width: (width - 60) / 2,
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  countryFlag: {
    fontSize: 32,
    marginBottom: 8,
  },
  countryName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  statCard: {
    alignItems: 'center',
    flex: 1,
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  statNumber: {
    fontSize: 24,
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