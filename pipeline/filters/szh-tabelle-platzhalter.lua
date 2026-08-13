-- szh-tabelle-platzhalter.lua — import simplifié (D35).
-- Remplace CHAQUE tableau par un placeholder « {{TABELLE NN}} » en gras.
--   NN = numéro séquentiel par document, sur 2 chiffres (01, 02, … 10, 11).
-- C'est un rappel manuel : le tableau est à réinsérer à la main (la gestion des
-- tableaux sera re-décidée plus tard — PLAN-COCKPIT.md §7). Le gras le rend visible
-- dans le PDF final.
--
-- La numérotation suit l'ordre du document : les filtres pandoc parcourent l'AST
-- en profondeur, dans l'ordre des blocs.

local compteur = 0

function Table(_)
  compteur = compteur + 1
  local etiquette = string.format('{{TABELLE %02d}}', compteur)
  return pandoc.Para({ pandoc.Strong({ pandoc.Str(etiquette) }) })
end
