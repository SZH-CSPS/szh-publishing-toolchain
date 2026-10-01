# Moteur livre. Inclus par pipeline/Makefile quand le dossier porte un buch.yaml.
#
# Le principe, et la seule chose à retenir : un chapitre se compile comme un article.
# Même `cd` dans son dossier, même suite de filtres, même --embed-resources. Ce n'est pas
# une commodité, c'est ce qui fait que le gestionnaire de médias, l'éditeur de tableaux,
# l'import Word et l'aperçu du cockpit fonctionnent sur un livre sans une ligne de plus.
# La seule différence est le gabarit : un chapitre ne sort pas une page HTML, il sort un
# fragment, que livre-assembler.py colle ensuite dans le livre.
#
# Pourquoi pas une seule invocation de pandoc sur les douze chapitres : chaque chapitre a
# son propre media/, et pandoc n'a qu'un dossier courant. Le détail est en tête de
# livre-assembler.py.
#
# Les chaînes de filtres d'un chapitre (FILTRES_CHAPITRE et ses variantes EPUB et
# aperçu), et leurs écarts avec celle d'un article : pipeline/filtres.mk.

# --------------------------------------------------------------------------------------
# Ce que le dossier contient
# --------------------------------------------------------------------------------------
CONFIG_LIVRE := buch.yaml
# Cache Shlink (pipeline/liens-courts.py), à côté de buch.yaml : URL longue -> URL courte,
# lu par szh-qr.lua (SZH_LIENS_COURTS, posé ci-dessous comme SZH_AUSGABE) pour qu'un QR
# encode le lien court une fois résolu. Ni généré ni lu ici s'il n'existe pas — un livre
# sans Shlink configuré compile exactement comme avant (voir l'en-tête de liens-courts.py).
LIENS_COURTS_CACHE := liens-courts.yaml
CH_DIR       := chapitres
LIM_DIR      := liminaires
COUV_DIR     := couverture
UNITES_DIR   := chapitres
WORD_DIR     := chapitres-word

# Lecture de l'ordre des chapitres depuis buch.yaml : la clé `ordre-chapitres` donne le
# nouvel ordre si elle porte une liste, sinon l'ordre reste alphabétique par nom de dossier.
# szh-lire-config.lua rend déjà les éléments séparés par un espace, guillemets ôtés — en
# ligne (« [a, b, c] », forme écrite par serialiserAusgabe()) comme en blocs (« - a », forme
# que livre-scinder.py sait aussi écrire) : un seul lecteur pour les deux formes, au lieu du
# sed d'origine qui ne comprenait que la première.
ORDRES := $(shell $(PANDOC) lua $(LIRE_CONFIG) $(CONFIG_LIVRE) ordre-chapitres 2>/dev/null)

