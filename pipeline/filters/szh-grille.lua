-- Grilles d'images : plusieurs images qui se lisent ensemble deviennent UNE figure.
--
--   ::: {.szh-grille disposition="2-2"}
--   ![Légende de la figure](media/a.png){alt="…" copyright="© A"}
--   ![](media/b.png){alt="…"}
--   ![](media/c.png){alt="…"}
--   ![](media/d.png){alt="…"}
--   :::
--
-- Un numéro, une légende, un bloc qui ne se coupe pas — c'est ce qu'attend une planche de
-- photos ou un avant/après. Le contrat d'écriture vit dans lib/references.js, côté cockpit ;
-- les deux fichiers portent la même table de dispositions, et test/js/contrats.test.js
-- refuse qu'elles divergent.
--
-- Ce qui sort :
--   <figure class="szh-grille szh-grille-2-2">
--     <figcaption>Figure 3 — Légende</figcaption>       (posée par szh-numerotation.lua)
--     <div class="szh-grille-rangee">
--       <span class="szh-grille-case" style="flex-grow:1.5000"><img …></span>
--       …
--
-- Pourquoi flex-grow porte le rapport largeur/hauteur de l'image, et non « une colonne par
-- image » : dans une rangée dont les cases ont une base nulle, une croissance
-- proportionnelle au rapport donne à toutes les images LA MÊME HAUTEUR, et la rangée
-- remplit exactement la colonne. C'est la mise en page justifiée des planches imprimées.
-- Quand toutes les images ont le même format — le cas ordinaire d'une série — cela revient
-- à des colonnes égales. Aucune image n'est jamais recadrée.
--
-- Le mode « auto » (disposition absente, vide, « auto », ou incohérente avec le nombre
-- d'images) choisit la disposition dont le bloc rendu s'approche le plus de CIBLE fois la
-- largeur de la colonne. Deux panoramas partent donc l'un sur l'autre, deux portraits côte
-- à côte : c'est ce que ferait un maquettiste, et c'est mesuré sur les fichiers.
--
-- Place dans la chaîne : AVANT szh-figure.lua — une grille tombée à une seule image se
-- dissout en paragraphe, et c'est szh-figure.lua qui en refera une figure sous le lecteur
-- de l'aperçu — donc avant szh-numerotation.lua, qui numérote la figure produite ici et y
-- pose les crédits de toutes ses images.

local utils = pandoc.utils

local CLASSE = 'szh-grille'
local AUTO = 'auto'

-- Six images au plus. Au-delà, la colonne n'a plus assez de largeur pour que chacune se
-- lise : le geste juste est de scinder en deux figures. Le cockpit l'interdit ; ici, on
-- compose quand même — un .md édité à la main ne doit pas faire échouer un rendu.
local MAX = 6

-- ⚠ Table recopiée depuis lib/references.js (DISPOSITIONS). Les deux doivent rester
--   identiques : le menu du cockpit propose ce que ce filtre sait composer.
local DISPOSITIONS = {
  [2] = { '2', '1-1' },
  [3] = { '3', '2-1', '1-2', '1-1-1' },
  [4] = { '2-2', '4', '3-1', '1-3' },
  [5] = { '3-2', '2-3', '5' },
  [6] = { '3-3', '2-2-2', '6' },
}

-- ⚠ Recopiée elle aussi depuis lib/references.js (GRILLE_CIBLE).
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
  -- Une suite qui ne totalise pas le compte attendu est vérifiée par l'appelant.
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

-- Largeur et hauteur naturelles d'une image, en pixels ; nil si elle est illisible.
-- Même lecture que szh-numerotation.lua : la mediabag porte les fichiers déjà chargés.
local function mesure_image(src)
  local ok, _, contenu = pcall(pandoc.mediabag.fetch, src)
  if not ok or type(contenu) ~= 'string' then return nil end
  local ok2, taille = pcall(pandoc.image.size, contenu)
  if not ok2 or type(taille) ~= 'table' then return nil end
  local l, h = tonumber(taille.width), tonumber(taille.height)
  if not l or not h or l <= 0 or h <= 0 then return nil end
  return l, h
end

-- Mode automatique. `ratios` donne largeur/hauteur de chaque image, dans l'ordre ; une
-- seule valeur manquante et l'on rend le repli — la première disposition de la table —
-- plutôt qu'un calcul fait sur des carrés imaginaires.
-- Une rangée justifiée sur la largeur de la colonne a pour hauteur 1 / Σ(ses ratios) :
-- c'est la somme de ces hauteurs que l'on compare à CIBLE.
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

-- Au-delà de six images, aucune disposition n'est nommée : on remplit des rangées de trois,
-- la dernière portant le reste. Le rendu reste lisible, et le cockpit, lui, a refusé.
local function rangees_de_secours(n)
  local liste = {}
  local reste = n
  while reste > 3 do liste[#liste + 1] = 3; reste = reste - 3 end
  liste[#liste + 1] = reste
  return liste
end

local function a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

-- Les images du bloc, dans l'ordre, chacune avec sa légende visible, et ce que le bloc
-- contient d'autre. Deux lectures possibles, et il faut les deux — c'est le piège de ce
-- filtre :
--   * plusieurs images en suite dans un même paragraphe (la forme que le cockpit écrit,
--     et la seule sous commonmark_x) : la légende est la description de l'Image, l'alt est
--     resté dans ses attributs ;
--   * une image seule dans son paragraphe sous le lecteur `markdown` : implicit_figures en
--     a déjà fait une Figure, la légende est celle de la FIGURE, et la description de
--     l'Image porte l'alt, que le lecteur y a déplacé.
-- Prendre la description de l'Image dans les deux cas donnait la légende de l'une et le
-- texte alternatif de l'autre, sans que rien ne le dise.
-- Ce qui n'est ni l'un ni l'autre est conservé tel quel, à la suite des rangées : rien de
-- ce qu'un rédacteur a écrit ne doit disparaître sans un mot.
local function collecter(div)
  local trouvees, autres = {}, pandoc.Blocks({})
  for _, b in ipairs(div.content) do
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
          -- La légende de la figure va à la première image seulement : une Figure n'en
          -- porte qu'une, et la recopier sur les suivantes en ferait autant de légendes.
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

-- Dans une grille, la description de l'image ne porte plus la légende de la figure — on
-- vient de la relever, et c'est la figure qui la portera. Si un alt= est écrit, il devient
-- donc la seule source du texte alternatif, et la description est vidée : le writer HTML
-- fait déjà primer l'attribut, mais laisser les deux ferait dépendre le rendu d'une
-- préséance qu'aucune ligne du dépôt ne garantit.
--
-- ⚠ L'attribut alt= est laissé EN PLACE, et ce n'est pas un oubli. C'est lui, et lui seul,
-- que lit szh-apercu-lecteur-ecran.lua pour distinguer les trois cas de son encadré
-- « ce qu'un lecteur d'écran reçoit » : un alt= rempli, un alt="" voulu (image décorative)
-- et un alt absent (rien de saisi, et l'encadré crie). Le déplacer dans la description
-- rendait un alt= saisi indiscernable d'une légende recopiée, et un alt="" volontaire
-- indiscernable d'un oubli. La normalisation, quand la grille est numérotée, est faite
-- plus tard par szh-numerotation.lua — après que l'encadré a lu l'intention.
--
-- La classe .szh-hors-figure, elle, n'a aucun sens ici : c'est la grille entière qui est
-- la figure. On l'ôte plutôt que de la laisser sortir sur le <img>.
local function normaliser_alt(img)
  img.classes = img.classes:filter(function(c) return c ~= 'szh-hors-figure' end)
  if img.attributes['alt'] ~= nil then img.caption = pandoc.Inlines({}) end
end

-- Une rangée : un Div qui porte le flex, une case par image qui porte sa croissance.
local function rangee(images, ratios, debut, combien)
  local cases = pandoc.Inlines({})
  for k = debut, debut + combien - 1 do
    local r = ratios[k]
    local attrs = {}
    -- Sans mesure, la case garde la croissance de la feuille de style (1) : les images de
    -- la rangée se partagent alors la largeur à parts égales.
    if type(r) == 'number' and r > 0 then
      attrs['style'] = string.format('flex-grow:%.4f', r)
    end
    cases:insert(pandoc.Span({ images[k] }, pandoc.Attr('', { 'szh-grille-case' }, attrs)))
  end
  return pandoc.Div({ pandoc.Plain(cases) }, pandoc.Attr('', { 'szh-grille-rangee' }, {}))
end

function Div(div)
  if not a_classe(div, CLASSE) then return nil end
  local trouvees, autres = collecter(div)
  local n = #trouvees

  -- Rien à mettre en grille : le bloc n'a plus rien à dire, on rend ce qu'il portait.
  if n == 0 then return div.content end
  -- Une seule image : ce n'est pas une grille, c'est une figure — celle qu'elle aurait été
  -- sans le bloc. On la refait ici plutôt que de rendre le paragraphe à szh-figure.lua :
  -- sous le lecteur `markdown`, la légende visible est déjà passée sur la Figure et la
  -- description de l'image porte l'alt ; lui rendre un paragraphe ferait de l'alt la
  -- légende, et la vraie légende disparaîtrait.
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

  -- La légende de la figure : la première qu'une image porte. Faute d'alt= sur cette
  -- image-là, elle lui reste aussi comme description, où elle sert de texte alternatif de
  -- repli — exactement comme pour une figure ordinaire, dont le lecteur markdown recopie
  -- la légende dans l'alt.
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
      .. ' au plus) : composée en rangées de trois. Scindez-la en deux figures.\n')
    plan = rangees_de_secours(n)
    code = table.concat(plan, '-')
  end

  for _, img in ipairs(images) do normaliser_alt(img) end

  local contenu = pandoc.Blocks({})
  local k = 1
  for _, combien in ipairs(plan) do
    contenu:insert(rangee(images, ratios, k, combien))
    k = k + combien
  end
  contenu:extend(autres)

  -- La classe de disposition accompagne la figure : elle ne sert à aucune règle de
  -- print.css — la mise en page tient dans les rangées — mais elle rend le HTML lisible
  -- et donne prise à une feuille de revue qui voudrait traiter un cas à part.
  return pandoc.Figure(
    contenu,
    { long = legende and pandoc.Blocks({ pandoc.Plain(legende) }) or pandoc.Blocks({}) },
    pandoc.Attr(div.identifier or '', { CLASSE, CLASSE .. '-' .. code }, {})
  )
end
