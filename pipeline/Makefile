# Compilation d'un numéro : .md -> pandoc -> WeasyPrint -> PDF et HTML, une sortie par
# article. Se lance depuis le dossier du numéro :
#   wsl.exe -d SZH-Publishing --cd <dossier revue> -- make -f <toolkit>/pipeline/Makefile all
#
# Entrées : articles/<slug>/<slug>.md et media/. Sorties : out/<slug>/<slug>.pdf et .html.
# Les Word déposés dans articles-word/ (.docx, ou .odt converti) passent par import-docx.sh.
# Le Word corrigé d'un article déjà importé passe par la cible `reimporter`.
# Les chaînes de filtres Lua et leur ordre : pipeline/filtres.mk.
#
# Aucun chemin /mnt/c en dur (portabilité macOS). Indentation par tabulations, fins de
# ligne LF.

SHELL      := /bin/bash
PANDOC     ?= pandoc
WEASYPRINT ?= weasyprint
# Validateur PDF/UA. veraPDF est en Java ; l'image embarque un runtime réduit (jlink) dans
# /opt/jre-min, d'où le JAVA_HOME explicite. Surchargeables depuis l'environnement.
VERAPDF      ?= /opt/verapdf-cli/verapdf
VERAPDF_JAVA ?= /opt/jre-min

# Chemin absolu de ce Makefile : la cible `all` se relance par -f $(THIS).
THIS         := $(abspath $(lastword $(MAKEFILE_LIST)))
PIPELINE_DIR := $(patsubst %/,%,$(dir $(THIS)))

# Polices et variables :root communes à toutes les sorties. Toujours celle du toolkit, même
# quand la revue a son propre styles/print.css, qui hérite ainsi des variables. Chargée en
# premier.
SOCLE      := $(PIPELINE_DIR)/styles/socle.css
SOCLE_ABS  := $(abspath $(SOCLE))

# Style de la revue s'il existe (styles/print.css), sinon style central du toolkit.
STYLE      := $(firstword $(wildcard styles/print.css) $(PIPELINE_DIR)/styles/print.css)
STYLE_ABS  := $(abspath $(STYLE))

# Styles du balisage posé par les filtres Lua communs à la revue et au livre (grille
# d'images, image décorative, appel de citation…). Chargée après print.css pour l'emporter à
# spécificité égale : sinon `a[href]::after` de la maquette ajoute une flèche de lien
# externe à l'icône ORCID (`a.szh-orcid::after`).
PARTAGE     := $(PIPELINE_DIR)/styles/partage-filtres.css
PARTAGE_ABS := $(abspath $(PARTAGE))

