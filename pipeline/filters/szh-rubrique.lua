-- Rubriques de texte riche de la Documentation : listes bibliographiques, listes de liens,
-- brèves d'actualité. Les fiches structurées sont traitées par szh-ressource.lua.
-- Le contenu, du markdown ordinaire, sort tel quel. Seul le rang des titres écrits dans le
-- bloc est abaissé sous le <h2> que le filtre ajoute (abaisser_titres).
--
--   ::: {#b1a2b3c4 .szh-rubrique type="dossier_references"}
--   Barreyre, J. (2019). *Les personnes en situation de handicap complexe*. Alter,
--   13-3, 207-217.
--   :::
--
-- donne :
--   <section id="b1a2b3c4" class="szh-rubrique szh-rubrique-dossier_references">
--     <h2 class="szh-rubrique-titre">Références du dossier</h2>
--     <div class="szh-rubrique-corps">
--       <p>Barreyre, J. (2019). <em>Les personnes…</em></p>
--     </div>
--   </section>
--
-- Le writer html5 de pandoc n'écrit <section> que pour une Div qui porte la classe
-- « section », qu'il retire au passage. Le filtre la pose donc en plus des classes réelles.
-- Tout reste dans l'arbre pandoc (aucun RawBlock), donc dans la structure PDF/UA.
--
-- Piège du writer html5 : une Div dont le premier enfant est un Header d'identifiant vide
-- devient une <section> qui reprend l'identifiant et la classe du Header. Le <h2> posé ici
-- reçoit donc toujours un identifiant (titre_id). Depuis pandoc 3.10, la classe du Header
-- passe sur la <section> même avec un identifiant : print.css vise
-- `h2.szh-rubrique-titre`, pas la classe seule.
--
-- Le titre imprimé ne s'écrit pas dans le .md : il vient du type et de la langue, lus dans
-- pipeline/kirby/champs-documentation.json (rubriques[].titre), que lisent aussi le
-- formulaire du cockpit et documentation-kirby.py. Un type absent du JSON sort sans titre,
-- contenu intact.
--
-- Le filtre compose aussi les sections qui regroupent les fiches d'un même type (horizon,
-- recherche…), ::: {.szh-ressources-section type="…"} posé par documentation-kirby.py.
-- Leur titre vient de types[].libelle.
--
-- Place dans la chaîne (pipeline/Makefile) : après szh-citations.lua, avant
-- szh-notes.lua, donc après szh-sections.lua. Ainsi :
--   1. szh-sections.lua ne voit pas les <h2> posés ici et ne les numérote pas ;
--   2. szh-citations.lua, qui reconnaît le titre de la bibliographie à son texte
--      (« Références », « Literatur »), ne prend pas « Références du dossier » pour elle.
-- Pour la même raison, les titres des sections de fiches sont posés ici et non dans
-- szh-ressource.lua, qui s'exécute avant szh-sections.lua.

local CLASSE = 'szh-rubrique'
local CLASSE_SECTION = 'szh-ressources-section'

-- Contrat JSON et module commun, chargés depuis le dossier de ce fichier (voir
-- szh-ressource.lua). Sans eux, la compilation s'arrête.
local TITRES
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok_commun, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok_commun or type(module) ~= 'table' then
    io.stderr:write('[rubrique] szh-commun.lua introuvable ou fautif (' .. tostring(module) ..
      ') : ce filtre ne peut pas composer sans lui, arret.\n')
    os.exit(1, true)
  end
  commun = module
  local chemin = dossier_ce_fichier() .. '../kirby/champs-documentation.json'
  local fh = io.open(chemin, 'r')
  if not fh then
    io.stderr:write('[rubrique] ' .. chemin .. ' introuvable : ce filtre ne peut pas composer sans lui, arret.\n')
    os.exit(1, true)
  end
  local contenu = fh:read('a')
  fh:close()
  local ok, data = pcall(pandoc.json.decode, contenu)
  if not ok or type(data) ~= 'table' then
    io.stderr:write('[rubrique] ' .. chemin .. ' illisible (' .. tostring(data) .. ') : arret.\n')
    os.exit(1, true)
  end
  TITRES = {}
  for _, r in ipairs(data.rubriques or {}) do
    TITRES[r.cle] = r.titre
  end
  -- Les clés de rubriques[] et de types[] sont distinctes dans le contrat : une seule
  -- table suffit.
  for cle, t in pairs(data.types or {}) do
    TITRES[cle] = t.libelle
  end
