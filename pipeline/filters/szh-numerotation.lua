-- Numérote les figures et les tableaux, pose leur texte alternatif et leurs crédits, en
-- mémoire à la compilation : ni le .md ni tables/*.html ne sont réécrits, l'éditeur du
-- cockpit relisant ces fichiers (un numéro écrit dedans se dupliquerait à chaque build).
-- Deux compteurs indépendants ; sans légende, aucun numéro consommé — « Tableau 3 »
-- désigne le 3ᵉ tableau légendé.
--
-- Accessibilité : la légende n'est jamais masquée, l'alt la complète. Sur une figure,
-- <img alt> porte la description et la <figcaption> « Figure N — Légende » plus les
-- crédits, sans ARIA ajouté — la légende différant structurellement de l'alt, pandoc ne
-- repose pas aria-hidden dessus, et c'est un invariant de ce filtre. alt="" explicite ->
-- image décorative (alt="" + role="presentation"). Sur un tableau, le <caption> porte
-- numéro, légende et crédits ; une description longue (data-alt) devient un
-- aria-describedby vers un élément masqué visuellement, et sans data-alt il n'y a rien,
-- la structure th/scope/colspan se lisant d'elle-même.
--
-- Contrat de format, partagé avec l'éditeur du cockpit. Figure, dans le .md :
--   ![Légende visible](media/x.png){alt="description" copyright="© J. D." source="ESA"}
--   alt absent -> l'alt reprend la légende ; alt="" -> décorative ; copyright= et
--   source= facultatifs (pandoc 3.5 les émet en data-copyright / data-source).
-- Image hors numérotation, dans le .md :
--   ![](media/x.png){.szh-hors-figure alt="description" copyright="© J. D."}
--   légende vide et classe .szh-hors-figure : ni numéro, ni légende visible. Voir la
--   passe dédiée plus bas ; le contrat d'écriture vit dans lib/references.js.
-- Tableau, dans articles/<slug>/tables/table-NN.html, en attributs sur <table> :
--   class="szh-tableau" data-entete-lignes data-alt data-copyright data-source, plus
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

-- ─── Aperçu du cockpit seulement ─────────────────────────────────────────────
-- SZH_APERCU=1 distingue les deux chaînes, comme dans szh-citations.lua : l'aperçu et le
-- PDF sortent de deux appels à pandoc, et seul l'aperçu porte cette variable.
-- szh-apercu-lecteur-ecran.lua y pose sous chaque image et chaque tableau un encadré
-- montrant ce qu'un lecteur d'écran reçoit. Le fichier n'est même pas OUVERT hors aperçu :
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
-- Un LIVRE compile chaque chapitre par une invocation pandoc séparée (voir
-- pipeline/profils/livre.mk) : les compteurs n_figure/n_tableau ci-dessous, locaux à
-- cette invocation, repartiraient sinon à zéro à chaque chapitre. Les livres publiés
-- numérotent en continu (« Abbildung 12 » au chapitre 4, pas « Abbildung 1 »).
--
-- Mécanisme : SZH_COMPTEURS donne le chemin où CE chapitre écrit, en fin de passe, ce
-- qu'il a consommé — deux nombres, figures puis tableaux, un par ligne — et ce chemin
-- suit la convention « <dossier-partagé>/<rang>.txt » (une entrée par chapitre, même
-- dossier). Pour trouver son point de départ, ce chapitre additionne ce que les
-- chapitres 1..SZH_CHAPITRE-1 ont chacun écrit dans LEUR fichier — pas seulement le
-- précédent, pour rester correct même si l'un d'eux n'a consommé ni figure ni tableau.
-- SZH_LIVRE absent -> aucun de ces fichiers n'est ni lu ni écrit, comportement identique
-- à aujourd'hui.
--
-- ⚠ make peut recompiler UN SEUL chapitre. Si le report d'un chapitre précédent manque
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
    -- expressions de droite de gauche à droite, or c'est le PREMIER nombre lu qui doit
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

-- Écrit ce que CE chapitre a consommé (n_figure, n_tableau DÉJÀ diminués du point de
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
-- Libellé de la source, ponctuation comprise : le français exige une espace fine
-- insécable (U+202F) avant le deux-points, pas les trois autres langues.
local LIBELLE_SOURCE  = { fr = 'Source\u{202F}: ', de = 'Quelle: ',
                          it = 'Fonte: ',          en = 'Source: ' }

-- Séparateur visible : cadratin entouré d'espaces. L'espace de tête est un
-- pandoc.Space (donc sécable), celui de queue est collé au cadratin dans le Span.
local CADRATIN = '\u{2014}'
-- Séparateur entre copyright et source dans un crédit.
local SEP_CREDIT = ' / '

-- Classe posée par le cockpit sur une image à ne pas numéroter, et classe posée par ce
-- filtre sur la <figure> qu'il en fait : elle dit à szh-legende-avant.lua que la
-- <figcaption> ne porte qu'un crédit et se lit donc après l'image.
local CLASSE_HORS_FIGURE = 'szh-hors-figure'
local CLASSE_CREDIT_SEUL = 'szh-credit-seul'

-- ─── Image décorative : un fond CSS, jamais un <img> ─────────────────────────
-- WeasyPrint 69 balise TOUT <img> en /Figure et n'y pose un /Alt que si l'attribut alt
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
local function en_decor(img)
  local largeur, hauteur = mesure_image(img.src)
  if not largeur then return nil end
  local classe = CLASSE_DECOR .. '-' .. (#decors + 1)
  decors[#decors + 1] = { classe = classe, src = img.src,
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
local function style_decors()
  if #decors == 0 then return nil end
  local regles = {}
  for _, d in ipairs(decors) do
    regles[#regles + 1] = string.format(
      '.%s{width:%dpx;max-width:min(100%%,calc((var(--plafond-figure) - 12px)'
        .. ' / var(--szh-rangees, 1) / %.4f))}\n'
        .. '.%s>span{padding-top:%.4f%%;background-image:url("%s")}',
      d.classe, d.largeur, d.ratio / 100.0, d.classe, d.ratio, (d.src:gsub('"', '%%22')))
  end
  return pandoc.RawBlock('html', '<style>\n' .. table.concat(regles, '\n') .. '\n</style>')
end

local function a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function vide(t) return t == nil or t:match('^%s*$') ~= nil end

-- Langue de composition : le `lang:` de l'ARTICLE prime, puis le jeton de revue, puis le
-- `lang:` du numéro. Même règle que szh-maquette.lua, et le même ordre : « Abbildung »
-- dans le PDF et « Figure » dans l'aperçu seraient un défaut à eux seuls.
--
-- ⚠ Duplication assumée, et à garder alignée avec szh-maquette.lua : ce filtre tourne
-- aussi dans la chaîne d'aperçu, où szh-maquette n'est pas branché, et où personne
-- d'autre ne lit la fiche. `meta.lang` ne suffit pas — pandoc y fusionne ausgabe.yaml et
-- la fiche sans dire de quel fichier la valeur vient, or le jeton de revue doit passer
-- devant le `lang:` du numéro mais derrière celui de l'article.
--
-- Le slug vient du fichier d'entrée : le Makefile compile depuis le dossier de l'article,
-- la fiche est donc <slug>.meta.yaml dans le répertoire courant.
local function langue_fiche()
  local fichiers = (PANDOC_STATE and PANDOC_STATE.input_files) or {}
  local chemin = fichiers[1]
  if type(chemin) ~= 'string' then return nil end
  local slug = chemin:gsub('.*[/\\]', ''):gsub('%.md$', '')
  if slug == '' then return nil end
  local fh = io.open(slug .. '.meta.yaml', 'r')
  if not fh then return nil end
  local lang = nil
  for ligne in fh:lines() do
    local m = ligne:match('^lang:%s*[\'"]?(%a%a)')
    if m then lang = m:lower(); break end
  end
  fh:close()
  return lang
end

local function langue_de(meta)
  local fiche = langue_fiche()
  if fiche and LIBELLE_FIGURE[fiche] then return fiche end
  local revue = utils.stringify(meta.revue or ''):lower()
  if revue:find('zeitschrift') then return 'de' end
  if revue:find('revue') then return 'fr' end
  local lang = utils.stringify(meta.lang or ''):lower()
  local court = lang:match('^(%a%a)')
  if court and LIBELLE_FIGURE[court] then return court end
  return 'fr'
end

-- Crédits « © J. Dupont / Source : ESA ». L'un des deux peut manquer ; les deux
-- manquants -> nil, donc pas de ponctuation orpheline. Valeurs reprises telles
-- quelles : texte brut côté figure (pandoc les échappera), déjà échappées côté
-- tableau puisqu'elles sortent d'un attribut HTML.
local function texte_credit(copyright, source, lang)
  local bouts = {}
  if not vide(copyright) then bouts[#bouts + 1] = trim(copyright) end
  if not vide(source) then
    bouts[#bouts + 1] = (LIBELLE_SOURCE[lang] or LIBELLE_SOURCE.fr) .. trim(source)
  end
  if #bouts == 0 then return nil end
  return table.concat(bouts, SEP_CREDIT)
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

-- Valeur BRUTE (encore échappée HTML) d'un attribut du <table …>, ou nil.
local function attribut(attrs, nom)
  local n = nom:gsub('%-', '%%-')
  return attrs:match('%s' .. n .. '%s*=%s*"([^"]*)"')
      or attrs:match("%s" .. n .. "%s*=%s*'([^']*)'")
end

-- Traite un bloc HTML de tableau. Renvoie (html, numerote), numerote valant true si un
-- numéro a été consommé ; nil si le bloc n'est pas un <table>. L'ordre des insertions
-- compte, chacune décalant ce qui suit : la <caption> d'abord (tout est après le '>' du
-- <table …>, les indices du tag restent valides), puis aria-describedby dans le tag, puis
-- l'élément de description après </table>.
local function traiter_tableau(html, prefixe, credit, id_desc)
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

  if id_desc then
    html = html:sub(1, fin_tag - 1)
        .. ' aria-describedby="' .. id_desc .. '"'
        .. html:sub(fin_tag)
  end

  return html, numerote
end

-- ─── Images hors numérotation ────────────────────────────────────────────────
-- La légende est vide dans le .md, donc aucun lecteur n'en fait de Figure et rien n'est
-- numéroté : il n'y a que le texte alternatif et les crédits à placer. Or un crédit est
-- une mention de droits, il ne doit pas se perdre — comme pour un tableau sans légende.
-- L'image est donc enveloppée dans une <figure> dont la <figcaption> ne porte que le
-- crédit : le lien entre l'image et ses droits reste explicite pour un lecteur d'écran,
-- sans numéro ni légende. Sans crédit à porter, l'image reste un <img> dans son
-- paragraphe, une <figure> sans <figcaption> n'apportant rien.

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
  local credit = texte_credit(img.attributes['copyright'], img.attributes['source'], lang)
  local contenu = img
  if vide(img.attributes['alt']) then
    img.attributes['alt'] = ''
    img.attributes['role'] = 'presentation'
    -- Décorative ET créditée : le crédit reste (c'est une mention de droits), mais
    -- l'image passe en fond CSS, sans quoi la <figure> porterait une /Figure sans /Alt.
    -- Sans crédit, on laisse la passe principale s'en charger : `en_decor` inscrit une
    -- règle CSS, l'appeler ici pour rien en laisserait une inutile.
    if credit then contenu = en_decor(img) or img end
  end
  if not credit then return nil end
  return pandoc.Figure(
    pandoc.Blocks({ pandoc.Plain({ contenu }) }),
    { long = pandoc.Blocks({ pandoc.Plain({
        pandoc.Span({ pandoc.Str(credit) }, pandoc.Attr('', { 'szh-credit' }, {})) }) }) },
    pandoc.Attr('', { CLASSE_CREDIT_SEUL }, {})
  )
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

  -- Aperçu : les encadrés « lecteur d'écran » AVANT toute autre passe, sur l'AST encore
  -- intact. C'est là, et seulement là, que se lit l'intention du rédacteur : un alt=""
  -- écrit exprès (image décorative) ne se distingue plus d'un alt absent dès que les
  -- passes ci-dessous ont normalisé, elles posent alt="" dans les deux cas.
  if lecteur_ecran then doc.blocks = lecteur_ecran.blocs(doc.blocks, lang) end

  -- Les images hors numérotation d'abord, et dans un walk à part : le walk principal
  -- visite les Inline avant les Block, l'image y serait déjà passée par le filtre Image
  -- quand son paragraphe arrive. Les Figure produites ici portent CLASSE_CREDIT_SEUL et
  -- sont écartées du numérotage plus bas.
  doc.blocks = doc.blocks:walk({
    Para = function(b) return hors_numerotation(b, lang) end,
    Plain = function(b) return hors_numerotation(b, lang) end,
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
      if legende:match('^%s*$') then return nil end   -- sans légende : pas de numéro
      n_figure = n_figure + 1
      local prefixe = mot_figure .. ' ' .. n_figure .. ' ' .. CADRATIN
      fig.caption.long = prefixer(fig.caption.long, prefixe)

      -- Une figure peut porter plusieurs images : c'est ce qu'est une grille
      -- (szh-grille.lua). Chacune a ses droits, et une mention de droits ne se perd pas.
      -- Les crédits identiques — le cas courant d'une série d'un même photographe — ne se
      -- répètent pas. Sur une figure à une image, le résultat est exactement l'ancien.
      local credits, vus = {}, {}
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
          local c = texte_credit(img.attributes['copyright'],
                                 img.attributes['source'], lang)
          if c and not vus[c] then
            vus[c] = true
            credits[#credits + 1] = c
          end
          return img
        end,
      })
      if #credits > 0 then
        fig.caption.long = crediter(fig.caption.long, table.concat(credits, SEP_CREDIT))
      end
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
                                  attribut(attrs, 'data-source'), lang)
      -- data-alt vide ou absent -> ni aria-describedby, ni élément : la structure du
      -- tableau se lit d'elle-même.
      local id_desc = nil
      if not vide(alt) then
        n_desc = n_desc + 1
        id_desc = 'szh-tabelle-desc-' .. n_desc
      end

      local prefixe = mot_tableau .. ' ' .. (n_tableau + 1) .. ' ' .. CADRATIN
      local html, numerote = traiter_tableau(raw.text, prefixe, credit, id_desc)
      if not html then
        if id_desc then n_desc = n_desc - 1 end
        return nil
      end
      if numerote then n_tableau = n_tableau + 1 end
      if id_desc then
        -- Description longue : élément masqué visuellement — jamais display:none, sinon
        -- les lecteurs d'écran l'ignoreraient — placé juste après le tableau. print.css le
        -- retire en @media print, WeasyPrint ne transportant pas aria-describedby.
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

  -- Ce que CE chapitre a consommé (au-delà de son point de départ), pour le chapitre
  -- suivant. N'écrit rien hors mode livre (voir ecrire_compteurs).
  ecrire_compteurs(n_figure - depart_figure, n_tableau - depart_tableau)

  return doc
end
