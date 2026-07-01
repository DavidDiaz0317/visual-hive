export const fallbackControlPlaneHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Visual Hive Control Plane</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #090d10;
        color: #eef3f6;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 560px;
        padding: 24px;
        border: 1px solid #2a333d;
        border-radius: 8px;
        background: #13191f;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }
      p {
        margin: 0;
        color: #a6b1bb;
      }
      code {
        color: #f2b84b;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Visual Hive Control Plane</h1>
      <p>The React UI bundle was not found. Run <code>npm run build -w @visual-hive/control-plane</code> and restart the server.</p>
    </main>
  </body>
</html>`;
