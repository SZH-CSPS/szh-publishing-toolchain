-- Nettoie le galley Word de l'export OJS (HTML autonome -> .docx) : le lecteur html de
-- pandoc voit le balisage, jamais le CSS, donc tout ce que print.css masque
-- réapparaîtrait en clair dans le Word.
-- Deux passes, dans cet ordre :
--   1. les notes redeviennent des notes (le HTML les porte en `float: footnote`) ;
--   2. la description longue d'un tableau (.szh-description) est retirée : elle n'existe
--      que pour être la cible d'un aria-describedby et n'a aucun équivalent en Word.
-- Rien d'autre n'est retiré : le galley doit rester le texte complet de l'article.

-- ── 1. Notes ────────────────────────────────────────────────────────────────────────
--
-- szh-notes.lua fait de chaque note un <span class="szh-note"> à l'endroit de l'appel, pour
-- `float: footnote` : l'appel et le numéro sont dessinés par le CSS, le HTML n'en porte rien.
-- Lu par pandoc, le texte de la note restait au milieu de la phrase. Il redevient une Note,
-- que le writer docx écrit en vraie note de bas de page Word, appel et renvoi compris.
-- ⚠ Une note de plusieurs paragraphes arrive ici en un seul : szh-notes.lua les a déjà
-- joints par une espace (la zone @footnote n'en compose qu'un). Le galley ne peut pas
-- retrouver une coupure que le HTML ne porte plus.
local function sans_blancs_aux_bords(inl)
  while #inl > 0 and (inl[1].t == 'Space' or inl[1].t == 'SoftBreak') do inl:remove(1) end
  while #inl > 0 and (inl[#inl].t == 'Space' or inl[#inl].t == 'SoftBreak') do inl:remove(#inl) end
  return inl
end

local function note(span)
  if not span.classes:includes('szh-note') then return nil end
  return pandoc.Note({ pandoc.Para(sans_blancs_aux_bords(span.content)) })
end

-- ── 2. Blocs techniques ─────────────────────────────────────────────────────────────
local A_RETIRER = { ['szh-description'] = true }

local function retirer(div)
  for _, classe in ipairs(div.classes) do
    if A_RETIRER[classe] then return {} end
  end
  return nil
end

return {
  { Span = note },
  { Div = retirer },
}
