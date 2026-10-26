"""La configuration de scrape de `/metrics` dit-elle ce que le contrat dit ?

`backend/METRIQUES.md` est le CONTRAT de collecte (familles, cadence, jeton
porteur, endpoint hors `/api`), et `backend/metrics/prometheus.yml` en est la
configuration EXÉCUTABLE. Deux déclarations de la même chose finissent par
diverger — c'est l'incident du 18/10/2026 côté battement de cœur (15 s contre
20 s, deux sources) et la raison pour laquelle ce dépôt lit souvent une valeur
au lieu de la recopier. Ici, la valeur EST la configuration : le bloc YAML du
document et le fichier sont donc comparés, ligne à ligne, hors commentaires.

Ce que ces cas empêchent, un par un :

* une configuration qui scrape un autre chemin, une autre cadence ou un autre
  hôte que ceux que le document annonce (Prometheus collecterait un objet que
  personne n'a mesuré) ;
* un jeton écrit DANS le fichier de configuration — il finirait commité, et
  c'est exactement ce que `credentials_file` existe pour éviter ;
* une cible qui n'est plus l'hôte servi par `fly.toml` (la collecte viserait
  une machine qui ne répond plus, et le rouge dirait « cible morte » au lieu de
  « adresse changée ») ;
* un document qui ne nomme plus le fichier, donc une configuration que le
  prochain lecteur ne trouvera pas.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = REPO_ROOT / "backend" / "metrics" / "prometheus.yml"
DOC = REPO_ROOT / "backend" / "METRIQUES.md"
FLY = REPO_ROOT / "backend" / "fly.toml"

CADENCE = "30s"
DELAI = "10s"
HOTE_DEFAUT = "api.kojoforafrica.cc.cd"


def _bloc_du_doc():
    """Le bloc ```yaml du contrat qui porte `scrape_configs`."""
    texte = DOC.read_text(encoding="utf-8")
    blocs = [bloc for bloc in re.findall(r"```yaml\n(.*?)```", texte, re.S) if "scrape_configs:" in bloc]
    assert len(blocs) == 1, f"{len(blocs)} bloc(s) YAML de scrape dans METRIQUES.md (attendu : 1)"
    return blocs[0]


def _partie_scrape(texte):
    """Les lignes signifiantes de `scrape_configs:`, commentaires retirés.

    Les commentaires sont écartés des DEUX côtés : le fichier explique sa pose
    (c'est sa raison d'être), le document explique son contrat, et exiger les
    mêmes phrases ferait de ce test un test de prose.
    """
    lignes = texte.splitlines()
    debut = next(
        (indice for indice, ligne in enumerate(lignes) if ligne.strip() == "scrape_configs:"),
        None,
    )
    assert debut is not None, "aucune ligne « scrape_configs: » dans le texte"
    return [
        ligne.rstrip()
        for ligne in lignes[debut:]
        if ligne.strip() and not ligne.strip().startswith("#")
    ]


def _config():
    assert CONFIG.exists(), f"{CONFIG} est absent : la collecte n'a pas de configuration"
    return CONFIG.read_text(encoding="utf-8")


def test_le_document_et_le_fichier_declarent_la_meme_collecte():
    """Le contrat et la configuration exécutable ne peuvent pas diverger."""
    assert _partie_scrape(_config()) == _partie_scrape(_bloc_du_doc())


def test_un_seul_travail_de_collecte_et_il_est_nomme():
    lignes = _partie_scrape(_config())
    travaux = [ligne.strip() for ligne in lignes if ligne.strip().startswith("- job_name:")]
    assert travaux == ["- job_name: kojo-api"], travaux


def test_l_endpoint_est_metrics_hors_api_et_en_https():
    lignes = _partie_scrape(_config())
    assert "    metrics_path: /metrics" in lignes
    assert "    scheme: https" in lignes
    # Hors `/api` : la route se scrape sur l'hôte du backend, pas à travers le
    # proxy Vercel (`/api/:path*`), qui n'exposerait pas `/metrics`.
    chemin = next(ligne for ligne in lignes if "metrics_path:" in ligne).split(":", 1)[1].strip()
    assert chemin == "/metrics" and not chemin.startswith("/api")


def test_la_cadence_est_celle_du_contrat():
    lignes = _partie_scrape(_config())
    assert f"    scrape_interval: {CADENCE}" in lignes
    # 10 s de délai : une machine Fly arrêtée (trial) redémarre à froid, et un
    # délai plus court compterait ce réveil comme une cible morte.
    assert f"    scrape_timeout: {DELAI}" in lignes


def test_le_jeton_vient_d_un_fichier_et_jamais_du_fichier_de_config():
    texte = _config()
    assert "credentials_file:" in texte

    # Aucune valeur de jeton en clair : ni `credentials: …`, ni
    # `type: Bearer <valeur>` (la valeur est dans le fichier), ni identifiants
    # dans l'URL de la cible. On lit les lignes de CONFIGURATION : un
    # commentaire qui cite `Bearer` n'est pas un jeton.
    lignes = [
        ligne for ligne in texte.splitlines() if ligne.strip() and not ligne.strip().startswith("#")
    ]
    assert not re.search(r"^\s*credentials:\s*\S", texte, re.M), "jeton en clair (credentials:)"
    for ligne in lignes:
        assert not re.search(r"Bearer[ \t]+[A-Za-z0-9._\-]{8,}", ligne), (
            f"jeton en clair sur la ligne « {ligne.strip()} »"
        )
    assert "@" not in next(ligne for ligne in lignes if "targets:" in ligne), (
        "la cible porte des identifiants en clair"
    )


def test_la_cible_est_l_hote_servi_par_fly():
    """Une adresse changée dans `fly.toml` doit changer la cible, sinon la
    collecte vise une machine qui ne répond plus (et le rouge accuserait la
    cible au lieu de l'adresse)."""
    fly = FLY.read_text(encoding="utf-8")
    servi = re.search(r"^\s*BACKEND_PUBLIC_URL\s*=\s*'([^']+)'", fly, re.M)
    assert servi, "BACKEND_PUBLIC_URL introuvable dans fly.toml [env]"
    hote_servi = re.sub(r"^https?://", "", servi.group(1)).strip("/")
    assert hote_servi == HOTE_DEFAUT

    cible = re.search(r'targets:\s*\["([^"]+)"\]', _config())
    assert cible, "aucune cible déclarée"
    assert cible.group(1) == hote_servi


def test_le_document_nomme_le_fichier_de_configuration():
    """Une configuration que le contrat ne nomme pas est une configuration que
    le prochain lecteur ne trouvera pas."""
    assert "backend/metrics/prometheus.yml" in DOC.read_text(encoding="utf-8")
