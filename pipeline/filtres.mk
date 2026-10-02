# Chaînes de filtres Lua de la compilation, déclarées ici une seule fois. Inclus par
# pipeline/Makefile, donc lu par la revue comme par le livre (profils/livre.mk).
#
# Les chaînes s'écrivent en noms de filtres (pipeline/filters/szh-<nom>.lua), puis
# deviennent des arguments --lua-filter en fin de fichier. Le socle est découpé en
# tronçons aux endroits où une chaîne intercale ses propres filtres : chaque chaîne
# concatène les tronçons dans l'ordre, et l'ordre relatif du socle ne peut donc pas
# diverger d'une chaîne à l'autre (test/js/chaines-filtres.test.js le vérifie).
#
# Ordre des --lua-filter d'un article, et ce qui casse si on permute :
#   szh-contexte -> szh-maquette -> szh-niveaux -> szh-listes-serrees -> szh-tabelle-inclure ->
#   szh-tabelle-scope -> szh-typographie -> szh-titre-lignes -> szh-metafichier ->
#   szh-grille -> szh-image-introuvable -> szh-ressource -> szh-figure -> szh-numerotation ->
#   szh-tableau-boite -> szh-legende-avant -> szh-sections -> szh-auteurs ->
#   szh-citations -> szh-rubrique -> szh-cesure -> szh-exergue -> szh-notes
#   * szh-contexte en tête : la langue, le produit et l'unité qu'il pose dans meta sont lus
#     par presque tous les autres, szh-maquette compris ;
#   * szh-titre-lignes juste après szh-typographie : il MESURE le titre pour le couper en
#     escalier (première ligne plus courte que la deuxième), et doit donc voir le titre
#     tel qu'il s'imprimera — insécables et mots outils soudés compris, ce que
#     szh-typographie vient de poser. Avant lui, il mesurerait un titre qui n'existe pas ;
#   * szh-numerotation après szh-tabelle-inclure : il numérote des tableaux qui
#     n'existent qu'une fois le HTML réinjecté ;
#   * szh-typographie après szh-tabelle-scope et avant szh-numerotation : après, parce
#     que le texte des tableaux n'arrive qu'avec szh-tabelle-inclure, en RawBlock html ;
#     avant, parce que ce filtre ne normalise que le texte de la rédaction — le
#     « Figure N — » et le « Source : » que la maquette compose ensuite sont des
#     décisions de composition, pas des fautes de frappe, et lui passer dessus les
#     déferait ;
#   * szh-metafichier après szh-tabelle-inclure et après szh-typographie, avant szh-grille :
#     après tabelle-inclure, parce qu'une image native Word peut n'être citée que dans un
#     tableau extrait, invisible depuis le .md (le chapitre 09 du VN-FALC citait ainsi
#     fig-73) ; après typographie, parce que le libellé « IMAGE À REMPLACER » qu'il pose est
#     une décision de composition et non du texte de rédaction ; avant grille et figure,
#     qui doivent continuer de voir une Image ordinaire — la substitution ne change que la
#     cible et le texte alternatif, jamais la nature du nœud ;
#   * szh-grille avant szh-figure : une grille tombée à une seule image se dissout en
#     paragraphe, et c'est szh-figure qui en refait une figure sous le lecteur de
#     l'aperçu ;
#   * szh-image-introuvable après szh-metafichier et szh-grille, avant szh-figure : le
#     substitut d'une image native existe, une grille voit encore toutes ses images, et
#     aucune figure vide ne se construit ni ne se numérote ;
#   * szh-numerotation après szh-figure : sous le lecteur commonmark_x de l'aperçu,
#     les Figure ne sont construites que par szh-figure ;
#   * szh-legende-avant avant szh-citations : il dissout les Figure en HTML brut, rien
#     en amont ne peut plus les lire ;
#   * szh-auteurs entre les deux derniers : après szh-sections, sinon le titre du bloc
#     auteurs recevrait un numéro de section ; avant szh-citations, qui dissout le
#     marqueur .szh-biblio devant lequel le bloc doit s'insérer — les références ferment
#     l'article, rien ne les suit ;
#   * szh-rubrique après szh-sections et après szh-citations, deux raisons qui se
#     cumulent : il pose un h2 (le titre de la rubrique, déduit du type), or szh-sections
#     numéroterait ce titre — « 1 Références du dossier » — et szh-citations reconnaît le
#     titre de la bibliographie sur son texte, si bien qu'un « Références du dossier » ou
#     un « Literatur zum Schwerpunkt » posé avant lui se ferait prendre pour la
#     bibliographie de l'article. Le contenu du bloc, lui, est du markdown ordinaire lu par
#     pandoc : tous les filtres d'amont l'ont déjà traité, celui-ci ne fait que l'envelopper ;
#   * szh-cesure en avant-dernier, et surtout APRÈS szh-citations : il enveloppe les noms
#     propres français dans un <span class="szh-sans-cesure"> pour les soustraire à la
#     césure automatique, et szh-citations apparie les appels de citation et reconnaît le
#     titre de la bibliographie SUR LE TEXTE — un span posé avant lui casserait
#     l'appariement. Après szh-rubrique aussi, dont le contenu est du markdown analysé
#     tardivement et qui doit être protégé comme le reste du corps ; avant szh-notes, pour
#     que le texte des notes le soit également, les Note étant encore des Note à ce stade ;
#   * szh-notes tout à la fin : les Note traversent la chaîne inchangées et ne
#     deviennent des Spans « szh-note » qu'à la sortie, si bien qu'aucun filtre en
#     amont ne change de comportement ;
#   * szh-citations après szh-sections : c'est lui qui pose le titre de la
#     bibliographie, et une bibliographie ne porte pas de numéro de section. szh-sections
#     ayant fini de numéroter, ce titre-là n'en reçoit pas. L'ordre inverse — celui d'avant
#     que la bibliographie devienne un fichier — imprimait « 6 Références ».
#   * szh-exergue tard, pour qu'aucun filtre ne rebâtisse après lui le bloc dont il
#     masque la mise en évidence au lecteur d'écran ; place indifférente sinon ;
# La chaîne d'aperçu reprend la même suite, sans szh-maquette ni szh-exergue : l'aperçu
# sert à relire son article, exergue comprise.
#
# ⚠ Écarts de la chaîne d'un chapitre avec celle d'un article, à ne pas découvrir en
#   production. Les filtres communs gardent l'ordre de la revue.
#   Absents du chapitre :
#   * szh-maquette.lua et szh-titre-lignes.lua : ils composent la couverture et l'en-tête
#     courant d'un article, qu'un chapitre n'a pas (buch.yaml et le gabarit du livre s'en
#     chargent) ;
#   * szh-auteurs.lua : remplacé par szh-livre-auteurs.lua, la ligne d'auteur·e·s sous le
#     titre du chapitre ;
#   * szh-ressource.lua et szh-rubrique.lua : les fiches et les rubriques sont des formats
#     de la Documentation de la revue, sans équivalent pensé pour un livre ; un
#     ::: {.szh-ressource …} écrit dans un chapitre traverserait tel quel, non composé.
#   Ajoutés au chapitre :
#   * szh-livre-titre.lua, en tête : le <h1> vient de la fiche <slug>.meta.yaml, et les
#     filtres de niveaux et de numérotation doivent le voir ;
#   * szh-sauts-uniques.lua, juste après : un saut de ligne, jamais deux (lecteur FALC) ;
#   * szh-livre-sous-titre.lua, deux fois, exprès : avant szh-typographie pour que le
#     sous-titre passe par la typographie maison, puis après szh-livre-entete pour le poser
#     sous le titre (voir l'en-tête du filtre) ;
#   * szh-livre-entete-image.lua, avant szh-figure : soustrait l'image d'un falc-header à
#     la numérotation des figures ;
#   * szh-livre-auteurs.lua et szh-livre-entete.lua, à la place de szh-auteurs.lua ;
#   * szh-qr.lua, en tout dernier : une fois le Link changé en RawInline (<a><svg>…), aucun
#     filtre suivant n'a de raison d'y toucher — le poser plus tôt exposerait ce balisage
#     aux passes de typographie et de coupure de mots, qui parcourent les Str et les Link
#     du document entier. Voir l'en-tête de szh-qr.lua.
#   Communs, mais lus autrement sous SZH_LIVRE :
#   * szh-niveaux.lua laisse le <h1> du chapitre où il est et ne compacte que le corps, à
#     partir de <h2> : un manuscrit qui passe de « # » à « ### » sortait sinon un PDF non
#     conforme PDF/UA-1 ;
#   * szh-numerotation.lua lit SZH_CHAPITRE et les reports de SZH_COMPTEURS : figures et
#     tableaux sont numérotés en continu sur le volume (voir COMPTEURS_DIR dans livre.mk) ;
#   * szh-sections.lua lit SZH_CHAPITRE : les sections portent le numéro du chapitre (2.1).
#   Hors filtres : la bibliographie est celle de chaque chapitre. Un ouvrage collectif la
#   veut ainsi ; une monographie la veut en fin de volume.
#
# ⚠ `filter-out` retire toutes les occurrences d'un nom : il ne doit jamais viser
#   livre-sous-titre, appelé deux fois.

