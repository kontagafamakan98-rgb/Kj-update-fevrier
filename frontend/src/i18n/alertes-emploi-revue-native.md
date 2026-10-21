# Alertes emploi — revue par un locuteur natif (À FAIRE)

**Statut : NON SIGNÉ.** Les textes ci-dessous ont été revus et corrigés le
20/10/2026 sur des fautes de SENS repérables sans être locuteur (un verbe qui veut
dire « choisir » là où le bouton dit « activer », « prendre » là où le bouton dit
« activer », « dire » là où le message dit « enregistré »), puis les 84 valeurs
qui portaient encore le français ont été TRADUITES le même jour (§ « Traductions
du 20/10/2026 »). **Aucun locuteur natif du wolof, du bambara ou du mooré n'a
validé ces valeurs** : les traductions sont des PROPOSITIONS, avec leurs doutes
nommés un par un. Ce fichier existe pour que la relecture ait un support daté,
pas pour la déclarer faite.

La règle qui tient la mécanique est `frontend/src/utils/__tests__/i18nLangue.test.js` :
il juge **tout le dictionnaire** (et non plus les seules clés `jobAlert*`) et
refuse une valeur vide, une clé brute, une copie du français, une copie de
l'anglais, un mot français resté dans une phrase d'alerte emploi, un nom propre
ou une marque qui ne serait pas déclaré, et une déclaration (exception ou dette)
qui ne sert plus. Il ne juge PAS la qualité grammaticale — c'est exactement ce
que la relecture humaine doit couvrir.

## Ce qui a changé, et pourquoi

### Wolof (`src/i18n/wo.json`)

| Clé | Avant | Après | Motif |
|---|---|---|---|
| `jobAlertTitle` | Xibaar liggéey | **Alerta yu liggéey** | accord pluriel ; le bloc emploie déjà « alerta » partout ailleurs |
| `jobAlertIntro` | Jot na email ak notification bu liggéey mel ni li nga seet. | **Dinañu la yónnee email ak xibaar bu liggéey bu mel ni bi nga seet.** | phrase sans verbe conjugué, et « notification » en anglais là où le reste du fichier dit « xibaar » |
| `jobAlertActive` | Alerta bi dox na — dinaa jot email ak notification ci app bi. | **Alerta bi dox na — dinañu la yónnee email ak xibaar ci app bi.** | même raison ; « dinaa » = « je vais », la phrase est impersonnelle |
| `jobAlertCategory` | Xeet | **Xeetu liggéey** | « xeet » seul = ethnie/espèce ; le champ filtre une catégorie de métier |
| `jobAlertSave` | Tànn alerta bi | **Doxal alerta bi** | « tànn » = choisir, pas activer |
| `jobAlertStop` | Tëx alerta bi | **Taxawal alerta bi** | « tëx » = couper au couteau ; « taxawal » est déjà le verbe d'arrêt du fichier (`heroRotationPause`) |
| `jobAlertSaved` | Alerta bi ñu denc na ko | **Denc nañu alerta bi** | la forme « ñu … na ko » est agrammaticale |
| `jobAlertStopped` | Alerta bi tëx na | **Alerta bi taxaw na** | cohérent avec `jobAlertStop` |

### Bambara (`src/i18n/bm.json`)

| Clé | Avant | Après | Motif |
|---|---|---|---|
| `jobAlertIntro` | Email ni kibaru nafa i bɛɛ baara min bɛ i ɲini la. | **Ni baara min bɛ i ɲinini la sɔrɔla, i bɛ email ni kibaru sɔrɔ.** | « i bɛɛ » ne se construit pas ici ; phrase reconstruite en conditionnelle |
| `jobAlertActive` | Kumaseli baarakɛra — i bɛ email ni kibaru sɔrɔ app kɔnɔ. | **Kumaseli bɛ baara la — i bɛ email ni kibaru sɔrɔ app kɔnɔ.** | « baarakɛra » = « a travaillé » (passé) ; l'alerte est active au présent |
| `jobAlertCity` | Dugukolo | **Dugu** | « dugukolo » désigne un village/quartier ; le filtre porte sur une ville |
| `jobAlertSave` | Kumaseli dama | **Kumaseli daminɛ** | « dama » = ajouter ; « daminɛ » = commencer/activer |
| `jobAlertError` | Kumaseli mara tɛ se ka kɛ | **Kumaseli man se ka mara** | formulation impersonnelle correcte ; l'ancienne disait « la garde ne peut pas se faire » |
| `jobAlertUnavailable` | … sɔrɔ sisanni. | **… sɔrɔ sisan.** | orthographe de « maintenant » |

### Mooré (`src/i18n/mos.json`)

