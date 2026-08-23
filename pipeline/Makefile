# Pipeline central SZH/CSPS : .md -> pandoc -> WeasyPrint -> PDF et HTML,
# un jeu de sorties par article. Vit dans le toolkit, s'invoque depuis le dossier de
# revue (cwd), ce Makefile étant passé par -f :
#   wsl.exe -d SZH-Publishing --cd <dossier revue> -- make -f <toolkit>/pipeline/Makefile all
#
# Entrées : articles/<slug>/<slug>.md + media/ ; sorties : out/<slug>/<slug>.pdf et .html.
# Import Word : articles-word/*.docx, converti par import-docx.sh (sa chaîne y est décrite).
#
# Ordre des --lua-filter à la compilation, et ce qui casse si on permute :
#   szh-maquette -> szh-niveaux -> szh-tabelle-inclure -> szh-tabelle-scope ->
#   szh-figure -> szh-numerotation -> szh-legende-avant
#   * szh-numerotation après szh-tabelle-inclure : il numérote des tableaux qui
#     n'existent qu'une fois le HTML réinjecté ;
#   * szh-numerotation après szh-figure : sous le lecteur commonmark_x de l'aperçu,
#     les Figure ne sont construites que par szh-figure ;
#   * szh-legende-avant en dernier : il dissout les Figure en HTML brut, rien en amont
#     ne peut plus les lire.
# La chaîne d'aperçu reprend la même suite, sans szh-maquette.
#
# Aucun chemin /mnt/c codé en dur ici (portabilité macOS). Conserver l'indentation
# par tabulations et les fins de ligne LF.

SHELL      := /bin/bash
PANDOC     ?= pandoc
WEASYPRINT ?= weasyprint

# Chemin absolu de ce Makefile : la cible `all` se relance par -f $(THIS).
THIS         := $(abspath $(lastword $(MAKEFILE_LIST)))
PIPELINE_DIR := $(patsubst %/,%,$(dir $(THIS)))

# Style de la revue s'il existe (styles/print.css), sinon style central du toolkit.
STYLE      := $(firstword $(wildcard styles/print.css) $(PIPELINE_DIR)/styles/print.css)
STYLE_ABS  := $(abspath $(STYLE))

