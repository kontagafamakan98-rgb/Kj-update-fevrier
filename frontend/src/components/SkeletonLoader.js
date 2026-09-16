import React from 'react';

// Composant de base Skeleton
export const Skeleton = ({ className = '', width, height }) => {
  const style = {};
  if (width) style.width = width;
  if (height) style.height = height;

  return (
    <div
      className={`animate-pulse bg-gray-200 rounded ${className}`}
      style={style}
    />
  );
};

// Skeleton pour une carte de job — réplique la STRUCTURE EXACTE de la vraie
// carte (JobCard dans Jobs.js) : même racine (rounded-2xl border p-6), même
// flex titre+badge (flex-wrap : la colonne budget passe sous le titre en
// mobile, comme la vraie carte), description sur 2 lignes, rangée méta.
// Les barres utilisent les line-heights réels (titre text-lg 28 px, desc
// 2×24 px, méta text-sm 20 px, budget text-2xl 32 px) : la hauteur rendue
// suit la vraie carte à chaque breakpoint (252 px mobile / 173 px desktop
// mesurés). En mobile, les titres longs passent à 2 lignes dans la liste
// réelle (cartes 288–326 px, moyenne 277) : min-h-[277px] md:min-h-0 cale la
// carte skeleton sur la MOYENNE réelle — au swap skeleton→page, le footer
// ancré (flex-1, cf. App.js) ne bouge plus (mesuré : +3311 px avec le
// PageSkeleton générique, +236 px avant ce calibrage).
export const JobCardSkeleton = () => {
  return (
    <div className="block bg-white rounded-2xl border border-gray-100 p-6 min-h-[277px] md:min-h-0">
      <div className="flex justify-between items-start gap-6 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          {/* Titre + badge statut (line-heights réels : text-lg 28px / badge 22px) */}
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          {/* Description line-clamp-2 (2 × 24px) */}
          <div className="mb-4 space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
          </div>
          {/* Rangée méta (text-sm 20px) */}
          <div className="flex flex-wrap gap-4">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>

        {/* Budget (text-2xl 32px) + durée (text-sm 20px) */}
        <div className="ml-0 md:ml-6 text-right min-w-[170px]">
          <Skeleton className="ml-auto h-8 w-28" />
          <Skeleton className="ml-auto mt-1 h-5 w-20" />
        </div>
      </div>
    </div>
  );
};

// Skeleton pour une carte de profil
export const ProfileCardSkeleton = () => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center space-x-4 mb-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      
      <div className="flex gap-2 mt-4">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
};

// Skeleton pour un message
export const MessageSkeleton = () => {
  return (
    <div className="flex items-start space-x-3 p-4 hover:bg-gray-50">
      <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
};

// Skeleton pour une liste
export const ListSkeleton = ({ count = 3, type = 'job' }) => {
  const SkeletonComponent = {
    job: JobCardSkeleton,
    profile: ProfileCardSkeleton,
    message: MessageSkeleton
  }[type] || JobCardSkeleton;

  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonComponent key={index} />
      ))}
    </div>
  );
};

