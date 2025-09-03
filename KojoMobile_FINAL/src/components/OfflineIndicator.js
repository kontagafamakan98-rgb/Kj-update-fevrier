import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNotifications } from '../contexts/NotificationContext';

const OfflineIndicator = () => {
  const { 
    isOnline, 
    offlineQueueSize, 
    lastSyncTime, 
    syncData,
    isInitialized 
  } = useNotification();

  // Don't show anything if services aren't initialized or if online
  if (!isInitialized || isOnline) {
    return null;
  }

  const handleSyncPress = async () => {
    if (isOnline) {
      await syncData();
    }
  };

  const formatLastSync = () => {
    if (!lastSyncTime) return 'Jamais synchronisé';
    
    const now = new Date();
    const sync = new Date(lastSyncTime);
    const diffMinutes = Math.floor((now - sync) / (1000 * 60));
    
    if (diffMinutes < 1) return 'À l\'instant';
    if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
    
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `Il y a ${diffDays} jour${diffDays > 1 ? 's' : ''}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <MaterialIcons 
          name="cloud-off" 
          size={20} 
          color="#fff" 
          style={styles.icon} 
        />
        
        <View style={styles.textContainer}>
          <Text style={styles.primaryText}>Mode hors ligne</Text>
          <Text style={styles.secondaryText}>
            {offlineQueueSize > 0 
              ? `${offlineQueueSize} action${offlineQueueSize > 1 ? 's' : ''} en attente`
              : 'Dernière synchro: ' + formatLastSync()
            }
          </Text>
        </View>
        
        {offlineQueueSize > 0 && isOnline && (
          <TouchableOpacity 
            style={styles.syncButton}
            onPress={handleSyncPress}
          >
            <MaterialIcons name="sync" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.9,
    marginTop: 2,
  },
  syncButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    padding: 8,
    marginLeft: 12,
  },
});

export default OfflineIndicator;