"""Rendu des événements pronto-moisson/1 dans un terminal ; rejoue une passe par `console.py < evenements.jsonl`.

Textes en français seulement : la console sert au seul poste de développement, le cockpit est la surface bilingue.
"""
import json
import math
import sys

NBSP = ' '
LARGEUR_BARRE = 10
LARGEUR_LIBELLE = 12

CODES = {
    0: 'tout s’est bien passé',
    1: 'terminée avec des échecs signalés',
    2: 'configuration invalide',
    3: 'interrompue, le lot partiel est déposé',
    4: 'refusée, une moisson tourne déjà ou le budget du mois est épuisé',
    5: 'erreur inattendue, voir les journaux',
}
REFUS = {
    'deja-en-cours': 'une moisson est déjà en cours',
    'budget-epuise': 'le budget du mois est épuisé',
    'etat-absent': 'l’état partagé est absent',
    'racine-absente': 'le dossier _Moissons est introuvable',
    'config-invalide': 'la commande est incomplète',
}
INTERRUPTIONS = {'budget': 'plafond de requêtes atteint', '403': 'accès refusé (403)', 'arret': 'arrêt demandé'}


def duree(s):
    """Une durée lisible, arrondie vers le haut : c'est une borne."""
    s = int(math.ceil(s))
    if s < 60:
        return f'{s}{NBSP}s'
    minutes = math.ceil(s / 60)
    if minutes < 60:
        return f'{minutes}{NBSP}min'
    h, m = divmod(minutes, 60)
    return f'{h}{NBSP}h{NBSP}{m:02d}'


def barre(fraction):
    pleins = 0 if fraction is None else max(0, min(LARGEUR_BARRE, round(fraction * LARGEUR_BARRE)))
    return '█' * pleins + '░' * (LARGEUR_BARRE - pleins)


def pluriel(n, mot):
    return mot if n < 2 else mot + 's'


def heure_lisible(texte):
    """`2026-11-01T06:00:00Z` → `01.11.2026 à 06 h 00 UTC`."""
    try:
        date, heure = texte.rstrip('Z').split('T')
        a, mo, j = date.split('-')
        h, mi = heure.split(':')[:2]
        return f'{j}.{mo}.{a} à {h}{NBSP}h{NBSP}{mi} UTC'
    except ValueError:
        return texte


