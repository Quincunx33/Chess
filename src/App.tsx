import { useEffect, useRef, useState } from 'react';
import { initWizardChess } from './wizardChessEngine.js';

export default function App() {
  const initializedRef = useRef(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initWizardChess();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSheetOpen(false);
      }
    };
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileSheetOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleRestoreUI = () => {
    const win = window as unknown as { wizardChess?: { toggleUI?: (force?: boolean) => void } };
    if (win.wizardChess?.toggleUI) {
      win.wizardChess.toggleUI(false);
    } else {
      document.body.classList.remove('cinematic-ui-hidden');
      const btnHide = document.getElementById('btn-hide-ui');
      if (btnHide) btnHide.textContent = 'Hide UI [H]';
    }
  };

  return (
    <>
      <div id="loading-overlay">
        <div className="loader-title">Wizard Chess</div>
        <div className="loader-bar-wrap">
          <div className="loader-bar" id="loader-bar"></div>
        </div>
        <div id="loader-text">Summoning Sanctum Architecture &amp; Sculpted Pieces...</div>
      </div>

      <div id="canvas-container"></div>

      <button
        type="button"
        className="hud-btn mobile-only-restore-ui"
        id="btn-mobile-show-ui"
        onClick={handleRestoreUI}
        title="Show HUD Controls"
      >
        Show UI
      </button>

      <div id="hud-top">
        <div className="hud-group" id="hud-left">
          <div className="brand-pill">
            <span className="brand-title">Wizard Chess</span>
          </div>
          <div className="status-pill" id="status-pill">
            <span className="turn-dot" id="turn-dot"></span>
            <span id="turn-text">White to Move</span>
            <span className="mode-badge" id="mode-badge">Playing as White</span>
          </div>
        </div>

        <button
          type="button"
          className={`hud-btn mobile-controls-trigger ${mobileSheetOpen ? 'active' : ''}`}
          id="btn-mobile-controls"
          aria-expanded={mobileSheetOpen}
          aria-controls="hud-right"
          onClick={() => setMobileSheetOpen((prev) => !prev)}
        >
          {mobileSheetOpen ? 'Close' : 'Controls'}
        </button>

        <div
          className={`mobile-sheet-backdrop ${mobileSheetOpen ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setMobileSheetOpen(false);
          }}
          aria-hidden="true"
        ></div>

        <div
          className={`hud-group ${mobileSheetOpen ? 'mobile-sheet-open' : ''}`}
          id="hud-right"
        >
          <div
            className="mobile-sheet-handle-wrap"
            onClick={(e) => {
              e.stopPropagation();
              setMobileSheetOpen(false);
            }}
            aria-hidden="true"
          >
            <div className="mobile-sheet-handle"></div>
          </div>

          <div className="mobile-sheet-header">
            <span className="mobile-sheet-title">Controls</span>
            <button
              type="button"
              className="mobile-sheet-close"
              id="btn-mobile-sheet-close"
              onClick={(e) => {
                e.stopPropagation();
                setMobileSheetOpen(false);
              }}
              aria-label="Close Controls"
            >
              Close ✕
            </button>
          </div>

          <div className="mobile-sheet-section-label">Game Actions</div>

          <button
            className="hud-btn highlight-btn"
            id="btn-lobby"
            title="Open Online Multiplayer, Dual Pass-and-Play, and Director Script Choreography Lobby"
            onClick={() => setMobileSheetOpen(false)}
          >
            🌐 Online &amp; Dual Lobby
          </button>
          <button
            className="hud-btn"
            id="btn-side-toggle"
            title="Switch between Playing as White and Playing as Black"
            onClick={() => setMobileSheetOpen(false)}
          >
            Play as Black
          </button>
          <button
            className="hud-btn"
            id="btn-ai-move"
            title="Let the AI make the next move immediately"
            onClick={() => setMobileSheetOpen(false)}
          >
            AI Move
          </button>
          <button
            className="hud-btn"
            id="btn-reset"
            title="Start a fresh game on the altar"
            onClick={() => setMobileSheetOpen(false)}
          >
            New Game
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">
            <span>Camera Views</span>
            <span className="mobile-sheet-section-sub">Tap active view to flip</span>
          </div>

          <button
            className="hud-btn active"
            id="btn-cam-player"
            title="Player Camera (Click again to flip White / Black view)"
          >
            Player Cam
          </button>
          <button
            className="hud-btn"
            id="btn-cam-top"
            title="Overhead Board View (Click again to flip White / Black orientation)"
          >
            Overhead
          </button>
          <button
            className="hud-btn"
            id="btn-cam-side"
            title="Side Profile View (Click again to switch East / West side)"
          >
            Side
          </button>
          <button
            className="hud-btn"
            id="btn-cam-wide"
            title="Wide Cathedral View (Click again to switch North Rose / South Narthex)"
          >
            Cathedral
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">Display &amp; Gestures</div>

          <button
            className="hud-btn"
            id="btn-graphics-toggle"
            title="Cycle Graphics Quality (Fast 60fps / Smooth Balanced / Ultra)"
          >
            ⚡ Graphics: Smooth
          </button>
          <button
            className="hud-btn"
            id="btn-sound-toggle"
            title="Toggle Sound Effects (iOS Touch to Unmute)"
          >
            🔊 Sound: On
          </button>
          <button
            className="hud-btn"
            id="btn-hide-ui"
            title="Toggle HUD visibility (Shortcut: H)"
            onClick={() => setMobileSheetOpen(false)}
          >
            Hide UI [H]
          </button>

          <div className="mobile-sheet-hint">
            <strong>Touch:</strong> Tap Piece to Move &nbsp;•&nbsp; 1-Finger Drag: Orbit &nbsp;•&nbsp; 2-Finger Drag: Pan &nbsp;•&nbsp; Pinch: Zoom
          </div>
        </div>
      </div>

      <div id="hud-bottom">
        <div className="hint-pill" id="controls-hint">
          <strong>Controls:</strong> Click Piece to Move &nbsp;•&nbsp; Left-Drag: Orbit &nbsp;•&nbsp; Right-Drag: Pan &nbsp;•&nbsp; Scroll: Zoom &nbsp;•&nbsp; WASD + R/F: Fly Cam &nbsp;•&nbsp; H: Hide UI
        </div>
        <div className="captured-pill" id="captured-tray"></div>
      </div>

      <div id="checkmate-overlay" role="status" aria-live="polite">
        <div className="checkmate-banner">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum Judgment &nbsp; ✦</div>
          <div className="checkmate-crown" id="checkmate-crown">♔</div>
          <div className="checkmate-title" id="checkmate-title">Checkmate</div>
          <div className="checkmate-rule"></div>
          <div className="checkmate-subtitle" id="checkmate-subtitle">
            White Triumphs • The Black King Has Fallen
          </div>
          <div className="checkmate-actions">
            <button className="checkmate-btn" id="btn-checkmate-replay">
              Replay King Fall
            </button>
            <button className="checkmate-btn" id="btn-checkmate-newgame">
              New Game
            </button>
            <button className="checkmate-btn secondary" id="btn-checkmate-dismiss">
              Dismiss
            </button>
          </div>
        </div>
      </div>

      <div id="lobby-modal" className="modal-backdrop">
        <div className="modal-card">
          <div className="modal-header">
            <h2 className="modal-title">🏰 Wizard Chess Sanctum Lobby</h2>
            <button
              type="button"
              className="modal-close"
              id="btn-close-lobby"
              onClick={() => {
                const win = window as unknown as { wizardChess?: { closeLobbyModal?: () => void } };
                win.wizardChess?.closeLobbyModal?.();
              }}
            >
              ✕
            </button>
          </div>
          <div className="modal-tabs">
            <button type="button" className="modal-tab active" id="tab-single">
              Single vs AI
            </button>
            <button type="button" className="modal-tab" id="tab-multi">
              🌐 Online &amp; Dual
            </button>
            <button type="button" className="modal-tab" id="tab-script">
              📜 Director Script
            </button>
          </div>
          <div className="modal-body">
            {/* Single Player Panel */}
            <div id="panel-single" className="modal-panel">
              <div className="modal-section-title">Select Your Side</div>
              <div className="color-picker-grid">
                <button type="button" className="color-pick-btn selected" id="pick-sp-white">
                  ♔ White (Play First)
                </button>
                <button type="button" className="color-pick-btn" id="pick-sp-black">
                  ♚ Black (AI Plays First)
                </button>
              </div>
              <button type="button" className="modal-primary-btn" id="btn-start-single">
                Start Single Player Game
              </button>
            </div>

            {/* Multiplayer Panel */}
            <div id="panel-multi" className="modal-panel" style={{ display: 'none' }}>
              <div className="modal-section-title">Create Online Room</div>
              <div className="color-picker-grid">
                <button type="button" className="color-pick-btn selected" id="pick-mp-white">
                  White
                </button>
                <button type="button" className="color-pick-btn" id="pick-mp-black">
                  Black
                </button>
              </div>
              <button type="button" className="modal-primary-btn" id="btn-create-room">
                Create Multiplayer Room
              </button>

              <div
                id="room-created-panel"
                style={{
                  display: 'none',
                  marginTop: '14px',
                  padding: '12px',
                  background: 'rgba(212,175,55,0.08)',
                  borderRadius: '8px',
                  border: '1px solid rgba(212,175,55,0.3)'
                }}
              >
                <div style={{ fontSize: '0.82rem', color: '#f0ece1', marginBottom: '6px' }}>
                  Room Code:{' '}
                  <strong id="modal-room-code" style={{ color: '#f5d76e', fontSize: '1.1rem' }}>
                    ----
                  </strong>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button type="button" className="modal-secondary-btn" id="btn-copy-code">
                    Copy Code
                  </button>
                  <button type="button" className="modal-secondary-btn" id="btn-copy-link">
                    Copy Invite Link
                  </button>
                  <button
                    type="button"
                    className="modal-primary-btn"
                    id="btn-enter-created-room"
                    style={{ flex: 1, margin: 0, padding: '6px 12px' }}
                  >
                    Enter Room
                  </button>
                </div>
              </div>

              <div
                className="modal-divider"
                style={{ margin: '16px 0', borderTop: '1px solid rgba(212,175,55,0.2)' }}
              ></div>

              <div className="modal-section-title">Join Existing Room</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  id="input-room-code"
                  placeholder="Enter 4-Char Code (e.g. A4K9)"
                  maxLength={6}
                  style={{
                    flex: 1,
                    background: '#0a0d14',
                    border: '1px solid rgba(212,175,55,0.4)',
                    borderRadius: '6px',
                    color: '#f0ece1',
                    padding: '8px 12px',
                    fontSize: '0.95rem',
                    textTransform: 'uppercase'
                  }}
                />
                <button
                  type="button"
                  className="modal-primary-btn"
                  id="btn-join-room"
                  style={{ margin: 0, padding: '8px 16px' }}
                >
                  Join Room
                </button>
              </div>
              <div
                id="mp-status-msg"
                style={{ fontSize: '0.8rem', color: '#d4af37', marginTop: '10px', textAlign: 'center' }}
              ></div>
            </div>

            {/* Script Choreography Panel */}
            <div id="panel-script" className="modal-panel" style={{ display: 'none' }}>
              <div className="modal-section-title">Historic PGN / SAN Notation Script</div>
              <textarea
                id="input-notation"
                rows={4}
                placeholder="1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5..."
                style={{
                  width: '100%',
                  background: '#0a0d14',
                  border: '1px solid rgba(212,175,55,0.4)',
                  borderRadius: '6px',
                  color: '#f0ece1',
                  padding: '8px 12px',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  resize: 'vertical'
                }}
              ></textarea>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button type="button" className="modal-secondary-btn" id="btn-preset-scandi">
                  Scand. Defense
                </button>
                <button type="button" className="modal-secondary-btn" id="btn-preset-italian">
                  Italian Game
                </button>
                <button type="button" className="modal-secondary-btn" id="btn-preset-scholar">
                  Scholar's Mate
                </button>
              </div>
              <button type="button" className="modal-primary-btn" id="btn-load-notation" style={{ marginTop: '12px' }}>
                Load &amp; Step Script
              </button>
              <div
                script-status-msg=""
                id="script-status-msg"
                style={{ fontSize: '0.8rem', color: '#d4af37', marginTop: '10px', textAlign: 'center' }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
