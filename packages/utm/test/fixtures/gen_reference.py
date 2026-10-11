"""Generate high-precision UTM reference points for WGS84, independent of the Krüger coefficients.

The conformal-sphere -> projected mapping Z(z) = z + sum alpha_k sin(2kz) is evaluated with alpha_k obtained by
numerical Fourier integration of the exact meridian arc (incomplete elliptic integral), at 30 digits and 24 terms.

Usage: python gen_reference.py > reference.json   (requires mpmath)
"""

import json

from mpmath import asinh, atan, atanh, cos, ellipe, findroot, mp, mpc, mpf, pi, quad, radians, sin, sinh, sqrt, tan

mp.dps = 30
a = mpf(6378137)
f = 1 / mpf("298.257223563")
e2 = f * (2 - f)
e = sqrt(e2)
k0 = mpf("0.9996")
K = 24


def chi(p):
    return atan(sinh(asinh(tan(p)) - e * atanh(e * sin(p))))


def arc(p):
    return a * (ellipe(p, e2) - e2 * sin(p) * cos(p) / sqrt(1 - e2 * sin(p) ** 2))


A = arc(pi / 2) / (pi / 2)
memo = {}


def xi_minus_c(c):
    if c not in memo:
        p = findroot(lambda q: chi(q) - c, c) if c != 0 else mpf(0)
        memo[c] = arc(p) / A - c
    return memo[c]


alpha = [4 / pi * quad(lambda c: xi_minus_c(c) * sin(2 * k * c), [0, pi / 4, pi / 2]) for k in range(1, K + 1)]


def forward(dlon, lat):
    lam = radians(mpf(dlon))
    if abs(lat) == 90:
        z = mpc(pi / 2 if lat > 0 else -pi / 2, 0)
    else:
        c = chi(radians(mpf(lat)))
        xip = atan(tan(c) / cos(lam)) if cos(lam) > 0 else None
        etap = asinh(sin(lam) / sqrt(tan(c) ** 2 + cos(lam) ** 2))
        z = mpc(xip, etap)
    Z = z + sum(alpha[k - 1] * mp.sin(2 * k * z) for k in range(1, K + 1))
    return 500000 + k0 * A * Z.imag, k0 * A * Z.real


points = []
for dlon in [0, 1, 3, 6, 10, 20, 30, -2, -15, -30]:
    for lat in [0, 0.5, 15, 33.3, 47, 60, 75, 84, 89.5, 90]:
        if lat == 90 and dlon != 0:
            continue
        x, y = forward(dlon, lat)
        points.append({"dlon": dlon, "lat": lat, "x": mp.nstr(x, 20), "y": mp.nstr(y, 20)})

print(json.dumps({"ellipsoid": "WGS84", "k0": 0.9996, "falseEasting": 500000, "points": points}, indent=1))
