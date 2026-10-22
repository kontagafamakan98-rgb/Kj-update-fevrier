# Application mobile (Capacitor) — ce qui marche, ce qui est bridé, et la mise en magasin

Document de passation du 22/10/2026. Il dit ce que l'app native FAIT, ce qu'elle
ne fait pas ENCORE et pourquoi, puis la procédure de publication qui reste à
faire (elle demande des comptes, une signature et une revue qui ne peuvent pas
être automatisés depuis le dépôt).

## 1. Ce que le dépôt construit déjà

- `frontend/capacitor.config.*` + `frontend/android/` + `frontend/ios/` :
  projets natifs générés par Capacitor, version alignée sur `@capacitor/*`.
- Le job CI `mobile-build` (`.github/workflows/ci.yml`) : contrôle des bits
  exécutables (`check-exec-bits.py`), `cap sync android`, puis
  `gradlew assembleDebug` (Java 21, SDK 36). Il prouve que **ça compile**, pas
  que ça fonctionne : aucun test d'exécution sur appareil, et aucun artefact
  publié.
- L'app charge le MÊME bundle que le web (`VITE_API_URL`), avec deux
  différences assumées :
  - pas de cookie de session fiable dans la WebView → le jeton est persisté
    côté natif (`isNativeShell`, `services/api.js`, `contexts/AuthContext.js`) ;
  - les URLs `http://localhost` sont traitées comme le shell natif
    (`utils/backendUrl.js`) pour que l'API distante reste la bonne.

## 2. Ce qui est BRIDÉ, et pourquoi

Un bridage est une décision, pas un oubli. Chaque ligne ci-dessous est portée
par du code ou par un test ; retirer le bridage exige de livrer la fonctionnalité
native correspondante.

| Fonction | État natif | Pourquoi | Où c'est dit |
| --- | --- | --- | --- |
| Push Web (`pushRegistration.js`) | **désactivé** | La WebView expose `serviceWorker`/`PushManager`/`Notification` (c'est Chromium), donc la détection par présence répondait « oui » alors qu'un push Web n'arrive jamais dans une WebView : la distribution native passe par FCM/APNs et un plugin. L'abonnement partait au backend et la permission était consommée pour rien. | `isPushSupported()` retourne `false` dans `isNativeShell()` **avant** toute demande de permission ; `src/utils/__tests__/pushRegistration.test.js` |
| Notifications in-app | **actives** | Elles passent par l'API et le panneau, pas par le Service Worker : elles ne dépendent pas du push. | `NotificationPanel`, `NotificationContext` |
| `/mobile-test` (diagnostic photo) | **absent en production** | Route et composant de développement, importés derrière `import.meta.env.DEV` ; la feuille ne contient même pas leurs classes (`@source not`). | `src/App.js`, `src/index.css` |
| Feuille de style et polices | **identiques au web** | Le build sert les mêmes actifs ; pas de surcharge native à maintenir. | `frontend/build` |

Ce qui n'est PAS bridé mais reste NON TESTÉ sur appareil : les gestes tactiles
(sondés sur Firefox/WebKit dans la CI, jamais sur un Android réel), le clavier
et les permissions système. Une publication en magasin doit s'accompagner d'une
passe sur un appareil physique.

## 3. Mise en magasin — la procédure qui reste

Rien de ce qui suit n'est exécutable depuis le dépôt seul. Les secrets de
signature ne doivent JAMAIS entrer dans le dépôt : ils vivent dans les secrets
GitHub (ou dans le coffre du propriétaire) et sont injectés au build release.

### 3.1 Android (Play Store)

1. **Clé de signature** (une seule fois, à conserver) :
   ```bash
   keytool -genkeypair -v -keystore kojo-release.keystore \
     -alias kojo -keyalg RSA -keysize 2048 -validity 10000
   ```
   Puis quatre secrets : `ANDROID_KEYSTORE_BASE64` (le fichier encodé),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
2. **Configuration de signature** : `frontend/android/app/build.gradle` doit
   lire ces valeurs d'environnement dans un `signingConfigs.release` et
   l'appliquer à `buildTypes.release` — le fichier n'est pas encore modifié,
   parce qu'un keystore absent ferait échouer `assembleDebug` en CI.
3. **Build release** :
   ```bash
   cd frontend
   npm ci
   VITE_API_URL=https://api.kojoforafrica.cc.cd npm run build
   npx cap sync android
   cd android && ./gradlew bundleRelease    # → app/build/outputs/bundle/release/app-release.aab
   ```
4. **Play Console** : créer l'app, remplir la fiche (titre, captures, politique
   de confidentialité — celle du site, `/privacy`), déclarer la sécurité des
   données (compte, position, photos), téléverser l'`.aab` en test interne,
   puis promouvoir en production après revue.
5. **Numéro de version** : `versionCode`/`versionName` dans
   `frontend/android/app/build.gradle` — à incrémenter à chaque envoi.

### 3.2 iOS (App Store)

1. Compte Apple Developer, certificat de distribution et profil de
   provisionnement (gérés par Xcode, pas par le dépôt).
2. `npx cap sync ios`, puis archive dans Xcode (`Product → Archive`) et envoi
   via App Store Connect.
3. Fiche App Store, politique de confidentialité, captures, revue.

### 3.3 Liens profonds (à faire AVANT la publication)

Un lien partagé `https://kojoforafrica.cc.cd/jobs/<id>` doit ouvrir la fiche
*dans l'app* quand elle est installée. Cela demande :

- Android : un `intent-filter` `VIEW`/`BROWSABLE` sur l'hôte du site dans
  `AndroidManifest.xml`, plus `assetlinks.json` servi sur
  `/.well-known/assetlinks.json` (empreinte SHA-256 de la clé de signature) ;
- iOS : `Associated Domains` (`applinks:kojoforafrica.cc.cd`) dans l'entité,
  plus `apple-app-site-association` au même endroit ;
- vérification réelle : ouvrir un lien depuis Messages/Chrome, pas seulement
  depuis `adb` (les deux échouent différemment).

Tant que ce n'est pas fait, un lien partagé ouvre le navigateur : c'est
acceptable, mais ce n'est pas « l'app installée ».

## 4. Ce qu'il faut vérifier sur un appareil avant de publier

- [ ] Connexion, rechargement de l'app, déconnexion (jeton natif).
- [ ] Publication d'une mission, candidature, envoi de message.
- [ ] Téléversement d'une photo (caméra et galerie) sur une mission terminée.
- [ ] Notifications in-app reçues pendant que l'app est au premier plan.
- [ ] Aucune erreur de console liée à `serviceWorker`/`PushManager` (le bridage
      doit être silencieux, pas bruyant).
- [ ] Retour matériel Android (ne doit pas fermer l'app depuis une fiche).
