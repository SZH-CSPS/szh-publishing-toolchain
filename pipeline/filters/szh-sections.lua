-- Numérote les titres du corps **dans le texte** : « 2 », « 2.1 », « 2.1.1 », posés en
-- tête du <h2>/<h3>/<h4> comme un vrai contenu et non en CSS.
--
-- Pourquoi pas en CSS. print.css faisait `h2::before { content: counter(sec1) }`. Un
-- numéro posé par `content:` est du contenu généré : il n'existe que dans le rendu
-- paginé. Le galley DOCX de l'export OJS, régénéré depuis le HTML par le writer docx de
-- pandoc, sortait donc avec des titres **sans numéro** — là où le PDF affiche « 2.1 ».
-- Un renvoi « voir section 2.1 » dans le corps ne désignait rien dans le Word que reçoit
-- le lecteur. Écrit dans le texte, le numéro suit l'article partout : PDF, HTML, DOCX,
-- aperçu du cockpit.
--
-- ⚠ La numérotation CSS a été retirée de print.css en même temps. Les deux ne doivent
--   jamais coexister : « 2.1 2.1 Introduction » serait pire que le défaut d'origine. Un
--   numéro qui porte un `styles/print.css` local hérité peut encore contenir les anciens
--   compteurs `sec1/sec2/sec3` — voir TODORMO.md.
--
-- Trois rangs numérotés, pas plus : c'est ce que faisait le CSS (h5 et h6 gardaient la
-- taille et la graisse de h4 sans numéro), et un « 2.1.1.1.1 » ne se lit plus. Les rangs
-- viennent de szh-niveaux.lua, qui compacte les niveaux réellement présents à partir de 2 :
-- il n'y a donc jamais de trou dans la suite, et un h4 est bien un troisième rang.
--
-- Ne numérote pas ce qu'il ne voit pas : le titre du résumé et celui du bloc « À propos
-- des auteur·e·s » sont écrits par le template szh-article.html, hors document pandoc.
-- Le CSS devait les dé-numéroter à la main (`counter-increment: none`) ; ce n'est plus
-- nécessaire, et ces neutralisations ont été retirées avec les compteurs.
--
-- Doit tourner **après szh-citations.lua** : celui-ci reconnaît le titre de la
-- bibliographie sur son texte (« Références », « Literatur »), et un numéro collé devant
-- l'empêche de le trouver. Mesuré sur un article à deux références, filtres inversés :
-- 0 référence, 0 ancrage, 0 appel lié — toute la liste de références perd son ancrage, en
-- silence. Et le piège est pire qu'il n'y paraît : au-delà de trois références,
-- szh-citations retombe sur une heuristique de fin de document et s'en sort quand même.
-- L'ordre inversé passerait donc le banc et casserait sur un article court.
-- Voir l'ordre des --lua-filter dans le Makefile.

local PREMIER_RANG = 2      -- <h2> = premier rang de section (le <h1> est le titre de l'article)
local RANGS = 3             -- h2, h3, h4 numérotés ; h5 et h6 non
local CLASSE = 'szh-num-section'
-- Espace insécable entre le numéro et le titre : le numéro ne doit jamais se retrouver
-- seul en fin de ligne. print.css ajoute la respiration visuelle (margin-right).
local LIAISON = '\u{00A0}'

-- Livre seulement : un LIVRE compile chaque chapitre par une invocation pandoc séparée
-- (pipeline/profils/livre.mk), et le <h1> qu'on rejette ci-dessus pour un article — sa
-- page de garde, hors document pandoc — EST ici le titre du chapitre. Un livre publié le
-- numérote (« 2 Theoretische Konzepte… ») et les sections s'y accrochent (« 2.1 »,
-- « 2.1.1 »). SZH_CHAPITRE porte le rang du chapitre ; absent (hors livre, ou pour les
-- pièces liminaires qui ne le reçoivent pas), RANG_CHAPITRE reste nil et tout ce qui suit
-- retombe sur le comportement d'un article, à l'identique.
local LIVRE = (os.getenv('SZH_LIVRE') or '') ~= ''
local RANG_CHAPITRE = LIVRE and tonumber(os.getenv('SZH_CHAPITRE') or '') or nil

local compteurs = {}

-- Un titre déjà numéroté est laissé tel quel : la chaîne ne passe qu'une fois, mais un
-- rendu deux fois filtré ne doit pas doubler le numéro.
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

function Header(h)
  if deja_numerote(h.content) then return nil end

  -- Le titre de chapitre, un seul par document livre : il reçoit le rang du chapitre
  -- lui-même, sans point — c'est le niveau dont les sections suivantes héritent.
  if RANG_CHAPITRE and h.level == 1 then
    return poser_numero(h, tostring(RANG_CHAPITRE))
  end

  local rang = h.level - PREMIER_RANG + 1
  if rang < 1 or rang > RANGS then return nil end

  compteurs[rang] = (compteurs[rang] or 0) + 1
  for plus_profond = rang + 1, RANGS do compteurs[plus_profond] = 0 end

  -- Le numéro de chapitre, s'il y en a un, précède toujours les rangs de section : dans le
  -- chapitre 2, un <h2> donne « 2.1 » et non « 1 ».
  local morceaux = {}
  if RANG_CHAPITRE then morceaux[#morceaux + 1] = tostring(RANG_CHAPITRE) end
  for i = 1, rang do morceaux[#morceaux + 1] = tostring(compteurs[i]) end
  return poser_numero(h, table.concat(morceaux, '.'))
end
