import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/theme';
import { COUNTRIES } from '../constants/countries';
import ProfilePhoto from '../components/ProfilePhoto';

export default function ProfileScreen({ navigation }) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0); // Add refresh trigger for ProfilePhoto

  const { user, logout } = useAuth();

  // Handle photo change to force ProfilePhoto component refresh
  const handlePhotoChange = (result) => {
    console.log('Photo changed in ProfileScreen:', result);
    if (result.success || result.local) {
      // Force ProfilePhoto component to refresh by incrementing trigger
      setRefreshTrigger(prev => prev + 1);
      console.log('ProfilePhoto refresh triggered');
    }
  };

  const userCountry = COUNTRIES[user?.country?.toUpperCase()] || COUNTRIES.MALI;

  const handleLogout = () => {
    Alert.alert(
      'Déconnexion',
      'Êtes-vous sûr de vouloir vous déconnecter?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Déconnexion',
          style: 'destructive',
          onPress: async () => {
            await logout();
          }
        }
      ]
    );
  };

  const profileMenuItems = [
    {
      id: 'edit',
      title: 'Modifier le profil',
      icon: 'edit',
      onPress: () => navigation.navigate('EditProfile'),
    },
    {
      id: 'notifications',
      title: 'Notifications',
      icon: 'notifications',
      onPress: () => navigation.navigate('NotificationSettings'),
    },
    {
      id: 'documents',
      title: 'Mes documents',
      icon: 'folder',
      onPress: () => Alert.alert('Documents', 'Fonctionnalité bientôt disponible'),
    },
    {
      id: 'payment',
      title: 'Paiements',
      icon: 'payment',
      onPress: () => Alert.alert('Paiements', 'Orange Money et Wave bientôt disponibles'),
    },
  ];

  const settingsMenuItems = [
    {
      id: 'notifications',
      title: 'Notifications',
      icon: 'notifications',
      toggle: notificationsEnabled,
      onToggle: setNotificationsEnabled,
    },
    {
      id: 'darkmode',
      title: 'Mode sombre',
      icon: 'dark-mode',
      toggle: darkModeEnabled,
      onToggle: setDarkModeEnabled,
    },
    {
      id: 'language',
      title: 'Langue',
      icon: 'language',
      onPress: () => Alert.alert('Langue', 'Français, Wolof et Bambara bientôt disponibles'),
      rightText: 'Français',
    },
  ];

  const supportMenuItems = [
    {
      id: 'help',
      title: 'Aide et support',
      icon: 'help',
      onPress: () => Alert.alert('Support', 'support@kojo.app'),
    },
    {
      id: 'privacy',
      title: 'Politique de confidentialité',
      icon: 'privacy-tip',
      onPress: () => Alert.alert('Confidentialité', 'Fonctionnalité bientôt disponible'),
    },
    {
      id: 'terms',
      title: 'Conditions d\'utilisation',
      icon: 'description',
      onPress: () => Alert.alert('Conditions', 'Fonctionnalité bientôt disponible'),
    },
    {
      id: 'about',
      title: 'À propos de Kojo',
      icon: 'info',
      onPress: () => Alert.alert('Kojo v1.0.0', 'Application mobile pour l\'Afrique de l\'Ouest'),
    },
  ];

  const renderMenuItem = (item) => (
    <TouchableOpacity
      key={item.id}
      style={styles.menuItem}
      onPress={item.onPress}
      activeOpacity={0.8}
    >
      <View style={styles.menuItemLeft}>
        <MaterialIcons name={item.icon} size={24} color={colors.text} />
        <Text style={styles.menuItemTitle}>{item.title}</Text>
      </View>
      <View style={styles.menuItemRight}>
        {item.rightText && (
          <Text style={styles.menuItemRightText}>{item.rightText}</Text>
        )}
        {item.toggle !== undefined ? (
          <Switch
            value={item.toggle}
            onValueChange={item.onToggle}
            trackColor={{ false: colors.border, true: colors.primary + '40' }}
            thumbColor={item.toggle ? colors.primary : colors.textSecondary}
          />
        ) : (
          <MaterialIcons name="chevron-right" size={24} color={colors.textSecondary} />
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          style={styles.profileHeader}
        >
          <ProfilePhoto
            user={user}
            size={100}
            editable={true}
            refreshTrigger={refreshTrigger}
            onPhotoChange={(result) => {
              console.log('ProfilePhoto onPhotoChange called:', result);
              
              // Call our handler to trigger refresh
              handlePhotoChange(result);
              
              // Show user feedback
              if (result.success || result.local) {
                Alert.alert('Succès', 'Photo mise à jour avec succès');
              } else if (result.deleted) {
                Alert.alert('Succès', 'Photo supprimée');
              } else if (result.error) {
                Alert.alert('Erreur', result.error);
              }
            }}
            showChangeButton={true}
          />
          
          <Text style={styles.userName}>
            {user?.first_name} {user?.last_name}
          </Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          
          {/* Debug button - remove after testing */}
          <TouchableOpacity
            style={{
              backgroundColor: 'rgba(255,255,255,0.2)',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 15,
              marginTop: 8,
            }}
            onPress={() => {
              console.log('Debug: Force refresh ProfilePhoto');
              console.log('Current user:', user);
              console.log('Current refreshTrigger:', refreshTrigger);
              setRefreshTrigger(prev => prev + 1);
              Alert.alert('Debug', `RefreshTrigger incrémenté à ${refreshTrigger + 1}`);
            }}
          >
            <Text style={{ color: 'white', fontSize: 12 }}>
              🔄 Debug Refresh ({refreshTrigger})
            </Text>
          </TouchableOpacity>
          
          <View style={styles.userMeta}>
            <View style={styles.userMetaItem}>
              <Text style={styles.userMetaIcon}>{userCountry.flag}</Text>
              <Text style={styles.userMetaText}>{userCountry.nameFrench}</Text>
            </View>
            <View style={styles.userMetaDivider} />
            <View style={styles.userMetaItem}>
              <MaterialIcons name="work" size={16} color={colors.background} />
              <Text style={styles.userMetaText}>
                {user?.user_type === 'client' ? 'Client' : 'Travailleur'}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>4.8</Text>
            <Text style={styles.statLabel}>Note moyenne</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>12</Text>
            <Text style={styles.statLabel}>Jobs terminés</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>85%</Text>
            <Text style={styles.statLabel}>Taux succès</Text>
          </View>
        </View>

        {/* Profile Menu */}
        <View style={styles.menuSection}>
          <Text style={styles.sectionTitle}>Mon compte</Text>
          {profileMenuItems.map(renderMenuItem)}
        </View>

        {/* Settings Menu */}
        <View style={styles.menuSection}>
          <Text style={styles.sectionTitle}>Paramètres</Text>
          {settingsMenuItems.map(renderMenuItem)}
        </View>

        {/* Support Menu */}
        <View style={styles.menuSection}>
          <Text style={styles.sectionTitle}>Support</Text>
          {supportMenuItems.map(renderMenuItem)}
        </View>

        {/* Logout Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <MaterialIcons name="logout" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Déconnexion</Text>
        </TouchableOpacity>

        {/* App Version */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>Kojo v1.0.0 - Bêta</Text>
          <Text style={styles.versionSubText}>Afrique de l'Ouest</Text>
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
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.background,
  },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.background,
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 16,
    color: colors.background,
    opacity: 0.9,
    marginBottom: 16,
  },
  userMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userMetaIcon: {
    fontSize: 16,
    marginRight: 4,
  },
  userMetaText: {
    fontSize: 14,
    color: colors.background,
    opacity: 0.9,
  },
  userMetaDivider: {
    width: 1,
    height: 16,
    backgroundColor: colors.background,
    opacity: 0.3,
    marginHorizontal: 12,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: -20,
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
  menuSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 16,
    color: colors.text,
    marginLeft: 12,
  },
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemRightText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginRight: 8,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error + '10',
    paddingVertical: 16,
    borderRadius: 12,
    marginHorizontal: 20,
    marginBottom: 24,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
    marginLeft: 8,
  },
  versionContainer: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  versionText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  versionSubText: {
    fontSize: 12,
    color: colors.textSecondary,
    opacity: 0.7,
  },
});