-- szh-legende-avant.lua — la légende d'une FIGURE est placée AVANT l'image (D115).
--
-- Règle éditoriale de la revue : une légende se lit avant l'objet qu'elle annonce.
-- Les TABLEAUX l'appliquaient déjà (`<caption>` est le premier enfant de `<table>`,
-- et print.css la pose au-dessus avec `caption-side: top`) ; les figures, non :
-- le writer HTML de pandoc écrit toujours `<figure><img><figcaption>`, dans cet
-- ordre, et rien ne le paramètre.
--
-- POURQUOI PAS EN CSS. `figure { flex-direction: column-reverse }` (ou
-- `figcaption { order: -1 }`) remonterait la légende À L'ÉCRAN sans toucher au
-- document : l'ordre du DOM — donc celui du flux de contenu du PDF, celui de
-- l'extraction de texte, du copier-coller et de « Read Out Loud » — resterait
-- image puis légende. La chaîne s'est déjà fait piéger par cet écart entre ordre
-- VU et ordre LU (voir print.css §5, « Ordre de PEINTURE du PDF ») : on corrige
-- donc le document, pas seulement son apparence.
--
-- COMMENT. `<figcaption>` est valide comme PREMIER ou comme dernier enfant de
-- `<figure>` (HTML5). On remplace la Figure par la SUITE de blocs équivalente :
--   RawBlock '<figure …>' · RawBlock '<figcaption>' · blocs de la légende ·
--   RawBlock '</figcaption>' · contenu de la figure · RawBlock '</figure>'
-- Seules les BALISES sont du HTML brut : la légende et l'image restent des blocs
-- Pandoc, écrits par le writer comme avant — donc `alt`, `role`, les `data-*` de
-- crédits et surtout `--embed-resources` (l'image inlinée en base64) se comportent
-- exactement comme aujourd'hui. Rien n'est reconstruit à la main dans le texte.
--
-- ORDRE DES FILTRES. Doit tourner APRÈS szh-numerotation.lua : c'est lui qui écrit
-- « Figure N — », les crédits et l'alt DANS la Figure, et il ne voit qu'un AST où
-- les Figure existent encore. Après ce filtre-ci, il n'y a plus de Figure.
--
-- FORMATS. Réservé aux sorties HTML (PDF via WeasyPrint, HTML autonome, aperçu).
-- Un writer non-HTML JETTE les RawBlock html : brancher ce filtre sur une telle
-- chaîne y ferait disparaître les images. Le Makefile ne l'y branche pas — la
-- garde ci-dessous le dit quand même.

if not FORMAT:match('^html') then return {} end

-- Échappement HTML d'une valeur d'attribut (identifiant/classe d'un `![](){#id}`).
local function att(v)
  return (v:gsub('&', '&amp;'):gsub('"', '&quot;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

-- `<figure>` avec l'id et les classes de la Figure d'origine (les autres attributs
-- de l'Attr ne sont pas repris : pandoc ne les émet pas non plus sur `<figure>`).
local function balise_ouvrante(fig)
  local bouts = { '<figure' }
  if fig.identifier and fig.identifier ~= '' then
    bouts[#bouts + 1] = ' id="' .. att(fig.identifier) .. '"'
  end
  if fig.classes and #fig.classes > 0 then
    bouts[#bouts + 1] = ' class="' .. att(table.concat(fig.classes, ' ')) .. '"'
  end
  bouts[#bouts + 1] = '>'
  return table.concat(bouts)
end

function Figure(fig)
  local blocs = pandoc.Blocks({ pandoc.RawBlock('html', balise_ouvrante(fig)) })
  -- Figure sans légende : pas de <figcaption> vide (une figure décorative garde son
  -- <figure> et son image ; szh-numerotation.lua l'a déjà déclarée décorative).
  if #fig.caption.long > 0 then
    blocs:insert(pandoc.RawBlock('html', '<figcaption>'))
    blocs:extend(fig.caption.long)
    blocs:insert(pandoc.RawBlock('html', '</figcaption>'))
  end
  blocs:extend(fig.content)
  blocs:insert(pandoc.RawBlock('html', '</figure>'))
  return blocs
end
