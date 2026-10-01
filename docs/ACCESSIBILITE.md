# Accessibilité

Ce que la chaîne promet à un lecteur qui ne voit pas la page, comment elle le tient, et ce
qu'elle ne sait pas encore faire. Un PDF publié par les éditions est une promesse publique
d'accessibilité : la porte PDF/UA bloque l'export, jamais l'épreuve.

## Les normes visées

| Sortie | Norme |
|---|---|
| PDF (article, livre numérique, couverture d'écran) | PDF/UA-1, ISO 14289-1 |
| HTML (aperçu, sortie web du livre, EPUB) | WCAG 2.2 niveau AA, RGAA |
| Couleurs | contraste APCA pour le texte ; 3:1 (WCAG 1.4.11) pour les éléments non textuels |
| Livres FALC | règles du « facile à lire et à comprendre » : une phrase par ligne, fer à gauche, sans césure |

La couverture d'impression (PDF/X-4, CMJN) sort de la porte PDF/UA : c'est un fichier pour
l'imprimeur, contrôlé par `couverture.py` lui-même.

## Ce qui est en place

### La porte PDF/UA

- veraPDF `--flavour ua1` juge chaque PDF (`pipeline/verifier-ua.sh`), et
  `pipeline/rapport-ua.py` traduit son verdict pour la rédaction, en fr et en de. Trois codes
  de sortie : 0 conforme, 1 non conforme, 2 panne d'outillage, qui ne se lit jamais comme
  un succès.
- Elle tourne à trois endroits : au banc (`test/build-render.sh`), en CI (job `pdf-ua` de
  `ci.yml`), et en arrière-plan dans le cockpit après chaque compilation réussie
  (`lib/pdfua-hote.js`, badge « PDF/UA » de la barre d'état). Un PDF non conforme y compte
  comme bloquant.
- `make verifier-ua` est appelée par `docx` et `tout-exporter`, jamais par `all` : la
  rédaction peut toujours sortir l'épreuve d'un article imparfait.
- Le verdict se lit sur l'absence de FAIL, jamais sur la présence d'un PASS.

### Le balisage produit par la chaîne

- **Cascade WeasyPrint.** `define weasy_ua` tente PDF/UA-1, puis le balisé simple, puis le
  nu, et le dit par un constat quand le balisage tombe : un PDF qui perd ses balises ne passe
  jamais en silence.
- **Tableaux.** `szh-tableau-boite.lua` enveloppe chaque tableau dans une boîte qui ne se
  coupe pas : une `<caption>` coupée de sa table faisait tomber le balisage sans un mot.
  `szh-tabelle-scope.lua` pose `scope` sur les en-têtes (RGAA 5.7). Une description longue
  (`data-alt`) devient un `aria-describedby` vers un élément `.szh-description` masqué
  visuellement.
- **Images.** Une image décorative sort en `alt=""` ; un portrait d'auteur·e, décoratif, est
  un fond CSS et non un `<img>`, que WeasyPrint baliserait en `/Figure` sans alternative.
- **Exergue.** `szh-exergue.lua` la pose en `aria-hidden` dans le publié, puisqu'elle répète
  le texte ; l'aperçu la laisse entendre.
- **Liens sans texte.** Le QR est un `<a>` vide portant `aria-label`, le SVG passant en fond :
  un `<svg>` dans un `<a>` casse PDF/UA. L'icône ORCID suit le même patron.
- **Liens dans un flex.** Un `<a>` enfant direct d'un conteneur flex n'a pas d'annotation
  `/Link` sous WeasyPrint 70 : un `<span>` intermédiaire le porte, pour le DOI et la licence
  de la couverture (`szh-article.html`) et pour les entrées du sommaire FALC
  (`livre-assembler.py`).
- **Listes.** Les puces et numéros des articles sont des `::marker` (`print.css`), que
  WeasyPrint balise en `LI > Lbl + LBody`.
- **Langue.** Décidée une fois par `szh-contexte.lua`, posée sur `<html lang>` donc sur le
  `/Lang` du document, et sur chaque passage dans une autre langue. Les webviews du cockpit
  prennent la langue de l'interface.
- **Signets et titre.** Le signet d'un article lit le titre à plat (`data-signet`,
  `bookmark-label` dans `print.css`) : un titre coupé en escalier n'y colle plus ses mots, et
  `/Info /Title` reçoit le même titre.
- **Métadonnées XMP.** `dc:language` est écrit dans le XMP de WeasyPrint par le correctif
  `40-xmp-dc-language`. Il n'arrive sur les postes qu'avec la prochaine image WSL : d'ici là,
  les PDF des postes n'en portent pas, et le test qui le vérifie saute avec le motif
  « correctif WeasyPrint absent ».

### Les contrôles de saisie

- Le constat `figure-sans-alt` signale une image sans alternative ni légende ; un `alt=""`
  voulu n'est jamais signalé.
- Le bouton « Décrire les images » de la vue « Contrôles » mène au gestionnaire des médias.
- Sous chaque image et chaque tableau de l'aperçu, un encadré dit « ce qu'un lecteur d'écran
  reçoit » (`szh-apercu-lecteur-ecran.lua`).

### Couleurs

`test/apca-check.py` contrôle toute la palette (`pipeline/apca.py`, `couleurs.css`) et les
couleurs de `print.css`, paire par paire. Les couleurs de chapitre du livre sont choisies à au
moins 3:1 contre le blanc ; un QR sous 3:1 contre son fond lève `qr-contraste-insuffisant`.

### Le banc

- `test/accessibilite/` : un numéro à part, en fr et en de, avec tableaux sans en-tête,
  bibliographie à diacritiques polonais, turcs et serbes, sauts de niveau de titre et paire de
  traductions à la numérotation divergente ; sa porte PDF/UA doit rendre 0.
- `test/polices-check.py` refuse un PDF qui embarque une police absente de `pipeline/fonts/` :
  une police de repli rendait des caractères illisibles au copier-coller.
- `test/epub-check.py` contrôle la structure de l'EPUB, et `test/weasyprint-patch-check.py`
  ce que chaque correctif de WeasyPrint doit produire.

## Les règles de travail

- Toute correction se prouve par un HTML minimal avant et après, puis veraPDF, puis la
  comparaison au pixel du banc.
- veraPDF ne teste que l'automatisable. On ne dit jamais « accessible » sur la foi d'un
  PASS : ce qui touche la voix ou la navigation demande un vrai lecteur d'écran (NVDA), ou se
  dit « non vérifié ».
- Pas de `<svg>` ni de bloc dans un `<a>`, et pas d'`<a>` enfant direct d'un conteneur flex.
- Les puces et numéros de liste passent par `::marker`.
- Un lien a un texte visible ou un `aria-label` explicite.
- Une image a une alternative ou une légende, sauf si elle est décorative (`alt=""`
  volontaire).
- Un tableau a sa rangée d'en-tête en `<th scope>`.
- On ne casse pas l'ordre de lecture par du positionnement.
- La langue de chaque passage dans une autre langue est déclarée (`lang`), même si
  WeasyPrint ne la reporte pas encore dans le PDF.
- Les contrastes se vérifient par `apca-check.py`.
- Aucune information n'est portée par la seule couleur.
- On ne patche WeasyPrint qu'en dernier recours, après avoir épuisé le CSS, le HTML et la
  configuration, et seulement avec l'accord de Robin : un fichier par fonctionnalité dans
  `image/patches/weasyprint-<version>/`, et son dossier amont dans
  [`image/patches/amont/`](../image/patches/amont/README.md).

## Limites

Les défauts connus, format par format (PDF d'article, HTML, Word, livre), avec leur norme,
leur gravité, leur origine et leur statut, sont tenus dans
[`LIMITES-ACCESSIBILITE.md`](LIMITES-ACCESSIBILITE.md). veraPDF UA-1 passe malgré eux : ses
règles ne les voient pas, ce qui ne les rend pas moins réels.
