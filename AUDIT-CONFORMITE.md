# Audit de mise en ligne — les 44 points, un par un

Chaque point est jugé sur le code réel du dépôt, pas sur une intention. Trois
statuts :

- **FAIT** — la surface existe, et un garde ou une sonde la mesure ;
- **AJOUTÉ** — manquait, livré dans ce passage (avec son test) ;
- **RESTE** — ne peut pas être fait sans une décision ou une donnée qui
  n'appartient pas au code (identité juridique, arbitrage produit).

La liste d'origine contient des doublons (`22` = `2`, `25` = `10`, `27` = `13`,
`28` = `5`, `26` ⊂ `5`) : ils sont marqués « doublon » et renvoient au point
principal.

---

## A. Légal et confiance

| # | Point | Statut | Où / pourquoi |
|---:|---|---|---|
| 1 | Page de politique de confidentialité | **FAIT** | `/privacy` (`src/pages/Privacy.js`), 5 langues, coquille pré-rendue, durées dérivées de `kojo_retention.py` |
| 2 | Conditions générales | **FAIT** | `/terms` (`src/pages/Terms.js`) |
| 22 | Conditions d'utilisation | doublon de **2** | — |
| 24 | Politique de remboursement | **AJOUTÉ** | section « Annulation et remboursement » de `/terms`, qui décrit la règle RÉELLE du code : remboursement du séquestre tant que le versement n'est pas parti, refus (409) ensuite |
| 26 | Politique de cookies | **AJOUTÉ** | section « Cookies » de `/terms` : seuls la session httpOnly et le jeton CSRF sont posés |
| 31 | Détails de l'entreprise (mentions légales) | **RESTE** | l'adresse, le téléphone et l'e-mail de l'éditeur sont déjà publiés (pied de page, `src/config/contact.json`, `LocalBusiness`). Il MANQUE les identifiants d'entreprise (raison sociale, RCCM/IFU, adresse du siège) : ils ne peuvent pas être inventés. Les ajouter = une section de plus dans `page-sections.js` + 2 clés i18n |
| 33 | Consentement d'âge (mineurs) | **AJOUTÉ (texte)** / **RESTE (contrôle)** | section « Âge minimum » de `/terms` : 18 ans, suppression sur demande du titulaire légal. L'inscription ne DEMANDE pas encore la date de naissance — contrôle à ajouter si la politique doit être vérifiée à l'entrée |
| 39 | Demande de suppression de données | **FAIT** | suppression et export depuis le profil, anonymisation dans `kojo_routers_users_account.py`, RGPD testé (`test_export_deletion_inverse.py`) |
| 32 | Pas de données inutiles | **FAIT** | la politique liste le strict nécessaire ; un paiement ne porte aucune donnée identifiante (`serialize_payment_record`) |

## B. Consentement, cookies, mesure

| # | Point | Statut | Où / pourquoi |
|---:|---|---|---|
| 5 | Bandeau de consentement cookies | **AJOUTÉ** | `src/components/ConsentBanner.js`, monté une fois dans `App.js`. Il ne s'affiche QUE si un fournisseur d'audience est configuré et qu'aucune décision n'est enregistrée |
| 28 | Bandeau de consentement | doublon de **5** | — |
| 19 | Mesure d'audience (analytics) | **AJOUTÉ (conformité)** | Plausible/GA4 existaient mais se chargeaient TOUJOURS. Désormais `initAnalyticsIfConsented()` : aucun script tiers sans accord explicite (`src/utils/analytics.js`, `src/utils/consent.js`) |
| 36 | Pas de motifs sombres | **AJOUTÉ (bandeau)** | les deux boutons du bandeau ont le MÊME dessin — un « Accepter » plein et un « Refuser » discret n'est pas un choix libre. Testé (`ConsentBanner.test.jsx`) |

## C. Référencement et partage

