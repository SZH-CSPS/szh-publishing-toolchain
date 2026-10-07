-- Enveloppe chaque tableau dans un <div class="szh-tableau-boite"> qui ne se coupe pas.
--
-- WeasyPrint entoure un <table> qui a une <caption> d'une boîte anonyme qui porte la
-- légende. Aucun sélecteur CSS n'atteint cette boîte, et `break-inside: avoid` posé sur
-- `table` ne la retient pas. Si elle se coupe entre la légende et la table, le balisage
-- échoue (WeasyPrint 69) :
--
--   File ".../weasyprint/formatting_structure/boxes.py", line 407, in get_wrapped_table
--   ValueError: Table wrapper without a table
--
-- Le Makefile rattrape alors l'échec et sort un PDF non balisé, donc non conforme PDF/UA,
-- sans erreur visible : seule la vérification `verifier-ua` le montre. Le défaut dépend de
-- la position exacte du tableau sur la page.
--
-- Le Div, lui, est atteignable en CSS : `break-inside: avoid` sur lui tient la légende et
-- la table ensemble. Le filtre sert aux livres comme à la revue.
--
-- S'exécute après szh-tabelle-inclure (qui insère les tableaux) et après szh-numerotation
-- (qui ne compte que les tableaux enfants directs du document).

local CLASSE = 'szh-tableau-boite'

-- Tableaux écrits en markdown.
function Table(t)
  return pandoc.Div({ t }, pandoc.Attr('', { CLASSE }))
end

-- Tableaux insérés par szh-tabelle-inclure, en RawBlock html : on les entoure de deux
-- RawBlock pour laisser leur HTML intact. On cherche la balise ouvrante <table, pas le mot
-- « table ».
function RawBlock(b)
  if b.format ~= 'html' and b.format ~= 'html5' then return nil end
  if not b.text:lower():find('<table') then return nil end
  return {
    pandoc.RawBlock('html', '<div class="' .. CLASSE .. '">'),
    b,
    pandoc.RawBlock('html', '</div>'),
  }
end
