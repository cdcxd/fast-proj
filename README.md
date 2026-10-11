# fast-proj

Fast, allocation-free coordinate conversions for JavaScript and TypeScript, one package per projection.

| package                          | description | docs               |
| -------------------------------- | ----------- | ------------------ |
| [`@fast-proj/utm`](packages/utm) | UTM ↔ WGS84 | [API](docs/utm.md) |

## Development

Uses [Bun](https://bun.sh) workspaces (package manager), vitest, oxlint, oxfmt and TypeScript 7. A devcontainer is
included.

```sh
bun install
bun run check    # format, lint, typecheck, build, test
cd packages/utm && bun run bench    # Node, Bun and Chromium
```

## License

MIT
