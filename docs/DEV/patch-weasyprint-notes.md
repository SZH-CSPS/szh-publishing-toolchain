# Patch WeasyPrint 70 : notes de bas de page déplacées et imprimées deux fois

État au 03.10.2026. Accord de Robin donné le 03.10.2026 (deux patchs, (b) d'abord, version
medium ; publiée en 3.7.0, la 3.6.0 étant partie avant). Le travail est confié à la session ce ; le superviseur (session 1c) vérifie,
fusionne et publie. Rien ne se publie chez WeasyPrint sans Robin.

## 1. Ce que voit le lecteur

Deux défauts, indépendants, dans la mise en page des notes (`float: footnote`) :

| | Défaut | Où | Fréquence |
|---|---|---|---|
| (a) | La note quitte la page de son appel : l'appel est en p. 1, la note en p. 2. | Revue **et** livres | Rare : 1 longueur de texte sur 50 essayées dans un article factice (orphans 3 de `print.css`). |
| (b) | La note est imprimée **deux fois**, sur deux pages différentes. | Livres seulement | Chaque fois que (a) survient dans un document qui se repagine (sommaire en `target-counter`). |

(b) imprime du texte en double dans un livre : c'est le plus visible, d'où l'ordre (b) puis (a).

## 2. Reproduction minimale

Fichier : `min.html` (scratchpad de la session ce, `f1/min.html`), sans aucune CSS de Pronto :
page de 100 × 80 mm, corps 4/5 mm, `orphans: 2`, une note dans le premier paragraphe, et des
renvois `target-counter(attr(href), page)` vers la dernière page, qui forcent une
repagination.

Rejoué par le superviseur le 03.10.2026 dans la WSL, WeasyPrint 70.0 de `/opt/weasyprint` :

```
page 1 : a1 renvoi p5 appel¹ | a2 | a3 | b1 … b5 | c1 | c2
page 2 : c3 | c4 | c5 | 1. note une, ligne 1 | note une, ligne 2     ← (a) la note a quitté la p. 1
page 3 : d1 renvoi p5 | 1. note une, ligne 1 | note une, ligne 2      ← (b) la même note, une 2e fois
page 4 : e1 renvoi p5
page 5 : fin
```

Leviers CSS essayés par ce, sans effet : `orphans: 1` aggrave, `orphans: 3` déplace seulement
le cas, `break-inside: avoid` laisse la note reportée. Aucune option officielle ne change ce
comportement : le patch est donc le dernier recours (CLAUDE.md §3).

## 3. Cause (a) : la note est reportée au lieu de renvoyer le paragraphe

`weasyprint/layout/block.py`, fonction `_linebox_layout`, branche `if overflow:` (l. ~376-417
en 70.0). Quand une ligne déborde :

- `can_break_now` : on peut couper après la ligne courante (orphans satisfaits) ;
- `could_break_before` : on aurait pu couper avant (le paragraphe a déjà assez de lignes).

Si `can_break_now and not could_break_before`, WeasyPrint « reporte » des notes de la page
(`context.report_footnote`, en partant de la dernière) jusqu'à ce que la ligne tienne. Le code
ne regarde pas **d'où vient** la note : il reporte aussi une note dont l'appel est plus haut
sur la page, dans un paragraphe déjà posé. Dans la reproduction, le paragraphe « c » n'a qu'une
ligne posée (`c1`) ; pour poser `c2` sans violer `orphans: 2`, WeasyPrint chasse la note du
paragraphe « a » vers la page 2, alors qu'il pouvait renvoyer `c1` à la page suivante.

**Correctif posé** (`55-notes-reportees.patch`, vérifié le 03.10.2026) : ne reporter que les
notes appelées dans les lignes du paragraphe **déjà posées** sur la page (`new_children`) ;
la boucle s'arrête à la première note de la page qui n'en est pas. La ligne courante n'entre
pas en compte : quand elle déborde, ses notes ne sont pas encore posées (elles le sont après
le test de débordement, l. ~431). S'il n'y a rien à reporter, ou si la ligne ne tient
toujours pas, on tombe dans le chemin normal `_break_line`, qui renvoie le début du
paragraphe à la page suivante (abandon de la boîte, l. 312-317) ; `remove_placeholders`
reprend alors les notes appelées dans ces lignes, qui partent avec elles. Le cas que
WeasyPrint visait (PR #2437, fix de #2432 : la note du paragraphe lui-même prend la place de
sa 2e ligne) est gardé, et son test `test_footnote_report_orphans` passe.

