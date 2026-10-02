# Journal des versions

Les versions sont en `majeure.medium.mineure` depuis la `1.0.0` (18 septembre 2026). La règle
de numérotation, avec ses exemples, est dans le [README](README.md#numéroter-une-version) :

- **majeure** — un numéro déjà compilé sortirait différent ;
- **medium** — il faut le dire à quelqu'un ;
- **mineure** — ni l'un ni l'autre, et c'est le cas le plus fréquent.

Avant la `1.0.0`, les versions étaient en `année.mois.compteur` (`v2026.06.1` à `v2026.09.42`,
113 étiquettes). Elles ne sont pas reprises ici : leur histoire est dans les messages de tag
(`git tag -l --format='%(contents)' 'v2026.*'`) et dans les Releases GitHub.

## 3.2.1

Mineure : une copie en conflit OneDrive se tranche en un clic.

**Production.**
- Copies en conflit : après « Comparer les deux versions », un message propose « Garder ma
  version » (la copie est supprimée) ou « Prendre celle de la copie » (elle remplace le
  fichier, annulable au Ctrl+Z, puis disparaît), chacun avec sa confirmation. La résolution
  passage par passage, dans la marge du fichier, reste possible.

## 3.2.0

Medium : « Pronto » s'ouvre dans l'éditeur, sur l'Accueil du cockpit, et le lanceur WinForms
est retiré.

**Production.**
- Préprocessing : chaque nettoyage écrit dans un dossier neuf des exports de Pronto,
  `Exports\Préprocessing\<nom du manuscrit>` (puis `(2)`, `(3)`…), avec une copie du
  manuscrit, le document nettoyé et son rapport ; l'original n'est plus touché. Un manuscrit
  se glisse aussi sur la zone de l'onglet, Maj maintenue, 50 Mo au plus.
- « Pronto » ouvre VSCodium sur l'Accueil : Produits, Nouveau, Préprocessing, Secrétariat,
  Paramètres, Log. Les tâches de démarrage du poste passent avant (ancrage, rapports en
  attente, check-in, épinglage, dossiers de test, secrets) ; un lien `szh://` ouvre son
  numéro. Pronto prend le bouton de VSCodium dans la barre des tâches, et rien ne se rouvre
  au démarrage (`window.restoreWindows` : `none`).
- Le lanceur WinForms est retiré, avec son code (≈ 4 200 lignes de PowerShell). Seul
  « Changer de version… » reste une fenêtre Windows (`open-revue.ps1 -Versions`). Un cockpit
  absent ou trop ancien pour l'Accueil donne un message et un rapport `ACCUEIL-COCKPIT-ABSENT`.
- L'Accueil ouvre le document nettoyé, le rapport du nettoyeur et les dossiers d'export ou de
  journaux avec l'application du système, chemins accentués compris.
- Une seule page de réglages : l'onglet Paramètres de l'Accueil. « Ouvrir les réglages » y
  mène, même sans produit ouvert ; l'ancien panneau des réglages est retiré. Les clés Shlink et
  OJS passent au coffre de VSCodium (`context.secrets`), transmises à la chaîne par `WSLENV`
  (`lib/services-env.js`).
- Les exports vont dans `Exports\<export>`, qui remplace « Secrétariat und Export » dans
  l'arbre. L'export Edudoc ne garde que les mots-clés du thésaurus, et son historique, partagé entre
  les postes dans `_Systeme\exports`, retient les numéros déjà exportés. Textes du secrétariat réécrits en fr et de.
- Newsletter : un fichier par rubrique, dans l'ordre de la newsletter (0-intro à
  5-documentation), au balisage des modèles Mailchimp, avec les liens DOI. La Documentation
  pointe vers sa page OJS par une adresse que l'export OJS fixe désormais
  (`lib/ojs-adresses.js`). À la première importation, ouvrir l'adresse du numéro et celle de
  la Documentation pour vérifier qu'OJS les a reprises.
