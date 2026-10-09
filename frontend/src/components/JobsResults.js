// Le lien interne du site, PAS le `Link` de React Router : c'est lui qui ouvre
// la transition de vue native (`components/LienVue.js`). Ce fichier était le
// DERNIER à garder le `Link` brut après la migration du 27/09/2026 — mesuré le
// 07/10/2026 : ses DEUX liens (l'appel « Commencer maintenant » de l'état vide
// de la liste, et la carte de mission cliquable) changeaient de page d'un coup,
// sans le raccord que tout le reste du site avait déjà. Le composant se comporte
// comme le `Link` d'origine : mêmes propriétés, même `<a href>` réel pour un
// crawler et pour « ouvrir dans un nouvel onglet ».
import Link from './LienVue';
import { formatBudgetRange, formatJobDate, formatJobStatus } from '../utils/jobPageSafeHelpers';
import { getRememberedApplication } from '../utils/jobProposalWorkflow';
import { DEMO_JOBS } from '../config/demoJobs';

// ── LA DESCRIPTION D'UNE CARTE EST BORNÉE, ET C'EST UNE MESURE DE LCP ──────
//
// `max-w-2xl` sur la description n'est pas décoratif : c'est ce qui l'empêche
// de devenir un SECOND élément LCP sur /jobs, plus grand que l'intro que la
// coquille pré-rendue publie.
//
// MESURÉ (09/10/2026, sonde `e2e/lcp-geometrie.spec.js`, /jobs desktop) : la
// coquille peint l'intro (`introClass`, `src/config/page-sections.js`) — 768 px
// sur 2 lignes, encre 34 960 px² — et React peignait EN PLUS la description
// `line-clamp-2` de la PREMIÈRE carte, large de toute la colonne (928,39 px) :
// 41 625 px² à t=272 ms. Le repaint devenait donc l'élément LCP, et toute la
// chaîne JavaScript était facturée. Rouge 3 fois sur 3, reproductible dès
// qu'une annonce est longue — c'est-à-dire le cas réel (`ANNONCE_LONGUE`,
// `scripts/playtest-api-server.mjs`).
//
// La borne est CALCULÉE contre l'encre de l'intro, pas choisie : à 672 px de
// large et deux lignes de ~22,4 px, la description plafonne à ~30 100 px², soit
// 14 % SOUS les 34 960 px² de l'intro. Une annonce de n'importe quelle longueur
// ne peut donc plus dépasser l'intro, qui reste le seul élément LCP.
//
// Ce qui n'est PAS borné ici, et qu'on ne prétend pas fermé : le TITRE de la
// carte (`<h3>`), dont l'encre d'une ligne reste petite, mais qui sur DEUX
// lignes dépasserait l'intro. Aucun cas ne le visite aujourd'hui (les titres de
// la fixture tiennent sur une ligne) : c'est un angle mort DÉCLARÉ, pas un oubli.

// ── Glyphes de la carte de mission ─────────────────────────────────────────
// Décoratifs par construction : chaque information est portée par un texte
// juste à côté, donc l'icône est `aria-hidden` — sans quoi un lecteur d'écran
// annoncerait « image » devant chaque ligne. Ils tiennent dans la hauteur de
// ligne du texte (16 px pour une ligne `text-sm` de 20 px), donc la rangée
// méta garde EXACTEMENT la hauteur calibrée par `JobCardSkeleton` (cf.
// SkeletonLoader.js, qui réplique ces trois rangées pour que le passage
// squelette → résultats ne déplace pas le pied de page ancré).
const IconeEpingle = () => (
  <svg className="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" />
    <circle cx="12" cy="10.5" r="2.2" />
  </svg>
);

const IconeCalendrier = () => (
  <svg className="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path strokeLinecap="round" d="M8 3.5v3M16 3.5v3M3.5 10h17" />
  </svg>
);

const IconeEtiquette = () => (
  <svg className="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.5 12.6 12.6 20.5a2 2 0 0 1-2.8 0L3.5 14.2V3.5H14l6.5 6.5a2 2 0 0 1 0 2.6z" />
    <circle cx="8" cy="8" r="1.4" />
  </svg>
);

