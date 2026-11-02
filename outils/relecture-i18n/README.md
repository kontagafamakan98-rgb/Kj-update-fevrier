# Relecture native assistée — wolof, bambara, mooré

Cette équipe relit les dictionnaires de **page** (`frontend/src/utils/pack2PageI18n/*.js`),
propose des réécritures là où une phrase est fautive ou non naturelle, et **nomme
ses doutes** au lieu de trancher à la place d'un locuteur. Elle n'écrit jamais
dans `frontend/src` : sa sortie est une liste de propositions en JSON, plus une
section de doutes numérotée prête à rejoindre
`frontend/src/i18n/alertes-emploi-revue-native.md`, qui reste **NON SIGNÉ**
tant qu'un humain n'a pas tranché.

## Ce qui est mesuré

| Fait | Valeur |
|---|---|
| Fichiers de dictionnaire lus | **14** (`core.js` exclu : il ne porte pas de texte) |
| Clés de page | **473** |
| Valeurs sous revue | **1 419** (473 × 3 langues) |
| Extraction (`exporter.mjs`) | **0,13 s** — 100 s avec la première version en `import()` de `data:` |
| Équipe | **3 à 4 agents, 3 à 4 tâches** (`crewai==1.15.33`) |
| Coût mesuré d'un lot | 30 valeurs × 1 langue = **11 774 caractères**, 3 appels (4 agents) ; 4 valeurs × 2 langues = **4 534 caractères**, 4 appels |

Pourquoi une extraction instrumentée : les modules n'exportent que
`makeScopedTranslator`, le dictionnaire est une constante privée. `exporter.mjs`
retire la ligne d'import (elle ne sert qu'à fabriquer le traducteur), retire les
`export` et évalue le corps avec `new Function` — on lit la **vraie** donnée,
sans regex sur du code et sans fichier temporaire.

## Ce que la CI juge déjà, et ce qui reste

Trois gardes tiennent les dictionnaires de PAGE depuis le 02/11/2026 :
`i18nCoverage.test.js` (chaque clé existe dans les cinq langues),
`i18nScopeHygiene.test.js` (aucun override identique au français, aucune clé
inutilisée) et **`i18nLanguePages.test.js`** — ajouté dans la même passe —, qui
résout chaque valeur par le vrai traducteur de son scope et refuse un mot
français certain (`adresse`, `tableau`, `bord`, `propriétaire`, `automatique`,
`inscription`, `bouton`, `fichier`). Ce dernier ne tolère que **quatre cas de
dette motivée** (10 valeurs, toutes dans les pages de diagnostic `photoTest` et
`mobileTest`), avec un plafond qui ne monte jamais et une entrée devenue inutile
qui fait rougir.

Ce que **aucun** test ne juge, et qui est le sujet de cet outil : le NATUREL et la
QUALITÉ grammaticale d'une phrase. « Tablo - komision boroom bi » passe tous les
gardes et peut parfaitement être du wolof boiteux — seul un locuteur le dit.

## Installation

Python **3.10 à 3.13** (le paquet refuse 3.14), et Node pour l'extraction.

```bash
cd outils/relecture-i18n
"/c/Users/user/AppData/Roaming/uv/python/cpython-3.11.17-windows-x86_64-none/python.exe" -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

`.venv/`, `sortie/` et `valeurs.json` sont ignorés par git.

## Les trois modes

```bash
# 1. Déterministe : ordonne le travail, n'envoie RIEN (sans crewai, sans jeton)
python relecture.py --verifier --max 5

# 2. Assemble l'équipe sans l'exécuter (sans jeton : hôte `.invalid` factice)
.venv/Scripts/python relecture.py --plan --max 5 --langues wo,bm

