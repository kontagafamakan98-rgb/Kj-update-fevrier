import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { colors } from '../theme/theme';
import { JOB_CATEGORIES } from '../constants/categories';

export default function JobsScreen({ navigation, route }) {
  const [jobs, setJobs] = useState([
    {
      id: '1',
      title: 'Réparation plomberie urgent',
      description: 'Fuite d\'eau importante dans la cuisine. Intervention rapide requise.',
      category: 'plumbing',
      budget_min: 15000,
      budget_max: 25000,
      location: 'Bamako, Mali',
      timeAgo: '2h',
      status: 'open',
      client_name: 'Aminata Traoré'
    },
    {
      id: '2', 
      title: 'Installation électrique maison',
      description: 'Installation complète électrique pour nouvelle construction.',
      category: 'electrical',
      budget_min: 50000,
      budget_max: 80000,
      location: 'Dakar, Sénégal',
      timeAgo: '4h',
      status: 'open',
      client_name: 'Moussa Diallo'
    },
    {
      id: '3',
      title: 'Nettoyage bureau',
      description: 'Nettoyage complet d\'un bureau de 100m². Équipement fourni.',
      category: 'cleaning',
      budget_min: 10000,
      budget_max: 15000,
      location: 'Ouagadougou, Burkina Faso',
      timeAgo: '1j',
      status: 'in_progress',
      client_name: 'Fatou Kone'
    },
    {
      id: '4',
      title: 'Cours de mathématiques',
      description: 'Cours particuliers de mathématiques niveau lycée.',
      category: 'tutoring',
      budget_min: 5000,
      budget_max: 8000,
      location: 'Abidjan, Côte d\'Ivoire',
      timeAgo: '3h',
      status: 'open',
      client_name: 'Jean Baptiste'
    }
  ]);
  
  const [filteredJobs, setFilteredJobs] = useState(jobs);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(route?.params?.category || 'all');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    filterJobs();
  }, [jobs, searchQuery, selectedCategory]);

  const filterJobs = () => {
    let filtered = jobs;

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(job => job.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(job =>
        job.title.toLowerCase().includes(query) ||
        job.description.toLowerCase().includes(query)
      );
    }

    setFilteredJobs(filtered);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const getCategoryIcon = (categoryKey) => {
    const category = JOB_CATEGORIES.find(cat => cat.key === categoryKey);
    return category ? category.icon : '💼';
  };

  const getCategoryName = (categoryKey) => {
    const category = JOB_CATEGORIES.find(cat => cat.key === categoryKey);
    return category ? category.name : categoryKey;
  };

  const renderJobCard = ({ item: job }) => (
    <TouchableOpacity
      style={styles.jobCard}
      onPress={() => navigation.navigate('JobDetails', { jobId: job.id, job })}
      activeOpacity={0.8}
    >
      <View style={styles.jobHeader}>
        <View style={styles.jobCategory}>
          <Text style={styles.jobCategoryIcon}>{getCategoryIcon(job.category)}</Text>
        </View>
        <View style={styles.jobInfo}>
          <Text style={styles.jobTitle} numberOfLines={1}>
            {job.title}
          </Text>
          <Text style={styles.jobClient}>Par {job.client_name}</Text>
          <View style={styles.jobMeta}>
            <Text style={styles.jobBudget}>
              {job.budget_min.toLocaleString()} - {job.budget_max.toLocaleString()} XOF
            </Text>
            <Text style={styles.jobTime}>{job.timeAgo}</Text>
          </View>
        </View>
        <View style={[styles.jobStatus, { backgroundColor: getStatusColor(job.status) }]}>
          <Text style={styles.jobStatusText}>{getStatusText(job.status)}</Text>
        </View>
      </View>

      <Text style={styles.jobDescription} numberOfLines={2}>
        {job.description}
      </Text>

      <View style={styles.jobFooter}>
        <View style={styles.jobLocationContainer}>
          <MaterialIcons name="location-on" size={16} color={colors.textSecondary} />
          <Text style={styles.jobLocation}>{job.location}</Text>
        </View>
        <Text style={styles.jobCategoryName}>{getCategoryName(job.category)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Jobs disponibles</Text>
        <TouchableOpacity style={styles.filterButton}>
          <MaterialIcons name="filter-list" size={24} color={colors.text} />
        </TouchableOpacity>
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
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoriesList}
        contentContainerStyle={styles.categoriesContent}
        data={[{ key: 'all', name: 'Tout', icon: '📋' }, ...JOB_CATEGORIES]}
        keyExtractor={(item) => item.key}
        renderItem={({ item: category }) => (
          <TouchableOpacity
            style={[
              styles.categoryFilter,
              selectedCategory === category.key && styles.categoryFilterActive
            ]}
            onPress={() => setSelectedCategory(category.key)}
          >
            <Text style={styles.categoryFilterIcon}>{category.icon}</Text>
            <Text style={[
              styles.categoryFilterText,
              selectedCategory === category.key && styles.categoryFilterTextActive
            ]}>
              {category.name}
            </Text>
          </TouchableOpacity>
        )}
      />

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
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
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
  categoriesList: {
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
    alignItems: 'flex-start',
    marginBottom: 12,
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
    fontSize: 18,
    fontWeight: '600',
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
    justifyContent: 'space-between',
    alignItems: 'center',
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
  },
  jobLocationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  jobLocation: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 4,
  },
  jobCategoryName: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
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