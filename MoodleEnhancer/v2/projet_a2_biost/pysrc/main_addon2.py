import pygame
import random
import math

import physics
from main_addon import draw_arrow, draw_debug_info, draw_rosace, draw_vector, get_input_direction


# --- MÉTÉORITES ---
METEOR_MIN_SPEED = 40.0      # px/s
METEOR_MAX_SPEED = 150.0     # px/s
METEOR_MIN_R, METEOR_MAX_R = 10, 32   # rayon des météorites en pixels
METEOR_SPAWN_INTERVAL = 1.8  # s entre deux tentatives de spawn
METEOR_MAX_COUNT = 24        # population maximale simultanée
SAFE_SPAWN_DISTANCE = 150.0  # distance mini joueur→spawn (éviter pop sur le joueur)


def spawn_meteorite(meteorites: list[dict[str, float]],
                    player_x: float, player_y: float,
                    width: int, height: int) -> None:
    """
    Crée une météorite sur un bord de la carte, avec une direction rentrante,
    une vitesse lente, et un rayon aléatoire.
    """
    if len(meteorites) >= METEOR_MAX_COUNT:
        return

    # Choix d'un bord: 0=haut, 1=droite, 2=bas, 3=gauche
    side = random.randint(0, 3)
    margin = 0  # on pop exactement sur le bord visible (monde torique)
    if side == 0:   # haut
        x = random.uniform(0, width)
        y = margin
        base_angle = math.radians(90)   # vers le bas
    elif side == 1: # droite
        x = width - margin
        y = random.uniform(0, height)
        base_angle = math.radians(180)  # vers la gauche
    elif side == 2: # bas
        x = random.uniform(0, width)
        y = height - margin
        base_angle = math.radians(-90)  # vers le haut
    else:           # gauche
        x = margin
        y = random.uniform(0, height)
        base_angle = 0.0                # vers la droite

    # Jitter aléatoire pour ne pas rentrer parfaitement perpendiculaire
    jitter = random.uniform(-math.pi/6, math.pi/6)
    angle = base_angle + jitter

    speed = random.uniform(METEOR_MIN_SPEED, METEOR_MAX_SPEED)
    vx = speed * math.cos(angle)
    vy = speed * math.sin(angle)
    r  = random.randint(METEOR_MIN_R, METEOR_MAX_R)

    # Sécurité: éviter spawn trop proche du joueur
    if (x - player_x) ** 2 + (y - player_y) ** 2 < SAFE_SPAWN_DISTANCE ** 2:
        # On décale un peu le point de spawn (simple, suffisant)
        x = (x + SAFE_SPAWN_DISTANCE) % width
        y = (y + SAFE_SPAWN_DISTANCE) % height

    meteorites.append({"x": x, "y": y, "vx": vx, "vy": vy, "r": r})


def update_meteorites(meteorites: list[dict[str, float]], dt: float,
                      width: int, height: int) -> None:
    """Fait avancer les météorites et applique le wrap toroïdal."""
    for m in meteorites:
        m["x"] = (m["x"] + m["vx"] * dt) % width
        m["y"] = (m["y"] + m["vy"] * dt) % height


def draw_meteorites(surface: pygame.Surface, meteorites: list[dict[str, float]]) -> None:
    """Dessine les météorites (disques gris foncé + liseré)."""
    for m in meteorites:
        pygame.draw.circle(surface, (120, 120, 120), (int(m["x"]), int(m["y"])), m["r"])
        pygame.draw.circle(surface, (60, 60, 60), (int(m["x"]), int(m["y"])), m["r"], width=2)


def player_collision_with_meteorites(px: float, py: float, player_radius: float,
                                     meteorites: list[dict[str, float]]) -> bool:
    """
    Collision si distance^2 <= (r_player + r_meteor)^2.
    On utilise la distance au carré pour éviter une racine carrée coûteuse.
    """
    for m in meteorites:
        dx = px - m["x"]
        dy = py - m["y"]
        rr = (player_radius + m["r"]) ** 2
        if dx * dx + dy * dy <= rr:
            return True
    return False


