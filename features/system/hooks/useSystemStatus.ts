"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/features/system/api/system-client";
import type { ServerStatus } from "@/features/system/model/system-types";

export function useSystemStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then(() => setStatus("ready"))
      .catch(() => setStatus("demo"));
    return () => controller.abort();
  }, []);

  return status;
}
