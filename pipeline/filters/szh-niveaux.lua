-- Normalise les niveaux de titre du corps (RGAA 9.1, PDF/UA-1 7.4.2-1). Le <h1> est le
-- titre de l'article (posé par le gabarit) ou du chapitre ; le corps commence à <h2>. Dans
-- le .md, « # » reste la section de premier niveau.
--
-- Les niveaux présents sont compactés : renumérotés 2, 3, 4… sans trou. Un Word stylé
-- Heading 2 puis Heading 4 donnerait sinon un saut de niveau, qu'un lecteur d'écran annonce
-- comme une section manquante.
--
-- Borne à 6 : pandoc rendrait un niveau 7 en <p class="heading">, sans sémantique de
-- titre. Au-delà de cinq rangs, plusieurs niveaux se retrouvent en <h6>, et le filtre le
-- signale en nommant l'article.
--
-- À garder aligné avec szh-sections.lua (qui numérote les trois premiers rangs, 2.1,
-- 2.1.1) et avec print.css.

-- Livre : le h1 est le titre du chapitre ; il garde son rang et n'entre pas dans le
-- compactage. Posé par Pandoc(doc), d'après le contexte de composition.
local LIVRE = false
local MIN_CIBLE = 2
local MAX_CIBLE = 6

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
-- Module commun (slug_article, contexte) : un chargement raté arrête la compilation, ce
-- filtre ne pouvant plus nommer l'article dans ses messages sans lui.
local commun
do
  -- debug.getinfo donne le chemin de ce fichier ; PANDOC_SCRIPT_FILE donnerait celui du
  -- script passé à pandoc, qui peut être un autre.
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[niveaux] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

-- Nom de l'article pour le journal : son slug.
local function nom_article()
  return commun.slug_article('article')
end

local function signaler(niveaux_ecrases)
  local liste = table.concat(niveaux_ecrases, ', ')
  local article = nom_article()
  io.stderr:write(string.format(
    '[niveaux] %s : plus de %d rangs de titre — les niveaux %s se retrouvent tous en <h%d>.\n',
    article, MAX_CIBLE - MIN_CIBLE + 1, liste, MAX_CIBLE))
  io.stderr:write(
    '[niveaux]   Deux sections de profondeurs différentes deviennent indiscernables pour '
    .. 'un lecteur d’écran. À faire : remonter les sous-titres les plus profonds d’un rang.\n')
  io.stderr:write(string.format(
    '[niveaux] [de] %s: mehr als %d Titelstufen — die Stufen %s landen alle in <h%d>.\n',
    article, MAX_CIBLE - MIN_CIBLE + 1, liste, MAX_CIBLE))
  io.stderr:write(
    '[niveaux] [de]   Zwei Abschnitte unterschiedlicher Tiefe werden für einen '
    .. 'Screenreader ununterscheidbar. Zu tun: die tiefsten Untertitel um eine Stufe anheben.\n')
end

-- Une rubrique de la Documentation garde sa propre hiérarchie : szh-rubrique.lua lui pose
-- un <h2> de titre et place ses titres intérieurs dessous. Les compacter ici les
-- remonterait au rang de ce titre. Ce filtre passe avant szh-rubrique.lua, mais la classe
-- est déjà posée par le fenced div du .md.
-- Les titres d'une rubrique ne sont pas non plus recensés : une Documentation, dont tous
-- les titres sont dans des rubriques, verrait sinon ses rangs calculés d'après eux.
local CLASSE_RUBRIQUE = 'szh-rubrique'
local function est_rubrique(el)
  return el.t == 'Div' and commun.a_classe(el, CLASSE_RUBRIQUE)
end

-- Parcours qui s'arrête au seuil d'une rubrique : `false` en second retour dit à pandoc
-- de ne pas descendre dans ce bloc (traverse = 'topdown').
local function parcourir_hors_rubriques(cible, sur_titre)
  return cible:walk({
    traverse = 'topdown',
    Div = function(d) if est_rubrique(d) then return d, false end end,
    Header = sur_titre,
  })
end

function Pandoc(doc)
  LIVRE = commun.contexte(doc.meta).produit == 'livre'
  local presents = {}
  parcourir_hors_rubriques(doc,
    -- Livre : le h1 est le titre du chapitre, il n'entre pas dans le calcul.
    function(h)
      if not (LIVRE and h.level == 1) then presents[h.level] = true end
    end)
  local rangs = {}
  for niveau in pairs(presents) do rangs[#rangs + 1] = niveau end
  if #rangs == 0 then return doc end   -- aucun titre dans le corps
  table.sort(rangs)

  -- Le rang i (à partir de 1) devient MIN_CIBLE + i - 1 : la suite est sans trou.
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
    -- Le premier niveau placé en MAX_CIBLE est nommé aussi, pour que le message dise
    -- avec quoi les suivants fusionnent.
    table.insert(ecrases, 1, tostring(rangs[MAX_CIBLE - MIN_CIBLE + 1]))
    signaler(ecrases)
  end

  return parcourir_hors_rubriques(doc, function(h)
    if LIVRE and h.level == 1 then return h end
    h.level = cible[h.level] or h.level
    return h
  end)
end
