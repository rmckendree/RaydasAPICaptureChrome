# RaydasAPICaptureChrome

A Chrome DevTools extension that captures network requests from the page you're inspecting and exports them as a Postman collection, Bruno `.bru` files, plain request/response JSON, or cURL commands.

## Features

- Adds an **API Capture** panel to Chrome DevTools that lists every finished request (method, status, host, path).
- Filter by host, pause capture, and select the requests you want.
- Click a row to see the full request and response as JSON.
- **Auto-decode**: parses JSON bodies (including JSON nested inside strings), form-encoded bodies, query strings, and JWTs in request headers.
- Export selected requests as:
  - Postman Collection v2.1 JSON (optionally with captured responses)
  - Bruno collection (`bruno.json` plus one `.bru` file per request)
  - Simple JSON (request + response)
- Copy selected requests as JSON or as cURL commands.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open DevTools on any page and choose the **API Capture** tab.

## Usage

1. With the panel open, use the page normally; requests appear as they finish.
2. Tick the checkboxes for the requests you want.
3. Choose an export format and click **Export selected**, or use **Copy selected as JSON** / **Copy as cURL**.

Bruno exports download as several files. Put them into one folder and open that folder in Bruno.

## Privacy

Everything stays in your browser. The extension requests no permissions and sends nothing anywhere. Captured requests can include cookies, auth headers and tokens, so review exports before sharing them.

## License

[MIT](LICENSE) © Rayda Mckendree
