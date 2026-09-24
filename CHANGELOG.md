# Journal des versions

Les versions sont en `majeure.medium.mineure` depuis la `1.0.0` (18 septembre 2026). La règle
de numérotation, avec ses exemples, est dans le [README](README.md#numéroter-une-version) :

- **majeure** — un numéro déjà compilé sortirait différent ;
- **medium** — il faut le dire à quelqu'un ;
- **mineure** — ni l'un ni l'autre, et c'est le cas le plus fréquent.

Avant la `1.0.0`, les versions étaient en `année.mois.compteur` (`v2026.06.1` à `v2026.09.42`,
113 étiquettes). Elles ne sont pas reprises ici : leur histoire est dans les messages de tag
(`git tag -l --format='%(contents)' 'v2026.*'`) et dans les Releases GitHub.

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
