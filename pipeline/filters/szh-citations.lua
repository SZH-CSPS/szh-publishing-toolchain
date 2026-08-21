-- Compilation : ancre chaque référence de la liste finale et transforme les appels du
-- corps en liens internes. La liste de références n'est ni déplacée ni réécrite — c'est
-- tout l'intérêt : le texte publié reste celui de la rédaction, seul un identifiant et des
-- liens s'y ajoutent.
--
-- Trois temps :
--   1. la liste : dernier titre de bibliographie, puis les paragraphes qui le suivent.
--      Chaque entrée reçoit un Div « szh-reference » portant un id déduit de son contenu
--      (ref-nom-annee), donc stable d'une compilation à l'autre.
--   2. les appels : « (Bovey, 2022) », « (vgl. Kunz, 2016) », « Capurso et al. (2025) »,
--      « (Grimminger et al., 2021; Fisseler, 2023) », « (Pelgrims, 2001, 2006) »… Seule la
--      parenthèse devient le lien ; la prose autour n'est pas touchée. Un appel narratif
--      met donc le lien sur l'année, comme le font les revues en ligne.
--   3. le rapport : chaque appel sans référence et chaque référence jamais appelée part sur
--      stderr, où le journal de compilation le montre au rédacteur. Avec SZH_APERCU=1, les
--      appels non liés reçoivent en plus la classe « szh-appel-orphelin », que print.css
--      souligne en pointillé dans l'aperçu seulement.
--
-- Un lien écrit à la main dans le .md (« [(Shaw et al., 2023)](#ref-shaw-2023) », ce que
-- pose l'action « Lier à une référence » du cockpit) est respecté tel quel ; s'il pointe
-- vers un ancrage inexistant, un avertissement le dit.
--
-- Doit tourner en fin de chaîne : les autres filtres ont fini de bouger les blocs.

local utils = pandoc.utils

-- ---------------------------------------------------------------- texte et comparaison
local function assainir(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return t
end

local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function normaliser(t) return trim(assainir(t):gsub('%s+', ' ')) end

-- Repli d'accents, octet par octet : les motifs Lua ignorent l'UTF-8, et « É » ou « ü »
-- doivent se comparer à « e » et « u ». Table volontairement courte : les lettres
-- latines des deux revues.
local REPLI = {
  ['\195\128']='a',['\195\129']='a',['\195\130']='a',['\195\131']='a',['\195\132']='a',['\195\133']='a',
  ['\195\134']='ae',['\195\135']='c',['\195\136']='e',['\195\137']='e',['\195\138']='e',['\195\139']='e',
  ['\195\140']='i',['\195\141']='i',['\195\142']='i',['\195\143']='i',['\195\145']='n',
  ['\195\146']='o',['\195\147']='o',['\195\148']='o',['\195\149']='o',['\195\150']='o',['\195\152']='o',
  ['\195\153']='u',['\195\154']='u',['\195\155']='u',['\195\156']='u',['\195\157']='y',
  ['\195\160']='a',['\195\161']='a',['\195\162']='a',['\195\163']='a',['\195\164']='a',['\195\165']='a',
  ['\195\166']='ae',['\195\167']='c',['\195\168']='e',['\195\169']='e',['\195\170']='e',['\195\171']='e',
  ['\195\172']='i',['\195\173']='i',['\195\174']='i',['\195\175']='i',['\195\177']='n',
  ['\195\178']='o',['\195\179']='o',['\195\180']='o',['\195\181']='o',['\195\182']='o',['\195\184']='o',
  ['\195\185']='u',['\195\186']='u',['\195\187']='u',['\195\188']='u',['\195\189']='y',['\195\191']='y',
  ['\197\147']='oe',['\197\146']='oe',['\197\189']='z',['\197\190']='z',['\195\159']='ss',
}

local function plat(t)
  t = assainir(t or ''):gsub('[\194-\244][\128-\191]*', function(c) return REPLI[c] or c end)
  return (t:lower():gsub('[^a-z0-9]', ''))
end

-- Majuscule initiale, accents compris : le premier octet d'une lettre accentuée est
-- 0xC3 ou 0xC5, donc %u n'y suffit pas.
local function commence_par_majuscule(mot)
  if mot == '' then return false end
  local c = mot:byte(1)
  if c >= 65 and c <= 90 then return true end
  if c == 195 then
    local d = mot:byte(2) or 0
    return d >= 128 and d <= 158            -- À..Þ
  end
  -- Latin étendu (Œ, Ž, Š, Ł…) : on accepte la tête d'octet sans distinguer la casse.
  -- Sur-accepter ici ne coûte qu'un mot de trop dans une chaîne de noms, que les listes
  -- d'ouvreurs et de particules écartent ensuite.
  return c == 196 or c == 197
end

-- ------------------------------------------------------------------- lexiques
local TITRES_BIB = {
  'literatur', 'literaturverzeichnis', 'literaturangaben', 'literaturhinweise',
  'bibliografie', 'bibliografia', 'bibliographie', 'bibliography',
  'reference', 'references', 'referenzen', 'quellen', 'quellenverzeichnis',
  'ouvragescites', 'zitierteliteratur', 'verwendeteliteratur', 'weiterfuhrendeliteratur',
}

-- Mots d'amorce devant un appel : « (vgl. Kunz, 2016) », « (z. B. Kunz, 2016) ».
local AMORCES = { 'vgl', 'siehe', 'zb', 'ua', 'cf', 'voir', 'voiraussi', 'selon', 'nach',
                  'dapres', 'etwa', 'insb', 'bes', 'parex', 'eg', 'zitn' }

-- Mots capitalisés qui ouvrent une phrase et ne sont jamais un nom d'auteur.
local OUVREURS = {}
for m in ([[selon voir cf comme ainsi apres avec dans chez depuis enfin mais sans sous sur
toutefois cependant or et ou le la les un une ce cette cet il elle ils elles on nous vous je
tu pour par donc car puis ensuite ici deja aussi meme tel telle bien plus moins nach laut wie
bei fur aus der die das den dem des ein eine einer einem einen und oder aber doch also dann
damit dabei dazu hier dort jedoch zudem ferner weiter schliesslich im in an auf um es er sie
wir ich man diese dieser dieses diesem zum zur beim vgl siehe zwar etwa nur auch als seit
wenn weil dass obwohl wahrend zwischen nachdem bereits allerdings so dies daher deshalb
somit ebenso studie studien modell kapitel abschnitt tabelle abbildung figure tableau
article chapitre etude etudes]]):gmatch('%S+') do OUVREURS[m] = true end

local PARTICULES = {}
for m in ('van von de des du della di da dos der den ter te le la zu zur af av el'):gmatch('%S+') do
  PARTICULES[m] = true
end

local function est_titre_bib(txt)
  local p = plat(txt)
  for _, t in ipairs(TITRES_BIB) do
    if p == t or p:sub(1, #t) == t then return true end
  end
  return false
end

-- ------------------------------------------------------- lecture d'une entrée de la liste
-- L'en-tête d'une référence APA va du début jusqu'à l'année entre parenthèses. On en tire
-- les noms de famille, les sigles (la forme sous laquelle un auteur institutionnel est
-- appelé : « [UNESCO] », « (Behindertenrechtskonvention, BRK) ») et l'en-tête entière,
-- dernier recours pour les raisons sociales écrites en clair.
local function annee_de_reference(txt)
  local s, e, an, suf = txt:find('%((%d%d%d%d)(%a?)[^)]-%)')
  if s then return an, suf, s end
  local s2 = txt:find('%(') and txt:find('%((s%.?%s?d%.?)%)')
  for _, motif in ipairs({ '%(s%.%s?d%.?%)', '%(o%.%s?J%.?%)', '%(n%.d%.?%)',
                           '%(ohne Jahr%)', '%(sans date%)' }) do
    local a, b = txt:find(motif)
    if a then return '', '', a end
  end
  return nil, '', nil
end

local function sigles_de(entete)
  local out = {}
  for frag in entete:gmatch('%[([^%]]+)%]') do
    for mot in frag:gmatch('[%w\194-\244][%w%.&%-\128-\191]*') do
      local maj = 0
      for c in mot:gmatch('%u') do maj = maj + 1 end
      if maj >= 2 then out[plat(mot)] = true end
    end
  end
  for frag in entete:gmatch('%(([^%)]+)%)') do
    for mot in frag:gmatch('[%w\194-\244][%w%.&%-\128-\191]*') do
      local maj = 0
      for c in mot:gmatch('%u') do maj = maj + 1 end
      if maj >= 2 then out[plat(mot)] = true end
    end
  end
  local tete = entete:match('^%s*([%u][%u%d&%.%-]+)')
  if tete then out[plat(tete)] = true end
  return out
end

local function noms_de(entete)
  -- ⚠ Replier les accents AVANT de découper. Les motifs Lua comptent les octets : sur le
  -- texte d'origine, « Weiß » se coupait en « Wei » puis « ß », et « Schröttle » en
  -- « Schr » puis « öttle » — le nom relevé ne correspondait alors plus à celui de l'appel,
  -- et la référence passait pour introuvable.
  local f = assainir(entete or ''):gsub('[\194-\244][\128-\191]*',
                                        function(c) return REPLI[c] or c end)
  local noms = {}
  -- « Nom, X. », « Nom & Autre » : le nom est ce qui précède la virgule ou l'esperluette.
  -- Pas de test de majuscule ici : le repli des accents rend « Ö » en « o », et une raison
  -- sociale en bas de casse (« vahs, CURAVIVA & INSOS ») est un nom comme un autre.
  for mot in f:gmatch('([%a][%w\'%-]*)%s*[,&]') do
    if #mot >= 2 then noms[#noms + 1] = mot end
  end
  if #noms == 0 then
    for mot in f:gmatch('([%a][%w\'%-]+)') do
      if #mot >= 2 and #noms < 3 then noms[#noms + 1] = mot end
    end
  end
  local plats = {}
  for _, n in ipairs(noms) do
    local p = n:lower():gsub('[^a-z0-9]', '')
    if p ~= '' then plats[#plats + 1] = p end
  end
  return plats
end

-- Nom qui nomme l'identifiant. Volontairement bête : on replie les accents et les
-- ligatures, puis on prend le premier mot de deux lettres au moins. Aucune détection de
-- majuscule n'entre ici, ce qui permet à lib/citations.js du cockpit de calculer le même
-- identifiant en JavaScript — sans quoi le lien posé à la main pointerait dans le vide.
local function nom_pour_id(entete)
  local f = assainir(entete or ''):gsub('[\194-\244][\128-\191]*',
                                        function(c) return REPLI[c] or c end)
  for jeton in f:lower():gmatch('[a-z0-9]+') do
    if #jeton >= 2 then return jeton end
  end
  return 'ref'
end

local function fiche_de_reference(txt)
  local an, suf, pos = annee_de_reference(txt)
  local entete = pos and txt:sub(1, pos - 1) or txt:sub(1, 120)
  return {
    texte = txt,
    nom_id = nom_pour_id(entete),
    annee = an,                       -- '' pour une référence sans date, nil si introuvable
    suffixe = suf,
    noms = noms_de(entete),
    sigles = sigles_de(entete),
    entete = plat(entete),
    -- « Nom, X. » : des personnes. Sans ce motif, l'en-tête est une raison sociale, et
    -- c'est le seul cas où l'on cherche le nom appelé n'importe où dans l'en-tête.
    institutionnel = entete:find('[%u][%w\128-\191\'%-]+,%s*%u%.') == nil,
  }
end

-- Une entrée commence-t-elle ici, ou est-ce la suite de la précédente ?
--
-- C'est la question que l'ancien `debut_entree` de szh-biblio.lua traitait par « le
-- paragraphe commence-t-il par une majuscule ? », test qui rejetait « Übereinkommen »,
-- « École », « van der Aa » et l'astérisque des revues systématiques, et recollait donc
-- 100 références du corpus à la précédente. La règle retenue ici ne demande plus de
-- reconnaître une majuscule dans un encodage multi-octets : une suite est une ligne d'URL
-- seule, ou une ligne qui commence par une minuscule ASCII sans porter d'année. Tout le
-- reste — accentuée, astérisque, chiffre, guillemet, ou minuscule suivie d'une année comme
-- « insieme Schweiz (2024) » — ouvre une entrée.
local function est_continuation(txt)
  if txt:sub(1, 4):lower() == 'http' or txt:sub(1, 3):lower() == 'www' then return true end
  local c = txt:byte(1) or 0
  if not (c >= 97 and c <= 122) then return false end
  return txt:sub(1, 130):find('%f[%d](%d%d%d%d)%f[%D]') == nil
end

-- ------------------------------------------------------------------ détection des appels
local function est_annee(jeton)
  local an, suf = jeton:match('^(%d%d%d%d)(%a?)$')
  if an then return an, suf end
  local p = plat(jeton)
  if p == 'sd' or p == 'oj' or p == 'nd' then return '', '' end
  return nil
end

-- Toutes les années d'un fragment, dans l'ordre, avec leur position : c'est elle qui
-- permet de lier chaque année d'un appel multiple — « (Sen, 2001, 2009) » désigne deux
-- références et doit donner deux liens.
local function annees_du_fragment(frag)
  local out = {}
  local pos = 1
  while pos <= #frag do
    local s, e, jeton = frag:find('([%w%.]+)', pos)
    if not s then break end
    pos = e + 1
    local an, suf = est_annee(jeton)
    if an then out[#out + 1] = { annee = an, suffixe = suf, s = s, e = e } end
  end
  if #out == 0 then
    local depuis = 1
    while true do
      local s, e, a, b = frag:find('%f[%w](%d%d%d%d)(%a?)%f[%W]', depuis)
      if not s then break end
      depuis = e + 1
      out[#out + 1] = { annee = a, suffixe = b, s = s, e = e }
    end
  end
  return out
end

-- Le fragment ne contient-il que des années, une amorce et un locateur ? C'est la marque
-- d'un appel narratif : « Capurso et al. (2025, p. 3) ».
local function fragment_annees_seules(frag)
  local reste = frag
  reste = reste:gsub('%f[%w](%d%d%d%d)%a?%f[%W]', ' ')
  reste = reste:gsub('[sS]%.%s?[dD]%.?', ' '):gsub('[oO]%.%s?[jJ]%.?', ' ')
  reste = reste:gsub('[pP]?[pPsS]%.%s*[%divxlc%-%s,%.]*', ' ')
  reste = reste:gsub('[Kk]ap%.', ' '):gsub('[Cc]hap%.', ' ')
  reste = reste:gsub('[%s,;/&%.]', ''):gsub('et', ''):gsub('und', ''):gsub('sowie', '')
  for _, a in ipairs(AMORCES) do reste = reste:gsub(a, '') end
  return plat(reste) == ''
end

-- Découpe la partie « noms » d'un appel : « Ebersold, S., & Detraux » -> {Ebersold, Detraux}
local function noms_de_lappel(bloc)
  -- amorces en tête
  local t = trim(bloc)
  for _, a in ipairs(AMORCES) do
    local n = #a
    local tete = plat(t:sub(1, n + 2))
    if tete:sub(1, n) == a then t = trim(t:sub((t:find('%.') or n) + 1)) end
  end
  -- « et al. » d'abord, sinon la conjonction seule serait retirée et laisserait « al. » ;
  -- puis les conjonctions deviennent des séparateurs, pour que « Ebersold et Detraux »
  -- donne bien deux noms.
  t = t:gsub('%f[%w]et%s+al%.?', ','):gsub('%f[%w]u%.%s?a%.', ',')
       :gsub('%f[%w]et%s+coll%.?', ',')
  -- « et » oublié à la saisie : « Egert al., 2017 » vaut « Egert et al., 2017 ».
  t = t:gsub('%f[%w]al%.', ',')
  t = t:gsub('%f[%w]et%f[%W]', ','):gsub('%f[%w]und%f[%W]', ',')
       :gsub('%f[%w]and%f[%W]', ',')
  local noms = {}
  for morceau in (t .. ','):gmatch('([^,&/]+)[,&/]') do
    local m = trim(morceau)
    if m ~= '' and not m:match('^%u%.') then
      -- rogner par la gauche les mots de discours et tout mot en bas de casse : un nom
      -- d'auteur commence par une majuscule, une raison sociale aussi.
      local mots = {}
      for mot in m:gmatch('%S+') do mots[#mots + 1] = mot end
      while #mots > 0 and (OUVREURS[plat(mots[1])] or
            (not commence_par_majuscule(mots[1]) and not PARTICULES[plat(mots[1])])) do
        table.remove(mots, 1)
      end
      while #mots > 0 and OUVREURS[plat(mots[#mots])] do table.remove(mots) end
      if #mots > 0 and #mots <= 8 then
        local nom = table.concat(mots, ' ')
        if not nom:find('%d') then noms[#noms + 1] = nom end
      end
    end
  end
  return noms
end

-- ------------------------------------------------------------------------- appariement
local function variantes(nom)
  local mots, out = {}, {}
  for mot in nom:gmatch('%S+') do mots[#mots + 1] = mot end
  for k = 1, #mots do
    local p = plat(table.concat(mots, ' ', k))
    if #p >= 2 then out[#out + 1] = p end
  end
  return out
end

local function apparier(appel, fiches)
  local eligibles = {}
  for _, f in ipairs(fiches) do
    local ok
    if appel.annee == '' then ok = (f.annee == '')
    else
      ok = (f.annee == appel.annee)
      if ok and appel.suffixe ~= '' and f.suffixe ~= '' and appel.suffixe ~= f.suffixe then
        ok = false
      end
    end
    if ok then eligibles[#eligibles + 1] = f end
  end
  if #eligibles == 0 then return {} end

  local formes = variantes(appel.noms[1] or '')
  -- Passe stricte : le premier auteur de la référence, un de ses sigles, ou son en-tête
  -- entière pour une raison sociale. C'est la règle APA — un appel ne nomme que le premier.
  local stricts = {}
  for _, f in ipairs(eligibles) do
    for _, forme in ipairs(formes) do
      if forme == (f.noms[1] or '') or f.sigles[forme]
          or (f.institutionnel and #forme >= 8 and f.entete:find(forme, 1, true)) then
        stricts[#stricts + 1] = f
        break
      end
    end
  end
  local cands = stricts
  if #cands == 0 then
    -- Passe large : n'importe quel co-auteur, et tous les noms cités, pas seulement le
    -- premier. Rattrape les appels fautifs de la source sans fabriquer d'ambiguïté quand
    -- la référence exacte existe.
    local toutes = {}
    for _, nom in ipairs(appel.noms) do
      for _, v in ipairs(variantes(nom)) do toutes[#toutes + 1] = v end
    end
    for _, f in ipairs(eligibles) do
      local pris = false
      for _, forme in ipairs(toutes) do
        for _, n in ipairs(f.noms) do
          if n == forme or (#n > 3 and forme:find(n, 1, true)) then pris = true break end
        end
        if pris then break end
        if f.institutionnel and #forme >= 8 and f.entete:find(forme, 1, true) then
          pris = true
          break
        end
      end
      if pris then cands[#cands + 1] = f end
    end
  end
  -- Un appel qui nomme deux auteurs départage deux références de même premier auteur.
  if #cands > 1 and appel.noms[2] then
    local second = plat(appel.noms[2])
    local precis = {}
    for _, f in ipairs(cands) do
      local pris = false
      for _, n in ipairs(f.noms) do if n == second then pris = true break end end
      if not pris and #second > 3 and f.entete:find(second, 1, true) then pris = true end
      if pris then precis[#precis + 1] = f end
    end
    if #precis > 0 then cands = precis end
  end
  return cands
end

-- ------------------------------------------------- parenthèses d'une suite d'inlines
-- Texte plat d'une liste d'inlines, avec la carte des positions : pour chaque inline, son
-- décalage de départ. Les inlines qui ne sont ni Str ni Space donnent un octet sentinelle
-- \1, qu'aucun motif d'appel ne peut traverser : un appel à cheval sur de l'italique est
-- donc ignoré plutôt que mal découpé.
-- Assainissement à longueur d'octets constante. Il en faut un : pandoc, lecteur markdown
-- « smart » allumé, met une espace insécable après une abréviation, si bien que
-- « (1990, p. 202) » arrive avec un U+00A0 que les classes %s de Lua ne reconnaissent pas.
-- Remplacer par un nombre égal d'octets garde les décalages valides pour poser_lien.
local function assainir_iso(t)
  t = t:gsub('\194\160', '  ')                -- espace insécable -> 2 espaces
  t = t:gsub('\226\128\175', '   ')           -- espace fine insécable -> 3
  t = t:gsub('\226\128\137', '   ')           -- espace fine -> 3
  t = t:gsub('\226\128\147', '---')           -- tiret demi-cadratin -> 3 tirets
  t = t:gsub('\226\128\148', '---')           -- cadratin
  t = t:gsub('\226\128\145', '---')           -- trait d'union insécable
  return t
end

local function aplatir(inlines)
  local morceaux, depart = {}, {}
  local n = 0
  for i, il in ipairs(inlines) do
    depart[i] = n + 1
    local t
    if il.t == 'Str' then t = assainir_iso(il.text)
    elseif il.t == 'Space' or il.t == 'SoftBreak' then t = ' '
    else t = '\1' end
    morceaux[#morceaux + 1] = t
    n = n + #t
  end
  return table.concat(morceaux), depart
end

-- Remplace la plage [s,e] du texte plat par l'inline que rend `fabriquer`, en decoupant
-- les Str aux bornes. Les inlines qui ne sont ni Str ni Space donnent \1 dans le texte
-- plat, qu'aucun motif d'appel ne traverse : un appel a cheval sur de l'italique est donc
-- ignore plutot que mal decoupe.
local function poser(inlines, depart, s, e, fabriquer)
  local sortie = pandoc.List()
  local contenu = pandoc.List()
  local function vider()
    if #contenu > 0 then
      sortie:insert(fabriquer(contenu))
      contenu = pandoc.List()
    end
  end
  for i, il in ipairs(inlines) do
    local d = depart[i]
    local f = d + (il.t == 'Str' and #il.text or 1) - 1
    if f < s or d > e then
      vider()
      sortie:insert(il)
    elseif il.t == 'Str' then
      local avant = il.text:sub(1, math.max(0, s - d))
      local dedans = il.text:sub(math.max(1, s - d + 1), math.min(#il.text, e - d + 1))
      local apres = il.text:sub(math.min(#il.text, e - d + 1) + 1)
      if avant ~= '' then sortie:insert(pandoc.Str(avant)) end
      if dedans ~= '' then contenu:insert(pandoc.Str(dedans)) end
      if apres ~= '' then
        vider()
        sortie:insert(pandoc.Str(apres))
      end
    else
      contenu:insert(il)                              -- Space a l'interieur de l'appel
    end
    if f >= e then vider() end
  end
  vider()
  return sortie
end

local function lien(cible)
  return function(contenu)
    return pandoc.Link(contenu, cible, '', pandoc.Attr('', { 'szh-appel' }))
  end
end

local function marque(classe)
  return function(contenu) return pandoc.Span(contenu, pandoc.Attr('', { classe })) end
end

-- ------------------------------------------------------------------------ le filtre
local APERCU = (os.getenv('SZH_APERCU') or '') ~= ''

function Pandoc(doc)
  -- 1. la liste de références
  local blocs = doc.blocks
  local idx_titre = nil
  for i, b in ipairs(blocs) do
    if b.t == 'Header' and est_titre_bib(normaliser(utils.stringify(b))) then idx_titre = i end
  end
  local premiere = idx_titre and (idx_titre + 1) or nil
  if not premiere then
    -- Pas de titre reconnu : on cherche depuis la fin une suite de paragraphes qui se
    -- lisent tous comme des références. Le pari est sans risque ici — un faux positif ne
    -- pose qu'un ancrage inutile, il ne déplace rien.
    local fin, debut = nil, nil
    for i = #blocs, math.max(1, math.floor(#blocs * 0.5)), -1 do
      local b = blocs[i]
      if b.t == 'Para' then
        local txt = normaliser(utils.stringify(b))
        local a = annee_de_reference(txt)
        if a and #txt > 40 then
          fin = fin or i
          debut = i
        elseif fin and not est_continuation(txt) then
          break
        end
      elseif fin then
        break
      end
    end
    if fin and debut and (fin - debut) >= 2 then premiere = debut end
  end

  local fiches, ancrages = {}, {}
  local derniere = nil
  if premiere then
    local i = premiere
    while i <= #blocs do
      local b = blocs[i]
      if b.t == 'Header' then break end
      if b.t == 'Para' or b.t == 'Plain' then
        local txt = normaliser(utils.stringify(b))
        if txt ~= '' then
          if #fiches > 0 and est_continuation(txt) then
            fiches[#fiches].suite[#fiches[#fiches].suite + 1] = i
          else
            local f = fiche_de_reference(txt)
            f.suite, f.bloc = {}, i
            fiches[#fiches + 1] = f
          end
          derniere = i
        end
      end
      i = i + 1
    end
  end

  -- Identifiants : ref-nom-annee, désambiguïsés par une lettre dans l'ordre de la liste.
  local vus = {}
  for _, f in ipairs(fiches) do
    local base = 'ref-' .. f.nom_id:sub(1, 24) .. '-'
                 .. ((f.annee ~= nil and f.annee ~= '') and f.annee or 'sd')
    local id = base
    if vus[base] then
      vus[base] = vus[base] + 1
      id = base .. '-' .. string.char(96 + vus[base])
    else
      vus[base] = 1
    end
    f.id = id
    ancrages[id] = f
  end

  -- 2. les appels, dans tout ce qui précède la liste
  local limite = premiere and (premiere - 1) or #blocs
  local appels, orphelins, ambigus = 0, {}, {}
  local appelees = {}

  -- Toutes les plages a lier sont relevees d'abord, puis posees de droite a gauche : les
  -- decalages a gauche d'une pose restent valides, ce qui evite de rescanner et permet de
  -- traiter plusieurs appels dans une meme parenthese.
  local function relever(txt, s, e, dedans)
    local plages = {}
    local frags, decalage = {}, 0
    for frag in (dedans .. ';'):gmatch('([^;]*);') do
      frags[#frags + 1] = { texte = frag, debut = s + 1 + decalage }
      decalage = decalage + #frag + 1
    end
    local noms_precedents = nil
    for rang, fr in ipairs(frags) do
      local ans = annees_du_fragment(fr.texte)
      if #ans > 0 then
        local noms
        if rang > 1 and noms_precedents and fragment_annees_seules(fr.texte) then
          -- « (Weiß, 2016 ; 2023) », « (Schröttle et al., 2024a ; 2024b) » : le second
          -- fragment ne porte qu'une année, l'auteur est celui du fragment précédent.
          noms = noms_precedents
        elseif fragment_annees_seules(fr.texte) then
          -- appel narratif : les noms sont dans la prose qui precede la parenthese
          local queue = txt:sub(1, s - 1):match('([^%.;:!%?%(%)\1]*)$') or ''
          noms = noms_de_lappel(queue)
        else
          local coupe = fr.texte:find('%f[%w]%d%d%d%d%f[%W]') or (#fr.texte + 1)
          noms = noms_de_lappel(fr.texte:sub(1, coupe - 1))
          if #noms == 0 then
            -- « (… prose …, Ryan & Deci, 1989) » : on retente sur la fin seulement
            local queue = fr.texte:sub(1, coupe - 1):match('([^,;:%(%)]*[,;]?%s*)$') or ''
            noms = noms_de_lappel(queue)
          end
        end
        if #noms > 0 then
          noms_precedents = noms
          for _, a in ipairs(ans) do
            appels = appels + 1
            local cands = apparier({ noms = noms, annee = a.annee, suffixe = a.suffixe },
                                   fiches)
            local libelle = normaliser(txt:sub(s, e))
            local ds, de
            if #frags == 1 and #ans == 1 then
              ds, de = s, e                                   -- toute la parenthese
            elseif #ans == 1 then
              ds, de = fr.debut, fr.debut + #fr.texte - 1      -- le fragment
            else
              ds, de = fr.debut + a.s - 1, fr.debut + a.e - 1  -- l'annee seule
            end
            if #cands == 1 then
              appelees[cands[1].id] = true
              plages[#plages + 1] = { s = ds, e = de, faire = lien('#' .. cands[1].id) }
            elseif #cands > 1 then
              for _, c in ipairs(cands) do appelees[c.id] = true end
              ambigus[#ambigus + 1] = libelle
              if APERCU then
                plages[#plages + 1] = { s = ds, e = de, faire = marque('szh-appel-ambigu') }
              end
            else
              orphelins[#orphelins + 1] = libelle
              if APERCU then
                plages[#plages + 1] = { s = ds, e = de,
                                        faire = marque('szh-appel-orphelin') }
              end
            end
          end
        end
      end
    end
    return plages
  end

  local function traiter_inlines(inlines)
    if #fiches == 0 then return inlines end
    local txt, depart = aplatir(inlines)
    local plages = {}
    -- Parenthèses et crochets : les deux servent d'appel dans le corpus — « nach Salter &
    -- Croce [2022] », « [Pettrich et al., 2025] ». Les crochets du markdown (lien, span,
    -- appel de note) sont des inlines opaques dans le texte plat, hors d'atteinte de ce
    -- balayage : seuls les crochets écrits au clavier arrivent ici.
    for _, motif in ipairs({ '%(([^%(%)\1]*)%)', '%[([^%[%]\1]*)%]' }) do
      local depuis = 1
      while true do
        local s, e, dedans = txt:find(motif, depuis)
        if not s then break end
        depuis = e + 1
        if #dedans >= 3 and #dedans <= 260 then
          for _, p in ipairs(relever(txt, s, e, dedans)) do plages[#plages + 1] = p end
        end
      end
    end
    if #plages == 0 then return inlines end
    table.sort(plages, function(a, b) return a.s > b.s end)
    local courant = inlines
    local borne = nil
    for _, p in ipairs(plages) do
      if not borne or p.e < borne then
        local _, dep = aplatir(courant)
        courant = poser(courant, dep, p.s, p.e, p.faire)
        borne = p.s
      end
    end
    return courant
  end

  -- Les liens déjà présents (posés à la main) sont respectés et comptés.
  local function marquer_liens_manuels(inlines)
    for _, il in ipairs(inlines) do
      if il.t == 'Link' and il.target:sub(1, 5) == '#ref-' then
        local id = il.target:sub(2)
        if ancrages[id] then
          appelees[id] = true
        else
          io.stderr:write(string.format(
            '[citations] ⚠ lien manuel vers un ancrage inconnu : %s\n', il.target))
        end
      end
    end
  end

  -- On descend a la main plutot qu'avec pandoc.walk_block : le filtre Inlines de walk_block
  -- visite aussi le contenu des liens, ce qui imbriquerait un lien dans un lien deja pose
  -- a la main. Ici, seule la liste d'inlines de premier niveau d'un paragraphe est
  -- traitee ; les Link y sont opaques (aplatir leur donne \1).
  local traiter_blocs
  traiter_blocs = function(liste)
    local out = pandoc.List()
    for _, b in ipairs(liste) do
      if b.t == 'Para' or b.t == 'Plain' then
        marquer_liens_manuels(b.content)
        b.content = traiter_inlines(b.content)
        -- Une note de bas de page porte des blocs à l'intérieur d'un inline : 107 notes du
        -- corpus contiennent un appel, il faut donc y descendre à la main.
        for _, il in ipairs(b.content) do
          if il.t == 'Note' then il.content = traiter_blocs(il.content) end
        end
      elseif b.t == 'BlockQuote' or b.t == 'Div' then
        b.content = traiter_blocs(b.content)
      elseif b.t == 'BulletList' or b.t == 'OrderedList' then
        local items = pandoc.List()
        for _, item in ipairs(b.content) do items:insert(traiter_blocs(item)) end
        b.content = items
      end
      out:insert(b)
    end
    return out
  end

  local sortie = pandoc.List()
  local corps = pandoc.List()
  for i = 1, limite do corps:insert(blocs[i]) end
  for _, b in ipairs(traiter_blocs(corps)) do sortie:insert(b) end
  for i = limite + 1, #blocs do sortie:insert(blocs[i]) end

  -- 3. envelopper chaque entrée dans son Div ancré, sans toucher au texte
  if #fiches > 0 then
    local finale = pandoc.List()
    local i = 1
    local par_bloc = {}
    for _, f in ipairs(fiches) do par_bloc[f.bloc] = f end
    while i <= #sortie do
      local f = par_bloc[i]
      if f then
        local dedans = pandoc.List()
        dedans:insert(sortie[i])
        for _ = 1, #f.suite do
          i = i + 1
          if sortie[i] then dedans:insert(sortie[i]) end
        end
        finale:insert(pandoc.Div(dedans, pandoc.Attr(f.id, { 'szh-reference' })))
      else
        finale:insert(sortie[i])
      end
      i = i + 1
    end
    sortie = finale
  end

  doc.blocks = sortie

  -- Rapport : ce que le rédacteur doit finir à la main.
  local jamais = {}
  -- Un article sans aucun appel est une documentation ou un agenda : sa « liste » est son
  -- contenu, et prévenir pour chaque entrée n'aiderait personne.
  if appels > 0 then
    for _, f in ipairs(fiches) do
      if not appelees[f.id] then jamais[#jamais + 1] = f.texte:sub(1, 70) end
    end
  end
  io.stderr:write(string.format(
    '[citations] %d référence(s), %d appel(s) : %d lié(s), %d ambigu(s), %d sans référence\n',
    #fiches, appels, appels - #orphelins - #ambigus, #ambigus, #orphelins))
  for _, o in ipairs(orphelins) do
    io.stderr:write('[citations] ⚠ appel sans référence : ' .. o .. '\n')
  end
  for _, a in ipairs(ambigus) do
    io.stderr:write('[citations] ⚠ appel ambigu, à lier à la main : ' .. a .. '\n')
  end
  for _, j in ipairs(jamais) do
    io.stderr:write('[citations] ⚠ référence jamais appelée : ' .. j .. '…\n')
  end
  return doc
end
