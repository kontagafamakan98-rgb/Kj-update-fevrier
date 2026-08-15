# 📊 Guide de Configuration Sentry pour Kojo PWA

Sentry est un outil de monitoring d'erreurs qui permet de tracker et déboguer les problèmes en production.

## 🔧 Configuration (Optionnelle)

### Étape 1: Créer un Compte Sentry

1. Aller sur [sentry.io](https://sentry.io)
2. Créer un compte gratuit (10,000 événements/mois inclus)
3. Créer un nouveau projet "React"
4. Copier votre **DSN** (Data Source Name)

### Étape 2: Installer le Package

```bash
cd /app/frontend
yarn add @sentry/react
```

### Étape 3: Configurer les Variables d'Environnement

Ajouter dans `/app/frontend/.env`:

```bash
# Sentry Configuration (Optionnel)
REACT_APP_SENTRY_ENABLED=true
REACT_APP_SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
REACT_APP_VERSION=1.0.0
```

### Étape 4: Initialiser Sentry

Le code est déjà prêt ! Sentry sera automatiquement initialisé au démarrage de l'application.

Fichier: `/app/frontend/src/index.js`

```javascript
import { initSentry } from './utils/sentry';

// Initialiser Sentry en premier
initSentry();
```

### Étape 5: Redémarrer l'Application

```bash
sudo supervisorctl restart frontend
```

---

## 📈 Utilisation

### Capturer une Erreur Manuellement

```javascript
import { captureError } from '../utils/sentry';

try {
  // Votre code
} catch (error) {
  captureError(error, {
    component: 'ProfilePage',
    action: 'uploadPhoto'
  });
}
```

### Capturer un Message

```javascript
import { captureMessage } from '../utils/sentry';

captureMessage('Paiement effectué avec succès', 'info');
```

### Définir le Contexte Utilisateur

```javascript
import { setUser } from '../utils/sentry';

// Après connexion
setUser({
  id: user.id,
  email: user.email,
  country: user.country
});
```

### Ajouter un Breadcrumb

```javascript
import { addBreadcrumb } from '../utils/sentry';

addBreadcrumb('User clicked on create job button', 'user-action', 'info', {
  job_type: 'electricien'
});
```

---

## 🎯 Fonctionnalités Configurées

### ✅ Optimisations pour l'Afrique de l'Ouest

- **Filtrage des erreurs réseau:** Les erreurs de connexion 2G/3G sont ignorées automatiquement
- **Sample rate réduit:** Seulement 10% des transactions sont envoyées (économie de quota)
- **Breadcrumbs limités:** Max 50 breadcrumbs pour garder le contexte pertinent

### ✅ Intégrations Activées

- **Browser Tracing:** Suivi des performances frontend
- **Session Replay:** Enregistrement des sessions (avec masquage des données sensibles)
- **Breadcrumbs:** Historique des actions utilisateur

### ✅ Erreurs Ignorées

- Erreurs réseau (timeout, fetch failed)
- Erreurs non-critiques (ResizeObserver)
- Erreurs de sécurité (CORS, SecurityError)

---

## 🔍 Dashboard Sentry

Une fois configuré, vous pouvez:

1. **Voir les erreurs en temps réel**
2. **Analyser les stack traces**
3. **Voir les breadcrumbs** (actions de l'utilisateur)
4. **Monitorer les performances**
5. **Revoir les sessions** avec Session Replay

---

## 💡 Bonnes Pratiques

### DO ✅
- Capturer les erreurs critiques (paiements, authentification)
- Ajouter du contexte aux erreurs (composant, action)
- Définir le contexte utilisateur après connexion
- Utiliser les breadcrumbs pour tracer les actions

### DON'T ❌
- Ne pas capturer les erreurs de validation de formulaire
- Ne pas logger les données sensibles (mots de passe, tokens)
- Ne pas capturer les erreurs réseau courantes en 2G/3G
- Ne pas activer en développement (seulement production)

---

## 🆓 Plan Gratuit Sentry

Le plan gratuit inclut:
- ✅ 10,000 événements/mois
- ✅ 1 projet
- ✅ Rétention de 30 jours
- ✅ Session Replay (1,000 sessions/mois)
- ✅ Performance Monitoring

**Largement suffisant pour une application de taille moyenne !**

---

## 🚫 Désactiver Sentry

Pour désactiver Sentry:

1. **Option 1:** Dans `.env`, mettre `REACT_APP_SENTRY_ENABLED=false`
2. **Option 2:** Supprimer complètement les variables Sentry du `.env`

L'application continuera de fonctionner normalement sans Sentry.

---

## 📝 Notes Importantes

- **Sentry est OPTIONNEL** - L'application fonctionne parfaitement sans
- **Configuration désactivée par défaut** - Aucune donnée n'est envoyée sans votre consentement
- **Respecte la vie privée** - Les données sensibles sont automatiquement masquées
- **Adapté à l'Afrique de l'Ouest** - Ignore les erreurs réseau courantes

---

## 🆘 Support

- Documentation Sentry: https://docs.sentry.io/platforms/javascript/guides/react/
- Dashboard Sentry: https://sentry.io
- Status: https://status.sentry.io

---

**Configuration actuelle:** ❌ Désactivé (à activer manuellement si nécessaire)
