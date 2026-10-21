/**
 * PROFIL PUBLIC D'UN TRAVAILLEUR — la réputation qu'un client peut LIRE.
 *
 * ── Pourquoi cette page existe ─────────────────────────────────────────────
 * Les avis existaient déjà, mais seulement EN BAS d'une fiche mission : un
 * client ne pouvait donc pas choisir sur preuve, et un travailleur ne pouvait
 * pas construire de capital visible — deux choses qu'un client cherche avant
 * de confier une mission, et qu'aucun écran de ce site ne rendait.
 *
 * ── Ce qu'elle lit, et ce qu'elle ne lit pas ───────────────────────────────
 * La réponse vient de `GET /api/workers/:id` (backend/kojo_routers_workers_public.py),
 * qui publie une ALLOWLIST : identité professionnelle, réputation, missions
 * terminées, derniers avis. Aucune coordonnée n'y figure (ni email, ni
 * téléphone, ni position) — la page ne peut donc pas les afficher, et c'est
 * voulu : cette URL est publique et partageable.
 *
 * ── Accessible ET indexée (depuis le 20/10/2026) ──────────────────────────
 * Un profil est fait pour être trouvé : c'est la réputation qu'un travailleur
 * construit, et un client qui cherche « plombier Dakar » ne doit pas tomber sur
 * une coquille vide. La route est donc PRÉ-RENDUE par le backend
 * (`kojo_routers_public.get_worker_og_html`, rewrite Vercel
 * /workers/(.*) → /api/og/workers/$1) : le crawler reçoit un document complet
 * (titre, description, canonical, cartes Open Graph, `<h1>`), et
 * `X-Robots-Tag: noindex` a été retiré de `vercel.json`.
 *
 * Le COMPROMIS est celui de la fiche mission, et il est assumé : le HTML servi
 * ne charge aucun script, donc un visiteur qui ouvre l'URL à FROID voit la page
 * statique (nom, réputation, ville) et pas l'application interactive ; dans
 * l'application, la navigation par `LienVue` monte ce composant normalement.
 * C'est le prix d'un contenu lisible sans JavaScript, et il se paie de la même
 * façon pour /jobs/:id.
 *
 * ── Ce qu'elle n'invente pas ───────────────────────────────────────────────
 * Pas d'avis : `stats.rating_average` vaut `null` et la page écrit « aucun avis
 * pour l'instant » (clé EXISTANTE `noReviewsYet`) au lieu d'un « 0 étoile » qui
 * se lirait comme un mauvais avis. Pas de photo publiable : l'initiale du
 * prénom, comme partout ailleurs — jamais un carré vide.
 *
 * ── Aucune clé i18n ajoutée ────────────────────────────────────────────────
 * Tous les libellés sont des clés qui existaient déjà dans les cinq
 * dictionnaires (`worker`, `completedJobs`, `reviewsCount`, `noReviewsYet`,
 * `skillsAndSpecialties`, `notFoundTitle`, `notFoundText`, `retry`, `error`,
 * `viewJobs`). Une page publique qui introduit dix clés doit les traduire cinq
 * fois ; tant qu'un libellé existant dit la même chose, il n'y a rien à
 * traduire — et rien qui puisse rompre la parité des dictionnaires.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import Link from '../components/LienVue';
import { useLanguage } from '../contexts/LanguageContext';
import { buildApiUrl } from '../utils/backendUrl';
import { absoluteUrl, usePageOpenGraph, usePageTitle } from '../utils/seo';
import { workerSeo } from '../utils/workerSeo';

const MAX_AVIS_AFFICHES = 10;

/** L'initiale d'un prénom, jamais un carré vide. */
const initiale = (prenom) => (prenom ? String(prenom).trim().charAt(0).toUpperCase() : '·');

