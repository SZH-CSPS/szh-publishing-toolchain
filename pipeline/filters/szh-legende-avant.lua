-- Place la légende avant l'image. Pandoc écrit <img> puis <figcaption>, et l'ordre du DOM
-- est celui du flux PDF, de l'extraction de texte et des lecteurs d'écran : le CSS ne
-- changerait que l'apparence. La Figure est remplacée par une suite de blocs où seules les
-- balises <figure> et <figcaption> sont en HTML brut ; légende et image restent des blocs
-- pandoc (alt, role, data-* de crédits et --embed-resources fonctionnent normalement).
--
-- S'exécute après szh-numerotation.lua, qui écrit « Figure N — », les crédits et l'alt
-- dans la Figure.
--
-- La légende reste après l'image pour une figure .szh-credit-seul (image hors
-- numérotation : la <figcaption> n'est qu'une mention de droits) et pour une figure
-- .szh-legende-dessous (livre normal, `legende: dessous`). La note de figure
-- (<p class="szh-bloc-note">) est toujours remise en dernier.
--
-- Une figure à légende est nommée par elle : la <figcaption> reçoit un id et la <figure>
-- un aria-labelledby, car Edge et Chrome ne tirent pas le nom d'une figure de sa
-- <figcaption>. L'id porte le slug de l'unité, unique dans un livre assemblé. WeasyPrint
-- ignore aria-labelledby : le PDF ne change pas.
--
-- Sorties HTML seulement : un writer non-HTML jette les RawBlock html, et l'image
-- disparaîtrait. Les motifs Lua n'ont pas d'alternative « | », d'où deux motifs.
if not (FORMAT:match('^html') or FORMAT:match('^epub')) then return {} end

-- Échappement HTML d'une valeur d'attribut (identifiant/classe d'un `![](){#id}`).
local function att(v)
  return (v:gsub('&', '&amp;'):gsub('"', '&quot;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

-- Slug de l'unité compilée (fichier d'entrée sans .md), pour des id uniques dans un livre.
local function slug_unite()
  local fichiers = (PANDOC_STATE and PANDOC_STATE.input_files) or {}
  local chemin = fichiers[1]
  if type(chemin) ~= 'string' then return 'doc' end
  local slug = chemin:gsub('.*[/\\]', ''):gsub('%.md$', ''):gsub('[^%w%-_]', '-')
  return slug ~= '' and slug or 'doc'
end
local n_legende = 0

-- `<figure>` avec l'id et les classes de la Figure d'origine ; les autres attributs
-- de l'Attr ne sont pas repris, pandoc ne les émet pas non plus sur `<figure>`.
-- `id_legende` : l'id de la <figcaption> qui nomme la figure, ou nil.
local function balise_ouvrante(fig, id_legende)
  local bouts = { '<figure' }
  if fig.identifier and fig.identifier ~= '' then
    bouts[#bouts + 1] = ' id="' .. att(fig.identifier) .. '"'
  end
  if fig.classes and #fig.classes > 0 then
    bouts[#bouts + 1] = ' class="' .. att(table.concat(fig.classes, ' ')) .. '"'
  end
  if id_legende then
    bouts[#bouts + 1] = ' aria-labelledby="' .. att(id_legende) .. '"'
  end
  bouts[#bouts + 1] = '>'
  return table.concat(bouts)
end

local function a_classe(fig, nom)
  for _, c in ipairs(fig.classes or {}) do
    if c == nom then return true end
  end
  return false
end

local function credit_seul(fig) return a_classe(fig, 'szh-credit-seul') end

-- Un bloc de note : un Plain dont le premier inline est le <p class="szh-bloc-note"> brut.
local function est_bloc_note(b)
  if b.t ~= 'Plain' then return false end
  local premier = b.content[1]
  return premier ~= nil and premier.t == 'RawInline'
    and premier.text:find('class="szh-bloc-note"', 1, true) ~= nil
end

function Figure(fig)
  local apres = credit_seul(fig)
  -- La légende nomme la figure, sauf un crédit seul, qui n'en dit pas le sujet.
  local id_legende = nil
  if #fig.caption.long > 0 and not apres then
    n_legende = n_legende + 1
    id_legende = 'szh-legende-' .. slug_unite() .. '-' .. n_legende
  end
  local blocs = pandoc.Blocks({ pandoc.RawBlock('html', balise_ouvrante(fig, id_legende)) })
  -- Figure sans légende : pas de <figcaption> vide.
  local legende = pandoc.Blocks({})
  if #fig.caption.long > 0 then
    legende:insert(pandoc.RawBlock('html',
      apres and '<figcaption class="szh-credit-seul">'
            or '<figcaption id="' .. att(id_legende) .. '">'))
    legende:extend(fig.caption.long)
    legende:insert(pandoc.RawBlock('html', '</figcaption>'))
  end
  local corps, notes = pandoc.Blocks({}), pandoc.Blocks({})
  for _, b in ipairs(fig.content) do
    if est_bloc_note(b) then notes:insert(b) else corps:insert(b) end
  end
  -- Livre normal, `legende: dessous` : szh-numerotation.lua a marqué la figure.
  local dessous = apres or a_classe(fig, 'szh-legende-dessous')
  if not dessous then blocs:extend(legende) end
  blocs:extend(corps)
  if dessous then blocs:extend(legende) end
  blocs:extend(notes)
  blocs:insert(pandoc.RawBlock('html', '</figure>'))
  return blocs
end
