# TODO — parser v2 (gabarit Pronto) : ce qui reste

Le lecteur du gabarit est branché depuis le 22.09.2026, et le `.odt` accepté depuis le 29.09.2026.
Ne restent ici que les points ouverts, et les pièges mesurés qui expliquent la forme du
branchement (réduit au nettoyage du 01.10.2026 ; le plan d’origine est dans l’historique git).

---

## Décisions en attente

- [x] **Les deux gabarits dans `revue-template/`** ne partent plus dans les nouveaux numéros
  (Robin, 07.10.2026) : `new-revue.ps1` les laisse dans le toolkit, avec l’article d’exemple.
- [ ] **`Fichier d'origine`** a disparu du bloc figure entre la v1 et la v2 du gabarit.
  Volontaire ?

## Ce qui reste

### 2. Un vrai document rempli à la main

Tout ce qui précède a été mesuré sur le gabarit livré, rempli **par script**
(`tmp/`, jetable). C'est assez pour prouver que la chaîne ne perd rien ; ça ne dit **rien** de
ce qu'une autrice saura remplir. Un seul document rempli à la main par une vraie personne en
apprendra plus que dix bancs circulaires — voir le piège « Le banc de 20 articles ne prouve pas
ce qu'il a l'air de prouver », plus bas.

Ce que ce document devrait mettre à l'épreuve en priorité : une étiquette mal tapée avec une
valeur remplie (c'est le cas qui **refuse l'import**, et la v3 du gabarit en portait un —
« Legandes : », sous le seuil de reconnaissance, corrigé le 22.09.2026), un bloc figure avec
une vraie image, et un article allemand pour vérifier la langue venue du produit.

---

## Les pièges, tous mesurés

**`docx+styles` existe, `odt+styles` n'existe pas.** `pandoc -f docx+styles` enveloppe chaque
paragraphe dans un `Div` portant le nom du style Word ; pour l'OpenDocument, pandoc 3.5 répond
« The extension styles is not supported for odt ». Ne pas bâtir la conservation des styles de
corps là-dessus : cela ferait deux chaînes différentes selon le format.

**Les styles de corps : `+styles` n'est pas la voie** (mesuré le 23.09.2026, pandoc 3.5, 16
documents réels). Cette lecture change aussi le reste de l'arbre : le gras du style de caractère
« Strong » devient un Span, une cellule passe de Plain à Para, une figure perd sa légende.
L'import passe donc par une copie marquée (`docx-styles-corps.py`, puis `szh-styles-corps.lua`
en premier filtre) : 15 documents sur 16 ressortent identiques à l'octet, le seizième (le
gabarit) ne diffère que par ses trois blocs. `Quote` n'était pas perdu : pandoc en fait déjà
un `BlockQuote`. Un `.odt` est converti en `.docx` avant tout lecteur : la copie marquée le sert aussi.

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

**Il n'y a plus de lecteur `.odt`** (le lecteur direct a été retiré) : la route des images d'un `.odt` est celle de sa conversion en `.docx`, et le contrat `$SZH_PHOTOS` avec `import-medias.py` a été mesuré dessus (« Ce qui reste », point 1).

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