# Template pandoc de la couverture + filtre Lua qui dérive les métadonnées de
# couverture et d'en-tête (étiquette de dossier, nom et ISSN de la revue).
TEMPLATE     := $(PIPELINE_DIR)/templates/szh-article.html
TEMPLATE_ABS := $(abspath $(TEMPLATE))
MAQUETTE_LUA := $(PIPELINE_DIR)/filters/szh-maquette.lua
# Tous les filtres Lua sont prerequis des rendus : en modifier un doit recompiler.
FILTRES      := $(wildcard $(PIPELINE_DIR)/filters/*.lua)

# ---------------------------------------------------------------------------
# Profil de compilation du dossier, lu dans ausgabe.yaml par sed + head : l'image WSL
# n'embarque pas PyYAML.
# ⚠ `sed` renvoie une chaîne vide dans deux cas opposés : clé `profil:` absente (dossier
#   historique, à compiler comme avant) ou clé présente sans valeur (choix du rédacteur :
#   aucun document). La présence se compte donc à part, avec `grep -c '^profil:'` ;
#   l'ancrage `^` écarte les lignes d'aide commentées et les clés indentées.
PROFIL_PRESENT := $(shell grep -c "^profil:" ausgabe.yaml 2>/dev/null | head -1)
# La valeur : guillemets d'un sérialiseur tolérés, arrêt au premier caractère hors
# [a-zA-Z-] (espace, commentaire de fin de ligne, CR de Windows). Une valeur exotique
# est donc tronquée et tombe dans la branche « profil inconnu », qui échoue avec un
# message clair : pas de repli silencieux sur un autre profil.
PROFIL_LU      := $(shell sed -n "s/^profil:[[:space:]]*[\"']*\([a-zA-Z-]*\).*/\1/p" ausgabe.yaml 2>/dev/null | head -1)
PROFIL         := $(strip $(PROFIL_LU))
# Vide si la clé est absente (ou 0 occurrence) ; non vide sinon.
PROFIL_DECLARE := $(filter-out 0,$(PROFIL_PRESENT))

# Routage de la cible `all`, résolu à la lecture du Makefile : `make -n all` montre
# la route prise sans exécuter pandoc.
ifeq ($(PROFIL_DECLARE),)
PROFIL_ROUTE := article
else ifeq ($(PROFIL),)
PROFIL_ROUTE := rien
else
PROFIL_ROUTE := $(PROFIL)
endif
# ---------------------------------------------------------------------------

# Articles : un dossier par article, articles/<slug>/<slug>.md.
SLUGS      := $(sort $(foreach d,$(wildcard articles/*),$(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
OUT        := out
PDFS       := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).pdf)
HTMLS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).html)
# Aperçu HTML cliquable : rendu séparé en commonmark_x+sourcepos. Ce reader ajoute
# des divs « wrapper » : il ne doit pas nourrir WeasyPrint, le PDF reste sur
# -f markdown.
APERCUS    := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).apercu.html)
# Galleys DOCX de l'export OJS : régénérés depuis le HTML autonome, à la demande
# seulement (cible `docx`) — ni `all` ni `tout-exporter` ne les produisent.
DOCXS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).docx)

# Accent des tableaux (.szh-tableau) : accent-css.py lit la couleur annuelle
# d'ausgabe.yaml et écrit un :root qui surcharge les gris de repli de print.css.
# Aucune couleur -> fichier « commentaire seul » -> gris de repli, PDF inchangé.
# Prérequis des HTML : le changer recompile les articles.
ACCENT_CSS := $(OUT)/.szh-accent.css
ACCENT_ABS := $(abspath $(ACCENT_CSS))

# Sans ceci, make considérerait les .html comme intermédiaires et les supprimerait.
.SECONDARY: $(HTMLS) $(APERCUS)

# Import Word : le .docx source est supprimé après une conversion réussie.
WORD_DIR   := articles-word

.PHONY: all pdf docx import clean verifie-dossier tout-exporter \
        profil-rien profil-differe profil-inconnu
.SECONDEXPANSION:

# Cible du build (Ctrl+S, Ctrl+E) : importe les Word déposés puis régénère les sorties, en
# deux sous-make pour que les articles fraîchement convertis soient vus par la passe pdf.
# Les `ifeq` sont résolus à la lecture, donc une seule recette `all` existe. Le code de
# sortie compte autant que la route : dans l'éditeur, tout code non nul s'affiche en erreur
# rouge — on n'échoue donc que si la configuration ne peut pas être honorée.
ifeq ($(PROFIL_ROUTE),article)
# Clé `profil:` absente ou `profil: article` : comportement historique, inchangé.
all:
	-@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) pdf
else ifeq ($(PROFIL_ROUTE),rien)
all: profil-rien
else ifeq ($(PROFIL_ROUTE),book)
all: profil-differe
else
all: profil-inconnu
endif

# `profil:` présent et vide : choix explicite, pas une panne -> sortie 0 et message
# doux. Aucune erreur rouge dans l'éditeur, aucun dossier out/ créé.
profil-rien:
	@echo "[pipeline] profil vide dans ausgabe.yaml : ce dossier ne produit volontairement aucun document. Rien à compiler."

# `profil: book` : moteur livre différé. Configuration légitime mais non honorable
# en l'état -> code non nul, pour que le rédacteur sache que son réglage reste sans
# effet au lieu de croire à une compilation silencieuse.
profil-differe:
	@echo "[pipeline] profil « book » : profil différé, non encore implémenté."
	@echo "[pipeline] En attendant : « article » (PDF + HTML par article)."
	@exit 1

# Valeur non reconnue : on nomme la valeur reçue et les valeurs acceptées, la faute
# de frappe étant de loin le cas le plus probable. Code non nul.
profil-inconnu:
	@echo "[pipeline] profil inconnu dans ausgabe.yaml : « $(PROFIL) »"
	@echo "[pipeline] Valeurs acceptées : article (défaut) | book (différé) | vide (aucun document)."
	@exit 1

# Rebuild forcé de toute la revue : clean puis all, sans regarder les dates. Le « - »
# sur clean : un PDF verrouillé côté Windows ne doit pas empêcher la régénération.
tout-exporter:
	-@$(MAKE) --no-print-directory -f $(THIS) clean
	@$(MAKE) --no-print-directory -f $(THIS) all

pdf: verifie-dossier $(PDFS) $(APERCUS)

verifie-dossier:
	@test -f ausgabe.yaml || { echo "[pipeline] Ce dossier n'est pas une revue (ausgabe.yaml introuvable) : $$PWD"; exit 1; }
	@test -n "$(SLUGS)" || { echo "[pipeline] Aucun article (articles/<nom>/<nom>.md) — déposez les Word dans $(WORD_DIR)/ puis enregistrez (Ctrl+S)."; exit 1; }
	@if ls -d articles/* 2>/dev/null | grep -q ' '; then \
	  echo "[pipeline] ⚠ Un dossier de articles/ contient des espaces — renommez-le sans espaces."; exit 1; \
	fi

# (Re)génère out/.szh-accent.css depuis la couleur annuelle d'ausgabe.yaml ; sans
# couleur, un fichier « commentaire seul » laisse jouer les gris de print.css.
$(ACCENT_CSS): ausgabe.yaml $(PIPELINE_DIR)/styles/couleurs.css \
              $(PIPELINE_DIR)/accent-css.py $(PIPELINE_DIR)/apca.py
	@mkdir -p "$(OUT)"
	@python3 "$(PIPELINE_DIR)/accent-css.py" ausgabe.yaml > "$@"

# .md -> HTML autonome (--embed-resources : images et CSS en base64). Exécuté dans le
# dossier de l'article, pour que media/ et tables/ soient relatifs au .md. Les tableaux
# extraits (tables/*.html) sont des prérequis : en éditer un recompile l'article.
# szh-citations.lua ferme la chaîne : il ancre la liste de références et transforme les
# appels du corps en liens internes. La liste elle-même n'est jamais réécrite.
$(OUT)/%.html: articles/$$(notdir $$*)/$$(notdir $$*).md ausgabe.yaml $(STYLE) $(ACCENT_CSS) $(TEMPLATE) $(FILTRES) $$(wildcard articles/$$(notdir $$*)/tables/*.html) $$(wildcard articles/$$(notdir $$*)/media/*) $$(wildcard articles/$$(notdir $$*)/portraits/*) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml)
	@mkdir -p "$(dir $@)"
	@slug="$(notdir $*)"; \
	meta=""; \
	if [ -f "articles/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	echo "pandoc articles/$$slug/$$slug.md -> $@"; \
	cd "articles/$$slug" && SZH_AUSGABE="$(abspath ausgabe.yaml)" $(PANDOC) "$$slug.md" \
	  --from=markdown --to=html5 \
	  --metadata-file="$(abspath ausgabe.yaml)" $$meta \
	  --standalone --embed-resources \
	  --template="$(TEMPLATE_ABS)" \
	  --css="$(STYLE_ABS)" --css="$(ACCENT_ABS)" \
	  --lua-filter="$(MAQUETTE_LUA)" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-niveaux.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-scope.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-numerotation.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-legende-avant.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-citations.lua" \
	  --output="$(abspath $@)"

# .md -> HTML d'aperçu : mêmes filtres, CSS et métadonnées que la sortie PDF, mais
# reader commonmark_x+sourcepos -> chaque bloc porte data-pos, ce qui permet le clic
# vers le texte source dans la webview. Consommé par le cockpit seulement.
$(OUT)/%.apercu.html: articles/$$(notdir $$*)/$$(notdir $$*).md ausgabe.yaml $(STYLE) $(ACCENT_CSS) $(FILTRES) $$(wildcard articles/$$(notdir $$*)/tables/*.html) $$(wildcard articles/$$(notdir $$*)/media/*) $$(wildcard articles/$$(notdir $$*)/portraits/*) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml)
	@mkdir -p "$(dir $@)"
	@slug="$(notdir $*)"; \
	meta=""; \
	if [ -f "articles/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	echo "pandoc articles/$$slug/$$slug.md -> $@ (aperçu sourcepos)"; \
	cd "articles/$$slug" && SZH_APERCU=1 $(PANDOC) "$$slug.md" \
	  --from=commonmark_x+sourcepos --to=html5 \
	  --metadata-file="$(abspath ausgabe.yaml)" $$meta \
	  --standalone --embed-resources \
	  --css="$(STYLE_ABS)" --css="$(ACCENT_ABS)" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-niveaux.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-scope.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-numerotation.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-legende-avant.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-citations.lua" \
	  --output="$(abspath $@)" || \
	printf '%s' '<!DOCTYPE html><html lang="fr"><body><p>Aperçu HTML indisponible pour cet article (le PDF, lui, est compilé) : voir le panneau de compilation.</p></body></html>' > "$(abspath $@)"

# HTML -> PDF (CSS Paged Media), balisé PDF/UA-1. WeasyPrint 69 : --pdf-variant
# pdf/ua-1 pose /StructTreeRoot, /MarkInfo /Marked true, /Lang et les StructElem.
# Repli automatique si la variante stricte échoue (--pdf-tags, puis PDF nu) : le
# balisage ne doit pas faire échouer le build. Temporaire « ~$… » dans le même
# dossier : rename local, ignoré par la synchro OneDrive, donc pas de PDF partiel.
# Quotes simples : $0 et $notdir ne doivent pas être substitués par make.
$(OUT)/%.pdf: $(OUT)/%.html
	@tmp='$(dir $@)~$$$(notdir $@)'; \
	if $(WEASYPRINT) --pdf-variant pdf/ua-1 $< "$$tmp" 2>/dev/null; then :; \
	elif $(WEASYPRINT) --pdf-tags $< "$$tmp" 2>/dev/null; then \
	  echo "[pipeline] PDF/UA-1 indisponible -> PDF balisé simple : $@"; \
	else \
	  echo "[pipeline] balisage PDF indisponible -> PDF non balisé : $@"; \
	  $(WEASYPRINT) $< "$$tmp"; \
	fi; \
	mv -f "$$tmp" $@

# HTML autonome -> DOCX : galley Word de l'export OJS, régénéré depuis le HTML final
# et non depuis le .md — le reader html de pandoc comprend les tableaux réinjectés en
# HTML brut (colspan/rowspan) et les images data:, que le writer docx nourri au .md
# perdrait. Produit à la demande, hors de `all` et de `tout-exporter`.
# szh-galley-docx.lua retire les blocs purement techniques (.szh-description, cible
# des aria-describedby) : le reader html ne voit pas le CSS, et ce que print.css
# masque réapparaîtrait en clair sous chaque tableau du galley.
$(OUT)/%.docx: $(OUT)/%.html $(PIPELINE_DIR)/filters/szh-galley-docx.lua
	@echo "pandoc $< -> $@ (docx)"
	@$(PANDOC) "$<" --from=html --to=docx \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-galley-docx.lua" --output="$@"

docx: verifie-dossier $(DOCXS)

# Conversion des .docx déposés dans articles-word/. Les anciens articles « à plat » sont
# migrés au passage vers articles/<slug>/ ; un article existant n'est jamais écrasé ; une
# conversion réussie supprime le .docx source, un échec ou un « déjà converti » le laisse
# en place et déclenche le rollback rm -rf articles/<slug> ci-dessous.
# Slug : un nom commençant par un chiffre seul (« 4_Titre ») est complété à deux chiffres
# (« 04-titre »), de sorte que le tri alphabétique donne l'ordre du numéro. Longueur bornée
# à 39 caractères, parce que le slug nomme le dossier et son .md homonyme et compte donc
# quatre fois dans un chemin de sortie : sans borne, un titre réel dépasse la limite
# Windows de 260 caractères et la synchronisation SharePoint trébuche. La coupe tombe sur
# le dernier mot entier, les fragments d'élision d'une lettre (« -d », « -l ») sont retirés
# à leur tour, et la coupe sèche sert de repli sans tiret.
# À garder aligné avec slugifierArticle() de vscodium-extension/szh-cockpit/lib/slug.js :
# le cockpit devine le slug d'un .docx en attente pour dire « déjà converti ».
import:
	@set -u; \
	shopt -s nullglob; \
	for m in articles/*.md; do \
	  base=$$(basename "$$m" .md); \
	  mkdir -p "articles/$$base/media"; \
	  mv "$$m" "articles/$$base/$$base.md"; \
	  if [ -d "articles/media/$$base" ]; then \
	    cp -r "articles/media/$$base/." "articles/$$base/media/" && rm -rf "articles/media/$$base"; \
	  fi; \
	  sed -i "s|articles/media/$$base/|media/|g" "articles/$$base/$$base.md"; \
	  echo "[import] structure migrée : $$m -> articles/$$base/$$base.md"; \
	done; \
	rmdir articles/media 2>/dev/null || true; \
	for d in articles/*/; do \
	  slug=$$(basename "$$d"); \
	  if [ -d "$$d/media/media" ]; then \
	    cp -r "$$d/media/media/." "$$d/media/" && rm -rf "$$d/media/media"; \
	    if [ -f "$$d/$$slug.md" ]; then sed -i 's|media/media/|media/|g' "$$d/$$slug.md"; fi; \
	    echo "[import] media aplati : $${d}media/media -> $${d}media"; \
	  fi; \
	done; \
	[ -d "$(WORD_DIR)" ] || exit 0; \
	shopt -s nocaseglob; \
	files=("$(WORD_DIR)"/*.docx); \
	shopt -u nocaseglob; \
	[ $${#files[@]} -gt 0 ] || exit 0; \
	mkdir -p articles; \
	journal="$(WORD_DIR)/.import.log"; \
	: > "$$journal"; \
	dire() { echo "$$*"; printf '%s\n' "$$*" >> "$$journal"; }; \
	ok=0; deja=0; rate=0; \
	for f in "$${files[@]}"; do \
	  nom=$$(basename "$$f"); slug="$${nom%.*}"; \
	  slug=$$(printf '%s' "$$slug" | LC_ALL=C.UTF-8 iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$$slug"); \
	  slug=$$(printf '%s' "$$slug" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$$//'); \
	  [ -n "$$slug" ] || slug=article; \
	  slug=$$(printf '%s' "$$slug" | sed -E 's/^([0-9])($$|[^0-9])/0\1\2/'); \
	  if [ $${#slug} -gt 39 ]; then scourt="$${slug:0:39}"; scourt="$${scourt%-*}"; sorph=$$(printf '%s' "$$scourt" | sed -E 's/(-[a-z0-9])+$$//'); case "$$sorph" in *-*) scourt="$$sorph";; esac; slug="$${scourt:-$${slug:0:39}}"; fi; \
	  cible="articles/$$slug/$$slug.md"; \
	  if [ -e "$$cible" ]; then \
	    dire "[import] déjà converti (ignoré) : $$nom -> $$cible existe"; deja=$$((deja+1)); continue; \
	  fi; \
	  if bash "$(PIPELINE_DIR)/import-docx.sh" "$$f" "$$slug" "$(PIPELINE_DIR)"; then \
	    rm -f "$$f"; \
	    dire "[import] converti : $$nom -> $$cible"; ok=$$((ok+1)); \
	  else \
	    rm -rf "articles/$$slug"; \
	    dire "[import] ⚠ échec sur : $$nom (le fichier reste dans $(WORD_DIR)/)"; rate=$$((rate+1)); \
	  fi; \
	done; \
	dire "[import] terminé : $$ok converti(s), $$deja ignoré(s), $$rate échec(s)."; \
	[ $$rate -eq 0 ]

clean:
	rm -rf "$(OUT)"
