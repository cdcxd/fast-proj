---
'fast-proj': patch
---

JavaScript `utm`/`tmerc` with `geographic: GCJ02`: x/y → GCJ-02 runs as one loop, 9–11% faster in Node and Bun and 36–37% in Chromium (point method 14–48%). Results move by up to 3e-14° (longitude scaled by cos(latitude)); in `'transform'` mode poleward of about 87° the unscaled longitude can move more.
