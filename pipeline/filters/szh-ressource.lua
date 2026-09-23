-- Fiches de « ressources » d'un article : un livre, un film, une intervention parlementaire,
-- une recherche en cours, un tour d'horizon, la reprise d'un article de la revue sœur, une
-- manifestation de l'agenda — ce qui remplit la Documentation d'un numéro (« Actualité et
-- ressources » / « News & Ressourcen »), écrite par documentation-kirby.py depuis
-- l'arborescence Kirby (docs/FORMAT-DOCUMENTATION-KIRBY.md). Un seul moteur générique, décliné
-- par le contrat pipeline/kirby/champs-documentation.json — jamais un filtre par type, jamais
-- une table recopiée ici : ce filtre LIT le JSON (types, listes, suiviImprime), il ne le
-- redit pas. Le même JSON alimente le formulaire du cockpit et le convertisseur : un seul
-- endroit où changer un libellé, une liste ou un gabarit de lien.
--
--   ::: {#r1a2b3c4 .szh-ressource type="livre" title="Le silence des bêtes"
--        auteurs="Jean Dupont, Marie Martin" annee="2019" editeur="Éditions XYZ"
--        lien="https://exemple.org/livre" categorie="manuel"}
--   Descriptif en prose libre, sur une ou plusieurs lignes.
--
--   ![](media/couverture-x.jpg){alt=""}
--   :::
--
-- Ce qui sort (livre) :
--   <div class="szh-ressource szh-ressource-livre">
--     <div class="szh-ressource-titre"><p>Le silence des bêtes</p></div>
--     <div class="szh-ressource-corps">
--       <div class="szh-ressource-texte">
--         <div class="szh-ressource-biblio"><p>Jean Dupont, Marie Martin · 2019 · Éditions XYZ</p></div>
--         <div class="szh-ressource-pastille"><p>Manuel</p></div>
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
-- L'image est toujours décorative (cahier des charges) : le convertisseur l'écrit avec un
-- alt="" et sans légende, et ce filtre la laisse exactement ainsi — un pandoc.Image nu, sans
-- description — à szh-numerotation.lua, branché plus loin dans le Makefile (après
-- szh-figure.lua). C'est lui qui,
-- pour toute image sans texte ni description, pose déjà role="presentation" et la bascule en
-- fond CSS (fonction en_decor de ce filtre) : le seul moyen d'obtenir un PDF/UA-1 conforme,
-- un <img alt=""> sortant en /Figure sans /Alt, ce que la règle 7.3 interdit — voir son
-- commentaire de tête. Dupliquer ce mécanisme ici l'aurait fait diverger tôt ou tard.
-- print.css n'a donc qu'à annuler la largeur que ce mécanisme calcule pour une figure pleine
-- colonne — la nôtre visant le quart de la largeur — voir la règle
-- « .szh-ressource-image .szh-decor ».
--
-- Le texte du lien — « En savoir plus sur le livre {titre} » — n'est jamais écrit dans le
-- .md : soit c'est `lien_libelle`, saisi tel quel par la fiche, soit il se déduit du gabarit
-- `libelleLien` du type et de la langue de l'article (JSON). C'est ce qui le rend explicite
-- et non modifiable par mégarde — donc utilisable hors contexte par un lecteur d'écran — et
-- ce qui lui permet de suivre un titre corrigé après coup sans qu'on doive retaper le lien.
--
-- Place dans la chaîne : après szh-typographie.lua (le descriptif profite des mêmes
-- guillemets et espaces insécables que le reste de l'article) et avant szh-numerotation.lua,
-- qui doit encore trouver un pandoc.Image nu pour le rendre décoratif.
--
-- `curia` et `source` (intervention) sont des données de travail : posées en attribut par le
-- convertisseur, elles ne sont JAMAIS imprimées par ce filtre — voir l'absence des deux dans
-- BIBLIO_CHAMPS plus bas, volontaire.

local utils = pandoc.utils

-- Module commun (a_classe, langue_de...) : un chargement raté arrête la compilation, ce
-- filtre ne pouvant plus dire de langue fiable sans lui.
local commun
do
  -- debug.getinfo, pas PANDOC_SCRIPT_FILE : voir szh-commun.lua (celui-ci nomme le script
  -- reçu par pandoc en ligne de commande, pas ce fichier quand un autre le charge par
  -- dofile).
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

-- Chargement du contrat JSON : TYPES (libellés, libellé de lien, pastille, champs — d'où
-- l'on tire, par fiche, la définition d'un champ donné), LISTES (jeton -> libellé fr/de) et
-- SUIVI_IMPRIME (gabarit de la ligne de suivi). Chemin résolu depuis le dossier de CE
-- fichier, comme szh-commun.lua ci-dessus. Un chargement raté arrête la compilation : sans
-- lui, ce filtre ne saurait plus nommer un seul libellé.
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

-- Les champs qui composent la ligne sous le titre, par type et dans l'ordre d'affichage —
-- seule table encore écrite à la main : le JSON liste tous les champs d'une fiche (y
-- compris title, descriptif, lien, lien_libelle, la pastille, l'état, le suivi, curia et
-- source), pas seulement ceux de cette ligne-là. horizon est vide à dessein : sa seule
-- mention est le canton, et seulement si régional (voir plus bas, hors de ce mécanisme).
local BIBLIO_CHAMPS = {
  horizon      = {},
  recherche    = { 'institutions', 'debut', 'fin' },
  intervention = { 'canton', 'categorie', 'numero', 'date' },
  livre        = { 'auteurs', 'annee', 'editeur' },
  -- réalisateur · année · genre · pays · distributeur : genre et pays (liste_multiple,
  -- decision de Robin du 23.09.2026) s'intercalent entre l'année et le distributeur —
  -- avant le distributeur, qui est le champ le moins identifiant du film (souvent absent),
  -- et après année, dans l'ordre où le formulaire du cockpit les présente déjà (JSON,
  -- type film : title, categorie, genre, pays, realisateur, annee, distributeur…).
  film         = { 'realisateur', 'annee', 'genre', 'pays', 'distributeur' },
  reprise      = { 'auteurs', 'revue', 'reference', 'doi' },
  agenda       = { 'evenement', 'debut', 'fin', 'lieu', 'organisateur' },
}

