# -*- coding: utf-8 -*-
"""Page HTML PRÉ-RENDUE d'une fiche mission (/jobs/:id) — stdlib uniquement.

POURQUOI CE MODULE EXISTE SÉPARÉMENT : cette page est ce que lit un crawler de
partage (Facebook, LinkedIn, WhatsApp), qui n'exécute pas JavaScript. Elle doit
donc annoncer EXACTEMENT ce que l'application annonce pour la même mission —
titre, description, carte — et ce contrat n'était vérifié qu'en HTTP, contre un
serveur en marche et une mission réellement créée en base.

Le contrat est maintenant vérifiable SANS serveur :
frontend/scripts/check-job-og-contract.js importe ce module avec un interpréteur
Python quelconque et confronte son HTML à ce que l'application déclare pour la
même mission (frontend/src/utils/jobSeo.js). C'est ce qui fixe la frontière de ce
fichier — il n'importe ni FastAPI, ni MongoDB, ni kojo_settings, sinon il ne
s'IMPORTERAIT pas dans le job frontend, où seules les dépendances npm sont
installées. Ce n'est pas un goût pour les petits fichiers.

L'échappement XML vit ici pour la même raison : la page l'utilise, le sitemap
l'utilise aussi, et deux copies divergeraient en silence.
"""


def escape_xml(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def job_og_html(job: dict, base: str) -> str:
    """HTML pré-rendu (crawlers sans JS) d'une fiche mission /jobs/:id.

    Les crawlers de partage (Facebook, LinkedIn, WhatsApp) ne lisent QUE le
    HTML servi, sans exécuter JavaScript : ce document porte les méta OG de
    la mission (titre, description, cartes wide + carrée pointées vers les
    endpoints Pillow du backend) + le shell h1 statique. Le rewrite Vercel
    /jobs/(.*) → /api/og/jobs/$1 achemine les fiches ici — plus de fonction
    serverless Vercel à déployer (Vercel ne collecte pas api/ en mode
    outputDirectory statique).
    """
    job_id = str(job.get("id") or "")
    raw_title = str(job.get("title") or "")
    title = f"{raw_title} — Kojo" if raw_title else "Mission — Kojo"
    raw_desc = str(job.get("description") or "")
    desc = raw_desc[:150] + ("…" if len(raw_desc) > 150 else "")
    url = f"{base}/jobs/{escape_xml(job_id)}"
    wide = f"{base}/api/og/jobs/{escape_xml(job_id)}.png"
    square = f"{base}/api/og/jobs/{escape_xml(job_id)}-square.png"
    t = escape_xml(title)
    d = escape_xml(desc)
    return (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\" />\n"
        f"<title>{t}</title>\n"
        f"<meta name=\"description\" content=\"{d}\" />\n"
        "<meta name=\"robots\" content=\"index, follow\" />\n"
        f"<link rel=\"canonical\" href=\"{url}\" />\n"
        "<meta property=\"og:type\" content=\"article\" />\n"
        f"<meta property=\"og:url\" content=\"{url}\" />\n"
        f"<meta property=\"og:title\" content=\"{t}\" />\n"
        f"<meta property=\"og:description\" content=\"{d}\" />\n"
        f"<meta property=\"og:image\" content=\"{wide}\" />\n"
        "<meta property=\"og:image:width\" content=\"1200\" />\n"
        "<meta property=\"og:image:height\" content=\"630\" />\n"
        "<meta property=\"og:image:type\" content=\"image/png\" />\n"
        f"<meta property=\"og:image\" content=\"{square}\" />\n"
        "<meta property=\"og:image:width\" content=\"1200\" />\n"
        "<meta property=\"og:image:height\" content=\"1200\" />\n"
        "<meta property=\"og:image:type\" content=\"image/png\" />\n"
        "<meta property=\"og:locale\" content=\"fr_FR\" />\n"
        "<meta property=\"og:site_name\" content=\"Kojo\" />\n"
        "<meta name=\"twitter:card\" content=\"summary_large_image\" />\n"
        f"<meta name=\"twitter:url\" content=\"{url}\" />\n"
        f"<meta name=\"twitter:title\" content=\"{t}\" />\n"
        f"<meta name=\"twitter:description\" content=\"{d}\" />\n"
        f"<meta name=\"twitter:image\" content=\"{wide}\" />\n"
        "</head>\n<body>\n"
        "<div id=\"root\">\n"
        "<div class=\"h-16 bg-white border-b border-gray-200\"></div>\n"
        "<div class=\"max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8\">\n"
        f"<h1 class=\"text-3xl font-bold text-gray-900 mb-2\">{t}</h1>\n"
        "</div>\n</div>\n</body>\n</html>\n"
    )


def job_og_html_404() -> str:
    """HTML neutre pour une fiche inconnue — explicite noindex."""
    return (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\" />\n"
        "<title>Mission introuvable — Kojo</title>\n"
        "<meta name=\"robots\" content=\"noindex, nofollow\" />\n"
        "</head>\n<body>\n<div id=\"root\"></div>\n</body>\n</html>\n"
    )
