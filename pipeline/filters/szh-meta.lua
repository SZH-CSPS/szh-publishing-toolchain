-- Import : retire du corps les blocs déjà partis dans <slug>.meta.yaml, d'après les
-- instructions « LETTRE<TAB>valeur » écrites par docx-meta.py dans SZH_META :
--   P<TAB>texte  paragraphe à retirer (file de consommation : une ligne ne retire
--                qu'une occurrence, la première rencontrée) ;
--   G<TAB>n      n paragraphes-image de tête (logo licence CC), retirés seulement
--                tant qu'on est dans la zone de tête, jamais une figure du corps ;
--   T<TAB>k      k-ième tableau de premier niveau = tableau des auteurs. docx-tables.py
--                lit la même liste et saute les mêmes indices, ce qui garde les deux
--                numérotations alignées sans toucher à szh-tabelle-reference.lua.
--   FG<TAB>k<TAB>…  k-ième tableau = une mise en page d'images (pronto-lire.py,
--                29.09.2026). docx-tables.py le saute comme un T ; ici il n'est PAS retiré
--                mais REMPLACÉ, à sa place, par un bloc `::: {.szh-grille}` qui porte ses
--                images — une rangée du tableau, un paragraphe d'images — et tout ce que ses
--                cellules portaient d'autre, à la suite : rien de ce tableau ne disparaît.
--                szh-legendes.lua, juste après, y pose légende, texte alternatif et crédits
--                (champs de la ligne FG) et la disposition déduite des rangées. L'attribut
--                `szh-tableau` = k fait le lien, et szh-legendes.lua l'ôte.
-- Doit tourner avant szh-legendes et szh-titres : un bloc consommé ne doit être ni
-- légendé ni promu. Sans SZH_META, ou fichier vide, le document est inchangé.
-- Les paragraphes stylés Title/Subtitle/Author/Abstract n'ont pas de ligne P : pandoc
-- les mappe lui-même en métadonnées, ils ne sont jamais des blocs du corps.

local utils = pandoc.utils