| # | Point | Statut | Où / pourquoi |
|---:|---|---|---|
| 6 | Titres + descriptions meta | **FAIT** | `src/config/page-meta.js`, 12 pages, 5 langues. Garde : `check-page-meta.js` |
| 7 | Image d'aperçu social | **FAIT** | cartes OG statiques et dynamiques (`/api/og/jobs/{id}`). Gardes : `check-og-images.js`, `check-og-job-200.js` |
| 8 | Favicon | **FAIT** | `src/config/marque-kojo.json`, icônes générées. Gardes : `check-marque-kojo.js`, `check-generated-icons.js` |
| 9 | Sitemap + robots.txt | **FAIT** | servis par le backend, sondés en production (`check-seo-production.js --strict`, deux sources pour les fiches) |
| 23 | Supprimer les promesses non étayées | **RESTE** | les promesses de l'accueil (`PROMISES` dans `About.js`) et les faits chiffrés sont éditoriaux ; le garde `faits-support.test.js` verrouille `7j/7`. Une relecture humaine reste nécessaire |
| 16 | Corriger les liens morts | **RESTE** | aucun garde ne vérifie les liens externes (un lien sortant peut mourir sans nous). Les liens internes, eux, sont couverts par le pré-rendu (`check-prerender-shells.js` route chaque page déclarée) |

## D. Sécurité et vie privée

| # | Point | Statut | Où / pourquoi |
|---:|---|---|---|
| 3 | Secrets hors du frontend | **FAIT** | les secrets vivent côté backend (`.env` non versionné, `backend/.env.example` documente les noms). Aucune clé d'API dans le bundle : `check-origines-bundles.js` + `couverture-tiers.js`. Les `VITE_*` sont publics par nature et ne portent aucun secret |
| 4 | Forcer HTTPS | **FAIT** | `force_https = true` dans `fly.toml` (ports 80 → 443) et `Strict-Transport-Security` dans les en-têtes par défaut (`kojo_settings.py`). Vercel sert le frontend en HTTPS |
| 34 | Audit des SDK tiers | **FAIT** | matrice `frontend/scripts/couverture-tiers.js` + `check-origines-bundles.js` : aucune origine tierce en clair sans interaction ; sondes `aucun-tiers-avant-interaction` et `tiers-apres-interaction` |
| 18 | Protection anti-spam | **FAIT (partiel)** | rate-limit par route (`kojo_rate_limit.py`) : OTP 12/5 min, connexion 20/5 min, support 10/5 min ; vérification e-mail obligatoire à l'inscription. Pas de CAPTCHA ni de pot de miel — à ajouter si le spam devient réel |
| 35 | Lien de désabonnement dans les e-mails | **NON APPLICABLE** | aucun e-mail marketing : les envois sont transactionnels (code de vérification, reçus, alertes propriétaire). Un lien de désabonnement sur un code de connexion serait trompeur |

## E. Accessibilité et expérience

| # | Point | Statut | Où / pourquoi |
|---:|---|---|---|
| 10 | Texte alternatif des images | **FAIT** | les `<img>` portent un `alt` explicite ; les photos décoratives portent `alt=""` VOLONTAIREMENT (elles illustrent un texte qui les précède). Aucun contrôle automatique global — une revue à chaque nouvelle image |
| 25 | Alt text (accessibilité) | doublon de **10** | — |
| 13 | Contraste des couleurs | **FAIT (partiel)** | palette `stone`/`orange` et sondes qui comparent les couleurs CALCULÉES aux jetons (`champs-comptes-paiement`, `carte-proposition-etat`). Pas de scan axe global : un nouveau composant n'est pas mesuré d'office |
| 27 | Contraste | doublon de **13** | — |
| 14 | Compatible mobile | **FAIT** | mises en page responsives, barres de rupture sondées (`barres-rupture.spec.js`), cibles tactiles |
| 29 | Navigation au clavier | **FAIT (partiel)** | boutons et liens natifs, focus visible orange, panneau de notifications piloté au clavier. Pas de lien d'évitement (« aller au contenu ») — à ajouter |
| 15 | Page 404 personnalisée | **FAIT / AJOUTÉ (SPA)** | le `404.html` statique (aucun script, `noindex`) est publié par le pré-rendu et servi en statut 404 pour une URL hors des rewrites (aucun catch-all). Il manquait le lien mort INTERNE : `/terms` → `/terms-2024` ne rendait RIEN, le chrome seul avec un `<main>` vide. `src/pages/NotFound.js` + route attrape-tout en DERNIER dans `App.js` ; les textes sont ceux de la 404 statique (`notFoundTitle`, `notFoundText`, `notFoundJobsLink`), donc aucune traduction nouvelle |
| 40 | Squelettes de chargement | **FAIT** | `SkeletonLoader.js` + squelettes dédiés par route ; garde `antiClsSkeletons.test.js`, sonde `cadres-app.spec.js` |

## F. Formulaires et confiance

