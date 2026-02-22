# Microstack Runtime Docker Image

This package can run as a standalone containerized runtime endpoint for Lambda APIs.

## Build the image

```bash
docker build -t microstack/runtime:latest runtime
```

## Run the image

```bash
docker run --rm -p 1337:1337 microstack/runtime:latest
```

Default endpoint:

```text
http://localhost:1337
```

## Runtime environment variables

- `MICROSTACK_HOST` (default: `0.0.0.0`)
- `MICROSTACK_PORT` (default: `1337`)
- `MICROSTACK_DATA_DIR` (default: `/tmp/microstack`)

State is ephemeral by default. If consumers want persistence, they can mount a volume to `MICROSTACK_DATA_DIR`.

## Endpoints

Microstack reserves `/microstack/*` for non-AWS-emulation runtime endpoints.

- `GET /microstack/health` -> `200 { "status": "ok" }`

AWS Lambda emulation endpoints live under `/2015-03-31/*`.

## Example consumer docker-compose service

```yaml
services:
  microstack:
    image: microstack/runtime:latest
    ports:
      - "127.0.0.1:1337:1337"
    environment:
      - MICROSTACK_PORT=1337
```

## AWS SDK endpoint example

Set your Lambda client endpoint to:

```text
http://localhost:1337
```

The runtime image `HEALTHCHECK` probes `GET /microstack/health`.
