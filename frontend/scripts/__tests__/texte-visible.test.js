/**
 * La LECTURE PARTAGÉE du texte visible d'un fragment HTML.
 *
 * `scripts/texte-visible.js` n'avait pas de test à lui : deux gardes
 * l'exécutaient (`check-home-shell.js` pour comparer le `<h1>` de l'accueil au
 * titre du dictionnaire, `vite-plugins/prerender/declared-body.js` pour refuser
 * une coquille qui ne porte pas ce que sa page déclare), et ce qu'il fait
 * EXACTEMENT n'était donc mesuré qu'indirectement — par des cas qui parlent
 * d'autre chose.
 *
 * Pourquoi les cas ci-dessous sont ceux-là : la raison d'être de ce lecteur est
 * un défaut MESURÉ le 27/09/2026. Le refus de corps déclaré cherchait la chaîne
 * BRUTE dans le HTML, donc un titre dont une moitié est en italique
 * (`<br><em>`) faisait échouer le build en accusant la coquille de ne pas
 * publier un texte qu'un lecteur voyait entièrement. Les deux gardes partagent
 * désormais cette lecture ; si elle se met à retirer autre chose que des
 * balises, les deux s'aveuglent ENSEMBLE — c'est ce qu'un cas direct doit
 * empêcher.
 */
import { describe, expect, it } from 'vitest';
import { texteVisible } from '../texte-visible.js';

describe('texte-visible — ce que la lecture retire, et ce qu’elle garde', () => {
  it('retire les balises et rend le texte d’un seul tenant', () => {
    // Le cas du défaut : le titre du héros, coupé en deux par un `<br>` et un
    // `<em>`, se lit ENTIER — c'est ce qu'un visiteur voit.
    expect(texteVisible('<h1 class="a">Bonjour<br><em>à tous</em></h1>')).toBe('Bonjour à tous');
  });

  it('retire les scripts, les styles et les commentaires', () => {
    expect(texteVisible('<p>a</p><script>var x = 1</script><style>p{}</style><!-- <p>b</p> -->')).toBe(
      'a'
    );
  });

  it('ne garde pas le contenu d’un `<script>` pour du texte (même écrit sur une ligne)', () => {
    // Un `<script>` en ligne publie du JavaScript, pas de la copie : le
    // confondre ferait passer un mot du code pour un mot de la page.
    expect(texteVisible('<script>const titre = "Connexion";</script>')).toBe('');
  });

  it('réduit les blancs et les espaces insécables, et coupe les bords', () => {
    expect(texteVisible('\n  <p>Deux\n   mots&nbsp;collés</p> \n')).toBe('Deux mots collés');
  });

  it('ne tolère ni mot ajouté ni mot manquant (ce n’est pas une recherche approximative)', () => {
    // La lecture COMPARE des textes déclarés : elle ne doit pas rapprocher
    // deux textes différents, sinon le build accepterait une coquille qui
    // publie autre chose que sa page.
    const lu = texteVisible('<p>Envoyer le code</p>');
    expect(lu).toBe('Envoyer le code');
    expect(lu).not.toBe('Envoyer code');
    expect(lu).not.toBe('Envoyer le code ');
  });
});
