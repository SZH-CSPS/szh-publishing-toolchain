# Pipeline central SZH/CSPS — .md -> Pandoc (citeproc) -> WeasyPrint -> PDF (+ HTML) par article.
# Vit dans le toolkit (C:\ProgramData\SZH\toolkit\pipeline), PAS dans les dossiers de revue.
# S'invoque DEPUIS le dossier de revue (cwd), le Makefile étant passé par -f :
#   wsl.exe -d SZH-Publishing --cd <dossier revue> -- make -f /mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile all
#
# Structure de travail (D26) :  articles/<article>/<article>.md  + articles/<article>/media/
# Sorties (D21)              :  out/<article>/<article>.pdf + <article>.html (autonome, images base64)
# Import Word (D27-D30)      :  filters/szh-import.lua + AnyStyle + filters/szh-citations.lua
#                               + rapport de conversion trilingue (rapport.py)
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

# Langue du numéro (bibliographie, :lang du rendu) — lue dans ausgabe.yaml, défaut fr.
LANG_LUE   := $(shell sed -n 's/^lang:[[:space:]]*\([a-zA-Z-]*\).*/\1/p' ausgabe.yaml 2>/dev/null | head -1)
LANG_REVUE := $(if $(LANG_LUE),$(LANG_LUE),fr)

# Articles : un dossier par article, articles/<slug>/<slug>.md (D26).
SLUGS      := $(sort $(foreach d,$(wildcard articles/*),$(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
OUT        := out
PDFS       := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).pdf)
HTMLS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).html)

# Sans ceci, make considérerait les .html comme intermédiaires et les SUPPRIMERAIT.
.SECONDARY: $(HTMLS)

# Import Word/LibreOffice
WORD_DIR   := articles-word
DONE_DIR   := $(WORD_DIR)/_convertis

.PHONY: all pdf import clean verifie-dossier
.SECONDEXPANSION:

# Cible du build (Ctrl+S, Ctrl+E) : importe les Word déposés PUIS régénère les sorties.
# Deux sous-make pour que les articles fraîchement convertis soient vus par la passe pdf.
all:
	-@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) pdf

pdf: verifie-dossier $(PDFS)

verifie-dossier:
	@test -f ausgabe.yaml || { echo "[pipeline] Ce dossier n'est pas une revue (ausgabe.yaml introuvable) : $$PWD"; exit 1; }
	@test -n "$(SLUGS)" || { echo "[pipeline] Aucun article (articles/<nom>/<nom>.md) — déposez les Word dans $(WORD_DIR)/ puis enregistrez (Ctrl+S)."; exit 1; }
	@if ls -d articles/* 2>/dev/null | grep -q ' '; then \
	  echo "[pipeline] ⚠ Un dossier de articles/ contient des espaces — renommez-le sans espaces."; exit 1; \
	fi

# .md -> HTML autonome (--embed-resources : images/CSS en base64, zéro dépendance).
# Exécuté DANS le dossier de l'article (chemins media/ relatifs au .md).
# citeproc + CSL APA seulement si l'article a une bibliographie (media/<slug>.bib).
$(OUT)/%.html: articles/$$(notdir $$*)/$$(notdir $$*).md ausgabe.yaml $(STYLE)
	@mkdir -p "$(dir $@)"
	@slug="$(notdir $*)"; \
	extra=""; \
	if [ -s "articles/$$slug/media/$$slug.bib" ]; then extra="--citeproc --csl=$(CSL)"; fi; \
	echo "pandoc articles/$$slug/$$slug.md -> $@ $$extra"; \
	cd "articles/$$slug" && $(PANDOC) "$$slug.md" \
	  --from=markdown --to=html5 \
	  --metadata-file="$(abspath ausgabe.yaml)" \
	  --standalone --embed-resources \
	  --css="$(STYLE_ABS)" $$extra \
	  --output="$(abspath $@)"
	# ⇩ REMPLACER ici par le template HTML/filtres finaux de la maquette si besoin.

# HTML -> PDF (CSS Paged Media). Temporaire « ~$… » dans le MÊME dossier :
# rename local + ignoré par la synchro OneDrive -> jamais de PDF partiel.
# ⚠ Quotes SIMPLES obligatoires ($0 serait substitué entre guillemets doubles).
$(OUT)/%.pdf: $(OUT)/%.html
	$(WEASYPRINT) $< '$(dir $@)~$$$(notdir $@)'
	mv -f '$(dir $@)~$$$(notdir $@)' $@

# Conversion des Word/LibreOffice déposés dans articles-word/ (D12, D26-D30) :
#  - migre au passage les anciens articles « à plat » vers articles/<slug>/ ;
#  - jamais d'écrasement d'un article existant ; originaux -> _convertis/ ;
#  - import complet : structure + figures + références (AnyStyle) + citations liées
#    + rapport de conversion trilingue <slug>-rapport.html.
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
	[ -d "$(WORD_DIR)" ] || exit 0; \
	shopt -s nocaseglob; \
	files=("$(WORD_DIR)"/*.docx "$(WORD_DIR)"/*.odt); \
	shopt -u nocaseglob; \
	[ $${#files[@]} -gt 0 ] || exit 0; \
	mkdir -p articles "$(DONE_DIR)"; \
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
	  if bash "$(PIPELINE_DIR)/import-docx.sh" "$$f" "$$slug" "$(PIPELINE_DIR)" "$(LANG_REVUE)"; then \
	    mv -f "$$f" "$(DONE_DIR)/"; \
	    echo "[import] converti : $$nom -> $$cible (+ rapport $$slug-rapport.html)"; ok=$$((ok+1)); \
	  else \
	    rm -rf "articles/$$slug"; \
	    echo "[import] ⚠ échec sur : $$nom (le fichier reste dans $(WORD_DIR)/)"; rate=$$((rate+1)); \
	  fi; \
	done; \
	echo "[import] terminé : $$ok converti(s), $$deja ignoré(s), $$rate échec(s)."; \
	[ $$rate -eq 0 ]

clean:
	rm -rf "$(OUT)"
