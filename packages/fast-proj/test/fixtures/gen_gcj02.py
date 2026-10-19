"""Generate high-precision GCJ-02 reference points.

The published WGS84 -> GCJ-02 offset formula (Krasovsky a, e^2) evaluated at 40 digits with exact pi; the inverse
iterates it to convergence. Near longitude 105, where the sqrt(|x|) term stalls that iteration, the inverse instead
runs Newton on each side of the cusp in t = sqrt(|x|). Inputs are doubles, given exactly.

Usage: python gen_gcj02.py > gcj02.json   (requires mpmath)
"""

import json
import random

from mpmath import cos, findroot, mp, mpf, pi, sin, sqrt

mp.dps = 40
a = mpf(6378245)
ee = mpf("0.00669342162296594323")


def offset(lon, lat, r=None):
    x = lon - 105
    y = lat - 35
    if r is None:
        r = sqrt(abs(x))
    dlat = -100 + 2 * x + 3 * y + mpf("0.2") * y * y + mpf("0.1") * x * y + mpf("0.2") * r
    dlon = 300 + x + 2 * y + mpf("0.1") * x * x + mpf("0.1") * x * y + mpf("0.1") * r
    common = (20 * sin(6 * x * pi) + 20 * sin(2 * x * pi)) * 2 / 3
    dlat += common + (20 * sin(y * pi) + 40 * sin(y / 3 * pi)) * 2 / 3
    dlat += (160 * sin(y / 12 * pi) + 320 * sin(y * pi / 30)) * 2 / 3
    dlon += common + (20 * sin(x * pi) + 40 * sin(x / 3 * pi)) * 2 / 3
    dlon += (150 * sin(x / 12 * pi) + 300 * sin(x / 30 * pi)) * 2 / 3
    rad = lat * pi / 180
    magic = 1 - ee * sin(rad) ** 2
    sm = sqrt(magic)
    dlat = dlat * 180 / (a * (1 - ee) / (magic * sm) * pi)
    dlon = dlon * 180 / (a / sm * cos(rad) * pi)
    return dlon, dlat


def forward(lon, lat):
    dlon, dlat = offset(lon, lat)
    return lon + dlon, lat + dlat


def inverse(glon, glat):
    w = [glon, glat]
    for _ in range(60):
        f = forward(w[0], w[1])
        nw = [glon - (f[0] - w[0]), glat - (f[1] - w[1])]
        if abs(nw[0] - w[0]) + abs(nw[1] - w[1]) < mpf(10) ** -35:
            return nw
        w = nw
    raise RuntimeError("no convergence")


def inverse_cusp(glon, glat):
    """All exact inverses, by longitude. West of 105 the sqrt(|x|) term folds the formula over: within about
    (0.1 / (a cos(lat)) * 180 / pi)^2 = 2.6e-12 degrees of 105 (at 55.8) a point can have three."""
    roots = []
    with mp.workdps(60):
        for s in (1, -1):

            def f(t, lat):
                lon = 105 + s * t * t
                d = offset(lon, lat, t)
                return [lon + d[0] - glon, lat + d[1] - glat]

            for t0 in ("0.01", "1e-4", "1e-6", "1e-7", "3e-7", "1.2e-6", "1.6e-6", "2e-6"):
                t, lat = findroot(f, (mpf(t0), glat - mpf("0.001")), tol=mpf(10) ** -100, verify=False, maxsteps=40)
                r = f(t, lat)
                lon = 105 + s * t * t
                if t >= 0 and abs(r[0]) + abs(r[1]) < mpf(10) ** -45 and all(abs(lon - w[0]) > 1e-30 for w in roots):
                    roots.append([lon, lat])
    if not roots:
        raise RuntimeError("no convergence")
    return sorted(roots)


random.seed(2026)
inputs = []
for i in range(14):
    for j in range(14):
        inputs.append((72.3 + i * 4.9 + 0.123 * j, 1.1 + j * 3.9 + 0.071 * i))
for _ in range(100):
    inputs.append((random.uniform(72.004, 137.8347), random.uniform(0.8293, 55.8271)))
# central meridian of the sqrt(|x|) terms, the lat origin, and near the bounding box corners
for lon in [105.0, 105.0 + 1e-9, 105.0 - 1e-6, 105.25, 104.5]:
    for lat in [0.9, 35.0, 35.0 + 1e-7, 22.5, 55.8]:
        inputs.append((lon, lat))
inputs += [(72.01, 0.83), (137.83, 55.82), (72.01, 55.82), (137.83, 0.83), (116.391, 39.907), (121.4737, 31.2304)]


def s(v):
    return mp.nstr(v, 22)


fwd = []
inv = []
for lon, lat in inputs:
    g = forward(mpf(lon), mpf(lat))
    fwd.append([lon, lat, s(g[0]), s(g[1])])
    w = inverse(mpf(lon), mpf(lat))
    inv.append([lon, lat, s(w[0]), s(w[1])])

# GCJ-02 points whose exact inverse lies within 1e-15 to 1e-1 degrees of longitude 105, and within the fold; rows
# list every exact inverse
for e in range(-15, 0, 2):
    for sgn in (1, -1):
        for lat in (1.0, 35.0, 55.8):
            g = forward(mpf(105.0 + sgn * 10.0**e * random.uniform(1, 9)), mpf(lat))
            gl, ga = float(g[0]), float(g[1])
            inv.append([gl, ga] + [s(v) for w in inverse_cusp(mpf(gl), mpf(ga)) for v in w])
for x in ("3e-15", "1e-13", "-1e-13", "-5e-13", "-1e-12", "-2e-12"):
    for lat in (1.0, 35.0, 55.8):
        g = forward(105 + mpf(x), mpf(lat))
        gl, ga = float(g[0]), float(g[1])
        inv.append([gl, ga] + [s(v) for w in inverse_cusp(mpf(gl), mpf(ga)) for v in w])

print(json.dumps({"fromWgs84": fwd, "toWgs84": inv}))
