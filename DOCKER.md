# Docker Deployment Guide

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down

# Stop and remove data
docker-compose down -v
```

### Using Docker directly

```bash
# Build image
docker build -t copilot-for-cursor .

# Run container
docker run -d \
  --name copilot-proxy \
  -p 4142:4142 \
  -e PUBLIC_URL=https://your-domain.com \
  -v copilot-data:/app/data \
  copilot-for-cursor

# View logs
docker logs -f copilot-proxy

# Stop and remove
docker stop copilot-proxy && docker rm copilot-proxy
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PUBLIC_URL` | Public HTTPS URL for Cursor | `https://copilot-for-cursor.samstark.me` |
| `CURSOR_AUTO_CONFIGURE` | Auto-configure Cursor settings | `0` (disabled in Docker) |
| `CURSOR_UPSTREAM_URL` | Personal OpenAI-compatible base URL for unprefixed models | unset (all models → Copilot) |
| `CURSOR_UPSTREAM_KEY` | API key for the personal upstream | unset |
| `CURSOR_UPSTREAM_MODELS` | Extra unprefixed model ids to register | unset |
| `DATA_DIR` | Data directory for persistence | `/app/data` |

## Volumes

The container uses a named volume `copilot-data` to persist:
- Usage statistics (`/app/data/usage.json`)
- Configuration (`/app/data/config.json`)
- API keys and auth data

## Networking

### Local Development
Access the dashboard at `http://localhost:4142`

### Production with Cloudflare Tunnel
1. Set up a Cloudflare tunnel pointing to `localhost:4142`
2. Configure the tunnel URL in `PUBLIC_URL` environment variable
3. Use the tunnel URL in Cursor settings

### Production with Reverse Proxy (nginx)
```nginx
server {
    listen 443 ssl http2;
    server_name copilot.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:4142;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## GitHub Authentication

The copilot-api service requires GitHub authentication. On first run:

1. Exec into the container:
```bash
docker exec -it copilot-proxy sh
```

2. Authenticate with GitHub:
```bash
npx @jeffreycao/copilot-api start
# Follow the GitHub device flow prompts
```

Alternatively, mount your existing GitHub token:
```bash
docker run -d \
  -v ~/.copilot-api:/home/bunuser/.copilot-api:ro \
  ...
```

## Health Checks

The container includes a health check that verifies:
- Proxy server is responding
- API endpoint `/api/usage` returns successfully

View health status:
```bash
docker ps
# or
docker inspect copilot-proxy | grep -A 10 Health
```

## Resource Limits

Default limits in docker-compose.yml:
- CPU: 2 cores max, 0.5 cores reserved
- Memory: 2GB max, 512MB reserved

Adjust based on your usage:
```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 4G
```

## Logs

View real-time logs:
```bash
docker-compose logs -f copilot-proxy
```

Export logs:
```bash
docker logs copilot-proxy > proxy.log 2>&1
```

## Backup and Restore

### Backup data
```bash
docker run --rm \
  -v copilot-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/copilot-backup.tar.gz -C /data .
```

### Restore data
```bash
docker run --rm \
  -v copilot-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/copilot-backup.tar.gz -C /data"
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs copilot-proxy

# Check if port is already in use
lsof -i :4142
```

### Can't connect to upstream
```bash
# Verify copilot-api is running inside container
docker exec copilot-proxy ps aux | grep copilot-api
```

### Data not persisting
```bash
# Verify volume is mounted
docker inspect copilot-proxy | grep -A 10 Mounts
```

## Production Checklist

- [ ] Set `PUBLIC_URL` to your tunnel/proxy URL
- [ ] Configure HTTPS (Cloudflare tunnel or reverse proxy)
- [ ] Set up persistent volumes
- [ ] Configure resource limits
- [ ] Set up log rotation
- [ ] Enable API key authentication in dashboard
- [ ] Set budget limits if needed
- [ ] Test health checks
- [ ] Set up monitoring/alerts
- [ ] Document your deployment

## Kubernetes Deployment

See `k8s/` directory for Kubernetes manifests (coming soon).
