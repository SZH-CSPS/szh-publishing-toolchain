-- La forme imprimée d'une date de fiche, pour l'aperçu du cockpit (lib/date-apercu.js) : les
-- fonctions de szh-commun.lua, celles de la compilation, appliquées à une saisie.
--
--   echo '{"saisie":"date|date_partielle|plage","lang":"fr|de","valeurs":["…","…"]}' | pandoc lua szh-date-apercu.lua
--
-- Sortie : {"forme":"05.01.2026"}, ou {"forme":"30.02.2026","erreur":"impossible"}. `forme`
-- dit toujours ce que le PDF imprimerait, même quand la saisie est fautive. La demande vient
-- sur stdin : une valeur tapée dans le formulaire ne passe jamais par un shell. La langue est
-- reçue sans servir, l'imprimé étant le même en fr et en de. Code 2 si la demande est
-- illisible.

local function dossier_ce_fichier()
  local source = debug.getinfo(1, 'S').source
  if source:sub(1, 1) == '@' then source = source:sub(2) end
  return source:match('^(.*[/\\])') or ''
end
local ok, commun = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
if not ok or type(commun) ~= 'table' then
  io.stderr:write('[date-apercu] szh-commun.lua introuvable ou fautif (' .. tostring(commun) .. ')\n')
  os.exit(1, true)
end

local function refuser(motif)
  io.stderr:write('[date-apercu] ' .. motif .. '\n')
  os.exit(2, true)
end

local lu, demande = pcall(pandoc.json.decode, io.read('a') or '', false)
if not lu or type(demande) ~= 'table' then refuser('demande illisible') end
local valeurs = type(demande.valeurs) == 'table' and demande.valeurs or {}
local v1 = type(valeurs[1]) == 'string' and valeurs[1] or ''
local v2 = type(valeurs[2]) == 'string' and valeurs[2] or ''

local forme
if demande.saisie == 'date' then
  forme = commun.date_suisse(v1)
elseif demande.saisie == 'date_partielle' then
  forme = commun.date_partielle_suisse(v1)
elseif demande.saisie == 'plage' then
  forme = commun.plage_date(v1, v2)
else
  refuser('saisie inconnue : ' .. tostring(demande.saisie))
end

local sortie = { forme = forme or '' }
sortie.erreur = commun.verifier_date(demande.saisie, v1, v2)
io.write(pandoc.json.encode(sortie))
