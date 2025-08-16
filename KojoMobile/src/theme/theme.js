import { DefaultTheme } from 'react-native-paper';

export const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#EA580C',
    secondary: '#FB923C',
    accent: '#FED7AA',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#1f2937',
    onSurfaceVariant: '#6b7280',
    outline: '#d1d5db',
    error: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
  },
  roundness: 12,
};

export const colors = {
  primary: '#EA580C',
  primaryLight: '#FB923C',
  primaryDark: '#C2410C',
  secondary: '#FED7AA',
  background: '#ffffff',
  surface: '#f8fafc',
  card: '#ffffff',
  text: '#1f2937',
  textSecondary: '#6b7280',
  textLight: '#9ca3af',
  border: '#e5e7eb',
  borderLight: '#f3f4f6',
  success: '#10b981',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  
  // Country colors
  mali: '#009639',
  senegal: '#00853f',
  burkinaFaso: '#009639',
  ivoryCoast: '#ff8200',
  
  // Gradient colors
  gradientStart: '#EA580C',
  gradientEnd: '#FB923C',
};