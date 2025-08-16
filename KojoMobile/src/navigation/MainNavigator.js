import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useLanguage } from '../contexts/LanguageContext';
import { colors } from '../theme/theme';

import HomeScreen from '../screens/main/HomeScreen';
import JobsScreen from '../screens/main/JobsScreen';
import MessagesScreen from '../screens/main/MessagesScreen';
import ProfileScreen from '../screens/main/ProfileScreen';

import JobDetailsScreen from '../screens/job/JobDetailsScreen';
import CreateJobScreen from '../screens/job/CreateJobScreen';
import ChatScreen from '../screens/message/ChatScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import WorkerProfileScreen from '../screens/profile/WorkerProfileScreen';
import LocationPickerScreen from '../screens/location/LocationPickerScreen';
import CameraScreen from '../screens/camera/CameraScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="HomeMain" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="JobDetails" component={JobDetailsScreen} options={{ title: 'Détails du job' }} />
      <Stack.Screen name="CreateJob" component={CreateJobScreen} options={{ title: 'Créer un job' }} />
      <Stack.Screen name="LocationPicker" component={LocationPickerScreen} options={{ title: 'Choisir une location' }} />
      <Stack.Screen name="Camera" component={CameraScreen} options={{ title: 'Appareil photo' }} />
    </Stack.Navigator>
  );
}

function JobsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="JobsMain" component={JobsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="JobDetails" component={JobDetailsScreen} options={{ title: 'Détails du job' }} />
    </Stack.Navigator>
  );
}

function MessagesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="MessagesMain" component={MessagesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat' }} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Modifier le profil' }} />
      <Stack.Screen name="WorkerProfile" component={WorkerProfileScreen} options={{ title: 'Profil travailleur' }} />
    </Stack.Navigator>
  );
}

export default function MainNavigator() {
  const { t } = useLanguage();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          switch (route.name) {
            case 'Home':
              iconName = 'home';
              break;
            case 'Jobs':
              iconName = 'work';
              break;
            case 'Messages':
              iconName = 'message';
              break;
            case 'Profile':
              iconName = 'person';
              break;
            default:
              iconName = 'circle';
          }

          return <MaterialIcons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        headerShown: false,
      })}
    >
      <Tab.Screen 
        name="Home" 
        component={HomeStack} 
        options={{ tabBarLabel: t('home') }}
      />
      <Tab.Screen 
        name="Jobs" 
        component={JobsStack} 
        options={{ tabBarLabel: t('jobs') }}
      />
      <Tab.Screen 
        name="Messages" 
        component={MessagesStack} 
        options={{ tabBarLabel: t('messages') }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileStack} 
        options={{ tabBarLabel: t('profile') }}
      />
    </Tab.Navigator>
  );
}