// Skeleton pour un tableau
export const TableSkeleton = ({ rows = 5, cols = 4 }) => {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, index) => (
            <Skeleton key={index} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      
      {/* Rows */}
      <div className="divide-y divide-gray-200">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="px-6 py-4">
            <div className="flex gap-4">
              {Array.from({ length: cols }).map((_, colIndex) => (
                <Skeleton key={colIndex} className="h-4 flex-1" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Skeleton pour un formulaire
export const FormSkeleton = ({ fields = 4 }) => {
  return (
    <div className="space-y-6">
      {Array.from({ length: fields }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32" />
    </div>
  );
};

// Skeleton de page générique — fallback du Suspense pour les routes lazy
// (Home, Login, …) : première peinture rapide et stable, évite le « saut »
// de layout quand la page réelle arrive.
//
// RÈGLE MESURÉE (probe CDP, 412×823) : ce fallback a une destination INCONNUE
// (n'importe quelle route sans Suspense interne), il doit donc garder le
// footer HORS de l'écran — en 100vh (+ pb-24 mobile) main vaut 919 px, footer
// à 984 px, invisible pendant tout le chargement du chunk. En min-h-full le
// footer remonterait au bas de la viewport (visibles sur les viewports hauts)
// puis serait tiré vers le bas par une destination longue (main mesuré jusqu'à
// 1946 px sur /dashboard) : CLS de l'ordre de 0,03-0,06. C'est l'inverse d'un
// squelette DÉDIÉ (ForgotPasswordSkeleton, LoginSkeleton…), dont la
// destination est connue et mesurée : lui doit faire EXACTEMENT la hauteur de
// sa page (min-h-full + blocs calibrés) pour que le footer ne bouge pas.
export const PageSkeleton = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Bandeau principal */}
        <div className="space-y-3">
          <Skeleton className="h-10 w-2/3 md:w-1/2" />
          <Skeleton className="h-4 w-full md:w-3/4" />
          <Skeleton className="h-4 w-5/6 md:w-2/3" />
        </div>
        {/* Blocs de contenu */}
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="bg-white rounded-lg shadow p-6 space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-10 w-28 mt-2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Skeleton de la page Jobs — réplique la structure ET la hauteur réelles
// (header + onglets + filtres + barre rayon + grille de JOBS_PAGE_SIZE cartes)
// pour que le swap chunk lazy → page ne fasse bouger ni le footer ancré
// (flex-1, cf. App.js) ni le contenu : le fallback générique (PageSkeleton,
// 3 blocs courts) laissait un saut de ~118 px au remplacement de /jobs
// → CLS résiduel. La page affiche elle-même ListSkeleton(count=12) pendant
// son chargement : le fallback Suspense a exactement la même hauteur.
export const JobsSkeleton = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header : titre + date à gauche, sélecteur pays / toggle / bouton à droite */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div className="space-y-2">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-40 rounded-xl" />
          <Skeleton className="h-11 w-28 rounded-xl" />
          <Skeleton className="h-12 w-40 rounded-xl" />
        </div>
      </div>

      {/* Onglets (découverte / candidatures / missions) */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-32 rounded-xl" />
        <Skeleton className="h-10 w-40 rounded-xl" />
      </div>

      {/* Filtres : recherche + catégorie (le select statut n'est rendu QUE
          dans les onglets « candidatures/missions », pas en découverte —
          aligné sur la vue réelle par défaut pour la hauteur) */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>

      {/* Barre rayon (proximité) */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-32 rounded-xl" />
        <Skeleton className="h-10 w-36 rounded-xl" />
      </div>

      {/* Liste : même hauteur que le rendu réel (JOBS_PAGE_SIZE cartes) */}
      <ListSkeleton count={12} />

      {/* Bouton « Afficher plus » : présent côté réel quand hasMore (12 jobs
          rendus = exactement une page pleine) — placeholder à la même
          hauteur pour que le footer ne remonte pas au swap. */}
      <div className="mt-6 flex justify-center">
        <Skeleton className="h-11 w-48 rounded-xl" />
      </div>
    </div>
  );
};

// Skeleton de la page JobDetails — extrait du squelette interne de la page
// (même structure : bouton retour + carte en-tête + carte description +
// sidebar info/client) pour servir AUSSI de fallback Suspense de /jobs/:id :
// le swap chunk → page ne change pas la hauteur → footer ancré stable.
export const JobDetailsSkeleton = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Skeleton className="h-6 w-28 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <Skeleton className="h-8 w-3/4" />
            <div className="flex items-center gap-3 mt-3">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mt-6">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-32" />
            </div>
            <div className="flex flex-wrap gap-3 mt-6">
              <Skeleton className="h-12 w-36 rounded-xl" />
              <Skeleton className="h-12 w-28 rounded-xl" />
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2 mt-2" />
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <Skeleton className="h-6 w-24 mb-4" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Skeleton de la page Login — réplique la structure ET la hauteur réelles du
// formulaire (logo + titre, champs email/mot de passe, bouton de connexion,
// bouton Google, encart légal, lien register) pour servir de fallback
// Suspense à /login. Comme la page, il est en min-h-full (remplit le main
// flex-1) : le swap chunk lazy → page ne fait bouger ni le footer ancré ni
// le contenu — le fallback générique (PageSkeleton, blocs pleine largeur)
// laissait un saut de hauteur au remplacement du formulaire.
export const LoginSkeleton = () => {
  return (
    <div className="min-h-full flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <Skeleton className="mx-auto h-12 w-12 rounded-full" />
          <Skeleton className="mx-auto mt-6 h-8 w-40" />
        </div>

        <form className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="mt-1 h-10 w-full" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="mt-1 h-10 w-full" />
            </div>
          </div>

          {/* Bouton de connexion */}
          <Skeleton className="h-11 w-full" />

          {/* Bouton Google */}
          <Skeleton className="h-11 w-full" />

          {/* Encart légal */}
          <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-3 w-64" />
          </div>

          {/* Lien register */}
          <div className="text-center">
            <Skeleton className="mx-auto h-4 w-44" />
          </div>
        </form>
      </div>
    </div>
  );
};

// Skeleton de la page ForgotPassword — réplique la structure ET la hauteur
// réelles du premier écran (étape « email » : icône + titre + sous-titre,
// carte avec indicateur d'étapes, champ email, aide, bouton, lien retour)
// pour servir de fallback Suspense à /forgot-password : swap sans saut de
// hauteur (footer ancré stable), comme LoginSkeleton / JobsSkeleton.
//
// Calibré sur le DOM réel (probe CDP, viewport 412×823, langue fr) : la page
// occupe 528 px de contenu (en-tête 168 = icône 56 + titre 36 + sous-titre
// 40 ; carte 328 = p-6 + étapes 16 + form 192 + lien 24). Le squelette n'en
// faisait que 464 px, sous l'espace libre de main (823 − navbar 65 − footer
// 53 = 705 px) : main restait donc à 705 px alors que la page atteint
// 192 + 528 = 720 px, et le footer montait de 770 à 785 px au swap (CLS
// 0,0012). Les blocs reprennent maintenant les HAUTEURS RÉELLES des éléments
// (et non plus des h-3/h-4 génériques) : main vaut 720 px dans les deux
// phases, le footer ne bouge plus (CLS mesuré 0,0000).
export const ForgotPasswordSkeleton = () => {
  return (
    <div className="min-h-full flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Skeleton className="mx-auto h-14 w-14 rounded-full" />
          <Skeleton className="mx-auto mt-6 h-9 w-56" />
          <Skeleton className="mx-auto mt-3 h-10 w-72" />
        </div>

        <div className="space-y-6 rounded-2xl bg-white p-6 shadow-md">
          {/* Indicateur d'étapes (1. Email / 2. Code / 3. Mot de passe) */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-3 w-20" />
          </div>

          {/* Champ email + aide + bouton */}
          <div className="space-y-5">
            <div>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="mt-1 h-12 w-full" />
            </div>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>

          {/* Lien retour vers /login */}
          <div className="text-center">
            <Skeleton className="mx-auto h-6 w-36" />
          </div>
        </div>
      </div>
    </div>
  );
};

// Squelette de page Dashboard — fallback du Suspense de la route /dashboard
// (App.js). Réplique EXACTE de SkeletonDashboardShell (Dashboard.js, phase de
// chargement des données) qui réplique elle-même le rendu final : le passage
// skeleton-chunk → skeleton-données → page réelle ne déplace AUCUN élément
// (footer ancré par le flex-1 du main, CLS ≈ 0). Le squelette vit dans le
// chunk d'entrée : disponible avant l'arrivée du chunk lazy Dashboard.
export const DashboardSkeleton = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header d'accueil */}
      <div className="mb-8">
        <Skeleton className="h-8 w-64 max-w-full" />
        <div className="mt-2">
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>

      {/* 4 cartes statistiques : même grille que le rendu final */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <Skeleton className="h-4 w-20" />
                <div className="mt-3">
                  <Skeleton className="h-7 w-28" />
                </div>
              </div>
              <Skeleton className="h-12 w-12 rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      {/* Section quick-actions : conteneur stable, contenu skeleton */}
      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Liste récente : header + lignes skeleton (même structure que la page) */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="divide-y divide-gray-200">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Skeleton className="h-4 w-1/3 max-w-xs" />
                  <div className="mt-2">
                    <Skeleton className="h-3 w-full max-w-lg" />
                  </div>
                  <div className="flex items-center mt-3 space-x-4">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-5 w-5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Squelette de page Profile — fallback du Suspense de la route /profile
// (App.js). Réplique EXACTE de ProfileSkeleton (Profile.js, phase de
// chargement des données — CLS mesuré 0.112 avant) : carte max-w-4xl, header
// orange (photo ronde + nom), sections avis / infos personnelles 2×2 /
// paiement / support. Le squelette vit dans le chunk d'entrée : disponible
// avant l'arrivée du chunk lazy Profile.
export const ProfileSkeleton = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {/* Header orange / photo / nom */}
        <div className="bg-orange-600 px-6 py-8">
          <div className="flex items-center">
            <Skeleton className="h-20 w-20 rounded-full bg-white/30 border-2 border-white" />
            <div className="ml-6 flex-1">
              <Skeleton className="h-7 w-56 max-w-full bg-white/30" />
              <div className="mt-2">
                <Skeleton className="h-4 w-40 bg-white/30" />
              </div>
              <div className="mt-3">
                <Skeleton className="h-4 w-52 bg-white/30" />
              </div>
            </div>
          </div>
        </div>

        {/* Section avis */}
        <div className="px-6 py-6 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
          <div className="mt-4">
            <Skeleton className="h-4 w-3/4 max-w-md" />
          </div>
        </div>

        {/* Section informations personnelles */}
        <div className="px-6 py-6 border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index}>
                <Skeleton className="h-4 w-20" />
                <div className="mt-1">
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sections bas de carte : paiement + support */}
        <div className="px-6 py-6 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
          <div className="mt-4">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>

        <div className="px-6 pb-6">
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
};

// Skeleton de la page Messages — réplique la structure réelle : conteneur
// max-w-6xl py-8, titre h1 (text-2xl → 32 px) puis carte à deux volets de
// 75vh (liste des conversations en colonne 320 px à partir de sm, volet de
// conversation vide sinon). Partagé par le fallback Suspense de /messages ET
// par le chargement des conversations : l'état de chargement interne
// omettait le h1, qui apparaissait seulement une fois les données arrivées
// (léger décalage du contenu).
export const MessagesSkeleton = () => {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Titre de page réel (h1 text-2xl) */}
      <Skeleton className="h-8 w-40 mb-4" />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden h-[75vh] flex">
        {/* Colonne des conversations (pleine largeur sur mobile) */}
        <div className="w-full sm:w-[320px] sm:flex-shrink-0 border-r border-gray-100 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex-1 overflow-hidden py-2">
            <ListSkeleton count={6} type="message" />
          </div>
        </div>

        {/* Volet conversation (masqué sur mobile tant qu'aucune n'est ouverte) */}
        <div className="hidden sm:flex flex-1 items-center justify-center">
          <Skeleton className="h-6 w-48" />
        </div>
      </div>
    </div>
  );
};

// Contenu de la page Paiement (cartes sous l'en-tête) — EXTRAIT de Payment.js :
// la page n'a plus son propre squelette dupliqué, et le fallback Suspense de
// /payment réutilise exactement ces hauteurs (aucun décalage au swap).
// Carte quote (en-tête + 3 champs + bouton) puis carte paiements récents.
export const PaymentContentSkeleton = () => {
  return (
    <div className="space-y-6">
      {/* Carte quote : en-tête + 3 champs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-32 rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-11 w-full mt-2 rounded-xl" />
          </div>
          <div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-11 w-full mt-2 rounded-xl" />
          </div>
          <div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-11 w-full mt-2 rounded-xl" />
          </div>
        </div>
        {/* Bouton payer */}
        <Skeleton className="h-11 w-48 mt-6 rounded-xl" />
      </div>

      {/* Carte paiements récents */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <Skeleton className="h-6 w-56" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
};

// Skeleton complet de la page Paiement (fallback Suspense de /payment) :
// réplique l'enveloppe réelle (min-h-full bg-gray-50 py-8 + conteneur
// max-w-6xl) et la carte de titre, puis le contenu ci-dessus — le swap
// chunk → page ne déplace ni le footer ancré (flex-1, cf. App.js) ni les
// cartes.
export const PaymentSkeleton = () => {
  return (
    <div className="min-h-full bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {/* h1 text-3xl + sous-titre */}
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-6 w-96 max-w-full mt-2" />
        </div>
        <PaymentContentSkeleton />
      </div>
    </div>
  );
};

export default Skeleton;
