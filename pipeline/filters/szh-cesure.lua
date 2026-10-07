-- Deux traitements :
-- 1. en français, protège les noms propres de la césure automatique ;
-- 2. dans toutes les langues, sort la mise en forme (italique, gras…) des liens, pour la
--    conformité PDF/UA.
--
-- ── Noms propres ─────────────────────────────────────────────────────────────────────────
-- Le corps est justifié avec `hyphens: auto` (print.css), et WeasyPrint coupe aussi les
-- noms propres (« Fri-bourg »), ce que la typographie française proscrit. Le filtre
-- enveloppe chaque nom propre reconnu dans un <span class="szh-sans-cesure">, en
-- `hyphens: manual` (styles/partage-filtres.css). Une césure écrite à la main (U+00AD) et
-- la coupure à un trait d'union déjà présent (« Cudré-Mauroux ») restent possibles.
--
-- Français seulement : en allemand, tous les substantifs prennent la majuscule, et la
-- reconnaissance éteindrait la césure de la moitié du texte. L'italien n'est pas traité.
--
-- Reconnaissance, sans lexique, d'après la position de la majuscule :
-- - relevé : un mot qui commence par une majuscule et compte au moins 5 lettres est un nom
--   propre s'il n'ouvre pas une phrase, ou s'il l'ouvre mais est suivi d'un autre mot à
--   majuscule (« Christian Singele a 35 ans ») ;
-- - application : tout mot relevé est protégé partout dans l'article, y compris en tête
--   de phrase.
-- 5 lettres : WeasyPrint ne coupe pas un mot plus court (`hyphenate-limit-chars` vaut
-- (5, 2, 2) par défaut).
--
-- Limites : un nom propre qui n'apparaît qu'en tête de phrase, suivi d'une minuscule,
-- n'est pas reconnu ; un mot ordinaire en tête de citation au milieu d'une phrase
-- (« comme il dit : Depuis 2021 ») peut l'être et ne plus se couper. Le texte n'est
-- jamais modifié.
--
-- Hors de portée : les tableaux réinjectés, les figures dissoutes et les grilles, qui sont
-- des RawBlock html à ce stade. Les titres ne sont pas relevés : szh-sections.lua y a
-- écrit le numéro de section, et le premier mot du titre passerait pour un nom au milieu
-- d'une phrase. Ils restent enveloppés si le nom est relevé ailleurs (sans effet : ils
-- sont déjà en `hyphens: manual`).
--
-- Place dans la chaîne : après szh-rubrique.lua (le contenu des rubriques de la
-- Documentation est protégé aussi) et après szh-citations.lua, qui apparie les appels sur
-- le texte et qu'un <span> gênerait. Avant szh-notes.lua, pour que le texte des notes, encore
-- des Note pandoc, soit protégé.

local utils = pandoc.utils

-- Module commun, qui donne la langue. Sans lui, la compilation s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[cesure] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

-- ── Classes de caractères ───────────────────────────────────────────────────────────────
-- Points de code en clair, couvrant le français, l'allemand et l'italien. × (U+00D7) et
-- ÷ (U+00F7) sont au milieu des lettres du bloc Latin-1 et sont exclus.
local function est_majuscule(cp)
  if cp >= 0x41 and cp <= 0x5A then return true end                    -- A–Z
  if cp >= 0xC0 and cp <= 0xDE and cp ~= 0xD7 then return true end     -- À–Þ sauf ×
  if cp == 0x152 or cp == 0x178 then return true end                   -- Œ, Ÿ
  return false
end

local function est_minuscule(cp)
  if cp >= 0x61 and cp <= 0x7A then return true end                    -- a–z
  if cp >= 0xDF and cp <= 0xFF and cp ~= 0xF7 then return true end     -- ß–ÿ sauf ÷
  if cp == 0x153 then return true end                                  -- œ
  return false
end

local function est_lettre(cp)
  return est_majuscule(cp) or est_minuscule(cp)
end

-- Caractères d'un mot : lettres, chiffres et trait d'union, pour que « Cudré-Mauroux » ou
-- « COVID-19 » soient protégés en entier. L'apostrophe sépare : dans « l'Argentine »,
-- le mot est « Argentine ».
local function est_du_mot(cp)
  return est_lettre(cp) or (cp >= 0x30 and cp <= 0x39) or cp == 0x2D
end

-- Signes qui ferment une phrase. Les deux-points en font partie : une majuscule après eux
-- ouvre presque toujours une citation.
local FIN_DE_PHRASE = { [0x2E] = true, [0x21] = true, [0x3F] = true,   -- . ! ?
                        [0x2026] = true, [0x3A] = true }               -- … :

