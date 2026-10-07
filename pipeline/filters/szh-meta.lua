-- Import : retire du corps les blocs déjà repris dans <slug>.meta.yaml, d'après les
-- instructions « LETTRE<TAB>valeur » écrites par docx-meta.py dans SZH_META :
--   P<TAB>texte  paragraphe à retirer ; une ligne retire une seule occurrence, la
--                première rencontrée ;
--   G<TAB>n      n paragraphes-image de tête (logo de licence CC), retirés seulement
--                dans la zone de tête ;
--   T<TAB>k      k-ième tableau de premier niveau = tableau des auteurs, retiré.
--                docx-tables.py saute les mêmes indices : les deux numérotations restent
--                alignées ;
--   FG<TAB>k<TAB>…  k-ième tableau = une mise en page d'images (écrit par pronto-lire.py).
--                docx-tables.py le saute comme un T. Ici, il est remplacé à sa place par
--                un bloc `::: {.szh-grille}` : un paragraphe d'images par rangée, puis le
--                reste du contenu des cellules. szh-legendes.lua y pose ensuite légende,
--                alt, crédits et disposition, et retire l'attribut de lien `szh-tableau` = k.
-- S'exécute avant szh-legendes.lua et szh-titres.lua : un bloc retiré n'est ni légendé ni
-- promu en titre. Sans SZH_META, ou avec un fichier vide, le document est inchangé.
-- Les paragraphes stylés Title/Subtitle/Author/Abstract n'ont pas de ligne P : pandoc les
-- met lui-même dans les métadonnées.

local utils = pandoc.utils

-- Normalise espaces et tirets spéciaux, et compacte les espaces. Même règle que
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

-- Remplace un tableau de mise en page d'images (ligne FG) par un bloc de grille : un
-- paragraphe d'images par rangée, dans l'ordre des cellules, puis les autres blocs des
-- cellules (texte, tableau imbriqué) tels quels. pronto-lire.py n'écrit FG que pour un
-- tableau sans texte, mais pandoc peut lire le Word autrement : rien n'est jeté.
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

-- Note dans $SZH_RETRAITS (si import-docx.sh le fournit) les images retirées exprès (logo
-- de licence, ligne G), une par ligne. docx-controle-import.py, qui compare les images du
-- Word à celles de l'article, ne les compte alors pas comme perdues.
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
  local tete = true                       -- encore dans la zone de tête ?
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
      -- Le titre de section du tableau des auteurs (« Autrices et auteurs ») a aussi une
      -- ligne P.
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
  -- Une ligne P sans correspondance n'est pas une erreur (par exemple une ligne Keywords
  -- stylée Abstract, déjà en métadonnées) : elle est seulement comptée dans le message.
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
