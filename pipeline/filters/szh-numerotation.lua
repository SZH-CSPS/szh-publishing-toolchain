-- Numérote les figures et les tableaux, pose leur texte alternatif et leurs crédits, en
-- mémoire à la compilation : ni le .md ni tables/*.html ne sont réécrits, l'éditeur du
-- cockpit relisant ces fichiers (un numéro écrit dedans se dupliquerait à chaque build).
-- Deux compteurs indépendants ; sans légende, aucun numéro consommé — « Tableau 3 »
-- désigne le 3ᵉ tableau légendé.
--
-- Accessibilité : la légende n'est jamais masquée, l'alt la complète. Sur une figure,
-- <img alt> porte la description et la <figcaption> « Figure N — Légende » plus les
-- crédits, sans ARIA ajouté — la légende différant structurellement de l'alt, pandoc ne
-- repose pas aria-hidden dessus, et c'est un invariant de ce filtre.
-- Crédits : entre parenthèses à la suite du titre, « Figure 3 — Titre (© X | Y) » ; le
-- copyright porte toujours un ©, la source n'a pas d'étiquette.
-- Note : un paragraphe sous la figure ou le tableau, « Note : texte » (seule l'étiquette en
-- italique). HTML : <p class="szh-bloc-note" id="szh-bloc-note-N"> dans la <figure> après
-- l'image, ou juste après </table> — aucun élément HTML n'existe pour cela, et l'id est
-- ajouté à l'aria-describedby de l'<img> ou du <table> pour que le lecteur d'écran la lise
-- avec lui. ⚠ Pas la classe .szh-note : c'est celle des notes de bas de page. alt="" explicite ->
-- image décorative (alt="" + role="presentation"). Sur un tableau, le <caption> porte
-- numéro, légende et crédits ; une description longue (data-alt) devient un
-- aria-describedby vers un élément masqué visuellement, et sans data-alt il n'y a rien,
-- la structure th/scope/colspan se lisant d'elle-même.
--
-- Contrat de format, partagé avec l'éditeur du cockpit. Figure, dans le .md :
--   ![Légende visible](media/x.png){alt="description" copyright="© J. D." source="ESA"
--                                   note="texte de la note"}
--   alt absent -> l'alt reprend la légende ; alt="" -> décorative ; copyright=, source= et
--   note= facultatifs (pandoc 3.5 émet les deux premiers en data-copyright / data-source).
-- Image hors numérotation, dans le .md :
--   ![](media/x.png){.szh-hors-figure alt="description" copyright="© J. D."}
--   légende vide et classe .szh-hors-figure : ni numéro, ni légende visible. Voir la
--   passe dédiée plus bas ; le contrat d'écriture vit dans lib/references.js.
-- Tableau, dans articles/<slug>/tables/table-NN.html, en attributs sur <table> :
--   class="szh-tableau" data-entete-lignes data-alt data-copyright data-source data-note, plus
--   <caption>Légende</caption> ; attributs omis quand vides.
--
-- ⚠ Deux lecteurs, un seul résultat : le lecteur `markdown` (PDF et HTML) consomme
-- l'attribut alt= et le déplace dans la description de l'Image, tandis que `commonmark_x`
-- (aperçu) le laisse dans les attributs. L'alt est donc lu aux deux endroits.
--
-- Doit tourner après szh-tabelle-inclure.lua (les tableaux n'existent qu'une fois
-- réinjectés) et après szh-figure.lua (sous commonmark_x, les Figure ne sont construites
-- que là) — voir l'ordre des --lua-filter dans le Makefile.

local utils = pandoc.utils

-- Module commun (a_classe, trim, langue_de) : un chargement raté arrête la compilation, ce
-- filtre ne pouvant plus distinguer une classe, nettoyer un texte ni dire de langue fiable
-- sans lui.
local commun
do
  -- debug.getinfo, pas PANDOC_SCRIPT_FILE : ce dernier nomme le script reçu par pandoc en
  -- ligne de commande, pas celui-ci quand un autre le charge par dofile — voir
  -- szh-commun.lua.
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[numerotation] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

-- ─── Aperçu du cockpit seulement ─────────────────────────────────────────────
-- SZH_APERCU=1 distingue les deux chaînes, comme dans szh-citations.lua : l'aperçu et le
-- PDF sortent de deux appels à pandoc, et seul l'aperçu porte cette variable.
-- szh-apercu-lecteur-ecran.lua y pose sous chaque image et chaque tableau un encadré
-- montrant ce qu'un lecteur d'écran reçoit. Le fichier n'est même pas ouvert hors aperçu :
-- rien de ce qu'il contient — balisage, classe, règle CSS — ne peut atteindre le PDF.
-- Chargé par dofile plutôt que par require : le Makefile ne pose aucun chemin de recherche
-- Lua aux filtres, et PANDOC_SCRIPT_FILE donne le dossier de celui-ci. Fichier absent ou
-- fautif -> l'aperçu sort sans encadré, jamais en échec : une aide à la relecture ne doit
-- pas empêcher de compiler.
local APERCU = (os.getenv('SZH_APERCU') or '') ~= ''
local lecteur_ecran = nil
if APERCU then
  local dossier = (PANDOC_SCRIPT_FILE or ''):match('^(.*[/\\])') or ''
  local ok, module = pcall(dofile, dossier .. 'szh-apercu-lecteur-ecran.lua')
  if ok and type(module) == 'table' then
    lecteur_ecran = module
  else
    io.stderr:write('[numerotation] encadrés « lecteur d’écran » indisponibles : '
                    .. tostring(module) .. '\n')
  end
end

-- ─── Livre : numérotation continue sur tout le volume ───────────────────────
-- Un livre compile chaque chapitre par une invocation pandoc séparée (voir
-- pipeline/profils/livre.mk) : les compteurs n_figure/n_tableau ci-dessous, locaux à
-- cette invocation, repartiraient sinon à zéro à chaque chapitre. Les livres publiés
-- numérotent en continu (« Abbildung 12 » au chapitre 4, pas « Abbildung 1 »).
--
-- Mécanisme : SZH_COMPTEURS donne le chemin où ce chapitre écrit, en fin de passe, ce
-- qu'il a consommé — deux nombres, figures puis tableaux, un par ligne — et ce chemin
-- suit la convention « <dossier-partagé>/<rang>.txt » (une entrée par chapitre, même
-- dossier). Pour trouver son point de départ, ce chapitre additionne ce que les
-- chapitres 1..SZH_CHAPITRE-1 ont chacun écrit dans leur fichier — pas seulement le
-- précédent, pour rester correct même si l'un d'eux n'a consommé ni figure ni tableau.
-- SZH_LIVRE absent -> aucun de ces fichiers n'est ni lu ni écrit, comportement identique
-- à aujourd'hui.
--
-- ⚠ make peut recompiler un seul chapitre. Si le report d'un chapitre précédent manque
-- (dossier de sortie nettoyé entre deux builds, ordre de compilation inhabituel...),
-- impossible de savoir combien de figures ce chapitre absent a réellement consommées :
-- mieux vaut le dire et repartir de 0 (numérotation locale à ce chapitre, comme hors
-- livre) que d'inventer un numéro qui aurait l'air juste sans l'être.
local LIVRE = (os.getenv('SZH_LIVRE') or '') ~= ''
local CHAPITRE = LIVRE and tonumber(os.getenv('SZH_CHAPITRE') or '') or nil
local CHEMIN_COMPTEURS = LIVRE and os.getenv('SZH_COMPTEURS') or nil

-- Dossier contenant CHEMIN_COMPTEURS, sans le séparateur final ; '.' si le chemin ne
-- porte aucun dossier (n'arrive pas en usage réel, seulement en test isolé).
local function dossier_compteurs()
  return (CHEMIN_COMPTEURS:match('^(.*)[/\\][^/\\]*$')) or '.'
end

-- Chemin du report d'un chapitre de rang `rang`, à côté de celui de ce chapitre-ci.
local function chemin_report(rang)
  return dossier_compteurs() .. '/' .. rang .. '.txt'
end

-- Point de départ des deux compteurs pour ce chapitre : ce que les chapitres 1..CHAPITRE-1
-- ont consommé, chacun dans son propre report. (0, 0) si le mode livre ne fournit pas de
-- quoi le calculer, ou dès qu'un report manque — voir l'avertissement en tête de section.
local function depart_compteurs()
  if not CHAPITRE or not CHEMIN_COMPTEURS then return 0, 0 end
  local figures, tableaux = 0, 0
  for rang = 1, CHAPITRE - 1 do
    local chemin = chemin_report(rang)
    local fh = io.open(chemin, 'r')
    -- Deux lectures séparées : une affectation multiple n'ordonnerait pas forcément ses
    -- expressions de droite de gauche à droite, or c'est le premier nombre lu qui doit
    -- être les figures.
    local f, t = nil, nil
    if fh then
      f = fh:read('*n')
      t = fh:read('*n')
      fh:close()
    end
    if not f or not t then
      io.stderr:write(string.format(
        '[numerotation] report introuvable ou illisible pour le chapitre %d (%s) : '
        .. 'figures et tableaux renumérotés localement à partir de ce chapitre plutôt '
        .. 'que de risquer un faux numéro.\n', rang, chemin))
      return 0, 0
    end
    figures, tableaux = figures + f, tableaux + t
  end
  return figures, tableaux
end

-- Écrit ce que ce chapitre a consommé (n_figure, n_tableau déjà diminués du point de
-- départ), pour que les chapitres suivants le retrouvent. N'écrit rien hors mode livre.
local function ecrire_compteurs(n_figure, n_tableau)
  if not CHEMIN_COMPTEURS then return end
  local dossier = dossier_compteurs()
  if dossier ~= '.' then pcall(pandoc.system.make_directory, dossier, true) end
  local fh = io.open(CHEMIN_COMPTEURS, 'w')
  if not fh then
    io.stderr:write('[numerotation] impossible d’écrire ' .. CHEMIN_COMPTEURS .. '\n')
    return
  end
  fh:write(tostring(n_figure), '\n', tostring(n_tableau), '\n')
  fh:close()
end

-- Libellés localisés : les trois langues de la revue, plus l'anglais.
local LIBELLE_FIGURE  = { fr = 'Figure',  de = 'Abbildung', it = 'Figura',  en = 'Figure' }
local LIBELLE_TABLEAU = { fr = 'Tableau', de = 'Tabelle',   it = 'Tabella', en = 'Table' }
-- Étiquette de la note sous une figure ou un tableau ; l'anglais reste celui de
-- LIBELLE_FIGURE. Le deux-points n'appartient pas à l'étiquette (elle seule est en italique).
local LIBELLE_NOTE    = { fr = 'Note', de = 'Notiz', it = 'Nota', en = 'Note' }
-- Ponctuation après l'étiquette : le français exige une espace fine insécable (U+202F)
-- avant le deux-points, pas les trois autres langues.
local PONCT_NOTE      = { fr = '\u{202F}:', de = ':', it = ':', en = ':' }

-- Séparateur visible : cadratin entouré d'espaces. L'espace de tête est un
-- pandoc.Space (donc sécable), celui de queue est collé au cadratin dans le Span.
local CADRATIN = '\u{2014}'
-- Séparateur entre copyright et source dans un crédit.
local SEP_CREDIT = ' | '
-- Sous un même titre, plusieurs copyrights (ou plusieurs sources) se suivent par une virgule.
local SEP_MEME_CHAMP = ', '
-- Classe et préfixe d'id du paragraphe de note ; szh-legende-avant.lua reconnaît la classe.
local CLASSE_NOTE = 'szh-bloc-note'
local n_note = 0               -- id unique de chaque note posée dans le document

-- Classe posée par le cockpit sur une image à ne pas numéroter, et classe posée par ce
-- filtre sur la <figure> qu'il en fait : elle dit à szh-legende-avant.lua que la
-- <figcaption> ne porte qu'un crédit et se lit donc après l'image.
local CLASSE_HORS_FIGURE = 'szh-hors-figure'
local CLASSE_CREDIT_SEUL = 'szh-credit-seul'

-- ─── Image décorative : un fond CSS, jamais un <img> ─────────────────────────
-- WeasyPrint 69 balise tout <img> en /Figure et n'y pose un /Alt que si l'attribut alt
-- est non vide. Une image décorative (alt="") sortait donc en /Figure sans /Alt, ce que
-- PDF/UA-1 interdit (règle 7.3) : mesuré à la loupe, role="presentation" et
-- aria-hidden="true" n'y changent rien. Le seul moyen de dire « ce dessin ne porte
-- aucune information » est de ne pas en faire un <img> : un fond CSS n'entre pas dans
-- l'arbre de structure, donc le décor y est absent — c'est exactement ce qu'on veut dire.
-- ⚠ Ne pas revenir à un <img> pour une image décorative : le PDF cesserait d'être
--   conforme, et make verifier-ua le refuserait à l'export.
--
-- Géométrie, pour que le rendu ne bouge pas d'un pixel : deux <span> imbriqués.
-- L'externe porte la largeur naturelle de l'image, bornée à la colonne par le
-- max-width de print.css ; l'interne porte un padding-top en pourcentage, qui se résout
-- sur la largeur de l'externe et rend donc la même hauteur qu'un <img> à height:auto.
-- WeasyPrint 69 ignore `aspect-ratio` (« unknown property »), d'où le padding.
--
-- Le url() est écrit dans un <style> ajouté en fin de document, et non dans un
-- attribut style= : `pandoc --embed-resources` remplace les chemins par des data: URI
-- dans les <style> et dans src/href, jamais dans un style= (mesuré). Sans ce détour,
-- le HTML autonome perdrait l'image.
local CLASSE_DECOR = 'szh-decor'
local decors = {}          -- une entrée par image décorative rencontrée

-- Largeur et hauteur naturelles d'une image, en pixels CSS ; nil si elle est illisible.
-- WeasyPrint ignore la résolution déclarée dans le fichier (images.py :
-- get_intrinsic_size divise par `image-resolution`, à 1 par défaut) : les pixels de
-- pandoc.image.size sont donc bien des pixels CSS.
local function mesure_image(src)
  local ok, _, contenu = pcall(pandoc.mediabag.fetch, src)
  if not ok or type(contenu) ~= 'string' then return nil end
  local ok2, taille = pcall(pandoc.image.size, contenu)
  if not ok2 or type(taille) ~= 'table' then return nil end
  local l, h = tonumber(taille.width), tonumber(taille.height)
  if not l or not h or l <= 0 or h <= 0 then return nil end
  return l, h
end

-- Remplace une image décorative par les deux <span> qui la rendent en fond CSS.
-- Renvoie nil si l'image est illisible : l'appelant garde alors son <img>, un rendu ne
-- doit pas échouer pour un décor. Le PDF sortira non conforme et le dira.
--
-- `garder_largeur` : le décor reprend la largeur déclarée de l'image (width=, p. ex.
-- « 2.85in » posé par l'import Word) au lieu de sa largeur naturelle. Réservé aux images au
-- fil d'un paragraphe (decors_declares, plus bas) : deux photos côte à côte doivent le
-- rester. Les décors d'avant gardent leur largeur naturelle — un numéro déjà compilé ne
-- doit pas changer de mise en page.
local function en_decor(img, garder_largeur)
  local largeur, hauteur = mesure_image(img.src)
  if not largeur then return nil end
  local classe = CLASSE_DECOR .. '-' .. (#decors + 1)
  local declaree = garder_largeur and img.attributes['width'] or nil
  -- Seule une longueur CSS simple passe (chiffres, unité ou %) : la valeur finit dans un
  -- <style>, rien d'autre n'y entre.
  if declaree and not declaree:match('^%d+%.?%d*%a*%%?$') then declaree = nil end
  decors[#decors + 1] = { classe = classe, src = img.src, largeur_css = declaree,
                          largeur = largeur, ratio = 100.0 * hauteur / largeur }
  return pandoc.RawInline('html', '<span class="' .. CLASSE_DECOR .. ' ' .. classe
    .. '" role="presentation"><span></span></span>')
end

-- Le <style> des images décoratives, à poser en fin de document. Même spécificité que
-- print.css mais plus loin dans la cascade : ces règles-ci l'emportent.
--
-- Un décor n'est pas un <img> (voir en_decor ci-dessus) : c'est un fond CSS posé par
-- `padding-top` en pourcentage, que `max-height` ne borne pas. Dans une grille, le
-- plafond de hauteur d'une figure (--plafond-figure, socle.css) doit pourtant valoir
-- pour lui aussi, sans quoi un décor en portrait ferait dépasser la page comme une image
-- ordinaire non bornée. Seule une max-width le peut, calculée depuis le plafond de
-- hauteur avec le rapport hauteur/largeur — le diviseur `ratio / 100`, `ratio` étant déjà
-- 100 * hauteur / largeur. `min(100%, …)` est indispensable : sans lui, cette règle
-- (spécificité 0,1,0) remplacerait le `max-width: 100%` de `.szh-decor` (print.css) et un
-- décor large déborderait de la colonne. Une seule formule couvre grille et hors grille :
-- --szh-rangees retombe sur 1 hors grille (posé par szh-grille.lua).
-- Échappement du chemin inséré dans url("…") : le guillemet cassait déjà la chaîne CSS,
-- mais une parenthèse, une apostrophe ou un retour à la ligne dans le nom du fichier
-- (« Bild (1).png », un nom saisi avec une apostrophe) casse tout autant l'analyse du
-- url("…") — la sienne, faite par pandoc --embed-resources pour retrouver le fichier à
-- incorporer, comme celle de tout outil qui relirait ce <style>. Un retour à la ligne, en
-- plus de casser la valeur, romprait la règle CSS elle-même.
local function echapper_url(s)
  s = s:gsub('"', '%%22')
  s = s:gsub("'", '%%27')
  s = s:gsub('%(', '%%28')
  s = s:gsub('%)', '%%29')
  s = s:gsub('\r\n', '%%0A'):gsub('[\r\n]', '%%0A')
  return s
end

local function style_decors()
  if #decors == 0 then return nil end
  local regles = {}
  for _, d in ipairs(decors) do
    regles[#regles + 1] = string.format(
      '.%s{width:%s;max-width:min(100%%,calc((var(--plafond-figure) - 12px)'
        .. ' / var(--szh-rangees, 1) / %.4f))}\n'
        .. '.%s>span{padding-top:%.4f%%;background-image:url("%s")}',
      d.classe, d.largeur_css or string.format('%dpx', d.largeur), d.ratio / 100.0,
      d.classe, d.ratio, echapper_url(d.src))
  end
  return pandoc.RawBlock('html', '<style>\n' .. table.concat(regles, '\n') .. '\n</style>')
end

local a_classe = commun.a_classe
local trim = commun.trim
local slug_article = commun.slug_article
local function vide(t) return t == nil or t:match('^%s*$') ~= nil end

-- Langue de composition : le `lang:` de l'article prime, puis le jeton de revue, puis le
-- `lang:` du numéro, « fr » en dernier repli — même ordre que szh-maquette.lua, sans
-- son blocage sur une langue inconnue : ce filtre tourne aussi dans la chaîne d'aperçu, où
-- szh-maquette n'est pas branché, et une fiche mal remplie ne doit pas y empêcher l'aperçu
-- — une langue absente ou hors liste retombe silencieusement sur le jeton de revue.
--
-- Le module commun (szh-commun.lua) fait la lecture de la fiche, partagée avec
-- szh-maquette.lua ; ce qui reste ici et lui est propre, c'est cette suite de replis
-- (jeton de revue puis `lang:` du numéro, en `repli`) et l'ensemble des langues acceptées
-- (`langues_valides`), qui inclut l'anglais des libellés de figure — szh-maquette, lui,
-- n'accepte que fr/de/it.
local function langue_de(meta)
  return commun.langue_de(meta, {
    lire_fiche = true,
    variante_fiche = 'deux_lettres',
    langues_valides = LIBELLE_FIGURE,
    repli = function(m)
      local revue = utils.stringify(m.revue or ''):lower()
      if revue:find('zeitschrift') then return 'de' end
      if revue:find('revue') then return 'fr' end
      local court = utils.stringify(m.lang or ''):lower():match('^(%a%a)')
      if court and LIBELLE_FIGURE[court] then return court end
      return nil
    end,
    defaut = 'fr',
  })
end

-- Copyright avec son ©. Une valeur qui commence déjà par ©, « Copyright » ou l'entité
-- &copy; est gardée ; un « (c) » ou « (C) » de tête est remplacé par ©.
local function copyright_avec_signe(c)
  c = trim(c)
  local bas = c:lower()
  if c:sub(1, 2) == '\u{A9}' or bas:sub(1, 9) == 'copyright' or bas:sub(1, 6) == '&copy;' then
    return c
  end
  local reste = c:match('^%([cC]%)%s*(.*)$')
  if reste then return '\u{A9} ' .. reste end
  return '\u{A9} ' .. c
end

-- Crédit « (© J. Dupont | ESA) », parenthèses comprises. Entrées : la liste des copyrights
-- et celle des sources, déjà dédoublonnées ; l'une ou l'autre peut être vide, les deux vides
-- -> nil, donc pas de parenthèse orpheline. `seul` : le crédit n'accompagne aucun titre (il
-- se lit sous l'image), il sort sans parenthèses (décision de Robin, 30.09.2026).
local function credit_depuis(copyrights, sources, seul)
  local bouts = {}
  if #copyrights > 0 then bouts[#bouts + 1] = table.concat(copyrights, SEP_MEME_CHAMP) end
  if #sources > 0 then bouts[#bouts + 1] = table.concat(sources, SEP_MEME_CHAMP) end
  if #bouts == 0 then return nil end
  if seul then return table.concat(bouts, SEP_CREDIT) end
  return '(' .. table.concat(bouts, SEP_CREDIT) .. ')'
end

-- Crédit d'une seule image ou d'un seul tableau. Valeurs reprises telles quelles : texte
-- brut côté figure (pandoc les échappera), déjà échappées côté tableau puisqu'elles
-- sortent d'un attribut HTML.
local function texte_credit(copyright, source, seul)
  return credit_depuis(
    vide(copyright) and {} or { copyright_avec_signe(copyright) },
    vide(source) and {} or { trim(source) }, seul)
end

-- Cumul des crédits de plusieurs images (grille) : un copyright ou une source identique ne
-- se répète pas, chaque champ garde l'ordre de première apparition.
local function nouveau_cumul() return { copyrights = {}, sources = {}, vus = {} } end
local function cumuler(cumul, img)
  local function ajouter(liste, valeur, cle)
    if not cumul.vus[cle .. valeur] then
      cumul.vus[cle .. valeur] = true
      liste[#liste + 1] = valeur
    end
  end
  local c, s = img.attributes['copyright'], img.attributes['source']
  if not vide(c) then ajouter(cumul.copyrights, copyright_avec_signe(c), 'c') end
  if not vide(s) then ajouter(cumul.sources, trim(s), 's') end
end

-- ─── Note sous une figure ou un tableau ──────────────────────────────────────
-- Ajoute `id` aux ids déjà présents dans aria-describedby, sans les écraser.
local function ajouter_describedby(img, id)
  local deja = img.attributes['aria-describedby']
  img.attributes['aria-describedby'] = vide(deja) and id or (trim(deja) .. ' ' .. id)
end

-- Découpe un texte brut en Str et Space : les filtres qui suivent (césure) travaillent mot
-- par mot, ce que ne ferait pas une seule Str.
local function mots(texte)
  local inl = pandoc.Inlines({})
  for mot in texte:gmatch('%S+') do
    if #inl > 0 then inl:insert(pandoc.Space()) end
    inl:insert(pandoc.Str(mot))
  end
  return inl
end

-- Le paragraphe de note d'une figure, en blocs pandoc : <p> et </p> sont du HTML brut
-- autour d'un Plain, seule façon d'obtenir une classe et un id sur un <p> (le lecteur
-- comme le writer ne les gardent que sur div et span).
local function bloc_note(texte, id, lang)
  local inl = pandoc.Inlines({
    pandoc.RawInline('html', '<p class="' .. CLASSE_NOTE .. '" id="' .. id .. '">'),
    pandoc.Span({ pandoc.Str(LIBELLE_NOTE[lang] or LIBELLE_NOTE.fr) },
                pandoc.Attr('', { CLASSE_NOTE .. '-etiquette' }, {})),
    pandoc.Str(PONCT_NOTE[lang] or PONCT_NOTE.fr),
    pandoc.Space(),
  })
  inl:extend(mots(texte))
  inl:insert(pandoc.RawInline('html', '</p>'))
  return pandoc.Plain(inl)
end

-- Le même paragraphe en HTML brut, pour un tableau réinjecté : `texte` sort d'un attribut
-- HTML, il est donc déjà échappé.
local function html_note(texte, id, lang)
  return '<p class="' .. CLASSE_NOTE .. '" id="' .. id .. '"><span class="' .. CLASSE_NOTE
    .. '-etiquette">' .. (LIBELLE_NOTE[lang] or LIBELLE_NOTE.fr) .. '</span>'
    .. (PONCT_NOTE[lang] or PONCT_NOTE.fr) .. ' ' .. trim(texte) .. '</p>'
end

-- Prend la note d'une image : l'attribut note= est retiré (il ne doit pas ressortir en
-- data-note sur l'<img>), un id lui est attribué et l'image le reçoit en aria-describedby
-- — sauf si elle est décorative, une image sans nom n'ayant rien à se faire décrire.
-- Renvoie (texte, id), ou nil sans note.
local function prendre_note(img)
  local t = img.attributes['note']
  img.attributes['note'] = nil
  if vide(t) then return nil end
  n_note = n_note + 1
  local id = CLASSE_NOTE .. '-' .. n_note
  if img.attributes['role'] ~= 'presentation' then ajouter_describedby(img, id) end
  return trim(t), id
end

-- Insère le préfixe en tête du premier bloc de la légende (Plain ou Para) ; les blocs
-- suivants d'une légende multi-paragraphes restent intacts. Le préfixe est un Span
-- porteur d'une classe, que print.css graisse ; le texte reste dans le flux.
local function prefixer(blocs, prefixe)
  for i, b in ipairs(blocs) do
    if b.t == 'Plain' or b.t == 'Para' then
      local tete = pandoc.Inlines({
        pandoc.Span({ pandoc.Str(prefixe) }, pandoc.Attr('', { 'szh-numero' }, {})),
        pandoc.Space(),
      })
      blocs[i] = (b.t == 'Plain') and pandoc.Plain(tete .. b.content)
                                  or pandoc.Para(tete .. b.content)
      return blocs
    end
  end
  return blocs
end

-- Ajoute les crédits à la fin du dernier bloc de la légende, dans le même élément.
-- Mise en forme dans print.css (.szh-credit).
local function crediter(blocs, texte)
  local span = pandoc.Span({ pandoc.Str(texte) }, pandoc.Attr('', { 'szh-credit' }, {}))
  for i = #blocs, 1, -1 do
    local b = blocs[i]
    if b.t == 'Plain' or b.t == 'Para' then
      local queue = pandoc.Inlines({ pandoc.Space(), span })
      blocs[i] = (b.t == 'Plain') and pandoc.Plain(b.content .. queue)
                                  or pandoc.Para(b.content .. queue)
      return blocs
    end
  end
  blocs:insert(pandoc.Plain({ span }))
  return blocs
end

-- ─── Tableaux réinjectés en HTML brut ────────────────────────────────────────
-- Ils arrivent en RawBlock('html'), opaques à l'AST : on agit sur le texte, en
-- mémoire ; tables/table-NN.html n'est jamais réécrit.
-- Patterns insensibles à la casse écrits à la main (Lua n'a pas d'option /i).
local OUVRANTE = '<[cC][aA][pP][tT][iI][oO][nN][^>]*>'
local FERMANTE = '</[cC][aA][pP][tT][iI][oO][nN]%s*>'
local TABLE    = '<[tT][aA][bB][lL][eE]([^>]*)>'

-- Valeur brute (encore échappée HTML) d'un attribut du <table …>, ou nil.
local function attribut(attrs, nom)
  local n = nom:gsub('%-', '%%-')
  return attrs:match('%s' .. n .. '%s*=%s*"([^"]*)"')
      or attrs:match("%s" .. n .. "%s*=%s*'([^']*)'")
end

-- Traite un bloc HTML de tableau. Renvoie (html, numerote), numerote valant true si un
-- numéro a été consommé ; nil si le bloc n'est pas un <table>. L'ordre des insertions
-- compte, chacune décalant ce qui suit : la <caption> d'abord (tout est après le '>' du
-- <table …>, les indices du tag restent valides), puis le tag lui-même (aria-describedby,
-- data-note retiré), puis la note après </table>. `ids` : les ids que le tableau doit
-- référencer en aria-describedby, séparés par une espace (nil sans rien à référencer).
-- `note_html` : le paragraphe de note, posé juste après </table> ; l'élément de description
-- longue, ajouté par l'appelant, vient donc après la note.
local function traiter_tableau(html, prefixe, credit, ids, note_html)
  local _, fin_tag, attrs = html:find(TABLE)
  if not fin_tag then return nil end
  if attrs ~= '' and not attrs:match('^[%s/]') then return nil end   -- pas un <table>

  local numerote = false
  local d_ouv, f_ouv = html:find(OUVRANTE)
  local d_ferm = f_ouv and html:find(FERMANTE, f_ouv + 1)
  local a_legende = d_ferm ~= nil
                    and not html:sub(f_ouv + 1, d_ferm - 1):match('^%s*$')

  if a_legende then
    -- numéro en tête de légende, crédits en queue — un seul découpage.
    local queue = credit and (' <span class="szh-credit">' .. credit .. '</span>') or ''
    html = html:sub(1, f_ouv)
        .. '<span class="szh-numero">' .. prefixe .. '</span> '
        .. html:sub(f_ouv + 1, d_ferm - 1)
        .. queue
        .. html:sub(d_ferm)
    numerote = true
  elseif credit then
    -- Pas de légende mais des crédits : un crédit est une mention de droits, il ne
    -- doit pas se perdre. On fabrique une <caption> qui ne porte que le crédit, et
    -- qui ne consomme aucun numéro puisque le tableau n'est pas légendé.
    local remplacer = d_ouv ~= nil and d_ferm ~= nil      -- <caption> présente mais vide
    local avant = remplacer and html:sub(1, d_ouv - 1) or html:sub(1, fin_tag)
    local apres = remplacer and html:sub(d_ferm) or html:sub(fin_tag + 1)
    if remplacer then apres = apres:gsub('^' .. FERMANTE, '', 1) end
    html = avant
        .. '<caption><span class="szh-credit">' .. credit .. '</span></caption>'
        .. apres
  end

  -- Le tag : data-note en sort (le texte est rendu plus bas, pas dupliqué en attribut) et
  -- aria-describedby reçoit les ids, ajoutés à ceux déjà présents, jamais écrasés.
  local tag = html:sub(1, fin_tag)
  tag = tag:gsub('%s+data%-note%s*=%s*"[^"]*"', ''):gsub("%s+data%-note%s*=%s*'[^']*'", '')
  if ids then
    local function ajouter(avant, valeur, apres)
      valeur = trim(valeur)
      return avant .. (valeur == '' and '' or (valeur .. ' ')) .. ids .. apres
    end
    local n
    tag, n = tag:gsub('(%saria%-describedby%s*=%s*")([^"]*)(")', ajouter, 1)
    if n == 0 then
      tag, n = tag:gsub("(%saria%-describedby%s*=%s*')([^']*)(')", ajouter, 1)
    end
    if n == 0 then tag = tag:sub(1, -2) .. ' aria-describedby="' .. ids .. '">' end
  end
  html = tag .. html:sub(fin_tag + 1)

  if note_html then
    -- Après le DERNIER </table> du bloc ; sans fermeture (HTML tronqué), en fin de bloc.
    local pos, suivant = nil, 1
    while true do
      local _, f = html:find('</[tT][aA][bB][lL][eE]%s*>', suivant)
      if not f then break end
      pos, suivant = f, f + 1
    end
    pos = pos or #html
    html = html:sub(1, pos) .. '\n' .. note_html .. html:sub(pos + 1)
  end

  return html, numerote
end

-- ─── Images hors numérotation ────────────────────────────────────────────────
-- La légende est vide dans le .md, donc aucun lecteur n'en fait de Figure et rien n'est
-- numéroté : il n'y a que le texte alternatif, les crédits et la note à placer. Or un crédit
-- est une mention de droits, il ne doit pas se perdre — comme pour un tableau sans légende.
-- L'image est donc enveloppée dans une <figure> dont la <figcaption> ne porte que le
-- crédit : le lien entre l'image et ses droits reste explicite pour un lecteur d'écran,
-- sans numéro ni légende. Sans crédit ni note à porter, l'image reste un <img> dans son
-- paragraphe, une <figure> sans <figcaption> n'apportant rien. Une note sans crédit donne
-- une <figure> sans <figcaption>, la note après l'image.

-- L'image seule d'un Para/Plain, si elle porte la classe ; nil sinon.
local function image_hors_figure(b)
  if b.t ~= 'Para' and b.t ~= 'Plain' then return nil end
  local img = nil
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then
      if img then return nil end                  -- deux images : on ne tranche pas
      img = x
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then
      return nil                                  -- image au fil du texte : laissée là
    end
  end
  if not img or not a_classe(img, CLASSE_HORS_FIGURE) then return nil end
  return img
end

local function hors_numerotation(b, lang)
  local img = image_hors_figure(b)
  if not img then return nil end
  -- Sans texte alternatif, l'image est décorative : role="presentation" neutralise le
  -- role="img" que --embed-resources ajoute (même raison que dans la passe principale).
  -- Avec un alt=, le writer l'émet tel quel, la description de l'Image étant vide.
  local credit = texte_credit(img.attributes['copyright'], img.attributes['source'], true)
  local contenu = img
  local a_note = not vide(img.attributes['note'])
  if vide(img.attributes['alt']) then
    img.attributes['alt'] = ''
    img.attributes['role'] = 'presentation'
    -- Décorative ET créditée : le crédit reste (c'est une mention de droits), mais
    -- l'image passe en fond CSS, sans quoi la <figure> porterait une /Figure sans /Alt.
    -- Sans crédit, on laisse la passe principale s'en charger : `en_decor` inscrit une
    -- règle CSS, l'appeler ici pour rien en laisserait une inutile.
    if credit or a_note then contenu = en_decor(img) or img end
  end
  if not credit and not a_note then return nil end
  -- La note se prend AVANT d'insérer l'image dans le Plain : pandoc copie l'élément à
  -- l'insertion, une modification faite ensuite ne l'atteindrait plus. Décor : pas d'<img>
  -- à décrire (role="presentation"), la note se lit quand même sous l'image.
  local texte, id = prendre_note(img)
  local corps = pandoc.Blocks({ pandoc.Plain({ contenu }) })
  if texte then corps:insert(bloc_note(texte, id, lang)) end
  local legende = pandoc.Blocks({})
  if credit then
    legende:insert(pandoc.Plain({
      pandoc.Span({ pandoc.Str(credit) }, pandoc.Attr('', { 'szh-credit' }, {})) }))
  end
  return pandoc.Figure(corps, { long = legende },
                       pandoc.Attr('', { CLASSE_CREDIT_SEUL }, {}))
end

-- ─── Constat au rédacteur : figure sans texte alternatif (aperçu seulement) ─────────────
-- Une image dont l'attribut alt est ABSENT (pas alt="", qui est une décision assumée) et
-- dont la légende est vide n'atteint pas un lecteur d'écran : ni la légende (il n'y en a
-- pas) ni l'alt (il n'y en a pas non plus) ne lui donnent de nom. C'est exactement le seul
-- cas rouge de encadre_image() (szh-apercu-lecteur-ecran.lua, l. ~140-173) et celui que
-- imagesSansAlternative() (lib/references.js) refuse à l'export OJS : ce constat le montre
-- ici, à la relecture, plutôt qu'au tout dernier moment où il est encore réparable.
--
-- Une seule vérification par image, qu'elle soit dans une Figure ou hors figure : l'alt se
-- lit sur l'Image elle-même dans les deux cas, et sous commonmark_x (la lecture de
-- l'aperçu), la légende d'une image insérée dans une Figure par szh-figure.lua reste sur
-- l'Image (szh-figure.lua ne la vide jamais) — un seul test suffit donc aux deux formes.
--
-- Émis SEULEMENT sous SZH_APERCU, et seulement à cet endroit de Pandoc(doc), juste après
-- l'appel à lecteur_ecran : c'est le seul moment où alt="" (décoratif, voulu) se distingue
-- encore d'un alt absent — les passes suivantes de ce filtre posent alt="" partout où
-- l'alt manque (voir l'avertissement en tête de fichier). Lecture seule : aucune Image
-- n'est modifiée ici, donc aucun effet sur la sortie HTML.
--
-- Un constat par fichier image, jamais par occurrence — même règle que szh-metafichier.lua.
local FIGURES_SANS_ALT_SIGNALEES = {}

-- « | » sépare les champs du format à codes : un nom de fichier qui en porterait un
-- couperait la ligne. Même garde que szh-citations.lua (sans_barre()).
local function sans_barre_figure(t) return (tostring(t):gsub('|', '/')) end

local function constat_figure_sans_alt(src)
  if FIGURES_SANS_ALT_SIGNALEES[src] then return end
  FIGURES_SANS_ALT_SIGNALEES[src] = true
  local nom = src:match('([^/\\]+)$') or src
  local champ_unite = (LIVRE and 'chapitre « ' or 'article « ') .. slug_article() .. ' »'
  -- Insécable française devant le deux-points (même caractère que PONCT_NOTE plus
  -- haut) ; l'allemand suisse colle sa ponctuation haute, donc aucune espace ici.
  local morceaux = {
    '[numerotation-avertissement] figure-sans-alt',
    champ_unite,
    'image « ' .. sans_barre_figure(src) .. ' »',
    sans_barre_figure('L’image ' .. nom .. ' n’a ni texte alternatif ni légende\u{202F}: '
      .. 'un lecteur d’écran n’en dira rien.'),
    '[de] ' .. sans_barre_figure('Das Bild ' .. nom .. ' hat weder Alternativtext noch '
      .. 'Legende: ein Screenreader sagt dazu nichts.'),
  }
  io.stderr:write(table.concat(morceaux, ' | ') .. '\n')
end

-- Vrai si `img` n'a ni alt (attribut absent, donc nil — pas alt="") ni légende (caption
-- vide) : le seul cas qu'on signale. Une image alt="" explicite, une image sans alt mais
-- avec légende (l'alt reprend la légende), un décor szh-decor ou un portrait ne matchent
-- jamais ceci — les deux premiers parce que attr n'est pas nil ou que la légende n'est pas
-- vide, les deux derniers parce qu'ils n'existent pas encore comme Image à cet instant
-- (szh-auteurs.lua, qui pose les portraits, tourne après ce filtre ; szh-decor est une
-- sortie de ce filtre-ci, jamais une entrée).
local function figure_sans_alt(img)
  return img.attributes['alt'] == nil and #img.caption == 0
end

-- ─── Passe unique, dans l'ordre du document ──────────────────────────────────
-- Tout part de Pandoc(doc) : seul point où les métadonnées sont lues avant les blocs
-- (dans un filtre ordinaire, Meta est appelé après eux).
function Pandoc(doc)
  local lang = langue_de(doc.meta)
  local mot_figure  = LIBELLE_FIGURE[lang]  or LIBELLE_FIGURE.fr
  local mot_tableau = LIBELLE_TABLEAU[lang] or LIBELLE_TABLEAU.fr
  -- Hors livre, depart_compteurs() rend (0, 0) : n_figure/n_tableau partent d'où ils
  -- partaient déjà, rien ne change.
  local depart_figure, depart_tableau = depart_compteurs()
  local n_figure, n_tableau, n_desc = depart_figure, depart_tableau, 0

  -- Aperçu : les encadrés « lecteur d'écran » avant toute autre passe, sur l'AST encore
  -- intact. C'est là, et seulement là, que se lit l'intention du rédacteur : un alt=""
  -- écrit exprès (image décorative) ne se distingue plus d'un alt absent dès que les
  -- passes ci-dessous ont normalisé, elles posent alt="" dans les deux cas.
  if lecteur_ecran then doc.blocks = lecteur_ecran.blocs(doc.blocks, lang) end

  -- Constat au rédacteur, à la même place et pour la même raison que l'encadré ci-dessus :
  -- lecture seule, doc.blocks n'est pas réassigné, donc aucun effet sur la sortie. Le
  -- résultat du walk est délibérément ignoré (l'effet recherché est le io.stderr:write, pas
  -- une transformation de l'arbre).
  if APERCU then
    doc.blocks:walk({
      Image = function(img)
        if figure_sans_alt(img) then constat_figure_sans_alt(img.src) end
        return nil
      end,
    })
  end

  -- Les images hors numérotation d'abord, et dans un walk à part : le walk principal
  -- visite les Inline avant les Block, l'image y serait déjà passée par le filtre Image
  -- quand son paragraphe arrive. Les Figure produites ici portent CLASSE_CREDIT_SEUL et
  -- sont écartées du numérotage plus bas.
  doc.blocks = doc.blocks:walk({
    Para = function(b) return hors_numerotation(b, lang) end,
    Plain = function(b) return hors_numerotation(b, lang) end,
  })

  -- Images au fil d'un paragraphe (deux photos côte à côte, « ![Bild 1](…){alt=""} ») que
  -- la rédaction a déclarées décoratives : alt="" EXPLICITE, que le formulaire Médias écrit
  -- pour « Image purement décorative ». Le texte entre crochets n'y est pas une légende —
  -- une image au fil du texte n'a pas de <figcaption>, et l'alt explicite remplace ce
  -- texte dans le HTML. La passe principale ci-dessous ne les rendait pas en décor (elle
  -- ne regarde que les images sans ce texte) : WeasyPrint en faisait deux /Figure sans /Alt,
  -- PDF/UA 7.3-1, alors que le cockpit, voyant « Bild 1 », n'en nommait aucune (mesuré sur
  -- Zeitschrift 2025-02, article 02, 29.09.2026). Seuls les Para : une image seule dans son
  -- paragraphe est déjà devenue une Figure, dont le contenu est un Plain.
  doc.blocks = doc.blocks:walk({
    Para = function(b)
      local change = false
      local contenu = b.content:map(function(x)
        if x.t == 'Image' and #x.caption > 0 and x.attributes['alt'] == '' then
          x.attributes['role'] = 'presentation'
          local d = en_decor(x, true)
          if d then change = true; return d end
        end
        return x
      end)
      if not change then return nil end
      b.content = contenu
      return b
    end,
  })

  doc.blocks = doc.blocks:walk({

    -- Image hors figure et sans alt : déclarée décorative. role="presentation" neutralise
    -- le role="img" que --embed-resources ajoute à toute image devenue data: URI, sans
    -- lequel le lecteur d'écran annoncerait « image » sans nom. Un alt= explicite non vide
    -- est respecté tel quel. WeasyPrint 69 ne distingue pas alt="" d'un alt absent : il
    -- avertit dans les deux cas et produit quand même le PDF/UA-1 — mais avec une
    -- /Figure sans /Alt, non conforme. D'où le passage en fond CSS (voir en_decor).
    Image = function(img)
      if #img.caption == 0 and vide(img.attributes['alt']) then
        img.attributes['alt'] = ''
        img.attributes['role'] = 'presentation'
        return en_decor(img) or img
      end
      return nil
    end,

    Figure = function(fig)
      -- Figure fabriquée par la passe hors numérotation : sa légende n'est qu'un crédit,
      -- déjà posé, et elle ne consomme pas de numéro.
      if a_classe(fig, CLASSE_CREDIT_SEUL) then return nil end
      local legende = utils.stringify(fig.caption.long)
      if legende:match('^%s*$') then
        -- Sans légende : pas de numéro. Mais un copyright, une source ou une note ne se
        -- perdent pas (grille sans légende) : ils sortent comme pour une image hors
        -- numérotation, le crédit en <figcaption> après les images, la note sous elles.
        local cumul, note, id_note = nouveau_cumul(), nil, nil
        fig.content = fig.content:walk({
          Image = function(img)
            cumuler(cumul, img)
            if not note then note, id_note = prendre_note(img) end
            return img
          end,
        })
        local credit = credit_depuis(cumul.copyrights, cumul.sources, true)
        if not credit and not note then return nil end
        if credit then
          fig.caption.long = crediter(pandoc.Blocks({}), credit)
          local classes = pandoc.List(fig.classes)
          classes:insert(CLASSE_CREDIT_SEUL)
          fig.classes = classes
        end
        if note then fig.content:insert(bloc_note(note, id_note, lang)) end
        return fig
      end
      n_figure = n_figure + 1
      local prefixe = mot_figure .. ' ' .. n_figure .. ' ' .. CADRATIN
      fig.caption.long = prefixer(fig.caption.long, prefixe)

      -- Une figure peut porter plusieurs images : c'est ce qu'est une grille
      -- (szh-grille.lua). Chacune a ses droits, et une mention de droits ne se perd pas.
      -- Les crédits identiques — le cas courant d'une série d'un même photographe — ne se
      -- répètent pas. Sur une figure à une image, le résultat est exactement l'ancien.
      local cumul, note, id_note = nouveau_cumul(), nil, nil
      fig.content = fig.content:walk({
        Image = function(img)
          -- L'alt se lit à deux endroits selon le lecteur (voir l'en-tête) : attribut
          -- alt= sous commonmark_x, description sous markdown, qui a déjà résolu alt=
          -- ou, à défaut, y a recopié la légende.
          local attr_alt = img.attributes['alt']
          local alt = attr_alt or utils.stringify(img.caption)
          if vide(alt) then
            -- alt="" explicite : image décorative.
            img.caption = pandoc.Inlines({})
            img.attributes['alt'] = ''
            img.attributes['role'] = 'presentation'
          elseif attr_alt then
            -- alt= explicite : il devient la description, seule source de l'attribut
            -- alt en sortie ; le laisser aussi dans les attributs ferait écrire `alt`
            -- deux fois par le writer HTML.
            img.caption = pandoc.Inlines({ pandoc.Str(attr_alt) })
            img.attributes['alt'] = nil
            if img.attributes['role'] == 'presentation' then img.attributes['role'] = nil end
          end
          -- Cas restant (pas d'attribut, description non vide) : le lecteur markdown a
          -- déjà mis le bon texte dans la description ; le réécrire en pandoc.Str
          -- aplatirait la mise en forme de la légende. Le numéro n'est jamais ajouté à
          -- l'alt, la légende n'étant pas masquée.
          cumuler(cumul, img)
          -- La note est une donnée de la figure : celle de la première image qui en porte une.
          if not note then
            note, id_note = prendre_note(img)
          else
            img.attributes['note'] = nil
          end
          return img
        end,
      })
      local credit = credit_depuis(cumul.copyrights, cumul.sources)
      if credit then fig.caption.long = crediter(fig.caption.long, credit) end
      if note then fig.content:insert(bloc_note(note, id_note, lang)) end
      return fig
    end,

    -- Tableau natif pandoc (écrit en markdown avec « : Légende »). Le contrat data-*
    -- n'existe que pour les tableaux extraits : ici, numéro seul.
    Table = function(tbl)
      if utils.stringify(tbl.caption.long):match('^%s*$') then return nil end
      n_tableau = n_tableau + 1
      tbl.caption.long = prefixer(tbl.caption.long,
                                  mot_tableau .. ' ' .. n_tableau .. ' ' .. CADRATIN)
      return tbl
    end,

    -- Tableau extrait, réinjecté en HTML brut par szh-tabelle-inclure.lua.
    RawBlock = function(raw)
      if raw.format ~= 'html' and raw.format ~= 'html5' then return nil end
      local _, _, attrs = raw.text:find(TABLE)
      if not attrs then return nil end

      local alt = attribut(attrs, 'data-alt')
      local credit = texte_credit(attribut(attrs, 'data-copyright'),
                                  attribut(attrs, 'data-source'))
      -- data-alt vide ou absent -> ni aria-describedby, ni élément : la structure du
      -- tableau se lit d'elle-même.
      local id_desc = nil
      local ids = {}
      if not vide(alt) then
        n_desc = n_desc + 1
        id_desc = 'szh-tabelle-desc-' .. n_desc
        ids[#ids + 1] = id_desc
      end
      -- data-note -> un paragraphe après le tableau, que le tableau référence aussi.
      local note = attribut(attrs, 'data-note')
      local id_note, note_html = nil, nil
      if not vide(note) then
        n_note = n_note + 1
        id_note = CLASSE_NOTE .. '-' .. n_note
        ids[#ids + 1] = id_note
        note_html = html_note(note, id_note, lang)
      end

      local prefixe = mot_tableau .. ' ' .. (n_tableau + 1) .. ' ' .. CADRATIN
      local html, numerote = traiter_tableau(raw.text, prefixe, credit,
        #ids > 0 and table.concat(ids, ' ') or nil, note_html)
      if not html then
        if id_desc then n_desc = n_desc - 1 end
        if id_note then n_note = n_note - 1 end
        return nil
      end
      if numerote then n_tableau = n_tableau + 1 end
      if id_desc then
        -- Description longue : élément masqué visuellement — jamais display:none, sinon
        -- les lecteurs d'écran l'ignoreraient — placé juste après le tableau. Le même
        -- masquage vaut pour le PDF (partage-filtres.css) : WeasyPrint ne transporte pas
        -- aria-describedby, mais il balise le texte rogné juste après le /Table.
        -- <div> et non <p> : le lecteur html de pandoc ne conserve les classes que sur les
        -- <div> et <span>, et c'est cette classe qui permet à szh-galley-docx.lua de
        -- retirer le bloc du galley Word.
        html = html .. '\n<div class="szh-description" id="' .. id_desc .. '">'
                    .. alt .. '</div>'
      end
      return pandoc.RawBlock(raw.format, html)
    end,
  })

  -- Les fonds des images décoratives, en un seul <style> de fin de corps : c'est le
  -- seul endroit où `pandoc --embed-resources` sait remplacer un chemin par un data: URI.
  local style = style_decors()
  if style then doc.blocks:insert(style) end

  -- La feuille des encadrés d'aperçu, à côté de la précédente et pour la même raison :
  -- c'est le seul endroit où elle ne peut pas se retrouver dans la chaîne du PDF.
  if lecteur_ecran then
    local style_le = lecteur_ecran.style()
    if style_le then doc.blocks:insert(style_le) end
  end

  -- Ce que ce chapitre a consommé (au-delà de son point de départ), pour le chapitre
  -- suivant. N'écrit rien hors mode livre (voir ecrire_compteurs).
  ecrire_compteurs(n_figure - depart_figure, n_tableau - depart_tableau)

  return doc
end
