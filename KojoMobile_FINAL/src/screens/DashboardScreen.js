import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/theme';
import { COUNTRIES } from '../constants/countries';
import ProfilePhoto from '../components/ProfilePhoto';
import { JOB_CATEGORIES } from '../constants/categories';

const { width } = Dimensions.get('window');

export default function DashboardScreen({ navigation }) {
  const [refreshing, setRefreshing] = useState(false);
  const [recentJobs] = useState([
    {
      id: '1',
      title: 'Réparation plomberie urgent',
      category: 'plumbing',
      budget: '15000 - 25000',
      location: 'Bamako, Mali',
      timeAgo: '2h',
      status: 'open'
    },
    {
      id: '2', 
      title: 'Installation électrique maison',
      category: 'electrical',
      budget: '50000 - 80000',
      location: 'Dakar, Sénégal',
      timeAgo: '4h',
      status: 'open'
    },
    {
      id: '3',
      title: 'Nettoyage bureau',
      category: 'cleaning',
      budget: '10000 - 15000',
      location: 'Ouagadougou, Burkina Faso',
      timeAgo: '1j',
      status: 'in_progress'
    }
  ]);

  const { user, logout } = useAuth();
  
  const userCountry = COUNTRIES[user?.country?.toUpperCase()] || COUNTRIES.MALI;

  const onRefresh = async () => {
    setRefreshing(true);
    // Simulate API call
    setTimeout(() => setRefreshing(false), 1000);
  };

  const handleLogout = () => {
    logout();
  };

  const getCategoryIcon = (categoryKey) => {
    const category = JOB_CATEGORIES.find(cat => cat.key === categoryKey);
    return category ? category.icon : '💼';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header avec photo de profil */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          style={styles.header}
        >
          <View style={styles.headerContent}>
            <View style={styles.greetingSection}>
              <Text style={styles.greeting}>Bonjour,</Text>
              <Text style={styles.userName}>{user?.first_name}!</Text>
              <Text style={styles.subtitle}>
                {userCountry.flag} {userCountry.nameFrench}
              </Text>
            </View>
            
            <ProfilePhoto
              user={user}
              size={60}
              editable={true}
              onPhotoChange={(result) => {
                if (result.success) {
                  // Photo updated successfully
                }
              }}
              showChangeButton={true}
            />
          </View>
        </LinearGradient>

        {/* Quick Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <MaterialIcons name="work" size={24} color={colors.primary} />
            <Text style={styles.statNumber}>12</Text>
            <Text style={styles.statLabel}>Jobs actifs</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialIcons name="star" size={24} color={colors.warning} />
            <Text style={styles.statNumber}>4.8</Text>
            <Text style={styles.statLabel}>Note moyenne</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialIcons name="payments" size={24} color={colors.success} />
            <Text style={styles.statNumber}>850K</Text>
            <Text style={styles.statLabel}>XOF gagnés</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions rapides</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('Jobs')}
            >
              <MaterialIcons name="search" size={32} color={colors.primary} />
              <Text style={styles.actionText}>Chercher des jobs</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('Messages')}
            >
              <MaterialIcons name="message" size={32} color={colors.primary} />
              <Text style={styles.actionText}>Messages</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('Profile')}
            >
              <MaterialIcons name="person" size={32} color={colors.primary} />
              <Text style={styles.actionText}>Mon profil</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('CreateJob')}
            >
              <MaterialIcons name="add-circle-outline" size={32} color={colors.primary} />
              <Text style={styles.actionText}>Créer un job</Text>
            </TouchableOpacity>
            
            {/* Debug: Camera Test Button */}
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: '#fef3c7' }]}
              onPress={() => navigation.navigate('CameraTest')}
            >
              <MaterialIcons name="camera-alt" size={32} color="#f59e0b" />
              <Text style={[styles.actionText, { color: '#f59e0b' }]}>Test Caméra</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Jobs */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Jobs récents</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Jobs')}>
              <Text style={styles.seeAllText}>Voir tout</Text>
            </TouchableOpacity>
          </View>

          {recentJobs.map((job) => (
            <TouchableOpacity
              key={job.id}
              style={styles.jobCard}
              onPress={() => navigation.navigate('JobDetails', { jobId: job.id })}
            >
              <View style={styles.jobHeader}>
                <View style={styles.jobCategory}>
                  <Text style={styles.jobCategoryIcon}>{getCategoryIcon(job.category)}</Text>
                </View>
                <View style={styles.jobInfo}>
                  <Text style={styles.jobTitle} numberOfLines={1}>
                    {job.title}
                  </Text>
                  <Text style={styles.jobLocation}>{job.location}</Text>
                  <View style={styles.jobMeta}>
                    <Text style={styles.jobBudget}>{job.budget} XOF</Text>
                    <Text style={styles.jobTime}>{job.timeAgo}</Text>
                  </View>
                </View>
                <View style={[styles.jobStatus, { backgroundColor: getStatusColor(job.status) }]}>
                  <Text style={styles.jobStatusText}>{getStatusText(job.status)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Categories Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Catégories populaires</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriesScroll}>
            <View style={styles.categoriesContainer}>
              {JOB_CATEGORIES.slice(0, 6).map((category) => (
                <TouchableOpacity
                  key={category.key}
                  style={styles.categoryCard}
                  onPress={() => navigation.navigate('Jobs', { category: category.key })}
                >
                  <Text style={styles.categoryIcon}>{category.icon}</Text>
                  <Text style={styles.categoryText}>{category.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStatusColor = (status) => {
  switch (status) {
    case 'open': return colors.success + '20';
    case 'in_progress': return colors.warning + '20';
    case 'completed': return colors.primary + '20';
    default: return colors.textSecondary + '20';
  }
};

const getStatusText = (status) => {
  switch (status) {
    case 'open': return 'Ouvert';
    case 'in_progress': return 'En cours';
    case 'completed': return 'Terminé';
    default: return 'Inconnu';
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
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
    marginBottom: 8,
  },
  greetingSection: {
    flex: 1,
  },
  subtitle: {
    fontSize: 14,
    color: colors.background,
    opacity: 0.9,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countryFlag: {
    fontSize: 16,
    marginRight: 6,
  },
  location: {
    fontSize: 14,
    color: colors.background,
    opacity: 0.9,
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: -15,
    marginBottom: 24,
    gap: 12,
  },
  statCard: {
    flex: 1,
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
  statNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
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
    marginBottom: 16,
  },
  seeAllText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionCard: {
    width: (width - 56) / 2,
    backgroundColor: colors.surface,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginTop: 8,
    textAlign: 'center',
  },
  jobCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  jobCategory: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  jobCategoryIcon: {
    fontSize: 20,
  },
  jobInfo: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  jobLocation: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  jobMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  jobBudget: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  jobTime: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  jobStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  jobStatusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text,
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
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  categoryIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
  },
});