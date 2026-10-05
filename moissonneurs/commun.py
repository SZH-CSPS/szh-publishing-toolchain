"""Ce que les moissonneurs font de la même façon : écriture atomique, lot, etat.json, décisions, purge, masque des noms.

Les règles sont dans docs/FORMAT-PROPOSITIONS.md ; chaque moissonneur n'y ajoute que ses chemins et son préfixe de clé.
"""
import datetime
import hashlib
import json
import os
import re

# --------------------------------------------------------------------------- écriture atomique


def ecrire_json_atomique(chemin, contenu, compact=False, indent=None):
    """`.tmp` puis renommage sur le même nom : un lecteur ne voit jamais un fichier à moitié écrit."""
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(contenu, f, ensure_ascii=False, indent=indent, separators=(',', ':') if compact else None)
        f.write('\n')
    os.replace(tmp, chemin)


def ecrire_lignes_atomique(chemin, lignes, compact=False, exclusif=False):
    """Une ligne JSON par objet, écrites d'un coup. `exclusif` : le `.tmp` ne doit pas déjà exister."""
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + '.tmp'
    with open(tmp, 'x' if exclusif else 'w', encoding='utf-8', newline='\n') as f:
        for ligne in lignes:
            f.write(json.dumps(ligne, ensure_ascii=False, separators=(',', ':') if compact else None) + '\n')
    os.replace(tmp, chemin)


# --------------------------------------------------------------------------- lot et etat.json

def nom_lot(dossier, jour, connus=()):
    """Le numéro suit le plus grand du jour, sur le disque ou en base : un lot supprimé ne rend pas son numéro, sinon
    le suivant passerait avant un lot plus ancien."""
    motif = re.compile(re.escape(jour) + r'-(\d+)\.jsonl(\.tmp)?$')
    presents = os.listdir(dossier) if os.path.isdir(dossier) else []
    numeros = [int(m.group(1)) for m in map(motif.match, presents + list(connus)) if m]
    return os.path.join(dossier, f'{jour}-{max(numeros, default=0) + 1}.jsonl')


def ecrire_lot(dossier, jour, lignes, connus=()):
    """Écrit le lot sous un nom temporaire, puis le renomme. `connus` : noms de lots déjà notés en base. Rend son
    chemin."""
    os.makedirs(dossier, exist_ok=True)
    chemin = nom_lot(dossier, jour, connus)
    ecrire_lignes_atomique(chemin, lignes, exclusif=True)
    return chemin


def ecrire_etat(dossier, contenu):
    """`etat.json` (`pronto-etat/1`) à côté des lots, écrit d'un coup. Rend son chemin."""
    if not str(dossier or '').strip():
        raise OSError('dossier des propositions vide')
    chemin = os.path.join(dossier, 'etat.json')
    ecrire_json_atomique(chemin, contenu, indent=2)
    return chemin


# --------------------------------------------------------------------------- noms

def masque(seq):
    """« Anna Beispiel » devient « A*** B*** » : jamais un nom en clair dans un message."""
    return ' '.join(w[0] + '***' if w[:1].isupper() else w for w in seq.split())


# --------------------------------------------------------------------------- fichiers Kirby

SEPARATEUR = '----'


def lire_txt(texte):
    """Champs d'un fichier .txt Kirby : {cle-minuscule: valeur}, title et uuid compris. Lecture seule."""
    champs = {}
    for morceau in texte.replace('\r\n', '\n').rstrip('\n').split('\n\n' + SEPARATEUR + '\n\n'):
        premiere, _, reste = morceau.partition('\n')
        m = re.match(r'^([A-Za-z0-9_]+):[ \t]?(.*)$', premiere)
        if not m:
            continue
        if '\n' not in morceau:
            valeur = m.group(2)
        elif m.group(2).strip() == '':
            valeur = reste[1:] if reste.startswith('\n') else reste
        else:
            valeur = m.group(2) + '\n' + reste
        champs[m.group(1).lower()] = '\n'.join(SEPARATEUR if l == '\\' + SEPARATEUR else l for l in valeur.split('\n'))
    return champs


