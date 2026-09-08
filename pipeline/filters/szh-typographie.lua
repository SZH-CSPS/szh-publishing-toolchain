-- Compilation : applique au texte de l'article la typographie de la maison, selon la
-- langue déclarée de l'article. Douze règles, codées A1 à C2, listées pour la rédaction
-- dans docs/TYPOGRAPHIE-FR.md et docs/TYPOGRAPHIE-DE.md.
--
-- ⚠ Le fichier .md n'est jamais réécrit. La normalisation a lieu à la compilation, sur
-- l'arbre pandoc : la source reste exactement ce que la rédaction a tapé, lisible et
-- comparable d'une version à l'autre, et c'est la sortie — PDF, HTML, galley DOCX — qui
-- porte la typographie. Semer des insécables et des chevrons dans le .md le rendrait
-- pénible à relire pour un gain nul : personne ne lit le Markdown, tout le monde lit le PDF.
--
-- Le fait qui commande tout : français et allemand ont des règles opposées d'espacement.
-- Le français sépare (insécable devant la ponctuation haute, à l'intérieur des
-- guillemets), l'allemand suisse et l'italien collent. Une règle unique serait fausse pour
-- l'une des deux langues. Les mesures qui l'établissent sont dans docs/TYPOGRAPHIE.md.
--
-- Place dans la chaîne : sixième, après szh-tabelle-scope et avant szh-numerotation et
-- szh-citations (voir l'ordre des --lua-filter dans le Makefile), pour ne normaliser que le
-- texte de la rédaction. Ancrages protégés malgré cet ordre par assainir_iso(), dans
-- szh-citations.lua, qui ramène les caractères posés ici à une longueur d'octets constante.
--
-- Ce qui n'est pas corrigé, et pourquoi :
--   * le « ß » d'un article allemand : « Klauß » n'est pas « Klauss », et une citation
--     d'un ouvrage allemand garde son orthographe. Le filtre le signale (code C1) ;
--   * les guillemets droits que pandoc n'a pas su apparier : les remplacer au jugé
--     ouvrirait ou fermerait au hasard. Signalés aussi (code C2) ;
--   * les plages de nombres en général (« 2020-2021 », « COVID-19 », un DOI, une date
--     ISO) : seules les plages de pages, reconnaissables à leur « p. » ou « S. », passent
--     au demi-cadratin (T2) ;
--   * le contenu des `code` et des blocs de code, jamais touché.

local NBSP = '\194\160'                       -- U+00A0, l'espace insécable
local FINE = '\226\128\175'                   -- U+202F, la fine insécable
local DEMI = '\226\128\147'                   -- U+2013, demi-cadratin
local CADRATIN = '\226\128\148'               -- U+2014, proscrit
local APO = '\226\128\153'                    -- U+2019, apostrophe typographique
local ELL = '\226\128\166'                    -- U+2026, points de suspension
local PMILLE = '\226\128\176'                 -- U+2030, pour mille
local GO, GF = '\194\171', '\194\187'         -- « »
local SO, SF = '\226\128\185', '\226\128\186' -- ‹ ›

-- Lettre « au sens large » : les classes Lua sont des classes d'octets et %a ne connaît
-- que l'ASCII. « d'été » porte un é sur deux octets, dont le premier vaut 0xC3 : sans la
-- plage \128-\255, la règle A1 raterait une élision sur deux, celles qui précèdent un
-- accent. Tout octet non-ASCII est ici tenu pour une lettre, ce qui suffit : le caractère
-- qui nous intéresse, l'apostrophe, est ASCII et ne peut pas être confondu.
local LETTRE = '[%a\128-\255]'

-- ⚠ Aucune classe d'octets ne peut décrire « une espace, quelle qu'elle soit ». L'octet
-- 0xC2 ouvre l'insécable et le guillemet « : une classe [ \194\160…] mangerait la moitié
-- d'un chevron. Les règles d'espacement travaillent donc sur une liste de caractères,
-- découpée ici, et non sur des motifs Lua.
local function caracteres(t)
  local out = {}
  for c in t:gmatch('[^\128-\191][\128-\191]*') do out[#out + 1] = c end
  return out
end

local EST_ESPACE = { [' '] = true, [NBSP] = true,
                     ['\226\128\175'] = true, ['\226\128\137'] = true }
-- Les deux qui ne se coupent pas : l'insécable ordinaire et la fine insécable. Une règle
-- qui demande « une insécable » est déjà tenue par l'une comme par l'autre.
local INSECABLES = { [NBSP] = true, ['\226\128\175'] = true }
local HAUTE = { [';'] = true, [':'] = true, ['!'] = true, ['?'] = true }
-- E3 · les deux signes qui se séparent de leur nombre dans les TROIS langues. Le pour
-- mille suit le pour-cent : même règle, même mesure (Guide du typographe, « le
-- pourcentage et le pour mille : les caractères sont séparés par une espace fine »).
local SEPARE_NOMBRE = { ['%'] = true, [PMILLE] = true }

-- Les signes multi-octets qui ne sont pas des lettres. Tout ce qui fait plus d'un octet
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

-- ⚠ Bascule de casse maison, et ce n'est pas un caprice : string.lower() travaille sur
-- les OCTETS et suit la locale. Sous une page de code Latin-1 — celle d'un Windows
-- francophone —, il lit l'octet 0xC3, celui qui ouvre « é » en UTF-8, comme le « Ã »
-- Latin-1 et le rend 0xE3. « Malgré » en sortait mutilé et introuvable dans les tables de
-- mots, tandis que « Pendant », tout en ASCII, passait : le défaut ne se voyait que sur
-- les entrées accentuées. Mesuré le 08.09.2026 sur ce filtre.
--
-- Les intervalles [A-Z] et [a-z] sont des intervalles d'octets, hors locale, et aucun
-- octet d'un caractère UTF-8 multi-octet n'y tombe : les têtes valent 0xC0 et plus, les
-- suites 0x80 à 0xBF. Les clés accentuées des tables sont donc écrites en minuscules, et
-- la comparaison ne porte que sur ce qui est décidable.
local function bas_de_casse(t)
  return (t:gsub('[A-Z]', function(c) return string.char(c:byte() + 32) end))
end

local function haut_de_casse(t)
  return (t:gsub('[a-z]', function(c) return string.char(c:byte() - 32) end))
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
-- pose les chevrons avant que E1 ne s'occupe de leur espacement.

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
-- ⚠ « “ » n'a pas de sens fixe : il ouvre en anglais (“word”) et il ferme en allemand
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

-- T2 · plage de pages. Le contexte « p. » ou « S. » est ce qui rend la règle sûre : hors
-- de lui, « 2020-2021 » peut être un exercice et « COVID-19 » un nom. Passe avant
-- e4_abreviations, qui remplacerait l'espace par une insécable et rendrait le contexte
-- méconnaissable.
--
-- ⚠ Deux prescriptions inverses, comme E1, E2 et T1 (décidé le 08.09.2026) : le trait
-- d'union est le « bis-Strich » romand — « le trait d'union est utilisé en Suisse romande
-- entre les chiffres », Règles typographiques, Schule für Gestaltung Zürich 2018, § trait
-- d'union, qui décline le Guide du typographe —, alors que le Duden veut le demi-cadratin.
-- Un article français écrit donc « pp. 12-25 », un article allemand « S. 12–25 », et la
-- règle convertit dans les deux sens : ce que la rédaction a tapé ne décide pas.
--
-- Deux formes, parce que pandoc en produit deux : le lecteur markdown « smart » soude
-- certaines abréviations au nombre qui suit par une insécable — « pp.<NBSP>12-25 » arrive
-- en une seule chaîne, « S. 3-4 » en trois inlines. La seconde est reprise plus bas, sur
-- la liste ; celle-ci ne voit que la première.
local function t2_plage_pages(t)
  local depuis, vers = '%-', DEMI              -- allemand, italien
  if not COLLEE then depuis, vers = DEMI, '-' end
  t = t:gsub('(%f[%w][pS]p?%. ?%d+)' .. depuis .. '(%d)', '%1' .. vers .. '%2')
  t = t:gsub('(%f[%w][pS]p?%.' .. NBSP .. '%d+)' .. depuis .. '(%d)', '%1' .. vers .. '%2')
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
      -- Une insécable déjà posée satisfait la règle, qu'elle soit ordinaire ou fine : la
      -- maquette écrit « Source⍽: » avec une fine insécable (szh-numerotation.lua), et
      -- l'élargir en insécable ordinaire défairait une décision de composition.
      local insec = (j == i + 1 and INSECABLES[cs[i]]) and cs[i] or NBSP
      -- E3 vaut dans les TROIS langues : elle se décide donc avant COLLEE et non dedans.
      -- Rangée dans `colle` comme avant, elle faisait disparaître l'espace de « 80 % » en
      -- allemand partout où la chaîne portait un vrai blanc — un titre, un résumé, une
      -- cellule de tableau réinjecté. Les articles n'en voyaient rien : dans le corps,
      -- « 80 % » arrive en trois inlines et c'est sort_de_l_espace qui tranche.
      local separe = (apres ~= nil and SEPARE_NOMBRE[apres]
                      and avant ~= nil and avant:match('^%d$') ~= nil)
      local colle = (avant == GO) or (apres == GF) or (apres ~= nil and HAUTE[apres])
      if separe then
        out[#out + 1] = insec
      elseif colle then
        if not COLLEE then out[#out + 1] = insec end
      else
        for k = i, j - 1 do out[#out + 1] = cs[k] end
      end
      i = j
    else
      local avant = out[#out]
      if SEPARE_NOMBRE[c] and avant ~= nil and avant:match('^%d$') then
        out[#out + 1] = NBSP                      -- % et ‰ se séparent dans les trois langues
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

-- ══════════════════════════════════════ les jetons, et les règles qui les regardent
--
-- Un « jeton » est un mot avec la ponctuation qui y est collée : « art. », « 12 », « km »,
-- « (ci-joint) ». Les règles ajoutées le 08.09.2026 — E5 à E8, A4a, E6 — ne regardent
-- jamais plus que le jeton de gauche et celui de droite, et c'est ce qui leur permet de
-- servir aux DEUX mécaniques du filtre sans être écrites deux fois : la chaîne entière
-- (une MetaString, le texte d'un tableau réinjecté) et la liste d'inlines, où l'espace
-- est un élément et non un caractère.
--
-- ⚠ Le découpage se fait sur la liste de caractères, jamais sur une classe d'octets :
-- voir l'avertissement en tête de fichier. Une classe [^ \194\160…] exclurait l'octet
-- 0xC2, qui ouvre « et », et couperait les chevrons en deux.
local function jetons(t)
  local sortie = {}
  local courant, espace = '', nil
  for _, c in ipairs(caracteres(t)) do
    local ici = EST_ESPACE[c] or false
    if espace == nil then espace = ici end
    if ici ~= espace then
      sortie[#sortie + 1] = { texte = courant, espace = espace }
      courant, espace = c, ici
    else
      courant = courant .. c
    end
  end
  if espace ~= nil then sortie[#sortie + 1] = { texte = courant, espace = espace } end
  return sortie
end

-- Le dernier jeton d'un texte, et le premier : ce que voit une règle de voisinage quand
-- l'espace n'est pas un caractère de la chaîne mais un élément de la liste d'inlines.
local function jeton_gauche(t)
  local js = jetons(t)
  local dernier = js[#js]
  if dernier == nil or dernier.espace then return '' end
  return dernier.texte
end

local function jeton_droite(t)
  local premier = jetons(t)[1]
  if premier == nil or premier.espace then return '' end
  return premier.texte
end

-- Vrai si l'entrée d'une table vaut pour la langue de composition. `true` vaut pour les
-- trois langues, une table ne vaut que pour les langues qu'elle nomme.
local function ici(v)
  if v == nil then return false end
  if v == true then return true end
  return v[LANGUE] == true
end

-- E5 · ce qui ne se sépare pas d'un nombre. Les unités abrégées d'abord ; le Guide
-- demande de ne PAS les abréger dans le texte courant, d'où la seconde liste, celle des
-- unités écrites en mots — « 54,5 hectares » coupé en fin de ligne est le même défaut que
-- « 54,5 ha » coupé.
local APRES_NOMBRE = {
  -- longueurs, masses, volumes, surfaces
  km = true, m = true, cm = true, mm = true, kg = true, g = true, mg = true, t = true,
  l = true, dl = true, cl = true, ml = true, ha = true, ['m2'] = true, ['km2'] = true,
  -- temps, énergie, fréquence
  h = true, min = true, s = true, ms = true, kWh = true, Hz = true,
  -- échelles et proportions
  mio = true, mia = true, ['%'] = true, [PMILLE] = true,
  -- monnaie : « 160 fr. », « 18 fr. 70 », « 25 € »
  ['fr.'] = { fr = true }, ['ct.'] = { fr = true }, CHF = true, EUR = true,
  ['\226\130\172'] = true,                     -- €
  -- degrés : « 39,1 °C ». Le signe seul (« un angle de 90° ») est collé au nombre et ne
  -- passe donc jamais par ici, faute d'espace à décider.
  ['\194\176C'] = true, ['\194\176'] = true,
  -- unités en mots, les trois langues de la revue
  heures = { fr = true }, minutes = { fr = true }, secondes = { fr = true },
  jours = { fr = true }, semaines = { fr = true }, mois = { fr = true },
  ans = { fr = true }, ['ann\195\169es'] = { fr = true },
  francs = { fr = true }, euros = { fr = true }, ['m\195\168tres'] = { fr = true },
  ['kilom\195\168tres'] = { fr = true }, litres = { fr = true }, hectares = { fr = true },
  kilos = { fr = true }, grammes = { fr = true }, tonnes = { fr = true },
  Jahre = { de = true }, Jahren = { de = true }, Monate = { de = true },
  Monaten = { de = true }, Tage = { de = true }, Tagen = { de = true },
  Stunden = { de = true }, Minuten = { de = true }, Sekunden = { de = true },
  Franken = { de = true }, Prozent = { de = true }, Uhr = { de = true },
  Meter = { de = true }, Kilometer = { de = true }, Liter = { de = true },
  Hektar = { de = true }, Gramm = { de = true }, Tonnen = { de = true },
  anni = { it = true }, mesi = { it = true }, ore = { it = true },
}
-- Le second membre d'une heure : « 4 h 04 », « 22 h 27 min 07 s ». La règle est la même
-- dans les trois langues, l'abréviation étant internationale.
local AVANT_CHIFFRES = { h = true, min = true, s = true }

-- E5 · ce qui ne se sépare pas du nombre qui SUIT : le renvoi normatif, la monnaie
-- placée devant. « p. », « pp. », « n° » et « S. » sont déjà tenus par E4 et ne sont pas
-- repris ici.
local AVANT_NOMBRE = {
  ['art.'] = { fr = true }, ['al.'] = { fr = true }, ['chap.'] = { fr = true },
  ['ch.'] = { fr = true }, ['fig.'] = { fr = true }, ['tabl.'] = { fr = true },
  ['tab.'] = true, ['vol.'] = true, ['\195\169d.'] = { fr = true },
  ['let.'] = { fr = true }, ['ill.'] = { fr = true }, ['r\195\169f.'] = { fr = true },
  ['Art.'] = { de = true }, ['Abs.'] = { de = true }, ['Kap.'] = { de = true },
  ['Abb.'] = { de = true }, ['Tab.'] = { de = true }, ['Bd.'] = { de = true },
  ['Ziff.'] = { de = true }, ['lit.'] = { de = true },
  ['\194\167'] = true,                         -- §
  CHF = true, EUR = true, ['Fr.'] = { fr = true }, ['\226\130\172'] = true,
}

-- E5 · la civilité et le titre ne se séparent pas du nom. « Dr » et « Dre » sans point
-- sont l'usage romand ; l'allemand écrit « Dr. ».
local CIVILITES = {
  ['M.'] = { fr = true }, ['MM.'] = { fr = true }, Mme = { fr = true },
  Mmes = { fr = true }, Mlle = { fr = true }, Mlles = { fr = true },
  Dr = { fr = true }, Dre = { fr = true }, Me = { fr = true }, Pr = { fr = true },
  ['Prof.'] = true, ['Dr.'] = { de = true }, St = { fr = true }, Ste = { fr = true },
}

-- E5 · le jour ne se sépare pas de son mois.
local MOIS = {
  janvier = { fr = true }, ['f\195\169vrier'] = { fr = true }, mars = { fr = true },
  avril = { fr = true }, mai = { fr = true }, juin = { fr = true },
  juillet = { fr = true }, ['ao\195\187t'] = { fr = true }, septembre = { fr = true },
  octobre = { fr = true }, novembre = { fr = true }, ['d\195\169cembre'] = { fr = true },
  Januar = { de = true }, Februar = { de = true }, ['M\195\164rz'] = { de = true },
  April = { de = true }, Mai = { de = true }, Juni = { de = true }, Juli = { de = true },
  August = { de = true }, September = { de = true }, Oktober = { de = true },
  November = { de = true }, Dezember = { de = true },
  gennaio = { it = true }, febbraio = { it = true }, marzo = { it = true },
  aprile = { it = true }, maggio = { it = true }, giugno = { it = true },
  luglio = { it = true }, agosto = { it = true }, settembre = { it = true },
  ottobre = { it = true }, novembre = { it = true }, dicembre = { it = true },
}

-- Le jeton sans la ponctuation qui le termine : « km. » se lit « km », « 725, » se lit
-- « 725 ». La forme entière est essayée d'abord, sans quoi « fr. » deviendrait « fr ».
local function nu(j)
  return (j:gsub('[%.,;:%)%]%!%?]+$', ''))
end

-- Ce que devient l'espace entre deux jetons, pour les règles qui n'ont besoin de rien
-- d'autre : 'garder', 'insecable', 'fine' ou 'retirer'.
local function verdict_jetons(g, d)
  if g == '' or d == '' then return 'garder' end
  local dn, gn = nu(d), nu(g)

  -- E7 · pas d'espace à l'intérieur des parenthèses ni des crochets. Le Guide est net et
  -- les deux langues s'accordent ici : « (ci-joint) », jamais « ( ci-joint ) ».
  if g:sub(-1) == '(' or g:sub(-1) == '[' then return 'retirer' end
  if d:sub(1, 1) == ')' or d:sub(1, 1) == ']' then return 'retirer' end

  -- E8 · la virgule et le point sont collés au mot qui les précède, dans les deux
  -- langues. Un point suivi d'un chiffre est une décimale ou une numérotation, et l'on
  -- n'y touche pas. Les points de suspension ne passent pas par ici : S1 en a fait un
  -- « … », qui garde son espace quand il remplace un mot au milieu d'une phrase.
  if d:sub(1, 1) == ',' then return 'retirer' end
  if d:sub(1, 1) == '.' and not d:sub(2, 2):match('%d') then return 'retirer' end

  -- E6 · le groupement des nombres ne se coupe pas. Le français groupe par trois à
  -- partir de cinq chiffres, à la fine ; l'allemand suisse groupe à l'apostrophe, qui
  -- n'ouvre aucune coupure et n'a donc rien à protéger. La règle ne CONVERTIT pas
  -- 35000 en 35 000 : ce serait changer le texte, et c'est une décision de rédaction.
  -- Ici on ne fait que rendre insécable ce que la rédaction a déjà groupé.
  if g:match('%d$') and dn:match('^%d%d%d$') then return 'fine' end

  -- E5 · les insécables de contexte.
  if g:match('%d$') and (ici(APRES_NOMBRE[d]) or ici(APRES_NOMBRE[dn])) then
    return 'insecable'
  end
  if AVANT_CHIFFRES[gn] and d:match('^%d') then return 'insecable' end
  if ici(AVANT_NOMBRE[g]) and d:match('^%d') then return 'insecable' end
  if ici(CIVILITES[g]) and d:match('^%u') then return 'insecable' end
  if ici(MOIS[dn]) and g:match('^%d%d?%.?$') then return 'insecable' end
  -- L'initiale d'un prénom : « J. Dupont », « J.-P. Dupont ».
  if g:match('^%u%.$') or g:match('^%u%.%-%u%.$') then
    if d:match('^%u') then return 'insecable' end
  end
  -- Le chiffre romain qui suit un nom : « Louis XIV », « Jean-Paul II ». Deux signes au
  -- moins — un « I » seul est plus souvent le pronom anglais que le nombre un.
  if g:match('^%u%a%a') and dn:match('^[IVXLCDM][IVXLCDM]+$') then return 'insecable' end

  return 'garder'
end

-- Les règles de jetons, appliquées à une chaîne entière. Ne sert donc qu'aux MetaString
-- (titre, sous-titre, résumés) et au texte des tableaux réinjectés : un Str de pandoc ne
-- contient jamais d'espace, et c'est sort_de_l_espace() qui décide pour lui.
local function e_jetons(t)
  local js = jetons(t)
  local sortie = {}
  for i = 1, #js do
    local j = js[i]
    if j.espace and i > 1 and i < #js then
      local quoi = verdict_jetons(js[i - 1].texte, js[i + 1].texte)
      if quoi == 'insecable' then
        sortie[#sortie + 1] = NBSP
      elseif quoi == 'fine' then
        sortie[#sortie + 1] = FINE
      elseif quoi ~= 'retirer' then
        sortie[#sortie + 1] = j.texte
      end
    else
      sortie[#sortie + 1] = j.texte
    end
  end
  return table.concat(sortie)
end

-- ───────────────────────────────────────────────────────── A4 · majuscules accentuées
--
-- Le Guide accentue les capitales comme les bas de casse, versales comprises : « À
-- l'heure actuelle », « ÉTAT DES LIEUX ». C'est le défaut le plus coûteux de la chaîne,
-- parce qu'il est IRRÉVERSIBLE en aval : print.css passe l'en-tête courant (§2), la
-- rubrique du hero (§5) et le titre d'un encadré (§8) en `text-transform: uppercase`, et
-- une rubrique tapée « Ecole inclusive » y sort « ECOLE INCLUSIVE », où plus rien ne
-- laisse deviner l'accent perdu.
--
-- ⚠ Deux régimes, et la raison de la différence est l'anglais. « Education » est un mot
-- français mal accentué dans un titre de rubrique, mais c'est le mot juste dans
-- « International Journal of Inclusive Education », qui se cite au fil du texte et en
-- bibliographie. Le lexique ne CORRIGE donc que là où l'anglais n'a rien à faire — titre,
-- sous-titre, intertitres — et se contente de SIGNALER dans le corps (code C3).
--
-- Chaque entrée ne rectifie que la CAPITALE D'ATTAQUE et laisse la suite du mot telle
-- quelle : « Elève » devient « Élève » parce que l'accent grave, lui, se tape sans peine
-- sur un clavier suisse. Un mot dont il manquerait aussi un accent intérieur est une
-- faute d'orthographe, pas un défaut de composition, et n'est pas de ce ressort.
local LEXIQUE_MAJ = {
  { 'Ecol', '\195\137col' },      { 'Educ', '\195\137duc' },
  { 'Etat', '\195\137tat' },      { 'Etabl', '\195\137tabl' },
  { 'Etud', '\195\137tud' },      { 'Eval', '\195\137val' },
  { 'Egal', '\195\137gal' },      { 'Eglis', '\195\137glis' },
  { 'Equip', '\195\137quip' },    { 'Econom', '\195\137conom' },
  { 'El\195\168v', '\195\137l\195\168v' },
  { 'Emanc', '\195\137manc' },    { 'Emot', '\195\137mot' },
  { 'Epreuv', '\195\137preuv' },  { 'Equit', '\195\137quit' },
  { 'Ethiq', '\195\137thiq' },    { 'Etrang', '\195\137trang' },
  { 'Evolu', '\195\137volu' },    { 'Ecrit', '\195\137crit' },
  { 'Echang', '\195\137chang' },  { 'Echec', '\195\137chec' },
  { 'Elabor', '\195\137labor' },  { 'Energ', '\195\137nerg' },
  { 'Enonc', '\195\137nonc' },    { 'Epanou', '\195\137panou' },
  { 'Etay', '\195\137tay' },      { 'Elargi', '\195\137largi' },
  { 'Eclair', '\195\137clair' },  { 'Ecout', '\195\137cout' },
  { 'Emerg', '\195\137merg' },    { 'Egard', '\195\137gard' },
  { 'Evit', '\195\137vit' },      { 'Evalu', '\195\137valu' },
  { 'Etre', '\195\138tre' },      -- circonflexe, et non aigu
}

-- Le « A » isolé qui est un « À ». La liste des mots qui peuvent le suivre est fermée, et
-- c'est elle qui rend la règle sûre : « A. Dupont » est une initiale (le point la retient
-- ici), « A Study of… » un titre anglais, et ni l'un ni l'autre ne figure ci-dessous.
local SUIVANTS_A = {
  la = true, le = true, les = true, un = true, une = true, des = true, ce = true,
  cet = true, cette = true, ces = true, son = true, sa = true, ses = true, leur = true,
  leurs = true, mon = true, ma = true, mes = true, notre = true, nos = true,
  votre = true, vos = true, tout = true, toute = true, tous = true, toutes = true,
  chaque = true, plusieurs = true, quelques = true, quel = true, quelle = true,
  partir = true, propos = true, travers = true, distance = true, domicile = true,
  savoir = true, noter = true, condition = true, ['d\195\169faut'] = true,
  ['c\195\180t\195\169'] = true, ['\195\169gard'] = true, court = true, long = true,
  moyen = true, deux = true, trois = true, nouveau = true, ['l\226\128\153'] = true,
}

-- Vrai si le jeton peut suivre un « À » : un mot de la liste, ou n'importe quel mot élidé
-- (« l’école », « l’heure ») — l'élision ne s'écrit qu'après une préposition ou un
-- déterminant, jamais après la lettre A d'une énumération.
local function suit_un_a(d)
  if d == '' then return false end
  if d:sub(1, 4) == 'l' .. APO then return true end
  return SUIVANTS_A[bas_de_casse(nu(d))] == true
end

-- ⚠ En OUVERTURE DE PHRASE seulement, et c'est une correction de ma première version :
-- un « A » capital au milieu d'une phrase — « il va A la maison » — n'est pas un « À »
-- mais un « à » minuscule, et le remplacer par la capitale accentuée aggraverait la
-- faute au lieu de la corriger. Hors début de phrase, c'est une coquille de casse, que le
-- filtre n'a aucun moyen de distinguer d'un intitulé (« variante A la plus courte »).
local FIN_DE_PHRASE = { ['.'] = true, ['!'] = true, ['?'] = true, [':'] = true }

local function ouvre_une_phrase(jeton)
  if jeton == '' then return true end
  if jeton:sub(-3) == ELL then return true end
  return FIN_DE_PHRASE[jeton:sub(-1)] == true
end

local function a4_a_isole(t)
  if COLLEE then return t end
  local js = jetons(t)
  local debut = true                           -- le premier jeton ouvre une phrase
  for i = 1, #js do
    local j = js[i]
    if not j.espace then
      if debut and j.texte == 'A' and js[i + 2] ~= nil and suit_un_a(js[i + 2].texte) then
        j.texte = '\195\128'                   -- À
      end
      debut = ouvre_une_phrase(j.texte)
    end
  end
  local sortie = {}
  for _, j in ipairs(js) do sortie[#sortie + 1] = j.texte end
  return table.concat(sortie)
end

-- Correction du lexique : titres seulement, voir l'avertissement ci-dessus.
local function a4_capitales(t)
  if COLLEE then return t end
  for _, paire in ipairs(LEXIQUE_MAJ) do
    t = t:gsub('%f[%a]' .. paire[1], paire[2])
  end
  return t
end

-- Signalement dans le corps : le mot est laissé tel quel, et la relecture tranche.
--
-- ⚠ Appelé en fin de course, sur le document entier (vider_constats), et non au fil des
-- chaînes : à ce moment-là les titres ont DÉJÀ reçu a4_capitales, et ce qui subsiste est
-- donc exactement ce qui n'a pas été corrigé. Appelé depuis normaliser_texte, il avertissait
-- pour un intertitre qu'il venait lui-même de rectifier.
local function a4_signaler(t)
  if COLLEE then return end
  for _, paire in ipairs(LEXIQUE_MAJ) do
    if t:find('%f[%a]' .. paire[1]) then
      signaler('majuscule-accentuee',
        'une majuscule non accentuée subsiste dans le corps (« Etat », « Ecole ») : le '
          .. 'Guide du typographe les accentue. Le filtre ne corrige que les titres, un '
          .. 'mot anglais pouvant s’écrire de même — à trancher à la relecture.',
        'ein Grossbuchstabe ohne Akzent ist im Text geblieben (« Etat », « Ecole »): der '
          .. 'Guide du typographe akzentuiert sie. Der Filter korrigiert nur die Titel, '
          .. 'da ein englisches Wort gleich geschrieben sein kann – bei der Korrektur zu '
          .. 'entscheiden.')
      return
    end
  end
end

-- ─────────────────────────────────────────────────────────────── A5 · ligatures œ et æ
--
-- Obligatoires en français, et sur une liste fermée : c'est ce qui évite « coefficient »,
-- « coexister », « moelle », « poêle », « Groenland » et « goéland », où le o et le e ne
-- se lient pas. Chaque entrée est une SUITE DE LETTRES qui n'apparaît dans aucun autre
-- mot que celui de sa famille — « oeuvre » ne se rencontre que dans œuvre, œuvrer,
-- chef-d'œuvre, main-d'œuvre, désœuvré —, ce qui permet de la corriger n'importe où dans
-- le mot sans avoir à énumérer les formes fléchies.
local OE, OE_MAJ = '\197\147', '\197\146'      -- œ, Œ
local AE, AE_MAJ = '\195\166', '\195\134'      -- æ, Æ
local LIGATURES = {
  { 'oeuvre', OE .. 'uvre' }, { 'oeil', OE .. 'il' }, { 'coeur', 'c' .. OE .. 'ur' },
  { 'choeur', 'ch' .. OE .. 'ur' }, { 'soeur', 's' .. OE .. 'ur' },
  { 'boeuf', 'b' .. OE .. 'uf' }, { 'moeurs', 'm' .. OE .. 'urs' },
  { 'noeud', 'n' .. OE .. 'ud' }, { 'voeu', 'v' .. OE .. 'u' },
  { 'oeuf', OE .. 'uf' }, { 'oesophag', OE .. 'sophag' },
  { 'oecum', OE .. 'cum' }, { 'oedem', OE .. 'dem' }, { 'oed\195\168m', OE .. 'd\195\168m' },
  { 'oenolog', OE .. 'nolog' }, { 'oestrog', OE .. 'strog' }, { 'foet', 'f' .. OE .. 't' },
  { 'caecum', 'c' .. AE .. 'cum' }, { 'caetera', 'c' .. AE .. 'tera' },
  { 'curriculum vitae', 'curriculum vit' .. AE },
}

-- La casse est portée par la première lettre : « Oeuvre » et « OEUVRE » s'écrivent avec
-- la ligature capitale, « ŒUVRE ». Les trois formes sont donc essayées.
-- ⚠ :upper() est un traitement d'OCTETS : il ne connaît ni œ, ni æ, ni é. La capitale
-- d'une ligature est donc écrite à la main, et les deux fonctions ci-dessous travaillent
-- sur la liste de caractères, comme tout le reste du fichier.
local CAPITALE = { [OE] = OE_MAJ, [AE] = AE_MAJ }

local function initiale_capitale(t)
  local cs = caracteres(t)
  if cs[1] == nil then return t end
  cs[1] = CAPITALE[cs[1]] or haut_de_casse(cs[1])
  return table.concat(cs)
end

local function en_capitales(t)
  local out = {}
  for _, c in ipairs(caracteres(t)) do out[#out + 1] = CAPITALE[c] or haut_de_casse(c) end
  return table.concat(out)
end

-- Les trois graphies qu'un traitement de texte peut produire : « oeuvre », « Oeuvre » en
-- tête de phrase, « OEUVRE » dans un titre saisi en capitales.
local function a5_ligatures(t)
  if COLLEE then return t end
  for _, paire in ipairs(LIGATURES) do
    local bas, remp = paire[1], paire[2]
    t = t:gsub(bas, remp)
    t = t:gsub(initiale_capitale(bas), initiale_capitale(remp))
    t = t:gsub(en_capitales(bas), en_capitales(remp))
  end
  return t
end

-- ──────────────────────────────────────────────────── S4 · le point abréviatif final
--
-- « Le point abréviatif absorbe le point final » : « etc.. » n'existe pas, et « etc… »
-- non plus — le Guide interdit les points de suspension derrière une abréviation. S1
-- ayant déjà réduit « ... » à « … », tout « .. » qui subsiste est un point doublé.
-- ⚠ Pas de %f[%W] pour clore le motif : le caractère qui précède la frontière serait un
-- point, qui appartient lui-même à %W, et l'appariement ne peut alors jamais avoir lieu.
-- Le troisième point est donc écarté à la main, par [^%.] et par une variante en fin de
-- chaîne — un « etc.. » de pandoc finit presque toujours son Str.
--
-- « etc... » a d'ailleurs déjà perdu son point abréviatif quand on arrive ici : S1 a lu
-- les trois premiers points comme des points de suspension et rendu « etc… ». C'est donc
-- « etc » sans point, suivi du signe, qu'il faut reconnaître.
local function s4_point_abreviatif(t)
  t = t:gsub('(%a)%.%.([^%.])', '%1.%2')
  t = t:gsub('(%a)%.%.$', '%1.')
  t = t:gsub('(%f[%w]etc)%.?' .. ELL, '%1.')
  t = t:gsub('(%f[%w]usw)%.?' .. ELL, '%1.')
  return t
end

-- ─────────────────────────────────── T1 · l'insécable devant le tiret d'incise (français)
--
-- Le tiret d'incise ne commence pas une ligne : il reste avec le mot qu'il suit. La règle
-- est déjà celle de test/typo-check.py pour l'interface (_incise_fr) ; elle manquait ici,
-- et le corps des articles ne l'avait donc jamais. Elle ne CRÉE pas d'espace : « mot–mot »
-- sans blanc n'est pas une incise, et le tiret y est peut-être voulu.
local function t1_incise(t)
  if COLLEE then return t end
  return (t:gsub('([^ ' .. NBSP .. '])[ ]' .. DEMI .. '[ ]', '%1' .. NBSP .. DEMI .. ' '))
end

-- ────────────────────────────────────────── L2 · déterminant, préposition, conjonction
--
-- Dans un titre, un mot outil ne reste pas seul en fin de ligne : « … comme partenaire de
-- / formation » se recompose « … / comme partenaire de formation ». La coupure se fait
-- DEVANT le déterminant ou la préposition, ce qu'obtient une insécable derrière lui.
--
-- ⚠ Titres et sous-titres seulement. Dans le corps, souder tous les mots outils d'un
-- paragraphe justifié en colonne étroite fabriquerait des lézardes : c'est le nombre de
-- points de coupure qui permet à WeasyPrint de répartir le blanc.
--
-- Le plafond de 30 signes n'est pas décoratif : le titre du hero vit dans une boîte de
-- 67 % de la justification (print.css §5, `.szh-hero-main`), soit environ 34 signes à
-- 25 px, et cette boîte est en `overflow: hidden`. Un groupe insécable plus long qu'elle
-- serait tronqué sans bruit. Au-delà du plafond, l'espace reste donc sécable.
local PLAFOND_LIE = 30
local MOTS_LIES = {
  fr = {
    le = true, la = true, les = true, un = true, une = true, des = true, du = true,
    de = true, au = true, aux = true, ['\195\160'] = true, en = true, et = true,
    ou = true, ni = true, ['or'] = true, mais = true, car = true, que = true, qui = true,
    quoi = true, dont = true, ['o\195\185'] = true, si = true, comme = true,
    dans = true, sur = true, sous = true, par = true, pour = true, avec = true,
    sans = true, chez = true, vers = true, entre = true, contre = true, selon = true,
    depuis = true, ['d\195\168s'] = true, ['apr\195\168s'] = true, avant = true,
    pendant = true, durant = true, ['malgr\195\169'] = true, sauf = true, hors = true,
    ce = true, cet = true, cette = true, ces = true, mon = true, ma = true, mes = true,
    ton = true, ta = true, tes = true, son = true, sa = true, ses = true,
    notre = true, nos = true, votre = true, vos = true, leur = true, leurs = true,
    quel = true, quelle = true, quels = true, quelles = true, tout = true,
    toute = true, tous = true, toutes = true, chaque = true, plus = true, non = true,
  },
  de = {
    der = true, die = true, das = true, den = true, dem = true, des = true,
    ein = true, eine = true, einen = true, einem = true, einer = true, eines = true,
    und = true, oder = true, aber = true, denn = true, sondern = true, als = true,
    wie = true, dass = true, ob = true, ['in'] = true, im = true, an = true,
    am = true,
    auf = true, aus = true, bei = true, beim = true, mit = true, nach = true,
    von = true, vom = true, zu = true, zum = true, zur = true, ['f\195\188r'] = true,
    ['\195\188ber'] = true, unter = true, vor = true, durch = true, gegen = true,
    ohne = true, um = true, bis = true, seit = true, trotz = true,
    ['w\195\164hrend'] = true, wegen = true, statt = true, mein = true, meine = true,
    dein = true, deine = true, sein = true, seine = true, ihr = true, ihre = true,
    unser = true, unsere = true, welche = true, welcher = true, welches = true,
    kein = true, keine = true, nicht = true, mehr = true,
  },
  it = {
    il = true, lo = true, la = true, i = true, gli = true, le = true, un = true,
    uno = true, una = true, di = true, del = true, dello = true, della = true,
    dei = true, degli = true, delle = true, a = true, al = true, allo = true,
    alla = true, ai = true, agli = true, alle = true, da = true, dal = true,
    ['in'] = true, nel = true, nella = true, con = true, su = true, sul = true,
    per = true, tra = true, fra = true, e = true, o = true, ma = true, che = true,
    come = true, se = true, non = true,
  },
}

local function mot_lie(j)
  local table_langue = MOTS_LIES[LANGUE]
  if table_langue == nil then return false end
  return table_langue[bas_de_casse(nu(j))] == true
end

-- Longueur en SIGNES et non en octets : « préférence » compte dix signes, pas douze.
local function longueur(t)
  return (utf8 and utf8.len(t)) or #t
end

-- Version chaîne : le titre du hero est une MetaString, donc une phrase entière.
local function l2_texte(t)
  local js = jetons(t)
  local sortie = {}
  local lie = 0                     -- longueur du groupe insécable en cours
  for i = 1, #js do
    local j = js[i]
    if j.espace and i > 1 and i < #js then
      local g, d = js[i - 1].texte, js[i + 1].texte
      local groupe = lie + longueur(g) + 1 + longueur(d)
      if mot_lie(g) and groupe <= PLAFOND_LIE then
        sortie[#sortie + 1] = NBSP
        lie = lie + longueur(g) + 1
      else
        sortie[#sortie + 1] = j.texte
        lie = 0
      end
    else
      sortie[#sortie + 1] = j.texte
    end
  end
  return table.concat(sortie)
end

-- Toutes les règles de texte, dans l'ordre.
local function normaliser_texte(t)
  controler(t)
  t = a1_apostrophe(t)
  t = a2a3_chevrons(t)
  t = a4_a_isole(t)
  t = a5_ligatures(t)
  t = t1_tiret(t)
  t = t1_incise(t)
  t = s1_suspension(t)
  t = s4_point_abreviatif(t)     -- après S1 : tout « .. » restant est un point doublé
  if not COLLEE then t = s2_ordinaux(t) end
  t = t2_plage_pages(t)          -- avant e4 : elle a besoin de l'espace ordinaire
  t = e4_abreviations(t)
  t = e_jetons(t)                -- E5 à E8, sur les chaînes qui portent des espaces
  t = e_espacement(t)
  return t
end

-- Les règles réservées aux titres : le lexique des majuscules accentuées et la soudure
-- des mots outils. Appliquées au titre, au sous-titre et aux intertitres, jamais au corps.
local function normaliser_titre(t)
  return l2_texte(a4_capitales(t))
end

-- ------------------------------------------------ règles qui traversent une frontière
--
-- pandoc découpe « mot : suite » en Str/Space/Str : l'espace à corriger est un élément de
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

  -- T1 · le tiret d'incise ne commence pas une ligne (français). Le tiret doit être seul
  -- ou suivi d'un blanc : le « 12–25 » d'une plage de pages allemande commence par un
  -- chiffre et ne passe donc jamais par ici.
  if not COLLEE and ts:sub(1, 3) == DEMI and (#ts == 3 or ts:sub(4, 4) == ' ') then
    return 'insecable'
  end

  -- E3 · pour-cent et pour mille, dans les trois langues
  if (ts:sub(1, 1) == '%' or ts:sub(1, 3) == PMILLE) and ta:sub(-1):match('%d') then
    return 'insecable'
  end

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

  -- E5 à E8 · les règles de jetons, les mêmes exactement que sur une chaîne entière : le
  -- jeton de gauche est le dernier de l'inline précédent, celui de droite le premier du
  -- suivant. Écrire la règle une seule fois est ce qui garantit qu'un « 12 km » de
  -- tableau et un « 12 km » de paragraphe se composent pareil.
  return verdict_jetons(jeton_gauche(ta), jeton_droite(ts))
end

-- --------------------------------------------------------------------- le HTML réinjecté
--
-- szh-tabelle-inclure pose les tableaux en RawBlock html : leur texte n'est plus un Str et
-- échapperait à tout. On y passe donc à la main, en ne touchant que ce qui est entre deux
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
  'pagetitle', 'description', 'resumes', 'licence-texte',
}
local META_AUTEUR = { 'fonction', 'affiliation' }

-- Les clés qui portent un TITRE, et reçoivent en plus A4 (lexique des majuscules
-- accentuées) et L2 (soudure des mots outils).
--
-- ⚠ `titre-affiche` et `sous-titre-affiche` sont ce que le hero imprime réellement
-- (gabarit szh-article.html, lignes 110 et 112). szh-maquette.lua les pose AVANT ce
-- filtre, en MetaString, à partir de `title` : normaliser `title` seul ne les touchait
-- donc pas, et la couverture n'avait aucune typographie — ni insécable devant un
-- deux-points, ni chevron, ni ligature (constaté le 08.09.2026). Normaliser les quatre
-- clés est ce qui rend la couverture conforme au corps.
local META_TITRE = { 'title', 'subtitle', 'titre-affiche', 'sous-titre-affiche' }

local function normaliser_valeur_meta(v, apres)
  if v == nil then return nil end
  local regles = function(t)
    t = normaliser_texte(t)
    if apres ~= nil then t = apres(t) end
    return t
  end
  -- ⚠ Une MetaString arrive dans un filtre Lua en CHAÎNE NUE, et non en table portant un
  -- champ `.t` : c'est ainsi que pandoc la marshale. Sans ce premier cas, la clé
  -- `titre-affiche` que szh-maquette.lua pose en pandoc.MetaString traversait la
  -- normalisation sans rien recevoir — le test de type ne mordait jamais, en silence, une
  -- chaîne Lua rendant nil pour n'importe quel champ. Mesuré le 08.09.2026.
  if type(v) == 'string' then return pandoc.MetaString(regles(v)) end
  if v.t == 'MetaString' then return pandoc.MetaString(regles(v.text)) end
  if v.walk then
    return v:walk({ Str = function(s) return pandoc.Str(regles(s.text)) end })
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
  for _, cle in ipairs(META_TITRE) do
    if meta[cle] ~= nil then
      meta[cle] = normaliser_valeur_meta(meta[cle], normaliser_titre)
    end
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
  local depuis, vers = '%-', DEMI              -- allemand, italien
  if not COLLEE then depuis, vers = DEMI, '-' end
  for i = 1, #inl do
    local el = inl[i]
    if el.t == 'Str' and el.text:match('^%d+' .. depuis .. '%d') then
      local j = i - 1
      while j >= 1 and (inl[j].t == 'Space' or inl[j].t == 'SoftBreak') do j = j - 1 end
      local avant = j >= 1 and texte_de(inl[j]) or ''
      if avant:match('%f[%w][pS]p?%.$') or avant:match('%f[%w][pS]p?%.' .. NBSP .. '$') then
        inl[i] = pandoc.Str((el.text:gsub('^(%d+)' .. depuis .. '(%d)', '%1' .. vers .. '%2')))
      end
    end
  end
  return inl
end

-- A4a sur la liste : « À l'école » arrive en trois inlines — Str « A », Space, Str
-- « l’école » —, et le « A » ne peut donc pas se décider dans sa propre chaîne. Même
-- restriction qu'en chaîne : ouverture de phrase seulement.
local function a4_sur_liste(inl)
  if COLLEE then return inl end
  local debut = true
  for i = 1, #inl do
    local el = inl[i]
    if el.t == 'Space' or el.t == 'SoftBreak' then
      -- l'espace ne referme pas une phrase : l'état reste celui du jeton précédent
    else
      if debut and el.t == 'Str' and el.text == 'A' then
        local j = i + 1
        while j <= #inl and (inl[j].t == 'Space' or inl[j].t == 'SoftBreak') do j = j + 1 end
        if j > i + 1 and j <= #inl and suit_un_a(jeton_droite(texte_de(inl[j]))) then
          inl[i] = pandoc.Str('\195\128')
        end
      end
      debut = ouvre_une_phrase(jeton_gauche(texte_de(el)))
    end
  end
  return inl
end

-- L2 sur la liste : les intertitres du corps. Le titre y est déjà découpé en Str, Space,
-- Str, et le mot outil à souder est donc le dernier jeton de l'inline qui précède
-- l'espace. Le plafond de 30 signes se compte sur le groupe insécable en cours, ce que
-- seule cette passe-ci peut faire : elle voit la ligne entière.
local function l2_sur_liste(inl)
  local sortie = pandoc.Inlines({})
  local lie = 0
  for i = 1, #inl do
    local el = inl[i]
    if el.t == 'Space' or el.t == 'SoftBreak' then
      local g = jeton_gauche(texte_de(inl[i - 1]))
      local d = jeton_droite(texte_de(inl[i + 1]))
      local groupe = lie + longueur(g) + 1 + longueur(d)
      if g ~= '' and d ~= '' and mot_lie(g) and groupe <= PLAFOND_LIE then
        sortie:insert(pandoc.Str(NBSP))
        lie = lie + longueur(g) + 1
      else
        sortie:insert(el)
        lie = 0
      end
    else
      sortie:insert(el)
    end
  end
  return sortie
end

-- Les intertitres reçoivent les règles de titre. pandoc filtre les inlines d'un bloc
-- avant le bloc : transformer_inlines et transformer_str sont donc déjà passés ici, et il
-- ne reste que ce qui est réservé aux titres.
--
-- ⚠ Avant szh-sections.lua, qui écrira le numéro de section devant le titre : le premier
-- mot est encore le premier mot, et A4 ne se trompe pas de position. C'est aussi ce qui
-- fait qu'aucun numéro ne vient s'intercaler dans un groupe soudé par L2.
local function transformer_header(h)
  h.content = l2_sur_liste(h.content:walk({
    Str = function(s) return pandoc.Str(a4_capitales(s.text)) end,
  }))
  return h
end

local function transformer_inlines(inl)
  inl = t2_sur_liste(inl)
  inl = a4_sur_liste(inl)
  local sortie = pandoc.Inlines({})
  for i = 1, #inl do
    local el = inl[i]
    if el.t == 'Space' or el.t == 'SoftBreak' then
      local quoi = sort_de_l_espace(inl[i - 1], inl[i + 1])
      if quoi == 'insecable' then
        sortie:insert(pandoc.Str(NBSP))
      elseif quoi == 'fine' then
        sortie:insert(pandoc.Str(FINE))
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

-- Les constats partent en fin de course, une ligne par code et non par occurrence. C3
-- (majuscules non accentuées) se cherche ICI, sur le document déjà transformé : les titres
-- y sont corrigés, et il ne reste donc que le corps, seul endroit où le filtre s'abstient.
local function vider_constats(doc)
  doc:walk({ Str = function(s) a4_signaler(s.text) end })
  for _, ligne in ipairs(constats) do io.stderr:write(ligne .. '\n') end
  return nil
end

return {
  { Meta = poser_langue },
  {
    Str = transformer_str,
    Quoted = transformer_quoted,
    Inlines = transformer_inlines,
    Header = transformer_header,
    RawBlock = transformer_rawblock,
    Meta = transformer_meta,
    Pandoc = vider_constats,
  },
}
