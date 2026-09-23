-- szh-styles-corps.lua — premier filtre de l'import : les paragraphes que
-- docx-styles-corps.py a marqués deviennent les blocs du cockpit (palette « Blocs »),
-- au lieu de se perdre en paragraphes nus.
--
--   SZH Important                     -> ::: {.important}
--   SZH Hervorhebung                  -> ::: {.highlight}
--   SZH Question (interview)          -> ::: {.question}
--   Auhors / Authors / Auteurs / …    -> ::: {.szh-auteurs}  (livre seulement, voir
--                                        docx-styles-corps.py, STYLES_AUTEURS_CHAPITRE)
--
-- Le marqueur (zone privée d'Unicode, U+E000 classe U+E001) ouvre le premier Str du
-- paragraphe. Il est retiré ici, avant tout autre filtre : les suivants voient le texte
-- exact qu'ils voyaient sans ce pré-pass. Deux paragraphes consécutifs du même style
-- forment un seul bloc, comme dans Word — sauf szh-auteurs (voir FUSIONNABLES) : une ligne
-- d'auteur·e·s est UN paragraphe, jamais plusieurs.
--
-- « Quote » (Citation) n'est pas dans la liste : pandoc en fait déjà un BlockQuote.

local DEBUT, FIN = '\u{E000}', '\u{E001}'
local CLASSES = { important = true, highlight = true, question = true, ['szh-auteurs'] = true }

-- Classes qui ont le droit d'avaler le paragraphe stylé suivant dans le MÊME bloc.
-- szh-auteurs en est exclu à dessein : constaté sur redf_Lerngeschichten_clean.docx (le
-- premier paragraphe de corps d'un chapitre gardait par mégarde le style « Auhors » du
-- Word) qu'une fusion aurait avalé tout ce paragraphe DANS la ligne d'auteur·e·s — un
-- défaut invisible à l'import, qui n'apparaîtrait qu'à la relecture du livre composé. Deux
-- paragraphes « Auhors » consécutifs donnent donc deux blocs .szh-auteurs distincts : une
-- anomalie visible (et donc corrigible), jamais un paragraphe de récit disparu en silence.
local FUSIONNABLES = { important = true, highlight = true, question = true }

-- La classe marquée en tête de ce bloc, et le bloc sans son marqueur ; nil sinon.
-- [%l%-]+ et non %l+ : « szh-auteurs » porte un tiret, les trois autres classes non — le
-- jeu de caractères élargi ne change donc rien pour elles.
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
