-- Aperçu seulement : rend aux titres l'identifiant que la chaîne PDF leur donne.
--
-- Les deux chaînes ne lisent pas le .md avec le même lecteur — l'aperçu est obligé de
-- passer par commonmark (voir szh-sourcepos.lua) — et les deux lecteurs ne fabriquent pas
-- l'identifiant d'un titre de la même façon dès qu'il porte de la ponctuation :
--
--     ## Titre principal : le grand     markdown -> titre-principal-le-grand
--                                    commonmark_x -> titre-principal--le-grand
--     ## Fachbücher & Filme             markdown -> fachbücher-filme
--                                    commonmark_x -> fachbücher--filme
--     ## 50 % des élèves                markdown -> des-élèves
--                                    commonmark_x -> 50--des-élèves
--
-- Mesuré le 11.09.2026 sur les 4661 titres du corpus du dépôt : 1460 portaient dans
-- l'aperçu un identifiant que le PDF n'a jamais eu — près d'un sur trois. Or les articles
-- de documentation ouvrent sur une table des matières faite de liens « [Rubrique](#rubrique) »
-- — le dépôt en compte plus de mille. Ces liens mènent au bon endroit dans le PDF et nulle
-- part dans l'aperçu, sans que rien ne le signale : un lien mort ne se plaint pas.
--
-- Après ce filtre il en reste 16, et ils ne sont pas de son ressort : sur ces titres-là, les
-- deux lecteurs ne lisent pas le même TEXTE, avant même qu'il soit question d'identifiant
-- — une contre-oblique d'échappement, un souligné au milieu d'un mot, « ... » que l'un rend
-- en trois points et l'autre en points de suspension. Aucun ne se dégrade : le filtre ne
-- touche à un titre que lorsqu'il sait ce qu'il aurait porté.
--
-- ⚠ L'algorithme n'est pas réécrit ici, il est DEMANDÉ À PANDOC : on relit « # <texte> »
-- avec le lecteur `markdown`, et on lui prend l'identifiant qu'il en tire. Réimplémenter
-- la règle (retirer la ponctuation, découper aux blancs, passer en bas de casse, couper
-- avant la première lettre) aurait demandé de classer les lettres accentuées à la main,
-- et une table fausse d'un caractère aurait donné des ancres mortes que personne n'aurait
-- vues. Pandoc est le seul à savoir ce que pandoc fait.
--
-- Un identifiant écrit à la main — « ## Titre {#mon-ancre} », ce que posent les tables des
-- matières converties depuis Word — ne doit surtout pas être réécrit. On le reconnaît sans
-- le deviner : on recalcule ce que commonmark AURAIT posé, et on ne touche au titre que si
-- c'est exactement ce qu'il porte.
--
-- À poser dans la chaîne d'aperçu seulement. Sous le lecteur `markdown` il ne trouverait
-- jamais rien à corriger.

local utils = pandoc.utils

-- Identifiant d'un texte de titre selon un lecteur donné, ou nil si pandoc n'en tire pas
-- de titre. Le texte est déjà aplati : les marques de mise en forme ont disparu, et les
-- deux lecteurs les auraient de toute façon ignorées pour l'identifiant.
local function identifiant_selon(lecteur, texte)
  local ok, doc = pcall(pandoc.read, '# ' .. texte, lecteur)
  if not ok then return nil end
  local premier = doc.blocks[1]
  if not premier or premier.t ~= 'Header' then return nil end
  if premier.identifier == '' then return nil end
  return premier.identifier
end

-- Le suffixe que pandoc ajoute à un identifiant déjà pris : -1, -2, … dans l'ordre du
-- document. Les deux lecteurs comptent pareil, d'où deux compteurs tenus en parallèle :
-- sans cela, le deuxième « ## Même titre » aurait porté `meme-titre-1` face à un calcul
-- qui rend `meme-titre`, et il serait passé pour un identifiant écrit à la main.
local function unique(vus, base)
  local n = vus[base]
  if n == nil then
    vus[base] = 0
    return base
  end
  vus[base] = n + 1
  return base .. '-' .. (n + 1)
end

local vus_commonmark, vus_markdown = {}, {}

function Header(h)
  if h.identifier == '' then return nil end
  local texte = utils.stringify(h.content)
  if texte == '' then return nil end

  local base_cm = identifiant_selon('commonmark_x', texte)
  local base_md = identifiant_selon('markdown', texte)
  if base_cm == nil or base_md == nil then return nil end

  -- Les deux compteurs avancent pour CE titre, quoi qu'on décide ensuite : un titre laissé
  -- tel quel occupe quand même son rang dans la suite des doublons.
  local attendu = unique(vus_commonmark, base_cm)
  local vise = unique(vus_markdown, base_md)

  -- L'identifiant ne vient pas du lecteur : il est écrit dans le .md. On n'y touche pas.
  if h.identifier ~= attendu then return nil end
  if vise == h.identifier then return nil end

  h.identifier = vise
  return h
end
