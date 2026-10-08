# Vérifie la largeur des colonnes de tableau : rend deux tableaux avec les feuilles du
# dépôt (socle, print, partage-filtres) et juge les boîtes mises en page par WeasyPrint.
#
#   /opt/weasyprint/bin/python3 test/tableaux-largeurs-check.py
#   (dans la WSL SZH-Publishing ; en CI : "$RUNNER_TEMP/weasyprint/bin/python")
#
# Ce qui est vérifié (règles des cellules dans print.css) :
#   1. une étiquette courte ne se coupe pas : « Punkte » et « Hilfe » restent entiers,
#      dans un tableau importé comme dans un tableau de l'éditeur (.szh-tableau) ;
#   2. un tableau de 9 colonnes allemandes courtes tient dans la page : la césure des
#      mots composés doit rester permise.
# Le tableau d'étiquettes reprend, réduit, celui d'un article de 2025 (Hilfenhierarchie).
import os
import sys

from weasyprint import CSS, HTML

# SZH_STYLES : une autre copie des feuilles, pour tester le contrôle sur un autre réglage.
STYLES = os.environ.get('SZH_STYLES') or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'pipeline', 'styles')
FEUILLES = ['socle.css', 'print.css', 'partage-filtres.css']

DESCRIPTIONS = [
    'Ermutigen: «Versuch es nochmal, du schaffst es.»',
    'Frage evozieren und wiederholen: «Soll ich es nochmal sagen? Dann kannst du mich '
    'fragen.» Abwarten: «Gut, dass du mich fragst, ich sage es dir nochmal: Pafiku.»',
    'Silbensprechen und erläutern: «Wenn es schwierig ist, dann können wir das Wort in '
    'Teile zerlegen: Pa fi ku. Probier mal.»',
]


def etiquettes(classe):
    corps = ''.join(f'<tr><th scope="row">Hilfe</th><td>{d}</td><td>{i}</td></tr>'
                    for i, d in enumerate(DESCRIPTIONS))
    return (f'<table{classe}><thead><tr><td></td><th scope="col">Beschreibung</th>'
            f'<th scope="col">Punkte</th></tr></thead><tbody>{corps}</tbody></table>')


ENTETES_9 = ['Kanton', 'Schuljahr', 'Lernende', 'Lehrpersonen', 'Heilpädagogik',
             'Sonderschule', 'Integrationsquote', 'Veränderung', 'Total']
VALEURS_9 = ['Graubünden', '2024/25', '12 345', '1 234', '567', '89', '12,5 %', '+0,4 %',
             '14 235']


def neuf_colonnes(classe):
    corps = ('<tr>' + ''.join(f'<td>{v}</td>' for v in VALEURS_9) + '</tr>') * 3
    return (f'<table{classe}><thead><tr>'
            + ''.join(f'<th scope="col">{h}</th>' for h in ENTETES_9)
            + f'</tr></thead><tbody>{corps}</tbody></table>')


def rendre(table):
    html = ('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title>'
            f'</head><body><div class="szh-tableau-boite">{table}</div></body></html>')
    feuilles = [CSS(os.path.join(STYLES, f)) for f in FEUILLES]
    return HTML(string=html, base_url=STYLES + os.sep).render(stylesheets=feuilles)


def boites(b):
    yield b
    for c in getattr(b, 'children', []):
        yield from boites(c)


def lignes_des_cellules(doc):
    """{ texte entier de la cellule : [texte de chaque ligne] }."""
    cellules = {}
    for page in doc.pages:
        for b in boites(page._page_box):
            if type(b).__name__ != 'TableCellBox':
                continue
            lignes = [''.join(getattr(t, 'text', '') for t in boites(l))
                      for l in boites(b) if type(l).__name__ == 'LineBox']
            cellules.setdefault(''.join(lignes), lignes)
    return cellules


def table_et_conteneur(doc):
    """La table et la largeur de sa boîte (.szh-tableau-boite), en px."""
    for page in doc.pages:
        for b in boites(page._page_box):
            if getattr(b, 'element_tag', None) == 'div':
                for t in boites(b):
                    if type(t).__name__ == 'TableBox':
                        return t, b.width
    sys.exit('aucun tableau mis en page')


def main():
    erreurs = []
    for nom, classe in (('importé', ''), ('éditeur', ' class="szh-tableau"')):
        cellules = lignes_des_cellules(rendre(etiquettes(classe)))
        for mot in ('Punkte', 'Hilfe'):
            coupe = [l for t, l in cellules.items() if len(l) > 1 and t.replace('‐', '')
                     .replace('-', '') == mot]
            if coupe:
                erreurs.append(f'{nom} : « {mot} » coupé en {coupe[0]}')
        table, dispo = table_et_conteneur(rendre(neuf_colonnes(classe)))
        somme = sum(table.column_widths)
        if somme > dispo + 1:
            erreurs.append(f'{nom} : 9 colonnes = {somme:.1f} px pour {dispo:.1f} disponibles')
        print(f'{nom} : 9 colonnes = {somme:.1f} / {dispo:.1f} px')
    for e in erreurs:
        print('ÉCHEC ' + e)
    if erreurs:
        return 1
    print('largeurs de tableau : tout passe')
    return 0


if __name__ == '__main__':
    sys.exit(main())
