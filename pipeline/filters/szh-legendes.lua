-- Import Word : pose les légendes, les textes alternatifs et les crédits des figures dans
-- le .md.
--   * figure : une image seule dans un paragraphe prend pour légende un paragraphe voisin
--     (avant ou après), qui est retiré. Un voisin est une légende s'il est tout en gras,
--     si docx-meta.py l'a reconnu à son style (lignes « F<TAB>texte » de SZH_META), ou
--     s'il commence par « Figure N » suivi d'un séparateur (« Figure 1 montre… » n'en est
--     pas une).
--   * tableau : docx-tables.py a déjà posé le <caption> et listé les légendes prises
--     (SZH_LEGENDES_TABLES) ; leurs paragraphes sont retirés du .md, à texte égal.
--   * texte alternatif : Word le range dans wp:docPr/@descr, que le lecteur docx met dans
--     la description de l'image. Il passe en {alt="…"}, lu par szh-numerotation.lua. Une
--     image sans légende y passe aussi, sinon pandoc en ferait une légende visible.
--   * bloc Figure : quand la légende Word porte le style de légende, le lecteur docx rend
--     un bloc `Figure`. Il est ramené à un paragraphe d'image, description = légende.
--     Sinon, selon la version de pandoc, l'écrivain markdown écrit la figure en HTML brut
--     dès que légende et description diffèrent : la légende n'est plus modifiable dans
--     l'éditeur et szh-numerotation.lua ne la numérote pas.
--   * blocs du gabarit Pronto : voir charger_blocs_pronto().
-- Sans légende reconnue, l'image ou le tableau reste tel quel.

local utils = pandoc.utils

