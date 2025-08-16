# 📱 KOJO MOBILE APP - BETA TESTING GUIDE

## 🚀 **HOW TO GET THE QR CODE FOR FRIENDS**

### **Step 1: Open Terminal/Command Prompt**
On your local computer (not this environment), navigate to the KojoMobile folder:

```bash
cd path/to/KojoMobile
```

### **Step 2: Start Expo Development Server**
Run one of these commands:

```bash
# Option 1: Start with tunnel (works anywhere)
npx expo start --tunnel

# Option 2: Start local (same wifi network)
npx expo start

# Option 3: If you have yarn
yarn start
```

### **Step 3: QR Code Will Appear**
You'll see something like this in your terminal:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   There is a new version of expo-cli available (6.0.8).                     │
│   You are currently using expo-cli 5.4.12                                   │
│   Install the latest version with `npm install -g expo-cli`                 │
│                                                                              │
│   █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █                │
│   █ ▄▄▄▄▄ █▄█ ▄▄██ ▄▄▄▄▄ █ ▄▄ ▄▄█ ▄▄▄▄▄ █                                │
│   █ ▄   ▄ █ ▄ █▄▄█ ▄   ▄ █▄▄▄██ █ ▄   ▄ █                                │
│   █ ▄▄▄▄▄ █▄▄█▄ ▄█ ▄▄▄▄▄ █▄▄ ▄█▄█ ▄▄▄▄▄ █                                │
│   ▄▄▄▄▄▄▄▄▄ ▄ ▄ ▄ ▄▄▄▄▄▄▄▄▄ ▄ ▄ ▄▄▄▄▄▄▄▄▄                                │
│   ▄▄▄█▄▄▄▄▄██▄▄██▄▄██▄█▄▄██▄▄█▄▄▄▄▄█▄▄▄▄                                │
│                                                                              │
│   📱 To open on Android device, install Expo Go and scan QR code            │
│   📱 To open on iPhone, scan with Camera app                                │
│                                                                              │
│   Metro waiting on exp://192.168.1.100:19000                               │
│   › Press a │ open Android                                                  │
│   › Press i │ open iOS simulator                                            │
│   › Press w │ open web                                                      │
│   › Press r │ reload app                                                    │
│   › Press m │ toggle menu                                                   │
│   › Press ? │ show all commands                                             │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 📱 **FOR YOUR FRIENDS TO TEST THE APP**

### **Android Users:**
1. **Install Expo Go** from Google Play Store
2. **Open Expo Go app**
3. **Tap "Scan QR Code"**
4. **Scan the QR code** you share with them
5. **App will download and open instantly!**

### **iPhone Users:**
1. **Install Expo Go** from App Store
2. **Open iPhone Camera app**
3. **Point camera at QR code**
4. **Tap the notification** that appears
5. **App will open in Expo Go!**

## 🔗 **ALTERNATIVE SHARING METHODS**

### **Share the Link**
Instead of QR code, you can also share the URL that appears:
```
exp://192.168.1.100:19000
```

### **Expo Dashboard**
1. Go to https://expo.dev
2. Sign in to your account
3. Your project will appear in the dashboard
4. Share the project URL with friends

## 📋 **WHAT YOUR FRIENDS NEED TO INSTALL**

### **Android (Google Play Store)**
- **Expo Go** by Expo Team (Free)

### **iPhone (App Store)**  
- **Expo Go** by 650 Industries (Free)

## 🐛 **TROUBLESHOOTING**

### **If QR Code Doesn't Work:**
1. Make sure friends are on same WiFi network (for local mode)
2. Use `--tunnel` flag for internet access anywhere
3. Check firewall settings
4. Try restarting the Expo server

### **If App Crashes:**
1. Check the terminal output for errors
2. Make sure backend server is running
3. Verify API URL in .env file

### **If Features Don't Work:**
Some features require physical device:
- Camera (won't work in simulator)
- GPS/Location (limited in simulator)
- Push notifications (device only)
- Biometric auth (device only)

## 🎯 **TESTING CHECKLIST FOR FRIENDS**

Ask your friends to test:
- ✅ **Registration**: Create account with country selection
- ✅ **Login**: Sign in with credentials
- ✅ **Browse Jobs**: View available jobs
- ✅ **Create Job**: Post a new job (for clients)
- ✅ **Job Details**: View job information
- ✅ **Submit Proposal**: Apply for jobs (for workers)
- ✅ **Messages**: Send and receive messages
- ✅ **Profile**: View and edit profile
- ✅ **Language**: Switch between French/Wolof/Bambara
- ✅ **Camera**: Take profile photos
- ✅ **Location**: Enable GPS services

## 📊 **COLLECTING FEEDBACK**

Create a simple feedback form:
1. **What did you like most?**
2. **What was confusing?**
3. **Any bugs or crashes?**
4. **Missing features?**
5. **Overall rating (1-5)?**

## 🚀 **NEXT STEPS AFTER BETA**

1. **Collect Feedback** (1-2 weeks)
2. **Fix Issues** based on feedback
3. **Add Payment APIs** (Orange Money/Wave)
4. **Build Production Version**
5. **Submit to App Stores**

---

## 📞 **NEED HELP?**

If you have trouble getting the QR code:
1. Make sure you have Node.js installed
2. Install Expo CLI: `npm install -g @expo/cli`
3. Navigate to KojoMobile folder
4. Run: `npx expo start --tunnel`

**The QR code will appear in your terminal and you can share a screenshot with your friends!**