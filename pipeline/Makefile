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

.PHONY: all pdf docx import clean verifie-dossier tout-exporter \
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
	@echo "[pipeline] En attendant : « article » (PDF + HTML par article)."
	@exit 1

# Valeur non reconnue : on nomme la valeur reçue ET les valeurs acceptées, la
# faute de frappe étant le cas de très loin le plus probable. Code non nul.
profil-inconnu:
	@echo "[pipeline] profil inconnu dans ausgabe.yaml : « $(PROFIL) »"
	@echo "[pipeline] Valeurs acceptées (D20) : article (défaut) | book (différé) | vide (aucun document)."
	@exit 1

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
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-niveaux.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-scope.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-numerotation.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-legende-avant.lua" $$extra \
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
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-niveaux.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-scope.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-numerotation.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-legende-avant.lua" $$extra \
	  --output="$(abspath $@)" || \
	printf '%s' '<!DOCTYPE html><html lang="fr"><body><p>Aperçu HTML indisponible pour cet article (le PDF, lui, est compilé) : voir le panneau de compilation.</p></body></html>' > "$(abspath $@)"

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
# szh-galley-docx.lua : le reader html voit le BALISAGE, jamais le CSS — ce que
# print.css masque réapparaîtrait en clair dans le Word. Ce filtre retire les blocs
# purement techniques (aujourd'hui .szh-description, cible des aria-describedby des
# tableaux, D104). Sans lui, chaque tableau décrit traînerait sa description longue
# en paragraphe visible sous lui dans le galley OJS.
$(OUT)/%.docx: $(OUT)/%.html $(PIPELINE_DIR)/filters/szh-galley-docx.lua
	@echo "pandoc $< -> $@ (docx)"
	@$(PANDOC) "$<" --from=html --to=docx \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-galley-docx.lua" --output="$@"

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
#  - .docx uniquement (D35 : un seul chemin d'import) ;
#  - NUMÉRO D'ORDRE : un nom de fichier qui commence par UN chiffre seul (« 4_Titre »)
#    donne un slug complété à deux chiffres (« 04-titre ») ; à partir de 10 le nombre
#    est laissé tel quel. Le tri alphabétique des slugs devient l'ordre du numéro
#    (SLUGS := $(sort …), listerArticles côté cockpit, seq de l'export OJS D93).
#  - LONGUEUR BORNÉE À 39 CARACTÈRES : le slug nomme le dossier ET son .md homonyme,
#    il est donc compté DEUX FOIS dans chaque chemin — et deux fois de plus sous out/.
#    Mesuré sur la bibliothèque SharePoint de rédaction : sans borne, un titre d'article
#    réel (98 caractères) produit des chemins de 340 à 350 caractères, au-delà de la
#    limite Windows de 260 — la compilation passe (WSL s'en moque) mais la synchronisation
#    et l'Explorateur trébuchent. La coupe se fait au DERNIER MOT ENTIER (dernier « - »
#    avant la borne) : « …-technologies-peu » passerait pour un bug, « …-technologies » se
#    lit. Les fragments d'élision d'une seule lettre laissés en fin de coupe (« -d »,
#    « -l ») sont retirés à leur tour : ce ne sont pas des mots. Repli sur la coupe
#    sèche si les 39 premiers caractères n'ont aucun tiret.
#    Appliquée APRÈS le complément à deux chiffres, pour garantir un résultat ≤ 39.
#    ⚠ MIROIR OBLIGATOIRE : slugifierArticle() de vscodium-extension/szh-cockpit/
#    lib/slug.js applique la MÊME règle — le cockpit devine le slug d'un .docx en
#    attente pour dire « déjà converti » ; les deux doivent rester bijectifs.
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
	  slug=$$(printf '%s' "$$slug" | sed -E 's/^([0-9])($$|[^0-9])/0\1\2/'); \
	  if [ $${#slug} -gt 39 ]; then scourt="$${slug:0:39}"; scourt="$${scourt%-*}"; sorph=$$(printf '%s' "$$scourt" | sed -E 's/(-[a-z0-9])+$$//'); case "$$sorph" in *-*) scourt="$$sorph";; esac; slug="$${scourt:-$${slug:0:39}}"; fi; \
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
