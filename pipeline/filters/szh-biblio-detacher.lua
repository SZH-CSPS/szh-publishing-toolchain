-- Import : détache la bibliographie du corps et l'écrit dans son propre fichier,
--   <slug>.biblio.md    les références seules, sans titre, telles que pandoc les rend
--   ::: {.szh-biblio src="<slug>.biblio.md"}    reste à leur place dans le .md
-- C'est le patron des tableaux (tables/table-NN.html + szh-tabelle-inclure.lua) : le
-- contenu détaché est un fichier, la place qu'il occupait est une référence. À la
-- compilation, szh-citations.lua résout la référence, pose le titre dans la langue de
-- l'article et ancre chaque entrée.
--
-- Ce filtre ne décide RIEN. L'étendue à détacher est décidée par docx-meta.py, qui lit les
-- STYLES du .docx — le seul signal fiable, mesuré sur les 421 galleys publiés. Il arrive
-- ici en lignes B de $SZH_META (une clé de comparaison par paragraphe) et BT (le titre de
-- section, qui quitte le corps puisqu'il est reposé à la compilation). Sans lignes B, le
-- document sort inchangé : la liste reste dans le corps, l'article est entier, et c'est
-- docx-meta.py qui a déjà dit au rédacteur pourquoi.
--
-- Doit tourner après szh-titres (les titres promus sont des Header) et avant
-- szh-tabelle-reference (les Table sont encore des Table).

local utils = pandoc.utils

-- Clé d'appariement : les quarante premiers caractères [A-Za-z0-9], et rien d'autre.
-- Identique à cle_comparaison() de docx-meta.py, classe par classe explicite des deux
-- côtés. Ce que le .docx et pandoc ne rendent pas pareil — tiret insécable, caractère en
-- police Symbole, tiret conditionnel, hyperlien sans cible — est de la ponctuation, ou vit
-- en fin de référence : la clé n'en voit rien.
local function cle(t)
  return (t:gsub('[^A-Za-z0-9]', '')):sub(1, 40)
end

-- Un constat au rédacteur, au format que le cockpit lit déjà :
--   [import-<ton>] <code> | <champ nommé> | … | <fr> | [de] <de>
-- stderr et articles-word/.import.log, comme avertir() de docx-meta.py : c'est dans la vue
-- « Word » que le rédacteur regarde après une conversion.
local function constat(ton, code, champs, fr, de)
  local morceaux = { '[import-' .. ton .. '] ' .. code }
  for _, c in ipairs(champs) do morceaux[#morceaux + 1] = (tostring(c):gsub('|', '/')) end
  morceaux[#morceaux + 1] = (fr:gsub('|', '/'))
  morceaux[#morceaux + 1] = '[de] ' .. (de:gsub('|', '/'))
  local ligne = table.concat(morceaux, ' | ')
  io.stderr:write(ligne .. '\n')
  local journal = os.getenv('SZH_IMPORT_LOG')
  if journal and journal ~= '' then
    local f = io.open(journal, 'a')
    if f then
      f:write(ligne .. '\n')
      f:close()
    end
  end
end

local function slug_article()
  local s = os.getenv('SZH_SLUG')
  if s and s ~= '' then return s end
  local fichiers = (PANDOC_STATE and PANDOC_STATE.input_files) or {}
  local chemin = fichiers[1]
  if type(chemin) ~= 'string' then return 'article' end
  return (chemin:gsub('.*[/\\]', ''):gsub('%.docx$', ''))
end

-- Les instructions de docx-meta.py : les clés de l'étendue, et celle du titre.
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

-- Point d'entrée de test : test/js/biblio.test.js charge ce fichier par dofile et compare
-- cle() à cle_comparaison() de docx-meta.py sur les mêmes textes. Comparer les deux sources
-- à l'œil ne prouverait rien du résultat, et c'est le résultat qui apparie.
SZH_BIBLIO_DETACHER = { cle = cle }

local function est_paragraphe(b)
  return b.t == 'Para' or b.t == 'Plain'
end

-- L'étendue, retrouvée en remontant depuis la fin du document.
--
-- docx-meta.py annonce la clé de CHAQUE paragraphe de l'étendue, y compris ceux qui ont
-- perdu le style en chemin : un paragraphe du corps n'a donc jamais sa clé dans la liste, et
-- c'est ce qui rend la remontée sûre. On consomme les clés en multi-ensemble — deux entrées
-- du même auteur institutionnel commencent par les mêmes quarante caractères, et les
-- compter à part était un décalage d'un paragraphe, mesuré sur le corpus.
--
-- Les bornes sont les paragraphes APPARIÉS les plus extrêmes ; tout ce qui est entre elles
-- part avec la liste, apparié ou non. C'est ce qui répare le défaut mesuré sur le corpus —
-- un paragraphe dont la clé diverge (un caractère en police Symbole dans ses quarante
-- premiers signes) ne fait plus sortir de la liste tout ce qui le précède. Et le sens de
-- lecture — de la fin vers le haut — garantit qu'on ne remonte jamais au-dessus du premier
-- paragraphe apparié : le corps de l'article est hors d'atteinte.
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
  -- Garde-fou : au-delà de l'étendue annoncée et d'une marge, on n'apparie plus rien de
  -- sensé — une clé encore attendue est une clé qui a divergé, et il est temps de s'arrêter.
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

function Pandoc(doc)
  local bornes, cle_titre = charger_meta()
  if #bornes == 0 then return nil end          -- rien à détacher : document inchangé

  local blocs = doc.blocks
  local debut, fin, reconnus = etendue(blocs, bornes)
  if not (debut and fin) then
    constat('avertissement', 'biblio-bornes-perdues',
      { 'article « ' .. slug_article() .. ' »', 'references ' .. #bornes },
      'La bibliographie de cet article a été repérée dans le document Word, mais ses '
      .. 'bornes n\'ont pas été retrouvées après conversion : elle reste dans le texte. '
      .. "L'article s'imprime normalement ; signalez ce cas, il n'est pas censé arriver.",
      'Das Literaturverzeichnis dieses Artikels wurde im Word-Dokument erkannt, seine '
      .. 'Grenzen liessen sich nach der Konvertierung aber nicht wiederfinden: es bleibt '
      .. 'im Text. Der Artikel wird normal gedruckt; melden Sie diesen Fall, er sollte '
      .. 'nicht vorkommen.')
    return nil
  end

  -- Le titre de section quitte le corps : il est reposé à la compilation, dans la langue de
  -- l'article et selon le réglage de l'application. Cherché juste au-dessus de l'étendue,
  -- et reconnu sur sa clé — pas sur son texte, et pas plus loin que trois blocs.
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

  -- L'étendue part en entier : les paragraphes qui ont perdu le style de bibliographie en
  -- chemin sont dedans, et c'est justement ce qui les sauve.
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
        garde:insert(b)            -- un bloc étranger à l'étendue n'est pas emporté
      end
    elseif i ~= bloc_titre then
      garde:insert(b)
    end
  end

  if pris == 0 then return nil end

  -- Le fichier ne porte que les références, sans titre. Écrit dans le dossier de l'article :
  -- pandoc tourne déjà dedans, comme tables/ et media/.
  local opts = pandoc.WriterOptions({ wrap_text = 'none' })
  local texte = pandoc.write(pandoc.Pandoc(refs),
    'markdown-simple_tables-multiline_tables-grid_tables', opts)
  local f = io.open(fichier, 'w')
  if not f then
    constat('avertissement', 'biblio-fichier-refuse',
      { 'article « ' .. slug .. ' »', 'fichier « ' .. fichier .. ' »' },
      'La bibliographie de cet article n\'a pas pu être enregistrée à part : elle reste '
      .. 'dans le texte. Vérifiez que le dossier du numéro est accessible en écriture.',
      'Das Literaturverzeichnis dieses Artikels konnte nicht separat gespeichert werden: '
      .. 'es bleibt im Text. Prüfen Sie, ob der Ordner der Ausgabe beschreibbar ist.')
    return nil
  end
  f:write(texte)
  f:close()

  doc.blocks = garde

  -- Le compte, toujours : c'est la seule preuve qu'aucune référence n'est restée derrière.
  -- Deux faits, et il faut les DEUX pour conclure à un reste. Une clé non appariée seule ne
  -- prouve rien : le paragraphe est peut-être dans l'étendue, et il est alors parti quand
  -- même. Moins de blocs qu'annoncé ne prouve rien non plus : pandoc rend parfois deux
  -- paragraphes Word en un seul, ce qui ne perd rien. C'est leur conjonction qui signe un
  -- paragraphe resté dehors — sur le corpus des 421 galleys, un seul article, et c'était un
  -- intertitre de la liste promu en titre par szh-titres.
  local manquants = (reconnus < #bornes and pris < #bornes) and (#bornes - pris) or 0
  if manquants > 0 then
    constat('avertissement', 'biblio-incomplete',
      { 'article « ' .. slug .. ' »', 'paragraphes ' .. manquants },
      string.format('Bibliographie mise à part, sauf %d paragraphe(s) : ils restent dans '
        .. 'le texte, juste après la liste. Rien n\'est perdu ; si ce sont des références, '
        .. 'donnez-leur le style de bibliographie dans le Word et réimportez.', manquants),
      string.format('Literaturverzeichnis ausgelagert, ausser %d Absatz/Absätzen: sie '
        .. 'bleiben im Text, direkt nach der Liste. Es geht nichts verloren; sind es '
        .. 'Einträge, geben Sie ihnen im Word die Formatvorlage für '
        .. 'Literaturverzeichnisse und importieren Sie neu.', manquants))
  else
    constat('info', 'biblio-detachee',
      { 'article « ' .. slug .. ' »', 'attendus ' .. #bornes, 'detaches ' .. pris },
      string.format('Bibliographie mise à part : %d paragraphe(s) sur %d attendu(s).',
        pris, #bornes),
      string.format('Literaturverzeichnis ausgelagert: %d von %d erwarteten Absätzen.',
        pris, #bornes))
  end
  return doc
end
