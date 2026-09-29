-- Protège les noms propres de la césure automatique, en français seulement.
--
-- Le corps de la maquette est justifié avec césure automatique (print.css §4 : `p`, `li`,
-- `blockquote p` en `text-align: justify` + `hyphens: auto`), et WeasyPrint coupe alors
-- selon le dictionnaire Pyphen de la langue du document. Il coupe donc aussi les noms
-- propres — « Fri-bourg », « Mau-roux », « Dies-bach » — ce que le Guide du typographe
-- (Groupe de Lausanne de l'AST) proscrit en français : un nom de personne ou de lieu ne se
-- coupe pas. Ce filtre enveloppe les noms propres qu'il reconnaît dans un
-- <span class="szh-sans-cesure">, que styles/partage-filtres.css met en `hyphens: manual` :
-- la coupure automatique s'arrête là, une césure écrite à la main (soft hyphen U+00AD) est
-- toujours honorée, et la coupure à un trait d'union déjà présent — « Cudré-Mauroux » —
-- reste permise, parce qu'elle ne dépend pas de `hyphens` mais de UAX #14.
--
-- ⚠ FRANÇAIS SEULEMENT, et ce n'est pas un oubli : en allemand, tous les substantifs
-- portent la majuscule. La reconnaissance ci-dessous y prendrait la moitié du texte pour
-- des noms propres et éteindrait la césure d'une langue qui en a le plus besoin. La
-- Zeitschrift et un article allemand d'un numéro français se composent donc comme avant.
-- L'italien n'est pas traité non plus : aucun article italien n'est passé par la chaîne, et
-- une règle non éprouvée ne s'applique pas à une langue qu'on ne relit pas.
--
-- ── Ce qui est reconnu, et pourquoi c'est une heuristique ────────────────────────────────
-- Aucun lexique de noms propres n'est tenu ici : il faudrait le maintenir, et il serait
-- faux dès le premier article. La reconnaissance se fait sur la POSITION de la majuscule,
-- en deux passes sur le document entier.
--
--   Passe 1 — le relevé. Un mot est retenu comme nom propre quand il commence par une
--   majuscule, compte au moins 5 lettres, et :
--     * n'ouvre PAS une phrase (« ... de Fribourg (HETS-FR), ouvert ... ») — en français,
--       une majuscule au milieu d'une phrase est un nom propre ; ou
--     * ouvre une phrase mais est suivi d'un autre mot capitalisé (« Christian Singele
--       a 35 ans ») — la séquence de deux capitales est un nom de personne.
--   Passe 2 — l'application. Tout mot relevé est protégé PARTOUT dans l'article, y compris
--   là où il ouvre une phrase. C'est ce qui rattrape « Fribourg est une ville » quand
--   « Fribourg » apparaît une fois au milieu d'une phrase, ce qui est le cas ordinaire.
--
-- Le seuil de 5 lettres n'est pas arbitraire : c'est le premier terme de
-- `hyphenate-limit-chars`, dont WeasyPrint 69 prend (5, 2, 2) par défaut
-- (weasyprint/css/properties.py, lu le 08.09.2026). Un mot plus court n'est jamais coupé,
-- le protéger n'aurait aucun effet et coûterait un <span>.
--
-- Le défaut qui RESTE, écrit ici pour qu'on ne le redécouvre pas : un nom propre qui
-- n'apparaît QUE en tête de phrase et suivi d'un mot en minuscules n'est pas reconnu. Et à
-- l'inverse, un mot ordinaire cité en tête de citation au milieu d'une phrase
-- (« ... comme il dit : Depuis 2021 ... ») peut entrer au relevé et cesser de se couper.
-- Les deux sont sans gravité : le premier laisse la maquette d'avant, le second retire une
-- césure. Aucun des deux ne change le texte.
--
-- ── Ce que ce filtre ne touche pas ───────────────────────────────────────────────────────
-- Il ne voit que du texte pandoc. Les tableaux réinjectés (szh-tabelle-inclure.lua), les
-- figures dissoutes (szh-legende-avant.lua) et les grilles sont des RawBlock html à ce
-- stade de la chaîne : ni le relevé ni l'application n'y entrent, et leur texte sort
-- inchangé. Les titres h2–h6, eux, sont hors du RELEVÉ : szh-sections.lua ayant écrit le
-- numéro de section devant le titre, « Introduction » n'ouvre plus le texte du titre et
-- passait pour un nom propre au milieu d'une phrase — le mot cessait alors de se couper
-- dans le corps aussi. Ce qu'on y perd : un nom propre qui n'apparaîtrait QUE dans un
-- intertitre, et donc jamais dans le corps que ce filtre protège. L'application, elle, y
-- passe encore (un nom relevé ailleurs est enveloppé jusque dans un titre) et cela ne
-- change rien : les titres sont déjà en `hyphens: manual` (print.css §6).
--
-- Place dans la chaîne : après szh-rubrique.lua, avant szh-notes.lua. Après rubrique,
-- parce que le contenu d'une rubrique de la Documentation est du markdown analysé par ce
-- filtre-là et doit être protégé comme le reste ; après szh-citations.lua surtout, qui
-- reconnaît le titre de la bibliographie et apparie les appels SUR LE TEXTE — un <span>
-- posé avant lui casserait cet appariement. Avant szh-notes, pour que le texte des notes
-- soit protégé lui aussi (à ce stade ce sont encore des Note pandoc, que la traversée
-- visite).
--
-- ── Seconde passe, TOUTES LANGUES : la mise en forme sort des liens ──────────────────────
-- Ce fichier porte déjà la règle « aucun élément dans un <a> » (voir Link plus bas) ; la
-- seconde passe l'étend à la mise en forme de la rédaction — italique, gras, souligné,
-- barré, petites capitales, exposant, indice, span. Voir hisser_hors_des_liens.

