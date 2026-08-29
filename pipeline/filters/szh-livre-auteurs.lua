-- Livre seulement : la ligne des auteur·e·s d'un CHAPITRE, juste sous son titre.
--
-- Un ouvrage collectif donne ses auteur·e·s chapitre par chapitre — c'est même ce qui le
-- distingue d'une monographie, où ils sont sur la couverture et nulle part ailleurs.
-- Dans les livres FALC publiés, la ligne se lit « De Barbara Fontana-Lana, Florence Nater
-- et Elodie Winkler », en corps de texte allégé, entre le titre du chapitre et le premier
-- bloc.
--
-- Pourquoi un filtre et pas le gabarit. Un gabarit pandoc ne sait rien INTERCALER : il
-- écrit ce qui suit `$body$`, donc la ligne se retrouverait avant le titre du chapitre ou
-- après tout le chapitre, jamais entre les deux. C'est le même constat qui a fait sortir
-- le bloc auteurs de templates/szh-article.html vers szh-auteurs.lua ; même raison, même
-- remède, et le voisin vaut d'être lu.
--
-- Ce filtre n'est PAS szh-auteurs.lua, et ne le remplace pas :
--   * szh-auteurs.lua compose le bloc de CLÔTURE d'un article — portrait, fonction,
--     affiliation, ORCID —, placé avant la bibliographie ;
--   * celui-ci n'écrit qu'une ligne de noms, en TÊTE de chapitre, sans portrait.
-- Un chapitre d'ouvrage collectif peut recevoir les deux : la ligne d'ouverture ici, et le
-- bloc détaillé en clôture si le livre le veut.
--
-- Ce qui décide, et rien d'autre : la clé `ouvrage` de buch.yaml.
--   * `collectif`   -> la ligne est écrite depuis `author` du <slug>.meta.yaml du chapitre ;
--   * `monographie` -> aucune ligne, quoi que porte la fiche du chapitre. Les auteur·e·s
--     d'une monographie sont ceux du livre ; les répéter à chaque chapitre serait faux.
-- Une valeur absente vaut `monographie` : c'est le cas le plus courant, et le silence est
-- le repli le moins dommageable — une ligne d'auteurs en trop se voit, une ligne manquante
-- se corrige en une clé.
--
-- ⚠ La clé s'appelle `ouvrage` et NON `type`, et ce n'est pas une préférence. `type` est
--   déjà la rubrique éditoriale d'un article dans les fiches de la revue (`article`,
--   `editorial`, `interview`…). Pandoc fusionne les fichiers de métadonnées et garde le
--   DERNIER à clé égale : la fiche du chapitre passant après buch.yaml, un chapitre importé
--   de Word aurait effacé « collectif » par « article », et l'ouvrage aurait silencieusement
--   perdu ses auteur·e·s de chapitre.
--
-- Place dans la chaîne : APRÈS szh-sections.lua, pour que le titre de chapitre porte déjà
-- son numéro et que la ligne se pose sous le titre FINI ; avant szh-citations.lua, comme
-- son voisin.

local S = pandoc.utils.stringify

local LIVRE = (os.getenv('SZH_LIVRE') or '') ~= ''

local function texte(v)
  if v == nil then return '' end
  local ok, r = pcall(S, v)
  if not ok then return '' end
  return (r:gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Échappement HTML : ce filtre écrit du RawBlock, le gabarit ne le fait plus pour nous.
-- Une esperluette dans un nom composé produirait sans cela un document mal formé.
local function ech(v)
  return (texte(v):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

-- « Prénom Nom » quand la fiche les distingue, sinon la chaîne libre. Même règle que
-- szh-auteurs.lua : une fiche ancienne peut n'avoir qu'un champ.
local function nom_affiche(a)
  local nom, prenom = texte(a.nom), texte(a.prenom)
  if nom ~= '' and prenom ~= '' then return prenom .. ' ' .. nom end
  if nom ~= '' then return nom end
  if prenom ~= '' then return prenom end
  return texte(a)
end

-- La conjonction avant le dernier nom, dans la langue du livre. L'italien et le romanche
-- ne sont pas ici parce qu'aucun livre ne les a demandés ; le repli français est visible,
-- pas silencieux — un « et » dans un livre allemand se remarque à la relecture.
local CONJONCTION = { fr = ' et ', de = ' und ', it = ' e ', en = ' and ' }
-- L'amorce de la ligne. L'allemand n'en met pas : « Barbara Fontana-Lana, … » se suffit,
-- là où le français dit « De … ». Relevé sur les livres des deux collections.
local AMORCE = { fr = 'De ', de = '', it = 'Di ', en = 'By ' }

local function langue_de(meta)
  local l = texte(meta and meta.lang)
  if l == '' then return 'fr' end
  return (l:lower():match('^(%a%a)')) or 'fr'
end

local function ligne_auteurs(meta)
  local gens = meta and meta.author
  if gens == nil or #gens == 0 then return nil end
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

function Pandoc(doc)
  if not LIVRE then return doc end
  if texte(doc.meta.ouvrage) ~= "collectif" then return doc end

  local ligne = ligne_auteurs(doc.meta)
  if not ligne then return doc end

  -- Sous le PREMIER titre du document, qui est le titre du chapitre. Un chapitre qui
  -- n'ouvrirait pas par un titre — cela arrive à une pièce liminaire mal rangée — ne
  -- reçoit rien plutôt que de voir la ligne atterrir au hasard.
  local i = nil
  for rang, b in ipairs(doc.blocks) do
    if b.t == 'Header' then i = rang; break end
  end
  if not i then return doc end

  doc.blocks:insert(i + 1,
    pandoc.RawBlock('html', '<p class="szh-auteurs">' .. ligne .. '</p>'))
  return doc
end
