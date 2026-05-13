
import matplotlib.pyplot as plt
import math
import physics
import pygame


DIRECTIONS = [
    0, math.pi/4, math.pi/2, 3*math.pi/4,
    math.pi, -3*math.pi/4, -math.pi/2, -math.pi/4
]


def draw_rosace(surface, cx: float, cy: float, angle: float, angle_control: float) -> None:
    """
    Affiche une rosace de 8 directions :
    - cercles gris : directions cardinales
    - point rouge : direction effective (vecteur vitesse)
    - point bleu  : direction commandée (touche LEFT/RIGHT)
    """
    radius = 80

    # --- Dessine les 8 directions cardinales ---
    for a in DIRECTIONS:
        px = cx + radius * math.cos(a)
        py = cy + radius * math.sin(a)
        pygame.draw.circle(surface, (150, 150, 150), (int(px), int(py)), 10)

    # --- Position du pointeur rouge (vitesse réelle) ---
    rx = cx + radius * math.cos(angle)
    ry = cy + radius * math.sin(angle)
    pygame.draw.circle(surface, (255, 0, 0), (int(rx), int(ry)), 14)

    # --- Position du pointeur bleu (commande utilisateur) ---
    if angle_control is not None:
        ux = cx + radius * math.cos(angle_control)
        uy = cy + radius * math.sin(angle_control)
        pygame.draw.circle(surface, (0, 120, 255), (int(ux), int(uy)), 12)


def draw_vector(surface, x, y, vx, vy, color=(0,255,0)):
    """Dessine un vecteur (vx, vy) partant de (x,y)."""
    scale = 0.2  # réduire la longueur pour lisibilité
    end_x = x + vx * scale
    end_y = y + vy * scale
    pygame.draw.line(surface, color, (x,y), (end_x,end_y), 3)
    pygame.draw.circle(surface, color, (int(end_x), int(end_y)), 5)
    
    
def draw_debug_info(surface, vx, vy, angle, angle_control):
    font = pygame.font.SysFont("consolas", 20)
    speed = math.hypot(vx, vy)
    text_lines = [
        f"vx = {vx:.1f} px/s",
        f"vy = {vy:.1f} px/s",
        f"|v| = {speed:.1f} px/s",
        f"angle_vel = {math.degrees(angle):.1f}°",
        f"angle_ctrl = {math.degrees(angle_control):.1f}°"
    ]
    for i, line in enumerate(text_lines):
        surface.blit(font.render(line, True, (255,255,255)), (20, 20 + 22*i))
        

def draw_arrow(surface: pygame.Surface, x: float, y: float, angle: float, color: tuple=None) -> None:
    """
    Affiche une flèche triangulaire orientée selon l'angle donné.
    """
    L, W = 40, 20
    px = x + L * math.cos(angle); py = y + L * math.sin(angle)
    lx = x + W * math.cos(angle + 2.5); ly = y + W * math.sin(angle + 2.5)
    rx = x + W * math.cos(angle - 2.5); ry = y + W * math.sin(angle - 2.5)
    pygame.draw.polygon(surface, (255, 220, 0) if color is None else color, [(px, py), (lx, ly), (rx, ry)])



def get_input_direction(keys, angle_control):
    """
    Détermine la direction précise demandée par le joueur,
    indépendamment de la vitesse réelle.

    Retourne:
        direction_angle (float) ou None si aucune direction.
    """
    up = keys[pygame.K_UP]
    left = keys[pygame.K_LEFT]
    right = keys[pygame.K_RIGHT]

    if up:
        if left:
            return 5 * math.pi/4
        elif right:
            return - math.pi/4
        else:
            return -math.pi/2 # OK
    if left:
        return math.pi 
    if right:
        return 0
    
    return None


def main():
    pygame.init()
    WIDTH, HEIGHT = 900, 600                             # Dimensions souhaitées de la fenêtre, en pixels
    screen = pygame.display.set_mode((WIDTH, HEIGHT))    # Initialisation de la fenêtre
    pygame.display.set_caption("Simulation inertielle")  # Titre de la page 
    clock = pygame.time.Clock()                          # Horloge du jeu : permet la mise à jour et l'utilisation de dt

    

    
    # --- ETAT INITIAL
    x, y = WIDTH / 4, HEIGHT / 4   # Position initiale 
    vx, vy = 150.0, 150.0          # Vitesse initiale
    angle_control = math.pi / 4  # Direction : à droite 

    running = True               # Condition d'arrêt de la boucle événementielle
    while running:
        dt_seconds = clock.tick(60) / 1000.0  # delta‑temps réel entre deux frames (en secondes), basé sur un framerate max de 60 FPS

        # --- RECUPERATION DES ÉVÉNEMENTS
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        # --- CONTRÔLE UTILISATEUR
        keys = pygame.key.get_pressed() # Récupération des touches utilisées
        if keys[pygame.K_LEFT]:         # L'utilisateur appuie sur <- : rotation à gauche
            angle_control -= physics.TURN_SPEED * dt_seconds
        if keys[pygame.K_RIGHT]:        # L'utilisateur appuie sur -> : rotation à droite
            angle_control += physics.TURN_SPEED * dt_seconds
            
        angle_control = angle_control % (2 * math.pi)

        # --- MODÈLE PHYSIQUE
        x, y, vx, vy, angle_velocity = physics.update_physics(
            x, y, vx, vy, angle_control, bool(keys[pygame.K_UP]), dt_seconds
        )
        
        # Monde torique
        x %= WIDTH
        y %= HEIGHT

        # --- VUE : ANGLE AFFICHÉ
        angle_displayed = physics.lerp_angle(
            angle_control, angle_velocity, physics.ANGLE_BLEND
        )

        # --- RENDU
        screen.fill((30, 30, 30))
        draw_arrow(screen, x, y, angle_displayed)
        input_angle = get_input_direction(keys, angle_control)
        draw_rosace(screen, WIDTH - 120, HEIGHT - 120, angle_displayed, input_angle)
        
        draw_debug_info(screen, vx, vy, angle_displayed, angle_control)
        draw_vector(screen, x, y, vx, vy, (0,255,0))
        pygame.display.flip()

    pygame.quit()


if __name__ == "__main__":
    main()