local utils = pandoc.utils

-- ── Classes de caractères ───────────────────────────────────────────────────────────────
-- Points de code écrits en clair plutôt qu'un repli sur une bascule de casse : la
-- couverture voulue est celle des trois langues de la revue, et elle se relit ici. Les
-- deux trous du bloc Latin-1 sont les signes × (U+00D7) et ÷ (U+00F7), qui s'y trouvent
-- entre les lettres et ne sont pas des lettres.
local function est_majuscule(cp)
  if cp >= 0x41 and cp <= 0x5A then return true end                    -- A–Z
  if cp >= 0xC0 and cp <= 0xDE and cp ~= 0xD7 then return true end     -- À–Þ sauf ×
  if cp == 0x152 or cp == 0x178 then return true end                   -- Œ, Ÿ
  return false
end

local function est_minuscule(cp)
  if cp >= 0x61 and cp <= 0x7A then return true end                    -- a–z
  if cp >= 0xDF and cp <= 0xFF and cp ~= 0xF7 then return true end     -- ß–ÿ sauf ÷
  if cp == 0x153 then return true end                                  -- œ
  return false
end

local function est_lettre(cp)
  return est_majuscule(cp) or est_minuscule(cp)
end

-- Ce qui fait corps avec un mot. Le trait d'union en fait partie : « Cudré-Mauroux » et
-- « La Chaux-de-Fonds » sont un seul nom, et c'est le nom entier qu'on protège. Les
-- chiffres aussi, pour que « HES-SO » et « COVID-19 » restent d'une pièce.
-- L'apostrophe, au contraire, SÉPARE : sans cela « l'Argentine » serait un mot commençant
-- par une minuscule, et « Argentine » y perdrait sa protection.
local function est_du_mot(cp)
  return est_lettre(cp) or (cp >= 0x30 and cp <= 0x39) or cp == 0x2D
end

-- Les signes qui ferment une phrase. Les deux-points en font partie : en français, la
-- majuscule qui les suit ouvre presque toujours une citation, donc une phrase.
local FIN_DE_PHRASE = { [0x2E] = true, [0x21] = true, [0x3F] = true,   -- . ! ?
                        [0x2026] = true, [0x3A] = true }               -- … :

