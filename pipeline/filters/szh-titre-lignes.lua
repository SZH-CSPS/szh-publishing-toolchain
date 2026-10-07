-- Compilation : coupe le titre de couverture en escalier, la première ligne plus courte
-- que la deuxième (règle L3 de docs/TYPOGRAPHIE.md). WeasyPrint, lui, remplit la première
-- ligne au maximum et laisse le reste à la deuxième.
--
-- Aucune propriété CSS ne produit cet effet, et la boîte du titre (`max-height: 164px;
-- overflow: hidden`, print.css) tronquerait sans bruit une ligne de trop. Le filtre mesure
-- donc le titre avec les largeurs de caractères de sa police, extraites par
-- test/metriques-titre.py dans szh-titre-metriques.lua.
--
-- Il n'insère une coupure que si les quatre conditions tiennent :
--   1. le titre se replie déjà sur deux lignes au moins ;
--   2. la première ligne proposée est plus courte que la deuxième ;
--   3. le nombre total de lignes ne change pas, ce qui exclut la troncature ;
--   4. chaque ligne reste sous 98 % de la colonne, marge pour ce que le modèle ne calcule
--      pas (le crénage, voir test/metriques-titre.py).
-- Sinon il ne fait rien, et WeasyPrint replie le titre lui-même.
--
-- S'exécute après szh-typographie.lua, qui pose les insécables du titre et soude les mots
-- outils (règle L2) : on mesure le titre tel qu'il sera imprimé.
--
-- Le résultat va dans une clé à part, `titre-lignes`. `titre-affiche` sert aussi au
-- <title> de la page et au /Title du PDF, où un <br> n'a pas sa place. Le gabarit prend
-- `titre-lignes` s'il existe, sinon `titre-affiche`.

local utils = pandoc.utils

-- Dossier de ce fichier, pour charger la table de métriques voisine. PANDOC_SCRIPT_FILE
-- donnerait celui du script passé à pandoc.
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

-- ── Lecture des variables CSS ──────────────────────────────────────────────────────────
--
-- La géométrie du titre se lit dans socle.css et print.css, comme test/apca-check.py.
-- Unités admises : px tel quel ; rem converti en px (`html { font-size: 100% }` dans
-- print.css, donc 1 rem = 16 px) ; % ramené à un facteur 0-1 ; em gardé en facteur, que
-- l'appelant multiplie par la taille correspondante.
local REM_EN_PX = 16

-- Lit `--variable: valeur;` dans le fichier CSS `chemin` et rend le nombre converti.
-- Une valeur ou une unité non reconnue fait échouer la lecture. Rend (nombre, nil) ou
-- (nil, message), sans lever d'erreur Lua.
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

-- ── Géométrie du titre ─────────────────────────────────────────────────────────────────
--
-- Renommer ou supprimer une des variables lues ici désactive l'escalier (voir le repli
-- plus bas).
local SOCLE_CSS = dossier_ce_fichier() .. '../styles/socle.css'
local PRINT_CSS = dossier_ce_fichier() .. '../styles/print.css'

-- Largeur d'une page A4 (210 mm) à 96 ppp, comme `@page { size: A4 }` dans print.css.
-- À revoir si le format de page change.
local LARGEUR_A4 = 793.7

-- Lit les cinq valeurs ; à la première qui manque, rend nil et le message d'erreur.
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
    -- Comme sans table de métriques : pas d'escalier, WeasyPrint replie le titre.
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
-- Un groupe est un mot, ou plusieurs mots reliés par une insécable (après L2). Seule
-- l'espace ordinaire permet une coupure, et c'est elle que le filtre remplace par une fin
-- de ligne.
local function groupes(titre)
  local sortie = {}
  for morceau in (titre .. ESPACE):gmatch('([^' .. ESPACE .. ']*)' .. ESPACE) do
    if morceau ~= '' then sortie[#sortie + 1] = morceau end
  end
  return sortie
end

-- ── Repli glouton, celui de WeasyPrint ─────────────────────────────────────────────────
--
-- Pango remplit chaque ligne autant qu'il peut (first fit), sans équilibrage global : le
-- modèle fait de même pour prédire les lignes du PDF.
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

-- Rend le rang du dernier groupe de la première ligne et les groupes, ou nil s'il n'y a
-- rien à faire.
local function rang_de_coupure(titre)
  if METRIQUES == nil then return nil end
  inconnus = 0
  local gr = groupes(titre)
  if #gr < 2 then return nil end

  local largeur_espace = largeur(ESPACE)
  for _, g in ipairs(gr) do
    -- Un groupe plus large que la colonne déborde ou se coupe à un trait d'union, ce que
    -- le modèle ne prédit pas.
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
        choisi = k               -- le plus grand k : la première ligne la plus remplie
      end                        -- qui reste plus courte que la deuxième
    end
  end

  if inconnus > INCONNUS_TOLERES then return nil end
  if choisi == nil then return nil end
  -- WeasyPrint coupe déjà à cet endroit.
  if choisi == naturel[1].dernier then return nil end
  return choisi, gr
end

-- ── Clés posées pour le gabarit ────────────────────────────────────────────────────────
--
-- La coupure est un <br> : il ne crée aucun élément dans l'arbre de structure du PDF.
-- Sa classe permet à print.css de l'annuler sous @media screen (que WeasyPrint
-- n'applique pas) : la coupure ne vaut que pour la colonne du PDF.
--
-- `titre-signet` : le titre à plat, échappé pour un attribut. Le gabarit en fait le
-- data-signet du <h1>, que print.css donne au signet du PDF (content(text) collerait les
-- mots autour du <br>). En RawInline, sinon un guillemet droit fermerait l'attribut.
local function signet(titre)
  local echappe = titre:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;')
  return pandoc.MetaInlines({ pandoc.RawInline('html', echappe) })
end

local function poser(meta, rang, gr)
  meta['titre-signet'] = signet(table.concat(gr, ESPACE))
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
