-- Nettoie le galley Word de l'export OJS (HTML autonome -> .docx). Le lecteur html de
-- pandoc ne lit pas le CSS : ce que print.css masque réapparaîtrait dans le Word, et ce
-- que le CSS dessine y manquerait. Trois passes, dans cet ordre :
--   1. les figures légendées retrouvent leur image (le décor CSS n'existe pas en Word) ;
--   2. les notes redeviennent des notes (le HTML les porte en `float: footnote`) ;
--   3. la description longue d'un tableau (.szh-description), cible d'un
--      aria-describedby sans équivalent en Word, est retirée.
-- Rien d'autre n'est retiré : le galley garde le texte complet de l'article.

local utils = pandoc.utils

-- ── 1. Figures légendées ─────────────────────────────────────────────────────────────
--
-- szh-numerotation.lua rend une image `alt=""` comme un décor : un <span class="szh-decor-N">
-- dont l'image est un fond CSS, défini dans un <style> en fin de corps. Dans le galley, une
-- figure légendée n'est jamais un décor : elle retrouve son image, décrite par sa légende.
-- Le PDF garde la règle de szh-numerotation.lua.
--
-- Un vrai décor (sans légende, ou dont la légende n'est qu'un crédit, .szh-credit-seul)
-- reste absent : pandoc ne sait pas écrire la marque « décorative » de Word, et une image
-- sans description serait signalée par le vérificateur d'accessibilité de Word.

local CLASSE_DECOR = 'szh%-decor%-(%d+)'
local CREDIT_SEUL = 'szh-credit-seul'

-- { [N] = 'data:…' } lu dans le <style> du corps : `.szh-decor-N>span{…background-image:url(…)}`.
-- Lu dans le fichier HTML et non dans l'arbre : le lecteur html de pandoc 3.7 jette les
-- <style> du corps sans l'extension raw_html, que la recette ne demande pas.
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

-- Texte de la légende, sans ses notes.
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
-- `float: footnote` : l'appel et le numéro sont dessinés par le CSS. Le span redevient une
-- Note, que le writer docx écrit en note de bas de page Word.
-- Une note de plusieurs paragraphes arrive en un seul : szh-notes.lua les a déjà joints.
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
