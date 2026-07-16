-- szh-tabelle-inclure.lua — compilation (D47).
-- Résout les références écrites à l'import par szh-tabelle-extraire.lua :
--   ::: {.szh-tabelle src="tables/table-NN.html"}  ->  contenu HTML du fichier.
-- Cwd = dossier de l'article (la règle HTML du Makefile fait cd articles/<slug>,
-- les chemins relatifs tables/… tombent juste). Fichier manquant ou référence
-- cassée -> bloc d'avertissement VISIBLE dans le rendu, jamais d'échec silencieux
-- (le rédacteur voit le trou, le build n'échoue pas).

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