-- Découpe une chaîne en segments alternés : { texte = …, mot = true|false }. La
-- concaténation des segments rend exactement la chaîne d'entrée — c'est ce qui garantit
-- que la passe 2 ne change pas une lettre du texte.
local function segments(s)
  local sortie = {}
  local debut, dans_mot = 1, nil
  for pos, cp in utf8.codes(s) do
    local ici = est_du_mot(cp)
    if dans_mot == nil then
      dans_mot = ici
    elseif ici ~= dans_mot then
      table.insert(sortie, { texte = s:sub(debut, pos - 1), mot = dans_mot })
      debut, dans_mot = pos, ici
    end
  end
  if dans_mot ~= nil then
    table.insert(sortie, { texte = s:sub(debut), mot = dans_mot })
  end
  return sortie
end

-- Un mot candidat : majuscule d'attaque et au moins 5 lettres. Les traits d'union et les
-- chiffres ne comptent pas dans les 5 — c'est bien un compte de lettres.
local function candidat(mot)
  local premier = utf8.codepoint(mot, 1)
  if not est_majuscule(premier) then return false end
  local lettres = 0
  for _, cp in utf8.codes(mot) do
    if est_lettre(cp) then lettres = lettres + 1 end
  end
  return lettres >= 5
end

local function commence_par_majuscule(mot)
  return est_majuscule(utf8.codepoint(mot, 1))
end

-- ── Passe 1 : le relevé, sur le texte à plat de chaque bloc ──────────────────────────────
-- utils.stringify aplatit le bloc : c'est le seul moyen simple de lire les mots dans
-- l'ordre où ils se lisent, à travers les italiques, les liens et les guillemets, sans
-- reconstruire un état de phrase à chaque niveau d'imbrication.
local function relever(bloc, noms)
  local texte = utils.stringify(bloc)
  if texte == '' then return end

  -- Les mots du bloc, dans l'ordre, avec ce qui les précède.
  local mots = {}
  local debut_de_phrase = true          -- le premier mot d'un bloc ouvre une phrase
  for _, seg in ipairs(segments(texte)) do
    if seg.mot then
      table.insert(mots, { texte = seg.texte, ouvre = debut_de_phrase })
      debut_de_phrase = false
    else
      for _, cp in utf8.codes(seg.texte) do
        if FIN_DE_PHRASE[cp] then debut_de_phrase = true end
      end
    end
  end

  for i, m in ipairs(mots) do
    if candidat(m.texte) then
      if not m.ouvre then
        noms[m.texte] = true
      else
        -- Deux capitales de suite en tête de phrase : un nom de personne. Le second mot,
        -- lui, est au milieu d'une phrase et se relève tout seul à l'itération suivante.
        local suivant = mots[i + 1]
        if suivant and commence_par_majuscule(suivant.texte) then
          noms[m.texte] = true
        end
      end
    end
  end
end

-- ── Passe 2 : l'application, sur les Str ────────────────────────────────────────────────
local function proteger(noms)
  return {
    Str = function(el)
      local texte = el.text
      -- Chemin rapide : un Str sans majuscule ne peut porter aucun nom relevé, et c'est
      -- la très grande majorité des Str d'un article.
      local a_majuscule = false
      for _, cp in utf8.codes(texte) do
        if est_majuscule(cp) then a_majuscule = true; break end
      end
      if not a_majuscule then return nil end

      local segs = segments(texte)
      local touche = false
      for _, seg in ipairs(segs) do
        if seg.mot and noms[seg.texte] then touche = true; break end
      end
      if not touche then return nil end

      local sortie = pandoc.Inlines({})
      for _, seg in ipairs(segs) do
        if seg.mot and noms[seg.texte] then
          sortie:insert(pandoc.Span(pandoc.Inlines({ pandoc.Str(seg.texte) }),
            pandoc.Attr('', { 'szh-sans-cesure' }, {})))
        else
          sortie:insert(pandoc.Str(seg.texte))
        end
      end
      return sortie
    end,

    -- ⚠ AUCUN span à l'intérieur d'un <a>, et ce n'est pas une préférence de style : c'est
    -- la règle PDF/UA-1 7.18.5. WeasyPrint pose une annotation de lien par boîte
    -- descendante du <a> (anchors.py : la propriété `link` est héritée) et n'en rattache
    -- qu'une au /Link de l'arbre de structure ; les autres pendent sous /Span. Mesuré le
    -- 08.09.2026 : les spans posés dans les trois liens de l'article d'essai faisaient
    -- tomber la porte veraPDF avec « Lien mal balisé, 11 fois, page 2 ». Le gabarit tient la
    -- même règle (flèche du DOI hors du lien) et le Makefile aussi (appels de note
    -- réordonnés en sup > a) : ce filtre ne peut pas être l'exception.
    -- Le lien porte donc la classe LUI-MÊME, et ses spans sont défaits. pandoc filtre les
    -- inlines d'un Link avant le Link : les spans sont déjà là quand on arrive ici.
    -- Contrepartie assumée : le texte entier du lien cesse de se couper, pas seulement le
    -- nom propre qu'il contient. Les liens de la revue sont des noms d'institution — « la
    -- Haute école de travail social de Fribourg (HETS-FR) » — où c'est presque toujours ce
    -- qu'on veut.
    Link = function(el)
      local defait = false
      el.content = el.content:walk({
        Span = function(sp)
          for _, c in ipairs(sp.classes) do
            if c == 'szh-sans-cesure' then defait = true; return sp.content end
          end
          return nil
        end,
      })
      if not defait then return nil end
      el.classes:insert('szh-sans-cesure')
      return el
    end,
  }
