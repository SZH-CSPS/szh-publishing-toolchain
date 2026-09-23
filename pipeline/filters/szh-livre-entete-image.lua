-- Pré-passe de szh-livre-entete.lua (livre uniquement, SZH_LIVRE) : protège l'image d'un
-- falc-header de la numérotation de figures.
--
-- MESURÉ (23.09.2026, corpus réel) : szh-livre-entete.lua vit en fin de FILTRES_CHAPITRE
-- (après szh-livre-auteurs.lua, pour le placement — voir son en-tête). Mais szh-figure.lua
-- et szh-numerotation.lua, EUX, numérotent SANS EXCEPTION toute image-seule qu'ils
-- rencontrent, où qu'elle soit dans le document — y compris dans un falc-header, qui n'est
-- pas une figure du corps mais un encadré. Résultat observé : « Abbildung 1 — Ein weisses
-- Schnecken-Haus » s'imprimait en toutes lettres DANS le texte de l'encadré, une légende de
-- figure que rien ne demandait.
--
-- Cette passe retire donc la ou les image(s) trouvée(s) dans un Div .falc-header AVANT que
-- szh-figure.lua ne s'exécute, et les stocke en attributs du Div : `img-src`/`img-alt` de
-- la PREMIÈRE image-seule trouvée, `img-extra` = nombre d'images en trop (pour
-- l'avertissement « plusieurs-images », émis par szh-livre-entete.lua — cette passe-ci ne
-- juge rien, elle protège). szh-livre-entete.lua les relit de là.
--
-- Position dans FILTRES_CHAPITRE (livre.mk) : juste APRÈS szh-typographie.lua, juste AVANT
-- szh-metafichier.lua — l'alt de l'image profite ainsi normalement de la typographie
-- maison (nbsp, guillemets…) avant d'être mis de côté, et aucun filtre qui numérote ou
-- regroupe des images (metafichier, grille, figure, numerotation, tableau-boite,
-- legende-avant) ne voit plus jamais cette image.
--
-- Pourquoi une passe séparée plutôt que d'avancer tout szh-livre-entete.lua ici : le
-- placement (après le titre ET le bloc auteurs) a besoin d'un bloc auteurs déjà posé par
-- szh-livre-auteurs.lua (fiche YAML) ou déjà présent (import Word) — les deux ne sont sûrs
-- qu'en fin de chaîne, après szh-livre-auteurs.lua. Le texte et le qr-link du falc-header,
-- eux, n'ont besoin d'AUCUNE protection : ni le contenu texte (Para/Plain ordinaires) ni le
-- Div qr-link (jamais touché par ces filtres génériques — ils ciblent Image/Figure, ou une
-- classe .szh-grille explicite) ne sont modifiés par la chaîne intermédiaire.
--
-- ⚠ Le lecteur `commonmark_x+sourcepos` de l'aperçu enveloppe chaque bloc IMBRIQUÉ (donc le
-- contenu du falc-header) dans un Div « wrapper=1 » (voir szh-sourcepos.lua, szh-grille.lua
-- en tête). Cette passe défait ces enveloppes en LISANT (sans_enveloppe, même fonction que
-- szh-grille.lua) et réécrit `div.content` déjà PLAT (sans wrapper) — sans conséquence sur
-- le clic vers la source : le falc-header entier finit de toute façon en RawBlock HTML
-- opaque (szh-livre-entete.lua), qui ne porte aucun data-pos individuel, wrappers ou pas.

local function a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

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

local function texte(v)
  if v == nil then return '' end
  local ok, r = pcall(pandoc.utils.stringify, v)
  if not ok then return '' end
  return (r:gsub('^%s+', ''):gsub('%s+$', ''))
end

local function alt_de_image(img)
  local a = img.attributes and img.attributes['alt']
  if a and texte(a) ~= '' then return texte(a) end
  return texte(img.caption)
end

local LIVRE = (os.getenv('SZH_LIVRE') or '') ~= ''

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
  if not LIVRE then return doc end
  doc.blocks = doc.blocks:walk({ Div = proteger })
  return doc
end
