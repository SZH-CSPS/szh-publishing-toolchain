-- Livre seulement : pose sous le titre d'un chapitre le sous-titre lu dans la clé
-- `subtitle` de sa fiche <slug>.meta.yaml (par langue, comme `title`, voir
-- szh-livre-titre.lua). Rien n'est posé si la clé manque.
--
-- Le second passage s'exécute après szh-livre-auteurs.lua et szh-livre-entete.lua, qui se
-- placent juste sous le titre. Inséré en dernier juste sous le titre, le sous-titre passe
-- devant eux : titre, sous-titre, auteur·e·s, encadré.
--
-- Le texte passe par la typographie maison, puis est écrit en HTML brut. « // » devient
-- un <br>.

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[livre-sous-titre] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local CHAPITRE = os.getenv('SZH_CHAPITRE') or ''

local texte = commun.texte

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
  return commun.contexte(meta).lang
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

-- Deux passages (le filtre est listé deux fois dans livre.mk). Le premier, avant
-- szh-typographie.lua, pose le sous-titre dans un Div « attente » pour qu'il reçoive la
-- typographie maison. Le second le retire et l'écrit en <p class="szh-sous-titre"> sous
-- le titre.
local ATTENTE = 'szh-sous-titre-attente'

function Pandoc(doc)
  if commun.contexte(doc.meta).produit ~= 'livre' or CHAPITRE == '' then return doc end

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
