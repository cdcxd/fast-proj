"""Generate high-precision Web Mercator (EPSG:3857) reference points.

x = R lambda, y = R asinh(tan phi) and the inverse lambda = x / R, phi = atan(sinh(y / R)), R = 6378137, evaluated at
40 digits with exact pi. Inputs are doubles, given exactly.

Usage: python gen_webmerc.py > webmerc.json   (requires mpmath)
"""

import json
import random

from mpmath import asinh, atan, mp, mpf, pi, sinh, tan

mp.dps = 40
R = mpf(6378137)


def forward(lon, lat):
    return R * mpf(lon) * pi / 180, R * asinh(tan(mpf(lat) * pi / 180))


def inverse(x, y):
    return mpf(x) / R * 180 / pi, atan(sinh(mpf(y) / R)) * 180 / pi


def main():
    rng = random.Random(3857)
    lonlat = [(0.0, 0.0), (180.0, 0.0), (-180.0, 0.0), (0.0, 85.0511287798066), (0.0, -85.0511287798066)]
    lonlat += [(0.0, 1e-300), (0.0, 1e-9), (179.999999, 89.999999), (-0.5, -89.9999999999)]
    lonlat += [(0.0, 15.93384416308254), (0.0, 33.84106466892382)]  # six and five ulps from earlier wasm kernels
    # five ulps in the polynomial JavaScript kernel and in wasm
    lonlat += [(0.0, -33.81738840602338), (0.0, -34.897243), (0.0, -33.27141539995888), (0.0, 34.56842675923495)]
    for _ in range(400):
        lonlat.append((rng.uniform(-180, 180), rng.uniform(-85.06, 85.06)))
    for _ in range(100):
        lonlat.append((rng.uniform(-180, 180), rng.choice([-1, 1]) * rng.uniform(85.06, 89.9999)))
    for _ in range(100):
        lonlat.append((rng.uniform(-1, 1), rng.uniform(-1e-3, 1e-3)))
    e = float(R * pi)
    xy = [(0.0, 0.0), (e, e), (-e, -e), (0.0, 1e-300), (1.0, 1e-6), (0.0, 3e7), (0.0, -1e8)]
    # over 3e-14 degrees with a tan(pi/8) reduction in the inline atan; about asinh(1), where the inverse switches form
    xy += [(0.0, 17723719.93129409), (0.0, -61351589.76), (0.0, 5621521.486192067), (0.0, -8085952.984662622)]
    for _ in range(400):
        xy.append((rng.uniform(-e, e), rng.uniform(-e, e)))
    for _ in range(100):
        xy.append((rng.uniform(-e, e), rng.choice([-1, 1]) * rng.uniform(e, 1.2e8)))
    for _ in range(100):
        xy.append((rng.uniform(-100, 100), rng.uniform(-100, 100)))
    out = {
        "forward": [[lon, lat, *(float(v) for v in forward(lon, lat))] for lon, lat in lonlat],
        "inverse": [[x, y, *(float(v) for v in inverse(x, y))] for x, y in xy],
    }
    print(json.dumps(out))


main()