const WorkerProfile = () => {
  const { id } = useParams();
  const { t } = useLanguage();

  const [profil, setProfil] = useState(null);
  const [etat, setEtat] = useState('chargement'); // chargement | pret | absent | erreur

  // ── Une réponse TARDIVE n'écrit rien ─────────────────────────────────────
  // La lecture est asynchrone, et rien ne garantit qu'elle se termine pendant
  // que la page existe : un visiteur qui suit un autre lien, un identifiant qui
  // change, ou simplement la fin d'un test (jsdom démonté avant que la réponse
  // n'arrive). Écrire l'état à ce moment-là ne « met pas à jour une page
  // disparue » : React lit `window` pour choisir la priorité de l'événement, et
  // lève `ReferenceError: window is not defined` — mesuré en CI le 20/10/2026
  // par `pages-render.test.jsx`, où le fichier entier rougissait sur cette
  // rejet non gérée alors que ses 1 993 tests passaient.
  //
  // Le remède est un JETON de requête, pas un booléen : au démontage comme à un
  // changement d'identifiant, le compteur avance, donc une réponse de l'ancienne
  // requête est reconnue comme périmée (un booléen remis à vrai par l'effet
  // suivant laisserait passer la réponse de l'ancien identifiant).
  const requete = useRef(0);

  const charger = useCallback(async () => {
    const mienne = requete.current + 1;
    requete.current = mienne;
    const encoreValide = () => mienne === requete.current;
    setEtat('chargement');
    try {
      // Route PUBLIQUE : aucun jeton, aucun en-tête d'authentification. Un
      // visiteur qui arrive par un lien partagé doit voir la page.
      const reponse = await fetch(buildApiUrl(`/workers/${encodeURIComponent(id)}`), {
        headers: { Accept: 'application/json' },
      });
      if (!encoreValide()) return;
      if (reponse.status === 404) {
        setProfil(null);
        setEtat('absent');
        return;
      }
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      const donnees = await reponse.json();
      if (!encoreValide()) return;
      setProfil(donnees);
      setEtat('pret');
    } catch (_error) {
      if (!encoreValide()) return;
      setEtat('erreur');
    }
  }, [id]);

  useEffect(() => {
    charger();
    // Le démontage (ou le changement d'identifiant) périme la requête en vol.
    return () => {
      requete.current += 1;
    };
  }, [charger]);

  // Le titre, la description, le canonical et la carte se décident dans
  // src/utils/workerSeo.js — la même paire que le pré-rendu backend, comparée
  // hors ligne par scripts/check-worker-og-contract.js. `profil || { id }` :
  // avant le chargement, seuls le canonical et la carte sont connus (l'identifiant
  // EST dans la route), et ils sont donc annoncés dès le premier rendu. Le titre
  // précédent est rendu au démontage : une page suivante n'hérite pas du nom
  // d'un travailleur.
  const seo = workerSeo(profil || { id });
  usePageTitle(seo.title, { description: seo.description, canonicalPath: seo.canonicalPath });
  usePageOpenGraph({
    title: seo.title,
    description: seo.description,
    url: seo.canonicalPath ? absoluteUrl(seo.canonicalPath) : undefined,
    image: seo.card ? absoluteUrl(seo.card) : undefined,
  });

  if (etat === 'chargement') {
    return (
      <div className="cadre-page mx-auto max-w-3xl px-4">
        {/* Squelette à la hauteur du contenu : la page ne saute pas quand les
            données arrivent (règle anti-CLS du dépôt). */}
        <div className="carte-publique carte-editoriale h-48 animate-pulse" aria-busy="true" />
      </div>
    );
  }

  if (etat === 'absent') {
    return (
      <div className="cadre-page mx-auto max-w-3xl px-4 text-center">
        <h1 className="titre-page">{t('notFoundTitle')}</h1>
        <p className="mt-4 text-stone-600">{t('notFoundText')}</p>
        <p className="mt-6">
          <Link to="/jobs" className="font-semibold text-orange-600 hover:text-orange-700">
            {t('viewJobs')}
          </Link>
        </p>
      </div>
    );
  }

  if (etat === 'erreur') {
    return (
      <div className="cadre-page mx-auto max-w-3xl px-4 text-center">
        <p role="alert" className="text-stone-700">
          {t('error')}
        </p>
        <button
          type="button"
          onClick={charger}
          className="mt-4 rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-700"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  const stats = profil.stats || {};
  const avis = Array.isArray(profil.reviews) ? profil.reviews.slice(0, MAX_AVIS_AFFICHES) : [];
  const note = typeof stats.rating_average === 'number' ? stats.rating_average.toLocaleString() : null;

  return (
    <div className="cadre-page mx-auto max-w-3xl px-4">
      <header className="flex items-center gap-4">
        {profil.photo_url ? (
          <img
            src={profil.photo_url}
            alt=""
            width="72"
            height="72"
            loading="lazy"
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-200 text-xl font-bold text-stone-600"
          >
            {initiale(profil.first_name)}
          </span>
        )}
        <div>
          <h1 className="titre-page">
            {[profil.first_name, profil.last_name].filter(Boolean).join(' ')}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {t('worker')}
            {/* Le champ public `verified` est `is_verified` côté backend
                (`kojo_routers_workers_public.py`) : des comptes de paiement
                renseignés, pas une identité contrôlée. */}
            {profil.verified ? ` · ${t('paymentMethodsOnFile')}` : ''}
            {profil.city || profil.country ? ` · ${[profil.city, profil.country].filter(Boolean).join(', ')}` : ''}
            {profil.member_since ? ` · ${profil.member_since}` : ''}
            {/* La note vit ICI, avec le nom : c'est ce qu'on cherche en arrivant
                sur un profil, et ça évite une seconde carte dont le libellé
                aurait demandé une clé de plus dans cinq dictionnaires. */}
            {note !== null && (
              <span className="ml-1 inline-flex items-center gap-1 font-semibold text-stone-800">
                · <Star aria-hidden="true" size={14} className="text-orange-500" />
                {note}
                <span className="font-normal text-stone-500">({stats.rating_count ?? 0})</span>
              </span>
            )}
          </p>
        </div>
      </header>

      {/* La mesure qui fait choisir : les missions TERMINÉES. Une valeur
          absente s'écrit comme une absence (—), jamais comme un zéro. */}
      <dl className="mt-6">
        <div className="carte-publique carte-editoriale max-w-xs">
          <dt className="text-xs uppercase tracking-wide text-stone-500">{t('completedJobs')}</dt>
          <dd className="mt-1 text-2xl font-bold text-stone-900">{stats.missions_completed ?? '—'}</dd>
        </div>
      </dl>

      {profil.bio && <p className="mt-6 whitespace-pre-line text-stone-700">{profil.bio}</p>}

      {Array.isArray(profil.skills) && profil.skills.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            {t('skillsAndSpecialties')}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {profil.skills.map((competence) => (
              <li key={competence} className="rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-700">
                {competence}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        {/* Un avis sans note ne s'affiche pas : la liste ne montre que des
            avis réels. Et quand il n'y en a AUCUN, la page le DIT (clé
            `noReviewsYet`) au lieu de laisser une section muette : une zone
            vide sous un titre se lit comme un chargement en panne. */}
        {avis.length === 0 && <p className="text-stone-600">{t('noReviewsYet')}</p>}
        {avis.length > 0 && (
          <ul className="space-y-3">
            {avis.map((unAvis, index) => (
              <li key={`${unAvis.created_at || 'avis'}-${index}`} className="carte-publique carte-editoriale">
                <p className="flex items-center gap-1 text-sm font-semibold text-stone-800">
                  <Star aria-hidden="true" size={14} className="text-orange-500" />
                  {unAvis.rating ?? '—'}
                  <span className="ml-2 font-normal text-stone-500">
                    {unAvis.reviewer_first_name || t('anonymousReviewer')}
                  </span>
                </p>
                {unAvis.comment && <p className="mt-2 text-stone-700">{unAvis.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8">
        <Link to="/jobs" className="font-semibold text-orange-600 hover:text-orange-700">
          {t('viewJobs')}
        </Link>
      </p>
    </div>
  );
};

export default WorkerProfile;
