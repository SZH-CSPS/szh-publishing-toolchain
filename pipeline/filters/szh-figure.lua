-- Construit les Figure que le lecteur `commonmark_x` de l'aperçu ne fait pas : il rend
-- `![lég](img)` en Para{Image}, là où le lecteur `markdown` (PDF et HTML) produit déjà
-- une Figure via l'extension implicit_figures. Les deux chaînes rendent ainsi le même
-- <figure><figcaption>. Idempotent : une image sans légende reste une image inline.
-- szh-numerotation.lua, branché après, a besoin des Figure construites ici.

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
