-- szh-styles-corps.lua — premier filtre de l'import : les paragraphes que
-- docx-styles-corps.py a marqués deviennent les blocs du cockpit (palette « Blocs »),
-- au lieu de se perdre en paragraphes nus.
--
--   SZH Important            -> ::: {.important}
--   SZH Hervorhebung         -> ::: {.highlight}
--   SZH Question (interview) -> ::: {.question}
--
-- Le marqueur (zone privée d'Unicode, U+E000 classe U+E001) ouvre le premier Str du
-- paragraphe. Il est retiré ici, avant tout autre filtre : les suivants voient le texte
-- exact qu'ils voyaient sans ce pré-pass. Deux paragraphes consécutifs du même style
-- forment un seul bloc, comme dans Word.
--
-- « Quote » (Citation) n'est pas dans la liste : pandoc en fait déjà un BlockQuote.

local DEBUT, FIN = '\u{E000}', '\u{E001}'
local CLASSES = { important = true, highlight = true, question = true }

-- La classe marquée en tête de ce bloc, et le bloc sans son marqueur ; nil sinon.
local function demarquer(b)
  if b.t ~= 'Para' and b.t ~= 'Plain' then return nil end
  local premier = b.content[1]
  if not premier or premier.t ~= 'Str' then return nil end
  local classe, reste = premier.text:match('^' .. DEBUT .. '(%l+)' .. FIN .. '(.*)$')
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
    elseif courant and courant.classes[1] == classe then
      courant.content:insert(pandoc.Para(net.content))
    else
      courant = pandoc.Div({ pandoc.Para(net.content) }, pandoc.Attr('', { classe }))
      sortie:insert(courant)
    end
  end
  return sortie
end
