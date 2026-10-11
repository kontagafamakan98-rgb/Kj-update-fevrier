import React from 'react';
// Les squelettes des routes d'application LISENT le cadre de leur page au lieu de
// le recopier : un squelette existe pour réserver la géométrie que la page
// peindra, donc une réserve qui diverge de la page est exactement le CLS qu'elle
// prétend empêcher — et cette divergence-là ne rougissait nulle part
// (`antiClsSkeletons.test.jsx` ne lit que les classes qu'il connaît).
import CadrePage from './CadrePage';
// /payment ne passe PAS par `CadrePage` (elle a une coquille pré-rendue : ses
// deux canaux lisent `PAGE_SECTIONS['/payment']`), donc son repli lit le MÊME
// plan — cadre, corps et règle de chargement — au lieu d'en recopier les
// classes. C'est la déclaration qui a un propriétaire, pas le squelette.
import { PAGE_SECTIONS } from '../config/page-sections';
import { REGLES_DE_CHARGEMENT } from '../config/app-cadres';

// Composant de base Skeleton.
//
// `pulse` permet à un bloc de renoncer à sa PROPRE animation quand un ancêtre
// la porte déjà. Sur la liste de /jobs (12 cartes × 9 blocs) cela fait passer
// 108 animations d'opacité à 12 : chacune maintenait son élément en recalcul de
// style à chaque image (trace CDP : StyleRecalcInvalidationTracking,
// reason=Animation, 24 relevés par bloc sur un seul chargement), alors que le
// rendu est identique à l'œil — les blocs pulsaient déjà en phase, ayant été
// montés au même instant.
export const Skeleton = ({ className = '', width, height, pulse = true }) => {
  const style = {};
  if (width) style.width = width;
  if (height) style.height = height;

  return (
    <div
      className={`${pulse ? 'animate-pulse ' : ''}bg-stone-200 rounded-[3px] ${className}`}
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
    <div className="carte-editoriale block p-6 min-h-[277px] md:min-h-0">
      {/* Une SEULE animation pour toute la carte : le fond blanc et la bordure
          (portés par la racine) restent fixes, et les 9 barres pulsent en phase
          comme avant — mais sans 9 recalcs de style par image. */}
      <div className="animate-pulse flex justify-between items-start gap-6 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          {/* Titre + badge statut (line-heights réels : text-lg 28px / badge 22px) */}
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <Skeleton className="h-7 w-48" pulse={false} />
            <Skeleton className="h-6 w-16 rounded-full" pulse={false} />
          </div>
          {/* Description line-clamp-2 (2 × 24px) */}
          <div className="mb-4 space-y-2">
            <Skeleton className="h-6 w-full" pulse={false} />
            <Skeleton className="h-6 w-5/6" pulse={false} />
          </div>
          {/* Rangée méta (text-sm 20px) */}
          <div className="flex flex-wrap gap-4">
            <Skeleton className="h-5 w-20" pulse={false} />
            <Skeleton className="h-5 w-24" pulse={false} />
            <Skeleton className="h-5 w-16" pulse={false} />
          </div>
        </div>

        {/* Budget (text-2xl 32px) + durée (text-sm 20px) */}
        <div className="ml-0 md:ml-6 text-right min-w-[170px]">
          <Skeleton className="ml-auto h-8 w-28" pulse={false} />
          <Skeleton className="ml-auto mt-1 h-5 w-20" pulse={false} />
        </div>
      </div>
    </div>
  );
};