- Le verdict d'un journal de mise à jour est reconnu quelle que soit la langue de Windows
  (il valait « inconnu » hors de l'anglais).
- Le dossier des journaux se nettoie : dix mises à jour et trois mois au plus.
- Le fichier de langue exporté porte enfin les titres de commandes (ils étaient cherchés
  au mauvais endroit et la table restait vide).

**DEV seulement.**
- « Pronto (dev) » ouvre l'Accueil par le même chemin que « Pronto » ; `SZH_JOURNAUX_MAJ` lui
  fait lire les journaux du poste.
- En simulation (`SZH_LANCEUR_SIMULE=1`), le check-in n'écrit que sous un ancrage d'essai
  (`SZH_ANCRAGE`) et l'arbre de test que sous `SZH_RACINE_TEST` : un test ne peut plus écrire
  dans le vrai dossier partagé.
- Cockpit 0.74.0.

## 3.1.0

Medium : rien ne change à l'écran ni dans les PDF, mais le poste se prépare à passer un jour
sous Linux. Release lourde : l'en-tête d'un patch WeasyPrint a changé, l'image WSL est
reconstruite (contenu identique).

- Les chemins propres à Windows vivent dans `lib/poste.js`, et tous les lancements de la WSL
  passent par `lib/moteur.js` (étape 1 de `docs/MULTIPLATEFORME.md`). Commandes inchangées
  à l'octet, figées par un test.
- Les compteurs d'usage n'ont plus qu'un écrivain, le cockpit : `szh-compteurs.ps1` disparaît
  (≈ 350 lignes de PowerShell). Sans VSCodium, un compteur du nettoyeur est perdu.
- Le cockpit accepte les liens `vscodium://szh-csps.szh-cockpit/…` à côté de `szh://` ; un
  lien refusé le dit. Rien n'émet encore ces liens.
- Documentation : les architectures envisagées au-delà du poste (navigateur, serveur,
  options A à F) dans `docs/MULTIPLATEFORME.md`.
- Cockpit 0.73.0.

## 3.0.0

Majeure : un numéro ou un livre déjà compilé ressort différent (appels de note, point médian
des auteurs, exergue et tableaux des livres). Release lourde : l'image WSL est reconstruite.

**Livres.**
- Couverture d'impression en PDF/X-4 CMJN FOGRA52, avec le dos calculé.
- Folios « page X sur Y ».
- Titre et auteurs de chaque chapitre dans sa fiche.
- Saut forcé « // » dans les titres.
- Aperçu PDF d'un chapitre seul.
- L'exergue et la mise en forme des tableaux, comme dans la revue.
- Les couleurs de l'EPUB sont enfin définies.

**Accessibilité des PDF.**
- Listes balisées (puces et numéros reconnus), à position inchangée.
- Liens DOI, licence et sommaire FALC de nouveau cliquables.
- Description longue des tableaux dans l'arbre de structure.
- Signets et titre du document sans mots collés.
- Langue dans les métadonnées XMP.
- Un passage dans une autre langue suit la typographie de sa langue.
- Limites restantes : `docs/LIMITES-ACCESSIBILITE.md`.

**Nettoyeur et import.**
- Messages et annotations en allemand pour la Zeitschrift.
- Le texte des tableaux du Word est contrôlé à l'import.
- Un fichier endommagé est refusé net.
- Les gabarits Pronto portent une clé cachée qui les fait reconnaître à coup sûr.
- Le lecteur .odt disparaît : un .odt est converti avant lecture.
- Un encadré reste reconnu même si le nom de son style a été retouché (« szh-Important »).

**Cockpit.**
- Un livre ne montre que ce qui le concerne, avec son vocabulaire (« chapitre », « livre »).
- La barre d'état compte aussi les refus d'export.
- Le lanceur : onglets dans un ordre fixe, « Journal » devient « Log ».

**Sous le capot.** Architecture refaite sans changer le comportement (cockpit 0.72.0) :
- `extension.js` passe de 8 133 à 3 844 lignes et ne fait plus que câbler des modules ;
- la langue d'un document est décidée une seule fois ;
- les chaînes de filtres et la compilation PDF ne sont écrites qu'à un endroit ;
- tout Python tourne dans la WSL ;
- les patchs de WeasyPrint sont un par fonctionnalité, avec un dossier amont ;
- la documentation est réécrite, et `CLAUDE.md` ajouté.

## 2.8.0

**Journal du nettoyeur réduit à l'essentiel.** L'onglet Preprocessing n'affiche plus que le
manuscrit traité, le résultat, le rapport et le compte des alertes ; un refus tient en une
phrase, et un fichier déjà nettoyé (`-nettoye`, ou révisions signées par le nettoyeur) est
reconnu comme tel. La progression et les constats d'import partent dans le rapport. Le
`-rapport.json` ne reste plus à côté du manuscrit : le lanceur l'écrit dans un temporaire,
rend le HTML puis le supprime.

**Plantages du nettoyeur signalés.** Un try global rend un objet assaini (type, fichier:ligne
du dépôt, étape, jamais le message de l'exception) et le code de sortie 4. Le lanceur écrit
un rapport d'erreur `NETTOYEUR-ECHEC` pour un plantage, un code inattendu, une lecture
impossible, une perte de contenu, un rendu HTML en échec ou une WSL pas prête ; jamais pour
un refus attendu.

**Compteurs d'usage, sans texte.** Chaque passage du nettoyeur et chaque Word converti par
l'import écrivent un petit CSV dans `_Systeme\compteurs` du SharePoint (un fichier par
événement, entiers seulement, date sans heure, `prod` ou `dev`), jamais de nom de fichier, de
titre ou de nom d'auteur. Hors ligne, ils attendent sur le poste. `outils/compteurs-synthese.js`
les dépouille (page HTML et CSV, règles à examiner en tête) et purge au-delà de 24 mois sur
demande. Documentation : `docs/RAPPORTS-ERREUR.md`, « Les compteurs ne sont pas des rapports ».

## 2.7.0

**ROR et ORCID dans le nettoyeur.** Pour un manuscrit hors gabarit (cas B), le nettoyeur
cherche le ROR de l'institution de chaque autrice et auteur (`api.ror.org`, seul le résultat
`chosen` est retenu) et son ORCID (`pub.orcid.org`, nom identique ET institution
concordante, un seul candidat). Les valeurs trouvées sont écrites dans la fiche en révision
suivie, auteur « Recherche ROR/ORCID — à vérifier » (DE « ROR/ORCID-Suche — bitte prüfen »),
et chacune a sa ligne au rapport. Un homonyme sans institution confirmée n'est jamais écrit :
`Identifiants.OrcidCandidat` au rapport. Un ORCID du manuscrit est contrôlé (clé, nom), jamais
remplacé. Seuls nom, prénom et institution partent sur le réseau ; `--sans-reseau` coupe tout.
Nouveau module `pipeline/manuscrit_identifiants.py`.

**Bibliographie : références coupées, noms composés, textes de loi.** Les paragraphes qui
prolongent une référence (copier-coller depuis un PDF) sont réunis avant le croisement :
sur un manuscrit réel, trois « référence non vérifiée » et neuf fausses alertes d'ordre
disparaissent. Les noms composés (« Sahli Lozano et al. (2021) », « (Sahli Lozano & Crameri,
2021) ») s'apparient. Une référence sans année entre parenthèses (texte de loi) donne un
commentaire à vérifier au lieu d'une erreur « citation absente ».

**Recherches en ligne en panne.** Sans connexion ou avec un service muet, le nettoyage se
fait quand même : chaque service (Crossref, ROR, ORCID) n'est tenté qu'une fois par manuscrit
puis laissé de côté (13 s au lieu de 37 s mesurés sur un manuscrit de 16 références), et
l'avertissement `Reseau.RechercheImpossible` dit au rapport ce qui n'a pas été vérifié.

**Plus de terminal à l'échec.** Les tâches passent de `reveal: silent` à `reveal: never` :
`silent` ouvrait le terminal dès qu'une compilation échouait, par-dessus la notification.

## 2.6.1

