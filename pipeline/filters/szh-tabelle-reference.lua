-- szh-tabelle-reference.lua — import (D50, remplace szh-tabelle-extraire.lua).
-- Le RENDU des tableaux est fait par docx-tables.py (fusions préservées) AVANT
-- pandoc ; ce filtre ne fait plus que poser la RÉFÉRENCE dans le .md :
--   ::: {.szh-tabelle src="tables/table-NN.html"}
-- Il n'écrit AUCUN fichier. La numérotation suit l'ordre du document et doit
-- rester alignée avec docx-tables.py (RM2) : parcours top-down SANS descendre
-- dans le tableau remplacé -> seuls les tableaux de premier niveau comptent,
-- comme côté Python (les imbriqués sont rendus À L'INTÉRIEUR de leur parent).

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
