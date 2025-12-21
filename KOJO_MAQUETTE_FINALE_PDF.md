# 📱 KOJO - MAQUETTE FINALE DE L'APPLICATION
## Plateforme de Services en Afrique de l'Ouest

---

# 📑 TABLE DES MATIÈRES

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture technique](#2-architecture-technique)
3. [Pages principales](#3-pages-principales)
4. [Composants UX](#4-composants-ux)
5. [Système multilingue](#5-système-multilingue)
6. [Spécifications techniques](#6-spécifications-techniques)

---

# 1. VUE D'ENSEMBLE

## 🎯 Mission
**Kojo** est une plateforme de mise en relation entre **travailleurs qualifiés** et **clients** en Afrique de l'Ouest, couvrant 4 pays prioritaires avec support multilingue.

## 🌍 Couverture géographique

| Pays | Drapeau | Préfixe téléphone | Monnaie |
|------|---------|-------------------|---------|
| **Mali** | 🇲🇱 | +223 | FCFA |
| **Sénégal** | 🇸🇳 | +221 | FCFA |
| **Burkina Faso** | 🇧🇫 | +226 | FCFA |
| **Côte d'Ivoire** | 🇨🇮 | +225 | FCFA |

## 🗣️ Langues supportées
- 🇫🇷 **Français** (langue principale)
- 🇬🇧 **English** 
- 🇸🇳 **Wolof**
- 🇲🇱 **Bambara (Bamanankan)**

---

# 2. ARCHITECTURE TECHNIQUE

## Stack technologique

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND                                 │
│  React 18 + TailwindCSS + PWA + Service Worker              │
│  • Lazy loading routes                                       │
│  • Compression d'images client-side                          │
│  • Cache localStorage géolocalisation                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     BACKEND                                  │
│  FastAPI (Python) + JWT Authentication                       │
│  • API REST sécurisée                                        │
│  • Validation Pydantic                                       │
│  • Monitoring Sentry                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATABASE                                  │
│  MongoDB Atlas                                               │
│  • Collections: users, jobs, messages, reviews               │
└─────────────────────────────────────────────────────────────┘
```

## Intégrations paiement

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   ORANGE MONEY   │  │      WAVE        │  │  COMPTE BANCAIRE │
│  🟠 Mali         │  │  🔵 Sénégal      │  │  🏦 Tous pays     │
│  🟠 Sénégal      │  │  🔵 Mali         │  │                   │
│  🟠 Burkina      │  │  🔵 Côte d'Iv.   │  │                   │
│  🟠 Côte d'Iv.   │  │  🔵 Burkina      │  │                   │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

# 3. PAGES PRINCIPALES

## 📄 3.1 PAGE D'ACCUEIL (Home)

```
┌─────────────────────────────────────────────────────────────────┐
│  [K] Kojo          [🇫🇷 Français ▼]    [Connexion] [Inscription]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ╔═══════════════════════════════════════════════════════════╗  │
│  ║                                                            ║  │
│  ║     Connecter les travailleurs et clients                 ║  │
│  ║            en Afrique de l'Ouest                          ║  │
│  ║                                                            ║  │
│  ║  Trouvez des services de qualité ou offrez vos            ║  │
│  ║  compétences au Mali, Sénégal, Burkina Faso              ║  │
│  ║  et Côte d'Ivoire                                         ║  │
│  ║                                                            ║  │
│  ║  [Commencer maintenant]  [Voir les emplois]               ║  │
│  ║                                                            ║  │
│  ╚═══════════════════════════════════════════════════════════╝  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           📍 Disponible dans 4 pays                       │   │
│  │                                                           │   │
│  │   🇲🇱 Mali    🇸🇳 Sénégal   🇧🇫 Burkina   🇨🇮 Côte d'Iv.  │   │
│  │   Bamako      Dakar       Ouagadougou   Abidjan         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              🔧 Services populaires                       │   │
│  │                                                           │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │   │
│  │  │ 🔧      │ │ ⚡      │ │ 🪡      │ │ 🏗️      │        │   │
│  │  │Mécanique│ │Électric.│ │Couture  │ │Construct│        │   │
│  │  │  Moto   │ │         │ │Tradition│ │         │        │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              📊 Statistiques                              │   │
│  │                                                           │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │   │
│  │  │    500+     │ │   1,000+    │ │    10K+     │        │   │
│  │  │ Travailleurs│ │ Emplois créés│ │ Transactions│        │   │
│  │  │   actifs    │ │             │ │             │        │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📄 3.2 PAGE DE CONNEXION (Login)

```
┌─────────────────────────────────────────────────────────────────┐
│  [K] Kojo          [🇫🇷 Français ▼]    [Connexion] [Inscription]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                         ┌───────────┐                            │
│                         │    [K]    │                            │
│                         └───────────┘                            │
│                                                                  │
│                          Connexion                               │
│                                                                  │
│              ┌─────────────────────────────────┐                │
│              │                                 │                │
│              │  E-mail                         │                │
│              │  ┌───────────────────────────┐  │                │
│              │  │ exemple@email.com         │  │                │
│              │  └───────────────────────────┘  │                │
│              │                                 │                │
│              │  Mot de passe                   │                │
│              │  ┌───────────────────────────┐  │                │
│              │  │ ●●●●●●●●                  │  │                │
│              │  └───────────────────────────┘  │                │
│              │                                 │                │
│              │  ┌───────────────────────────┐  │                │
│              │  │      🔄 Connexion          │  │  ← LoadingButton
│              │  └───────────────────────────┘  │                │
│              │                                 │                │
│              │  Pas de compte ? Inscription    │                │
│              │                                 │                │
│              └─────────────────────────────────┘                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### États du bouton LoadingButton :

```
État normal :          État chargement :       État succès :
┌──────────────┐      ┌──────────────┐       ┌──────────────┐
│  Connexion   │  →   │   ⟳ ...      │   →   │   ✓ Fait!    │
└──────────────┘      └──────────────┘       └──────────────┘
```

---

## 📄 3.3 PAGE D'INSCRIPTION (Register)

```
┌─────────────────────────────────────────────────────────────────┐
│  [K] Kojo          [🇫🇷 Français ▼]    [Connexion] [Inscription]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                         ┌───────────┐                            │
│                         │    [K]    │                            │
│                         └───────────┘                            │
│                       Créer un compte                            │
│                  Rejoignez la communauté Kojo                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  📍 Position détectée: 🇸🇳 Sénégal                       │    │
│  │  Exemples et informations ajustés automatiquement       │    │
│  │                                                          │    │
│  │    ① Informations ────────────── ② Comptes de           │    │
│  │       personnelles                   paiement            │    │
│  │                                                          │    │
│  │  ⚠️ Prochaine étape : Vous devrez lier au moins         │    │
│  │  1 moyen de paiement (Orange Money, Wave, Banque)       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │  Type d'utilisateur                                      │    │
│  │  ┌─────────────────┐  ┌─────────────────┐               │    │
│  │  │      👤         │  │      🔧         │               │    │
│  │  │    Client       │  │   Travailleur   │               │    │
│  │  │ Je cherche des  │  │ Je propose mes  │               │    │
│  │  │   services      │  │   services      │               │    │
│  │  └─────────────────┘  └─────────────────┘               │    │
│  │                                                          │    │
│  │  Pays           📍 Détecté automatiquement               │    │
│  │  ┌─────────────────────────────────────────┐            │    │
│  │  │ 🇸🇳 Sénégal                           ▼ │            │    │
│  │  └─────────────────────────────────────────┘            │    │
│  │  🌍 Pays détecté via la géolocalisation                 │    │
│  │                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐               │    │
│  │  │ Prénom          │  │ Nom             │               │    │
│  │  │ ┌─────────────┐ │  │ ┌─────────────┐ │               │    │
│  │  │ │ Amadou      │ │  │ │ Traoré      │ │               │    │
│  │  │ └─────────────┘ │  │ └─────────────┘ │               │    │
│  │  └─────────────────┘  └─────────────────┘               │    │
│  │                                                          │    │
│  │  E-mail                                                  │    │
│  │  ┌─────────────────────────────────────────┐            │    │
│  │  │ amadou.traore@email.com                 │            │    │
│  │  └─────────────────────────────────────────┘            │    │
│  │                                                          │    │
│  │  Téléphone                                               │    │
│  │  ┌───────┐ ┌───────────────────────────────┐            │    │
│  │  │ +221  │ │ 77 123 45 67                  │            │    │
│  │  └───────┘ └───────────────────────────────┘            │    │
│  │  Format: +221 XX XXX XX XX                               │    │
│  │                                                          │    │
│  │  Mot de passe                                            │    │
│  │  ┌─────────────────────────────────────────┐            │    │
│  │  │ ●●●●●●●●                                │            │    │
│  │  └─────────────────────────────────────────┘            │    │
│  │  Au moins 6 caractères                                   │    │
│  │                                                          │    │
│  │  Confirmer le mot de passe                               │    │
│  │  ┌─────────────────────────────────────────┐            │    │
│  │  │ ●●●●●●●●                                │            │    │
│  │  └─────────────────────────────────────────┘            │    │
│  │                                                          │    │
│  │  ┌─────────────────────────────────────────┐            │    │
│  │  │     Continuer vers vérification         │            │    │
│  │  └─────────────────────────────────────────┘            │    │
│  │                                                          │    │
│  │  Vous avez déjà un compte ? Connexion                   │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📄 3.4 PAGE DE VÉRIFICATION PAIEMENT

```
┌─────────────────────────────────────────────────────────────────┐
│  [K] Kojo          [🇫🇷 Français ▼]    [Connexion] [Inscription]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    Vérification des comptes                      │
│                       de paiement                                │
│                                                                  │
│    ① Informations ────────────── ② Comptes de                   │
│       personnelles    ✓              paiement  ●                 │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │  Sélectionnez au moins un moyen de paiement              │    │
│  │                                                          │    │
│  │  ┌───────────────────────────────────────────────────┐  │    │
│  │  │  🟠 Orange Money                                    │  │    │
│  │  │                                                     │  │    │
│  │  │  Numéro Orange Money                                │  │    │
│  │  │  ┌─────────────────────────────────────────────┐   │  │    │
│  │  │  │ +221 77 123 45 67                           │   │  │    │
│  │  │  └─────────────────────────────────────────────┘   │  │    │
│  │  │                                                     │  │    │
│  │  │  Nom du titulaire                                   │  │    │
│  │  │  ┌─────────────────────────────────────────────┐   │  │    │
│  │  │  │ Amadou Traoré                               │   │  │    │
│  │  │  └─────────────────────────────────────────────┘   │  │    │
│  │  └───────────────────────────────────────────────────┘  │    │
│  │                                                          │    │
│  │  ┌───────────────────────────────────────────────────┐  │    │
│  │  │  🔵 Wave                                            │  │    │
│  │  │                                                     │  │    │
│  │  │  Numéro Wave                                        │  │    │
│  │  │  ┌─────────────────────────────────────────────┐   │  │    │
│  │  │  │ +221 78 456 78 90                           │   │  │    │
│  │  │  └─────────────────────────────────────────────┘   │  │    │
│  │  └───────────────────────────────────────────────────┘  │    │
│  │                                                          │    │
│  │  ┌───────────────────────────────────────────────────┐  │    │
│  │  │  🏦 Compte bancaire                                 │  │    │
│  │  │                                                     │  │    │
│  │  │  Nom de la banque                                   │  │    │
│  │  │  ┌─────────────────────────────────────────────┐   │  │    │
│  │  │  │ Banque de l'Habitat du Mali                 │   │  │    │
│  │  │  └─────────────────────────────────────────────┘   │  │    │
│  │  │                                                     │  │    │
│  │  │  Numéro de compte / IBAN                            │  │    │
│  │  │  ┌─────────────────────────────────────────────┐   │  │    │
│  │  │  │ ML13 1234 5678 9012 3456 7890                │   │  │    │
│  │  │  └─────────────────────────────────────────────┘   │  │    │
│  │  └───────────────────────────────────────────────────┘  │    │
│  │                                                          │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │         ✓ Créer mon compte                       │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📄 3.5 TABLEAU DE BORD (Dashboard)

```
┌─────────────────────────────────────────────────────────────────┐
│  [K] Kojo    [Dashboard] [Emplois] [Messages] [Profil]   [👤]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  👋 Bienvenue, Amadou !                                  │    │
│  │                                                          │    │
│  │  Voici votre activité récente sur Kojo                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐ │
│  │   📋 12      │ │   ✅ 45      │ │   📊 57      │ │💰150,000│ │
│  │  Jobs actifs │ │Jobs terminés │ │  Total Jobs  │ │ FCFA   │ │
│  │              │ │              │ │              │ │ Gains  │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  ⚡ Actions rapides                                    │       │
│  │                                                        │       │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │       │
│  │  │ + Créer     │  │ 🔍 Trouver  │  │ 💬 Messages │   │       │
│  │  │   un job    │  │  travailleurs│  │             │   │       │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  🏷️ Catégories populaires                             │       │
│  │                                                        │       │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │       │
│  │  │🔧 Méca. │ │⚡ Élec. │ │🪡 Couture│ │🏗️ Const.│     │       │
│  │  │  Moto   │ │         │ │  Trad.  │ │         │     │       │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘     │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  📋 Mes emplois récents                               │       │
│  │                                                        │       │
│  │  ┌────────────────────────────────────────────────┐   │       │
│  │  │ 🔧 Réparation moto          📍 Dakar           │   │       │
│  │  │ Client: Fatou Diop          💰 15,000 FCFA     │   │       │
│  │  │ Statut: ● En cours                              │   │       │
│  │  └────────────────────────────────────────────────┘   │       │
│  │                                                        │       │
│  │  ┌────────────────────────────────────────────────┐   │       │
│  │  │ ⚡ Installation solaire     📍 Bamako          │   │       │
│  │  │ Client: Ibrahim Keita       💰 50,000 FCFA     │   │       │
│  │  │ Statut: ✅ Terminé                              │   │       │
│  │  └────────────────────────────────────────────────┘   │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📄 3.6 PAGE EMPLOIS (Jobs)

```
┌─────────────────────────────────────────────────────────────────┐
│  [K] Kojo    [Dashboard] [Emplois] [Messages] [Profil]   [👤]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────┐                                               │
│  │ + Créer un job │                                              │
│  └───────────────┘                                               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  🔍 Filtres                                                │   │
│  │                                                            │   │
│  │  Catégorie      Pays           Ville          Statut      │   │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   │   │
│  │  │ Tous  ▼│   │ Tous  ▼│   │ Tous  ▼│   │ Tous  ▼│   │   │
│  │  └─────────┘   └─────────┘   └─────────┘   └─────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ 🔧 Réparation moto Honda                           │   │   │
│  │  │                                                     │   │   │
│  │  │ 📍 Dakar, Sénégal                                  │   │   │
│  │  │ 📅 Créé il y a 2 heures                            │   │   │
│  │  │ 💰 15,000 - 25,000 FCFA                            │   │   │
│  │  │                                                     │   │   │
│  │  │ Description: Ma moto ne démarre plus depuis hier.  │   │   │
│  │  │ Besoin d'un mécanicien expérimenté.                │   │   │
│  │  │                                                     │   │   │
│  │  │ 🔧 Outils requis: Clés, Multimètre                 │   │   │
│  │  │ 🔩 Pièces possibles: Bougie, Batterie              │   │   │
│  │  │                                                     │   │   │
│  │  │ ┌────────────────┐                                 │   │   │
│  │  │ │ Postuler       │                                 │   │   │
│  │  │ └────────────────┘                                 │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │                                                            │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ ⚡ Installation panneau solaire                     │   │   │
│  │  │                                                     │   │   │
│  │  │ 📍 Bamako, Mali                                    │   │   │
│  │  │ 📅 Créé il y a 1 jour                              │   │   │
│  │  │ 💰 50,000 - 100,000 FCFA                           │   │   │
│  │  │                                                     │   │   │
│  │  │ Description: Installation complète de panneaux     │   │   │
│  │  │ solaires pour maison de 4 pièces.                  │   │   │
│  │  │                                                     │   │   │
│  │  │ ┌────────────────┐                                 │   │   │
│  │  │ │ Postuler       │                                 │   │   │
│  │  │ └────────────────┘                                 │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │                                                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📄 3.7 PAGE MESSAGES

```
┌─────────────────────────────────────────────────────────────────┐
│  [K] Kojo    [Dashboard] [Emplois] [Messages] [Profil]   [👤]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────┐ ┌───────────────────────────────────┐   │
│  │  Conversations     │ │  💬 Fatou Diop                     │   │
│  │                    │ │                                     │   │
│  │  ┌──────────────┐  │ │  ┌─────────────────────────────┐   │   │
│  │  │ 👤 Fatou D.  │  │ │  │ 👤 Bonjour! Je suis         │   │   │
│  │  │ Réparation.. │  │ │  │    intéressée par votre     │   │   │
│  │  │ Il y a 5 min │  │ │  │    service de réparation.   │   │   │
│  │  └──────────────┘  │ │  └─────────────────────────────┘   │   │
│  │                    │ │                                     │   │
│  │  ┌──────────────┐  │ │  ┌─────────────────────────────┐   │   │
│  │  │ 👤 Ibrahim K.│  │ │  │        Bien sûr! Je peux    │👤│   │
│  │  │ Installation.│  │ │  │        passer demain matin. │   │   │
│  │  │ Hier         │  │ │  └─────────────────────────────┘   │   │
│  │  └──────────────┘  │ │                                     │   │
│  │                    │ │  ┌─────────────────────────────┐   │   │
│  │  ┌──────────────┐  │ │  │ 👤 Parfait! À quelle heure  │   │   │
│  │  │ 👤 Moussa T. │  │ │  │    pouvez-vous venir?       │   │   │
│  │  │ Couture..    │  │ │  └─────────────────────────────┘   │   │
│  │  │ 3 jours      │  │ │                                     │   │
│  │  └──────────────┘  │ │  ┌─────────────────────────────────┐│   │
│  │                    │ │  │ Tapez votre message...      [📤]││   │
│  │                    │ │  └─────────────────────────────────┘│   │
│  └────────────────────┘ └───────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📄 3.8 PAGE PROFIL

```
┌─────────────────────────────────────────────────────────────────┐
│  [K] Kojo    [Dashboard] [Emplois] [Messages] [Profil]   [👤]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ████████████████████████████████████████████████████   │   │
│  │  ██                                                  ██   │   │
│  │  ██   ┌────────┐                                     ██   │   │
│  │  ██   │  👤    │   Amadou Traoré                     ██   │   │
│  │  ██   │  Photo │   Travailleur • 🇸🇳 Sénégal         ██   │   │
│  │  ██   └────────┘   ★★★★☆ 4.5/5 (23 avis)            ██   │   │
│  │  ██                                                  ██   │   │
│  │  ████████████████████████████████████████████████████   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  📋 Informations personnelles                  [Modifier] │   │
│  │                                                            │   │
│  │  E-mail           │  Téléphone                             │   │
│  │  amadou@email.com │  +221 77 123 45 67                     │   │
│  │                   │                                         │   │
│  │  Langue préférée  │  Vérifié                               │   │
│  │  Français         │  ✅ Oui                                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  💳 Comptes de paiement                                   │   │
│  │                                                            │   │
│  │  ┌─────────────────────────────────────────────────┐     │   │
│  │  │ 🟠 Orange Money: +221 77 123 45 67  ✅ Vérifié   │     │   │
│  │  └─────────────────────────────────────────────────┘     │   │
│  │                                                            │   │
│  │  ┌─────────────────────────────────────────────────┐     │   │
│  │  │ 🔵 Wave: +221 78 456 78 90  ✅ Vérifié           │     │   │
│  │  └─────────────────────────────────────────────────┘     │   │
│  │                                                            │   │
│  │  ┌─────────────────────────┐                              │   │
│  │  │ + Ajouter un compte     │                              │   │
│  │  └─────────────────────────┘                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

# 4. COMPOSANTS UX

## 🔔 4.1 Système de Toast Notifications

```
Position: Coin supérieur droit

Toast Succès (vert):
┌─────────────────────────────────┐
│ ✅ Connexion réussie ! 🎉        │
└─────────────────────────────────┘

Toast Erreur (rouge):
┌─────────────────────────────────┐
│ ❌ Mot de passe incorrect        │
└─────────────────────────────────┘

Toast Avertissement (orange):
┌─────────────────────────────────┐
│ ⚠️ Veuillez remplir tous les    │
│    champs requis                 │
└─────────────────────────────────┘

Toast Info (bleu):
┌─────────────────────────────────┐
│ ℹ️ Chargement en cours...        │
└─────────────────────────────────┘
```

## ⏳ 4.2 Loading States

### LoadingSpinner
```
┌─────────────────┐
│                 │
│      ⟳         │
│   Chargement... │
│                 │
└─────────────────┘
```

### Skeleton Loader (pour listes)
```
┌─────────────────────────────────────┐
│ ████████████████████░░░░░░░░░░░░░░░ │
│ ████████████░░░░░░░░░░░░░░░░░░░░░░░ │
│ ████████████████████████░░░░░░░░░░░ │
└─────────────────────────────────────┘
```

### LoadingButton
```
État normal:        État chargement:     État désactivé:
┌──────────┐       ┌──────────┐        ┌──────────┐
│ Envoyer  │  →    │   ⟳     │   →    │ Envoyé ✓ │
└──────────┘       └──────────┘        └──────────┘
```

---

# 5. SYSTÈME MULTILINGUE

## Traductions principales

| Clé | 🇫🇷 Français | 🇬🇧 English | 🇸🇳 Wolof | 🇲🇱 Bambara |
|-----|-------------|------------|----------|------------|
| `login` | Connexion | Login | Dugg | Don |
| `register` | Inscription | Sign Up | Bind ak tëdd | Tɔgɔ sɛbɛn |
| `dashboard` | Tableau de bord | Dashboard | Pañ yi | Ɲɛtaa |
| `jobs` | Emplois | Jobs | Liggéey | Baara |
| `messages` | Messages | Messages | Bataaxal | Kibaru |
| `profile` | Profil | Profile | Sañ-sañu | Kunnafoni |
| `getStarted` | Commencer maintenant | Get Started Now | Tambali leegi | A daminɛ sisan |
| `viewJobs` | Voir les emplois | View Jobs | Gis liggéey yi | Baara filɛ |
| `availableIn4Countries` | Disponible dans 4 pays | Available in 4 countries | Am ci 4 réew | Bɛ jamana 4 |
| `connectWorkersClients` | Connecter les travailleurs et clients en Afrique de l'Ouest | Connect Workers and Clients in West Africa | Jëmmel liggéeykat ak kliyan ci Afrik bu Sowwu | Baarakɛlaw ni kiliyanw jɛɲɔgɔnya Afiriki Kɔrɔn fɛ |

---

# 6. SPÉCIFICATIONS TECHNIQUES

## 📱 6.1 Responsive Design

```
Mobile (< 640px):     Tablet (640-1024px):    Desktop (> 1024px):
┌───────────────┐    ┌─────────────────────┐  ┌───────────────────────────┐
│ [K] Kojo [≡]  │    │ [K] Kojo    [Conn] │  │ [K] Kojo   [A][B][C] [👤] │
├───────────────┤    ├─────────────────────┤  ├───────────────────────────┤
│               │    │                     │  │ ┌───────┐ ┌───────────────┐│
│   Contenu     │    │      Contenu        │  │ │ Menu  │ │    Contenu    ││
│   empilé      │    │      2 colonnes     │  │ │       │ │   3 colonnes  ││
│               │    │                     │  │ └───────┘ └───────────────┘│
└───────────────┘    └─────────────────────┘  └───────────────────────────┘
```

## ⚡ 6.2 Performance

| Métrique | Objectif | Actuel |
|----------|----------|--------|
| **First Contentful Paint** | < 2s | 0.78s ✅ |
| **Time to Interactive** | < 3s | 1.2s ✅ |
| **Géolocalisation** | < 5s | 2.95s ✅ |
| **Cache localStorage** | 30 min TTL | ✅ |

## 🔒 6.3 Sécurité

- ✅ JWT Authentication (24h expiration)
- ✅ Validation Pydantic côté backend
- ✅ Sanitisation des entrées
- ✅ HTTPS obligatoire
- ✅ Rate limiting API
- ✅ Monitoring Sentry

---

# 📎 ANNEXES

## A. Palette de couleurs

| Élément | Couleur | Code |
|---------|---------|------|
| **Primaire** | Orange | `#EA580C` |
| **Succès** | Vert | `#22C55E` |
| **Erreur** | Rouge | `#EF4444` |
| **Avertissement** | Jaune | `#F59E0B` |
| **Info** | Bleu | `#3B82F6` |
| **Texte** | Gris foncé | `#111827` |
| **Fond** | Gris clair | `#F9FAFB` |

## B. Typographie

| Élément | Taille | Poids |
|---------|--------|-------|
| **H1** | 3rem (48px) | Bold |
| **H2** | 1.875rem (30px) | Semibold |
| **H3** | 1.5rem (24px) | Medium |
| **Body** | 1rem (16px) | Normal |
| **Small** | 0.875rem (14px) | Normal |
| **Caption** | 0.75rem (12px) | Normal |

---

## 📞 Contact

**Kojo - Plateforme de Services Afrique de l'Ouest**

- 🌐 Website: kojo.app
- 📧 Email: contact@kojo.app
- 📱 Téléphone: +221 77 XXX XX XX

---

*Document généré le : Décembre 2025*
*Version : 2.0 - Maquette Finale*

---

# 🎯 GUIDE DE CONVERSION EN PDF

Pour convertir ce document Markdown en PDF professionnel:

## Option 1: Pandoc (recommandé)
```bash
pandoc KOJO_MAQUETTE_FINALE_PDF.md -o KOJO_MAQUETTE_FINALE.pdf \
  --pdf-engine=xelatex \
  --variable geometry:margin=1in \
  --variable fontsize=11pt
```

## Option 2: Extension VS Code
1. Installer "Markdown PDF" extension
2. Ouvrir ce fichier
3. Clic droit → "Markdown PDF: Export (pdf)"

## Option 3: En ligne
1. Visiter https://www.markdowntopdf.com/
2. Coller le contenu
3. Télécharger le PDF

---

**© 2025 Kojo. Tous droits réservés.**
