const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const PhoneManager = require('./phone-manager');

// Disable hardware acceleration for compatibility
app.disableHardwareAcceleration();

// Create phone manager
const phoneManager = new PhoneManager();

// Make it accessible to renderer
global.phoneManager = phoneManager;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#000000'
  });

  win.loadFile('index.html');
  return win;
}

app.whenReady().then(async () => {
  const win = createWindow();

  // Listen for hyperspeed state changes from renderer
  ipcMain.on('hyperspeed-changed', (event, isActive) => {
    phoneManager.setHyperspeedActive(isActive);
  });

  // Listen for manual outbound call trigger
  ipcMain.on('trigger-outbound-call', (event) => {
    console.log('Manual outbound call triggered (Q key pressed)');
    const audioFile = phoneManager.getRandomAudioFile();
    if (audioFile) {
      phoneManager.makeCall(audioFile);
    } else {
      console.warn('No audio file available for outbound call');
    }
  });

  // Start phone manager
  try {
    await phoneManager.start();

    // Forward phone state changes to renderer
    phoneManager.on('state-changed', (data) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('phone-state-changed', data);
      }
    });

    phoneManager.startAutoCalling(60); // Call every 60 seconds
    console.log('Phone manager started - will call phone every 60 seconds');
  } catch (error) {
    console.error('Failed to start phone manager:', error);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  phoneManager.stopAutoCalling();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
