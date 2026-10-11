const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile !== "function") {
    throw new Error("Loading .env requires Node.js 22.0.0 or newer.");
  }
  process.loadEnvFile(envPath);
}

function readSupabaseConfig() {
  const urlValue = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  const missing = [];
  if (!urlValue) missing.push("SUPABASE_URL");
  if (!key) missing.push("SUPABASE_PUBLISHABLE_KEY");
  if (missing.length) {
    throw new Error(`Missing ${missing.join(" and ")}. Set them in .env using .env.example.`);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS project URL.");
  }
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname || parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash || parsedUrl.username || parsedUrl.password) {
    throw new Error("SUPABASE_URL must be a valid HTTPS project URL without a path, query, or credentials.");
  }

  let legacyRole = "";
  const jwtParts = key.split(".");
  if (jwtParts.length === 3) {
    try {
      legacyRole = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString("utf8")).role || "";
    } catch {
      // The format check below reports malformed keys without echoing their values.
    }
  }
  if (key.startsWith("sb_secret_") || legacyRole === "service_role") {
    throw new Error("SUPABASE_PUBLISHABLE_KEY must not be a secret or service-role key.");
  }
  const isPublishableKey = key.startsWith("sb_publishable_") && key.length > "sb_publishable_".length;
  if (!isPublishableKey && legacyRole !== "anon") {
    throw new Error("SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key.");
  }

  return { url: parsedUrl.origin, publishableKey: key };
}

let supabaseConfig;
try {
  supabaseConfig = readSupabaseConfig();
} catch (error) {
  console.error(`Supabase configuration error: ${error.message}`);
  process.exit(1);
}

const port = Number(process.env.PORT) || 4173;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/scripts/config.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(`export const supabaseConfig = Object.freeze(${JSON.stringify(supabaseConfig)});`);
    return;
  }

  const pathSegments = pathname.split(/[\\/]/).filter(Boolean);
  if (pathSegments.some((segment) => segment.startsWith("."))) {
    response.writeHead(404).end("Not found");
    return;
  }

  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Auth-Flow is available at http://127.0.0.1:${port}`);
});
