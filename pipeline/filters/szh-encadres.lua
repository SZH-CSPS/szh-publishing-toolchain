-- Pose le titre des encadrés d'un article dans le texte : un paragraphe de classe
-- szh-encadre-titre en tête du bloc, lu par un lecteur d'écran et balisé /P dans le PDF.
--
--   ::: {.important}                       titre « Information », ou data-titre
--   ::: {.question data-titre="…"}         titre data-titre ; sans lui, pas de titre
--
-- print.css compose celui de .important en petites capitales espacées, et masque
-- visuellement celui de .question, qui reste lu. Article seulement : les feuilles du
-- livre ne mettent pas ces encadrés en forme. Passe avant szh-typographie.lua, qui traite
-- le titre comme le reste du texte.

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[encadres] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local CLASSE_TITRE = 'szh-encadre-titre'
-- Titre d'un encadré .important sans data-titre.
local TITRE_IMPORTANT = 'Information'

local function titre_de(d)
  local donne = commun.trim(d.attributes['data-titre'] or '')
  if commun.a_classe(d, 'important') then
    return donne ~= '' and donne or TITRE_IMPORTANT
  end
  if commun.a_classe(d, 'question') then
    return donne ~= '' and donne or nil
  end
  return nil
end

-- Le titre en Str et Space, comme le reste du texte, pour la typographie et la césure.
local function mots(texte)
  local inl = pandoc.Inlines({})
  for mot in texte:gmatch('%S+') do
    if #inl > 0 then inl:insert(pandoc.Space()) end
    inl:insert(pandoc.Str(mot))
  end
  return inl
end

function Pandoc(doc)
  if commun.contexte(doc.meta).produit == 'livre' then return nil end
  doc.blocks = doc.blocks:walk({
    Div = function(d)
      local titre = titre_de(d)
      if not titre then return nil end
      -- <p> et </p> en HTML brut : pandoc ne garde de classe que sur div et span.
      local inl = pandoc.Inlines({ pandoc.RawInline('html', '<p class="' .. CLASSE_TITRE .. '">') })
      inl:extend(mots(titre))
      inl:insert(pandoc.RawInline('html', '</p>'))
      d.content:insert(1, pandoc.Plain(inl))
      return d
    end,
  })
  return doc
end
