# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584

FROM ${NODE_IMAGE} AS runtime

ARG AGENTHUB_VERSION=0.6.0
ARG AGENTHUB_REVISION=unknown

LABEL org.opencontainers.image.title="AgentHub" \
      org.opencontainers.image.description="AI Coding Agent 控制平面" \
      org.opencontainers.image.source="https://github.com/Kkwans/AgentHub" \
      org.opencontainers.image.version="${AGENTHUB_VERSION}" \
      org.opencontainers.image.revision="${AGENTHUB_REVISION}"

WORKDIR /opt/agenthub

COPY . .

# The service itself stays root for the explicitly authorised Docker control
# boundary, while Host ACP processes run as the project owner.  pnpm's copied
# store is created root-only by the image build; make runtime dependencies
# traversable/readable without granting write access to the downgraded user.
RUN chmod -R a+rX /opt/agenthub/node_modules

RUN test -f apps/server/dist/index.js \
    && test -f apps/web/dist/index.html \
    && test -d node_modules/.pnpm \
    && node --version \
    && git --version

ENV NODE_ENV=production \
    AGENTHUB_WEB_DIST=/opt/agenthub/apps/web/dist \
    PATH=/opt/agenthub/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

EXPOSE 3210

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3210/api/v1/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "apps/server/dist/index.js"]
