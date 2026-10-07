-- Premier filtre de l'import : les paragraphes que docx-styles-corps.py a marqués
-- deviennent les blocs du cockpit (palette « Blocs »).
--
--   SZH Important                     -> ::: {.important}
--   SZH Hervorhebung                  -> ::: {.highlight}
--   SZH Question (interview)          -> ::: {.question}
--   Auhors / Authors / Auteurs / …    -> ::: {.szh-auteurs}  (livre seulement, voir
--                                        docx-styles-corps.py, STYLES_AUTEURS_CHAPITRE)
--
-- Le marqueur (U+E000 classe U+E001, zone privée d'Unicode) ouvre le premier Str du
-- paragraphe. Il est retiré ici, avant tout autre filtre. Des paragraphes consécutifs du
-- même style forment un seul bloc, sauf pour szh-auteurs (voir FUSIONNABLES).
--
-- Le style « Quote » n'est pas traité : pandoc en fait déjà un BlockQuote.

local DEBUT, FIN = '\u{E000}', '\u{E001}'
local CLASSES = { important = true, highlight = true, question = true, ['szh-auteurs'] = true }

-- Classes dont deux paragraphes consécutifs fusionnent en un bloc. szh-auteurs en est
-- exclu : un paragraphe de corps qui a gardé par erreur le style « Auhors » serait avalé
-- dans la ligne d'auteur·e·s sans que rien ne se voie. Deux blocs .szh-auteurs distincts,
-- eux, se remarquent à la relecture.
local FUSIONNABLES = { important = true, highlight = true, question = true }

-- Rend la classe marquée en tête du bloc et le bloc sans son marqueur, ou nil.
-- [%l%-]+ : « szh-auteurs » porte un tiret.
local function demarquer(b)
  if b.t ~= 'Para' and b.t ~= 'Plain' then return nil end
  local premier = b.content[1]
  if not premier or premier.t ~= 'Str' then return nil end
  local classe, reste = premier.text:match('^' .. DEBUT .. '([%l%-]+)' .. FIN .. '(.*)$')
  if not classe or not CLASSES[classe] then return nil end
  if reste == '' then
    b.content:remove(1)
    if b.content[1] and b.content[1].t == 'Space' then b.content:remove(1) end
  else
    premier.text = reste
  end
  return classe, b
end

local function vide(b)
  return #b.content == 0
end

function Blocks(blocs)
  local sortie, courant = pandoc.Blocks{}, nil
  for _, b in ipairs(blocs) do
    local classe, net = demarquer(b)
    if not classe then
      courant = nil
      sortie:insert(b)
    elseif vide(net) then
      -- Paragraphe stylé mais vide : Word en laisse souvent un, pandoc l'aurait écarté.
    elseif courant and courant.classes[1] == classe and FUSIONNABLES[classe] then
      courant.content:insert(pandoc.Para(net.content))
    else
      courant = pandoc.Div({ pandoc.Para(net.content) }, pandoc.Attr('', { classe }))
      sortie:insert(courant)
    end
  end
  return sortie
end
