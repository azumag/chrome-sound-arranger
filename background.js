// background.js

// 拡張機能アイコンクリック時の処理
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked on tab:', tab.id);
  await toggleCapture(tab.id);
});

// Offscreen Document が存在するかどうかを確認する関数
async function hasOffscreenDocument(path) {
  // chrome.runtime.getContexts() を使って既存の Offscreen Document を検索
  // 注: Manifest V3 では、特定のパスを持つ Offscreen Document が存在するかどうかを直接確認する方法が推奨されている
  // しかし、API の制限により、現在アクティブなコンテキストをフィルタリングする必要がある
  const offscreenUrl = chrome.runtime.getURL(path);
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl] // このフィルタは現在 (Chrome 123時点) では完全には機能しない可能性がある
    });
    // contexts 配列をさらにフィルタリングする必要があるかもしれない
    return contexts.some(context => context.documentUrl === offscreenUrl);
  } catch (error) {
    // getContexts が利用できない古いバージョンの Chrome も考慮 (ただし Manifest V3 なので比較的新しいはず)
    console.warn("Could not check for existing offscreen document:", error);
    return false;
  }
}


// 音声キャプチャと処理の状態を管理する Map (キー: tabId, 値: { status: 'active' | 'inactive' | 'starting' | 'stopping' })
const capturingTabs = new Map();
// 各タブのフィルター設定を管理する Map (キー: tabId, 値: settingsObject)
const tabSettings = new Map();

// デフォルトのフィルター設定
const defaultSettings = {
  voiceEnhancementEnabled: true, // デフォルトでボイスエンハンスを有効にするか？
  noiseCancelEnabled: true, // デフォルトでノイズキャンセルを有効にするか？
  normalizeEnabled: true,   // デフォルトでノーマライズを有効にするか？
  eq1Gain: 0,
  eq2Gain: 0,
  eq3Gain: 0,
  eq4Gain: 0,
  eq5Gain: 0,
  eq6Gain: 0,
  eq7Gain: 0,
  eq8Gain: 0,
  eq9Gain: 0,
  eq10Gain: 0,
};

// 指定されたタブの設定を取得する関数 (なければデフォルトを返す)
function getSettingsForTab(tabId) {
  return tabSettings.get(tabId) || { ...defaultSettings }; // デフォルトのコピーを返す
}

// 音声キャプチャの開始/停止を切り替える関数
async function toggleCapture(tabId) {
  if (capturingTabs.has(tabId) && capturingTabs.get(tabId).status !== 'inactive') {
    console.log(`Stopping capture for tab ${tabId}`);
    await stopCapture(tabId);
    // アイコン変更は stopCapture 内またはメッセージ受信時に行う
  } else {
    console.log(`Starting capture for tab ${tabId}`);
    await startCapture(tabId);
    // アイコン変更は startCapture 内またはメッセージ受信時に行う
  }
}

// 音声キャプチャを開始する関数 (Offscreen Document を利用)
async function startCapture(tabId) {
  // すでに開始中またはアクティブなら何もしない
  if (capturingTabs.has(tabId) && capturingTabs.get(tabId).status !== 'inactive') {
    console.log(`Capture already active or starting for tab ${tabId}`);
    return;
  }

  capturingTabs.set(tabId, { status: 'starting' });
  // 仮のアイコンを設定 (開始中を示すなど) - アイコンファイルがまだないのでコメントアウト
  // chrome.action.setIcon({ path: "images/icon_starting.png", tabId: tabId });

  try {
    // Offscreen Document を作成または取得
    const offscreenDocumentPath = 'offscreen.html';
    if (!(await hasOffscreenDocument(offscreenDocumentPath))) {
      console.log('Creating offscreen document');
      await chrome.offscreen.createDocument({
        url: offscreenDocumentPath,
        reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK], // USER_MEDIA と AUDIO_PLAYBACK を理由とする
        justification: 'Audio processing and playback require an Offscreen Document.',
      });
      console.log('Offscreen document created.');
    } else {
        console.log('Offscreen document already exists.');
    }

    // 1. ストリームIDを取得
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    console.log(`Obtained stream ID ${streamId} for tab ${tabId}`);

    // 2. 現在の設定を取得 (なければデフォルト)
    const currentSettings = getSettingsForTab(tabId);
    // 設定を保存 (まだなければデフォルトが保存される)
    if (!tabSettings.has(tabId)) {
        tabSettings.set(tabId, { ...currentSettings });
    }

    // 3. Offscreen Document に処理開始を依頼 (tabId, streamId, settings を渡す)
    console.log(`Sending start-processing message with streamId and settings for tab ${tabId} to offscreen document.`);
    chrome.runtime.sendMessage({
      type: 'start-processing',
      target: 'offscreen',
      tabId: tabId,
      streamId: streamId,
      settings: currentSettings // 現在の設定を追加
    });

    // 状態は 'starting' のまま (Offscreenからの応答を待つ)
    console.log(`Capture request sent for tab ${tabId}`);

  } catch (error) {
    console.error(`Error starting capture for tab ${tabId}:`, error);
    // getMediaStreamId でエラーが発生した場合なども考慮
    capturingTabs.set(tabId, { status: 'inactive' }); // エラー時は非アクティブに
    // エラーアイコンを設定 - アイコンファイルがまだないのでコメントアウト
    // chrome.action.setIcon({ path: "images/icon_error.png", tabId: tabId });
    // 必要であれば Offscreen Document を閉じる処理も検討
  }
}

