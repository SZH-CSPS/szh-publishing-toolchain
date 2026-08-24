-- Compilation : réinsère la bibliographie détachée à l'import, lui pose son titre, ancre
-- chaque référence et transforme les appels du corps en liens internes. Le texte des
-- références n'est jamais réécrit — seul un identifiant et des liens s'y ajoutent.
--
-- Trois temps :
--   1. la liste : la référence « ::: {.szh-biblio src="<slug>.biblio.md"} » que l'import a
--      laissée dans le .md est résolue — c'est le patron des tableaux — et le titre est
--      posé au-dessus, dans la langue de l'article et selon le réglage du poste
--      (TITRES_BIBLIO_DEFAUT, surchargé par config.json). Il n'est plus dans le texte :
--      c'est ce qui lui évite le numéro de section, et ce qui permet de le corriger sans
--      republier le logiciel. Chaque entrée reçoit un Div « szh-reference » portant un id
--      déduit de son contenu (ref-nom-annee), donc stable d'une compilation à l'autre.
--      Un article importé avant ce changement porte encore sa liste dans le corps : un
--      repli la retrouve sous son titre, et le dit.
--   2. les appels : « (Bovey, 2022) », « (vgl. Kunz, 2016) », « Capurso et al. (2025) »,
--      « (Grimminger et al., 2021; Fisseler, 2023) », « (Pelgrims, 2001, 2006) »… Seule la
--      parenthèse devient le lien ; la prose autour n'est pas touchée. Un appel narratif
--      met donc le lien sur l'année, comme le font les revues en ligne.
--   3. le rapport : chaque appel sans référence et chaque référence jamais appelée part sur
--      stderr, où le journal de compilation le montre au rédacteur — en constats codés, qui
--      NOMMENT leur article (voir « constats au rédacteur » plus bas). Avec SZH_APERCU=1,
--      les appels non liés reçoivent en plus la classe « szh-appel-orphelin », que
--      print.css souligne en pointillé dans l'aperçu seulement.
--
-- Un lien écrit à la main dans le .md (« [(Shaw et al., 2023)](#ref-shaw-2023) », ce que
-- pose l'action « Lier à une référence » du cockpit) est respecté tel quel ; s'il pointe
-- vers un ancrage inexistant, un avertissement le dit.
--
-- Doit tourner en DERNIER, après szh-sections.lua : le titre de bibliographie qu'il pose
-- ne doit pas recevoir de numéro de section, et une bibliographie n'en porte pas. Le repli
-- des articles anciens, lui, retrouve son titre malgré le numéro déjà collé devant : voir
-- texte_de_titre().

local utils = pandoc.utils

-- ---------------------------------------------------------------- texte et comparaison
local function assainir(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return t
end

local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function normaliser(t) return trim(assainir(t):gsub('%s+', ' ')) end

-- ---------------------------------------------------------------- constats au rédacteur
-- Une ligne, le format que le cockpit lit déjà pour l'import :
--
--   [citations-<ton>] <code> | article « <slug> » | <champ> | … | <fr> | [de] <de>
--
-- Le préfixe porte le TON, le deuxième champ un CODE stable, et l'article est NOMMÉ.
-- Deux défauts corrigés d'un coup : ces lignes n'étaient qu'en français, et le cockpit
-- devait reconnaître leurs phrases pour les redire en allemand ; elles ne disaient pas de
-- quel article elles parlaient, et le cockpit prenait celui de la ligne
-- « pandoc articles/<slug>/… » qui précédait — sous « make -j », celle d'un autre article.
-- La prose n'est plus qu'un repli d'affichage : elle se reformule sans rien casser.
--
-- slug_article() est le même que celui de szh-maquette.lua, cinq lignes recopiées. Deux
-- filtres pandoc ne partagent pas de module sans que le Makefile leur pose un chemin de
-- recherche, et celui-ci est en plus relu comme un fichier de données par lib/citations.js
-- du cockpit. Même arbitrage que la lecture de `lang:`, déjà notée comme dette.
local function slug_article()
  local fichiers = (PANDOC_STATE and PANDOC_STATE.input_files) or {}
  local chemin = fichiers[1]
  if type(chemin) ~= 'string' then return '' end
  return (chemin:gsub('.*[/\\]', ''):gsub('%.md$', ''))
end

-- « | » sépare les champs : un texte d'article qui en porte un couperait la ligne en deux
-- et emporterait la moitié allemande. Le seul endroit où cela peut venir du texte, c'est
-- l'appel et l'entrée de bibliographie recopiés dans un champ.
local function sans_barre(t) return (tostring(t):gsub('|', '/')) end

local function constat(ton, code, champs, fr, de)
  local morceaux = { '[citations-' .. ton .. '] ' .. code,
                     'article « ' .. slug_article() .. ' »' }
  for _, c in ipairs(champs) do morceaux[#morceaux + 1] = sans_barre(c) end
  morceaux[#morceaux + 1] = sans_barre(fr)
  morceaux[#morceaux + 1] = '[de] ' .. sans_barre(de)
  io.stderr:write(table.concat(morceaux, ' | ') .. '\n')
end

local function avertir(code, champs, fr, de) constat('avertissement', code, champs, fr, de) end

-- Repli des lettres latines sur leur base ASCII, en un seul endroit pour toute la chaîne :
-- lib/citations.js du cockpit relit ces tables ici plutôt que d'en tenir une copie. Deux
-- copies, c'étaient deux résultats — « Zieliński » donnait « zielinski » au cockpit et
-- « zieliski » à la compilation, et le lien posé à la main mourait dans le PDF.
--
-- Un jeton par point de code, dans l'ordre du bloc, séparés par des espaces : la base
-- ASCII (« ae », « ss », « oe » pour les ligatures) ou « - » pour un caractère qui n'est
-- pas une lettre. Les quatre blocs couvrent le latin entier, diacritiques polonais,
-- turcs, roumains, croates et lettons compris.
--
-- Les jetons viennent de la décomposition Unicode (NFD), complétée à la main pour les
-- lettres barrées qu'elle ne décompose pas : Đ, Ł, Ø, Ħ, Ŧ, Ð, Þ, ß, Æ, Œ. Un caractère
-- absent des blocs n'est pas remplacé par du vide en douce : il part sur stderr.
--
-- Refaire ou vérifier un jeton, sans autre outil que Node : la base ASCII d'un point de
-- code est sa décomposition NFD privée de ses marques combinantes, quand il n'en reste que
-- de l'ASCII.
--
--   node -e "const s=String.fromCodePoint(0x0144).normalize('NFD').replace(/\p{M}/gu,'');
--            console.log(/^[A-Za-z0-9]+$/.test(s) ? s.toLowerCase() : 'a poser a la main')"
--
-- Une quarantaine de lettres ne se décomposent pas et n'ont donc pas de base calculable :
-- leurs jetons sont posés à la main, une fois. Le contrôle, lui, est automatique :
-- test/js/ancrages.test.js replie des deux côtés tous les points de code des quatre blocs,
-- les marques combinantes et un échantillon non latin, puis compare. Un jeton faux ou
-- décalé s'y voit ; un bloc raccourci aussi, le cockpit refusant une table de moins de
-- 600 jetons.
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

-- Retirés sans un mot : espaces, ponctuation, marques combinantes, symboles. Aucun d'eux
-- ne porte d'identifiant, et les signaler noierait le journal de compilation.
local PLAGES_IGNOREES = {
  { 0x00A0, 0x00BF }, { 0x02B0, 0x02FF }, { 0x0300, 0x036F }, { 0x1AB0, 0x1AFF },
  { 0x1DC0, 0x1DFF }, { 0x2000, 0x206F }, { 0x2070, 0x209F }, { 0x20A0, 0x20D0 },
  { 0x2100, 0x214F }, { 0x2190, 0x2BFF }, { 0xFE00, 0xFE0F }, { 0x1F000, 0x1FAFF },
}

local REPLI = {}
for _, bloc in ipairs(REPLI_BLOCS) do
  local cp = bloc[1]
  for jeton in bloc[2]:gmatch('%S+') do
    -- « - » : retiré sans un mot. « ? » : hors table, donc signalé.
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

-- Un caractère hors des tables est retiré — mais jamais en silence. C'est ce silence qui
-- faisait « Şahin » devenir « ahin » ici et « sahin » au cockpit : l'ancre du PDF et le
-- lien du .md ne se rencontraient plus, et rien ne le disait.
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

-- Replie les lettres accentuées et laisse le reste tel quel : virgules, points et espaces
-- restent en place, ce dont noms_de() a besoin pour découper une en-tête.
--
-- ⚠ Décodage UTF-8 à la main, et non utf8.codes : celui-ci lève sur un octet isolé, et un
-- .md relu d'un docx en porte parfois un. Ici l'octet fautif est simplement retiré.
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
  'referencesbibliographiques',
}

-- Le titre que la compilation POSE au-dessus de la bibliographie détachée, par revue et par
-- langue d'article. Ce sont les valeurs par défaut : le config.json du poste les surcharge
-- clé par clé, et le bloc « Bibliographie » des Réglages SZH les modifie sans republier
-- l'extension.
--
-- D'où viennent ces valeurs : du corpus des 421 galleys publiés. La Zeitschrift écrit
-- « Literatur » dans ses 230 articles à bibliographie, sans une exception. La Revue écrit
-- « Références » 69 fois sur 73, « Références bibliographiques » 3 fois, et « Bibliografia »
-- une fois — pour son seul article italien. Aucun article n'a jamais porté le titre de
-- l'autre langue : c'est la langue qui décide, et les deux revues partent donc du même jeu.
--
-- ⚠ lib/citations.js du cockpit RELIT cette table ici, comme il relit le lexique et les
--   tables de repli : deux copies, ce seraient deux titres.
local TITRES_BIBLIO_DEFAUT = {
  revue       = { fr = [[Références]], de = [[Literatur]], it = [[Bibliografia]] },
  zeitschrift = { fr = [[Références]], de = [[Literatur]], it = [[Bibliografia]] },
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

-- Titre de bibliographie : comparaison EXACTE sur la forme aplatie, jamais par préfixe.
-- Le préfixe faisait de « Literaturhinweise für die Praxis » un titre de bibliographie, et
-- tout ce qui suivait — de la prose — cessait d'être regardé : le défaut était invisible.
-- Le lexique porte donc les formes complètes que la maison écrit ; les trois relevées sur
-- le corpus des 421 galleys y sont (« Références » 69 fois, « Références bibliographiques »
-- 3, « Literatur » 230).
--
-- Un titre déjà numéroté par szh-sections.lua porte son numéro dans un Span de tête :
-- texte_de_titre() l'écarte avant de comparer. Sans cela, « 6 Références » ne serait plus
-- reconnu, et ce filtre tournant maintenant APRÈS szh-sections, plus rien ne le serait.
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
  -- ⚠ Replier les accents AVANT de découper. Les motifs Lua comptent les octets : sur le
  -- texte d'origine, « Weiß » se coupait en « Wei » puis « ß », et « Schröttle » en
  -- « Schr » puis « öttle » — le nom relevé ne correspondait alors plus à celui de l'appel,
  -- et la référence passait pour introuvable.
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

-- Nom qui nomme l'identifiant. Volontairement bête : on replie les accents et les
-- ligatures, puis on prend le premier mot de deux lettres au moins. Aucune détection de
-- majuscule n'entre ici, ce qui permet à lib/citations.js du cockpit de calculer le même
-- identifiant en JavaScript — sans quoi le lien posé à la main pointerait dans le vide.
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

-- Point d'entrée de test : test/js/ancrages.test.js charge ce fichier par dofile et
-- exécute ces fonctions sur les mêmes entrées que lib/citations.js du cockpit, puis compare
-- les résultats. Comparer les deux sources par expression régulière ne prouvait rien du
-- résultat : c'est ainsi que l'écart de repli a pu vivre.
SZH_CITATIONS = {
  replier = replier, plat = plat, nom_pour_id = nom_pour_id,
  est_titre_bib = est_titre_bib, est_continuation = est_continuation,
}

-- ------------------------------------------------ le titre de la bibliographie, réglable
-- La bibliographie n'a plus de titre dans le texte : l'import l'a retiré, la compilation le
-- pose. Il vient du config.json du poste — le même fichier que l'emplacement des revues et
-- la configuration OJS — et retombe sur TITRES_BIBLIO_DEFAUT clé par clé.
--
-- Pourquoi lire le fichier ici plutôt que le recevoir en variable d'environnement : le
-- cockpit lance la compilation par wsl.exe, qui ne transmet pas l'environnement de Windows
-- sans WSLENV. Le fichier, lui, est monté et se lit. SZH_CONFIG impose un chemin, ce dont
-- le banc d'essai se sert pour éprouver le réglage sans écrire dans C:\ProgramData.
local CONFIG_POSTE = '/mnt/c/ProgramData/SZH/config.json'

-- Lecteur JSON minimal : objets, tableaux, chaînes, nombres, booléens, null. Sur du JSON
-- mal formé, rend nil — et les valeurs par défaut jouent. Écrit ici parce qu'un filtre
-- pandoc n'a pas de chemin de recherche de modules (même arbitrage que slug_article).
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

-- Jeton de revue, lu dans les métadonnées : ausgabe.yaml est le seul des deux fichiers de
-- métadonnées à porter `revue`, la fusion de pandoc ne prête donc pas à confusion.
local function jeton_revue(meta)
  local v = utils.stringify(meta and meta.revue or ''):lower()
  if v:find('zeitschrift') then return 'zeitschrift' end
  return 'revue'
end

-- Langue de composition de l'article, dans l'ordre où szh-maquette.lua l'établit : la fiche
-- d'abord, la revue ensuite. La fiche est relue au lieu d'être prise dans les métadonnées
-- fusionnées, qui ne disent pas de quel fichier une clé vient — même arbitrage, et même
-- dette, que szh-maquette.
local function langue_article(slug, revue)
  if slug ~= '' then
    local f = io.open(slug .. '.meta.yaml', 'r')
    if f then
      for ligne in f:lines() do
        local v = ligne:match('^lang:%s*(.*)$')
        if v then
          v = trim(v:gsub('^["\']', ''):gsub('["\']%s*$', '')):lower():sub(1, 2)
          f:close()
          if v ~= '' then return v end
          break
        end
      end
      if f then f:close() end
    end
  end
  return (revue == 'zeitschrift') and 'de' or 'fr'
end

-- « Références bibliographiques » en inlines pandoc : un Str par mot, un Space entre. Un
-- seul Str contenant une espace se rend juste en HTML mais n'est pas un document pandoc
-- valide, et les autres écritures — le galley DOCX, par exemple — ne le promettent pas.
local function inlines_du_titre(titre)
  local out = pandoc.List()
  for mot in titre:gmatch('%S+') do
    if #out > 0 then out:insert(pandoc.Space()) end
    out:insert(pandoc.Str(mot))
  end
  return pandoc.Inlines(out)
end

local function titre_bibliographie(meta, slug)
  local revue = jeton_revue(meta)
  local lang = langue_article(slug, revue)
  local defauts = TITRES_BIBLIO_DEFAUT[revue] or TITRES_BIBLIO_DEFAUT.revue
  local titre = defauts[lang] or defauts.fr
  local cfg = lire_config_poste()
  local pose = cfg and cfg.biblio and cfg.biblio.titres
  pose = pose and pose[revue]
  pose = pose and pose[lang]
  -- « La clé présente gagne, même vide » : c'est la règle de la configuration OJS, et vider
  -- le champ dans les Réglages doit avoir un effet — ici, pas de titre du tout.
  if type(pose) == 'string' then titre = pose end
  return normaliser(titre)
end

-- Rang du titre de bibliographie : le premier rang de section, celui que szh-niveaux.lua
-- vise (MIN_CIBLE), le <h1> étant le titre de l'article sur la couverture.
local NIVEAU_BIB = 2

-- Texte d'un titre, numéro de section exclu. szh-sections.lua pose le numéro dans un Span
-- de classe « szh-num-section » en tête du contenu : le lire comme du texte ferait de
-- « 6 Références » un titre inconnu.
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

-- --------------------------------------------- la bibliographie détachée, réinsérée
-- Même contrat que szh-tabelle-inclure.lua : le cwd est le dossier de l'article, les
-- chemins relatifs tombent donc juste, et un fichier manquant donne un bloc
-- d'avertissement VISIBLE dans le rendu — jamais un article amputé en silence.
-- Deux classes, et la seconde n'est pas un oubli : « szh-tabelle-manquante » est l'encadré
-- rouge que print.css donne déjà à « fichier référencé introuvable », et c'est exactement
-- ce cas-ci. Son nom parle de tableau parce qu'il n'y avait alors que des tableaux à
-- inclure ; « szh-biblio-manquante » est le nom juste, et il attend que print.css — tenu
-- par un autre chantier — joigne les deux sélecteurs sur la même règle.
local function bloc_manquant(texte)
  return pandoc.Div(
    { pandoc.Para({ pandoc.Strong({ pandoc.Str('⚠ ' .. texte) }) }) },
    pandoc.Attr('', { 'szh-biblio-manquante', 'szh-tabelle-manquante' }, {})
  )
end

-- Rend (blocs, première entrée, dernière entrée) : la référence de bibliographie est
-- remplacée par le titre — posé ici, dans la langue de l'article — puis par les entrées du
-- fichier. Sans référence dans le document, les blocs sortent tels quels et la liste est
-- nil : c'est l'appelant qui décide alors du repli.
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
          'Bibliographie introuvable : ' .. (src ~= '' and src or '(aucun fichier indiqué)')
          .. ' (fichier supprimé ou renommé ?)'))
        avertir('biblio-introuvable', { 'fichier « ' .. src .. ' »' },
          'Le fichier de bibliographie de cet article est introuvable : la liste de '
          .. "références manque au document. Réimportez l'article, ou retirez la référence "
          .. 'de bibliographie du texte.',
          'Die Literaturverzeichnis-Datei dieses Artikels fehlt: die Literaturliste fehlt '
          .. 'im Dokument. Importieren Sie den Artikel neu, oder entfernen Sie den Verweis '
          .. 'auf das Literaturverzeichnis aus dem Text.')
      else
        local entrees = pandoc.read(contenu, 'markdown').blocks
        if #entrees > 0 then
          local titre = titre_bibliographie(doc.meta, slug)
          if titre ~= '' then
            -- Identifiant fixe et préfixé : le lecteur markdown en pose un sur les titres
            -- du corps, pas sur celui-ci, qui n'est pas dans le texte. « szh- » le met hors
            -- de portée d'un titre de section homonyme.
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

function Pandoc(doc)
  -- 1. la liste de références
  --
  -- Voie normale : l'import l'a détachée dans <slug>.biblio.md et a laissé une référence
  -- « ::: {.szh-biblio src=…} » à sa place. On la résout ici — c'est le patron des
  -- tableaux — et on pose le titre, que le texte ne porte plus.
  local slug = slug_article()
  local blocs, premiere, derniere_liste = resoudre_biblio(doc, slug)

  -- Repli, et nommé comme tel : un article importé avant que la bibliographie devienne un
  -- fichier porte encore sa liste dans le corps. On la retrouve sous son titre, comparé
  -- EXACTEMENT au lexique — plus par préfixe, et plus d'heuristique qui balayait la
  -- seconde moitié du document pour y deviner une liste. Ces deux paris coûtaient cher :
  -- une section « Literaturhinweise für die Praxis » suivie de prose, et tout ce qui
  -- suivait cessait d'être regardé pour les appels, sans le moindre signe.
  if not premiere then
    local idx_titre = nil
    for i, b in ipairs(blocs) do
      if b.t == 'Header' and est_titre_bib(texte_de_titre(b)) then idx_titre = i end
    end
    if idx_titre then
      premiere, derniere_liste = idx_titre + 1, #blocs
      -- constat() nomme déjà l'article : ne pas le répéter dans les champs.
      avertir('biblio-dans-le-corps', {},
        "La bibliographie de cet article est encore dans le texte : elle n'a pas de "
        .. "fichier à part, et l'export vers la plateforme partira sans liste de "
        .. "références. Réimportez l'article pour la mettre à part.",
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

  -- 2. les appels, dans tout ce qui n'est pas la liste — avant elle, et après elle. La
  -- liste n'est plus forcément le dernier bloc du document : une référence restée dans le
  -- texte, une note de fin, une annexe peuvent la suivre, et leurs appels comptent.
  local limite = premiere and (premiere - 1) or #blocs
  local reprise = (premiere and derniere_liste) and (derniere_liste + 1) or (#blocs + 1)
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
          avertir('ancrage-inconnu', { 'ancrage « ' .. il.target .. ' »' },
            'Lien manuel vers un ancrage inconnu : ' .. il.target .. '.',
            'Manuelle Verknüpfung auf eine unbekannte Textmarke: ' .. il.target .. '.')
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
  -- Le bilan est un chiffre, pas une plainte : ton « info ». Le cockpit ne le montre que
  -- s'il reste quelque chose à lier.
  local lies = appels - #orphelins - #ambigus
  constat('info', 'bilan',
    { 'references ' .. #fiches, 'appels ' .. appels, 'lies ' .. lies,
      'ambigus ' .. #ambigus, 'sansref ' .. #orphelins },
    string.format('%d référence(s), %d appel(s) : %d lié(s), %d ambigu(s), %d sans référence.',
      #fiches, appels, lies, #ambigus, #orphelins),
    string.format('%d Eintrag/Einträge, %d Verweis(e): %d verknüpft, %d mehrdeutig, %d ohne Eintrag.',
      #fiches, appels, lies, #ambigus, #orphelins))
  for _, o in ipairs(orphelins) do
    avertir('appel-sans-reference', { 'appel « ' .. o .. ' »' },
      'Appel sans référence : ' .. o .. '.',
      'Zitatverweis ohne Eintrag im Verzeichnis: ' .. o .. '.')
  end
  for _, a in ipairs(ambigus) do
    avertir('appel-ambigu', { 'appel « ' .. a .. ' »' },
      'Appel ambigu, à lier à la main : ' .. a .. '.',
      'Mehrdeutiger Zitatverweis, von Hand zu verknüpfen: ' .. a .. '.')
  end
  for _, j in ipairs(jamais) do
    avertir('reference-orpheline', { 'reference « ' .. j .. '… »' },
      'Référence jamais appelée : ' .. j .. '…',
      'Nie zitierter Eintrag: ' .. j .. '…')
  end
  return doc
end