**Note des figures et des tableaux.** Une nouvelle clé « Note : » (DE « Notiz: ») dans
les blocs figure et tableau du gabarit Pronto, lue par le parser, écrite par le nettoyeur et
éditable dans le cockpit (formulaire Médias, éditeur de tableau). Elle est stockée en
`note="…"` sur l'image (la première d'un groupe) et en `data-note` sur le `<table>`, et
s'imprime sous la figure ou le tableau, précédée de *Note* ou *Notiz* en italique. En HTML,
c'est un `<p class="szh-bloc-note">` dans la `<figure>` ou juste après le `</table>`, relié par
`aria-describedby` ; PDF/UA reste conforme, la note est un /P frère de la /Figure. Le
nettoyeur reprend dans cette clé le paragraphe « Note : » ou « Note. » (APA) qui suit
immédiatement un tableau ou une figure.

**Crédit devient Copyright.** La clé visible du gabarit FR s'appelle « Copyright : » ;
« Crédit » reste lu sans avertissement dans les documents déjà remplis. Les modèles FR et
DE du dépôt et ceux du partage des autrices sont à jour.

**Crédits entre parenthèses.** La légende sort en `Figure N — Titre (© X | source)`, sans
étiquette « Source : » ; le `©` n'est ajouté que s'il manque, un `(c)` tapé devient `©`.
Sous une image sans légende, le crédit sort sans parenthèses, collé à l'image. Les figures,
leur légende et leur note s'alignent à gauche sur la marge.

**Typographie FR/DE du parser et du nettoyeur.** Le parser ne rabat plus les tirets ni les
insécables des valeurs (titre, légende, noms) ; le trait d'union insécable de Word
(`w:noBreakHyphen`) et `w:sym` ne disparaissent plus ; la langue d'un Word hérité vient du
produit ; les résumés, la note, le copyright et la source passent par `szh-typographie.lua`,
chaque résumé dans sa langue. Le nettoyeur normalise aussi les notes de bas de page, l'en-tête
et les intertitres, et ses messages suivent la typographie de leur langue.

Éditeur de tableau : « Définir comme en-tête intermédiaire » remplace « Définir comme titre
de section ».

## 2.6.0

Medium : le texte des PDF se copie et se lit enfin correctement ; à dire à la rédaction et à
qui tient l'index d'OJS.

**Correctifs WeasyPrint en trois patchs séparés.** `image/patches/weasyprint-70.0.patch`
devient le dossier `image/patches/weasyprint-70.0/`, un fichier par sujet, posés dans
l'ordre de leur nom. Un patch renommé en `.patch.off` est ignoré, et le journal de
`patch-weasyprint.sh` le dit. Le script fait une passe à blanc de tous les patchs sur une
copie du paquet avant d'en poser un seul, et écrit la liste des patchs posés dans
`weasyprint/szh-patchs.txt`, où `test/weasyprint-patch-check.py` la lit pour ne juger que
ceux-là. Les 8 combinaisons ont été éprouvées une à une sur un WeasyPrint vierge : chacune
se pose, s'importe, compile 4 articles réels au pixel près et passe veraPDF.

- `10-tableaux-images` : les en-têtes de tableau fusionnés et les images décoratives, sans
  changement.
- `20-cesure-fin-de-ligne` : le trait ajouté par la césure est entouré d'un `/ActualText`
  U+00AD (trait conditionnel), et une ligne coupée sur une espace garde cette espace dans la
  couche texte. Le copier-coller rendait « ensei-gnants » et « lamarche » : seules 5 fins de
  ligne sur 782 portaient leur espace, sur 4 articles. Le trait d'un vrai composé
  (« Hess-Klein ») reste un trait. poppler et xpdf ne recollent plus d'eux-mêmes un mot
  coupé en fin de ligne : un index plein texte qui passe par `pdftotext` (OJS) doit retirer
  « U+00AD + saut de ligne » avant d'indexer.
- `30-marges-artefact` : l'en-tête courant, le pied et le folio sortent en
  `/Artifact /Pagination` (Header, Footer). Ils étaient du contenu marqué rattaché à aucun
  élément de structure : 150 MCID orphelins sur 32 pages. Une boîte de marge qui porte un
  lien reste du contenu balisé, désormais rattaché à l'arbre. Répare aussi le 7.1-3 d'une
  boîte de marge à opacité réduite.

Rendu identique au pixel. Seule la couche texte et le balisage des PDF changent.

## 2.5.0

Medium : annonce à la rédaction les gabarits FR/DE et l'OpenDocument, livrés en 2.4.2.

**Bibliographie du nettoyeur.** Le DOI retrouvé part toujours en suivi de modifications. La
mise en forme APA, qui couvre toute la référence, le perdait en commentaire dès qu'une
révision plus sévère la chevauchait ou qu'elle touchait un lien : elle porte désormais un
repli, l'insertion du seul DOI en fin de référence, que `manuscrit_annoter.py` n'écrit que si
elle a perdu sa place. L'ancre est le plus court suffixe unique de la référence, point final
compris (`152–160. https://…`, et non plus `152–160 https://… .`). Le demi-cadratin n'est plus
rabattu en trait d'union à la lecture d'une référence ; en allemand, les pages d'un article
le prennent, comme dans le guide Zeitschrift (`27 (3), 56–78`).

**Éditeur.** Saut de page, insertion et collage de tableau, en-tête FALC et QR regardent les
lignes voisines, plus seulement celle du curseur : une ligne vide sépare toujours le bloc
`:::` d'un paragraphe (`insererBlocIsole`). Posé sur une ligne vide collée à un paragraphe,
le bloc s'y collait, et pandoc le lisait comme la suite du paragraphe.

**« À corriger ».** Les champs du gabarit laissés vides tiennent en une carte par article, un
lien par champ vers la fiche ou Médias, dans la langue de qui lit (le lecteur transmet aussi
le nom allemand, `clé-de`). Une carte par champ et par fiche d'auteur, sans le nom du champ,
toutes à la même empreinte (en fermer une les fermait toutes), et un bouton vers les Word en
attente où le document n'était plus.

**Mise à jour.** `update.ps1` écrit au journal pourquoi il n'a pas remplacé l'environnement
(éditeur ouvert ou compilation en cours).

## 2.4.3

**La colonne d'étiquettes d'un tableau n'est plus écrasée.** Un tableau dont la première
colonne porte des étiquettes courtes (« 1. Hilfe », « 2. Hilfe »…) à côté d'une colonne de
longues phrases réduisait cette colonne au minimum : « 1. » et « Hilfe » sur deux lignes,
« Punk-te » coupé dans l'en-tête. Trois changements :

