FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       python3 \
       ca-certificates \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

# ffmpeg-static downloads a platform binary during npm install.
# GitHub release downloads can occasionally return transient 5xx errors,
# so retry the complete npm install before failing the Docker build.
RUN for attempt in 1 2 3; do \
      echo "npm ci attempt $attempt/3"; \
      npm ci && exit 0; \
      if [ "$attempt" -lt 3 ]; then sleep 10; fi; \
    done; \
    exit 1

RUN npx prisma generate

COPY . .

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ENV NODE_ENV=production
ENV PORT=3000

RUN npm run compile

EXPOSE 3000

CMD ["npm", "run", "server"]
