# TODO — branchement du parser v2 (gabarit Pronto)

> ## ✅ BRANCHÉ LE 22.09.2026
>
> `pipeline/import-docx.sh` choisit désormais son lecteur **document par document** :
> `pronto-lire.py` pour tout document qui déclare les styles du gabarit (`SZH Cle` ET
> `SZH Aide` dans `styles.xml`, mode `pronto-lire.py --reconnaitre`), `docx-meta.py` pour
> tous les autres. Aucun réglage de poste : la rédaction reçoit les deux sortes de documents,
> souvent le même jour.
>
> **Ce qui a changé par rapport au plan ci-dessous**, et qu'il faut lire avant de s'en servir :
>
> - **Étape 1 (déballer un bloc tableau) : SANS OBJET, par construction.** Le lecteur ne pose
>   plus JAMAIS de ligne `T` sur un bloc, ni à la nouvelle forme ni à l'ancienne — seuls les
>   deux tableaux fixes de la tête (métadonnées, autrices et auteurs) sont consommés. Le piège
>   décrit plus bas (un tableau interne qui disparaît sans un mot) devient donc impossible :
>   il n'y a plus d'enveloppe consommée. Un bloc à l'ancienne forme s'imprime tel quel, avec
>   ses étiquettes, et `bloc-ancienne-forme` dit comment le convertir.
> - **Un trou qui n'était pas dans ce plan, mesuré sur le gabarit réel avant le branchement :**
>   les quatre paragraphes « Légende : », « Texte alternatif : », « Crédit : », « Source : »
>   s'imprimaient tels quels au milieu de l'article, et le texte alternatif était perdu. Le
>   lecteur écrit maintenant des lignes `P` (les clés quittent le corps) et des lignes
>   `FI` / `FT`, qui portent les quatre champs jusqu'à l'image (`szh-legendes.lua`) et jusqu'au
>   tableau (`docx-tables.py`, en `<caption>` + `data-alt` / `data-copyright` / `data-source`).
>   Les deux contrats étaient déjà ceux qu'attend `szh-numerotation.lua` à la compilation :
>   rien n'a été inventé, on a seulement rempli ce qui restait vide.
> - **La langue ne vient plus du document** (décision de la rédaction, 22.09.2026) : le champ
>   « Langue de l'article » a quitté le gabarit, et `import-docx.sh` passe le produit du numéro
>   (`revue:` d'`ausgabe.yaml`) dans `$SZH_PRODUIT` — Revue = fr, Zeitschrift = de. Un article
>   italien se corrige à la main dans la fiche après l'import. Un document qui porte encore
>   l'ancien champ ne bloque jamais : il avertit (`langue-du-document-ignoree`).
> - **Étapes 2 et 3 : faites.** Les quinze codes du lecteur sont déclarés (`lib/journal.js`,
>   `lib/constats.js`, `lib/i18n.js` dans les deux langues), et `bloc-mal-forme` lève une
>   boîte de dialogue après l'import (`lib/import-hote.js`, `phrasesBlocMalForme()`).
> - **Étape 5 (`.odt` dans toute la chaîne) : PAS FAITE**, et volontairement — voir « Ce qui
>   reste » à la fin de ce fichier.

**Pour qui :** la personne qui reprendra ce branchement. Elle connaît le dépôt mais n'a pas
suivi la session où ce lecteur a été écrit.

**Ce qui suit est le plan d'origine**, gardé parce que ses *pièges mesurés* valent toujours —
ce sont eux qui expliquent pourquoi le branchement a la forme qu'il a.

---

## Ce qui existe déjà

| fichier | rôle |
|---|---|
| `pipeline/pronto_modele.py` | le modèle neutre, toutes les règles du gabarit, les sorties |
| `pipeline/pronto_docx.py` | lit un `.docx` vers le modèle neutre |
| `pipeline/pronto_odt.py` | lit un `.odt` vers le modèle neutre |
| `pipeline/pronto-lire.py` | la CLI unique, renifle l'extension |
| `test/js/pronto-lire.test.js` | les contrôles du lecteur |
| `test/js/pronto-gabarits.test.js` | la parité `.docx` / `.odt` sur les gabarits livrés |
| `revue-template/Pronto - modele d'article.docx` et `.odt` | les deux gabarits |
| ~~`tmp/banc-pronto/`~~ | 20 articles réels remis en page — **effacé** au nettoyage du 17.09.2026 |

Le lecteur produit **exactement le contrat de `docx-meta.py`** : `<slug>.meta.yaml` (jamais
écrasé), les lignes `$SZH_META`, `$SZH_PHOTOS`, et une ligne JSON de stats. C'est ce qui rend le
remplacement possible sans toucher aux maillons suivants — sauf sur un point, le premier
ci-dessous.

**Ajout du 22.09.2026 — clés tolérantes.** Les trois lieux où le lecteur reconnaît une étiquette
(tableau des métadonnées, tableau des autrices et auteurs, clés de bloc figure/tableau) passent
désormais par un score de proximité (`identifier_cle()`, `CANON_METADONNEES` / `CANON_AUTEUR` /
`CANON_FIGURE` dans `pronto_modele.py`) plutôt que par une comparaison aplatie exacte : une
étiquette mal tapée (accent oublié, variante de mot en fr/de/en, casse, pluriel) est reconnue
avec un avertissement `cle-approximee`, jamais en silence — l'ancienne comparaison par
`aplatir()` était en réalité DÉJÀ silencieusement tolérante aux accents (elle les retire tous),
ce qui masquait exactement ce que la demande visait à révéler. Mesuré : `SEUIL_CLE` a dû
descendre de 0,85 (valeur d'abord envisagée) à **0,80** pour admettre les cas réels les plus
demandés (« Resumé », « Prenom », score 0,833 chacun) — voir le commentaire au-dessus de la
constante pour le détail des scores mesurés, positifs et négatifs. Décision prise seule (Robin
absent) : « Mots-clés » (et ses variantes fr/de/en) est reconnaissable bien qu'aucun champ du
gabarit ne le porte — il tombe ensuite, comme avant, dans `etiquette-metadonnees-inconnue`. Les
deux nouveaux codes (`cle-approximee`, `cle-ambigue`) rejoignent donc la liste de l'étape 2
ci-dessous, à déclarer au même titre que les autres avant le branchement.

**Précision du 22.09.2026 (même jour, arrivée en cours de chantier) — clés bloquantes,
attendues absentes, vides.** Trois cas, à ne pas confondre :

- **une clé PRÉSENTE (valeur non vide) mais NON reconnue** (score sous `SEUIL_CLE`, ou
  ambiguë) **bloque tout l'import** : `principal()` n'écrit alors ni `meta.yaml`, ni les
  instructions `$SZH_META`/`$SZH_PHOTOS`, et rend `stats['bloquant'] = True` avec
  `stats['cles_non_reconnues']` (liste de `{texte, lieu}`) ; `pronto-lire.py` sort avec le code
  **1** (au lieu de 0) et imprime une ligne par clé non lue sur stderr, en plus des
  `[import-avertissement]` habituels. `etiquette-metadonnees-inconnue`,
  `auteur-etiquette-inconnue`, `bloc-etiquette-inconnue` et `cle-ambigue` sont les codes
  concernés (table `GRAVITE_CODES` dans `pronto_modele.py`, gravité `GRAVITE_BLOQUANT`) — mais
  SEULEMENT quand la valeur associée est réellement remplie : un champ non reconnu et vide ne
  bloque jamais (voir le point suivant).
- **une clé ATTENDUE mais ABSENTE du document, ou présente avec une valeur vide** (rien, ou
  seulement des espaces, après le deux-points) compte comme absente : une simple information
  (`cle-attendue-absente`, gravité `GRAVITE_INFO`), jamais bloquante, sa valeur n'est jamais
  écrite.
- **Correction connexe, mesurée sur `tmp/corpus-relecture/lot-A`** (11 manuscrits réels, aucun
  au gabarit) : `_etiquette_szh_cle()` (tableau des métadonnées), la boucle d'
  `extraire_table_auteurs()` et celle de `_champs_bloc_meta()` (ancienne forme) acceptaient
  n'importe quel paragraphe pourvu qu'il ne soit pas « SZH Aide » — un tableau de contenu
  ORDINAIRE pris pour celui des métadonnées ou des auteurs par la seule position (piège déjà
  documenté plus bas, « Les deux premiers tableaux sont pris PAR POSITION ») voyait alors
  chacune de ses rangées comparée comme une étiquette. Inoffensif tant que le pire était un
  avertissement ; devenu dangereux le jour où « non reconnue » bloque l'import : 3 documents sur
  11 du corpus auraient bloqué sans la correction (elle n'exige plus désormais que le style SZH
  Cle comme candidat). Mesuré avant/après la correction, voir le rapport de ce chantier.

Ce mécanisme (bloquant / info / clé tolérée) n'est PAS câblé dans le cockpit — comme le reste de
ce fichier, il attend le branchement (étape 4 ci-dessous). `pronto-lire.py` sort déjà en échec
dès aujourd'hui pour qui l'appelle directement en ligne de commande.

---

## Les étapes, dans l'ordre — LE PLAN D'ORIGINE, gardé pour ses pièges mesurés

### 1. ~~Apprendre à `docx-tables.py` à déballer un bloc tableau~~ — SANS OBJET

**Révision du 21.09.2026 — la nouvelle forme des blocs (décision de Robin, voir
`outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md`, §5.3) change la donne pour les documents qui
l'emploient, mais NE SUPPRIME PAS cette étape.** Les métadonnées d'un bloc ne sont plus un
tableau enveloppe : ce sont des paragraphes SZH Cle Abb/Tab, et le tableau d'un bloc tableau est
désormais **directement au premier niveau du document**, plus jamais imbriqué. Conséquence
mesurée (`pronto_modele._extraire_blocs_nouvelle_forme()`, `test/js/pronto-lire.test.js`) : le
lecteur Pronto **n'émet plus de ligne `T`** pour le contenu d'un bloc à la nouvelle forme — ni
figure (jamais de tableau à faire sauter), ni tableau (rien à déballer, il se rend comme un
tableau de corps ordinaire). `docx-tables.py` n'a donc **rien de plus à apprendre** pour lire un
document à la nouvelle forme : un bloc tableau s'y rend tout seul, correctement, sans ligne `T`.

Le problème décrit ci-dessous reste néanmoins entier pour l'**ancienne forme**, reconnue en
repli (avec un avertissement `bloc-ancienne-forme`) pour les documents déjà remplis avant cette
révision — et le restera tant qu'ils circulent. Ce qui suit décrit ce cas précis.

**C'est le seul endroit où le contrat de sortie ne suffit pas, et il casserait en silence.**

Mesuré : `tableaux_de_premier_niveau()` ne compte jamais un tableau imbriqué comme séparé (il est
rendu dans son parent par la branche `elif enfant.tag == W + 'tbl':` de `html_du_tableau()`), et
la boucle de `principal()` saute **entièrement** tout tableau consommé
(`if ordinal in sautes: continue`, lu dans `tables_consommees_par_meta()`).

Conséquence : le jour où le lecteur posera une ligne `T` sur un **bloc tableau**, le tableau
interne ne sera plus visité du tout — ni rendu à part, ni rendu dans son parent. Le tableau
disparaîtrait de l'article sans un mot.

Deux issues, au choix :

- apprendre à `tableaux_de_premier_niveau()` / `principal()` à déballer un bloc consommé pour en
  extraire le tableau interne comme s'il était de premier niveau ;
- ou distinguer, dans les lignes `T`, un « T de bloc figure » (à sauter entièrement, comme
  aujourd'hui) d'un « T de bloc tableau » (dont seule la rangée de méta doit disparaître).

**Écrire d'abord un contrôle qui tombe si le tableau interne se perd**, avant de toucher au reste.

### 2. ~~Déclarer les codes d'avertissement~~ — FAIT (22.09.2026)

Le lecteur émet des codes que le cockpit ne connaît pas encore. Tant qu'ils ne sont pas déclarés,
ils s'affichent bruts ou pas du tout.

- `vscodium-extension/szh-cockpit/lib/constats.js` — ton, lieu, `focusChamp` ;
- `vscodium-extension/szh-cockpit/lib/i18n.js` — le texte, **dans les deux langues** ;
- `lib/journal.js` explique comment une ligne `[import-avertissement]` devient un constat.

Les codes relevés dans le lecteur : `etiquette-metadonnees-inconnue`, `auteur-etiquette-inconnue`,
`bloc-etiquette-inconnue`, `bloc-contenu-absent`, `type-article-non-reconnu`,
`structure-inattendue`, `blocs-colles`, `biblio-tableau-apres-titre`, `bloc-mal-forme`. Depuis le
21.09.2026 (nouvelle forme des blocs) : `bloc-ancienne-forme` (le document lu emploie encore
l'ancien tableau enveloppe : lu normalement, mais à convertir) et `bloc-cles-sans-contenu` (des
paragraphes de clé existent, mais aucune image ni tableau ne les suit dans la fenêtre attendue).
Depuis le 22.09.2026 (clés tolérantes, voir plus bas) : `cle-approximee` (l'étiquette d'un champ
n'était pas tapée exactement comme le gabarit, mais reconnue avec un score de proximité — le
message porte déjà la clé fautive, la clé reconnue et le score, donc suffit tel quel en repli) et
`cle-ambigue` (deux clés attendues sont trop proches l'une de l'autre pour trancher : aucune
n'est retenue).

⚠ Relire la liste dans le code avant de la recopier : elle a bougé plusieurs fois.

### 3. ~~La modale du garde-fou~~ — FAITE (22.09.2026)

**La détection est faite et mesurée ; il ne reste que l'affichage.** `bloc-mal-forme` se déclenche
quand un tableau porte les étiquettes d'un bloc (`Légende :`, `Texte alternatif :`, `Crédit :`,
`Source :`, en style `SZH Cle`) sans en avoir la forme. Mesuré : **0 déclenchement sur les 20
articles réels du banc**, et le document à blocs fusionnés reste **réparé** (`blocs-colles`), il ne
bascule pas ici.

Le message porte trois repères et se dégrade proprement, vérifié dans les deux cas :

> avec pagination — « Le tableau de **la page 5** (3ᵉ tableau, « Légende : Répartition des élèves »)
> porte les étiquettes d'une figure ou d'un tableau, mais pas la forme attendue … »
>
> sans pagination — « **Le 3ᵉ tableau** (« Légende : Répartition des élèves ») porte… » — aucune
> mention de page.

Ce qu'il reste à faire : lever une **boîte de dialogue**, pas une ligne dans le panneau. La personne
doit rouvrir son Word avant de continuer, et un avertissement qu'on lit plus tard ne sert à rien.
Le point d'accroche existe déjà — `lib/import-hote.js` lève une modale après import.

### 4. ~~Choisir le lecteur~~ — FAIT (22.09.2026) : sur les styles du document

`import-docx.sh` appelle `docx-meta.py` en dur. Il faut décider **comment on reconnaît un document
Pronto** d'un Word hérité. Le plus sûr : la présence des styles du gabarit (`SZH Cle`, `SZH Aide`)
dans `styles.xml`. Un réglage de poste serait un pis-aller — la rédaction recevra les deux sortes
de documents pendant des mois.

### 5. Accepter le `.odt` dans toute la chaîne — TOUJOURS À FAIRE

Le lecteur sait lire les deux formats ; la chaîne autour ne connaît que `.docx`. À reprendre :
`pipeline/Makefile` (la cible `import`, le balayage de `$(WORD_DIR)`), le dépôt par
glisser-déposer de `lib/import-hote.js` (message `drop.seulement.docx`), le sélecteur de fichiers
d'`importerWord()`, et `windows/open-md.ps1` si l'on veut le double-clic.

---

## Les pièges, tous mesurés

**`docx+styles` existe, `odt+styles` n'existe pas.** `pandoc -f docx+styles` enveloppe chaque
paragraphe dans un `Div` portant le nom du style Word ; pour l'OpenDocument, pandoc 3.5 répond
« The extension styles is not supported for odt ». Ne pas bâtir la conservation des styles de
corps là-dessus : cela ferait deux chaînes différentes selon le format.

**Les styles de corps du gabarit sont perdus par pandoc, dans les deux formats.** `SZH Important`,
`SZH Hervorhebung`, `SZH Question (interview)` et `Quote` sortent en `Para` nu — la chaîne
n'emploie pas `+styles`. Un auteur qui pose un encadré le perd aujourd'hui en silence. Si l'on
veut les garder, ce sera au **lecteur** de les signaler (il voit les styles dans le XML), pas à
pandoc.

**LibreOffice fusionne deux tableaux qui se touchent.** Mesuré sur le gabarit réel avec son bloc
figure dupliqué : 4 tableaux côté `.docx`, 3 côté `.odt`. Le lecteur **répare** (un tableau de
2×N rangées rend N blocs) et émet `blocs-colles`. Ne pas retirer cette réparation en croyant
qu'une ligne d'aide suffira : personne ne la lira.

**Le numéro de page n'existe que si Word a repaginé.** Il se calcule sur les
`w:lastRenderedPageBreak` (mesuré : 5 à 9 par article réel, pour 6 à 11 pages). Ils sont
**absents** d'un fichier fabriqué par script, et OpenDocument n'a pas d'équivalent. **Ne jamais
estimer une page** depuis un nombre de signes : une page fausse envoie chercher au mauvais
endroit, et l'outil passe pour menteur.

**Le banc de 20 articles ne prouve pas ce qu'il a l'air de prouver.** Le script de remise en page
part de la fiche produite par l'ancien lecteur : on mesure fiche vers gabarit vers fiche, un
aller-retour. Cela prouve que le gabarit, les deux lecteurs et la conversion LibreOffice **ne
corrompent rien** (401 champs, 43 auteurs, zéro perte). Cela ne dit **rien** de ce qu'une autrice
saura remplir à la main. Seul un vrai document rempli par une vraie personne le dira.

**Le banc a été effacé le 17.09.2026** avec tout `tmp/`. Le refaire ne coûte rien : les articles
sources sont sur le partage, `Daten_Allgemein - General\2_Produkte\52_Revue\RV02_Redaction\` et
`…\53_Zeitschrift\`, et le principe tient en trois pas — choisir des articles d'au moins quatre
pages, remplir le gabarit depuis leur fiche `.meta.yaml`, relire avec `pronto-lire.py`. Mais
mieux vaut un seul document rempli à la main qu'un nouveau banc circulaire.

**Le chemin image du lecteur `.odt` n'est éprouvé par aucun contrôle versionné.** Il a été exercé
par le banc (33 images portées et retrouvées) mais aucun gabarit ne porte d'image, donc rien ne
garde cette route. **Le contrat `$SZH_PHOTOS` avec `import-medias.py` n'a jamais été vérifié pour
l'ODT** — rien ne dit que LibreOffice nomme les images comme Word. À mesurer sur un article
illustré avant toute mise en production.

**Les deux premiers tableaux sont pris PAR POSITION.** `principal()` traite `tables[0]` comme le
tableau des métadonnées et `tables[1]` comme celui des autrices et auteurs, quoi qu'ils contiennent
(il avertit, `structure-inattendue`, quand ils ne collent pas). Les blocs, eux, ne sont cherchés
qu'à partir du **troisième**. Conséquence : un document dont on a supprimé le tableau des auteurs
verra son premier bloc figure consommé à leur place. C'est défendable pour un gabarit rigide, mais
c'est une hypothèse à connaître avant de déboguer un cas bizarre.

**`CHAMPS_AUTEUR` compte huit champs**, `ror` compris (`lib/yaml.js`). `docx-meta.py` n'en remplit
que sept — les Word hérités ne portaient pas de ROR. Le lecteur Pronto, lui, l'écrit.

**Le lexique des titres de bibliographie est partagé.** La détection se fait au titre (plus au
style, décision de la rédaction) et s'appuie sur `TITRES_BIB` de
`pipeline/filters/szh-citations.lua`, commun au filtre de composition et au cockpit. Y toucher
vaut aussi pour les articles hérités.

---

## Décisions en attente

- [ ] **« Riferimenti »** pour l'italien : absent de `TITRES_BIB`, qui ne porte que
  `bibliografia`. À ajouter ?
- [ ] **Les styles de corps** (`SZH Important` et consorts) : les conserver à la compilation, ou
  accepter qu'ils se posent dans le cockpit après l'import ?
- [ ] **Les deux gabarits dans `revue-template/`** partent désormais dans chaque nouveau numéro,
  à sa racine — comme `livre-template/Modele-chapitre-SZH.docx`. Voulu, ou à déplacer ?
- [x] ~~**Le style `heading 2` sur la ligne « Titre niveau 3 »**~~ — corrigé par la v3 du
  gabarit (22.09.2026) : la ligne porte bien `Titre3`.
- [ ] **`Fichier d'origine`** a disparu du bloc figure entre la v1 et la v2 du gabarit.
  Volontaire ?
- [ ] **Le second bloc du gabarit v3 n'a que trois clés** (pas de « Source : »), alors que la
  ligne d'aide juste dessous dit « Copiez ces quatre paragraphes ». Rétablir la clé, ou
  corriger l'aide ? Sans conséquence technique (une clé attendue absente est une information),
  mais le gabarit se contredit.
- [ ] **La ligne « Titre niveau 3 (pas de niveau 4 !) »** du gabarit v3 se contredit elle
  aussi, maintenant qu'un rang 4 existe.
- [ ] **Un titre de rang 4 est visuellement identique à un rang 3** : tous deux à la taille du
  corps et en gras (`print.css`, `h4, h5, h6`), le rang 3 portant seul un numéro de section.
  Mesuré sur le document mis en page. Voulu, ou faut-il les distinguer ?

---

## Ce qui reste

### 1. Le `.odt` dans toute la chaîne — pas fait, et pas par oubli

Le lecteur sait lire les deux formats, et la parité `.docx` / `.odt` est vérifiée à chaque
exécution (`test/js/pronto-gabarits.test.js`). Mais la chaîne autour ne connaît que `.docx`, et
**le contrat `$SZH_PHOTOS` avec `import-medias.py` n'a jamais été vérifié pour l'ODT** : rien ne
dit que LibreOffice nomme les images comme Word. C'est une mesure à faire sur un article
ILLUSTRÉ, pas une ligne de code à écrire — tant qu'elle manque, ouvrir la chaîne à l'ODT
reviendrait à parier sur les portraits des autrices et auteurs.

À reprendre le jour où cette mesure existe : `pipeline/Makefile` (la cible `import`, le balayage
de `$(WORD_DIR)`), le dépôt par glisser-déposer de `lib/import-hote.js` (message
`drop.seulement.docx`), le sélecteur de fichiers d'`importerWord()`, et `windows/open-md.ps1`
pour le double-clic.

Indice déjà relevé au passage : sur le même gabarit, la figure sort en `media/image1.png` +
`media/image2.svg` côté Word (l'aperçu et le SVG qu'il cache) et en
`1000038800000A0600000A067B9F4EE9.svg` côté LibreOffice. Les noms ne se ressemblent en rien.

### 2. Un vrai document rempli à la main

Tout ce qui précède a été mesuré sur le gabarit livré, rempli **par script**
(`tmp/`, jetable). C'est assez pour prouver que la chaîne ne perd rien ; ça ne dit **rien** de
ce qu'une autrice saura remplir. Un seul document rempli à la main par une vraie personne en
apprendra plus que dix bancs circulaires — voir le piège « Le banc de 20 articles ne prouve pas
ce qu'il a l'air de prouver », plus haut.

Ce que ce document devrait mettre à l'épreuve en priorité : une étiquette mal tapée avec une
valeur remplie (c'est le cas qui **refuse l'import**, et la v3 du gabarit en portait un —
« Legandes : », sous le seuil de reconnaissance, corrigé le 22.09.2026), un bloc figure avec
une vraie image, et un article allemand pour vérifier la langue venue du produit.

---

*Dernière mise à jour : 22.09.2026, jour du branchement. À reprendre chaque fois qu'une de ces lignes bouge.*
