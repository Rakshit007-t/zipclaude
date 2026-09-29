import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import net from "net";
import fs from "fs";
import https from "https";

function canUsePort(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort: number) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await canUsePort(port)) {
      return port;
    }
  }

  return startPort + 20;
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const hmrPort = await findAvailablePort(24678);

  // Security: disable Express signature and apply standard headers
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    next();
  });

  // Transparent Appwrite proxy for staging to bypass certificate authority mismatch
  app.use("/appwrite-v1", (req, res) => {
    const upstreamHost = process.env.APPWRITE_UPSTREAM_HOSTNAME || "ca-zipright-appwrite.calmfield-d6fa58ac.centralindia.azurecontainerapps.io";
    const hostHeader = process.env.APPWRITE_UPSTREAM_HOST_HEADER || "appwrite.zipright.in";
    const options = {
      hostname: upstreamHost,
      port: Number(process.env.APPWRITE_UPSTREAM_PORT) || 443,
      path: "/v1" + req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: hostHeader,
      },
      rejectUnauthorized: false,
    };
    const proxyReq = https.request(options, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      if (headers["set-cookie"]) {
        const rawCookies = Array.isArray(headers["set-cookie"])
          ? headers["set-cookie"]
          : [headers["set-cookie"]];
        headers["set-cookie"] = rawCookies.map((cookie: string) =>
          cookie
            .replace(/domain=[^;]+;?\s*/gi, "")
            .replace(/secure;?\s*/gi, "")
            .replace(/samesite=none;?\s*/gi, "SameSite=Lax;")
        );
      }
      res.writeHead(proxyRes.statusCode || 500, headers);
      proxyRes.pipe(res, { end: true });
    });
    proxyReq.on("error", (err) => {
      console.error("Appwrite proxy error:", err);
      res.status(502).json({ message: "Appwrite proxy error" });
    });
    req.pipe(proxyReq, { end: true });
  });

  // API routes FIRST
  app.use(express.json({ limit: "200kb" }));
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { port: hmrPort },
        watch: {
          ignored: [
            "**/.chrome-debug-profile/**",
            "**/*.log",
            "**/dist/**",
            "**/.git/**",
            "**/.vscode/**",
          ],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
