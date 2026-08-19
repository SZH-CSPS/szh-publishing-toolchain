-- szh-biblio.lua — import (F6/WS-D, ravive le §5 d'attic/szh-import.lua).
-- Détecte la liste de références en fin de corps, la RETIRE du .md et écrit les
-- entrées brutes dans $SZH_REFS (une par ligne) ; import-docx.sh les donne ensuite
-- à AnyStyle (-> media/<slug>.bib) et, si AnyStyle échoue, RELANCE pandoc sans ce
-- filtre : la liste reste alors dans le .md — jamais de perte.
--
-- Deux voies, PAR STYLE D'ABORD :
--   1. lignes B de $SZH_META (paragraphes stylés Literaturverzeichnis/Bibliography,
--      relevés par docx-meta.py dans le XML — pandoc perd ce style) : retrait exact,
--      file de consommation, continuations recollées à l'entrée précédente ;
--   2. sinon, heuristique CONTENU + POSITION du §5 (est_ref : >= 25 car., année ou
--      « sous presse », motif « Nom, X. » ou URL ; remontée depuis la fin avec
--      continuations, sauts de Table/Figure/image ; seuil >= 3 entrées, moitié basse
--      du document).
-- Le TITRE de section (« Literatur », « Bibliographie »…) est CONSERVÉ : à la
-- compilation, citeproc replace la bibliographie générée en fin de document, juste
-- sous ce titre. Y<TAB>documentation dans $SZH_META -> filtre inactif (la liste de
-- références EST le contenu de ces articles). Sans $SZH_REFS : document inchangé.
-- DOIT tourner APRÈS szh-titres (les titres promus sont des Header) et AVANT
-- szh-tabelle-reference (les Table sont encore des Table).

local utils = pandoc.utils

local function assainir(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return t
end
local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function s(x) return assainir(utils.stringify(x)) end
-- normalisation IDENTIQUE à docx-meta.py (appariement des lignes B).
local function normaliser(t)
  return (assainir(t):gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', ''))
end

-- ---------- instructions de docx-meta.py ($SZH_META) ----------
local function charger_meta()
  local type_article, blignes = 'article', {}
  local chemin = os.getenv('SZH_META')
  if not chemin or chemin == '' then return type_article, blignes end
  local f = io.open(chemin, 'r')
  if not f then return type_article, blignes end
  for ligne in f:lines() do
    local lettre, valeur = ligne:match('^(%u)\t(.*)$')
    if lettre == 'Y' then type_article = valeur
    elseif lettre == 'B' then
      local clef = normaliser(valeur)
      if clef ~= '' then blignes[#blignes + 1] = clef end
    end
  end
  f:close()
  return type_article, blignes
end

-- ---------- prédicats du §5 (attic/szh-import.lua l.211-221, à l'identique) ------
local function est_ref(txt)
  if #txt < 25 then return false end
  if txt:match('^https?://') then return true end
  local annee = txt:match('[%(%,%s][12][09]%d%d[a-z]?[%)%.,;%s]')
  local special = txt:find('sous presse', 1, true) or txt:find('en préparation', 1, true)
      or txt:find('in press', 1, true) or txt:find('im Druck', 1, true)
  if not (annee or special) then return false end
  -- au moins un motif « Nom, X. » ou une initiale « X. » ou une URL
  return txt:match('%u%.') ~= nil or txt:match('^%u[%a\'’%-]+,') ~= nil
      or txt:match('https?://') ~= nil
end

local function bloc_image(b)
  if b.t ~= 'Para' and b.t ~= 'Plain' then return false end
  local image = false
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then image = true
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then return false end
  end
  return image
end

-- Nouvelle entrée (vs continuation) : commence par une majuscule, un guillemet
-- ouvrant ou un chiffre (lois) — sinon elle recolle à l'entrée précédente.
local function debut_entree(txt)
  return txt:match('^[%u«"“%d]') ~= nil
end

local function ecrire_refs(entrees)
  local chemin = os.getenv('SZH_REFS')
  if not chemin or chemin == '' then return false end
  local f = io.open(chemin, 'w')
  if not f then return false end
  for _, e in ipairs(entrees) do f:write(e, '\n') end
  f:close()
  return true
end

-- ---------- voie 1 : retrait des paragraphes stylés (lignes B) ----------
local function retirer_par_style(doc, blignes)
  local attendus = {}
  for _, clef in ipairs(blignes) do attendus[clef] = (attendus[clef] or 0) + 1 end
  local garde = pandoc.List()
  local entrees = {}
  for _, b in ipairs(doc.blocks) do
    local retire = false
    if b.t == 'Para' or b.t == 'Plain' then
      local clef = normaliser(utils.stringify(b))
      if clef ~= '' and attendus[clef] and attendus[clef] > 0 then
        attendus[clef] = attendus[clef] - 1
        retire = true
        if debut_entree(clef) or #entrees == 0 then
          entrees[#entrees + 1] = clef
        else
          entrees[#entrees] = entrees[#entrees] .. ' ' .. clef
        end
      end
    end
    if not retire then garde:insert(b) end
  end
  if #entrees == 0 then return doc, 0 end
  doc.blocks = garde
  ecrire_refs(entrees)
  return doc, #entrees
end

-- ---------- voie 2 : heuristique contenu + position (§5) ----------
local function retirer_par_heuristique(doc)
  local blocs = doc.blocks
  local dernier_ref = nil
  for idx = #blocs, math.max(1, #blocs - 80), -1 do
    local b = blocs[idx]
    if b.t == 'Para' and est_ref(trim(s(b))) then dernier_ref = idx; break end
  end
  if not dernier_ref or dernier_ref < math.floor(#blocs * 0.5) then
    return doc, 0
  end
  -- remontée : Para réf/continuation absorbés ; Table/Figure/image SAUTÉS (bio ou
  -- encadré inséré au milieu) ; le Header rencontré = titre de section, CONSERVÉ.
  local a_retirer = {}
  a_retirer[dernier_ref] = true
  local suspens = 0
  local k = dernier_ref - 1
  while k >= 1 do
    local b = blocs[k]
    if b.t == 'Para' and not bloc_image(b) then
      local txt = trim(s(b))
      if est_ref(txt) then
        a_retirer[k] = true; suspens = 0
      elseif #txt > 0 and #txt < 280 and suspens < 2 then
        a_retirer[k] = true; suspens = suspens + 1   -- continuation (« Dentz »)
      else
        break
      end
    elseif b.t == 'Header' then
      break                               -- titre de section : conservé (citeproc)
    elseif b.t == 'Table' or b.t == 'Figure' or bloc_image(b) then
      -- élément intercalé : sauté sans l'absorber
    else
      break
    end
    k = k - 1
  end
  -- ⚠ la remontée peut avoir absorbé en « continuations » des paragraphes de PROSE
  -- juste au-dessus de la première vraie référence : on rogne les continuations de
  -- tête (une entrée ne peut pas commencer par une continuation).
  local premiers = {}
  for idx = 1, #blocs do
    if a_retirer[idx] then premiers[#premiers + 1] = idx end
  end
  for _, idx in ipairs(premiers) do
    local txt = trim(s(blocs[idx]))
    if est_ref(txt) then break end
    a_retirer[idx] = nil                  -- prose de tête rendue au corps
  end
  -- redescente : références égarées APRÈS un tableau/une image en fin de document
  local j = dernier_ref + 1
  while j <= #blocs do
    local b = blocs[j]
    if b.t == 'Para' and est_ref(trim(s(b))) then
      a_retirer[j] = true
    elseif b.t == 'Table' or b.t == 'Figure' or bloc_image(b) then
      -- sauter
    else
      break
    end
    j = j + 1
  end
  -- regrouper (continuations collées à l'entrée précédente, comme l'attic)
  local entrees = {}
  for idx = 1, #blocs do
    if a_retirer[idx] and blocs[idx].t == 'Para' then
      local txt = trim(s(blocs[idx]))
      if txt ~= '' then
        if est_ref(txt) and not txt:match('^https?://') and debut_entree(txt) then
          entrees[#entrees + 1] = txt
        elseif #entrees > 0 then
          entrees[#entrees] = entrees[#entrees] .. ' ' .. txt
        else
          entrees[#entrees + 1] = txt
        end
      end
    end
  end
  if #entrees < 3 then return doc, 0 end  -- seuil du §5 : jamais 1-2 entrées isolées
  local garde = pandoc.List()
  for idx, b in ipairs(blocs) do
    if not a_retirer[idx] then garde:insert(b) end
  end
  doc.blocks = garde
  ecrire_refs(entrees)
  return doc, #entrees
end

function Pandoc(doc)
  local chemin_refs = os.getenv('SZH_REFS')
  if not chemin_refs or chemin_refs == '' then return doc end
  local type_article, blignes = charger_meta()
  if type_article == 'documentation' then
    io.stderr:write('[import] biblio : article « documentation », liste conservée\n')
    return doc
  end
  local n = 0
  local voie = 'style'
  if #blignes > 0 then
    doc, n = retirer_par_style(doc, blignes)
  end
  if n == 0 then
    voie = 'heuristique'
    doc, n = retirer_par_heuristique(doc)
  end
  if n > 0 then
    io.stderr:write(string.format(
      '[import] biblio : %d entrée(s) retirée(s) (%s) -> AnyStyle\n', n, voie))
  else
    io.stderr:write('[import] biblio : aucune liste de références détectée\n')
  end
  return doc
end
