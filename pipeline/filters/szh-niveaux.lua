-- Normalise les niveaux de titre du corps, pour le rendu HTML et PDF (RGAA 9.1) : le
-- <h1> du document est le titre de l'article (couverture), le corps commence donc à
-- <h2>. Le niveau minimal présent devient 2, les autres suivent du même delta ; borne
-- à 6, parce que pandoc dégraderait un niveau 7 en <p class="heading">, sans sémantique
-- de titre. Dans le .md, « # » reste la section de premier niveau.
-- À garder aligné avec print.css, qui numérote et style h2–h6 en miroir.

local MIN_CIBLE = 2

function Pandoc(doc)
  local plus_petit = nil
  doc:walk({
    Header = function(h)
      if plus_petit == nil or h.level < plus_petit then plus_petit = h.level end
    end,
  })
  if plus_petit == nil then return doc end   -- aucun titre dans le corps
  local delta = MIN_CIBLE - plus_petit
  return doc:walk({
    Header = function(h)
      h.level = math.min(math.max(h.level + delta, MIN_CIBLE), 6)
      return h
    end,
  })
end