-- La paire de dates qui se fond en une seule mention à l'impression, par type — seulement
-- l'agenda (cahier des charges) : les dates de la recherche sont partielles et restent deux
-- mentions distinctes.
local PLAGE = { agenda = { debut = 'debut', fin = 'fin' } }

local LIBELLE_LIEN_DEFAUT = { fr = 'En savoir plus : %s', de = 'Mehr erfahren: %s' }

local function champ_def(type_, cle)
  return CHAMPS_PAR_CLE[type_] and CHAMPS_PAR_CLE[type_][cle]
end

-- Une valeur en chaîne pour affichage %n littéral (gsub interprète % dans le motif de
-- remplacement) : doubler les % de la valeur avant de la passer en second argument de gsub.
-- ⚠ Le double jeu de parenthèses n'est pas cosmétique : `s:gsub(...)` rend DEUX valeurs
--   (la chaîne, le nombre de remplacements), et un `return` nu les propagerait toutes les
--   deux. Un appelant qui glisse ensuite ce résultat en dernier argument d'un AUTRE gsub
--   (comme plus bas) verrait ce compte se glisser en troisième argument — le nombre MAXIMAL
--   de remplacements — et un compte de 0 (aucun « % » à doubler) annulerait alors tout
--   remplacement. Mesuré : {genre}/{date}/{titre} restaient littéraux dans la sortie.
local function echapper_pourcent(s) return ((s or ''):gsub('%%', '%%%%')) end

-- Une date ISO (2026-01-05) en date suisse (05.01.2026). L'ISO est la forme stockée, parce
-- que c'est la seule qui se trie ; elle ne sort jamais telle quelle dans le PDF. Toute autre
-- forme sort inchangée : mieux vaut une date au format d'origine qu'une date perdue.
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

-- Date partielle (saisie `date_partielle` : AAAA, AAAA-MM ou AAAA-MM-JJ), en forme suisse
-- compacte : « 2026 », « 03.2026 », « 05.03.2026 ».
local function date_partielle_suisse(v)
  if not v then return v end
  local a, m, j = v:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$')
  if a then return j .. '.' .. m .. '.' .. a end
  local a2, m2 = v:match('^(%d%d%d%d)%-(%d%d)$')
  if a2 then return m2 .. '.' .. a2 end
  if v:match('^%d%d%d%d$') then return v end
  return v
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

