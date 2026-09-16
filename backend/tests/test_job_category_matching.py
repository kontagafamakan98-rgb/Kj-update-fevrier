"""
Matching spécialités (profil worker) ↔ catégories (job).

Régression du bug « le profil Réparation PC ne matche aucune catégorie » :
les libellés FR prédéfinis stockés dans `worker_profiles.specialties`
(« Installation sanitaire », « Réparation fuites »…) n'étaient PAS dans les
variantes de `_CATEGORY_GROUPS`, donc le matching par spécialité ne trouvait
que les homonymes de la taxonomie (≈3/48 libellés) et retombait sur le repli
pays pour presque tous les profils.

Ce test lit la SOURCE DE VÉRITÉ frontend (WorkerRegistrationFields.js :
SKILL_KEY_TO_FR + predefinedSkillsData) et vérifie que chaque libellé FR
stocké matche bien la catégorie backend de SON groupe, en reproduisant le
regex EXACT construit par `_notify_matching_workers`. Si un libellé est
ajouté/modifié côté frontend sans être reflété dans `_CATEGORY_GROUPS`, ce
test échoue.
"""
import re
from pathlib import Path

import pytest

from kojo_routers_jobs import _CATEGORY_GROUPS

# backend/tests/ → racine du dépôt → frontend/src/components/...
FRONTEND_WORKER_FIELDS = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "components"
    / "WorkerRegistrationFields.js"
)

# Mapping groupe frontend (predefinedSkillsData) → catégorie backend canonique.
# Les clés sont identiques (mechanics→mechanics…), mais le mapping est explicite
# pour qu'une dérive de nom soit détectée par le test.
GROUP_TO_CATEGORY = {
    "mechanics": "mechanics",
    "plumbing": "plumbing",
    "electrical": "electrical",
    "construction": "construction",
    "carpentry": "carpentry",
    "computing": "computing",
    "gardening": "gardening",
    "tutoring": "tutoring",
}


def _extract_js_object(source: str, name: str) -> str:
    """Extrait le bloc `const <name> = { … };` (parenthèses équilibrées)."""
    marker = f"const {name} = {{"
    start = source.index(marker) + len(marker)
    depth = 1
    i = start
    while depth > 0 and i < len(source):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
        i += 1
    return source[start : i - 1]


def _frontend_groups() -> dict[str, list[str]]:
    """{groupe frontend: [libellés FR stockés, …]} depuis WorkerRegistrationFields.js."""
    src = FRONTEND_WORKER_FIELDS.read_text(encoding="utf-8")

    # SKILL_KEY_TO_FR = { skillXxx: 'Libellé FR', … }
    skill_to_fr = {}
    for m in re.finditer(
        r"skill[A-Za-z0-9_]+:\s*'([^']+)'", _extract_js_object(src, "SKILL_KEY_TO_FR")
    ):
        skill_to_fr[m.group(0).split(":", 1)[0].strip()] = m.group(1)

    # predefinedSkillsData = { group: ['skillXxx', …], … }
    groups = {}
    for m in re.finditer(
        r"([a-zA-Z]+):\s*\[([^\]]*)\]", _extract_js_object(src, "predefinedSkillsData")
    ):
        group = m.group(1)
        skill_keys = re.findall(r"'(skill[A-Za-z0-9_]+)'", m.group(2))
        groups[group] = [skill_to_fr[k] for k in skill_keys if k in skill_to_fr]

    return groups


@pytest.fixture(scope="module")
def frontend_groups():
    assert FRONTEND_WORKER_FIELDS.exists(), (
        f"fichier frontend introuvable : {FRONTEND_WORKER_FIELDS} (le test lit la "
        "source de vérité des libellés FR prédéfinis)"
    )
    groups = _frontend_groups()
    assert groups, "impossible de parser predefinedSkillsData"
    return groups


def _matching_regex(category: str) -> str:
    """Reproduit le regex EXACT de _notify_matching_workers (variantes du groupe,
    triées par longueur décroissante, ancrées ^…$, insensibles à la casse)."""
    variants = sorted(
        {v.lower() for v in _CATEGORY_GROUPS.get(category, [category])},
        key=len,
        reverse=True,
    )
    return "^(" + "|".join(re.escape(v) for v in variants) + ")$"


class TestGroupesFrontendMatchCategorieBackend:
    def test_tous_les_groupes_frontend_ont_une_categorie_backend(self, frontend_groups):
        missing = [g for g in frontend_groups if g not in GROUP_TO_CATEGORY]
        assert missing == [], f"groupes frontend sans catégorie backend : {missing}"

    def test_toutes_les_categories_backend_existent_dans_le_mapping(self, frontend_groups):
        unknown = [c for c in GROUP_TO_CATEGORY.values() if c not in _CATEGORY_GROUPS]
        assert unknown == [], f"catégories du mapping absentes de _CATEGORY_GROUPS : {unknown}"

    @pytest.mark.parametrize("group", sorted(GROUP_TO_CATEGORY))
    def test_chaque_libelle_fr_du_groupe_matche_la_categorie(self, frontend_groups, group):
        category = GROUP_TO_CATEGORY[group]
        regex = _matching_regex(category)
        unmatched = [
            label
            for label in frontend_groups.get(group, [])
            if not re.match(regex, label, re.IGNORECASE)
        ]
        assert unmatched == [], (
            f"groupe frontend « {group} » → catégorie backend « {category} » : "
            f"libellés FR stockés non matchés par le regex de matching : {unmatched}"
        )


class TestRegressionBugReparationPC:
    def test_reparation_pc_matche_la_categorie_computing(self):
        regex = _matching_regex("computing")
        assert re.match(regex, "Réparation PC", re.IGNORECASE)

    def test_installation_sanitaire_matche_la_categorie_plumbing(self):
        regex = _matching_regex("plumbing")
        assert re.match(regex, "Installation sanitaire", re.IGNORECASE)

    def test_normalisation_categorie_reparation_pc(self):
        from kojo_routers_jobs import _normalize_job_category

        assert _normalize_job_category("réparation pc") == "computing"
        assert _normalize_job_category("informatique") == "computing"
        assert _normalize_job_category("menuiserie") == "carpentry"
