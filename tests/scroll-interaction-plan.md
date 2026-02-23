# Scroll Interaction Test Plan

## Scope

Validate chat scroll behavior after consolidating autoscroll to Virtuoso (`followOutput`) and removing manual streaming `scrollToIndex` effects.

## Setup

1. Run `npm run dev`.
2. Open `http://localhost:3000` and sign in.
3. Prepare two threads:
   - Thread A with 50+ messages (long scrollable history).
   - Thread B with 10+ messages.

## Test Cases

### T1: Initial Thread Load Scrolls to Latest Once

1. Open Thread A from sidebar.
2. Wait until messages finish loading.
3. Do not interact with scroll.

Expected:
- View lands at the latest message.
- No repeated jump/jitter after initial placement.

### T2: Streaming While At Bottom Stays Pinned

1. In Thread A, ensure viewport is at bottom.
2. Send a prompt that streams for several seconds.

Expected:
- Incoming assistant content remains visible without manual scrolling.
- Scroll-to-bottom button stays hidden while pinned.

### T3: User Scroll Up During Stream Is Respected

1. Start a long streaming response in Thread A.
2. While streaming, scroll upward 5-10 messages.

Expected:
- View does not get yanked back to bottom.
- Scroll-to-bottom button appears.

### T4: Re-enable Follow Via Scroll-To-Bottom

1. Continue from T3 while stream is still active.
2. Click the scroll-to-bottom control.

Expected:
- View returns to latest message.
- New streamed tokens stay in view afterward.

### T5: Thread Switch Does Not Cause Scroll Fighting

1. Open Thread A, then Thread B, then Thread A again.
2. Pause 2-3 seconds after each switch.

Expected:
- Each thread settles cleanly at its latest message on first load.
- No oscillation between two positions.

### T6: Send While Not At Bottom

1. In Thread A, scroll up far from bottom.
2. Send a new prompt.

Expected:
- Composer send flow returns to active conversation area.
- New user + assistant messages are visible and remain followed while streaming.

### T7: Stop Generation Mid-Stream

1. Start streaming in Thread A.
2. Click Stop.

Expected:
- Streaming halts.
- Scroll position remains stable after stop (no unexpected jump).

### T8: Idle Realtime Append Check (Decision Checkpoint)

1. Open Thread A in two tabs.
2. In tab 1, keep viewport at bottom and idle (no active stream).
3. In tab 2, send a message in Thread A.

Expected:
- Confirm intended behavior with product:
  - Option A: auto-follow new message when already at bottom.
  - Option B: no auto-follow unless local stream is active.

## Pass Criteria

- T1-T7 pass with no forced-scroll conflicts.
- T8 behavior is explicitly accepted as product intent.
