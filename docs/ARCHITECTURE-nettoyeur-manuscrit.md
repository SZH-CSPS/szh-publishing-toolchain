# Le nettoyeur de manuscrit

Le nettoyeur prépare un manuscrit Word (ou LibreOffice) d'autrice ou d'auteur avant son
import dans un numéro. Il le remet au gabarit « Pronto – modèle d'article », retrouve sa
structure, contrôle la bibliographie, la typographie et le vocabulaire, et note ses
corrections dans le document en révisions suivies et en commentaires. Il écrit aussi un
rapport de ce qu'il a fait et de ce qu'il n'a pas su faire.

Il ne sert qu'aux articles de la Revue et de la Zeitschrift ; c'est pourquoi le cockpit
l'appelle « Manuscript cleaner (Article) ». Le manuscrit d'origine n'est jamais modifié :
l'outil écrit un fichier neuf.

Cette page décrit son fonctionnement pour qui le maintient ou le modifie. Les mots propres à
Pronto (gabarit Pronto, slug, WSL…) sont définis dans le
[vocabulaire](ARCHITECTURE.md#vocabulaire). Les règles Vale, que la rédaction peut modifier
elle-même, sont décrites dans [`pipeline/vale/LISEZMOI.md`](../pipeline/vale/LISEZMOI.md).

## À quoi sert le nettoyeur

Un manuscrit arrive dans l'état où son autrice l'a écrit : titres en gras plutôt qu'en style,
polices et couleurs posées à la main, images sans légende, bibliographie approximative. Le
nettoyeur en tire :

1. un `.docx` au gabarit du produit, débarrassé de la mise en forme manuelle, avec les titres
   retrouvés, l'en-tête reporté dans les tableaux du gabarit et chaque image ou tableau dans
   un bloc à légende ;
2. des révisions suivies et des commentaires Word dans ce `.docx`, pour ce qu'il propose de
   corriger ;
3. un rapport, en JSON pour les programmes et en HTML pour la rédaction.

Le résultat est un document que l'import (`pipeline/import-docx.sh`) lit comme un Word rempli
dans le gabarit Pronto.

Deux principes gouvernent les décisions :

- **Dans le doute, ne rien faire et le dire.** Quand un indice ne suffit pas (un groupe de
  titres peu convaincant, un ordre prénom/nom indécidable, une référence mal formée),
  l'outil ne devine pas : il laisse le texte tel quel et le signale dans le rapport.
- **Peu d'alertes.** Un rapport de deux cents remarques n'est pas lu. Les commentaires dans
  Word sont plafonnés, le rapport groupe par règle, et une règle bruyante est retirée plutôt
  que gardée.

### Manuscrit quelconque ou déjà au gabarit

L'outil distingue deux cas, par la même règle que l'import :
`pronto_modele.est_gabarit()`. Un document est au gabarit s'il porte la propriété cachée
`SZH-Gabarit`, ou à défaut les deux styles `SZH Cle` et `SZH Aide` dans `word/styles.xml`.
Ni le nom du fichier ni un réglage du poste ne comptent. Faire évoluer le gabarit et sa clé :
[`DEVELOPPEMENT.md`](DEVELOPPEMENT.md#faire-évoluer-le-gabarit-darticle).

| Cas | Ce que fait l'outil |
|---|---|
| **B** : manuscrit quelconque | Tout : en-tête, titres, mise en forme, blocs figure et tableau, typographie, règles, ROR et ORCID. |
| **A** : déjà au gabarit | Les titres déclarés sont gardés tels quels (aucun classement heuristique), l'en-tête n'est pas recherché. Les deux tableaux fixes du document, ses clés « SZH Cle Abb/Tab » et ses paragraphes de style maison sont repris à leur place. La mise en forme, la typographie, les règles et l'annotation s'appliquent comme en cas B. |

## Lancer le nettoyeur

### Depuis le cockpit

L'onglet **Préprocessing** de l'Accueil (`lib/accueil-preproc-hote.js`) porte le
nettoyeur. On y choisit le produit (Revue ou Zeitschrift) et le format de sortie (`.docx` ou
`.odt`), puis on choisit ou dépose un manuscrit `.docx` ou `.odt`.

Le cockpit :

1. copie le manuscrit dans un dossier neuf, `Exports\Préprocessing\<nom>\` sous la racine
   de Pronto (`<nom> (2)`, `(3)`… si le dossier existe déjà) ; l'original n'est pas touché ;
2. lance la commande dans la WSL, depuis ce dossier :
   `python3 manuscrit-nettoyer.py ./<nom> --produit <produit> --sortie . --rapport <json
   temporaire> --format <format> --etapes` ;
3. suit l'avancement par les lignes `[manuscrit-nettoyer] etape <nom>` de stderr ;
4. rend le rapport HTML `<nom>-rapport.html` à côté de la copie, avec le gabarit Twig
   `export-templates/rapport-manuscrit.twig` et la vue `construireVueRapportManuscrit()` de
   `outils/rendre-gabarit.js`, puis l'ouvre dans le navigateur ;
5. supprime le JSON temporaire, quelle que soit l'issue ;
6. écrit les compteurs d'usage du passage et, pour un défaut du logiciel seulement, un rapport
   d'erreur `NETTOYEUR-ECHEC` (voir [La ligne JSON de sortie et les
   compteurs](#la-ligne-json-de-sortie-et-les-compteurs)).

L'emplacement des dossiers est décrit dans [`EMPLACEMENTS.md`](EMPLACEMENTS.md).

### En ligne de commande

Dans la WSL `SZH-Publishing`, depuis le dépôt ou le toolkit :

```sh
python3 pipeline/manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift \
    --sortie <dossier> [--rapport <fichier.json>] [--format docx|odt] [--analyse-seule] \
    [--sans-typo] [--sans-annotation] [--sans-reseau] [--base-auteurs <fichier>] [--etapes]
```

| Option | Effet |
|---|---|
| `--produit` | `revue` traite en français, `zeitschrift` en allemand. C'est la seule source de la langue de traitement. |
| `--sortie` | dossier où écrire `<nom>-nettoye.docx` (ou `.odt`). Créé au besoin. |
| `--rapport` | chemin du rapport JSON. Par défaut : `<sortie>/<nom>-rapport.json`. |
| `--format` | format du document produit, `docx` par défaut. Indépendant du format d'entrée. |
| `--analyse-seule` | n'écrit aucun document, seulement le rapport. |
| `--sans-typo` | ne passe pas par le filtre typographique. |
| `--sans-annotation` | n'écrit ni révision ni commentaire. |
| `--sans-reseau` | aucune requête vers Crossref, ROR ou ORCID. Les tests le posent toujours ; le cockpit jamais. |
| `--base-auteurs` | chemin de la base d'auteurs OJS ; sinon recherche automatique (voir [Base de noms et lexique](#base-de-noms-et-lexique)). |
| `--etapes` | écrit chaque étape atteinte sur stderr, `[manuscrit-nettoyer] etape <nom>`. |

Les messages de progression vont sur stderr, une ligne par étape. Stdout ne porte qu'une
ligne JSON (voir plus bas). Les deux flux sont écrits en UTF-8.

La variable `SZH_NETTOYEUR_TRACE`, si elle est posée, fait écrire sur stderr la trace Python
complète d'un plantage. `SZH_IMPORT_LOG`, si elle est posée, reçoit aussi les constats de
lecture.

### Codes de sortie et refus

| Code | Sens |
|---|---|
| `0` | nettoyage fait, aucune alerte `error` |
| `1` | nettoyage fait, au moins une alerte `error` |
| `2` | refus (la ligne JSON porte `refus: true` et `code_refus`), ou arguments invalides (message d'usage sur stderr, pas de JSON) |
| `3` | lecture impossible (`code_refus: "lecture-impossible"`, cause technique dans `detail`) |
| `4` | plantage : une exception Python non rattrapée |

Les refus, avant tout travail et sans rien écrire :

| `code_refus` | Cause |
|---|---|
| `fichier-verrou` | le fichier est un verrou temporaire de Word (`~$…`) |
| `extension-inconnue` | ni `.docx` ni `.odt` |
| `conversion-impossible` | l'entrée `.odt` n'a pas pu être convertie en `.docx` |
| `suivi-modifications` | le document porte des révisions (`w:ins`/`w:del`, notes comprises) : son texte n'est pas univoque. La ligne porte `revisions` (leur nombre) et `sortie_nettoyeur`, vrai si le nom finit par `-nettoye` ou si un auteur de révision est l'un de ceux que pose le nettoyeur (`AUTEURS_NETTOYEUR`). Le message dit alors d'ouvrir le manuscrit d'origine. |
| `perte-de-contenu` | après écriture : la moitié des mots ou plus manque (voir [Contrôle de perte de contenu](#contrôle-de-perte-de-contenu)). Le rapport est écrit, le document est supprimé. |

Le `message` d'un refus est une phrase courte qui dit quoi faire, dans la langue du produit
pour le suivi de modifications et la lecture impossible. Un document qui porte des
commentaires Word n'est pas refusé : ils sont comptés, signalés, et ne passent pas dans la
sortie.

## Ce que produit le nettoyeur

### Le document au gabarit

`<nom>-nettoye.docx` part d'une copie du gabarit du produit (`CHEMINS_GABARIT` :
`revue-template/Pronto - modele d'article_FR.docx` pour la Revue, `…_DE.docx` pour la
Zeitschrift). Les styles, la numérotation, les en-têtes et pieds de page du gabarit sont
gardés ; le corps est reconstruit depuis le manuscrit. Le détail est dans [Écriture du
gabarit](#écriture-du-gabarit).

### Les révisions et les commentaires

Ce qui est sûr devient une **révision suivie** (auteur « Relecture automatique ») : la
rédaction accepte tout d'un clic dans Word. Ce qui demande un jugement devient un
**commentaire** ancré sur le passage. Le reste ne va qu'au rapport. Les ROR et ORCID trouvés
en ligne sont aussi des révisions, sous l'auteur `Recherche ROR/ORCID — à vérifier`
(`ROR/ORCID-Suche — bitte prüfen` en allemand). Voir [Annotation](#annotation).

### Le rapport

Le rapport JSON est la sortie complète. Ses clés principales :

| Clé | Contenu |
|---|---|
| `entree`, `produit`, `langue`, `gabarit` (`A`/`B`), `format_entree` | le passage |
| `sortie`, `format_sortie`, `sortie_docx` | le fichier livré (`sortie_docx` : le `.docx` s'il est livré, sinon `null`) |
| `analyse_seule`, `sans_typo`, `sans_annotation`, `sans_reseau` | les options |
| `controles.vale` | `effectue` ou `indisponible` |
| `controles.perte_de_contenu` | la mesure du contrôle de perte (`null` en analyse seule) |
| `compteurs` | signes du corps et de la bibliographie, références, notes, commentaires d'origine, révisions et commentaires posés, images avec leurs dimensions en pixels |
| `decisions.entete` | l'en-tête reconnu (`donnees`), les paragraphes consommés, la trace ; `null` en cas A |
| `decisions.titres`, `decisions.formatage` | statistiques et trace, une ligne lisible par paragraphe |
| `decisions.typographie` | traces, paragraphes abandonnés, avertissements du filtre, `statut` (`appliquee`/`repli`) |
| `decisions.ecriture` | statistiques, trace et table de correspondance de l'écriture |
| `bibliographie`, `identifiants`, `annotation` | les statistiques de chaque module (`identifiants` vaut `null` en cas A, `annotation` sans annotation) |
| `avertissements_import` | les constats de lecture, `{code, champs, fr, de}` |
| `journal` | les lignes de progression |
| `alertes` | `total`, un compte par gravité, `liste`, `groupes` (par famille et par règle, dix exemples au plus par règle) et `origine` |

Chaque alerte a huit champs : `rule`, `severity` (`error`, `warning`, `suggestion`),
`action` (`fix`, `track`, `comment`, `report`), `para`, `span`, `found`, `suggested`,
`message`. La CLI ajoute `origine` (le module qui l'a levée : `regles`, `vale`,
`bibliographie`, `identifiants`, `typographie` ou `nettoyage`) et `dans_docx`
(`revision`, `commentaire` ou `rapport` : ce que l'alerte est devenue dans le document).
Les alertes sont triées par gravité, puis par paragraphe.

La page HTML est rendue par le cockpit à partir de ce JSON, dans la langue du produit :
en-tête reconnu, alertes par famille (dix occurrences au plus par règle), structure
retrouvée, images (le verdict sur leur résolution vient de `lib/qualite-image.js`), bibliographie
et « Ce que l'outil n'a pas su faire ».

### La ligne JSON de sortie et les compteurs

Stdout porte toujours une seule ligne JSON. Après un nettoyage :
`entree`, `produit`, `gabarit`, `sortie`, `format_sortie`, `sortie_docx`, `sortie_rapport`,
`typographie` (`appliquee` ou `repli`), `alertes_total`, `alertes_error`,
`alertes_warning`, `alertes_suggestion`, `duree_ms`, `code_sortie`, `compteurs`. Après un
refus : `entree`, `refus`, `code_refus`, `message`, `code_sortie`, `compteurs`, plus les
champs propres au refus. Après un plantage :

```json
{"plantage": true, "type": "KeyError", "lieu": "manuscrit_annoter.py:412",
 "etape": "annotation", "code_sortie": 4, "compteurs": {}}
```

`type` est le nom de la classe de l'exception ; `lieu`, le dernier cadre de la pile qui est un
fichier de `pipeline/` ; `etape`, l'un des noms de `ETAPES`. Une valeur hors du motif attendu
devient `Exception`, `inconnu` ou `inconnue`. Le message de l'exception n'est jamais écrit :
il cite le document.

L'objet `compteurs` vaut `{"passage": "<12 hex>", "mesures": {"<nom>": <entier>}}`.
`passage` est le début du SHA-256 du fichier d'entrée. Les mesures sont des entiers positifs
(les zéros sont omis) dont le nom est dans la liste blanche `MESURES_NETTOYEUR` (la même que
dans `lib/compteurs.js`, un test le vérifie), plus `issue.refus:<code>`, `titres.<stat>`
et `regle:<Id>:<revision|commentaire|rapport>` pour chaque alerte (un identifiant hors du
motif `^[A-Z][A-Za-z0-9-]*(\.[A-Z][A-Za-z0-9-]*)+$`, ou plus long que 64 signes, devient
`Autre`). Un passage interrompu (refus, plantage) ne porte que `issue.*`, `produit.*`,
`format.entree.odt` et `duree_ms`. Aucun texte du manuscrit n'entre dans ces compteurs.

Le cockpit les recopie dans un CSV (`lib/compteurs.js`). Il écrit un rapport d'erreur
`NETTOYEUR-ECHEC` pour un plantage, un code de sortie inattendu, `lecture-impossible`,
`perte-de-contenu`, un échec du rendu HTML ou un environnement pas prêt ; jamais pour un
refus attendu (`fichier-verrou`, `extension-inconnue`, `suivi-modifications`,
`conversion-impossible`). Les règles des compteurs et des rapports d'erreur sont dans
[`RAPPORTS-ERREUR.md`](RAPPORTS-ERREUR.md) (section « Les compteurs ne sont pas des
rapports »).

## Les étapes

`manuscrit-nettoyer.py` enchaîne les étapes ci-dessous. Le nom de la colonne « Étape » est
celui de `ETAPES`, que portent `--etapes` et la ligne de plantage.

| Étape | Ce qui se passe | Cas |
|---|---|---|
| `controle-entree` | refus d'un verrou Word ou d'une extension inconnue | A, B |
| `conversion-odt` | une entrée `.odt` est convertie en `.docx` dans un dossier temporaire (`conversion_odt.convertir()`, LibreOffice) | A, B |
| `lecture` | lecture du `.docx` vers le modèle de document ; refus si suivi de modifications | A, B |
| `gabarit` | cas A ou B ; la langue de traitement vient du produit | A, B |
| `noms` | chargement de la base de noms | A, B |
| `entete` | noms de famille de la bibliographie, en-tête, bloc final des auteurs | B |
| `identifiants` | recherche des ROR et ORCID | B |
| `titres` | classement des titres, puis titres numérotés par la liste du plan | A, B |
| `formatage` | retrait de la mise en forme manuelle | A, B |
| `typographie` | filtre typographique sur le corps, les notes et l'en-tête | A, B |
| `regles` | règles structurelles | A, B |
| `vale` | règles lexicales et éditoriales | A, B |
| `bibliographie` | contrôle APA, DOI, mise en forme | A, B |
| `ecriture` | écriture du `.docx` au gabarit | A, B |
| `controle-perte` | mots et images retrouvés dans le document écrit | A, B |
| `annotation` | révisions et commentaires | A, B |
| `conversion-sortie` | conversion du `.docx` final en `.odt` si demandé | A, B |
| `rapport` | écriture du rapport JSON | A, B |

La **langue de traitement** est `fr` pour la Revue et `de` pour la Zeitschrift. C'est elle qui
part au filtre typographique, aux règles et au rapport. La langue déclarée dans le document ne
pilote rien : si sa sous-étiquette (`fr` de `fr-CH`) diffère, une alerte
`Langue.DesaccordProduit` le signale.

### Lecture du manuscrit

`manuscrit_docx.lire()` lit le `.docx` avec la bibliothèque standard (`zipfile`,
`ElementTree`) et rend le [modèle de document](#le-modèle-de-document). Il partage avec le
lecteur de l'import (`pronto_docx.py`) les fonctions de `ooxml_lecture.py` : résolution des
styles, blocs du corps, marqueurs de page.

Ce que le lecteur doit savoir pour ne rien perdre :

- **Dessins cachés.** Beaucoup d'images flottantes sont enveloppées dans
  `w:r > mc:AlternateContent > mc:Choice > w:drawing`, deux niveaux sous le run. Le lecteur
  déplie la branche `mc:Choice`. Il ignore `mc:Fallback`, qui répète la même image en VML,
  sauf quand la `Choice` ne porte aucune image : le `Fallback` peut alors porter un vrai
  `<v:imagedata>`.
- **Images VML.** Un même `r:id` peut être répété dans un groupe : les images se comptent par
  identifiant distinct.
- **Contrôles de contenu.** Un `w:sdt` de niveau bloc qui enveloppe des paragraphes est
  déplié avant tout parcours ; sinon ces paragraphes disparaissent.
- **Tirets.** Le texte garde les tirets réels (–, —, et U+2011, qui arrive par
  `w:noBreakHyphen` ou par un `w:sym`) pour que la typographie les traite. Seul
  `projeter_pronto()` les normalise, pour rendre exactement ce que rend `pronto_docx.lire()`.
- **Caractères de contrôle.** `w:tab`, `w:br` et `w:cr` rendent `\t` et `\n`, pas une espace :
  le nettoyage de la mise en forme les cherche en tête et en fin de paragraphe.
- **Notes.** Les notes de fin (`endnotes.xml`) sont lues comme les notes de bas de page, avec un
  identifiant décalé au-delà du plus grand identifiant de note de bas de page. Une note jamais
  appelée par le corps n'est pas gardée.
- **Listes.** Une liste se lit aussi depuis un `numPr` hérité du style de paragraphe ;
  `numId="0"` signifie « pas de liste ».
- **Mise en forme effective.** Pour chaque fragment, le lecteur calcule la mise en forme
  directe et la mise en forme effective : directe, sinon style de caractère, sinon chaîne des
  styles de paragraphe (`w:basedOn`), sinon valeurs par défaut du document
  (`_index_styles_complet()`).
- **Révisions.** `_compter_revisions()` compte aussi celles des notes.
- **Numéro de page.** Il n'existe que si Word a repaginé le document
  (`w:lastRenderedPageBreak`). Il n'est jamais estimé.

Ce que le lecteur ne lit pas, il le dit par un constat `[import-avertissement]` :
en-têtes et pieds de page, zones de texte, champs Word non résolus, formes vectorielles,
images VML ignorées ou introuvables, dimensions d'image indisponibles, symboles de police
spéciale, notes orphelines. Pendant un nettoyage, la CLI recueille ces constats dans le
rapport (`avertissements_import`) au lieu de les écrire sur stderr.

### En-tête de l'article

En cas B, `manuscrit_entete.extraire_entete()` reconnaît l'en-tête du manuscrit avant le
classement des titres, et le retire du corps : titre, sous-titre, auteurs, résumé, mots-clés,
DOI et ligne de citation de la revue. Les paragraphes retirés reviennent dans le contexte des
règles avec leur rôle (`titre`, `sous_titre`, `resume`, `mots_cles`, `auteurs`), pour que
les règles de longueur puissent les juger. Le module ne connaît ni Word ni OpenDocument, et
réutilise les expressions de l'import (`heritage_meta.py`).

**La zone d'en-tête** va du début du document jusqu'au premier paragraphe de corps : le premier
paragraphe d'au moins `SEUIL_CORPS_ENTETE` (300) signes qui ne porte pas de marqueur reconnu,
ou le premier intertitre connu (`RE_INTERTITRE_CONNU` : « Introduction », « Einleitung »,
« Einführung », ou un numéro de section). Dans cette zone, seul ce qui est reconnu est
consommé ; un paragraphe court non reconnu reste en place.

**Titre et sous-titre.** Le titre est le premier paragraphe non vide. Deux lignes consécutives
de même mise en forme valent titre et sous-titre si la première finit par « : » ou n'a pas de
ponctuation finale, et si la seconde n'est ni une ligne d'auteurs, ni un marqueur connu, ni
l'intertitre qui clôt la zone. Sinon, `heritage_meta.scinder_titre()` coupe une ligne unique
sur son premier deux-points suivi d'une espace.

**Auteurs.** Trois formes sont essayées dans l'ordre :

1. une ligne de noms (« Prénom Nom, Prénom Nom et Prénom Nom ») : `_segments_plausibles()`
   classe chaque segment en nom (il passe `nom_plausible()` après retrait des titres
   académiques) ou en information (institution, e-mail, ORCID, téléphone). Un segment qui
   n'est ni l'un ni l'autre fait rejeter la ligne. Les informations de la ligne ne se
   rattachent que s'il y a un seul nom ;
2. « Nom, Prénom » : deux segments d'un seul mot capitalisé chacun ;
3. une ligne sans nom, avec un e-mail, un ORCID ou un mot d'institution (`RE_INSTITUTION`),
   se rattache à la dernière fiche ouverte, si un seul nom a été introduit juste avant.

Un numéro de téléphone est reconnu et écarté : la fiche n'a pas de champ téléphone. Le ROR
n'est jamais lu dans le manuscrit. L'ordre du prénom et du nom est demandé à
`manuscrit_noms` (voir [Ordre du prénom et du nom](#ordre-du-prénom-et-du-nom)).

Une fiche d'auteur porte `prenom`, `nom`, `fonction`, `institution`, `email`, `orcid`,
`texte_source`, `ordre_confiance`, `ordre_motif`, `ordre_conflit`, `ordre`, `ror` et
`a_verifier` (`CHAMPS_AUTEUR_ENTETE`).

**Résumé.** Il commence à un marqueur reconnu (`heritage_meta.RE_RESUME`) et s'arrête au
premier de ces événements : un nouveau marqueur ; l'intertitre qui clôt la zone ; un
paragraphe court (moins de `SEUIL_PSEUDO_TITRE_COURT`, 120 signes) entièrement gras ; le
plafond de `PLAFOND_RESUME_PARAGRAPHES` (4) paragraphes ou `PLAFOND_RESUME_SIGNES` (1500)
signes, avec une ligne de trace `resume_interrompu`. Une lettre de langue isolée après le
marqueur (« Résumé F » puis un saut de ligne manuel) est retirée. Un résumé dans une autre
langue que celle du produit est gardé à part (`resumes_autres`).

**Mots-clés.** Une ligne `heritage_meta.RE_KEYWORDS`, découpée par `decouper_keywords()`.

**DOI et ligne de revue** sont reconnus et retirés du corps. Le gabarit n'a pas de place pour
eux ni pour les résumés en autre langue : ils sont listés par l'alerte
`Nettoyage.ContenuEcarte`, qui invite à les reporter à la main.

Après la typographie du corps, les champs de l'en-tête passent par le même filtre
(`_normaliser_entete()`) : le titre et le sous-titre avec les règles de titre, un résumé en
autre langue dans sa propre langue.

### Bloc final des autrices et auteurs

La Revue demande, en fin de manuscrit, un bloc « Informations sur les autrices et auteurs »
(« Angaben zu den Autor:innen »). Non reconnu, il serait pris pour de la bibliographie.
`manuscrit_entete.extraire_bloc_auteurs_final()` le cherche après l'en-tête, sur le document
encore complet. Les paragraphes déjà consommés par l'en-tête ne sont jamais revisités. Trois
voies, dans cet ordre :

1. **Une fiche en tableau** (`_tableaux_auteurs()`) : un tableau situé après la zone
   d'en-tête, retenu seulement s'il nomme une personne de la ligne d'auteurs (même e-mail ou
   mêmes mots du nom), s'il porte un e-mail, un ORCID ou une institution, si toutes ses lignes
   font moins de `SEUIL_LIGNE_AUTEUR_FINAL` (120) signes et s'il en compte au plus
   `MAX_LIGNES_TABLEAU_AUTEURS` (30). Sans ligne d'auteurs dans l'en-tête, aucun tableau
   n'est retenu. Dans ce tableau, une ligne n'ouvre une fiche que si elle nomme une personne
   de la ligne d'auteurs. Le tableau est consommé entier, photo comprise.
2. **Un intertitre connu** (`RE_INTERTITRE_AUTEURS_FINAL`), le dernier du document : tout ce
   qui suit, jusqu'à la fin ou jusqu'à un tableau, est le bloc. Un paragraphe coupé par des
   sauts de ligne manuels est analysé ligne par ligne.
3. **Un repli** : le plus long groupe de paragraphes courts (moins de 120 signes) en fin de
   document. La remontée s'arrête net sur un titre de bibliographie, sur une ligne qui a la
   forme d'une référence (une année 19xx ou 20xx entre parenthèses ou suivie d'un point,
   `_ressemble_reference_biblio_pour_repli()`), sur un intertitre, sur une image ou sur une
   clé de figure ou de tableau. Si la remontée atteint l'en-tête ou le début du document sans
   avoir été arrêtée, le repli est refusé (trace `bloc_auteurs_final_refuse`) : ce serait le
   corps de l'article. Le groupe n'est consommé que s'il porte au moins un nom plausible.

Les lignes du bloc passent par les mêmes fonctions que la zone d'en-tête. Un libellé allemand
isolé (« Autorinnen und Autoren », « Kontakt ») est ignoré.

Chaque auteur reconnu est fusionné avec les fiches de l'en-tête (`_fusionner_auteurs()`) :
même e-mail, ou à défaut même ensemble de mots du nom (`{guilley, edith}` égale
`{edith, guilley}`), sans tenir compte de la casse ni des accents. Une fiche existante voit
ses champs vides complétés, jamais un champ rempli écrasé. Si l'ordre des mots diffère, celui
de la fiche la plus sûre l'emporte (trace `ordre_repris_bloc_final`). Un auteur inconnu
devient une nouvelle fiche.

Quand une ligne sans mot d'institution a été rangée en institution et qu'une vraie institution
arrive ensuite, la première rejoint la fonction (`_fusionner_info()`). `RE_INSTITUTION`
reconnaît aussi `Stiftung`, `Verein`, `Association` et les formes juridiques `AG`, `GmbH`,
`SA`, `Sàrl`, `e. V.`, en respectant la casse (« sa fonction » n'est pas une société).

Les paragraphes consommés sont retirés du corps avant l'extraction de la bibliographie.

### Ordre du prénom et du nom

`manuscrit_noms.py` décide, dans un nom déjà reconnu, quel mot est le prénom et lequel est le
nom. Il ne connaît ni Word ni le modèle de document : il reçoit des mots et des indices.
Quatre signaux rendent chacun un ordre, un poids et un motif lisible :

| Signal | Poids | Ce qu'il lit |
|---|---|---|
| `casse` | 3 (`FORCE_CERTAINE`) | un mot en majuscules ou en petites capitales quand les autres ne le sont pas est le nom ; casse tapée (`GUILLEY Edith`) ou mise en forme. Muet si tout est en capitales. |
| `email` | 3 | la partie locale d'un e-mail du même bloc (`delphine.protti@…`) comparée aux mots ; muet si les deux mots s'y trouvent ou devant une adresse institutionnelle |
| `biblio` | 2 (`FORCE_PROBABLE`) | les noms de famille certifiés par les références du manuscrit lui-même (`_noms_de_bibliographie()`) |
| `lexique` | 2 | la base de noms : prénom connu en tête et nom connu en fin, ou l'inverse. Tranche dès qu'un côté l'emporte d'au moins `MARGE_LEXIQUE` (1) |

**Combinaison** (`trancher()`). Un signal de poids 3 qu'aucun autre signal de poids 3 ne
contredit donne `confiance = "certaine"`. Sinon, la somme la plus forte donne `"probable"`.
Des signaux contradictoires à poids égal donnent `conflit = True`, l'ordre prénom-nom et
`"defaut"`. Sans signal : l'ordre prénom-nom et `"defaut"`.

**Propagation.** Un article est écrit dans un seul ordre. `trancher_groupe()` propage d'abord
sur une ligne : si les segments tranchés sont d'accord, les segments en `defaut` sans conflit
prennent leur ordre en confiance `"propagee"`. Puis
`manuscrit_entete._propager_ordre_document()`, appelé après la fusion du bloc final, fait de
même sur toutes les fiches du document. Une fiche lue sous la forme « Nom, Prénom » a
`ordre = None` et ne vote pas : sa virgule dit l'ordre de ce segment, pas la convention du
document.

**Répartition** (`repartir()`). Le prénom est le premier mot, prolongé à travers un tiret
isolé ou des initiales pointées (« Susan C. A. Burkhardt » donne le prénom « Susan C. A. »).
Le reste, particules comprises (`heritage_meta.PARTICULES`), est le nom. En ordre inverse, la
remontée part de la fin.

La base de noms ne sert qu'à départager un ordre : un auteur qu'elle ne connaît pas n'est ni
rejeté ni signalé.

### Base de noms et lexique

`BaseNoms.charger()` réunit des jetons pliés (minuscules, sans accents) avec un poids. Toutes
les sources sont facultatives : absentes ou illisibles, les autres signaux jouent seuls.

**La base d'auteurs OJS.** Elle est cherchée dans cet ordre : `--base-auteurs`, la variable
`SZH_AUTEURS_CACHE`, `/mnt/c/ProgramData/SZH/auteurs.json`, puis
`C:\ProgramData\SZH\auteurs.json`. Le couple prénom/nom y est structuré. Une fiche dont un
champ contient un chiffre, `@`, `/` ou un mot de `INSTITUTIONS_BRUIT` (« SZH/CSPS »,
« Edition »…) est écartée. Cette base est moissonnée sur l'OAI-PMH public d'ojs.szh.ch par
`lib/auteurs-ojs.js` du cockpit, en tâche de fond au démarrage, quand elle a plus de
`JOURS_FRAICHEUR` (30) jours ou n'existe pas. Un poste neuf ou hors ligne nettoie donc
d'abord sans elle.

**Le lexique du dépôt**, dans `pipeline/lexique/` (`FICHIERS_LEXIQUE`). Trois fichiers, un
jeton plié par ligne, triés, `#` en commentaire. Chacun porte dans son en-tête son
producteur, ses sources et leurs licences. On ne les édite pas à la main : on relance leur
producteur.

| Fichier | Alimente | Producteur | Source |
|---|---|---|---|
| `noms-famille.txt` | noms | `outils-dev/lexique/generer-noms.py` | les bibliographies d'articles publiés (forme APA « Nom, P. ») |
| `noms-frequents.txt` | noms | `outils-dev/lexique/moissonner-noms-publics.py` | OFS (noms de famille de la population résidante permanente) et INSEE (prénoms et patronymes de la base SIRENE) |
| `prenoms-frequents.txt` | prénoms | idem | OFS (prénoms par année de naissance) et INSEE |

Les sources publiques imposent de citer leur provenance (opendata.swiss pour l'OFS, Licence
Ouverte 2.0 pour l'INSEE) : c'est pourquoi chaque fichier la porte. Les fichiers du dépôt ne
contiennent aucune donnée de la base d'auteurs : le dépôt est public, et
`moissonner-noms-publics.py` ne lit pas `auteurs.json` (un test le vérifie sur le script).

`moissonner-noms-publics.py` :

- écarte les entrées INSEE de moins de `SEUIL_BRUIT_INSEE` (50) occurrences ;
- ne met un jeton dans les noms que si son poids de nom vaut au moins `--rapport` (2) fois son
  poids de prénom, et inversement ; entre les deux, il n'entre nulle part. Les deux index sont
  donc disjoints, ce qu'un test vérifie : un jeton présent des deux côtés annulerait sa
  propre contribution au signal ;
- refuse d'écrire si une famille de sources manque, plutôt que d'écrire un fichier vide ;
- accepte `--palier-noms` et `--palier-prenoms` pour tronquer ; par défaut il garde tout.

`_charger_fichier_lexique()` reconnaît un fichier déjà plié et saute alors la normalisation
Unicode, ce qui divise environ par quatre le temps de chargement.

`outils-dev/lexique/banc-noms.py` mesure la qualité du signal `lexique` sur la base OJS du
poste, chaque fiche étant retirée de la base avant d'être jugée. Il juge des fiches isolées
et ne voit pas la propagation. Le critère pour adopter un lexique plus large : il ne fait pas
monter le nombre d'ordres inversés.

### ROR et ORCID

En cas B, après l'en-tête, `manuscrit_identifiants.enrichir_auteurs()` complète les fiches.
`_requete()` est son seul accès au réseau (délai `DELAI_RESEAU_DEFAUT`, 4 s). Seuls le nom,
le prénom et l'institution partent sur le réseau.

- **ROR.** Pour un auteur avec institution et sans ROR : requête `affiliation` à
  `api.ror.org/v2/organizations`. Seul l'item marqué `chosen` est retenu ; les autres sont
  souvent faux. Le résultat est mis en cache par texte d'institution. Forme écrite :
  `https://ror.org/<id>`.
- **ORCID absent du manuscrit.** Recherche `expanded-search` par nom et prénom. Un candidat
  n'est retenu que si le nom et le premier prénom concordent, et si l'une de ses institutions
  concorde avec celle de l'auteur : égalité avec un nom de l'organisation ROR trouvée, sinon
  ratio `difflib` d'au moins `SEUIL_INSTITUTION` (0,85), sinon inclusion d'au moins
  `LONGUEUR_INCLUSION` (8) caractères. Il faut exactement un candidat. Un homonyme sans
  institution concordante ne remplit rien et lève `Identifiants.OrcidCandidat`.
- **ORCID du manuscrit.** Jamais remplacé. Sa clé de contrôle (ISO 7064 mod 11-2) est vérifiée
  même sans réseau (`Identifiants.OrcidInvalide`). En ligne, l'enregistrement public doit
  porter le même nom (`Identifiants.OrcidNomDivergent`) ; un 404 vaut `OrcidInvalide`.

Un champ déjà rempli n'est jamais écrasé. Une panne d'un service l'éteint pour le reste du
passage, sans exception ; si une recherche en ligne n'a pas abouti, l'alerte
`Reseau.RechercheImpossible` le dit. Chaque valeur trouvée est listée dans
`auteur['a_verifier']`, écrite en révision suivie dans la fiche du gabarit et signalée par
`Identifiants.RorPropose` ou `Identifiants.OrcidPropose`. Statistiques au rapport, clé
`identifiants` : `requetes`, `ror_trouves`, `orcid_trouves`, `orcid_candidats`,
`orcid_invalides`, `orcid_nom_divergent`, `indisponible`.

### Titres

En cas A, chaque paragraphe garde le niveau de son style. En cas B,
`manuscrit_modele.classer_titres()` décide quels paragraphes de premier niveau sont des
titres, et à quel niveau (1 à 3). La question n'est pas « ce paragraphe est-il court », mais
« quelles mises en forme existent dans ce document, et lesquelles se comportent comme des
titres ». Tout se compare au corps du même document, jamais à un seuil absolu ; aucune passe
ne calcule de score.

La **signature** d'un paragraphe est le tuple : taille, tout en gras, tout en italique, tout
souligné, police unique, alignement, tout en capitales. Elle se lit sur la mise en forme
effective (voir [Le modèle de document](#le-modèle-de-document)). La **signature
typographique** est la même sans l'alignement, souvent hérité d'un réglage global. Le
**corps** est l'ensemble des paragraphes non exclus et non déclarés titres : on en tire la
signature dominante et la longueur médiane en signes.

1. **Écarter.** Certains paragraphes ne peuvent pas devenir des titres par déduction : style
   maison `SZH …`, style de citation (`Quote`, `Citation`, `Zitat`) ou de légende,
   paragraphe en liste, vide, sans aucune lettre (ligne de tirets), portant un e-mail, un
   téléphone (`RE_TELEPHONE`, au moins 9 chiffres) ou une URL, commençant par une légende
   (`RE_LEGENDE` : « Tableau 1 », « Figure 2 »…). S'y ajoutent les paragraphes sans style de
   titre situés après le dernier titre de bibliographie reconnu (lexique `TITRES_BIB` de
   `szh-citations.lua`), jusqu'à la fin ou au premier tableau.
2. **Lire l'état déclaré.** Il est cohérent si le nombre de titres déclarés est compris entre
   `MIN_TITRES` (2) et `MAX_TITRES` (21) sur au plus `MAX_NIVEAUX` (3) niveaux. Aucun titre
   déclaré : on cherche les trois niveaux. État cohérent : on ne cherche que les niveaux
   inemployés. État incohérent : on ne promeut rien.
3. **Rétrograder.** Un titre déclaré est gardé si sa signature typographique diffère de
   celle du corps à la fois en mise en forme effective et en mise en forme directe. Sinon,
   la longueur décide : il est gardé si sa longueur, multipliée par
   `RATIO_RETROGRADATION_MIN` (1), ne dépasse pas la longueur médiane du corps ; il redevient
   du corps dans le cas contraire. Les deux référentiels sont nécessaires : un faux titre
   obtenu en posant seulement un style de titre ressemble à un vrai en mise en forme
   effective, et un corps qui hérite sa taille du style ne ressemble au titre qu'en mise en
   forme directe.
4. **Adopter.** Pour chaque niveau, la signature typographique des titres déclarés gardés à
   l'étape 3 devient la référence, si elle est majoritaire (plus de la moitié) et différente
   de celle du corps. Un paragraphe sans style qui porte cette signature est adopté à ce
   niveau. L'ordre compte : calculer la référence avant la rétrogradation pourrait prendre la
   signature du corps et faire de tout l'article un titre.
5. **Grouper.** Parmi les paragraphes restants, on regroupe ceux de même signature complète,
   différente de celle du corps, dont la longueur multipliée par `RATIO_LONGUEUR_TITRE` (3)
   ne dépasse pas la médiane du corps. Un groupe est retenu si ses longueurs sont homogènes
   (le plus long, en mots, ne dépasse pas `SEUIL_HOMOGENEITE_MOTS` (3) fois le plus court,
   le plus court étant compté au moins `PLANCHER_HOMOGENEITE_MOTS` (4) mots) et, à partir de
   `SEUIL_DISPERSION_MIN` (3) occurrences, si elles ne se suivent pas toutes. Les groupes
   retenus sont ordonnés par taille décroissante, puis le gras, puis l'italique, et reçoivent
   les niveaux disponibles dans cet ordre. Au-delà de trois groupes, les suivants vont au
   niveau 3 s'il est disponible (trace `groupes_rabattus_niveau3`). Si le total dépasse trois
   niveaux, toute la promotion de cette étape est annulée.
6. **Titres en liste numérotée.** Un item de liste numérotée (jamais une puce) est candidat
   s'il est isolé (ni le paragraphe non vide précédent ni le suivant n'est de la même liste)
   et s'il est en gras, ou plus grand que le corps, ou en italique quand tous les autres
   candidats isolés le sont aussi. Il perd sa liste, et un numéro manuel en tête
   (`RE_NUM_MANUEL` : « 2.1 », « IV. ») est retiré. Son niveau : la profondeur du numéro
   manuel, sinon le niveau de liste plus un, sinon l'ordre des signatures parmi ces
   candidats.

Le nombre total de titres n'est jamais un motif de rejet. S'il dépasse `MAX_TITRES`, la trace
porte `signal_nombre_titres_inhabituel` (un entretien dont les questions sont en gras, par
exemple). Si des candidats existaient mais qu'aucun groupe n'a convaincu, la trace le dit
(`aucune_promotion_decelee`).

Dans les deux cas, `titres_du_plan()` passe ensuite. Un titre retenu perd la numérotation que
son style lui donnait sous forme de liste : c'est le gabarit qui numérote. Un paragraphe de
corps numéroté par la même liste que les titres déclarés devient un titre, au niveau que ce
cran de liste porte chez eux, sinon au cran plus un, au plus 3.

Chaque décision laisse une ligne de trace par paragraphe, avec la signature et les chiffres
qui l'ont motivée.

### Mise en forme manuelle

`manuscrit_modele.nettoyer_mise_en_forme()` s'applique à tous les paragraphes : premier niveau,
cellules de tableau à toute profondeur, et notes.

| Ce qui part | Ce qui reste |
|---|---|
| police, taille, couleur, surlignage, petites capitales, majuscules forcées, barré (`FORME_RETIREE_TOUJOURS`) | italique, exposant, indice, liens |
| gras et souligné, dans un paragraphe de corps seulement (`FORME_RETIREE_CORPS_SEUL`) | le gras d'un titre |
| alignement et retrait | le gras d'un paragraphe de corps entièrement gras |
| saut de ligne manuel en fin de paragraphe, tabulation en tête | |
| paragraphes vides consécutifs, ramenés à un seul (au premier niveau) | |

L'italique porte du sens (mot étranger, titre d'ouvrage) : il n'est jamais retiré. Un
paragraphe de corps entièrement en gras ou en majuscules n'est pas retenu comme titre mais
peut en être un manqué : il est signalé (`mise-en-forme-suspecte`), et son gras est gardé
pour que la relectrice le voie. Les majuscules forcées partent dans tous les cas.

Entre deux paragraphes d'images, les vides ne sont réduits qu'à
`pronto_modele.MAX_VIDES_ENTRE_IMAGES` (2) plus un : leur nombre décide si les deux images
forment une même figure (voir [Blocs figure et tableau](#blocs-figure-et-tableau)).

La trace d'un paragraphe de cellule porte le `source` du tableau qui le contient
(`dans_tableau: true`), pas sa position dans la cellule.

Tout le corps reçoit le style du corps de texte du gabarit (`Body Text` dans Word, `Text body`
dans LibreOffice : une règle qui reconnaît ce style par son nom doit tester les deux).

### Typographie

La typographie de la maison est le filtre Lua `pipeline/filters/szh-typographie.lua`, décrit
dans [`TYPOGRAPHIE.md`](TYPOGRAPHIE.md). Le nettoyeur ne la réécrit pas : `manuscrit_typo.py`
l'appelle.

```sh
pandoc -f json -t json -M lang=<fr|de> --lua-filter pipeline/filters/szh-typographie.lua
```

`normaliser_paragraphes()` construit un document pandoc (AST JSON) à partir des fragments de
chaque paragraphe : un paragraphe par unité de texte, un titre (`Header`) pour un paragraphe
retenu comme titre, afin que le filtre y applique ses règles de titre. Tout le document part
en un seul appel (délai `DELAI_SECONDES`, 90 s). La CLI tourne dans la WSL, où `pandoc` est
sur le `PATH`.

**Réinjection.** Word découpe le texte en runs de façon imprévisible, parfois au milieu d'un
mot. Le texte normalisé revient d'un bloc ; il est redistribué dans les fragments d'origine par
`difflib.SequenceMatcher`, caractère par caractère. Chaque caractère gardé conserve la mise en
forme de son fragment ; un caractère inséré prend celle de son voisin de gauche. Deux
vérifications encadrent l'opération : le texte envoyé doit égaler la concaténation des
fragments d'origine, et le texte réinjecté doit égaler, caractère pour caractère, le texte
rendu par le filtre. Si l'une échoue, le paragraphe est rendu inchangé et compté dans
`abandons`. Une image ou un appel de note est une unité opaque, jamais envoyée au filtre.

Le filtre écrit aussi des avertissements `[typo-avertissement]` sur stderr (le ß, les
guillemets droits non appariés…). Ils sont lus que l'appel réussisse ou non et deviennent des
alertes `Typo.*` par `manuscrit_regles.py`.

Si pandoc ne répond pas, tout le texte reste inchangé (`statut: "repli"`) et l'alerte
`Typo.ApplicationImpossible` le dit. `--sans-typo` donne aussi `repli`, sans alerte.

Un `--` tapé tel quel n'est pas converti : cette conversion vient du lecteur Markdown de
pandoc, qu'un AST construit à la main ne traverse pas. Un vrai cadratin l'est.

### Règles structurelles

Les règles se répartissent en trois couches, chacune avec un seul propriétaire :

| Couche | Propriétaire | Modifiée par |
|---|---|---|
| Typographie (espaces, apostrophes, guillemets, tirets…) | `pipeline/filters/szh-typographie.lua` | le développeur, en Lua |
| Lexicale et éditoriale (épicène, vocabulaire du handicap, casse maison, et/&, citation directe, orthographe rectifiée, trait d'union, lexique maison) | `pipeline/vale/styles/` | la rédaction, en YAML |
| Structurelle (longueurs, niveaux de titre, forme de la bibliographie, accessibilité, ordre des noms) | `pipeline/manuscrit_regles.py` | le développeur, en Python |

Un motif de texte (« ce mot est proscrit ») relève de Vale. Une comparaison entre plusieurs
éléments du document (« ce titre saute un niveau ») relève de Python.

Les règles se fondent sur les lignes directrices rédactionnelles 2025 de la Revue et de la
Zeitschrift (deux PDF, hors du dépôt). Chaque règle porte la référence de son chapitre ; une
règle qui n'en a pas le dit dans son champ `chapitre`.

`manuscrit_regles.evaluer()` reçoit un **contexte**, un dict JSON simple, et ne connaît ni
Word ni le modèle de document. Il ne devine aucun rôle : c'est la CLI qui le fournit.

```json
{
  "produit": "revue",
  "langue": "fr",
  "paragraphes": [{"source": 0, "texte": "…", "role": "titre", "niveau_retenu": 0}],
  "bibliographie": [{"nom": "Dupont", "annee": 2020, "nb_auteurs": 0, "texte": "…", "source": 12}],
  "images": [{"alt": "…", "source": 3}],
  "tableaux": [{"fusion": true, "source": 5}],
  "avertissements_typo": ["[typo-avertissement] eszett | …"],
  "auteurs": [{"prenom": "…", "nom": "…", "ordre_confiance": "defaut", "ordre_motif": "…",
               "ordre_conflit": false, "texte_source": "…"}]
}
```

`role` vaut `""` (corps), `titre`, `sous_titre`, `resume`, `auteurs`, `mots_cles` ou
`bibliographie`. La bibliographie est le dernier titre retenu dont le texte est dans
`TITRES_BIB` (un complément final entre parenthèses ou crochets est toléré,
`pronto_modele.sans_complement_titre()`), et tout ce qui suit jusqu'à la fin ou un tableau.
`nb_auteurs` vaut toujours 0 dans ce contexte : `manuscrit_biblio.py` compte les auteurs de
son côté. En cas A, le premier bloc reçoit le rôle `titre` s'il est un titre.

Le catalogue (`CATALOGUE`) :

| Règle | Gravité | Ce qu'elle vérifie |
|---|---|---|
| `Forme.LongueurArticle.Revue` / `.Zeitschrift` | error | au plus `LONGUEUR_ARTICLE_MAX` (18 000) signes ; la Zeitschrift compte le résumé, la Revue non |
| `Forme.LongueurResume.Revue` | error | entre `RESUME_MIN_REVUE` (400) et `RESUME_MAX_REVUE` (600) signes |
| `Forme.LongueurResume.Zeitschrift` | error | au plus `RESUME_MAX_ZEITSCHRIFT` (700) signes |
| `Forme.LongueurTitre.Zeitschrift`, `.LongueurSousTitre.`, `.LongueurTitreChapitre.` | error | au plus 100, 120 et 80 signes (`TITRE_MAX_ZEITSCHRIFT`, `SOUS_TITRE_MAX_ZEITSCHRIFT`, `TITRE_CHAPITRE_MAX_ZEITSCHRIFT`) |
| `Structure.NiveauxTitre` | warning | un titre qui saute un niveau |
| `APA.TroisAuteursPlus` | warning | « et al » sans point |
| `APA.MemeAuteurMemeAnnee` | warning | espace parasite entre l'année et sa lettre (« 2020 a ») |
| `APA.NombreAuteursListes.Revue` / `.Zeitschrift` | error / suggestion | plus de `NB_AUTEURS_TRONCATURE` (20) auteurs dans une référence |
| `A11y.TexteAlternatif.Revue` / `.ZeitschriftHeritee` | warning / suggestion | image sans texte alternatif |
| `A11y.TableauLineaire.Revue` / `.ZeitschriftHeritee` | warning / suggestion | tableau à cellules fusionnées |
| `Entete.OrdreNomIncertain` | warning | par fiche : des signaux contradictoires sur l'ordre prénom/nom ; le message donne les deux lectures |
| `Entete.OrdreNomParDefaut` | suggestion | une seule fois par document : des fiches en ordre par défaut, sans conflit ; `found` liste les noms |

Le conflit d'ordre voyage comme une donnée (`ordre_conflit`), jamais comme un préfixe de
phrase dans `ordre_motif` : un test qui dépend d'une phrase ne voit pas le jour où elle change.
L'ordre alphabétique de la bibliographie est contrôlé par `manuscrit_biblio.py`.

La résolution des images n'est pas jugée ici : le rapport porte leurs dimensions en pixels, et
le verdict vient de `lib/qualite-image.js` (1000 px au moins pour une figure, 2000 conseillés).

La CLI ajoute ses propres alertes, d'origine `nettoyage` : `Langue.DesaccordProduit`,
`Reseau.RechercheImpossible`, `Nettoyage.ContenuPerdu`, `Nettoyage.ControleImpossible`,
`Nettoyage.ContenuEcarte`, `Nettoyage.NoteReprise`, `Annotation.Impossible`,
`Nettoyage.ConversionOdtImpossible`. `Typo.ApplicationImpossible` et `Vale.Indisponible`
portent l'origine de leur module.

### Règles Vale

`manuscrit_vale.analyser()` écrit le texte dans deux fichiers, un paragraphe par ligne :
`corps-<langue>.txt` et `biblio-<langue>.txt`. Le nom du fichier décide des règles qui
s'appliquent (`pipeline/vale/.vale.ini`) : les règles du corps ne touchent jamais une
référence, qui reproduit un nom d'auteur tel qu'il a été publié. Vale (binaire épinglé de
l'image, version dans `image/Containerfile`) tourne avec `--output=JSON` ; délai
`DELAI_SECONDES`, 60 s.

Vale reçoit le corps, moins l'en-tête et le bloc final, plus les cellules de tableau et le
texte des notes à toute profondeur. Une alerte sur une cellule n'est pas ancrable dans le
document. Une alerte sur une note est reportée sur le paragraphe qui appelle la note, avec
`note_id` et `note_numero` (`_marquer_notes_dans_alertes()`).

Les URL, adresses `www` et DOI du corps sont masquées avant l'envoi, caractère pour caractère
(remplacées par `X`), pour ne pas décaler les positions : sinon `downloads/sections`
déclencherait une règle épicène. La bibliographie n'est pas masquée.

Vale ne connaît pas les assertions avant/arrière (RE2). Dix règles ont donc un motif large,
et la table `RAFFINEURS` en tire le passage exact, la suggestion, ou rejette le constat. Le
`Span` de Vale est en positions 1 à n, fin incluse : il est converti. Vale introuvable, une
configuration cassée ou une règle mal formée donnent une sortie vide : `analyser()` rend
alors `indisponible`, et la CLI lève `Vale.Indisponible`.

Le contenu des règles et la façon de les modifier sont dans
[`pipeline/vale/LISEZMOI.md`](../pipeline/vale/LISEZMOI.md).

### Bibliographie

`manuscrit_biblio.py` contrôle la bibliographie selon APA 7, en français et en allemand. Il
reçoit du texte déjà extrait et rend des alertes au format commun. Il reçoit les mêmes
paragraphes de corps que Vale, notes et cellules comprises : une référence citée seulement
dans une note est bien citée.

1. `_fusionner_continuations()` réunit les paragraphes qui prolongent une référence coupée.
2. `analyser_reference()` découpe une entrée : auteurs, nombre d'auteurs, année et suffixe,
   titre, conteneur, volume, numéro, pages, éditeur, DOI, URL, type, langue de la référence
   (`langue_ref`) et `confiance` (`haute`, `moyenne`, `basse`). Le titre se sépare du
   conteneur sur `.`, `?` ou `!` ; le deux-points n'est essayé qu'en dernier, parce qu'un
   sous-titre en porte un. Un champ réécrit doit contenir au moins une lettre pour compter.
3. `citations_du_corps()` relève chaque appel, narratif ou entre parenthèses. Les préfixes
   d'exemple (« z. B. », « vgl. », « p. ex. », « notamment »…, `RE_OUVREUR`) sont sautés.
4. `croiser()` : citée mais absente (`APA.CitationAbsente`, error ; le message signale une
   référence du même auteur avec une autre année), présente mais jamais citée
   (`APA.ReferenceNonCitee`, warning), suffixe incohérent (`APA.Suffixe`), « et al. »
   manquant dès trois auteurs ou de trop (`APA.EtAl`).
5. `signaler_references_non_verifiees()` : une référence de confiance non haute reçoit un
   commentaire `APA.ReferenceNonVerifiee` sur son premier appel dans le texte (la relectrice
   lit le texte, pas la liste). Pour retrouver cet appel, un second chemin d'extraction
   (`_extraire_repli_appariement()`) accepte une année sans parenthèses ; il ne sert qu'à
   l'appariement, jamais à une réécriture.
6. `verifier_ordre()` : ordre alphabétique puis chronologique, suffixes a, b… requis pour un
   même auteur et une même année (`APA.OrdreBiblio`).
7. `doi_normaliser()` : `doi:`, `dx.doi.org/…`, `http://doi.org/…` deviennent
   `https://doi.org/10.…` (`APA.DoiForme`, fix).
8. En ligne, sur `api.crossref.org` (`_requete()`, délai 4 s) : un DOI présent est vérifié
   (`resoudre_crossref()`, titre ressemblant à au moins `SEUIL_TITRE_VERIFICATION`, 0,8 ;
   sinon `APA.DoiDivergent`) ; un DOI absent est cherché (`retrouver_doi()`, titre ressemblant
   à au moins `SEUIL_TITRE_RETROUVE`, 0,9, auteur et année concordants). Seules les
   métadonnées de la référence partent, jamais le texte de l'article. Une vraie panne du
   service lève `Reseau.RechercheImpossible`.
9. `mise_en_forme_apa()` rend la forme canonique, l'italique marqué `*…*` (`APA.MiseEnForme`,
   track), seulement pour une référence de confiance haute ou confirmée par Crossref. Le
   DOI retrouvé y est inclus. Une forme qui perdrait un nom propre, une année ou un nombre de
   l'original n'est pas proposée (`stats['non_proposees']`). `suggested_texte` porte la même
   forme sans astérisques, pour le rapport HTML.

Différences entre les langues : volume(numéro) collé en français (`12(3)`), espacé en allemand
(`27 (3)`) ; « (Éd.) » ou « (Éds.) » en français, « (Hrsg.) » en allemand, et aucun marqueur
quand aucun nom d'éditeur n'a été isolé ; seul le volume en italique (`*37*(3)`) ; plage de
pages d'un chapitre au trait d'union en français, au demi-cadratin en allemand. La langue de
la référence (mots-outils anglais ou allemands) décide de l'espace avant le deux-points d'un
titre cité : insécable en français, aucune en anglais et en allemand.

Un DOI retrouvé passe toujours en révision. Si la mise en forme est proposée, elle le porte, et
une insertion seule du DOI en fin de référence l'accompagne comme repli (même `groupe`) : la
mise en forme peut finir en commentaire si une autre révision la chevauche. Sans mise en
forme, le DOI est une insertion (`APA.DoiRetrouve`, track) ancrée sur la fin de la référence,
ou un commentaire si aucun ancrage sûr n'existe.

### Écriture du gabarit

`manuscrit_gabarit.ecrire()` part d'une copie du gabarit et n'en réécrit que
`word/document.xml`, ses relations, `[Content_Types].xml`, et au besoin `numbering.xml`,
`footnotes.xml` et ses relations. Il ajoute les images sous `word/media/`. Il ne prend aucune
décision : il traduit en styles et en runs ce que les étapes précédentes ont tranché. Le
commentaire d'aide du gabarit est retiré avec le corps d'exemple qu'il annotait.

Les styles sont trouvés par leur nom (`w:name`) dans `word/styles.xml` du gabarit
(`_StylesResolus`), jamais par leur identifiant : les gabarits enregistrés par un Word
allemand ont des identifiants comme `berschrift1` ou `Textkrper`. Si un nom manque,
l'identifiant de repli est employé et la trace le dit.

#### Tableaux fixes et en-tête

Le corps est précédé des deux tableaux fixes du gabarit : métadonnées de l'article, puis
autrices et auteurs. En cas B, ils sont remplis depuis l'en-tête reconnu : titre, sous-titre,
résumé et langue de l'article (« français » ou « deutsch ») ; « Type d'article » reste vide.
Les étiquettes sont reconnues par `pronto_modele.identifier_cle()`, comme à l'import. Avec plus
d'auteurs que de fiches, la dernière fiche est dupliquée ; avec moins, les fiches en trop
restent vides. Une valeur de `a_verifier` est écrite en révision suivie.

En cas A, les deux premiers tableaux du document qui portent des paragraphes `SZH Cle`
remplacent ceux du gabarit (`_tableaux_fixes_du_document()`), et ne sont pas recopiés dans
le corps.

Le gabarit n'a pas de champ mots-clés : ils sont écrits en premier paragraphe du corps,
« Mots-clés : a, b, c » ou « Schlüsselwörter: a, b, c ».

#### Blocs figure et tableau

Chaque image et chaque tableau du manuscrit devient un **bloc** : cinq paragraphes de clé au
style « SZH Cle Abb/Tab », puis le contenu.

| Clé (fr) | Clé (de) |
|---|---|
| Légende | Beschriftung |
| Texte alternatif | Alternativtext |
| Copyright | Copyright |
| Source | Quelle |
| Note | Notiz |

Le séparateur est « : » précédé d'une insécable en français, « : » collé en allemand. Ce
style a une bordure en haut, à gauche et à droite, pas en bas : Word fusionne les bordures de
paragraphes identiques consécutifs, et les clés dessinent un cadre ouvert au-dessus du
contenu. Le contenu est l'image, dans un paragraphe ordinaire, ou le tableau du manuscrit, au
premier niveau. Une clé que le manuscrit ne fournit pas reste vide et figure dans la trace.
L'import relit ces blocs (`pronto_modele.py`).

`_regrouper_blocs()` reconnaît, avant l'écriture :

- **les clés tapées** : un paragraphe « Étiquette : valeur » juste avant le contenu (un
  paragraphe vide toléré entre les deux), dont l'étiquette est reconnue par
  `identifier_cle(…, CANON_FIGURE)`, est consommé et sa valeur passe dans le bloc (la légende
  avec sa mise en forme) ;
- **plusieurs images, une figure** : plusieurs images dans un paragraphe, des paragraphes
  d'images séparés par au plus `MAX_VIDES_ENTRE_IMAGES` (2) vides, ou un tableau de mise en
  page (chaque cellule ne porte que des images ou rien) donnent un seul bloc, écrit une
  rangée par paragraphe. L'import le relit comme un groupe d'images `::: {.szh-grille}`. Une
  cellule qui porte une image et du texte fait un vrai tableau. Un paragraphe de texte qui
  porte des images garde son texte, suivi d'un bloc ;
- **la note** : le paragraphe qui suit immédiatement le contenu et commence par « Note : »,
  « Remarque : », « Anmerkung: », ou « Note. » à la manière APA, passe dans la clé Note
  (alerte `Nettoyage.NoteReprise`) ;
- **en cas A**, les clés « SZH Cle Abb/Tab » du document restent des clés ; si l'une a une
  étiquette inconnue, tout le jeu est recopié tel quel.

Le texte alternatif tapé va à la première image du bloc ; sans clé, c'est celui de l'image
dans Word.

**Légende déjà écrite.** Un paragraphe voisin qui commence par une légende (`RE_LEGENDE` :
« Figure 1 », « Abbildung 2 », « Tableau 3 »…) passe dans la clé Légende avec sa mise en
forme, et quitte le corps (`_associer_legendes()`). Le paragraphe suivant est essayé avant le
précédent. Une légende en deux paragraphes (« Tableau 1 », au plus 20 caractères sans
ponctuation finale, puis le texte) est reconnue comme une seule. Pour un bloc encore sans
légende, un second passage saute jusqu'à `MAX_VIDES_LEGENDE` (2) paragraphes vides ; le
sens essayé d'abord suit la convention majoritaire du document (au-dessus ou au-dessous ;
à égalité, au-dessous). Une légende tapée sous « Légende : » l'emporte : le paragraphe
« Figure 1 : … » voisin reste alors dans le texte.

Une image dans une cellule d'un vrai tableau reste en ligne dans sa cellule.

**Séparateurs.** Un bloc est toujours séparé de son voisin par exactement un paragraphe vide :
LibreOffice fusionne deux tableaux qui se touchent. Les vides du manuscrit collés à un bloc
tiennent lieu de séparateur au lieu de s'y ajouter (`_separateur_requis()`).

#### Listes

Une liste du manuscrit est reportée par correspondance : puce vers une définition à puces,
numérotée vers une définition numérotée, niveau conservé. Le `numId` du manuscrit n'est jamais
recopié : il désigne une définition d'un autre `numbering.xml`. L'écrivain réutilise une
définition adéquate du gabarit (`_RegistreListes`), sinon en injecte une. Il pose à la fois le
style et le `numPr`, comme Word. Une liste dont le format n'a pas pu être lu est reportée en
puces, et la trace le dit.

#### Notes

Chaque note appelée par le corps devient une note de bas de page, renumérotée à partir de 1.
Le style d'appel et de paragraphe de note viennent du gabarit s'il en définit (nom anglais
canonique), sinon un simple exposant et le corps de texte. Une note appelée mais absente
reçoit un contenu vide, tracé.

#### Table de correspondance

`ecrire()` rend `{stats, trace, decisions, correspondance}`. `correspondance` relie chaque
paragraphe de corps écrit au premier niveau à sa position dans la sortie :
`{"source": <Paragraphe.source>, "sortie": <indice parmi les w:p enfants directs de
w:body>}`. Les `w:tbl` ne comptent pas. Les positions comptent les paragraphes réellement
écrits : 1 par paragraphe de corps, 5 clés plus une rangée d'images par bloc figure, 5 clés
par bloc tableau, plus les séparateurs, les deux paragraphes vides après les tableaux fixes
et la ligne des mots-clés. Une entrée par bloc, marquée `"bloc": "figure"` ou `"tableau"`,
vise la clé « Texte alternatif » : c'est là que s'ancre une alerte sur une image.
L'annotation repose entièrement sur cette table.

### Contrôle de perte de contenu

`manuscrit_controle._controler_perte()` compare les mots (au moins deux caractères) et les
images du manuscrit, comptés avant tout traitement, à ceux du `.docx` écrit, relu par le même
lecteur. Il passe avant l'annotation, dont le texte barré fausserait le compte. Ce que
l'en-tête met de côté sciemment (DOI, ligne de revue, résumés en autre langue, photos d'une
fiche en tableau) est retiré de la référence et listé par `Nettoyage.ContenuEcarte`.

| Perte | Conséquence |
|---|---|
| au moins `PERTE_MOTS_MIN` (10) mots et au moins `PERTE_ALERTE` (5 %), ou une image | alerte `Nettoyage.ContenuPerdu` (error), avec des exemples de mots manquants |
| au moins `PERTE_REFUS` (50 %) des mots | en plus, le document est supprimé ; code 2, `code_refus: "perte-de-contenu"` |

Si la relecture échoue, l'alerte `Nettoyage.ControleImpossible` le dit.

### Annotation

`manuscrit_annoter.annoter()` pose les alertes dans le `.docx` écrit :

```python
annoter(chemin_docx_entree, chemin_docx_sortie, alertes, correspondance, langue='fr',
        auteur='Relecture automatique', plafond_commentaires=25) -> stats
```

L'entrée et la sortie peuvent être le même fichier : l'écriture passe par un fichier
temporaire remplacé d'un coup.

**Ce que devient une alerte.** Une alerte `fix` ou `track` avec `suggested` devient une
révision ; une alerte `comment`, ou une révision impossible à placer, devient un commentaire ;
une alerte `report` reste au rapport. `stats['devenir']`, indexé comme la liste des alertes,
dit ce que chacune est devenue : la CLI le recopie dans `dans_docx`.

**Ancrage.** Le paragraphe de sortie se trouve par `correspondance` ; une entrée de bloc
l'emporte. Le texte du paragraphe est la concaténation de ses `w:t`, lue une seule fois avant
toute écriture. Si `span` désigne exactement `found`, il fait foi. Sinon, `found` doit faire
au moins 4 caractères (`_LONGUEUR_MIN_FOUND_SANS_SPAN`) et n'apparaître qu'une fois dans le
paragraphe ; à défaut d'occurrence exacte, une comparaison qui confond apostrophes, espaces
spéciales et tirets est essayée, sans changer les positions. Sinon le commentaire porte sur
le paragraphe entier. Une alerte sans paragraphe est comptée dans `non_ancrees`. Word
n'accepte pas de commentaire dans une note : une alerte sur une note s'ancre sur le mot qui
précède l'appel, et son texte commence par « Note N » et cite le passage.

**Atomes.** Le paragraphe est découpé aux bornes de toutes ses alertes. Une révision remplace
les atomes qu'elle couvre ; un commentaire les entoure de marqueurs. Le XML entre les runs
(ouverture et fermeture d'un `w:hyperlink`) est recopié tel quel. Un run ne porte que
`w:b`, `w:i`, `w:u` et `w:vertAlign`, ce que l'écrivain sait produire ; un run supprimé
garde son `w:rPr` d'origine.

**Révisions.** Une révision est un diff par mot (`\w+|\s+|[^\w\s]`, `difflib`) entre le texte
et `suggested` : seuls les mots qui changent, de texte ou d'italique, deviennent `w:del` et
`w:ins`. Un îlot inchangé de moins de `_MIN_JETONES_ISLOTE` (3) mots entre deux changements
est absorbé. Si plus de `_UMBRAL_REEMPLAZO_TOTAL` (60 %) des mots changent, une seule paire
`w:del`/`w:ins` couvre le passage. L'italique de `suggested`, marqué `*…*`, devient `<w:i/>`.
Les `w:id` sont uniques et croissants, partagés avec les commentaires.

**Chevauchements.** Deux révisions qui se chevauchent dans un paragraphe : la plus grave
l'emporte, à gravité égale la plus large, puis la première. Les autres deviennent des
commentaires. Une révision qui touche la frontière d'un `w:hyperlink` devient aussi un
commentaire. Un commentaire `APA.DoiForme` ou `CSPS-Biblio.APA.Esperluette` entièrement
couvert par une révision qui porte déjà sa correction va au rapport (`DOUBLON_DE_REVISION`).
Un commentaire DOI qui chevauche le commentaire de mise en forme de la même référence s'y
fond (« DOI : forme attendue … », `stats['fusion_doi']`).

**Commentaires.** Texte : le message, puis « Suggestion : … » (« Vorschlag: … ») si
`suggested`, puis `[identifiant.de.la.regle]`. Ils sont triés par gravité puis par ordre
d'apparition. Au plus 5 par règle : le cinquième annonce les occurrences suivantes, qui vont
au rapport. Puis le plafond global, `plafond_commentaires` (25) ; `stats['plafond_global']`
compte ceux qu'il a refusés.

**Statistiques** : `revisions`, `commentaires`, `commentaires_synthese`,
`renvoyees_au_rapport` et `non_ancrees` (les alertes elles-mêmes), `par_regle`, `devenir`,
`plafond_global`, `fusion_doi`, `notes`.

**Filet.** Chaque partie `.xml` et `.rels` du résultat est relue par `ET.fromstring` avant
l'écriture, et la CLI revérifie le `.docx` (`_valider_docx_bien_forme()`). Si l'annotation
lève une exception ou laisse un XML mal formé, la CLI remet le `.docx` d'avant l'annotation
et lève `Annotation.Impossible` : le document livré est toujours lisible.

### Sortie en .odt

Avec `--format odt`, tout se fait d'abord en `.docx` (écriture, contrôle de perte,
annotation). Le `.docx` final est ensuite converti en `<nom>-nettoye.odt` par
`conversion_odt.convertir()` et supprimé. Si la conversion échoue, le `.docx` est livré et
l'alerte `Nettoyage.ConversionOdtImpossible` le dit.

## Les modules

Tout le nettoyeur est en Python, avec la bibliothèque standard seulement (pas de PyYAML ni
de python-docx). Il tourne dans la WSL `SZH-Publishing`, avec le pandoc et le Vale de l'image.
Un module importable a un tiret bas dans son nom ; un programme en ligne de commande, un
tiret.

| Fichier | Rôle |
|---|---|
| `manuscrit-nettoyer.py` | la commande : enchaîne les étapes, écrit le rapport, la ligne JSON et les compteurs |
| `manuscrit_docx.py` | lit un `.docx` vers le modèle de document ; `projeter_pronto()` rend la même chose que `pronto_docx.lire()` |
| `manuscrit_modele.py` | le modèle de document ; cas A ou B, classement des titres, nettoyage de la mise en forme ; sérialisation JSON |
| `manuscrit_entete.py` | en-tête de l'article et bloc final des auteurs ; propagation de l'ordre des noms sur le document |
| `manuscrit_noms.py` | ordre prénom/nom d'un nom reconnu ; base de noms |
| `manuscrit_identifiants.py` | ROR et ORCID, en ligne |
| `manuscrit_typo.py` | appel du filtre typographique et réinjection |
| `manuscrit_regles.py` | règles structurelles et contexte des règles |
| `manuscrit_vale.py` | appel de Vale et table `RAFFINEURS` |
| `manuscrit_biblio.py` | contrôle APA, DOI, Crossref, mise en forme |
| `manuscrit_corpus.py` | construit ce que reçoivent les moteurs : bibliographie, paragraphes et rôles, cellules et notes pour Vale, images, tableaux, noms de la bibliographie |
| `manuscrit_gabarit.py` | écrit le `.docx` au gabarit |
| `manuscrit_controle.py` | contrôle de perte de contenu, contenu écarté par l'en-tête, validation du `.docx` |
| `manuscrit_annoter.py` | révisions et commentaires |
| `conversion_odt.py` | conversions `.odt` ↔ `.docx` par LibreOffice (partagé avec l'import) |
| `vale/` | configuration et règles Vale |
| `lexique/` | lexique des noms |

Côté cockpit : `lib/accueil-preproc-hote.js` (onglet Préprocessing),
`outils/rendre-gabarit.js` (vue du rapport), `export-templates/rapport-manuscrit.twig`,
`lib/qualite-image.js`, `lib/compteurs.js`, `lib/auteurs-ojs.js`. Outils de développement :
`outils-dev/lexique/`.

`manuscrit_modele.py`, `manuscrit_entete.py`, `manuscrit_noms.py`, `manuscrit_regles.py`,
`manuscrit_biblio.py` et `manuscrit_identifiants.py` ne lisent ni n'écrivent de `.docx`.
Les réseaux (Crossref, ROR, ORCID) ne passent que par les deux fonctions `_requete()`, que
les tests remplacent.

## Le modèle de document

Six classes de `manuscrit_modele.py`, avec `__slots__`. Chaque objet porte `source`, sa
position dans le document d'origine : c'est elle qui permet d'ancrer une alerte.

| Classe | Champs |
|---|---|
| `Image` | `nom`, `octets`, `surface` (EMU², 0 si inconnue), `alt`, `flottante`, `source` (le paragraphe porteur), `cx`, `cy` (boîte d'affichage en EMU), `largeur_px`, `hauteur_px` (lues dans le fichier ; 0 pour un format vectoriel ou inconnu) |
| `Fragment` | `texte` (`""` pour une image ou un appel de note), `image`, `forme`, `lien`, `source`, `note` (identifiant de la note appelée), `effectif` |
| `Paragraphe` | `style` (nom résolu), `niveau_declare` (1 à 3 si le style est un titre), `niveau_retenu` (décidé par le classement ; 0 = corps), `fragments`, `liste` (`(numId, ilvl, format)`, format `puce`, `numero` ou `""`), `alignement`, `retrait` (dixièmes de point), `source`, `alignement_effectif` |
| `Cellule` | `colspan`, `rowspan`, `entete`, `blocs` |
| `Tableau` | `rangees` (une cellule masquée par une fusion n'y figure pas), `page`, `source` |
| `Document` | `blocs`, `styles` (noms de `styles.xml`), `langue` (déclarée), `revisions`, `commentaires`, `notes` (`{identifiant: blocs}`), `source`, `cle_gabarit` |

`forme` et `effectif` ont les douze clés de `FORME_CLES` : `gras`, `italique`, `souligne`,
`exposant`, `indice`, `barre`, `petites_capitales`, `majuscules`, `police`, `taille`
(demi-points), `couleur`, `surlignage`. `None` veut dire « non déclaré », `False` « déclaré
éteint ». `forme` est la mise en forme directe, la seule que nettoie l'étape de mise en forme.
`effectif` est la mise en forme réellement appliquée, que lit le classement des titres.

Le seul champ que les décisions écrivent est `niveau_retenu`, avec une exception : un titre
promu depuis une liste perd `liste` et son numéro manuel.

Un paragraphe de cellule a un `source` local à sa cellule (0, 1…).

## Les modes de diagnostic

Plusieurs modules s'appellent seuls, en JSON sur stdin et stdout (ASCII échappé). Les tests
Node les utilisent, car ils ne peuvent pas importer le Python.

| Commande | Entrée | Sortie |
|---|---|---|
| `manuscrit_modele.py --diagnostic` | un document (schéma ci-dessous) | `{gabarit, taille_dominante, titres: {stats, trace}, formatage: {stats, trace}, document}` : le document après classement et nettoyage |
| `manuscrit_entete.py --diagnostic` | `{langue, document}` | `{entete, indices_consommes, trace, document}` |
| `manuscrit_noms.py --diagnostic` | `{segments: [{texte, indices}], base: {prenoms: [...], noms: [...]}}` | `{resultats: [{prenom, nom, ordre, confiance, motif, conflit}]}` ; la base voyage dans l'entrée, aucun fichier du poste n'est lu |
| `manuscrit_docx.py --diagnostic <f.docx>` | un fichier | `{gabarit, document}` |
| `manuscrit_docx.py --projeter-pronto` / `--pronto-brut <f.docx>` | un fichier | les blocs de `projeter_pronto()` ou de `pronto_docx.lire()` |
| `manuscrit_docx.py --images <f.docx>` | un fichier | une entrée par image : nom, longueur, sha256, alt, dimensions |
| `manuscrit_regles.py --diagnostiquer` | un contexte | `{alertes, groupes}` ; code 1 dès une alerte `error` |
| `manuscrit_regles.py --catalogue` | rien | le catalogue : `id`, `famille`, `langue`, `produit`, `severite`, `action`, `chapitre` |
| `manuscrit_vale.py --analyser` | `{paragraphes_corps, paragraphes_biblio, langue}` | `{alertes, indisponible}` |
| `manuscrit_vale.py --extraire` | `{paragraphes, langue}` | `{texte_corps, texte_biblio, index}` |
| `manuscrit_vale.py --texte <f.txt> --langue fr` | un fichier, un paragraphe par ligne | les alertes ; pour un essai à la main |
| `manuscrit_biblio.py <f.docx> --langue fr [--sans-reseau]` | un fichier | `{alertes, stats}` |
| `manuscrit_annoter.py <f.docx> --alertes <r.json> --correspondance <r.json>` | un `.docx` écrit et un rapport | les statistiques ; annote le fichier en place. `--plafond`, `--auteur`, `--langue` |

Le document de `manuscrit_modele.py --diagnostic` reprend le modèle :

```json
{
  "styles": ["heading 1", "SZH Cle"],
  "langue": "fr",
  "revisions": 0,
  "commentaires": 0,
  "notes": {"3": [{"type": "paragraphe", "fragments": [{"texte": "Note."}]}]},
  "blocs": [
    {"type": "paragraphe", "style": "heading 2", "niveau_declare": 2,
     "fragments": [{"texte": "Méthode", "image": null, "forme": {"gras": true},
                    "effectif": {"gras": true, "taille": 24}, "lien": null, "source": 0,
                    "note": null}],
     "liste": null, "alignement": "", "alignement_effectif": "", "retrait": 0, "source": 3},
    {"type": "tableau", "page": null, "source": 5,
     "rangees": [[{"colspan": 1, "rowspan": 1, "entete": false, "blocs": []}]]}
  ]
}
```

Une clé absente de `forme` vaut `null`. `type` vaut `paragraphe` par défaut. Une image s'écrit
`{"nom", "surface", "cx", "cy", "largeur_px", "hauteur_px", "alt", "flottante",
"octets_base64"}`.

## Les tests

Les tests sont dans `test/js/`, lancés par `node --test`, et appellent Python par les gardes
de `test/js/gardes.js` (voir [`DEVELOPPEMENT.md`](DEVELOPPEMENT.md#les-tests)). Les `.docx` de
test sont fabriqués dans le test lui-même, jamais figés en binaire ; aucun manuscrit réel
n'entre dans le dépôt. Aucun test ne lit `C:\ProgramData\SZH`, ni n'appelle le réseau.

| Fichier | Ce qu'il vérifie |
|---|---|
| `manuscrit-docx.test.js` | le lecteur : tirets, `w:tab`/`w:br`, `w:sym`, `w:fldSimple`, `w:sdt` de bloc, notes, listes héritées, `Image.source`, mise en forme effective ; `projeter_pronto()` égale `pronto_docx.lire()` sur le gabarit |
| `manuscrit-decisions.test.js` | classement des titres et nettoyage de la mise en forme |
| `manuscrit-entete.test.js` | en-tête, bloc final, fusion des fiches, propagation de l'ordre, initiales à travers `manuscrit_noms` |
| `manuscrit-noms.test.js` | les quatre signaux, le conflit, la propagation, les particules, les initiales ; constate la limite du prénom composé |
| `manuscrit-identifiants.test.js` | ROR, ORCID, clé de contrôle, révisions « à vérifier » |
| `manuscrit-typo.test.js`, `manuscrit-typo-champs.test.js` | réinjection sans perte de caractère ni d'italique ; typographie de l'en-tête |
| `manuscrit-regles.test.js` | le catalogue structurel |
| `manuscrit-vale.test.js`, `manuscrit-vale-orthographe.test.js` | les règles Vale, dont « personne en situation de handicap » qui ne doit rien lever ; l'orthographe rectifiée |
| `manuscrit-biblio.test.js`, `manuscrit-biblio-langue.test.js` | analyse des références, croisement, ordre, DOI, Crossref (réseau injecté), différences fr/de |
| `manuscrit-gabarit.test.js` | sortie relue par `pronto-lire.py`, blocs, séparateurs, XML bien formé, table de correspondance |
| `manuscrit-figures.test.js` | clés tapées, groupes d'images, légendes, cas A |
| `manuscrit-annoter.test.js` | ancrage, révisions, commentaires, plafond, chevauchements, liens, notes, XML bien formé |
| `manuscrit-nettoyer.test.js` | la commande entière : refus, codes de sortie, langue du produit, repli typographique, origines, `dans_docx`, perte de contenu, sortie `.odt` |
| `manuscrit-compteurs.test.js` | la liste blanche des compteurs et la ligne de plantage : aucun texte du manuscrit ne sort |
| `manuscrit-rapport.test.js` | la vue du rapport HTML |
| `accueil-preproc.test.js` | l'onglet Préprocessing du cockpit |
| `lexique-noms.test.js`, `lexique-noms-publics.test.js` | les producteurs du lexique, la forme des fichiers, la disjonction des index, les licences, la provenance |

## Limites connues

- **Prénom composé à l'espace.** « Laura Marie Maaß » est coupé en « Laura » et
  « Marie Maaß » : rien dans le texte ne distingue un prénom composé d'un second nom.
- **Auteur institutionnel cité par son sigle.** « (OFS, 2022) » ne s'apparie pas à une
  référence au nom développé : il lève `APA.CitationAbsente` et `APA.ReferenceNonCitee`.
- **Alertes doublées sur un appel.** Quand `APA.ReferenceNonVerifiee` retrouve une référence
  par son second chemin d'extraction (année sans parenthèses), `APA.CitationAbsente` se lève
  aussi, à tort, sur le même appel.
- **Titre de bibliographie mal choisi.** L'étendue de la bibliographie part du dernier titre
  reconnu ; un intitulé dupliqué en fin de document peut la faire partir au mauvais endroit.
- **Insécable avant un deux-points dans un titre anglais.** Le filtre typographique traite
  tout le document dans une seule langue : dans une référence anglaise d'un article
  français, il pose une insécable avant le deux-points du titre. `manuscrit_biblio.py` ne
  corrige ce point que dans sa propre suggestion.
- **Style de titre allemand nommé.** `RE_NIVEAU_TITRE` (`pronto_modele.py`) ne reconnaît
  « Überschrift 1 » que sous la forme d'identifiant `berschrift1` : un style dont le nom
  enregistré commence par « Ü » n'est pas reconnu comme titre.
- **Allemand.** Les règles allemandes sont écrites, mais leur taux de faux positifs n'a pas été
  mesuré sur des articles allemands publiés.
- **Cas A.** Le traitement d'un document déjà au gabarit reste prudent : aucun classement de
  titres, pas de lecture de l'en-tête.
- **Ce que le lecteur ne lit pas** : en-têtes et pieds de page, zones de texte, champs Word
  non résolus. Il le dit dans le rapport.
- **`--` tapé tel quel** n'est pas converti en tiret (voir [Typographie](#typographie)).
- **Commentaires d'origine.** Ils ne passent pas dans la sortie.
- **Livres.** Le nettoyeur ne traite que les articles.
