# Pipeline central SZH/CSPS : .md -> pandoc -> WeasyPrint -> PDF et HTML,
# un jeu de sorties par article. Vit dans le toolkit, s'invoque depuis le dossier de
# revue (cwd), ce Makefile étant passé par -f :
#   wsl.exe -d SZH-Publishing --cd <dossier revue> -- make -f <toolkit>/pipeline/Makefile all
#
# Entrées : articles/<slug>/<slug>.md + media/ ; sorties : out/<slug>/<slug>.pdf et .html.
# Import Word : articles-word/*.docx, converti par import-docx.sh (sa chaîne y est décrite).
# Word corrigé d'un article déjà importé : cible `reimporter`, portée par reimporter.py.
#
# Ordre des --lua-filter à la compilation, et ce qui casse si on permute :
#   szh-maquette -> szh-niveaux -> szh-listes-serrees -> szh-tabelle-inclure ->
#   szh-tabelle-scope -> szh-typographie -> szh-titre-lignes -> szh-metafichier ->
#   szh-grille -> szh-ressource -> szh-figure -> szh-numerotation ->
#   szh-tableau-boite -> szh-legende-avant -> szh-sections -> szh-auteurs ->
#   szh-citations -> szh-rubrique -> szh-cesure -> szh-exergue -> szh-notes
#   * szh-titre-lignes juste après szh-typographie : il MESURE le titre pour le couper en
#     escalier (première ligne plus courte que la deuxième), et doit donc voir le titre
#     tel qu'il s'imprimera — insécables et mots outils soudés compris, ce que
#     szh-typographie vient de poser. Avant lui, il mesurerait un titre qui n'existe pas ;
#   * szh-numerotation après szh-tabelle-inclure : il numérote des tableaux qui
#     n'existent qu'une fois le HTML réinjecté ;
#   * szh-typographie après szh-tabelle-scope et avant szh-numerotation : après, parce
#     que le texte des tableaux n'arrive qu'avec szh-tabelle-inclure, en RawBlock html ;
#     avant, parce que ce filtre ne normalise que le texte de la rédaction — le
#     « Figure N — » et le « Source : » que la maquette compose ensuite sont des
#     décisions de composition, pas des fautes de frappe, et lui passer dessus les
#     déferait ;
#   * szh-metafichier après szh-tabelle-inclure et après szh-typographie, avant szh-grille :
#     après tabelle-inclure, parce qu'une image native Word peut n'être citée que dans un
#     tableau extrait, invisible depuis le .md (le chapitre 09 du VN-FALC citait ainsi
#     fig-73) ; après typographie, parce que le libellé « IMAGE À REMPLACER » qu'il pose est
#     une décision de composition et non du texte de rédaction ; avant grille et figure,
#     qui doivent continuer de voir une Image ordinaire — la substitution ne change que la
#     cible et le texte alternatif, jamais la nature du nœud ;
#   * szh-grille avant szh-figure : une grille tombée à une seule image se dissout en
#     paragraphe, et c'est szh-figure qui en refait une figure sous le lecteur de
#     l'aperçu ;
#   * szh-numerotation après szh-figure : sous le lecteur commonmark_x de l'aperçu,
#     les Figure ne sont construites que par szh-figure ;
#   * szh-legende-avant avant szh-citations : il dissout les Figure en HTML brut, rien
#     en amont ne peut plus les lire ;
#   * szh-auteurs entre les deux derniers : après szh-sections, sinon le titre du bloc
#     auteurs recevrait un numéro de section ; avant szh-citations, qui dissout le
#     marqueur .szh-biblio devant lequel le bloc doit s'insérer — les références ferment
#     l'article, rien ne les suit ;
#   * szh-rubrique après szh-sections et après szh-citations, deux raisons qui se
#     cumulent : il pose un h2 (le titre de la rubrique, déduit du type), or szh-sections
#     numéroterait ce titre — « 1 Références du dossier » — et szh-citations reconnaît le
#     titre de la bibliographie sur son texte, si bien qu'un « Références du dossier » ou
#     un « Literatur zum Schwerpunkt » posé avant lui se ferait prendre pour la
#     bibliographie de l'article. Le contenu du bloc, lui, est du markdown ordinaire lu par
#     pandoc : tous les filtres d'amont l'ont déjà traité, celui-ci ne fait que l'envelopper ;
#   * szh-cesure en avant-dernier, et surtout APRÈS szh-citations : il enveloppe les noms
#     propres français dans un <span class="szh-sans-cesure"> pour les soustraire à la
#     césure automatique, et szh-citations apparie les appels de citation et reconnaît le
#     titre de la bibliographie SUR LE TEXTE — un span posé avant lui casserait
#     l'appariement. Après szh-rubrique aussi, dont le contenu est du markdown analysé
#     tardivement et qui doit être protégé comme le reste du corps ; avant szh-notes, pour
#     que le texte des notes le soit également, les Note étant encore des Note à ce stade ;
#   * szh-notes tout à la fin : les Note traversent la chaîne inchangées et ne
#     deviennent des Spans « szh-note » qu'à la sortie, si bien qu'aucun filtre en
#     amont ne change de comportement ;
#   * szh-citations après szh-sections : c'est lui qui pose le titre de la
#     bibliographie, et une bibliographie ne porte pas de numéro de section. szh-sections
#     ayant fini de numéroter, ce titre-là n'en reçoit pas. L'ordre inverse — celui d'avant
#     que la bibliographie devienne un fichier — imprimait « 6 Références ».
#   * szh-exergue tard, pour qu'aucun filtre ne rebâtisse après lui le bloc dont il
#     masque la mise en évidence au lecteur d'écran ; place indifférente sinon ;
# La chaîne d'aperçu reprend la même suite, sans szh-maquette ni szh-exergue : l'aperçu
# sert à relire son article, exergue comprise.
#
# Aucun chemin /mnt/c codé en dur ici (portabilité macOS). Conserver l'indentation
# par tabulations et les fins de ligne LF.

SHELL      := /bin/bash
PANDOC     ?= pandoc
WEASYPRINT ?= weasyprint
# Validateur PDF/UA. veraPDF est un outil Java ; l'image embarque un runtime taillé au
# jlink dans /opt/jre-min, pas un JRE complet, d'où le JAVA_HOME explicite. Surchargeables
# depuis l'environnement pour une intégration continue qui les installe ailleurs.
VERAPDF      ?= /opt/verapdf-cli/verapdf
VERAPDF_JAVA ?= /opt/jre-min

# Chemin absolu de ce Makefile : la cible `all` se relance par -f $(THIS).
THIS         := $(abspath $(lastword $(MAKEFILE_LIST)))
PIPELINE_DIR := $(patsubst %/,%,$(dir $(THIS)))

# Socle partagé : polices et jetons :root, lus par toutes les sorties. Toujours celui du
# toolkit, même quand la revue porte son propre styles/print.css — une feuille locale hérite
# ainsi des jetons sans les redéclarer, et ne peut pas dériver. Empilé en premier.
SOCLE      := $(PIPELINE_DIR)/styles/socle.css
SOCLE_ABS  := $(abspath $(SOCLE))

# Style de la revue s'il existe (styles/print.css), sinon style central du toolkit.
STYLE      := $(firstword $(wildcard styles/print.css) $(PIPELINE_DIR)/styles/print.css)
STYLE_ABS  := $(abspath $(STYLE))

# Mise en forme du balisage posé par les filtres Lua communs à la revue et au livre (une
# grille d'images, une image décorative, un appel de citation, une description longue…) :
# voir l'en-tête de ce fichier pour ce qui y vit et pourquoi. Empilée après print.css : ses
# règles complètent des composants que les filtres posent et doivent l'emporter sur les
# règles génériques de la maquette à spécificité égale (mesuré : `a.szh-orcid::after` et
# `a[href]::after`, même spécificité, la seconde écrasait la première quand partage-filtres
# précédait print.css — l'icône ORCID sortait avec la flèche de lien externe en trop).
PARTAGE     := $(PIPELINE_DIR)/styles/partage-filtres.css
PARTAGE_ABS := $(abspath $(PARTAGE))

