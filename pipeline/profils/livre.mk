# Moteur LIVRE. Inclus par pipeline/Makefile quand le dossier porte un buch.yaml.
#
# Le principe, et la seule chose à retenir : UN CHAPITRE SE COMPILE COMME UN ARTICLE.
# Même `cd` dans son dossier, même suite de filtres, même --embed-resources. Ce n'est pas
# une commodité, c'est ce qui fait que le gestionnaire de médias, l'éditeur de tableaux,
# l'import Word et l'aperçu du cockpit fonctionnent sur un livre sans une ligne de plus.
# La seule différence est le gabarit : un chapitre ne sort pas une page HTML, il sort un
# FRAGMENT, que livre-assembler.py colle ensuite dans le livre.
#
# Pourquoi pas une seule invocation de pandoc sur les douze chapitres : chaque chapitre a
# son propre media/, et pandoc n'a qu'un dossier courant. Le détail est en tête de
# livre-assembler.py.
#
# ⚠ Trois écarts connus avec la revue, à ne pas découvrir en production :
#   * szh-niveaux.lua EST branché, en mode livre (SZH_LIVRE) : il laisse le <h1> du
#     chapitre où il est et ne compacte que le corps, à partir de <h2>. Il ne l'était pas
#     au début, au motif qu'il décalerait les titres — et le prix s'est vu au premier livre
#     réel : un manuscrit qui passe de « # » à « ### » sort un PDF NON CONFORME PDF/UA-1.
#   * szh-numerotation.lua et szh-sections.lua comptent PAR DOCUMENT, donc ici par
#     chapitre : les compteurs repartent à 1 à chaque chapitre. Les livres publiés
#     numérotent en continu (« Abbildung 12 » au chapitre 4). Le rang du chapitre leur est
#     passé en SZH_CHAPITRE ; tant qu'ils ne le lisent pas, la numérotation est locale au
#     chapitre. C'est le premier défaut à corriger.
#   * la bibliographie est aujourd'hui celle de chaque chapitre. Un ouvrage collectif la
#     veut ainsi ; une monographie la veut en fin de volume.

# --------------------------------------------------------------------------------------
# Ce que le dossier contient
# --------------------------------------------------------------------------------------
CONFIG_LIVRE := buch.yaml
CH_DIR       := chapitres
LIM_DIR      := liminaires
COUV_DIR     := couverture
UNITES_DIR   := chapitres
WORD_DIR     := chapitres-word

# Lecture de l'ordre des chapitres depuis buch.yaml : la clé `ordre-chapitres` donne le
# nouvel ordre si elle porte une liste, sinon l'ordre reste alphabétique par nom de dossier.
# Le sed lit la ligne qui commence par « ordre-chapitres: » et capture ce qui est entre
# crochets « [a, b, c] », ce qui couvre la forme écrite par serialiserAusgabe().
ORDRE_LU := $(shell sed -n "s/^ordre-chapitres:[[:space:]]*\[\([^]]*\)\].*/\1/p" $(CONFIG_LIVRE) 2>/dev/null | head -1)
# La liste se séparant par les virgules dans « [a, b, c] », avec espaces possibles autour.
# On retire aussi les guillemets d'un éventuel flux mal parsé.
ORDRES := $(shell printf '%s\n' '$(ORDRE_LU)' | sed "s/[,[:space:]]\+/ /g; s/^[[:space:]]*//; s/[[:space:]]*\$$//g; s/'//g; s/\"//g")

