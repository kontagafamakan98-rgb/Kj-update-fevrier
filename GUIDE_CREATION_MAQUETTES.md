# 📱 GUIDE : Créer des Maquettes Visuelles Kojo

## Fichier Créé

**Fichier source :** `/app/KOJO_MAQUETTES.md`

**Contenu :**
- 25+ écrans détaillés (Client + Pro)
- Charte graphique complète
- Spécifications de design
- Flux utilisateur complets
- Composants réutilisables

---

## MÉTHODE 1 : Figma (Recommandé - Professionnel)

### Avantages
- ✅ Gratuit pour usage personnel
- ✅ Collaboration en temps réel
- ✅ Composants réutilisables
- ✅ Export PDF haute qualité
- ✅ Prototype interactif possible

### Étapes Détaillées

#### 1. Créer un Compte Figma
- Aller sur https://figma.com
- Créer compte gratuit
- Télécharger desktop app (optionnel)

#### 2. Créer un Nouveau Projet
- Cliquer "New Design File"
- Nommer : "Kojo - Maquettes App"

#### 3. Configurer les Artboards
```
Créer des frames pour chaque écran :
- Size: 375 x 812 px (iPhone X)
- Nommer: "01 - Splash", "02 - Onboarding 1", etc.
```

#### 4. Importer les Spécifications

**Couleurs (Color Styles) :**
- Créer color styles pour chaque couleur de la charte
- Orange Primary: #FF6B35
- Orange Secondary: #FF8C42
- etc.

**Typographie (Text Styles) :**
- H1: Montserrat Bold 28px
- H2: Montserrat Bold 24px
- Body: Open Sans Regular 16px
- etc.

**Composants (Components) :**
- Créer un component pour chaque élément réutilisable
- Buttons (Primary, Secondary, Ghost)
- Cards (Pro card, Service card)
- Inputs (Text, Select, Checkbox)
- Bottom nav

#### 5. Designer les Écrans

**Copier le contenu de KOJO_MAQUETTES.md écran par écran**

**Pour chaque écran :**
1. Créer le frame
2. Ajouter le header
3. Ajouter le contenu (suivre les spécifications)
4. Ajouter bottom nav si applicable
5. Vérifier espacements (8px grid)

#### 6. Exporter en PDF

**Option 1 : Export direct**
- Sélectionner tous les frames
- File → Export
- Format: PDF
- Settings: Include all frames
- Download

**Option 2 : Présentation**
- Organiser les frames en ordre
- File → Export frames to PDF
- 1 écran = 1 page PDF

### Résultat
✅ **PDF haute qualité avec toutes les maquettes**

---

## MÉTHODE 2 : Adobe XD (Alternative)

### Avantages
- ✅ Gratuit (plan starter)
- ✅ Outils Adobe professionnels
- ✅ Export PDF natif
- ✅ Prototype interactif

### Étapes

1. Télécharger Adobe XD : https://www.adobe.com/products/xd.html
2. Créer nouveau document : Mobile (375x812px)
3. Suivre les mêmes étapes que Figma
4. Export → PDF

---

## MÉTHODE 3 : Canva (Plus Simple)

### Avantages
- ✅ Très facile à utiliser
- ✅ Templates disponibles
- ✅ Export PDF direct
- ✅ No learning curve

### Étapes

1. Aller sur https://canva.com
2. Créer un compte gratuit
3. "Create a design" → "Custom size" → 375 x 812 px
4. Créer une page par écran (25+ pages)
5. Utiliser les specs de KOJO_MAQUETTES.md
6. Export → PDF

**Template suggéré :**
- Chercher "Mobile App UI" dans templates
- Personnaliser avec couleurs Kojo
- Remplacer le contenu

---

## MÉTHODE 4 : Sketch (Mac uniquement)

### Avantages
- ✅ Outil professionnel
- ✅ Plugins puissants
- ✅ Symboles réutilisables

