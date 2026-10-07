-- Livres : l'encadré « écouter cette histoire » de la première page d'un chapitre, écrit
-- dans le .md du chapitre.
--
-- Syntaxe, n'importe où dans le chapitre (`{.falc-header}` est aussi accepté) :
--
--   :::: falc-header
--   Diese Geschichte gibt es auch zum Hören.
--
--   1. Scannen Sie den QR-Code.
--   2. Hören Sie zu.
--
--   ![Ein weisses Schnecken-Haus](media/escargot.jpg)
--
--   ::: qr-link
--   https://link.szh-csps.ch/BuchLS_03_audio
--   :::
--   ::::
--
-- Quatre parties, toutes facultatives :
--   * du texte, en un ou plusieurs paragraphes : chaque ligne écrite devient une ligne
--     imprimée, quel que soit le lecteur (voir lignes_en_inlines) ;
--   * des étapes, en liste numérotée (la première trouvée) : un <ol> dont les numéros
--     passent par ::marker (LI > Lbl dans le PDF) ; le texte devient alors son intitulé ;
--   * une image, avec un texte alternatif obligatoire (`![alt](chemin)`) : sans alt,
--     l'image est omise (PDF/UA-1 7.3) ;
--   * un bloc qr-link, aux mêmes options que celui de szh-qr.lua.
--
-- Placement : après le titre du chapitre, et après le bloc auteurs s'il y en a un. Le
-- filtre retire le Div `falc-header` de là où il est écrit et le réinsère à cette place.
-- Il vient donc juste après szh-livre-auteurs.lua dans FILTRES_CHAPITRE
-- (pipeline/profils/livre.mk).
--
-- Balisage (une autre maquette ne demande que du CSS) :
--   <div class="szh-falc-header" data-image="oui|non">
--     <div class="szh-falc-header-texte">
--       <p>Ligne 1<br>Ligne 2…</p>       <!-- <p class="szh-falc-header-titre"> s'il y a des étapes -->
--       <ol class="szh-falc-header-etapes"><li>…</li></ol>   <!-- seulement avec des étapes -->
--       <a class="szh-qr szh-falc-header-qr" href="…" title="…" aria-label="…" style="…"></a>
--     </div>
--     <img class="szh-falc-header-image" src="…" alt="…">   <!-- seulement si data-image="oui" -->
--   </div>
-- Le lien QR suit le modèle de szh-qr-commun.lua : un <a> vide, le SVG en image de fond,
-- pour n'avoir qu'une zone cliquable.
--
-- L'image n'est pas décorative : c'est un <img> ordinaire, embarqué par --embed-resources
-- comme les autres images du chapitre.
--
-- Ce filtre ne voit pas l'image elle-même : szh-livre-entete-image.lua, plus tôt dans la
-- chaîne, l'a retirée du Div et rangée dans ses attributs img-src, img-alt et img-extra.
-- Sinon szh-figure.lua et szh-numerotation.lua la numéroteraient comme une figure.
--
-- Dans l'aperçu, les blocs enfants du Div sont enveloppés dans des Div « wrapper=1 »
-- (lecteur `commonmark_x+sourcepos`) : sans_enveloppe() les traverse, comme dans
-- szh-grille.lua.
--
-- Cas particuliers, signalés par un avertissement sans arrêter la compilation :
--   * bloc vide (ni texte, ni étapes, ni image, ni qr-link) : rien n'est imprimé ;
--   * plusieurs images : seule la première est gardée ;
--   * image sans alt : l'image est omise, le reste de l'encadré est imprimé ;
--   * plusieurs blocs falc-header dans le chapitre : seul le premier est imprimé.

local function dossier_ce_fichier()
  local source = debug.getinfo(1, 'S').source
  if source:sub(1, 1) == '@' then source = source:sub(2) end
  return source:match('^(.*[/\\])') or ''
end

local DOSSIER = dossier_ce_fichier()

local ok_qr, commun_qr = pcall(dofile, DOSSIER .. 'szh-qr-commun.lua')
if not ok_qr or type(commun_qr) ~= 'table' or type(commun_qr.construire_qr) ~= 'function' then
  io.stderr:write('[szh-livre-entete] module szh-qr-commun.lua introuvable ou invalide\n')
  io.stderr:write('[szh-livre-entete] [de] Modul szh-qr-commun.lua nicht gefunden oder ungültig\n')
  os.exit(1, true)
end

local ok_commun, commun = pcall(dofile, DOSSIER .. 'szh-commun.lua')
if not ok_commun or type(commun) ~= 'table' then
  io.stderr:write('[szh-livre-entete] module szh-commun.lua introuvable ou invalide\n')
  io.stderr:write('[szh-livre-entete] [de] Modul szh-commun.lua nicht gefunden oder ungültig\n')
  os.exit(1, true)
end

local S = pandoc.utils.stringify

local texte = commun.texte

