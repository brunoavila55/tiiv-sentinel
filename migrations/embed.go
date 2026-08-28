// Package migrations embute os arquivos SQL versionados no binario da API,
// para que `docker compose up` suba tudo sem passo manual.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
