# Banc des correctifs WeasyPrint

Ce banc vérifie qu'aucun correctif de `image/patches/weasyprint-<version>/`, seul ou combiné
aux autres, ne casse ce qui marchait. Il rend une série de petits HTML avec plusieurs
piles de correctifs, compare les PDF obtenus et désigne le correctif responsable de chaque
changement.

`test/weasyprint-patch-check.py` vérifie l'autre moitié : que chaque correctif fait son
travail sur le WeasyPrint installé.

## Lancer

Dans la WSL `SZH-Publishing`, depuis la racine du dépôt :

```sh
python3 test/weasyprint-banc/banc.py --mode rapide
```

| Option | Effet |
|---|---|
| `--mode rapide` | production et pile complète, puis le retrait de chaque correctif nouveau ou modifié sur les cas qui changent (environ 25 s à 2,5 min) |
| `--mode complet` | en plus : WeasyPrint vierge, production plus chaque nouveau correctif, retrait de chaque correctif sur tous les cas (environ 6 min à froid) |
| `--paires` | retire les correctifs deux à deux quand aucun retrait seul n'explique un changement |
| `--cas c16,c2*` | ne rend que ces cas (préfixes ou motifs) |
| `--production <réf>` | prend les correctifs de la production dans cette référence git, ou dans une liste de numéros (`10,15,20`) |
| `--travail <dossier>` | dossier de travail, `tmp/banc/` par défaut |
| `--python <python>` | un venv WeasyPrint sans correctif, avec pypdf et pypdfium2, à la place de celui que crée le banc |

La production est la liste des correctifs de la dernière version publiée. Le banc la lit
par git dans `origin/main`, sinon dans le dernier tag, sinon dans `HEAD`. La pile complète
est faite des `.patch` du dossier local ; les `.patch.off` en sont exclus.

Le banc crée lui-même son venv dans `tmp/banc/venvs/`, avec les versions épinglées
d'`image/requirements.txt` et pypdfium2. Il le garde tant que ces versions ne changent pas.
Les piles, les PDF et les mesures sont gardés de la même façon.

Codes de sortie : 0 rien à signaler ; 1 une régression ou un invariant en échec hors des
limites admises ; 2 panne d'outillage (veraPDF absent, venv impossible à créer, correctif
qui ne s'applique plus).

## Lire le rapport

`tmp/banc/BANC.html` (ou `BANC.md`), dans cet ordre :

1. **Régressions** : un invariant tenu en production et cassé avec les nouveaux correctifs,
   et le correctif responsable.
2. **Autres invariants en échec** avec tous les correctifs, et le retrait qui les répare.
3. **Ce qui change** de la production à la pile complète, cas par cas, et quels
   correctifs en sont la cause.
4. **La matrice cas × correctif** : ce qui change quand on retire chaque correctif. Les
   lettres : E exception, V veraPDF, P pixels, A arbre de structure, T texte extrait,
   L liens, M métadonnées, J journal de WeasyPrint, I invariants, F flux de contenu.
5. **Les verdicts par pile**, les limites admises, puis le détail par cas : invariants en
   échec, pages dont les pixels changent, diff de l'arbre de structure.

Pour regarder un rendu de près :

```sh
python3 test/weasyprint-banc/voir.py toutes c16-li-en-ligne
python3 test/weasyprint-banc/voir.py toutes c16-li-en-ligne ua1 --diff toutes-85
```

## Ajouter un cas

Un cas est un HTML dans `cas/` et un bloc du même nom dans `cas/cas.toml`.

1. Écrire `cas/c28-mon-cas.html`. Chaque morceau de texte porte un jeton `Q01`, `Q02`… :
   le banc vérifie que chaque jeton se lit une fois et une seule dans le PDF, et dans quel
   ordre. La feuille `_commun.css` reprend en petit la maquette de Pronto. Pas de texte
   réel : du contenu inventé.
2. Ajouter son bloc à `cas/cas.toml` :

   ```toml
   [c28-mon-cas]
   titre = "Note dans une cellule d'en-tête et lien dans la note."
   ordres = [["Q01", "Q02", "Q03"]]
   langues = { Q03 = "de" }
   liens = { "https://exemple.org/a" = "Q04 le lien" }
   ```

3. Lancer `banc.py --cas c28`, lire le rapport, puis
   `node --test test/js/weasyprint-banc.test.js`, qui vérifie la forme du bloc.

Les invariants disponibles sont décrits en tête de `cas/cas.toml`.

## Déclarer une limite admise

Un défaut connu, qu'aucun correctif ne règle encore, se déclare dans `connus`, par variante :

```toml
connus = { ua1 = ["veraPDF", "arbre-element_vide"], tags = ["arbre-element_vide"] }
```

Le nom de l'invariant est celui du rapport. Une limite admise reste listée dans le rapport,
sans faire échouer le banc. Quand elle ne se produit plus, le rapport le dit : on la retire.
