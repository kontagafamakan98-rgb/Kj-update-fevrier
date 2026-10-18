# -*- coding: utf-8 -*-
"""La machine promise-t-elle plus que la RAM ne tient ?

LE DÉFAUT MESURÉ, le 18/10/2026 : `fly.toml` annonçait `hard_limit = 800`
connexions avec `memory_mb = 256`. Une session SSE ouverte coûte +166 Ko en
moyenne et jusqu'à 374 Ko au pire palier mesuré (banc
`scripts/charge/mesure_memoire_flux.py`), pour une base de 166 Mo : 256 Mo en
tenaient ~130, pas 800. La configuration promettait donc un service que la
machine ne rendait pas — et ce n'est pas un utilisateur sur deux qui le
découvre : Fly tue le processus, donc TOUTES les sessions de la machine
tombent. Un plafond de connexions n'est pas une opinion, c'est une division.

CE QUE CE GARDE JUGE, dans cet ordre :

  1. la mesure existe et est LISIBLE (date, hôte, paliers, coût, base) — une
     mesure vide rendrait toutes les comparaisons vraies pour la mauvaise
     raison ;
  2. la promesse TIENT : `base + hard_limit × coût_pire ≤ memory_mb × part` ;
  3. les plafonds sont COHÉRENTS entre eux : `soft_limit < hard_limit` (sinon
     aucune machine n'est ajoutée avant le refus) et
     `KOJO_SSE_MAX_TOTAL ≤ hard_limit` (l'application ne promet pas plus que la
     plateforme ne laisse entrer) ;
  4. le pire palier est DÉCLARÉ : dimensionner sur la moyenne effacerait
     justement le palier qui a coûté cher.

CE QU'IL NE JUGE PAS (dit plutôt que tu) : le coût d'une session qui REÇOIT des
événements (le banc mesure des flux immobiles), le RSS réel de l'image Linux
déployée (la mesure vient du poste — un MAJORANT, puisque l'interpréteur Linux
n'embarque pas les DLL Windows), et le palier Atlas/MongoDB (hors machine).
"""
import json
import re
from pathlib import Path

import kojo_live

REPO_ROOT = Path(__file__).resolve().parents[2]
FLY_TOML = REPO_ROOT / "backend" / "fly.toml"
MESURE = REPO_ROOT / "backend" / "scripts" / "charge" / "mesure_memoire.json"

# Planchers de lecture : sous ceux-là, le fichier lu n'est pas celui que ce
# garde croit juger (fichier vidé, chemin déplacé) et un vert ne mesurerait rien.
MIN_OCTETS_FLY_TOML = 1500
MIN_PALIERS = 2


def _lire(chemin: Path) -> str:
    with open(chemin, "r", encoding="utf-8", newline="") as flux:
        return flux.read()


def _nombre(text: str, motif: str, quoi: str) -> float:
    trouve = re.search(motif, text)
    assert trouve, "fly.toml : « %s » introuvable — la configuration ne dit plus %s" % (motif, quoi)
    return float(trouve.group(1))


def _fly_toml() -> dict:
    texte = _lire(FLY_TOML)
    assert len(texte) > MIN_OCTETS_FLY_TOML, "fly.toml sous son plancher de lecture"
    return {
        "hard_limit": _nombre(texte, r"hard_limit\s*=\s*(\d+)", "de limite dure"),
        "soft_limit": _nombre(texte, r"soft_limit\s*=\s*(\d+)", "de limite souple"),
        "memory_mb": _nombre(texte, r"memory_mb\s*=\s*(\d+)", "de RAM"),
        # Le plafond applicatif vit dans le CODE (`kojo_live.MAX_STREAMS_TOTAL`),
        # pas dans `[env]` : une clé `[env]` non encore déployée est lue comme une
        # dérive par la sonde Fly, ce qui rougirait le job entre la PR et le
        # déploiement. C'est donc le défaut du module que ce garde confronte.
        "max_total": float(kojo_live.MAX_STREAMS_TOTAL),
    }


