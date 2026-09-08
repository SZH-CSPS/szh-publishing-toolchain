-- Compilation : coupe le titre de couverture en ESCALIER — la première ligne plus courte
-- que la deuxième. Règle L3 de docs/TYPOGRAPHIE.md, demandée le 08.09.2026.
--
-- Un titre replié par WeasyPrint remplit sa première ligne au maximum, et la deuxième
-- reçoit ce qui reste : « Les personnes en situation de handicap comme / partenaires » a
-- une première ligne pleine et une deuxième presque vide, ce qui déséquilibre la
-- couverture. La composition veut l'inverse — un escalier descendant, la ligne courte
-- au-dessus de la longue.
--
-- ── Pourquoi il faut mesurer, et pourquoi la mesure est ici ─────────────────────────────
-- Aucune propriété CSS ne dit « première ligne plus courte » : `text-wrap: balance`
-- égaliserait les lignes (et WeasyPrint 69 ne l'a pas), et un flottant posé en ::before
-- pour raccourcir la première ligne risquerait d'ajouter une ligne au titre — or la boîte
-- du hero est en `max-height: 164px; overflow: hidden` (print.css §5) et tronquerait le
-- débordement SANS BRUIT. Il faut donc savoir où le titre se replie, c'est-à-dire mesurer
-- du texte, ce qu'un filtre pandoc ne sait pas faire : les largeurs d'avance de la face
-- du titre sont donc extraites une fois pour toutes par test/metriques-titre.py, dans
-- szh-titre-metriques.lua, et lues ici.
--
-- ── La garantie que ce filtre se donne ─────────────────────────────────────────────────
-- Il n'insère une coupure que si les quatre conditions tiennent :
--   1. le titre se replie déjà sur deux lignes au moins (sinon il n'y a pas d'escalier) ;
--   2. la première ligne proposée est plus courte que la deuxième ;
--   3. le nombre total de lignes ne change PAS — c'est ce qui interdit le débordement et
--      donc la troncature silencieuse ;
--   4. chaque ligne reste sous 98 % de la colonne, marge qui absorbe ce que le modèle ne
--      calcule pas (le crénage, voir test/metriques-titre.py).
-- Faute de quoi il ne fait rien, et WeasyPrint replie comme avant. L'abstention est le
-- comportement de repli, jamais une coupure au hasard.
--
-- ── Place dans la chaîne ───────────────────────────────────────────────────────────────
-- Après szh-typographie.lua, et c'est impératif : celui-ci pose les insécables du titre
-- et soude les mots outils (règle L2). Mesurer avant lui reviendrait à mesurer un titre
-- qui n'est pas celui qu'on imprimera, et à proposer une coupure là où une insécable
-- l'interdit désormais.
--
-- Il n'écrit pas dans `titre-affiche` mais dans une clé neuve, `titre-lignes` : la
-- première part aussi dans le <title> de la page et dans le /Title du PDF (gabarit, ligne
-- 16), où une balise <br> n'aurait aucun sens. Le gabarit prend `titre-lignes` s'il
-- existe et retombe sur `titre-affiche` sinon.

local utils = pandoc.utils

-- Le dossier de CE fichier, pour charger la table de métriques qui l'accompagne. Même
-- mécanique que szh-citations.lua avec szh-commun.lua, et pour la même raison :
-- PANDOC_SCRIPT_FILE nomme le script passé en ligne de commande, pas celui-ci.
local function dossier_ce_fichier()
  local source = debug.getinfo(1, 'S').source or ''
  return (source:gsub('^@', ''):gsub('[^/\\]+$', ''))
end

local METRIQUES
do
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-titre-metriques.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[titre-lignes] szh-titre-metriques.lua introuvable ou fautif : ' ..
      'le titre sera replié par WeasyPrint, sans escalier. Relancer ' ..
      'python test/metriques-titre.py\n')
    METRIQUES = nil
  else
    METRIQUES = module
  end
end

-- ── La géométrie, recopiée de print.css ────────────────────────────────────────────────
--
-- ⚠ Ces quatre valeurs sont un MIROIR de print.css. Les changer là sans les changer ici
-- ferait mesurer une colonne qui n'existe pas, et l'escalier tomberait à côté. Le même
-- avertissement figure dans print.css §5, et test/apca-check.py tient déjà les tailles du
-- hero de la même façon.
--
--   page A4          210 mm = 793,70 px (96 ppp)
--   marges @page     72 px à gauche et à droite  -> justification 649,70 px
--   .szh-hero        déborde de 72 px de chaque côté puis reprend 72 px de padding : sa
--                    boîte de contenu vaut donc exactement la justification
--   .szh-hero-main   max-width: 67 %              -> 435,30 px
local LARGEUR_COLONNE = 435.3
local TAILLE = 25                       -- .szh-title, font-size
local INTERLETTRAGE = -0.005 * TAILLE   -- letter-spacing: -0.005em, par caractère
local MARGE = 0.98                      -- ce que le modèle ne calcule pas (crénage)

-- Au-delà de deux caractères inconnus de la table, le titre est déclaré non mesurable :
-- une seule largeur fausse peut déplacer la coupure d'un mot entier.
local INCONNUS_TOLERES = 2