// 音声キャプチャを停止する関数
async function stopCapture(tabId) {
    if (!capturingTabs.has(tabId) || capturingTabs.get(tabId).status === 'inactive') {
        console.log(`Capture not active or already stopping for tab ${tabId}`);
        return;
    }

    console.log(`Requesting stop processing for tab ${tabId}`);
    capturingTabs.set(tabId, { status: 'stopping' }); // 停止中状態に
    // 停止中アイコンを設定 - アイコンファイルがまだないのでコメントアウト
    // chrome.action.setIcon({ path: "images/icon_stopping.png", tabId: tabId });

    // Offscreen Document に処理停止を依頼
    chrome.runtime.sendMessage({
      type: 'stop-processing',
      target: 'offscreen',
      tabId: tabId
    });

    // Offscreen Document からの応答を待って状態を inactive にする (onMessage で処理)
    console.log(`Stop request sent for tab ${tabId}`);

    // Offscreen Document が不要になったら閉じるかどうかの判断は保留
    // (他のタブで使われている可能性、または常に一つ保持する戦略など)
}

// ポップアップや Offscreen Document からのメッセージを受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId;

  // Offscreen Document からのメッセージ処理
  if (sender.url?.endsWith('/offscreen.html')) {
    console.log('Message received in background from offscreen:', message);
    if (!tabId) {
      console.warn("Received message from offscreen without tabId:", message);
      return false; // sendResponse を呼ばないので false
    }

    let newStatus = null;
    switch (message.type) {
      case 'processing-started':
        if (capturingTabs.has(tabId)) {
          capturingTabs.set(tabId, { status: 'active' });
          newStatus = 'active';
          console.log(`Processing started for tab ${tabId}`);
          // オン状態のアイコンを設定 - アイコンファイルがまだないのでコメントアウト
          // chrome.action.setIcon({ path: "images/icon_on.png", tabId: tabId });
        }
        break;
      case 'processing-stopped':
        // stopCapture が呼ばれた結果としてここに来る場合と、
        // Offscreen 側でストリームが終了した場合がある
        if (capturingTabs.has(tabId)) {
          capturingTabs.set(tabId, { status: 'inactive' });
          newStatus = 'inactive';
          console.log(`Processing stopped for tab ${tabId}`);
          // オフ状態のアイコンを設定 - アイコンファイルがまだないのでコメントアウト
          // chrome.action.setIcon({ path: "images/icon_off.png", tabId: tabId });

          // 他にアクティブ/開始中のタブがなければ Offscreen Document を閉じるか検討
          // let activeOrStartingTabs = 0;
          // capturingTabs.forEach(value => {
          //   if (value.status === 'active' || value.status === 'starting') {
          //     activeOrStartingTabs++;
          //   }
          // });
          // if (activeOrStartingTabs === 0) {
          //   console.log('No active/starting tabs, closing offscreen document.');
          //   chrome.offscreen.closeDocument().catch(e => console.warn("Error closing offscreen doc:", e));
          // }
        }
        break;
      case 'error':
        console.error(`Error from offscreen document for tab ${tabId}:`, message.error);
        if (capturingTabs.has(tabId)) {
          capturingTabs.set(tabId, { status: 'inactive' }); // エラー時は非アクティブに
          newStatus = 'inactive'; // エラー発生後も inactive 状態として通知
          // エラーアイコンを設定 - アイコンファイルがまだないのでコメントアウト
          // chrome.action.setIcon({ path: "images/icon_error.png", tabId: tabId });
        }
        break;
      default:
        console.warn("Unknown message type received from offscreen:", message.type);
    }

    // ポップアップに状態更新を通知
    if (newStatus) {
      sendPopupStatusUpdate(tabId, newStatus);
    }
    return false; // Offscreen からのメッセージには応答しないので false
  }
  // ポップアップ (または他のコンテキスト) からのメッセージ処理
  else {
    console.log('Message received in background (likely from popup):', message);
    if (!tabId) {
      console.warn("Received message without tabId:", message);
      // tabId がないリクエストには応答できない
      sendResponse({ error: "tabId is required" });
      return false;
    }

    switch (message.type) {
      case 'get-status':
        const currentStatus = capturingTabs.get(tabId)?.status || 'inactive';
        console.log(`Sending status for tab ${tabId}: ${currentStatus}`);
        sendResponse({ status: currentStatus });
        break; // 同期的に応答するので break

      case 'get-settings':
        const settings = getSettingsForTab(tabId);
        console.log(`Sending settings for tab ${tabId}:`, settings);
        sendResponse(settings); // 設定オブジェクトをそのまま返す
        break; // 同期的に応答

      case 'update-settings':
        if (message.settings) {
          console.log(`Updating settings for tab ${tabId}:`, message.settings);
          // 設定を保存
          tabSettings.set(tabId, message.settings);
          // Offscreen Document にも設定更新を通知 (フィルターがアクティブな場合のみ)
          if (capturingTabs.get(tabId)?.status === 'active') {
            chrome.runtime.sendMessage({
              type: 'update-settings',
              target: 'offscreen',
              tabId: tabId,
              settings: message.settings
            }).catch(e => console.warn(`Failed to send settings update to offscreen for tab ${tabId}: ${e}`));
          }
          // ポップアップには応答不要 (または成功したことを示す応答を返しても良い)
          sendResponse({ success: true });
        } else {
          console.warn(`Received update-settings message without settings for tab ${tabId}`);
          sendResponse({ error: "Settings object is missing" });
        }
        break; // 同期的に応答

      case 'toggle-capture':
        // toggleCapture は非同期なので、sendResponse を非同期で呼ぶ必要がある
        (async () => {
          await toggleCapture(tabId);
          // toggleCapture は内部で capturingTabs の状態を 'starting' または 'stopping' に設定する
          const immediateStatus = capturingTabs.get(tabId)?.status || 'inactive'; // 念のため確認
          console.log(`Toggle requested for tab ${tabId}. Immediate status: ${immediateStatus}`);
          // ポップアップには、処理が開始/停止 *しようとしている* 状態を返す
          sendResponse({ newStatus: immediateStatus });
        })();
        return true; // 非同期で応答することを示す

      default:
        console.warn("Unknown message type received:", message.type);
        sendResponse({ error: `Unknown message type: ${message.type}` });
        break; // 不明なタイプにも応答
    }
    // get-status, get-settings, update-settings, default は同期的に sendResponse を呼ぶので、ここでは return false
    // toggle-capture は return true する
    return false; // toggle-capture 以外は false を返す
  }
});