## 4. Cause (b) : l'état des notes reportées n'est pas sauvegardé par page

`weasyprint/layout/page.py`. WeasyPrint repagine tant qu'un `target-counter` change
(`make_all_pages`, l. ~1040-1076) ; une page « à jour » n'est pas refaite, une page dont le
contenu a changé l'est (`remake_page`). Chaque page démarre en posant les notes reportées par
la précédente (`context.reported_footnotes`, l. ~616-623).

Or `context.reported_footnotes` est **une liste globale** du contexte, alors que tout le reste
de l'état d'une page vit dans `context.page_maker[i]` (resume_at, compteurs, état de
reprise). Quand la repagination saute une page à jour puis refait la suivante, celle-ci lit une
liste qui ne correspond pas à son prédécesseur : la note déjà posée en p. 2 au premier passage
est rejouée en p. 3 au second. Preuve donnée par ce : `max_loops=1` (une seule passe, pas de
repagination) supprime le doublon.

**Correctif posé** (`50-notes-doublon.patch`, vérifié le 03.10.2026) : la liste des notes
reportées en fin de page `i` est copiée dans `remake_state['reported_footnotes']` de
`page_maker[i + 1]` (le tuple garde ses cinq éléments), restaurée au début de
`remake_page(i + 1)`, et **comptée** dans le test « la page suivante a-t-elle changé ? » :
sans ce dernier point, une page refaite qui reporterait d'autres notes laisserait la
suivante « à jour » avec une liste fausse. Effet nul sans repagination. Antécédent amont :
#1700 (57.0), mêmes conditions décrites par liZe ; son correctif (c64eec8) ne traitait que la
fin du document dans `make_all_pages`.

## 5. Ce que touche le patch, et ce qu'il ne touche pas

- (b) : pagination d'un document qui se repagine et qui a une note reportée. Sans note
  reportée, aucune différence. La revue ne se repagine pas : aucun effet attendu.
- (a) : ne change que le cas rare où une note d'un paragraphe antérieur aurait été chassée.
  Ailleurs, aucune différence. Dans ce cas rare, un numéro déjà compilé pourrait sortir avec
  un paragraphe commencé une page plus loin : Robin a fixé une version **medium**, la **3.7.0**.

## 6. Forme des livrables (CLAUDE.md §3)

- `image/patches/weasyprint-70.0/50-notes-doublon.patch` (b) et
  `55-notes-reportees.patch` (a), chacun applicable seul à `--fuzz=0`, à la suite des
  `10`…`40` existants.
- Un cas par patch dans `test/weasyprint-patch-check.py`, dérivé de `min.html`, rouge sur
  WeasyPrint nu, vert sur l'image patchée.
- `image/patches/amont/50-notes-doublon/` et `amont/55-notes-reportees/` (préfixe numéroté,
  comme les autres dossiers amont) : rapport, démo
  (`min.html`), texte d'issue en anglais prêt à déposer. **Non déposé** chez WeasyPrint sans
  Robin.
- Branche `weasyprint-notes`, séparée de `livres-precision`.

## 7. Preuves exigées avant fusion

1. `min.html` avant / après dans l'image reconstruite : note en p. 1 avec son appel, une seule
   fois.
2. Revue : md5 des HTML autonomes et pixels du banc identiques au commit d'avant, sauf un
   article factice construit pour provoquer (a), dont la différence est attendue et listée.
3. FALC et livres : pixels du banc ; seules les pages où une note était déplacée ou doublée
   changent.
4. Suite exigeante, typo-check, veraPDF ua1 sans FAIL.
5. Chaque patch rejoué seul (`--fuzz=0`) et le jeu complet dans l'ordre.

## 8. Publier

Release « lourde » : un changement de `image/` reconstruit le rootfs et n'arrive sur les
postes qu'à la mise à jour de l'image. Version **3.7.0** (medium, décision de Robin ; la 3.6.0 est partie avant), CHANGELOG et
`nouveautes.json` en fr et de. Le superviseur la publie après les preuves du §7.

## 9. Risques et ce qui reste ouvert

- Toucher la logique des notes de WeasyPrint peut décaler d'autres cas limites : le banc
  complet (revue, corpus a11y, livres) est la garde.
- Le patch (a) suppose qu'on sait rattacher une note à sa ligne d'appel : à vérifier dans
  l'API des boîtes 70.0 (l'appel est un `::footnote-call` dans la ligne).
- Montée future de WeasyPrint : vérifier d'abord si l'amont a corrigé, et retirer le patch
  le cas échéant.
