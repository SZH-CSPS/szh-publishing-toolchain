# Pipeline central SZH/CSPS — .md -> Pandoc (citeproc) -> WeasyPrint -> PDF (+ HTML) par article.
# Vit dans le toolkit (C:\ProgramData\SZH\toolkit\pipeline), PAS dans les dossiers de revue.
# S'invoque DEPUIS le dossier de revue (cwd), le Makefile étant passé par -f :
#   wsl.exe -d SZH-Publishing --cd <dossier revue> -- make -f /mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile all
#
# Structure de travail (D26) :  articles/<article>/<article>.md  + articles/<article>/media/
# Sorties (D21)              :  out/<article>/<article>.pdf + <article>.html (autonome, images base64)
# Import Word (D35)          :  import-docx.sh = pandoc nu + filters/szh-tabelle-platzhalter.lua
#                               (chaque tableau -> {{TABELLE NN}}). Heuristiques D27-D30
#                               débranchées dans pipeline/attic/ (réactivables, cf. git).
#
# ⚠ Aucun chemin /mnt/c codé en dur ici (portabilité macOS, PLANIFICATION.md §6).
# ⚠ Conserver l'indentation par TABULATIONS et les fins de ligne LF.

SHELL      := /bin/bash
PANDOC     ?= pandoc
WEASYPRINT ?= weasyprint

# Chemin absolu de CE Makefile (pour la récursion de la cible `all`).
THIS         := $(abspath $(lastword $(MAKEFILE_LIST)))
PIPELINE_DIR := $(patsubst %/,%,$(dir $(THIS)))

# Style : override local si la revue fournit styles/print.css, sinon style central.
STYLE      := $(firstword $(wildcard styles/print.css) $(PIPELINE_DIR)/styles/print.css)
STYLE_ABS  := $(abspath $(STYLE))
CSL        := $(PIPELINE_DIR)/csl/apa.csl

# Maquette définitive (D69–D74) : template pandoc de la couverture + filtre Lua qui
# dérive les métadonnées de couverture/en-tête (étiquette de dossier D71, revue D74).
TEMPLATE     := $(PIPELINE_DIR)/templates/szh-article.html
TEMPLATE_ABS := $(abspath $(TEMPLATE))
MAQUETTE_LUA := $(PIPELINE_DIR)/filters/szh-maquette.lua

# Langue du numéro (bibliographie, :lang du rendu) — lue dans ausgabe.yaml, défaut fr.
LANG_LUE   := $(shell sed -n 's/^lang:[[:space:]]*\([a-zA-Z-]*\).*/\1/p' ausgabe.yaml 2>/dev/null | head -1)
LANG_REVUE := $(if $(LANG_LUE),$(LANG_LUE),fr)

