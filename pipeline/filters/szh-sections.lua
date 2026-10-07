-- Numérote les titres du corps dans le texte : « 2 », « 2.1 », « 2.1.1 » en tête du
-- <h2>/<h3>/<h4>, dans un Span de classe szh-num-section.
--
-- Le numéro est du vrai contenu et non un compteur CSS : le galley DOCX, produit depuis le
-- HTML par pandoc, perdrait un numéro généré par `content:`. print.css ne doit donc pas
-- numéroter les titres, sinon le numéro sort deux fois (un styles/print.css local ancien
-- peut encore porter des compteurs sec1/sec2/sec3).
--
-- Trois rangs sont numérotés. Les rangs viennent de szh-niveaux.lua, qui compacte les
-- niveaux présents à partir de 2 : la suite n'a pas de trou.
--
-- Le titre du résumé et celui du bloc « À propos des auteur·e·s » sont écrits par le
-- template szh-article.html, hors du document pandoc, et ne sont pas numérotés.
--
-- S'exécute avant szh-citations.lua, dont texte_de_titre() retire le Span de numéro avant
-- de comparer un titre au lexique.

local PREMIER_RANG = 2      -- <h2> = premier rang de section (le <h1> est le titre de l'article)
local RANGS = 3             -- h2, h3, h4 numérotés ; h5 et h6 non
local CLASSE = 'szh-num-section'
-- Espace insécable entre le numéro et le titre, pour que le numéro ne reste pas seul en
-- fin de ligne. print.css ajoute l'espacement visuel (margin-right).
local LIAISON = '\u{00A0}'

-- Livre : chaque chapitre est compilé par un appel séparé à pandoc
-- (pipeline/profils/livre.mk), et son <h1> est le titre du chapitre. Il reçoit le numéro
-- du chapitre (« 2 Theoretische Konzepte ») et les sections le reprennent (« 2.1 »).
-- SZH_CHAPITRE porte le rang du chapitre. Sans lui (article, pièces liminaires d'un
-- livre), RANG_CHAPITRE reste nil et le filtre numérote comme pour un article. Posé par
-- Pandoc(doc).
local RANG_CHAPITRE = nil

-- Livre en maquette normal : le bloc `mise-en-page:` de buch.yaml dit si le titre de
-- chapitre et les sections portent un numéro (commun.mise_en_page, valeurs par défaut dans
-- pipeline/livre/mise-en-page.json). Ailleurs, tout est numéroté.
local NUMEROTER_CHAPITRE, NUMEROTER_SECTIONS = true, true
-- Le numéro écrit dans le titre du chapitre et en tête de ses sections : le rang, ou
-- celui de sa partie (`numeros-chapitres: partie`).
local NUMERO_CHAPITRE = nil

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[sections] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local compteurs = {}

-- Un titre déjà numéroté est laissé tel quel, pour qu'un document filtré deux fois ne
-- reçoive pas deux numéros.
local function deja_numerote(inlines)
  local premier = inlines[1]
  if not premier or premier.t ~= 'Span' then return false end
  for _, classe in ipairs(premier.classes) do
    if classe == CLASSE then return true end
  end
  return false
end

-- Écrit le numéro (déjà assemblé, points compris) en tête du titre.
local function poser_numero(h, numero)
  local contenu = pandoc.List({
    pandoc.Span(pandoc.Inlines({ pandoc.Str(numero .. LIAISON) }),
                pandoc.Attr('', { CLASSE })),
  })
  contenu:extend(h.content)
  h.content = contenu
  return h
end

-- Les titres écrits dans une rubrique de la Documentation (div .szh-rubrique du .md) ne
-- sont pas numérotés : la Documentation est une suite de rubriques, pas un article à
-- sections. Le titre de la rubrique elle-même est posé plus tard par szh-rubrique.lua.
-- szh-niveaux.lua fait la même exception.
local CLASSE_RUBRIQUE = 'szh-rubrique'
local function est_rubrique(el)
  if el.t ~= 'Div' then return false end
  for _, classe in ipairs(el.classes or {}) do
    if classe == CLASSE_RUBRIQUE then return true end
  end
  return false
end

local function numeroter(h)
  if deja_numerote(h.content) then return nil end

  -- Titre de chapitre (livre) : le numéro du chapitre seul, que les sections reprennent.
  if RANG_CHAPITRE and h.level == 1 then
    if not NUMEROTER_CHAPITRE or not NUMERO_CHAPITRE then return nil end
    return poser_numero(h, NUMERO_CHAPITRE)
  end

  local rang = h.level - PREMIER_RANG + 1
  if rang < 1 or rang > RANGS then return nil end
  if not NUMEROTER_SECTIONS then return nil end

  compteurs[rang] = (compteurs[rang] or 0) + 1
  for plus_profond = rang + 1, RANGS do compteurs[plus_profond] = 0 end

  -- Le numéro de chapitre, s'il y en a un, précède les rangs : dans le chapitre 2, un <h2>
  -- donne « 2.1 ».
  local morceaux = {}
  if RANG_CHAPITRE and NUMERO_CHAPITRE then morceaux[#morceaux + 1] = NUMERO_CHAPITRE end
  for i = 1, rang do morceaux[#morceaux + 1] = tostring(compteurs[i]) end
  return poser_numero(h, table.concat(morceaux, '.'))
end

-- Pas de `function Header` globale : pandoc l'appliquerait à tous les titres avant
-- Pandoc(), rubriques comprises. Ici, `false` en second retour arrête la descente dans
-- une rubrique (traverse = 'topdown').
function Pandoc(doc)
  local livre = commun.contexte(doc.meta).produit == 'livre'
  RANG_CHAPITRE = livre and tonumber(os.getenv('SZH_CHAPITRE') or '') or nil
  local mep = commun.mise_en_page(doc.meta)
  NUMEROTER_CHAPITRE = not mep or mep['numeros-chapitres'] ~= 'aucun'
  -- `partie` : le numéro « 1.1 » calculé par livre.mk (livre-assembler.py
  -- --numeros-chapitres) ; vide pour un chapitre hors d'une partie numérotée.
  NUMERO_CHAPITRE = RANG_CHAPITRE and tostring(RANG_CHAPITRE) or nil
  if mep and mep['numeros-chapitres'] == 'partie' then
    local n = os.getenv('SZH_NUMERO_CHAPITRE') or ''
    NUMERO_CHAPITRE = n ~= '' and n or nil
  end
  NUMEROTER_SECTIONS = not mep or mep['numeros-sections'] ~= 'aucun'
  doc.blocks = doc.blocks:walk({
    traverse = 'topdown',
    Div = function(d) if est_rubrique(d) then return d, false end end,
    Header = numeroter,
  })
  return doc
end
