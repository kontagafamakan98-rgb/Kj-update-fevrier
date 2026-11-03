## Ce que cette PR change

<!-- Une phrase. Ce qui est cassé ou manquant AUJOURD'HUI, et ce que la PR en fait. -->

## La mesure qui autorise le changement

<!-- Le dépôt ne juge pas une intention, il juge une mesure. Date, commande (ou
     run de production), valeur d'avant, valeur d'après. Si la PR ne change
     aucun comportement observable, écris-le et dis pourquoi elle est sûre. -->

- Mesuré le :
- Avant :
- Après :

## Les gardes qui tiennent ce changement

<!-- Trois cas possibles, et le troisième doit s'écrire plutôt que se taire. -->

- [ ] Un garde existant l'attrape déjà — lequel :
- [ ] Un garde nouveau, avec sa preuve d'échec rejouée (mutation dans
      `.github/scripts/guard-proofs.json`, `--only "<id>"` exécuté localement) :
- [ ] Aucun garde — pourquoi ce n'est pas un angle mort assumé :

## Ce que la PR ne fait pas

<!-- La limite DÉCLARÉE : ce qui reste non jugé, ou remis à une PR suivante.
     Une limite écrite vaut mieux qu'un lecteur qui croit la couverture totale. -->

## Vérifications lancées

<!-- Les commandes réellement exécutées et leur code de sortie. Une vérification
     qui n'a pas pu tourner se rapporte comme telle, jamais comme un vert. -->

- [ ] `cd backend && python -m pytest -q`
- [ ] `cd frontend && npm test`
- [ ] `cd frontend && npm run build`
- [ ] Gardes touchés : …

## Si la PR touche AGENTS.md

<!-- Une règle non évidente qui a un garde cite son garde. L'historique
     (mesures, incidents) va dans `git log -p -- AGENTS.md`, pas dans le
     paragraphe. -->
