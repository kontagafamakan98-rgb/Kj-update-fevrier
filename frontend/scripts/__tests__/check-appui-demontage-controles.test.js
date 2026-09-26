/**
 * Tests du garde-fou « appui → démontage » : détection des contrôles interactifs
 * qu'un changement d'état déclenché pendant l'appui (`onMouseDown`,
 * `onPointerDown`, `onTouchStart`) démonte avant que le `click` n'arrive
 * (autre moitié de la classe de bug du panneau de notifications).
 *
 * Deux niveaux, comme les autres gardes du dépôt :
 *
 *   1. la RÈGLE (`scripts/appui-demontage-controles.js`) :
 *      - Détecte le contrôle pressé qui écrit un état gouvernant son propre rendu
 *      - Détecte le cas imbriqué (gestionnaire d'appui sur un ancêtre)
 *      - Détecte le retour anticipé (`if (!ouvert) return null`)
 *      - Accepte un appui qui écrit un état non lié au rendu du contrôle
 *      - Accepte un appui qui appelle une prop (ConfirmModal : `onCancel?.()`)
 *      - Ignore un contrôle sans gestionnaire d'appui
 *
 *   2. le GARDE (`scripts/check-appui-demontage-controles.js`) exécuté en
 *      sous-processus sur des arborescences de fixture :
 *      - Sort 0 sur une fixture propre au-dessus des deux planchers
 *      - Sort 1 et nomme le fichier, le contrôle, l'événement et l'état sur une fixture buguée
 *      - Refuse de juger si les fichiers OU les contrôles sont sous le plancher
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
  compterControlesInteractifs,
  MIN_FICHIERS_LUS,
  MIN_CONTROLES_ANALYSES,
} from '../appui-demontage-controles.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-appui-demontage-controles.js');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
});

const FICHIER_SAIN = (i) => `
  import React, { useState } from 'react';
  export default function Composant${i}() {
    const [compteur, setCompteur] = useState(0);
    return (
      <div>
        <button onClick={() => setCompteur((c) => c + 1)}>A${i}</button>
        <a href="#a${i}">B${i}</a>
        <button onClick={() => setCompteur((c) => c + 1)}>C${i}</button>
        <select onChange={() => setCompteur(0)}>
          <option>D${i}</option>
        </select>
      </div>
    );
  }
`;

const FICHIER_BUGUE = `
  import React, { useState } from 'react';
  export default function PanneauAppui() {
    const [ouvert, setOuvert] = useState(false);
    const action = () => {};
    return (
      <div>
        <button onMouseDown={() => setOuvert(true)} onClick={action}>Ouvrir</button>
        {ouvert && (
          <div>
            <button onMouseDown={() => setOuvert(false)} onClick={action}>Fermer</button>
          </div>
        )}
      </div>
    );
  }
`;

function creerFixtureArbre({ avecBug = false, nbFichiers = 32, nbControlesParFichier = 4 } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-test-appui-'));
  tempDirs.push(racine);
  const src = path.join(racine, 'src');
  fs.mkdirSync(src, { recursive: true });

  for (let i = 0; i < nbFichiers; i += 1) {
    const code = nbControlesParFichier === 4
      ? FICHIER_SAIN(i)
      : `
        import React, { useState } from 'react';
        export default function Vide${i}() {
          const [x, setX] = useState(0);
          return <p onClick={() => setX(x + 1)}>{x}</p>;
        }
      `;
    fs.writeFileSync(path.join(src, `Composant${i}.js`), code, 'utf8');
  }

  if (avecBug) {
    fs.writeFileSync(path.join(src, 'PanneauAppui.js'), FICHIER_BUGUE, 'utf8');
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

describe('Règle statique : analyserCodeComposant (appui → démontage)', () => {
  it('détecte le contrôle dont l’appui écrit l’état qui conditionne son propre rendu', () => {
    const code = `
      import React, { useState } from 'react';
      export default function Panneau() {
        const [ouvert, setOuvert] = useState(false);
        const fermer = () => setOuvert(false);
        return (
          <div>
            {ouvert && (
              <button onMouseDown={() => setOuvert(false)} onClick={fermer}>Fermer</button>
            )}
          </div>
        );
      }
    `;

    const { violations } = analyserCodeComposant(code, 'Panneau.js');
    expect(violations.length).toBe(1);
    expect(violations[0].evenement).toBe('onMouseDown');
    expect(violations[0].etat).toBe('ouvert');
    expect(violations[0].message).toContain('démonté PENDANT l');
    expect(violations[0].message).toContain("'click'");
  });

  it('détecte le gestionnaire d’appui porté par un ancêtre (bouillonnement)', () => {
    const code = `
      import React, { useState } from 'react';
      export default function Menu() {
        const [ouvert, setOuvert] = useState(true);
        return (
          <div>
            {ouvert && (
              <div onPointerDown={() => setOuvert(false)}>
                <button onClick={() => {}}>Action</button>
              </div>
            )}
          </div>
        );
      }
    `;

    const { violations } = analyserCodeComposant(code, 'Menu.js');
    expect(violations.length).toBe(1);
    expect(violations[0].evenement).toBe('onPointerDown');
    expect(violations[0].controle).toBe('<button>');
  });

  it('détecte le retour anticipé du composant (`if (!ouvert) return null`)', () => {
    const code = `
      import React, { useState } from 'react';
      export default function Modale() {
        const [ouvert, setOuvert] = useState(true);
        if (!ouvert) return null;
        return (
          <button onTouchStart={() => setOuvert(false)} onClick={() => {}}>Confirmer</button>
        );
      }
    `;

    const { violations } = analyserCodeComposant(code, 'Modale.js');
    expect(violations.length).toBe(1);
    expect(violations[0].evenement).toBe('onTouchStart');
    expect(violations[0].etat).toBe('ouvert');
  });

  it('accepte un appui qui écrit un état NON lié au rendu du contrôle', () => {
    const code = `
      import React, { useState } from 'react';
      export default function Barre() {
        const [compteur, setCompteur] = useState(0);
        const [ouvert, setOuvert] = useState(false);
        return (
          <div>
            <button onMouseDown={() => setCompteur((c) => c + 1)} onClick={() => setOuvert(true)}>Plus</button>
            {ouvert && <div>Panneau</div>}
          </div>
        );
      }
    `;

    const { violations } = analyserCodeComposant(code, 'Barre.js');
    expect(violations).toEqual([]);
  });

  it('accepte le motif ConfirmModal : appui fermant via une prop (pas d’état local)', () => {
    const code = `
      import React, { useState } from 'react';
      export default function ConfirmModal({ open, onCancel, onConfirm }) {
        const [loading, setLoading] = useState(false);
        if (!open) return null;
        return (
          <div onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onCancel?.(); }}>
            <button onClick={onCancel}>Annuler</button>
            <button onClick={() => { setLoading(true); onConfirm?.(); }}>Confirmer</button>
          </div>
        );
      }
    `;

    const { violations } = analyserCodeComposant(code, 'ConfirmModal.js');
    expect(violations).toEqual([]);
  });

  it('ignore un contrôle sans gestionnaire d’appui', () => {
    const code = `
      import React, { useState } from 'react';
      export default function Onglets() {
        const [actif, setActif] = useState('a');
        return (
          <div>
            {actif === 'a' && <button onClick={() => setActif('b')}>Suivant</button>}
          </div>
        );
      }
    `;

    const { violations } = analyserCodeComposant(code, 'Onglets.js');
    expect(violations).toEqual([]);
  });

  it('compte les contrôles interactifs indépendamment des violations', () => {
    const code = FICHIER_SAIN(0);
    expect(compterControlesInteractifs(code)).toBe(4);
  });
});

describe('Garde en sous-processus : scripts/check-appui-demontage-controles.js', () => {
  it('sort 0 sur une arborescence fixture propre au-dessus des planchers', () => {
    const src = creerFixtureArbre({ avecBug: false, nbFichiers: 32 });
    const { code, stdout } = executerGarde(src);
    expect(code).toBe(0);
    expect(stdout).toContain('Aucun contrôle interactif');
    expect(stdout).toContain('32 fichiers');
    expect(stdout).toMatch(/\d+ contrôles interactifs analysés/);
  });

  it('sort 1 et nomme le fichier, le contrôle, l’événement et l’état sur une fixture buguée', () => {
    const src = creerFixtureArbre({ avecBug: true, nbFichiers: 32 });
    const { code, stderr } = executerGarde(src);
    expect(code).toBe(1);
    expect(stderr).toContain('PanneauAppui.js');
    expect(stderr).toContain('onMouseDown');
    expect(stderr).toContain('ouvert');
  });

  it('refuse de juger si le nombre de fichiers est sous le plancher', () => {
    const src = creerFixtureArbre({ avecBug: false, nbFichiers: 10 });
    const { code, stderr } = executerGarde(src);
    expect(code).toBe(1);
    expect(stderr).toContain(`Nombre de fichiers analysés insuffisant (10 < ${MIN_FICHIERS_LUS})`);
  });

  it('refuse de juger si le nombre de contrôles analysés est sous le plancher', () => {
    const src = creerFixtureArbre({ avecBug: false, nbFichiers: 32, nbControlesParFichier: 1 });
    const { code, stderr } = executerGarde(src);
    expect(code).toBe(1);
    expect(stderr).toContain(`Nombre de contrôles interactifs analysés insuffisant (32 < ${MIN_CONTROLES_ANALYSES})`);
  });

  it('valide l’arbre réel src/ du dépôt (0 violation)', () => {
    const srcReel = path.join(FRONTEND_DIR, 'src');
    const { fichiersLus, controlesAnalyses } = analyserDossierSource(srcReel);
    expect(fichiersLus).toBeGreaterThanOrEqual(MIN_FICHIERS_LUS);
    expect(controlesAnalyses).toBeGreaterThanOrEqual(MIN_CONTROLES_ANALYSES);

    const { code, stdout } = executerGarde(srcReel);
    expect(code).toBe(0);
    expect(stdout).toContain('Aucun contrôle interactif');
  });
});
