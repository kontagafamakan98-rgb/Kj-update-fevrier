# Kojo Mobile App

A React Native mobile application for the Kojo platform - connecting clients with service providers across West Africa.

## 🌍 Supported Countries
- 🇲🇱 Mali
- 🇸🇳 Senegal
- 🇧🇫 Burkina Faso
- 🇨🇮 Côte d'Ivoire

## 🚀 Features

### Core Features
- ✅ User authentication (Client/Worker)
- ✅ Job posting and browsing
- ✅ Real-time messaging
- ✅ Multi-language support (French, Wolof, Bambara)
- ✅ Location services with GPS
- ✅ Push notifications
- ✅ Offline support

### Mobile-Specific Features
- 📱 Native camera integration
- 🔒 Biometric authentication
- 📍 GPS location services
- 📳 Haptic feedback
- 🔔 Native push notifications
- 💾 Offline data persistence

## 🛠 Tech Stack

- **Framework**: React Native with Expo
- **Navigation**: React Navigation v7
- **State Management**: React Context
- **UI Components**: React Native Paper + Custom Components
- **API**: Axios with existing FastAPI backend
- **Storage**: AsyncStorage + Expo SecureStore
- **Location**: Expo Location
- **Camera**: Expo Camera + Image Picker
- **Notifications**: Expo Notifications

## 📦 Installation

```bash
# Install dependencies
yarn install

# Start development server
yarn start

# Run on Android
yarn android

# Run on iOS
yarn ios

# Run on web
yarn web
```

## 🏗 Build Commands

```bash
# Development build
yarn build:dev

# Preview build (APK for testing)
yarn build:preview

# Production build
yarn build:production

# Build for both platforms
yarn build:all
```

## 📱 Development

### Running on Device
1. Install Expo Go app on your device
2. Run `yarn start`
3. Scan the QR code with Expo Go (Android) or Camera app (iOS)

### Development Build
For features requiring native code:
```bash
npx eas build --profile development --platform android
npx eas build --profile development --platform ios
```

## 🎨 Design System

### Colors
- Primary: #EA580C (Orange)
- Secondary: #FB923C (Light Orange)
- Background: #FFFFFF
- Text: #1F2937
- Success: #10B981
- Error: #EF4444

### Typography
- Headers: Bold, large sizes
- Body: Regular weight
- Captions: Smaller, secondary color

## 🌐 Localization

Supported languages:
- French (fr) - Primary
- Wolof (wo) - Senegal
- Bambara (bm) - Mali

## 📋 Project Structure

```
src/
├── components/          # Reusable UI components
├── contexts/           # React contexts (Auth, Language, etc.)
├── navigation/         # Navigation configuration
├── screens/           # Screen components
│   ├── auth/         # Authentication screens
│   ├── main/         # Main app screens
│   └── ...
├── services/          # API services
├── theme/            # Theme configuration
├── constants/        # App constants
└── utils/           # Utility functions
```

## 🔧 Configuration

### Environment Variables
```
EXPO_PUBLIC_API_URL=https://worker-pay-portal.preview.emergentagent.com/api
EXPO_PUBLIC_APP_NAME=Kojo
EXPO_PUBLIC_APP_VERSION=1.0.0
```

### Build Configuration
- `app.json` - Expo configuration
- `eas.json` - Build and submit configuration
- `metro.config.js` - Metro bundler configuration

## 📱 Beta Testing

### Android APK Distribution
1. Build preview version: `npx eas build --profile preview --platform android`
2. Download APK from Expo dashboard
3. Share APK file with testers for sideloading

### iOS TestFlight
1. Build preview version: `npx eas build --profile preview --platform ios`
2. Submit to TestFlight: `npx eas submit --platform ios`
3. Add testers via TestFlight

### Expo Go (Easiest for Beta)
1. Run `yarn start`
2. Share QR code with testers
3. Testers scan with Expo Go app

## 🚀 Production Deployment

### Google Play Store
1. Build production AAB: `npx eas build --profile production --platform android`
2. Submit to Play Store: `npx eas submit --platform android`
3. Follow Play Console review process

### Apple App Store
1. Build production IPA: `npx eas build --profile production --platform ios`
2. Submit to App Store: `npx eas submit --platform ios`
3. Follow App Store Connect review process

## 🧪 Testing

### Unit Tests
```bash
yarn test
```

### E2E Testing
```bash
# Install Detox (if needed)
yarn test:e2e
```

## 📊 Performance

### Optimization
- Image optimization with Expo Image
- Bundle splitting for web
- Native driver for animations
- Efficient list rendering with FlatList

### Monitoring
- Expo analytics for crash reporting
- Performance monitoring with Flipper
- Bundle analyzer for size optimization

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit pull request

## 📄 License

This project is licensed under the MIT License.

## 📞 Support

For technical support or questions:
- Email: support@kojo.app
- Website: https://kojo.app
- Documentation: https://docs.kojo.app

---

**Built with ❤️ for West Africa**