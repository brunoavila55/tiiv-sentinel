package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/google/uuid"

	"github.com/tiiv/sentinel/internal/asset"
	"github.com/tiiv/sentinel/internal/config"
	"github.com/tiiv/sentinel/internal/db"
)

// runSeed cria uma rede de exemplo com ~50 ativos em 4 niveis
// (POP > backbone > acesso > cliente) para desenvolvimento.
func runSeed(ctx context.Context, cfg *config.Config) error {
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := db.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}

	var existing int
	if err := pool.QueryRow(ctx, `select count(*) from assets`).Scan(&existing); err != nil {
		return err
	}
	if existing > 0 && os.Getenv("SEED_FORCE") != "true" {
		slog.Info("banco ja tem ativos, seed ignorado", "ativos", existing,
			"dica", "use SEED_FORCE=true para semear mesmo assim")
		return nil
	}

	store := asset.NewStore(pool)
	pops := []struct {
		name string
		net  int
	}{
		{"POP Centro", 10},
		{"POP Zona Norte", 20},
		{"POP Litoral", 30},
	}

	total := 0
	create := func(in asset.CreateInput) (uuid.UUID, error) {
		id, err := store.Insert(ctx, in)
		if err == nil {
			total++
		}
		return id, err
	}
	ptr := func(s string) *string { return &s }

	for _, pop := range pops {
		popID, err := create(asset.CreateInput{
			Name:        pop.name,
			Kind:        "pop",
			Description: ptr("Ponto de presenca com energia redundante e gerador."),
			MgmtIP:      ptr(fmt.Sprintf("10.%d.0.1", pop.net)),
			Attrs:       map[string]any{"energia": "gerador + nobreak", "acesso": "chave com o plantao"},
		})
		if err != nil {
			return err
		}

		routerID, err := create(asset.CreateInput{
			ParentID:    &popID,
			Name:        fmt.Sprintf("RB-%s", pop.name[4:]),
			Kind:        "router",
			Description: ptr("Roteador de borda. Config completa anexada."),
			MgmtIP:      ptr(fmt.Sprintf("10.%d.0.2", pop.net)),
			Attrs:       map[string]any{"vendor": "mikrotik", "modelo": "CCR2004", "asn": "AS64500"},
		})
		if err != nil {
			return err
		}

		if _, err := create(asset.CreateInput{
			ParentID:    &popID,
			Name:        fmt.Sprintf("Link %s <-> Backbone", pop.name),
			Kind:        "link",
			Description: ptr("Enlace de fibra 10G para o backbone."),
			Attrs:       map[string]any{"capacidade": "10G", "operadora": "transporte proprio"},
		}); err != nil {
			return err
		}

		for sw := 1; sw <= 2; sw++ {
			switchID, err := create(asset.CreateInput{
				ParentID: &routerID,
				Name:     fmt.Sprintf("SW-%s-%02d", pop.name[4:7], sw),
				Kind:     "switch",
				MgmtIP:   ptr(fmt.Sprintf("10.%d.1.%d", pop.net, sw)),
				Attrs:    map[string]any{"vendor": "mikrotik", "portas": 24},
			})
			if err != nil {
				return err
			}

			oltID, err := create(asset.CreateInput{
				ParentID:    &switchID,
				Name:        fmt.Sprintf("OLT-%s-%02d", pop.name[4:7], sw),
				Kind:        "olt",
				Description: ptr("OLT GPON. Porta PON em attrs."),
				MgmtIP:      ptr(fmt.Sprintf("10.%d.2.%d", pop.net, sw)),
				Attrs:       map[string]any{"vendor": "huawei", "porta_pon": fmt.Sprintf("0/%d/1", sw), "slots": 8},
			})
			if err != nil {
				return err
			}

			apID, err := create(asset.CreateInput{
				ParentID: &switchID,
				Name:     fmt.Sprintf("AP-%s-%02d", pop.name[4:7], sw),
				Kind:     "ap",
				MgmtIP:   ptr(fmt.Sprintf("10.%d.3.%d", pop.net, sw)),
				Attrs:    map[string]any{"vendor": "mikrotik", "ssid": fmt.Sprintf("TIIV-%s-%02d", pop.name[4:7], sw), "banda": "5GHz"},
			})
			if err != nil {
				return err
			}

			for c := 1; c <= 3; c++ {
				if _, err := create(asset.CreateInput{
					ParentID: &oltID,
					Name:     fmt.Sprintf("Cliente PON %s-%02d-%02d", pop.name[4:7], sw, c),
					Kind:     "cliente",
					MgmtIP:   ptr(fmt.Sprintf("172.%d.%d.%d", pop.net, sw, c)),
					Attrs:    map[string]any{"plano": "500 Mbps", "onu": fmt.Sprintf("HW%s%02d%02d", pop.name[4:7], sw, c)},
				}); err != nil {
					return err
				}
			}
			for c := 1; c <= 2; c++ {
				if _, err := create(asset.CreateInput{
					ParentID: &apID,
					Name:     fmt.Sprintf("Cliente RF %s-%02d-%02d", pop.name[4:7], sw, c),
					Kind:     "cliente",
					MgmtIP:   ptr(fmt.Sprintf("172.%d.%d.%d", pop.net, 100+sw, c)),
					Attrs:    map[string]any{"plano": "100 Mbps", "antena": "LHG 5"},
				}); err != nil {
					return err
				}
			}
		}
	}

	slog.Info("seed concluido", "ativos", total)
	return nil
}
