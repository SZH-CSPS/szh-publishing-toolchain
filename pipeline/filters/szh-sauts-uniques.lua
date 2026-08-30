--[[
szh-sauts-uniques.lua — un saut de ligne consécutif, jamais deux.

LE DÉFAUT QU'IL CORRIGE, et pourquoi il ne se voyait pas.

La maquette FALC se lit avec `markdown+hard_line_breaks` : en facile à lire, le retour à la
ligne porte du sens — une phrase, une ligne — et l'auteur ne devrait pas avoir à le demander
deux fois. Mais l'import Word, lui, écrit un `\` explicite en fin de chaque ligne. Pandoc
compte alors DEUX sauts : celui du backslash, puis celui de la fin de ligne.

Le texte sortait donc à double interligne. Rien ne le signalait : deux <br> sont un HTML
parfaitement valide, le PDF restait conforme PDF/UA, et aucun avertissement n'était émis.
Cela se voyait seulement au nombre de pages — sur un vrai livre, 282 des 570 sauts étaient
doubles, et l'ouvrage sortait à 64 pages contre 46 à l'édition d'origine.

Ce filtre laisse le premier saut et retire ceux qui le suivent immédiatement. Il rend donc
les deux écritures équivalentes : le rédacteur qui tape ses lignes sans rien, et le fichier
venu de Word qui les termine par `\`.

⚠ Il ne touche PAS aux paragraphes : deux paragraphes séparés par une ligne vide sont deux
  blocs distincts dans l'arbre, pas deux sauts, et leur espacement relève de la feuille de
  style. Ce filtre ne travaille qu'à l'intérieur d'une suite d'inlines.
]]

-- Un saut, quelle que soit sa forme : `\` en fin de ligne (LineBreak) ou simple retour
-- promu par hard_line_breaks (que pandoc rend aussi en LineBreak, mais SoftBreak subsiste
-- quand l'extension est absente — on traite les deux, le filtre servant aux deux lecteurs).
local function est_saut(inline)
  return inline.t == 'LineBreak' or inline.t == 'SoftBreak'
end

local function deduire(inlines)
  local sortie = pandoc.Inlines({})
  local precedent_saut = false
  for _, item in ipairs(inlines) do
    if est_saut(item) then
      -- Le premier saut passe et fixe la forme retenue ; les suivants sont absorbés.
      if not precedent_saut then sortie:insert(item) end
      precedent_saut = true
    else
      sortie:insert(item)
      precedent_saut = false
    end
  end
  return sortie
end

-- `Inlines` s'applique à toute suite d'inlines de l'arbre — contenu de paragraphe, de
-- titre, de cellule, d'item de liste. Une seule fonction suffit donc à couvrir le document,
-- là où filtrer Para puis Plain puis Header en aurait oublié un.
return {
  { Inlines = deduire },
}
