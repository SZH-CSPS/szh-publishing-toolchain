-- Notes de bas de page : les rendre imprimables AU BAS DE LEUR PAGE, et non rejetées en
-- bloc à la fin de l'article.
--
-- Le writer HTML de pandoc n'offre pas ce choix : il déplace toute Note dans une
-- <section class="footnotes"> de fin de document et laisse un appel numéroté à sa place.
-- Le lecteur d'une note doit alors sauter neuf pages, y compris sur papier où il n'y a
-- pas de lien à suivre.
--
-- WeasyPrint sait faire mieux, par les Generated Content for Paged Media (CSS GCPM) :
-- un élément déclaré `float: footnote` sort du flux, s'imprime dans la zone @footnote de
-- la page où son appel se trouve, et le compteur `footnote` numérote appel et marque tout
-- seul (::footnote-call, ::footnote-marker). Encore faut-il que le contenu de la note soit
-- INLINE, à l'endroit de l'appel — c'est ce que ce filtre fait : chaque Note devient un
-- Span de classe « szh-note » portant le contenu aplati. Vérifié sur WeasyPrint 69.
--
-- Ce filtre tourne en DERNIER, après szh-citations.lua. Les Notes traversent donc toute la
-- chaîne inchangées, comme avant, et ne deviennent des Spans qu'à la sortie : aucun autre
-- filtre ne change de comportement, et le rapport d'appels de citation compte la même
-- chose qu'hier.
--
-- Deux garde-fous :
--   * sorties HTML seulement — un writer non-HTML (le galley DOCX passe, lui, par le HTML
--     final, donc il est concerné) ne saurait rien faire d'un Span de classe ;
--   * jamais dans l'aperçu du cockpit (SZH_APERCU=1), qui n'est pas paginé : les notes y
--     restent des notes de fin, avec leurs liens aller-retour, ce qui est la bonne forme
--     pour un document qui défile.
--
-- ⚠ `float: footnote` n'existe pas dans un navigateur. Le HTML autonome, ouvert à l'écran,
--   afficherait donc la note dans le fil du texte. print.css la rattrape en @media screen
--   (§ notes) en la posant en bloc détaché sous son paragraphe. Le jour où la sortie web
--   aura son propre gabarit, c'est là que la vraie forme web se décidera.

if FORMAT == nil or not FORMAT:match('html') then return {} end
if (os.getenv('SZH_APERCU') or '') ~= '' then return {} end

local blocs_en_inlines = pandoc.utils.blocks_to_inlines

-- ⚠ Le contenu de la note doit sortir SUR UNE SEULE LIGNE de HTML. Mesuré sur
--   WeasyPrint 69 : dans la zone @footnote, un saut de ligne du source HTML est rendu
--   comme une coupure dure, et la note se compose en escalier au lieu de remplir la
--   largeur. Partout ailleurs le même saut se réduit à une espace, comme le veut HTML —
--   c'est propre à cette zone, et `white-space: normal` n'y change rien (essayé).
--   Or ces sauts ne viennent pas du texte : c'est le writer HTML de pandoc qui replie ses
--   lignes vers la 72e colonne. Un filtre ne peut pas le lui interdire pour un seul
--   élément, et --wrap=none replierait tout le document. La note est donc écrite ici en
--   HTML, dépliée, et rendue en RawInline : pandoc recopie un RawInline tel quel, sans
--   jamais y couper de ligne.
local function html_deplie(inlines)
  local html = pandoc.write(pandoc.Pandoc({ pandoc.Plain(inlines) }), 'html')
  -- %s couvre le saut de ligne : toute suite d'espaces blancs devient UNE espace.
  return (html:gsub('%s+', ' '):gsub('^ +', ''):gsub(' +$', ''))
end

return {
  {
    Note = function(note)
      -- Une note peut contenir plusieurs blocs (deux paragraphes, une liste). Aplatis
      -- avec une simple espace : dans la zone @footnote, une note tient en un paragraphe.
      local contenu = blocs_en_inlines(note.content, { pandoc.Space() })
      return pandoc.RawInline('html',
        '<span class="szh-note">' .. html_deplie(contenu) .. '</span>')
    end
  }
}
