import { useCallback, useEffect, useState } from "react";

export interface UpdateInfo {
  available: boolean;
  latest: string;
  notesUrl: string;
  downloadUrl: string;
}

// Subscribes to the main-process update check (GitHub latest release vs the
// running version). Exposes the available update (or null), plus actions to
// skip a version and open the download link.
export function useUpdateCheck() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getUpdate) return;
    api.getUpdate().then(setUpdate);
    return api.onUpdateAvailable?.(setUpdate);
  }, []);

  const skipUpdate = useCallback((version: string) => {
    window.electronAPI?.skipVersion?.(version).then(setUpdate);
  }, []);

  const open = useCallback((url: string) => {
    window.electronAPI?.openExternal?.(url);
  }, []);

  return { update, skipUpdate, open };
}
