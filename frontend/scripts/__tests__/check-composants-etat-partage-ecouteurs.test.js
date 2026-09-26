/**
 * Tests du garde-fou « Détection des composants à état partagé et écouteurs dépendants d'une ref locale »
 * (fermeture de la classe de bug du panneau de notifications).
 *
 * Deux niveaux, comme les autres gardes du dépôt :
 *
 *   1. la RÈGLE (`scripts/composants-etat-partage-ecouteurs.js`) :
 *      - Détecte le schéma exact du bug historique (useNotifications + useRef + addEventListener mousedown + closePanel)
 *      - Accepte les composants à état local autonome (useState + useRef + setIsOpen(false))
 *      - Accepte les écouteurs utilisant une ancre partagée (ex: ancre issue du contexte) ou sans référence locale
 *      - Tolère les hooks de données pures sans action de fermeture
 *
 *   2. le GARDE (`scripts/check-composants-etat-partage-ecouteurs.js`) exécuté en
 *      sous-processus sur des arborescences de fixture :
 *      - Sort 0 sur une fixture propre au-dessus du plancher
 *      - Sort 1 et nomme le fichier, le composant, la ligne et l'action sur une fixture avec le bug
 *      - Refuse de juger (exit 1 avec message nommé) si le nombre de fichiers est sous le plancher (30)
 *      - Valide l'arbre réel de `src/` (0 violation).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyserCodeComposant,
  analyserDossierSource,
  compterMontagesComposants,
  MIN_FICHIERS_LUS,
} from '../composants-etat-partage-ecouteurs.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-composants-etat-partage-ecouteurs.js');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
});

function creerFixtureArbre({ avecBug = false, nbFichiers = 35 } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-test-shared-state-'));
  tempDirs.push(racine);
  const src = path.join(racine, 'src');
  fs.mkdirSync(src, { recursive: true });

  // Fichiers sains de remplissage pour dépasser le plancher
  for (let i = 0; i < nbFichiers; i += 1) {
    const sain = `
      import React, { useState, useRef, useEffect } from 'react';
      export default function Composant${i}() {
        const [ouvert, setOuvert] = useState(false);
        const refLocale = useRef(null);
        useEffect(() => {
          if (!ouvert) return;
          const handler = (e) => {
            if (refLocale.current && !refLocale.current.contains(e.target)) {
              setOuvert(false);
            }
          };
          document.addEventListener('mousedown', handler);
          return () => document.removeEventListener('mousedown', handler);
        }, [ouvert]);
        return <div ref={refLocale}>Composant {${i}}</div>;
      }
    `;
    fs.writeFileSync(path.join(src, `Composant${i}.js`), sain, 'utf8');
  }

  if (avecBug) {
    const bug = `
      import React, { useRef, useEffect } from 'react';
      import { useNotifications } from '../contexts/NotificationContext';
      export default function PanneauBugue() {
        const { isOpen, closePanel } = useNotifications();
        const localRef = useRef(null);
        useEffect(() => {
          if (!isOpen) return;
          const handler = (e) => {
            if (localRef.current && !localRef.current.contains(e.target)) {
              closePanel();
            }
          };
          document.addEventListener('mousedown', handler);
          return () => document.removeEventListener('mousedown', handler);
        }, [isOpen, closePanel]);
        return <div ref={localRef}>Bug</div>;
      }
    `;
    fs.writeFileSync(path.join(src, 'PanneauBugue.js'), bug, 'utf8');
  }

  return src;
}

function executerGarde(dossierSrc) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--src', dossierSrc], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

describe('Règle statique : analyserCodeComposant', () => {
  it('détecte le composant reproduisant le bug historique de NotificationDropdown', () => {
    const code = `
      import { useRef, useEffect } from 'react';
      import { useNotifications } from '../contexts/NotificationContext';

      export default function NotificationDropdown() {
        const { isOpen, closePanel } = useNotifications();
        const panelRef = useRef(null);

        useEffect(() => {
          if (!isOpen) return;
          const handler = (e) => {
            if (panelRef.current && !panelRef.current.contains(e.target)) {
              closePanel();
            }
          };
          document.addEventListener('mousedown', handler);
          return () => document.removeEventListener('mousedown', handler);
        }, [isOpen, closePanel]);

        return <div ref={panelRef}>Contenu</div>;
      }
    `;

    const { violations } = analyserCodeComposant(code, 'NotificationDropdown.js');
    expect(violations.length).toBe(1);
    expect(violations[0].ref).toBe('panelRef');
    expect(violations[0].action).toBe('closePanel');
    expect(violations[0].evenement).toBe('mousedown');
    expect(violations[0].message).toContain('NotificationDropdown.js');
    expect(violations[0].message).toContain("l'instance masquée refermera ou écrasera l'autre");
  });

  it('accepte un menu autonome avec état local (useState)', () => {
    const code = `
      import { useState, useRef, useEffect } from 'react';
      export default function MenuAutonome() {
        const [isOpen, setIsOpen] = useState(false);
        const conteneurRef = useRef(null);
        useEffect(() => {
          if (!isOpen) return;
          const handler = (e) => {
            if (!conteneurRef.current?.contains(e.target)) {
              setIsOpen(false);
            }
          };
          document.addEventListener('mousedown', handler);
          return () => document.removeEventListener('mousedown', handler);
        }, [isOpen]);
        return <div ref={conteneurRef}>Menu</div>;
      }
    `;

    const { violations } = analyserCodeComposant(code, 'MenuAutonome.js');
    expect(violations).toEqual([]);
  });

  it('accepte le NotificationPanel corrigé (ancrage partagé ancre.contains)', () => {
    const code = `
      import { useEffect, useRef } from 'react';
      import { useNotifications } from '../contexts/NotificationContext';

      export default function NotificationPanel() {
        const { isOpen, ancre, closePanel } = useNotifications();
        const panelRef = useRef(null);

        useEffect(() => {
          if (!isOpen || !ancre) return;
          const handler = (e) => {
            if (ancre.contains(e.target)) return;
            closePanel();
          };
          document.addEventListener('mousedown', handler);
          return () => document.removeEventListener('mousedown', handler);
        }, [isOpen, ancre, closePanel]);

        return <div ref={panelRef}>Panel</div>;
      }
    `;

    const { violations } = analyserCodeComposant(code, 'NotificationPanel.js');
    expect(violations).toEqual([]);
  });
});

describe('Garde en sous-processus : scripts/check-composants-etat-partage-ecouteurs.js', () => {
  it('sort 0 sur une arborescence fixture propre au-dessus du plancher', () => {
    const src = creerFixtureArbre({ avecBug: false, nbFichiers: 32 });
    const { code, stdout } = executerGarde(src);
    expect(code).toBe(0);
    expect(stdout).toContain('Aucun composant à état partagé');
    expect(stdout).toContain('32 fichiers analysés');
  });

  it('sort 1 et nomme le fichier et l’action sur un composant bugué', () => {
    const src = creerFixtureArbre({ avecBug: true, nbFichiers: 32 });
    const { code, stderr } = executerGarde(src);
    expect(code).toBe(1);
    expect(stderr).toContain('PanneauBugue.js');
    expect(stderr).toContain('closePanel');
    expect(stderr).toContain('localRef');
    expect(stderr).toContain('mousedown');
  });

  it('refuse de juger si le nombre de fichiers est sous le plancher (< MIN_FICHIERS_LUS)', () => {
    const src = creerFixtureArbre({ avecBug: false, nbFichiers: 10 });
    const { code, stderr } = executerGarde(src);
    expect(code).toBe(1);
    expect(stderr).toContain(`Nombre de fichiers analysés insuffisant (10 < ${MIN_FICHIERS_LUS})`);
  });

  it('valide l’arbre réel src/ du dépôt (0 violation)', () => {
    const srcReel = path.join(FRONTEND_DIR, 'src');
    const { code, stdout } = executerGarde(srcReel);
    expect(code).toBe(0);
    expect(stdout).toContain('Aucun composant à état partagé');
    expect(stdout).toMatch(/\d+ fichiers analysés/);
  });
});
