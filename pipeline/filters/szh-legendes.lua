-- Import : « bake » les légendes dans le .md.
--   * figures : une image seule dans un Para, avec un paragraphe voisin légende (avant ou
--     après), reçoit cette légende ; le paragraphe est retiré et szh-figure.lua en fera un
--     <figure><figcaption>. Un voisin est une légende s'il est tout en gras, si
--     docx-meta.py l'a identifié par style (lignes « F<TAB>texte » de SZH_META), ou s'il
--     commence par « Figure N » suivi d'un séparateur — exigé pour ne pas prendre
--     « Figure 1 montre… » pour une légende.
--   * tableaux : docx-tables.py a déjà baké le <caption> et consigné le texte des légendes
--     prises (SZH_LEGENDES_TABLES) ; on retire ici les paragraphes correspondants du .md,
--     par appariement au texte exact, gras non requis.
--   * texte alternatif : Word range l'alt de l'auteur dans wp:docPr/@descr, que le lecteur
--     docx met dans la description de l'Image. On le déplace en {alt="…"}, contrat lu par
--     szh-numerotation.lua. Une image sans légende y passe aussi, sinon implicit_figures
--     en ferait une légende visible au rendu.
--   * bloc Figure : quand la légende Word porte le STYLE de légende, le lecteur docx ne
--     rend pas deux paragraphes voisins mais un seul bloc `Figure`, légende comprise. On
--     l'aplatit ici en la forme unique du .md — un Para d'image, description = légende,
--     descr de Word en {alt="…"}. Voir ci-dessous pourquoi ce n'est pas cosmétique.
-- Conservateur : sans légende voisine claire, l'image ou le tableau reste tel quel.
--
-- POURQUOI APLATIR LES `Figure` N'EST PAS UN DÉTAIL.
--
-- Le writer markdown ne sait écrire une Figure en `![légende](img){…}` que si la légende
-- du bloc et la description de l'image sont IDENTIQUES. Sur une figure venue de Word
-- elles ne le sont jamais : la description est l'alt de l'auteur, la légende est la
-- phrase « Figure 1 : … ». Le writer renonce alors au markdown et écrit du HTML brut
--     <figure><img src=… alt=…><figcaption><p>…</p></figcaption></figure>
-- au milieu du .md. Rien ne l'annonce. Le rédacteur ne peut plus toucher à la légende
-- dans l'éditeur, szh-numerotation.lua ne numérote pas ce qu'il ne reconnaît pas, et le
-- numéro manuel « Figure 1 : » de Word reste figé. Constaté sur pandoc 3.5, celui de la
-- machine de production ; pandoc 3.9 écrit le markdown attendu — un import dépendait donc
-- silencieusement de la version installée. L'aplatissement rend le résultat identique
-- partout.

local utils = pandoc.utils

-- Module commun (constats) : un chargement raté arrête la conversion.
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

-- Un ensemble d'inlines est-il entièrement en gras (hors espaces) ?
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

-- Nettoyage du numéro de figure en tête de légende : le numéro manuel du Word part
-- ici, szh-numerotation.lua le repose à la compilation.
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

-- Motif strict « Figure N » + séparateur obligatoire, pour un voisin ni gras ni
-- stylé — l'assainissement a déjà réduit – — ‑ à '-'.
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
      return nil                             -- du texte APRÈS l'image : autre chose
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
-- Beschreibung ») ne sont pas du texte alternatif : les importer donnerait une fausse
-- impression d'accessibilité. On les jette, l'image reste sans alt — donc décorative
-- au rendu — jusqu'à ce qu'un humain en écrive un.
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
-- description pour laisser la place à la légende. Renvoie 1 si un alt a été posé. Le
-- texte est normalisé : un attribut n'admet pas de saut de ligne, et Word en met
-- volontiers. Rejeté si vide, automatique, ou identique à la légende.
local function alt_depuis_word(img, legende)
  local descr = normaliser(s(img.caption))
  img.caption = pandoc.Inlines({})
  if descr == '' or alt_automatique(descr) then return 0 end
  if legende and descr:lower() == normaliser(legende):lower() then return 0 end
  img.attributes['alt'] = descr
  return 1
end

-- Un Para dont le seul contenu significatif est une image -> renvoie l'image.
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
-- Rend (image, légende) d'une Figure réductible : un seul bloc, une seule image, rien
-- d'autre que des blancs autour. Une Figure qui contient deux images ou du texte n'est
-- pas réductible — on la laisse telle quelle plutôt que d'en perdre une partie.
-- L'identifiant de la Figure passe sur l'image : c'est lui que visent les renvois
-- internes du Word, et le .md ne garde plus d'autre endroit où le poser.
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
  -- Le numéro manuel du Word part ici, szh-numerotation.lua le repose à la compilation.
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

