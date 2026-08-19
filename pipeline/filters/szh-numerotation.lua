-- szh-numerotation.lua — numérotation ACCESSIBLE des figures et des tableaux.
--
-- Remplace la numérotation purement CSS de D31 (`figcaption::before` /
-- `caption::before` + compteurs) : un numéro produit par `content:` n'existe que
-- dans le rendu visuel, jamais dans le texte accessible. Un lecteur d'écran ne
-- pouvait donc pas relier « voir figure 5 » à l'image correspondante.
--
-- Ici la numérotation est calculée À LA COMPILATION, en Lua, et écrite dans le
-- TEXTE : une seule source de vérité pour le numéro visible, pour l'alt et pour
-- l'aria-label — ils ne peuvent plus diverger.
--
-- Figures  : alt = aria-label = texte de la <figcaption> = « Figure N — Légende »
--            (chaîne strictement identique aux trois endroits ; c'est ce qui fait
--            que le writer HTML de pandoc repose aria-hidden="true" sur la
--            <figcaption>, évitant la double annonce légende + alt).
-- Tableaux : texte de la <caption> = « Tableau N — Légende ». Aucun alt ni ARIA
--            ajouté (demande explicite : un tableau se lit par sa structure).
--
-- Les deux compteurs sont INDÉPENDANTS (figures 1..n, tableaux 1..m).
-- Sans légende -> aucun numéro consommé : « Tableau 3 » désigne le 3ᵉ tableau
-- LÉGENDÉ, seul numéro auquel un renvoi éditorial puisse se raccrocher.
--
-- Doit tourner APRÈS szh-tabelle-inclure.lua (les tableaux D47 n'existent qu'une
-- fois réinjectés) et APRÈS szh-figure.lua (le lecteur commonmark_x ne fabrique
-- les Figure que là) — voir l'ordre des --lua-filter dans le Makefile.

local utils = pandoc.utils

-- Libellés localisés. `en` reprend l'ancien :lang(en) du CSS ; `it` complète les
-- trois langues de la revue.
local LIBELLE_FIGURE  = { fr = 'Figure',  de = 'Abbildung', it = 'Figura',  en = 'Figure' }
local LIBELLE_TABLEAU = { fr = 'Tableau', de = 'Tabelle',   it = 'Tabella', en = 'Table' }

-- Séparateur VISIBLE, identique à celui que posait le CSS : cadratin entouré
-- d'espaces. L'espace de tête est porté par un pandoc.Space (donc sécable), celui
-- de queue est collé au cadratin dans le Span du numéro.
local CADRATIN = '\u{2014}'

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

-- ─── Tableaux en HTML brut (D47) ──────────────────────────────────────────────
-- Les tableaux extraits arrivent en RawBlock('html') : opaques à l'AST, on agit
-- donc sur le texte. Contrat de forme (produit par docx-tables.py, attendu de
-- l'éditeur de tableau du cockpit) : un <caption> en tête du <table>, absent si le
-- tableau n'a pas de légende. Seule la PREMIÈRE <caption> du bloc est numérotée
-- (un fichier tables/table-NN.html = un tableau).
-- Patterns insensibles à la casse écrits à la main (Lua n'a pas d'option /i).
local OUVRANTE = '<[cC][aA][pP][tT][iI][oO][nN][^>]*>'
local FERMANTE = '</[cC][aA][pP][tT][iI][oO][nN]%s*>'

-- Retourne le HTML numéroté, ou nil si le bloc ne porte pas de légende exploitable
-- (pas de <caption>, <caption> non fermée, ou <caption> vide) -> aucun numéro
-- consommé.
local function numeroter_html(html, prefixe)
  local _, fin = html:find(OUVRANTE)
  if not fin then return nil end
  local ferm = html:find(FERMANTE, fin + 1)
  if not ferm then return nil end
  if html:sub(fin + 1, ferm - 1):match('^%s*$') then return nil end
  return html:sub(1, fin)
      .. '<span class="szh-numero">' .. prefixe .. '</span> '
      .. html:sub(fin + 1)
end

-- ─── Passe unique, dans l'ordre du document ───────────────────────────────────
-- Tout part de Pandoc(doc) : c'est le seul point où l'on est sûr de lire les
-- métadonnées AVANT de parcourir les blocs (dans un filtre ordinaire, Meta est
-- appelé APRÈS les blocs).
function Pandoc(doc)
  local lang = langue_de(doc.meta)
  local mot_figure  = LIBELLE_FIGURE[lang]  or LIBELLE_FIGURE.fr
  local mot_tableau = LIBELLE_TABLEAU[lang] or LIBELLE_TABLEAU.fr
  local n_figure, n_tableau = 0, 0

  doc.blocks = doc.blocks:walk({

    -- Image SANS légende : elle n'est pas une figure numérotée (voir Figure plus
    -- bas) — on la déclare DÉCORATIVE. alt="" est le signal HTML standard, et
    -- role="presentation" est là pour neutraliser le role="img" que
    -- --embed-resources ajoute d'office à toute image devenue data: URI : sans lui,
    -- le lecteur d'écran annoncerait « image » sans nom au lieu de passer son chemin.
    -- ⚠ WeasyPrint 69 ne distingue PAS alt="" d'un alt absent : il écrit dans les
    -- deux cas « Image … has no required alt description » et produit quand même le
    -- PDF/UA-1 (code de sortie 0, aucun repli). Comportement PRÉEXISTANT, non aggravé
    -- ici. La vraie correction est éditoriale : légender l'image.
    -- Passe des inlines : elle précède celle des blocs, donc les images légendées
    -- (caption non vide) ne sont pas touchées ici — la Figure s'en charge.
    Image = function(img)
      if #img.caption == 0 and img.attributes['alt'] == nil then
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
      -- Texte accessible = EXACTEMENT le texte visible de la figcaption.
      local accessible = prefixe .. ' ' .. legende
      fig.caption.long = prefixer(fig.caption.long, prefixe)
      fig.content = fig.content:walk({
        Image = function(img)
          -- L'alt du writer HTML vient de la légende d'AST de l'image : on la
          -- remplace par le texte accessible complet, et on retire un éventuel
          -- attribut alt concurrent (sinon pandoc écrirait deux fois `alt`).
          img.caption = pandoc.Inlines({ pandoc.Str(accessible) })
          img.attributes['alt'] = nil
          img.attributes['aria-label'] = accessible
          return img
        end,
      })
      return fig
    end,

    -- Tableau natif pandoc (écrit en markdown avec « : Légende »).
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
      local prefixe = mot_tableau .. ' ' .. (n_tableau + 1) .. ' ' .. CADRATIN
      local numerote = numeroter_html(raw.text, prefixe)
      if not numerote then return nil end
      n_tableau = n_tableau + 1
      return pandoc.RawBlock(raw.format, numerote)
    end,
  })

  return doc
end
