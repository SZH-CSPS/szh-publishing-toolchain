-- Place la légende avant l'image : pandoc écrit toujours <img> puis <figcaption>, et
-- l'ordre du DOM est celui que lisent le flux du PDF, l'extraction de texte et les
-- lecteurs d'écran — le corriger en CSS ne changerait que l'apparence. La Figure est
-- remplacée par la suite de blocs équivalente, seules les balises passant en HTML brut :
-- légende et image restent des blocs pandoc, donc alt, role, les data-* de crédits et
-- --embed-resources se comportent comme avant.
-- Doit tourner après szh-numerotation.lua, qui écrit « Figure N — », les crédits et
-- l'alt dans la Figure : après ce filtre-ci, il n'y a plus de Figure.
-- Réservé aux sorties HTML : un writer non-HTML jette les RawBlock html et les images
-- disparaîtraient. La garde ci-dessous le rappelle.

if not FORMAT:match('^html') then return {} end

-- Échappement HTML d'une valeur d'attribut (identifiant/classe d'un `![](){#id}`).
local function att(v)
  return (v:gsub('&', '&amp;'):gsub('"', '&quot;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

-- `<figure>` avec l'id et les classes de la Figure d'origine ; les autres attributs
-- de l'Attr ne sont pas repris, pandoc ne les émet pas non plus sur `<figure>`.
local function balise_ouvrante(fig)
  local bouts = { '<figure' }
  if fig.identifier and fig.identifier ~= '' then
    bouts[#bouts + 1] = ' id="' .. att(fig.identifier) .. '"'
  end
  if fig.classes and #fig.classes > 0 then
    bouts[#bouts + 1] = ' class="' .. att(table.concat(fig.classes, ' ')) .. '"'
  end
  bouts[#bouts + 1] = '>'
  return table.concat(bouts)
end

function Figure(fig)
  local blocs = pandoc.Blocks({ pandoc.RawBlock('html', balise_ouvrante(fig)) })
  -- Figure sans légende : pas de <figcaption> vide. Une figure décorative garde son
  -- <figure> et son image, szh-numerotation.lua l'ayant déjà déclarée décorative.
  if #fig.caption.long > 0 then
    blocs:insert(pandoc.RawBlock('html', '<figcaption>'))
    blocs:extend(fig.caption.long)
    blocs:insert(pandoc.RawBlock('html', '</figcaption>'))
  end
  blocs:extend(fig.content)
  blocs:insert(pandoc.RawBlock('html', '</figure>'))
  return blocs
end