-- Découpe une chaîne en segments alternés { texte = …, mot = true|false }. Leur
-- concaténation rend exactement la chaîne : l'application ne change donc pas le texte.
local function segments(s)
  local sortie = {}
  local debut, dans_mot = 1, nil
  for pos, cp in utf8.codes(s) do
    local ici = est_du_mot(cp)
    if dans_mot == nil then
      dans_mot = ici
    elseif ici ~= dans_mot then
      table.insert(sortie, { texte = s:sub(debut, pos - 1), mot = dans_mot })
      debut, dans_mot = pos, ici
    end
  end
  if dans_mot ~= nil then
    table.insert(sortie, { texte = s:sub(debut), mot = dans_mot })
  end
  return sortie
end

-- Un mot candidat : une majuscule initiale et au moins 5 lettres (chiffres et traits
-- d'union non comptés).
local function candidat(mot)
  local premier = utf8.codepoint(mot, 1)
  if not est_majuscule(premier) then return false end
  local lettres = 0
  for _, cp in utf8.codes(mot) do
    if est_lettre(cp) then lettres = lettres + 1 end
  end
  return lettres >= 5
end

local function commence_par_majuscule(mot)
  return est_majuscule(utf8.codepoint(mot, 1))
end

-- ── Relevé, sur le texte à plat de chaque bloc ──────────────────────────────────────────
-- Le texte aplati par utils.stringify se lit dans l'ordre, à travers italiques, liens et
-- guillemets, sans suivre l'état de la phrase à chaque niveau d'imbrication.
local function relever(bloc, noms)
  local texte = utils.stringify(bloc)
  if texte == '' then return end

  -- Les mots du bloc, dans l'ordre, et s'ils ouvrent une phrase.
  local mots = {}
  local debut_de_phrase = true          -- le premier mot d'un bloc ouvre une phrase
  for _, seg in ipairs(segments(texte)) do
    if seg.mot then
      table.insert(mots, { texte = seg.texte, ouvre = debut_de_phrase })
      debut_de_phrase = false
    else
      for _, cp in utf8.codes(seg.texte) do
        if FIN_DE_PHRASE[cp] then debut_de_phrase = true end
      end
    end
  end

  for i, m in ipairs(mots) do
    if candidat(m.texte) then
      if not m.ouvre then
        noms[m.texte] = true
      else
        -- Deux majuscules de suite en tête de phrase : un nom de personne. Le second mot
        -- est relevé à l'itération suivante.
        local suivant = mots[i + 1]
        if suivant and commence_par_majuscule(suivant.texte) then
          noms[m.texte] = true
        end
      end
    end
  end
end

-- ── Application, sur les Str ────────────────────────────────────────────────────────────
local function proteger(noms)
  return {
    Str = function(el)
      local texte = el.text
      -- Chemin rapide : un Str sans majuscule (la grande majorité) ne porte aucun nom.
      local a_majuscule = false
      for _, cp in utf8.codes(texte) do
        if est_majuscule(cp) then a_majuscule = true; break end
      end
      if not a_majuscule then return nil end

      local segs = segments(texte)
      local touche = false
      for _, seg in ipairs(segs) do
        if seg.mot and noms[seg.texte] then touche = true; break end
      end
      if not touche then return nil end

      local sortie = pandoc.Inlines({})
      for _, seg in ipairs(segs) do
        if seg.mot and noms[seg.texte] then
          sortie:insert(pandoc.Span(pandoc.Inlines({ pandoc.Str(seg.texte) }),
            pandoc.Attr('', { 'szh-sans-cesure' }, {})))
        else
          sortie:insert(pandoc.Str(seg.texte))
        end
      end
      return sortie
    end,

    -- Pas de span dans un <a> (PDF/UA-1 7.18.5) : WeasyPrint pose une annotation de lien
    -- par boîte descendante du <a> et n'en rattache qu'une au /Link de la structure, ce
    -- que veraPDF refuse. Les spans du lien sont donc défaits (pandoc a déjà filtré le
    -- contenu du Link) et la classe va sur le lien lui-même. Tout le texte du lien cesse
    -- alors de se couper, ce qui convient aux noms d'institution qu'on y trouve.
    Link = function(el)
      local defait = false
      el.content = el.content:walk({
        Span = function(sp)
          for _, c in ipairs(sp.classes) do
            if c == 'szh-sans-cesure' then defait = true; return sp.content end
          end
          return nil
        end,
      })
      if not defait then return nil end
      el.classes:insert('szh-sans-cesure')
      return el
    end,
  }
end

-- ── Mise en forme hors des liens, toutes langues ────────────────────────────────────────
-- `[*Texte du* lien](…)` donne <a><em>Texte du</em> lien</a>. WeasyPrint pose alors une
-- annotation de lien pour le <em> et la range sous /NonStruct au lieu de /Link : veraPDF
-- refuse (PDF/UA-1 7.18.5). Même chose pour <strong>, <u>, etc. WeasyPrint ne connaît pas
-- `display: contents`, qui aurait évité de toucher au HTML.
-- La mise en forme passe donc autour de liens qui ne contiennent que du texte :
--   <em><a>Texte du</a></em><a> lien</a>
-- Le rendu est identique au pixel. Un lien mis en forme en partie devient plusieurs liens
-- voisins vers la même cible, comme WeasyPrint le fait déjà d'un lien coupé en fin de
-- ligne. Un segment fait seulement de blancs rejoint le lien voisin (seul, il serait lu
-- comme un lien vide). L'identifiant ne va qu'au premier segment ; classes, cible et titre
-- vont à tous.
-- Restent dans le lien, faute de pouvoir le contenir : Code, Image, Math, Note, RawInline.
local CONTENANTS = {
  Emph = true, Strong = true, Underline = true, Strikeout = true, SmallCaps = true,
  Superscript = true, Subscript = true, Span = true,
}
local BLANCS = { Space = true, SoftBreak = true, LineBreak = true }

local function hisser_hors_des_liens(lien)
  -- Un lien `.qr` est remplacé entier par un QR (szh-qr.lua, livres, plus loin) : scindé,
  -- il donnerait un QR par segment.
  for _, c in ipairs(lien.classes) do
    if c == 'qr' then return nil end
  end
  local a_hisser = false
  for _, x in ipairs(lien.content) do
    if CONTENANTS[x.t] then a_hisser = true; break end
  end
  if not a_hisser then return nil end

  local premier = true
  local function segment(contenu)
    local attributs = {}
    for k, v in pairs(lien.attributes) do attributs[k] = v end
    local attr = pandoc.Attr(premier and lien.identifier or '', pandoc.List(lien.classes), attributs)
    premier = false
    return pandoc.Link(contenu, lien.target, lien.title, attr)
  end
  local function tout_blanc(contenu)
    for _, x in ipairs(contenu) do
      if not BLANCS[x.t] then return false end
    end
    return true
  end
  -- Le lien le plus profond au bout d'un contenant déjà traité, où une espace voisine se
  -- range.
  local function lien_au_bout(x, depuis_la_fin)
    while x do
      if x.t == 'Link' then return x end
      if not CONTENANTS[x.t] or #x.content == 0 then return nil end
      x = x.content[depuis_la_fin and #x.content or 1]
    end
    return nil
  end
  local function hisser(inlines)
    local sortie = pandoc.Inlines({})
    local tampon = pandoc.Inlines({})
    local en_attente = nil                   -- des blancs à glisser dans le lien suivant
    -- Une espace seule entre deux mises en forme (« ***Texte*** *du* ») rejoint le lien qui
    -- la précède, ou sinon celui qui la suit. Hors lien, elle couperait le soulignement du
    -- lien ; seule dans un lien, elle serait lue comme un lien vide.
    local function vider()
      if #tampon == 0 then return end
      if tout_blanc(tampon) then
        local prec = #sortie > 0 and lien_au_bout(sortie[#sortie], true) or nil
        if prec then
          local c = prec.content; c:extend(tampon); prec.content = c
        else
          en_attente = tampon
        end
      else
        sortie:insert(segment(tampon))
      end
      tampon = pandoc.Inlines({})
    end
    for _, x in ipairs(inlines) do
      if CONTENANTS[x.t] then
        vider()
        x.content = hisser(x.content)
        if en_attente then
          local suiv = lien_au_bout(x, false)
          if suiv then
            local c = pandoc.Inlines({}); c:extend(en_attente); c:extend(suiv.content)
            suiv.content = c
          else
            sortie:extend(en_attente)
          end
          en_attente = nil
        end
        sortie:insert(x)
      else
        tampon:insert(x)
      end
    end
    vider()
    if en_attente then sortie:extend(en_attente) end
    return sortie
  end
  return hisser(lien.content)
end

local function Pandoc(doc)
  if commun.contexte(doc.meta).lang ~= 'fr' then return doc end

  local noms = {}
  -- Seuls les blocs qui portent directement des inlines sont relevés. Aplatir un
  -- conteneur (Div, liste…) collerait le dernier mot d'un paragraphe au premier du
  -- suivant : utils.stringify ne met pas de séparateur entre deux blocs.
  local FEUILLES = { Para = true, Plain = true, LineBlock = true }   -- titres exclus : voir l'en-tête
  doc.blocks:walk({
    Block = function(bloc)
      if FEUILLES[bloc.t] then relever(bloc, noms) end
      return nil
    end,
  })
  if next(noms) == nil then return doc end

  doc.blocks = doc.blocks:walk(proteger(noms))
  return doc
end

-- La césure d'abord, qui pose sa classe sur le lien ; puis la mise en forme hors des liens,
-- dont chaque segment hérite de cette classe.
return {
  { Pandoc = Pandoc },
  { Link = hisser_hors_des_liens },
}
