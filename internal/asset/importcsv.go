package asset

import (
	"context"
	"encoding/csv"
	"io"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiiv/sentinel/internal/apperr"
)

type rawImportRow struct {
	Line                                        int
	Name, Kind, ParentName, MgmtIP, Description string
}

// parseImportCSV le o cabecalho `name,kind,parent_name,mgmt_ip,description`
// (ordem livre, colunas opcionais viram string vazia). "name" e "kind" tem
// que existir; o resto e opcional.
func parseImportCSV(raw string) ([]rawImportRow, error) {
	r := csv.NewReader(strings.NewReader(raw))
	r.TrimLeadingSpace = true
	r.FieldsPerRecord = -1

	header, err := r.Read()
	if err != nil {
		return nil, apperr.Validation("empty_csv", "CSV vazio ou ilegivel")
	}
	idx := make(map[string]int, len(header))
	for i, h := range header {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	if _, ok := idx["name"]; !ok {
		return nil, apperr.Validation("missing_column", "coluna obrigatoria ausente: name")
	}
	if _, ok := idx["kind"]; !ok {
		return nil, apperr.Validation("missing_column", "coluna obrigatoria ausente: kind")
	}

	get := func(rec []string, key string) string {
		i, ok := idx[key]
		if !ok || i >= len(rec) {
			return ""
		}
		return strings.TrimSpace(rec[i])
	}

	var rows []rawImportRow
	line := 1
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		line++
		if err != nil {
			return nil, apperr.Validation("invalid_csv", "linha %d ilegivel: %v", line, err)
		}
		rows = append(rows, rawImportRow{
			Line:        line,
			Name:        get(rec, "name"),
			Kind:        get(rec, "kind"),
			ParentName:  get(rec, "parent_name"),
			MgmtIP:      get(rec, "mgmt_ip"),
			Description: get(rec, "description"),
		})
	}
	return rows, nil
}

type parentRef struct {
	isRoot      bool
	internal    bool
	internalIdx int
	externalID  *uuid.UUID
}

// ImportPreview valida o CSV inteiro sem gravar nada.
func (s *Service) ImportPreview(ctx context.Context, csvText string) (*ImportResult, error) {
	raw, err := parseImportCSV(csvText)
	if err != nil {
		return nil, err
	}
	result, _, err := s.planImport(ctx, nil, raw)
	return result, err
}

