-- Fonctions partagées entre les filtres pandoc du pipeline : slug_article(), a_classe(),
-- trim(), texte(), lire_cle() / parse_scalar(), les constats au format à codes, et le
-- contexte de composition (langue, produit, unité). Chargé par dofile — le dossier
-- se retrouve par debug.getinfo(1, 'S').source, pas par PANDOC_SCRIPT_FILE (le patron déjà
-- en production, szh-numerotation.lua ~l.51-52 pour szh-apercu-lecteur-ecran.lua) : cette
-- variable nomme le script que pandoc a reçu en ligne de commande, pas le fichier qui
-- l'appelle par dofile — mesuré sur test/js/ancrages.test.js, qui charge szh-citations.lua
-- par un harnais Lua situé ailleurs (« pandoc lua harnais.lua szh-citations.lua » :
-- PANDOC_SCRIPT_FILE y vaut le harnais, jamais szh-citations.lua). debug.getinfo, lui, nomme
-- toujours le fichier qui l'appelle, quel que soit le chemin qui l'a amené à s'exécuter.
-- Un chargement raté est ici une panne et non un repli silencieux : un filtre qui ne sait
-- plus dire le slug de l'article ou sa langue ne doit pas composer une page qui a l'air
-- correcte. Chaque appelant s'arrête donc net (voir le patron au format en tête de
-- szh-citations.lua, szh-numerotation.lua, szh-niveaux.lua et szh-ressource.lua) plutôt que
-- de retomber sur une copie locale.
--
--   local function dossier_ce_fichier()
--     local source = debug.getinfo(1, 'S').source
--     if source:sub(1, 1) == '@' then source = source:sub(2) end
--     return source:match('^(.*[/\\])') or ''
--   end
--   local ok, commun = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
--   if not ok or type(commun) ~= 'table' then ... os.exit(1, true) ... end
--
-- Le contexte de composition (langue, produit, unité) se calcule ici, une fois, dans
-- calculer_contexte() ; szh-contexte.lua le pose en tête de chaque chaîne et les filtres le
-- relisent par contexte(). Un filtre qui n'a besoin de rien d'autre ne charge pas ce module
-- pour la forme.

local M = {}

-- ---------------------------------------------------------------------------------------
-- Slug de l'unité en cours de compilation (article ou chapitre), tiré du fichier d'entrée
-- que pandoc compile : le Makefile fait `cd` dans le dossier de l'unité avant d'invoquer
-- pandoc, donc PANDOC_STATE.input_files[1] est <slug>.md. Quatre copies mesurées avant ce
-- module (szh-maquette.lua, szh-citations.lua, szh-numerotation.lua — en ligne, dans
-- langue_fiche() — et szh-niveaux.lua) : les trois premières rendent '' quand aucun fichier
-- d'entrée n'est trouvé, la quatrième 'article' (un mot pour un message, jamais un slug
-- réel). `repli` couvre cet unique écart ; omis, il vaut ''.
function M.slug_article(repli)
  local fichiers = (PANDOC_STATE and PANDOC_STATE.input_files) or {}
  local chemin = fichiers[1]
  if type(chemin) ~= 'string' then return repli or '' end
  return (chemin:gsub('.*[/\\]', ''):gsub('%.md$', ''))
end

-- Vrai si l'attribut pandoc `el` porte la classe `nom`.
function M.a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

function M.trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end

