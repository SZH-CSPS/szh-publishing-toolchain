"""Aucune connexion sortante pendant les tests : chaque paquet de tests l'arme en s'important. Seule la boucle locale
reste permise. Un processus lancé par un test n'est pas couvert : il passe `--hors-ligne` ou un faux réseau."""
import socket


class ReseauInterdit(RuntimeError):
    """Un test a voulu sortir sur le réseau. RuntimeError, et non OSError : aucune couche réseau ne l'avale."""


_RESOUDRE = socket.getaddrinfo
_CONNECTER = socket.socket.connect
_CONNECTER_EX = socket.socket.connect_ex


def _locale(hote):
    hote = (hote.decode() if isinstance(hote, bytes) else str(hote or '')).strip('[]').lower()
    return hote in ('', 'localhost', '::1') or hote.startswith('127.')


def _resoudre(hote, *args, **kw):
    if not _locale(hote):
        raise ReseauInterdit(f'résolution de {hote} refusée pendant les tests')
    return _RESOUDRE(hote, *args, **kw)


def _verifier(sock, adresse):
    if sock.family in (socket.AF_INET, socket.AF_INET6) and not _locale(adresse[0]):
        raise ReseauInterdit(f'connexion vers {adresse[0]} refusée pendant les tests')


def _connecter(self, adresse):
    _verifier(self, adresse)
    return _CONNECTER(self, adresse)


def _connecter_ex(self, adresse):
    _verifier(self, adresse)
    return _CONNECTER_EX(self, adresse)


def armer():
    socket.getaddrinfo = _resoudre
    socket.socket.connect = _connecter
    socket.socket.connect_ex = _connecter_ex


def arme():
    return socket.getaddrinfo is _resoudre and socket.socket.connect is _connecter


armer()
