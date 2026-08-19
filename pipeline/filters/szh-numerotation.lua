-- szh-numerotation.lua — numérotation, TEXTE ALTERNATIF et CRÉDITS des figures
-- et des tableaux. Tout est calculé À LA COMPILATION, en mémoire : ce filtre ne
-- réécrit JAMAIS ni le .md ni tables/*.html (l'éditeur du cockpit relit ces
-- fichiers ; un numéro ou un crédit écrit dedans se dupliquerait à chaque build).
--
-- ═══ 1. Numérotation (D31) ═══════════════════════════════════════════════════
-- Remplace la numérotation purement CSS de D31 : un numéro produit par `content:`
-- n'existe que dans le rendu visuel, jamais dans le texte accessible — un lecteur
-- d'écran ne pouvait pas relier « voir figure 5 » à l'image. Ici le numéro est
-- écrit DANS le texte de la légende, seule source de vérité.
-- Les deux compteurs sont INDÉPENDANTS (figures 1..n, tableaux 1..m). Sans
-- légende -> aucun numéro consommé : « Tableau 3 » désigne le 3ᵉ tableau LÉGENDÉ,
-- seul numéro auquel un renvoi éditorial puisse se raccrocher.
--
-- ═══ 2. Modèle d'accessibilité (D104) ════════════════════════════════════════
-- CORRIGE le modèle précédent, qui recopiait la légende dans l'alt puis laissait
-- pandoc poser `aria-hidden="true"` sur la <figcaption>. C'était faux : la légende
-- et le texte alternatif ne disent pas la même chose. Une légende masquée aux
-- lecteurs d'écran est de l'information éditoriale perdue.
--   * La légende n'est JAMAIS masquée. Elle est lue, l'alt la complète.
--   * FIGURE : <img alt> porte la DESCRIPTION de l'image ; la <figcaption> porte
--     « Figure N — Légende » + crédits. Aucun ARIA ajouté : l'alt nomme l'image,
--     la figcaption accompagne la figure. Comme la légende visible porte le numéro
--     (et souvent les crédits), elle DIFFÈRE structurellement de l'alt : pandoc ne
--     repose donc plus aria-hidden — c'est un invariant de ce filtre, pas un hasard.
--   * alt="" explicite -> image DÉCORATIVE : alt="" + role="presentation".
--   * TABLEAU : <caption> = nom du tableau (numéro + légende + crédits). Une
--     description longue (data-alt) devient un aria-describedby vers un élément
--     masqué visuellement. Pas de data-alt -> RIEN : la structure du tableau
--     (th/scope/colspan) se lit directement, un aria-label ne ferait que masquer
--     cette structure derrière une phrase.
--
-- ═══ 3. Contrat de format (partagé avec le cockpit) ══════════════════════════
-- FIGURE, dans le .md — attributs pandoc sur l'image :
--   ![Légende visible](media/x.png){alt="description" copyright="© J. D." source="ESA"}
--   texte entre crochets = la LÉGENDE ; alt= = le texte alternatif.
--   alt ABSENT   -> repli : alt = la légende seule (compatibilité de tout l'existant) ;
--   alt=""       -> image décorative ;
--   copyright=/source= facultatifs. Pandoc 3.5 les émet en HTML sous
--   `data-copyright`/`data-source` (préfixage automatique des attributs inconnus) :
--   ils sont donc VALIDES en HTML5 et laissés en place, comme les data-* du contrat
--   des tableaux. La forme lisible, elle, est le <span class="szh-credit">.
-- TABLEAU, dans articles/<slug>/tables/table-NN.html — attributs sur <table> :
--   <table class="szh-tableau" data-entete-lignes="1" data-alt="…"
--          data-copyright="…" data-source="…"> + <caption>Légende</caption>
--   attributs omis quand vides ; <caption> absent sans légende (D103).
--
-- ⚠ DEUX LECTEURS, UN SEUL RÉSULTAT. Le lecteur `markdown` (PDF/HTML) CONSOMME
-- l'attribut alt= : il le déplace dans la description de l'Image et met le texte
-- entre crochets dans la Caption de la Figure. Le lecteur `commonmark_x` (aperçu)
-- laisse alt= dans les attributs et met les crochets dans la description. Le code
-- ci-dessous lit donc l'alt à DEUX endroits (attribut d'abord, description ensuite),
-- ce qui rend les deux chaînes identiques — vérifié sur .html et .apercu.html.
--
-- Doit tourner APRÈS szh-tabelle-inclure.lua (les tableaux D47 n'existent qu'une
-- fois réinjectés) et APRÈS szh-figure.lua (le lecteur commonmark_x ne fabrique
-- les Figure que là) — voir l'ordre des --lua-filter dans le Makefile.

local utils = pandoc.utils

-- Libellés localisés. `en` reprend l'ancien :lang(en) du CSS ; `it` complète les
-- trois langues de la revue.
local LIBELLE_FIGURE  = { fr = 'Figure',  de = 'Abbildung', it = 'Figura',  en = 'Figure' }
local LIBELLE_TABLEAU = { fr = 'Tableau', de = 'Tabelle',   it = 'Tabella', en = 'Table' }
-- Libellé de la source dans les crédits, ponctuation comprise : le français exige
-- une espace fine insécable (U+202F) avant le deux-points, pas les trois autres.
local LIBELLE_SOURCE  = { fr = 'Source\u{202F}: ', de = 'Quelle: ',
                          it = 'Fonte: ',          en = 'Source: ' }

-- Séparateur VISIBLE, identique à celui que posait le CSS : cadratin entouré
-- d'espaces. L'espace de tête est porté par un pandoc.Space (donc sécable), celui
-- de queue est collé au cadratin dans le Span du numéro.
local CADRATIN = '\u{2014}'
-- Séparateur entre copyright et source dans un crédit.
local SEP_CREDIT = ' / '

local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function vide(t) return t == nil or t:match('^%s*$') ~= nil end

-- Langue de composition — MÊME règle que szh-maquette.lua (D74) : la revue prime
-- sur `lang:` du numéro. Dupliquée ici (et non importée) parce que ce filtre doit
-- aussi tourner dans la chaîne d'APERÇU, où szh-maquette n'est pas branché : sans
-- cette règle, un numéro « zeitschrift » sans clé `lang:` retomberait sur « Figure »
-- dans l'aperçu et « Abbildung » dans le PDF.
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
-- manquants -> nil (aucun élément produit, pas de ponctuation orpheline).
-- Les valeurs sont reprises TELLES QUELLES : côté figure elles sont du texte brut
-- (pandoc les échappera), côté tableau elles sortent d'un attribut HTML donc déjà
-- échappées — dans les deux cas, les réinjecter verbatim est le comportement juste.
local function texte_credit(copyright, source, lang)
  local bouts = {}
  if not vide(copyright) then bouts[#bouts + 1] = trim(copyright) end
  if not vide(source) then
    bouts[#bouts + 1] = (LIBELLE_SOURCE[lang] or LIBELLE_SOURCE.fr) .. trim(source)
  end
  if #bouts == 0 then return nil end
  return table.concat(bouts, SEP_CREDIT)
end

-- Insère le préfixe en tête du PREMIER bloc de la légende (Plain ou Para) — les
-- blocs suivants d'une légende multi-paragraphes sont laissés intacts. Le préfixe
-- est un Span porteur d'une classe, pour que print.css puisse le graisser comme le
-- faisait ::before ; le texte, lui, reste dans le flux du document.
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

-- Ajoute les crédits à la FIN du DERNIER bloc de la légende, dans le même élément
-- (choix arrêté : « à la suite de la légende, en plus petit » — la mise en forme
-- est dans print.css, .szh-credit).
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

-- ─── Tableaux en HTML brut (D47) ──────────────────────────────────────────────
-- Les tableaux extraits arrivent en RawBlock('html') : opaques à l'AST, on agit
-- donc sur le TEXTE, en mémoire — le fichier tables/table-NN.html n'est ouvert
-- qu'en lecture par szh-tabelle-inclure.lua et n'est jamais réécrit.
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

-- Traite UN bloc HTML de tableau. Renvoie (html, numerote) :
--   * html      = le HTML transformé (jamais nil si le bloc est bien un <table>) ;
--   * numerote  = true si un numéro a été CONSOMMÉ (légende non vide présente).
-- Renvoie nil si le bloc n'est pas un tableau (RawBlock html d'autre nature).
-- ORDRE DES INSERTIONS — il compte, chaque insertion décale ce qui suit :
--   1. la <caption> (numéro en tête, crédits en queue) — tout est APRÈS le '>' du
--      <table …>, donc les indices du tag restent valides ;
--   2. aria-describedby dans le tag <table …>, à l'indice mémorisé en 1 ;
--   3. l'élément de description, ajouté en FIN de bloc (après </table>).
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
    -- Pas de légende mais des crédits : un crédit ne doit JAMAIS se perdre (c'est
    -- une mention de droits). On fabrique une <caption> qui ne porte QUE le crédit
    -- — et qui ne consomme AUCUN numéro, puisque le tableau n'est pas légendé.
    local remplacer = d_ouv ~= nil and d_ferm ~= nil      -- <caption> présente mais VIDE
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

-- ─── Passe unique, dans l'ordre du document ───────────────────────────────────
-- Tout part de Pandoc(doc) : c'est le seul point où l'on est sûr de lire les
-- métadonnées AVANT de parcourir les blocs (dans un filtre ordinaire, Meta est
-- appelé APRÈS les blocs).
function Pandoc(doc)
  local lang = langue_de(doc.meta)
  local mot_figure  = LIBELLE_FIGURE[lang]  or LIBELLE_FIGURE.fr
  local mot_tableau = LIBELLE_TABLEAU[lang] or LIBELLE_TABLEAU.fr
  local n_figure, n_tableau, n_desc = 0, 0, 0

  doc.blocks = doc.blocks:walk({

    -- Image HORS figure (pas de légende) : elle n'est pas numérotée — on la
    -- déclare DÉCORATIVE. alt="" est le signal HTML standard, et role="presentation"
    -- neutralise le role="img" que --embed-resources ajoute d'office à toute image
    -- devenue data: URI : sans lui, le lecteur d'écran annoncerait « image » sans nom
    -- au lieu de passer son chemin. Un alt= explicite NON VIDE, lui, est respecté :
    -- pandoc l'écrit tel quel, l'image est nommée.
    -- ⚠ WeasyPrint 69 ne distingue PAS alt="" d'un alt absent : il écrit dans les
    -- deux cas « Image … has no required alt description » et produit quand même le
    -- PDF/UA-1 (code de sortie 0, aucun repli). Comportement PRÉEXISTANT.
    -- Cette passe des inlines précède celle des blocs ; elle est IDEMPOTENTE avec le
    -- traitement des Figure ci-dessous (les deux aboutissent au même état pour une
    -- image de figure déclarée décorative), l'ordre n'a donc pas d'importance.
    Image = function(img)
      if #img.caption == 0 and vide(img.attributes['alt']) then
        img.attributes['alt'] = ''
        img.attributes['role'] = 'presentation'
        return img
      end
      return nil
    end,

    Figure = function(fig)
      local legende = utils.stringify(fig.caption.long)
      if legende:match('^%s*$') then return nil end   -- sans légende : pas de numéro
      n_figure = n_figure + 1
      local prefixe = mot_figure .. ' ' .. n_figure .. ' ' .. CADRATIN
      fig.caption.long = prefixer(fig.caption.long, prefixe)

      local credit = nil
      fig.content = fig.content:walk({
        Image = function(img)
          -- L'alt se lit à deux endroits selon le lecteur (voir l'en-tête) :
          --   attribut alt=      -> commonmark_x, ou markdown pour une image sans légende ;
          --   description        -> markdown, qui a DÉJÀ résolu alt= (et, à défaut
          --                         d'alt=, y a recopié la légende : c'est le repli).
          local attr_alt = img.attributes['alt']
          local alt = attr_alt or utils.stringify(img.caption)
          if vide(alt) then
            -- alt="" explicite : image décorative.
            img.caption = pandoc.Inlines({})
            img.attributes['alt'] = ''
            img.attributes['role'] = 'presentation'
          elseif attr_alt then
            -- alt= explicite : il devient la description, seule source de l'attribut
            -- alt en sortie (le laisser AUSSI dans les attributs ferait écrire `alt`
            -- deux fois par le writer HTML).
            img.caption = pandoc.Inlines({ pandoc.Str(attr_alt) })
            img.attributes['alt'] = nil
            if img.attributes['role'] == 'presentation' then img.attributes['role'] = nil end
          end
          -- Cas restant (attr_alt == nil, description non vide) : le lecteur markdown
          -- a déjà mis le bon texte dans la description — soit l'alt explicite, soit
          -- la légende en REPLI. On n'y touche pas : réécrire en pandoc.Str
          -- aplatirait la mise en forme (gras, italiques) de la légende.
          -- ⚠ Le numéro « Figure N — » n'est JAMAIS ajouté à l'alt : la légende
          -- n'étant plus masquée, il serait annoncé deux fois. Dans le cas du repli,
          -- l'alt redit donc la légende : c'est le prix de la compatibilité, et le
          -- signal éditorial qu'il faut écrire un vrai alt=.
          credit = credit or texte_credit(img.attributes['copyright'],
                                          img.attributes['source'], lang)
          return img
        end,
      })
      if credit then fig.caption.long = crediter(fig.caption.long, credit) end
      return fig
    end,

    -- Tableau natif pandoc (écrit en markdown avec « : Légende »). Pas de contrat
    -- data-* ici (il n'existe que pour les tableaux extraits D47) : numéro seul.
    Table = function(tbl)
      if utils.stringify(tbl.caption.long):match('^%s*$') then return nil end
      n_tableau = n_tableau + 1
      tbl.caption.long = prefixer(tbl.caption.long,
                                  mot_tableau .. ' ' .. n_tableau .. ' ' .. CADRATIN)
      return tbl
    end,

    -- Tableau extrait (D47), réinjecté en HTML brut par szh-tabelle-inclure.lua.
    RawBlock = function(raw)
      if raw.format ~= 'html' and raw.format ~= 'html5' then return nil end
      local _, _, attrs = raw.text:find(TABLE)
      if not attrs then return nil end

      local alt = attribut(attrs, 'data-alt')
      local credit = texte_credit(attribut(attrs, 'data-copyright'),
                                  attribut(attrs, 'data-source'), lang)
      -- data-alt vide ou absent -> RIEN : ni aria-describedby, ni élément. La
      -- structure du tableau se lit d'elle-même.
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
        -- Description longue : élément masqué VISUELLEMENT (jamais display:none à
        -- l'écran, sinon les lecteurs d'écran l'ignoreraient), placé juste après le
        -- tableau qu'il décrit. print.css le retire en @media print : le PDF n'a
        -- pas d'aria-describedby (WeasyPrint ne le transporte pas), un texte
        -- invisible n'y apporterait qu'un bloc de structure orphelin.
        -- <div> et non <p> : le galley Word (F7) est régénéré depuis CE HTML, et le
        -- lecteur html de pandoc ne conserve les classes que sur les <div>/<span>
        -- (un Para n'a pas d'attributs). C'est cette classe qui permet à
        -- szh-galley-docx.lua de retirer le bloc du .docx, où rien ne le masquerait.
        html = html .. '\n<div class="szh-description" id="' .. id_desc .. '">'
                    .. alt .. '</div>'
      end
      return pandoc.RawBlock(raw.format, html)
    end,
  })

  return doc
end
