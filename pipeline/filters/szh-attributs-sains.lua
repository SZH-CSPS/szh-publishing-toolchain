--[[
szh-attributs-sains.lua — import Word : des attributs que pandoc saura se relire.

LE DÉFAUT QU'IL CORRIGE.

Le lecteur docx pose le NOM DU STYLE WORD en classe sur chaque titre. Le style « Titre 2
(small) » devient donc la classe `Titre-2-(small)`, parenthèses comprises. Le writer
markdown l'écrit telle quelle :

    ## Qui a fait ce livre ? {#qui-a-fait-ce-livre .Titre-2-(small)}

Mais la syntaxe d'attributs de pandoc n'admet pas de parenthèse dans un nom de classe. À la
relecture, le lecteur markdown renonce au bloc ENTIER et le laisse passer comme du texte :
l'accolade et son contenu s'impriment dans le livre, sous les yeux du lecteur. Constaté sur
un ouvrage publié, sept fois.

Rien ne le signale — pandoc n'avertit pas, le PDF reste conforme. C'est un défaut qui ne se
voit qu'à la relecture du produit fini.

⚠ CE QUI PORTE UNE CLASSE, C'EST `el.classes`, PAS `el.attributes`. Dans l'API Lua de
  pandoc, `attributes` est la table des paires `clé=valeur` ; l'identifiant est
  `el.identifier` et les classes `el.classes`. Un filtre qui lirait `el.attributes.class`
  ne verrait jamais rien et ne corrigerait rien — en passant les essais, parce qu'un
  markdown écrit à la main avec `class="…"` remplit bel et bien `attributes`.

Les lettres accentuées sont ACCEPTÉES par pandoc : `é`, `à`, `ü` sont conservées telles
quelles. Seul ce qui casserait la relecture est remplacé.
]]

-- Ce qui a le droit de rester : lettres et chiffres ASCII, tiret, souligné, et tout
-- caractère non-ASCII — les accents, que pandoc relit sans peine.
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

-- Les identifiants renommés, pour réparer ensuite les liens qui les visaient. Sans cette
-- table, assainir un identifiant casserait en silence les renvois internes que le Word
-- portait — un sommaire ou un « voir plus haut » qui ne mène plus nulle part.
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
      -- Une classe qui ne laisse rien après nettoyage ne portait aucun nom : on la jette
      -- plutôt que d'écrire une classe vide, que pandoc refuserait à son tour.
      if neuve ~= '' then gardees:insert(neuve) end
    end
    if change then el.classes = gardees end
  end

  if change then return el end
  return nil
end

-- Un lien interne vise `#identifiant`. Si l'identifiant a été renommé au premier passage,
-- la cible doit suivre.
local function reparer_lien(lien)
  local cible = lien.target:match('^#(.+)$')
  if cible and renommes[cible] then
    lien.target = '#' .. renommes[cible]
    return lien
  end
  return nil
end

-- Deux passages, et l'ordre compte : les renommages doivent tous être connus avant qu'on
-- répare les liens, sinon un lien placé avant sa cible dans le document serait manqué.
function Pandoc(doc)
  doc = doc:walk({ Block = assainir, Inline = assainir })
  if next(renommes) ~= nil then
    doc = doc:walk({ Link = reparer_lien })
  end
  return doc
end