local ESPACE = ' '

-- ── Mesure ─────────────────────────────────────────────────────────────────────────────
local inconnus = 0

local function largeur(texte)
  if METRIQUES == nil then return nil end
  local total = 0
  for _, cp in utf8.codes(texte) do
    local avance = METRIQUES.avance[cp]
    if avance == nil then
      avance = METRIQUES.defaut
      inconnus = inconnus + 1
    end
    total = total + avance / METRIQUES.upem * TAILLE + INTERLETTRAGE
  end
  return total
end

-- ── Découpe en groupes insécables ──────────────────────────────────────────────────────
--
-- Un « groupe » est ce qui ne peut pas se couper : un mot, ou plusieurs mots reliés par
-- une insécable — « comme partenaires de formation » n'en fait qu'un après L2. Seule
-- l'espace ordinaire ouvre une coupure ; c'est aussi la seule que ce filtre remplacera
-- par une fin de ligne.
local function groupes(titre)
  local sortie = {}
  for morceau in (titre .. ESPACE):gmatch('([^' .. ESPACE .. ']*)' .. ESPACE) do
    if morceau ~= '' then sortie[#sortie + 1] = morceau end
  end
  return sortie
end

-- ── Repli glouton, celui de WeasyPrint ─────────────────────────────────────────────────
--
-- Pango replie au premier point de coupure qui déborde (first fit), et non par
-- équilibrage global à la Knuth-Plass : le modèle fait donc la même chose, sans quoi il
-- prédirait des lignes que le PDF n'aurait pas.
local function replier(gr, depart, largeur_espace)
  local lignes = {}
  local i = depart
  while i <= #gr do
    local fin, cumul = i, largeur(gr[i])
    while fin + 1 <= #gr do
      local suivant = cumul + largeur_espace + largeur(gr[fin + 1])
      if suivant > LARGEUR_COLONNE then break end
      cumul, fin = suivant, fin + 1
    end
    lignes[#lignes + 1] = { dernier = fin, largeur = cumul }
    i = fin + 1
  end
  return lignes
end

-- Le rang du dernier groupe de la première ligne, ou nil s'il n'y a rien à faire.
local function rang_de_coupure(titre)
  if METRIQUES == nil then return nil end
  inconnus = 0
  local gr = groupes(titre)
  if #gr < 2 then return nil end

  local largeur_espace = largeur(ESPACE)
  for _, g in ipairs(gr) do
    -- Un groupe plus large que la colonne : WeasyPrint le laissera déborder ou le coupera
    -- à un trait d'union, deux choses que ce modèle ne prédit pas. On s'abstient.
    if largeur(g) > LARGEUR_COLONNE then return nil end
  end

  local naturel = replier(gr, 1, largeur_espace)
  if #naturel < 2 then return nil end

  local choisi, cumul = nil, 0
  for k = 1, #gr - 1 do
    cumul = (k == 1) and largeur(gr[1]) or (cumul + largeur_espace + largeur(gr[k]))
    if cumul <= LARGEUR_COLONNE * MARGE then
      local reste = replier(gr, k + 1, largeur_espace)
      -- Condition 3 (même nombre de lignes) et condition 2 (l'escalier).
      if #reste + 1 == #naturel and cumul < reste[1].largeur then
        choisi = k               -- le plus grand k qui tienne : la première ligne la plus
      end                        -- remplie qui reste plus courte que la deuxième
    end
  end

  if inconnus > INCONNUS_TOLERES then return nil end
  if choisi == nil then return nil end
  -- WeasyPrint coupe déjà là : la couverture est en escalier sans qu'on s'en mêle.
  if choisi == naturel[1].dernier then return nil end
  return choisi, gr
end

-- ── La clé que le gabarit imprime ──────────────────────────────────────────────────────
--
-- <br> et non deux <span> : c'est la seule fin de ligne qui ne crée aucun élément dans
-- l'arbre de structure du PDF, donc rien à baliser et aucun risque PDF/UA — la même
-- raison qui fait que szh-cesure.lua ne pose pas de <span> dans un lien.
--
-- La classe sert à l'écran : print.css la neutralise sous @media screen, que WeasyPrint
-- n'applique pas. La coupure est calculée pour une colonne de 435 px et n'a aucun sens à
-- une autre largeur ; le PDF la reçoit, le navigateur replie comme il veut.
local function poser(meta, rang, gr)
  local avant, apres = {}, {}
  for i = 1, rang do avant[#avant + 1] = gr[i] end
  for i = rang + 1, #gr do apres[#apres + 1] = gr[i] end
  meta['titre-lignes'] = pandoc.MetaInlines({
    pandoc.Str(table.concat(avant, ESPACE)),
    pandoc.RawInline('html', '<br class="szh-titre-ligne" />'),
    pandoc.Str(table.concat(apres, ESPACE)),
  })
  return meta
end

function Meta(meta)
  local brut = meta['titre-affiche']
  if brut == nil then return nil end
  local titre = utils.stringify(brut)
  if titre == '' then return nil end
  local rang, gr = rang_de_coupure(titre)
  if rang == nil then return nil end
  return poser(meta, rang, gr)
end