### Étapes
1. Télécharger Sketch : https://sketch.com (payant)
2. Créer artboards 375x812px
3. Designer les écrans
4. Export → PDF

---

## MÉTHODE 5 : Conversion Markdown → PDF (Basique)

### Pour avoir rapidement un PDF des spécifications

```bash
# Installation Pandoc
sudo apt-get install pandoc texlive-xetex

# Conversion
cd /app
pandoc KOJO_MAQUETTES.md \
  -o KOJO_MAQUETTES.pdf \
  --pdf-engine=xelatex \
  --toc \
  --toc-depth=2

echo "✅ PDF créé : KOJO_MAQUETTES.pdf"
```

**Résultat :**
- PDF avec toutes les spécifications
- Pas de vraies maquettes visuelles
- Mais utile pour référence technique

---

## MÉTHODE 6 : Utiliser un UI Kit Existant

### UI Kits Gratuits pour Mobile

**1. iOS UI Kit**
- https://www.figma.com/@apple
- iOS Design Resources officiel
- Adapter aux couleurs Kojo

**2. Material Design 3**
- https://www.figma.com/@materialdesign
- Components Android
- Personnaliser

**3. Mobile App UI Kit**
- https://www.uistore.design/types/mobile/
- Templates gratuits
- Filter par "free"

### Process avec UI Kit

1. Dupliquer le UI Kit dans Figma
2. Changer les couleurs (orange Kojo)
3. Remplacer le contenu par specs KOJO_MAQUETTES.md
4. Export PDF

**Gain de temps : 80% !**

---

## ASSETS À PRÉPARER

### Logo Kojo

**Créer sur Canva :**
1. Design → Custom size 512x512px
2. Texte "KOJO" avec police moderne
3. Ajouter un icon (marteau + éclair ?)
4. Couleurs : Orange #FF6B35 + Gold #FFD700
5. Export PNG transparent

**Besoin :**
- Logo carré : 512x512px (app icon)
- Logo horizontal : 800x200px (header)
- Logo blanc : pour dark backgrounds

### Photos Placeholder

**Sources gratuites :**
- Unsplash : https://unsplash.com/s/photos/african-professional
- Pexels : https://www.pexels.com/search/african%20worker/

**Recherches suggérées :**
- "African electrician"
- "African plumber"
- "African professional worker"
- "West Africa artisan"

### Icons

**Bibliothèques gratuites :**
- Heroicons : https://heroicons.com/
- Feather Icons : https://feathericons.com/
- Material Icons : https://fonts.google.com/icons

**Icons nécessaires :**
- Services : electrician, plumbing, mechanic, painting, AC
- Actions : search, filter, message, call, star, heart
- Status : check, clock, alert, info
- Navigation : home, explore, calendar, profile

---

## TEMPLATES FIGMA GRATUITS (Recommandé)

### Template 1 : Mobile Service App

**Lien :** https://www.figma.com/community/file/1047810446456927081

**Ce template contient :**
- Écrans de connexion/inscription
- Dashboard
- Profils
- Chat
- Calendrier

**À faire :**
1. Dupliquer dans votre compte
2. Personnaliser couleurs (orange)
3. Adapter le contenu avec KOJO_MAQUETTES.md
4. Export PDF

### Template 2 : Marketplace App

**Lien :** https://www.figma.com/community/file/1083340643831870286

**À faire :**
- Même process que Template 1

### Template 3 : Service Booking App

**Lien :** https://www.figma.com/community/file/1132791448814993207

---

## CRÉATION RAPIDE (2 heures)

### Process Optimisé

#### Étape 1 : Setup (15 min)
1. Compte Figma créé
2. Template dupliqué
3. Couleurs changées (orange)

#### Étape 2 : Écrans Principaux (45 min)
Créer uniquement les 8 écrans essentiels :
1. Splash + Onboarding
2. Accueil Client
3. Recherche Pro
4. Profil Pro
5. Réservation
6. Dashboard Pro
7. Messages
8. Profil

