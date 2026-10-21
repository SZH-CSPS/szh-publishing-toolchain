--[[
szh-attributs-sains.lua : import Word. Rend relisible par pandoc le markdown écrit : les
identifiants et les classes des éléments importés, et les sauts de ligne en bord de mise
en forme.

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

Un saut de ligne Word (Maj+Entrée) pris dans un passage souligné, gras ou en italique
reste dans ce passage. En dernière position, le writer markdown l'écrit « \ » juste avant
le crochet fermant :

    **[Alle Menschen können teilhaben.\]{.underline}**

À la relecture, le crochet est échappé : le passage ne se ferme plus et « {.underline} »
s'imprime en toutes lettres. Le saut sort donc du passage, devant ou derrière lui. Un saut
en fin de paragraphe est retiré : le writer l'écrirait en « \ » final, imprimé tel quel.
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

-- Sort les sauts de ligne placés en tête ou en fin d'un élément à contenu (souligné, gras,
-- lien…), du plus profond vers l'extérieur.
local function sortir_sauts(inlines)
  local sortie = pandoc.List({})
  for _, el in ipairs(inlines) do
    if el.t ~= 'Image' and el.t ~= 'Note' and el.content ~= nil
        and pandoc.utils.type(el.content) == 'Inlines' then
      el.content = sortir_sauts(el.content)
      local avant, apres = pandoc.List({}), pandoc.List({})
      while #el.content > 0 and el.content[1].t == 'LineBreak' do
        avant:insert(el.content:remove(1))
      end
      while #el.content > 0 and el.content[#el.content].t == 'LineBreak' do
        apres:insert(1, el.content:remove())
      end
      sortie:extend(avant)
      if #el.content > 0 then sortie:insert(el) end
      sortie:extend(apres)
    else
      sortie:insert(el)
    end
  end
  return sortie
end

local function sauts_du_paragraphe(bloc)
  local contenu = sortir_sauts(bloc.content)
  while #contenu > 0 and contenu[#contenu].t == 'LineBreak' do contenu:remove() end
  while #contenu > 0 and contenu[1].t == 'LineBreak' do contenu:remove(1) end
  bloc.content = contenu
  return bloc
end

-- Deux passages : tous les renommages doivent être connus avant de réparer les liens, sinon
-- un lien placé avant sa cible serait manqué.
function Pandoc(doc)
  doc = doc:walk({ Para = sauts_du_paragraphe, Plain = sauts_du_paragraphe })
  doc = doc:walk({ Block = assainir, Inline = assainir })
  if next(renommes) ~= nil then
    doc = doc:walk({ Link = reparer_lien })
  end
  return doc
end
