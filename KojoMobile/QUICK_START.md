# 🚀 KOJO MOBILE - QUICK START GUIDE

## 📥 **AFTER DOWNLOADING THE KOJOMOBILE FOLDER**

### **Step 1: Open Terminal/Command Prompt**
Navigate to the KojoMobile folder:
```bash
cd path/to/KojoMobile
```

### **Step 2: Install Dependencies**
```bash
# Install Node.js dependencies
npm install

# Or if you have Yarn
yarn install
```

### **Step 3: Install Expo CLI (One-time setup)**
```bash
npm install -g @expo/cli
```

### **Step 4: Start Development Server**
```bash
# Start with tunnel (works from anywhere)
npx expo start --tunnel

# Or start locally (same WiFi network only)
npx expo start
```

### **Step 5: Share QR Code**
- QR code appears in terminal
- Screenshot and share with friends
- Friends install "Expo Go" app and scan QR

## 📱 **FOR YOUR FRIENDS**

**Android:**
1. Install "Expo Go" from Google Play Store
2. Open Expo Go → Scan QR Code
3. Scan your QR code → App loads!

**iPhone:**
1. Install "Expo Go" from App Store
2. Open Camera app → Point at QR code
3. Tap notification → Opens in Expo Go!

## 🐛 **TROUBLESHOOTING**

### **If "npm install" fails:**
```bash
# Clear cache and try again
npm cache clean --force
npm install
```

### **If Expo command not found:**
```bash
# Install Expo CLI globally
npm install -g @expo/cli

# Or use npx (no installation needed)
npx expo start --tunnel
```

### **If QR code doesn't work:**
- Make sure friends install "Expo Go" app
- Use `--tunnel` flag for internet access
- Share the exp:// URL as alternative

## 🎯 **BETA TESTING FEATURES**

Ask friends to test:
- ✅ Registration with country selection
- ✅ Job browsing and creation  
- ✅ Messaging system
- ✅ Profile management
- ✅ Language switching
- ✅ Camera features (real device only)
- ✅ GPS location (real device only)

## 📊 **COLLECT FEEDBACK**

Create simple feedback form:
1. Overall experience (1-5 stars)
2. What worked well?
3. What was confusing?
4. Any crashes or bugs?
5. Missing features?

---

**🎉 You're ready to beta test your Kojo mobile app! 🎉**