end

local a_classe = commun.a_classe

-- Vrai si le type peut entrer dans une classe HTML (comme type_sain() de
-- szh-ressource.lua). Le soulignement est admis (dossier_references).
local function type_sain(t) return t ~= nil and t:match('^%a[%w_%-]*$') ~= nil end

-- Compteur pour un bloc sans identifiant (.md écrit à la main ; le formulaire en pose
-- toujours un) : les identifiants de secours restent distincts dans le document.
local secours = 0

-- Identifiant du <h2> de titre, jamais vide (voir le piège du writer html5 en tête),
-- dérivé de celui du bloc.
local function titre_id(div)
  if div.identifier and div.identifier ~= '' then return div.identifier .. '-titre' end
  secours = secours + 1
  return CLASSE .. '-titre-secours-' .. secours
end

-- Identifiant du <div> de contenu, jamais vide, pour la même raison (voir section_titree).
local function corps_id(div)
  if div.identifier and div.identifier ~= '' then return div.identifier .. '-corps' end
  secours = secours + 1
  return CLASSE .. '-corps-secours-' .. secours
end

-- Abaisse les titres écrits dans le bloc sous le <h2> de la rubrique. Le rang le plus haut
-- présent devient h3, les autres suivent du même décalage. « ## International » et
-- « ### International » donnent tous deux un h3. Seul le rang change, pas le texte.
-- Fait ici plutôt que dans szh-niveaux.lua, qui laisse les rubriques intactes : seul ce
-- filtre connaît le rang du titre de la rubrique.
local RANG_CONTENU = 3
local function abaisser_titres(contenu)
  local plus_haut = nil
  contenu:walk({
    Header = function(h)
      if not plus_haut or h.level < plus_haut then plus_haut = h.level end
    end,
  })
  if not plus_haut then return contenu end              -- aucun titre : rien à faire
  local decalage = RANG_CONTENU - plus_haut
  if decalage == 0 then return contenu end
  return contenu:walk({
    Header = function(h)
      local rang = h.level + decalage
      -- pandoc dégraderait un rang 7 en paragraphe : on bute à 6, comme szh-niveaux.lua.
      if rang < RANG_CONTENU then rang = RANG_CONTENU elseif rang > 6 then rang = 6 end
      h.level = rang
      return h
    end,
  })
end

-- Compose la <section> titrée d'une rubrique ou d'une section de fiches. `rabattre` :
-- abaisser les titres du contenu (rubrique seulement).
local function section_titree(div, classe, lang, rabattre)
  local type_ = div.attributes['type']
  local classes = { classe, 'section' }
  if type_sain(type_) then classes[#classes + 1] = classe .. '-' .. type_ end

  -- Type absent ou inconnu : pas de titre, le contenu sort quand même.
  local titres_type = type_ and TITRES[type_]
  local titre = titres_type and titres_type[lang]

  local blocs = pandoc.Blocks({})
  if titre then
    blocs:insert(pandoc.Header(2, pandoc.Inlines({ pandoc.Str(titre) }),
      pandoc.Attr(titre_id(div), { classe .. '-titre' }, {})))
  end
  local contenu = rabattre and abaisser_titres(div.content) or div.content
  -- L'identifiant de ce Div est nécessaire : un Div d'identifiant vide qui commence par un
  -- Header sortirait en <section> et prendrait l'identifiant de ce Header, que le titre
  -- perdrait.
  blocs:insert(pandoc.Div(contenu, pandoc.Attr(corps_id(div), { classe .. '-corps' }, {})))

  return pandoc.Div(blocs, pandoc.Attr(div.identifier or '', classes, {}))
end

function Pandoc(doc)
  -- Le contrat de la Documentation n'existe qu'en français et en allemand.
  local lang = commun.contexte(doc.meta).lang
  if lang ~= 'de' then lang = 'fr' end

  doc.blocks = doc.blocks:walk({
    Div = function(div)
      -- Une fiche n'a pas d'intertitres (son titre est un Para) : rien à abaisser.
      if a_classe(div, CLASSE) then return section_titree(div, CLASSE, lang, true) end
      if a_classe(div, CLASSE_SECTION) then return section_titree(div, CLASSE_SECTION, lang, false) end
      return nil
    end,
  })

  return doc
end
