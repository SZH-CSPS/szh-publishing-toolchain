# Pipeline central SZH/CSPS — .md -> Pandoc (citeproc) -> WeasyPrint -> PDF (+ HTML) par article.
# Vit dans le toolkit (C:\ProgramData\SZH\toolkit\pipeline), PAS dans les dossiers de revue.
# S'invoque DEPUIS le dossier de revue (cwd), le Makefile étant passé par -f :
#   wsl.exe -d SZH-Publishing --cd <dossier revue> -- make -f /mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile all
#
# Structure de travail (D26) :  articles/<article>/<article>.md  + articles/<article>/media/
# Sorties (D21)              :  out/<article>/<article>.pdf + <article>.html (autonome, images base64)
# Import Word (D35, F6)      :  import-docx.sh = docx-meta.py (métadonnées ->
#                               <slug>.meta.yaml + blocs consommés) puis docx-tables.py
#                               (tables/*.html, D50) puis pandoc + filtres szh-meta ->
#                               szh-legendes -> szh-titres -> szh-biblio -> szh-tabelle-
#                               reference, et AnyStyle -> media/<slug>.bib (repli sans
#                               perte : liste conservée dans le .md si AnyStyle échoue).
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

# ---------------------------------------------------------------------------
# Profil de compilation du DOSSIER (D20, T6.4) — « un dossier = un produit = un
# moteur ». Lu dans ausgabe.yaml avec le MÊME mécanisme que lang: ci-dessus
# (sed + head), sans dépendance ajoutée : l'image WSL n'embarque pas PyYAML.
#
# ⚠ Piège central : `sed` renvoie une chaîne vide dans DEUX cas très différents —
#   (a) la clé `profil:` est absente du fichier (dossier « historique » : il doit
#       continuer à se compiler exactement comme avant, sans rien changer) ;
#   (b) la clé est là mais sans valeur (`profil:`), ce qui est un CHOIX explicite
#       du rédacteur : « ce dossier ne produit aucun document ».
#   Les deux se lisent « vide » : on détecte donc la PRÉSENCE de la clé à part,
#   par un compte de lignes (`grep -c '^profil:'`). L'ancrage `^` est ce qui rend
#   ce compte fiable : une ligne d'aide commentée (`# profil: …`, comme dans
#   revue-template/ausgabe.yaml) ou une clé imbriquée (indentée) ne comptent pas.
#   Fichier absent -> grep n'écrit rien -> chaîne vide -> traitée comme 0.
PROFIL_PRESENT := $(shell grep -c "^profil:" ausgabe.yaml 2>/dev/null | head -1)
# La valeur elle-même : on tolère les guillemets que pourrait écrire un
# sérialiseur (`profil: "article"`) et on s'arrête au premier caractère hors
# [a-zA-Z-] (espace, commentaire de fin de ligne, CR des fins de ligne Windows).
# Conséquence assumée : une valeur exotique/accentuée est tronquée -> elle tombe
# dans la branche « profil inconnu », qui échoue AVEC un message clair. Jamais
# de repli silencieux sur un autre profil.
PROFIL_LU      := $(shell sed -n "s/^profil:[[:space:]]*[\"']*\([a-zA-Z-]*\).*/\1/p" ausgabe.yaml 2>/dev/null | head -1)
PROFIL         := $(strip $(PROFIL_LU))
# Vide si la clé est absente (ou 0 occurrence) ; non vide sinon.
PROFIL_DECLARE := $(filter-out 0,$(PROFIL_PRESENT))

# Table de routage de la cible `all` (D20). Résolue à la LECTURE du Makefile :
# `make -n all` montre donc directement la route prise, sans exécuter pandoc.
ifeq ($(PROFIL_DECLARE),)
PROFIL_ROUTE := article
else ifeq ($(PROFIL),)
PROFIL_ROUTE := rien
else
PROFIL_ROUTE := $(PROFIL)
endif
# ---------------------------------------------------------------------------