end

-- ── Seconde passe : la mise en forme hors des liens, toutes langues ─────────────────────
-- `[*Texte du* lien](https://…)` donne à pandoc <a><em>Texte du</em> lien</a>, et le PDF
-- tombe à la porte veraPDF sur la même règle 7.18.5-1 que les spans ci-dessus. Mesuré le
-- 29.09.2026 sur WeasyPrint 70 : anchors.py hérite le lien sur toute boîte non-texte
-- descendante du <a> (`link = box.link or parent_link`), le <em> pose donc sa propre
-- annotation, et tags.py la range sous l'élément de structure de CETTE boîte — /NonStruct,
-- em n'ayant pas d'équivalent PDF. veraPDF : « A Link annotation is … nested within
-- NonStruct tag instead of Link ». Même échec pour <strong>, <u>, et pour un lien
-- entièrement en italique.
-- Pistes écartées, mesurées le même jour : `display: contents` sur le <em> — WeasyPrint 70
-- ne le connaît pas, la boîte reste ; aucune propriété CSS ne met en forme une partie
-- d'un texte sans élément pour la porter.
-- Ce qui passe : la mise en forme ENVELOPPE des liens qui ne contiennent que du texte —
--   <em><a>Texte du</a></em><a> lien</a>
-- Même geste que le Makefile pour les appels de note (sup > a). Rendu identique au pixel
-- (comparé en 300 dpi : italique, gras, filet du lien continu) ; veraPDF conforme. Un lien
-- entièrement mis en forme reste UN lien (<em><a>…</a></em>). Un lien mis en forme en
-- partie devient deux liens voisins vers la même cible : un lecteur d'écran en annonce
-- deux. C'est ce que WeasyPrint fait déjà de tout lien coupé en fin de ligne (une
-- annotation et un /Link par ligne, mesuré), le coût n'est donc pas nouveau.
-- Un segment qui ne porte que des blancs ne devient pas un lien (il serait annoncé comme
-- un lien vide) : il rejoint le lien voisin. L'identifiant du lien, s'il en a un, ne va
-- qu'au premier segment ; classes, cible et titre vont à tous.
-- Ce qui n'est PAS hissé, faute de pouvoir l'être : Code (son contenu est une chaîne, un
-- lien ne peut pas y entrer), Image, Math, Note, RawInline — ils restent dans le lien,
-- comme avant.
local CONTENANTS = {
  Emph = true, Strong = true, Underline = true, Strikeout = true, SmallCaps = true,
  Superscript = true, Subscript = true, Span = true,
}
local BLANCS = { Space = true, SoftBreak = true, LineBreak = true }