- dans les cellules, un mot ne se coupe plus que s'il a 6 lettres au moins, avec 3 lettres de
  chaque côté de la coupure (`hyphenate-limit-chars: 6 3 3`) ; les longs mots composés restent
  coupables, sans quoi un tableau de 9 colonnes allemandes sortait de la page ;
- nouvelle règle typographique **E9** : un ordinal en tête de cellule reste soudé au mot qui
  suit (espace insécable) ; jamais dans le corps du texte ;
- les tableaux de l'éditeur ne coupent plus un mot sans trait d'union au milieu (« Pun|kte »).

À l'écran (aperçu, HTML exporté), un tableau trop large défile dans sa boîte au lieu
d'élargir la page. Mesuré sur 8 tableaux réels de la Revue et de la Zeitschrift : les autres
colonnes bougent de 3 px au plus. Un numéro déjà compilé qui contient un tableau à étiquettes
sortira un peu plus court à la recompilation ; version mineure assumée malgré tout.

## 2.4.2

**Un gabarit Pronto par langue.** `revue-template/` porte désormais `Pronto - modele
d'article_FR` (Revue) et `_DE` (Zeitschrift), en `.docx` et en `.odt` ; l'ancien gabarit unique
est retiré. Le lecteur du gabarit reconnaît les étiquettes allemandes (« Titel (DE) »,
« Vorname: », « Beschriftung: », « Copyright: »…) sans avertissement ; l'en-tête « Autor:in »
ne bloque plus l'import, et « Themenschwerpunkt » est un type d'article. Un commentaire posé dans
un `.odt` n'est plus lu comme une étiquette.

**Nettoyeur de manuscrit.** Il écrit dans le gabarit du produit (Zeitschrift -> gabarit
allemand, libellés allemands), résout les styles par leur nom (les gabarits V4 ont des
identifiants de style allemands), retire le commentaire d'aide du gabarit, et garde une
citation en citation au lieu de la rendre en corps de texte. Il accepte un `.odt` en entrée et
livre au choix un `.docx` ou un `.odt` (option `--format`, rangée « Format de sortie » du
lanceur).

**ODT dans l'import.** Un `.odt` déposé dans les Word en attente s'importe comme un `.docx` :
il est converti par LibreOffice au début de `import-docx.sh` (`pipeline/conversion_odt.py`),
et la fiche garde son nom d'origine. L'image WSL embarque désormais `libreoffice-writer-nogui` ;
le rootfs est reconstruit par cette release.

**La roue « Analyse en cours… » tourne sur tous les postes.** Quand Windows a coupé ses
animations (« Afficher les animations dans Windows »), Chromium signale le mouvement réduit et
la roue était remplacée par une pulsation invisible : elle passait pour figée. Elle tourne
désormais toujours, deux fois plus lentement en mouvement réduit.

## 2.4.0

**« À corriger » lisible et à jour.** Chaque message : un titre court, les objets en cause
cliquables, une phrase d'action, un bouton ; l'explication (cause, repère ISO) dans le bouton
(i). « N images sans description » en une seule carte, chaque nom ouvrant l'image dans Médias
ou dans l'éditeur de son tableau ; les défauts de tableau ouvrent l'éditeur du tableau ; une
case d'en-tête vide est signalée en ambre. Le résumé « N règle(s) ne sont pas respectées » ne
double plus les règles. Plus aucun constat sous un ancien slug après une renumérotation
(`.szh-pdfua.json` élagué). La flèche sélectionne vraiment le passage dans le `.md`. Un voile
« Analyse en cours… » grise les seules cartes de l'article qui recompile, Ctrl+S compris.

**Médias et tableaux.** Triangle rouge sur une image sans description (Médias et éditeur de
tableaux). L'éditeur de tableaux affiche les images des cellules et propose au clic droit
« Texte alternatif… », « Remplacer l'image… », « Insérer une image… ». Une correction faite
dans Médias ou dans l'éditeur de tableaux relance la compilation de l'article (anti-rebond,
jamais deux compilations à la fois).

**Édition.** « Insérer un lien » (Ctrl+Alt+K). « Insérer une figure » assainit le nom du
fichier (un espace cassait le Makefile).

**Import Word et nettoyeur.** Sous un en-tête de figure, plusieurs images (même paragraphe,
paragraphes consécutifs séparés d'au plus deux vides, ou tableau de mise en page d'images)
forment un groupe côte à côte (`szh-grille`) ; la légende, le texte alternatif et le crédit
ne disparaissent plus. `docx-controle-import.py` remet visible et signale toute valeur
d'en-tête ou image du Word absente de l'article. Nettoyeur : clés tapées à la main reconnues,
document déjà au gabarit respecté, fiche d'autrices en tableau, corps d'un manuscrit court
préservé, garde-fou de non-perte (alerte, refus au-delà de 50 %).

**Composition et PDF/UA.** Correctif WeasyPrint 70.0 appliqué à l'image (`image/patches/`) :
un en-tête fusionné est rattaché à toutes les cases qu'il couvre, l'attribut `headers` est
respecté, une image décorative (`alt=""` + `role="presentation"`) sort en artefact. Un lien
en italique ou en gras ne fait plus échouer 7.18.5-1. Deux images décoratives côte à côte
passent en décor à leur largeur. Gras-italique et vraies petites capitales en Open Sans.

**Tests.** La sonde bash du réimport passe par Python (sous Windows, Python et Node ne
trouvent pas le même bash) ; le contrôle Vale n'exige plus un corpus hors git.

## 2.3.2

