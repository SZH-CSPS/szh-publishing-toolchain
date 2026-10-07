-- Compilation : remplace chaque référence de tableau posée à l'import par le HTML du
-- fichier, ::: {.szh-tabelle src="tables/table-NN.html"}.
-- Le chemin est relatif au dossier de l'article, où le Makefile se place. Un fichier
-- manquant donne un bloc d'avertissement visible dans le rendu.
-- La numérotation (« Tableau N — » dans le <caption>) est faite ensuite par
-- szh-numerotation.lua.

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
    return avertissement('Tableau introuvable : ' .. src .. ' (fichier supprimé ou renommé ?)')
  end
  local contenu = f:read('a')
  f:close()
  return pandoc.RawBlock('html', contenu)
end
