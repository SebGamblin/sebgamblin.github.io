
import math 

from physics import *


assert normalize_vector(3, 4) == (0.6, 0.8)
assert normalize_vector(0, 0) == (0.0, 0.0)
assert normalize_vector(-10, 0) == (-1.0, 0.0)

assert limit_speed(100, 0, 50) == (50.0, 0.0)
assert limit_speed(0, 0, 50) == (0.0, 0.0)
assert limit_speed(30, 40, 50) == (30.0, 40.0)  # norme = 50, rien ne change

assert angle_from_velocity(1, 0) == 0
assert math.isclose(angle_from_velocity(0, 1), math.pi/2)
assert math.isclose(angle_from_velocity(-1, 0), math.pi)
assert angle_from_velocity(0, 0) == 0.0

a = math.radians(179)
b = math.radians(-179)
res = lerp_angle(a, b, 0.5)
assert abs(res - math.radians(180)) < 1e-3  # interpolation du petit arc