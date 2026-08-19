-- szh-meta.lua — import (F6/WS-D). Consomme les instructions écrites par
-- docx-meta.py (chemin dans SZH_META, format « LETTRE<TAB>valeur ») et retire du
-- corps les blocs déjà partis dans <slug>.meta.yaml :
--   P<TAB>texte  paragraphe à retirer (texte normalisé, file de consommation :
--                chaque ligne ne retire QU'UNE occurrence, la première rencontrée —
--                lignes de tête « Keywords: … », « DOI: … », ligne de revue) ;
--   G<TAB>n      n paragraphes-image de TÊTE (logo licence CC) — retirés seulement
--                tant qu'on est encore dans la zone de tête (adjacents aux P retirés),
--                jamais une figure du corps ;
--   T<TAB>k      k-ième tableau de PREMIER niveau = tableau des auteurs, retiré ici.
--                docx-tables.py lit la MÊME liste et saute les mêmes indices : les
--                tableaux restants gardent une numérotation alignée (RM2) sans que
--                szh-tabelle-reference.lua ait besoin de changer — il ne voit
--                tout simplement plus les tableaux consommés.
-- DOIT tourner AVANT szh-legendes/szh-titres (un bloc consommé ne doit être ni
-- légendé ni promu). Idempotent : sans SZH_META ou fichier vide, document inchangé.
-- ⚠ Les paragraphes stylés Title/Subtitle/Author/Abstract n'ont PAS de ligne P :
-- pandoc les mappe lui-même en métadonnées (jetées au writer, D49) — ils ne sont
-- jamais des blocs du corps.

local utils = pandoc.utils

-- Normalisation IDENTIQUE à docx-meta.py / docx-titres.py / szh-titres.lua :
-- espaces spéciaux -> espace, tirets spéciaux -> '-', espaces compactés, rogné.
local function normaliser(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  t = t:gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', '')
  return t
end

local function charger()
  local chemin = os.getenv('SZH_META')
  if not chemin or chemin == '' then return nil end
  local f = io.open(chemin, 'r')
  if not f then return nil end
  local instr = { p = {}, np = 0, g = 0, t = {}, nt = 0 }
  for ligne in f:lines() do
    local lettre, valeur = ligne:match('^(%u)\t(.*)$')
    if lettre == 'P' then
      local clef = normaliser(valeur)
      if clef ~= '' then
        instr.p[clef] = (instr.p[clef] or 0) + 1
        instr.np = instr.np + 1
      end
    elseif lettre == 'G' then
      instr.g = tonumber(valeur) or 0
    elseif lettre == 'T' then
      local k = tonumber(valeur)
      if k then instr.t[k] = true; instr.nt = instr.nt + 1 end
    end
  end
  f:close()
  if instr.np == 0 and instr.g == 0 and instr.nt == 0 then return nil end
  return instr
end

-- Un Para/Plain dont le seul contenu significatif est une ou des images.
local function bloc_image_seule(b)
  if b.t ~= 'Para' and b.t ~= 'Plain' then return false end
  local image = false
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then image = true
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then return false end
  end
  return image
end

function Pandoc(doc)
  local instr = charger()
  if not instr then return doc end
  local sortie = pandoc.List()
  local retires_p, retires_t, retires_g = 0, 0, 0
  local ordinal = 0                       -- tableaux de premier niveau (ordre du doc)
  local tete = true                       -- encore dans la zone de tête consommée ?
  for _, b in ipairs(doc.blocks) do
    local garder = true
    if b.t == 'Table' then
      ordinal = ordinal + 1
      if instr.t[ordinal] then
        garder = false
        retires_t = retires_t + 1
      end
      tete = false
    elseif b.t == 'Para' or b.t == 'Plain' then
      local clef = normaliser(utils.stringify(b))
      if clef ~= '' and instr.p[clef] and instr.p[clef] > 0 then
        instr.p[clef] = instr.p[clef] - 1
        garder = false
        retires_p = retires_p + 1
      elseif tete and retires_g < instr.g and bloc_image_seule(b) then
        garder = false                    -- logo licence CC de la tête
        retires_g = retires_g + 1
      elseif clef ~= '' then
        tete = false                      -- le vrai corps a commencé
      end
    elseif b.t == 'Header' then
      -- l'en-tête de section du tableau des auteurs (« Autrices et auteurs ») est
      -- consigné en ligne P par docx-meta.py : apparié ici aussi sur les Header.
      local clef = normaliser(utils.stringify(b))
      if clef ~= '' and instr.p[clef] and instr.p[clef] > 0 then
        instr.p[clef] = instr.p[clef] - 1
        garder = false
        retires_p = retires_p + 1
      end
      tete = false
    else
      tete = false
    end
    if garder then sortie:insert(b) end
  end
  doc.blocks = sortie
  -- Une ligne P sans correspondance n'est PAS une erreur (ex. ligne Keywords stylée
  -- Abstract, déjà mappée en métadonnées par pandoc) — on le signale, sans échouer.
  local restants = 0
  for _, n in pairs(instr.p) do restants = restants + n end
  io.stderr:write(string.format(
    '[import] méta : %d paragraphe(s), %d logo(s), %d tableau(x) auteurs retirés%s\n',
    retires_p, retires_g, retires_t,
    restants > 0 and string.format(' (%d instruction(s) sans correspondance)', restants) or ''))
  return doc
end