local function ech(v)
  return (texte(v):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end
local function ech_attr(v)
  return (ech(v):gsub('"', '&quot;'))
end

local function langue_de(meta)
  return commun.contexte(meta).lang
end

local a_classe = commun.a_classe

local function avertir(slug, code, phrase_fr, phrase_de)
  commun.constat('livre-entete', 'avertissement', code, { 'chapitre « ' .. slug .. ' »' }, phrase_fr, phrase_de)
end

-- Aplatit les Div « wrapper=1 » de l'aperçu, pour la lecture seulement : le Div entier
-- est ensuite remplacé par le HTML de l'encadré.
local function sans_enveloppe(blocs)
  local plat = pandoc.Blocks({})
  for _, b in ipairs(blocs) do
    if b.t == 'Div' and b.attributes and b.attributes['wrapper'] == '1' then
      for _, dedans in ipairs(sans_enveloppe(b.content)) do plat:insert(dedans) end
    else
      plat:insert(b)
    end
  end
  return plat
end

-- Une ligne écrite donne une ligne imprimée : SoftBreak et LineBreak deviennent tous deux un
-- saut de ligne, quel que soit le lecteur du chapitre (LECTEUR dans livre.mk). Plusieurs
-- paragraphes se suivent, séparés par un saut de ligne.
local function lignes_en_inlines(blocs_texte)
  local resultat = pandoc.Inlines({})
  for i, b in ipairs(blocs_texte) do
    if i > 1 then resultat:insert(pandoc.LineBreak()) end
    for _, inl in ipairs(b.content) do
      if inl.t == 'SoftBreak' or inl.t == 'LineBreak' then
        resultat:insert(pandoc.LineBreak())
      else
        resultat:insert(inl)
      end
    end
  end
  return resultat
end

local function premiere_ligne(inlines)
  local p = pandoc.Inlines({})
  for _, inl in ipairs(inlines) do
    if inl.t == 'LineBreak' then break end
    p:insert(inl)
  end
  return texte(S(p))
end

local function inlines_vers_html(inlines)
  local morceaux = {}
  for _, inl in ipairs(inlines) do
    if inl.t == 'LineBreak' then
      morceaux[#morceaux + 1] = '<br>'
    elseif inl.t == 'Str' then
      morceaux[#morceaux + 1] = ech(inl.text)
    elseif inl.t == 'Space' then
      morceaux[#morceaux + 1] = ' '
    else
      morceaux[#morceaux + 1] = ech(S({ inl }))
    end
  end
  return table.concat(morceaux)
end

-- Classe le contenu du Div falc-header : paragraphes de texte, première liste numérotée,
-- premier Div qr-link, et l'image lue dans les attributs du Div. Le reste (une liste à
-- puces, par exemple) est ignoré.
local function classer(div, slug)
  local blocs_texte, qr_div, etapes = {}, nil, nil
  for _, b in ipairs(sans_enveloppe(div.content)) do
    if b.t == 'Div' and a_classe(b, 'qr-link') then
      if not qr_div then qr_div = b end
    elseif b.t == 'OrderedList' then
      if not etapes then etapes = b end
    elseif b.t == 'Para' or b.t == 'Plain' then
      blocs_texte[#blocs_texte + 1] = b
    end
  end

  local attrs = div.attributes or {}
  local extra = tonumber(attrs['img-extra'] or '0') or 0
  if extra > 0 then
    avertir(slug, 'plusieurs-images',
      "Ce falc-header porte plusieurs images : seule la première est imprimée.",
      'Dieser falc-header enthält mehrere Bilder: nur das erste wird gedruckt.')
  end

  local image = nil
  if attrs['img-src'] then image = { src = attrs['img-src'], alt = texte(attrs['img-alt']) } end

  return blocs_texte, image, qr_div, etapes
end

-- Une étape par <li> ; ses paragraphes se suivent, séparés par un saut de ligne.
local function etapes_vers_html(liste)
  local items = {}
  for _, item in ipairs(liste.content) do
    local blocs = {}
    for _, b in ipairs(sans_enveloppe(item)) do
      if b.t == 'Para' or b.t == 'Plain' then blocs[#blocs + 1] = b end
    end
    local lignes = lignes_en_inlines(blocs)
    if #lignes > 0 then items[#items + 1] = '<li>' .. inlines_vers_html(lignes) .. '</li>' end
  end
  if #items == 0 then return '' end
  return '<ol class="szh-falc-header-etapes">' .. table.concat(items) .. '</ol>'
end

local function construire_encadre(div, lang, slug)
  local blocs_texte, image, qr_div, etapes = classer(div, slug)

  local lignes = lignes_en_inlines(blocs_texte)
  local a_texte = #lignes > 0
  local etapes_html = etapes and etapes_vers_html(etapes) or ''

  local avec_image, img_html = false, ''
  if image then
    if image.alt == '' then
      avertir(slug, 'image-sans-alt',
        "L'image du falc-header n'a pas de texte alternatif : elle n'est pas imprimée — un lecteur d'écran n'en dirait rien.",
        'Das Bild des falc-header hat keinen Alternativtext: es wird nicht gedruckt — ein Screenreader würde dazu nichts sagen.')
    else
      avec_image = true
      img_html = string.format('<img class="szh-falc-header-image" src="%s" alt="%s">',
        ech_attr(image.src), ech_attr(image.alt))
    end
  end

  local qr_html = ''
  if qr_div then
    local url = texte(S(qr_div.content))
    if url == '' then
      avertir(slug, 'qr-link-vide',
        "Le qr-link du falc-header est vide : sans URL, aucun QR ne s'imprime.",
        'Der qr-link des falc-header ist leer: ohne URL wird kein QR-Code gedruckt.')
    else
      local attrs = qr_div.attributes or {}
      -- Nom accessible : le `title=` du qr-link, sinon la première ligne du texte de
      -- l'encadré, sinon le libellé par défaut de szh-qr-commun.lua.
      local titre = attrs['title']
      if (titre == nil or titre == '') and a_texte then titre = premiere_ligne(lignes) end
      local html, erreur = commun_qr.construire_qr(url, {
        tracked = commun_qr.analyser_bool(attrs['tracked'], true),
        background = attrs['background'],
        color = attrs['color'],
        size = attrs['size'],
        title = titre,
        lang = lang,
        classe_sup = 'szh-falc-header-qr',
        avertir = function(code, fr, de) avertir(slug, code, fr, de) end,
      })
      if html then
        qr_html = html
      else
        io.stderr:write('[szh-livre-entete] QR impossible pour « ' .. url .. ' » : ' .. tostring(erreur) .. '\n')
        io.stderr:write('[szh-livre-entete] [de] QR nicht möglich für « ' .. url .. ' »: ' .. tostring(erreur) .. '\n')
        -- Repli : un lien texte.
        qr_html = string.format('<a href="%s">%s</a>', ech_attr(url), ech(url))
      end
    end
  end

  if not a_texte and not avec_image and qr_html == '' and etapes_html == '' then
    avertir(slug, 'bloc-vide',
      "Ce falc-header est vide (ni texte, ni image, ni qr-link reconnus) : rien n'est imprimé.",
      'Dieser falc-header ist leer (weder Text noch Bild noch qr-link erkannt): nichts wird gedruckt.')
    return nil
  end

  local html = {
    '<div class="szh-falc-header" data-image="' .. (avec_image and 'oui' or 'non') .. '">',
    '<div class="szh-falc-header-texte">',
  }
  if a_texte then
    local ouvrant = etapes_html ~= '' and '<p class="szh-falc-header-titre">' or '<p>'
    html[#html + 1] = ouvrant .. inlines_vers_html(lignes) .. '</p>'
  end
  html[#html + 1] = etapes_html
  html[#html + 1] = qr_html
  html[#html + 1] = '</div>'
  if avec_image then html[#html + 1] = img_html end
  html[#html + 1] = '</div>'

  return pandoc.RawBlock('html', table.concat(html))
end

-- Le bloc auteurs d'un chapitre, sous ses deux formes : <p class="szh-auteurs">
-- (szh-livre-auteurs.lua) ou Div `.szh-auteurs` importé du Word (docx-styles-corps.py).
local function est_bloc_auteurs(b)
  if b == nil then return false end
  if b.t == 'RawBlock' and b.format == 'html'
    and b.text:find('<p class="szh-auteurs">', 1, true) == 1 then
    return true
  end
  return b.t == 'Div' and b.classes ~= nil and b.classes:includes('szh-auteurs')
end

function Pandoc(doc)
  if commun.contexte(doc.meta).produit ~= 'livre' then return doc end

  local slug = texte(doc.meta and doc.meta.slug)
  if slug == '' then slug = '?' end
  local lang = langue_de(doc.meta)

  -- Retire tous les Div falc-header du document, à n'importe quelle profondeur.
  local trouves = {}
  doc.blocks = doc.blocks:walk({
    Div = function(el)
      if a_classe(el, 'falc-header') then
        trouves[#trouves + 1] = el
        return {} -- réinséré plus bas, sous le titre
      end
    end,
  })

  if #trouves == 0 then return doc end
  if #trouves > 1 then
    avertir(slug, 'plusieurs-falc-header',
      string.format("Ce chapitre porte %d blocs falc-header : seul le premier (dans l'ordre du texte) est imprimé.", #trouves),
      string.format('Dieses Kapitel enthält %d falc-header-Blöcke: nur der erste (in Textreihenfolge) wird gedruckt.', #trouves))
  end

  local encadre = construire_encadre(trouves[1], lang, slug)
  if not encadre then return doc end

  -- Sous le premier titre (le titre du chapitre), et après le bloc auteurs s'il y en a un.
  local i = nil
  for rang, b in ipairs(doc.blocks) do
    if b.t == 'Header' then i = rang; break end
  end
  if not i then return doc end

  if doc.blocks[i + 1] and est_bloc_auteurs(doc.blocks[i + 1]) then i = i + 1 end

  doc.blocks:insert(i + 1, encadre)
  return doc
end