-- Module commun. Sans lui le filtre ne peut pas travailler : la conversion s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[legendes] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local function assainir(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return t
end
local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function s(x) return assainir(utils.stringify(x)) end
-- Normalisation à garder identique à docx-tables.py et docx-meta.py (appariement).
local function normaliser(t)
  return (assainir(t):gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Vrai si les inlines sont tous en gras, espaces exceptées.
local function tout_gras(inls)
  local reel = 0
  for _, i in ipairs(inls) do
    if i.t ~= 'Space' and i.t ~= 'SoftBreak' then
      if i.t ~= 'Strong' then return false end
      reel = reel + 1
    end
  end
  return reel > 0
end

-- Retire le numéro manuel en tête de légende ; szh-numerotation.lua numérote à la
-- compilation.
local MOTS_FIGURE = { '^[Ff]igure%s+%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[FfAa]bb?%.%s*%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[Aa]bbildung%s+%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[Ii]llustration%s+%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[Gg]rafik%s+%d+[a-z]?%s*[:%.%-–—]?%s*' }
local function nettoyer_figure(txt)
  for _, m in ipairs(MOTS_FIGURE) do
    if txt:match(m) then return trim(txt:gsub(m, '', 1)) end
  end
  return txt
end

-- Motif strict « Figure N » suivi d'un séparateur, pour un voisin ni gras ni stylé.
-- assainir() a déjà ramené les tirets à '-'. Au-delà de 50 mots, ce n'est pas une légende.
local MOTS_FIGURE_STRICTS = { '^[Ff]igure%s+%d+[a-z]?%s*[:%.%-]',
                              '^[FfAa]bb?%.%s*%d+[a-z]?%s*[:%.%-]',
                              '^[Aa]bbildung%s+%d+[a-z]?%s*[:%.%-]',
                              '^[Ii]llustration%s+%d+[a-z]?%s*[:%.%-]',
                              '^[Gg]rafik%s+%d+[a-z]?%s*[:%.%-]' }
local function motif_figure_strict(txt)
  local n = 0
  for _ in txt:gmatch('%S+') do n = n + 1 end
  if n > 50 then return false end
  for _, m in ipairs(MOTS_FIGURE_STRICTS) do
    if txt:match(m) then return true end
  end
  return false
end

-- Cas soudé : légende et image dans le même paragraphe (« Abbildung 3: … !\[image\] »).
-- Si le texte qui précède l'image porte le motif strict de légende, on renvoie
-- (texte, image) et l'image devient un paragraphe propre.
local function para_legende_et_image(b)
  if b.t ~= 'Para' then return nil end
  local img, texte = nil, {}
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then
      if img then return nil end             -- plusieurs images : ne pas toucher
      img = x
    elseif img then
      return nil                             -- du texte après l'image : autre chose
    else
      texte[#texte + 1] = x
    end
  end
  if not img or #texte == 0 then return nil end
  local brut = trim(s(pandoc.Plain(texte)))
  if brut == '' or not motif_figure_strict(brut) then return nil end
  return brut, img
end

-- ─── Texte alternatif venu de Word ───────────────────────────────────────────
-- Les descriptions automatiques de Word et de Copilot (« Automatisch generierte
-- Beschreibung ») ne sont pas un texte alternatif : elles sont jetées, et l'image reste
-- sans alt jusqu'à ce qu'une personne en écrive un.
local MARQUEURS_AUTO = {
  'automatisch generierte beschreibung',
  'automatisch erstellte beschreibung',
  'ki%-generierte inhalte',
  'description g[eé]n[eé]r[eé]e automatiquement',
  'contenu g[eé]n[eé]r[eé] par',
  'automatically generated description',
  'ai%-generated content',
}
local function alt_automatique(txt)
  local bas = txt:lower()
  for _, m in ipairs(MARQUEURS_AUTO) do
    if bas:find(m) then return true end
  end
  return false
end

-- Déplace la description de l'image (le descr de Word) vers l'attribut alt et vide la
-- description, place de la légende. Rend 1 si un alt a été posé, 0 sinon. Le texte est
-- normalisé, car Word y met des sauts de ligne. Rejeté s'il est vide, automatique ou
-- identique à la légende.
local function alt_depuis_word(img, legende)
  local descr = normaliser(s(img.caption))
  img.caption = pandoc.Inlines({})
  if descr == '' or alt_automatique(descr) then return 0 end
  if legende and descr:lower() == normaliser(legende):lower() then return 0 end
  img.attributes['alt'] = descr
  return 1
end

-- Rend l'image d'un Para qui ne porte qu'une image (et des blancs), nil sinon.
local function para_image(b)
  if b.t ~= 'Para' then return nil end
  local img = nil
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then
      if img then return nil end             -- plusieurs images : ne pas toucher
      img = x
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then
      return nil
    end
  end
  return img
end

-- ─── Bloc Figure du lecteur docx -> la forme unique du .md ───────────────────
-- Rend (image, légende) d'une Figure qui ne contient qu'une image et des blancs, nil
-- sinon (la Figure reste alors telle quelle). L'identifiant de la Figure, visé par les
-- renvois internes du Word, passe sur l'image.
local function figure_a_plat(f)
  if #f.content ~= 1 then return nil end
  local seul = f.content[1]
  if seul.t ~= 'Plain' and seul.t ~= 'Para' then return nil end
  local img = nil
  for _, x in ipairs(seul.content) do
    if x.t == 'Image' then
      if img then return nil end
      img = x
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then
      return nil
    end
  end
  if not img then return nil end
  if f.identifier and f.identifier ~= '' and img.identifier == '' then
    img.identifier = f.identifier
  end
  return img, trim(nettoyer_figure(trim(s(f.caption.long))))
end

local function charger_legendes_table()
  local ens = {}
  local chemin = os.getenv('SZH_LEGENDES_TABLES')
  if not chemin or chemin == '' then return ens end
  local f = io.open(chemin, 'r')
  if not f then return ens end
  for ligne in f:lines() do
    local clef = normaliser(ligne)
    if clef ~= '' then ens[clef] = true end
  end
  f:close()
  return ens
end

-- Légendes de figure reconnues à leur style par docx-meta.py (lignes F de $SZH_META).
local function charger_legendes_figures()
  local ens = {}
  local chemin = os.getenv('SZH_META')
  if not chemin or chemin == '' then return ens end
  local f = io.open(chemin, 'r')
  if not f then return ens end
  for ligne in f:lines() do
    local texte = ligne:match('^F\t(.*)$')
    if texte then
      local clef = normaliser(texte)
      if clef ~= '' then ens[clef] = true end
    end
  end
  f:close()
  return ens
end

-- ─── Blocs figure du gabarit « Pronto » ──────────────────────────────────────
-- Le lecteur du gabarit (pipeline/pronto-lire.py) écrit une ligne par bloc figure :
--   FI<TAB>images<TAB>légende<TAB>texte alternatif<TAB>copyright<TAB>source<TAB>note[<TAB>clé…]
--   FG<TAB>k<TAB>légende<TAB>texte alternatif<TAB>copyright<TAB>source<TAB>note[<TAB>clé…]
--   FT<TAB>k<TAB>légende<TAB>texte alternatif<TAB>copyright<TAB>source<TAB>note[<TAB>clé…]
--   (FT : les champs vont au tableau par docx-tables.py ; ici, seules ses clés partent.)
-- Les cinq valeurs sont celles que l'auteur a tapées dans le document sous les étiquettes
-- « Légende : », « Texte alternatif : », « Copyright : », « Source : », « Note : » (le
-- champ note est toujours présent, vide si rien n'est tapé).
--
-- `images` (FI) : une entrée par image, séparées par « ; ». Chaque entrée donne tous les
-- noms de fichier possibles de l'image, séparés par « | » : Word range une image
-- vectorielle derrière un aperçu PNG, le lecteur voit le PNG et pandoc écrit le SVG (voir
-- images_de_paragraphe() de pronto_docx.py). L'appariement se fait sur le nom, pas sur le
-- rang. Un bloc de plusieurs images devient un groupe (voir poser_groupe()).
-- FG : le bloc contient le k-ième tableau, un tableau de mise en page d'images que
-- szh-meta.lua a déjà remplacé par un bloc `.szh-grille`.
--
-- Les `clé…` sont les textes des paragraphes d'étiquette du bloc. Ce filtre seul les retire
-- du corps, au moment où il pose leurs valeurs sur l'image. Un bloc qui n'a pas pu être
-- posé garde donc ses paragraphes dans le texte, et l'avertissement
-- « bloc-valeur-non-reprise » le signale : aucune valeur tapée ne se perd.
local function lire_champs(reste)
  local champs = {}
  for champ in (reste .. '\t'):gmatch('([^\t]*)\t') do champs[#champs + 1] = champ end
  local bloc = { legende = trim(champs[2] or ''), alt = trim(champs[3] or ''),
                 credit = trim(champs[4] or ''), source = trim(champs[5] or ''),
                 note = trim(champs[6] or ''),
                 cles = {}, images = {}, pose = false }
  for i = 7, #champs do
    if trim(champs[i]) ~= '' then bloc.cles[#bloc.cles + 1] = champs[i] end
  end
  return champs[1] or '', bloc
end

-- FT (bloc tableau) : docx-tables.py pose les cinq champs dans tables/table-NN.html ; ce
-- filtre retire seulement les clés, juste devant le k-ième tableau. `sautes` : les rangs
-- de tableau que szh-meta.lua a déjà ôtés du corps (T) ou changés en groupe (FG). Le
-- comptage des tableaux restants les saute, comme docx-tables.py.
local function charger_blocs_pronto()
  local par_nom, grilles, tous, tableaux, sautes = {}, {}, {}, {}, {}
  local chemin = os.getenv('SZH_META')
  if not chemin or chemin == '' then return par_nom, grilles, tous, tableaux, sautes end
  local f = io.open(chemin, 'r')
  if not f then return par_nom, grilles, tous, tableaux, sautes end
  for ligne in f:lines() do
    local k_saute = ligne:match('^T\t(%d+)%s*$') or ligne:match('^FG\t(%d+)')
    if k_saute then sautes[tonumber(k_saute)] = true end
    local lettre, reste = ligne:match('^(F[IGT])\t(.*)$')
    if lettre then
      local cible, bloc = lire_champs(reste)
      bloc.lettre = lettre
      if lettre == 'FI' then
        for entree in cible:gmatch('[^;]+') do
          local rang = #bloc.images + 1
          local noms = {}
          for nom in entree:gmatch('[^|]+') do
            noms[#noms + 1] = nom
            if not par_nom[nom] then par_nom[nom] = { bloc = bloc, rang = rang } end
          end
          bloc.images[rang] = noms
        end
      else
        bloc.tableau = tonumber(cible)
        if bloc.tableau then
          if lettre == 'FG' then grilles[bloc.tableau] = bloc else tableaux[bloc.tableau] = bloc end
        end
      end
      tous[#tous + 1] = bloc
    end
  end
  f:close()
  return par_nom, grilles, tous, tableaux, sautes
end

-- ─── Avertissement au rédacteur ──────────────────────────────────────────────
-- Même format que szh_commun.avertir() côté Python : « [import-avertissement] code |
-- champs | phrase fr | [de] phrase de », lu par lib/journal.js. La ligne part sur stderr et
-- dans le journal d'import ($SZH_IMPORT_LOG). « | » sépare les champs : sans_barre() le
-- remplace dans les valeurs.
local function sans_barre(t) return commun.sans_barre(t or '') end

local function avertir(code, champs, fr, de)
  local nommes = { 'article « ' .. sans_barre(os.getenv('SZH_SLUG') or '') .. ' »' }
  for _, c in ipairs(champs) do nommes[#nommes + 1] = sans_barre(c) end
  local ligne = commun.ligne_constat('import', 'avertissement', code, nommes,
    sans_barre(fr), sans_barre(de))
  io.stderr:write(ligne .. '\n')
  commun.journaliser(ligne)
end

-- Avertit pour un bloc dont aucune image n'a été retrouvée : ses valeurs restent dans le
-- texte, dans les paragraphes tapés par l'auteur.
local function avertir_bloc_non_repris(bloc)
  local valeurs, premiere = {}, nil
  for _, c in ipairs({ { 'legende', 'légende', 'Legende' }, { 'alt', 'texte alternatif',
      'Alternativtext' }, { 'credit', 'copyright', 'Copyright' }, { 'source', 'source',
      'Quelle' }, { 'note', 'note', 'Notiz' } }) do
    local v = bloc[c[1]] or ''
    if v ~= '' then
      valeurs[#valeurs + 1] = { c[2], c[3], v }
      premiere = premiere or v
    end
  end
  if not premiere then return end                -- rien de tapé : rien ne peut manquer
  local fr, de = {}, {}
  for _, v in ipairs(valeurs) do
    fr[#fr + 1] = v[1] .. ' « ' .. v[3] .. ' »'
    de[#de + 1] = v[2] .. ' «' .. v[3] .. '»'
  end
  avertir('bloc-valeur-non-reprise', { 'valeur « ' .. premiere .. ' »' },
    'Une figure de cet article (' .. table.concat(fr, ', ') .. ') n’a pas pu être posée sur '
      .. 'son image : ses valeurs restent visibles dans le texte, telles que tapées. '
      .. 'Reportez-les dans « Médias de l’article », puis retirez ces paragraphes du texte.',
    'Eine Abbildung dieses Artikels (' .. table.concat(de, ', ') .. ') konnte nicht auf '
      .. 'ihr Bild gesetzt werden: ihre Werte bleiben so, wie sie getippt wurden, im Text '
      .. 'sichtbar. Übertragen Sie sie unter «Medien des Artikels» und entfernen Sie diese '
      .. 'Absätze danach aus dem Text.')
end

-- Retire de `sortie` (le corps déjà émis) les paragraphes d'étiquette d'un bloc qui vient
-- d'être posé. Ils précèdent directement son contenu, car pandoc ne rend pas les
-- paragraphes vides. On remonte depuis la fin tant que le dernier bloc émis est l'une de
-- ces clés, chaque clé ne retirant qu'une occurrence. Une clé qui n'est pas là reste dans
-- le texte.
local function retirer_cles(sortie, bloc)
  local reste = {}
  for _, c in ipairs(bloc.cles) do
    local k = normaliser(c)
    if k ~= '' then reste[k] = (reste[k] or 0) + 1 end
  end
  while #sortie > 0 do
    local dernier = sortie[#sortie]
    if dernier.t ~= 'Para' and dernier.t ~= 'Plain' then break end
    local k = normaliser(s(dernier))
    if not (reste[k] and reste[k] > 0) then break end
    reste[k] = reste[k] - 1
    sortie:remove(#sortie)
  end
end

-- Même table que DISPOSITIONS de lib/references.js et de szh-grille.lua ;
-- test/filtres-import.test.js vérifie qu'elle reste identique à celle du cockpit. Elle
-- dit si la disposition lue dans le Word est proposée par le formulaire Médias ; sinon
-- « auto ».
local DISPOSITIONS = {
  [2] = { '2', '1-1' },
  [3] = { '3', '2-1', '1-2', '1-1-1' },
  [4] = { '2-2', '4', '3-1', '1-3' },
  [5] = { '3-2', '2-3', '5' },
  [6] = { '3-3', '2-2-2', '6' },
}

-- Code de disposition d'après le nombre d'images de chaque rangée : « 2 » pour deux images
-- côte à côte, « 1-1 » pour l'une sous l'autre, « 2-2 » pour un tableau 2×2. Code absent
-- de DISPOSITIONS : « auto ».
local function disposition_de(rangees, n)
  local bouts = {}
  for _, r in ipairs(rangees) do bouts[#bouts + 1] = tostring(r) end
  local code = table.concat(bouts, '-')
  for _, c in ipairs(DISPOSITIONS[n] or {}) do
    if c == code then return code end
  end
  return 'auto'
end

-- Rend la liste des images d'un Para ou Plain qui ne porte que des images (et des
-- blancs), nil sinon.
local function images_seules(b)
  if b.t ~= 'Para' and b.t ~= 'Plain' then return nil end
  local lot = {}
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then lot[#lot + 1] = x
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' and x.t ~= 'LineBreak' then return nil end
  end
  if #lot == 0 then return nil end
  return lot
end

-- Nom de fichier seul d'un src d'image : le .md porte des chemins relatifs (media/…,
-- ./media/…), les lignes FI des noms de fichier seuls.
local function base_fichier(chemin)
  return (tostring(chemin):gsub('[?#].*$', ''):gsub('^.*[/\\]', ''))
end

-- Pose les cinq champs d'un bloc Pronto sur son image. Rend (nfig, nalt) à ajouter aux
-- compteurs. Les attributs sont ceux que lit szh-numerotation.lua :
--   ![légende](media/x.png){alt="…" copyright="…" source="…" note="…"}
local function poser_bloc_pronto(img, bloc)
  local nfig, nalt = 0, 0
  if bloc.alt ~= '' then
    img.caption = pandoc.Inlines({})        -- le descr de Word cède à ce qui a été tapé
    img.attributes['alt'] = bloc.alt
    nalt = 1
  else
    -- Rien de tapé sous « Texte alternatif : » : le descr de Word, s'il n'est pas
    -- automatique.
    nalt = alt_depuis_word(img, bloc.legende)
  end
  if bloc.credit ~= '' then img.attributes['copyright'] = bloc.credit end
  if bloc.source ~= '' then img.attributes['source'] = bloc.source end
  if (bloc.note or '') ~= '' then img.attributes['note'] = bloc.note end
  local legende = trim(nettoyer_figure(bloc.legende))
  if legende ~= '' then
    img.caption = pandoc.Inlines({ pandoc.Str(legende) })
    nfig = 1
  elseif bloc.credit ~= '' or bloc.source ~= '' or (bloc.note or '') ~= '' then
    -- Sans légende, crédits et note n'ont pas où s'écrire : la classe fait de l'image une
    -- figure hors numérotation (szh-numerotation.lua), qui les porte.
    img.classes = pandoc.List(img.classes)
    img.classes:insert('szh-hors-figure')
  end
  return nfig, nalt
end

-- Une ligne d'image de groupe, écrite par pandoc, qui échappe la légende et les attributs.
local function ligne_image(img)
  local md = pandoc.write(pandoc.Pandoc({ pandoc.Plain({ img }) }), 'markdown',
                          { wrap_text = 'none' })
  return trim(md)
end

-- Un groupe d'images : une figure, un numéro, une légende. Il s'écrit comme l'écrit
-- « Ajouter une image à côté » du formulaire Médias (poserDansGrille() de
-- lib/references.js), pour que ce formulaire le relise :
--
--   ::: {.szh-grille disposition="2"}
--     ![Légende de la figure](media/a.png){alt="…" copyright="© A"}
--     ![](media/b.png){alt="…" copyright="© A"}
--   :::
--
--   * une image par ligne, sans ligne vide : sinon lireGrilles() (cockpit) ne voit pas les
--     images du groupe, et le lecteur markdown fait une figure de chacune. D'où le markdown
--     brut : écrit comme un Div, pandoc (--wrap=none) met les images sur une seule ligne ;
--   * la légende et la note sur la première image seulement ;
--   * le texte alternatif tapé va sur la première image ; les suivantes gardent le descr de
--     Word s'il n'est pas automatique. Une image restée sans alt est signalée après l'import
--     (figure-alt-a-completer, docx-controle-import.py) ;
--   * copyright et source sur chaque image : le cockpit tient les crédits image par image,
--     et szh-numerotation.lua ne répète pas un crédit identique sous la figure.
-- `autres` : ce qu'un tableau de mise en page portait d'autre que des images (FG), gardé à
-- la suite dans le bloc ; szh-grille.lua l'imprime sous les images.
local function poser_groupe(imgs, rangees, bloc, autres)
  local nfig, nalt = 0, 0
  local legende = trim(nettoyer_figure(bloc.legende or ''))
  for i, img in ipairs(imgs) do
    if i == 1 and (bloc.alt or '') ~= '' then
      img.caption = pandoc.Inlines({})
      img.attributes['alt'] = bloc.alt
      nalt = nalt + 1
    else
      nalt = nalt + alt_depuis_word(img, i == 1 and legende or nil)
    end
    if (bloc.credit or '') ~= '' then img.attributes['copyright'] = bloc.credit end
    if (bloc.source or '') ~= '' then img.attributes['source'] = bloc.source end
    if i == 1 and (bloc.note or '') ~= '' then img.attributes['note'] = bloc.note end
  end
  if legende ~= '' then
    imgs[1].caption = pandoc.Inlines({ pandoc.Str(legende) })
    nfig = 1
  end
  local lignes = { '::: {.szh-grille disposition="' .. disposition_de(rangees, #imgs) .. '"}' }
  for _, img in ipairs(imgs) do lignes[#lignes + 1] = '  ' .. ligne_image(img) end
  for _, b in ipairs(autres or {}) do
    lignes[#lignes + 1] = ''
    lignes[#lignes + 1] = trim(pandoc.write(pandoc.Pandoc({ b }), 'markdown',
                                            { wrap_text = 'none' }))
  end
  lignes[#lignes + 1] = ':::'
  return pandoc.RawBlock('markdown', table.concat(lignes, '\n')), nfig, nalt
end

function Pandoc(doc)
  local legT = charger_legendes_table()
  local legF = charger_legendes_figures()
  local blocsP, grillesP, tousP, tableauxP, sautesP = charger_blocs_pronto()
  local nfig, ntab, nalt = 0, 0, 0
  -- Ordinal (au sens des lignes T/FT) du prochain Table rencontré dans le corps.
  local ordinal_table = 0
  local function ordinal_suivant()
    repeat ordinal_table = ordinal_table + 1 until not sautesP[ordinal_table]
    return ordinal_table
  end

  -- 1) Retire les paragraphes déjà posés en <caption> de tableau (à texte égal).
  local blocs = pandoc.List()
  for _, b in ipairs(doc.blocks) do
    if b.t == 'Para' and next(legT) ~= nil and legT[normaliser(s(b))] then
      ntab = ntab + 1                         -- retiré du .md
    else
      blocs:insert(b)
    end
  end

  -- 2) Figures.
  local consommes = {}
  local sortie = pandoc.List()
  for idx, b in ipairs(blocs) do
    if consommes[idx] then goto continue end
    -- Figure formée par le lecteur docx. Avec légende, elle est complète et ne passe pas
    -- par la règle du voisinage, qui lui en donnerait une autre ; sans légende, elle
    -- redevient une image seule et suit le chemin ordinaire.
    if b.t == 'Figure' then
      local imgf, capf = figure_a_plat(b)
      if imgf then
        if capf and capf ~= '' then
          nalt = nalt + alt_depuis_word(imgf, capf)
          imgf.caption = pandoc.Inlines({ pandoc.Str(capf) })
          sortie:insert(pandoc.Para({ imgf }))
          nfig = nfig + 1
          goto continue
        end
        b = pandoc.Para({ imgf })
      end
    end
    -- Bloc tableau du gabarit (ligne FT) : ses clés, juste avant le tableau, quittent le
    -- corps.
    if b.t == 'Table' then
      local bloc = tableauxP[ordinal_suivant()]
      if bloc and not bloc.pose then
        retirer_cles(sortie, bloc)
        bloc.pose = true
      end
      sortie:insert(b)
      goto continue
    end
    -- Tableau de mise en page d'images (ligne FG) : szh-meta.lua l'a remplacé par un bloc
    -- `.szh-grille` marqué `szh-tableau`, un paragraphe par rangée du tableau.
    if b.t == 'Div' and b.attributes['szh-tableau'] then
      local bloc = grillesP[tonumber(b.attributes['szh-tableau'])]
                   or { legende = '', alt = '', credit = '', source = '', note = '', cles = {} }
      local imgs, rangees, autres = {}, {}, {}
      for _, dedans in ipairs(b.content) do
        local lot = images_seules(dedans)
        if lot then
          for _, im in ipairs(lot) do imgs[#imgs + 1] = im end
          rangees[#rangees + 1] = #lot
        else
          autres[#autres + 1] = dedans
        end
      end
      if #imgs > 0 then
        local raw, dfig, dalt = poser_groupe(imgs, rangees, bloc, autres)
        retirer_cles(sortie, bloc)
        bloc.pose = true
        nfig, nalt = nfig + dfig, nalt + dalt
        sortie:insert(raw)
      else
        -- Aucune image lisible : le contenu reste tel quel, hors du bloc.
        b.attributes['szh-tableau'] = nil
        for _, dedans in ipairs(b.content) do sortie:insert(dedans) end
      end
      goto continue
    end
    -- Bloc figure du gabarit : les valeurs sont données, la règle du voisinage ne
    -- s'applique pas. Un paragraphe en gras juste au-dessus lui prendrait sa légende.
    do
      local lot = images_seules(b)
      local entree = lot and blocsP[base_fichier(lot[1].src)]
      if entree and not entree.bloc.pose then
        local bloc = entree.bloc
        -- Rassemble les images de ce paragraphe et des paragraphes d'images qui suivent,
        -- tant qu'elles appartiennent toutes au même bloc. Une image étrangère au bloc
        -- arrête la collecte ; dans le premier paragraphe, rien n'est posé et le bloc
        -- reste visible, avec un avertissement.
        local imgs, rangees, j = {}, {}, idx
        while j <= #blocs and #imgs < #bloc.images do
          local l = images_seules(blocs[j])
          if not l then break end
          local tous = true
          for _, im in ipairs(l) do
            local e = blocsP[base_fichier(im.src)]
            if not e or e.bloc ~= bloc then tous = false end
          end
          if not tous then break end
          for _, im in ipairs(l) do imgs[#imgs + 1] = im end
          rangees[#rangees + 1] = #l
          if j > idx then consommes[j] = true end
          j = j + 1
        end
        -- Des paragraphes d'une image chacun forment une seule rangée d'images côte à côte
        -- (« 2 » à « 6 », au-delà « auto »). Des paragraphes de plusieurs images dessinent
        -- des rangées voulues, par exemple un tableau de mise en page mis à plat par le
        -- nettoyeur : leur forme est gardée.
        local une_par_paragraphe = #rangees > 1
        for _, r in ipairs(rangees) do
          if r ~= 1 then une_par_paragraphe = false end
        end
        if une_par_paragraphe then rangees = { #imgs } end
        if #imgs >= 2 then
          local raw, dfig, dalt = poser_groupe(imgs, rangees, bloc, nil)
          retirer_cles(sortie, bloc)
          bloc.pose = true
          nfig, nalt = nfig + dfig, nalt + dalt
          sortie:insert(raw)
          goto continue
        elseif #imgs == 1 then
          local dfig, dalt = poser_bloc_pronto(imgs[1], bloc)
          retirer_cles(sortie, bloc)
          bloc.pose = true
          nfig, nalt = nfig + dfig, nalt + dalt
          sortie:insert(pandoc.Para({ imgs[1] }))
          goto continue
        end
      end
    end
    -- Légende et image dans un seul paragraphe.
    local cap_soude, img_soude = para_legende_et_image(b)
    if cap_soude then
      local propre = trim(nettoyer_figure(cap_soude))
      if propre ~= '' then
        nalt = nalt + alt_depuis_word(img_soude, propre)
        img_soude.caption = pandoc.Inlines({ pandoc.Str(propre) })
        sortie:insert(pandoc.Para({ img_soude }))
        nfig = nfig + 1
        goto continue
      end
    end
    -- Image seule et légende voisine, cherchée avant puis après.
    local img = para_image(b)
    if img then
      local cap, capidx = nil, nil
      for _, j in ipairs({ idx - 1, idx + 1 }) do
        local v = blocs[j]
        if v and v.t == 'Para' and not consommes[j] and not para_image(v) then
          local texte = s(v)
          if tout_gras(v.content) or legF[normaliser(texte)]
             or motif_figure_strict(trim(texte)) then
            cap = trim(nettoyer_figure(trim(texte)))
            capidx = j
            break
          end
        end
      end
      if cap and cap ~= '' then
        consommes[capidx] = true
        if capidx == idx - 1 then sortie:remove(#sortie) end
        nalt = nalt + alt_depuis_word(img, cap)             -- descr Word -> {alt="…"}
        img.caption = pandoc.Inlines({ pandoc.Str(cap) })   -- description = légende
        sortie:insert(pandoc.Para({ img }))
        nfig = nfig + 1
      else
        -- Image sans légende : sa description est le descr de Word. Laissée là, pandoc en
        -- ferait une <figcaption> visible (implicit_figures) ; elle passe en {alt="…"}.
        nalt = nalt + alt_depuis_word(img, nil)
        sortie:insert(pandoc.Para({ img }))
      end
    else
      sortie:insert(b)
    end
    ::continue::
  end

  -- 3) Jette les descriptions automatiques restées là où les règles ci-dessus ne passent
  --    pas, par exemple une image dans un lien (`[![descr](img)](url)`).
  --    pandoc.Blocks() : `sortie` est une pandoc.List, qui n'a pas :walk.
  doc.blocks = pandoc.Blocks(sortie):walk({
    Image = function(img)
      local descr = trim(s(img.caption))
      if descr ~= '' and alt_automatique(descr) then
        img.caption = pandoc.Inlines({})
        return img
      end
      return nil
    end,
  })
  -- Un bloc du gabarit non posé a gardé ses paragraphes dans le texte : on le signale.
  for _, bloc in ipairs(tousP) do
    if not bloc.pose then avertir_bloc_non_repris(bloc) end
  end
  io.stderr:write(string.format(
    '[import] %d figure(s) légendée(s), %d tableau(x) légendé(s), '
    .. '%d texte(s) alternatif(s) repris de Word\n', nfig, ntab, nalt))
  return doc
end