// ポップアップに状態更新を通知するヘルパー関数
function sendPopupStatusUpdate(tabId, status) {
  console.log(`Sending status update to popup for tab ${tabId}: ${status}`);
  chrome.runtime.sendMessage({ type: 'status-update', tabId: tabId, status: status })
    .catch(error => {
      // ポップアップが開いていない場合などにエラーが発生するが、これは正常な動作
      if (error.message.includes("Receiving end does not exist")) {
        // console.log("Popup is not open, skipping status update.");
      } else {
        console.warn(`Error sending status update to popup for tab ${tabId}:`, error);
      }
    });
}

// タブが閉じられたときのクリーンアップ
chrome.tabs.onRemoved.addListener((tabId) => {
  if (capturingTabs.has(tabId) && capturingTabs.get(tabId).status !== 'inactive') {
    console.log(`Tab ${tabId} removed, stopping capture.`);
    // stopCapture を呼ぶのではなく、Offscreen に直接停止メッセージを送る方が良い場合もある
    chrome.runtime.sendMessage({
        type: 'stop-processing',
        target: 'offscreen',
        tabId: tabId
    });
    capturingTabs.delete(tabId); // 状態マップから削除
    tabSettings.delete(tabId); // 設定マップからも削除
    console.log(`Cleaned up state and settings for removed tab ${tabId}`);
    // Offscreen Document を閉じる判断はメッセージ受信時に行う
  } else {
      // 状態管理マップからも削除 (念のため)
      capturingTabs.delete(tabId);
      tabSettings.delete(tabId); // 設定マップからも削除
  }
});

// タブが更新されたときのクリーンアップ (例: リロード)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // ページの URL が変わった場合や、リロードが完了した場合など
  if (capturingTabs.has(tabId) && capturingTabs.get(tabId).status !== 'inactive') {
      if (changeInfo.status === 'loading' || changeInfo.url) {
          console.log(`Tab ${tabId} updated (${changeInfo.status || 'URL changed'}), stopping capture.`);
          // stopCapture を呼ぶか、直接メッセージ送信
          chrome.runtime.sendMessage({
              type: 'stop-processing',
              target: 'offscreen',
              tabId: tabId
          });
          // 状態を inactive に設定 (Offscreenからの応答を待たずに)
          capturingTabs.set(tabId, { status: 'inactive' });
          // 設定は保持しても良いが、混乱を避けるため削除する方が安全かもしれない
          tabSettings.delete(tabId);
          console.log(`Cleaned up state and settings for updated tab ${tabId}`);
          // オフ状態のアイコンを設定 - アイコンファイルがまだないのでコメントアウト
          // chrome.action.setIcon({ path: "images/icon_off.png", tabId: tabId });
      }
  }
});

// 拡張機能インストール時や更新時に初期アイコンを設定
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed or updated.');
  // 全タブのアイコンを初期状態 (オフ) に設定 - アイコンファイルがまだないのでコメントアウト
  // chrome.tabs.query({}, (tabs) => {
  //   tabs.forEach(tab => {
  //     chrome.action.setIcon({ path: "images/icon_off.png", tabId: tab.id });
  //   });
  // });
});

console.log("Background service worker started.");