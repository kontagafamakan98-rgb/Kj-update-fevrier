import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import {
  MessagesSkeleton,
  PaymentSkeleton,
  PaymentContentSkeleton,
  JobsSkeleton,
  JobDetailsSkeleton,
  LoginSkeleton,
  ForgotPasswordSkeleton,
  DashboardSkeleton,
  ProfileSkeleton,
} from '../SkeletonLoader';
import { carteMissionRequise } from '../../utils/paymentBranche';
// Le cadre de /payment est lu dans son PROPRIÉTAIRE (le plan à deux canaux),
// jamais recopié : c'est ce que le repli fait lui-même depuis le 09/10/2026.
import { PAGE_SECTIONS } from '../../config/page-sections';
import { REGLES_DE_CHARGEMENT, REGLES_DE_SQUELETTE } from '../../config/app-cadres';
import { sourcesLivrees } from './aide-sources-livrees';

// Garde-fou anti-CLS (niveau source + rendu).
//
// Le CLS venait d'un décalage au REMPLACEMENT du fallback Suspense par la page
// réelle : le fallback générique (PageSkeleton, 3 blocs courts) n'avait pas la
// hauteur des pages (grille de cartes, carte de 75vh, formulaire…), donc le
// contenu — et le footer ancré (flex-1, cf. App.js) — bougeait.
//
// Ce fichier verrouille les deux propriétés qui rendent le correctif durable :
//   1. chaque route concernée a bien un fallback Suspense DÉDIÉ dans App.js
//      (et pas le PageSkeleton générique) ;
//   2. la page partage le MÊME squelette pour son propre état de chargement,
//      sinon les deux phases divergent à nouveau (squelette dupliqué).
//
// Les pages concernées : /jobs, /jobs/:id, /login, /forgot-password,
// /dashboard, /profile, /messages, /payment.

const APP_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../App.js'),
  'utf8'
);

const ROUTE_FALLBACKS = [
  ['/jobs', 'JobsSkeleton'],
  ['/jobs/:id', 'JobDetailsSkeleton'],
  ['/login', 'LoginSkeleton'],
  ['/forgot-password', 'ForgotPasswordSkeleton'],
  ['/dashboard', 'DashboardSkeleton'],
  ['/profile', 'ProfileSkeleton'],
  ['/messages', 'MessagesSkeleton'],
  ['/payment', 'PaymentSkeleton'],
];

const pulseCount = (container) => container.querySelectorAll('.animate-pulse').length;

