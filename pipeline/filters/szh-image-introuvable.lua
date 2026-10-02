-- Image appelée par le texte mais absente du disque : un cadre à sa place, qui la nomme.
--
-- Le cadre est du texte réel (« Image introuvable : x.png »), jamais une image : il se lit,
-- se cherche et se balise comme un paragraphe. Une figure est remplacée en entier, légende
-- comprise ; une image en ligne, ou dans une grille, par un cadre en ligne. Les <img> du
-- HTML brut (tableaux réinjectés par szh-tabelle-inclure.lua) le sont aussi.
--
-- Le constat part sous rendu/image-manquante, le code que pandoc et WeasyPrint faisaient
-- remonter avant ce filtre : une fois l'image remplacée, eux n'en disent plus rien. C'est un
-- avertissement, la compilation continue ; l'export et l'archivage, eux, refusent
-- (lib/export-ojs.js).
--
-- Place dans la chaîne : après szh-metafichier.lua, dont le substitut existe, et après
-- szh-grille.lua, qui doit encore voir toutes les images d'une grille ; avant szh-figure.lua
-- et szh-numerotation.lua, pour qu'aucune figure vide ne soit construite ni numérotée.

local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[image-introuvable] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local CLASSE = 'szh-image-introuvable'

-- La fine insécable devant le deux-points est une décision de composition, comme le
-- « Source : » de szh-numerotation.lua : szh-typographie.lua est déjà passé.
local LIBELLE = {
  fr = 'Image introuvable\u{202F}: ',
  de = 'Bild nicht gefunden: ',
}
local libelle = LIBELLE.fr
local champ_unite = 'article'

local function nom_de_fichier(cible)
  return cible:match('([^/\\]+)$') or cible
end

local function existe(chemin)
  local f = io.open(chemin, 'rb')
  if f then f:close(); return true end
  return false
end

-- Une cible locale (ni URL, ni data:) qui ne s'ouvre pas, telle quelle ni décodée. Le
-- dossier courant est celui de l'unité : le Makefile y fait `cd` avant pandoc.
local function introuvable(src)
  if type(src) ~= 'string' or src == '' then return false end
  if src:match('^%a[%w+.-]*:') and not src:match('^%a:[/\\]') then return false end
  if existe(src) then return false end
  local decode = src:gsub('%%(%x%x)', function(h) return string.char(tonumber(h, 16)) end)
  return decode == src or not existe(decode)
end

-- Un constat par fichier, pas par insertion.
local vus = {}

local function signaler(src)
  if vus[src] then return end
  vus[src] = true
  local nom = commun.sans_barre(nom_de_fichier(src))
  commun.constat('rendu', 'avertissement', 'image-manquante',
    { champ_unite .. ' « ' .. commun.slug_article() .. ' »',
      'image « ' .. commun.sans_barre(src) .. ' »' },
    "L'image « " .. nom .. " » est appelée par le texte mais introuvable sur le disque : "
      .. "un cadre la remplace dans le document, et l'export reste bloqué tant qu'elle manque.",
    'Das Bild «' .. nom .. '» wird im Text aufgerufen, ist aber auf der Festplatte nicht '
      .. 'zu finden: ein Rahmen ersetzt es im Dokument, und der Export bleibt gesperrt, '
      .. 'solange es fehlt.')
end

local function att(v)
  return (v:gsub('&', '&amp;'):gsub('"', '&quot;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function texte_cadre(src)
  return libelle .. nom_de_fichier(src)
end

-- Le libellé part en HTML brut : szh-cesure.lua prendrait sinon « Image », au milieu d'une
-- phrase, pour un nom propre, et cesserait de couper ce mot dans tout l'article.
local function libelle_cadre(src)
  return { pandoc.RawInline('html', att(texte_cadre(src))) }
end

local function attr_cadre(src, identifiant)
  return pandoc.Attr(identifiant or '', { CLASSE }, { ['data-szh-introuvable'] = src })
end

local function cadre_bloc(src, identifiant)
  signaler(src)
  return pandoc.Div({ pandoc.Para(libelle_cadre(src)) }, attr_cadre(src, identifiant))
end

-- La seule image d'une liste d'inlines, blancs mis à part ; nil sinon.
local function image_seule(inlines)
  local img = nil
  for _, i in ipairs(inlines) do
    if i.t == 'Image' then
      if img then return nil end
      img = i
    elseif i.t ~= 'Space' and i.t ~= 'SoftBreak' then
      return nil
    end
  end
  return img
end

-- ---- Les blocs : une figure, ou un paragraphe qui n'est qu'une image ---------------
local function figure(fig)
  if commun.a_classe(fig, 'szh-grille') then return nil end
  local images = {}
  fig.content:walk({ Image = function(img) images[#images + 1] = img end })
  if #images ~= 1 or not introuvable(images[1].src) then return nil end
  return cadre_bloc(images[1].src, fig.identifier)
end

local function paragraphe(p)
  local img = image_seule(p.content)
  if not img or not introuvable(img.src) then return nil end
  return cadre_bloc(img.src, img.identifier)
end

-- ---- Les images restantes, en ligne ou dans une grille -----------------------------
local function image(img)
  if not introuvable(img.src) then return nil end
  signaler(img.src)
  return pandoc.Span(libelle_cadre(img.src), attr_cadre(img.src, img.identifier))
end

-- ---- Le HTML brut ------------------------------------------------------------------
local function reecrire_balise(balise)
  local src = balise:match('src%s*=%s*"([^"]*)"') or balise:match("src%s*=%s*'([^']*)'")
  if not introuvable(src) then return balise end
  signaler(src)
  return '<span class="' .. CLASSE .. '" data-szh-introuvable="' .. att(src) .. '">'
    .. att(texte_cadre(src)) .. '</span>'
end

local function brut(el)
  if el.format ~= 'html' or not el.text:lower():find('<img', 1, true) then return nil end
  local sortie = el.text:gsub('<[iI][mM][gG][^>]*>', reecrire_balise)
  if sortie == el.text then return nil end
  el.text = sortie
  return el
end

-- Les blocs d'abord : un parcours d'un seul tenant traiterait les Image avant les Figure
-- qui les contiennent, et la légende resterait seule.
function Pandoc(doc)
  local contexte = commun.contexte(doc.meta)
  libelle = LIBELLE[contexte.lang] or LIBELLE.fr
  if contexte.unite == 'chapitre' then champ_unite = 'chapitre' end
  doc = doc:walk({ Figure = figure, Para = paragraphe })
  return doc:walk({ Image = image, RawBlock = brut, RawInline = brut })
end
