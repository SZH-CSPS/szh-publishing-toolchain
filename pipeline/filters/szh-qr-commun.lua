-- Module commun des QR codes : SVG d'un QR, <a> cliquable complet, cache des liens courts
-- Shlink, contraste des couleurs. L'encodeur est vendor/luaqrcode/qrencode.lua
-- (speedata/luaqrcode, BSD-3 ; provenance dans ce fichier).
--
-- Utilisé par szh-qr.lua, szh-qr-lister.lua et szh-livre-entete.lua.
-- svg_qr() rend un SVG nu : chaque appelant l'habille (lien, nom accessible, taille).
--
-- Chargé par dofile. Le dossier de ce fichier se lit par debug.getinfo : PANDOC_SCRIPT_FILE
-- donnerait celui du script passé à pandoc, qui peut être un autre.

local function dossier_ce_fichier()
  local source = debug.getinfo(1, 'S').source
  if source:sub(1, 1) == '@' then source = source:sub(2) end
  return source:match('^(.*[/\\])') or ''
end

local DOSSIER = dossier_ce_fichier()
local ok_charge, qrencode = pcall(dofile, DOSSIER .. 'vendor/luaqrcode/qrencode.lua')
if not ok_charge or type(qrencode) ~= 'table' or type(qrencode.qrcode) ~= 'function' then
  io.stderr:write('[szh-qr] Encodeur QR vendoré introuvable ou invalide : '
    .. DOSSIER .. 'vendor/luaqrcode/qrencode.lua\n')
  io.stderr:write('[szh-qr] [de] QR-Code-Encoder (vendored) nicht gefunden oder ungültig: '
    .. DOSSIER .. 'vendor/luaqrcode/qrencode.lua\n')
  os.exit(1, true)
end

local M = {}

-- Échappe &, <, > et " dans une valeur d'attribut HTML.
local function echapper_attr(s)
  s = tostring(s or '')
  return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;'))
end
M.echapper_attr = echapper_attr

