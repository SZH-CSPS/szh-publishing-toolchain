-- szh-legendes.lua — import (AX5/D28-D30, ravivé de attic/szh-import.lua).
-- « Bake » les légendes dans le .md à l'import (ré-import assumé) :
--   * FIGURES : une image seule dans un Para + un paragraphe VOISIN tout en gras
--     (avant OU après) = légende -> l'image reçoit cette légende comme alt
--     (numéro « Figure N » nettoyé), et le paragraphe gras est RETIRÉ. Au rendu,
--     szh-figure.lua en fait un <figure><figcaption>.
--   * TABLEAUX : docx-tables.py a déjà baké le <caption> dans tables/table-NN.html
--     et consigné le texte des légendes prises (SZH_LEGENDES_TABLES) -> ici on
--     RETIRE simplement les paragraphes gras correspondants du .md (pas de doublon).
-- CONSERVATEUR : sans légende gras voisine claire, l'image/tableau reste tel quel.
-- Idempotent : sans voisin gras et sans sidecar, le document est renvoyé inchangé.

local utils = pandoc.utils

local function assainir(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return t
end
local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function s(x) return assainir(utils.stringify(x)) end
-- normalisation IDENTIQUE à docx-tables.py (appariement des légendes de tableau).
local function normaliser(t)
  return (assainir(t):gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Un ensemble d'inlines est-il ENTIÈREMENT en gras (hors espaces) ?
local function tout_gras(inls)
  local reel = 0
  for _, i in ipairs(inls) do
    if i.t ~= 'Space' and i.t ~= 'SoftBreak' then
      if i.t ~= 'Strong' then return false end
      reel = reel + 1
    end
  end
  return reel > 0
end

-- Nettoyage du numéro de figure en tête de légende (num. auto par CSS, D31).
local MOTS_FIGURE = { '^[Ff]igure%s+%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[FfAa]bb?%.%s*%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[Aa]bbildung%s+%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[Ii]llustration%s+%d+[a-z]?%s*[:%.%-–—]?%s*' }
local function nettoyer_figure(txt)
  for _, m in ipairs(MOTS_FIGURE) do
    if txt:match(m) then return trim(txt:gsub(m, '', 1)) end
  end
  return txt
end

-- Un Para dont le SEUL contenu significatif est une image -> renvoie l'image.
local function para_image(b)
  if b.t ~= 'Para' then return nil end
  local img = nil
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then
      if img then return nil end             -- plusieurs images : ne pas toucher
      img = x
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then
      return nil
    end
  end
  return img
end

local function charger_legendes_table()
  local ens = {}
  local chemin = os.getenv('SZH_LEGENDES_TABLES')
  if not chemin or chemin == '' then return ens end
  local f = io.open(chemin, 'r')
  if not f then return ens end
  for ligne in f:lines() do
    local clef = normaliser(ligne)
    if clef ~= '' then ens[clef] = true end
  end
  f:close()
  return ens
end

function Pandoc(doc)
  local legT = charger_legendes_table()
  local nfig, ntab = 0, 0

  -- 1) retirer les paragraphes gras déjà bakés en <caption> de tableau
  local blocs = pandoc.List()
  for _, b in ipairs(doc.blocks) do
    if b.t == 'Para' and next(legT) ~= nil and tout_gras(b.content)
       and legT[normaliser(s(b))] then
      ntab = ntab + 1                         -- retiré du .md
    else
      blocs:insert(b)
    end
  end

  -- 2) figures : image seule + légende gras voisine (avant, puis après)
  local consommes = {}
  local sortie = pandoc.List()
  for idx, b in ipairs(blocs) do
    if consommes[idx] then goto continue end
    local img = para_image(b)
    if img then
      local cap, capidx = nil, nil
      for _, j in ipairs({ idx - 1, idx + 1 }) do
        local v = blocs[j]
        if v and v.t == 'Para' and not consommes[j] and not para_image(v)
           and tout_gras(v.content) then
          cap = trim(nettoyer_figure(s(v)))
          capidx = j
          break
        end
      end
      if cap and cap ~= '' then
        consommes[capidx] = true
        if capidx == idx - 1 then sortie:remove(#sortie) end
        img.caption = pandoc.Inlines({ pandoc.Str(cap) })   -- alt = légende
        sortie:insert(pandoc.Para({ img }))
        nfig = nfig + 1
      else
        sortie:insert(b)
      end
    else
      sortie:insert(b)
    end
    ::continue::
  end

  doc.blocks = sortie
  io.stderr:write(string.format(
    '[import] %d figure(s) légendée(s), %d tableau(x) légendé(s)\n', nfig, ntab))
  return doc
end
