import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Provider as PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/contexts/AuthContext';
import { LanguageProvider } from './src/contexts/LanguageContext';
import { theme } from './src/theme/theme';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={theme}>
        <LanguageProvider>
          <AuthProvider>
            <NavigationContainer>
              <StatusBar style="light" backgroundColor="#EA580C" />
              <AppNavigator />
            </NavigationContainer>
          </AuthProvider>
        </LanguageProvider>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}