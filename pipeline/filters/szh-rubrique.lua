-- Rubriques de texte riche de la Documentation d'un article : listes bibliographiques,
-- listes de liens, brèves d'actualité — le second régime de contenu de la Documentation,
-- à côté des fiches structurées de szh-ressource.lua. Aucun champ n'y est isolable : un
-- seul champ de texte riche par bloc, du markdown ordinaire déjà parsé par pandoc — ce
-- filtre se contente de l'envelopper, il ne le retouche pas (pas de retype, pas de
-- reformatage : l'italique, le gras, les liens, les listes du .md sortent inchangés).
--
-- Une seule exception, et elle ne touche à aucun texte : le RANG des titres écrits dans le
-- bloc est rabattu sous le <h2> de titre que ce filtre pose (abaisser_titres, plus bas).
-- Sans cela, « ## International » dans une Rundschau ressortait au rang du titre de la
-- rubrique, et szh-sections.lua le numérotait — « 1 International », « 1.1 la brève ».
--
--   ::: {#b1a2b3c4 .szh-rubrique type="dossier_references"}
--   Barreyre, J. (2019). *Les personnes en situation de handicap complexe*. Alter,
--   13-3, 207-217.
--   :::
--
-- Ce qui sort :
--   <section id="b1a2b3c4" class="szh-rubrique szh-rubrique-dossier_references">
--     <h2 class="szh-rubrique-titre">Références du dossier</h2>
--     <div class="szh-rubrique-corps">
--       <p>Barreyre, J. (2019). <em>Les personnes…</em></p>
--     </div>
--   </section>
--
-- ⚠ <section>, pas <div>, vérifié à la main plutôt que supposé : le writer html5 de
--   pandoc n'écrit <section> que pour une Div qui porte la classe-marqueur "section" —
--   et cette classe-marqueur ne paraît pas dans le HTML de sortie, pandoc la consomme au
--   passage (`pandoc essai.md --to=html5` sur une Div `{.section}` seule donne bien
--   `<section>`, jamais `<div class="section">`). On la pose donc ici comme classe
--   surnuméraire pour obtenir l'élément, en plus des classes réelles qui, elles,
--   survivent intactes dans l'attribut `class`. Aucun RawBlock : le contenu reste dans
--   l'arbre pandoc de bout en bout, donc dans l'arbre de structure PDF/UA-1 que
--   WeasyPrint en tire.
--
-- ⚠ Piège trouvé en vérifiant ce qui précède, sans rapport avec la classe-marqueur : le
--   writer html5 de pandoc promeut de lui-même toute Div dont le premier enfant est un
--   Header d'identifiant vide en <section>, et fusionne alors la classe du Header dans
--   l'attribut `class` de cette section — un `<h2 class="szh-rubrique-titre">` en tête
--   ressortait en `<section class="szh-rubrique-titre szh-rubrique …">`, l'identifiant du
--   header se retrouvant sur le bloc entier. Confirmé sur l'AST (`--to=native` : propre)
--   donc bien un défaut du writer, pas du filtre ; confirmé aussi que rien de tout ceci
--   n'a besoin de la classe-marqueur "section" ci-dessus pour se déclencher : un header de
--   tête à identifiant vide suffit, marqueur ou pas. D'où titre_id() plus bas : le Header
--   posé ici reçoit toujours un identifiant non vide.
--   ⚠ Cela ne suffit plus à partir de pandoc 3.10 : la classe du Header passe sur la
--   <section> même quand il a un identifiant (mesuré le 23.09.2026). print.css vise donc
--   `h2.szh-rubrique-titre`, jamais la classe seule.
--
-- Le titre imprimé n'est jamais écrit dans le .md : il se déduit ici du type et de la
-- langue de l'article, exactement comme le libellé de lien d'une fiche de ressource
-- (szh-ressource.lua) — même raison : explicite et non modifiable par mégarde (donc
-- utilisable hors contexte par un lecteur d'écran), et un titre corrigé plus tard suit
-- sans ressaisie.
--
-- Place dans la chaîne — non négociable (pipeline/Makefile, en-tête) : juste après
-- szh-citations.lua, avant szh-notes.lua — donc après szh-sections.lua, déjà passé plus
-- haut dans la chaîne. Deux pièges, tous deux évités par cet ordre :
--   1. szh-sections.lua numérote les <h2> du corps dans le texte (« 1 », « 1.1 ») en une
--      seule passe, déjà faite quand ce filtre s'exécute : le <h2> qu'il pose ici n'existe
--      pas encore à ce moment-là et ne sera donc jamais vu ni numéroté. Inversé, le titre
--      de rubrique sortirait « 1 Références du dossier ».
--   2. szh-citations.lua reconnaît le titre de la bibliographie sur son texte
--      (« Références », « Literatur »), déjà passé aussi : un <h2> « Références du
--      dossier » ou « Literatur zum Schwerpunkt » présent avant son passage aurait pu être
--      pris pour la bibliographie.
--
-- Le titre imprimé de chaque rubrique vient de pipeline/kirby/champs-documentation.json
-- (rubriques[].titre), jamais d'une table recopiée ici : un seul endroit où le changer,
-- lu aussi par le formulaire du cockpit et par documentation-kirby.py. Un type absent du
-- JSON (faute de frappe, bloc mal formé) sort sans titre, contenu intact — la dégradation
-- propre du cas « type inconnu » plus bas.
--
-- Second régime traité ici, et pas dans szh-ressource.lua : la SECTION qui regroupe les
-- fiches d'un même type (horizon, recherche, intervention…), posée par
-- documentation-kirby.py en ::: {.szh-ressources-section type="…"} autour des fiches de
-- ce type. Son titre vient de types[].libelle (au lieu de rubriques[].titre) et suit le
-- même traitement — <section>, <h2> non numéroté, même habillage visuel que le titre d'une
-- rubrique (print.css). Elle DOIT être composée ici, après szh-sections.lua, et non dans
-- szh-ressource.lua : ce dernier tourne AVANT szh-sections.lua dans la chaîne (il doit
-- laisser une image nue à szh-numerotation.lua, qui suit) — un <h2> posé là serait donc
-- vu et numéroté par szh-sections.lua, comme « 1 Rundschau ». Constaté le 23.09.2026 :
-- les sections de fiches restaient sans titre imprimé, seules les rubriques en avaient un
-- — les fiches horizon/recherche se rangeaient visuellement sous la dernière rubrique.

local utils = pandoc.utils

local CLASSE = 'szh-rubrique'
local CLASSE_SECTION = 'szh-ressources-section'

-- Chargement du contrat JSON, chemin résolu depuis le dossier de CE fichier (même
-- mécanisme que szh-ressource.lua, largement commenté là-bas). Un chargement raté arrête
-- la compilation : ce filtre ne peut pas composer un titre de rubrique sans lui.
local TITRES
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
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
  -- Titres des sections de fiches (types[].libelle) : même table TITRES, même clé — les
  -- deux espaces de noms (rubriques[].cle et types[].cle) ne se recouvrent jamais dans le
  -- contrat (dossier_references/dossier_liens/ressources/podcasts d'un côté, horizon/
  -- recherche/intervention/livre/film/reprise/agenda de l'autre), donc les fusionner ici
  -- ne peut pas faire gagner un type sur l'autre.
  for cle, t in pairs(data.types or {}) do
    TITRES[cle] = t.libelle
  end
end

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
-- même contrôle que type_sain() de szh-ressource.lua. Les clés du JSON portent un
-- soulignement (dossier_references) : admis ici, comme dans une classe CSS.
local function type_sain(t) return t ~= nil and t:match('^%a[%w_%-]*$') ~= nil end

-- Secours pour titre_id() ci-dessous : un bloc sans identifiant ne devrait jamais
-- apparaître (le formulaire en pose toujours un, voir l'en-tête), mais si un .md écrit à
-- la main en manque un, ce compteur garantit quand même des identifiants distincts d'une
-- rubrique à l'autre du même document plutôt que la même chaîne vide partout.
local secours = 0

-- Identifiant du <h2> de titre : toujours non vide (voir le ⚠ de l'en-tête sur le writer
-- html5). Dérivé de celui du bloc — posé par le formulaire, stable — pour rester lisible
-- et prévisible plutôt qu'arbitraire.
local function titre_id(div)
  if div.identifier and div.identifier ~= '' then return div.identifier .. '-titre' end
  secours = secours + 1
  return CLASSE .. '-titre-secours-' .. secours
end

-- Identifiant du <div> de contenu : même règle et même raison que titre_id() — voir le ⚠
-- posé à l'endroit où il sert, plus bas. Compteur de secours partagé : deux rubriques sans
-- identifiant n'ont ainsi jamais le même, ni pour leur titre ni pour leur corps.
local function corps_id(div)
  if div.identifier and div.identifier ~= '' then return div.identifier .. '-corps' end
  secours = secours + 1
  return CLASSE .. '-corps-secours-' .. secours
end

-- Les titres écrits dans le bloc, rabattus sous le <h2> que ce filtre pose juste au-dessus.
-- Le rang le plus haut présent devient h3 ; les autres suivent du même décalage, si bien
-- que l'écart entre deux rangs est conservé et qu'aucun trou n'apparaît. Le rédacteur peut
-- donc écrire « ## International » comme « ### International » : les deux donnent un h3,
-- et le plan reste « h2 Rundschau > h3 International > h4 la brève ».
--
-- Pourquoi ici et pas dans szh-niveaux.lua, qui fait le compactage du corps : ce filtre est
-- le seul à savoir à quel rang sort le titre de la rubrique, et il est le dernier à passer.
-- szh-niveaux.lua, lui, laisse désormais les rubriques tranquilles — sans quoi il les aurait
-- remontées au rang du titre avant qu'on arrive ici.
--
-- Le reste du contenu ne bouge pas : ni l'italique, ni le gras, ni les liens, ni les listes
-- (voir l'en-tête du fichier). Seul le RANG d'un titre change, jamais son texte, et jamais
-- le .md sur le disque.
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

-- Compose la <section> titrée : commun aux rubriques et aux sections de fiches, seuls
-- diffèrent la classe de base (`classe`), le rabattement des rangs (rubrique seulement —
-- une fiche n'a pas de titres internes à rebattre) et la table d'où sort le libellé
-- (TITRES sert aux deux, voir son chargement plus haut).
local function section_titree(div, classe, lang, rabattre)
  local type_ = div.attributes['type']
  local classes = { classe, 'section' }
  if type_sain(type_) then classes[#classes + 1] = classe .. '-' .. type_ end

  -- Un type absent ou inconnu : pas de titre (on ne fabrique rien depuis le jeton), mais
  -- le bloc sort quand même, avec son contenu intact — dégradation propre.
  local titres_type = type_ and TITRES[type_]
  local titre = titres_type and titres_type[lang]

  local blocs = pandoc.Blocks({})
  if titre then
    blocs:insert(pandoc.Header(2, pandoc.Inlines({ pandoc.Str(titre) }),
      pandoc.Attr(titre_id(div), { classe .. '-titre' }, {})))
  end
  local contenu = rabattre and abaisser_titres(div.content) or div.content
  -- ⚠ L'identifiant de ce Div n'est pas décoratif : c'est le même piège du writer html5
  --   que celui décrit dans l'en-tête pour le titre de la rubrique. Un Div d'identifiant
  --   VIDE dont le premier enfant est un Header sort en <section>, et pandoc lui déplace
  --   l'identifiant de ce Header — une rubrique qui commence par « ## International »
  --   donnait <section id="international" class="szh-rubrique-corps"> et un <h3> nu,
  --   privé de son ancre. Un identifiant non vide suffit à l'empêcher : le bloc reste un
  --   <div> et chaque titre garde le sien. Constaté après le rabattement des rangs
  --   ci-dessus, qui a rendu ce cas courant (avant, une rubrique commençait par du texte).
  blocs:insert(pandoc.Div(contenu, pandoc.Attr(corps_id(div), { classe .. '-corps' }, {})))

  return pandoc.Div(blocs, pandoc.Attr(div.identifier or '', classes, {}))
end

function Pandoc(doc)
  local lang = langue_de(doc.meta)

  doc.blocks = doc.blocks:walk({
    Div = function(div)
      -- Le contenu du bloc, enveloppé — seuls les rangs de ses titres sont rabattus sous
      -- le <h2> ci-dessus (abaisser_titres, et rien d'autre) : une rubrique est du texte
      -- riche qui peut porter ses propres intertitres, une fiche ne le peut pas — son
      -- « titre » est un Para (szh-ressource-titre), jamais un Header, rien à rebattre.
      if a_classe(div, CLASSE) then return section_titree(div, CLASSE, lang, true) end
      if a_classe(div, CLASSE_SECTION) then return section_titree(div, CLASSE_SECTION, lang, false) end
      return nil
    end,
  })

  return doc
end
