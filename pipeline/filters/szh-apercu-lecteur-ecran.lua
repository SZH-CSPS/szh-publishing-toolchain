-- Encadré « ce qu'un lecteur d'écran reçoit », sous chaque image et chaque tableau de
-- l'aperçu du cockpit. Le PDF et le galley Word ne montrent ni les textes alternatifs ni
-- les descriptions de tableau : l'aperçu permet au rédacteur de les relire.
--
-- szh-numerotation.lua ne charge ce fichier que si SZH_APERCU=1 : rien n'en arrive dans
-- le PDF.
--
-- Le CSS est écrit ici, dans un <style> posé seulement s'il y a un encadré : print.css est
-- partagé avec le PDF.
--
-- Couleurs, toutes déjà dans print.css : #444, var(--c-ink), var(--c-rule), et la paire
-- d'alerte de .szh-tabelle-manquante (#b3261e / #fdecea). Sur le rose d'alerte, le texte
-- est à l'encre (Lc 95,6) ; le rouge (Lc 71,7) ne sert qu'au filet.
--
-- L'encadré n'est pas aria-hidden : un rédacteur aveugle doit pouvoir relire ses textes
-- alternatifs.
--
-- Aucune balise de ce fichier ne commence par « <table » : szh-numerotation.lua prendrait
-- l'encadré pour un tableau réinjecté (vérifié par test/js/apercu-lecteur-ecran.test.js).

local utils = pandoc.utils
local M = {}

-- ─── Libellés ────────────────────────────────────────────────────────────────
-- Dans la langue de l'article. Les mots reprennent ceux du formulaire du cockpit
-- (lib/i18n.js), pour que le rédacteur les reconnaisse. Les étiquettes ALT= et
-- DESCRIPTION= sont les noms des attributs et ne se traduisent pas.
local L = {
  fr = {
    entete       = "Ce qu’un lecteur d’écran reçoit",
    vide         = 'vide',
    sans_alt     = "aucun texte alternatif saisi, et rien ne déclare l’image décorative",
    decor        = "image purement décorative : pas de texte alternatif, c’est voulu",
    reprise      = 'reprend la légende',
    desc_absente = 'description longue non renseignée – elle est facultative',
    entetes      = 'en-têtes déclarés : %d',
    portee       = 'portée : %s',
    sans_portee  = '%d sans portée déclarée',
    sans_entete  = "aucun en-tête déclaré – un tableau peut légitimement n’en avoir aucun",
  },
  de = {
    entete       = 'Was ein Screenreader erhält',
    vide         = 'leer',
    sans_alt     = 'kein Alternativtext erfasst, und nichts erklärt das Bild als dekorativ',
    decor        = 'rein dekoratives Bild: kein Alternativtext, so gewollt',
    reprise      = 'übernimmt die Bildlegende',
    desc_absente = 'lange Beschreibung nicht erfasst – sie ist optional',
    entetes      = 'deklarierte Kopfzellen: %d',
    portee       = 'Bereich: %s',
    sans_portee  = '%d ohne deklarierten Bereich',
    sans_entete  = 'keine Kopfzelle deklariert – eine Tabelle kann zu Recht keine haben',
  },
  it = {
    entete       = 'Ciò che riceve un lettore di schermo',
    vide         = 'vuoto',
    sans_alt     = "nessun testo alternativo inserito, e nulla dichiara l’immagine decorativa",
    decor        = 'immagine puramente decorativa: nessun testo alternativo, è voluto',
    reprise      = 'ripete la didascalia',
    desc_absente = 'descrizione lunga non indicata – è facoltativa',
    entetes      = 'intestazioni dichiarate: %d',
    portee       = 'ambito: %s',
    sans_portee  = '%d senza ambito dichiarato',
    sans_entete  = 'nessuna intestazione dichiarata – una tabella può legittimamente non averne',
  },
  en = {
    entete       = 'What a screen reader receives',
    vide         = 'empty',
    sans_alt     = 'no alternative text entered, and nothing declares the image decorative',
    decor        = 'purely decorative image: no alternative text, by design',
    reprise      = 'repeats the caption',
    desc_absente = 'long description not provided — it is optional',
    entetes      = 'declared header cells: %d',
    portee       = 'scope: %s',
    sans_portee  = '%d without a declared scope',
    sans_entete  = 'no header cell declared — a table may legitimately have none',
  },
}