# Template pandoc de la couverture + filtre Lua qui dérive les métadonnées de
# couverture et d'en-tête (étiquette de dossier, nom et ISSN de la revue).
TEMPLATE     := $(PIPELINE_DIR)/templates/szh-article.html
TEMPLATE_ABS := $(abspath $(TEMPLATE))
MAQUETTE_LUA := $(PIPELINE_DIR)/filters/szh-maquette.lua
# Tous les filtres Lua sont prerequis des rendus : en modifier un doit recompiler.
FILTRES      := $(wildcard $(PIPELINE_DIR)/filters/*.lua)

# Convertisseur de la Documentation Kirby (arborescence -> markdown intermédiaire) et le
# contrat qu'il lit avec szh-ressource.lua et szh-rubrique.lua — voir DOC_SLUGS plus bas.
DOC_CONVERTISSEUR := $(PIPELINE_DIR)/documentation-kirby.py
DOC_CHAMPS_JSON   := $(PIPELINE_DIR)/kirby/champs-documentation.json

# ---------------------------------------------------------------------------
# Profil de compilation du dossier, lu dans ausgabe.yaml par szh-lire-config.lua (pandoc
# lua, sans dépendance) : l'image WSL n'embarque pas PyYAML, et cette lecture — un seul
# petit analyseur, réutilisé par livre.mk et par exiger_titre plus bas — remplace le sed +
# head d'origine, qui ne comprenait que la forme la plus simple de chaque clé.
LIRE_CONFIG := $(PIPELINE_DIR)/filters/szh-lire-config.lua
# ⚠ Le script rend une chaîne vide dans deux cas opposés : clé `profil:` absente (dossier
#   historique, à compiler comme avant ; code de sortie 1) ou clé présente sans valeur
#   (choix du rédacteur : aucun document ; code de sortie 0). La présence se lit donc à
#   part, sur ce code de sortie.
PROFIL_PRESENT := $(shell $(PANDOC) lua $(LIRE_CONFIG) ausgabe.yaml profil >/dev/null 2>&1 && echo 1 || echo 0)
# La valeur : guillemets d'un sérialiseur tolérés, arrêt au premier caractère hors
# [a-zA-Z-] (espace, commentaire de fin de ligne, CR de Windows). Une valeur exotique
# est donc tronquée et tombe dans la branche « profil inconnu », qui échoue avec un
# message clair : pas de repli silencieux sur un autre profil.
PROFIL_LU      := $(shell $(PANDOC) lua $(LIRE_CONFIG) ausgabe.yaml profil 2>/dev/null | sed -E 's/^([a-zA-Z-]*).*/\1/')
PROFIL         := $(strip $(PROFIL_LU))
# Vide si la clé est absente (ou 0 occurrence) ; non vide sinon.
PROFIL_DECLARE := $(filter-out 0,$(PROFIL_PRESENT))

# Un dossier qui porte buch.yaml est un livre. La détection se fait sur la présence du
# fichier, et non sur une clé de configuration : un livre n'a pas d'ausgabe.yaml, donc
# aucune clé `profil:` à y lire. C'est aussi ce qui garde les règles de la revue
# intactes — elles ne s'exécutent que dans un dossier de revue, et leur littéral
# « ausgabe.yaml » n'a pas à devenir une variable.
LIVRE_CONFIG := $(wildcard buch.yaml)

# Routage de la cible `all`, résolu à la lecture du Makefile : `make -n all` montre
# la route prise sans exécuter pandoc.
# Un livre prime sur la clé `profil:` d'un ausgabe.yaml qui traînerait dans le même
# dossier : buch.yaml présent, la route est « livre », point final.
ifneq ($(LIVRE_CONFIG),)
PROFIL_ROUTE := livre
else ifeq ($(PROFIL_DECLARE),)
PROFIL_ROUTE := article
else ifeq ($(PROFIL),)
PROFIL_ROUTE := rien
else
PROFIL_ROUTE := $(PROFIL)
endif
# ---------------------------------------------------------------------------

# Articles : un dossier par article, articles/<slug>/<slug>.md.
SLUGS_MD   := $(sort $(foreach d,$(wildcard articles/*),$(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
# Article Documentation : arborescence Kirby (docs/FORMAT-DOCUMENTATION-KIRBY.md), reconnue
# à la présence de documentation.fr.txt ou documentation.de.txt dans le dossier — jamais à
# la clé `type: documentation` de la fiche, plus coûteuse à lire ici (elle demanderait un
# appel à szh-lire-config.lua par dossier, avant même de savoir si ce dossier en a besoin) et
# c'est exactement le marqueur que le format donne comme identité de l'arborescence.
DOC_SLUGS  := $(sort $(foreach d,$(wildcard articles/*),$(if $(or $(wildcard $(d)/documentation.fr.txt),$(wildcard $(d)/documentation.de.txt)),$(notdir $(d)))))
SLUGS      := $(sort $(SLUGS_MD) $(DOC_SLUGS))
OUT        := out
PDFS       := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).pdf)
HTMLS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).html)
# Aperçu HTML cliquable : rendu séparé en commonmark_x+sourcepos. Ce reader ajoute
# des divs « wrapper » : il ne doit pas nourrir WeasyPrint, le PDF reste sur
# -f markdown.
APERCUS    := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).apercu.html)
# Galleys DOCX de l'export OJS : régénérés depuis le HTML autonome, à la demande
# seulement (cible `docx`) — ni `all` ni `tout-exporter` ne les produisent.
DOCXS      := $(foreach a,$(SLUGS),$(OUT)/$(a)/$(a).docx)

# Accent des tableaux (.szh-tableau) : accent-css.py lit la couleur annuelle
# d'ausgabe.yaml et écrit un :root qui surcharge les gris de repli de print.css.
# Aucune couleur -> fichier « commentaire seul » -> gris de repli, PDF inchangé.
# Prérequis des HTML : le changer recompile les articles.
ACCENT_CSS := $(OUT)/.szh-accent.css
ACCENT_ABS := $(abspath $(ACCENT_CSS))

# Pagination continue du numéro. `.szh-pagination.json` vit dans le dossier du numéro et
# NON dans out/ : il porte un état éditorial — le départ et le nombre de pages de chaque
# article — et doit survivre à `make clean` comme à l'archivage. Les feuilles de folio, elles,
# en découlent : le jalon ci-dessous les régénère en un seul appel dès que cet état change.
# Sans cet aller-retour, un `clean` suivi d'une recompilation rendrait tous les folios à 1 —
# et EN SILENCE, car la péremption se détecte en comparant des nombres de pages, or un article
# recompilé en a exactement autant qu'avant. Mesuré.
PAGINATION      := $(PIPELINE_DIR)/pagination.py
PAGINATION_ETAT := $(wildcard .szh-pagination.json)
# L'interprète de pagination.py pour ce qui compte des pages : celui du venv WeasyPrint, le
# seul de l'image qui porte pypdf. Lu sur la première ligne du script `weasyprint` lui-même,
# pour suivre toute réinstallation. python3 en repli : pagination.py sait alors retrouver pypdf
# seul, mais sept fois plus lentement — mesuré sur un numéro de dix articles, 840 ms contre
# 114 ms par appel, et ce contrôle tourne après chaque compilation d'un numéro bouclé.
# `weasyprint` en toutes lettres, et non la variable qui le surcharge : on ne l'appelle pas,
# on cherche seulement un python qui porte pypdf. Surchargé ailleurs, le repli sur python3
# reste juste ; et le garde-fou de contrats.test.js ne prend pas cette lecture pour un appel
# dont personne ne lirait le code de sortie.
PYTHON_PAGINATION := $(or $(shell sed -n '1s/^\#!//p' "$$(command -v weasyprint 2>/dev/null)" 2>/dev/null),python3)
# Vide tant que le numéro n'a jamais été paginé : la compilation d'un numéro ordinaire ne
# dépend alors de rien de tout ceci.
FOLIOS          := $(if $(PAGINATION_ETAT),$(OUT)/.szh-folios)

# Sans ceci, make considérerait les .html comme intermédiaires et les supprimerait.
.SECONDARY: $(HTMLS) $(APERCUS)

# .szh-apercu : fichier d'une ligne écrit par le cockpit, qui nomme l'article que le
# rédacteur a sous les yeux (slug + html|pdf). La cible qui en sort passe en tête des
# prérequis de `pdf` : sous -j, l'ordre des prérequis décide de l'ordre de lancement.
# Slug filtré sur $(SLUGS) : ce fichier vient d'un autre programme, rien de son contenu
# ne doit devenir une cible make arbitraire. Absent ou non reconnu -> ne priorise rien.
APERCU_ETAT := $(shell head -n 1 .szh-apercu 2>/dev/null)
APERCU_SLUG := $(filter $(SLUGS),$(word 1,$(APERCU_ETAT)))
ifeq ($(filter pdf,$(word 2,$(APERCU_ETAT))),pdf)
PRIORITAIRE ?= $(if $(APERCU_SLUG),$(OUT)/$(APERCU_SLUG)/$(APERCU_SLUG).pdf)
else
PRIORITAIRE ?= $(if $(APERCU_SLUG),$(OUT)/$(APERCU_SLUG)/$(APERCU_SLUG).apercu.html)
endif

# Dossiers des unités (articles ou chapitres d'un livre) : articles/ par défaut, chapitres/
# pour un livre. Variables portables à livre.mk, où UNITES_DIR := chapitres.
# WORD_DIR est spécifique à chaque profil : articles-word (défaut) ou chapitres-word (livre).
UNITES_DIR := articles
WORD_DIR   := articles-word

.PHONY: all pdf docx import reimporter annuler-reimport clean verifie-dossier rafraichir-pagination etat-pagination \
        tout-exporter verifier-ua verifier-numerotation profil-rien \
        profil-book-sans-fichier \
        profil-inconnu
.SECONDEXPANSION:
# Une recette qui échoue ne doit pas laisser une cible à moitié écrite et plus récente que ses prérequis.
.DELETE_ON_ERROR:

# Cible du build (Ctrl+S, Ctrl+E) : importe les Word déposés puis régénère les sorties, en
# deux sous-make pour que les articles fraîchement convertis soient vus par la passe pdf.
# Les `ifeq` sont résolus à la lecture, donc une seule recette `all` existe. Le code de
# sortie compte autant que la route : dans l'éditeur, tout code non nul s'affiche en erreur
# rouge — on n'échoue donc que si la configuration ne peut pas être honorée.
# L'appel à `import` n'est plus précédé d'un `-` : un Word resté sur le carreau doit
# arrêter la compilation, sans quoi le numéro se publie sans lui et sans un mot.
ifeq ($(PROFIL_ROUTE),article)
# Clé `profil:` absente ou `profil: article` : comportement historique, inchangé.
all:
	@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) pdf
else ifeq ($(PROFIL_ROUTE),rien)
all: profil-rien
else ifeq ($(PROFIL_ROUTE),livre)
# Comme la route article : les Word deposes entrent d'abord, puis le livre se compose.
# Sans ce premier appel, un chapitre depose dans chapitres-word/ resterait invisible et
# le livre sortirait sans lui, sans un mot.
all:
	@$(MAKE) --no-print-directory -f $(THIS) import
	@$(MAKE) --no-print-directory -f $(THIS) livre
else ifeq ($(PROFIL_ROUTE),book)
all: profil-book-sans-fichier
else
all: profil-inconnu
endif

# `profil:` présent et vide : choix explicite, pas une panne -> sortie 0 et message
# doux. Aucune erreur rouge dans l'éditeur, aucun dossier out/ créé.
profil-rien:
	@echo "[pipeline] profil vide dans ausgabe.yaml : ce dossier ne produit volontairement aucun document. Rien à compiler."

# `profil: book` dans un ausgabe.yaml : le moteur livre existe désormais, mais il se
# déclenche sur la présence de buch.yaml, pas sur cette clé. Un dossier resté sur
# l'ancien réglage se voit dire ce qui lui manque — et non « non implémenté », qui
# n'est plus vrai.
profil-book-sans-fichier:
	@echo "[pipeline] Ce dossier déclare « profil: book » mais n'a pas de buch.yaml."
	@echo "[pipeline] Le moteur livre se reconnaît à ce fichier : créez le livre depuis le lanceur « Books SZH/CSPS », ou déposez un buch.yaml à côté d'ausgabe.yaml."
	@echo "[pipeline] [de] Dieser Ordner deklariert « profil: book », hat aber keine buch.yaml. Die Buchmaschine erkennt sich an dieser Datei."
	@exit 1

# Valeur non reconnue : on nomme la valeur reçue et les valeurs acceptées, la faute
# de frappe étant de loin le cas le plus probable. Code non nul.
profil-inconnu:
	@echo "[pipeline] profil inconnu dans ausgabe.yaml : « $(PROFIL) »"
	@echo "[pipeline] Valeurs acceptées : article (défaut) | book (différé) | vide (aucun document)."
	@exit 1

# Rebuild forcé de toute la revue : clean puis all, sans regarder les dates. Le « - »
# sur clean : un PDF verrouillé côté Windows ne doit pas empêcher la régénération.
# Puis la porte PDF/UA : ce qui sort d'ici part chez l'imprimeur et dans OJS, la
# conformité y est une promesse publique. `all` et `pdf` restent tolérants.
tout-exporter:
	-@$(MAKE) --no-print-directory -f $(THIS) clean
	@$(MAKE) --no-print-directory -f $(THIS) all
	@$(MAKE) --no-print-directory -f $(THIS) verifier-ua

# ---------------------------------------------------------------------------
# Deux langues d'un même article : les figures et les tableaux y portent-ils les mêmes
# numéros ? szh-numerotation.lua ne consomme un numéro que pour un objet légendé ; si la
# version traduite ajoute ou retire une légende, « voir Figure 2 » désigne deux objets
# différents selon la langue. Rien ne le disait.
# Les deux chemins se donnent à la main : la Revue et la Zeitschrift sont deux numéros
# distincts, et aucune clé de fiche ne relie un article à sa traduction — c'est la
# rédaction qui désigne la paire. Hors des cibles d'export : une divergence se corrige
# à la rédaction, pas au moment d'exporter.
#   make -f <toolkit>/pipeline/Makefile verifier-numerotation \
#        A=out/mon-article/mon-article.html \
#        B="../Zeitschrift 2026-03/out/mein-artikel/mein-artikel.html"
verifier-numerotation:
	@test -n "$(A)" && test -n "$(B)" || { \
	  echo "[numerotation] ✗ Deux HTML attendus : A=<version 1> B=<version 2>."; \
	  echo "[numerotation] [de] ✗ Zwei HTML erwartet: A=<Fassung 1> B=<Fassung 2>."; \
	  exit 2; \
	}
	@PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/verifier-numerotation.py" "$(A)" "$(B)"

# ---------------------------------------------------------------------------
# Porte PDF/UA-1 : veraPDF valide les PDF du numéro, verifier-ua.sh (à côté de ce Makefile)
# porte la logique — garde-fous d'outillage, appel de veraPDF, traduction par rapport-ua.py.
# Bloquante — et volontairement absente de `pdf` et de `all` : le rédacteur doit pouvoir
# relire l'épreuve d'un article encore imparfait. Elle garde ce qui s'exporte.
#
# ⚠ Le code de sortie de veraPDF dit deux choses différentes : 0 conforme, 1 non conforme,
#   mais 4 (fichier introuvable), 7 (fichier illisible) et 127 (veraPDF absent) sont des
#   pannes d'outillage — verifier-ua.sh les distingue (code > 1) et sort alors en 2, pas en
#   1 : sans quoi un validateur manquant se lirait comme un PDF conforme, et une panne
#   d'outillage se lirait comme un verdict de non-conformité.
# ⚠ Un cas échappe pourtant à ce test, et c'est le pire : un JAVA_HOME qui ne pointe sur
#   rien fait sortir le lanceur de veraPDF en code 1 — le code qui veut dire « PDF non
#   conforme ». La porte accuserait des PDF parfaits. D'où le garde-fou posé avant l'appel :
#   le runtime est vérifié avant d'être invoqué, jamais après coup — et sort lui aussi en 2.
# Ce que la porte PDF/UA valide. Pour une revue, les PDF des articles ; pour un livre, le
# PDF de l'ouvrage — profils/livre.mk réaffecte cette variable, et c'est le seul endroit
# où le profil décide de la liste.
#
# ⚠ `$$(PDFS_UA)` et non `$(PDFS_UA)` : les prérequis d'une règle explicite sont développés
#   à la lecture du Makefile, or livre.mk est inclus tout à la fin. Sans la seconde
#   expansion (`.SECONDEXPANSION`), la liste serait figée à sa valeur d'ici — celle de la
#   revue — et un livre validerait une liste vide.
#
# PDFS_UA reste $(PDFS) ici : dans un dossier de livre, profils/livre.mk la réaffecte au
# PDF de l'ouvrage (voir plus haut) — sans quoi cette porte ne validerait jamais un livre,
# un dossier sans articles/ n'ayant aucun PDF à lui proposer.
PDFS_UA    := $(PDFS)

verifier-ua: $$(PDFS_UA)
	@test -n "$(PDFS_UA)" || { echo "[pipeline] Aucun PDF à valider."; exit 1; }
	@VERAPDF="$(VERAPDF)" VERAPDF_JAVA="$(VERAPDF_JAVA)" PIPELINE_DIR="$(PIPELINE_DIR)" bash "$(PIPELINE_DIR)/verifier-ua.sh" "$(OUT)/.szh-pdfua.xml" $(PDFS_UA)

# Refus de compiler un article dont la fiche <slug>.meta.yaml manque ou n'a pas de titre.
# Sans titre, szh-maquette.lua pose un `titre-affiche` vide : le gabarit sort un <title>
# vide et un <h1> vide, et WeasyPrint estampille tout de même le PDF « PDF/UA-1 » — un
# document sans titre, ce que la norme interdit. Seul témoin auparavant : un avertissement
# pandoc que rien ne lisait.
# $(1) = liste de slugs (un seul pour la cible HTML, tous pour verifie-dossier).
# Le titre est cherché sans PyYAML, absent de l'image WSL : on isole le bloc `title:`
# jusqu'à la prochaine clé de premier niveau, on garde la valeur des lignes `cle: valeur`,
# puis on retire guillemets, accolades et espaces. S'il ne reste rien, il n'y a pas de titre.
define exiger_titre
@for slug in $(1); do \
  fiche="articles/$$slug/$$slug.meta.yaml"; \
  titre=$$($(PANDOC) lua $(LIRE_CONFIG) "$$fiche" title 2>/dev/null); \
  [ -n "$$titre" ] && continue; \
  echo "[pipeline] ⚠ L'article « $$slug » n'a pas de titre : la fiche $$fiche est absente, ou son titre est vide."; \
  echo "[pipeline] À faire : ouvrez « Métadonnées des articles » dans le cockpit, saisissez le titre de cet article, enregistrez, puis relancez la compilation (Ctrl+S)."; \
  echo "[pipeline] Pourquoi la compilation s'arrête : sans titre, le PDF sortirait avec un titre de document vide tout en s'annonçant conforme PDF/UA. Un lecteur d'écran n'aurait rien à annoncer."; \
  echo "[pipeline] [de] Der Artikel « $$slug » hat keinen Titel: $$fiche fehlt, oder der Titel ist leer. Öffnen Sie « Metadaten der Artikel » im Cockpit, geben Sie den Titel ein, speichern Sie und kompilieren Sie erneut (Ctrl+S)."; \
  exit 1; \
done
endef

# Priorité manuelle : make … all PRIORITAIRE=out/<slug>/<slug>.apercu.html
pdf: verifie-dossier $(PRIORITAIRE) $(PDFS) $(APERCUS)

verifie-dossier:
	@test -f ausgabe.yaml || { echo "[pipeline] Ce dossier n'est pas une revue (ausgabe.yaml introuvable) : $$PWD"; exit 1; }
	@test -n "$(SLUGS)" || { echo "[pipeline] Aucun article (articles/<nom>/<nom>.md) — déposez les Word dans $(WORD_DIR)/ puis enregistrez (Ctrl+S)."; exit 1; }
	@if ls -d articles/* 2>/dev/null | grep -q ' '; then \
	  echo "[pipeline] ⚠ Un dossier de articles/ contient des espaces — renommez-le sans espaces."; exit 1; \
	fi
	$(call exiger_titre,$(SLUGS))

# (Re)génère out/.szh-accent.css depuis la couleur annuelle d'ausgabe.yaml ; sans
# couleur, un fichier « commentaire seul » laisse jouer les gris de print.css.
CONFIG_COULEUR := $(firstword $(LIVRE_CONFIG) ausgabe.yaml)
$(ACCENT_CSS): $(CONFIG_COULEUR) $(PIPELINE_DIR)/styles/couleurs.css \
              $(PIPELINE_DIR)/accent-css.py $(PIPELINE_DIR)/apca.py
	@mkdir -p "$(OUT)"
	@python3 "$(PIPELINE_DIR)/accent-css.py" $(CONFIG_COULEUR) > "$@"

# Les feuilles de folio, engendrées depuis l'état de pagination et lui seul : `feuilles` ne
# regarde aucun PDF, donc rien ne boucle. C'est `rafraichir-pagination` — et, en production,
# le bouton du cockpit — qui MESURE les PDF et met l'état à jour ; la compilation ordinaire ne
# fait qu'en dériver les feuilles.
# Un seul appel écrit toutes les feuilles, d'où le jalon : une règle de motif par feuille
# rappellerait le script une fois par article pour le même travail.
$(OUT)/.szh-folios: .szh-pagination.json $(PAGINATION)
	@mkdir -p "$(OUT)"
	@python3 "$(PAGINATION)" feuilles --dossier . >/dev/null
	@touch $@

# .md -> HTML autonome (--embed-resources : images et CSS en base64). Exécuté dans le
# dossier de l'article, pour que media/ et tables/ soient relatifs au .md. Les tableaux
# extraits (tables/*.html) sont des prérequis : en éditer un recompile l'article.
# szh-citations.lua ferme la chaîne : il réinsère la bibliographie détachée à l'import
# (<slug>.biblio.md, prérequis lui aussi), lui pose son titre, ancre chaque référence et
# transforme les appels du corps en liens internes. Le texte des références n'est jamais
# réécrit.
# $$* varie selon l'article : ordinaire (articles/<slug>/<slug>.md, prérequis dur devenu
# $$(wildcard) plus bas) ou Documentation Kirby (articles/<slug>/documentation.<lang>.txt +
# ses fiches N_<slug-fiche>/, prérequis eux aussi en $$(wildcard) — voir DOC_SLUGS). Les deux
# routes partagent CETTE règle et CETTE chaîne de filtres — une seule, jamais deux copies —
# et se distinguent au dernier moment, dans la recette : si <slug>.md existe, c'est la
# source ; sinon documentation-kirby.py engendre out/<slug>/<slug>.md (jamais écrit dans
# articles/, qui reste la propriété de Pronto) et c'est LUI qui nourrit pandoc. Un test de
# contrat (test/js/ressources.test.js, « branché avant szh-numerotation ») compte les
# occurrences de chaque filtre dans ce Makefile : les dupliquer en une seconde règle
# statique par type d'article l'aurait fait mentir sans qu'il ait tort.
$(OUT)/%.html: $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).md) $$(wildcard articles/$$(notdir $$*)/documentation.*.txt) $$(wildcard articles/$$(notdir $$*)/*/*) ausgabe.yaml $(SOCLE) $(STYLE) $(PARTAGE) $(ACCENT_CSS) $(TEMPLATE) $(FILTRES) $(DOC_CHAMPS_JSON) $(DOC_CONVERTISSEUR) $$(wildcard articles/$$(notdir $$*)/tables/*.html) $$(wildcard articles/$$(notdir $$*)/media/*) $$(wildcard articles/$$(notdir $$*)/portraits/*) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).biblio.md)
	@mkdir -p "$(dir $@)"
	$(call exiger_titre,$(notdir $*))
	@slug="$(notdir $*)"; \
	if [ -f "articles/$$slug/$$slug.md" ]; then \
	  entree="$$slug.md"; \
	else \
	  echo "documentation-kirby.py articles/$$slug -> $(abspath $(OUT))/$$slug/$$slug.md"; \
	  python3 "$(DOC_CONVERTISSEUR)" --article "articles/$$slug" --champs "$(DOC_CHAMPS_JSON)" \
	    --sortie "$(abspath $(OUT))/$$slug/$$slug.md" || exit 1; \
	  entree="$(abspath $(OUT))/$$slug/$$slug.md"; \
	fi; \
	echo "pandoc articles/$$slug/$$slug.md -> $@"; \
	cd "articles/$$slug" && SZH_AUSGABE="$(abspath ausgabe.yaml)" $(PANDOC) "$$entree" \
	  --from=markdown --to=html5 \
	  --metadata-file="$(abspath ausgabe.yaml)" --metadata-file="$$slug.meta.yaml" \
	  --standalone --embed-resources \
	  --template="$(TEMPLATE_ABS)" \
	  --css="$(SOCLE_ABS)" --css="$(STYLE_ABS)" --css="$(PARTAGE_ABS)" --css="$(ACCENT_ABS)" \
	  --lua-filter="$(MAQUETTE_LUA)" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-niveaux.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-listes-serrees.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-scope.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-typographie.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-titre-lignes.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-metafichier.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-grille.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-ressource.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-numerotation.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tableau-boite.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-legende-avant.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-sections.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-auteurs.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-citations.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-rubrique.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-cesure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-exergue.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-notes.lua" \
	  --output="$(abspath $@)"
	$(call reordonner_appels_de_note,$@)

# Appel de note : pandoc écrit <a class="footnote-ref"><sup>n</sup></a>, et un <a> ne doit
# contenir aucun élément. WeasyPrint pose une annotation de lien par boîte descendante du
# <a> (anchors.py : la propriété `link` est héritée), et une seule est rattachée au /Link
# de l'arbre de structure — les autres pendent sous /NonStruct, ce que PDF/UA-1 interdit
# (règle 7.18.5). On réordonne en <sup><a>n</a></sup> : rendu identique au pixel (mesuré),
# un seul lien.
# Pourquoi ici et pas dans un filtre Lua : ce balisage-là est écrit par le writer HTML,
# donc après tous les filtres. Dissoudre les notes en amont priverait szh-citations.lua
# des appels de citation qu'elles contiennent.
# `@` en séparateur de sed : le motif contient une alternative « ref|back ».
define reordonner_appels_de_note
@sed -i -E 's@<a ([^>]*class="footnote-(ref|back)"[^>]*)><sup>([^<]*)</sup></a>@<sup><a \1>\3</a></sup>@g' "$(abspath $(1))"
endef

# .md -> HTML d'aperçu : mêmes filtres, CSS et métadonnées que la sortie PDF, mais
# reader commonmark_x+sourcepos -> chaque bloc porte data-pos, ce qui permet le clic
# vers le texte source dans la webview. Consommé par le cockpit seulement.
# ⚠ szh-sourcepos.lua vient EN PREMIER, et n'est dans aucune autre recette : sourcepos
# enveloppe aussi chaque mot dans un Span et découpe les mots à chaque signe, ce qui
# rendait szh-typographie.lua et le liage de szh-citations.lua entièrement inertes ici,
# sans rien dire. Les mesures sont en tête de ce filtre.
# Même route à deux entrées que la règle .html ci-dessus (voir son commentaire) : un
# article Documentation n'a pas de sourcepos (documentation-kirby.py ne pose aucune
# position source), donc son aperçu perd le clic-vers-le-texte — dégradation propre, le
# reader passe alors de commonmark_x+sourcepos à markdown ordinaire pour cette seule route,
# szh-sourcepos.lua et szh-ancres.lua n'ayant plus rien à faire sur un texte qu'ils n'ont
# pas engendré à partir du .md du rédacteur.
$(OUT)/%.apercu.html: $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).md) $$(wildcard articles/$$(notdir $$*)/documentation.*.txt) $$(wildcard articles/$$(notdir $$*)/*/*) ausgabe.yaml $(SOCLE) $(STYLE) $(PARTAGE) $(ACCENT_CSS) $(FILTRES) $(DOC_CHAMPS_JSON) $(DOC_CONVERTISSEUR) $$(wildcard articles/$$(notdir $$*)/tables/*.html) $$(wildcard articles/$$(notdir $$*)/media/*) $$(wildcard articles/$$(notdir $$*)/portraits/*) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml) $$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).biblio.md)
	@mkdir -p "$(dir $@)"
	@slug="$(notdir $*)"; \
	meta=""; \
	if [ -f "articles/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi; \
	if [ -f "articles/$$slug/$$slug.md" ]; then \
	  entree="$$slug.md"; lecteur="commonmark_x+sourcepos"; \
	  sourcepos="--lua-filter=$(PIPELINE_DIR)/filters/szh-sourcepos.lua --lua-filter=$(PIPELINE_DIR)/filters/szh-ancres.lua"; \
	else \
	  echo "documentation-kirby.py articles/$$slug -> $(abspath $(OUT))/$$slug/$$slug.md"; \
	  python3 "$(DOC_CONVERTISSEUR)" --article "articles/$$slug" --champs "$(DOC_CHAMPS_JSON)" \
	    --sortie "$(abspath $(OUT))/$$slug/$$slug.md" || exit 1; \
	  entree="$(abspath $(OUT))/$$slug/$$slug.md"; lecteur="markdown"; sourcepos=""; \
	fi; \
	echo "pandoc articles/$$slug/$$slug.md -> $@ (aperçu)"; \
	cd "articles/$$slug" && SZH_APERCU=1 $(PANDOC) "$$entree" \
	  --from=$$lecteur --to=html5 $$sourcepos \
	  --metadata-file="$(abspath ausgabe.yaml)" $$meta \
	  --standalone --embed-resources \
	  --css="$(SOCLE_ABS)" --css="$(STYLE_ABS)" --css="$(PARTAGE_ABS)" --css="$(ACCENT_ABS)" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-niveaux.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-listes-serrees.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tabelle-scope.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-typographie.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-titre-lignes.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-metafichier.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-grille.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-ressource.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-figure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-numerotation.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-tableau-boite.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-legende-avant.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-sections.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-auteurs.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-citations.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-rubrique.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-cesure.lua" \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-notes.lua" \
	  --output="$(abspath $@)" || \
	printf '%s' '<!DOCTYPE html><html lang="fr"><body><p>Aperçu HTML indisponible pour cet article (le PDF, lui, est compilé) : voir le panneau de compilation.</p></body></html>' > "$(abspath $@)"

# HTML -> PDF (CSS Paged Media), balisé PDF/UA-1. WeasyPrint 69 : --pdf-variant
# pdf/ua-1 pose /StructTreeRoot, /MarkInfo /Marked true, /Lang et les StructElem.
# Repli automatique si la variante stricte échoue (--pdf-tags, puis PDF nu) : le
# balisage ne doit pas faire échouer le build — un rédacteur doit pouvoir sortir
# l'épreuve d'un article imparfait. La porte dure est ailleurs : `make verifier-ua`,
# appelée par les cibles d'export.
# Plus de `2>/dev/null` : la sortie d'erreur de WeasyPrint (image sans description,
# propriété CSS ignorée, police manquante) est le seul endroit où ces défauts se
# disent. Les envoyer au néant, c'était les rendre invisibles.
# Elle passe par un journal puis par sed : --embed-resources ayant remplacé les chemins
# d'image par des data: URI, WeasyPrint nomme l'image fautive par 10 ko de base64. On en
# garde 16 caractères — assez pour distinguer deux images, assez peu pour rester lisible.
# Temporaire « ~$… » dans le même dossier : rename local, ignoré par la synchro
# OneDrive, donc pas de PDF partiel.
# Quotes simples : $0 et $notdir ne doivent pas être substitués par make.
#
# Folio de départ de l'article dans le numéro : out/<slug>/.szh-folio.css, une ligne
# `@page :first { counter-reset: page N; }` écrite par pipeline/pagination.py et passée à
# WeasyPrint en feuille UTILISATEUR (-s). Trois raisons à cette forme :
#   * en -s plutôt que dans le HTML : le folio ne regarde que le PDF, alors que le HTML
#     autonome sert aussi au galley DOCX et à l'aperçu. Un article qui change de place dans
#     le numéro ne repasse donc pas par pandoc et ses vingt filtres, seulement par WeasyPrint ;
#   * `@page :first` et non `@page` : sans le `:first`, le compteur est remis à N à CHAQUE
#     page et tout le document affiche N (mesuré, WeasyPrint 69). Et `counter-reset: page 11`
#     affiche 11 sur la première page, puis 12, 13 : la valeur écrite est le départ lui-même,
#     pas départ - 1. Mesuré aussi sur le patron réel de la maquette, pied courant en
#     `position: running()` et folio en `::after { content: counter(page) }`, où le décalage
#     aurait pu se perdre ;
#   * prérequis en $(wildcard ...) et non cible : la feuille se calcule à partir du nombre de
#     pages des PDF déjà compilés, donc en faire une cible fermerait un cycle. C'est
#     `rafraichir-pagination` — et, en production, le bouton du cockpit — qui la produit ; la
#     compilation ordinaire ne fait que la consommer, et se refait si elle a changé.
# Le jalon $(FOLIOS) est un prérequis d'ORDRE SEUL (après la barre) : les feuilles doivent
# exister avant qu'une recette ne tourne, mais un état de pagination plus récent que les PDF ne
# doit pas tous les refaire — seule la feuille réellement modifiée le doit.
# Deux chemins, et il en faut deux : sur un arbre neuf la feuille n'existe pas encore quand
# make évalue le $(wildcard), et c'est le test `[ -f ]` de la recette, fait au dernier moment,
# qui la ramasse ; sur un arbre déjà compilé c'est le $(wildcard) qui force la recompilation
# quand elle change.
# ⚠ RETIRER une feuille ne ramène pas le PDF au folio 1 : plus aucun prérequis n'a bougé, le
# PDF reste plus récent que son HTML, et il garde le folio de la dernière compilation (mesuré).
# C'est pourquoi pagination.py écrit une feuille pour TOUS les articles, y compris celui dont
# le départ vaut 1.
$(OUT)/%.pdf: $(OUT)/%.html $$(wildcard $(OUT)/$$(dir $$*).szh-folio.css) | $(FOLIOS)
	@folio='$(dir $@).szh-folio.css'; sfolio=""; \
	if [ -f "$$folio" ]; then sfolio="-s $$folio"; fi; \
	tmp='$(dir $@)~$$$(notdir $@)'; jrnl='$(dir $@)~weasyprint.err'; \
	: > "$$jrnl"; \
	if $(WEASYPRINT) $$sfolio --pdf-variant pdf/ua-1 $< "$$tmp" 2>>"$$jrnl"; then :; \
	elif $(WEASYPRINT) $$sfolio --pdf-tags $< "$$tmp" 2>>"$$jrnl"; then \
	  echo "[pipeline] PDF/UA-1 indisponible -> PDF balisé simple : $@"; \
	else \
	  echo "[pipeline] balisage PDF indisponible -> PDF non balisé : $@"; \
	  $(WEASYPRINT) $$sfolio $< "$$tmp" 2>>"$$jrnl" || { \
	    echo "[pipeline] ✖ WeasyPrint n'a pas pu produire $@. Ce qu'il en dit :"; \
	    sed -E 's@(data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{16})[A-Za-z0-9+/=]+@\1… (image incorporée)@g' "$$jrnl" >&2; \
	    echo "[pipeline]   Journal conservé : $$jrnl"; \
	    echo "[pipeline] [de] ✖ WeasyPrint konnte das PDF nicht erzeugen. Protokoll: $$jrnl"; \
	    exit 1; }; \
	fi; \
	sed -E 's@(data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{16})[A-Za-z0-9+/=]+@\1… (image incorporée)@g' "$$jrnl" >&2; \
	rm -f "$$jrnl"; \
	mv -f "$$tmp" $@ || { \
	  rm -f "$$tmp"; \
	  echo "[pipeline-blocage] pdf-verrouille | fichier « $@ » | Le PDF est ouvert dans une autre application. | [de] Das PDF ist in einer anderen Anwendung geöffnet."; \
	  exit 1; }

# Rafraîchir la pagination continue du numéro : compiler ce qui manque, relire le nombre de
# pages de chaque PDF, recalculer les folios de départ, puis ne recompiler que les articles
# dont le départ a bougé.
# Deux passes, et c'est voulu : le départ d'un article ne se connaît qu'une fois les
# précédents compilés. Deux suffisent, il n'y a pas de point fixe à chercher — le nombre de
# pages d'un article ne dépend PAS de son folio de départ, le folio vivant dans le pied
# courant, hors du flux. En régime stationnaire la seconde passe ne fait rien : pagination.py
# n'écrit une feuille que si sa valeur change, donc aucun mtime ne bouge et make n'a rien à
# refaire.
# ORDRE=slug1,slug2 est OBLIGATOIRE : c'est l'ordre de lecture, et seul le cockpit le connaît.
# Il ne se déduit pas d'ausgabe.yaml : le cockpit trie le disque par collation française et
# ramène en fin de numéro les articles sans DOI — ceux de la clé `articles-sans-doi`, mais
# aussi ceux dont le type n'en reçoit pas selon la configuration OJS. Le reproduire ici, ce
# serait garantir qu'un jour le folio ne suive plus le DOI.
rafraichir-pagination:
	@test -n "$(ORDRE)" || { \
	  echo "[pipeline] ✖ ORDRE manquant : seul le cockpit connaît l'ordre de lecture du numéro. Rafraîchissez la pagination depuis le cockpit, ou passez ORDRE=a,b,c."; \
	  echo "[pipeline] [de] ✖ ORDRE fehlt: nur das Cockpit kennt die Reihenfolge der Ausgabe."; \
	  exit 2; }
	@$(MAKE) --no-print-directory -f $(THIS) pdf
	@$(PYTHON_PAGINATION) "$(PAGINATION)" rafraichir --dossier . --ordre "$(ORDRE)"
	@$(MAKE) --no-print-directory -f $(THIS) pdf

# L'état de la pagination, en JSON sur une seule ligne : ce que le cockpit lit après chaque
# compilation d'un numéro déjà paginé (pour poser l'avertissement sur les articles
# décalés) et juste avant l'export OJS (pour la porte et le champ <pages>). Ne compile
# rien, n'écrit rien. ORDRE est celui du cockpit ; sans lui, pagination.py relit l'ordre de
# la dernière pagination, ce qui suffit au diagnostic mais ne voit pas un article déplacé.
etat-pagination:
	@$(PYTHON_PAGINATION) "$(PAGINATION)" etat --dossier . $(if $(ORDRE),--ordre "$(ORDRE)")

# HTML autonome -> DOCX : galley Word de l'export OJS, régénéré depuis le HTML final
# et non depuis le .md — le reader html de pandoc comprend les tableaux réinjectés en
# HTML brut (colspan/rowspan) et les images data:, que le writer docx nourri au .md
# perdrait. Produit à la demande, hors de `all` et de `tout-exporter`.
# szh-galley-docx.lua retire les blocs purement techniques (.szh-description, cible
# des aria-describedby) : le reader html ne voit pas le CSS, et ce que print.css
# masque réapparaîtrait en clair sous chaque tableau du galley.
$(OUT)/%.docx: $(OUT)/%.html $(PIPELINE_DIR)/filters/szh-galley-docx.lua
	@echo "pandoc $< -> $@ (docx)"
	@$(PANDOC) "$<" --from=html --to=docx \
	  --lua-filter="$(PIPELINE_DIR)/filters/szh-galley-docx.lua" --output="$@"

# Les galleys de l'export OJS : la porte PDF/UA d'abord. Un numéro dont le PDF n'est pas
# conforme ne doit pas partir dans OJS avec l'étiquette « accessible ».
docx: verifie-dossier verifier-ua $(DOCXS)

# Conversion des .docx déposés dans articles-word/. Les anciens articles « à plat » sont
# migrés au passage vers articles/<slug>/ ; un article existant n'est jamais écrasé ; une
# conversion réussie supprime le .docx source, un échec le laisse en place et déclenche le
# rollback rm -rf articles/<slug> ci-dessous.
# Un réimport tué en pleine bascule laisse le dossier de l'article sous
# articles/.szh-bascule-<slug>, donc hors de SLUGS : le numéro se publierait sans lui et
# sans un mot. `reimporter.py --reprise` le remet d'aplomb, d'abord, à chaque compilation.
# Slug : le nombre de tête d'un nom comme « 4_Titre » (l'ordre voulu par le rédacteur au
# moment de l'import) est retiré du slug plutôt que complété à deux chiffres (B1, demande
# de Robin : un dossier numéroté ne survit pas à un déplacement dans l'ordre). Ce nombre ne
# nomme donc plus le dossier ; il doit être capté ailleurs pour peupler `ordre-articles`
# dans ausgabe.yaml — voir lib/slug.js:numeroOrdreArticle() côté cockpit, et le repère
# qu'il laisse dans extension.js pour le brancher. Longueur bornée à 39 caractères, parce
# que le slug nomme le dossier et son .md homonyme et compte donc quatre fois dans un
# chemin de sortie : sans borne, un titre réel dépasse la limite Windows de 260 caractères
# et la synchronisation SharePoint trébuche. La coupe tombe sur le dernier mot entier, les
# fragments d'élision d'une lettre (« -d », « -l ») sont retirés à leur tour, et la coupe
# sèche sert de repli sans tiret.
# Un nom de dossier déjà pris a deux causes opposées, et les confondre coûte cher dans les
# deux sens. Le champ `source:` de la fiche, écrit à l'import par docx-meta.py, les sépare :
#   * même fichier Word -> l'auteur a corrigé son article et l'a redéposé. Ce n'est pas un
#     homonyme : rien n'est créé, le Word reste en attente, et le journal dit que la version
#     publiée est encore l'ancienne. Créer un « -2 » ici mettrait un doublon dans le
#     sommaire et dans l'export OJS. Le remplacement du corps est le travail de la cible
#     `reimporter` ci-dessous, et ce champ est l'ancre par laquelle elle apparie les deux.
#   * fichier Word différent -> deux articles distincts que la borne à 39 caractères écrase
#     en un seul slug (« … Teil 1 », « … Teil 2 », « … Teil 3 »). Le second reçoit « -2 »,
#     le troisième « -3 », jusqu'à 99. La place du suffixe est prise au caractère près sur
#     la fin du slug : le « -2 » dit déjà que le nom est coupé.
#   * origine inconnue (fiche antérieure à `source:`, ou article sans fiche) -> on ne
#     tranche pas et on ne crée rien : un doublon est plus difficile à défaire qu'un Word
#     resté en attente. Le message dit quoi faire dans les deux cas.
# « Déjà pris » se juge par dossier_existant() (définie dans la recette, juste après
# dire()), jamais par un simple test [ -e ] sur le slug nu : depuis que le cockpit préfixe
# le dossier d'un article nouvellement importé sur son rang (lib/import-hote.js, « 00-
# inclusion »), le slug deviné ici n'a jamais ce préfixe, et un import qui ne verrait que
# le nom nu créerait un second dossier pour le même titre à côté du premier. La fonction
# imprime le nom du dossier trouvé (nu, ou préfixé) et réussit ; elle échoue sans rien
# imprimer si aucun des deux n'existe — les deux gardes qui suivent (redépôt d'origine
# inconnue, désambiguïsation des homonymes) s'en servent chacune à sa façon.
# Le redépôt a son propre compteur au bilan : caché dans « ignoré », il redeviendrait le
# silence que cette recette corrige.
# À garder aligné avec slugifierArticle() et slugifierArticleUnique() de
# vscodium-extension/szh-cockpit/lib/slug.js : le cockpit devine le slug d'un .docx en
# attente pour dire « déjà converti ».
# Code de sortie : tout fichier Word resté sur le carreau fait échouer la recette. Sans
# cela un article disparaissait du numéro avec une sortie 0, personne n'étant averti.
#
# ⚠ Livre seulement — scission automatique. Juste après avoir converti un .docx de
# chapitres-word/ en chapitre unique (ci-dessus), on compte ses titres de niveau 1 : 2 ou
# plus, et livre-scinder.py le redécoupe aussitôt en autant de chapitres, dans le même
# geste que la conversion — aucun geste séparé à apprendre. Un seul titre de niveau 1 (le
# titre du chapitre lui-même, comme le pose Modele-chapitre-SZH.docx) n'est pas un
# manuscrit à scinder : c'est déjà un chapitre, on le laisse tel quel. Cette règle vient de
# chapitres-word/LISEZ-MOI.txt (« Un manuscrit en UN SEUL fichier… se découpe ensuite, aux
# titres de niveau 1 ») et de lire_chapitre() dans livre-scinder.py, qui ne coupe qu'à ces
# titres-là. Idempotent par construction : le déclencheur est la conversion du .docx qui
# vient d'avoir lieu — le .docx est déjà supprimé (rm -f "$$f" ci-dessus) avant qu'on y
# arrive, donc relancer `import` ne rappelle jamais la scission sur le même manuscrit. Le
# script porte son propre garde-fou si un rappel devait pourtant survenir : voir le
# constat « chapitre-cible-existe » dans livre-scinder.py.
# Une ressource manquante à la scission (image, tableau) n'efface pas le dossier d'origine
# — voir livre-scinder.py, avertir('source-non-supprimee') — et ne fait pas non plus
# échouer la conversion déjà réussie : le compteur $$scission_rate le distingue de $$rate.
import:
	@set -u; \
	shopt -s nullglob; \
	for m in $(UNITES_DIR)/*.md; do \
	  base=$$(basename "$$m" .md); \
	  mkdir -p "$(UNITES_DIR)/$$base/media"; \
	  mv "$$m" "$(UNITES_DIR)/$$base/$$base.md"; \
	  if [ -d "$(UNITES_DIR)/media/$$base" ]; then \
	    cp -r "$(UNITES_DIR)/media/$$base/." "$(UNITES_DIR)/$$base/media/" && rm -rf "$(UNITES_DIR)/media/$$base"; \
	  fi; \
	  sed -i "s|$(UNITES_DIR)/media/$$base/|media/|g" "$(UNITES_DIR)/$$base/$$base.md"; \
	  echo "[import] structure migrée : $$m -> $(UNITES_DIR)/$$base/$$base.md"; \
	done; \
	rmdir $(UNITES_DIR)/media 2>/dev/null || true; \
	for d in $(UNITES_DIR)/*/; do \
	  slug=$$(basename "$$d"); \
	  if [ -d "$$d/media/media" ]; then \
	    cp -r "$$d/media/media/." "$$d/media/" && rm -rf "$$d/media/media"; \
	    if [ -f "$$d/$$slug.md" ]; then sed -i 's|media/media/|media/|g' "$$d/$$slug.md"; fi; \
	    echo "[import] media aplati : $${d}media/media -> $${d}media"; \
	  fi; \
	done; \
	if [ "$(PROFIL_ROUTE)" = "article" ]; then \
	  PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/reimporter.py" --reprise || true; \
	fi; \
	[ -d "$(WORD_DIR)" ] || exit 0; \
	journal="$(WORD_DIR)/.import.log"; \
	: > "$$journal"; \
	export SZH_IMPORT_LOG="$$PWD/$$journal"; \
	dire() { echo "$$*"; printf '%s\n' "$$*" >> "$$journal"; }; \
	dossier_existant() { \
	  local s g; \
	  s="$$1"; \
	  if [ -e "$(UNITES_DIR)/$$s/$$s.md" ]; then printf '%s' "$$s"; return 0; fi; \
	  for g in "$(UNITES_DIR)"/[0-9]*-"$$s"; do \
	    if [ -e "$$g/$$(basename "$$g").md" ]; then printf '%s' "$$(basename "$$g")"; return 0; fi; \
	  done; \
	  return 1; \
	}; \
	shopt -s nocaseglob; \
	files=("$(WORD_DIR)"/*.docx); \
	shopt -u nocaseglob; \
	[ $${#files[@]} -gt 0 ] || exit 0; \
	mkdir -p $(UNITES_DIR); \
	ok=0; renomme=0; redepot=0; rate=0; scinde=0; scission_rate=0; \
	for f in "$${files[@]}"; do \
	  nom=$$(basename "$$f"); slug="$${nom%.*}"; \
	  tete="$${slug%%[!0-9]*}"; reste="$${slug#$$tete}"; a_un_numero=0; \
	  if [ -n "$$tete" ]; then case "$$reste" in [_-]*) a_un_numero=1;; esac; fi; \
	  slug=$$(printf '%s' "$$slug" | LC_ALL=C.UTF-8 iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$$slug"); \
	  slug=$$(printf '%s' "$$slug" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$$//'); \
	  [ -n "$$slug" ] || slug=article; \
	  if [ "$$a_un_numero" = 1 ]; then slug=$$(printf '%s' "$$slug" | sed -E 's/^[0-9]+-//'); fi; \
	  if [ $${#slug} -gt 39 ]; then scourt="$${slug:0:39}"; scourt="$${scourt%-*}"; sorph=$$(printf '%s' "$$scourt" | sed -E 's/(-[a-z0-9])+$$//'); case "$$sorph" in *-*) scourt="$$sorph";; esac; slug="$${scourt:-$${slug:0:39}}"; fi; \
	  venu_de=""; \
	  for fiche in $(UNITES_DIR)/*/*.meta.yaml; do \
	    src=$$(sed -n 's/^source:[[:space:]]*//p' "$$fiche" | head -1 | sed -e 's/^"//' -e 's/"$$//'); \
	    if [ "$$src" = "$$nom" ]; then venu_de=$$(basename "$$(dirname "$$fiche")"); break; fi; \
	  done; \
	  if [ -n "$$venu_de" ]; then \
	    dire "[import-avertissement] word-redepose | article « $$venu_de » | fichier « $$nom » | Cet article a déjà été importé depuis ce même fichier Word. Rien n'a été créé : la version corrigée reste en attente dans $(WORD_DIR)/, et l'article publié est encore l'ancien. Pour publier la correction sans perdre la fiche, les médias ni les traductions : « Réimporter cet article », sur cet article. | [de] Dieser Artikel wurde schon aus derselben Word-Datei importiert. Es wurde nichts angelegt: die korrigierte Fassung bleibt in $(WORD_DIR)/, veröffentlicht ist noch die alte. Um die Korrektur zu veröffentlichen, ohne Metadaten, Medien und Übersetzungen zu verlieren: « Artikel neu importieren », beim betreffenden Artikel."; \
	    redepot=$$((redepot+1)); continue; \
	  fi; \
	  dossier_actuel=$$(dossier_existant "$$slug") || dossier_actuel=""; \
	  if [ -n "$$dossier_actuel" ] && ! grep -q "^source:" "$(UNITES_DIR)/$$dossier_actuel/$$dossier_actuel.meta.yaml" 2>/dev/null; then \
	    dire "[import-avertissement] origine-inconnue | article « $$dossier_actuel » | fichier « $$nom » | Un article porte déjà ce nom de dossier, sans qu'on sache de quel Word il vient. Rien n'a été créé, pour ne pas risquer un doublon dans le numéro. S'il s'agit d'un autre article, renommez le fichier Word puis enregistrez (Ctrl+S) ; s'il s'agit du même article corrigé, lancez « Réimporter cet article » et désignez-lui ce fichier Word. | [de] Ein Artikel trägt diesen Ordnernamen bereits, ohne bekannte Word-Herkunft. Es wurde nichts angelegt, um kein Duplikat in der Ausgabe zu erzeugen. Handelt es sich um einen anderen Artikel, benennen Sie die Word-Datei um und speichern Sie (Ctrl+S); ist es derselbe Artikel, korrigiert, starten Sie « Artikel neu importieren » und weisen Sie ihm diese Word-Datei zu."; \
	    redepot=$$((redepot+1)); continue; \
	  fi; \
	  base="$$slug"; n=1; trop=0; \
	  while dossier_existant "$$slug" >/dev/null; do \
	    n=$$((n+1)); \
	    if [ $$n -gt 99 ]; then trop=1; break; fi; \
	    suf="-$$n"; tronc="$$base"; \
	    if [ $$(($${#tronc} + $${#suf})) -gt 39 ]; then \
	      tronc=$$(printf '%s' "$${base:0:$$((39 - $${#suf}))}" | sed -E 's/-+$$//'); \
	    fi; \
	    slug="$$tronc$$suf"; \
	  done; \
	  if [ $$trop -eq 1 ]; then \
	    dire "[import] ⚠ échec sur : $$nom — 99 articles portent déjà ce nom de dossier ; renommez le fichier Word puis enregistrez (Ctrl+S). [de] 99 Artikel tragen diesen Ordnernamen bereits; benennen Sie die Word-Datei um und speichern Sie erneut (Ctrl+S)."; \
	    rate=$$((rate+1)); continue; \
	  fi; \
	  cible="$(UNITES_DIR)/$$slug/$$slug.md"; \
	  if SZH_IMPORT_DIR="$(abspath $(UNITES_DIR)/$$slug)" bash "$(PIPELINE_DIR)/import-docx.sh" "$$f" "$$slug" "$(PIPELINE_DIR)"; then \
	    rm -f "$$f"; \
	    if [ "$$slug" = "$$base" ]; then \
	      dire "[import] converti : $$nom -> $$cible"; \
	    else \
	      dire "[import] converti : $$nom -> $$cible (le nom de dossier « $$base » était déjà pris ; cet article prend « $$slug »)"; \
	      renomme=$$((renomme+1)); \
	    fi; \
	    ok=$$((ok+1)); \
	    if [ -n "$(LIVRE_CONFIG)" ]; then \
	      titres1=$$(grep -c -E '^#[[:space:]]' "$$cible" 2>/dev/null || true); titres1=$${titres1:-0}; \
	      if [ "$$titres1" -ge 2 ] 2>/dev/null; then \
	        if PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/livre-scinder.py" "$$PWD" "$$slug"; then \
	          dire "[import] scindé : $$nom -> $$titres1 chapitre(s) ($$titres1 titres de niveau 1 détectés dans $$cible)"; \
	          scinde=$$((scinde+1)); \
	        else \
	          dire "[import] ⚠ scission incomplète : $$nom — voir les avertissements « scission-avertissement » ci-dessus ; le dossier d'origine du manuscrit a été conservé, PAS supprimé. [de] ⚠ Aufteilung unvollständig: $$nom — Details siehe oben (« scission-avertissement »); der Ursprungsordner des Manuskripts wurde beibehalten, NICHT gelöscht."; \
	          scission_rate=$$((scission_rate+1)); \
	        fi; \
	      fi; \
	    fi; \
	  else \
	    rm -rf "$(UNITES_DIR)/$$slug"; \
	    dire "[import] ⚠ échec sur : $$nom (le fichier reste dans $(WORD_DIR)/)"; rate=$$((rate+1)); \
	  fi; \
	done; \
	dire "[import] terminé : $$ok converti(s), $$renomme renommé(s), $$redepot redéposé(s), $$rate échec(s)."; \
	if [ $$scinde -ne 0 ] || [ $$scission_rate -ne 0 ]; then \
	  dire "[import] scission : $$scinde manuscrit(s) scindé(s) en chapitres, $$scission_rate incomplet(s) (dossier d'origine conservé, voir « scission-avertissement » ci-dessus). [de] Aufteilung: $$scinde Manuskript(e) in Kapitel aufgeteilt, $$scission_rate unvollständig (Ursprungsordner beibehalten, siehe oben « scission-avertissement »)."; \
	fi; \
	if [ $$redepot -ne 0 ]; then \
	  dire "[import] $$redepot fichier(s) Word attendent : leur article existe déjà, c'est sa version corrigée qui n'est pas encore publiée. Publiez-la par « Réimporter cet article ». [de] $$redepot Word-Datei(en) warten: ihr Artikel existiert bereits, nur die korrigierte Fassung ist noch nicht veröffentlicht. Veröffentlichen Sie sie über « Artikel neu importieren »."; \
	fi; \
	if [ $$rate -ne 0 ]; then \
	  dire "[import] ⚠ $$rate fichier(s) Word ne sont pas entrés dans le numéro : ils restent dans $(WORD_DIR)/. [de] $$rate Word-Datei(en) sind nicht in die Ausgabe gelangt: sie bleiben in $(WORD_DIR)/."; \
	fi; \
	if [ $$scission_rate -ne 0 ]; then \
	  dire "[import] ⚠ $$scission_rate manuscrit(s) scindé(s) incomplètement : ressource(s) manquante(s) ; dossier(s) d'origine conservé(s) — voir « scission-avertissement » ci-dessus pour la marche à suivre. [de] ⚠ $$scission_rate Manuskript(e) unvollständig aufgeteilt: fehlende Ressource(n); Ursprungsordner beibehalten — weiteres Vorgehen siehe oben (« scission-avertissement »)."; \
	fi; \
	if [ $$rate -ne 0 ] || [ $$scission_rate -ne 0 ]; then \
	  exit 1; \
	fi

# Word corrigé d'un article déjà importé : le corps est remplacé, la fiche, les tâches, le
# suivi de traduction et les portraits survivent, et l'état d'avant est gardé de côté.
# Tout le raisonnement — les tableaux retravaillés, les images, la fiche que le Word aurait
# écrite, la bascule atomique — est dans reimporter.py, qui l'explique en tête.
#
#   make -f … reimporter ARTICLE=<slug>            le Word est celui du champ `source:`
#   make -f … reimporter WORD="<nom>.docx"         l'article est celui du champ `source:`
#   make -f … reimporter ARTICLE=<slug> WORD=…     appariement forcé
#   make -f … annuler-reimport ARTICLE=<slug>      retour à l'état d'avant
#
# ⚠ make répond 2 dès qu'une recette sort non nulle : les cinq codes de reimporter.py ne
# traversent pas cette cible. Le cockpit appelle donc le script directement et lit sa ligne
# JSON ; cette cible est la porte d'entrée en ligne de commande. Une exception, pour suivre
# la règle du dossier — n'échouer que si la configuration ne peut pas être honorée : le code
# 3 (« rien à faire », le Word n'apportait rien) réussit ici. Rien n'est cassé, et une erreur
# rouge dans l'éditeur mentirait. Les autres codes non nuls ressortent, aplatis en 2.
# Pas de prérequis verifie-dossier : le script contrôle lui-même qu'il est dans une revue,
# et un numéro dont un autre article ne compile pas ne doit pas empêcher ce remplacement.
reimporter:
	@PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/reimporter.py" \
	  $(if $(ARTICLE),--article "$(ARTICLE)",) $(if $(WORD),--word "$(WORD)",); \
	c=$$?; \
	if [ $$c -eq 3 ]; then exit 0; fi; \
	exit $$c

annuler-reimport:
	@PYTHONIOENCODING=utf-8 python3 "$(PIPELINE_DIR)/reimporter.py" \
	  --annuler $(if $(ARTICLE),--article "$(ARTICLE)",)

clean:
	rm -rf "$(OUT)"

# ---------------------------------------------------------------------------
# Moteur livre. Inclus seulement dans un dossier qui porte buch.yaml : dans une revue,
# aucune de ses règles n'existe, et rien de ce qui suit ne peut donc peser sur elle.
# ---------------------------------------------------------------------------
ifneq ($(LIVRE_CONFIG),)
include $(PIPELINE_DIR)/profils/livre.mk
endif