#### Étape 3 : Polish (30 min)
- Vérifier cohérence
- Ajuster espacements
- Ajouter photos placeholder

#### Étape 4 : Export PDF (30 min)
- Organiser les frames
- Export → PDF
- Vérifier qualité

**Total : 2 heures → PDF prêt ! 🚀**

---

## EXPORT PDF DEPUIS FIGMA

### Méthode 1 : Export Frames

```
1. Sélectionner tous les frames (Ctrl+A)
2. Clic droit → Export frames
3. Format: PDF
4. Quality: High
5. Click Export
```

### Méthode 2 : Print to PDF

```
1. File → Export
2. Frames to PDF
3. Options:
   - Include all frames
   - 1 frame = 1 page
   - High quality
4. Export
```

### Méthode 3 : Figma to PDF Plugin

```
1. Plugins → Browse plugins
2. Chercher "Export to PDF"
3. Installer
4. Plugins → Export to PDF
5. Configure & Export
```

---

## AMÉLIORER LES MAQUETTES

### Ajouter du Réalisme

**1. Photos Réelles**
- Remplacer les placeholders
- Photos de vrais artisans africains
- Cohérence ethnique et contexte local

**2. Contenu Localisé**
- Noms africains (Aminata, Moussa, Ibrahim)
- Adresses réelles (Avenue Bourguiba, etc.)
- Prix en FCFA
- Numéros format local (+221...)

**3. Micro-Interactions**
- Ajouter états hover
- Ajouter états active
- Ajouter loading states
- Ajouter error states

**4. Dark Mode (Bonus)**
- Créer variantes dark
- Backgrounds sombres
- Texte clair

---

## CRÉER UN PROTOTYPE INTERACTIF

### Dans Figma

1. **Passer en mode Prototype** (top right)
2. **Lier les écrans :**
   - Drag de button → écran destination
   - Animation : Smart Animate
   - Duration : 300ms
3. **Actions :**
   - Tap : Navigation
   - Swipe : Retour
   - Scroll : Overflow content
4. **Tester :**
   - Play button (top right)
   - Test sur mobile (Figma Mirror app)

### Exporter le Prototype

- Share → Copy link
- Enable "Anyone with link can view"
- Partager avec investisseurs
- **Démo interactive sans code !**

---

## PRÉSENTER LES MAQUETTES

### Format Présentation Investisseurs

#### Option 1 : PDF avec Commentaires

**Structure :**
```
Page 1 : Couverture (Logo + titre)
Page 2 : Charte graphique
Page 3 : Navigation & Architecture
Page 4-10 : Écrans Client
Page 11-18 : Écrans Pro
Page 19 : Flux utilisateur
Page 20 : Notes techniques
```

#### Option 2 : Prototype Figma Interactif

**Avantage :**
- Investisseurs peuvent cliquer
- Navigation réelle
- Effet "wow" garanti

**Share link :**
```
https://www.figma.com/proto/[votre-id]
```

#### Option 3 : Vidéo Walkthrough

**Créer avec Loom ou Figma Mirror :**
1. Enregistrer navigation dans prototype
2. Commenter en français
3. Durée : 3-5 minutes
4. Upload sur YouTube (unlisted)
5. Partager le lien

---

## ALTERNATIVES RAPIDES

### Option A : MockFlow (Wireframe Rapide)

**Lien :** https://www.mockflow.com

1. Sign up gratuit
2. Utiliser wireframe tool
3. Drag & drop components
4. Export PDF

**Temps : 1-2 heures**

### Option B : Balsamiq (Wireframes Style Sketch)

**Lien :** https://balsamiq.com

- Style dessiné à la main
- Très rapide
- Export PDF direct

**Temps : 1 heure**

### Option C : Marvel App (Prototype No-Code)

**Lien :** https://marvelapp.com

