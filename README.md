# AI Observer

**Intelligent analytics for your GitHub Copilot interactions.**

AI Observer is a Visual Studio Code extension designed to help you track, analyze, and understand your interactions with GitHub Copilot. Gain insights into your coding patterns, see how you use AI assistance, and export your data for further analysis.

## Features

- **Track Copilot Interactions**: Automatically logs prompts and responses from GitHub Copilot.
- **Intelligent Tracking**: Uses advanced heuristics to accurately detect and capture AI-assisted code completions.
- **Interactive Dashboard**: A rich dashboard to visualize your interaction history, including language, acceptance rate, and latency.
- **Enable/Disable on the Fly**: Easily toggle logging on or off with a simple command.
- **Data Export**: Export your interaction logs to JSON or CSV for custom analysis.
- **Privacy-Focused**: All data is stored locally on your machine.
- **Test Data Generation**: Populate the dashboard with sample data to see it in action.

## Installation

1.  Open **Visual Studio Code**.
2.  Go to the **Extensions** view (`Ctrl+Shift+X`).
3.  Search for `AI Observer`.
4.  Click **Install**.

## Usage

You can access the features of AI Observer through the Command Palette (`Ctrl+Shift+P`).

### Commands

-   **`AI Observer: View Dashboard`**: Opens the main dashboard to view your Copilot interactions.
-   **`AI Observer: Toggle Logging`**: Enables or disables the logging of Copilot interactions.
-   **`AI Observer: Export Logs`**: Exports all captured interactions to a file (JSON or CSV).
-   **`AI Observer: Clear Logs`**: Deletes all stored interaction data.
-   **`AI Observer: Add Test Data`**: Adds 5 sample interactions to help you explore the dashboard's features.
-   **`AI Observer: Show Adapter Stats`**: Displays statistics about the Copilot adapter, such as its running state and pending suggestions.
-   **`AI Observer: Test`**: A simple command to check if the extension is running correctly.

## Configuration

You can configure AI Observer in your VS Code settings (`settings.json`).

-   **`aiObserver.enableLogging`**
    -   Enable or disable automatic logging of Copilot interactions.
    -   **Type**: `boolean`
    -   **Default**: `true`

-   **`aiObserver.storageLimit`**
    -   The maximum number of interactions to store.
    -   **Type**: `number`
    -   **Default**: `10000`

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on the [GitHub repository](https://github.com/Aki-07/AI-Observer).

## License

This project is licensed under the MIT License.
