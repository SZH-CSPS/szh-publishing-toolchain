"""État partagé d'un moissonneur dans `_Moissons/<m>/_partage/` : un socle, un journal par poste, fusionnés à la lecture.

Le format est décrit dans docs/FORMAT-MOISSONS.md. Chaque fichier n'a qu'un écrivain : le socle, le poste de
développement sous créneau ; un journal ou un compteur, son poste. La fusion ne dépend pas de l'ordre de lecture.
"""
import datetime
import glob
import json
import os
import re
import unicodedata

SOCLE = 'socle.json'
FORMAT_SOCLE = 'pronto-socle/1'
FORMAT_JOURNAL = 'pronto-journal/1'
FORMAT_REQUETES = 'pronto-requetes/1'
# Posée par moisson.py pour chaque moissonneur qu'il lance : une passe mensuelle n'écrit jamais le socle.
VARIABLE_PASSE = 'PRONTO_MOISSON_PASSE'
FUSIONS = ('rang', 'max', 'union')


class EtatAbsent(Exception):
    """L'état partagé n'est pas disponible : rien ne part."""


class SocleInterdit(Exception):
    """Écriture du socle refusée : passe mensuelle, ou créneau non tenu."""


def dossier(racine, m):
    return os.path.join(racine, '_Moissons', m, '_partage')


def maintenant_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def normaliser(nom):
    """Minuscules sans accents ; tout ce qui n'est ni lettre, ni chiffre, ni `.` ni `_` devient `-`."""
    nom = unicodedata.normalize('NFKD', str(nom)).encode('ascii', 'ignore').decode().lower().strip()
    return re.sub(r'[^a-z0-9._]+', '-', nom).strip('-') or '-'


def cle_poste(poste, compte):
    """`poste__compte` : le nom des fichiers qu'un seul poste écrit (créneau, compteur, journal)."""
    return f'{normaliser(poste)}__{normaliser(compte)}'


# --------------------------------------------------------------------------- écriture et lecture

def ecrire_json_atomique(chemin, contenu, compact=False):
    """`.tmp` puis renommage sur le même nom : un lecteur ne voit jamais un fichier à moitié écrit."""
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(contenu, f, ensure_ascii=False, separators=(',', ':') if compact else None)
        f.write('\n')
    os.replace(tmp, chemin)


def _ecrire_lignes_atomique(chemin, lignes):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        for ligne in lignes:
            f.write(json.dumps(ligne, ensure_ascii=False, separators=(',', ':')) + '\n')
    os.replace(tmp, chemin)