-- Plusieurs jetons de la même liste (saisie `liste_multiple`, valeur « jeton1, jeton2 » —
-- convention posée par documentation-kirby.py, qui transporte cette chaîne telle quelle en
-- attribut, jamais éclatée) : chaque jeton traduit dans la langue de l'article, joints par
-- « , ». Un jeton absent de la liste du contrat (saisie manuelle fautive, liste modifiée
-- depuis) sort tel quel plutôt que de disparaître ou de faire échouer la compilation — même
-- principe que le repli de `formater_champ` pour une liste simple.
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

-- La valeur d'un champ, mise en forme selon sa saisie (JSON) : un jeton de liste devient son
-- libellé traduit (sauf `canton`, toujours affiché en code — cahier des charges), plusieurs
-- jetons (liste_multiple) sont chacun traduits puis joints par « , », une date ou une date
-- partielle passe en forme suisse, tout le reste sort tel quel.
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
    return date_suisse(v)
  elseif saisie == 'date_partielle' then
    return date_partielle_suisse(v)
  end
  return v
end

-- Langue de composition, simplifiée par rapport à langue_de() de szh-numerotation.lua (qui
-- lit en plus la fiche <slug>.meta.yaml pour départager, dans les métadonnées fusionnées,
-- un lang: d'article d'un lang: de numéro). Un lien mal traduit reste lisible ; une figure
-- mal numérotée ne l'est pas — la duplication complète n'apporterait rien ici.
-- meta.lang de l'article d'abord, puis le jeton de revue, puis le français. lire_fiche
-- omis (faux) : ce filtre ne lit que les métadonnées déjà fusionnées par pandoc, jamais la
-- fiche sur le disque.
local function langue_de(meta)
  return commun.langue_de(meta, {
    repli = function(m)
      local l = utils.stringify(m and m.lang or ''):lower():match('^(%a%a)')
      if l == 'fr' or l == 'de' then return l end
      local revue = utils.stringify(m and m.revue or ''):lower()
      if revue:find('zeitschrift') then return 'de' end
      return nil
    end,
    defaut = 'fr',
  })
end

local a_classe = commun.a_classe

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

