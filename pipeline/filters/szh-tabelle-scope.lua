-- szh-tabelle-scope.lua — rendu HTML uniquement (D112, RGAA 5.7). Les tableaux
-- ÉCRITS EN MARKDOWN (tableaux pipe/grid, AST pandoc) sortent en <th> nus : aucun
-- lecteur d'écran ne peut relier une cellule à son en-tête. Ce filtre pose scope
-- sur les cellules d'en-tête de l'AST — le writer HTML de pandoc émet tel quel
-- l'attribut posé dans l'Attr de la cellule (vérifié pandoc 3.5/3.9) :
--   * rangées du <thead>            -> scope="col"  (colspan > 1 : "colgroup") ;
--   * colonnes d'en-tête de rangée  -> scope="row"  (rowspan > 1 : "rowgroup")
--     (row_head_columns, tableaux grid ; les tableaux pipe n'en ont pas).
-- Les tableaux de l'éditeur maison (.szh-tableau, D47/D68) n'entrent PAS ici :
-- réinjectés en RawBlock html, ils portent déjà leur scope, posé par l'éditeur.

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
