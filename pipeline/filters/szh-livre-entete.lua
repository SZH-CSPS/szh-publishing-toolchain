-- Livre seulement : l'encadré « écouter cette histoire » de la première page d'un chapitre.
-- Renommé depuis szh-livre-ecouter.lua (23.09.2026) : la clé YAML `ecouter:` du
-- <slug>.meta.yaml disparaît, remplacée par un bloc écrit DIRECTEMENT dans le .md du
-- chapitre — aucun livre réel ne s'était mis à utiliser la clé YAML, rien à migrer.
--
-- Syntaxe, où qu'elle soit écrite dans le chapitre (accepte aussi `{.falc-header}`) :
--
--   :::: falc-header
--   Diese Geschichte gibt es auch zum Hören.
--   Scannen Sie den QR-Code.
--
--   ![Ein weisses Schnecken-Haus](media/escargot.jpg)
--
--   ::: qr-link
--   https://link.szh-csps.ch/BuchLS_03_audio
--   :::
--   ::::
--
-- Trois parties, toutes facultatives sauf le texte n'a de sens que si l'encadré n'est pas
-- vide (voir « bloc vide » plus bas) :
--   * du texte, en un ou plusieurs paragraphes — CHAQUE ligne écrite devient une ligne
--     imprimée (lecteur hard_line_breaks OU markdown normal : un saut de ligne SoftBreak et
--     un LineBreak sont traités pareil ici, voir normaliser_lignes) ;
--   * une image, texte alternatif OBLIGATOIRE (`![alt](chemin)`) — sans alt, l'image est
--     omise (avertissement), jamais un <img> muet (PDF/UA-1 7.3) ;
--   * un bloc qr-link (szh-qr-commun.lua, M.construire_qr — mêmes options que le bloc
--     qr-link autonome de szh-qr.lua, voir son en-tête).
--
-- Placement : juste après le titre (h1) du chapitre, et après le bloc auteurs
-- (szh-livre-auteurs.lua, <p class="szh-auteurs">, ou le Div `.szh-auteurs` importé du
-- Word) si ce chapitre en a un — d'où la place de ce filtre dans FILTRES_CHAPITRE
-- (pipeline/profils/livre.mk) : immédiatement après szh-livre-auteurs.lua, avant
-- szh-citations.lua. Un gabarit pandoc ne sait rien intercaler, il écrit ce qui suit
-- `$body$` : ce filtre retire donc le Div `falc-header` d'où il a été écrit et le
-- réinsère à la bonne place.
--
-- Balisage, classes STABLES (renommées .szh-ecouter* -> .szh-falc-header*, CSS web/epub
-- comprises) pour qu'une autre maquette de l'encadré ne demande que du CSS, jamais un
-- nouveau filtre :
--   <div class="szh-falc-header" data-image="oui|non">
--     <div class="szh-falc-header-texte">
--       <p>Ligne 1<br>Ligne 2…</p>
--       <a class="szh-qr szh-falc-header-qr" href="…" title="…" aria-label="…" style="…"></a>
--     </div>
--     <img class="szh-falc-header-image" src="…" alt="…">   <!-- seulement si data-image="oui" -->
--   </div>
-- Le lien QR reprend EXACTEMENT le patron de szh-qr-commun.lua/M.construire_qr — voir son
-- en-tête (un <a> VIDE, le SVG en background-image, jamais un <svg> enfant : mesuré au
-- veraPDF, une zone cliquable par boîte interne sinon, au lieu d'une seule).
--
-- L'image N'EST PAS décorative (elle illustre le contenu audio, l'alt est du texte
-- alternatif réel) : un <img> ordinaire, embarqué comme toute autre image du chapitre par
-- --embed-resources (chemin relatif au dossier du chapitre, comme `media/…` dans le corps).
--
-- ⚠ CE FILTRE NE VOIT PLUS JAMAIS L'IMAGE ELLE-MÊME : szh-livre-entete-image.lua (pré-passe,
-- juste après szh-typographie.lua dans FILTRES_CHAPITRE, bien avant szh-figure.lua/
-- szh-numerotation.lua) l'a déjà retirée du Div et stockée en attributs
-- (img-src/img-alt/img-extra) — voir son en-tête. Raison : szh-figure.lua et
-- szh-numerotation.lua numérotent SANS EXCEPTION toute image-seule qu'ils rencontrent, où
-- qu'elle soit dans le document ; sans cette protection, l'image du falc-header ressortait
-- « Abbildung 1 — … » en toutes lettres DANS le texte de l'encadré (mesuré 23.09.2026, une
-- légende de figure que rien ne demandait). classer() ci-dessous lit donc ces attributs,
-- jamais un Para/Figure d'image.
--
-- Repère de langue : `doc.meta.lang`, deux lettres — même cascade et même repli français
-- que szh-qr.lua (pas commun.langue_de() ici : cette clé n'a pas de fiche à part à lire ni
-- de jeton de revue à consulter, juste `lang:` déjà fusionné).
--
-- ⚠ Le lecteur `commonmark_x+sourcepos` de l'aperçu enveloppe chaque bloc IMBRIQUÉ (donc les
-- paragraphes de texte et le Div qr-link, enfants du Div falc-header) dans un Div
-- « wrapper=1 » — szh-sourcepos.lua ne les défait pas, à dessein (voir son en-tête : c'est
-- de là que vient le data-pos du clic vers la source). `sans_enveloppe()` ci-dessous les
-- traverse pour lire ce qu'il y a dedans, exactement comme szh-grille.lua le fait déjà pour
-- la même raison — sans jamais les retirer de l'arbre avant que ce filtre n'ait fini : le
-- Div falc-header entier est de toute façon remplacé en bloc par le RawBlock HTML qu'on
-- construit, wrappers compris.
--
-- Repli, jamais de plantage :
--   * pas de bloc `falc-header` dans le chapitre -> rien (le cas le plus fréquent) ;
--   * bloc vide (ni texte, ni image, ni qr-link reconnus) -> avertissement, rien d'imprimé ;
--   * plus d'une image -> avertissement, seule la première est gardée ;
--   * image sans alt -> avertissement, l'image est omise (le reste de l'encadré reste) ;
--   * deux blocs falc-header dans le même chapitre -> avertissement, seul le premier
--     (dans l'ordre du document) est imprimé, les suivants disparaissent silencieusement
--     après l'avertissement (aucune règle ne dit où imprimer un second encadré).

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

local S = pandoc.utils.stringify
local LIVRE = (os.getenv('SZH_LIVRE') or '') ~= ''

local function texte(v)
  if v == nil then return '' end
  local ok, r = pcall(S, v)
  if not ok then return '' end
  return (r:gsub('^%s+', ''):gsub('%s+$', ''))
end

local function ech(v)
  return (texte(v):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end
local function ech_attr(v)
  return (ech(v):gsub('"', '&quot;'))
end

local function langue_de(meta)
  local l = texte(meta and meta.lang)
  if l == '' then return 'fr' end
  return (l:lower():match('^(%a%a)')) or 'fr'
end

local function a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

local function avertir(slug, code, phrase_fr, phrase_de)
  io.stderr:write(table.concat({
    '[livre-entete-avertissement] ' .. code, 'chapitre « ' .. slug .. ' »', phrase_fr, '[de] ' .. phrase_de,
  }, ' | ') .. '\n')
end

-- Défait les Div « wrapper=1 » de szh-sourcepos.lua (aperçu seulement) pour lire ce qu'il y
-- a dedans — jamais dans le résultat final, seulement pour la classification ci-dessous.
-- Voir szh-grille.lua, même fonction, même raison (en-tête de ce fichier).
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

-- L'image du falc-header (détection/extraction) n'est PAS ici : szh-livre-entete-image.lua
-- (pré-passe) l'a déjà mise de côté en attributs du Div avant que ce filtre ne s'exécute —
-- voir son en-tête, et classer() plus bas.

-- Une ligne écrite = une ligne imprimée : SoftBreak et LineBreak comptent pareil, quel que
-- soit le lecteur du chapitre (markdown ou markdown+hard_line_breaks — voir livre.mk,
-- LECTEUR). Plusieurs paragraphes de texte dans le même falc-header se recollent avec un
-- saut de ligne entre eux, comme un `texte:` YAML à plusieurs blocs le faisait déjà avant
-- ce filtre.
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

-- Classe le contenu du Div falc-header : lignes de texte, Div qr-link (le premier trouvé).
-- L'IMAGE, elle, n'est plus ici : szh-livre-entete-image.lua (pré-passe, juste après
-- szh-typographie.lua dans FILTRES_CHAPITRE) l'a déjà retirée du contenu et stockée en
-- attributs du Div (img-src/img-alt/img-extra) — voir son en-tête pour pourquoi (protéger
-- l'image de la numérotation de figures, qui numérote SANS EXCEPTION toute image-seule
-- qu'elle rencontre, où qu'elle soit). Tout le reste du contenu (non prévu par le cahier
-- des charges, ex. une liste) est silencieusement ignoré — aucune place définie pour lui
-- dans l'encadré.
local function classer(div, slug)
  local blocs_texte, qr_div = {}, nil
  for _, b in ipairs(sans_enveloppe(div.content)) do
    if b.t == 'Div' and a_classe(b, 'qr-link') then
      if not qr_div then qr_div = b end
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

  return blocs_texte, image, qr_div
end

local function construire_encadre(div, lang, slug)
  local blocs_texte, image, qr_div = classer(div, slug)

  local lignes = lignes_en_inlines(blocs_texte)
  local a_texte = #lignes > 0

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
      -- Nom accessible : `title=` explicite du qr-link, sinon la première ligne du texte
      -- de l'encadré (pas une formule générique) — et seulement à défaut, le repli par
      -- langue de szh-qr-commun.lua (ni title ni texte : cas d'un qr-link seul, sans texte,
      -- dans un falc-header — rare mais pas empêché par la syntaxe).
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
        -- Repli : un vrai lien texte (même raison que szh-qr.lua pour le même cas).
        qr_html = string.format('<a href="%s">%s</a>', ech_attr(url), ech(url))
      end
    end
  end

  if not a_texte and not avec_image and qr_html == '' then
    avertir(slug, 'bloc-vide',
      "Ce falc-header est vide (ni texte, ni image, ni qr-link reconnus) : rien n'est imprimé.",
      'Dieser falc-header ist leer (weder Text noch Bild noch qr-link erkannt): nichts wird gedruckt.')
    return nil
  end

  local html = {
    '<div class="szh-falc-header" data-image="' .. (avec_image and 'oui' or 'non') .. '">',
    '<div class="szh-falc-header-texte">',
  }
  if a_texte then html[#html + 1] = '<p>' .. inlines_vers_html(lignes) .. '</p>' end
  html[#html + 1] = qr_html
  html[#html + 1] = '</div>'
  if avec_image then html[#html + 1] = img_html end
  html[#html + 1] = '</div>'

  return pandoc.RawBlock('html', table.concat(html))
end

-- Le bloc auteurs d'un chapitre, sous deux formes possibles (voir szh-livre-auteurs.lua et
-- docx-styles-corps.py) : repris à l'identique de l'ancien szh-livre-ecouter.lua.
local function est_bloc_auteurs(b)
  if b == nil then return false end
  if b.t == 'RawBlock' and b.format == 'html'
    and b.text:find('<p class="szh-auteurs">', 1, true) == 1 then
    return true
  end
  return b.t == 'Div' and b.classes ~= nil and b.classes:includes('szh-auteurs')
end

function Pandoc(doc)
  if not LIVRE then return doc end

  local slug = texte(doc.meta and doc.meta.slug)
  if slug == '' then slug = '?' end
  local lang = langue_de(doc.meta)

  -- Trouve TOUS les Div falc-header du document (à n'importe quelle profondeur : sous
  -- l'aperçu, un falc-header écrit au premier niveau du chapitre n'est pas lui-même
  -- enveloppé — seuls ses ENFANTS le sont, voir sans_enveloppe ci-dessus — mais rien
  -- n'empêche un rédacteur de l'imbriquer ailleurs). walk() suffit : il visite chaque Div,
  -- où qu'il soit.
  local trouves = {}
  doc.blocks = doc.blocks:walk({
    Div = function(el)
      if a_classe(el, 'falc-header') then
        trouves[#trouves + 1] = el
        return {} -- retiré d'où il était écrit ; réinséré plus bas au bon endroit
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
