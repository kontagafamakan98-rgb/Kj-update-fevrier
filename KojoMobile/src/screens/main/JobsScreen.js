import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { colors } from '../../theme/theme';
import { JOB_CATEGORIES } from '../../constants/jobCategories';
import { jobsAPI } from '../../services/api';

export default function JobsScreen({ navigation, route }) {
  const [jobs, setJobs] = useState([]);
  const [filteredJobs, setFilteredJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(route?.params?.category || 'all');

  const { user } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    filterJobs();
  }, [jobs, searchQuery, selectedCategory]);

  const loadJobs = async () => {
    try {
      const response = await jobsAPI.getJobs();
      setJobs(response.data || []);
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadJobs();
    setRefreshing(false);
  };

  const filterJobs = () => {
    let filtered = jobs;

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(job => job.category?.toLowerCase() === selectedCategory.toLowerCase());
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(job =>
        job.title?.toLowerCase().includes(query) ||
        job.description?.toLowerCase().includes(query) ||
        job.category?.toLowerCase().includes(query)
      );
    }

    setFilteredJobs(filtered);
  };

  const handleJobPress = (job) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('JobDetails', { jobId: job.id, job });
  };

  const handleCategoryPress = (categoryId) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategory(categoryId);
  };

  const renderJobCard = ({ item: job }) => (
    <TouchableOpacity
      style={styles.jobCard}
      onPress={() => handleJobPress(job)}
      activeOpacity={0.8}
    >
      <View style={styles.jobHeader}>
        <View style={styles.jobTitleContainer}>
          <Text style={styles.jobTitle} numberOfLines={1}>
            {job.title}
          </Text>
          <View style={styles.jobMeta}>
            <Text style={styles.jobBudget}>
              {job.budget_min}€ - {job.budget_max}€
            </Text>
            <Text style={styles.jobDivider}>•</Text>
            <Text style={styles.jobTime}>Il y a 2h</Text>
          </View>
        </View>
        <View style={[styles.jobStatus, { backgroundColor: getStatusColor(job.status) }]}>
          <Text style={styles.jobStatusText}>{getStatusText(job.status)}</Text>
        </View>
      </View>

      <Text style={styles.jobDescription} numberOfLines={3}>
        {job.description}
      </Text>

      <View style={styles.jobFooter}>
        <View style={styles.jobCategory}>
          <Text style={styles.jobCategoryText}>
            {JOB_CATEGORIES.find(cat => cat.id === job.category)?.icon || '💼'} {job.category}
          </Text>
        </View>
        
        {job.location && (
          <View style={styles.jobLocation}>
            <MaterialIcons name="location-on" size={16} color={colors.textSecondary} />
            <Text style={styles.jobLocationText} numberOfLines={1}>
              {job.location.address || 'Non spécifié'}
            </Text>
          </View>
        )}
      </View>

      {job.required_skills && job.required_skills.length > 0 && (
        <View style={styles.skillsContainer}>
          {job.required_skills.slice(0, 3).map((skill, index) => (
            <View key={index} style={styles.skillChip}>
              <Text style={styles.skillText}>{skill}</Text>
            </View>
          ))}
          {job.required_skills.length > 3 && (
            <Text style={styles.moreSkills}>+{job.required_skills.length - 3}</Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );

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

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Jobs disponibles</Text>
        {user?.user_type === 'client' && (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => navigation.navigate('CreateJob')}
          >
            <MaterialIcons name="add" size={24} color={colors.background} />
          </TouchableOpacity>
        )}
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <MaterialIcons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher des jobs..."
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => setSearchQuery('')}
          >
            <MaterialIcons name="clear" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Categories Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoriesScroll}
        contentContainerStyle={styles.categoriesContent}
      >
        <TouchableOpacity
          style={[
            styles.categoryFilter,
            selectedCategory === 'all' && styles.categoryFilterActive
          ]}
          onPress={() => handleCategoryPress('all')}
        >
          <Text style={[
            styles.categoryFilterText,
            selectedCategory === 'all' && styles.categoryFilterTextActive
          ]}>
            Tout
          </Text>
        </TouchableOpacity>
        
        {JOB_CATEGORIES.map(category => (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.categoryFilter,
              selectedCategory === category.id && styles.categoryFilterActive
            ]}
            onPress={() => handleCategoryPress(category.id)}
          >
            <Text style={styles.categoryFilterIcon}>{category.icon}</Text>
            <Text style={[
              styles.categoryFilterText,
              selectedCategory === category.id && styles.categoryFilterTextActive
            ]}>
              {category.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Jobs List */}
      <FlatList
        data={filteredJobs}
        renderItem={renderJobCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.jobsList}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialIcons name="work-off" size={64} color={colors.textSecondary} />
            <Text style={styles.emptyStateTitle}>Aucun job trouvé</Text>
            <Text style={styles.emptyStateText}>
              {searchQuery || selectedCategory !== 'all'
                ? 'Essayez de modifier vos critères de recherche'
                : 'Aucun job disponible pour le moment'
              }
            </Text>
          </View>
        }
      />
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 16,
  },
  clearButton: {
    padding: 4,
  },
  categoriesScroll: {
    marginBottom: 16,
  },
  categoriesContent: {
    paddingHorizontal: 20,
  },
  categoryFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryFilterActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryFilterIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  categoryFilterText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  categoryFilterTextActive: {
    color: colors.background,
  },
  jobsList: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  jobCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  jobTitleContainer: {
    flex: 1,
    marginRight: 12,
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  jobMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  jobBudget: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  jobDivider: {
    fontSize: 14,
    color: colors.textSecondary,
    marginHorizontal: 8,
  },
  jobTime: {
    fontSize: 14,
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
  jobDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  jobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
  jobLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginLeft: 12,
  },
  jobLocationText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 4,
    flex: 1,
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  skillChip: {
    backgroundColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 6,
    marginBottom: 4,
  },
  skillText: {
    fontSize: 12,
    color: colors.text,
  },
  moreSkills: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 24,
  },
});