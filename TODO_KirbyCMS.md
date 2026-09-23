# TODO Kirby CMS : ce qui reste à faire côté site

La Documentation d'un numéro (« Actualité et ressources » / « News & Ressourcen ») est écrite
par Pronto directement sous forme de contenu Kirby : une bibliothèque unique
`_NewsUndActu\Fiches\` (voir docs/FORMAT-DOCUMENTATION-KIRBY.md), une page par fiche, un
fichier par langue, les listes en jetons. Publier doit revenir à copier ce dossier dans
`content/` du site. Les rubriques de texte libre restent dans le numéro et ne partent jamais
sur le site. Ce fichier rassemble ce que Pronto ne fait pas
et que le site Kirby devra reprendre, avec la raison de chaque point.

Décisions de départ (Robin, 23.09.2026) : un seul site Kirby **bilingue** (fr = Revue,
de = Zeitschrift) ; seule la Documentation passe sous Kirby, les articles restent du
markdown pandoc ; pas de brouillons (`_drafts/`), tout ce que Pronto écrit est publié ;
aucune rétrocompatibilité avec l'ancien format des blocs `:::`.

> ⚠ **Avant de reprendre un point, vérifier les champs actuels.** Les noms de champs, les
> listes et leurs jetons cités ici datent du 23.09.2026. La seule source qui fait foi est
> `pipeline/kirby/champs-documentation.json`, et les blueprints générés à partir de lui dans
> `kirby/site/blueprints/`. Un champ ajouté, renommé ou retiré depuis n'est pas reporté ici :
> comparer chaque point au JSON avant de coder quoi que ce soit côté site.

---

## 1. Page sans fichier de la langue par défaut

**Mesuré le 23.09.2026** sur Kirby 5.6.0 (dépôt local `szh-kirby-demo-news`, fr par défaut) :
- fiche en `.de.txt` seulement : s'affiche normalement sous `/de/…` et dans son numéro
  allemand ; sous `/fr/…` la page répond 200 avec des champs vides (aucun repli) ;
- fiche en `.fr.txt` seulement : sous `/de/…` Kirby affiche le texte FRANÇAIS tel quel,
  sans avertissement (repli sur la langue par défaut). Elle n'entre pas dans un numéro
  allemand (son `Ausgabe` de repli est l'id d'un numéro de la Revue), mais une page
  bibliothèque qui liste toutes les fiches la montrerait en français sous `/de/` ;
- `$page->translation('fr')->exists()` répond vrai même sans fichier : tester la présence
  du fichier sur le disque.
Il reste à décider si les pages de la bibliothèque doivent masquer une fiche sans fichier
dans la langue affichée (recommandé).

**Attendu.** Vérifier sur une vraie instance Kirby qu'une fiche de la Zeitschrift, qui
n'existe qu'en `livre.de.txt`, s'affiche et se liste correctement quand la langue par
défaut du site est le français.

**Pourquoi.** Pronto écrit une fiche dans la langue de la revue qui la porte, et dans
celle-là seulement : une fiche de la Revue n'a pas de pendant allemand, et l'inverse. Or la
documentation de Kirby demande qu'un fichier de la langue par défaut existe toujours
(« Otherwise Kirby will not be able to provide a fallback for missing translations »).
Si Kirby refuse ou masque ces pages, il faudra choisir : écrire un fichier minimal de la
langue par défaut, ou séparer Revue et Zeitschrift en deux arbres dont chacun a sa propre
langue par défaut. Ce choix change les noms de fichiers qu'écrit Pronto : il vit dans une
seule constante côté cockpit.

## 2. Gabarits PHP de la Documentation

**Attendu.** Les templates et snippets du site qui affichent une page Documentation et ses
fiches, en reproduisant ce que le PDF imprime :

- **Texte des liens.** Si `lien_libelle` est vide, le lien s'intitule d'après le type et le
  titre (« En savoir plus sur le livre … » / « Mehr zum Buch … »). Les formules par type et
  par langue sont dans le JSON (`libelleLien`) : le gabarit doit les lire, pas les recopier.
- **Pastille de catégorie** sur chaque livre et chaque film (libellé fr/de pris du JSON).
- **Dates.** Stockées en ISO, affichées en forme suisse (`05.01.2026`) ; dates partielles
  des recherches (`2026`, `2026-03`) ; plage fondue de l'agenda (`05.–06.01.2026`).
- **Suivi d'une intervention** (champ structure `suivi`) : imprimé, avec la formule de son
  genre (« répond à », « en complément à »…), comme dans le PDF.
- **Canton du tour d'horizon** affiché seulement si `portee = regional`.
- `curia` et `source` ne s'affichent pas : ce sont des données de travail.

**Pourquoi.** Le PDF et le site doivent dire la même chose. Toute règle d'affichage recopiée
à la main en PHP finira par diverger de celle des filtres Lua : c'est pour cela que libellés
et formules vivent dans le JSON, que le site doit lire tel quel.

## 3. Rattachement et ordre : les champs `Ausgabe` et `Ordre`

**Attendu.** Une page de numéro liste les fiches dont le fichier de SA langue porte
`Ausgabe: <id du numéro>` (l'id de son `ausgabe.yaml`, 16 caractères, réutilisable comme Uuid
de la future page de numéro), triées par le champ `Ordre`. Les dossiers de fiches n'ont pas
de préfixe numérique (pages non listées au sens de Kirby) : ne pas les filtrer par
`listed()`. Désactiver le tri manuel dans le Panel.

Depuis `docs(kirby): un dossier par type sous Fiches` (23.09.2026), une fiche n'est plus un
enfant direct de la bibliothèque : `content/actualites/` porte maintenant sept pages dossier,
une par `types[].dossier` (`rundschau`, `forschung`, `vorstoesse`, `buecher`, `filme`,
`revueblick`, `weiterbildung` — gabarit = nom du dossier, voir
`kirby/LISEZMOI.md`), et les fiches sont leurs enfants. Une page de numéro qui veut TOUTES ses
fiches, tous types confondus, doit donc descendre un niveau de plus qu'avant (les petits-
enfants de la page dossier), par exemple `$actualites->children()->children()`, plutôt que de
lire `$actualites->children()` directement. Le filtre `Ausgabe: <id>` et le tri par `Ordre`
restent inchangés, ils s'appliquent toujours à la fiche elle-même.

**Pourquoi.** Pronto calcule l'ordre d'impression (interventions : Confédération d'abord,
puis cantons par ordre alphabétique, puis titre ; autres types : titre ; agenda : date de
début) et l'écrit dans le champ `Ordre` de chaque fichier de langue. C'est ce qui permet au
site d'avoir l'ordre du PDF sans réimplémenter le tri ; un même dossier a deux ordres, un par
langue, puisqu'il appartient à un numéro de chaque revue. Un glisser-déposer dans le Panel casserait
cette garantie, et la synchronisation suivante le défairait sans prévenir.

## 4. Recalculer `curia` quand on édite dans le Panel

**Attendu.** Un hook `page.update:after` (ou un modèle de page) qui recalcule `curia` à
partir de `categorie`, avec la table des instruments du JSON.

**Pourquoi.** `curia` se déduit de la catégorie et ne se saisit jamais. Pronto l'écrit à
l'enregistrement ; une catégorie changée dans le Panel laisserait sinon une valeur périmée.

## 5. Bouton « Synchroniser » / « Publier maintenant »

**Attendu.** Le transport Pronto → Kirby, déclenché à la main depuis Pronto. Au minimum :
copier `_NewsUndActu\Fiches\` dans `content/` (par exemple `content/actualites/`), images
comprises. Jamais `_NewsUndActu\_Statuts\` (décisions de traduction, données de travail) ni
les rubriques des numéros. Une fiche orpheline (`Ausgabe` vide) est copiée mais n'apparaît
dans aucun numéro.

Chaque dossier de type (`rundschau\`, `forschung\`, `vorstoesse\`, `buecher\`, `filme\`,
`revueblick\`, `weiterbildung\`) devient lui-même une page Kirby sous `content/actualites/`,
PARENTE des fiches qu'il contient (`kirby/LISEZMOI.md`, blueprints `pages/<dossier en
minuscules>.yml`). Pronto n'écrit que des fiches dans `Fiches\<dossier>\<slug>\` : il n'a
aucune raison d'écrire le fichier de contenu de la page dossier elle-même. C'est donc à la
synchronisation, pas à Pronto, de créer — si absent — le fichier de contenu de chaque page
dossier, `<gabarit>.fr.txt` et `<gabarit>.de.txt` (`<gabarit>` = le dossier en minuscules,
ex. `buecher.fr.txt`), avec pour seul contenu utile `Title: <types[].libelle de la langue>`.
Une fois créé, ce fichier n'a plus besoin d'être réécrit (le libellé du type ne change pas).

**Pourquoi et points à trancher.**
- **Sens unique ou aller-retour ?** Si le Panel sert aussi à corriger une fiche, une
  publication suivante l'écraserait. Il faut soit interdire l'édition dans le Panel pour
  ces pages, soit détecter la modification (date de modification, empreinte) et refuser
  d'écraser.
- **UUID.** Pronto écrit le `Uuid` de chaque page et le garde : c'est l'identité de la
  fiche, la même dans ses deux fichiers de langue (une traduction n'est pas une copie).
- **Cache d'UUID de Kirby.** À vérifier : un dossier copié hors du Panel est-il pris en
  compte sans vider le cache ?

## 6. Blueprints : générés, jamais édités sur le site

**Attendu.** Déployer `kirby/site/blueprints/` tel quel. Toute modification d'un champ se
fait dans `pipeline/kirby/champs-documentation.json`, puis on régénère.

**Pourquoi.** Le JSON alimente aussi le formulaire de Pronto, le convertisseur et les filtres
du PDF. Un blueprint retouché à la main sur le site divergerait des trois en silence.

**À vérifier** sur la version de Kirby retenue (4 ou 5) : la syntaxe des options traduites
(`options: { jeton: { fr: …, de: … } }`), de `when`, de `pattern`, et le mode de stockage du
champ fichiers (`store: uuid` ou `store: id`).

## 7. Markdown des rubriques : rester dans le sous-ensemble commun

**Attendu.** Contrôler que les rubriques (`dossier_references`, `dossier_liens`,
`ressources`, `podcasts`) se rendent pareil par pandoc et par KirbyText.

**Pourquoi.** Pronto les compile avec pandoc, Kirby les rend avec son propre parseur
markdown. Le formulaire limite déjà la saisie à l'italique, au gras, aux liens, aux listes et
aux intertitres, mais deux pièges restent à mesurer : une syntaxe propre à pandoc collée à la
main (attributs `{.classe}`, notes `^[…]`), et un texte entre parenthèses que KirbyText
prendrait pour un kirbytag (`(link: …)`, `(date: …)`).

## 8. Rubrique « Ressources » : Revue seulement

**Attendu.** Sur un site bilingue, le champ `ressources` existe dans le blueprint pour les
deux langues. Le masquer, ou le laisser vide et ne rien afficher, côté allemand.

**Pourquoi.** La rubrique n'existe que dans la Revue. Pronto ne la propose pas pour la
Zeitschrift, mais le Panel, lui, ne sait pas de quelle revue est une page.

## 9. Typographie maison sur le web : non traitée, assumé

**Constat.** Les douze règles typographiques (espaces insécables, guillemets…, voir
`docs/TYPOGRAPHIE.md`) s'appliquent à la compilation du PDF et jamais au texte source. Le
site affichera donc le texte brut. Décision de Robin (23.09.2026) : on laisse ainsi. Si
cela change un jour, il faudra porter les règles en PHP (hook KirbyText), avec des règles
opposées pour le français et l'allemand.

## 10. Images des fiches

**Attendu.** Afficher la couverture d'un livre ou l'affiche d'un film comme **décorative** :
`alt=""`, pas de légende.

**Pourquoi.** C'est le parti du PDF (PDF/UA) : l'image double le titre, qu'un lecteur d'écran
lit déjà. Le champ s'appelle `couverture` et pas `image`, qui est une méthode réservée de
Kirby.
