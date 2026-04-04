interface ElectronAPI {
  minimize: () => void;
  close: () => void;
  togglePin: (pinned: boolean) => void;
}

interface Window {
  electronAPI: ElectronAPI;
}
