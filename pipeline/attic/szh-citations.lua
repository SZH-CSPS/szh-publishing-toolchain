-- szh-citations.lua — passe B de l'import (D29) : convertit les citations du texte
-- en citations pandoc/citeproc ([@clé]) à partir du .bib produit par AnyStyle.
--
-- Formes gérées (fondées sur les 6 articles réels) :
--   (Bovey et al., 2025) · (Ebersold & Detraux, 2013) · (Cook et Friend, 1995)
--   (Ayer, 2021; Réseau Études et handicap Suisse, 2019) · (Pelgrims, 2011, 2016)
--   (Assude & Millon-Fauré, 2021, p. 62) · (CDIP, 2007) · [UNESCO, 1994]
--   (Linder et al., sous presse) · (Chanier, en préparation) · 2007a
--   narratives : Gremion et Carron (2023) -> @cle
-- Les organisations sont indexées depuis les LIGNES BRUTES (SZH_REFS), car AnyStyle
-- perd les sigles [OMS] / (CDIP) — l'ordre des lignes = l'ordre des entrées bib.
-- Non résolu -> laissé tel quel + listé au rapport (SZH_STATS).
-- Environnement : SZH_BIB, SZH_REFS, SZH_LANG, SZH_STATS.

local utils = pandoc.utils
local function s(x) return utils.stringify(x) end
local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end

-- ---------- normalisation (insensible accents/casse, « Fauré » ≡ « Faure ») ----------
local TRANSLIT = {
  ['à']='a',['â']='a',['ä']='a',['á']='a',['ã']='a',['å']='a',
  ['é']='e',['è']='e',['ê']='e',['ë']='e',
  ['î']='i',['ï']='i',['í']='i',['ì']='i',
  ['ô']='o',['ö']='o',['ó']='o',['ò']='o',['õ']='o',['ø']='o',
  ['û']='u',['ü']='u',['ú']='u',['ù']='u',
  ['ç']='c',['ñ']='n',['ß']='ss',['œ']='oe',['æ']='ae',
  ['À']='a',['Â']='a',['Ä']='a',['Á']='a',
  ['É']='e',['È']='e',['Ê']='e',['Ë']='e',
  ['Î']='i',['Ï']='i',['Ô']='o',['Ö']='o',['Û']='u',['Ü']='u',['Ù']='u',['Ç']='c',
}
local function norm(txt)
  txt = txt:lower()
  for a, b in pairs(TRANSLIT) do txt = txt:gsub(a, b) end
  return (txt:gsub('[^a-z0-9]', ''))
end

-- espaces spéciaux -> espace simple ; tirets spéciaux -> '-'
local function assainir(txt)
  txt = txt:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  txt = txt:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return txt
end

local ANNEES_SPECIALES = {
  ['souspresse'] = true, ['enpreparation'] = true, ['inpress'] = true,
  ['imdruck'] = true, ['adosser'] = false, ['sousevaluation'] = true, ['apparaitre'] = true,
}
local function norm_annee(a)
  a = trim(a)
  local n = a:match('^[12][09]%d%d[a-z]?$')
  if n then return n end
  local k = norm(a)
  if ANNEES_SPECIALES[k] then return k end
  return nil
end

-- ---------- chargement du bib + des lignes brutes ----------
local index = {}          -- nom_norm -> { annee -> id, ['*'] = id si unique }
local prefixes = {}       -- liste { norm=, annees={a->id}, id= } pour match par préfixe (orgs)
local charge = false

local function indexer(nom, annee, id)
  if nom == '' then return end
  index[nom] = index[nom] or {}
  if annee then
    if not index[nom][annee] then index[nom][annee] = id end
    -- tolérance suffixe : 2007a indexé aussi sous 2007 (si libre)
    local base = annee:match('^([12][09]%d%d)[a-z]$')
    if base and not index[nom][base] then index[nom][base] = id end
  end
  if index[nom]['*'] == nil then index[nom]['*'] = id
  elseif index[nom]['*'] ~= id then index[nom]['*'] = false end  -- ambigu
end