class Rendu:
    def __init__(self, sortie, tty=None, entree=None):
        self.sortie = sortie
        self.tty = sortie.isatty() if tty is None else tty
        self.entree = entree if entree is not None else sys.stdin
        self.ouverte = None          # (moissonneur, étape) de la ligne réécrite en place
        self.moissonneur = None
        self.lots, self.fins = {}, {}
        self.code = None

    def _ecrire(self, texte):
        self._fermer()
        self.sortie.write(texte + '\n')
        self.sortie.flush()

    def _fermer(self):
        if self.ouverte is not None:
            self.sortie.write('\n')
            self.ouverte = None

    def recevoir(self, evt):
        f = getattr(self, '_' + str(evt.get('type')), None)
        if f is None:
            self._ecrire(f'  ? {json.dumps(evt, ensure_ascii=False)[:200]}')
        else:
            f(evt)

    def _creneau(self, e):
        qui = f"{e['poste']} ({e['compte']})"
        textes = {'pris': f'Créneau de moisson pris par {qui}.',
                  'refuse': f"Une moisson tourne déjà depuis {qui}, lancée le {heure_lisible(e['debut'])}.",
                  'repris-perime': f'Annonce périmée de {qui} ignorée.',
                  'retire': 'Créneau de moisson rendu.'}
        self._ecrire(textes.get(e['etat'], f"Créneau · {e['etat']} · {qui}"))

    def _debut(self, e):
        noms = ', '.join(e['moissonneurs']) or 'aucun moissonneur'
        self._ecrire(f"Moisson lancée ({e['declencheur']}) · {noms}"
                     + (' · racine de test' if e.get('racine_test') else ''))
        for m in e['moissonneurs']:
            est = e['estimation'].get(m, {})
            bm = e.get('budget_mois', {}).get(m, {})
            morceaux = []
            if est.get('requetes') is not None:
                morceaux.append(f"≤ {est['requetes']} {pluriel(est['requetes'], 'requête')} prévues")
            if bm.get('budget') is not None:
                morceaux.append(f"{bm['somme']}/{bm['budget']} ce mois-ci, plafond de la passe {bm['plafond']}")
            self._ecrire(f"  {m} · {', '.join(morceaux) or 'sans estimation'}")

    def _entete(self, m):
        if m != self.moissonneur:
            self.moissonneur = m
            self._ecrire(m)

    def _etape(self, e):
        self._entete(e['moissonneur'])
        r, b = e['requetes'], e['budget']
        compte = f'{r}/{b} {pluriel(b, "requête")}' if b is not None else f'{r} {pluriel(r, "requête")}'
        ligne = f"  {e['etape']:<{LARGEUR_LIBELLE}} {barre(e['fraction'])}  {compte}"
        if e['reste_s'] is not None:
            ligne += f" · reste ≤ ~{duree(e['reste_s'])}"
        cle = (e['moissonneur'], e['etape'])
        if not self.tty:
            self._ecrire(ligne)
        elif cle == self.ouverte:
            self.sortie.write('\r\x1b[2K' + ligne)
            self.sortie.flush()
        else:
            self._fermer()
            self.sortie.write(ligne)
            self.sortie.flush()
            self.ouverte = cle

    def _attente(self, e):
        self._entete(e['moissonneur'])
        motif = f" ({e['motif']})" if e.get('motif') else ''
        s = e['secondes']
        attente = f'{s}{NBSP}s' if s < 600 else duree(s)
        self._ecrire(f"  {e['etape']} demande d’attendre {attente}{motif}")

    def _avertissement(self, e):
        qui = f"{e['moissonneur']} · " if e.get('moissonneur') else ''
        self._ecrire(f"  ⚠ {qui}{e['message']}")

    def _lot(self, e):
        self.lots[e['moissonneur']] = e
        self._ecrire(f"  Lot déposé · {e['chemin']}, {e['propositions']} "
                     f"{pluriel(e['propositions'], 'proposition')}")

    def _moissonneur_fin(self, e):
        self.fins[e['moissonneur']] = e
        if e['plantage']:
            self._ecrire(f"  {e['moissonneur']} a planté (code {e['code']}), voir les journaux")
        else:
            self._ecrire(f"  {e['moissonneur']} terminé · code {e['code']}")

    def _fin(self, e):
        self.code = e['code']
        self._ecrire('')
        self._ecrire('Bilan')
        for m, f in self.fins.items():
            lot = self.lots.get(m)
            if lot:
                self._ecrire(f"  {m} · lot {lot['chemin']}, {lot['propositions']} "
                             f"{pluriel(lot['propositions'], 'proposition')}")
            else:
                self._ecrire(f'  {m} · aucun lot déposé')
            if f['plantage']:
                self._ecrire('      le moissonneur a planté')
            if f['interrompu']:
                self._ecrire(f"      interrompu · {INTERRUPTIONS.get(f['interrompu'], f['interrompu'])}")
            if f['sources_en_echec']:
                noms = ', '.join(s['source'] for s in f['sources_en_echec'])
                self._ecrire(f'      sources en échec · {noms}')
            if f['sources_desactivees']:
                self._ecrire(f"      sources désactivées · {', '.join(f['sources_desactivees'])}")
            p = f['purge']
            self._ecrire(f"      purge · {p['lots']} {pluriel(p['lots'], 'lot')}, "
                         f"{p['decisions']} {pluriel(p['decisions'], 'décision')}")
        self._ecrire(f"Durée {duree(e['duree_s'])}. Code de sortie {e['code']} · {CODES.get(e['code'], '?')}.")

    def _refus(self, e):
        self.code = 4 if e['raison'] in ('deja-en-cours', 'budget-epuise') else 2
        self._ecrire(f"Moisson refusée · {REFUS.get(e['raison'], e['raison'])} · {e['detail']}")
        self._ecrire(f'Code de sortie {self.code} · {CODES[self.code]}.')

    def illisible(self, texte):
        self._ecrire(f'  ? ligne illisible · {texte.strip()[:200]}')

    def terminer(self, pause=False):
        """Ferme la ligne en cours ; avec `pause`, attend Entrée pour que la fenêtre du raccourci reste ouverte."""
        self._fermer()
        if pause:
            self.sortie.write('Appuyez sur Entrée pour fermer cette fenêtre.\n')
            self.sortie.flush()
            try:
                self.entree.readline()
            except (OSError, ValueError):
                pass
        self.sortie.flush()


def principal(argv, entree, sortie):
    pause = '--pause' in argv
    rendu = Rendu(sortie, entree=entree)
    for texte in entree:
        if not texte.strip():
            continue
        try:
            evt = json.loads(texte)
        except ValueError:
            rendu.illisible(texte)
            continue
        if isinstance(evt, dict):
            rendu.recevoir(evt)
        else:
            rendu.illisible(texte)
    rendu.terminer(pause=pause)
    return 0 if rendu.code is None else rendu.code


if __name__ == '__main__':
    sys.exit(principal(sys.argv[1:], sys.stdin, sys.stdout))
