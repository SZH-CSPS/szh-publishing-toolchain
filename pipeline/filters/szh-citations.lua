-- Réinsère la bibliographie détachée à l'import, lui pose son titre, ancre chaque
-- référence et transforme les appels du corps en liens internes. Le texte des références
-- n'est pas modifié : seuls un identifiant et des liens s'y ajoutent.
--
-- Trois étapes :
--   1. la liste : le bloc « ::: {.szh-biblio src="<slug>.biblio.md"} » laissé par l'import
--      est remplacé par le contenu du fichier, comme pour les tableaux. Le titre est posé
--      au-dessus, dans la langue de l'article (TITRES_BIBLIO_DEFAUT, surchargé par le
--      config.json du poste). Chaque entrée reçoit un Div « szh-reference » d'id
--      ref-nom-annee, déduit de son contenu et donc stable d'une compilation à l'autre.
--      Un article dont la liste est encore dans le corps est traité par un repli, qui
--      avertit.
--   2. les appels : « (Bovey, 2022) », « (vgl. Kunz, 2016) », « Capurso et al. (2025) »,
--      « (Grimminger et al., 2021; Fisseler, 2023) », « (Pelgrims, 2001, 2006) »… Seule la
--      parenthèse devient le lien : dans un appel narratif, le lien porte sur l'année.
--   3. le rapport : appels sans référence et références jamais appelées partent sur stderr
--      en constats (voir « constats au rédacteur »). Avec SZH_APERCU=1, les appels non liés
--      reçoivent aussi la classe « szh-appel-orphelin », soulignée en pointillé dans
--      l'aperçu.
--
-- Un lien écrit à la main dans le .md (« [(Shaw et al., 2023)](#ref-shaw-2023) », posé par
-- l'action « Lier à une référence » du cockpit) est gardé tel quel. S'il vise un ancrage
-- inexistant, un avertissement le signale.
--
-- Réglage desactiverLiensReferences du config.json (szh.desactiverLiensReferences dans
-- VSCodium) : l'étape 2 ne pose plus de lien autour des appels appariés. Tout le reste est
-- inchangé : ancre des références, bilan, constats, marques d'aperçu.
--
-- S'exécute après szh-sections.lua, pour que le titre de bibliographie ne reçoive pas de
-- numéro de section.

local utils = pandoc.utils

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  -- debug.getinfo donne le chemin de ce fichier ; PANDOC_SCRIPT_FILE donnerait celui du
  -- script passé à pandoc, qui peut être un autre (les tests chargent ce filtre par dofile).
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[citations] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

-- ---------------------------------------------------------------- texte et comparaison
local function assainir(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return t
end

local trim = commun.trim
local function normaliser(t) return trim(assainir(t):gsub('%s+', ' ')) end

-- ---------------------------------------------------------------- constats au rédacteur
-- Une ligne, le format que le cockpit lit déjà pour l'import :
--
--   [citations-<ton>] <code> | article « <slug> » | <champ> | … | <fr> | [de] <de>
--
-- Le préfixe porte le ton, le deuxième champ un code stable. L'article est nommé dans la
-- ligne, car sous « make -j » les lignes de plusieurs articles se mélangent. La prose sert
-- seulement à l'affichage : le cockpit lit le code.
local slug_article = commun.slug_article

-- « | » sépare les champs : sans_barre() le retire des textes recopiés de l'article (appel,
-- entrée de bibliographie), qui couperaient sinon la ligne.
local sans_barre = commun.sans_barre

-- Livre (posé par Pandoc(doc)) : le constat nomme « chapitre « <slug> » » au lieu de
-- « article « <slug> » ». Le cockpit reconnaît les champs par leur nom.
local LIVRE = false

local function constat(ton, code, champs, fr, de)
  local nommes = { (LIVRE and 'chapitre « ' or 'article « ') .. slug_article() .. ' »' }
  for _, c in ipairs(champs) do nommes[#nommes + 1] = sans_barre(c) end
  commun.constat('citations', ton, code, nommes, sans_barre(fr), sans_barre(de))
end

local function avertir(code, champs, fr, de) constat('avertissement', code, champs, fr, de) end

-- Repli des lettres latines sur leur base ASCII. lib/citations.js du cockpit lit ces
-- tables dans ce fichier : le cockpit et la compilation calculent ainsi les mêmes
-- identifiants, et un lien posé à la main trouve son ancre dans le PDF.
--
-- Format : un jeton par point de code, dans l'ordre du bloc, séparés par des espaces. Le
-- jeton est la base ASCII (« ae », « ss », « oe » pour les ligatures) ou « - » pour un
-- caractère retiré. Les quatre blocs couvrent tout l'alphabet latin.
--
-- La base ASCII d'un point de code est sa décomposition NFD sans marques combinantes :
--
--   node -e "const s=String.fromCodePoint(0x0144).normalize('NFD').replace(/\p{M}/gu,'');
--            console.log(/^[A-Za-z0-9]+$/.test(s) ? s.toLowerCase() : 'a poser a la main')"
--
-- Une quarantaine de lettres ne se décomposent pas (Đ, Ł, Ø, Ħ, Ŧ, Ð, Þ, ß, Æ, Œ…) : leurs
-- jetons sont posés à la main. test/js/ancrages.test.js compare le repli Lua et le repli
-- JavaScript sur tous les points de code des blocs. Le cockpit refuse une table de moins
-- de 600 jetons.
local REPLI_BLOCS = {
  -- U+00C0..U+00FF  latin-1
  { 0x00C0, [[
    a a a a a a ae c e e e e i i i i d n o o o o o -
    o u u u u y th ss a a a a a a ae c e e e e i i i i
    d n o o o o o - o u u u u y th y
  ]] },
  -- U+0100..U+017F  latin etendu A
  { 0x0100, [[
    a a a a a a c c c c c c c c d d d d e e e e e e
    e e e e g g g g g g g g h h h h i i i i i i i i
    i i ij ij j j k k k l l l l l l l l l l n n n n n
    n n n n o o o o o o oe oe r r r r r r s s s s s s
    s s t t t t t t u u u u u u u u u u u u w w y y
    y z z z z z z s
  ]] },
  -- U+0180..U+024F  latin etendu B
  { 0x0180, [[
    b b b b b b o c c d d d d d e e e f f g g hv i i
    k k l l m n n o o o oi oi p p r s s sh s t t t t u
    u u v y y z z z z z z 2 5 5 ts w - - - - dz dz dz lj
    lj lj nj nj nj a a i i o o u u u u u u u u u u e a a
    a a ae ae g g g g k k o o o o z z j dz dz dz g g hv w
    n n a a ae ae o o a a a a e e e e i i i i o o o o
    r r r r u u u u s s t t g g h h n d ou ou z z a a
    e e o o o o o o o o y y l n t j db qp a c c l t s
    z - - b u v e e j j q q r r y y
  ]] },
  -- U+1E00..U+1EFF  latin etendu additionnel
  { 0x1E00, [[
    a a b b b b b b c c d d d d d d d d d d e e e e
    e e e e e e f f g g h h h h h h h h h h i i i i
    k k k k k k l l l l l l l l m m m m m m n n n n
    n n n n o o o o o o o o p p p p r r r r r r r r
    s s s s s s s s s s t t t t t t t t u u u u u u
    u u u u v v v v w w w w w w w w w w x x x x y y
    z z z z z z h t w y a s s s ss d a a a a a a a a
    a a a a a a a a a a a a a a a a e e e e e e e e
    e e e e e e e e i i i i o o o o o o o o o o o o
    o o o o o o o o o o o o u u u u u u u u u u u u
    u u y y y y y y y y ll ll v v y y
  ]] },
}

-- Retirés sans avertissement : espaces, ponctuation, marques combinantes, symboles.
local PLAGES_IGNOREES = {
  { 0x00A0, 0x00BF }, { 0x02B0, 0x02FF }, { 0x0300, 0x036F }, { 0x1AB0, 0x1AFF },
  { 0x1DC0, 0x1DFF }, { 0x2000, 0x206F }, { 0x2070, 0x209F }, { 0x20A0, 0x20D0 },
  { 0x2100, 0x214F }, { 0x2190, 0x2BFF }, { 0xFE00, 0xFE0F }, { 0x1F000, 0x1FAFF },
}

local REPLI = {}
for _, bloc in ipairs(REPLI_BLOCS) do
  local cp = bloc[1]
  for jeton in bloc[2]:gmatch('%S+') do
    -- « - » : retiré sans avertissement. « ? » : hors table, donc signalé.
    if jeton ~= '?' then REPLI[cp] = (jeton == '-') and '' or jeton end
    cp = cp + 1
  end
end

local function ignore(cp)
  for _, p in ipairs(PLAGES_IGNOREES) do
    if cp >= p[1] and cp <= p[2] then return true end
  end
  return false
end

-- Un caractère hors des tables est retiré et signalé une fois : le cockpit pourrait le
-- replier autrement, et le lien du .md ne trouverait plus l'ancre du PDF.
local signales = {}
local function signaler(cp)
  if signales[cp] then return end
  signales[cp] = true
  local car = '?'
  local ok, c = pcall(utf8.char, cp)
  if ok then car = c end
  avertir('caractere-sans-repli',
    { 'caractere « ' .. car .. ' »', string.format('point U+%04X', cp) },
    string.format('Caractère sans repli ASCII, retiré des identifiants : « %s » (U+%04X).',
      car, cp),
    string.format('Zeichen ohne ASCII-Ersatz, aus den Kennungen entfernt: « %s » (U+%04X).',
      car, cp))
end

local function repli(cp)
  local r = REPLI[cp]
  if r then return r end
  if ignore(cp) then return '' end
  signaler(cp)
  return ''
end

-- Replie les lettres accentuées et laisse le reste tel quel : noms_de() a besoin des
-- virgules, points et espaces pour découper une en-tête.
--
-- Le décodage UTF-8 est fait à la main : utf8.codes lève une erreur sur un octet isolé,
-- et un .md issu d'un docx en porte parfois. Ici l'octet fautif est retiré.
local function replier(t)
  local out, i, n = {}, 1, #(t or '')
  while i <= n do
    local b = t:byte(i)
    if b < 0x80 then
      out[#out + 1] = t:sub(i, i)
      i = i + 1
    else
      local cp, long
      if b >= 0xF0 then cp, long = b - 0xF0, 4
      elseif b >= 0xE0 then cp, long = b - 0xE0, 3
      elseif b >= 0xC0 then cp, long = b - 0xC0, 2
      else cp, long = nil, 1 end                   -- octet de continuation orphelin
      if cp then
        for k = 1, long - 1 do
          local c = t:byte(i + k)
          if not c or c < 0x80 or c > 0xBF then cp, long = nil, k break end
          cp = cp * 64 + (c - 0x80)
        end
      end
      i = i + long
      if cp then out[#out + 1] = repli(cp) end
    end
  end
  return table.concat(out)
end

local function plat(t)
  return (replier(assainir(t or '')):lower():gsub('[^a-z0-9]', ''))
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
  'referencesbibliographiques', 'riferimenti', 'riferimentibibliografici',
}

-- Titre posé au-dessus de la bibliographie, par revue et par langue d'article. Ce sont les
-- valeurs par défaut : le config.json du poste les surcharge clé par clé (bloc
-- « Bibliographie » des Réglages). Le titre dépend de la langue, pas de la revue.
-- lib/citations.js du cockpit lit cette table dans ce fichier.
local TITRES_BIBLIO_DEFAUT = {
  revue       = { fr = [[Références]], de = [[Literatur]], it = [[Bibliografia]] },
  zeitschrift = { fr = [[Références]], de = [[Literatur]], it = [[Bibliografia]] },
}

-- Mots d'amorce devant un appel : « (vgl. Kunz, 2016) », « (z. B. Kunz, 2016) ».
local AMORCES = { 'vgl', 'siehe', 'zb', 'ua', 'cf', 'voir', 'voiraussi', 'selon', 'nach',
                  'dapres', 'etwa', 'insb', 'bes', 'parex', 'eg', 'zitn' }

-- Mots capitalisés qui ouvrent une phrase et ne sont pas des noms d'auteur.
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

-- Titre de bibliographie : comparaison exacte de la forme aplatie avec TITRES_BIB. Une
-- comparaison par préfixe prendrait « Literaturhinweise für die Praxis » pour une
-- bibliographie, et la prose qui suit ne serait plus lue. Le numéro de section est retiré
-- avant par texte_de_titre().
local function est_titre_bib(txt)
  local p = plat(txt)
  for _, t in ipairs(TITRES_BIB) do
    if p == t then return true end
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
  -- Les accents sont repliés avant de découper : les motifs Lua comptent les octets, et
  -- couperaient « Weiß » en « Wei » et « ß ».
  local f = replier(assainir(entete or ''))
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

-- Nom qui entre dans l'identifiant : le premier mot de deux lettres au moins, accents et
-- ligatures repliés. La règle reste simple pour que lib/citations.js du cockpit calcule le
-- même identifiant en JavaScript.
local function nom_pour_id(entete)
  local f = replier(assainir(entete or ''))
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
    -- « Nom, X. » : des personnes. Sans ce motif, l'en-tête est une raison sociale, et le
    -- nom appelé peut être cherché n'importe où dans l'en-tête.
    institutionnel = entete:find('[%u][%w\128-\191\'%-]+,%s*%u%.') == nil,
  }
end

-- Vrai si le paragraphe continue l'entrée précédente : une ligne d'URL, ou une ligne qui
-- commence par une minuscule ASCII sans année. Tout le reste ouvre une entrée : lettre
-- accentuée (« Übereinkommen »), astérisque, chiffre, guillemet, ou minuscule suivie
-- d'une année (« insieme Schweiz (2024) »).
local function est_continuation(txt)
  if txt:sub(1, 4):lower() == 'http' or txt:sub(1, 3):lower() == 'www' then return true end
  local c = txt:byte(1) or 0
  if not (c >= 97 and c <= 122) then return false end
  return txt:sub(1, 130):find('%f[%d](%d%d%d%d)%f[%D]') == nil
end

-- Point d'entrée de test : test/js/ancrages.test.js charge ce fichier par dofile, exécute
-- ces fonctions sur les mêmes entrées que lib/citations.js du cockpit et compare.
SZH_CITATIONS = {
  replier = replier, plat = plat, nom_pour_id = nom_pour_id,
  est_titre_bib = est_titre_bib, est_continuation = est_continuation,
}

-- ------------------------------------------------ le titre de la bibliographie, réglable
-- L'import retire le titre de la bibliographie ; la compilation le pose. Il vient du
-- config.json du poste et retombe sur TITRES_BIBLIO_DEFAUT clé par clé.
--
-- Le filtre lit le fichier lui-même : le cockpit lance la compilation par wsl.exe, qui ne
-- transmet pas l'environnement de Windows sans WSLENV. SZH_CONFIG impose un autre chemin
-- (utilisé par les tests).
local CONFIG_POSTE = '/mnt/c/ProgramData/SZH/config.json'

-- Lecteur JSON minimal : objets, tableaux, chaînes, nombres, booléens, null. Rend nil sur
-- du JSON mal formé, et les valeurs par défaut s'appliquent.
local function lire_json(s)
  local i = 1
  local valeur                                  -- déclaration avant usage mutuel
  local function saut()
    while true do
      local c = s:sub(i, i)
      if c == ' ' or c == '\t' or c == '\n' or c == '\r' then i = i + 1 else break end
    end
  end
  local function chaine()
    i = i + 1                                   -- le guillemet ouvrant
    local out = {}
    while i <= #s do
      local c = s:sub(i, i)
      if c == '"' then
        i = i + 1
        return table.concat(out)
      elseif c == '\\' then
        local e = s:sub(i + 1, i + 1)
        local simples = { n = '\n', t = '\t', r = '\r', b = '\b', f = '\f',
                          ['"'] = '"', ['\\'] = '\\', ['/'] = '/' }
        if simples[e] then
          out[#out + 1] = simples[e]
          i = i + 2
        elseif e == 'u' then
          local hex = s:sub(i + 2, i + 5)
          out[#out + 1] = utf8.char(tonumber(hex, 16) or 0xFFFD)
          i = i + 6
        else
          return nil
        end
      else
        out[#out + 1] = c
        i = i + 1
      end
    end
    return nil
  end
  valeur = function()
    saut()
    local c = s:sub(i, i)
    if c == '"' then return chaine() end
    if c == '{' then
      i = i + 1
      local t = {}
      saut()
      if s:sub(i, i) == '}' then i = i + 1 return t end
      while true do
        saut()
        if s:sub(i, i) ~= '"' then return nil end
        local clef = chaine()
        if clef == nil then return nil end
        saut()
        if s:sub(i, i) ~= ':' then return nil end
        i = i + 1
        local v = valeur()
        if v == nil then return nil end
        t[clef] = v
        saut()
        local suite = s:sub(i, i)
        i = i + 1
        if suite == '}' then return t end
        if suite ~= ',' then return nil end
      end
    end
    if c == '[' then
      i = i + 1
      local t = {}
      saut()
      if s:sub(i, i) == ']' then i = i + 1 return t end
      while true do
        local v = valeur()
        if v == nil then return nil end
        t[#t + 1] = v
        saut()
        local suite = s:sub(i, i)
        i = i + 1
        if suite == ']' then return t end
        if suite ~= ',' then return nil end
      end
    end
    if s:sub(i, i + 3) == 'true' then i = i + 4 return true end
    if s:sub(i, i + 4) == 'false' then i = i + 5 return false end
    -- null : rendu comme une table vide, pour ne pas se confondre avec un échec
    if s:sub(i, i + 3) == 'null' then i = i + 4 return {} end
    local n, j = s:match('^(%-?%d+%.?%d*[eE]?[-+]?%d*)()', i)
    if n then
      i = j
      return tonumber(n) or 0
    end
    return nil
  end
  local v = valeur()
  return type(v) == 'table' and v or nil
end

local function lire_config_poste()
  local chemin = os.getenv('SZH_CONFIG')
  if chemin == nil or chemin == '' then chemin = CONFIG_POSTE end
  local f = io.open(chemin, 'r')
  if not f then return nil end
  local brut = f:read('a')
  f:close()
  if not brut then return nil end
  return lire_json((brut:gsub('^\239\187\191', '')))   -- BOM d'anciens config.json
end

-- Jeu de titres par défaut : celui de la Zeitschrift, sinon celui de la Revue (livre
-- compris).
local function jeton_revue(contexte)
  return contexte.produit == 'zeitschrift' and 'zeitschrift' or 'revue'
end

-- Titre en inlines pandoc : un Str par mot, un Space entre. Un Str contenant une espace
-- n'est pas valide pour pandoc, et les sorties autres que HTML (galley DOCX) le rendent mal.
local function inlines_du_titre(titre)
  local out = pandoc.List()
  for mot in titre:gmatch('%S+') do
    if #out > 0 then out:insert(pandoc.Space()) end
    out:insert(pandoc.Str(mot))
  end
  return pandoc.Inlines(out)
end

local function titre_bibliographie(meta)
  local contexte = commun.contexte(meta)
  local revue = jeton_revue(contexte)
  local lang = contexte.lang
  local defauts = TITRES_BIBLIO_DEFAUT[revue] or TITRES_BIBLIO_DEFAUT.revue
  local titre = defauts[lang] or defauts.fr
  local cfg = lire_config_poste()
  local pose = cfg and cfg.biblio and cfg.biblio.titres
  pose = pose and pose[revue]
  pose = pose and pose[lang]
  -- La clé présente l'emporte, même vide : un champ vidé dans les Réglages supprime le
  -- titre.
  if type(pose) == 'string' then titre = pose end
  return normaliser(titre)
end

-- Rang du titre de bibliographie : le premier rang de section, celui que szh-niveaux.lua
-- vise (MIN_CIBLE), le <h1> étant le titre de l'article sur la couverture.
local NIVEAU_BIB = 2

-- Texte d'un titre sans son numéro de section (Span « szh-num-section » posé en tête par
-- szh-sections.lua) : « 6 Références » donne « Références ».
local function texte_de_titre(h)
  local dedans = pandoc.List()
  for k, il in ipairs(h.content) do
    local numero = (k == 1 and il.t == 'Span' and il.classes:includes('szh-num-section'))
    if not numero then dedans:insert(il) end
  end
  return normaliser(utils.stringify(pandoc.Span(dedans)))
end

-- ------------------------------------------------------------------ détection des appels
local function est_annee(jeton)
  local an, suf = jeton:match('^(%d%d%d%d)(%a?)$')
  if an then return an, suf end
  local p = plat(jeton)
  if p == 'sd' or p == 'oj' or p == 'nd' then return '', '' end
  return nil
end

-- Toutes les années d'un fragment, dans l'ordre, avec leur position. La position permet
-- de lier chaque année d'un appel multiple : « (Sen, 2001, 2009) » donne deux liens.
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

-- Vrai si le fragment ne contient que des années, une amorce et un locateur : c'est un
-- appel narratif, « Capurso et al. (2025, p. 3) ».
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

-- Abréviations dont le point ne ferme pas la phrase (« et al. », « u. a. », « et coll. »,
-- initiale « J.-J. »). Pour lire les noms d'un appel narratif (« Selon Capurso et al.
-- (2025) »), on coupe la prose à la dernière fin de phrase : ces points sont neutralisés
-- d'abord, sinon la coupe tomberait sur « al. ». Un vrai point de fin de phrase arrête
-- toujours la coupe (« … la théorie. Bovey (2022) »).
-- Paires motif, remplacement. La même liste sert à neutraliser_abreviations_dauteur() et
-- à debut_prose_narrative(), pour que les deux restent d'accord.
local ABREVIATIONS_DAUTEUR = {
  { '%f[%a]et%s+al%.', 'et al' },
  { '%f[%a]et%s+coll%.', 'et coll' },
  { '%f[%a]u%.%s*a%.', 'u a' },
  -- Initiale de prénom : une seule majuscule suivie d'un point, en début de mot
  -- (« J.-J. Dupont »).
  { '%f[%a](%u)%.', '%1' },
}

local function neutraliser_abreviations_dauteur(t)
  for _, m in ipairs(ABREVIATIONS_DAUTEUR) do t = t:gsub(m[1], m[2]) end
  return t
end

-- Position dans `prefixe` (le début de `txt`) juste après la dernière fin de phrase qui
-- n'est pas un point d'abréviation d'auteur. Sert à découper le libellé du constat, qui
-- doit rester une sous-chaîne exacte de `txt` : la flèche « Vers l'article » du cockpit le
-- cherche tel quel dans le .md. La copie de neutraliser_abreviations_dauteur() change de
-- longueur (« u.a. » → « u a ») ; cette fonction repère donc les mêmes motifs sur le texte
-- d'origine, sans le modifier.
local function debut_prose_narrative(prefixe)
  local protege = {}
  for _, m in ipairs(ABREVIATIONS_DAUTEUR) do
    local motif = m[1]
    local i = 1
    while true do
      local a, b = prefixe:find(motif, i)
      if not a then break end
      for k = a, b do protege[k] = true end
      i = b + 1
    end
  end
  for i = #prefixe, 1, -1 do
    local c = prefixe:byte(i)
    -- . ; : ! ? ( ) et l'octet sentinelle \1 (voir aplatir()) : les mêmes frontières que le
    -- motif qui extrait la prose d'un appel narratif dans relever().
    local frontiere = (c == 46 or c == 59 or c == 58 or c == 33 or c == 63
                        or c == 40 or c == 41 or c == 1)
    if frontiere and not protege[i] then return i + 1 end
  end
  return 1
end

-- Vrai si le millésime suit une virgule (forme APA) ou « et al. », « u. a. », « et coll. ».
-- En allemand, une parenthèse de prose devant une année ressemble à un appel, car les noms
-- communs sont capitalisés : rien ne distingue « Werte » de « Bovey ». Sans virgule, seul
-- l'appariement à la bibliographie décide (voir relever()).
local function virgule_avant_millesime(tete)
  local t = trim(tete)
  if t:match(',%s*$') then return true end
  -- noms_de_lappel() traite ces abréviations comme une virgule.
  if t:match('%f[%w]et%s+al%.?%s*$') then return true end
  if t:match('%f[%w]u%.%s?a%.%s*$') then return true end
  if t:match('%f[%w]et%s+coll%.?%s*$') then return true end
  return false
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
  -- entière pour une raison sociale. En APA, un appel nomme le premier auteur.
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
    -- Passe large, seulement si la stricte ne trouve rien : n'importe quel co-auteur, et
    -- tous les noms cités. Rattrape les appels mal écrits dans la source.
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
-- Remplace espaces et tirets Unicode par autant d'octets ASCII, pour garder les décalages
-- valides. Le lecteur markdown « smart » de pandoc met une espace insécable après une
-- abréviation (« p. 202 »), que %s de Lua ne reconnaît pas.
local function assainir_iso(t)
  t = t:gsub('\194\160', '  ')                -- espace insécable -> 2 espaces
  t = t:gsub('\226\128\175', '   ')           -- espace fine insécable -> 3
  t = t:gsub('\226\128\137', '   ')           -- espace fine -> 3
  t = t:gsub('\226\128\147', '---')           -- tiret demi-cadratin -> 3 tirets
  t = t:gsub('\226\128\148', '---')           -- cadratin
  t = t:gsub('\226\128\145', '---')           -- trait d'union insécable
  return t
end

-- Texte plat d'une liste d'inlines, et la position de départ de chaque inline. Les inlines
-- qui ne sont ni Str ni Space donnent l'octet \1, qu'aucun motif d'appel ne traverse : un
-- appel à cheval sur de l'italique est ignoré plutôt que mal découpé.
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

-- Remplace la plage [s,e] du texte plat par l'inline que rend `fabriquer`, en découpant
-- les Str aux bornes.
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
      contenu:insert(il)                              -- Space à l'intérieur de l'appel
    end
    if f >= e then vider() end
  end
  vider()
  return sortie
end

-- id_ancre, s'il est fourni, pose un identifiant sur l'appel : c'est la cible de la flèche
-- retour de la bibliographie. Seule la première occurrence d'une référence en reçoit un.
local function lien(cible, id_ancre)
  return function(contenu)
    return pandoc.Link(contenu, cible, '', pandoc.Attr(id_ancre or '', { 'szh-appel' }))
  end
end

local function marque(classe)
  return function(contenu) return pandoc.Span(contenu, pandoc.Attr('', { classe })) end
end

-- --------------------------------------------- la bibliographie détachée, réinsérée
-- Comme szh-tabelle-inclure.lua : le dossier courant est celui de l'article, et un
-- fichier manquant donne un encadré d'avertissement visible dans le rendu. Les deux
-- classes ont le même style rouge (styles/partage-filtres.css).
local function bloc_manquant(texte)
  return pandoc.Div(
    { pandoc.Para({ pandoc.Strong({ pandoc.Str('⚠ ' .. texte) }) }) },
    pandoc.Attr('', { 'szh-biblio-manquante', 'szh-tabelle-manquante' }, {})
  )
end

-- Vrai si le texte ne contient que des blancs, y compris l'insécable (U+00A0), l'espace
-- fine insécable (U+202F) et le BOM (U+FEFF), que %s de Lua ne reconnaît pas. L'import
-- crée toujours <slug>.biblio.md, même sans bibliographie (voir szh-biblio-detacher.lua).
-- Un fichier vide n'imprime rien et ne déclenche aucun avertissement ; un fichier absent
-- est signalé (« biblio-introuvable », dans resoudre_biblio()).
local function est_vide(texte)
  local t = (texte or ''):gsub('[ \t\r\n\f\v]', '')
  t = t:gsub('\194\160', '')     -- U+00A0, espace insécable
  t = t:gsub('\226\128\175', '') -- U+202F, espace fine insécable
  t = t:gsub('\239\187\191', '') -- U+FEFF, BOM
  return t == ''
end

-- Pour test/js/biblio-vide.test.js.
SZH_CITATIONS.est_vide = est_vide

-- Rend (blocs, première entrée, dernière entrée). Le bloc .szh-biblio est remplacé par le
-- titre puis par les entrées du fichier. Sans ce bloc, les blocs sortent tels quels et les
-- deux positions valent nil : l'appelant décide alors du repli.
local function resoudre_biblio(doc, slug)
  local sortie = pandoc.List()
  local premiere, derniere = nil, nil
  for _, b in ipairs(doc.blocks) do
    local est_marqueur = (b.t == 'Div' and b.classes:includes('szh-biblio')
                          and premiere == nil)
    if not est_marqueur then
      sortie:insert(b)
    else
      local src = b.attributes['src'] or ''
      local f = src ~= '' and io.open(src, 'r') or nil
      local contenu = f and f:read('a') or nil
      if f then f:close() end
      if contenu == nil then
        sortie:insert(bloc_manquant(
          'Bibliographie introuvable : ' .. (src ~= '' and src or '(aucun fichier indiqué)')
          .. ' (fichier supprimé ou renommé ?)'))
        avertir('biblio-introuvable', { 'fichier « ' .. src .. ' »' },
          'Le fichier de bibliographie de cet article est introuvable : la liste de '
          .. "références manque au document. Réimportez l’article, ou retirez la référence "
          .. 'de bibliographie du texte.',
          'Die Literaturverzeichnis-Datei dieses Artikels fehlt: die Literaturliste fehlt '
          .. 'im Dokument. Importieren Sie den Artikel neu, oder entfernen Sie den Verweis '
          .. 'auf das Literaturverzeichnis aus dem Text.')
      elseif est_vide(contenu) then
        -- Fichier vide : le bloc disparaît, sans avertissement.
      else
        local entrees = pandoc.read(contenu, 'markdown').blocks
        if #entrees > 0 then
          local titre = titre_bibliographie(doc.meta)
          if titre ~= '' then
            -- Identifiant fixe, préfixé « szh- » pour ne pas heurter celui qu'un titre de
            -- section homonyme reçoit du lecteur markdown.
            sortie:insert(pandoc.Header(NIVEAU_BIB, inlines_du_titre(titre),
              pandoc.Attr('szh-bibliographie', {}, {})))
          end
          premiere = #sortie + 1
          for _, x in ipairs(entrees) do sortie:insert(x) end
          derniere = #sortie
        end
      end
    end
  end
  return sortie, premiere, derniere
end

-- ------------------------------------------------------------------------ le filtre
local APERCU = (os.getenv('SZH_APERCU') or '') ~= ''

-- Lu une fois : lire_config_poste() rouvre le fichier à chaque appel, et relever() est
-- appelé pour chaque parenthèse.
local LIENS_DESACTIVES = (function()
  local cfg = lire_config_poste()
  return cfg ~= nil and cfg.desactiverLiensReferences == true
end)()

function Pandoc(doc)
  -- 1. la liste de références : le bloc « ::: {.szh-biblio src=…} » est remplacé par le
  -- titre et le contenu de <slug>.biblio.md.
  local slug = slug_article()
  local contexte = commun.contexte(doc.meta)
  LIVRE = contexte.produit == 'livre'
  -- Langue de la flèche retour (aria-label, FR/DE).
  local LANG_RETOUR = contexte.lang
  local blocs, premiere, derniere_liste = resoudre_biblio(doc, slug)

  -- Repli : un article dont la bibliographie n'a pas de fichier à part la porte dans le
  -- corps. On la retrouve sous son titre (est_titre_bib), et un avertissement le signale.
  if not premiere then
    local idx_titre = nil
    for i, b in ipairs(blocs) do
      if b.t == 'Header' and est_titre_bib(texte_de_titre(b)) then idx_titre = i end
    end
    if idx_titre then
      premiere, derniere_liste = idx_titre + 1, #blocs
      -- constat() nomme déjà l'article.
      avertir('biblio-dans-le-corps', {},
        "La bibliographie de cet article est encore dans le texte : elle n’a pas de "
        .. "fichier à part, et l’export vers la plateforme partira sans liste de "
        .. "références. Réimportez l’article pour la mettre à part.",
        'Das Literaturverzeichnis dieses Artikels steht noch im Text: es hat keine eigene '
        .. 'Datei, und der Export auf die Plattform geht ohne Literaturliste. Importieren '
        .. 'Sie den Artikel neu, um es auszulagern.')
    end
  end

  local fiches, ancrages = {}, {}
  local derniere = nil
  if premiere then
    local i = premiere
    while i <= math.min(derniere_liste or #blocs, #blocs) do
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

  -- 2. les appels, dans tout ce qui n'est pas la liste : avant elle et après elle (notes
  -- de fin, annexes).
  local limite = premiere and (premiere - 1) or #blocs
  local reprise = (premiere and derniere_liste) and (derniere_liste + 1) or (#blocs + 1)
  local appels, orphelins, ambigus = 0, {}, {}
  local appelees = {}
  -- Flèche retour : ancre_posee[id] est vrai dès que la première occurrence d'un appel de
  -- cette référence a reçu l'identifiant « appel-<id> ». libelle_par_ref[id] garde le
  -- texte de cette occurrence (« (Dupont, 2024) ») pour l'aria-label.
  local ancre_posee = {}
  local libelle_par_ref = {}

  -- Rend les plages à lier d'une parenthèse. Elles sont posées ensuite de droite à gauche :
  -- les décalages à gauche d'une pose restent valides, et une parenthèse peut contenir
  -- plusieurs appels.
  local function relever(txt, s, e, dedans)
    local plages = {}
    local frags, decalage = {}, 0
    for frag in (dedans .. ';'):gmatch('([^;]*);') do
      frags[#frags + 1] = { texte = frag, debut = s + 1 + decalage }
      decalage = decalage + #frag + 1
    end
    local noms_precedents = nil
    -- Début du libellé dans txt pour un appel narratif, reconduit d'un fragment à l'autre
    -- comme noms_precedents ; nil pour un appel entre parenthèses.
    local depart_narratif_precedent = nil
    for rang, fr in ipairs(frags) do
      local ans = annees_du_fragment(fr.texte)
      if #ans > 0 then
        local noms
        local depart_narratif = nil
        -- Vrai pour un appel entre parenthèses sans virgule devant le millésime : seule la
        -- bibliographie décide alors si c'est un appel (voir virgule_avant_millesime).
        local exige_appariement = false
        if rang > 1 and noms_precedents and fragment_annees_seules(fr.texte) then
          -- « (Weiß, 2016 ; 2023) », « (Schröttle et al., 2024a ; 2024b) » : le second
          -- fragment ne porte qu'une année, l'auteur est celui du fragment précédent, et le
          -- libellé reprend le même départ.
          noms = noms_precedents
          depart_narratif = depart_narratif_precedent
        elseif fragment_annees_seules(fr.texte) then
          -- Appel narratif : les noms sont dans la prose qui précède la parenthèse. Les noms
          -- se lisent sur une copie neutralisée ; la position du libellé se calcule sur txt
          -- (debut_prose_narrative).
          local prefixe = txt:sub(1, s - 1)
          local depart_phrase = debut_prose_narrative(prefixe)
          local queue = neutraliser_abreviations_dauteur(prefixe)
                          :match('([^%.;:!%?%(%)\1]*)$') or ''
          noms = noms_de_lappel(queue)
          -- « Selon Lefebvre et al. (2019) » : le libellé commence au premier mot du nom,
          -- sans l'amorce. Ce mot est cherché tel quel dans txt avant la parenthèse ;
          -- introuvable, le libellé part de depart_phrase et garde l'amorce.
          depart_narratif = depart_phrase
          local premier_mot = noms[1] and noms[1]:match('^(%S+)')
          if premier_mot then
            local trouve = txt:find(premier_mot, depart_phrase, true)
            if trouve and trouve <= s - 1 then depart_narratif = trouve end
          end
        else
          local coupe = fr.texte:find('%f[%w]%d%d%d%d%f[%W]') or (#fr.texte + 1)
          local tete = fr.texte:sub(1, coupe - 1)
          noms = noms_de_lappel(tete)
          if #noms == 0 then
            -- « (… prose …, Ryan & Deci, 1989) » : on retente sur la fin seulement
            local queue = tete:match('([^,;:%(%)]*[,;]?%s*)$') or ''
            noms = noms_de_lappel(queue)
          end
          exige_appariement = not virgule_avant_millesime(tete)
        end
        if #noms > 0 then
          noms_precedents = noms
          depart_narratif_precedent = depart_narratif
          for _, a in ipairs(ans) do
            local cands = apparier({ noms = noms, annee = a.annee, suffixe = a.suffixe },
                                   fiches)
            -- Sans virgule devant le millésime, une parenthèse qui ne s'apparie à aucune
            -- référence n'est pas un appel : ni bilan, ni constat, ni lien. Conséquence : un
            -- vrai appel sans virgule dont la référence manque n'est pas signalé. En échange,
            -- la prose allemande ne produit pas de faux appels.
            if exige_appariement and #cands == 0 then goto continue end
            appels = appels + 1
            -- Libellé du constat, que la flèche « Vers l'article » du cockpit cherche tel
            -- quel dans le .md : toujours une plage de txt. Un appel narratif l'étend vers
            -- la gauche jusqu'au nom (depart_narratif).
            local libelle = normaliser(txt:sub(depart_narratif or s, e))
            local ds, de
            if #frags == 1 and #ans == 1 then
              ds, de = s, e                                   -- toute la parenthèse
            elseif #ans == 1 then
              ds, de = fr.debut, fr.debut + #fr.texte - 1      -- le fragment
            else
              ds, de = fr.debut + a.s - 1, fr.debut + a.e - 1  -- l'année seule
            end
            if #cands == 1 then
              appelees[cands[1].id] = true
              -- L'appariement compte toujours ; le réglage ne supprime que le lien.
              --
              -- Le lien (`faire`) est fabriqué par traiter_inlines(), qui sait quelle
              -- occurrence est la première une fois parenthèses et crochets balayés.
              if not LIENS_DESACTIVES then
                plages[#plages + 1] = { s = ds, e = de, id_ref = cands[1].id, libelle = libelle }
              end
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
            ::continue::
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
    -- Parenthèses et crochets servent d'appel : « nach Salter & Croce [2022] »,
    -- « [Pettrich et al., 2025] ». Les crochets du markdown (lien, span, note) sont déjà
    -- des inlines opaques : seuls les crochets tapés dans le texte arrivent ici.
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
    -- Flèche retour : les plages appariées (id_ref) sont triées par position, et la
    -- première occurrence de chaque référence dans le document reçoit l'ancre.
    local par_position = {}
    for _, p in ipairs(plages) do
      if p.id_ref then par_position[#par_position + 1] = p end
    end
    table.sort(par_position, function(a, b) return a.s < b.s end)
    for _, p in ipairs(par_position) do
      local id_ancre = nil
      if not ancre_posee[p.id_ref] then
        id_ancre = 'appel-' .. p.id_ref
        ancre_posee[p.id_ref] = true
        libelle_par_ref[p.id_ref] = p.libelle
      end
      p.faire = lien('#' .. p.id_ref, id_ancre)
    end
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

  -- Les liens posés à la main sont gardés et comptés, quel que soit le réglage. S'il est la
  -- première occurrence de sa référence, un tel lien reçoit l'ancre de la flèche retour.
  local function marquer_liens_manuels(inlines)
    for _, il in ipairs(inlines) do
      if il.t == 'Link' and il.target:sub(1, 5) == '#ref-' then
        local id = il.target:sub(2)
        if ancrages[id] then
          appelees[id] = true
          if not ancre_posee[id] then
            il.identifier = 'appel-' .. id
            ancre_posee[id] = true
            libelle_par_ref[id] = normaliser(utils.stringify(il.content))
          end
        else
          avertir('ancrage-inconnu', { 'ancrage « ' .. il.target .. ' »' },
            'Lien manuel vers un ancrage inconnu : ' .. il.target .. '.',
            'Manuelle Verknüpfung auf eine unbekannte Textmarke: ' .. il.target .. '.')
        end
      end
    end
  end

  -- Parcours à la main plutôt que pandoc.walk_block, dont le filtre Inlines visite aussi le
  -- contenu des liens et y imbriquerait un second lien. Seuls les inlines de premier
  -- niveau d'un paragraphe sont traités ; les Link y sont opaques (\1).
  local traiter_blocs
  traiter_blocs = function(liste)
    local out = pandoc.List()
    for _, b in ipairs(liste) do
      if b.t == 'Para' or b.t == 'Plain' then
        marquer_liens_manuels(b.content)
        b.content = traiter_inlines(b.content)
        -- Une note de bas de page contient des blocs, qui peuvent porter des appels.
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
  for i = limite + 1, math.min(reprise - 1, #blocs) do sortie:insert(blocs[i]) end
  local queue = pandoc.List()
  for i = reprise, #blocs do queue:insert(blocs[i]) end
  for _, b in ipairs(traiter_blocs(queue)) do sortie:insert(b) end

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
        -- Flèche retour, seulement si un appel de la référence a reçu une ancre dans le
        -- corps. Il n'y en a pas pour une référence jamais appelée, ni, réglage
        -- desactiverLiensReferences actif, pour une référence appelée sans lien manuel.
        if ancre_posee[f.id] then
          for k = #dedans, 1, -1 do
            local b = dedans[k]
            if b.t == 'Plain' or b.t == 'Para' then
              local libelle = libelle_par_ref[f.id] or ''
              -- Lien vide à aria-label : le lecteur d'écran annonce sa destination, et
              -- l'icône est un fond CSS (.szh-retour-appel, print.css). Comme a.szh-orcid :
              -- un <a> non vide casse le lien PDF/UA sous WeasyPrint (règle 7.18.5).
              local texte_aria = (LANG_RETOUR == 'de')
                and ('Zurück zum Zitatverweis ' .. libelle)
                or ('Retour à l’appel de ' .. libelle)
              local retour = pandoc.Link(pandoc.Inlines({}), '#appel-' .. f.id, '',
                pandoc.Attr('', { 'szh-retour-appel' }, { { 'aria-label', texte_aria } }))
              local queue = pandoc.Inlines({ pandoc.Space(), retour })
              dedans[k] = (b.t == 'Plain') and pandoc.Plain(b.content .. queue)
                                            or pandoc.Para(b.content .. queue)
              break
            end
          end
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
  -- Sans aucun appel (documentation, agenda), la liste est le contenu même : pas de
  -- constat par entrée.
  if appels > 0 then
    for _, f in ipairs(fiches) do
      if not appelees[f.id] then jamais[#jamais + 1] = f.texte:sub(1, 70) end
    end
  end
  -- Bilan en ton « info ». Le cockpit ne le montre que s'il reste quelque chose à lier.
  local lies = appels - #orphelins - #ambigus
  constat('info', 'bilan',
    { 'references ' .. #fiches, 'appels ' .. appels, 'lies ' .. lies,
      'ambigus ' .. #ambigus, 'sansref ' .. #orphelins },
    string.format('%d référence(s), %d appel(s) : %d lié(s), %d ambigu(s), %d sans référence.',
      #fiches, appels, lies, #ambigus, #orphelins),
    string.format('%d Eintrag/Einträge, %d Verweis(e): %d verknüpft, %d mehrdeutig, %d ohne Eintrag.',
      #fiches, appels, lies, #ambigus, #orphelins))
  for _, o in ipairs(orphelins) do
    avertir('appel-sans-reference', { 'appel « ' .. o .. ' »' },
      'Appel sans référence : ' .. o .. '.',
      'Zitatverweis ohne Eintrag im Verzeichnis: ' .. o .. '.')
  end
  for _, a in ipairs(ambigus) do
    avertir('appel-ambigu', { 'appel « ' .. a .. ' »' },
      'Appel ambigu, à lier à la main : ' .. a .. '.',
      'Mehrdeutiger Zitatverweis, von Hand zu verknüpfen: ' .. a .. '.')
  end
  for _, j in ipairs(jamais) do
    -- Le champ « reference » reste un extrait exact du .md, sans « … », car le cockpit le
    -- cherche tel quel. Les phrases fr/de portent l'ellipse.
    avertir('reference-orpheline', { 'reference « ' .. j .. ' »' },
      'Référence jamais appelée : ' .. j .. '…',
      'Nie zitierter Eintrag: ' .. j .. '…')
  end
  return doc
end
