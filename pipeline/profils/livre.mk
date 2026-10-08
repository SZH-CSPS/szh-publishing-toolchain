# Moteur livre. Inclus par pipeline/Makefile quand le dossier porte un buch.yaml.
#
# Un chapitre se compile comme un article : même `cd` dans son dossier, même suite de
# filtres, même --embed-resources. C'est ce qui permet au gestionnaire de médias, à
# l'éditeur de tableaux, à l'import Word et à l'aperçu du cockpit de servir aussi pour un
# livre. Seul le gabarit change : un chapitre sort un fragment HTML, que
# livre-assembler.py colle ensuite dans le livre.
#
# Un pandoc par chapitre, car chaque chapitre a son propre media/ et pandoc n'a qu'un
# dossier courant (voir l'en-tête de livre-assembler.py).
#
# Les chaînes de filtres d'un chapitre (FILTRES_CHAPITRE et ses variantes EPUB et
# aperçu) sont dans pipeline/filtres.mk.

# --------------------------------------------------------------------------------------
# Ce que le dossier contient
# --------------------------------------------------------------------------------------
CONFIG_LIVRE := buch.yaml
# Cache Shlink (pipeline/liens-courts.py), à côté de buch.yaml : URL longue -> URL courte.
# szh-qr.lua le lit (SZH_LIENS_COURTS) pour qu'un QR encode le lien court. Facultatif.
LIENS_COURTS_CACHE := liens-courts.yaml
CH_DIR       := chapitres
LIM_DIR      := liminaires
COUV_DIR     := couverture
UNITES_DIR   := chapitres
WORD_DIR     := chapitres-word

# Ordre des chapitres : la liste `ordre-chapitres` de buch.yaml, sinon l'ordre alphabétique
# des dossiers. szh-lire-config.lua lit la liste en ligne (« [a, b, c] ») comme en blocs
# (« - a ») et rend les éléments séparés par une espace.
ORDRES := $(shell $(PANDOC) lua $(LIRE_CONFIG) $(CONFIG_LIVRE) ordre-chapitres 2>/dev/null)

