-- Pose le contexte de composition en tête de chaque chaîne (pipeline/filtres.mk) :
-- meta.lang (deux lettres), meta['szh-produit'] (revue, zeitschrift ou livre) et
-- meta['szh-unite'] (article ou chapitre). Les filtres suivants le relisent par
-- commun.contexte() ; le calcul est calculer_contexte() de szh-commun.lua.
--
-- Une fiche sans langue est signalée et une langue inconnue bloque, seulement à la
-- compilation d'un article : l'aperçu ne s'arrête pas sur une fiche mal remplie.

local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[contexte] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

function Meta(meta)
  local apercu = (os.getenv('SZH_APERCU') or '') ~= ''
  local c = commun.calculer_contexte(meta, not apercu)
  meta.lang = pandoc.MetaString(c.lang)
  meta['szh-produit'] = pandoc.MetaString(c.produit)
  meta['szh-unite'] = pandoc.MetaString(c.unite)
  return meta
end
