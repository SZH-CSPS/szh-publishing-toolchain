# TODO Kirby CMS : ce qui reste à faire côté site

La Documentation d'un numéro (« Actualité et ressources » / « News & Ressourcen ») est écrite
par Pronto directement sous forme d'arborescence de contenu Kirby : une page par fiche, les
rubriques en champs de la page Documentation, les listes en jetons. Publier doit revenir à
copier ce dossier dans `content/` du site. Ce fichier rassemble ce que Pronto ne fait pas
et que le site Kirby devra reprendre, avec la raison de chaque point.

Décisions de départ (Robin, 23.09.2026) : un seul site Kirby **bilingue** (fr = Revue,
de = Zeitschrift) ; seule la Documentation passe sous Kirby, les articles restent du
markdown pandoc ; pas de brouillons (`_drafts/`), tout ce que Pronto écrit est publié ;
aucune rétrocompatibilité avec l'ancien format des blocs `:::`.

> ⚠ **Avant de reprendre un point, vérifier les champs actuels.** Les noms de champs, les
> listes et leurs jetons cités ici datent du 23.09.2026. La seule source qui fait foi est
> `kirby/champs-documentation.json`, et les blueprints générés à partir de lui dans
> `kirby/site/blueprints/`. Un champ ajouté, renommé ou retiré depuis n'est pas reporté ici :
> comparer chaque point au JSON avant de coder quoi que ce soit côté site.

---

## 1. Page sans fichier de la langue par défaut

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

## 3. Ordre des fiches : ne pas le laisser trier dans le Panel

**Attendu.** Désactiver le tri manuel des fiches dans le Panel (`sortable: false` sur les
sections de pages, à vérifier selon la version de Kirby), et afficher les enfants dans
l'ordre de leur préfixe numérique.

**Pourquoi.** Pronto calcule l'ordre d'impression (interventions : Confédération d'abord,
puis cantons par ordre alphabétique, puis titre ; autres types : titre ; agenda : date de
début) et l'écrit dans le préfixe des dossiers (`1_`, `2_`…). C'est ce qui permet au site
d'avoir l'ordre du PDF sans réimplémenter le tri. Un glisser-déposer dans le Panel casserait
cette garantie, et la synchronisation suivante le défairait sans prévenir.

## 4. Recalculer `curia` quand on édite dans le Panel

**Attendu.** Un hook `page.update:after` (ou un modèle de page) qui recalcule `curia` à
partir de `categorie`, avec la table des instruments du JSON.

**Pourquoi.** `curia` se déduit de la catégorie et ne se saisit jamais. Pronto l'écrit à
l'enregistrement ; une catégorie changée dans le Panel laisserait sinon une valeur périmée.

## 5. Bouton « Synchroniser » / « Publier maintenant »

**Attendu.** Le transport Pronto → Kirby, déclenché à la main depuis Pronto. Au minimum :
copier le dossier Documentation du numéro à sa place dans `content/`, renommer la racine
selon la convention Kirby (`07-documentation` → `7_documentation`), et copier les images
avec leurs fichiers de métadonnées.

**Pourquoi et points à trancher.**
- **Sens unique ou aller-retour ?** Si le Panel sert aussi à corriger une fiche, une
  publication suivante l'écraserait. Il faut soit interdire l'édition dans le Panel pour
  ces pages, soit détecter la modification (date de modification, empreinte) et refuser
  d'écraser.
- **UUID.** Pronto écrit le `Uuid` de chaque page et le garde : c'est l'identité de la
  fiche. Une fiche « envoyée à l'autre revue » est une copie, elle doit recevoir un UUID
  neuf, sinon Kirby verrait deux pages avec le même.
- **Cache d'UUID de Kirby.** À vérifier : un dossier copié hors du Panel est-il pris en
  compte sans vider le cache ?

## 6. Blueprints : générés, jamais édités sur le site

**Attendu.** Déployer `kirby/site/blueprints/` tel quel. Toute modification d'un champ se
fait dans `kirby/champs-documentation.json`, puis on régénère.

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
