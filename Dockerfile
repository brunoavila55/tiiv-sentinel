# Backend Go: binario unico, imagem final minima.
FROM golang:1.26-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY migrations ./migrations

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -u 10001 sentinel
COPY --from=build /out/api /app/api
USER sentinel
EXPOSE 8080
ENTRYPOINT ["/app/api"]
CMD ["serve"]