# --------------------------------------------------------------------------- décisions de la rédaction

DECISIONS = ('accepte', 'refuse')
MOTIFS = ('hors-sujet', 'doublon', 'autre')


def empreinte_cle(cle):
    """Nom du fichier de décision : les 16 premiers caractères hexadécimaux du SHA-256 de la `cle`."""
    return hashlib.sha256(cle.encode('utf-8')).hexdigest()[:16]


def lire_decisions(dossier):
    """{cle: {'decision', 'motif', 'fiche', 'date'}}. Un fichier illisible, sans `Cle` ou à décision inconnue est
    ignoré ; un motif inconnu se lit `autre`. Les liens symboliques ne sont pas suivis."""
    sortie = {}
    if not dossier or not os.path.isdir(dossier):
        return sortie
    for racine, _, noms in os.walk(dossier):
        for nom in sorted(noms):
            chemin = os.path.join(racine, nom)
            if not nom.endswith('.txt') or os.path.islink(chemin):
                continue
            try:
                with open(chemin, encoding='utf-8-sig') as f:
                    c = lire_txt(f.read())
            except (OSError, UnicodeDecodeError):
                continue
            cle, decision = (c.get('cle') or '').strip(), (c.get('decision') or '').strip().lower()
            if not cle or '\n' in cle or decision not in DECISIONS:
                continue
            motif = (c.get('motif') or '').strip().lower() if decision == 'refuse' else ''
            if motif and motif not in MOTIFS:
                motif = 'autre'
            sortie[cle] = {'decision': decision, 'motif': motif, 'fiche': (c.get('fiche') or '').strip(),
                           'date': (c.get('date') or '').strip()}
    return sortie


def appliquer_decisions(dossier, con):
    """Reporte les décisions lues dans la table `decisions` de `con` et rend l'ensemble des `cle` décidées.

    Une décision dont le fichier a été purgé (`purgee = 1`) reste décidée. Une décision dont le fichier a disparu sans
    purge (« Annuler » dans le cockpit) est oubliée : l'objet redevient proposable."""
    lues = lire_decisions(dossier)
    maintenant = datetime.datetime.now().isoformat(timespec='seconds')
    for cle, d in lues.items():
        con.execute('INSERT OR REPLACE INTO decisions(cle, decision, motif, fiche, date, lue_le, purgee) '
                    'VALUES (?,?,?,?,?,?,0)', (cle, d['decision'], d['motif'], d['fiche'], d['date'], maintenant))
    for (cle,) in con.execute('SELECT cle FROM decisions WHERE purgee = 0').fetchall():
        if cle not in lues:
            con.execute('DELETE FROM decisions WHERE cle = ?', (cle,))
    con.commit()
    return set(lues) | {r[0] for r in con.execute('SELECT cle FROM decisions WHERE purgee = 1')}


def bilan_decisions(con):
    """{'accepte': n, 'refuse': n, 'motifs': {motif: n}} : de quoi mesurer la précision du filtre."""
    res = {'accepte': 0, 'refuse': 0, 'motifs': {}}
    for decision, motif, n in con.execute('SELECT decision, motif, COUNT(*) FROM decisions GROUP BY decision, motif'):
        res[decision] += n
        if motif:
            res['motifs'][motif] = n
    return res


# --------------------------------------------------------------------------- purge à six mois

MOIS = 6
RE_LOT = re.compile(r'^(\d{4}-\d{2}-\d{2})-\d+\.jsonl$')


def moins_mois(jour, n):
    """`jour` (date) reculé de n mois civils, jour ramené à la fin du mois si besoin."""
    m = jour.month - 1 - n
    annee, mois = jour.year + m // 12, m % 12 + 1
    for j in (jour.day, 30, 29, 28):
        try:
            return datetime.date(annee, mois, j)
        except ValueError:
            continue
    return datetime.date(annee, mois, 28)


def _date_iso(texte):
    """date | None pour 'AAAA-MM-JJ' (heure éventuelle ignorée)."""
    m = re.match(r'^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$', str(texte or '').strip())
    if not m:
        return None
    try:
        return datetime.date.fromisoformat(m.group(1))
    except ValueError:
        return None


