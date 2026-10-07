-- Import : détache la bibliographie du corps et l'écrit dans son propre fichier,
--   <slug>.biblio.md    les références seules, sans titre, telles que pandoc les rend
--   ::: {.szh-biblio src="<slug>.biblio.md"}    reste à leur place dans le .md
-- Même principe que les tableaux (tables/table-NN.html et szh-tabelle-inclure.lua). À la
-- compilation, szh-citations.lua lit le fichier, pose le titre dans la langue de l'article
-- et ancre chaque entrée.
--
-- Les paragraphes à détacher sont choisis par docx-meta.py, d'après les styles du .docx.
-- Il les transmet dans le fichier $SZH_META : une ligne B par paragraphe (sa clé, voir
-- cle()) et une ligne BT pour le titre de section, retiré du corps car la compilation le
-- repose.
--
-- Sans ligne B, <slug>.biblio.md est créé vide et son marqueur placé en fin d'article : la
-- rédaction peut y écrire une bibliographie plus tard. Un fichier vide n'imprime rien
-- (szh-citations.lua, est_vide()).
--
-- S'exécute après szh-titres (les titres promus sont des Header) et avant
-- szh-tabelle-reference (les tableaux sont encore des Table).

local utils = pandoc.utils

-- Module commun. Sans lui, la conversion s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[biblio-detacher] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

-- Clé d'appariement : les quarante premiers caractères [A-Za-z0-9]. Doit rester identique
-- à cle_comparaison() de docx-meta.py. Elle ignore ce que le .docx et pandoc rendent
-- différemment (tirets insécables ou conditionnels, ponctuation).
local function cle(t)
  return (t:gsub('[^A-Za-z0-9]', '')):sub(1, 40)
end