describe('anti-CLS — fallbacks Suspense dédiés par route', () => {
  it('chaque route a son squelette dédié (et non le PageSkeleton générique)', () => {
    const offenders = [];
    for (const [route, skeleton] of ROUTE_FALLBACKS) {
      // Le fallback doit apparaître dans le bloc `element` de la route, avant
      // la fin de la ligne `} />` qui la ferme.
      const routeBlock = new RegExp(
        `path="${route}"[\\s\\S]{0,600}?fallback=\\{<${skeleton} />\\}`
      );
      if (!routeBlock.test(APP_SOURCE)) {
        offenders.push(`${route} → fallback={<${skeleton} />} absent`);
      }
    }
    expect(
      offenders,
      `Routes sans squelette Suspense dédié (CLS au remplacement du chunk) :\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('les squelettes dédiés sont bien importés dans App.js', () => {
    for (const [, skeleton] of ROUTE_FALLBACKS) {
      expect(APP_SOURCE).toMatch(new RegExp(`import \\{[^}]*\\b${skeleton}\\b`));
    }
  });
});

describe('anti-CLS — les pages partagent leur squelette (pas de doublon)', () => {
  it('Payment.js utilise PaymentContentSkeleton au lieu de son propre squelette', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../pages/Payment.js'), 'utf8');
    expect(src).toMatch(/import \{[^}]*PaymentContentSkeleton[^}]*\} from '\.\.\/components\/SkeletonLoader'/);
    // 09/10/2026 — LE SQUELETTE N'EST PEINT QUE DANS LA BRANCHE QUI LE MONTRE.
    // La carte « mission requise » (ni mission, ni retour de payeur) ne porte
    // aucune carte de paiement : les réserver faisait valoir à l'état de
    // chargement 1 376,4 px de `main` pour une destination de 700,4 (412×823),
    // et le pied de page remontait DANS l'écran à l'arrivée des données
    // (CLS 0,0579, nommé sur `<footer>`). La condition est LUE, jamais
    // ré-écrite ici : `src/utils/paymentBranche.js` en est le propriétaire.
    expect(src).toMatch(/\{loading && cartesDePaiementAttendues && <PaymentContentSkeleton \/>\}/);
    expect(src).toMatch(/import \{[^}]*carteMissionRequise[^}]*\} from '\.\.\/utils\/paymentBranche'/);
    expect(src).toMatch(/const cartesDePaiementAttendues = !carteMissionRequise\(\);/);
    // Le test de branche n'est écrit qu'UNE fois dans la page : le retour du
    // payeur n'y est plus relu du tout, et l'ancienne condition double
    // (`!jobPaymentContext && !statusParams`) a disparu au profit du prédicat.
    expect(src).not.toMatch(/params\.get\('payment_id'\)/);
    expect(src).not.toMatch(/params\.get\('token'\)/);
    expect(src).not.toMatch(/!jobPaymentContext && !statusParams/);
    // Plus de primitive Skeleton locale ni de squelette dupliqué dans la page.
    expect(src).not.toMatch(/^const Skeleton = \(/m);
    expect(src).not.toMatch(/function PaymentPageSkeleton\(/);
  });

  it('Messages.js utilise MessagesSkeleton pour son état de chargement', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../pages/Messages.js'), 'utf8');
    expect(src).toMatch(/import \{[^}]*MessagesSkeleton[^}]*\} from '\.\.\/components\/SkeletonLoader'/);
    expect(src).toMatch(/if \(loading\) \{[\s\S]{0,300}?return <MessagesSkeleton \/>/);
    // L'ancien bloc de chargement réimplémentait le squelette en ligne.
    expect(src).not.toMatch(/ListSkeleton count=\{4\} type="message"/);
  });
});

describe('anti-CLS — structure des squelettes (hauteurs du layout réel)', () => {
  const CASES = [
    ['MessagesSkeleton', MessagesSkeleton, ['max-w-6xl', 'h-[75vh]', 'sm:w-[320px]']],
    // 09/10/2026 : LE REPLI LIT SON CADRE AU LIEU DE LE RECOPIER. Il peignait
    // `fond-sable` — le fond de l'APPLICATION (App.js) — là où la page ET sa
    // coquille lisent `bg-gray-50` dans le plan : deux fonds pour un seul écran,
    // vus au remplacement. Les jetons attendus sont donc LUS dans la
    // déclaration (`PAGE_SECTIONS['/payment']` : cadre + corps), jamais
    // recopiés ici — un test qui les recopierait divergerait à la première
    // retouche du plan, le défaut même que la lecture ferme.
    [
      'PaymentSkeleton',
      PaymentSkeleton,
      [
        ...PAGE_SECTIONS['/payment'].frameClass.split(/\s+/),
        ...PAGE_SECTIONS['/payment'].corpsClass.split(/\s+/),
      ],
    ],
    // 28/09/2026 : la carte du squelette prend le dessin de la carte RÉELLE
    // (`carte-editoriale`, src/index.css) — la forme arrondie `rounded-2xl`
    // n'est plus ce que les deux peignent. La boîte, elle, ne bouge pas : elle
    // portait déjà une bordure de 1 px, que la classe remplace sans changer le
    // rayon utile (le CLS ne dépend pas du rayon, mais l'œil si).
    ['PaymentContentSkeleton', PaymentContentSkeleton, ['carte-editoriale', 'grid-cols-1', 'md:grid-cols-3']],
    ['JobsSkeleton', JobsSkeleton, ['max-w-7xl']],
    ['JobDetailsSkeleton', JobDetailsSkeleton, ['max-w-7xl']],
    ['LoginSkeleton', LoginSkeleton, []],
    // Blocs calibrés sur le DOM réel de /forgot-password (probe CDP) : titre
    // text-3xl → h-9, sous-titre et aide text-sm/text-xs repliés sur 2 lignes
    // → h-10 / h-8, champ et bouton réels (48 px) → h-12, libellé text-sm →
    // h-5, lien retour → h-6. sans ces hauteurs réelles, le squelette reste
    // SOUS l'espace libre de main et c'est la page (720 px) qui déplace le
    // footer de 15 px au swap (CLS 0,0012 → 0,0000 après calibration).
    ['ForgotPasswordSkeleton', ForgotPasswordSkeleton, ['min-h-full', 'h-9', 'h-10', 'h-8', 'h-12', 'h-6']],
    ['DashboardSkeleton', DashboardSkeleton, []],
    ['ProfileSkeleton', ProfileSkeleton, []],
  ];

  for (const [name, Component, expectedClasses] of CASES) {
    it(`${name} rend des blocs d'attente avec les classes du layout réel`, () => {
      const { container } = render(<Component />);
      // Un squelette sans bloc animé n'attend rien visuellement.
      expect(pulseCount(container)).toBeGreaterThan(0);
      for (const className of expectedClasses) {
        expect(
          container.querySelector(`.${CSS.escape(className)}`),
          `${name} : classe « ${className} » absente (structure réelle non répliquée)`
        ).not.toBeNull();
      }
    });
  }

  // CE CAS A DÉFENDU UN RETRAIT (09/10/2026). Une variante du repli — ne
  // réserver que l'en-tête sur la branche « pas de mission », celle que publie
  // la coquille — a été écrite, mesurée, puis RETIRÉE : elle rendait la route
  // PIRE. Relevé de la sonde (chunk de la route retenu puis relâché, 412×823,
  // quatre runs par variante) :
  //   • repli entier  — le pied de page reste HORS écran pendant le chargement
  //     (y=1019) et n'entre qu'une fois, à l'arrivée de la page (y=765,4) ;
  //   • repli réduit  — `main` tombe à 617 px, le pied de page est INSÉRÉ DANS
  //     l'écran dès le chargement (y=682) et sa hauteur vaut alors 141 px (il
  //     re-coupe ses lignes avant que la police ne se pose) : deux décalages,
  //     CLS 0,0801 contre 0,0579.
  // Ce qui a été corrigé sur cette route n'est donc pas le repli, mais l'ÉTAT
  // DE CHARGEMENT DE LA PAGE, qui réservait les cartes d'une branche qu'il ne
  // montre pas (cas précédent) : ce test tient la moitié qui reste.
  it('PaymentSkeleton reprend exactement le contenu de PaymentContentSkeleton', () => {
    const full = render(<PaymentSkeleton />);
    const content = render(<PaymentContentSkeleton />);
    // Le fallback de /payment doit contenir le même nombre de blocs que l'état
    // de chargement de la page : sinon les deux phases ont des hauteurs
    // différentes et le swap déplace le footer.
    expect(pulseCount(full.container)).toBeGreaterThan(pulseCount(content.container));
    expect(pulseCount(full.container) - pulseCount(content.container)).toBe(2); // h1 + sous-titre
    full.unmount();
    content.unmount();
  });

});

