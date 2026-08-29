-- Encadré « ce qu'un lecteur d'écran reçoit », sous chaque image et chaque tableau de
-- l'APERÇU du cockpit. Un texte alternatif, une description de tableau, se saisissent une
-- fois dans un formulaire et ne se relisent plus jamais : ni le PDF ni le galley Word ne
-- les montrent. L'aperçu est le seul endroit où le rédacteur regarde vraiment son article,
-- donc le seul endroit où ce travail-là peut se relire. C'est de l'accessibilité au second
-- degré : rendre vérifiable, par la personne qui le fait, un travail dont le résultat est
-- invisible.
--
-- ⚠ Ce fichier n'est LU que quand SZH_APERCU=1. szh-numerotation.lua le charge par dofile
-- sous cette seule condition (même mécanisme que szh-citations.lua, qui ne pose ses marques
-- d'appel douteux que dans l'aperçu). La chaîne du PDF n'ouvre donc pas ce fichier : ni
-- balisage, ni règle CSS, ni classe ne peut en sortir. C'est la garantie la plus forte
-- qu'on puisse donner au « le PDF publié n'en porte aucune trace ».
--
-- Pourquoi le CSS est ici et non dans print.css : l'aperçu et le PDF partagent print.css,
-- une règle écrite là-bas partirait donc aussi avec le PDF — inoffensive tant qu'aucun
-- élément ne porte la classe, mais c'est un fil qui traîne. Et une feuille séparée
-- demanderait un troisième --css dans le Makefile. Le <style> est donc écrit ici, à côté du
-- balisage qu'il habille, et n'existe que quand un encadré a été posé. Même procédé que le
-- <style> des images décoratives dans szh-numerotation.lua.
--
-- Aucune couleur nouvelle n'entre dans la palette : toutes celles employées sont déjà
-- déclarées et argumentées dans print.css — #444 (Lc 92,6 sur papier), var(--c-ink)
-- (104,7), var(--c-rule) (30,6, seuil non textuel), et la paire d'alerte de
-- .szh-tabelle-manquante, #b3261e / #fdecea. Mesuré avec pipeline/apca.py : l'encre sur le
-- rose d'alerte vaut Lc 95,6, le rouge n'y vaut que 71,7 — le texte de l'encadré d'alerte
-- est donc à l'encre, et le rouge ne porte que le filet et l'aplat, qui ne sont pas du
-- texte. test/apca-check.py garde ainsi ses 155 paires, 0 échec.
--
-- L'encadré n'est pas aria-hidden : un rédacteur aveugle doit pouvoir relire ses propres
-- textes alternatifs, c'est précisément le public de cet outil.
--
-- ⚠ Aucune balise de ce fichier ne doit commencer par « <table » : szh-numerotation.lua
-- reconnaît un tableau réinjecté au motif '<[tT][aA][bB][lL][eE]([^>]*)>', et ses encadrés
-- lui repasseraient sous le nez. test/js/apercu-lecteur-ecran.test.js le vérifie.

local utils = pandoc.utils
local M = {}

-- ─── Libellés ────────────────────────────────────────────────────────────────
-- Localisés sur la langue de composition de l'ARTICLE, comme « Figure » / « Abbildung » :
-- un encadré français sous les images d'un article allemand serait un défaut à lui seul.
-- Vocabulaire repris mot pour mot de lib/i18n.js du cockpit — « Texte alternatif » /
-- « Alternativtext », « Description du tableau » / « Beschreibung der Tabelle », « Image
-- purement décorative » / « Rein dekoratives Bild » : le rédacteur doit reconnaître dans
-- l'aperçu les mots du formulaire où il a saisi la valeur.
-- Les étiquettes ALT= et DESCRIPTION= restent en clair et non traduites : ce sont les noms
-- des attributs, ils désignent la CASE du formulaire et pas une phrase, et ils survivent au
-- copier-coller dans un message d'aide. Toute la prose, elle, est traduite.
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

