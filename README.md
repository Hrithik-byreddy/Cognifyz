# Cognifyz Workbench

A single browser app that brings the eight Cognifyz full-stack exercises together:

1. Basic server registration form
2. Client and server validation
3. Responsive user interface
4. Dynamic DOM task board
5. CRUD REST API
6. Registration, login, and protected profile
7. Open-Meteo weather lookup
8. Server-side TTL cache and background job queue

The code is organized for browsing: `server.js` contains the Node API, while `public/index.html`, `public/styles.css`, and `public/app.js` contain the page, styles, and browser behavior.

## Run locally

Requires Node.js 18 or newer. From this folder, run:

```powershell
node server.js
```

Then open [http://localhost:3000](http://localhost:3000). Stop the server with `Ctrl+C`.

With the server running, execute `node test/smoke.js` in a second terminal to verify the API workflows.

The app has no package dependencies. The forms, API, CRUD records, demo users, sessions, cache, and queue run through one local Node server. Most server-side demo data is in memory and resets when the process restarts; the dynamic task board is stored in the browser's local storage. Weather lookup needs an internet connection to reach Open-Meteo.

Authentication is an educational example: passwords are scrypt-hashed and API requests use bearer tokens, but user/session data is in memory and tokens are stored in browser local storage. Do not use this implementation for production accounts.

## Publish on Render

The `render.yaml` Blueprint config is ready. Push this folder to a GitHub repository, then create a Blueprint in Render and connect that repository. Render will build the Node service and assign its public URL. The repository must be accessible to Render; choose private visibility if you do not want the source public.
