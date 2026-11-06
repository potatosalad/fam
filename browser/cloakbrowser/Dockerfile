FROM cloakhq/cloakbrowser:0.6.5@sha256:d25e539dd029d899734aa6e2a706ccc7fa4014cc5654dc07cb5afcfe1048c4e9
RUN apt-get update && apt-get install -y --no-install-recommends x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/fam-browser
COPY cloakbrowser/package*.json ./
COPY cloakbrowser/LICENSE.md ./LICENSE.md
RUN npm ci --omit=dev --ignore-scripts
COPY cloakbrowser/launch.py cloakbrowser/server.mjs cloakbrowser/humanize.mjs cloakbrowser/main.mjs cloakbrowser/plugin.js ./cloakbrowser/
ENV CLOAKBROWSER_AUTO_UPDATE=false FAM_BROWSER_PROFILE_DIR=/data/profiles
EXPOSE 9377 6080
CMD ["node", "/opt/fam-browser/cloakbrowser/main.mjs"]
