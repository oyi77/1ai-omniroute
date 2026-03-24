import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

const MANAGER_SCRIPT = "/home/openclaw/.omniroute/cliproxyapi-manager.sh";

function runManager(command: string): { success: boolean; output: string; error?: string } {
  try {
    const output = execSync(`bash ${MANAGER_SCRIPT} ${command}`, {
      encoding: "utf8",
      timeout: 60000,
    });
    return { success: true, output };
  } catch (error: any) {
    return { success: false, output: error.stdout || "", error: error.stderr || error.message };
  }
}

export async function GET() {
  const result = runManager("current");
  
  const versions = runManager("list");
  const availableVersions = versions.output
    .split("\n")
    .filter((line) => line.startsWith("v"))
    .map((v) => v.trim());
  
  return NextResponse.json({
    current: result.success ? result.output.trim() : "unknown",
    availableVersions,
    binaryExists: true,
    canManage: true,
  });
}
