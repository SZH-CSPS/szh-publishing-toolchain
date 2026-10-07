# Intérieur des livres « normaux » : points à trancher par Robin

Chantier : reproduire l'intérieur des livres de la collection dans Pronto, d'après deux
exemples (Hofer/Buholzer 2026, HfH-Reihe Band 41). Branche `livre-inhalt`. Les couvertures
sont traitées ailleurs.

Chaque point dit ce que j'ai fait en attendant, pour que le travail continue.

## Sources

1. **L'IDML Hofer n'est pas celui du PDF.** Le dossier `Hofer/Inhalt` contient le PDF de
   « Teil- und Reintegration als Einzelfall? » (2026), mais l'IDML de « Menschen mit
   Lernschwierigkeiten auf Partnersuche » (2024). L'IDML sert à nommer les styles et à lire
   les corps ; **le PDF fait foi** quand ils divergent (exemple : l'alinéa vaut 7 mm dans
   l'IDML et 4 mm dans le PDF).
2. **L'IDML HfH-41 est tronqué** (124 octets, une archive vide). Pour ce livre, seul le PDF
   a été mesuré.

Le superviseur (session 00) a confirmé les deux points : le PDF fait foi.

## Décisions de produit soumises au superviseur

Robin a délégué ces arbitrages au superviseur. Ils restent ici pour qu'il puisse les relire.

**Tranchés par le superviseur le 02.10.2026** :

- **A1. Le folio.** On garde « Seite X von Y », votre décision du 01.10. La clé
  `folio: seul` existe pour imprimer le numéro seul, comme dans les références, mais ce n'est
  pas le défaut.
- **A2.** La légende prend « : », et le crédit « (© X | source) » est gardé.
- **A3.** Par défaut, ni les chapitres ni les sections ne sont numérotés.
- **A4.** Ajout de l'Open Sans Condensed : faces « SZH Condensed » 400 et 700, de
  130 ko chacune.
- **A5.** Les parties se décrivent dans `buch.yaml`.

**À relire** : le folio par défaut ne ressemble pas aux deux livres de référence. Si vous
voulez la fidélité par défaut, il suffit d'écrire `folio: seul` dans le `buch.yaml` de
chaque livre.

**Pas de livre « normal » en production.** `54_Pronto` n'a ni `Books\` ni
`_Archive\Books\`, et aucun `buch.yaml` à quatre niveaux. J'ai lu seulement les noms de
dossiers. Le changement de maquette n'est donc pas une release majeure.

Les propositions d'origine suivent.

- **A1. Le folio.** Le 01.10, Robin a décidé « Seite X von Y » pour tous les livres. Les deux
  références impriment « X » seul. Ma recommandation : une clé `folio: seul | sur-total`, à
  `seul` par défaut en maquette normal, sans changement pour le FALC.
- **A2. La légende.** Pronto compose « Abbildung 1 — titre (© X | source) » ; le HfH-41
  « Abbildung 1: Titel (Quelle) ». Ma recommandation : le séparateur « : » en maquette normal,
  en gardant le crédit « (© X | source) ».
- **A3. La numérotation.** Aucune des deux références ne numérote ses intertitres. Le banc
  actuel numérote « 2.1 ». Ma recommandation : pas de numéro par défaut, la numérotation se
  pose par une clé.
- **A4. Le sommaire du HfH-41** est composé en Open Sans Condensed, et non en
  SemiCondensed. Ma recommandation : ajouter les deux graisses de Condensed (OFL), dont seul
  le sommaire hiérarchique se servira.
- **A5. Les parties** se décrivent dans `buch.yaml` (`parties:`), et non dans chaque fiche.

## Écarts aux références dus à vos décisions du 01.10

- **La dédicace n'a pas de folio.** Dans le Hofer, elle porte le folio « 5 ». Mais votre règle
  « premier folio au sommaire » le lui retire tant qu'elle précède le sommaire. Placée après
  le sommaire, elle le reprend. Pour suivre le Hofer, il faudrait assouplir la règle : à vous
  de dire s'il le faut.

## Ce qui reste ouvert après le commit 7682c0d (branche livre-inhalt)

- **Le cockpit ne connaît pas encore les nouvelles clés.** `mise-en-page:`, `parties:`,
  `pieces-fin:`, `dedicace:` et `impressum:` s'écrivent à la main dans `buch.yaml`, et le
  formulaire du livre les conserve sans les afficher. Les montrer dans le formulaire est un
  lot à part, à coordonner avec b8.
- **Le badge Creative Commons.** Le dépôt n'a aucun SVG CC, donc l'impressum n'en porte pas.
  Faut-il en ajouter un (logo officiel CC, libre de droits) ?
- **L'illustration de l'intercalaire** (Hofer p35) déborde des marges dans la référence. Chez
  nous, elle reste dans la justification de 115 mm, plafonnée et centrée.
- **Un titre de groupe peut rester seul en bas de page** dans la grille des portraits : avec
  une grille, WeasyPrint ne respecte pas `break-after`. On le contourne à la main par
  `::: {.szh-saut} :::`.
- **Images décoratives** (logos, illustration d'intercalaire) : elles sortent en fond CSS,
  parce qu'un `<img alt="">` est refusé en PDF/UA par WeasyPrint. Le format WebP n'y est plus
  accepté.
- **Le format français « (éd.) »** vient de `couverture.MENTION_EDITEURS`, la même table que
  la couverture : en changer la valeur la change aux deux endroits.

## Note de bas de page : deux défauts de WeasyPrint 70 (03.10.2026), patch à autoriser

Trouvés en comparant le Hofer page à page, puis reproduits sur un HTML minimal, sans aucune
CSS Pronto (scratchpad de la session : f1/min.html) : l'appel est en page 1, la note sort en
page 2 ET en page 3.

- **La note quitte la page de son appel.** Quand un paragraphe n'a encore qu'une ligne de
  moins que le minimum de lignes en bas de page (`orphans`) et que la suivante ne tient
  pas, WeasyPrint reporte les notes de la page au lieu de renvoyer le paragraphe à la page
  suivante. **La Revue est touchée** aussi, dans de rares cas : 1 longueur de texte sur 50
  essayées.
- **La note est imprimée deux fois.** Une note reportée est rejouée sur une autre page quand
  WeasyPrint recalcule la pagination. Il le fait pour les numéros de page du sommaire, donc
  pour **les livres seulement**.

Aucun réglage CSS ne corrige ces défauts : il faut un patch de WeasyPrint, ce qui demande
votre accord (CLAUDE.md §3). Je recommande deux patchs, un par défaut. Ils passeraient par
la release lourde, avec reconstruction de l'image.

## Comparaison page à page (03.10.2026)

Les fichiers `tmp/comparaisons/interieurs/hofer.pdf` et `hfh-band-41.pdf` mettent face à face
la référence et Pronto, sur 10 pages par livre, avec le texte réel. Chaque fichier donne ses
mesures avant/après et une synthèse. Les corrections sont sur la branche `livres-precision`
(commit 5c910a6), qui n'est pas encore fusionnée.

Points à trancher par vous :

- **Le patch WeasyPrint pour les notes de bas de page** (voir plus haut).
- **Le badge Creative Commons** dans l'impressum : son absence remonte l'impressum de
  12,5 mm.
- **Le corps du titre de la page de titre** : 19 pt dans le Hofer, 20 pt dans le HfH-41.
  Faut-il une clé ?
- **Des auteurs pour une partie** (HfH-41, partie IV) : Pronto ne sait pas en donner.

## Textes imprimés à faire relire

- **La mention des éditeurs sur le demi-titre et la page de titre** : « (Hrsg.) » en
  allemand, « (a cura di) » en italien. En français, j'ai mis « (éd.) » par défaut, mais
  « (dir.) » est aussi d'usage : à vous de choisir.
- **La phrase de responsabilité de l'impressum** (clé `impressum.responsabilite: oui`) :
  - de : « Die Verantwortung für den Inhalt der Texte liegt bei den jeweiligen
    Autor:innen. » (le Hofer écrit « …bei der jeweiligen Autorin/beim jeweiligen Autor ») ;
  - fr : « La responsabilité du contenu des textes incombe à leurs autrices et auteurs. » ;
  - it : « La responsabilità del contenuto dei testi spetta alle rispettive autrici e ai
    rispettivi autori. »

## Hors de la maquette commune : des blocs propres à un livre

Ces éléments ne reçoivent aucune clé. Ils passent par la surcharge CSS du livre
(`styles/livre.css`) et par une classe pandoc. Seul Robin peut dire s'ils doivent devenir des
réglages.

- Hofer : des sections en Bold 13 qui ouvrent toujours une page (« Beteiligte Personen »,
  « Prozessbeschreibung »…).
- Hofer : la boîte « Aufteilung der Gespräche », sur un aplat dont la teinte change à chaque
  portrait. Une teinte par chapitre demanderait une clé `couleur` dans la fiche de chapitre.
- Hofer : les dialogues d'entretien, avec le locuteur à x 24 et la réplique suspendue à x 42.
- Hofer : la figure « Zeitlicher Ablauf », seule sur sa page, sur un fond K 5 % entre deux
  filets, et dont la légende, placée dessous, est en Open Sans non condensé 9 pt.
- HfH-41 : les blocs « Hypothese », ouverts par une flèche « → » avec un retrait suspendu de
  4 mm.
- HfH-41 : des tableaux à tête bleu clair, tantôt zébrés, tantôt à filets bleus. J'ai retenu
  le zèbre, le plus fréquent.

## Incohérences des références, que je ne reproduis pas

- HfH-41, pages 254 à 264 : le bloc de texte descend d'une ligne (1re ligne de base à
  24,8 mm au lieu de 20).
- HfH-41 : la partie V s'ouvre sur un verso, précédée d'un recto blanc, à l'inverse de la
  règle suivie partout ailleurs.
- HfH-41 : les deuxièmes lignes des titres de chapitre partent tantôt à 27 mm, tantôt à 20 mm.
  Je retiens 27 mm (retrait suspendu), le cas majoritaire.
- Hofer : certaines URL de bibliographie sont composées en Open Sans Condensed.
- Hofer : l'introduction d'un portrait commence à 48,6 mm, sauf à la page 131 (39,0 mm).
- Hofer : les notices d'auteurs ne sont pas dans l'ordre alphabétique. Je les laisse dans
  l'ordre où le fichier les écrit.

## Limites assumées

- WeasyPrint n'a pas de grille de ligne de base. Après une citation ou des notes en petit
  corps, le texte ne revient pas sur la grille comme dans InDesign. L'écart sera mesuré et
  donné.
- Les coupures de ligne et de mot ne seront jamais celles d'InDesign. La fidélité se juge sur
  les positions, les corps, les graisses, les retraits, les espaces et la pagination.
- Tout livre normal déjà compilé change : folio, marges, nombre de pages, donc aussi le dos de
  la couverture. Selon CLAUDE.md §9, c'est une release majeure.

## Approximations de la grille, mesurées sur le banc

- **L'espace sous le titre de chapitre.** InDesign cale le texte sur la grille, et cet espace
  varie avec le nombre de lignes du titre (Hofer, texte à 43,8, 53,3 ou 62,9 mm). En CSS,
  l'espace est fixe : il est juste pour un titre d'une ligne. Sous un titre de 2 lignes, le
  texte remonte d'environ 2 mm ; sous 3 lignes, d'environ 4 mm.
- **Le sommaire du Hofer** liste les sections des portraits, mais pas celles de
  l'introduction. Pronto ne peut pas faire ce choix chapitre par chapitre, parce que le
  cockpit réécrit les fiches et y effacerait une clé de plus. Une seule clé,
  `sommaire-niveaux`, vaut donc pour tout le livre.
- **Bug de WeasyPrint 70.** Un `::marker { content: "…" }` fait planter la compilation
  quand une liste se trouve dans un bloc en `position: absolute` (la description longue d'un
  tableau). Je n'ai pas fait de patch : la puce passe par `list-style-type`.

## Mesures faites pour trancher

- WeasyPrint 70 remet à zéro le compteur `footnote` sur un `counter-reset: footnote` posé
  sur la section du chapitre (HTML minimal : notes 1, 2, puis 1 au chapitre suivant). Les
  notes repartent donc à 1 par chapitre en CSS, sans toucher `szh-notes.lua`.
