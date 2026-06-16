# Source de vérité du pipeline. Tourne DANS WSL, lit les fichiers sur /mnt/c (OneDrive).
# Chemins RELATIFS -> indépendant de l'emplacement OneDrive.
# ⚠ Conserver l'indentation par TABULATIONS et les fins de ligne LF.

PANDOC     ?= pandoc
WEASYPRINT ?= weasyprint
STYLE      := styles/print.css
OUT        := out
ARTICLES   := $(sort $(wildcard articles/*.md))
HTML       := $(OUT)/revue.html
PDF        := $(OUT)/revue.pdf
TMP        := $(OUT)/.revue.tmp.pdf

.PHONY: pdf clean
pdf: $(PDF)

$(OUT):
	mkdir -p $(OUT)

# .md (+ dossier.yaml + front-matter) -> HTML
$(HTML): $(ARTICLES) dossier.yaml $(STYLE) | $(OUT)
	$(PANDOC) \
	  --from=markdown --to=html5 \
	  --metadata-file=dossier.yaml \
	  --standalone --css=$(STYLE) \
	  $(ARTICLES) --output=$@
	# ⇩ REMPLACER par ta commande Pandoc réelle :
	#   template HTML, filtres lua, sommaire latéral, pages de garde par article…

# HTML -> PDF (CSS Paged Media / PDF-UA), écriture ATOMIQUE pour éviter
# les copies de conflit OneDrive pendant la synchro.
$(PDF): $(HTML)
	$(WEASYPRINT) $< $(TMP)
	mv -f $(TMP) $@

clean:
	rm -rf $(OUT)
