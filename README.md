# Tab Audio Arranger

これは実験的プロトタイプです。

Tab Audio Arranger is a Chrome extension designed to arrange audio in the current tab. It provides features like noise cancellation, audio normalization, and equalizer adjustments.

## Features

- **Noise Cancellation**: Reduce background noise for clearer audio.
- **Audio Normalization**: Maintain consistent audio levels.
- **Equalizer**: Adjust low, mid, and high frequencies to your preference.

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the project folder.

## Usage

1. Click the extension icon in the Chrome toolbar.
2. Use the popup interface to:
   - Start or stop audio processing for the current tab.
   - Adjust audio settings like noise cancellation, normalization, and equalizer levels.
3. The extension will process audio in the background using an offscreen document.

## Development

### Prerequisites

- Node.js and npm (for dependency management, if applicable).
- Chrome browser with support for Manifest V3.

### Key Files

- **background.js**: Manages audio capture and processing logic.
- **offscreen.html**: Offscreen document for audio processing.
- **popup.html**: User interface for controlling the extension.

### Running Locally

1. Make changes to the source files as needed.
2. Reload the extension in `chrome://extensions/` to apply changes.

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes and push them to your fork.
4. Submit a pull request with a detailed description of your changes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Thanks to the Chrome Extensions API documentation for guidance.
- Inspired by the need for better audio quality in online communication and media playback.