| Clé | Avant | Après | Motif |
|---|---|---|---|
| `jobAlertActive` | Kibare wã yaa wʋm — … | **Kibare wã tʋʋmda — …** | « yaa wʋm » n'est pas une prédication ; « tʋʋmda » = travaille/fonctionne |
| `jobAlertSave` | Kibare wã yiisi | **Kibare wã tʋʋm** | « yiisi » = sortir/retirer, l'inverse de l'action du bouton |
| `jobAlertSaved` | Kibare wã gomdame | **Kibare wã gũgame** | « gomde » = parler ; « gũ » = garder, ce que dit le message |
| `jobAlertError` | Kibare wã ka tõe n gom ye | **Kibare wã ka tõe n gũ ye** | même confusion : « ne peut pas parler » au lieu de « ne peut pas être gardé » |

## Ce que la relecture doit trancher (doutes assumés)

1. **Mooré, `jobAlertUpdate`** — « Kibare wã lebg zĩndi » (littéralement « que le
   message redevienne existant ») : la forme naturelle pour « mettre à jour » est-elle
   `lebs`, `tek`, ou autre ? Non modifiée faute de certitude.
2. **Mooré, `jobAlertIntro`** — « Yaa sɛɛ email la kibar … » : la tournure est-elle
   comprise comme « vous serez informé par email » ?
3. **Mooré, `jobAlertCategory` / `jobAlertCity`** — `Tʋʋm buud` et `Tẽngre`
   conviennent-ils pour un filtre « catégorie » / « ville » ?
4. **Bambara, `jobAlertStop` / `jobAlertStopped`** — `dati` / `datira` sont-ils les
   verbes usuels pour arrêter une alerte (par opposition à « couper ») ?
5. **Wolof, `jobAlertTitle`** — « Alerta yu liggéey » (pluriel) est-il préféré à
   « Xibaar yu liggéey » ? La classe nominale de `xibaar` a fait hésiter.
6. **Wolof, `jobAlertError`** — « Mënuloo denc alerta bi » (« tu ne peux pas
   enregistrer ») : garder la deuxième personne, ou une forme impersonnelle comme le
   français ?
7. **Emprunts** — `email`, `app`, `kibar`/`kibaru` sont conservés tels quels. Sont-ils
   les termes que vos utilisateurs emploient réellement ?

## Traductions du 20/10/2026 (PROPOSITIONS, à relire)

Étendre le garde au dictionnaire entier avait rendu visible ce que la portée
étroite laissait hors de tout juge : des clés récentes n'ont jamais été traduites
et portaient encore le texte français (page 404, pied de page légal, bloc contact
de l'accueil, description neutre, niveaux d'expérience, libellés de formulaire).
Ces valeurs sont traduites depuis le 20/10/2026 : `EN_ATTENTE` est VIDE et
`PLAFOND_EN_ATTENTE` vaut **0** dans les trois langues. Les 84 valeurs (31 `wo`,
27 `bm`, 26 `mos`) sont dans les dictionnaires ; ce qui suit est ce qu'un
locuteur doit relire en premier, et ce qui a été forgé.

### Les textes froids (relire EN PREMIER)

| Clé | Wolof | Bambara | Mooré |
|---|---|---|---|
| `homeContactText` | Ekib Kojo dafay tontu ci telefon, ci e-mail walla ci WhatsApp, bépp fan, ngir bépp laaj ci ab liggéey, ab fey walla sa konto. | Kojo jɛkulu bɛ i jaabi telefɔni, e-mail walima WhatsApp la, don o don, baara, wari walima i ka kontu ɲininkali bɛɛ kama. | Kojo team wã leokda foom telefon, e-mail walla WhatsApp pʋgẽ, daar fãa, tʋʋm, pãn walla f kõnta wɛɛngẽ sokr fãa yĩnga. |
| `notFoundTitle` / `…MetaTitle` | Xët bi gisul · Kojo | Page ma sɔrɔ · Kojo | Page wã ka pa yã · Kojo |
| `notFoundText` | Adarees bii amul ci Kojo. Liggéey bi man na tëj, walla lien bi matul. | Adɛrɛsi nin tɛ yen (walla a tɛ yen kɔrɔ) Kojo kan. Baara in bɛ se ka da, walima lien nin ma dafalen. | Adɛrɛs kãng ka be ye (bɩ a leb n ka be ye) Kojo zugu. Tʋʋmã tõe n saame, bɩ lien wã pa zems ye. |
| `neutralDescription` | Kojo dafa jëmmal kliyan ak liggéeykat yu xam-xam ci Afrik bu Sowwu : ndox, mbër, màkina, jëf-jëf, ordinatër ak yeneen. | Kojo bɛ kiliyanw ni baarakɛlaw dɔnbagaw jɛɲɔgɔnya Afiriki Kɔrɔn fɛ : ji baara, kuran baara, mɔbili baara, jɔli, ɔridinatɛri baara ni dɔw. | Kojo lagmda daab-rãmba la tʋʋm-neb sẽn tar bãngr Afirik Rɩtgo : koom tʋʋmã, kuurã tʋʋmã, moto tʋʋmã, metɛr tʋʋmã, ɔrdinatɛɛr tʋʋmã la a taaba. |
| `footerPrivacy` | Politik kaaraange | Kunnafoni kɔlɔsili sariya | Sõngre pʋɩɩre sariya |
| `footerTerms` | Yoon yi ñu lay jëfandikoo | Baara sariyaw | Tʋʋm sariyã |
| `footerItinerary` | Yoon bi | Sira | Sore |
| `mapIframeTitle` | Kart · Kojo, {address} | Kart · Kojo, {address} | Kɑɑrt · Kojo, {address} |
| `notFoundJobsLink` | Xool liggéey yi am | Baaraw jira | Ges tʋʋm sẽn be |
| `homeContactCall` / `…Follow` | Woote ndimbal / Toppal ñu | Weele dɛmɛni / Anw nɔfɛ | Boole sõngre / Pʋg tõnd |

