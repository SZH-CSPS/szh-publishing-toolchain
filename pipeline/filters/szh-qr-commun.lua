-- Fonction partagée pour générer un QR code en SVG inline (un seul <path> pour tous les
-- modules noirs), à partir de l'encodeur Lua pur vendoré dans vendor/luaqrcode/qrencode.lua
-- (speedata/luaqrcode, BSD-3 — voir ce fichier pour la provenance exacte, URL et commit).
--
-- Chargé par dofile (patron décrit en tête de szh-commun.lua) : le dossier de CE fichier se
-- retrouve par debug.getinfo, jamais par PANDOC_SCRIPT_FILE, qui nomme le script que pandoc
-- a reçu en ligne de commande — pas celui qui appelle dofile.
--
-- Trois appelants aujourd'hui : szh-qr.lua (le lien `{.qr}` du rédacteur), szh-livre-
-- ecouter.lua (l'encadré « écouter cette histoire » de la page d'ouverture d'un chapitre —
-- même QR, sans le <a> ni l'attribut `taille` propres à la syntaxe markdown du lien), et le
-- cache de liens courts Shlink que les deux se partagent (M.lien_court ci-dessous).
-- C'est pourquoi svg_qr() rend le SVG nu : au lien de l'habiller (href, title, aria-label
-- sur le <a>, taille en CSS) revient à chaque appelant, pas à ce module.

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

-- Échappement minimal pour une valeur d'attribut HTML (l'URL et le texte alternatif
-- peuvent porter &, <, >, ").
local function echapper_attr(s)
  s = tostring(s or '')
  return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;'))
end
M.echapper_attr = echapper_attr

-- Un <path> par ligne de modules noirs, fusionnés en plages horizontales contiguës — pas
-- un rectangle par module : c'est ce qui rend le SVG « compact » (cahier des charges) sur
-- une version 5-6 (une centaine de modules de côté) plutôt que quelques milliers de commandes.
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

-- Rend le SVG (chaîne « <svg>…</svg> ») d'un QR code encodant `contenu` (typiquement une
-- URL). En succès : (svg, taille_modules). En échec (contenu trop long pour un QR — voir
-- qrencode.qrcode(), qui lève une assertion "Data too long to encode in QR code" au-delà de
-- la version 40) : (nil, message_erreur). L'appelant décide alors du repli (lien nu, etc.).
--
-- opts (toutes optionnelles) :
--   niveau_ec    1=L 2=M 3=Q 4=H — défaut 2 (M, le niveau demandé par le cahier des charges)
--   marge        marge de silence en modules — défaut 4 (le minimum du standard ISO 18004,
--                toujours dans le dessin : la quiet zone du cahier des charges du bloc
--                qr-link, pas seulement celle du lien `.qr` d'origine)
--   aria_label   texte complet de l'attribut aria-label posé sur le <svg> — défaut `contenu`
--                lui-même. Le préfixe « QR-Code : » n'est PAS ajouté ici : chaque appelant
--                compose son propre texte.
--   couleur      couleur des modules (le `color` du cahier des charges) — défaut '#000'
--   fond         couleur du rectangle de fond, ou nil/'transparent' pour AUCUN rectangle
--                (le SVG reste transparent, c'est ce qui laisse voir le `background` du
--                bloc qr-link — défaut nil : pas de rect, cohérent avec le défaut
--                `background: transparent` du cahier des charges)
function M.svg_qr(contenu, opts)
  opts = opts or {}
  if not contenu or contenu == '' then return nil, 'contenu vide' end
  local niveau_ec = opts.niveau_ec or 2
  local marge = opts.marge or 4
  local aria_label = opts.aria_label or contenu
  local couleur = opts.couleur or '#000'
  local fond = opts.fond

  local ok_appel, reussi, matrice_ou_msg = pcall(qrencode.qrcode, contenu, niveau_ec)
  if not ok_appel then return nil, tostring(reussi) end          -- assertion levée (trop long)
  if not reussi then return nil, tostring(matrice_ou_msg) end    -- échec explicite (rare)

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

-- Base64 standard (RFC 4648, alphabet A-Za-z0-9+/, complété par « = »). Écrit ici plutôt
-- que dépendre d'une bibliothèque : szh-qr.lua en a besoin pour poser le SVG en
-- background-image: url(data:image/svg+xml;base64,…) d'un <a> VIDE — voir son en-tête
-- pour la raison (un <a> qui contient un <svg> enfant casse le balisage PDF/UA du lien,
-- mesuré avec veraPDF sur le 23.09.2026 : WeasyPrint pose une zone cliquable par boîte
-- de l'intérieur du lien, au lieu d'une seule). Vérifié contre les vecteurs de test de la
-- RFC (« man » -> « bWFu », « light work. » -> « bGlnaHQgd29yay4= », etc.).
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

-- Cache des liens courts (URL longue -> URL courte), écrit par liens-courts.py dans le
-- dossier du livre. Format : une entrée par ligne, `"<longue>": "<courte>"`, guillemets et
-- antislashs échappés — voir liens-courts.py, ecrire_cache(). Un format à soi plutôt qu'un
-- vrai YAML : pas de dépendance à un analyseur, une seule paire par ligne à relire.
-- Chargé une fois, au premier appel, quel que soit l'appelant (szh-qr.lua et szh-livre-
-- ecouter.lua partagent le même cache en mémoire). Absent ou illisible : cache vide,
-- silencieusement (SZH_LIENS_COURTS peut ne pas être posé du tout — livre sans Shlink
-- configuré).
-- Déplacé ici depuis szh-qr.lua (23.09.2026) pour que l'encadré « écouter » y accède aussi,
-- sans dupliquer la lecture du fichier ni son format d'échappement — comportement de
-- szh-qr.lua inchangé, seul l'endroit qui porte le code a bougé.
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

