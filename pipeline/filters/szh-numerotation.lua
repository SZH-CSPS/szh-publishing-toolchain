-- Numérote les figures et les tableaux, et pose leur texte alternatif, leurs crédits et
-- leur note. Tout se fait en mémoire : le .md et tables/*.html ne sont pas réécrits, car le
-- cockpit les relit et y retrouverait les numéros.
--
-- Seules les figures et les tableaux qui ont une légende reçoivent un numéro. Figures et
-- tableaux ont chacun leur compteur.
--
-- Rendu HTML :
-- - figure : <img alt> porte la description ; la <figcaption> porte « Figure N — Légende »
--   suivi des crédits « (© X | Source) » ;
-- - tableau : la <caption> porte numéro, légende et crédits. Une description longue
--   (data-alt) va dans un élément masqué visuellement, relié par aria-describedby ;
-- - note : un paragraphe « Note : texte » sous l'image ou après </table>, de classe
--   szh-bloc-note (szh-note est réservée aux notes de bas de page), relié lui aussi par
--   aria-describedby ;
-- - image décorative (alt="") : un fond CSS, voir en_decor().
--
-- Format d'entrée, partagé avec le cockpit :
--   figure     ![Légende](media/x.png){alt="description" copyright="© J. D." source="ESA"
--                                     note="texte de la note"}
--              sans alt, l'alt reprend la légende ; alt="" rend l'image décorative.
--   hors numérotation
--              ![](media/x.png){.szh-hors-figure alt="description" copyright="© J. D."}
--              ni numéro ni légende (voir lib/references.js).
--   tableau    dans tables/table-NN.html : <table class="szh-tableau" data-entete-lignes
--              data-alt data-copyright data-source data-note> et <caption>Légende</caption>.
--
-- L'aperçu et le PDF ne lisent pas le .md avec le même lecteur Pandoc : `markdown` (PDF)
-- déplace alt= dans la description de l'image, `commonmark_x` (aperçu) le laisse dans les
-- attributs. Le filtre lit donc l'alt aux deux endroits.
--
-- S'exécute après szh-tabelle-inclure.lua (qui insère les tableaux) et szh-figure.lua (qui
-- construit les figures de l'aperçu).

local utils = pandoc.utils

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  -- debug.getinfo donne le chemin de ce fichier ; PANDOC_SCRIPT_FILE donnerait celui du
  -- script passé à pandoc, qui peut être un autre.
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
-- SZH_APERCU=1 n'est posée que pour la compilation de l'aperçu. Dans ce cas,
-- szh-apercu-lecteur-ecran.lua ajoute sous chaque image et chaque tableau un encadré qui
-- montre ce qu'un lecteur d'écran reçoit. Hors aperçu, ce fichier n'est pas chargé, et rien
-- n'en arrive dans le PDF. S'il manque, l'aperçu sort sans encadré.
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
-- Chaque chapitre est compilé par un appel séparé à pandoc (pipeline/profils/livre.mk).
-- Pour que la numérotation continue d'un chapitre à l'autre, chaque chapitre écrit dans
-- SZH_COMPTEURS (<dossier>/<rang>.txt) le nombre de figures puis de tableaux qu'il a
-- numérotés. Le chapitre N part de la somme des fichiers des chapitres 1 à N-1.
--
-- Si l'un de ces fichiers manque (par exemple quand make ne recompile qu'un chapitre après
-- un nettoyage de out/), le chapitre le signale et numérote à partir de 1.
--
-- Hors livre, rien n'est lu ni écrit. Les trois valeurs sont posées par Pandoc(doc).
local LIVRE, CHAPITRE, CHEMIN_COMPTEURS = false, nil, nil

-- Livre en maquette normale : le bloc `mise-en-page:` de buch.yaml règle la numérotation
-- (`numeros-figures` : volume, chapitre ou aucun) et la place de la légende (`legende` :
-- dessus ou dessous). Ailleurs, les deux valent nil.
local NUMEROS_FIGURES, LEGENDE = nil, nil
-- Classe posée sur une figure dont la légende se lit après l'image (szh-legende-avant.lua).
local CLASSE_LEGENDE_DESSOUS = 'szh-legende-dessous'

-- Dossier de CHEMIN_COMPTEURS, sans séparateur final ; '.' si le chemin n'en a pas.
local function dossier_compteurs()
  return (CHEMIN_COMPTEURS:match('^(.*)[/\\][^/\\]*$')) or '.'
end

-- Chemin du report d'un chapitre de rang `rang`, à côté de celui de ce chapitre-ci.
local function chemin_report(rang)
  return dossier_compteurs() .. '/' .. rang .. '.txt'
end

-- Point de départ des deux compteurs : la somme des chapitres précédents. Rend (0, 0) hors
-- livre, en numérotation par chapitre, ou si le fichier d'un chapitre précédent manque.
local function depart_compteurs()
  if not CHAPITRE or not CHEMIN_COMPTEURS then return 0, 0 end
  if NUMEROS_FIGURES == 'chapitre' then return 0, 0 end
  local figures, tableaux = 0, 0
  for rang = 1, CHAPITRE - 1 do
    local chemin = chemin_report(rang)
    local fh = io.open(chemin, 'r')
    -- Deux lectures séparées : Lua ne garantit pas l'ordre d'évaluation d'une affectation
    -- multiple, et le premier nombre est celui des figures.
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

-- Écrit le nombre de figures et de tableaux numérotés par ce chapitre. Rien hors livre.
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

local LIBELLE_FIGURE  = { fr = 'Figure',  de = 'Abbildung', it = 'Figura' }
local LIBELLE_TABLEAU = { fr = 'Tableau', de = 'Tabelle',   it = 'Tabella' }
-- Étiquette de la note. Seule l'étiquette est en italique, sans le deux-points.
local LIBELLE_NOTE    = { fr = 'Note', de = 'Notiz', it = 'Nota' }
-- Le français met une espace fine insécable (U+202F) avant le deux-points.
local PONCT_NOTE      = { fr = '\u{202F}:', de = ':', it = ':' }

local CADRATIN = '\u{2014}'
-- Préfixe d'une légende : « Figure 3 — », ou « Abbildung 3: » en livre normal ; nil si
-- `numeros-figures: aucun`.
local function prefixe_legende(mot, n, lang)
  if NUMEROS_FIGURES == 'aucun' then return nil end
  if NUMEROS_FIGURES then return mot .. ' ' .. n .. (PONCT_NOTE[lang] or PONCT_NOTE.fr) end
  return mot .. ' ' .. n .. ' ' .. CADRATIN
end
-- Séparateur entre copyright et source dans un crédit.
local SEP_CREDIT = ' | '
-- Séparateur entre plusieurs copyrights, ou plusieurs sources.
local SEP_MEME_CHAMP = ', '
-- Classe et préfixe d'id du paragraphe de note (lue aussi par szh-legende-avant.lua).
local CLASSE_NOTE = 'szh-bloc-note'
local n_note = 0               -- numéro de la dernière note, pour des id uniques

-- CLASSE_HORS_FIGURE : posée par le cockpit sur une image à ne pas numéroter.
-- CLASSE_CREDIT_SEUL : posée ici sur la <figure> dont la légende n'est qu'un crédit ;
-- szh-legende-avant.lua la place alors après l'image.
local CLASSE_HORS_FIGURE = 'szh-hors-figure'
local CLASSE_CREDIT_SEUL = 'szh-credit-seul'

-- ─── Image décorative : un fond CSS, pas un <img> ────────────────────────────
-- WeasyPrint balise tout <img> comme /Figure, et une /Figure sans texte alternatif est
-- interdite par PDF/UA-1 (règle 7.3). role="presentation" et aria-hidden n'y changent rien.
-- Une image décorative est donc rendue en fond CSS, qui n'entre pas dans la structure du
-- PDF.
--
-- Rendu : deux <span> imbriqués. L'externe a la largeur naturelle de l'image (bornée par
-- print.css) ; l'interne a un padding-top en pourcentage, qui donne la hauteur à
-- proportion. WeasyPrint ne connaît pas `aspect-ratio`.
--
-- Le url() est écrit dans un <style> en fin de document, car `pandoc --embed-resources`
-- n'intègre pas les images citées dans un attribut style=.
local CLASSE_DECOR = 'szh-decor'
local decors = {}          -- une entrée par image décorative rencontrée

-- Largeur et hauteur naturelles d'une image, en pixels CSS ; nil si elle est illisible.
-- WeasyPrint ignore la résolution inscrite dans le fichier : un pixel de l'image vaut un
-- pixel CSS.
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
-- Rend nil si l'image est illisible : l'appelant garde alors le <img>, et le contrôle
-- PDF/UA le signalera.
--
-- `garder_largeur` : reprendre la largeur déclarée (width=, posée par l'import Word) plutôt
-- que la largeur naturelle. Sert aux images au fil d'un paragraphe, pour que deux photos
-- côte à côte le restent.
local function en_decor(img, garder_largeur)
  local largeur, hauteur = mesure_image(img.src)
  if not largeur then return nil end
  local classe = CLASSE_DECOR .. '-' .. (#decors + 1)
  local declaree = garder_largeur and img.attributes['width'] or nil
  -- Seule une longueur CSS simple est acceptée, puisque la valeur est écrite dans un <style>.
  if declaree and not declaree:match('^%d+%.?%d*%a*%%?$') then declaree = nil end
  decors[#decors + 1] = { classe = classe, src = img.src, largeur_css = declaree,
                          largeur = largeur, ratio = 100.0 * hauteur / largeur }
  return pandoc.RawInline('html', '<span class="' .. CLASSE_DECOR .. ' ' .. classe
    .. '" role="presentation"><span></span></span>')
end

-- Échappe un chemin pour url("…") : guillemets, apostrophes, parenthèses et retours à la
-- ligne (« Bild (1).png ») casseraient la règle CSS.
local function echapper_url(s)
  s = s:gsub('"', '%%22')
  s = s:gsub("'", '%%27')
  s = s:gsub('%(', '%%28')
  s = s:gsub('%)', '%%29')
  s = s:gsub('\r\n', '%%0A'):gsub('[\r\n]', '%%0A')
  return s
end

-- Le <style> des images décoratives, posé en fin de document pour passer après print.css.
--
-- Un fond CSS n'est pas borné par max-height. Pour respecter la hauteur maximale d'une
-- figure (--plafond-figure, socle.css), on borne donc la largeur : plafond divisé par le
-- rapport hauteur/largeur (`ratio` vaut 100 × hauteur / largeur). min(100%, …) garde aussi
-- la limite de largeur de la colonne. --szh-rangees vaut 1 hors d'une grille.
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

-- Ajoute « © » devant un copyright, sauf s'il commence déjà par ©, « Copyright » ou
-- &copy;. Un « (c) » initial devient ©.
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

-- Crédit « (© J. Dupont | ESA) » à partir des listes de copyrights et de sources ; nil si
-- les deux sont vides. `seul` : le crédit n'accompagne pas de légende et s'écrit sans
-- parenthèses.
local function credit_depuis(copyrights, sources, seul)
  local bouts = {}
  if #copyrights > 0 then bouts[#bouts + 1] = table.concat(copyrights, SEP_MEME_CHAMP) end
  if #sources > 0 then bouts[#bouts + 1] = table.concat(sources, SEP_MEME_CHAMP) end
  if #bouts == 0 then return nil end
  if seul then return table.concat(bouts, SEP_CREDIT) end
  return '(' .. table.concat(bouts, SEP_CREDIT) .. ')'
end

-- Crédit d'une image ou d'un tableau. Les valeurs d'un tableau viennent d'un attribut HTML
-- et sont donc déjà échappées.
local function texte_credit(copyright, source, seul)
  return credit_depuis(
    vide(copyright) and {} or { copyright_avec_signe(copyright) },
    vide(source) and {} or { trim(source) }, seul)
end

-- Cumul des crédits de plusieurs images (grille), sans doublons, dans l'ordre d'apparition.
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

-- Découpe un texte en mots (Str et Space), pour les filtres suivants comme la césure.
local function mots(texte)
  local inl = pandoc.Inlines({})
  for mot in texte:gmatch('%S+') do
    if #inl > 0 then inl:insert(pandoc.Space()) end
    inl:insert(pandoc.Str(mot))
  end
  return inl
end

-- Le paragraphe de note d'une figure. <p> et </p> sont écrits en HTML brut, car pandoc
-- ne garde une classe et un id que sur div et span.
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

-- Le même paragraphe pour un tableau, en HTML. `texte` est déjà échappé.
local function html_note(texte, id, lang)
  return '<p class="' .. CLASSE_NOTE .. '" id="' .. id .. '"><span class="' .. CLASSE_NOTE
    .. '-etiquette">' .. (LIBELLE_NOTE[lang] or LIBELLE_NOTE.fr) .. '</span>'
    .. (PONCT_NOTE[lang] or PONCT_NOTE.fr) .. ' ' .. trim(texte) .. '</p>'
end

-- Retire l'attribut note= d'une image et lui attribue un id, ajouté à l'aria-describedby de
-- l'image (sauf image décorative). Rend (texte, id), ou nil sans note.
local function prendre_note(img)
  local t = img.attributes['note']
  img.attributes['note'] = nil
  if vide(t) then return nil end
  n_note = n_note + 1
  local id = CLASSE_NOTE .. '-' .. n_note
  if img.attributes['role'] ~= 'presentation' then ajouter_describedby(img, id) end
  return trim(t), id
end

-- Insère le préfixe « Figure N — » au début du premier paragraphe de la légende, dans un
-- Span de classe szh-numero (mis en gras par print.css).
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

-- Ajoute les crédits à la fin du dernier paragraphe de la légende (classe szh-credit).
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

-- ─── Tableaux insérés en HTML brut ───────────────────────────────────────────
-- Ces tableaux arrivent en RawBlock('html') : on modifie leur texte directement.
-- Lua n'a pas d'option « insensible à la casse », d'où ces motifs.
local OUVRANTE = '<[cC][aA][pP][tT][iI][oO][nN][^>]*>'
local FERMANTE = '</[cC][aA][pP][tT][iI][oO][nN]%s*>'
local TABLE    = '<[tT][aA][bB][lL][eE]([^>]*)>'

-- Valeur brute (encore échappée HTML) d'un attribut du <table …>, ou nil.
local function attribut(attrs, nom)
  local n = nom:gsub('%-', '%%-')
  return attrs:match('%s' .. n .. '%s*=%s*"([^"]*)"')
      or attrs:match("%s" .. n .. "%s*=%s*'([^']*)'")
end

-- Traite le HTML d'un tableau. Rend (html, numerote), où numerote dit si un numéro a été
-- utilisé ; rend nil si le bloc n'est pas un <table>.
-- `ids` : les id à ajouter à aria-describedby, séparés par une espace, ou nil.
-- `note_html` : le paragraphe de note, placé après </table>.
-- Les modifications se font dans cet ordre, pour que les positions calculées restent
-- justes : <caption>, puis balise <table>, puis note.
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
    -- Numéro au début de la légende, crédits à la fin.
    local queue = credit and (' <span class="szh-credit">' .. credit .. '</span>') or ''
    html = html:sub(1, f_ouv)
        .. (prefixe and ('<span class="szh-numero">' .. prefixe .. '</span> ') or '')
        .. html:sub(f_ouv + 1, d_ferm - 1)
        .. queue
        .. html:sub(d_ferm)
    numerote = true
  elseif credit then
    -- Pas de légende mais des crédits : une <caption> qui ne contient que le crédit,
    -- sans numéro.
    local remplacer = d_ouv ~= nil and d_ferm ~= nil      -- <caption> présente mais vide
    local avant = remplacer and html:sub(1, d_ouv - 1) or html:sub(1, fin_tag)
    local apres = remplacer and html:sub(d_ferm) or html:sub(fin_tag + 1)
    if remplacer then apres = apres:gsub('^' .. FERMANTE, '', 1) end
    html = avant
        .. '<caption><span class="szh-credit">' .. credit .. '</span></caption>'
        .. apres
  end

  -- Balise <table> : retire data-note, ajoute les ids à aria-describedby.
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
    -- Après le dernier </table> du bloc, ou à la fin s'il n'y en a pas.
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
-- Une image de classe szh-hors-figure n'a ni numéro ni légende. Si elle a un crédit ou une
-- note, elle est placée dans une <figure> dont la <figcaption> ne contient que le crédit,
-- et la note suit l'image. Sinon elle reste un simple <img>.

-- L'image seule d'un paragraphe, si elle porte la classe ; nil sinon.
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
  -- Sans texte alternatif, l'image est décorative : role="presentation" remplace le
  -- role="img" qu'ajoute --embed-resources.
  local credit = texte_credit(img.attributes['copyright'], img.attributes['source'], true)
  local contenu = img
  local a_note = not vide(img.attributes['note'])
  if vide(img.attributes['alt']) then
    img.attributes['alt'] = ''
    img.attributes['role'] = 'presentation'
    -- Décorative avec crédit ou note : fond CSS ici. Sans eux, la passe principale s'en
    -- charge.
    if credit or a_note then contenu = en_decor(img) or img end
  end
  if not credit and not a_note then return nil end
  -- La note se lit avant d'insérer l'image dans le Plain, car pandoc copie l'élément à
  -- l'insertion.
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

-- ─── Signalement : image sans texte alternatif (aperçu seulement) ────────────
-- Une image sans attribut alt et sans légende n'est pas annoncée par un lecteur d'écran.
-- (alt="" est différent : c'est une image déclarée décorative.) L'export OJS refuse ces
-- images (imagesSansAlternative() de lib/references.js) ; on les signale dès la relecture.
--
-- Le contrôle se fait dans l'aperçu, au début de Pandoc(doc), avant que les passes
-- suivantes ne posent alt="" sur les images qui n'en ont pas. Il ne modifie rien.
-- Un signalement par fichier image.
local FIGURES_SANS_ALT_SIGNALEES = {}

-- Retire « | », qui sépare les champs d'un constat.
local sans_barre = commun.sans_barre

local function constat_figure_sans_alt(src)
  if FIGURES_SANS_ALT_SIGNALEES[src] then return end
  FIGURES_SANS_ALT_SIGNALEES[src] = true
  local nom = src:match('([^/\\]+)$') or src
  local champ_unite = (LIVRE and 'chapitre « ' or 'article « ') .. slug_article() .. ' »'
  commun.constat('numerotation', 'avertissement', 'figure-sans-alt',
    { champ_unite, 'image « ' .. sans_barre(src) .. ' »' },
    sans_barre('L’image ' .. nom .. ' n’a ni texte alternatif ni légende\u{202F}: '
      .. 'un lecteur d’écran n’en dira rien.'),
    sans_barre('Das Bild ' .. nom .. ' hat weder Alternativtext noch '
      .. 'Legende: ein Screenreader sagt dazu nichts.'))
end

-- Vrai si `img` n'a ni attribut alt ni légende. Les portraits ne sont pas concernés : ils
-- sont ajoutés plus tard, par szh-auteurs.lua.
local function figure_sans_alt(img)
  return img.attributes['alt'] == nil and #img.caption == 0
end

-- ─── Point d'entrée ─────────────────────────────────────────────────────────
-- Pandoc(doc) permet de lire les métadonnées avant de parcourir les blocs.
function Pandoc(doc)
  local contexte = commun.contexte(doc.meta)
  local lang = contexte.lang
  LIVRE = contexte.produit == 'livre'
  CHAPITRE = LIVRE and tonumber(os.getenv('SZH_CHAPITRE') or '') or nil
  CHEMIN_COMPTEURS = LIVRE and os.getenv('SZH_COMPTEURS') or nil
  local mep = commun.mise_en_page(doc.meta)
  NUMEROS_FIGURES = mep and mep['numeros-figures'] or nil
  LEGENDE = mep and mep.legende or nil
  local mot_figure  = LIBELLE_FIGURE[lang]  or LIBELLE_FIGURE.fr
  local mot_tableau = LIBELLE_TABLEAU[lang] or LIBELLE_TABLEAU.fr
  local depart_figure, depart_tableau = depart_compteurs()
  local n_figure, n_tableau, n_desc = depart_figure, depart_tableau, 0

  -- Aperçu : encadrés « lecteur d'écran » et signalements, avant les passes qui posent
  -- alt="" sur les images sans alt (on ne distinguerait plus un alt vide voulu d'un alt
  -- absent).
  if lecteur_ecran then doc.blocks = lecteur_ecran.blocs(doc.blocks, lang) end

  if APERCU then
    doc.blocks:walk({
      Image = function(img)
        if figure_sans_alt(img) then constat_figure_sans_alt(img.src) end
        return nil
      end,
    })
  end

  -- Images hors numérotation, dans un parcours à part : le parcours principal traite les
  -- images avant leur paragraphe. Les figures créées ici ne seront pas numérotées.
  doc.blocks = doc.blocks:walk({
    Para = function(b) return hors_numerotation(b, lang) end,
    Plain = function(b) return hors_numerotation(b, lang) end,
  })

  -- Images au fil d'un paragraphe déclarées décoratives (« ![Bild 1](…){alt=""} », par
  -- exemple deux photos côte à côte) : fond CSS, en gardant leur largeur. Le texte entre
  -- crochets n'est pas une légende ici. Seuls les Para sont concernés : une image seule
  -- dans son paragraphe est déjà une Figure.
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

    -- Image hors figure et sans alt : décorative, rendue en fond CSS (voir en_decor).
    Image = function(img)
      if #img.caption == 0 and vide(img.attributes['alt']) then
        img.attributes['alt'] = ''
        img.attributes['role'] = 'presentation'
        return en_decor(img) or img
      end
      return nil
    end,

    Figure = function(fig)
      -- Figure créée par la passe hors numérotation : déjà traitée.
      if a_classe(fig, CLASSE_CREDIT_SEUL) then return nil end
      local legende = utils.stringify(fig.caption.long)
      if legende:match('^%s*$') then
        -- Sans légende : pas de numéro. Crédits et note sont rendus comme pour une image
        -- hors numérotation.
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
      local prefixe = prefixe_legende(mot_figure, n_figure, lang)
      if prefixe then fig.caption.long = prefixer(fig.caption.long, prefixe) end
      if LEGENDE == 'dessous' then
        local classes = pandoc.List(fig.classes)
        classes:insert(CLASSE_LEGENDE_DESSOUS)
        fig.classes = classes
      end

      -- Une figure peut contenir plusieurs images (grille, szh-grille.lua). Leurs crédits
      -- sont réunis, sans doublons.
      local cumul, note, id_note = nouveau_cumul(), nil, nil
      fig.content = fig.content:walk({
        Image = function(img)
          -- L'alt est dans l'attribut alt= (aperçu) ou dans la description (PDF).
          local attr_alt = img.attributes['alt']
          local alt = attr_alt or utils.stringify(img.caption)
          if vide(alt) then
            -- alt="" explicite : image décorative.
            img.caption = pandoc.Inlines({})
            img.attributes['alt'] = ''
            img.attributes['role'] = 'presentation'
          elseif attr_alt then
            -- alt= devient la description ; laissé en attribut, il serait écrit deux fois.
            img.caption = pandoc.Inlines({ pandoc.Str(attr_alt) })
            img.attributes['alt'] = nil
            if img.attributes['role'] == 'presentation' then img.attributes['role'] = nil end
          end
          -- Sinon, la description est déjà la bonne ; on la garde telle quelle pour ne
          -- pas perdre sa mise en forme.
          cumuler(cumul, img)
          -- La note de la figure est celle de la première image qui en a une.
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

    -- Tableau écrit en Markdown (« : Légende ») : numéro seulement.
    Table = function(tbl)
      if utils.stringify(tbl.caption.long):match('^%s*$') then return nil end
      n_tableau = n_tableau + 1
      local prefixe = prefixe_legende(mot_tableau, n_tableau, lang)
      if prefixe then tbl.caption.long = prefixer(tbl.caption.long, prefixe) end
      return tbl
    end,

    -- Tableau de tables/, inséré en HTML par szh-tabelle-inclure.lua.
    RawBlock = function(raw)
      if raw.format ~= 'html' and raw.format ~= 'html5' then return nil end
      local _, _, attrs = raw.text:find(TABLE)
      if not attrs then return nil end

      local alt = attribut(attrs, 'data-alt')
      local credit = texte_credit(attribut(attrs, 'data-copyright'),
                                  attribut(attrs, 'data-source'))
      -- data-alt : description longue, reliée par aria-describedby.
      local id_desc = nil
      local ids = {}
      if not vide(alt) then
        n_desc = n_desc + 1
        id_desc = 'szh-tabelle-desc-' .. n_desc
        ids[#ids + 1] = id_desc
      end
      -- data-note : paragraphe après le tableau, relié lui aussi.
      local note = attribut(attrs, 'data-note')
      local id_note, note_html = nil, nil
      if not vide(note) then
        n_note = n_note + 1
        id_note = CLASSE_NOTE .. '-' .. n_note
        ids[#ids + 1] = id_note
        note_html = html_note(note, id_note, lang)
      end

      local prefixe = prefixe_legende(mot_tableau, n_tableau + 1, lang)
      local html, numerote = traiter_tableau(raw.text, prefixe, credit,
        #ids > 0 and table.concat(ids, ' ') or nil, note_html)
      if not html then
        if id_desc then n_desc = n_desc - 1 end
        if id_note then n_note = n_note - 1 end
        return nil
      end
      if numerote then n_tableau = n_tableau + 1 end
      if id_desc then
        -- Description longue : un <div> après le tableau, masqué visuellement (pas
        -- display:none, que les lecteurs d'écran ignorent). Dans le PDF, WeasyPrint
        -- n'utilise pas aria-describedby mais balise ce texte juste après le tableau.
        -- Un <div> et non un <p>, pour que pandoc garde la classe dont
        -- szh-galley-docx.lua a besoin.
        html = html .. '\n<div class="szh-description" id="' .. id_desc .. '">'
                    .. alt .. '</div>'
      end
      return pandoc.RawBlock(raw.format, html)
    end,
  })

  -- Le <style> des images décoratives, en fin de document.
  local style = style_decors()
  if style then doc.blocks:insert(style) end

  -- Le style des encadrés de l'aperçu.
  if lecteur_ecran then
    local style_le = lecteur_ecran.style()
    if style_le then doc.blocks:insert(style_le) end
  end

  -- Livre : nombre de figures et de tableaux de ce chapitre, pour le suivant.
  ecrire_compteurs(n_figure - depart_figure, n_tableau - depart_tableau)

  return doc
end
