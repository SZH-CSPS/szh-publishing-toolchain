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
-- ⚠ Deux formes d'item à PLUSIEURS blocs, et elles ne se traitent pas pareil — mesuré,
--   chacune isolée sur trois lignes de HTML :
--   * « texte + sous-liste » : PASSE la porte telle quelle. WeasyPrint met le texte dans un
--     LBody et la sous-liste avec. On n'y touche pas.
--   * « deux paragraphes » : ÉCHOUE. Les deux <p> deviennent deux enfants directs du <LI>.
--     Ceux-là sont fusionnés en un seul bloc, les paragraphes séparés par un saut de ligne.
--     C'est un changement de structure, assumé : dans un item de liste, deux paragraphes se
--     lisent comme deux lignes — et c'est littéralement la règle FALC, une phrase par ligne.
--     L'alternative serait un livre que la porte PDF/UA refuse d'exporter, pour toujours.
--   Un item qui mêle les deux formes n'est pas touché : il est rare, et le fusionner
--   collerait une liste à un paragraphe.

-- Les paragraphes DE TÊTE d'un item, fusionnés en un seul bloc en ligne. Le reste — une
-- sous-liste, un tableau — est laissé où il est : c'est une forme que WeasyPrint balise
-- correctement (mesuré), et la fusionner collerait une liste à un paragraphe.
-- Un saut est-il déjà posé en fin de contenu ? Sert à ne pas en ajouter un second.
local function finit_par_saut(inlines)
  local dernier = inlines[#inlines]
  return dernier ~= nil and (dernier.t == 'LineBreak' or dernier.t == 'SoftBreak')
end

-- Les sauts qui traînent en fin d'item : ils ouvriraient une ligne vide sous le dernier
-- mot, et la puce suivante s'en trouverait repoussée d'un interligne.
local function elaguer_sauts_finaux(inlines)
  while finit_par_saut(inlines) do inlines:remove(#inlines) end
  return inlines
end

local function resserrer_items(items)
  local sortie = {}
  for i, blocs in ipairs(items) do
    -- Combien de Para au début de l'item ?
    local n = 0
    while blocs[n + 1] and blocs[n + 1].t == 'Para' do n = n + 1 end

    if n == 0 then
      sortie[i] = blocs
    else
      local contenu = pandoc.Inlines({})
      for j = 1, n do
        -- Deux paragraphes d'un même item se lisent comme deux lignes — et c'est
        -- littéralement la règle FALC, une phrase par ligne.
        --
        -- ⚠ SAUF si le paragraphe précédent finit DÉJÀ par un saut. L'import Word pose un
        --   `\` en fin de chaque ligne FALC : en ajouter un second doublerait l'interligne
        --   de l'item, et deux <br> ne se signalent nulle part — HTML valide, PDF conforme,
        --   seul le nombre de pages trahit. szh-sauts-uniques.lua tient la même règle pour
        --   le reste du document ; ici, la fusion recrée le cas et doit s'en garder seule.
        if j > 1 and not finit_par_saut(contenu) then contenu:insert(pandoc.LineBreak()) end
        contenu:extend(blocs[j].content)
      end
      local neufs = { pandoc.Plain(elaguer_sauts_finaux(contenu)) }
      for j = n + 1, #blocs do neufs[#neufs + 1] = blocs[j] end
      sortie[i] = neufs
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
