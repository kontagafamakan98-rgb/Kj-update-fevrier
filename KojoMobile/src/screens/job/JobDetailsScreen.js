import React, { useState, useEffect } from 'react';
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
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import { useAuth } from '../../contexts/AuthContext';
import { colors } from '../../theme/theme';
import { JOB_CATEGORIES } from '../../constants/jobCategories';
import { jobsAPI, proposalsAPI } from '../../services/api';

export default function JobDetailsScreen({ route, navigation }) {
  const { jobId, job: initialJob } = route.params;
  const [job, setJob] = useState(initialJob);
  const [loading, setLoading] = useState(!initialJob);
  const [submittingProposal, setSubmittingProposal] = useState(false);

  const { user } = useAuth();

  useEffect(() => {
    if (!initialJob) {
      loadJob();
    }
  }, [jobId]);

  const loadJob = async () => {
    try {
      const response = await jobsAPI.getJob(jobId);
      setJob(response.data);
    } catch (error) {
      console.error('Error loading job:', error);
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Impossible de charger le job',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitProposal = () => {
    if (user?.user_type !== 'worker') {
      Alert.alert('Erreur', 'Seuls les travailleurs peuvent soumettre des propositions');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    Alert.prompt(
      'Soumettre une proposition',
      'Entrez votre tarif et message',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Soumettre',
          onPress: async (proposedAmount) => {
            if (!proposedAmount || isNaN(proposedAmount)) {
              Toast.show({
                type: 'error',
                text1: 'Erreur',
                text2: 'Montant invalide',
              });
              return;
            }

            setSubmittingProposal(true);
            try {
              await proposalsAPI.createProposal(jobId, {
                proposed_amount: parseFloat(proposedAmount),
                estimated_completion_time: '2-3 jours',
                message: 'Je suis intéressé par ce projet et j\'ai l\'expérience nécessaire.',
              });

              Toast.show({
                type: 'success',
                text1: 'Succès',
                text2: 'Proposition soumise avec succès!',
              });
              
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Erreur',
                text2: error.response?.data?.detail || 'Erreur lors de la soumission',
              });
            } finally {
              setSubmittingProposal(false);
            }
          }
        }
      ],
      'plain-text',
      '',
      'numeric'
    );
  };

  const handleContact = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Navigate to chat with job owner
    navigation.navigate('Chat', {
      conversationId: `${user.id}_${job.client_id}`,
      otherUserId: job.client_id
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>Chargement...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text>Job non trouvé</Text>
        </View>
      </SafeAreaView>
    );
  }

  const category = JOB_CATEGORIES.find(cat => cat.id === job.category);
  const canSubmitProposal = user?.user_type === 'worker' && job.status === 'open' && job.client_id !== user.id;
  const isOwner = job.client_id === user?.id;

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
          <View style={styles.jobTitleRow}>
            <Text style={styles.jobTitle}>{job.title}</Text>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(job.status) }]}>
              <Text style={styles.statusText}>{getStatusText(job.status)}</Text>
            </View>
          </View>
          
          <View style={styles.jobMeta}>
            <View style={styles.budgetContainer}>
              <MaterialIcons name="payments" size={20} color={colors.primary} />
              <Text style={styles.budget}>
                {job.budget_min}€ - {job.budget_max}€
              </Text>
            </View>
            <Text style={styles.jobTime}>Publié il y a 2h</Text>
          </View>
        </View>

        {/* Category and Location */}
        <View style={styles.infoSection}>
          <View style={styles.infoItem}>
            <View style={styles.categoryContainer}>
              <Text style={styles.categoryIcon}>{category?.icon || '💼'}</Text>
              <Text style={styles.categoryText}>{category?.name || job.category}</Text>
            </View>
          </View>
          
          {job.location && (
            <View style={styles.infoItem}>
              <MaterialIcons name="location-on" size={20} color={colors.textSecondary} />
              <Text style={styles.locationText}>
                {job.location.address || 'Localisation fournie'}
              </Text>
            </View>
          )}
          
          {job.estimated_duration && (
            <View style={styles.infoItem}>
              <MaterialIcons name="schedule" size={20} color={colors.textSecondary} />
              <Text style={styles.durationText}>{job.estimated_duration}</Text>
            </View>
          )}
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{job.description}</Text>
        </View>

        {/* Required Skills */}
        {job.required_skills && job.required_skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Compétences requises</Text>
            <View style={styles.skillsContainer}>
              {job.required_skills.map((skill, index) => (
                <View key={index} style={styles.skillChip}>
                  <Text style={styles.skillText}>{skill}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Deadline */}
        {job.deadline && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Date limite</Text>
            <Text style={styles.deadline}>
              {new Date(job.deadline).toLocaleDateString('fr-FR')}
            </Text>
          </View>
        )}

        {/* Client Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Client</Text>
          <View style={styles.clientInfo}>
            <View style={styles.clientAvatar}>
              <MaterialIcons name="person" size={24} color={colors.background} />
            </View>
            <View style={styles.clientDetails}>
              <Text style={styles.clientName}>Client Kojo</Text>
              <View style={styles.clientRating}>
                <MaterialIcons name="star" size={16} color={colors.warning} />
                <Text style={styles.ratingText}>4.8 (12 avis)</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.footer}>
        {canSubmitProposal && (
          <TouchableOpacity
            style={[styles.actionButton, styles.primaryButton]}
            onPress={handleSubmitProposal}
            disabled={submittingProposal}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>
              {submittingProposal ? 'Soumission...' : 'Soumettre une proposition'}
            </Text>
          </TouchableOpacity>
        )}
        
        {!isOwner && (
          <TouchableOpacity
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={handleContact}
            activeOpacity={0.8}
          >
            <MaterialIcons name="message" size={20} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Contacter</Text>
          </TouchableOpacity>
        )}
        
        {isOwner && (
          <TouchableOpacity
            style={[styles.actionButton, styles.primaryButton]}
            onPress={() => {/* Navigate to proposals */}}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Voir les propositions</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const getStatusColor = (status) => {
  switch (status) {
    case 'open': return colors.success + '20';
    case 'in_progress': return colors.warning + '20';
    case 'completed': return colors.info + '20';
    case 'cancelled': return colors.error + '20';
    default: return colors.textSecondary + '20';
  }
};

const getStatusText = (status) => {
  switch (status) {
    case 'open': return 'Ouvert';
    case 'in_progress': return 'En cours';
    case 'completed': return 'Terminé';
    case 'cancelled': return 'Annulé';
    default: return 'Inconnu';
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
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
    padding: 20,
  },
  jobTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  jobTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    flex: 1,
    marginRight: 12,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  jobMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  budget: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    marginLeft: 6,
  },
  jobTime: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  infoSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  categoryIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  locationText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  durationText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  section: {
    paddingHorizontal: 20,
    paddingBottom: 20,
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
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  skillChip: {
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  skillText: {
    fontSize: 14,
    color: colors.text,
  },
  deadline: {
    fontSize: 16,
    color: colors.text,
  },
  clientInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clientAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  clientDetails: {
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
  },
  ratingText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 4,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  actionButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});