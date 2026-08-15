# Rapport de nettoyage Kojo

## Résultat
Repo passé de **389 Mo à ~28 Mo** de code/config réellement utile (hors `mongodb-data/` et `uploads/` à la racine, laissés de côté volontairement — voir plus bas).

**155 éléments supprimés au total** :

### 1. Dossiers de backups / extracts de sessions de correction passées (~20 dossiers, ~120 Mo)
`backup_gmail_phase1`, `backup_email_first_fix`, `backup_serverpy_fix`, `backup_register_email_step_fix`, `backup_dashboard_icons_fix`, `kojo-emergency-backup`, `kojo-emergency-backup-before-pack-r-rollback`, `gmail_phase1_extract`, `email_first_fix_extract`, `serverpy_fix_extract`, `register_email_step_fix_extract`, `dashboard_icons_fix_extract`, `kojo_pack_total_messages_name_navigation_fix`, `kojo_pack_safe_discussion_focus_names_cleanup_v2`, `kojo_pack_safe_discussion_names_and_marker_cleanup_fix`, `kojo_pack_safe_accept_fallback_and_message_names_fix`, `kojo_pack_safe_front_discussion_hide_apply_fix`, `kojo-brevo-pack-ready`, `kojo-brevo-step3-ready`

### 2. Tentatives d'app mobile abandonnées
`KojoMobile/`, `KojoMobile_FINAL/`, `Kojo_Ninja_Mono_RN_FLUTTER_V1/`

### 3. Scripts de test/audit ponctuels à la racine (~60 fichiers `.py`)
Tous les `*_test.py`, `*audit*.py` isolés à la racine (ex: `backend_test.py`, `ultra_deep_backend_test.py`, `french_audit_test.py`, `mobile_backend_test.py`...). Aucun n'était référencé par le build ou un pipeline CI — c'étaient des scripts ponctuels d'un outil d'IA précédent (Emergent), jamais réexécutés.

Dossier `scripts/` (audits/fixers ponctuels, non référencés dans `package.json`) et `tests/` (vide, juste un `__init__.py`) supprimés aussi.

### 4. Rapports texte et documents hors-sujet technique
~30 fichiers `kojo-pack-*-report.txt` / `kojo-jobs-*-report.txt`, et des `.md` de type pitch deck / résumés (`KOJO_PITCH_DECK_INVESTISSEURS.md`, `KOJO_PRESENTATION_INVESTISSEURS.md`, `KOJO_MOBILE_APP_SUMMARY.md`, `GUIDE_CONVERSION_POWERPOINT.md`, etc.), `test_result.md` (280 Ko de logs QA historiques).

### 5. Fichiers `.backup` / `.before-*` éparpillés dans le code source (59 fichiers)
Snapshots "avant correctif" laissés dans `frontend/src/**` et `backend/` par d'anciennes sessions de patch (ex: `Jobs.js.jobs-real-front-fix.backup`, `server.py.kojo-pack-p.backup`). Ils ne sont importés par rien (JS/Python n'importent pas de fichiers `.backup`) — 100 % morts.

### 6. Fichiers orphelins non utilisés
- `backend/brevo_mailer.py`, `backend/integration_example_fastapi.py`, `backend/password_reset_email.py` — vérifié qu'aucun n'est importé dans `server.py` (leur logique a été copiée directement dedans lors des packs précédents). `integration_example_fastapi.py` était même explicitement un fichier d'exemple.
- `frontend/pnpm-lock.yaml` + `yarn.lock` (racine) — lockfiles inutilisés en doublon. Le build Vercel utilise `npm` (`npm --prefix frontend run build`), donc seul `package-lock.json` compte. Avoir 3 lockfiles différents pour 3 gestionnaires de paquets différents est une source de confusion/bugs de résolution de dépendances si quelqu'un les utilise par erreur.
- Icônes PNG dupliquées à la racine (les vraies sont dans `frontend/public/icons/`), captures d'écran (`messages_*_final.png`), `test_photo_upload.html`, `clear_sw_cache.html`.

## Ce qui a été laissé de côté (pas supprimé)
- **`mongodb-data/`** (313 Mo) et **`uploads/`** (18 Mo) à la racine — vous n'étiez pas sûr de leur statut, donc je n'y ai pas touché. J'ai ajouté ces chemins au `.gitignore` par précaution (ça n'efface rien, ça empêche juste que ce genre de gros dossiers de données se retrouve à nouveau suivi par Git à l'avenir). Quand vous serez fixé, dites-moi et je les traite.
- **`backend/uploads/profile_photos/`** — ce sont de vraies photos de profil d'utilisateurs, activement utilisées par l'app. Non touché.
- `.emergent/` — métadonnées de la plateforme de dev utilisée pour construire le projet, 20 Ko, laissé intact au cas où vous vous en servez encore.
- `SENTRY_SETUP_GUIDE.md` — gardé, c'est un guide utile (pas un rapport ponctuel).

## Vérification de non-régression
Aucun fichier supprimé n'était importé ailleurs dans le code (vérifié par recherche de chaque nom de fichier orphelin dans le reste du repo). Le poids des assets statiques réellement servis à l'utilisateur (`frontend/public/`) était déjà correct (480 Ko) — aucun souci de performance de ce côté, pas de gros images à optimiser.

## `.gitignore` mis à jour
Ajout de règles pour empêcher que ce type de fichiers revienne : `*.backup`, `*.before-*`, `kojo-pack-*-report.txt`, scripts de test isolés à la racine, dossiers `backup_*/`/`*_extract/`, `mongodb-data/`, `/uploads/`.
