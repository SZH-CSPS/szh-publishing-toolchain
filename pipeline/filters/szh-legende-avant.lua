-- Place la légende avant l'image : pandoc écrit toujours <img> puis <figcaption>, et
-- l'ordre du DOM est celui que lisent le flux du PDF, l'extraction de texte et les
-- lecteurs d'écran — le corriger en CSS ne changerait que l'apparence. La Figure est
-- remplacée par la suite de blocs équivalente, seules les balises passant en HTML brut :
-- légende et image restent des blocs pandoc, donc alt, role, les data-* de crédits et
-- --embed-resources se comportent comme avant.
-- Doit tourner après szh-numerotation.lua, qui écrit « Figure N — », les crédits et
-- l'alt dans la Figure : après ce filtre-ci, il n'y a plus de Figure.
-- Exception : la <figcaption> d'une figure marquée .szh-credit-seul (szh-numerotation.lua,
-- images hors numérotation) ne porte pas de légende mais une mention de droits ; elle se
-- lit donc après l'image, comme dans l'usage imprimé. Une figure marquée
-- .szh-legende-dessous (livre normal, `legende: dessous`) garde aussi sa légende après.
-- La note de figure (<p class="szh-bloc-note">, posée par szh-numerotation.lua dans le
-- contenu de la Figure) reste toujours sous l'image, et après la <figcaption> d'un crédit
-- seul : elle est écartée du contenu et remise en dernier.
-- Réservé aux sorties HTML : un writer non-HTML jette les RawBlock html et les images
-- disparaîtraient. La garde ci-dessous le rappelle.
--
-- ⚠ Les motifs Lua n'ont pas d'alternation « | » (ce n'est pas une expression régulière) :
-- '^(html|epub)' matchait le texte littéral « (html|epub) », jamais trouvé en tête de
-- FORMAT ('html5', 'epub3'…) — le filtre se désactivait donc toujours, quel que soit le
-- format. C'était la cause réelle de A9 (légende sous l'image au lieu d'avant) : le
-- reste du fichier était correct et n'a jamais tourné. Deux motifs simples, l'un ou
-- l'autre, remplacent l'alternation absente.
if not (FORMAT:match('^html') or FORMAT:match('^epub')) then return {} end

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
  local blocs = pandoc.Blocks({ pandoc.RawBlock('html', balise_ouvrante(fig)) })
  local apres = credit_seul(fig)
  -- Figure sans légende : pas de <figcaption> vide. Une figure décorative garde son
  -- <figure> et son image, szh-numerotation.lua l'ayant déjà déclarée décorative.
  local legende = pandoc.Blocks({})
  if #fig.caption.long > 0 then
    legende:insert(pandoc.RawBlock('html',
      apres and '<figcaption class="szh-credit-seul">' or '<figcaption>'))
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
