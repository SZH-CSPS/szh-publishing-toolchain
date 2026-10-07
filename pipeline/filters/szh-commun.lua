-- Fonctions partagées par les filtres pandoc : slug_article(), a_classe(), trim(), texte(),
-- lire_cle() / parse_scalar(), les constats au format à codes, le contexte de composition
-- (langue, produit, unité), la forme imprimée des dates et les réglages de mise en page
-- d'un livre.
--
-- Chaque filtre charge ce module par dofile, et s'arrête si le chargement échoue : sans
-- lui, il ne connaît ni le slug ni la langue, et composerait une page fausse. Le dossier se
-- trouve par debug.getinfo(1, 'S').source : PANDOC_SCRIPT_FILE nomme le script passé à
-- pandoc en ligne de commande (par exemple un harnais de test), pas le fichier qui appelle
-- dofile.
--
--   local function dossier_ce_fichier()
--     local source = debug.getinfo(1, 'S').source
--     if source:sub(1, 1) == '@' then source = source:sub(2) end
--     return source:match('^(.*[/\])') or ''
--   end
--   local ok, commun = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
--   if not ok or type(commun) ~= 'table' then ... os.exit(1, true) ... end
--
-- Le contexte de composition se calcule ici, dans calculer_contexte() ; szh-contexte.lua le
-- pose en tête de chaque chaîne et les filtres le relisent par contexte().

local M = {}

-- ---------------------------------------------------------------------------------------
-- Slug de l'unité compilée (article ou chapitre), tiré du fichier d'entrée : le Makefile
-- fait `cd` dans le dossier de l'unité, donc PANDOC_STATE.input_files[1] est <slug>.md.
-- Sans fichier d'entrée, rend `repli` ('' si omis).
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
-- Scalaire YAML nu, "..." ou '...' (même règle que decouperValeurYaml du cockpit) :
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

-- Valeur d'une clé scalaire de premier niveau d'un YAML plat, lue hors pandoc, ou ''. Sert
-- quand il faut savoir de quel fichier vient une clé, ce que la fusion des métadonnées
-- ne dit pas.
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
-- Constats au format à codes de docs/ARCHITECTURE.md, comme
-- szh_commun.formater_avertissement côté Python :
--   [<source>-<ton>] <code> | <champ> | … | <phrase fr> | [de] <phrase de>
-- Les valeurs partent telles quelles : l'appelant retire les « | » d'un texte par
-- sans_barre().
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

-- Ajoute la ligne au journal d'import (SZH_IMPORT_LOG) si la variable est posée : pandoc
-- ne l'écrit pas pour les filtres. Équivalent de szh_commun.journaliser côté Python.
function M.journaliser(ligne)
  local journal = os.getenv('SZH_IMPORT_LOG')
  if not journal or journal == '' then return end
  local f = io.open(journal, 'a')
  if f then
    f:write(ligne .. '\n')
    f:close()
  end
end

-- Arrête la compilation. Le constat part seul : `error()` l'enroberait d'une pile d'appels
-- illisible dans le panneau. L'`error` après os.exit est une sécurité.
function M.bloquer(source, code, champs, fr, de)
  M.constat(source, 'blocage', code, champs, fr, de)
  os.exit(1, true)
  error(code, 0)
end

-- ---------------------------------------------------------------------------------------
-- Les trois langues de la maison. Pas d'anglais : ni libellé de résumé, ni licence, ni
-- titre de bloc auteurs n'existent en anglais.
M.LANGUES = { fr = true, de = true, it = true }

-- Nom d'une langue dans une phrase, en français et en allemand.
M.EN_LANGUE = {
  fr = { fr = 'en français',      de = 'en allemand',   it = 'en italien' },
  de = { fr = 'auf Französisch',  de = 'auf Deutsch',   it = 'auf Italienisch' },
}

local function chp_article(slug) return 'article « ' .. slug .. ' »' end

-- Fiche sans langue : la composition continue dans la langue du numéro, avec un
-- avertissement.
local function avertir_sans_langue(slug, lang_num)
  M.constat('meta', 'avertissement', 'sans-langue', { chp_article(slug) },
    'Article « ' .. slug .. " » : aucune langue déclarée dans " .. slug ..
      '.meta.yaml – composition ' .. M.EN_LANGUE.fr[lang_num] ..
      ", la langue du numéro. Ouvrez « Métadonnées de l’article » et fixez la langue de l’article.",
    'Artikel «' .. slug .. '»: keine Sprache in ' .. slug ..
      '.meta.yaml erklärt – Satz ' .. M.EN_LANGUE.de[lang_num] ..
      ', der Sprache der Ausgabe. Öffnen Sie «Metadaten der Artikel» und legen Sie die Sprache des Artikels fest.')
