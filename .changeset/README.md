# Changesets

Each PR with a user-facing change adds a changeset: `bun changeset`, pick the bump, write the CHANGELOG entry.

To release: `bun run version-packages` on a branch (bumps the version, writes `CHANGELOG.md`, consumes the
changesets), merge it, then push the tag `v<version>`.