-- Légendes de figure détectées par style par docx-meta.py (lignes F de $SZH_META).
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
-- Les cinq valeurs sont celles que l'autrice ou l'auteur a TAPÉES dans le document, sous
-- les étiquettes « Légende : », « Texte alternatif : », « Copyright : », « Source : »,
-- « Note : » (le champ note est toujours présent, vide si rien n'est tapé). Sans
-- cette reprise, elles s'imprimeraient telles quelles au milieu de l'article et le texte
-- alternatif serait perdu — mesuré sur le gabarit réel avant le branchement.
--
-- `images` (FI) : une entrée par image, séparées par « ; », chacune donnant TOUS les noms de
-- fichier que cette image peut porter, séparés par « | ». Plusieurs noms parce que Word range
-- une image vectorielle derrière un aperçu PNG, le lecteur voit le PNG et pandoc écrit le SVG
-- (voir images_de_paragraphe() de pronto_docx.py) : on apparie sur le nom, en acceptant
-- toutes les variantes — un rang se décalerait au premier paragraphe d'image de plus.
-- Plusieurs entrées (29.09.2026, décision de Robin) : le bloc porte plusieurs images, deux
-- dans un même paragraphe ou plusieurs paragraphes à la suite, et il devient UN groupe
-- d'images (voir poser_groupe()). FG : le contenu du bloc est le k-ième tableau, un tableau de
-- mise en page d'images que szh-meta.lua a déjà remplacé par un bloc `.szh-grille`.
--
-- Les `clé…` sont les textes des paragraphes d'étiquette du bloc. ⚠ Ce filtre, et lui seul,
-- les retire du corps — AU MOMENT où il pose leurs valeurs sur l'image, jamais avant, jamais
-- autrement (garantie « rien ne disparaît », décision de Robin du 29.09.2026). Jusque-là,
-- szh-meta.lua les retirait d'avance (lignes P) : le jour où l'image ne se laissait pas
-- trouver ici — deux images dans un paragraphe, mesuré —, légende, texte alternatif et copyright
-- disparaissaient sans un mot. Un bloc qu'on n'a pas su poser garde donc ses paragraphes
-- tels quels dans le texte, et l'avertissement « bloc-valeur-non-reprise » le dit.
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

-- FT<TAB>k<TAB>… (bloc TABLEAU) : docx-tables.py pose les cinq champs sur tables/table-NN
-- .html ; ici, on ne fait que retirer les clés, juste devant le k-ième tableau, quand on le
-- rencontre. `sautes` : les ordinaux que szh-meta.lua a déjà ôtés du corps (T) ou changés en
-- groupe (FG) — la numérotation des Table restants saute les mêmes, comme docx-tables.py.
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
-- Même format que szh_commun.avertir() côté Python — « [import-avertissement] code | champs
-- | phrase FR | [de] phrase DE » —, pour que lib/journal.js n'ait qu'une forme à lire, sur
-- stderr ET dans le journal d'import ($SZH_IMPORT_LOG), que pandoc n'écrit pas pour nous.
-- « | » sépare les champs : il est remplacé dans les valeurs, comme sans_barre() ailleurs.
local function sans_barre(t) return commun.sans_barre(t or '') end

local function avertir(code, champs, fr, de)
  local nommes = { 'article « ' .. sans_barre(os.getenv('SZH_SLUG') or '') .. ' »' }
  for _, c in ipairs(champs) do nommes[#nommes + 1] = sans_barre(c) end
  local ligne = commun.ligne_constat('import', 'avertissement', code, nommes,
    sans_barre(fr), sans_barre(de))
  io.stderr:write(ligne .. '\n')
  commun.journaliser(ligne)
end

-- Un bloc dont aucune image n'a été retrouvée : ses valeurs restent dans le texte, dans les
-- paragraphes que l'autrice ou l'auteur a tapés (jamais retirés, voir plus haut).
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

-- Retire du corps DÉJÀ ÉMIS (`sortie`) les paragraphes d'étiquette d'un bloc qu'on vient de
-- poser. Ils précèdent directement son contenu (pandoc ne rend pas les paragraphes vides que
-- le gabarit tolère entre les deux) : on remonte depuis la fin tant que le dernier bloc émis
-- est l'une de ces clés, une clé ne retirant qu'une occurrence. Ce qui ne se trouve pas là
-- reste imprimé — une clé en double vaut mieux qu'une clé perdue.
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

-- ⚠ Table recopiée depuis pipeline/filters/szh-grille.lua et lib/references.js
--   (DISPOSITIONS) : test/filtres-import.test.js vérifie qu'elle reste identique à celle du
--   cockpit. Elle ne sert ici qu'à décider si la forme lue dans le Word est une disposition
--   que le formulaire Médias sait afficher ; sinon « auto », que les deux savent lire.
local DISPOSITIONS = {
  [2] = { '2', '1-1' },
  [3] = { '3', '2-1', '1-2', '1-1-1' },
  [4] = { '2-2', '4', '3-1', '1-3' },
  [5] = { '3-2', '2-3', '5' },
  [6] = { '3-3', '2-2-2', '6' },
}

-- La disposition que dessinait le Word : une rangée de paragraphe ou de tableau par nombre
-- d'images, « 2 » pour deux images côte à côte, « 1-1 » pour l'une sous l'autre, « 2-2 »
-- pour un tableau 2×2. Inconnue du menu -> « auto », comme le cockpit à la création.
local function disposition_de(rangees, n)
  local bouts = {}
  for _, r in ipairs(rangees) do bouts[#bouts + 1] = tostring(r) end
  local code = table.concat(bouts, '-')
  for _, c in ipairs(DISPOSITIONS[n] or {}) do
    if c == code then return code end
  end
  return 'auto'
end

-- Un Para/Plain qui ne porte que des images (et des blancs) -> la liste de ses images ;
-- nil sinon.
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

-- Nom de fichier seul d'un src d'image : les chemins du .md sont relatifs (media/…, ./media/…)
-- et le lecteur, lui, ne connaît que le nom sous media/.
local function base_fichier(chemin)
  return (tostring(chemin):gsub('[?#].*$', ''):gsub('^.*[/\\]', ''))
end

-- Pose les cinq champs d'un bloc Pronto sur son image. Renvoie (nfig, nalt) à ajouter aux
-- compteurs. Le contrat d'attributs est celui de szh-numerotation.lua :
--   ![légende](media/x.png){alt="…" copyright="…" source="…" note="…"}
local function poser_bloc_pronto(img, bloc)
  local nfig, nalt = 0, 0
  if bloc.alt ~= '' then
    img.caption = pandoc.Inlines({})        -- le descr de Word cède à ce qui a été tapé
    img.attributes['alt'] = bloc.alt
    nalt = 1
  else
    -- Rien de tapé sous « Texte alternatif : » : le descr de Word, s'il existe et n'est pas
    -- une description automatique, vaut mieux que rien.
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
    -- Sans légende, droits et note n'auraient aucun endroit où s'écrire : la classe fait de
    -- l'image une figure hors numérotation (szh-numerotation.lua), qui les porte.
    img.classes = pandoc.List(img.classes)
    img.classes:insert('szh-hors-figure')
  end
  return nfig, nalt
end

-- Une ligne d'image de groupe, telle que pandoc l'écrit : c'est pandoc lui-même qui échappe
-- la légende et cite les attributs, comme partout ailleurs dans le .md.
local function ligne_image(img)
  local md = pandoc.write(pandoc.Pandoc({ pandoc.Plain({ img }) }), 'markdown',
                          { wrap_text = 'none' })
  return trim(md)
end

-- Un groupe d'images (décision de Robin, 29.09.2026) : UNE figure, un numéro, une légende,
-- écrite EXACTEMENT comme l'écrit « Ajouter une image à côté » du formulaire Médias
-- (poserDansGrille() de lib/references.js), pour que ce formulaire la relise et l'édite :
--
--   ::: {.szh-grille disposition="2"}
--     ![Légende de la figure](media/a.png){alt="…" copyright="© A"}
--     ![](media/b.png){alt="…" copyright="© A"}
--   :::
--
--   * une image par ligne, sans ligne vide entre elles — sans quoi lireGrilles() (cockpit)
--     ne verrait pas ses membres, et la lecture markdown ferait une figure de chacune. C'est
--     pour tenir cette forme que le bloc sort en markdown brut : écrit comme un Div, pandoc
--     (--wrap=none) mettait les deux images sur UNE ligne, séparées d'une espace (mesuré) ;
--   * la légende sur la première image seulement, les suivantes entre crochets vides ;
--   * le texte alternatif TAPÉ va sur la première image ; les suivantes gardent la
--     description que Word leur donnait (descr), si elle existe et n'est pas automatique.
--     Une image restée sans alt est nommée après l'import (figure-alt-a-completer,
--     docx-controle-import.py), jamais laissée muette en silence ;
--   * copyright et source sur CHAQUE image : le cockpit tient les droits image par image, et
--     szh-numerotation.lua ne répète pas un crédit identique sous la figure. Posés sur la
--     première seulement, ils se perdraient le jour où elle quitte le groupe ;
--   * la note, elle, sur la première image seulement : c'est une donnée de la figure, comme
--     la légende, pas un droit propre à chaque image.
-- `autres` : ce qu'un tableau de mise en page portait d'autre que des images (FG) — gardé,
-- à la suite, dans le bloc ; szh-grille.lua l'imprime sous les images.
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

  -- 1) retirer les paragraphes déjà bakés en <caption> de tableau (appariement au
  --    texte exact du sidecar, gras non requis)
  local blocs = pandoc.List()
  for _, b in ipairs(doc.blocks) do
    if b.t == 'Para' and next(legT) ~= nil and legT[normaliser(s(b))] then
      ntab = ntab + 1                         -- retiré du .md
    else
      blocs:insert(b)
    end
  end

  -- 2) figures : image seule + légende voisine (avant, puis après)
  local consommes = {}
  local sortie = pandoc.List()
  for idx, b in ipairs(blocs) do
    if consommes[idx] then goto continue end
    -- Figure déjà formée par le lecteur docx (légende stylée dans le Word) : on
    -- l'aplatit avant tout le reste. Avec légende, elle est complète et ne doit surtout
    -- pas repasser par la règle du voisinage, qui lui en collerait une autre ; sans
    -- légende, elle redevient une image seule et suit le chemin ordinaire.
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
    -- Bloc tableau du gabarit (ligne FT) : ses champs sont déjà dans tables/table-NN.html
    -- (docx-tables.py) ; ses clés quittent le corps ici, juste devant LUI.
    if b.t == 'Table' then
      local bloc = tableauxP[ordinal_suivant()]
      if bloc and not bloc.pose then
        retirer_cles(sortie, bloc)
        bloc.pose = true
      end
      sortie:insert(b)
      goto continue
    end
    -- Tableau de mise en page d'images (ligne FG) : szh-meta.lua l'a déjà remplacé par un
    -- bloc `.szh-grille` marqué `szh-tableau`, une rangée du tableau par paragraphe.
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
        -- Plus une seule image lisible : le contenu reste, tel quel, hors du bloc.
        b.attributes['szh-tableau'] = nil
        for _, dedans in ipairs(b.content) do sortie:insert(dedans) end
      end
      goto continue
    end
    -- Bloc du gabarit : tout est écrit, il n'y a rien à deviner. La règle du voisinage est
    -- court-circuitée EXPRÈS — un paragraphe de corps tout en gras juste au-dessus de la
    -- figure lui volerait sa légende alors que l'autrice ou l'auteur en a tapé une.
    do
      local lot = images_seules(b)
      local entree = lot and blocsP[base_fichier(lot[1].src)]
      if entree and not entree.bloc.pose then
        local bloc = entree.bloc
        -- Les images de CE paragraphe, puis des paragraphes d'images qui suivent, tant
        -- qu'elles appartiennent toutes au même bloc : (a) deux images dans un paragraphe,
        -- (b) plusieurs paragraphes à la suite. Une image étrangère au bloc arrête la
        -- collecte ; si c'est dans le tout premier paragraphe, rien n'est posé (voir plus
        -- bas : le bloc reste alors visible, et averti).
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
        -- Décision de Robin (29.09.2026) : des paragraphes d'UNE image chacun, à la suite sous
        -- le même en-tête (cas b), sont des images CÔTE À CÔTE — une seule rangée (« 2 »,
        -- « 3 »… jusqu'à « 6 », toutes dans la table ; au-delà, « auto »), jamais « 1-1 ».
        -- Des paragraphes qui portent chacun PLUSIEURS images dessinent, eux, des rangées
        -- voulues (un tableau de mise en page que le nettoyeur a posé à plat, par exemple) :
        -- leur forme est gardée.
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
    -- cas soudé : « Légende : … [image] » dans un seul paragraphe
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
        -- Image seule sans légende : sa description est le descr de Word, pas une
        -- légende. La laisser là en ferait une <figcaption> visible au rendu
        -- (implicit_figures) ; on la déplace en {alt="…"}, ou on la jette si elle
        -- est automatique.
        nalt = nalt + alt_depuis_word(img, nil)
        sortie:insert(pandoc.Para({ img }))
      end
    else
      sortie:insert(b)
    end
    ::continue::
  end

  -- 3) Balayage final : une description automatique de Word survit là où les règles
  --    ci-dessus ne passent pas, typiquement une vignette dans un lien
  --    (`[![descr](img)](url)`), qui n'est pas un para_image. On la jette ici aussi.
  --    No-op sur ce qui a déjà été traité au-dessus.
  --    (pandoc.Blocks() : `sortie` est une pandoc.List générique, sans :walk.)
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
  -- Garantie « rien ne disparaît » : un bloc du gabarit qu'on n'a pas su poser a gardé ses
  -- paragraphes d'étiquette dans le texte (ils ne sont retirés qu'à la pose) — on le dit.
  for _, bloc in ipairs(tousP) do
    if not bloc.pose then avertir_bloc_non_repris(bloc) end
  end
  io.stderr:write(string.format(
    '[import] %d figure(s) légendée(s), %d tableau(x) légendé(s), '
    .. '%d texte(s) alternatif(s) repris de Word\n', nfig, ntab, nalt))
  return doc
end