-- L'URL courte si le cache Shlink en connaît une pour `url_longue`, sinon `url_longue`
-- telle quelle (livre sans Shlink configuré, ou URL absente du cache).
function M.lien_court(url_longue)
  return charger_cache_liens()[url_longue] or url_longue
end

-- ──────────────────────────────────────────────────────────────────────────────────────
-- Booléen tolérant (options `tracked` du cahier des charges du bloc qr-link, TOUTES en
-- anglais, mais la valeur elle-même tolère aussi oui/non) : true/false/yes/no/oui/non,
-- insensible à la casse. Valeur absente, vide, ou non reconnue -> `defaut`, jamais d'erreur
-- — une faute de frappe sur une option de mise en forme ne doit pas faire disparaître le QR.
function M.analyser_bool(valeur, defaut)
  if valeur == nil or valeur == '' then return defaut end
  local v = tostring(valeur):lower()
  if v == 'true' or v == 'yes' or v == 'oui' or v == '1' then return true end
  if v == 'false' or v == 'no' or v == 'non' or v == '0' then return false end
  return defaut
end

-- ──────────────────────────────────────────────────────────────────────────────────────
-- Contraste WCAG (couleur du QR contre son fond — voir M.construire_qr) : luminance
-- relative (formule sRGB de la norme, WCAG 2.x §1.4.3/1.4.11) puis ratio (L1+0.05)/(L2+0.05),
-- L1 la plus claire des deux. « transparent » compte comme blanc : c'est la comparaison la
-- plus sûre par défaut (une page imprimée est blanche), et l'appelant le dit dans son
-- message d'avertissement — le fond RÉEL (celui de l'encadré, du papier…) peut être plus
-- sombre, auquel cas le contraste réel serait pire que celui calculé ici, jamais meilleur.
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

-- Luminance relative (0..1) d'une couleur hexadécimale #RRGGBB/#RGB, ou nil si elle ne se
-- décode pas (repli : pas d'avertissement plutôt qu'un plantage sur une valeur libre du
-- rédacteur). 'transparent' (et '') -> luminance du blanc, voir la note ci-dessus.
function M.luminance(couleur)
  local c = tostring(couleur or ''):lower()
  if c == '' or c == 'transparent' then c = '#ffffff' end
  local r, g, b = hex_vers_rgb(c)
  if not r then return nil end
  return 0.2126 * canal_lineaire(r) + 0.7152 * canal_lineaire(g) + 0.0722 * canal_lineaire(b)
end

-- Ratio de contraste WCAG entre deux couleurs (1:1 à 21:1) ; nil si l'une des deux ne se
-- décode pas.
function M.ratio_contraste(c1, c2)
  local l1, l2 = M.luminance(c1), M.luminance(c2)
  if not l1 or not l2 then return nil end
  if l1 < l2 then l1, l2 = l2, l1 end
  return (l1 + 0.05) / (l2 + 0.05)
end

-- ──────────────────────────────────────────────────────────────────────────────────────
-- Le nom accessible par défaut du bloc qr-link (`title` omis) : « Lien vers : <url> » et
-- ses trois autres langues — la narrow no-break space devant le deux-points français suit
-- la même règle que le reste de la chaîne (szh-typographie.lua), écrite ici en dur : ce
-- filtre tourne APRÈS szh-typographie.lua dans FILTRES_CHAPITRE (voir livre.mk), un texte
-- qu'il écrit lui-même n'est donc jamais repassé par cette règle.
local TITRE_DEFAUT = {
  fr = 'Lien vers\u{202F}: %s',
  de = 'Link zu: %s',
  it = 'Link a: %s',
  en = 'Link to: %s',
}

-- Construit le <a> QR cliquable complet — VIDE, SVG en fond (voir szh-qr.lua en tête pour
-- le pourquoi PDF/UA) — à partir d'une URL et des options ANGLAISES du cahier des charges
-- du bloc qr-link. Point d'entrée UNIQUE pour szh-qr.lua (bloc qr-link seul ET forme courte
-- `{.qr}`) et pour szh-livre-entete.lua (qr-link embarqué dans un falc-header) : même
-- résolution Shlink, même palette, mêmes avertissements de contraste/quadri, écrits une
-- seule fois plutôt que dans chaque appelant.
--
-- opts :
--   tracked     bool, défaut true (false : lien d'origine, jamais passé par le cache Shlink)
--   background  CSS, défaut 'transparent'
--   color       CSS hexa #RRGGBB, défaut '#000000'
--   size        CSS (mm/cm/px/em…), défaut '25mm'
--   title       nom accessible ; nil/vide -> défaut par langue (TITRE_DEFAUT)
--   lang        'fr'|'de'|'it'|'en' ; défaut 'fr'
--   classe_sup  une classe CSS de plus sur le <a>, en plus de "szh-qr" (ex. le falc-header
--               y ajoute "szh-falc-header-qr" pour son propre `margin-top`)
--   avertir     function(code, phrase_fr, phrase_de) — jamais appelé si tout va bien
--
-- Rend le HTML du <a> en succès, ou (nil, message_erreur) si le contenu ne s'encode pas en
-- QR (URL trop longue) — à l'appelant de décider du repli, comme pour M.svg_qr.
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

  -- --qr-taille seulement si elle diffère du défaut CSS (partage-filtres.css,
  -- `var(--qr-taille, 25mm)`) : un <a> sans variable, sous ce défaut, est ce que les tests
  -- et le CSS existants attendent déjà pour la forme courte `.qr` sans option.
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