// ── LA BRANCHE A UN SEUL PROPRIÉTAIRE (09/10/2026) ──────────────────────────
// Le défaut corrigé n'était pas « un squelette trop haut » : c'était une RÈGLE
// écrite à deux endroits (ce que la page réserve / ce que son repli réserve),
// deux endroits qui ont fini par ne plus dire la même chose. Ces cas tiennent
// la règle unique, et ils mordent : ré-écrire le test d'URL dans l'une des deux
// surfaces rougit ici en la nommant.
describe('anti-CLS — la branche de /payment a un propriétaire unique', () => {
  it('carteMissionRequise décide sur la SEULE URL', () => {
    expect(carteMissionRequise('')).toBe(true);
    expect(carteMissionRequise('?amount=25000&country=senegal')).toBe(true);
    expect(carteMissionRequise('?job_id=playtest-job-1')).toBe(false);
    expect(carteMissionRequise('?job_id=j&amount=1000')).toBe(false);
    expect(carteMissionRequise('?payment_id=abc')).toBe(false);
    expect(carteMissionRequise('?token=abc')).toBe(false);
  });

  it('la page LIT le propriétaire au lieu de ré-écrire la règle', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../../pages/Payment.js'), 'utf8');
    expect(page, 'Payment.js ne lit pas le propriétaire de la branche').toContain(
      'carteMissionRequise'
    );
    // Le retour du payeur (payment_id/token) n'appartient QU'AU propriétaire :
    // c'est la moitié de la règle qui avait divergé. `job_id`, lui, se lit aussi
    // pour BÂTIR le contexte de mission (`jobPaymentContext`) — ce n'est pas un
    // second test de branche, donc il reste permis.
    expect(page, 'Payment.js ré-écrit la moitié « retour du payeur » de la branche').not.toMatch(
      /params\.get\('(payment_id|token)'\)/
    );
    expect(page).not.toMatch(/!jobPaymentContext && !statusParams/);
  });

  it('aucune autre source LIVRÉE ne relit les paramètres de la branche', () => {
    // Le balayage partagé des sources livrées : `src/` sans les tests, sans le
    // harnais — la même population que les autres gardes de forme du dépôt.
    const coupables = [];
    let lus = 0;
    for (const { relatif, contenu } of sourcesLivrees()) {
      if (relatif === 'utils/paymentBranche.js') continue;
      lus += 1;
      // Le nom de champ de la RÉPONSE d'API (`checkout.payment_id`) n'est pas
      // une lecture d'URL : la règle ne vise que l'appel `get(...)` d'une chaîne
      // de recherche, quel que soit le nom de la variable qui la porte (le
      // nommer `params` ne suffit pas — la fuite peut l'appeler autrement, et
      // c'est exactement ce que la mutation rejouée a montré).
      if (/\.get\(\s*['"](payment_id|token)['"]\s*\)/.test(contenu)) coupables.push(relatif);
    }
    // Un balayage qui n'a rien lu ne prouve rien (règle du dépôt).
    expect(lus, 'le balayage n’a lu aucune source livrée').toBeGreaterThan(50);
    expect(
      coupables,
      `La branche de /payment a UN propriétaire (utils/paymentBranche.js) ; ces fichiers relisent ses paramètres : ${coupables.join(', ')}`
    ).toEqual([]);
  });
});

// Les états de CHARGEMENT génériques (destination INCONNUE) suivent la règle
// INVERSE de celle des pages, et c'est mesuré (probe CDP, 412×823, session
// client sur le déploiement réel) :
//   • ProtectedRoute (contrôle d'auth) et PageSkeleton (fallback de toute
//     route sans Suspense interne) doivent garder le footer HORS de l'écran.
//     En 100vh (+ pb-24 mobile) main vaut 919 px et le footer 984 px, hors
//     écran pendant tout le chargement. En min-h-full le footer remontait à
//     770 px (donc visible) pour les pages courtes — et sur les pages
//     longues mesurées en prod (/dashboard main 1570-1946, /profile
//     1401-1890, /messages 825) il était ensuite tiré de 865 à 1180 px plus
//     bas : CLS prédit 0,064 contre 0,0010 mesuré (modèle validé sur quatre
//     mesures : 0,0012 / 0,0042 / 0,0167 / 0,0000).
//   • Un squelette DÉDIÉ (destination connue) fait l'inverse : il réplique
//     exactement la hauteur de sa page, donc le footer peut rester visible,
//     il ne BOUGE plus (c'est le cas de ForgotPasswordSkeleton ci-dessus).
// Seul MobileLoader garde aussi min-h-screen pour une autre raison : il
// REMPLACE tout le layout (App.js retourne tôt) — ni navbar ni footer.
describe('anti-CLS — états de chargement génériques : footer hors écran (100vh)', () => {
  const componentBody = (rel, startMarker, endMarker) => {
    const source = fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
    const start = source.indexOf(startMarker);
    expect(start, `marqueur « ${startMarker} » introuvable`).toBeGreaterThan(-1);
    const end = source.indexOf(endMarker, start);
    return source.slice(start, end === -1 ? source.length : end);
  };

  it('ProtectedRoute (App.js) garde son spinner en 100vh', () => {
    const body = componentBody('../../App.js', 'function ProtectedRoute(', '\nfunction OwnerOnlyRoute(');
    expect(
      body,
      'ProtectedRoute : min-h-screen absent — en min-h-full le footer devient visible pendant le contrôle d\'auth'
    ).toContain('className="min-h-screen');
    expect(
      body,
      'ProtectedRoute : min-h-full remet le footer dans le champ pendant le chargement'
    ).not.toContain('className="min-h-full');
  });

  it('PageSkeleton (fallback Suspense générique) reste en 100vh', () => {
    const body = componentBody('../SkeletonLoader.js', 'export const PageSkeleton', 'export const JobsSkeleton');
    expect(
      body,
      'PageSkeleton : min-h-screen absent — destination inconnue, le footer doit rester hors écran'
    ).toContain('className="min-h-screen');
    expect(body).not.toContain('className="min-h-full');
  });
});

// Les pages qui rendent dans le shell de l'application (App.js :
// `div.min-h-screen.flex.flex-col` > `main.flex-1` > page, avec LegalFooter)
// doivent exprimer leur hauteur minimale en POURCENTAGE du conteneur
// (`min-h-full`), jamais en hauteur de viewport (`min-h-screen`) : avec 100vh,
// la page dépasse de la hauteur de la navbar ET du footer, ce qui crée un
// défilement inutile et sort le footer du premier écran. Mesuré sur /register
// à viewport 1280×4000 : 118 px de débordement et CLS 0,0165 avec min-h-screen,
// 0 px et CLS 0,0081 avec min-h-full (aucun changement à viewport mobile, où le
// contenu dépasse déjà l'écran).
//
// Hors liste (volontairement) : Home.js, HowItWorks.js et PhotoTest.js utilisent
// encore min-h-screen — pages publiques dont la mise en page plein écran n'a pas
// été auditée ici, donc pas de règle forcée sur elles.
const PAGES_MIN_H_FULL = [
  'Login.js',
  'ForgotPassword.js',
  'Register.js',
  'Payment.js',
  'CommissionDashboard.js',
  'EmailVerificationPage.js',
  'PaymentVerificationPage.js',
  'MobileTest.js',
];

/**
 * LES PAGES DONT LE CONTENEUR RACINE VIENT D'UNE DÉCLARATION, et non d'un
 * littéral : la passe d'unification du 07/10/2026 a RETIRÉ `min-h-full` de
 * `Payment.js` pour le confier à `PAGE_SECTIONS['/payment']` (les deux canaux de
 * cette route lisent la même chaîne). Le contrôle ci-dessous suit donc la valeur
 * jusqu'à son PROPRIÉTAIRE, au lieu d'exiger que la page la recopie — sans quoi
 * il demanderait exactement le contraire de ce que le dépôt vient de faire.
 *
 * Le suivi reste BORNÉ : on n'extrait pas le fichier entier, mais le bloc de la
 * clé concernée jusqu'à la clé suivante. Une classe trouvée ailleurs dans le plan
 * ne vaudrait rien, et `min-h-screen` déclaré pour /jobs ne doit pas blanchir
 * une page de cette liste.
 */
const CADRES_DECLARES = {
  'Payment.js': { plan: '../../config/page-sections.js', cle: "'/payment': {" },
  // /login et /forgot-password lisent leur cadre dans le plan (passe du 09/10/2026) :
  // la valeur est suivie jusqu'au bloc de sa clé, comme pour /payment.
  'Login.js': { plan: '../../config/page-sections.js', cle: "'/login': {" },
  'ForgotPassword.js': { plan: '../../config/page-sections.js', cle: "'/forgot-password': {" },
};

/** Le bloc d'une clé de plan : de la clé à la clé suivante (ou à la fin). */
const blocDeLaCle = (plan, cle) => {
  const debut = plan.indexOf(cle);
  if (debut < 0) return null;
  const suite = plan.slice(debut + cle.length).search(/\n\s{2}'\//);
  return suite < 0 ? plan.slice(debut) : plan.slice(debut, debut + cle.length + suite);
};

describe('anti-CLS — wrappers de page ancrés sur le shell flex-1 (min-h-full)', () => {
  it('chaque page du shell utilise min-h-full et jamais min-h-screen', () => {
    const offenders = [];
    for (const page of PAGES_MIN_H_FULL) {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../pages', page),
        'utf8'
      );
      // Où la page déclare-t-elle sa hauteur minimale ? Soit chez elle (littéral),
      // soit dans le plan qu'elle lit — et le contrôle suit la valeur.
      let porteur = source;
      const declare = CADRES_DECLARES[page];
      if (declare) {
        const plan = fs.readFileSync(path.resolve(__dirname, declare.plan), 'utf8');
        const bloc = blocDeLaCle(plan, declare.cle);
        if (!bloc) {
          offenders.push(
            `${page} : le bloc « ${declare.cle} » est introuvable dans ${declare.plan} — ` +
              'la déclaration a été renommée ou supprimée, le contrôle ne peut plus suivre la valeur.'
          );
          continue;
        }
        porteur = bloc;
      }
      if (!porteur.includes('min-h-full')) {
        offenders.push(`${page} : min-h-full absent (le footer ancré ne sera pas comblé)`);
      }
      if (source.includes('min-h-screen')) {
        offenders.push(
          `${page} : min-h-screen présent (100vh → débordement navbar + footer, scroll inutile)`
        );
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('le suivi de la déclaration SAIT MORDRE — cas synthétiques', () => {
    // Le plan réel, réduit à deux clés : la classe doit être trouvée dans la BONNE.
    const plan = `export const PAGE_SECTIONS = {\n  '/payment': {\n    frameClass: 'min-h-full bg-gray-50 py-8',\n  },\n\n  '/jobs': {\n    frameClass: 'cadre-page min-h-screen',\n  },\n};\n`;
    const payment = blocDeLaCle(plan, "'/payment': {");
    expect(payment).toContain('min-h-full');
    expect(payment, 'le bloc /payment a débordé sur la clé suivante').not.toContain('min-h-screen');
    // Une clé absente rend `null` — donc un refus nommé, pas un vert silencieux.
    expect(blocDeLaCle(plan, "'/inexistant': {")).toBe(null);
  });
});

// ── L'intro de /jobs : un bloc, trois canaux, UNE hauteur ──────────────────
// Le plus grand texte de /jobs est son paragraphe d'intro, donc son élément
// LCP. Trois canaux le publient et doivent rester d'accord : la coquille
// pré-rendue le peint (avant tout JavaScript, donc indépendamment de l'API), la
// page le rend dès son premier rendu — requête encore en vol —, et le squelette
// de Suspense lui RÉSERVE sa hauteur pendant le chargement.
//
// Une hauteur qui diverge d'un côté déplace la liste au remplacement du
// squelette (CLS) ; une copie écrite d'un seul côté laisse les autres derrière,
// en silence. C'est pourquoi les trois lisent la MÊME clé déclarée par le plan
// (que le build exige dans la coquille, cf. exigerCorpsDeclare) et la MÊME
// hauteur réservée — calibrée sur le rendu réel (412 px : 4 lignes = 104 px ;
// 1350 px : 2 lignes = 52 px), mesurée à CLS 0,0000 sur les deux surfaces et
// vérifiée sur les trois largeurs 412 / 800 / 1350.
describe('anti-CLS — l’intro de /jobs : même clé et même hauteur pour les trois canaux', () => {
  const lire = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
  const HAUTEUR_RESERVEE = 'min-h-[104px] md:min-h-[52px]';

  it('la page et sa coquille publient l’intro par la clé déclarée par le plan', () => {
    const plan = lire('../../config/page-sections.js');
    expect(plan).toMatch(/['"]\/jobs['"]\s*:\s*\{[\s\S]{0,200}?introKey:\s*'intro'/);
    expect(lire('../../pages/Jobs.js')).toContain('pageT(pagePlan.introKey)');
    expect(lire('../../../vite-plugins/prerender/shells-routes.js')).toContain(
      'jobsT(jobsPlan.introKey)'
    );
  });

  it('la hauteur réservée est DÉCLARÉE une fois, et le squelette la réserve à l’identique', () => {
    // Depuis le 25/09/2026, la hauteur de l'intro n'est plus écrite dans la
    // page NI dans la coquille : elle est déclarée par le plan (`introClass`),
    // que les deux canaux lisent — c'est ce qui empêche une retouche d'un seul
    // côté de ré-élire un élément LCP. Le squelette, lui, n'est pas l'élément
    // LCP : il lui RÉSERVE sa hauteur, donc il porte encore la valeur, et
    // c'est la seule surface qui doive encore la contenir en clair.
    const plan = lire('../../config/page-sections.js');
    expect(
      plan,
      `le plan ne déclare plus la hauteur réservée « ${HAUTEUR_RESERVEE} » de l'intro de /jobs`
    ).toContain(HAUTEUR_RESERVEE);
    expect(
      lire('../SkeletonLoader.js'),
      `squelette (SkeletonLoader.js) : hauteur réservée « ${HAUTEUR_RESERVEE} » absente — le swap déplacera la liste`
    ).toContain(HAUTEUR_RESERVEE);
    // Les deux canaux LISENT cette déclaration au lieu de la recopier.
    expect(lire('../../pages/Jobs.js')).toContain('className={pagePlan.introClass}');
    expect(lire('../../../vite-plugins/prerender/shells-routes.js')).toContain(
      'class="${jobsPlan.introClass}"'
    );
  });

  it('le dictionnaire du scope fournit l’intro en français et en anglais', () => {
    const scope = lire('../../utils/pack2PageI18n/jobs.js');
    expect(scope).toMatch(/intro:\s*\n?\s*'Retrouvez/);
    expect(scope).toMatch(/intro:\s*\n?\s*'Find every mission/);
  });
});
