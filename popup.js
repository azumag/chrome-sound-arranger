// popup.js

// --- DOM Element References ---
const toggleButton = document.getElementById('toggleButton');
const statusDiv = document.getElementById('status');
const voiceEnhancementCheckbox = document.getElementById('voiceEnhancementCheckbox');
const noiseCancelCheckbox = document.getElementById('noiseCancelCheckbox');
const normalizeCheckbox = document.getElementById('normalizeCheckbox');

const eqSliders = [];
const eqValueSpans = [];

for (let i = 1; i <= 10; i++) {
  eqSliders.push(document.getElementById(`eq${i}Slider`));
  eqValueSpans.push(document.getElementById(`eq${i}Value`));
}

// Store current tab ID
let currentTabId = null;
// Store current settings to avoid redundant updates
let currentSettings = {};

// --- Initialization ---
// Get active tab and request initial status and settings
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs.length === 0) {
    handleError("Cannot find active tab.");
    return;
  }
  currentTabId = tabs[0].id;
  console.log("Current Tab ID:", currentTabId);

  // Request both status and settings
  Promise.all([
    sendMessageToBackground({ type: 'get-status', tabId: currentTabId }),
    sendMessageToBackground({ type: 'get-settings', tabId: currentTabId })
  ]).then(([statusResponse, settingsResponse]) => {
    if (statusResponse) {
      updateUI(statusResponse.status);
    } else {
      console.warn("No response for get-status. Assuming inactive.");
      updateUI('inactive');
    }
    if (settingsResponse) {
      currentSettings = settingsResponse; // Store initial settings
      updateSettingsUI(settingsResponse);
    } else {
      console.warn("No response for get-settings. Using default UI values.");
      // If no settings received, UI defaults might be okay, or request defaults
    }
  }).catch(error => {
    handleError(`Error getting initial state: ${error.message}`);
  });
});

// --- Event Listeners ---
// Toggle button for starting/stopping the filter entirely
toggleButton.addEventListener('click', async () => {
  if (!currentTabId) return;
  toggleButton.disabled = true;
  statusDiv.textContent = 'Processing...';
  const currentStatus = toggleButton.textContent.includes('Start') ? 'inactive' : 'active';

  sendMessageToBackground({ type: 'toggle-capture', tabId: currentTabId })
    .then(response => {
      if (response) {
        updateUI(response.newStatus);
        // Re-fetch settings if status changed, as defaults might apply on start
        if (response.newStatus === 'starting' || response.newStatus === 'active') {
            fetchAndUpdateSettings();
        }
      } else {
        console.warn("No response for toggle-capture. Re-fetching status.");
        refetchStatusAfterDelay(currentStatus);
      }
    })
    .catch(error => {
      handleError(`Error toggling capture: ${error.message}`, currentStatus);
    });
});

// Voice Enhancement Checkbox
voiceEnhancementCheckbox.addEventListener('change', () => {
  if (!currentTabId) return;
  const voiceEnhancementEnabled = voiceEnhancementCheckbox.checked;
  const newSettings = {
    ...currentSettings,
    voiceEnhancementEnabled: voiceEnhancementEnabled,
    noiseCancelEnabled: voiceEnhancementEnabled,
    normalizeEnabled: voiceEnhancementEnabled
  };
  sendSettingsUpdate(newSettings);
});

// Noise Cancellation Checkbox
noiseCancelCheckbox.addEventListener('change', () => {
  if (!currentTabId) return;
  const newSettings = { ...currentSettings, noiseCancelEnabled: noiseCancelCheckbox.checked };
  sendSettingsUpdate(newSettings);
});

// Normalization Checkbox
normalizeCheckbox.addEventListener('change', () => {
  if (!currentTabId) return;
  const newSettings = { ...currentSettings, normalizeEnabled: normalizeCheckbox.checked };
  sendSettingsUpdate(newSettings);
});

// EQ Sliders
const eqFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]; // Hz
for (let i = 0; i < 10; i++) {
  const slider = eqSliders[i];
  const valueSpan = eqValueSpans[i];
  const frequency = eqFrequencies[i];

  slider.addEventListener('input', () => updateEqValue(frequency, slider, valueSpan));
  slider.addEventListener('change', () => sendEqUpdate(`eq${i + 1}Gain`, slider.value));
}

// --- UI Update Functions ---
// Updates the main toggle button and status text, enables/disables settings controls
function updateUI(status) {
  console.log("Updating UI for status:", status);
  let settingsEnabled = false;
  switch (status) {
    case 'active':
      toggleButton.textContent = 'Stop Filter';
      statusDiv.textContent = 'Filter is active.';
      toggleButton.disabled = false;
      settingsEnabled = true;
      break;
    case 'inactive':
      toggleButton.textContent = 'Start Filter';
      statusDiv.textContent = 'Filter is inactive.';
      toggleButton.disabled = false;
      settingsEnabled = false;
      break;
    case 'starting':
      toggleButton.textContent = 'Starting...';
      statusDiv.textContent = 'Filter is starting...';
      toggleButton.disabled = true;
      settingsEnabled = false;
      break;
    case 'stopping':
      toggleButton.textContent = 'Stopping...';
      statusDiv.textContent = 'Filter is stopping...';
      toggleButton.disabled = true;
      settingsEnabled = false;
      break;
    default:
      toggleButton.textContent = 'Unknown State';
      statusDiv.textContent = 'Filter status is unknown.';
      toggleButton.disabled = false;
      settingsEnabled = false;
  }
  // Enable/disable settings controls based on filter status
  const voiceEnhancementEnabled = settingsEnabled && currentSettings.voiceEnhancementEnabled;
  voiceEnhancementCheckbox.disabled = !settingsEnabled;
  noiseCancelCheckbox.disabled = !voiceEnhancementEnabled;
  normalizeCheckbox.disabled = !voiceEnhancementEnabled;
  eqSliders.forEach(slider => slider.disabled = settingsEnabled && voiceEnhancementEnabled);
}