-- Échappement d'un texte venu de l'AST (attribut alt=, légende) avant insertion dans le
-- HTML de l'encadré. Les valeurs lues dans le HTML brut d'un tableau, elles, sont DÉJÀ
-- échappées — elles sortent d'un attribut — et s'insèrent telles quelles : les échapper
-- une seconde fois afficherait « &amp;amp; ». Même arbitrage que traiter_tableau, qui
-- recopie les crédits d'un data-* sans y toucher.
local function ech(t)
  return (tostring(t or ''):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local pose = false      -- un encadré au moins : sinon pas de <style> à la fin

local function ligne(contenu) return '<span class="szh-le-ligne">' .. contenu .. '</span>' end
local function etiq(t) return '<span class="szh-le-tag">' .. t .. '</span> ' end
local function note(t) return '<span class="szh-le-note">' .. ech(t) .. '</span>' end

-- Grammaire de l'encadré, tenue partout : après une étiquette vient TOUJOURS la valeur —
-- le texte lui-même, ou l'un des deux témoins de vide ci-dessous. La prose qui explique
-- vit sur une ligne de note, jamais dans l'emplacement de la valeur : « ALT= image
-- purement décorative » se lirait comme un texte alternatif qui dirait cela.
-- Deux témoins, et un seul est coloré : `absent` pour un vide légitime, `alerte` pour le
-- seul vide qui fasse perdre de l'information.
local function absent(l) return '<span class="szh-le-absent">— ' .. ech(l.vide) .. ' —</span>' end
local function alerte(l) return '<span class="szh-le-vide">⚠ ' .. ech(l.vide) .. '</span>' end

-- `manque` : le seul cas rouge de tout l'encadré. Voir encadre_image.
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
-- Quatre états, et un seul est signalé en rouge.
--
--   alt="…"            -> le texte, tel qu'un lecteur d'écran l'énoncera.
--   alt=""             -> déclaration « décorative ». C'est une INFORMATION, pas une
--                         absence : la revue prend cette décision exprès (les portraits
--                         d'auteur·e·s, par exemple). Jamais de rouge ici.
--   alt absent, mais une légende -> le rendu recopie la légende dans l'alt. Le rédacteur
--                         doit le savoir : le lecteur d'écran entendra deux fois la même
--                         phrase. Ce n'est pas une faute, seulement une redondance, donc
--                         une note et pas une alerte.
--   alt absent, aucune légende -> RIEN n'atteindra le lecteur d'écran, et rien ne dit que
--                         c'est voulu. C'est exactement le cas que imagesSansAlternative()
--                         de lib/references.js refuse à l'export OJS ; l'encadré le montre
--                         beaucoup plus tôt, à la relecture. Seul cas rouge.
--
-- La distinction alt="" / alt absent n'existe que sur l'AST INTACT : les passes suivantes
-- de szh-numerotation.lua posent alt="" partout où l'alt manque, et l'intention est alors
-- perdue. D'où la place de ce module, tout au début de Pandoc(doc).
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
-- Ligne d'en-têtes. Aucun en-tête n'est PAS une faute : ni le RGAA ni les WCAG n'exigent
-- qu'un tableau en ait un, ils exigent que celui qui existe soit déclaré. Le cockpit dit
-- déjà la même chose à l'import (« Si ce tableau n'a réellement pas d'en-tête, il n'y a
-- rien à faire ») ; l'encadré garde ce ton. Un <th> sans scope est signalé au compte, sans
-- alerte : dans un tableau simple, la colonne d'un <th> de <thead> est implicite.
local function ligne_entetes(l, n_th, portees, sans_portee)
  if n_th == 0 then return ligne(note(l.sans_entete)) end
  local bouts = { string.format(l.entetes, n_th) }
  -- Les quatre portées de HTML d'abord, dans cet ordre ; toute autre valeur ensuite,
  -- telle quelle. Une portée inventée doit se VOIR, pas se faire compter en silence.
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

-- Tableau réinjecté en HTML brut (szh-tabelle-inclure.lua) : opaque à l'AST, on lit le
-- texte. data-alt est la description longue — le seul contenu de toute la chaîne qui
-- n'apparaisse NULLE PART ailleurs : print.css la masque à l'écran (elle n'est là que pour
-- l'aria-describedby), la retire en @media print, et szh-galley-docx.lua l'ôte du Word.
-- L'aperçu est donc le seul endroit où elle se relit. Absente, elle est facultative : pas
-- d'alerte, un simple témoin.
local function encadre_table_html(html, l)
  -- Commentaires retirés d'abord, et ce n'est pas une précaution théorique : les fichiers
  -- de tableau du corpus d'accessibilité expliquent en commentaire qu'« aucun <th scope>
  -- n'existe » — le compte d'en-têtes trouvait donc un en-tête dans la phrase qui dit
  -- qu'il n'y en a pas, et annonçait « 1 sans portée déclarée » sur un tableau qui n'a
  -- que des <td>. Un encadré qui se trompe sur ce point ne vaut rien : c'est justement le
  -- cas où il ne doit pas accuser.
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

-- Tableau écrit en markdown (« pipe table ») : pas de DESCRIPTION= du tout, le format ne
-- permet pas d'en saisir une. L'annoncer « non renseignée » désignerait une case qui
-- n'existe pas — l'encadré montre, il n'accuse pas. Reste la portée des en-têtes, posée
-- par szh-tabelle-scope.lua, que rien d'autre ne montre.
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
-- À la main, et non par un filtre Blocks : le contenu d'une Figure est lui aussi une liste
-- de blocs, un filtre Blocks y poserait donc un second encadré à l'intérieur de la figure.
-- Ici, une Figure est traitée une fois, à son propre niveau, et on ne redescend pas dedans.
-- (Même arbitrage que la descente à la main de szh-citations.lua, pour une autre raison.)
-- Deux limites assumées : une image posée dans la CELLULE d'un tableau markdown n'a pas
-- d'encadré (on ne descend pas dans les cellules, l'encadré n'aurait pas de place où se
-- mettre), et une image glissée dans une note de bas de page en reçoit un après le
-- paragraphe appelant, pas dans la note. Aucun des deux cas n'existe dans le corpus, et
-- les fabriquer serait plus coûteux que ce qu'ils rendraient.
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
-- Un champ vide doit se voir PLUS qu'un champ rempli : l'encadré d'alerte prend un aplat
-- rose, un filet rouge de 2 px et le mot VIDE en 1,3 em de gras espacé, là où l'encadré
-- ordinaire n'est qu'un pointillé gris clair. Sur une page compilée, c'est le seul objet
-- coloré : il se repère sans lire.
-- L'absence légitime (description de tableau non renseignée, aucun en-tête) est en gris
-- italique — visible d'un coup d'œil comme un emplacement vide, sans la couleur de
-- l'alerte. Montrer, pas accuser.
-- Le pointillé se colle à son élément par une marge haute négative : sans elle, la marge
-- de 1,4 em de figure/table le laisserait flotter entre deux objets, et on ne saurait plus
-- de quelle image il parle.
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

-- Le <style> ne part que si un encadré a été posé : un article sans image ni tableau sort
-- exactement comme avant.
function M.style()
  if not pose then return nil end
  return pandoc.RawBlock('html', '<style>\n' .. CSS .. '</style>')
end

return M
