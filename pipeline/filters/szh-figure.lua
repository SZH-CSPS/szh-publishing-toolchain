-- szh-figure.lua — compilation COMMUNE aux deux lecteurs (AX5).
-- Objectif : un rendu <figure><figcaption> IDENTIQUE quel que soit le lecteur.
--   * lecteur `markdown` (sortie PDF/HTML) : `![lég](img)` devient DÉJÀ une Figure
--     (extension implicit_figures) -> ce filtre n'y touche pas.
--   * lecteur `commonmark_x` (aperçu) : `![lég](img)` reste un Para{Image} SANS
--     figure -> ce filtre le convertit en Figure identique à celle du lecteur
--     markdown, pour que HTML/aperçu/PDF rendent la même chose.
-- Le <caption> des tableaux est du HTML brut (inclus par szh-tabelle-inclure.lua) :
-- il traverse les deux lecteurs à l'identique, rien à faire ici.
-- Idempotent : une image sans légende (alt vide) reste une image inline.

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
