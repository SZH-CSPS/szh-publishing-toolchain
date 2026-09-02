-- Images natives Word (.emf, .wmf) : substituées par un placeholder visible, et NOMMÉES.
--
-- ── Le problème ───────────────────────────────────────────────────────────────────
-- Word emballe dans un métafichier Windows tout ce qu'on y colle depuis une autre
-- application : un dessin, un graphique Excel, une capture d'écran, une équation. pandoc
-- EXTRAIT ces fichiers tels quels à l'import — ni lui ni la chaîne ne savent les rendre.
-- WeasyPrint s'y arrête net : Pillow n'a pas de moteur EMF hors de Windows, et lève
-- « OSError: cannot find loader for this WMF file » au milieu de la mise en page. La
-- compilation entière tombait alors, sur UNE image, et le seul message qui parvenait au
-- rédacteur était un « mv: cannot stat » sur le fichier temporaire jamais écrit.
-- C'est ainsi que le livre 2026-B399-VN_FALC est resté bloqué le 01.09.2026.
--
-- ── Le choix : substituer, pas refuser ────────────────────────────────────────────
-- Ce filtre ne bloque rien. Il remplace l'image par un placeholder qui dit « IMAGE À
-- REMPLACER », garde la place qu'occupait l'originale, et écrit un constat nommé. Le
-- document se compose donc jusqu'au bout, et le trou se VOIT sur l'épreuve, à sa place,
-- plutôt que de faire échouer la compilation sans dire où. Le geste attendu — reprendre le
-- Word, y remettre l'image en PNG, réimporter — est dans le message.
--
-- ── Pourquoi ici, et pas à l'import ──────────────────────────────────────────────
-- À l'import, il faudrait réécrire le .md du rédacteur ; à la compilation, on ne touche
-- à rien. Surtout, un filtre voit AUSSI les images des tableaux : docx-tables.py sort les
-- tableaux du corps dans tables/table-NN.html, et szh-tabelle-inclure.lua les réinjecte en
-- HTML brut. Une image citée là n'apparaît nulle part dans le .md — c'était le cas de
-- fig-73 au chapitre 09 du VN-FALC. Les deux formes sont traitées ci-dessous.
--
-- ⚠ Les motifs Lua n'ont PAS d'alternation « | » : ce ne sont pas des expressions
--   régulières. '%.(emf|wmf)$' matcherait le texte littéral « (emf|wmf) », donc jamais
--   rien, et le filtre se tairait TOUJOURS — exactement le défaut qui a fait passer
--   szh-legende-avant.lua pour actif pendant des mois. Deux motifs simples, l'un ou
--   l'autre. Ne pas y toucher sans relire cette note.
--
-- Position dans la chaîne : APRÈS szh-tabelle-inclure (sans quoi le HTML des tableaux
-- n'est pas encore là) et APRÈS szh-typographie (qui ne doit pas retoucher le libellé du
-- placeholder, qui est une décision de composition et non du texte de rédaction) ; AVANT
-- szh-grille et szh-figure, qui continuent de voir une Image ordinaire — la substitution
-- ne change que la cible et le texte alternatif, jamais la nature du nœud.

local EXTENSIONS = { '%.emf$', '%.wmf$' }