# Articles : un dossier par article, articles/<slug>/<slug>.md (D26).
SLUGS      := $(sort $(foreach d,$(wildcard articles/*),$(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
OUT        := out
PDFS       := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).pdf)
HTMLS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).html)
# Aperçu HTML cliquable (D53/M5) : rendu SÉPARÉ en commonmark_x+sourcepos (le
# spike M5 montre que ce reader ajoute des divs « wrapper » -> il ne doit PAS
# nourrir WeasyPrint ; le PDF reste sur -f markdown, inchangé par construction).
APERCUS    := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).apercu.html)

# Accent des tableaux (.szh-tableau, D57) : accent-css.py lit la couleur annuelle
# d'ausgabe.yaml et écrit un :root qui SURCHARGE les gris de repli de print.css.
# Aucune couleur -> fichier « commentaire seul » -> gris de repli -> PDF inchangé.
# Prérequis des HTML : le changer (via les métadonnées) recompile les articles.
ACCENT_CSS := $(OUT)/.szh-accent.css
ACCENT_ABS := $(abspath $(ACCENT_CSS))

# Sans ceci, make considérerait les .html comme intermédiaires et les SUPPRIMERAIT.
.SECONDARY: $(HTMLS) $(APERCUS)

# Import Word (D35) — le .docx source est SUPPRIMÉ après conversion réussie (D39).
WORD_DIR   := articles-word

.PHONY: all pdf import clean verifie-dossier tout-exporter
.SECONDEXPANSION:

# Cible du build (Ctrl+S, Ctrl+E) : importe les Word déposés PUIS régénère les sorties.
# Deux sous-make pour que les articles fraîchement convertis soient vus par la passe pdf.
all:
	-@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) pdf

# Rebuild FORCÉ de toute la revue (D44) : clean puis all — ignore les dates de
# fichiers. Distinct du build incrémental de Ctrl+S. Le « - » sur clean : un PDF
# verrouillé côté Windows ne doit pas empêcher la régénération (elle écrasera).
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

# Accent des tableaux (D57) : (re)génère out/.szh-accent.css depuis la couleur
# annuelle d'ausgabe.yaml (repli commentaire seul si aucune couleur -> gris de
# print.css). stdlib python3 (comme docx-tables.py), aucun /mnt/c en dur.
$(ACCENT_CSS): ausgabe.yaml
	@mkdir -p "$(OUT)"
	@python3 "$(PIPELINE_DIR)/accent-css.py" ausgabe.yaml > "$@"

# .md -> HTML autonome (--embed-resources : images/CSS en base64, zéro dépendance).
# Exécuté DANS le dossier de l'article (chemins media/ et tables/ relatifs au .md).
# citeproc + CSL APA seulement si l'article a une bibliographie (media/<slug>.bib).
# Les tableaux extraits (tables/*.html, D47) sont des PRÉREQUIS : en éditer un
# déclenche la recompilation de l'article (SECONDEXPANSION déjà active).
$(OUT)/%.html: articles/$$(notdir $$*)/$$(notdir $$*).md ausgabe.yaml $(STYLE) $(ACCENT_CSS) $(TEMPLATE) $(MAQUETTE_LUA) $$(wildcard articles/$$(notdir $$*)/tables/*.html) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml)
	@mkdir -p "$(dir $@)"
	@slug="$(notdir $*)"; \
	extra=""; \
	if [ -s "articles/$$slug/media/$$slug.bib" ]; then extra="--citeproc --csl=$(CSL)"; fi; \
	meta=""; \
	if [ -f "articles/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	echo "pandoc articles/$$slug/$$slug.md -> $@ $$extra"; \
	cd "articles/$$slug" && SZH_AUSGABE="$(abspath ausgabe.yaml)" $(PANDOC) "$$slug.md" \
	  --from=markdown --to=html5 \
	  --metadata-file="$(abspath ausgabe.yaml)" $$meta \
	  --standalone --embed-resources \
	  --template="$(TEMPLATE_ABS)" \
	  --css="$(STYLE_ABS)" --css="$(ACCENT_ABS)" \
	  --lua-filter="$(MAQUETTE_LUA)" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" $$extra \
	  --output="$(abspath $@)"

# .md -> HTML d'APERÇU (D53) : mêmes filtres/CSS/métadonnées que la sortie PDF,
# mais reader commonmark_x+sourcepos -> chaque bloc porte data-pos (position
# source pour le clic->texte de la webview). Consommé par le cockpit uniquement.
$(OUT)/%.apercu.html: articles/$$(notdir $$*)/$$(notdir $$*).md ausgabe.yaml $(STYLE) $(ACCENT_CSS) $$(wildcard articles/$$(notdir $$*)/tables/*.html) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml)
	@mkdir -p "$(dir $@)"
	@slug="$(notdir $*)"; \
	extra=""; \
	if [ -s "articles/$$slug/media/$$slug.bib" ]; then extra="--citeproc --csl=$(CSL)"; fi; \
	meta=""; \
	if [ -f "articles/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	echo "pandoc articles/$$slug/$$slug.md -> $@ (aperçu sourcepos)"; \
	cd "articles/$$slug" && $(PANDOC) "$$slug.md" \
	  --from=commonmark_x+sourcepos --to=html5 \
	  --metadata-file="$(abspath ausgabe.yaml)" $$meta \
	  --standalone --embed-resources \
	  --css="$(STYLE_ABS)" --css="$(ACCENT_ABS)" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" $$extra \
	  --output="$(abspath $@)" || \
	printf '%s' '<!DOCTYPE html><html lang="fr"><body><p>Aperçu HTML indisponible pour cet article (le PDF, lui, est compilé) : voir le panneau de compilation.</p></body></html>' > "$(abspath $@)"

# HTML -> PDF (CSS Paged Media). Temporaire « ~$… » dans le MÊME dossier :
# rename local + ignoré par la synchro OneDrive -> jamais de PDF partiel.
# ⚠ Quotes SIMPLES obligatoires ($0 serait substitué entre guillemets doubles).
$(OUT)/%.pdf: $(OUT)/%.html
	$(WEASYPRINT) $< '$(dir $@)~$$$(notdir $@)'
	mv -f '$(dir $@)~$$$(notdir $@)' $@

# Conversion des Word déposés dans articles-word/ (D12, D26, D35, D39) :
#  - migre au passage les anciens articles « à plat » vers articles/<slug>/ ;
#  - jamais d'écrasement d'un article existant (D12) ;
#  - converti avec succès -> le .docx source est SUPPRIMÉ (D39, plus de _convertis/) ;
#    « déjà converti (ignoré) » ou échec -> le .docx RESTE dans articles-word/ ;
#  - import simplifié : structure pandoc nue + placeholders {{TABELLE NN}} (D35).
#  - .docx uniquement (D35 : un seul chemin d'import).
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
	    echo "[import] media aplati (D45) : $${d}media/media -> $${d}media"; \
	  fi; \
	done; \
	[ -d "$(WORD_DIR)" ] || exit 0; \
	shopt -s nocaseglob; \
	files=("$(WORD_DIR)"/*.docx); \
	shopt -u nocaseglob; \
	[ $${#files[@]} -gt 0 ] || exit 0; \
	mkdir -p articles; \
	ok=0; deja=0; rate=0; \
	for f in "$${files[@]}"; do \
	  nom=$$(basename "$$f"); slug="$${nom%.*}"; \
	  slug=$$(printf '%s' "$$slug" | LC_ALL=C.UTF-8 iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$$slug"); \
	  slug=$$(printf '%s' "$$slug" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$$//'); \
	  [ -n "$$slug" ] || slug=article; \
	  cible="articles/$$slug/$$slug.md"; \
	  if [ -e "$$cible" ]; then \
	    echo "[import] déjà converti (ignoré) : $$nom -> $$cible existe"; deja=$$((deja+1)); continue; \
	  fi; \
	  if bash "$(PIPELINE_DIR)/import-docx.sh" "$$f" "$$slug" "$(PIPELINE_DIR)"; then \
	    rm -f "$$f"; \
	    echo "[import] converti : $$nom -> $$cible"; ok=$$((ok+1)); \
	  else \
	    rm -rf "articles/$$slug"; \
	    echo "[import] ⚠ échec sur : $$nom (le fichier reste dans $(WORD_DIR)/)"; rate=$$((rate+1)); \
	  fi; \
	done; \
	echo "[import] terminé : $$ok converti(s), $$deja ignoré(s), $$rate échec(s)."; \
	[ $$rate -eq 0 ]

clean:
	rm -rf "$(OUT)"
