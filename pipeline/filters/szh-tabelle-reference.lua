-- Import : remplace chaque tableau par sa référence dans le .md,
-- ::: {.szh-tabelle src="tables/table-NN.html"}. Le fichier HTML est écrit avant pandoc
-- par docx-tables.py.
-- Le numéro NN doit correspondre à celui de docx-tables.py : seuls les tableaux de premier
-- niveau sont comptés, dans l'ordre du document, comme côté Python.

local compteur = 0

local filtre = {
  Table = function(_)
    compteur = compteur + 1
    local chemin = string.format('tables/table-%02d.html', compteur)
    -- `false` : ne pas descendre dans le tableau remplacé (tableaux imbriqués non comptés).
    return pandoc.Div({}, pandoc.Attr('', { 'szh-tabelle' }, { { 'src', chemin } })), false
  end
}
filtre.traverse = 'topdown'

return { filtre }
