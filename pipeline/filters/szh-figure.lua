-- Aperçu : construit les Figure que le lecteur `commonmark_x` ne fait pas. Il rend
-- `![lég](img)` en Para{Image}, alors que le lecteur `markdown` (PDF et HTML) en fait une
-- Figure (extension implicit_figures). Une image sans légende reste une image en ligne.
-- S'exécute avant szh-numerotation.lua, qui a besoin de ces Figure.

local function image_seule(inls)
  local img = nil
  for _, i in ipairs(inls) do
    if i.t == 'Image' then
      if img then return nil end
      img = i
    elseif i.t ~= 'Space' and i.t ~= 'SoftBreak' then
      return nil
    end
  end
  return img
end

function Para(p)
  local img = image_seule(p.content)
  if not img or #img.caption == 0 then return nil end
  return pandoc.Figure(
    pandoc.Blocks({ pandoc.Plain({ img }) }),
    { long = pandoc.Blocks({ pandoc.Plain(pandoc.Inlines(img.caption)) }) }
  )
end