export function DemoJobsEmptyState({ t }) {
  return (
    <section className="space-y-5" aria-labelledby="demo-jobs-title">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6">
        <div className="flex items-start gap-4">
          <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white sm:flex" aria-hidden="true">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h10M4 17h7" />
            </svg>
          </span>
          <div>
            <h2 id="demo-jobs-title" className="text-xl font-semibold text-gray-900">Découvrez le type de missions publiées sur Kojo</h2>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">Ces exemples montrent le fonctionnement de la plateforme. Créez un compte pour consulter les missions actuellement disponibles et proposer vos services.</p>
            <Link to="/register" className="mt-4 inline-flex rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">
              {t('getStarted')}
            </Link>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {DEMO_JOBS.map((job) => (
          <article key={job.id} className="block rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-[240px] flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">Exemple</span>
                </div>
                <p className="mb-4 line-clamp-2 max-w-2xl text-gray-600">{job.description}</p>
                <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                  <span className="inline-flex items-center gap-1.5"><IconeEpingle />{job.location_text}</span>
                  <span className="inline-flex items-center gap-1.5"><IconeEtiquette />{job.category}</span>
                  <span className="inline-flex items-center gap-1.5"><IconeCalendrier />{job.estimated_duration}</span>
                </div>
              </div>
              <div className="ml-0 min-w-[170px] text-right md:ml-6">
                <div className="text-2xl font-bold text-orange-600">{formatBudgetRange(job.budget_min, job.budget_max)}</div>
                <div className="mt-2 text-xs text-gray-500">{formatJobStatus(job.status, t)}</div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function JobCard({ job, user, userType, appliedJobIds, t }) {
  const locationText = job.location_text || t('locationNotSpecified');
  const jobId = job.id || job._id || job.job_id || job.jobId;
  const hasApplied = userType === 'worker' && (
    appliedJobIds ? appliedJobIds.has(String(jobId)) : Boolean(getRememberedApplication(jobId, user))
  );

  // La carte entière est le lien : la cible est donc énorme au doigt, et le
  // contour de focus (`focus-visible`) dit où l'on est au clavier. Le survol
  // soulève la carte de 2 px et teinte la bordure en orange — assez pour dire
  // « c'est cliquable » sans faire sauter la liste. Les deux viennent de la
  // feuille (`.carte-editoriale-cliquable`) : la même réponse au survol que
  // toutes les autres cartes cliquables du site.
  return (
    <Link
      to={`/jobs/${job.id}`}
      // La CARTE du vocabulaire éditorial (src/index.css) : un filet de 1 px,
      // un rayon de 8 px, aucune ombre large — c'est ce qui distingue une carte
      // d'un bouton sur ce site. Le survol reste porté par la feuille
      // (`.carte-editoriale-cliquable`), donc il ne peut pas diverger d'une
      // autre carte cliquable. NI le rayon ni l'ombre ne participent à la mise
      // en page : la hauteur calibrée par `JobCardSkeleton` ne bouge pas.
      className="carte-editoriale carte-editoriale-cliquable block p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[240px] flex-1">
          {/* Titre + état, sur une ligne qui se replie : mêmes hauteurs de
              ligne que le squelette (titre text-lg, pastille 24 px). */}
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
            {/* L'ÉTAT, PAR LA COULEUR : la pastille était orange POUR TOUS les
                états — « Terminée », « Annulée » et « Ouverte » avaient la même
                teinte, donc la couleur ne disait rien et il fallait lire le mot.
                Elle porte maintenant l'état en donnée (`data-statut`) et la
                feuille en tire la teinte (src/index.css) : ouverte = orange
                (l'action est ouverte), en cours = bleu, terminée = vert,
                annulée = gris. Le POINT suit la teinte du texte
                (`currentColor`), donc les deux ne peuvent pas se contredire. */}
            <span
              className="pastille-statut inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
              data-statut={job.status || 'inconnu'}
            >
              <span className="pastille-statut-point h-1.5 w-1.5 rounded-full" aria-hidden="true"></span>
              {formatJobStatus(job.status, t)}
            </span>
          </div>
          <p className="mb-4 line-clamp-2 max-w-2xl text-stone-600">{job.description}</p>
          <div className="flex flex-wrap gap-4 text-sm text-stone-500">
            <span className="inline-flex items-center gap-1.5"><IconeCalendrier />{formatJobDate(job.posted_at || job.created_at)}</span>
            <span className="inline-flex items-center gap-1.5"><IconeEpingle />{locationText}</span>
            {job.category && <span className="inline-flex items-center gap-1.5"><IconeEtiquette />{job.category}</span>}
          </div>
        </div>
        <div className="ml-0 min-w-[170px] text-right md:ml-6">
          <div className="text-2xl font-bold text-orange-600">{formatBudgetRange(job.budget_min, job.budget_max)}</div>
          {job.estimated_duration && <div className="mt-1 text-sm text-stone-500">{job.estimated_duration}</div>}
          {userType === 'worker' && job.status === 'open' && !hasApplied && <div className="mt-2 inline-flex rounded border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">{t('applyAvailable')}</div>}
          {hasApplied && <div className="mt-2 inline-flex rounded border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{t('proposalSent')}</div>}
        </div>
      </div>
    </Link>
  );
}
