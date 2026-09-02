-- Rubriques de texte riche de la Documentation d'un article : listes bibliographiques,
-- listes de liens, brèves d'actualité — le second régime de contenu de la Documentation
-- (voir SPEC-actualite.md §0.b), à côté des fiches structurées de szh-ressource.lua.
-- Aucun champ n'y est isolable : un seul champ de texte riche par bloc, du markdown
-- ordinaire déjà parsé par pandoc — ce filtre se contente de l'ENVELOPPER, il ne le
-- retouche pas (pas de retype, pas de reformatage : l'italique, le gras, les liens, les
-- listes du .md sortent inchangés).
--
--   ::: {#b1a2b3c4 .szh-rubrique type="dossier-references"}
--   Barreyre, J. (2019). *Les personnes en situation de handicap complexe*. Alter,
--   13-3, 207-217.
--   :::
--
-- Ce qui sort :
--   <section id="b1a2b3c4" class="szh-rubrique szh-rubrique-dossier-references">
--     <h2 class="szh-rubrique-titre">Références du dossier</h2>
--     <div class="szh-rubrique-corps">
--       <p>Barreyre, J. (2019). <em>Les personnes…</em></p>
--     </div>
--   </section>
--
-- ⚠ <section>, pas <div>, vérifié à la main plutôt que supposé : le writer html5 de
--   pandoc n'écrit <section> que pour une Div qui porte la classe-marqueur "section" —
--   et cette classe-marqueur ne PARAÎT PAS dans le HTML de sortie, pandoc la consomme au
--   passage (`pandoc essai.md --to=html5` sur une Div `{.section}` seule donne bien
--   `<section>`, jamais `<div class="section">`). On la pose donc ici comme classe
--   surnuméraire pour obtenir l'élément, en plus des classes réelles qui, elles,
--   survivent intactes dans l'attribut `class`. Aucun RawBlock : le contenu reste dans
--   l'arbre pandoc de bout en bout, donc dans l'arbre de structure PDF/UA-1 que
--   WeasyPrint en tire.
--
-- ⚠ Piège trouvé en vérifiant ce qui précède, sans rapport avec la classe-marqueur : le
--   writer html5 de pandoc promeut DE LUI-MÊME toute Div dont le PREMIER enfant est un
--   Header d'identifiant VIDE en <section>, ET fusionne alors la classe du Header dans
--   l'attribut `class` de cette section — un `<h2 class="szh-rubrique-titre">` en tête
--   ressortait en `<section class="szh-rubrique-titre szh-rubrique …">`, l'identifiant du
--   header se retrouvant sur le bloc entier. Confirmé sur l'AST (`--to=native` : propre)
--   donc bien un défaut du writer, pas du filtre ; confirmé aussi que rien de tout ceci
--   n'a besoin de la classe-marqueur "section" ci-dessus pour se déclencher : un header de
--   tête à identifiant vide suffit, marqueur ou pas. D'où titre_id() plus bas : le Header
--   posé ici reçoit TOUJOURS un identifiant non vide.
--
-- Le titre imprimé n'est JAMAIS écrit dans le .md (voir SPEC-actualite.md §1) : il se
-- déduit ici du type et de la langue de l'ARTICLE, exactement comme le libellé de lien
-- d'une fiche de ressource (szh-ressource.lua) — même raison : explicite et non
-- modifiable par mégarde (donc utilisable hors contexte par un lecteur d'écran), et un
-- titre corrigé plus tard suit sans ressaisie.
--
-- Place dans la chaîne — non négociable (SPEC-actualite.md §1, pipeline/Makefile) : juste
-- après szh-citations.lua, avant szh-notes.lua — donc après szh-sections.lua, déjà passé
-- plus haut dans la chaîne. Deux pièges, tous deux évités par cet ordre :
--   1. szh-sections.lua numérote les <h2> du corps DANS LE TEXTE (« 1 », « 1.1 ») en une
--      seule passe, déjà faite quand ce filtre s'exécute : le <h2> qu'il pose ici n'existe
--      pas encore à ce moment-là et ne sera donc jamais vu ni numéroté. Inversé, le titre
--      de rubrique sortirait « 1 Références du dossier ».
--   2. szh-citations.lua reconnaît le titre de la bibliographie sur son TEXTE
--      (« Références », « Literatur »), déjà passé aussi : un <h2> « Références du
--      dossier » ou « Literatur zum Schwerpunkt » présent avant son passage aurait pu être
--      pris pour la bibliographie.
--
-- ⚠ Table TITRES recopiée depuis lib/rubriques.js (côté cockpit) : un test doit
--   contrôler qu'elles restent identiques, comme test/js/ressources.test.js le fait pour
--   TYPES entre lib/ressources.js et szh-ressource.lua.

local utils = pandoc.utils

local CLASSE = 'szh-rubrique'

-- Le titre imprimé, par type et par langue, dans l'ordre d'affichage du formulaire.
-- ⚠ Recopiée depuis lib/rubriques.js (table TITRES) — SPEC-actualite.md §1.
local TITRES = {
  ['dossier-references'] = { fr = 'Références du dossier', de = 'Literatur zum Schwerpunkt' },
  ['dossier-liens']      = { fr = 'Sites en lien avec le dossier', de = 'Linksammlung zum Schwerpunkt' },
  ['tour-horizon']       = { fr = 'Tour d’horizon', de = 'Rundschau' },
  ['ressources']         = { fr = 'Ressources', de = 'Ressourcen' },
  ['podcasts']           = { fr = 'Documentaires et podcasts', de = 'Dokumentarfilme und Podcasts' },
}
-- ⚠ Pas d'entrée ['agenda'] ici, et ce n'est pas un oubli : l'agenda a quitté les
--   rubriques le 02.09.2026 pour devenir un type de FICHE (szh-ressource.lua, TYPES.agenda),
--   avec sa date de début, sa date de fin, son lieu et son organisateur. Un ancien bloc
--   ::: {.szh-rubrique type="agenda"} laissé dans un .md sort donc SANS TITRE, mais avec
--   son contenu intact — la dégradation propre du cas « type inconnu » plus bas.

-- Langue de composition : même idiome que langue_de() de szh-ressource.lua, recopié tel
-- quel (voir son commentaire pour le pourquoi de la simplification par rapport à la
-- version de szh-numerotation.lua) — meta.lang de l'article d'abord, puis le jeton de
-- revue, puis le français.
local function langue_de(meta)
  local l = utils.stringify(meta and meta.lang or ''):lower():match('^(%a%a)')
  if l == 'fr' or l == 'de' then return l end
  local revue = utils.stringify(meta and meta.revue or ''):lower()
  if revue:find('zeitschrift') then return 'de' end
  return 'fr'
end

local function a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

-- Un type dont le nom ne peut pas casser la liste de classes HTML (espace, accolade…) —
-- même contrôle que type_sain() de szh-ressource.lua.
local function type_sain(t) return t ~= nil and t:match('^%a[%w%-]*$') ~= nil end

-- Secours pour titre_id() ci-dessous : un bloc sans identifiant ne devrait jamais
-- apparaître (le formulaire en pose toujours un, voir l'en-tête), mais si un .md écrit à
-- la main en manque un, ce compteur garantit quand même des identifiants distincts d'une
-- rubrique à l'autre du même document plutôt que la même chaîne vide partout.
local secours = 0

-- Identifiant du <h2> de titre : TOUJOURS non vide (voir le ⚠ de l'en-tête sur le writer
-- html5). Dérivé de celui du bloc — posé par le formulaire, stable — pour rester lisible
-- et prévisible plutôt qu'arbitraire.
local function titre_id(div)
  if div.identifier and div.identifier ~= '' then return div.identifier .. '-titre' end
  secours = secours + 1
  return CLASSE .. '-titre-secours-' .. secours
end

function Pandoc(doc)
  local lang = langue_de(doc.meta)

  doc.blocks = doc.blocks:walk({
    Div = function(div)
      if not a_classe(div, CLASSE) then return nil end
      local type_ = div.attributes['type']

      -- "section" est la classe-marqueur consommée par le writer html5 (voir l'en-tête) :
      -- elle n'apparaîtra pas dans le HTML, seules CLASSE et son éventuel modificateur y
      -- survivent.
      local classes = { CLASSE, 'section' }
      if type_sain(type_) then classes[#classes + 1] = CLASSE .. '-' .. type_ end

      -- Un type absent ou inconnu : pas de titre (on ne fabrique rien depuis le jeton),
      -- mais le bloc sort quand même, avec son contenu intact — dégradation propre.
      local titres_type = type_ and TITRES[type_]
      local titre = titres_type and titres_type[lang]

      local blocs = pandoc.Blocks({})
      if titre then
        blocs:insert(pandoc.Header(2, pandoc.Inlines({ pandoc.Str(titre) }),
          pandoc.Attr(titre_id(div), { CLASSE .. '-titre' }, {})))
      end
      -- Le contenu du bloc, inchangé, seulement enveloppé.
      blocs:insert(pandoc.Div(div.content, pandoc.Attr('', { CLASSE .. '-corps' }, {})))

      return pandoc.Div(blocs, pandoc.Attr(div.identifier or '', classes, {}))
    end,
  })

  return doc
end
