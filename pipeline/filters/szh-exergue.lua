-- szh-exergue.lua — la mise en évidence (::: {.highlight}, alias .hervorhebung) est muette
-- pour un lecteur d'écran dans le HTML publié : c'est une exergue, elle RÉPÈTE un passage
-- du texte, et l'entendre deux fois n'apprend rien (décision de Robin, 23.09.2026).
--
-- aria-hidden="true" sur le bloc, et tabindex="-1" sur ses liens : un bloc masqué dont un
-- lien reste atteignable au clavier est un défaut d'accessibilité à lui seul. Le lien
-- n'est pas retiré : il se verrait dans le PDF, où il cesserait d'être bleu et souligné
-- (mesuré). Le lien lui-même existe déjà dans le passage que l'exergue reprend.
--
-- Le PDF n'en est pas changé : WeasyPrint ignore aria-hidden (mesuré sous 70, avec
-- role="presentation" et le contenu généré ::before), et l'exergue y reste lue — accepté.
--
-- Absent de la chaîne de l'aperçu, volontairement : l'aperçu sert à RELIRE son article, et
-- une rédactrice aveugle doit y entendre l'exergue qu'elle a posée — même raison que
-- l'encadré de szh-apercu-lecteur-ecran.lua, qui n'est pas aria-hidden non plus.

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
