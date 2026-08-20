-- Rendu HTML : pose scope sur les cellules d'en-tête des tableaux écrits en markdown
-- (RGAA 5.7), que pandoc sort en <th> nus. Le writer HTML émet tel quel l'attribut
-- posé dans l'Attr de la cellule (pandoc 3.5 et 3.9) :
--   * rangées du <thead>           -> scope="col" (colspan > 1 : "colgroup") ;
--   * colonnes d'en-tête de rangée -> scope="row" (rowspan > 1 : "rowgroup").
-- Les tableaux de l'éditeur maison (.szh-tableau) n'entrent pas ici : réinjectés en
-- RawBlock html, ils portent déjà leur scope.

local function poser(cell, seul, groupe)
  cell.attr.attributes['scope'] =
    ((cell.col_span or 1) > 1 or (cell.row_span or 1) > 1) and groupe or seul
end

function Table(t)
  for _, row in ipairs(t.head.rows) do
    for _, cell in ipairs(row.cells) do
      poser(cell, 'col', 'colgroup')
    end
  end
  for _, body in ipairs(t.bodies) do
    local n = body.row_head_columns or 0
    if n > 0 then
      for _, row in ipairs(body.body) do
        for i = 1, math.min(n, #row.cells) do
          poser(row.cells[i], 'row', 'rowgroup')
        end
      end
    end
  end
  return t
end