// ImportCommit revalida o CSV (o preview pode estar desatualizado) e, se
// nada tiver erro, grava tudo numa unica transacao: ou entra tudo, ou nada.
func (s *Service) ImportCommit(ctx context.Context, csvText string, actor Actor) (*ImportResult, error) {
	raw, err := parseImportCSV(csvText)
	if err != nil {
		return nil, err
	}
	dry, _, err := s.planImport(ctx, nil, raw)
	if err != nil {
		return nil, err
	}
	if dry.ErrCount > 0 {
		dry.Committed = false
		return dry, nil
	}

	var result *ImportResult
	txErr := pgx.BeginFunc(ctx, s.store.Pool(), func(tx pgx.Tx) error {
		r, _, err := s.planImport(ctx, tx, raw)
		if err != nil {
			return err
		}
		if r.ErrCount > 0 {
			return apperr.Conflict("import_race", "os dados mudaram entre a validacao e a gravacao; refaca o preview")
		}
		r.Committed = true
		result = r
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}

	for _, row := range result.Rows {
		if row.Status != ImportRowOK || row.ExistingID == nil {
			continue
		}
		s.audit(ctx, *row.ExistingID, row.Name, actor, AuditCreate, map[string]any{"via": "import_csv"})
	}
	return result, nil
}

// planImport e o motor comum do preview e do commit: valida campo a campo,
// resolve pai (interno ao CSV ou existente no banco), ordena topologicamente
// as dependencias internas e — quando tx != nil — grava. Rodar as duas fases
// pelo mesmo caminho e o que garante que preview e commit nunca divergem.
func (s *Service) planImport(ctx context.Context, tx pgx.Tx, raw []rawImportRow) (*ImportResult, map[int]uuid.UUID, error) {
	rows := make([]ImportRow, len(raw))
	refs := make([]parentRef, len(raw))

	byName := make(map[string][]int, len(raw))
	for i, r := range raw {
		byName[strings.ToLower(r.Name)] = append(byName[strings.ToLower(r.Name)], i)
	}

	for i, r := range raw {
		row := ImportRow{
			Line: r.Line, Name: r.Name, Kind: r.Kind, ParentName: r.ParentName,
			MgmtIP: r.MgmtIP, Description: r.Description, Status: ImportRowOK,
		}
		if row.Name == "" {
			row.Status, row.Error = ImportRowError, "nome obrigatorio"
		} else if err := s.validateKind(row.Kind); err != nil {
			row.Status, row.Error = ImportRowError, err.Error()
		} else if row.MgmtIP != "" {
			if _, err := normalizeIP(&row.MgmtIP); err != nil {
				row.Status, row.Error = ImportRowError, err.Error()
			}
		}

		if row.ParentName == "" {
			refs[i] = parentRef{isRoot: true}
		} else {
			var internal []int
			for _, j := range byName[strings.ToLower(row.ParentName)] {
				if j != i {
					internal = append(internal, j)
				}
			}
			switch {
			case len(internal) > 1:
				if row.Status == ImportRowOK {
					row.Status, row.Error = ImportRowError, "pai ambiguo: varias linhas do CSV com esse nome"
				}
			case len(internal) == 1:
				refs[i] = parentRef{internal: true, internalIdx: internal[0]}
			}
		}
		rows[i] = row
	}

	// Resolucao externa: so quem tem parent_name e nao achou pai dentro do
	// proprio CSV.
	for i, r := range raw {
		if rows[i].Status == ImportRowError || refs[i].isRoot || refs[i].internal || r.ParentName == "" {
			continue
		}
		id, found, ambiguous, err := s.store.FindByNameAnywhere(ctx, r.ParentName)
		if err != nil {
			return nil, nil, err
		}
		switch {
		case ambiguous:
			rows[i].Status, rows[i].Error = ImportRowError, "pai ambiguo: varios ativos existentes com esse nome"
		case !found:
			rows[i].Status, rows[i].Error = ImportRowError, "ativo pai nao encontrado"
		default:
			pid := id
			refs[i].externalID = &pid
		}
	}

	order, cyclic := topoOrder(refs)
	for _, i := range cyclic {
		if rows[i].Status != ImportRowError {
			rows[i].Status, rows[i].Error = ImportRowError, "ciclo de pai entre linhas do CSV"
		}
	}

	created := make(map[int]uuid.UUID)
	for _, i := range order {
		if rows[i].Status == ImportRowError {
			continue
		}
		var parentID *uuid.UUID
		switch {
		case refs[i].isRoot:
			parentID = nil
		case refs[i].internal:
			p := refs[i].internalIdx
			if rows[p].Status == ImportRowError {
				rows[i].Status, rows[i].Error = ImportRowError, "pai desta linha tem erro"
				continue
			}
			if id, ok := created[p]; ok {
				parentID = &id
			} else {
				// Preview: o pai interno ainda nao existe de fato, entao nao
				// da para checar duplicata contra ele — soma como "ok" sem
				// confirmar, o commit revalida de verdade.
				continue
			}
		case refs[i].externalID != nil:
			parentID = refs[i].externalID
		}

		existingID, found, err := s.findByNameUnderParent(ctx, tx, rows[i].Name, parentID)
		if err != nil {
			return nil, nil, err
		}
		if found {
			rows[i].Status, rows[i].ExistingID = ImportRowExists, &existingID
			created[i] = existingID
			continue
		}
		if tx != nil {
			ip, _ := normalizeIP(&rows[i].MgmtIP)
			desc := optionalStr(rows[i].Description)
			id, err := s.store.InsertTx(ctx, tx, CreateInput{
				ParentID: parentID, Name: rows[i].Name, Kind: rows[i].Kind,
				Description: desc, MgmtIP: ip,
			})
			if err != nil {
				return nil, nil, err
			}
			created[i] = id
			rows[i].ExistingID = &id
		}
	}

	result := &ImportResult{Rows: rows, Total: len(rows)}
	for _, row := range rows {
		switch row.Status {
		case ImportRowOK:
			result.OKCount++
		case ImportRowExists:
			result.Exists++
		case ImportRowError:
			result.ErrCount++
		}
	}
	return result, created, nil
}

func (s *Service) findByNameUnderParent(ctx context.Context, tx pgx.Tx, name string, parentID *uuid.UUID) (uuid.UUID, bool, error) {
	if tx != nil {
		return s.store.FindIDByNameUnderParentTx(ctx, tx, name, parentID)
	}
	return s.store.FindIDByNameUnderParent(ctx, name, parentID)
}

// topoOrder ordena as linhas por dependencia de pai interno (Kahn). O
// segundo retorno lista as linhas que sobraram presas num ciclo.
func topoOrder(refs []parentRef) (order []int, cyclic []int) {
	n := len(refs)
	indeg := make([]int, n)
	children := make([][]int, n)
	for i, ref := range refs {
		if ref.internal {
			indeg[i]++
			children[ref.internalIdx] = append(children[ref.internalIdx], i)
		}
	}
	queue := make([]int, 0, n)
	for i := 0; i < n; i++ {
		if indeg[i] == 0 {
			queue = append(queue, i)
		}
	}
	visited := make([]bool, n)
	for len(queue) > 0 {
		i := queue[0]
		queue = queue[1:]
		visited[i] = true
		order = append(order, i)
		for _, c := range children[i] {
			indeg[c]--
			if indeg[c] == 0 {
				queue = append(queue, c)
			}
		}
	}
	for i := 0; i < n; i++ {
		if !visited[i] {
			cyclic = append(cyclic, i)
		}
	}
	return order, cyclic
}

func optionalStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
