-- Livre seulement : le sous-titre d'un chapitre, depuis la clé `subtitle` de sa fiche
-- <slug>.meta.yaml (par langue, comme `title` — voir szh-livre-titre.lua). Rien n'est écrit
-- quand la clé manque : la plupart des chapitres n'en ont pas.
--
-- Place dans la chaîne : APRÈS szh-livre-auteurs.lua et szh-livre-entete.lua, et c'est
-- voulu. Ces deux filtres cherchent leur emplacement « juste sous le titre » ou « sous le
-- bloc auteurs » ; un sous-titre déjà posé là les ferait se glisser entre le titre et lui.
-- Inséré en dernier, il passe devant eux : titre, sous-titre, auteur·e·s, encadré.
--
-- Il est écrit en HTML brut après la typographie : texte tel que dans la fiche.

local S = pandoc.utils.stringify

local LIVRE = (os.getenv('SZH_LIVRE') or '') ~= ''
local CHAPITRE = os.getenv('SZH_CHAPITRE') or ''

local function texte(v)
  if v == nil then return '' end
  local ok, r = pcall(S, v)
  if not ok then return '' end
  return (r:gsub('^%s+', ''):gsub('%s+$', ''))
end

local function ech(v)
  return (texte(v):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function langue_de(meta)
  local l = texte(meta and meta.lang)
  if l == '' then return 'fr' end
  return (l:lower():match('^(%a%a)')) or 'fr'
end

local function sous_titre_de(meta)
  local t = meta and meta.subtitle
  if t == nil then return '' end
  local genre = pandoc.utils.type(t)
  if genre == 'Inlines' or genre == 'Blocks' or genre == 'string' then return texte(t) end
  local propre = texte(t[langue_de(meta)])
  if propre ~= '' then return propre end
  for _, l in ipairs({ 'fr', 'de', 'it', 'en' }) do
    local autre = texte(t[l])
    if autre ~= '' then return autre end
  end
  return ''
end

function Pandoc(doc)
  if not LIVRE or CHAPITRE == '' then return doc end
  local sous = sous_titre_de(doc.meta)
  if sous == '' then return doc end
  for rang, b in ipairs(doc.blocks) do
    if b.t == 'Header' then
      doc.blocks:insert(rang + 1,
        pandoc.RawBlock('html', '<p class="szh-sous-titre">' .. ech(sous) .. '</p>'))
      return doc
    end
  end
  return doc
end
