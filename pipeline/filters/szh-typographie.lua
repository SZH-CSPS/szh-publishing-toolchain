-- Compilation : applique au TEXTE DE L'ARTICLE la typographie de la maison, selon la
-- langue déclarée de l'article. Douze règles, codées A1 à C2, listées pour la rédaction
-- dans docs/TYPOGRAPHIE-FR.md et docs/TYPOGRAPHIE-DE.md.
--
-- ⚠ Le fichier .md n'est JAMAIS réécrit. La normalisation a lieu à la compilation, sur
-- l'arbre pandoc : la source reste exactement ce que la rédaction a tapé, lisible et
-- comparable d'une version à l'autre, et c'est la sortie — PDF, HTML, galley DOCX — qui
-- porte la typographie. Semer des insécables et des chevrons dans le .md le rendrait
-- pénible à relire pour un gain nul : personne ne lit le Markdown, tout le monde lit le PDF.
--
-- Le fait qui commande tout : français et allemand ont des règles OPPOSÉES d'espacement.
-- Le français SÉPARE (insécable devant la ponctuation haute, à l'intérieur des
-- guillemets), l'allemand suisse et l'italien COLLENT. Une règle unique serait fausse pour
-- l'une des deux langues. Les mesures qui l'établissent sont dans docs/TYPOGRAPHIE.md.
--
-- Place dans la chaîne : EN DERNIER, après szh-notes. À ce moment les notes sont devenues
-- des Spans (leur contenu est donc atteignable), szh-citations a déjà apparié ses appels
-- sur le texte d'origine — une insécable posée avant lui déplacerait ses ancrages —, et
-- les tableaux réinjectés par szh-tabelle-inclure sont là, sous forme de RawBlock html
-- que ce filtre traite à part.
--
-- Ce qui n'est PAS corrigé, et pourquoi :
--   * le « ß » d'un article allemand : « Klauß » n'est pas « Klauss », et une citation
--     d'un ouvrage allemand garde son orthographe. Le filtre le SIGNALE (code C1) ;
--   * les guillemets droits que pandoc n'a pas su apparier : les remplacer au jugé
--     ouvrirait ou fermerait au hasard. Signalés aussi (code C2) ;
--   * les plages de nombres en général (« 2020-2021 », « COVID-19 », un DOI, une date
--     ISO) : seules les plages de PAGES, reconnaissables à leur « p. » ou « S. », passent
--     au demi-cadratin (T2) ;
--   * le contenu des `code` et des blocs de code, jamais touché.

local NBSP = '\194\160'                       -- U+00A0, l'espace insécable
local DEMI = '\226\128\147'                   -- U+2013, demi-cadratin
local CADRATIN = '\226\128\148'               -- U+2014, proscrit
local APO = '\226\128\153'                    -- U+2019, apostrophe typographique
local ELL = '\226\128\166'                    -- U+2026, points de suspension
local GO, GF = '\194\171', '\194\187'         -- « »
local SO, SF = '\226\128\185', '\226\128\186' -- ‹ ›

-- Lettre « au sens large » : les classes Lua sont des classes d'OCTETS et %a ne connaît
-- que l'ASCII. « d'été » porte un é sur deux octets, dont le premier vaut 0xC3 : sans la
-- plage \128-\255, la règle A1 raterait une élision sur deux, celles qui précèdent un
-- accent. Tout octet non-ASCII est ici tenu pour une lettre, ce qui suffit : le caractère
-- qui nous intéresse, l'apostrophe, est ASCII et ne peut pas être confondu.
local LETTRE = '[%a\128-\255]'

