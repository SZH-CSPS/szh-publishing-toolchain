-- Compose les fiches de ressources de la Documentation d'un numéro (« Actualité et
-- ressources » / « News & Ressourcen ») : livre, film, intervention parlementaire,
-- recherche en cours, tour d'horizon, reprise d'un article de la revue sœur, agenda.
-- Le .md est écrit par documentation-kirby.py depuis l'arborescence Kirby
-- (docs/FORMAT-DOCUMENTATION-KIRBY.md). Types, libellés, listes et gabarits se lisent dans
-- pipeline/kirby/champs-documentation.json, que lisent aussi le formulaire du cockpit et le
-- convertisseur.
--
--   ::: {#r1a2b3c4 .szh-ressource type="livre" title="Le silence des bêtes"
--        auteurs="Jean Dupont, Marie Martin" annee="2019" editeur="Éditions XYZ"
--        lien="https://exemple.org/livre" categorie="manuel"}
--   Descriptif en prose libre, sur une ou plusieurs lignes.
--
--   ![](media/couverture-x.jpg){alt=""}
--   :::
--
-- donne (livre) :
--   <div class="szh-ressource szh-ressource-livre">
--     <div class="szh-ressource-titre"><p>Le silence des bêtes</p></div>
--     <div class="szh-ressource-corps">
--       <div class="szh-ressource-image">…</div>
--       <div class="szh-ressource-texte">
--         <div class="szh-ressource-biblio"><p>Jean Dupont, Marie Martin · 2019 · Éditions XYZ</p></div>
--         <div class="szh-ressource-pastille"><p>Manuel</p></div>
--         <p>Descriptif…</p>
--         <div class="szh-ressource-lien"><p><a href="…">En savoir plus sur le livre …</a></p></div>
--       </div>
--     </div>
--   </div>
--
-- print.css place le titre en haut, puis le texte à gauche et l'image à droite, au quart
-- de la largeur.
--
-- L'image est décorative : le convertisseur l'écrit avec alt="" et sans légende, et ce
-- filtre la laisse telle quelle. szh-numerotation.lua, plus loin dans la chaîne, la
-- transforme en fond CSS (en_decor) : un <img alt=""> sortirait en /Figure sans /Alt,
-- refusé par PDF/UA-1. print.css ajuste sa largeur (« .szh-ressource-image .szh-decor »).
--
-- Le texte du lien ne s'écrit pas dans le .md : c'est `lien_libelle` s'il est saisi,
-- sinon le gabarit `libelleLien` du type dans la langue de l'article (« En savoir plus sur
-- le livre {titre} »). Il reste ainsi explicite hors contexte pour un lecteur d'écran, et
-- suit un titre corrigé.
--
-- Place dans la chaîne : après szh-typographie.lua (le descriptif reçoit la même
-- typographie que l'article) et avant szh-numerotation.lua (qui doit trouver l'image nue).
--
-- `curia` et `source` (intervention) sont des données de travail : le convertisseur les
-- pose en attribut, mais elles ne s'impriment pas (absentes de BIBLIO_CHAMPS).

