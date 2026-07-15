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
# Pas de --css ici : un href relatif serait résolu depuis out/ -> introuvable.
# La feuille de style est appliquée par WeasyPrint (-s) à l'étape PDF.
$(HTML): $(ARTICLES) dossier.yaml | $(OUT)
	$(PANDOC) \
	  --from=markdown --to=html5 \
	  --metadata-file=dossier.yaml \
	  --standalone \
	  $(ARTICLES) --output=$@
	# ⇩ REMPLACER par ta commande Pandoc réelle :
	#   template HTML, filtres lua, sommaire latéral, pages de garde par article…

# HTML -> PDF (CSS Paged Media / PDF-UA), écriture ATOMIQUE : WeasyPrint écrit
# un fichier temporaire puis mv le met en place. Indispensable car (1) anti-conflit
# OneDrive, (2) l'aperçu ouvert verrouille revue.pdf -> l'écriture EN PLACE échoue.
$(PDF): $(HTML) $(STYLE)
	$(WEASYPRINT) -s $(STYLE) $< $(TMP)
	mv -f $(TMP) $@

clean:
	rm -rf $(OUT)
