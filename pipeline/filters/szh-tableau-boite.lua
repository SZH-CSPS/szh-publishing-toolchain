-- Enveloppe chaque tableau dans un <div class="szh-tableau-boite"> qui ne se coupe pas.
--
-- WeasyPrint entoure un <table> qui a une <caption> d'une boîte anonyme qui porte la
-- légende. Aucun sélecteur CSS n'atteint cette boîte, et `break-inside: avoid` posé sur
-- `table` ne la retient pas. Si elle se coupe entre la légende et la table, le balisage
-- échoue (WeasyPrint 69) :
--
--   File ".../weasyprint/formatting_structure/boxes.py", line 407, in get_wrapped_table
--   ValueError: Table wrapper without a table
--
-- Le Makefile rattrape alors l'échec et sort un PDF non balisé, donc non conforme PDF/UA,
-- sans erreur visible : seule la vérification `verifier-ua` le montre. Le défaut dépend de
-- la position exacte du tableau sur la page.
--
-- Le Div, lui, est atteignable en CSS : `break-inside: avoid` sur lui tient la légende et
-- la table ensemble. Le filtre sert aux livres comme à la revue.
--
-- À l'écran, la boîte défile quand le tableau est plus large qu'elle (`overflow-x: auto`,
-- print.css et web.css). Pour qu'on puisse la faire défiler au clavier, elle est une région
-- focalisable : tabindex="0", role="region", et un nom, la légende du tableau
-- (aria-labelledby) ou, sans légende, « Tableau » dans la langue du document. WeasyPrint
-- ignore ces trois attributs.
--
-- Identifiants : l'éditeur du cockpit écrit des id sans numéro de tableau (szh-th-r0c1),
-- et szh-numerotation.lua numérote les descriptions et les notes par unité compilée. Deux
-- tableaux complexes d'un même document, ou deux chapitres d'un livre assemblé, auraient
-- les mêmes id, et les headers= du second viseraient le premier. Chaque id interne au
-- tableau est donc préfixé par le rang du tableau dans le document, et par le rang du
-- chapitre dans un livre (SZH_CHAPITRE) : szh-th-r0c1 devient szh-t2-th-r0c1, ou
-- szh-c3-t2-th-r0c1. Les headers=, aria-describedby et aria-labelledby qui les citent
-- suivent. Un fichier de tableau déjà écrit garde ses id ; seule la sortie change.
--
-- S'exécute après szh-tabelle-inclure (qui insère les tableaux) et après szh-numerotation
-- (qui ne compte que les tableaux enfants directs du document, et qui ajoute au même
-- RawBlock la note et la description du tableau).

local CLASSE = 'szh-tableau-boite'

-- Nom de la région quand le tableau n'a pas de légende.
local NOM_REPLI = { fr = 'Tableau', de = 'Tabelle', it = 'Tabella' }

-- Attributs dont la valeur est une liste d'id.
local ATTRIBUTS_IDS = { 'id', 'headers', 'aria-describedby', 'aria-labelledby' }

local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[tableau-boite] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local function echap_attribut(s)
  return (s:gsub('&', '&amp;'):gsub('"', '&quot;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function motif(nom) return (nom:gsub('%-', '%%-')) end

-- Remplace, dans les attributs de ATTRIBUTS_IDS, chaque id présent dans `nouveaux`.
local function renommer_ids(html, nouveaux)
  for _, nom in ipairs(ATTRIBUTS_IDS) do
    for _, q in ipairs({ '"', "'" }) do
      html = html:gsub('(%s' .. motif(nom) .. '%s*=%s*' .. q .. ')([^' .. q .. ']*)(' .. q .. ')',
        function(avant, valeur, apres)
          local jetons = {}
          for jeton in valeur:gmatch('%S+') do jetons[#jetons + 1] = nouveaux[jeton] or jeton end
          return avant .. table.concat(jetons, ' ') .. apres
        end)
    end
  end
  return html
end

-- Préfixe les id définis dans le HTML d'un tableau, et les références qui les citent.
local function prefixer_ids(html, prefixe)
  local nouveaux = {}
  for _, q in ipairs({ '"', "'" }) do
    for id in html:gmatch('%sid%s*=%s*' .. q .. '([^' .. q .. ']+)' .. q) do
      nouveaux[id] = prefixe .. (id:gsub('^szh%-', ''))
    end
  end
  if next(nouveaux) == nil then return html end
  return renommer_ids(html, nouveaux)
end

-- Pose un id sur la première <caption> non vide du HTML, et le rend avec le HTML. Rend nil
-- comme id sans légende.
local function id_legende(html, id)
  local d, f, attrs = html:find('<[cC][aA][pP][tT][iI][oO][nN]([^>]*)>')
  if not d then return html, nil end
  local fin = html:find('</[cC][aA][pP][tT][iI][oO][nN]%s*>', f + 1)
  if not fin or html:sub(f + 1, fin - 1):gsub('<[^>]*>', ''):match('^%s*$') then
    return html, nil
  end
  local existant = attrs:match('%sid%s*=%s*"([^"]+)"') or attrs:match("%sid%s*=%s*'([^']+)'")
  if existant then return html, existant end
  return html:sub(1, f - 1) .. ' id="' .. id .. '">' .. html:sub(f + 1), id
end

local function ouvrante(nom)
  local a = ' tabindex="0" role="region"'
  if nom.id then return '<div class="' .. CLASSE .. '"' .. a .. ' aria-labelledby="' .. nom.id .. '">' end
  return '<div class="' .. CLASSE .. '"' .. a .. ' aria-label="' .. echap_attribut(nom.texte) .. '">'
end

function Pandoc(doc)
  local lang = commun.contexte(doc.meta).lang
  local repli = NOM_REPLI[lang] or NOM_REPLI.fr
  local chapitre = tonumber(os.getenv('SZH_CHAPITRE') or '')
  local n = 0
  local function prefixe()
    return 'szh-' .. (chapitre and ('c' .. chapitre .. '-') or '') .. 't' .. n .. '-'
  end

  doc.blocks = doc.blocks:walk({
    -- Tableaux écrits en markdown : leur légende est nommée par son texte.
    Table = function(t)
      n = n + 1
      local legende = pandoc.utils.stringify(t.caption.long or {})
      local attrs = { tabindex = '0', role = 'region',
                      ['aria-label'] = legende:match('%S') and legende or repli }
      return pandoc.Div({ t }, pandoc.Attr('', { CLASSE }, attrs))
    end,

    -- Tableaux insérés par szh-tabelle-inclure, en RawBlock html : on les entoure de deux
    -- RawBlock pour laisser leur HTML intact, hors id. On cherche la balise ouvrante
    -- <table, pas le mot « table ».
    RawBlock = function(b)
      if b.format ~= 'html' and b.format ~= 'html5' then return nil end
      if not b.text:lower():find('<table') then return nil end
      n = n + 1
      local p = prefixe()
      local html = prefixer_ids(b.text, p)
      local id
      html, id = id_legende(html, p .. 'legende')
      return {
        pandoc.RawBlock('html', ouvrante({ id = id, texte = repli })),
        pandoc.RawBlock(b.format, html),
        pandoc.RawBlock('html', '</div>'),
      }
    end,
  })
  return doc
end
