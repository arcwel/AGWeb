The contents of this directory in the Chromium checkout are **generated** by
`app/scripts/pack-webui.mjs` from `app/out/webui` — 172 built files plus a
`.grd` and `BUILD.gn` derived from them. They are not checked in here because
they are build output; run the packer to reproduce them:

    cd app
    npx vite build --config vite.webui.config.ts
    node scripts/pack-webui.mjs