| # | Point | Statut | Où / pourquoi |
|---:|---|---|---|
| 17 | Validation de formulaire | **FAIT** | côté client (`validation.js`, `classes-champ.js`) ET côté serveur (Pydantic). Les deux ne peuvent pas diverger sans test rouge |
| 30 | Consentement dans les formulaires | **FAIT** | case d'acceptation obligatoire à l'inscription (`legalConsentRequired`), versionnée (`legal_documents_version`) et enregistrée en base |
| 37 | Licences des polices et images | **FAIT (polices) / RESTE (photos)** | Inter et Cormorant sont sous SIL OFL, licence publiée à côté des fichiers (`public/fonts/LICENSE-Inter-OFL.txt`). Les photos du héros : vérifier la provenance avant toute nouvelle publication |
| 38 | Pas de frais cachés | **FAIT** | la commission est calculée et AFFICHÉE avant paiement (`calculate_payment_breakdown`, page `/payment`) ; le total dû est le montant montré |
| 20 | Un appel à l'action clair | **FAIT** | l'accueil mène à « publier une mission » / « trouver du travail » selon le profil ; pas de second CTA concurrent |

## G. Qualité perçue et robustesse

| # | Point | Statut | Où / pourquoi |
|---:|---|---|---|
| 11 | Compresser les images | **FAIT** | AVIF + WebP générés par `gen-hero-images.py`, vérifiés par `check-hero-images.js` |
| 12 | Vitesse de chargement | **FAIT** | Lighthouse CI (desktop + mobile), budgets CLS/LCP, mesures locales reproductibles |
| 21 | Supprimer les faux avis | **FAIT** | aucun avis n'est fabriqué : `reviews` n'est alimentée que par une mission terminée (unicité `(job_id, reviewer_id)` en base) |
| 41 | Autofill natif | **FAIT** | `autoComplete` explicite sur les champs (nom, téléphone, pays, mot de passe) |
| 42 | Interface optimiste | **FAIT (partiel)** | les actions de notification (lu/supprimé) s'appliquent à l'écran puis se réconcilient avec le serveur ; les formulaires attendent la réponse |
| 43 | Sauvegarde d'état | **FAIT** | parcours d'inscription (`registrationFlowStorage`), brouillons de profil, retour après connexion (`resumeAfterLogin`) |
| 44 | Gestion propre des erreurs | **FAIT** | `ErrorBoundary`, erreurs API normalisées (`handleApiError`), 401/403 traités (sonde, rejeu CSRF), messages par langue |

---

## Ce que ce passage a réellement changé

| Fichier | Changement | Preuve |
|---|---|---|
| `frontend/src/config/page-sections.js` | 3 sections ajoutées à `/terms` : remboursement, cookies, âge | la coquille pré-rendue lit le plan, donc le build publie les mêmes sections |
| `frontend/src/i18n/*.json` (5 langues) | 11 clés (6 CGU + 5 bandeau) | `i18nParity.test.js` (919 clés identiques partout) |
| `frontend/src/utils/consent.js` | décision de consentement (jamais par défaut, stockage qui lève ≠ accord) | `consent.test.js` (6 cas) |
| `frontend/src/utils/analytics.js` | `isAnalyticsConfigured()`, `initAnalyticsIfConsented()` | `analyticsConsent.test.js` (3 cas) |
| `frontend/src/components/ConsentBanner.js` + `App.js` | bandeau monté une fois, deux boutons de même poids | `ConsentBanner.test.jsx` (6 cas) |
| `frontend/src/pages/NotFound.js` + `App.js` | 404 DANS l'application (route `*` en dernier), textes de la 404 statique réutilisés | `pages-render.test.jsx` (page couverte d'office par `import.meta.glob`, 25 cas) ; build + `check-prerender-shells.js` verts |

## Ce qui reste, et ce qu'il faut pour le finir

1. **Identité juridique** (point 31) — raison sociale, forme, RCCM/IFU, siège.
2. **Contrôle d'âge à l'inscription** (point 33) — la politique est publiée, le
   contrôle ne l'est pas : champ date de naissance + refus sous 18 ans.
3. **Lien d'évitement clavier** (point 29) — une ligne avant la barre de
   navigation.
4. **Garde des liens externes** (point 16) — un balayage périodique des URL
   sortantes, sinon un lien meurt sans que rien ne rougisse.
5. **Provenance des photos** (point 37) — à documenter pour chaque visuel.