# Articles : un dossier par article, articles/<slug>/<slug>.md (D26).
SLUGS      := $(sort $(foreach d,$(wildcard articles/*),$(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
OUT        := out
PDFS       := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).pdf)
HTMLS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).html)
# Diaporamas (profil `presentation`, D20) : un .pptx par article, écrit par le
# writer NATIF de pandoc (zéro ajout au rootfs). Liste calculée même si le profil
# n'est pas `presentation` — une liste inutilisée ne coûte rien et garde
# `make out/<slug>/<slug>.pptx` utilisable à la main pour un essai ponctuel.
PPTXS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).pptx)
# Aperçu HTML cliquable (D53/M5) : rendu SÉPARÉ en commonmark_x+sourcepos (le
# spike M5 montre que ce reader ajoute des divs « wrapper » -> il ne doit PAS
# nourrir WeasyPrint ; le PDF reste sur -f markdown, inchangé par construction).
APERCUS    := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).apercu.html)
# Galleys DOCX pour l'export OJS (F7) : régénérés depuis le HTML autonome, à la
# demande seulement (cible `docx`) — ni `all` ni `tout-exporter` ne les produisent.
DOCXS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).docx)

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

.PHONY: all pdf presentation docx import clean verifie-dossier tout-exporter \
        profil-rien profil-differe profil-inconnu
.SECONDEXPANSION:

# Cible du build (Ctrl+S, Ctrl+E) : importe les Word déposés PUIS régénère les sorties.
# Deux sous-make pour que les articles fraîchement convertis soient vus par la passe pdf.
#
# Dispatch du profil (D20) : les `ifeq` ci-dessous sont résolus à la lecture du
# Makefile, donc UNE SEULE des recettes existe pour un dossier donné. Le code de
# sortie compte autant que la route : dans l'éditeur, tout code non nul remonte en
# erreur rouge à chaque Ctrl+S. On n'échoue donc QUE si la configuration ne peut
# pas être honorée (`book` différé, valeur inconnue) — jamais pour un choix
# délibéré du rédacteur (profil vide).
ifeq ($(PROFIL_ROUTE),article)
# Clé `profil:` absente OU `profil: article` : comportement historique, à l'octet.
all:
	-@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) pdf
else ifeq ($(PROFIL_ROUTE),rien)
all: profil-rien
else ifeq ($(PROFIL_ROUTE),presentation)
all:
	-@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) presentation
else ifeq ($(PROFIL_ROUTE),book)
all: profil-differe
else
all: profil-inconnu
endif

# `profil:` présent et vide (D20) : choix explicite, PAS une panne -> sortie 0,
# message doux. Aucune erreur rouge dans l'éditeur, aucun dossier out/ créé.
profil-rien:
	@echo "[pipeline] profil vide dans ausgabe.yaml : ce dossier ne produit volontairement aucun document (D20). Rien à compiler."

# `profil: book` (D20) : moteur livre différé. Configuration légitime mais non
# honorable en l'état -> code non nul (le rédacteur doit savoir que son réglage
# reste sans effet, et non croire à une compilation silencieuse).
profil-differe:
	@echo "[pipeline] profil « book » : profil différé, non encore implémenté (D20)."
	@echo "[pipeline] En attendant : « article » (PDF + HTML par article) ou « presentation » (.pptx)."
	@exit 1

# Valeur non reconnue : on nomme la valeur reçue ET les valeurs acceptées, la
# faute de frappe étant le cas de très loin le plus probable. Code non nul.
profil-inconnu:
	@echo "[pipeline] profil inconnu dans ausgabe.yaml : « $(PROFIL) »"
	@echo "[pipeline] Valeurs acceptées (D20) : article (défaut) | presentation | book (différé) | vide (aucun document)."
	@exit 1

# Rebuild FORCÉ de toute la revue (D44) : clean puis all — ignore les dates de
# fichiers. Distinct du build incrémental de Ctrl+S. Le « - » sur clean : un PDF
# verrouillé côté Windows ne doit pas empêcher la régénération (elle écrasera).
tout-exporter:
	-@$(MAKE) --no-print-directory -f $(THIS) clean
	@$(MAKE) --no-print-directory -f $(THIS) all

pdf: verifie-dossier $(PDFS) $(APERCUS)

# Profil `presentation` (D20) : les .pptx SONT le produit du dossier, mais on
# régénère AUSSI les aperçus HTML — le cockpit n'affiche en volet d'aperçu que
# out/<slug>/<slug>.apercu.html (mode html) ou <slug>.pdf (mode pdf) ; sans les
# aperçus, la colonne 2 tomberait sur son repli « aperçu indisponible » alors que
# la compilation, elle, réussit. Les PDF ne sont PAS produits ici (le dossier a
# choisi un autre produit) : en mode pdf, le volet reste donc vide — le cockpit
# devra forcer le mode html quand le profil n'est pas `article` (T6.4, reste à faire).
presentation: verifie-dossier $(PPTXS) $(APERCUS)

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
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" $$extra \
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
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" $$extra \
	  --output="$(abspath $@)" || \
	printf '%s' '<!DOCTYPE html><html lang="fr"><body><p>Aperçu HTML indisponible pour cet article (le PDF, lui, est compilé) : voir le panneau de compilation.</p></body></html>' > "$(abspath $@)"

# .md -> .pptx (profil `presentation`, D20) : writer NATIF de pandoc, aucune
# dépendance ajoutée (ni WeasyPrint ni LibreOffice). Calquée sur la règle %.html,
# MOINS tout ce qui est propre au HTML : pas de --to=html5, --standalone,
# --embed-resources, --template ni --css (un pptx n'a ni feuille de style CSS ni
# gabarit HTML ; les passer ferait échouer ou serait ignoré).
# Le `cd articles/<slug>` reste OBLIGATOIRE : les liens media/… sont relatifs au
# .md, et c'est pandoc lui-même qui va lire les images pour les empaqueter.
#
# Filtres Lua — choix raisonné (les autres ne s'appliquent pas ici) :
#   * szh-figure.lua : GARDÉ. Il ne travaille que sur l'AST (Para{Image} -> Figure)
#     et le writer pptx sait rendre une Figure (image + légende sous l'image).
#     Avec le lecteur `markdown` il est quasi no-op (implicit_figures fait déjà le
#     travail) mais il garantit le même traitement des légendes que le PDF.
#   * szh-maquette.lua : ÉCARTÉ. Il ne calcule QUE des variables de gabarit
#     (couverture, en-tête courant, ISSN, résumés) consommées par
#     templates/szh-article.html — sans template HTML, sa sortie est inerte.
#   * szh-tabelle-inclure.lua : ÉCARTÉ. Il réinjecte les tableaux extraits (D47)
#     en RawBlock('html'), que le writer pptx ne peut pas convertir.
# ⚠ LIMITE CONNUE, assumée : les tableaux D47 (::: {.szh-tabelle src=…}) NE
#   figureront PAS dans le .pptx — leur contenu est du HTML brut, hors d'atteinte
#   d'un writer OOXML. Le texte de l'article, lui, est complet. Les faire passer
#   demanderait de reconstruire ces tableaux en AST Pandoc (chantier à part).
# citeproc/CSL : conservé à l'identique — la bibliographie est produite en blocs
# Pandoc, donc parfaitement rendue en pptx.
# Prérequis : ni les CSS ni le template ni tables/*.html ne sont listés, puisque
# aucun n'influence la sortie ; seuls le .md, ausgabe.yaml et le .meta.yaml (D49)
# le font. Le .pptx n'est donc pas reconstruit pour un changement de couleur.
# Découpage en diapositives : laissé au DÉFAUT de pandoc (le niveau de titre suivi
# de contenu). Mesuré sur test/articles/couverture-stress : 5 diapositives au défaut
# (le corps d'un article s'entasse sous son premier titre) contre 16 avec
# --slide-level=2, et AUCUNE perte de texte dans les deux cas (11 436 caractères
# extraits à l'identique). --slide-level=2 découpe donc mieux, mais transforme un
# paragraphe placé juste sous un titre de niveau 1 en diapositive « sans titre »
# dont la première phrase sert de titre. Aucun des deux n'est bon dans tous les cas :
# arbitrage laissé à l'usage réel, le levier tient en une option ici.
# Pas de --reference-doc dans ce dépôt (aucune maquette pptx SZH n'existe) :
# c'est LE levier à utiliser le jour où une charte graphique de diaporama est
# voulue (thème, polices, dispositions) — un .pptx modèle + --reference-doc=….
$(OUT)/%.pptx: articles/$$(notdir $$*)/$$(notdir $$*).md ausgabe.yaml $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml)
	@mkdir -p "$(dir $@)"
	@slug="$(notdir $*)"; \
	extra=""; \
	if [ -s "articles/$$slug/media/$$slug.bib" ]; then extra="--citeproc --csl=$(CSL)"; fi; \
	meta=""; \
	if [ -f "articles/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	echo "pandoc articles/$$slug/$$slug.md -> $@ (pptx) $$extra"; \
	cd "articles/$$slug" && $(PANDOC) "$$slug.md" \
	  --from=markdown --to=pptx \
	  --metadata-file="$(abspath ausgabe.yaml)" $$meta \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" $$extra \
	  --output="$(abspath $@)"

# HTML -> PDF (CSS Paged Media), BALISÉ PDF/UA-1 (AX3/D62 : PDF accessible — arbre
# de structure + langue). WeasyPrint 69 : --pdf-variant pdf/ua-1 pose /StructTreeRoot,
# /MarkInfo /Marked true, /Lang et les StructElem (H, P, Table, Figure…). Repli
# AUTOMATIQUE si la variante stricte échoue : tagged-PDF simple (--pdf-tags), puis
# PDF nu — le balisage ne doit JAMAIS faire échouer le build.
# Temporaire « ~$… » dans le MÊME dossier : rename local + ignoré par la synchro
# OneDrive -> jamais de PDF partiel. ⚠ Quotes SIMPLES ($0/$notdir non substitués).
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

# HTML autonome -> DOCX (F7) : galley Word de l'export OJS, RÉGÉNÉRÉ depuis le HTML
# final (--embed-resources) et non depuis le .md — le reader html de pandoc comprend
# les tableaux D47 réinjectés en HTML brut (colspan/rowspan) et les images data:,
# que le writer docx nourri au .md perdrait. Produit à la demande (cible `docx`),
# volontairement hors de `all` et de `tout-exporter`.
$(OUT)/%.docx: $(OUT)/%.html
	@echo "pandoc $< -> $@ (docx)"
	@$(PANDOC) "$<" --from=html --to=docx --output="$@"

docx: verifie-dossier $(DOCXS)

# Conversion des Word déposés dans articles-word/ (D12, D26, D35, D39, F6) :
#  - migre au passage les anciens articles « à plat » vers articles/<slug>/ ;
#  - jamais d'écrasement d'un article existant (D12) ;
#  - converti avec succès -> le .docx source est SUPPRIMÉ (D39, plus de _convertis/) ;
#    « déjà converti (ignoré) » ou échec -> le .docx RESTE dans articles-word/ ;
#  - import-docx.sh branche docx-meta.py (F6) : métadonnées -> <slug>.meta.yaml
#    (jamais écrasé), tableau des auteurs et lignes de tête consommés, bibliographie
#    -> media/<slug>.bib via AnyStyle ; l'échec d'UN article déclenche le rollback
#    rm -rf articles/<slug> ci-dessous, meta.yaml compris ;
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
