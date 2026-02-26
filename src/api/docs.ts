/** Scalar API reference UI served at /api/docs. */

/** Returns an HTML page that loads Scalar's API reference component. */
export function renderScalarDocs(specUrl: string): Response {
  const html = `<!doctype html>
<html>
<head>
  <title>Memory Graph API</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script id="api-reference" data-url="${specUrl}"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
