-- Fiches de « ressources » d'un article : un livre, un film, une intervention parlementaire,
-- une recherche en cours, la reprise d'un article de la revue sœur, une manifestation de
-- l'agenda — ce qui remplit la
-- Documentation d'un numéro (« Actualité et ressources » / « News & Ressourcen »). Le
-- pendant, côté rendu, de lib/ressources.js côté cockpit : même moteur générique, décliné
-- par une table de champs par type, pas un filtre
-- par type. Intervention, recherche et reprise n'ont pas d'image (voir lib/ressources.js,
-- SANS_IMAGE) : ce filtre n'a besoin de rien savoir de plus pour s'en accommoder, puisqu'il
-- ne fait déjà que chercher une image dans le contenu du bloc plutôt que la présumer selon
-- le type — voir plus bas « Absente du tout si la fiche n'a pas d'image ».
--
--   ::: {#r1a2b3c4 .szh-ressource type="livre" titre="Le silence des bêtes"
--        auteurs="Jean Dupont, Marie Martin" annee="2019" editeur="Éditions XYZ"
--        lien="https://exemple.org/livre"}
--   Descriptif en prose libre, sur une ou plusieurs lignes.
--
--   ![](media/couverture-x.jpg){alt=""}
--   :::
--
-- Ce qui sort :
--   <div class="szh-ressource szh-ressource-livre">
--     <div class="szh-ressource-titre"><p>Le silence des bêtes</p></div>
--     <div class="szh-ressource-corps">
--       <div class="szh-ressource-texte">
--         <div class="szh-ressource-biblio"><p>Jean Dupont, Marie Martin · 2019 · Éditions XYZ</p></div>
--         <p>Descriptif…</p>
--         <div class="szh-ressource-lien"><p><a href="…">En savoir plus sur le livre …</a></p></div>
--       </div>
--       <div class="szh-ressource-image">…</div>
--     </div>
--   </div>
--
-- print.css met le titre au-dessus de tout, et dans .szh-ressource-corps le texte à gauche,
-- l'image au quart de la largeur alignée à droite (cahier des charges).
--
-- L'image est TOUJOURS décorative (cahier des charges) : le formulaire l'écrit avec un
-- alt="" et sans légende, et ce filtre la laisse EXACTEMENT ainsi — un pandoc.Image nu, sans
-- description — à szh-numerotation.lua, branché juste après dans le Makefile. C'est lui qui,
-- pour toute image sans texte ni description, pose déjà role="presentation" et la bascule en
-- fond CSS (fonction en_decor de ce filtre) : le seul moyen d'obtenir un PDF/UA-1 conforme,
-- un <img alt=""> sortant en /Figure sans /Alt, ce que la règle 7.3 interdit — voir son
-- commentaire de tête. Dupliquer ce mécanisme ici l'aurait fait diverger tôt ou tard.
-- print.css n'a donc qu'à ANNULER la largeur que ce mécanisme calcule pour une figure pleine
-- colonne — la nôtre visant le quart de la largeur — voir la règle
-- « .szh-ressource-image .szh-decor ».
--
-- Le texte du lien — « En savoir plus sur le livre {titre} » — n'est JAMAIS écrit dans le
-- .md (voir lib/ressources.js) : il se déduit ici du titre, du type et de la langue de
-- l'ARTICLE. C'est ce qui le rend explicite et non modifiable par mégarde — donc utilisable
-- hors contexte par un lecteur d'écran — et ce qui lui permet de suivre un titre corrigé
-- après coup sans qu'on doive retaper le lien.
--
-- Place dans la chaîne : après szh-typographie.lua (le descriptif profite des mêmes
-- guillemets et espaces insécables que le reste de l'article) et avant szh-numerotation.lua,
-- qui doit encore trouver un pandoc.Image nu pour le rendre décoratif.
--
-- ⚠ Table TYPES et table LIBELLE_LIEN recopiées depuis lib/ressources.js (côté cockpit).
--   La première doit rester identique aux deux tables JS (TYPES, et son usage dans le
--   formulaire) — test/js/ressources.test.js le contrôle, comme szh-grille.lua pour les
--   grilles (lib/references.js).

local utils = pandoc.utils

local CLASSE = 'szh-ressource'

-- Les champs bibliographiques propres à chaque type, dans l'ordre où la ligne sous le titre
-- les affiche.
-- ⚠ Recopiée depuis lib/ressources.js (table TYPES).
local TYPES = {
  livre = { 'auteurs', 'annee', 'editeur' },
  film = { 'realisateur', 'annee', 'genre', 'pays' },
  intervention = { 'canton', 'categorie', 'numero', 'date' },
  recherche = { 'institutions', 'debut', 'fin' },
  reprise = { 'auteurs', 'revue', 'reference', 'doi' },
  agenda = { 'evenement', 'debut', 'fin', 'lieu', 'organisateur' },
}

-- Le texte du lien, par type et par langue ; %s reçoit le titre. Un type absent de la table
-- retombe sur un texte neutre plutôt que sur un lien sans intitulé.
local LIBELLE_LIEN = {
  livre = { fr = 'En savoir plus sur le livre %s', de = 'Mehr zum Buch %s' },
  film = { fr = 'En savoir plus sur le film %s', de = 'Mehr zum Film %s' },
  intervention = { fr = 'En savoir plus sur l’intervention %s', de = 'Mehr zum Vorstoss %s' },
  recherche = { fr = 'En savoir plus sur la recherche %s', de = 'Mehr zum Forschungsprojekt %s' },
  reprise = { fr = 'Lire l’article %s', de = 'Zum Artikel %s' },
  agenda = { fr = 'En savoir plus sur la manifestation %s', de = 'Mehr zur Veranstaltung %s' },
}
local LIBELLE_LIEN_DEFAUT = { fr = 'En savoir plus : %s', de = 'Mehr erfahren: %s' }

-- Les libellés IMPRIMÉS de la liste fermée `evenement` d'une fiche d'agenda, par jeton et
-- par langue. Le .md ne porte que le jeton (agenda type d'événement) : c'est ce qui permet
-- à un « Colloque » français de sortir « Tagung » côté allemand sans qu'on ait rien à
-- ressaisir, exactement comme le libellé de lien de LIBELLE_LIEN.
-- ⚠ Recopiée depuis lib/ressources.js (table LISTES.evenement, qui n'en porte que les
--   jetons, les libellés de SAISIE vivant eux dans lib/i18n.js) : un test refuse que les
--   deux divergent. Un jeton absent d'ici s'imprime tel quel plutôt que de disparaître.
local EVENEMENTS = {
  colloque  = { fr = 'Colloque',           de = 'Tagung' },
  congres   = { fr = 'Congrès',            de = 'Kongress' },
  journee   = { fr = 'Journée d’étude',    de = 'Fachtagung' },
  cours     = { fr = 'Cours',              de = 'Kurs' },
  webinaire = { fr = 'Webinaire',          de = 'Webinar' },
  formation = { fr = 'Formation continue', de = 'Weiterbildung' },
}

-- Les champs dont la valeur est un jeton à traduire, par type puis par champ.
local JETONS = { agenda = { evenement = EVENEMENTS } }

-- La paire de dates qui se fond en UNE seule mention à l'impression, par type. « 2026-01-05
-- · 2026-01-06 » dans la ligne d'une fiche ne se lit pas ; le corpus, lui, écrit
-- « 05.–06.01.2026 » (relevé du 02.09.2026 sur les pages « Congrès, colloques » et « Kurse »
-- de szh.ch, celles-là mêmes que la rubrique du numéro donne en lien).
local PLAGE = { agenda = { debut = 'debut', fin = 'fin' } }

-- Une date ISO (2026-01-05) en date suisse (05.01.2026). L'ISO est la forme STOCKÉE, parce
-- que c'est la seule qui se trie (lib/ressources.js, SAISIE et CLE_TRI) ; elle ne sort
-- jamais telle quelle dans le PDF. Toute autre forme — un .md écrit à la main, une valeur
-- d'avant la saisie ISO — sort inchangée : mieux vaut une date au format d'origine qu'une
-- date perdue.
local function jour_mois_an(v)
  if not v then return nil end
  local a, m, j = v:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$')
  if not a then return nil end
  return { j = j, m = m, a = a }
end
local function date_suisse(v)
  local d = jour_mois_an(v)
  if not d then return v end
  return d.j .. '.' .. d.m .. '.' .. d.a
end

-- La plage de dates, aussi compacte que le corpus l'écrit :
--   un seul jour              05.01.2026
--   même mois                 05.–06.01.2026
--   même année, deux mois     29.06.–02.07.2026
--   deux années               10.09.2026–04.07.2028
-- Une date non ISO d'un côté ou de l'autre fait retomber sur la forme longue, jointe par le
-- tiret demi-cadratin : rien ne se perd, seule la compacité y passe.
local function plage_date(v1, v2)
  local vide1 = (v1 == nil or v1 == '')
  local vide2 = (v2 == nil or v2 == '')
  if vide1 then return (not vide2) and date_suisse(v2) or nil end
  if vide2 or v1 == v2 then return date_suisse(v1) end
  local d1, d2 = jour_mois_an(v1), jour_mois_an(v2)
  if not d1 or not d2 or d1.a ~= d2.a then return date_suisse(v1) .. '–' .. date_suisse(v2) end
  if d1.m ~= d2.m then return d1.j .. '.' .. d1.m .. '.–' .. d2.j .. '.' .. d2.m .. '.' .. d2.a end
  return d1.j .. '.–' .. d2.j .. '.' .. d2.m .. '.' .. d2.a
end

-- Langue de composition, simplifiée par rapport à langue_de() de szh-numerotation.lua (qui
-- lit en plus la fiche <slug>.meta.yaml pour départager, dans les métadonnées fusionnées,
-- un lang: d'article d'un lang: de numéro). Un lien mal traduit reste lisible ; une figure
-- mal numérotée ne l'est pas — la duplication complète n'apporterait rien ici.
-- meta.lang de l'article d'abord, puis le jeton de revue, puis le français.
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

-- L'image seule d'un Para/Plain, si elle n'est accompagnée que d'espaces — même lecture
-- qu'image_hors_figure() de szh-numerotation.lua, dont ce filtre ne peut pas dépendre (deux
-- chaînes indépendantes, aucune n'importe l'autre).
local function image_seule_de(b)
  if b.t ~= 'Para' and b.t ~= 'Plain' then return nil end
  local img = nil
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then
      if img then return nil end
      img = x
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then
      return nil
    end
  end
  return img
end

-- La bibliographie courte, sous le titre : les champs du type qui portent une valeur, dans
-- l'ordre de TYPES, séparés par un point médian — même séparateur que la légende d'une
-- grille de plusieurs membres (media/medias-article.js, grilleMembres).
local function ligne_biblio(div, champs, type_, lang)
  local morceaux = {}
  local plage = PLAGE[type_]
  local jetons = JETONS[type_] or {}
  for _, cle in ipairs(champs) do
    local v = div.attributes[cle]
    if plage and cle == plage.fin then
      -- déjà imprimée avec la date de début, dans la même mention
    elseif plage and cle == plage.debut then
      local p = plage_date(div.attributes[plage.debut], div.attributes[plage.fin])
      if p and p:match('%S') then morceaux[#morceaux + 1] = p end
    elseif v and v:match('%S') then
      local table_jeton = jetons[cle]
      local libelle = table_jeton and table_jeton[v] and table_jeton[v][lang]
      morceaux[#morceaux + 1] = libelle or v
    end
  end
  if #morceaux == 0 then return nil end
  return table.concat(morceaux, ' · ')
end

-- Un bloc porté par une classe, seul moyen de donner un style à un Para ou un Plain : ni
-- l'un ni l'autre n'a d'attributs dans l'API pandoc. Même idiome que le Span de
-- szh-numerotation.lua (prefixer/crediter), un niveau plus haut puisqu'il s'agit ici d'un
-- bloc entier et non d'une portion de texte.
local function bloc_classe(classe, contenu)
  return pandoc.Div(contenu, pandoc.Attr('', { classe }, {}))
end

-- Un type dont le nom ne peut pas casser la liste de classes HTML (espace, accolade…) —
-- un contrôle bon marché contre un .md écrit à la main avec type="deux mots".
local function type_sain(t) return t ~= nil and t:match('^%a[%w%-]*$') ~= nil end

function Pandoc(doc)
  local lang = langue_de(doc.meta)

  doc.blocks = doc.blocks:walk({
    Div = function(div)
      if not a_classe(div, CLASSE) then return nil end
      local type_ = div.attributes['type'] or ''
      local champs = TYPES[type_] or {}
      local titre = div.attributes['titre'] or ''

      -- Le contenu du bloc : une image au plus (la première rencontrée), le reste est le
      -- descriptif — même lecture que lireRessources() de lib/ressources.js.
      local image, descriptif = nil, pandoc.Blocks({})
      for _, b in ipairs(div.content) do
        local traite = false
        if not image then
          local img = image_seule_de(b)
          if img then image = img; traite = true end
        end
        if not traite then descriptif:insert(b) end
      end

      -- Colonne de texte : bibliographie courte, descriptif, lien — dans cet ordre, celui
      -- d'une notule de lecture.
      local texte = pandoc.Blocks({})
      local biblio = ligne_biblio(div, champs, type_, lang)
      if biblio then texte:insert(bloc_classe('szh-ressource-biblio', { pandoc.Para({ pandoc.Str(biblio) }) })) end
      texte:extend(descriptif)
      local lien = div.attributes['lien']
      if lien and lien:match('%S') then
        local gabarit = (LIBELLE_LIEN[type_] and LIBELLE_LIEN[type_][lang])
          or LIBELLE_LIEN_DEFAUT[lang] or LIBELLE_LIEN_DEFAUT.fr
        local intitule = gabarit:format(titre)
        texte:insert(bloc_classe('szh-ressource-lien', {
          pandoc.Para({ pandoc.Link({ pandoc.Str(intitule) }, lien, '', pandoc.Attr('', {}, {})) })
        }))
      end

      -- Colonne d'image : laissée nue (voir l'en-tête du fichier) — c'est
      -- szh-numerotation.lua qui la rendra décorative, juste après dans le Makefile.
      -- Absente du tout si la fiche n'a pas d'image : print.css n'a alors pas à deviner
      -- une case vide, et le texte reprend naturellement toute la largeur.
      local corps_enfants = { bloc_classe('szh-ressource-texte', texte) }
      if image then
        corps_enfants[#corps_enfants + 1] =
          bloc_classe('szh-ressource-image', { pandoc.Plain({ image }) })
      end
      local corps = bloc_classe('szh-ressource-corps', corps_enfants)

      local blocs = pandoc.Blocks({})
      if titre:match('%S') then blocs:insert(bloc_classe('szh-ressource-titre', { pandoc.Para({ pandoc.Str(titre) }) })) end
      blocs:insert(corps)

      local classes = { CLASSE }
      if type_sain(type_) then classes[#classes + 1] = CLASSE .. '-' .. type_ end
      -- Accroche générique pour print.css : pas de nom de type ici, seulement le fait
      -- constaté qu'il n'y a pas d'image dans CE bloc — ce qui couvre aussi bien
      -- intervention/recherche (qui n'en portent jamais) qu'un livre saisi à la main sans
      -- couverture. Une case vide au quart de la largeur serait pire qu'une entrée compacte.
      if not image then classes[#classes + 1] = CLASSE .. '-sans-image' end
      return pandoc.Div(blocs, pandoc.Attr(div.identifier or '', classes, {}))
    end,
  })

  return doc
end