# 3. Relecture réelle, par lots
export NEON_AI_GATEWAY_BASE_URL=…   # branche Neon
export NEON_AI_GATEWAY_TOKEN=…      # jeton du gateway
.venv/Scripts/python relecture.py --executer --max 40 --langues wo
```

Options : `--langues wo,bm,mos`, `--fichiers register,profile`, `--max N`
(valeurs **par langue**, `0` = toutes), `--sortie DIR`, `--valeurs export.json`
(réutilise une extraction), `--plafond-caracteres`.

Le refus est explicite : au-delà du plafond (300 000 caractères par défaut),
l'outil s'arrête en nommant le dépassement au lieu d'envoyer la facture.

## Ce que l'outil écrit

| Fichier | Contenu |
|---|---|
| `sortie/differences.json` | propositions **validées**, avec l'avant, l'après, le motif, la confiance et les indices |
| `sortie/refusees.json` | propositions **refusées mécaniquement**, avec le motif du refus |
| `sortie/doutes.md` | section prête à coller, numérotée **à la suite** du fichier de revue |
| `sortie/rapport.md` | compte du lot, caractères envoyés, et ce que le rapport ne dit pas |

## Le garde qui ne dépend d'aucun modèle

Une proposition repasse dans `valider_proposition()` et est refusée si elle :
vide la valeur, la laisse inchangée, perd ou invente un `{placeholder}`, change
un chiffre, introduit une apostrophe droite, recopie le français, ajoute un saut
de ligne, ou triple la longueur affichée. Ces fautes cassent une page ; elles ne
sont donc jamais laissées à l'appréciation d'un modèle. `refusees.json` existe
pour qu'un refus se voie au lieu de disparaître.

Avant d'envoyer, `indices()` ordonne le lot (mot français resté, placeholder,
chiffre, allongement) et `note_pour_agent()` rappelle ce qui **n'est pas** une
faute : les emprunts assumés (`profil`, `email`, `client`…), les pièges (`du` est
la négation du wolof), et une valeur plus courte que le français, qui est la
règle dans ces trois langues.

## Télémétrie

crewai envoie des traces à `telemetry.crewai.com:4319` par défaut. Le module pose
`CREWAI_DISABLE_TELEMETRY=1` et `OTEL_SDK_DISABLED=true` **avant** l'import :
ce dépôt déclare ses sous-traitants (`backend/tests/test_sous_traitants_politique.py`)
et une télémétrie non demandée n'a rien à y faire.

## Preuve à blanc (sans jeton, sans réseau)

`faux_gateway.py` répond une complétion JSON choisie, contenant **une proposition
juste et deux invalides** (placeholder `{email}` perdu, valeur vide) sur le scope
`emailVerification`, que le lot `--max 0` contient par construction :

```bash
.venv/Scripts/python faux_gateway.py 8766 &
NEON_AI_GATEWAY_BASE_URL=http://127.0.0.1:8766/v1 \
NEON_AI_GATEWAY_TOKEN=test NEON_AI_GATEWAY_MODEL=faux-modele \
.venv/Scripts/python relecture.py --executer \
  --fichiers emailVerification --langues wo --max 0 --sortie /tmp/essai
```

Mesuré le 02/11/2026 sur ce chemin : `{"lot": 30, "propositions_recues": 3,
"validees": 1, "refusees": 2, "doutes": 1}` — refus nommés « placeholder perdu :
{email} » et « valeur vide » — quatre fichiers écrits, doute numéroté **37**
(la suite du fichier de revue), et `frontend/src` intact.

## Ce que cette équipe ne fait pas

- Elle ne **signe** pas une traduction : elle propose et elle doute.
- Elle ne relit pas 1 419 valeurs d'un coup : un lot est un échantillon
  priorisé, et `rapport.md` dit combien de valeurs sont hors lot.
- Elle n'applique rien. Appliquer demande un humain, et un commit.
- Elle n'est pas dans l'image de l'API, ni dans la CI de `backend/` : seule une
  garde y tourne (`backend/tests/test_relecture_i18n_crew.py`), sans crewai.