local function charger()
  if charge then return end
  charge = true
  local bib = os.getenv('SZH_BIB')
  if not bib or bib == '' then return end
  local fb = io.open(bib, 'r')
  if not fb then return end
  fb:close()

  -- utils.references ne retourne que les entrées CITÉES : un nocite @* charge tout.
  local tout = pandoc.Cite(pandoc.Inlines({ pandoc.Str('[@*]') }),
                           { pandoc.Citation('*', 'NormalCitation') })
  local doc = pandoc.Pandoc({}, pandoc.Meta({
    bibliography = pandoc.MetaString(bib),
    nocite = pandoc.MetaInlines(pandoc.Inlines({ tout })),
  }))
  local ok, refs = pcall(utils.references, doc)
  if not ok or not refs then return end

  -- lignes brutes (même ordre que les entrées bib)
  local brutes = {}
  local chemin = os.getenv('SZH_REFS')
  if chemin then
    local f = io.open(chemin, 'r')
    if f then
      for ligne in f:lines() do brutes[#brutes + 1] = ligne end
      f:close()
    end
  end

  for i, ref in ipairs(refs) do
    local id = ref.id
    local annee = nil
    if ref.issued and ref.issued['date-parts'] and ref.issued['date-parts'][1] then
      annee = tostring(ref.issued['date-parts'][1][1])
    elseif ref.issued and ref.issued.literal then
      annee = norm_annee(s(ref.issued.literal))
    end
    local brute = brutes[i] and assainir(brutes[i]) or ''
    -- année depuis la ligne brute (récupère les 2007a et « sous presse » perdus)
    if brute ~= '' then
      local ab = brute:match('%(([12][09]%d%d[a-z]?)%)') or brute:match('[%s,]([12][09]%d%d[a-z]?)[%).,]')
      local aspec = brute:lower():match('(sous presse)') or brute:lower():match('(en préparation)')
          or brute:lower():match('(in press)')
      if ab then annee = annee or ab
        if ab ~= annee then indexer(norm(''), nil, nil) end
      end
      if not annee and aspec then annee = norm(aspec) end
      if ab and annee and ab:match('^' .. annee .. '%a$') then annee = ab end
    end

    -- 1) familles d'auteurs (premier auteur = clé de citation)
    if ref.author and ref.author[1] then
      local a1 = ref.author[1]
      if a1.family then indexer(norm(s(a1.family)), annee, id) end
      if a1.literal then
        local lit = s(a1.literal)
        indexer(norm(lit), annee, id)
        prefixes[#prefixes + 1] = { norm = norm(lit), annee = annee, id = id }
      end
    end
    -- 2) depuis la ligne brute : sigles [XXX] / (XXX) / nus, et intitulé d'organisation
    if brute ~= '' then
      -- toutes les années présentes dans la brute (même collées : « 2014RS 0.109 »)
      local annees_brutes = {}
      for ab in brute:gmatch('([12][09]%d%d)') do annees_brutes[ab] = true end
      for sigle in brute:gmatch('%[(%u[%u%d]+)%]') do indexer(norm(sigle), annee, id) end
      local avant = brute:match('^(.-)%s*%(?[12][09]%d%d')
      if avant then
        for sigle in avant:gmatch('%((%u[%u%d]+)%)') do indexer(norm(sigle), annee, id) end
        avant = avant:gsub('%[.-%]', ''):gsub('%(.-%)', '')
        avant = trim(avant:gsub('[%.,]%s*$', ''))
        -- sigle nu en tête d'entrée : « CDIP (2007). Accord… »
        if avant:match('^%u[%u%d]+$') then indexer(norm(avant), annee, id) end
        -- intitulé complet (organisations, textes de loi) si assez long
        if #avant >= 12 and not avant:match('^%u[%a\'’%-]+,') then
          local n = norm(avant)
          indexer(n, annee, id)
          prefixes[#prefixes + 1] = { norm = n, annee = annee, annees = annees_brutes, id = id }
        end
      end
    end
  end
end

local function lookup(nom, annee)
  if nom == '' then return nil end
  local e = index[nom]
  if e then
    if annee and e[annee] then return e[annee] end
    if annee then
      local base = annee:match('^([12][09]%d%d)[a-z]$')
      if base and e[base] then return e[base] end
      if e[annee .. 'a'] then return e[annee .. 'a'] end
    end
    return nil
  end
  -- match par préfixe pour les intitulés longs (Convention relative aux droits…)
  if #nom >= 12 then
    for _, p in ipairs(prefixes) do
      if (p.norm:sub(1, #nom) == nom or nom:sub(1, #p.norm) == p.norm)
         and (annee == nil or p.annee == annee or p.annee == nil
              or (p.annees and annee and p.annees[annee:match('^%d+')])) then
        return p.id
      end
    end
  end
  return nil
end

-- ---------- analyse d'un groupe « ( … ) » ----------
local PREFIXES_OK = {
  'cf%.?%s+', 'voir aussi%s+', 'voir%s+', 'vgl%.?%s+', 'see%s+', 'notamment%s+',
  'p%.%s*ex%.%s+', 'z%.%s*B%.%s+', 'd\'après%s+', 'selon%s+', 'dans%s+', 'in%s+',
}

-- retourne liste de pandoc.Citation, ou nil + texte d'échec
local function parser_groupe(txt)
  txt = assainir(txt)
  local citations = {}
  for seg in (txt .. ';'):gmatch('(.-);') do
    seg = trim(seg)
    if seg == '' then return nil end
    local prefixe = ''
    for _, motif in ipairs(PREFIXES_OK) do
      local m = seg:match('^(' .. motif .. ')')
      if m then prefixe = m; seg = trim(seg:sub(#m + 1)); break end
    end
    -- séparer auteurs / années / locator
    local auteurs, reste = seg:match('^(.-)[,%s]+([12][09]%d%d.*)$')
    if not auteurs then
      auteurs, reste = seg:match('^(.-)[,%s]+(sous presse.*)$')
    end
    if not auteurs then
      auteurs, reste = seg:match('^(.-)[,%s]+(en préparation.*)$')
    end
    if not auteurs then
      auteurs, reste = seg:match('^(.-)[,%s]+(in press.*)$')
    end
    if not auteurs or trim(auteurs) == '' then return nil end
    auteurs = trim(auteurs):gsub(',$', '')
    -- premier auteur : couper « et al. », puis &/et/und/and/virgule
    local premier = auteurs
    premier = premier:gsub('%s+et%s+al%.?,?.*$', '')
    premier = premier:match('^(.-)%s*&.*$') or premier
    premier = premier:match('^(.-)%s+et%s+%u.*$') or premier
    premier = premier:match('^(.-)%s+und%s+%u.*$') or premier
    premier = premier:match('^(.-)%s+and%s+%u.*$') or premier
    premier = premier:match('^(.-),%s*%u%.?.*$') or premier
    premier = trim(premier)
    -- si « Nom, X. » ne garder que le nom de famille
    local nom = norm(premier)
    -- années (éventuellement multiples : 2011, 2016) puis locator
    local annees, locator = {}, nil
    local courant = reste
    while courant and courant ~= '' do
      courant = trim(courant:gsub('^[,%s]+', ''))
      local a = courant:match('^([12][09]%d%d[a-z]?)')
      local aspec = courant:match('^(sous presse)') or courant:match('^(en préparation)')
          or courant:match('^(in press)')
      if a then
        annees[#annees + 1] = a
        courant = courant:sub(#a + 1)
      elseif aspec then
        annees[#annees + 1] = norm(aspec)
        courant = courant:sub(#aspec + 1)
      elseif courant:match('^p?p%.') or courant:match('^S%.') or courant:match('^§') then
        locator = trim(courant)
        courant = ''
      elseif courant == '' then
        break
      else
        return nil, seg   -- résidu inconnu -> on ne touche pas au groupe
      end
    end
    if #annees == 0 then return nil, seg end
    for ia, a in ipairs(annees) do
      local id = lookup(nom, a)
      if not id then return nil, seg end
      local cit = pandoc.Citation(id, 'NormalCitation')
      if ia == 1 and prefixe ~= '' then
        cit.prefix = pandoc.Inlines({ pandoc.Str(trim(prefixe)) })
      end
      if ia == #annees and locator then
        cit.suffix = pandoc.Inlines({ pandoc.Str(', ' .. locator) })
      end
      citations[#citations + 1] = cit
    end
  end
  if #citations == 0 then return nil end
  return citations
end

-- ---------- remplacement dans les suites d'inlines ----------
local stats_citations = { liees = 0, narratives = 0, non_resolues = {} }

local function contient_annee(txt)
  return txt:match('[12][09]%d%d') or txt:lower():match('sous presse')
      or txt:lower():match('en préparation') or txt:lower():match('in press')
end

-- Pré-passe : isole chaque ( ) [ ] dans son propre Str. La ponctuation collée
-- (« 2007). ») et les groupes soudés par un espace insécable deviennent analysables,
-- sans changer le rendu (les Str adjacents se concatènent à l'écriture).
local function eclater_delimiteurs(inls)
  local res = pandoc.List()
  for _, x in ipairs(inls) do
    if x.t == 'Str' and x.text:match('[%(%)%[%]]') and #x.text > 1 then
      local courant = ''
      for uch in x.text:gmatch('[%z\1-\127\194-\244][\128-\191]*') do
        if uch == '(' or uch == ')' or uch == '[' or uch == ']' then
          if courant ~= '' then res:insert(pandoc.Str(courant)); courant = '' end
          res:insert(pandoc.Str(uch))
        else
          courant = courant .. uch
        end
      end
      if courant ~= '' then res:insert(pandoc.Str(courant)) end
    else
      res:insert(x)
    end
  end
  return res
end

-- Le groupe ne contient que des années (+ locator) ? -> candidate narrative « Nom (2020) »
local function annees_seules(txt)
  txt = trim(assainir(txt))
  return txt:match('^[12][09]%d%d[a-z]?[%d%s,;]*$') ~= nil
      or txt:lower():match('^sous presse$') or txt:lower():match('^en préparation$')
      or txt:match('^[12][09]%d%d[a-z]?%s*,%s*p?p?%.?%s*[%d%-, ]*$') ~= nil
end

-- Cherche le nom d'auteur juste avant la parenthèse dans les tokens déjà émis.
-- Retourne nom_normalisé + nombre d'inlines à retirer de res, ou nil.
local function nom_precedent(res)
  local mots, idx = {}, #res
  while idx >= 1 and #mots < 6 do
    local x = res[idx]
    if x.t == 'Space' or x.t == 'SoftBreak' then idx = idx - 1
    elseif x.t == 'Str' then
      table.insert(mots, 1, { texte = x.text, pos = idx })
      idx = idx - 1
      local premier = mots[1].texte
      -- « Nom » / « Nom et Nom2 » / « Nom et al. » complet ?
      if premier:match('^%u') then break end
      if #mots >= 6 then return nil end
    else
      return nil
    end
  end
  if #mots == 0 then return nil end
  local premier = mots[1].texte
  if not premier:match('^%u[%a\'’%-]+$') then return nil end
  -- rejeter si ponctuation de fin de phrase juste avant le nom (début de phrase ≠ auteur… on tente quand même le lookup)
  local nb = #res - mots[1].pos + 1
  return norm(premier), nb
end

local function traiter_inlines(inls)
  charger()
  inls = eclater_delimiteurs(inls)
  local res = pandoc.List()
  local i = 1
  local n = #inls
  while i <= n do
    local x = inls[i]
    local delim = nil
    if x.t == 'Str' then
      if x.text == '(' then delim = ')' elseif x.text == '[' then delim = ']' end
    end
    if delim then
      -- fermeture correspondante (profondeur sur tokens purs, fenêtre bornée)
      local prof, fin = 0, nil
      for j = i, math.min(n, i + 80) do
        local y = inls[j]
        if y.t == 'Str' then
          if y.text == x.text then prof = prof + 1
          elseif y.text == delim then
            prof = prof - 1
            if prof == 0 then fin = j; break end
          end
        end
      end
      if fin then
        local groupe = pandoc.List()
        for k = i, fin do groupe:insert(inls[k]) end
        local txt = s(pandoc.Inlines(groupe))
        local interieur = trim(txt:sub(2, -2))
        if contient_annee(interieur) then
          local citations = parser_groupe(interieur)
          if citations then
            res:insert(pandoc.Cite(pandoc.Inlines(groupe), citations))
            stats_citations.liees = stats_citations.liees + #citations
            i = fin + 1
            goto continue
          elseif annees_seules(interieur) then
            -- narrative : « Rawls (1971) » / « Gremion et Carron (2023) »
            local nom, nb = nom_precedent(res)
            if nom then
              local annee = interieur:match('^([12][09]%d%d[a-z]?)') or norm(interieur)
              local locator = interieur:match(',%s*(p?p?%.?%s*[%d%-, ]+)$')
              local id = lookup(nom, annee)
              if id then
                for _ = 1, nb do res:remove(#res) end
                local cit = pandoc.Citation(id, 'AuthorInText')
                if locator then cit.suffix = pandoc.Inlines({ pandoc.Str(', ' .. trim(locator)) }) end
                res:insert(pandoc.Cite(pandoc.Inlines(groupe), { cit }))
                stats_citations.liees = stats_citations.liees + 1
                stats_citations.narratives = stats_citations.narratives + 1
                i = fin + 1
                goto continue
              end
            end
          else
            stats_citations.non_resolues[#stats_citations.non_resolues + 1] = txt
          end
        end
      end
    end
    res:insert(x)
    i = i + 1
    ::continue::
  end
  return res
end

-- ---------- filtre ----------
function Pandoc(doc)
  charger()
  doc = doc:walk({ Inlines = traiter_inlines })

  -- métadonnées : bibliographie + titre de section selon la langue
  local bib = os.getenv('SZH_BIB')
  if bib and bib ~= '' then
    local f = io.open(bib, 'r')
    if f then
      f:close()
      doc.meta.bibliography = pandoc.MetaString(bib)
      doc.meta['link-citations'] = pandoc.MetaBool(true)
      if not doc.meta['reference-section-title'] then
        local lang = (os.getenv('SZH_LANG') or 'fr'):sub(1, 2)
        local titres = { fr = 'Bibliographie', de = 'Literatur', en = 'References' }
        doc.meta['reference-section-title'] = pandoc.MetaString(titres[lang] or titres.fr)
      end
    end
  end

  -- enrichir le JSON de rapport
  local chemin = os.getenv('SZH_STATS')
  if chemin then
    local f = io.open(chemin, 'r')
    local donnees = {}
    if f then
      local ok, d = pcall(pandoc.json.decode, f:read('*a'))
      if ok and type(d) == 'table' then donnees = d end
      f:close()
    end
    donnees.citations = stats_citations
    local g = io.open(chemin, 'w')
    if g then
      g:write(pandoc.json.encode(donnees))
      g:close()
    end
  end
  return doc
end