// Updates the checkboxes and sliders based on settings received from background
function updateSettingsUI(settings) {
  console.log("Updating settings UI:", settings);
  voiceEnhancementCheckbox.checked = settings.voiceEnhancementEnabled ?? true;
  noiseCancelCheckbox.checked = settings.noiseCancelEnabled ?? false; // Default to false if undefined
  normalizeCheckbox.checked = settings.normalizeEnabled ?? false; // Default to false if undefined

  for (let i = 0; i < 10; i++) {
    const slider = eqSliders[i];
    const valueSpan = eqValueSpans[i];
    const gainKey = `eq${i + 1}Gain`;
    updateSliderUI(slider, valueSpan, settings[gainKey] ?? 0);
  }
}

// Helper to update a single slider and its value display
function updateSliderUI(slider, valueSpan, value) {
    const numValue = Number(value);
    slider.value = numValue;
    valueSpan.textContent = `${numValue} dB`;
}

// Updates the EQ value display in real-time as the slider moves
function updateEqValue(frequency, slider, valueSpan) {
  valueSpan.textContent = `${slider.value} dB`;
}

// --- Communication Functions ---
// Helper function to send messages to background script and handle potential errors
function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        // Handle specific errors like "Receiving end does not exist"
        if (chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
          console.warn("Background script not ready or popup closed.");
          // Resolve with null or a specific indicator if needed, or reject
          resolve(null); // Or reject(new Error("Background not available"));
        } else {
          reject(chrome.runtime.lastError);
        }
      } else {
        resolve(response);
      }
    });
  });
}

// Sends the complete settings object to the background
function sendSettingsUpdate(newSettings) {
  if (!currentTabId) return;
  console.log("Sending settings update:", newSettings);
  currentSettings = newSettings; // Optimistically update local state
  sendMessageToBackground({ type: 'update-settings', tabId: currentTabId, settings: newSettings })
    .catch(error => handleError(`Error updating settings: ${error.message}`));
    // No need to update UI here, assuming background confirms or sends update if needed
}

// Sends an update for a single EQ gain value
function sendEqUpdate(gainKey, value) {
  if (!currentTabId) return;
  const numValue = Number(value);
  // Update only the specific EQ gain in the local settings copy
  const newSettings = { ...currentSettings, [gainKey]: numValue };
  sendSettingsUpdate(newSettings); // Send the whole updated settings object
}

// Fetches current settings from background and updates UI
function fetchAndUpdateSettings() {
    if (!currentTabId) return;
    sendMessageToBackground({ type: 'get-settings', tabId: currentTabId })
        .then(settingsResponse => {
            if (settingsResponse) {
                currentSettings = settingsResponse;
                updateSettingsUI(settingsResponse);
            } else {
                console.warn("Could not fetch settings after status change.");
            }
        })
        .catch(error => handleError(`Error fetching settings: ${error.message}`));
}

// Re-fetches status after a delay if no response was received
function refetchStatusAfterDelay(previousStatus) {
  statusDiv.textContent = 'Processing... (waiting for confirmation)';
  setTimeout(() => {
    if (!currentTabId) return;
    sendMessageToBackground({ type: 'get-status', tabId: currentTabId })
      .then(statusResponse => {
        if (statusResponse) {
          updateUI(statusResponse.status);
          // Fetch settings as well if now active
          if (statusResponse.status === 'active') {
              fetchAndUpdateSettings();
          }
        } else {
          updateUI('inactive'); // Assume inactive if still no response
        }
      })
      .catch(error => handleError(`Error re-fetching status: ${error.message}`, previousStatus));
  }, 1000); // 1 second delay
}

// --- Error Handling ---
function handleError(message, revertStatus = null) {
  console.error(message);
  statusDiv.textContent = `Error: ${message.split(': ')[1] || message}`; // Show cleaner message
  toggleButton.disabled = false; // Re-enable button on error
  if (revertStatus) {
    updateUI(revertStatus); // Attempt to revert UI to previous state
  }
  // Optionally disable settings controls on error too
  noiseCancelCheckbox.disabled = true;
  normalizeCheckbox.disabled = true;
  eqSliders.forEach(slider => slider.disabled = true);
}


// --- Background Message Listener (Optional but good practice) ---
// Listens for status updates pushed from the background (e.g., if processing stops unexpectedly)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ensure message is from the background script (check sender.id or a specific property)
  if (sender.id !== chrome.runtime.id) return false;

  if (message.type === 'status-update' && message.tabId === currentTabId) {
    console.log("Received status update from background:", message.status);
    updateUI(message.status);
    // Fetch settings if status changed to active
    if (message.status === 'active') {
        fetchAndUpdateSettings();
    }
  } else if (message.type === 'settings-update' && message.tabId === currentTabId) {
      // If background pushes settings updates (e.g., after loading defaults)
      console.log("Received settings update from background:", message.settings);
      currentSettings = message.settings;
      updateSettingsUI(message.settings);
  }
  return false; // Allow other listeners to process
});

console.log("Popup script loaded.");