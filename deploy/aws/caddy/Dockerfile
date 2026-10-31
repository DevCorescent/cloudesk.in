# The custom-domain edge: Caddy with on-demand TLS. Build from deploy/aws/caddy.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
# APP_INTERNAL_HOST = the web service's internal DNS name (ECS Service Connect / Cloud Map), e.g. web.cloudesk.internal
ENV APP_INTERNAL_HOST=web.cloudesk.internal
VOLUME /data
EXPOSE 80 443
