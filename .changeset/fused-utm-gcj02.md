---
'fast-proj': patch
---

JavaScript `utm`/`tmerc` with `geographic: GCJ02`: x/y → GCJ-02 runs as one loop, 9–11% faster in Node and Bun and 36–37% in Chromium (point method 14–48%). Results move by up to one ulp (3e-14°), except in `'transform'` mode within a few kilometres of the poles.