def lire_json(chemin):
    try:
        with open(chemin, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# --------------------------------------------------------------------------- schéma et fusion

def _schema_table(schema, table):
    regle = dict(schema.get(table) or {})
    if 'cle' not in regle:
        raise ValueError(f'table {table} : clé absente du schéma')
    regle['cle'] = tuple(regle['cle'])
    regle.setdefault('fusion', 'rang')
    if regle['fusion'] not in FUSIONS:
        raise ValueError(f"table {table} : fusion inconnue {regle['fusion']}")
    return regle


def _fonction_rang(rang):
    """Le rang d'une ligne : `{champ, valeurs: {valeur: rang}, defaut}` (une valeur se compare en texte), 0 sans règle."""
    if not rang:
        return lambda ligne: 0
    champ, valeurs, defaut = rang['champ'], rang.get('valeurs') or {}, int(rang.get('defaut', 0))
    return lambda ligne: int(valeurs.get(str(ligne.get(champ)), defaut))


def cle_de(regle, ligne):
    """La clé d'une ligne, en liste de chaînes : la même forme dans le socle et dans les journaux."""
    return [str(ligne.get(c, '')) for c in regle['cle']]


def _texte_cle(cle):
    return json.dumps([str(c) for c in cle], ensure_ascii=False)


def _canonique(ligne):
    return '' if ligne is None else json.dumps(ligne, ensure_ascii=False, sort_keys=True)


def _plus_grand(a, b):
    """Le plus grand de deux valeurs, None le plus petit ; deux types différents se comparent par leur JSON."""
    if a is None:
        return b
    if b is None:
        return a
    try:
        return a if a >= b else b
    except TypeError:
        return a if _canonique(a) >= _canonique(b) else b


def _fusion_champs(lignes, union):
    """Champ par champ : le plus grand ; en `union`, un dict ou une liste se réunissent."""
    sortie = {}
    for ligne in lignes:
        for k, v in ligne.items():
            if k not in sortie:
                sortie[k] = json.loads(json.dumps(v))
            elif union and isinstance(v, dict) and isinstance(sortie[k], dict):
                for kk, vv in v.items():
                    sortie[k][kk] = _plus_grand(sortie[k].get(kk), vv)
            elif union and isinstance(v, list) and isinstance(sortie[k], list):
                sortie[k] = sorted({_canonique(x): x for x in sortie[k] + v}.values(), key=_canonique)
            else:
                sortie[k] = _plus_grand(sortie[k], v)
    return sortie


def fusionner(socle, journaux, schema):
    """{table: {texte de clé: ligne}} : le socle, puis chaque journal au-delà de ce que le socle a absorbé.

    Pour une même clé, en fusion `rang` : le rang le plus fort, puis une ligne de journal plutôt que le socle, puis
    l'heure, puis le nom du journal et le numéro de ligne (deux lignes d'une même seconde gardent leur ordre), puis le
    texte de la ligne. Un retrait a le rang `rang_retrait` (0 par défaut). Le résultat ne dépend ni de l'ordre de
    lecture des journaux ni d'une ligne lue deux fois."""
    absorbes = (socle or {}).get('absorbes') or {}
    evenements = {}       # (table, clé) -> [(origine, heure, journal, numéro, ligne)]
    for table, lignes in ((socle or {}).get('tables') or {}).items():
        if table not in schema:
            continue
        regle = _schema_table(schema, table)
        for ligne in lignes:
            if isinstance(ligne, dict):
                evenements.setdefault((table, _texte_cle(cle_de(regle, ligne))), []).append((0, '', '', 0, ligne))
    for nom, lignes in journaux.items():
        deja = int(absorbes.get(nom, 0) or 0)
        for l in lignes:
            if not isinstance(l, dict) or l.get('t') not in schema or not isinstance(l.get('n'), int):
                continue
            if l['n'] <= deja:
                continue
            ligne = l.get('r')
            if ligne is not None and not isinstance(ligne, dict):
                continue
            evenements.setdefault((l['t'], _texte_cle(l.get('k') or [])), []).append((1, str(l.get('maj') or ''), nom, l['n'], ligne))
    etat = {t: {} for t in schema}
    for (table, cle), evts in evenements.items():
        regle = _schema_table(schema, table)
        if regle['fusion'] in ('max', 'union'):
            vivantes = [e[4] for e in evts if e[4] is not None]
            if vivantes:
                etat[table][cle] = _fusion_champs(vivantes, regle['fusion'] == 'union')
            continue
        rang = _fonction_rang(regle.get('rang'))
        retrait = int(regle.get('rang_retrait', 0))
        gagnant = max(evts, key=lambda e: (rang(e[4]) if e[4] is not None else retrait, e[:4], _canonique(e[4])))
        if gagnant[4] is not None:
            etat[table][cle] = gagnant[4]
    return etat


# --------------------------------------------------------------------------- socle et journaux

def chemin_journal(racine, m, poste):
    return os.path.join(dossier(racine, m), 'journal', poste + '.jsonl')


def etat_present(racine, m):
    """Vrai si un socle de `m` a été publié depuis le poste de développement."""
    return bool(_socles(racine, m))


def _socles(racine, m):
    d = dossier(racine, m)
    return sorted(c for c in glob.glob(os.path.join(glob.escape(d), 'socle*.json')) if os.path.isfile(c))


def lire_socle(racine, m):
    """Le socle le plus récent (une copie en conflit d'OneDrive compte comme un socle). Lève EtatAbsent."""
    meilleur = None
    for chemin in _socles(racine, m):
        s = lire_json(chemin)
        if not isinstance(s, dict) or s.get('format') != FORMAT_SOCLE or s.get('moissonneur') != m:
            continue
        if meilleur is None or (str(s.get('publie_le') or ''), chemin) > (str(meilleur.get('publie_le') or ''),
                                                                          meilleur['_chemin']):
            meilleur = dict(s, _chemin=chemin)
    if meilleur is None:
        raise EtatAbsent(f'aucun socle lisible pour {m} : le publier depuis le poste de développement')
    meilleur.pop('_chemin')
    return meilleur


def lire_journal(chemin):
    """Les lignes d'un journal ; une ligne illisible est sautée, jamais le journal."""
    lignes = []
    try:
        with open(chemin, encoding='utf-8') as f:
            for texte in f:
                try:
                    l = json.loads(texte)
                except ValueError:
                    continue
                if isinstance(l, dict) and 'n' in l:
                    lignes.append(l)
    except OSError:
        pass
    return lignes


def lire_journaux(racine, m):
    d = os.path.join(dossier(racine, m), 'journal')
    try:
        noms = sorted(n for n in os.listdir(d) if n.endswith('.jsonl'))
    except FileNotFoundError:
        return {}
    return {n[:-len('.jsonl')]: lire_journal(os.path.join(d, n)) for n in noms}


def charger(racine, m, schema):
    """(état fusionné {table: {clé: ligne}}, socle lu, journaux lus). Lève EtatAbsent."""
    socle = lire_socle(racine, m)
    journaux = lire_journaux(racine, m)
    return fusionner(socle, journaux, schema), socle, journaux


def charger_etat(racine, m, schema):
    """{table: [lignes]} : le socle plus les journaux de tous les postes, fusionnés. Lève EtatAbsent."""
    etat, _, _ = charger(racine, m, schema)
    return {t: list(lignes.values()) for t, lignes in etat.items()}


def publier_journal(racine, m, poste, delta, schema, maintenant=None):
    """Ajoute `delta` ({table: [lignes]}, plus {'retirees': {table: [clés]}}) au seul journal de `poste`.

    Le fichier est réécrit d'un coup ; les lignes que le socle a déjà absorbées en sortent. Rend le nombre de lignes
    ajoutées. Lève EtatAbsent sans socle : un journal ne vaut rien sans lui."""
    socle = lire_socle(racine, m)
    chemin = chemin_journal(racine, m, poste)
    absorbe = int((socle.get('absorbes') or {}).get(poste, 0) or 0)
    anciennes = lire_journal(chemin)
    n = max([absorbe] + [l['n'] for l in anciennes if isinstance(l.get('n'), int)])
    gardees = [l for l in anciennes if isinstance(l.get('n'), int) and l['n'] > absorbe]
    heure = maintenant or maintenant_iso()
    nouvelles = []
    for table, lignes in delta.items():
        if table == 'retirees':
            continue
        regle = _schema_table(schema, table)
        for ligne in lignes:
            n += 1
            nouvelles.append({'n': n, 'maj': heure, 't': table, 'k': cle_de(regle, ligne), 'r': ligne})
    for table, cles in (delta.get('retirees') or {}).items():
        _schema_table(schema, table)
        for cle in cles:
            n += 1
            cle = list(cle) if isinstance(cle, (list, tuple)) else [cle]
            nouvelles.append({'n': n, 'maj': heure, 't': table, 'k': [str(c) for c in cle], 'r': None})
    if not nouvelles and len(gardees) == len(anciennes):
        return 0
    entete = {'format': FORMAT_JOURNAL, 'moissonneur': m, 'poste': poste}
    _ecrire_lignes_atomique(chemin, [entete] + gardees + nouvelles)
    return len(nouvelles)


def publier_socle(racine, m, poste, compte, tables, absorbes, annonce, maintenant=None):
    """Écrit `socle.json` : seulement depuis le poste de développement, sous un créneau qu'il tient.

    `annonce` est l'annonce de créneau prise par ce même poste. Une passe mensuelle (variable posée par moisson.py)
    est toujours refusée."""
    if os.environ.get(VARIABLE_PASSE):
        raise SocleInterdit('une passe mensuelle n’écrit jamais le socle')
    if not isinstance(annonce, dict) or cle_poste(annonce.get('poste', ''), annonce.get('compte', '')) \
            != cle_poste(poste, compte):
        raise SocleInterdit('le socle ne s’écrit que sous le créneau de ce poste')
    contenu = {'format': FORMAT_SOCLE, 'moissonneur': m, 'publie_le': maintenant or maintenant_iso(),
               'poste': poste, 'compte': compte, 'absorbes': dict(sorted(absorbes.items())),
               'tables': {t: lignes for t, lignes in tables.items()}}
    chemin = os.path.join(dossier(racine, m), SOCLE)
    ecrire_json_atomique(chemin, contenu, compact=True)
    return chemin


def absorbes_de(socle, journaux):
    """Pour chaque journal, le plus grand numéro de ligne lu : ce que le prochain socle aura absorbé."""
    sortie = dict((socle or {}).get('absorbes') or {})
    for nom, lignes in journaux.items():
        ns = [l['n'] for l in lignes if isinstance(l.get('n'), int)]
        if ns:
            sortie[nom] = max(max(ns), int(sortie.get(nom, 0) or 0))
    return sortie


# --------------------------------------------------------------------------- budget du mois

def dossier_requetes(moissons, m, mois):
    return os.path.join(moissons, m, '_partage', 'requetes', mois)


def somme_mois(moissons, m, mois, ma_cle):
    """(somme de tous les postes, part de ce poste) pour le mois ; un compteur illisible ne compte pas."""
    d = dossier_requetes(moissons, m, mois)
    try:
        noms = os.listdir(d)
    except FileNotFoundError:
        return 0, 0
    somme = propre = 0
    for n in noms:
        if not n.endswith('.json'):
            continue
        c = lire_json(os.path.join(d, n))
        n_req = c.get('requetes') if isinstance(c, dict) else None
        if not isinstance(n_req, int) or isinstance(n_req, bool) or n_req < 0:
            continue
        somme += n_req
        if n == ma_cle + '.json':
            propre = n_req
    return somme, propre


def ecrire_requetes(moissons, m, mois, ma_cle, requetes, maintenant):
    """Le compteur de CE poste : chaque poste n'écrit que le sien. `maintenant` : datetime UTC."""
    ecrire_json_atomique(os.path.join(dossier_requetes(moissons, m, mois), ma_cle + '.json'),
                         {'format': FORMAT_REQUETES, 'mois': mois, 'requetes': requetes,
                          'maj': maintenant.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')})
