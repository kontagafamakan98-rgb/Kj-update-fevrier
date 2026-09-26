// Refuse une coquille qui ne porte pas tout ce que sa page déclare.
// Sans ce refus, une section ajoutée à la page React ne paraîtrait que
// pour un navigateur, et un crawler sans JavaScript lirait une page
// amputée — le défaut exact que la déclaration unique supprime.
// Les textes attendus se DÉDUISENT du plan (pageSectionParts) : aucune
// seconde liste n'est tenue ici.
//
// Deux clés du plan ne sont attendues que sous CONDITION DE BUILD : le bouton
// Google n'existe que si `VITE_GOOGLE_CLIENT_ID` est configuré —
// src/components/GoogleButton.js retourne `null` sinon. La coquille suit la
// MÊME condition (`googleAuth`, calculé sur le même `env` par
// prerender-route-meta.js). L'exiger quand elle est fausse faisait publier à
// la coquille un bouton que React retirait : mesuré, 56 px de remontée de tout
// le bas du formulaire de connexion au montage.
// (`cles` porte les CLÉS DE DICTIONNAIRE — les valeurs des champs `*Key` —,
// pas les noms de champs : c'est `traduire` qui les résout.)
import { marqueurDIcone } from '../../src/config/page-icons.js';

const CLES_CONDITIONNELLES = {
  googleLogin: 'google-auth',
  googleSignup: 'google-auth',
}

export function makeDeclaredBodyGuard({
  esc, T, registerT, jobsT, pageSections, pageSectionParts, conditions = new Set(),
}) {
  const exigerCorpsDeclare = (routePath, route, corps) => {
    const plan = pageSections[routePath]
    if (!plan) return
    if (!corps) {
      throw new Error(
        `prerender-shells : ${routePath} déclare son corps (src/config/page-sections.js) mais sa coquille est VIDE ` +
          `(SHELLS['${route}']) — un crawler sans JavaScript ne lirait rien de cette page.`
      )
    }
    const { cles, textes, icones = [] } = pageSectionParts(plan)
    const traduire = (key) => {
      if (routePath === '/register') return registerT(key)
      if (routePath === '/jobs') return jobsT(key)
      if (routePath === '/login' && (/^(google|legal)/.test(key))) return registerT(key)
      return T(key)
    }
    const requises = cles.filter(
      (cle) => !CLES_CONDITIONNELLES[cle] || conditions.has(CLES_CONDITIONNELLES[cle])
    )
    const attendus = [...requises.map(traduire), ...textes]
    const manquants = attendus.filter((texte) => !corps.includes(esc(texte)))
    if (manquants.length) {
      throw new Error(
        `prerender-shells : la coquille ${routePath} ne porte pas ${manquants.length} élément(s) déclaré(s) par sa page ` +
          `— « ${manquants[0]} » manque. Le corps d'une page a UN propriétaire (src/config/page-sections.js) : ` +
          'la coquille s\'en dérive, elle ne peut pas le recopier.'
      )
    }

    // ── Et les ICÔNES DESSINÉES ? ──────────────────────────────────────
    // Un champ `icone` ne déclare pas un texte mais une icône SVG : la coquille
    // doit la publier avec son repère `data-icone`, jamais sous forme de glyphe.
    // Sans ce contrôle, une icône déclarée pouvait disparaître de la coquille en
    // silence — le défaut exact que ce garde existe pour empêcher, par un autre
    // chemin.
    const iconesManquantes = icones.filter((nom) => !corps.includes(marqueurDIcone(nom)))
    if (iconesManquantes.length) {
      throw new Error(
        `prerender-shells : la coquille ${routePath} ne dessine pas ${iconesManquantes.length} icône(s) déclarée(s) par sa page ` +
          `— « ${iconesManquantes[0]} » manque (aucun ${marqueurDIcone(iconesManquantes[0])} trouvé). ` +
          "Le corps d'une page a UN propriétaire (src/config/page-sections.js) : la coquille s'en dérive."
      )
    }
  }
  return exigerCorpsDeclare
}

