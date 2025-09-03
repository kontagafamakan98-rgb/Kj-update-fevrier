import React, { useMemo }, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNotifications } from '../contexts/NotificationContext';

const NotificationSettingsScreen = ({ navigation }) => {
  const { 
    settings, 
    saveNotificationSettings,
    permissionStatus,
    requestPushPermissions,
    pushToken,
    isOnline,
    offlineQueueSize,
    syncOfflineData,
    lastSyncTime,
    simulateNotification
  } = useNotifications();

  const [localSettings, setLocalSettings] = useState(settings);

  const handleSettingChange = async (key, value) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    await saveNotificationSettings(newSettings);
  };

  const handleRequestPermissions = async () => {
    const result = await requestPushPermissions();
    if (result.success) {
      if (result.status === 'granted') {
        Alert.alert(
          'Autorisations accordées',
          'Vous recevrez maintenant les notifications push.'
        );
      } else {
        Alert.alert(
          'Autorisations refusées',
          'Vous pouvez activer les notifications dans les paramètres de votre téléphone.'
        );
      }
    }
  };

  const handleTestNotification = () => {
    Alert.alert(
      'Test de notification',
      'Quel type de notification voulez-vous tester ?',
      [
        { text: 'Message', onPress: () => simulateNotification('message') },
        { text: 'Nouveau job', onPress: () => simulateNotification('job') },
        { text: 'Paiement', onPress: () => simulateNotification('payment') },
        { text: 'Annuler', style: 'cancel' }
      ]
    );
  };

  const handleSyncData = async () => {
    if (!isOnline) {
      Alert.alert('Hors ligne', 'Connexion internet requise pour synchroniser');
      return;
    }

    if (offlineQueueSize === 0) {
      Alert.alert('Synchronisation', 'Aucune donnée à synchroniser');
      return;
    }

    const result = await syncData();
    if (result.success) {
      Alert.alert(
        'Synchronisation réussie',
        `${result.queueProcessed} actions ont été synchronisées`
      );
    } else {
      Alert.alert('Erreur', 'Échec de la synchronisation');
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

  const getPermissionStatusText = () => {
    switch (permissionStatus) {
      case 'granted': return 'Autorisées';
      case 'denied': return 'Refusées';
      case 'undetermined': return 'Non définies';
      default: return 'Inconnues';
    }
  };

  const getPermissionStatusColor = () => {
    switch (permissionStatus) {
      case 'granted': return '#22c55e';
      case 'denied': return '#ef4444';
      case 'undetermined': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
      </View>

      {/* Permission Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>État des autorisations</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Notifications push:</Text>
          <View style={styles.statusContainer}>
            <View 
              style={[
                styles.statusDot, 
                { backgroundColor: getPermissionStatusColor() }
              ]} 
            />
            <Text style={styles.statusText}>
              {getPermissionStatusText()}
            </Text>
          </View>
        </View>
        
        {permissionStatus !== 'granted' && (
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={handleRequestPermissions}
          >
            <MaterialIcons name="notifications" size={20} color="#fff" />
            <Text style={styles.permissionButtonText}>
              Activer les notifications
            </Text>
          </TouchableOpacity>
        )}

        {pushToken && (
          <Text style={styles.tokenText} numberOfLines={1}>
            Token: {pushToken.substring(0, 20)}...
          </Text>
        )}
      </View>

      {/* Notification Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Types de notifications</Text>
        
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <MaterialIcons name="work" size={24} color="#ea580c" />
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>Notifications de jobs</Text>
              <Text style={styles.settingDescription}>
                Nouveaux jobs et mises à jour
              </Text>
            </View>
          </View>
          <Switch
            value={localSettings.jobNotifications}
            onValueChange={(value) => handleSettingChange('jobNotifications', value)}
            trackColor={{ false: '#e5e7eb', true: '#ea580c' }}
            thumbColor={localSettings.jobNotifications ? '#fff' : '#f3f4f6'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <MaterialIcons name="message" size={24} color="#ea580c" />
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>Notifications de messages</Text>
              <Text style={styles.settingDescription}>
                Nouveaux messages privés
              </Text>
            </View>
          </View>
          <Switch
            value={localSettings.messageNotifications}
            onValueChange={(value) => handleSettingChange('messageNotifications', value)}
            trackColor={{ false: '#e5e7eb', true: '#ea580c' }}
            thumbColor={localSettings.messageNotifications ? '#fff' : '#f3f4f6'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <MaterialIcons name="campaign" size={24} color="#ea580c" />
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>Notifications marketing</Text>
              <Text style={styles.settingDescription}>
                Promotions et actualités
              </Text>
            </View>
          </View>
          <Switch
            value={localSettings.marketingNotifications}
            onValueChange={(value) => handleSettingChange('marketingNotifications', value)}
            trackColor={{ false: '#e5e7eb', true: '#ea580c' }}
            thumbColor={localSettings.marketingNotifications ? '#fff' : '#f3f4f6'}
          />
        </View>
      </View>

      {/* Sound & Vibration */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Son et vibration</Text>
        
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <MaterialIcons name="volume-up" size={24} color="#ea580c" />
            <Text style={styles.settingTitle}>Son activé</Text>
          </View>
          <Switch
            value={localSettings.soundEnabled}
            onValueChange={(value) => handleSettingChange('soundEnabled', value)}
            trackColor={{ false: '#e5e7eb', true: '#ea580c' }}
            thumbColor={localSettings.soundEnabled ? '#fff' : '#f3f4f6'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <MaterialIcons name="vibration" size={24} color="#ea580c" />
            <Text style={styles.settingTitle}>Vibration activée</Text>
          </View>
          <Switch
            value={localSettings.vibrationEnabled}
            onValueChange={(value) => handleSettingChange('vibrationEnabled', value)}
            trackColor={{ false: '#e5e7eb', true: '#ea580c' }}
            thumbColor={localSettings.vibrationEnabled ? '#fff' : '#f3f4f6'}
          />
        </View>
      </View>

      {/* Offline Sync */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Synchronisation hors ligne</Text>
        
        <View style={styles.syncInfo}>
          <View style={styles.syncRow}>
            <MaterialIcons 
              name={isOnline ? "wifi" : "wifi-off"} 
              size={24} 
              color={isOnline ? "#22c55e" : "#ef4444"} 
            />
            <Text style={styles.syncText}>
              {isOnline ? 'En ligne' : 'Hors ligne'}
            </Text>
          </View>
          
          <Text style={styles.syncDetails}>
            Actions en attente: {offlineQueueSize}
          </Text>
          <Text style={styles.syncDetails}>
            Dernière synchro: {formatLastSync()}
          </Text>
        </View>

        {offlineQueueSize > 0 && (
          <TouchableOpacity
            style={styles.syncButton}
            onPress={handleSyncData}
            disabled={!isOnline}
          >
            <MaterialIcons name="sync" size={20} color="#fff" />
            <Text style={styles.syncButtonText}>
              Synchroniser maintenant
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Test Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test</Text>
        <TouchableOpacity
          style={styles.testButton}
          onPress={handleTestNotification}
        >
          <MaterialIcons name="notifications-active" size={20} color="#ea580c" />
          <Text style={styles.testButtonText}>
            Tester les notifications
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  section: {
    backgroundColor: '#fff',
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  permissionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ea580c',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  tokenText: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingText: {
    marginLeft: 12,
    flex: 1,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  settingDescription: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  syncInfo: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  syncText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginLeft: 8,
  },
  syncDetails: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ea580c',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ea580c',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  testButtonText: {
    color: '#ea580c',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default NotificationSettingsScreen;