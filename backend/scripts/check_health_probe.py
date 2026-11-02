#!/usr/bin/env python3
"""
Sonde de surveillance continue du backend Kojo en production.

Vérifie :
1. La disponibilité HTTP de l'endpoint /health (statut 200).
2. L'état global du backend (`status: healthy`).
3. L'état de connexion à la base MongoDB (`database: connected`).
4. L'état du disjoncteur PayDunya (`paydunya_circuit.state: closed`).
   Échoue si le circuit est ouvert ('open') ou si la base est déconnectée.
5. Le fournisseur email ACTIF : `/monitor/email` doit répondre 200 — un 503
   nomme la panne (`provider`, `configured`, `detail`) : clé refusée,
   transport coupé, domaine Resend non vérifié, expéditeur Brevo inactif,
   jeton Gmail révoqué, ou `EMAIL_PROVIDER=none`. Sans cette vérification, un
   fournisseur muet n'était constaté que par un utilisateur qui attend son code.
6. Le healthcheck composite `/monitor` : un 503 (au moins `threshold`
   fournisseurs down) échoue et nomme les fournisseurs down ; un seul
   fournisseur transitoirement down est publié en WARN, sans échec — c'est le
   contrat du seuil (une panne isolée qui flappe n'alerte pas).
7. Le DIAGNOSTIC DE PAIEMENT (`paiement` de /health, 31/10/2026) : la paire
   `closed` / 0 échec ne distinguait pas « clés absentes », « configuré, jamais
   exercé » et « dernier paiement réussi ». Le bloc les sépare ; la sonde
   refuse un bloc absent (révision à redéployer), un champ manquant,
   `configured: false`, `state: echec` (en publiant son motif) et toute
   contradiction entre les deux lectures du même circuit — `inconnu` est
   publié en WARN, parce que zéro vente n'est pas une panne.
8. Les LANGUES SERVIES (`langues` de /health, 01/11/2026) : le nombre de
   langues indexées et, pour chacune, le nombre de documents que le sitemap
   publie — la question que la sonde `hreflang` met 61 requêtes et 11 s à
   trancher. Un bloc absent est un refus nommé (révision antérieure), un volume
   qui ne tombe pas juste aussi.
9. LE VOLUME SERVI (02/11/2026) : le bloc `langues` est une DÉCLARATION, et
   rien ne disait qu'un artefact SERVI la portait. La sonde demande donc
   `GET /api/sitemap.xml` — une requête — et confronte ses trois en-têtes
   (`X-Kojo-Urls`, `-Declarees`, `-Vivantes`) ET le nombre de `<loc>` réellement
   écrits à `pages.declarees` de `/health`. Un sitemap illisible, un en-tête
   absent (révision antérieure) ou un corps qui ne porte pas le volume annoncé
   sont trois refus nommés. Ce qu'elle ne dit toujours pas, et qui garde son
   propriétaire : le `lang`, le `canonical` et la réciprocité des 60 documents
   HTML se lisent dans `frontend/scripts/check-hreflang-production.js`, un cron
   que la MÊME alerte des sondes relève — ici on juge le VOLUME, là où il est
   écrit.

Les deux moniteurs sont dérivés de l'origine de `--url`, donc un seul drapeau
suffit ; ils vivent hors `/api` comme `/health`.

Usage :
    python backend/scripts/check_health_probe.py [--url https://api.kojoforafrica.cc.cd/health]
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request
import urllib.error

DEFAULT_HEALTH_URL = "https://api.kojoforafrica.cc.cd/health"
CHEMIN_MONITEUR_EMAIL = "/monitor/email"
CHEMIN_MONITEUR_COMPOSITE = "/monitor"
# Le sitemap est le SEUL artefact SERVI qui publie le volume des pages ; les
# trois en-tetes viennent de `kojo_routers_public` (GET /api/sitemap.xml).
CHEMIN_SITEMAP = "/api/sitemap.xml"
ENTETES_SITEMAP = ("X-Kojo-Urls", "X-Kojo-Urls-Declarees", "X-Kojo-Urls-Vivantes")
AGENT = "KojoHealthMonitor/1.0"

# Les champs que le bloc `paiement` doit porter pour qu'un diagnostic soit
# possible. Un bloc amputé (déploiement partiel, sérialisation oubliée) ne se
# juge pas à moitié : il est refusé en nommant ce qui manque.
CHAMPS_PAIEMENT = (
    "configured",
    "state",
    "circuit",
    "cause",
    "motif",
    "consecutive_failures",
    "failure_threshold",
    "remaining_cooldown_seconds",
)

# Les champs que le bloc `langues` doit porter (01/11/2026). Un bloc amputé ne se
# juge pas à moitié : il est refusé en nommant ce qui manque.
CHAMPS_LANGUES = (
    "indexees",
    "defaut",
    "documents_par_langue",
    "urls_par_langue",
    "pages",
    "alternatives_par_page",
    "portee",
)

# Les champs que le sous-bloc `pages` doit porter (02/11/2026). `total` a ete
# RENOMME en `declarees` + `vivantes` le 01/11 : un champ nomme « total »
# affirmait une egalite avec le sitemap que le sitemap servait fausse — il
# AJOUTE une entree par fiche de mission ouverte et par profil public, lues en
# base, donc 85 URL servies pour 80 declarees. La sonde lisait encore `total`
# et a accuse la production d'une contradiction qui n'existait que chez elle,
# du 01/11 au 02/11 : un jour de rouge, nomme par l'alerte des sondes sans que
# la cause se lise. `backend/tests/test_health_probe.py` compare cette liste aux
# cles REELLEMENT publiees par `kojo_sitemap_declaration.bloc_langues`, donc un
# prochain renommage rougit au lieu de refaire la meme panne muette.
CHAMPS_PAGES = ("multilingues", "monolingues", "declarees", "vivantes")

# Les champs que le bloc `erreurs` doit porter (02/11/2026). Meme regle que
# ci-dessus : un bloc ampute se refuse en nommant ce qui manque, il ne se juge
# pas a moitie. `backend/tests/test_health_probe.py` compare cette liste aux
# cles REELLEMENT publiees par `kojo_erreurs.diagnostic`, donc un renommage
# rougit au lieu de refaire la panne muette du 01/11 au 02/11.
CHAMPS_ERREURS = (
    "state",
    "total",
    "derniere_at",
    "classe",
    "famille",
    "classes",
    "depuis",
    "portee",
)


def _origine(url: str) -> str:
    """Origine (scheme://host[:port]) d'une URL, sans chemin ni requête."""
    morceaux = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((morceaux.scheme, morceaux.netloc, "", "", ""))


def _url_de(origine: str, chemin: str) -> str:
    return origine.rstrip("/") + chemin


def _lire_moniteur(url: str, timeout: int):
    """Lit un moniteur : rend `(payload, statut, erreur)` — jamais d'exception.

    Un 503 est un VERDICT, pas une panne de la sonde : le corps JSON porte le
    détail qui nomme la cause, et c'est lui qui doit sortir dans l'échec. Le
    statut est rendu AVEC le corps, sans quoi on ne saurait pas distinguer
    « dégradé sous le seuil » (200) de « au-delà du seuil » (503).
    """
    req = urllib.request.Request(
        url,
        headers={"User-Agent": AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            statut = response.status
            corps = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        corps = ""
        try:
            corps = e.read().decode("utf-8")
        except Exception:
            pass
        if e.code == 503:
            try:
                return json.loads(corps), 503, ""
            except json.JSONDecodeError:
                return None, 503, f"HTTP 503 sans corps JSON lisible : {corps[:200]}"
        if e.code == 404:
            return None, 404, "HTTP 404 : le backend deploye ne porte pas encore cette sonde"
        return None, e.code, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        return None, None, f"injoignable : {e.reason}"
    except Exception as e:
        return None, None, str(e)

    try:
        return json.loads(corps), statut, ""
    except json.JSONDecodeError as e:
        return None, statut, f"reponse JSON invalide : {e}"


def _verifier_email(origine: str, timeout: int) -> list:
    """`/monitor/email` : le fournisseur ACTIF peut-il réellement envoyer ?

    Échoue sur un 503 (le corps nomme la cause) et sur un corps qui contredit le
    statut — une sonde qui répond 200 en disant « down » serait exactement le
    silence qu'on veut fermer.
    """
    url = _url_de(origine, CHEMIN_MONITEUR_EMAIL)
    print(f"[PROBE] Fournisseur email actif : {url}")
    payload, statut, erreur = _lire_moniteur(url, timeout)

    if payload is None:
        print(f"[ERREUR] Sonde email inutilisable : {erreur}")
        return [f"Sonde email /monitor/email inutilisable : {erreur}"]

    provider = payload.get("provider") or "?"
    if statut == 200 and payload.get("circuit") == "ok":
        print(f"[OK] Email : fournisseur actif '{provider}' operationnel ({payload.get('detail', '')})")
        return []

    detail = payload.get("detail") or "aucun detail"
    configure = payload.get("configured")
    print(f"[ERREUR] Email : fournisseur actif '{provider}' NON OPERATIONNEL "
          f"(HTTP {statut}, configure={configure})")
    print(f"   Detail : {detail}")
    note = payload.get("provider_note")
    if note:
        print(f"   Configuration : {note}")
    # Un statut et un verdict qui se contredisent ne disent pas que le
    # fournisseur est tombe, mais que la sonde elle-meme est incoherente — dans
    # les deux sens (200 dit 'down', 503 dit 'ok').
    informe_ok = statut == 200
    verdict_ok = payload.get("circuit") == "ok"
    if informe_ok != verdict_ok:
        return [
            f"Sonde email incoherente : HTTP {statut} pour circuit={payload.get('circuit')!r} ({detail})"
        ]
    return [f"FOURNISSEUR EMAIL MUET (provider={provider}, configure={configure}) : {detail}"]


def _verifier_composite(origine: str, timeout: int, fournisseurs=None) -> list:
    """`/monitor` : la panne est-elle agrégée au point de déclencher l'alerte ?

    Le seuil décide : un 503 est un échec (au moins `threshold` fournisseurs
    down) ; un 200 « dégradé » est publié en WARN, parce qu'une panne isolée qui
    flappe ne doit pas alerter — c'est le contrat du composite.

    `fournisseurs`, quand il est fourni, reçoit les `providers` lus : c'est une
    SECONDE lecture du même circuit PayDunya dans la même passe, et
    `_verifier_paiement` la confronte au bloc `paiement` de /health. Aucune
    requête supplémentaire n'est faite pour cela.
    """
    url = _url_de(origine, CHEMIN_MONITEUR_COMPOSITE)
    print(f"[PROBE] Healthcheck composite : {url}")
    payload, statut, erreur = _lire_moniteur(url, timeout)

    if payload is None:
        print(f"[ERREUR] Healthcheck composite inutilisable : {erreur}")
        return [f"Healthcheck composite /monitor inutilisable : {erreur}"]

    providers = payload.get("providers") or {}
    if fournisseurs is not None:
        fournisseurs.update(providers)
    down = [
        nom for nom, info in providers.items()
        if isinstance(info, dict) and info.get("circuit") not in (None, "ok")
    ]
    total = payload.get("total")
    seuil = payload.get("threshold")

    if statut == 200 and payload.get("circuit") == "ok":
        print(f"[OK] Composite : {total} fournisseur(s), aucun en panne (seuil {seuil})")
        return []

    if not down:
        # Un échec sans fournisseur down : le corps ne dit pas la panne, on
        # refuse de conclure plutôt que d'inventer un coupable.
        return [f"Healthcheck composite en echec (HTTP {statut}) sans fournisseur down identifiable"]

    if statut == 200:
        print(f"[WARN] Composite degrade : {', '.join(down)} "
              f"(down={payload.get('down')}/{total}, seuil {seuil}) : sous le seuil, pas d'echec")
        return []

    print(f"[ERREUR] Composite au-dela du seuil : {', '.join(down)} "
          f"(down={payload.get('down')}/{total}, seuil {seuil})")
    return [f"PRODUCTION DEGRADEE : {len(down)} fournisseur(s) down : {', '.join(down)}"]

def _verifier_langues(data: dict) -> list:
    """Le bloc `langues` de /health : combien de langues, et combien de documents.

    CE QU'IL FERME (01/11/2026). La question « combien de langues le site sert-il,
    et combien de documents chacune ? » ne se lisait qu'en lançant la sonde
    `hreflang` sur la production : 61 requêtes et 11 s. `/health` publie
    desormais la DECLARATION du sitemap, et cette sonde la juge : un bloc absent
    (revision anterieure au deploiement) est un refus nomme, pas un silence, et
    un volume qui ne tombe pas juste est un refus — un compte faux se lit comme
    une couverture, ce qui est pire que pas de compte du tout.

    Ce que la sonde NE juge PAS, et qui reste a la sonde `hreflang` : le `lang`
    des documents servis, leur `canonical` et la reciprocite des alternatives.
    Le bloc dit ce que le sitemap ENUMERE ; l'origine du site dit ce qu'elle
    SERT, et ce sont deux faits differents.
    """
    bloc = data.get("langues")
    if not isinstance(bloc, dict):
        return [
            "le backend deploye ne publie pas de bloc 'langues' dans /health : le "
            "volume des langues servies n'est pas lisible — la revision servie est "
            "anterieure a ce bloc, redeployer"
        ]

    manquants = [champ for champ in CHAMPS_LANGUES if champ not in bloc]
    if manquants:
        return [f"bloc 'langues' incomplet : champ(s) absent(s) {', '.join(manquants)}"]

    codes = bloc.get("indexees")
    if not isinstance(codes, list) or len(codes) < 2:
        return [
            "bloc 'langues' : 'indexees' doit etre une liste d'au moins deux codes "
            f"(lu : {codes!r}) — un site monolingue n'a pas de hreflang a publier"
        ]

    erreurs = []
    defaut = bloc.get("defaut")
    if defaut not in codes:
        erreurs.append(f"bloc 'langues' : la langue par defaut {defaut!r} n'est pas indexee")

    documents = bloc.get("documents_par_langue") or {}
    urls = bloc.get("urls_par_langue") or {}
    for nom, table in (("documents_par_langue", documents), ("urls_par_langue", urls)):
        if not isinstance(table, dict) or set(table) != set(codes):
            erreurs.append(
                f"bloc 'langues' : '{nom}' ne couvre pas exactement les langues "
                f"declarees ({sorted(set(table) ^ set(codes))} en ecart)"
            )
    if erreurs:
        return erreurs

    muettes = [code for code in codes if int(documents.get(code) or 0) < 1]
    if muettes:
        erreurs.append(
            "bloc 'langues' : " + ", ".join(muettes) + " n'annonce aucun document — "
            "une langue sans document n'a pas d'URL a servir"
        )

    total_urls = sum(int(nombre or 0) for nombre in urls.values())
    pages = bloc.get("pages")
    if not isinstance(pages, dict):
        erreurs.append(
            "bloc 'langues' : 'pages' n'est pas un objet — le volume par famille "
            f"n'est pas lisible (lu : {pages!r})"
        )
    else:
        manquants_pages = [champ for champ in CHAMPS_PAGES if champ not in pages]
        if manquants_pages:
            erreurs.append(
                "bloc 'langues' : 'pages' ne porte pas "
                + ", ".join(manquants_pages)
                + " — un volume ampute ne se juge pas (champs attendus : "
                + ", ".join(CHAMPS_PAGES)
                + ")"
            )
        elif pages.get("declarees") != total_urls:
            erreurs.append(
                "/health se contredit : pages.declarees="
                f"{pages.get('declarees')!r} mais urls_par_langue totalise "
                f"{total_urls} — les deux decrivent le MEME ensemble de pages "
                "declarees (les fiches et profils vivants sont hors de ce compte)"
            )

    if not str(bloc.get("portee") or "").strip():
        erreurs.append(
            "bloc 'langues' : 'portee' est vide — un volume publie sans portee se "
            "lit comme une mesure des documents servis"
        )

    if not erreurs:
        par_langue = documents.get(codes[0])
        print(
            f"[OK] Langues : {len(codes)} ({', '.join(codes)}), {par_langue} document(s) "
            f"par langue, {sum(int(nombre or 0) for nombre in urls.values())} URL publiee(s)"
        )
    return erreurs


def _entete(headers, nom: str):
    """Une en-tete HTTP, quelle que soit la casse rendue par le client."""
    try:
        valeur = headers.get(nom)
        if valeur is None:
            valeur = headers.get(nom.lower())
        return valeur
    except Exception:  # noqa: BLE001 - un objet d'en-tetes inattendu ne juge pas
        return None


def _lire_sitemap(origine: str, timeout: int):
    """Lit le sitemap servi : `(entetes, nombre de <loc>, statut, erreur)`."""
    url = _url_de(origine, CHEMIN_SITEMAP)
    req = urllib.request.Request(
        url, headers={"User-Agent": AGENT, "Accept": "application/xml"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            statut = response.status
            corps = response.read()
            entetes = {nom: _entete(response.headers, nom) for nom in ENTETES_SITEMAP}
    except urllib.error.HTTPError as e:
        return {}, 0, e.code, "HTTP %d sur %s" % (e.code, CHEMIN_SITEMAP)
    except urllib.error.URLError as e:
        return {}, 0, None, "injoignable : %s" % (e.reason,)
    except Exception as e:  # noqa: BLE001 - une lecture qui casse reste une lecture
        return {}, 0, None, str(e)
    if statut != 200:
        return {}, 0, statut, "HTTP %d inattendu sur %s" % (statut, CHEMIN_SITEMAP)
    return entetes, corps.count(b"<loc>"), statut, ""


def _verifier_sitemap(origine: str, data: dict, timeout: int) -> list:
    """Le sitemap SERVI confronte le volume DECLARE par `/health`.

    CE QU'IL FERME (02/11/2026). Le bloc `langues` est une DÉCLARATION : la sonde
    verifiait son arithmetique interne, jamais qu'un artefact servi la portait.
    Un backend en retard sur le frontend, ou un sitemap qui annonce un volume
    que son corps ne contient pas, restait donc invisible ici. Une requete suffit
    a confronter les TROIS chiffres servis (`X-Kojo-Urls*`) et le nombre de
    `<loc>` reellement ecrits a `pages.declarees`.

    Ce que cette confrontation ne fait PAS, et qui garde son proprietaire : le
    `lang`, le `canonical` et la reciprocite des `hreflang` des 60 documents
    servis se lisent dans `frontend/scripts/check-hreflang-production.js`, un
    cron que la MEME alerte des sondes releve. Ici on juge le VOLUME servi, la
    ou ce volume est ecrit.
    """
    bloc = data.get("langues")
    pages = (bloc.get("pages") or {}) if isinstance(bloc, dict) else {}
    declarees = pages.get("declarees") if isinstance(pages, dict) else None

    entetes, locs, _statut, erreur = _lire_sitemap(origine, timeout)
    if erreur:
        return [
            "sitemap %s illisible (%s) : le volume declare par /health n'a pas ete "
            "confronte a l'artefact servi" % (CHEMIN_SITEMAP, erreur)
        ]

    manquantes = [
        nom for nom in ENTETES_SITEMAP if not str(entetes.get(nom) or "").strip()
    ]
    if manquantes:
        return [
            "sitemap : en-tete(s) %s absent(s) — la revision servie est anterieure "
            "au volume publie par GET %s, redeployer"
            % (", ".join(manquantes), CHEMIN_SITEMAP)
        ]

    try:
        total = int(entetes["X-Kojo-Urls"])
        declarees_servies = int(entetes["X-Kojo-Urls-Declarees"])
        vivantes = int(entetes["X-Kojo-Urls-Vivantes"])
    except (TypeError, ValueError):
        return [
            "sitemap : en-tetes X-Kojo-Urls* non numeriques (%r) — le volume servi "
            "n'est pas lisible"
            % (entetes,)
        ]

    erreurs = []
    if declarees is not None and declarees_servies != declarees:
        erreurs.append(
            "sitemap : X-Kojo-Urls-Declarees=%d mais /health declare %s page(s) — "
            "la declaration et l'artefact servi ne decrivent pas le meme ensemble"
            % (declarees_servies, declarees)
        )
    if total != declarees_servies + vivantes:
        erreurs.append(
            "sitemap : X-Kojo-Urls=%d alors que declarees (%d) + vivantes (%d) = %d "
            "— le volume servi est incoherent"
            % (total, declarees_servies, vivantes, declarees_servies + vivantes)
        )
    if locs != total:
        erreurs.append(
            "sitemap : %d <loc> servis pour X-Kojo-Urls=%d — l'en-tete annonce un "
            "volume que le corps ne porte pas" % (locs, total)
        )

    if not erreurs:
        print(
            "[OK] Sitemap servi : %d URL dont %d vivante(s) — concorde avec les %s "
            "page(s) declarees par /health" % (locs, vivantes, declarees)
        )
    return erreurs


def _verifier_erreurs(data: dict) -> list:
    """Le bloc `erreurs` de /health : ce qui a cassé, et quand (02/11/2026).

    CE QU'IL FERME. `sentry: inactif` disait qu'une exception non rattrapée ne
    remontait nulle part — le site pouvait rendre 500 toute une journée sans
    qu'aucune sonde ne le voie, puisque les sondes demandent les routes qui
    répondent. Le bloc publie le compte du PROCESS, et cette sonde le juge :

      * bloc absent → refus nommé (révision antérieure au 02/11/2026, à
        redéployer) ;
      * `portee` vide → refus : un compte sans durée se lit comme un historique,
        et ces compteurs repartent à zéro à chaque déploiement ;
      * une CONTRADICTION entre `state` et `total` (l'un dit ok, l'autre compte
        des erreurs) → refus : deux lectures du même fait ne peuvent pas
        diverger ;
      * `total > 0` → refus qui NOMME la classe, la famille de route et la date,
        parce qu'une exception non rattrapée est un défaut, pas un état : elle a
        rendu 500 à quelqu'un. Le message de l'exception n'est pas publié par
        `/health` — la sonde dit donc quoi chercher dans le journal Fly.

    Ce qu'elle ne dit pas, et qui reste vrai : le compteur est celui du process
    qui répond ; un worker qui redémarre repart à zéro.
    """
    erreurs: list = []
    bloc = data.get("erreurs")
    if not isinstance(bloc, dict) or not bloc:
        return [
            "le backend deploye ne publie pas de bloc 'erreurs' dans /health : les "
            "exceptions non rattrapees ne sont pas lisibles — la revision servie est "
            "anterieure au 02/11/2026, redeployer"
        ]

    manquants = [champ for champ in CHAMPS_ERREURS if champ not in bloc]
    if manquants:
        return [f"bloc 'erreurs' incomplet : champ(s) absent(s) {', '.join(manquants)}"]

    portee = str(bloc.get("portee") or "").strip()
    if not portee:
        erreurs.append(
            "bloc 'erreurs' : 'portee' est vide — un compte sans duree se lit comme un "
            "historique alors que les compteurs repartent a zero a chaque demarrage"
        )

    total = bloc.get("total")
    etat = bloc.get("state")
    if not isinstance(total, int) or isinstance(total, bool) or total < 0:
        erreurs.append(f"bloc 'erreurs' : 'total' doit etre un entier >= 0 (lu {total!r})")
    if etat not in ("ok", "echec"):
        erreurs.append(f"bloc 'erreurs' : 'state' inconnu {etat!r} (attendu 'ok' ou 'echec')")

    if isinstance(total, int) and not isinstance(total, bool) and total >= 0:
        if etat == "ok" and total > 0:
            erreurs.append(
                f"bloc 'erreurs' : 'state' dit ok alors que 'total' vaut {total} — deux "
                f"lectures du meme fait se contredisent"
            )
        elif etat == "echec" and total == 0:
            erreurs.append(
                "bloc 'erreurs' : 'state' dit echec alors que 'total' vaut 0 — deux "
                "lectures du meme fait se contredisent"
            )
        elif total > 0:
            classe = bloc.get("classe") or "(classe non nommee)"
            famille = bloc.get("famille") or "(route non nommee)"
            quand = bloc.get("derniere_at") or "(date absente)"
            par_classe = ", ".join(
                f"{entree.get('classe')}={entree.get('total')}"
                for entree in (bloc.get("classes") or [])
                if isinstance(entree, dict)
            )
            erreurs.append(
                f"ERREURS NON RATTRAPEES : {total} exception(s) depuis le demarrage, la "
                f"derniere {classe} sur {famille} a {quand}"
                + (f" (par classe : {par_classe})" if par_classe else "")
                + " — une exception a rendu 500 a un visiteur ; son message est dans le "
                "journal Fly (cf. /metrics, kojo_erreurs_serveur_total)"
            )
        else:
            print(
                "[OK] Erreurs non rattrapees : aucune depuis le demarrage"
                + (f" ({bloc.get('depuis')})" if bloc.get("depuis") else "")
            )

    return erreurs


def _verifier_paiement(data: dict, paydunya_composite=None) -> list:
    """Le bloc `paiement` de /health : TROIS états, pas deux.

    CE QU'IL FERME (31/10/2026). `/health` ne publiait que
    `paydunya_circuit: {state: closed, consecutive_failures: 0}` — la MÊME
    lecture pour « les clés sont absentes, aucun paiement ne peut aboutir »,
    « les clés sont posées et aucun paiement n'a eu lieu » et « le dernier
    paiement a réussi ». L'audit du 31/10 l'a écrit tel quel. Le bloc `paiement`
    sépare ces trois cas ; cette sonde le JUGE, sinon le fait serait publié pour
    personne.

    ÉCHEC (nommé) : bloc absent — la révision servie est antérieure au
    diagnostic, il faut redéployer —, champ manquant, `configured: false`,
    `state: echec` (le motif est publié, un échec sans remède ne se répare pas),
    et toute CONTRADICTION entre les deux lectures du même circuit dans la même
    réponse (`paydunya_circuit` contre `paiement`) ou avec le composite.

    PAS un échec : `state: inconnu` — « configuré, jamais exercé » est le fait
    d'un site qui n'a pas encore vendu, pas une panne ; il est PUBLIÉ. Et
    `state: ok` publie le statut et la date du dernier appel réussi.
    """
    bloc = data.get("paiement")
    if not isinstance(bloc, dict):
        return [
            "le backend deploye ne publie pas de bloc 'paiement' dans /health : la "
            "revision servie est anterieure au diagnostic de paiement — redeployer"
        ]

    manquants = [champ for champ in CHAMPS_PAIEMENT if champ not in bloc]
    if manquants:
        return [f"bloc 'paiement' incomplet : champ(s) absent(s) {', '.join(manquants)}"]

    erreurs = []
    configure = bloc.get("configured")
    etat = bloc.get("state")
    circuit_paiement = bloc.get("circuit")
    cause = bloc.get("cause") or ""
    motif = (bloc.get("motif") or "").strip()

    if etat not in ("ok", "echec", "inconnu"):
        erreurs.append(
            f"bloc 'paiement' : etat inconnu {etat!r} (attendu ok, echec ou inconnu)"
        )

    if configure is False:
        erreurs.append(f"PAIEMENT NON CONFIGURE : {motif or 'aucun motif publie'}")
    elif etat == "echec":
        erreurs.append(
            f"PAIEMENT EN ECHEC (cause={cause}, circuit={circuit_paiement}) : "
            f"{motif or 'aucun motif publie'} — un echec sans motif ne se repare pas"
        )
    elif etat == "inconnu":
        print(
            "[WARN] Paiement : configure, aucun appel depuis le demarrage (aucune vente "
            "depuis ce deploiement) — fait publie, pas une panne"
        )
    elif etat == "ok":
        print(
            f"[OK] Paiement : dernier appel reussi (statut {bloc.get('last_status')}, "
            f"{bloc.get('last_success_at')})"
        )

    # Deux lectures du MÊME circuit dans la MÊME reponse : elles doivent
    # s'accorder, sinon l'une des deux est fausse et le diagnostic ment.
    circuit = data.get("paydunya_circuit") if isinstance(data.get("paydunya_circuit"), dict) else {}
    if circuit.get("state") != circuit_paiement:
        erreurs.append(
            "/health se contredit : paydunya_circuit.state="
            f"{circuit.get('state')!r} mais paiement.circuit={circuit_paiement!r}"
        )
    if circuit.get("consecutive_failures") != bloc.get("consecutive_failures"):
        erreurs.append(
            "/health se contredit : paydunya_circuit.consecutive_failures="
            f"{circuit.get('consecutive_failures')!r} mais "
            f"paiement.consecutive_failures={bloc.get('consecutive_failures')!r}"
        )

    if isinstance(paydunya_composite, dict):
        verdict = paydunya_composite.get("circuit")
        attendu_down = circuit_paiement == "open"
        if verdict == "ok" and attendu_down:
            erreurs.append(
                "le composite /monitor dit paydunya 'ok' alors que /health dit circuit 'open'"
            )
        elif verdict == "down" and not attendu_down:
            erreurs.append(
                "le composite /monitor dit paydunya 'down' alors que /health dit "
                f"circuit {circuit_paiement!r}"
            )

    return erreurs


def check_health(url: str, timeout: int = 15) -> int:
    print(f"[PROBE] Interrogation de la sante backend : {url}")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "KojoHealthMonitor/1.0", "Accept": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status_code = response.status
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        print(f"[ERREUR HTTP {e.code}] Le backend a renvoye une erreur HTTP")
        try:
            print(f"   Details : {e.read().decode('utf-8')[:300]}")
        except Exception:
            pass
        return 1
    except urllib.error.URLError as e:
        print(f"[ERREUR CONNEXION] Impossible de joindre le backend : {e.reason}")
        return 1
    except Exception as e:
        print(f"[ERREUR INATTENDUE] {e}")
        return 1

    if status_code != 200:
        print(f"[ERREUR] Code de statut inattendu : {status_code} (attendu : 200)")
        return 1

    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        print(f"[ERREUR] Reponse JSON invalide recue de /health : {e}")
        return 1

    print("[OK] Endpoint /health accessible (HTTP 200)")

    errors = []

    # 1. Vérification du statut global
    health_status = data.get("status")
    if health_status != "healthy":
        errors.append(f"Statut global anormal : '{health_status}' (attendu: 'healthy')")
    else:
        print("[OK] Statut general : healthy")

    # 2. Vérification de la base de données
    database_status = data.get("database")
    if database_status != "connected":
        errors.append(f"Base de donnees non connectee : '{database_status}' (attendu: 'connected')")
    else:
        print("[OK] Connexion MongoDB : connected")

    # 3. Vérification du circuit breaker PayDunya
    circuit = data.get("paydunya_circuit")
    if not isinstance(circuit, dict):
        errors.append("Bloc 'paydunya_circuit' manquant ou invalide dans la reponse")
    else:
        circuit_state = circuit.get("state")
        failures = circuit.get("consecutive_failures", 0)
        cooldown = circuit.get("remaining_cooldown_seconds", 0)

        if circuit_state == "open":
            errors.append(
                f"CIRCUIT BREAKER PAYDUNYA OUVERT ! "
                f"(echecs consecutifs: {failures}, cooldown restant: {cooldown}s)"
            )
        elif circuit_state != "closed":
            print(f"[WARN] Circuit PayDunya dans un etat transitoire : '{circuit_state}' (echecs: {failures})")
        else:
            print(f"[OK] Circuit PayDunya : closed (echecs: {failures})")

    revision = data.get("revision")
    if revision:
        print(f"[INFO] Revision deployee : {revision[:10]}")

    # Les moniteurs sont juges MEME si /health a deja releve des anomalies : un
    # seul passage doit dire tout ce qui ne va pas, pas la premiere panne.
    origine = _origine(url)
    errors.extend(_verifier_email(origine, timeout))
    fournisseurs = {}
    errors.extend(_verifier_composite(origine, timeout, fournisseurs))
    # 4. Le diagnostic de paiement : la paire `closed` / 0 échec ci-dessus ne dit
    #    ni si les clés existent, ni si un paiement a été exercé, ni pourquoi il
    #    a échoué. Le composite donne une SECONDE lecture du même circuit.
    errors.extend(_verifier_paiement(data, fournisseurs.get("paydunya")))
    # 5. Les LANGUES SERVIES (01/11/2026) : combien de langues, combien de
    #    documents chacune — la question que la sonde hreflang met 11 s et 61
    #    requêtes à trancher sur les documents servis.
    errors.extend(_verifier_langues(data))
    # 6. LE VOLUME SERVI (02/11/2026) : le bloc `langues` est une declaration, et
    #    rien ne disait qu'un artefact SERVI la portait. Une requete au sitemap
    #    confronte ses en-tetes et ses <loc> a `pages.declarees`.
    errors.extend(_verifier_sitemap(origine, data, timeout))
    # 7. LES ERREURS NON RATTRAPEES (02/11/2026) : `sentry: inactif` laissait une
    #    exception dans le journal Fly, lu par personne. Le bloc `erreurs`
    #    compte ce qui a casse depuis le demarrage ; une seule exception est un
    #    refus nomme (classe, famille de route, date).
    errors.extend(_verifier_erreurs(data))

    if errors:
        print("\n[ERREUR] ANOMALIES DETECTEES SUR LA PRODUCTION :")
        for err in errors:
            print(f" - {err}")
        return 1

    print("\n[SUCCESS] La production est saine (MongoDB connecte, PayDunya operationnel, "
          "fournisseur email actif joignable).")
    return 0

def main():
    parser = argparse.ArgumentParser(description="Verification de sante continue du backend Kojo")
    parser.add_argument("--url", default=DEFAULT_HEALTH_URL, help="URL de l'endpoint /health")
    parser.add_argument("--timeout", type=int, default=15, help="Delai d'attente en secondes")
    args = parser.parse_args()

    sys.exit(check_health(args.url, args.timeout))

if __name__ == "__main__":
    main()