-- Message au rédacteur, au format lu par le cockpit :
--   [import-<ton>] <code> | <champ nommé> | … | <fr> | [de] <de>
-- Écrit sur stderr et dans articles-word/.import.log, comme avertir() de docx-meta.py.
local function constat(ton, code, champs, fr, de)
  local nommes = {}
  for _, c in ipairs(champs) do nommes[#nommes + 1] = commun.sans_barre(c) end
  local ligne = commun.ligne_constat('import', ton, code, nommes,
    commun.sans_barre(fr), commun.sans_barre(de))
  io.stderr:write(ligne .. '\n')
  commun.journaliser(ligne)
end

local function slug_article()
  local s = os.getenv('SZH_SLUG')
  if s and s ~= '' then return s end
  local fichiers = (PANDOC_STATE and PANDOC_STATE.input_files) or {}
  local chemin = fichiers[1]
  if type(chemin) ~= 'string' then return 'article' end
  return (chemin:gsub('.*[/\\]', ''):gsub('%.docx$', ''))
end

-- Lit $SZH_META : rend les clés des lignes B et la clé du titre (BT).
local function charger_meta()
  local bornes, titre = {}, nil
  local chemin = os.getenv('SZH_META')
  if not chemin or chemin == '' then return bornes, titre end
  local f = io.open(chemin, 'r')
  if not f then return bornes, titre end
  for ligne in f:lines() do
    local lettre, valeur = ligne:match('^(%u+)\t(.*)$')
    if lettre == 'B' and valeur ~= '' then
      bornes[#bornes + 1] = valeur
    elseif lettre == 'BT' and valeur ~= '' then
      titre = valeur
    end
  end
  f:close()
  return bornes, titre
end

-- Pour test/js/biblio.test.js, qui compare cle() à cle_comparaison() de docx-meta.py.
SZH_BIBLIO_DETACHER = { cle = cle }

local function est_paragraphe(b)
  return b.t == 'Para' or b.t == 'Plain'
end

-- Retrouve les paragraphes de la bibliographie en remontant depuis la fin du document.
--
-- docx-meta.py donne la clé de chaque paragraphe à détacher ; un paragraphe du corps n'a
-- pas sa clé dans la liste. Les clés se comptent avec leurs répétitions : deux références
-- du même auteur institutionnel peuvent avoir la même clé.
--
-- L'étendue va du premier au dernier paragraphe apparié ; tout ce qui est entre les deux
-- part, apparié ou non. Ainsi une clé qui diverge (caractère en police Symbole) ne laisse
-- pas une partie de la liste dans le corps.
--
-- Rend (début, fin, nombre de clés appariées).
local function etendue(blocs, bornes)
  local attendus = {}
  for _, k in ipairs(bornes) do attendus[k] = (attendus[k] or 0) + 1 end
  local restants = #bornes
  local function apparie(b)
    if not est_paragraphe(b) then return nil end
    local k = cle(utils.stringify(b))
    if (attendus[k] or 0) > 0 then return k end
    return nil
  end
  local fin = nil
  for i = #blocs, 1, -1 do
    if apparie(blocs[i]) then fin = i; break end
  end
  if not fin then return nil, nil, 0 end
  -- La remontée s'arrête au nombre de clés attendues plus une marge : une clé encore
  -- attendue au-delà est une clé qui a divergé.
  local limite = #bornes + 5
  local debut, reconnus = fin, 0
  for i = fin, math.max(1, fin - limite), -1 do
    if restants == 0 then break end
    local k = apparie(blocs[i])
    if k then
      attendus[k] = attendus[k] - 1
      restants = restants - 1
      reconnus = reconnus + 1
      debut = i
    end
  end
  return debut, fin, reconnus
end

-- Sans bibliographie détectée : crée <slug>.biblio.md vide et place le marqueur en fin
-- d'article. Le fichier est ouvert en écriture sans risque d'écraser : la conversion
-- tourne toujours dans un dossier neuf (import-docx.sh, reimporter.py).
local function creer_biblio_vide(doc)
  local fichier = slug_article() .. '.biblio.md'
  local f = io.open(fichier, 'w')
  if not f then
    constat('avertissement', 'biblio-fichier-refuse',
      { 'article « ' .. slug_article() .. ' »', 'fichier « ' .. fichier .. ' »' },
      'Le fichier de bibliographie de cet article n’a pas pu être créé. L’article '
      .. 's’imprime normalement, sans bibliographie ; vérifiez que le dossier du numéro '
      .. 'est accessible en écriture.',
      'Die Literaturverzeichnis-Datei dieses Artikels konnte nicht angelegt werden. Der '
      .. 'Artikel wird normal gedruckt, ohne Literaturverzeichnis; prüfen Sie, ob der '
      .. 'Ordner der Ausgabe beschreibbar ist.')
    return nil
  end
  f:close()
  doc.blocks:insert(pandoc.Div({}, pandoc.Attr('', { 'szh-biblio' }, { { 'src', fichier } })))
  return doc
end

function Pandoc(doc)
  local bornes, cle_titre = charger_meta()
  if #bornes == 0 then return creer_biblio_vide(doc) end

  local blocs = doc.blocks
  local debut, fin, reconnus = etendue(blocs, bornes)
  if not (debut and fin) then
    constat('avertissement', 'biblio-bornes-perdues',
      { 'article « ' .. slug_article() .. ' »', 'references ' .. #bornes },
      'La bibliographie de cet article a été repérée dans le document Word, mais ses '
      .. 'bornes n’ont pas été retrouvées après conversion : elle reste dans le texte. '
      .. "L’article s’imprime normalement ; signalez ce cas, il n’est pas censé arriver.",
      'Das Literaturverzeichnis dieses Artikels wurde im Word-Dokument erkannt, seine '
      .. 'Grenzen liessen sich nach der Konvertierung aber nicht wiederfinden: es bleibt '
      .. 'im Text. Der Artikel wird normal gedruckt; melden Sie diesen Fall, er sollte '
      .. 'nicht vorkommen.')
    return nil
  end

  -- Le titre de section est retiré du corps, car la compilation le repose. Il est cherché
  -- par sa clé dans les trois blocs au-dessus de l'étendue.
  local bloc_titre = nil
  if cle_titre then
    for i = debut - 1, math.max(1, debut - 3), -1 do
      local b = blocs[i]
      if b.t == 'Header' and cle(utils.stringify(b)) == cle_titre then
        bloc_titre = i
        break
      end
    end
  end

  -- Tous les paragraphes de l'étendue partent, y compris ceux qui ont perdu le style de
  -- bibliographie. Les autres blocs (tableau, titre…) restent dans le corps.
  local refs, garde, pris = pandoc.List(), pandoc.List(), 0
  local slug = slug_article()
  local fichier = slug .. '.biblio.md'
  for i, b in ipairs(blocs) do
    if i == debut then
      garde:insert(pandoc.Div({}, pandoc.Attr('', { 'szh-biblio' }, { { 'src', fichier } })))
    end
    if i >= debut and i <= fin then
      if est_paragraphe(b) then
        refs:insert(b)
        pris = pris + 1
      else
        garde:insert(b)
      end
    elseif i ~= bloc_titre then
      garde:insert(b)
    end
  end

  if pris == 0 then return nil end

  -- Le fichier ne porte que les références, sans titre. Il est écrit dans le dossier
  -- courant, qui est celui de l'article.
  local opts = pandoc.WriterOptions({ wrap_text = 'none' })
  local texte = pandoc.write(pandoc.Pandoc(refs),
    'markdown-simple_tables-multiline_tables-grid_tables', opts)
  local f = io.open(fichier, 'w')
  if not f then
    constat('avertissement', 'biblio-fichier-refuse',
      { 'article « ' .. slug .. ' »', 'fichier « ' .. fichier .. ' »' },
      'La bibliographie de cet article n’a pas pu être enregistrée à part : elle reste '
      .. 'dans le texte. Vérifiez que le dossier du numéro est accessible en écriture.',
      'Das Literaturverzeichnis dieses Artikels konnte nicht separat gespeichert werden: '
      .. 'es bleibt im Text. Prüfen Sie, ob der Ordner der Ausgabe beschreibbar ist.')
    return nil
  end
  f:write(texte)
  f:close()

  doc.blocks = garde

  -- Un paragraphe est resté dans le corps seulement si deux conditions sont réunies : une
  -- clé non appariée (seule, le paragraphe a pu partir dans l'étendue) et moins de
  -- paragraphes détachés qu'annoncé (seul, pandoc a pu fusionner deux paragraphes Word).
  -- Cas connu : un intertitre de la liste promu en titre par szh-titres.
  local manquants = (reconnus < #bornes and pris < #bornes) and (#bornes - pris) or 0
  if manquants > 0 then
    constat('avertissement', 'biblio-incomplete',
      { 'article « ' .. slug .. ' »', 'paragraphes ' .. manquants },
      string.format('Bibliographie mise à part, sauf %d paragraphe(s) : ils restent dans '
        .. 'le texte, juste après la liste. Rien n’est perdu ; si ce sont des références, '
        .. 'donnez-leur le style de bibliographie dans le Word et réimportez.', manquants),
      string.format('Literaturverzeichnis ausgelagert, ausser %d Absatz/Absätzen: sie '
        .. 'bleiben im Text, direkt nach der Liste. Es geht nichts verloren; sind es '
        .. 'Einträge, geben Sie ihnen im Word die Formatvorlage für '
        .. 'Literaturverzeichnisse und importieren Sie neu.', manquants))
  else
    -- Tout est détaché. Le cockpit affiche sa propre phrase (ctl.import.biblio-detachee) ;
    -- celle-ci va au journal.
    constat('info', 'biblio-detachee',
      { 'article « ' .. slug .. ' »', 'attendus ' .. #bornes, 'detaches ' .. pris },
      string.format('Bibliographie correctement récupérée (%d paragraphe(s) sur %d).',
        pris, #bornes),
      string.format('Literaturverzeichnis korrekt übernommen (%d von %d Absätzen).',
        pris, #bornes))
  end
  return doc
end
