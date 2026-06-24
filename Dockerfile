FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist

ENV HOST=0.0.0.0 \
    PORT=8000 \
    COPILOT_HEADLESS=true

EXPOSE 8000
CMD ["node", "dist/cli.js", "serve"]
