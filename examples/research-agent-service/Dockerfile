# Build:  docker build -t research-agent .
# Run:    docker run -p 8787:8787 -e VERID_URL=https://YOUR-VERID-HOST -e VERID_API_KEY=verid_xxxxxxxx_... #                    -e AGENT_ACCESS_TOKEN=choose-a-long-random-string research-agent
FROM node:20-alpine
WORKDIR /app
COPY package.json agent.mjs server.mjs ./
RUN npm install --omit=dev --no-audit --no-fund
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.mjs"]
