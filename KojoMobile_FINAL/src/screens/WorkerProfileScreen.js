import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { colors } from '../theme/theme';
import { COUNTRIES } from '../constants/countries';
import { JOB_CATEGORIES } from '../constants/categories';
import ProfilePhoto from '../components/ProfilePhoto';

export default function WorkerProfileScreen({ route, navigation }) {
  const { workerId, worker } = route.params;

  // Sample worker data
  const workerData = worker || {
    id: workerId,
    first_name: 'Mamadou',
    last_name: 'Diallo',
    email: 'mamadou.diallo@email.com',
    phone: '+223 76 12 34 56',
    country: 'mali',
    user_type: 'worker',
    bio: 'Plombier expérimenté avec plus de 8 ans d\'expérience dans la réparation et l\'installation de systèmes de plomberie. Spécialisé dans les urgences et travaux de rénovation.',
    skills: ['Plomberie', 'Installation sanitaire', 'Réparation urgente', 'Soudure'],
    hourly_rate: 2500,
    rating: 4.8,
    reviews_count: 34,
    jobs_completed: 127,
    response_time: '2h',
    verification_status: 'verified',
    joined_date: '2023-03-15',
    portfolio: [
      {
        id: '1',
        title: 'Installation complète salle de bain',
        description: 'Rénovation complète avec installation neuve',
        category: 'plumbing',
        images: ['placeholder1.jpg'],
        completion_date: '2024-07-15'
      },
      {
        id: '2',
        title: 'Réparation urgente fuite cuisine',
        description: 'Intervention rapide pour arrêter une fuite majeure',
        category: 'plumbing',
        images: ['placeholder2.jpg'],
        completion_date: '2024-07-08'
      }
    ]
  };

  const country = COUNTRIES[workerData.country?.toUpperCase()] || COUNTRIES.MALI;

  const handleContact = () => {
    Alert.alert('Contact', 'Fonctionnalité de messagerie bientôt disponible');
  };

  const handleCall = () => {
    Alert.alert('Appel', `Appeler ${workerData.first_name} au ${workerData.phone}?`);
  };

  const handleHire = () => {
    Alert.alert(
      'Embaucher',
      `Voulez-vous envoyer une offre de travail à ${workerData.first_name}?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer',
          onPress: () => Alert.alert('Succès', 'Offre envoyée avec succès!')
        }
      ]
    );
  };

  const renderSkill = (skill, index) => (
    <View key={index} style={styles.skillTag}>
      <Text style={styles.skillText}>{skill}</Text>
    </View>
  );

  const renderPortfolioItem = (item) => (
    <View key={item.id} style={styles.portfolioItem}>
      <View style={styles.portfolioImagePlaceholder}>
        <MaterialIcons name="image" size={32} color={colors.textSecondary} />
      </View>
      <View style={styles.portfolioContent}>
        <Text style={styles.portfolioTitle}>{item.title}</Text>
        <Text style={styles.portfolioDescription} numberOfLines={2}>
          {item.description}
        </Text>
        <Text style={styles.portfolioDate}>
          Terminé le {new Date(item.completion_date).toLocaleDateString('fr-FR')}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profil du travailleur</Text>
        <TouchableOpacity style={styles.shareButton}>
          <MaterialIcons name="share" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <ProfilePhoto
              user={workerData}
              size={100}
              editable={false}
            />
            {workerData.verification_status === 'verified' && (
              <View style={styles.verificationBadge}>
                <MaterialIcons name="verified" size={16} color={colors.success} />
              </View>
            )}
          </View>
          
          <Text style={styles.workerName}>
            {workerData.first_name} {workerData.last_name}
          </Text>
          
          <View style={styles.locationContainer}>
            <Text style={styles.countryFlag}>{country.flag}</Text>
            <Text style={styles.location}>{country.nameFrench}</Text>
          </View>

          <View style={styles.ratingContainer}>
            <MaterialIcons name="star" size={20} color={colors.warning} />
            <Text style={styles.rating}>{workerData.rating}</Text>
            <Text style={styles.reviewsCount}>({workerData.reviews_count} avis)</Text>
          </View>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{workerData.jobs_completed}</Text>
            <Text style={styles.statLabel}>Jobs terminés</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{workerData.response_time}</Text>
            <Text style={styles.statLabel}>Temps de réponse</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{workerData.hourly_rate.toLocaleString()}</Text>
            <Text style={styles.statLabel}>XOF/heure</Text>
          </View>
        </View>

        {/* Bio Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>À propos</Text>
          <Text style={styles.bio}>{workerData.bio}</Text>
        </View>

        {/* Skills Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compétences</Text>
          <View style={styles.skillsContainer}>
            {workerData.skills.map(renderSkill)}
          </View>
        </View>

        {/* Portfolio Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Portfolio</Text>
          {workerData.portfolio.map(renderPortfolioItem)}
        </View>

        {/* Reviews Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Avis clients</Text>
            <TouchableOpacity>
              <Text style={styles.seeAllText}>Voir tout</Text>
            </TouchableOpacity>
          </View>
          
          {/* Sample Reviews */}
          <View style={styles.reviewItem}>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewerAvatar}>
                <Text style={styles.reviewerAvatarText}>A</Text>
              </View>
              <View style={styles.reviewerInfo}>
                <Text style={styles.reviewerName}>Aminata Traoré</Text>
                <View style={styles.reviewStars}>
                  {[1,2,3,4,5].map(star => (
                    <MaterialIcons
                      key={star}
                      name="star"
                      size={14}
                      color={star <= 5 ? colors.warning : colors.border}
                    />
                  ))}
                </View>
              </View>
              <Text style={styles.reviewDate}>Il y a 3 jours</Text>
            </View>
            <Text style={styles.reviewText}>
              Excellent travail ! Mamadou a réparé ma fuite rapidement et proprement. 
              Je le recommande vivement.
            </Text>
          </View>

          <View style={styles.reviewItem}>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewerAvatar}>
                <Text style={styles.reviewerAvatarText}>M</Text>
              </View>
              <View style={styles.reviewerInfo}>
                <Text style={styles.reviewerName}>Moussa Kone</Text>
                <View style={styles.reviewStars}>
                  {[1,2,3,4,5].map(star => (
                    <MaterialIcons
                      key={star}
                      name="star"
                      size={14}
                      color={star <= 4 ? colors.warning : colors.border}
                    />
                  ))}
                </View>
              </View>
              <Text style={styles.reviewDate}>Il y a 1 semaine</Text>
            </View>
            <Text style={styles.reviewText}>
              Professionnel et ponctuel. Installation de qualité. Merci !
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.contactButton}
          onPress={handleContact}
          activeOpacity={0.8}
        >
          <MaterialIcons name="message" size={20} color={colors.primary} />
          <Text style={styles.contactButtonText}>Message</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.callButton}
          onPress={handleCall}
          activeOpacity={0.8}
        >
          <MaterialIcons name="phone" size={20} color={colors.primary} />
          <Text style={styles.callButtonText}>Appeler</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.hireButton}
          onPress={handleHire}
          activeOpacity={0.8}
        >
          <Text style={styles.hireButtonText}>Embaucher</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.background,
  },
  verificationBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  workerName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  countryFlag: {
    fontSize: 16,
    marginRight: 6,
  },
  location: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginLeft: 4,
    marginRight: 4,
  },
  reviewsCount: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.primary,
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
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  seeAllText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  bio: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillTag: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  skillText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  portfolioItem: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  portfolioImagePlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: colors.border,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  portfolioContent: {
    flex: 1,
  },
  portfolioTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  portfolioDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  portfolioDate: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  reviewItem: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  reviewerAvatarText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.background,
  },
  reviewerInfo: {
    flex: 1,
  },
  reviewerName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  reviewStars: {
    flexDirection: 'row',
  },
  reviewDate: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  reviewText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.surface,
    gap: 12,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  contactButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  callButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  callButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  hireButton: {
    flex: 2,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hireButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
  },
});