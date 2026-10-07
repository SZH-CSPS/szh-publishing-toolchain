-- Liste les URL des QR d'un chapitre (blocs qr-link, y compris dans un falc-header, et
-- liens `.qr`) pour pipeline/liens-courts.py, qui en fait des liens courts Shlink. Le
-- chapitre est lu par le même lecteur pandoc que la compilation : un exemple dans un bloc
-- de code n'est pas pris pour un lien.
--
-- Sortie : une ligne JSON par QR, ajoutée au fichier nommé par SZH_QR_LISTE (stdout porte
-- le document, que liens-courts.py jette) :
--   {"url":"https://…","tracked":true}
-- `tracked` vaut true par défaut, comme dans szh-qr.lua. Un QR `tracked=false` est listé,
-- mais liens-courts.py ne le raccourcit pas.
--
-- Le document n'est pas modifié.

local function dossier_ce_fichier()
  local source = debug.getinfo(1, 'S').source
  if source:sub(1, 1) == '@' then source = source:sub(2) end
  return source:match('^(.*[/\\])') or ''
end
local DOSSIER = dossier_ce_fichier()

local ok_qr, commun_qr = pcall(dofile, DOSSIER .. 'szh-qr-commun.lua')
if not ok_qr or type(commun_qr) ~= 'table' or type(commun_qr.analyser_bool) ~= 'function' then
  io.stderr:write('[szh-qr-lister] module szh-qr-commun.lua introuvable ou invalide\n')
  os.exit(1, true)
end

local ok_commun, commun = pcall(dofile, DOSSIER .. 'szh-commun.lua')
if not ok_commun or type(commun) ~= 'table' then
  io.stderr:write('[szh-qr-lister] module szh-commun.lua introuvable ou invalide\n')
  os.exit(1, true)
end

local CHEMIN_SORTIE = os.getenv('SZH_QR_LISTE')

local function json_echapper(s)
  return (tostring(s or ''):gsub('[\\"]', '\\%0'):gsub('\n', '\\n'))
end

local function ecrire(url, tracked)
  if not CHEMIN_SORTIE or CHEMIN_SORTIE == '' or url == '' then return end
  local fh = io.open(CHEMIN_SORTIE, 'a')
  if not fh then return end
  fh:write('{"url":"' .. json_echapper(url) .. '","tracked":' .. tostring(tracked) .. '}\n')
  fh:close()
end

local a_classe = commun.a_classe

local function Div(el)
  if not a_classe(el, 'qr-link') then return nil end
  local url = (pandoc.utils.stringify(el.content) or ''):gsub('^%s+', ''):gsub('%s+$', '')
  local tracked = commun_qr.analyser_bool(el.attributes and el.attributes['tracked'], true)
  ecrire(url, tracked)
  return nil
end

local function Link(el)
  if not a_classe(el, 'qr') then return nil end
  local tracked = commun_qr.analyser_bool(el.attributes and el.attributes['tracked'], true)
  ecrire(el.target, tracked)
  return nil
end

return { { Div = Div, Link = Link } }