-- Le placeholder vit dans le toolkit, à côté des filtres. PANDOC_SCRIPT_FILE donne le
-- chemin de CE fichier : de quoi atteindre l'asset sans variable d'environnement ni
-- chemin codé en dur, et quel que soit le dossier depuis lequel pandoc est lancé (il
-- tourne dans celui de l'article, pas dans celui du toolkit).
local function chemin_placeholder()
  local moi = PANDOC_SCRIPT_FILE or ''
  local dossier = moi:match('^(.*)[/\\][^/\\]*$')
  if not dossier or dossier == '' then return nil end
  return dossier .. '/../media/image-a-remplacer.svg'
end

local PLACEHOLDER = chemin_placeholder()

-- Sans placeholder atteignable, ne rien faire : mieux vaut l'échec franc de WeasyPrint,
-- qui nomme au moins le fichier, qu'une image remplacée par une cible vide.
if not PLACEHOLDER then
  io.stderr:write('[metafichier-avertissement] placeholder-introuvable | '
    .. "Le substitut d'image du toolkit est introuvable : les images natives Word ne "
    .. 'seront pas remplacées. | [de] Der Bildersatz des Toolkits fehlt: '
    .. 'Word-Metadateien werden nicht ersetzt.\n')
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

-- Un constat par FICHIER, pas par occurrence : la même image citée trois fois ne doit
-- pas remplir le journal de trois lignes identiques. Même forme que les autres constats
-- de la chaîne (szh-maquette.lua) : code, champs nommés, phrase française, puis « [de] ».
local vus = {}

local function signaler(fichier)
  if vus[fichier] then return end
  vus[fichier] = true
  io.stderr:write(table.concat({
    '[metafichier-avertissement] image-native-word',
    'image « ' .. fichier .. ' »',
    "Il y a une image native Word (" .. (fichier:lower():match('%.wmf$') and 'wmf' or 'emf')
      .. ") dans ce fichier : « " .. fichier .. " ». La chaîne ne sait pas la rendre – "
      .. "seul Windows dessine ce format. Elle est remplacée dans l'épreuve par un "
      .. "placeholder « IMAGE À REMPLACER ». À faire : ouvrez le Word, clic droit sur "
      .. "cette image > « Enregistrer en tant qu'image » au format PNG, remettez le PNG à "
      .. "sa place, puis redéposez le document pour le réimporter.",
    '[de] Dieses Dokument enthält ein Word-Metabild (« ' .. fichier .. ' »), das die '
      .. 'Kette nicht rendern kann – nur Windows zeichnet dieses Format. Es wird im '
      .. 'Andruck durch einen Platzhalter « BILD ZU ERSETZEN » ersetzt. Zu tun: im Word '
      .. 'als PNG speichern, wieder einfügen und das Dokument erneut ablegen.',
  }, ' | ') .. '\n')
  io.stderr:flush()
end

-- Le texte alternatif du substitut, dans la langue du document. Un lecteur d'écran doit
-- entendre ce qui manque, et non le silence d'un alt vide — qui, sur un PDF/UA, passerait
-- de surcroît pour une image décorative.
local LIBELLE = {
  fr = 'IMAGE À REMPLACER – image native Word non rendue : ',
  de = 'BILD ZU ERSETZEN – nicht gerendertes Word-Metabild: ',
}
local libelle = LIBELLE.fr

local function alt_de(fichier)
  return libelle .. fichier
end

-- ---- Images pandoc ordinaires -------------------------------------------------------
-- Les attributs (width, height posés par l'import Word) sont CONSERVÉS : le placeholder
-- occupe exactement la boîte de l'image absente, et la mise en page ne se déplace pas
-- sous les autres illustrations. L'identifiant et les classes suivent de même.
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
-- szh-tabelle-inclure.lua pose le HTML de tables/table-NN.html en RawBlock : ce ne sont
-- plus des nœuds Image, et un walker Image ne les voit pas. On réécrit donc la balise
-- entière — plus sûr qu'un rafistolage d'attributs un par un, l'ordre et la présence de
-- `alt` variant d'un tableau à l'autre.
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
  -- Les dimensions d'origine, si le tableau les portait : même raison que pour une Image.
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

-- La langue se lit AVANT de parcourir le document : un walker Image seul ne saurait pas
-- dans quelle langue nommer ce qui manque. `lang` vient de buch.yaml pour un livre, de la
-- fiche de l'article pour un article ; en son absence, le français, langue de la maison.
function Pandoc(doc)
  local lang = doc.meta and doc.meta.lang
  if lang then
    local texte = pandoc.utils.stringify(lang):lower()
    if texte:match('^de') then libelle = LIBELLE.de end
  end
  return doc:walk({
    Image = remplacer_image,
    RawBlock = remplacer_brut,
    RawInline = remplacer_brut,
  })
end