end

-- Une langue hors des trois de la maison arrête la compilation.
local function bloquer_langue_inconnue(slug, brut)
  M.bloquer('meta', 'langue-inconnue', { chp_article(slug), 'langue « ' .. brut .. ' »' },
    'Article « ' .. slug .. ' » : langue « ' .. brut ..
      " » inconnue dans " .. slug .. '.meta.yaml. Langues de la revue : fr, de, it.' ..
      " Ouvrez « Métadonnées de l’article » et choisissez-en une.",
    'Artikel «' .. slug .. '»: Sprache «' .. brut .. '» in ' .. slug ..
      '.meta.yaml unbekannt. Sprachen der Zeitschrift: fr, de, it.' ..
      ' Öffnen Sie «Metadaten der Artikel» und wählen Sie eine davon.')
end

-- Langue lue dans <slug>.meta.yaml et validée, sinon les replis de l'appelant.
-- options :
--   slug             slug déjà connu (sinon M.slug_article())
--   lire_fiche       lire <slug>.meta.yaml
--   langues_valides  ensemble {fr=true, …} : une valeur hors de cet ensemble rend la fiche
--                    invalide ; nil accepte tout code non vide
--   fiche_absente    function(slug), appelée si la fiche ne porte pas de langue
--   fiche_invalide   function(slug, valeur), dont le retour devient la langue ; omise, une
--                    fiche invalide est traitée comme absente, sans message
--   repli            function(meta) -> langue ou nil, essayée après la fiche
--   defaut           langue rendue en dernier recours ('fr' si omis)
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
-- Ordre de la langue : la fiche <slug>.meta.yaml, puis le jeton de revue, puis le `lang:`
-- du numéro ou de buch.yaml (relu dans SZH_AUSGABE, car la fiche a pu l'écraser dans meta ;
-- sinon meta.lang), puis le français.
-- Avec `signaler`, hors livre : avertit d'une fiche sans langue et bloque sur une langue
-- inconnue. Sans lui, une fiche invalide est traitée comme absente, sans message.
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

-- Le contexte posé dans meta par szh-contexte.lua. Un filtre lancé hors chaîne (un test)
-- le calcule lui-même, sans message sauf `signaler`.
function M.contexte(meta, signaler)
  local produit = M.texte(meta and meta['szh-produit'])
  if produit == '' then return M.calculer_contexte(meta, signaler) end
  return { lang = M.texte(meta.lang), produit = produit, unite = M.texte(meta['szh-unite']) }
end

-- ---------------------------------------------------------------------------------------
-- Date ISO (2026-01-05) -> date suisse (05.01.2026). L'ISO est la forme stockée, parce
-- qu'elle se trie. Toute autre forme sort inchangée.
function M.jour_mois_an(v)
  if not v then return nil end
  local a, m, j = v:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$')
  if not a then return nil end
  return { j = j, m = m, a = a }
end
function M.date_suisse(v)
  local d = M.jour_mois_an(v)
  if not d then return v end
  return d.j .. '.' .. d.m .. '.' .. d.a
end

-- Date partielle (saisie `date_partielle` : AAAA, AAAA-MM ou AAAA-MM-JJ), en forme suisse
-- compacte : « 2026 », « 03.2026 », « 05.03.2026 ».
function M.date_partielle_suisse(v)
  if not v then return v end
  local a, m, j = v:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$')
  if a then return j .. '.' .. m .. '.' .. a end
  local a2, m2 = v:match('^(%d%d%d%d)%-(%d%d)$')
  if a2 then return m2 .. '.' .. a2 end
  if v:match('^%d%d%d%d$') then return v end
  return v
end