**Les livres en cours aussi hors ligne.** L'épinglage du lancement couvre maintenant chaque
livre en cours de `Books\` (reconnu à son `buch.yaml`), comme les numéros des revues. Jamais
les archives.

## 2.3.1

**Hors ligne par défaut.** À chaque lancement, le lanceur marque « Toujours conserver sur cet
appareil » (OneDrive) les numéros en cours de `Revue\` et `Zeitschrift\` de la racine active,
et `_NewsUndActu\Fiches` et `_NewsUndActu\_Statuts` (production, et racine de test en mode
test) — seulement ceux qui ne le sont pas encore, en arrière-plan, jamais attendu
(`windows/szh-epinglage.ps1`). Désactivable par `"epinglageHorsLigne": false` dans
`config.json`. Mesuré sur un dossier OneDrive jetable : le dossier, son contenu et les fichiers
créés ensuite sont épinglés.

## 2.3.0

**Actualité : navigation par l'arbre.** La section ACTUALITÉ de l'arbre liste « Documentation
du numéro », « Traductions à faire », « Réservoir », « Archive » et « Publier sur le site web »
(grisée, à venir). Le formulaire n'a plus de barre de vues ; « Documentation du numéro » porte
une barre de catégories (Rubriques, puis un onglet par type de fiche, avec son compte) et
n'affiche qu'une catégorie à la fois. Chaque fiche a « Retirer du numéro » et « Supprimer ».
Libellé court propre au cockpit (`types[].libelleCourt` : « Agenda »). Bouton « Aperçu du PDF »
qui bascule l'aperçu de la Documentation.

**Onglet Archive.** Toute la bibliothèque de production (`54_Pronto\_NewsUndActu\Fiches`), lue
en lecture seule même en mode test : recherche, filtres type / revue / numéro / année,
aperçu, « Reprendre dans ce numéro » (fiche neuve reliée par le champ système `origine`),
édition annoncée (grisée). Import des fiches 2025 des deux revues (365 fiches, 11 numéros
d'archive minimaux).

**Contrat.** Livres : catégories essai et témoignage. Tour d'horizon : portée intercantonal.
Films : genre (neuf genres) et pays (ISO 3166-1), saisie `liste_multiple` (cases à cocher,
recherche à étiquettes), imprimés traduits dans la ligne sous le titre et en `multiselect`
dans Kirby.

**Corrections.** Un ancrage SharePoint détecté par le lanceur se mémorise dans
`etat-utilisateur.json` : le cockpit, qui ne sait pas le détecter, le retrouve (onglet
Archive, rapports d'erreur). Titre long de l'Archive qui repoussait les boutons.

## 2.2.1

**Un dossier par type dans la bibliothèque de fiches.** `_NewsUndActu\Fiches\` range les fiches
par type, sous un nom allemand en minuscules tiré du contrat (`types[].dossier`) : `rundschau`,
`forschung`, `vorstoesse`, `buecher`, `filme`, `revueblick`, `weiterbildung`. Un type se
sauvegarde, se migre ou se délègue d'un bloc, et chaque dossier devient une page parente du
site Kirby (blueprint généré, adresse en minuscules). Un sous-dossier inconnu est ignoré avec un
avertissement ; une fiche rangée sous le dossier d'un autre type est signalée, jamais lue.

**Tests.** Les numéros d'essai du cockpit vivent sous une racine jetable (`Revue\<num>`) : la
bibliothèque ne s'écrit plus dans le dossier temporaire commun du poste, où elle s'accumulait
d'un passage à l'autre.

## 2.2.0

**Actualité : une bibliothèque de fiches partagée, compatible Kirby.** Les fiches de la
Documentation vivent dans `_NewsUndActu\Fiches\<slug>\<type>.<langue>.txt` (format de contenu
Kirby, un fichier par langue : une traduction n'est pas une copie), rattachées au numéro par
`Ausgabe:` = l'`id` de son `ausgabe.yaml`, rangées par `Ordre:`. Un contrat unique
(`pipeline/kirby/champs-documentation.json`) pilote le formulaire, le convertisseur, les filtres
Lua et les blueprints Kirby générés (`kirby/`). Les rubriques restent dans le numéro. Format :
`docs/FORMAT-DOCUMENTATION-KIRBY.md` ; ce que le site devra reprendre : `TODO_KirbyCMS.md`.
Aucune rétrocompatibilité avec les blocs `:::` de l'ancien `documentation.md`.

**Réservoir et traductions.** Onglets « Traductions à faire » | « Réservoir » | « Documentation
du numéro ». Le réservoir liste ce que l'autre langue a publié (filtre par numéro, sélection
multiple, à traduire / ignorer, annuler la décision) et les orphelines (tirer dans ce numéro).
Statuts dans `_NewsUndActu\_Statuts\<langue>\<uuid>.txt`. La réserve et « Envoyer à l'autre
revue » des fiches disparaissent ; « Envoyer pour traduction » des articles reste.

**Arborescence 54_Pronto.** `Revue\`, `Zeitschrift\`, `Books\`, `_Archive\`, `_NewsUndActu\`,
`Secrétariat und Export\` et `_Systeme\`, identiques sous la racine de test et sous
`2_Produkte\54_Pronto`. Migration automatique à la mise à jour, racine de test OneDrive
seulement, sans jamais écraser (`windows/szh-migration.ps1`). `_Systeme\` (rapports, journaux,
suggestions, inventaire des postes) toujours sur SharePoint, même en mode test.

**Identifiant fixe et liens.** `id:` (16 caractères) dans `ausgabe.yaml` et `buch.yaml`, posé à
la création, à l'ouverture et par la migration, jamais recalculé. Les liens `szh://` portent
l'id et retrouvent le numéro en cours comme archivé.

## 2.1.0