// Skeleton pour une carte de profil
export const ProfileCardSkeleton = () => {
  return (
    <div className="carte-editoriale p-6">
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
    <div className="flex items-start space-x-3 p-4 hover:bg-stone-50">
      <Skeleton className="h-12 w-12 rounded-full shrink-0" />
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
    <div className="carte-editoriale overflow-hidden">
      {/* Header */}
      <div className="fond-sable px-6 py-3 border-b border-stone-200">
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
    <div className="min-h-screen fond-sable">
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
            <div key={index} className="carte-editoriale p-6 space-y-3">
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
//
// ── CE QUI EST VRAI DE CETTE HAUTEUR, RE-MESURÉ LE 09/10/2026 ──────────────
// « exactement la même hauteur » est la CIBLE, pas le relevé : la sonde du
// protocole (chunk de la route retenu puis relâché, 412×823 et 1350×940) a
// mesuré les TROIS états de la route, chacun dans son propre run — repli 4 354
// / 2 838 px de `main`, état de chargement INTERNE de la page (chunk relâché,
// `GET /api/jobs` retenu) 4 312,8 / 2 981,8, page servie 4 231,0 / 2 714,6. Le
// repli diverge donc de l'état de chargement de la page de 41 px en mobile et
// de 144 px en desktop (il est plus haut dans l'un, plus bas dans l'autre) :
// les deux répliquent le même écran avec des blocs calibrés séparément, et le
// texte, lui, ne peut pas être partagé (il vit dans le dictionnaire du scope
// `jobs`, chargé avec le chunk de la page — cf. le commentaire de l'intro).
// CE QUI N'EST PAS UNE RAISON DE RELÂCHER LA RÈGLE QUI COMPTE, elle mesurée à
// 0,0000 dans les TROIS transitions (repli → chargement → page) aux deux
// tailles : le pied de page est à 4 419 / 2 903 px du haut, très au-dessous de
// la ligne de flottaison (823 / 940) dans chacun des états, donc rien de
// visible ne bouge — contrairement à /payment, où la même divergence tombe sur
// un pied de page visible (cf. `PaymentSkeleton`).
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

      {/* Paragraphe d'intro : la même hauteur RÉSERVÉE que le paragraphe réel
          (`min-h-[104px] md:min-h-[52px]`, soit 4 lignes mobiles / 2 lignes
          bureau — la mesure du rendu réel à 412 et 1350 px de large). Les
          barres tiennent en 40 px, donc c'est le `min-h` qui décide de la
          hauteur, aux deux points de rupture : la boîte du squelette et celle
          du paragraphe sont ainsi la MÊME, et l'intro qui disparaît pendant le
          chargement ne déplace pas la liste (même dispositif que la coquille).

          Le texte n'est pas ici, et c'est volontaire : il vit dans le
          dictionnaire du scope `jobs`, chargé avec le chunk de la page. Le
          faire remonter jusqu'à ce squelette — monté par App.js — le mettrait
          dans le bundle initial (voir scripts/check-pack2-chunks.js), pour
          réserver une place qu'on peut réserver sans lui. */}
      <div className="mb-6 max-w-3xl space-y-2 min-h-[104px] md:min-h-[52px]">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
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
      <div className="carte-editoriale mb-6 flex flex-wrap items-center gap-3 p-4">
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
// sidebar info/client) pour servir AUSSI de fallback Suspense de /jobs/:id.
//
// ── POURQUOI IL RÉSERVE L'ÉCRAN (08/10/2026) ────────────────────────────────
// Sa structure est répliquée, sa HAUTEUR ne peut pas l'être : elle dépend de la
// DESCRIPTION de la mission, dont la longueur n'a pas de maximum. Mesuré avec
// une mission LONGUE (créée par le chemin réel de la fixture) : la page fait
// 1 635,6 px en desktop pour un squelette de 590 px, et le pied de page — 1 350×81
// px à y=858,6, donc VISIBLE — est poussé hors de l'écran à l'arrivée des
// données : CLS 0,0577, dont le plus grand décalage (0,0537) NOMME le pied de
// page. La réserve (`squelette` : la hauteur vient de la déclaration de la
// route) le fait démarrer sous la ligne de flottaison, donc il n'a plus rien à
// quitter.
// Contrepartie assumée et mesurée : sur une mission COURTE (celle de la fixture,
// page de 719,6 px en desktop, plus courte que la fenêtre), le pied de page
// redescend dans l'écran quand les données arrivent — un déplacement de 161 px
// (CLS ≈ 0,015) là où il n'y en avait aucun. C'est le prix du cas LONG, qui est
// celui de la production (une annonce réelle fait plusieurs paragraphes), et il
// reste sous le plafond de la route (`scripts/lhci-cls-budgets.cjs`).
export const JobDetailsSkeleton = () => {
  return (
    <CadrePage chemin="/jobs/:id" classeCorps="" squelette>
      <Skeleton className="h-6 w-28 bloc-app" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="carte-editoriale carte-publique">
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
          <div className="carte-editoriale carte-publique space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="space-y-6">
          <div className="carte-editoriale carte-publique">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2 mt-2" />
          </div>
          <div className="carte-editoriale carte-publique">
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
    </CadrePage>
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
    <div className="min-h-full flex items-center justify-center fond-sable py-12 px-4 sm:px-6 lg:px-8">
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
    <div className="min-h-full flex items-center justify-center fond-sable py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Skeleton className="mx-auto h-14 w-14 rounded-full" />
          <Skeleton className="mx-auto mt-6 h-9 w-56" />
          <Skeleton className="mx-auto mt-3 h-10 w-72" />
        </div>

        {/* La carte du site (`carte-editoriale`) : c'est celle de la page réelle
            ET de la coquille. Le filet remplace l'ombre, et ajoute les 2 px de
            bordure sur les TROIS canaux à la fois — sans quoi le swap du
            squelette vers la page déplaçait le pied de page. */}
        <div className="carte-editoriale space-y-6 p-6">
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
//
// ── POURQUOI IL RÉSERVE L'ÉCRAN (08/10/2026) ────────────────────────────────
// La liste récente rend jusqu'à 5 lignes quand le squelette en réserve 3, donc
// la page (1 522,3 px mesurés en desktop) est plus haute que lui (960 px). Le
// pied de page restait hors écran par ACCIDENT aux deux tailles d'usage (la
// fenêtre de 940 px est plus courte que le squelette) : dans une fenêtre de
// 1 200 px il est VISIBLE (mesuré y=1 119) pendant tout le chargement. La règle
// est une réserve qui SUIT la fenêtre, donc elle vaut aux trois tailles — et à
// celles qu'aucune sonde ne visite.
export const DashboardSkeleton = () => {
  return (
    <CadrePage chemin="/dashboard" classeCorps="" squelette>
      {/* Header d'accueil */}
      <div className="tete-app">
        <Skeleton className="h-8 w-64 max-w-full" />
        <div className="mt-2">
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>

      {/* 4 cartes statistiques : même grille que le rendu final */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bloc-app">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="carte-editoriale carte-publique">
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
      <div className="carte-editoriale bloc-app">
        <div className="carte-cotes py-4 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="carte-publique">
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
      <div className="carte-editoriale">
        <div className="carte-cotes py-4 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="divide-y divide-gray-200">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="carte-publique">
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
    </CadrePage>
  );
};

// Squelette de page Profile — PROPRIÉTAIRE UNIQUE depuis le 07/10/2026 : il sert
// le repli Suspense de la route /profile (App.js) ET l'état de chargement des
// données de `Profile.js`. Cette page en portait une SECONDE copie locale,
// identique au rendu (mesuré : mêmes classes, mêmes blocs) mais invisible à
// toute relecture — or c'est ELLE qui était peinte pendant le chargement des
// données, donc la hauteur minimale ajoutée ici n'avait aucun effet (CLS 0,1010
// sur /profile desktop, mesuré par e2e/cadres-app.spec.js). La copie a été
// supprimée : une seule définition, donc les deux phases ne peuvent plus
// diverger (c'est la règle que tient `antiClsSkeletons.test.jsx`).
//
// Structure : carte max-w-4xl, header orange (photo ronde + nom), sections avis
// / infos personnelles 2×2 / paiement / support. Le squelette vit dans le chunk
// d'entrée : disponible avant l'arrivée du chunk lazy Profile.
//
// ── LA HAUTEUR MINIMALE, ET POURQUOI ELLE EST LÀ (07/10/2026) ───────────────
// La sonde `e2e/cadres-app.spec.js` a MESURÉ 0,1010 de CLS sur /profile en
// desktop : pendant le chargement, la page est PLUS COURTE QUE LA FENÊTRE, donc
// le pied de page vient se poser au bas de l'écran ; quand les données
// arrivent (la page réelle fait 2 399 px), il est tiré de ~1 600 px vers le bas
// et SORT de l'écran — un déplacement que Chrome compte, et que le plafond de
// 0,06 refusait à juste titre.
//
// Le remède est la règle DÉJÀ ÉCRITE pour les états de chargement génériques
// (`src/components/__tests__/antiClsSkeletons.test.jsx` : « le footer doit
// rester HORS de l'écran pendant tout le chargement »), et elle s'applique ici
// pour la même raison : ce squelette ne peut PAS répliquer la hauteur de la
// page qu'il remplace, puisque celle-ci dépend des données (2 399 px ici,
// 2 911 en mobile). Un squelette dédié ne tient la règle inverse (« le footer
// peut rester visible, il ne bouge plus ») que lorsque sa hauteur ÉGALE celle
// de la page — vrai de `ForgotPasswordSkeleton`, faux de celui-ci.
//
// La hauteur réservée n'est PAS écrite ici depuis le 08/10/2026 : elle est
// DÉCLARÉE par la route (`src/config/app-cadres.js`, `squelette.hauteurClass`)
// et c'est `CadrePage` qui l'applique — le squelette dit seulement ce qu'il est
// (`squelette`). Trois squelettes portent désormais la même règle (/profile,
// /dashboard, /jobs/:id) : trois littéraux auraient été trois endroits à tenir
// d'accord, et le premier oublié aurait laissé un pied de page visible pendant
// le chargement sans que rien ne rougisse.
//
// MESURÉ APRÈS CORRECTION (sonde du 07/10/2026, 1350×940) : /profile passe de
// 0,1010 à **0,0039** — la valeur des deux autres routes connectées, et le
// reste est la pastille de notifications de la barre du haut, qui se résout à
// ~130 ms. Le plafond, lui, n'a pas bougé.
export const ProfileSkeleton = () => {
  return (
    <CadrePage chemin="/profile" squelette>
      <div className="carte-editoriale overflow-hidden">
        {/* Header orange / photo / nom */}
        <div className="bg-orange-600 carte-cotes py-8">
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
        <div className="carte-cotes py-6 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
          <div className="mt-4">
            <Skeleton className="h-4 w-3/4 max-w-md" />
          </div>
        </div>

        {/* Section informations personnelles */}
        <div className="carte-cotes py-6 border-b border-gray-200">
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
        <div className="carte-cotes py-6 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
          <div className="mt-4">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>

        <div className="carte-cotes pb-6">
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      </div>
    </CadrePage>
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
    <CadrePage chemin="/messages" classeCorps="">
      {/* Titre de page réel : sa BOÎTE est réservée avec la MÊME déclaration
          que le `<h1>` (`.reserve-titre-page`, src/index.css) — un `h-8` fixe
          valait 32 px pour un titre de 45,8 px à 1350 de large, et ces 13,8 px
          d'écart sont exactement la distance dont le pied de page bougeait à
          l'arrivée des données (mesuré : de y=936, visible, à 949,8). */}
      <Skeleton className="reserve-titre-page w-40 tete-app" />

      <div className="carte-editoriale overflow-hidden h-[75vh] flex">
        {/* Colonne des conversations (pleine largeur sur mobile) */}
        <div className="w-full sm:w-[320px] sm:shrink-0 border-r border-gray-100 flex flex-col">
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
    </CadrePage>
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
      <div className="carte-editoriale p-6">
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
      <div className="carte-editoriale p-6">
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
//
// ── CE QUE CE REPLI RÉSERVE, ET POURQUOI IL LE RÉSERVE ENTIÈREMENT ────────
// Il est peint AVANT que la page existe, donc sans savoir dans laquelle de ses
// trois branches la page tombera (`job_id`, retour du payeur, ou la carte
// « mission requise » — cf. `src/utils/paymentBranche.js`). Il réserve donc les
// cartes de la branche la PLUS HAUTE, et c'est un choix MESURÉ, pas un défaut
// de copie : une variante qui ne réservait que l'en-tête sur la branche « pas
// de mission » (celle que publie la coquille) a été écrite puis RETIRÉE le
// 09/10/2026, parce qu'elle rendait la route PIRE. Relevé de la sonde, chunk
// de la route retenu puis relâché, 412×823, quatre runs par variante :
//   • repli entier  — pied de page HORS écran pendant le chargement (y=1019),
//     il entre une seule fois à l'arrivée de la page (y=765,4) ;
//   • repli réduit  — `main` tombe à 617 px, le pied de page est INSÉRÉ DANS
//     l'écran dès le chargement (y=682) et sa hauteur vaut alors 141 px (il
//     re-coupe ses lignes avant que la police ne se pose) : deux décalages,
//     CLS 0,0801 contre 0,0579.
// Ce qui a été corrigé sur cette route n'est donc pas ici, mais dans
// `src/pages/Payment.js` : c'est l'ÉTAT DE CHARGEMENT DE LA PAGE qui
// réservait des cartes que sa branche ne montre pas (1 376,4 px de `main` pour
// une destination de 700,4 en mobile).
//
// ── LA RÈGLE, ELLE, EST DÉCLARÉE ET LUE (09/10/2026) ──────────────────────
// Ce repli ne recopie plus rien : son CADRE vient du plan de /payment
// (`PAGE_SECTIONS['/payment']` : `frameClass`, `corpsClass` — les deux canaux de
// cette route lisent le même plan, et la coquille peint ce cadre) et sa RÈGLE
// vient de `REGLES_DE_CHARGEMENT['/payment']` (`src/config/app-cadres.js`), qui
// dit `pied-hors-ecran` et nomme la réserve. Le squelette peignait `fond-sable`
// là où la page peint le fond de son plan — deux fonds pour un seul écran, vus
// au remplacement — et n'avait aucune réserve : le pied de page restait VISIBLE
// en desktop pendant tout le chargement (mesuré : y=859 pour une fenêtre de
// 940, déjà à sa place finale). Avec la réserve déclarée, il démarre HORS écran
// aux deux tailles (1019 pour 823 ; 1004 pour 940) et le relâchement passe de
// 0,0148 à 0,0132 en desktop, en restant à 0,0218 en mobile (où la réserve est
// sans effet : le contenu du repli, 794 px, dépasse déjà les 758 px du plancher).
export const PaymentSkeleton = () => {
  const plan = PAGE_SECTIONS['/payment'];
  const { hauteurClass } = REGLES_DE_CHARGEMENT['/payment'];
  return (
    <div className={plan.frameClass}>
      <div className={`${plan.corpsClass} ${hauteurClass}`}>
        <div className="carte-editoriale p-6">
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