def _date_du_lot(chemin, nom):
    """Le jour du nom AAAA-MM-JJ-<n>, à défaut `recolte` de la première ligne ; jamais le mtime, qu'OneDrive réécrit."""
    m = RE_LOT.match(nom)
    if m:
        d = _date_iso(m.group(1))
        if d:
            return d
    try:
        with open(chemin, encoding='utf-8') as f:
            for ligne in f:
                if ligne.strip():
                    return _date_iso(json.loads(ligne).get('recolte'))
    except (OSError, ValueError, AttributeError, UnicodeDecodeError):
        pass
    return None


def _dans(dossier_reel, chemin):
    """Vrai si `chemin` est un fichier régulier, pas un lien, dont le chemin réel est sous `dossier_reel`."""
    if os.path.islink(chemin) or not os.path.isfile(chemin):
        return False
    return os.path.realpath(chemin).startswith(dossier_reel + os.sep)


def _supprimer(dossier_reel, chemin, echecs, a_blanc=False):
    if not _dans(dossier_reel, chemin):
        return False
    if a_blanc:
        return True
    try:
        os.remove(chemin)
        return True
    except OSError as e:
        echecs.append((chemin, f'{type(e).__name__}: {e}'))
        return False


def _dossier_sur(dossier):
    """Le dossier existe et n'est pas lui-même un lien : la purge n'efface que dans le dossier configuré."""
    return bool(dossier) and os.path.isdir(dossier) and not os.path.islink(dossier)


def purger(lots, decisions, prefixe, con, aujourdhui=None, mois=MOIS, a_blanc=False):
    """Purge à `mois` mois les lots du dossier `lots` et les décisions de `decisions` dont la `cle` commence par
    `prefixe`. Rend {'lots': [noms], 'decisions': [empreintes], 'echecs': [(chemin, raison)]} ; ne lève pas pour un
    fichier récalcitrant.

    Une date absente ou illisible ne fait jamais effacer ; une décision ne se purge que si `con` l'a déjà reportée.
    `a_blanc` : rien n'est effacé ni noté en base ; les listes disent ce qui l'aurait été."""
    jour = _date_iso(aujourdhui) if aujourdhui else datetime.date.today()
    limite = moins_mois(jour, mois)
    echecs, faits, decs = [], [], []

    if _dossier_sur(lots):
        reel = os.path.realpath(lots)
        for nom in sorted(os.listdir(lots)):
            chemin = os.path.join(lots, nom)
            if not nom.endswith('.jsonl') or not _dans(reel, chemin):
                continue
            d = _date_du_lot(chemin, nom)
            if d is not None and d < limite and _supprimer(reel, chemin, echecs, a_blanc):
                faits.append(nom)

    if _dossier_sur(decisions):
        reel = os.path.realpath(decisions)
        for racine, _, noms in os.walk(decisions, followlinks=False):
            for nom in sorted(noms):
                chemin = os.path.join(racine, nom)
                if not nom.endswith('.txt') or os.path.islink(chemin):
                    continue
                try:
                    with open(chemin, encoding='utf-8-sig') as f:
                        c = lire_txt(f.read())
                except (OSError, UnicodeDecodeError):
                    continue
                cle = (c.get('cle') or '').strip()
                date = (c.get('date') or '').strip()
                d = _date_iso(date) if re.match(r'^\d{4}-\d{2}-\d{2}$', date) else None
                if not cle.startswith(prefixe) or d is None or d >= limite:
                    continue
                if not con.execute('SELECT 1 FROM decisions WHERE cle = ? AND purgee = 0', (cle,)).fetchone():
                    continue          # pas encore reportée en base : jamais effacée
                if _supprimer(reel, chemin, echecs, a_blanc):
                    if not a_blanc:
                        con.execute('UPDATE decisions SET purgee = 1 WHERE cle = ?', (cle,))
                    decs.append(empreinte_cle(cle))
        con.commit()
    return {'lots': faits, 'decisions': decs, 'echecs': echecs}