**Livres FALC : un en-tête de chapitre « à écouter », écrit dans le texte.** Le bloc
`:::: falc-header` (texte, image facultative, `::: qr-link`) s'écrit dans le `.md` du chapitre
et s'imprime toujours sous le titre et les auteurs, quel que soit l'endroit où il est écrit. Il
remplace la clé `ecouter:` des fiches `.meta.yaml`, retirée. Le panneau Ctrl+Alt+S gagne un
groupe « Livre » (en-tête FALC, code QR), absent des revues. La ligne d'auteurs d'un chapitre
devient un bloc `.szh-auteurs` (l'import reconnaît le style Word « Auhors »), rapprochée du titre.

**QR codes vectoriels et cliquables.** `::: qr-link` et la forme courte `[texte](url){.qr}` :
encodeur Lua vendoré (speedata/luaqrcode, BSD-3), un `<a>` vide avec le SVG en fond — un SVG
dans un lien fait tomber PDF/UA. Options `tracked`, `background`, `color`, `size`, `title`. Avec
`tracked`, le lien passe par Shlink (`pipeline/liens-courts.py`, cache `liens-courts.yaml` du
livre), résolu en tête de compilation quand `SZH_SHLINK_URL` est posée.

**Maquette FALC.** Palette de chapitre au cran le plus clair qui tient 3:1 contre le blanc,
capucine au 700. Pastille numérotée sur chaque page, au coin extérieur (centre à 7,5 mm des deux
bords rognés) ; le picto play prend sa place quand le chapitre n'a pas de pastille. Marques de
tranche à 10 mm visibles, 5 mm du texte, débordant du fond perdu dans le PDF imprimeur ; les
fausses corrections de décalage dues au fond perdu sont retirées (`bleed` ne décale pas les
boîtes de marge). Folio sur la page d'ouverture. Clé `sommaire: non` (et case de la fiche du
chapitre) : hors table des matières, sans numéro, et la hauteur de l'index à pouce se partage
entre les chapitres restants, alignée sur les repères du sommaire.

**Lanceur : réglages Shlink et OJS.** Adresse et clé Shlink, clé OJS (pas encore lue), par
compte, clés chiffrées DPAPI, posées dans l'environnement de VSCodium et `WSLENV` au lancement.

**Un livre n'affiche plus ce qui n'est qu'aux revues.** L'ordre des chapitres s'écrit dans
`buch.yaml` (`ordre-chapitres`), plus jamais dans un `ausgabe.yaml` ; pas de `dois-calcules.yaml` ;
fiche de chapitre sans DOI calculé, type, licence ni mots-clés ; boutons d'envoi et de PDF
d'article, blocs OJS des réglages et tutoriel masqués. Rien ne change pour la Revue ni la
Zeitschrift.

Aussi dans cette version : la Documentation passe à une arborescence Kirby, la montée
WeasyPrint 70 / pandoc 3.7.0.2 de l'image, la pagination continue d'un numéro et l'export OJS
(commits antérieurs).

## 2.0.0

**Un numéro déjà compilé sort différent : une citation narrative devient un lien.** Jusqu'ici,
un appel écrit au fil du texte avec « et al. » — « Selon Capurso et al. (2025) » — n'était ni
lié, ni compté, ni signalé : la prose qui précède la parenthèse était coupée au dernier point,
et « al. » finit par un point. C'est la forme la plus courante dès trois auteurs, et l'en-tête
du filtre l'annonçait pourtant comme prise en charge. Ces appels reçoivent désormais leur lien
interne, et leur référence sa flèche de retour. Recompiler un numéro paru change donc son PDF.

**Une parenthèse de prose allemande n'est plus prise pour un appel.** « (mindestens fünf
Treffen pro Tandem zwischen Juli 2026 und Oktober 2027) » produisait deux « Verweis ohne
Eintrag ». En allemand tout nom commun est capitalisé, et le découpage des noms ne rognait
qu'à gauche : il s'arrêtait au premier mot capitalisé et en faisait un patronyme. Règle posée,
sans lexique ni comptage de mots — aucune heuristique ne sépare « Werte » de « Bovey » : quand
le millésime n'est pas précédé d'une virgule, l'appel n'existe que s'il s'apparie à une entrée
de la bibliographie. Le coût est assumé et écrit dans le code, un appel sans virgule dont la
référence manque vraiment n'est plus signalé.

**La flèche d'un message mène au passage fautif et le surligne.** Elle ouvrait le bon fichier,
curseur au début. Elle sélectionne maintenant le passage, le centre et le surligne trois
secondes. La recherche absorbe la normalisation que la compilation fait subir au texte —
insécables, tirets, espaces écrasées — et retrouve même un appel coupé par un retour à la
ligne ; introuvable, elle ne fait rien plutôt que de désigner un endroit faux.

**Dix-sept familles de messages reçoivent une destination.** Les trois contrôles
typographiques, les deux du méta-fichier, les huit de la scission d'un livre et quatre codes
de l'import s'affichaient avec un libellé générique et sans flèche. Les émetteurs disent
désormais OÙ : le filtre typographique joint le mot fautif, le convertisseur de tableaux un
extrait de la première cellule. Le cockpit ne peut pas désigner ce qu'on ne lui dit pas.

**Deux flèches menaient au mauvais endroit.** Le découpage au dernier séparateur de chemin
s'appliquait à tous les champs : une référence portant un DOI s'affichait « Référence jamais
citée : abc », et la flèche visait « abc ». Et le message d'un PDF verrouillé n'avait pas de
slug du tout — son bouton aurait ouvert le PDF de l'article actif, donc un autre que celui qui
est verrouillé.

**Un message ne pouvait plus jamais apparaître.** Le lecteur du journal cherchait une phrase
que le `Makefile` n'écrit plus depuis un moment : le constat du profil « book » sans
`buch.yaml` était devenu invisible, ni carte ni flèche. Un test de contrat relit le `Makefile`
pour que la dérive ne recommence pas en silence.

## 1.3.0

**Les métadonnées d'un bloc figure ou tableau ne vivent plus dans un tableau enveloppe.**
Décision de Robin du 21 septembre 2026 : dans le gabarit « Pronto — modèle d'article » (`.docx`
et `.odt`), une légende, un texte alternatif, un crédit et une source s'écrivent désormais dans
quatre paragraphes ordinaires — nouveau style « SZH Cle Abb/Tab », bordure ouverte au-dessus de
l'image ou du tableau — juste avant celui-ci, au lieu d'un tableau à deux rangées. C'est un
changement de forme dans le gabarit que la rédaction remplit à la main : d'où le medium.

