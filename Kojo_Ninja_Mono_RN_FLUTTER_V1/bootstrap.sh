#!/bin/bash
echo "Bootstrap RN + Flutter pour Kojo"
cd apps/rn-app && npm install && npx react-native run-android
cd ../flutter-app && flutter pub get && flutter run
