"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ProxyConfigModal } from "@/shared/components";
import { useTranslations } from "next-intl";
import ProxyRegistryManager from "./ProxyRegistryManager";

export default function ProxyTab() {
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [globalProxy, setGlobalProxy] = useState(null);
  const [cliProxyStatus, setCliProxyStatus] = useState(null);
  const mountedRef = useRef(true);
  const t = useTranslations("settings");
  const tc = useTranslations("common");

  const loadGlobalProxy = async () => {
    try {
      const res = await fetch("/api/settings/proxy?level=global");
      if (res.ok) {
        const data = await res.json();
        setGlobalProxy(data.proxy || null);
      }
    } catch {}
  };

  const loadCliProxyStatus = async () => {
    try {
      const res = await fetch("/api/openclaw/status");
      if (res.ok) {
        const data = await res.json();
        setCliProxyStatus(data.cliproxyapi || null);
      }
    } catch {}
  };

  useEffect(() => {
    mountedRef.current = true;
    async function init() {
      try {
        const [proxyRes] = await Promise.all([
          fetch("/api/settings/proxy?level=global"),
          loadCliProxyStatus(),
        ]);
        if (!mountedRef.current) return;
        if (proxyRes.ok) {
          const data = await proxyRes.json();
          if (mountedRef.current) setGlobalProxy(data.proxy || null);
        }
      } catch {}
    }
    init();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <>
      <div className="flex flex-col gap-6">
        <Card className="p-0 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-xl text-primary" aria-hidden="true">
                vpn_lock
              </span>
              <h2 className="text-lg font-bold">{t("globalProxy")}</h2>
            </div>
            <p className="text-sm text-text-muted mb-4">{t("globalProxyDesc")}</p>
            <div className="flex items-center gap-3">
              {globalProxy ? (
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded text-xs font-bold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {globalProxy.type}://{globalProxy.host}:{globalProxy.port}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-text-muted">{t("noGlobalProxy")}</span>
              )}
              <Button
                size="sm"
                variant={globalProxy ? "secondary" : "primary"}
                icon="settings"
                onClick={() => {
                  loadGlobalProxy();
                  setProxyModalOpen(true);
                }}
              >
                {globalProxy ? tc("edit") : t("configure")}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-xl text-purple-500" aria-hidden="true">
                swap_horiz
              </span>
              <h2 className="text-lg font-bold">CLIProxyAPI Sidecar</h2>
            </div>
            <p className="text-sm text-text-muted mb-4">
              OAuth proxy for Antigravity and Claude providers. Routes failed requests automatically.
            </p>
            <div className="flex items-center gap-3">
              {cliProxyStatus ? (
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-bold uppercase border ${
                      cliProxyStatus.running
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : "bg-red-500/15 text-red-400 border-red-500/30"
                    }`}
                  >
                    {cliProxyStatus.running ? "RUNNING" : "STOPPED"}
                  </span>
                  <span className="text-sm text-text-muted">
                    Port 8317
                  </span>
                </div>
              ) : (
                <span className="text-sm text-text-muted">Checking status...</span>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon="refresh"
                onClick={loadCliProxyStatus}
              >
                Refresh
              </Button>
            </div>
          </div>
        </Card>

        <ProxyRegistryManager />
      </div>

      <ProxyConfigModal
        isOpen={proxyModalOpen}
        onClose={() => setProxyModalOpen(false)}
        level="global"
        levelLabel={t("globalLabel")}
        onSaved={loadGlobalProxy}
      />
    </>
  );
}
