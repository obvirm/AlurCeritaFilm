# movie2short Web — Clean-Room Frontend

Frontend clean-room yang meng-clone **perilaku** `tscaps/apps/studio` tanpa menyalin kode `AGPL`. Semua komponen ditulis ulang dari spec `docs/PRD.md` + kontrak `server/server.mjs`.

## Stack
- Vite + React 19 + TypeScript + Tailwind 3
- react-router-dom 7 + zustand + lucide-react
- Proxy `/api`, `/files`, `/ws` → `http://localhost:3131` (dev)

## Run
```bash
# production (serve via Node)
npm run build        # build web/dist
npm run dev:ui       # node server/server.mjs di http://localhost:3131

# dev (Vite HMR)
npm run dev:web      # http://localhost:5173 (proxy ke 3131)
# atau
npm --prefix web run dev
```

## Struktur
```
web/src/
  main.tsx            # RouterProvider
  app/
    api/client.ts     # upload/run/jobs/templates/files + WS
    stores/appStore.ts
    router.tsx
  ui/
    components/       # AppShell, VideoDropzone, VideoPlayer, LogViewer, ArtifactList, TemplateGrid, StatusBadge
    pages/            # Dashboard, NewJob, JobDetail, Templates
  index.css
```

## Backend Kontrak
- `POST /api/upload?name=` raw body → `{videoPath}`
- `POST /api/run` → `{jobId}`
- `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/log`
- `POST /api/jobs/:id/cancel`
- `GET /api/templates` → `{id,name,swatch,css,json}`
- `GET /files/:jobId/*` Range support
- `WS /ws?job=` → `{type:log|status}`

Server serve `web/dist` (fallback `tscaps-web/dist`) via `server/server.mjs`.

## Lisensi
MIT — clean-room. Inspirasi UX dari tscaps (AGPL) hanya pada level perilaku. Engine `@tscaps/engine` (MIT) boleh dipakai sebagai dependency jika perlu preview client-side.
