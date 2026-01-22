# Project Context: Thalita Neres Home

## Overview
This project appears to be a custom interactive frontend for a portfolio website (Thalita Neres). It is designed to be embedded within a Wix website, utilizing `postMessage` for communication between the custom HTML/JS and the Wix parent page.

The core functionality revolves around an interactive "room" or scene where users can hover over and click on various objects (books, camera, etc.) to navigate to different sections of the portfolio.

## Key Technologies
*   **HTML5/CSS3/JavaScript:** Vanilla web technologies used for the interactive scene.
*   **Wix Velo (formerly Corvid):** `wixPage.js` contains the Wix-side code that listens for messages from the embedded HTML and handles navigation.
*   **Canvas API:** Used in `home/index.html` for pixel-perfect hit detection on transparent image overlays.

## Architecture & Logic
1.  **Interactive Scene (`home/index.html`):**
    *   Loads a base image and several overlay images (representing clickable objects).
    *   Uses a "pre-computed center" logic to detect which object the cursor is closest to, allowing for precise interaction even with irregular shapes.
    *   Displays a custom cursor and a tooltip ("objectDescription") when hovering over active areas.
    *   On click, triggers a confetti animation and sends a message to the parent window with the target URL path (e.g., `/portfolio-arquitetura`).

2.  **Wix Integration (`wixPage.js`):**
    *   intended to run in the Wix page context.
    *   Listens for messages from the HTML component (`$w("#html1")`).
    *   Uses `wix-location` to redirect the browser to the URL received.

## Directory Structure
*   `home/`: Contains the main entry point `index.html` for the interactive home scene.
    *   `imagens/`: Local assets (though the code currently points to remote Wix URLs).
*   `filme-fotografico/`, `maquina-escrever/`, `pastas/`, `sobre-mim/`: Specific sections of the portfolio. These contain their own `index.html` (e.g., `photo-index.html`) files that follow the exact same interactive template as `home/index.html`, but with different base images and clickable overlays.
*   `wixPage.js`: The Velo code snippet for the Wix backend/frontend logic.

## Usage
To develop or test this locally:
1.  Open `home/index.html` in a web browser.
2.  Note that navigation will not work fully as `window.parent.postMessage` requires a listening parent, but the visual interaction and console logs will function.
3.  Assets are currently pulled from `static.wixstatic.com`. If working offline, these links would need to be updated to point to the local `imagens/` directories.
