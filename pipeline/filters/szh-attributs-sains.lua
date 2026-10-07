--[[
szh-attributs-sains.lua : import Word. Rend relisibles par pandoc les identifiants et
les classes des éléments importés.

Le lecteur docx pose le nom du style Word en classe sur chaque titre : « Titre 2 (small) »
devient la classe `Titre-2-(small)`, que le writer markdown écrit telle quelle :

    ## Qui a fait ce livre ? {#qui-a-fait-ce-livre .Titre-2-(small)}

La syntaxe d'attributs de pandoc refuse la parenthèse dans un nom de classe. À la
relecture, le lecteur markdown abandonne tout le bloc d'attributs et l'imprime comme du
texte, sans avertissement.

Les classes sont dans `el.classes`, l'identifiant dans `el.identifier` ; `el.attributes`
ne contient que les paires clé=valeur. Lire `el.attributes.class` ne verrait rien sur un
document importé.

Les lettres accentuées sont acceptées par pandoc et conservées. Seul ce qui casserait la
relecture est remplacé par un tiret.
]]

-- Garde les lettres et chiffres ASCII, le tiret, le souligné et tout caractère non-ASCII.
local function propre(nom)
  if not nom or nom == '' then return '' end
  local sortie = {}
  for _, octet in utf8.codes(nom) do
    local car = utf8.char(octet)
    if car:match('^[%w_%-]$') or octet > 127 then
      sortie[#sortie + 1] = car
    else
      sortie[#sortie + 1] = '-'
    end
  end
  local net = table.concat(sortie):gsub('%-+', '-')
  return (net:gsub('^%-+', ''):gsub('%-+$', ''))
end

-- Identifiants renommés, pour réparer ensuite les liens internes qui les visaient.
local renommes = {}

local function assainir(el)
  if el.attr == nil then return nil end
  local change = false

  if el.identifier and el.identifier ~= '' then
    local neuf = propre(el.identifier)
    if neuf ~= el.identifier and neuf ~= '' then
      renommes[el.identifier] = neuf
      el.identifier = neuf
      change = true
    end
  end

  if el.classes and #el.classes > 0 then
    local gardees = pandoc.List({})
    for _, classe in ipairs(el.classes) do
      local neuve = propre(classe)
      if neuve ~= classe then change = true end
      -- Une classe vide après nettoyage est retirée : pandoc refuserait une classe vide.
      if neuve ~= '' then gardees:insert(neuve) end
    end
    if change then el.classes = gardees end
  end

  if change then return el end
  return nil
end

-- Fait suivre un lien interne `#identifiant` dont la cible a été renommée.
local function reparer_lien(lien)
  local cible = lien.target:match('^#(.+)$')
  if cible and renommes[cible] then
    lien.target = '#' .. renommes[cible]
    return lien
  end
  return nil
end

-- Deux passages : tous les renommages doivent être connus avant de réparer les liens, sinon
-- un lien placé avant sa cible serait manqué.
function Pandoc(doc)
  doc = doc:walk({ Block = assainir, Inline = assainir })
  if next(renommes) ~= nil then
    doc = doc:walk({ Link = reparer_lien })
  end
  return doc
end