-- ─── Outils ──────────────────────────────────────────────────────────────────
local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function vide(t) return t == nil or t:match('^%s*$') ~= nil end

-- Échappe un texte venu de l'AST (alt=, légende). Les valeurs lues dans le HTML brut d'un
-- tableau sont déjà échappées et s'insèrent telles quelles.
local function ech(t)
  return (tostring(t or ''):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local pose = false      -- au moins un encadré posé : le <style> est nécessaire

local function ligne(contenu) return '<span class="szh-le-ligne">' .. contenu .. '</span>' end
local function etiq(t) return '<span class="szh-le-tag">' .. t .. '</span> ' end
local function note(t) return '<span class="szh-le-note">' .. ech(t) .. '</span>' end

-- Après une étiquette vient toujours la valeur : le texte, ou l'un des deux marqueurs de
-- vide ci-dessous. L'explication va sur une ligne de note : « ALT= image purement
-- décorative » se lirait comme un texte alternatif.
-- `absent` marque un vide normal ; `alerte`, le seul vide qui fait perdre de l'information.
local function absent(l) return '<span class="szh-le-absent">— ' .. ech(l.vide) .. ' —</span>' end
local function alerte(l) return '<span class="szh-le-vide">⚠ ' .. ech(l.vide) .. '</span>' end

-- `manque` : encadré rouge (voir encadre_image).
local function encadre(l, lignes, manque)
  pose = true
  local morceaux = { '<div class="szh-lecteur-ecran',
                     manque and ' szh-le-manque">' or '">',
                     '<b class="szh-le-entete">', ech(l.entete), '</b>' }
  for _, x in ipairs(lignes) do morceaux[#morceaux + 1] = x end
  morceaux[#morceaux + 1] = '</div>'
  return pandoc.RawBlock('html', table.concat(morceaux))
end

-- ─── Images ──────────────────────────────────────────────────────────────────
-- Quatre cas :
--   alt="…"                  -> le texte que le lecteur d'écran énoncera ;
--   alt=""                   -> image décorative, voulue ;
--   alt absent, une légende  -> la légende est reprise comme alt : une note le signale
--                               (le lecteur d'écran l'entendra deux fois) ;
--   alt absent, sans légende -> rien n'est lu : encadré rouge. C'est le cas que
--                               imagesSansAlternative() (lib/references.js) refuse à
--                               l'export OJS.
--
-- alt="" et alt absent ne se distinguent que sur l'AST intact : szh-numerotation.lua pose
-- ensuite alt="" partout où l'alt manque. Ce module est donc appelé au tout début de son
-- Pandoc(doc).
local function encadre_image(img, l)
  local attr = img.attributes['alt']
  local legende = trim(utils.stringify(img.caption))
  if attr ~= nil and not vide(attr) then
    return encadre(l, { ligne(etiq('ALT=') .. ech(trim(attr))) }, false)
  end
  if attr ~= nil then
    return encadre(l, { ligne(etiq('ALT=') .. absent(l)), ligne(note(l.decor)) }, false)
  end
  if legende ~= '' then
    return encadre(l, { ligne(etiq('ALT=') .. ech(legende) .. ' '
      .. note('(' .. l.reprise .. ')')) }, false)
  end
  return encadre(l, { ligne(etiq('ALT=') .. alerte(l)), ligne(note(l.sans_alt)) }, true)
end

-- ─── Tableaux ────────────────────────────────────────────────────────────────
-- Ligne d'en-têtes. Un tableau sans en-tête n'est pas une faute (RGAA, WCAG) : simple
-- note. Les <th> sans scope sont comptés, sans alerte : dans un tableau simple, la portée
-- d'un <th> de <thead> est implicite.
local function ligne_entetes(l, n_th, portees, sans_portee)
  if n_th == 0 then return ligne(note(l.sans_entete)) end
  local bouts = { string.format(l.entetes, n_th) }
  -- Les quatre portées de HTML d'abord, dans cet ordre, puis toute autre valeur telle
  -- quelle, pour qu'une portée invalide se voie.
  local vues, montrees = {}, {}
  for _, v in ipairs({ 'col', 'colgroup', 'row', 'rowgroup' }) do
    if portees[v] then
      vues[#vues + 1] = v .. ' × ' .. portees[v]
      montrees[v] = true
    end
  end
  local autres = {}
  for v in pairs(portees) do
    if not montrees[v] then autres[#autres + 1] = v end
  end
  table.sort(autres)
  for _, v in ipairs(autres) do vues[#vues + 1] = v .. ' × ' .. portees[v] end
  if #vues > 0 then bouts[#bouts + 1] = string.format(l.portee, table.concat(vues, ', ')) end
  if sans_portee > 0 then bouts[#bouts + 1] = string.format(l.sans_portee, sans_portee) end
  return ligne(note(table.concat(bouts, ' · ')))
end

-- Tableau réinjecté en HTML brut (szh-tabelle-inclure.lua), lu comme du texte. data-alt est
-- la description longue : masquée à l'écran et dans le PDF (partage-filtres.css), retirée
-- du Word (szh-galley-docx.lua), elle ne se relit qu'ici. Elle est facultative : son
-- absence n'est pas une alerte.
local function encadre_table_html(html, l)
  -- Retire d'abord les commentaires HTML : un commentaire qui mentionne « <th » serait
  -- compté comme en-tête.
  html = html:gsub('<!%-%-.-%-%->', '')
  local _, fin_tag, attrs = html:find('<[tT][aA][bB][lL][eE]([^>]*)>')
  if not fin_tag then return nil end
  if attrs ~= '' and not attrs:match('^[%s/]') then return nil end   -- pas un tableau

  local desc = attrs:match('%s[dD][aA][tT][aA]%-[aA][lL][tT]%s*=%s*"([^"]*)"')
            or attrs:match("%s[dD][aA][tT][aA]%-[aA][lL][tT]%s*=%s*'([^']*)'")
  local lignes = {}
  if vide(desc) then
    lignes[#lignes + 1] = ligne(etiq('DESCRIPTION=') .. absent(l))
    lignes[#lignes + 1] = ligne(note(l.desc_absente))
  else
    -- Valeur déjà échappée : elle sort d'un attribut HTML (voir ech()).
    lignes[#lignes + 1] = ligne(etiq('DESCRIPTION=') .. trim(desc))
  end

  local n_th, portees, n_portees = 0, {}, 0
  for _ in html:gmatch('<[tT][hH][%s>/]') do n_th = n_th + 1 end
  for v in html:gmatch('[sS][cC][oO][pP][eE]%s*=%s*"([^"]*)"') do
    v = trim(v):lower()
    if v ~= '' then
      portees[v] = (portees[v] or 0) + 1
      n_portees = n_portees + 1
    end
  end
  lignes[#lignes + 1] = ligne_entetes(l, n_th, portees, math.max(0, n_th - n_portees))
  return encadre(l, lignes, false)
end

-- Tableau markdown (« pipe table ») : le format n'a pas de description, l'encadré ne montre
-- que les en-têtes et leur portée (posée par szh-tabelle-scope.lua).
local function encadre_table_ast(tbl, l)
  local n_th, portees, n_portees = 0, {}, 0
  local function compter(cell)
    n_th = n_th + 1
    local v = trim((cell.attr.attributes['scope'] or '')):lower()
    if v ~= '' then
      portees[v] = (portees[v] or 0) + 1
      n_portees = n_portees + 1
    end
  end
  for _, row in ipairs(tbl.head.rows) do
    for _, cell in ipairs(row.cells) do compter(cell) end
  end
  for _, body in ipairs(tbl.bodies) do
    local n = body.row_head_columns or 0
    for _, row in ipairs(body.body) do
      for i = 1, math.min(n, #row.cells) do compter(row.cells[i]) end
    end
  end
  return encadre(l, { ligne_entetes(l, n_th, portees, math.max(0, n_th - n_portees)) },
                 false)
end

-- ─── Descente ────────────────────────────────────────────────────────────────
-- Parcours à la main plutôt qu'un filtre Blocks, qui descendrait dans le contenu d'une
-- Figure et y poserait un second encadré.
-- Limites : une image dans une cellule de tableau markdown n'a pas d'encadré ; une image
-- dans une note de bas de page a le sien après le paragraphe qui appelle la note.
local function images_de(bloc)
  local trouvees = {}
  bloc:walk({ Image = function(img) trouvees[#trouvees + 1] = img end })
  return trouvees
end

local descendre
descendre = function(blocs, l)
  local sortie = pandoc.Blocks({})
  for _, b in ipairs(blocs) do
    if b.t == 'Figure' or b.t == 'Para' or b.t == 'Plain' then
      sortie:insert(b)
      for _, img in ipairs(images_de(b)) do sortie:insert(encadre_image(img, l)) end
    elseif b.t == 'Table' then
      sortie:insert(b)
      sortie:insert(encadre_table_ast(b, l))
    elseif b.t == 'RawBlock' and (b.format == 'html' or b.format == 'html5') then
      sortie:insert(b)
      local e = encadre_table_html(b.text, l)
      if e then sortie:insert(e) end
    elseif b.t == 'Div' or b.t == 'BlockQuote' then
      b.content = descendre(b.content, l)
      sortie:insert(b)
    elseif b.t == 'BulletList' or b.t == 'OrderedList' then
      local items = pandoc.List()
      for _, item in ipairs(b.content) do items:insert(descendre(item, l)) end
      b.content = items
      sortie:insert(b)
    else
      sortie:insert(b)
    end
  end
  return sortie
end

-- ─── Feuille de style ────────────────────────────────────────────────────────
-- Encadré ordinaire : pointillé gris clair. Encadré d'alerte : aplat rose, filet rouge et
-- mot « vide » en gros, seul objet coloré de la page. Vide normal : gris italique.
-- La marge haute négative colle l'encadré à son image ou à son tableau, malgré la marge
-- de 1,4 em de figure/table.
local CSS = [[
.szh-lecteur-ecran{
  margin:-0.9em 0 1.6em; padding:.5em .7em;
  border:1px dashed var(--c-rule,#C9C6BE);
  font:12.5px/1.55 var(--font-mono,ui-monospace,monospace);
  color:var(--c-ink,#16161f); text-align:left; break-inside:avoid;
}
.szh-lecteur-ecran .szh-le-entete{
  display:block; margin-bottom:.3em;
  font:600 10px/1.4 var(--font-sans,system-ui,sans-serif);
  letter-spacing:.07em; text-transform:uppercase; color:#444;
}
.szh-lecteur-ecran .szh-le-ligne{ display:block; margin:.15em 0; }
.szh-lecteur-ecran .szh-le-tag{ font-weight:600; letter-spacing:.03em; }
.szh-lecteur-ecran .szh-le-note{
  font:italic 11.5px/1.5 var(--font-sans,system-ui,sans-serif); color:#444;
}
.szh-lecteur-ecran .szh-le-absent{
  font:italic 12px/1.5 var(--font-sans,system-ui,sans-serif); color:#444;
}
.szh-lecteur-ecran.szh-le-manque{
  border:2px dashed #b3261e; background:#fdecea; padding:.6em .8em;
}
.szh-lecteur-ecran .szh-le-vide{
  font-size:1.3em; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
}
]]

-- ─── Interface ───────────────────────────────────────────────────────────────
function M.blocs(blocs, lang)
  return descendre(blocs, L[lang] or L.fr)
end

-- Le <style>, ou nil si aucun encadré n'a été posé.
function M.style()
  if not pose then return nil end
  return pandoc.RawBlock('html', '<style>\n' .. CSS .. '</style>')
end

return M