local utils = pandoc.utils

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
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
    io.stderr:write('[ressource] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arret.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local CLASSE = 'szh-ressource'

-- Contrat JSON, lu depuis le dossier de ce fichier. Sans lui, la compilation s'arrête.
--   TYPES          libellés, libellé de lien, pastille et champs de chaque type ;
--   LISTES         jeton -> libellé fr/de, par liste ;
--   SUIVI_IMPRIME  gabarit de la ligne de suivi, par langue ;
--   CHAMPS_PAR_CLE définition d'un champ, par type puis par clé.
local TYPES, LISTES, SUIVI_IMPRIME, CHAMPS_PAR_CLE
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local chemin = dossier_ce_fichier() .. '../kirby/champs-documentation.json'
  local fh = io.open(chemin, 'r')
  if not fh then
    io.stderr:write('[ressource] ' .. chemin .. ' introuvable : ce filtre ne peut pas composer sans lui, arret.\n')
    os.exit(1, true)
  end
  local contenu = fh:read('a')
  fh:close()
  local ok, data = pcall(pandoc.json.decode, contenu)
  if not ok or type(data) ~= 'table' then
    io.stderr:write('[ressource] ' .. chemin .. ' illisible (' .. tostring(data) .. ') : arret.\n')
    os.exit(1, true)
  end
  TYPES = data.types
  SUIVI_IMPRIME = data.suiviImprime or {}
  LISTES = {}
  for nom, arr in pairs(data.listes or {}) do
    LISTES[nom] = {}
    for _, item in ipairs(arr) do
      LISTES[nom][item.jeton] = { fr = item.fr, de = item.de }
    end
  end
  CHAMPS_PAR_CLE = {}
  for type_, def in pairs(TYPES) do
    CHAMPS_PAR_CLE[type_] = {}
    for _, c in ipairs(def.champs or {}) do
      CHAMPS_PAR_CLE[type_][c.cle] = c
    end
  end
end

-- Champs de la ligne bibliographique sous le titre, par type et dans l'ordre d'affichage.
-- Le JSON liste tous les champs d'une fiche ; cette table dit lesquels vont sur cette
-- ligne. horizon n'y a rien : sa seule mention est le canton, si la portée est régionale
-- (voir ligne_biblio).
local BIBLIO_CHAMPS = {
  horizon      = {},
  recherche    = { 'institutions', 'debut', 'fin' },
  intervention = { 'canton', 'categorie', 'numero', 'date' },
  livre        = { 'auteurs', 'annee', 'editeur' },
  -- Genre et pays avant le distributeur, champ le moins identifiant et souvent absent.
  film         = { 'realisateur', 'annee', 'genre', 'pays', 'distributeur' },
  reprise      = { 'auteurs', 'revue', 'reference', 'doi' },
  agenda       = { 'evenement', 'debut', 'fin', 'lieu', 'organisateur' },
}

-- Paire de dates imprimée en une seule plage, par type. Seul l'agenda en a une : les dates
-- partielles de la recherche restent deux mentions.
local PLAGE = { agenda = { debut = 'debut', fin = 'fin' } }

local LIBELLE_LIEN_DEFAUT = { fr = 'En savoir plus : %s', de = 'Mehr erfahren: %s' }

local function champ_def(type_, cle)
  return CHAMPS_PAR_CLE[type_] and CHAMPS_PAR_CLE[type_][cle]
end

-- Double les % d'une valeur passée comme remplacement à gsub, qui interprète %n.
-- Les parenthèses extérieures gardent la seule chaîne : gsub rend aussi le nombre de
-- remplacements, qui, passé en dernier argument d'un autre gsub, en deviendrait le
-- maximum (0 annulerait tout remplacement).
local function echapper_pourcent(s) return ((s or ''):gsub('%%', '%%%%')) end

-- Les dates (ISO stockée, forme suisse imprimée) passent par commun.date_suisse,
-- commun.date_partielle_suisse et commun.plage_date, partagées avec l'aperçu du cockpit.

-- Champ `liste_multiple` (« jeton1, jeton2 », tel que l'écrit documentation-kirby.py) :
-- chaque jeton traduit, joints par « , ». Un jeton inconnu du contrat sort tel quel.
local function formater_liste_multiple(def, v, lang)
  local morceaux = {}
  for jeton in (v or ''):gmatch('[^,]+') do
    jeton = jeton:match('^%s*(.-)%s*$')
    if jeton ~= '' then
      local item = LISTES[def.liste] and LISTES[def.liste][jeton]
      morceaux[#morceaux + 1] = (item and item[lang]) or jeton
    end
  end
  return table.concat(morceaux, ', ')
end

-- Met en forme la valeur d'un champ selon sa saisie (JSON) : un jeton de liste devient son
-- libellé traduit (sauf `canton`, affiché en code), une date ou une date partielle passe en
-- forme suisse, le reste sort tel quel.
local function formater_champ(type_, cle, v, lang)
  local def = champ_def(type_, cle)
  local saisie = def and def.saisie
  if saisie == 'liste' then
    if def.liste == 'canton' then return v end
    local item = LISTES[def.liste] and LISTES[def.liste][v]
    return (item and item[lang]) or v
  elseif saisie == 'liste_multiple' then
    return formater_liste_multiple(def, v, lang)
  elseif saisie == 'date' then
    return commun.date_suisse(v)
  elseif saisie == 'date_partielle' then
    return commun.date_partielle_suisse(v)
  end
  return v
end

local a_classe = commun.a_classe

-- Rend l'image d'un Para/Plain qui ne contient qu'elle et des espaces, sinon nil. Même
-- lecture qu'image_hors_figure() de szh-numerotation.lua.
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

-- Ligne bibliographique sous le titre : les champs non vides de BIBLIO_CHAMPS[type_], mis
-- en forme et séparés par « · ».
local function ligne_biblio(attrs, type_, lang)
  local champs = BIBLIO_CHAMPS[type_] or {}
  local plage = PLAGE[type_]
  local morceaux = {}
  for _, cle in ipairs(champs) do
    if plage and cle == plage.fin then
      -- déjà imprimée avec la date de début, dans la même mention
    elseif plage and cle == plage.debut then
      local p = commun.plage_date(attrs[plage.debut], attrs[plage.fin])
      if p and p:match('%S') then morceaux[#morceaux + 1] = p end
    else
      local v = attrs[cle]
      if v and v:match('%S') then
        morceaux[#morceaux + 1] = formater_champ(type_, cle, v, lang)
      end
    end
  end
  -- Tour d'horizon : le canton seul, en code, si la portée est régionale.
  if type_ == 'horizon' and attrs['portee'] == 'regional' then
    local canton = attrs['canton']
    if canton and canton:match('%S') then morceaux[#morceaux + 1] = canton end
  end
  if #morceaux == 0 then return nil end
  return table.concat(morceaux, ' · ')
end

-- État + date d'état d'une intervention (seul type qui porte ces deux champs).
local function ligne_etat(attrs, type_, lang)
  local etat = attrs['etat']
  if not (etat and etat:match('%S')) then return nil end
  local libelle = formater_champ(type_, 'etat', etat, lang)
  local date = attrs['etat_date']
  if date and date:match('%S') then
    return libelle .. ' (' .. commun.date_suisse(date) .. ')'
  end
  return libelle
end

-- Pastille de catégorie (livre, film) : le champ nommé par TYPES[type_].pastille, traduit.
local function texte_pastille(attrs, type_, lang)
  local champ = TYPES[type_] and TYPES[type_].pastille
  if not champ then return nil end
  local v = attrs[champ]
  if not (v and v:match('%S')) then return nil end
  return formater_champ(type_, champ, v, lang)
end

-- Met en forme une entrée de suivi (date, genre, libelle, lien) selon suiviImprime[lang] :
-- « {genre} du {date} : {libelle} » (fr), « {genre} vom {date}: {libelle} » (de). Sans
-- libellé, le segment « : {libelle} » disparaît, espaces comprises.
local function ligne_suivi(entree, lang)
  local gabarit = SUIVI_IMPRIME[lang] or SUIVI_IMPRIME.fr or '{genre} — {date}{libelle}'
  local genre_lbl = (LISTES['genre_suivi'] and LISTES['genre_suivi'][entree.genre]
    and LISTES['genre_suivi'][entree.genre][lang]) or entree.genre or ''
  local date_lbl = commun.date_suisse(entree.date)
  local vide = not (entree.libelle and entree.libelle:match('%S'))
  local texte = gabarit
  if vide then
    texte = texte:gsub('%s*:%s*{libelle}', '')
  end
  texte = texte:gsub('{genre}', echapper_pourcent(genre_lbl))
  texte = texte:gsub('{date}', echapper_pourcent(date_lbl))
  if not vide then
    texte = texte:gsub('{libelle}', echapper_pourcent(entree.libelle))
  end
  return texte
end

-- Enveloppe des blocs dans un Div de classe : Para et Plain n'ont pas d'attributs dans
-- pandoc.
local function bloc_classe(classe, contenu)
  return pandoc.Div(contenu, pandoc.Attr('', { classe }, {}))
end

-- Vrai si le type peut entrer dans une classe HTML (pas d'espace ni d'accolade, par
-- exemple dans un .md écrit à la main).
local function type_sain(t) return t ~= nil and t:match('^%a[%w_%-]*$') ~= nil end

local CLASSE_SUIVI_ENTREE = 'szh-suivi-entree'

function Pandoc(doc)
  -- Le contrat de la Documentation n'existe qu'en français et en allemand.
  local lang = commun.contexte(doc.meta).lang
  if lang ~= 'de' then lang = 'fr' end

  doc.blocks = doc.blocks:walk({
    Div = function(div)
      if not a_classe(div, CLASSE) then return nil end
      local type_ = div.attributes['type'] or ''
      local titre = div.attributes['title'] or ''

      -- Contenu du bloc : des Div .szh-suivi-entree (une par entrée de suivi, posées par
      -- documentation-kirby.py), une image au plus (la première), et le descriptif.
      local image, descriptif, suivi = nil, pandoc.Blocks({}), {}
      for _, b in ipairs(div.content) do
        local traite = false
        if b.t == 'Div' and a_classe(b, CLASSE_SUIVI_ENTREE) then
          suivi[#suivi + 1] = {
            date = b.attributes['date'], genre = b.attributes['genre'],
            libelle = b.attributes['libelle'], lien = b.attributes['lien'],
          }
          traite = true
        end
        if not traite and not image then
          local img = image_seule_de(b)
          if img then image = img; traite = true end
        end
        if not traite then descriptif:insert(b) end
      end

      -- Colonne de texte, dans l'ordre : ligne bibliographique, pastille, état, suivi,
      -- descriptif, lien.
      local texte = pandoc.Blocks({})
      local biblio = ligne_biblio(div.attributes, type_, lang)
      if biblio then texte:insert(bloc_classe('szh-ressource-biblio', { pandoc.Para({ pandoc.Str(biblio) }) })) end

      local pastille = texte_pastille(div.attributes, type_, lang)
      if pastille then texte:insert(bloc_classe('szh-ressource-pastille', { pandoc.Para({ pandoc.Str(pastille) }) })) end

      local etat = ligne_etat(div.attributes, type_, lang)
      if etat then texte:insert(bloc_classe('szh-ressource-etat', { pandoc.Para({ pandoc.Str(etat) }) })) end

      if #suivi > 0 then
        local paras = {}
        for _, entree in ipairs(suivi) do
          local phrase = ligne_suivi(entree, lang)
          local inline
          if entree.lien and entree.lien:match('%S') then
            inline = pandoc.Link({ pandoc.Str(phrase) }, entree.lien, '', pandoc.Attr('', {}, {}))
          else
            inline = pandoc.Str(phrase)
          end
          paras[#paras + 1] = pandoc.Para({ inline })
        end
        texte:insert(bloc_classe('szh-ressource-suivi', paras))
      end

      texte:extend(descriptif)

      local lien = div.attributes['lien']
      if lien and lien:match('%S') then
        local lien_libelle = div.attributes['lien_libelle']
        local intitule
        if lien_libelle and lien_libelle:match('%S') then
          intitule = lien_libelle
        else
          local gabarit = (TYPES[type_] and TYPES[type_].libelleLien and TYPES[type_].libelleLien[lang])
            or LIBELLE_LIEN_DEFAUT[lang] or LIBELLE_LIEN_DEFAUT.fr
          intitule = gabarit:gsub('{titre}', echapper_pourcent(titre))
        end
        texte:insert(bloc_classe('szh-ressource-lien', {
          pandoc.Para({ pandoc.Link({ pandoc.Str(intitule) }, lien, '', pandoc.Attr('', {}, {})) })
        }))
      end

      -- Colonne d'image, laissée nue pour szh-numerotation.lua. Sans image, pas de colonne :
      -- le texte prend toute la largeur.
      --
      -- L'image vient avant le texte : print.css la met en `float: right`, et un flottant
      -- s'ancre à sa place dans le flux. Après le texte, elle tomberait sous lui, voire à
      -- la page suivante. Un conteneur flex ne convient pas : WeasyPrint ne le coupe pas
      -- entre deux pages, et une fiche plus haute qu'une page laisse une page vide.
      -- L'image étant décorative, sa place ne change rien pour un lecteur d'écran.
      local corps_enfants = {}
      if image then
        corps_enfants[#corps_enfants + 1] =
          bloc_classe('szh-ressource-image', { pandoc.Plain({ image }) })
      end
      corps_enfants[#corps_enfants + 1] = bloc_classe('szh-ressource-texte', texte)
      local corps = bloc_classe('szh-ressource-corps', corps_enfants)

      local blocs = pandoc.Blocks({})
      if titre:match('%S') then blocs:insert(bloc_classe('szh-ressource-titre', { pandoc.Para({ pandoc.Str(titre) }) })) end
      blocs:insert(corps)

      local classes = { CLASSE }
      if type_sain(type_) then classes[#classes + 1] = CLASSE .. '-' .. type_ end
      -- Classe pour print.css quand la fiche n'a pas d'image, quel que soit son type.
      if not image then classes[#classes + 1] = CLASSE .. '-sans-image' end
      return pandoc.Div(blocs, pandoc.Attr(div.identifier or '', classes, {}))
    end,
  })

  return doc
end
