# Build:  docker build --build-arg VERID_SDK_URL=https://YOUR-VERID-HOST/sdk/verid-sdk.tgz -t research-agent .
# Run:    docker run -p 8787:8787 -e VERID_URL=https://YOUR-VERID-HOST -e VERID_API_KEY=verid_xxxxxxxx_... \
#                    -e AGENT_ACCESS_TOKEN=choose-a-long-random-string research-agent
FROM node:20-alpine
WORKDIR /app
ARG VERID_SDK_URL
COPY package.json agent.mjs server.mjs ./
RUN test -n "$VERID_SDK_URL" || (echo "Pass --build-arg VERID_SDK_URL=https://YOUR-VERID-HOST/sdk/verid-sdk.tgz" && exit 1)
# Download, then install the file: works even where npm blocks installing straight from a URL.
RUN wget -qO verid-sdk.tgz "$VERID_SDK_URL" && npm install --omit=dev --no-audit --no-fund ./verid-sdk.tgz
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.mjs"]
