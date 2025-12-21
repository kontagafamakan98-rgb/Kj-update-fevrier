# 📱 KOJO - MAQUETTES APPLICATION MOBILE
## Design & Wireframes Complets - Progressive Web App

**Version :** 1.0  
**Date :** Janvier 2025  
**Plateforme :** Progressive Web App (iOS + Android)  
**Résolution de référence :** 375x812px (iPhone X)

---

# TABLE DES MATIÈRES

1. [Charte Graphique](#charte-graphique)
2. [Architecture de l'Application](#architecture)
3. [Écrans Client](#écrans-client)
4. [Écrans Professionnel](#écrans-professionnel)
5. [Composants Réutilisables](#composants)
6. [Flux Utilisateur](#flux)

---

# 1. CHARTE GRAPHIQUE

## Palette de Couleurs

```
COULEURS PRINCIPALES
├─ Orange Primary:    #FF6B35  (CTA, liens, accents)
├─ Orange Secondary:  #FF8C42  (hover, backgrounds légers)
├─ Gold Accent:       #FFD700  (badges, certifications)
└─ White:            #FFFFFF  (backgrounds)

COULEURS TEXTE
├─ Dark Primary:      #2C3E50  (titres, texte important)
├─ Gray Medium:       #7F8C8D  (texte secondaire)
├─ Gray Light:        #BDC3C7  (borders, dividers)
└─ White:            #FFFFFF  (texte sur dark bg)

COULEURS STATUS
├─ Success:          #27AE60  (validations, succès)
├─ Error:            #E74C3C  (erreurs, alertes)
├─ Warning:          #F39C12  (avertissements)
└─ Info:             #3498DB  (informations)

GRADIENTS
├─ Primary Gradient:  linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%)
└─ Dark Gradient:     linear-gradient(135deg, #2C3E50 0%, #34495E 100%)
```

## Typographie

```
POLICES
├─ Titres (H1-H3):    Montserrat Bold
├─ Sous-titres (H4-H6): Montserrat SemiBold
├─ Corps de texte:    Open Sans Regular
└─ Chiffres/Prix:     Roboto Mono Medium

TAILLES
├─ H1:  28px / 32px line-height (Bold)
├─ H2:  24px / 28px (Bold)
├─ H3:  20px / 24px (SemiBold)
├─ H4:  18px / 22px (SemiBold)
├─ Body: 16px / 24px (Regular)
└─ Small: 14px / 20px (Regular)
```

## Espacements & Grille

```
SPACING SCALE (8px base)
├─ xs:   4px
├─ sm:   8px
├─ md:   16px
├─ lg:   24px
├─ xl:   32px
└─ 2xl:  48px

GRILLE
├─ Colonnes:    12
├─ Gutter:      16px
├─ Margin:      20px
└─ Max width:   428px (mobile)
```

## Icônes & Assets

```
STYLE D'ICÔNES
├─ Style:        Line icons (outline)
├─ Stroke:       2px
├─ Tailles:      16px, 24px, 32px, 48px
└─ Bibliothèque: Heroicons / Feather Icons

ÉLÉMENTS VISUELS
├─ Border radius: 8px (standard), 16px (cards), 24px (buttons)
├─ Shadows:      0 2px 8px rgba(0,0,0,0.1) (light)
│                0 4px 16px rgba(0,0,0,0.15) (medium)
└─ Transitions:  0.3s ease-in-out
```

---

# 2. ARCHITECTURE DE L'APPLICATION

## Navigation Principale

```
┌─────────────────────────────────┐
│         TOP BAR                 │
│  [Logo]  Kojo    [🔔] [👤]     │
└─────────────────────────────────┘
│                                 │
│                                 │
│        CONTENU PRINCIPAL        │
│                                 │
│                                 │
│                                 │
└─────────────────────────────────┘
│    BOTTOM NAVIGATION (CLIENT)   │
│  [🏠]  [🔍]  [💬]  [👤]        │
└─────────────────────────────────┘
```

## Structure de Navigation

```
CLIENT
├─ Accueil (🏠)
│  ├─ Recherche rapide
│  ├─ Catégories
│  └─ Recommandations
├─ Explorer (🔍)
│  ├─ Tous les services
│  ├─ Filtres
│  └─ Carte
├─ Mes Réservations (📋)
│  ├─ En cours
│  ├─ Historique
│  └─ Annulées
├─ Messages (💬)
│  ├─ Conversations
│  └─ Notifications
└─ Profil (👤)
   ├─ Informations
   ├─ Moyens de paiement
   ├─ Historique
   └─ Paramètres

PROFESSIONNEL
├─ Dashboard (📊)
│  ├─ Statistiques
│  ├─ Revenus
│  └─ Notation
├─ Demandes (📥)
│  ├─ Nouvelles
│  ├─ Acceptées
│  └─ En cours
├─ Calendrier (📅)
│  ├─ Vue semaine
│  └─ Vue mois
├─ Messages (💬)
└─ Profil Pro (👤)
   ├─ Portfolio
   ├─ Tarifs
   ├─ Disponibilités
   └─ Statistiques
```

---

# 3. ÉCRANS CLIENT

## 3.1 Splash Screen

```
┌───────────────────────────────────┐
│                                   │
│                                   │
│           [LOGO KOJO]             │
│         Grande taille             │
│                                   │
│       "La marketplace de          │
│      confiance pour tous vos      │
│     besoins professionnels"       │
│                                   │
│         ⚡ Chargement...          │
│                                   │
│                                   │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Logo: 120x120px, centré
- Tagline: 16px, Open Sans, #7F8C8D
- Animation: Fade in du logo
- Durée: 2 secondes max
- Background: Gradient orange (#FF6B35 → #FF8C42)
```

## 3.2 Onboarding (3 écrans)

### Écran 1/3
```
┌───────────────────────────────────┐
│                            [Skip] │
│                                   │
│      [ILLUSTRATION]               │
│    Trouver des pros en            │
│        3 secondes                 │
│                                   │
│  Recherchez parmi 1000+           │
│  professionnels vérifiés          │
│  près de chez vous                │
│                                   │
│         ● ○ ○                     │
│                                   │
│       [SUIVANT →]                 │
└───────────────────────────────────┘
```

### Écran 2/3
```
┌───────────────────────────────────┐
│                            [Skip] │
│                                   │
│      [ILLUSTRATION]               │
│    Payez en toute sécurité        │
│                                   │
│  Orange Money, Wave, Moov...      │
│  Tous vos moyens de paiement      │
│  favoris disponibles              │
│                                   │
│         ○ ● ○                     │
│                                   │
│       [SUIVANT →]                 │
└───────────────────────────────────┘
```

### Écran 3/3
```
┌───────────────────────────────────┐
│                                   │
│      [ILLUSTRATION]               │
│    Garantie satisfaction          │
│                                   │
│  Tous nos pros sont vérifiés.     │
│  Travail garanti ou remboursé.    │
│                                   │
│         ○ ○ ●                     │
│                                   │
│    [COMMENCER →]                  │
└───────────────────────────────────┘
```

## 3.3 Inscription / Connexion

### Choix Type de Compte
```
┌───────────────────────────────────┐
│         [← Retour]                │
│                                   │
│      Bienvenue sur Kojo ! 👋      │
│                                   │
│   Comment souhaitez-vous          │
│   utiliser Kojo ?                 │
│                                   │
│  ┌─────────────────────────────┐ │
│  │         👤 CLIENT            │ │
│  │  Je cherche des pros         │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │      🔧 PROFESSIONNEL        │ │
│  │  Je propose mes services     │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Cards: Background blanc, border 2px #E0E0E0
- Hover: Border orange #FF6B35
- Shadow: 0 2px 8px rgba(0,0,0,0.1)
- Padding: 24px
- Icon size: 48px
```

### Connexion
```
┌───────────────────────────────────┐
│         [← Retour]                │
│                                   │
│      Bon retour ! 😊              │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 📧 Email                     │ │
│  │ exemple@email.com      [x]   │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 🔒 Mot de passe              │ │
│  │ ••••••••••           [👁]    │ │
│  └─────────────────────────────┘ │
│                                   │
│            Mot de passe oublié ?  │
│                                   │
│  ┌─────────────────────────────┐ │
│  │      SE CONNECTER            │ │
│  └─────────────────────────────┘ │
│                                   │
│    Pas encore de compte ?         │
│         S'inscrire                │
│                                   │
│  ─────── ou ───────              │
│                                   │
│  [🍊 Orange Money] [💳 Wave]     │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Input height: 56px
- Border radius: 12px
- Border: 1px #BDC3C7, focus: 2px #FF6B35
- Icon size: 20px, color #7F8C8D
- Button: Full width, height 56px, gradient orange
- Links: #FF6B35, underline on hover
```

### Inscription Client
```
┌───────────────────────────────────┐
│         [← Retour]                │
│    Créer votre compte client      │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 👤 Prénom                    │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 👤 Nom                       │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 📧 Email                     │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 📱 Téléphone                 │ │
│  │ +221 |                       │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 🔒 Mot de passe              │ │
│  └─────────────────────────────┘ │
│                                   │
│  ☐ J'accepte les conditions      │
│     d'utilisation                 │
│                                   │
│  ┌─────────────────────────────┐ │
│  │      S'INSCRIRE              │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

## 3.4 Accueil Client

```
┌───────────────────────────────────┐
│ [≡] Kojo              [🔔] [👤]  │
├───────────────────────────────────┤
│                                   │
│  Bonjour Aminata ! 👋             │
│  Quel service cherchez-vous ?     │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 🔍 Rechercher un service... │ │
│  │                        [📍] │ │
│  └─────────────────────────────┘ │
│                                   │
│  Services populaires              │
│  ───────────────────────          │
│  [⚡] [🚰] [🔧] [🎨] [📡] →      │
│  Élec  Plomb Méca Peint Clim      │
│                                   │
│  Pros près de chez vous   [Voir +]│
│  ───────────────────────          │
│  ┌───────────────────┐            │
│  │ [PHOTO] Moussa S. │ ⭐ 4.8     │
│  │ Électricien       │ 47 avis    │
│  │ 📍 2.3 km         │ Dispo      │
│  └───────────────────┘            │
│                                   │
│  ┌───────────────────┐            │
│  │ [PHOTO] Fatou B.  │ ⭐ 4.9     │
│  │ Plombière         │ 89 avis    │
│  │ 📍 1.8 km         │ Dispo      │
│  └───────────────────┘            │
│                                   │
│  Vos réservations                 │
│  ───────────────────────          │
│  ┌─────────────────────────────┐ │
│  │ ⚡ Réparation électrique     │ │
│  │ Moussa S. • Aujourd'hui 14h  │ │
│  │ [VOIR DÉTAILS]               │ │
│  └─────────────────────────────┘ │
│                                   │
├───────────────────────────────────┤
│  [🏠] [🔍] [📋] [💬] [👤]        │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Header: Height 64px, background white, shadow
- Search bar: Height 48px, radius 24px
- Service icons: 64x64px, circular background
- Pro cards: Height 120px, padding 12px
- Badge "Dispo": Green #27AE60, 8px radius
- Bottom nav: Height 64px, icons 24px
```

## 3.5 Recherche / Explorer

```
┌───────────────────────────────────┐
│ [←] Rechercher         [⚙️ Filtres]│
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │ 🔍 Électricien         [x]  │ │
│  └─────────────────────────────┘ │
│                                   │
│  [🗺️ Carte] [📋 Liste]            │
│                                   │
│  ⚙️ Filtres actifs:               │
│  [📍 < 5km] [⭐ 4.5+] [💰 0-25K] │
│                                   │
│  127 professionnels trouvés       │
│  ───────────────────────          │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO]  Moussa Sarr         │ │
│  │          ⭐ 4.8 (47 avis)    │ │
│  │                              │ │
│  │ 📍 Dakar Plateau • 2.3 km    │ │
│  │ 💼 8 ans d'expérience        │ │
│  │ 💰 À partir de 15 000 FCFA   │ │
│  │                              │ │
│  │ ✓ Vérifié  🏆 Top Pro        │ │
│  │ [CONTACTER] [RÉSERVER]       │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO]  Ibrahim Kane        │ │
│  │          ⭐ 4.9 (89 avis)    │ │
│  │                              │ │
│  │ 📍 Almadies • 4.1 km         │ │
│  │ 💼 12 ans d'expérience       │ │
│  │ 💰 À partir de 18 000 FCFA   │ │
│  │                              │ │
│  │ ✓ Vérifié  🎓 Certifié Kojo │ │
│  │ [CONTACTER] [RÉSERVER]       │ │
│  └─────────────────────────────┘ │
│                                   │
│         [CHARGER PLUS]            │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Card height: Auto (min 200px)
- Photo: 80x80px, circular, left
- Badges: Height 24px, padding 8px 12px
- Buttons: Height 40px, border-radius 20px
- "CONTACTER": Border orange
- "RÉSERVER": Gradient orange, white text
```

## 3.6 Filtres de Recherche

```
┌───────────────────────────────────┐
│ [←] Filtres            [Réinitial]│
├───────────────────────────────────┤
│                                   │
│  Distance                         │
│  ┌─────────────────────────────┐ │
│  │ ●━━━━○─────────── 5 km      │ │
│  └─────────────────────────────┘ │
│  [< 2km] [< 5km] [< 10km] [Tout]│
│                                   │
│  Note minimale                    │
│  [⭐ Tous] [⭐ 3+] [⭐ 4+] [⭐ 4.5+]│
│                                   │
│  Tarif (FCFA)                     │
│  ┌─────────────────────────────┐ │
│  │ Min: 5 000      Max: 50 000 │ │
│  └─────────────────────────────┘ │
│  [0-15K] [15-25K] [25-50K] [50K+]│
│                                   │
│  Disponibilité                    │
│  ☑️ Aujourd'hui                   │
│  ☑️ Cette semaine                 │
│  ☐ Ce week-end                    │
│  ☐ Flexible                       │
│                                   │
│  Badges                           │
│  ☑️ Vérifié                       │
│  ☑️ Top Pro                       │
│  ☐ Certifié Kojo                  │
│  ☐ Réponse rapide                 │
│                                   │
│  Expérience                       │
│  [Tous] [< 2 ans] [2-5 ans] [5+ ans]│
│                                   │
├───────────────────────────────────┤
│  127 professionnels trouvés       │
│  ┌─────────────────────────────┐ │
│  │   APPLIQUER LES FILTRES      │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Slider: Track #E0E0E0, active #FF6B35
- Chips: Height 36px, border-radius 18px
- Checkboxes: 20x20px, orange when checked
- Apply button: Fixed bottom, gradient orange
```

## 3.7 Profil Professionnel (Vue Client)

```
┌───────────────────────────────────┐
│ [←]                   [⭐] [🔗]   │
│                                   │
│         [PHOTO PROFILE]           │
│          Moussa Sarr              │
│      Électricien certifié         │
│                                   │
│    ⭐ 4.8  📍 Dakar  💼 8 ans    │
│         47 avis                   │
│                                   │
│  ✅ Vérifié  🏆 Top Pro           │
│                                   │
│  ┌─────────────────────────────┐ │
│  │   [RÉSERVER]   [MESSAGE]    │ │
│  └─────────────────────────────┘ │
├───────────────────────────────────┤
│  [À propos] [Services] [Portfolio]│
│  [Avis] [Disponibilités]          │
├───────────────────────────────────┤
│                                   │
│  À propos                         │
│  ─────────                        │
│  Électricien professionnel avec   │
│  8 ans d'expérience. Spécialisé   │
│  en installations résidentielles  │
│  et dépannages d'urgence.         │
│                                   │
│  📍 Zone d'intervention           │
│  Dakar, Rufisque, Pikine          │
│                                   │
│  🎓 Certifications                │
│  • CAP Électricité (2015)         │
│  • Certifié Kojo (2024)           │
│                                   │
│  Services proposés                │
│  ─────────                        │
│  ⚡ Installation électrique       │
│     À partir de 25 000 FCFA       │
│                                   │
│  ⚡ Dépannage                      │
│     À partir de 15 000 FCFA       │
│                                   │
│  ⚡ Mise aux normes                │
│     À partir de 35 000 FCFA       │
│                                   │
│  Portfolio (24 photos)            │
│  ─────────                        │
│  [PHOTO] [PHOTO] [PHOTO] [+21]    │
│                                   │
│  Avis clients (47)    ⭐ 4.8      │
│  ─────────                        │
│  ┌─────────────────────────────┐ │
│  │ ⭐⭐⭐⭐⭐  Aminata D.        │ │
│  │ Il y a 2 jours               │ │
│  │                              │ │
│  │ Excellent travail ! Rapide   │ │
│  │ et professionnel. Je         │ │
│  │ recommande vivement.         │ │
│  │                              │ │
│  │ [👍 Utile 12]                │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ ⭐⭐⭐⭐⭐  Ibrahim K.        │ │
│  │ Il y a 1 semaine             │ │
│  │                              │ │
│  │ Très compétent, à l'écoute.  │ │
│  │ Prix raisonnables.           │ │
│  │                              │ │
│  │ [👍 Utile 8]                 │ │
│  └─────────────────────────────┘ │
│                                   │
│       [VOIR TOUS LES AVIS]        │
│                                   │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Photo: 120x120px, circular, border 4px white
- Stats: Icon 16px, text 14px
- Tabs: Height 48px, underline 3px orange active
- Service cards: Background #F8F9FA, padding 16px
- Review cards: Border-left 4px #FFD700
```

## 3.8 Réservation (Booking Flow)

### Étape 1 : Choix du Service
```
┌───────────────────────────────────┐
│ [←] Réserver chez Moussa S.       │
├───────────────────────────────────┤
│                                   │
│  Quel service vous faut-il ?      │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ ⚡ Installation électrique   │ │
│  │ À partir de 25 000 FCFA      │ │
│  │ Durée estimée: 3-4h     [○] │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ ⚡ Dépannage                  │ │
│  │ À partir de 15 000 FCFA      │ │
│  │ Durée estimée: 1-2h     [●] │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ ⚡ Mise aux normes            │ │
│  │ À partir de 35 000 FCFA      │ │
│  │ Durée estimée: 5-6h     [○] │ │
│  └─────────────────────────────┘ │
│                                   │
│  Décrivez votre besoin            │
│  ┌─────────────────────────────┐ │
│  │ Panne électrique dans la     │ │
│  │ cuisine. Plus de courant     │ │
│  │ depuis hier soir.            │ │
│  │                              │ │
│  └─────────────────────────────┘ │
│  0/500 caractères                 │
│                                   │
│  📷 Ajouter des photos (opt.)     │
│  [+ PHOTO] [+ PHOTO]              │
│                                   │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │        CONTINUER →           │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

### Étape 2 : Date & Heure
```
┌───────────────────────────────────┐
│ [←] Réservation  ●━━○━○  (2/4)    │
├───────────────────────────────────┤
│                                   │
│  Quand souhaitez-vous             │
│  l'intervention ?                 │
│                                   │
│  📅 Date                          │
│  ┌─────────────────────────────┐ │
│  │  LUN MAR MER JEU VEN SAM DIM │ │
│  │   15  16  17  18  19  20  21 │ │
│  │   22  23  24  25  26  27  28 │ │
│  │        [25 sélectionné]       │ │
│  └─────────────────────────────┘ │
│                                   │
│  ⏰ Créneau horaire               │
│  [Matin]  [Après-midi]  [Urgent] │
│   8h-12h    14h-18h    Dès que   │
│                        possible   │
│                                   │
│  Créneaux disponibles pour        │
│  le 25 janvier - Après-midi :     │
│                                   │
│  ┌───────┐ ┌───────┐ ┌───────┐  │
│  │ 14h   │ │ 15h   │ │ 16h   │  │
│  │ [●]   │ │ [○]   │ │ [○]   │  │
│  └───────┘ └───────┘ └───────┘  │
│                                   │
│  ┌───────┐ ┌───────┐             │
│  │ 17h   │ │ 18h   │             │
│  │ [○]   │ │ Complet│            │
│  └───────┘ └───────┘             │
│                                   │
│  ℹ️ Service Express (+3 000 FCFA) │
│    Intervention sous 2h garantie  │
│                                   │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │        CONTINUER →           │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

### Étape 3 : Adresse
```
┌───────────────────────────────────┐
│ [←] Réservation  ●━━●━○  (3/4)    │
├───────────────────────────────────┤
│                                   │
│  Où doit se faire                 │
│  l'intervention ?                 │
│                                   │
│  📍 Adresse                       │
│  ┌─────────────────────────────┐ │
│  │ 🔍 Rechercher une adresse... │ │
│  └─────────────────────────────┘ │
│                                   │
│  ou                               │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ [📍] Utiliser ma position    │ │
│  └─────────────────────────────┘ │
│                                   │
│  Adresses enregistrées :          │
│  ┌─────────────────────────────┐ │
│  │ ○ 🏠 Domicile                │ │
│  │   15 Rue de la République    │ │
│  │   Dakar Plateau              │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ ● 💼 Bureau                  │ │
│  │   Avenue Cheikh Anta Diop    │ │
│  │   Dakar Fann                 │ │
│  └─────────────────────────────┘ │
│                                   │
│  [+ Ajouter une adresse]          │
│                                   │
│  Complément d'adresse (opt.)      │
│  ┌─────────────────────────────┐ │
│  │ Immeuble, étage, code...     │ │
│  └─────────────────────────────┘ │
│                                   │
│  📱 Téléphone de contact          │
│  ┌─────────────────────────────┐ │
│  │ +221 77 123 45 67            │ │
│  └─────────────────────────────┘ │
│                                   │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │        CONTINUER →           │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

### Étape 4 : Récapitulatif & Paiement
```
┌───────────────────────────────────┐
│ [←] Réservation  ●━━●━●  (4/4)    │
├───────────────────────────────────┤
│                                   │
│  Récapitulatif                    │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Moussa S.            │ │
│  │ Électricien • ⭐ 4.8         │ │
│  └─────────────────────────────┘ │
│                                   │
│  ⚡ Dépannage                      │
│  📅 25 janvier 2025 à 14h00       │
│  📍 Avenue Cheikh Anta Diop       │
│     Dakar Fann                    │
│                                   │
│  Description :                    │
│  Panne électrique dans la cuisine │
│                                   │
│  Détails tarifaires               │
│  ─────────────                    │
│  Service Dépannage   15 000 FCFA  │
│  Frais déplacement    2 000 FCFA  │
│  ─────────────────────────        │
│  Total estimé        17 000 FCFA  │
│                                   │
│  💡 Le prix final sera confirmé   │
│     après diagnostic sur place    │
│                                   │
│  Mode de paiement                 │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ ● 🍊 Orange Money            │ │
│  │   +221 77 *** ** 67     [>] │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ ○ 💳 Wave                    │ │
│  │   +221 77 *** ** 45     [>] │ │
│  └─────────────────────────────┘ │
│                                   │
│  [+ Ajouter un moyen de paiement] │
│                                   │
│  ☑️ J'accepte les conditions     │
│     générales de service          │
│                                   │
│  ℹ️ Paiement sécurisé. L'argent   │
│    est bloqué et versé au pro     │
│    uniquement après validation.   │
│                                   │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │  CONFIRMER (17 000 FCFA)    │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

### Confirmation
```
┌───────────────────────────────────┐
│                                   │
│            ✅                      │
│                                   │
│    Réservation confirmée !        │
│                                   │
│  Votre demande a été envoyée      │
│  à Moussa S.                      │
│                                   │
│  Vous recevrez une notification   │
│  dès qu'il aura accepté.          │
│                                   │
│  ┌─────────────────────────────┐ │
│  │  📋 Voir ma réservation      │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │  💬 Contacter le pro         │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │  🏠 Retour à l'accueil       │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘
```

## 3.9 Mes Réservations

```
┌───────────────────────────────────┐
│ [←] Mes réservations              │
├───────────────────────────────────┤
│  [En cours] [Passées] [Annulées]  │
├───────────────────────────────────┤
│                                   │
│  ┌─────────────────────────────┐ │
│  │ ⚡ Dépannage électrique       │ │
│  │                              │ │
│  │ [PHOTO] Moussa S.            │ │
│  │ ⭐ 4.8 • Électricien          │ │
│  │                              │ │
│  │ 📅 Aujourd'hui à 14h00        │ │
│  │ 📍 Dakar Fann                 │ │
│  │                              │ │
│  │ 🟢 Confirmé • En route        │ │
│  │ Arrivée estimée: 13h45        │ │
│  │                              │ │
│  │ [📱 APPELER] [💬 MESSAGE]    │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ 🚰 Réparation fuite          │ │
│  │                              │ │
│  │ [PHOTO] Ibrahim K.           │ │
│  │ ⭐ 4.9 • Plombier             │ │
│  │                              │ │
│  │ 📅 25 janvier à 10h00         │ │
│  │ 📍 Dakar Plateau              │ │
│  │                              │ │
│  │ 🟠 En attente d'acceptation   │ │
│  │                              │ │
│  │ [ANNULER] [MODIFIER]          │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Tabs: Sticky, background white
- Status badges:
  • Vert (#27AE60): Confirmé, En cours, Terminé
  • Orange (#F39C12): En attente
  • Rouge (#E74C3C): Annulé
- Card padding: 16px
- Buttons: Height 40px
```

## 3.10 Détail Réservation

```
┌───────────────────────────────────┐
│ [←] Réservation #12345       [⋮]  │
├───────────────────────────────────┤
│                                   │
│  🟢 Intervention confirmée        │
│                                   │
│  ⚡ Dépannage électrique           │
│  17 000 FCFA                      │
│                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  ● Réservation confirmée          │
│  │ 24 jan à 09:32                 │
│  │                                │
│  ● Pro en route                   │
│  │ Aujourd'hui à 13:30            │
│  │                                │
│  ○ Intervention en cours          │
│  │ Aujourd'hui vers 14:00         │
│  │                                │
│  ○ Travail terminé                │
│  ○ Paiement effectué              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                   │
│  Le professionnel                 │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Moussa Sarr          │ │
│  │ ⭐ 4.8 (47 avis)              │ │
│  │ Électricien • 8 ans exp.     │ │
│  │                              │ │
│  │ [📱 APPELER] [💬 MESSAGE]    │ │
│  └─────────────────────────────┘ │
│                                   │
│  Détails de l'intervention        │
│  ─────────────                    │
│  📅 25 janvier 2025               │
│  ⏰ 14h00 - 16h00 (estimé)        │
│  📍 Avenue Cheikh Anta Diop       │
│     Dakar Fann                    │
│                                   │
│  Description                      │
│  Panne électrique dans la cuisine │
│  Plus de courant depuis hier soir │
│                                   │
│  📷 Photos (2)                    │
│  [PHOTO] [PHOTO]                  │
│                                   │
│  Détails du paiement              │
│  ─────────────                    │
│  Service            15 000 FCFA   │
│  Déplacement         2 000 FCFA   │
│  ─────────────────────────        │
│  Total              17 000 FCFA   │
│                                   │
│  💳 Orange Money (+221 77***67)   │
│  🛡️ Paiement sécurisé par Kojo   │
│                                   │
│  ┌─────────────────────────────┐ │
│  │    ⚠️ SIGNALER UN PROBLÈME   │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘
```

## 3.11 Messages / Chat

### Liste Conversations
```
┌───────────────────────────────────┐
│ [←] Messages           [+ Nouveau]│
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │ 🔍 Rechercher...             │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Moussa S.     14:32 │ │
│  │ J'arrive dans 15 min    [●] │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Ibrahim K.     Hier │ │
│  │ Merci pour votre confiance  │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Fatou B.     2 jours│ │
│  │ Je peux venir demain matin  │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Badge non-lu: Orange circle, 16px diameter
- Photo: 48x48px, circular
- Time: 12px, gray
- Last message: 14px, truncate 1 line
```

### Conversation
```
┌───────────────────────────────────┐
│ [←] [PHOTO] Moussa S.    [📞] [⋮]│
│     En ligne                      │
├───────────────────────────────────┤
│                                   │
│  ┌─────────────────────────────┐ │
│  │  📋 Réservation #12345       │ │
│  │  ⚡ Dépannage                 │ │
│  │  Aujourd'hui à 14h00         │ │
│  │  [VOIR DÉTAILS]              │ │
│  └─────────────────────────────┘ │
│                                   │
│              Aujourd'hui           │
│                                   │
│  Bonjour ! J'ai bien reçu         │
│  votre demande.             13:15 │
│                                   │
│         Merci ! À quelle heure    │
│         pouvez-vous venir ?       │
│                          13:16    │
│                                   │
│  Je pars maintenant, j'arrive     │
│  dans environ 30 minutes.   13:30 │
│                                   │
│         Parfait, merci !          │
│         À tout à l'heure.         │
│                          13:31    │
│                                   │
│  J'arrive dans 15 min 🚗    14:32 │
│  ✓✓                               │
│                                   │
├───────────────────────────────────┤
│  [📎] [📷] [Écrire un message...] │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Messages client: Align right, background #FF6B35
- Messages pro: Align left, background #F0F0F0
- Max width: 75% screen
- Border radius: 16px
- Padding: 12px 16px
- Time: 11px, gray
- Read receipts: ✓ (sent), ✓✓ (read)
```

## 3.12 Évaluation / Avis

```
┌───────────────────────────────────┐
│ [←] Laisser un avis               │
├───────────────────────────────────┤
│                                   │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Moussa Sarr          │ │
│  │ Dépannage électrique         │ │
│  │ 25 janvier 2025              │ │
│  └─────────────────────────────┘ │
│                                   │
│  Comment s'est passée             │
│  l'intervention ?                 │
│                                   │
│    ⭐  ⭐  ⭐  ⭐  ⭐               │
│     1   2   3   4   5             │
│                                   │
│  Donnez votre avis                │
│  ┌─────────────────────────────┐ │
│  │ Excellent travail ! Rapide   │ │
│  │ et professionnel. Je         │ │
│  │ recommande vivement.         │ │
│  │                              │ │
│  │                              │ │
│  └─────────────────────────────┘ │
│  150/500 caractères               │
│                                   │
│  Évaluez en détail (optionnel)    │
│                                   │
│  Ponctualité        ⭐⭐⭐⭐⭐     │
│  Qualité du travail ⭐⭐⭐⭐⭐     │
│  Propreté           ⭐⭐⭐⭐⭐     │
│  Rapport qualité/prix ⭐⭐⭐⭐⭐   │
│                                   │
│  📷 Ajouter des photos (opt.)     │
│  [+ PHOTO] [+ PHOTO]              │
│                                   │
│  ☐ Publier de manière anonyme     │
│                                   │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │      PUBLIER L'AVIS          │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

## 3.13 Profil Client

```
┌───────────────────────────────────┐
│ [≡] Mon profil          [⚙️]      │
├───────────────────────────────────┤
│                                   │
│         [PHOTO PROFILE]           │
│         [📷 Modifier]             │
│                                   │
│       Aminata Diallo              │
│    aminata@email.com              │
│    +221 77 123 45 67              │
│                                   │
│  ┌─────────────────────────────┐ │
│  │      ✏️ MODIFIER PROFIL      │ │
│  └─────────────────────────────┘ │
│                                   │
│  Informations                     │
│  ─────────────                    │
│  [📍] Adresses enregistrées (2)   │
│  [💳] Moyens de paiement (2)      │
│  [🏆] Mes badges & récompenses    │
│  [📜] Historique complet          │
│                                   │
│  Statistiques                     │
│  ─────────────                    │
│  📊 24 réservations               │
│  ⭐ 12 avis donnés                │
│  💰 420 000 FCFA dépensés         │
│  🏅 Client Fidèle                 │
│                                   │
│  Paramètres                       │
│  ─────────────                    │
│  [🔔] Notifications               │
│  [🌍] Langue (Français)           │
│  [🌙] Mode sombre                 │
│  [🔐] Sécurité & confidentialité  │
│  [❓] Aide & support              │
│  [📄] Conditions d'utilisation    │
│  [ℹ️] À propos de Kojo           │
│                                   │
│  ┌─────────────────────────────┐ │
│  │      🚪 SE DÉCONNECTER       │ │
│  └─────────────────────────────┘ │
│                                   │
│  Version 1.0.0                    │
│                                   │
└───────────────────────────────────┘
```

---

# 4. ÉCRANS PROFESSIONNEL

## 4.1 Dashboard Pro

```
┌───────────────────────────────────┐
│ [≡] Dashboard Pro       [🔔] [👤] │
├───────────────────────────────────┤
│                                   │
│  Bonjour Moussa ! 👋               │
│  Voici votre activité             │
│                                   │
│  Aujourd'hui                      │
│  ┌──────┐ ┌──────┐ ┌──────┐      │
│  │  3   │ │ 47K  │ │ 4.8  │      │
│  │Demandes│ FCFA │ │ ⭐   │      │
│  └──────┘ └──────┘ └──────┘      │
│                                   │
│  ⚡ Nouvelles demandes (3)         │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Aminata D.           │ │
│  │ ⚡ Dépannage                  │ │
│  │ 📅 Aujourd'hui 14h • 📍 2.3km│ │
│  │ 💰 15 000 FCFA estimé        │ │
│  │                              │ │
│  │ Panne électrique cuisine     │ │
│  │ [VOIR] [ACCEPTER] [REFUSER] │ │
│  └─────────────────────────────┘ │
│                                   │
│  📅 Prochaines interventions      │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ Aujourd'hui 16h              │ │
│  │ Maintenance électrique       │ │
│  │ Ibrahim K. • Dakar Plateau   │ │
│  │ [VOIR DÉTAILS]               │ │
│  └─────────────────────────────┘ │
│                                   │
│  📊 Statistiques cette semaine    │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ 12 interventions réalisées   │ │
│  │ 156 000 FCFA de revenus      │ │
│  │ ⭐ 4.8 note moyenne (8 avis)  │ │
│  │ 92% taux d'acceptation       │ │
│  └─────────────────────────────┘ │
│                                   │
│  [VOIR TOUT] [MES STATS]          │
│                                   │
├───────────────────────────────────┤
│  [📊] [📥] [📅] [💬] [👤]        │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Stats cards: Grid 3 columns, height 80px
- Badge "Nouveau": Orange #FF6B35
- Accept button: Green #27AE60
- Refuse button: Red outline
```

## 4.2 Demandes / Nouvelles Missions

```
┌───────────────────────────────────┐
│ [←] Demandes                      │
├───────────────────────────────────┤
│  [Nouvelles] [Acceptées] [Archives]│
├───────────────────────────────────┤
│                                   │
│  3 nouvelles demandes             │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Aminata Diallo       │ │
│  │ ⭐ Client vérifié             │ │
│  │                              │ │
│  │ ⚡ Dépannage électrique       │ │
│  │ 📅 Aujourd'hui à 14h00        │ │
│  │ 📍 Dakar Fann • 2.3 km       │ │
│  │                              │ │
│  │ Description:                 │ │
│  │ Panne électrique dans la     │ │
│  │ cuisine. Plus de courant     │ │
│  │ depuis hier soir.            │ │
│  │                              │ │
│  │ 📷 Photos (2) [VOIR]          │ │
│  │                              │ │
│  │ 💰 15 000 - 20 000 FCFA      │ │
│  │    (Budget estimé client)    │ │
│  │                              │ │
│  │ Il y a 15 minutes            │ │
│  │                              │ │
│  │ [💬 CONTACTER]               │ │
│  │ [✅ ACCEPTER] [✖️ REFUSER]    │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Ibrahim Kane         │ │
│  │ ⭐ 3 interventions passées    │ │
│  │                              │ │
│  │ ⚡ Installation électrique    │ │
│  │ 📅 26 janvier à 10h00         │ │
│  │ 📍 Dakar Plateau • 1.8 km    │ │
│  │                              │ │
│  │ Installation complète...     │ │
│  │ [VOIR PLUS]                  │ │
│  │                              │ │
│  │ 💰 25 000 - 30 000 FCFA      │ │
│  │                              │ │
│  │ Il y a 1 heure               │ │
│  │                              │ │
│  │ [💬 CONTACTER]               │ │
│  │ [✅ ACCEPTER] [✖️ REFUSER]    │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘
```

## 4.3 Détail Demande (Vue Pro)

```
┌───────────────────────────────────┐
│ [←] Demande #12345                │
├───────────────────────────────────┤
│                                   │
│  Le client                        │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Aminata Diallo       │ │
│  │ ⭐ Client vérifié             │ │
│  │ 📍 Dakar Fann                 │ │
│  │ Membre depuis 2024           │ │
│  │ 5 réservations passées       │ │
│  │                              │ │
│  │ [💬 CONTACTER]               │ │
│  └─────────────────────────────┘ │
│                                   │
│  Détails de la demande            │
│  ─────────────                    │
│  ⚡ Dépannage électrique           │
│  📅 Aujourd'hui, 25 janvier       │
│  ⏰ Créneau: 14h00 - 16h00        │
│  📍 Avenue Cheikh Anta Diop       │
│     Dakar Fann • 2.3 km           │
│                                   │
│  Description                      │
│  Panne électrique dans la cuisine │
│  Plus de courant depuis hier soir │
│  Disjoncteur ne remonte plus      │
│                                   │
│  📷 Photos du client (2)          │
│  [PHOTO] [PHOTO] [VOIR PLUS]      │
│                                   │
│  💰 Budget client: 15-20K FCFA    │
│                                   │
│  ℹ️ Reçue il y a 15 minutes       │
│  ⏱️ Accepter avant 14:45          │
│  (2 autres pros consultent)       │
│                                   │
│  Proposer un devis (optionnel)    │
│  ┌─────────────────────────────┐ │
│  │ Montant (FCFA)               │ │
│  │ [18 000                   ] │ │
│  └─────────────────────────────┘ │
│                                   │
│  Message au client (optionnel)    │
│  ┌─────────────────────────────┐ │
│  │ Bonjour, je peux venir...    │ │
│  │                              │ │
│  └─────────────────────────────┘ │
│                                   │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │      ✅ ACCEPTER LA DEMANDE  │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │      ✖️ REFUSER              │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

## 4.4 Intervention en Cours (Vue Pro)

```
┌───────────────────────────────────┐
│ [←] Intervention en cours         │
├───────────────────────────────────┤
│                                   │
│  🟢 En route vers le client       │
│                                   │
│  📍 Avenue Cheikh Anta Diop       │
│     Dakar Fann • 2.3 km           │
│  Arrivée estimée: 14:15           │
│                                   │
│  ┌─────────────────────────────┐ │
│  │      [OUVRIR MAPS]           │ │
│  └─────────────────────────────┘ │
│                                   │
│  Le client                        │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ [PHOTO] Aminata D.           │ │
│  │ +221 77 123 45 67            │ │
│  │                              │ │
│  │ [📱 APPELER] [💬 MESSAGE]    │ │
│  └─────────────────────────────┘ │
│                                   │
│  Service demandé                  │
│  ─────────────                    │
│  ⚡ Dépannage électrique           │
│  Panne dans la cuisine            │
│                                   │
│  📷 Photos client (2) [VOIR]      │
│                                   │
│  ⏱️ Chronomètre                   │
│  ┌─────────────────────────────┐ │
│  │        01:23:45              │ │
│  │    [⏸️ PAUSE] [⏹️ STOP]      │ │
│  └─────────────────────────────┘ │
│                                   │
│  Actions                          │
│  ┌─────────────────────────────┐ │
│  │   🚗 J'ARRIVE (à 10min)      │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │   🔧 COMMENCER L'INTERVENTION│ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │   ✅ TERMINER L'INTERVENTION │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │   ⚠️ SIGNALER UN PROBLÈME    │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘
```

## 4.5 Terminer Intervention

```
┌───────────────────────────────────┐
│ [←] Terminer l'intervention       │
├───────────────────────────────────┤
│                                   │
│  Résumé de l'intervention         │
│  ─────────────                    │
│  ⚡ Dépannage électrique           │
│  Durée: 01:45:30                  │
│                                   │
│  Travaux effectués                │
│  ┌─────────────────────────────┐ │
│  │ • Remplacement disjoncteur   │ │
│  │ • Vérification installation  │ │
│  │ • Test de sécurité           │ │
│  │                              │ │
│  └─────────────────────────────┘ │
│                                   │
│  📷 Ajouter photos "Avant/Après"  │
│  [+ PHOTO] [+ PHOTO] [+ PHOTO]    │
│                                   │
│  Facturation                      │
│  ─────────────                    │
│  Service base       18 000 FCFA   │
│                                   │
│  + Matériel utilisé (opt.)        │
│  ┌─────────────────────────────┐ │
│  │ Disjoncteur 40A  8 000 FCFA │ │
│  │ [AJOUTER AUTRE]              │ │
│  └─────────────────────────────┘ │
│                                   │
│  + Déplacement       2 000 FCFA   │
│  ─────────────────────────        │
│  Total              28 000 FCFA   │
│                                   │
│  Notes pour le client (opt.)      │
│  ┌─────────────────────────────┐ │
│  │ Tout est réparé. Pensez à   │ │
│  │ faire vérifier l'installation│ │
│  │ complète dans 6 mois.        │ │
│  └─────────────────────────────┘ │
│                                   │
│  ⚠️ Problème rencontré ?          │
│  [ ] Annulation demandée          │
│  [ ] Client absent                │
│  [ ] Autre problème               │
│                                   │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │  ✅ VALIDER (28 000 FCFA)    │ │
│  └─────────────────────────────┘ │
│                                   │
│  Le paiement sera traité          │
│  automatiquement après validation │
│  du client                        │
└───────────────────────────────────┘
```

## 4.6 Calendrier Pro

```
┌───────────────────────────────────┐
│ [←] Mon calendrier    [+ Bloquer] │
├───────────────────────────────────┤
│  [← Janvier 2025 →]               │
│  [Semaine] [Mois]                 │
├───────────────────────────────────┤
│                                   │
│  Semaine du 22 au 28 janvier      │
│                                   │
│  LUN 22                           │
│  ┌─────────────────────────────┐ │
│  │ 10h-12h ⚡ Dépannage          │ │
│  │ Aminata D. • Fann            │ │
│  └─────────────────────────────┘ │
│                                   │
│  MAR 23                           │
│  ┌─────────────────────────────┐ │
│  │ 14h-16h ⚡ Installation       │ │
│  │ Ibrahim K. • Plateau         │ │
│  └─────────────────────────────┘ │
│  Disponible                       │
│                                   │
│  MER 24                           │
│  ┌─────────────────────────────┐ │
│  │ 🚫 Indisponible (personnel)  │ │
│  └─────────────────────────────┘ │
│                                   │
│  JEU 25 • Aujourd'hui             │
│  ┌─────────────────────────────┐ │
│  │ 14h-16h ⚡ Dépannage (cours)  │ │
│  │ Fatou B. • Almadies          │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │ 16h-18h ⚡ Maintenance        │ │
│  │ Moussa T. • Liberté          │ │
│  └─────────────────────────────┘ │
│                                   │
│  VEN 26                           │
│  ┌─────────────────────────────┐ │
│  │ 10h-12h ⚡ Installation       │ │
│  │ Demande en attente           │ │
│  └─────────────────────────────┘ │
│  Disponible après 14h             │
│                                   │
│  SAM 27                           │
│  Disponible toute la journée      │
│                                   │
│  DIM 28                           │
│  ┌─────────────────────────────┐ │
│  │ 🚫 Indisponible (Repos)      │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │  ⚙️ GÉRER MES DISPONIBILITÉS │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘

SPÉCIFICATIONS:
- Slot height: 80px min
- Colors:
  • Confirmed: Green light bg
  • Pending: Orange light bg
  • Blocked: Red light bg
  • Available: White bg
- Tap slot: View details
```

## 4.7 Profil Pro (Vue Édition)

```
┌───────────────────────────────────┐
│ [←] Mon profil pro       [👁 Voir]│
├───────────────────────────────────┤
│                                   │
│         [PHOTO PROFILE]           │
│         [📷 Modifier]             │
│                                   │
│       Moussa Sarr                 │
│    ⭐ 4.8 (47 avis)                │
│                                   │
│  [À propos] [Services] [Portfolio]│
│  [Tarifs] [Disponibilités] [Stats]│
├───────────────────────────────────┤
│                                   │
│  Informations de base             │
│  ─────────────                    │
│  ┌─────────────────────────────┐ │
│  │ Spécialité                   │ │
│  │ [Électricien             ▼] │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ Années d'expérience          │ │
│  │ [8                        ] │ │
│  └─────────────────────────────┘ │
│                                   │
│  Présentation                     │
│  ┌─────────────────────────────┐ │
│  │ Électricien professionnel    │ │
│  │ avec 8 ans d'expérience.     │ │
│  │ Spécialisé en installations  │ │
│  │ résidentielles et dépannages │ │
│  │ d'urgence.                   │ │
│  │                              │ │
│  └─────────────────────────────┘ │
│  325/500 caractères               │
│                                   │
│  Zone d'intervention              │
│  ☑️ Dakar                         │
│  ☑️ Rufisque                      │
│  ☑️ Pikine                        │
│  ☐ Guédiawaye                     │
│  [+ AJOUTER]                      │
│                                   │
│  Certifications                   │
│  ┌─────────────────────────────┐ │
│  │ 🎓 CAP Électricité (2015)    │ │
│  │ [MODIFIER] [SUPPRIMER]       │ │
│  └─────────────────────────────┘ │
│  [+ AJOUTER CERTIFICATION]        │
│                                   │
│  Mes services                     │
│  ┌─────────────────────────────┐ │
│  │ ⚡ Installation électrique    │ │
│  │ À partir de 25 000 FCFA      │ │
│  │ Durée: 3-4h                  │ │
│  │ [MODIFIER] [SUPPRIMER]       │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │ ⚡ Dépannage                  │ │
│  │ À partir de 15 000 FCFA      │ │
│  │ Durée: 1-2h                  │ │
│  │ [MODIFIER] [SUPPRIMER]       │ │
│  └─────────────────────────────┘ │
│  [+ AJOUTER SERVICE]              │
│                                   │
│  Portfolio                        │
│  ┌───┐┌───┐┌───┐┌───┐           │
│  │[+]││📷││📷││📷│           │
│  └───┘└───┘└───┘└───┘           │
│  24 photos                        │
│                                   │
│  Disponibilités par défaut        │
│  ┌─────────────────────────────┐ │
│  │ LUN-VEN  08:00 - 18:00       │ │
│  │ SAM      09:00 - 14:00       │ │
│  │ DIM      Fermé               │ │
│  │ [MODIFIER]                   │ │
│  └─────────────────────────────┘ │
│                                   │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │    💾 ENREGISTRER            │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

## 4.8 Revenus & Statistiques

```
┌───────────────────────────────────┐
│ [←] Mes revenus & stats           │
├───────────────────────────────────┤
│  [Cette semaine] [Ce mois] [Année]│
├───────────────────────────────────┤
│                                   │
│  Cette semaine                    │
│  ───────────                      │
│  ┌──────┐ ┌──────┐ ┌──────┐      │
│  │156K  │ │  12  │ │ 4.8  │      │
│  │Revenus│ │Missions│ ⭐   │      │
│  └──────┘ └──────┘ └──────┘      │
│                                   │
│  📊 Évolution des revenus          │
│  ┌─────────────────────────────┐ │
│  │     [GRAPHIQUE BARRES]       │ │
│  │  |                           │ │
│  │  |    █                      │ │
│  │  |  █ █ █                    │ │
│  │  |█ █ █ █ █ █                │ │
│  │  └─────────────────          │ │
│  │   L M M J V S D              │ │
│  └─────────────────────────────┘ │
│                                   │
│  Détail par jour                  │
│  ─────────────                    │
│  LUN 22 jan        32 000 FCFA    │
│  2 interventions                  │
│                                   │
│  MAR 23 jan        18 000 FCFA    │
│  1 intervention                   │
│                                   │
│  MER 24 jan             0 FCFA    │
│  Jour de repos                    │
│                                   │
│  JEU 25 jan        47 000 FCFA    │
│  3 interventions • Aujourd'hui    │
│                                   │
│  VEN 26 jan        28 000 FCFA    │
│  2 interventions prévues          │
│                                   │
│  Performance                      │
│  ─────────────                    │
│  ⭐ Note moyenne          4.8/5    │
│  👍 Taux satisfaction       94%    │
│  ⚡ Taux d'acceptation       92%    │
│  ⏱️ Temps réponse moyen   < 15min  │
│                                   │
│  Services les plus demandés       │
│  ─────────────                    │
│  1. ⚡ Dépannage          (45%)    │
│  2. ⚡ Installation       (30%)    │
│  3. ⚡ Maintenance        (25%)    │
│                                   │
│  💰 Paiements                     │
│  ─────────────                    │
│  Disponible          126 000 FCFA │
│  En attente           30 000 FCFA │
│  Ce mois            422 000 FCFA  │
│                                   │
│  ┌─────────────────────────────┐ │
│  │   💸 DEMANDER UN VIREMENT    │ │
│  └─────────────────────────────┘ │
│                                   │
│  [📄 VOIR FACTURES] [📊 RAPPORT]  │
│                                   │
└───────────────────────────────────┘
```

---

# 5. COMPOSANTS RÉUTILISABLES

## 5.1 Boutons

```
BOUTON PRIMARY (CTA)
┌─────────────────────────────────┐
│      TEXTE BOUTON               │
└─────────────────────────────────┘
- Background: Gradient #FF6B35 → #FF8C42
- Text: White, 16px, bold
- Height: 56px
- Border-radius: 16px
- Shadow: 0 4px 12px rgba(255,107,53,0.3)
- Hover: Scale 1.02, shadow stronger

BOUTON SECONDARY
┌─────────────────────────────────┐
│      TEXTE BOUTON               │
└─────────────────────────────────┘
- Background: White
- Border: 2px #FF6B35
- Text: #FF6B35, 16px, bold
- Height: 56px
- Border-radius: 16px
- Hover: Background #FFF5F2

BOUTON GHOST
  TEXTE BOUTON
- No border, no background
- Text: #FF6B35, 16px, medium
- Underline on hover

BOUTON ICON
┌─────┐
│  🔍 │
└─────┘
- Size: 48x48px
- Border-radius: 24px
- Background: #F8F9FA
- Icon: 24px, #7F8C8D
- Hover: Background #E8E9EA
```

## 5.2 Cards

```
CARD STANDARD
┌─────────────────────────────────┐
│ [HEADER]                        │
├─────────────────────────────────┤
│                                 │
│     CONTENU                     │
│                                 │
└─────────────────────────────────┘
- Background: White
- Border-radius: 16px
- Shadow: 0 2px 8px rgba(0,0,0,0.1)
- Padding: 16px
- Hover: Shadow 0 4px 16px rgba(0,0,0,0.15)

CARD PRO (Liste)
┌─────────────────────────────────┐
│ [PHOTO]  Nom Professionnel      │
│          ⭐ 4.8 (47 avis)        │
│                                 │
│ 📍 Location • Distance          │
│ 💰 À partir de XX FCFA          │
│                                 │
│ [BADGES]                        │
│ [CONTACTER] [RÉSERVER]          │
└─────────────────────────────────┘
```

## 5.3 Inputs & Forms

```
INPUT TEXT
┌─────────────────────────────────┐
│ 📧 Label                        │
│ Texte saisi...             [x] │
└─────────────────────────────────┘
- Height: 56px
- Border: 1px #BDC3C7
- Border-radius: 12px
- Padding: 16px
- Focus: Border 2px #FF6B35
- Icon: 20px, left padding 48px

TEXTAREA
┌─────────────────────────────────┐
│ Décrivez votre besoin...        │
│                                 │
│                                 │
│                                 │
└─────────────────────────────────┘
- Min-height: 120px
- Max-height: 240px
- Resize: vertical
- Character count: Below, right, 14px

SELECT / DROPDOWN
┌─────────────────────────────────┐
│ Option sélectionnée        [▼] │
└─────────────────────────────────┘
- Same as input text
- Chevron: 16px, right

CHECKBOX
☐ Label du checkbox
☑️ Label du checkbox (checked)
- Size: 20x20px
- Border: 2px #BDC3C7
- Checked: Background #FF6B35, white checkmark
- Border-radius: 4px

RADIO
○ Option 1
● Option 2 (selected)
- Size: 20x20px
- Border: 2px #BDC3C7
- Selected: Inner circle #FF6B35
```

## 5.4 Badges & Tags

```
BADGE STATUS
┌──────────┐
│ ✅ Vérifié │
└──────────┘
- Height: 28px
- Padding: 6px 12px
- Border-radius: 14px
- Colors:
  • Success: #27AE60 bg, white text
  • Warning: #F39C12 bg, white text
  • Error: #E74C3C bg, white text
  • Info: #3498DB bg, white text
  • Default: #E8E9EA bg, #2C3E50 text

TAG / CHIP
┌────────────┐
│ Tag name [x]│
└────────────┘
- Height: 32px
- Padding: 8px 12px
- Border-radius: 16px
- Background: #F8F9FA
- Border: 1px #E0E0E0
- Removable: X icon right, 16px
```

## 5.5 Navigation Bottom Bar

```
┌───────────────────────────────────┐
│  [🏠]  [🔍]  [📋]  [💬]  [👤]    │
│  Home  Chercher Rés. Msg  Profil │
└───────────────────────────────────┘
- Height: 64px
- Background: White
- Shadow: 0 -2px 8px rgba(0,0,0,0.1)
- Icons: 24x24px
- Active: Orange #FF6B35
- Inactive: Gray #7F8C8D
- Label: 10px
```

## 5.6 Modals & Bottom Sheets

```
MODAL STANDARD
┌───────────────────────────────────┐
│                              [✕] │
│                                   │
│        TITRE DU MODAL             │
│                                   │
│  Contenu du modal...              │
│                                   │
│  ┌─────────────────────────────┐ │
│  │      ACTION PRIMAIRE         │ │
│  └─────────────────────────────┘ │
│                                   │
│  ┌─────────────────────────────┐ │
│  │      ACTION SECONDAIRE       │ │
│  └─────────────────────────────┘ │
│                                   │
└───────────────────────────────────┘
- Max-width: 90% screen
- Border-radius: 24px top
- Padding: 24px
- Backdrop: rgba(0,0,0,0.5)
- Animation: Slide up

BOTTOM SHEET
┌───────────────────────────────────┐
│         ━━━━━                     │ Drag handle
│                                   │
│        TITRE                      │
│                                   │
│  Contenu...                       │
│                                   │
└───────────────────────────────────┘
- Border-radius: 24px top only
- Drag to close
- Backdrop dim
```

## 5.7 Toast Notifications

```
TOAST SUCCESS
┌───────────────────────────────────┐
│ ✅ Message de succès         [✕] │
└───────────────────────────────────┘
- Position: Top center, below header
- Background: #27AE60
- Text: White, 14px
- Height: 56px
- Border-radius: 12px
- Shadow: 0 4px 12px rgba(0,0,0,0.2)
- Auto-dismiss: 4 seconds
- Animation: Slide down + fade in

TOAST ERROR
┌───────────────────────────────────┐
│ ❌ Message d'erreur          [✕] │
└───────────────────────────────────┘
- Background: #E74C3C
- Rest same as success
```

## 5.8 Loading States

```
SKELETON LOADER
┌─────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓░░░░░░░░                │
│ ▓▓▓▓▓░░░░░░░░░░░                │
│                                 │
│ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░                │
└─────────────────────────────────┘
- Background: #E8E9EA
- Animation: Shimmer left to right
- Border-radius: Same as final element

SPINNER
     ◠
   ◠   ◞
  ◟     ◝
   ◜   ◝
     ◡
- Size: 32px default
- Color: #FF6B35
- Stroke: 3px
- Animation: Rotate 360°, 1s
```

---

# 6. FLUX UTILISATEUR

## 6.1 Flux Client : Réserver un Service

```
[Accueil]
   ↓
[Recherche Service]
   ↓
[Liste Professionnels] ←─┐
   ↓                     │
[Profil Pro]            │
   ↓ ←──────────────────┘
[Réservation - Étape 1: Service]
   ↓
[Réservation - Étape 2: Date/Heure]
   ↓
[Réservation - Étape 3: Adresse]
   ↓
[Réservation - Étape 4: Paiement]
   ↓
[Confirmation]
   ↓
[Mes Réservations]
   ↓
[Détail Réservation] ←─ [Chat avec Pro]
   ↓
[Évaluation]
```

## 6.2 Flux Pro : Accepter & Réaliser Mission

```
[Dashboard Pro]
   ↓
[Nouvelles Demandes]
   ↓
[Détail Demande]
   ↓ (Accepter)
[Demandes Acceptées]
   ↓
[Calendrier]
   ↓ (Jour J)
[Intervention en Cours]
   ↓
[Terminer Intervention]
   ↓
[Dashboard Pro]
```

## 6.3 Flux Inscription

```
[Splash Screen]
   ↓
[Onboarding 1/3]
   ↓
[Onboarding 2/3]
   ↓
[Onboarding 3/3]
   ↓
[Choix Type Compte]
   ├─→ [Inscription Client]
   │      ↓
   │   [Vérification Email]
   │      ↓
   │   [Accueil Client]
   │
   └─→ [Inscription Pro]
          ↓
       [Vérification Identité]
          ↓
       [Configuration Profil Pro]
          ↓
       [Dashboard Pro]
```

---

# NOTES TECHNIQUES

## Responsive Design

```
BREAKPOINTS
├─ Mobile:     < 768px (design principal)
├─ Tablet:     768px - 1024px
└─ Desktop:    > 1024px (PWA en fenêtre)

ADAPTATION
- Mobile first approach
- Touch targets: Min 44x44px
- Font scale: Base 16px
- Max width content: 428px (centered on large screens)
```

## Performance

```
OPTIMISATIONS
├─ Images: WebP format, lazy loading
├─ Icons: SVG inline ou sprite sheet
├─ Fonts: Woff2, preload
├─ Cache: Service Worker, offline mode
└─ Bundle: Code splitting par route

TARGETS
├─ First Paint: < 1.5s
├─ Time to Interactive: < 3s
├─ Bundle size: < 200KB (gzipped)
└─ Lighthouse Score: > 90
```

## Accessibilité

```
WCAG 2.1 LEVEL AA
├─ Contrast ratio: 4.5:1 (text), 3:1 (UI)
├─ Touch targets: 44x44px minimum
├─ Focus states: Visible outline
├─ Screen reader: Semantic HTML, ARIA labels
└─ Keyboard navigation: Tab order, shortcuts
```

---

**FIN DU DOCUMENT**

**Pour convertir en PDF :** Utiliser Pandoc ou un éditeur Markdown avec export PDF

```bash
pandoc KOJO_MAQUETTES.md -o KOJO_MAQUETTES.pdf --pdf-engine=xelatex
```

ou utiliser https://dillinger.io/ (import → export PDF)
