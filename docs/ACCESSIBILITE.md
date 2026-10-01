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
- Pas de `<svg>` ni de bloc dans un `<a>`.
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

Défauts connus, mesurés le 30.09.2026 sur les PDF du banc. veraPDF UA-1 passe malgré eux :
ses règles ne les voient pas, ce qui ne les rend pas moins réels.

- **`Caption` en frère de `Figure`.** WeasyPrint balise la légende d'une `<figure>` comme un
  élément `Caption` placé à côté de l'élément `Figure`, et non à l'intérieur : un lecteur
  d'écran ne relie pas la légende à son image. Le défaut est dans le baliseur de WeasyPrint,
  et ne se corrige que par un patch, que Robin n'a pas retenu. Voir l'issue amont
  [« Use better PDF tags for &lt;figure&gt; » (Kozea/WeasyPrint#2482)](https://github.com/Kozea/WeasyPrint/issues/2482).
- **Pas de `/Lang` d'élément.** WeasyPrint n'écrit `/Lang` que sur le catalogue du document.
  Un `Zusammenfassung` dans un article français porte bien `lang="de"` dans le HTML, mais le
  PDF n'en garde rien : un lecteur d'écran le lit avec une voix française. veraPDF passe,
  parce que sa règle se satisfait du `/Lang` du catalogue. À vérifier à chaque montée de
  WeasyPrint (voir [`MAINTENANCE.md`](MAINTENANCE.md#un-passage-en-langue-seconde-nest-pas-annoncé-comme-tel)).
- **Notes sans `/Note`.** Les notes de bas de page ne sont pas balisées en `/Note` ni reliées
  à leur appel par `/Reference`.
- **Listes sans `Lbl`.** Les puces et numéros sont posés par `list-style: none` et un
  `::before`, que le baliseur ne voit pas : les éléments de liste n'ont pas de `Lbl`.
  `::marker` le donnerait.
- **Lien enfant direct d'un flex.** Un `<a>` placé directement dans un conteneur
  `display: flex` ne reçoit pas d'annotation de lien dans le PDF.

Résolus, et à ne plus lister comme ouverts : les signets collés par `<br>` et `dc:language`
absent du XMP (ce dernier en attente de la prochaine image sur les postes, voir plus haut).
