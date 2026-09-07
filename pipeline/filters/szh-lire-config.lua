-- Lit UNE clé de premier niveau d'un YAML (ausgabe.yaml, buch.yaml, une fiche <slug>.meta.yaml)
-- et l'imprime sur stdout, sans fin de ligne, en passant par le lecteur pandoc lui-même :
-- le Makefile lit ainsi la configuration exactement comme pandoc la relira à la compilation.
-- Remplace l'analyseur ligne à ligne maison qu'il portait jusqu'ici.
--
--   pandoc lua szh-lire-config.lua <fichier.yaml> <cle>
--
-- Méthode : le fichier est enveloppé dans un bloc de métadonnées markdown (--- ... ---) et
-- lu par pandoc.read(texte, 'markdown-smart') ; le « -smart » coupe la conversion des
-- guillemets droits, apostrophes et tirets en signes typographiques, pour rendre les
-- scalaires tels quels (une couleur #5F9FBC, un slug avec un double tiret, un titre qui finit
-- par "..."). La clé cherchée est ensuite lue dans doc.meta[cle].
--
-- Ce qu'imprime chaque forme :
--   cle: valeur                     -> valeur (MetaString/MetaInlines, stringifiée)
--   cle: [a, b, "c d"]               -> a b c d (MetaList, éléments stringifiés, un espace)
--   cle:                            -> bloc, selon ce qui suit :
--     - a                              liste en blocs (MetaList) -> a b
--     - b
--   cle:                            -> bloc map (MetaMap) -> la première valeur non vide,
--     fr: Bonjour                      dans un ordre déterministe : fr, de, it, en, puis les
--     de: Hallo                        autres clés triées (pandoc rend une map en table Lua,
--                                       et l'ordre d'itération d'une table n'est pas celui du
--                                       fichier)
--   cle: true / false                -> MetaBool -> "true" / "false"
--
-- Code de sortie : 0 si la clé existe (valeur vide ou non) ; 1 si elle est absente, si le
-- fichier est illisible, ou si pandoc.read échoue sur le contenu.
--
-- Clé présente mais sans valeur (`cle:`, `cle: ""`, `cle: ~`) : mesuré à la main sous pandoc
-- 3.5, dans les combinaisons LF/CRLF et avec/sans BOM, en fin de fichier et suivie d'une
-- autre clé : la clé reste présente dans doc.meta (MetaString ou MetaInlines vide), jamais
-- omise. Le repli textuel envisagé pour ce cas n'est donc pas nécessaire ici.
--
-- BOM UTF-8 en tête : ôté avant l'enveloppe. Sans ce retrait, pandoc.read échoue (« did not
-- find expected <document start> ») car le BOM atterrit au milieu de la première ligne, entre
-- le "---" d'ouverture et le nom de la première clé. CRLF : laissé tel quel, pandoc.read le
-- digère seul (mesuré, y compris pour une liste en blocs).

local chemin, cle = arg[1], arg[2]
if not chemin or not cle or cle == '' then
  io.stderr:write('usage : pandoc lua szh-lire-config.lua <fichier.yaml> <cle>\n')
  os.exit(2)
end

local fh = io.open(chemin, 'r')
if not fh then os.exit(1) end
local brut = fh:read('a') or ''
fh:close()

-- BOM UTF-8 en tête seulement : un BOM ailleurs dans le texte n'arrive jamais dans nos fiches.
brut = brut:gsub('^\239\187\191', '')

local texte = '---\n' .. brut .. '\n---\n'
local ok, doc = pcall(pandoc.read, texte, 'markdown-smart')
if not ok then os.exit(1) end

local valeur = doc.meta[cle]
if valeur == nil then os.exit(1) end

-- Ordre déterministe pour une MetaMap (title: fr/de/..., impression: grammage/dos-mm/...).
local ORDRE_LANGUES = { 'fr', 'de', 'it', 'en' }

-- Convertit une valeur de meta (quel que soit son type pandoc) en la chaîne de sortie.
-- Déclarée d'avance : elle et premiere_valeur_non_vide s'appellent l'une l'autre.
local valeur_depuis_meta

-- MetaMap -> la première sous-valeur non vide, dans l'ordre déterministe ci-dessus.
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
    -- 'string' (MetaString), 'Inlines' (MetaInlines), 'Blocks' (MetaBlocks) : un scalaire.
    return pandoc.utils.stringify(v)
  end
end

io.write(valeur_depuis_meta(valeur))
os.exit(0)
