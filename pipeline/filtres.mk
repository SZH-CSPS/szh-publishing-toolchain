# Chaînes de filtres Lua de la compilation, déclarées une seule fois. Inclus par
# pipeline/Makefile, donc commun à la revue et au livre (profils/livre.mk).
#
# Une chaîne s'écrit en noms de filtres (pipeline/filters/szh-<nom>.lua), changés en
# --lua-filter en fin de fichier. La partie commune (SOCLE_*) est découpée là où une
# chaîne intercale ses propres filtres : l'ordre commun est ainsi le même partout
# (vérifié par test/js/chaines-filtres.test.js).
#
# Ordre d'un article :
#   contexte -> maquette -> niveaux -> listes-serrees -> tabelle-inclure -> tabelle-scope ->
#   typographie -> titre-lignes -> metafichier -> grille -> image-introuvable -> ressource ->
#   figure -> numerotation -> tableau-boite -> legende-avant -> sections -> auteurs ->
#   citations -> rubrique -> cesure -> exergue -> notes
# Contraintes :
#   * contexte en tête : la langue, le produit et l'unité qu'il pose dans meta sont lus par
#     presque tous les autres ;
#   * titre-lignes juste après typographie : il mesure le titre pour le couper en escalier,
#     et doit le voir avec ses espaces insécables ;
#   * typographie après tabelle-inclure, qui apporte le texte des tableaux, et avant
#     numerotation : « Figure N — » et « Source : » sont de la composition, que la
#     typographie ne doit pas retoucher ;
#   * metafichier après tabelle-inclure (une image Word peut n'être citée que dans un
#     tableau extrait), après typographie (son libellé « IMAGE À REMPLACER » est de la
#     composition), et avant grille et figure, qui doivent encore voir une Image ;
#   * grille avant figure : une grille réduite à une image redevient un paragraphe, dont
#     figure refait une figure dans l'aperçu ;
#   * image-introuvable après metafichier et grille, avant figure : aucune figure vide ne
#     se construit ni ne se numérote ;
#   * numerotation après tabelle-inclure et figure : les tableaux n'existent qu'une fois
#     insérés, et dans l'aperçu (commonmark_x) les figures ne sont construites que par
#     figure ;
#   * legende-avant avant citations : il change les Figure en HTML brut ;
#   * auteurs après sections (son titre ne doit pas être numéroté) et avant citations, qui
#     retire le marqueur .szh-biblio devant lequel le bloc auteurs s'insère ;
#   * citations après sections : le titre de la bibliographie qu'il pose n'est pas numéroté ;
#   * rubrique après sections et citations : son titre h2 ne doit être ni numéroté ni pris
#     pour le titre de la bibliographie, que citations reconnaît à son texte ;
#   * cesure après citations et rubrique, avant notes : ses <span class="szh-sans-cesure">
#     autour des noms propres casseraient l'appariement des citations, qui se fait sur le
#     texte ; avant notes, pour traiter aussi le texte des notes ;
#   * exergue tard, pour qu'aucun filtre ne reconstruise ensuite le bloc qu'il masque au
#     lecteur d'écran ;
#   * notes à la fin : les Note deviennent des Span « szh-note » à la sortie seulement.
# L'aperçu reprend la même suite sans maquette ni exergue : on y relit l'exergue.
#
# Chapitre de livre : les filtres communs gardent l'ordre de l'article.
#   Absents :
#   * maquette et titre-lignes : couverture et en-tête d'un article, qu'un chapitre n'a pas ;
#   * auteurs : remplacé par livre-auteurs, la ligne d'auteurs sous le titre ;
#   * ressource et rubrique : formats de la Documentation de la revue. Un
#     ::: {.szh-ressource …} dans un chapitre passe tel quel.
#   Ajoutés :
#   * livre-titre, en tête : le <h1> vient de la fiche <slug>.meta.yaml, et niveaux et
#     numerotation doivent le voir ;
#   * sauts-uniques, juste après : un seul saut de ligne à la fois (lecture FALC) ;
#   * livre-sous-titre, deux fois : avant typographie pour que le sous-titre en profite,
#     puis après livre-entete pour le placer sous le titre ;
#   * livre-entete-image, avant figure : l'image d'un falc-header n'est pas numérotée ;
#   * livre-auteurs et livre-entete, à la place d'auteurs ;
#   * qr, en dernier : il change un Link en HTML brut (<a><svg>…) que typographie et cesure
#     ne doivent pas parcourir.
#   Lus autrement sous SZH_LIVRE :
#   * niveaux laisse le <h1> du chapitre et ne compacte le corps qu'à partir de <h2> ;
#   * numerotation numérote figures et tableaux en continu sur le volume (SZH_CHAPITRE,
#     SZH_COMPTEURS ; voir COMPTEURS_DIR dans livre.mk) ;
#   * sections préfixe les sections du numéro du chapitre (2.1).
#   La bibliographie reste celle de chaque chapitre.
#
# `filter-out` retire toutes les occurrences d'un nom : il ne doit pas viser
# livre-sous-titre, présent deux fois.

# La partie commune, en tronçons, dans l'ordre.
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
# Comme pour l'article, l'aperçu garde l'exergue lisible.
CHAINE_CHAPITRE_APERCU := $(filter-out exergue,$(CHAINE_CHAPITRE))
# EPUB : une liseuse ne connaît pas `float: footnote`, et le texte des notes se lirait au
# milieu de la phrase. Sans szh-notes, le writer epub3 de pandoc en fait des notes de fin
# liées.
CHAINE_CHAPITRE_EPUB := $(filter-out notes,$(CHAINE_CHAPITRE))

# Noms -> arguments de pandoc.
lua_filtres = $(foreach f,$(1),--lua-filter="$(PIPELINE_DIR)/filters/szh-$(f).lua")

FILTRES_SOCLE           := $(call lua_filtres,$(CHAINE_SOCLE))
FILTRES_ARTICLE         := $(call lua_filtres,$(CHAINE_ARTICLE))
FILTRES_APERCU          := $(call lua_filtres,$(CHAINE_APERCU))
FILTRES_CHAPITRE        := $(call lua_filtres,$(CHAINE_CHAPITRE))
FILTRES_CHAPITRE_APERCU := $(call lua_filtres,$(CHAINE_CHAPITRE_APERCU))
FILTRES_CHAPITRE_EPUB   := $(call lua_filtres,$(CHAINE_CHAPITRE_EPUB))
