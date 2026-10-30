const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("LordOfTheGamesAPI", {
  launchMinecraft: (payload) => ipcRenderer.invoke("launch-minecraft", payload),
  getLaunchState: () => ipcRenderer.invoke("get-launch-state"),
  saveLaunchSettings: (payload) => ipcRenderer.invoke("save-launch-settings", payload),
  installMinecraft: (payload) => ipcRenderer.invoke("install-minecraft", payload),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  authLogin: (payload) => ipcRenderer.invoke("auth-login", payload),
  authRegister: (payload) => ipcRenderer.invoke("auth-register", payload),
  authMe: () => ipcRenderer.invoke("auth-me"),
  authUpdate: (payload) => ipcRenderer.invoke("auth-update", payload),
  authLogout: () => ipcRenderer.invoke("auth-logout"),
  authChangePassword: (payload) => ipcRenderer.invoke("auth-change-password", payload),
  authUploadSkin: (payload) => ipcRenderer.invoke("auth-upload-skin", payload),
  authUploadAvatar: (formData) => ipcRenderer.invoke("auth-upload-avatar", formData),
  authTgLogin: (payload) => ipcRenderer.invoke("auth-tg-login", payload),
  authTgBind: (payload) => ipcRenderer.invoke("auth-tg-bind", payload),
  authTgConfirmStatus: (payload) => ipcRenderer.invoke("auth-tg-confirm-status", payload),
  authTgConfirm: (payload) => ipcRenderer.invoke("auth-tg-confirm", payload),
  onInstallProgress: (cb) => {
    const listener = (_event, progress) => cb && cb(progress);
    ipcRenderer.on("install-progress", listener);
    return () => ipcRenderer.removeListener("install-progress", listener);
  }
});