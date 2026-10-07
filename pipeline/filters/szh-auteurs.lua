-- Pose le bloc des auteur·e·s dans le document, juste avant le marqueur
-- « ::: {.szh-biblio src=…} ». Un gabarit pandoc ne peut écrire qu'après `$body$`, donc
-- après la bibliographie ; ici, l'ordre du DOM (celui du PDF, de l'extraction de texte et
-- des lecteurs d'écran) place les auteurs avant les références.
--
-- S'exécute après szh-sections.lua (le titre du bloc ne reçoit pas de numéro de section)
-- et avant szh-citations.lua (qui remplace le marqueur .szh-biblio par le titre et les
-- entrées).
--
-- Le portrait est un <span> vide à fond CSS, pas un <img> : WeasyPrint balise tout <img>
-- en /Figure, qui serait ici sans /Alt (PDF/UA-1 7.3). Voir print.css. Le <style> qui
-- porte l'URL de chaque portrait reste dans l'en-tête du gabarit : --embed-resources ne
-- réécrit url() que dans un <style>.
--
-- Un article importé sans bibliographie détachée n'a pas de marqueur : le bloc est alors
-- ajouté à la fin.

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
    io.stderr:write('[auteurs] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local texte = commun.texte

-- Échappement HTML : le filtre écrit du RawBlock. Une esperluette non échappée (« Haute
-- école & institut ») rendrait le document mal formé pour le lecteur html du galley DOCX.
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
  else
    -- Personne sans photo : une silhouette tient la case au même format, pour que les
    -- colonnes de texte des auteurs restent alignées. Même <span> à fond CSS que le
    -- portrait, pour la même raison (voir print.css).
    ins('    <span class="szh-auteur-photo szh-auteur-photo-silhouette" role="presentation"></span>')
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
  -- Une fiche à un seul auteur peut arriver en map nue plutôt qu'en liste : on la
  -- reconnaît à ses clés, le type pandoc variant selon la version.
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
  if not pose then sortie:insert(section) end   -- pas de marqueur : à la fin

  return pandoc.Pandoc(sortie, doc.meta)
end
