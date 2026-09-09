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

-- ── Lecteur de jetons CSS (09.09.2026) ──────────────────────────────────────────────────
--
-- Avant ce jour, ce filtre recopiait à la main les quatre valeurs de géométrie ci-dessous ;
-- il les LIT désormais dans socle.css et print.css eux-mêmes, comme test/apca-check.py lit
-- les tailles du hero. Quatre unités seulement, celles que la maquette emploie réellement :
-- px se rend telle quelle, rem se convertit en px (`html { font-size: 100% }`, print.css
-- §4, donc 1 rem = 16 px), % se ramène à un facteur 0-1, et em se GARDE en facteur — un em
-- n'a de sens qu'une fois multiplié par la taille qui l'accompagne, et cette taille est
-- elle-même un jeton lu à côté : le convertir ici reviendrait à deviner laquelle.
local REM_EN_PX = 16

-- Lit `--jeton: valeur;` dans le fichier CSS `chemin` et rend le nombre converti. Ne
-- devine jamais : un nombre qui ne suit pas exactement ce schéma, ou une unité que la
-- maquette n'emploie pas, fait échouer la lecture au lieu d'inventer une valeur. Rend
-- (nombre, nil) si tout va bien, (nil, message) sinon — jamais d'erreur Lua levée, pour
-- que l'appelant décide lui-même de la conduite à tenir (voir plus bas).
local function lire_jeton_css(chemin, jeton)
  local f = io.open(chemin, 'r')
  if f == nil then return nil, chemin .. ' introuvable' end
  local css = f:read('a')
  f:close()

  local motif = jeton:gsub('%-', '%%-') .. '%s*:%s*([^;]+);'
  local brut = css:match(motif)
  if brut == nil then return nil, jeton .. ' absent de ' .. chemin end
  brut = brut:match('^%s*(.-)%s*$')

  local nombre, unite = brut:match('^(%-?%d+%.?%d*)([%%%a]*)$')
  if nombre == nil then
    return nil, jeton .. ' vaut « ' .. brut .. ' » dans ' .. chemin .. ', nombre non reconnu'
  end
  nombre = tonumber(nombre)

  if unite == 'px' then return nombre end
  if unite == 'rem' then return nombre * REM_EN_PX end
  if unite == '%' then return nombre / 100 end
  if unite == 'em' then return nombre end   -- facteur ; l'appelant multiplie par la taille
  return nil, jeton .. ' porte une unité non reconnue (« ' .. unite .. ' ») dans ' .. chemin
end

-- ── La géométrie, LUE dans socle.css et print.css ───────────────────────────────────────
--
-- Jusqu'au 09.09.2026, les quatre valeurs ci-dessous étaient un MIROIR recopié à la main de
-- print.css ; l'avertissement disait « les changer là sans les changer ici ferait mesurer
-- une colonne qui n'existe pas ». Ce filtre les LIT désormais depuis les jetons eux-mêmes,
-- avec lire_jeton_css ci-dessus — socle.css §2 (groupe « Échelle typographique partagée »)
-- et print.css §3 documentent le lien en retour. Ce qui casse maintenant, ce n'est plus de
-- changer une valeur — elle se propage seule — mais de RENOMMER ou SUPPRIMER un jeton : la
-- lecture ne le retrouve plus, voir le repli plus bas.
--
-- socle.css et print.css sont voisins de ce fichier, à ../styles/ : même mécanique que
-- dossier_ce_fichier() pour szh-titre-metriques.lua.
local SOCLE_CSS = dossier_ce_fichier() .. '../styles/socle.css'
local PRINT_CSS = dossier_ce_fichier() .. '../styles/print.css'

-- ⚠ 793,7 px n'est PAS un réglage de maquette mais la largeur d'une page A4 (210 mm) à
-- 96 ppp : la même norme que `@page { size: A4 }` (print.css §3). Elle ne porte donc pas de
-- jeton CSS — en fabriquer un pour une constante de papier serait le geste inverse de ce
-- chantier. Changer le format de page (passer en Letter, par exemple) oblige à revoir CETTE
-- constante ici ; ce n'est pas un jeton qui peut se renommer sous elle sans qu'on le sache.
local LARGEUR_A4 = 793.7

-- Essaie les cinq lectures dans l'ordre et s'arrête à la première qui manque, message
-- d'erreur en retour. Un échec partiel (par exemple TAILLE lu mais pas le ratio de colonne)
-- ne doit pas laisser la moitié du calcul se faire sur une valeur devinée : tout ou rien.
local function lire_geometrie_titre()
  local taille, erreur = lire_jeton_css(SOCLE_CSS, '--corps-titre-hero')
  if taille == nil then return nil, nil, nil, erreur end
  local interlettrage_em
  interlettrage_em, erreur = lire_jeton_css(SOCLE_CSS, '--interlettrage-titre-hero')
  if interlettrage_em == nil then return nil, nil, nil, erreur end
  local marge_gauche
  marge_gauche, erreur = lire_jeton_css(PRINT_CSS, '--page-marge-gauche')
  if marge_gauche == nil then return nil, nil, nil, erreur end
  local marge_droite
  marge_droite, erreur = lire_jeton_css(PRINT_CSS, '--page-marge-droite')
  if marge_droite == nil then return nil, nil, nil, erreur end
  local ratio_colonne
  ratio_colonne, erreur = lire_jeton_css(PRINT_CSS, '--hero-ratio-colonne')
  if ratio_colonne == nil then return nil, nil, nil, erreur end

  local largeur_colonne = (LARGEUR_A4 - marge_gauche - marge_droite) * ratio_colonne
  return largeur_colonne, taille, interlettrage_em * taille, nil
end

local LARGEUR_COLONNE, TAILLE, INTERLETTRAGE
do
  local erreur
  LARGEUR_COLONNE, TAILLE, INTERLETTRAGE, erreur = lire_geometrie_titre()
  if erreur ~= nil then
    -- Même repli que la table de métriques ci-dessus, et pour la même raison : ne jamais
    -- deviner une taille. Un titre replié par WeasyPrint sans escalier est une dégradation
    -- visible et sûre ; un escalier calculé sur une valeur inventée serait la dérive
    -- silencieuse que ce chantier supprime.
    io.stderr:write('[titre-lignes] ' .. erreur .. ' : le titre sera replié par WeasyPrint, ' ..
      'sans escalier.\n')
    METRIQUES = nil
  end
end

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