# Tous les chapitres trouvés sur le disque.
#
# Sauf ceux dont le nom commence par « _ » : c'est une pièce de travail, non un chapitre.
# livre-scinder.py y dépose ce qu'il n'a pas su rattacher en scindant un manuscrit.
# Un dossier préfixé « _ » est une pièce de travail annoncée, jamais imprimée ; retirer
# le préfixe en fait un chapitre.
DOSSIERS_CHAPITRES := $(sort $(foreach d,$(wildcard $(CH_DIR)/*),\
                $(if $(wildcard $(d)/$(notdir $(d)).md),$(notdir $(d)))))
TOUS_CHAPITRES := $(filter-out _%,$(DOSSIERS_CHAPITRES))
# Dossiers écartés (préfixe « _ ») : la liste se calcule ici, au niveau des variables ; le
# constat lui-même est émis par verifie-livre, en ligne codée — voir plus bas pourquoi ce
# n'est plus un $(warning).
CHAPITRES_ECARTES := $(filter _%,$(DOSSIERS_CHAPITRES))

# Réordonner selon l'ordre donné : les slugs de ORDRES en tête, puis les chapitres manquants
# par tri alphabétique, de manière à ce qu'un nouveau chapitre ne disparaisse jamais du livre.
CHAPITRES_ORDONNES :=
# Slugs de ORDRES qui ne correspondent à aucun chapitre trouvé sur le disque : la liste se
# calcule ici, le constat est émis par verifie-livre.
ORDRES_INTROUVABLES := $(strip $(foreach s,$(ORDRES),$(if $(wildcard $(CH_DIR)/$(s)/$(s).md),,$(s))))
# Ajouter les slugs qui existent, dans l'ordre donné.
$(foreach s,$(ORDRES),$(if $(filter $(s),$(TOUS_CHAPITRES)),$(eval CHAPITRES_ORDONNES += $(s))))
# Puis ajouter les chapitres non listés, par tri alphabétique.
$(foreach c,$(TOUS_CHAPITRES),$(if $(filter $(c),$(CHAPITRES_ORDONNES)),,$(eval CHAPITRES_ORDONNES += $(c))))
CHAPITRES := $(CHAPITRES_ORDONNES)

# L'ordre des chapitres, écrit sur disque pour en faire un prérequis explicite des
# fragments. Sans ce fichier, $(CHAPITRES) ne liait rien : retirer un chapitre du milieu du
# livre ne recompilait aucun des suivants, alors que leur rang, leur couleur et leur onglet
# de tranche (PALETTE_CHAPITRE, ONGLET_HAUT_CHAPITRE, tous deux posés par rang) en
# dépendent tous. Réécrit seulement si le contenu diffère : sans le `cmp -s`, chaque simple
# relecture du Makefile changerait la date du fichier et recompilerait tous les chapitres.
ORDRE_CHAPITRES_FICHIER := $(OUT)/.szh-ordre-chapitres
$(shell mkdir -p "$(OUT)" 2>/dev/null; printf '%s\n' $(CHAPITRES) | cmp -s - "$(ORDRE_CHAPITRES_FICHIER)" 2>/dev/null || printf '%s\n' $(CHAPITRES) > "$(ORDRE_CHAPITRES_FICHIER)")

# Chapitres retirés de la table des matières : clé `sommaire: non` (ou `false`) du
# <slug>.meta.yaml, lue par szh-lire-config.lua — l'image WSL n'a pas PyYAML. Guillemets et
# commentaire de fin de ligne n'y comptent pas : « sommaire: "non"  # provisoire » vaut
# « non » ; un chapitre sans meta.yaml, ou dont le meta.yaml ne porte pas cette clé, reste
# au sommaire (défaut : présent).
# ⚠ Un chapitre retiré du sommaire compile quand même, à sa place : il garde son rang dans
#   $(CHAPITRES) (couleur, SZH_CHAPITRE, compteurs de figures/tableaux continus — rien de
#   tout cela ne change). Seul $(CHAPITRES_SOMMAIRE), calculé ici, sert à numéroter la
#   pastille et à partager l'index à pouce — voir plus bas.
CHAPITRES_HORS_SOMMAIRE := $(strip $(foreach c,$(CHAPITRES),\
  $(if $(filter non false,$(strip $(shell $(PANDOC) lua $(LIRE_CONFIG) \
       $(CH_DIR)/$(c)/$(c).meta.yaml sommaire 2>/dev/null))),$(c))))
CHAPITRES_SOMMAIRE    := $(filter-out $(CHAPITRES_HORS_SOMMAIRE),$(CHAPITRES))
NB_CHAPITRES_SOMMAIRE := $(words $(CHAPITRES_SOMMAIRE))

# Même mécanique que $(ORDRE_CHAPITRES_FICHIER) ci-dessus, et pour la même raison : retirer
# un chapitre du sommaire au milieu du livre redistribue la hauteur de TOUTES les cases de
# l'index à pouce (--onglet-haut / --onglet-hauteur, posés par rang parmi
# $(CHAPITRES_SOMMAIRE) — voir plus bas) ; sans ce fichier écrit sur disque, make n'aurait
# aucune raison de recompiler les chapitres dont seule la case a changé de hauteur.
SOMMAIRE_CHAPITRES_FICHIER := $(OUT)/.szh-sommaire-chapitres
$(shell mkdir -p "$(OUT)" 2>/dev/null; printf '%s\n' $(CHAPITRES_SOMMAIRE) | cmp -s - "$(SOMMAIRE_CHAPITRES_FICHIER)" 2>/dev/null || printf '%s\n' $(CHAPITRES_SOMMAIRE) > "$(SOMMAIRE_CHAPITRES_FICHIER)")

# Un chapitre = chapitres/<slug>/<slug>.md, comme un article. L'ordre est celui du tri des
# noms de dossier — et du tri alphabétique après ceux ordonnés par « ordre-chapitres ».
FRAGMENTS := $(foreach c,$(CHAPITRES),$(OUT)/$(CH_DIR)/$(c).frag.html)
FRAGMENTS_EPUB := $(foreach c,$(CHAPITRES),$(OUT)/$(CH_DIR)/$(c).epub-frag.html)
# Aperçu HTML cliquable, un par chapitre — comme $(APERCUS) pour un article de revue.
APERCUS_CHAPITRES := $(foreach c,$(CHAPITRES),$(OUT)/$(CH_DIR)/$(c).apercu.html)

# ⚠ Les chapitres se compilent dans l'ordre, et c'est une obligation, pas un confort.
# szh-numerotation.lua numérote les figures et les tableaux en continu sur tout le volume ;
# comme chaque chapitre est une invocation pandoc séparée, il ne peut connaître son point
# de départ qu'en lisant ce que les chapitres précédents ont consommé — un petit report par
# chapitre, écrit sous $(OUT)/.szh-compteurs/. Un chapitre compilé avant son prédécesseur
# ne trouverait pas ce report : le filtre le dit et renumérote localement, mais le livre
# sort alors avec deux « Abbildung 1 ».
# Les deux lignes ci-dessous rendent l'ordre structurel plutôt que probable : chaque
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
# ⚠ `$(notdir …)` est interdit ici : les fonctions de chemin de make séparent sur les
#   espaces, et le dossier réel d'un livre en contient (OneDrive, chemins SharePoint) —
#   `$(notdir $(CURDIR))` en tronquerait alors le nom, ce que rien en aval ne rattraperait.
#   `basename` passe par le shell, qui traite le chemin comme un tout.
NOM_LIVRE  := $(shell basename "$(CURDIR)")
LIVRE_HTML := $(OUT)/$(NOM_LIVRE).html
LIVRE_PDF  := $(OUT)/$(NOM_LIVRE).pdf

# Ce que la porte `verifier-ua` valide dans un dossier de livre : le PDF NUMÉRIQUE de
# l'ouvrage, et lui seul. Pas le PDF imprimeur — il porte fond perdu et traits de coupe,
# part chez l'imprimeur et non chez un lecteur, et PDF/UA ne le concerne pas. Pas la
# couverture non plus, pour la même raison.
# Voir la définition de PDFS_UA dans pipeline/Makefile pour ce que cette réaffectation
# répare : sans elle, un livre n'était jamais validé.
PDFS_UA    := $(LIVRE_PDF)
# PDF imprimeur : même contenu, assemblé une seconde fois avec imprimeur.css en plus dans
# la pile de CSS (fond perdu, traits de coupe) — un fichier HTML à part, pour ne pas faire
# porter le fond perdu au PDF numérique. Suffixe conforme à docs/ARCHITECTURE-LIVRES.md §3.
LIVRE_IMPRIMEUR_HTML := $(OUT)/$(NOM_LIVRE)-imprimeur.html
LIVRE_IMPRIMEUR_PDF  := $(OUT)/$(NOM_LIVRE)-imprimeur.pdf
# HTML web : un troisième assemblage, avec web.css — voir docs/ARCHITECTURE-LIVRES.md §3
# (dossier out/web/). Un nom distinct de $(LIVRE_HTML), qui reste le HTML de compilation
# que WeasyPrint pagine — celui-ci est la sortie lue par un humain, dans un navigateur.
LIVRE_WEB_HTML := $(OUT)/web/$(NOM_LIVRE).html
# EPUB 3 : un HTML intermediaire (les <section> de chapitre en moins, voir la cible), le
# fichier de metadonnees que l assembleur ecrit depuis buch.yaml, et l archive.
LIVRE_EPUB_HTML := $(OUT)/$(NOM_LIVRE)-epub.html
LIVRE_EPUB_META := $(OUT)/$(NOM_LIVRE)-epub.yaml
LIVRE_EPUB      := $(OUT)/$(NOM_LIVRE).epub

# --------------------------------------------------------------------------------------
# Maquette : deux chartes, une seule feuille de plus. `maquette:` de buch.yaml, lue par
# szh-lire-config.lua comme `profil:` dans le Makefile — l'image WSL n'a pas PyYAML.
# Une valeur inconnue tombe sur « normal » après l'avoir dit : un livre composé dans la
# mauvaise charte sans un mot est pire qu'un livre qui refuse de sortir.
# --------------------------------------------------------------------------------------
MAQUETTE_LUE := $(strip $(shell $(PANDOC) lua $(LIRE_CONFIG) $(CONFIG_LIVRE) maquette 2>/dev/null))
MAQUETTE     := $(if $(MAQUETTE_LUE),$(MAQUETTE_LUE),normal)

# ⚠ Le lecteur pandoc dépend de la maquette, et c'est le seul endroit où c'est vrai.
# En FALC, le retour à la ligne porte du SENS — une phrase, une ligne — et le lecteur
# markdown ordinaire recolle les lignes d'un paragraphe. Le travail de la rédaction
# disparaîtrait à la compilation, sans un mot. `+hard_line_breaks` le conserve.
# La maquette « normal », elle, veut l'inverse : un paragraphe justifié se recompose, et
# des retours durs y feraient des lignes courtes au hasard des saisies.
LECTEUR := $(if $(filter falc,$(MAQUETTE)),markdown+hard_line_breaks,markdown)

# Le lecteur de l'aperçu HTML. Il ne peut pas être $(LECTEUR) : les positions source dont
# la webview a besoin pour le clic vers le .md n'existent que dans le lecteur commonmark
# — pandoc refuse « markdown+sourcepos ». Mais la règle FALC ci-dessus vaut des deux côtés,
# et l'aperçu la perdait : la recette forçait « commonmark_x+sourcepos » sans
# `+hard_line_breaks`, si bien qu'un chapitre FALC se relisait en paragraphes recollés
# pendant que le PDF, lui, gardait ses lignes (constaté le 11.09.2026). Une ligne = une
# idée est toute la maquette FALC : l'aperçu ne peut pas être le seul endroit où on ne la
# voit pas.
LECTEUR_APERCU := commonmark_x$(if $(filter falc,$(MAQUETTE)),+hard_line_breaks,)+sourcepos

# Couleur d'un chapitre : elle peint la pastille du numéro, l'onglet de tranche et le
# repère du sommaire (maquette FALC). Chaque teinte de styles/couleurs.css est prise au cran
# le plus CLAIR qui tient encore 3:1 contre le blanc de la page (WCAG 1.4.11, seuil d'un
# élément d'interface) : le cran 800 d'avant était plus sombre que nécessaire, et six teintes
# sombres se distinguent mal. Rouge, moutarde et mountbatten au 500 ; bleu acier et poireau
# au 600 (leur 500 tombe à 2,93 et 2,99:1). Le chiffre blanc de la pastille (13 pt demi-gras)
# reste à |Lc| ≥ 62 partout (pipeline/apca.py).
# ⚠ Capucine au 700, pas au 500 : au même cran, rouge et capucine sont presque la même
#   couleur (ΔE2000 = 4,4). Au 700, l'écart passe à 16,3, et c'est l'écart minimal de toute
#   la palette, toutes paires confondues — pas seulement entre voisins, car un livre de dix
#   chapitres fait revenir le cycle.
# Ordre : rouge · bleu acier · capucine · moutarde · mountbatten · poireau, qui écarte le plus
# les deux teintes chaudes l'une de l'autre dans le cycle.
# ⚠ Elle est posée ici, par rang, et non en CSS avec `:nth-of-type`. Le sélecteur compte
#   les <section> frères, liminaires comprises : sur un livre à quatre liminaires, le
#   chapitre 1 recevait la couleur du sixième. Un décalage silencieux, invisible tant
#   qu'on ne compare pas au sommaire.
# ⚠ Sans le croisillon : dans une recette, un « # » non protégé ouvre un commentaire de
#   shell, et tout ce qui suit sur la ligne — la parenthèse fermante comprise — disparaît.
#   La recette le remet, entre guillemets.
PALETTE_CHAPITRE := E95D5F 4D869F AE3E35 949A00 A98899 43905D

# Position ET hauteur de l'onglet de tranche (maquette FALC) : l'index à pouce. Calculées
# ICI, une seule fois, puis lues telles quelles à deux endroits — la page (--onglet-haut/
# --onglet-hauteur, en métadonnée pandoc sur la section du chapitre) et le sommaire
# (livre-assembler.py relit ces mêmes valeurs dans le fragment déjà compilé, il ne les
# recalcule jamais : voir sa note de tête). C'est ce qui garantit que le repère du
# sommaire tombe à la même hauteur que la marque, chapitre par chapitre.
#
# Avant ce correctif : six crans fixes (30/58/86/114/142/170mm), un par couleur de la
# palette — pensés pour un livre à six chapitres pile, sans rapport avec leur nombre réel.
# Un chapitre retiré du sommaire (`sommaire: non`) y aurait laissé un cran vide au milieu
# de la pile plutôt que de resserrer les autres.
#
# Maintenant : la plage utile ONGLET_Y0..ONGLET_Y1 (mm, ⚠ à tenir synchronisée avec
# --onglet-y0 de falc.css — même piège que --fond-perdu dans imprimeur.css) est partagée à
# parts égales entre les $(NB_CHAPITRES_SOMMAIRE) chapitres du sommaire. Chapitre de rang k
# PARMI CES CHAPITRES (1-indexé, PAS le rang dans $(CHAPITRES) qui sert à la couleur) :
#   hauteur = (ONGLET_Y1 - ONGLET_Y0) / NB_CHAPITRES_SOMMAIRE
#   haut    = ONGLET_Y0 + (k - 1) * hauteur
# Un chapitre hors sommaire ne reçoit ni l'un ni l'autre : sa section ne porte pas ces deux
# métadonnées, et falc.css efface sa marque (règle `[data-sommaire="non"] > .szh-onglet`).
#
# Ce même k devient aussi --metadata numero-chapitre : le chiffre de la pastille ronde
# (falc.css, § pastille), désormais un running element affiché sur CHAQUE page du
# chapitre (coin extérieur), pas seulement sur l'ouverture. Écrit en dur dans le gabarit
# plutôt que confié à un compteur CSS `counter()` : la valeur qui compte est CELLE DU
# SOMMAIRE (k, ci-dessus), pas le rang de la section dans le document — les deux
# divergent dès qu'un chapitre est hors sommaire — et un `counter()` lu depuis une boîte
# de marge dépend de l'état de la pagination à cet endroit précis, un terrain plus fragile
# qu'une valeur déjà connue au moment de la compilation du chapitre. Un chapitre hors
# sommaire ne reçoit pas cette métadonnée : sa pastille reste vide (falc.css, même garde
# que pour l'onglet).
#
# La COULEUR, elle, garde son cycle de 6 (PALETTE_CHAPITRE ci-dessus), et par le rang dans
# $(CHAPITRES) — inchangé : un chapitre hors sommaire compte toujours pour ce cycle-là,
# exactement comme pour SZH_CHAPITRE et les compteurs de figures/tableaux continus.
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
# L'appel de l'assembleur, commun aux cinq assemblages ; chaque recette ajoute sa sortie,
# ses feuilles et ses fragments.
ASSEMBLER          = python3 "$(ASSEMBLEUR)" --meta "$(CONFIG_LIVRE)" --gabarit "$(GABARIT_LIVRE)"

# Feuilles empilées, dans l'ordre : socle (polices, jetons), base (géométrie), charte,
# partage-filtres (balisage des filtres communs à la revue et au livre — voir
# pipeline/Makefile pour ce qu'elle porte), empilée après la charte : ses règles complètent
# des composants posés par les filtres et doivent l'emporter sur les règles génériques de
# la maquette à spécificité égale (mesuré : `a.szh-orcid::after` perdait devant la flèche de
# lien externe générique quand partage-filtres précédait la maquette). L'accent de
# l'ouvrage vient en dernier — il surcharge, il ne peut donc pas précéder.
CSS_LIVRE := --css "$(SOCLE_ABS)" --css "$(abspath $(STYLE_LIVRE_BASE))" \
             --css "$(abspath $(STYLE_LIVRE_CHART))" --css "$(PARTAGE_ABS)" --css "$(ACCENT_ABS)"

# Même pile, avec imprimeur.css intercalé entre la charte et partage-filtres — jamais après
# l'accent, qui surcharge : un fond perdu qu'il masquerait ne servirait à rien.
CSS_LIVRE_IMPRIMEUR := --css "$(SOCLE_ABS)" --css "$(abspath $(STYLE_LIVRE_BASE))" \
             --css "$(abspath $(STYLE_LIVRE_CHART))" --css "$(abspath $(STYLE_LIVRE_IMPR))" \
             --css "$(PARTAGE_ABS)" --css "$(ACCENT_ABS)"

# Pile du HTML web : socle (jetons) + web.css seulement — ni livre/base.css ni la charte
# (normal/falc), bâties en millimètres pour une page imprimée (voir web.css, en tête).
# --css-embed, pas --css : « autonome » est la promesse de cette sortie, un seul fichier
# ouvrable par file:// sans rien à côté (voir livre-assembler.py, main()).
# partage-filtres.css n'y entre pas : web.css et epub.css (l'autre sortie hors pagination)
# refont déjà, chacune dans ses propres unités d'écran, tout ce qu'il faut à leur médium —
# voir leur en-tête. Une feuille pensée en px pour l'impression n'y ajouterait rien.
CSS_LIVRE_WEB := --css-embed "$(SOCLE_ABS)" --css-embed "$(abspath $(STYLE_LIVRE_WEB))" \
             --css-embed "$(ACCENT_ABS)"

.PHONY: livre livre-pdf livre-imprimeur livre-couverture livre-html livre-html-web \
        livre-epub \
        verifie-livre verifie-couverture liens-courts
# Une recette qui échoue ne doit pas laisser une cible à moitié écrite et plus récente que ses prérequis.
.DELETE_ON_ERROR:
# livre-couverture liste verifie-livre et verifie-couverture comme deux prérequis frères —
# make ne garantit leur ordre d'exécution que dans un build en série. Sous `make -j`, ils
# peuvent tourner en parallèle ou dans l'ordre inverse, et verifie-couverture s'exécuterait
# alors avant que verifie-livre n'ait confirmé un buch.yaml et une maquette valides.
.NOTPARALLEL:

livre: livre-pdf $(APERCUS_CHAPITRES)

# Lien court Shlink : résolu AUTOMATIQUEMENT, en tout premier, par livre-pdf/livre-imprimeur/
# livre-epub/livre-html-web (ci-dessous, LIENS_COURTS_PREALABLE) MAIS SEULEMENT quand
# SZH_SHLINK_URL est posée dans l'environnement — un livre doit continuer à compiler
# exactement comme avant tant que personne ne l'a posée, pas seulement retomber sur un
# cache vide. Le lanceur Windows pose SZH_SHLINK_URL/SZH_SHLINK_CLE (et les relaie à la WSL
# par WSLENV) ; sans lui, seule une invocation manuelle les fournit :
#   SZH_SHLINK_URL=https://link.szh-csps.ch SZH_SHLINK_CLE=... make -f livre.mk liens-courts
# Sans SZH_SHLINK_URL : ne fait rien (ni appel réseau, ni écriture du cache) — voir
# pipeline/liens-courts.py, qui referait de toute façon ce même constat par URL s'il était
# appelé sans configuration ; s'arrêter ici évite un avertissement par lien pour rien dire
# de plus que « pas configuré ».
#
# --lecteur "$(LECTEUR)" : le même lecteur pandoc que la compilation des chapitres (markdown
# ou markdown+hard_line_breaks selon la maquette) — voir liens-courts.py, scanner_liens_qr().
liens-courts:
ifdef SZH_SHLINK_URL
	@python3 "$(PIPELINE_DIR)/liens-courts.py" "$(LIENS_COURTS_CACHE)" --scan "$(CH_DIR)" --lecteur "$(LECTEUR)"
else
	@echo "[livre] SZH_SHLINK_URL n'est pas posé : rien à résoudre (voir l'en-tête de cette cible)."
	@echo "[livre] [de] SZH_SHLINK_URL ist nicht gesetzt: nichts aufzulösen (siehe Kopf dieses Ziels)."
endif

# Prérequis conditionnel des quatre cibles qui compilent réellement un livre (pas
# `verifie-livre` seule, pas `livre-couverture` : la couverture ne porte pas de QR). Une
# variable plutôt qu'un `ifdef` répété quatre fois — et make ne construit un phony qu'une
# fois par exécution, quel que soit le nombre de cibles qui le citent en prérequis.
# Listée EN PREMIER prérequis de chacune : sous `.NOTPARALLEL:` (déjà posé plus haut), make
# exécute les prérequis d'une cible dans l'ordre où ils sont écrits — même convention que
# `livre-couverture: verifie-livre verifie-couverture …` plus bas. Le cache doit être écrit
# AVANT que le premier chapitre ne compile : c'est lui qui lit SZH_LIENS_COURTS pour
# résoudre le QR au fil de la compilation du fragment.
LIENS_COURTS_PREALABLE :=
ifdef SZH_SHLINK_URL
LIENS_COURTS_PREALABLE := liens-courts
endif

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
	@for c in $(CHAPITRES_ECARTES); do \
	  echo "[livre-avertissement] chapitre-ecarte | chapitre « $$c » | Ce dossier n'est pas imprimé : un dossier préfixé « _ » est une pièce de travail, à relire et à replacer. Retirez le « _ » pour en faire un chapitre. | [de] Dieser Ordner wird nicht gedruckt: ein Ordner mit Präfix « _ » ist ein Arbeitsstück. Entfernen Sie das « _ », um daraus ein Kapitel zu machen."; \
	done
	@for s in $(ORDRES_INTROUVABLES); do \
	  echo "[livre-avertissement] chapitre-introuvable | chapitre « $$s » | Ce chapitre est listé dans ordre-chapitres mais introuvable dans $(CH_DIR)/ : vérifiez le nom du dossier, ou retirez-le de la liste. | [de] Dieses Kapitel steht in ordre-chapitres, wurde aber in $(CH_DIR)/ nicht gefunden: prüfen Sie den Ordnernamen, oder entfernen Sie es aus der Liste."; \
	done

# --------------------------------------------------------------------------------------
# Un chapitre -> un fragment HTML autonome (images en data: URI).
# Le `cd` dans le dossier du chapitre est ce qui rend media/ et tables/ relatifs au .md,
# exactement comme pour un article. Le rang du chapitre est passé en SZH_CHAPITRE, et sa
# couleur en métadonnée : la charte FALC en fait la pastille et l'onglet de tranche.
# --------------------------------------------------------------------------------------
# ⚠ Une règle à motif n'accepte qu'un seul « % » par prérequis : `chapitres/%/%.md` est
#   refusé par make. C'est `.SECONDEXPANSION` (posé par le Makefile principal) qui permet
#   d'écrire `$$*` deux fois — même dispositif que la règle des articles.
#
# Le contexte d'un chapitre, commun au fragment, à sa variante EPUB, à son aperçu et au
# chapitre seul : rang, couleur, case de l'index à pouce et fiche, calculés depuis $$slug,
# que la recette pose avant.
define contexte_chapitre
rang=$$(printf '%s\n' $(CHAPITRES) | grep -n -x "$$slug" | cut -d: -f1); \
index=$$(( (rang - 1) % 6 + 1 )); \
couleur="#$$(printf '%s\n' $(PALETTE_CHAPITRE) | sed -n "$${index}p")"; \
if printf '%s\n' $(CHAPITRES_HORS_SOMMAIRE) | grep -qx "$$slug"; then \
  onglet_meta="--metadata hors-sommaire=1"; \
else \
  numero=$$(printf '%s\n' $(CHAPITRES_SOMMAIRE) | grep -n -x "$$slug" | cut -d: -f1); \
  hauteur=$$(awk -v y0=$(ONGLET_Y0) -v y1=$(ONGLET_Y1) -v n=$(NB_CHAPITRES_SOMMAIRE) 'BEGIN{printf "%.3f", (y1-y0)/n}'); \
  haut=$$(awk -v y0=$(ONGLET_Y0) -v h=$$hauteur -v k=$$numero 'BEGIN{printf "%.3f", y0+(k-1)*h}'); \
  onglet_meta="--metadata onglet-haut=$${haut}mm --metadata onglet-hauteur=$${hauteur}mm --metadata numero-chapitre=$$numero"; \
fi; \
meta=""; \
if [ -f "$(CH_DIR)/$$slug/$$slug.meta.yaml" ]; then meta="--metadata-file=$$slug.meta.yaml"; fi;
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
	  --metadata rang-chapitre="$$rang" \
	  $$onglet_meta \
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
	  --metadata rang-chapitre="$$rang" \
	  $$onglet_meta \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_CHAPITRE))" \
	  $(FILTRES_CHAPITRE_EPUB) \
	  --output="$(abspath $@)"

# Aperçu HTML cliquable d'un chapitre, comme $(OUT)/%.apercu.html pour un article de revue
# (Makefile ~l.420) : même suite de filtres que le fragment moins szh-exergue
# ($(FILTRES_CHAPITRE_APERCU)), mais lecteur $(LECTEUR_APERCU)
# (chaque bloc porte data-pos, pour le clic vers le texte source dans la webview) sous
# SZH_APERCU=1, et deux filtres de plus en tête. Ces deux-là réparent ce que le lecteur
# commonmark fait autrement que $(LECTEUR) : szh-sourcepos.lua défait les enveloppes et le
# découpage des mots qui rendaient la typographie et le liage des citations inertes ici,
# szh-ancres.lua rend aux titres l'identifiant du PDF, sans quoi un lien de table des
# matières ne menait nulle part dans l'aperçu. Ils ne sont dans aucune autre recette.
# La revue n'y passe pas le gabarit de l'article (szh-article.html, la couverture) :
# son aperçu n'a pas de couverture à composer. Un chapitre n'a pas cette différence — son gabarit (GABARIT_CHAPITRE) est déjà le même
# habillage minimal pour le fragment comme pour l'aperçu — donc celui-ci le garde.
# Compteurs à part (SZH_COMPTEURS/apercu/) : cet aperçu ne doit ni lire ni écrire dans les
# reports du fragment PDF ou EPUB, qui font foi pour la numérotation publiée.
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
# Ce que cela ne fait pas, à dessein :
#   * Les AUTRES chapitres ne sont pas recompilés. La numérotation continue des figures et
#     des tableaux part donc des reports du dernier build complet ($(COMPTEURS_DIR)/) :
#     « Abbildung 7 » y garde le numéro que le livre lui a donné. Si ces reports manquent
#     (out/ nettoyé, jamais de build complet), szh-numerotation.lua le dit et renumérote
#     depuis 1. Modifier le NOMBRE de figures d'un chapitre précédent sans recompiler le
#     livre laisse les suivants à leur ancien numéro, jusqu'au prochain `make livre`.
#   * Les folios repartent à 1 : le chapitre seul n'a pas de pagination du livre.
#
# Le fragment est celui d'un build complet, mêmes variables, mêmes filtres
# ($(FILTRES_CHAPITRE)), même rang, même couleur : seule la chaîne « un fragment dépend du
# précédent » est coupée (elle forcerait à compiler tous les chapitres d'avant), et le
# fichier est écrit à part pour ne jamais passer pour le fragment du livre. Le report de
# compteurs de ce chapitre est, lui, réécrit au même endroit qu'au build complet.
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
	  --metadata rang-chapitre="$$rang" \
	  $$onglet_meta \
	  --standalone --embed-resources \
	  --template="$(abspath $(GABARIT_CHAPITRE))" \
	  $(FILTRES_CHAPITRE) \
	  --output="$(abspath $@)"

$(CHAPITRE_HTML_SEUL): $(CHAPITRE_FRAG_SEUL) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
                       $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(PARTAGE) $(ACCENT_CSS)
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
# La pagination passe par la cascade weasy_ua du Makefile, étiquette `livre`. Son journal
# se montre ainsi : vingt lignes préfixées en cas de succès, les douze dernières en cas
# d'échec, base64 abrégé dans les deux cas, et le fichier reste à côté du PDF.
define weasy_echec_livre
tail -12 "$$jrnl" | $(ABREGER_BASE64) | sed 's/^/[weasyprint] /'; \
echo "[livre]   Journal complet : $$jrnl"; \
echo "[livre] [de] ✖ WeasyPrint konnte das PDF nicht erzeugen. Vollständiges Protokoll: $$jrnl";
endef

# Le digest de succès s'arrête à vingt lignes, et il le dit : une troncature muette se lit
# comme un journal complet.
define weasy_journal_livre
reste=$$(($$(wc -l < "$$jrnl") - 20)); \
sed -n '1,20p' "$$jrnl" | $(ABREGER_BASE64) | sed 's/^/[weasyprint] /'; \
test "$$reste" -le 0 || echo "[weasyprint] … et $$reste ligne(s) de plus dans $$jrnl";
endef

$(LIVRE_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(PARTAGE) $(ACCENT_CSS)
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
# Le PDF IMPRIMEUR : même contenu, une pile de CSS de plus (imprimeur.css : fond perdu,
# traits de coupe — voir ce fichier pour ce qui s'y ajoute et pourquoi). Un fichier HTML
# assemblé À PART : le PDF numérique ne doit pas hériter du fond perdu, et réciproquement.
# ⚠ Toujours en RVB — voir docs/ARCHITECTURE-LIVRES.md §4.3, le CMJN est un chantier
#   ouvert, non traité ici. N'ajoute ni Ghostscript ni profil ICC.
# --------------------------------------------------------------------------------------
$(LIVRE_IMPRIMEUR_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART) $(STYLE_LIVRE_IMPR) $(PARTAGE) $(ACCENT_CSS)
	@mkdir -p "$(OUT)"
	@$(ASSEMBLER) \
	  --sortie "$@" \
	  --out "$(OUT)" \
	  $(CSS_LIVRE_IMPRIMEUR) \
	  $(FRAGMENTS)

# Même cascade de repli que le PDF numérique : le balisage PDF/UA ne coûte rien de plus à
# tenter ici, et un PDF imprimeur non balisé n'a aucune raison de l'être moins que l'autre.
$(LIVRE_IMPRIMEUR_PDF): $(LIVRE_IMPRIMEUR_HTML)
	@$(call weasy_ua,livre,,$(dir $@)~$(notdir $@).weasyprint.err)

# --------------------------------------------------------------------------------------
# La couverture, deux sorties d'un même gabarit (couverture.py, docs/ARCHITECTURE-LIVRES.md) :
#   <livre>-couverture-impression.pdf  à plat 4e + dos + 1re, PDF/X-4, CMJN exact, fond
#                                      perdu, traits de coupe et de pli ;
#   <livre>-couverture.pdf             1re puis 4e, RGB, PDF/UA-1 ; -1.png et -4.png en sont
#                                      tirés à 300 dpi ;
#   <livre>-dos.json                   le dos et d'où il vient.
#
# Le dos ne se devine pas : couverture.py le calcule sur le nombre de pages lu dans
# $(LIVRE_PDF) (sauf impression.dos-mm, qui gagne toujours). $(LIVRE_PDF) est donc un
# prérequis de la couverture : un dos calculé sur un compte de pages périmé est le défaut
# le plus cher du métier. couverture.py lit buch.yaml lui-même (couleur-impression,
# profil-cmjn, fond) et tourne dans le python de l'image : Pillow (CMJN de l'illustration),
# pypdf et l'API WeasyPrint n'existent que là.
# --------------------------------------------------------------------------------------
GABARIT_COUVERTURE := $(PIPELINE_DIR)/templates/szh-couverture.html
STYLE_COUVERTURE   := $(PIPELINE_DIR)/styles/livre/couverture.css
COUVERTURE_PY      := $(PIPELINE_DIR)/couverture.py
COULEURS_REFERENCE := $(PIPELINE_DIR)/styles/couleurs-reference.json
LOGOS_COUVERTURE   := $(wildcard $(PIPELINE_DIR)/media/logos/*.svg)
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

# Le texte de 4e de couverture : compilé comme un chapitre (même chaîne que les
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

$(COUVERTURE_DOS): $(LIVRE_PDF) $(CONFIG_LIVRE) $(COUVERTURE_PY)
	@$(CMJN_PYTHON) "$(COUVERTURE_PY)" --mode dos --meta "$(CONFIG_LIVRE)" \
	  --pdf-interieur "$(LIVRE_PDF)" --sortie "$@"

COUVERTURE_PREALABLES := $(LIVRE_PDF) $(COUVERTURE_FRAG) $(CONFIG_LIVRE) $(GABARIT_COUVERTURE) \
                         $(COUVERTURE_PY) $(SOCLE) $(STYLE_COUVERTURE) $(COULEURS_REFERENCE) \
                         $(LOGOS_COUVERTURE) $(ILLUSTRATION_COUV)
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

# PDF/X-4 sans repli : un échec ici fait échouer la cible, jamais un PDF nu qu'on
# prendrait pour un PDF d'impression. couverture.py refuse aussi de livrer s'il reste
# une couleur RGB.
$(COUVERTURE_IMPR_PDF): $(COUVERTURE_IMPR_HTML) $(COUVERTURE_PY)
	@$(CMJN_PYTHON) "$(COUVERTURE_PY)" --imprimer "$<" "$@" --meta "$(CONFIG_LIVRE)"

# La version écran, balisée PDF/UA-1 : elle porte le titre, les responsables et le texte
# de 4e, ce qu'un lecteur d'écran doit pouvoir annoncer d'un livre. Même cascade de repli
# que le PDF intérieur : un défaut de balisage ne doit pas empêcher de sortir une épreuve.
$(COUVERTURE_PDF): $(COUVERTURE_HTML)
	@$(call weasy_ua,livre,,$(dir $@)~$(notdir $@).weasyprint.err)

# PNG de la 1re et de la 4e. Mesuré : Ghostscript 10.05 rend un `rg` DeviceRGB au pixel
# près (#D31932 -> 211,25,50), sans option de couleur ; l'anticrénelage ne touche que les
# bords, jamais l'intérieur d'un aplat.
COUVERTURE_GS = $(GS) -q -dSAFER -dNOPAUSE -dBATCH -sDEVICE=png16m -r300 \
  -dTextAlphaBits=4 -dGraphicsAlphaBits=4
$(COUVERTURE_PNG_1): $(COUVERTURE_PDF)
	@$(COUVERTURE_GS) -dFirstPage=1 -dLastPage=1 -o "$@" "$<"
$(COUVERTURE_PNG_4): $(COUVERTURE_PDF)
	@$(COUVERTURE_GS) -dFirstPage=2 -dLastPage=2 -o "$@" "$<"

# --------------------------------------------------------------------------------------
# La passe CMJN, facultative et commandée : la clé `impression.profil-cmjn` de buch.yaml
# nomme le profil de sortie. Vide, le PDF imprimeur reste en RVB, comme il l'a toujours
# été — un livre déjà en production ne doit pas changer de couleurs parce qu'on a mis le
# toolkit à jour.
#
# cmjn.py substitue d'abord les couleurs que le graphiste a chiffrées, puis Ghostscript
# convertit le reste par le profil ICC : le noir du texte doit rester en K seul, ce
# qu'aucune option de Ghostscript ne fait ; la passe reste en RVB tant que la séparation
# n'est pas juste.
PROFIL_CMJN := $(strip $(shell $(PANDOC) lua $(LIRE_CONFIG) $(CONFIG_LIVRE) impression.profil-cmjn 2>/dev/null))
# Le profil vit dans l'image (voir image/Containerfile) ; surchargeable pour une machine
# qui l'a ailleurs, ou pour éprouver avec le profil d'Adobe.
ICC_DIR ?= /opt/icc
CMJN_PY := $(PIPELINE_DIR)/cmjn.py
# cmjn.py importe pypdf, qui n'est installé que dans le venv WeasyPrint de l'image (image/requirements.txt), pas dans le python3 du système.
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
# Le HTML web : troisième assemblage, avec web.css SEUL (--css-embed, pas --css) — voir
# CSS_LIVRE_WEB ci-dessus et web.css pour le pourquoi. Un seul fichier, autonome : polices
# et couleurs incorporées, images déjà en data: URI depuis la compilation des fragments.
# --------------------------------------------------------------------------------------
$(LIVRE_WEB_HTML): $(FRAGMENTS) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(SOCLE) $(STYLE_LIVRE_WEB) $(ACCENT_CSS)
	@mkdir -p "$(dir $@)"
	@$(ASSEMBLER) \
	  --sortie "$@" \
	  --out "$(OUT)" \
	  $(CSS_LIVRE_WEB) \
	  $(FRAGMENTS)

livre-html-web: $(LIENS_COURTS_PREALABLE) verifie-livre $(LIVRE_WEB_HTML)
	@echo "[livre] $(LIVRE_WEB_HTML)"
# Garde-fou spécifique, à part de verifie-livre : livre-pdf et livre-html n'ont pas besoin
# d'un texte de 4e de couverture, seule cette cible en dépend. Il doit s'exécuter avant la
# tentative de compilation — d'où sa place, premier prérequis après verifie-livre — sans
# quoi make échouerait d'abord sur « pas de règle pour fabriquer quatrieme.md », un message
# qui ne dit pas quoi faire.
verifie-couverture:
	@test -f "$(COUV_DIR)/quatrieme.md" || { \
	  echo "[livre] Pas de texte de 4e de couverture ($(COUV_DIR)/quatrieme.md introuvable)."; \
	  echo "[livre] [de] Kein Klappentext ($(COUV_DIR)/quatrieme.md fehlt)."; \
	  exit 1; }

livre-couverture: verifie-livre verifie-couverture $(COUVERTURE_DOS) $(COUVERTURE_IMPR_PDF) \
                  $(COUVERTURE_PDF) $(COUVERTURE_PNG_1) $(COUVERTURE_PNG_4)
	@echo "[livre] $(COUVERTURE_IMPR_PDF), $(COUVERTURE_PDF), $(COUVERTURE_PNG_1), $(COUVERTURE_PNG_4), $(COUVERTURE_DOS)"

# --------------------------------------------------------------------------------------
# EPUB 3. Pas un nouvel assembleur : pandoc sait fabriquer l'archive — catalogue OPF,
# navigation — et il ressort même les images des data: URI vers EPUB/media/. Ce qu'il faut
# lui donner, c'est un HTML qu'il puisse découper.
#
# ⚠ Pandoc ne coupe qu'aux titres de premier niveau non imbriqués. Nos chapitres sont
#   enveloppés dans une <section class="szh-chapitre"> — indispensable au PDF, où elle porte
#   l'ouverture sur belle page, la couleur et l'onglet de tranche. Sans la retirer, les douze
#   chapitres atterrissaient dans un seul fichier et la navigation n'en listait aucun ;
#   livre-epub-prepare.py la retire, pour l'EPUB seulement.
#
# ⚠ szh-notes.lua ne s'applique pas à epub3 : le writer de pandoc fait de vraies notes de
#   fin, liées et navigables, mieux que nos notes flottantes en CSS, qui n'ont aucun sens sur
#   une liseuse. szh-legende-avant.lua, lui, s'y applique désormais — sa garde `FORMAT:match`
#   ne connaissait que html, et la légende serait restée sous l'image.
#
# ⚠ Les métadonnées ne se tirent pas au sed : l'assembleur lit déjà buch.yaml correctement,
#   il écrit donc le fichier que pandoc attend plutôt que de le reconstruire à la main.
# --------------------------------------------------------------------------------------
$(LIVRE_EPUB_HTML): $(FRAGMENTS_EPUB) $(LIMINAIRES) $(CONFIG_LIVRE) $(ASSEMBLEUR) $(GABARIT_LIVRE) \
               $(EPUB_PREPARE) $(SOCLE) $(STYLE_LIVRE_BASE) $(STYLE_LIVRE_CHART)
	@mkdir -p "$(OUT)"
	@$(ASSEMBLER) \
	  --sortie "$@.avec-sections" \
	  --out "$(OUT)" \
	  --metadonnees-epub "$(LIVRE_EPUB_META)" \
	  $(FRAGMENTS_EPUB)
	@python3 "$(EPUB_PREPARE)" "$@.avec-sections" "$@"
	@rm -f "$@.avec-sections"

# ⚠ $(LIVRE_EPUB_META) n'est PAS un prérequis : il est écrit par la MÊME recette que le HTML
#   ci-dessus, donc make n'a aucune règle pour le fabriquer seul. Le déclarer ici faisait
#   échouer la cible sur « No rule to make target » — et seulement sur un `out/` propre,
#   c'est-à-dire chez quelqu'un d'autre.
# Les jetons du socle et l'accent annuel précèdent epub.css, dans l'ordre du PDF : epub.css
# consomme var(--c-ink) et consorts, qu'une liseuse ne devine pas. Le socle y entre sans ses
# @font-face, dont les ../fonts/ ne sont pas dans l'archive : la liseuse garde ses polices.
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
