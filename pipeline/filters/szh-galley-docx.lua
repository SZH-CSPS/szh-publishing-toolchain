-- Nettoie le galley Word de l'export OJS (HTML autonome -> .docx) : le lecteur html de
-- pandoc voit le balisage, jamais le CSS, donc tout ce que print.css masque
-- réapparaîtrait en clair dans le Word, et tout ce que le CSS dessine y manquerait.
-- Trois passes, dans cet ordre :
--   1. les figures légendées retrouvent leur image (le décor CSS n'existe pas en Word) ;
--   2. les notes redeviennent des notes (le HTML les porte en `float: footnote`) ;
--   3. la description longue d'un tableau (.szh-description) est retirée : elle n'existe
--      que pour être la cible d'un aria-describedby et n'a aucun équivalent en Word.
-- Rien d'autre n'est retiré : le galley doit rester le texte complet de l'article.

local utils = pandoc.utils

-- ── 1. Figures légendées ─────────────────────────────────────────────────────────────
--
-- Une image `alt=""` est un décor pour szh-numerotation.lua : un <span class="szh-decor-N">
-- dont l'image est un fond CSS, posé dans un <style> de fin de corps. pandoc ne lit pas le
-- CSS : le Word n'avait plus d'image. Juste pour un décor ; faux pour une figure de données
-- dont l'extraction avait écrit `alt=""` (articles 05 et 09 du 4/2017, 30.09.2026) — la
-- légende « Figure 1 — … » restait seule. Règle retenue par Robin : une figure légendée
-- n'est pas un décor. Dans le galley, elle retrouve son image, décrite par sa légende.
-- Le PDF n'est pas concerné : il garde la règle de szh-numerotation.lua.
--
-- Un vrai décor — sans légende, ou dont la légende n'est qu'un crédit (.szh-credit-seul) —
-- reste absent. pandoc ne sait pas écrire la marque « décorative » de Word (extension
-- adec:decorative du docPr) ; inséré sans description, il serait signalé comme image sans
-- texte de remplacement par le vérificateur de Word. Il ne porte rien que le texte ne dise.

local CLASSE_DECOR = 'szh%-decor%-(%d+)'
local CREDIT_SEUL = 'szh-credit-seul'

-- { [N] = 'data:…' } lu dans le <style> du corps : `.szh-decor-N>span{…background-image:url(…)}`.
-- ⚠ Lu dans le fichier HTML lui-même, et non dans l'arbre : le lecteur html de pandoc
-- 3.7 (celui de l'image WSL) jette les <style> du corps sans l'extension raw_html, que la
-- recette ne demande pas ; pandoc 3.9 les garde en RawInline (mesuré le 30.09.2026).
local function sources_des_decors()
  local sources = {}
  for _, chemin in ipairs((PANDOC_STATE or {}).input_files or {}) do
    local fh = io.open(chemin, 'rb')
    if fh then
      local texte = fh:read('a'); fh:close()
      for n, src in texte:gmatch('%.szh%-decor%-(%d+)>span{[^}]-background%-image:%s*url%(["\']?(data:[^)"\']+)["\']?%)') do
        sources[n] = src
      end
    end
  end
  return sources
end

-- Le texte de la légende, sans les notes qu'elle porte : une description ne lit pas la note.
local function description(legende)
  local sans_notes = pandoc.Blocks(legende):walk({
    Span = function(s) if s.classes:includes('szh-note') then return {} end end,
  })
  return (utils.stringify(sans_notes):gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', ''))
end

local function numero_decor(span)
  for _, c in ipairs(span.classes) do
    local n = c:match('^' .. CLASSE_DECOR .. '$')
    if n then return n end
  end
  return nil
end

local function rendre_images(doc)
  local sources = sources_des_decors()
  if next(sources) == nil then return nil end
  doc.blocks = doc.blocks:walk({
    Figure = function(fig)
      if fig.classes:includes(CREDIT_SEUL) then return nil end
      local legende = fig.caption.long
      if utils.stringify(legende):match('^%s*$') then return nil end
      local texte = description(legende)
      fig.content = fig.content:walk({
        Span = function(s)
          local n = numero_decor(s)
          if not n or not sources[n] then return nil end
          return pandoc.Image({ pandoc.Str(texte) }, sources[n])
        end,
      })
      return fig
    end,
  })
  return doc
end

-- ── 2. Notes ────────────────────────────────────────────────────────────────────────
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

-- ── 3. Blocs techniques ─────────────────────────────────────────────────────────────
local A_RETIRER = { ['szh-description'] = true }

local function retirer(div)
  for _, classe in ipairs(div.classes) do
    if A_RETIRER[classe] then return {} end
  end
  return nil
end

return {
  { Pandoc = rendre_images },
  { Span = note },
  { Div = retirer },
}
