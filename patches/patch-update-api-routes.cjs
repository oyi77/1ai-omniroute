// patches/patch-update-api-routes.cjs
// Fixes update API routes to:
// 1. Stream logs as NDJSON
// 2. Use --ignore-scripts for npm install (fixes husky error)
// 3. Use pm2 restart instead of systemctl
// 4. Pass -y flag for CLIProxyAPI non-interactive mode

module.exports = async function (omniroute) {
  const fs = omniroute.require("fs");
  const path = omniroute.require("path");
  const cwd = omniroute.process.cwd();

  // ============================================
  // 1. Fix OmniRoute update route
  // ============================================
  const omnirouteUpdatePath = path.join(
    cwd,
    "src/app/api/openclaw/omniroute/update/route.ts",
  );

  if (fs.existsSync(omnirouteUpdatePath)) {
    const code = fs.readFileSync(omnirouteUpdatePath, "utf8");

    // Check if already patched
    if (!code.includes("--ignore-scripts") || !code.includes("pm2 restart")) {
      const newCode = `import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { appendFileSync } from "fs";

const OMNI_ROUTE_DIR = "/home/openclaw/omniroute-src";
const LOG_FILE = "/home/openclaw/.omniroute/omniroute-update.log";

function log(message) {
  const timestamp = new Date().toISOString();
  try {
    appendFileSync(LOG_FILE, \`[\${timestamp}] \${message}\\n\`);
  } catch {}
}

const SHELL_ENV = {
  ...process.env,
  HOME: "/home/openclaw",
  PATH: \`/home/openclaw/.local/share/fnm:\${process.env.PATH}\`,
};

function runShell(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", cmd], {
      cwd: OMNI_ROUTE_DIR,
      env: SHELL_ENV,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || \`Exit code \${code}\`));
    });
    child.on("error", reject);
  });
}

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = async (logMsg, progress) => {
    await writer.write(
      encoder.encode(JSON.stringify({ log: logMsg, progress }) + "\\n")
    );
  };

  const fail = async (msg) => {
    log(\`FAILED: \${msg}\`);
    try {
      await writer.write(encoder.encode(JSON.stringify({ error: msg }) + "\\n"));
      await writer.close();
    } catch {}
  };

  (async () => {
    try {
      await send("Fetching current branch...", 5);
      const branch = (await runShell("git branch --show-current")) || "main";
      await send(\`Branch: \${branch}\`, 10);
      log(\`Update started on branch \${branch}\`);

      await send("Creating backup (git stash)...", 15);
      await runShell(\`git stash push -m "pre-update-\$(date +%Y%m%d-%H%M%S)"\`);
      await send("Backup done ✓", 20);

      await send("Pulling latest changes...", 25);
      const pullOut = await runShell(\`git pull origin \${branch}\`);
      await send(\`Pull complete: \${pullOut.split("\\n")[0]}\`, 40);

      await send("Installing dependencies (--ignore-scripts)...", 45);
      log("npm install --ignore-scripts");
      await runShell(
        \`export PATH="$HOME/.local/share/fnm:$PATH" && eval "\$(fnm env)" && fnm use 22 && npm install --ignore-scripts\`
      );
      await send("Dependencies installed ✓", 60);

      await send("Rebuilding better-sqlite3 for Node 22...", 65);
      await runShell(
        \`export PATH="$HOME/.local/share/fnm:$PATH" && eval "\$(fnm env)" && fnm use 22 && npm rebuild better-sqlite3\`
      );
      await send("Rebuild done ✓", 75);

      await send("Building application (npm run build)...", 80);
      log("npm run build");
      await runShell(
        \`export PATH="$HOME/.local/share/fnm:$PATH" && eval "\$(fnm env)" && fnm use 22 && npm run build\`
      );
      await send("Build done ✓", 90);

      await send("Restarting via pm2...", 95);
      log("pm2 restart omniroute");
      await runShell("pm2 restart omniroute");
      await send("Service restarted ✓", 98);

      await new Promise((r) => setTimeout(r, 2000));
      await send("✓ Update completed successfully!", 100);
      log("Update completed successfully");
      await writer.close();
    } catch (err) {
      await fail(err.message || "Unknown error");
    }
  })();

  return new NextResponse(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
`;
      fs.writeFileSync(omnirouteUpdatePath, newCode, "utf8");
      omniroute.logger.info(
        "[patch] patch-update-api-routes: OmniRoute update route patched.",
      );
    } else {
      omniroute.logger.info(
        "[patch] patch-update-api-routes: OmniRoute update route already patched.",
      );
    }
  }

  // ============================================
  // 2. Fix CLIProxyAPI update route
  // ============================================
  const cliproxyapiUpdatePath = path.join(
    cwd,
    "src/app/api/openclaw/cliproxyapi/update/route.ts",
  );

  if (fs.existsSync(cliproxyapiUpdatePath)) {
    const code = fs.readFileSync(cliproxyapiUpdatePath, "utf8");

    if (!code.includes("update -y") || !code.includes("spawn")) {
      const newCode = `import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { appendFileSync } from "fs";

const MANAGER_SCRIPT = "/home/openclaw/.omniroute/cliproxyapi-manager.sh";
const LOG_FILE = "/home/openclaw/.omniroute/cliproxyapi-manager.log";

function log(message) {
  const timestamp = new Date().toISOString();
  try {
    appendFileSync(LOG_FILE, \`[\${timestamp}] \${message}\\n\`);
  } catch {}
}

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = async (logMsg, progress) => {
    await writer.write(
      encoder.encode(JSON.stringify({ log: logMsg, progress }) + "\\n")
    );
  };

  const fail = async (msg) => {
    log(\`FAILED: \${msg}\`);
    try {
      await writer.write(encoder.encode(JSON.stringify({ error: msg }) + "\\n"));
      await writer.close();
    } catch {}
  };

  (async () => {
    try {
      await send("Starting CLIProxyAPI update...", 5);
      log("CLIProxyAPI update started");

      await send("Fetching latest version...", 15);

      const child = spawn("bash", [MANAGER_SCRIPT, "update", "-y"], {
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        const lines = data.toString().split("\\n").filter(Boolean);
        for (const line of lines) {
          log(\`[stdout] \${line}\`);
          stdout += line + "\\n";
        }
      });

      child.stderr.on("data", (data) => {
        const lines = data.toString().split("\\n").filter(Boolean);
        for (const line of lines) {
          log(\`[stderr] \${line}\`);
          stderr += line + "\\n";
        }
      });

      child.on("close", async (code) => {
        try {
          if (code === 0) {
            const outputLines = stdout.split("\\n").filter(Boolean);
            let progress = 30;
            const progressStep = Math.floor(60 / Math.max(1, outputLines.length));

            for (const line of outputLines) {
              await send(line, Math.min(95, progress));
              progress += progressStep;
            }

            await send("✓ CLIProxyAPI updated successfully!", 100);
            log("CLIProxyAPI update completed successfully");
          } else {
            const errorMsg = stderr || stdout || \`Exit code \${code}\`;
            await send(\`Update failed: \${errorMsg}\`, undefined);
            log(\`CLIProxyAPI update failed: \${errorMsg}\`);
          }
          await writer.close();
        } catch (e) {
          log(\`Error in close handler: \${e.message}\`);
        }
      });

      child.on("error", async (err) => {
        await fail(err.message);
      });
    } catch (err) {
      await fail(err.message || "Unknown error");
    }
  })();

  return new NextResponse(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
`;
      fs.writeFileSync(cliproxyapiUpdatePath, newCode, "utf8");
      omniroute.logger.info(
        "[patch] patch-update-api-routes: CLIProxyAPI update route patched.",
      );
    } else {
      omniroute.logger.info(
        "[patch] patch-update-api-routes: CLIProxyAPI update route already patched.",
      );
    }
  }

  // ============================================
  // 3. Fix CLIProxyAPI switch route
  // ============================================
  const cliproxyapiSwitchPath = path.join(
    cwd,
    "src/app/api/openclaw/cliproxyapi/switch/route.ts",
  );

  if (fs.existsSync(cliproxyapiSwitchPath)) {
    const code = fs.readFileSync(cliproxyapiSwitchPath, "utf8");

    if (!code.includes("spawn") || !code.includes("ndjson")) {
      const newCode = `import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { appendFileSync } from "fs";

const MANAGER_SCRIPT = "/home/openclaw/.omniroute/cliproxyapi-manager.sh";
const LOG_FILE = "/home/openclaw/.omniroute/cliproxyapi-manager.log";

function log(message) {
  const timestamp = new Date().toISOString();
  try {
    appendFileSync(LOG_FILE, \`[\${timestamp}] \${message}\\n\`);
  } catch {}
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { version } = body;
  if (!version) {
    return NextResponse.json({ error: "Version is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = async (logMsg, progress) => {
    await writer.write(
      encoder.encode(JSON.stringify({ log: logMsg, progress }) + "\\n")
    );
  };

  const fail = async (msg) => {
    log(\`FAILED: \${msg}\`);
    try {
      await writer.write(encoder.encode(JSON.stringify({ error: msg }) + "\\n"));
      await writer.close();
    } catch {}
  };

  (async () => {
    try {
      await send(\`Switching to version \${version}...\`, 10);
      log(\`CLIProxyAPI switch to \${version} started\`);

      const child = spawn("bash", [MANAGER_SCRIPT, "switch", version], {
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        const lines = data.toString().split("\\n").filter(Boolean);
        for (const line of lines) {
          log(\`[stdout] \${line}\`);
          stdout += line + "\\n";
        }
      });

      child.stderr.on("data", (data) => {
        const lines = data.toString().split("\\n").filter(Boolean);
        for (const line of lines) {
          log(\`[stderr] \${line}\`);
          stderr += line + "\\n";
        }
      });

      child.on("close", async (code) => {
        try {
          if (code === 0) {
            const outputLines = stdout.split("\\n").filter(Boolean);
            let progress = 30;
            const progressStep = Math.floor(60 / Math.max(1, outputLines.length));

            for (const line of outputLines) {
              await send(line, Math.min(95, progress));
              progress += progressStep;
            }

            await send(\`✓ Switched to \${version} successfully!\`, 100);
            log(\`CLIProxyAPI switch to \${version} completed\`);
          } else {
            const errorMsg = stderr || stdout || \`Exit code \${code}\`;
            await send(\`Switch failed: \${errorMsg}\`, undefined);
            log(\`CLIProxyAPI switch failed: \${errorMsg}\`);
          }
          await writer.close();
        } catch (e) {
          log(\`Error in close handler: \${e.message}\`);
        }
      });

      child.on("error", async (err) => {
        await fail(err.message);
      });
    } catch (err) {
      await fail(err.message || "Unknown error");
    }
  })();

  return new NextResponse(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
`;
      fs.writeFileSync(cliproxyapiSwitchPath, newCode, "utf8");
      omniroute.logger.info(
        "[patch] patch-update-api-routes: CLIProxyAPI switch route patched.",
      );
    } else {
      omniroute.logger.info(
        "[patch] patch-update-api-routes: CLIProxyAPI switch route already patched.",
      );
    }
  }

  // ============================================
  // 4. Export UpdateLogModal from index
  // ============================================
  const indexPath = path.join(cwd, "src/shared/components/index.tsx");
  if (fs.existsSync(indexPath)) {
    let indexCode = fs.readFileSync(indexPath, "utf8");
    if (!indexCode.includes("UpdateLogModal")) {
      // Add export before the layouts section
      const layoutsPos = indexCode.indexOf("// Layouts");
      if (layoutsPos > -1) {
        indexCode =
          indexCode.slice(0, layoutsPos) +
          'export { default as UpdateLogModal } from "./UpdateLogModal";\n' +
          indexCode.slice(layoutsPos);
        fs.writeFileSync(indexPath, indexCode, "utf8");
        omniroute.logger.info(
          "[patch] patch-update-api-routes: Added UpdateLogModal export to index.",
        );
      }
    }
  }
};
