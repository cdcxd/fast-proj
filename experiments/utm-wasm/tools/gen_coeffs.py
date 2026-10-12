"""Generate and validate double-precision coefficients for the wasm vector math (v3).

Fits are computed with mpmath's high-precision Chebyshev-projection polynomial fit
(mp.chebyfit, 60 dps) on the working interval, rounded to double, then validated
against mpmath evaluation of the target function.
"""
import numpy as np
import mpmath as mp
import struct

mp.mp.dps = 60
rd = lambda x: mp.mpf(struct.unpack('<d', struct.pack('<d', float(x)))[0])
PI4 = mp.pi / 4


def horner(c, x):
    r = mp.mpf(0)
    for k in reversed(c):
        r = r * x + k
    return r


def fit_hi(g, a, b, deg):
    """Best polynomial fit of g on [a,b] at 60 dps; ascending double coefficients."""
    c_desc = mp.chebyfit(g, [mp.mpf(a), mp.mpf(b)], deg + 1)
    return [rd(x) for x in reversed(c_desc)]


def report(name, c, check, exact, xs):
    err = max(abs(check(mp.mpf(repr(float(x)))) - exact(mp.mpf(repr(float(x))))) for x in xs)
    print(f'{name} max abs err:', mp.nstr(err, 3))
    return err


co = {}

# sin(r) = r + r^3 S(r^2), r in [-pi/4, pi/4]
S = fit_hi(lambda t: (mp.sin(mp.sqrt(t)) - mp.sqrt(t)) / (t * mp.sqrt(t)) if t > mp.mpf('1e-30') else mp.mpf(-1)/6,
           0, PI4**2, 7)
co['S'] = S
report('sin', S, lambda r: r + r**3 * horner(S, r * r), mp.sin, np.linspace(-float(PI4), float(PI4), 4001))

# cos(r) = 1 + r^2 C(r^2)
C = fit_hi(lambda t: (mp.cos(mp.sqrt(t)) - 1) / t if t > mp.mpf('1e-30') else mp.mpf(-1)/2,
           0, PI4**2, 9)
co['C'] = C
report('cos', C, lambda r: 1 + r * r * horner(C, r * r), mp.cos, np.linspace(-float(PI4), float(PI4), 4001))

# exp(r) = 1 + r + r^2 E(r), |r| <= 0.3466
E = fit_hi(lambda r: (mp.exp(r) - 1 - r) / r**2 if abs(r) > mp.mpf('1e-30') else mp.mpf(1)/2,
           mp.mpf('-0.3466'), mp.mpf('0.3466'), 10)
co['E'] = E
report('exp', E, lambda r: 1 + r + r * r * horner(E, r), mp.exp, np.linspace(-0.3466, 0.3466, 4001))

# log(m), m in [sqrt(0.5), sqrt(2)]: s=(m-1)/(m+1), log = 2s + 2s^3 L(s^2)
smax = (mp.sqrt(2) - 1) / (mp.sqrt(2) + 1)
L = fit_hi(lambda t: (mp.log((1 + mp.sqrt(t)) / (1 - mp.sqrt(t))) - 2 * mp.sqrt(t)) / (2 * t * mp.sqrt(t)) if t > mp.mpf('1e-30') else mp.mpf(1)/3,
           0, smax**2, 8)
co['L'] = L
def logchk(m):
    s = (m - 1) / (m + 1)
    return 2 * s + 2 * s**3 * horner(L, s * s)
report('log', L, logchk, mp.log, np.linspace(np.sqrt(.5), np.sqrt(2), 4001))

# atan(u) = u + u^3 P(u^2), u in [-tan(pi/8), tan(pi/8)]  (polynomial, no division)
U = mp.tan(mp.pi / 8)
P = fit_hi(lambda t: (mp.atan(mp.sqrt(t)) - mp.sqrt(t)) / (t * mp.sqrt(t)) if t > mp.mpf('1e-30') else mp.mpf(-1)/3,
           0, U**2, 12)
co['ATP'] = P
def atanchk(u):
    return u + u**3 * horner(P, u * u)
report('atan', P, atanchk, mp.atan, np.linspace(-float(U), float(U), 4001))

print()
for k in ('S', 'C', 'E', 'L', 'ATP'):
    print(f'pub const {k}: [f64; {len(co[k])}] = [' + ', '.join(f'{float(c):.17e}' for c in co[k]) + '];')
