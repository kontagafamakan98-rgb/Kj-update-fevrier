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

import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/theme';
import { JOB_CATEGORIES } from '../constants/categories';

export default function JobDetailsScreen({ route, navigation }) {
  const { jobId, job } = route.params;
  const { user } = useAuth();

  // Sample job data if not provided
  const jobData = job || {
    id: jobId,
    title: 'Réparation plomberie urgent',
    description: 'Fuite d\'eau importante dans la cuisine. Intervention rapide requise. Le problème se situe au niveau de l\'évier principal et nécessite une expertise en plomberie.',
    category: 'plumbing',
    budget_min: 15000,
    budget_max: 25000,
    location: 'Bamako, Mali',
    status: 'open',
    client_name: 'Aminata Traoré',
    timeAgo: '2h',
    requirements: ['Expérience en plomberie', 'Outils professionnels', 'Disponible rapidement'],
    deadline: '2024-08-20'
  };

  const category = JOB_CATEGORIES.find(cat => cat.key === jobData.category);
  const canApply = user?.user_type === 'worker' && jobData.status === 'open';

  const handleApply = () => {
    Alert.alert(
      'Postuler au job',
      `Voulez-vous postuler pour "${jobData.title}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Postuler',
          onPress: () => {
            Alert.alert('Succès', 'Votre candidature a été envoyée !');
            navigation.goBack();
          }
        }
      ]
    );
  };

  const handleContact = () => {
    Alert.alert('Contact', 'Fonctionnalité de messagerie bientôt disponible');
  };

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
        <Text style={styles.headerTitle}>Détails du job</Text>
        <TouchableOpacity style={styles.shareButton}>
          <MaterialIcons name="share" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Job Header */}
        <View style={styles.jobHeader}>
          <View style={styles.jobCategory}>
            <Text style={styles.jobCategoryIcon}>{category?.icon || '💼'}</Text>
          </View>
          
          <View style={styles.jobTitleSection}>
            <Text style={styles.jobTitle}>{jobData.title}</Text>
            <Text style={styles.jobClient}>Par {jobData.client_name}</Text>
            <View style={styles.jobMeta}>
              <Text style={styles.jobTime}>Publié {jobData.timeAgo}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(jobData.status) }]}>
                <Text style={styles.statusText}>{getStatusText(jobData.status)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Budget */}
        <View style={styles.budgetCard}>
          <MaterialIcons name="payments" size={24} color={colors.primary} />
          <View style={styles.budgetInfo}>
            <Text style={styles.budgetLabel}>Budget proposé</Text>
            <Text style={styles.budgetAmount}>
              {jobData.budget_min.toLocaleString()} - {jobData.budget_max.toLocaleString()} XOF
            </Text>
          </View>
        </View>

        {/* Location */}
        <View style={styles.infoCard}>
          <MaterialIcons name="location-on" size={24} color={colors.textSecondary} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Localisation</Text>
            <Text style={styles.infoText}>{jobData.location}</Text>
          </View>
        </View>

        {/* Category */}
        <View style={styles.infoCard}>
          <MaterialIcons name="category" size={24} color={colors.textSecondary} />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Catégorie</Text>
            <Text style={styles.infoText}>{category?.name || jobData.category}</Text>
          </View>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{jobData.description}</Text>
        </View>

        {/* Requirements */}
        {jobData.requirements && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Exigences</Text>
            {jobData.requirements.map((requirement, index) => (
              <View key={index} style={styles.requirementItem}>
                <MaterialIcons name="check-circle" size={16} color={colors.success} />
                <Text style={styles.requirementText}>{requirement}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Deadline */}
        {jobData.deadline && (
          <View style={styles.infoCard}>
            <MaterialIcons name="schedule" size={24} color={colors.warning} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Date limite</Text>
              <Text style={styles.infoText}>
                {new Date(jobData.deadline).toLocaleDateString('fr-FR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </Text>
            </View>
          </View>
        )}

        {/* Client Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>À propos du client</Text>
          <View style={styles.clientCard}>
            <View style={styles.clientAvatar}>
              <Text style={styles.clientAvatarText}>
                {jobData.client_name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.clientInfo}>
              <Text style={styles.clientName}>{jobData.client_name}</Text>
              <View style={styles.clientRating}>
                <MaterialIcons name="star" size={16} color={colors.warning} />
                <Text style={styles.ratingText}>4.8 (12 avis)</Text>
              </View>
              <Text style={styles.clientLocation}>{jobData.location}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.footer}>
        {canApply && (
          <TouchableOpacity
            style={styles.applyButton}
            onPress={handleApply}
            activeOpacity={0.8}
          >
            <Text style={styles.applyButtonText}>Postuler maintenant</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={[styles.contactButton, canApply && styles.contactButtonSecondary]}
          onPress={handleContact}
          activeOpacity={0.8}
        >
          <MaterialIcons name="message" size={20} color={canApply ? colors.primary : colors.background} />
          <Text style={[styles.contactButtonText, canApply && styles.contactButtonTextSecondary]}>
            Contacter le client
          </Text>
        </TouchableOpacity>
      </View>
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
  jobHeader: {
    flexDirection: 'row',
    padding: 20,
    alignItems: 'flex-start',
  },
  jobCategory: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  jobCategoryIcon: {
    fontSize: 24,
  },
  jobTitleSection: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  jobClient: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  jobMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  jobTime: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text,
  },
  budgetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '10',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  budgetInfo: {
    marginLeft: 12,
  },
  budgetLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  budgetAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
  },
  infoContent: {
    marginLeft: 12,
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 14,
    color: colors.text,
    marginLeft: 8,
    flex: 1,
  },
  clientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
  },
  clientAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  clientAvatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.background,
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  clientRating: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  ratingText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 4,
  },
  clientLocation: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.surface,
  },
  applyButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  applyButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
  },
  contactButtonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  contactButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  contactButtonTextSecondary: {
    color: colors.primary,
  },
});