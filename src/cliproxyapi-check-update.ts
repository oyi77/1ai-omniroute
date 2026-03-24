import { NextResponse } from "next/server";
import { execSync } from "child_process";

const CLI_PROXY_DIR = "/home/openclaw/CLIProxyAPI";

export async function GET() {
  try {
    const currentVersion = execSync(
      `cd ${CLI_PROXY_DIR} && ./cli-proxy-api 2>&1 | grep -o "Version: [^,]*" | cut -d' ' -f2`,
      { encoding: "utf8" }
    ).trim() || "dev";
    
    execSync(`cd ${CLI_PROXY_DIR} && git fetch --tags`, { encoding: "utf8" });
    
    const tags = execSync(`cd ${CLI_PROXY_DIR} && git tag -l | sort -V`, {
      encoding: "utf8",
    });
    
    const versions = tags.split("\n").filter((v) => v.startsWith("v"));
    const latestVersion = versions[versions.length - 1] || currentVersion;
    
    const updateAvailable = latestVersion !== currentVersion;
    
    return NextResponse.json({
      current: currentVersion,
      latestVersion,
      updateAvailable,
      totalVersions: versions.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to check updates", message: (error as Error).message },
      { status: 500 }
    );
  }
}
