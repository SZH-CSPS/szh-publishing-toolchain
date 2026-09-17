# TODO — branchement du parser v2 (gabarit Pronto)

**Pour qui :** la personne qui branchera le lecteur du gabarit « Pronto » dans la chaîne
d'import. Elle connaît le dépôt mais n'a pas suivi la session où ce lecteur a été écrit.

**Où en est-on :** le lecteur existe, il est éprouvé, et il n'est **appelé par personne**.
`pipeline/import-docx.sh` continue d'appeler l'ancienne chaîne (`docx-meta.py`), qui reste la
seule en service. Rien de ce qui suit n'est urgent ; rien de ce qui suit n'est facultatif non
plus si l'on veut que le gabarit serve un jour.

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

---

## Les étapes, dans l'ordre

### 1. Apprendre à `docx-tables.py` à déballer un bloc tableau

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

### 2. Déclarer les codes d'avertissement

Le lecteur émet des codes que le cockpit ne connaît pas encore. Tant qu'ils ne sont pas déclarés,
ils s'affichent bruts ou pas du tout.

- `vscodium-extension/szh-cockpit/lib/constats.js` — ton, lieu, `focusChamp` ;
- `vscodium-extension/szh-cockpit/lib/i18n.js` — le texte, **dans les deux langues** ;
- `lib/journal.js` explique comment une ligne `[import-avertissement]` devient un constat.

Les codes relevés dans le lecteur : `etiquette-metadonnees-inconnue`, `auteur-etiquette-inconnue`,
`bloc-etiquette-inconnue`, `bloc-contenu-absent`, `type-article-non-reconnu`,
`structure-inattendue`, `blocs-colles`, `biblio-tableau-apres-titre`, `bloc-mal-forme`.

⚠ Relire la liste dans le code avant de la recopier : elle a bougé plusieurs fois.

### 3. La modale du garde-fou

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

### 4. Choisir le lecteur

`import-docx.sh` appelle `docx-meta.py` en dur. Il faut décider **comment on reconnaît un document
Pronto** d'un Word hérité. Le plus sûr : la présence des styles du gabarit (`SZH Cle`, `SZH Aide`)
dans `styles.xml`. Un réglage de poste serait un pis-aller — la rédaction recevra les deux sortes
de documents pendant des mois.

### 5. Accepter le `.odt` dans toute la chaîne

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

- [ ] **« Riferimenti »** pour l'italien : absent de `TITRES_BIB`, qui ne porte que
  `bibliografia`. À ajouter ?
- [ ] **Les styles de corps** (`SZH Important` et consorts) : les conserver à la compilation, ou
  accepter qu'ils se posent dans le cockpit après l'import ?
- [ ] **Les deux gabarits dans `revue-template/`** partent désormais dans chaque nouveau numéro,
  à sa racine — comme `livre-template/Modele-chapitre-SZH.docx`. Voulu, ou à déplacer ?
- [ ] **Le style `heading 2` sur la ligne « Titre niveau 3 »** du gabarit : à corriger en
  `heading 3`, sinon qui copie cette ligne obtient un rang 2.
- [ ] **`Fichier d'origine`** a disparu du bloc figure entre la v1 et la v2 du gabarit.
  Volontaire ?

---

*Dernière mise à jour : 17.09.2026, après le nettoyage de `tmp/`. À reprendre chaque fois qu'une de ces lignes bouge.*