def _mesure() -> dict:
    assert MESURE.is_file(), "mesure introuvable : %s" % MESURE
    donnees = json.loads(_lire(MESURE))
    manquants = [
        cle
        for cle in (
            "mesure_le",
            "hote",
            "palier_ram_mo",
            "part_sessions",
            "cout_pire_palier_mo",
            "base_hors_sessions_mo",
            "paliers",
        )
        if cle not in donnees
    ]
    assert manquants == [], "mesure incomplète (champs absents : %s) — refus de juger" % manquants
    assert re.match(r"\d{4}-\d{2}-\d{2}$", str(donnees["mesure_le"])), "date de mesure illisible"
    assert len(donnees["paliers"]) >= MIN_PALIERS, (
        "un seul palier mesuré : la marge ne se calcule pas — refus de conclure"
    )
    assert donnees["base_hors_sessions_mo"] > 0, "base hors sessions nulle : mesure vide"
    assert donnees["cout_pire_palier_mo"] > 0, "coût par session nul : mesure vide"
    assert 0 < donnees["part_sessions"] <= 1, "part de RAM hors bornes"
    return donnees


class TestLaPromesseTientDansLaRam:
    def test_la_limite_dure_tient_dans_le_budget_de_ram(self):
        config = _fly_toml()
        mesure = _mesure()

        budget_mo = config["memory_mb"] * mesure["part_sessions"]
        consomme_mo = (
            mesure["base_hors_sessions_mo"] + config["hard_limit"] * mesure["cout_pire_palier_mo"]
        )
        assert consomme_mo <= budget_mo, (
            "fly.toml promet %d connexions sur %d Mo : base %.1f Mo + %d × %.3f Mo = %.1f Mo "
            "pour un budget de %.1f Mo (%.0f %%) — la machine ne tiendra pas ce qu'elle annonce, "
            "et Fly la tuera au lieu de refuser proprement. Mesure du %s (%s) : %s"
            % (
                config["hard_limit"],
                config["memory_mb"],
                mesure["base_hors_sessions_mo"],
                config["hard_limit"],
                mesure["cout_pire_palier_mo"],
                consomme_mo,
                budget_mo,
                mesure["part_sessions"] * 100,
                mesure["mesure_le"],
                mesure["hote"],
                MESURE.relative_to(REPO_ROOT),
            )
        )

    def test_aucun_plafond_ne_promet_plus_que_la_plateforme(self):
        config = _fly_toml()
        assert config["soft_limit"] < config["hard_limit"], (
            "soft_limit (%d) ≥ hard_limit (%d) : aucune machine ne serait ajoutée avant le refus"
            % (config["soft_limit"], config["hard_limit"])
        )
        assert config["max_total"] <= config["hard_limit"], (
            "KOJO_SSE_MAX_TOTAL (%d) dépasse hard_limit (%d) : l'application promet des flux "
            "que la plateforme refuse avant elle — le refus n'est alors pas le sien"
            % (config["max_total"], config["hard_limit"])
        )

    def test_les_paliers_mesures_sont_croissants_et_complets(self):
        mesure = _mesure()
        paliers = mesure["paliers"]
        nombres = [nombre for nombre, _ in paliers]
        assert nombres == sorted(nombres), "paliers hors ordre : %s" % nombres
        assert nombres[0] == 0, "le palier 0 (témoin sans flux) manque : la base serait fausse"
        assert all(rss > 0 for _, rss in paliers), "un palier a un RSS nul : la mesure est vide"
        # Le coût déclaré doit être PLAUSIBLE face aux paliers : un `cout_pire`
        # saisi à la main, plus petit que la plus forte marge observée, ferait
        # passer une configuration que la machine ne tient pas.
        marges = [
            (rss1 - rss0) / (n1 - n0)
            for (n0, rss0), (n1, rss1) in zip(paliers, paliers[1:])
            if n1 > n0
        ]
        assert marges, "aucune marge calculable entre les paliers"
        assert mesure["cout_pire_palier_mo"] >= max(marges) - 0.01, (
            "cout_pire_palier_mo (%.3f Mo) est inférieur à la marge observée (%.3f Mo) : "
            "le pire palier n'est pas déclaré" % (mesure["cout_pire_palier_mo"], max(marges))
        )
