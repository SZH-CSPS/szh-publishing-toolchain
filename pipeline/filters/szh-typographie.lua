-- Compilation : applique au texte de l'article la typographie de la maison, selon sa
-- langue (fr, de, it). Règles appliquées : A1 à A5, E1 à E9, T1, T2, S1, S2, S4 et L2 ;
-- C1 à C3 sont signalées sans correction. Les codes sont ceux de docs/TYPOGRAPHIE.md ;
-- la rédaction lit docs/TYPOGRAPHIE-FR.md et docs/TYPOGRAPHIE-DE.md.
--
-- Le .md n'est pas réécrit : la typographie est posée sur l'arbre pandoc, et la source
-- reste ce que la rédaction a tapé.
--
-- Français et allemand ont des règles d'espacement opposées : le français sépare
-- (insécable devant la ponctuation haute, à l'intérieur des guillemets), l'allemand
-- suisse et l'italien collent.
--
-- Place dans la chaîne (pipeline/filtres.mk) : après szh-tabelle-scope, avant
-- szh-titre-lignes, szh-numerotation et szh-citations, pour ne traiter que le texte de la
-- rédaction. assainir_iso(), dans szh-citations.lua, neutralise les caractères posés ici
-- pour ses ancrages.
--
-- Non corrigé :
--   * le « ß » d'un article allemand (C1, signalé) : un nom propre ou une citation le
--     gardent ;
--   * les guillemets droits que pandoc n'a pas appariés (C2, signalé) ;
--   * les plages de nombres autres que des pages (« 2020-2021 », « COVID-19 », un DOI) :
--     seules les plages précédées de « p. » ou « S. » sont traitées (T2) ;
--   * le contenu des `code` et des blocs de code.

local NBSP = '\194\160'                       -- U+00A0, l'espace insécable
local FINE = '\226\128\175'                   -- U+202F, la fine insécable
local DEMI = '\226\128\147'                   -- U+2013, demi-cadratin
local CADRATIN = '\226\128\148'               -- U+2014, proscrit
local APO = '\226\128\153'                    -- U+2019, apostrophe typographique
local ELL = '\226\128\166'                    -- U+2026, points de suspension
local PMILLE = '\226\128\176'                 -- U+2030, pour mille
local GO, GF = '\194\171', '\194\187'         -- « »
local SO, SF = '\226\128\185', '\226\128\186' -- ‹ ›
local SIMPLE_OUVRANT_FR = '\226\128\152'      -- U+2018 ‘ : ouvre en français, ferme en allemand
local SIMPLE_OUVRANT_DE = '\226\128\154'      -- U+201A ‚ : ouvre toujours (idiome allemand natif)

-- Lettre au sens large. Les classes Lua portent sur des octets et %a ne connaît que
-- l'ASCII : tout octet non ASCII est tenu pour une lettre, sinon A1 raterait « d'été ».
-- L'apostrophe, ASCII, ne peut pas être confondue.
local LETTRE = '[%a\128-\255]'

-- Découpe une chaîne UTF-8 en caractères. Une classe d'octets ne peut pas décrire « une
-- espace quelconque » : l'octet 0xC2 ouvre à la fois l'insécable et le chevron «. Les
-- règles d'espacement travaillent donc sur cette liste.
local function caracteres(t)
  local out = {}
  for c in t:gmatch('[^\128-\191][\128-\191]*') do out[#out + 1] = c end
  return out
end

local EST_ESPACE = { [' '] = true, [NBSP] = true,
                     ['\226\128\175'] = true, ['\226\128\137'] = true }
-- L'insécable et la fine insécable satisfont toutes deux une règle qui demande une
-- insécable.
local INSECABLES = { [NBSP] = true, ['\226\128\175'] = true }
local HAUTE = { [';'] = true, [':'] = true, ['!'] = true, ['?'] = true }
-- E3 : signes séparés de leur nombre dans les trois langues.
local SEPARE_NOMBRE = { ['%'] = true, [PMILLE] = true }

-- Signes de plusieurs octets qui ne sont pas des lettres. Tout autre caractère de plusieurs
-- octets (é, ü, œ, ç) compte comme une lettre.
local PAS_LETTRE = {
  [GO] = true, [GF] = true, [SO] = true, [SF] = true,
  [ELL] = true, [DEMI] = true, [CADRATIN] = true, [APO] = true, [NBSP] = true,
}

local function est_lettre(c)
  if c == nil or EST_ESPACE[c] then return false end
  if #c > 1 then return not PAS_LETTRE[c] end
  return c:match('%a') ~= nil
end

-- Changement de casse ASCII seulement. string.lower() suit la locale : sous Latin-1
-- (Windows francophone), il change l'octet 0xC3 qui ouvre « é » en UTF-8, et « Malgré »
-- devient introuvable dans les tables de mots. Les intervalles [A-Z] et [a-z] ne touchent
-- aucun octet d'un caractère UTF-8 de plusieurs octets. Les clés accentuées des tables
-- sont donc écrites en minuscules.
local function bas_de_casse(t)
  return (t:gsub('[A-Z]', function(c) return string.char(c:byte() + 32) end))
end

local function haut_de_casse(t)
  return (t:gsub('[a-z]', function(c) return string.char(c:byte() - 32) end))
end

-- Langue de composition.
local LANGUE = 'fr'
local COLLEE = false        -- vrai pour l'allemand et l'italien : rien ne se sépare

-- Signalements, écrits une fois le document parcouru : une ligne par code, pas par
-- occurrence.
local SLUG = ''
local vus = {}
local constats = {}

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[typographie] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

-- ------------------------------------------------------------------- les signalements
--
-- « | » sépare les champs du message : commun.sans_barre le retire d'un mot cité.
local sans_barre = commun.sans_barre

-- Rend le mot de `t` qui contient l'octet `pos` (position rendue par t:find), borné par
-- les espaces. Travaille sur caracteres() pour ne pas couper un caractère de plusieurs
-- octets.
local function mot_en(t, pos)
  if not pos then return nil end
  local cs = caracteres(t)
  local acc = 0
  local debut, fin
  for i, c in ipairs(cs) do
    local lo, hi = acc + 1, acc + #c
    if pos >= lo and pos <= hi then
      local g = i
      while g > 1 and not EST_ESPACE[cs[g - 1]] do g = g - 1 end
      local d = i
      while d < #cs and not EST_ESPACE[cs[d + 1]] do d = d + 1 end
      debut, fin = g, d
      break
    end
    acc = hi
  end
  if not debut then return nil end
  return table.concat(cs, '', debut, fin)
end

-- Format de la ligne de journal, lue par lib/journal.js :
--   [typo-avertissement] <code> | article « … » | mot « … » | <phrase fr> | [de] <Satz de>
-- Le champ « mot » est omis quand le mot n'a pas pu être retrouvé. La famille « typo »
-- n'a pas de clé i18n : journal.js affiche la phrase écrite ici.
local function signaler(code, mot, phrase_fr, phrase_de)
  if vus[code] then return end
  vus[code] = true
  local champs = { 'article « ' .. SLUG .. ' »' }
  if mot ~= nil and mot ~= '' then champs[2] = 'mot « ' .. sans_barre(mot) .. ' »' end
  constats[#constats + 1] = commun.ligne_constat('typo', 'avertissement', code, champs,
    phrase_fr, phrase_de)
end

-- ------------------------------------------------------ règles internes à une chaîne
--
-- Ce qui se décide sans regarder l'inline voisin. A2 pose les chevrons avant que E1 ne
-- règle leur espacement.

-- A1 · apostrophe typographique dans les élisions
local function a1_apostrophe(t)
  for _ = 1, 4 do                     -- « l'enfant d'ici » : deux élisions se chevauchent
    local neuf = t:gsub('(' .. LETTRE .. ")'(" .. LETTRE .. ')', '%1' .. APO .. '%2')
    if neuf == t then break end
    t = neuf
  end
  return t
end

-- A2 · les guillemets doubles courbes deviennent des chevrons.
--
-- « “ » ouvre en anglais (“word”) et ferme en allemand („Wort“) : il ouvre s'il est suivi
-- d'une lettre, sinon il ferme.
--
-- Les guillemets simples (A3) sont traités par a3_chevrons_sur_liste, qui voit le
-- paragraphe entier : « ’ » peut fermer une citation ou être une apostrophe (« qu’il »),
-- et ‘ ouvre en français mais ferme dans ‚…‘. Seul l'état de la citation en cours permet
-- de trancher.
local COURBES = {
  ['\226\128\158'] = { GO, GO },       -- „ : ouvre toujours
  ['\226\128\159'] = { GO, GO },       -- ‟ : ouvre toujours
  ['\226\128\157'] = { GF, GF },       -- ” : ferme toujours
  ['\226\128\156'] = { GO, GF },       -- “ : selon le voisinage
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

-- T2 · plage de pages. Seules les plages précédées de « p. », « pp. » ou « S. » sont
-- traitées : « 2020-2021 » ou « COVID-19 » ne sont pas des plages de pages. Passe avant
-- e4_abreviations, qui remplacerait l'espace du motif par une insécable.
--
-- Le français de Suisse romande écrit le trait d'union (« pp. 12-25 »), l'allemand le
-- demi-cadratin (« S. 12–25 ») : la règle convertit dans les deux sens.
--
-- Le lecteur markdown « smart » soude parfois l'abréviation au nombre par une insécable :
-- « pp.<NBSP>12-25 » arrive en une seule chaîne, « S. 3-4 » en trois inlines. Ce second
-- cas est traité sur la liste (t2_sur_liste).
local function t2_plage_pages(t)
  local depuis, vers = '%-', DEMI              -- allemand, italien
  if not COLLEE then depuis, vers = DEMI, '-' end
  t = t:gsub('(%f[%w][pS]p?%. ?%d+)' .. depuis .. '(%d)', '%1' .. vers .. '%2')
  t = t:gsub('(%f[%w][pS]p?%.' .. NBSP .. '%d+)' .. depuis .. '(%d)', '%1' .. vers .. '%2')
  return t
end

-- E1/E2/E3 · l'espacement, sur la liste de caractères.
--
-- Une suite d'espaces voisine d'un chevron ou d'une ponctuation haute devient une
-- insécable en français et disparaît en allemand ; si l'espace manque, le français la
-- pose. Un chevron en bout de chaîne est traité sur la liste d'inlines, qui voit la suite.
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
      -- Une insécable déjà posée est gardée telle quelle, fine comprise (la maquette en
      -- compose, par exemple dans « Source : »).
      local insec = (j == i + 1 and INSECABLES[cs[i]]) and cs[i] or NBSP
      -- E3 vaut dans les trois langues : décidé avant COLLEE.
      local separe = (apres ~= nil and SEPARE_NOMBRE[apres]
                      and avant ~= nil and avant:match('^%d$') ~= nil)
      -- E1 et E2. Les chevrons simples (‹ ›) suivent la même règle que les doubles.
      local colle = (avant == GO or avant == SO) or (apres == GF or apres == SF)
                    or (apres ~= nil and HAUTE[apres])
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
        if avant == GO or avant == SO then
          out[#out + 1] = NBSP
        elseif (c == GF or c == SF) and avant ~= nil and not EST_ESPACE[avant] then
          out[#out + 1] = NBSP
        elseif HAUTE[c] and est_lettre(avant)
            and (cs[i + 1] == nil or EST_ESPACE[cs[i + 1]] or HAUTE[cs[i + 1]]) then
          -- En fin de mot seulement : « https://… » et « 10:30 » gardent leurs
          -- deux-points collés, pas « DOI: ».
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
  local pos_ss = t:find('\195\159')
  if COLLEE and pos_ss then
    signaler('eszett', mot_en(t, pos_ss),
      'un « ß » subsiste : l’usage suisse écrit « ss », mais un nom propre et une citation '
        .. 'le gardent. À trancher à la relecture — le filtre n’y touche pas.',
      'ein «ß» ist geblieben: Der Schweizer Usus schreibt «ss», Eigennamen und Zitate '
        .. 'behalten es aber. Bei der Korrektur zu entscheiden – der Filter rührt es nicht an.')
  end
  local pos_guill = t:find('"', 1, true)
  if pos_guill then
    signaler('guillemets-droits', mot_en(t, pos_guill),
      'des guillemets droits (") subsistent : rien ne dit lequel ouvre et lequel ferme. '
        .. 'Remplacez-les par « et » à la relecture.',
      'gerade Anführungszeichen (") sind geblieben: Nichts sagt, welches öffnet und welches '
        .. 'schliesst. Bei der Korrektur durch « und » ersetzen.')
  end
end

-- ══════════════════════════════════════ les jetons, et les règles qui les regardent
--
-- Un jeton est un mot avec la ponctuation collée : « art. », « 12 », « km »,
-- « (ci-joint) ». Les règles E5 à E8 et A4 (« À » isolé) ne regardent que le jeton de
-- gauche et celui de droite. Elles servent ainsi aux chaînes entières (MetaString, texte
-- d'un tableau inséré) comme à la liste d'inlines, où l'espace est un élément.
--
-- Le découpage se fait sur caracteres(), pas sur une classe d'octets (voir caracteres).
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

-- Dernier et premier jeton d'un texte : ce que voit une règle de voisinage quand l'espace
-- est un élément de la liste d'inlines.
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

-- E5 · ce qui ne se sépare pas du nombre qui précède : unités abrégées, puis unités
-- écrites en mots (« 54,5 hectares »).
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
  -- degrés : « 39,1 °C ». Le signe seul (« 90° ») est collé au nombre, sans espace.
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
-- Second membre d'une durée ou d'une heure : « 4 h 04 », « 22 h 27 min 07 s », dans les
-- trois langues.
local AVANT_CHIFFRES = { h = true, min = true, s = true }

-- E5 · ce qui ne se sépare pas du nombre qui suit : renvois (« art. 8 ») et monnaie
-- placée devant. « p. », « pp. », « n° » et « S. » relèvent de E4.
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

-- E5 · la civilité et le titre ne se séparent pas du nom. Le français écrit « Dr » et
-- « Dre » sans point, l'allemand « Dr. ».
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

-- Le jeton sans sa ponctuation finale : « km. » donne « km », « 725, » donne « 725 ».
-- Les appelants essaient d'abord la forme entière, pour garder « fr. ».
local function nu(j)
  return (j:gsub('[%.,;:%)%]%!%?]+$', ''))
end

-- Rend ce que devient l'espace entre deux jetons : 'garder', 'insecable', 'fine' ou
-- 'retirer'.
local function verdict_jetons(g, d)
  if g == '' or d == '' then return 'garder' end
  local dn, gn = nu(d), nu(g)

  -- E7 · pas d'espace à l'intérieur des parenthèses ni des crochets : « (ci-joint) ».
  if g:sub(-1) == '(' or g:sub(-1) == '[' then return 'retirer' end
  if d:sub(1, 1) == ')' or d:sub(1, 1) == ']' then return 'retirer' end

  -- E8 · la virgule et le point se collent au mot qui précède. Un point suivi d'un
  -- chiffre (décimale, numérotation) est laissé. Les points de suspension, devenus « … »
  -- par S1, gardent leur espace.
  if d:sub(1, 1) == ',' then return 'retirer' end
  if d:sub(1, 1) == '.' and not d:sub(2, 2):match('%d') then return 'retirer' end

  -- E6 · un nombre groupé par tranches de trois ne se coupe pas : l'espace devient une
  -- fine insécable. L'allemand suisse groupe à l'apostrophe, qui ne se coupe pas. La
  -- règle ne groupe pas un nombre écrit d'un bloc (35000).
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
  -- moins : un « I » seul est plus souvent le pronom anglais.
  if g:match('^%u%a%a') and dn:match('^[IVXLCDM][IVXLCDM]+$') then return 'insecable' end

  return 'garder'
end

-- Règles de jetons sur une chaîne entière : MetaString (titre, sous-titre, résumés) et
-- texte des tableaux insérés. Un Str de pandoc ne contient pas d'espace ; entre deux Str,
-- c'est sort_de_l_espace() qui décide.
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
-- Les capitales s'accentuent : « À l'heure actuelle », « ÉTAT DES LIEUX ». print.css met
-- en capitales l'en-tête courant, la rubrique de couverture et le titre d'un encadré
-- (`text-transform: uppercase`) : un accent manquant n'y est plus visible.
--
-- Le lexique corrige les titres, sous-titres et intertitres. Dans le corps, il signale
-- seulement (C3) : « Education » est juste dans un titre anglais cité.
--
-- Chaque entrée ne corrige que la capitale initiale : « Elève » devient « Élève ».
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

-- Le « A » isolé qui est un « À ». La liste fermée des mots qui peuvent le suivre écarte
-- « A. Dupont » (initiale) et « A Study of… » (titre anglais).
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

-- Vrai si le jeton peut suivre un « À » : un mot de la liste, ou un mot élidé en « l’ »
-- (« l’école »).
local function suit_un_a(d)
  if d == '' then return false end
  if d:sub(1, 4) == 'l' .. APO then return true end
  return SUIVANTS_A[bas_de_casse(nu(d))] == true
end

-- En début de phrase seulement. Au milieu d'une phrase, « A » est une faute de casse pour
-- « à », ou un intitulé (« variante A la plus courte ») : le filtre n'y touche pas.
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

-- Correction du lexique, pour les titres seulement.
local function a4_capitales(t)
  if COLLEE then return t end
  for _, paire in ipairs(LEXIQUE_MAJ) do
    t = t:gsub('%f[%a]' .. paire[1], paire[2])
  end
  return t
end

-- Signalement C3 dans le corps, mot laissé tel quel. Appelé en fin de passe sur le
-- document entier (vider_constats), quand les titres sont déjà corrigés : seul ce qui
-- reste est signalé.
local function a4_signaler(t)
  if COLLEE then return end
  for _, paire in ipairs(LEXIQUE_MAJ) do
    local pos = t:find('%f[%a]' .. paire[1])
    if pos then
      signaler('majuscule-accentuee', mot_en(t, pos),
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
-- Français seulement, sur une liste fermée : « coefficient », « moelle » ou « goéland » ne
-- prennent pas de ligature. Chaque entrée est une suite de lettres propre à une famille de
-- mots (« oeuvre » : œuvre, œuvrer, chef-d'œuvre, désœuvré…), corrigée où qu'elle
-- apparaisse dans le mot.
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

-- Capitales des ligatures, écrites à la main : :upper() travaille sur des octets et ne
-- connaît ni œ ni æ.
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

-- Trois graphies : « oeuvre », « Oeuvre », « OEUVRE ».
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
-- Le point abréviatif absorbe le point final : ni « etc.. » ni « etc… ». S1 étant passé,
-- tout « .. » restant est un point doublé, et « etc... » est déjà devenu « etc… ».
-- Le motif ne peut pas se clore par %f[%W] (le point est lui-même dans %W) : le
-- troisième point est écarté par [^%.], avec une variante en fin de chaîne.
local function s4_point_abreviatif(t)
  t = t:gsub('(%a)%.%.([^%.])', '%1.%2')
  t = t:gsub('(%a)%.%.$', '%1.')
  t = t:gsub('(%f[%w]etc)%.?' .. ELL, '%1.')
  t = t:gsub('(%f[%w]usw)%.?' .. ELL, '%1.')
  return t
end

-- ─────────────────────────────────── T1 · l'insécable devant le tiret d'incise (français)
--
-- Le tiret d'incise ne commence pas une ligne : il reste avec le mot qu'il suit (même
-- règle que _incise_fr de test/typo-check.py). Aucune espace n'est ajoutée : « mot–mot »
-- n'est pas une incise.
local function t1_incise(t)
  if COLLEE then return t end
  return (t:gsub('([^ ' .. NBSP .. '])[ ]' .. DEMI .. '[ ]', '%1' .. NBSP .. DEMI .. ' '))
end

-- ────────────────────────────────────────── L2 · déterminant, préposition, conjonction
--
-- Dans un titre, un mot outil ne reste pas seul en fin de ligne : une insécable le lie au
-- mot qui le suit, et la coupure se fait devant lui.
--
-- Titres et sous-titres seulement : dans un paragraphe justifié, moins de points de
-- coupure donnerait des blancs plus larges.
--
-- Plafond de 30 signes par groupe insécable : le titre de couverture tient dans une boîte
-- d'environ 34 signes (`.szh-hero-main`, print.css) en `overflow: hidden`, qui tronquerait
-- sans bruit un groupe plus long.
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

-- Longueur en signes et non en octets.
local function longueur(t)
  return (utf8 and utf8.len(t)) or #t
end

-- L2 sur une chaîne entière (le titre de couverture est une MetaString).
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

-- Règles propres aux titres (A4 lexique, L2) : titre, sous-titre et intertitres.
local function normaliser_titre(t)
  return l2_texte(a4_capitales(t))
end

-- ------------------------------------------------ règles qui traversent une frontière
--
-- pandoc découpe « mot : suite » en Str/Space/Str : l'espace à corriger est un élément de
-- la liste d'inlines. Ces règles travaillent donc sur la liste.

-- Texte d'un inline, conteneurs compris (« **mot** : suite »). Le code et le HTML brut
-- rendent une sentinelle, qui bloque toute règle de part et d'autre.
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

-- Rend ce que devient l'espace entre `avant` et `apres` (voir verdict_jetons).
local function sort_de_l_espace(avant, apres)
  local ta = texte_de(avant)
  local ts = texte_de(apres)
  if ta:sub(-1) == '\0' or ts:sub(1, 1) == '\0' then return 'garder' end

  -- E1 · guillemets : l'ouvrant en fin de chaîne, le fermant en tête. Chevrons simples
  -- (3 octets) et doubles (2 octets).
  if ta:sub(-2) == GO or ta:sub(-3) == SO then return COLLEE and 'retirer' or 'insecable' end
  if ts:sub(1, 2) == GF or ts:sub(1, 3) == SF then return COLLEE and 'retirer' or 'insecable' end

  -- E2 · ponctuation haute. Le signe doit être seul ou en tête d'un groupe de signes :
  -- « ? », « ?! », mais pas le « : » de « ://ror.org ».
  local signes = ts:match('^([;:!?]+)')
  if signes and not ts:sub(#signes + 1, #signes + 1):match('[%w/]') then
    return COLLEE and 'retirer' or 'insecable'
  end

  -- T1 · le tiret d'incise ne commence pas une ligne (français). Le tiret doit être seul
  -- ou suivi d'un blanc.
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

  -- E5 à E8 · mêmes règles que sur une chaîne entière : le jeton de gauche est le dernier
  -- de l'inline précédent, celui de droite le premier du suivant.
  return verdict_jetons(jeton_gauche(ta), jeton_droite(ts))
end

-- E9 · dans un tableau, l'ordinal en tête de cellule ne se sépare pas de son mot
-- (« 1. Hilfe »). Seulement pour le premier texte d'une cellule <td>/<th> : dans un
-- paragraphe, « im Jahr 2021. Danach » ne doit pas se souder.
local function e9_ordinal_tete(t)
  return (t:gsub('^(%s*%d%d?%d?%.) (' .. LETTRE .. ')', '%1' .. NBSP .. '%2'))
end

-- Balises admises entre l'ouverture de la cellule et son premier texte (gras, italique,
-- lien, exposant, paragraphe).
local TRANSPARENTE_E9 = {
  strong = true, b = true, em = true, i = true, span = true, p = true,
  a = true, sup = true,
}

-- Nom de balise en bas de casse : « <TD class="x"> » donne « td », « </th> » « th ».
local function nom_balise(tag)
  local nom = tag:match('^<%s*/?%s*([%a][%w]*)')
  return nom and bas_de_casse(nom) or nil
end

local function fermante(tag) return tag:sub(1, 2) == '</' end

-- ------------------------------------------------------- les attributs imprimés d'un bloc
--
-- szh-numerotation.lua imprime, après ce filtre, la note, le copyright et la source d'une
-- figure ou d'un tableau. Ces attributs reçoivent donc ici les règles du texte. Les autres
-- (alt, src, classes, identifiants) ne sont pas touchés.
local ATTRIBUTS_IMPRIMES = { 'note', 'copyright', 'source' }

local ENTITES = { amp = '&', lt = '<', gt = '>', quot = '"', apos = "'" }

-- Une valeur d'attribut HTML est décodée avant les règles (sinon « &amp; » se lirait comme
-- un mot suivi d'un point-virgule), puis réécrite échappée.
local function decoder_entites(s)
  return (s:gsub('&(#?)(%w+);', function(diese, nom)
    if diese == '#' then
      local n = nom:match('^[xX]%x+$') and tonumber(nom:sub(2), 16) or tonumber(nom)
      if n and n > 0 and n <= 0x10FFFF then return utf8.char(n) end
      return nil
    end
    return ENTITES[nom]
  end))
end

local function echapper_texte_html(s)
  return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function echapper_attribut(s, delimiteur)
  s = s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')
  if delimiteur == '"' then return (s:gsub('"', '&quot;')) end
  return (s:gsub("'", '&#39;'))
end

-- data-note, data-copyright et data-source du <table …> inséré par szh-tabelle-inclure.
local function normaliser_attributs_table(balise)
  for _, nom in ipairs(ATTRIBUTS_IMPRIMES) do
    for _, q in ipairs({ '"', "'" }) do
      local motif = '(%sdata%-' .. nom .. '%s*=%s*' .. q .. ')([^' .. q .. ']*)(' .. q .. ')'
      balise = balise:gsub(motif, function(avant, v, apres)
        return avant .. echapper_attribut(normaliser_texte(decoder_entites(v)), q) .. apres
      end)
    end
  end
  return balise
end

-- note, copyright et source d'une image (bloc figure, grille ou image hors figure).
local function transformer_image(img)
  local change = false
  for _, nom in ipairs(ATTRIBUTS_IMPRIMES) do
    local v = img.attributes[nom]
    if v ~= nil and v ~= '' then
      local n = normaliser_texte(v)
      if n ~= v then
        img.attributes[nom] = n
        change = true
      end
    end
  end
  return change and img or nil
end

-- ----------------------------------------------------------------------- le HTML inséré
--
-- szh-tabelle-inclure pose les tableaux en RawBlock html, dont le texte n'est pas un Str.
-- On ne traite que le texte entre les balises, plus les trois attributs imprimés du
-- <table> (normaliser_attributs_table).
local function normaliser_html(html)
  local sortie = {}
  local i = 1
  local attente_e9 = false  -- une cellule vient de s'ouvrir, son premier mot est attendu
  while true do
    local d = html:find('<', i, true)
    local morceau = d and html:sub(i, d - 1) or html:sub(i)
    -- E9 : seul le premier morceau non blanc après l'ouverture de cellule est concerné.
    -- Un morceau de blancs (indentation, <td>\n<p>…</p></td>) ne compte pas.
    if attente_e9 and morceau:match('%S') then
      morceau = e9_ordinal_tete(morceau)
      attente_e9 = false
    end
    -- Texte décodé avant les règles, sinon E2 ferait de « &amp; » un « &amp ; ».
    sortie[#sortie + 1] = echapper_texte_html(normaliser_texte(decoder_entites(morceau)))
    if not d then break end
    -- Un commentaire HTML se ferme à « --> », pas au premier « > » : son texte n'est pas
    -- traité.
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
    local balise = html:sub(d, f)
    -- E9 : seuls <td> et <th> ouvrent l'attente (pas <caption>). Une balise de
    -- TRANSPARENTE_E9 la laisse ouverte ; toute autre la referme.
    local nom = nom_balise(balise)
    if nom == 'td' or nom == 'th' then
      attente_e9 = not fermante(balise)
    elseif attente_e9 and not TRANSPARENTE_E9[nom or ''] then
      attente_e9 = false
    end
    if nom == 'table' and not fermante(balise) then
      balise = normaliser_attributs_table(balise)
    end
    sortie[#sortie + 1] = balise
    i = f + 1
  end
  return table.concat(sortie)
end

-- ------------------------------------------------------------------------ les métadonnées
--
-- Le titre, le sous-titre et les résumés vont sur la couverture et dans les métadonnées du
-- PDF : ils reçoivent la typographie du corps. Seules les clés listées ici sont traitées :
-- un DOI, une URL ou un nom de fichier ne doivent pas l'être.
local META_TEXTE = {
  'pagetitle', 'description', 'licence-texte',     -- `resumes` : normaliser_resumes()
}
local META_AUTEUR = { 'fonction', 'affiliation' }

-- Clés de titre, qui reçoivent en plus A4 (lexique) et L2. `titre-affiche` et
-- `sous-titre-affiche`, posés par szh-maquette.lua avant ce filtre, sont ce que la
-- couverture imprime (gabarit szh-article.html).
local META_TITRE = { 'title', 'subtitle', 'titre-affiche', 'sous-titre-affiche' }

local function normaliser_valeur_meta(v, apres)
  if v == nil then return nil end
  local regles = function(t)
    t = normaliser_texte(t)
    if apres ~= nil then t = apres(t) end
    return t
  end
  -- Une MetaString arrive dans un filtre Lua en chaîne nue, sans champ `.t` : le type
  -- Lua se teste en premier.
  if type(v) == 'string' then return pandoc.MetaString(regles(v)) end
  if v.t == 'MetaString' then return pandoc.MetaString(regles(v.text)) end
  if v.walk then
    return v:walk({ Str = function(s) return pandoc.Str(regles(s.text)) end })
  end
  return v
end

-- ------------------------------------------------------------------------------ passes
--
-- Les passes sont listées en fin de fichier. La première fixe la langue d'après les
-- métadonnées, avant tout traitement du corps.

local function poser_langue(meta)
  LANGUE = commun.contexte(meta).lang
  COLLEE = (LANGUE ~= 'fr')
  SLUG = commun.slug_article()
  return nil
end

-- Exécute `f` avec LANGUE/COLLEE posés sur `court`, puis les rétablit.
local function avec_langue(court, f)
  local langue0, collee0 = LANGUE, COLLEE
  LANGUE, COLLEE = court, (court ~= 'fr')
  local ok, r = pcall(f)
  LANGUE, COLLEE = langue0, collee0
  if not ok then error(r, 0) end
  return r
end

-- Un résumé se compose dans sa propre langue (la Zeitschrift publie des résumés français,
-- la Revue des résumés allemands). Une langue autre que fr, de ou it garde celle de
-- l'article.
local function dans_la_langue(l, f)
  local court = tostring(l or ''):lower():sub(1, 2)
  if court ~= 'fr' and court ~= 'de' and court ~= 'it' then return f() end
  return avec_langue(court, f)
end

-- `resumes` (posé par szh-maquette.lua) est une liste de MetaMap dont `texte` arrive en
-- chaîne nue, hors de portée d'un walk sur des Str. Chaque texte est donc traité un par
-- un, dans la langue de son `lang`.
local function normaliser_resumes(liste)
  if type(liste) ~= 'table' then return liste end
  for _, r in ipairs(liste) do
    if type(r) == 'table' and r.texte ~= nil then
      local l = r.lang ~= nil and pandoc.utils.stringify(r.lang) or ''
      r.texte = dans_la_langue(l, function() return normaliser_valeur_meta(r.texte) end)
    end
  end
  return liste
end

local function transformer_meta(meta)
  for _, cle in ipairs(META_TEXTE) do
    if meta[cle] ~= nil then meta[cle] = normaliser_valeur_meta(meta[cle]) end
  end
  if meta.resumes ~= nil then meta.resumes = normaliser_resumes(meta.resumes) end
  -- `resume` (langue -> texte), tel que la fiche le porte : lu par la chaîne d'aperçu,
  -- qui ne charge pas szh-maquette.lua.
  if type(meta.resume) == 'table' and meta.resume.t == nil then
    for l, v in pairs(meta.resume) do
      meta.resume[l] = dans_la_langue(l, function() return normaliser_valeur_meta(v) end)
    end
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

-- T2 sur la liste : quand pandoc coupe « pp. 12-25 » en trois inlines, l'abréviation qui
-- rend la règle sûre se lit dans l'inline précédent.
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

-- A4 (« À » isolé) sur la liste : « A l'école » arrive en Str « A », Space, Str
-- « l’école ». En début de phrase seulement, comme sur une chaîne.
local function a4_sur_liste(inl)
  if COLLEE then return inl end
  local debut = true
  for i = 1, #inl do
    local el = inl[i]
    if el.t == 'Space' or el.t == 'SoftBreak' then
      -- l'espace ne change pas l'état : celui du jeton précédent reste
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

-- L2 sur la liste, pour les intertitres : le mot outil est le dernier jeton de l'inline
-- qui précède l'espace. Le plafond se compte sur le groupe insécable en cours.
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

-- Règles de titre pour les intertitres. pandoc filtre les inlines d'un bloc avant le
-- bloc : transformer_str et transformer_inlines sont déjà passés. Ce filtre s'exécute
-- avant szh-sections.lua, qui ajoute le numéro de section en tête du titre.
local function transformer_header(h)
  h.content = l2_sur_liste(h.content:walk({
    Str = function(s) return pandoc.Str(a4_capitales(s.text)) end,
  }))
  return h
end

-- A3 · les guillemets simples, appariés et rangés par niveau sur toute la liste d'inlines
-- d'un paragraphe.
--
-- Une citation de plusieurs mots a son ouvrant et son fermant dans deux Str différents (le
-- nettoyeur de manuscrit, pipeline/manuscrit_typo.py, produit même un Str par mot) : seule
-- la liste entière permet de les apparier.
--
-- Le résultat dépend du niveau de citation, pas du caractère d'origine : une paire de
-- premier niveau donne « » (A2), une paire imbriquée dans une citation ouverte donne ‹ ›
-- (A3).
--
-- Deux usages, distingués par un état posé au premier ouvrant :
--   * français : « ‘ » ouvre, « ’ » ferme, sauf entre deux lettres (élision posée par A1).
--     La rédaction emploie ‘ ’ pour un premier niveau comme pour une imbrication : le
--     niveau se mesure ;
--   * allemand : « ‚ » (U+201A) ouvre et « ‘ » ferme, le caractère qui ouvre en français.
--     ‚ ‘ est réservé au second niveau (le premier est „ “) : ‚ganz konkret‘ donne
--     toujours ‹ ›.
--
-- Le niveau d'une paire française se décide à l'ouverture, selon le nombre de chevrons
-- doubles « » ouverts à cet endroit. a2a3_chevrons a déjà converti chaque Str : un « " »
-- tapé et un « “ » converti sont tous deux devenus GO/GF.
--
-- La passe repère d'abord les paires complètes, puis n'écrit qu'elles : un ouvrant sans
-- fermant reste tel quel. Un inline opaque (Code, RawInline…) interrompt la recherche.
--
-- Les insécables sont posées en relançant e_espacement sur chaque Str modifié ; elle ne
-- double pas une insécable déjà présente.
local function a3_chevrons_sur_liste(inl)
  local flux = {}
  for i = 1, #inl do
    local el = inl[i]
    if el.t == 'Str' then
      for k, c in ipairs(caracteres(el.text)) do
        flux[#flux + 1] = { i = i, k = k, c = c }
      end
    elseif el.t == 'Space' or el.t == 'SoftBreak' then
      flux[#flux + 1] = { i = i, c = ' ' }
    else
      flux[#flux + 1] = { i = i, c = '\0' }        -- frontière opaque
    end
  end

  -- attente : 'fr' ou 'de' tant qu'un ouvrant cherche son fermant, sinon nil ; `debut` est
  -- sa position dans `flux`. `profondeur` compte les chevrons doubles « » ouverts ;
  -- `profondeur_ouverture` garde sa valeur à l'ouverture d'une paire française, qui seule
  -- décide de son niveau.
  local attente, debut, profondeur_ouverture = nil, nil, 0
  local profondeur = 0
  local paires = {}

  for n = 1, #flux do
    local c = flux[n].c
    if c == GO then
      profondeur = profondeur + 1
    elseif c == GF then
      if profondeur > 0 then profondeur = profondeur - 1 end
    end
    if c == '\0' then
      attente, debut = nil, nil
    elseif c == SIMPLE_OUVRANT_DE then           -- ‚ : ouvre l'usage allemand, second
                                                  -- niveau
      if attente == nil then attente, debut = 'de', n end
    elseif c == SIMPLE_OUVRANT_FR then           -- ‘ : ferme l'allemand en attente, sinon ouvre le français
      if attente == 'de' then
        paires[#paires + 1] = { ouvrant = debut, fermant = n, niveau = 'de' }
        attente, debut = nil, nil
      elseif attente == nil then
        attente, debut, profondeur_ouverture = 'fr', n, profondeur
      end
    elseif c == APO and attente == 'fr' then     -- ’ : ferme le français, sauf élision
      local avant = flux[n - 1] and flux[n - 1].c
      local apres = flux[n + 1] and flux[n + 1].c
      local elision = est_lettre(avant) and est_lettre(apres)
      if est_lettre(avant) and not elision then
        paires[#paires + 1] = {
          ouvrant = debut, fermant = n,
          niveau = (profondeur_ouverture > 0) and 'imbriquee' or 'premier',
        }
        attente, debut = nil, nil
      end
    end
  end
  -- `attente` encore posé ici : ouvrant sans fermant, laissé tel quel.

  if #paires == 0 then return inl end

  local ecrire = {}
  for _, p in ipairs(paires) do
    local fo, ff = flux[p.ouvrant], flux[p.fermant]
    -- Premier niveau français : chevrons doubles (A2). Usage allemand et imbrication
    -- française : chevrons simples (A3).
    local co, cf = SO, SF
    if p.niveau == 'premier' then co, cf = GO, GF end
    ecrire[fo.i] = ecrire[fo.i] or {}
    ecrire[fo.i][fo.k] = co
    ecrire[ff.i] = ecrire[ff.i] or {}
    ecrire[ff.i][ff.k] = cf
  end
  for i, par_k in pairs(ecrire) do
    local cs = caracteres(inl[i].text)
    for k, nouveau in pairs(par_k) do cs[k] = nouveau end
    inl[i] = pandoc.Str(e_espacement(table.concat(cs)))
  end

  return inl
end

local function transformer_inlines(inl)
  inl = t2_sur_liste(inl)
  inl = a4_sur_liste(inl)
  inl = a3_chevrons_sur_liste(inl)
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
      -- « retirer » : rien n'est inséré, les deux voisins se collent.
    else
      sortie:insert(el)
    end
  end
  return sortie
end

-- A2/A3 · guillemets déjà appariés par pandoc : le lecteur markdown « smart » rend
-- « "…" » en Quoted. Les chevrons et leur espacement sont posés ici.
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

-- ─────────────────────────────────────────────── passages dans une autre langue
--
-- Un Div ou un Span qui porte `lang` se compose dans sa langue : une citation allemande
-- dans un article français (`::: {lang=de}`), un mot `[Nachteilsausgleich]{lang=de}`.
--   * fr, de, it : les règles de cette langue ;
--   * autre langue (en…) : aucune règle, pandoc y pose ses guillemets ;
--   * même langue que la région qui l'entoure : rien ne change.
-- Les passages s'imbriquent : chacun est traité dans sa langue, le plus intérieur
-- d'abord, puis mis de côté pendant le traitement de la région qui l'entoure.
--
-- Mis de côté, un Span garde le texte de son contenu comme témoin : la région voisine
-- décide de l'espace qui le borde en regardant ce texte (« [Wort]{lang=de} : suite »
-- garde son insécable française). Le témoin est retiré au retour.
local ATTR_REGION = 'data-szh-typo-region'
local LANGUES_REGLES = { fr = true, de = true, it = true }

local FILTRE = {
  Str = transformer_str,
  Quoted = transformer_quoted,
  Inlines = transformer_inlines,
  Header = transformer_header,
  RawBlock = transformer_rawblock,
  Image = transformer_image,
}

-- Langue d'un passage qui change de langue, réduite à deux lettres ; nil sinon.
local function langue_de_passage(el)
  local l = el.attributes and el.attributes.lang
  if l == nil or l == '' then return nil end
  local court = tostring(l):lower():sub(1, 2)
  if court == LANGUE then return nil end
  return court
end

-- `elements` : les Blocks d'un document ou d'un Div, les Inlines d'un Span. Rend la liste
-- transformée dans la langue courante (LANGUE), passages imbriqués compris.
local function traiter_region(elements)
  local reserve = {}
  local function mettre_de_cote(el)
    local court = langue_de_passage(el)
    if not court then return nil end
    local contenu = avec_langue(court, function() return traiter_region(el.content) end)
    reserve[#reserve + 1] = contenu
    el.attributes[ATTR_REGION] = tostring(#reserve)
    if el.t == 'Span' then
      el.content = pandoc.Inlines({ pandoc.Str(pandoc.utils.stringify(contenu)) })
    else
      el.content = pandoc.Blocks({})
    end
    return el, false
  end
  local function remettre(el)
    local n = tonumber(el.attributes[ATTR_REGION] or '')
    if not n then return nil end
    el.content = reserve[n]
    el.attributes[ATTR_REGION] = nil
    return el, false
  end
  elements = elements:walk({ traverse = 'topdown', Div = mettre_de_cote, Span = mettre_de_cote })
  if LANGUES_REGLES[LANGUE] then elements = elements:walk(FILTRE) end
  if #reserve == 0 then return elements end
  return elements:walk({ traverse = 'topdown', Div = remettre, Span = remettre })
end

local function transformer_document(doc)
  doc.blocks = traiter_region(doc.blocks)
  return doc
end

-- Les signalements partent en fin de passe, une ligne par code. C3 se cherche ici, sur le
-- document transformé où les titres sont déjà corrigés. Un passage dans une autre langue
-- est jugé dans la sienne.
local function signaler_region(elements)
  local function passage(el)
    local court = langue_de_passage(el)
    if not court then return nil end
    avec_langue(court, function() signaler_region(el.content) end)
    return el, false
  end
  elements:walk({
    traverse = 'topdown',
    Str = function(s) a4_signaler(s.text) end,
    Div = passage,
    Span = passage,
  })
end

local function vider_constats(doc)
  signaler_region(doc.blocks)
  for _, ligne in ipairs(constats) do io.stderr:write(ligne .. '\n') end
  return nil
end

-- Quatre passes, dans cet ordre : la langue de l'article ; le corps, région par région ; les
-- métadonnées (titres, résumés, auteurs) ; les constats, sur le document transformé.
return {
  { Meta = poser_langue },
  { Pandoc = transformer_document },
  { Meta = transformer_meta },
  { Pandoc = vider_constats },
}