# Le socle, en tronçons, dans l'ordre. szh-contexte ouvre chaque chaîne : il pose la langue,
# le produit et l'unité que les filtres suivants relisent dans meta.
SOCLE_CONTEXTE  := contexte
SOCLE_ENTREE    := niveaux listes-serrees tabelle-inclure tabelle-scope
SOCLE_TYPO      := typographie
SOCLE_IMAGES    := metafichier grille image-introuvable
SOCLE_NUMEROS   := figure numerotation tableau-boite legende-avant sections
SOCLE_CITATIONS := citations
SOCLE_SORTIE    := cesure exergue notes
CHAINE_SOCLE    := $(SOCLE_CONTEXTE) $(SOCLE_ENTREE) $(SOCLE_TYPO) $(SOCLE_IMAGES) $(SOCLE_NUMEROS) \
                   $(SOCLE_CITATIONS) $(SOCLE_SORTIE)

CHAINE_ARTICLE := $(SOCLE_CONTEXTE) maquette $(SOCLE_ENTREE) $(SOCLE_TYPO) titre-lignes $(SOCLE_IMAGES) \
                  ressource $(SOCLE_NUMEROS) auteurs $(SOCLE_CITATIONS) rubrique $(SOCLE_SORTIE)
CHAINE_APERCU  := $(filter-out maquette exergue,$(CHAINE_ARTICLE))