Les libellés courts (`experience*`, `reviewsCount`, `branchLabel`,
`branchOptional`, `bankLabel`, `feesLabel`, `camera`, `phone`, `profile`,
`free`, `instantLabel`, `carpentry`, `platformCommission`, `paymentCommission`,
`forgotPasswordEmailLabel`, `radiusKmPlaceholder`) sont traduits dans le même
passage ; les termes sur lesquels un locuteur doit trancher sont listés ci-dessous.

### Un fait faux trouvé EN PASSANT, et corrigé

`contactIntro` et `homeAboutText2` de `wo` disaient « **altine ba gaawu** » et
ceux de `bm` « **ntɛnɛn ni sibiri ntɛm** » — c'est-à-dire **du lundi au samedi**.
Le 07/10/2026, ce fait a été rectifié en « sept jours sur sept »… et le garde qui
le tient (`scripts/__tests__/faits-support.test.js`) ne connaissait que les formes
FRANÇAISES et ANGLAISES : il ne pouvait pas voir la même affirmation écrite en
wolof ou en bambara. Les quatre valeurs disent maintenant « **bépp fan** » /
« **don o don** » (tous les jours), et le garde refuse désormais les deux formes
locales mesurées. `mos` disait « tɩtd buud(u) », remplacé par « **daar fãa** » :
la formule d'origine ne dit pas sept jours sur sept, mais sa signification exacte
(tous les jours ? un cycle de marché ?) demande un locuteur — voir doute 8.

### Doutes à trancher (chaque terme forgé est nommé)

1. **Wolof, `carpentry` = « Sëq »** (bois). Les autres métiers sont donnés par un
   nom court (`Ndox`, `Mbër`, `Màkina`) ; « sëq » seul se comprend-il comme le
   métier, ou faut-il « Sëq liggéey » ?
2. **Mooré, `carpentry` = « Rãad tʋʋmã »** : « rãad » est-il bien le bois (et non
   l'arbre ou la tôle) ? C'est le terme le plus incertain du lot.
3. **Wolof, `notFoundTitle` = « Xët bi gisul »** : « xët » (feuille, fiche) est
   employé par le dictionnaire pour une fiche ; désigne-t-il une page web ?
   Alternative possible : garder l'emprunt « Page bi gisul ».
4. **Bambara/mooré, `notFoundTitle`** gardent l'emprunt « Page » (« Page ma
   sɔrɔ », « Page wã ka pa yã ») : faute d'un mot local établi, c'est assumé.
5. **Wolof, `feesLabel` = « Fey »** (payer/paiement) pour « Frais » : le coût et
   l'acte de payer se confondent peut-être. Noter que `transactionFees` dit
   toujours « Frais transaction » — deux vocabulaires à réconcilier.
