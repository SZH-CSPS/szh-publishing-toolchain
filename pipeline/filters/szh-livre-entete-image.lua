-- Livre seulement : retire l'image d'un falc-header avant la numérotation des figures.
--
-- szh-figure.lua et szh-numerotation.lua numérotent toute image seule, où qu'elle soit.
-- Dans un falc-header (un encadré, pas une figure du corps), on verrait apparaître
-- « Abbildung 1 — … » dans le texte de l'encadré.
--
-- La passe retire les images seules d'un Div .falc-header et les note en attributs du
-- Div : `img-src` et `img-alt` de la première, `img-extra` = nombre d'images en trop.
-- szh-livre-entete.lua les relit et émet l'avertissement « plusieurs-images ».
--
-- Place dans FILTRES_CHAPITRE (livre.mk) : juste après szh-typographie.lua (l'alt reçoit
-- la typographie maison), juste avant szh-metafichier.lua (aucun filtre qui numérote ou
-- regroupe les images ne la voit). szh-livre-entete.lua reste en fin de chaîne : il se
-- place sous le bloc auteurs, qui n'existe qu'après szh-livre-auteurs.lua. Le texte et le
-- qr-link de l'encadré n'ont pas besoin de protection.
--
-- Dans l'aperçu, le lecteur `commonmark_x+sourcepos` enveloppe chaque bloc imbriqué dans un
-- Div « wrapper=1 » (voir szh-sourcepos.lua). sans_enveloppe() les défait et `div.content`
-- est réécrit à plat. Sans effet sur le clic vers la source : szh-livre-entete.lua rend
-- l'encadré entier en un seul RawBlock HTML.

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
    io.stderr:write('[livre-entete-image] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local a_classe = commun.a_classe

local function sans_enveloppe(blocs)
  local plat = pandoc.Blocks({})
  for _, b in ipairs(blocs) do
    if b.t == 'Div' and b.attributes and b.attributes['wrapper'] == '1' then
      for _, dedans in ipairs(sans_enveloppe(b.content)) do plat:insert(dedans) end
    else
      plat:insert(b)
    end
  end
  return plat
end

local function bloc_est_image_seule(b)
  if b.t == 'Figure' then return true end
  if b.t == 'Para' or b.t == 'Plain' then
    local a_image, seulement = false, true
    for _, i in ipairs(b.content) do
      if i.t == 'Image' then a_image = true
      elseif i.t ~= 'Space' and i.t ~= 'SoftBreak' and i.t ~= 'LineBreak' then seulement = false end
    end
    return a_image and seulement
  end
  return false
end

local function premiere_image_de(b)
  local trouvee
  b:walk({ Image = function(img) if not trouvee then trouvee = img end end })
  return trouvee
end

local texte = commun.texte

local function alt_de_image(img)
  local a = img.attributes and img.attributes['alt']
  if a and texte(a) ~= '' then return texte(a) end
  return texte(img.caption)
end

local function proteger(div)
  if not a_classe(div, 'falc-header') then return nil end

  local garde, images = pandoc.Blocks({}), {}
  for _, b in ipairs(sans_enveloppe(div.content)) do
    if bloc_est_image_seule(b) then
      local img = premiere_image_de(b)
      if img then images[#images + 1] = img end
    else
      garde:insert(b)
    end
  end

  if #images > 0 then
    div.attributes['img-src'] = images[1].src
    div.attributes['img-alt'] = alt_de_image(images[1])
    if #images > 1 then div.attributes['img-extra'] = tostring(#images - 1) end
  end
  div.content = garde
  return div
end

function Pandoc(doc)
  if commun.contexte(doc.meta).produit ~= 'livre' then return doc end
  doc.blocks = doc.blocks:walk({ Div = proteger })
  return doc
end
