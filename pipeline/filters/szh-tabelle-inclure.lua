-- szh-tabelle-inclure.lua — compilation (D47).
-- Résout les références écrites à l'import par szh-tabelle-extraire.lua :
--   ::: {.szh-tabelle src="tables/table-NN.html"}  ->  contenu HTML du fichier.
-- Cwd = dossier de l'article (la règle HTML du Makefile fait cd articles/<slug>,
-- les chemins relatifs tables/… tombent juste). Fichier manquant ou référence
-- cassée -> bloc d'avertissement VISIBLE dans le rendu, jamais d'échec silencieux
-- (le rédacteur voit le trou, le build n'échoue pas).
--
-- Légende du tableau : ce filtre ne fait QUE l'inclusion, il ne numérote pas.
-- Le contrat de forme est un <caption> en tête du <table> dans le fichier inclus
-- (écrit par docx-tables.py à l'import, par l'éditeur de tableau du cockpit
-- ensuite). C'est szh-numerotation.lua, branché APRÈS celui-ci, qui y insère
-- « Tableau N — ». Pas de <caption>, ou <caption> vide : aucun numéro consommé.

local function avertissement(texte)
  return pandoc.Div(
    { pandoc.Para({ pandoc.Strong({ pandoc.Str('⚠ ' .. texte) }) }) },
    pandoc.Attr('', { 'szh-tabelle-manquante' }, {})
  )
end

function Div(div)
  if not div.classes:includes('szh-tabelle') then
    return nil
  end
  local src = div.attributes['src']
  if not src or src == '' then
    return avertissement('Référence de tableau sans attribut src.')
  end
  local f = io.open(src, 'r')
  if not f then
    return avertissement('Tableau introuvable : ' .. src .. ' (fichier supprimé ou renommé ?)')
  end
  local contenu = f:read('a')
  f:close()
  return pandoc.RawBlock('html', contenu)
end
