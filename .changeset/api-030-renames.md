---
'fast-proj': minor
---

Breaking renames, done once before 1.0:

| 0.2                                 | 0.3                                                 |
| ----------------------------------- | --------------------------------------------------- |
| `tmerc({ lon0, k0 })`               | `tmerc({ centralMeridian, scaleFactor })`           |
| `t.lon0`, `t.k0`                    | `t.centralMeridian`, `t.scaleFactor`                |
| `GeographicTransform` type          | `Datum`                                             |
| `centralMeridian(zone)`             | `utm({ zone }).centralMeridian` or `zone * 6 - 183` |
| `MAX_FLATTENING`                    | `0.01`                                              |
| `backend === 'wasm'` (custom build) | `'js'`: non-SIMD builds fall back to JavaScript     |

Passing `lon0` or `k0` throws a `TypeError` naming the new option. `latitudeOfOrigin` is reserved and throws until
supported. The wasm module no longer exports the unused zone-based `forward_batch`/`inverse_batch`.
