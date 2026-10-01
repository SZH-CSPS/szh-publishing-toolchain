# Dossier amont des correctifs WeasyPrint

Pour chaque correctif de `image/patches/weasyprint-70.0/`, ce qu'en sait l'amont
(Kozea/WeasyPrint), une démo avant/après et un texte prêt pour une issue ou une PR.
**Rien n'est publié chez WeasyPrint** : c'est à Robin de décider, et de reformuler.

## La règle de Robin

- On ne patche WeasyPrint **qu'en dernier recours**, après avoir épuisé le CSS, le HTML
  produit par la chaîne et la configuration, et **seulement après validation de Robin**.
- **Un fichier de patch par fonctionnalité**, dans `image/patches/weasyprint-<version>/`,
  posé par `image/patch-weasyprint.sh`.
- À chaque montée de version, chaque patch est rejugé : l'amont l'a-t-il intégré, le code
  a-t-il bougé ? Ce dossier sert à ce jugement.

## Les quatre correctifs (état au 01.10.2026, WeasyPrint 70.0, `main` 369b1534)

| Patch | Défaut | Statut amont | Recommandation |
|---|---|---|---|
| [10-tableaux-images](10-tableaux-images/RAPPORT.md) | A. `/Headers` vides ou faux sous un `th` en `colspan`/`rowspan`. B. `<img alt="" role="presentation">` en `/Figure` sans `/Alt` (UA-1 7.5-1, 7.3-1). | A : aucune issue ; code introduit en août 2026 (#2881), test sans `th` fusionné ; liZe invite à signaler (#2508). B : #2550 ouverte, « Yes, that would be useful », sans suite. `main` inchangé. | A : issue, code sur demande ; garder puis retirer. B : commentaire sur #2550 ; garder. |
| [20-cesure-fin-de-ligne](20-cesure-fin-de-ligne/RAPPORT.md) | Trait de césure copié comme un vrai caractère ; espace de fin de ligne absente de la couche texte. veraPDF ne voit rien. | Trait : « It's not in WeasyPrint, but it would be useful » (#2132), aucune issue. Espace : refus de principe (#1635, #2715 « We won't try to please them all »). `main` inchangé. | Trait : issue, code sur demande ; garder. Espace : garder sans proposer, rejuger à chaque montée. |
| [30-marges-artefact](30-marges-artefact/RAPPORT.md) | En-têtes, pieds et folios en MCID rattachés à rien, au lieu d'artefacts de pagination. veraPDF ne le voit que si une marge a une opacité. | #1836 ouverte depuis 2023 ; liZe croit l'artefact réservé à PDF 2.0 (confusion élément de structure / contenu marqué) et dit « no way to do this easily ». `main` inchangé. | Commentaire sur #1836 avec l'approche, code sur demande ; garder. |
| [40-xmp-dc-language](40-xmp-dc-language/RAPPORT.md) | `dc:language` absent du XMP ; `--xmp-metadata` n'ajoute qu'un second `rdf:RDF`, ignoré par pypdf. | Aucune issue ; `--xmp-metadata` pensé pour Factur-X (#2338, #2658) ; précédent accepté pour `dc:description` (#2681). `main` inchangé. | Issue qui offre la PR (diff prêt) ; garder, puis retirer. Pas encore posé dans la WSL : reconstruire l'image. |

Deux patchs, 10 et 20, mêlent chacun deux fonctionnalités : la règle demanderait de les
scinder. Non fait ici.

## Les canevas de contribution de WeasyPrint

Le dépôt n'a ni modèle d'issue ni modèle de PR (`.github/` : `CONTRIBUTING.md`,
`FUNDING.yml`, `workflows/`), et pas de Discussions. `CONTRIBUTING.md` renvoie aux
[Guidelines for Contributors](https://www.courtbouillon.org/code-of-conduct/#guidelines-for-contributors)
de CourtBouillon :

> Use your own words, write with your keyboard. Stay short: a few lines are often enough.
> Don't use long chapters with titles. Don't open a pull request if you have another pull
> request opened on our projects. Report real bugs you have in real life. Attach a short
> sample that shows the bug. Ask before sending code. Open an issue or write a comment and
> wait for more information.

« Issues and pull requests that don't follow these rules may be closed with no further
discussion. » D'où des textes courts, sans intertitres, qui demandent avant d'envoyer du
code, et deux commentaires sur des issues existantes (#2550, #1836) plutôt que des
doublons. **Chaque `ISSUE.md` est à réécrire par Robin avec ses mots avant de poster** ;
une PR à la fois. La doc « contribute » du site (`docs/contribute.rst`) ajoute : tests
pytest (Ghostscript et polices DejaVu requis), style vérifié par `ruff check`.

## Les démos

Chaque `<nn>-<nom>/demo/demo.sh` se lance dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/<nn>-<nom>/demo/demo.sh
```

`demo-commun.sh` copie `/opt/weasyprint` deux fois dans un dossier temporaire : « nu »
(les correctifs listés dans `szh-patchs.txt` retirés par `patch -R`) et « patché » (nu plus
le seul correctif démontré, posé par `image/patch-weasyprint.sh`). `/opt` n'est jamais
modifié. Les preuves viennent de veraPDF `--flavour ua1` et d'`inspecter.py` (pypdf) :
arbre de structure, MCID orphelins, marques `/Artifact`, flux, texte extrait, XMP.
veraPDF ne teste que l'automatisable : aucune démo ne dit qu'un lecteur d'écran lit mieux,
ce point reste non vérifié.
