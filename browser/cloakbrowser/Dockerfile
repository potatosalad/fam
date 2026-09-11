FROM cloakhq/cloakbrowser@sha256:2ed5b2d047cbdde22cde7ef1a796526c716aadaa5bccbe1db5ade49282b64a76
RUN apt-get update && apt-get install -y --no-install-recommends x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/fam-browser
COPY cloakbrowser/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY camofox-plugin/index.js ./camofox-plugin/index.js
COPY cloakbrowser/ ./cloakbrowser/
ENV CLOAKBROWSER_AUTO_UPDATE=false FAM_BROWSER_PROFILE_DIR=/data/profiles
EXPOSE 9377 6080
CMD ["node", "/opt/fam-browser/cloakbrowser/main.mjs"]
