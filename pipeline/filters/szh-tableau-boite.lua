-- Enveloppe chaque tableau dans une boîte qui ne se coupe pas.
--
-- Le défaut qu'il corrige, constaté sur le premier livre du banc d'essai. Un <table> qui
-- porte une <caption> n'est pas mis en page seul : le moteur l'entoure d'une BOÎTE
-- ENVELOPPE anonyme, qui porte la légende. Cette enveloppe-là n'est atteignable par aucun
-- sélecteur CSS — `break-inside: avoid` posé sur `table` ne la retient pas — et quand elle
-- se coupe entre sa légende et sa table, le baliseur de WeasyPrint 69 s'arrête net :
--
--   File ".../weasyprint/formatting_structure/boxes.py", line 407, in get_wrapped_table
--   ValueError: Table wrapper without a table
--
-- Ce qui suit est le vrai piège : le Makefile rattrape l'échec et sort un PDF **non
-- balisé**. Le rédacteur voit un PDF correct, aucune erreur rouge, et le fichier a perdu sa
-- conformité PDF/UA — sans un mot. La panne ne se voit qu'à la porte `verifier-ua`, ou
-- jamais.
--
-- La condition exacte est une affaire de millimètres : sur le banc, le tableau seul passe,
-- le tableau précédé de deux figures échoue, et déplacer n'importe quoi d'un demi-centimètre
-- suffit à changer le verdict. Un défaut de pagination, donc, qu'aucun test de contenu ne
-- peut attraper. On ne le contourne pas en déplaçant le texte : on retire la condition.
--
-- Le remède : un Div qui enveloppe le tableau. Il est, lui, un vrai élément, atteignable en
-- CSS, et `break-inside: avoid` sur lui tient la légende et la table ensemble. Le tableau ne
-- se coupe donc plus au mauvais endroit, et l'enveloppe anonyme n'a plus l'occasion de se
-- retrouver sans table.
--
-- ⚠ Ce filtre s'applique aussi à la REVUE, où le même défaut est possible et n'a
--   simplement jamais été rencontré : aucun article publié n'a eu la géométrie qu'il faut.
--   C'est de la chance, pas une garantie.
--
-- Place dans la chaîne : APRÈS szh-tabelle-inclure (sinon les tableaux réinjectés ne sont
-- pas encore là) et APRÈS szh-numerotation (qui pose la légende « Tableau N — » ; enveloppé
-- avant, le tableau ne serait plus un enfant direct du document et le compteur le raterait).

local CLASSE = 'szh-tableau-boite'

-- Les tableaux écrits en markdown : pandoc les rend en Table, que le writer HTML sort en
-- <table>. Un Div autour suffit.
function Table(t)
  return pandoc.Div({ t }, pandoc.Attr('', { CLASSE }))
end

-- Les tableaux réinjectés par szh-tabelle-inclure arrivent en RawBlock html : le contenu
-- est déjà du HTML, on ne le relit pas — on l'entoure de deux RawBlock, ce qui laisse les
-- octets du tableau exactement tels qu'ils étaient. Le test cherche une balise ouvrante
-- <table, et non la chaîne « table », pour ne pas envelopper un bloc qui ne fait que la
-- mentionner.
function RawBlock(b)
  if b.format ~= 'html' and b.format ~= 'html5' then return nil end
  if not b.text:lower():find('<table') then return nil end
  return {
    pandoc.RawBlock('html', '<div class="' .. CLASSE .. '">'),
    b,
    pandoc.RawBlock('html', '</div>'),
  }
end
