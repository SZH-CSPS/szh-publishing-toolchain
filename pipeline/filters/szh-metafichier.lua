-- Remplace les images natives Word (.emf, .wmf) par un substitut visible, et les signale.
--
-- Word enregistre en métafichier Windows ce qu'on y colle depuis une autre application
-- (dessin, graphique Excel, équation). Pandoc extrait ces fichiers tels quels, et
-- WeasyPrint ne sait pas les lire hors de Windows (Pillow : « cannot find loader for this
-- WMF file ») : la compilation entière échouerait.
--
-- Le filtre ne bloque pas : l'image devient un substitut « IMAGE À REMPLACER » de même
-- taille, et un avertissement nomme le fichier et dit quoi faire (enregistrer l'image en
-- PNG dans le Word, puis réimporter). Le trou se voit sur l'épreuve, à sa place.
--
-- Le remplacement se fait à la compilation, sans toucher au .md. Il traite aussi les
-- images des tableaux, insérés en HTML brut par szh-tabelle-inclure.lua depuis
-- tables/table-NN.html.
--
-- Les motifs Lua n'ont pas d'alternative « | » : '%.(emf|wmf)$' ne trouverait jamais rien.
-- D'où deux motifs simples.
--
-- S'exécute après szh-tabelle-inclure.lua (le HTML des tableaux est là) et
-- szh-typographie.lua (qui ne retouche pas le libellé du substitut) ; avant szh-grille.lua
-- et szh-figure.lua, qui voient une Image ordinaire dont seuls la cible et l'alt changent.

