# Pipeline central SZH/CSPS — .md -> Pandoc -> WeasyPrint -> PDF.
# Vit dans le toolkit (C:\ProgramData\SZH\toolkit\pipeline), PAS dans les dossiers de revue.
# S'invoque DEPUIS le dossier de revue (cwd), le Makefile étant passé par -f :
#   wsl.exe -d SZH-Publishing --cd <dossier revue> -- make -f /mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile pdf
#
# ⚠ Aucun chemin /mnt/c codé en dur ici (portabilité macOS, PLANIFICATION.md §6) :
#   tout est relatif au dossier de revue (cwd) ou au dossier de CE Makefile.
# ⚠ Conserver l'indentation par TABULATIONS et les fins de ligne LF.

SHELL      := /bin/bash
PANDOC     ?= pandoc
WEASYPRINT ?= weasyprint

# Dossier du pipeline = dossier de ce Makefile (styles centraux, futurs filtres Lua).
PIPELINE_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

# Style : override local si la revue fournit styles/print.css (p. ex. pour figer un
# numéro face à un changement de maquette), sinon style central du toolkit.
STYLE      := $(firstword $(wildcard styles/print.css) $(PIPELINE_DIR)/styles/print.css)

ARTICLES   := $(sort $(wildcard articles/*.md))
PDF        := revue.pdf

# Intermédiaires HORS OneDrive (tmp WSL), isolés par dossier de revue :
# moins de churn de synchro, rien de technique visible dans le dossier.
WORKDIR    := /tmp/szh-publishing/$(shell pwd | md5sum | cut -c1-12)
HTML       := $(WORKDIR)/revue.html

# Écriture quasi atomique côté OneDrive : le PDF temporaire est écrit dans le MÊME
# dossier (rename local), et le préfixe « ~$ » l'exclut de la synchro OneDrive
# (convention des fichiers temporaires Office) -> jamais de PDF partiel synchronisé.
PDF_TMP    := ~$$revue.pdf

# Import Word/LibreOffice (cible `import`)
WORD_DIR   := articles-word
DONE_DIR   := $(WORD_DIR)/_convertis
MEDIA_DIR  := articles/media

.PHONY: pdf import clean verifie-dossier

pdf: verifie-dossier $(PDF)

verifie-dossier:
	@test -f dossier.yaml || { echo "[pipeline] Ce dossier n'est pas une revue (dossier.yaml introuvable) : $$PWD"; exit 1; }
	@test -n "$(ARTICLES)" || { echo "[pipeline] Aucun article dans articles/*.md — déposez les Word dans $(WORD_DIR)/ puis rouvrez la revue."; exit 1; }

$(WORKDIR):
	mkdir -p "$(WORKDIR)"

# .md (+ dossier.yaml + front-matter) -> HTML autonome. --embed-resources inline
# images et CSS -> WeasyPrint n'a plus besoin d'accéder au dossier de la revue.
$(HTML): $(ARTICLES) dossier.yaml $(STYLE) | $(WORKDIR)
	$(PANDOC) \
	  --from=markdown --to=html5 \
	  --metadata-file=dossier.yaml \
	  --standalone --embed-resources \
	  --css=$(STYLE) \
	  $(ARTICLES) --output=$@
	# ⇩ REMPLACER par la commande Pandoc réelle de la maquette :
	#   template HTML, filtres lua ($(PIPELINE_DIR)/filters/), sommaire, pages de garde…

# HTML -> PDF (CSS Paged Media), à la RACINE de la revue (D16).
$(PDF): $(HTML)
	$(WEASYPRINT) $< "$(PDF_TMP)"
	mv -f "$(PDF_TMP)" $@

# Conversion des Word/LibreOffice finalisés déposés dans articles-word/ (D12).
#  - ne convertit JAMAIS par-dessus un .md existant (le .md est la copie de travail) ;
#  - originaux déplacés dans articles-word/_convertis/ après succès ;
#  - images extraites dans articles/media/<nom>/ ;
#  - silencieux s'il n'y a rien à faire (la cible est lancée à l'ouverture de la revue).
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
	rm -rf "$(WORKDIR)" "$(PDF_TMP)" "$(PDF)"
