-- szh-tabelle-extraire.lua — import (D47, remplace szh-tabelle-platzhalter.lua).
-- Chaque tableau du docx devient UN fichier HTML : tables/table-NN.html (NN
-- séquentiel par document, ordre de lecture — les filtres pandoc parcourent l'AST
-- dans l'ordre des blocs). Le .md ne garde qu'une RÉFÉRENCE :
--   ::: {.szh-tabelle src="tables/table-NN.html"}
-- résolue à la compilation par szh-tabelle-inclure.lua. Le contenu du tableau
-- n'est plus perdu (l'ancien placeholder {{TABELLE NN}} est abandonné).
--
-- Cwd = dossier de l'article (import-docx.sh fait cd articles/<slug> et
-- mkdir -p tables avant pandoc). Nécessite pandoc.write (pandoc >= 2.17 ;
-- rootfs : pandoc 3.5, vérifié au spike N6).

local compteur = 0

function Table(tbl)
  compteur = compteur + 1
  local chemin = string.format('tables/table-%02d.html', compteur)
  local html = pandoc.write(pandoc.Pandoc({ tbl }), 'html')
  local f = io.open(chemin, 'w')
  if not f then
    -- Écriture impossible : on LAISSE le tableau dans le .md (aucune perte) et on
    -- le signale sur stderr (visible dans le panneau de la tâche d'import).
    io.stderr:write('[szh-tabelle-extraire] impossible d\'écrire ' .. chemin .. ' — tableau laissé en place\n')
    return nil
  end
  f:write(html)
  f:close()
  return pandoc.Div({}, pandoc.Attr('', { 'szh-tabelle' }, { { 'src', chemin } }))
end
