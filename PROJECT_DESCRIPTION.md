# Nexus Games Project Description

This document provides a detailed description of the Nexus Games repository, based on an analysis of the source code.

## Overview

Nexus Games (also referred to as "NEXUS | Ultimate Game Library") is a web application designed to present a collection of game modifications ("mods") or premium games. It employs a "content locking" mechanism where users must complete specific tasks (offers) to unlock and download the desired content.

## Architecture

The project consists of a simple client-server architecture:

-   **Backend**: A Node.js/Express server (`server.js`) that serves the frontend and acts as a proxy for fetching offers from an external affiliate network.
-   **Frontend**: A single-page HTML/JS application (`index.html`) that displays the game library and manages the user interaction flow (browsing, searching, verifying offers).

## detailed Functionality

### 1. Backend (`server.js`)

The backend is built with Express.js and handles the following responsibilities:

-   **Static File Serving**: Serves the `index.html` file at the root path (`/`).
-   **API Proxy (`/api/offers`)**:
    -   Intercepts requests from the frontend for offers.
    -   Proxies these requests to an external API endpoint (`https://appverification.site/api/v2`), likely associated with a CPA (Cost Per Action) network like OGAds.
    -   **Security/IP Handling**: It implements robust IP detection logic, prioritizing the `x-forwarded-for` header to correctly identify client IPs when deployed behind proxies (e.g., Vercel). This is crucial for the external API to return valid offers for the user's region.
    -   **Offer Processing**:
        -   **Deduplication**: Removes duplicate offers based on `offerid`.
        -   **Prioritization**: Boosts specific "VIP" offers (IDs `67939`, `70489`) and "Boosted" CPI (Cost Per Install) offers.
        -   **Sorting**: Sorts offers by rank (VIP > Boosted CPI > Regular CPI > Other) and then by payout.
        -   **Limiting**: Returns a limited number of offers (default 5, configurable via `max` query param).
    -   **Authentication**: Uses a `LOCKER_API_KEY` environment variable to authenticate with the external API.

### 2. Frontend (`index.html`)

The frontend is a responsive web page with a cyberpunk/neon aesthetic. Its key features include:

-   **Game Library Display**:
    -   Fetches a list of games/modules from a **Google Sheet** (via CSV export).
    -   The sheet URL is hardcoded and proxied via `corsproxy.io` to avoid CORS issues.
    -   Parses the CSV data to extract game metadata (Title, Version, Size, OS, Image, Link, Description).
    -   Displays games in a grid with filtering by category and search functionality.
    -   Implements caching (localStorage) to reduce API calls to the Google Sheet.

-   **Content Locking & Verification**:
    -   When a user clicks "DIRECT INJECT" or "INITIALIZE INJECTION", a modal opens.
    -   The modal simulates a "Security Handshake" or "Verification" process.
    -   It fetches offers from the local backend (`/api/offers`).
    -   Users are instructed to complete an offer (e.g., install an app) to unlock the download.
    -   The frontend polls the backend (or re-fetches) to check for completion (`leads > 0`).
    -   Upon successful completion, the "Download" button is unlocked, redirecting the user to the actual file link (from the Google Sheet).

-   **Analytics & Tracking**:
    -   Integrates **Google Analytics 4** (`gtag.js`).
    -   Integrates **Microsoft Clarity** for user behavior tracking.

-   **Support System**:
    -   Includes a contact form that submits data to `formsubmit.co`.

## Technology Stack

-   **Backend**: Node.js, Express, Axios, CORS, Dotenv.
-   **Frontend**: HTML5, CSS3 (Custom styles with variables/animations), Vanilla JavaScript.
-   **Data Storage**: Google Sheets (as a CMS/Database for game listings).
-   **External APIs**: OGAds (or similar) for CPA offers.