- Le lecteur Pronto (`pipeline/pronto_modele.py`, pas encore branché sur la chaîne d'import)
  reconnaît la nouvelle forme (1 à 4 paragraphes de clé, image ou tableau à 1-2 paragraphes de
  distance) et l'ancienne en repli, avec un avertissement invitant à convertir.
- Le nettoyeur de manuscrit (`pipeline/manuscrit_gabarit.py`) écrit désormais la nouvelle forme ;
  les onze manuscrits réels et le manuscrit « coenseignement développemental » traversent la
  chaîne complète sans régression (aucun texte perdu, table de correspondance exacte).
- Des clés de figure sans image ni tableau à proximité sont désormais signalées, plutôt que de
  rester invisibles dans le corps.

**Annotation : des commentaires posés au bon endroit.** Une alerte sur le texte d'une note de
bas de page s'ancre sur le mot qui précède l'appel de note, avec « Note N : » et le passage cité,
et une correction déterministe s'écrit en révision dans la note elle-même. La table de
correspondance entre paragraphes d'entrée et de sortie comptait un bloc figure pour zéro
paragraphe : 76 % de ses entrées étaient fausses sur le corpus, et presque tout commentaire posé
après la première figure tombait sur le mauvais paragraphe ; elle est exacte désormais. Audit de
257 alertes sur douze manuscrits : les raffineurs Vale « et/und » et les citations du corps
portaient une position fausse, l'alerte de texte alternatif cherchait une phrase absente ; les
replis sur un paragraphe entier passent de 33 à 0, l'alerte de texte alternatif se posant sur la
clé « Texte alternatif : » de son bloc.

## 1.2.4

**Bibliographie : une seule révision par référence, et rien de perdu.** Un DOI retrouvé par
Crossref entre désormais dans la révision de remise en forme de sa référence au lieu de finir en
commentaire ; les éditeurs d'un ouvrage collectif liés par « et » ou « und » sont reconnus (ils
disparaissaient en silence) ; aucune révision qui perdrait un nom, une année ou un nombre de
l'original n'est plus jamais proposée ; marqueurs « In », « (Ed.) », « (Eds.) », « (Hrsg.) » et
« pp. »/« S. » conformes aux deux Redaktionsrichtlinien.

## 1.2.3

**Le lanceur ne prend plus un manuscrit nettoyé avec des points bloquants pour un échec.**
Le nettoyeur sort avec un code de sortie non nul dès qu'une alerte bloquante subsiste — mais le
`.docx` a bien été écrit, annoté, et le rapport existe. L'onglet Préprocessing traitait ce cas
comme un échec technique et affichait « Raison inconnue » à la place.

- Ce cas (alerte bloquante, pas un refus du nettoyeur) est désormais un succès : le message
  donne les trois nombres qui comptent (points à traiter, révisions et commentaires posés dans
  le document), et le rapport se rend et s'ouvre exactement comme pour un nettoyage sans alerte.
- Un vrai échec (document illisible, environnement absent…) affiche maintenant les dernières
  lignes utiles du journal au lieu de « Raison inconnue » — jamais un code de sortie.

**Bibliographie : des révisions ciblées et justes.** Une remise en forme APA 7 ne barre plus la
référence entière : seuls les segments qui changent partent en supprimé/inséré. Chaque référence
porte sa langue (un titre anglais garde « Title: Subtitle » sans espace, un titre français son
insécable), seul le volume passe en italique, et un DOI retrouvé par Crossref s'insère en fin de
référence en révision au lieu d'un commentaire. À sévérité égale, la révision la plus large gagne
sur un chevauchement — 19 remises en forme sur 19 sortent en révision sur un manuscrit réel, contre
15 avant. Plus aucun astérisque dans un commentaire, et le rapport dit ce que chaque alerte est
réellement devenue dans le document.

## 1.2.2

**Orthographe rectifiée et trait d'union des préfixes dans le nettoyeur.** La Revue écrit en
orthographe rectifiée (décision de la rédaction du 21 septembre 2026) : une graphie
traditionnelle trouvée dans un manuscrit part désormais en révision Word, acceptable d'un clic.

- Neuf catégories de règles Vale générées depuis `pipeline/vale/lexique/orthographe-rectifiee.csv`
  (185 paires sûres) ; « dû », « mûr », « sûr », « jeûne » et « croître » ne sont jamais touchés.
- Huit règles de trait d'union à lexique fermé, fondées sur la page Wikipédia « Emploi du trait
  d'union pour les préfixes en français » ; « sans- », « peut être » et « a priori » sont écartés.
- Mesuré sur 92 articles publiés : aucune règle ne touche plus de 5,4 % des documents.

## 1.2.1

**La release se publie sans tag posé à la main — mineure, outillage seul, rien qui se voit
en dehors du dépôt.** La 1.2.0 a demandé trois poses du tag : vert en local n'a jamais garanti
vert sur un runner GitHub, et la CI ne parlait qu'après la pose, quand la réparer coûtait
déjà un `git push --delete` puis un retag.

- **`test/js/porte-release.js` rejoue en local, avant tout push,** ce que `ci.yml` et
  `release.yml` vérifient après coup : YAML des deux workflows, typographie des textes
  visibles, bump des extensions modifiées depuis le dernier tag, section `CHANGELOG.md`
  (et `nouveautes.json` si le medium change), puis la suite complète — en simulant
  ubuntu-latest et windows-latest (`SZH_SIMULER_RUNNER`) pour juger un `--runner ubuntu` ou
  `--runner windows` comme CE runner-là le verrait, sans attendre un run distant.
- **Le tag est désormais posé par la CI, pas par un `git tag` humain** : `release.yml` se
  déclenche sur la fin d'un `ci` réussi sur `main` dont le commit de tête est
  `release: X.Y.Z résumé`, pose alors `vX.Y.Z`, et enchaîne la publication sans rejouer
  `ci.yml` une seconde fois. Un commit `release:` dont `ci` échoue ne pose aucun tag.
- **Un motif de saut a désormais une seule source vraie** : `test/js/motifs-saut.js`, importé
  à la fois par `test/js/gardes.js` (qui les écrit, via les assistants `sauter.corpus`,
  `sauter.wsl`, `sauter.pandoc`, `sauter.powershell`, `sauter.vale`, `sauter.vscodium`,
  `sauter.production`, `sauter.eleve`, `sauter.pliage`) et par `test/js/verifier-tap.js` (qui
  les relit). Une nouvelle famille `vale` distingue enfin l'absence de Vale de l'absence de la
  WSL, que les tests concernés empruntaient jusqu'ici pour passer la porte.