local function hisser_hors_des_liens(lien)
  -- Un lien `.qr` n'est pas un lien de texte : szh-qr.lua (livres, après ce filtre) le
  -- remplace entier par un QR. Scindé, il en imprimerait un par segment.
  for _, c in ipairs(lien.classes) do
    if c == 'qr' then return nil end
  end
  local a_hisser = false
  for _, x in ipairs(lien.content) do
    if CONTENANTS[x.t] then a_hisser = true; break end
  end
  if not a_hisser then return nil end

  local premier = true
  local function segment(contenu)
    local attributs = {}
    for k, v in pairs(lien.attributes) do attributs[k] = v end
    local attr = pandoc.Attr(premier and lien.identifier or '', pandoc.List(lien.classes), attributs)
    premier = false
    return pandoc.Link(contenu, lien.target, lien.title, attr)
  end
  local function tout_blanc(contenu)
    for _, x in ipairs(contenu) do
      if not BLANCS[x.t] then return false end
    end
    return true
  end
  -- Le lien le plus profond au bout d'un contenant déjà hissé : c'est là qu'une espace
  -- voisine se range.
  local function lien_au_bout(x, depuis_la_fin)
    while x do
      if x.t == 'Link' then return x end
      if not CONTENANTS[x.t] or #x.content == 0 then return nil end
      x = x.content[depuis_la_fin and #x.content or 1]
    end
    return nil
  end
  local function hisser(inlines)
    local sortie = pandoc.Inlines({})
    local tampon = pandoc.Inlines({})
    local en_attente = nil                   -- des blancs à glisser dans le lien suivant
    -- Une espace seule entre deux mises en forme — « ***Texte*** *du* » — ne fait pas un
    -- lien : elle rejoint le lien qui la précède, ou à défaut celui qui la suit. Laissée
    -- nue, elle coupait le filet du lien (mesuré en 300 dpi) ; liée seule, elle serait
    -- annoncée comme un lien vide.
    local function vider()
      if #tampon == 0 then return end
      if tout_blanc(tampon) then
        local prec = #sortie > 0 and lien_au_bout(sortie[#sortie], true) or nil
        if prec then
          local c = prec.content; c:extend(tampon); prec.content = c
        else
          en_attente = tampon
        end
      else
        sortie:insert(segment(tampon))
      end
      tampon = pandoc.Inlines({})
    end
    for _, x in ipairs(inlines) do
      if CONTENANTS[x.t] then
        vider()
        x.content = hisser(x.content)
        if en_attente then
          local suiv = lien_au_bout(x, false)
          if suiv then
            local c = pandoc.Inlines({}); c:extend(en_attente); c:extend(suiv.content)
            suiv.content = c
          else
            sortie:extend(en_attente)
          end
          en_attente = nil
        end
        sortie:insert(x)
      else
        tampon:insert(x)
      end
    end
    vider()
    if en_attente then sortie:extend(en_attente) end
    return sortie
  end
  return hisser(lien.content)
end

local function Pandoc(doc)
  local lang = utils.stringify(doc.meta.lang or ''):lower():sub(1, 2)
  if lang ~= 'fr' then return doc end

  local noms = {}
  -- Seuls les blocs qui portent DIRECTEMENT des inlines sont relevés. Les blocs
  -- conteneurs (Div, BlockQuote, listes, cellules, légendes) sont traversés jusqu'à ces
  -- feuilles-là : relever le conteneur en plus reviendrait à aplatir plusieurs paragraphes
  -- en une seule chaîne, où utils.stringify ne met AUCUN séparateur entre deux blocs — le
  -- dernier mot de l'un et le premier de l'autre y feraient un mot inexistant.
  -- RawBlock et CodeBlock sont exclus de fait : ni l'un ni l'autre ne porte d'inline, et
  -- le HTML réinjecté (tableaux, figures dissoutes) n'apporterait que des mots de balisage.
  local FEUILLES = { Para = true, Plain = true, LineBlock = true }   -- Header : voir l'en-tête
  doc.blocks:walk({
    Block = function(bloc)
      if FEUILLES[bloc.t] then relever(bloc, noms) end
      return nil
    end,
  })
  if next(noms) == nil then return doc end

  doc.blocks = doc.blocks:walk(proteger(noms))
  return doc
end

-- Deux passes, dans cet ordre : la césure d'abord (elle défait ses spans dans les liens et
-- pose la classe sur le <a>), puis la mise en forme hors des liens — chaque segment hérite
-- alors de la classe. La seconde tourne quelle que soit la langue : la règle PDF/UA, elle,
-- ne dépend pas de la langue.
return {
  { Pandoc = Pandoc },
  { Link = hisser_hors_des_liens },
}
