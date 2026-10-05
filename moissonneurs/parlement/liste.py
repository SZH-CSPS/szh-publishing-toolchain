"""Liste mensuelle des interventions retenues ou à relire, en Markdown.

Ordre du PDF de Pronto : Confédération, puis cantons par ordre alphabétique, puis titre ; dans chaque
groupe l'éducation passe en tête. Chaque publication porte « Source : OpenParlData.ch ».
"""
import os

from . import correspondances as corr

NOMS_CANTONS = {
    'CH': 'Confédération', 'AG': 'Argovie', 'AI': 'Appenzell Rhodes-Intérieures', 'AR': 'Appenzell Rhodes-Extérieures',
    'BE': 'Berne', 'BL': 'Bâle-Campagne', 'BS': 'Bâle-Ville', 'FR': 'Fribourg', 'GE': 'Genève', 'GL': 'Glaris',
    'GR': 'Grisons', 'JU': 'Jura', 'LU': 'Lucerne', 'NE': 'Neuchâtel', 'NW': 'Nidwald', 'OW': 'Obwald',
    'SG': 'Saint-Gall', 'SH': 'Schaffhouse', 'SO': 'Soleure', 'SZ': 'Schwytz', 'TG': 'Thurgovie', 'TI': 'Tessin',
    'UR': 'Uri', 'VD': 'Vaud', 'VS': 'Valais', 'ZG': 'Zoug', 'ZH': 'Zurich',
}
ATTRIBUTION = 'Source : OpenParlData.ch (CC BY 4.0).'


def _cle_tri(e):
    canton = e['canton']
    return (0 if canton == 'CH' else 1, canton, 0 if e['education'] else 1, e['titre'].lower())


def entrees(config, base, mois, verdicts=('retenu', 'a-relire')):
    """Lignes de la liste du mois `AAAA-MM` (date de dépôt), depuis la base seulement."""
    sortie = []
    marques = ','.join('?' * len(verdicts))
    for r in base.c.execute(
            f"""SELECT a.*, v.verdict, v.domaine, v.raison FROM verdicts v JOIN affaires a
                ON a.body_key=v.body_key AND a.external_id=v.external_id WHERE v.verdict IN ({marques})""",
            verdicts):
        if mois and not (r['date_depot'] or '').startswith(mois):
            continue
        sortie.append({'canton': corr.canton_de(r['body_key'], config) or r['body_key'], 'titre': r['title'] or '',
                       'numero': r['number'] or '', 'date': r['date_depot'] or '', 'verdict': r['verdict'],
                       'domaine': r['domaine'] or '', 'raison': r['raison'] or '',
                       'lien': r['url_oparl'] or r['url_externe'] or '', 'education': r['domaine'] == 'education'})
    return sorted(sortie, key=_cle_tri)


def rendre(config, lignes, mois):
    sortie = [f'# Interventions parlementaires {mois or "(toutes dates)"}', '',
              f'{len(lignes)} affaire(s) : '
              f"{sum(1 for e in lignes if e['verdict'] == 'retenu')} retenue(s), "
              f"{sum(1 for e in lignes if e['verdict'] == 'a-relire')} à relire. {ATTRIBUTION}", '']
    courant = None
    for e in lignes:
        if e['canton'] != courant:
            courant = e['canton']
            sortie += [f"## {NOMS_CANTONS.get(courant, courant)} ({courant})", '']
        titre = f"[{e['titre']}]({e['lien']})" if e['lien'] else e['titre']
        marque = '' if e['verdict'] == 'retenu' else ' — à relire'
        sortie.append(f"- {e['numero']} · {e['date']} · {titre}{marque}")
        sortie.append(f"  - domaine : {e['domaine'] or 'non classé'} ; {e['raison']}")
    return '\n'.join(sortie) + '\n'


def ecrire(config, base, mois, dossier=None):
    """Écrit liste-AAAA-MM.md dans le dossier de sortie. Rend (chemin, nombre de lignes)."""
    dossier = dossier or config['sortie']['dossier']
    os.makedirs(dossier, exist_ok=True)
    lignes = entrees(config, base, mois)
    chemin = os.path.join(dossier, f'liste-{mois or "toutes"}.md')
    with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
        f.write(rendre(config, lignes, mois))
    return chemin, len(lignes)
