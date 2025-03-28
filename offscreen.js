// offscreen.js

// 各タブの音声処理リソースを管理する Map (キー: tabId, 値: { stream: MediaStream, audioContext: AudioContext, sourceNode: MediaStreamAudioSourceNode, outputNode: AudioNode })
const audioResources = new Map();

// バックグラウンドスクリプトからのメッセージをリッスン
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  // バックグラウンドスクリプトからのメッセージか確認 (sender.id を使うのが一般的)
  // または message.target でフィルタリング
  if (message.target !== 'offscreen') {
    return false; // Offscreen 宛でなければ無視
  }

  console.log('Message received in offscreen:', message);

  switch (message.type) {
    case 'start-processing':
      // streamId がメッセージに含まれているか確認
      if (!message.streamId) {
        console.error("start-processing message received without streamId");
        chrome.runtime.sendMessage({ type: 'error', tabId: message.tabId, error: "Missing streamId in start-processing message" });
        return true; // エラーを通知したので true
      }
      await startAudioProcessing(message.tabId, message.streamId); // streamId を渡す
      break;
    case 'stop-processing':
      await stopAudioProcessing(message.tabId);
      break;
    default:
      console.warn("Unknown message type received:", message.type);
  }
  // 非同期処理があるので true を返すか、sendResponse を非同期で呼ぶ
  return true; // Indicate that the response will be sent asynchronously
});

// バックグラウンドから update-settings メッセージを受信したときの処理を追加
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;

    if (message.type === 'update-settings') {
        console.log('Received settings update in offscreen:', message.settings);
        const resources = audioResources.get(message.tabId);
        if (resources) {
            applySettings(resources, message.settings);
        } else {
            console.warn(`Received settings update for inactive tab ${message.tabId}`);
        }
        // ここでは応答不要
        return false; // 同期的に完了
    }
    // 他のメッセージタイプは上のリスナーで処理されるので、ここでは何もしない
    return false;
});


