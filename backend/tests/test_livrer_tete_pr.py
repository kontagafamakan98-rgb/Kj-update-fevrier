# -*- coding: utf-8 -*-
"""La livraison surveille le commit RÉELLEMENT poussé, pas celui que l'API rend.

LE DÉFAUT QUE CE TEST FERME

Le 23/10/2026, `livrer.py` a poussé `ffa59a61` puis a lu la tête de la PR #199 :
l'API rendait encore `77398d61`, l'état d'AVANT le push. Le trajet a donc
surveillé les checks de l'ANCIEN commit, les a trouvés verts, et s'apprêtait à
fusionner un commit dont il n'avait rien jugé — un verdict sur le mauvais objet.
Le même piège rejouerait à chaque livraison qui suit un push de près.

CE QUI EST VERROUILLÉ ICI

1. Le SHA attendu est un fait LOCAL (`git rev-parse <branche>`), lu après le
   push : la propagation de l'API ne peut que le rejoindre.
2. La PR est ATTENDUE jusqu'à ce qu'elle désigne ce SHA. Une PR qui reste sur un
   autre commit est REFUSÉE en nommant les deux SHA — jamais on ne se rabat sur
   « ce que l'API dit », qui est exactement ce qui a menti.
3. La surveillance des checks et la fusion portent sur CE SHA, et le SHA de
   `pr["head"]` n'est plus lu nulle part.

Ce que ce test ne prouve pas : que la CI est verte, ni que GitHub propage la
tête en moins de 90 s — c'est une mesure, pas une propriété du dépôt.
"""
import importlib.util
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LIVRER = REPO_ROOT / ".github" / "scripts" / "livrer.py"
SHA_POUSSE = "ffa59a61" + "0" * 32
SHA_ANCIEN = "77398d61" + "0" * 32


@pytest.fixture(scope="module")
def livrer():
    """Charge `livrer.py` sans l'exécuter (`main()` est sous `__main__`)."""
    spec = importlib.util.spec_from_file_location("livrer_tete", LIVRER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pr(sha: str) -> dict:
    return {"number": 199, "head": {"sha": sha}, "title": "t", "html_url": "u"}


def test_la_confirmation_prend_la_tete_des_qu_elle_converge(livrer, monkeypatch):
    """Premier appel : l'API sert l'ancien SHA. Second : le bon. On attend."""
    reponses = [_pr(SHA_ANCIEN), _pr(SHA_POUSSE)]
    appels = []

    def faux_appel(methode, chemin, jeton, payload=None):
        appels.append((methode, chemin))
        return reponses.pop(0)

    sommeils = []
    monkeypatch.setattr(livrer, "appel_github", faux_appel)
    monkeypatch.setattr(livrer.time, "sleep", lambda secondes: sommeils.append(secondes))

    pr = livrer.attendre_tete_de_pr(199, SHA_POUSSE, "jeton")

    assert pr["head"]["sha"] == SHA_POUSSE
    assert len(appels) == 2, appels
    assert appels[0] == ("GET", "pulls/199")
    assert sommeils, "l'attente doit patienter entre deux lectures, pas boucler à vide"


def test_une_pr_qui_reste_sur_un_autre_commit_est_refusee(livrer, monkeypatch):
    monkeypatch.setattr(
        livrer, "appel_github", lambda *args, **kwargs: _pr(SHA_ANCIEN)
    )

    with pytest.raises(RuntimeError) as refus:
        livrer.attendre_tete_de_pr(199, SHA_POUSSE, "jeton", timeout_secondes=0)

    message = str(refus.value)
    # Les DEUX SHA sont nommés : le refus doit dire qui pointe quoi.
    assert SHA_ANCIEN[:10] in message, message
    assert SHA_POUSSE[:10] in message, message
    # Et il dit ce que le trajet aurait fait de travers.
    assert "checks" in message and "fusionn" in message, message


def test_la_surveillance_porte_sur_le_sha_pousse(livrer):
    """Le câblage, lu dans le fichier : le SHA poussé remplace celui de l'API."""
    source = LIVRER.read_text(encoding="utf-8")

    assert 'sha_attendu = exec_cmd(["git", "rev-parse", branche])' in source, (
        "la tête attendue doit être lue dans le dépôt local, seule source qui ne "
        "dépend pas de la propagation de l'API"
    )
    assert "pr_head_sha = sha_attendu" in source, (
        "les checks et la fusion doivent porter sur le SHA poussé"
    )
    assert "attendre_checks_ci(pr_head_sha" in source
    assert "fusionner_pr(pr_number, pr_head_sha" in source
    assert 'pr["head"]["sha"]' not in source, (
        "le SHA de l'API ne doit plus être lu : c'est lui qui mentait juste après "
        "le push"
    )
    assert source.index("pr = attendre_tete_de_pr(") < source.index(
        "attendre_checks_ci(pr_head_sha"
    ), "la tête de la PR est confirmée AVANT d'attendre les checks"
