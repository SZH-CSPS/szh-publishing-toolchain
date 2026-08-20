-- szh-niveaux.lua — rendu HTML/PDF uniquement (D110, RGAA 9.1). Le <h1> du document
-- est le TITRE DE L'ARTICLE (h1.szh-title de la couverture, template szh-article.html) ;
-- les titres du CORPS commencent donc à <h2>. Dans le .md, la convention éditoriale
-- reste inchangée : « # » = section de premier niveau (Ctrl+Alt+1 du cockpit,
-- Überschrift 1 à l'import Word) — le décalage n'existe qu'au rendu.
--
-- NORMALISATION plutôt que décalage aveugle (--shift-heading-level-by) :
--   * le niveau minimal PRÉSENT dans le corps devient 2, les autres suivent du même
--     delta — un article dont l'auteur n'a écrit que des « ## » (Word stylé
--     uniquement en Überschrift 2, mode mixte de docx-titres.py) rend h2, pas h3 :
--     jamais de saut h1 -> h3 dans la hiérarchie ;
--   * borne à 6 : HTML s'arrête à <h6> et pandoc dégraderait un niveau 7 en
--     <p class="heading"> (sémantique de titre PERDUE pour les lecteurs d'écran).
--
-- ⚠ print.css (§6) numérote/style h2–h6 en miroir de ce filtre : toute modification
-- ici doit y être répercutée.

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
