-- Aperçu seulement : donne aux titres l'identifiant que la chaîne PDF leur donne.
--
-- L'aperçu lit le .md avec `commonmark_x` (voir szh-sourcepos.lua), le PDF avec `markdown`.
-- Dès qu'un titre porte de la ponctuation, les deux lecteurs en tirent des identifiants
-- différents :
--
--     ## Titre principal : le grand     markdown -> titre-principal-le-grand
--                                    commonmark_x -> titre-principal--le-grand
--     ## Fachbücher & Filme             markdown -> fachbücher-filme
--                                    commonmark_x -> fachbücher--filme
--     ## 50 % des élèves                markdown -> des-élèves
--                                    commonmark_x -> 50--des-élèves
--
-- Sans ce filtre, les liens internes « [Rubrique](#rubrique) » (tables des matières des
-- articles de documentation) mènent nulle part dans l'aperçu, sans rien signaler.
--
-- L'identifiant est demandé à pandoc : on relit « # <texte> » avec le lecteur `markdown`.
-- Réécrire sa règle demanderait de classer les lettres accentuées à la main.
--
-- Un identifiant écrit à la main (« ## Titre {#mon-ancre} ») est conservé : on ne touche
-- au titre que s'il porte exactement l'identifiant que commonmark aurait calculé. Quelques
-- titres restent différents parce que les deux lecteurs n'en lisent pas le même texte
-- (contre-oblique, souligné, « ... ») ; le filtre les laisse tels quels.

local utils = pandoc.utils

-- Identifiant que le lecteur donné tire d'un texte de titre (déjà aplati), ou nil.
local function identifiant_selon(lecteur, texte)
  local ok, doc = pcall(pandoc.read, '# ' .. texte, lecteur)
  if not ok then return nil end
  local premier = doc.blocks[1]
  if not premier or premier.t ~= 'Header' then return nil end
  if premier.identifier == '' then return nil end
  return premier.identifier
end

-- Ajoute le suffixe que pandoc donne à un identifiant déjà pris (-1, -2, …). Un compteur
-- par lecteur : sans eux, le deuxième « ## Même titre » passerait pour un identifiant
-- écrit à la main.
local function unique(vus, base)
  local n = vus[base]
  if n == nil then
    vus[base] = 0
    return base
  end
  vus[base] = n + 1
  return base .. '-' .. (n + 1)
end

local vus_commonmark, vus_markdown = {}, {}

function Header(h)
  if h.identifier == '' then return nil end
  local texte = utils.stringify(h.content)
  if texte == '' then return nil end

  local base_cm = identifiant_selon('commonmark_x', texte)
  local base_md = identifiant_selon('markdown', texte)
  if base_cm == nil or base_md == nil then return nil end

  -- Les compteurs avancent même si le titre reste tel quel : il occupe son rang parmi les
  -- doublons.
  local attendu = unique(vus_commonmark, base_cm)
  local vise = unique(vus_markdown, base_md)

  -- Identifiant écrit dans le .md : conservé.
  if h.identifier ~= attendu then return nil end
  if vise == h.identifier then return nil end

  h.identifier = vise
  return h
end