def main():
    pygame.init()
    WIDTH, HEIGHT = 900, 600
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Simulation inertielle")
    clock = pygame.time.Clock()

    # --- ÉTAT INITIAL JOUEUR ---
    x, y = WIDTH / 4, HEIGHT / 4
    vx, vy = 150.0, 150.0
    angle_control = math.pi / 4
    PLAYER_RADIUS = 16  # approximation pour la collision

    # --- MÉTÉORITES & JEU ---
    meteorites: list[list[str, float]] = []
    spawn_timer = 0.0
    alive = True
    survival_time = 0.0
    best_time = 0.0
    font = pygame.font.SysFont("consolas", 22)

    running = True
    while running:
        dt_seconds = clock.tick(60) / 1000.0  # delta‑temps réel (s), max 60 FPS

        # --- Événements (necessaire pour éviter le freeze) ---
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        keys = pygame.key.get_pressed()

        # --- Contrôles tant que l'on est en vie ---
        if alive:
            if keys[pygame.K_LEFT]:
                angle_control -= physics.TURN_SPEED * dt_seconds
            if keys[pygame.K_RIGHT]:
                angle_control += physics.TURN_SPEED * dt_seconds
            angle_control = angle_control % (2 * math.pi)

            # Modèle physique joueur
            x, y, vx, vy, angle_velocity = physics.update_physics(
                x, y, vx, vy, angle_control, bool(keys[pygame.K_UP]), dt_seconds
            )

            # Monde torique
            x %= WIDTH
            y %= HEIGHT

            # Mise à jour météorites
            spawn_timer += dt_seconds
            if spawn_timer >= METEOR_SPAWN_INTERVAL:
                spawn_timer = 0.0
                spawn_meteorite(meteorites, x, y, WIDTH, HEIGHT)
            update_meteorites(meteorites, dt_seconds, WIDTH, HEIGHT)

            # Collision
            if player_collision_with_meteorites(x, y, PLAYER_RADIUS, meteorites):
                alive = False
                best_time = max(best_time, survival_time)

            # Temps de survie
            survival_time += dt_seconds

        else:
            # Game over : restart sur R
            if keys[pygame.K_r]:
                # Reset complet
                x, y = WIDTH / 4, HEIGHT / 4
                vx, vy = 150.0, 150.0
                angle_control = math.pi / 4
                meteorites.clear()
                spawn_timer = 0.0
                survival_time = 0.0
                alive = True

        # --- Vue : angle affiché (interpolation) ---
        angle_displayed = physics.lerp_angle(angle_control, angle_velocity if alive else angle_control,
                                             physics.ANGLE_BLEND)

        # --- Rendu ---
        screen.fill((30, 30, 30))
        draw_arrow(screen, x, y, angle_displayed)
        draw_meteorites(screen, meteorites)

        # Rosace et debug
        input_angle = get_input_direction(keys, angle_control)
        draw_rosace(screen, WIDTH - 120, HEIGHT - 120, angle_displayed, input_angle)
        draw_debug_info(screen, vx, vy, angle_displayed, angle_control)
        draw_vector(screen, x, y, vx, vy, (0, 255, 0))

        # HUD : score
        score_surf = font.render(f"Temps: {survival_time:5.2f} s   Record: {best_time:5.2f} s", True, (255, 255, 255))
        screen.blit(score_surf, (20, HEIGHT - 40))

        if not alive:
            go_surf = font.render("Collision ! Appuyez sur R pour recommencer", True, (255, 120, 120))
            screen.blit(go_surf, (WIDTH // 2 - go_surf.get_width() // 2, 20))

        pygame.display.flip()

    pygame.quit()
    
    
if __name__ == "__main__":
    
    main()