-- ⚠ Aucune classe d'octets ne peut décrire « une espace, quelle qu'elle soit ». L'octet
-- 0xC2 ouvre l'insécable ET le guillemet « : une classe [ \194\160…] mangerait la moitié
-- d'un chevron. Les règles d'espacement travaillent donc sur une liste de CARACTÈRES,
-- découpée ici, et non sur des motifs Lua.
local function caracteres(t)
  local out = {}
  for c in t:gmatch('[^\128-\191][\128-\191]*') do out[#out + 1] = c end
  return out
end

local EST_ESPACE = { [' '] = true, [NBSP] = true,
                     ['\226\128\175'] = true, ['\226\128\137'] = true }
-- Les deux qui ne se coupent pas : l'insécable ordinaire et la FINE insécable. Une règle
-- qui demande « une insécable » est déjà tenue par l'une comme par l'autre.
local INSECABLES = { [NBSP] = true, ['\226\128\175'] = true }
local HAUTE = { [';'] = true, [':'] = true, ['!'] = true, ['?'] = true }

-- Les signes multi-octets qui ne sont PAS des lettres. Tout ce qui fait plus d'un octet
-- sans figurer ici — é, ü, œ, ç — en est une, ce qui suffit à décider si une insécable
-- doit se poser devant un deux-points.
local PAS_LETTRE = {
  [GO] = true, [GF] = true, [SO] = true, [SF] = true,
  [ELL] = true, [DEMI] = true, [CADRATIN] = true, [APO] = true, [NBSP] = true,
}

local function est_lettre(c)
  if c == nil or EST_ESPACE[c] then return false end
  if #c > 1 then return not PAS_LETTRE[c] end
  return c:match('%a') ~= nil
end

-- Langue de composition, arrêtée une fois pour toutes au premier passage.
local LANGUE = 'fr'
local COLLEE = false        -- vrai pour l'allemand et l'italien : rien ne se sépare

-- Constats à écrire une fois le document parcouru : le même « ß » revient vingt fois, et
-- une ligne de journal par occurrence noierait la vue des contrôles.
local SLUG = ''
local vus = {}
local constats = {}

-- ---------------------------------------------------------------- lecture de la fiche
--
-- Même lecture que szh-maquette.lua, volontairement minimale : une clé de premier niveau,
-- un scalaire, guillemets retirés. Le pipeline ne dispose d'aucun lecteur YAML.
local function parse_scalar(v)
  v = (v or ''):gsub('%s+$', ''):gsub('^%s+', '')
  v = v:gsub('^#.*$', '')
  local q = v:match('^"(.*)"$') or v:match("^'(.*)'$")
  return q or v
end

local function lire_cle(chemin, cle)
  if not chemin or chemin == '' then return '' end
  local fh = io.open(chemin, 'r')
  if not fh then return '' end
  local valeur = ''
  for ligne in fh:lines() do
    local m = ligne:match('^' .. cle .. ':%s*(.*)$')
    if m then valeur = parse_scalar(m); break end
  end
  fh:close()
  return valeur
end

local function slug_entree()
  local fichiers = (PANDOC_STATE or {}).input_files or {}
  local chemin = fichiers[1]
  if type(chemin) ~= 'string' then return '' end
  return (chemin:gsub('.*[/\\]', ''):gsub('%.md$', ''))
end

-- Trois sources, dans cet ordre : la langue que szh-maquette a déjà arrêtée (chaîne de
-- compilation), la fiche de l'article (chaîne d'aperçu, qui ne charge pas szh-maquette),
-- puis le numéro. Aucune n'invente : szh-maquette reste le seul endroit où la règle de
-- repli est écrite, et l'aperçu ne fait que relire la même clé du même fichier.
local function resoudre_langue(meta)
  local candidats = {}
  if meta and meta.lang then
    candidats[#candidats + 1] = pandoc.utils.stringify(meta.lang)
  end
  SLUG = slug_entree()
  if SLUG ~= '' then candidats[#candidats + 1] = lire_cle(SLUG .. '.meta.yaml', 'lang') end
  candidats[#candidats + 1] = lire_cle(os.getenv('SZH_AUSGABE'), 'lang')
  for _, c in ipairs(candidats) do
    local court = tostring(c or ''):lower():sub(1, 2)
    if court == 'fr' or court == 'de' or court == 'it' then return court end
  end
  return 'fr'
end

-- ------------------------------------------------------------------------- les constats
--
-- Format du journal, celui que lib/journal.js sait déjà découper :
--   [typo-avertissement] <code> | article « … » | <phrase fr> | [de] <Satz de>
-- La famille « typo » lui est neuve : elle s'affichera sans clé d'i18n, avec la phrase
-- écrite ici, dans la langue de l'interface. C'est prévu, et dit dans journal.js.
local function signaler(code, phrase_fr, phrase_de)
  if vus[code] then return end
  vus[code] = true
  constats[#constats + 1] = '[typo-avertissement] ' .. code ..
    ' | article « ' .. SLUG .. ' » | ' .. phrase_fr .. ' | [de] ' .. phrase_de
end

-- ------------------------------------------------------ règles internes à une chaîne
--
-- Tout ce qui se décide sans regarder l'inline voisin. L'ordre compte à un endroit : A2
-- pose les chevrons AVANT que E1 ne s'occupe de leur espacement.

-- A1 · apostrophe typographique dans les élisions
local function a1_apostrophe(t)
  for _ = 1, 4 do                     -- « l'enfant d'ici » : deux élisions se chevauchent
    local neuf = t:gsub('(' .. LETTRE .. ")'(" .. LETTRE .. ')', '%1' .. APO .. '%2')
    if neuf == t then break end
    t = neuf
  end
  return t
end

-- A2/A3 · les guillemets courbes d'un traitement de texte deviennent des chevrons.
--
-- ⚠ « “ » n'a pas de sens fixe : il OUVRE en anglais (“word”) et il FERME en allemand
-- d'Allemagne („Wort“). Une table de correspondance fixe le rendait donc ouvrant dans
-- « „Guten Tag“ », qui sortait « «Guten Tag« ». On tranche par le voisinage, comme le
-- fait tout correcteur de guillemets : un guillemet suivi d'une lettre ouvre, un
-- guillemet précédé d'une lettre ferme.
--
-- « ’ » n'est jamais touché : c'est l'apostrophe, et A1 vient de la poser.
local COURBES = {
  ['\226\128\158'] = { GO, GO },       -- „ : ouvre toujours
  ['\226\128\159'] = { GO, GO },       -- ‟ : ouvre toujours
  ['\226\128\157'] = { GF, GF },       -- ” : ferme toujours
  ['\226\128\156'] = { GO, GF },       -- “ : selon le voisinage
  ['\226\128\154'] = { SO, SO },       -- ‚ : ouvre toujours
  ['\226\128\152'] = { SO, SF },       -- ‘ : selon le voisinage
}

local function a2a3_chevrons(t)
  local cs = caracteres(t)
  for i = 1, #cs do
    local paire = COURBES[cs[i]]
    if paire then
      local suivant = cs[i + 1]
      cs[i] = (suivant ~= nil and est_lettre(suivant)) and paire[1] or paire[2]
    end
  end
  return table.concat(cs)
end

-- T1 · le cadratin est proscrit : le tiret de la revue est le demi-cadratin
local function t1_tiret(t)
  return (t:gsub(CADRATIN, DEMI))
end

-- S1 · points de suspension en un seul signe
local function s1_suspension(t)
  return (t:gsub('%.%.%.', ELL))
end

-- S2 · ordinaux français : « 2ème » est fautif, la norme écrit « 2e »
local function s2_ordinaux(t)
  t = t:gsub('(%d)i\195\168me', '%1e')      -- ième
  t = t:gsub('(%d)\195\168me', '%1e')       -- ème
  t = t:gsub('(%d)eme(%f[%A])', '%1e')      -- eme
  return t
end

-- E4 · abréviations soudées, quand les deux moitiés tiennent dans la même chaîne
local function e4_abreviations(t)
  if COLLEE then
    t = t:gsub('(%f[%w]z%.) ?(B%.)', '%1' .. NBSP .. '%2')
    t = t:gsub('(%f[%w]d%.) ?(h%.)', '%1' .. NBSP .. '%2')
    t = t:gsub('(%f[%w]S%.) ?(%d)', '%1' .. NBSP .. '%2')
  else
    t = t:gsub('(%f[%w]p%.) ?(ex%.)', '%1' .. NBSP .. '%2')
    t = t:gsub('(%f[%w]pp?%.) ?(%d)', '%1' .. NBSP .. '%2')
    t = t:gsub('(n\194\176) ?(%d)', '%1' .. NBSP .. '%2')
  end
  return t
end

-- T2 · plage de PAGES au demi-cadratin. Le contexte « p. » ou « S. » est ce qui rend la
-- règle sûre : hors de lui, « 2020-2021 » peut être un exercice et « COVID-19 » un nom.
-- Passe AVANT e4_abreviations, qui remplacerait l'espace par une insécable et rendrait le
-- contexte méconnaissable.
-- Deux formes, parce que pandoc en produit deux : le lecteur markdown « smart » soude
-- certaines abréviations au nombre qui suit par une insécable — « pp.<NBSP>12-25 » arrive
-- en une seule chaîne, « S. 3-4 » en trois inlines. La seconde est reprise plus bas, sur
-- la liste ; celle-ci ne voit que la première.
local function t2_plage_pages(t)
  t = t:gsub('(%f[%w][pS]p?%. ?%d+)%-(%d)', '%1' .. DEMI .. '%2')
  t = t:gsub('(%f[%w][pS]p?%.' .. NBSP .. '%d+)%-(%d)', '%1' .. DEMI .. '%2')
  return t
end

-- E1/E2/E3 · l'espacement, sur la liste de caractères.
--
-- Une suite d'espaces adjacente à un chevron, à une ponctuation haute ou à un pour-cent
-- devient une insécable en français, rien du tout en allemand ; et là où l'espace manque,
-- le français la pose. Un chevron en bout de chaîne est laissé tel quel : c'est la passe
-- sur la liste d'inlines qui tranchera, elle seule voit ce qui suit.
local function e_espacement(t)
  local cs = caracteres(t)
  local n = #cs
  local out = {}
  local i = 1
  while i <= n do
    local c = cs[i]
    if EST_ESPACE[c] then
      local j = i
      while j <= n and EST_ESPACE[cs[j]] do j = j + 1 end
      local avant, apres = out[#out], cs[j]
      local colle = (avant == GO) or (apres == GF) or (apres ~= nil and HAUTE[apres])
        or (apres == '%' and avant ~= nil and avant:match('^%d$') ~= nil)
      if colle then
        if not COLLEE then
          -- Une insécable déjà posée satisfait la règle, qu'elle soit ordinaire ou FINE :
          -- la maquette écrit « Source⍽: » avec une fine insécable (szh-numerotation.lua),
          -- et l'élargir en insécable ordinaire défairait une décision de composition.
          if j == i + 1 and INSECABLES[cs[i]] then
            out[#out + 1] = cs[i]
          else
            out[#out + 1] = NBSP
          end
        end
      else
        for k = i, j - 1 do out[#out + 1] = cs[k] end
      end
      i = j
    else
      local avant = out[#out]
      if c == '%' and avant ~= nil and avant:match('^%d$') then
        out[#out + 1] = NBSP                      -- le pour-cent se sépare dans les deux langues
      elseif not COLLEE then
        if avant == GO then
          out[#out + 1] = NBSP
        elseif c == GF and avant ~= nil and not EST_ESPACE[avant] then
          out[#out + 1] = NBSP
        elseif HAUTE[c] and est_lettre(avant)
            and (cs[i + 1] == nil or EST_ESPACE[cs[i + 1]] or HAUTE[cs[i + 1]]) then
          -- fin de mot seulement : « https://… » garde ses deux-points, « 10:30 » aussi,
          -- « DOI: » non.
          out[#out + 1] = NBSP
        end
      end
      out[#out + 1] = c
      i = i + 1
    end
  end
  return table.concat(out)
end

-- C1/C2 · ce qui se signale sans se corriger
local function controler(t)
  if COLLEE and t:find('\195\159') then
    signaler('eszett',
      'un « ß » subsiste : l’usage suisse écrit « ss », mais un nom propre et une citation '
        .. 'le gardent. À trancher à la relecture — le filtre n’y touche pas.',
      'ein «ß» ist geblieben: Der Schweizer Usus schreibt «ss», Eigennamen und Zitate '
        .. 'behalten es aber. Bei der Korrektur zu entscheiden – der Filter rührt es nicht an.')
  end
  if t:find('"', 1, true) then
    signaler('guillemets-droits',
      'des guillemets droits (") subsistent : rien ne dit lequel ouvre et lequel ferme. '
        .. 'Remplacez-les par « et » à la relecture.',
      'gerade Anführungszeichen (") sind geblieben: Nichts sagt, welches öffnet und welches '
        .. 'schliesst. Bei der Korrektur durch « und » ersetzen.')
  end
end

-- Toutes les règles de texte, dans l'ordre.
local function normaliser_texte(t)
  controler(t)
  t = a1_apostrophe(t)
  t = a2a3_chevrons(t)
  t = t1_tiret(t)
  t = s1_suspension(t)
  if not COLLEE then t = s2_ordinaux(t) end
  t = t2_plage_pages(t)          -- avant e4 : elle a besoin de l'espace ordinaire
  t = e4_abreviations(t)
  t = e_espacement(t)
  return t
end

-- ------------------------------------------------ règles qui traversent une frontière
--
-- pandoc découpe « mot : suite » en Str/Space/Str : l'espace à corriger est un ÉLÉMENT de
-- la liste, pas un caractère d'une chaîne. Ces règles-là se jouent donc sur la liste
-- d'inlines, et pas dans normaliser_texte.

-- Texte d'un inline, en descendant dans les conteneurs : « **mot** : suite » a son
-- « mot » enfoui dans un Strong. Le code rend une sentinelle : aucune règle ne s'applique
-- de part et d'autre de lui.
local function texte_de(inl)
  if inl == nil then return '' end
  if inl.t == 'Str' then return inl.text end
  if inl.t == 'Code' or inl.t == 'RawInline' then return '\0' end
  if inl.content then
    local ok, s = pcall(pandoc.utils.stringify, inl)
    return ok and s or ''
  end
  return ''
end

-- Ce que devient l'espace entre `avant` et `apres` : une insécable, rien, ou lui-même.
local function sort_de_l_espace(avant, apres)
  local ta = texte_de(avant)
  local ts = texte_de(apres)
  if ta:sub(-1) == '\0' or ts:sub(1, 1) == '\0' then return 'garder' end

  -- E1 · guillemets. L'ouvrant se reconnaît en queue de chaîne, le fermant en tête.
  if ta:sub(-2) == GO then return COLLEE and 'retirer' or 'insecable' end
  if ts:sub(1, 2) == GF then return COLLEE and 'retirer' or 'insecable' end

  -- E2 · ponctuation haute. Le signe doit être seul ou en tête d'un groupe de signes :
  -- « ? », « ?! », mais pas le « : » de « ://ror.org ».
  local signes = ts:match('^([;:!?]+)')
  if signes and not ts:sub(#signes + 1, #signes + 1):match('[%w/]') then
    return COLLEE and 'retirer' or 'insecable'
  end

  -- E3 · pour-cent, dans les deux langues
  if ts:sub(1, 1) == '%' and ta:sub(-1):match('%d') then return 'insecable' end

  -- E4 · abréviations
  if COLLEE then
    if ta:match('%f[%w]z%.$') and ts:match('^B%.') then return 'insecable' end
    if ta:match('%f[%w]d%.$') and ts:match('^h%.') then return 'insecable' end
    if ta:match('%f[%w]S%.$') and ts:match('^%d') then return 'insecable' end
  else
    if ta:match('%f[%w]p%.$') and ts:match('^ex%.') then return 'insecable' end
    if ta:match('%f[%w]pp?%.$') and ts:match('^%d') then return 'insecable' end
    if ta:match('n\194\176$') and ts:match('^%d') then return 'insecable' end
  end
  return 'garder'
end

-- --------------------------------------------------------------------- le HTML réinjecté
--
-- szh-tabelle-inclure pose les tableaux en RawBlock html : leur texte n'est plus un Str et
-- échapperait à tout. On y passe donc à la main, en ne touchant QUE ce qui est entre deux
-- balises — jamais un attribut, jamais un nom d'élément.
local function normaliser_html(html)
  local sortie = {}
  local i = 1
  while true do
    local d = html:find('<', i, true)
    if not d then
      sortie[#sortie + 1] = normaliser_texte(html:sub(i))
      break
    end
    sortie[#sortie + 1] = normaliser_texte(html:sub(i, d - 1))
    -- Un commentaire HTML n'est pas une balise : son premier « > » ne le ferme pas, et le
    -- traiter comme tel rendait normalisable le texte qui suit — les commentaires du banc
    -- d'essai, qui expliquent des défauts voulus, s'en trouvaient réécrits.
    local f
    if html:sub(d, d + 3) == '<!--' then
      local fin_c = html:find('-->', d, true)
      f = fin_c and (fin_c + 2) or nil
    else
      f = html:find('>', d, true)
    end
    if not f then                                   -- « < » isolé : laissé tel quel
      sortie[#sortie + 1] = html:sub(d)
      break
    end
    sortie[#sortie + 1] = html:sub(d, f)
    i = f + 1
  end
  return table.concat(sortie)
end

-- ------------------------------------------------------------------------ les métadonnées
--
-- Le titre, le sous-titre et les résumés partent dans la couverture et dans les
-- métadonnées du PDF : ils relèvent de la même typographie que le corps. Liste blanche
-- stricte — un DOI, une URL, une classe CSS ou un nom de fichier n'ont pas de typographie,
-- et une insécable y serait un défaut.
local META_TEXTE = {
  'title', 'subtitle', 'pagetitle', 'description', 'resumes', 'licence-texte',
}
local META_AUTEUR = { 'fonction', 'affiliation' }

local function normaliser_valeur_meta(v)
  if v == nil then return nil end
  if v.t == 'MetaString' then return pandoc.MetaString(normaliser_texte(v.text)) end
  if v.walk then
    return v:walk({ Str = function(s) return pandoc.Str(normaliser_texte(s.text)) end })
  end
  return v
end

-- ------------------------------------------------------------------------------ passes
--
-- Deux tables de filtre : la première arrête la langue sur le document entier, la seconde
-- transforme. Les fondre en une seule laisserait ouverte la question de savoir si Meta
-- passe avant les blocs ; ainsi elle ne se pose pas.

local function poser_langue(meta)
  LANGUE = resoudre_langue(meta)
  COLLEE = (LANGUE ~= 'fr')
  return nil
end

local function transformer_meta(meta)
  for _, cle in ipairs(META_TEXTE) do
    if meta[cle] ~= nil then meta[cle] = normaliser_valeur_meta(meta[cle]) end
  end
  local auteurs = meta.author or meta.auteurs
  if auteurs ~= nil then
    for _, a in ipairs(auteurs) do
      if type(a) == 'table' then
        for _, cle in ipairs(META_AUTEUR) do
          if a[cle] ~= nil then a[cle] = normaliser_valeur_meta(a[cle]) end
        end
      end
    end
  end
  return meta
end

-- T2 sur la liste : pandoc coupe « pp. 12-25 » en trois inlines, l'abreviation et la
-- plage n'etant jamais dans la meme chaine. Le contexte qui rend la regle sure — « p. »,
-- « pp. », « S. » — ne se lit donc qu'ici.
local function t2_sur_liste(inl)
  for i = 1, #inl do
    local el = inl[i]
    if el.t == 'Str' and el.text:match('^%d+%-%d') then
      local j = i - 1
      while j >= 1 and (inl[j].t == 'Space' or inl[j].t == 'SoftBreak') do j = j - 1 end
      local avant = j >= 1 and texte_de(inl[j]) or ''
      if avant:match('%f[%w][pS]p?%.$') or avant:match('%f[%w][pS]p?%.' .. NBSP .. '$') then
        inl[i] = pandoc.Str((el.text:gsub('^(%d+)%-(%d)', '%1' .. DEMI .. '%2')))
      end
    end
  end
  return inl
end

local function transformer_inlines(inl)
  inl = t2_sur_liste(inl)
  local sortie = pandoc.Inlines({})
  for i = 1, #inl do
    local el = inl[i]
    if el.t == 'Space' or el.t == 'SoftBreak' then
      local quoi = sort_de_l_espace(inl[i - 1], inl[i + 1])
      if quoi == 'insecable' then
        sortie:insert(pandoc.Str(NBSP))
      elseif quoi ~= 'retirer' then
        sortie:insert(el)
      end
      -- « retirer » : rien n'est inséré, les deux voisins se collent — ce que veut
      -- l'allemand autour d'un chevron et devant un deux-points.
    else
      sortie:insert(el)
    end
  end
  return sortie
end

-- A2/A3 · ce que pandoc a su apparier lui-même. Le lecteur markdown « smart » rend
-- « "…" » en Quoted : c'est l'appariement le plus sûr dont on dispose, et bien meilleur
-- que toute heuristique qu'on écrirait ici. L'espacement est posé dans la foulée, dans la
-- langue de l'article.
local function transformer_quoted(q)
  local ouv, fer = GO, GF
  if q.quotetype == 'SingleQuote' then ouv, fer = SO, SF end
  local dedans = pandoc.Inlines({})
  dedans:insert(pandoc.Str(ouv .. (COLLEE and '' or NBSP)))
  for _, el in ipairs(q.content) do dedans:insert(el) end
  dedans:insert(pandoc.Str((COLLEE and '' or NBSP) .. fer))
  return dedans
end

local function transformer_str(s)
  return pandoc.Str(normaliser_texte(s.text))
end

local function transformer_rawblock(rb)
  if rb.format ~= 'html' then return nil end
  return pandoc.RawBlock('html', normaliser_html(rb.text))
end

-- Les constats partent en fin de course, une ligne par code et non par occurrence.
local function vider_constats()
  for _, ligne in ipairs(constats) do io.stderr:write(ligne .. '\n') end
  return nil
end

return {
  { Meta = poser_langue },
  {
    Str = transformer_str,
    Quoted = transformer_quoted,
    Inlines = transformer_inlines,
    RawBlock = transformer_rawblock,
    Meta = transformer_meta,
    Pandoc = vider_constats,
  },
}
