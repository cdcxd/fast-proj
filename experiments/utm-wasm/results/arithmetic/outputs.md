# Output comparison

Node v24.21.0. Each grid covers all 181 integer latitudes from −90° to 90°, six near-pole latitudes, and an additional signed-zero latitude. Eight zone/hemisphere combinations per row.

| Longitude range | Ellipsoid   | Points | Forward identical pairs | Inverse identical pairs | Max Δx (m) | Max Δy (m) | Max Δlon (°) | Max weighted Δlon (°) | Max Δlat (°) |
| --------------- | ----------- | -----: | ----------------------: | ----------------------: | ---------: | ---------: | -----------: | --------------------: | -----------: |
| ±30°            | sphere      |  91744 |   91744/91744 (100.00%) |   91744/91744 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±30°            | WGS84       |  91744 |   91744/91744 (100.00%) |   91744/91744 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±30°            | GRS80       |  91744 |   91744/91744 (100.00%) |   91744/91744 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±30°            | f=0.005     |  91744 |   91744/91744 (100.00%) |   91744/91744 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±30°            | f=0.0099999 |  91744 |   91744/91744 (100.00%) |   91744/91744 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±45°            | sphere      | 136864 | 136864/136864 (100.00%) | 136864/136864 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±45°            | WGS84       | 136864 | 136864/136864 (100.00%) | 136864/136864 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±45°            | GRS80       | 136864 | 136864/136864 (100.00%) | 136864/136864 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±45°            | f=0.005     | 136864 | 136864/136864 (100.00%) | 136864/136864 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |
| ±45°            | f=0.0099999 | 136864 | 136864/136864 (100.00%) | 136864/136864 (100.00%) |   0.000e+0 |   0.000e+0 |     0.000e+0 |              0.000e+0 |     0.000e+0 |

The CSV includes separate x/y and lon/lat identity counts, signed-zero differences, classification discrepancies, circular longitude deltas, and every zone/hemisphere row. The summary JSON includes aggregate rows, fixture results, API checks, and every nonidentical exceptional case. Inverse comparisons use identical baseline-projected inputs. Longitude weighting uses the original latitude; unweighted longitude can be ill-conditioned near a pole.

Grid classification discrepancies: 0.
Exceptional inputs: 280 cases; 280 identical pairs; 0 ordinate classification discrepancies; 0 signed-zero differences.

Nonidentical exceptional inputs (signed zeros are preserved as strings):

| Zone | Direction | Input | Baseline | Candidate | Absolute deltas |
| ---: | --------- | ----- | -------- | --------- | --------------- |

The near-90° forward cases have enormous finite series outputs outside both grids. The raw equator suite below separately checks both northing zero signs, including ordinary eastings west of the central meridian.
Raw equator inputs: 240 cases; 240 identical pairs; 0 classification differences; 0 signed-zero differences. Southern equator northing is 10000000 m, where a distinct negative-zero offset is not representable.

Out-of-domain diagnostics (reported independently of the success criteria):

| Case                                             | Input               | Baseline                  | Candidate                 | Classification differences |
| ------------------------------------------------ | ------------------- | ------------------------- | ------------------------- | -------------------------: |
| high-flattening extreme easting                  | [100000000,0]       | [-75,"NaN"]               | [-75,"NaN"]               |                          0 |
| high-flattening extreme easting/nonzero northing | [100000000,1000000] | [59.99999999999999,"NaN"] | [59.99999999999999,"NaN"] |                          0 |
| sphere extreme easting                           | [1200000000,0]      | ["NaN","NaN"]             | ["NaN","NaN"]             |                          0 |
| sphere negative extreme easting                  | [-1200000000,0]     | ["NaN","NaN"]             | ["NaN","NaN"]             |                          0 |

Candidate API forms: 6400 ordinate comparisons; 0 differences; 0 output-buffer identity failures.

Independent fixture (91 points): candidate max Δx 1.397e-9 m, Δy 1.863e-9 m, weighted Δlon 1.776e-14°, Δlat 2.842e-14°. Strict 5 nm / 1e-13° thresholds: **PASS**.

Object.is identity applies only to these samples. Numerical differences are reported rather than treated as universal bit identity. The ±30° and ±45° grids overlap. The fixture checks independent accuracy; baseline agreement alone does not establish accuracy.
