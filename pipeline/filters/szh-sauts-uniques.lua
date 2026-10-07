-- Réduit les sauts de ligne consécutifs à un seul.
--
-- La maquette FALC lit le .md avec `markdown+hard_line_breaks` : chaque retour à la ligne
-- compte. L'import Word termine en plus chaque ligne par un `\`, et pandoc compte alors deux
-- sauts. Le filtre garde le premier saut et retire ceux qui le suivent immédiatement.
--
-- Les paragraphes ne sont pas concernés : ce sont des blocs distincts, pas des sauts.

-- LineBreak (`\` ou retour promu par hard_line_breaks) ou SoftBreak (retour simple sans
-- cette extension).
local function est_saut(inline)
  return inline.t == 'LineBreak' or inline.t == 'SoftBreak'
end

local function deduire(inlines)
  local sortie = pandoc.Inlines({})
  local precedent_saut = false
  for _, item in ipairs(inlines) do
    if est_saut(item) then
            if not precedent_saut then sortie:insert(item) end
      precedent_saut = true
    else
      sortie:insert(item)
      precedent_saut = false
    end
  end
  return sortie
end

-- `Inlines` couvre toute suite d'inlines : paragraphe, titre, cellule, item de liste.
return {
  { Inlines = deduire },
}