-- Plage de dates, sous sa forme la plus compacte :
--   un seul jour              05.01.2026
--   même mois                 05.–06.01.2026
--   même année, deux mois     29.06.–02.07.2026
--   deux années               10.09.2026–04.07.2028
-- Si l'une des dates n'est pas ISO, les deux formes longues sont jointes par un tiret
-- demi-cadratin.
function M.plage_date(v1, v2)
  local vide1 = (v1 == nil or v1 == '')
  local vide2 = (v2 == nil or v2 == '')
  if vide1 then return (not vide2) and M.date_suisse(v2) or nil end
  if vide2 or v1 == v2 then return M.date_suisse(v1) end
  local d1, d2 = M.jour_mois_an(v1), M.jour_mois_an(v2)
  if not d1 or not d2 or d1.a ~= d2.a then return M.date_suisse(v1) .. '–' .. M.date_suisse(v2) end
  if d1.m ~= d2.m then return d1.j .. '.' .. d1.m .. '.–' .. d2.j .. '.' .. d2.m .. '.' .. d2.a end
  return d1.j .. '.–' .. d2.j .. '.' .. d2.m .. '.' .. d2.a
end

-- Vérifie une saisie de date pour l'aperçu du cockpit (szh-date-apercu.lua) : nil si elle
-- est bonne ou vide, sinon 'format', 'impossible' (2026-02-30) ou 'inversee' (fin avant
-- début). Le calendrier est calculé sans os.time, qui dépend du fuseau et de la plage
-- d'années du système.
local function jour_existe(a, m, j)
  a, m, j = tonumber(a), tonumber(m), tonumber(j)
  if m < 1 or m > 12 or j < 1 then return false end
  if m == 2 and a % 4 == 0 and (a % 100 ~= 0 or a % 400 == 0) then return j <= 29 end
  return j <= ({ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 })[m]
end
local function verifier_une(saisie, v)
  if v == nil or v == '' then return nil end
  local a, m, j = v:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$')
  if a then return (not jour_existe(a, m, j)) and 'impossible' or nil end
  if saisie == 'date_partielle' then
    local a2, m2 = v:match('^(%d%d%d%d)%-(%d%d)$')
    if a2 then return (tonumber(m2) < 1 or tonumber(m2) > 12) and 'impossible' or nil end
    if v:match('^%d%d%d%d$') then return nil end
  end
  return 'format'
end
function M.verifier_date(saisie, v1, v2)
  if saisie ~= 'plage' then return verifier_une(saisie, v1) end
  local e = verifier_une('date', v1) or verifier_une('date', v2)
  if e then return e end
  if v1 and v1 ~= '' and v2 and v2 ~= '' and v2 < v1 then return 'inversee' end
  return nil
end

-- ---------------------------------------------------------------------------------------
-- Le bloc `mise-en-page:` de buch.yaml : chaque clé de pipeline/livre/mise-en-page.json
-- avec sa valeur (texte), défaut compris ; nil hors livre et en maquette falc, qui ignore
-- le bloc. Le fichier JSON n'est lu qu'au premier appel. La validation des valeurs est
-- faite par livre-assembler.py, avant tout PDF.
local CONTRAT_MISE_EN_PAGE
local function contrat_mise_en_page()
  if CONTRAT_MISE_EN_PAGE then return CONTRAT_MISE_EN_PAGE end
  local source = debug.getinfo(1, 'S').source
  if source:sub(1, 1) == '@' then source = source:sub(2) end
  local chemin = (source:match('^(.*[/\\])') or '') .. '../livre/mise-en-page.json'
  local fh = io.open(chemin, 'r')
  local ok, data = false, nil
  if fh then
    ok, data = pcall(pandoc.json.decode, fh:read('a'))
    fh:close()
  end
  if not ok or type(data) ~= 'table' or type(data.cles) ~= 'table' then
    M.bloquer('livre', 'mise-en-page-contrat', { chemin },
      'Le contrat des clés de mise en page est introuvable ou illisible : la compilation s’arrête.',
      'Der Vertrag der Layout-Schlüssel fehlt oder ist unlesbar: die Kompilierung bricht ab.')
  end
  CONTRAT_MISE_EN_PAGE = data.cles
  return CONTRAT_MISE_EN_PAGE
end

function M.mise_en_page(meta)
  if M.contexte(meta).produit ~= 'livre' or M.texte(meta.maquette) == 'falc' then return nil end
  local bloc = meta['mise-en-page']
  local reglages = {}
  for cle, definition in pairs(contrat_mise_en_page()) do
    local v = type(bloc) == 'table' and M.texte(bloc[cle]) or ''
    local d = definition.defaut
    if type(d) == 'number' and d == math.floor(d) then d = string.format('%d', d) end
    reglages[cle] = v ~= '' and v or tostring(d)
  end
  return reglages
end

return M