-- ---------------------------------------------------------------------------------------
-- Scalaire YAML « nu / "..." / '...' » (miroir de decouperValeurYaml du cockpit) :
-- guillemets échappés, coupe au commentaire « espace(s) + # ».
function M.parse_scalar(reste)
  reste = reste:gsub('%s+$', '')
  local q = reste:sub(1, 1)
  if q == '"' then
    local fin = 2
    while fin <= #reste do
      local c = reste:sub(fin, fin)
      if c == '\\' then fin = fin + 2
      elseif c == '"' then break
      else fin = fin + 1 end
    end
    return reste:sub(2, fin - 1):gsub('\\(["\\])', '%1')
  elseif q == "'" then
    local m = reste:match("^'(.-)'%s*$")
    if m then return (m:gsub("''", "'")) end
  end
  local pos = reste:find('%s+#')
  if reste:sub(1, 1) == '#' then return '' end
  if pos then reste = reste:sub(1, pos - 1) end
  return (reste:gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Valeur d'une clé scalaire de premier niveau d'un YAML plat, lue hors pandoc, ou '' : la
-- fusion des métadonnées ne dit pas de quel fichier une clé vient.
function M.lire_cle(chemin, cle)
  if not chemin or chemin == '' then return '' end
  local fh = io.open(chemin, 'r')
  if not fh then return '' end
  local valeur = ''
  for ligne in fh:lines() do
    local m = ligne:match('^' .. cle .. ':%s*(.*)$')
    if m then valeur = M.parse_scalar(m); break end
  end
  fh:close()
  return valeur
end

-- Texte d'une valeur de métadonnées, sans blancs autour ; '' si elle est absente ou ne se
-- lit pas.
function M.texte(v)
  if v == nil then return '' end
  local ok, r = pcall(pandoc.utils.stringify, v)
  if not ok then return '' end
  return (r:gsub('^%s+', ''):gsub('%s+$', ''))
end

-- ---------------------------------------------------------------------------------------
-- Constats au format à codes de docs/ARCHITECTURE.md, miroir de
-- szh_commun.formater_avertissement côté Python :
--   [<source>-<ton>] <code> | <champ> | … | <phrase fr> | [de] <phrase de>
-- Les valeurs partent telles quelles : ôter les « | » qu'un texte pourrait porter
-- (sans_barre) revient à l'appelant.
function M.sans_barre(t) return (tostring(t):gsub('|', '/')) end

function M.ligne_constat(source, ton, code, champs, fr, de)
  local morceaux = { '[' .. source .. '-' .. ton .. '] ' .. code }
  for _, c in ipairs(champs or {}) do morceaux[#morceaux + 1] = c end
  morceaux[#morceaux + 1] = fr
  morceaux[#morceaux + 1] = '[de] ' .. de
  return table.concat(morceaux, ' | ')
end

function M.constat(source, ton, code, champs, fr, de)
  io.stderr:write(M.ligne_constat(source, ton, code, champs, fr, de) .. '\n')
  io.stderr:flush()
end

-- Ajoute la ligne au journal d'import (SZH_IMPORT_LOG) quand la variable est posée : pandoc
-- ne l'écrit pas pour les filtres. Miroir de szh_commun.journaliser côté Python.
function M.journaliser(ligne)
  local journal = os.getenv('SZH_IMPORT_LOG')
  if not journal or journal == '' then return end
  local f = io.open(journal, 'a')
  if f then
    f:write(ligne .. '\n')
    f:close()
  end
end

-- Arrêt de la compilation. Le constat part d'abord seul : `error()` l'enroberait d'une pile
-- d'appels illisible dans le panneau. L'`error` qui suit os.exit ne sert que si un pandoc
-- futur cessait de l'honorer.
function M.bloquer(source, code, champs, fr, de)
  M.constat(source, 'blocage', code, champs, fr, de)
  os.exit(1, true)
  error(code, 0)
end

-- ---------------------------------------------------------------------------------------
-- Les trois langues de la maison. L'anglais n'en est pas : ni libellé de résumé, ni mention
-- de licence, ni titre de bloc auteurs n'existent pour lui.
M.LANGUES = { fr = true, de = true, it = true }

-- Nom d'une langue dans une phrase, en français et en allemand.
M.EN_LANGUE = {
  fr = { fr = 'en français',      de = 'en allemand',   it = 'en italien' },
  de = { fr = 'auf Französisch',  de = 'auf Deutsch',   it = 'auf Italienisch' },
}

local function chp_article(slug) return 'article « ' .. slug .. ' »' end

-- Une fiche sans langue : la composition continue dans la langue du numéro, et le dit.
local function avertir_sans_langue(slug, lang_num)
  M.constat('meta', 'avertissement', 'sans-langue', { chp_article(slug) },
    'Article « ' .. slug .. " » : aucune langue déclarée dans " .. slug ..
      '.meta.yaml – composition ' .. M.EN_LANGUE.fr[lang_num] ..
      ", la langue du numéro. Ouvrez « Métadonnées de l’article » et fixez la langue de l’article.",
    'Artikel «' .. slug .. '»: keine Sprache in ' .. slug ..
      '.meta.yaml erklärt – Satz ' .. M.EN_LANGUE.de[lang_num] ..
      ', der Sprache der Ausgabe. Öffnen Sie «Metadaten der Artikel» und legen Sie die Sprache des Artikels fest.')
end

-- Une langue hors des trois de la revue arrête la compilation.
local function bloquer_langue_inconnue(slug, brut)
  M.bloquer('meta', 'langue-inconnue', { chp_article(slug), 'langue « ' .. brut .. ' »' },
    'Article « ' .. slug .. ' » : langue « ' .. brut ..
      " » inconnue dans " .. slug .. '.meta.yaml. Langues de la revue : fr, de, it.' ..
      " Ouvrez « Métadonnées de l’article » et choisissez-en une.",
    'Artikel «' .. slug .. '»: Sprache «' .. brut .. '» in ' .. slug ..
      '.meta.yaml unbekannt. Sprachen der Zeitschrift: fr, de, it.' ..
      ' Öffnen Sie «Metadaten der Artikel» und wählen Sie eine davon.')
end

-- Langue lue dans <slug>.meta.yaml, validée, puis la suite de replis de l'appelant.
-- options :
--   slug             slug déjà connu (sinon M.slug_article())
--   lire_fiche       lire <slug>.meta.yaml
--   langues_valides  ensemble {fr=true, …} : une valeur hors de cet ensemble vaut une fiche
--                    invalide ; nil accepte tout code non vide
--   fiche_absente    function(slug), appelée si la fiche ne porte pas de langue
--   fiche_invalide   function(slug, valeur), dont le retour devient la langue ; omise, une
--                    fiche invalide se traite comme une fiche absente, en silence
--   repli            function(meta) -> langue ou nil, ce qui suit la fiche
--   defaut           langue rendue si rien n'a rien donné ('fr' si omis)
function M.langue_de(meta, options)
  local o = options or {}
  local valide = o.langues_valides
  local function correcte(v) return v ~= nil and v ~= '' and (not valide or valide[v]) end

  if o.lire_fiche then
    local slug = o.slug
    if slug == nil then slug = M.slug_article() end
    if slug ~= '' then
      local brut = M.lire_cle(slug .. '.meta.yaml', 'lang'):lower():sub(1, 2)
      if brut ~= '' then
        if correcte(brut) then return brut end
        if o.fiche_invalide then return o.fiche_invalide(slug, brut) end
      elseif o.fiche_absente then
        o.fiche_absente(slug)
      end
    end
  end

  if o.repli then
    local v = o.repli(meta)
    if v and v ~= '' then return v end
  end

  return o.defaut or 'fr'
end

-- ---------------------------------------------------------------------------------------
-- Contexte de composition de l'unité compilée : sa langue, le produit (revue, zeitschrift,
-- ou livre sous SZH_LIVRE) et l'unité (article ou chapitre).
-- La langue suit l'ordre de la couverture : la fiche <slug>.meta.yaml, puis le jeton de
-- revue, puis le `lang:` du numéro ou de buch.yaml (relu dans SZH_AUSGABE, que la fiche a pu
-- écraser dans meta ; à défaut meta.lang), puis le français.
-- `signaler` dit une fiche sans langue et bloque sur une langue inconnue, hors livre ; sans
-- lui, une fiche invalide vaut une fiche absente, en silence.
function M.calculer_contexte(meta, signaler)
  local m = meta or {}
  local livre = (os.getenv('SZH_LIVRE') or '') ~= ''
  local revue = M.texte(m.revue):lower()
  local zeitschrift = revue:find('zeitschrift') ~= nil
  local produit = livre and 'livre' or (zeitschrift and 'zeitschrift' or 'revue')

  local lang_revue = zeitschrift and 'de' or (revue:find('revue') and 'fr' or '')
  local lang_numero = M.lire_cle(os.getenv('SZH_AUSGABE'), 'lang')
  if lang_numero == '' then lang_numero = M.texte(m.lang) end
  lang_numero = lang_numero:lower():sub(1, 2)
  local lang_num = lang_revue ~= '' and lang_revue
                   or (M.LANGUES[lang_numero] and lang_numero or 'fr')

  local dire = signaler and not livre
  local lang = M.langue_de(m, {
    lire_fiche = true,
    langues_valides = M.LANGUES,
    fiche_absente = dire and function(s) avertir_sans_langue(s, lang_num) end or nil,
    fiche_invalide = dire and bloquer_langue_inconnue or nil,
    repli = function() return lang_num end,
  })
  return { lang = lang, produit = produit, unite = livre and 'chapitre' or 'article' }
end

-- Le contexte que szh-contexte.lua a posé dans meta. Un filtre lancé hors chaîne (un test)
-- le calcule lui-même, en silence sauf `signaler`.
function M.contexte(meta, signaler)
  local produit = M.texte(meta and meta['szh-produit'])
  if produit == '' then return M.calculer_contexte(meta, signaler) end
  return { lang = M.texte(meta.lang), produit = produit, unite = M.texte(meta['szh-unite']) }
end

return M
