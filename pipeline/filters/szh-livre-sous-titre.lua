-- Livre seulement : le sous-titre d'un chapitre, depuis la clé `subtitle` de sa fiche
-- <slug>.meta.yaml (par langue, comme `title` — voir szh-livre-titre.lua). Rien n'est écrit
-- quand la clé manque : la plupart des chapitres n'en ont pas.
--
-- Place dans la chaîne : APRÈS szh-livre-auteurs.lua et szh-livre-entete.lua, et c'est
-- voulu. Ces deux filtres cherchent leur emplacement « juste sous le titre » ou « sous le
-- bloc auteurs » ; un sous-titre déjà posé là les ferait se glisser entre le titre et lui.
-- Inséré en dernier, il passe devant eux : titre, sous-titre, auteur·e·s, encadré.
--
-- Le texte passe par la typographie maison (voir plus bas), puis est écrit en HTML brut.
-- Un « // » y devient un <br> (retour à la ligne forcé).

local S = pandoc.utils.stringify

local LIVRE = (os.getenv('SZH_LIVRE') or '') ~= ''
local CHAPITRE = os.getenv('SZH_CHAPITRE') or ''

local function texte(v)
  if v == nil then return '' end
  local ok, r = pcall(S, v)
  if not ok then return '' end
  return (r:gsub('^%s+', ''):gsub('%s+$', ''))
end

-- « A // B » -> Inlines : mots et espaces, un LineBreak à chaque « // » (même règle que
-- szh_commun.titre_lignes() en Python).
local function inlines_de(v)
  local sortie = pandoc.List()
  local n = 0
  for l in (v .. ' // '):gmatch('(.-)%s*//%s*') do
    l = l:gsub('^%s+', ''):gsub('%s+$', '')
    if l ~= '' then
      n = n + 1
      if n > 1 then sortie:insert(pandoc.LineBreak()) end
      for mot in l:gmatch('%S+') do
        if sortie[#sortie] and sortie[#sortie].t ~= 'LineBreak' then sortie:insert(pandoc.Space()) end
        sortie:insert(pandoc.Str(mot))
      end
    end
  end
  return sortie
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

-- Deux passages (le filtre est listé deux fois dans livre.mk). Le premier, AVANT
-- szh-typographie.lua, pose le sous-titre en Div « attente » : la typographie maison le
-- traite comme le reste du chapitre. Le second, à la place décrite plus haut, le retire et
-- le réécrit en <p class="szh-sous-titre"> sous le titre.
local ATTENTE = 'szh-sous-titre-attente'

function Pandoc(doc)
  if not LIVRE or CHAPITRE == '' then return doc end

  local trouve
  doc.blocks = doc.blocks:walk({
    Div = function(d)
      if d.classes:includes(ATTENTE) then trouve = d; return {} end
    end })

  if not trouve then
    local sous = sous_titre_de(doc.meta)
    if sous == '' then return doc end
    for rang, b in ipairs(doc.blocks) do
      if b.t == 'Header' then
        doc.blocks:insert(rang + 1, pandoc.Div({ pandoc.Para(inlines_de(sous)) },
          pandoc.Attr('', { ATTENTE })))
        return doc
      end
    end
    return doc
  end

  local corps = pandoc.write(pandoc.Pandoc({ pandoc.Plain(trouve.content[1].content) }), 'html')
  corps = corps:gsub('%s+$', ''):gsub('<br />%s*', '<br>')
  for rang, b in ipairs(doc.blocks) do
    if b.t == 'Header' then
      doc.blocks:insert(rang + 1,
        pandoc.RawBlock('html', '<p class="szh-sous-titre">' .. corps .. '</p>'))
      return doc
    end
  end
  return doc
end
