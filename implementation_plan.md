# Implementation Plan - Mobile Content Locker Optimization

Optimize the content locker flow on mobile devices to improve user experience and avoid mobile iframe scrolling/sizing issues.

## Proposed Changes

### [Component Name] Realwebsite Frontend

#### [MODIFY] [index.html](file:///c:/Users/PC/Downloads/Realwebsite/index.html)
- Add a new `.mobile-locker-btn` style mimicking the premium `.nav-btn` border/glow styling but optimized for mobile tap size and full-width placement.
- Insert a mobile direct-link container (`#mobileLockerLinkContainer`) in `#modal-view-locker` styled as a card with a premium border and containing the "OPEN LINK" button.
- Update `initializeInjection` to automatically detect mobile devices, directly open the locker URL in a new tab (`window.open`), and switch to the locker view.
- Update `loadOgadsLocker` to accept a parameter for mobile mode, toggle visibility between the desktop iframe (`#ogadsLockerWrap`) and the mobile container (`#mobileLockerLinkContainer`), and bind the correct dynamic game URL.

## Verification Plan

### Automated Tests
- Build and run the project locally.

### Manual Verification
- Test on desktop view: clicking "DOWNLOAD" should still open the content locker in the modal's iframe.
- Test on mobile emulated view (width <= 600px): clicking "DOWNLOAD" should:
  1. Instantly open the locker URL in a new tab.
  2. Switch the modal to the locker view.
  3. Show the "OPEN LINK" button styled with the glowing border (same style as `.nav-btn` links).
  4. Show the tutorial video section directly below the button.
