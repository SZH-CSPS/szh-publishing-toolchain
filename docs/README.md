# La documentation

Par où commencer : [`ARCHITECTURE.md`](ARCHITECTURE.md), puis le document du sujet qu'on
touche. La documentation des rédactions est [`../userdoc.md`](../userdoc.md), lue aussi par le
cockpit.

## Architecture

| Document | Ce qu'il décrit |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | les trois mondes, le schéma, ce qui est commun et distinct entre revue, Zeitschrift et livre, puis chaque couche et ses modules |
| [`ARCHITECTURE-LIVRES.md`](ARCHITECTURE-LIVRES.md) | le moteur livre : dossier, `buch.yaml`, assemblage par fragments, sorties, CMJN, EPUB, maquettes normale et FALC |
| [`ARCHITECTURE-nettoyeur-manuscrit.md`](ARCHITECTURE-nettoyeur-manuscrit.md) | le contrat du nettoyeur de manuscrit, cité paragraphe par paragraphe par le code et les tests |
| [`SORTIES.md`](SORTIES.md) | ce que produit une compilation, le contrat de balisage du HTML publié et la pile de feuilles de style |
| [`EMPLACEMENTS.md`](EMPLACEMENTS.md) | où vivent les publications : les deux racines, l'arborescence, `_Systeme\`, la bascule test/production et la reprise |
| [`FORMAT-DOCUMENTATION-KIRBY.md`](FORMAT-DOCUMENTATION-KIRBY.md) | le format de la bibliothèque de fiches de la Documentation, partagé avec le site Kirby |
| [`FORMAT-PROPOSITIONS.md`](FORMAT-PROPOSITIONS.md) | le contrat des moissonneurs : lots de propositions, codes de doute, décisions, `etat.json`, `estimer` et `tout`, purge |
| [`RAPPORTS-ERREUR.md`](RAPPORTS-ERREUR.md) | les rapports d'erreur automatiques : schéma, masquage, plafonds, codes, compteurs d'usage |
| [`TRADUCTION.md`](TRADUCTION.md) | le vérificateur de traduction et le mode « Trad » : des suggestions, jamais une édition |
| [`ACCESSIBILITE.md`](ACCESSIBILITE.md) | les normes visées, ce qui est en place et les règles de travail |
| [`LIMITES-ACCESSIBILITE.md`](LIMITES-ACCESSIBILITE.md) | les limites d'accessibilité connues, format par format : norme, gravité, origine, statut |
| [`MULTIPLATEFORME.md`](MULTIPLATEFORME.md) | ce qu'il faudrait refaire, morceau par morceau, pour tourner sous Linux et macOS |

## Travailler sur le dépôt et le parc

| Document | Ce qu'il décrit |
|---|---|
| [`DEVELOPPEMENT.md`](DEVELOPPEMENT.md) | les environnements (tout Python dans la WSL), les tests et la suite exigeante, le banc et ses empreintes, l'instance de dev, la publication d'une version, les pièges |
| [`MAINTENANCE.md`](MAINTENANCE.md) | le guide d'exploitation : installer, régler, surveiller et réparer un poste, symptôme par symptôme, désinstaller |
| [`SECURITE.md`](SECURITE.md) | le modèle de confiance du déploiement et la liste à vérifier avec le prestataire |

## Typographie

| Document | Ce qu'il décrit |
|---|---|
| [`TYPOGRAPHIE.md`](TYPOGRAPHIE.md) | les règles maison et les mesures qui les fondent ; contrôlé par `test/typo-check.py` |
| [`TYPOGRAPHIE-FR.md`](TYPOGRAPHIE-FR.md), [`TYPOGRAPHIE-DE.md`](TYPOGRAPHIE-DE.md) | ce que la chaîne corrige toute seule, pour chaque rédaction et dans sa langue |
| [`palette.html`](palette.html) | la planche de la palette annuelle, régénérée par `test/palette-html.py` |

## Suivi

| Document | Ce qu'il décrit |
|---|---|
| [`TODO/`](TODO/) | ce qui reste à faire, un fichier par chantier |
| [`JOURNAL-LOTS-2026.md`](JOURNAL-LOTS-2026.md) | archive des lots de 2026, laissée telle quelle |

## Ailleurs dans le dépôt

| Document | Ce qu'il décrit |
|---|---|
| [`../test/README.md`](../test/README.md) | le banc d'essai, ses corpus et ses contrôles |
| [`../vscodium-extension/szh-cockpit/README.md`](../vscodium-extension/szh-cockpit/README.md) | chaque module du cockpit en une ligne |
| [`../vscodium-extension/szh-apercu/README.md`](../vscodium-extension/szh-apercu/README.md) | l'extension d'aperçu PDF |
| [`../vscodium-extension/szh-cockpit/mail-templates/README.md`](../vscodium-extension/szh-cockpit/mail-templates/README.md), [`../windows/mail-templates/README.md`](../windows/mail-templates/README.md) | les gabarits de courriel du cockpit et du lanceur |
| [`../windows/APPS.md`](../windows/APPS.md), [`../windows/VSIX.md`](../windows/VSIX.md) | les applications et les extensions épinglées |
| [`../image/patches/amont/README.md`](../image/patches/amont/README.md) | les correctifs de WeasyPrint et ce qu'en sait l'amont |
| [`../pipeline/fonts/README.md`](../pipeline/fonts/README.md) | les polices empaquetées |
| [`../pipeline/vale/LISEZMOI.md`](../pipeline/vale/LISEZMOI.md) | les règles Vale du nettoyeur, pour la rédaction |
| [`../kirby/LISEZMOI.md`](../kirby/LISEZMOI.md) | les blueprints Kirby générés |
| [`../test/composition/LISEZMOI.md`](../test/composition/LISEZMOI.md) | le corpus de composition |