CHAINE_CHAPITRE := $(SOCLE_CONTEXTE) livre-titre sauts-uniques $(SOCLE_ENTREE) livre-sous-titre $(SOCLE_TYPO) \
                   livre-entete-image $(SOCLE_IMAGES) $(SOCLE_NUMEROS) livre-auteurs \
                   livre-entete livre-sous-titre $(SOCLE_CITATIONS) $(SOCLE_SORTIE) qr
# L'aperçu d'un chapitre sert à le relire, et doit donc faire entendre l'exergue (même
# choix que l'aperçu de la revue).
CHAINE_CHAPITRE_APERCU := $(filter-out exergue,$(CHAINE_CHAPITRE))
# La variante EPUB : sur une liseuse, le `float: footnote` qui descend la note en pied de
# page n'existe pas, et son texte se lirait au milieu de la phrase ; sans szh-notes, les
# Note traversent intactes et le writer epub3 de pandoc en fait de vraies notes de fin,
# liées et navigables.
CHAINE_CHAPITRE_EPUB := $(filter-out notes,$(CHAINE_CHAPITRE))

# Noms -> arguments de pandoc.
lua_filtres = $(foreach f,$(1),--lua-filter="$(PIPELINE_DIR)/filters/szh-$(f).lua")

FILTRES_SOCLE           := $(call lua_filtres,$(CHAINE_SOCLE))
FILTRES_ARTICLE         := $(call lua_filtres,$(CHAINE_ARTICLE))
FILTRES_APERCU          := $(call lua_filtres,$(CHAINE_APERCU))
FILTRES_CHAPITRE        := $(call lua_filtres,$(CHAINE_CHAPITRE))
FILTRES_CHAPITRE_APERCU := $(call lua_filtres,$(CHAINE_CHAPITRE_APERCU))
FILTRES_CHAPITRE_EPUB   := $(call lua_filtres,$(CHAINE_CHAPITRE_EPUB))
