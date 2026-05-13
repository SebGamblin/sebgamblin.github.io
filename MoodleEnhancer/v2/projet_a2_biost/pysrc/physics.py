
import math

from constantes import *

def normalize_vector(vx: float, vy: float) -> tuple[float, float]:
    """Normalise un vecteur (ou renvoie 0,0 si vecteur nul)."""
    norm = math.sqrt(vx**2 + vy**2)
    if norm == 0:
        return 0.0, 0.0
    return vx / norm, vy / norm


assert normalize_vector(3, 4) == (0.6, 0.8)
assert normalize_vector(0, 0) == (0.0, 0.0)
assert normalize_vector(-10, 0) == (-1.0, 0.0)


def limit_speed(vx: float, vy: float, max_speed: float) -> tuple[float, float]:
    """Limite la vitesse à max_speed."""
    speed = math.hypot(vx, vy)
    if speed > max_speed:
        vx = vx / speed * max_speed
        vy = vy / speed * max_speed
    return vx, vy


assert limit_speed(100, 0, 50) == (50.0, 0.0)
assert limit_speed(0, 0, 50) == (0.0, 0.0)
assert limit_speed(30, 40, 50) == (30.0, 40.0)  # norme = 50, rien ne change


def angle_from_velocity(vx: float, vy: float) -> float:
    """Renvoie l'angle du vecteur vitesse. 0 si vecteur nul."""
    if vx == 0 and vy == 0:
        return 0.0
    return math.atan2(vy, vx)


assert angle_from_velocity(1, 0) == 0
assert math.isclose(angle_from_velocity(0, 1), math.pi/2)
assert math.isclose(angle_from_velocity(-1, 0), math.pi)
assert angle_from_velocity(0, 0) == 0.0


def lerp_angle(a: float, b: float, t: float) -> float:
    """
    Interpolation angulaire entre a et b.
    t=0 → a ; t=1 → b
    """
    diff = (b - a + math.pi) % (2 * math.pi) - math.pi
    return (a + diff * t) % (2 * math.pi)



def update_physics(
    x: float, y: float,                 # position (pixels)
    vx: float, vy: float,               # vitesse (px/s)
    angle_control: float,               # angle "commandé" (radians)
    go_up: bool,                        # l'objet accélère-t-il ?
    dt: float                           # pas de temps (s)
) -> tuple[float, float, float, float, float]:
    """
    Met à jour le modèle cinématique sur un pas de temps DT (en secondes).

    Équations appliquées :
        v(t+dt) = v(t) + a * dt
        p(t+dt) = p(t) + v * dt
        v       = FRICTION * v
        theta_v = atan2(vy, vx)

    Paramètres
    ----------
    x, y : float
        Position (pixels).
    vx, vy : float
        Vitesse (pixels/seconde).
    angle_control : float
        Direction désirée (radians).
    go_up : bool
        True si l'objet accélère.
    dt: float
        Pas de temps (s)

    Constantes utilisées (globales)
    -------------------------------
    ACCEL : float
    FRICTION : float
    MAX_SPEED : float

    Retour
    ------
    (x, y, vx, vy, angle_velocity)
        x, y : nouvelle position
        vx, vy : nouvelle vitesse
        angle_velocity : direction réelle du mouvement
    """
    # Accélération selon angle contrôle
    if go_up:
        ax = ACCEL * math.cos(angle_control)
        ay = ACCEL * math.sin(angle_control)
    else:
        ax = 0.0
        ay = 0.0

    # Vitesse
    vx += ax * dt
    vy += ay * dt

    # Limitation
    vx, vy = limit_speed(vx, vy, MAX_SPEED)

    # Frottement
    vx *= FRICTION
    vy *= FRICTION

    # Position
    x += vx * dt
    y += vy * dt

    # Angle réel
    angle_velocity = angle_from_velocity(vx, vy)

    return x, y, vx, vy, angle_velocity