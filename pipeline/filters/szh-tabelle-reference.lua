-- Import : pose la référence d'un tableau dans le .md,
--   ::: {.szh-tabelle src="tables/table-NN.html"}
-- Le rendu du tableau lui-même est fait avant pandoc par docx-tables.py ; ce filtre
-- n'écrit aucun fichier. La numérotation suit l'ordre du document et doit rester
-- alignée avec docx-tables.py : parcours top-down sans descendre dans le tableau
-- remplacé, donc seuls les tableaux de premier niveau comptent, comme côté Python.

local compteur = 0

local filtre = {
  Table = function(_)
    compteur = compteur + 1
    local chemin = string.format('tables/table-%02d.html', compteur)
    -- `false` : ne pas traverser le contenu remplacé (pas de comptage des
    -- tableaux imbriqués).
    return pandoc.Div({}, pandoc.Attr('', { 'szh-tabelle' }, { { 'src', chemin } })), false
  end
}
filtre.traverse = 'topdown'

return { filtre }