-- Espaces et tirets spéciaux normalisés, espaces compactés. À garder identique à
-- docx-meta.py, docx-titres.py et szh-titres.lua.
local function normaliser(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  t = t:gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', '')
  return t
end

local function charger()
  local chemin = os.getenv('SZH_META')
  if not chemin or chemin == '' then return nil end
  local f = io.open(chemin, 'r')
  if not f then return nil end
  local instr = { p = {}, np = 0, g = 0, t = {}, nt = 0, fg = {}, nfg = 0 }
  for ligne in f:lines() do
    local k_grille = ligne:match('^FG\t(%d+)')
    if k_grille then
      instr.fg[tonumber(k_grille)] = true
      instr.nfg = instr.nfg + 1
    end
    local lettre, valeur = ligne:match('^(%u)\t(.*)$')
    if lettre == 'P' then
      local clef = normaliser(valeur)
      if clef ~= '' then
        instr.p[clef] = (instr.p[clef] or 0) + 1
        instr.np = instr.np + 1
      end
    elseif lettre == 'G' then
      instr.g = tonumber(valeur) or 0
    elseif lettre == 'T' then
      local k = tonumber(valeur)
      if k then instr.t[k] = true; instr.nt = instr.nt + 1 end
    end
  end
  f:close()
  if instr.np == 0 and instr.g == 0 and instr.nt == 0 and instr.nfg == 0 then return nil end
  return instr
end

-- Les rangées d'un Table pandoc, dans l'ordre de lecture : en-têtes, corps (et leurs
-- en-têtes intermédiaires), pied.
local function rangees_du_tableau(tbl)
  local toutes = {}
  local function ajouter(rows)
    for _, r in ipairs(rows or {}) do toutes[#toutes + 1] = r end
  end
  ajouter(tbl.head and tbl.head.rows)
  for _, corps in ipairs(tbl.bodies or {}) do
    ajouter(corps.head)
    ajouter(corps.body)
  end
  ajouter(tbl.foot and tbl.foot.rows)
  return toutes
end

-- Un tableau de mise en page d'images (ligne FG) -> le bloc de groupe qui le remplace. Une
-- rangée du tableau donne un paragraphe de ses images, dans l'ordre des cellules ; tout bloc
-- de cellule qui n'est pas qu'une image (texte, tableau imbriqué) suit, tel quel, après les
-- images. pronto-lire.py n'écrit FG que pour un tableau sans texte, mais pandoc et le
-- lecteur du gabarit ne voient pas forcément le même Word : ce qui ne rentre pas dans la
-- grille est gardé, jamais jeté.
local function grille_depuis_tableau(tbl, k)
  local contenu, autres = pandoc.Blocks({}), pandoc.Blocks({})
  for _, rangee in ipairs(rangees_du_tableau(tbl)) do
    local images = pandoc.Inlines({})
    for _, cellule in ipairs(rangee.cells or {}) do
      for _, b in ipairs(cellule.contents or {}) do
        local seulement, lot = (b.t == 'Para' or b.t == 'Plain'), {}
        if seulement then
          for _, x in ipairs(b.content) do
            if x.t == 'Image' then lot[#lot + 1] = x
            elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' and x.t ~= 'LineBreak' then
              seulement = false
            end
          end
        end
        if seulement then
          for _, img in ipairs(lot) do
            if #images > 0 then images:insert(pandoc.SoftBreak()) end
            images:insert(img)
          end
        elseif not ((b.t == 'Para' or b.t == 'Plain') and #b.content == 0) then
          autres:insert(b)
        end
      end
    end
    if #images > 0 then contenu:insert(pandoc.Para(images)) end
  end
  contenu:extend(autres)
  return pandoc.Div(contenu, pandoc.Attr('', { 'szh-grille' }, { ['szh-tableau'] = tostring(k) }))
end

-- Les images que ce filtre retire EXPRÈS (logo de licence de tête, ligne G) sont notées,
-- une par ligne, dans le fichier $SZH_RETRAITS quand import-docx.sh le fournit : le filet de
-- sécurité de fin d'import (docx-controle-import.py) compare les images du Word à celles de
-- l'article, et une image ôtée volontairement ne doit pas lui paraître perdue — ni surtout
-- être remise dans le texte.
local function noter_retrait(b)
  local chemin = os.getenv('SZH_RETRAITS')
  if not chemin or chemin == '' then return end
  local f = io.open(chemin, 'a')
  if not f then return end
  for _, x in ipairs(b.content or {}) do
    if x.t == 'Image' then
      f:write((tostring(x.src):gsub('[?#].*$', ''):gsub('^.*[/\\]', '')) .. '\n')
    end
  end
  f:close()
end

-- Un Para/Plain dont le seul contenu significatif est une ou des images.
local function bloc_image_seule(b)
  if b.t ~= 'Para' and b.t ~= 'Plain' then return false end
  local image = false
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then image = true
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then return false end
  end
  return image
end

function Pandoc(doc)
  local instr = charger()
  if not instr then return doc end
  local sortie = pandoc.List()
  local retires_p, retires_t, retires_g, grilles = 0, 0, 0, 0
  local ordinal = 0                       -- tableaux de premier niveau (ordre du doc)
  local tete = true                       -- encore dans la zone de tête consommée ?
  for _, b in ipairs(doc.blocks) do
    local garder = true
    if b.t == 'Table' then
      ordinal = ordinal + 1
      if instr.t[ordinal] then
        garder = false
        retires_t = retires_t + 1
      elseif instr.fg[ordinal] then
        b = grille_depuis_tableau(b, ordinal)
        grilles = grilles + 1
      end
      tete = false
    elseif b.t == 'Para' or b.t == 'Plain' then
      local clef = normaliser(utils.stringify(b))
      if clef ~= '' and instr.p[clef] and instr.p[clef] > 0 then
        instr.p[clef] = instr.p[clef] - 1
        garder = false
        retires_p = retires_p + 1
      elseif tete and retires_g < instr.g and bloc_image_seule(b) then
        garder = false                    -- logo licence CC de la tête
        retires_g = retires_g + 1
        noter_retrait(b)
      elseif clef ~= '' then
        tete = false                      -- le vrai corps a commencé
      end
    elseif b.t == 'Header' then
      -- L'en-tête de section du tableau des auteurs (« Autrices et auteurs ») est
      -- consigné en ligne P par docx-meta.py : apparié ici aussi sur les Header.
      local clef = normaliser(utils.stringify(b))
      if clef ~= '' and instr.p[clef] and instr.p[clef] > 0 then
        instr.p[clef] = instr.p[clef] - 1
        garder = false
        retires_p = retires_p + 1
      end
      tete = false
    else
      tete = false
    end
    if garder then sortie:insert(b) end
  end
  doc.blocks = sortie
  -- Une ligne P sans correspondance n'est pas une erreur (ligne Keywords stylée
  -- Abstract, déjà mappée en métadonnées par pandoc) : on le signale sans échouer.
  local restants = 0
  for _, n in pairs(instr.p) do restants = restants + n end
  io.stderr:write(string.format(
    '[import] méta : %d paragraphe(s), %d logo(s), %d tableau(x) auteurs retirés%s%s\n',
    retires_p, retires_g, retires_t,
    grilles > 0 and string.format(', %d tableau(x) d\'images devenu(s) groupe(s)', grilles)
      or '',
    restants > 0 and string.format(' (%d instruction(s) sans correspondance)', restants) or ''))
  return doc
end
