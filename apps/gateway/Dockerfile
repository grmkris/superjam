FROM caddy:2-alpine
COPY apps/gateway/Caddyfile /etc/caddy/Caddyfile
# Caddy validates + runs the config; $PORT/$SERVER_URL/$WEB_URL come from Railway.
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
