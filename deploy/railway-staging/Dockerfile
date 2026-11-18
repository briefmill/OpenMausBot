FROM caddy:2.10.2 AS edge
FROM ghcr.io/milind-soni/openmausbot@sha256:f9a8c5f911fa2e0c098efd7d8d009368c9517010d3f76870653ec8c7141000f7
USER root
RUN HOME=/tmp/omb-engine-install npm install -g @anthropic-ai/claude-code@2.1.314 @openai/codex@0.167.2 && rm -rf /tmp/omb-engine-install
COPY --from=edge /usr/bin/caddy /usr/local/bin/caddy
RUN rm -rf /app/dist /app/dist-server
COPY --chown=maus:maus dist /app/dist
COPY --chown=maus:maus dist-server /app/dist-server
COPY --chown=maus:maus skills /app/skills
COPY package.json /app/package.json
COPY railway /app/railway
RUN chmod 0755 /app/railway/chrome-wrapper.sh && node --check /app/railway/start.mjs && PORT=8080 caddy validate --config /app/railway/Caddyfile --adapter caddyfile
ENV PORT=8080 OMB_PORT=8799 OMB_WEBHOOK_PORT=8800 OMB_LOOPBACK_TRUST=service
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "/app/railway/start.mjs"]
