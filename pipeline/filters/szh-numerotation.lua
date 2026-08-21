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

local function a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function vide(t) return t == nil or t:match('^%s*$') ~= nil end

-- Langue de composition : la revue prime sur `lang:` du numéro. Même règle que
-- szh-maquette.lua, dupliquée parce que ce filtre tourne aussi dans la chaîne
-- d'aperçu, où szh-maquette n'est pas branché — sans elle, un numéro « zeitschrift »
-- sans clé `lang:` donnerait « Figure » dans l'aperçu et « Abbildung » dans le PDF.
local function langue_de(meta)
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
  if vide(img.attributes['alt']) then
    img.attributes['alt'] = ''
    img.attributes['role'] = 'presentation'
  end
  local credit = texte_credit(img.attributes['copyright'], img.attributes['source'], lang)
  if not credit then return nil end
  return pandoc.Figure(
    pandoc.Blocks({ pandoc.Plain({ img }) }),
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
  local n_figure, n_tableau, n_desc = 0, 0, 0

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
    -- avertit dans les deux cas et produit quand même le PDF/UA-1.
    Image = function(img)
      if #img.caption == 0 and vide(img.attributes['alt']) then
        img.attributes['alt'] = ''
        img.attributes['role'] = 'presentation'
        return img
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

      local credit = nil
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
          credit = credit or texte_credit(img.attributes['copyright'],
                                          img.attributes['source'], lang)
          return img
        end,
      })
      if credit then fig.caption.long = crediter(fig.caption.long, credit) end
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

  return doc
end
