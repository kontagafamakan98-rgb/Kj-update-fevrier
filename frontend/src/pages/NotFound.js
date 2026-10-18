import Link from '../components/LienVue';
import { useLanguage } from '../contexts/LanguageContext';

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
 * Les trois textes sont ceux de la 404 statique (`notFoundTitle`,
 * `notFoundText`, `notFoundJobsLink`) plus `home` : aucune clé n'est ajoutée,
 * donc aucune traduction nouvelle ne peut manquer dans une langue, et les deux
 * pages 404 ne peuvent pas annoncer deux choses différentes.
 *
 * Le bloc est centré et le DIT (`text-center`) : la règle du dépôt est qu'un
 * alignement est explicite, jamais hérité d'un parent.
 */
export default function NotFound() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen fond-papier">
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm font-semibold tracking-wide text-orange-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">{t('notFoundTitle')}</h1>
        <p className="mt-3 text-stone-600">{t('notFoundText')}</p>
        <nav className="mt-6 flex flex-wrap justify-center gap-4">
          <Link to="/" className="text-orange-600 underline underline-offset-2">
            {t('home')}
          </Link>
          <Link to="/jobs" className="text-orange-600 underline underline-offset-2">
            {t('notFoundJobsLink')}
          </Link>
          <Link to="/how-it-works" className="text-orange-600 underline underline-offset-2">
            {t('howItWorksTitle')}
          </Link>
        </nav>
      </div>
    </div>
  );
}