-- Tracé des modules noirs : une commande par plage horizontale contiguë plutôt qu'un
-- rectangle par module, ce qui garde le SVG compact.
local function chemin_modules(matrice, taille, marge)
  local segs = {}
  for y = 1, taille do
    local x = 1
    while x <= taille do
      if matrice[x][y] > 0 then
        local x0 = x
        while x <= taille and matrice[x][y] > 0 do x = x + 1 end
        local largeur = x - x0
        segs[#segs + 1] = string.format('M%d %dh%dv1h-%dz', x0 - 1 + marge, y - 1 + marge, largeur, largeur)
      else
        x = x + 1
      end
    end
  end
  return table.concat(segs)
end

-- SVG (« <svg>…</svg> ») d'un QR code qui encode `contenu`, en général une URL.
-- Rend (svg, taille en modules), ou (nil, message) si le contenu est trop long pour un QR :
-- l'appelant choisit alors un repli.
--
-- opts, toutes facultatives :
--   niveau_ec    correction d'erreur, 1=L 2=M 3=Q 4=H ; défaut 2
--   marge        zone de silence en modules, dessinée dans le SVG ; défaut 4, le minimum
--                de la norme ISO 18004
--   aria_label   aria-label du <svg> ; défaut `contenu`
--   couleur      couleur des modules ; défaut '#000'
--   fond         couleur d'un rectangle de fond ; nil ou 'transparent' : pas de rectangle,
--                le fond de la page reste visible
function M.svg_qr(contenu, opts)
  opts = opts or {}
  if not contenu or contenu == '' then return nil, 'contenu vide' end
  local niveau_ec = opts.niveau_ec or 2
  local marge = opts.marge or 4
  local aria_label = opts.aria_label or contenu
  local couleur = opts.couleur or '#000'
  local fond = opts.fond

  local ok_appel, reussi, matrice_ou_msg = pcall(qrencode.qrcode, contenu, niveau_ec)
  if not ok_appel then return nil, tostring(reussi) end          -- assertion : contenu trop long
  if not reussi then return nil, tostring(matrice_ou_msg) end

  local matrice = matrice_ou_msg
  local taille = #matrice
  local total = taille + 2 * marge
  local chemin = chemin_modules(matrice, taille, marge)

  local rect = ''
  if fond and fond ~= '' and tostring(fond):lower() ~= 'transparent' then
    rect = '<rect width="' .. total .. '" height="' .. total .. '" fill="' .. echapper_attr(fond) .. '"/>'
  end

  local svg = table.concat({
    '<svg role="img" aria-label="', echapper_attr(aria_label), '" viewBox="0 0 ', total, ' ', total,
    '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">',
    rect,
    '<path d="', chemin, '" fill="', echapper_attr(couleur), '"/>',
    '</svg>',
  })
  return svg, taille
end

-- Base64 standard (RFC 4648). Sert à poser le SVG en background-image d'un <a> vide :
-- un <svg> enfant du <a> casse le balisage PDF/UA du lien, car WeasyPrint pose alors une
-- zone cliquable par boîte intérieure au lieu d'une seule.
local B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function M.base64(donnees)
  local resultat = {}
  local octets = #donnees
  for i = 1, octets, 3 do
    local b1, b2, b3 = donnees:byte(i, i + 2)
    b2 = b2 or 0
    b3 = b3 or 0
    local n = b1 * 65536 + b2 * 256 + b3
    local c1 = math.floor(n / 262144) % 64
    local c2 = math.floor(n / 4096) % 64
    local c3 = math.floor(n / 64) % 64
    local c4 = n % 64
    local reste = octets - i + 1
    resultat[#resultat + 1] = B64_CHARS:sub(c1 + 1, c1 + 1)
    resultat[#resultat + 1] = B64_CHARS:sub(c2 + 1, c2 + 1)
    resultat[#resultat + 1] = reste >= 2 and B64_CHARS:sub(c3 + 1, c3 + 1) or '='
    resultat[#resultat + 1] = reste >= 3 and B64_CHARS:sub(c4 + 1, c4 + 1) or '='
  end
  return table.concat(resultat)
end

-- Cache des liens courts (URL longue -> URL courte), écrit par liens-courts.py
-- (ecrire_cache()) dans le fichier que nomme SZH_LIENS_COURTS. Une entrée par ligne,
-- `"<longue>": "<courte>"`, guillemets et antislashs échappés ; ce n'est pas du YAML
-- complet. Lu une fois, au premier appel. Variable absente ou fichier illisible : cache
-- vide (livre sans Shlink).
local cache_liens = nil
local function charger_cache_liens()
  if cache_liens then return cache_liens end
  cache_liens = {}
  local chemin = os.getenv('SZH_LIENS_COURTS')
  if not chemin or chemin == '' then return cache_liens end
  local fh = io.open(chemin, 'r')
  if not fh then return cache_liens end
  local function deechapper(s) return (s:gsub('\\(["\\])', '%1')) end
  for ligne in fh:lines() do
    local longue, courte = ligne:match('^"(.-)":%s*"(.-)"%s*$')
    if longue and courte then
      cache_liens[deechapper(longue)] = deechapper(courte)
    end
  end
  fh:close()
  return cache_liens
end

-- L'URL courte connue du cache pour `url_longue`, sinon `url_longue` telle quelle.
function M.lien_court(url_longue)
  return charger_cache_liens()[url_longue] or url_longue
end

-- ──────────────────────────────────────────────────────────────────────────────────────
-- Lit un booléen d'option (`tracked`) : true/false, yes/no, oui/non, 1/0, sans égard à la
-- casse. Une valeur absente, vide ou inconnue rend `defaut`, pour qu'une faute de frappe ne
-- fasse pas disparaître le QR.
function M.analyser_bool(valeur, defaut)
  if valeur == nil or valeur == '' then return defaut end
  local v = tostring(valeur):lower()
  if v == 'true' or v == 'yes' or v == 'oui' or v == '1' then return true end
  if v == 'false' or v == 'no' or v == 'non' or v == '0' then return false end
  return defaut
end

-- ──────────────────────────────────────────────────────────────────────────────────────
-- Contraste WCAG entre la couleur du QR et son fond : luminance relative sRGB, puis ratio
-- (L1+0.05)/(L2+0.05), L1 étant la plus claire. « transparent » compte comme blanc, la
-- couleur du papier ; un fond réel plus sombre donnerait un contraste plus faible.
local function hex_vers_rgb(s)
  s = tostring(s or ''):gsub('^#', '')
  if #s == 3 then s = s:sub(1, 1):rep(2) .. s:sub(2, 2):rep(2) .. s:sub(3, 3):rep(2) end
  if #s ~= 6 then return nil end
  local r = tonumber(s:sub(1, 2), 16)
  local g = tonumber(s:sub(3, 4), 16)
  local b = tonumber(s:sub(5, 6), 16)
  if not (r and g and b) then return nil end
  return r, g, b
end

local function canal_lineaire(c)
  c = c / 255
  if c <= 0.03928 then return c / 12.92 end
  return ((c + 0.055) / 1.055) ^ 2.4
end

-- Luminance relative (0..1) d'une couleur #RRGGBB ou #RGB ; '' et 'transparent' valent
-- blanc. Rend nil pour une couleur non hexadécimale : aucun avertissement n'est alors émis.
function M.luminance(couleur)
  local c = tostring(couleur or ''):lower()
  if c == '' or c == 'transparent' then c = '#ffffff' end
  local r, g, b = hex_vers_rgb(c)
  if not r then return nil end
  return 0.2126 * canal_lineaire(r) + 0.7152 * canal_lineaire(g) + 0.0722 * canal_lineaire(b)
end

-- Ratio de contraste WCAG (de 1 à 21) ; nil si l'une des couleurs ne se lit pas.
function M.ratio_contraste(c1, c2)
  local l1, l2 = M.luminance(c1), M.luminance(c2)
  if not l1 or not l2 then return nil end
  if l1 < l2 then l1, l2 = l2, l1 end
  return (l1 + 0.05) / (l2 + 0.05)
end

-- ──────────────────────────────────────────────────────────────────────────────────────
-- Nom accessible par défaut, quand `title` est omis. L'espace fine insécable devant le
-- deux-points français est écrite en dur : szh-qr.lua tourne après szh-typographie.lua
-- (livre.mk), qui ne repasse donc pas sur ce texte.
local TITRE_DEFAUT = {
  fr = 'Lien vers\u{202F}: %s',
  de = 'Link zu: %s',
  it = 'Link a: %s',
}

-- Construit le <a> QR cliquable : un <a> vide, le SVG en image de fond (voir M.base64).
-- Sert au bloc qr-link, au lien `.qr` (szh-qr.lua) et au qr-link d'un falc-header
-- (szh-livre-entete.lua).
--
-- opts :
--   tracked     booléen ; défaut true. false garde l'URL d'origine, sans lien court
--   background  CSS ; défaut 'transparent'
--   color       hexadécimal #RRGGBB ; défaut '#000000'
--   size        longueur CSS ; défaut '25mm'
--   title       nom accessible ; vide : TITRE_DEFAUT dans la langue `lang`
--   lang        'fr', 'de' ou 'it' ; défaut 'fr'
--   classe_sup  classe ajoutée à "szh-qr" (le falc-header pose "szh-falc-header-qr")
--   avertir     function(code, phrase_fr, phrase_de), appelée si le contraste est sous
--               3:1 ou si le QR n'est pas noir (risque au tirage en quadrichromie)
--
-- Rend le HTML du <a>, ou (nil, message) si l'URL est trop longue pour un QR.
function M.construire_qr(url_longue, opts)
  opts = opts or {}
  local lang = opts.lang or 'fr'
  local tracked = opts.tracked
  if tracked == nil then tracked = true end
  local url_finale = tracked and M.lien_court(url_longue) or url_longue

  local background = opts.background
  if background == nil or background == '' then background = 'transparent' end
  local color = opts.color
  if color == nil or color == '' then color = '#000000' end
  local size = opts.size
  if size == nil or size == '' then size = '25mm' end

  local svg, erreur = M.svg_qr(url_finale, { couleur = color, fond = background })
  if not svg then return nil, erreur end

  local titre = opts.title
  if titre == nil or titre == '' then
    local patron = TITRE_DEFAUT[lang] or TITRE_DEFAUT.fr
    titre = string.format(patron, url_finale)
  end

  if opts.avertir then
    local ratio = M.ratio_contraste(color, background)
    if ratio and ratio < 3 then
      opts.avertir('qr-contraste-insuffisant',
        string.format(
          "La couleur du QR (%s) sur son fond (%s) donne un contraste de %.1f:1, sous le seuil de 3:1 (WCAG 1.4.11)\u{202F}: un fond transparent est comparé au blanc — le fond réel de la page peut aggraver l'écart.",
          color, background, ratio),
        string.format(
          "Die QR-Farbe (%s) auf ihrem Hintergrund (%s) ergibt einen Kontrast von %.1f:1, unter dem Schwellenwert von 3:1 (WCAG 1.4.11): ein transparenter Hintergrund wird mit Weiß verglichen — der tatsächliche Seitenhintergrund kann die Differenz verschärfen.",
          color, background, ratio))
    end
    if color:lower() ~= '#000000' then
      opts.avertir('qr-couleur-non-noire-imprimeur',
        string.format(
          "Dans le PDF imprimeur, ce QR n'est pas noir (%s)\u{202F}: un repérage quadri imparfait au tirage peut le rendre illisible au scan — à vérifier avec l'imprimeur, ou à repasser en noir.",
          color),
        string.format(
          "Im Druck-PDF ist dieser QR-Code nicht schwarz (%s): eine ungenaue Passerregistrierung beim Druck kann ihn beim Scannen unlesbar machen — mit der Druckerei klären oder auf Schwarz zurücksetzen.",
          color))
    end
  end

  local classes = 'szh-qr'
  if opts.classe_sup and opts.classe_sup ~= '' then classes = classes .. ' ' .. opts.classe_sup end

  -- --qr-taille n'est posée que si elle diffère du défaut de partage-filtres.css
  -- (`var(--qr-taille, 25mm)`).
  local style = 'background-image:url(data:image/svg+xml;base64,' .. M.base64(svg) .. ')'
  if size ~= '25mm' then
    style = style .. ';--qr-taille:' .. echapper_attr(size)
  end

  local html = string.format(
    '<a class="%s" href="%s" title="%s" aria-label="%s" style="%s"></a>',
    classes, echapper_attr(url_finale), echapper_attr(titre), echapper_attr(titre), style)
  return html
end

return M