1. Upload screenshots of specs
2. Add hotspots (clickable zones)
3. Link screens
4. Share prototype link

**Temps : 30 minutes**

---

## CONVERSION PDF DEPUIS MARKDOWN

### Avec Style (Recommandé)

```bash
cd /app

# Créer un template CSS pour pandoc
cat > maquettes-style.css << 'EOF'
body {
  font-family: 'Open Sans', sans-serif;
  color: #2C3E50;
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

h1 {
  color: #FF6B35;
  font-size: 2.5em;
  border-bottom: 3px solid #FFD700;
  padding-bottom: 10px;
}

h2 {
  color: #FF8C42;
  font-size: 2em;
  margin-top: 40px;
}

pre {
  background: #F8F9FA;
  border: 1px solid #E0E0E0;
  border-left: 4px solid #FF6B35;
  padding: 15px;
  border-radius: 8px;
  font-family: monospace;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  background: #FF6B35;
  color: white;
  padding: 12px;
}

td {
  border: 1px solid #E0E0E0;
  padding: 10px;
}
EOF

# Conversion avec style
pandoc KOJO_MAQUETTES.md \
  -o KOJO_MAQUETTES.pdf \
  --css=maquettes-style.css \
  --pdf-engine=xelatex \
  --toc \
  --toc-depth=2 \
  --number-sections

echo "✅ PDF créé avec style : KOJO_MAQUETTES.pdf"
```

### Sans Style (Rapide)

```bash
cd /app
pandoc KOJO_MAQUETTES.md -o KOJO_MAQUETTES.pdf
```

---

## OUTILS POUR CRÉER DES VISUELS

### Pour Créer le Logo Kojo

**Canva (Gratuit) :**
1. https://canva.com
2. Create → Logo
3. Elements :
   - Texte "KOJO" en Montserrat Bold
   - Icon (marteau + éclair ou maison + outils)
   - Couleurs orange #FF6B35
4. Download PNG transparent

**Alternatives :**
- Looka.com (AI logo generator)
- Hatchful.shopify.com (gratuit)

### Pour Créer des Icons Personnalisés

**Figma Icons :**
1. Heroicons : https://heroicons.com/
2. Download SVG
3. Import dans Figma
4. Recolor en orange

### Pour Mockups Réalistes

**Smartmockups.com :**
1. Upload les maquettes
2. Choisir device (iPhone, Android)
3. Download mockup photoréaliste

**Mockup gratuit :**
- Placeit.net
- Mockuphone.com

---

## ROADMAP CRÉATION MAQUETTES

### Version 1 : Wireframes Simples (1-2h)
- Balsamiq ou MockFlow
- Noir & blanc
- Structure uniquement
- **→ Pour valider l'UX**

### Version 2 : Maquettes Haute Fidélité (3-4h)
- Figma avec couleurs
- Contenu réaliste
- Composants stylisés
- **→ Pour investisseurs**

### Version 3 : Prototype Interactif (2h supplémentaires)
- Ajouter interactions Figma
- Transitions animées
- Flow complet cliquable
- **→ Pour démo investisseurs**

---

## CHECKLIST MAQUETTES COMPLÈTES

### Écrans Client (13)
- [ ] Splash screen
- [ ] Onboarding (3 écrans)
- [ ] Connexion
- [ ] Inscription client
- [ ] Accueil
- [ ] Recherche / Explorer
- [ ] Filtres
- [ ] Profil professionnel (vue client)
- [ ] Réservation (4 étapes)
- [ ] Confirmation
- [ ] Mes réservations
- [ ] Détail réservation
- [ ] Messages / Chat
- [ ] Évaluation / Avis
- [ ] Profil client

### Écrans Professionnel (8)
- [ ] Dashboard pro
- [ ] Nouvelles demandes
- [ ] Détail demande
- [ ] Intervention en cours
- [ ] Terminer intervention
- [ ] Calendrier
- [ ] Revenus & Stats
- [ ] Profil pro (édition)

