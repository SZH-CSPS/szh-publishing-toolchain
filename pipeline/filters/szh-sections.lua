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

function Header(h)
  local rang = h.level - PREMIER_RANG + 1
  if rang < 1 or rang > RANGS then return nil end
  if deja_numerote(h.content) then return nil end

  compteurs[rang] = (compteurs[rang] or 0) + 1
  for plus_profond = rang + 1, RANGS do compteurs[plus_profond] = 0 end

  local morceaux = {}
  for i = 1, rang do morceaux[i] = tostring(compteurs[i]) end
  local numero = table.concat(morceaux, '.') .. LIAISON

  local contenu = pandoc.List({
    pandoc.Span(pandoc.Inlines({ pandoc.Str(numero) }),
                pandoc.Attr('', { CLASSE })),
  })
  contenu:extend(h.content)
  h.content = contenu
  return h
end
