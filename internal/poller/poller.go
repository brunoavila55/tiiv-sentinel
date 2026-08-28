// Package poller mantem assets.status atualizado com ICMP. E so isso: nao grava
// historico, nao calcula disponibilidade, nao dispara alerta. Metrica e serie
// temporal sao trabalho do Zabbix.
package poller

import (
	"context"
	"log/slog"
	"sync"
	"time"

	probing "github.com/prometheus-community/pro-bing"

	"github.com/tiiv/sentinel/internal/asset"
)

type Options struct {
	Interval    time.Duration
	Concurrency int
	Timeout     time.Duration
	Privileged  bool
}

type Poller struct {
	svc  *asset.Service
	opts Options
}

func New(svc *asset.Service, opts Options) *Poller {
	if opts.Concurrency < 1 {
		opts.Concurrency = 50
	}
	if opts.Interval <= 0 {
		opts.Interval = time.Minute
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 3 * time.Second
	}
	return &Poller{svc: svc, opts: opts}
}

// Run varre em intervalo fixo ate o contexto ser cancelado.
func (p *Poller) Run(ctx context.Context) {
	slog.Info("poller ICMP iniciado",
		"intervalo", p.opts.Interval, "concorrencia", p.opts.Concurrency, "privilegiado", p.opts.Privileged)

	ticker := time.NewTicker(p.opts.Interval)
	defer ticker.Stop()

	p.Scan(ctx)
	for {
		select {
		case <-ctx.Done():
			slog.Info("poller ICMP encerrado")
			return
		case <-ticker.C:
			p.Scan(ctx)
		}
	}
}

// Scan pinga todos os ativos com mgmt_ip usando um pool de goroutines limitado
// — nunca uma goroutine por ativo.
func (p *Poller) Scan(ctx context.Context) {
	started := time.Now()
	targets, err := p.svc.Store().ListPollable(ctx)
	if err != nil {
		slog.Error("poller: falha listando ativos", "err", err)
		return
	}
	if len(targets) == 0 {
		return
	}

	sem := make(chan struct{}, p.opts.Concurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex
	changed := 0

	for _, t := range targets {
		select {
		case <-ctx.Done():
			return
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func(t asset.Pollable) {
			defer wg.Done()
			defer func() { <-sem }()

			status := asset.StatusDown
			if p.ping(ctx, t.IP) {
				status = asset.StatusUp
			}
			if err := p.svc.SetStatus(ctx, t.ID, t.Status, status); err != nil {
				slog.Error("poller: falha gravando status", "asset_id", t.ID, "err", err)
				return
			}
			if t.Status != status {
				mu.Lock()
				changed++
				mu.Unlock()
			}
		}(t)
	}
	wg.Wait()

	slog.Info("poller: varredura concluida",
		"ativos", len(targets), "mudancas", changed, "duracao", time.Since(started).Round(time.Millisecond))
}

func (p *Poller) ping(ctx context.Context, ip string) bool {
	pinger, err := probing.NewPinger(ip)
	if err != nil {
		slog.Warn("poller: IP invalido", "ip", ip, "err", err)
		return false
	}
	pinger.Count = 2
	pinger.Interval = 200 * time.Millisecond
	pinger.Timeout = p.opts.Timeout
	// Em container Linux o ICMP raw exige NET_RAW; sem a capability, use
	// PING_PRIVILEGED=false e ping_group_range aberto no host.
	pinger.SetPrivileged(p.opts.Privileged)

	runCtx, cancel := context.WithTimeout(ctx, p.opts.Timeout+time.Second)
	defer cancel()
	go func() {
		<-runCtx.Done()
		pinger.Stop()
	}()

	if err := pinger.Run(); err != nil {
		slog.Debug("poller: falha no ping", "ip", ip, "err", err)
		return false
	}
	return pinger.Statistics().PacketsRecv > 0
}
