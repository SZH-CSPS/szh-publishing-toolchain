# Correctifs WeasyPrint : dossiers pour l'amont

Pronto applique des correctifs à WeasyPrint ([`../weasyprint-70.0/`](../weasyprint-70.0/)).
Ce dossier contient, pour chacun, de quoi le juger et le proposer au projet WeasyPrint
(Kozea/WeasyPrint) :

- `RAPPORT.md` : le défaut, ce qu'en dit l'amont (issues, état de `main`), la conduite à tenir ;
- `ISSUE.md` : un brouillon d'issue ou de commentaire ;
- `demo/` : des HTML minimaux et `demo.sh`, qui montre le PDF avant et après le correctif.

Rien n'est publié chez WeasyPrint sans l'accord du mainteneur de Pronto. Les règles pour
écrire un correctif (dernier recours, un fichier par fonctionnalité, `--fuzz=0`) sont dans
le [`CLAUDE.md`](../../../CLAUDE.md) du dépôt. À chaque montée de WeasyPrint, chaque correctif
est rejugé avec ces dossiers : l'amont l'a-t-il intégré, le code a-t-il bougé ?

## Les correctifs

| Dossier | Défaut corrigé | Conduite à tenir |
|---|---|---|
| [10-tableaux-entetes](10-tableaux-entetes/RAPPORT.md) | `/Headers` vides ou faux sous un `th` fusionné (`colspan`, `rowspan`) | issue, code sur demande |
| [15-images-decoratives](15-images-decoratives/RAPPORT.md) | `<img alt="" role="presentation">` balisée `/Figure` sans `/Alt` | commentaire sur l'issue #2550 |
| [20-cesure-trait](20-cesure-trait/RAPPORT.md) | le trait de césure est copié comme un vrai caractère | issue, code sur demande |
| [25-espace-fin-de-ligne](25-espace-fin-de-ligne/RAPPORT.md) | l'espace de fin de ligne manque dans la couche texte | garder sans proposer : l'amont refuse ce genre de changement |
| [30-marges-artefact](30-marges-artefact/RAPPORT.md) | en-têtes, pieds et folios ne sont pas marqués comme artefacts de pagination | commentaire sur l'issue #1836 |
| [40-xmp-dc-language](40-xmp-dc-language/RAPPORT.md) | `dc:language` absent des métadonnées XMP | issue qui propose la PR |
| [50-notes-doublon](50-notes-doublon/RAPPORT.md) | une note reportée est imprimée deux fois quand un `target-counter` fait repaginer (livres) | issue qui propose la PR |
| [55-notes-reportees](55-notes-reportees/RAPPORT.md) | une note est repoussée à la page suivante, loin de son appel | issue qui propose la PR |
| [sans-patch-lien-flex](sans-patch-lien-flex/RAPPORT.md) | un `<a>` enfant direct d'un conteneur flex perd son annotation `/Link` | pas de correctif : Pronto insère un `<span>` intermédiaire ; issue #2941 déjà ouverte |

Le 25 s'applique seul mais n'a d'effet qu'avec le 20 : le dessin de l'espace de fin de ligne
est dans le 20, car il lit les variables du trait de césure dans `draw_first_line`.

## Proposer à WeasyPrint

WeasyPrint n'a pas de modèle d'issue ni de PR. Son `CONTRIBUTING.md` renvoie aux
[règles de CourtBouillon](https://www.courtbouillon.org/code-of-conduct/#guidelines-for-contributors) :
des textes courts, écrits soi-même, sans intertitres ; un exemple minimal ; demander avant
d'envoyer du code ; une seule PR ouverte à la fois. Une demande qui ne les suit pas peut être
fermée sans discussion.

Chaque `ISSUE.md` est donc un brouillon, à réécrire avec ses propres mots avant de le poster.
On commente une issue existante plutôt que d'en ouvrir une seconde. Une PR doit passer les
tests pytest de WeasyPrint (Ghostscript et polices DejaVu requis) et `ruff check`.

## Lancer une démo

Dans la WSL, depuis l'outil PowerShell :

```powershell
wsl.exe -d SZH-Publishing -- bash /mnt/c/<chemin du dépôt>/image/patches/amont/<dossier>/demo/demo.sh
```

[`demo-commun.sh`](demo-commun.sh) copie `/opt/weasyprint` deux fois dans un dossier
temporaire, sans toucher à `/opt` :

- **nu** : les correctifs posés (liste `szh-patchs.txt`) sont retirés par `patch -R` ;
- **patché** : le nu, plus le seul correctif démontré, posé par `image/patch-weasyprint.sh`.

Un correctif qui ne marche qu'avec un autre (le 25 avec le 20) reçoit cet autre sur les deux
copies. La démo rend chaque HTML avec les deux copies, puis compare :

- veraPDF `--flavour ua1` : le verdict se lit sur l'absence de règle en échec ;
- [`inspecter.py`](inspecter.py) (pypdf) : arbre de structure, MCID orphelins, marques
  `/Artifact`, flux de contenu, texte extrait, XMP.

veraPDF ne teste que ce qui s'automatise. Ce qu'un lecteur d'écran lit réellement reste
non vérifié par ces démos.
