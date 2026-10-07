-- Imprime sur stdout, sans fin de ligne, une clé de premier niveau d'un YAML (ausgabe.yaml,
-- buch.yaml, une fiche <slug>.meta.yaml). Le fichier est lu par le lecteur de pandoc : le
-- Makefile voit la configuration comme pandoc la verra à la compilation.
--
--   pandoc lua szh-lire-config.lua <fichier.yaml> <cle>
--
-- <cle> peut être un chemin pointé (impression.profil-cmjn) qui descend dans les maps ;
-- une clé de premier niveau qui porte ce nom exact passe avant.
--
-- Le fichier est enveloppé dans un bloc de métadonnées (--- ... ---) et lu par
-- pandoc.read(texte, 'markdown-smart'). « -smart » garde les guillemets droits,
-- apostrophes et tirets tels quels (une couleur #5F9FBC, un slug à double tiret, un titre
-- qui finit par "...").
--
-- Ce qu'imprime chaque forme :
--   cle: valeur                     -> valeur (MetaString/MetaInlines, stringifiée)
--   cle: [a, b, "c d"]               -> a b c d (MetaList, éléments stringifiés, un espace)
--   cle:                            -> bloc, selon ce qui suit :
--     - a                              liste en blocs (MetaList) -> a b
--     - b
--   cle:                            -> bloc map (MetaMap) -> la première valeur non vide,
--     fr: Bonjour                      dans l'ordre fr, de, it, en, puis les autres clés
--     de: Hallo                        triées (l'ordre d'une table Lua n'est pas celui du
--                                       fichier)
--   cle: true / false                -> MetaBool -> "true" / "false"
--
-- Code de sortie : 0 si la clé existe, même vide (`cle:`, `cle: ""`, `cle: ~`) ; 1 si
-- elle est absente, si le fichier est illisible ou si pandoc.read échoue.
--
-- Le BOM UTF-8 de tête est retiré avant l'enveloppe : placé entre « --- » et la première
-- clé, il ferait échouer pandoc.read. Les fins de ligne CRLF sont acceptées telles quelles.

local chemin, cle = arg[1], arg[2]
if not chemin or not cle or cle == '' then
  io.stderr:write('usage : pandoc lua szh-lire-config.lua <fichier.yaml> <cle>\n')
  os.exit(2)
end

local fh = io.open(chemin, 'r')
if not fh then os.exit(1) end
local brut = fh:read('a') or ''
fh:close()

-- BOM UTF-8 en tête de fichier seulement.
brut = brut:gsub('^\239\187\191', '')

local texte = '---\n' .. brut .. '\n---\n'
local ok, doc = pcall(pandoc.read, texte, 'markdown-smart')
if not ok then os.exit(1) end

local valeur = doc.meta[cle]
-- Chemin pointé : une sous-clé, lue seulement si aucune clé de premier niveau ne porte ce
-- nom exact.
if valeur == nil and cle:find('.', 1, true) then
  local premier = true
  valeur = doc.meta
  for segment in cle:gmatch('[^.]+') do
    if not premier and pandoc.utils.type(valeur) ~= 'table' then valeur = nil; break end
    premier = false
    valeur = valeur[segment]
    if valeur == nil then break end
  end
end
if valeur == nil then os.exit(1) end

-- Ordre des sous-clés d'une MetaMap (title: fr/de/..., impression: grammage/dos-mm/...).
local ORDRE_LANGUES = { 'fr', 'de', 'it', 'en' }

-- Convertit une valeur de meta, de tout type pandoc, en chaîne de sortie. Déclarée
-- d'avance : elle et premiere_valeur_non_vide s'appellent l'une l'autre.
local valeur_depuis_meta

-- MetaMap -> la première sous-valeur non vide, dans l'ordre ci-dessus.
local function premiere_valeur_non_vide(map)
  local vues = {}
  for _, sous_cle in ipairs(ORDRE_LANGUES) do
    vues[sous_cle] = true
    local sous = map[sous_cle]
    if sous ~= nil then
      local v = valeur_depuis_meta(sous)
      if v ~= '' then return v end
    end
  end
  local reste = {}
  for sous_cle in pairs(map) do
    if not vues[sous_cle] then reste[#reste + 1] = sous_cle end
  end
  table.sort(reste)
  for _, sous_cle in ipairs(reste) do
    local v = valeur_depuis_meta(map[sous_cle])
    if v ~= '' then return v end
  end
  return ''
end

valeur_depuis_meta = function(v)
  local t = pandoc.utils.type(v)
  if t == 'boolean' then
    return v and 'true' or 'false'
  elseif t == 'List' then
    local morceaux = {}
    for i, item in ipairs(v) do
      morceaux[i] = valeur_depuis_meta(item)
    end
    return table.concat(morceaux, ' ')
  elseif t == 'table' then
    return premiere_valeur_non_vide(v)
  else
    -- MetaString, MetaInlines ou MetaBlocks : un scalaire.
    return pandoc.utils.stringify(v)
  end
end

io.write(valeur_depuis_meta(valeur))
os.exit(0)
