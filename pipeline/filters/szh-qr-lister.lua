-- Liste, pour pipeline/liens-courts.py (Shlink), les URL des blocs QR d'un chapitre —
-- qr-link fencé (n'importe où, y compris embarqué dans un falc-header) et lien court `.qr`
-- — SANS réimplémenter le parseur markdown : ce filtre tourne avec le VRAI lecteur pandoc
-- de la compilation ($(LECTEUR) de livre.mk, markdown ou markdown+hard_line_breaks) et se
-- contente d'écrire ce qu'il trouve. Un motif texte (l'ancien --scan de liens-courts.py) ne
-- peut pas distinguer un lien réellement lu comme tel d'un exemple en bloc de code, ni
-- suivre les mêmes règles de lecture que la compilation elle-même — d'où ce filtre plutôt
-- qu'un `re.compile` de plus.
--
-- Sortie : une ligne JSON par lien trouvé, AJOUTÉE (mode "a", jamais tronqué) au fichier
-- désigné par la variable d'environnement SZH_QR_LISTE — jamais sur stdout, que pandoc
-- utilise déjà pour le document transformé (sortie envoyée vers /dev/null côté appelant,
-- voir liens-courts.py, scanner_liens_qr()).
--   {"url":"https://…","tracked":true}
-- `tracked` absent du bloc source -> true, le même défaut que szh-qr.lua/szh-qr-commun.lua
-- (M.analyser_bool). Un lien `tracked=false` est quand même LISTÉ ici (pour audit) mais
-- liens-courts.py ne le résout pas — voir son en-tête.
--
-- Ce filtre ne modifie RIEN : il observe seulement (les fonctions renvoient nil partout),
-- le document rendu n'a aucune importance ici.

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

local function a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

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