### Composants (8)
- [ ] Boutons (4 types)
- [ ] Cards (3 types)
- [ ] Inputs (5 types)
- [ ] Badges & Tags
- [ ] Bottom navigation
- [ ] Modals
- [ ] Toasts
- [ ] Loading states

### Documents (3)
- [ ] Charte graphique
- [ ] Flux utilisateur
- [ ] Spécifications techniques

---

## EXPORTER POUR DIFFÉRENTS USAGES

### Pour Investisseurs (PDF Présentation)

```
Format : PDF multipages
Pages :
- Page 1 : Couverture avec logo
- Pages 2-4 : Charte & Architecture
- Pages 5-20 : Écrans (1 écran = 1 page)
- Page finale : Spécifications techniques

Options :
- High quality (300 DPI)
- Include page numbers
- Table of contents
```

### Pour Développeurs (PDF Technique)

```
Format : PDF avec annotations
Inclure :
- Espacements précis (px)
- Color codes (#HEX)
- Font sizes & weights
- Component specs
- Responsive breakpoints
```

### Pour Marketing (Images PNG)

```
Format : PNG individual
Chaque écran :
- Size : 1242x2688px (3× for retina)
- Background transparent (si possible)
- Usage : Site web, réseaux sociaux
```

---

## BUDGET & TIMELINE

### Option 1 : DIY (Gratuit)

**Outils :**
- Figma gratuit
- Template gratuit
- 4-6 heures de travail

**Coût : 0 FCFA**  
**Qualité : 7/10**

### Option 2 : Freelance Figma (Moyen)

**Plateforme :** Fiverr, Upwork, Malt

**Mission :** 
- Créer 25 écrans haute fidélité
- Charte graphique fournie
- Livraison : 3-5 jours

**Coût : 75 000 - 150 000 FCFA**  
**Qualité : 9/10**

### Option 3 : Designer Pro (Premium)

**Profil :** UI/UX Designer expérimenté

**Mission :**
- Maquettes + prototype interactif
- Itérations incluses
- Livraison : 1-2 semaines

**Coût : 300 000 - 600 000 FCFA**  
**Qualité : 10/10**

---

## RECOMMANDATION

### Pour Levée de Fonds Immédiate

**Utiliser Méthode 1 (Figma) + Template gratuit**

**Temps total : 3-4 heures**

**Résultat :**
- ✅ PDF professionnel
- ✅ Prototype interactif
- ✅ Coût : 0 FCFA
- ✅ Qualité suffisante pour investisseurs

**Tutorial complet :**
1. Sign up Figma
2. Dupliquer template "Mobile Service App"
3. Changer couleurs en orange
4. Remplacer contenu avec KOJO_MAQUETTES.md
5. Export PDF (File → Export → PDF)

**Lien direct tutorial Figma :**
https://www.youtube.com/watch?v=FTFaQWZBqQ8 (Figma for beginners)

---

## SUPPORT

**Questions sur les maquettes ?**

Email : [email]

**Ressources :**
- Figma Learn : https://www.figma.com/resources/learn-design/
- Figma Community : https://www.figma.com/community
- YouTube : Rechercher "Figma mobile app tutorial"

---

## RÉSUMÉ RAPIDE

**Vous avez 3 options :**

1. **DIY avec Figma** (Gratuit, 4h)
   - Meilleure option qualité/prix
   - Résultat professionnel

2. **Freelance** (75-150K FCFA, 5 jours)
   - Déléguer complètement
   - Qualité garantie

3. **Conversion MD → PDF** (Gratuit, 5min)
   - Specs techniques uniquement
   - Pas de visuels
   - Utile pour référence

**Recommandation : Option 1 (Figma) 🎯**

---

**Avec ce guide, vous pouvez créer un PDF de maquettes professionnelles en quelques heures ! 📱🎨**