6. **Wolof/Bambara/Mooré, `branchLabel` = « Bérab bank » / « Banki yɔrɔ » /
   « Bãnk zĩig »** (le lieu de la banque, faute d'un mot local pour « agence »).
   Compréhensible comme une adresse d'agence ?
7. **`experience20plus`** : « Lu ëpp 20 at » (`wo`), « San 20 kɔ » (`bm`).
   « Yʋʋm sẽn yɩɩd 20 » (`mos`). La forme « 20+ » serait-elle plus claire ?
8. **Mooré, « daar fãa »** (tous les jours) — voir la section précédente : la
   formule remplacée (« tɩtd buud ») n'était pas sept jours sur sept, mais la
   bonne façon de le dire au quotidien reste à confirmer.
9. **`reviewsCount`** utilise « nottu » (`wo`) et « nɔt » (`bm`/`mos`), comme les
   phrases voisines (`noReviewsYet`) ; « avis » reste employé tel quel ailleurs.
   Faut-il unifier ?
10. **Emprunts DÉCLARÉS** (dans `EXCEPTIONS`, famille « emprunt ») : `Profil`
    (`wo`), `Bank` (`wo`), `Rayon (km)` (les trois langues — la phrase traduite
    d'à côté, `radiusActivateHint`, dit « rayon bi »). Les remplacer par des mots
    forgés ferait deux vocabulaires pour un seul objet.
11. **Mooré, `homeContactText`** dit « Kojo team wã » : « team » est un emprunt,
    comme dans `faq4a` (valeur déjà traduite). Un mot local existe-t-il ?
12. **Wolof, « Ekib Kojo »** — le dictionnaire hésite déjà entre « ekib »
    (`contactMetaDescription`) et « équipe » (`faq4a`). À unifier.
13. **Mooré, `feesLabel` = « Yaood »** et **bambara, « Sara »** : ces mots
    disent « paiement » ; pour une colonne « frais », est-ce le terme juste ?

## Badge « moyens de paiement renseignés » (21/10/2026)

Le badge s'appelait « Vérifié » / « Verified » / « Saytu nañu ko » /
« Lakɔlɔsila » / « Gesg-m-meng », avec l'infobulle « Identité vérifiée
(email) ». `is_verified` ne dit pourtant RIEN de l'identité : il est posé par
l'ajout des comptes de paiement (`kojo_validation.py`), et l'email vérifié a son
propre champ (`email_verified`). Les trois clés (`verified`, `verifiedBadge`,
`verifiedBadgeTitle`) sont supprimées des cinq dictionnaires ; ce sont
`paymentMethodsOnFile` (le libellé), `paymentMethodsNone` (l'absence, profil) et
`paymentMethodsBadgeTitle` (l'infobulle) qui les remplacent, et
`utils/__tests__/badgePaiementHonnete.test.js` refuse leur retour.

Valeurs proposées : `wo` « Konte fey yu ñu bind » / « Amul konte fey » /
« Konte fey yu ñu bind — identité bi saytuwul » ; `bm` « Sara fɛɛrɛw
sɛbɛnnenw » / « Sara fɛɛrɛ sɛbɛnnen si tɛ » / « … — identité ma lakɔlɔsi » ;
`mos` « Yaool soaya sẽn bee » / « Yaool soaya ka be ye » / « … — identité ka ges
ye ».

Doutes, à trancher par un locuteur :

14. **`wo`, « bind » pour « renseigné »** : le dictionnaire l'emploie pour
    « écrire / s'inscrire » (`register`, `registerFailed`, `referralText`).
    Dit-il un compte qu'on a renseigné, ou seulement un formulaire rempli ?
15. **`wo`, « saytuwul »** : forme forgée sur « saytu » (examiner, cf.
    `payStatusPending`) + le suffixe négatif attesté (`Fey bi antuwul`). La
    négation est-elle la bonne ici (« l'identité n'a pas été examinée ») ?
16. **`bm`, « ma lakɔlɔsi »** : négatif perfectif, sur le modèle de
    `Sariya-faga ma kɛ` (« le paiement n'a pas eu lieu »). Même question.
17. **`mos`, « sẽn bee »** (« qui sont là ») pour « renseignés » : la formule
    dit l'existence, pas l'enregistrement. Un terme de saisie existe-t-il ?
18. **Les trois langues gardent l'emprunt « identité »** dans l'infobulle,
    comme l'ancienne valeur (déjà « Identité » nue en `wo`/`bm`/`mos`). C'est
    assumé faute d'un mot local établi — et c'est le terme que le doute 16 de
    la relecture devra confirmer.

## Comment contresigner

Corriger directement les trois dictionnaires, puis remplacer le statut ci-dessus
par « Signé par … le … ». Le garde `i18nLangue.test.js` doit rester vert : il
refuse toujours une valeur laissée en français ou en anglais, il exige que la
dette déclarée corresponde à ce qui reste réellement non traduit (elle est vide),
et il exige qu'une exception déclarée soit encore employée — une exception
périmée rougit.

Ce que la relecture doit faire, dans cet ordre : trancher les doutes ci-dessus,
puis relire les textes froids sur la page réelle (404, pied de page, bloc
contact de l'accueil, aperçu de lien) — ce sont ceux qu'un visiteur lit sans
compte et sans avoir rien demandé.
