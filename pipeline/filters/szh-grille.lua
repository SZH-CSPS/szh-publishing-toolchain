-- Grilles d'images : plusieurs images qui se lisent ensemble deviennent une figure.
--
--   ::: {.szh-grille disposition="2-2"}
--   ![Légende de la figure](media/a.png){alt="…" copyright="© A"}
--   ![](media/b.png){alt="…"}
--   ![](media/c.png){alt="…"}
--   ![](media/d.png){alt="…"}
--   :::
--
-- La grille a un numéro, une légende, et ne se coupe pas d'une page à l'autre. Le format
-- d'écriture est défini dans lib/references.js (cockpit), qui porte la même table de
-- dispositions ; test/js/contrats.test.js vérifie qu'elles sont identiques.
--
-- Sortie :
--   <figure class="szh-grille szh-grille-2-2">
--     <figcaption>Figure 3 — Légende</figcaption>       (posée par szh-numerotation.lua)
--     <div class="szh-grille-rangee">
--       <span class="szh-grille-case" style="flex-grow:1.5000"><img …></span>
--       …
--
-- flex-grow vaut le rapport largeur/hauteur de l'image : avec une base nulle, toutes les
-- images d'une rangée ont alors la même hauteur et la rangée remplit la colonne. Des images
-- de même format donnent des colonnes égales. Aucune image n'est recadrée.
--
-- Le mode « auto » (disposition absente, vide, « auto » ou incohérente avec le nombre
-- d'images) choisit la disposition dont la hauteur rendue s'approche le plus de CIBLE fois
-- la largeur de la colonne : deux panoramas l'un sur l'autre, deux portraits côte à côte.
--
-- Place dans la chaîne : avant szh-figure.lua, qui refait une figure d'une grille réduite
-- à une image dans l'aperçu, et donc avant szh-numerotation.lua, qui numérote la figure et
-- y pose les crédits de toutes ses images.

local utils = pandoc.utils

-- Module commun (a_classe). Sans lui, la compilation s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[grille] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local CLASSE = 'szh-grille'
local AUTO = 'auto'

-- Six images au plus, au-delà desquelles elles deviennent trop petites. Le cockpit refuse
-- d'en mettre plus ; un .md édité à la main se compose quand même, avec un avertissement.
local MAX = 6

-- Copie de DISPOSITIONS (lib/references.js) : le menu du cockpit propose ce que ce filtre
-- sait composer.
local DISPOSITIONS = {
  [2] = { '2', '1-1' },
  [3] = { '3', '2-1', '1-2', '1-1-1' },
  [4] = { '2-2', '4', '3-1', '1-3' },
  [5] = { '3-2', '2-3', '5' },
  [6] = { '3-3', '2-2-2', '6' },
}

-- Copie de GRILLE_CIBLE (lib/references.js).
local CIBLE = 0.62

-- Rangées d'une disposition : « 2-2 » -> { 2, 2 } ; nil si la forme n'est pas celle-là.
local function rangees_de(code)
  if type(code) ~= 'string' or not code:match('^[1-9][0-9-]*$') then return nil end
  local liste = {}
  for n in code:gmatch('[^-]+') do
    local v = tonumber(n)
    if not v or v < 1 or v ~= math.floor(v) then return nil end
    liste[#liste + 1] = v
  end
  if #liste == 0 then return nil end
  -- L'appelant vérifie que le total correspond au nombre d'images.
  return liste
end

local function total(rangees)
  local s = 0
  for _, v in ipairs(rangees) do s = s + v end
  return s
end

local function disposition_connue(code, n)
  for _, c in ipairs(DISPOSITIONS[n] or {}) do
    if c == code then return true end
  end
  return false
end

-- Largeur et hauteur naturelles d'une image, en pixels, lues dans la mediabag ; nil si
-- elle est illisible.
local function mesure_image(src)
  local ok, _, contenu = pcall(pandoc.mediabag.fetch, src)
  if not ok or type(contenu) ~= 'string' then return nil end
  local ok2, taille = pcall(pandoc.image.size, contenu)
  if not ok2 or type(taille) ~= 'table' then return nil end
  local l, h = tonumber(taille.width), tonumber(taille.height)
  if not l or not h or l <= 0 or h <= 0 then return nil end
  return l, h
end

-- Mode automatique. `ratios` donne largeur/hauteur de chaque image, dans l'ordre. S'il en
-- manque un, rend la première disposition de la table.
-- Une rangée de la largeur de la colonne a pour hauteur 1 / Σ(ses ratios) ; la somme des
-- hauteurs des rangées est comparée à CIBLE.
local function disposition_auto(n, ratios)
  local codes = DISPOSITIONS[n]
  if not codes then return nil end
  for i = 1, n do
    local r = ratios[i]
    if type(r) ~= 'number' or r <= 0 then return codes[1] end
  end
  local meilleur, ecart_min = codes[1], nil
  for _, code in ipairs(codes) do
    local hauteur, k = 0, 1
    for _, largeur in ipairs(rangees_de(code)) do
      local somme = 0
      for _ = 1, largeur do somme = somme + ratios[k]; k = k + 1 end
      hauteur = hauteur + 1 / somme
    end
    local ecart = math.abs(hauteur - CIBLE)
    if ecart_min == nil or ecart < ecart_min - 1e-9 then
      meilleur, ecart_min = code, ecart
    end
  end
  return meilleur
end

-- Au-delà de MAX images : des rangées de trois, la dernière portant le reste.
local function rangees_de_secours(n)
  local liste = {}
  local reste = n
  while reste > 3 do liste[#liste + 1] = 3; reste = reste - 3 end
  liste[#liste + 1] = reste
  return liste
end

local a_classe = commun.a_classe

-- Le lecteur `commonmark_x+sourcepos` de l'aperçu enveloppe chaque bloc imbriqué dans un
-- Div « wrapper=1 », d'où pandoc tire le `data-pos` du clic vers la source. Ces Div sont
-- laissés en place par szh-sourcepos.lua et traversés ici pour trouver les images.
local function sans_enveloppe(blocs)
  local plat = pandoc.Blocks({})
  for _, b in ipairs(blocs) do
    if b.t == 'Div' and b.attributes['wrapper'] == '1' then
      for _, dedans in ipairs(sans_enveloppe(b.content)) do plat:insert(dedans) end
    else
      plat:insert(b)
    end
  end
  return plat
end

-- Rend les images du bloc, dans l'ordre, chacune avec sa légende visible, et les autres
-- blocs, conservés tels quels après les rangées. Deux formes à lire :
-- - plusieurs images dans un même paragraphe (ce qu'écrit le cockpit, et la seule forme
--   sous commonmark_x) : la légende est la description de l'Image, l'alt reste dans ses
--   attributs ;
-- - une image seule dans son paragraphe, sous le lecteur `markdown` : implicit_figures en
--   a fait une Figure, dont la légende est la légende, et la description de l'Image porte
--   l'alt.
local function collecter(div)
  local trouvees, autres = {}, pandoc.Blocks({})
  for _, b in ipairs(sans_enveloppe(div.content)) do
    if b.t == 'Para' or b.t == 'Plain' then
      local seulement, lot = true, {}
      for _, i in ipairs(b.content) do
        if i.t == 'Image' then lot[#lot + 1] = i
        elseif i.t ~= 'Space' and i.t ~= 'SoftBreak' and i.t ~= 'LineBreak' then
          seulement = false
        end
      end
      if seulement and #lot > 0 then
        for _, img in ipairs(lot) do
          trouvees[#trouvees + 1] = { image = img, legende = img.caption }
        end
      else
        autres:insert(b)
      end
    elseif b.t == 'Figure' then
      local avant = #trouvees
      local legende = utils.blocks_to_inlines(b.caption.long)
      b.content:walk({
        Image = function(img)
          -- La légende de la Figure va à la première image seulement.
          trouvees[#trouvees + 1] = { image = img,
            legende = (#trouvees == avant) and legende or pandoc.Inlines({}) }
        end
      })
      if #trouvees == avant then autres:insert(b) end
    else
      autres:insert(b)
    end
  end
  return trouvees, autres
end

-- La légende passe à la figure. Si un alt= est écrit, la description de l'image est vidée
-- et l'alt= devient la seule source du texte alternatif.
--
-- L'attribut alt= reste en place : szh-apercu-lecteur-ecran.lua le lit pour distinguer un
-- alt rempli, un alt="" voulu (image décorative) et un alt absent. szh-numerotation.lua
-- normalise ensuite.
--
-- La classe .szh-hors-figure est retirée : c'est la grille entière qui est la figure.
local function normaliser_alt(img)
  img.classes = img.classes:filter(function(c) return c ~= 'szh-hors-figure' end)
  if img.attributes['alt'] ~= nil then img.caption = pandoc.Inlines({}) end
end

-- Une rangée : un Div en flex, avec une case par image.
-- - Le Div porte --szh-rangees, le nombre de rangées de la grille : print.css partage le
--   plafond de hauteur des figures entre les rangées. Il est posé sur le Div et non sur la
--   <figure>, car szh-legende-avant.lua réécrit la balise de la <figure> sans son `style`.
-- - Chaque case porte sa croissance et --szh-case-max, la largeur qui donne à l'image la
--   hauteur plafonnée. Un max-height déformerait l'image dans WeasyPrint. Une propriété
--   personnalisée se laisse annuler sans !important sur écran étroit, où la rangée se
--   défait.
local function rangee(images, ratios, debut, combien, rangees)
  local cases = pandoc.Inlines({})
  for k = debut, debut + combien - 1 do
    local r = ratios[k]
    local attrs = {}
    -- Sans mesure, la case garde la croissance 1 de la feuille de style : parts égales.
    if type(r) == 'number' and r > 0 then
      attrs['style'] = string.format(
        'flex-grow:%.4f;--szh-case-max:calc((var(--plafond-figure) - 12px)'
          .. ' / var(--szh-rangees, 1) * %.4f)', r, r)
    end
    cases:insert(pandoc.Span({ images[k] }, pandoc.Attr('', { 'szh-grille-case' }, attrs)))
  end
  return pandoc.Div({ pandoc.Plain(cases) },
    pandoc.Attr('', { 'szh-grille-rangee' }, { style = '--szh-rangees:' .. rangees }))
end

function Div(div)
  if not a_classe(div, CLASSE) then return nil end
  local trouvees, autres = collecter(div)
  local n = #trouvees

  -- Aucune image : rend le contenu du bloc.
  if n == 0 then return div.content end
  -- Une seule image : une figure ordinaire, construite ici. Rendue en paragraphe sous le
  -- lecteur `markdown`, l'alt deviendrait la légende et la vraie légende serait perdue.
  if n == 1 then
    local t = trouvees[1]
    local legende_seule = pandoc.Inlines(t.legende)   -- relevée avant qu'on y touche
    normaliser_alt(t.image)
    local blocs = pandoc.Blocks({})
    if #legende_seule > 0 then
      blocs:insert(pandoc.Figure(
        pandoc.Blocks({ pandoc.Plain({ t.image }) }),
        { long = pandoc.Blocks({ pandoc.Plain(legende_seule) }) }))
    else
      blocs:insert(pandoc.Para({ t.image }))
    end
    blocs:extend(autres)
    return blocs
  end

  local images = {}
  for i, t in ipairs(trouvees) do images[i] = t.image end

  -- La légende de la figure est la première trouvée. Sans alt= sur cette image, elle reste
  -- aussi sa description et sert de texte alternatif, comme pour une figure ordinaire.
  local legende = nil
  for _, t in ipairs(trouvees) do
    if #t.legende > 0 then legende = pandoc.Inlines(t.legende); break end
  end

  local ratios = {}
  for i, img in ipairs(images) do
    local l, h = mesure_image(img.src)
    ratios[i] = l and (l / h) or nil
  end

  local code = div.attributes['disposition']
  local plan = nil
  if n <= MAX then
    if code ~= nil and code ~= '' and code ~= AUTO and disposition_connue(code, n) then
      plan = rangees_de(code)
      if plan and total(plan) ~= n then plan = nil end
    end
    if not plan then
      code = disposition_auto(n, ratios)
      plan = rangees_de(code)
    end
  else
    io.stderr:write('[grille] ' .. n .. ' images dans une seule grille (' .. MAX
      .. ' au plus) : composée en rangées de trois. Scindez-la en deux figures.\n')
    plan = rangees_de_secours(n)
    code = table.concat(plan, '-')
  end

  for _, img in ipairs(images) do normaliser_alt(img) end

  local contenu = pandoc.Blocks({})
  local k = 1
  for _, combien in ipairs(plan) do
    contenu:insert(rangee(images, ratios, k, combien, #plan))
    k = k + combien
  end
  contenu:extend(autres)

  -- La classe de disposition (szh-grille-2-2…) n'est pas utilisée par print.css ; elle
  -- permet à une feuille de style de traiter une disposition à part.
  return pandoc.Figure(
    contenu,
    { long = legende and pandoc.Blocks({ pandoc.Plain(legende) }) or pandoc.Blocks({}) },
    pandoc.Attr(div.identifier or '', { CLASSE, CLASSE .. '-' .. code }, {})
  )
end
