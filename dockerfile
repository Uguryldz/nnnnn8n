# Resmi n8n imajıyla aynı seviye (tini, full-icu, sqlite3 rebuild, graphicsmagick, font, git/openssh). Label yok.
# syntax satırı kaldırıldı: docker/dockerfile:1 çekilirken credential hatası olabiliyor; varsayılan BuildKit aynı sözdizimini destekler.
ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-alpine3.22

ARG NODE_VERSION

# Ortak bağımlılıklar (resmi base ile uyumlu)
RUN apk add --no-cache \
    busybox-binsh \
    curl \
    fontconfig \
    ttf-dejavu \
    git \
    openssh \
    openssl \
    graphicsmagick \
    tini \
    tzdata \
    ca-certificates \
    libc6-compat \
    && apk del apk-tools 2>/dev/null || true

# full-icu (tarih/dil desteği)
RUN npm install -g full-icu@1.5.0 && rm -rf /root/.npm /tmp/*

WORKDIR /home/node

ENV NODE_ENV=production
ENV NODE_ICU_DATA=/usr/local/lib/node_modules/full-icu
ENV SHELL=/bin/sh
ENV N8N_PORT=5678
ENV GENERIC_TIMEZONE=Europe/Istanbul
ENV N8N_RELEASE_TYPE=stable

# Compiled uygulama (resmi gibi konum)
COPY compiled /usr/local/lib/node_modules/n8n
COPY docker-entrypoint.sh /

# sqlite3 native rebuild, symlink, dizin ve entrypoint izin
RUN cd /usr/local/lib/node_modules/n8n && \
    npm rebuild sqlite3 && \
    ln -sf /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n && \
    mkdir -p /home/node/.n8n /home/node/bin && \
    ln -sf /usr/local/bin/n8n /home/node/bin/n8n && \
    chown -R node:node /home/node && \
    chmod +x /docker-entrypoint.sh && \
    rm -rf /root/.npm /tmp/*

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]
