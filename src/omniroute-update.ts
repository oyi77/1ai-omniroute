import { NextResponse } from "next/server";
import { execSync, spawn } from "child_process";
import path from "path";

const OMNI_ROUTE_DIR = "/home/openclaw/omniroute-src";
const LOG_FILE = "/home/openclaw/.omniroute/omniroute-update.log";

function log(message: string) {
  const timestamp = new Date().toISOString();
  execSync(`echo "[${timestamp}] ${message}" | tee -a ${LOG_FILE}`);
}

export async function POST() {
  try {
    log("Starting OmniRoute update...");
    
    const currentBranch = execSync(`cd ${OMNI_ROUTE_DIR} && git branch --show-current`, {
      encoding: "utf8",
    }).trim();
    
    log(`Current branch: ${currentBranch}`);
    
    const backupResult = execSync(
      `cd ${OMNI_ROUTE_DIR} && git stash push -m "pre-update-backup-$(date +%Y%m%d-%H%M%S)"`,
      { encoding: "utf8" }
    );
    log("Backup created via git stash");
    
    log("Pulling latest changes...");
    const pullOutput = execSync(
      `cd ${OMNI_ROUTE_DIR} && git pull origin ${currentBranch}`,
      { encoding: "utf8" }
    );
    log("Pull complete: " + pullOutput.substring(0, 200));
    
    log("Installing dependencies...");
    const npmInstall = execSync(
      `export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env)" && fnm use 22 && cd ${OMNI_ROUTE_DIR} && npm install`,
      { encoding: "utf8", timeout: 300000 }
    );
    log("Dependencies installed");
    
    log("Rebuilding better-sqlite3...");
    const rebuild = execSync(
      `export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env)" && fnm use 22 && cd ${OMNI_ROUTE_DIR} && npm rebuild better-sqlite3`,
      { encoding: "utf8", timeout: 120000 }
    );
    log("Rebuild complete");
    
    log("Building...");
    const build = execSync(
      `export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env)" && fnm use 22 && cd ${OMNI_ROUTE_DIR} && npm run build`,
      { encoding: "utf8", timeout: 300000 }
    );
    log("Build complete");
    
    log("Restarting service...");
    execSync("sudo systemctl restart omniroute");
    log("Service restarted");
    
    return NextResponse.json({
      success: true,
      message: "Update complete! OmniRoute has been updated and restarted.",
    });
  } catch (error: any) {
    log("Error: " + error.message);
    return NextResponse.json(
      {
        success: false,
        message: "Update failed: " + (error.stderr || error.message),
      },
      { status: 500 }
    );
  }
}
