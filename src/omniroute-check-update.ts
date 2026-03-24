import { NextResponse } from "next/server";
import { execSync } from "child_process";

const OMNI_ROUTE_DIR = "/home/openclaw/omniroute-src";

export async function GET() {
  try {
    const currentCommit = execSync(`cd ${OMNI_ROUTE_DIR} && git rev-parse --short HEAD`, {
      encoding: "utf8",
    }).trim();
    
    const currentBranch = execSync(`cd ${OMNI_ROUTE_DIR} && git branch --show-current`, {
      encoding: "utf8",
    }).trim();
    
    execSync(`cd ${OMNI_ROUTE_DIR} && git fetch origin`, { encoding: "utf8" });
    
    const latestCommit = execSync(
      `cd ${OMNI_ROUTE_DIR} && git rev-parse --short origin/${currentBranch}`,
      { encoding: "utf8" }
    ).trim();
    
    const updateAvailable = currentCommit !== latestCommit;
    
    let commitsBehind = 0;
    if (updateAvailable) {
      try {
        const behind = execSync(
          `cd ${OMNI_ROUTE_DIR} && git rev-list --count HEAD..origin/${currentBranch}`,
          { encoding: "utf8" }
        ).trim();
        commitsBehind = parseInt(behind, 10) || 0;
      } catch {}
    }
    
    return NextResponse.json({
      current: currentCommit,
      latest: latestCommit,
      branch: currentBranch,
      updateAvailable,
      commitsBehind,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to check updates", message: (error as Error).message },
      { status: 500 }
    );
  }
}