// 音声処理を開始する関数 (streamId と settings を受け取るように変更)
async function startAudioProcessing(tabId, streamId, initialSettings) {
  if (audioResources.has(tabId)) {
    console.log(`Audio processing already active for tab ${tabId}`);
    // すでに開始していることを通知しても良いかもしれない
    chrome.runtime.sendMessage({ type: 'processing-started', tabId: tabId });
    return;
  }

  console.log(`Starting audio processing for tab ${tabId} using streamId ${streamId}`);

  try {
    // 1. streamId を使って getUserMedia で音声ストリームを取得
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: 'tab', // 'tab' を指定
                chromeMediaSourceId: streamId // 受け取った streamId を指定
            }
        },
        video: false // ビデオは不要
    });
    console.log(`Audio stream obtained via getUserMedia for tab ${tabId}`, stream);

    // 2. Web Audio API のセットアップ
    const audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaStreamSource(stream);

    // --- ここに音声処理ノードを挿入 ---
    // ノッチフィルター (ハムノイズ除去 - 60Hzをターゲット)
    const notchFilter = audioContext.createBiquadFilter();
    notchFilter.type = "notch";
    notchFilter.frequency.value = 60; // 60Hz (地域によっては50Hz)
    notchFilter.Q.value = 10; // フィルターの鋭さ (調整が必要)

    // バンドパスフィルター (音声帯域強調)
    const bandpassFilter = audioContext.createBiquadFilter();
    bandpassFilter.type = "bandpass";
    bandpassFilter.frequency.value = 1850; // 中心周波数 (300Hzと3400Hzの中間あたり)
    bandpassFilter.Q.value = 0.8; // 帯域幅 (調整が必要)

    // ローパスフィルター (高周波ノイズ抑制)
    const lowpassFilter = audioContext.createBiquadFilter();
    lowpassFilter.type = "lowpass";
    lowpassFilter.frequency.value = 4000; // カットオフ周波数 (音声帯域より少し上)
    lowpassFilter.gain.value = 0;

    // イコライザー (3バンド Peaking Filter)
    const eqLow = audioContext.createBiquadFilter();
    eqLow.type = "peaking";
    eqLow.frequency.value = 100; // 低音域の中心周波数 (例)
    eqLow.Q.value = 1;           // Q値 (帯域幅)
    eqLow.gain.value = 0;        // 初期ゲイン (dB) - 後で調整可能にする

    const eqMid = audioContext.createBiquadFilter();
    eqMid.type = "peaking";
    eqMid.frequency.value = 1000; // 中音域の中心周波数 (例)
    eqMid.Q.value = 1;
    eqMid.gain.value = 0;

    const eqHigh = audioContext.createBiquadFilter();
    eqHigh.type = "peaking";
    eqHigh.frequency.value = 5000; // 高音域の中心周波数 (例)
    eqHigh.Q.value = 1;
    eqHigh.gain.value = 0;

    // DynamicsCompressorNode (ノーマライゼーション)
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // GainNode (最終的な音量調整)
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0; // 必要に応じて調整

    // ノードを接続: source -> notch -> bandpass -> lowpass -> eqLow -> eqMid -> eqHigh -> compressor -> gain -> destination
    sourceNode.connect(notchFilter);
    notchFilter.connect(bandpassFilter);
    bandpassFilter.connect(lowpassFilter);
    lowpassFilter.connect(eqLow); // lowpass の出力を eqLow へ
    eqLow.connect(eqMid);         // eqLow の出力を eqMid へ
    eqMid.connect(eqHigh);        // eqMid の出力を eqHigh へ
    eqHigh.connect(compressor);   // eqHigh の出力を compressor へ
    compressor.connect(gainNode);
    gainNode.connect(audioContext.destination);
    // ---------------------------------

    // リソースをオブジェクトにまとめる
    const resources = {
      stream: stream,
      audioContext: audioContext,
      sourceNode: sourceNode,
      notchFilter: notchFilter,
      bandpassFilter: bandpassFilter,
      lowpassFilter: lowpassFilter,
      eqLow: eqLow,
      eqMid: eqMid,
      eqHigh: eqHigh,
      compressor: compressor,
      outputNode: gainNode // 最後のノード
    };

    // 初期設定を適用
    applySettings(resources, initialSettings);

    // リソースをMapに保存
    audioResources.set(tabId, resources);

    // ストリームが終了したときの処理 (ユーザーがタブを閉じた場合など)
    stream.getTracks().forEach(track => {
        track.onended = () => {
            console.log(`Audio track ended for tab ${tabId}. Stopping processing.`);
            stopAudioProcessing(tabId); // ストリームが自然に終了した場合もクリーンアップ
        };
    });


    console.log(`Audio processing pipeline set up for tab ${tabId}`);

    // バックグラウンドスクリプトに処理開始を通知
    chrome.runtime.sendMessage({ type: 'processing-started', tabId: tabId });

  } catch (error) {
    console.error(`Error starting audio processing for tab ${tabId}:`, error);
    // エラー発生時はリソースをクリーンアップ
    await stopAudioProcessing(tabId); // 既存のリソースがあれば停止・解放
    // バックグラウンドスクリプトにエラーを通知
    chrome.runtime.sendMessage({ type: 'error', tabId: tabId, error: error.message });
  }
}

// 音声処理を停止する関数
async function stopAudioProcessing(tabId) {
  const resources = audioResources.get(tabId);
  if (!resources) {
    console.log(`No active audio processing found for tab ${tabId} to stop.`);
    // すでに停止している場合でも、バックグラウンドには停止完了を通知する
    chrome.runtime.sendMessage({ type: 'processing-stopped', tabId: tabId });
    return;
  }

  console.log(`Stopping audio processing for tab ${tabId}`);

  try {
    // 1. AudioContext を閉じる (これにより接続されたノードが解放され、音声再生が停止する)
    if (resources.audioContext && resources.audioContext.state !== 'closed') {
      await resources.audioContext.close();
      console.log(`AudioContext closed for tab ${tabId}`);
    }

    // 2. メディアストリームのトラックを停止 (キャプチャを明示的に停止)
    if (resources.stream) {
      resources.stream.getTracks().forEach(track => track.stop());
      console.log(`MediaStream tracks stopped for tab ${tabId}`);
    }
  } catch (error) {
      console.error(`Error during cleanup for tab ${tabId}:`, error);
      // エラーが発生しても、リソースマップからの削除は試みる
  } finally {
      // 3. リソースマップから削除
      audioResources.delete(tabId);
      console.log(`Cleaned up resources for tab ${tabId}`);

      // 4. バックグラウンドスクリプトに処理停止を通知
      chrome.runtime.sendMessage({ type: 'processing-stopped', tabId: tabId });
  }
}

console.log("Offscreen script loaded.");