import Link from '../components/LienVue';
import { useLanguage } from '../contexts/LanguageContext';
import { CONTACT } from '../config/contact';

/**
 * Page « introuvable » DANS l'application.
 *
 * La 404 statique (`vite-plugins/prerender/not-found.js`, publiée en
 * `404.html`) couvre l'URL inconnue tapée ou suivie depuis l'extérieur : Vercel
 * la sert sans scripts, avec un statut 404 et `noindex`. Elle ne couvre PAS le
 * lien mort INTERNE — un utilisateur déjà dans l'application `push` une URL
 * qu'aucune `<Route>` ne déclare, React Router ne rend rien, et il restait avec
 * le chrome seul et un `<main>` vide, sans savoir que la page n'existait pas.
 *
 * ── LA PALETTE ET LES COMPOSANTS SONT CEUX DU SITE (29/10/2026) ────────────
 * La page peignait son propre écran : papier blanc, texte `stone`, et trois
 * liens nus en `orange-600` — une teinte qui mesure 3,39:1 sur une surface
 * claire, sous le seuil de 4,5:1 (mesuré sur /login le 26/10/2026, corrigé
 * là-bas en `orange-700`). Une page 404 n'est pas un cas à part : c'est la
 * dernière page que voit un visiteur égaré, et elle était la seule du site à
 * ne pas employer sa matière.
 *
 * Elle porte donc le SABLE de la page (`fond-sable`), une CARTE éditoriale (le
 * verre du site, `carte-editoriale` + `carte-publique`, la même paire que les
 * cartes de contenu), le TITRE serif de section et les deux BOUTONS du site :
 * `bouton-encre` pour l'action principale, `bouton-clair` pour la seconde. Rien
 * n'est réinventé ici, et la 404 statique peint les mêmes quatre destinations —
 * `scripts/__tests__/check-coquilles-equilibrees.test.js` compare les deux.
 *
 * Les textes sont ceux de la 404 statique (`notFoundTitle`, `notFoundText`,
 * `notFoundJobsLink`, `howItWorksTitle`, `contactTitle`) plus `home` : aucune
 * clé n'est ajoutée, donc aucune traduction nouvelle ne peut manquer dans une
 * langue, et les deux pages 404 ne peuvent pas annoncer deux choses différentes.
 *
 * Le bloc est centré et le DIT (`text-center`) : la règle du dépôt est qu'un
 * alignement est explicite, jamais hérité d'un parent.
 */
export default function NotFound() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen fond-sable">
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className="carte-editoriale carte-publique text-center">
          {/* L'accent du site sur la carte : `orange-700` est le ton des liens
              mesuré à 4,92:1 sur cette surface (#fcf9f2) — pas `orange-600`,
              qui échouait sous le seuil. */}
          <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">404</p>
          {/* Le titre serif du site, comme la 404 statique qu'elle double :
              `titre-section` porte la famille, la graisse et la couleur, donc les
              deux 404 ne peignent pas deux dessins différents. */}
          <h1 className="titre-section mt-2">{t('notFoundTitle')}</h1>
          <p className="mt-3 text-stone-600">{t('notFoundText')}</p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/" className="bouton bouton-encre">
              {t('home')}
            </Link>
            <Link to="/jobs" className="bouton bouton-clair">
              {t('notFoundJobsLink')}
            </Link>
          </div>

          <nav className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2">
            <Link
              to="/how-it-works"
              className="text-orange-700 underline underline-offset-2 hover:text-orange-800"
            >
              {t('howItWorksTitle')}
            </Link>
            {/* La même porte de secours que la 404 statique : un lien mort peut
                arriver à quelqu'un qui cherchait à joindre l'équipe. */}
            <a
              href={`mailto:${CONTACT.email}`}
              className="text-orange-700 underline underline-offset-2 hover:text-orange-800"
            >
              {t('contactTitle')}
            </a>
          </nav>
        </div>
      </div>
    </div>
  );
}
