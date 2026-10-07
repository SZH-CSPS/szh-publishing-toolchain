# Écrire la documentation

Cette page dit comment on écrit la documentation de Pronto : les fichiers de `docs/`, les
`README` du dépôt et les commentaires du code. Elle vaut pour les humains comme pour les
agents.

## Pour qui on écrit

Deux lecteurs, qui ne connaissent pas l'auteur du code :

- **la personne qui maintient les postes** : elle installe, met à jour, dépanne. Elle lit
  [`MAINTENANCE.md`](MAINTENANCE.md) ;
- **la personne qui reprend le développement** : elle doit comprendre le dépôt et le modifier
  sans casser. Elle lit [`ARCHITECTURE.md`](ARCHITECTURE.md), puis
  [`DEVELOPPEMENT.md`](DEVELOPPEMENT.md), puis le document du sujet.

La documentation des rédactions est ailleurs ([`../userdoc.md`](../userdoc.md)).

Tout est en français.

## Les règles

1. **Dire ce qui est.** On décrit ce que fait le code aujourd'hui, et comment s'en servir.
2. **Pas d'historique.** Ni l'ancien comportement, ni le bug d'avant, ni le récit d'un
   chantier. C'est le rôle de `git log` et de [`../CHANGELOG.md`](../CHANGELOG.md).
3. **Pas de provenance.** Pas de « décision de Robin du 22.09.2026 », pas de « la rédaction a
   accepté ». Si une règle existe, on l'énonce.
4. **Dire en positif.** « La langue vient du produit du numéro », et non « la langue ne se lit
   plus dans le document ». On ne liste pas ce que le code ne fait pas, sauf si quelqu'un
   risque vraiment de le supposer.
5. **Pas d'insistance.** Pas de MAJUSCULES pour appuyer, peu de gras (un terme défini, un
   avertissement réel), pas de formules du type « jamais, nulle part ».
6. **Des mots simples.** Un terme technique se définit la première fois, ou se remplace par
   un mot courant. On évite le jargon maison (socle, porte, couture, jeton, geste, constat…)
   quand un mot ordinaire suffit ; s'il est nécessaire, il est défini dans
   [`ARCHITECTURE.md`](ARCHITECTURE.md#vocabulaire).
7. **Phrases courtes.** Une idée par phrase. Une énumération longue devient une liste.
8. **Un fait, un endroit.** On ne recopie pas une explication : on met un lien.
9. **Montrer.** Une commande exacte, un chemin exact, un exemple valent mieux qu'une
   description.

## Les trois sortes de pages

- **Un guide** répond à « comment je fais X ? ». Il commence par le but, puis donne les étapes
  numérotées, avec les commandes à copier, puis ce qu'on doit voir quand ça a marché.
- **Une référence** répond à « qu'est-ce que c'est ? ». Elle commence par un paragraphe qui
  situe le sujet, puis des tableaux ou des listes.
- **Un dépannage** répond à « ça ne marche pas ». Une entrée par symptôme : ce qu'on voit, la
  cause probable, ce qu'on fait.

Ce qui reste à faire va dans [`A-FAIRE.md`](A-FAIRE.md), une ligne ou un court paragraphe
par tâche. On retire la ligne quand c'est fait.

## Les commentaires du code

Un commentaire dit ce que fait un bloc et, si ce n'est pas évident, pourquoi il le fait ainsi
(une contrainte technique, un piège réel). Le reste se lit dans le code.

- En tête de fichier : à quoi sert le fichier, en une à trois lignes.
- Au-dessus d'une fonction : ce qu'elle rend, et ses cas particuliers.
- Pas de renvoi aux paragraphes d'un document (« §4 du contrat ») : on nomme le document s'il
  le faut.
- Pas de commentaire qui répète le nom de la fonction ou la ligne de code.

## Exemples

Commentaire de code, avant :

```python
# La langue d'un article ne se lit PLUS dans le document (décision de Robin, 22.09.2026 : le
# champ « Langue de l'article » a quitté le tableau des métadonnées du gabarit) : elle vient du
# PRODUIT du numéro, comme partout ailleurs dans la chaîne — Revue suisse de pédagogie
# spécialisée -> fr, Schweizerische Zeitschrift für Heilpädagogik -> de. Même règle et mêmes
# jetons que derive_revue() de szh-maquette.lua et langue_de() de szh-rubrique.lua : […]
```

Après :

```python
# Langue d'un article selon le produit du numéro : Revue → fr, Zeitschrift → de.
```

Commentaire de code, avant :

```js
// Le rapport de la dernière conversion, écrit par la cible `import` du Makefile.
//
// Les lignes « [import-avertissement] » ne passent pas par ici : elles portent un code
// stable et deux langues, et lib/journal.js sait déjà en faire une phrase. Sans cette
// dérivation, la règle « toute ligne contenant ⚠ est un échec » ci-dessous les laissait
// filer en « converti » et affichait la ligne brute, deux langues comprises, comme titre
// de carte.
```

Après :

```js
// Lit le rapport écrit par la cible `import` du Makefile. Les lignes
// « [import-avertissement] » sont mises en phrase par lib/journal.js.
```

Documentation, avant :

> **Passe 1 — les exclusions**, avant toute heuristique. Ne peuvent jamais devenir un titre
> par déduction : […] Aucune ne pondère quoi que ce soit : pas de score, pas de coefficient.

Après :

> **Étape 1 : écarter.** Certains paragraphes ne peuvent pas devenir des titres : […]

## Vérifier avant de livrer

- les liens relatifs pointent vers des fichiers qui existent ;
- relire la page comme quelqu'un qui découvre le dépôt : chaque terme est-il compris,
  chaque étape faisable ?
- un changement de commentaire ne touche pas au code : le diff ne montre que des lignes de
  commentaire.
