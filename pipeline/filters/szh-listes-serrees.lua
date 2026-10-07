-- Resserre les listes : un item dont le contenu est un seul paragraphe perd ce paragraphe.
--
-- Pandoc rend une liste lâche (ligne vide entre les items) en `<li><p>texte</p></li>`.
-- WeasyPrint balise alors le <P> directement sous le <LI>, sans le <LBody> que PDF/UA-1
-- exige :
--
--   ISO 14289-1 7.2-20 — « LI element may contain only Lbl and LBody elements »
--
-- veraPDF refuse donc une liste lâche, et la vérification `verifier-ua` bloque l'export du
-- numéro ou du livre. Aucun balisage HTML ni propriété CSS ne demande un <LBody> : seule
-- la structure de l'arbre pandoc décide. Le filtre tourne pour la revue et pour le livre
-- (les livres FALC sont presque entièrement en listes).
--
-- L'espace entre les items vient du CSS, sur le <li> (`li { margin-bottom }` dans print.css
-- et les chartes de livre) : le rendu ne change pas.
--
-- Deux formes d'item à plusieurs blocs :
--   * « texte + sous-liste » : WeasyPrint met les deux dans un LBody, la sous-liste reste.
--   * « deux paragraphes » : les deux <p> seraient enfants directs du <LI>. Ils sont
--     fusionnés en un seul bloc, séparés par un saut de ligne : dans un item de liste, deux
--     paragraphes se lisent comme deux lignes (la règle FALC, une phrase par ligne).
--   Les paragraphes de tête sont fusionnés ; ce qui suit (sous-liste, tableau) reste en
--   place.

-- Vrai si le contenu finit déjà par un saut.
local function finit_par_saut(inlines)
  local dernier = inlines[#inlines]
  return dernier ~= nil and (dernier.t == 'LineBreak' or dernier.t == 'SoftBreak')
end

-- Retire les sauts de fin d'item : ils ajouteraient une ligne vide sous le dernier mot.
local function elaguer_sauts_finaux(inlines)
  while finit_par_saut(inlines) do inlines:remove(#inlines) end
  return inlines
end

local function resserrer_items(items)
  local sortie = {}
  for i, blocs in ipairs(items) do
    -- Nombre de Para au début de l'item.
    local n = 0
    while blocs[n + 1] and blocs[n + 1].t == 'Para' do n = n + 1 end

    if n == 0 then
      sortie[i] = blocs
    else
      local contenu = pandoc.Inlines({})
      for j = 1, n do
        -- L'import Word pose un `\` en fin de chaque ligne FALC : on n'ajoute pas de second
        -- saut, qui doublerait l'interligne sans rien signaler. szh-sauts-uniques.lua tient
        -- la même règle pour le reste du document.
        if j > 1 and not finit_par_saut(contenu) then contenu:insert(pandoc.LineBreak()) end
        contenu:extend(blocs[j].content)
      end
      local neufs = { pandoc.Plain(elaguer_sauts_finaux(contenu)) }
      for j = n + 1, #blocs do neufs[#neufs + 1] = blocs[j] end
      sortie[i] = neufs
    end
  end
  return sortie
end

function BulletList(l)
  l.content = resserrer_items(l.content)
  return l
end

-- Liste qui commence à « 7. » : WeasyPrint ignore l'attribut start de <ol>. La liste passe
-- dans une boîte qui porte son rang de départ, lu en counter-reset par
-- partage-filtres.css (.szh-liste-rang). Si la liste atteint 10, data-deux-chiffres donne
-- le rang du premier item à deux chiffres, que print.css décale comme le 10e item d'une
-- liste qui part de 1.
function OrderedList(l)
  l.content = resserrer_items(l.content)
  local debut = l.listAttributes and l.listAttributes.start or l.start or 1
  if debut == 1 then return l end
  local attrs = { style = '--szh-rang: ' .. (debut - 1) }
  if debut + #l.content - 1 >= 10 then
    attrs['data-deux-chiffres'] = tostring(math.max(1, 11 - debut))
  end
  return pandoc.Div({ l }, pandoc.Attr('', { 'szh-liste-rang' }, attrs))
end

-- Les listes de définitions (<DL>/<DT>/<DD>) ne sont pas concernées par 7.2-20.
