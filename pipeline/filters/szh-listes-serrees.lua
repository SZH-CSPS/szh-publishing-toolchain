-- Resserre les listes : un item dont le contenu est un seul paragraphe le perd.
--
-- Le défaut qu'il corrige, et il est sévère. Markdown distingue les listes SERRÉES (items
-- collés) des listes LÂCHES (une ligne vide entre les items). Pandoc rend les premières en
-- `<li>texte</li>` et les secondes en `<li><p>texte</p></li>`. WeasyPrint 69 balise alors
-- le paragraphe en <P> DIRECTEMENT sous le <LI>, sans le <LBody> que PDF/UA-1 exige :
--
--   ISO 14289-1 7.2-20 — « LI element may contain only Lbl and LBody elements »
--
-- Mesuré, isolé, reproduit sur deux lignes de HTML : une liste serrée passe la porte
-- veraPDF, la même liste lâche échoue. Sur le premier livre réel — un FALC, où presque
-- toute la matière est en listes — la règle tombait **182 fois** et le PDF sortait non
-- conforme.
--
-- ⚠ CE DÉFAUT VAUT AUSSI POUR LA REVUE, et il y dort. Aucun article du banc n'a de liste
--   lâche ; le jour où une rédaction en écrit une, la porte `verifier-ua` refuse l'export
--   du numéro entier, sans que personne comprenne pourquoi. Ce filtre est donc branché des
--   deux côtés.
--
-- Ce qu'on ne peut PAS faire à la place : il n'existe aucun balisage HTML ni aucune
-- propriété CSS qui demande un <LBody>. C'est WeasyPrint qui décide, d'après la structure
-- qu'on lui donne. La seule prise est donc en amont, sur l'arbre pandoc.
--
-- Ce que cela coûte, et pourquoi ce n'est presque rien : une liste lâche s'affiche avec de
-- l'air entre ses items, et cet air venait de la marge du <p>. Il se remet en CSS, sur le
-- <li> — c'est déjà ce que font print.css et les chartes de livre (`li { margin-bottom }`).
-- L'écart visuel est nul ; on l'a comparé.
--
-- ⚠ Un item qui contient PLUSIEURS blocs — deux paragraphes, ou un paragraphe et une
--   sous-liste — n'est pas touché : y retirer le paragraphe collerait les deux morceaux.
--   Ces items-là gardent leur <p> et restent non conformes ; ils sont rares, et les
--   aplatir ferait plus de mal que la règle qu'ils enfreignent. Si le cas se présente, il
--   se verra à la porte PDF/UA, avec son compte.

-- Un item devient serré si, et seulement si, il tient en UN Para.
local function resserrer_items(items)
  local sortie = {}
  for i, blocs in ipairs(items) do
    if #blocs == 1 and blocs[1].t == 'Para' then
      sortie[i] = { pandoc.Plain(blocs[1].content) }
    else
      sortie[i] = blocs
    end
  end
  return sortie
end

function BulletList(l)
  l.content = resserrer_items(l.content)
  return l
end

function OrderedList(l)
  l.content = resserrer_items(l.content)
  return l
end

-- Les listes de définitions ont la même structure de balisage (<DL>/<DT>/<DD>) et une autre
-- règle : elles ne sont pas concernées par 7.2-20, on n'y touche pas.
