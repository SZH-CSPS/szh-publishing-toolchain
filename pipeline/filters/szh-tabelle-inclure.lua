-- Compilation : résout les références de tableau posées à l'import,
--   ::: {.szh-tabelle src="tables/table-NN.html"}  ->  contenu HTML du fichier.
-- Cwd = dossier de l'article (le Makefile fait cd articles/<slug>), donc les chemins
-- relatifs tombent juste. Fichier manquant ou référence cassée -> bloc d'avertissement
-- visible dans le rendu, pas d'échec silencieux.
-- Ce filtre inclut, il ne numérote pas : c'est szh-numerotation.lua, branché après,
-- qui insère « Tableau N — » dans le <caption> attendu en tête du <table> inclus.

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
