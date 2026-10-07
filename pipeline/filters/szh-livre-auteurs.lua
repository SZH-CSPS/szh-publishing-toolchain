-- Livre seulement : pose la ligne des auteur·e·s d'un chapitre juste sous son titre, par
-- exemple « De Barbara Fontana-Lana, Florence Nater et Elodie Winkler ».
--
-- Un gabarit pandoc ne peut écrire qu'avant ou après `$body$`, pas entre le titre et le
-- premier bloc : d'où un filtre, comme szh-auteurs.lua pour les articles. szh-auteurs.lua
-- compose le bloc de clôture d'un article (portrait, fonction, affiliation, ORCID) et ne
-- tourne pas sur un chapitre ; ce filtre n'écrit qu'une ligne de noms.
--
-- Le titre du chapitre est posé avant par szh-livre-titre.lua ; le sous-titre, après, par
-- szh-livre-sous-titre.lua.
--
-- La clé `ouvrage` de buch.yaml décide :
--   * `collectif`   -> la ligne est écrite depuis `author` du <slug>.meta.yaml du chapitre ;
--   * `monographie` -> aucune ligne : les auteur·e·s sont ceux du livre.
-- Une valeur absente vaut `monographie`.
--
-- La clé s'appelle `ouvrage` et non `type` : `type` est la rubrique éditoriale dans les
-- fiches (`article`, `editorial`…). Pandoc garde la dernière valeur d'une clé fusionnée, et
-- la fiche du chapitre, lue après buch.yaml, écraserait « collectif ».
--
-- S'exécute après szh-sections.lua (le titre porte déjà son numéro) et avant
-- szh-citations.lua.

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[livre-auteurs] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local texte = commun.texte

-- Échappement HTML : le filtre écrit du RawBlock. Une esperluette non échappée rendrait le
-- document mal formé.
local function ech(v)
  return (texte(v):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

-- « Prénom Nom » quand la fiche les distingue, sinon la chaîne libre (une fiche ancienne
-- peut n'avoir qu'un champ). Même règle que szh-auteurs.lua.
local function nom_affiche(a)
  local nom, prenom = texte(a.nom), texte(a.prenom)
  if nom ~= '' and prenom ~= '' then return prenom .. ' ' .. nom end
  if nom ~= '' then return nom end
  if prenom ~= '' then return prenom end
  return texte(a)
end

-- Conjonction avant le dernier nom, selon la langue du livre ; repli en français.
local CONJONCTION = { fr = ' et ', de = ' und ', it = ' e ' }
-- Début de la ligne. L'allemand n'en met pas : « Barbara Fontana-Lana, … ».
local AMORCE = { fr = 'De ', de = '', it = 'Di ' }

local function langue_de(meta)
  return commun.contexte(meta).lang
end

local function ligne_auteurs(meta)
  -- `author` seul : `auteurs` est la clé de buch.yaml (les auteur·e·s du livre), fusionnée
  -- dans les métadonnées de chaque chapitre ; la lire donnerait à un chapitre sans
  -- auteur·e·s ceux de l'ouvrage.
  local gens = meta and meta.author
  if type(gens) ~= 'table' then return nil end
  -- Une fiche à un seul auteur peut arriver en map nue plutôt qu'en liste : on la
  -- reconnaît à ses clés, le type pandoc variant selon la version.
  if gens.nom ~= nil or gens.prenom ~= nil then gens = { gens } end
  if #gens == 0 then return nil end
  local noms = {}
  for _, a in ipairs(gens) do
    local n = nom_affiche(a)
    if n ~= '' then noms[#noms + 1] = ech(n) end
  end
  if #noms == 0 then return nil end
  local lang = langue_de(meta)
  local liste
  if #noms == 1 then
    liste = noms[1]
  else
    local dernier = table.remove(noms)
    liste = table.concat(noms, ', ') .. (CONJONCTION[lang] or CONJONCTION.fr) .. dernier
  end
  return (AMORCE[lang] or AMORCE.fr) .. liste
end

-- Vrai si le bloc est un Div `.szh-auteurs` déjà posé par l'import Word (style « Auhors »
-- et ses variantes, voir docx-styles-corps.py). Ce bloc, texte réel du chapitre, est alors
-- gardé et la ligne n'est pas écrite une seconde fois depuis la fiche.
local function deja_bloc_auteurs(b)
  return b ~= nil and b.t == 'Div' and b.classes ~= nil and b.classes:includes('szh-auteurs')
end

function Pandoc(doc)
  if commun.contexte(doc.meta).produit ~= 'livre' then return doc end
  if texte(doc.meta.ouvrage) ~= "collectif" then return doc end

  local ligne = ligne_auteurs(doc.meta)
  if not ligne then return doc end

  -- Sous le premier titre, qui est celui du chapitre. Sans titre, rien n'est posé.
  local i = nil
  for rang, b in ipairs(doc.blocks) do
    if b.t == 'Header' then i = rang; break end
  end
  if not i then return doc end

  -- Maquette normale : `auteurs-chapitre` du bloc `mise-en-page:` (commun.mise_en_page).
  -- « dessus » place la ligne avant le titre dans le DOM, pour que l'ordre de lecture suive
  -- l'ordre visuel. Le FALC la garde dessous.
  local mep = commun.mise_en_page(doc.meta)
  local dessus = mep ~= nil and mep['auteurs-chapitre'] == 'dessus'

  if deja_bloc_auteurs(doc.blocks[i + 1]) then
    if dessus then doc.blocks:insert(i, doc.blocks:remove(i + 1)) end
    return doc
  end

  doc.blocks:insert(dessus and i or i + 1,
    pandoc.RawBlock('html', '<p class="szh-auteurs">' .. ligne .. '</p>'))
  return doc
end