# Tous les chapitres trouvés sur le disque, sauf les dossiers préfixés « _ » : ce sont des
# pièces de travail, non imprimées (livre-scinder.py y dépose ce qu'il n'a pas su
# rattacher). Retirer le préfixe en fait un chapitre.
DOSSIERS_CHAPITRES := $(sort $(foreach d,$(wildcard $(CH_DIR)/*),\
                $(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
TOUS_CHAPITRES := $(filter-out _%,$(DOSSIERS_CHAPITRES))
# Dossiers écartés ; verifie-livre les signale.
CHAPITRES_ECARTES := $(filter _%,$(DOSSIERS_CHAPITRES))

# Les slugs de ORDRES d'abord, puis les autres chapitres par ordre alphabétique : un
# chapitre absent de la liste reste dans le livre.
CHAPITRES_ORDONNES :=
# Slugs de ORDRES sans dossier ; verifie-livre les signale.
ORDRES_INTROUVABLES := $(strip $(foreach s,$(ORDRES),$(if $(wildcard $(CH_DIR)/$(s)/$(s).md),,$(s))))
# Ajouter les slugs qui existent, dans l'ordre donné.
$(foreach s,$(ORDRES),$(if $(filter $(s),$(TOUS_CHAPITRES)),$(eval CHAPITRES_ORDONNES += $(s))))
# Puis ajouter les chapitres non listés, par tri alphabétique.
$(foreach c,$(TOUS_CHAPITRES),$(if $(filter $(c),$(CHAPITRES_ORDONNES)),,$(eval CHAPITRES_ORDONNES += $(c))))
CHAPITRES := $(CHAPITRES_ORDONNES)

# L'ordre des chapitres, écrit sur disque comme prérequis des fragments : le rang décide de
# la couleur et de l'onglet de tranche, et retirer un chapitre doit recompiler les
# suivants. Réécrit seulement si le contenu change (`cmp -s`), sinon chaque lecture du
# Makefile recompilerait tout.
ORDRE_CHAPITRES_FICHIER := $(OUT)/.szh-ordre-chapitres
$(shell mkdir -p "$(OUT)" 2>/dev/null; printf '%s\n' $(CHAPITRES) | cmp -s - "$(ORDRE_CHAPITRES_FICHIER)" 2>/dev/null || printf '%s\n' $(CHAPITRES) > "$(ORDRE_CHAPITRES_FICHIER)")

# Chapitres retirés de la table des matières : clé `sommaire: non` (ou `false`) du
# <slug>.meta.yaml, lue par szh-lire-config.lua (l'image WSL n'a pas PyYAML). Sans la clé,
# le chapitre est au sommaire.
# Un chapitre hors sommaire est compilé à sa place et garde son rang dans $(CHAPITRES)
# (couleur, SZH_CHAPITRE, compteurs de figures et tableaux). $(CHAPITRES_SOMMAIRE) sert
# seulement au numéro de la pastille et à l'index à pouce.
CHAPITRES_HORS_SOMMAIRE := $(strip $(foreach c,$(CHAPITRES),\
  $(if $(filter non false,$(strip $(shell $(PANDOC) lua $(LIRE_CONFIG) \
       $(CH_DIR)/$(c)/$(c).meta.yaml sommaire 2>/dev/null))),$(c))))
CHAPITRES_SOMMAIRE    := $(filter-out $(CHAPITRES_HORS_SOMMAIRE),$(CHAPITRES))
NB_CHAPITRES_SOMMAIRE := $(words $(CHAPITRES_SOMMAIRE))

# Même mécanique que $(ORDRE_CHAPITRES_FICHIER) : retirer un chapitre du sommaire change la
# hauteur de toutes les cases de l'index à pouce, donc tous les chapitres.
SOMMAIRE_CHAPITRES_FICHIER := $(OUT)/.szh-sommaire-chapitres
$(shell mkdir -p "$(OUT)" 2>/dev/null; printf '%s\n' $(CHAPITRES_SOMMAIRE) | cmp -s - "$(SOMMAIRE_CHAPITRES_FICHIER)" 2>/dev/null || printf '%s\n' $(CHAPITRES_SOMMAIRE) > "$(SOMMAIRE_CHAPITRES_FICHIER)")

# Un chapitre = chapitres/<slug>/<slug>.md, comme un article.
FRAGMENTS := $(foreach c,$(CHAPITRES),$(OUT)/$(CH_DIR)/$(c).frag.html)
FRAGMENTS_EPUB := $(foreach c,$(CHAPITRES),$(OUT)/$(CH_DIR)/$(c).epub-frag.html)
# Aperçu HTML cliquable, un par chapitre, comme $(APERCUS) pour un article de revue.
APERCUS_CHAPITRES := $(foreach c,$(CHAPITRES),$(OUT)/$(CH_DIR)/$(c).apercu.html)

# Les chapitres doivent se compiler dans l'ordre. szh-numerotation.lua numérote figures et
# tableaux en continu sur le volume : chaque chapitre lit son point de départ dans le report
# du précédent, sous $(OUT)/.szh-compteurs/. Compilé trop tôt, il renumérote depuis 1 et le
# livre a deux « Abbildung 1 ». Chaque fragment dépend donc du précédent, ce qui tient
# aussi sous `make -j`. Le coût est faible : pandoc met moins d'une seconde par chapitre.
COMPTEURS_DIR := $(OUT)/.szh-compteurs
# `PRECEDENT` retient le dernier fragment vu ; le premier n'a pas de prérequis.
PRECEDENT :=
$(foreach f,$(FRAGMENTS),$(eval $(f): $(PRECEDENT))$(eval PRECEDENT := $(f)))
# Même chaîne pour les fragments EPUB, avec leurs propres reports.
PRECEDENT_EPUB :=
$(foreach f,$(FRAGMENTS_EPUB),$(eval $(f): $(PRECEDENT_EPUB))$(eval PRECEDENT_EPUB := $(f)))

# Pièces liminaires écrites à la main (préface, avant-propos…). Compilées comme des
# chapitres, insérées par l'assembleur à la place que buch.yaml leur donne.
LIMINAIRES     := $(patsubst $(LIM_DIR)/%.md,$(OUT)/$(LIM_DIR)/%.html,$(wildcard $(LIM_DIR)/*.md))

# Les sorties portent le nom du dossier du livre (« 2026-B330-Canonica.pdf »).
# `basename` par le shell et non `$(notdir …)` : les fonctions de chemin de make coupent sur
# les espaces, et les chemins OneDrive en contiennent.
NOM_LIVRE  := $(shell basename "$(CURDIR)")
LIVRE_HTML := $(OUT)/$(NOM_LIVRE).html
LIVRE_PDF  := $(OUT)/$(NOM_LIVRE).pdf

# `verifier-ua` ne valide que le PDF numérique. Le PDF imprimeur (fond perdu, traits de
# coupe) et la couverture vont chez l'imprimeur, pas chez un lecteur.
PDFS_UA    := $(LIVRE_PDF)
# PDF imprimeur : même contenu, assemblé une seconde fois avec imprimeur.css (fond perdu,
# traits de coupe) dans un HTML à part. Voir docs/ARCHITECTURE-LIVRES.md.
LIVRE_IMPRIMEUR_HTML := $(OUT)/$(NOM_LIVRE)-imprimeur.html
LIVRE_IMPRIMEUR_PDF  := $(OUT)/$(NOM_LIVRE)-imprimeur.pdf
# HTML web, assemblé avec web.css, sous out/web/ (voir docs/ARCHITECTURE-LIVRES.md).
# $(LIVRE_HTML) reste le HTML que WeasyPrint pagine.
LIVRE_WEB_HTML := $(OUT)/web/$(NOM_LIVRE).html
# EPUB 3 : un HTML intermédiaire (sans les <section> de chapitre, voir la cible), les
# métadonnées que l'assembleur écrit depuis buch.yaml, et l'archive.
LIVRE_EPUB_HTML := $(OUT)/$(NOM_LIVRE)-epub.html
LIVRE_EPUB_META := $(OUT)/$(NOM_LIVRE)-epub.yaml
LIVRE_EPUB      := $(OUT)/$(NOM_LIVRE).epub

# --------------------------------------------------------------------------------------
# Maquette : `maquette:` de buch.yaml (normal ou falc), lue par szh-lire-config.lua. Une
# valeur inconnue est refusée par verifie-livre.
# --------------------------------------------------------------------------------------
MAQUETTE_LUE := $(strip $(shell $(PANDOC) lua $(LIRE_CONFIG) $(CONFIG_LIVRE) maquette 2>/dev/null))
MAQUETTE     := $(if $(MAQUETTE_LUE),$(MAQUETTE_LUE),normal)

# Le lecteur pandoc dépend de la maquette. En FALC, une phrase occupe une ligne : le retour
# à la ligne porte du sens, et `+hard_line_breaks` le garde. En maquette normale, un
# paragraphe justifié se recompose et les retours de saisie sont ignorés.
LECTEUR := $(if $(filter falc,$(MAQUETTE)),markdown+hard_line_breaks,markdown)

# Lecteur de l'aperçu HTML : commonmark_x, seul à fournir les positions source (pandoc
# refuse « markdown+sourcepos ») dont la webview a besoin pour le clic vers le .md. La règle
# FALC des retours à la ligne s'y applique aussi.
LECTEUR_APERCU := commonmark_x$(if $(filter falc,$(MAQUETTE)),+hard_line_breaks,)+sourcepos

# Couleur d'un chapitre (maquette FALC) : pastille du numéro, onglet de tranche, repère du
# sommaire. Chaque teinte de styles/couleurs.css est prise au cran le plus clair qui tient
# 3:1 contre le blanc (WCAG 1.4.11) : rouge, moutarde et mountbatten au 500, bleu acier et
# poireau au 600. Le chiffre blanc de la pastille garde |Lc| ≥ 62 (pipeline/apca.py).
# Capucine au 700 : au 500, elle se confond avec le rouge (ΔE2000 = 4,4). Au 700, l'écart
# minimal de la palette, toutes paires confondues, est de 16,3 (le cycle revient au-delà de
# six chapitres).
# Ordre : rouge · bleu acier · capucine · moutarde · mountbatten · poireau, pour éloigner
# les deux teintes chaudes.
# La couleur est posée par rang, ici, et non par `:nth-of-type` en CSS, qui compterait
# aussi les liminaires.
# Les valeurs sont sans « # » : dans une recette, il ouvrirait un commentaire de shell. La
# recette l'ajoute entre guillemets.
PALETTE_CHAPITRE := E95D5F 4D869F AE3E35 949A00 A98899 43905D
# Les mêmes teintes au cran 800 : fond des pastilles numérotées du falc-header
# (styles/livre/base.css). Leur petit chiffre blanc demande |Lc| ≥ 90, que seul le 800
# tient dans les six teintes.
PALETTE_CHAPITRE_FONCE := 9F001F 2E5A6D 8E2E27 555900 624C58 26613B

# Index à pouce (maquette FALC) : position et hauteur de l'onglet de tranche. Calculées ici
# une seule fois, puis passées en métadonnées pandoc à la section du chapitre
# (--onglet-haut, --onglet-hauteur) ; livre-assembler.py relit ces valeurs dans le fragment
# pour placer le repère du sommaire à la même hauteur.
#
# La plage ONGLET_Y0..ONGLET_Y1 (mm) est partagée à parts égales entre les chapitres du
# sommaire. ONGLET_Y0 doit rester égal à --onglet-y0 de falc.css. Pour le chapitre de rang
# k parmi $(CHAPITRES_SOMMAIRE) (et non parmi $(CHAPITRES)) :
#   hauteur = (ONGLET_Y1 - ONGLET_Y0) / NB_CHAPITRES_SOMMAIRE
#   haut    = ONGLET_Y0 + (k - 1) * hauteur
# Ce k devient aussi numero-chapitre, le chiffre de la pastille affichée sur chaque page
# du chapitre. Il est écrit dans le gabarit plutôt que calculé par counter() : il suit le
# sommaire, pas le rang de la section, et un compteur lu depuis une boîte de marge est
# fragile.
# Un chapitre hors sommaire ne reçoit ni onglet ni numéro (falc.css efface sa marque) ; il
# garde sa couleur, qui suit le rang dans $(CHAPITRES).
ONGLET_Y0 := 30
ONGLET_Y1 := 190

STYLE_LIVRE_BASE  := $(PIPELINE_DIR)/styles/livre/base.css
STYLE_LIVRE_CHART := $(PIPELINE_DIR)/styles/livre/$(MAQUETTE).css
STYLE_LIVRE_IMPR  := $(PIPELINE_DIR)/styles/livre/imprimeur.css
STYLE_LIVRE_WEB   := $(PIPELINE_DIR)/styles/livre/web.css
STYLE_LIVRE_EPUB  := $(PIPELINE_DIR)/styles/livre/epub.css
EPUB_PREPARE      := $(PIPELINE_DIR)/livre-epub-prepare.py
GABARIT_LIVRE     := $(PIPELINE_DIR)/templates/szh-livre.html
GABARIT_CHAPITRE  := $(PIPELINE_DIR)/templates/szh-livre-chapitre.html
GABARIT_LIMINAIRE := $(PIPELINE_DIR)/templates/szh-livre-liminaire.html
ASSEMBLEUR        := $(PIPELINE_DIR)/livre-assembler.py
# L'appel de l'assembleur ; chaque recette ajoute sa sortie, ses feuilles et ses fragments.
ASSEMBLER          = python3 "$(ASSEMBLEUR)" --meta "$(CONFIG_LIVRE)" --gabarit "$(GABARIT_LIVRE)"

# Numéro « 1.1 » des chapitres d'une partie (`numeros-chapitres: partie`), calculé par
# l'assembleur : « slug=numéro » par chapitre. contexte_chapitre le passe en
# SZH_NUMERO_CHAPITRE à szh-sections.lua. Sans `parties:` dans buch.yaml, pas d'appel ; une
# erreur est signalée à l'assemblage.
NUMEROS_PARTIE := $(if $(shell grep -s '^parties:' $(CONFIG_LIVRE)),$(shell python3 "$(ASSEMBLEUR)" --meta "$(CONFIG_LIVRE)" --numeros-chapitres $(CHAPITRES) 2>/dev/null))

# Les images que l'assembleur incorpore (impressum, illustrations de partie, badge de
# licence, logo de la page de titre) : prérequis des assemblages, pour qu'une image
# remplacée recompile le livre. `wildcard` écarte un nom absent ou coupé par une espace ;
# l'erreur est signalée à l'assemblage.
IMAGES_ASSEMBLEES := $(wildcard $(shell python3 "$(ASSEMBLEUR)" --meta "$(CONFIG_LIVRE)" --fichiers-images 2>/dev/null))

# Surcharge propre à un livre : styles/livre.css dans son dossier, s'il existe. Empilée
# après la charte et partage-filtres, avant l'accent ; ni dans le web ni dans l'EPUB.
STYLE_LIVRE_LOCAL := $(wildcard styles/livre.css)
CSS_LIVRE_LOCAL   := $(if $(STYLE_LIVRE_LOCAL),--css "$(abspath $(STYLE_LIVRE_LOCAL))")

# Feuilles empilées, dans l'ordre : socle (polices, jetons), base (géométrie), charte,
# partage-filtres (composants posés par les filtres communs à la revue et au livre), la
# surcharge locale, puis l'accent de l'ouvrage. partage-filtres vient après la charte pour
# l'emporter à spécificité égale (sinon la flèche de lien externe de la charte écrase
# `a.szh-orcid::after`). L'accent surcharge, il vient en dernier.
CSS_LIVRE := --css "$(SOCLE_ABS)" --css "$(abspath $(STYLE_LIVRE_BASE))" \
             --css "$(abspath $(STYLE_LIVRE_CHART))" --css "$(PARTAGE_ABS)" $(CSS_LIVRE_LOCAL) --css "$(ACCENT_ABS)"

# Même pile, avec imprimeur.css entre la charte et partage-filtres.
CSS_LIVRE_IMPRIMEUR := --css "$(SOCLE_ABS)" --css "$(abspath $(STYLE_LIVRE_BASE))" \
             --css "$(abspath $(STYLE_LIVRE_CHART))" --css "$(abspath $(STYLE_LIVRE_IMPR))" \
             --css "$(PARTAGE_ABS)" $(CSS_LIVRE_LOCAL) --css "$(ACCENT_ABS)"

# Pile du HTML web : socle, web.css et l'accent. base.css et la charte, en millimètres pour
# la page imprimée, n'y entrent pas, ni partage-filtres.css : web.css refait ce qu'il faut
# en unités d'écran. --css-embed : la sortie est un fichier unique, lisible par file://.
CSS_LIVRE_WEB := --css-embed "$(SOCLE_ABS)" --css-embed "$(abspath $(STYLE_LIVRE_WEB))" \
             --css-embed "$(ACCENT_ABS)"

.PHONY: livre livre-pdf livre-imprimeur livre-couverture livre-html livre-html-web \
        livre-epub \
        verifie-livre verifie-couverture liens-courts
# Une recette qui échoue ne laisse pas de cible à moitié écrite.
.DELETE_ON_ERROR:
# Les prérequis s'exécutent dans l'ordre écrit, même sous `make -j` : verifie-livre avant
# verifie-couverture, et liens-courts avant les chapitres.
.NOTPARALLEL:

livre: livre-pdf $(APERCUS_CHAPITRES)

# Liens courts Shlink, résolus avant la compilation par livre-pdf, livre-imprimeur,
# livre-epub et livre-html-web (LIENS_COURTS_PREALABLE), seulement si SZH_SHLINK_URL est
# posée. Le lanceur pose SZH_SHLINK_URL et SZH_SHLINK_CLE et les relaie à la WSL par
# WSLENV. À la main :
#   SZH_SHLINK_URL=https://link.szh-csps.ch SZH_SHLINK_CLE=... make -f livre.mk liens-courts
# Sans SZH_SHLINK_URL : ni appel réseau ni écriture du cache.
#
# --lecteur : le même lecteur pandoc que pour les chapitres (voir scanner_liens_qr() dans
# liens-courts.py).
liens-courts:
ifdef SZH_SHLINK_URL
	@python3 "$(PIPELINE_DIR)/liens-courts.py" "$(LIENS_COURTS_CACHE)" --scan "$(CH_DIR)" --lecteur "$(LECTEUR)"
else
	@echo "[livre] SZH_SHLINK_URL n'est pas posé : rien à résoudre (voir l'en-tête de cette cible)."
	@echo "[livre] [de] SZH_SHLINK_URL ist nicht gesetzt: nichts aufzulösen (siehe Kopf dieses Ziels)."
endif

# Prérequis conditionnel des quatre cibles qui compilent le livre (la couverture n'a pas de
# QR). Placé en premier prérequis : sous .NOTPARALLEL, le cache est écrit avant que le
# premier chapitre ne le lise.
LIENS_COURTS_PREALABLE :=
ifdef SZH_SHLINK_URL
LIENS_COURTS_PREALABLE := liens-courts
endif

# --------------------------------------------------------------------------------------
# Garde-fous : ce qui manque et ce qu'il faut faire, en français et en allemand.
# --------------------------------------------------------------------------------------
verifie-livre:
	@test -f $(CONFIG_LIVRE) || { \
	  echo "[livre] Ce dossier n'est pas un livre ($(CONFIG_LIVRE) introuvable) : $$PWD"; \
	  echo "[livre] [de] Dieser Ordner ist kein Buch ($(CONFIG_LIVRE) fehlt): $$PWD"; \
	  exit 1; }
	@test -n "$(CHAPITRES)" || { \
	  echo "[livre] Aucun chapitre ($(CH_DIR)/<nom>/<nom>.md) — déposez les Word dans $(CH_DIR)-word/ puis enregistrez (Ctrl+S)."; \
	  echo "[livre] [de] Kein Kapitel ($(CH_DIR)/<Name>/<Name>.md) — Word-Dateien in $(CH_DIR)-word/ ablegen und speichern (Ctrl+S)."; \
	  exit 1; }
	@case "$(NOM_LIVRE)" in \
	  *" "*) \
	    echo "[livre] ⚠ Le dossier du livre contient des espaces : « $(NOM_LIVRE) »."; \
	    echo "[livre]   Son nom devient celui de TOUS les fichiers produits — PDF, couverture, EPUB — et un espace y traverse mal la chaîne. Renommez-le avec des tirets bas."; \
	    echo "[livre] [de] ⚠ Der Buchordner enthält Leerzeichen: « $(NOM_LIVRE) ». Sein Name wird zum Namen aller erzeugten Dateien — bitte mit Unterstrichen benennen."; \
	    exit 1;; \
	esac
	@if ls -d $(CH_DIR)/* 2>/dev/null | grep -q ' '; then \
	  echo "[livre] ⚠ Un dossier de $(CH_DIR)/ contient des espaces — renommez-le sans espaces."; exit 1; \
	fi
	@test -f "$(STYLE_LIVRE_CHART)" || { \
	  echo "[livre] Maquette inconnue dans $(CONFIG_LIVRE) : « $(MAQUETTE) »"; \
	  echo "[livre] Valeurs acceptées : normal | falc."; \
	  echo "[livre] [de] Unbekanntes Layout in $(CONFIG_LIVRE): « $(MAQUETTE) ». Erlaubt: normal | falc."; \
	  exit 1; }
	@for c in $(CHAPITRES_ECARTES); do \
	  echo "[livre-avertissement] chapitre-ecarte | chapitre « $$c » | Ce dossier n'est pas imprimé : un dossier préfixé « _ » est une pièce de travail, à relire et à replacer. Retirez le « _ » pour en faire un chapitre. | [de] Dieser Ordner wird nicht gedruckt: ein Ordner mit Präfix « _ » ist ein Arbeitsstück. Entfernen Sie das « _ », um daraus ein Kapitel zu machen."; \
	done
	@for s in $(ORDRES_INTROUVABLES); do \
	  echo "[livre-avertissement] chapitre-introuvable | chapitre « $$s » | Ce chapitre est listé dans ordre-chapitres mais introuvable dans $(CH_DIR)/ : vérifiez le nom du dossier, ou retirez-le de la liste. | [de] Dieses Kapitel steht in ordre-chapitres, wurde aber in $(CH_DIR)/ nicht gefunden: prüfen Sie den Ordnernamen, oder entfernen Sie es aus der Liste."; \
	done

# --------------------------------------------------------------------------------------
# Un chapitre -> un fragment HTML autonome (images en data: URI).
# Le `cd` dans le dossier du chapitre rend media/ et tables/ relatifs au .md, comme pour un
# article. Le rang est passé en SZH_CHAPITRE, la couleur en métadonnée.
# --------------------------------------------------------------------------------------
# Une règle à motif n'accepte qu'un « % » par prérequis : `.SECONDEXPANSION` (posé par le
# Makefile principal) permet d'écrire `$$*` deux fois, comme pour les articles.
#
# Contexte d'un chapitre, commun au fragment, à la variante EPUB, à l'aperçu et au chapitre
# seul : rang, couleurs, case de l'index à pouce et fiche, calculés depuis $$slug.
define contexte_chapitre
rang=$$(printf '%s\n' $(CHAPITRES) | grep -n -x "$$slug" | cut -d: -f1); \
index=$$(( (rang - 1) % 6 + 1 )); \
couleur="#$$(printf '%s\n' $(PALETTE_CHAPITRE) | sed -n "$${index}p")"; \
fonce="#$$(printf '%s\n' $(PALETTE_CHAPITRE_FONCE) | sed -n "$${index}p")"; \
if printf '%s\n' $(CHAPITRES_HORS_SOMMAIRE) | grep -qx "$$slug"; then \
  onglet_meta="--metadata hors-sommaire=1"; \
else \
  numero=$$(printf '%s\n' $(CHAPITRES_SOMMAIRE) | grep -n -x "$$slug" | cut -d: -f1); \
  hauteur=$$(awk -v y0=$(ONGLET_Y0) -v y1=$(ONGLET_Y1) -v n=$(NB_CHAPITRES_SOMMAIRE) 'BEGIN{printf "%.3f", (y1-y0)/n}'); \
  haut=$$(awk -v y0=$(ONGLET_Y0) -v h=$$hauteur -v k=$$numero 'BEGIN{printf "%.3f", y0+(k-1)*h}'); \
  onglet_meta="--metadata onglet-haut=$${haut}mm --metadata onglet-hauteur=$${hauteur}mm --metadata numero-chapitre=$$numero"; \
fi; \
meta=""; \
if [ -f "$(CH_DIR)/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
export SZH_NUMERO_CHAPITRE="$$(printf '%s\n' $(NUMEROS_PARTIE) | sed -n "s/^$$slug=//p")";
endef

$(OUT)/$(CH_DIR)/%.frag.html: $(CH_DIR)/$$*/$$*.md $(CONFIG_LIVRE) $(GABARIT_CHAPITRE) $(FILTRES) \
                              $$(wildcard $(CH_DIR)/$$*/tables/*.html) \
                              $$(wildcard $(CH_DIR)/$$*/media/*) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.meta.yaml) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.biblio.md) $(ORDRE_CHAPITRES_FICHIER) \
                              $(SOMMAIRE_CHAPITRES_FICHIER)
	@mkdir -p "$(dir $@)"
	@slug="$*"; \
	$(contexte_chapitre) \
	echo "pandoc $(CH_DIR)/$$slug/$$slug.md -> $@ (chapitre $$rang)"; \
	cd "$(CH_DIR)/$$slug" && SZH_LIVRE=1 SZH_CHAPITRE="$$rang" \
	  SZH_COMPTEURS="$(abspath $(COMPTEURS_DIR))/$$rang.txt" \
	  SZH_AUSGABE="$(abspath $(CONFIG_LIVRE))" \
	  SZH_LIENS_COURTS="$(abspath $(LIENS_COURTS_CACHE))" $(PANDOC) "$$slug.md" \
	  --from=$(LECTEUR) --to=html5 \
	  --id-prefix="$$slug-" \
	  --metadata-file="$(abspath $(CONFIG_LIVRE))" $$meta \
	  --metadata slug="$$slug" \
	  --metadata couleur-chapitre="$$couleur" \
	  --metadata couleur-chapitre-fonce="$$fonce" \
	  --metadata rang-chapitre="$$rang" \
	  $$onglet_meta \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_CHAPITRE))" \
	  $(FILTRES_CHAPITRE) \
	  --output="$(abspath $@)"

# Le même chapitre, compilé pour l'EPUB, sans szh-notes (voir FILTRES_CHAPITRE_EPUB). Ses
# reports de compteurs sont à part : mêlés à ceux du PDF, ils fausseraient la numérotation
# de la compilation suivante.
$(OUT)/$(CH_DIR)/%.epub-frag.html: $(CH_DIR)/$$*/$$*.md $(CONFIG_LIVRE) $(GABARIT_CHAPITRE) $(FILTRES) \
                              $$(wildcard $(CH_DIR)/$$*/tables/*.html) \
                              $$(wildcard $(CH_DIR)/$$*/media/*) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.meta.yaml) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.biblio.md) $(ORDRE_CHAPITRES_FICHIER) \
                              $(SOMMAIRE_CHAPITRES_FICHIER)
	@mkdir -p "$(dir $@)"
	@slug="$*"; \
	$(contexte_chapitre) \
	echo "pandoc $(CH_DIR)/$$slug/$$slug.md -> $@ (chapitre $$rang, variante EPUB)"; \
	cd "$(CH_DIR)/$$slug" && SZH_LIVRE=1 SZH_CHAPITRE="$$rang" \
	  SZH_COMPTEURS="$(abspath $(COMPTEURS_DIR))/epub/$$rang.txt" \
	  SZH_AUSGABE="$(abspath $(CONFIG_LIVRE))" \
	  SZH_LIENS_COURTS="$(abspath $(LIENS_COURTS_CACHE))" $(PANDOC) "$$slug.md" \
	  --from=$(LECTEUR) --to=html5 \
	  --id-prefix="$$slug-" \
	  --metadata-file="$(abspath $(CONFIG_LIVRE))" $$meta \
	  --metadata slug="$$slug" \
	  --metadata couleur-chapitre="$$couleur" \
	  --metadata couleur-chapitre-fonce="$$fonce" \
	  --metadata rang-chapitre="$$rang" \
	  $$onglet_meta \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_CHAPITRE))" \
	  $(FILTRES_CHAPITRE_EPUB) \
	  --output="$(abspath $@)"

# Aperçu HTML cliquable d'un chapitre, comme $(OUT)/%.apercu.html pour un article :
# filtres $(FILTRES_CHAPITRE_APERCU), lecteur $(LECTEUR_APERCU) (chaque bloc porte data-pos
# pour le clic vers le .md), SZH_APERCU=1, et deux filtres en tête qui compensent le
# lecteur commonmark : szh-sourcepos.lua défait les enveloppes et le découpage des mots
# (sans quoi typographie et liage des citations restent inertes), szh-ancres.lua rend aux
# titres l'identifiant du PDF (liens de la table des matières).
# Le gabarit de chapitre est gardé : il est aussi minimal pour le fragment que pour l'aperçu.
# Compteurs à part (apercu/) : l'aperçu ne touche pas aux reports du PDF ni de l'EPUB.
$(OUT)/$(CH_DIR)/%.apercu.html: $(CH_DIR)/$$*/$$*.md $(CONFIG_LIVRE) $(GABARIT_CHAPITRE) $(FILTRES) \
                              $$(wildcard $(CH_DIR)/$$*/tables/*.html) \
                              $$(wildcard $(CH_DIR)/$$*/media/*) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.meta.yaml) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.biblio.md) $(ORDRE_CHAPITRES_FICHIER) \
                              $(SOMMAIRE_CHAPITRES_FICHIER)
	@mkdir -p "$(dir $@)"
	@slug="$*"; \
	$(contexte_chapitre) \
	echo "pandoc $(CH_DIR)/$$slug/$$slug.md -> $@ (chapitre $$rang, aperçu sourcepos)"; \
	cd "$(CH_DIR)/$$slug" && SZH_APERCU=1 SZH_LIVRE=1 SZH_CHAPITRE="$$rang" \
	  SZH_COMPTEURS="$(abspath $(COMPTEURS_DIR))/apercu/$$rang.txt" \
	  SZH_AUSGABE="$(abspath $(CONFIG_LIVRE))" \
	  SZH_LIENS_COURTS="$(abspath $(LIENS_COURTS_CACHE))" $(PANDOC) "$$slug.md" \
	  --from=$(LECTEUR_APERCU) --to=html5 \
	  --id-prefix="$$slug-" \
	  --metadata-file="$(abspath $(CONFIG_LIVRE))" $$meta \
	  --metadata slug="$$slug" \
	  --metadata couleur-chapitre="$$couleur" \
	  --metadata couleur-chapitre-fonce="$$fonce" \
	  --metadata rang-chapitre="$$rang" \
	  $$onglet_meta \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_CHAPITRE))" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-sourcepos.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-ancres.lua" \
	  $(FILTRES_CHAPITRE_APERCU) \
	  --output="$(abspath $@)" || \
	printf '%s' '<!DOCTYPE html><html lang="fr"><body><p>Aperçu HTML indisponible pour ce chapitre (le PDF, lui, est compilé) : voir le panneau de compilation.</p></body></html>' > "$(abspath $@)"

# --------------------------------------------------------------------------------------
# Un chapitre SEUL en PDF : `make livre-chapitre-pdf CHAPITRE=<slug>`
#
# Interface (le cockpit appelle cette cible quand on clique sur un chapitre) :
#   entrée   CHAPITRE=<slug>  le nom du dossier sous chapitres/ (obligatoire) ; à lancer
#                             depuis le dossier du livre, comme `make livre`.
#   sortie   out/chapitres/<slug>.pdf — le chapitre seul : ni liminaires ni sommaire, les
#            CSS du livre (maquette, accent), folios « page X sur Y » depuis 1.
#            Intermédiaires sous out/chapitres/.seul/ (fragment, HTML assemblé).
#   code     0 le PDF est écrit ; 1 compilation en échec (pandoc ou WeasyPrint, le message
#            suit) ; 2 CHAPITRE absent, ou qui ne désigne aucun chapitre du livre (la liste
#            des chapitres valides est imprimée) — rien n'est compilé.
#   durée    un pandoc et un WeasyPrint sur quelques pages : pas de recompilation du livre,
#            ni des autres chapitres.
#
# Limites :
#   * Les autres chapitres ne sont pas recompilés. La numérotation des figures et tableaux
#     part des reports du dernier build complet ($(COMPTEURS_DIR)/). Sans reports,
#     szh-numerotation.lua le signale et numérote depuis 1. Si le nombre de figures d'un
#     chapitre précédent a changé, les numéros restent anciens jusqu'au prochain
#     `make livre`.
#   * Les folios partent de 1.
#
# Le fragment est compilé comme dans le build complet (mêmes variables, filtres, rang et
# couleur), sans dépendre du fragment précédent, et écrit à part sous .seul/. Son report de
# compteurs est écrit au même endroit qu'au build complet.
# --------------------------------------------------------------------------------------
CHAPITRE ?=
CHAPITRE_SEUL_DIR := $(OUT)/$(CH_DIR)/.seul
CHAPITRE_PDF := $(if $(and $(CHAPITRE),$(filter $(CHAPITRE),$(CHAPITRES))),$(OUT)/$(CH_DIR)/$(CHAPITRE).pdf)

.PHONY: livre-chapitre-pdf
livre-chapitre-pdf: verifie-livre $(CHAPITRE_PDF)
	@test -n "$(CHAPITRE)" || { \
	  echo "[livre] CHAPITRE=<slug> est obligatoire : make livre-chapitre-pdf CHAPITRE=<slug>. Chapitres : $(CHAPITRES)"; \
	  echo "[livre] [de] CHAPITRE=<slug> ist erforderlich. Kapitel: $(CHAPITRES)"; \
	  exit 2; }
	@test -n "$(CHAPITRE_PDF)" || { \
	  echo "[livre] « $(CHAPITRE) » n'est pas un chapitre de ce livre. Chapitres : $(CHAPITRES)"; \
	  echo "[livre] [de] « $(CHAPITRE) » ist kein Kapitel dieses Buches. Kapitel: $(CHAPITRES)"; \
	  exit 2; }
	@echo "[livre] $(CHAPITRE_PDF)"

ifneq ($(CHAPITRE_PDF),)
CHAPITRE_FRAG_SEUL := $(CHAPITRE_SEUL_DIR)/$(CHAPITRE).frag.html
CHAPITRE_HTML_SEUL := $(CHAPITRE_SEUL_DIR)/$(CHAPITRE).html

$(CHAPITRE_FRAG_SEUL): $(CH_DIR)/$(CHAPITRE)/$(CHAPITRE).md $(CONFIG_LIVRE) $(GABARIT_CHAPITRE) $(FILTRES) \
                       $(wildcard $(CH_DIR)/$(CHAPITRE)/tables/*.html) \
                       $(wildcard $(CH_DIR)/$(CHAPITRE)/media/*) \
                       $(wildcard $(CH_DIR)/$(CHAPITRE)/$(CHAPITRE).meta.yaml) \
                       $(wildcard $(CH_DIR)/$(CHAPITRE)/$(CHAPITRE).biblio.md) $(ORDRE_CHAPITRES_FICHIER) \
                       $(SOMMAIRE_CHAPITRES_FICHIER)
	@mkdir -p "$(dir $@)"
	@slug="$(CHAPITRE)"; \
	$(contexte_chapitre) \
	echo "pandoc $(CH_DIR)/$$slug/$$slug.md -> $@ (chapitre $$rang, seul)"; \
	cd "$(CH_DIR)/$$slug" && SZH_LIVRE=1 SZH_CHAPITRE="$$rang" \
	  SZH_COMPTEURS="$(abspath $(COMPTEURS_DIR))/$$rang.txt" \
	  SZH_AUSGABE="$(abspath $(CONFIG_LIVRE))" \
	  SZH_LIENS_COURTS="$(abspath $(LIENS_COURTS_CACHE))" $(PANDOC) "$$slug.md" \
	  --from=$(LECTEUR) --to=html5 \
	  --id-prefix="$$slug-" \
	  --metadata-file="$(abspath $(CONFIG_LIVRE))" $$meta \
	  --metadata slug="$$slug" \
	  --metadata couleur-chapitre="$$couleur" \
	  --metadata couleur-chapitre-fonce="$$fonce" \
	  --metadata rang-chapitre="$$rang" \
	  $$onglet_meta \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_CHAPITRE))" \
	  $(FILTRES_CHAPITRE) \
	  --output="$(abspath $@)"

$(CHAPITRE_HTML_SEUL): $(CHAPITRE_FRAG_SEUL) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
                       $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(PARTAGE) $(STYLE_LIVRE_LOCAL) $(ACCENT_CSS)
	@mkdir -p "$(dir $@)"
	@$(ASSEMBLER) \
	  --sortie "$@" \
	  --out "$(OUT)" \
	  --sans-liminaires \
	  $(CSS_LIVRE) \
	  $(CHAPITRE_FRAG_SEUL)

# Même cascade de repli que le PDF du livre (PDF/UA-1, puis balisé simple, puis brut).
$(CHAPITRE_PDF): $(CHAPITRE_HTML_SEUL)
	@$(call weasy_ua,livre,,$(dir $@)~$(notdir $@).weasyprint.err)
endif

# Une pièce liminaire : même chaîne, avec son propre gabarit (pas de belle page, pas de
# pastille). Ses images sont dans liminaires/media/, commun à toutes les pièces.
$(OUT)/$(LIM_DIR)/%.html: $(LIM_DIR)/%.md $(CONFIG_LIVRE) $(GABARIT_LIMINAIRE) $(FILTRES) \
                          $(wildcard $(LIM_DIR)/media/*)
	@mkdir -p "$(dir $@)"
	@echo "pandoc $< -> $@ (liminaire)"
	@cd "$(LIM_DIR)" && SZH_LIVRE=1 $(PANDOC) "$(notdir $<)" \
	  --from=$(LECTEUR) --to=html5 \
	  --metadata-file="$(abspath $(CONFIG_LIVRE))" \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_LIMINAIRE))" \
	  $(FILTRES_CHAPITRE) \
	  --output="$(abspath $@)"

# --------------------------------------------------------------------------------------
# L'assemblage, puis la pagination.
# --------------------------------------------------------------------------------------
# La pagination passe par la cascade weasy_ua du Makefile, étiquette `livre`. Journal
# affiché : les vingt premières lignes en cas de succès, les douze dernières en cas
# d'échec, base64 abrégé ; le fichier complet reste à côté du PDF.
define weasy_echec_livre
tail -12 "$$jrnl" | $(ABREGER_BASE64) | sed 's/^/[weasyprint] /'; \
echo "[livre]   Journal complet : $$jrnl"; \
echo "[livre] [de] ✖ WeasyPrint konnte das PDF nicht erzeugen. Vollständiges Protokoll: $$jrnl";
endef

# Le résumé de succès s'arrête à vingt lignes et indique combien il en reste.
define weasy_journal_livre
reste=$$(($$(wc -l < "$$jrnl") - 20)); \
sed -n '1,20p' "$$jrnl" | $(ABREGER_BASE64) | sed 's/^/[weasyprint] /'; \
test "$$reste" -le 0 || echo "[weasyprint] … et $$reste ligne(s) de plus dans $$jrnl";
endef

$(LIVRE_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(PARTAGE) $(STYLE_LIVRE_LOCAL) $(ACCENT_CSS) \
               $(IMAGES_ASSEMBLEES)
	@mkdir -p "$(OUT)"
	@$(ASSEMBLER) \
	  --sortie "$@" \
	  --out "$(OUT)" \
	  $(CSS_LIVRE) \
	  $(FRAGMENTS)

livre-html: verifie-livre $(LIVRE_HTML)

# Le PDF numérique : balisé PDF/UA-1 quand WeasyPrint y parvient, replis en cascade comme
# pour la revue. La porte dure reste `verifier-ua`, appelée par l'export.
$(LIVRE_PDF): $(LIVRE_HTML)
	@$(call weasy_ua,livre,,$(dir $@)~$(notdir $@).weasyprint.err)

livre-pdf: $(LIENS_COURTS_PREALABLE) verifie-livre $(LIVRE_PDF)
	@echo "[livre] $(LIVRE_PDF)"

# --------------------------------------------------------------------------------------
# Le PDF imprimeur : même contenu, avec imprimeur.css en plus (fond perdu, traits de
# coupe). Son HTML est assemblé à part pour que le PDF numérique n'ait pas de fond perdu.
# WeasyPrint le produit en RVB ; la cible livre-imprimeur le convertit ensuite en CMJN si
# buch.yaml nomme un profil (voir « La passe CMJN » plus bas).
# --------------------------------------------------------------------------------------
$(LIVRE_IMPRIMEUR_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(STYLE_LIVRE_IMPR) $(PARTAGE) $(STYLE_LIVRE_LOCAL) $(ACCENT_CSS) \
               $(IMAGES_ASSEMBLEES)
	@mkdir -p "$(OUT)"
	@$(ASSEMBLER) \
	  --sortie "$@" \
	  --out "$(OUT)" \
	  $(CSS_LIVRE_IMPRIMEUR) \
	  $(FRAGMENTS)

# Même cascade de repli que le PDF numérique.
$(LIVRE_IMPRIMEUR_PDF): $(LIVRE_IMPRIMEUR_HTML)
	@$(call weasy_ua,livre,,$(dir $@)~$(notdir $@).weasyprint.err)

# --------------------------------------------------------------------------------------
# La couverture, deux PDF d'un même gabarit (couverture.py, docs/ARCHITECTURE-LIVRES.md) :
#   <livre>-couverture-impression.pdf  à plat 4e + dos + 1re, PDF/X-4, CMJN exact, fond
#                                      perdu, traits de coupe et de pli ;
#   <livre>-couverture.pdf             1re puis 4e, RGB, PDF/UA-1 ; -1.png et -4.png en sont
#                                      tirés à 300 dpi ;
#   <livre>-dos.json                   le dos et d'où il vient.
#
# couverture.py calcule le dos sur le nombre de pages de $(LIVRE_PDF), sauf si
# impression.dos-mm le fixe. $(LIVRE_PDF) est donc un prérequis : un dos calculé sur un
# compte de pages périmé est une erreur coûteuse à l'impression. couverture.py lit
# buch.yaml lui-même (couleur-impression, profil-cmjn, fond) et tourne dans le python du
# venv WeasyPrint, seul à avoir Pillow, pypdf et l'API WeasyPrint.
# --------------------------------------------------------------------------------------
GABARIT_COUVERTURE := $(PIPELINE_DIR)/templates/szh-couverture.html
STYLE_COUVERTURE   := $(PIPELINE_DIR)/styles/livre/couverture.css
COUVERTURE_PY      := $(PIPELINE_DIR)/couverture.py
COULEURS_REFERENCE := $(PIPELINE_DIR)/styles/couleurs-reference.json
LOGOS_COUVERTURE   := $(wildcard $(PIPELINE_DIR)/media/logos/*.svg)
# Les fonds du toolkit (prospectrum.jpg), que couverture.py lit selon le modèle.
FONDS_COUVERTURE   := $(wildcard $(PIPELINE_DIR)/media/fonds/*)
GS ?= gs

# L'illustration est facultative (couverture/illustration.jpg|jpeg|png|svg|webp).
# `firstword` : une seule image par couverture, celle qui trie en premier.
ILLUSTRATION_COUV := $(firstword $(wildcard $(COUV_DIR)/illustration.*))

COUVERTURE_FRAG      := $(OUT)/$(COUV_DIR)/quatrieme.html
COUVERTURE_IMPR_HTML := $(OUT)/$(COUV_DIR)/$(NOM_LIVRE)-couverture-impression.html
COUVERTURE_HTML      := $(OUT)/$(COUV_DIR)/$(NOM_LIVRE)-couverture.html
COUVERTURE_IMPR_PDF  := $(OUT)/$(NOM_LIVRE)-couverture-impression.pdf
COUVERTURE_PDF       := $(OUT)/$(NOM_LIVRE)-couverture.pdf
COUVERTURE_PNG_1     := $(OUT)/$(NOM_LIVRE)-couverture-1.png
COUVERTURE_PNG_4     := $(OUT)/$(NOM_LIVRE)-couverture-4.png
COUVERTURE_DOS       := $(OUT)/$(NOM_LIVRE)-dos.json

# Le texte de 4e de couverture, compilé comme une pièce liminaire : même lecteur et mêmes
# filtres, donc même typographie, sans pastille ni belle page.
$(COUVERTURE_FRAG): $(COUV_DIR)/quatrieme.md $(CONFIG_LIVRE) $(GABARIT_LIMINAIRE) $(FILTRES)
	@mkdir -p "$(dir $@)"
	@echo "pandoc $< -> $@ (couverture, 4e)"
	@cd "$(COUV_DIR)" && SZH_LIVRE=1 $(PANDOC) "quatrieme.md" \
	  --from=$(LECTEUR) --to=html5 \
	  --metadata-file="$(abspath $(CONFIG_LIVRE))" \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_LIMINAIRE))" \
	  $(FILTRES_CHAPITRE) \
	  --output="$(abspath $@)"

$(COUVERTURE_DOS): $(LIVRE_PDF) $(CONFIG_LIVRE) $(COUVERTURE_PY)
	@$(CMJN_PYTHON) "$(COUVERTURE_PY)" --mode dos --meta "$(CONFIG_LIVRE)" \
	  --pdf-interieur "$(LIVRE_PDF)" --sortie "$@"

COUVERTURE_PREALABLES := $(LIVRE_PDF) $(COUVERTURE_FRAG) $(CONFIG_LIVRE) $(GABARIT_COUVERTURE) \
                         $(COUVERTURE_PY) $(SOCLE) $(STYLE_COUVERTURE) $(COULEURS_REFERENCE) \
                         $(LOGOS_COUVERTURE) $(FONDS_COUVERTURE) $(ILLUSTRATION_COUV)
COUVERTURE_ARGS = --meta "$(CONFIG_LIVRE)" --pdf-interieur "$(LIVRE_PDF)" \
  --quatrieme "$(COUVERTURE_FRAG)" --illustration "$(ILLUSTRATION_COUV)" \
  --gabarit "$(GABARIT_COUVERTURE)" --icc-dir "$(ICC_DIR)" \
  --css "$(SOCLE_ABS)" --css "$(abspath $(STYLE_COUVERTURE))"

$(COUVERTURE_IMPR_HTML): $(COUVERTURE_PREALABLES)
	@mkdir -p "$(dir $@)"
	@$(CMJN_PYTHON) "$(COUVERTURE_PY)" --mode impression $(COUVERTURE_ARGS) --sortie "$@"

$(COUVERTURE_HTML): $(COUVERTURE_PREALABLES)
	@mkdir -p "$(dir $@)"
	@$(CMJN_PYTHON) "$(COUVERTURE_PY)" --mode ecran $(COUVERTURE_ARGS) --sortie "$@"

# PDF/X-4 sans repli : un échec fait échouer la cible, plutôt que de livrer un PDF qu'on
# prendrait pour un PDF d'impression. couverture.py refuse aussi un PDF où reste du RVB.
$(COUVERTURE_IMPR_PDF): $(COUVERTURE_IMPR_HTML) $(COUVERTURE_PY)
	@$(CMJN_PYTHON) "$(COUVERTURE_PY)" --imprimer "$<" "$@" --meta "$(CONFIG_LIVRE)"

# La version écran, balisée PDF/UA-1 : titre, responsables et texte de 4e doivent être lus
# par un lecteur d'écran. Même cascade de repli que le PDF intérieur, pour qu'un défaut de
# balisage n'empêche pas de sortir une épreuve.
$(COUVERTURE_PDF): $(COUVERTURE_HTML)
	@$(call weasy_ua,livre,,$(dir $@)~$(notdir $@).weasyprint.err)

# PNG de la 1re et de la 4e. Ghostscript rend une couleur DeviceRGB exacte sans option de
# couleur ; l'anticrénelage ne touche que les bords des aplats.
COUVERTURE_GS = $(GS) -q -dSAFER -dNOPAUSE -dBATCH -sDEVICE=png16m -r300 \
  -dTextAlphaBits=4 -dGraphicsAlphaBits=4
$(COUVERTURE_PNG_1): $(COUVERTURE_PDF)
	@$(COUVERTURE_GS) -dFirstPage=1 -dLastPage=1 -o "$@" "$<"
$(COUVERTURE_PNG_4): $(COUVERTURE_PDF)
	@$(COUVERTURE_GS) -dFirstPage=2 -dLastPage=2 -o "$@" "$<"

# --------------------------------------------------------------------------------------
# La passe CMJN du PDF imprimeur : la clé `impression.profil-cmjn` de buch.yaml nomme le
# profil ICC. Sans elle, le PDF imprimeur reste en RVB, et un livre déjà en production
# garde ses couleurs.
#
# cmjn.py pose d'abord le texte noir en K seul (ce que Ghostscript ne fait pas) et les
# couleurs de la maison à leur CMJN officiel, puis Ghostscript convertit le reste par le
# profil ICC. Voir docs/ARCHITECTURE-LIVRES.md, « Le CMJN ».
# Un profil introuvable fait échouer la cible.
PROFIL_CMJN := $(strip $(shell $(PANDOC) lua $(LIRE_CONFIG) $(CONFIG_LIVRE) impression.profil-cmjn 2>/dev/null))
# Profils de l'image (voir image/Containerfile) ; surchargeable.
ICC_DIR ?= /opt/icc
CMJN_PY := $(PIPELINE_DIR)/cmjn.py
# pypdf n'est installé que dans le venv WeasyPrint de l'image, pas dans le python3 système.
CMJN_PYTHON ?= /opt/weasyprint/bin/python

livre-imprimeur: $(LIENS_COURTS_PREALABLE) verifie-livre $(LIVRE_IMPRIMEUR_PDF)
ifeq ($(PROFIL_CMJN),)
	@echo "[livre] $(LIVRE_IMPRIMEUR_PDF) (RVB — aucun profil dans impression.profil-cmjn)"
else
	@icc="$(ICC_DIR)/$(PROFIL_CMJN)"; \
	if [ ! -f "$$icc" ]; then icc="$(PROFIL_CMJN)"; fi; \
	if [ ! -f "$$icc" ]; then \
	  echo "[livre] ✗ Profil CMJN introuvable : « $(PROFIL_CMJN) » (cherché dans $(ICC_DIR)/ puis tel quel)."; \
	  echo "[livre]   Le PDF imprimeur reste en RVB. Rien n'a été livré en CMJN : un PDF RVB qu'on croirait CMJN se paie à l'impression."; \
	  echo "[livre] [de] ✗ CMYK-Profil nicht gefunden: « $(PROFIL_CMJN) ». Das Druck-PDF bleibt in RGB."; \
	  exit 1; \
	fi; \
	$(CMJN_PYTHON) "$(CMJN_PY)" "$(LIVRE_IMPRIMEUR_PDF)" "$(LIVRE_IMPRIMEUR_PDF).cmjn" "$$icc" || exit 1; \
	mv -f "$(LIVRE_IMPRIMEUR_PDF).cmjn" "$(LIVRE_IMPRIMEUR_PDF)"; \
	echo "[livre] $(LIVRE_IMPRIMEUR_PDF) (CMJN, $(PROFIL_CMJN))"
endif

# --------------------------------------------------------------------------------------
# Le HTML web, assemblé avec CSS_LIVRE_WEB : un seul fichier autonome, polices et feuilles
# incorporées, images déjà en data: URI dans les fragments.
# --------------------------------------------------------------------------------------
$(LIVRE_WEB_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_WEB) $(ACCENT_CSS) $(IMAGES_ASSEMBLEES)
	@mkdir -p "$(dir $@)"
	@$(ASSEMBLER) \
	  --sortie "$@" \
	  --out "$(OUT)" \
	  $(CSS_LIVRE_WEB) \
	  $(FRAGMENTS)

livre-html-web: $(LIENS_COURTS_PREALABLE) verifie-livre $(LIVRE_WEB_HTML)
	@echo "[livre] $(LIVRE_WEB_HTML)"
# Garde-fou de la couverture seule, qui demande un texte de 4e. Placé avant la
# compilation, sans quoi make échouerait sur « pas de règle pour fabriquer quatrieme.md ».
verifie-couverture:
	@test -f "$(COUV_DIR)/quatrieme.md" || { \
	  echo "[livre] Pas de texte de 4e de couverture ($(COUV_DIR)/quatrieme.md introuvable)."; \
	  echo "[livre] [de] Kein Klappentext ($(COUV_DIR)/quatrieme.md fehlt)."; \
	  exit 1; }

livre-couverture: verifie-livre verifie-couverture $(COUVERTURE_DOS) $(COUVERTURE_IMPR_PDF) \
                  $(COUVERTURE_PDF) $(COUVERTURE_PNG_1) $(COUVERTURE_PNG_4)
	@echo "[livre] $(COUVERTURE_IMPR_PDF), $(COUVERTURE_PDF), $(COUVERTURE_PNG_1), $(COUVERTURE_PNG_4), $(COUVERTURE_DOS)"

# --------------------------------------------------------------------------------------
# EPUB 3, fabriqué par pandoc (catalogue OPF, navigation, images des data: URI sorties
# vers EPUB/media/) à partir d'un HTML qu'il puisse découper.
#
# Pandoc ne coupe qu'aux titres de premier niveau non imbriqués. Or chaque chapitre est
# dans une <section class="szh-chapitre">, nécessaire au PDF (belle page, couleur, onglet).
# livre-epub-prepare.py retire ces sections pour l'EPUB ; sinon tout le livre tiendrait en
# un fichier, sans navigation.
#
# szh-notes.lua ne s'applique pas en epub3 : pandoc y fait de vraies notes de fin, liées et
# navigables. szh-legende-avant.lua s'y applique.
#
# Les métadonnées EPUB sont écrites par l'assembleur, qui lit déjà buch.yaml.
# --------------------------------------------------------------------------------------
$(LIVRE_EPUB_HTML): $(FRAGMENTS_EPUB) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(EPUB_PREPARE) $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(IMAGES_ASSEMBLEES)
	@mkdir -p "$(OUT)"
	@$(ASSEMBLER) \
	  --sortie "$@.avec-sections" \
	  --out "$(OUT)" \
	  --metadonnees-epub "$(LIVRE_EPUB_META)" \
	  $(FRAGMENTS_EPUB)
	@python3 "$(EPUB_PREPARE)" "$@.avec-sections" "$@"
	@rm -f "$@.avec-sections"

# $(LIVRE_EPUB_META) n'est pas un prérequis : il est écrit par la recette du HTML
# ci-dessus, et make, sans règle pour lui, échouerait sur un out/ vide (« No rule to make
# target »).
# Le socle (jetons) précède epub.css, qui utilise var(--c-ink) et les autres jetons. Il y
# entre sans ses @font-face, dont les ../fonts/ ne sont pas dans l'archive : la liseuse
# garde ses polices.
EPUB_SOCLE := $(OUT)/.szh-socle-epub.css
$(EPUB_SOCLE): $(SOCLE)
	@mkdir -p "$(OUT)"
	@sed '/^@font-face/,/}/d' "$<" > "$@"

$(LIVRE_EPUB): $(LIVRE_EPUB_HTML) $(STYLE_LIVRE_EPUB) $(EPUB_SOCLE) $(ACCENT_CSS) $(OUT)/$(NOM_LIVRE)-couverture-1.png
	@$(PANDOC) "$(LIVRE_EPUB_HTML)" \
	  --from=html --to=epub3 \
	  --split-level=1 \
	  --metadata-file="$(LIVRE_EPUB_META)" \
	  --css="$(abspath $(EPUB_SOCLE))" --css="$(abspath $(STYLE_LIVRE_EPUB))" --css="$(ACCENT_ABS)" \
	  --epub-cover-image="$(OUT)/$(NOM_LIVRE)-couverture-1.png" \
	  --output="$@"

livre-epub: $(LIENS_COURTS_PREALABLE) verifie-livre $(LIVRE_EPUB)
	@echo "[livre] $(LIVRE_EPUB)"
