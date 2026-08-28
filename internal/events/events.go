// Package events distribui eventos para os clientes via SSE. Sem WebSocket: o
// fluxo e unidirecional e SSE reconecta sozinho.
package events

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

const (
	TypeStatusChanged     = "asset.status_changed"
	TypeAssetUpdated      = "asset.updated"
	TypeAssetCreated      = "asset.created"
	TypeAssetDeleted      = "asset.deleted"
	TypeAttachmentAdded   = "attachment.added"
	TypeAttachmentRemoved = "attachment.removed"
)

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type subscriber struct {
	ch chan Event
}

type Hub struct {
	mu   sync.RWMutex
	subs map[*subscriber]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[*subscriber]struct{})}
}

func (h *Hub) subscribe() *subscriber {
	s := &subscriber{ch: make(chan Event, 64)}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s
}

func (h *Hub) unsubscribe(s *subscriber) {
	h.mu.Lock()
	delete(h.subs, s)
	h.mu.Unlock()
	close(s.ch)
}

// Publish nunca bloqueia: cliente lento perde evento e se corrige no proximo
// refetch do TanStack Query.
func (h *Hub) Publish(evt Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.subs {
		select {
		case s.ch <- evt:
		default:
			slog.Warn("subscriber SSE lento, evento descartado", "type", evt.Type)
		}
	}
}

func (h *Hub) Subscribers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs)
}

// Handler serve o stream SSE em GET /api/events.
func (h *Hub) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming nao suportado", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // nginx nao pode bufferizar SSE
		w.WriteHeader(http.StatusOK)

		// retry: dica de backoff inicial para o EventSource do navegador.
		fmt.Fprint(w, "retry: 3000\n\n")
		flusher.Flush()

		sub := h.subscribe()
		defer h.unsubscribe(sub)

		ping := time.NewTicker(20 * time.Second)
		defer ping.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ping.C:
				fmt.Fprint(w, ": ping\n\n")
				flusher.Flush()
			case evt := <-sub.ch:
				payload, err := json.Marshal(evt.Data)
				if err != nil {
					slog.Error("serializando evento SSE", "err", err, "type", evt.Type)
					continue
				}
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, payload)
				flusher.Flush()
			}
		}
	}
}
