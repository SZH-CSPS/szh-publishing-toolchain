-- Rend la mise en évidence (::: {.highlight}, alias .hervorhebung) muette pour un lecteur
-- d'écran dans le HTML publié : elle répète un passage du texte.
--
-- aria-hidden="true" sur le bloc, et tabindex="-1" sur ses liens : un lien atteignable au
-- clavier dans un bloc masqué est un défaut d'accessibilité. Le lien n'est pas retiré, car
-- il perdrait sa couleur et son soulignement dans le PDF.
--
-- WeasyPrint ignore aria-hidden : dans le PDF, l'exergue reste lue.
--
-- Absent de la chaîne de l'aperçu : la personne qui relit son article avec un lecteur
-- d'écran doit y entendre l'exergue.

local CLASSES = { highlight = true, hervorhebung = true }

local function est_exergue(d)
  for _, c in ipairs(d.classes) do
    if CLASSES[c] then return true end
  end
  return false
end

function Div(d)
  if not est_exergue(d) then return nil end
  d.attributes['aria-hidden'] = 'true'
  return d:walk({ Link = function(l)
    l.attributes['tabindex'] = '-1'
    return l
  end })
end
