"""Créneau de moisson et budget du mois, partagés entre postes dans `_Moissons/`.

Le créneau est une courtoisie sans garantie d’exclusion : avec un retard de synchronisation plus long que l'attente, deux
passes peuvent se croiser. Les lots et l'état sont idempotents ; la marge borne le seul vrai risque, le budget.
"""
import datetime
import json
import os
import time

import partage

FORMAT = 'pronto-creneau/1'
FORMAT_REQUETES = 'pronto-requetes/1'
DOSSIER = '_Creneau'
PERIME_S = 15 * 60
BATTEMENT_S = 60
ATTENTE_S = 90
ECHEANCE_MIN_S = 30 * 60
ECHEANCE_MAX_S = 6 * 3600
MARGE_REQUETES = 50  # provisoire : à chiffrer après la mesure de latence entre deux postes


def maintenant_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def iso(dt):
    return dt.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def lire_iso(texte):
    return datetime.datetime.strptime(texte, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)


def mois_de(dt):
    return dt.astimezone(datetime.timezone.utc).strftime('%Y-%m')


normaliser, cle = partage.normaliser, partage.cle_poste


def ecrire_json_atomique(chemin, contenu):
    """`.tmp` puis renommage sur le même nom : un lecteur ne voit jamais un fichier à moitié écrit."""
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(contenu, f, ensure_ascii=False)
        f.write('\n')
    os.replace(tmp, chemin)


def _lire_json(chemin):
    try:
        with open(chemin, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


class DossierCreneau:
    """`_Moissons/_Creneau/` sur disque. Les tests le remplacent par un partage simulé."""

    def __init__(self, chemin):
        self.chemin = chemin

    def lister(self):
        try:
            noms = os.listdir(self.chemin)
        except FileNotFoundError:
            return {}
        return {n: _lire_json(os.path.join(self.chemin, n)) for n in noms if n.endswith('.json')}

    def ecrire(self, nom, contenu):
        ecrire_json_atomique(os.path.join(self.chemin, nom), contenu)

    def retirer(self, nom):
        try:
            os.remove(os.path.join(self.chemin, nom))
        except FileNotFoundError:
            pass


class Occupe(Exception):
    """Une autre passe tient le créneau ; `autre` est son annonce."""

    def __init__(self, autre):
        super().__init__(f"créneau tenu par {autre.get('poste')} ({autre.get('compte')})")
        self.autre = autre


def perimee(annonce, maintenant):
    try:
        battement = lire_iso(annonce['battement'])
        echeance = lire_iso(annonce['echeance'])
    except (KeyError, TypeError, ValueError):
        return True
    return (maintenant - battement).total_seconds() > PERIME_S or maintenant > echeance


def _ordre(nom, annonce):
    return (annonce.get('debut') or '', nom)


class Creneau:
    def __init__(self, dossier, poste, compte, declencheur, moissonneurs, duree_estimee_s=None,
                 horloge=maintenant_utc, attendre=time.sleep, attente_s=ATTENTE_S, signaler=None):
        self.dossier = dossier
        self.nom = cle(poste, compte) + '.json'
        self.poste, self.compte = poste, compte
        self.declencheur, self.moissonneurs = declencheur, list(moissonneurs)
        self.duree = duree_estimee_s
        self.horloge, self.attendre, self.attente_s = horloge, attendre, attente_s
        self.signaler = signaler or (lambda etat, annonce: None)
        self.annonce = None
        self._signalees = set()

    def _vivantes(self):
        """Les annonces vivantes des autres, et la nôtre si une autre passe du même poste la tient déjà."""
        maintenant = self.horloge()
        vivantes = {}
        for nom, annonce in self.dossier.lister().items():
            if not isinstance(annonce, dict) or annonce.get('format') != FORMAT:
                continue
            if self.annonce is not None and nom == self.nom:
                continue
            if perimee(annonce, maintenant):
                if nom not in self._signalees:
                    self._signalees.add(nom)
                    self.signaler('repris-perime', annonce)
                continue
            vivantes[nom] = annonce
        return vivantes

    def prendre(self):
        vivantes = self._vivantes()
        if vivantes:
            raise Occupe(vivantes[min(vivantes, key=lambda n: _ordre(n, vivantes[n]))])
        debut = self.horloge()
        duree = ECHEANCE_MAX_S if self.duree is None else min(max(self.duree * 1.5, ECHEANCE_MIN_S), ECHEANCE_MAX_S)
        self.annonce = {'format': FORMAT, 'poste': self.poste, 'compte': self.compte, 'debut': iso(debut),
                        'echeance': iso(debut + datetime.timedelta(seconds=duree)), 'battement': iso(debut),
                        'declencheur': self.declencheur, 'moissonneurs': self.moissonneurs}
        self.dossier.ecrire(self.nom, self.annonce)
        self.attendre(self.attente_s)
        vivantes = self._vivantes()
        if vivantes:
            vivantes[self.nom] = self.annonce
            gagnant = min(vivantes, key=lambda n: _ordre(n, vivantes[n]))
            if gagnant != self.nom:
                self.retirer()
                raise Occupe(vivantes[gagnant])
        self.signaler('pris', self.annonce)
        return self.annonce

    def battre(self):
        """Réécrit l'annonce en place : un seul fichier par poste, quel que soit le nombre de battements."""
        if self.annonce is not None:
            self.annonce['battement'] = iso(self.horloge())
            self.dossier.ecrire(self.nom, self.annonce)

    def retirer(self):
        if self.annonce is not None:
            self.dossier.retirer(self.nom)
            annonce, self.annonce = self.annonce, None
            return annonce
        return None


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
        c = _lire_json(os.path.join(d, n))
        n_req = c.get('requetes') if isinstance(c, dict) else None
        if not isinstance(n_req, int) or isinstance(n_req, bool) or n_req < 0:
            continue
        somme += n_req
        if n == ma_cle + '.json':
            propre = n_req
    return somme, propre


def epuise(budget, somme, marge=MARGE_REQUETES):
    """Plus aucune requête permise : à budget − marge tout juste, le plafond de la passe vaut déjà 0."""
    return budget is not None and somme >= budget - marge


def plafond_local(budget, somme, marge=MARGE_REQUETES):
    return None if budget is None else max(budget - marge - somme, 0)


def ecrire_requetes(moissons, m, mois, ma_cle, requetes, maintenant):
    """Le compteur de CE poste : chaque poste n'écrit que le sien."""
    ecrire_json_atomique(os.path.join(dossier_requetes(moissons, m, mois), ma_cle + '.json'),
                         {'format': FORMAT_REQUETES, 'mois': mois, 'requetes': requetes, 'maj': iso(maintenant)})