# Gabarit pandoc de l'article. szh-maquette.lua, en tête de FILTRES_ARTICLE, en dérive les
# métadonnées de couverture et d'en-tête (étiquette de dossier, nom et ISSN).
TEMPLATE     := $(PIPELINE_DIR)/templates/szh-article.html
TEMPLATE_ABS := $(abspath $(TEMPLATE))
# Tous les filtres Lua sont prérequis des rendus : en modifier un recompile.
FILTRES      := $(wildcard $(PIPELINE_DIR)/filters/*.lua)
# Inclus avant profils/livre.mk, qui s'en sert.
include $(PIPELINE_DIR)/filtres.mk

# Convertisseur de la Documentation Kirby (arborescence -> markdown) et la description des
# champs qu'il partage avec szh-ressource.lua et szh-rubrique.lua.
DOC_CONVERTISSEUR := $(PIPELINE_DIR)/documentation-kirby.py
DOC_CHAMPS_JSON   := $(PIPELINE_DIR)/kirby/champs-documentation.json

# Les fiches d'une Documentation vivent hors du numéro, dans la bibliothèque partagée
# _NewsUndActu/Fiches/<dossier du type>/<slug>/ (docs/FORMAT-DOCUMENTATION-KIRBY.md).
# Sa racine vient de SZH_NEWS_RACINE (tests), sinon de documentation-kirby.py, qui la
# trouve depuis le dossier courant.
# Seul documentation-kirby.py sait quelles fiches concernent ce numéro (champ Ausgabe) :
# toute la bibliothèque est donc prérequis de la Documentation. Si la racine est
# introuvable, DOC_FICHES est vide, et une fiche modifiée ne recompile rien : toucher
# l'article ou faire `make clean`.
NEWS_RACINE := $(strip $(or $(SZH_NEWS_RACINE),$(shell python3 "$(DOC_CONVERTISSEUR)" --imprimer-racine-news 2>/dev/null)))
DOC_FICHES  := $(wildcard $(NEWS_RACINE)/_NewsUndActu/Fiches/*/*/*.txt) $(wildcard $(NEWS_RACINE)/_NewsUndActu/Fiches/*/*/*.png) $(wildcard $(NEWS_RACINE)/_NewsUndActu/Fiches/*/*/*.jpg) $(wildcard $(NEWS_RACINE)/_NewsUndActu/Fiches/*/*/*.jpeg) $(wildcard $(NEWS_RACINE)/_NewsUndActu/Fiches/*/*/*.gif) $(wildcard $(NEWS_RACINE)/_NewsUndActu/Fiches/*/*/*.svg)

# ---------------------------------------------------------------------------
# Profil de compilation du dossier, lu dans ausgabe.yaml par szh-lire-config.lua (pandoc
# lua : l'image n'a pas PyYAML). Le même lecteur sert à livre.mk et à exiger_titre.
LIRE_CONFIG := $(PIPELINE_DIR)/filters/szh-lire-config.lua
# Le script rend une chaîne vide dans deux cas : clé `profil:` absente (code 1, compiler
# en article) ou présente sans valeur (code 0, aucun document). La présence se lit donc
# sur le code de sortie.
PROFIL_PRESENT := $(shell $(PANDOC) lua $(LIRE_CONFIG) ausgabe.yaml profil >/dev/null 2>&1 && echo 1 || echo 0)
# La valeur s'arrête au premier caractère hors [a-zA-Z-] (espace, commentaire, CR). Une
# valeur inattendue tombe dans « profil inconnu », qui échoue avec un message.
PROFIL_LU      := $(shell $(PANDOC) lua $(LIRE_CONFIG) ausgabe.yaml profil 2>/dev/null | sed -E 's/^([a-zA-Z-]*).*/\1/')
PROFIL         := $(strip $(PROFIL_LU))
# Vide si la clé est absente (ou 0 occurrence) ; non vide sinon.
PROFIL_DECLARE := $(filter-out 0,$(PROFIL_PRESENT))

# Un dossier qui contient buch.yaml est un livre (un livre n'a pas d'ausgabe.yaml).
LIVRE_CONFIG := $(wildcard buch.yaml)

# Route de la cible `all`, résolue à la lecture : `make -n all` la montre sans rien
# exécuter. buch.yaml l'emporte sur un éventuel ausgabe.yaml.
ifneq ($(LIVRE_CONFIG),)
PROFIL_ROUTE := livre
else ifeq ($(PROFIL_DECLARE),)
PROFIL_ROUTE := article
else ifeq ($(PROFIL),)
PROFIL_ROUTE := rien
else
PROFIL_ROUTE := $(PROFIL)
endif
# ---------------------------------------------------------------------------

# Articles : un dossier par article, articles/<slug>/<slug>.md.
SLUGS_MD   := $(sort $(foreach d,$(wildcard articles/*),$(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
# Article Documentation (arborescence Kirby, docs/FORMAT-DOCUMENTATION-KIRBY.md) : reconnu à
# la présence de documentation.fr.txt ou documentation.de.txt dans son dossier.
DOC_SLUGS  := $(sort $(foreach d,$(wildcard articles/*),$(if $(or $(wildcard $(d)/documentation.fr.txt),$(wildcard $(d)/documentation.de.txt)),$(notdir $(d)))))
SLUGS      := $(sort $(SLUGS_MD) $(DOC_SLUGS))
OUT        := out
PDFS       := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).pdf)
HTMLS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).html)
# Aperçu HTML cliquable, compilé à part en commonmark_x+sourcepos. Ce lecteur ajoute des
# div d'enveloppe : il ne nourrit pas WeasyPrint, le PDF reste en -f markdown.
APERCUS    := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).apercu.html)
# Galleys DOCX de l'export OJS, produits seulement par la cible `docx`.
DOCXS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).docx)

# Couleur d'accent des tableaux : accent-css.py lit la couleur annuelle d'ausgabe.yaml et
# écrit un :root qui remplace les gris de print.css. Sans couleur, le fichier ne contient
# qu'un commentaire et les gris restent. Prérequis des HTML.
ACCENT_CSS := $(OUT)/.szh-accent.css
ACCENT_ABS := $(abspath $(ACCENT_CSS))

# Pagination continue du numéro. `.szh-pagination.json` (départ et nombre de pages de
# chaque article) vit dans le dossier du numéro, hors de out/, pour survivre à `make clean`
# et à l'archivage. Les feuilles de folio en découlent et sont régénérées dès qu'il change.
# Sans cela, un `clean` remettrait tous les folios à 1 sans que rien ne le signale : le
# nombre de pages d'un article recompilé ne change pas.
PAGINATION      := $(PIPELINE_DIR)/pagination.py
PAGINATION_ETAT := $(wildcard .szh-pagination.json)
# Python du venv WeasyPrint, le seul de l'image qui a pypdf, lu sur la première ligne du
# script `weasyprint`. Repli sur python3 : pagination.py retrouve alors pypdf lui-même,
# environ sept fois plus lentement.
PYTHON_PAGINATION := $(or $(shell sed -n '1s/^\#!//p' "$$(command -v weasyprint 2>/dev/null)" 2>/dev/null),python3)
# Vide tant que le numéro n'a jamais été paginé.
FOLIOS          := $(if $(PAGINATION_ETAT),$(OUT)/.szh-folios)

# Sans ceci, make considérerait les .html comme intermédiaires et les supprimerait.
.SECONDARY: $(HTMLS) $(APERCUS)

# .szh-apercu : une ligne écrite par le cockpit, « <slug> html|pdf », qui nomme l'article
# affiché. Sa cible passe en tête des prérequis de `pdf` : sous -j, c'est l'ordre de
# lancement. Le slug est filtré sur $(SLUGS) pour qu'aucun contenu de ce fichier ne
# devienne une cible arbitraire.
APERCU_ETAT := $(shell head -n 1 .szh-apercu 2>/dev/null)
APERCU_SLUG := $(filter $(SLUGS),$(word 1,$(APERCU_ETAT)))
ifeq ($(filter pdf,$(word 2,$(APERCU_ETAT))),pdf)
PRIORITAIRE ?= $(if $(APERCU_SLUG),$(OUT)/$(APERCU_SLUG)/$(APERCU_SLUG).pdf)
else
PRIORITAIRE ?= $(if $(APERCU_SLUG),$(OUT)/$(APERCU_SLUG)/$(APERCU_SLUG).apercu.html)
endif

# Dossiers des unités et des Word déposés. livre.mk les remplace par chapitres et
# chapitres-word.
UNITES_DIR := articles
WORD_DIR   := articles-word

.PHONY: all pdf docx import reimporter annuler-reimport clean verifie-dossier rafraichir-pagination etat-pagination \
        tout-exporter verifier-ua verifier-numerotation profil-rien \
        profil-book-sans-fichier \
        profil-inconnu
.SECONDEXPANSION:
# Une recette qui échoue ne laisse pas de cible à moitié écrite.
.DELETE_ON_ERROR:

# Cible de Ctrl+S et Ctrl+E : importe les Word déposés, puis compile. Deux sous-make, pour
# que la compilation voie les articles qui viennent d'être convertis.
# Dans l'éditeur, tout code de sortie non nul s'affiche en erreur : on n'échoue que si la
# configuration ne peut pas être honorée. Un Word qui n'a pas pu être importé en fait
# partie : sans lui, le numéro serait incomplet.
ifeq ($(PROFIL_ROUTE),article)
# Clé `profil:` absente ou `profil: article`.
all:
	@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) pdf
else ifeq ($(PROFIL_ROUTE),rien)
all: profil-rien
else ifeq ($(PROFIL_ROUTE),livre)
# Comme pour un article : les Word de chapitres-word/ entrent d'abord, puis le livre se
# compose.
all:
	@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) livre
else ifeq ($(PROFIL_ROUTE),book)
all: profil-book-sans-fichier
else
all: profil-inconnu
endif

# `profil:` présent et vide : aucun document voulu. Sortie 0, pas de dossier out/.
profil-rien:
	@echo "[pipeline] profil vide dans ausgabe.yaml : ce dossier ne produit volontairement aucun document. Rien à compiler."

# `profil: book` dans ausgabe.yaml : un livre se reconnaît à buch.yaml, pas à cette clé.
# Le message dit ce qui manque.
profil-book-sans-fichier:
	@echo "[pipeline] Ce dossier déclare « profil: book » mais n'a pas de buch.yaml."
	@echo "[pipeline] Le moteur livre se reconnaît à ce fichier : créez le livre depuis le lanceur « Books SZH/CSPS », ou déposez un buch.yaml à côté d'ausgabe.yaml."
	@echo "[pipeline] [de] Dieser Ordner deklariert « profil: book », hat aber keine buch.yaml. Die Buchmaschine erkennt sich an dieser Datei."
	@exit 1

# Valeur non reconnue, souvent une faute de frappe : on nomme la valeur reçue et les
# valeurs acceptées.
profil-inconnu:
	@echo "[pipeline] profil inconnu dans ausgabe.yaml : « $(PROFIL) »"
	@echo "[pipeline] Valeurs acceptées : article (défaut) | book (différé) | vide (aucun document)."
	@exit 1

# Recompilation complète (clean puis all), puis validation PDF/UA : ces PDF partent chez
# l'imprimeur et dans OJS. Le « - » sur clean : un PDF verrouillé par Windows n'empêche
# pas la recompilation.
tout-exporter:
	-@$(MAKE) --no-print-directory -f $(THIS) clean
	@$(MAKE) --no-print-directory -f $(THIS) all
	@$(MAKE) --no-print-directory -f $(THIS) verifier-ua

# ---------------------------------------------------------------------------
# Vérifie que les deux langues d'un article numérotent figures et tableaux de la même façon.
# szh-numerotation.lua ne numérote que les objets légendés : une légende ajoutée ou retirée
# dans la traduction décale les numéros. Les deux HTML se donnent à la main, rien ne reliant
# un article à sa traduction.
#   make -f <toolkit>/pipeline/Makefile verifier-numerotation \
#        A=out/mon-article/mon-article.html \
#        B="../Zeitschrift 2026-03/out/mein-artikel/mein-artikel.html"
verifier-numerotation:
	@test -n "$(A)" && test -n "$(B)" || { \
	  echo "[numerotation] ✗ Deux HTML attendus : A=<version 1> B=<version 2>."; \
	  echo "[numerotation] [de] ✗ Zwei HTML erwartet: A=<Fassung 1> B=<Fassung 2>."; \
	  exit 2; \
	}
	@PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/verifier-numerotation.py" "$(A)" "$(B)"

# ---------------------------------------------------------------------------
# Validation PDF/UA-1 par veraPDF ; la logique est dans verifier-ua.sh (contrôle des
# outils, appel de veraPDF, rapport par rapport-ua.py). Bloquante, mais absente de `pdf` et
# de `all` : on doit pouvoir relire l'épreuve d'un article imparfait.
#
# Codes de veraPDF : 0 conforme, 1 non conforme ; 4, 7 et 127 sont des pannes d'outil, que
# verifier-ua.sh rend en code 2. Un JAVA_HOME invalide fait sortir veraPDF en 1, comme un
# PDF non conforme : verifier-ua.sh contrôle donc le runtime avant l'appel.
#
# PDFS_UA : les PDF des articles ; profils/livre.mk la remplace par le PDF du livre.
# `$$(PDFS_UA)` en seconde expansion : livre.mk est inclus à la fin, et une expansion
# immédiate figerait la liste de la revue.
PDFS_UA    := $(PDFS)

verifier-ua: $$(PDFS_UA)
	@test -n "$(PDFS_UA)" || { echo "[pipeline] Aucun PDF à valider."; exit 1; }
	@VERAPDF="$(VERAPDF)" VERAPDF_JAVA="$(VERAPDF_JAVA)" PIPELINE_DIR="$(PIPELINE_DIR)" bash "$(PIPELINE_DIR)/verifier-ua.sh" "$(OUT)/.szh-pdfua.xml" $(PDFS_UA)

# Refuse de compiler un article dont la fiche <slug>.meta.yaml manque ou n'a pas de titre.
# Sans titre, le PDF aurait un <title> et un <h1> vides tout en se déclarant PDF/UA-1, ce
# que la norme interdit.
# $(1) = liste de slugs (un seul pour la cible HTML, tous pour verifie-dossier).
define exiger_titre
@for slug in $(1); do \
  fiche="articles/$$slug/$$slug.meta.yaml"; \
  titre=$$($(PANDOC) lua $(LIRE_CONFIG) "$$fiche" title 2>/dev/null); \
  [ -n "$$titre" ] && continue; \
  echo "[pipeline] ⚠ L'article « $$slug » n'a pas de titre : la fiche $$fiche est absente, ou son titre est vide."; \
  echo "[pipeline] À faire : ouvrez « Métadonnées des articles » dans le cockpit, saisissez le titre de cet article, enregistrez, puis relancez la compilation (Ctrl+S)."; \
  echo "[pipeline] Pourquoi la compilation s'arrête : sans titre, le PDF sortirait avec un titre de document vide tout en s'annonçant conforme PDF/UA. Un lecteur d'écran n'aurait rien à annoncer."; \
  echo "[pipeline] [de] Der Artikel « $$slug » hat keinen Titel: $$fiche fehlt, oder der Titel ist leer. Öffnen Sie « Metadaten der Artikel » im Cockpit, geben Sie den Titel ein, speichern Sie und kompilieren Sie erneut (Ctrl+S)."; \
  exit 1; \
done
endef

# Priorité manuelle : make … all PRIORITAIRE=out/<slug>/<slug>.apercu.html
pdf: verifie-dossier $(PRIORITAIRE) $(PDFS) $(APERCUS)

verifie-dossier:
	@test -f ausgabe.yaml || { echo "[pipeline] Ce dossier n'est pas une revue (ausgabe.yaml introuvable) : $$PWD"; exit 1; }
	@test -n "$(SLUGS)" || { echo "[pipeline] Aucun article (articles/<nom>/<nom>.md) — déposez les Word dans $(WORD_DIR)/ puis enregistrez (Ctrl+S)."; exit 1; }
	@if ls -d articles/* 2>/dev/null | grep -q ' '; then \
	  echo "[pipeline] ⚠ Un dossier de articles/ contient des espaces — renommez-le sans espaces."; exit 1; \
	fi
	$(call exiger_titre,$(SLUGS))

CONFIG_COULEUR := $(firstword $(LIVRE_CONFIG) ausgabe.yaml)
$(ACCENT_CSS): $(CONFIG_COULEUR) $(PIPELINE_DIR)/styles/couleurs.css \
              $(PIPELINE_DIR)/accent-css.py $(PIPELINE_DIR)/apca.py
	@mkdir -p "$(OUT)"
	@python3 "$(PIPELINE_DIR)/accent-css.py" $(CONFIG_COULEUR) > "$@"

# Feuilles de folio, calculées depuis l'état de pagination seul : `feuilles` ne lit aucun
# PDF, donc pas de boucle. C'est `rafraichir-pagination` (le bouton du cockpit) qui mesure
# les PDF et met l'état à jour. Un seul appel écrit toutes les feuilles, d'où ce fichier
# témoin plutôt qu'une règle par feuille.
$(OUT)/.szh-folios: .szh-pagination.json $(PAGINATION)
	@mkdir -p "$(OUT)"
	@python3 "$(PAGINATION)" feuilles --dossier . >/dev/null
	@touch $@

# .md -> HTML autonome (--embed-resources : images et CSS incorporées en base64). Pandoc
# tourne dans le dossier de l'article, pour que media/ et tables/ soient relatifs au .md.
# szh-citations.lua, en fin de chaîne, réinsère la bibliographie lue dans <slug>.biblio.md,
# ancre chaque référence et lie les appels du corps.
# Une même règle et une même chaîne de filtres pour les deux sortes d'articles : si
# <slug>.md existe, c'est la source ; sinon (Documentation Kirby) documentation-kirby.py
# écrit out/<slug>/<slug>.md, qui nourrit pandoc.
$(OUT)/%.html: $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).md) $$(wildcard articles/$$(notdir $$*)/documentation.*.txt) $$(wildcard articles/$$(notdir $$*)/*/*) ausgabe.yaml $(SOCLE) $(STYLE) $(PARTAGE) $(ACCENT_CSS) $(TEMPLATE) $(FILTRES) $(DOC_CHAMPS_JSON) $(DOC_CONVERTISSEUR) $$(if $$(wildcard articles/$$(notdir $$*)/documentation.*.txt),$(DOC_FICHES)) $$(wildcard articles/$$(notdir $$*)/tables/*.html) $$(wildcard articles/$$(notdir $$*)/media/*) $$(wildcard articles/$$(notdir $$*)/portraits/*) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).biblio.md)
	@mkdir -p "$(dir $@)"
	$(call exiger_titre,$(notdir $*))
	@slug="$(notdir $*)"; \
	if [ -f "articles/$$slug/$$slug.md" ]; then \
	  entree="$$slug.md"; source_aff="articles/$$slug/$$slug.md"; \
	else \
	  echo "documentation-kirby.py articles/$$slug -> $(abspath $(OUT))/$$slug/$$slug.md"; \
	  python3 "$(DOC_CONVERTISSEUR)" --article "articles/$$slug" --champs "$(DOC_CHAMPS_JSON)" \
	    --racine-news "$(NEWS_RACINE)" --sortie "$(abspath $(OUT))/$$slug/$$slug.md" || exit 1; \
	  entree="$(abspath $(OUT))/$$slug/$$slug.md"; source_aff="$(OUT)/$$slug/$$slug.md"; \
	fi; \
	echo "pandoc $$source_aff -> $@"; \
	cd "articles/$$slug" && SZH_AUSGABE="$(abspath ausgabe.yaml)" $(PANDOC) "$$entree" \
	  --from=markdown --to=html5 \
	  --metadata-file="$(abspath ausgabe.yaml)" --metadata-file="$$slug.meta.yaml" \
	  --standalone --embed-resources \
	  --template="$(TEMPLATE_ABS)" \
	  --css="$(SOCLE_ABS)" --css="$(STYLE_ABS)" --css="$(PARTAGE_ABS)" --css="$(ACCENT_ABS)" \
	  $(FILTRES_ARTICLE) \
	  --output="$(abspath $@)"
	$(call reordonner_appels_de_note,$@)

# Appel de note : pandoc écrit <a class="footnote-ref"><sup>n</sup></a>. WeasyPrint pose
# une annotation de lien par boîte contenue dans le <a>, et une seule est rattachée au /Link
# de l'arbre de structure : les autres finissent sous /NonStruct, ce que PDF/UA-1 interdit
# (7.18.5). On réordonne en <sup><a>n</a></sup>, au rendu identique.
# Fait ici et non dans un filtre Lua : ce balisage est écrit par le writer HTML, après les
# filtres. `@` sépare le sed, le motif contenant « ref|back ».
define reordonner_appels_de_note
@sed -i -E 's@<a ([^>]*class="footnote-(ref|back)"[^>]*)><sup>([^<]*)</sup></a>@<sup><a \1>\3</a></sup>@g' "$(abspath $(1))"
endef

# .md -> HTML d'aperçu pour le cockpit : mêmes filtres, CSS et métadonnées que le PDF, mais
# lu en commonmark_x+sourcepos. Chaque bloc porte data-pos, ce qui permet le clic vers le
# texte source.
# szh-sourcepos.lua passe en premier : sourcepos enveloppe chaque mot dans un Span, ce qui
# rendrait inertes szh-typographie.lua et le liage de szh-citations.lua.
# Un article Documentation est lu en markdown ordinaire, sans sourcepos : son aperçu n'a
# pas le clic vers le texte.
$(OUT)/%.apercu.html: $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).md) $$(wildcard articles/$$(notdir $$*)/documentation.*.txt) $$(wildcard articles/$$(notdir $$*)/*/*) ausgabe.yaml $(SOCLE) $(STYLE) $(PARTAGE) $(ACCENT_CSS) $(FILTRES) $(DOC_CHAMPS_JSON) $(DOC_CONVERTISSEUR) $$(if $$(wildcard articles/$$(notdir $$*)/documentation.*.txt),$(DOC_FICHES)) $$(wildcard articles/$$(notdir $$*)/tables/*.html) $$(wildcard articles/$$(notdir $$*)/media/*) $$(wildcard articles/$$(notdir $$*)/portraits/*) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).biblio.md)
	@mkdir -p "$(dir $@)"
	@slug="$(notdir $*)"; \
	meta=""; \
	if [ -f "articles/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	if [ -f "articles/$$slug/$$slug.md" ]; then \
	  entree="$$slug.md"; source_aff="articles/$$slug/$$slug.md"; lecteur="commonmark_x+sourcepos"; \
	  sourcepos="--lua-filter=$(PIPELINE_DIR)/filters/szh-sourcepos.lua --lua-filter=$(PIPELINE_DIR)/filters/szh-ancres.lua"; \
	else \
	  echo "documentation-kirby.py articles/$$slug -> $(abspath $(OUT))/$$slug/$$slug.md"; \
	  python3 "$(DOC_CONVERTISSEUR)" --article "articles/$$slug" --champs "$(DOC_CHAMPS_JSON)" \
	    --racine-news "$(NEWS_RACINE)" --sortie "$(abspath $(OUT))/$$slug/$$slug.md" || exit 1; \
	  entree="$(abspath $(OUT))/$$slug/$$slug.md"; source_aff="$(OUT)/$$slug/$$slug.md"; lecteur="markdown"; sourcepos=""; \
	fi; \
	echo "pandoc $$source_aff -> $@ (aperçu)"; \
	cd "articles/$$slug" && SZH_APERCU=1 $(PANDOC) "$$entree" \
	  --from=$$lecteur --to=html5 $$sourcepos \
	  --metadata-file="$(abspath ausgabe.yaml)" $$meta \
	  --standalone --embed-resources \
	  --css="$(SOCLE_ABS)" --css="$(STYLE_ABS)" --css="$(PARTAGE_ABS)" --css="$(ACCENT_ABS)" \
	  $(FILTRES_APERCU) \
	  --output="$(abspath $@)" || \
	printf '%s' '<!DOCTYPE html><html lang="fr"><body><p>Aperçu HTML indisponible pour cet article (le PDF, lui, est compilé) : voir le panneau de compilation.</p></body></html>' > "$(abspath $@)"

# HTML -> PDF balisé PDF/UA-1 : la seule cascade WeasyPrint du dépôt. Elle sert au PDF
# d'un article et, dans profils/livre.mk, aux PDF du livre, de la couverture et d'un
# chapitre seul.
# Si la variante pdf/ua-1 échoue, repli sur --pdf-tags, puis sur un PDF sans balisage :
# l'épreuve d'un article imparfait doit sortir. La validation bloquante est `verifier-ua`.
# La sortie d'erreur de WeasyPrint (image sans description, propriété CSS ignorée, police
# manquante) est gardée dans un journal. ABREGER_BASE64 y coupe les data: URI à 16
# caractères : sinon une image fautive est nommée par des kilo-octets de base64.
# Le PDF s'écrit d'abord dans un temporaire « ~$… » du même dossier, que OneDrive ne
# synchronise pas, puis est renommé. Un renommage refusé signifie presque toujours un PDF
# ouvert sous Windows : le message pdf-verrouille le dit au cockpit.
# Guillemets simples : make ne doit pas substituer $0 ni $notdir.
#
# $(1) étiquette des messages, `pipeline` ou `livre`. Elle choisit aussi weasy_journal_<…>
#      et weasy_echec_<…> : la revue rend le journal sur la sortie d'erreur, où le cockpit
#      lit les « WARNING: » ; le livre en montre vingt lignes et garde le fichier ;
#   $(2) options de WeasyPrint placées en tête (la feuille de folio d'un article) ;
#   $(3) chemin du journal.
# S'appelle en fin de ligne continuée, après les affectations de la recette.
ABREGER_BASE64 := sed -E 's@(data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{16})[A-Za-z0-9+/=]+@\1… (image incorporée)@g'

define weasy_ua
tmp='$(dir $@)~$$$(notdir $@)'; jrnl='$(3)'; \
: > "$$jrnl"; \
if $(WEASYPRINT) $(2) --pdf-variant pdf/ua-1 $< "$$tmp" 2>>"$$jrnl"; then :; \
elif $(WEASYPRINT) $(2) --pdf-tags $< "$$tmp" 2>>"$$jrnl"; then \
  echo "[$(1)] PDF/UA-1 indisponible -> PDF balisé simple : $@"; \
else \
  echo "[$(1)] balisage PDF indisponible -> PDF non balisé : $@"; \
  $(WEASYPRINT) $(2) $< "$$tmp" 2>>"$$jrnl" || { \
    echo "[$(1)] ✖ WeasyPrint n'a pas pu produire $@. Ce qu'il en dit :"; \
    $(weasy_echec_$(1)) \
    exit 1; }; \
fi; \
$(weasy_journal_$(1)) \
mv -f "$$tmp" "$@" || { \
  rm -f "$$tmp"; \
  echo "[pipeline-blocage] pdf-verrouille | fichier « $@ » | Le PDF est ouvert dans une autre application. | [de] Das PDF ist in einer anderen Anwendung geöffnet."; \
  exit 1; }
endef

define weasy_echec_pipeline
$(ABREGER_BASE64) "$$jrnl" >&2; \
echo "[pipeline]   Journal conservé : $$jrnl"; \
echo "[pipeline] [de] ✖ WeasyPrint konnte das PDF nicht erzeugen. Protokoll: $$jrnl";
endef

define weasy_journal_pipeline
$(ABREGER_BASE64) "$$jrnl" >&2; \
rm -f "$$jrnl";
endef

# Folio de départ de l'article : out/<slug>/.szh-folio.css, une ligne
# `@page :first { counter-reset: page N; }` écrite par pagination.py et passée à WeasyPrint
# en feuille utilisateur (-s).
#   * en -s et non dans le HTML : le HTML sert aussi au galley DOCX et à l'aperçu, et un
#     article déplacé dans le numéro ne repasse que par WeasyPrint ;
#   * `@page :first` : sur `@page`, le compteur serait remis à N à chaque page. N est le
#     folio de la première page (11 donne 11, 12, 13…) ;
#   * prérequis en $(wildcard) et non cible : la feuille dépend du nombre de pages des PDF,
#     en faire une cible créerait un cycle. Elle n'est produite que par
#     `rafraichir-pagination`.
# $(FOLIOS) est un prérequis d'ordre seul : les feuilles doivent exister, mais un état plus
# récent ne refait que les PDF dont la feuille a changé.
# Sur un arbre neuf, la feuille n'existe pas quand make évalue le $(wildcard) : le test
# `[ -f ]` de la recette la prend au dernier moment.
# Retirer une feuille ne ramène pas le PDF au folio 1 (aucun prérequis n'a bougé) : c'est
# pourquoi pagination.py écrit une feuille pour chaque article, même au départ 1.
$(OUT)/%.pdf: $(OUT)/%.html $$(wildcard $(OUT)/$$(dir $$*).szh-folio.css) | $(FOLIOS)
	@folio='$(dir $@).szh-folio.css'; sfolio=""; \
	if [ -f "$$folio" ]; then sfolio="-s $$folio"; fi; \
	$(call weasy_ua,pipeline,$$sfolio,$(dir $@)~weasyprint.err)

# Pagination continue du numéro : compiler ce qui manque, lire le nombre de pages de chaque
# PDF, recalculer les folios de départ, puis recompiler les articles dont le départ a bougé.
# Deux passes suffisent : le nombre de pages d'un article ne dépend pas de son folio, qui
# est dans le pied de page. pagination.py n'écrit une feuille que si elle change, donc la
# seconde passe ne refait que le nécessaire.
# ORDRE=slug1,slug2 est obligatoire : seul le cockpit connaît l'ordre de lecture (tri
# français, articles sans DOI en fin de numéro selon ausgabe.yaml et la configuration OJS).
rafraichir-pagination:
	@test -n "$(ORDRE)" || { \
	  echo "[pipeline] ✖ ORDRE manquant : seul le cockpit connaît l'ordre de lecture du numéro. Rafraîchissez la pagination depuis le cockpit, ou passez ORDRE=a,b,c."; \
	  echo "[pipeline] [de] ✖ ORDRE fehlt: nur das Cockpit kennt die Reihenfolge der Ausgabe."; \
	  exit 2; }
	@$(MAKE) --no-print-directory -f $(THIS) pdf
	@$(PYTHON_PAGINATION) "$(PAGINATION)" rafraichir --dossier . --ordre "$(ORDRE)"
	@$(MAKE) --no-print-directory -f $(THIS) pdf

# État de la pagination en JSON sur une ligne, lu par le cockpit après la compilation d'un
# numéro paginé (articles décalés) et avant l'export OJS (champ <pages>). Ne compile ni
# n'écrit rien. Sans ORDRE, pagination.py reprend l'ordre de la dernière pagination et ne
# voit donc pas un article déplacé.
etat-pagination:
	@$(PYTHON_PAGINATION) "$(PAGINATION)" etat --dossier . $(if $(ORDRE),--ordre "$(ORDRE)")

# HTML autonome -> DOCX : galley Word de l'export OJS. Fait depuis le HTML et non depuis le
# .md, pour garder les tableaux en HTML brut (colspan/rowspan) et les images data:.
# szh-galley-docx.lua retire les blocs techniques (.szh-description, cibles des
# aria-describedby), que print.css masque mais que le DOCX afficherait.
$(OUT)/%.docx: $(OUT)/%.html $(PIPELINE_DIR)/filters/szh-galley-docx.lua
	@echo "pandoc $< -> $@ (docx)"
	@$(PANDOC) "$<" --from=html --to=docx \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-galley-docx.lua" --output="$@"

# Galleys de l'export OJS, après validation PDF/UA.
docx: verifie-dossier verifier-ua $(DOCXS)

# Import des .docx et .odt déposés dans articles-word/ (un .odt est d'abord converti en
# .docx par import-docx.sh). Les anciens articles « à plat » sont déplacés dans
# articles/<slug>/. Un article existant n'est pas écrasé. Une conversion réussie supprime
# le Word ; un échec le laisse en place et supprime articles/<slug>.
# `reimporter.py --reprise` répare d'abord un réimport interrompu, dont l'article serait
# resté dans articles/.szh-bascule-<slug>, hors de SLUGS.
#
# Slug : le nombre en tête d'un nom comme « 4_Titre » est retiré (l'ordre des articles est
# tenu ailleurs, voir lib/slug.js:numeroOrdreArticle()). Longueur limitée à 39 caractères :
# le slug apparaît quatre fois dans un chemin de sortie, et la limite Windows de 260
# caractères casse la synchronisation SharePoint. La coupe tombe sur le dernier mot entier
# et retire les élisions d'une lettre (« -d », « -l »).
# À garder aligné avec slugifierArticle() et slugifierArticleUnique() de
# vscodium-extension/szh-cockpit/lib/slug.js, qui devinent le slug d'un Word en attente.
#
# Nom de dossier déjà pris : le champ `source:` de la fiche (écrit par docx-meta.py) dit
# d'où vient l'article existant :
#   * même fichier Word : c'est une version corrigée. Rien n'est créé, le Word reste en
#     attente et le journal propose « Réimporter cet article » (cible `reimporter`) ;
#   * autre fichier Word : deux articles distincts que la coupe à 39 caractères confond. Le
#     second reçoit « -2 », puis « -3 »… jusqu'à 99, en raccourcissant la fin du slug ;
#   * origine inconnue (fiche sans `source:` ou absente) : rien n'est créé, pour ne pas
#     risquer un doublon. Le message dit quoi faire.
# dossier_existant() cherche le slug nu et le slug préfixé par un rang (« 00-<slug> », que
# pose le cockpit, lib/import-hote.js). Elle imprime le nom trouvé, ou échoue sans rien
# imprimer.
# Tout Word non importé fait échouer la recette.
#
# Livre seulement : un chapitre converti qui contient au moins deux titres de niveau 1 est
# aussitôt découpé par livre-scinder.py, un chapitre par titre. Un seul titre de niveau 1
# est le titre du chapitre. Le .docx étant déjà supprimé, relancer `import` ne redécoupe
# pas. Une ressource manquante (image, tableau) garde le dossier d'origine et compte dans
# $$scission_rate, distinct de $$rate.
import:
	@set -u; \
	shopt -s nullglob; \
	for m in $(UNITES_DIR)/*.md; do \
	  base=$$(basename "$$m" .md); \
	  mkdir -p "$(UNITES_DIR)/$$base/media"; \
	  mv "$$m" "$(UNITES_DIR)/$$base/$$base.md"; \
	  if [ -d "$(UNITES_DIR)/media/$$base" ]; then \
	    cp -r "$(UNITES_DIR)/media/$$base/." "$(UNITES_DIR)/$$base/media/" && rm -rf "$(UNITES_DIR)/media/$$base"; \
	  fi; \
	  sed -i "s|$(UNITES_DIR)/media/$$base/|media/|g" "$(UNITES_DIR)/$$base/$$base.md"; \
	  echo "[import] structure migrée : $$m -> $(UNITES_DIR)/$$base/$$base.md"; \
	done; \
	rmdir $(UNITES_DIR)/media 2>/dev/null || true; \
	for d in $(UNITES_DIR)/*/; do \
	  slug=$$(basename "$$d"); \
	  if [ -d "$$d/media/media" ]; then \
	    cp -r "$$d/media/media/." "$$d/media/" && rm -rf "$$d/media/media"; \
	    if [ -f "$$d/$$slug.md" ]; then sed -i 's|media/media/|media/|g' "$$d/$$slug.md"; fi; \
	    echo "[import] media aplati : $${d}media/media -> $${d}media"; \
	  fi; \
	done; \
	if [ "$(PROFIL_ROUTE)" = "article" ]; then \
	  PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/reimporter.py" --reprise || true; \
	fi; \
	[ -d "$(WORD_DIR)" ] || exit 0; \
	journal="$(WORD_DIR)/.import.log"; \
	: > "$$journal"; \
	export SZH_IMPORT_LOG="$$PWD/$$journal"; \
	dire() { echo "$$*"; printf '%s\n' "$$*" >> "$$journal"; }; \
	dossier_existant() { \
	  local s g; \
	  s="$$1"; \
	  if [ -e "$(UNITES_DIR)/$$s/$$s.md" ]; then printf '%s' "$$s"; return 0; fi; \
	  for g in "$(UNITES_DIR)"/[0-9]*-"$$s"; do \
	    if [ -e "$$g/$$(basename "$$g").md" ]; then printf '%s' "$$(basename "$$g")"; return 0; fi; \
	  done; \
	  return 1; \
	}; \
	shopt -s nocaseglob; \
	files=("$(WORD_DIR)"/*.docx "$(WORD_DIR)"/*.odt); \
	shopt -u nocaseglob; \
	[ $${#files[@]} -gt 0 ] || exit 0; \
	mkdir -p $(UNITES_DIR); \
	ok=0; renomme=0; redepot=0; rate=0; scinde=0; scission_rate=0; \
	for f in "$${files[@]}"; do \
	  nom=$$(basename "$$f"); slug="$${nom%.*}"; \
	  tete="$${slug%%[!0-9]*}"; reste="$${slug#$$tete}"; a_un_numero=0; \
	  if [ -n "$$tete" ]; then case "$$reste" in [_-]*) a_un_numero=1;; esac; fi; \
	  slug=$$(printf '%s' "$$slug" | LC_ALL=C.UTF-8 iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$$slug"); \
	  slug=$$(printf '%s' "$$slug" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$$//'); \
	  [ -n "$$slug" ] || slug=article; \
	  if [ "$$a_un_numero" = 1 ]; then slug=$$(printf '%s' "$$slug" | sed -E 's/^[0-9]+-//'); fi; \
	  if [ $${#slug} -gt 39 ]; then scourt="$${slug:0:39}"; scourt="$${scourt%-*}"; sorph=$$(printf '%s' "$$scourt" | sed -E 's/(-[a-z0-9])+$$//'); case "$$sorph" in *-*) scourt="$$sorph";; esac; slug="$${scourt:-$${slug:0:39}}"; fi; \
	  venu_de=""; \
	  for fiche in $(UNITES_DIR)/*/*.meta.yaml; do \
	    src=$$(sed -n 's/^source:[[:space:]]*//p' "$$fiche" | head -1 | sed -e 's/^"//' -e 's/"$$//'); \
	    if [ "$$src" = "$$nom" ]; then venu_de=$$(basename "$$(dirname "$$fiche")"); break; fi; \
	  done; \
	  if [ -n "$$venu_de" ]; then \
	    dire "[import-avertissement] word-redepose | article « $$venu_de » | fichier « $$nom » | Cet article a déjà été importé depuis ce même fichier Word. Rien n'a été créé : la version corrigée reste en attente dans $(WORD_DIR)/, et l'article publié est encore l'ancien. Pour publier la correction sans perdre la fiche, les médias ni les traductions : « Réimporter cet article », sur cet article. | [de] Dieser Artikel wurde schon aus derselben Word-Datei importiert. Es wurde nichts angelegt: die korrigierte Fassung bleibt in $(WORD_DIR)/, veröffentlicht ist noch die alte. Um die Korrektur zu veröffentlichen, ohne Metadaten, Medien und Übersetzungen zu verlieren: « Artikel neu importieren », beim betreffenden Artikel."; \
	    redepot=$$((redepot+1)); continue; \
	  fi; \
	  dossier_actuel=$$(dossier_existant "$$slug") || dossier_actuel=""; \
	  if [ -n "$$dossier_actuel" ] && ! grep -q "^source:" "$(UNITES_DIR)/$$dossier_actuel/$$dossier_actuel.meta.yaml" 2>/dev/null; then \
	    dire "[import-avertissement] origine-inconnue | article « $$dossier_actuel » | fichier « $$nom » | Un article porte déjà ce nom de dossier, sans qu'on sache de quel Word il vient. Rien n'a été créé, pour ne pas risquer un doublon dans le numéro. S'il s'agit d'un autre article, renommez le fichier Word puis enregistrez (Ctrl+S) ; s'il s'agit du même article corrigé, lancez « Réimporter cet article » et désignez-lui ce fichier Word. | [de] Ein Artikel trägt diesen Ordnernamen bereits, ohne bekannte Word-Herkunft. Es wurde nichts angelegt, um kein Duplikat in der Ausgabe zu erzeugen. Handelt es sich um einen anderen Artikel, benennen Sie die Word-Datei um und speichern Sie (Ctrl+S); ist es derselbe Artikel, korrigiert, starten Sie « Artikel neu importieren » und weisen Sie ihm diese Word-Datei zu."; \
	    redepot=$$((redepot+1)); continue; \
	  fi; \
	  base="$$slug"; n=1; trop=0; \
	  while dossier_existant "$$slug" >/dev/null; do \
	    n=$$((n+1)); \
	    if [ $$n -gt 99 ]; then trop=1; break; fi; \
	    suf="-$$n"; tronc="$$base"; \
	    if [ $$(($${#tronc} + $${#suf})) -gt 39 ]; then \
	      tronc=$$(printf '%s' "$${base:0:$$((39 - $${#suf}))}" | sed -E 's/-+$$//'); \
	    fi; \
	    slug="$$tronc$$suf"; \
	  done; \
	  if [ $$trop -eq 1 ]; then \
	    dire "[import] ⚠ échec sur : $$nom — 99 articles portent déjà ce nom de dossier ; renommez le fichier Word puis enregistrez (Ctrl+S). [de] 99 Artikel tragen diesen Ordnernamen bereits; benennen Sie die Word-Datei um und speichern Sie erneut (Ctrl+S)."; \
	    rate=$$((rate+1)); continue; \
	  fi; \
	  cible="$(UNITES_DIR)/$$slug/$$slug.md"; \
	  if SZH_IMPORT_DIR="$(abspath $(UNITES_DIR)/$$slug)" bash "$(PIPELINE_DIR)/import-docx.sh" "$$f" "$$slug" "$(PIPELINE_DIR)"; then \
	    rm -f "$$f"; \
	    if [ "$$slug" = "$$base" ]; then \
	      dire "[import] converti : $$nom -> $$cible"; \
	    else \
	      dire "[import] converti : $$nom -> $$cible (le nom de dossier « $$base » était déjà pris ; cet article prend « $$slug »)"; \
	      renomme=$$((renomme+1)); \
	    fi; \
	    ok=$$((ok+1)); \
	    if [ -n "$(LIVRE_CONFIG)" ]; then \
	      titres1=$$(grep -c -E '^#[[:space:]]' "$$cible" 2>/dev/null || true); titres1=$${titres1:-0}; \
	      if [ "$$titres1" -ge 2 ] 2>/dev/null; then \
	        if PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/livre-scinder.py" "$$PWD" "$$slug"; then \
	          dire "[import] scindé : $$nom -> $$titres1 chapitre(s) ($$titres1 titres de niveau 1 détectés dans $$cible)"; \
	          scinde=$$((scinde+1)); \
	        else \
	          dire "[import] ⚠ scission incomplète : $$nom — voir les avertissements « scission-avertissement » ci-dessus ; le dossier d'origine du manuscrit a été conservé, PAS supprimé. [de] ⚠ Aufteilung unvollständig: $$nom — Details siehe oben (« scission-avertissement »); der Ursprungsordner des Manuskripts wurde beibehalten, NICHT gelöscht."; \
	          scission_rate=$$((scission_rate+1)); \
	        fi; \
	      fi; \
	    fi; \
	  else \
	    rm -rf "$(UNITES_DIR)/$$slug"; \
	    dire "[import] ⚠ échec sur : $$nom (le fichier reste dans $(WORD_DIR)/)"; rate=$$((rate+1)); \
	  fi; \
	done; \
	dire "[import] terminé : $$ok converti(s), $$renomme renommé(s), $$redepot redéposé(s), $$rate échec(s)."; \
	if [ $$scinde -ne 0 ] || [ $$scission_rate -ne 0 ]; then \
	  dire "[import] scission : $$scinde manuscrit(s) scindé(s) en chapitres, $$scission_rate incomplet(s) (dossier d'origine conservé, voir « scission-avertissement » ci-dessus). [de] Aufteilung: $$scinde Manuskript(e) in Kapitel aufgeteilt, $$scission_rate unvollständig (Ursprungsordner beibehalten, siehe oben « scission-avertissement »)."; \
	fi; \
	if [ $$redepot -ne 0 ]; then \
	  dire "[import] $$redepot fichier(s) Word attendent : leur article existe déjà, c'est sa version corrigée qui n'est pas encore publiée. Publiez-la par « Réimporter cet article ». [de] $$redepot Word-Datei(en) warten: ihr Artikel existiert bereits, nur die korrigierte Fassung ist noch nicht veröffentlicht. Veröffentlichen Sie sie über « Artikel neu importieren »."; \
	fi; \
	if [ $$rate -ne 0 ]; then \
	  dire "[import] ⚠ $$rate fichier(s) Word ne sont pas entrés dans le numéro : ils restent dans $(WORD_DIR)/. [de] $$rate Word-Datei(en) sind nicht in die Ausgabe gelangt: sie bleiben in $(WORD_DIR)/."; \
	fi; \
	if [ $$scission_rate -ne 0 ]; then \
	  dire "[import] ⚠ $$scission_rate manuscrit(s) scindé(s) incomplètement : ressource(s) manquante(s) ; dossier(s) d'origine conservé(s) — voir « scission-avertissement » ci-dessus pour la marche à suivre. [de] ⚠ $$scission_rate Manuskript(e) unvollständig aufgeteilt: fehlende Ressource(n); Ursprungsordner beibehalten — weiteres Vorgehen siehe oben (« scission-avertissement »)."; \
	fi; \
	if [ $$rate -ne 0 ] || [ $$scission_rate -ne 0 ]; then \
	  exit 1; \
	fi

# Word corrigé d'un article déjà importé : le corps est remplacé ; la fiche, les tâches, le
# suivi de traduction et les portraits sont gardés, et l'état précédent est conservé.
# Détails en tête de reimporter.py.
#
#   make -f … reimporter ARTICLE=<slug>            le Word est celui du champ `source:`
#   make -f … reimporter WORD="<nom>.docx"         l'article est celui du champ `source:`
#   make -f … reimporter ARTICLE=<slug> WORD=…     appariement forcé
#   make -f … annuler-reimport ARTICLE=<slug>      retour à l'état d'avant
#
# make rend 2 pour tout échec de recette : les codes de reimporter.py ne traversent pas
# cette cible. Le cockpit appelle donc le script directement et lit sa ligne JSON ; cette
# cible sert en ligne de commande. Le code 3 (« rien à faire ») y devient un succès.
# Pas de prérequis verifie-dossier : le script vérifie lui-même le dossier, et un autre
# article qui ne compile pas ne doit pas bloquer le réimport.
reimporter:
	@PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/reimporter.py" \
	  $(if $(ARTICLE),--article "$(ARTICLE)",) $(if $(WORD),--word "$(WORD)",); \
	c=$$?; \
	if [ $$c -eq 3 ]; then exit 0; fi; \
	exit $$c

annuler-reimport:
	@PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/reimporter.py" \
	  --annuler $(if $(ARTICLE),--article "$(ARTICLE)",)

clean:
	rm -rf "$(OUT)"

# ---------------------------------------------------------------------------
# Moteur livre, inclus seulement dans un dossier qui contient buch.yaml.
# ---------------------------------------------------------------------------
ifneq ($(LIVRE_CONFIG),)
include $(PIPELINE_DIR)/profils/livre.mk
endif
