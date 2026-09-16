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
    expect(src).toMatch(/\{loading && <PaymentContentSkeleton \/>\}/);
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
    ['PaymentSkeleton', PaymentSkeleton, ['min-h-full', 'bg-gray-50', 'max-w-6xl']],
    ['PaymentContentSkeleton', PaymentContentSkeleton, ['rounded-2xl', 'grid-cols-1', 'md:grid-cols-3']],
    ['JobsSkeleton', JobsSkeleton, ['max-w-7xl']],
    ['JobDetailsSkeleton', JobDetailsSkeleton, ['max-w-7xl']],
    ['LoginSkeleton', LoginSkeleton, []],
    ['ForgotPasswordSkeleton', ForgotPasswordSkeleton, []],
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
