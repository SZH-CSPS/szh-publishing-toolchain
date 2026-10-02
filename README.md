# Pronto — la chaîne de publication de SZH/CSPS

Pronto fabrique les publications des éditions SZH/CSPS : la *Revue suisse de pédagogie
spécialisée*, la *Schweizerische Zeitschrift für Heilpädagogik* et les livres, dont les livres
en FALC. Il sert les rédactions, qui ne sont pas techniciennes : elles déposent des Word,
écrivent en Markdown, et reçoivent à chaque enregistrement un PDF mis en page et accessible
(PDF/UA-1), un aperçu cliquable, et les exports vers OJS et l'imprimeur.

Ce dépôt contient l'outillage, pas les publications : celles-ci vivent sur SharePoint.

## Comment c'est fait

- **VSCodium** est l'éditeur ; l'extension **szh-cockpit** y ajoute la barre « Pronto » :
  import, aperçu, métadonnées, médias, tableaux, contrôles, export, cycle de vie.
- L'entrée **« Pronto »** (PowerShell) ouvre VSCodium sur l'**Accueil** du cockpit, qui liste
  les numéros et les livres, en crée, et porte le nettoyeur de manuscrit et les exports du
  secrétariat.
- À chaque `Ctrl+S`, **make** lance dans une distribution **WSL** (`SZH-Publishing`) la chaîne
  **Pandoc → filtres Lua → WeasyPrint**, contrôlée par **veraPDF**.
- Un chapitre de livre se compile comme un article : revue, Zeitschrift et livre partagent la
  chaîne, le cockpit et le lanceur, et ne diffèrent que par des tables de profils.
- **GitHub Actions** construit le toolkit, les extensions et l'image WSL ; une tâche planifiée
  les déploie en silence sur les postes, sans administrateur, en ne téléchargeant que ce qui
  a changé.

## Où lire quoi

| Pour | Lire |
|---|---|
| comprendre le dépôt, couche par couche | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| tous les documents, en une ligne chacun | [`docs/README.md`](docs/README.md) |
| développer, tester, publier une version | [`docs/DEVELOPPEMENT.md`](docs/DEVELOPPEMENT.md) |
| installer, surveiller et réparer un poste | [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md) |
| le moteur livre | [`docs/ARCHITECTURE-LIVRES.md`](docs/ARCHITECTURE-LIVRES.md) |
| l'accessibilité et ses limites | [`docs/ACCESSIBILITE.md`](docs/ACCESSIBILITE.md) |
| les gestes de la rédaction | [`userdoc.md`](userdoc.md) |
| ce qui a changé, version par version | [`CHANGELOG.md`](CHANGELOG.md) |

## Numéroter une version

Les versions sont en `majeure.medium.mineure` : majeure si un numéro déjà compilé sortirait
différent, medium s'il faut le dire à quelqu'un, mineure sinon. La règle complète et la
procédure de publication sont dans
[`docs/DEVELOPPEMENT.md`](docs/DEVELOPPEMENT.md#publier-une-version).

## Arborescence

```
.github/workflows/   ci.yml (contrats, banc PDF/UA) et release.yml (publication)
image/               rootfs WSL : Containerfile, environnements Python figés, correctifs WeasyPrint
pipeline/            Makefile, filtres.mk, profils/livre.mk, filtres Lua, Python, styles, gabarits
vscodium-extension/  szh-cockpit (la barre « Pronto ») et szh-apercu (aperçu PDF)
vscodium-user/       réglages, raccourcis, tâches et extraits posés dans VSCodium
windows/             lanceur, installation, mise à jour, diagnostic, désinstallation
revue-template/      gabarit d'un numéro neuf
livre-template/      gabarit d'un livre neuf
kirby/               blueprints Kirby de la Documentation
test/                banc d'essai, contrôles et contrats (voir test/README.md)
outils-dev/          outils du poste de développement
docs/                la documentation
```
