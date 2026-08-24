-- Normalise les niveaux de titre du corps, pour le rendu HTML et PDF (RGAA 9.1) : le
-- <h1> du document est le titre de l'article (couverture), le corps commence donc à
-- <h2>. Dans le .md, « # » reste la section de premier niveau.
--
-- Ce filtre ne décale pas, il **compacte** : les niveaux réellement présents sont
-- renumérotés 2, 3, 4… sans trou. Un article stylé Heading 2 puis Heading 4 sous Word
-- sortait en <h2> puis <h4> — un saut de niveau, que le RGAA 9.1 interdit et qu'un
-- lecteur d'écran annonce comme une section manquante. Le cas est majoritaire : l'auteur
-- choisit ses styles Word à l'œil, et c'est précisément le désordre que docx-titres.py
-- existe pour rattraper.
--
-- Borne à 6, parce que pandoc dégraderait un niveau 7 en <p class="heading">, sans
-- sémantique de titre. Cinq rangs tiennent entre 2 et 6 : au-delà, deux niveaux distincts
-- se retrouvent au même, et **ce filtre le dit** en nommant l'article. Un écrasement
-- silencieux — l'ancien comportement — est ce qu'on corrige ici.
--
-- À garder aligné avec szh-sections.lua, qui numérote les titres du corps dans le texte
-- (2.1, 2.1.1) sur les trois premiers rangs seulement, et avec print.css, qui les style
-- en miroir.

local MIN_CIBLE = 2
local MAX_CIBLE = 6

-- Nom de l'article pour le journal : le fichier d'entrée suffit, la chaîne compile dans
-- le dossier de l'article et le slug est ce que le rédacteur reconnaît.
local function nom_article()
  local etat = PANDOC_STATE
  local entrees = etat and etat.input_files
  if entrees and entrees[1] then
    return (tostring(entrees[1]):gsub('.*[/\\]', ''):gsub('%.md$', ''))
  end
  return 'article'
end

local function signaler(niveaux_ecrases)
  local liste = table.concat(niveaux_ecrases, ', ')
  local article = nom_article()
  io.stderr:write(string.format(
    '[niveaux] %s : plus de %d rangs de titre — les niveaux %s se retrouvent tous en <h%d>.\n',
    article, MAX_CIBLE - MIN_CIBLE + 1, liste, MAX_CIBLE))
  io.stderr:write(
    '[niveaux]   Deux sections de profondeurs différentes deviennent indiscernables pour '
    .. 'un lecteur d\'écran. À faire : remonter les sous-titres les plus profonds d\'un rang.\n')
  io.stderr:write(string.format(
    '[niveaux] [de] %s: mehr als %d Titelstufen — die Stufen %s landen alle in <h%d>.\n',
    article, MAX_CIBLE - MIN_CIBLE + 1, liste, MAX_CIBLE))
  io.stderr:write(
    '[niveaux] [de]   Zwei Abschnitte unterschiedlicher Tiefe werden für einen '
    .. 'Screenreader ununterscheidbar. Zu tun: die tiefsten Untertitel um eine Stufe anheben.\n')
end

function Pandoc(doc)
  local presents = {}
  doc:walk({
    Header = function(h) presents[h.level] = true end,
  })
  local rangs = {}
  for niveau in pairs(presents) do rangs[#rangs + 1] = niveau end
  if #rangs == 0 then return doc end   -- aucun titre dans le corps
  table.sort(rangs)

  -- Le rang i (1-based) devient MIN_CIBLE + i - 1 : la suite est compacte par
  -- construction, aucun trou possible.
  local cible, ecrases = {}, {}
  for i, niveau in ipairs(rangs) do
    local vise = MIN_CIBLE + i - 1
    if vise > MAX_CIBLE then
      vise = MAX_CIBLE
      ecrases[#ecrases + 1] = tostring(niveau)
    end
    cible[niveau] = vise
  end
  if #ecrases > 0 then
    -- Le premier niveau légitimement en MAX_CIBLE est écrasé avec les suivants : on le
    -- nomme aussi, sinon le message désignerait un seul niveau et ne dirait pas avec quoi
    -- il fusionne.
    table.insert(ecrases, 1, tostring(rangs[MAX_CIBLE - MIN_CIBLE + 1]))
    signaler(ecrases)
  end

  return doc:walk({
    Header = function(h)
      h.level = cible[h.level] or h.level
      return h
    end,
  })
end
