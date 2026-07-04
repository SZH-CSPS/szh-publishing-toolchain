# Pipeline central SZH/CSPS — .md -> Pandoc -> WeasyPrint -> PDF (+ HTML) par article.
# Vit dans le toolkit (C:\ProgramData\SZH\toolkit\pipeline), PAS dans les dossiers de revue.
# S'invoque DEPUIS le dossier de revue (cwd), le Makefile étant passé par -f :
#   wsl.exe -d SZH-Publishing --cd <dossier revue> -- make -f /mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile all
#
# Sorties (D21) : un dossier PAR ARTICLE -> out/<article>/<article>.pdf + <article>.html
#   (HTML : sortie Pandoc brute pour l'instant ; la version « responsive » propre la remplacera ici.)
#
# ⚠ Aucun chemin /mnt/c codé en dur ici (portabilité macOS, PLANIFICATION.md §6) :
#   tout est relatif au dossier de revue (cwd) ou au dossier de CE Makefile.
# ⚠ Conserver l'indentation par TABULATIONS et les fins de ligne LF.

SHELL      := /bin/bash
PANDOC     ?= pandoc
WEASYPRINT ?= weasyprint

# Chemin absolu de CE Makefile (pour la récursion de la cible `all`).
THIS         := $(abspath $(lastword $(MAKEFILE_LIST)))
# Dossier du pipeline = dossier de ce Makefile (styles centraux, futurs filtres Lua).
PIPELINE_DIR := $(patsubst %/,%,$(dir $(THIS)))

# Style : override local si la revue fournit styles/print.css (p. ex. pour figer un
# numéro face à un changement de maquette), sinon style central du toolkit.
STYLE      := $(firstword $(wildcard styles/print.css) $(PIPELINE_DIR)/styles/print.css)

ARTICLES   := $(sort $(wildcard articles/*.md))
SLUGS      := $(basename $(notdir $(ARTICLES)))
OUT        := out

# Cibles : out/<article>/<article>.pdf + .html (les deux sont des livrables).
PDFS       := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).pdf)
HTMLS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).html)

# Sans ceci, make considérerait les .html comme intermédiaires de la chaîne de
# pattern rules et les SUPPRIMERAIT après la génération du PDF.
.SECONDARY: $(HTMLS)

# Import Word/LibreOffice (cible `import`)
WORD_DIR   := articles-word
DONE_DIR   := $(WORD_DIR)/_convertis
MEDIA_DIR  := articles/media

.PHONY: all pdf import clean verifie-dossier
.SECONDEXPANSION:

# Cible du build (Ctrl+S, Ctrl+E) : importe d'abord les Word éventuellement déposés,
# PUIS régénère les sorties. Deux sous-make séparés pour que les .md fraîchement
# convertis soient vus par la passe pdf (les wildcards sont réévalués au 2e make).
# Le « - » rend l'import non bloquant : un Word corrompu n'empêche pas les autres sorties.
all:
	-@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) pdf

pdf: verifie-dossier $(PDFS)

verifie-dossier:
	@test -f ausgabe.yaml || { echo "[pipeline] Ce dossier n'est pas une revue (ausgabe.yaml introuvable) : $$PWD"; exit 1; }
	@test -n "$(ARTICLES)" || { echo "[pipeline] Aucun article dans articles/*.md — déposez les Word dans $(WORD_DIR)/ puis enregistrez (Ctrl+S)."; exit 1; }
	@if ls articles/*.md 2>/dev/null | grep -q ' '; then \
	  echo "[pipeline] ⚠ Un fichier de articles/ contient des espaces — renommez-le sans espaces (ex. mon-article.md)."; exit 1; \
	fi

# .md (+ ausgabe.yaml + front-matter) -> HTML autonome (--embed-resources : images et
# CSS inlinés). Livrable HTML « brut » pour l'instant — la sortie responsive propre
# remplacera template et CSS ici (D21).
$(OUT)/%.html: articles/$$(notdir $$*).md ausgabe.yaml $(STYLE)
	@mkdir -p "$(dir $@)"
	$(PANDOC) \
	  --from=markdown --to=html5 \
	  --metadata-file=ausgabe.yaml \
	  --standalone --embed-resources \
	  --css=$(STYLE) \
	  "articles/$(notdir $*).md" --output=$@
	# ⇩ REMPLACER par la commande Pandoc réelle de la maquette :
	#   template HTML, filtres lua ($(PIPELINE_DIR)/filters/), pages de garde…

# HTML -> PDF (CSS Paged Media). Écriture quasi atomique : le temporaire est écrit
# dans le MÊME dossier (rename local) et son préfixe « ~$ » l'exclut de la synchro
# OneDrive (convention Office) -> jamais de PDF partiel synchronisé.
# ⚠ Quotes SIMPLES obligatoires : entre guillemets doubles, bash substituerait
#   « $0… » (~$01-exemple.pdf -> ~/bin/bash…). $$ = un $ littéral pour make.
$(OUT)/%.pdf: $(OUT)/%.html
	$(WEASYPRINT) $< '$(dir $@)~$$$(notdir $@)'
	mv -f '$(dir $@)~$$$(notdir $@)' $@

# Conversion des Word/LibreOffice finalisés déposés dans articles-word/ (D12).
#  - ne convertit JAMAIS par-dessus un .md existant (le .md est la copie de travail) ;
#  - originaux déplacés dans articles-word/_convertis/ après succès ;
#  - images extraites dans articles/media/<nom>/ ;
#  - silencieux s'il n'y a rien à faire (lancé à l'ouverture et à chaque build).
import:
	@set -u; \
	[ -d "$(WORD_DIR)" ] || exit 0; \
	shopt -s nullglob nocaseglob; \
	files=("$(WORD_DIR)"/*.docx "$(WORD_DIR)"/*.odt); \
	shopt -u nocaseglob; \
	[ $${#files[@]} -gt 0 ] || exit 0; \
	mkdir -p articles "$(MEDIA_DIR)" "$(DONE_DIR)"; \
	ok=0; deja=0; rate=0; \
	for f in "$${files[@]}"; do \
	  nom=$$(basename "$$f"); slug="$${nom%.*}"; \
	  slug=$$(printf '%s' "$$slug" | LC_ALL=C.UTF-8 iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$$slug"); \
	  slug=$$(printf '%s' "$$slug" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$$//'); \
	  [ -n "$$slug" ] || slug=article; \
	  cible="articles/$$slug.md"; \
	  if [ -e "$$cible" ]; then \
	    echo "[import] déjà converti (ignoré) : $$nom -> $$cible existe"; deja=$$((deja+1)); continue; \
	  fi; \
	  if $(PANDOC) "$$f" --to=markdown --wrap=none --markdown-headings=atx \
	       --track-changes=accept --extract-media="$(MEDIA_DIR)/$$slug" \
	       --output="$$cible"; then \
	    mv -f "$$f" "$(DONE_DIR)/"; \
	    echo "[import] converti : $$nom -> $$cible"; ok=$$((ok+1)); \
	  else \
	    echo "[import] ⚠ échec sur : $$nom (le fichier reste dans $(WORD_DIR)/)"; rate=$$((rate+1)); \
	  fi; \
	done; \
	echo "[import] terminé : $$ok converti(s), $$deja ignoré(s), $$rate échec(s)."; \
	[ $$rate -eq 0 ]

clean:
	rm -rf "$(OUT)"
