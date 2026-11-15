# Sources and licenses

This is an unofficial deployment kit. It is not endorsed by Penpot or its maintainers.

- Penpot: https://github.com/penpot/penpot — Mozilla Public License 2.0. This kit references official `penpotapp/frontend`, `backend`, `exporter`, and `mcp` images, pinned to 2.18.5 by default. The full Penpot source tree and container images are not vendored here.
- PostgreSQL: https://www.postgresql.org/ — PostgreSQL License; `postgres:15` image.
- Valkey: https://valkey.io/ — BSD 3-Clause; `valkey/valkey:8.1` image.
- Node.js: https://nodejs.org/ — MIT and bundled dependency licenses; `node:24-alpine` image for temporary tooling only.

Container images include dependencies with their own notices. Consult each upstream image/source distribution for the complete notices.

The original deployment configuration and tooling in this repository are distributed under MPL-2.0. See LICENSE.
