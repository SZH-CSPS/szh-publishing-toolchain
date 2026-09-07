-- Fonctions partagées entre plusieurs filtres pandoc du pipeline : slug_article(),
-- a_classe(), trim() et langue_de() (langue de composition). Chargé par dofile — le dossier
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
-- szh-maquette.lua et szh-numerotation.lua utilisent désormais langue_de() : la cascade de
-- chacun (fiche -> jeton de revue -> ausgabe.yaml -> français pour l'un, fiche -> jeton de
-- revue -> lang: du numéro -> français pour l'autre) reste propre à chaque appelant, passée
-- en `repli`, et le blocage de szh-maquette.lua sur une langue inconnue reste le sien, passé
-- en `fiche_invalide` — voir langue_de() ci-dessous. Un filtre qui n'a besoin de rien
-- d'autre ne charge pas ce module pour la forme.

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

-- Vrai si l'attribut pandoc `el` porte la classe `nom`. szh-numerotation.lua et
-- szh-ressource.lua en avaient chacun leur copie, identiques.
function M.a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

function M.trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end

-- ---------------------------------------------------------------------------------------
-- Scalaire YAML « nu / "..." / '...' », reproduisant parse_scalar() de szh-maquette.lua :
-- guillemets échappés, coupe au commentaire « espace(s) + # ». Privé à ce module — les
-- lectures de dossier/DOI de szh-maquette.lua gardent leur propre copie (hors du périmètre
-- de ce lot, elles ne concernent pas la langue).
local function parse_scalar(reste)
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

-- Lecture de « lang: » en tête de <slug>.meta.yaml, hors pandoc (io.open direct, jamais les
-- métadonnées fusionnées). Trois variantes mesurées, une par appelant, aucune unifiée avec
-- les autres — une divergence de comportement assumée dans chacun des trois filtres, voir
-- langue_de() ci-dessous pour ce qui en dépend :
--   'lire_cle'            scalaire complet (parse_scalar : guillemets échappés, coupe au
--                         commentaire), puis lower():sub(1,2). szh-maquette.lua.
--   'deux_lettres'        motif ancré sur exactement deux lettres après un guillemet
--                         optionnel non refermé ; une ligne « lang: » qui ne les porte pas
--                         est ignorée et la lecture continue aux lignes suivantes (elle ne
--                         s'arrête pas à la première ligne « lang: » venue, contrairement
--                         aux deux autres variantes). szh-numerotation.lua.
--   'guillemets_simples'  tout le reste de la ligne, un guillemet de tête et un de fin ôtés
--                         s'il y en a, puis trim():lower():sub(1,2). S'arrête à la première
--                         ligne « lang: », que la valeur obtenue soit vide ou non.
--                         szh-citations.lua.
-- Rend '' si le fichier est absent, illisible, ou ne porte pas la clé (par la variante
-- retenue).
function M.lang_fiche(slug, variante)
  if not slug or slug == '' then return '' end
  local fh = io.open(slug .. '.meta.yaml', 'r')
  if not fh then return '' end
  local valeur = ''
  if variante == 'deux_lettres' then
    for ligne in fh:lines() do
      local m = ligne:match("^lang:%s*['\"]?(%a%a)")
      if m then valeur = m:lower(); break end
    end
  elseif variante == 'guillemets_simples' then
    for ligne in fh:lines() do
      local m = ligne:match('^lang:%s*(.*)$')
      if m then
        m = m:gsub('^["\']', ''):gsub('["\']%s*$', '')
        valeur = M.trim(m):lower():sub(1, 2)
        break
      end
    end
  else                                          -- 'lire_cle', défaut
    for ligne in fh:lines() do
      local m = ligne:match('^lang:%s*(.*)$')
      if m then valeur = parse_scalar(m):lower():sub(1, 2); break end
    end
  end
  fh:close()
  return valeur
end

-- ---------------------------------------------------------------------------------------
-- Langue de composition : quatre filtres la lisent, chacun à sa façon (mesuré et fixé par
-- test/filtres-pandoc.test.js, section « Détection de langue » — ces tests ne bougent pas
-- avec ce module, ils le contraignent). Pas un ordre unique entre eux : une fiche lue ou
-- non, une validation ou non, un repli différent une fois la fiche absente ou invalide.
-- langue_de() ne fait donc que l'étape commune aux trois filtres qui lisent la fiche —
-- la lire, la valider, réagir à son absence ou à son invalidité — et laisse à chaque
-- appelant sa propre suite de replis (`options.repli`) : cette suite-là (jeton de revue
-- d'abord ou meta.lang d'abord, ausgabe.yaml relu ou non...) diffère trop d'un filtre à
-- l'autre pour être un paramètre de plus plutôt qu'un module de moins.
--
-- options :
--   slug              slug déjà connu (sinon M.slug_article())
--   lire_fiche         bool — lire <slug>.meta.yaml (faux : szh-ressource.lua, qui ne lit
--                      que les métadonnées déjà fusionnées par pandoc)
--   variante_fiche     voir M.lang_fiche ci-dessus (défaut 'deux_lettres')
--   langues_valides    ensemble {fr=true, de=true, ...} : une valeur hors de cet ensemble
--                      est traitée comme absente ; nil = tout code de 2 lettres non vide
--                      est accepté (szh-citations.lua, qui ne valide pas la fiche)
--   fiche_absente      function(slug) — appelée si lire_fiche est vrai et que la clé est
--                      absente ou vide (szh-maquette.lua : avertir « sans-langue »)
--   fiche_invalide     function(slug, valeur) — appelée si la fiche porte une langue hors
--                      langues_valides ; sa valeur de retour devient celle de langue_de
--                      (szh-maquette.lua bloque : la fonction n'a alors pas besoin de
--                      rendre, os.exit ne rend jamais la main). Omise, une fiche invalide
--                      se traite comme une fiche absente — repli silencieux, sans message
--                      (szh-numerotation.lua : « retombe sur 'fr' »).
--   repli              function(meta) -> langue ou nil : tout ce qui suit la fiche
--                      (jeton de revue, meta.lang, ausgabe.yaml...), propre à l'appelant
--   defaut             langue rendue si rien n'a rien donné ('fr' si omis)
function M.langue_de(meta, options)
  local o = options or {}
  local valide = o.langues_valides
  local function correcte(v) return v ~= nil and v ~= '' and (not valide or valide[v]) end

  if o.lire_fiche then
    local slug = o.slug
    if slug == nil then slug = M.slug_article() end
    if slug ~= '' then
      local brut = M.lang_fiche(slug, o.variante_fiche)
      if brut ~= '' then
        if correcte(brut) then return brut end
        if o.fiche_invalide then return o.fiche_invalide(slug, brut) end
        -- pas de callback : une fiche invalide se traite comme une fiche absente, silence
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

return M
