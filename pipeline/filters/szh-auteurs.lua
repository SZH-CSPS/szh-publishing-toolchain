-- Bloc des auteur·e·s, posé DANS le document et non par le gabarit.
--
-- Pourquoi il a quitté templates/szh-article.html : un gabarit pandoc ne sait rien
-- intercaler, il écrit ce qui suit `$body$`. Le bloc auteurs se retrouvait donc toujours
-- APRÈS la bibliographie, alors qu'il doit venir avant elle — les références ferment
-- l'article, elles ne sont pas suivies d'autre chose. Écrit ici, le bloc s'insère juste
-- devant le marqueur « ::: {.szh-biblio src=…} », et l'ordre du DOM — celui que lisent le
-- flux du PDF, l'extraction de texte et les lecteurs d'écran — devient le bon.
--
-- Doit tourner APRÈS szh-sections.lua et AVANT szh-citations.lua :
--   * après szh-sections, sinon le titre du bloc recevrait un numéro de section (il n'en
--     porte pas : c'est un titre de clôture, comme celui de la bibliographie) ;
--   * avant szh-citations, qui dissout le marqueur .szh-biblio en titre + entrées. Après
--     lui, il n'y aurait plus de repère pour savoir où finit l'article.
--
-- Le balisage reproduit exactement celui que le gabarit écrivait, à la lettre près :
-- <span> vide à fond CSS pour le portrait et PAS un <img> (le pourquoi est dans
-- print.css § 8 — en un mot : WeasyPrint balise tout <img> en /Figure, ce serait une
-- /Figure sans /Alt, donc PDF/UA-1 7.3 violée). Le <style> qui porte l'URL de chaque
-- portrait reste, lui, dans l'en-tête du gabarit : --embed-resources ne réécrit url()
-- que dans un <style>, et un chemin relatif ailleurs partirait en lien mort.
--
-- Article importé avant la bibliographie détachée : il n'a pas de marqueur, sa liste de
-- références vit encore dans le corps. Faute de repère, le bloc est alors ajouté à la fin,
-- soit exactement la place qu'il occupait avant ce filtre. Rien ne casse, rien ne se perd.

local S = pandoc.utils.stringify

local function texte(v)
  if v == nil then return '' end
  local ok, r = pcall(S, v)
  if not ok then return '' end
  return (r:gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Échappement HTML : le gabarit pandoc le faisait pour nous, ce filtre écrit du RawBlock.
-- Une esperluette dans une affiliation (« Haute école & institut ») produirait sans cela
-- un document mal formé, que le lecteur html du galley DOCX refuserait.
local function ech(v)
  return (texte(v):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;'))
end

-- Nom affiché : « Prénom Nom » quand la fiche les distingue, sinon la chaîne libre.
local function nom_affiche(a)
  local nom, prenom = texte(a.nom), texte(a.prenom)
  if nom ~= '' then
    return ech(prenom ~= '' and (prenom .. ' ' .. nom) or nom)
  end
  return ech(a)
end

local function bloc_auteur(a, rang)
  local h = {}
  local ins = function(x) h[#h + 1] = x end

  ins('  <div class="szh-auteur">')
  if texte(a.photo) ~= '' then
    ins(string.format(
      '    <span class="szh-auteur-photo szh-auteur-photo-%s" role="presentation"></span>',
      ech(a['photo-rang'] ~= nil and a['photo-rang'] or rang)))
  end
  ins('    <div class="szh-auteur-texte">')

  local orcid = texte(a['orcid-url'])
  local lien_orcid = orcid ~= ''
    and string.format(' <a class="szh-orcid" href="%s" title="ORCID" aria-label="ORCID"></a>', ech(orcid))
    or ''
  ins(string.format('      <p class="szh-auteur-nom">%s%s</p>', nom_affiche(a), lien_orcid))

  for _, champ in ipairs({ 'fonction', 'affiliation' }) do
    if texte(a[champ]) ~= '' then
      ins(string.format('      <p class="szh-auteur-%s">%s</p>', champ, ech(a[champ])))
    end
  end

  local mail = texte(a.email)
  if mail ~= '' then
    ins(string.format('      <p class="szh-auteur-email"><a href="mailto:%s">%s</a></p>',
      ech(mail), ech(mail)))
  end

  ins('    </div>')
  ins('  </div>')
  return table.concat(h, '\n')
end

local function section_auteurs(meta)
  local auteurs = meta.author or meta.auteurs
  if type(auteurs) ~= 'table' then return nil end
  -- Une fiche à un seul auteur peut arriver en map nue plutôt qu'en liste d'une map :
  -- la reconnaître à ses clés, et non au type pandoc, qui varie d'une version à l'autre.
  if auteurs.nom ~= nil or auteurs.prenom ~= nil then auteurs = { auteurs } end
  if #auteurs == 0 then return nil end

  local titre = texte(meta['auteurs-titre'])
  local h = { '<section class="szh-auteurs">' }
  if titre ~= '' then
    h[#h + 1] = string.format('  <h2 class="szh-auteurs-titre">%s</h2>', ech(titre))
  end
  for i, a in ipairs(auteurs) do h[#h + 1] = bloc_auteur(a, i) end
  h[#h + 1] = '</section>'
  return pandoc.RawBlock('html', table.concat(h, '\n'))
end

function Pandoc(doc)
  local section = section_auteurs(doc.meta)
  if section == nil then return doc end

  local sortie = pandoc.List()
  local pose = false
  for _, b in ipairs(doc.blocks) do
    if not pose and b.t == 'Div' and b.classes:includes('szh-biblio') then
      sortie:insert(section)
      pose = true
    end
    sortie:insert(b)
  end
  if not pose then sortie:insert(section) end   -- pas de marqueur : à la fin, comme avant

  return pandoc.Pandoc(sortie, doc.meta)
end