# Tous les chapitres trouvés sur le disque.
#
# Sauf ceux dont le nom commence par « _ » : c'est une pièce de travail et non un chapitre.
# livre-scinder.py y dépose ce qu'il n'a pas su rattacher en scindant un manuscrit —
# « _scission-<slug>-liminaire-non-repris », qui contient la page de titre du Word d'origine
# — pour que la rédaction le relise et le replace à la main. Sans cette exclusion, le
# préfixe ne voulait rien dire et la pièce s'imprimait à la suite du livre : le VN-FALC
# sortait avec sa page de titre en dernier chapitre. Un dossier écarté est ANNONCÉ, jamais
# passé sous silence : retirer le « _ » suffit à en faire un chapitre.
DOSSIERS_CHAPITRES := $(sort $(foreach d,$(wildcard $(CH_DIR)/*),\
                $(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
TOUS_CHAPITRES := $(filter-out _%,$(DOSSIERS_CHAPITRES))
$(foreach c,$(filter _%,$(DOSSIERS_CHAPITRES)),\
  $(warning [livre] « $(c) » n'est pas imprimé : un dossier préfixé « _ » est une pièce de travail, à relire et à replacer. Retirez le « _ » pour en faire un chapitre.)\
  $(warning [livre] [de] « $(c) » wird nicht gedruckt: ein Ordner mit Präfix « _ » ist ein Arbeitsstück. Entfernen Sie das « _ », um daraus ein Kapitel zu machen.))

# Réordonner selon l'ordre donné : les slugs de ORDRES en tête, puis les chapitres manquants
# par tri alphabétique, de manière à ce qu'un nouveau chapitre ne disparaisse jamais du livre.
# Diagnostic : si un slug de ORDRES n'existe pas, le signaler comme warning.
CHAPITRES_ORDONNES :=
$(foreach s,$(ORDRES),$(if $(wildcard $(CH_DIR)/$(s)/$(s).md),,$(warning [livre] chapitre «$(s)» listé dans ordre-chapitres mais pas trouvé dans $(CH_DIR)/)))
# Ajouter les slugs qui existent, dans l'ordre donné.
$(foreach s,$(ORDRES),$(if $(filter $(s),$(TOUS_CHAPITRES)),$(eval CHAPITRES_ORDONNES += $(s))))
# Puis ajouter les chapitres non listés, par tri alphabétique.
$(foreach c,$(TOUS_CHAPITRES),$(if $(filter $(c),$(CHAPITRES_ORDONNES)),,$(eval CHAPITRES_ORDONNES += $(c))))
CHAPITRES := $(CHAPITRES_ORDONNES)

# Un chapitre = chapitres/<slug>/<slug>.md, comme un article. L'ordre est celui du tri des
# noms de dossier — et du tri alphabétique après ceux ordonnés par « ordre-chapitres ».
FRAGMENTS := $(foreach c,$(CHAPITRES),$(OUT)/$(CH_DIR)/$(c).frag.html)
FRAGMENTS_EPUB := $(foreach c,$(CHAPITRES),$(OUT)/$(CH_DIR)/$(c).epub-frag.html)

# ⚠ LES CHAPITRES SE COMPILENT DANS L'ORDRE, ET C'EST UNE OBLIGATION, pas un confort.
# szh-numerotation.lua numérote les figures et les tableaux EN CONTINU sur tout le volume ;
# comme chaque chapitre est une invocation pandoc séparée, il ne peut connaître son point
# de départ qu'en lisant ce que les chapitres précédents ont consommé — un petit report par
# chapitre, écrit sous $(OUT)/.szh-compteurs/. Un chapitre compilé avant son prédécesseur
# ne trouverait pas ce report : le filtre le dit et renumérote localement, mais le livre
# sort alors avec deux « Abbildung 1 ».
# Les deux lignes ci-dessous rendent l'ordre STRUCTUREL plutôt que probable : chaque
# fragment dépend du précédent. C'est aussi ce qui rend le moteur sûr sous `make -j`, où
# rien ne garantirait autrement l'ordre.
# Le prix est réel — plus de parallélisme entre chapitres — et il est petit : pandoc met
# moins d'une seconde par chapitre, quand WeasyPrint pagine le volume entier en une passe
# qui, elle, n'a jamais été parallélisable.
COMPTEURS_DIR := $(OUT)/.szh-compteurs
# Chaque fragment reçoit le précédent en prérequis. `PRECEDENT` retient le dernier vu au fil
# du foreach ; le premier fragment n'en reçoit aucun, et la chaîne se referme d'elle-même.
PRECEDENT :=
$(foreach f,$(FRAGMENTS),$(eval $(f): $(PRECEDENT))$(eval PRECEDENT := $(f)))
# Les fragments EPUB portent la meme contrainte, et leurs propres reports.
PRECEDENT_EPUB :=
$(foreach f,$(FRAGMENTS_EPUB),$(eval $(f): $(PRECEDENT_EPUB))$(eval PRECEDENT_EPUB := $(f)))

# Pièces liminaires écrites à la main (préface, avant-propos…). Compilées comme des
# chapitres, insérées par l'assembleur à la place que buch.yaml leur donne.
LIMINAIRES     := $(patsubst $(LIM_DIR)/%.md,$(OUT)/$(LIM_DIR)/%.html,$(wildcard $(LIM_DIR)/*.md))

# Nom des sorties : celui du dossier du livre, ce qui donne un fichier reconnaissable une
# fois sorti de son dossier — « 2026-B330-Canonica.pdf » et non « livre.pdf ».
# ⚠ `$(notdir …)` est INTERDIT ici, et c'est un défaut qui ne se voit qu'au vrai
#   emplacement. Les fonctions de chemin de make travaillent sur des MOTS, séparés par des
#   espaces : sur le dossier réel des livres —
#     C:\Users\…\OneDrive - SZH CSPS\Revues-TESTING\54_Buch\BU02_Redaktion\<livre>
#   — `$(notdir $(CURDIR))` rendait « OneDrive - SZH 2027-B329-… », c'est-à-dire trois mots
#   recollés. Toutes les sorties portaient ce nom, la couverture cherchait un PDF intérieur
#   qui n'existait pas, et la compilation s'arrêtait. Le banc d'essai du dépôt, lui, n'a pas
#   d'espace dans son chemin : le défaut y était invisible.
#   `basename` passe par le shell, qui sait ce qu'est un chemin.
NOM_LIVRE  := $(shell basename "$(CURDIR)")
LIVRE_HTML := $(OUT)/$(NOM_LIVRE).html
LIVRE_PDF  := $(OUT)/$(NOM_LIVRE).pdf
# PDF imprimeur : même contenu, assemblé une seconde fois avec imprimeur.css en plus dans
# la pile de CSS (fond perdu, traits de coupe) — un fichier HTML à part, pour ne pas faire
# porter le fond perdu au PDF numérique. Suffixe conforme à docs/ARCHITECTURE-LIVRES.md §3.
LIVRE_IMPRIMEUR_HTML := $(OUT)/$(NOM_LIVRE)-imprimeur.html
LIVRE_IMPRIMEUR_PDF  := $(OUT)/$(NOM_LIVRE)-imprimeur.pdf
# HTML web : un troisième assemblage, avec web.css — voir docs/ARCHITECTURE-LIVRES.md §3
# (dossier out/web/). Un nom distinct de $(LIVRE_HTML), qui reste le HTML DE COMPILATION
# que WeasyPrint pagine — celui-ci est la sortie lue par un humain, dans un navigateur.
LIVRE_WEB_HTML := $(OUT)/web/$(NOM_LIVRE).html
# EPUB 3 : un HTML intermediaire (les <section> de chapitre en moins, voir la cible), le
# fichier de metadonnees que l assembleur ecrit depuis buch.yaml, et l archive.
LIVRE_EPUB_HTML := $(OUT)/$(NOM_LIVRE)-epub.html
LIVRE_EPUB_META := $(OUT)/$(NOM_LIVRE)-epub.yaml
LIVRE_EPUB      := $(OUT)/$(NOM_LIVRE).epub

# --------------------------------------------------------------------------------------
# Maquette : deux chartes, une seule feuille de plus. `maquette:` de buch.yaml, lue par sed
# comme le fait déjà le Makefile pour `profil:` — l'image WSL n'a pas PyYAML.
# Une valeur inconnue tombe sur « normal » APRÈS l'avoir dit : un livre composé dans la
# mauvaise charte sans un mot est pire qu'un livre qui refuse de sortir.
# --------------------------------------------------------------------------------------
MAQUETTE_LUE := $(strip $(shell sed -n "s/^maquette:[[:space:]]*[\"']*\([a-zA-Z-]*\).*/\1/p" \
                          $(CONFIG_LIVRE) 2>/dev/null | head -1))
MAQUETTE     := $(if $(MAQUETTE_LUE),$(MAQUETTE_LUE),normal)

# ⚠ LE LECTEUR PANDOC DÉPEND DE LA MAQUETTE, et c'est le seul endroit où c'est vrai.
# En FALC, le retour à la ligne porte du SENS — une phrase, une ligne — et le lecteur
# markdown ordinaire recolle les lignes d'un paragraphe. Le travail de la rédaction
# disparaîtrait à la compilation, sans un mot. `+hard_line_breaks` le conserve.
# La maquette « normal », elle, veut l'inverse : un paragraphe justifié se recompose, et
# des retours durs y feraient des lignes courtes au hasard des saisies.
LECTEUR := $(if $(filter falc,$(MAQUETTE)),markdown+hard_line_breaks,markdown)

# Couleur d'un chapitre : elle peint la pastille du numéro, l'onglet de tranche et le
# repère du sommaire (maquette FALC). Les six sont les couleurs de charte de la maison
# (styles/couleurs.css) prises au cran 800, le seul qui porte du texte blanc à Lc −90 ou
# mieux — la pastille en contient.
# ⚠ Elle est posée ICI, par rang, et non en CSS avec `:nth-of-type`. Le sélecteur compte
#   les <section> FRÈRES, liminaires comprises : sur un livre à quatre liminaires, le
#   chapitre 1 recevait la couleur du sixième. Un décalage silencieux, invisible tant
#   qu'on ne compare pas au sommaire.
# ⚠ Sans le croisillon : dans une recette, un « # » non protégé ouvre un COMMENTAIRE de
#   shell, et tout ce qui suit sur la ligne — la parenthèse fermante comprise — disparaît.
#   La recette le remet, entre guillemets.
PALETTE_CHAPITRE := 9F001F 2E5A6D 555900 26613B 8E2E27 624C58

# Position verticale de l'onglet de tranche (maquette FALC) : six crans, un par couleur de
# la palette ci-dessus, échelonnés sur la hauteur utile de la page — c'est ce décalage,
# et lui seul, qui fait l'index à pouce. Posé ICI par rang, EXACTEMENT comme la couleur et
# pour la même raison : un `:nth-of-type` CSS compte les <section> frères, liminaires
# comprises, et décale l'onglet d'autant de pièces liminaires que le livre en a.
ONGLET_HAUT_CHAPITRE := 30mm 58mm 86mm 114mm 142mm 170mm

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

# Feuilles empilées, dans l'ordre : socle (polices, jetons), base (géométrie), charte.
# L'accent de l'ouvrage vient en dernier — il surcharge, il ne peut donc pas précéder.
CSS_LIVRE := --css "$(SOCLE_ABS)" --css "$(abspath $(STYLE_LIVRE_BASE))" \
             --css "$(abspath $(STYLE_LIVRE_CHART))" --css "$(ACCENT_ABS)"

# Même pile, avec imprimeur.css intercalé entre la charte et l'accent — jamais après :
# l'accent surcharge, un fond perdu qu'il masquerait ne servirait à rien.
CSS_LIVRE_IMPRIMEUR := --css "$(SOCLE_ABS)" --css "$(abspath $(STYLE_LIVRE_BASE))" \
             --css "$(abspath $(STYLE_LIVRE_CHART))" --css "$(abspath $(STYLE_LIVRE_IMPR))" \
             --css "$(ACCENT_ABS)"

# Pile du HTML web : socle (jetons) + web.css SEULEMENT — ni livre/base.css ni la charte
# (normal/falc), bâties en millimètres pour une page imprimée (voir web.css, en tête).
# --css-embed, pas --css : « autonome » est la promesse de cette sortie, un seul fichier
# ouvrable par file:// sans rien à côté (voir livre-assembler.py, main()).
CSS_LIVRE_WEB := --css-embed "$(SOCLE_ABS)" --css-embed "$(abspath $(STYLE_LIVRE_WEB))" \
             --css-embed "$(ACCENT_ABS)"

# La suite de filtres d'un chapitre. Même ordre que la revue, aux trois écarts ci-dessus.
FILTRES_CHAPITRE := \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-sauts-uniques.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-niveaux.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-listes-serrees.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-scope.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-typographie.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-grille.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-numerotation.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-tableau-boite.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-legende-avant.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-sections.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-livre-auteurs.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-citations.lua" \
  --lua-filter="$(PIPELINE_DIR)/filters/szh-notes.lua"

# La MEME suite, moins szh-notes.lua : la variante EPUB.
# szh-notes transforme les Note en <span class="szh-note"> que print.css descend en pied de
# page par `float: footnote`. Sur une liseuse, ce mecanisme n existe pas : le texte de la
# note se lit AU MILIEU DE LA PHRASE. Mesure sur le banc, avant correction :
#   « …an den Fuss ihrer Seite<span>Diese Fussnote muss…</span>, nicht ans Ende… »
# Sans ce filtre, les Note traversent intactes et le writer epub3 de pandoc en fait de
# vraies notes de fin, liees et navigables. C est mieux que tout ce qu on bricolerait.
FILTRES_CHAPITRE_EPUB := $(filter-out --lua-filter="$(PIPELINE_DIR)/filters/szh-notes.lua",$(FILTRES_CHAPITRE))

.PHONY: livre livre-pdf livre-imprimeur livre-couverture livre-html livre-html-web \
        livre-epub \
        verifie-livre verifie-couverture

livre: livre-pdf

# --------------------------------------------------------------------------------------
# Garde-fous. Ils disent ce qui manque et ce qu'il faut faire, dans les deux langues du
# poste — la même convention que les messages de la revue.
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
	$(call refuser_metafichiers,$(CH_DIR),[livre])

# --------------------------------------------------------------------------------------
# Un chapitre -> un fragment HTML autonome (images en data: URI).
# Le `cd` dans le dossier du chapitre est ce qui rend media/ et tables/ relatifs au .md,
# exactement comme pour un article. Le rang du chapitre est passé en SZH_CHAPITRE, et sa
# couleur en métadonnée : la charte FALC en fait la pastille et l'onglet de tranche.
# --------------------------------------------------------------------------------------
# ⚠ Une règle à motif n'accepte qu'un seul « % » par prérequis : `chapitres/%/%.md` est
#   refusé par make. C'est `.SECONDEXPANSION` (posé par le Makefile principal) qui permet
#   d'écrire `$$*` deux fois — même dispositif que la règle des articles.
$(OUT)/$(CH_DIR)/%.frag.html: $(CH_DIR)/$$*/$$*.md $(CONFIG_LIVRE) $(GABARIT_CHAPITRE) $(FILTRES) \
                              $$(wildcard $(CH_DIR)/$$*/tables/*.html) \
                              $$(wildcard $(CH_DIR)/$$*/media/*) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.meta.yaml) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.biblio.md)
	@mkdir -p "$(dir $@)"
	@slug="$*"; \
	rang=$$(printf '%s\n' $(CHAPITRES) | grep -n -x "$$slug" | cut -d: -f1); \
	index=$$(( (rang - 1) % 6 + 1 )); \
	couleur="#$$(printf '%s\n' $(PALETTE_CHAPITRE) | sed -n "$${index}p")"; \
	onglet=$$(printf '%s\n' $(ONGLET_HAUT_CHAPITRE) | sed -n "$${index}p"); \
	meta=""; \
	if [ -f "$(CH_DIR)/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	echo "pandoc $(CH_DIR)/$$slug/$$slug.md -> $@ (chapitre $$rang)"; \
	cd "$(CH_DIR)/$$slug" && SZH_LIVRE=1 SZH_CHAPITRE="$$rang" \
	  SZH_COMPTEURS="$(abspath $(COMPTEURS_DIR))/$$rang.txt" \
	  SZH_AUSGABE="$(abspath $(CONFIG_LIVRE))" $(PANDOC) "$$slug.md" \
	  --from=$(LECTEUR) --to=html5 \
	  --metadata-file="$(abspath $(CONFIG_LIVRE))" $$meta \
	  --metadata slug="$$slug" \
	  --metadata couleur-chapitre="$$couleur" \
	  --metadata rang-chapitre="$$rang" \
	  --metadata onglet-haut="$$onglet" \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_CHAPITRE))" \
	  $(FILTRES_CHAPITRE) \
	  --output="$(abspath $@)"

# Le meme chapitre, compile pour l EPUB : suite de filtres sans szh-notes (voir
# FILTRES_CHAPITRE_EPUB). Les reports de compteurs sont tenus a part — un fragment EPUB
# et un fragment PDF du meme chapitre consomment les memes numeros, et melanger leurs
# reports ferait repartir la numerotation de travers a la compilation suivante.
$(OUT)/$(CH_DIR)/%.epub-frag.html: $(CH_DIR)/$$*/$$*.md $(CONFIG_LIVRE) $(GABARIT_CHAPITRE) $(FILTRES) \
                              $$(wildcard $(CH_DIR)/$$*/tables/*.html) \
                              $$(wildcard $(CH_DIR)/$$*/media/*) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.meta.yaml) \
                              $$(wildcard $(CH_DIR)/$$*/$$*.biblio.md)
	@mkdir -p "$(dir $@)"
	@slug="$*"; \
	rang=$$(printf '%s\n' $(CHAPITRES) | grep -n -x "$$slug" | cut -d: -f1); \
	index=$$(( (rang - 1) % 6 + 1 )); \
	couleur="#$$(printf '%s\n' $(PALETTE_CHAPITRE) | sed -n "$${index}p")"; \
	onglet=$$(printf '%s\n' $(ONGLET_HAUT_CHAPITRE) | sed -n "$${index}p"); \
	meta=""; \
	if [ -f "$(CH_DIR)/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	echo "pandoc $(CH_DIR)/$$slug/$$slug.md -> $@ (chapitre $$rang, variante EPUB)"; \
	cd "$(CH_DIR)/$$slug" && SZH_LIVRE=1 SZH_CHAPITRE="$$rang" \
	  SZH_COMPTEURS="$(abspath $(COMPTEURS_DIR))/epub/$$rang.txt" \
	  SZH_AUSGABE="$(abspath $(CONFIG_LIVRE))" $(PANDOC) "$$slug.md" \
	  --from=$(LECTEUR) --to=html5 \
	  --metadata-file="$(abspath $(CONFIG_LIVRE))" $$meta \
	  --metadata slug="$$slug" \
	  --metadata couleur-chapitre="$$couleur" \
	  --metadata rang-chapitre="$$rang" \
	  --metadata onglet-haut="$$onglet" \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_CHAPITRE))" \
	  $(FILTRES_CHAPITRE_EPUB) \
	  --output="$(abspath $@)"

# Une pièce liminaire écrite à la main : même chaîne, sans le gabarit de chapitre — elle
# n'ouvre pas sur une belle page et ne porte pas de pastille.
$(OUT)/$(LIM_DIR)/%.html: $(LIM_DIR)/%.md $(CONFIG_LIVRE) $(GABARIT_LIMINAIRE) $(FILTRES)
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
$(LIVRE_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(ACCENT_CSS)
	@mkdir -p "$(OUT)"
	@python3 "$(ASSEMBLEUR)" \
	  --meta "$(CONFIG_LIVRE)" \
	  --gabarit "$(GABARIT_LIVRE)" \
	  --sortie "$@" \
	  $(CSS_LIVRE) \
	  $(FRAGMENTS)

livre-html: verifie-livre $(LIVRE_HTML)

# Le PDF numérique : balisé PDF/UA-1 quand WeasyPrint y parvient, replis en cascade comme
# pour la revue. La porte dure reste `verifier-ua`, appelée par l'export.
$(LIVRE_PDF): $(LIVRE_HTML)
	@tmp='$(dir $@)~$$$(notdir $@)'; jrnl='$(dir $@)~weasyprint.err'; \
	: > "$$jrnl"; \
	if $(WEASYPRINT) --pdf-variant pdf/ua-1 $< "$$tmp" 2>>"$$jrnl"; then :; \
	elif $(WEASYPRINT) --pdf-tags $< "$$tmp" 2>>"$$jrnl"; then \
	  echo "[livre] PDF/UA-1 indisponible -> PDF balisé simple : $@"; \
	else \
	  echo "[livre] balisage PDF indisponible -> PDF non balisé : $@"; \
	  $(WEASYPRINT) $< "$$tmp" 2>>"$$jrnl" || { \
	    echo "[livre] ✖ WeasyPrint n'a pas pu produire $@. Ce qu'il en dit :"; \
	    grep -v 'WARNING: Anchor defined twice' "$$jrnl" | tail -12 | sed 's/^/[weasyprint] /'; \
	    echo "[livre]   Journal complet : $$jrnl"; \
	    echo "[livre] [de] ✖ WeasyPrint konnte das PDF nicht erzeugen. Vollständiges Protokoll: $$jrnl"; \
	    exit 1; }; \
	fi; \
	reste=$$(($$(wc -l < "$$jrnl") - 20)); \
	sed -n '1,20p' "$$jrnl" | sed 's/^/[weasyprint] /'; \
	test "$$reste" -le 0 || echo "[weasyprint] … et $$reste ligne(s) de plus dans $$jrnl"; \
	mv -f "$$tmp" "$@"

livre-pdf: verifie-livre $(LIVRE_PDF)
	@echo "[livre] $(LIVRE_PDF)"

# --------------------------------------------------------------------------------------
# Le PDF IMPRIMEUR : même contenu, une pile de CSS de plus (imprimeur.css : fond perdu,
# traits de coupe — voir ce fichier pour ce qui s'y ajoute et pourquoi). Un fichier HTML
# assemblé À PART : le PDF numérique ne doit pas hériter du fond perdu, et réciproquement.
# ⚠ Toujours en RVB — voir docs/ARCHITECTURE-LIVRES.md §4.3, le CMJN est un chantier
#   ouvert, non traité ici. N'ajoute ni Ghostscript ni profil ICC.
# --------------------------------------------------------------------------------------
$(LIVRE_IMPRIMEUR_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(STYLE_LIVRE_IMPR) $(ACCENT_CSS)
	@mkdir -p "$(OUT)"
	@python3 "$(ASSEMBLEUR)" \
	  --meta "$(CONFIG_LIVRE)" \
	  --gabarit "$(GABARIT_LIVRE)" \
	  --sortie "$@" \
	  $(CSS_LIVRE_IMPRIMEUR) \
	  $(FRAGMENTS)

# Même cascade de repli que le PDF numérique : le balisage PDF/UA ne coûte rien de plus à
# tenter ici, et un PDF imprimeur non balisé n'a aucune raison de l'être moins que l'autre.
$(LIVRE_IMPRIMEUR_PDF): $(LIVRE_IMPRIMEUR_HTML)
	@tmp='$(dir $@)~$$$(notdir $@)'; jrnl='$(dir $@)~weasyprint.err'; \
	: > "$$jrnl"; \
	if $(WEASYPRINT) --pdf-variant pdf/ua-1 $< "$$tmp" 2>>"$$jrnl"; then :; \
	elif $(WEASYPRINT) --pdf-tags $< "$$tmp" 2>>"$$jrnl"; then \
	  echo "[livre] PDF/UA-1 indisponible -> PDF balisé simple : $@"; \
	else \
	  echo "[livre] balisage PDF indisponible -> PDF non balisé : $@"; \
	  $(WEASYPRINT) $< "$$tmp" 2>>"$$jrnl" || { \
	    echo "[livre] ✖ WeasyPrint n'a pas pu produire $@. Ce qu'il en dit :"; \
	    grep -v 'WARNING: Anchor defined twice' "$$jrnl" | tail -12 | sed 's/^/[weasyprint] /'; \
	    echo "[livre]   Journal complet : $$jrnl"; \
	    echo "[livre] [de] ✖ WeasyPrint konnte das PDF nicht erzeugen. Vollständiges Protokoll: $$jrnl"; \
	    exit 1; }; \
	fi; \
	reste=$$(($$(wc -l < "$$jrnl") - 20)); \
	sed -n '1,20p' "$$jrnl" | sed 's/^/[weasyprint] /'; \
	test "$$reste" -le 0 || echo "[weasyprint] … et $$reste ligne(s) de plus dans $$jrnl"; \
	mv -f "$$tmp" "$@"

# --------------------------------------------------------------------------------------
# La couverture à plat : 4e de couverture, dos, 1re de couverture, sur UNE page — le
# second fichier qui part chez l'imprimeur, à côté du PDF intérieur.
#
# Le dos ne se DEVINE pas : couverture.py le calcule à partir du nombre de pages LU dans
# $(LIVRE_PDF), juste avant de composer (sauf si buch.yaml impose impression.dos-mm, qui
# gagne toujours). C'est pourquoi $(LIVRE_PDF) est un prérequis de la couverture, et non
# l'inverse : un dos calculé sur un compte de pages périmé est le défaut le plus cher du
# métier (voir docs/ARCHITECTURE-LIVRES.md §3 et l'en-tête de couverture.py).
# --------------------------------------------------------------------------------------
GABARIT_COUVERTURE := $(PIPELINE_DIR)/templates/szh-couverture.html
STYLE_COUVERTURE   := $(PIPELINE_DIR)/styles/livre/couverture.css
COUVERTURE_PY      := $(PIPELINE_DIR)/couverture.py

# L'illustration est FACULTATIVE (couverture/illustration.jpg|jpeg|png|svg|webp) : aucun
# des deux livres de banc n'en porte. `firstword` : une seule image par couverture, celle
# qui trie en premier si plusieurs extensions coexistent — un cas qui ne s'est pas encore
# présenté, donc sans règle de priorité éprouvée.
ILLUSTRATION_COUV := $(firstword $(wildcard $(COUV_DIR)/illustration.*))

COUVERTURE_FRAG := $(OUT)/$(COUV_DIR)/quatrieme.html
COUVERTURE_HTML := $(OUT)/$(COUV_DIR)/$(NOM_LIVRE)-couverture.html
COUVERTURE_PDF  := $(OUT)/$(NOM_LIVRE)-couverture.pdf

# Le texte de 4e de couverture : compilé COMME UN CHAPITRE (même chaîne que les
# liminaires : même lecteur, mêmes filtres, donc la même typographie maison), mais il ne
# porte ni pastille ni ouverture de belle page — ce n'est pas un chapitre, seulement le
# même prestataire pandoc.
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

# L'assemblage : buch.yaml + le fragment de 4e + le PDF intérieur (pour son compte de
# pages) + l'illustration éventuelle -> le HTML que WeasyPrint composera.
$(COUVERTURE_HTML): $(LIVRE_PDF) $(COUVERTURE_FRAG) $(CONFIG_LIVRE) $(GABARIT_COUVERTURE) \
                    $(COUVERTURE_PY) $(SOCLE) $(STYLE_COUVERTURE) $(ILLUSTRATION_COUV)
	@mkdir -p "$(dir $@)"
	@python3 "$(COUVERTURE_PY)" \
	  --meta "$(CONFIG_LIVRE)" \
	  --pdf-interieur "$(LIVRE_PDF)" \
	  --quatrieme "$(COUVERTURE_FRAG)" \
	  --illustration "$(ILLUSTRATION_COUV)" \
	  --gabarit "$(GABARIT_COUVERTURE)" \
	  --sortie "$@" \
	  --css "$(SOCLE_ABS)" --css "$(abspath $(STYLE_COUVERTURE))"

# HTML -> PDF. Balisé PDF/UA-1 comme les autres sorties, et pas « seulement une image
# d'imprimerie » : la couverture porte le titre, les auteur·e·s et le texte de 4e, c'est-à-dire
# précisément ce qu'un lecteur d'écran doit pouvoir annoncer d'un livre. Mesuré : elle passe
# la porte veraPDF ua1 telle quelle, le balisage ne coûte donc rien à tenter.
# Même cascade de repli que le PDF intérieur, et pour la même raison : un défaut de balisage
# ne doit pas empêcher de sortir une épreuve. `bleed`/`marks` sont posés par couverture.css,
# pas par cette recette. Temporaire puis rename local, ignoré par la synchro OneDrive.
$(COUVERTURE_PDF): $(COUVERTURE_HTML)
	@tmp='$(dir $@)~$$$(notdir $@)'; jrnl='$(dir $@)~weasyprint.err'; \
	: > "$$jrnl"; \
	if $(WEASYPRINT) --pdf-variant pdf/ua-1 $< "$$tmp" 2>>"$$jrnl"; then :; \
	elif $(WEASYPRINT) --pdf-tags $< "$$tmp" 2>>"$$jrnl"; then \
	  echo "[livre] PDF/UA-1 indisponible -> couverture balisée simple : $@"; \
	elif $(WEASYPRINT) $< "$$tmp" 2>>"$$jrnl"; then \
	  echo "[livre] balisage PDF indisponible -> couverture non balisée : $@"; \
	else \
	  echo "[livre] échec de la couverture :"; cat "$$jrnl" >&2; exit 1; \
	fi; \
	sed -n '1,20p' "$$jrnl" | sed 's/^/[weasyprint] /'; \
	mv -f "$$tmp" "$@"

# --------------------------------------------------------------------------------------
# La passe CMJN, facultative et COMMANDÉE : la clé `impression.profil-cmjn` de buch.yaml
# nomme le profil de sortie. Vide, le PDF imprimeur reste en RVB, comme il l'a toujours
# été — un livre déjà en production ne doit pas changer de couleurs parce qu'on a mis le
# toolkit à jour.
#
# Deux temps, et le second ne défait pas le premier (mesuré) : cmjn.py substitue d'abord
# les couleurs que le graphiste a chiffrées — le noir du texte en K SEUL, et les sept
# teintes de la charte à leurs valeurs officielles — puis Ghostscript convertit le reste
# par le profil ICC en laissant intact ce qui est déjà en DeviceCMYK.
#
# Pourquoi la table du graphiste plutôt que l'ICC : mesuré sur le bleu nuit #252B46, la
# charte dit 65/45/0/60 et l'ICC en fait 91/82/42/47. Ce n'est pas la même couleur, et
# c'est le chiffre du graphiste qui fait foi.
PROFIL_CMJN := $(strip $(shell sed -n "s/^[[:space:]]*profil-cmjn:[[:space:]]*[\"']*\([^\"'#]*\).*/\1/p" \
                         $(CONFIG_LIVRE) 2>/dev/null | head -1))
# Le profil vit dans l'image (voir image/Containerfile) ; surchargeable pour une machine
# qui l'a ailleurs, ou pour éprouver avec le profil d'Adobe.
ICC_DIR ?= /opt/icc
CMJN_PY := $(PIPELINE_DIR)/cmjn.py

livre-imprimeur: verifie-livre $(LIVRE_IMPRIMEUR_PDF)
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
	python3 "$(CMJN_PY)" "$(LIVRE_IMPRIMEUR_PDF)" "$(LIVRE_IMPRIMEUR_PDF).cmjn" "$$icc" || exit 1; \
	mv -f "$(LIVRE_IMPRIMEUR_PDF).cmjn" "$(LIVRE_IMPRIMEUR_PDF)"; \
	echo "[livre] $(LIVRE_IMPRIMEUR_PDF) (CMJN, $(PROFIL_CMJN))"
endif

# --------------------------------------------------------------------------------------
# Le HTML web : troisième assemblage, avec web.css SEUL (--css-embed, pas --css) — voir
# CSS_LIVRE_WEB ci-dessus et web.css pour le pourquoi. Un seul fichier, autonome : polices
# et couleurs incorporées, images déjà en data: URI depuis la compilation des fragments.
# --------------------------------------------------------------------------------------
$(LIVRE_WEB_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_WEB) $(ACCENT_CSS)
	@mkdir -p "$(dir $@)"
	@python3 "$(ASSEMBLEUR)" \
	  --meta "$(CONFIG_LIVRE)" \
	  --gabarit "$(GABARIT_LIVRE)" \
	  --sortie "$@" \
	  $(CSS_LIVRE_WEB) \
	  $(FRAGMENTS)

livre-html-web: verifie-livre $(LIVRE_WEB_HTML)
	@echo "[livre] $(LIVRE_WEB_HTML)"
# Garde-fou spécifique, à part de verifie-livre : livre-pdf et livre-html n'ont pas besoin
# d'un texte de 4e de couverture, seule cette cible en dépend. Il doit s'exécuter AVANT la
# tentative de compilation — d'où sa place, premier prérequis après verifie-livre — sans
# quoi make échouerait d'abord sur « pas de règle pour fabriquer quatrieme.md », un message
# qui ne dit pas quoi faire.
verifie-couverture:
	@test -f "$(COUV_DIR)/quatrieme.md" || { \
	  echo "[livre] Pas de texte de 4e de couverture ($(COUV_DIR)/quatrieme.md introuvable)."; \
	  echo "[livre] [de] Kein Klappentext ($(COUV_DIR)/quatrieme.md fehlt)."; \
	  exit 1; }

livre-couverture: verifie-livre verifie-couverture $(COUVERTURE_PDF)
	@echo "[livre] $(COUVERTURE_PDF)"

# --------------------------------------------------------------------------------------
# EPUB 3. PAS un nouvel assembleur : pandoc sait fabriquer l archive — catalogue OPF,
# navigation, et il ressort meme les images des data: URI vers EPUB/media/. Ce qu il faut
# lui donner, c est un HTML qu il puisse DECOUPER.
#
# ⚠ Le decoupage est le seul vrai obstacle, et il est mesure : pandoc ne coupe qu aux titres
#   de premier niveau NON IMBRIQUES. Nos chapitres sont enveloppes dans une
#   <section class="szh-chapitre"> — indispensable au PDF, ou elle porte l ouverture sur
#   belle page, la couleur et l onglet de tranche. Sans la retirer, les douze chapitres
#   atterrissaient dans UN seul fichier et la navigation n en listait aucun.
#   livre-epub-prepare.py la retire, pour l EPUB seulement.
#
# ⚠ szh-notes.lua ne s applique pas a epub3 : le writer de pandoc fait de vraies notes de
#   fin, liees et navigables, mieux que nos notes flottantes en CSS qui n ont aucun sens
#   sur une liseuse. szh-legende-avant.lua, lui, s y applique DESORMAIS — sa garde
#   `FORMAT:match` ne connaissait que html, et la legende serait repassee sous l image.
#
# ⚠ Les metadonnees ne se tirent PAS au sed. La premiere version le faisait et sortait un
#   EPUB sans ISBN, avec un dc:creator au nom de la personne qui avait ecrit la recette.
#   L assembleur lit deja buch.yaml correctement : il ecrit le fichier que pandoc attend.
# --------------------------------------------------------------------------------------
$(LIVRE_EPUB_HTML): $(FRAGMENTS_EPUB) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(EPUB_PREPARE) $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART)
	@mkdir -p "$(OUT)"
	@python3 "$(ASSEMBLEUR)" \
	  --meta "$(CONFIG_LIVRE)" \
	  --gabarit "$(GABARIT_LIVRE)" \
	  --sortie "$@.avec-sections" \
	  --metadonnees-epub "$(LIVRE_EPUB_META)" \
	  $(FRAGMENTS_EPUB)
	@python3 "$(EPUB_PREPARE)" "$@.avec-sections" "$@"
	@rm -f "$@.avec-sections"

# ⚠ $(LIVRE_EPUB_META) n'est PAS un prérequis : il est écrit par la MÊME recette que le HTML
#   ci-dessus, donc make n'a aucune règle pour le fabriquer seul. Le déclarer ici faisait
#   échouer la cible sur « No rule to make target » — et seulement sur un `out/` propre,
#   c'est-à-dire chez quelqu'un d'autre.
$(LIVRE_EPUB): $(LIVRE_EPUB_HTML) $(STYLE_LIVRE_EPUB)
	@$(PANDOC) "$(LIVRE_EPUB_HTML)" 	  --from=html --to=epub3 	  --split-level=1 	  --metadata-file="$(LIVRE_EPUB_META)" 	  --css="$(abspath $(STYLE_LIVRE_EPUB))" 	  --output="$@"

livre-epub: verifie-livre $(LIVRE_EPUB)
	@echo "[livre] $(LIVRE_EPUB)"