-- La bibliographie courte, sous le titre : les champs de BIBLIO_CHAMPS[type_] qui portent
-- une valeur, mis en forme (formater_champ) et séparés par un point médian — même séparateur
-- que la légende d'une grille de plusieurs membres (media/medias-article.js, grilleMembres).
local function ligne_biblio(attrs, type_, lang)
  local champs = BIBLIO_CHAMPS[type_] or {}
  local plage = PLAGE[type_]
  local morceaux = {}
  for _, cle in ipairs(champs) do
    if plage and cle == plage.fin then
      -- déjà imprimée avec la date de début, dans la même mention
    elseif plage and cle == plage.debut then
      local p = plage_date(attrs[plage.debut], attrs[plage.fin])
      if p and p:match('%S') then morceaux[#morceaux + 1] = p end
    else
      local v = attrs[cle]
      if v and v:match('%S') then
        morceaux[#morceaux + 1] = formater_champ(type_, cle, v, lang)
      end
    end
  end
  -- Le tour d'horizon n'a pas de BIBLIO_CHAMPS : sa seule mention est le canton, seulement
  -- si la portée est régionale (cahier des charges) — écrit en code, jamais traduit.
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
    return libelle .. ' (' .. date_suisse(date) .. ')'
  end
  return libelle
end

-- La pastille de catégorie (livre, film) : le champ nommé par TYPES[type_].pastille,
-- traduit comme un champ de liste ordinaire.
local function texte_pastille(attrs, type_, lang)
  local champ = TYPES[type_] and TYPES[type_].pastille
  if not champ then return nil end
  local v = attrs[champ]
  if not (v and v:match('%S')) then return nil end
  return formater_champ(type_, champ, v, lang)
end

-- Une entrée de suivi (date, genre, libelle, lien) mise en forme selon suiviImprime[lang] :
-- « {genre} du {date} : {libelle} » (fr) / « {genre} vom {date}: {libelle} » (de). Le
-- segment « : {libelle} » disparaît si le libellé est vide (motif générique : deux-points
-- entouré d'espaces optionnelles, valable des deux côtés de la langue).
local function ligne_suivi(entree, lang)
  local gabarit = SUIVI_IMPRIME[lang] or SUIVI_IMPRIME.fr or '{genre} — {date}{libelle}'
  local genre_lbl = (LISTES['genre_suivi'] and LISTES['genre_suivi'][entree.genre]
    and LISTES['genre_suivi'][entree.genre][lang]) or entree.genre or ''
  local date_lbl = date_suisse(entree.date)
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

-- Un bloc porté par une classe, seul moyen de donner un style à un Para ou un Plain : ni
-- l'un ni l'autre n'a d'attributs dans l'API pandoc. Même idiome que le Span de
-- szh-numerotation.lua (prefixer/crediter), un niveau plus haut puisqu'il s'agit ici d'un
-- bloc entier et non d'une portion de texte.
local function bloc_classe(classe, contenu)
  return pandoc.Div(contenu, pandoc.Attr('', { classe }, {}))
end

-- Un type dont le nom ne peut pas casser la liste de classes HTML (espace, accolade…) —
-- un contrôle bon marché contre un .md écrit à la main avec type="deux mots".
local function type_sain(t) return t ~= nil and t:match('^%a[%w_%-]*$') ~= nil end

local CLASSE_SUIVI_ENTREE = 'szh-suivi-entree'

function Pandoc(doc)
  local lang = langue_de(doc.meta)

  doc.blocks = doc.blocks:walk({
    Div = function(div)
      if not a_classe(div, CLASSE) then return nil end
      local type_ = div.attributes['type'] or ''
      local titre = div.attributes['title'] or ''

      -- Le contenu du bloc : les divs imbriquées .szh-suivi-entree (une par entrée de
      -- suivi, posées par documentation-kirby.py — voir sa tête), une image au plus (la
      -- première rencontrée), le reste est le descriptif.
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

      -- Colonne de texte : bibliographie courte, pastille, état, suivi, descriptif, lien —
      -- dans cet ordre, celui d'une notule de lecture augmentée des champs d'intervention.
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

      -- Colonne d'image : laissée nue (voir l'en-tête du fichier) — c'est
      -- szh-numerotation.lua qui la rendra décorative, plus loin dans le Makefile.
      -- Absente du tout si la fiche n'a pas d'image : print.css n'a alors pas à deviner
      -- une case vide, et le texte reprend naturellement toute la largeur.
      --
      -- ⚠ L'image passe AVANT la colonne de texte, et ce n'est pas cosmétique : print.css
      --   la met en `float: right`, et un flottant s'ancre là où il paraît dans le flux.
      --   Placé après le texte, il s'ancrait sous lui — donc à la page suivante pour une
      --   fiche un peu longue. Le rendu visuel, lui, est le même : image en haut à droite,
      --   texte à gauche.
      --   Le passage de `display: flex` à un flottant a été mesuré sur WeasyPrint 69 : un
      --   conteneur flex n'y est pas sécable, si bien qu'une fiche plus haute qu'une page
      --   laissait une page entière vide (fond de carte seul, titre en tête) avant de
      --   reprendre à la page suivante — malgré `break-inside: avoid`. Constaté sur la
      --   Documentation allemande du 2027-02, reproduit à l'isolé.
      --   L'image reste décorative (role="presentation", posé par szh-numerotation.lua) :
      --   sa place dans l'ordre de lecture PDF/UA ne change rien pour un lecteur d'écran.
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
      -- Accroche générique pour print.css : pas de nom de type ici, seulement le fait
      -- constaté qu'il n'y a pas d'image dans ce bloc — ce qui couvre aussi bien
      -- intervention/recherche (qui n'en portent jamais) qu'un livre saisi à la main sans
      -- couverture. Une case vide au quart de la largeur serait pire qu'une entrée compacte.
      if not image then classes[#classes + 1] = CLASSE .. '-sans-image' end
      return pandoc.Div(blocs, pandoc.Attr(div.identifier or '', classes, {}))
    end,
  })

  return doc
end
