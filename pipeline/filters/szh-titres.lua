-- szh-titres.lua — import (AX4/D63). Consomme le fichier produit par docx-titres.py
-- (chemin dans SZH_TITRES) : une ligne « niveau<TAB>texte » par titre déduit. Promeut
-- les paragraphes de PREMIER NIVEAU (enfants directs du document) dont le texte
-- normalisé correspond en Header(niveau). N'agit QUE sur les blocs de tête (jamais
-- dans une liste ou un tableau : Pandoc(doc) n'itère que doc.blocks). Idempotent :
-- sans fichier SZH_TITRES ou sans correspondance, le document est renvoyé tel quel.

local utils = pandoc.utils

-- Normalisation IDENTIQUE à docx-titres.py (sinon l'appariement échoue) :
-- espaces spéciaux -> espace, tirets spéciaux -> '-', espaces compactés, rogné.
local function normaliser(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  t = t:gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', '')
  return t
end

-- file d'attente des niveaux par texte -> gère les doublons et l'ordre du document.
local function charger()
  local chemin = os.getenv('SZH_TITRES')
  if not chemin or chemin == '' then return nil end
  local f = io.open(chemin, 'r')
  if not f then return nil end
  local attendus, n = {}, 0
  for ligne in f:lines() do
    local niveau, texte = ligne:match('^(%d+)\t(.*)$')
    if niveau and texte then
      local clef = normaliser(texte)
      attendus[clef] = attendus[clef] or {}
      table.insert(attendus[clef], tonumber(niveau))
      n = n + 1
    end
  end
  f:close()
  if n == 0 then return nil end
  return attendus
end

-- Déballe gras/souligné/span : un titre n'a pas besoin de ces couches.
local function deballer(liste)
  local out = pandoc.List()
  for _, i in ipairs(liste) do
    if i.t == 'Strong' or i.t == 'Underline' or i.t == 'Span' or i.t == 'Emph' then
      out:extend(deballer(i.content))
    else
      out:insert(i)
    end
  end
  return out
end

function Pandoc(doc)
  local attendus = charger()
  if not attendus then return doc end
  local sortie = pandoc.List()
  for _, b in ipairs(doc.blocks) do
    local remplace = nil
    if b.t == 'Para' then
      local clef = normaliser(utils.stringify(b))
      local file = attendus[clef]
      if file and #file > 0 then
        local niveau = table.remove(file, 1)
        remplace = pandoc.Header(niveau, deballer(b.content))
      end
    end
    sortie:insert(remplace or b)
  end
  doc.blocks = sortie
  return doc
end