- **Un crochet `pre-push`** (`.githooks/pre-push`, activé par `git config core.hooksPath
  .githooks`) rejoue la partie rapide de cette porte avant d'autoriser un push, en moins de
  30 secondes.

## 1.2.0

**Le nettoyeur de manuscrit : un onglet « Préprocessing » dans le lanceur.** Un manuscrit
d'autrice arrive tel qu'il a été écrit ; l'outil rend un `.docx` au gabarit Pronto, plus un
rapport HTML, et il tourne à la réception, avant toute relecture humaine.

- **Le mécanique est appliqué tel quel** : styles du gabarit sur tout le corps, titres retrouvés
  d'après la mise en forme effective (un titre numéroté par une liste Word est reconnu, son
  numéro retiré), formatage manuel retiré (l'italique, l'exposant, l'indice et les liens restent),
  typographie de la maison par le filtre `szh-typographie.lua` déjà en service, notes de bas de
  page, images et tableaux replacés dans leurs blocs. Titre, sous-titre, résumé, mots-clés et
  fiches d'autrices et d'auteurs remplissent les deux tableaux du gabarit, y compris le bloc
  « Informations sur les autrices et auteurs » de fin de manuscrit.
- **Les lignes directrices deviennent des révisions et des commentaires Word**, sous un auteur
  dédié : les corrections textuelles déterministes en suivi de modifications (tout s'accepte d'un
  clic), les points de jugement en commentaires ancrés, plafonnés à vingt-cinq par document et
  cinq par règle, le reste dans le rapport.
- **Vale porte les règles lexicales**, en YAML éditables par la rédaction dans `pipeline/vale/`
  (langage épicène, vocabulaire du handicap, casse, « cf. », et/&, DOI…), tirées des deux
  Redaktionsrichtlinien 2025 et mesurées sur 288 articles publiés. Vale 3.22.0 entre dans l'image
  WSL comme binaire épinglé ; les règles structurelles (longueurs, niveaux de titre, alt,
  tableaux) restent en Python.
- **La bibliographie est vérifiée** : citations sans référence et références jamais citées,
  ordre alphabétique puis chronologique, suffixes a/b, DOI normalisés en `https://doi.org/`,
  cohérence par Crossref (seul le DOI ou la référence part sur le réseau), DOI manquant retrouvé
  et proposé en commentaire, remise en forme APA 7 proposée en révision quand la lecture est sûre.
- **Un lexique maison** tiré des articles publiés des deux dernières années :
  `pipeline/vale/lexique/*.csv` (source de vérité, éditable au tableur), exports Excel et TBX
  générés, règles Vale de cohérence et de sigles générées depuis le CSV.
- Le contrat du chantier est `outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md` ; l'état et le
  reste à faire dans `outils-dev/ETAT-REPRISE-2026-09-18.md`. Le corpus de mise au point
  (onze manuscrits réels, trente-quatre paragraphes truqués) n'est pas versionné.

## 1.1.0

**« Quoi de neuf » : les postes apprennent ce qui a changé.** Jusqu'ici, une mise à jour
arrivait sans un mot — `update.ps1` posait la nouvelle version pendant la nuit et personne
ne savait ce qu'elle apportait. Le cockpit propose désormais une fenêtre, à la première
ouverture d'un numéro qui suit une mise à jour.

- **Seul un changement de MEDIUM la déclenche.** Une mineure ne dit rien : à deux releases
  par jour, une fenêtre par correction ne serait plus lue au bout d'une semaine. Le medium
  est l'unité d'annonce du dépôt, et c'est ici qu'il sert.
- **Rien ne s'ouvre sans un clic.** Une invitation discrète, un bouton. Refusée, elle ne
  revient pas — mais l'entrée « Quoi de neuf » du panneau de commande reste, pour toujours.
- **Le texte vient de `nouveautes.json`**, livré à la racine du toolkit et écrit pour la
  rédaction, dans les deux langues. Ni CHANGELOG.md, qui nomme des fonctions, ni le VSIX du
  cockpit, qui aurait forcé un bump de l'extension à chaque release.
- **Un poste neuf ne voit rien**, et c'est voulu : tout y est nouveau, et l'invitation au
  tutoriel dit déjà ce qu'il faut. Un poste de développement non plus, sa version n'étant
  pas un numéro de release.
- `test/typo-check.py` contrôle désormais 85 surfaces : `nouveautes.json` et la page de la
  fenêtre en font partie. La première version du contrôle ne lisait que les titres — quatre
  phrases sur cinq seraient parties sans apostrophe typographique ni insécable.

L'avertissement de maquette (numéro ↔ poste) **n'a pas bougé** : il reste sur la majeure
seule. Un écart de medium ne change pas la maquette du document qu'on relit ; le dire là
serait le noyer à nouveau.

## 1.0.0

Premier numéro de la nouvelle ère. Rien de la maquette ne change dans cette release : la
majeure `1` ouvre le compte, elle ne signale pas une rupture.

**Un schéma de version qui dit quelque chose.** `v2026.09.42` ne permettait ni de savoir si
une maquette avait bougé, ni de juger si une mise à jour pressait — quarante et une releases
pour le seul mois de septembre. Deux mécanismes lisent désormais les niveaux :

- le sélecteur *Version du logiciel…* ne propose qu'une **ligne par medium**, la plus récente
  de ses mineures (`1.2.13`, ni `1.2.12` ni les onze d'avant), et **rien d'avant `1.0.0`**.
  Revenir plus loin en arrière reste possible en ligne de commande, par
  `update.ps1 -Version 2026.09.42` ;
- l'avertissement « ce numéro n'a pas été fait avec cette maquette » ne se déclenche plus que
  sur un écart de **majeure**. Posé sur l'égalité des chaînes, il criait à chaque release,
  donc plus personne ne le lisait. Un numéro estampillé de l'ancienne ère le déclenche encore
  une fois, ce qui est exact — la maquette a bougé entre les deux.

**Aussi dans cette release.** Les chemins du poste passent par un seul module du cockpit
(`lib/chemins-poste.js`) au lieu d'une dizaine d'écritures en dur ; une instance de
développement lit le dépôt en place, sans passer par le toolkit déployé ; la fenêtre du
lanceur porte enfin l'icône de Pronto et non celle de la Revue.