local EXTENSIONS = { '%.emf$', '%.wmf$' }

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
    io.stderr:write('[metafichier] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

-- Le substitut est dans media/, à côté du dossier des filtres. Le chemin se déduit de
-- PANDOC_SCRIPT_FILE : pandoc tourne dans le dossier de l'article, pas dans celui des
-- filtres.
local function chemin_placeholder()
  local moi = PANDOC_SCRIPT_FILE or ''
  local dossier = moi:match('^(.*)[/\\][^/\\]*$')
  if not dossier or dossier == '' then return nil end
  return dossier .. '/../media/image-a-remplacer.svg'
end

local PLACEHOLDER = chemin_placeholder()

-- Sans substitut atteignable, le filtre ne fait rien : l'échec de WeasyPrint nomme au
-- moins le fichier, une cible vide ne dirait rien.
if not PLACEHOLDER then
  commun.constat('metafichier', 'avertissement', 'placeholder-introuvable', {},
    "Le substitut d'image du toolkit est introuvable : les images natives Word ne "
      .. 'seront pas remplacées.',
    'Der Bildersatz des Toolkits fehlt: Word-Metadateien werden nicht ersetzt.')
  return {}
end

local function nom_de_fichier(cible)
  return cible:match('([^/\\]+)$') or cible
end

local function est_metafichier(cible)
  if type(cible) ~= 'string' or cible == '' then return false end
  local bas = cible:lower()
  for _, motif in ipairs(EXTENSIONS) do
    if bas:match(motif) then return true end
  end
  return false
end

-- Un constat par fichier, même si l'image est citée plusieurs fois.
local vus = {}

local function signaler(fichier)
  if vus[fichier] then return end
  vus[fichier] = true
  commun.constat('metafichier', 'avertissement', 'image-native-word',
    { 'image « ' .. fichier .. ' »' },
    "Il y a une image native Word (" .. (fichier:lower():match('%.wmf$') and 'wmf' or 'emf')
      .. ") dans ce fichier : « " .. fichier .. " ». La chaîne ne sait pas la rendre – "
      .. "seul Windows dessine ce format. Elle est remplacée dans l'épreuve par un "
      .. "placeholder « IMAGE À REMPLACER ». À faire : ouvrez le Word, clic droit sur "
      .. "cette image > « Enregistrer en tant qu'image » au format PNG, remettez le PNG à "
      .. "sa place, puis redéposez le document pour le réimporter.",
    'Dieses Dokument enthält ein Word-Metabild (« ' .. fichier .. ' »), das die '
      .. 'Kette nicht rendern kann – nur Windows zeichnet dieses Format. Es wird im '
      .. 'Andruck durch einen Platzhalter « BILD ZU ERSETZEN » ersetzt. Zu tun: im Word '
      .. 'als PNG speichern, wieder einfügen und das Dokument erneut ablegen.')
end

-- Texte alternatif du substitut, dans la langue du document : un lecteur d'écran doit
-- entendre ce qui manque. Un alt vide ferait passer l'image pour décorative.
local LIBELLE = {
  fr = 'IMAGE À REMPLACER – image native Word non rendue : ',
  de = 'BILD ZU ERSETZEN – nicht gerendertes Word-Metabild: ',
}
local libelle = LIBELLE.fr

local function alt_de(fichier)
  return libelle .. fichier
end

-- ---- Images pandoc ordinaires -------------------------------------------------------
-- Les attributs (width, height posés par l'import Word), l'identifiant et les classes sont
-- conservés : le substitut occupe la boîte de l'image absente.
local function remplacer_image(img)
  if not est_metafichier(img.src) then return nil end
  local fichier = nom_de_fichier(img.src)
  signaler(fichier)
  img.src = PLACEHOLDER
  img.caption = { pandoc.Str(alt_de(fichier)) }
  img.attributes = img.attributes or {}
  img.attributes['data-szh-metafichier'] = fichier
  img.classes:insert('szh-image-a-remplacer')
  return img
end

-- ---- Images des tableaux réinjectés en HTML brut ------------------------------------
-- szh-tabelle-inclure.lua pose le HTML de tables/table-NN.html en RawBlock, que le walker
-- Image ne voit pas. La balise est réécrite entière, l'ordre et la présence de `alt`
-- variant d'un tableau à l'autre.
local function att(v)
  return (v:gsub('&', '&amp;'):gsub('"', '&quot;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function reecrire_balise(balise)
  local src = balise:match('src%s*=%s*"([^"]*)"')
  if not src then src = balise:match("src%s*=%s*'([^']*)'") end
  if not est_metafichier(src) then return balise end
  local fichier = nom_de_fichier(src)
  signaler(fichier)
  local bouts = { '<img src="' .. att(PLACEHOLDER) .. '"',
                  ' alt="' .. att(alt_de(fichier)) .. '"',
                  ' class="szh-image-a-remplacer"',
                  ' data-szh-metafichier="' .. att(fichier) .. '"' }
  -- Dimensions d'origine, si le tableau les portait.
  for _, cle in ipairs({ 'width', 'height' }) do
    local v = balise:match(cle .. '%s*=%s*"([^"]*)"')
    if v then bouts[#bouts + 1] = ' ' .. cle .. '="' .. att(v) .. '"' end
  end
  bouts[#bouts + 1] = '>'
  return table.concat(bouts)
end

local function remplacer_dans_html(texte)
  if not texte:lower():find('<img', 1, true) then return nil end
  local sortie = texte:gsub('<[iI][mM][gG][^>]*>', reecrire_balise)
  if sortie == texte then return nil end
  return sortie
end

local function remplacer_brut(el)
  if el.format ~= 'html' then return nil end
  local sortie = remplacer_dans_html(el.text)
  if not sortie then return nil end
  el.text = sortie
  return el
end

-- La langue est lue avant le parcours : le walker Image ne la connaît pas. Allemand si le
-- contexte le dit, français sinon.
function Pandoc(doc)
  if commun.contexte(doc.meta).lang == 'de' then libelle = LIBELLE.de end
  return doc:walk({
    Image = remplacer_image,
    RawBlock = remplacer_brut,
    RawInline = remplacer_brut,
  })
end
